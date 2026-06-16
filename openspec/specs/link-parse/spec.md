# link-parse Specification

## Purpose
TBD - created by archiving change split-import-parse-flow. Update Purpose after archive.
## Requirements
### Requirement: Parse an imported source file into links
The system SHALL provide a `parse.start` procedure that, given a `jobId`, reads the imported source file referenced by the job, extracts URLs (TXT line-by-line or JSON array), validates them, and transitions the job to `processing` without yet inserting any links. Parsing is deferred from import and triggered explicitly.

#### Scenario: Start parsing a pending job
- **WHEN** `parse.start` is called with a `jobId` whose status is `pending`
- **THEN** the system reads the source file, extracts and validates URLs, caches the result, sets the job status to `processing`, and returns `{ totalValid, invalidCount }`

#### Scenario: Reject parsing a completed job
- **WHEN** `parse.start` is called with a `jobId` whose status is `completed`
- **THEN** the system rejects the request with a conflict error and does not modify the job

#### Scenario: Override type or strategy at parse start
- **WHEN** `parse.start` is called with a `type` or `strategy` differing from the job's stored values and the job is not `completed`
- **THEN** the system updates the job row with the new `type`/`strategy` before extracting URLs

### Requirement: Progressive batch insertion with atomic counters
The system SHALL provide a `parse.batch` procedure that inserts the next batch of links (default 500) for a `processing` job and returns progressive progress. Counters SHALL be incremented atomically so concurrent batches cannot lose updates.

#### Scenario: Process one batch
- **WHEN** `parse.batch` is called with a `jobId` that is `processing` and has remaining URLs
- **THEN** the system inserts up to `batchSize` links, atomically increments `importedCount`, and returns `{ importedCount, totalValid, errorCount, done: false, status: 'processing' }`

#### Scenario: Complete the final batch
- **WHEN** `parse.batch` inserts the last remaining URLs so that `importedCount` reaches `totalValid`
- **THEN** the system sets the job status to `completed`, records `completedAt`, clears the in-memory cache for the job, and returns `{ done: true, status: 'completed' }`

#### Scenario: Concurrent batches do not corrupt the counter
- **WHEN** two `parse.batch` calls for the same job run concurrently
- **THEN** each inserts a distinct slice of URLs and the final `importedCount` equals `totalValid` exactly (no lost or double increments)

### Requirement: Resumable parsing after cache loss
The system SHALL reconstruct parse state from the source file when the in-memory URL cache for a job is missing, so that parsing can resume after a service restart.

#### Scenario: Resume after service restart
- **WHEN** `parse.batch` is called for a `processing` job whose cache entry is missing
- **THEN** the system re-reads the source file, re-runs extraction and validation deterministically, slices URLs starting at the current `importedCount`, and continues insertion

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

