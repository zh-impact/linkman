## Context

The linkman app has accumulated 7+ months of data with no in-product cleanup path. Current state:

- `links` table holds duplicates (`duplicateOf` non-null after a prior dedup pass), internal links (`isInternal = true`), and various `status` values tracking filtering outcomes. No way to mass-clear from the UI.
- `import_jobs` keeps history of every import. No way to wipe.
- `data/files/` accumulates source files. `Files.tsx` allows per-file delete but not bulk.
- Operators fall back to raw `sqlite3` commands, which is error-prone and skips any dry-run safety.

Existing infrastructure to build on:

- `useConfirm` hook in `apps/webapp/src/utils/use-confirm.ts` (used in `Files.tsx` for delete confirm).
- `@tanstack/react-virtual` already used for `VirtualLineViewer` and `ResolvedLineViewer`.
- `deleteLinksByIds` query (queries.ts:23) batches deletes in 500-row chunks — same pattern should be reused for prune operations to avoid SQLite "too many SQL variables" errors.
- FK declarations in schema: `test_results.linkId → links.id` `onDelete: cascade`, `operations.jobId → import_jobs.id` `onDelete: set null`. These cascade automatically when we DELETE from `links` / `import_jobs`.

## Goals / Non-Goals

**Goals:**
- Single discoverable entry point for destructive cleanup.
- Every operation has a visible **dry-run preview** before commit.
- Three independently-scoped tiers (links / db / files) so users can clean one layer without nuking the others.
- by-domain selection scales to thousands of distinct domains without UI lag.
- FK cascades are surfaced in the dry-run summary (e.g. "deleting N links will also cascade-delete M test_results rows").

**Non-Goals:**
- Soft-delete / undo / time-window recovery. Once `execute` returns success, the data is gone. The danger banner + confirm modal + dry-run token are the only guards.
- Per-row selection in the links prune (no "delete this specific link" UI here — that belongs on a future Links page detail view).
- Auth / role-based access control. Local single-user deployment assumed.
- Scheduling / automated prune policies (no "delete duplicates older than N days").
- Cross-machine sync. The page only affects the local SQLite DB + local `data/files/` directory.

## Decisions

### D1: Capability split — `settings-ui` vs `prune-operations`

Two capabilities because:

1. The Settings page is intended to grow (future: theme, normalize-config defaults, proxy config, etc.). The `settings-ui` capability captures the shell + routing + header entry that persists regardless of which sections populate it.
2. `prune-operations` is a self-contained subsystem with its own data-flow contract (dryRun → preview → execute). Treating it as a separate capability makes it possible to add/remove prune actions without touching the shell.

Cross-capability contract: `settings-ui` only requires "the Settings page exists at `/settings` and renders a danger zone placeholder". `prune-operations` fills that placeholder. Either can ship without the other (Settings page with empty danger zone is shippable; prune router with no UI is callable via curl).

### D2: Two-procedure pattern — `dryRun` + `execute` with confirm token

```ts
prune.dryRun({ kind, params? }): { confirmToken: string, count: number, cascadeCounts: {...}, sample: Link[] | JobInfo[] | FilePreview[] }
prune.execute({ kind, params?, confirmToken }): { deletedCount: number }
```

`confirmToken` is a UUID generated server-side at dryRun time, stored in an in-memory `Map<token, { kind, params, expiresAt }>` with 5-minute TTL. `execute` looks up the token, validates `kind` + `params` match what was previewed, deletes, and invalidates the token.

**Why:** prevents the race where a user dry-runs operation A, then changes params to operation B in the UI, then submits `execute` — without the token, we'd execute B silently. With the token, the server enforces that what executes is what was previewed.

**Why in-memory + TTL:** no DB persistence needed. A service restart invalidates all pending prune tokens (acceptable — user just re-runs dry-run). 5 minutes is enough time to read the preview and confirm.

**Alternative considered:** single `execute({ dryRunFirst: true })` endpoint that returns the preview without committing, then the same endpoint with `dryRunFirst: false` commits. Rejected because (a) the two calls have different return shapes, complicating typing; (b) frontend caching of the "first call's preview" is implicit and brittle.

### D3: `duplicate` defined as `duplicateOf IS NOT NULL`

The schema already has `duplicateOf text('duplicate_of')` (schema.ts:34) populated by the existing dedup pass. Reusing this field avoids recomputing duplicate detection at prune time. If a future dedup implementation marks duplicates differently, the prune query updates in one place.

Edge case: rows where `status = 'duplicate_removed'` but `duplicateOf IS NULL` would be missed. Verified against current dedup code that this combination doesn't occur (dedup always sets both atomically).

### D4: `internal` defined as `isInternal = true`

Direct boolean column (schema.ts:32). No status-based disambiguation needed — `isInternal` is the canonical marker; `status = 'filtered_internal'` is a downstream state that doesn't change which rows are internal.

### D5: by-domain uses virtualized grouped checkboxes

Data shape: `listDomainsWithCounts()` returns `{ domain: string, count: number }[]` ordered by count desc. Frontend renders via `@tanstack/react-virtual` (same pattern as `VirtualLineViewer`), each row a Mantine `Checkbox` + domain + count + select-all-per-domain. The virtualizer keeps DOM nodes to ~20 even with thousands of domains.

Selection state: `Set<string>` of domains. `dryRun` payload includes `{ domains: string[] }`. Server validates each selected domain exists (defensive — a domain could disappear between dryRun and execute if another prune ran concurrently, but that's an acceptable best-effort).

**Why not text input:** users don't remember domain strings; checkboxes scale better. **Why not multi-select dropdown:** Mantine's `MultiSelect` renders all options in DOM, laggy past 1000 entries.

### D6: Files-layer cascade — delete files + matching `import_jobs` rows

When pruning files, the operation:

1. Lists all filenames under `data/files/` via the existing `listFiles()` helper (recursive walk).
2. `DELETE FROM import_jobs WHERE source_content IN (<filenames>)`.
3. `unlink()` each file.

**Why not also delete links:** the user already has a separate "Database → clear links" operation for that. Coupling files-clear to links-clear would prevent the legitimate workflow "wipe files but keep imported links for re-test".

**Why delete import_jobs:** an `import_job` whose `source_content` references a deleted file is broken — `parse.start` would fail to read it. Leaving them creates confusing state in the Files list (orphaned job dots). Cleanup is cheap.

**FK consideration:** `operations.jobId → import_jobs.id` is `onDelete: set null`, so operation history is preserved with `jobId = NULL`. Acceptable — history should outlive the source.

### D7: Database-layer cascade behavior

`clearLinksAndImportJobs()` runs (in a single transaction):

1. `DELETE FROM links;` — triggers `test_results` cascade deletes via FK.
2. `DELETE FROM import_jobs;` — triggers `operations.jobId` set-null via FK.

`operations` and `snapshots` tables are **preserved by the `database` kind** — they represent audit history that should survive a links/jobs reset. Clearing them is the responsibility of the dedicated `audit` kind (see D10) so the user can independently decide whether to wipe history.

**Dry-run output** must surface the cascade so the user knows the blast radius:

```ts
{ count: 12500, cascadeCounts: { testResults: 8421 }, jobCount: 47 }
```

### D8: Danger zone UI composition

```
┌──────────────────────────────────────────────────────┐
│ ⚠️  DANGER ZONE                                       │
│ These operations are irreversible. Each requires      │
│ dry-run preview + confirmation.                       │
├──────────────────────────────────────────────────────┤
│ Links                                                 │
│  [Duplicates: 1,234] [Internal: 89] [By Domain ▼]    │
│  [All Links: 12,500]                                  │
├──────────────────────────────────────────────────────┤
│ Database                                              │
│  [Clear links + import_jobs: 12,507 rows + 47 jobs]  │
├──────────────────────────────────────────────────────┤
│ Files                                                 │
│  [Delete all files: 13 files / 23.4 MB]              │
├──────────────────────────────────────────────────────┤
│ Audit history                                         │
│  [Clear operations + snapshots: 47 ops / 5 snapshots]│
└──────────────────────────────────────────────────────┘
```

- Top banner: Mantine `Alert color="red" variant="filled"` with `⚠️ DANGER ZONE` title.
- Each section: `Paper withBorder p="md"` with section title + count summary + dry-run button + execute button (disabled until dryRun completes).
- Execute buttons: `Button color="red"`, disabled until `confirmToken` is set (from a successful dryRun).
- After execute: refetch counts via `prune.dryRun` with same kind (now zero) to refresh the UI.

### D9: Sample preview size — 10 rows

`dryRun.sample` returns at most 10 representative rows (first 10 by `createdAt desc` for links, by `id` for jobs, alphabetically for files). 10 is enough for the user to sanity-check "yes these are the rows I mean" without flooding the modal. The full count is in `dryRun.count`.

### D10: Audit-history prune — `kind: 'audit'`

A fourth prune kind clears `operations` and `snapshots` together. Reasons to keep it separate from `database`:

1. **Different blast radius.** Database prune wipes user content (links + import jobs). Audit prune wipes metadata about past operations. A user resetting for a fresh-data run often wants to keep the audit trail; a user starting completely fresh wants both.
2. **Snapshots are orphaned after `database` prune.** `snapshots.link_ids` references link UUIDs that no longer exist post-`database`-prune, making rollback impossible. The audit prune gives the user a way to clean up that orphaned metadata without writing raw SQL.
3. **Discoverability.** Putting it in the same UI surfaces the fact that these tables exist and accumulate rows — operators no longer need to know to `sqlite3 DELETE FROM snapshots` manually.

**Dry-run shape:**

```ts
{ count: <operations>, snapshotCount: <snapshots>, sample: <first 10 operations by timestamp desc> }
```

**Execute:** `db.transaction` wrapping `DELETE FROM operations` + `DELETE FROM snapshots`. Returns `{ deletedCount: <operations deleted>, snapshotsDeleted: <snapshots deleted> }`.

**No cascade considerations:** neither `operations` nor `snapshots` is referenced by other tables via FK, so there's nothing to surface in `cascadeCounts`.

## Risks / Trade-offs

- **`confirmToken` in-memory means a service restart between dryRun and execute forces a re-preview** → Mitigation: 5-minute TTL is short enough that users naturally re-preview after any pause. Trade-off accepted for simplicity.
- **by-domain selection could include thousands of domains, making the network payload large** → Mitigation: `listDomainsWithCounts` is one query, payload is `~30 bytes * N`. For 10k domains that's ~300KB — acceptable for a local dev tool. If it ever becomes a problem, switch to paginated domain loading.
- **A concurrent import or test job could insert rows between dryRun and execute, making `execute` delete more than `dryRun.count` reported** → Mitigation: documented in the dryRun output ("counts are approximate; concurrent inserts may change the final number"). The blast radius is bounded by the `kind` filter so no unrelated data is touched.
- **No audit log of prune operations** → Accepted for v1. The `operations` table is preserved through prune, so other operations' history remains; prune itself is not recorded. Could be added later by inserting an `operations` row with `type = 'manual_delete'` before each execute.
- **FK cascade on `DELETE FROM links` could be slow if `test_results` is huge** → Mitigation: SQLite cascade deletes happen in the same transaction. For pathological cases (>1M test_results), wrap in `BEGIN TRANSACTION` + `PRAGMA journal_mode = WAL` (already set). Worst case the user waits a few seconds; no correctness issue.
- **Public procedures (no auth)** → Consistent with existing `import.*` and `parse.*`. If linkman ever gains a multi-user mode, all destructive routes will need auth gating as a separate change.
