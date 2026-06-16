import { type Link, parseOnetabIni } from '../../url/extract'
import type { Extractor } from './types'

/**
 * OneTab INI: `[Group]` section headers interleaved with `URL * Title` rows.
 * Requires BOTH signals to avoid matching plain `[...]` config files.
 */
export const onetabIniExtractor: Extractor = {
  format: 'onetab_ini',
  detect: (ctx) => {
    if (ctx.type !== 'TXT') return false
    let hasSection = false
    let hasStar = false
    for (const line of ctx.firstLines) {
      const t = line.trim()
      if (t.startsWith('[') && t.endsWith(']')) hasSection = true
      if (t.includes(' * ')) hasStar = true
      if (hasSection && hasStar) return true
    }
    return false
  },
  extract: (content: string): Link[] => parseOnetabIni(content),
}
