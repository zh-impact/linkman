import { randomUUID } from 'node:crypto'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import {
  clearAuditHistory,
  clearLinksAndImportJobs,
  countAllImportJobs,
  countAllLinks,
  countAllSnapshots,
  countAllTestResults,
  countDuplicateLinks,
  countInternalLinks,
  countLinksByDomains,
  countTestResultsForDomains,
  countTestResultsForDuplicateLinks,
  countTestResultsForInternalLinks,
  deleteAllLinks,
  deleteDuplicateLinks,
  deleteImportJobsByFilenames,
  deleteInternalLinks,
  deleteLinksByDomains,
  getOperationsCount,
  listDomainsWithCounts,
  sampleAllLinks,
  sampleDuplicateLinks,
  sampleImportJobs,
  sampleInternalLinks,
  sampleLinksByDomains,
  sampleOperations,
  sampleSnapshots,
} from '../lib/db/queries'
import { deleteAllFiles, listAllFilesWithSize } from '../lib/files'
import { publicProcedure, router } from '../trpc'

// ============================================================================
// Token lifecycle
//
// dryRun issues a short-lived token bound to {kind, params}. execute must
// consume that token with the SAME {kind, params} before any delete runs.
// This prevents the "preview A, then execute B" race where the user opens a
// dryRun, changes their selection, and hits execute — the original token no
// longer matches the new params, so it is rejected.
// ============================================================================

const TOKEN_TTL_MS = 5 * 60 * 1000
const TOKEN_SWEEP_MS = 60 * 1000

const pruneKindSchema = z.enum(['duplicate', 'internal', 'by-domain', 'all', 'database', 'files', 'audit'])
type PruneKind = z.infer<typeof pruneKindSchema>

const pruneParamsSchema = z.object({ domains: z.array(z.string()) }).optional()

interface PendingToken {
  kind: PruneKind
  params: { domains?: string[] }
  expiresAt: number
}

const tokens = new Map<string, PendingToken>()

function normalizeParams(input: z.infer<typeof pruneParamsSchema>): { domains?: string[] } {
  if (!input?.domains || input.domains.length === 0) return {}
  return { domains: [...input.domains].sort() }
}

function issueToken(kind: PruneKind, params: z.infer<typeof pruneParamsSchema>): string {
  const token = randomUUID()
  tokens.set(token, { kind, params: normalizeParams(params), expiresAt: Date.now() + TOKEN_TTL_MS })
  return token
}

function consumeToken(token: string, kind: PruneKind, params: z.infer<typeof pruneParamsSchema>): boolean {
  const entry = tokens.get(token)
  if (!entry) return false
  if (entry.expiresAt < Date.now()) {
    tokens.delete(token)
    return false
  }
  if (entry.kind !== kind) return false
  const want = normalizeParams(params)
  const aDoms = entry.params.domains ?? []
  const bDoms = want.domains ?? []
  if (aDoms.length !== bDoms.length) return false
  for (const d of aDoms) {
    if (!bDoms.includes(d)) return false
  }
  tokens.delete(token)
  return true
}

// Sweep expired tokens periodically. `unref` so the timer never keeps Node
// alive on its own.
const sweepInterval = setInterval(() => {
  const now = Date.now()
  for (const [token, entry] of tokens) {
    if (entry.expiresAt < now) tokens.delete(token)
  }
}, TOKEN_SWEEP_MS)
sweepInterval.unref?.()

// ============================================================================
// Procedures
// ============================================================================

export const pruneRouter = router({
  /**
   * Compute counts + sample for the requested kind and issue a confirm token.
   * Does NOT mutate data. The returned token authorizes a single execute of
   * the SAME {kind, params} within 5 minutes.
   */
  dryRun: publicProcedure
    .input(
      z.object({
        kind: pruneKindSchema,
        params: pruneParamsSchema,
      }),
    )
    .mutation(async ({ input }) => {
      const { kind, params } = input

      switch (kind) {
        case 'duplicate': {
          const [count, cascade, sample] = await Promise.all([
            countDuplicateLinks(),
            countTestResultsForDuplicateLinks(),
            sampleDuplicateLinks(),
          ])
          return {
            kind,
            confirmToken: issueToken(kind, params),
            count: count?.count ?? 0,
            cascadeCounts: { testResults: cascade?.count ?? 0 },
            sample,
          }
        }

        case 'internal': {
          const [count, cascade, sample] = await Promise.all([
            countInternalLinks(),
            countTestResultsForInternalLinks(),
            sampleInternalLinks(),
          ])
          return {
            kind,
            confirmToken: issueToken(kind, params),
            count: count?.count ?? 0,
            cascadeCounts: { testResults: cascade?.count ?? 0 },
            sample,
          }
        }

        case 'by-domain': {
          const domains = params?.domains ?? []
          if (domains.length === 0) {
            return {
              kind,
              confirmToken: issueToken(kind, params),
              count: 0,
              cascadeCounts: { testResults: 0 },
              sample: [],
            }
          }
          const [count, cascade, sample] = await Promise.all([
            countLinksByDomains(domains),
            countTestResultsForDomains(domains),
            sampleLinksByDomains(domains),
          ])
          return {
            kind,
            confirmToken: issueToken(kind, params),
            count: count?.count ?? 0,
            cascadeCounts: { testResults: cascade?.count ?? 0 },
            sample,
          }
        }

        case 'all': {
          const [count, cascade, sample] = await Promise.all([
            countAllLinks(),
            countAllTestResults(),
            sampleAllLinks(),
          ])
          return {
            kind,
            confirmToken: issueToken(kind, params),
            count: count?.count ?? 0,
            cascadeCounts: { testResults: cascade?.count ?? 0 },
            sample,
          }
        }

        case 'database': {
          const [linkCount, jobCount, testCount, jobsSample] = await Promise.all([
            countAllLinks(),
            countAllImportJobs(),
            countAllTestResults(),
            sampleImportJobs(),
          ])
          return {
            kind,
            confirmToken: issueToken(kind, params),
            count: linkCount?.count ?? 0,
            jobCount: jobCount?.count ?? 0,
            cascadeCounts: { testResults: testCount?.count ?? 0 },
            sample: jobsSample,
          }
        }

        case 'files': {
          const files = await listAllFilesWithSize()
          const totalSizeBytes = files.reduce((sum, f) => sum + f.size, 0)
          // Alphabetical first 10 — stable ordering independent of mtime.
          const sorted = [...files].sort((a, b) => a.filename.localeCompare(b.filename))
          return {
            kind,
            confirmToken: issueToken(kind, params),
            count: files.length,
            totalSizeBytes,
            cascadeCounts: {},
            sample: sorted.slice(0, 10),
          }
        }

        case 'audit': {
          const [operationCount, snapshotCount, operationsSample, snapshotsSample] = await Promise.all([
            getOperationsCount(),
            countAllSnapshots(),
            sampleOperations(),
            sampleSnapshots(),
          ])
          return {
            kind,
            confirmToken: issueToken(kind, params),
            count: operationCount?.count ?? 0,
            snapshotCount: snapshotCount?.count ?? 0,
            cascadeCounts: {},
            sample: operationsSample,
            snapshotSample: snapshotsSample,
          }
        }
      }
    }),

  /**
   * Run the delete for the requested kind. Requires a valid confirm token
   * issued by dryRun for the SAME {kind, params}. The token is consumed on
   * success — re-executing requires another dryRun.
   */
  execute: publicProcedure
    .input(
      z.object({
        kind: pruneKindSchema,
        params: pruneParamsSchema,
        confirmToken: z.string().uuid(),
      }),
    )
    .mutation(async ({ input }) => {
      const { kind, params, confirmToken } = input

      if (!consumeToken(confirmToken, kind, params)) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message:
            'Invalid, expired, or mismatched confirmation token. Run dry-run again and execute immediately.',
        })
      }

      switch (kind) {
        case 'duplicate': {
          const deletedCount = await deleteDuplicateLinks()
          return { kind, deletedCount }
        }
        case 'internal': {
          const deletedCount = await deleteInternalLinks()
          return { kind, deletedCount }
        }
        case 'by-domain': {
          const deletedCount = await deleteLinksByDomains(params?.domains ?? [])
          return { kind, deletedCount }
        }
        case 'all': {
          const deletedCount = await deleteAllLinks()
          return { kind, deletedCount }
        }
        case 'database': {
          const result = await clearLinksAndImportJobs()
          return { kind, deletedCount: result.linksDeleted, jobsDeleted: result.jobsDeleted }
        }
        case 'files': {
          // Snapshot filenames BEFORE unlinking, then delete matching jobs.
          // File deletes are best-effort and outside the DB transaction —
          // the filesystem is not transactional.
          const files = await listAllFilesWithSize()
          const filenames = files.map((f) => f.filename)
          const { filesDeleted, errors } = await deleteAllFiles()
          const jobsDeleted = await deleteImportJobsByFilenames(filenames)
          return { kind, deletedCount: filesDeleted, jobsDeleted, errors }
        }
        case 'audit': {
          const result = await clearAuditHistory()
          return {
            kind,
            deletedCount: result.operationsDeleted,
            snapshotsDeleted: result.snapshotsDeleted,
          }
        }
      }
    }),

  /**
   * List every distinct domain with its link count. Drives the by-domain
   * virtualized selector in the UI.
   */
  domains: publicProcedure.query(async () => {
    return listDomainsWithCounts()
  }),
})
