import { type Link, type LinkFormat, splitLines } from '../../url/extract'
import { bookmarksHtmlExtractor } from './bookmarks-html'
import { csvExtractor } from './csv'
import { dashExtractor } from './dash'
import { jsonArrayExtractor } from './json-array'
import { onetabIniExtractor } from './onetab-ini'
import { pipeExtractor } from './pipe'
import { tableroneExtractor } from './tablerone'
import type { DetectContext, Extractor, ImportType } from './types'
import { urlOnlyExtractor } from './url-only'

/**
 * Registry order is the detection priority. Within each `type` branch:
 *   TXT  → csv, onetab_ini, pipe, dash, bookmarks_html, url_only  (url_only is the fallback)
 *   JSON → tablerone_json, json_array                              (json_array is the fallback)
 *
 * The `detect` predicates of the format-specific extractors already return
 * false for the wrong `type`, so iterating the whole list and picking the
 * first match yields the same result as a per-type sublist.
 */
export const extractorRegistry: Extractor[] = [
  csvExtractor,
  tableroneExtractor,
  onetabIniExtractor,
  pipeExtractor,
  dashExtractor,
  bookmarksHtmlExtractor,
  urlOnlyExtractor,
  jsonArrayExtractor,
]

const FALLBACK_FORMAT: Record<ImportType, LinkFormat> = {
  TXT: 'url_only',
  JSON: 'json_array',
}

const SNIFF_LINE_COUNT = 10

export function buildDetectContext(type: ImportType, content: string, filename?: string): DetectContext {
  const extension = filename ? lowerExtension(filename) : undefined
  const firstLines: string[] = []
  for (const line of splitLines(content)) {
    if (line.trim()) firstLines.push(line)
    if (firstLines.length >= SNIFF_LINE_COUNT) break
  }
  return { type, extension, content, firstLines }
}

function lowerExtension(filename: string): string | undefined {
  const dot = filename.lastIndexOf('.')
  if (dot === -1) return undefined
  const ext = filename.slice(dot).toLowerCase()
  // Strip query/hash that may appear on clipboard-pasted "filenames"
  return /^[a-z0-9]+$/.test(ext.slice(1)) ? ext : undefined
}

/**
 * Run the registry and return the winning extractor's output along with the
 * detected format identifier. Same `(type, content, filename)` triple MUST
 * yield the same `detectedFormat` and byte-identical `links` ordering — this
 * is what makes `parse.batch` resumable after a service restart.
 */
export function extractLinks(
  content: string,
  type: ImportType,
  filename?: string,
): { links: Link[]; detectedFormat: LinkFormat } {
  const ctx = buildDetectContext(type, content, filename)

  for (const extractor of extractorRegistry) {
    if (extractor.detect(ctx)) {
      return { links: extractor.extract(content), detectedFormat: extractor.format }
    }
  }

  // Should be unreachable because each type branch ends with a fallback whose
  // `detect` always returns true. Guard anyway so callers get deterministic
  // output if a future change removes a fallback.
  const detectedFormat = FALLBACK_FORMAT[type]
  const fallback = extractorRegistry.find((e) => e.format === detectedFormat)
  return {
    links: fallback ? fallback.extract(content) : [],
    detectedFormat,
  }
}

/**
 * Detect-only variant of `extractLinks`. Runs the same registry iteration but
 * skips the (potentially expensive) `extract` step. Used by `export.classify`
 * to power the "hide already-standard JSON" filter without paying the full
 * extraction cost for every file in the list.
 */
export function detectFormat(content: string, type: ImportType, filename?: string): LinkFormat {
  const ctx = buildDetectContext(type, content, filename)
  for (const extractor of extractorRegistry) {
    if (extractor.detect(ctx)) return extractor.format
  }
  return FALLBACK_FORMAT[type]
}

/**
 * Filename substrings whose source is JSON even though the extension is not
 * `.json`. Currently only Tablerone — its Chrome extension exports JSON
 * content under `tablerone_backup_<ts>.txt`. Add more entries here as
 * real-world cases appear.
 *
 * Match is case-insensitive substring; combined with the content-sniff
 * fallback below this is safe — a stray "tablerone" in an unrelated TXT
 * filename still gets re-checked via content sniff.
 */
const JSON_FILENAME_PATTERNS: RegExp[] = [/tablerone/i]

/** Bytes of content to peek at when sniffing for JSON shape. Cheap upper
 *  bound — we only need the first non-whitespace character. */
const CONTENT_SNIFF_HEAD = 64

/**
 * Resolve the `ImportType` to feed into `extractLinks` / `detectFormat`.
 * Single source of truth for type detection, used by both the Import flow
 * (`import.create` / `import.ensureJob`) and the Export flow
 * (`export.{classify, preview, run}`).
 *
 * Order of precedence:
 * 1. `override` — e.g. the type stored on an existing `import_jobs` row.
 *    The user (or an earlier flow) has already decided; we honor it.
 * 2. Filename pattern match — catches known wrong-extension cases
 *    (`tablerone_backup_*.txt`) without needing to read the file.
 * 3. Content sniff — if content was supplied and its first non-whitespace
 *    character is `{` or `[`, treat as JSON. Catches the general
 *    "JSON content saved under a .txt extension" case.
 * 4. Extension default (`.json` → JSON, otherwise TXT).
 */
export function resolveImportType(
  filename: string | undefined,
  content: string | undefined,
  override?: ImportType,
): ImportType {
  if (override) return override

  if (filename) {
    const base = filename.slice(Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\')) + 1)
    if (JSON_FILENAME_PATTERNS.some((re) => re.test(base))) return 'JSON'
  }

  if (content) {
    const head = content.slice(0, CONTENT_SNIFF_HEAD).trimStart()
    if (head.startsWith('{') || head.startsWith('[')) return 'JSON'
  }

  return filename?.toLowerCase().endsWith('.json') ? 'JSON' : 'TXT'
}

export { bookmarksHtmlExtractor } from './bookmarks-html'
export { csvExtractor } from './csv'
export { dashExtractor } from './dash'
export { jsonArrayExtractor } from './json-array'
export { onetabIniExtractor } from './onetab-ini'
export { pipeExtractor } from './pipe'
export { tableroneExtractor } from './tablerone'
export type { DetectContext, Extractor, ImportType } from './types'
export { urlOnlyExtractor } from './url-only'
