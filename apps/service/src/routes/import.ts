import { TRPCError } from '@trpc/server'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import {
  getImportJobById,
  incrementImportJob,
  insertImportJob,
  insertLinks,
  listImportJobs,
  updateImportJob,
} from '../lib/db/queries'
import { readFile, writeFile } from '../lib/files'
import {
  extractUrls,
  getCachedUrls,
  prepareUrlRecord,
  setCachedUrls,
  clearCachedUrls,
  validateImportUrls,
  type ImportStrategy,
  type ImportType,
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
  jobLocks.set(jobId, result.catch(() => undefined))
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
  return sourceContent.length > MAX ? sourceContent.slice(0, MAX) + '…' : sourceContent
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
      const type: ImportType =
        input.type ?? (input.filename?.toLowerCase().endsWith('.json') ? 'JSON' : 'TXT')

      const ts = new Date().toISOString().replace(/:/g, '-').replace(/\.\d+Z$/, '')
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
        if (job.status === 'completed') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Job already completed; delete the file/job and re-import to re-parse',
          })
        }

        const nextType: ImportType = input.type ?? job.type
        const nextStrategy: ImportStrategy = input.strategy ?? job.strategy
        if (nextType !== job.type || nextStrategy !== job.strategy) {
          await updateImportJob(input.jobId, { type: nextType, strategy: nextStrategy })
        }

        const content = await readFile(job.sourceContent)
        const urls = extractUrls(nextType, content)
        const { valid, invalid } = validateImportUrls(urls)
        setCachedUrls(input.jobId, { valid, invalid, total: valid.length })

        await updateImportJob(input.jobId, {
          status: 'processing',
          errorCount: invalid.length,
        })

        return { jobId: input.jobId, totalValid: valid.length, invalidCount: invalid.length }
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
          let cached = getCachedUrls(input.jobId)
          if (!cached) {
            const content = await readFile(job.sourceContent)
            const { valid, invalid } = validateImportUrls(extractUrls(job.type, content))
            cached = { valid, invalid, total: valid.length }
            setCachedUrls(input.jobId, cached)
          }

          const start = job.importedCount
          const end = Math.min(start + input.batchSize, cached.total)
          if (end <= start) {
            // Nothing left; finalize.
            await updateImportJob(input.jobId, {
              status: 'completed',
              completedAt: new Date().toISOString(),
            })
            clearCachedUrls(input.jobId)
            return {
              importedCount: start,
              totalValid: cached.total,
              errorCount: job.errorCount,
              done: true,
              status: 'completed' as const,
            }
          }

          const records = cached.valid
            .slice(start, end)
            .map((url, i) => prepareUrlRecord(url, job.strategy, job.type, start + i))

          if (records.length > 0) await insertLinks(records)
          await incrementImportJob(input.jobId, records.length, 0)

          const done = end >= cached.total
          if (done) {
            await updateImportJob(input.jobId, {
              status: 'completed',
              completedAt: new Date().toISOString(),
            })
            clearCachedUrls(input.jobId)
          }

          return {
            importedCount: end,
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
      createdAt: j.createdAt,
    }))
  }),

  get: publicProcedure
    .input(z.object({ filename: z.string() }))
    .query(async ({ input }) => {
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
        createdAt: j.createdAt,
      }
    }),
})
