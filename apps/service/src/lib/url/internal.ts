export function isPrivateIP(hostname: string): boolean {
  // localhost
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return true
  }

  // 10.0.0.0/8
  if (hostname.startsWith('10.')) return true

  // 192.168.0.0/16
  if (hostname.startsWith('192.168.')) return true

  // 172.16.0.0/12
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true

  // Link-local
  if (hostname.startsWith('169.254.')) return true

  return false
}

export function isInternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return isPrivateIP(parsed.hostname)
  } catch {
    return false
  }
}
