import { sql } from 'drizzle-orm'
import { db } from '../lib/db/client'
import { linksTable } from '../lib/db/schema'
import { publicProcedure, router } from '../trpc'

export const statsRouter = router({
  getStatusCounts: publicProcedure.query(async () => {
    const statusCounts = await db
      .select({
        status: linksTable.status,
        count: sql<number>`count(*)`,
      })
      .from(linksTable)
      .groupBy(linksTable.status)
      .all()

    const totalResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(linksTable)
      .get()

    const total = totalResult?.count ?? 0

    const counts: Record<string, number> = {}
    for (const row of statusCounts) {
      counts[row.status] = row.count
    }

    return { total, statusCounts: counts }
  }),
})
