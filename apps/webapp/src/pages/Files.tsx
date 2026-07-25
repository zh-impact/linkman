import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Code,
  Container,
  Divider,
  FileInput,
  Group,
  Loader,
  Modal,
  Progress,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Tabs,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { useCallback, useEffect, useRef, useState } from 'react'
import { VirtualLine, VirtualList } from '../components/VirtualList'
import { formatSize } from '../utils/format'
import { trpc } from '../utils/trpc-client'
import { useConfirm } from '../utils/use-confirm'
import { ExportTab } from './files/ExportTab'

type JobStatus = 'pending' | 'processing' | 'completed' | 'failed'
type JobType = 'TXT' | 'JSON'
type JobStrategy = 'strict' | 'normalized' | 'smart'

interface ImportJobInfo {
  jobId: string
  filename: string
  type: JobType
  strategy: JobStrategy
  status: JobStatus
  importedCount: number
  errorCount: number
  // ISO 8601 file mtime captured at parse.start. Compared against the
  // file list's `modifiedAt` to compute staleness client-side without a
  // server stat() round-trip. NULL until first parse runs.
  fileMtime: string | null
  createdAt: string
}

interface ParseProgress {
  imported: number
  total: number
  error: number
}

interface FileInfo {
  filename: string
  size: number
  modifiedAt: string
}

const statusMeta: Record<JobStatus, { color: string; label: string }> = {
  pending: { color: 'gray', label: 'Pending' },
  processing: { color: 'yellow', label: 'Processing' },
  completed: { color: 'green', label: 'Completed' },
  failed: { color: 'red', label: 'Failed' },
}

export function FilesPage() {
  // Lifted tab state so FilesPage can observe re-entry into 'resolved' and
  // bump a refresh key. Mantine v9 renamed `onTabChange` → `onChange`; the
  // old name silently no-ops, which broke tab switching. useEffect on the
  // active value only fires on actual change — sufficient for "user came
  // back to it".
  const [activeTab, setActiveTab] = useState('sources')
  // Resolved list is stale whenever: (a) user re-enters the Resolved tab,
  // or (b) a parse completes that may have inserted new rows. Both paths
  // bump this key; ResolvedTab's useEffect([refreshKey]) refetches.
  const [resolvedRefreshKey, setResolvedRefreshKey] = useState(0)
  const bumpResolved = useCallback(() => setResolvedRefreshKey((k) => k + 1), [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: bumpResolved is stable
  useEffect(() => {
    if (activeTab === 'resolved') bumpResolved()
  }, [activeTab])

  return (
    <Container strategy="grid" size="lg">
      <Title order={2} mb="md">
        Files
      </Title>

      <Tabs value={activeTab} onChange={(v) => v && setActiveTab(v)}>
        <Tabs.List mb="md">
          <Tabs.Tab value="sources">Sources</Tabs.Tab>
          <Tabs.Tab value="resolved">Resolved</Tabs.Tab>
          <Tabs.Tab value="export">Export</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="sources">
          <SourcesTab onParseComplete={bumpResolved} />
        </Tabs.Panel>

        <Tabs.Panel value="resolved">
          <ResolvedTab refreshKey={resolvedRefreshKey} />
        </Tabs.Panel>

        <Tabs.Panel value="export">
          <ExportTab />
        </Tabs.Panel>
      </Tabs>
    </Container>
  )
}

function SourcesTab({ onParseComplete }: { onParseComplete: () => void }) {
  const [files, setFiles] = useState<FileInfo[]>([])
  const [jobMap, setJobMap] = useState<Map<string, ImportJobInfo>>(new Map())
  const [selected, setSelected] = useState<string | null>(null)
  const [allLines, setAllLines] = useState<string[]>([])
  const [loadingFiles, setLoadingFiles] = useState(true)
  const [loadingContent, setLoadingContent] = useState(false)
  const [contentError, setContentError] = useState('')
  const [importOpened, { open: openImport, close: closeImport }] = useDisclosure(false)
  const confirmDlg = useConfirm()

  // Parse state
  const [progressByJob, setProgressByJob] = useState<Record<string, ParseProgress>>({})
  const [foregroundJob, setForegroundJob] = useState<string | null>(null)
  const [backgroundJobs, setBackgroundJobs] = useState<Set<string>>(new Set())
  const [parseType, setParseType] = useState<JobType>('TXT')
  const [parseStrategy, setParseStrategy] = useState<JobStrategy>('normalized')
  const [background, setBackground] = useState(false)
  const stopRef = useRef<Set<string>>(new Set())

  const fetchAll = useCallback(async () => {
    const [fs, js] = await Promise.all([trpc.files.list.query(), trpc.import.list.query()])
    setFiles(fs as FileInfo[])
    const m = new Map<string, ImportJobInfo>()
    for (const j of js) m.set(j.filename, j as ImportJobInfo)
    setJobMap(m)
  }, [])

  useEffect(() => {
    ;(async () => {
      setLoadingFiles(true)
      try {
        await fetchAll()
      } catch {
        /* ignore */
      } finally {
        setLoadingFiles(false)
      }
    })()
  }, [fetchAll])

  const selectedJob = selected ? (jobMap.get(selected) ?? null) : null
  // Stale = file mtime changed since the job's stored fileMtime. Derived from
  // already-fetched `files` + `jobMap` so it stays in sync on every refetch
  // (parse completion, manual refresh, etc.). Only meaningful for completed
  // jobs — pending/processing jobs always show their existing button label.
  //
  // No `fileMtime !== null` guard: a legacy completed job (fileMtime NULL
  // from pre-deploy) is stale by definition — any ISO string !== null.
  // Spec: link-parse "Re-parse a completed job whose file has changed".
  const selectedFile = selected ? (files.find((f) => f.filename === selected) ?? null) : null
  const selectedStale =
    selectedJob !== null &&
    selectedJob.status === 'completed' &&
    selectedFile !== null &&
    selectedFile.modifiedAt !== selectedJob.fileMtime

  // Sync type/strategy defaults when selection changes.
  // selectedJob is derived from selected + jobMap; depending only on `selected`
  // ties the sync to file selection rather than jobMap refetches, so a parse
  // completion (which refreshes jobMap) won't clobber the user's toolbar overrides.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional narrowing
  useEffect(() => {
    if (selectedJob) {
      setParseType(selectedJob.type)
      setParseStrategy(selectedJob.strategy)
    }
  }, [selected])

  const loadFileContent = useCallback(async (filename: string) => {
    setSelected(filename)
    setLoadingContent(true)
    setContentError('')
    setAllLines([])
    try {
      const data = await trpc.files.getContent.query({ filename })
      setAllLines(data.content.split('\n'))
    } catch (err) {
      setContentError(err instanceof Error ? err.message : 'Failed to load file')
      setAllLines([])
    } finally {
      setLoadingContent(false)
    }
  }, [])

  const handleDelete = async (filename: string) => {
    const ok = await confirmDlg.confirm({
      title: 'Confirm Delete',
      message: `Delete "${filename}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      confirmColor: 'red',
    })
    if (!ok) return
    await trpc.files.delete.mutate({ filename })
    if (selected === filename) {
      setSelected(null)
      setAllLines([])
    }
    fetchAll()
  }

  const handleImportDone = () => {
    closeImport()
    fetchAll()
  }

  const runParse = useCallback(
    async (jobId: string, opts: { background: boolean }) => {
      const isBg = opts.background
      if (isBg) setBackgroundJobs((prev) => new Set(prev).add(jobId))
      else setForegroundJob(jobId)
      stopRef.current.delete(jobId)
      try {
        const startRes = await trpc.import.parse.start.mutate({
          jobId,
          type: parseType,
          strategy: parseStrategy,
        })
        setProgressByJob((prev) => ({
          ...prev,
          [jobId]: {
            imported: 0,
            total: startRes.totalValid,
            error: startRes.invalidCount,
          },
        }))
        while (true) {
          if (stopRef.current.has(jobId)) break
          const b = await trpc.import.parse.batch.mutate({ jobId })
          setProgressByJob((prev) => ({
            ...prev,
            [jobId]: {
              imported: b.importedCount,
              total: b.totalValid,
              error: b.errorCount,
            },
          }))
          if (b.done) break
        }
      } catch (err) {
        setContentError(err instanceof Error ? err.message : 'Parse failed')
      } finally {
        if (isBg) setBackgroundJobs((prev) => setWithout(prev, jobId))
        else setForegroundJob(null)
        // Clear progress a moment after completion so the dot can take over
        setProgressByJob((prev) => {
          if (!stopRef.current.has(jobId)) {
            const next = { ...prev }
            delete next[jobId]
            return next
          }
          return prev
        })
        fetchAll()
        // Notify parent so the Resolved tab knows to refetch on next visit
        // (or right now if it's mounted). Both first-parse and re-parse can
        // have added rows to the links table; a no-op refresh is cheap.
        onParseComplete()
      }
    },
    [parseType, parseStrategy, fetchAll, onParseComplete],
  )

  return (
    <>
      {confirmDlg.modal}
      <ImportModal opened={importOpened} onClose={handleImportDone} />
      <Group mb="md">
        <Button onClick={openImport}>Import</Button>
      </Group>

      {loadingFiles ? (
        <Loader />
      ) : files.length === 0 ? (
        <Text c="dimmed" ta="center" py="xl">
          No files yet. Click Import to get started.
        </Text>
      ) : (
        <Group gap="md" wrap="nowrap" align="flex-start">
          {/* Left: file list */}
          <Card withBorder p={0} w={300}>
            <ScrollArea.Autosize mah="calc(100vh - 280px)" offsetScrollbars>
              <Stack gap={0}>
                {files.map((f) => {
                  const job = jobMap.get(f.filename) ?? null
                  const meta = job ? statusMeta[job.status] : null
                  return (
                    <Box
                      key={f.filename}
                      onClick={() => loadFileContent(f.filename)}
                      p="sm"
                      bg={selected === f.filename ? 'var(--mantine-color-blue-light)' : undefined}
                      style={{
                        borderBottom: '1px solid var(--mantine-color-gray-2)',
                        width: '100%',
                        cursor: 'pointer',
                      }}
                    >
                      <Group justify="space-between" wrap="nowrap">
                        <Group gap="xs" wrap="nowrap">
                          {meta && (
                            <Box
                              title={meta.label}
                              style={{
                                width: 9,
                                height: 9,
                                borderRadius: '50%',
                                flexShrink: 0,
                                background: `var(--mantine-color-${meta.color}-6)`,
                              }}
                            />
                          )}
                          <Box style={{ flex: 1, minWidth: 0 }}>
                            <Text size="sm" fw={500} truncate>
                              {f.filename}
                            </Text>
                            <Group gap="xs">
                              <Text size="xs" c="dimmed">
                                {formatSize(f.size)}
                              </Text>
                              {job && job.status === 'completed' && (
                                <Text size="xs" c="dimmed">
                                  · {job.importedCount} links
                                </Text>
                              )}
                              {job && job.status === 'processing' && (
                                <Text size="xs" c="dimmed">
                                  · {job.importedCount} parsed
                                </Text>
                              )}
                            </Group>
                          </Box>
                        </Group>
                        <ActionIcon
                          size="xs"
                          variant="subtle"
                          color="red"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDelete(f.filename)
                          }}
                          title="Delete"
                        >
                          ✕
                        </ActionIcon>
                      </Group>
                    </Box>
                  )
                })}
              </Stack>
            </ScrollArea.Autosize>
          </Card>

          {/* Right: parse toolbar + file content */}
          <Card withBorder p={0} style={{ flex: 1, minWidth: 0 }}>
            {!selected ? (
              <Text c="dimmed" ta="center" py="xl">
                Select a file to view its content
              </Text>
            ) : (
              <Stack gap={0}>
                <ParseToolbar
                  job={selectedJob}
                  stale={selectedStale}
                  progress={selectedJob ? (progressByJob[selectedJob.jobId] ?? null) : null}
                  foreground={foregroundJob === (selectedJob?.jobId ?? '')}
                  backgroundRunning={selectedJob ? backgroundJobs.has(selectedJob.jobId) : false}
                  anyForeground={foregroundJob !== null}
                  parseType={parseType}
                  parseStrategy={parseStrategy}
                  background={background}
                  contentError={contentError}
                  onTypeChange={setParseType}
                  onStrategyChange={setParseStrategy}
                  onBackgroundChange={setBackground}
                  onParse={async () => {
                    if (!selected) return
                    let jobId = selectedJob?.jobId
                    if (!jobId) {
                      // File on disk has no import_job (orphaned). Auto-create
                      // one so the Parse button is always recoverable.
                      try {
                        const res = await trpc.import.ensureJob.mutate({
                          filename: selected,
                          type: parseType,
                          strategy: parseStrategy,
                        })
                        jobId = res.jobId
                        // Refresh jobMap so the toolbar reflects the new job
                        // (status badge, completion dot, etc.) without waiting
                        // for the post-parse fetchAll.
                        fetchAll()
                      } catch (err) {
                        setContentError(err instanceof Error ? err.message : 'Failed to create job')
                        return
                      }
                    }
                    if (jobId) runParse(jobId, { background })
                  }}
                  onStop={() => {
                    if (!selectedJob) return
                    stopRef.current.add(selectedJob.jobId)
                  }}
                />
                <Divider />
                <Box style={{ flex: 1, minHeight: 0 }}>
                  {loadingContent ? (
                    <Box py="xl" style={{ display: 'flex', justifyContent: 'center' }}>
                      <Loader />
                    </Box>
                  ) : contentError && !selectedJob ? (
                    <Text c="red" ta="center" py="xl">
                      {contentError}
                    </Text>
                  ) : (
                    <VirtualLineViewer lines={allLines} filename={selected} />
                  )}
                </Box>
              </Stack>
            )}
          </Card>
        </Group>
      )}
    </>
  )
}

function setWithout(prev: Set<string>, id: string): Set<string> {
  const next = new Set(prev)
  next.delete(id)
  return next
}

function ParseToolbar({
  job,
  stale,
  progress,
  foreground,
  backgroundRunning,
  anyForeground,
  parseType,
  parseStrategy,
  background,
  contentError,
  onTypeChange,
  onStrategyChange,
  onBackgroundChange,
  onParse,
  onStop,
}: {
  job: ImportJobInfo | null
  stale: boolean
  progress: ParseProgress | null
  foreground: boolean
  backgroundRunning: boolean
  anyForeground: boolean
  parseType: JobType
  parseStrategy: JobStrategy
  background: boolean
  contentError: string
  onTypeChange: (v: JobType) => void
  onStrategyChange: (v: JobStrategy) => void
  onBackgroundChange: (v: boolean) => void
  onParse: () => void
  onStop: () => void
}) {
  const isRunning = foreground || backgroundRunning
  const status = job?.status
  const isCompleted = status === 'completed'
  // A completed-and-stale job offers Re-parse: the file changed since the
  // stored fileMtime, so the user has new URLs to pick up. Per design D3/D6,
  // re-parse must reuse the original type/strategy, so the selectors stay
  // disabled even when stale-completed (no override allowed).
  const isStaleCompleted = isCompleted && stale
  const isProcessing = status === 'processing'
  const blocked = anyForeground && !foreground

  const buttonLabel = isStaleCompleted
    ? 'Re-parse'
    : isCompleted
      ? 'Parsed ✓'
      : foreground
        ? 'Parsing…'
        : backgroundRunning
          ? 'Stop'
          : isProcessing && job && job.importedCount > 0
            ? 'Resume'
            : 'Parse'

  const buttonAction = isRunning ? onStop : onParse
  // Stale-completed is actionable (blue); clean-completed is done (green).
  const buttonColor = backgroundRunning ? 'red' : isStaleCompleted ? 'blue' : isCompleted ? 'green' : 'blue'

  return (
    <Box px="md" py="sm">
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            {job && (
              <Badge color={statusMeta[job.status].color} variant="light">
                {statusMeta[job.status].label}
              </Badge>
            )}
          </Group>
          <Group gap="xs" wrap="nowrap">
            <SegmentedControl
              size="xs"
              // Selectors disabled whenever the user can't override the parse:
              // running, blocked by another foreground parse, completed.
              // Stale-completed is still "completed" for the selectors —
              // re-parse must reuse the original type/strategy.
              disabled={isCompleted || isRunning || blocked}
              value={parseType}
              onChange={(v) => onTypeChange(v as JobType)}
              data={['TXT', 'JSON']}
            />
            <Select
              size="xs"
              w={130}
              disabled={isCompleted || isRunning || blocked}
              value={parseStrategy}
              onChange={(v) => v && onStrategyChange(v as JobStrategy)}
              data={[
                { value: 'strict', label: 'Strict' },
                { value: 'normalized', label: 'Normalized' },
                { value: 'smart', label: 'Smart' },
              ]}
            />
            <Switch
              size="xs"
              label="Background"
              disabled={isCompleted || isRunning || blocked}
              checked={background}
              onChange={(e) => onBackgroundChange(e.currentTarget.checked)}
            />
            <Button
              size="xs"
              color={buttonColor}
              loading={foreground}
              // Only stale-completed unlocks the button; clean-completed
              // stays disabled ("Parsed ✓" terminal state).
              disabled={(isCompleted && !stale) || blocked}
              onClick={buttonAction}
            >
              {buttonLabel}
            </Button>
          </Group>
        </Group>

        {progress && (
          <Group gap="sm" align="center">
            <Progress
              value={progress.total > 0 ? (progress.imported / progress.total) * 100 : 0}
              size="sm"
              style={{ flex: 1 }}
              color={isCompleted ? 'green' : 'blue'}
            />
            <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
              {progress.imported.toLocaleString()} / {progress.total.toLocaleString()}
              {progress.error > 0 && ` · invalid: ${progress.error}`}
            </Text>
          </Group>
        )}

        {contentError && (
          <Text size="xs" c="red">
            {contentError}
          </Text>
        )}
      </Stack>
    </Box>
  )
}

function ImportModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [fileContent, setFileContent] = useState('')
  const [isImporting, setIsImporting] = useState(false)
  const [error, setError] = useState('')

  const resetRef = useRef<() => void>(null)

  const reset = useCallback(() => {
    setFile(null)
    setFileContent('')
    setError('')
    resetRef.current?.()
  }, [])

  const handleClose = () => {
    reset()
    onClose()
  }

  const handleFileSelect = async (selected: File | null) => {
    if (!selected) return
    setFile(selected)
    setError('')
    try {
      const text = await selected.text()
      setFileContent(text)
    } catch {
      setError('Failed to read file')
    }
  }

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (!text.trim()) {
        setError('Clipboard is empty')
        return
      }
      setError('')
      setFileContent(text)
    } catch {
      setError('Failed to read from clipboard')
    }
  }

  const handleImport = async () => {
    if (!fileContent) return
    setIsImporting(true)
    setError('')
    try {
      await trpc.import.create.mutate({
        content: fileContent,
        filename: file?.name || undefined,
      })
      handleClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <Modal opened={opened} onClose={handleClose} title="Import Source File" size="lg">
      <Stack gap="md">
        <Card withBorder>
          <Text fw={500}>Select File or Paste</Text>
          <Text size="sm" c="dimmed">
            Save a .txt/.json file or clipboard content. Parsing happens later from the Files toolbar.
          </Text>
          <Stack mt="xs">
            <FileInput
              resetRef={resetRef}
              accept=".txt,.json"
              placeholder="Select file..."
              value={file}
              onChange={handleFileSelect}
            />
            <Divider label="OR" />
            <Button onClick={handlePasteFromClipboard}>Paste from Clipboard</Button>
          </Stack>
        </Card>

        {fileContent && (
          <Card withBorder>
            <Group justify="space-between" mb="xs">
              <Text fw={500}>Content Preview</Text>
              <UnstyledButton onClick={reset}>Clear</UnstyledButton>
            </Group>
            <Stack>
              <Code block mah="12rem">
                {fileContent.slice(0, 2000)}
                {fileContent.length > 2000 && (
                  <Text c="dimmed" size="xs">
                    ... ({fileContent.length - 2000} more characters)
                  </Text>
                )}
              </Code>
              <Text c="dimmed" size="xs">
                {fileContent.split('\n').filter(Boolean).length} lines, {fileContent.length} characters
              </Text>
            </Stack>
          </Card>
        )}

        <Button loading={isImporting} disabled={!fileContent} onClick={handleImport}>
          Import
        </Button>

        {error && (
          <Alert color="red" title="Import Failed">
            {error}
          </Alert>
        )}
      </Stack>
    </Modal>
  )
}

const PAGE_SIZE = 500

function ResolvedTab({ refreshKey }: { refreshKey: number }) {
  const [urls, setUrls] = useState<string[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')

  const fetchPage = useCallback(async (offset: number) => {
    try {
      const data = await trpc.files.resolved.query({
        limit: PAGE_SIZE,
        offset,
      })
      if (offset === 0) {
        setUrls(data.urls)
        setTotal(data.total)
      } else {
        setUrls((prev) => [...prev, ...data.urls])
      }
      return data.urls.length
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load resolved links')
      return 0
    }
  }, [])

  // Refetch page 0 whenever the refresh key changes. Two trigger paths
  // bump it (see FilesPage): user re-enters the Resolved tab, or a parse
  // completes. Replacing the prior useRef one-shot guard — that pattern
  // never refetched, so the Resolved list stayed stale after re-parse.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is a prop (new value per render), not an outer-scope value — biome's static analyzer misclassifies it
  useEffect(() => {
    let cancelled = false
    setUrls([])
    setTotal(0)
    setError('')
    setLoading(true)
    ;(async () => {
      await fetchPage(0)
      if (cancelled) return
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [refreshKey, fetchPage])

  const loadMore = useCallback(async () => {
    if (loadingMore || urls.length >= total) return
    setLoadingMore(true)
    await fetchPage(urls.length)
    setLoadingMore(false)
  }, [loadingMore, urls.length, total, fetchPage])

  if (loading) return <Loader />
  if (error) {
    return (
      <Text c="red" ta="center" py="xl">
        {error}
      </Text>
    )
  }

  return (
    <Card withBorder p={0}>
      <ResolvedLineViewer urls={urls} total={total} onLoadMore={loadMore} loadingMore={loadingMore} />
    </Card>
  )
}

function ResolvedLineViewer({
  urls,
  total,
  onLoadMore,
  loadingMore,
}: {
  urls: string[]
  total: number
  onLoadMore: () => void
  loadingMore: boolean
}) {
  return (
    <VirtualList
      items={urls}
      rowHeight={22}
      overscan={10}
      scrollHeight={`calc(100vh - 260px)`}
      total={total}
      onLoadMore={onLoadMore}
      loadingMore={loadingMore}
      header={
        <Box px="md" py="xs" style={{ borderBottom: '1px solid var(--mantine-color-gray-2)' }}>
          <Group justify="space-between">
            <Text size="sm" fw={500}>
              Resolved unique URLs
            </Text>
            <Group gap="xs">
              {loadingMore && <Loader size="xs" />}
              <Text size="xs" c="dimmed">
                {urls.length.toLocaleString()} / {total.toLocaleString()}
              </Text>
            </Group>
          </Group>
        </Box>
      }
      renderItem={(url, idx) => (
        <VirtualLine index={idx} showLineNumbers>
          <Text
            component="a"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            c="blue"
            td="underline"
            px="xs"
            style={{
              flex: 1,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {url}
          </Text>
        </VirtualLine>
      )}
    />
  )
}

function VirtualLineViewer({ lines, filename }: { lines: string[]; filename: string }) {
  return (
    <VirtualList
      items={lines}
      rowHeight={22}
      overscan={20}
      scrollHeight={`calc(100vh - 320px)`}
      header={
        <Box px="md" py="xs" style={{ borderBottom: '1px solid var(--mantine-color-gray-2)' }}>
          <Group justify="space-between">
            <Text size="xs" c="dimmed" truncate>
              {filename}
            </Text>
            <Text size="xs" c="dimmed">
              {lines.length.toLocaleString()} lines
            </Text>
          </Group>
        </Box>
      }
      renderItem={(line, idx) => (
        <VirtualLine index={idx} showLineNumbers>
          <Text
            px="xs"
            style={{
              flex: 1,
              whiteSpace: 'pre',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {line}
          </Text>
        </VirtualLine>
      )}
    />
  )
}
