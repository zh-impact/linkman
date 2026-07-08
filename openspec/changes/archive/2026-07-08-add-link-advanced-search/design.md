## Context

The Links page exposes a single text search today. `apps/service/src/lib/db/queries.ts:168 searchLinksPaginated` runs one LIKE pass over `originalUrl | normalizedUrl | domain | title | tags`. The user can't say "search only in the path" or "only in the host", which means queries like `pull` match every PR URL's host (github.com), path (/owner/repo/pull/123), and query string (?action=edit) — drowning real signal. Worse, queries like `github.com` match the host everywhere but the user might be looking only for `path:github.com/something` (rare but real when folks paste reversed URLs).

The requirement is to let the user target their query at specific URL parts. Three things make this non-trivial:

1. **SQLite has no native URL functions.** Computing `host`/`path`/`search`/`hash` at query time would require either LIKE-acrobatics (split on `/`, `?`, `#`) or shipping a SQLite extension. Both are painful.
2. **Some stored URLs are not valid URLs.** Bookmarks, clipboard dumps, and pre-normalization captures sometimes contain raw strings that `new URL()` rejects. The system must not silently drop these rows when the user picks URL-part targeting.
3. **Two interaction surfaces must agree.** A checkbox UI for discoverability and a prefixed-syntax (`host:foo`) for power users. They must reflect the same query — typing in one updates the other.

**Constraints**:
- No new third-party dependencies.
- No breaking changes to `links.search` tRPC contract (additive only).
- `link-filter` capability stays independent (it categorizes; this searches).

## Goals / Non-Goals

**Goals**:
- User can target a query at one or more of `{host, path, search, hash}` via UI checkboxes OR `host:foo path:bar` syntax in the same search box.
- Multi-select = OR (row matches iff query appears in AT LEAST ONE selected part).
- Invalid URLs fall back to full-text match against `originalUrl`, never silently dropped.
- UI and syntax stay in sync (typing a prefix updates checkboxes; toggling checkboxes updates the query string).
- Pre-existing rows get the new columns populated via a one-time backfill migration.

**Non-Goals**:
- NOT replacing free-text search. The existing "search everything" mode stays the default when no parts are selected (or, equivalently, all four are selected).
- NOT introducing FTS5 / full-text indexes. Three new indexed LIKE columns scale fine for this project's expected size; revisit if we cross ~500k links.
- NOT supporting regex, wildcards, or boolean operators beyond what the prefixed syntax naturally expresses.
- NOT changing `link-filter`'s categorization behavior (internal-address / similarity grouping).
- NOT searching across the title or tags columns via the new part-targeting UI *when the user has narrowed (unchecked at least one but not all parts) or used power-user syntax (prefixed terms)*. When the user has the default-like selection (all four checked, all four unchecked, or Advanced off entirely) and types a bare query, the system runs legacy free-text search (URL + title + tags) for byte-identical behavior to pre-change. Title/tags exclusion applies only once the user actually narrows.

## Decisions

### D1: New capability `link-search` (not a modification of `link-filter`)
**Why**: The existing `link-filter` capability is about *categorization* (marking rows as `filtered_internal`, grouping by similarity). This change is about *retrieval* (which rows match a query). They're independent operations on the same page; conflating them would muddle both spec files.
**Alternative considered**: Extend `link-filter` with a "URL-part search" requirement. Rejected — the spec would mix categorization and retrieval semantics, making future changes harder to scope.

### D2: Extract URL parts at write time into dedicated columns
**Why**: SQLite has no native URL parsing. Per-query parsing would need either a custom extension (over-engineered) or fragile LIKE patterns (`SUBSTR(normalizedUrl, INSTR(...))`). Storing `urlPath`, `urlQuery`, `urlHash` alongside the existing `domain` column lets the search use plain indexed LIKE.
**Columns added**: `url_path`, `url_query`, `url_hash` (nullable text — null when the URL doesn't parse, set by `prepareUrlRecord` from `new URL(originalUrl)`).
**Source: `originalUrl`, NOT `normalizedUrl`**: This mirrors the existing `domain = extractDomain(originalUrl)` precedent at `apps/service/src/lib/import/parse.ts:66`. The normalization pipeline is lossy with respect to search: `DEFAULT_NORMALIZE_CONFIG` strips the fragment (`removeFragment: true`, `normalize.ts:35`), strips `www.` from the host (`removeWww: true`, `normalize.ts:12`), and strips trailing slashes (`removeTrailingSlash: true`, `normalize.ts:16`). Extracting from `normalizedUrl` would silently hide matches the user expects — e.g., a user searching `host:www.example.com` against normalized rows would get zero results even though every original URL contained `www.example.com`. Hash-targeted search would be entirely non-functional for default-strategy imports because `removeFragment` deletes the hash before it ever reaches the database.
**Why nullable**: Some rows have `originalUrl` values that don't parse via `new URL()` (clipboard dumps, malformed bookmarks, edge cases where the original extractor returned a non-URL string). Those rows get null parts and are matched by the full-text fallback (D5). Same predicate as `extractDomain` returning `''` — when `extractDomain(originalUrl) === ''`, the new columns are also null.
**Alternative considered**:
- Compute parts on the fly in SQL. Rejected — would either require a SQLite extension or unindexable per-row function calls.
- Extract from `normalizedUrl` (initial draft). Rejected — normalization's `removeFragment`/`removeWww`/`removeTrailingSlash` make hash- and www.host- search silently broken for the default strategy.

### D3: Multi-select = OR semantics
**Why**: When the user picks `host` AND `path`, they mean "match if the query appears in either" (typical search union semantics). AND semantics ("query must appear in BOTH host and path") is almost never what users want — a string like `login` rarely appears in both the host and the path of the same URL.
**Implementation**: WHERE clause is `(url_path LIKE %q% OR url_host LIKE %q% OR ...)` for each selected part. Multiple distinct prefixed terms (`host:a path:b`) still AND across parts (D6).
**Alternative considered**: AND across selected parts. Rejected — counterintuitive and rarely useful.

### D4: Default selection = all four parts, byte-identical to legacy
**Why**: Default-on for `host | path | search | hash` must produce *byte-identical* results to the pre-change free-text search (URL + title + tags), not just "search the whole URL". Users flipping the Advanced switch without narrowing expect no change. Implementation: when targeting is "default-like" (undefined, all-true, or all-false) AND the query has no prefixed terms, `resolveSearchConditions` returns the legacy 5-column LIKE; otherwise it switches to URL-parts-only advanced mode. Power users opt out by deselecting some (but not all) parts or by typing prefixed syntax.
**Alternative considered**: Default to URL-parts-only (title/tags excluded even when all four are checked). Rejected — silently drops matches the user can see in the table today, breaking the "Advanced is a narrowing switch" mental model.

### D5: Invalid-URL fallback = full-text LIKE against `originalUrl`
**Why**: ~1-3% of rows in practice have `originalUrl` values that don't parse via `new URL()` (clipboard dumps, malformed bookmarks, edge cases where the original extractor returned a non-URL string). Those rows have null `url_path`/`url_query`/`url_hash`; if we just applied the URL-part-targeted WHERE, they'd be invisible to advanced search.
**Predicate**: "Invalid URL" means `new URL(originalUrl)` throws — the same condition under which `extractDomain(originalUrl)` returns `''`. The fallback is keyed on `url_path IS NULL` (a single nullable column check; we always set all three together or none).
**Implementation**: The WHERE clause is `(targeted URL-part conditions) OR (url_path IS NULL AND originalUrl LIKE %q%)`. The fallback uses `originalUrl` because that's what the user typed in the original file and what they'd recognize, and because `normalizedUrl` for these rows is often also malformed (the normalizer's own try/catch returns the input unchanged).
**Alternative considered**: Filter out invalid URLs from search results entirely. Rejected — silently dropping rows the user can see in the table would be a regression.

### D6: Prefixed-syntax grammar
**Why**: Power users want to type `host:github.com path:pull` without clicking checkboxes. The grammar must be unambiguous and stable.
**Grammar**:
```
query        := term (' ' term)*
term         := prefixed | bare
prefixed     := prefix ':' value
prefix       := 'host' | 'path' | 'search' | 'hash'   (case-insensitive)
bare         := any string without a recognized prefix
```
- Multiple `prefixed` terms with DIFFERENT prefixes AND together (e.g., `host:github.com path:pull` requires both).
- Multiple `prefixed` terms with the SAME prefix OR together (e.g., `host:github.com host:gitlab.com` matches either host — useful for cross-instance searches).
- A `bare` term is matched against the UI-selected parts (OR across them, per D3). If no parts are selected, the bare term is matched against all URL parts (D4 default).
- Tokens without a recognized prefix (e.g., `foo:bar` where `foo` isn't one of the four) are treated as `bare` (whole token including the colon).
**Parsing location**: `apps/service/src/lib/url/parse-search-query.ts` — pure function, no IO. Returns `{ prefixed: { host?: string[], path?: string[], search?: string[], hash?: string[] }, bare: string[] }`. Service AND webapp both import it for UI binding.
**Alternative considered**: Quoted values (`host:"foo bar"`). Rejected for v1 — adds complexity; users who need spaces can use the checkbox UI.

### D7: UI ↔ syntax two-way binding
**Why**: User should be able to start in the UI (click checkboxes), then refine in the text box (add a prefixed term), and the UI should reflect what they typed.
**Binding rules**:
- Typing `host:foo` adds `host` to the UI selection (if not already) and the bare-term box still shows whatever was there.
- Toggling a checkbox off when the query contains that prefix's term strips the term from the query string.
- Toggling a checkbox on with no corresponding prefixed term in the query: leave the query alone (the bare term now applies to the newly-selected part per D3).
- The bare-term box is always visible and editable; prefixed terms appear inline in the same box.
**Implementation**: webapp maintains two pieces of state — `rawQuery` (the search box content) and `selectedParts` (the checkboxes). A single `useMemo` derives the structured `{ prefixed, bare }` from `rawQuery` via `parseSearchQuery`. Checkbox toggles rewrite `rawQuery` by either inserting or removing the relevant `prefix:value` token.
**Alternative considered**: Separate "prefixed" and "bare" inputs. Rejected — fragments the user's mental model; Google-style syntax works precisely because it's one string.

### D8: tRPC contract — additive only
**Why**: The current `links.search` query already takes `search?: string`. We extend its input schema with an optional `searchParts?: ('host' | 'path' | 'search' | 'hash')[]` for the UI-driven selection, but the parser ALSO runs on the `search` string itself (so power-user syntax works without UI). When both are present, prefixed terms in the string override UI selection for those prefixes; UI selection applies to bare terms.
**Alternative considered**: New `links.searchAdvanced` query. Rejected — splits behavior across two endpoints; harder to reason about.

### D9: Backfill migration runs once at upgrade
**Why**: Pre-existing rows have null `url_path`/`url_query`/`url_hash`. Without backfill, those rows would be invisible to URL-part targeting until they're re-imported.
**Implementation**: A standalone migration script (`apps/service/scripts/migrate-url-parts.ts` or extension to the existing migration runner) iterates all rows in batches of 1000, parses `normalizedUrl`, and UPDATEs the three columns. Idempotent — running twice is a no-op. Optional pre-flight `--dry-run` prints how many rows would be touched.
**Alternative considered**: Lazy backfill on first search hit. Rejected — non-deterministic; first user to search bears the latency.

## Risks / Trade-offs

**[R1] Storage bloat**: Three new text columns roughly double the per-row URL-storage footprint (path + query + hash often sum to >100% of normalizedUrl's length).
→ Mitigation: SQLite text storage is cheap; at 100k rows we're talking ~10MB. Acceptable. Revisit if storage becomes a concern.

**[R2] Migration cost on large datasets**: For projects with several hundred thousand links, the backfill parse-and-update loop is O(n) with 1ms-per-row cost ≈ 5 minutes for 300k rows.
→ Mitigation: Batched UPDATEs (1000 rows per transaction); optional `--dry-run` for sizing; documented as a one-time cost.

**[R3] UI binding bugs in edge cases**: Two-way sync between text and checkboxes is a classic source of cursor-jump and round-trip bugs (e.g., user types `host:g`, parser sees incomplete prefix, UI flickers).
→ Mitigation: Parser treats incomplete prefixes (`host:` with no value) as bare text; UI only rewrites the query string on explicit checkbox toggle, not on every keystroke.

**[R4] Backwards compatibility of stored queries**: If a future change adds a fifth URL part (e.g., `port`), existing `host:path:...` queries in user documentation / muscle memory keep working — new prefixes are additive.
→ Mitigation: Parser's recognized-prefix list is a single source of truth; unknown prefixes fall back to bare matching.

**[R5] LIKE-based search on large datasets**: Substring search (`LIKE %q%`) can't use a b-tree index regardless of whether the column is indexed — the leading wildcard forces a full scan. The new indexes from §1.2 are essentially a no-op for the substring case; they exist so that future exact-prefix (`LIKE q%`) or equality lookups can use them, and so that `idx_links_domain`'s existing pattern is mirrored. At 500k+ rows this becomes slow.
→ Mitigation: Acceptable for current scale; the existing `domain`/`normalizedUrl` searches have the same limitation. FTS5 migration is a separate future change; the new columns make that migration easier (we can FTS-index exactly the columns users search).

## Migration Plan

1. **Schema migration** (Drizzle): add `url_path`, `url_query`, `url_hash` columns (nullable text). No data backfill in the same migration — keep schema changes atomic.
2. **Backfill script**: standalone script `apps/service/scripts/backfill-url-parts.ts`, run once after deploy. Idempotent; safe to re-run.
3. **Code deploy**: `prepareUrlRecord` populates the new columns for new inserts; `searchLinksPaginated` / `searchLinksCount` use them when targeted.
4. **Webapp deploy**: new advanced-search UI ships; parser module shared between service and webapp.

Rollback:
- Code rollback: revert the deploy. New rows written during the rollout will have null parts (no harm — they fall back to full-text matching).
- Schema rollback: `ALTER TABLE links DROP COLUMN url_path` etc. — supported by the deployed driver (`@libsql/client` is based on SQLite 3.35+, where `DROP COLUMN` was added). If a future driver downgrade lands below 3.35, the fallback is to leave the columns in place as dead nullable columns (no behavioral impact; minor storage overhead).

## Open Questions

- **Quoted values in syntax**: Should `host:"foo bar"` be supported for multi-word host queries? (Current answer: no — defer until a user asks.)
- **Saved searches**: Should the user be able to save frequent advanced queries? (Current answer: out of scope; revisit if usage warrants.)
