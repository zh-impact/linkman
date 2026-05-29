import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { insertImportJob, insertLink, updateImportJob } from '../lib/db/queries'
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

export const importRouter = router({
  create: publicProcedure
    .input(
      z.object({
        type: z.enum(['TXT', 'JSON']),
        content: z.string(),
        strategy: z.enum(['strict', 'normalized', 'smart']),
      }),
    )
    .mutation(async (opts) => {
      const {
        input: { type, content, strategy },
      } = opts

      const jobId = uuidv4()
      await insertImportJob({
        id: jobId,
        type: type,
        sourceContent: content,
        strategy: strategy,
        status: 'processing',
        importedCount: 0,
        duplicateCount: 0,
        errorCount: 0,
      })

      let urls: string[] = []

      if (type === 'JSON') {
        try {
          const parsed = JSON.parse(content)
          urls = Array.isArray(parsed) ? parsed.map(String) : []
        } catch {
          await updateImportJob(jobId, { status: 'failed', errorCount: 1 })
          // throw createError({ statusCode: 400, statusMessage: 'Invalid JSON content' })
        }
      } else {
        urls = content
          .split('\n')
          .map((u) => u.trim())
          .filter(Boolean)
      }

      const { valid, invalid } = validateUrls(urls)

      if (invalid.length > 0) {
        await updateImportJob(jobId, { errorCount: invalid.length })
      }

      let importedCount = 0
      let duplicateCount = 0
      const seenNormalized = new Set<string>()

      for (let i = 0; i < valid.length; i++) {
        try {
          const originalUrl = valid[i]

          let normalizedUrl: string
          if (strategy === 'strict') {
            normalizedUrl = originalUrl
          } else if (strategy === 'normalized') {
            normalizedUrl = normalizeUrl(originalUrl, DEFAULT_NORMALIZE_CONFIG)
          } else {
            // smart: normalize only www and trailing slash
            normalizedUrl = normalizeUrl(originalUrl, {
              forceHttps: false,
              removeWww: true,
              removeTrailingSlash: true,
              removeDefaultPort: false,
              sortQueryParams: false,
              removeFragment: false,
            })
          }

          const duplicateKey = strategy === 'strict' ? originalUrl : normalizedUrl

          if (seenNormalized.has(duplicateKey)) {
            duplicateCount++
            continue
          }

          seenNormalized.add(duplicateKey)

          const domain = extractDomain(originalUrl)

          await insertLink({
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
        } catch {
          // Skip individual errors
        }
      }

      await updateImportJob(jobId, {
        status: 'completed',
        importedCount,
        duplicateCount,
      })

      return {
        importedCount,
        invalid,
      }
    }),
})
