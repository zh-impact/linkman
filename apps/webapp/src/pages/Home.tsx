import {
  Card,
  Container,
  Grid,
  Group,
  Loader,
  Stack,
  Text,
  Title,
} from '@mantine/core'
import { useEffect, useState } from 'react'
import { trpc } from '../utils/trpc-client'

export function HomePage() {
  const [stats, setStats] = useState<{
    total: number
    statusCounts: Record<string, number>
  } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    trpc.stats.getStatusCounts
      .query()
      .then((data) => {
        setStats(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const statusLabels: Record<string, string> = {
    total: 'Total',
    pending: 'Pending',
    imported: 'Imported',
    duplicate_removed: 'Duplicates Removed',
    filtered_internal: 'Filtered Internal',
    filtered_similar: 'Filtered Similar',
    dns_failed: 'DNS Failed',
    connection_refused: 'Connection Refused',
    timeout: 'Timeout',
    success: 'Success',
    error: 'Error',
  }

  return (
    <Container size="md">
      <Title order={2} mb="md">
        Dashboard
      </Title>

      {loading && <Loader />}

      {stats && (
        <Stack gap="md">
          <Card withBorder>
            <Text size="sm" c="dimmed">
              Total Links
            </Text>
            <Text fw={700} size="xl">
              {stats.total}
            </Text>
          </Card>

          <Grid>
            {Object.entries(statusLabels)
              .filter(([key]) => key !== 'total')
              .map(([key, label]) => (
                <Grid.Col key={key} span={{ base: 12, sm: 6, md: 4 }}>
                  <Card withBorder>
                    <Group justify="space-between">
                      <Text size="sm" c="dimmed">
                        {label}
                      </Text>
                      <Text fw={700}>{stats.statusCounts[key] ?? 0}</Text>
                    </Group>
                  </Card>
                </Grid.Col>
              ))}
          </Grid>
        </Stack>
      )}
    </Container>
  )
}
