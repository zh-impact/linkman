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

const SMART_NORMALIZE_CONFIG: NormalizeConfig = {
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

/** Build a single link record for insertion. */
export function prepareUrlRecord(
  link: Link,
  strategy: ImportStrategy,
  sourceType: ImportType,
  order: number,
): typeof linksTable.$inferInsert {
  const originalUrl = link.url
  const normalizedUrl =
    strategy === 'strict'
      ? originalUrl
      : strategy === 'normalized'
        ? normalizeUrl(originalUrl, DEFAULT_NORMALIZE_CONFIG)
        : normalizeUrl(originalUrl, SMART_NORMALIZE_CONFIG)

  const domain = extractDomain(originalUrl)

  return {
    id: uuidv4(),
    originalUrl,
    normalizedUrl,
    domain,
    title: link.title ?? '',
    source: sourceType,
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
