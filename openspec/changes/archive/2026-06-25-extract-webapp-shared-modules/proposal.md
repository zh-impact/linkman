## Why

The webapp pages (`Dedup.tsx`, `Files.tsx`, `Filter.tsx`, `Home.tsx`, `Import.tsx`, `Links.tsx`, `pages/files/ExportTab.tsx`) had each grown their own inline copies of the same UI building blocks: a `formatSize()` byte formatter, the `LINK_STATUS_CONFIG` / `LINK_STATUS_OPTIONS` tables, virtual-scroll plumbing for the resolved-URL viewer, expandable group cards, stats cards, and the file/clipboard import input. The duplication wasn't accidental — each page copy-pasted the prior one's working version and drifted independently. Net effect: ~300 lines of repeated boilerplate, a single status-label tweak required touching 4+ files, and subtle inconsistencies where one page's `formatSize(1536)` returned `1.5 KB` while another's returned `1536 B` because of a copied threshold typo.

The requirement is to lift these shared building blocks into one place under `apps/webapp/src/components/` (+ `apps/webapp/src/utils/format.ts`) and have the pages import them. The refactor also locks in the cross-page consistency property that the inline drift had been silently violating.

## What Changes

Six new shared modules, each extracted from where it was first duplicated:

- `apps/webapp/src/utils/format.ts` — `formatSize(bytes)` helper.
- `apps/webapp/src/components/VirtualList.tsx` — `VirtualList` (virtualized list with optional infinite-scroll `onLoadMore`) + `VirtualLine` (row wrapper with optional line numbers).
- `apps/webapp/src/components/status-config.ts` — `LINK_STATUS_CONFIG` (status → `{ label, color }`) + `LINK_STATUS_OPTIONS` (filter dropdown options).
- `apps/webapp/src/components/StatsCard.tsx` — labeled value card with loading skeleton.
- `apps/webapp/src/components/ImportContent.tsx` — `useImportInput` hook (file picker + clipboard paste + error state) + `<ImportContent />` preview component.
- `apps/webapp/src/components/ExpandableGroupCard.tsx` — header / expand / select container used by grouped link views.

Eight existing pages refactored to import from the new modules: `Dedup.tsx`, `Files.tsx`, `Filter.tsx`, `History.tsx`, `Home.tsx`, `Import.tsx`, `Links.tsx`, `pages/files/ExportTab.tsx`. Net **-302 lines** across the pages, **+398 lines** in the new modules (the modules include documentation and prop types that the inline copies lacked).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `files-browser`: adds two requirements that codify properties the refactor establishes in practice — (1) cross-page status rendering consistency (same status → same label + color on every page, backed by one shared config) and (2) reusable file-size formatting (same byte count → same display everywhere). Before this refactor the inline copies had drifted, so the consistency was an aspiration; the extracted modules + the spec scenario make it a guarantee.

## Impact

**New code**:
- `apps/webapp/src/utils/format.ts`
- `apps/webapp/src/components/VirtualList.tsx`
- `apps/webapp/src/components/status-config.ts`
- `apps/webapp/src/components/StatsCard.tsx`
- `apps/webapp/src/components/ImportContent.tsx`
- `apps/webapp/src/components/ExpandableGroupCard.tsx`

**Modified code** (imports only — no logic changes):
- `apps/webapp/src/pages/Dedup.tsx`
- `apps/webapp/src/pages/Files.tsx`
- `apps/webapp/src/pages/Filter.tsx`
- `apps/webapp/src/pages/History.tsx`
- `apps/webapp/src/pages/Home.tsx`
- `apps/webapp/src/pages/Import.tsx`
- `apps/webapp/src/pages/Links.tsx`
- `apps/webapp/src/pages/files/ExportTab.tsx`

**Not affected**:
- Service code (`apps/service/**`) — refactor is webapp-only.
- Any tRPC contract, DB schema, or persistence layer.
- Capabilities other than `files-browser` — no other capability's spec changes.

**Dependencies**: none added, none removed. `@tanstack/react-virtual` was already a dependency (Files.tsx used it directly before; now it lives inside `VirtualList.tsx`).

**Verification**: `pnpm --filter webapp exec tsc --noEmit` passes. Visual smoke-test of each affected page confirmed identical UX.
