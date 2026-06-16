import { extractUrlOnly, type Link, splitLines } from '../../url/extract'
import type { Extractor } from './types'

/**
 * Plain list of URLs (one per line). The TXT fallback: detection always
 * returns true so the registry picks this when no more specific TXT format
 * matches. Must be registered LAST in the TXT branch.
 */
export const urlOnlyExtractor: Extractor = {
  format: 'url_only',
  detect: (ctx) => ctx.type === 'TXT',
  extract: (content: string): Link[] =>
    splitLines(content)
      .map(extractUrlOnly)
      .filter((link): link is Link => link !== null),
}
