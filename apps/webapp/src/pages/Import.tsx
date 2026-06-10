import {
  Alert,
  Box,
  Button,
  Card,
  Code,
  Container,
  Divider,
  FileInput,
  Group,
  SegmentedControl,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core'
import { useRef, useState } from 'react'

import { trpc } from '../utils/trpc-client'

export function ImportPage() {
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

  const handleFileSelect = async (file: File | null) => {
    if (!file) return
    setFile(file)
    setError('')
    setResult(null)

    const ext = file.name.split('.').pop()
    if (ext === 'json') {
      setFileType('JSON')
    } else {
      setFileType('TXT')
    }
    try {
      const text = await file.text()
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
      console.error('[import] full error:', err)
      if (err instanceof Error) {
        console.error('[import] error name:', err.name)
        console.error('[import] error message:', err.message)
        console.error('[import] error stack:', err.stack)
        // Try to extract tRPC details
        const anyErr = err as unknown as Record<string, unknown>
        if (anyErr.cause) console.error('[import] cause:', JSON.stringify(anyErr.cause, null, 2))
        if (anyErr.data) console.error('[import] data:', JSON.stringify(anyErr.data, null, 2))
        if (anyErr.shape) console.error('[import] shape:', JSON.stringify(anyErr.shape, null, 2))
      }
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <Container strategy="grid" size="sm" styles={{ root: { gap: 'var(--mantine-spacing-xs)' } }}>
      <Box h={50}>
        <Title order={2}>Import Links</Title>
      </Box>

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
          onChange={(v) => setFileType(v)}
          data={['TXT', 'JSON']}
        />
      </Card>

      {fileContent && (
        <Card withBorder>
          <Group justify="space-between" mb="xs">
            <Text fw={500}>Content Preview</Text>
            <UnstyledButton
              onClick={() => {
                setFile(null)
                setFileContent('')
                setError('')
                setResult(null)
                resetRef.current?.()
              }}
            >
              Clear
            </UnstyledButton>
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
          <div>
            <p>Imported: {result.importedCount} links</p>
            {result.invalid.length > 0 && <p>Invalid: {result.invalid.length}</p>}
          </div>
        </Alert>
      )}
    </Container>
  )
}
