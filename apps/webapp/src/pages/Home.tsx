import {
  Badge,
  Button,
  Card,
  Container,
  Grid,
  Group,
  Skeleton,
  Stack,
  Text,
  Title,
} from '@mantine/core'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { trpc } from '../utils/trpc-client'

const statusLabels: Record<string, string> = {
  pending: 'Pending',
  imported: 'Imported',
  duplicate_removed: 'Duplicate',
  filtered_internal: 'Internal',
  filtered_similar: 'Similar',
  dns_failed: 'DNS Failed',
  connection_refused: 'Refused',
  timeout: 'Timeout',
  success: 'Available',
  error: 'Error',
}

const statusColors: Record<string, string> = {
  pending: 'yellow',
  imported: 'blue',
  duplicate_removed: 'gray',
  filtered_internal: 'orange',
  filtered_similar: 'orange',
  dns_failed: 'red',
  connection_refused: 'red',
  timeout: 'red',
  success: 'green',
  error: 'red',
}

const opTypeLabels: Record<string, string> = {
  import: 'Import',
  deduplicate: 'Deduplicate',
  filter_internal: 'Filter Internal',
  filter_similar: 'Filter Similar',
  test_dns: 'DNS Test',
  test_head: 'HEAD Test',
  test_get: 'GET Test',
  manual_tag: 'Tag',
  manual_delete: 'Delete',
  rollback: 'Rollback',
}

const opTypeColors: Record<string, string> = {
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

interface RecentOp {
  id: string
  type: string
  timestamp: string
}

export function HomePage() {
  const [total, setTotal] = useState(0)
  const [byStatus, setByStatus] = useState<Record<string, number>>({})
  const [recentOps, setRecentOps] = useState<RecentOp[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const [statsData, opsData] = await Promise.all([
        trpc.stats.getStatusCounts.query(),
        trpc.operations.list.query({ limit: 5, offset: 0 }),
      ])
      setTotal(statsData.total)
      setByStatus(statsData.statusCounts)
      const opsList = (opsData as { operations: Record<string, unknown>[] }).operations ?? []
      setRecentOps(
        opsList.map((op) => ({
          id: op.id as string,
          type: op.type as string,
          timestamp: op.timestamp as string,
        })),
      )
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const highlightStatuses = ['imported', 'success', 'pending'] as const

  return (
    <Container strategy="grid" size="lg">
      <Title order={2} mb="lg">
        Dashboard
      </Title>

      <Stack gap="lg">
        {/* Top stats cards: Total + 3 highlights */}
        <Grid>
          <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
            <Card withBorder p="lg">
              <Text size="sm" c="dimmed">
                Total Links
              </Text>
              {loading ? (
                <Skeleton height={28} width="55%" mt="xs" />
              ) : (
                <Text fw={700} size="xl" mt="xs">
                  {total}
                </Text>
              )}
            </Card>
          </Grid.Col>
          {highlightStatuses.map((status) => (
            <Grid.Col key={status} span={{ base: 12, sm: 6, md: 3 }}>
              <Card withBorder p="lg">
                <Text size="sm" c="dimmed">
                  {statusLabels[status]}
                </Text>
                {loading ? (
                  <Skeleton height={28} width="55%" mt="xs" />
                ) : (
                  <Text fw={700} size="xl" mt="xs">
                    {byStatus[status] ?? 0}
                  </Text>
                )}
              </Card>
            </Grid.Col>
          ))}
        </Grid>

        {/* Status breakdown */}
        <Card withBorder p="md">
          <Text fw={600} mb="sm">
            Status Breakdown
          </Text>
          {loading ? (
            <Group gap="md" wrap="wrap">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Group key={i} gap="xs">
                  <Skeleton height={20} width={80} radius="xl" />
                  <Skeleton height={16} width={28} />
                </Group>
              ))}
            </Group>
          ) : Object.keys(byStatus).length > 0 ? (
            <Group gap="md" wrap="wrap">
              {Object.entries(byStatus)
                .sort(([, a], [, b]) => b - a)
                .map(([status, count]) => (
                  <Group key={status} gap="xs">
                    <Badge color={statusColors[status] ?? 'gray'} variant="light">
                      {statusLabels[status] ?? status}
                    </Badge>
                    <Text size="sm" fw={600}>
                      {count}
                    </Text>
                  </Group>
                ))}
            </Group>
          ) : null}
        </Card>

        <Grid>
          {/* Recent operations */}
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Text fw={600} mb="sm">
              Recent Operations
            </Text>
            <Card withBorder p="md">
              {loading ? (
                <Stack gap="sm">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <Group key={i} justify="space-between">
                      <Skeleton height={22} width={100} radius="xl" />
                      <Skeleton height={14} width={120} />
                    </Group>
                  ))}
                </Stack>
              ) : recentOps.length === 0 ? (
                <Text c="dimmed" ta="center" py="md" size="sm">
                  No operations yet
                </Text>
              ) : (
                <Stack gap="sm">
                  {recentOps.map((op) => (
                    <Group key={op.id} justify="space-between">
                      <Badge variant="outline" color={opTypeColors[op.type] ?? 'gray'}>
                        {opTypeLabels[op.type] ?? op.type}
                      </Badge>
                      <Text size="xs" c="dimmed">
                        {new Date(op.timestamp.replace(' ', 'T') + 'Z').toLocaleString()}
                      </Text>
                    </Group>
                  ))}
                </Stack>
              )}
            </Card>
          </Grid.Col>

          {/* Quick actions */}
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Text fw={600} mb="sm">
              Quick Actions
            </Text>
            <Grid gap="sm">
              {[
                { to: '/links', label: 'View Links' },
                { to: '/files', label: 'Files' },
                { to: '/dedup', label: 'Deduplicate' },
                { to: '/filter', label: 'Filter' },
                { to: '/history', label: 'History' },
              ].map((item) => (
                <Grid.Col key={item.to} span={{ base: 12, sm: 6 }}>
                  <Button component={Link} to={item.to} variant="outline" fullWidth size="md">
                    {item.label}
                  </Button>
                </Grid.Col>
              ))}
            </Grid>
          </Grid.Col>
        </Grid>
      </Stack>
    </Container>
  )
}
