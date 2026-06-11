import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../lib/db/client'
import { linksTable } from '../lib/db/schema'
import { getAllLinks, getLinksByIds } from '../lib/db/queries'
import { captureBeforeState, diffLinks, logOperation } from '../lib/log'
import { detectSimilarity, type SimilarityLayer } from '../lib/similarity'
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
        let targetLinks
        if (input.linkIds?.length) {
          targetLinks = await getLinksByIds(input.linkIds)
        } else {
          targetLinks = (await getAllLinks()).filter((l) => l.status !== 'filtered_internal')
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
        let targetLinks
        if (input.linkIds?.length) {
          targetLinks = await getLinksByIds(input.linkIds)
        } else {
          targetLinks = (await getAllLinks()).filter((l) => l.status !== 'filtered_internal')
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

        for (const linkId of filteredIds) {
          await db
            .update(linksTable)
            .set({ status: 'filtered_internal', isInternal: true })
            .where(eq(linksTable.id, linkId))
            .run()
        }

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
        }),
      )
      .query(async ({ input }) => {
        let targetLinks
        if (input.linkIds?.length) {
          targetLinks = await getLinksByIds(input.linkIds)
        } else {
          targetLinks = await getAllLinks()
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

        const groups = detectSimilarity(targetLinks, layers)

        const totalSimilar = groups.reduce((sum, g) => sum + Math.max(0, g.linkIds.length - 1), 0)

        return {
          groupCount: groups.length,
          totalSimilar,
          groups: groups.map((g) => ({
            groupKey: g.groupKey,
            method: g.method,
            linkIds: g.linkIds,
            count: g.linkIds.length,
          })),
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
        let targetLinks
        if (input.linkIds?.length) {
          targetLinks = await getLinksByIds(input.linkIds)
        } else {
          targetLinks = await getAllLinks()
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

        const groups = detectSimilarity(targetLinks, layers)
        const groupsToApply = input.selectedGroups
          ? groups.filter((g) => input.selectedGroups!.includes(g.groupKey))
          : groups

        const before = await captureBeforeState()
        let filteredCount = 0

        for (const group of groupsToApply) {
          const [keepId, ...duplicateIds] = group.linkIds

          for (const dupId of duplicateIds) {
            await db
              .update(linksTable)
              .set({
                status: 'filtered_similar',
                similarityGroup: group.groupKey,
                duplicateOf: keepId,
              })
              .where(eq(linksTable.id, dupId))
              .run()
            filteredCount++
          }

          await db
            .update(linksTable)
            .set({ similarityGroup: group.groupKey })
            .where(eq(linksTable.id, keepId))
            .run()
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
