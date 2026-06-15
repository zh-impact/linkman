/**
 * Check if two strings are similar enough based on edit distance threshold.
 * Uses single-row DP with early termination and length pre-filter for performance.
 *
 * @returns true if similarityRatio(a, b) >= threshold
 */
export function isSimilarEnough(a: string, b: string, threshold: number): boolean {
  if (a === b) return true
  const lenA = a.length
  const lenB = b.length
  const maxLen = Math.max(lenA, lenB)
  if (maxLen === 0) return true

  // Length pre-filter: edit distance >= |lenA - lenB|
  // similarity = 1 - dist/maxLen >= threshold  =>  dist <= (1-threshold)*maxLen
  const maxAllowedDist = Math.floor((1 - threshold) * maxLen)
  if (Math.abs(lenA - lenB) > maxAllowedDist) return false

  // Single-row DP: iterate over the shorter string to minimize inner loop
  const shortStr = lenA <= lenB ? a : b
  const longStr = lenA <= lenB ? b : a
  const shortLen = shortStr.length
  const longLen = longStr.length

  let prev = new Array<number>(shortLen + 1)
  let curr = new Array<number>(shortLen + 1)

  for (let j = 0; j <= shortLen; j++) prev[j] = j

  for (let i = 1; i <= longLen; i++) {
    curr[0] = i
    let rowMin = curr[0]

    for (let j = 1; j <= shortLen; j++) {
      const cost = longStr.charCodeAt(i - 1) === shortStr.charCodeAt(j - 1) ? 0 : 1
      const del = prev[j] + 1
      const ins = curr[j - 1] + 1
      const sub = prev[j - 1] + cost
      let best = del < ins ? del : ins
      if (sub < best) best = sub
      curr[j] = best
      if (best < rowMin) rowMin = best
    }

    // Early termination: if minimum value in this row exceeds threshold, no match
    if (rowMin > maxAllowedDist) return false

    const tmp = prev
    prev = curr
    curr = tmp
  }

  const dist = prev[shortLen]
  return 1 - dist / maxLen >= threshold
}
