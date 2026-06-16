## Context

The service is a Node.js tRPC server (`apps/service`) backed by SQLite (libsql/drizzle). The webapp is React + Mantine. Today, `import.create` does everything synchronously in one request: writes the source file to `data/files/`, inserts an `importJobs` row, extracts URLs (TXT split or JSON.parse), validates, normalizes, and batch-inserts links 500 at a time. A 4MB file (~76k URLs) blocks that single request for 20+ seconds with no progress signal.

tRPC is mounted via `createHTTPServer` with no SSE/WebSocket/subscription support, so progressive progress must be achieved by the **frontend looping a batch procedure**, not by server push.

The `importJobs` table already has the columns this design needs: `status` (pending/processing/completed/failed), `importedCount`, `errorCount`, `completedAt`. No migration is required.

Stakeholders: a single user (personal MVP tool). Failure modes like "service restart drops an in-memory cache" are acceptable as long as parsing is resumable.

## Goals / Non-Goals

**Goals:**
- Import returns immediately after persisting the file and creating a `pending` job.
- Parsing is user-triggered from the Files page, runs in batches of ~500, and reports `importedCount / totalValid` after each batch.
- A "Background" toggle lets the user keep interacting with the UI while parsing proceeds (frontend-only distinction; backend API is identical).
- Parsing is resumable: if the service restarts mid-parse, the next `parse.batch` reconstructs state from the file and `importedCount` and continues.
- Concurrent batches on the same job cannot corrupt the `importedCount` counter.

**Non-Goals:**
- True server-side job queues / workers (parsing is driven by frontend batch calls; closing the browser tab halts parsing).
- Re-parsing a completed job in place (rejected; user must delete and re-import).
- WebSocket/SSE infrastructure.
- Deduplication across files (existing dedup capability is unchanged).
- Schema migrations.

## Decisions

### Decision 1: Frontend-driven batch loop (no SSE/subscription)
The frontend calls `parse.start` once (to extract+validate+cache+set `processing`), then loops `parse.batch` until `done`. Each batch returns `{ importedCount, totalValid, errorCount, done, status }`.

**Why not server push:** tRPC here has no subscription link and adding one is disproportionate for an MVP. The batch loop is simple, resumable, and naturally throttles itself.

**Why not one long-running async request:** a single fire-and-forget server task would need a job manager, crash recovery, and the frontend would still poll status — more moving parts than the batch loop, which gets progressive updates for free.

### Decision 2: In-memory URL cache with deterministic self-heal
`parse.start` reads the file, runs `extractUrls` + `validateUrls` once, and stores `{ valid[], invalid[], total }` in a module-level `Map<jobId, ...>`. `parse.batch` reads from this map.

If the map entry is missing (service restarted), `parse.batch` re-reads the file and re-runs extract+validate, then slices `[importedCount, importedCount+batchSize)`. This is safe because extraction is **order-deterministic**: TXT uses `split('\n').map(trim).filter(Boolean)` and JSON uses `Array.isArray(parsed) ? parsed.map(...)`; `validateUrls` iterates in input order. So the Nth valid URL is identical across runs.

**Why not persist the validated list to disk/DB:** adds a temporary-file lifecycle to manage. The re-extract cost is ~10ms/MB, paid only on the rare restart-mid-parse path.

### Decision 3: Atomic counter increment
`parse.batch` increments `importedCount`/`errorCount` via `UPDATE import_jobs SET imported_count = imported_count + N` (drizzle `sql` template), not read-then-write. This makes concurrent batches (two tabs, or a frontend bug) safe: each batch inserts its own slice and atomically bumps the counter. Completion is detected by re-reading the row after increment and checking `importedCount >= totalValid`.

### Decision 4: One job per file; completed jobs cannot be re-parsed
`parse.start` rejects a job whose `status === 'completed'` with a `CONFLICT` error. Re-parsing would insert duplicate links (new UUIDs, same URLs) because `linksTable` has no `jobId` column and `insertLinks` does not dedup. Adding `jobId` + cascade delete is deferred — it's a schema migration and the user confirmed one-job-per-file is acceptable.

### Decision 5: Strategy/type are editable at parse time
`import.create` records a default `type` (inferred from filename suffix) and `strategy='normalized'` on the job. `parse.start` accepts optional `type`/`strategy` overrides and updates the job row before parsing, so the same source file can be parsed under different strategies by deleting and re-importing, or by changing the selectors in the toolbar before the first parse (the job is still `pending`, so this is just pre-execution configuration, not re-execution).

### Decision 6: Background toggle is a frontend concern only
"Background ON" launches the batch loop in a non-awaited IIFE with a `stopRef` the user can trip; the Parse button becomes a Stop button and the user may select other files. "Background OFF" awaits the loop and disables the toolbar. The backend sees identical `parse.start` + `parse.batch` calls either way.

## Risks / Trade-offs

- **[Parsing halts if the browser tab closes]** → Accepted for an MVP single-user tool. Documented as expected behavior. The job remains `processing` and can be resumed from the same or another tab via the Resume action (which just calls `parse.batch` again).
- **[Orphaned `processing` jobs if the tab is abandoned]** → The Files UI shows a Resume button for any `processing` job; the user can either resume or delete the file/job. No automatic sweep is added.
- **[Memory growth from the cache Map if many jobs are started]** → `parse.batch` calls `clearCachedUrls(jobId)` on completion. Abandoned `processing` jobs could leak one entry each; bounded by the number of distinct files and acceptable for MVP.
- **[Re-extraction on cache miss must be deterministic]** → Verified: TXT and JSON extraction paths preserve order, and `validateUrls` is order-preserving. If a future change makes extraction non-deterministic, resume would mis-slice; a guard test should be added.
- **[Breaking change to `import.create` response]** → The only caller is `ImportModal` in Files.tsx, which is updated in the same change. No external consumers.
