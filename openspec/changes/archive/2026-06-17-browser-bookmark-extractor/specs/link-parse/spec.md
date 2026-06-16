## MODIFIED Requirements

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

## ADDED Requirements

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
