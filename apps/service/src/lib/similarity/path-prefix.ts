/**
 * Group links by common path prefix up to a configurable depth.
 * e.g. /a/b/c/d with depth 2 -> "/a/b"
 */
export function groupByPathPrefix(
  links: Array<{ id: string; normalizedUrl: string }>,
  depth = 2,
): Map<string, string[]> {
  const groups = new Map<string, string[]>()

  for (const link of links) {
    try {
      const url = new URL(link.normalizedUrl)
      const segments = url.pathname.split('/').filter(Boolean)
      const prefix = '/' + segments.slice(0, depth).join('/')
      const key = `${url.hostname}${prefix}`

      const existing = groups.get(key)
      if (existing) {
        existing.push(link.id)
      } else {
        groups.set(key, [link.id])
      }
    } catch {
      // Skip invalid URLs
    }
  }

  // Remove groups with only one link
  for (const [key, ids] of groups) {
    if (ids.length < 2) {
      groups.delete(key)
    }
  }

  return groups
}
