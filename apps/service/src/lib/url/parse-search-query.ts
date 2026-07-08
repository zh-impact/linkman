/**
 * Parser for advanced search syntax (`host:foo path:bar baz`).
 *
 * Shared conceptually with `apps/webapp/src/utils/parse-search-query.ts` —
 * the two MUST stay in sync. Each app has its own copy because the project
 * does not have a shared module between service and webapp.
 *
 * Grammar (see design D6):
 *   query        := term (' ' term)*
 *   term         := prefixed | bare
 *   prefixed     := prefix ':' value       (prefix case-insensitive)
 *   prefix       := 'host' | 'path' | 'search' | 'hash'
 *   bare         := any token without a recognized prefix
 *
 * Semantics:
 *   - Multiple prefixed terms with DIFFERENT prefixes AND together.
 *   - Multiple prefixed terms with the SAME prefix OR together.
 *   - Bare terms are matched against the UI-selected parts (default all).
 *   - Empty value after the colon (e.g. `host:` mid-typing) is treated as
 *     bare text, so the UI does not flicker the checkbox mid-keystroke.
 *   - Unrecognized prefixes (`foo:bar`) are treated as bare (whole token).
 */

export const PREFIXES = ['host', 'path', 'search', 'hash'] as const
export type Prefix = (typeof PREFIXES)[number]

export interface ParsedSearchQuery {
  /** Map of prefix -> list of values. Same-prefix values OR together. */
  prefixed: Partial<Record<Prefix, string[]>>
  /** Bare terms (no recognized prefix). Matched against UI-selected parts. */
  bare: string[]
}

const PREFIX_RE = /^(host|path|search|hash):(.*)$/i

/**
 * Parse a search query string into structured form. Pure function, no IO.
 * Whitespace-only tokens are dropped. Empty input → `{ prefixed: {}, bare: [] }`.
 */
export function parseSearchQuery(raw: string): ParsedSearchQuery {
  const result: ParsedSearchQuery = { prefixed: {}, bare: [] }
  if (!raw) return result

  const tokens = raw.split(/\s+/).filter((t) => t.length > 0)
  for (const token of tokens) {
    const match = PREFIX_RE.exec(token)
    if (match && match[2].length > 0) {
      // Recognized prefix with non-empty value → prefixed term.
      const prefix = match[1].toLowerCase() as Prefix
      const value = match[2]
      const existing = result.prefixed[prefix]
      if (existing) existing.push(value)
      else result.prefixed[prefix] = [value]
    } else {
      // Bare term (includes `host:` with empty value and `foo:bar`).
      result.bare.push(token)
    }
  }
  return result
}

/**
 * Rebuild the canonical string form of a parsed query. Used by the UI when
 * checkboxes toggle (the UI rewrites the search box). Order: prefixed terms
 * first (in PREFIXES order), then bare terms. Round-trips with `parseSearchQuery`
 * for canonical inputs (whitespace-separated).
 */
export function stringifySearchQuery(parsed: ParsedSearchQuery): string {
  const parts: string[] = []
  for (const prefix of PREFIXES) {
    const values = parsed.prefixed[prefix]
    if (values) {
      for (const value of values) parts.push(`${prefix}:${value}`)
    }
  }
  for (const bare of parsed.bare) parts.push(bare)
  return parts.join(' ')
}
