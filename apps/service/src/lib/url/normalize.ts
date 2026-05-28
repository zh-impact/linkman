import type { NormalizeConfig } from '../../types'

export function normalizeUrl(url: string, config: NormalizeConfig): string {
  try {
    const normalized = new URL(url)

    // Apply normalization rules
    if (config.forceHttps && normalized.protocol === 'http:') {
      normalized.protocol = 'https:'
    }

    if (config.removeWww) {
      normalized.hostname = normalized.hostname.replace(/^www\./, '')
    }

    if (config.removeTrailingSlash) {
      normalized.pathname = normalized.pathname.replace(/\/$/, '') || '/'
    }

    if (config.removeDefaultPort) {
      if (
        (normalized.protocol === 'https:' && normalized.port === '443') ||
        (normalized.protocol === 'http:' && normalized.port === '80')
      ) {
        normalized.port = ''
      }
    }

    if (config.sortQueryParams) {
      const params = new URLSearchParams(normalized.search)
      const sortedParams = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b))
      normalized.search = new URLSearchParams(sortedParams).toString()
    }

    if (config.removeFragment) {
      normalized.hash = ''
    }

    return normalized.toString()
  } catch {
    // If URL parsing fails, return original
    return url
  }
}

export function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url)
    return urlObj.hostname
  } catch {
    return ''
  }
}
