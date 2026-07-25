import { Alert, Badge, Box, Button, Card, Group, ScrollArea, Stack, Text, Title } from '@mantine/core'
import { useCallback, useEffect, useState } from 'react'
import { trpc } from '../../utils/trpc-client'
import type { useConfirm } from '../../utils/use-confirm'
import { DomainSelector } from './DomainSelector'

type LinksPruneKind = 'duplicate' | 'internal' | 'by-domain' | 'all'

interface LinkSampleRow {
  id: string
  originalUrl: string
  domain: string
  status: string
  createdAt: string
  duplicateOf?: string | null
}

interface LinksDryRunState {
  count: number
  cascadeTestResults: number
  sample: LinkSampleRow[]
  confirmToken: string
}

interface SubCardProps {
  title: string
  description: string
  kind: LinksPruneKind
  state: LinksDryRunState | undefined
  loading: boolean
  running: boolean
  onDryRun: () => void
  onExecute: () => void
  children?: React.ReactNode
}

function SubCard({
  title,
  description,
  kind: _kind,
  state,
  loading,
  running,
  onDryRun,
  onExecute,
  children,
}: SubCardProps) {
  const count = state?.count
  const canExecute = !!state && state.count > 0 && !running
  return (
    <Card withBorder p="sm">
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap">
          <Box style={{ flex: 1, minWidth: 0 }}>
            <Group gap="xs" wrap="nowrap">
              <Title order={6}>{title}</Title>
              {loading ? (
                <Badge variant="light" color="gray">
                  …
                </Badge>
              ) : (
                <Badge variant="filled" color={count && count > 0 ? 'red' : 'gray'}>
                  {count ?? 0}
                </Badge>
              )}
            </Group>
            <Text size="xs" c="dimmed">
              {description}
            </Text>
          </Box>
          <Group gap="xs" wrap="nowrap">
            <Button size="xs" variant="default" onClick={onDryRun} loading={loading}>
              Dry-run
            </Button>
            <Button size="xs" color="red" onClick={onExecute} disabled={!canExecute} loading={running}>
              Execute
            </Button>
          </Group>
        </Group>
        {children}
        {state && state.count > 0 && (
          <Stack gap={4}>
            {state.cascadeTestResults > 0 && (
              <Text size="xs" c="orange">
                ↳ cascade: {state.cascadeTestResults} test_results
              </Text>
            )}
            <Text size="xs" c="dimmed" fw={500}>
              Sample (first {state.sample.length}):
            </Text>
            <ScrollArea.Autosize mah={160} type="auto" offsetScrollbars>
              <Stack gap={2}>
                {state.sample.map((row) => (
                  <Text key={row.id} size="xs" ff="monospace" truncate>
                    {row.domain} — {row.originalUrl}
                  </Text>
                ))}
              </Stack>
            </ScrollArea.Autosize>
          </Stack>
        )}
      </Stack>
    </Card>
  )
}

export function LinksPruneSection({
  confirmDlg,
  pruneVersion,
  onPruned,
}: {
  confirmDlg: ReturnType<typeof useConfirm>
  pruneVersion: number
  onPruned?: () => void
}) {
  const [results, setResults] = useState<Partial<Record<LinksPruneKind, LinksDryRunState>>>({})
  const [loadingKind, setLoadingKind] = useState<LinksPruneKind | null>(null)
  const [runningKind, setRunningKind] = useState<LinksPruneKind | null>(null)
  const [error, setError] = useState('')
  const [selectedDomains, setSelectedDomains] = useState<string[]>([])

  const fetchDryRun = useCallback(
    async (kind: LinksPruneKind, domains?: string[]) => {
      setLoadingKind(kind)
      setError('')
      try {
        const params = kind === 'by-domain' ? { domains: domains ?? selectedDomains } : undefined
        const r = await trpc.prune.dryRun.mutate({ kind, params })
        if (r.kind === kind) {
          // Narrow to one of the link kinds — TS doesn't know that database/files
          // are excluded by the LinksPruneKind union, so we cast defensively.
          const linkR = r as {
            kind: LinksPruneKind
            count: number
            cascadeCounts: { testResults: number }
            sample: LinkSampleRow[]
            confirmToken: string
          }
          setResults((prev) => ({
            ...prev,
            [kind]: {
              count: linkR.count,
              cascadeTestResults: linkR.cascadeCounts.testResults,
              sample: linkR.sample as LinkSampleRow[],
              confirmToken: linkR.confirmToken,
            },
          }))
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'dryRun failed')
      } finally {
        setLoadingKind(null)
      }
    },
    [selectedDomains],
  )

  // Auto-fetch counts for non-by-domain sub-cards on mount + whenever any
  // section successfully prunes (a Database prune zeros out all link counts).
  // biome-ignore lint/correctness/useExhaustiveDependencies: pruneVersion is an intentional refetch trigger, not a body dep
  useEffect(() => {
    fetchDryRun('duplicate')
    fetchDryRun('internal')
    fetchDryRun('all')
    // by-domain is handled by the dedicated effect below (depends on selection).
  }, [fetchDryRun, pruneVersion])

  // Re-fetch by-domain whenever the user changes the selection.
  useEffect(() => {
    fetchDryRun('by-domain')
  }, [fetchDryRun])

  const handleExecute = useCallback(
    async (kind: LinksPruneKind) => {
      const state = results[kind]
      if (!state || state.count === 0) return
      const ok = await confirmDlg.confirm({
        title: `Confirm Prune — ${kind}`,
        message: `Delete ${state.count} ${kind} link(s)?${
          state.cascadeTestResults > 0
            ? ` This will also cascade-delete ${state.cascadeTestResults} test_results.`
            : ''
        } This cannot be undone.`,
        confirmLabel: 'Delete',
        confirmColor: 'red',
      })
      if (!ok) return
      setRunningKind(kind)
      setError('')
      try {
        const params = kind === 'by-domain' ? { domains: selectedDomains } : undefined
        await trpc.prune.execute.mutate({
          kind,
          params,
          confirmToken: state.confirmToken,
        })
        // Bumping pruneVersion triggers refetch of all link sub-cards (above
        // effect) plus Database + Files sections in the parent.
        onPruned?.()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'execute failed')
      } finally {
        setRunningKind(null)
      }
    },
    [results, selectedDomains, confirmDlg, onPruned],
  )

  return (
    <Stack gap="sm">
      {error && (
        <Alert color="red" variant="light">
          {error}
        </Alert>
      )}
      <SubCard
        title="Duplicate links"
        description="Rows with duplicateOf IS NOT NULL (status = duplicate_removed)."
        kind="duplicate"
        state={results.duplicate}
        loading={loadingKind === 'duplicate'}
        running={runningKind === 'duplicate'}
        onDryRun={() => fetchDryRun('duplicate')}
        onExecute={() => handleExecute('duplicate')}
      />
      <SubCard
        title="Internal links"
        description="Rows with isInternal = true (filtered_internal)."
        kind="internal"
        state={results.internal}
        loading={loadingKind === 'internal'}
        running={runningKind === 'internal'}
        onDryRun={() => fetchDryRun('internal')}
        onExecute={() => handleExecute('internal')}
      />
      <Card withBorder p="sm">
        <Stack gap="xs">
          <Group justify="space-between" wrap="nowrap">
            <Box style={{ flex: 1, minWidth: 0 }}>
              <Group gap="xs" wrap="nowrap">
                <Title order={6}>By domain</Title>
                {loadingKind === 'by-domain' ? (
                  <Badge variant="light" color="gray">
                    …
                  </Badge>
                ) : (
                  <Badge
                    variant="filled"
                    color={results['by-domain']?.count && results['by-domain'].count > 0 ? 'red' : 'gray'}
                  >
                    {results['by-domain']?.count ?? 0}
                  </Badge>
                )}
              </Group>
              <Text size="xs" c="dimmed">
                Select one or more domains, then dry-run + execute.
              </Text>
            </Box>
            <Group gap="xs" wrap="nowrap">
              <Button
                size="xs"
                variant="default"
                onClick={() => fetchDryRun('by-domain')}
                loading={loadingKind === 'by-domain'}
                disabled={selectedDomains.length === 0}
              >
                Dry-run
              </Button>
              <Button
                size="xs"
                color="red"
                onClick={() => handleExecute('by-domain')}
                disabled={
                  !results['by-domain'] ||
                  results['by-domain'].count === 0 ||
                  selectedDomains.length === 0 ||
                  !!runningKind
                }
                loading={runningKind === 'by-domain'}
              >
                Execute
              </Button>
            </Group>
          </Group>
          <DomainSelector selected={selectedDomains} onChange={setSelectedDomains} />
          {results['by-domain'] && results['by-domain'].count > 0 && (
            <Stack gap={4}>
              {results['by-domain'].cascadeTestResults > 0 && (
                <Text size="xs" c="orange">
                  ↳ cascade: {results['by-domain'].cascadeTestResults} test_results
                </Text>
              )}
              <Text size="xs" c="dimmed" fw={500}>
                Sample (first {results['by-domain'].sample.length}):
              </Text>
              <ScrollArea.Autosize mah={160} type="auto" offsetScrollbars>
                <Stack gap={2}>
                  {results['by-domain'].sample.map((row) => (
                    <Text key={row.id} size="xs" ff="monospace" truncate>
                      {row.domain} — {row.originalUrl}
                    </Text>
                  ))}
                </Stack>
              </ScrollArea.Autosize>
            </Stack>
          )}
        </Stack>
      </Card>
      <SubCard
        title="All links"
        description="Every row in the links table, regardless of status."
        kind="all"
        state={results.all}
        loading={loadingKind === 'all'}
        running={runningKind === 'all'}
        onDryRun={() => fetchDryRun('all')}
        onExecute={() => handleExecute('all')}
      />
    </Stack>
  )
}
