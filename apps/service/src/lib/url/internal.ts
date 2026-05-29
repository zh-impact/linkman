export function isPrivateIP(hostname: string): boolean {
  // Strip port if present
  const host = hostname.split(':')[0]

  // IPv4 private ranges
  const ipv4Pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
  const match = host.match(ipv4Pattern)
  if (match) {
    const [, a, b] = match.map(Number)
    if (a === 10) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 127) return true
    if (a === 0) return true
    if (a === 169 && b === 254) return true
    return false
  }

  // localhost
  if (host === 'localhost' || host === 'localhost.localdomain') return true

  // IPv6 private
  if (host === '::1' || host === '::') return true
  if (host.startsWith('fc') || host.startsWith('fd')) return true
  if (host.startsWith('fe80')) return true

  return false
}

export function isInternalUrl(url: string): boolean {
  try {
    const urlObj = new URL(url)
    if (urlObj.protocol === 'file:') return true
    if (isPrivateIP(urlObj.hostname)) return true
    return false
  } catch {
    return false
  }
}
