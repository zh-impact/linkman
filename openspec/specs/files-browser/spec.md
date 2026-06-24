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
The system SHALL display the unique URL list after deduplication and filtering.

#### Scenario: View resolved URLs
- **WHEN** the user visits Files → Resolved tab
- **THEN** the unique URL list is displayed, excluding duplicate_removed, filtered_internal, and filtered_similar statuses, with a total count

#### Scenario: Infinite scroll for resolved URLs
- **WHEN** the user scrolls to the bottom of the list
- **THEN** the next page of URLs is automatically loaded (500 per page)

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
