# Prune Operations

## Purpose

Provide irreversible prune operations across four layers (links / database / files / audit history) behind a two-phase dry-run + confirmation-token lifecycle so users can preview impact before deletion.
## Requirements
### Requirement: Two-phase prune lifecycle with confirmation token

Every destructive prune operation SHALL go through a two-phase lifecycle: (1) `prune.dryRun({ kind, params? })` returns a preview without mutating state, and (2) `prune.execute({ kind, params?, confirmToken })` performs the deletion. The `confirmToken` returned by `dryRun` SHALL be a server-generated UUID, stored in-memory with a 5-minute TTL, and `execute` SHALL reject the request if the token is missing, expired, or was issued for a different `kind`/`params` combination.

#### Scenario: Dry-run returns preview without mutating state
- **WHEN** `prune.dryRun` is called with any valid `{ kind, params? }`
- **THEN** the system computes the affected row count and a representative sample (up to 10 rows), generates a UUID `confirmToken`, stores `{ kind, params, expiresAt }` in memory with `expiresAt = now + 5min`, returns `{ confirmToken, count, cascadeCounts, sample }`, and does NOT modify any database row or file

#### Scenario: Execute without valid token is rejected
- **WHEN** `prune.execute` is called with a `confirmToken` that is missing, expired, or was issued for a different `kind` or `params`
- **THEN** the system rejects with `UNAUTHORIZED` and does not perform any deletion

#### Scenario: Execute with valid token deletes and invalidates the token
- **WHEN** `prune.execute` is called with a matching `confirmToken`
- **THEN** the system performs the deletion described by `{ kind, params }`, removes the token from the in-memory store, and returns `{ deletedCount }`

#### Scenario: Token expires after 5 minutes
- **WHEN** more than 5 minutes have elapsed since `dryRun` returned a token and the user then calls `execute`
- **THEN** the system rejects with `UNAUTHORIZED` with a message indicating the preview has expired and must be re-run

### Requirement: Links-layer prune with four sub-operations

The system SHALL support `kind: 'duplicate' | 'internal' | 'by-domain' | 'all'` for links-layer pruning, each with defined semantics:

- `duplicate`: delete rows where `duplicateOf IS NOT NULL`.
- `internal`: delete rows where `isInternal = true`.
- `by-domain`: delete rows whose `domain` is in the `params.domains` array.
- `all`: delete every row in `links`.

Each sub-operation SHALL report cascade-affected `test_results` rows in `cascadeCounts` (since `test_results.linkId` has `onDelete: cascade`).

#### Scenario: Duplicate prune deletes only marked-duplicate rows
- **WHEN** `prune.execute` is called with `{ kind: 'duplicate', confirmToken }` after a successful dryRun
- **THEN** the system deletes every row in `links` where `duplicateOf IS NOT NULL`, leaves all other rows untouched, and the returned `deletedCount` equals the dryRun's `count`

#### Scenario: Internal prune deletes only internal-flagged rows
- **WHEN** `prune.execute` is called with `{ kind: 'internal', confirmToken }`
- **THEN** the system deletes every row in `links` where `isInternal = true` and leaves `isInternal = false` rows untouched

#### Scenario: by-domain prune deletes rows matching selected domains
- **WHEN** `prune.execute` is called with `{ kind: 'by-domain', params: { domains: ['example.com', 'test.org'] }, confirmToken }`
- **THEN** the system deletes every row in `links` whose `domain` is in the provided list; rows with other domains remain

#### Scenario: by-domain prune rejects an empty domains list
- **WHEN** `prune.execute` (or `prune.dryRun`) is called with `{ kind: 'by-domain', params: { domains: [] } }`
- **THEN** the system rejects with `BAD_REQUEST` and does not perform any deletion (defensive — empty selection is a no-op that would surprise the user)

#### Scenario: all-links prune deletes every row and cascades test_results
- **WHEN** `prune.execute` is called with `{ kind: 'all', confirmToken }`
- **THEN** the system deletes every row in `links`, the cascade deletes all `test_results` rows (via the FK), and `cascadeCounts.testResults` in the dryRun preview reflects the to-be-deleted test_results count

### Requirement: Database-layer prune clears links and import_jobs

The system SHALL support `kind: 'database'` which truncates both `links` and `import_jobs` tables in a single transaction. `test_results` rows SHALL cascade-delete with the links; `operations.jobId` references SHALL become NULL via the FK `onDelete: set null`. `operations` and `snapshots` tables SHALL be preserved.

#### Scenario: Database prune clears both tables atomically
- **WHEN** `prune.execute` is called with `{ kind: 'database', confirmToken }`
- **THEN** the system deletes all rows from `links` and `import_jobs` within a single transaction (either both succeed or both roll back), `test_results` becomes empty via cascade, and `operations.jobId` values become NULL

#### Scenario: Operations and snapshots history is preserved
- **WHEN** `prune.execute` runs the database prune
- **THEN** the `operations` and `snapshots` tables retain all their rows (only `jobId` foreign-key columns are nullable-cleared on `operations`)

#### Scenario: Dry-run reports cascade counts
- **WHEN** `prune.dryRun` is called with `{ kind: 'database' }`
- **THEN** the response includes `count` (links), `jobCount` (import_jobs), and `cascadeCounts.testResults` (rows that will be removed via the links FK cascade)

### Requirement: Files-layer prune deletes files and matching import_jobs

The system SHALL support `kind: 'files'` which deletes every file under `data/files/` AND every `import_jobs` row whose `source_content` matches one of the deleted filenames. The operation SHALL NOT delete `links` rows (that is the database-layer prune's responsibility).

#### Scenario: Files prune removes all on-disk files
- **WHEN** `prune.execute` is called with `{ kind: 'files', confirmToken }`
- **THEN** the system `unlink`s every regular file in `data/files/` (recursive), the directory itself remains, and `listFiles()` immediately after returns an empty array

#### Scenario: Files prune cascades import_jobs
- **WHEN** `prune.execute` runs the files prune and there exist `import_jobs` rows whose `source_content` matches a deleted filename
- **THEN** those `import_jobs` rows are deleted in the same operation, leaving only jobs whose `source_content` does not match any on-disk file (legacy jobs with embedded content strings may remain)

#### Scenario: Files prune does not touch links
- **WHEN** `prune.execute` runs the files prune
- **THEN** no `DELETE` is issued against the `links` table; the link rows imported from those files remain queryable

### Requirement: Audit-history prune clears operations and snapshots

The system SHALL support `kind: 'audit'` which truncates both the `operations` and `snapshots` tables in a single transaction. This operation is independent of the `database` prune so the user can wipe link/job data while preserving history, or wipe history while preserving links, or both. Neither table is referenced by foreign keys from other tables, so no cascade counts apply.

#### Scenario: Audit prune clears both tables atomically
- **WHEN** `prune.execute` is called with `{ kind: 'audit', confirmToken }`
- **THEN** the system deletes all rows from `operations` and `snapshots` within a single transaction (either both succeed or both roll back) and returns `{ deletedCount, snapshotsDeleted }` reflecting the rows removed from each table

#### Scenario: Audit prune does not touch links or import_jobs
- **WHEN** `prune.execute` runs the audit prune
- **THEN** no `DELETE` is issued against the `links`, `import_jobs`, `test_results`, or `test_jobs` tables; only `operations` and `snapshots` are affected

#### Scenario: Dry-run reports per-table counts and samples from both tables
- **WHEN** `prune.dryRun` is called with `{ kind: 'audit' }`
- **THEN** the response includes `count` (operations count), `snapshotCount` (snapshots count), `sample` (first 10 operations by `timestamp desc`), and `snapshotSample` (first 10 snapshots by `createdAt desc`, each with `id`, `createdAt`, and `linkCount`) so the user can sanity-check what history will be lost from BOTH tables — important when one table is empty but the other has rows

### Requirement: by-domain selection uses virtualized grouped checkboxes

The Settings page SHALL render the by-domain prune selector as a virtualized list of distinct domains, each row showing a checkbox, the domain string, and the per-domain link count. The list SHALL use `@tanstack/react-virtual` so that DOM nodes stay bounded (around 20) regardless of how many distinct domains exist. The user SHALL be able to multi-select via the checkboxes; the selected set is passed as `params.domains` to `prune.dryRun` and `prune.execute`.

#### Scenario: Domain list renders without lag at scale
- **WHEN** the by-domain selector is rendered with thousands of distinct domains
- **THEN** only ~20 row DOM nodes exist at any time (virtualization active), and scrolling is smooth

#### Scenario: Per-domain count is shown alongside each checkbox
- **WHEN** the by-domain selector renders a row
- **THEN** the row displays the domain string, the count of links with that domain, and a checkbox reflecting selection state

#### Scenario: Selection state is the source of truth for dry-run params
- **WHEN** the user toggles checkboxes and clicks the Dry-run button
- **THEN** the request body's `params.domains` array exactly matches the currently-checked domains, in the order they appear in the list

### Requirement: Settings page danger zone composes prune sections

The Settings page danger zone SHALL compose four sections (Links / Database / Files / Audit history), each rendering: (a) a section title, (b) the current affected count (fetched via `prune.dryRun` on section mount or refresh), (c) a Dry-run button that triggers preview, (d) an Execute button styled `color="red"` that is disabled until a valid `confirmToken` exists for that section's last preview.

#### Scenario: Each section shows live count on page mount
- **WHEN** the Settings page is rendered
- **THEN** each of the four prune sections displays its current affected count (e.g. "1,234 duplicates", "47 jobs + 12,500 links", "13 files / 23.4 MB", "47 operations / 5 snapshots") by calling `prune.dryRun` once per section on mount

#### Scenario: Execute button is disabled until dry-run completes
- **WHEN** a section's dry-run has not been called or its token has expired
- **THEN** the Execute button is visually disabled and clicking it has no effect

#### Scenario: Successful execute refreshes counts across sections
- **WHEN** an `execute` call succeeds
- **THEN** the affected-count badges for every prune section are refetched and re-rendered to reflect the new state (e.g. after deleting all duplicate links, the duplicates count becomes 0 and the database-prune total decreases)
