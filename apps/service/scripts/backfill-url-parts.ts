/**
 * One-time backfill: populate `url_path` / `url_query` / `url_hash` on
 * pre-existing rows from `originalUrl`.
 *
 * Run after deploying the schema migration that added the three columns
 * (drizzle/0001_typical_morlun.sql). Idempotent: re-running only UPDATEs rows
 * where at least one column still differs from the computed value, so a second
 * run after a successful first run is a no-op (rowsAffected == 0 for every
 * batch). Optional `--dry-run` prints the affected count without writing.
 *
 * Source is `originalUrl`, NOT `normalizedUrl` — the default normalization
 * pipeline strips fragment (`removeFragment`), `www.` host prefix
 * (`removeWww`), and trailing slashes (`removeTrailingSlash`). Extracting
 * from `normalizedUrl` would silently break `hash:` search and
 * `host:www.example.com` queries. See design D2.
 *
 * Usage:
 *   pnpm exec tsx scripts/backfill-url-parts.ts [--dry-run] [--batch-size=1000]
 */
import { program } from 'commander'
import { sql } from 'drizzle-orm'

import { db } from '../src/lib/db/client'
import { linksTable } from '../src/lib/db/schema'

interface UrlParts {
  urlPath: string | null
  urlQuery: string | null
  urlHash: string | null
}

/** Parse `originalUrl` into path/query/hash. Returns nulls on parse failure. */
function extractUrlParts(originalUrl: string): UrlParts {
  try {
    const parsed = new URL(originalUrl)
    return {
      urlPath: parsed.pathname || null,
      urlQuery: parsed.search ? parsed.search.slice(1) : null,
      urlHash: parsed.hash ? parsed.hash.slice(1) : null,
    }
  } catch {
    return { urlPath: null, urlQuery: null, urlHash: null }
  }
}

program
  .option('--dry-run', 'Print affected counts without writing UPDATEs')
  .option('--batch-size <n>', 'Rows per batch (default 1000)', '1000')
  .action(async (opts: { dryRun?: boolean; batchSize: string }) => {
    const batchSize = Number.parseInt(opts.batchSize, 10)
    if (!Number.isFinite(batchSize) || batchSize < 1) {
      console.error(`Invalid --batch-size: ${opts.batchSize}`)
      process.exit(1)
    }

    console.log(
      `Backfilling url_path/url_query/url_hash from original_url ` +
        `(batch=${batchSize}${opts.dryRun ? ', dry-run' : ''})`,
    )

    // Id-paginated scan: read each batch, compute new values, UPDATE only rows
    // where at least one column differs. We re-read every row's existing
    // values to make the diff decision; for a fully-backfilled DB this is
    // cheap (just a SELECT) and avoids pointless writes on re-runs.
    let lastId: string | undefined
    let scanned = 0
    let wouldUpdate = 0
    let wouldNull = 0
    let updated = 0

    while (true) {
      const page = lastId
        ? await db
            .select({
              id: linksTable.id,
              originalUrl: linksTable.originalUrl,
              urlPath: linksTable.urlPath,
              urlQuery: linksTable.urlQuery,
              urlHash: linksTable.urlHash,
            })
            .from(linksTable)
            .where(sql`${linksTable.id} > ${lastId}`)
            .orderBy(linksTable.id)
            .limit(batchSize)
            .all()
        : await db
            .select({
              id: linksTable.id,
              originalUrl: linksTable.originalUrl,
              urlPath: linksTable.urlPath,
              urlQuery: linksTable.urlQuery,
              urlHash: linksTable.urlHash,
            })
            .from(linksTable)
            .orderBy(linksTable.id)
            .limit(batchSize)
            .all()

      if (page.length === 0) break
      lastId = page[page.length - 1].id
      scanned += page.length

      const toUpdate: { id: string; parts: UrlParts }[] = []
      for (const row of page) {
        const parts = extractUrlParts(row.originalUrl)
        if (
          parts.urlPath !== row.urlPath ||
          parts.urlQuery !== row.urlQuery ||
          parts.urlHash !== row.urlHash
        ) {
          toUpdate.push({ id: row.id, parts })
          if (parts.urlPath === null && parts.urlQuery === null && parts.urlHash === null) {
            wouldNull++
          } else {
            wouldUpdate++
          }
        }
      }

      if (!opts.dryRun && toUpdate.length > 0) {
        for (const { id, parts } of toUpdate) {
          const result = await db
            .update(linksTable)
            .set({
              urlPath: parts.urlPath,
              urlQuery: parts.urlQuery,
              urlHash: parts.urlHash,
            })
            .where(sql`${linksTable.id} = ${id}`)
            .run()
          updated += result.rowsAffected
        }
      }

      if (page.length < batchSize) break
    }

    if (opts.dryRun) {
      console.log(
        `Scanned ${scanned} rows. Would update ${wouldUpdate} rows with parsed parts; ` +
          `${wouldNull} rows have unparseable original_url (parts set to NULL).`,
      )
    } else {
      console.log(
        `Scanned ${scanned} rows. Updated ${updated} rows ` +
          `(${wouldUpdate} parsed + ${wouldNull} NULL parts).`,
      )
    }
    process.exit(0)
  })

program.parseAsync()
