# LinkMan

A link management tool for importing, deduplicating, filtering, and organizing bookmarks and URLs.

## Features

- **Import** — Import links from TXT, JSON, and various bookmark formats (OneTab, browser CSV, pipe/dash format)
- **Deduplicate** — Detect and remove duplicate links with configurable strategies (strict, normalized, smart)
- **Filter** — Filter internal/private IP links and similar links using domain grouping, path prefix, and edit distance detection
- **Links Browser** — Paginated table and grouped views with search, status filtering, bulk selection, batch tagging, batch delete, and export (CSV/JSON)
- **Operation History** — Full audit trail of all operations with rollback support
- **Dashboard** — Status overview with stats breakdown, recent operations, and quick actions

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Fastify + tRPC + Drizzle ORM |
| Frontend | React + Mantine + Vite |
| Database | libSQL (SQLite) |
| Monorepo | pnpm workspaces |

## Getting Started

### Prerequisites

- Node.js >= 20
- pnpm >= 9

### Install

```bash
pnpm install
```

### Development

Start backend and frontend in parallel:

```bash
# Backend (port 3003)
pnpm --filter service dev

# Frontend (port 5173)
pnpm --filter webapp dev
```

### Database

The SQLite database is auto-created at `file:data/linkman.db` on first run.

To inspect or manage the schema:

```bash
pnpm --filter service drizzle-kit
```

## Project Structure

```
linkman/
├── apps/
│   ├── service/          # Fastify + tRPC backend
│   │   └── src/
│   │       ├── routes/   # tRPC routers (links, import, stats, dedup, filter, operations)
│   │       ├── lib/      # Business logic (similarity, URL utils, operation logging)
│   │       └── server.ts
│   └── webapp/           # React + Mantine frontend
│       └── src/
│           ├── pages/    # Route pages (Home, Links, Import, Dedup, Filter, History)
│           ├── layout/   # Root layout with header navigation
│           └── utils/    # tRPC client, useConfirm hook
├── package.json
└── LICENSE               # AGPL-3.0-or-later
```

## License

[GNU Affero General Public License v3.0 or later](LICENSE)
