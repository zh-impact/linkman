# Link Testing

## Purpose

Test link availability via configurable methods with concurrent execution and result persistence.

## Requirements

### Requirement: Test link availability
The system SHALL support testing link availability via DNS, HEAD, and GET methods.

#### Scenario: DNS test
- **WHEN** the user selects the DNS method and executes
- **THEN** the system resolves the link domain and returns resolution success/failure status

#### Scenario: HEAD test
- **WHEN** the user selects the HEAD method and executes
- **THEN** the system sends a HEAD request and returns the status code and response time

#### Scenario: GET test
- **WHEN** the user selects the GET method and executes
- **THEN** the system sends a GET request and returns the status code, response time, Content-Type, and Content-Length

### Requirement: Concurrent testing
The system SHALL support configurable concurrency for batch testing.

#### Scenario: Batch test with concurrency
- **WHEN** the user specifies a concurrency level and starts testing
- **THEN** the system executes tests at the specified concurrency and returns real-time progress (completed/total/failed)

### Requirement: Test results persistence
The system SHALL persist test results to the database.

#### Scenario: Store test result
- **WHEN** a single link test completes
- **THEN** the result (method, status, status code, response time, etc.) is written to the test_results table
