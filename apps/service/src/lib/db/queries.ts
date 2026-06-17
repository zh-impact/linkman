import { and, desc, eq, inArray, isNotNull, like, or, sql } from 'drizzle-orm'
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
  const BATCH = 500
  for (let i = 0; i < ids.length; i += BATCH) {
    await db
      .delete(linksTable)
      .where(inArray(linksTable.id, ids.slice(i, i + BATCH)))
      .run()
  }
}

export async function updateLinksStatusByIds(
  ids: string[],
  data: Partial<typeof linksTable.$inferInsert>,
) {
  if (ids.length === 0) return
  const BATCH = 500
  for (let i = 0; i < ids.length; i += BATCH) {
    await db
      .update(linksTable)
      .set(data)
      .where(inArray(linksTable.id, ids.slice(i, i + BATCH)))
      .run()
  }
}

export async function getLinkById(id: string) {
  return db.select().from(linksTable).where(eq(linksTable.id, id)).get()
}

export async function getAllLinks() {
  return db.select().from(linksTable).all()
}

export type AnalysisLink = {
  id: string
  originalUrl: string
  normalizedUrl: string
  domain: string
}

/** Get only the columns needed for dedup/filter analysis, excluding already-removed links. */
export async function getActiveLinksForAnalysis(): Promise<AnalysisLink[]> {
  return db
    .select({
      id: linksTable.id,
      originalUrl: linksTable.originalUrl,
      normalizedUrl: linksTable.normalizedUrl,
      domain: linksTable.domain,
    })
    .from(linksTable)
    .where(
      sql`${linksTable.status} NOT IN ('duplicate_removed', 'filtered_internal', 'filtered_similar')`,
    )
    .all()
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

/**
 * Look up a job by its source filename (stored in `source_content`).
 * Used by `import.ensureJob` to detect existing jobs for orphaned files.
 */
export async function getImportJobByFilename(filename: string) {
  return db.select().from(importJobs).where(eq(importJobs.sourceContent, filename)).get()
}

/**
 * Atomically increment job counters. Safe under concurrent parse.batch calls
 * because SQLite serializes writes and the increment is a single statement.
 */
export async function incrementImportJob(id: string, importedDelta: number, errorDelta: number) {
  return db
    .update(importJobs)
    .set({
      importedCount: sql`${importJobs.importedCount} + ${importedDelta}`,
      errorCount: sql`${importJobs.errorCount} + ${errorDelta}`,
    })
    .where(eq(importJobs.id, id))
    .run()
}

export async function listImportJobs() {
  return db.select().from(importJobs).orderBy(desc(importJobs.createdAt)).all()
}

export async function sampleImportJobs(limit = 10) {
  return db
    .select({
      id: importJobs.id,
      type: importJobs.type,
      sourceContent: importJobs.sourceContent,
      strategy: importJobs.strategy,
      status: importJobs.status,
      importedCount: importJobs.importedCount,
      createdAt: importJobs.createdAt,
    })
    .from(importJobs)
    .orderBy(desc(importJobs.createdAt))
    .limit(limit)
    .all()
}

/**
 * Delete import_jobs whose `source_content` matches one of the given filenames.
 * Used by the Files prune execute to remove job rows for deleted files.
 */
export async function deleteImportJobsByFilenames(filenames: string[]) {
  if (filenames.length === 0) return 0
  const result = await db
    .delete(importJobs)
    .where(inArray(importJobs.sourceContent, filenames))
    .run()
  return result.rowsAffected
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

// --- Audit-history prune helpers ---
// Used by the `audit` prune kind (design.md D10) to clear operations + snapshots
// in a single transaction. Independent of the `database` prune kind, which
// intentionally preserves audit history.

export async function countAllSnapshots() {
  return db.select({ count: sql<number>`count(*)` }).from(snapshots).get()
}

export async function sampleOperations(limit = 10) {
  return db
    .select({
      id: operations.id,
      type: operations.type,
      jobId: operations.jobId,
      timestamp: operations.timestamp,
      statsInputCount: operations.statsInputCount,
      statsOutputCount: operations.statsOutputCount,
    })
    .from(operations)
    .orderBy(desc(operations.timestamp))
    .limit(limit)
    .all()
}

export async function sampleSnapshots(limit = 10) {
  return db
    .select({
      id: snapshots.id,
      createdAt: snapshots.createdAt,
      linkCount: sql<number>`json_array_length(${snapshots.linkIds})`,
    })
    .from(snapshots)
    .orderBy(desc(snapshots.createdAt))
    .limit(limit)
    .all()
}

export async function deleteAllSnapshots() {
  const result = await db.delete(snapshots).run()
  return result.rowsAffected
}

/**
 * Clear `operations` and `snapshots` in a single transaction. Neither table
 * is referenced by foreign keys from elsewhere, so no cascades apply.
 */
export async function clearAuditHistory() {
  return db.transaction(async (tx) => {
    const opsResult = await tx.delete(operations).run()
    const snapshotsResult = await tx.delete(snapshots).run()
    return {
      operationsDeleted: opsResult.rowsAffected,
      snapshotsDeleted: snapshotsResult.rowsAffected,
    }
  })
}

// ============================================================================
// Prune helpers
//
// All count helpers return `{ count: number } | undefined` (drizzle `.get()`
// returns undefined on empty result). All delete helpers return the SQLite
// `changes` count — number of rows actually removed.
//
// test_results.linkId has `onDelete: 'cascade'`, so deleting links automatically
// removes their test_results. The cascade-count helpers below are purely for
// dryRun preview display — they tell the user "this will also delete N test
// results" before they confirm.
// ============================================================================

// --- Counts (links layer) ---

export async function countDuplicateLinks() {
  return db
    .select({ count: sql<number>`count(*)` })
    .from(linksTable)
    .where(isNotNull(linksTable.duplicateOf))
    .get()
}

export async function countInternalLinks() {
  return db
    .select({ count: sql<number>`count(*)` })
    .from(linksTable)
    .where(eq(linksTable.isInternal, true))
    .get()
}

export async function countLinksByDomains(domains: string[]) {
  if (domains.length === 0) return { count: 0 }
  return db
    .select({ count: sql<number>`count(*)` })
    .from(linksTable)
    .where(inArray(linksTable.domain, domains))
    .get()
}

export async function countAllLinks() {
  return db.select({ count: sql<number>`count(*)` }).from(linksTable).get()
}

export async function countAllImportJobs() {
  return db.select({ count: sql<number>`count(*)` }).from(importJobs).get()
}

export async function listDomainsWithCounts() {
  return db
    .select({ domain: linksTable.domain, count: sql<number>`count(*)` })
    .from(linksTable)
    .groupBy(linksTable.domain)
    .orderBy(desc(sql<number>`count(*)`))
    .all()
}

// --- Cascade counts (test_results joined to filtered links) ---

export async function countTestResultsForDuplicateLinks() {
  return db
    .select({ count: sql<number>`count(*)` })
    .from(testResults)
    .innerJoin(linksTable, eq(testResults.linkId, linksTable.id))
    .where(isNotNull(linksTable.duplicateOf))
    .get()
}

export async function countTestResultsForInternalLinks() {
  return db
    .select({ count: sql<number>`count(*)` })
    .from(testResults)
    .innerJoin(linksTable, eq(testResults.linkId, linksTable.id))
    .where(eq(linksTable.isInternal, true))
    .get()
}

export async function countTestResultsForDomains(domains: string[]) {
  if (domains.length === 0) return { count: 0 }
  return db
    .select({ count: sql<number>`count(*)` })
    .from(testResults)
    .innerJoin(linksTable, eq(testResults.linkId, linksTable.id))
    .where(inArray(linksTable.domain, domains))
    .get()
}

export async function countAllTestResults() {
  return db.select({ count: sql<number>`count(*)` }).from(testResults).get()
}

// --- Samples (first N by createdAt desc, for dryRun preview) ---

const PRUNE_SAMPLE_LIMIT = 10

export async function sampleDuplicateLinks(limit = PRUNE_SAMPLE_LIMIT) {
  return db
    .select({
      id: linksTable.id,
      originalUrl: linksTable.originalUrl,
      domain: linksTable.domain,
      status: linksTable.status,
      duplicateOf: linksTable.duplicateOf,
      createdAt: linksTable.createdAt,
    })
    .from(linksTable)
    .where(isNotNull(linksTable.duplicateOf))
    .orderBy(desc(linksTable.createdAt))
    .limit(limit)
    .all()
}

export async function sampleInternalLinks(limit = PRUNE_SAMPLE_LIMIT) {
  return db
    .select({
      id: linksTable.id,
      originalUrl: linksTable.originalUrl,
      domain: linksTable.domain,
      status: linksTable.status,
      createdAt: linksTable.createdAt,
    })
    .from(linksTable)
    .where(eq(linksTable.isInternal, true))
    .orderBy(desc(linksTable.createdAt))
    .limit(limit)
    .all()
}

export async function sampleLinksByDomains(domains: string[], limit = PRUNE_SAMPLE_LIMIT) {
  if (domains.length === 0) return []
  return db
    .select({
      id: linksTable.id,
      originalUrl: linksTable.originalUrl,
      domain: linksTable.domain,
      status: linksTable.status,
      createdAt: linksTable.createdAt,
    })
    .from(linksTable)
    .where(inArray(linksTable.domain, domains))
    .orderBy(desc(linksTable.createdAt))
    .limit(limit)
    .all()
}

export async function sampleAllLinks(limit = PRUNE_SAMPLE_LIMIT) {
  return db
    .select({
      id: linksTable.id,
      originalUrl: linksTable.originalUrl,
      domain: linksTable.domain,
      status: linksTable.status,
      createdAt: linksTable.createdAt,
    })
    .from(linksTable)
    .orderBy(desc(linksTable.createdAt))
    .limit(limit)
    .all()
}

// --- Deletes (return number of rows removed) ---

export async function deleteDuplicateLinks() {
  const result = await db.delete(linksTable).where(isNotNull(linksTable.duplicateOf)).run()
  return result.rowsAffected
}

export async function deleteInternalLinks() {
  const result = await db.delete(linksTable).where(eq(linksTable.isInternal, true)).run()
  return result.rowsAffected
}

export async function deleteLinksByDomains(domains: string[]) {
  if (domains.length === 0) return 0
  // inArray on domain — domains list is small enough (bounded by user selection)
  // that a single statement is fine. No need for the 500-row batch pattern
  // used by deleteLinksByIds (which exists for very large id arrays).
  const result = await db.delete(linksTable).where(inArray(linksTable.domain, domains)).run()
  return result.rowsAffected
}

export async function deleteAllLinks() {
  const result = await db.delete(linksTable).run()
  return result.rowsAffected
}

// --- Database prune: atomic clear of links + import_jobs ---

/**
 * Clear the `links` and `import_jobs` tables in a single transaction.
 * Preserves `operations` and `snapshots` (audit history). Cascades
 * `test_results` via FK on link deletion. Returns the row counts removed.
 */
export async function clearLinksAndImportJobs() {
  return db.transaction(async (tx) => {
    const linksResult = await tx.delete(linksTable).run()
    const jobsResult = await tx.delete(importJobs).run()
    return { linksDeleted: linksResult.rowsAffected, jobsDeleted: jobsResult.rowsAffected }
  })
}
