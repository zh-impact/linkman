## 1. Backend parse library

- [x] 1.1 Create `apps/service/src/lib/import/parse.ts` exporting `DEFAULT_NORMALIZE_CONFIG` (moved from `routes/import.ts`), `extractUrls(type, content)` (TXT split/filter + JSON array map, extracted from current import.ts L59-82), and `prepareUrlRecord(originalUrl, strategy, sourceType, order)` returning a `linksTable.$inferInsert` (extracted from current import.ts L104-136)
- [x] 1.2 Add an in-memory cache module-level `Map<string, { valid: string[]; invalid: string[]; total: number }>` with `getCachedUrls(jobId)`, `setCachedUrls(jobId, data)`, `clearCachedUrls(jobId)` accessors

## 2. Backend database queries

- [x] 2.1 Add `incrementImportJob(id, importedDelta, errorDelta)` to `apps/service/src/lib/db/queries.ts` using `sql\`${importJobs.importedCount} + ${importedDelta}\`` for atomic increment (import `desc` from drizzle-orm if not present)
- [x] 2.2 Add `listImportJobs()` returning all jobs ordered by `createdAt desc`

## 3. Backend import routes

- [x] 3.1 Refactor `import.create` in `apps/service/src/routes/import.ts` to only write the file and create a `pending` importJob (infer `type` from filename suffix, default `strategy='normalized'`); return `{ jobId, filename }` with no parsing and no `importedCount`/`invalid` fields
- [x] 3.2 Add `import.parse.start` mutation: read job, reject if `status==='completed'` (TRPCError CONFLICT), apply optional `type`/`strategy` overrides, read file, run `extractUrls` + `validateUrls`, populate the cache, set `status='processing'`, return `{ totalValid, invalidCount }`
- [x] 3.3 Add `import.parse.batch` mutation: read job; if cache miss, self-heal by re-reading file + re-extracting; slice `[importedCount, importedCount+batchSize)`, `prepareUrlRecord` each, `insertLinks`, `incrementImportJob`, set `completed`+`completedAt`+`clearCachedUrls` when `importedCount >= total`; return `{ importedCount, totalValid, errorCount, done, status }`
- [x] 3.4 Add `import.list` query returning jobs mapped to `{ jobId, filename, type, strategy, status, importedCount, errorCount, createdAt }` newest-first
- [x] 3.5 Add `import.get` query taking `{ filename }` and returning the matching job (by `sourceContent`) or null

## 4. Frontend Files page

- [x] 4.1 In `apps/webapp/src/pages/Files.tsx` `SourcesTab`, fetch `files.list` and `import.list` together (`Promise.all`) and match files to jobs by `sourceContent === filename`; render a status dot on each file list item (grey=pending, yellow=processing, green=completed, red=failed)
- [x] 4.2 Add a `ParseToolbar` component rendered at the top of the right-side content Card (above `VirtualLineViewer`) showing: filename, status Badge, `type` SegmentedControl (TXT/JSON), `strategy` Select (strict/normalized/smart), Background `Switch`, Parse/Stop button, and a Progress bar with `importedCount / totalValid` and error count
- [x] 4.3 Implement the foreground parse handler: call `parse.start`, then loop `await parse.batch` updating progress state after each call until `done`; disable toolbar controls while running
- [x] 4.4 Implement the background parse handler: run the same batch loop in a non-awaited IIFE guarded by a `stopRef`; change the button to Stop and allow selecting other files; Stop sets `stopRef` and halts after the current batch
- [x] 4.5 Show a Resume button when the selected file's job is `processing` on page load; clicking it calls `parse.batch` repeatedly until done
- [x] 4.6 Disable the Parse button and show a green "Parsed ✓" indicator when the job is `completed`; reflect type/strategy overrides by passing them to `parse.start`
- [x] 4.6 Simplify `ImportModal`: remove the `type` SegmentedControl, the `strategy` selector, and the `result` (importedCount/invalid) Alert; keep file select + paste + Import button + error Alert; on success call the new `import.create` shape and close/refresh
- [x] 4.7 Refresh the file list (re-fetch `files.list` + `import.list`) after import, after parse completes, and after resume completes

## 5. Verification

- [x] 5.1 Run `pnpm --filter service exec tsc --noEmit` and `pnpm --filter webapp exec tsc --noEmit` with no errors
- [x] 5.2 Import a `.txt` file from the Files page and confirm `data/files/` gains the file, `import_jobs` has a `pending` row, and `links` is unchanged
- [x] 5.3 Select the file, click Parse (Background off), and confirm the progress bar advances from 0 to total and the status turns green
- [ ] 5.4 Import a large file (~4MB), toggle Background on, click Parse, switch to another file mid-parse, and confirm parsing continues; click Stop and confirm the job stays `processing` and is resumable
- [x] 5.5 Reload the page while a job is `processing` (simulating a tab close), select the file, click Resume, and confirm parsing resumes from `importedCount` to completion (self-heal path)
- [x] 5.6 On a `completed` job, confirm the Parse button is disabled and shows "Parsed ✓"; confirm calling `parse.start` on it is rejected
