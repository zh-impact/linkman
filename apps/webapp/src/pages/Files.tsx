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
import { useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function FilesPage() {
  return (
    <Container strategy="grid" size="lg">
      <Title order={2} mb="md">
        Files
      </Title>

      <Tabs defaultValue="sources">
        <Tabs.List mb="md">
          <Tabs.Tab value="sources">Sources</Tabs.Tab>
          <Tabs.Tab value="resolved">Resolved</Tabs.Tab>
          <Tabs.Tab value="export">Export</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="sources">
          <SourcesTab />
        </Tabs.Panel>

        <Tabs.Panel value="resolved">
          <ResolvedTab />
        </Tabs.Panel>

        <Tabs.Panel value="export">
          <ExportTab />
        </Tabs.Panel>
      </Tabs>
    </Container>
  )
}

function SourcesTab() {
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
      }
    },
    [parseType, parseStrategy, fetchAll],
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
  const isProcessing = status === 'processing'
  const blocked = anyForeground && !foreground

  const buttonLabel = isCompleted
    ? 'Parsed ✓'
    : foreground
      ? 'Parsing…'
      : backgroundRunning
        ? 'Stop'
        : isProcessing && job && job.importedCount > 0
          ? 'Resume'
          : 'Parse'

  const buttonAction = isRunning ? onStop : onParse
  const buttonColor = backgroundRunning ? 'red' : isCompleted ? 'green' : 'blue'

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
              disabled={isCompleted || blocked}
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

function ResolvedTab() {
  const [urls, setUrls] = useState<string[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const fetched = useRef(false)

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

  useEffect(() => {
    if (fetched.current) return
    fetched.current = true
    ;(async () => {
      await fetchPage(0)
      setLoading(false)
    })()
  }, [fetchPage])

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
  const parentRef = useRef<HTMLDivElement>(null)
  const loadingTriggered = useRef(false)

  const virtualizer = useVirtualizer({
    count: urls.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 22,
    overscan: 10,
  })

  const virtualItems = virtualizer.getVirtualItems()
  const lastVisibleIndex = virtualItems.length > 0 ? virtualItems[virtualItems.length - 1].index : 0

  if (
    lastVisibleIndex >= urls.length - 20 &&
    urls.length < total &&
    !loadingMore &&
    !loadingTriggered.current
  ) {
    loadingTriggered.current = true
    onLoadMore()
  }

  if (!loadingMore) {
    loadingTriggered.current = false
  }

  return (
    <>
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
      <Box
        ref={parentRef}
        style={{
          height: `calc(100vh - 260px)`,
          overflow: 'auto',
        }}
      >
        <Box
          style={{
            height: urls.length * 22,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualItems.map((item) => {
            const url = urls[item.index]
            return (
              <Box
                key={item.key}
                style={{
                  position: 'absolute',
                  top: item.start,
                  left: 0,
                  right: 0,
                  height: 22,
                  display: 'flex',
                  fontFamily: 'var(--mantine-font-family-monospace)',
                  fontSize: 'var(--mantine-font-size-xs)',
                  lineHeight: '22px',
                }}
              >
                <Text
                  c="dimmed"
                  ta="right"
                  w={60}
                  px="xs"
                  style={{
                    flexShrink: 0,
                    userSelect: 'none',
                    borderRight: '1px solid var(--mantine-color-gray-2)',
                  }}
                >
                  {item.index + 1}
                </Text>
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
              </Box>
            )
          })}
        </Box>
      </Box>
    </>
  )
}

function VirtualLineViewer({ lines, filename }: { lines: string[]; filename: string }) {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 22,
    overscan: 20,
  })

  const totalHeight = useMemo(() => lines.length * 22, [lines.length])

  return (
    <>
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
      <Box
        ref={parentRef}
        style={{
          height: `calc(100vh - 320px)`,
          overflow: 'auto',
        }}
      >
        <Box style={{ height: totalHeight, width: '100%', position: 'relative' }}>
          {virtualizer.getVirtualItems().map((virtualItem) => (
            <Box
              key={virtualItem.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: 22,
                transform: `translateY(${virtualItem.index * 22}px)`,
                display: 'flex',
                fontFamily: 'var(--mantine-font-family-monospace)',
                fontSize: 'var(--mantine-font-size-xs)',
                lineHeight: '22px',
              }}
            >
              <Text
                c="dimmed"
                ta="right"
                w={60}
                px="xs"
                style={{
                  flexShrink: 0,
                  userSelect: 'none',
                  borderRight: '1px solid var(--mantine-color-gray-2)',
                }}
              >
                {virtualItem.index + 1}
              </Text>
              <Text
                px="xs"
                style={{
                  flex: 1,
                  whiteSpace: 'pre',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {lines[virtualItem.index] ?? ''}
              </Text>
            </Box>
          ))}
        </Box>
      </Box>
    </>
  )
}
