import { z } from 'zod'
import { deleteAllOperations, deleteOperation, getOperationById, getOperations, getOperationsCount } from '../lib/db/queries'
import { rollbackToOperation } from '../lib/log'
import { publicProcedure, router } from '../trpc'

export const operationsRouter = router({
  list: publicProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(200).default(50),
        offset: z.number().min(0).default(0),
      }),
    )
    .query(async ({ input }) => {
      const [ops, countResult] = await Promise.all([
        getOperations(input.limit, input.offset),
        getOperationsCount(),
      ])
      return {
        operations: ops.map((op) => ({
          ...op,
          changesAdded: JSON.parse(op.changesAdded),
          changesRemoved: JSON.parse(op.changesRemoved),
          changesModified: JSON.parse(op.changesModified),
          errors: JSON.parse(op.errors),
          warnings: JSON.parse(op.warnings),
        })),
        total: countResult?.count ?? 0,
      }
    }),

  getById: publicProcedure.input(z.string()).query(async ({ input: id }) => {
    const op = await getOperationById(id)
    if (!op) return null
    return {
      ...op,
      changesAdded: JSON.parse(op.changesAdded),
      changesRemoved: JSON.parse(op.changesRemoved),
      changesModified: JSON.parse(op.changesModified),
      errors: JSON.parse(op.errors),
      warnings: JSON.parse(op.warnings),
    }
  }),

  rollback: publicProcedure.input(z.string()).mutation(async ({ input: operationId }) => {
    return rollbackToOperation(operationId)
  }),

  delete: publicProcedure.input(z.string()).mutation(async ({ input: id }) => {
    await deleteOperation(id)
    return { success: true }
  }),

  deleteAll: publicProcedure.mutation(async () => {
    await deleteAllOperations()
    return { success: true }
  }),
})
