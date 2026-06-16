import { type Link, parseCsvContent } from '../../url/extract'
import type { Extractor } from './types'

/**
 * Chrome history CSV export. Detected purely by filename extension; CSV is
 * structurally ambiguous from content alone (many text formats use commas).
 */
export const csvExtractor: Extractor = {
  format: 'csv',
  detect: (ctx) => ctx.type === 'TXT' && ctx.extension === '.csv',
  extract: (content: string): Link[] => parseCsvContent(content),
}
