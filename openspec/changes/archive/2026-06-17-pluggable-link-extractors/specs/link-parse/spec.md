## ADDED Requirements

### Requirement: Pluggable extractor registry covering bookmark export formats

The parse pipeline SHALL discover and dispatch link extractors through a registry, where each extractor declares a `format` identifier, a `detect(ctx)` predicate, and an `extract(content)` function returning `Link[]`. The registry SHALL cover at least the following formats, in detection-priority order:

- For `type='TXT'`: `csv` (extension `.csv`) → `onetab_ini` (INI section headers AND ` * ` markers in the first 10 non-empty lines) → `pipe` (` | ` separator) → `dash` (` - ` separator followed by a valid URL) → `url_only` (default fallback, one URL per line).
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

#### Scenario: URL-only fallback when no structural markers are present
- **WHEN** `parse.start` runs against a TXT file whose first 10 non-empty lines have no INI sections, ` * `, ` | `, or ` - ` URL markers
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

## MODIFIED Requirements

### Requirement: Parse an imported source file into links
The system SHALL provide a `parse.start` procedure that, given a `jobId`, reads the imported source file referenced by the job, runs the pluggable extractor registry to extract `Link[]` (each carrying `url` and optional `title`) for the job's declared `type` (`TXT` or `JSON`), validates the extracted URLs, caches the result, transitions the job to `processing` without yet inserting any links, and returns the detected format. Parsing is deferred from import and triggered explicitly.

#### Scenario: Start parsing a pending job
- **WHEN** `parse.start` is called with a `jobId` whose status is `pending`
- **THEN** the system reads the source file, dispatches to the matching extractor based on `{ type, extension, content }`, validates the extracted URLs, caches `{ valid: Link[], invalid: string[], total, detectedFormat }`, sets the job status to `processing`, and returns `{ totalValid, invalidCount, detectedFormat }`

#### Scenario: Reject parsing a completed job
- **WHEN** `parse.start` is called with a `jobId` whose status is `completed`
- **THEN** the system rejects the request with a conflict error and does not modify the job

#### Scenario: Override type or strategy at parse start
- **WHEN** `parse.start` is called with a `type` or `strategy` differing from the job's stored values and the job is not `completed`
- **THEN** the system updates the job row with the new `type`/`strategy` before running extraction, so that the new `type` controls which extractor branch (`TXT` or `JSON`) is consulted

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
