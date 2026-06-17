import { Alert, Badge, Box, Button, Group, ScrollArea, Stack, Text } from '@mantine/core'
import { useCallback, useEffect, useState } from 'react'
import { trpc } from '../../utils/trpc-client'
import type { useConfirm } from '../../utils/use-confirm'

interface OperationSampleRow {
  id: string
  type: string
  jobId: string | null
  timestamp: string
  statsInputCount: number
  statsOutputCount: number
}

interface SnapshotSampleRow {
  id: string
  createdAt: string
  linkCount: number
}

interface AuditDryRunState {
  count: number
  snapshotCount: number
  sample: OperationSampleRow[]
  snapshotSample: SnapshotSampleRow[]
  confirmToken: string
}

export function AuditPruneSection({
  confirmDlg,
  pruneVersion,
  onPruned,
}: {
  confirmDlg: ReturnType<typeof useConfirm>
  pruneVersion: number
  onPruned?: () => void
}) {
  const [state, setState] = useState<AuditDryRunState | undefined>()
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')

  const fetchDryRun = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const r = await trpc.prune.dryRun.mutate({ kind: 'audit' })
      if (r.kind === 'audit') {
        setState({
          count: r.count,
          snapshotCount: r.snapshotCount,
          sample: r.sample as OperationSampleRow[],
          snapshotSample: r.snapshotSample as SnapshotSampleRow[],
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
    if (!state || (state.count === 0 && state.snapshotCount === 0)) return
    const ok = await confirmDlg.confirm({
      title: 'Confirm Audit-History Prune',
      message: `Clear ALL operations (${state.count}) and snapshots (${state.snapshotCount})? Rollback history will be lost; links/jobs/test_results are NOT touched. This cannot be undone.`,
      confirmLabel: 'Clear audit history',
      confirmColor: 'red',
    })
    if (!ok) return
    setRunning(true)
    setError('')
    try {
      await trpc.prune.execute.mutate({
        kind: 'audit',
        confirmToken: state.confirmToken,
      })
      onPruned?.() // triggers refetch of all sections via pruneVersion bump
    } catch (err) {
      setError(err instanceof Error ? err.message : 'execute failed')
    } finally {
      setRunning(false)
    }
  }, [state, confirmDlg, onPruned])

  const canExecute = !!state && (state.count > 0 || state.snapshotCount > 0) && !running

  return (
    <Stack gap="xs">
      {error && (
        <Alert color="red" variant="light">
          {error}
        </Alert>
      )}
      <Group gap="sm" wrap="nowrap">
        <Badge variant="filled" color={state && state.count > 0 ? 'red' : 'gray'}>
          {state?.count ?? 0} operations
        </Badge>
        <Badge variant="filled" color={state && state.snapshotCount > 0 ? 'red' : 'gray'}>
          {state?.snapshotCount ?? 0} snapshots
        </Badge>
        <Box style={{ flex: 1 }} />
        <Button size="xs" variant="default" onClick={fetchDryRun} loading={loading}>
          Dry-run
        </Button>
        <Button
          size="xs"
          color="red"
          onClick={handleExecute}
          disabled={!canExecute}
          loading={running}
        >
          Execute
        </Button>
      </Group>
      {state && state.sample.length > 0 && (
        <Stack gap={4}>
          <Text size="xs" c="dimmed" fw={500}>
            Sample operations (first {state.sample.length}):
          </Text>
          <ScrollArea.Autosize mah={160} type="auto" offsetScrollbars>
            <Stack gap={2}>
              {state.sample.map((row) => (
                <Text key={row.id} size="xs" ff="monospace" truncate>
                  [{row.type}] {row.timestamp} · in={row.statsInputCount} out=
                  {row.statsOutputCount}
                </Text>
              ))}
            </Stack>
          </ScrollArea.Autosize>
        </Stack>
      )}
      {state && state.snapshotSample.length > 0 && (
        <Stack gap={4}>
          <Text size="xs" c="dimmed" fw={500}>
            Sample snapshots (first {state.snapshotSample.length}):
          </Text>
          <ScrollArea.Autosize mah={160} type="auto" offsetScrollbars>
            <Stack gap={2}>
              {state.snapshotSample.map((row) => (
                <Text key={row.id} size="xs" ff="monospace" truncate>
                  {row.createdAt} · {row.linkCount} links
                </Text>
              ))}
            </Stack>
          </ScrollArea.Autosize>
        </Stack>
      )}
    </Stack>
  )
}
