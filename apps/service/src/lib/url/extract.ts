/**
 * Link extraction from various bookmark export formats.
 *
 * Supported formats:
 * - Pipe format: "URL | Title"
 * - Dash format: "Title - URL"
 * - URL-only: One URL per line
 * - OneTab INI: "URL * Title" with [Group] sections
 * - CSV: Browser history exports (NavigatedToUrl, PageTitle)
 * - Tablerone JSON: Chrome extension export ({ export: [{ tabs: [{ url, title }] }] })
 * - JSON array: flat array of URL strings or { url, title? } objects
 * - Netscape Bookmark HTML: browser "Export Bookmarks…" output
 *
 * Format detection + dispatch lives in `lib/import/extractors/` (the
 * pluggable registry). This module exposes the line- and content-level
 * parsers that the registry's extractor modules wrap.
 */

export interface Link {
  url: string
  title: string
  source?: string
}

export type LinkFormat =
  | 'csv'
  | 'pipe'
  | 'dash'
  | 'onetab_ini'
  | 'tablerone_json'
  | 'url_only'
  | 'json_array'
  | 'bookmarks_html'

export function splitLines(content: string): string[] {
  return content.split(/\r?\n/)
}

export function isValidUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://')
}

// --- Line-level parsers ---

export function extractUrlTitlePipe(line: string): Link | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  const idx = trimmed.indexOf(' | ')
  if (idx === -1) return null

  const url = trimmed.slice(0, idx).trim()
  const title = trimmed.slice(idx + 3).trim()

  if (!url || !isValidUrl(url)) return null

  return { url, title }
}

export function extractUrlOnly(line: string): Link | null {
  const trimmed = line.trim()
  if (!trimmed || !isValidUrl(trimmed)) return null
  return { url: trimmed, title: '' }
}

export function parseTitleUrlDash(line: string): Link | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  const idx = trimmed.lastIndexOf(' - ')
  if (idx !== -1) {
    const title = trimmed.slice(0, idx).trim()
    const url = trimmed.slice(idx + 3).trim()
    if (!isValidUrl(url)) return null
    return { url, title }
  }

  if (isValidUrl(trimmed)) {
    return { url: trimmed, title: '' }
  }

  return null
}

// --- Multi-line parsers ---

export function parseOnetabIni(content: string): Link[] {
  const links: Link[] = []

  for (const line of splitLines(content)) {
    const trimmed = line.trim()

    // Skip section headers like [Group1]
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) continue

    let url: string
    let title: string

    const starIdx = trimmed.indexOf(' * ')
    if (starIdx !== -1) {
      url = trimmed.slice(0, starIdx).trim()
      title = trimmed.slice(starIdx + 3).trim()
    } else if (trimmed.endsWith(' *')) {
      url = trimmed.slice(0, -2).trim()
      title = ''
    } else {
      continue
    }

    if (!title) title = ''
    if (url && isValidUrl(url)) {
      links.push({ url, title })
    }
  }

  return links
}

function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += char
    }
  }
  result.push(current)
  return result
}

export function parseCsvContent(content: string): Link[] {
  const lines = splitLines(content)
  if (lines.length < 2) return []

  const headers = parseCsvLine(lines[0])
  const urlIdx = headers.indexOf('NavigatedToUrl')
  const titleIdx = headers.indexOf('PageTitle')

  if (urlIdx === -1) return []

  const links: Link[] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const values = parseCsvLine(line)
    const url = (values[urlIdx] ?? '').trim()
    const title = titleIdx >= 0 ? (values[titleIdx] ?? '').trim() : ''

    if (url && isValidUrl(url)) {
      links.push({ url, title })
    }
  }

  return links
}

// --- JSON parsers ---

export function parseTableroneJson(content: string): Link[] {
  let data: unknown
  try {
    data = JSON.parse(content)
  } catch {
    return []
  }

  if (!data || typeof data !== 'object' || !('export' in data)) return []

  const groups = (data as { export: unknown[] }).export
  if (!Array.isArray(groups)) return []

  const links: Link[] = []
  for (const group of groups) {
    if (!group || typeof group !== 'object' || !('tabs' in group)) continue
    const tabs = (group as { tabs: unknown[] }).tabs
    if (!Array.isArray(tabs)) continue

    for (const tab of tabs) {
      if (!tab || typeof tab !== 'object') continue
      const { url, title } = tab as { url?: string; title?: string }
      if (url && isValidUrl(url)) {
        links.push({ url, title: title ?? '' })
      }
    }
  }

  return links
}

/**
 * Parse a flat JSON array of URL strings or `{ url, title? }` objects.
 * Order-preserving — the i-th emitted Link corresponds to the i-th array element.
 */
export function parseJsonArray(content: string): Link[] {
  let data: unknown
  try {
    data = JSON.parse(content)
  } catch {
    return []
  }

  if (!Array.isArray(data)) return []

  const links: Link[] = []
  for (const item of data) {
    let url: string | undefined
    let title = ''

    if (typeof item === 'string') {
      url = item
    } else if (item && typeof item === 'object' && 'url' in item) {
      const obj = item as { url?: unknown; title?: unknown }
      if (typeof obj.url === 'string') url = obj.url
      if (typeof obj.title === 'string') title = obj.title
    }

    if (url && isValidUrl(url)) {
      links.push({ url, title })
    }
  }

  return links
}

// --- Netscape Bookmark HTML ---

const NAMED_HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
}

/**
 * Decode the subset of HTML entities that appear in browser bookmark titles.
 * Named: the common five plus `&nbsp;`. Numeric: decimal `&#DDDD;` and hex
 * `&#xHHHH;`. Codepoints above U+10FFFF are left as literal text so a
 * malformed entity cannot produce garbage. No external dependency.
 */
export function decodeHtmlEntities(s: string): string {
  return s.replace(/&(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);/g, (entity) => {
    if (entity.startsWith('&#x') || entity.startsWith('&#X')) {
      const code = parseInt(entity.slice(3, -1), 16)
      return code > 0x10ffff ? entity : String.fromCodePoint(code)
    }
    if (entity.startsWith('&#')) {
      const code = Number(entity.slice(2, -1))
      return code > 0x10ffff ? entity : String.fromCodePoint(code)
    }
    const name = entity.slice(1, -1)
    return NAMED_HTML_ENTITIES[name] ?? entity
  })
}

const BOOKMARK_ANCHOR_RE = /<A\s+HREF="([^"]+)"[^>]*>([^<]*)<\/A>/gi

/**
 * Parse Netscape Bookmark File Format HTML emitted by Chrome / Firefox /
 * Edge / Safari "Export Bookmarks…". Iterates `<A HREF="url" …>Title</A>`
 * anchors case-insensitively, decodes entities in titles, and emits one
 * `Link` per anchor whose URL is well-formed. Order matches source order
 * (regex iteration is left-to-right).
 */
export function parseBookmarksHtml(content: string): Link[] {
  const links: Link[] = []
  for (const match of content.matchAll(BOOKMARK_ANCHOR_RE)) {
    const url = match[1] ?? ''
    const rawTitle = match[2] ?? ''
    if (isValidUrl(url)) {
      links.push({ url, title: decodeHtmlEntities(rawTitle) })
    }
  }
  return links
}
