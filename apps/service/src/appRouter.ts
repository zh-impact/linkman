import { z } from 'zod'
import { publicProcedure, router } from './trpc'

type User = { id: string; name: string }

export const appRouter = router({
  userList: publicProcedure.query(async () => {
    const users: User[] = [{ id: '1', name: 'Katt' }]
    return users
  }),
  userById: publicProcedure.input(z.string()).query(async (opts) => {
    const { input } = opts
    const user: User = { id: input, name: 'Katt' }
    return user
  }),
  userCreate: publicProcedure.input(z.object({ name: z.string() })).mutation(async (opts) => {
    const { input } = opts
    const user: User = { id: '1', ...input }
    return user
  }),
})

export type AppRouter = typeof appRouter
