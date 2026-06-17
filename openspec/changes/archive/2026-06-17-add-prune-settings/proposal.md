## Why

The app accumulates data that has no in-product path to clean up: imported links grow with duplicates / internal / filtered entries that can only be removed via raw SQL; files in `data/files/` pile up with no bulk delete; and the `links` + `import_jobs` tables have no "reset to empty" affordance. Operators currently shell into SQLite to do maintenance. A centralised **Settings → Danger Zone** page makes these operations visible, auditable (via dry-run preview), and safe (via double confirmation).

## What Changes

- **Add** a `Settings` entry on the right side of the existing header in `RootLayout.tsx`, navigating to `/settings`.
- **Add** `/settings` as a top-level route in `Router.tsx` plus a new `SettingsPage` component under `apps/webapp/src/pages/`.
- **Add** a prominent red "DANGER ZONE" banner wrapping all prune UI on the Settings page (Mantine `Alert` / `Paper` with red border, visible above the fold).
- **Add** three prune sections inside the danger zone, each with a **dry-run** button (returns affected count + 10-row sample) and a **confirm-and-execute** button styled `color="red"`:
  - **Links** layer with four sub-operations:
    - `duplicate` — delete rows where `duplicateOf IS NOT NULL`
    - `internal` — delete rows where `isInternal = true`
    - `by-domain` — virtualized grouped checkbox list of distinct `domain` values (each with per-domain link count); delete rows for the selected set
    - `all` — delete every row in `links`
  - **Database** layer — truncate `links` and `import_jobs` (cascade-clears `test_results` via existing FK `onDelete: cascade`; `operations.jobId` becomes NULL via existing FK `onDelete: set null`). Schema and migrations are preserved.
  - **Files** layer — delete every file under `data/files/` AND the matching `import_jobs` rows whose `source_content` equals the deleted filename. Does NOT delete `links` rows (that is the DB layer's job).
- **Add** a tRPC router `prune` with:
  - `prune.dryRun({ kind, params? })` — returns `{ count, sample: Link[] | JobInfo[] | string[] }` without mutating state. `sample` is capped at 10 entries.
  - `prune.execute({ kind, params?, confirmToken })` — performs the deletion. `confirmToken` is a UUID returned by `dryRun` and validated to match, ensuring the user has seen the preview.
- **Reuse** the existing `useConfirm` Mantine hook (already used in `Files.tsx`) for the final confirm modal on top of the dry-run preview.

## Capabilities

### New Capabilities

- `settings-ui`: Top-level Settings route (`/settings`), the header entry point, and the page shell that hosts future non-prune settings sections. Initial population is the danger zone only.
- `prune-operations`: Three-tier destructive cleanup (links / database / files), each gated by dry-run preview + confirmation token. Covers the count/sample/execute lifecycle and the by-domain selection UX.

### Modified Capabilities

(None — `link-parse` and other existing capabilities are untouched. `prune-operations` deletes data they produced but does not change their contracts.)

## Impact

- **Code**:
  - `apps/webapp/src/Router.tsx` — add `/settings` route.
  - `apps/webapp/src/layout/RootLayout.tsx` — add Settings nav entry (gear icon + label) right-aligned.
  - `apps/webapp/src/pages/Settings.tsx` (new) — page shell + danger-zone banner + three prune sections.
  - `apps/webapp/src/pages/settings/` (new dir) — `LinksPruneSection.tsx`, `DatabasePruneSection.tsx`, `FilesPruneSection.tsx`, `DomainSelector.tsx` (virtualized).
  - `apps/service/src/routes/prune.ts` (new) — `prune` router with `dryRun` + `execute`.
  - `apps/service/src/lib/db/queries.ts` — new helpers: `countDuplicateLinks`, `deleteDuplicateLinks`, `countInternalLinks`, `deleteInternalLinks`, `listDomainsWithCounts`, `deleteLinksByDomains`, `deleteAllLinks`, `clearLinksAndImportJobs`, `listFilesForPrune`, `deleteAllFilesAndJobs`.
  - `apps/service/src/trpc.ts` — wire `prune` router into root router.
- **APIs**: New `prune` tRPC namespace with two procedures. No public HTTP change (still under `/trpc`).
- **Dependencies**: None added. Virtualized list reuses `@tanstack/react-virtual` (already used by `Files.tsx` for the line viewer).
- **Migration**: None. No schema changes — only new queries that operate on the existing `links` / `import_jobs` / `test_results` / `operations` tables.
- **Security**: All prune operations are **non-parameterised destructive** by design. The `confirmToken` round-trip is the only safety net beyond the UI confirm dialog. Procedures are public (no auth) consistent with the rest of the tRPC API; the deployment assumption is local-only access.
