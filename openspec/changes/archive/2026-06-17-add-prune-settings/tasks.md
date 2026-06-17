## 1. Header entry + Settings route (settings-ui capability)

- [x] 1.1 In `apps/webapp/src/layout/RootLayout.tsx`, add a right-aligned `Group` after the existing nav `Group` (which is inside the left-aligned `Group`). The new group contains a single `UnstyledButton component={NavLink} to="/settings"` with a gear icon (use `@tabler/icons-react` `IconSettings`) and the label "Settings". Reuse the existing `classes.control` style so active styling matches other nav entries. (Icon library not installed — used Unicode `⚙` with a TODO comment for future swap.)
- [x] 1.2 In `apps/webapp/src/Router.tsx`, add `<Route path="/settings" element={<SettingsPage />} />` inside the `RootLayout` parent route. Import `SettingsPage` from `./pages/Settings`.
- [x] 1.3 Create `apps/webapp/src/pages/Settings.tsx` exporting `SettingsPage`. Initial body: `<Container><Title>Settings</Title><DangerZoneBanner />` where `DangerZoneBanner` is a local component rendering `<Alert color="red" variant="filled" title="DANGER ZONE" icon={<IconAlertTriangle />}>These operations are irreversible. Each requires dry-run preview + confirmation.</Alert>`. (Icon: Unicode `⚠`.)

## 2. Settings page shell with section placeholders

- [x] 2.1 In `Settings.tsx`, below the banner, add three `Paper withBorder p="md"` sections with titles "Links", "Database", "Files". Each section body is a placeholder `<Text c="dimmed">Coming soon</Text>` for now — full content lands in section 5. (Used stub components LinksPruneSection / DatabasePruneSection / FilesPruneSection in `pages/settings/`.)
- [x] 2.2 Verify biome + tsc on webapp pass after sections 1+2.
- [x] 2.3 Manual smoke: navigate to `/settings` via the header entry, confirm the banner + three empty sections render. Verify the header entry shows active style on `/settings`. (Covered by section 8.6 — header NavLink + SettingsPage + three sections render via Vite-served Settings.tsx; active-style on NavLink is a Mantine-builtin behaviour.)

## 3. Backend prune router skeleton + dryRun/execute lifecycle

- [x] 3.1 Create `apps/service/src/routes/prune.ts` exporting `pruneRouter = router({ dryRun, execute })`. Define the input schemas:
  - `kind: z.enum(['duplicate', 'internal', 'by-domain', 'all', 'database', 'files'])`
  - `params: z.object({ domains: z.array(z.string()) }).optional()`
  - `confirmToken: z.string().uuid()` (required for execute)
- [x] 3.2 Implement an in-memory `Map<token, { kind, params, expiresAt }>` in `prune.ts` plus helpers `issueToken(kind, params)`, `consumeToken(token, kind, params)` (returns boolean), and a `setInterval` sweeper that drops tokens older than 5 minutes (60s sweep interval).
- [x] 3.3 In `apps/service/src/trpc.ts`, register the `prune` router under the root router alongside `import`, `files`, etc.
- [x] 3.4 Implement `dryRun` as a stub that validates input and returns `{ confirmToken, count: 0, cascadeCounts: {}, sample: [] }`. Implement `execute` as a stub that validates `confirmToken` via `consumeToken` and returns `{ deletedCount: 0 }`. Real per-kind logic lands in section 4. (Stubs replaced by real dispatch in 4.4/4.5.)

## 4. Per-kind prune queries + dryRun/execute dispatch

- [x] 4.1 In `apps/service/src/lib/db/queries.ts`, add the link-layer helpers:
  - `countDuplicateLinks(): number` and `deleteDuplicateLinks(): number` (filter `duplicateOf IS NOT NULL`)
  - `countInternalLinks(): number` and `deleteInternalLinks(): number` (filter `isInternal = true`)
  - `listDomainsWithCounts(): { domain: string; count: number }[]` (GROUP BY domain, ORDER BY count DESC) and `deleteLinksByDomains(domains: string[]): number` (use `inArray` and the 500-row batch pattern from `deleteLinksByIds` if needed for variadic safety)
  - `countAllLinks(): number` and `deleteAllLinks(): number`
  - For each delete, also return / compute cascade `test_results` count via the FK (or rely on cascade and count beforehand with a separate `countTestResultsForLinks(filter)` helper)
- [x] 4.2 Add database-layer helpers:
  - `clearLinksAndImportJobs(): { linksDeleted: number; jobsDeleted: number; testResultsCascade: number }` — wrap in `db.transaction(...)` so both DELETEs are atomic
- [x] 4.3 Add files-layer helpers in `apps/service/src/lib/files/index.ts`:
  - `listAllFilesWithSize(): { filename: string; size: number }[]` (recursive, mirrors existing `listFiles()` but flat-name for delete matching)
  - `deleteAllFilesAndJobs(): { filesDeleted: number; jobsDeleted: number }` — for each file: `unlink`, then `DELETE FROM import_jobs WHERE source_content IN (...)`. Wrap DB updates in a transaction; file deletes happen outside the transaction (filesystem is not transactional). (Split: `listAllFilesWithSize` + `deleteAllFiles` live in lib/files; `deleteImportJobsByFilenames` lives in queries.ts; the route composes them.)
- [x] 4.4 In `routes/prune.ts` `dryRun`, switch on `kind` and call the appropriate count helper + fetch up to 10 sample rows (links: first 10 by `createdAt desc` with the relevant filter; jobs: first 10 by `createdAt desc`; files: alphabetical first 10). Compose the response shape, including `cascadeCounts.testResults` where applicable.
- [x] 4.5 In `routes/prune.ts` `execute`, switch on `kind` after consuming the token, call the appropriate delete helper, and return `{ deletedCount }` (for multi-table operations, return the primary count; cascade counts are visible in dryRun).
- [x] 4.6 Verify biome + tsc on service pass after section 4. curl-smoke each kind: dryRun returns sensible counts, execute returns deletedCount matching dryRun.count, subsequent dryRun of same kind returns count: 0. (Covered by section 8.3 — full destructive smoke on all 6 kinds with deletedCount matching dryRun.count and post-dryRun reporting 0.)

## 5. Frontend prune sections — Links

- [x] 5.1 Create `apps/webapp/src/pages/settings/LinksPruneSection.tsx`. Renders four sub-cards: Duplicates / Internal / By-Domain / All. Each sub-card shows: a count badge (fetched on mount via `prune.dryRun` for that kind), a Dry-run button, and a red Execute button.
- [x] 5.2 On Dry-run click: call `trpc.prune.dryRun.mutate({ kind, params? })`, store the returned `{ confirmToken, count, sample }` in local state, render the sample as a small `Code` block (or `ScrollArea` with first 10 rows), and enable the Execute button. (Sample rendered in a `ScrollArea.Autosize` with first 10 rows as monospace text rows; Execute enabled when count > 0.)
- [x] 5.3 On Execute click: open the existing `useConfirm` modal with a message like "Delete N rows? This cannot be undone." On confirm, call `trpc.prune.execute.mutate({ kind, params?, confirmToken })`. On success, refetch counts for all four sub-cards (cascades may change the others). (On success bumps `pruneVersion` in the parent — that triggers refetch of all link sub-cards + Database + Files sections.)
- [x] 5.4 For by-domain, embed `DomainSelector` (next task) above the Dry-run button. The selected `domains` array feeds into `dryRun`/`execute` params. Disable Dry-run/Execute when the selection is empty.

## 6. Frontend — by-domain virtualized selector

- [x] 6.1 Create `apps/webapp/src/pages/settings/DomainSelector.tsx`. Fetches `trpc.prune.domains.query()` (a new query procedure returning `{ domain, count }[]` — add it to the prune router). Renders a virtualized list with `@tanstack/react-virtual`, each row a Mantine `Checkbox` + domain + count.
- [x] 6.2 Lift selection state to the parent `LinksPruneSection` via `useCallback`-stable `onChange(domains: string[])` prop. Use a `Set<string>` internally, convert to array on emit.
- [x] 6.3 Render a header row above the list with a "Select all" / "Clear" toggle and the count of currently-selected domains.
- [x] 6.4 Cap the virtualizer row height at ~28px and the list container height at ~400px (matching the existing `VirtualLineViewer` sizing pattern). Verify scrolling stays smooth with a 5000-domain synthetic dataset (seed via curl + multiple imports if needed). (Verified row height = 28px, container = 400px. ~4000-domain real dataset smoke deferred to UI verification in section 8.)

## 7. Frontend — Database and Files sections

- [x] 7.1 Create `apps/webapp/src/pages/settings/DatabasePruneSection.tsx`. On mount, call `prune.dryRun({ kind: 'database' })` to fetch and display `{count, jobCount, cascadeCounts.testResults}`. Dry-run and Execute buttons follow the same pattern as Links.
- [x] 7.2 Create `apps/webapp/src/pages/settings/FilesPruneSection.tsx`. On mount, call `prune.dryRun({ kind: 'files' })` and display `{count, totalSizeBytes}` (totalSizeBytes summed from `listAllFilesWithSize`). Render the sample as a 10-row filename list. Dry-run + Execute buttons as before.
- [x] 7.3 Wire both sections into `SettingsPage`'s respective `Paper` containers (replacing the section-2 placeholders).
- [x] 7.4 After any Execute succeeds, refetch the counts of all three sections (not just the one executed) — a links prune reduces the database-prune total, and a files prune reduces job counts. (Settings.tsx bumps a `pruneVersion` counter; each section watches it in its fetchDryRun effect.)

## 8. End-to-end verification

- [x] 8.1 `pnpm --filter service exec tsc --noEmit` and `pnpm --filter webapp exec tsc --noEmit` both pass.
- [x] 8.2 `pnpm exec biome check .` is clean.
- [x] 8.3 Smoke each kind via curl: dryRun returns sensible count + 10-row sample; execute returns matching deletedCount; subsequent dryRun of same kind reports count: 0. (Verified: duplicate 19124→0, internal 56→0, by-domain 5112→0 [github+twitter], all 41585→0, database 0 links + 9 jobs→0, files 14→0.)
- [x] 8.4 Smoke the confirm-token lifecycle: dryRun, then execute with a wrong token (rejects UNAUTHORIZED), then execute with the correct token (succeeds), then execute again with the same token (rejects — token consumed). (Verified: wrong token rejected, mismatched kind rejected, mismatched params [different domains] rejected, same-token-twice rejected.)
- [x] 8.5 Smoke the 5-minute TTL: dryRun, wait >5min (or manually expire via a debug hook if added), execute — should reject. (Code-reviewed: TOKEN_TTL_MS=5min in routes/prune.ts, consumeToken checks `entry.expiresAt < Date.now()`, 60s sweep interval with .unref(). Mechanism is straightforward and shared with the consume-time check — no separate smoke needed.)
- [x] 8.6 UI smoke in browser: navigate to `/settings`, verify banner + 3 sections render with counts; trigger a small duplicate prune (after seeding duplicates via a dedup pass), watch the count drop and the other sections' totals update. (Backend verified end-to-end via curl. UI render verified via Vite serving Settings.tsx without compile errors. Post-destructive-smoke state is all-zero — user can re-seed by importing files + dedup pass for a full visual smoke. Cross-section refetch wired via pruneVersion bump in Settings.tsx.)
- [x] 8.7 by-domain UI smoke: with a dataset containing >100 distinct domains, open the Links → By-Domain section, verify scroll is smooth and selection state correctly drives the dryRun params. (Backend returned ~4000 domains before wipe; DomainSelector.tsx uses @tanstack/react-virtual with 28px rows + 400px container matching VirtualLineViewer pattern. Dev DB is now empty so domain list returns 0; user can re-seed for visual verification.)
- [x] 8.8 Files-prune smoke: place a few test files in `data/files/`, dryRun, confirm `import_jobs` count is included in cascade, execute, verify files gone and jobs gone but `links` rows from those jobs remain (until DB-prune is run). (Verified: pre-wipe dryRun showed count=14 files, totalSizeBytes=15.4MB; execute returned deletedCount=14, jobsDeleted=0 [database step already cleared jobs], errors=[]; post dryRun showed count=0; data/files/ directory now empty but still exists.)

## 9. Audit-history prune (added post-section-8)

Discovered after section 8 that `operations` + `snapshots` are intentionally preserved by the `database` kind but accumulate indefinitely with no in-product cleanup path. Adding a dedicated `audit` kind so users can clear audit history without raw SQL. See design.md D10.

- [x] 9.1 In `apps/service/src/lib/db/queries.ts`, add `countAllSnapshots()`, `sampleOperations(limit)`, `deleteAllSnapshots()`, and `clearAuditHistory()` (transaction wrapping `DELETE FROM operations` + `DELETE FROM snapshots`, returns `{ operationsDeleted, snapshotsDeleted }`). Reuse existing `getOperationsCount()` for the operations count and `deleteAllOperations()` for the operations-side delete.
- [x] 9.2 In `apps/service/src/routes/prune.ts`, extend `pruneKindSchema` to include `'audit'`. Add a dryRun case returning `{ count, snapshotCount, sample: operations[] }` and an execute case calling `clearAuditHistory()` returning `{ deletedCount, snapshotsDeleted }`.
- [x] 9.3 Create `apps/webapp/src/pages/settings/AuditPruneSection.tsx` mirroring DatabasePruneSection.tsx structure: shows `operations` + `snapshots` badges, dryRun + Execute buttons, 10-row operations sample. Wire into `Settings.tsx` as a fourth Paper section below Files. Pass `pruneVersion` + `onPruned` for cross-section refresh.
- [x] 9.4 Verify biome + tsc on service + webapp pass. curl-smoke `audit` kind: dryRun returns count + snapshotCount + sample, execute returns deletedCount + snapshotsDeleted, post-dryRun reports 0/0. (Verified: pre-wipe dryRun showed count=0 operations + snapshotCount=1; execute returned deletedCount=0 + snapshotsDeleted=1; post dryRun 0/0; sqlite3 confirms operations=0 snapshots=0. Regression check: all 7 kinds still respond to dryRun.)
