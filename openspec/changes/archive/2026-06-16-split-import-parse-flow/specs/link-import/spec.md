## MODIFIED Requirements

### Requirement: Import links from file or clipboard
The system SHALL accept a source file upload or clipboard paste, persist the raw content to the `data/files/` directory, and create an `importJobs` row with `status='pending'`. The import step SHALL NOT extract URLs, validate them, or insert any links — parsing is deferred to the `link-parse` capability. The procedure SHALL infer the default `type` from the filename suffix (`.json` → JSON, otherwise TXT) when not provided, and default the `strategy` to `normalized`.

#### Scenario: Import a TXT file
- **WHEN** the user uploads a `.txt` file
- **THEN** the system writes the content to `data/files/{timestamp}-{filename}`, creates an importJob with `type='TXT'`, `status='pending'`, `importedCount=0`, and returns `{ jobId, filename }` without inserting any links

#### Scenario: Import a JSON file
- **WHEN** the user uploads a `.json` file
- **THEN** the system writes the content to disk, creates an importJob with `type='JSON'`, `status='pending'`, and returns `{ jobId, filename }` without parsing the JSON or inserting links

#### Scenario: Paste from clipboard
- **WHEN** the user clicks "Paste from Clipboard" and imports
- **THEN** the system writes the clipboard content to `data/files/clipboard-{timestamp}.txt`, creates an importJob with `status='pending'`, and returns `{ jobId, filename }`

#### Scenario: Imported file is not yet parsed
- **WHEN** an import completes
- **THEN** the links table is unchanged and the job remains `pending` until the user explicitly triggers parsing from the Files page

## REMOVED Requirements

### Requirement: Dedup strategy on import
**Reason**: Import no longer extracts URLs or inserts links, so deduplication/normalization strategy is no longer applied at import time. Strategy selection now happens at parse time and is covered by the `link-parse` capability (the job stores a default strategy that `parse.start` can override).
**Migration**: Callers that relied on import returning an `importedCount` or applying a strategy must instead trigger `parse.start` + `parse.batch` after import. The existing Files ImportModal is updated in this change to remove the strategy selector and result panel.
