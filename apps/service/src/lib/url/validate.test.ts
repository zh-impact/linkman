import { describe, it, expect } from 'vitest'
import { validateUrl, validateUrls } from './validate'

describe('validateUrl', () => {
  it('accepts a well-formed https URL', () => {
    expect(validateUrl('https://example.com')).toBe(true)
  })

  it('accepts a well-formed http URL with path, query, and fragment', () => {
    expect(validateUrl('http://example.com/path?q=1#h')).toBe(true)
  })

  it('rejects "not-a-url"', () => {
    expect(validateUrl('not-a-url')).toBe(false)
  })

  it('rejects bare "://" (no scheme, no host)', () => {
    expect(validateUrl('://')).toBe(false)
  })

  it('rejects "http://" with no host', () => {
    expect(validateUrl('http://')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(validateUrl('')).toBe(false)
  })

  it('accepts non-http schemes — scheme restriction is not enforced at this layer', () => {
    // Documented: validate.ts only checks URL well-formedness.
    // Route-level validation may restrict schemes further.
    expect(validateUrl('ftp://example.com')).toBe(true)
  })
})

describe('validateUrls', () => {
  it('partitions mixed valid/invalid URLs and preserves order in each bucket', () => {
    const result = validateUrls(['https://a.com', 'not-a-url', 'https://b.com', '://'])
    expect(result.valid).toEqual(['https://a.com', 'https://b.com'])
    expect(result.invalid).toEqual(['not-a-url', '://'])
  })

  it('skips empty and whitespace-only lines (neither bucket)', () => {
    const result = validateUrls(['https://a.com', '', '   ', 'https://b.com'])
    expect(result.valid).toEqual(['https://a.com', 'https://b.com'])
    expect(result.invalid).toEqual([])
  })
})
