import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Container,
  Divider,
  Group,
  Loader,
  Menu,
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
import { useConfirm } from '../utils/use-confirm'

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
type ViewMode = 'table' | 'grouped'

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

// --- Grouped view helpers ---

interface GroupData {
  key: string
  links: LinkItem[]
}

function groupLinks(links: LinkItem[]): GroupData[] {
  const map = new Map<string, LinkItem[]>()
  for (const link of links) {
    const key = (link.similarityGroup as string) || link.domain
    const existing = map.get(key)
    if (existing) {
      existing.push(link)
    } else {
      map.set(key, [link])
    }
  }
  return Array.from(map.entries())
    .map(([key, items]) => ({ key, links: items }))
    .sort((a, b) => b.links.length - a.links.length)
}

function GroupCard({
  group,
  selectedIds,
  toggleSelect,
  onDelete,
}: {
  group: GroupData
  selectedIds: Set<string>
  toggleSelect: (id: string) => void
  onDelete: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const allSelected = group.links.every((l) => selectedIds.has(l.id))

  const toggleGroupSelect = () => {
    if (allSelected) {
      group.links.forEach((l) => {
        if (selectedIds.has(l.id)) toggleSelect(l.id)
      })
    } else {
      group.links.forEach((l) => {
        if (!selectedIds.has(l.id)) toggleSelect(l.id)
      })
    }
  }

  const previewLinks = group.links.slice(0, 3)
  const extraLinks = group.links.slice(3)

  return (
    <Card withBorder>
      <Group gap="xs" p="xs">
        <Checkbox checked={allSelected} onChange={toggleGroupSelect} />
        <Text fw={600} size="sm" style={{ flex: 1 }}>
          {group.key}
        </Text>
        <Badge variant="light" size="sm">
          {group.links.length}
        </Badge>
        {extraLinks.length > 0 && (
          <ActionIcon
            size="sm"
            variant="subtle"
            onClick={() => setOpen(!open)}
            title={open ? 'Collapse' : `${extraLinks.length} more...`}
          >
            {open ? '▲' : '▼'}
          </ActionIcon>
        )}
      </Group>
      <Divider />
      {previewLinks.map((link) => (
        <GroupItem
          key={link.id}
          link={link}
          selected={selectedIds.has(link.id)}
          onToggle={() => toggleSelect(link.id)}
          onDelete={() => onDelete(link.id)}
        />
      ))}
      {open &&
        extraLinks.map((link) => (
          <GroupItem
            key={link.id}
            link={link}
            selected={selectedIds.has(link.id)}
            onToggle={() => toggleSelect(link.id)}
            onDelete={() => onDelete(link.id)}
          />
        ))}
      {extraLinks.length > 0 && !open && (
        <Button
          variant="subtle"
          size="xs"
          fullWidth
          onClick={() => setOpen(true)}
          style={{ borderTop: '1px solid var(--mantine-color-gray-3)' }}
        >
          {extraLinks.length} more...
        </Button>
      )}
      {open && extraLinks.length > 0 && (
        <Button
          variant="subtle"
          size="xs"
          fullWidth
          onClick={() => setOpen(false)}
          style={{ borderTop: '1px solid var(--mantine-color-gray-3)' }}
        >
          Collapse
        </Button>
      )}
    </Card>
  )
}

function GroupItem({
  link,
  selected,
  onToggle,
  onDelete,
}: {
  link: LinkItem
  selected: boolean
  onToggle: () => void
  onDelete: () => void
}) {
  return (
    <Group
      gap="xs"
      px="xs"
      py={4}
      bg={selected ? 'var(--mantine-color-blue-light)' : undefined}
      style={{ borderBottom: '1px solid var(--mantine-color-gray-2)' }}
    >
      <Checkbox checked={selected} onChange={onToggle} />
      <a
        href={link.originalUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          flex: 1,
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
      <Badge
        color={(statusConfig[link.status]?.color ?? 'gray') as string}
        variant="light"
        size="sm"
      >
        {statusConfig[link.status]?.label ?? link.status}
      </Badge>
      <ActionIcon size="xs" variant="subtle" color="red" onClick={onDelete} title="Delete">
        ✕
      </ActionIcon>
    </Group>
  )
}

// --- Main page ---

export function LinksPage() {
  const [links, setLinks] = useState<LinkItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<string | undefined>(undefined)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')

  // View mode
  const [viewMode, setViewMode] = useState<ViewMode>('table')

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
  const confirmDlg = useConfirm()

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

  // Grouped data
  const groupedLinks = groupLinks(sortedLinks)

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

  const handleDelete = async (id: string) => {
    await trpc.links.delete.mutate(id)
    fetchLinks()
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

  const [exporting, setExporting] = useState(false)

  const handleExport = async (format: 'json' | 'csv', scope: 'all' | 'filtered' | 'selected') => {
    setExporting(true)
    try {
      const input: { format: 'json' | 'csv'; status?: string; ids?: string[] } = { format }
      if (scope === 'selected') {
        input.ids = Array.from(selectedIds)
      } else if (scope === 'filtered' && status) {
        input.status = status
      }
      const res = await trpc.links.export.query(input)
      const blob = new Blob([res.data], {
        type: format === 'csv' ? 'text/csv' : 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `links.${format}`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  return (
    <Container strategy="grid" size="lg">
      {confirmDlg.modal}
      <Group justify="space-between" mb="md">
        <Group gap="md">
          <Title order={2}>Links</Title>
          <Text size="sm" c="dimmed">
            {total} total
          </Text>
        </Group>
        <Group gap={4}>
          <Button
            size="xs"
            variant={viewMode === 'table' ? 'filled' : 'subtle'}
            onClick={() => setViewMode('table')}
          >
            Table
          </Button>
          <Button
            size="xs"
            variant={viewMode === 'grouped' ? 'filled' : 'subtle'}
            onClick={() => setViewMode('grouped')}
          >
            Grouped
          </Button>
          <Menu shadow="md" width={220}>
            <Menu.Target>
              <Button size="xs" variant="outline" loading={exporting}>
                Export
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>Current View</Menu.Label>
              <Menu.Item onClick={() => handleExport('csv', 'filtered')}>Export as CSV</Menu.Item>
              <Menu.Item onClick={() => handleExport('json', 'filtered')}>Export as JSON</Menu.Item>
              {selectedIds.size > 0 && (
                <>
                  <Menu.Divider />
                  <Menu.Label>Selected ({selectedIds.size} items)</Menu.Label>
                  <Menu.Item onClick={() => handleExport('csv', 'selected')}>
                    Export selected as CSV
                  </Menu.Item>
                  <Menu.Item onClick={() => handleExport('json', 'selected')}>
                    Export selected as JSON
                  </Menu.Item>
                </>
              )}
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>

      <Group mb="md">
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
        <Card withBorder p="sm" mb="md">
          <Group gap="sm" wrap="wrap">
            <Text size="sm" c="dimmed">
              Selected <strong>{selectedIds.size}</strong> / {total}
            </Text>

            <Badge size="sm" variant="light" style={{ cursor: 'pointer' }} onClick={toggleAll}>
              All
            </Badge>
            {totalPages > 1 && (
              <Badge
                size="sm"
                variant="light"
                style={{ cursor: 'pointer' }}
                onClick={selectAllPages}
              >
                All Pages
              </Badge>
            )}
            <Badge
              size="sm"
              variant="light"
              style={{ cursor: 'pointer' }}
              onClick={invertSelection}
            >
              Invert
            </Badge>
            <Badge size="sm" variant="light" style={{ cursor: 'pointer' }} onClick={selectNone}>
              None
            </Badge>

            {selectedIds.size > 0 && (
              <>
                {showTagInput ? (
                  <Group gap={4}>
                    <TextInput
                      size="sm"
                      w={140}
                      placeholder="Tag name"
                      value={tagValue}
                      onChange={(e) => setTagValue(e.currentTarget.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleBatchTag()}
                      autoFocus
                      disabled={isTagging}
                    />
                    <Button size="sm" onClick={handleBatchTag} disabled={isTagging}>
                      {isTagging ? 'Adding...' : 'Add'}
                    </Button>
                    <Button
                      size="sm"
                      variant="subtle"
                      onClick={() => setShowTagInput(false)}
                      disabled={isTagging}
                    >
                      Cancel
                    </Button>
                  </Group>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setShowTagInput(true)}>
                    Batch Tag
                  </Button>
                )}

                <Button
                  size="sm"
                  color="red"
                  onClick={async () => {
                    const ok = await confirmDlg.confirm({
                      title: 'Confirm Delete',
                      message: `Delete ${selectedIds.size} selected links? This can be undone via rollback.`,
                      confirmLabel: 'Delete',
                      confirmColor: 'red',
                    })
                    if (ok) handleBatchDelete()
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

      {loading ? (
        <Loader />
      ) : viewMode === 'table' ? (
        <Stack gap="md">
          <Box style={{ overflowX: 'auto' }}>
            <Table
              striped
              highlightOnHover
              style={{ tableLayout: 'fixed', width: '100%', minWidth: 900 }}
            >
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={40}>
                    <Checkbox checked={allSelected} onChange={toggleAll} />
                  </Table.Th>
                  <Table.Th w={40}>#</Table.Th>
                  <Table.Th style={{ width: '35%' }}>URL</Table.Th>
                  <SortableTh field="domain" label="Domain" />
                  <SortableTh field="status" label="Status" />
                  <Table.Th>Tags</Table.Th>
                  <SortableTh field="source" label="Source" />
                  <SortableTh field="createdAt" label="Time" />
                  <Table.Th w={80}>Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {sortedLinks.length === 0 ? (
                  <Table.Tr>
                    <Table.Td colSpan={9}>
                      <Text c="dimmed" ta="center" py="md">
                        No links found.
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ) : (
                  sortedLinks.map((link, i) => (
                    <Table.Tr
                      key={link.id}
                      bg={selectedIds.has(link.id) ? 'var(--mantine-color-blue-light)' : undefined}
                      style={{ height: 48 }}
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
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
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
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
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
                          onClick={() => handleDelete(link.id)}
                          title="Delete"
                        >
                          ✕
                        </ActionIcon>
                      </Table.Td>
                    </Table.Tr>
                  ))
                )}
              </Table.Tbody>
            </Table>
          </Box>

          {totalPages > 1 && (
            <Group justify="center">
              <Pagination value={page} onChange={setPage} total={totalPages} />
            </Group>
          )}
        </Stack>
      ) : (
        /* Grouped view */
        <Stack gap="md">
          {groupedLinks.length === 0 ? (
            <Text c="dimmed">No groups.</Text>
          ) : (
            groupedLinks.map((group) => (
              <GroupCard
                key={group.key}
                group={group}
                selectedIds={selectedIds}
                toggleSelect={toggleSelect}
                onDelete={handleDelete}
              />
            ))
          )}

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
