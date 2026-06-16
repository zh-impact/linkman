## Why

The current `parse.start` / `parse.batch` pipeline only handles two simplified input shapes — TXT (split on newlines) and flat JSON arrays of strings — and silently drops the title metadata that real bookmark exports carry. Meanwhile, the codebase already contains full multi-format parsers in `apps/service/src/lib/url/extract.ts` (pipe, dash, url-only, OneTab INI, Chrome CSV, Tablerone JSON) plus a `detectFormat` heuristic, but the parse pipeline does not use them. Users importing OneTab / Tablerone / browser-history exports today see every line become a `Link` row regardless of format, with no titles and no structure — making subsequent dedup, search, and browser-display features far less useful.

This change replaces the trivial `extractUrls(type, content)` step with a pluggable Extractor registry that reuses the existing parsers, and threads the extracted `title` through to the `linksTable.title` column so downstream features can consume it.

## What Changes

- Introduce an `Extractor` interface and per-format modules under `apps/service/src/lib/import/extractors/` (one file per format: `pipe`, `dash`, `url-only`, `onetab-ini`, `csv`, `tablerone`, `txt`, `json`).
- Register extractors in a single registry (`extractors/index.ts`) with a `detect(content, hint) → format` dispatcher that combines filename extension and content sniffing.
- Replace `extractUrls(type, content)` in `lib/import/parse.ts` with `extractLinks(content, hint)` returning `{ url, title?, source? }[]`; `validateImportUrls` now operates on `Link[]` instead of bare URL strings.
- Update `prepareUrlRecord` to accept a `Link` and write non-empty `title` into `linksTable.title`.
- Keep `importJobs.type` enum as `TXT|JSON` (no migration). The `TXT` value now means "treat content as text and auto-detect the concrete bookmark format via the registry"; `JSON` still means "JSON array of strings/objects".
- Add per-link validation inside extractors (each extractor already calls `isValidUrl`); `validateImportUrls` becomes a dedup-safe partition that returns `{ valid: Link[], invalid: string[] }` for progress accounting.
- Cache shape in `parseCache` changes from `valid: string[]` to `valid: Link[]`; self-heal path (re-read file + re-extract) remains deterministic because extraction is order-preserving per format.
- **No UI change**: the Files toolbar still shows one Parse button, one type segmented control (TXT|JSON), and one strategy select. The selected format is reported back via `parse.start` response for transparency (e.g., `detectedFormat: 'onetab_ini'`) but does not add a UI control.

**Non-goals** (explicitly out of scope):
- No new tRPC procedures; `parse.start` / `parse.batch` signatures stay backwards-compatible except for an added `detectedFormat` field on the `start` response.
- No Drizzle migration; `linksTable.title` already exists.
- No UX-level separation of "Extract" vs "Store" buttons (single Parse button remains).
- No streaming / async extractors; all current formats parse synchronously in memory.
- No new external dependencies.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `link-parse`: extraction phase now uses a pluggable Extractor registry covering six bookmark formats plus TXT/JSON; titles extracted from source are persisted into `linksTable.title`; `parse.start` response includes `detectedFormat` for observability.

## Impact

- **Code**:
  - New: `apps/service/src/lib/import/extractors/{txt,json,pipe,dash,url-only,onetab-ini,csv,tablerone}.ts`, `apps/service/src/lib/import/extractors/index.ts` (registry + `detect` + `extractLinks`).
  - Modified: `apps/service/src/lib/import/parse.ts` (cache shape `Link[]`, `prepareUrlRecord` accepts `Link`, `extractUrls` removed in favour of `extractLinks`).
  - Modified: `apps/service/src/routes/import.ts` (call `extractLinks`, pass `Link[]` to validation and `prepareUrlRecord`, surface `detectedFormat`).
  - Possibly relocated: existing parsers in `apps/service/src/lib/url/extract.ts` may be re-exported from the new extractor modules to avoid duplication, or kept in place and imported by the new modules. Design will decide.
  - `apps/service/scripts/link.ts` (CLI) may be simplified to consume the new registry, but this is optional.
- **APIs**: `parse.start` response gains an optional `detectedFormat: LinkFormat` field. `parse.batch` response unchanged.
- **Data**: `linksTable.title` is now populated on insert for any link whose source contained a title (url-only lines remain empty string, matching existing default).
- **Dependencies**: none added.
- **Tests / verification**: manual smoke test against each of the six formats; resume-after-restart must still work (deterministic re-extraction).
