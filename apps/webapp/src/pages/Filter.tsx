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
  NumberInput,
  Radio,
  Stack,
  Tabs,
  Text,
  Title,
} from '@mantine/core'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { trpc } from '../utils/trpc-client'
import { useConfirm } from '../utils/use-confirm'

const VIRTUAL_THRESHOLD = 20
const INNER_VIRTUAL_THRESHOLD = 20
const ROW_HEIGHT = 20

function VirtualUrlList({ urls }: { urls: string[] }) {
  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: urls.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  })

  return (
    <Box ref={parentRef} mah={300} style={{ overflowY: 'auto' }}>
      <Box style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((item) => {
          const url = urls[item.index]
          return (
            <Box
              key={item.key}
              ref={(el) => {
                if (el) virtualizer.measureElement(el)
              }}
              data-index={item.index}
              style={{
                position: 'absolute',
                top: item.start,
                left: 0,
                right: 0,
              }}
            >
              <Text
                component="a"
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                c={item.index === 0 ? 'green' : 'blue'}
                td="underline"
                size="xs"
                ff="monospace"
                pl="xs"
                style={{ display: 'block', wordBreak: 'break-all', lineHeight: '1.4' }}
              >
                {item.index === 0 ? '[KEEP] ' : `[${item.index + 1}]  `}
                {url}
              </Text>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

function SimilarGroupCard({
  group,
  expanded,
  selected,
  onToggleExpand,
  onToggleSelect,
}: {
  group: {
    groupKey: string
    method: string
    linkIds: string[]
    urls: string[]
    count: number
  }
  expanded: boolean
  selected: boolean
  onToggleExpand: () => void
  onToggleSelect: () => void
}) {
  const useInnerVirtual = expanded && group.urls.length > INNER_VIRTUAL_THRESHOLD

  return (
    <Card
      withBorder
      p="xs"
      bg={
        selected
          ? 'var(--mantine-color-blue-light)'
          : expanded
            ? 'var(--mantine-color-violet-light)'
            : 'var(--mantine-color-gray-light)'
      }
    >
      <Group justify="space-between" onClick={onToggleExpand} style={{ cursor: 'pointer' }}>
        <Group gap="xs">
          <Checkbox
            checked={selected}
            onChange={(e) => {
              e.stopPropagation()
              onToggleSelect()
            }}
          />
          <Badge size="sm" variant="light">
            {group.method}
          </Badge>
          <Badge
            color={
              group.count >= 10 ? 'red' : group.count >= 5 ? 'orange' : group.count >= 3 ? 'yellow' : 'gray'
            }
            size="sm"
          >
            {group.count} links
          </Badge>
        </Group>
        <Group gap="xs">
          <Text size="xs" c="dimmed" truncate maw={300}>
            {group.groupKey}
          </Text>
        </Group>
      </Group>
      {expanded && (
        <Box
          mt="xs"
          pt="xs"
          style={{ borderTop: '1px solid var(--mantine-color-gray-3)' }}
          onClick={(e) => e.stopPropagation()}
        >
          {useInnerVirtual ? (
            <VirtualUrlList urls={group.urls} />
          ) : (
            <Stack gap={2}>
              {group.urls.map((url, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: URLs may duplicate within a group; index keys are intentional
                <Text key={j} size="xs" ff="monospace" style={{ wordBreak: 'break-all' }}>
                  <Text
                    component="a"
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    c={j === 0 ? 'green' : 'blue'}
                    td="underline"
                    size="xs"
                    span
                    ff="monospace"
                  >
                    {j === 0 ? '[KEEP] ' : `[${j + 1}]  `}
                    {url}
                  </Text>
                </Text>
              ))}
            </Stack>
          )}
        </Box>
      )}
    </Card>
  )
}

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
            Detect links pointing to private IP addresses (localhost, 10.x, 172.16-31.x, 192.168.x, 169.254.x)
            and mark them as internal.
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
  const [method, setMethod] = useState<'domain' | 'path_prefix' | 'edit_distance'>('domain')
  const [pathDepth, setPathDepth] = useState(2)
  const [editDistanceThreshold, setEditDistanceThreshold] = useState(0.8)
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set())
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [groups, setGroups] = useState<
    Array<{ groupKey: string; method: string; linkIds: string[]; urls: string[]; count: number }>
  >([])
  const [totalSimilar, setTotalSimilar] = useState(0)
  const [progress, setProgress] = useState<{ processed: number; total: number } | null>(null)
  const [result, setResult] = useState<{ filteredCount: number; operationId: string } | null>(null)
  const [error, setError] = useState('')
  const confirmDlg = useConfirm()
  const scrollRef = useRef<HTMLDivElement>(null)

  const strategy = {
    byDomain: method === 'domain',
    byPathPrefix: method === 'path_prefix',
    byPathDepth: pathDepth,
    editDistance: method === 'edit_distance',
    editDistanceThreshold,
  }

  const handlePreview = async () => {
    setLoading(true)
    setError('')
    setGroups([])
    setTotalSimilar(0)
    setProgress(null)
    setResult(null)
    setSelectedGroups(new Set())
    setExpandedGroups(new Set())
    try {
      let cursor = 0
      let accumulatedSimilar = 0
      while (true) {
        const data = await trpc.filter.similar.preview.query({ strategy, cursor })
        setGroups((prev) => [...prev, ...data.groups])
        accumulatedSimilar += data.totalSimilar
        setTotalSimilar(accumulatedSimilar)
        if (data.hasMore && data.nextCursor !== null) {
          setProgress({ processed: data.processedDomains, total: data.totalDomains })
          cursor = data.nextCursor
        } else {
          setProgress(null)
          break
        }
      }
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
      setGroups([])
      setTotalSimilar(0)
      setProgress(null)
      setSelectedGroups(new Set())
      setExpandedGroups(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Execution request failed')
    } finally {
      setExecuting(false)
    }
  }

  const toggleGroupSelect = (key: string) => {
    setSelectedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleGroupExpand = (index: number) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const allSelected = groups.length > 0 && selectedGroups.size === groups.length
  const toggleAllGroups = () => {
    if (groups.length === 0) return
    if (allSelected) {
      setSelectedGroups(new Set())
    } else {
      setSelectedGroups(new Set(groups.map((g) => g.groupKey)))
    }
  }

  const useVirtual = groups.length > VIRTUAL_THRESHOLD

  const virtualizer = useVirtualizer({
    count: groups.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const group = groups[index]
      const base = 52
      if (expandedGroups.has(index)) {
        const innerVirtual = group.urls.length > INNER_VIRTUAL_THRESHOLD
        const contentHeight = innerVirtual ? 300 : group.urls.length * ROW_HEIGHT
        return base + 28 + contentHeight
      }
      return base
    },
    overscan: 5,
  })

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
            Uses domain grouping, path prefix, and edit distance algorithms to detect similar links. Preview
            to see groups, then select which to filter.
          </Text>
          <Stack>
            <Radio.Group value={method} onChange={(v) => setMethod(v as typeof method)}>
              <Stack gap="xs">
                <Radio value="domain" label="Group by domain" />
                <Group align="center" gap="sm">
                  <Radio value="path_prefix" label="Group by path prefix" />
                  {method === 'path_prefix' && (
                    <>
                      <Text size="sm" fw={500} ml="xs">
                        Depth
                      </Text>
                      <NumberInput
                        value={pathDepth}
                        onChange={(v) => setPathDepth(typeof v === 'number' ? v : 2)}
                        min={1}
                        max={10}
                        w={70}
                      />
                    </>
                  )}
                </Group>
                <Group align="center" gap="sm">
                  <Radio value="edit_distance" label="Edit distance" />
                  {method === 'edit_distance' && (
                    <NumberInput
                      value={editDistanceThreshold}
                      onChange={(v) => setEditDistanceThreshold(typeof v === 'number' ? v : 0.8)}
                      min={0}
                      max={1}
                      step={0.05}
                      decimalScale={2}
                      w={80}
                    />
                  )}
                </Group>
              </Stack>
            </Radio.Group>

            <Group>
              <Button onClick={handlePreview} loading={loading}>
                Preview
              </Button>
            </Group>
          </Stack>
        </Card>

        {(groups.length > 0 || loading) && (
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
                      {groups.length}
                    </Text>
                  </Card>
                </Grid.Col>
                <Grid.Col span={6}>
                  <Card withBorder bg="var(--mantine-color-yellow-light)">
                    <Text size="sm" c="dimmed">
                      Links Involved
                    </Text>
                    <Text fw={700} size="xl" c="yellow">
                      {totalSimilar}
                    </Text>
                  </Card>
                </Grid.Col>
              </Grid>
              {progress && (
                <Text size="xs" c="dimmed" mt="sm">
                  Processing domains: {progress.processed} / {progress.total}
                </Text>
              )}
            </Card>

            {groups.length > 0 && (
              <Card withBorder>
                <Group justify="space-between" mb="sm">
                  <Text fw={600}>Groups ({groups.length})</Text>
                  <Checkbox label="Select All" checked={allSelected} onChange={toggleAllGroups} size="xs" />
                </Group>
                {useVirtual ? (
                  <Box ref={scrollRef} mah={400} style={{ overflowY: 'auto' }}>
                    <Box style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
                      {virtualizer.getVirtualItems().map((item) => (
                        <Box
                          key={item.key}
                          ref={(el) => {
                            if (el) virtualizer.measureElement(el)
                          }}
                          data-index={item.index}
                          style={{
                            position: 'absolute',
                            top: item.start,
                            left: 0,
                            right: 0,
                          }}
                          pb="xs"
                        >
                          <SimilarGroupCard
                            group={groups[item.index]}
                            expanded={expandedGroups.has(item.index)}
                            selected={selectedGroups.has(groups[item.index].groupKey)}
                            onToggleExpand={() => toggleGroupExpand(item.index)}
                            onToggleSelect={() => toggleGroupSelect(groups[item.index].groupKey)}
                          />
                        </Box>
                      ))}
                    </Box>
                  </Box>
                ) : (
                  <Box mah={400} style={{ overflowY: 'auto' }}>
                    <Stack gap="xs">
                      {groups.map((group, i) => (
                        <SimilarGroupCard
                          key={group.groupKey}
                          group={group}
                          expanded={expandedGroups.has(i)}
                          selected={selectedGroups.has(group.groupKey)}
                          onToggleExpand={() => toggleGroupExpand(i)}
                          onToggleSelect={() => toggleGroupSelect(group.groupKey)}
                        />
                      ))}
                    </Stack>
                  </Box>
                )}

                <Group justify="space-between" mt="sm">
                  <Text size="sm" c="dimmed">
                    {selectedGroups.size} / {groups.length} groups selected
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
