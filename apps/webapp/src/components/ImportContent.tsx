import { Button, Card, Code, Divider, FileInput, Group, Stack, Text, UnstyledButton } from '@mantine/core'
import { useCallback, useRef, useState } from 'react'

interface UseImportInputResult {
  file: File | null
  fileContent: string
  error: string
  resetRef: React.MutableRefObject<(() => void) | null>
  handleFileSelect: (file: File | null) => void
  handlePasteFromClipboard: () => void
  reset: () => void
  setFile: React.Dispatch<React.SetStateAction<File | null>>
  setFileContent: React.Dispatch<React.SetStateAction<string>>
  setError: React.Dispatch<React.SetStateAction<string>>
}

export function useImportInput(): UseImportInputResult {
  const [file, setFile] = useState<File | null>(null)
  const [fileContent, setFileContent] = useState('')
  const [error, setError] = useState('')
  const resetRef = useRef<(() => void) | null>(null)

  const reset = useCallback(() => {
    setFile(null)
    setFileContent('')
    setError('')
    resetRef.current?.()
  }, [])

  const handleFileSelect = useCallback(async (selected: File | null) => {
    if (!selected) return
    setFile(selected)
    setError('')
    try {
      const text = await selected.text()
      setFileContent(text)
    } catch {
      setError('Failed to read file')
    }
  }, [])

  const handlePasteFromClipboard = useCallback(async () => {
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
  }, [])

  return {
    file,
    fileContent,
    error,
    resetRef,
    handleFileSelect,
    handlePasteFromClipboard,
    reset,
    setFile,
    setFileContent,
    setError,
  }
}

interface FileInputCardProps {
  resetRef: React.MutableRefObject<(() => void) | null>
  onFileSelect: (file: File | null) => void
  onPasteFromClipboard: () => void
  description?: string
}

export function FileInputCard({
  resetRef,
  onFileSelect,
  onPasteFromClipboard,
  description = 'Upload .txt/.json file or paste content from clipboard',
}: FileInputCardProps) {
  return (
    <Card withBorder>
      <Text fw={500}>Select File or Paste</Text>
      <Text size="sm" c="dimmed">
        {description}
      </Text>
      <Stack mt="xs">
        <FileInput
          resetRef={resetRef}
          accept=".txt,.json"
          placeholder="Select file..."
          onChange={onFileSelect}
        />
        <Divider label="OR" />
        <Button onClick={onPasteFromClipboard}>Paste from Clipboard</Button>
      </Stack>
    </Card>
  )
}

interface ContentPreviewCardProps {
  content: string
  onClear: () => void
}

export function ContentPreviewCard({ content, onClear }: ContentPreviewCardProps) {
  return (
    <Card withBorder>
      <Group justify="space-between" mb="xs">
        <Text fw={500}>Content Preview</Text>
        <UnstyledButton onClick={onClear}>Clear</UnstyledButton>
      </Group>
      <Stack>
        <Code block mah="12rem">
          {content.slice(0, 2000)}
          {content.length > 2000 && (
            <Text c="dimmed" size="xs">
              ... ({content.length - 2000} more characters)
            </Text>
          )}
        </Code>
        <Text c="dimmed" size="xs">
          {content.split('\n').filter(Boolean).length} lines, {content.length} characters
        </Text>
      </Stack>
    </Card>
  )
}
