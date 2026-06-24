## Why

linkman can already recognize a wide range of "non-standard" source formats at Import time (OneTab, CSV, browser bookmark HTML, Tablerone JSON, etc.) through the `extractorRegistry`. However, the **result only lands in the `links` table — the user never gets their hands on a clean, standardized artifact**. Backup to external tools, archival, and cross-device migration all require hand-stitching JSON.

The requirement: turn any already-imported source file into a standardized JSON array (`[{url, title}, ...]`) on demand, independently and decoupled from Parse / Prune (no dependency on whether the file has been parsed into the database).

## What Changes

- **New Files → Export tab**: sits alongside the existing Sources / Resolved tabs, dedicated to "source file → standardized JSON" conversion and export.
- **Multi-select + batch export**: each selected source file produces one independent `.json`, delivered as a serial browser download (no zip packaging — avoids pulling in a new dependency).
- **Data source = real-time `extractLinks`**: every Export click re-runs detect + extract; we never read the `links` table and never require the file to have been parsed first. Behavior is consistent with Parse, and the flow is self-contained and replayable.
- **Two independent delivery channels**: browser download + write to `data/exports/`, behind **two independent toggles**. The user can choose "download only", "save only", or "both"; both default on, and at least one must be enabled for Export to fire.
- **Content-hash deduplication (for the save-to-disk path only)**: the first 8 hex of the source file's sha256 is encoded into the export filename (`<stem>-<hash8>.json`); re-exporting the same file when the matching `data/exports/` artifact already exists skips the disk write. Browser downloads do not participate in deduplication (immediate consumption — every click is a deliberate user action).
- **`data/exports/` is physically isolated from `data/files/`**: exported artifacts never show up in the Sources file list, preventing accidental re-import (e.g., clicking Parse on a previously exported JSON).
- **Export artifact schema**: standard `[{url, title}, ...]` JSON array; filename = `<originalStem-without-extension>-<sha256-first-8-hex>.json`.
- New service-side tRPC sub-routes: `export.preview` (peek at detected format + count + sample before exporting) and `export.run` (run extraction, return JSON string + optional saved path + skip flag) — plus `export.classify` (detect-only, used to filter the list).

## Capabilities

### New Capabilities
- `link-export`: convert any source file whose format is recognized by the extractor registry into a standardized JSON array, with multi-select batch, real-time extraction, and dual delivery (browser download + save to `data/exports/`).

### Modified Capabilities
- `files-browser`: add a third tab (Export) to the Files page, extending the existing tab set (Sources / Resolved → Sources / Resolved / Export). All other behavior is unchanged.

## Impact

**New / modified code**:
- `apps/service/src/lib/files/index.ts` — new `EXPORTS_DIR` constant, `writeExportFile`, and `resolveExportPath` (mirrors the existing path-traversal guard).
- `apps/service/src/routes/export.ts` (new) — tRPC sub-router: `classify` / `preview` / `run`, all reusing `extractLinks(content, type, filename)`.
- `apps/service/src/appRouter.ts` — register `export: exportRouter`.
- `apps/webapp/src/pages/Files.tsx` — add the third `<Tabs.Tab value="export">` + `<Tabs.Panel>` + new `<ExportTab />` component.
- `apps/webapp/src/pages/files/ExportTab.tsx` (new) — multi-select file list, dual delivery switches, Preview card, export loop with per-file progress and summary.

**Reused**:
- `extractLinks` from `apps/service/src/lib/import/extractors/index.ts` (already stable, pure function, deterministic output).
- `trpc.files.list.query()` (the Export tab also needs the source file inventory; safe to fetch independently).

**Not affected**:
- `links` table / `import_jobs` table / Parse flow / Prune flow.
- Existing Sources and Resolved tab behavior.
- Existing extractor implementations.

**Dependencies**: no new third-party dependencies (browser download goes through Blob URL + `<a download>`; no jszip).

**Storage**: new `data/exports/` directory (auto-created on first write); not tracked in git (same as `data/files/`).
