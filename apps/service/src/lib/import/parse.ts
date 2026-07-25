import { v4 as uuidv4 } from 'uuid'
import type { NormalizeConfig } from '../../types'
import type { linksTable } from '../db/schema'
import type { Link, LinkFormat } from '../url/extract'
import { extractDomain, normalizeUrl } from '../url/normalize'
import { validateUrls } from '../url/validate'
import type { ImportType } from './extractors'

export type { ImportType } from './extractors'
export { extractLinks } from './extractors'

export const DEFAULT_NORMALIZE_CONFIG: NormalizeConfig = {
  forceHttps: false,
  removeWww: true,
  removeTrailingSlash: true,
  removeDefaultPort: true,
  sortQueryParams: false,
  removeFragment: true,
}

export const SMART_NORMALIZE_CONFIG: NormalizeConfig = {
  forceHttps: false,
  removeWww: true,
  removeTrailingSlash: true,
  removeDefaultPort: false,
  sortQueryParams: false,
  removeFragment: false,
}

export type ImportStrategy = 'strict' | 'normalized' | 'smart'

/**
 * Partition extracted links by URL well-formedness. Each extractor already
 * filters to `http(s)://` lines, but `validateUrls` applies stricter rules
 * (e.g. rejects URLs that fail `new URL(...)`). Returns `valid` (Link[] that
 * passed) and `invalid` (raw URL strings that failed). Order is preserved in
 * each partition, which keeps batch slicing deterministic.
 */
export function validateImportLinks(links: Link[]): { valid: Link[]; invalid: string[] } {
  const { invalid: invalidUrls } = validateUrls(links.map((l) => l.url))
  const invalidSet = new Set(invalidUrls)
  const valid: Link[] = []
  const invalid: string[] = []
  for (const link of links) {
    if (invalidSet.has(link.url)) invalid.push(link.url)
    else valid.push(link)
  }
  return { valid, invalid }
}

/**
 * Drop any link whose `normalizedUrl` (under the same strategy that
 * `prepareUrlRecord` would compute) is already in `existing`. Used by re-parse
 * to compute the diff cache: only URLs new to this source file make it
 * through, so subsequent `parse.batch` calls insert only the diff.
 *
 * Strategy must match the job's stored strategy — the caller is responsible
 * for rejecting strategy overrides on re-parse (see design.md D3 / R6). A
 * mismatch would silently re-introduce duplicates because the same original URL
 * normalizes to different strings under different strategies.
 */
export function filterAgainstExisting(
  links: Link[],
  existing: Set<string>,
  strategy: ImportStrategy,
): Link[] {
  return links.filter((link) => {
    const normalizedUrl =
      strategy === 'strict'
        ? link.url
        : strategy === 'normalized'
          ? normalizeUrl(link.url, DEFAULT_NORMALIZE_CONFIG)
          : normalizeUrl(link.url, SMART_NORMALIZE_CONFIG)
    return !existing.has(normalizedUrl)
  })
}

/** Build a single link record for insertion. */
export function prepareUrlRecord(
  link: Link,
  strategy: ImportStrategy,
  sourceType: ImportType,
  order: number,
  sourceFile?: string,
): typeof linksTable.$inferInsert {
  const originalUrl = link.url
  const normalizedUrl =
    strategy === 'strict'
      ? originalUrl
      : strategy === 'normalized'
        ? normalizeUrl(originalUrl, DEFAULT_NORMALIZE_CONFIG)
        : normalizeUrl(originalUrl, SMART_NORMALIZE_CONFIG)

  // Extract URL components from `originalUrl` (NOT `normalizedUrl`).
  // Rationale: the default normalization pipeline strips fragment
  // (`removeFragment`), `www.` host prefix (`removeWww`), and trailing
  // slashes (`removeTrailingSlash`). Extracting from `normalizedUrl` would
  // silently break `hash:` search and `host:www.example.com` queries. See
  // design.md D2 for full rationale. `extractDomain` already follows this
  // pattern at normalize.ts:46 — we share one `new URL()` call here.
  const domain = extractDomain(originalUrl)
  let urlPath: string | undefined
  let urlQuery: string | undefined
  let urlHash: string | undefined
  try {
    const parsed = new URL(originalUrl)
    urlPath = parsed.pathname || undefined
    urlQuery = parsed.search ? parsed.search.slice(1) : undefined
    urlHash = parsed.hash ? parsed.hash.slice(1) : undefined
  } catch {
    // Malformed URL — leave component columns undefined (Drizzle stores NULL).
    // Row will be matched by the invalid-URL full-text fallback (design D5).
  }

  return {
    id: uuidv4(),
    originalUrl,
    normalizedUrl,
    domain,
    urlPath,
    urlQuery,
    urlHash,
    title: link.title ?? '',
    source: sourceType,
    sourceFile,
    sourceOrder: order,
    status: 'imported',
    tags: '[]',
    isInternal: false,
  }
}

// --- In-memory cache for the validated link list of an in-progress parse job ---
// This is an optimization, not a correctness requirement: parse.batch self-heals
// by re-reading the file when an entry is missing (e.g. after a service restart).

export interface ParseCacheEntry {
  valid: Link[]
  invalid: string[]
  total: number
  detectedFormat: LinkFormat
}

const parseCache = new Map<string, ParseCacheEntry>()

export function getCachedUrls(jobId: string): ParseCacheEntry | undefined {
  return parseCache.get(jobId)
}

export function setCachedUrls(jobId: string, data: ParseCacheEntry): void {
  parseCache.set(jobId, data)
}

export function clearCachedUrls(jobId: string): void {
  parseCache.delete(jobId)
}
