## 1. Extractor interface and types

- [x] 1.1 Add `json_array` to `LinkFormat` union in `apps/service/src/lib/url/extract.ts` (current: `'csv' | 'pipe' | 'dash' | 'onetab_ini' | 'tablerone_json' | 'url_only'`).
- [x] 1.2 Add a `parseJsonArray(content: string): Link[]` parser to `lib/url/extract.ts` that accepts a flat JSON array of URL strings or `{ url, title? }` objects; populate `title` when present, else empty string. (This replaces the inline logic currently living in `extractUrls`.)
- [x] 1.3 Create `apps/service/src/lib/import/extractors/types.ts` exporting `DetectContext` (`{ type: 'TXT' | 'JSON'; extension?: string; content: string; firstLines: string[] }`) and `Extractor` interface (`{ format: LinkFormat; detect(ctx): boolean; extract(content): Link[] }`).

## 2. Per-format extractor modules

- [x] 2.1 Create `extractors/csv.ts` wrapping `parseCsvContent`; `detect` returns true when `ctx.extension === '.csv'`.
- [x] 2.2 Create `extractors/onetab-ini.ts` wrapping `parseOnetabIni`; `detect` returns true when `ctx.type === 'TXT'` AND first 10 non-empty lines contain at least one `[Group]`-style header AND at least one ` * ` marker.
- [x] 2.3 Create `extractors/pipe.ts` wrapping `extractUrlTitlePipe` + `splitLines`; `detect` returns true when `ctx.type === 'TXT'` AND any first 10 lines contain ` | `.
- [x] 2.4 Create `extractors/dash.ts` wrapping `parseTitleUrlDash` + `splitLines`; `detect` returns true when `ctx.type === 'TXT'` AND any first 10 lines contain ` - ` followed by a valid URL (reuse logic from `detectFormat`).
- [x] 2.5 Create `extractors/url-only.ts` wrapping `extractUrlOnly` + `splitLines`; `detect` always returns true for `ctx.type === 'TXT'` (fallback).
- [x] 2.6 Create `extractors/tablerone.ts` wrapping `parseTableroneJson`; `detect` returns true when `ctx.type === 'JSON'` AND content parses as object with an `export` array.
- [x] 2.7 Create `extractors/json-array.ts` wrapping the new `parseJsonArray`; `detect` always returns true for `ctx.type === 'JSON'` (fallback).

## 3. Registry and dispatch

- [x] 3.1 Create `extractors/index.ts` exporting: (a) `extractorRegistry: Extractor[]` ordered as `[csv, tablerone, onetabIni, pipe, dash, urlOnly, jsonArray]`; (b) `buildDetectContext(type, content, filename?): DetectContext` helper that lowercases extension and precomputes first 10 non-empty lines; (c) `extractLinks(content, type, filename?): { links: Link[]; detectedFormat: LinkFormat }` that runs `detect` in registry order restricted to the `type` branch and calls the winner's `extract`.
- [x] 3.2 Verify detection matches existing `detectFormat` behavior for the 6 original formats by writing a small smoke script or inline assertions (no production test framework; manual `tsx` execution suffices).

## 4. Refactor `lib/import/parse.ts`

- [x] 4.1 Replace `extractUrls(type, content)` usage with `extractLinks(content, type, filename)`. Remove `extractUrls` and `ImportType` re-export if no longer used elsewhere (check `routes/import.ts` first).
- [x] 4.2 Rename `validateImportUrls(urls: string[])` to `validateImportLinks(links: Link[])` returning `{ valid: Link[]; invalid: string[] }`. Internally call `validateUrls(links.map((l) => l.url))` to determine the valid mask, then partition `Link[]` accordingly.
- [x] 4.3 Change `ParseCacheEntry.valid` type from `string[]` to `Link[]`; add `detectedFormat: LinkFormat` field.
- [x] 4.4 Change `prepareUrlRecord` signature to `(link: Link, strategy, sourceType, order)`; set `originalUrl = link.url` and `title = link.title ?? ''`. Keep all other field assignments unchanged.
- [x] 4.5 Verify biome + tsc pass on `parse.ts` after refactor.

## 5. Wire into `routes/import.ts`

- [x] 5.1 In `parse.start`: replace `const urls = extractUrls(nextType, content)` and `const { valid, invalid } = validateImportUrls(urls)` with `const { links, detectedFormat } = extractLinks(content, nextType, job.sourceContent)` and `const { valid, invalid } = validateImportLinks(links)`. Update `setCachedUrls` to include `detectedFormat`.
- [x] 5.2 Add `detectedFormat` to the `parse.start` return shape: `{ jobId, totalValid, invalidCount, detectedFormat }`.
- [x] 5.3 Update the self-heal branch in `parse.batch` to call `extractLinks` + `validateImportLinks` instead of `extractUrls` + `validateImportUrls`; include `detectedFormat` in the rebuilt cache.
- [x] 5.4 Update the `parse.batch` slice to call `prepareUrlRecord(link, job.strategy, job.type, start + i)` with the `Link` object instead of a bare URL string.
- [x] 5.5 Verify the existing `withJobLock` and `incrementImportJob` integrations are unchanged.

## 6. Verification

- [x] 6.1 Run `pnpm --filter service exec tsc --noEmit` and `pnpm --filter webapp exec tsc --noEmit` — both must pass.
- [x] 6.2 Run `pnpm exec biome check .` — must be clean.
- [x] 6.3 Manual smoke test via `curl` against `/trpc/import.create` + `/trpc/import.parse.start` + `/trpc/import.parse.batch` for each of the six formats: pipe, dash, url_only, onetab_ini, csv (`.csv` file), tablerone_json. Verify `detectedFormat` is reported correctly and titles appear in the resulting `links` rows.
- [x] 6.4 Resume-after-restart test: start a parse on a large Tablerone file, kill the service mid-batch, restart, call `parse.batch` again — confirm it resumes from `importedCount` without duplicating or skipping links.
- [x] 6.5 Verify existing completed TXT/JSON jobs in the dev database still report `status: 'completed'` and that calling `parse.start` on them still returns CONFLICT.
