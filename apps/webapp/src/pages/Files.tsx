import {
  ActionIcon,
  Alert,
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
  ScrollArea,
  SegmentedControl,
  Stack,
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
        </Tabs.List>

        <Tabs.Panel value="sources">
          <SourcesTab />
        </Tabs.Panel>

        <Tabs.Panel value="resolved">
          <ResolvedTab />
        </Tabs.Panel>
      </Tabs>
    </Container>
  )
}

function SourcesTab() {
  const [files, setFiles] = useState<Array<{ filename: string; size: number; modifiedAt: string }>>(
    [],
  )
  const [selected, setSelected] = useState<string | null>(null)
  const [allLines, setAllLines] = useState<string[]>([])
  const [loadingFiles, setLoadingFiles] = useState(true)
  const [loadingContent, setLoadingContent] = useState(false)
  const [contentError, setContentError] = useState('')
  const [importOpened, { open: openImport, close: closeImport }] = useDisclosure(false)
  const confirmDlg = useConfirm()

  const fetchFiles = useCallback(async () => {
    setLoadingFiles(true)
    try {
      const data = await trpc.files.list.query()
      setFiles(data)
    } catch {
      /* ignore */
    } finally {
      setLoadingFiles(false)
    }
  }, [])

  useEffect(() => {
    fetchFiles()
  }, [fetchFiles])

  const loadFileContent = useCallback(async (filename: string) => {
    setSelected(filename)
    setLoadingContent(true)
    setContentError('')
    setAllLines([])
    try {
      const data = await trpc.files.getContent.query({ filename })
      setAllLines(data.content.split('\n'))
    } catch (err) {
      console.error('[files] load error:', err)
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
    fetchFiles()
  }

  const handleImportDone = () => {
    closeImport()
    fetchFiles()
  }

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
                {files.map((f) => (
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
                      <Box style={{ flex: 1, minWidth: 0 }}>
                        <Text size="sm" fw={500} truncate>
                          {f.filename}
                        </Text>
                        <Group gap="xs">
                          <Text size="xs" c="dimmed">
                            {formatSize(f.size)}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {new Date(f.modifiedAt).toLocaleString()}
                          </Text>
                        </Group>
                      </Box>
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
                ))}
              </Stack>
            </ScrollArea.Autosize>
          </Card>

          {/* Right: file content */}
          <Card withBorder p={0} style={{ flex: 1, minWidth: 0 }}>
            {!selected ? (
              <Text c="dimmed" ta="center" py="xl">
                Select a file to view its content
              </Text>
            ) : loadingContent ? (
              <Box
                py="xl"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <Loader />
              </Box>
            ) : contentError ? (
              <Text c="red" ta="center" py="xl">
                {contentError}
              </Text>
            ) : (
              <VirtualLineViewer lines={allLines} filename={selected} />
            )}
          </Card>
        </Group>
      )}
    </>
  )
}

function ImportModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [fileContent, setFileContent] = useState('')
  const [fileType, setFileType] = useState<'TXT' | 'JSON'>('TXT')
  const [isImporting, setIsImporting] = useState(false)
  const [result, setResult] = useState<{
    importedCount: number
    invalid: string[]
  } | null>(null)
  const [error, setError] = useState('')

  const resetRef = useRef<() => void>(null)

  const reset = useCallback(() => {
    setFile(null)
    setFileContent('')
    setError('')
    setResult(null)
    setFileType('TXT')
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
    setResult(null)

    const ext = selected.name.split('.').pop()
    if (ext === 'json') {
      setFileType('JSON')
    } else {
      setFileType('TXT')
    }
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
      setResult(null)
      setFileContent(text)
      const trimmed = text.trim()
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        setFileType('JSON')
      } else {
        setFileType('TXT')
      }
    } catch {
      setError('Failed to read from clipboard')
    }
  }

  const handleImport = async () => {
    if (!fileContent) return
    setIsImporting(true)
    setError('')
    setResult(null)

    try {
      const res = await trpc.import.create.mutate({
        type: fileType,
        content: fileContent,
        strategy: 'normalized',
        filename: file?.name || undefined,
      })
      setResult({ importedCount: res.importedCount, invalid: res.invalid })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <Modal opened={opened} onClose={handleClose} title="Import Links" size="lg">
      <Stack gap="md">
        <Card withBorder>
          <Text fw={500}>Select File or Paste</Text>
          <Text size="sm" c="dimmed">
            Upload .txt/.json file or paste content from clipboard
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

        <Card withBorder>
          <Text fw={500}>File Type</Text>
          <SegmentedControl
            value={fileType}
            onChange={(v) => setFileType(v as 'TXT' | 'JSON')}
            data={['TXT', 'JSON']}
          />
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
                {fileContent.split('\n').filter(Boolean).length} lines, {fileContent.length}{' '}
                characters
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

        {result && (
          <Alert color="green" title="Import Successful!">
            <Text size="sm">Imported: {result.importedCount} links</Text>
            {result.invalid.length > 0 && <Text size="sm">Invalid: {result.invalid.length}</Text>}
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
      const data = await trpc.files.resolved.query({ limit: PAGE_SIZE, offset })
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

  if (lastVisibleIndex >= urls.length - 20 && urls.length < total && !loadingMore && !loadingTriggered.current) {
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
        <Box style={{ height: urls.length * 22, width: '100%', position: 'relative' }}>
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
          <Text size="sm" fw={500} truncate>
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
          height: `calc(100vh - 260px)`,
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
