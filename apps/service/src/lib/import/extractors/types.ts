import type { Link, LinkFormat } from '../../url/extract'

/**
 * The declared import type narrows the candidate extractor set.
 * `TXT` covers csv / onetab_ini / pipe / dash / url_only.
 * `JSON` covers tablerone_json / json_array.
 */
export type ImportType = 'TXT' | 'JSON'

export interface DetectContext {
  type: ImportType
  /** Lowercased filename extension including the leading dot (e.g. `.csv`), or undefined. */
  extension?: string
  /** Full source file content (already loaded). */
  content: string
  /** First 10 non-empty lines, precomputed for sniffing. */
  firstLines: string[]
}

export interface Extractor {
  format: LinkFormat
  /** Return true if this extractor should handle the given context. */
  detect(ctx: DetectContext): boolean
  /** Extract links from the full content. MUST preserve source order. */
  extract(content: string): Link[]
}
