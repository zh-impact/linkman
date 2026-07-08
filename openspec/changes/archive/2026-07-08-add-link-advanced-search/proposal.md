## Why

The Links page's search today is a single LIKE pass over `originalUrl | normalizedUrl | domain | title | tags` (see `apps/service/src/lib/db/queries.ts:168`). For a query like `github`, that means a row matches whether `github` appears in the host, the path, the query string, or the fragment — the user can't narrow it. The result is over-broad matches on large datasets (a `path:pull` query against the host, a `host:example.com` query against the path, etc.). For valid URLs the user almost always knows which part they're targeting; today there's no way to express that.

The requirement: let the user target the search string at specific URL components (`host`, `path`, `search`, `hash`), multi-selectable. For raw strings that don't parse as URLs (a small minority — bookmarks and clipboard dumps sometimes land unparsed), fall back to full-text matching. Two interaction surfaces: a discoverable multi-checkbox UI and a Google-style prefixed-syntax for power users (`host:github.com path:pull`).

## What Changes

- **New capability `link-search`** (distinct from `link-filter`, which is about categorization). Adds structured URL-part search alongside the existing free-text search.
- **URL-part extraction at write time**: extend `prepareUrlRecord` to populate new columns `urlPath`, `urlQuery`, `urlHash` (alongside the existing `domain`). This avoids per-query URL parsing in SQLite (which has no native URL functions).
- **Backfill migration**: populate the new columns for pre-existing rows by parsing `normalizedUrl` once at upgrade time.
- **Multi-select OR semantics**: a row matches the query iff the search string appears in AT LEAST ONE of the user-selected parts. (Picking all four parts is equivalent to today's URL-spanning search.)
- **Invalid-URL fallback**: rows whose `normalizedUrl` fails `new URL()` parsing are matched by full-text LIKE against `originalUrl`, regardless of which parts the user selected.
- **Google-style prefixed syntax**: `host:foo path:bar` syntax in the same search box. Each prefixed term must match its named part; multiple prefixed terms AND together. Unprefixed trailing text applies to the UI-selected parts. Typing a prefixed term updates the UI checkboxes live (and vice versa).
- **UI: advanced-search toggle** on the Links page (next to the existing search box). Toggle reveals a checkbox group for `host`/`path`/`search`/`hash`; default selection = all four. Existing free-text search behavior preserved when the toggle is off.
- **No breaking changes** to the existing `links.search` tRPC contract — the URL-part-targeting is an additive refinement (`search` string carries both plain and prefixed forms; new optional `searchParts` input is the parsed selection when the UI is used).

## Capabilities

### New Capabilities
- `link-search`: Structured search over the URL components (`host`, `path`, `search`, `hash`) of stored links, with multi-select targeting, invalid-URL full-text fallback, and dual UI/syntax interaction.

### Modified Capabilities
None. The existing `link-filter` capability (internal-address detection + similarity grouping) is conceptually adjacent but its requirements don't change — advanced search and category filtering remain independent operations on the Links page.

## Impact

**Schema** (Drizzle migration):
- `apps/service/src/lib/db/schema.ts` — add `urlPath`, `urlQuery`, `urlHash` text columns to `linksTable` (nullable; populated for new rows, backfilled for existing rows).
- New migration file under `apps/service/src/lib/db/migrations/`.

**Service code**:
- `apps/service/src/lib/import/parse.ts` (`prepareUrlRecord`) — populate the three new columns from `new URL(originalUrl)` parts (mirroring the existing `domain = extractDomain(originalUrl)` pattern; NOT `normalizedUrl`, which loses fragment / `www.` / trailing-slash information under the default normalize config); leave null when the URL doesn't parse.
- `apps/service/src/lib/db/queries.ts` (`searchLinksPaginated`, `searchLinksCount`) — extend the WHERE clause to honor URL-part targeting; keep current full-text behavior as the fallback.
- `apps/service/src/lib/url/parse-search-query.ts` (new) — pure function that parses the user's query string into `{ prefixed: { host?, path?, search?, hash? }, bare: string }`. Used by both service (to interpret the query) and webapp (to bind the UI).
- `apps/service/src/routes/links.ts` — extend the `search` input schema with optional `searchParts: ('host' | 'path' | 'search' | 'hash')[]`.

**Webapp code**:
- `apps/webapp/src/pages/Links.tsx` — add an "Advanced" toggle next to the search box; when on, render a `Checkbox.Group` with the four parts. Two-way bind the checkboxes to the search string (toggling a part rewrites the query; typing `host:foo` rewrites the checkboxes).
- `apps/webapp/src/utils/parse-search-query.ts` (new) — client-side mirror of the service parser for the UI binding (or import from a shared module if the project adds one).

**Not affected**:
- `link-filter` capability (internal-address detection, similarity grouping) — unchanged.
- `link-dedup`, `link-import`, `link-parse`, `files-browser`, `link-export` — unchanged.
- tRPC contract for `links.search` — additive only (new optional `searchParts` input, new columns in row shape).

**Dependencies**: none added. `new URL()` is platform-native; URL parsing in SQL stays unnecessary.

**Performance**: indexed LIKE on three new nullable text columns. For pathological cases (multi-hundred-thousand-link datasets) we can re-evaluate FTS5, but that's a separate change.
