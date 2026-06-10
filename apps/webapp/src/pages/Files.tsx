import {
  ActionIcon,
  Box,
  Card,
  Container,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Text,
  Title,
} from '@mantine/core'
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
  const [files, setFiles] = useState<Array<{ filename: string; size: number; modifiedAt: string }>>(
    [],
  )
  const [selected, setSelected] = useState<string | null>(null)
  const [allLines, setAllLines] = useState<string[]>([])
  const [loadingFiles, setLoadingFiles] = useState(true)
  const [loadingContent, setLoadingContent] = useState(false)
  const [contentError, setContentError] = useState('')
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

  return (
    <Container strategy="grid" size="lg">
      {confirmDlg.modal}
      <Title order={2} mb="md">
        Files
      </Title>

      {loadingFiles ? (
        <Loader />
      ) : files.length === 0 ? (
        <Text c="dimmed" ta="center" py="xl">
          No files yet. Import some links first.
        </Text>
      ) : (
        <Group gap="md" wrap="nowrap" align="flex-start">
          {/* Left: file list */}
          <Card withBorder p={0} w={300}>
            <ScrollArea.Autosize mah="calc(100vh - 180px)" offsetScrollbars>
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
              <Box py="xl" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
    </Container>
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
          height: `calc(100vh - 220px)`,
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
