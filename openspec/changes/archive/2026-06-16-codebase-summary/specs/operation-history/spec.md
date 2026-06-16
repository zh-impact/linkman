## ADDED Requirements

### Requirement: Operation logging
The system SHALL record all change operations (import, dedup, filter, test, manual tag/delete, rollback) to the operations table.

#### Scenario: Log after operation
- **WHEN** any change operation completes
- **THEN** the system records the operation type, before/after snapshot hashes, change details (added/removed/modified), and statistics

### Requirement: Snapshot-based rollback
The system SHALL support rolling back link state to before a specified operation based on snapshots.

#### Scenario: Rollback to operation
- **WHEN** the user selects a historical operation and executes rollback
- **THEN** the system finds the most recent snapshot before that operation and restores link state to the snapshot's recorded state

#### Scenario: Snapshot interval
- **WHEN** the number of operations since the last snapshot reaches the threshold
- **THEN** the system automatically creates a new snapshot, recording all link IDs and checksums

### Requirement: Operation history listing
The system SHALL support paginated queries of operation history.

#### Scenario: List operations
- **WHEN** the user visits the history page
- **THEN** the system returns operations in reverse chronological order with pagination support

#### Scenario: Delete operation record
- **WHEN** the user deletes an operation record
- **THEN** the record is removed from the operations table
