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
  Radio,
  Stack,
  Text,
  Title,
} from '@mantine/core'
import { useState } from 'react'
import { Link } from 'react-router'
import { trpc } from '../utils/trpc-client'
import { useConfirm } from '../utils/use-confirm'

const normalizeLabels: Record<string, string> = {
  forceHttps: 'Force HTTPS',
  removeWww: 'Remove www',
  removeTrailingSlash: 'Remove trailing slash',
  removeDefaultPort: 'Remove default port',
  sortQueryParams: 'Sort query params',
  removeFragment: 'Remove fragment',
}

const defaultNormalize: Record<string, boolean> = {
  forceHttps: false,
  removeWww: false,
  removeTrailingSlash: true,
  removeDefaultPort: true,
  sortQueryParams: true,
  removeFragment: true,
}

const strategyDescriptions: Record<string, string> = {
  strict: 'Exact match on original URLs',
  normalized: 'Apply URL normalization rules before matching',
  smart: 'Normalization + heuristic similarity matching',
}

const MAX_GROUPS_DISPLAY = 20

export function DedupPage() {
  const [strategy, setStrategy] = useState('normalized')
  const [sort, setSort] = useState('original')
  const [normalizeConfig, setNormalizeConfig] = useState(defaultNormalize)
  const [loading, setLoading] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [preview, setPreview] = useState<{
    duplicateCount: number
    remainingCount: number
    groups: Array<{ keepId: string; duplicateIds: string[] }>
  } | null>(null)
  const [result, setResult] = useState<{
    duplicateCount: number
    remainingCount: number
    operationId: string
  } | null>(null)
  const [error, setError] = useState('')
  const confirmDlg = useConfirm()

  const showNormalize = strategy === 'normalized' || strategy === 'smart'

  const handlePreview = async () => {
    setLoading(true)
    setError('')
    setPreview(null)
    setResult(null)
    try {
      const data = await trpc.deduplicate.preview.query({
        strategy: strategy as 'strict' | 'normalized' | 'smart',
        sort: sort as 'original' | 'alphabetical' | 'domain',
        normalizeConfig,
      })
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
      const data = await trpc.deduplicate.execute.mutate({
        strategy: strategy as 'strict' | 'normalized' | 'smart',
        sort: sort as 'original' | 'alphabetical' | 'domain',
        normalizeConfig,
      })
      setResult(data)
      setPreview(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deduplication failed')
    } finally {
      setExecuting(false)
    }
  }

  const toggleNormalize = (key: string) => {
    setNormalizeConfig((prev) => ({ ...prev, [key]: !prev[key] }))
    setPreview(null)
  }

  return (
    <Container strategy="grid" size="md">
      {confirmDlg.modal}
      <Box mb="md">
        <Title order={2}>Deduplicate Links</Title>
        <Text size="sm" c="dimmed" mt={4}>
          Detect and remove duplicate links
        </Text>
      </Box>

      {result && (
        <Alert color="green" title="Deduplication Complete" mb="md">
          Removed {result.duplicateCount} duplicates, {result.remainingCount} remaining.{' '}
          <Text component={Link} to="/history" size="sm" c="green" td="underline">
            View in history
          </Text>
        </Alert>
      )}

      {error && (
        <Alert color="red" title="Error" mb="md">
          {error}
        </Alert>
      )}

      <Stack gap="md">
        {/* Strategy */}
        <Card withBorder>
          <Text fw={600} mb="sm">
            Strategy
          </Text>
          <Radio.Group
            value={strategy}
            onChange={(v) => {
              setStrategy(v)
              setPreview(null)
            }}
          >
            <Stack gap="xs">
              {(['strict', 'normalized', 'smart'] as const).map((s) => (
                <Radio
                  key={s}
                  value={s}
                  label={
                    <Box>
                      <Text size="sm" fw={500} span>
                        {s.charAt(0).toUpperCase() + s.slice(1)}
                      </Text>
                      <Text size="xs" c="dimmed" span>
                        {' — '}
                        {strategyDescriptions[s]}
                      </Text>
                    </Box>
                  }
                />
              ))}
            </Stack>
          </Radio.Group>
        </Card>

        {/* Normalize Config */}
        {showNormalize && (
          <Card withBorder>
            <Text fw={600} mb="sm">
              Normalization Config
            </Text>
            <Grid>
              {Object.entries(normalizeLabels).map(([key, label]) => (
                <Grid.Col key={key} span={{ base: 12, sm: 6 }}>
                  <Checkbox
                    label={label}
                    checked={normalizeConfig[key]}
                    onChange={() => toggleNormalize(key)}
                  />
                </Grid.Col>
              ))}
            </Grid>
          </Card>
        )}

        {/* Sort + Actions */}
        <Card withBorder>
          <Group>
            <Button onClick={handlePreview} loading={loading}>
              Preview
            </Button>
            <Button
              color="red"
              onClick={async () => {
                const msg = preview
                  ? `Will mark ${preview.duplicateCount} duplicate links. This can be rolled back via operation history.`
                  : 'Will detect and mark all duplicate links. Consider previewing first. This can be rolled back via operation history.'
                const ok = await confirmDlg.confirm({
                  title: 'Confirm Deduplication',
                  message: msg,
                  confirmLabel: 'Execute',
                  confirmColor: 'red',
                })
                if (ok) handleExecute()
              }}
              disabled={executing}
            >
              Execute
            </Button>
          </Group>
        </Card>

        {/* Preview Results */}
        {preview && (
          <>
            <Grid>
              <Grid.Col span={6}>
                <Card withBorder>
                  <Text size="sm" c="dimmed">
                    Duplicates Found
                  </Text>
                  <Text fw={700} size="xl" c="red">
                    {preview.duplicateCount}
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

            {preview.groups.length > 0 && (
              <Card withBorder>
                <Text fw={600} mb="sm">
                  Duplicate Groups ({preview.groups.length})
                </Text>
                <Box mah={300} style={{ overflowY: 'auto' }}>
                  <Stack gap="xs">
                    {preview.groups.slice(0, MAX_GROUPS_DISPLAY).map((group, i) => (
                      <Card key={i} withBorder p="xs" bg="var(--mantine-color-gray-light)">
                        <Group gap="xs">
                          <Badge color="green" size="sm">
                            Keep: {group.keepId.slice(0, 8)}
                          </Badge>
                          <Badge color="orange" size="sm">
                            {group.duplicateIds.length} duplicate
                            {group.duplicateIds.length > 1 ? 's' : ''}
                          </Badge>
                        </Group>
                      </Card>
                    ))}
                    {preview.groups.length > MAX_GROUPS_DISPLAY && (
                      <Text size="sm" c="dimmed" ta="center" py="xs">
                        ...and {preview.groups.length - MAX_GROUPS_DISPLAY} more groups
                      </Text>
                    )}
                  </Stack>
                </Box>
              </Card>
            )}
          </>
        )}
      </Stack>
    </Container>
  )
}
