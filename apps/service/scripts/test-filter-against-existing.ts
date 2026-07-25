/**
 * Smoke test for `filterAgainstExisting`. Run with:
 *   pnpm --filter service exec tsx scripts/test-filter-against-existing.ts
 *
 * Exits non-zero on failure. Used by task 3.4 of the reparse-updated-files
 * change to verify the diff filter behaves as specified before wiring it
 * into parse.start.
 */
import { filterAgainstExisting, DEFAULT_NORMALIZE_CONFIG, SMART_NORMALIZE_CONFIG } from '../src/lib/import/parse'
import type { Link } from '../src/lib/url/extract'
import { normalizeUrl } from '../src/lib/url/normalize'

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`FAIL: ${message}`)
    process.exit(1)
  }
  console.log(`ok: ${message}`)
}

const a: Link = { url: 'https://example.com/a', title: '' }
const b: Link = { url: 'https://example.com/b', title: '' }
const c: Link = { url: 'https://example.com/c', title: '' }
const d: Link = { url: 'https://example.com/d', title: '' }

const normalizeNormalized = (u: string) => normalizeUrl(u, DEFAULT_NORMALIZE_CONFIG)
const normalizeSmart = (u: string) => normalizeUrl(u, SMART_NORMALIZE_CONFIG)

// Scenario from spec: a, c already exist under 'normalized' strategy → b, d remain.
{
  const existing = new Set([normalizeNormalized(a.url), normalizeNormalized(c.url)])
  const result = filterAgainstExisting([a, b, c, d], existing, 'normalized')
  assert(result.length === 2, 'drops the 2 matching, keeps the 2 new')
  assert(result[0].url === b.url && result[1].url === d.url, 'preserves order of the survivors')
}

// Empty existing → no filtering.
{
  const result = filterAgainstExisting([a, b], new Set(), 'normalized')
  assert(result.length === 2, 'empty existing → all pass through')
}

// Strategy matters: same URL filters under 'normalized' may not under 'smart'
// (different config). Verifies that the helper uses the supplied strategy.
{
  // removeFragment differs between configs; craft a URL with a fragment.
  const withFragment: Link = { url: 'https://example.com/x#section', title: '' }
  const normalizedForm = normalizeNormalized(withFragment.url) // fragment stripped
  const smartForm = normalizeSmart(withFragment.url) // fragment kept
  if (normalizedForm !== smartForm) {
    const existing = new Set([normalizedForm])
    const result = filterAgainstExisting([withFragment], existing, 'smart')
    assert(result.length === 1, 'strategy mismatch escapes the filter (different normalized forms)')
    const result2 = filterAgainstExisting([withFragment], existing, 'normalized')
    assert(result2.length === 0, 'strategy match correctly filters')
  }
}

// 'strict' strategy: identity normalization, so existing must contain the raw URL.
{
  const existing = new Set([a.url])
  const result = filterAgainstExisting([a, b], existing, 'strict')
  assert(result.length === 1 && result[0].url === b.url, 'strict strategy uses raw URL')
}

console.log('\nAll assertions passed.')
