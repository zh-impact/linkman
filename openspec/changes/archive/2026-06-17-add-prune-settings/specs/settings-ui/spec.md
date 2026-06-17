## ADDED Requirements

### Requirement: Settings entry in the application header

The header SHALL display a Settings entry on the right side of the navigation, persistently visible on every route. The entry SHALL be a `NavLink` to `/settings` rendered with both an icon (gear) and a "Settings" label, and SHALL be hidden on the mobile collapsed-nav breakpoint alongside the other top-level routes.

#### Scenario: Settings entry is reachable from any page
- **WHEN** the user is on `/`, `/links`, `/files`, `/dedup`, `/filter`, or `/history`
- **THEN** the header shows a Settings entry on the right side that navigates to `/settings` on click

#### Scenario: Settings entry is styled as a navigation link
- **WHEN** the user is on `/settings`
- **THEN** the Settings entry in the header is visually marked as active (matching the existing `NavLink` active style applied to other routes)

### Requirement: Top-level Settings route and page shell

The application SHALL register `/settings` as a top-level route rendering a `SettingsPage` component. The page SHALL be wrapped in the standard `Container` layout used by other pages and SHALL render a top-of-page title.

#### Scenario: Navigating to /settings renders the page shell
- **WHEN** the user navigates to `/settings` (via the header entry or direct URL)
- **THEN** the page renders with a "Settings" title and an empty body ready to host settings sections

#### Scenario: Unknown /settings sub-paths are not registered in v1
- **WHEN** the user navigates to `/settings/something`
- **THEN** the route falls through to the index/404 behaviour of the existing router (no Settings sub-route is registered in this capability)

### Requirement: Danger zone banner is the initial page content

The Settings page SHALL render a prominent danger-zone banner as the first visible content, using Mantine's `Alert` component with `color="red"` and a title of "DANGER ZONE". The banner SHALL state that operations below are irreversible and require dry-run preview plus confirmation.

#### Scenario: Danger zone banner is visible above the fold
- **WHEN** the Settings page is rendered
- **THEN** a red-bordered alert titled "DANGER ZONE" appears at the top of the page content, above any prune section, with explanatory body text about irreversibility

#### Scenario: Danger zone banner is the only settings content in v1
- **WHEN** the Settings page is rendered with no prune sections wired in yet
- **THEN** the banner is visible and the page below it is empty (future settings sections can be appended without changing the banner)
