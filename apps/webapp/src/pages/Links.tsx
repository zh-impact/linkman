import {
  Badge,
  Box,
  Button,
  Container,
  Group,
  Loader,
  Pagination,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { useCallback, useEffect, useState } from 'react'
import { trpc } from '../utils/trpc-client'

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'imported', label: 'Imported' },
  { value: 'duplicate_removed', label: 'Duplicate Removed' },
  { value: 'filtered_internal', label: 'Filtered Internal' },
  { value: 'filtered_similar', label: 'Filtered Similar' },
  { value: 'dns_failed', label: 'DNS Failed' },
  { value: 'connection_refused', label: 'Connection Refused' },
  { value: 'timeout', label: 'Timeout' },
  { value: 'success', label: 'Success' },
  { value: 'error', label: 'Error' },
]

const PAGE_SIZE = 50

const statusColor = (status: string) => {
  const map: Record<string, string> = {
    pending: 'gray',
    imported: 'blue',
    success: 'green',
    error: 'red',
    duplicate_removed: 'orange',
    filtered_internal: 'yellow',
    filtered_similar: 'violet',
    dns_failed: 'red',
    connection_refused: 'red',
    timeout: 'red',
  }
  return map[status] ?? 'gray'
}

interface LinkItem {
  id: string
  originalUrl: string
  domain: string
  title: string | null
  status: string
  createdAt: string
}

export function LinksPage() {
  const [links, setLinks] = useState<LinkItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<string | undefined>(undefined)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')

  const fetchLinks = useCallback(async () => {
    setLoading(true)
    try {
      const result = await trpc.links.list.query({
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
        status: status || undefined,
        search: search || undefined,
      })
      setLinks(result.links as LinkItem[])
      setTotal(result.total)
    } finally {
      setLoading(false)
    }
  }, [page, status, search])

  useEffect(() => {
    fetchLinks()
  }, [fetchLinks])

  const handleSearch = () => {
    setSearch(searchInput)
    setPage(1)
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <Container strategy="grid" size="lg" styles={{ root: { gap: 'var(--mantine-spacing-xs)' } }}>
      <Box h={50}>
        <Title order={2}>Links</Title>
      </Box>

      <Group>
        <TextInput
          placeholder="Search URLs, domains, titles..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          style={{ flex: 1 }}
        />
        <Button onClick={handleSearch}>Search</Button>
        <Select
          placeholder="Filter by status"
          data={STATUS_OPTIONS}
          value={status || ''}
          onChange={(v) => {
            setStatus(v || undefined)
            setPage(1)
          }}
          clearable
          w={200}
        />
      </Group>
      <Text size="sm" c="dimmed" mb="xs">
        {total} links found
      </Text>

      {loading ? (
        <Loader />
      ) : links.length === 0 ? (
        <Text c="dimmed">No links found.</Text>
      ) : (
        <Stack gap="md">
          <Box style={{ overflowX: 'auto' }}>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>URL</Table.Th>
                  <Table.Th>Domain</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Created</Table.Th>
                  <Table.Th>Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {links.map((link) => (
                  <Table.Tr key={link.id}>
                    <Table.Td>
                      <Text size="xs" lineClamp={1} title={link.originalUrl}>
                        {link.title || link.originalUrl}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" fw={500}>
                        {link.domain}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={statusColor(link.status)} variant="light" size="sm">
                        {link.status}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {link.createdAt}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Button
                        size="xs"
                        variant="subtle"
                        color="red"
                        onClick={async () => {
                          await trpc.links.delete.mutate(link.id)
                          fetchLinks()
                        }}
                      >
                        Delete
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Box>

          {totalPages > 1 && (
            <Group justify="center">
              <Pagination value={page} onChange={setPage} total={totalPages} />
            </Group>
          )}
        </Stack>
      )}
    </Container>
  )
}
