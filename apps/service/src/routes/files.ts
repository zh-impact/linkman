import { z } from 'zod'
import { getResolvedUrlCount, getResolvedUrls } from '../lib/db/queries'
import { deleteFile, listFiles, readFile, readFileLines } from '../lib/files'
import { publicProcedure, router } from '../trpc'

export const filesRouter = router({
  list: publicProcedure.query(async () => {
    return listFiles()
  }),

  getContent: publicProcedure.input(z.object({ filename: z.string() })).query(async ({ input }) => {
    const content = await readFile(input.filename)
    return { content }
  }),

  getLines: publicProcedure
    .input(
      z.object({
        filename: z.string(),
        startLine: z.number().min(0).default(0),
        count: z.number().min(1).max(500).default(200),
      }),
    )
    .query(async ({ input }) => {
      return readFileLines(input.filename, input.startLine, input.count)
    }),

  delete: publicProcedure.input(z.object({ filename: z.string() })).mutation(async ({ input }) => {
    await deleteFile(input.filename)
    return { success: true }
  }),

  resolved: publicProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(2000).default(500),
        offset: z.number().min(0).default(0),
      }),
    )
    .query(async ({ input }) => {
      const [total, rows] = await Promise.all([
        getResolvedUrlCount(),
        getResolvedUrls(input.limit, input.offset),
      ])
      return { total: total?.count ?? 0, urls: rows.map((r) => r.url) }
    }),
})
