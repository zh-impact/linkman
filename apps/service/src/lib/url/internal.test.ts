import { describe, it, expect } from 'vitest'
import { isPrivateIP, isInternalUrl } from './internal'

describe('isPrivateIP', () => {
  it('detects localhost variants', () => {
    expect(isPrivateIP('localhost')).toBe(true)
    expect(isPrivateIP('127.0.0.1')).toBe(true)
    expect(isPrivateIP('::1')).toBe(true)
  })

  it('detects the 10.0.0.0/8 block', () => {
    expect(isPrivateIP('10.0.0.1')).toBe(true)
  })

  it('detects the 192.168.0.0/16 block', () => {
    expect(isPrivateIP('192.168.1.1')).toBe(true)
  })

  it('detects link-local 169.254.0.0/16', () => {
    expect(isPrivateIP('169.254.0.1')).toBe(true)
  })

  it('detects 172.16.0.1 — the lower edge of the 172.16.0.0/12 block', () => {
    expect(isPrivateIP('172.16.0.1')).toBe(true)
  })

  it('detects 172.31.255.255 — the upper edge of the 172.16.0.0/12 block', () => {
    expect(isPrivateIP('172.31.255.255')).toBe(true)
  })

  it('rejects 172.15.0.1 — just below the /12 block', () => {
    expect(isPrivateIP('172.15.0.1')).toBe(false)
  })

  it('rejects 172.32.0.1 — just above the /12 block', () => {
    expect(isPrivateIP('172.32.0.1')).toBe(false)
  })

  it('rejects public DNS resolver 8.8.8.8', () => {
    expect(isPrivateIP('8.8.8.8')).toBe(false)
  })

  it('rejects 11.0.0.1 — just outside the 10/8 block', () => {
    expect(isPrivateIP('11.0.0.1')).toBe(false)
  })
})

describe('isInternalUrl', () => {
  it('returns true when the URL hostname is private', () => {
    expect(isInternalUrl('http://10.0.0.5/internal')).toBe(true)
  })

  it('returns false when the URL hostname is public', () => {
    expect(isInternalUrl('https://example.com/')).toBe(false)
  })

  it('returns false for malformed URL (catch branch)', () => {
    expect(isInternalUrl('not-a-url')).toBe(false)
  })
})
