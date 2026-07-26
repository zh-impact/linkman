import { describe, it, expect } from 'vitest'
import { groupByPathPrefix } from './path-prefix'

describe('groupByPathPrefix', () => {
  it('groups by first two path segments at default depth=2', () => {
    const links = [
      { id: '1', normalizedUrl: 'https://example.com/a/b/c/d' },
      { id: '2', normalizedUrl: 'https://example.com/a/b/x/y' },
      { id: '3', normalizedUrl: 'https://example.com/a/z/p/q' },
    ]
    const groups = groupByPathPrefix(links)
    expect(groups.get('example.com/a/b')).toEqual(['1', '2'])
    // 'example.com/a/z' has only one link → dropped
    expect(groups.has('example.com/a/z')).toBe(false)
  })

  it('groups by first segment only when depth=1', () => {
    const links = [
      { id: '1', normalizedUrl: 'https://example.com/a/b' },
      { id: '2', normalizedUrl: 'https://example.com/a/c' },
    ]
    const groups = groupByPathPrefix(links, 1)
    expect(groups.get('example.com/a')).toEqual(['1', '2'])
  })

  it('groups by first three segments when depth=3', () => {
    const links = [
      { id: '1', normalizedUrl: 'https://example.com/a/b/c/d' },
      { id: '2', normalizedUrl: 'https://example.com/a/b/c/e' },
    ]
    const groups = groupByPathPrefix(links, 3)
    expect(groups.get('example.com/a/b/c')).toEqual(['1', '2'])
  })

  it('drops groups that contain only one link', () => {
    const links = [
      { id: '1', normalizedUrl: 'https://example.com/a/b/c' },
      { id: '2', normalizedUrl: 'https://example.com/x/y/z' },
    ]
    expect(groupByPathPrefix(links, 2).size).toBe(0)
  })

  it('treats hostname as part of the group key (same prefix, different host = different group)', () => {
    const links = [
      { id: '1', normalizedUrl: 'https://a.com/p/x' },
      { id: '2', normalizedUrl: 'https://a.com/p/y' },
      { id: '3', normalizedUrl: 'https://b.com/p/z' },
      { id: '4', normalizedUrl: 'https://b.com/p/w' },
    ]
    const groups = groupByPathPrefix(links, 1)
    expect(groups.get('a.com/p')).toEqual(['1', '2'])
    expect(groups.get('b.com/p')).toEqual(['3', '4'])
  })

  it('silently skips malformed URLs in the input array', () => {
    const links = [
      { id: '1', normalizedUrl: 'https://example.com/a/b' },
      { id: '2', normalizedUrl: 'not-a-url' },
      { id: '3', normalizedUrl: 'https://example.com/a/c' },
    ]
    const groups = groupByPathPrefix(links, 1)
    expect(groups.get('example.com/a')).toEqual(['1', '3'])
  })
})
