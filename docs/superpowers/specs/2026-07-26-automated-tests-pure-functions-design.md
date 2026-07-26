# Automated Tests — Pure-Function Coverage (Round 1)

**Date:** 2026-07-26
**Status:** Approved (brainstorming output, awaiting plan)
**Scope:** `apps/service` only

## Why

The project has zero automated tests. Recent high-risk work (`reparse-updated-files`, `add-link-advanced-search`) shipped on the strength of static verification + one smoke script (`apps/service/scripts/test-filter-against-existing.ts`). Every future refactor will continue to carry this risk until a test baseline exists.

This spec establishes that baseline. It is deliberately **narrow**: only pure functions in `apps/service/src/lib/`. Stateful code (DB, routes, React) is explicitly deferred.

## Goals

- Get a test infrastructure in place that future rounds can grow into.
- Cover every pure-function module exported from `apps/service/src/lib/` with at least the cases listed below.
- Make `pnpm test` from repo root run the suite.

## Non-Goals

- **No DB / route / integration tests.** `db/queries.ts` (788 LOC), `routes/import.ts`, `routes/*.ts` — all deferred.
- **No React / webapp tests.** No jsdom, no testing-library. Deferred.
- **No coverage threshold gate.** We have no baseline; a threshold would just generate noise. Add later once we know what realistic numbers look like.
- **No CI workflow.** Separate piece of work.
- **No source-code refactor to make things testable.** If a function isn't directly exportable, I note it as a follow-up rather than rewrite source.
- **No coverage of `url/extract.ts` line-level parsers.** They're wrapped behind the extractor registry and not exported (per the "Single source of truth for format detection" spec). Testing them would require either exporting internals or going through the registry — both leak past this round's scope.

## Infrastructure

### Framework: Vitest

Natural fit for the vite-based monorepo. ESM-native, TypeScript support out of the box, watch mode is fast. Adds one devDependency (`vitest`) to `apps/service`.

`node:test` was considered and rejected: the ESM + TypeScript story (`tsx --loader node --test`) isn't simpler than vitest's defaults, and we'd outgrow it the moment webapp tests come online.

### Placement: co-located

`url/normalize.ts` ↔ `url/normalize.test.ts` in the same directory. Conventional for vitest; matches "if you're reading the source, the tests are right there."

One file per source module, not per function. `normalize.test.ts` covers everything `normalize.ts` exports.

### npm scripts

- `apps/service/package.json`:
  - `"test": "vitest run"`
  - `"test:watch": "vitest"`
- Root `package.json`: change `"test": "echo \"Error: no test specified\" && exit 1"` → `"test": "pnpm --filter service test"`.

When webapp tests arrive later, the root script becomes `pnpm -r test`.

### Config

Default-first. No `vitest.config.ts` initially — vitest auto-discovers `*.test.ts` and inherits the existing `apps/service/tsconfig.json` (ESM, `target: es2023`, `moduleResolution: bundler`).

If we hit `verbatimModuleSyntax: true` quirks or any path-resolution surprises, add a minimal `vitest.config.ts` then. Don't pre-bake config we may not need.

### Conventions

- `describe('<functionName>', ...)` per exported function.
- Test names state the **behavior**, not the input. `it('strips www. prefix under DEFAULT config', ...)` not `it('with www', ...)`.
- Pure functions only — no mocks, no stubs. If a test feels like it needs a mock, that's a signal the function isn't actually pure and the test belongs in a later round.

## Per-Module Test Plan

### `url/normalize.ts` — ~12 cases

**`normalizeUrl(url, config)`**

Per-flag isolation (toggle one flag on at a time):
- `removeWww: true` strips leading `www.` from hostname
- `removeTrailingSlash: true` strips trailing `/` from non-root paths; root `/` stays `/` (the `|| '/'` guard)
- `removeDefaultPort: true` strips `:443` from https and `:80` from http; non-default ports (`:8080`) are kept
- `sortQueryParams: true` reorders `?b=2&a=1` to `?a=1&b=2`
- `removeFragment: true` strips `#bar`
- `forceHttps: true` rewrites `http://` to `https://`

Real-config combos:
- `DEFAULT_NORMALIZE_CONFIG` (used by `'normalized'` strategy): strips fragment + default port + trailing slash + www
- `SMART_NORMALIZE_CONFIG` (used by `'smart'` strategy): keeps fragment, keeps custom port, strips trailing slash + www

Malformed input:
- Unparseable URL → returned unchanged (the `catch` branch)

**`extractDomain(url)`**
- Basic: `https://www.example.com/path` → `www.example.com` (does NOT strip www — `hostname` is returned verbatim)
- With port: `https://example.com:8080/` → `example.com:8080`
- Malformed → `''`

### `url/parse-search-query.ts` — ~14 cases

**`parseSearchQuery(raw)`**
- Empty string and whitespace-only → `{ prefixed: {}, bare: [] }`
- All bare (`foo bar baz`) → `bare=[foo,bar,baz]`, `prefixed={}`
- All prefixed (`host:foo path:bar`) → `prefixed.host=[foo]`, `prefixed.path=[bar]`
- Mixed (`host:foo bar`) → both populated
- Same prefix repeated (`host:a host:b`) → OR semantics: `prefixed.host=[a,b]`
- Multiple prefixes (`host:a path:b search:c`) → AND semantics across keys
- Unknown prefix (`foo:bar`) → whole token goes to `bare`
- Empty value after prefix (`host:`) → whole token goes to `bare` (mid-typing behavior)
- Case-insensitive prefix (`HOST:foo`) → `prefixed.host=[foo]`
- Whitespace collapsing (`foo   bar`) → 2 tokens

**`stringifySearchQuery(parsed)`**
- Round-trip: `stringify(parse(canonical))` === canonical input for whitespace-separated queries
- Order: prefixed terms first (in `PREFIXES` order: host, path, search, hash), then bare
- Empty parsed → `''`

### `url/validate.ts` — ~8 cases

**`validateUrl(url)`**
- Valid: `https://example.com`, `http://example.com/path?q=1#h`
- Invalid: `not-a-url`, `://`, `http://`
- Empty string → `false`
- Non-http scheme (`ftp://example.com`) → `true` (no scheme restriction at this layer — document this)

**`validateUrls(urls)`**
- Mixed valid/invalid partition: both arrays populated correctly, **order preserved in each bucket**
- Empty/whitespace-only lines skipped (not in either bucket)

### `url/internal.ts` — ~13 cases

**`isPrivateIP(hostname)`** — the CIDR regex is the landmine here:
- `localhost`, `127.0.0.1`, `::1` → `true`
- `10.0.0.1` → `true` (the `/8`)
- `192.168.1.1` → `true` (the `/16`)
- `169.254.0.1` → `true` (link-local)
- **`172.16.0.1` → `true`** (lower edge of `/12`)
- **`172.31.255.255` → `true`** (upper edge of `/12`)
- **`172.15.0.1` → `false`** (just below)
- **`172.32.0.1` → `false`** (just above)
- `8.8.8.8` → `false`
- `11.0.0.1` → `false`

**`isInternalUrl(url)`**
- Private hostname → `true`
- Public hostname → `false`
- Malformed URL → `false`

### `similarity/edit-distance.ts` — ~10 cases

**`isSimilarEnough(a, b, threshold)`**
- Identical strings → `true` for any threshold (short-circuit)
- Both empty → `true`
- Length prefilter: `|lenA - lenB| > (1-threshold)*maxLen` → `false` without DP executing
- `threshold = 1.0` → only exact matches pass
- `threshold = 0.0` → anything within length filter passes
- One-char diff on 10-char string @ `threshold=0.8` → `true`
- Five-char diff on 10-char string @ `threshold=0.8` → `false`
- **Commutativity**: `f(a,b,t) === f(b,a,t)` (the short/long swap inside must be transparent — this is the easiest thing to break in a refactor)
- Early-termination path: two long, very-different strings → `false` (correctness AND that the early-exit branch fires, not just the final comparison)
- Char-code basis sanity: `'abc'` vs `'ábč'` documents the limitation (no Unicode normalization; charCodeAt treats surrogate pairs as two units)

### `similarity/path-prefix.ts` — ~6 cases

**`groupByPathPrefix(links, depth=2)`**
- Default depth 2: `/a/b/c/d` and `/a/b/x/y` group together; `/a/z/...` is its own group
- `depth=1`: groups by first segment only
- `depth=3`: groups by first three segments
- Single-item groups are dropped from the result
- Different hostnames with same path prefix → **different** groups (key is `hostname+prefix`)
- Malformed URLs in input → skipped silently (no throw)

### `similarity/domain.ts` — ~3 cases

**`groupByDomain(links)`**
- Multiple links same domain → grouped
- Different domains → separate groups
- Single-item groups dropped

### `import/parse.ts` — ~17 cases

**`filterAgainstExisting(links, existing, strategy)`** — expands the existing smoke script:
- Empty `existing` → all pass through, order preserved
- All matching → empty result
- Partial → diff remains, order preserved
- **Strategy mismatch** (filter under `'smart'`, existing set built under `'normalized'`) → URL escapes the filter (the documented footgun; the test pins the behavior so a future "fix" without updating callers surfaces as a failure)
- Strategy match → filters correctly
- `'strict'` strategy → uses raw URL string for membership check

**`prepareUrlRecord(link, strategy, sourceType, order, sourceFile?)`**
- `strict` strategy → `normalizedUrl === originalUrl`
- `normalized` strategy → `normalizedUrl` matches `normalizeUrl(originalUrl, DEFAULT_NORMALIZE_CONFIG)`
- `smart` strategy → `normalizedUrl` matches `normalizeUrl(originalUrl, SMART_NORMALIZE_CONFIG)`
- `sourceFile` populated on the returned record when passed; `undefined` when omitted
- URL components (`domain`, `urlPath`, `urlQuery`, `urlHash`) extracted from **`originalUrl`**, NOT from `normalizedUrl` (the design D2 invariant — `removeFragment` would silently break `hash:` search if extracted from normalized)
- Malformed URL → `domain` falls back via `extractDomain`'s `catch`, `urlPath/urlQuery/urlHash` all `undefined`, record still produced
- `title` carried through from `link.title ?? ''`
- `sourceOrder` set to the passed `order` value

**`validateImportLinks(links)`**
- All valid → `valid` populated, `invalid` empty
- All invalid → reverse
- Mixed → partition correct, **order preserved in each bucket**

## Summary

| Module | Cases |
|---|---|
| `url/normalize.ts` | ~12 |
| `url/parse-search-query.ts` | ~14 |
| `url/validate.ts` | ~8 |
| `url/internal.ts` | ~13 |
| `similarity/edit-distance.ts` | ~10 |
| `similarity/path-prefix.ts` | ~6 |
| `similarity/domain.ts` | ~3 |
| `import/parse.ts` | ~17 |
| **Total** | **~83** |

## Follow-Ups (Out of Scope Here)

These are noted so a future round has a starting point. None block this round.

- DB-layer integration tests using an in-memory libsql client (`:memory:`). Highest-value target: `db/queries.ts` `buildAdvancedConditions` (the advanced-search SQL builder) and the parse pipeline (`parse.start` / `parse.batch` reparse Bug A/B regression guard).
- React component tests for `ParseToolbar` button-state matrix, `ResolvedTab` refresh-on-key behavior, `SourcesTab.selectedStale` derivation. Requires adding `jsdom` + `@testing-library/react`.
- CI workflow (`.github/workflows/test.yml`) running `pnpm test` + `tsc --noEmit` + `biome check` on PRs.
- The 8 manual e2e tasks still pending from `reparse-updated-files` (tasks 8.4, 9.5–9.11). Tests don't replace these — they're behavioral, not unit-level.

## Risks

- **`verbatimModuleSyntax: true` in service tsconfig** can interact awkwardly with vitest's import handling. If it surfaces, the fix is a minimal `vitest.config.ts` with `esbuild: { target: 'es2023' }` or similar. Default-first means we find out fast, not pre-bake config.
- **`charCodeAt`-based DP** in `edit-distance.ts` means Unicode strings with surrogate pairs are treated as arrays of UTF-16 code units, not code points. The test pins the current behavior — if anyone later introduces Unicode normalization, the test will surface the change rather than silently passing.
- **Test count ~83** is more than strictly needed for a baseline. If implementation drags, drop the per-flag isolation tests in `normalize.ts` (the DEFAULT/SMART combo tests catch the same regressions in aggregate) and the CIDR boundary detail in `internal.ts` (keep just the in/out examples, drop the just-above/below edge cases).
