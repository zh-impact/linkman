import { type Link, parseJsonArray } from '../../url/extract'
import type { Extractor } from './types'

/**
 * Flat JSON array of URL strings or `{ url, title? }` objects. The JSON
 * fallback: detection always returns true so the registry picks this when
 * the tablerone extractor does not match. Must be registered LAST in the
 * JSON branch.
 */
export const jsonArrayExtractor: Extractor = {
  format: 'json_array',
  detect: (ctx) => ctx.type === 'JSON',
  extract: (content: string): Link[] => parseJsonArray(content),
}
