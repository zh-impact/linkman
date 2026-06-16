import { v4 as uuidv4 } from 'uuid'
import { linksTable } from '../db/schema'
import type { NormalizeConfig } from '../../types'
import { extractDomain, normalizeUrl } from '../url/normalize'
import { validateUrls } from '../url/validate'

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
export type ImportType = 'TXT' | 'JSON'

/**
 * Extract raw URL strings from source content.
 * Order-deterministic: TXT preserves line order; JSON preserves array order.
 * This determinism is what makes parse.batch resumable after a cache miss.
 */
export function extractUrls(type: ImportType, content: string): string[] {
  if (type === 'JSON') {
    try {
      const parsed = JSON.parse(content)
      if (!Array.isArray(parsed)) return []
      return parsed.map((item: unknown) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object' && 'url' in item) {
          return String((item as { url: string }).url)
        }
        return String(item)
      })
    } catch {
      return []
    }
  }
  return content
    .split('\n')
    .map((u) => u.trim())
    .filter(Boolean)
}

/** Validate a list of raw URLs, splitting into valid/invalid (order-preserving). */
export function validateImportUrls(urls: string[]) {
  return validateUrls(urls)
}

/** Build a single link record for insertion. */
export function prepareUrlRecord(
  originalUrl: string,
  strategy: ImportStrategy,
  sourceType: ImportType,
  order: number,
): typeof linksTable.$inferInsert {
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
    source: sourceType,
    sourceOrder: order,
    status: 'imported',
    tags: '[]',
    isInternal: false,
  }
}

// --- In-memory cache for the validated URL list of an in-progress parse job ---
// This is an optimization, not a correctness requirement: parse.batch self-heals
// by re-reading the file when an entry is missing (e.g. after a service restart).

export interface ParseCacheEntry {
  valid: string[]
  invalid: string[]
  total: number
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
