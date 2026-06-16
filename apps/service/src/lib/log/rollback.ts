import { eq, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { getAllLinks, getOperationById, getOperations } from '../db/queries'
import { linksTable, operations } from '../db/schema'
import { diffLinks, logOperation, type OperationStats } from './operations'

/**
 * Rollback all link states to what they were at the time of a given operation.
 *
 * Algorithm:
 *   1. Find target operation
 *   2. Undo changes from all operations after target (reverse chronological)
 *   3. Truncate operations after target
 *   4. Log rollback as a new operation
 */
export async function rollbackToOperation(targetOperationId: string): Promise<{
  success: boolean
  operationId?: string
  error?: string
  restoredCount?: number
}> {
  const targetOp = await getOperationById(targetOperationId)
  if (!targetOp) {
    return { success: false, error: 'Target operation not found' }
  }

  const linksBefore = (await getAllLinks()) as Array<{ id: string; [key: string]: unknown }>

  // Collect the complete set of changes to undo.
  const allOps = await getOperations(10000, 0) // all ops, newest first
  const opsToUndo = allOps.filter((op) => op.timestamp > targetOp.timestamp)

  if (opsToUndo.length === 0) {
    return { success: false, error: 'No operations to undo (target is the latest)' }
  }

  // Undo in reverse chronological order (newest first)
  for (const op of opsToUndo) {
    const added: string[] = JSON.parse(op.changesAdded)
    const modified: Array<{
      id: string
      changes: Record<string, { before: unknown; after: unknown }>
    }> = JSON.parse(op.changesModified)

    // Undo additions: delete links that were added
    for (const linkId of added) {
      await db.delete(linksTable).where(eq(linksTable.id, linkId)).run()
    }

    // Undo modifications: restore "before" values
    for (const mod of modified) {
      const updates: Record<string, unknown> = {}
      for (const [field, { before }] of Object.entries(mod.changes)) {
        updates[field] = before
      }
      if (Object.keys(updates).length > 0) {
        await db.update(linksTable).set(updates).where(eq(linksTable.id, mod.id)).run()
      }
    }

    // Note: removals can't be fully restored without stored row data.
    // In this system, "removals" are typically status changes tracked as modifications.
  }

  // Truncate operation history: remove all operations after target
  await db.delete(operations).where(sql`${operations.timestamp} > ${targetOp.timestamp}`).run()

  const linksAfter = (await getAllLinks()) as Array<{ id: string; [key: string]: unknown }>
  const changes = diffLinks(linksBefore, linksAfter)

  const stats: OperationStats = {
    inputCount: linksBefore.length,
    outputCount: linksAfter.length,
    errorCount: 0,
  }

  // Log the rollback itself as an operation
  const rollbackOpId = await logOperation(
    {
      type: 'rollback',
      changes,
      stats,
    },
    '',
  )

  return {
    success: true,
    operationId: rollbackOpId,
    restoredCount: changes.modified.length + changes.added.length + changes.removed.length,
  }
}
