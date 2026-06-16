import { isValidUrl, type Link, parseTitleUrlDash, splitLines } from '../../url/extract'
import type { Extractor } from './types'

/**
 * `Title - URL` dash-separated exports. Detection requires the dash to be
 * followed by a valid URL on at least one of the first 10 lines — otherwise
 * a URL-only file containing hyphens would be misdetected.
 */
export const dashExtractor: Extractor = {
  format: 'dash',
  detect: (ctx) => {
    if (ctx.type !== 'TXT') return false
    return ctx.firstLines.some((line) => {
      const idx = line.lastIndexOf(' - ')
      return idx !== -1 && isValidUrl(line.slice(idx + 3).trim())
    })
  },
  extract: (content: string): Link[] =>
    splitLines(content)
      .map(parseTitleUrlDash)
      .filter((link): link is Link => link !== null),
}
