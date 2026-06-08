import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
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
  { value: 'duplicate_removed', label: 'Duplicate' },
  { value: 'filtered_internal', label: 'Internal' },
  { value: 'filtered_similar', label: 'Similar' },
  { value: 'dns_failed', label: 'DNS Failed' },
  { value: 'connection_refused', label: 'Refused' },
  { value: 'timeout', label: 'Timeout' },
  { value: 'success', label: 'Available' },
  { value: 'error', label: 'Error' },
]

const PAGE_SIZE = 50

const statusConfig: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'yellow' },
  imported: { label: 'Imported', color: 'blue' },
  duplicate_removed: { label: 'Duplicate', color: 'gray' },
  filtered_internal: { label: 'Internal', color: 'orange' },
  filtered_similar: { label: 'Similar', color: 'orange' },
  dns_failed: { label: 'DNS Failed', color: 'red' },
  connection_refused: { label: 'Refused', color: 'red' },
  timeout: { label: 'Timeout', color: 'red' },
  success: { label: 'Available', color: 'green' },
  error: { label: 'Error', color: 'red' },
}

type SortField = 'domain' | 'status' | 'source' | 'createdAt'
type SortDir = 'asc' | 'desc'

const LINK_FIELDS = [
  'id',
  'originalUrl',
  'normalizedUrl',
  'domain',
  'title',
  'source',
  'status',
  'tags',
  'isInternal',
  'duplicateOf',
  'similarityGroup',
  'createdAt',
  'updatedAt',
] as const

interface LinkItem {
  id: string
  originalUrl: string
  domain: string
  title: string | null
  source: string
  status: string
  tags: string
  createdAt: string
  [key: string]: unknown
}

export function LinksPage() {
  const [links, setLinks] = useState<LinkItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<string | undefined>(undefined)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Sorting (client-side)
  const [sortField, setSortField] = useState<SortField>('createdAt')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // Bulk actions
  const [showTagInput, setShowTagInput] = useState(false)
  const [tagValue, setTagValue] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  const [isTagging, setIsTagging] = useState(false)

  const fetchLinks = useCallback(async () => {
    setLoading(true)
    try {
      const result = await trpc.links.list.query({
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
        status: status || undefined,
        search: search || undefined,
      })
      setLinks(
        (result.links as LinkItem[]).map((link) => {
          const item: LinkItem = { ...link }
          for (const key of LINK_FIELDS) {
            if (!(key in item)) item[key] = ''
          }
          return item
        }),
      )
      setTotal(result.total)
    } finally {
      setLoading(false)
    }
  }, [page, status, search])

  useEffect(() => {
    fetchLinks()
  }, [fetchLinks])

  // Reset selection when data changes
  useEffect(() => {
    setSelectedIds(new Set())
  }, [page, status, search])

  const handleSearch = () => {
    setSearch(searchInput)
    setPage(1)
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  // Selection helpers
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allSelected = links.length > 0 && links.every((l) => selectedIds.has(l.id))
  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(links.map((l) => l.id)))
    }
  }

  const selectNone = () => setSelectedIds(new Set())
  const invertSelection = () => {
    setSelectedIds(new Set(links.filter((l) => !selectedIds.has(l.id)).map((l) => l.id)))
  }
  const selectAllPages = async () => {
    const { ids } = await trpc.links.getAllIds.query()
    setSelectedIds(new Set(ids))
  }

  // Sorting
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const sortedLinks = [...links].sort((a, b) => {
    const aVal = String(a[sortField] ?? '')
    const bVal = String(b[sortField] ?? '')
    const cmp = aVal.localeCompare(bVal)
    return sortDir === 'asc' ? cmp : -cmp
  })

  // Bulk operations
  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return
    setIsDeleting(true)
    try {
      await trpc.links.batchDelete.mutate({ ids: Array.from(selectedIds) })
      setSelectedIds(new Set())
      fetchLinks()
    } finally {
      setIsDeleting(false)
    }
  }

  const handleBatchTag = async () => {
    if (!tagValue.trim() || selectedIds.size === 0) return
    setIsTagging(true)
    try {
      for (const id of selectedIds) {
        const link = links.find((l) => l.id === id)
        if (!link) continue
        const existingTags: string[] = JSON.parse(link.tags || '[]')
        if (!existingTags.includes(tagValue.trim())) {
          existingTags.push(tagValue.trim())
        }
        await trpc.links.update.mutate({ id, data: { tags: JSON.stringify(existingTags) } })
      }
      setTagValue('')
      setShowTagInput(false)
      fetchLinks()
    } finally {
      setIsTagging(false)
    }
  }

  const parseTags = (tags: string): string[] => {
    try {
      const parsed = JSON.parse(tags)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  const SortableTh = ({ field, label }: { field: SortField; label: string }) => (
    <Table.Th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort(field)}>
      <Group gap={4} wrap="nowrap">
        <Text size="xs" fw={600} span>
          {label}
        </Text>
        {sortField === field && (
          <Text size="xs" span c="dimmed">
            {sortDir === 'asc' ? '▲' : '▼'}
          </Text>
        )}
      </Group>
    </Table.Th>
  )

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

      {/* Bulk actions bar */}
      {links.length > 0 && (
        <Card withBorder p="xs">
          <Group gap="xs" wrap="wrap">
            <Text size="xs" c="dimmed">
              Selected <strong>{selectedIds.size}</strong> / {total}
            </Text>

            <Badge size="xs" variant="light" style={{ cursor: 'pointer' }} onClick={toggleAll}>
              本页全选
            </Badge>
            {totalPages > 1 && (
              <Badge
                size="xs"
                variant="light"
                style={{ cursor: 'pointer' }}
                onClick={selectAllPages}
              >
                All Pages
              </Badge>
            )}
            <Badge
              size="xs"
              variant="light"
              style={{ cursor: 'pointer' }}
              onClick={invertSelection}
            >
              Invert
            </Badge>
            <Badge size="xs" variant="light" style={{ cursor: 'pointer' }} onClick={selectNone}>
              None
            </Badge>

            <Select
              size="xs"
              placeholder="Filter by status"
              data={STATUS_OPTIONS.filter((o) => o.value)}
              w={150}
              onChange={(v) => {
                if (v) {
                  setStatus(v)
                  setPage(1)
                }
              }}
              clearable
              value=""
            />

            {selectedIds.size > 0 && (
              <>
                {showTagInput ? (
                  <Group gap={4}>
                    <TextInput
                      size="xs"
                      w={120}
                      placeholder="Tag name"
                      value={tagValue}
                      onChange={(e) => setTagValue(e.currentTarget.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleBatchTag()}
                      autoFocus
                      disabled={isTagging}
                    />
                    <Button size="xs" onClick={handleBatchTag} disabled={isTagging}>
                      {isTagging ? 'Adding...' : 'Add'}
                    </Button>
                    <Button
                      size="xs"
                      variant="subtle"
                      onClick={() => setShowTagInput(false)}
                      disabled={isTagging}
                    >
                      Cancel
                    </Button>
                  </Group>
                ) : (
                  <Button size="xs" variant="outline" onClick={() => setShowTagInput(true)}>
                    Batch Tag
                  </Button>
                )}

                <Button
                  size="xs"
                  color="red"
                  onClick={() => {
                    if (confirm(`Delete ${selectedIds.size} selected links?`)) {
                      handleBatchDelete()
                    }
                  }}
                  loading={isDeleting}
                >
                  Batch Delete
                </Button>
              </>
            )}
          </Group>
        </Card>
      )}

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
            <Table striped highlightOnHover style={{ tableLayout: 'fixed', width: '100%' }}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={36}>
                    <Checkbox checked={allSelected} onChange={toggleAll} />
                  </Table.Th>
                  <Table.Th w={36}>#</Table.Th>
                  <Table.Th style={{ width: '30%' }}>URL</Table.Th>
                  <SortableTh field="domain" label="Domain" />
                  <SortableTh field="status" label="Status" />
                  <Table.Th>Tags</Table.Th>
                  <SortableTh field="source" label="Source" />
                  <SortableTh field="createdAt" label="Time" />
                  <Table.Th w={70}>Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {sortedLinks.map((link, i) => (
                  <Table.Tr
                    key={link.id}
                    bg={selectedIds.has(link.id) ? 'var(--mantine-color-blue-light)' : undefined}
                  >
                    <Table.Td>
                      <Checkbox
                        checked={selectedIds.has(link.id)}
                        onChange={() => toggleSelect(link.id)}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {(page - 1) * PAGE_SIZE + i + 1}
                      </Text>
                    </Table.Td>
                    <Table.Td
                      style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      <a
                        href={link.originalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: 'block',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          color: 'var(--mantine-color-blue-6)',
                          textDecoration: 'none',
                          fontSize: 'var(--mantine-font-size-xs)',
                        }}
                        title={link.originalUrl}
                      >
                        {link.originalUrl}
                      </a>
                    </Table.Td>
                    <Table.Td
                      style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      <Text size="xs">{link.domain}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        color={(statusConfig[link.status]?.color ?? 'gray') as string}
                        variant="light"
                        size="sm"
                      >
                        {statusConfig[link.status]?.label ?? link.status}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4} wrap="wrap">
                        {parseTags(link.tags).map((tag) => (
                          <Badge key={tag} variant="default" size="sm">
                            {tag}
                          </Badge>
                        ))}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {String(link.source).toUpperCase()}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {new Date(link.createdAt.replace(' ', 'T') + 'Z').toLocaleString()}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        color="red"
                        onClick={async () => {
                          await trpc.links.delete.mutate(link.id)
                          fetchLinks()
                        }}
                        title="Delete"
                      >
                        ✕
                      </ActionIcon>
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
