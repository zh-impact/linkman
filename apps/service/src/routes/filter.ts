import { z } from 'zod'
import {
  type AnalysisLink,
  getActiveLinksForAnalysis,
  getAllLinks,
  getLinksByIds,
  updateLinksStatusByIds,
} from '../lib/db/queries'
import { captureBeforeState, diffLinks, logOperation } from '../lib/log'
import {
  buildDomainBuckets,
  detectEditDistanceInDomain,
  detectSimilarity,
  type SimilarityLayer,
} from '../lib/similarity'
import { isInternalUrl } from '../lib/url/internal'
import { publicProcedure, router } from '../trpc'

export const filterRouter = router({
  internal: router({
    preview: publicProcedure
      .input(
        z.object({
          linkIds: z.array(z.string()).optional(),
        }),
      )
      .query(async ({ input }) => {
        let targetLinks: AnalysisLink[]
        if (input.linkIds?.length) {
          targetLinks = await getLinksByIds(input.linkIds)
        } else {
          targetLinks = await getActiveLinksForAnalysis()
        }

        const filteredIds: string[] = []
        for (const link of targetLinks) {
          if (isInternalUrl(link.originalUrl)) {
            filteredIds.push(link.id)
          }
        }

        return {
          filteredCount: filteredIds.length,
          remainingCount: targetLinks.length - filteredIds.length,
          filteredIds,
        }
      }),

    execute: publicProcedure
      .input(
        z.object({
          linkIds: z.array(z.string()).optional(),
        }),
      )
      .mutation(async ({ input }) => {
        let targetLinks: AnalysisLink[]
        if (input.linkIds?.length) {
          targetLinks = await getLinksByIds(input.linkIds)
        } else {
          targetLinks = await getActiveLinksForAnalysis()
        }

        const filteredIds: string[] = []
        let errorCount = 0

        for (const link of targetLinks) {
          try {
            if (isInternalUrl(link.originalUrl)) {
              filteredIds.push(link.id)
            }
          } catch {
            errorCount++
          }
        }

        const before = await captureBeforeState()

        await updateLinksStatusByIds(filteredIds, {
          status: 'filtered_internal',
          isInternal: true,
        })

        const linksAfter = await getAllLinks()
        const changes = diffLinks(
          before.linksBefore as Array<{ id: string; [key: string]: unknown }>,
          linksAfter as Array<{ id: string; [key: string]: unknown }>,
        )

        const operationId = await logOperation(
          {
            type: 'filter_internal',
            changes,
            stats: {
              inputCount: targetLinks.length,
              outputCount: targetLinks.length - filteredIds.length,
              errorCount,
            },
          },
          before.snapshotHash.hash,
        )

        return {
          filteredCount: filteredIds.length,
          operationId,
        }
      }),
  }),

  similar: router({
    preview: publicProcedure
      .input(
        z.object({
          linkIds: z.array(z.string()).optional(),
          strategy: z
            .object({
              byDomain: z.boolean().default(true),
              byPathPrefix: z.boolean().default(true),
              byPathDepth: z.number().default(2),
              editDistance: z.boolean().default(false),
              editDistanceThreshold: z.number().min(0).max(1).default(0.8),
            })
            .default({
              byDomain: true,
              byPathPrefix: true,
              byPathDepth: 2,
              editDistance: false,
              editDistanceThreshold: 0.8,
            }),
          cursor: z.number().min(0).default(0),
          batchSize: z.number().min(1).max(500).default(50),
        }),
      )
      .query(async ({ input }) => {
        let targetLinks: AnalysisLink[]
        if (input.linkIds?.length) {
          targetLinks = await getLinksByIds(input.linkIds)
        } else {
          targetLinks = await getActiveLinksForAnalysis()
        }

        const isEditDistance =
          input.strategy.editDistance && !input.strategy.byDomain && !input.strategy.byPathPrefix

        // Build link id -> url map for group detail lookup
        const linkMap = new Map<string, string>()
        for (const link of targetLinks) {
          linkMap.set(link.id, link.originalUrl)
        }

        const mapGroup = (g: { groupKey: string; method: string; linkIds: string[] }) => ({
          groupKey: g.groupKey,
          method: g.method,
          linkIds: g.linkIds,
          urls: g.linkIds.map((id) => linkMap.get(id) ?? ''),
          count: g.linkIds.length,
        })

        // --- Edit distance: paginated by domain ---
        if (isEditDistance) {
          const threshold = input.strategy.editDistanceThreshold
          const domainBuckets = buildDomainBuckets(targetLinks)

          const totalDomains = domainBuckets.length
          const start = input.cursor
          const end = Math.min(start + input.batchSize, totalDomains)

          const batchGroups: Array<{ groupKey: string; method: string; linkIds: string[] }> = []
          for (let i = start; i < end; i++) {
            const domainGroups = await detectEditDistanceInDomain(domainBuckets[i].links, threshold)
            batchGroups.push(...domainGroups)
          }

          const totalSimilar = batchGroups.reduce((sum, g) => sum + Math.max(0, g.linkIds.length - 1), 0)

          return {
            groupCount: batchGroups.length,
            totalSimilar,
            groups: batchGroups.map(mapGroup),
            processedDomains: end,
            totalDomains,
            hasMore: end < totalDomains,
            nextCursor: end < totalDomains ? end : null,
          }
        }

        // --- Domain / path_prefix: single-shot ---
        const layers: SimilarityLayer[] = []
        if (input.strategy.byDomain) {
          layers.push({ method: 'domain' })
        }
        if (input.strategy.byPathPrefix) {
          layers.push({ method: 'path_prefix', pathDepth: input.strategy.byPathDepth })
        }
        if (input.strategy.editDistance) {
          layers.push({ method: 'edit_distance', threshold: input.strategy.editDistanceThreshold })
        }
        if (layers.length === 0) {
          layers.push({ method: 'domain' })
          layers.push({ method: 'path_prefix', pathDepth: 2 })
        }

        const groups = await detectSimilarity(targetLinks, layers)
        const totalSimilar = groups.reduce((sum, g) => sum + Math.max(0, g.linkIds.length - 1), 0)

        return {
          groupCount: groups.length,
          totalSimilar,
          groups: groups.map(mapGroup),
          processedDomains: 0,
          totalDomains: 0,
          hasMore: false,
          nextCursor: null,
        }
      }),

    execute: publicProcedure
      .input(
        z.object({
          linkIds: z.array(z.string()).optional(),
          selectedGroups: z.array(z.string()).optional(),
          strategy: z
            .object({
              byDomain: z.boolean().default(true),
              byPathPrefix: z.boolean().default(true),
              byPathDepth: z.number().default(2),
              editDistance: z.boolean().default(false),
              editDistanceThreshold: z.number().min(0).max(1).default(0.8),
            })
            .default({
              byDomain: true,
              byPathPrefix: true,
              byPathDepth: 2,
              editDistance: false,
              editDistanceThreshold: 0.8,
            }),
        }),
      )
      .mutation(async ({ input }) => {
        let targetLinks: AnalysisLink[]
        if (input.linkIds?.length) {
          targetLinks = await getLinksByIds(input.linkIds)
        } else {
          targetLinks = await getActiveLinksForAnalysis()
        }

        const layers: SimilarityLayer[] = []
        if (input.strategy.byDomain) {
          layers.push({ method: 'domain' })
        }
        if (input.strategy.byPathPrefix) {
          layers.push({ method: 'path_prefix', pathDepth: input.strategy.byPathDepth })
        }
        if (input.strategy.editDistance) {
          layers.push({ method: 'edit_distance', threshold: input.strategy.editDistanceThreshold })
        }

        if (layers.length === 0) {
          layers.push({ method: 'domain' })
          layers.push({ method: 'path_prefix', pathDepth: 2 })
        }

        const groups = await detectSimilarity(targetLinks, layers)
        const selectedGroups = input.selectedGroups
        const groupsToApply = selectedGroups
          ? groups.filter((g) => selectedGroups.includes(g.groupKey))
          : groups

        const before = await captureBeforeState()
        let filteredCount = 0

        for (const group of groupsToApply) {
          const [keepId, ...duplicateIds] = group.linkIds

          await updateLinksStatusByIds(duplicateIds, {
            status: 'filtered_similar',
            similarityGroup: group.groupKey,
            duplicateOf: keepId,
          })
          filteredCount += duplicateIds.length

          await updateLinksStatusByIds([keepId], { similarityGroup: group.groupKey })
        }

        const linksAfter = await getAllLinks()
        const changes = diffLinks(
          before.linksBefore as Array<{ id: string; [key: string]: unknown }>,
          linksAfter as Array<{ id: string; [key: string]: unknown }>,
        )

        const operationId = await logOperation(
          {
            type: 'filter_similar',
            changes,
            stats: {
              inputCount: targetLinks.length,
              outputCount: targetLinks.length - filteredCount,
              errorCount: 0,
            },
          },
          before.snapshotHash.hash,
        )

        return {
          filteredCount,
          operationId,
        }
      }),
  }),
})
