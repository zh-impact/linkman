import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Container,
  Grid,
  Group,
  Loader,
  Stack,
  Switch,
  Tabs,
  Text,
  Title,
} from '@mantine/core'
import { useState } from 'react'
import { trpc } from '../utils/trpc-client'

export function FilterPage() {
  return (
    <Container size="md">
      <Title order={2} mb="md">
        Filter Links
      </Title>
      <Tabs defaultValue="internal">
        <Tabs.List mb="md">
          <Tabs.Tab value="internal">Internal URLs</Tabs.Tab>
          <Tabs.Tab value="similar">Similar URLs</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="internal">
          <InternalFilter />
        </Tabs.Panel>

        <Tabs.Panel value="similar">
          <SimilarFilter />
        </Tabs.Panel>
      </Tabs>
    </Container>
  )
}

function InternalFilter() {
  const [loading, setLoading] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [preview, setPreview] = useState<{
    filteredCount: number
    remainingCount: number
    filteredIds: string[]
  } | null>(null)
  const [result, setResult] = useState<{ filteredCount: number; operationId: string } | null>(null)
  const [error, setError] = useState('')

  const handlePreview = async () => {
    setLoading(true)
    setError('')
    setPreview(null)
    setResult(null)
    try {
      const data = await trpc.filter.internal.preview.query({})
      setPreview(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed')
    } finally {
      setLoading(false)
    }
  }

  const handleExecute = async () => {
    setExecuting(true)
    setError('')
    try {
      const data = await trpc.filter.internal.execute.mutate({})
      setResult(data)
      setPreview(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Filter failed')
    } finally {
      setExecuting(false)
    }
  }

  return (
    <Stack gap="md">
      <Card withBorder>
        <Text size="sm" c="dimmed" mb="md">
          Detect and filter internal/private URLs such as localhost, private IP addresses, and file://
          URLs.
        </Text>
        <Group>
          <Button onClick={handlePreview} loading={loading}>
            Preview
          </Button>
          {preview && (
            <Button color="red" onClick={handleExecute} loading={executing}>
              Filter ({preview.filteredCount} internal)
            </Button>
          )}
        </Group>
      </Card>

      {error && (
        <Alert color="red" title="Error">
          {error}
        </Alert>
      )}

      {preview && (
        <Grid>
          <Grid.Col span={6}>
            <Card withBorder>
              <Text size="sm" c="dimmed">
                Internal URLs
              </Text>
              <Text fw={700} size="xl" c="red">
                {preview.filteredCount}
              </Text>
            </Card>
          </Grid.Col>
          <Grid.Col span={6}>
            <Card withBorder>
              <Text size="sm" c="dimmed">
                Remaining
              </Text>
              <Text fw={700} size="xl" c="green">
                {preview.remainingCount}
              </Text>
            </Card>
          </Grid.Col>
        </Grid>
      )}

      {result && (
        <Alert color="green" title="Filter Complete">
          Filtered {result.filteredCount} internal URLs.
        </Alert>
      )}
    </Stack>
  )
}

function SimilarFilter() {
  const [strategy, setStrategy] = useState({
    byDomain: true,
    byPathPrefix: true,
    byPathDepth: 2,
    editDistance: false,
    editDistanceThreshold: 0.8,
  })
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [preview, setPreview] = useState<{
    groupCount: number
    totalSimilar: number
    groups: Array<{ groupKey: string; method: string; linkIds: string[]; count: number }>
  } | null>(null)
  const [result, setResult] = useState<{ filteredCount: number; operationId: string } | null>(null)
  const [error, setError] = useState('')

  const handlePreview = async () => {
    setLoading(true)
    setError('')
    setPreview(null)
    setResult(null)
    setSelectedGroups(new Set())
    try {
      const data = await trpc.filter.similar.preview.query({ strategy })
      setPreview(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed')
    } finally {
      setLoading(false)
    }
  }

  const handleExecute = async () => {
    setExecuting(true)
    setError('')
    try {
      const data = await trpc.filter.similar.execute.mutate({
        strategy,
        selectedGroups: selectedGroups.size > 0 ? Array.from(selectedGroups) : undefined,
      })
      setResult(data)
      setPreview(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Filter failed')
    } finally {
      setExecuting(false)
    }
  }

  const toggleGroup = (key: string) => {
    setSelectedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const selectAll = () => {
    if (preview) {
      setSelectedGroups(new Set(preview.groups.map((g) => g.groupKey)))
    }
  }

  return (
    <Stack gap="md">
      <Card withBorder>
        <Stack>
          <Switch
            label="Group by domain"
            checked={strategy.byDomain}
            onChange={(e) => setStrategy({ ...strategy, byDomain: e.currentTarget.checked })}
          />
          <Group>
            <Switch
              label="Group by path prefix"
              checked={strategy.byPathPrefix}
              onChange={(e) => setStrategy({ ...strategy, byPathPrefix: e.currentTarget.checked })}
            />
            {strategy.byPathPrefix && (
              <Box>
                <Text size="xs" c="dimmed">
                  Depth
                </Text>
                <Badge size="lg">{strategy.byPathDepth}</Badge>
              </Box>
            )}
          </Group>
          <Group>
            <Switch
              label="Edit distance"
              checked={strategy.editDistance}
              onChange={(e) => setStrategy({ ...strategy, editDistance: e.currentTarget.checked })}
            />
            {strategy.editDistance && (
              <Text size="xs" c="dimmed">
                Threshold: {strategy.editDistanceThreshold}
              </Text>
            )}
          </Group>

          <Group>
            <Button onClick={handlePreview} loading={loading}>
              Preview
            </Button>
            {preview && (
              <Button color="red" onClick={handleExecute} loading={executing}>
                Filter Selected ({selectedGroups.size || preview.groups.length} groups)
              </Button>
            )}
          </Group>
        </Stack>
      </Card>

      {error && (
        <Alert color="red" title="Error">
          {error}
        </Alert>
      )}

      {preview && (
        <Stack gap="md">
          <Grid>
            <Grid.Col span={4}>
              <Card withBorder>
                <Text size="sm" c="dimmed">
                  Groups
                </Text>
                <Text fw={700} size="xl">
                  {preview.groupCount}
                </Text>
              </Card>
            </Grid.Col>
            <Grid.Col span={4}>
              <Card withBorder>
                <Text size="sm" c="dimmed">
                  Similar Links
                </Text>
                <Text fw={700} size="xl" c="orange">
                  {preview.totalSimilar}
                </Text>
              </Card>
            </Grid.Col>
            <Grid.Col span={4}>
              <Card withBorder>
                <Text size="sm" c="dimmed">
                  Selected
                </Text>
                <Text fw={700} size="xl" c="blue">
                  {selectedGroups.size}
                </Text>
              </Card>
            </Grid.Col>
          </Grid>

          <Group>
            <Button variant="subtle" size="xs" onClick={selectAll}>
              Select All
            </Button>
          </Group>

          <Card withBorder>
            <Text fw={500} mb="xs">
              Similarity Groups
            </Text>
            <Stack gap="xs" mah={400} style={{ overflowY: 'auto' }}>
              {preview.groups.map((group) => (
                <Card
                  key={group.groupKey}
                  withBorder
                  p="xs"
                  bg={
                    selectedGroups.has(group.groupKey)
                      ? 'var(--mantine-color-blue-light)'
                      : undefined
                  }
                  style={{ cursor: 'pointer' }}
                  onClick={() => toggleGroup(group.groupKey)}
                >
                  <Group justify="space-between">
                    <Group gap="xs">
                      <Checkbox
                        checked={selectedGroups.has(group.groupKey)}
                        onChange={() => toggleGroup(group.groupKey)}
                      />
                      <Badge size="sm" variant="light">
                        {group.method}
                      </Badge>
                      <Text size="xs">{group.groupKey}</Text>
                    </Group>
                    <Badge color="orange" size="sm">
                      {group.count} links
                    </Badge>
                  </Group>
                </Card>
              ))}
            </Stack>
          </Card>
        </Stack>
      )}

      {result && (
        <Alert color="green" title="Filter Complete">
          Filtered {result.filteredCount} similar URLs.
        </Alert>
      )}
    </Stack>
  )
}
