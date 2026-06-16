## Context

`pluggable-link-extractors` shipped a registry-based extractor architecture (`apps/service/src/lib/import/extractors/`) but left two loose ends:

1. **Dead-weight parsers**: `apps/service/src/lib/url/extract.ts` still exports `detectFormat` and `parseLinks`. These are no longer on any production path — `routes/import.ts` calls `extractLinks` from the registry. The only remaining consumer is `apps/service/scripts/link.ts`, which duplicates the entire detection + dispatch logic in its own `lineParsers` map. This is a maintenance trap: new formats added to the registry are silently invisible to the CLI.

2. **No browser bookmark format**: The registry covers six formats (`csv`, `pipe`, `dash`, `onetab_ini`, `url_only`, `tablerone_json`, `json_array`) but has no extractor for the **Netscape Bookmark File Format** — the universally-available HTML export produced by Chrome / Firefox / Edge / Safari ("Export Bookmarks…"). Reference implementation: `~/sourcecode/1Playground/AI-workbench/scripts/process_bookmarks.py`.

The prior change deliberately deferred both items. This change closes them out.

## Goals / Non-Goals

**Goals:**
- Support importing browser-exported bookmarks (Netscape HTML) end-to-end, including titles.
- Eliminate the `scripts/link.ts` duplication by routing it onto the registry.
- Remove `detectFormat` and `parseLinks` from `extract.ts` once orphaned.

**Non-Goals:**
- Preserving the per-line `emptyLines` / `skipped` diagnostics that `scripts/link.ts` previously emitted. Those were debug-only; the registry's contract is "return valid links", not "report every malformed line".
- Importing browser bookmark *folders* as a grouping concept. Folder structure (`<H3>Folder Name</H3>`) is flattened — each `<A>` becomes a standalone Link, matching the Python reference and the existing data model which has no `folder` column.
- Validating that an HTML file is *well-formed* XML/HTML. The extractor is intentionally a regex scanner so we never need a DOM dependency.

## Decisions

### D1: Regex-based parser, not a DOM parser

Use `<A\s+HREF="([^"]+)"[^>]*>([^<]*)</A>` with the `gim` flags (matches Python ref `process_bookmarks.py`).

**Why:** Zero new dependencies. Netscape Bookmark Format is strict enough that every browser emits `<DT><A HREF="url" ADD_DATE="...">Title</A>` on a single line; the regex is robust against attribute-order and extra-attribute variations across Chrome/Firefox/Edge/Safari.

**Alternatives considered:**
- `linkedom` / `cheerio`: rejected — full DOM parsers pull a dependency for a format that is, in practice, a flat list of `<A>` tags.
- `node:html/parser` (built-in): Node has no built-in HTML parser.

### D2: Inline HTML-entity decoder

A small replacement map covering `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;`, `&apos;`, `&nbsp;`, plus a regex pass for numeric entities `&#(\d+);` → `String.fromCharCode(Number(...))` and `&#x([0-9a-fA-F]+);` → `String.fromCharCode(parseInt(..., 16))`.

**Why:** Browser-exported titles commonly contain `&amp;` (e.g. "AT&T → "AT&amp;T"). A naive "use the title as-is" approach leaks escaped entities into `linksTable.title`. The map + numeric regex is ~15 lines and covers >99% of real-world cases without pulling `he` / `html-entities`.

**Trade-off:** Will not decode exotic named entities (`&mdash;`, `&hellip;`). Acceptable — those would land as literal text and not corrupt the URL.

### D3: Detection via strong + weak signal

`detect(ctx)` returns true when **either**:
- (Strong) `ctx.content` contains the case-insensitive substring `NETSCAPE-Bookmark` — every browser export has `<!DOCTYPE NETSCAPE-Bookmark-file-1>` on line 1.
- (Weak) The first 10 non-empty lines contain at least one `<DL>` tag AND at least one `<A HREF=` (or `<a href=`) pattern.

**Why both:** The strong signal alone misses cases where a user has stripped the DOCTYPE (e.g. pasted into a markdown file). The weak signal alone risks false positives on a plain URL list that happens to mention HTML-like syntax. Requiring both `<DL>` and `<A HREF=` in the same sniff window keeps the false-positive rate negligible.

### D4: Registry slot — between `dash` and `url_only`

Insert `bookmarksHtmlExtractor` at index 5 (after `dashExtractor`, before `urlOnlyExtractor`). New TXT branch order:

```
csv → onetab_ini → pipe → dash → bookmarks_html → url_only (fallback)
```

**Why this position:**
- Must come **before `url_only`**: HTML files contain URLs and would otherwise be misclassified as a plain URL list, losing every title.
- Must come **after `pipe` / `dash` / `onetab_ini`**: those formats are syntactically impossible inside a Netscape bookmark file (no `<A HREF>` line will contain ` | ` or ` - http`).
- `csv` is extension-gated to `.csv` only, so no conflict.

**Determinism note:** Inserting into the registry does not break the resume-after-restart contract because the contract is "same `(type, content, filename)` triple → same `links` ordering". A new format simply means files that previously fell through to `url_only` now resolve to `bookmarks_html` — which is fine because such files were never previously stored, so there is no in-flight job to corrupt.

### D5: `scripts/link.ts` rewrite onto `extractLinks`

Replace `processFile` internals with a single call:
```ts
const { links, detectedFormat } = extractLinks(content, 'TXT', filepath)
```

Keep: `dedup()`, file/directory traversal, `--output` flag, console reporting.

Drop: `lineParsers` map, `detectFormat`/`parseLinks` imports, `emptyLines`/`skipped` arrays in `FileResult`.

**Why:** Removes the duplication that motivated this cleanup. CLI output becomes format-agnostic: "Format: X, Links: N" instead of per-line diagnostics. The CLI was always a debugging tool, not a production path.

### D6: Delete `detectFormat` and `parseLinks` from `extract.ts`

After D5, `grep -r 'detectFormat\|parseLinks' apps/` returns no hits. Delete both functions. Keep all line-level parsers (`extractUrlOnly`, `extractUrlTitlePipe`, `parseTitleUrlDash`, `parseOnetabIni`, `parseCsvContent`, `parseTableroneJson`, `parseJsonArray`) since the extractor modules consume them.

### D7: `import.ensureJob` — recoverability for orphaned files

Add a new mutation `import.ensureJob({ filename, type?, strategy? })` that:

1. Looks up an existing job by `source_content = filename` via a new `getImportJobByFilename` query. If found, returns it (any status — pending, processing, completed — so the caller can route to the appropriate Parse/Resume/Parsed-✓ UI).
2. If no job exists, calls `readFile(filename)` to verify the file is actually on disk. `readFile` throws on ENOENT, which we translate to a `NOT_FOUND` TRPCError — preventing the creation of a job that `parse.start` could never fulfil.
3. Auto-infers `type` from the filename extension (`.json` → JSON, else TXT), matching `import.create`. Defaults `strategy` to `'normalized'`.
4. Inserts a pending job and returns it.

The Files toolbar's `onParse` handler calls `ensureJob` first when `selectedJob` is null, then chains into the existing `runParse(jobId)` flow.

**Why a separate mutation instead of folding into `parse.start`:** `parse.start` is keyed by `jobId` and its contract is "begin parsing for this job". Mixing in "create a job if missing" muddies that contract and forces every caller to think about both code paths. `ensureJob` is a single-purpose resolver that returns a stable `jobId`, after which all existing parse flow code is unchanged.

**Why idempotent:** the frontend fires `ensureJob` once per click, but rapid double-clicks or a stale `selectedJob` could otherwise cause duplicates. Returning the existing job on a second call means the operation is safe to retry.

**Why file-existence-validated:** without the check, a typo'd filename or a deleted file would silently create a pending job that the user can never complete. The check makes the failure mode loud and immediate.

**Alternatives considered:**
- *Auto-create in `parse.start`*: rejected for the contract-pollution reason above.
- *Show a UI error and ask the user to re-import*: rejected because re-import would either duplicate the file on disk or require deduplication logic that's worse than just creating the missing job.
- *Garbage-collect orphaned files on startup*: rejected — too magical. Some orphans may be intentional staging; the user should decide via the Files UI.

## Risks / Trade-offs

- **Regex can be fooled by attribute order variations** → Mitigation: `[^>]*` is intentionally permissive between `HREF="..."` and the closing `>`. Tested against real Chrome, Firefox, and Safari exports in the Python reference.
- **Numeric entity decoder may emit garbage on out-of-range codepoints** (e.g. `&#999999999;`) → Mitigation: guard with `codePoint <= 0x10FFFF` and fall through to literal text otherwise. Cost is one extra `if` per match.
- **Detection false-positive on a Markdown file with embedded HTML** → Mitigation: the weak signal requires *both* `<DL>` and `<A HREF=` in the first 10 non-empty lines. A Markdown file with embedded bookmarks is, by definition, a bookmarks file — accepting it is correct behavior.
- **`scripts/link.ts` loses `emptyLines` / `skipped` output** → Mitigation: none, accepted. The CLI's value post-cleanup is "what format did the registry detect and how many links came out", not "what lines failed". If detailed debugging is needed in the future, add a separate `--debug` flag that re-parses with line numbers.
- **Removing `detectFormat` / `parseLinks` could break external consumers** → Mitigation: `apps/` is the only consumer surface in this monorepo; verified by grep. External repos are out of scope.
- **`ensureJob` race: two concurrent calls for the same orphan filename could create two jobs** → Mitigation: the UI fires it from a single button click; double-click protection is left to the existing `foregroundJob` / `backgroundJobs` state in `runParse` which disables the button once parsing starts. Acceptable residual risk for a single-user dev tool.
- **`ensureJob` creates jobs for typo'd filenames if the file happens to exist** → Mitigation: the lookup is by exact `source_content` match, so a typo would only collide with an identically-named file (a non-issue). The file-existence check prevents the more dangerous case of creating a job for a non-existent file.
