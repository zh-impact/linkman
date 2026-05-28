export interface ParsedUrl {
  original: string
  protocol: string
  hostname: string
  port: string
  pathname: string
  search: string
  hash: string
  domain: string
}

export function parseUrl(url: string): ParsedUrl | null {
  try {
    const urlObj = new URL(url)
    return {
      original: url,
      protocol: urlObj.protocol,
      hostname: urlObj.hostname,
      port: urlObj.port,
      pathname: urlObj.pathname,
      search: urlObj.search,
      hash: urlObj.hash,
      domain: urlObj.hostname,
    }
  } catch {
    return null
  }
}

export function batchParseUrls(urls: string[]): Map<string, ParsedUrl> {
  const map = new Map<string, ParsedUrl>()

  for (const url of urls) {
    const parsed = parseUrl(url)
    if (parsed) {
      map.set(url, parsed)
    }
  }

  return map
}
