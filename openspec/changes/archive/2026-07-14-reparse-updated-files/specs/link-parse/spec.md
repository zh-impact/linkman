## MODIFIED Requirements

### Requirement: Parse an imported source file into links
The system SHALL provide a `parse.start` procedure that, given a `jobId`, reads the imported source file referenced by the job, runs the pluggable extractor registry to extract `Link[]` (each carrying `url` and optional `title`) for the job's declared `type` (`TXT` or `JSON`), validates the extracted URLs, caches the result, captures the file's current modification time into `import_jobs.fileMtime`, transitions the job to `processing` without yet inserting any links, and returns the detected format plus a flag indicating whether this was a first parse or a re-parse. Parsing is deferred from import and triggered explicitly.

For a re-parse (job status was `completed` and the file's current mtime differs from the stored `fileMtime`), `parse.start` SHALL additionally: reject any caller-supplied `type` or `strategy` override (re-parse MUST reuse the original strategy and type); query `linksTable.normalizedUrl` for rows whose `sourceFile` equals the job's `sourceContent`; drop any extracted URL whose `normalizedUrl` already appears in that set; cache only the difference; reset `importedCount` to `0`; and set `import_jobs.isReparse` to `1`. Previously-parsed rows SHALL NOT be modified or deleted. On re-parse completion, the system SHALL snap `importedCount` back to the cumulative row count for this source file (`SELECT COUNT(*) FROM links WHERE sourceFile = ?`) so the UI's "X links" indicator reflects the total rows for this file, not just the most recent diff size.

#### Scenario: Start parsing a pending job
- **WHEN** `parse.start` is called with a `jobId` whose status is `pending`
- **THEN** the system reads the source file, dispatches to the matching extractor based on `{ type, extension, content }`, validates the extracted URLs, caches `{ valid: Link[], invalid: string[], total, detectedFormat }`, captures `fileMtime` from the file's current modification time, sets `isReparse = 0` and the job status to `processing`, leaves `importedCount` at its current value (expected to be `0` for a fresh pending job), and returns `{ totalValid, invalidCount, detectedFormat, isReparse: false }`

#### Scenario: Reject re-parsing a completed job whose file is unchanged
- **WHEN** `parse.start` is called with a `jobId` whose status is `completed` AND the source file's current modification time equals `import_jobs.fileMtime`
- **THEN** the system rejects the request with a conflict error and does not modify the job or the cache

#### Scenario: Re-parse a completed job whose file has changed
- **WHEN** `parse.start` is called with a `jobId` whose status is `completed` AND the source file's current modification time differs from `import_jobs.fileMtime`
- **THEN** the system reads the file, extracts and validates URLs, queries `normalizedUrl` from `linksTable` rows where `sourceFile = job.sourceContent`, drops any extracted URL whose normalized form is already in that set, caches the remaining URLs as `{ valid, invalid, total: valid.length, detectedFormat }`, atomically updates the job to `status='processing'`, `importedCount=0`, `errorCount=invalid.length`, `fileMtime=currentMtime`, `isReparse=1`, and returns `{ totalValid: cache.valid.length, invalidCount, detectedFormat, isReparse: true }`

#### Scenario: Re-parse resets importedCount so the batch loop progresses
- **WHEN** `parse.start` takes the re-parse branch and the job previously had `importedCount = 500` (the original total)
- **THEN** the system resets `importedCount` to `0` as part of the same update that transitions to `processing`, so that the first subsequent `parse.batch` slices `[0, batchSize)` from the diff cache and actually inserts rows (rather than hitting the "nothing left; finalize" early-exit branch that would fire if `importedCount` remained at 500 while `cache.total` shrank to the diff size)

#### Scenario: Re-parse snaps importedCount to cumulative count on completion
- **WHEN** a re-parse's final `parse.batch` call inserts the last diff URL and transitions the job back to `completed`
- **THEN** the system sets `importedCount = (SELECT COUNT(*) FROM links WHERE sourceFile = job.sourceContent)` so the SourcesTab "X links" indicator reflects the total rows for this file (e.g. 502 = 500 original + 2 diff), not just the most recent re-parse's diff size

#### Scenario: Re-parse inserts only URLs new to this file
- **WHEN** a re-parse runs against a file whose previous parse produced rows for `[a, b, c]` and whose current content extracts `[a, b, d, e]` (a and b unchanged, c missing, d and e new)
- **THEN** the cache SHALL contain exactly `[d, e]` (matched by `normalizedUrl`), the subsequent `parse.batch` calls SHALL insert only `d` and `e`, and the rows for `a`, `b`, `c` SHALL remain unmodified

#### Scenario: Override type or strategy at parse start (first parse only)
- **WHEN** `parse.start` is called with a `type` or `strategy` differing from the job's stored values AND the job is `pending` or `processing`
- **THEN** the system updates the job row with the new `type`/`strategy` before running extraction, so that the new `type` controls which extractor branch (`TXT` or `JSON`) is consulted

#### Scenario: Re-parse rejects type or strategy override
- **WHEN** `parse.start` is called for a `completed`-and-stale job AND the caller supplies a `type` or `strategy` differing from the job's stored values
- **THEN** the system rejects the request with a `BAD_REQUEST` error explaining that re-parse must reuse the original `type` and `strategy` (changing either would compute `normalizedUrl` differently and break the source-file diff filter); the user MUST delete the job and re-import to switch `type` or `strategy`

## ADDED Requirements

### Requirement: Source-file attribution on link rows
The system SHALL persist the job's `sourceContent` (source filename) into a `sourceFile` column on every `linksTable` row at insertion time, so that re-parse can identify URLs already inserted from a given file. Rows written by `prepareUrlRecord` SHALL populate `sourceFile` from the job's `sourceContent`; rows written by other paths (manual insert, future import paths) MAY leave the column NULL. A b-tree index `idx_links_source_file` SHALL be maintained on the column so that `WHERE sourceFile = ?` lookups during re-parse and self-heal use an index seek rather than a full table scan.

#### Scenario: First parse populates sourceFile
- **WHEN** `parse.batch` inserts a link for a job whose `sourceContent = '1717000000-bookmarks.txt'`
- **THEN** the inserted row has `sourceFile = '1717000000-bookmarks.txt'`

#### Scenario: Legacy rows retain NULL sourceFile
- **WHEN** the system is upgraded and pre-existing rows have `sourceFile IS NULL`
- **THEN** those rows SHALL remain NULL (no backfill is performed); the first re-parse of the corresponding file after upgrade sees zero matching rows in the `WHERE sourceFile = ?` query and treats every extracted URL as new (one-time over-insert; user runs deduplicate to collapse)

### Requirement: Atomic capture of file modification time
The system SHALL capture the source file's modification time (`mtime`) into `import_jobs.fileMtime` at the moment `parse.start` reads the file, so that subsequent staleness checks can compare the stored value against the file's current mtime without re-reading the file's bytes.

#### Scenario: fileMtime captured on first parse
- **WHEN** `parse.start` runs for a `pending` job
- **THEN** the job row's `fileMtime` is set to the source file's current `mtime` (as an ISO 8601 string), regardless of whether the file has any valid URLs

#### Scenario: fileMtime refreshed on re-parse
- **WHEN** `parse.start` runs for a `completed`-and-stale job (re-parse path)
- **THEN** the job row's `fileMtime` is updated to the file's current `mtime` after extraction succeeds, so that another re-parse call made immediately afterwards (without changing the file) is rejected as unchanged

### Requirement: Persisted re-parse mode flag for unambiguous self-heal
The system SHALL persist a boolean `isReparse` column on `import_jobs` (default `0`) that records whether the in-flight parse is a re-parse (`1`) or a first-time parse (`0`). `parse.start` SHALL set the flag at the same atomic update that transitions the job to `processing`. The flag is the single source of truth used by `parse.batch`'s self-heal path to decide whether to apply the source-file-scoped diff filter when reconstructing a lost cache; row existence or row counts SHALL NOT be used as a proxy.

#### Scenario: First parse sets isReparse to 0
- **WHEN** `parse.start` runs for a job in `pending` or `processing` status
- **THEN** the job row's `isReparse` is set to `0` at the transition to `processing`

#### Scenario: Re-parse sets isReparse to 1
- **WHEN** `parse.start` runs for a `completed`-and-stale job (re-parse branch)
- **THEN** the job row's `isReparse` is set to `1` at the transition to `processing`, alongside the `importedCount = 0` reset and the `fileMtime` capture

### Requirement: Re-parse cache self-heal preserves the source-file filter
The system SHALL apply the same source-file-scoped dedupe filter when reconstructing a lost cache during `parse.batch` (e.g. after service restart) as it applied in the original `parse.start` — but ONLY when the persisted `isReparse` flag is `1`. When the flag is `0` (first-time parse), self-heal SHALL produce a byte-identical `Link[]` to the original extraction without any filtering, preserving the existing "Resumable parsing after cache loss" contract.

#### Scenario: Resume an interrupted re-parse without duplicating rows
- **WHEN** `parse.batch` runs for a `processing` job whose `isReparse = 1` AND whose cache was lost (service restarted mid-re-parse) AND whose `linksTable` already contains some rows with `sourceFile = job.sourceContent` from prior batches of the same re-parse
- **THEN** the system re-reads the file, re-extracts URLs, re-applies the `WHERE sourceFile = job.sourceContent` filter to drop already-inserted URLs, re-caches the difference, and the slice `[importedCount, importedCount + batchSize)` covers only URLs not yet inserted

#### Scenario: Resume an interrupted first-time parse without filtering
- **WHEN** `parse.batch` runs for a `processing` job whose `isReparse = 0` AND whose cache was lost (service restarted mid-first-parse) AND whose `linksTable` already contains some rows with `sourceFile = job.sourceContent` from prior batches
- **THEN** the system re-reads the file, re-extracts URLs WITHOUT applying any filter, re-caches the full valid `Link[]` in original extraction order, and the slice `[importedCount, importedCount + batchSize)` produces a byte-identical continuation to the original parse — meeting the existing "Resumable parsing after cache loss" requirement. The presence of `sourceFile`-tagged rows MUST NOT trigger the diff filter for first-time parses.

### Requirement: parse.start and parse.batch payload additions for re-parse awareness
The `parse.start` response SHALL include an `isReparse: boolean` field (false for first parse, true when triggered by staleness on a previously-completed job). The `import.list` and `import.get` responses SHALL include a `fileMtime: string | null` field per job so the webapp can compute staleness against the file's current modification time without an extra server round-trip.

#### Scenario: parse.start response distinguishes first parse from re-parse
- **WHEN** a caller invokes `parse.start` for a `pending` job
- **THEN** the response includes `isReparse: false`

- **WHEN** a caller invokes `parse.start` for a `completed`-and-stale job
- **THEN** the response includes `isReparse: true`

#### Scenario: import.list exposes fileMtime
- **WHEN** `import.list` is called
- **THEN** each job entry in the response includes `fileMtime` (ISO 8601 string) for jobs that have run `parse.start`, and `null` for jobs still in `pending` status that have never been parsed
