## Why

LinkMan is a link management tool for batch importing, deduplicating, filtering, and testing large sets of URL links. The current codebase has a complete core feature pipeline. This change systematically summarizes and documents the existing functionality specs without introducing any new features.

## What Changes

- No code changes; only produces documented functional specifications (specs)
- Organizes the existing codebase functionality into the following capability domains:
  - Link import and file storage
  - Link deduplication (strict / normalized / smart)
  - Link filtering (internal addresses / similar links)
  - Link availability testing (DNS / HEAD / GET)
  - Operation history and rollback
  - Dashboard
  - Files browser (source files / resolved results)

## Capabilities

### New Capabilities

- `link-import`: Import links from TXT/JSON files or clipboard, supporting strict/normalized/smart dedup strategies, with original content persisted to disk
- `link-dedup`: Preview and execute deduplication on imported links, supporting strict (exact match), normalized (URL normalization match), and smart (heuristic match) strategies with configurable normalization rules
- `link-filter`: Filter internal addresses (private IPs / localhost) and similar links (by domain grouping / path prefix / edit distance), with progressive batch result delivery for similarity detection
- `link-testing`: Test link availability via DNS / HEAD / GET methods, with concurrency and proxy support
- `operation-history`: Record all operations (import/dedup/filter/test/manual operations) with snapshot-based rollback support
- `dashboard`: Dashboard displaying total link count, status distribution, recent operations, and quick navigation
- `files-browser`: Browse imported source file contents and resolved unique URL lists, with virtual scrolling

### Modified Capabilities

None. This change is purely documentary and does not modify existing specs.

## Impact

- Output consists of specification documents under `openspec/changes/codebase-summary/specs/`
- Does not affect any runtime code, APIs, or dependencies
- Can be used for onboarding new team members or as a baseline reference for future feature changes
