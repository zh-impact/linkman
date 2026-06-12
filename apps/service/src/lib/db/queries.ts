import { and, desc, eq, inArray, like, or, sql } from 'drizzle-orm'
import { db } from './client'
import { importJobs, linksTable, operations, snapshots, testJobs, testResults } from './schema'

// Link queries
export async function insertLink(data: typeof linksTable.$inferInsert) {
  return db.insert(linksTable).values(data).run()
}

export async function insertLinks(data: (typeof linksTable.$inferInsert)[]) {
  if (data.length === 0) return
  return db.insert(linksTable).values(data).run()
}

export async function updateLink(id: string, data: Partial<typeof linksTable.$inferInsert>) {
  return db.update(linksTable).set(data).where(eq(linksTable.id, id)).run()
}

export async function deleteLink(id: string) {
  return db.delete(linksTable).where(eq(linksTable.id, id)).run()
}

export async function deleteLinksByIds(ids: string[]) {
  if (ids.length === 0) return
  return db.delete(linksTable).where(inArray(linksTable.id, ids)).run()
}

export async function getLinkById(id: string) {
  return db.select().from(linksTable).where(eq(linksTable.id, id)).get()
}

export async function getAllLinks() {
  return db.select().from(linksTable).all()
}

export async function getLinksByStatus(status: (typeof linksTable.status.enumValues)[number]) {
  return db
    .select()
    .from(linksTable)
    .where(eq(linksTable.status, status))
    .orderBy(desc(linksTable.createdAt))
    .all()
}

export async function getLinksByIds(ids: string[]) {
  return db
    .select()
    .from(linksTable)
    .where(inArray(linksTable.id, ids))
    .orderBy(desc(linksTable.createdAt))
    .all()
}

export async function getLinksPaginated(limit: number, offset: number) {
  return db
    .select()
    .from(linksTable)
    .orderBy(desc(linksTable.createdAt))
    .limit(limit)
    .offset(offset)
    .all()
}

export async function getLinksByStatusPaginated(status: string, limit: number, offset: number) {
  return db
    .select()
    .from(linksTable)
    .where(eq(linksTable.status, status as (typeof linksTable.status.enumValues)[number]))
    .orderBy(desc(linksTable.createdAt))
    .limit(limit)
    .offset(offset)
    .all()
}

export async function getLinksCountByStatus(status: string) {
  return db
    .select({ count: sql<number>`count(*)` })
    .from(linksTable)
    .where(eq(linksTable.status, status as (typeof linksTable.status.enumValues)[number]))
    .get()
}

export async function getLinksCount() {
  return db.select({ count: sql<number>`count(*)` }).from(linksTable).get()
}

export async function getResolvedUrlCount() {
  return db
    .select({ count: sql<number>`count(DISTINCT ${linksTable.originalUrl})` })
    .from(linksTable)
    .where(
      and(
        sql`${linksTable.status} != 'duplicate_removed'`,
        sql`${linksTable.status} != 'filtered_internal'`,
        sql`${linksTable.status} != 'filtered_similar'`,
      ),
    )
    .get()
}

export async function getResolvedUrls(limit: number, offset: number) {
  return db
    .selectDistinct({ url: linksTable.originalUrl })
    .from(linksTable)
    .where(
      and(
        sql`${linksTable.status} != 'duplicate_removed'`,
        sql`${linksTable.status} != 'filtered_internal'`,
        sql`${linksTable.status} != 'filtered_similar'`,
      ),
    )
    .orderBy(linksTable.originalUrl)
    .limit(limit)
    .offset(offset)
    .all()
}

export async function getAllLinkIds() {
  const results = await db.select({ id: linksTable.id }).from(linksTable).all()
  return results.map((r) => r.id)
}

// Search links with pagination (optionally filtered by status first)
export async function searchLinksPaginated(
  query: string,
  status: string | null,
  limit: number,
  offset: number,
) {
  const searchTerm = `%${query}%`
  const conditions = or(
    like(linksTable.originalUrl, searchTerm),
    like(linksTable.normalizedUrl, searchTerm),
    like(linksTable.domain, searchTerm),
    like(linksTable.title, searchTerm),
    like(linksTable.tags, searchTerm),
  )

  if (status) {
    return db
      .select()
      .from(linksTable)
      .where(
        and(
          eq(linksTable.status, status as (typeof linksTable.status.enumValues)[number]),
          conditions,
        ),
      )
      .orderBy(desc(linksTable.createdAt))
      .limit(limit)
      .offset(offset)
      .all()
  }

  return db
    .select()
    .from(linksTable)
    .where(conditions)
    .orderBy(desc(linksTable.createdAt))
    .limit(limit)
    .offset(offset)
    .all()
}

export async function searchLinksCount(query: string, status: string | null) {
  const searchTerm = `%${query}%`
  const conditions = or(
    like(linksTable.originalUrl, searchTerm),
    like(linksTable.normalizedUrl, searchTerm),
    like(linksTable.domain, searchTerm),
    like(linksTable.title, searchTerm),
    like(linksTable.tags, searchTerm),
  )

  if (status) {
    return db
      .select({ count: sql<number>`count(*)` })
      .from(linksTable)
      .where(
        and(
          eq(linksTable.status, status as (typeof linksTable.status.enumValues)[number]),
          conditions,
        ),
      )
      .get()
  }

  return db.select({ count: sql<number>`count(*)` }).from(linksTable).where(conditions).get()
}

// TestResult queries
export async function insertTestResult(data: typeof testResults.$inferInsert) {
  return db.insert(testResults).values(data).run()
}

export async function getTestResultsByLinkId(linkId: string) {
  return db.select().from(testResults).where(eq(testResults.linkId, linkId)).all()
}

// ImportJob queries
export async function insertImportJob(data: typeof importJobs.$inferInsert) {
  return db.insert(importJobs).values(data).run()
}

export async function updateImportJob(id: string, data: Partial<typeof importJobs.$inferInsert>) {
  return db.update(importJobs).set(data).where(eq(importJobs.id, id)).run()
}

export async function getImportJobById(id: string) {
  return db.select().from(importJobs).where(eq(importJobs.id, id)).get()
}

// TestJob queries
export async function insertTestJob(data: typeof testJobs.$inferInsert) {
  return db.insert(testJobs).values(data).run()
}

export async function updateTestJob(id: string, data: Partial<typeof testJobs.$inferInsert>) {
  return db.update(testJobs).set(data).where(eq(testJobs.id, id)).run()
}

export async function getTestJobById(id: string) {
  return db.select().from(testJobs).where(eq(testJobs.id, id)).get()
}

// Operation queries
export async function insertOperation(data: typeof operations.$inferInsert) {
  return db.insert(operations).values(data).run()
}

export async function getOperations(limit = 50, offset = 0) {
  return db
    .select()
    .from(operations)
    .orderBy(desc(operations.timestamp))
    .limit(limit)
    .offset(offset)
    .all()
}

export async function getOperationById(id: string) {
  return db.select().from(operations).where(eq(operations.id, id)).get()
}

export async function deleteOperation(id: string) {
  return db.delete(operations).where(eq(operations.id, id)).run()
}

export async function deleteAllOperations() {
  return db.delete(operations).run()
}

export async function getOperationsCount() {
  return db.select({ count: sql<number>`count(*)` }).from(operations).get()
}

// Snapshot queries
export async function insertSnapshot(data: typeof snapshots.$inferInsert) {
  return db.insert(snapshots).values(data).run()
}

export async function getLatestSnapshot() {
  return db.select().from(snapshots).orderBy(desc(snapshots.createdAt)).limit(1).get()
}

export async function getSnapshotBeforeOperation(operationId: string) {
  return db
    .select()
    .from(snapshots)
    .innerJoin(operations, sql`${operations.timestamp} < ${snapshots.createdAt}`)
    .where(eq(operations.id, operationId))
    .orderBy(desc(snapshots.createdAt))
    .limit(1)
    .get()
}
