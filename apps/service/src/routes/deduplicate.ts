import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../lib/db/client'
import { linksTable } from '../lib/db/schema'
import { getAllLinks } from '../lib/db/queries'
import { captureBeforeState, diffLinks, logOperation } from '../lib/log'
import { normalizeUrl } from '../lib/url/normalize'
import { publicProcedure, router } from '../trpc'

const DEFAULT_NORMALIZE_CONFIG = {
  forceHttps: false,
  removeWww: true,
  removeTrailingSlash: true,
  removeDefaultPort: true,
  sortQueryParams: false,
  removeFragment: true,
}

export const deduplicateRouter = router({
  preview: publicProcedure
    .input(
      z.object({
        strategy: z.enum(['strict', 'normalized', 'smart']).default('normalized'),
        sort: z.enum(['original', 'alphabetical', 'domain']).default('original'),
      }),
    )
    .query(async ({ input }) => {
      const { strategy, sort } = input
      const allLinks = await getAllLinks()

      const normalizedMap = new Map<string, string[]>()
      const sortedLinks = [...allLinks]

      if (sort === 'alphabetical') {
        sortedLinks.sort((a, b) => a.originalUrl.localeCompare(b.originalUrl))
      } else if (sort === 'domain') {
        sortedLinks.sort((a, b) => a.domain.localeCompare(b.domain))
      }

      for (const link of sortedLinks) {
        let normalizedUrl: string

        if (strategy === 'strict') {
          normalizedUrl = link.originalUrl
        } else if (strategy === 'normalized') {
          normalizedUrl = normalizeUrl(link.originalUrl, DEFAULT_NORMALIZE_CONFIG)
        } else {
          normalizedUrl = normalizeUrl(link.originalUrl, {
            forceHttps: false,
            removeWww: true,
            removeTrailingSlash: true,
            removeDefaultPort: false,
            sortQueryParams: false,
            removeFragment: false,
          })
        }

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
      }),
    )
    .mutation(async ({ input }) => {
      const { strategy, sort } = input
      const allLinks = await getAllLinks()

      const normalizedMap = new Map<string, string[]>()
      const sortedLinks = [...allLinks]

      if (sort === 'alphabetical') {
        sortedLinks.sort((a, b) => a.originalUrl.localeCompare(b.originalUrl))
      } else if (sort === 'domain') {
        sortedLinks.sort((a, b) => a.domain.localeCompare(b.domain))
      }

      for (const link of sortedLinks) {
        let normalizedUrl: string

        if (strategy === 'strict') {
          normalizedUrl = link.originalUrl
        } else if (strategy === 'normalized') {
          normalizedUrl = normalizeUrl(link.originalUrl, DEFAULT_NORMALIZE_CONFIG)
        } else {
          normalizedUrl = normalizeUrl(link.originalUrl, {
            forceHttps: false,
            removeWww: true,
            removeTrailingSlash: true,
            removeDefaultPort: false,
            sortQueryParams: false,
            removeFragment: false,
          })
        }

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

      const before = await captureBeforeState()

      for (const group of groups) {
        for (const dupId of group.duplicateIds) {
          await db
            .update(linksTable)
            .set({ status: 'duplicate_removed', duplicateOf: group.keepId })
            .where(eq(linksTable.id, dupId))
            .run()
        }
      }

      const linksAfter = await getAllLinks()
      const changes = diffLinks(
        before.linksBefore as Array<{ id: string; [key: string]: unknown }>,
        linksAfter as Array<{ id: string; [key: string]: unknown }>,
      )

      const operationId = await logOperation(
        {
          type: 'deduplicate',
          changes,
          stats: {
            inputCount: allLinks.length,
            outputCount: linksAfter.length,
            duplicateCount,
            errorCount: 0,
          },
        },
        before.snapshotHash.hash,
      )

      return {
        duplicateCount,
        remainingCount: linksAfter.length,
        operationId,
      }
    }),
})
