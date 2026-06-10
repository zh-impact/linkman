import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { insertImportJob, insertLinks, updateImportJob } from '../lib/db/queries'
import { writeFile } from '../lib/files'
import { extractDomain, normalizeUrl } from '../lib/url/normalize'
import { validateUrls } from '../lib/url/validate'
import { publicProcedure, router } from '../trpc'

const DEFAULT_NORMALIZE_CONFIG = {
  forceHttps: false,
  removeWww: true,
  removeTrailingSlash: true,
  removeDefaultPort: true,
  sortQueryParams: false,
  removeFragment: true,
}

const BATCH_SIZE = 500

export const importRouter = router({
  create: publicProcedure
    .input(
      z.object({
        type: z.enum(['TXT', 'JSON']),
        content: z.string(),
        strategy: z.enum(['strict', 'normalized', 'smart']),
        filename: z.string().optional(),
      }),
    )
    .mutation(async (opts) => {
      const {
        input: { type, content, strategy, filename },
      } = opts

      console.log(`[import] start: type=${type}, contentLen=${content.length}, strategy=${strategy}`)

      // Generate file path and save content to disk
      const ts = new Date().toISOString().replace(/:/g, '-').replace(/\.\d+Z$/, '')
      const sanitized = (filename || '').replace(/[/\\]/g, '-').replace(/\s+/g, '-')
      const fileRelPath = filename
        ? `${ts}-${sanitized}`
        : `clipboard-${ts}.txt`
      await writeFile(fileRelPath, content)
      console.log(`[import] file saved: ${fileRelPath}`)

      const jobId = uuidv4()
      await insertImportJob({
        id: jobId,
        type: type,
        sourceContent: fileRelPath,
        strategy: strategy,
        status: 'processing',
        importedCount: 0,
        duplicateCount: 0,
        errorCount: 0,
      })
      console.log(`[import] job created: ${jobId}`)

      let urls: string[] = []

      if (type === 'JSON') {
        try {
          const parsed = JSON.parse(content)
          console.log(`[import] JSON parsed: type=${typeof parsed}, isArray=${Array.isArray(parsed)}, sample=${JSON.stringify(parsed).slice(0, 200)}`)
          urls = Array.isArray(parsed)
            ? parsed.map((item: unknown) => {
                if (typeof item === 'string') return item
                if (item && typeof item === 'object' && 'url' in item) return String((item as { url: string }).url)
                return String(item)
              })
            : []
        } catch (err) {
          console.error(`[import] JSON parse error:`, err)
          await updateImportJob(jobId, { status: 'failed', errorCount: 1 })
          return { importedCount: 0, invalid: [] }
        }
      } else {
        urls = content
          .split('\n')
          .map((u) => u.trim())
          .filter(Boolean)
      }

      console.log(`[import] extracted ${urls.length} raw URLs`)

      const { valid, invalid } = validateUrls(urls)
      console.log(`[import] validated: valid=${valid.length}, invalid=${invalid.length}`)
      if (invalid.length > 0) {
        console.log(`[import] invalid sample:`, invalid.slice(0, 5))
        await updateImportJob(jobId, { errorCount: invalid.length })
      }

      let importedCount = 0
      const batch: (typeof import('../lib/db/schema').linksTable.$inferInsert)[] = []

      const flushBatch = async () => {
        if (batch.length === 0) return
        const count = batch.length
        await insertLinks(batch)
        batch.length = 0
        console.log(`[import] flushed batch of ${count}, total imported so far: ${importedCount}`)
      }

      for (let i = 0; i < valid.length; i++) {
        try {
          const originalUrl = valid[i]

          let normalizedUrl: string
          if (strategy === 'strict') {
            normalizedUrl = originalUrl
          } else if (strategy === 'normalized') {
            normalizedUrl = normalizeUrl(originalUrl, DEFAULT_NORMALIZE_CONFIG)
          } else {
            normalizedUrl = normalizeUrl(originalUrl, {
              forceHttps: false,
              removeWww: true,
              removeTrailingSlash: true,
              removeDefaultPort: false,
              sortQueryParams: false,
              removeFragment: false,
            })
          }

          const domain = extractDomain(originalUrl)

          batch.push({
            id: uuidv4(),
            originalUrl,
            normalizedUrl,
            domain,
            source: type,
            sourceOrder: i,
            status: 'imported',
            tags: '[]',
            isInternal: false,
          })

          importedCount++

          if (batch.length >= BATCH_SIZE) {
            await flushBatch()
          }
        } catch (err) {
          console.error(`[import] error at URL #${i}:`, err)
        }
      }

      await flushBatch()

      console.log(`[import] done: imported=${importedCount}, invalid=${invalid.length}`)

      await updateImportJob(jobId, {
        status: 'completed',
        importedCount,
      })

      return {
        importedCount,
        invalid: invalid.slice(0, 100),
      }
    }),
})
