# Automated Tests — Pure-Function Coverage (Round 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a Vitest-based test baseline covering every pure-function module exported from `apps/service/src/lib/` (~83 cases across 8 modules), wired into `pnpm test` from repo root.

**Architecture:** Co-located `*.test.ts` files next to their source. Default-first Vitest config (no `vitest.config.ts` unless needed). Tests pin current source behavior — no production-code refactors. Each module is its own task with its own commit.

**Tech Stack:** Vitest (single new devDependency on `@linkman/service`), existing TypeScript ESM toolchain (`tsx`, `moduleResolution: bundler`, `verbatimModuleSyntax: true`).

## Global Constraints

Carried verbatim from `docs/superpowers/specs/2026-07-26-automated-tests-pure-functions-design.md`:

- **Scope:** `apps/service/src/lib/` only. No DB/route/React tests. No `url/extract.ts` line-level parsers (registry-wrapped, not exported for testing).
- **No production-code refactors** to make things testable. If a test surfaces a real bug, note it as a follow-up rather than fixing inline.
- **No CI workflow** in this round.
- **No coverage threshold gate.**
- **Framework:** Vitest. No `node:test`.
- **Placement:** Co-located (`url/normalize.ts` ↔ `url/normalize.test.ts`).
- **Naming:** `describe('<functionName>', ...)` per exported function. `it('<behavior>', ...)` not `it('<input>', ...)`.
- **No mocks, no stubs.** Pure functions only — if a test feels like it needs a mock, the function isn't actually pure and belongs in a later round.
- **Dependency install:** `pnpm --filter @linkman/service add -D vitest` (filters by workspace package name; service's `package.json` name is `@linkman/service`).
- **Test command:** `pnpm --filter service test <optional-path>` (matches the existing `pnpm --filter service dev` pattern in root scripts).

---

## File Structure

**Created files (all under `apps/service/src/lib/`):**

| File | LOC est. | Cases |
|---|---|---|
| `similarity/domain.test.ts` | ~30 | 3 |
| `similarity/path-prefix.test.ts` | ~50 | 6 |
| `url/validate.test.ts` | ~50 | 9 |
| `url/internal.test.ts` | ~60 | 13 |
| `similarity/edit-distance.test.ts` | ~60 | 10 |
| `url/normalize.test.ts` | ~90 | 15 |
| `url/parse-search-query.test.ts` | ~90 | 14 |
| `import/parse.test.ts` | ~140 | 17 |

**Modified files:**

| File | Change |
|---|---|
| `apps/service/package.json` | Add `"test"` and `"test:watch"` scripts; add `vitest` to devDependencies |
| `package.json` (root) | Change `"test"` from the placeholder error to `"pnpm --filter service test"` |

**No new directories.** Tests sit next to source.

---

## Task 1: Install Vitest and wire up npm scripts

**Files:**
- Modify: `apps/service/package.json` (add `test` + `test:watch` scripts, add `vitest` devDep)
- Modify: `package.json` (root) — change `"test"` to delegate to service workspace

**Interfaces:**
- Produces: a working `pnpm test` command from repo root that invokes Vitest on `apps/service`.

- [ ] **Step 1: Install Vitest as a service devDependency**

Run from repo root:
```bash
pnpm --filter @linkman/service add -D vitest
```

Expected: `vitest` appears under `devDependencies` in `apps/service/package.json`. A new entry appears in `pnpm-lock.yaml`.

- [ ] **Step 2: Add npm scripts to `apps/service/package.json`**

Edit `apps/service/package.json` `scripts` block. After this step it should read:

```json
"scripts": {
  "dev": "tsx watch src/server.ts",
  "drizzle-kit": "drizzle-kit",
  "db:generate": "drizzle-kit generate",
  "db:migrate": "tsx src/lib/db/migrate.ts",
  "db:init": "tsx src/lib/db/migrate.ts",
  "test": "vitest run",
  "test:watch": "vitest"
},
```

- [ ] **Step 3: Update root `package.json` test script**

Edit the root `package.json` `scripts.test` line. Change:

```json
"test": "echo \"Error: no test specified\" && exit 1",
```

to:

```json
"test": "pnpm --filter service test",
```

The `--filter service` matches the existing `pnpm --filter service dev` convention in this repo (filters by package name suffix, not the literal `@linkman/service`).

- [ ] **Step 4: Verify wiring — run `pnpm test` and confirm Vitest reports "no test files found"**

Run from repo root:
```bash
pnpm test
```

Expected output: Vitest prints a banner and then a warning like `No test files found, exiting with code 1`. That error confirms Vitest is installed and the script wiring works — we'll add test files starting in Task 2.

If you instead see `Error: no test specified` (the old placeholder), the root script edit didn't take. Re-check Step 3.

If you see a `verbatimModuleSyntax` or `moduleResolution` error from Vitest itself, add a minimal `apps/service/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: { target: 'es2023' },
})
```

The default-first approach is to skip this file unless needed.

- [ ] **Step 5: Commit**

```bash
git add apps/service/package.json package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
chore(service): add Vitest test infrastructure

Adds vitest as a service devDependency and wires up `pnpm test` from
repo root. No test files yet — those land in subsequent commits.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

(If you added a `vitest.config.ts` fallback in Step 4, include it in the commit.)

---

## Task 2: `similarity/domain.ts` tests (3 cases)

**Files:**
- Create: `apps/service/src/lib/similarity/domain.test.ts`

**Interfaces:**
- Consumes: `groupByDomain(links: Array<{ id: string; domain: string }>): Map<string, string[]>` from `./domain`
- Produces: first test file in the repo; proves the Vitest wiring works end-to-end with real tests.

- [ ] **Step 1: Write the test file**

Create `apps/service/src/lib/similarity/domain.test.ts` with this exact content:

```ts
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
```

- [ ] **Step 2: Run the tests and verify all three pass**

Run from repo root:
```bash
pnpm --filter service test src/lib/similarity/domain.test.ts
```

Expected: `Test Files  1 passed (1)`, `Tests  3 passed (3)`.

If any test fails, do not modify `domain.ts` (Non-Goal: no source refactor). Instead, double-check the test inputs against actual source behavior. If the source genuinely disagrees with the spec's documented behavior, note it as a follow-up comment in the test file and proceed.

- [ ] **Step 3: Commit**

```bash
git add apps/service/src/lib/similarity/domain.test.ts
git commit -m "$(cat <<'EOF'
test(similarity): cover groupByDomain

3 cases: same-domain grouping, cross-domain separation with singleton
drop, all-singletons-empty-result.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `similarity/path-prefix.ts` tests (6 cases)

**Files:**
- Create: `apps/service/src/lib/similarity/path-prefix.test.ts`

**Interfaces:**
- Consumes: `groupByPathPrefix(links: Array<{ id: string; normalizedUrl: string }>, depth?: number): Map<string, string[]>` from `./path-prefix`. Default `depth = 2`. Group key is `${hostname}${prefix}` where prefix is `/${segments.slice(0, depth).join('/')}`. Groups with fewer than 2 items are dropped. Malformed URLs are silently skipped.

- [ ] **Step 1: Write the test file**

Create `apps/service/src/lib/similarity/path-prefix.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests and verify all six pass**

```bash
pnpm --filter service test src/lib/similarity/path-prefix.test.ts
```

Expected: `Tests  6 passed (6)`.

- [ ] **Step 3: Commit**

```bash
git add apps/service/src/lib/similarity/path-prefix.test.ts
git commit -m "$(cat <<'EOF'
test(similarity): cover groupByPathPrefix

6 cases: default depth=2, depth=1, depth=3, singleton drop, hostname
included in group key, malformed URLs skipped silently.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `url/validate.ts` tests (9 cases)

**Files:**
- Create: `apps/service/src/lib/url/validate.test.ts`

**Interfaces:**
- Consumes: `validateUrl(url: string): boolean` and `validateUrls(urls: string[]): { valid: string[]; invalid: string[] }` from `./validate`. Both use `new URL(...)` for well-formedness; no scheme restriction at this layer.

- [ ] **Step 1: Write the test file**

Create `apps/service/src/lib/url/validate.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests**

```bash
pnpm --filter service test src/lib/url/validate.test.ts
```

Expected: `Tests  9 passed (9)`.

- [ ] **Step 3: Commit**

```bash
git add apps/service/src/lib/url/validate.test.ts
git commit -m "$(cat <<'EOF'
test(url): cover validateUrl and validateUrls

9 cases: well-formed https/http accepted, malformed rejected, empty
rejected, non-http scheme accepted (documents layer scope), partition
order preservation, empty-line skipping.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `url/internal.ts` tests (13 cases)

**Files:**
- Create: `apps/service/src/lib/url/internal.test.ts`

**Interfaces:**
- Consumes: `isPrivateIP(hostname: string): boolean` and `isInternalUrl(url: string): boolean` from `./internal`. The CIDR landmine is the `172.16.0.0/12` block (regex `/^172\.(1[6-9]|2\d|3[01])\./`).

- [ ] **Step 1: Write the test file**

Create `apps/service/src/lib/url/internal.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests**

```bash
pnpm --filter service test src/lib/url/internal.test.ts
```

Expected: `Tests  13 passed (13)`. The four CIDR edge cases (172.15/16/31/32) are the highest-value tests in this round — they will fail loudly if anyone later rewrites the regex.

- [ ] **Step 3: Commit**

```bash
git add apps/service/src/lib/url/internal.test.ts
git commit -m "$(cat <<'EOF'
test(url): cover isPrivateIP CIDR boundaries and isInternalUrl

13 cases. The four 172.x edge cases (15 reject, 16 accept, 31 accept,
32 reject) pin the /12 regex against future refactors. isInternalUrl
catches public/private/malformed branches.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `similarity/edit-distance.ts` tests (10 cases)

**Files:**
- Create: `apps/service/src/lib/similarity/edit-distance.test.ts`

**Interfaces:**
- Consumes: `isSimilarEnough(a: string, b: string, threshold: number): boolean` from `./edit-distance`. Uses `charCodeAt` (UTF-16 code units, not Unicode code points). Has length prefilter and per-row early termination.

- [ ] **Step 1: Write the test file**

Create `apps/service/src/lib/similarity/edit-distance.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests**

```bash
pnpm --filter service test src/lib/similarity/edit-distance.test.ts
```

Expected: `Tests  10 passed (10)`. The commutativity test is the easiest to break in a refactor — if it fails, someone changed the short/long swap inside the DP.

- [ ] **Step 3: Commit**

```bash
git add apps/service/src/lib/similarity/edit-distance.test.ts
git commit -m "$(cat <<'EOF'
test(similarity): cover isSimilarEnough thresholds and edges

10 cases: identical short-circuit, empty/empty, length prefilter,
threshold boundaries (0.0 and 1.0), one-char vs five-char diff,
commutativity (the short/long swap invariant), early-termination
branch, charCodeAt basis pinning surrogate-pair handling.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `url/normalize.ts` tests (15 cases)

**Files:**
- Create: `apps/service/src/lib/url/normalize.test.ts`

**Interfaces:**
- Consumes: `normalizeUrl(url: string, config: NormalizeConfig): string`, `extractDomain(url: string): string` from `./normalize`. Also imports `DEFAULT_NORMALIZE_CONFIG` and `SMART_NORMALIZE_CONFIG` from `../import/parse` to test the real-config combos.
- `NormalizeConfig` shape (from `apps/service/src/types`): `{ forceHttps, removeWww, removeTrailingSlash, removeDefaultPort, sortQueryParams, removeFragment }` — all booleans.

- [ ] **Step 1: Write the test file**

Create `apps/service/src/lib/url/normalize.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { normalizeUrl, extractDomain } from './normalize'
import { DEFAULT_NORMALIZE_CONFIG, SMART_NORMALIZE_CONFIG } from '../import/parse'
import type { NormalizeConfig } from '../../types'

// Every flag off — used as the base for per-flag isolation tests.
const ALL_OFF: NormalizeConfig = {
  forceHttps: false,
  removeWww: false,
  removeTrailingSlash: false,
  removeDefaultPort: false,
  sortQueryParams: false,
  removeFragment: false,
}

describe('normalizeUrl', () => {
  describe('per-flag isolation', () => {
    it('strips leading "www." from the hostname when removeWww is true', () => {
      const out = normalizeUrl('https://www.example.com/path', { ...ALL_OFF, removeWww: true })
      expect(out).toBe('https://example.com/path')
    })

    it('strips trailing slash from non-root paths when removeTrailingSlash is true', () => {
      const out = normalizeUrl('https://example.com/path/', { ...ALL_OFF, removeTrailingSlash: true })
      expect(out).toBe('https://example.com/path')
    })

    it('preserves root "/" when removeTrailingSlash is true (the "|| /" guard)', () => {
      const out = normalizeUrl('https://example.com/', { ...ALL_OFF, removeTrailingSlash: true })
      expect(out).toBe('https://example.com/')
    })

    it('strips :443 from https URLs when removeDefaultPort is true', () => {
      const out = normalizeUrl('https://example.com:443/path', { ...ALL_OFF, removeDefaultPort: true })
      expect(out).toBe('https://example.com/path')
    })

    it('strips :80 from http URLs when removeDefaultPort is true', () => {
      const out = normalizeUrl('http://example.com:80/path', { ...ALL_OFF, removeDefaultPort: true })
      expect(out).toBe('http://example.com/path')
    })

    it('keeps non-default ports (:8080) when removeDefaultPort is true', () => {
      const out = normalizeUrl('https://example.com:8080/path', { ...ALL_OFF, removeDefaultPort: true })
      expect(out).toBe('https://example.com:8080/path')
    })

    it('reorders query params alphabetically when sortQueryParams is true', () => {
      const out = normalizeUrl('https://example.com/?b=2&a=1', { ...ALL_OFF, sortQueryParams: true })
      expect(out).toBe('https://example.com/?a=1&b=2')
    })

    it('strips the fragment when removeFragment is true', () => {
      const out = normalizeUrl('https://example.com/path#bar', { ...ALL_OFF, removeFragment: true })
      expect(out).toBe('https://example.com/path')
    })

    it('rewrites http: to https: when forceHttps is true', () => {
      const out = normalizeUrl('http://example.com/path', { ...ALL_OFF, forceHttps: true })
      expect(out).toBe('https://example.com/path')
    })
  })

  describe('real-config combos', () => {
    it('DEFAULT_NORMALIZE_CONFIG strips fragment + default port + trailing slash + www', () => {
      // Used by the 'normalized' import strategy. Custom ports are kept
      // (removeDefaultPort only strips :443/:80). sortQueryParams is false,
      // so query-param order is preserved.
      const out = normalizeUrl('https://www.example.com:443/path/?b=2&a=1#frag', DEFAULT_NORMALIZE_CONFIG)
      expect(out).toBe('https://example.com/path?b=2&a=1')
    })

    it('SMART_NORMALIZE_CONFIG keeps fragment and custom ports, strips trailing slash + www', () => {
      // Used by the 'smart' import strategy. Preserves fragments so users
      // can search by `hash:`; preserves ports so authenticated hosts match.
      const out = normalizeUrl('https://www.example.com:8080/path/#frag', SMART_NORMALIZE_CONFIG)
      expect(out).toBe('https://example.com:8080/path#frag')
    })
  })

  describe('malformed input', () => {
    it('returns the input unchanged when new URL(...) throws', () => {
      const bad = 'not-a-url'
      expect(normalizeUrl(bad, { ...ALL_OFF, removeWww: true })).toBe(bad)
    })
  })
})

describe('extractDomain', () => {
  it('returns the hostname verbatim (does NOT strip www)', () => {
    // extractDomain uses URL.hostname, which preserves the `www.` prefix.
    expect(extractDomain('https://www.example.com/path')).toBe('www.example.com')
  })

  it('returns the hostname without port — URL.hostname excludes port', () => {
    // Spec claimed 'example.com:8080' but `URL.hostname` returns 'example.com'
    // for that input (port lives on URL.port / URL.host). Pinning actual
    // behavior; the spec note was incorrect.
    expect(extractDomain('https://example.com:8080/')).toBe('example.com')
  })

  it('returns empty string for malformed URL', () => {
    expect(extractDomain('not-a-url')).toBe('')
  })
})
```

- [ ] **Step 2: Run the tests**

```bash
pnpm --filter service test src/lib/url/normalize.test.ts
```

Expected: `Tests  15 passed (15)`.

If the `extractDomain` port test fails with `Expected: 'example.com' Received: 'example.com:8080'`, the implementation has switched from `URL.hostname` to `URL.host`. Update the test to match — this is pinning current behavior, not asserting desired behavior.

If the `SMART_NORMALIZE_CONFIG` test fails, double-check the expected string: smart **does not** strip fragment, **does not** strip non-default port, **does** strip trailing slash and www.

- [ ] **Step 3: Commit**

```bash
git add apps/service/src/lib/url/normalize.test.ts
git commit -m "$(cat <<'EOF'
test(url): cover normalizeUrl per-flag and extractDomain

15 cases: 9 per-flag isolation tests (one flag on at a time against
ALL_OFF base), DEFAULT_NORMALIZE_CONFIG and SMART_NORMALIZE_CONFIG
combos, malformed-input fallback. extractDomain pins the
URL.hostname-excludes-port behavior (spec note was incorrect).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `url/parse-search-query.ts` tests (14 cases)

**Files:**
- Create: `apps/service/src/lib/url/parse-search-query.test.ts`

**Interfaces:**
- Consumes: `parseSearchQuery(raw: string): ParsedSearchQuery`, `stringifySearchQuery(parsed: ParsedSearchQuery): string`, and the `PREFIXES` constant from `./parse-search-query`.
- `ParsedSearchQuery` shape: `{ prefixed: Partial<Record<'host'|'path'|'search'|'hash', string[]>>; bare: string[] }`.
- Grammar: unknown prefixes (e.g. `foo:bar`) and empty-value prefixes (e.g. `host:`) fall through to `bare`. Whitespace is collapsed.

- [ ] **Step 1: Write the test file**

Create `apps/service/src/lib/url/parse-search-query.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseSearchQuery, stringifySearchQuery, PREFIXES } from './parse-search-query'

describe('parseSearchQuery', () => {
  it('returns an empty structure for the empty string', () => {
    expect(parseSearchQuery('')).toEqual({ prefixed: {}, bare: [] })
  })

  it('returns an empty structure for whitespace-only input', () => {
    expect(parseSearchQuery('   ')).toEqual({ prefixed: {}, bare: [] })
  })

  it('parses all-bare tokens into the bare list', () => {
    expect(parseSearchQuery('foo bar baz')).toEqual({
      prefixed: {},
      bare: ['foo', 'bar', 'baz'],
    })
  })

  it('parses all-prefixed tokens into the prefixed map', () => {
    expect(parseSearchQuery('host:foo path:bar')).toEqual({
      prefixed: { host: ['foo'], path: ['bar'] },
      bare: [],
    })
  })

  it('handles a mix of bare and prefixed tokens', () => {
    expect(parseSearchQuery('host:foo bar')).toEqual({
      prefixed: { host: ['foo'] },
      bare: ['bar'],
    })
  })

  it('OR-semantics: repeating the same prefix collects values into one array', () => {
    expect(parseSearchQuery('host:a host:b')).toEqual({
      prefixed: { host: ['a', 'b'] },
      bare: [],
    })
  })

  it('AND-semantics: different prefixes populate separate keys', () => {
    expect(parseSearchQuery('host:a path:b search:c')).toEqual({
      prefixed: { host: ['a'], path: ['b'], search: ['c'] },
      bare: [],
    })
  })

  it('treats an unrecognized prefix (foo:bar) as a bare token', () => {
    expect(parseSearchQuery('foo:bar')).toEqual({
      prefixed: {},
      bare: ['foo:bar'],
    })
  })

  it('treats an empty value after the colon (host:) as a bare token (mid-typing behavior)', () => {
    // Without this, the UI checkbox would flicker as the user types `host:foo`.
    expect(parseSearchQuery('host:')).toEqual({
      prefixed: {},
      bare: ['host:'],
    })
  })

  it('lowercases the prefix — HOST:foo is treated as host:foo', () => {
    expect(parseSearchQuery('HOST:foo')).toEqual({
      prefixed: { host: ['foo'] },
      bare: [],
    })
  })

  it('collapses multiple whitespace characters between tokens', () => {
    expect(parseSearchQuery('foo   bar')).toEqual({
      prefixed: {},
      bare: ['foo', 'bar'],
    })
  })
})

describe('stringifySearchQuery', () => {
  it('round-trips a canonical query through parseSearchQuery then stringifySearchQuery', () => {
    const canonical = 'host:foo path:bar baz'
    expect(stringifySearchQuery(parseSearchQuery(canonical))).toBe(canonical)
  })

  it('emits prefixed terms first (in PREFIXES order: host, path, search, hash), then bare terms', () => {
    // Input order is search, host, path, bare — round-trip reorders to PREFIXES order.
    const parsed = parseSearchQuery('search:c host:a path:b bare')
    expect(stringifySearchQuery(parsed)).toBe('host:a path:b search:c bare')
    // Sanity: PREFIXES order is exactly host, path, search, hash.
    expect(PREFIXES).toEqual(['host', 'path', 'search', 'hash'])
  })

  it('returns empty string for an empty parsed structure', () => {
    expect(stringifySearchQuery({ prefixed: {}, bare: [] })).toBe('')
  })
})
```

- [ ] **Step 2: Run the tests**

```bash
pnpm --filter service test src/lib/url/parse-search-query.test.ts
```

Expected: `Tests  14 passed (14)`.

- [ ] **Step 3: Commit**

```bash
git add apps/service/src/lib/url/parse-search-query.test.ts
git commit -m "$(cat <<'EOF'
test(url): cover parseSearchQuery and stringifySearchQuery

14 cases: empty/whitespace input, all-bare/all-prefixed/mixed parsing,
OR vs AND semantics for repeated vs distinct prefixes, unknown-prefix
fallthrough, empty-value fallthrough (mid-typing), case-insensitive
prefix, whitespace collapsing, round-trip property, PREFIXES-order
emission, empty-input stringification.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `import/parse.ts` tests (17 cases)

**Files:**
- Create: `apps/service/src/lib/import/parse.test.ts`

**Interfaces:**
- Consumes from `./parse`:
  - `DEFAULT_NORMALIZE_CONFIG`, `SMART_NORMALIZE_CONFIG` (also used in Task 7 — same constants)
  - `validateImportLinks(links: Link[]): { valid: Link[]; invalid: string[] }`
  - `filterAgainstExisting(links: Link[], existing: Set<string>, strategy: ImportStrategy): Link[]`
  - `prepareUrlRecord(link: Link, strategy: ImportStrategy, sourceType: ImportType, order: number, sourceFile?: string): typeof linksTable.$inferInsert`
- `Link` shape (from `../url/extract`): `{ url: string; title: string; source?: string }`
- `ImportStrategy`: `'strict' | 'normalized' | 'smart'`
- `ImportType`: `'TXT' | 'JSON'`
- The D2 invariant: `prepareUrlRecord` extracts URL components (`domain`, `urlPath`, `urlQuery`, `urlHash`) from `originalUrl`, NOT from `normalizedUrl`. The `removeFragment` and `removeWww` flags would otherwise silently break `hash:` and `host:www.example.com` search.

**Note on `uuid`:** `prepareUrlRecord` calls `uuidv4()` for the `id` field. Tests do not mock this — they assert structural shape (`typeof result.id === 'string'` and `result.id.length === 36`) rather than a specific value.

- [ ] **Step 1: Write the test file**

Create `apps/service/src/lib/import/parse.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_NORMALIZE_CONFIG,
  SMART_NORMALIZE_CONFIG,
  validateImportLinks,
  filterAgainstExisting,
  prepareUrlRecord,
} from './parse'
import type { Link } from '../url/extract'

// Helper: build a Link with defaults, overriding only the fields a test cares about.
function link(partial: Partial<Link>): Link {
  return { url: '', title: '', ...partial }
}

describe('filterAgainstExisting', () => {
  it('passes every link through when existing is empty (order preserved)', () => {
    const links = [
      link({ url: 'https://a.com/' }),
      link({ url: 'https://b.com/' }),
    ]
    const result = filterAgainstExisting(links, new Set(), 'normalized')
    expect(result.map((l) => l.url)).toEqual(['https://a.com/', 'https://b.com/'])
  })

  it('drops every link when existing contains all normalized URLs', () => {
    const links = [
      link({ url: 'https://a.com/' }),
      link({ url: 'https://b.com/' }),
    ]
    // Both normalize to themselves under DEFAULT (no trailing slash becomes stripped).
    const existing = new Set(['https://a.com', 'https://b.com'])
    const result = filterAgainstExisting(links, existing, 'normalized')
    expect(result).toEqual([])
  })

  it('keeps only non-matching links on partial overlap (order preserved)', () => {
    const links = [
      link({ url: 'https://a.com/' }),
      link({ url: 'https://b.com/' }),
      link({ url: 'https://c.com/' }),
    ]
    const existing = new Set(['https://b.com'])
    const result = filterAgainstExisting(links, existing, 'normalized')
    expect(result.map((l) => l.url)).toEqual(['https://a.com/', 'https://c.com/'])
  })

  it('strategy mismatch — filter under "smart" does not match URLs stored under "normalized"', () => {
    // This pins the documented footgun (spec: import/parse.ts test plan).
    // URL with fragment: 'normalized' strips it, 'smart' keeps it.
    // So a URL filtered under 'smart' against an existing-set built under
    // 'normalized' will escape the filter.
    const links = [link({ url: 'https://example.com/path#frag' })]
    const existingUnderNormalized = new Set(['https://example.com/path']) // fragment stripped
    const result = filterAgainstExisting(links, existingUnderNormalized, 'smart')
    // Under 'smart', the link's normalizedUrl is 'https://example.com/path#frag'
    // (fragment kept), which is NOT in the existing set built under 'normalized'.
    expect(result).toHaveLength(1)
  })

  it('strategy match — filter under "normalized" against existing built under "normalized" matches correctly', () => {
    const links = [link({ url: 'https://example.com/path#frag' })]
    const existing = new Set(['https://example.com/path']) // fragment stripped, matches
    const result = filterAgainstExisting(links, existing, 'normalized')
    expect(result).toEqual([])
  })

  it('"strict" strategy uses the raw URL string for membership check', () => {
    const links = [link({ url: 'https://example.com/path' })]
    const existing = new Set(['https://example.com/path'])
    expect(filterAgainstExisting(links, existing, 'strict')).toEqual([])
    // Strict does no normalization — a trailing slash differs from no trailing slash.
    const links2 = [link({ url: 'https://example.com/path/' })]
    expect(filterAgainstExisting(links2, existing, 'strict')).toEqual(links2)
  })
})

describe('prepareUrlRecord', () => {
  it('"strict" strategy sets normalizedUrl equal to originalUrl', () => {
    const record = prepareUrlRecord(link({ url: 'https://example.com/path' }), 'strict', 'TXT', 0)
    expect(record.normalizedUrl).toBe('https://example.com/path')
    expect(record.originalUrl).toBe('https://example.com/path')
  })

  it('"normalized" strategy applies DEFAULT_NORMALIZE_CONFIG', () => {
    const record = prepareUrlRecord(
      link({ url: 'https://www.example.com:443/path/#frag' }),
      'normalized',
      'TXT',
      0,
    )
    // DEFAULT strips www, default port, trailing slash, fragment.
    expect(record.normalizedUrl).toBe('https://example.com/path')
  })

  it('"smart" strategy applies SMART_NORMALIZE_CONFIG (keeps fragment and custom port)', () => {
    const record = prepareUrlRecord(
      link({ url: 'https://www.example.com:8080/path/#frag' }),
      'smart',
      'TXT',
      0,
    )
    expect(record.normalizedUrl).toBe('https://example.com:8080/path#frag')
  })

  it('populates sourceFile when passed; leaves it undefined when omitted', () => {
    const withFile = prepareUrlRecord(link({ url: 'https://a.com/' }), 'strict', 'TXT', 0, 'file.txt')
    expect(withFile.sourceFile).toBe('file.txt')
    const without = prepareUrlRecord(link({ url: 'https://a.com/' }), 'strict', 'TXT', 0)
    expect(without.sourceFile).toBeUndefined()
  })

  it('extracts URL components from originalUrl, NOT from normalizedUrl (D2 invariant)', () => {
    // Under 'normalized' strategy, normalizedUrl strips fragment + www + trailing slash.
    // The component columns must still reflect the ORIGINAL URL.
    const record = prepareUrlRecord(
      link({ url: 'https://www.example.com/path/?q=1#section' }),
      'normalized',
      'TXT',
      0,
    )
    expect(record.normalizedUrl).toBe('https://example.com/path?q=1') // stripped
    // Components from originalUrl:
    expect(record.domain).toBe('www.example.com') // NOT stripped
    expect(record.urlPath).toBe('/path/')
    expect(record.urlQuery).toBe('q=1')
    expect(record.urlHash).toBe('section') // NOT stripped — `hash:` search still works
  })

  it('falls back gracefully for malformed URLs (component columns undefined, record still produced)', () => {
    // extractDomain returns '' on parse failure; the try/catch around `new URL`
    // leaves urlPath/urlQuery/urlHash undefined.
    const record = prepareUrlRecord(link({ url: 'not-a-url' }), 'normalized', 'TXT', 0)
    expect(record.domain).toBe('')
    expect(record.urlPath).toBeUndefined()
    expect(record.urlQuery).toBeUndefined()
    expect(record.urlHash).toBeUndefined()
    // Record is still produced (returned with originalUrl as-is):
    expect(record.originalUrl).toBe('not-a-url')
    expect(record.normalizedUrl).toBe('not-a-url') // normalizeUrl also returns input on parse failure
  })

  it('carries title through from link.title, defaulting to empty string when undefined', () => {
    const withTitle = prepareUrlRecord(link({ url: 'https://a.com/', title: 'Hello' }), 'strict', 'TXT', 0)
    expect(withTitle.title).toBe('Hello')
    const nullTitle = prepareUrlRecord(link({ url: 'https://a.com/', title: '' }), 'strict', 'TXT', 0)
    expect(nullTitle.title).toBe('')
  })

  it('sets sourceOrder to the passed order value', () => {
    const r0 = prepareUrlRecord(link({ url: 'https://a.com/' }), 'strict', 'TXT', 0)
    const r42 = prepareUrlRecord(link({ url: 'https://a.com/' }), 'strict', 'TXT', 42)
    expect(r0.sourceOrder).toBe(0)
    expect(r42.sourceOrder).toBe(42)
  })

  it('generates a uuid v4 id for each record', () => {
    const r = prepareUrlRecord(link({ url: 'https://a.com/' }), 'strict', 'TXT', 0)
    // v4 uuid: 36 chars including 4 hyphens, version digit '4' at position 14.
    expect(r.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

describe('validateImportLinks', () => {
  it('returns all links in `valid` when every URL is well-formed', () => {
    const links = [link({ url: 'https://a.com/' }), link({ url: 'https://b.com/' })]
    const { valid, invalid } = validateImportLinks(links)
    expect(valid).toEqual(links)
    expect(invalid).toEqual([])
  })

  it('returns all URLs in `invalid` when every URL fails validation', () => {
    const links = [link({ url: 'not-a-url' }), link({ url: '://' })]
    const { valid, invalid } = validateImportLinks(links)
    expect(valid).toEqual([])
    expect(invalid).toEqual(['not-a-url', '://'])
  })

  it('partitions mixed valid/invalid links and preserves order in each bucket', () => {
    const links = [
      link({ url: 'https://a.com/' }),
      link({ url: 'not-a-url' }),
      link({ url: 'https://b.com/' }),
      link({ url: '://' }),
    ]
    const { valid, invalid } = validateImportLinks(links)
    expect(valid.map((l) => l.url)).toEqual(['https://a.com/', 'https://b.com/'])
    expect(invalid).toEqual(['not-a-url', '://'])
  })
})
```

- [ ] **Step 2: Run the tests**

```bash
pnpm --filter service test src/lib/import/parse.test.ts
```

Expected: `Tests  17 passed (17)`.

Highest-value tests in this file:
- **"strategy mismatch"** — pins the documented footgun. If a future change makes the filter strategy-agnostic, this test fails and surfaces the change.
- **"D2 invariant"** — pins that URL components come from `originalUrl`. If someone refactors `prepareUrlRecord` to read from `normalizedUrl`, the `urlHash === 'section'` assertion fails.
- **"malformed URLs"** — pins the catch-branch fallback.

- [ ] **Step 3: Commit**

```bash
git add apps/service/src/lib/import/parse.test.ts
git commit -m "$(cat <<'EOF'
test(import): cover filterAgainstExisting, prepareUrlRecord, validateImportLinks

17 cases: filterAgainstExisting (empty/all/partial/strategy-mismatch/
strategy-match/strict), prepareUrlRecord (per-strategy normalization,
sourceFile presence, D2-originalUrl invariant, malformed fallback,
title carry-through, sourceOrder, uuid shape), validateImportLinks
(all-valid/all-invalid/mixed order preservation).

The strategy-mismatch and D2-invariant tests pin documented behavior
that is easy to break in a refactor.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Full-suite verification

**Files:** None (verification only).

- [ ] **Step 1: Run the entire suite from repo root**

```bash
pnpm test
```

Expected: `Test Files  8 passed (8)`, `Tests  87 passed (87)` (or close — count is 3+6+9+13+10+15+14+17 = 87).

- [ ] **Step 2: Confirm watch mode also works**

```bash
pnpm --filter service test:watch
```

Then press `q` to exit. This is a smoke check that `vitest` (no `run` arg) starts watch mode without config errors.

- [ ] **Step 3: No commit** — no changes to commit at this stage. If you got here, the round is complete.

---

## Follow-ups (out of scope here, tracked in the design doc)

- DB-layer integration tests using `:memory:` libsql — highest-value target: `db/queries.ts` `buildAdvancedConditions` and the parse pipeline regression guard.
- React component tests — requires `jsdom` + `@testing-library/react`.
- CI workflow (`.github/workflows/test.yml`) running `pnpm test` + `tsc --noEmit` + `biome check`.
- The 8 manual e2e tasks from `reparse-updated-files`.
