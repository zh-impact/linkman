import { v4 as uuidv4 } from 'uuid'
import { getAllLinks, insertOperation } from '../db/queries'
import { generateSnapshotHash, maybeCreateSnapshot } from './snapshots'

export interface ChangeRecord {
  added: string[]
  removed: string[]
  modified: Array<{
    id: string
    changes: Record<string, { before: unknown; after: unknown }>
  }>
}

export interface OperationStats {
  inputCount: number
  outputCount: number
  duplicateCount?: number
  errorCount: number
}

export interface LogOperationOptions {
  type:
    | 'import'
    | 'deduplicate'
    | 'filter_internal'
    | 'filter_similar'
    | 'test_dns'
    | 'test_head'
    | 'test_get'
    | 'manual_tag'
    | 'manual_delete'
    | 'rollback'
  jobId?: string
  changes: ChangeRecord
  stats: OperationStats
  errors?: Array<{ message: string; linkId?: string }>
  warnings?: Array<{ message: string; linkId?: string }>
}

/**
 * Capture the current state before an operation runs.
 * Returns a snapshot hash that should be passed to `logOperation` after the operation.
 */
export async function captureBeforeState() {
  return {
    snapshotHash: await generateSnapshotHash(),
    linksBefore: await getAllLinks(),
  }
}

/**
 * Diff two link snapshots to produce a ChangeRecord.
 * Compares links before and after an operation to find added, removed, and modified.
 */
export function diffLinks(
  linksBefore: Array<{ id: string; [key: string]: unknown }>,
  linksAfter: Array<{ id: string; [key: string]: unknown }>,
): ChangeRecord {
  const beforeMap = new Map(linksBefore.map((l) => [l.id, l]))
  const afterMap = new Map(linksAfter.map((l) => [l.id, l]))

  const added: string[] = []
  const removed: string[] = []
  const modified: ChangeRecord['modified'] = []

  // Find added and modified
  for (const [id, after] of afterMap) {
    const before = beforeMap.get(id)
    if (!before) {
      added.push(id)
      continue
    }

    // Check for field-level changes
    const changes: Record<string, { before: unknown; after: unknown }> = {}
    const keys = new Set([...Object.keys(before), ...Object.keys(after)])
    for (const key of keys) {
      if (key === 'updatedAt') continue // skip timestamp noise
      const bVal = JSON.stringify(before[key])
      const aVal = JSON.stringify(after[key])
      if (bVal !== aVal) {
        changes[key] = { before: before[key], after: after[key] }
      }
    }

    if (Object.keys(changes).length > 0) {
      modified.push({ id, changes })
    }
  }

  // Find removed
  for (const id of beforeMap.keys()) {
    if (!afterMap.has(id)) {
      removed.push(id)
    }
  }

  return { added, removed, modified }
}

/**
 * Log an operation after it has completed.
 * Creates an Operation record in the database and optionally creates a full snapshot.
 */
export async function logOperation(
  opts: LogOperationOptions,
  beforeSnapshotHash: string,
): Promise<string> {
  const afterSnapshot = await generateSnapshotHash()

  const operationId = uuidv4()

  await insertOperation({
    id: operationId,
    type: opts.type,
    jobId: opts.jobId ?? null,
    beforeSnapshotHash: beforeSnapshotHash,
    afterSnapshotHash: afterSnapshot.hash,
    changesAdded: JSON.stringify(opts.changes.added),
    changesRemoved: JSON.stringify(opts.changes.removed),
    changesModified: JSON.stringify(opts.changes.modified),
    statsInputCount: opts.stats.inputCount,
    statsOutputCount: opts.stats.outputCount,
    statsDuplicateCount: opts.stats.duplicateCount ?? null,
    statsErrorCount: opts.stats.errorCount,
    errors: JSON.stringify(opts.errors ?? []),
    warnings: JSON.stringify(opts.warnings ?? []),
  })

  // Check if we should create a full snapshot
  await maybeCreateSnapshot()

  return operationId
}

/**
 * Convenience: wrap an operation with automatic before/after capture and logging.
 */
export async function withOperationLog<T>(
  type: LogOperationOptions['type'],
  jobId: string | undefined,
  fn: () => Promise<T>,
): Promise<{ result: T; operationId: string }> {
  const before = await captureBeforeState()

  const result = await fn()

  const linksAfter = await getAllLinks()
  const changes = diffLinks(
    before.linksBefore as Array<{ id: string; [key: string]: unknown }>,
    linksAfter as Array<{ id: string; [key: string]: unknown }>,
  )

  const stats: OperationStats = {
    inputCount: before.linksBefore.length,
    outputCount: linksAfter.length,
    errorCount: 0,
  }

  const operationId = await logOperation({ type, jobId, changes, stats }, before.snapshotHash.hash)

  return { result, operationId }
}
