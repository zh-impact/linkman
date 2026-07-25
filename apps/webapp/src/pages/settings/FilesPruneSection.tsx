import { Alert, Badge, Box, Button, Group, ScrollArea, Stack, Text } from '@mantine/core'
import { useCallback, useEffect, useState } from 'react'
import { formatSize } from '../../utils/format'
import { trpc } from '../../utils/trpc-client'
import type { useConfirm } from '../../utils/use-confirm'

interface FileSampleRow {
  filename: string
  size: number
}

interface FilesDryRunState {
  count: number
  totalSizeBytes: number
  sample: FileSampleRow[]
  confirmToken: string
}

export function FilesPruneSection({
  confirmDlg,
  pruneVersion,
  onPruned,
}: {
  confirmDlg: ReturnType<typeof useConfirm>
  pruneVersion: number
  onPruned?: () => void
}) {
  const [state, setState] = useState<FilesDryRunState | undefined>()
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')

  const fetchDryRun = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const r = await trpc.prune.dryRun.mutate({ kind: 'files' })
      if (r.kind === 'files') {
        setState({
          count: r.count,
          totalSizeBytes: r.totalSizeBytes,
          sample: r.sample as FileSampleRow[],
          confirmToken: r.confirmToken,
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'dryRun failed')
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial fetch + refetch whenever ANY section successfully prunes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pruneVersion is an intentional refetch trigger, not a body dep
  useEffect(() => {
    fetchDryRun()
  }, [fetchDryRun, pruneVersion])

  const handleExecute = useCallback(async () => {
    if (!state || state.count === 0) return
    const ok = await confirmDlg.confirm({
      title: 'Confirm Files Prune',
      message: `Delete ALL files (${state.count}, ${formatSize(state.totalSizeBytes)}) in data/files/? The matching import_jobs rows are also removed; links rows are NOT touched. This cannot be undone.`,
      confirmLabel: 'Delete files',
      confirmColor: 'red',
    })
    if (!ok) return
    setRunning(true)
    setError('')
    try {
      await trpc.prune.execute.mutate({
        kind: 'files',
        confirmToken: state.confirmToken,
      })
      onPruned?.() // triggers refetch of all sections via pruneVersion bump
    } catch (err) {
      setError(err instanceof Error ? err.message : 'execute failed')
    } finally {
      setRunning(false)
    }
  }, [state, confirmDlg, onPruned])

  const canExecute = !!state && state.count > 0 && !running

  return (
    <Stack gap="xs">
      {error && (
        <Alert color="red" variant="light">
          {error}
        </Alert>
      )}
      <Group gap="sm" wrap="nowrap">
        <Badge variant="filled" color={state && state.count > 0 ? 'red' : 'gray'}>
          {state?.count ?? 0} files
        </Badge>
        {state && state.totalSizeBytes > 0 && (
          <Badge variant="light" color="orange">
            {formatSize(state.totalSizeBytes)}
          </Badge>
        )}
        <Box style={{ flex: 1 }} />
        <Button size="xs" variant="default" onClick={fetchDryRun} loading={loading}>
          Dry-run
        </Button>
        <Button size="xs" color="red" onClick={handleExecute} disabled={!canExecute} loading={running}>
          Execute
        </Button>
      </Group>
      {state && state.sample.length > 0 && (
        <Stack gap={4}>
          <Text size="xs" c="dimmed" fw={500}>
            Sample (first {state.sample.length}, alphabetical):
          </Text>
          <ScrollArea.Autosize mah={160} type="auto" offsetScrollbars>
            <Stack gap={2}>
              {state.sample.map((row) => (
                <Text key={row.filename} size="xs" ff="monospace" truncate>
                  {row.filename} — {formatSize(row.size)}
                </Text>
              ))}
            </Stack>
          </ScrollArea.Autosize>
        </Stack>
      )}
    </Stack>
  )
}
