import { Alert, Badge, Box, Button, Group, ScrollArea, Stack, Text } from '@mantine/core'
import { useCallback, useEffect, useState } from 'react'
import { trpc } from '../../utils/trpc-client'
import type { useConfirm } from '../../utils/use-confirm'

interface ImportJobSampleRow {
  id: string
  type: string
  sourceContent: string
  strategy: string
  status: string
  importedCount: number
  createdAt: string
}

interface DatabaseDryRunState {
  count: number
  jobCount: number
  cascadeTestResults: number
  sample: ImportJobSampleRow[]
  confirmToken: string
}

export function DatabasePruneSection({
  confirmDlg,
  pruneVersion,
  onPruned,
}: {
  confirmDlg: ReturnType<typeof useConfirm>
  pruneVersion: number
  onPruned?: () => void
}) {
  const [state, setState] = useState<DatabaseDryRunState | undefined>()
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')

  const fetchDryRun = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const r = await trpc.prune.dryRun.mutate({ kind: 'database' })
      if (r.kind === 'database') {
        setState({
          count: r.count,
          jobCount: r.jobCount,
          cascadeTestResults: r.cascadeCounts.testResults,
          sample: r.sample as ImportJobSampleRow[],
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
    if (!state || (state.count === 0 && state.jobCount === 0)) return
    const ok = await confirmDlg.confirm({
      title: 'Confirm Database Prune',
      message: `Clear ALL links (${state.count}) and import_jobs (${state.jobCount})?${
        state.cascadeTestResults > 0
          ? ` This will also cascade-delete ${state.cascadeTestResults} test_results.`
          : ''
      } Operations and snapshots history is preserved. This cannot be undone.`,
      confirmLabel: 'Clear database',
      confirmColor: 'red',
    })
    if (!ok) return
    setRunning(true)
    setError('')
    try {
      await trpc.prune.execute.mutate({
        kind: 'database',
        confirmToken: state.confirmToken,
      })
      onPruned?.() // triggers refetch of all sections via pruneVersion bump
    } catch (err) {
      setError(err instanceof Error ? err.message : 'execute failed')
    } finally {
      setRunning(false)
    }
  }, [state, confirmDlg, onPruned])

  const canExecute = !!state && (state.count > 0 || state.jobCount > 0) && !running

  return (
    <Stack gap="xs">
      {error && (
        <Alert color="red" variant="light">
          {error}
        </Alert>
      )}
      <Group gap="sm" wrap="nowrap">
        <Badge variant="filled" color={state && state.count > 0 ? 'red' : 'gray'}>
          {state?.count ?? 0} links
        </Badge>
        <Badge variant="filled" color={state && state.jobCount > 0 ? 'red' : 'gray'}>
          {state?.jobCount ?? 0} jobs
        </Badge>
        {state && state.cascadeTestResults > 0 && (
          <Badge variant="light" color="orange">
            ↳ {state.cascadeTestResults} test_results
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
            Sample import_jobs (first {state.sample.length}):
          </Text>
          <ScrollArea.Autosize mah={160} type="auto" offsetScrollbars>
            <Stack gap={2}>
              {state.sample.map((row) => (
                <Text key={row.id} size="xs" ff="monospace" truncate>
                  [{row.status}] {row.sourceContent} · {row.importedCount} links
                </Text>
              ))}
            </Stack>
          </ScrollArea.Autosize>
        </Stack>
      )}
    </Stack>
  )
}
