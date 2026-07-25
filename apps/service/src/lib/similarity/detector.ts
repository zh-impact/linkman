import { groupByDomain } from './domain'
import { isSimilarEnough } from './edit-distance'
import { groupByPathPrefix } from './path-prefix'

export interface SimilarityLayer {
  method: 'domain' | 'path_prefix' | 'edit_distance'
  /** For path_prefix: depth of path segments (default 2) */
  pathDepth?: number
  /** For edit_distance: similarity threshold 0-1 (default 0.8) */
  threshold?: number
}

export interface SimilarityGroup {
  groupKey: string
  method: string
  linkIds: string[]
}

type LinkLike = { id: string; normalizedUrl: string; domain: string }

/** Yield to the event loop so other requests are not blocked. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

/**
 * Run edit-distance similarity detection within a single domain's links.
 * Sorts URLs first, then uses a sliding window so each URL is only compared
 * with its neighbours — O(n×W) instead of O(n²).
 */
export async function detectEditDistanceInDomain(
  domainLinks: LinkLike[],
  threshold: number,
): Promise<SimilarityGroup[]> {
  if (domainLinks.length < 2) return []

  // Sort by normalizedUrl so similar URLs cluster together
  const sorted = [...domainLinks].sort((a, b) => a.normalizedUrl.localeCompare(b.normalizedUrl))

  // Window size: larger window catches more pairs but costs more.
  // Cap at 200 — URLs with ≥80% similarity will be within this range when sorted.
  const window = Math.min(sorted.length, 200)

  const assigned = new Set<number>()
  const groups: SimilarityGroup[] = []
  let comparisonCount = 0

  for (let i = 0; i < sorted.length; i++) {
    if (assigned.has(i)) continue
    const group: string[] = [sorted[i].id]
    assigned.add(i)

    const end = Math.min(i + window, sorted.length)
    for (let j = i + 1; j < end; j++) {
      if (assigned.has(j)) continue

      if (isSimilarEnough(sorted[i].normalizedUrl, sorted[j].normalizedUrl, threshold)) {
        group.push(sorted[j].id)
        assigned.add(j)
      }

      comparisonCount++
      if (comparisonCount % 5000 === 0) {
        await yieldToEventLoop()
      }
    }

    if (group.length >= 2) {
      groups.push({
        groupKey: `edit_distance_${sorted[i].id}`,
        method: 'edit_distance',
        linkIds: group,
      })
    }
  }

  return groups
}

/**
 * Build domain buckets for edit-distance pagination.
 * Returns domains sorted by size ascending (small domains first for quick initial response).
 */
export function buildDomainBuckets(links: LinkLike[]): Array<{ domain: string; links: LinkLike[] }> {
  const domainMap = new Map<string, LinkLike[]>()
  for (const link of links) {
    const bucket = domainMap.get(link.domain)
    if (bucket) bucket.push(link)
    else domainMap.set(link.domain, [link])
  }

  return [...domainMap.entries()]
    .map(([domain, domainLinks]) => ({ domain, links: domainLinks }))
    .filter((entry) => entry.links.length >= 2)
    .sort((a, b) => a.links.length - b.links.length)
}

/**
 * Run layered similarity detection on a set of links.
 * Links grouped at an earlier layer are not re-evaluated by later layers.
 */
export async function detectSimilarity(
  links: LinkLike[],
  layers: SimilarityLayer[],
): Promise<SimilarityGroup[]> {
  const allGroups: SimilarityGroup[] = []
  const processedIds = new Set<string>()

  for (const layer of layers) {
    const remaining = links.filter((l) => !processedIds.has(l.id))
    if (remaining.length < 2) break

    const layerGroups: SimilarityGroup[] = []

    switch (layer.method) {
      case 'domain': {
        const domainGroups = groupByDomain(remaining)
        for (const [domain, ids] of domainGroups) {
          layerGroups.push({ groupKey: domain, method: 'domain', linkIds: ids })
        }
        break
      }
      case 'path_prefix': {
        const prefixGroups = groupByPathPrefix(remaining, layer.pathDepth ?? 2)
        for (const [prefix, ids] of prefixGroups) {
          layerGroups.push({ groupKey: prefix, method: 'path_prefix', linkIds: ids })
        }
        break
      }
      case 'edit_distance': {
        const threshold = layer.threshold ?? 0.8
        const domainBuckets = buildDomainBuckets(remaining)

        for (const bucket of domainBuckets) {
          const domainGroups = await detectEditDistanceInDomain(bucket.links, threshold)
          layerGroups.push(...domainGroups)
        }
        break
      }
    }

    // Mark grouped links as processed
    for (const group of layerGroups) {
      for (const id of group.linkIds) {
        processedIds.add(id)
      }
    }

    allGroups.push(...layerGroups)
  }

  return allGroups
}
