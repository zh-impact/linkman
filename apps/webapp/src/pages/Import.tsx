import { Alert, Box, Button, Card, Container, SegmentedControl, Text, Title } from '@mantine/core'
import { useState } from 'react'

import { ContentPreviewCard, FileInputCard, useImportInput } from '../components/ImportContent'
import { trpc } from '../utils/trpc-client'

export function ImportPage() {
  const [fileType, setFileType] = useState<'TXT' | 'JSON'>('TXT')
  const [isImporting, setIsImporting] = useState(false)
  const [result, setResult] = useState<{
    importedCount: number
    invalid: string[]
  } | null>(null)

  const {
    file,
    fileContent,
    error: inputError,
    resetRef,
    handleFileSelect,
    handlePasteFromClipboard,
    reset,
    setError: setInputError,
  } = useImportInput()

  const handleFileSelectWithAutoDetect = async (selected: File | null) => {
    if (!selected) return
    const ext = selected.name.split('.').pop()
    if (ext === 'json') setFileType('JSON')
    else setFileType('TXT')
    handleFileSelect(selected)
  }

  const handlePasteWithAutoDetect = async () => {
    handlePasteFromClipboard()
  }

  const handleImport = async () => {
    if (!fileContent) return
    setIsImporting(true)
    setInputError('')
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
        const anyErr = err as unknown as Record<string, unknown>
        if (anyErr.cause) console.error('[import] cause:', JSON.stringify(anyErr.cause, null, 2))
        if (anyErr.data) console.error('[import] data:', JSON.stringify(anyErr.data, null, 2))
        if (anyErr.shape) console.error('[import] shape:', JSON.stringify(anyErr.shape, null, 2))
      }
      setInputError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <Container strategy="grid" size="sm" styles={{ root: { gap: 'var(--mantine-spacing-xs)' } }}>
      <Box h={50}>
        <Title order={2}>Import Links</Title>
      </Box>

      <FileInputCard
        resetRef={resetRef}
        onFileSelect={handleFileSelectWithAutoDetect}
        onPasteFromClipboard={handlePasteWithAutoDetect}
      />

      <Card withBorder>
        <Text fw={500}>File Type</Text>
        <SegmentedControl value={fileType} onChange={(v) => setFileType(v)} data={['TXT', 'JSON']} />
      </Card>

      {fileContent && <ContentPreviewCard content={fileContent} onClear={reset} />}

      <Button loading={isImporting} disabled={!fileContent} onClick={handleImport}>
        Import
      </Button>

      {inputError && (
        <Alert color="red" title="Import Failed">
          {inputError}
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
