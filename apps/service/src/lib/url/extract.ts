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
 */

export interface Link {
  url: string
  title: string
  source?: string
}

export type LinkFormat = 'csv' | 'pipe' | 'dash' | 'onetab_ini' | 'tablerone_json' | 'url_only'

export function splitLines(content: string): string[] {
  return content.split(/\r?\n/)
}

function isValidUrl(url: string): boolean {
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

// --- Format detection ---

export function detectFormat(content: string, extension?: string): LinkFormat {
  if (extension === '.csv') return 'csv'

  const trimmed = content.trim()
  if (trimmed.startsWith('{')) {
    try {
      const data = JSON.parse(trimmed)
      if (data && typeof data === 'object' && 'export' in data) return 'tablerone_json'
    } catch {
      // Not valid JSON, fall through
    }
  }

  const firstLines = splitLines(content).slice(0, 10)

  const hasIniSections = firstLines.some((l) => {
    const t = l.trim()
    return t.startsWith('[') && t.endsWith(']')
  })
  const hasOnetabFormat = firstLines.some((l) => l.includes(' * '))

  if (hasIniSections && hasOnetabFormat) return 'onetab_ini'
  if (firstLines.some((l) => l.includes(' | '))) return 'pipe'
  if (
    firstLines.some((l) => {
      const idx = l.lastIndexOf(' - ')
      return idx !== -1 && isValidUrl(l.slice(idx + 3).trim())
    })
  )
    return 'dash'

  return 'url_only'
}

// --- High-level entry point ---

export function parseLinks(content: string, extension?: string): Link[] {
  const format = detectFormat(content, extension)

  switch (format) {
    case 'csv':
      return parseCsvContent(content)
    case 'tablerone_json':
      return parseTableroneJson(content)
    case 'onetab_ini':
      return parseOnetabIni(content)
    case 'pipe':
      return splitLines(content)
        .map(extractUrlTitlePipe)
        .filter((link): link is Link => link !== null)
    case 'dash':
      return splitLines(content)
        .map(parseTitleUrlDash)
        .filter((link): link is Link => link !== null)
    case 'url_only':
    default:
      return splitLines(content)
        .map(extractUrlOnly)
        .filter((link): link is Link => link !== null)
  }
}
