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
import { Link } from 'react-router'
import { trpc } from '../utils/trpc-client'
import { useConfirm } from '../utils/use-confirm'

export function FilterPage() {
  return (
    <Container strategy="grid" size="md">
      <Title order={2}>Filter Links</Title>
      <Text size="sm" c="dimmed" mb="md">
        Detect and filter internal addresses or similar links
      </Text>

      <Tabs defaultValue="internal">
        <Tabs.List mb="md">
          <Tabs.Tab value="internal">Internal Filter</Tabs.Tab>
          <Tabs.Tab value="similar">Similarity Filter</Tabs.Tab>
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
  const confirmDlg = useConfirm()

  const handlePreview = async () => {
    setLoading(true)
    setError('')
    setPreview(null)
    setResult(null)
    try {
      const data = await trpc.filter.internal.preview.query({})
      setPreview(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview request failed')
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
      setError(err instanceof Error ? err.message : 'Execution request failed')
    } finally {
      setExecuting(false)
    }
  }

  return (
    <>
      {confirmDlg.modal}
      <Stack gap="md">
        {result && (
          <Alert color="green" title="Filter Complete">
            Marked {result.filteredCount} internal links.{' '}
            <Text component={Link} to="/history" size="sm" c="green" td="underline">
              View in history
            </Text>
          </Alert>
        )}

        <Card withBorder>
          <Text fw={600} mb="xs">
            Internal Address Detection
          </Text>
          <Text size="sm" c="dimmed" mb="md">
            Detect links pointing to private IP addresses (localhost, 10.x, 172.16-31.x, 192.168.x,
            169.254.x) and mark them as internal.
          </Text>
          <Group>
            <Button onClick={handlePreview} loading={loading}>
              Preview
            </Button>
            <Button
              variant="filled"
              color="red"
              disabled={executing || !preview || preview.filteredCount === 0}
              onClick={async () => {
                const msg = preview
                  ? `Will mark ${preview.filteredCount} internal links. This can be rolled back via operation history.`
                  : 'Will detect and mark all internal links. Consider previewing first. This can be rolled back via operation history.'
                const ok = await confirmDlg.confirm({
                  title: 'Confirm Filter',
                  message: msg,
                  confirmLabel: 'Execute',
                  confirmColor: 'red',
                })
                if (ok) handleExecute()
              }}
            >
              Execute
            </Button>
          </Group>
        </Card>

        {preview && (
          <Card withBorder>
            <Text fw={600} mb="sm">
              Preview Results
            </Text>
            <Grid>
              <Grid.Col span={6}>
                <Card withBorder bg="var(--mantine-color-orange-light)">
                  <Text size="sm" c="dimmed">
                    Internal Links
                  </Text>
                  <Text fw={700} size="xl" c="orange">
                    {preview.filteredCount}
                  </Text>
                </Card>
              </Grid.Col>
              <Grid.Col span={6}>
                <Card withBorder bg="var(--mantine-color-green-light)">
                  <Text size="sm" c="dimmed">
                    External Links
                  </Text>
                  <Text fw={700} size="xl" c="green">
                    {preview.remainingCount}
                  </Text>
                </Card>
              </Grid.Col>
            </Grid>
          </Card>
        )}

        {error && (
          <Alert color="red" title="Error">
            {error}
          </Alert>
        )}
      </Stack>
    </>
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
  const confirmDlg = useConfirm()

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
      setError(err instanceof Error ? err.message : 'Preview request failed')
    } finally {
      setLoading(false)
    }
  }

  const handleExecute = async () => {
    if (selectedGroups.size === 0) return
    setExecuting(true)
    setError('')
    try {
      const data = await trpc.filter.similar.execute.mutate({
        strategy,
        selectedGroups: Array.from(selectedGroups),
      })
      setResult(data)
      setPreview(null)
      setSelectedGroups(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Execution request failed')
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

  const allSelected = preview ? selectedGroups.size === preview.groups.length : false
  const toggleAllGroups = () => {
    if (!preview) return
    if (allSelected) {
      setSelectedGroups(new Set())
    } else {
      setSelectedGroups(new Set(preview.groups.map((g) => g.groupKey)))
    }
  }

  return (
    <>
      {confirmDlg.modal}
      <Stack gap="md">
        {result && (
          <Alert color="green" title="Filter Complete">
            Marked {result.filteredCount} similar links.{' '}
            <Text component={Link} to="/history" size="sm" c="green" td="underline">
              View in history
            </Text>
          </Alert>
        )}

        <Card withBorder>
          <Text fw={600} mb="xs">
            Similarity Detection
          </Text>
          <Text size="sm" c="dimmed" mb="md">
            Uses domain grouping, path prefix, and edit distance algorithms to detect similar links.
            Preview to see groups, then select which to filter.
          </Text>
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
                onChange={(e) =>
                  setStrategy({ ...strategy, byPathPrefix: e.currentTarget.checked })
                }
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
                onChange={(e) =>
                  setStrategy({ ...strategy, editDistance: e.currentTarget.checked })
                }
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
            </Group>
          </Stack>
        </Card>

        {preview && (
          <Stack gap="md">
            <Card withBorder>
              <Text fw={600} mb="sm">
                Detection Overview
              </Text>
              <Grid>
                <Grid.Col span={6}>
                  <Card withBorder bg="var(--mantine-color-violet-light)">
                    <Text size="sm" c="dimmed">
                      Similar Groups
                    </Text>
                    <Text fw={700} size="xl" c="violet">
                      {preview.groupCount}
                    </Text>
                  </Card>
                </Grid.Col>
                <Grid.Col span={6}>
                  <Card withBorder bg="var(--mantine-color-yellow-light)">
                    <Text size="sm" c="dimmed">
                      Links Involved
                    </Text>
                    <Text fw={700} size="xl" c="yellow">
                      {preview.totalSimilar}
                    </Text>
                  </Card>
                </Grid.Col>
              </Grid>
            </Card>

            {preview.groups.length > 0 && (
              <Card withBorder>
                <Group justify="space-between" mb="sm">
                  <Text fw={600}>Groups</Text>
                  <Checkbox
                    label="Select All"
                    checked={allSelected}
                    onChange={toggleAllGroups}
                    size="xs"
                  />
                </Group>
                <Box mah={400} style={{ overflowY: 'auto' }}>
                <Stack gap="xs">
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
                          <Text size="xs" fw={500}>
                            {group.count} links
                          </Text>
                        </Group>
                        <Group gap="xs">
                          <Text size="xs" c="dimmed" truncate>
                            {group.groupKey}
                          </Text>
                        </Group>
                      </Group>
                    </Card>
                  ))}
                </Stack>
                </Box>

                <Group justify="space-between" mt="sm">
                  <Text size="sm" c="dimmed">
                    {selectedGroups.size} / {preview.groups.length} groups selected
                  </Text>
                  <Button
                    color="red"
                    size="xs"
                    disabled={selectedGroups.size === 0}
                    onClick={async () => {
                      const ok = await confirmDlg.confirm({
                        title: 'Confirm Filter',
                        message: `Will filter similar links in ${selectedGroups.size} groups. This can be rolled back via operation history.`,
                        confirmLabel: 'Execute',
                        confirmColor: 'red',
                      })
                      if (ok) handleExecute()
                    }}
                    loading={executing}
                  >
                    Filter Selected
                  </Button>
                </Group>
              </Card>
            )}
          </Stack>
        )}

        {error && (
          <Alert color="red" title="Error">
            {error}
          </Alert>
        )}
      </Stack>
    </>
  )
}
