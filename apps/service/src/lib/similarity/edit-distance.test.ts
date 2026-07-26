import { describe, it, expect } from 'vitest'
import { isSimilarEnough } from './edit-distance'

describe('isSimilarEnough', () => {
  it('short-circuits to true when the two strings are identical', () => {
    // Bypasses the DP entirely; passes for any threshold.
    expect(isSimilarEnough('abc', 'abc', 0.99)).toBe(true)
  })

  it('returns true when both strings are empty', () => {
    expect(isSimilarEnough('', '', 0.99)).toBe(true)
  })

  it('rejects via length prefilter when |lenA-lenB| > (1-threshold)*maxLen', () => {
    // threshold 0.9, maxLen 10 → maxAllowedDist = floor(0.1 * 10) = 1
    // lenA=2, lenB=10 → |diff|=8 > 1 → reject without running DP
    expect(isSimilarEnough('ab', 'abcdefghij', 0.9)).toBe(false)
  })

  it('threshold=1.0 only passes exact matches (after the identical short-circuit)', () => {
    expect(isSimilarEnough('abc', 'abd', 1.0)).toBe(false)
    expect(isSimilarEnough('abc', 'abc', 1.0)).toBe(true)
  })

  it('threshold=0.0 passes anything that survives the length filter', () => {
    // Same length → length filter passes → dist ≤ maxLen → similarity ≥ 0 → pass
    expect(isSimilarEnough('abc', 'xyz', 0.0)).toBe(true)
  })

  it('one-char diff on a 10-char string passes at threshold=0.8', () => {
    // similarity = 1 - 1/10 = 0.9 ≥ 0.8 → pass
    expect(isSimilarEnough('abcdefghij', 'abcdefghiX', 0.8)).toBe(true)
  })

  it('five-char diff on a 10-char string fails at threshold=0.8', () => {
    // similarity = 1 - 5/10 = 0.5 < 0.8 → reject
    expect(isSimilarEnough('abcdefghij', 'XXXXXfghij', 0.8)).toBe(false)
  })

  it('is commutative: f(a,b,t) === f(b,a,t)', () => {
    // The short/long swap inside the implementation must be transparent.
    const a = 'abcdefghij'
    const b = 'abcXXfghij'
    expect(isSimilarEnough(a, b, 0.8)).toBe(isSimilarEnough(b, a, 0.8))
  })

  it('early-termination branch fires for long, very-different strings', () => {
    // 100 chars all-different → row minimum exceeds maxAllowedDist early.
    const a = 'a'.repeat(100)
    const b = 'b'.repeat(100)
    expect(isSimilarEnough(a, b, 0.8)).toBe(false)
  })

  it('documents the charCodeAt basis — surrogate pairs are treated as two code units', () => {
    // 'abc' vs 'ábč': each non-ASCII char is one UTF-16 code unit here.
    // 2 of 3 positions differ → similarity = 1 - 2/3 ≈ 0.33 < 0.5 → reject.
    // If Unicode normalization is ever added, this test will fail as a signal.
    expect(isSimilarEnough('abc', 'ábč', 0.5)).toBe(false)
  })
})
