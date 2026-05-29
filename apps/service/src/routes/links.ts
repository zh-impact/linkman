import { z } from 'zod'
import {
  deleteLink,
  getAllLinkIds,
  getLinkById,
  getLinksByStatus,
  getLinksByIds,
  getLinksByStatusPaginated,
  getLinksCount,
  getLinksCountByStatus,
  getLinksPaginated,
  searchLinksCount,
  searchLinksPaginated,
  updateLink,
} from '../lib/db/queries'
import { publicProcedure, router } from '../trpc'

const statusEnum = z.enum([
  'pending',
  'imported',
  'duplicate_removed',
  'filtered_internal',
  'filtered_similar',
  'dns_failed',
  'connection_refused',
  'timeout',
  'success',
  'error',
])

export const linksRouter = router({
  list: publicProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(200).default(50),
        offset: z.number().min(0).default(0),
        status: statusEnum.optional(),
        search: z.string().optional(),
      }),
    )
    .query(async ({ input }) => {
      const { limit, offset, status, search } = input

      if (search) {
        const [links, countResult] = await Promise.all([
          searchLinksPaginated(search, status ?? null, limit, offset),
          searchLinksCount(search, status ?? null),
        ])
        return { links, total: countResult?.count ?? 0 }
      }

      if (status) {
        const [links, countResult] = await Promise.all([
          getLinksByStatusPaginated(status, limit, offset),
          getLinksCountByStatus(status),
        ])
        return { links, total: countResult?.count ?? 0 }
      }

      const [links, countResult] = await Promise.all([
        getLinksPaginated(limit, offset),
        getLinksCount(),
      ])
      return { links, total: countResult?.count ?? 0 }
    }),

  getById: publicProcedure.input(z.string()).query(async ({ input: id }) => {
    const link = await getLinkById(id)
    if (!link) return null
    return link
  }),

  getAllIds: publicProcedure.query(async () => {
    const ids = await getAllLinkIds()
    return { ids }
  }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        data: z.object({
          title: z.string().optional(),
          tags: z.string().optional(),
          status: statusEnum.optional(),
        }),
      }),
    )
    .mutation(async ({ input }) => {
      // TODO: add operation logging (Phase 4)
      await updateLink(input.id, input.data)
      const updated = await getLinkById(input.id)
      return updated
    }),

  delete: publicProcedure.input(z.string()).mutation(async ({ input: id }) => {
    // TODO: add operation logging (Phase 4)
    await deleteLink(id)
    return { success: true }
  }),

  batchDelete: publicProcedure
    .input(z.object({ ids: z.array(z.string()).min(1) }))
    .mutation(async ({ input }) => {
      // TODO: add operation logging (Phase 4)
      let errorCount = 0
      for (const id of input.ids) {
        try {
          await deleteLink(id)
        } catch {
          errorCount++
        }
      }
      return { success: true, deletedCount: input.ids.length - errorCount, errorCount }
    }),

  export: publicProcedure
    .input(
      z.object({
        format: z.enum(['json', 'csv']).default('json'),
        status: statusEnum.optional(),
        ids: z.array(z.string()).optional(),
      }),
    )
    .query(async ({ input }) => {
      let links
      if (input.ids?.length) {
        links = await getLinksByIds(input.ids)
      } else if (input.status) {
        links = await getLinksByStatus(input.status)
      } else {
        const { getAllLinks } = await import('../lib/db/queries')
        links = await getAllLinks()
      }

      if (input.format === 'csv') {
        const headers = [
          'id',
          'originalUrl',
          'normalizedUrl',
          'domain',
          'title',
          'source',
          'status',
          'tags',
          'isInternal',
          'createdAt',
          'updatedAt',
        ]
        const csvRows = [headers.join(',')]
        for (const link of links) {
          const row = headers.map((h) => {
            const val = String((link as Record<string, unknown>)[h] ?? '')
            return `"${val.replace(/"/g, '""')}"`
          })
          csvRows.push(row.join(','))
        }
        return { data: csvRows.join('\n'), format: 'csv' as const }
      }

      return { data: JSON.stringify(links, null, 2), format: 'json' as const }
    }),
})
