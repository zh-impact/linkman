import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { getImportJobByFilename } from '../lib/db/queries'
import { EXPORTS_DIR, readFile, writeExportFile } from '../lib/files'
import {
  detectFormat,
  extractLinks,
  type ImportType,
  resolveImportType,
} from '../lib/import/extractors'
import type { Link, LinkFormat } from '../lib/url/extract'
import { splitLines } from '../lib/url/extract'
import { publicProcedure, router } from '../trpc'

const PREVIEW_SAMPLE_LIMIT = 10
// Same bound as `buildDetectContext` uses for sniffing. Keeps rawSample short
// enough to fit in a preview card while still showing the user enough lines
// to identify the source format by eye.
const PREVIEW_RAW_LINE_LIMIT = 10

interface PreviewOk {
  filename: string
  detectedFormat: LinkFormat
  linkCount: number
  /** First N non-empty lines of the source file, verbatim — lets the user
   *  eyeball the original format and compare against the extracted sample. */
  rawSample: string[]
  sample: Pick<Link, 'url' | 'title'>[]
}
interface PreviewErr {
  filename: string
  error: string
}

/**
 * Resolve the ImportType to feed into `extractLinks`. Prefer the type the
 * user already chose at Parse time (stored on `import_jobs.type`) so export
 * matches parse behavior; fall back to `resolveImportType` (filename pattern
 * + content sniff + extension) for orphaned files (no import_jobs row).
 *
 * Callers should already have read `content` for the actual extract step, so
 * we take it here to avoid a second IO and to let the content sniff see the
 * real source bytes (catches the "JSON content saved as .txt" case, e.g.
 * Tablerone's `tablerone_backup_<ts>.txt`).
 */
async function resolveType(filename: string, content: string): Promise<ImportType> {
  const job = await getImportJobByFilename(filename)
  return resolveImportType(filename, content, job?.type)
}

/**
 * SHA-256 of the source file content, truncated to the first 8 hex chars.
 * Used as a content-addressed suffix on the export filename so that two
 * exports of byte-identical source content target the same file (and the
 * second one can be skipped). 8 hex = 32 bits; collision-safe for the
 * scale of export artifacts this system produces.
 */
function computeContentHash(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex').slice(0, 8)
}

/**
 * Compute the export filename: `<safeStem>-<hash8>.json`. The hash is
 * content-addressed, so the same source content always yields the same
 * filename — that's what makes the dedup check in `run` work.
 *
 * Strips the original extension so `source.txt` becomes
 * `source-<hash8>.json`, not `source.txt-<hash8>.json`.
 */
function buildExportFilename(sourceFilename: string, hash8: string): string {
  const base = path.basename(sourceFilename)
  const stem = base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base
  const safeStem = stem.replace(/[/\\]/g, '-')
  return `${safeStem}-${hash8}.json`
}

function toExportLink(l: Link): Pick<Link, 'url' | 'title'> {
  return { url: l.url, title: l.title }
}

/**
 * Check whether a file exists under `data/exports/`. Used by `run` to
 * decide whether to skip the write. We use `fs.promises.access` directly
 * rather than going through `resolveExportPath` because the filename is
 * constructed server-side from a sanitized stem + hash — there is no
 * user-controlled path segment to validate again.
 */
function exportFileExists(relPath: string): Promise<boolean> {
  const abs = path.join(EXPORTS_DIR, relPath)
  return fs.promises
    .access(abs, fs.constants.F_OK)
    .then(() => true)
    .catch(() => false)
}

const runInputSchema = z
  .object({
    filename: z.string(),
    download: z.boolean().default(true),
    saveToExports: z.boolean().default(true),
  })
  .refine((d) => d.download || d.saveToExports, {
    message: 'At least one delivery target (download or saveToExports) must be enabled',
  })

export const exportRouter = router({
  /**
   * Detect-only classification. Returns the `detectedFormat` for each file
   * without running the (expensive) extract step. Used by the ExportTab to
   * filter out files that are already in standard JSON-array form
   * (`detectedFormat === 'json_array'`) so the list focuses on files that
   * actually need conversion.
   *
   * One bad file does not abort the batch — errors come back as
   * `{ filename, error }` entries alongside the ok results.
   */
  classify: publicProcedure
    .input(z.object({ filenames: z.array(z.string()).min(1) }))
    .mutation(
      async ({
        input,
      }): Promise<
        ({ filename: string; detectedFormat: LinkFormat } | { filename: string; error: string })[]
      > => {
        const results: (
          | { filename: string; detectedFormat: LinkFormat }
          | { filename: string; error: string }
        )[] = []
        for (const filename of input.filenames) {
          try {
            const content = await readFile(filename)
            const type = await resolveType(filename, content)
            results.push({ filename, detectedFormat: detectFormat(content, type, filename) })
          } catch (err) {
            results.push({
              filename,
              error: err instanceof Error ? err.message : 'classify failed',
            })
          }
        }
        return results
      },
    ),

  /**
   * For each filename, run `extractLinks` and return the detected format,
   * total count, and first-N sample. Does NOT deliver full JSON — keeps
   * payload small for large files. Unreadable files are returned with an
   * `error` field rather than throwing, so one bad file doesn't kill the
   * whole preview.
   */
  preview: publicProcedure
    .input(z.object({ filenames: z.array(z.string()).min(1) }))
    .mutation(async ({ input }): Promise<(PreviewOk | PreviewErr)[]> => {
      const results: (PreviewOk | PreviewErr)[] = []
      for (const filename of input.filenames) {
        try {
          const content = await readFile(filename)
          const type = await resolveType(filename, content)
          const { links, detectedFormat } = extractLinks(content, type, filename)
          // Collect first N non-empty source lines. Same predicate as
          // buildDetectContext so what the user sees matches what the
          // detector saw.
          const rawSample: string[] = []
          for (const line of splitLines(content)) {
            if (line.trim()) rawSample.push(line)
            if (rawSample.length >= PREVIEW_RAW_LINE_LIMIT) break
          }
          results.push({
            filename,
            detectedFormat,
            linkCount: links.length,
            rawSample,
            sample: links.slice(0, PREVIEW_SAMPLE_LIMIT).map(toExportLink),
          })
        } catch (err) {
          results.push({
            filename,
            error: err instanceof Error ? err.message : 'preview failed',
          })
        }
      }
      return results
    }),

  /**
   * Extract + serialize the full `[{url, title}, ...]` JSON for a single
   * file. Two independent delivery toggles:
   *   - `download`: returns the JSON string for the frontend to Blob-download
   *   - `saveToExports`: writes a copy to `data/exports/<stem>-<hash8>.json`,
   *     skipping the write if a file with the same content-hash name already
   *     exists (dedup).
   *
   * The JSON is always computed and returned regardless of toggles so the
   * frontend can decide whether to Blob-download; the `saveToExports` toggle
   * only controls the disk-write side-effect.
   */
  run: publicProcedure.input(runInputSchema).mutation(async ({ input }) => {
    const content = await readFile(input.filename)
    const type = await resolveType(input.filename, content)
    const { links } = extractLinks(content, type, input.filename)
    const json = JSON.stringify(links.map(toExportLink), null, 2)

    let savedPath: string | undefined
    let skipped: boolean | undefined
    if (input.saveToExports) {
      const hash8 = computeContentHash(content)
      const rel = buildExportFilename(input.filename, hash8)
      if (await exportFileExists(rel)) {
        // Same content was exported before — skip the write.
        skipped = true
      } else {
        await writeExportFile(rel, json)
        skipped = false
      }
      savedPath = rel
    }

    return { json, linkCount: links.length, savedPath, skipped }
  }),
})
