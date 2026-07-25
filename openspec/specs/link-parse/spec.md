# link-parse Specification

## Purpose
Parsing extracts structured links (URL + optional title) from imported source files using a pluggable extractor registry covering OneTab INI, Chrome CSV, Tablerone JSON, pipe/dash/url-only text, and flat JSON arrays. The pipeline runs as two phases — extract-and-cache at `parse.start`, then progressive batched insertion at `parse.batch` — with atomic counters and deterministic self-heal after restarts.

## Requirements

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

### Requirement: Progressive batch insertion with atomic counters
The system SHALL provide a `parse.batch` procedure that inserts the next batch of links (default 500) for a `processing` job, preserving any extracted `title` into the `linksTable.title` column, and returns progressive progress. Counters SHALL be incremented atomically so concurrent batches cannot lose updates.

#### Scenario: Process one batch
- **WHEN** `parse.batch` is called with a `jobId` that is `processing` and has remaining links
- **THEN** the system slices the cached `Link[]` at `[importedCount, importedCount + batchSize)`, inserts each as a `links` row via `prepareUrlRecord(link, strategy, sourceType, order)` (writing the link's `title` into the `title` column), atomically increments `importedCount`, and returns `{ importedCount, totalValid, errorCount, done: false, status: 'processing' }`

#### Scenario: Complete the final batch
- **WHEN** `parse.batch` inserts the last remaining links so that `importedCount` reaches `totalValid`
- **THEN** the system sets the job status to `completed`, records `completedAt`, clears the in-memory cache for the job, and returns `{ done: true, status: 'completed' }`

#### Scenario: Concurrent batches do not corrupt the counter
- **WHEN** two `parse.batch` calls for the same job run concurrently
- **THEN** each inserts a distinct slice of the cached `Link[]` and the final `importedCount` equals `totalValid` exactly (no lost or double increments)

### Requirement: Resumable parsing after cache loss
The system SHALL reconstruct parse state from the source file when the in-memory `Link[]` cache for a job is missing, so that parsing can resume after a service restart. Reconstruction SHALL use the same extractor registry and produce a byte-identical `Link[]` ordering, so that the `[importedCount, +batchSize)` slice boundary remains valid.

#### Scenario: Resume after service restart
- **WHEN** `parse.batch` is called for a `processing` job whose cache entry is missing
- **THEN** the system re-reads the source file, re-runs detection + extraction deterministically (same `{ type, extension, content }` → same format → same `Link[]` in same order), re-validates, slices links starting at the current `importedCount`, and continues insertion

### Requirement: Pluggable extractor registry covering bookmark export formats

The parse pipeline SHALL discover and dispatch link extractors through a registry, where each extractor declares a `format` identifier, a `detect(ctx)` predicate, and an `extract(content)` function returning `Link[]`. The registry SHALL cover at least the following formats, in detection-priority order:

- For `type='TXT'`: `csv` (extension `.csv`) → `onetab_ini` (INI section headers AND ` * ` markers in the first 10 non-empty lines) → `pipe` (` | ` separator) → `dash` (` - ` separator followed by a valid URL) → `bookmarks_html` (Netscape Bookmark File Format, detected by `NETSCAPE-Bookmark` substring OR a combination of `<DL>` and `<A HREF=` markers in the first 10 non-empty lines) → `url_only` (default fallback, one URL per line).
- For `type='JSON'`: `tablerone_json` (parses as an object with an `export` array of `{ tabs: [{ url, title }] }`) → `json_array` (default fallback, flat array of URL strings or `{ url, title? }` objects).

Detection SHALL be deterministic: the same `{ type, extension, content }` triple SHALL always resolve to the same format. Each extractor SHALL preserve source order in its output, so that batch slicing by `importedCount` remains stable across re-extraction.

#### Scenario: OneTab INI file is detected and parsed with group structure
- **WHEN** `parse.start` runs against a TXT file whose first 10 non-empty lines contain `[Group]`-style section headers and ` * ` URL/title markers
- **THEN** the system selects the `onetab_ini` extractor, skips section headers, and produces one `Link` per `URL * Title` row with the title populated

#### Scenario: Chrome history CSV is detected by extension
- **WHEN** `parse.start` runs against a `.csv` file containing `NavigatedToUrl` and `PageTitle` columns
- **THEN** the system selects the `csv` extractor and produces one `Link` per data row, populating `title` from the `PageTitle` column

#### Scenario: Tablerone JSON is detected over flat array
- **WHEN** `parse.start` runs against a `type='JSON'` file whose content parses as `{ export: [{ tabs: [...] }] }`
- **THEN** the system selects the `tablerone_json` extractor and traverses `export[].tabs[]`, emitting one `Link` per tab with its title

#### Scenario: Pipe format fallback for plain TXT
- **WHEN** `parse.start` runs against a TXT file whose lines use `URL | Title` separator
- **THEN** the system selects the `pipe` extractor and emits one `Link` per non-empty line, splitting URL and title on the first ` | ` occurrence

#### Scenario: Browser bookmark HTML is detected before URL-only fallback
- **WHEN** `parse.start` runs against a TXT file whose content contains `NETSCAPE-Bookmark` (case-insensitive) OR whose first 10 non-empty lines contain both a `<DL>` tag and an `<A HREF=` pattern
- **THEN** the system selects the `bookmarks_html` extractor instead of `url_only`, scans `<A HREF="...">Title</A>` anchor tags via case-insensitive regex, decodes HTML entities in titles, and emits one `Link` per anchor with the decoded title populated

#### Scenario: URL-only fallback when no structural markers are present
- **WHEN** `parse.start` runs against a TXT file whose first 10 non-empty lines have no INI sections, ` * `, ` | `, ` - ` URL markers, or Netscape bookmark HTML markers
- **THEN** the system selects the `url_only` extractor and emits one `Link` per line starting with `http://` or `https://`, with empty title

#### Scenario: Flat JSON array is detected when not Tablerone
- **WHEN** `parse.start` runs against a `type='JSON'` file whose content is a JSON array of strings or `{ url, title? }` objects
- **THEN** the system selects the `json_array` extractor and emits one `Link` per array element, populating `title` when the element is an object with a `title` field

### Requirement: Extracted titles are persisted into the links table

The system SHALL preserve any non-empty `title` extracted by the chosen extractor into the `linksTable.title` column at insertion time. For URL-only or other title-less sources, the column SHALL be set to the empty string. Titles SHALL NOT be synthesized or normalized during parsing — they are stored verbatim from the source.

#### Scenario: Title-bearing source populates the title column
- **WHEN** `parse.batch` inserts a link whose extracted `Link` object has a non-empty `title`
- **THEN** the inserted `links` row has `title` equal to the extracted title

#### Scenario: URL-only source leaves title empty
- **WHEN** `parse.batch` inserts a link whose extracted `Link` object has an empty or absent `title`
- **THEN** the inserted `links` row has `title` set to the empty string

### Requirement: List and inspect parse jobs
The system SHALL provide `import.list` and `import.get` procedures so the UI can display per-file parse status and progress.

#### Scenario: List all jobs
- **WHEN** `import.list` is called
- **THEN** the system returns all import jobs newest-first, each with `{ jobId, filename, type, strategy, status, importedCount, errorCount, createdAt }`

#### Scenario: Look up a job by source filename
- **WHEN** `import.get` is called with a `filename`
- **THEN** the system returns the job whose `sourceContent` equals that filename, or null if none exists

### Requirement: Background and foreground parse execution modes
The webapp SHALL offer a Background toggle in the Files parse toolbar that controls whether the batch loop blocks the UI. The backend API SHALL be identical for both modes.

#### Scenario: Foreground parse (Background off)
- **WHEN** the user clicks Parse with the Background toggle off
- **THEN** the webapp awaits each `parse.batch` in sequence, disables the toolbar until completion, and updates the progress bar after each batch

#### Scenario: Background parse (Background on)
- **WHEN** the user clicks Parse with the Background toggle on
- **THEN** the webapp runs the batch loop without blocking interaction, the Parse button becomes a Stop button, and the user may select other files while parsing continues

#### Scenario: Stop a background parse
- **WHEN** the user clicks Stop during a background parse
- **THEN** the webapp halts the loop after the current batch, leaving the job in `processing` state so it can be resumed later

### Requirement: Per-file status visibility in the file list
The webapp SHALL display a status indicator on each file in the Sources list reflecting the associated job's state.

#### Scenario: Display parse status dots
- **WHEN** the Files Sources tab loads
- **THEN** each file shows a status dot: grey for pending, yellow for processing, green for completed, red for failed

### Requirement: Recoverable parsing for files without a job

The system SHALL provide an `import.ensureJob({ filename, type?, strategy? })` mutation that resolves a filename to an import job, creating a pending job on demand when the file exists on disk but has no job row. This makes the Parse action always recoverable for orphaned files (e.g. files placed manually in `data/files/`, or files whose job row was deleted).

The mutation SHALL be idempotent: calling it twice with the same `filename` returns the same `jobId` rather than creating a duplicate. When no job exists for the filename, the system SHALL first verify the file exists on disk (rejecting with `NOT_FOUND` otherwise) before creating a pending job. Type SHALL be inferred from the filename extension (`.json` → JSON, else TXT) when not provided; strategy SHALL default to `'normalized'` when not provided.

The Files toolbar SHALL call `import.ensureJob` before `import.parse.start` whenever the selected file has no associated job, so the Parse button is always actionable.

#### Scenario: Orphaned file gets a job on first Parse click
- **WHEN** the user clicks Parse on a file that exists in `data/files/` but has no row in `import_jobs`
- **THEN** the webapp calls `import.ensureJob` with the filename, the system creates a pending job with type auto-inferred from the extension, returns the `jobId`, and the webapp immediately proceeds to `import.parse.start` with that `jobId`

#### Scenario: Second Parse click on the same orphaned file is idempotent
- **WHEN** `import.ensureJob` is called twice in quick succession for the same filename (e.g. rapid double-click)
- **THEN** both calls return the same `jobId`; no duplicate job is inserted

#### Scenario: Existing job is returned without modification
- **WHEN** `import.ensureJob` is called for a filename that already has a job row (in any status)
- **THEN** the system returns that job's `jobId` and metadata without inserting a new row, so the caller can route to the appropriate UI state (Parse / Resume / Parsed-✓)

#### Scenario: Nonexistent file is rejected
- **WHEN** `import.ensureJob` is called with a filename that does not exist in `data/files/`
- **THEN** the system rejects the request with `NOT_FOUND` and does not create a job row, preventing the creation of an unparseable job

### Requirement: Single source of truth for format detection

The system SHALL route all link-format detection and extraction through the pluggable extractor registry. No parallel or duplicated detection helpers SHALL be maintained outside the registry in production code paths (including internal CLIs and scripts). The `parseLinks` and `detectFormat` helpers previously exported from `apps/service/src/lib/url/extract.ts` SHALL be removed; the line-level parsers they wrapped SHALL remain as the implementation behind the registry's extractors.

#### Scenario: Scripts and the runtime share the registry
- **WHEN** any code path in `apps/` (including `apps/service/scripts/`) needs to detect a link format and extract links from source content
- **THEN** it SHALL call `extractLinks(content, type, filename)` from the registry, and SHALL NOT call a separate `detectFormat` or `parseLinks` helper

#### Scenario: Adding a new format requires only one edit point
- **WHEN** a contributor adds a new link source format
- **THEN** the change is localized to: one new extractor module under `apps/service/src/lib/import/extractors/`, plus one insertion in the registry array in `apps/service/src/lib/import/extractors/index.ts` — with no parallel edits required in scripts, route handlers, or shared parser libraries

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
