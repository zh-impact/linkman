/**
 * Group links by domain (hostname).
 * Returns a map of groupKey -> array of link IDs.
 */
export function groupByDomain(
  links: Array<{ id: string; domain: string }>,
): Map<string, string[]> {
  const groups = new Map<string, string[]>()

  for (const link of links) {
    const key = link.domain
    const existing = groups.get(key)
    if (existing) {
      existing.push(link.id)
    } else {
      groups.set(key, [link.id])
    }
  }

  // Remove groups with only one link (no similarity)
  for (const [key, ids] of groups) {
    if (ids.length < 2) {
      groups.delete(key)
    }
  }

  return groups
}
