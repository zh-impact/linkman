# Link Filter

## Purpose

Filter links by detecting internal addresses and applying similarity-based grouping.

## Requirements

### Requirement: Internal address filter
The system SHALL detect links pointing to private IP addresses (localhost, 10.x, 172.16-31.x, 192.168.x, 169.254.x).

#### Scenario: Preview internal links
- **WHEN** the user clicks Preview
- **THEN** the system returns the internal link count, external link count, and internal link ID list

#### Scenario: Execute internal filter
- **WHEN** the user confirms execution
- **THEN** matching links have their status updated to `filtered_internal` and isInternal set to true

### Requirement: Similarity filter with method selection
The system SHALL support three mutually exclusive similarity detection methods, selectable via a radio group.

#### Scenario: Group by domain
- **WHEN** the domain method is selected
- **THEN** links are grouped by domain name, with same-domain links in one group

#### Scenario: Group by path prefix
- **WHEN** the path_prefix method is selected with a specified depth
- **THEN** links are grouped by domain + path prefix at the specified depth

#### Scenario: Edit distance
- **WHEN** the edit_distance method is selected with a specified threshold
- **THEN** links are grouped based on URL edit distance similarity

### Requirement: Progressive result delivery for edit distance
The system SHALL return edit_distance results in batches to avoid prolonged blocking.

#### Scenario: Paginated edit distance preview
- **WHEN** the edit_distance preview involves a large number of links
- **THEN** the system returns results batched by domain, with each batch including processed/total domain count progress, and the frontend progressively accumulates groups

### Requirement: Selective group filtering
The system SHALL allow users to select a subset of similarity groups for filtering.

#### Scenario: Select and filter
- **WHEN** the user checks several groups and clicks Filter Selected
- **THEN** only duplicate links within selected groups have their status updated to `filtered_similar`

### Requirement: Expandable group cards
The system SHALL support expanding group cards by clicking to view all URL details within the group.

#### Scenario: Expand group
- **WHEN** the user clicks the group header
- **THEN** the group expands to show all URLs, with the keep item marked in green and duplicates in blue, and URLs are clickable links
