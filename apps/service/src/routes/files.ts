import { z } from 'zod'
import { getAllLinks } from '../lib/db/queries'
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

  resolved: publicProcedure.query(async () => {
    const allLinks = (await getAllLinks()).filter(
      (l) =>
        l.status !== 'duplicate_removed' &&
        l.status !== 'filtered_internal' &&
        l.status !== 'filtered_similar',
    )
    const seen = new Set<string>()
    const urls: string[] = []
    for (const link of allLinks) {
      if (!seen.has(link.originalUrl)) {
        seen.add(link.originalUrl)
        urls.push(link.originalUrl)
      }
    }
    return { total: urls.length, urls }
  }),
})
