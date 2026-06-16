import { type Link, parseTableroneJson } from '../../url/extract'
import type { Extractor } from './types'

/**
 * Tablerone Chrome extension export: `{ export: [{ tabs: [{ url, title }] }] }`.
 * Detected when the JSON content parses to an object with an `export` array.
 * Must be checked BEFORE the json_array fallback.
 */
export const tableroneExtractor: Extractor = {
  format: 'tablerone_json',
  detect: (ctx) => {
    if (ctx.type !== 'JSON') return false
    const trimmed = ctx.content.trim()
    if (!trimmed.startsWith('{')) return false
    try {
      const data = JSON.parse(trimmed)
      return !!data && typeof data === 'object' && 'export' in data && Array.isArray(data.export)
    } catch {
      return false
    }
  },
  extract: (content: string): Link[] => parseTableroneJson(content),
}
