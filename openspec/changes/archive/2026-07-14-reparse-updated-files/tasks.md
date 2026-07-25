## 1. Schema migration

- [x] 1.1 In `apps/service/src/lib/db/schema.ts`, add `sourceFile: text('source_file')` (nullable) to `linksTable` AND add `index('idx_links_source_file').on(table.sourceFile)` to the table's index list. The index is cheap insurance against full-table scans on `WHERE source_file = ?` once the links table grows past a few thousand rows; mirror the existing `idx_links_domain` pattern.
- [x] 1.2 Add `fileMtime: text('file_mtime')` (nullable) AND `isReparse: integer('is_reparse', { mode: 'boolean' }).notNull().default(false)` to `importJobs`.
- [x] 1.3 Run `pnpm --filter service exec drizzle-kit generate` to produce the migration SQL under `apps/service/drizzle/`. Verify it contains: `ALTER TABLE links ADD COLUMN source_file TEXT; ALTER TABLE import_jobs ADD COLUMN file_mtime TEXT; ALTER TABLE import_jobs ADD COLUMN is_reparse INTEGER NOT NULL DEFAULT 0;` plus `CREATE INDEX idx_links_source_file ON links(source_file);`.
- [x] 1.4 Apply the migration on a dev database (`pnpm --filter service exec drizzle-kit migrate` or the standalone migration runner); confirm columns + index via `sqlite3 data/linkman.db ".schema links"` and `".schema import_jobs"` and `.indexes links`.

## 2. Source-file attribution in the write path

- [x] 2.1 In `apps/service/src/lib/import/parse.ts`, extend `prepareUrlRecord`'s signature to accept the source filename (or thread the job's `sourceContent` through) and write it into the `sourceFile` column on the returned record.
- [x] 2.2 In `apps/service/src/routes/import.ts`, update the `prepareUrlRecord(...)` call site in `parse.batch`'s normal insert path (and the self-heal path's same call site) to pass `job.sourceContent` as the source filename.
- [x] 2.3 Verify: a fresh import + parse run produces link rows with `source_file = '<ts>-<filename>'`. Spot-check via `sqlite3 data/linkman.db "SELECT source_file, COUNT(*) FROM links GROUP BY source_file;"`.

## 3. Re-parse filtering helper

- [x] 3.1 In `apps/service/src/lib/db/queries.ts`, add `getNormalizedUrlsForSourceFile(sourceFile: string): Promise<Set<string>>` that does `SELECT normalized_url FROM links WHERE source_file = ?` and returns the result as a `Set` for O(1) membership checks. (Index `idx_links_source_file` from §1.1 makes this an index seek.)
- [x] 3.2 In `apps/service/src/lib/db/queries.ts`, add `countLinksForSourceFile(sourceFile: string): Promise<number>` that returns `SELECT COUNT(*) FROM links WHERE source_file = ?`. Used by the re-parse completion step in §5.2 to snap `importedCount` to the cumulative total.
- [x] 3.3 In `apps/service/src/lib/import/parse.ts`, add a helper `filterAgainstExisting(valid: Link[], existing: Set<string>): Link[]` that drops any `Link` whose `normalizedUrl` (computed via the same `normalizeUrl` used by `prepareUrlRecord`) is in the set.
- [x] 3.4 Add a unit-style assertion (inline at the bottom of `parse.ts` or a quick script under `apps/service/scripts/`) verifying that `filterAgainstExisting([a, b, c, d], Set([a.normalized, c.normalized]))` returns `[b, d]`.

## 4. parse.start: capture mtime, dispatch re-parse, reset counter, set flag

- [x] 4.1 In `apps/service/src/lib/files/index.ts`, add `getMtime(relativePath: string): Promise<string>` that does `fs.promises.stat(resolveFilePath(...))` and returns `stat.mtime.toISOString()`. Reuses the existing path-safety guard.
- [x] 4.2 In `apps/service/src/routes/import.ts` `parse.start`, replace the unconditional `if (job.status === 'completed') throw CONFLICT` block with:
  - Compute `currentMtime` via `getMtime(job.sourceContent)`.
  - If `status === 'completed'` AND `currentMtime === job.fileMtime` → reject `CONFLICT` ("File unchanged since last parse; nothing to do"). (Preserves the no-op guardrail.)
  - If `status === 'completed'` AND `currentMtime !== job.fileMtime` → re-parse branch:
    - If caller passed `type` or `strategy` differing from the job's stored values → reject `BAD_REQUEST` ("Re-parse must reuse the original type and strategy; delete and re-import to switch"). Strategy override would compute `normalizedUrl` differently and break the diff filter; type override would route through a different extractor.
    - Read file, extract, validate.
    - Query `existing = await getNormalizedUrlsForSourceFile(job.sourceContent)`.
    - `diff = filterAgainstExisting(valid, existing)`.
    - Cache `{ valid: diff, invalid, total: diff.length, detectedFormat }`.
    - **Atomically** update the job with: `status = 'processing'`, `importedCount = 0` (CRITICAL — see review Bug A; without this reset, the very first `parse.batch` hits `end <= start` and inserts nothing), `errorCount = invalid.length`, `fileMtime = currentMtime`, `isReparse = true`.
    - Return `{ ..., isReparse: true }`.
  - Else (status is `pending` or `processing`): first-parse branch — behave as today, BUT also set `isReparse = false` and capture `fileMtime = currentMtime` in the same update (covers the case where a job was created pre-deploy and is now parsed for the first time post-deploy).
- [x] 4.3 tsc passes after the route edits.

## 5. parse.batch: snap on completion; flag-aware self-heal

- [x] 5.1 In `apps/service/src/routes/import.ts` `parse.batch`, modify the "done" branches (both the `end <= start` early-finalize and the `end >= cached.total` normal completion) to check `job.isReparse`. If `true`, snap `importedCount` to `await countLinksForSourceFile(job.sourceContent)` in the same update that sets `status = 'completed'`. This preserves the SourcesTab "X links" display contract (e.g. 502 cumulative, not 2 diff) without changing the UI code.
- [x] 5.2 In the same `parse.batch` self-heal branch (cache-miss path), replace the previous "always re-filter" heuristic with explicit flag dispatch:
  - Read `job.isReparse` (already fetched as part of the job row).
  - If `isReparse === false`: reconstruct the full `Link[]` byte-identical to the original extraction (existing behavior; required by the "Resumable parsing after cache loss" spec). Do NOT filter.
  - If `isReparse === true`: reconstruct, then re-apply `filterAgainstExisting(valid, await getNormalizedUrlsForSourceFile(job.sourceContent))`. Rows inserted by previous batches of THIS re-parse are already in the table and drop out of the reconstructed cache; `importedCount` (reset to 0 at `parse.start`) stays valid against the filtered cache.
  - **No row-count or row-existence inference.** The persisted flag is the single source of truth.
- [x] 5.3 tsc passes for service after batch edits.

## 6. import.list / import.get payload extensions

- [x] 6.1 In `apps/service/src/routes/import.ts`, add `fileMtime: j.fileMtime` to each job entry returned by `import.list` and `import.get`. (Drizzle's inferred row type picks up the new column automatically once schema is updated; the only edit is the response mapper.)
- [x] 6.2 Do NOT expose `isReparse` in the response — it's an internal lifecycle flag, not something the UI needs. (UI derives staleness from `fileMtime` vs `files.list.modifiedAt`.)
- [x] 6.3 tsc passes for service.

## 7. Webapp: Sources tab stale detection + Re-parse button

- [x] 7.1 In `apps/webapp/src/pages/Files.tsx` `SourcesTab`, derive `staleByFilename: Map<string, boolean>` from the already-fetched `files` and `jobMap`: `stale = job.status === 'completed' && file.modifiedAt !== job.fileMtime`. Compute it inside `fetchAll` (or via `useMemo` on the two state pieces) so it refreshes on every refetch.
- [x] 7.2 Pass a `stale: boolean` prop into `ParseToolbar` (alongside the existing `job` prop). Compute it from the currently-selected file.
- [x] 7.3 In `ParseToolbar`, update the button-state matrix:
  - `isCompleted && !stale` → label "Parsed ✓", color green, disabled (unchanged).
  - `isCompleted && stale` → label "Re-parse", color blue, enabled.
  - When stale-completed, **keep** the type/strategy selectors disabled (do NOT un-disable them — re-parse rejects overrides per §4.2; enabling them in the UI would just set the user up for a BAD_REQUEST error).
- [x] 7.4 Confirm the existing `runParse` flow works unchanged for the re-parse path: it already calls `parse.start` then loops `parse.batch`. The only difference is the cache contains the filtered set; `progress.total` will reflect the post-filter count (the diff size), which is the right thing to show the user.
- [x] 7.5 After `runParse` completes (in the `finally` block), the existing `fetchAll()` call refreshes `jobMap` so the button transitions from "Re-parse" back to "Parsed ✓" (fileMtime now matches) and `importedCount` reflects the post-snap cumulative count.

## 8. Webapp: ResolvedTab refresh on tab activation

- [x] 8.1 In `FilesPage`, lift the active-tab state: `const [activeTab, setActiveTab] = useState('sources')`. Pass `value={activeTab}` and `onTabChange={setActiveTab}` to the Mantine `<Tabs>`.
- [x] 8.2 Add a `resolvedRefreshKey: number` state. Increment it in two cases: (a) `activeTab` becomes `'resolved'` (user re-enters the tab), (b) a parse completes (lift the `runParse` callback or expose an `onParseComplete` from `SourcesTab`).
- [x] 8.3 In `ResolvedTab`, replace the `fetched = useRef(false)` one-shot guard with a `useEffect([refreshKey])` that resets pagination (urls=[], total=0, offset=0) and refetches page 0.
- [ ] 8.4 Verify: parse a file in Sources → switch to Resolved → new URLs appear at the top of the list with the updated total. Switch to Export → back to Resolved → refetch fires again.

## 9. Verification

- [x] 9.1 tsc passes for both packages: `pnpm --filter service exec tsc --noEmit` && `pnpm --filter webapp exec tsc --noEmit`.
- [x] 9.2 biome check clean on all new and modified files: `pnpm exec biome check --write apps/service/src apps/webapp/src`.
- [x] 9.3 Manual e2e — first parse unaffected: import a fresh file → Parse button visible → click → progress 0→N → "Parsed ✓" green disabled. Confirms no regression.
- [x] 9.4 Manual e2e — stale detection: with the file's job in `completed`, modify the file in place (e.g., append a new URL line via a text editor) → return to Files → Sources tab → toolbar shows "Re-parse" blue enabled. Confirms mtime-based staleness.
- [ ] 9.5 Manual e2e — incremental re-parse actually inserts (Bug A regression): pre-condition file with URLs `[a, b, c]` parsed (job.importedCount = 3). Edit file to `[a, b, c, d, e]` (append two URLs). Click Re-parse → progress 0→2 → "Parsed ✓". Verify in `links` table: rows for `a, b, c` untouched; only `d, e` added (total 5 rows for this source_file). Verify `import_jobs.imported_count` snaps to 5 on completion (not 2).
- [ ] 9.6 Manual e2e — unchanged file rejected: with job in `completed` and file unchanged, attempt `parse.start` via devtools trpc call. Confirm `CONFLICT` error with the "File unchanged" message.
- [ ] 9.7 Manual e2e — strategy override on re-parse is rejected: with a stale `completed` job, call `parse.start({ jobId, strategy: 'smart' })` where the job's stored strategy is `'normalized'`. Confirm `BAD_REQUEST` error. UI selector should have been disabled, so this is a server-side guardrail test.
- [ ] 9.8 Manual e2e — ResolvedTab refresh: after the re-parse from 9.5, switch to Resolved → confirm `d` and `e` appear at the top of the list and the total count increased by 2.
- [ ] 9.9 Manual e2e — resume an interrupted FIRST-TIME parse (Bug B regression guard): mid-first-parse of a large fresh file (kill service after a few batches succeed). Restart service. Click Resume on the Sources toolbar. Confirm: reconstruction does NOT apply the diff filter (because `isReparse = 0`); the slice `[importedCount, +batchSize)` produces a byte-identical continuation; no URLs are dropped; the import completes with the full count.
- [ ] 9.10 Manual e2e — resume an interrupted RE-PARSE: mid-re-parse of a large diff (kill service after some diff batches succeed). Restart service. Click Resume. Confirm: reconstruction re-applies the diff filter (because `isReparse = 1`); rows already inserted by prior batches of this re-parse drop out of the reconstructed cache; the slice progresses correctly and only the remaining diff URLs get inserted; no duplicates.
- [ ] 9.11 Manual e2e — legacy rows: pre-condition: a job from before this deploy (its link rows have `source_file = NULL`). Edit the file, click Re-parse. Confirm: every URL in the file gets re-inserted (because the `WHERE source_file = ?` filter finds zero matches — index seek returns empty). Run deduplicate afterward to collapse. Document this as expected one-time post-deploy behavior.
- [x] 9.12 Manual e2e — index used: `EXPLAIN QUERY PLAN SELECT normalized_url FROM links WHERE source_file = 'X';` against a populated dev DB shows "SEARCH links USING INDEX idx_links_source_file" rather than "SCAN links".
