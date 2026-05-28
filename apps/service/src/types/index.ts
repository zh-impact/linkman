// Database types
export type LinkStatus =
  | 'pending'
  | 'imported'
  | 'duplicate_removed'
  | 'filtered_internal'
  | 'filtered_similar'
  | 'dns_failed'
  | 'connection_refused'
  | 'timeout'
  | 'success'
  | 'error'

export type LinkSource = 'txt' | 'json'

export type TestMethod = 'dns' | 'head' | 'get'

export type TestResultStatus = 'pending' | 'running' | 'success' | 'failed'

export type ImportStrategy = 'strict' | 'normalized' | 'smart'

export type ImportJobStatus = 'pending' | 'processing' | 'completed' | 'failed'

export type TestJobStatus = 'pending' | 'running' | 'completed' | 'paused' | 'failed'

export type OperationType =
  | 'import'
  | 'deduplicate'
  | 'filter_internal'
  | 'filter_similar'
  | 'test_dns'
  | 'test_head'
  | 'test_get'
  | 'manual_tag'
  | 'manual_delete'
  | 'rollback'

// Database entities
export interface Link {
  id: string
  originalUrl: string
  normalizedUrl: string
  domain: string
  title?: string
  source: LinkSource
  sourceOrder: number
  status: LinkStatus
  tags: string[]
  isInternal: boolean
  similarityGroup?: string
  duplicateOf?: string
  createdAt: Date
  updatedAt: Date
}

export interface TestResult {
  id: string
  linkId: string
  method: TestMethod
  status: TestResultStatus
  startedAt?: Date
  completedAt?: Date
  error?: string
  responseTime?: number // milliseconds
  statusCode?: number
  contentType?: string
  contentLength?: number
  proxyConfig?: ProxyConfig
}

export interface ImportJob {
  id: string
  type: LinkSource
  sourceContent: string
  strategy: ImportStrategy
  status: ImportJobStatus
  importedCount: number
  duplicateCount: number
  errorCount: number
  createdAt: Date
  completedAt?: Date
}

export interface TestJob {
  id: string
  linkIds: string[]
  method: TestMethod
  concurrency: number
  proxyConfig?: ProxyConfig
  status: TestJobStatus
  progress: {
    total: number
    completed: number
    failed: number
  }
  createdAt: Date
  startedAt?: Date
  completedAt?: Date
}

export interface Operation {
  id: string
  type: OperationType
  jobId?: string
  timestamp: Date
  beforeSnapshot: SnapshotHash
  afterSnapshot: SnapshotHash
  changes: {
    added: string[]
    removed: string[]
    modified: Array<{
      id: string
      changes: Record<string, { before: any; after: any }>
    }>
  }
  stats: {
    inputCount: number
    outputCount: number
    duplicateCount?: number
    errorCount: number
  }
  errors: Array<{ message: string; linkId?: string }>
  warnings: Array<{ message: string; linkId?: string }>
}

export interface Snapshot {
  id: string
  createdAt: Date
  linkIds: string[]
  checksum: string
}

export interface SnapshotHash {
  hash: string
  linkStates: Record<string, string>
  timestamp: Date
}

// Configuration types
export interface NormalizeConfig {
  forceHttps: boolean
  removeWww: boolean
  removeTrailingSlash: boolean
  removeDefaultPort: boolean
  sortQueryParams: boolean
  removeFragment: boolean
}

export interface SimilarityLayer {
  layer: number
  method: 'domain' | 'path_prefix' | 'edit_distance'
  threshold?: number
}

export interface SimilarityStrategy {
  enabled: boolean
  methods: {
    byDomain: boolean
    byPathPrefix: boolean
    byPathDepth: number
    ignoreQueryParams: boolean
    editDistance: boolean
    editDistanceThreshold: number
  }
}

export interface ProxyConfig {
  enabled: boolean
  protocol: 'http' | 'https' | 'socks5'
  host: string
  port: number
  username?: string
  password?: string
}

// API types
export interface ImportRequest {
  type: LinkSource
  content: string
  strategy: ImportStrategy
}

export interface ImportResponse {
  jobId: string
  importId: string
}

export interface DeduplicateRequest {
  linkIds?: string[]
  strategy: ImportStrategy
  normalize?: NormalizeConfig
  sort?: 'original' | 'alphabetical' | 'domain'
}

export interface DeduplicateResponse {
  operationId: string
  duplicateCount: number
  remainingCount: number
}

export interface SimilarityDetectionRequest {
  linkIds?: string[]
  strategy: SimilarityStrategy
}

export interface SimilarityDetectionResponse {
  operationId: string
  groups: Record<string, string[]>
}

export interface FilterRequest {
  linkIds?: string[]
}

export interface FilterResponse {
  operationId: string
  filteredCount: number
  remainingCount: number
}

export interface TestStartRequest {
  linkIds: string[]
  method: TestMethod
  concurrency: number
  proxyConfig?: ProxyConfig
}

export interface TestStartResponse {
  jobId: string
}

// UI types
export interface LinkState {
  links: Link[]
  selectedIds: Set<string>
  filter: {
    status?: LinkStatus[]
    tags?: string[]
    search?: string
  }
  viewMode: 'table' | 'grouped'
  sortBy?: keyof Pick<Link, 'domain' | 'status' | 'createdAt'>
  sortOrder: 'asc' | 'desc'
}

export interface OperationState {
  operations: Operation[]
  selectedOperationId?: string
}

export interface UIState {
  isLoading: boolean
  error?: string
  successMessage?: string
  sidebarOpen: boolean
}
