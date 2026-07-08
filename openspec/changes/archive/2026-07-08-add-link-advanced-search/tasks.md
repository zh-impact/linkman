## 1. Schema migration

- [x] 1.1 In `apps/service/src/lib/db/schema.ts`, add three nullable text columns to `linksTable`: `urlPath` (`url_path`), `urlQuery` (`url_query`), `urlHash` (`url_hash`).
- [x] 1.2 Add b-tree indexes `idx_links_url_path`, `idx_links_url_query`, `idx_links_url_hash` on the new columns. Note: substring search (`LIKE '%q%'`) cannot use these (leading-wildcard forces a scan regardless of indexing — same limitation that already exists for `idx_links_domain`). The indexes exist for future exact-prefix lookups and to mirror the existing pattern; they are not a performance optimization for the substring case.
- [x] 1.3 Generate the Drizzle migration file under `apps/service/src/lib/db/migrations/` (run `pnpm --filter service exec drizzle-kit generate`). Verify the migration SQL is `ALTER TABLE links ADD COLUMN url_path TEXT; ...` plus `CREATE INDEX ...`.
- [x] 1.4 Apply the migration on a dev database; confirm the columns exist via `sqlite3 data.db ".schema links"`.

## 2. URL-part extraction at write time

- [x] 2.1 In `apps/service/src/lib/import/parse.ts` (`prepareUrlRecord`), after computing `normalizedUrl`, parse `originalUrl` via `new URL(originalUrl)` and populate `urlPath`, `urlQuery`, `urlHash` (strip the leading `#` from hash; strip the leading `?` from query). Wrap in try/catch — on parse failure leave the three fields undefined (Drizzle stores NULL). **Important**: parse `originalUrl`, NOT `normalizedUrl` — the default normalization pipeline strips fragment (`removeFragment`), `www.` (`removeWww`), and trailing slashes (`removeTrailingSlash`), so extracting from `normalizedUrl` would silently break `hash:` search and `host:www.example.com` queries. See `design.md` D2 for the full rationale.
- [x] 2.2 Verify the existing `domain` column still populates correctly (it already uses `extractDomain(originalUrl)` — the new extraction mirrors this pattern, no double-parsing concern since `extractDomain` and the new parts extraction can share one `new URL(originalUrl)` call).
- [x] 2.3 Add a unit test or inline assertion: `prepareUrlRecord(Link{ url: 'https://www.example.com/foo/bar?q=1#section' }, 'normalized', ...)` produces `{ domain: 'www.example.com', urlPath: '/foo/bar', urlQuery: 'q=1', urlHash: 'section' }` — note `domain` includes `www.` because the source is `originalUrl`, not the lossy `normalizedUrl`.

## 3. Backfill script for pre-existing rows

- [x] 3.1 Create `apps/service/scripts/backfill-url-parts.ts` modeled on the existing `apps/service/scripts/link.ts` CLI pattern (uses `commander`, imports from `../src/...`).
- [x] 3.2 Script iterates `linksTable` in batches of 1000 (id-ordered, id-paginated to avoid loading the whole table at once), parses each row's `originalUrl` (NOT `normalizedUrl` — see D2 and §2.1 for the lossy-normalization rationale), and runs `UPDATE links SET url_path = ?, url_query = ?, url_hash = ? WHERE id = ?` for rows where the parse succeeds.
- [x] 3.3 Support `--dry-run` flag: prints `N rows would be updated, M rows have null parts (parse failures)` without writing.
- [x] 3.4 Verify idempotency: running twice produces no changes on the second run (UPDATE only fires when at least one column differs).
- [x] 3.5 Document the script in the migration section of `design.md` or in a top-of-file comment.

## 4. Query parser (shared module)

- [x] 4.1 Create `apps/service/src/lib/url/parse-search-query.ts` exporting `parseSearchQuery(raw: string): { prefixed: { host?: string[]; path?: string[]; search?: string[]; hash?: string[] }; bare: string[] }`. Pure function, no IO.
- [x] 4.2 Grammar (per design D6): split on whitespace; tokens matching `^(host|path|search|hash):(.*)$` (case-insensitive prefix) become `prefixed[prefix].push(value)`; everything else is `bare`. Empty value after the colon → treat the whole token as bare (D7 scenario "Incomplete prefix treated as bare text").
- [x] 4.3 Export the `PREFIXES` constant (`['host', 'path', 'search', 'hash']` as const) for reuse by the UI.
- [x] 4.4 Export a `stringifySearchQuery(parsed)` companion that rebuilds the canonical string form. Used by the UI when checkboxes toggle.
- [x] 4.5 Add inline assertions / a small test file verifying the scenarios from spec "Google-style prefixed syntax": single prefix, AND across different prefixes, OR across same prefix, unrecognized prefix falls through as bare, empty value treated as bare.

## 5. Service: extend search to honor URL-part targeting

- [x] 5.1 In `apps/service/src/lib/db/queries.ts`, modify `searchLinksPaginated` and `searchLinksCount` signatures to accept an optional `targeting: { host?: boolean; path?: boolean; search?: boolean; hash?: boolean }` parameter alongside the existing `query` string.
- [x] 5.2 Inside both queries, call `parseSearchQuery(query)` to split into `prefixed` and `bare`. Build the WHERE conditions:
  - For each prefix in `prefixed`, emit `(url_<part> LIKE ? OR ...)` joined by AND across DIFFERENT prefixes and OR within the SAME prefix.
  - For `bare` terms, apply each term to the UI-selected parts (`targeting`). If `targeting` is empty/missing, default to all four parts (D4).
  - Always OR in the invalid-URL fallback: `(url_path IS NULL AND originalUrl LIKE ?)` for each bare term (and for each prefixed term too, since invalid URLs need to be searchable on whatever raw text the user typed).
- [x] 5.3 Maintain backwards compatibility: if `targeting` is undefined AND `query` contains no prefixed tokens, behavior is byte-identical to today (full LIKE across `originalUrl | normalizedUrl | domain | title | tags`).
- [x] 5.4 Confirm the existing `idx_links_domain` and the new indexes from §1.2 are picked up by SQLite's query planner (run `EXPLAIN QUERY PLAN ...` on a representative query).

## 6. Service: tRPC contract extension

- [x] 6.1 In `apps/service/src/routes/links.ts`, extend the `search` query's input schema with `searchParts: z.array(z.enum(['host', 'path', 'search', 'hash'])).optional()`.
- [x] 6.2 Convert `searchParts` into the `targeting` shape expected by `searchLinksPaginated` (`{ host: searchParts.includes('host'), ... }`).
- [x] 6.3 Pass `targeting` through to the underlying query functions.
- [x] 6.4 tsc passes for service.

## 7. Webapp: parser mirror / shared import

- [x] 7.1 Decide whether to share the parser via (a) a webapp-local copy at `apps/webapp/src/utils/parse-search-query.ts` or (b) a truly shared module. Given the project's existing layout (each app has its own `utils/`), start with option (a) and re-evaluate if drift appears.
- [x] 7.2 Copy the parser + `PREFIXES` + `stringifySearchQuery` from the service module verbatim. Add a top-of-file comment noting they must stay in sync.
- [x] 7.3 Add a quick smoke-test (manual: type various queries, verify checkbox state updates correctly).

## 8. Webapp: Links page advanced-search UI

- [x] 8.1 In `apps/webapp/src/pages/Links.tsx`, add an "Advanced" `Switch` next to the existing `TextInput` search box. Default off.
- [x] 8.2 Persist the toggle state in `localStorage` under a key like `linkman:links:advanced-search` (or via the same mechanism used by other UI state on the page). Restore on mount.
- [x] 8.3 When the toggle is on, render a `Checkbox.Group` below the search box with the four parts (`host`, `path`, `search`, `hash`). Initialize with all four checked.
- [x] 8.4 Track `selectedParts: ('host' | 'path' | 'search' | 'hash')[]` as state. Pass it as `searchParts` to `trpc.links.search.query` only when advanced toggle is on.
- [x] 8.5 Wire two-way binding (per design D7):
  - `useMemo(parseSearchQuery, [searchInput])` derives `{ prefixed, bare }` from the current input.
  - The checkbox `checked` state is `selectedParts.includes(part) || prefixed[part]?.length > 0` (so typing `host:foo` checks the host box).
  - On checkbox toggle on: `setSelectedParts([...current, part])`.
  - On checkbox toggle off: `setSelectedParts(without part)` AND rewrite `searchInput` via `stringifySearchQuery` to drop any `part:` tokens.
- [x] 8.6 Confirm the existing free-text search behavior is unchanged when the toggle is off.
- [x] 8.7 tsc passes for webapp; biome clean.

## 9. Verification

- [x] 9.1 tsc passes for both packages: `pnpm --filter service exec tsc --noEmit` && `pnpm --filter webapp exec tsc --noEmit`.
- [x] 9.2 biome check clean on all new and modified files.
- [x] 9.3 Manual e2e: import a small test file with mixed valid/invalid URLs; verify `host:github.com` returns only host matches; verify `path:pull search:action` ANDs across parts; verify a malformed URL row is matched via fallback when its `originalUrl` contains the query.
- [x] 9.4 Manual e2e: open Links page → toggle Advanced on → type `host:example.com` → confirm the `host` checkbox checks itself and the host-only filter applies.
- [x] 9.5 Manual e2e: toggle Advanced off → confirm search behavior is byte-identical to pre-change.
- [x] 9.6 Manual e2e: refresh the page → confirm the Advanced toggle state is restored from localStorage.
- [x] 9.7 Backfill verification: run `backfill-url-parts.ts --dry-run` against a populated dev DB → confirm count → run without `--dry-run` → confirm rows updated → run again → confirm idempotent.
