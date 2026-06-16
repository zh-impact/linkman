## ADDED Requirements

### Requirement: Dashboard statistics
The system SHALL display total link count and status-based statistics on the dashboard.

#### Scenario: View dashboard
- **WHEN** the user visits the home page
- **THEN** the system displays the Total Links count, Imported/Success/Pending highlight counts, and full status distribution

### Requirement: Skeleton loading
The system SHALL use skeleton placeholders during data loading, with static text (labels, titles) rendered immediately.

#### Scenario: Initial load
- **WHEN** the page loads and data has not returned
- **THEN** statistics numbers and dynamic list areas show Skeleton placeholders, while static labels and quick action buttons render immediately

### Requirement: Recent operations display
The system SHALL display the 5 most recent operations on the dashboard.

#### Scenario: View recent operations
- **WHEN** dashboard data finishes loading
- **THEN** the 5 most recent operations are displayed with type badges and timestamps

### Requirement: Quick actions navigation
The system SHALL provide quick navigation shortcuts on the dashboard.

#### Scenario: Navigate via quick action
- **WHEN** the user clicks a quick action button
- **THEN** the user is navigated to the corresponding page (Links, Files, Deduplicate, Filter, History)
