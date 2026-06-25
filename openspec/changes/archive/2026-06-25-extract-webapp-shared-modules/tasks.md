## 1. Pure helpers

- [x] 1.1 Create `apps/webapp/src/utils/format.ts` with `formatSize(bytes: number): string` (B / KB / MB thresholds, one-decimal formatting). Document the threshold boundaries in a JSDoc comment so future readers don't have to reverse-engineer them.
- [x] 1.2 Update `apps/webapp/src/pages/files/ExportTab.tsx` to import `formatSize` from `'../../utils/format'`; remove the inline copy.
- [x] 1.3 Update `apps/webapp/src/pages/Files.tsx` to import `formatSize` from `'../utils/format'`; remove the inline copy.
- [x] 1.4 Update remaining pages with inline copies of `formatSize` (Home, Dedup, Filter, Import, History) to import from the new module.
- [x] 1.5 Update `apps/webapp/src/pages/settings/FilesPruneSection.tsx` to import `formatSize` from `'../../utils/format'`; remove the inline copy. (Missed in 1.4 because the file lives under `pages/settings/` rather than `pages/` directly — caught by `/opsx:verify` W1.)

## 2. Virtual scrolling

- [x] 2.1 Create `apps/webapp/src/components/VirtualList.tsx` exporting:
  - `VirtualList` — props `{ items, rowHeight?, overscan?, scrollHeight?, renderItem, header?, total?, onLoadMore?, loadingMore?, loadMoreThreshold? }`. Internally owns the `useVirtualizer` plumbing, parent ref, and load-more trigger logic.
  - `VirtualLine` — props `{ index, showLineNumbers?, children }`. Renders the monospace row wrapper with optional right-aligned line numbers.
- [x] 2.2 Refactor `ResolvedLineViewer` in `apps/webapp/src/pages/Files.tsx` to use `<VirtualList>` + `<VirtualLine>`. Header bar stays inline in the page (it's page-specific copy).
- [x] 2.3 Refactor any other page that had copy-pasted the `useVirtualizer` + load-more pattern to use `<VirtualList>` instead.

## 3. Status configuration

- [x] 3.1 Create `apps/webapp/src/components/status-config.ts` exporting:
  - `LINK_STATUS_CONFIG: Record<string, { label: string; color: string }>` — every link status with its human label and Mantine color.
  - `LINK_STATUS_OPTIONS: { value: string; label: string }[]` — the filter-dropdown list (prepended with `{ value: '', label: 'All' }`).
- [x] 3.2 Update `apps/webapp/src/pages/Links.tsx` to import both; remove the inline `statusConfig` and `STATUS_OPTIONS` constants.
- [x] 3.3 Update `apps/webapp/src/pages/Dedup.tsx`, `Filter.tsx`, `History.tsx` to import from the same module for any status-badge or status-filter rendering.

## 4. Stats card

- [x] 4.1 Create `apps/webapp/src/components/StatsCard.tsx` with props `{ label, value, color?, bg?, loading? }`. When `loading` is true, render a `<Skeleton>` in place of the value.
- [x] 4.2 Refactor `apps/webapp/src/pages/Home.tsx` to render its stats grid via `<StatsCard>`.
- [x] 4.3 Refactor `apps/webapp/src/pages/Dedup.tsx` (and any other page with the same stat-card pattern) to use `<StatsCard>`.

## 5. Import input

- [x] 5.1 Create `apps/webapp/src/components/ImportContent.tsx` exporting:
  - `useImportInput()` hook — returns `{ file, fileContent, error, resetRef, handleFileSelect, handlePasteFromClipboard, reset, setFile, setFileContent, setError }`.
  - `<ImportContent />` component — renders the file picker + clipboard paste button + preview Code block, using the hook internally.
- [x] 5.2 Refactor `apps/webapp/src/pages/Import.tsx` to use `<ImportContent />`.
- [x] 5.3 Refactor `apps/webapp/src/pages/Home.tsx` to use the `useImportInput()` hook with its own custom trigger button.

## 6. Expandable group card

- [x] 6.1 Create `apps/webapp/src/components/ExpandableGroupCard.tsx` with props `{ expanded, onToggleExpand, selected?, onToggleSelect?, header, headerRight?, children?, expandedBg?, selectedBg?, defaultBg? }`.
- [x] 6.2 Refactor `apps/webapp/src/pages/Dedup.tsx` and `Links.tsx` (and any other page with the expandable-group pattern) to use `<ExpandableGroupCard>`.

## 7. Verification

- [x] 7.1 `pnpm --filter webapp exec tsc --noEmit` passes.
- [x] 7.2 `pnpm exec biome check` clean on all new and modified files.
- [x] 7.3 Visual smoke-test: every affected page (Dedup, Files, Filter, History, Home, Import, Links, ExportTab) renders identically to pre-refactor — no missing labels, no broken virtual scrolling, no status badge color regressions.
- [x] 7.4 Confirm no service-side code (`apps/service/**`) was touched.
- [x] 7.5 Confirm spec deltas are limited to `specs/files-browser/spec.md` (cross-page status rendering consistency + reusable file-size formatting) — no other capability's spec was modified.
