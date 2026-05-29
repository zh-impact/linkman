import {
  ActionIcon,
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

const PAGE_SIZE = 20

const typeColor = (type: string) => {
  const map: Record<string, string> = {
    import: 'blue',
    deduplicate: 'orange',
    filter_internal: 'yellow',
    filter_similar: 'violet',
    test_dns: 'teal',
    test_head: 'teal',
    test_get: 'teal',
    manual_tag: 'grape',
    manual_delete: 'red',
    rollback: 'gray',
  }
  return map[type] ?? 'gray'
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
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [error, setError] = useState('')

  const fetchOperations = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await trpc.operations.list.query({
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      })
      setOperations(data as OperationItem[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load operations')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchOperations()
  }, [page])

  const handleRollback = async (operationId: string) => {
    if (!confirm('Roll back to this operation? All changes after this point will be undone.'))
      return
    try {
      await trpc.operations.rollback.mutate(operationId)
      fetchOperations()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rollback failed')
    }
  }

  const handleDelete = async (operationId: string) => {
    if (!confirm('Delete this operation record?')) return
    try {
      await trpc.operations.delete.mutate(operationId)
      fetchOperations()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  const handleDeleteAll = async () => {
    if (!confirm('Delete ALL operation records? This cannot be undone.')) return
    try {
      await trpc.operations.deleteAll.mutate()
      setOperations([])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  return (
    <Container size="md">
      <Group justify="space-between" mb="md">
        <Title order={2}>History</Title>
        <Button
          variant="subtle"
          color="red"
          size="xs"
          onClick={handleDeleteAll}
          disabled={operations.length === 0}
        >
          Delete All
        </Button>
      </Group>

      {error && (
        <Text c="red" size="sm" mb="md">
          {error}
        </Text>
      )}

      {loading ? (
        <Loader />
      ) : operations.length === 0 ? (
        <Text c="dimmed">No operations recorded yet.</Text>
      ) : (
        <Stack gap="sm">
          {operations.map((op) => (
            <Card key={op.id} withBorder>
              <Group justify="space-between" mb="xs">
                <Group gap="xs">
                  <Badge color={typeColor(op.type)} variant="light">
                    {op.type}
                  </Badge>
                  <Text size="xs" c="dimmed">
                    {op.timestamp}
                  </Text>
                </Group>
                <Group gap="xs">
                  <ActionIcon
                    variant="subtle"
                    color="blue"
                    size="sm"
                    onClick={() => handleRollback(op.id)}
                    title="Rollback to here"
                  >
                    ↩
                  </ActionIcon>
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    size="sm"
                    onClick={() => handleDelete(op.id)}
                    title="Delete"
                  >
                    ✕
                  </ActionIcon>
                </Group>
              </Group>

              <Group gap="md">
                <Box>
                  <Text size="xs" c="dimmed">
                    Input
                  </Text>
                  <Text fw={500} size="sm">
                    {op.statsInputCount}
                  </Text>
                </Box>
                <Box>
                  <Text size="xs" c="dimmed">
                    Output
                  </Text>
                  <Text fw={500} size="sm">
                    {op.statsOutputCount}
                  </Text>
                </Box>
                {op.statsDuplicateCount != null && (
                  <Box>
                    <Text size="xs" c="dimmed">
                      Duplicates
                    </Text>
                    <Text fw={500} size="sm" c="orange">
                      {op.statsDuplicateCount}
                    </Text>
                  </Box>
                )}
                {op.statsErrorCount > 0 && (
                  <Box>
                    <Text size="xs" c="dimmed">
                      Errors
                    </Text>
                    <Text fw={500} size="sm" c="red">
                      {op.statsErrorCount}
                    </Text>
                  </Box>
                )}
                <Box>
                  <Text size="xs" c="dimmed">
                    Changes
                  </Text>
                  <Group gap="xs">
                    <Badge size="xs" color="green">
                      +{op.changesAdded.length}
                    </Badge>
                    <Badge size="xs" color="red">
                      -{op.changesRemoved.length}
                    </Badge>
                    <Badge size="xs" color="blue">
                      ~{op.changesModified.length}
                    </Badge>
                  </Group>
                </Box>
              </Group>
            </Card>
          ))}

          <Group justify="center">
            <Pagination value={page} onChange={setPage} total={10} />
          </Group>
        </Stack>
      )}
    </Container>
  )
}
