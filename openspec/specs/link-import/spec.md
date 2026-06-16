# Link Import

## Purpose

Import links from files or clipboard, deduplicate during import, and persist source content.

## Requirements

### Requirement: Import links from file or clipboard
The system SHALL support importing links from `.txt` files, `.json` files, or clipboard-pasted content.

#### Scenario: Import TXT file
- **WHEN** the user uploads a `.txt` file and selects TXT type
- **THEN** the system parses URLs line by line and returns the imported count and list of invalid lines

#### Scenario: Import JSON file
- **WHEN** the user uploads a `.json` file
- **THEN** the system parses URLs from the JSON array and returns the imported count and list of invalid entries

#### Scenario: Paste from clipboard
- **WHEN** the user clicks "Paste from Clipboard"
- **THEN** the system reads clipboard content and auto-detects the format (JSON array or plain text)

### Requirement: Dedup strategy on import
The system SHALL deduplicate links during import based on the specified strategy.

#### Scenario: Strict strategy
- **WHEN** the import strategy is strict
- **THEN** only exact URL matches are treated as duplicates

#### Scenario: Normalized strategy
- **WHEN** the import strategy is normalized
- **THEN** URLs matching after normalization (remove fragment, sort query params, etc.) are treated as duplicates

### Requirement: Persist source content to disk
The system SHALL persist imported raw file content to the `data/files/` directory, with filenames formatted as `{timestamp}-{originalFilename}`.

#### Scenario: File upload import
- **WHEN** the user uploads a file `bookmarks.json`
- **THEN** the file content is written to `data/files/{timestamp}-bookmarks.json`

#### Scenario: Clipboard import
- **WHEN** the user imports from clipboard
- **THEN** the content is written to `data/files/clipboard-{timestamp}.txt`
