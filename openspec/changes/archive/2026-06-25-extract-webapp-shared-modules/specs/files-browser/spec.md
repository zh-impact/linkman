## ADDED Requirements

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
