## 1. Parser for Netscape Bookmark HTML

- [x] 1.1 Add `'bookmarks_html'` to the `LinkFormat` union in `apps/service/src/lib/url/extract.ts`.
- [x] 1.2 Implement `decodeHtmlEntities(s: string): string` in `extract.ts` covering the named entities `&amp; &lt; &gt; &quot; &apos; &#39; &nbsp;` and numeric forms `&#DDDD;` and `&#xHHHH;` (reject codepoints > 0x10FFFF, leaving them as literal text). Export it so the extractor module can reuse it.
- [x] 1.3 Implement `parseBookmarksHtml(content: string): Link[]` in `extract.ts` using the regex `/<A\s+HREF="([^"]+)"[^>]*>([^<]*)<\/A>/gi` (case-insensitive, global). For each match: take capture group 1 as `url`, decode entities in capture group 2 to produce `title`, push `{ url, title }` only when `isValidUrl(url)` is true. Order is preserved by regex iteration.
- [x] 1.4 Verify biome + tsc pass after the new exports are added (no consumers yet — they land in section 2).

## 2. Extractor module and registry wiring

- [x] 2.1 Create `apps/service/src/lib/import/extractors/bookmarks-html.ts` exporting `bookmarksHtmlExtractor: Extractor` with `format: 'bookmarks_html'`, `detect(ctx)` returning true when `ctx.type === 'TXT'` AND (case-insensitive `ctx.content.includes('NETSCAPE-Bookmark')` OR (`firstLines.some(l => /<DL>/i.test(l))` AND `firstLines.some(l => /<A\s+HREF=/i.test(l))`)), and `extract(content)` returning `parseBookmarksHtml(content)`.
- [x] 2.2 Insert `bookmarksHtmlExtractor` into `extractorRegistry` in `apps/service/src/lib/import/extractors/index.ts` between `dashExtractor` and `urlOnlyExtractor`. Update the ordering comment at the top of the file to reflect the new TXT branch order.
- [x] 2.3 Re-export `bookmarksHtmlExtractor` from `extractors/index.ts` so consumers (including `scripts/link.ts` after section 3) can introspect the registry.

## 3. Refactor `scripts/link.ts` onto the registry

- [x] 3.1 Replace `processFile` internals in `apps/service/scripts/link.ts` with a single call: `const { links, detectedFormat } = extractLinks(content, 'TXT', filepath)`. Drop `lineParsers`, the `detectFormat`/`parseLinks`/`extractUrlOnly`/`extractUrlTitlePipe`/`parseTitleUrlDash`/`splitLines` imports.
- [x] 3.2 Simplify `FileResult`: keep `filename`, `format` (renamed from local `detectedFormat`), `lines` (count via `splitLines(content).length`), `links`. Remove `emptyLines` and `skipped` arrays.
- [x] 3.3 Update `printFileResult` to drop the `Empty` and `Skipped` log lines.
- [x] 3.4 Run `pnpm --filter service exec tsx scripts/link.ts extract <sample-file>` against at least one pipe-format TXT and one bookmarks HTML file to confirm output is sensible.

## 4. Remove dead-weight detection helpers

- [x] 4.1 Grep `apps/` for `detectFormat` and `parseLinks` references. Expected: zero hits after section 3. (If any remain, fix the caller before deletion.)
- [x] 4.2 Delete `detectFormat` (lines around `apps/service/src/lib/url/extract.ts:234-266`) and `parseLinks` (lines around `apps/service/src/lib/url/extract.ts:270-293`) from `extract.ts`.
- [x] 4.3 Update the module-level JSDoc at the top of `extract.ts` to mention `bookmarks_html` and remove any reference to `detectFormat`/`parseLinks` if mentioned.

## 5. Verification

- [x] 5.1 Run `pnpm --filter service exec tsc --noEmit` and `pnpm --filter webapp exec tsc --noEmit` — both must pass.
- [x] 5.2 Run `pnpm exec biome check .` — must be clean.
- [x] 5.3 Smoke test `parse.start` + `parse.batch` against a real Chrome "Export Bookmarks" HTML file (or a synthetic one matching the Netscape format): confirm `detectedFormat: 'bookmarks_html'`, titles appear in `links.title`, and `importedCount` reaches `totalValid` without gaps or duplicates.
- [x] 5.4 Smoke test detection precedence: a TXT file containing both ` | ` markers and HTML-like `<A HREF=...>` lines must resolve to `pipe` (registry order wins), not `bookmarks_html`. Construct a small adversarial fixture and verify via `extractLinks` directly.
- [x] 5.5 Resume-after-restart test on a large bookmarks HTML file: start parse, kill service mid-batch, restart, call `parse.batch` again — confirm deterministic resumption from `importedCount` with no duplicates.
- [x] 5.6 Confirm `apps/service/scripts/link.ts extract <bookmarks.html>` now reports `Format: bookmarks_html` and emits links with decoded titles.

## 6. Auto-create job for orphaned files (`import.ensureJob`)

- [x] 6.1 Add `getImportJobByFilename(filename)` query to `apps/service/src/lib/db/queries.ts` (indexed lookup on `importJobs.sourceContent`).
- [x] 6.2 Add `import.ensureJob({ filename, type?, strategy? })` mutation to `apps/service/src/routes/import.ts`: look up existing job by filename and return if found (any status); otherwise `readFile(filename)` to verify existence (reject `NOT_FOUND` on ENOENT), auto-infer `type` from extension, default `strategy` to `'normalized'`, insert a pending job, return `{ jobId, type, strategy, status, importedCount, errorCount, createdAt }`.
- [x] 6.3 Modify `onParse` in `apps/webapp/src/pages/Files.tsx`: when `selectedJob` is null, call `trpc.import.ensureJob.mutate({ filename: selected, type: parseType, strategy: parseStrategy })` first, capture the returned `jobId`, then chain into the existing `runParse(jobId, { background })`. Catch errors and surface via `setContentError`. Fire `fetchAll()` after `ensureJob` succeeds so the toolbar reflects the new job immediately.
- [x] 6.4 Verify biome + tsc pass on service and webapp.
- [x] 6.5 curl-verify three branches of `ensureJob`: (a) creates a pending job for an orphan file, (b) returns the same `jobId` on a second call (idempotent), (c) returns `NOT_FOUND` for a filename not on disk.
