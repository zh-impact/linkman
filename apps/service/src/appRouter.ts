import { deduplicateRouter } from './routes/deduplicate'
import { filesRouter } from './routes/files'
import { filterRouter } from './routes/filter'
import { importRouter } from './routes/import'
import { linksRouter } from './routes/links'
import { operationsRouter } from './routes/operations'
import { statsRouter } from './routes/stats'
import { router } from './trpc'

export const appRouter = router({
  links: linksRouter,
  import: importRouter,
  stats: statsRouter,
  deduplicate: deduplicateRouter,
  filter: filterRouter,
  operations: operationsRouter,
  files: filesRouter,
})

export type AppRouter = typeof appRouter
