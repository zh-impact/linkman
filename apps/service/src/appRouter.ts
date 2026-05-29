import { importRouter } from './routes/import'
import { deduplicateRouter } from './routes/deduplicate'
import { filterRouter } from './routes/filter'
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
})

export type AppRouter = typeof appRouter
