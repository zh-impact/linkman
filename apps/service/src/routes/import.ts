import { TRPCError } from '@trpc/server'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import {
  countLinksForSourceFile,
  getImportJobByFilename,
  getImportJobById,
  getNormalizedUrlsForSourceFile,
  incrementImportJob,
  insertImportJob,
  insertLinks,
  listImportJobs,
  updateImportJob,
} from '../lib/db/queries'
import { getMtime, readFile, writeFile } from '../lib/files'
import { resolveImportType } from '../lib/import/extractors'
import {
  clearCachedUrls,
  extractLinks,
  filterAgainstExisting,
  getCachedUrls,
  type ImportStrategy,
  type ImportType,
  prepareUrlRecord,
  setCachedUrls,
  validateImportLinks,
} from '../lib/import/parse'
import { publicProcedure, router } from '../trpc'

/**
 * Per-job serialization lock. The frontend drives one batch loop per job, but
 * two tabs or a double-click could overlap. This guarantees each batch reads a
 * distinct importedCount offset and inserts a distinct URL slice. Combined with
 * the atomic SQL increment, concurrent batches cannot lose or duplicate work.
 */
const jobLocks = new Map<string, Promise<unknown>>()
function withJobLock<T>(jobId: string, fn: () => Promise<T>): Promise<T> {
  const prev = (jobLocks.get(jobId) ?? Promise.resolve()).catch(() => undefined)
  const result = prev.then(() => fn())
  jobLocks.set(
    jobId,
    result.catch(() => undefined),
  )
  return result
}

const strategySchema = z.enum(['strict', 'normalized', 'smart'])
const typeSchema = z.enum(['TXT', 'JSON'])

/**
 * Real source filenames are short (e.g. `2026-06-16T12-55-58-heal.txt`). Legacy
 * rows created before file storage stored the full raw content in sourceContent;
 * returning those untrimmed would make import.list a multi-MB payload. Truncating
 * keeps the payload small without affecting legitimate filenames or file matching.
 */
function normalizeFilename(sourceContent: string): string {
  const MAX = 100
  return sourceContent.length > MAX ? `${sourceContent.slice(0, MAX)}…` : sourceContent
}

export const importRouter = router({
  // Step 1: persist source file + create a pending job. No parsing.
  create: publicProcedure
    .input(
      z.object({
        content: z.string(),
        filename: z.string().optional(),
        type: typeSchema.optional(),
        strategy: strategySchema.default('normalized'),
      }),
    )
    .mutation(async ({ input }) => {
      const type: ImportType = resolveImportType(input.filename, input.content, input.type)

      const ts = Math.floor(Date.now() / 1000).toString()
      const sanitized = (input.filename || '').replace(/[/\\]/g, '-').replace(/\s+/g, '-')
      const fileRelPath = input.filename ? `${ts}-${sanitized}` : `clipboard-${ts}.txt`

      await writeFile(fileRelPath, input.content)

      const jobId = uuidv4()
      await insertImportJob({
        id: jobId,
        type,
        sourceContent: fileRelPath,
        strategy: input.strategy,
        status: 'pending',
        importedCount: 0,
        duplicateCount: 0,
        errorCount: 0,
      })

      return { jobId, filename: fileRelPath }
    }),

  parse: router({
    // Step 2a: extract + validate once, cache, transition to processing.
    // For a stale-completed job (file changed since last parse), takes the
    // re-parse branch: rejects type/strategy overrides, filters extracted
    // URLs against rows already inserted for this source file, resets
    // importedCount to 0, sets isReparse=true. See design.md D3 + D7.
    start: publicProcedure
      .input(
        z.object({
          jobId: z.string(),
          type: typeSchema.optional(),
          strategy: strategySchema.optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const job = await getImportJobById(input.jobId)
        if (!job) throw new TRPCError({ code: 'NOT_FOUND', message: 'Job not found' })

        // Stale detection: read the file's current mtime once. This also
        // doubles as the existence check (stat throws NOT_FOUND-equivalent
        // if the file vanished — we let that propagate as a 500 below;
        // existing delete-file flow already handles that case).
        //
        // No `fileMtime !== null` guard: per spec scenario "Re-parse a
        // completed job whose file has changed", a legacy completed job
        // (fileMtime NULL from pre-deploy) is treated as stale because
        // any ISO string !== null. This is the one-time post-deploy path
        // that re-inserts every URL (filterAgainstExisting returns empty
        // for source_file = NULL rows); user runs deduplicate to collapse.
        const currentMtime = await getMtime(job.sourceContent)
        const isReparse = job.status === 'completed' && job.fileMtime !== currentMtime

        if (job.status === 'completed' && !isReparse) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'File unchanged since last parse; nothing to do',
          })
        }

        // Type / strategy override handling:
        //  - First-parse (pending/processing): allowed, mirrors existing spec.
        //  - Re-parse (completed+stale): forbidden. Changing strategy would
        //    compute normalizedUrl differently and break the diff filter;
        //    changing type would route through a different extractor.
        if (isReparse) {
          if (
            (input.type !== undefined && input.type !== job.type) ||
            (input.strategy !== undefined && input.strategy !== job.strategy)
          ) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message:
                'Re-parse must reuse the original type and strategy; delete the job and re-import to switch',
            })
          }
        }
        const nextType: ImportType = input.type ?? job.type
        const nextStrategy: ImportStrategy = input.strategy ?? job.strategy

        const content = await readFile(job.sourceContent)
        const { links, detectedFormat } = extractLinks(content, nextType, job.sourceContent)
        const { valid, invalid } = validateImportLinks(links)

        // Compute the cache. For re-parse, drop URLs already inserted for
        // THIS source file (matched by normalizedUrl under nextStrategy).
        // For first-parse, no filter — preserves byte-identical extraction
        // order required by the "Resumable parsing after cache loss" spec.
        let cacheValid = valid
        if (isReparse) {
          const existing = await getNormalizedUrlsForSourceFile(job.sourceContent)
          cacheValid = filterAgainstExisting(valid, existing, nextStrategy)
        }

        setCachedUrls(input.jobId, {
          valid: cacheValid,
          invalid,
          total: cacheValid.length,
          detectedFormat,
        })

        // Atomic job transition. For re-parse: reset importedCount to 0 so
        // the [0, batchSize) slice from parse.batch actually inserts rows
        // (see design.md D7 / review Bug A). For first-parse: capture
        // fileMtime + isReparse=false in the same update.
        await updateImportJob(input.jobId, {
          status: 'processing',
          errorCount: invalid.length,
          fileMtime: currentMtime,
          isReparse,
          ...(isReparse ? { importedCount: 0 } : {}),
          ...(nextType !== job.type || nextStrategy !== job.strategy
            ? {
                type: nextType,
                strategy: nextStrategy,
              }
            : {}),
        })

        return {
          jobId: input.jobId,
          totalValid: cacheValid.length,
          invalidCount: invalid.length,
          detectedFormat,
          isReparse,
        }
      }),

    // Step 2b: insert the next batch. Self-heals on cache miss (service restart).
    batch: publicProcedure
      .input(
        z.object({
          jobId: z.string(),
          batchSize: z.number().min(1).max(2000).default(500),
        }),
      )
      .mutation(async ({ input }) => {
        return withJobLock(input.jobId, async () => {
          const job = await getImportJobById(input.jobId)
          if (!job) throw new TRPCError({ code: 'NOT_FOUND', message: 'Job not found' })

          if (job.status === 'completed') {
            return {
              importedCount: job.importedCount,
              totalValid: job.importedCount,
              errorCount: job.errorCount,
              done: true,
              status: 'completed' as const,
            }
          }
          if (job.status !== 'processing') {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'Call import.parse.start first',
            })
          }

          // Self-heal: rebuild the cache if missing (e.g. after restart).
          // The reconstructed cache MUST match the original cache shape:
          //  - job.isReparse === false → byte-identical full extraction,
          //    no filter. Required by the "Resumable parsing after cache
          //    loss" spec.
          //  - job.isReparse === true → re-apply filterAgainstExisting so
          //    rows inserted by prior batches of THIS re-parse drop out of
          //    the reconstructed cache, and the [importedCount, +batchSize)
          //    slice stays valid against the diff.
          // No row-count inference — the persisted flag is the single source
          // of truth. See design.md D7.
          let cached = getCachedUrls(input.jobId)
          if (!cached) {
            const content = await readFile(job.sourceContent)
            const { links, detectedFormat } = extractLinks(content, job.type, job.sourceContent)
            const { valid, invalid } = validateImportLinks(links)
            const cacheValid = job.isReparse
              ? filterAgainstExisting(
                  valid,
                  await getNormalizedUrlsForSourceFile(job.sourceContent),
                  job.strategy,
                )
              : valid
            cached = { valid: cacheValid, invalid, total: cacheValid.length, detectedFormat }
            setCachedUrls(input.jobId, cached)
          }

          const start = job.importedCount
          const end = Math.min(start + input.batchSize, cached.total)
          if (end <= start) {
            // Nothing left; finalize. On re-parse completion, snap
            // importedCount to the cumulative count for this source file
            // (e.g. 502 = 500 original + 2 diff) so SourcesTab's "X links"
            // indicator reflects the total rows for this file, not just the
            // diff size. First-parse: no snap needed; importedCount already
            // equals the row count.
            const finalImportedCount = job.isReparse
              ? await countLinksForSourceFile(job.sourceContent)
              : start
            await updateImportJob(input.jobId, {
              status: 'completed',
              completedAt: new Date().toISOString(),
              ...(job.isReparse ? { importedCount: finalImportedCount } : {}),
            })
            clearCachedUrls(input.jobId)
            return {
              importedCount: finalImportedCount,
              totalValid: cached.total,
              errorCount: job.errorCount,
              done: true,
              status: 'completed' as const,
            }
          }

          const records = cached.valid
            .slice(start, end)
            .map((link, i) => prepareUrlRecord(link, job.strategy, job.type, start + i, job.sourceContent))

          if (records.length > 0) await insertLinks(records)
          await incrementImportJob(input.jobId, records.length, 0)

          const done = end >= cached.total
          if (done) {
            const finalImportedCount = job.isReparse ? await countLinksForSourceFile(job.sourceContent) : end
            await updateImportJob(input.jobId, {
              status: 'completed',
              completedAt: new Date().toISOString(),
              ...(job.isReparse ? { importedCount: finalImportedCount } : {}),
            })
            clearCachedUrls(input.jobId)
          }

          return {
            importedCount: done && job.isReparse ? await countLinksForSourceFile(job.sourceContent) : end,
            totalValid: cached.total,
            errorCount: job.errorCount,
            done,
            status: (done ? 'completed' : 'processing') as 'completed' | 'processing',
          }
        })
      }),
  }),

  list: publicProcedure.query(async () => {
    const jobs = await listImportJobs()
    return jobs.map((j) => ({
      jobId: j.id,
      filename: normalizeFilename(j.sourceContent),
      type: j.type,
      strategy: j.strategy,
      status: j.status,
      importedCount: j.importedCount,
      errorCount: j.errorCount,
      // ISO 8601 file mtime captured at parse.start. UI computes staleness
      // as `file.modifiedAt !== job.fileMtime` to surface the Re-parse
      // action without a server stat() round-trip. NULL until first parse.
      fileMtime: j.fileMtime,
      createdAt: j.createdAt,
    }))
  }),

  get: publicProcedure.input(z.object({ filename: z.string() })).query(async ({ input }) => {
    const jobs = await listImportJobs()
    const j = jobs.find((job) => job.sourceContent === input.filename)
    if (!j) return null
    return {
      jobId: j.id,
      filename: normalizeFilename(j.sourceContent),
      type: j.type,
      strategy: j.strategy,
      status: j.status,
      importedCount: j.importedCount,
      errorCount: j.errorCount,
      fileMtime: j.fileMtime,
      createdAt: j.createdAt,
    }
  }),

  /**
   * Resolve a filename to a job, creating a pending job if none exists yet.
   * Used by the Files toolbar to make the Parse button work for files that
   * are on disk but have no import_job row (e.g. files placed manually in
   * `data/files/`, or jobs deleted while the file remained). Idempotent:
   * calling it twice for the same filename returns the same job.
   */
  ensureJob: publicProcedure
    .input(
      z.object({
        filename: z.string(),
        type: typeSchema.optional(),
        strategy: strategySchema.optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const existing = await getImportJobByFilename(input.filename)
      if (existing) {
        return {
          jobId: existing.id,
          type: existing.type,
          strategy: existing.strategy,
          status: existing.status,
          importedCount: existing.importedCount,
          errorCount: existing.errorCount,
          createdAt: existing.createdAt,
        }
      }

      // Reject if the file isn't actually on disk — otherwise we'd create
      // a job that parse.start can never fulfil. Reuse the bytes we just
      // read for content-sniff type resolution (catches JSON-content-under-
      // .txt cases like Tablerone's `tablerone_backup_<ts>.txt`).
      let content: string
      try {
        content = await readFile(input.filename)
      } catch {
        throw new TRPCError({ code: 'NOT_FOUND', message: `File not found: ${input.filename}` })
      }

      const type: ImportType = resolveImportType(input.filename, content, input.type)
      const strategy: ImportStrategy = input.strategy ?? 'normalized'

      const jobId = uuidv4()
      await insertImportJob({
        id: jobId,
        type,
        sourceContent: input.filename,
        strategy,
        status: 'pending',
        importedCount: 0,
        duplicateCount: 0,
        errorCount: 0,
      })

      return {
        jobId,
        type,
        strategy,
        status: 'pending' as const,
        importedCount: 0,
        errorCount: 0,
        createdAt: new Date().toISOString(),
      }
    }),
})
