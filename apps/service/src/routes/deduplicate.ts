import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../lib/db/client'
import { linksTable } from '../lib/db/schema'
import { getAllLinks } from '../lib/db/queries'
import { logOperation } from '../lib/log'
import { normalizeUrl } from '../lib/url/normalize'
import { publicProcedure, router } from '../trpc'

const defaultNormalizeConfig = {
  forceHttps: false,
  removeWww: false,
  removeTrailingSlash: true,
  removeDefaultPort: true,
  sortQueryParams: true,
  removeFragment: true,
}

const normalizeConfigSchema = z.object({
  forceHttps: z.boolean(),
  removeWww: z.boolean(),
  removeTrailingSlash: z.boolean(),
  removeDefaultPort: z.boolean(),
  sortQueryParams: z.boolean(),
  removeFragment: z.boolean(),
}).default(defaultNormalizeConfig)

function getNormalizeUrl(strategy: string, normalizeConfig: z.infer<typeof normalizeConfigSchema>) {
  return (url: string): string => {
    if (strategy === 'strict') return url
    if (strategy === 'normalized') return normalizeUrl(url, normalizeConfig)
    // smart: only www and trailing slash
    return normalizeUrl(url, {
      forceHttps: false,
      removeWww: true,
      removeTrailingSlash: true,
      removeDefaultPort: false,
      sortQueryParams: false,
      removeFragment: false,
    })
  }
}

function findDuplicateGroups(allLinks: Awaited<ReturnType<typeof getAllLinks>>, normalize: (url: string) => string) {
  const normalizedMap = new Map<string, string[]>()
  for (const link of allLinks) {
    const normalizedUrl = normalize(link.originalUrl)
    if (!normalizedMap.has(normalizedUrl)) {
      normalizedMap.set(normalizedUrl, [])
    }
    normalizedMap.get(normalizedUrl)!.push(link.id)
  }

  const groups: Array<{ keepId: string; duplicateIds: string[] }> = []
  let duplicateCount = 0

  for (const [, ids] of normalizedMap) {
    if (ids.length <= 1) continue
    const [keepId, ...duplicateIds] = ids
    groups.push({ keepId, duplicateIds })
    duplicateCount += duplicateIds.length
  }

  return { groups, duplicateCount }
}

export const deduplicateRouter = router({
  preview: publicProcedure
    .input(
      z.object({
        strategy: z.enum(['strict', 'normalized', 'smart']).default('normalized'),
        sort: z.enum(['original', 'alphabetical', 'domain']).default('original'),
        normalizeConfig: normalizeConfigSchema,
      }),
    )
    .query(async ({ input }) => {
      const { strategy, sort, normalizeConfig } = input
      const allLinks = await getAllLinks()

      if (sort === 'alphabetical') {
        allLinks.sort((a, b) => a.originalUrl.localeCompare(b.originalUrl))
      } else if (sort === 'domain') {
        allLinks.sort((a, b) => a.domain.localeCompare(b.domain))
      }

      const normalize = getNormalizeUrl(strategy, normalizeConfig)
      const { groups, duplicateCount } = findDuplicateGroups(allLinks, normalize)

      return {
        duplicateCount,
        remainingCount: allLinks.length - duplicateCount,
        groups,
      }
    }),

  execute: publicProcedure
    .input(
      z.object({
        strategy: z.enum(['strict', 'normalized', 'smart']).default('normalized'),
        sort: z.enum(['original', 'alphabetical', 'domain']).default('original'),
        normalizeConfig: normalizeConfigSchema,
      }),
    )
    .mutation(async ({ input }) => {
      const { strategy, sort, normalizeConfig } = input
      const allLinks = await getAllLinks()

      if (sort === 'alphabetical') {
        allLinks.sort((a, b) => a.originalUrl.localeCompare(b.originalUrl))
      } else if (sort === 'domain') {
        allLinks.sort((a, b) => a.domain.localeCompare(b.domain))
      }

      const normalize = getNormalizeUrl(strategy, normalizeConfig)
      const { groups, duplicateCount } = findDuplicateGroups(allLinks, normalize)

      for (const group of groups) {
        for (const dupId of group.duplicateIds) {
          await db
            .update(linksTable)
            .set({ status: 'duplicate_removed', duplicateOf: group.keepId })
            .where(eq(linksTable.id, dupId))
            .run()
        }
      }

      await logOperation(
        {
          type: 'deduplicate',
          changes: { added: [], removed: [], modified: groups.flatMap((g) => g.duplicateIds.map((id) => ({ id, changes: {} }))) },
          stats: {
            inputCount: allLinks.length,
            outputCount: allLinks.length,
            duplicateCount,
            errorCount: 0,
          },
        },
        '',
      )

      return {
        duplicateCount,
        remainingCount: allLinks.length,
      }
    }),
})
