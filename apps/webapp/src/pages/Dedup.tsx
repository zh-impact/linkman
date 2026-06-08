import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Container,
  Grid,
  Group,
  Loader,
  Radio,
  Select,
  Stack,
  Text,
  Title,
} from '@mantine/core'
import { useState } from 'react'
import { trpc } from '../utils/trpc-client'

export function DedupPage() {
  const [strategy, setStrategy] = useState('normalized')
  const [sort, setSort] = useState('original')
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

  const handlePreview = async () => {
    setLoading(true)
    setError('')
    setPreview(null)
    setResult(null)
    try {
      const data = await trpc.deduplicate.preview.query({
        strategy: strategy as 'strict' | 'normalized' | 'smart',
        sort: sort as 'original' | 'alphabetical' | 'domain',
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
      })
      setResult(data)
      setPreview(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deduplication failed')
    } finally {
      setExecuting(false)
    }
  }

  return (
    <Container strategy="grid" size="md">
      <Title order={2} mb="md">
        Deduplicate Links
      </Title>

      <Card withBorder mb="md">
        <Stack>
          <Box>
            <Text fw={500} mb="xs">
              Strategy
            </Text>
            <Radio.Group value={strategy} onChange={setStrategy}>
              <Stack gap="xs">
                <Radio value="strict" label="Strict — exact URL match" />
                <Radio value="normalized" label="Normalized — normalize before comparing" />
                <Radio value="smart" label="Smart — normalize www and trailing slash only" />
              </Stack>
            </Radio.Group>
          </Box>

          <Box>
            <Text fw={500} mb="xs">
              Sort Order
            </Text>
            <Select
              data={[
                { value: 'original', label: 'Original order' },
                { value: 'alphabetical', label: 'Alphabetical' },
                { value: 'domain', label: 'By domain' },
              ]}
              value={sort}
              onChange={(v) => setSort(v ?? 'original')}
              w={200}
            />
          </Box>

          <Group>
            <Button onClick={handlePreview} loading={loading}>
              Preview
            </Button>
            {preview && (
              <Button color="red" onClick={handleExecute} loading={executing}>
                Execute Deduplication ({preview.duplicateCount} duplicates)
              </Button>
            )}
          </Group>
        </Stack>
      </Card>

      {error && (
        <Alert color="red" title="Error" mb="md">
          {error}
        </Alert>
      )}

      {preview && (
        <Stack gap="md">
          <Grid>
            <Grid.Col span={6}>
              <Card withBorder>
                <Text size="sm" c="dimmed">
                  Duplicates Found
                </Text>
                <Text fw={700} size="xl" c="orange">
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

          <Card withBorder>
            <Text fw={500} mb="xs">
              Duplicate Groups ({preview.groups.length})
            </Text>
            <Stack gap="xs" mah={400} style={{ overflowY: 'auto' }}>
              {preview.groups.map((group, i) => (
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
            </Stack>
          </Card>
        </Stack>
      )}

      {result && (
        <Alert color="green" title="Deduplication Complete">
          <Text>
            Removed {result.duplicateCount} duplicates. {result.remainingCount} links remaining.
          </Text>
        </Alert>
      )}
    </Container>
  )
}
