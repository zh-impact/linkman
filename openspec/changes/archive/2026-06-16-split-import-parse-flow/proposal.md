## Why

The current `import.create` mutation is synchronous and monolithic: in a single HTTP request it writes the file to disk, creates an importJob, extracts URLs, validates, normalizes, and batch-inserts all links. For a 4MB bookmarks file (70k+ URLs) this request blocks for tens of seconds with no progressive feedback, and conflates two conceptually distinct operations (persisting source data vs. transforming it into links). Splitting import from parse lets the import step return instantly, defers the expensive parsing to an explicit user-triggered action on the Files page, and enables progressive progress display and a background-run mode.

## What Changes

- **BREAKING**: `import.create` no longer parses URLs or inserts links. It only writes the file to disk and creates an importJob with `status='pending'`. The response no longer returns `importedCount`/`invalid`.
- Add an explicit **parse** sub-router on `import`: `parse.start` (extract + validate once, cache, set `processing`) and `parse.batch` (insert the next N links, atomic increment, return progressive progress).
- Add `import.list` and `import.get` tRPC queries so the Files UI can show per-file parse status.
- Add a Parse toolbar to the Files page (right-side content card) with type/strategy selectors, a Background toggle, a Parse button, and a live progress bar. File list items gain a status dot (pending/processing/completed/failed).
- Simplify the Import modal: remove the type/strategy selectors and result panel (they are no longer relevant at import time).
- Parse execution is **self-healing**: if the in-memory URL cache is lost (service restart) mid-parse, `parse.batch` re-reads the file, re-extracts deterministically, and resumes from `importedCount`.
- Re-parsing a completed job is rejected (one job per file); re-parsing requires deleting the job/file first.

## Capabilities

### New Capabilities
- `link-parse`: On-demand, progressive, batched parsing of an imported source file into links, with a background-run mode and resumable progress.

### Modified Capabilities
- `link-import`: Import no longer extracts URLs or inserts links; it only persists the source file and creates a `pending` importJob. Parsing is deferred to the new `link-parse` capability.

## Impact

- **Backend**: `apps/service/src/routes/import.ts` (create refactored; new parse/list/get procedures), new `apps/service/src/lib/import/parse.ts` (extracted URL extraction + record preparation + in-memory cache), `apps/service/src/lib/db/queries.ts` (new `incrementImportJob` using atomic SQL increment, new `listImportJobs`).
- **Frontend**: `apps/webapp/src/pages/Files.tsx` (new ParseToolbar component, status dots on file list, ImportModal simplified).
- **API contract**: `import.create` response shape changes (breaking for any existing caller); new procedures added under `import.parse.*`.
- **Data model**: No schema migration required — existing `importJobs` columns (status, importedCount, errorCount, completedAt) are reused.
- **Dependencies**: None added.
