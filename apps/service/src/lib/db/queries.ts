import { and, type Column, desc, eq, inArray, isNotNull, like, or, type SQL, sql } from 'drizzle-orm'
import { PREFIXES, type Prefix, parseSearchQuery } from '../url/parse-search-query'
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

export async function updateLinksStatusByIds(ids: string[], data: Partial<typeof linksTable.$inferInsert>) {
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
    .where(sql`${linksTable.status} NOT IN ('duplicate_removed', 'filtered_internal', 'filtered_similar')`)
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
  return db.select().from(linksTable).orderBy(desc(linksTable.createdAt)).limit(limit).offset(offset).all()
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

/**
 * UI-selected URL components for advanced search targeting. When all flags
 * are false (or undefined), bare terms match all four components (D4 default).
 * `undefined` (vs. an all-false object) signals "no advanced UI active" — used
 * to short-circuit to the legacy free-text path when no prefixed terms are
 * present either.
 */
export interface SearchTargeting {
  host?: boolean
  path?: boolean
  search?: boolean
  hash?: boolean
}

/** True iff the parsed query contains at least one recognized prefixed term. */
function hasPrefixed(parsed: ReturnType<typeof parseSearchQuery>): boolean {
  return PREFIXES.some((p) => parsed.prefixed[p]?.length)
}

/**
 * True iff the targeting selection is "default-like" — i.e., the user has not
 * meaningfully narrowed. Covers three cases:
 *  - `undefined`: caller omitted searchParts entirely (Advanced off).
 *  - All four `true`: caller passed searchParts=['host','path','search','hash']
 *    (Advanced on with default selection — user hasn't unchecked anything).
 *  - All four `false`: caller passed searchParts=[] (Advanced on with
 *    everything unchecked — per spec scenario "Empty selection is treated as
 *    all-components" this is equivalent to the default).
 *
 * In all three cases we use legacy free-text search (URL + title + tags) so
 * behavior is byte-identical to pre-change. As soon as the user narrows
 * (unchecks some but not all) OR uses power-user syntax (prefixed terms),
 * we switch to advanced mode (URL parts only, per design D2).
 */
function isDefaultLikeTargeting(targeting: SearchTargeting | undefined): boolean {
  if (targeting === undefined) return true
  const allTrue =
    targeting.host === true && targeting.path === true && targeting.search === true && targeting.hash === true
  const allFalse =
    targeting.host === false &&
    targeting.path === false &&
    targeting.search === false &&
    targeting.hash === false
  return allTrue || allFalse
}

/**
 * Build the WHERE conditions for advanced URL-component search.
 *
 * Returns null when the request is in "legacy mode" (no targeting and no
 * prefixed terms in the query string) — callers should then fall back to the
 * original flat LIKE over `originalUrl | normalizedUrl | domain | title | tags`.
 */
function buildAdvancedConditions(
  parsed: ReturnType<typeof parseSearchQuery>,
  targeting: SearchTargeting | undefined,
): SQL | undefined {
  // Map a prefix to its LIKE column. `host` uses `domain` (the existing column
  // already populated for every row at write time). The other three map to the
  // new dedicated columns.
  const partColumn: Record<Prefix, Column> = {
    host: linksTable.domain,
    path: linksTable.urlPath,
    search: linksTable.urlQuery,
    hash: linksTable.urlHash,
  }

  // Default bare-term targeting is all four parts (D4). When targeting is
  // provided (caller passed searchParts), filter to the true-selected ones;
  // empty selection falls back to all four.
  const selectedParts: Prefix[] =
    targeting !== undefined ? PREFIXES.filter((p) => targeting?.[p] === true) : [...PREFIXES]
  const effectiveParts: Prefix[] = selectedParts.length > 0 ? selectedParts : [...PREFIXES]

  const clauses: SQL[] = []

  // Helper: invalid-URL fallback for a single search value (D5). Malformed
  // URLs (where `new URL(originalUrl)` throws) have url_path/url_query/
  // url_hash all NULL — those rows must still match if originalUrl contains
  // the value as a substring, regardless of which components the user
  // targeted. Always applied per term (no condition skips it). Uses `sql\`...\``
  // directly so the result is `SQL` (not `SQL | undefined` from `and()`),
  // avoiding any narrowing dance at the push sites.
  const invalidUrlFallback = (value: string): SQL =>
    sql`${linksTable.urlPath} IS NULL AND ${like(linksTable.originalUrl, `%${value}%`)}`

  // Prefixed terms: same-prefix OR, cross-prefix AND. Implementation:
  //   AND across different prefixes — outer AND of per-prefix OR-groups.
  //   OR within same prefix — each value contributes one LIKE.
  // Also OR in the invalid-URL fallback for each prefixed value (so malformed
  // rows are searchable by host:text etc. too).
  for (const prefix of PREFIXES) {
    const values = parsed.prefixed[prefix]
    if (!values || values.length === 0) continue
    const groupClauses: SQL[] = values.map((v) => like(partColumn[prefix], `%${v}%`) as SQL)
    for (const v of values) groupClauses.push(invalidUrlFallback(v))
    const joined = groupClauses.length === 1 ? groupClauses[0] : or(...groupClauses)
    if (joined) clauses.push(joined)
  }

  // Bare terms: each term produces one OR-group (OR across selected parts plus
  // invalid-URL fallback). The outer `and(...clauses)` then ANDs these groups
  // together — so `foo bar` matches rows where (some part contains 'foo') AND
  // (some part contains 'bar'). This differs from legacy free-text search,
  // which treats `foo bar` as one literal substring. The split is intentional:
  // advanced mode is opt-in, and AND-ing bare terms is the more useful
  // interpretation for multi-word queries.
  for (const term of parsed.bare) {
    const bareClauses: SQL[] = effectiveParts.map((p) => like(partColumn[p], `%${term}%`) as SQL)
    bareClauses.push(invalidUrlFallback(term))
    const joined = bareClauses.length === 1 ? bareClauses[0] : or(...bareClauses)
    if (joined) clauses.push(joined)
  }

  if (clauses.length === 0) return undefined
  if (clauses.length === 1) return clauses[0]
  return and(...clauses)
}

/** Legacy free-text LIKE across originalUrl/normalizedUrl/domain/title/tags. */
function buildLegacyConditions(query: string): SQL {
  const searchTerm = `%${query}%`
  const legacy = or(
    like(linksTable.originalUrl, searchTerm),
    like(linksTable.normalizedUrl, searchTerm),
    like(linksTable.domain, searchTerm),
    like(linksTable.title, searchTerm),
    like(linksTable.tags, searchTerm),
  )
  // legacy is `SQL | undefined` per drizzle types, but with 5 args it's always defined.
  return legacy ?? sql`1=1`
}

/**
 * Resolve the final WHERE clause for a search. Returns undefined when there is
 * nothing to apply (caller treats as "no filter").
 *
 * Modes:
 *  - Legacy (byte-identical to pre-change): no prefixed terms in the query
 *    AND targeting is "default-like" (undefined, all-true, or all-false).
 *    Matches `originalUrl | normalizedUrl | domain | title | tags`.
 *  - Advanced (URL parts only, per design D2): when the user has narrowed
 *    (mixed true/false targeting) OR used power-user syntax (prefixed terms).
 *    Matches `domain | urlPath | urlQuery | urlHash` + invalid-URL fallback.
 *
 * Rationale: the user's mental model is "Advanced is a switch for narrowing".
 * If they haven't narrowed (default selection OR degenerate empty selection),
 * behavior must match pre-change exactly — including title/tags matches.
 * Narrowing or power-user syntax opts into URL-only mode.
 */
function resolveSearchConditions(query: string, targeting: SearchTargeting | undefined): SQL | undefined {
  const parsed = parseSearchQuery(query)
  const hasAnyPrefixed = hasPrefixed(parsed)

  if (!hasAnyPrefixed && isDefaultLikeTargeting(targeting)) {
    return buildLegacyConditions(query)
  }

  return buildAdvancedConditions(parsed, targeting)
}

// Search links with pagination (optionally filtered by status first)
export async function searchLinksPaginated(
  query: string,
  status: string | null,
  limit: number,
  offset: number,
  targeting?: SearchTargeting,
) {
  const conditions = resolveSearchConditions(query, targeting)

  if (status) {
    return db
      .select()
      .from(linksTable)
      .where(and(eq(linksTable.status, status as (typeof linksTable.status.enumValues)[number]), conditions))
      .orderBy(desc(linksTable.createdAt))
      .limit(limit)
      .offset(offset)
      .all()
  }

  return db
    .select()
    .from(linksTable)
    .where(conditions ?? sql`1=1`)
    .orderBy(desc(linksTable.createdAt))
    .limit(limit)
    .offset(offset)
    .all()
}

export async function searchLinksCount(query: string, status: string | null, targeting?: SearchTargeting) {
  const conditions = resolveSearchConditions(query, targeting)

  if (status) {
    return db
      .select({ count: sql<number>`count(*)` })
      .from(linksTable)
      .where(and(eq(linksTable.status, status as (typeof linksTable.status.enumValues)[number]), conditions))
      .get()
  }

  return db
    .select({ count: sql<number>`count(*)` })
    .from(linksTable)
    .where(conditions ?? sql`1=1`)
    .get()
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
  const result = await db.delete(importJobs).where(inArray(importJobs.sourceContent, filenames)).run()
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
  return db.select().from(operations).orderBy(desc(operations.timestamp)).limit(limit).offset(offset).all()
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
