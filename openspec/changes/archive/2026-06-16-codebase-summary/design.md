## Context

LinkMan is a monorepo link management tool (pnpm workspaces) comprising `apps/service` (Fastify + tRPC + drizzle-orm + libsql/SQLite) and `apps/webapp` (React + Mantine v9 + Vite). It currently implements a complete import → dedup → filter → test → history rollback pipeline. This design document records the existing system architecture without any code changes.

## Goals / Non-Goals

**Goals:**
- Systematically document functional specifications for 7 capability domains as a codebase functional baseline
- Provide referenceable requirement documents for future feature changes

**Non-Goals:**
- Do not modify any runtime code
- Do not introduce new features or refactoring
- Do not cover implementation details (e.g., specific SQL queries, component props)

## Decisions

**Split spec files by capability domain**: Each capability domain has its own spec file, corresponding to the tRPC router structure (import, deduplicate, filter, test, operations, stats, files). Rationale: clear boundaries, future changes only need to update the corresponding file.

**Spec granularity focuses on behavioral contracts**: Specs describe WHAT (inputs/outputs/state transitions), not HOW (specific algorithm implementations). For example, the edit_distance sliding-window optimization is an implementation detail; the spec only describes "progressive result delivery."

## Risks / Trade-offs

- [Spec-code drift] → Specs are manually maintained snapshots; they must be updated when code changes
- [Potential coverage gaps] → Edge cases (e.g., concurrent imports, error recovery) may not be fully covered
