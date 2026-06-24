## ADDED Requirements

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
