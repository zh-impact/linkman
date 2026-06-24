# Link Export

## Purpose

Convert any already-imported source file (TXT, OneTab INI, CSV, Pipe, Dash, Netscape Bookmark HTML, Tablerone JSON, JSON array) into a standardized JSON array of `{url, title}` objects by re-running the `extractLinks` pipeline at export time, independent of parse state. Deliver via browser download and/or server-side save with content-hash deduplication and path-traversal safety.

## Requirements

### Requirement: Standardized JSON export from any recognized source format
The system SHALL allow the user to convert any already-imported source file (regardless of its original format — TXT, OneTab INI, CSV, Pipe, Dash, Netscape Bookmark HTML, Tablerone JSON, JSON array) into a standardized JSON array of `{url, title}` objects by re-running the `extractLinks` pipeline on the source file's content.

#### Scenario: Export a single file
- **WHEN** the user selects one source file in the Export tab and clicks the export button
- **THEN** the system reads the file from disk, runs `extractLinks(content, type, filename)`, serializes the resulting `Link[]` as `[{url, title}, ...]`, and delivers the JSON to the user (via browser download by default)

#### Scenario: Export preserves source order
- **WHEN** the system extracts links from a source file
- **THEN** the JSON array order SHALL match the source order produced by `extractLinks` (deterministic — same file yields byte-identical output across runs)

#### Scenario: Re-export with no content change skips disk write
- **WHEN** the user exports the same source file twice (with `Save to data/exports/` enabled) and the file content has not changed between the two exports
- **THEN** the second export SHALL skip the disk write (the `data/exports/<stem>-<hash8>.json` file already exists), SHALL return `{ skipped: true, savedPath }` to the UI, and the file mtime SHALL remain unchanged

### Requirement: Batch multi-file export
The system SHALL allow the user to select multiple source files and export each one as a separate standardized JSON file in a single batch operation.

#### Scenario: Select and export multiple files
- **WHEN** the user selects N files (N ≥ 2) and clicks export
- **THEN** the system SHALL produce N separate `.json` files — one per source file — delivered via browser serial download (no zip packaging)

#### Scenario: Per-file progress during batch
- **WHEN** a batch export is running
- **THEN** the UI SHALL display progress as `<completed>/<total>` and the filename currently being exported

#### Scenario: Batch export with partial failure
- **WHEN** one file in the batch fails to read or extract (e.g. file disappeared)
- **THEN** the system SHALL skip that file, record an error message for it, and continue with the remaining files; the UI SHALL list which files succeeded vs failed after the batch completes

### Requirement: Real-time extraction independent of parse state
The system SHALL derive exported URLs by calling `extractLinks` on the raw source file at export time, with no dependency on whether the file has been parsed into the `links` table.

#### Scenario: Export an un-parsed file
- **WHEN** the user exports a source file that has never been parsed (status = pending, or no `import_jobs` row)
- **THEN** the export SHALL succeed, producing the same `Link[]` that a fresh `parse.start` would compute

#### Scenario: Export a file whose import_job has a different type than the filename extension suggests
- **WHEN** the source file has an existing `import_jobs` row with `type` set
- **THEN** the export SHALL use the `import_jobs.type` value as the `extractLinks` type argument
- **AND WHEN** no `import_jobs` row exists
- **THEN** the export SHALL infer the type via the shared `resolveImportType` helper (filename pattern → content sniff → extension fallback)

#### Scenario: Tablerone export saved with `.txt` extension is detected as JSON
- **WHEN** the source file is a Tablerone Chrome extension export (filename matches the `tablerone` substring pattern, e.g. `tablerone_backup_2026-06-17-22-32-41.txt`) and no `import_jobs` row exists
- **THEN** the system SHALL resolve the type to `JSON` via filename pattern match, the detected format SHALL be `tablerone_json`, and the extracted `Link[]` SHALL include all `{url, title}` pairs from the source's `export[].tabs[]` structure

#### Scenario: JSON content saved as `.txt` is detected via content sniff
- **WHEN** the source file has a `.txt` extension, no `import_jobs` row, no filename pattern match, but its first non-whitespace content character is `{` or `[`
- **THEN** the system SHALL resolve the type to `JSON` via content sniff and proceed with the appropriate JSON extractor (`tablerone_json` or `json_array`)

#### Scenario: Explicit type override always wins
- **WHEN** the source file has an `import_jobs` row whose `type` differs from what filename pattern or content sniff would produce
- **THEN** the system SHALL honor the stored `import_jobs.type` value, never second-guessing the user's prior choice

### Requirement: Output filename convention
The system SHALL name each exported JSON file as `<originalStem>-<sha256_8>.json` where `originalStem` is the source filename with its extension stripped and `sha256_8` is the first 8 hex characters of the SHA-256 hash of the source file's content.

#### Scenario: Filename derived from source content hash
- **WHEN** the source file is `2026-06-16T12-55-58-heal.txt` and its content hashes to `a1b2c3d4...`
- **THEN** the exported JSON filename SHALL be `2026-06-16T12-55-58-heal-a1b2c3d4.json`

#### Scenario: Filename sanitized against path traversal
- **WHEN** the source filename contains `/`, `\`, or path-like segments
- **THEN** those characters SHALL be replaced with `-` before being used in the export filename stem

#### Scenario: Same content yields same filename
- **WHEN** two source files have identical content
- **THEN** their export filenames SHALL share the same hash suffix (stems may differ)

### Requirement: Dual independent delivery — browser download and server-side save
The system SHALL expose two independent toggles for delivery: a browser download toggle and a server-side save toggle. The user MAY enable either, both, or — if at least one is enabled — proceed with export.

#### Scenario: Browser download only
- **WHEN** the user enables "Browser download" and disables "Save to data/exports/" and clicks export
- **THEN** the system SHALL trigger a browser download via Blob URL + `<a download>`, and SHALL NOT write any file to disk on the server

#### Scenario: Server-side save only
- **WHEN** the user disables "Browser download" and enables "Save to data/exports/" and clicks export
- **THEN** the system SHALL write the JSON to `data/exports/<originalStem>-<hash8>.json` (creating the directory if it does not exist), SHALL return the resulting filename to the UI, and SHALL NOT trigger any browser download

#### Scenario: Both deliveries enabled
- **WHEN** the user enables both toggles and clicks export
- **THEN** the system SHALL both write to disk AND trigger a browser download, returning the saved filename to the UI

#### Scenario: Both deliveries disabled blocks export
- **WHEN** both toggles are disabled
- **THEN** the Export button SHALL be disabled in the UI; if a request reaches the service anyway, the service SHALL reject it with a validation error

#### Scenario: Server-side save isolates from Sources
- **WHEN** a JSON is written to `data/exports/`
- **THEN** the file SHALL NOT appear in the Sources tab file list (which only walks `data/files/`)

#### Scenario: Server-side save rejects path traversal
- **WHEN** the resolved export path attempts to escape `data/exports/` (via `..` or absolute paths)
- **THEN** the system SHALL throw an error and SHALL NOT write any file

### Requirement: Content-hash deduplication for server-side save
The system SHALL skip the disk write for a server-side save when the target filename (`<originalStem>-<sha256_8>.json`) already exists in `data/exports/`, indicating a previous export of byte-identical source content. Browser downloads are not subject to this deduplication.

#### Scenario: First export writes the file
- **WHEN** the user exports a source file with `Save to data/exports/` enabled for the first time
- **THEN** the system SHALL compute the content hash, write `data/exports/<stem>-<hash8>.json`, and return `{ savedPath }` with no skip flag

#### Scenario: Repeat export of unchanged file skips disk write
- **WHEN** the user exports the same source file again (content unchanged) with `Save to data/exports/` enabled
- **THEN** the system SHALL detect that `data/exports/<stem>-<hash8>.json` already exists, SHALL NOT overwrite or rewrite it, and SHALL return `{ savedPath, skipped: true }` to the UI

#### Scenario: Browser download is not deduplicated
- **WHEN** the user exports the same source file repeatedly with only "Browser download" enabled
- **THEN** each click SHALL trigger a fresh browser download regardless of prior exports

#### Scenario: Source file modified after first export produces a new file
- **WHEN** the user modifies the source file content and exports again with `Save to data/exports/` enabled
- **THEN** the content hash SHALL differ, the target filename SHALL differ, and the system SHALL write a new file alongside the previous one

### Requirement: Preview before export
The system SHALL provide a preview that shows, per selected file, the detected format identifier, total extracted link count, a verbatim sample of the first lines of the source file's raw content, and a sample of the first 10 extracted links — without delivering the full JSON.

#### Scenario: Preview a single file
- **WHEN** the user selects a file and triggers preview
- **THEN** the system SHALL display the detected `LinkFormat`, total `Link[]` length, the first 10 non-empty lines of the source file verbatim (raw sample), and the first 10 `{url, title}` entries (extracted sample)

#### Scenario: Raw sample mirrors detector input
- **WHEN** the preview renders the raw source sample
- **THEN** the lines SHALL be collected using the same predicate the format detector saw (non-empty lines from `splitLines`), so the user can visually verify the format detection by eye (e.g., OneTab's `URL * Title`, CSV comma-separated rows, Netscape Bookmark HTML `<DT><A HREF=...>`)

#### Scenario: Raw and extracted samples are visually distinct
- **WHEN** the preview card renders both the raw source sample and the extracted link sample
- **THEN** the raw section SHALL be presented in a monospace block-preserving layout under a "Source (raw)" label, and the extracted section SHALL be presented separately under an "Extracted (N links)" label, so the user can compare the file's original form against the standardized output

#### Scenario: Preview with zero links
- **WHEN** the source file yields zero extractable links (empty file or unrecognized content)
- **THEN** the preview SHALL display `0 links` with the fallback `detectedFormat` (`url_only` for TXT, `json_array` for JSON), and the export button SHALL be disabled for that file

### Requirement: List focuses on files that need conversion
The Export tab SHALL, by default, hide source files whose detected format is `json_array` (i.e. files that are already in the standardized `[{url, title}, ...]` or `["url", ...]` form). The user MAY toggle this filter off to see and export those files anyway. The detected format of every listed file SHALL be visible as a per-row badge regardless of filter state.

#### Scenario: Default list hides already-standard JSON
- **WHEN** the user opens the Export tab and there exist files with `detectedFormat === 'json_array'`
- **THEN** those files SHALL NOT appear in the visible list, and the header SHALL display `<hiddenCount> hidden`

#### Scenario: Toggle reveals hidden files
- **WHEN** the user turns the "Hide already-standard JSON" toggle off
- **THEN** all source files SHALL appear in the list, each annotated with its `detectedFormat` badge

#### Scenario: Already-standard JSON badge is visually distinct
- **WHEN** a file's `detectedFormat === 'json_array'` is rendered as a badge in either the list row or the preview card
- **THEN** the badge SHALL use a distinct color (e.g. green) compared to other formats (e.g. blue) so the user can identify "no-conversion-needed" files at a glance

#### Scenario: Preview card annotates already-standard JSON explicitly
- **WHEN** the preview card renders a file whose `detectedFormat === 'json_array'`
- **THEN** in addition to the green format badge, the card SHALL display an explicit "already standard" badge so the user can confirm at a glance that exporting this file is essentially a copy operation

#### Scenario: Classification runs once per file inventory load
- **WHEN** the Export tab fetches the file inventory
- **THEN** the system SHALL run `export.classify` once in the background to populate per-file `detectedFormat` values, SHALL NOT block the initial list render, and SHALL surface any classification error as a non-blocking alert

#### Scenario: Classification uses detect-only path
- **WHEN** the service receives an `export.classify` request
- **THEN** it SHALL run the extractor registry's `detect` predicates only, SHALL NOT call `extract`, and SHALL return `[{ filename, detectedFormat }]` per file with `{ filename, error }` entries for unreadable files

#### Scenario: Tablerone and other structured JSON remain visible
- **WHEN** a `.json` file's `detectedFormat` is `tablerone_json` (or any non-`json_array` JSON-subformat)
- **THEN** the file SHALL remain visible in the default (filter-on) list because it still needs structural conversion

### Requirement: Path-traversal safety for server-side save
The system SHALL validate that every server-side write target resolves strictly inside `data/exports/` before writing.

#### Scenario: Reject escape attempt
- **WHEN** a computed export path normalizes to a location outside `data/exports/`
- **THEN** the system SHALL throw an "Invalid export path" error and SHALL NOT perform the write
