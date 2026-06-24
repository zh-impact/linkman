## 1. Service: filesystem layer for `data/exports/`

- [x] 1.1 Add `EXPORTS_DIR` constant in `apps/service/src/lib/files/index.ts` (sibling of `FILES_DIR`, computed from the same `dataDir`; `mkdir -p` on module load mirroring the `FILES_DIR` pattern)
- [x] 1.2 Implement `resolveExportPath(relativePath: string): string` with the same path-traversal guard as `resolveFilePath` (reject `..` and absolute paths, verify `startsWith(EXPORTS_DIR + path.sep)`)
- [x] 1.3 Implement `writeExportFile(relativePath: string, content: string): Promise<void>` mirroring `writeFile` (mkdir parent if missing, utf-8 write)

## 2. Service: export router (initial cut)

- [x] 2.1 Create `apps/service/src/routes/export.ts` and register `export: exportRouter` in `apps/service/src/appRouter.ts`
- [x] 2.2 Implement `preview` mutation: input `{ filenames: string[] }`; for each filename resolve `type` via existing `import_jobs` row (use `getImportJobByFilename`) with fallback to filename-extension sniff; read file, call `extractLinks(content, type, filename)`; return `[{ filename, detectedFormat, linkCount, sample: Link[10] }]`; skip unreadable files with `{ filename, error }` entries
- [x] 2.3 Implement `run` mutation initial version (timestamp filename, single saveToExports toggle) — **superseded by §6**
- [x] 2.4 tsc passes for service (initial)

## 3. Webapp: Files page tab wiring

- [x] 3.1 Add a third `<Tabs.Tab value="export">Export</Tabs.Tab>` after Resolved in `apps/webapp/src/pages/Files.tsx` and a corresponding `<Tabs.Panel value="export"><ExportTab /></Tabs.Panel>`
- [x] 3.2 Create `apps/webapp/src/pages/files/ExportTab.tsx` as a stub component that renders a placeholder (filled in §4)

## 4. Webapp: ExportTab implementation (initial cut)

- [x] 4.1 Multi-select file list (`trpc.files.list.query()`, Mantine `Checkbox`, `Set<string>` selection, Select all / Clear toggle)
- [x] 4.2 Preview button → `trpc.export.preview.mutate({ filenames })`; per-file card with `detectedFormat` + `linkCount` + 10-row sample; errors inline
- [x] 4.3 Single "Save to data/exports/" `Switch` (default off) — **superseded by §7**
- [x] 4.4 Serial export loop calling `trpc.export.run.mutate({ filename, saveToExports })` + `downloadJsonFile` helper + progress + per-file results
- [x] 4.5 Summary card showing succeeded/failed counts and error list
- [x] 4.6 `downloadJsonFile(filename, json)` helper extracted to module scope

## 5. Verification (initial)

- [x] 5.1 tsc passes for both packages: `pnpm --filter service exec tsc --noEmit` and `pnpm --filter webapp exec tsc --noEmit`
- [x] 5.2 Manual e2e: TXT file → preview (`detectedFormat = url_only`) → export → browser downloads `[{url, title}, ...]`
- [x] 5.3 Manual e2e: Netscape Bookmark HTML → preview (`detectedFormat = bookmarks_html`) → titles HTML-decoded in exported JSON
- [x] 5.4 Manual e2e: multi-select 3 files → 3 separate downloads + progress + summary
- [x] 5.5 Manual e2e: `Save to data/exports/` enabled → file appears at `data/exports/<stem>-<hash8>.json` and DOES NOT appear in Sources list
- [x] 5.6 Manual e2e path-traversal rejection: **DEFERRED** — record only; verify later (user request)

## 6. Service: content-hash dedup + filename change

> Supersedes task 2.3. Replaces timestamp-based filename with sha256-based filename and adds skip-if-exists logic for `Save to data/exports/`.

- [x] 6.1 In `apps/service/src/routes/export.ts`, add `computeContentHash(content: string): string` using `node:crypto` sha256, returning first 8 hex chars
- [x] 6.2 Modify `buildExportFilename(sourceFilename, hash8)` to produce `<safeStem>-<hash8>.json` (drop timestamp)
- [x] 6.3 Change `run` mutation input schema from `{ filename, saveToExports }` to `{ filename, download: boolean, saveToExports: boolean }`; add `.refine((d) => d.download || d.saveToExports, { message: 'At least one delivery target required' })`
- [x] 6.4 In `run`, when `saveToExports` is true: compute hash, build filename, check `fs.access(EXPORTS_DIR/<filename>)`; if exists → skip `writeExportFile` and set `skipped: true`; otherwise write and set `skipped: false`. Return `{ json, linkCount, savedPath?, skipped? }`
- [x] 6.5 tsc passes for service after §6 changes

## 7. Webapp: dual independent switches + skip UI

> Supersedes task 4.3 and extends 4.4/4.5. Reflects new dual-toggle requirement.

- [x] 7.1 In `ExportTab.tsx`, replace the single `saveToExports` Switch with two: `Browser download` (default on) and `Save to data/exports/` (default on). Track as `download` and `saveToExports` state.
- [x] 7.2 Disable Export button when both toggles are off (in addition to existing no-selection check)
- [x] 7.3 Update `trpc.export.run.mutate(...)` call to pass `{ filename, download, saveToExports }`
- [x] 7.4 Only call `downloadJsonFile` when `download === true` (server still returns `json` regardless, so toggling download off skips the local side-effect)
- [x] 7.5 Extend `BatchResultRow` with `skipped?: boolean`; in summary card, show skipped files distinctly (e.g. badge "skipped" next to `savedPath`) and tally `summary.skipped` count
- [x] 7.6 tsc passes for webapp after §7 changes

## 8. Verification (post-revision)

- [x] 8.1 tsc passes for both packages: `pnpm --filter service exec tsc --noEmit` && `pnpm --filter webapp exec tsc --noEmit`
- [x] 8.2 Manual e2e: export same file twice with `Save to data/exports/` on → first write succeeds → second shows "skipped" in summary → no file mtime change
- [x] 8.3 Manual e2e: disable Browser download, enable Save only → click Export → no browser download prompt, file appears in `data/exports/`, summary shows `savedPath`
- [x] 8.4 Manual e2e: disable both toggles → Export button disabled
- [x] 8.5 Manual e2e: modify source file → re-export → new hash → new file alongside old (both retained)

## 9. Filter already-standard JSON from Export list

> User feedback: list looked odd showing .json files when the feature's intent is "non-JSON → JSON". Decision: filter by `detectedFormat === 'json_array'` (not by extension, to preserve Tablerone etc.), with a toggle to reveal hidden files.

- [x] 9.1 In `apps/service/src/lib/import/extractors/index.ts`, add `detectFormat(content, type, filename): LinkFormat` — runs only the registry's `detect` predicates, skips `extract`. Same fallback semantics as `extractLinks`.
- [x] 9.2 In `apps/service/src/routes/export.ts`, add `classify` mutation: input `{ filenames: string[] }`, returns `[{ filename, detectedFormat } | { filename, error }]` per file using `detectFormat`. Unreadable files → error entries (non-fatal).
- [x] 9.3 In `apps/webapp/src/pages/files/ExportTab.tsx`, after `fetchFiles` resolves, fire `trpc.export.classify.mutate(...)` in the background; store results in `Map<filename, format>`. Show a `classifying…` hint while pending; non-blocking alert on failure.
- [x] 9.4 Add `hideStandardJson` state (default `true`); filter the rendered list to exclude files whose `formatMap.get(filename) === 'json_array'` when toggle is on. Header shows `N hidden` count when any are filtered.
- [x] 9.5 Add "Hide already-standard JSON" `Switch` next to the Select-all control; disabled while classifying or exporting.
- [x] 9.6 Per-row `detectedFormat` Badge: pulled from `formatMap` (or preview if available); color-coded — green for `json_array`, blue for everything else — so the user can spot no-conversion-needed files at a glance even with the filter off.
- [x] 9.7 Select-all semantics updated to operate over the visible list (not full inventory) so toggling the filter never silently selects hidden files.
- [x] 9.8 Empty-state messaging distinguishes "no files at all" vs "all files are already standard JSON".
- [x] 9.9 tsc passes for both packages after §9 changes; biome clean.

## 10. Preview shows raw source content alongside extracted sample

> User feedback: existing Preview sample rendered the extracted output line-by-line (`URL — Title`), which looked like reformatted text — not the file's actual format. The user wants to see the verbatim source lines (OneTab's `URL * Title`, CSV rows, HTML anchors, etc.) so they can confirm the detected format by eye before exporting.

- [x] 10.1 In `apps/service/src/routes/export.ts`, extend `PreviewOk` with `rawSample: string[]` — first N non-empty lines of the source file, collected via the same `splitLines` predicate `buildDetectContext` uses for `firstLines` (so what the user sees matches what the detector saw). Bounded by `PREVIEW_RAW_LINE_LIMIT = 10`.
- [x] 10.2 Service returns `rawSample` as part of each ok entry in `export.preview`; error entries are unchanged.
- [x] 10.3 In `apps/webapp/src/pages/files/ExportTab.tsx`, extend `PreviewResultOk` with `rawSample: string[]`; map the field through from the service response in `handlePreview`.
- [x] 10.4 In the Preview card's ok branch, render two visually distinct sections:
  - "Source (raw):" — verbatim source lines in a `<pre>`-styled block (monospace, wrapped, gray background), under `ScrollArea.Autosize`
  - "Extracted (<N> links):" — the existing extracted sample (kept as-is, just retitled to make the raw-vs-extracted comparison clear)
- [x] 10.5 Skip the raw section entirely when `rawSample` is empty (e.g., empty source file); still show the extracted sample section.
- [x] 10.6 tsc passes for both packages; biome clean.

## 11. Type resolution handles JSON content under `.txt` extension (Tablerone fix)

> User reported that a Tablerone Chrome extension export (`tablerone_backup_<ts>.txt`) was being mis-detected as `url_only` and producing broken output. Root cause: Tablerone exports JSON content under a `.txt` extension, but the original type-resolution logic in `export.ts:resolveType` and `import.{create, ensureJob}` classified any non-`.json` file as TXT, causing `tableroneExtractor.detect` to bail out on its `ctx.type !== 'JSON'` early-return. Fix: centralize type resolution in a shared `resolveImportType` helper that combines filename pattern + content sniff + extension fallback.

- [x] 11.1 Add `resolveImportType(filename, content, override?): ImportType` to `apps/service/src/lib/import/extractors/index.ts`. Precedence: `override` (e.g. `import_jobs.type`) → filename pattern (`/tablerone/i`) → content sniff (first non-whitespace char is `{` or `[`) → extension default.
- [x] 11.2 In `apps/service/src/routes/export.ts`, refactor `resolveType` to take `(filename, content)` and call `resolveImportType(filename, content, job?.type)`. Update all three callers (`classify`, `preview`, `run`) to read content first and pass it in (no extra IO — they all already read the file).
- [x] 11.3 In `apps/service/src/routes/import.ts`, replace inline type-resolution logic in `import.create` and `import.ensureJob` with calls to `resolveImportType`. `ensureJob` reuses the bytes it just read for the existence check.
- [x] 11.4 Functional verification: place a real Tablerone `.txt` in `data/files/`, confirm `resolveImportType` returns `JSON`, `extractLinks` returns `detectedFormat = 'tablerone_json'`, and the link count matches the source's `export[].tabs[]` population (430 links on the test file).
- [x] 11.5 Edge cases verified via inlined helper copy: ts-prefixed filename (post-import naming) still matches the pattern; plain `.txt` with JSON content sniffed as JSON; plain `.txt` with text content stays TXT; explicit override wins over sniff.
- [x] 11.6 tsc passes for both packages; biome clean.
