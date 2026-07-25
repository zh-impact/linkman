import { type Link, parseBookmarksHtml } from '../../url/extract'
import type { Extractor } from './types'

/**
 * Netscape Bookmark File Format HTML exported by Chrome / Firefox / Edge /
 * Safari ("Export Bookmarks…"). Detected by the canonical DOCTYPE substring
 * OR a combination of `<DL>` and `<A HREF=` markers in the sniff window.
 * Must be registered BEFORE `url_only` so HTML files do not fall through
 * to plain-URL parsing and lose every title.
 */
export const bookmarksHtmlExtractor: Extractor = {
  format: 'bookmarks_html',
  detect: (ctx) => {
    if (ctx.type !== 'TXT') return false
    if (ctx.content.toLowerCase().includes('netscape-bookmark')) return true
    return ctx.firstLines.some((l) => /<DL>/i.test(l)) && ctx.firstLines.some((l) => /<A\s+HREF=/i.test(l))
  },
  extract: (content: string): Link[] => parseBookmarksHtml(content),
}
