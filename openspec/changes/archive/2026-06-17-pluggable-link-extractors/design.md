## Context

`apps/service/src/lib/import/parse.ts` currently exposes `extractUrls(type, content)` which handles only two shapes: TXT (split on newlines) and a flat JSON array of strings/`{url}` objects. This bypasses the six full bookmark parsers already implemented in `apps/service/src/lib/url/extract.ts` (`extractUrlTitlePipe`, `parseTitleUrlDash`, `extractUrlOnly`, `parseOnetabIni`, `parseCsvContent`, `parseTableroneJson`) plus the `detectFormat` heuristic. As a result, importing an OneTab INI, Chrome history CSV, Tablerone JSON, or `URL | Title` pipe file produces one row per line with `title` always blank, and structural lines (`[Group]` headers, CSV column headers, JSON braces) leak through as "invalid URLs" rather than being skipped by the right parser.

The same gap is visible in two reference implementations outside the parse pipeline: `apps/service/scripts/link.ts` (CLI) already wires `detectFormat` + per-format parsers, and `~/sourcecode/1Playground/AI-workbench/scripts/extract_links.py` does similar dispatch in Python. The parse pipeline should reuse the same approach.

Constraints:
- `importJobs.type` enum stays `TXT|JSON` (no Drizzle migration, no UI change).
- Single Parse button in the Files toolbar (no UX-level two-step).
- `linksTable.title` column already exists; we just need to populate it.
- The self-healing parse cache (re-extract from file on cache miss) must remain correct: extraction must be deterministic and order-preserving so that slice boundaries stay valid after a restart.

## Goals / Non-Goals

**Goals:**
- Introduce a pluggable `Extractor` interface and per-format modules under `apps/service/src/lib/import/extractors/`.
- Replace `extractUrls(type, content)` with `extractLinks(content, type)` returning `Link[]` (with titles).
- Thread extracted titles through `prepareUrlRecord` into `linksTable.title`.
- Preserve the existing `parse.start` / `parse.batch` contract except for an additive `detectedFormat` field.
- Keep self-heal correctness: same content + same type → same `Link[]` in same order.
- Reuse the existing parsers in `lib/url/extract.ts`; no duplication.

**Non-Goals:**
- No new tRPC procedures.
- No DB migration.
- No UI change to the Files toolbar.
- No streaming / async extractors.
- No new third-party dependencies.
- No new public CLI commands (the existing `apps/service/scripts/link.ts` may continue to call `lib/url/extract.ts` directly).

## Decisions

### Decision 1: Extractor interface — object with `{ format, detect, extract }`

**Choice:** Each extractor is an object implementing:
```ts
export interface DetectContext {
  type: 'TXT' | 'JSON'        // from importJobs.type
  extension?: string          // lowercased, e.g. '.csv'
  content: string             // full file content (already read)
  firstLines: string[]        // first 10 non-empty lines, precomputed
}

export interface Extractor {
  format: LinkFormat
  detect(ctx: DetectContext): boolean
  extract(content: string): Link[]
}
```

The registry is `Extractor[]` ordered by detection priority. `detect(ctx)` runs in registry order; the first match wins. `extract` is then called on the winning extractor.

**Why not a simple `Record<LinkFormat, (content) => Link[]>`:** a function map forces detection logic to live in a separate place (the current `detectFormat` switch). Bundling `detect` + `extract` per format means adding a new format is one file + one registry line, with no edits to shared dispatch code. This matches the user's "插件化" intent.

**Why pass `type` (TXT|JSON) into detection:** because Tablerone JSON and a flat JSON array are both valid JSON, but the wrong choice produces zero links. The type narrows the candidate set: `JSON` considers only `{tablerone_json, json_array}`; `TXT` considers `{csv, onetab_ini, pipe, dash, url_only}`. This avoids a Tablerone file being misdetected as a flat array (or vice versa).

**Alternatives considered:**
- *Single dispatch function in `parse.ts`*: rejected — would recreate the current monolithic switch with no extensibility win.
- *Detect by extension only*: rejected — clipboard imports have no extension; mixed-content TXT files need content sniffing.

### Decision 2: Add `json_array` to `LinkFormat`; treat Tablerone as the other JSON branch

**Choice:** Extend `LinkFormat` from `'csv' | 'pipe' | 'dash' | 'onetab_ini' | 'tablerone_json' | 'url_only'` to also include `'json_array'`. The flat-JSON-array logic currently inline in `extractUrls` becomes its own extractor module. Tablerone remains its own extractor.

**Why:** Both JSON shapes are reachable from `type=JSON`; without distinct formats we cannot report which one was detected via `parse.start`'s `detectedFormat` field, and the cache cannot record which extractor produced the stored `Link[]`.

**Detection order within JSON type:** `tablerone_json` first (positive signal: parses as object with `export` array), then fall through to `json_array`.

**Alternatives:**
- *Keep `extractUrls` JSON branch as-is and only extractors for TXT formats*: rejected — splits JSON handling across two places, breaking the "one registry" invariant.

### Decision 3: Extractors wrap existing parsers in `lib/url/extract.ts`

**Choice:** Each new module in `apps/service/src/lib/import/extractors/<format>.ts` imports the corresponding parser from `lib/url/extract.ts` and exposes it via the `Extractor` interface. No parser code is moved or duplicated.

```ts
// extractors/pipe.ts
import { extractUrlTitlePipe, splitLines, type Link } from '../../url/extract'
export const pipeExtractor = {
  format: 'pipe' as const,
  detect: ({ firstLines }) => firstLines.some((l) => l.includes(' | ')),
  extract: (content) =>
    splitLines(content).map(extractUrlTitlePipe).filter((l): l is Link => l !== null),
}
```

**Why:** `apps/service/scripts/link.ts` and any future direct consumers continue to import from `lib/url/extract.ts`. The extractor layer is purely an envelope that adds `detect` + registry participation. Diff stays small; no behavior changes in the parsers themselves.

**Alternatives:**
- *Move parsers into `extractors/`*: rejected — breaks the CLI import path and inflates the diff for no functional gain.

### Decision 4: Cache shape changes from `string[]` to `Link[]`

**Choice:** `ParseCacheEntry.valid` becomes `Link[]` instead of `string[]`. `invalid` stays `string[]` (raw inputs that looked link-like but failed stricter validation). The cache entry also records `detectedFormat: LinkFormat` so self-heal can be observed.

```ts
export interface ParseCacheEntry {
  valid: Link[]                  // was string[]
  invalid: string[]              // unchanged
  total: number                  // = valid.length
  detectedFormat: LinkFormat     // new
}
```

**Why:** the batch slice `[importedCount, +batchSize)` needs to carry title metadata into `prepareUrlRecord`. Storing `Link[]` is the natural shape. Determinism is preserved because every extractor returns links in source order.

**Self-heal verification:** every extractor is order-preserving — `splitLines` preserves line order; `parseOnetabIni` iterates lines in order; `parseCsvContent` iterates rows in order; `parseTableroneJson` iterates groups then tabs in array order; `json_array` maps the array in order. Re-extracting the same content with the same type yields byte-identical `Link[]`, so the slice boundary stays consistent across restarts.

### Decision 5: `validateImportUrls` accepts `Link[]`, runs URL validator on `link.url`

**Choice:** Rename/reshape `validateImportUrls(urls: string[])` to `validateImportLinks(links: Link[])` returning `{ valid: Link[]; invalid: string[] }`. Internally calls the existing `validateUrls(links.map((l) => l.url))` and partitions `Link[]` according to which URLs passed.

**Why:** extractors already do line-level filtering (each parser calls `isValidUrl` and skips non-http(s) lines), but `validateUrls` from `lib/url/validate.ts` applies stricter rules (e.g., protocol allowlist, hostname sanity). Keeping both layers means extractors handle structure (CSV cells, INI section skips, JSON traversal) while the URL validator handles URL well-formedness. The invalid count surfaced in `errorCount` keeps its existing semantics.

**Alternatives:**
- *Drop `validateUrls`, trust extractors*: rejected — would weaken guarantees for url_only files where lines start with `http://` but are otherwise malformed.

### Decision 6: `prepareUrlRecord` accepts `Link`, writes `title`

**Choice:** Change signature from `(originalUrl, strategy, sourceType, order)` to `(link: Link, strategy, sourceType, order)`. Inside, `originalUrl = link.url`, `title = link.title ?? ''`. The `linksTable.title` column is `text('title')` (nullable); we store the empty string for url-only rows, matching the existing convention where extractors return `title: ''` rather than `undefined`.

**Why:** keeps the call site in `parse.batch` simple (`prepareUrlRecord(link, ...)`) and surfaces title as a first-class field.

### Decision 7: `parse.start` response adds `detectedFormat`

**Choice:** `parse.start` returns `{ jobId, totalValid, invalidCount, detectedFormat }`. The webapp does not need to render this today, but exposing it makes the chosen extractor observable for debugging (e.g., a user reporting "my Tablerone import gave 0 links" can see whether `tablerone_json` was selected).

**Why not change `parse.batch`:** the batch contract is already richer than needed; adding more fields risks breaking the frontend batch loop. Detection happens once at start; batches just consume slices.

### Decision 8: Detection priority — same as existing `detectFormat`

**Choice:** Registry order, for `TXT` type: `csv` (extension `.csv`) → `onetab_ini` (INI sections AND `* ` markers) → `pipe` (` | ` in first 10 lines) → `dash` (` - ` followed by valid URL) → `url_only` (default). For `JSON` type: `tablerone_json` (parses as object with `export` array) → `json_array` (default).

**Why:** this exactly mirrors the current `detectFormat` behavior, so files that worked before keep working. No behavior change at the detection layer, only at the extraction layer (where titles are now captured).

## Risks / Trade-offs

- **Mid-parse deploy boundary** → If a deploy swaps the extractors while a job is `processing` with `importedCount=N`, the self-heal re-extract may produce a slightly different `Link[]` for files containing non-http lines that the old line-splitter accepted but the new url_only extractor also accepts (no change), or for mixed-format files where detection picks a more specific extractor than the old default. **Mitigation:** for pure URL lists (the vast majority of existing imports), output is byte-identical. Document that deploys should happen when no parse jobs are in `processing` state. Worst case is a few duplicate or skipped links in an edge-case file, not data corruption.

- **Tablerone mis-detection** → A JSON file that happens to have an `export` key but isn't Tablerone-shaped would be misdetected. **Mitigation:** the existing `parseTableroneJson` already guards with `Array.isArray(data.export)` and `tabs` checks; non-conforming content yields `Link[] = []`, which the user will see as `totalValid: 0` and can intervene. Detection confidence is the same as today.

- **CSV column header drift** → `parseCsvContent` looks specifically for `NavigatedToUrl` and `PageTitle` headers (Chrome history export schema). Other CSVs (e.g., Firefox, Edge) won't match. **Mitigation:** out of scope for this change; future extractor can broaden column matching. Current behavior is unchanged.

- **Extractor interface evolution** → Adding async/streaming extractors later would require an interface change. **Mitigation:** current interface is minimal (`detect` + `extract`), both sync. Adding a `extractAsync` method or a `streaming: true` flag later is non-breaking.

- **Cache memory footprint** → `Link[]` carries the `title` field, slightly larger than bare `string[]`. For a 100k-URL Tablerone file, the title field adds roughly the original title-text size (already in memory as part of the source content). **Mitigation:** negligible; cache is per-job and cleared on completion.
