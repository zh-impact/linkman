import { groupByDomain } from './domain'
import { similarityRatio } from './edit-distance'
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

/**
 * Run layered similarity detection on a set of links.
 * Links grouped at an earlier layer are not re-evaluated by later layers.
 */
export function detectSimilarity(links: LinkLike[], layers: SimilarityLayer[]): SimilarityGroup[] {
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
        const ids = remaining.map((l) => l.id)
        const urls = remaining.map((l) => l.normalizedUrl)
        const assigned = new Set<number>()

        let gid = 0
        for (let i = 0; i < urls.length; i++) {
          if (assigned.has(i)) continue
          const group: string[] = [ids[i]]
          assigned.add(i)

          for (let j = i + 1; j < urls.length; j++) {
            if (assigned.has(j)) continue
            if (similarityRatio(urls[i], urls[j]) >= threshold) {
              group.push(ids[j])
              assigned.add(j)
            }
          }

          if (group.length >= 2) {
            layerGroups.push({
              groupKey: `edit_distance_${ids[gid++]}`,
              method: 'edit_distance',
              linkIds: group,
            })
          }
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
