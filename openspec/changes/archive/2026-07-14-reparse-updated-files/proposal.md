## Why

The two-step import → parse pipeline assumes a source file is immutable once parsed. In practice users edit files in place (clipboard dumps get re-pasted, bookmark exports get refreshed, hand-curated TXT lists get appended to). Three concrete symptoms today:

1. **`Sources` shows stale "Completed"** even after the underlying file in `data/files/` has changed. The Parse button is disabled and shows "Parsed ✓", so the user has no way to re-trigger parsing without deleting the job row out-of-band.
2. **`Resolved` doesn't react**. `ResolvedTab` caches its first fetch in a `useRef(false)` guard; switching tabs away and back does not refresh. After a (forced) re-parse the new URLs never appear unless the whole page is reloaded.
3. **Re-parsing is forbidden at the API level**. `import.parse.start` rejects any `status === 'completed'` job with `CONFLICT`, and the webapp honors that contract.

Export is unaffected because it streams from disk on every call. The user wants the same "always reflects current state" behavior for Sources + Resolved, with re-parse limited to genuinely new URLs (incremental, no duplicate inserts, no destructive wiping of previously-parsed rows).

## What Changes

- **Detect file modifications**: store the file's mtime on the import job at parse time; expose it via `import.list` / `import.get`. The webapp compares against the `files.list` mtime to flag a job as stale.
- **Allow re-parsing completed jobs when stale**: drop the unconditional `CONFLICT` rejection. `parse.start` re-opens a job iff the file's current mtime differs from the stored one; otherwise the rejection stays (prevents no-op re-parses that would just rebuild the cache).
- **Incremental insert on re-parse**: extract URLs from the new file content, drop those already present in `linksTable` for this source file, and cache only the difference. `parse.batch` then inserts the new URLs without touching existing rows. Previously-parsed URLs that disappeared from the file are NOT removed (out of scope; user explicitly asked for "只新增变化的部分").
- **Persist source filename on links**: add `sourceFile` column to `linksTable`; populate from the job's `sourceContent` so re-parse can query "what's already inserted for THIS file".
- **ResolvedTab refresh on activation**: drop the `fetched = useRef(false)` mount-once pattern. Refetch when the user (re)enters the Resolved tab so new inserts appear without a full page reload.
- **Toolbar UX**: completed-and-stale jobs show a "Re-parse" button (enabled) instead of "Parsed ✓" (disabled), signaling the user can pick up the diff.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `link-parse`: add re-parse-from-stale flow (mtime-based staleness signal, incremental insert via source-file-scoped dedupe, drop the blanket completed-job rejection).
- `files-browser`: add a stale indicator on Sources entries and a Resolved-tab data-freshness contract (refetch on tab activation).

## Impact

- **Schema**: two additive columns (`links.source_file TEXT`, `import_jobs.file_mtime TEXT`), both nullable. Backfill not required for correctness of new imports; pre-existing rows keep `source_file = NULL` and their first re-parse is a best-effort over-insert (documented in design).
- **Service code**: `apps/service/src/lib/db/queries.ts` (new helpers: `getLinksForSourceFile`, `setJobFileMtime`), `apps/service/src/routes/import.ts` (re-parse branch in `parse.start`), `apps/service/src/lib/import/parse.ts` (carry `sourceFile` through `prepareUrlRecord`).
- **Webapp code**: `apps/webapp/src/pages/Files.tsx` (stale flag, re-parse button label, ResolvedTab refetch on activation).
- **Migration**: one Drizzle migration under `apps/service/drizzle/` adding the two columns. No data backfill in the same migration.
- **No breaking API changes**: `parse.start`'s input schema is unchanged; the output schema gains optional fields. Existing callers that ignore `stale` keep working.
