## Context

The two-step pipeline (import writes file → parse inserts links) was designed around immutable source files. In practice users edit files in place — re-pasting a clipboard dump, refreshing a bookmark export, appending to a curated URL list. Today this breaks in three ways:

1. `import.parse.start` rejects any job whose status is `completed` (`apps/service/src/routes/import.ts:106-111`), so the user is stuck.
2. `ResolvedTab` caches its first fetch via a `useRef(false)` guard (`apps/webapp/src/pages/Files.tsx:665,687-688`); switching tabs away and back does not refetch.
3. `SourcesTab` displays `status === 'completed'` as a green dot + "Parsed ✓" disabled button with no awareness of the file's current mtime vs. when the parse ran.

There is also no per-file attribution on `linksTable`. The `source` column is `TXT | JSON` (the *type*), not the filename. So "what's already inserted from THIS file" cannot be answered today — re-parsing the same file would insert every URL again, producing duplicates that only the separate `deduplicate` phase can collapse.

**Constraints**:

- No new third-party dependencies.
- Backwards-compatible API: existing callers that don't pass new fields keep working.
- Non-destructive: the user explicitly asked for "只新增变化的部分" — do NOT delete previously-parsed rows that disappeared from the file.
- Drizzle + libSQL/SQLite supports `ALTER TABLE ADD COLUMN` cheaply; `DROP COLUMN` is supported on SQLite ≥ 3.35.

## Goals / Non-Goals

**Goals**:

- Detect file content changes via mtime; expose staleness so the UI can opt into re-parse.
- Allow `parse.start` to re-open a `completed` job iff the file's current mtime differs from the stored one.
- On re-parse, insert only URLs not already present for THIS source file (incremental insert; no duplicates).
- `ResolvedTab` reflects the latest DB state when the user enters the tab.
- Backwards-compatible: existing callers see no behavior change until they opt in.

**Non-Goals**:

- NOT deleting previously-parsed URLs that vanished from the file (out of scope; user explicitly wanted additive only).
- NOT adding file-watching / push notifications. Staleness is computed on-demand when the user views the Sources tab or selects a file.
- NOT content hashing — mtime is the staleness signal. Hashing every file on tab load is wasteful for 4MB+ bookmark dumps; mtime updates reliably on macOS APFS for any in-place edit.
- NOT backfilling `sourceFile` for pre-existing `linksTable` rows. The information doesn't exist. Pre-change files' first re-parse after deploy may over-insert (one-time cost; user can run dedup to collapse).
- NOT changing the existing dedup phase. Re-parse produces rows that look identical to first-parse rows from the dedup phase's perspective.

## Decisions

### D1: Track staleness via `import_jobs.fileMtime`, not via content hash

**Why**: mtime comparison is O(1) `stat()` per file and updates reliably on every reasonable editor / `cp` / `tee` / clipboard-write path on macOS APFS and Linux ext4. Content hashing would force re-reading multi-MB files on every `import.list` call just to surface a stale badge.

**Storage**: add `import_jobs.fileMtime TEXT` (ISO 8601 string). Captured from `fs.stat` at the moment `parse.start` reads the file. Updated on every successful `parse.start` (first parse or re-parse).

**Stale predicate**: `currentFileMtime !== job.fileMtime` (string inequality). Both values are ISO strings from `mtime.toISOString()`.

**Alternative considered**: content hash (SHA-1 of file bytes). Rejected — the cost outweighs the rare mtime-collision risk (a tool that rewrites the file in place within the same second AND preserves mtime).

### D2: Per-source-file attribution via `links.sourceFile`

**Why**: to compute "URLs already inserted from THIS file" we need a column that ties each link row to its source filename. The existing `source` column is `TXT | JSON` (the extractor type), not the filename. Adding `links.sourceFile TEXT` (nullable) makes the query `SELECT normalizedUrl FROM links WHERE sourceFile = ?` cheap and unambiguous.

**Schema**: `links.sourceFile TEXT NULL` + a b-tree index `idx_links_source_file` on the column. Populated by `prepareUrlRecord` from the job's `sourceContent`. NULL for legacy rows (backfill not possible — info doesn't exist).

**Why index the column**: even though the per-file rowset is "bounded by job size" in concept, SQLite still executes `WHERE source_file = ?` as a full table scan without an index. At the README's documented scale of ~500k links, that scan runs on every re-parse click and every self-heal reconstruction. The index is cheap to add now (one column, one index in the same migration) and expensive to retrofit once the table is large; we mirror the existing pattern of `idx_links_domain`, `idx_links_status`, etc.

**Filter logic on re-parse** (revised after review — see D7 for why `importedCount` and `isReparse` matter):
```
extractedUrls → validate → partition(extracted, existing WHERE sourceFile = job.sourceContent)
                                                  ↓
                          cache = newUrls (extracted minus existing by normalizedUrl)
                          SET job: importedCount = 0, errorCount = invalid.length,
                                  fileMtime = currentMtime, isReparse = 1, status = 'processing'
                          cache.total = cache.valid.length
```

The existing `parse.batch` slice logic `[importedCount, importedCount + batchSize)` then naturally iterates only the new URLs because `importedCount` was reset to 0 at re-parse start. See D7 for the snap-to-cumulative step on completion.

**Edge case — partial re-parse then file changes again**: if a re-parse is interrupted mid-way (cache lost, service restart), the self-heal path re-extracts and re-filters against the current DB state. `job.isReparse === 1` (D7) tells self-heal to apply the filter; rows inserted by previous batches of the same re-parse are now in `existing`, so the reconstructed cache shrinks accordingly. Idempotent.

**Alternative considered**: wiping `links WHERE sourceFile = job.sourceContent` at re-parse start and re-inserting everything. Rejected — destructive (loses dedup tags, status transitions, etc. on previously-parsed rows) and contradicts user's "只新增变化的部分".

### D3: Re-parse API contract — same `parse.start` / `parse.batch`, narrower CONFLICT

**Why**: introducing a new `parse.reparse` endpoint would split the batch loop's URL construction across two code paths. Better to relax the existing `parse.start` rejection rule.

**New `parse.start` rule**:
- `status === 'pending'` or `status === 'processing'` → behave as today (first-parse path).
- `status === 'completed'` AND `currentFileMtime === job.fileMtime` → reject `CONFLICT` ("File unchanged since last parse; nothing to do"). This preserves the "user shouldn't no-op re-parse" guardrail.
- `status === 'completed'` AND `currentFileMtime !== job.fileMtime` → re-parse:
  - Reject if caller passed `type` or `strategy` differing from the job's stored values (see "Strategy / type override" below).
  - Read file, extract URLs, validate.
  - Query existing `normalizedUrl WHERE sourceFile = job.sourceContent`, drop matching URLs from the valid list. The result is the diff cache.
  - Update job atomically: `status = 'processing'`, `importedCount = 0` (reset, see D7), `errorCount = invalid.length`, `fileMtime = currentMtime`, `isReparse = 1` (see D7).
  - Cache the diff; `cache.total = diff.length`.
  - Return `{ totalValid: diff.length, invalidCount, isReparse: true }`.

**Strategy / type override on re-parse is forbidden**: changing `strategy` between the original parse and a re-parse would compute `normalizedUrl` differently for the same input — a URL inserted under `'normalized'` could normalize to a different string under `'smart'`, causing the diff filter to treat it as "new" and insert a duplicate. Changing `type` would route through a different extractor branch and produce a different `Link[]` entirely. The original "Override type or strategy at parse start" scenario (in `openspec/specs/link-parse/spec.md`) is preserved for non-`completed` jobs but explicitly does NOT apply on re-parse. If the user wants a different strategy or type, they must delete the job and re-import.

**Self-heal consistency**: the cache reconstruction path inside `parse.batch` (used after service restart) consults `job.isReparse` (D7) to decide whether to re-apply the source-file filter. No inference from row counts or row existence — the flag is the single source of truth.

**Alternative considered**: a separate `parse.rerun` endpoint. Rejected — duplicates the batch-loop contract.

### D4: `import.list` / `import.get` expose `fileMtime`; UI computes staleness

**Why**: avoid N stat calls on the server every time the Sources tab loads. `files.list` already returns `modifiedAt` for each file, and `import.list` already returns each job's metadata. The webapp already does `Promise.all([files.list, import.list])` in `fetchAll`. Adding `fileMtime` to the job payload lets the client compute `stale = file.modifiedAt !== job.fileMtime` for free.

**Payload additions**:
- `import.list` / `import.get` add `fileMtime: string | null` per job.
- `parse.start` response adds `isReparse: boolean` (false for first parse, true when triggered by staleness).

**UI staleness state**: derived, not stored. Computed on every `fetchAll` and on every file-selection change.

### D5: `ResolvedTab` refetch on tab activation

**Why**: the current `fetched = useRef(false)` guard is a one-shot per mount. After a parse completes, the user switching to Resolved sees nothing new. The fix is to refetch whenever the Resolved tab becomes active — Mantine `Tabs` exposes `onTabChange` for this.

**Behavior**:
- `FilesPage` tracks `activeTab` state.
- `ResolvedTab` receives a `refreshKey: number` prop. The parent increments it whenever (a) the user activates the Resolved tab, or (b) a parse completes.
- `ResolvedTab` `useEffect([refreshKey])` refetches page 0 and resets pagination.

**Alternative considered**: pass an explicit `onInvalidate` callback that SourcesTab calls after parse. Rejected — couples two tabs; tab-activation is simpler and covers the "user re-enters Resolved later" case for free.

### D6: Toolbar UX — "Re-parse" replaces "Parsed ✓" when stale

**Why**: when the user sees a green "Parsed ✓" disabled button, the natural conclusion is "nothing more I can do". Showing an enabled "Re-parse" button (blue) when stale signals "we noticed the file changed; click to pick up the diff".

**Button states**:
| status | stale | isRunning | label | color | disabled |
|--------|-------|-----------|-------|-------|----------|
| pending | — | false | Parse | blue | no |
| processing | — | false | Resume | blue | no |
| completed | false | false | Parsed ✓ | green | yes |
| completed | true | false | Re-parse | blue | no |
| any | — | true | Stop / Parsing… | red / blue | varies |

The type/strategy selectors stay **disabled** when stale-completed. Per D3, override is forbidden on re-parse, so allowing the UI to change them would only set up the user for a CONFLICT rejection.

### D7: Persisted `isReparse` flag + `importedCount` reset/snap (review corrections)

**Why**: two correctness bugs surfaced in review:
1. **Bug A — silent no-op**: if `parse.start` shrinks the cache to the diff but leaves `job.importedCount` at the original total (e.g. 500), the very first `parse.batch` computes `end = min(500 + batchSize, 2) = 2`, hits `end <= start`, and finalizes immediately without inserting anything.
2. **Bug B — self-heal mis-classification**: inferring "this is a re-parse" from the existence of rows with `source_file = job.sourceContent` is unreliable. A first-time parse that has run even one successful batch already has such rows. On service restart mid-first-parse, self-heal would mis-classify, apply the diff filter, shrink the reconstructed cache below `job.importedCount`, and trigger the same early-exit. This would regress the existing "Resumable parsing after cache loss" requirement.

Both bugs share a root cause: no explicit signal distinguishing first-parse from re-parse, and no counter reset when entering diff-only mode.

**Schema addition**: `import_jobs.isReparse INTEGER NOT NULL DEFAULT 0` (boolean). Set to `1` at `parse.start` when taking the re-parse branch; set to `0` when taking the first-parse branch. Never reset by any other code path.

**`importedCount` lifecycle** (revised):
- First-parse: unchanged. Walks `0 → totalValid` as batches insert.
- Re-parse: **reset to `0`** at `parse.start`. Walks `0 → diff.length` as batches insert the diff.
- **On re-parse completion**: snap `importedCount` to the cumulative count `SELECT COUNT(*) FROM links WHERE source_file = ?` so the UI's "X links" indicator reflects the total rows for this file (e.g. 502 = 500 original + 2 diff), not just the most recent run's diff size. This keeps the SourcesTab display contract ("Completed = total link count for this file") intact without changing the UI code.

**Self-heal disambiguation** (revised): `parse.batch`'s cache-miss path reads `job.isReparse`:
- `isReparse === 0` → reconstruct the full `Link[]` from the source file (byte-identical to original extraction, per the existing "Resumable parsing after cache loss" requirement). Do NOT filter.
- `isReparse === 1` → reconstruct, then re-apply the source-file-scoped diff filter against current `linksTable` state. Rows inserted by previous batches of the same re-parse are already in the table, so they drop out of the reconstructed cache. `job.importedCount` reflects only this re-parse's progress (was reset at start), so the `[importedCount, +batchSize)` slice stays valid against the filtered cache.

**Why a column instead of inferring from `completedAt` / row existence / etc.**: explicit state is robust to future changes in the lifecycle (e.g., a future "re-parse-from-scratch" mode that wipes rows). Inference is fragile. One column, one source of truth.

**Alternative considered**: store a `reparseBaselineCount` column instead, and compute the slice as `[importedCount - baseline, importedCount - baseline + batchSize)`. Rejected — keeps `importedCount` cumulative but complicates every batch math, and the snap-on-completion step still needs a separate mechanism for the UI count.

## Risks / Trade-offs

**[R1] Legacy rows have `sourceFile = NULL`**. First re-parse of an old file after deploy sees zero matching rows in the "existing for this file" query, treats every URL as new, and inserts duplicates of URLs the old parse already produced.
→ Mitigation: documented in the migration plan. User can run `deduplicate.preview + execute` after the first post-deploy re-parse to collapse. Acceptable one-time cost.

**[R2] mtime collisions are possible in theory**. A tool that rewrites a file within the same second AND explicitly preserves mtime would be missed.
→ Mitigation: extremely rare in practice (most editors and `cp` update mtime). User can force a re-parse by deleting the job row (existing recovery path). Not worth a hash-based mitigation.

**[R3] Cache reconstruction on restart must re-apply the source-file filter ONLY when the job is in re-parse mode**. If the cache is lost mid-re-parse, `parse.batch`'s self-heal path must re-extract AND re-filter; if lost mid-first-parse, it must re-extract without filtering (per the existing "Resumable parsing after cache loss" requirement).
→ Mitigation: the self-heal code path reads `job.isReparse` (D7) to decide which branch to take. No inference from row counts. Single source of truth.

**[R4] `ResolvedTab` refetch on every tab activation could thrash the server** if the user rapid-clicks tabs.
→ Mitigation: the `files.resolved` query is paginated and indexed; 500-row pages are cheap. If it becomes a problem, add a debounce or a "refetch at most every N seconds" guard.

**[R5] Re-parse does not surface disappeared URLs to the user**. If a user removed a URL from the file expecting it to be removed from the DB, they'll be surprised.
→ Mitigation: explicit Non-Goal. The spec calls this out as additive-only. A future change could add a "mirror" mode that wipes-and-reinserts if needed.

**[R6] Strategy or type override on re-parse would silently insert duplicates**. A URL inserted under `'normalized'` strategy normalizes differently under `'smart'`; the diff filter (keyed on `normalizedUrl`) would treat it as new and re-insert, producing a duplicate row that only the dedup phase can collapse.
→ Mitigation: re-parse rejects `type`/`strategy` overrides (D3). The UI disables the selectors when stale-completed. If the user genuinely wants a different strategy, they delete the job and re-import.

## Migration Plan

1. **Schema migration (Drizzle)**: `ALTER TABLE links ADD COLUMN source_file TEXT; ALTER TABLE import_jobs ADD COLUMN file_mtime TEXT; ALTER TABLE import_jobs ADD COLUMN is_reparse INTEGER NOT NULL DEFAULT 0;` plus `CREATE INDEX idx_links_source_file ON links(source_file);`. No data backfill.
2. **Code deploy**: `prepareUrlRecord` populates `sourceFile`; `parse.start` captures mtime; re-parse branch active.
3. **Webapp deploy**: SourcesTab shows stale indicator + Re-parse; ResolvedTab refetches on activation.
4. **One-time user action**: for any pre-deploy file the user re-parses, run deduplicate afterward to collapse R1 duplicates.

**Rollback**:
- Code rollback: revert deploy. New rows written during rollout have `sourceFile` populated — harmless if rolled back (column becomes dead but inert).
- Schema rollback: `ALTER TABLE links DROP COLUMN source_file; ALTER TABLE import_jobs DROP COLUMN file_mtime; ALTER TABLE import_jobs DROP COLUMN is_reparse; DROP INDEX idx_links_source_file;` — supported by libSQL/SQLite ≥ 3.35. If a driver downgrade lands below 3.35, leave the columns as dead nullable columns (no behavioral impact).

## Open Questions

- **Should staleness auto-trigger re-parse without user click?** Current answer: no — the user might be mid-edits and the click gives them control. Revisit if the user asks for push notification.
- **Should the dedup phase learn about sourceFile for smarter cross-file handling?** Out of scope; dedup stays normalizedUrl-based.
