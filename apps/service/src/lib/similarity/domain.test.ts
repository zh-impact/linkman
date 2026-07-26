import { describe, it, expect } from 'vitest'
import { groupByDomain } from './domain'

describe('groupByDomain', () => {
  it('groups multiple links sharing a domain into one bucket', () => {
    const links = [
      { id: '1', domain: 'example.com' },
      { id: '2', domain: 'example.com' },
    ]
    const groups = groupByDomain(links)
    expect(groups.get('example.com')).toEqual(['1', '2'])
  })

  it('separates different domains into different buckets, dropping singletons', () => {
    const links = [
      { id: '1', domain: 'a.com' },
      { id: '2', domain: 'b.com' },
      { id: '3', domain: 'a.com' },
    ]
    const groups = groupByDomain(links)
    expect(groups.get('a.com')).toEqual(['1', '3'])
    // b.com has only one link → dropped by the `ids.length < 2` guard
    expect(groups.has('b.com')).toBe(false)
  })

  it('drops every singleton group when no two links share a domain', () => {
    const links = [
      { id: '1', domain: 'a.com' },
      { id: '2', domain: 'b.com' },
    ]
    expect(groupByDomain(links).size).toBe(0)
  })
})
