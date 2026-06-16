# Link Deduplication

## Purpose

Detect and remove duplicate links based on configurable deduplication strategies.

## Requirements

### Requirement: Preview duplicate groups
The system SHALL support previewing duplicate link groups, returning the keep link and duplicate link details for each group.

#### Scenario: Preview with groups
- **WHEN** the user selects a strategy and clicks Preview
- **THEN** the system returns the total duplicate count, remaining count, and a list of groups, each containing keepUrl, duplicateUrls, and normalizedUrl

#### Scenario: Preview with no duplicates
- **WHEN** previewing with no duplicate links
- **THEN** the system returns duplicateCount=0 and an empty groups array

### Requirement: Dedup strategies
The system SHALL support three deduplication strategies.

#### Scenario: Strict strategy
- **WHEN** strict is selected
- **THEN** grouping is based on exact original URL matching

#### Scenario: Normalized strategy
- **WHEN** normalized is selected
- **THEN** grouping is based on URL normalization (configurable rules such as forceHttps, removeWww, removeTrailingSlash) before matching

#### Scenario: Smart strategy
- **WHEN** smart is selected
- **THEN** grouping is based on heuristic matching after www removal and trailing slash removal

### Requirement: Execute deduplication
The system SHALL mark duplicate link status as `duplicate_removed`, keeping the first link in each group.

#### Scenario: Execute after preview
- **WHEN** the user confirms deduplication execution
- **THEN** all duplicate links have their status updated to `duplicate_removed` with duplicateOf pointing to the keep link ID

### Requirement: Virtual scrolling for large group lists
The system SHALL use virtual scrolling when the number of groups exceeds 20.

#### Scenario: Many duplicate groups
- **WHEN** preview results contain more than 20 groups
- **THEN** the group list uses virtual scrolling, rendering only cards in the visible area
