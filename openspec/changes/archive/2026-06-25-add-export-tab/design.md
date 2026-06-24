## Context

linkman's Import pipeline already supports 8 formats through the `extractorRegistry` (`apps/service/src/lib/import/extractors/index.ts`): CSV, OneTab INI, Pipe, Dash, Bookmark HTML, URL-only, Tablerone JSON, and JSON array. The extracted `Link[]` goes straight into the `links` table. The user **never sees the intermediate artifact** — a standardized list of URLs + titles with format noise stripped out.

The requirement is to expose that "intermediate artifact" as an exportable standalone JSON file, dedicated to backup / external use, fully decoupled from Parse / Prune.

**Existing reusable assets**:
- `extractLinks(content, type, filename)` is a pure function with deterministic output (the same input produces a byte-identical `Link[]` order). It's already invoked by `parse.start` and `parse.batch` self-healing logic.
- `trpc.files.list.query()` returns every file under `data/files/` + size + mtime.
- `data/files/` already has path-traversal protection (`resolveFilePath`).

**Constraints**:
- No new npm dependencies (specifically no zip library).
- `data/exports/` is physically isolated from `data/files/` to avoid polluting the Sources list.
- Multi-file batch export goes through the browser's native serial download flow; no packaging.

## Goals / Non-Goals

**Goals**:
- New Export tab on the Files page; an independent "source file → standardized JSON" entry point.
- Multi-select + batch export (each source file yields one `.json`).
- Data source = real-time `extractLinks`; no dependency on DB state, replayable.
- **Two independent delivery toggles**: browser download + write to `data/exports/`. Either, both, or — provided at least one is on — any combination; both default on.
- **Content-hash deduplication for save-to-disk**: same sha256 → same filename → skip the write if the file already exists (avoids pointless IO and file fragmentation).
- **List focuses on files that need conversion**: by default hide files whose source is already a standard JSON array (`detectedFormat === 'json_array'`); provide a toggle to reveal them when needed.
- Output schema = `[{url, title}, ...]` standard JSON array.
- Preview: per-file preview of detected format + total link count + raw source sample + extracted sample (verify detection without downloading); every list row always shows its detectedFormat badge (even without preview).

**Non-Goals**:
- No zip packaging (the user confirmed serial download).
- No export of the normalized data from the `links` table (the user chose "real-time extractLinks"). A future toggle could add this; out of scope for this change.
- Do not surface `data/exports/` artifacts in the Sources list.
- No management / deletion of `data/exports/` (the user clears it from the OS; this feature is write-only, no list endpoint).
- No custom JSON schema (no detectedFormat / extraction-time metadata wrapper) — the artifact for this change is just `[{url, title}, ...]`. If a metadata-wrapped schema is needed later, it can be added behind a schema option.
- **No deduplication for browser download**: downloads are immediate consumption; the browser will not refuse a duplicate. Dedup applies only to save-to-disk.

## Decisions

### D1: Entry point = new tab on the Files page (alongside Sources / Resolved)
**Why**: The user explicitly asked for "a separate Export tab on the Files page". Shares the file-list data with Sources (`trpc.files.list`) but with isolated state and its own action panel, avoiding interference with the Parse toolbar / Resolved viewer.
**Alternative considered**: Add an Export button to the Sources tab's right-hand Card. Rejected — Sources already has the Parse toolbar + content viewer; adding export would crowd the panel, and a single-file interaction model doesn't fit multi-select batch.

### D2: Data source = call `extractLinks` at export time, do not read the `links` table
**Why**: User's choice. Advantages: ① no dependency on whether the file has been parsed; ② behavior is identical to Parse (same function); ③ self-contained, replayable, unit-testable. Trade-off: every export re-reads + re-extracts large files (~200ms for a 4MB file in practice — acceptable).
**Alternative considered**: Read from the `links` table joined by `source`. Rejected — would include normalized URLs (not originals) and requires the file to have been parsed first, raising the bar for use.

### D3: Output schema = flat `[{url, title}, ...]` JSON array
**Why**: The use case is "backup and external use"; the most broadly compatible standard JSON shape is an array of URL+title objects. No detectedFormat / timestamp / source-filename wrapper — avoids schema bloat.
**Alternative considered**: `{ meta: {...}, items: [...] }` wrapper. Rejected — metadata isn't needed this round; external consumers would have to unwrap it.

### D4: Filename = `<original-stem-without-extension>-<sha256-first-8-hex>.json`
**Why**: Content-addressed. Same sha256 = same content = same filename = same artifact → natural deduplication. Different content naturally forks into different files. `source.txt` → `source-a1b2c3d4.json`.
**Alternative considered**:
- Timestamp filename (`<stem>-<YYYYMMDDHHmmss>.json`) — **rejected**. Originally adopted but superseded by the requirement change: repeatedly exporting the same file would accumulate byte-identical copies forever, which is wasteful. File mtime already records export time; encoding it into the name is redundant.
- Full sha256 — rejected. Filename becomes too long (64 hex chars); the first 8 (32 bits) make collision probability negligible at this feature's expected export volume.

### D5: Delivery = two independent toggles (`Browser download` + `Save to data/exports/`)
**Why**: The user explicitly required the ability to "export to data/exports only, download only, or both". The original design ("download default on + save-to-disk optional") could not express "save only, no download".
**Default state**: both on (the common case: "back up to server + grab a local copy in one click"). Both off → Export button disabled (no-op). Frontend validation + service-side zod refine double up.
**Browser download implementation**: Blob URL + `<a download>`, fired serially. Each `.json` gets its own createObjectURL + click + revoke. Multi-file scenarios surface as the browser's native per-file download prompt; the user confirmed this is acceptable.

### D6: Server-side write target = `data/exports/`, an isolated directory that never shows up in Sources
**Why**: `listFiles()` runs `walk(FILES_DIR, '')` and only recurses into `data/files/`. Add a separate `EXPORTS_DIR` constant with the same path-traversal guard (`resolveExportPath`) — physical isolation guarantees the Sources list can't be polluted.
**Directory layout**: `data/exports/<originalStem>-<hash8>.json` (flat, no subdirectories).
**Alternative considered**: Write under `data/files/exports/`. Rejected — `walk` would recurse into it and pollute the Sources list.

### D7: tRPC routing shape = `export.classify` + `export.preview` + `export.run`
**Why**:
- `classify` runs only the registry's `detect` predicates (no `extract`), used to filter `json_array` files out of the default list without paying for full extraction on every file.
- `preview` returns `{ linkCount, detectedFormat, rawSample, sample: Link[10] }` per file so the user can verify detection before exporting; does not return the full JSON (avoids shipping a large file twice).
- `run` returns the full JSON string (frontend Blobs it for download) + optional `saveToExports` flag triggering a server-side write (returns the saved filename and skip flag).
**Alternative considered**: A single `run` returning the full JSON. Rejected — Preview lets the user catch mis-detection before downloading, which matters for edge cases.

### D8: No dryRun / confirmToken safety mechanism (unlike Prune)
**Why**: Export is read-only + create-new-file; it deletes no existing data. Writes to `data/exports/` are also new files; same-name collisions are skipped (same sha256 → same filename → skip), and different sha256 → different filename → no conflict. The Prune-style token mechanism is not needed.
**Race condition**: Concurrent `export.run` on the same file → same hash → same target filename → both writes produce identical content; the overwrite is harmless (utf-8 text atomicity is handled by the OS).

### D9: Batch export = N serial `trpc.export.run.mutate` calls (not a single batch endpoint)
**Why**: A single batch endpoint would either return N JSON strings concatenated (forcing the frontend to split them — error-prone) or return `{ files: [{filename, json}, ...] }` (one giant payload in memory for large files). Serial calls keep only one file's JSON in memory at a time and let us show per-file progress ("3/10 done").
**Performance**: 10 serial files ≈ 10 round-trips, each < 100ms on local tRPC, total < 1s — acceptable.

### D10: Strategy for inferring the `type` argument to `extractLinks`
**Why**: `extractLinks(content, type, filename)`'s `type` argument determines the fallback (TXT → url_only, JSON → json_array). In the export context:
- For parsed files → use `import_jobs.type` (if present).
- For unparsed / orphan files → infer from the filename extension (`.json` → JSON, otherwise TXT).
- The user **cannot** change `type` from inside the Export tab (avoids confusion with Parse's type selector; export should be "extract the file as it is").

If the user wants to re-extract with a different type, they should change the type in the Sources tab, Parse, then return to Export.

### D11: Dedup granularity = save-to-disk only; never applies to browser download
**Why**: The user explicitly required that "if a file's hash hasn't changed and the artifact already exists in exports, don't re-export it." The semantics target the **persistent artifact** (save-to-disk). Browser download is immediate consumption (every click is an active user intent) — deduplicating it would be confusing ("I clicked, why did nothing happen?").
**Implementation**: when `saveToExports === true`, the `run` mutation computes sha256(content) first-8-hex, composes `<stem>-<hash8>.json`, and checks whether it already exists under `data/exports/`. If yes, skip the write and return `{ skipped: true, savedPath }`; otherwise write and return `{ savedPath }`. The frontend surfaces the skipped count in the summary.
**Edge case**: If the source file is modified externally, the hash changes → the filename changes → a new artifact is produced; the old same-hash copy is retained (no auto-cleanup).
**Alternative considered**: Maintain a `manifest.json` recording `{ source, hash, exportedAt }`. Rejected — the state file would need transactional guarantees and adds complexity; encoding the hash into the filename already lets the filesystem hold the state.

### D12: Export list hides files that are already standard JSON arrays by default
**Why**: The user's intent is "convert non-JSON into JSON". Showing `.json` files in the list feels off — especially when `detectedFormat === 'json_array'` (pure `[{url,title}]` or `["url"]`), where exporting is essentially a byte-identical copy with no "conversion" semantics.
**Detection** = `detectedFormat === 'json_array'` (the extractor registry's JSON fallback). Note: filtering by extension alone would wrongly hide structured JSON like Tablerone (`detectedFormat === 'tablerone_json'`), so we filter by detection result, not extension.
**Implementation**:
- Service adds an `export.classify` mutation (input: filenames, output: `[{ filename, detectedFormat }]`; **detect-only, no extract**).
- Reuses the existing `extractorRegistry` + a new `detectFormat(content, type, filename)` pure function (the detect loop, skipping the extract call).
- The webapp's ExportTab fires `classify` non-blockingly once `fetchFiles` resolves and stores results in `Map<filename, format>`; rendering filters by `format !== 'json_array'`.
- A "Hide already-standard JSON" Switch (default on) at the top lets the user flip back to "show all".
- Each row always shows a detectedFormat Badge (blue = needs conversion; green = already standard) so the user can identify no-conversion-needed files at a glance even with the filter off.
**Alternative considered**:
- Filter by extension. Rejected — would wrongly hide structured JSON like Tablerone.
- Force-hide with no toggle. Rejected — occasionally the user does need to export an "already standard" JSON (verify hash, migrate, etc.) and would have no escape hatch.
- Reuse `preview` once for all files. Rejected — preview runs full extract and wastes CPU; classify runs detect only, roughly 1/10 the cost per file.

### D13: Hash stability vs extractor upgrades
**Why**: The hash is computed over the **source file content**, not over `extractLinks`'s output. Theoretically, the same source content → same sha256 → same filename → same extraction result (`extractLinks` is a pure function). If `extractLinks` behavior changes in a code upgrade (e.g., an extractor bugfix), the same sha256 source will produce different JSON content but the same filename → overwrite. This is intended behavior (artifacts auto-update to the latest extraction result after an upgrade), not a bug.
**Verification note**: If the user wants to preserve old artifacts after an extractor upgrade, they should back up `data/exports/` manually; this system does not maintain version history.

### D14: Preview shows the raw source alongside the extracted sample
**Why**: The original Preview sample rendered the extracted output line-by-line (`URL — Title`), which looked like reformatted text and didn't reflect the file's actual format. The user wanted to see the verbatim source (OneTab's `URL * Title`, CSV rows, HTML anchors, etc.) so they could visually verify the detected format before exporting.
**Implementation**:
- Service `preview` returns a new `rawSample: string[]` — first N (10) non-empty source lines collected via the same `splitLines` predicate `buildDetectContext` uses for `firstLines`. This guarantees what the user sees matches what the detector saw.
- Webapp Preview card splits into two labeled sections: "Source (raw)" (verbatim source lines in a monospace, gray-background `<pre>` block) and "Extracted (N links)" (the existing extracted sample). Both stay visible so the user can compare the file's original form against the standardized output.
- The raw section is skipped when `rawSample` is empty (empty source file).
**Alternative considered**: Replace the extracted sample with the raw sample. Rejected — the extracted sample is still valuable (shows what the export will actually contain); showing both preserves the original verification capability.

### D15: Type resolution handles JSON content saved under `.txt` extension
**Why**: The Tablerone Chrome extension exports JSON content under a `tablerone_backup_<ts>.txt` filename. The original type-resolution logic (`filename.endsWith('.json') ? 'JSON' : 'TXT'`) classified these files as TXT, which caused `tableroneExtractor.detect` to bail out at its `ctx.type !== 'JSON'` early-return — the file would then fall through to `urlOnlyExtractor` and produce broken output (each JSON line treated as a URL).
**Implementation**: A shared `resolveImportType(filename, content, override?)` helper in `apps/service/src/lib/import/extractors/index.ts` is now the single source of truth, called from both `export.{classify, preview, run}` and `import.{create, ensureJob}`. Order of precedence:
1. `override` (e.g. `import_jobs.type`) — the user already decided; we honor it.
2. Filename pattern (`/tablerone/i` substring) — catches the known wrong-extension case without needing to read the file.
3. Content sniff — first non-whitespace character is `{` or `[` → JSON. Catches the general "JSON content under a `.txt` extension" case (defense in depth for future extension mismatches).
4. Extension default (`.json` → JSON, otherwise TXT).
**Why both filename + content sniff**: Filename match is a cheap pre-check that lets callers without content (rare — `ensureJob` already had to read the file for its existence check, `import.create` always has content) still benefit. Content sniff is the real safety net; the filename pattern is just an explicit signal for the known Tablerone case.
**Why override wins**: An existing `import_jobs.type` represents a prior user choice (the user picked TXT explicitly in the Import modal, or the file was imported before this fix landed). Re-classifying behind the user's back would silently change parse behavior on next run; better to honor the stored choice and let the user re-import if they want the new logic.
**Migration**: Files imported via the UI before this fix retain their stored TXT type. Re-importing picks up the new logic. For files placed manually in `data/files/` (no `import_jobs` row), the new logic kicks in immediately — this covers the user's Tablerone use case.
**Alternative considered**: Loosen `tableroneExtractor.detect`'s type gate. Rejected — type resolution is a cross-cutting concern that affects every JSON-shaped extractor, not just Tablerone. A single helper that all callers go through is more maintainable than per-extractor overrides.

## Risks / Trade-offs

**[R1] Memory peak on large files**: A 4MB bookmark HTML file can extract into tens of thousands of Link objects + a JSON string ≈ 10–20MB. Batch of 10 serial calls keeps per-call memory bounded.
→ Mitigation: serial, not parallel; revoke each Blob URL immediately after the download fires.

**[R2] Browser multi-file download limits**: Chrome / Firefox prompt once for "multiple consecutive downloads". Slightly jarring UX.
→ Mitigation: Document the prompt and show a progress bar when the file count exceeds N. The user confirmed this is acceptable.

**[R3] `data/exports/` grows without bound**: With save-to-disk checked, artifacts accumulate; there is no auto-cleanup.
→ Mitigation: Out of scope this round — the user clears it from the OS. A future "Clear data/exports/" entry could live in Settings → Files prune (not in this change).

**[R4] Path traversal**: The `originalStem` in `data/exports/<originalStem>-<hash8>.json` comes from the source filename.
→ Mitigation: `resolveExportPath` applies the same `path.normalize` + `startsWith` guard as `resolveFilePath`, rejecting `..` and absolute paths. `originalStem` is also passed through `path.basename` + `replace[/\\]/g, '-'` for sanitization.

**[R5] Format mis-detection goes unnoticed by the user**: A OneTab line missing its `*` separator would be detected as `url_only` rather than `onetab_ini`, and the exported JSON would lose the title.
→ Mitigation: D7's Preview explicitly surfaces `detectedFormat` + a 10-row sample, and D14 adds the raw source block, letting the user verify before downloading.

**[R6] sha256 first-8-hex collisions**: Theoretically two different files with the same hash8 would target the same filename and the second write would overwrite the first.
→ Mitigation: 32-bit space; birthday-paradox ~50% collision requires ~65k files. At this feature's expected scale (hundreds to low thousands of exports), the collision probability is < 10⁻⁷. Acceptable. If scale grows, we can extend to 12 hex.

## Migration Plan

No DB migration. No breaking changes.

Deployment steps:
1. Service: add `routes/export.ts`; add `EXPORTS_DIR` to `lib/files/index.ts`.
2. Webapp: add the Export tab + ExportTab component.
3. `data/exports/` is `mkdir -p`-ed on first write.

Rollback: delete the new code; existing artifacts in `data/exports/` don't affect system operation (the user can delete them manually).

## Open Questions

None. All key decisions have been confirmed with the user.
