import { createHash } from 'node:crypto'
import { v4 as uuidv4 } from 'uuid'
import { getAllLinks, getLatestSnapshot, getOperations, insertSnapshot } from '../db/queries'

const SNAPSHOT_INTERVAL = 10

export interface SnapshotHash {
  hash: string
  linkStates: Record<string, string>
  timestamp: Date
}

/** Hash a single link row into a deterministic string. */
function hashLinkState(link: {
  id: string
  status: string | null
  tags: string | null
  isInternal: number | boolean | null
  duplicateOf: string | null
  similarityGroup: string | null
}): string {
  const data = `${link.id}|${link.status}|${link.tags}|${link.isInternal}|${link.duplicateOf}|${link.similarityGroup}`
  return createHash('md5').update(data).digest('hex')
}

/** Generate a snapshot hash from the current state of all links. */
export async function generateSnapshotHash(): Promise<SnapshotHash> {
  const links = await getAllLinks()
  const linkStates: Record<string, string> = {}

  for (const link of links) {
    linkStates[link.id] = hashLinkState(link)
  }

  const allHashes = Object.entries(linkStates)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, hash]) => `${id}:${hash}`)
    .join('|')

  const hash = createHash('sha256').update(allHashes).digest('hex')

  return { hash, linkStates, timestamp: new Date() }
}

/** Create a full snapshot record in the database. */
export async function createFullSnapshot(): Promise<string> {
  const links = await getAllLinks()
  const linkIds = links.map((l) => l.id)

  const allHashes = linkIds
    .sort()
    .map((id) => {
      const link = links.find((l) => l.id === id)!
      return `${id}:${hashLinkState(link)}`
    })
    .join('|')

  const checksum = createHash('sha256').update(allHashes).digest('hex')

  const snapshotId = uuidv4()
  await insertSnapshot({
    id: snapshotId,
    linkIds: JSON.stringify(linkIds),
    checksum,
  })

  return snapshotId
}

/** Check if a new full snapshot should be created based on the interval. */
export async function shouldCreateSnapshot(): Promise<boolean> {
  const latest = await getLatestSnapshot()
  if (!latest) return true

  const ops = await getOperations(SNAPSHOT_INTERVAL + 1, 0)
  if (ops.length === 0) return true

  // Count operations since the latest snapshot
  const snapshotTime = latest.createdAt
  const opsSinceSnapshot = ops.filter((op) => op.timestamp > snapshotTime)

  return opsSinceSnapshot.length >= SNAPSHOT_INTERVAL
}

/** Create a snapshot if the interval has been reached. */
export async function maybeCreateSnapshot(): Promise<string | null> {
  if (await shouldCreateSnapshot()) {
    return createFullSnapshot()
  }
  return null
}
