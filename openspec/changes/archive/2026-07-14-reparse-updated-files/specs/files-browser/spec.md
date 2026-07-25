## MODIFIED Requirements

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

## ADDED Requirements

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
