import {
  Badge,
  Box,
  Button,
  Card,
  Container,
  Group,
  Loader,
  Pagination,
  Stack,
  Text,
  Title,
} from '@mantine/core'
import { useEffect, useState } from 'react'
import { trpc } from '../utils/trpc-client'
import { useConfirm } from '../utils/use-confirm'

const PAGE_SIZE = 20

const typeConfig: Record<string, { label: string; color: string }> = {
  import: { label: 'Import', color: 'blue' },
  deduplicate: { label: 'Deduplicate', color: 'violet' },
  filter_internal: { label: 'Filter Internal', color: 'orange' },
  filter_similar: { label: 'Filter Similar', color: 'yellow' },
  test_dns: { label: 'DNS Test', color: 'teal' },
  test_head: { label: 'HEAD Test', color: 'teal' },
  test_get: { label: 'GET Test', color: 'teal' },
  manual_tag: { label: 'Tag', color: 'gray' },
  manual_delete: { label: 'Delete', color: 'red' },
  rollback: { label: 'Rollback', color: 'pink' },
}

interface OperationItem {
  id: string
  type: string
  timestamp: string
  statsInputCount: number
  statsOutputCount: number
  statsDuplicateCount: number | null
  statsErrorCount: number
  changesAdded: string[]
  changesRemoved: string[]
  changesModified: Array<{ id: string; changes: Record<string, unknown> }>
}

export function HistoryPage() {
  const [operations, setOperations] = useState<OperationItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [error, setError] = useState('')
  const confirmDlg = useConfirm()

  const fetchOperations = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await trpc.operations.list.query({
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      })
      setOperations(data.operations as OperationItem[])
      setTotal(data.total)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load operations')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchOperations()
  }, [page])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  const handleRollback = async (operationId: string) => {
    try {
      await trpc.operations.rollback.mutate(operationId)
      fetchOperations()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rollback failed')
    }
  }

  const handleDelete = async (operationId: string) => {
    try {
      await trpc.operations.delete.mutate(operationId)
      fetchOperations()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  const handleDeleteAll = async () => {
    try {
      await trpc.operations.deleteAll.mutate()
      setOperations([])
      setTotal(0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  return (
    <Container strategy="grid" size="md">
      {confirmDlg.modal}
      <Group justify="space-between" mb="md">
        <Group gap="md">
          <Title order={2}>Operation History</Title>
          <Text size="sm" c="dimmed">
            {total} records
          </Text>
        </Group>
        {total > 0 && (
          <Button
            variant="outline"
            color="red"
            size="xs"
            onClick={async () => {
              const ok = await confirmDlg.confirm({
                title: 'Clear All History',
                message: `Delete all ${total} operation records? This cannot be undone.`,
                confirmLabel: 'Delete All',
                confirmColor: 'red',
              })
              if (ok) handleDeleteAll()
            }}
          >
            Clear All
          </Button>
        )}
      </Group>

      {error && (
        <Text c="red" size="sm" mb="md">
          {error}
        </Text>
      )}

      {loading ? (
        <Loader />
      ) : operations.length === 0 ? (
        <Text c="dimmed" ta="center" py="xl">
          No operations yet
        </Text>
      ) : (
        <>
          <Stack gap="sm">
            {operations.map((op) => {
              const config = typeConfig[op.type] ?? { label: op.type, color: 'gray' }
              const hasChanges =
                op.changesAdded.length > 0 ||
                op.changesRemoved.length > 0 ||
                op.changesModified.length > 0

              return (
                <Card key={op.id} withBorder p="md">
                  <Group justify="space-between" wrap="nowrap">
                    <Box style={{ flex: 1, minWidth: 0 }}>
                      <Group gap="xs" mb={4}>
                        <Badge color={config.color} variant="light" size="sm">
                          {config.label}
                        </Badge>
                        <Text size="xs" c="dimmed">
                          {new Date(op.timestamp.replace(' ', 'T') + 'Z').toLocaleString()}
                        </Text>
                      </Group>

                      <Group gap="md" mb={hasChanges ? 4 : 0}>
                        <Text size="xs" c="dimmed">
                          Input: {op.statsInputCount}
                        </Text>
                        <Text size="xs" c="dimmed">
                          Output: {op.statsOutputCount}
                        </Text>
                        {op.statsDuplicateCount != null && (
                          <Text size="xs" c="dimmed">
                            Duplicates: {op.statsDuplicateCount}
                          </Text>
                        )}
                        {op.statsErrorCount > 0 && (
                          <Text size="xs" c="red">
                            Errors: {op.statsErrorCount}
                          </Text>
                        )}
                      </Group>

                      {hasChanges && (
                        <Group gap="xs">
                          {op.changesAdded.length > 0 && (
                            <Badge size="xs" color="green" variant="light">
                              +{op.changesAdded.length} added
                            </Badge>
                          )}
                          {op.changesRemoved.length > 0 && (
                            <Badge size="xs" color="red" variant="light">
                              -{op.changesRemoved.length} removed
                            </Badge>
                          )}
                          {op.changesModified.length > 0 && (
                            <Badge size="xs" color="yellow" variant="light">
                              ~{op.changesModified.length} modified
                            </Badge>
                          )}
                        </Group>
                      )}
                    </Box>

                    <Group gap="xs" wrap="nowrap">
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => {
                          const json = JSON.stringify(op, null, 2)
                          const blob = new Blob([json], { type: 'application/json' })
                          const url = URL.createObjectURL(blob)
                          window.open(url, '_blank')
                        }}
                      >
                        Export
                      </Button>
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={async () => {
                          const ok = await confirmDlg.confirm({
                            title: 'Confirm Rollback',
                            message: `This will undo all changes made after this operation, including the ${config.label} operation. This cannot be undone.`,
                            confirmLabel: 'Rollback',
                            confirmColor: 'blue',
                          })
                          if (ok) handleRollback(op.id)
                        }}
                      >
                        Rollback
                      </Button>
                      <Button
                        variant="subtle"
                        color="red"
                        size="xs"
                        onClick={async () => {
                          const ok = await confirmDlg.confirm({
                            title: 'Confirm Delete',
                            message: 'Delete this operation record? This cannot be undone.',
                            confirmLabel: 'Delete',
                            confirmColor: 'red',
                          })
                          if (ok) handleDelete(op.id)
                        }}
                      >
                        Delete
                      </Button>
                    </Group>
                  </Group>
                </Card>
              )
            })}
          </Stack>

          {totalPages > 1 && (
            <Group justify="center" mt="md">
              <Pagination value={page} onChange={setPage} total={totalPages} />
            </Group>
          )}
        </>
      )}
    </Container>
  )
}
