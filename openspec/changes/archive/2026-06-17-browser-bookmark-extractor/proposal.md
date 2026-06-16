## Why

The pluggable extractor registry shipped in `pluggable-link-extractors` left two loose ends: (1) `apps/service/src/lib/url/extract.ts` still carries `detectFormat` and `parseLinks` legacy helpers that are now dead-weight outside of `scripts/link.ts`, and (2) browser-exported bookmarks (Chrome/Firefox/Edge/Safari "Export Bookmarks…" → Netscape Bookmark File Format HTML) cannot be imported — the registry currently has no extractor for this universally-available source format.

## What Changes

- **Add** `parseBookmarksHtml(content)` parser to `apps/service/src/lib/url/extract.ts` that extracts `{ url, title }` pairs from Netscape Bookmark HTML via the regex `<A\s+HREF="([^"]+)"[^>]*>([^<]*)</A>` (case-insensitive) and decodes HTML entities in titles.
- **Add** `'bookmarks_html'` to the `LinkFormat` union.
- **Add** `apps/service/src/lib/import/extractors/bookmarks-html.ts` extractor with `detect` returning true when content contains `<!DOCTYPE NETSCAPE-Bookmark` OR (`<DL>` AND `<A HREF=` patterns). Detectable from TXT imports (`.html` / `.htm` files).
- **Register** the new extractor in `extractors/index.ts` ahead of the `url_only` TXT fallback so browser HTML is not misclassified as a plain URL list.
- **Refactor** `apps/service/scripts/link.ts` to call `extractLinks` from `lib/import/extractors`, removing its local `detectFormat` / `parseLinks` / `lineParsers` map duplication.
- **Remove** `detectFormat` and `parseLinks` from `apps/service/src/lib/url/extract.ts` once `scripts/link.ts` no longer references them.
- **Add** `import.ensureJob` mutation that resolves a filename to an existing job or creates a pending job when the file exists on disk but has no job row (idempotent, file-existence-validated). Wired into the Files toolbar's Parse button so the action is always recoverable for orphaned files.

## Capabilities

### New Capabilities

(None — the new format plugs into the existing `link-parse` capability.)

### Modified Capabilities

- `link-parse`: Add the `bookmarks_html` format to the pluggable extractor registry and complete the cleanup promised by the prior change (delete dead-weight `detectFormat` / `parseLinks`, consolidate `scripts/link.ts` onto the registry). Add a recoverability requirement: files on disk without a matching job can be parsed via `import.ensureJob`, which creates the missing pending job on demand.

## Impact

- **Code**:
  - `apps/service/src/lib/url/extract.ts` — new `parseBookmarksHtml`, new `LinkFormat` value, removal of `detectFormat` / `parseLinks`.
  - `apps/service/src/lib/import/extractors/bookmarks-html.ts` (new) — extractor module.
  - `apps/service/src/lib/import/extractors/index.ts` — registry insertion.
  - `apps/service/scripts/link.ts` — rewrite onto `extractLinks`.
  - `apps/service/src/lib/db/queries.ts` — new `getImportJobByFilename` helper.
  - `apps/service/src/routes/import.ts` — new `import.ensureJob` mutation.
  - `apps/webapp/src/pages/Files.tsx` — `onParse` calls `ensureJob` when `selectedJob` is null.
- **APIs**: New `import.ensureJob` mutation (`{ filename, type?, strategy? }` → `{ jobId, type, strategy, status, ... }`). The already-exposed `detectedFormat` field on `parse.start` / `parse.batch` responses now may return `'bookmarks_html'` in addition to the prior seven values.
- **Dependencies**: None added. HTML entity decoding uses an inline replacement map (no DOM parser dependency) to keep the service footprint minimal.
- **Migration**: None. `importJobs.type` stays as `TXT|JSON`; browser HTML files are imported as `TXT` and detected at parse time, matching the established pattern for `pipe`, `dash`, `csv`, `onetab_ini`, `url_only`.
