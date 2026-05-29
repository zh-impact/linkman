import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// Links table
export const linksTable = sqliteTable(
  'links',
  {
    id: text('id').primaryKey(),
    originalUrl: text('original_url').notNull(),
    normalizedUrl: text('normalized_url').notNull(),
    domain: text('domain').notNull(),
    title: text('title'),
    source: text('source', { enum: ['TXT', 'JSON'] }).notNull(),
    sourceOrder: integer('source_order').notNull(),
    status: text('status', {
      enum: [
        'pending',
        'imported',
        'duplicate_removed',
        'filtered_internal',
        'filtered_similar',
        'dns_failed',
        'connection_refused',
        'timeout',
        'success',
        'error',
      ],
    })
      .notNull()
      .default('pending'),
    tags: text('tags').notNull().default('[]'),
    isInternal: integer('is_internal', { mode: 'boolean' }).notNull().default(false),
    similarityGroup: text('similarity_group'),
    duplicateOf: text('duplicate_of'),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    index('idx_links_status').on(table.status),
    index('idx_links_domain').on(table.domain),
    index('idx_links_normalized_url').on(table.normalizedUrl),
    index('idx_links_similarity_group').on(table.similarityGroup),
    index('idx_links_duplicate_of').on(table.duplicateOf),
    index('idx_links_created_at').on(table.createdAt),
  ],
)

// Test results table
export const testResults = sqliteTable(
  'test_results',
  {
    id: text('id').primaryKey(),
    linkId: text('link_id')
      .notNull()
      .references(() => linksTable.id, { onDelete: 'cascade' }),
    method: text('method', { enum: ['dns', 'head', 'get'] }).notNull(),
    status: text('status', { enum: ['pending', 'running', 'success', 'failed'] })
      .notNull()
      .default('pending'),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),
    error: text('error'),
    responseTime: integer('response_time'),
    statusCode: integer('status_code'),
    contentType: text('content_type'),
    contentLength: integer('content_length'),
    proxyConfig: text('proxy_config'),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    index('idx_test_results_link_id').on(table.linkId),
    index('idx_test_results_method').on(table.method),
    index('idx_test_results_status').on(table.status),
  ],
)

// Import jobs table
export const importJobs = sqliteTable(
  'import_jobs',
  {
    id: text('id').primaryKey(),
    type: text('type', { enum: ['TXT', 'JSON'] }).notNull(),
    sourceContent: text('source_content').notNull(),
    strategy: text('strategy', { enum: ['strict', 'normalized', 'smart'] }).notNull(),
    status: text('status', { enum: ['pending', 'processing', 'completed', 'failed'] })
      .notNull()
      .default('pending'),
    importedCount: integer('imported_count').notNull().default(0),
    duplicateCount: integer('duplicate_count').notNull().default(0),
    errorCount: integer('error_count').notNull().default(0),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    completedAt: text('completed_at'),
  },
  (table) => [
    index('idx_import_jobs_status').on(table.status),
    index('idx_import_jobs_created_at').on(table.createdAt),
  ],
)

// Test jobs table
export const testJobs = sqliteTable(
  'test_jobs',
  {
    id: text('id').primaryKey(),
    linkIds: text('link_ids').notNull(),
    method: text('method', { enum: ['dns', 'head', 'get'] }).notNull(),
    concurrency: integer('concurrency').notNull().default(10),
    proxyConfig: text('proxy_config'),
    status: text('status', { enum: ['pending', 'running', 'completed', 'paused', 'failed'] })
      .notNull()
      .default('pending'),
    progressTotal: integer('progress_total').notNull().default(0),
    progressCompleted: integer('progress_completed').notNull().default(0),
    progressFailed: integer('progress_failed').notNull().default(0),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),
  },
  (table) => [
    index('idx_test_jobs_status').on(table.status),
    index('idx_test_jobs_created_at').on(table.createdAt),
  ],
)

// Operations table
export const operations = sqliteTable(
  'operations',
  {
    id: text('id').primaryKey(),
    type: text('type', {
      enum: [
        'import',
        'deduplicate',
        'filter_internal',
        'filter_similar',
        'test_dns',
        'test_head',
        'test_get',
        'manual_tag',
        'manual_delete',
        'rollback',
      ],
    }).notNull(),
    jobId: text('job_id').references(() => importJobs.id, { onDelete: 'set null' }),
    timestamp: text('timestamp').notNull().default(sql`(datetime('now'))`),
    beforeSnapshotHash: text('before_snapshot_hash').notNull(),
    afterSnapshotHash: text('after_snapshot_hash').notNull(),
    changesAdded: text('changes_added').notNull().default('[]'),
    changesRemoved: text('changes_removed').notNull().default('[]'),
    changesModified: text('changes_modified').notNull().default('[]'),
    statsInputCount: integer('stats_input_count').notNull().default(0),
    statsOutputCount: integer('stats_output_count').notNull().default(0),
    statsDuplicateCount: integer('stats_duplicate_count'),
    statsErrorCount: integer('stats_error_count').notNull().default(0),
    errors: text('errors').notNull().default('[]'),
    warnings: text('warnings').notNull().default('[]'),
  },
  (table) => [
    index('idx_operations_type').on(table.type),
    index('idx_operations_timestamp').on(table.timestamp),
    index('idx_operations_job_id').on(table.jobId),
  ],
)

// Snapshots table
export const snapshots = sqliteTable(
  'snapshots',
  {
    id: text('id').primaryKey(),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    linkIds: text('link_ids').notNull(),
    checksum: text('checksum').notNull(),
  },
  (table) => [index('idx_snapshots_created_at').on(table.createdAt)],
)
