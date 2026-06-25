## Context

The webapp had organically accumulated six categories of duplicated UI code across eight page components. Each duplication started innocently ("copy this working snippet from page X"), then drifted, producing subtle inconsistencies (e.g., `LINK_STATUS_CONFIG` had three different orderings across Files/Links/Filter before this refactor). This change consolidates them under `apps/webapp/src/components/` and `apps/webapp/src/utils/format.ts` without touching behavior.

**Constraint**: zero behavior change. If a page rendered a status label as "Available" before, it must render "Available" after. The acceptance test is a visual smoke-test of each affected page; no spec requirement or scenario may change.

## Goals / Non-Goals

**Goals**:
- One canonical home for each shared building block.
- Pages shrink to their unique business logic (subtotal: -302 lines across the eight pages).
- Future cross-page consistency changes (e.g., renaming `dns_failed`'s label) become one-file edits.
- Each extracted module documents its props/inputs at the module level.

**Non-Goals**:
- No new functionality, no UX changes, no API contract changes.
- No spec changes — this refactor is invisible to the spec layer.
- No service-side changes.
- No styling overhaul beyond what's needed to match the originals.

## Decisions

### D1: Location — `apps/webapp/src/components/` for components, `apps/webapp/src/utils/` for pure helpers
**Why**: Project convention. The two existing folders (`pages/`, `utils/`) split along "rendered UI" vs "pure logic". The six modules fall cleanly into that split:
- `format.ts` → `utils/` (pure function, no JSX).
- The other five (VirtualList, status-config, StatsCard, ImportContent, ExpandableGroupCard) → `components/`.

Note: `status-config.ts` is technically data, not a component, but its consumers are exclusively Mantine components and it travels with the same `Badge`-aware semantics as a component would. Putting it next to its primary consumers (Badge-rendering pages) keeps imports short (`../components/status-config`).

**Alternative considered**: Split into more granular folders (`components/virtual/`, `components/cards/`, etc.). Rejected — premature; the flat `components/` will hold six files, well within browseable range.

### D2: `VirtualList` API — extract the `useVirtualizer` plumbing, not the row rendering
**Why**: The original `ResolvedLineViewer` in `Files.tsx` mixed three concerns: virtual-scroll plumbing (the `useVirtualizer` + parent ref + load-more trigger), the header bar ("Resolved unique URLs · N/M"), and the per-row rendering (the `<Text>` with line numbers). Only the first concern is genuinely shared — Dedup and Filter have similar infinite-list needs with completely different row shapes.

The extracted `VirtualList` takes `renderItem: (item, index) => ReactNode` so each consumer keeps full control of its row. The header is also pluggable via a `header?: ReactNode` prop because Files/Dedup/Filter all need different headers but the same body mechanics.

**Alternative considered**: Extract a higher-order component that wraps the whole viewer. Rejected — the HOC's prop surface would be larger than the per-page inline code; consumers wouldn't save much.

### D3: `VirtualLine` as a separate export
**Why**: Three pages wanted line numbers in the same style (right-aligned, 60px wide, monospace, divider). Rather than have each `renderItem` re-implement the layout, `VirtualLine` provides the `<Box flex height=22 ...>` wrapper with optional line numbers. Pages that don't want line numbers can ignore it and render their own row.

**Alternative considered**: Bake line numbers into `VirtualList` itself via a `showLineNumbers` prop. Rejected — couples list mechanics to row layout; non-text-row consumers (e.g., action buttons in Filter) would have to fight it.

### D4: `LINK_STATUS_CONFIG` and `LINK_STATUS_OPTIONS` live together
**Why**: They're consumed together — every status `<Select>` filter uses `OPTIONS`, every status `<Badge>` uses `CONFIG`. Splitting them would force consumers to import from two paths. Keeping them in one `status-config.ts` module means a single source of truth for "what statuses exist and how to render them".

**Alternative considered**: Move into `lib/` since it's "data". Rejected — it's webapp-specific rendering data (Mantine color names), not domain data; it belongs with the layer that consumes it.

### D5: `StatsCard` is a separate component (not inlined into Home/Dedup)
**Why**: Home and Dedup both render 3-5 stat cards in a grid; before the refactor each had its own `<Card>` markup with the same label/value/skeleton layout. Extracting `StatsCard` makes the grid `map`-able and shrinks both pages by ~30 lines each.

The `loading` prop drives a `<Skeleton>` placeholder so consumers don't have to conditionally render the value themselves.

**Alternative considered**: Keep inline, just deduplicate by importing. Rejected — the goal is one canonical implementation, not zero-cost shared markup.

### D6: `ImportContent` exposes a hook (`useImportInput`) plus a render component
**Why**: Import.tsx and Home.tsx both had copy-pasted logic for "pick file → read content → preview → handle clipboard paste → clear". The logic and the rendering are tightly coupled (the file input ref, the error alert, the preview Code block), but Home only needs the *logic* (it renders its own custom trigger), while Import needs both.

The split: `useImportInput()` returns the state + handlers; `<ImportContent />` renders the standard file input + clipboard button + preview and uses the hook internally. Home uses just the hook; Import uses the component.

**Alternative considered**: Single component with all rendering baked in. Rejected — Home's import trigger is an `<UnstyledButton>` styled completely differently; forcing it through the standard component would require so many `renderTrigger` props that the abstraction would cost more than it saves.

### D7: `ExpandableGroupCard` — leave styling knobs as props, not variants
**Why**: Dedup and Links both render grouped views where each group is a card with an expand/collapse header, optional select checkbox, and child rows. The two pages wanted slightly different background tints for expanded vs selected states (e.g., Dedup highlights selected with blue, Links with gray).

Rather than encode "variant=dedup | links", the component takes `expandedBg`, `selectedBg`, `defaultBg` props. Consumers pass the color they want; the component doesn't have to know about page identity.

**Alternative considered**: Theme-based variants. Rejected — over-engineered for two consumers; raw color props are simpler and match Mantine conventions.

### D8: Spec deltas limited to cross-page consistency guarantees
**Why**: This change does not add or modify any user-facing feature, but it does establish two properties that the inline drift had been silently violating:
- The same link status renders with the same label + color on every page.
- The same byte count formats to the same display on every page.

These are real behavioral guarantees (a user can rely on them), not implementation details, so they earn spec scenarios under `files-browser`. The rest of the refactor (virtualized list extraction, expandable card extraction, import-content hook) is pure implementation detail — those modules could be re-inlined tomorrow without changing any user-visible behavior, so they don't get spec scenarios.

**What's NOT in the spec**:
- "Pages SHALL import shared components from `components/`" — implementation detail; a future refactor that re-inlines wouldn't change behavior.
- "Status config SHALL live in `status-config.ts`" — same reason; filesystem layout is not a behavioral guarantee.

**Alternative considered**: Pure no-spec refactor (placeholder `specs/NO-SPEC-IMPACT.md`). Rejected — the OpenSpec schema rejects changes with zero deltas, and the cross-page consistency scenarios are genuine behavioral properties worth pinning down.

## Risks / Trade-offs

**[R1] Subtle visual regressions from prop defaulting**: The extracted components have to pick defaults (e.g., `VirtualList`'s `rowHeight=22`, `overscan=10`, `loadMoreThreshold=20`). If any page's inline copy used a different value that we accidentally normalized, we'd silently change its behavior.
→ Mitigation: Verified each `useVirtualizer` call site had the same `estimateSize`/`overscan` values before extracting; the `loadMoreThreshold=20` default matches the magic `20` that appeared in every infinite-scroll implementation. Manual smoke-test of every affected page.

**[R2] Cycle risk if a component under `pages/` is later needed inside `components/`**: A future refactor might want e.g. `<ImportContent />` to render a status badge, requiring `status-config.ts` from inside `ImportContent.tsx` — fine, they're siblings. But if a shared component ever needs page-specific logic, the layering breaks.
→ Mitigation: Convention only — `components/` may depend on `utils/` and external libs but never on `pages/`. Documented in the proposal's "Not affected" section.

**[R3] Status-config drift between this change and future DB-side status additions**: If the service adds a new link status (e.g., `redirect_loop`), `status-config.ts` needs updating in lockstep, but the DB schema change happens in a separate change doc. There's a window where the new status renders as a gray "unknown" badge.
→ Mitigation: Pre-existing risk (was already true when the config lived inside `Links.tsx`); not worsened by this refactor. Documented here as a known issue, not a new one.

**[R4] `useImportInput`'s ref-typed return exposes React internals**: Returning `resetRef: React.MutableRefObject<(() => void) | null>` from a hook leaks the ref abstraction. Consumers have to call `resetRef.current?.()` instead of a clean `reset()`.
→ Mitigation: The hook also returns a clean `reset()` method; the ref is only needed for Mantine `<FileInput>`'s imperative-clear API. Acceptable trade-off; documented in the hook's JSDoc.

## Migration Plan

No DB migration. No service changes. No spec changes.

Deployment is a single frontend deploy — the new components ship in the same bundle as the refactored pages; there's no version-skew risk because nothing crosses a process boundary.

Rollback: revert the commit. The eight pages go back to their inline copies; the new `components/` files become dead code but harmless (tree-shaken out of the production bundle since nothing imports them).

## Open Questions

None. All six modules were implemented in a single sitting and visually smoke-tested against the originals.
