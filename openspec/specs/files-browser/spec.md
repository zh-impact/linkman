# Files Browser

## Purpose

Browse imported source file lists and contents, view resolved unique URLs, and trigger imports.

## Requirements

### Requirement: Source files browsing
The system SHALL support browsing imported source file lists and contents.

#### Scenario: View file list
- **WHEN** the user visits Files → Sources tab
- **THEN** the left panel displays the file list (filename, size, modification time), and the right panel displays the selected file content

#### Scenario: Virtual scrolling for file content
- **WHEN** the file content has many lines
- **THEN** virtual scrolling is used for rendering, supporting smooth scrolling

### Requirement: Delete source file
The system SHALL support deleting source files (with confirmation).

#### Scenario: Delete file
- **WHEN** the user clicks the delete button and confirms
- **THEN** the file is deleted from disk and the file list is refreshed

### Requirement: Resolved unique URLs
The system SHALL display the unique URL list after deduplication and filtering. The list SHALL reflect the latest database state every time the user enters the Resolved tab, so that newly-inserted links (from a first parse or a re-parse) appear without a full page reload.

#### Scenario: View resolved URLs
- **WHEN** the user visits Files → Resolved tab
- **THEN** the unique URL list is displayed, excluding duplicate_removed, filtered_internal, and filtered_similar statuses, with a total count

#### Scenario: Infinite scroll for resolved URLs
- **WHEN** the user scrolls to the bottom of the list
- **THEN** the next page of URLs is automatically loaded (500 per page)

#### Scenario: Resolved tab refreshes on re-entry
- **WHEN** the user navigates away from the Resolved tab (to Sources or Export) and then navigates back
- **THEN** the system refetches the first page of resolved URLs and resets pagination, so any inserts that happened while the user was on another tab appear immediately

#### Scenario: Resolved tab refreshes after a parse completes
- **WHEN** the user triggers a parse or re-parse from the Sources tab, the parse completes, and the user then switches to the Resolved tab
- **THEN** the resolved URL list SHALL reflect the newly-inserted rows without requiring a full browser refresh

### Requirement: Stale-source detection on the Sources tab
The webapp SHALL compute a per-file stale flag on the Sources tab by comparing the file's current modification time (from `files.list`) against the associated job's stored `fileMtime` (from `import.list`). When a file's job is `completed` but the file is stale, the Sources tab SHALL surface an actionable "Re-parse" control instead of the disabled "Parsed ✓" button.

#### Scenario: Sources list reflects current parse state
- **WHEN** the user visits the Files → Sources tab
- **THEN** the file list displays each file alongside the status badge of its associated job (pending / processing / completed / failed), and the parse toolbar reflects the selected file's job state

#### Scenario: Stale completed job surfaces a Re-parse action
- **WHEN** a file's job is `completed` AND the file's current modification time differs from the job's stored `fileMtime`
- **THEN** the toolbar Parse button SHALL show the label "Re-parse", SHALL be enabled (clickable), SHALL be colored as an actionable control (not the green disabled "Parsed ✓" state). The type/strategy selectors SHALL remain **disabled** because re-parse must reuse the original `type` and `strategy` (changing either would break the source-file diff filter); if the user wants a different `type` or `strategy`, they must delete the job and re-import

#### Scenario: Unchanged completed job stays in Parsed ✓ state
- **WHEN** a file's job is `completed` AND the file's current modification time equals the job's stored `fileMtime`
- **THEN** the toolbar Parse button SHALL show the label "Parsed ✓", SHALL be disabled, and SHALL be colored green — identical to pre-change behavior

#### Scenario: Pending and processing jobs ignore staleness
- **WHEN** a file's job is `pending` or `processing`, regardless of the file's modification time
- **THEN** the toolbar Parse button SHALL show "Parse" (pending) or "Resume" (processing) as before; staleness is irrelevant because no `fileMtime` was captured for pending jobs and the user already has an actionable control

### Requirement: Import modal
The system SHALL provide import functionality via a modal on the Files page.

#### Scenario: Open import modal
- **WHEN** the user clicks the Import button
- **THEN** a modal opens showing file selection/clipboard paste, type selection, content preview, and an import button

### Requirement: Export tab on the Files page
The Files page SHALL include a third tab labeled "Export" alongside the existing "Sources" and "Resolved" tabs. The Export tab is the entry point for converting source files to standardized JSON outputs and SHALL NOT share state with the Sources or Resolved tabs.

#### Scenario: Tab navigation
- **WHEN** the user visits the Files page
- **THEN** three tabs SHALL be visible in order: "Sources", "Resolved", "Export"

#### Scenario: Export tab is independent of Sources state
- **WHEN** the user is mid-parse in the Sources tab and switches to the Export tab
- **THEN** the Export tab SHALL render its own file list and controls, with no shared selection or parse-progress state with Sources

#### Scenario: Export tab uses the same source file list
- **WHEN** the Export tab is rendered
- **THEN** it SHALL display the same source file inventory as the Sources tab (filenames under `data/files/`), but with multi-select semantics (checkboxes) rather than single-select navigation

### Requirement: Cross-page status rendering consistency
The system SHALL render link-status labels and colors identically across every page that displays them (Files, Links, Dedup, Filter, History, Home, Import), backed by a single shared configuration source rather than per-page inline copies.

#### Scenario: Status label rendered the same on every page
- **WHEN** a link with status `dns_failed` appears in the Links table, the Dedup grouped view, the Filter results, and any other page that renders status badges
- **THEN** the badge text SHALL be identical on every page (e.g., `DNS Failed`) and the badge color SHALL be identical (e.g., `red`), with no per-page overrides

#### Scenario: Single source of truth for status configuration
- **WHEN** the system needs to change how a status is rendered (e.g., relabel `connection_refused` from `Refused` to `Connection Refused`, or recolor `success` from green to teal)
- **THEN** exactly one configuration entry SHALL need updating, and every affected page SHALL pick up the change on the next render without requiring coordinated multi-file edits

#### Scenario: Status filter dropdown reflects the canonical status list
- **WHEN** the user opens the status-filter dropdown on any page that exposes one
- **THEN** the options SHALL be drawn from the same shared configuration, in the same order, with the same labels as the badges

### Requirement: Reusable file-size formatting
The system SHALL format byte counts into human-readable form (B / KB / MB) via a single shared formatter, so that every page rendering file sizes displays them with identical thresholds, units, and decimal precision.

#### Scenario: File size rendered consistently
- **WHEN** a file's byte count is rendered on the Files page, the Export tab, or any other page that displays file sizes
- **THEN** the formatting SHALL be identical for any given byte count (e.g., `1536` bytes always renders as `1.5 KB`, never `1536 B` on one page and `1.5 KB` on another)
