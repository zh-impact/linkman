# link-search

URL-component-aware search for links, including multi-select targeting, Google-style prefixed syntax, full-text fallback for unparseable URLs, and a non-breaking extension to the existing `links.search` tRPC query.

## Requirements

### Requirement: URL-component search targeting
The system SHALL allow the user to target a search query at one or more of four URL components — `host`, `path`, `search`, `hash` — so that matches are restricted to the selected components rather than the entire URL string.

#### Scenario: Search a single component
- **WHEN** the user enters `pull` as the query and selects only the `path` component
- **THEN** the system SHALL return only rows whose URL path contains `pull` (e.g., `https://github.com/foo/bar/pull/123` matches; `https://example.com/pullrequest` matches; `https://pull.example.com/` does NOT match because `pull` is in the host, not the path)

#### Scenario: Search multiple components (OR semantics)
- **WHEN** the user enters `login` as the query and selects `path` and `search`
- **THEN** the system SHALL return any row where `login` appears in the path OR in the query string (e.g., `/users/login` matches via path; `/?action=login` matches via search; `/home` with no `login` anywhere does NOT match)

#### Scenario: Default selection is all four components
- **WHEN** the user opens the advanced-search UI without modifying the component selection
- **THEN** all four components (`host`, `path`, `search`, `hash`) SHALL be selected, and the system SHALL produce a result set byte-identical to the existing free-text search (matches against `originalUrl | normalizedUrl | domain | title | tags`). Title/tags matches are preserved because the user has not narrowed.

#### Scenario: Empty selection is treated as default
- **WHEN** the user deselects all four components and submits a query (without any prefixed terms)
- **THEN** the system SHALL behave byte-identically to the default selection (and to Advanced-off), producing the same result set as the existing free-text search. Title/tags matches are preserved because the empty state is a degenerate fallback, not a narrowing gesture.

### Requirement: Full-text fallback for invalid URLs
The system SHALL match rows whose stored URL cannot be parsed into components via full-text LIKE against the raw `originalUrl`, regardless of which components the user selected.

#### Scenario: Malformed URL still appears in results
- **WHEN** the user queries `example` targeting the `host` component, and a row's stored `normalizedUrl` is a malformed string that does not parse via the URL constructor
- **THEN** that row SHALL be included in the results iff its `originalUrl` contains `example` as a substring, even though the system cannot extract a `host` component from it

#### Scenario: Valid URLs are not double-matched
- **WHEN** a row's URL parses successfully into components
- **THEN** the full-text fallback SHALL NOT also apply to that row (the row matches only if the targeted-component conditions are satisfied)

### Requirement: URL components stored at write time
The system SHALL parse each link's `originalUrl` into `urlPath`, `urlQuery`, `urlHash` text columns at the time the link is inserted, so that URL-component search uses indexed LIKE on dedicated columns rather than parsing URLs at query time. The source SHALL be `originalUrl` (the raw user-typed/imported form), NOT `normalizedUrl`, because the default normalization config strips the fragment, `www.` host prefix, and trailing slashes — extracting from `normalizedUrl` would silently break hash-targeted search and `www.`-prefixed host queries.

#### Scenario: New link populates component columns
- **WHEN** a link with `originalUrl = https://www.example.com/foo/bar?q=1#section` is inserted (using the default `'normalized'` strategy)
- **THEN** the stored row SHALL have `domain=www.example.com`, `urlPath=/foo/bar`, `urlQuery=q=1`, `urlHash=section` (note: `domain` and the new component columns retain `www.` and the fragment because they are extracted from `originalUrl`, not the lossy `normalizedUrl`)

#### Scenario: Unparseable URL leaves component columns null
- **WHEN** a link's `originalUrl` is a malformed string that the URL constructor rejects
- **THEN** the stored row SHALL have `urlPath`, `urlQuery`, `urlHash` set to NULL, while `originalUrl` and `normalizedUrl` remain populated

#### Scenario: Backfill migration populates pre-existing rows
- **WHEN** the system is upgraded and pre-existing rows have NULL component columns
- **THEN** a one-time backfill SHALL iterate every row, parse its `originalUrl`, and populate the three component columns where possible; the backfill SHALL be idempotent (running it twice produces the same state as running it once)

### Requirement: Google-style prefixed syntax
The system SHALL accept a prefixed-query syntax in the same search box, where each prefix (`host:`, `path:`, `search:`, `hash:`) restricts the value that follows to the named component. This syntax SHALL coexist with the multi-select UI and stay in sync with it.

#### Scenario: Single prefixed term
- **WHEN** the user types `host:github.com` in the search box (with no other text)
- **THEN** the system SHALL return only rows whose host is (or contains) `github.com`, regardless of which components are selected in the UI

#### Scenario: Multiple prefixed terms with different prefixes AND together
- **WHEN** the user types `host:github.com path:pull`
- **THEN** the system SHALL return rows where the host matches `github.com` AND the path matches `pull`

#### Scenario: Multiple prefixed terms with the same prefix OR together
- **WHEN** the user types `host:github.com host:gitlab.com`
- **THEN** the system SHALL return rows where the host matches `github.com` OR `gitlab.com`

#### Scenario: Prefixed term overrides UI selection for that component
- **WHEN** the user has deselected `host` in the UI but types `host:example.com` in the search box
- **THEN** the host-targeted condition SHALL still apply (the prefix overrides the UI selection for that component)

#### Scenario: Unrecognized prefix treated as bare text
- **WHEN** the user types `foo:bar` where `foo` is not one of the four recognized prefixes
- **THEN** the entire token `foo:bar` SHALL be treated as a bare search term and matched against the UI-selected components

#### Scenario: Bare term combined with prefixed terms
- **WHEN** the user types `host:github.com pull` (one prefixed term + one bare term) and the UI has `path` and `search` selected
- **THEN** the system SHALL return rows where (host matches `github.com`) AND (path or search matches `pull`)

### Requirement: UI and syntax two-way binding
The system SHALL keep the multi-select UI and the search-box text in sync, so that toggling a component checkbox updates the query text and typing a prefixed term updates the checkbox selection.

#### Scenario: Typing a prefix adds the component to the selection
- **WHEN** the user types `host:example.com` into the search box
- **THEN** the `host` checkbox SHALL become checked (without affecting the other checkboxes)

#### Scenario: Toggling a checkbox off strips the corresponding prefixed term
- **WHEN** the search box contains `host:example.com path:login` and the user unchecks `host`
- **THEN** the search box SHALL update to `path:login` (the host term is removed)

#### Scenario: Toggling a checkbox on with no corresponding prefixed term leaves the text alone
- **WHEN** the search box contains only a bare term `login` and the user checks the `hash` component
- **THEN** the search box SHALL remain `login` (no `hash:` token is added); the bare term is now also matched against the hash component

#### Scenario: Incomplete prefix treated as bare text
- **WHEN** the user is typing and the search box contains `host:` with no value yet
- **THEN** the parser SHALL treat the token as bare text rather than flipping the host checkbox, so that mid-typing cursor state stays stable

### Requirement: Advanced-search UI toggle
The system SHALL expose an "Advanced" toggle on the Links page search bar. When off, search behaves exactly as it does today (free-text across all stored columns). When on, the system reveals the component-checkbox group and activates the URL-component targeting behavior.

#### Scenario: Toggle off preserves existing behavior
- **WHEN** the user has the "Advanced" toggle off and types `github` in the search box
- **THEN** the system SHALL run the existing free-text search (LIKE across `originalUrl | normalizedUrl | domain | title | tags`) and return the same results as before this change

#### Scenario: Toggle on reveals component selection
- **WHEN** the user turns the "Advanced" toggle on
- **THEN** a checkbox group with `host`, `path`, `search`, `hash` SHALL appear below (or beside) the search box, with all four checked by default

#### Scenario: Toggle state persists across page loads
- **WHEN** the user has "Advanced" on, navigates away, and returns to the Links page
- **THEN** the toggle SHALL remember its prior state (using the same persistence mechanism as the page's other UI state)

### Requirement: Non-breaking extension to the search API
The system SHALL extend the existing `links.search` tRPC query with an optional `searchParts` input rather than introducing a new endpoint. Existing callers that omit `searchParts` SHALL observe no behavioral change.

#### Scenario: Existing caller behavior is unchanged
- **WHEN** a caller invokes `links.search` with only `search: 'github'` and no `searchParts`
- **THEN** the system SHALL run the existing free-text search and return the same results as before this change

#### Scenario: Caller can pass searchParts explicitly
- **WHEN** a caller invokes `links.search` with `search: 'pull'` and `searchParts: ['path']`
- **THEN** the system SHALL restrict the `pull` match to the path component

#### Scenario: Prefixed terms in the search string take precedence
- **WHEN** a caller invokes `links.search` with `search: 'host:example.com pull'` and `searchParts: ['path']`
- **THEN** the system SHALL apply the host-targeted condition from the prefix AND apply the bare `pull` term to the UI-selected `path` component
