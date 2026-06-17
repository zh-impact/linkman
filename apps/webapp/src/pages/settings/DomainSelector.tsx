import { Box, Checkbox, Group, Loader, Stack, Text } from '@mantine/core'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { trpc } from '../../utils/trpc-client'

interface DomainCount {
  domain: string
  count: number
}

/**
 * Virtualized multi-select for domains. Renders ~5k+ rows smoothly via
 * @tanstack/react-virtual. Each row is a checkbox + domain name + count.
 *
 * Controlled component — the parent owns `selected` and reacts to changes
 * via `onChange`. The internal Set is just a lookup optimization.
 */
export function DomainSelector({
  selected,
  onChange,
}: {
  selected: string[]
  onChange: (next: string[]) => void
}) {
  const [domains, setDomains] = useState<DomainCount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const parentRef = useRef<HTMLDivElement>(null)

  const fetchDomains = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await trpc.prune.domains.query()
      setDomains(data as DomainCount[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load domains')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchDomains()
  }, [fetchDomains])

  const selectedSet = useMemo(() => new Set(selected), [selected])

  const toggleDomain = useCallback(
    (domain: string) => {
      const next = new Set(selectedSet)
      if (next.has(domain)) next.delete(domain)
      else next.add(domain)
      onChange([...next])
    },
    [selectedSet, onChange],
  )

  const allSelected = domains.length > 0 && selectedSet.size === domains.length
  const toggleAll = useCallback(() => {
    if (allSelected) onChange([])
    else onChange(domains.map((d) => d.domain))
  }, [allSelected, domains, onChange])

  const virtualizer = useVirtualizer({
    count: domains.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 16,
  })

  if (loading) {
    return (
      <Stack gap={4} align="center" py="sm">
        <Loader size="sm" />
        <Text size="xs" c="dimmed">
          Loading domains…
        </Text>
      </Stack>
    )
  }

  if (error) {
    return (
      <Text size="xs" c="red">
        {error}
      </Text>
    )
  }

  if (domains.length === 0) {
    return (
      <Text size="xs" c="dimmed">
        No domains available.
      </Text>
    )
  }

  return (
    <Stack gap={4}>
      <Group justify="space-between" wrap="nowrap">
        <Checkbox
          label={allSelected ? 'Clear selection' : 'Select all'}
          checked={allSelected}
          indeterminate={selectedSet.size > 0 && !allSelected}
          onChange={toggleAll}
          size="xs"
        />
        <Text size="xs" c="dimmed">
          {selectedSet.size} / {domains.length} selected
        </Text>
      </Group>
      <Box
        ref={parentRef}
        style={{
          height: 400,
          overflowY: 'auto',
          borderTop: '1px solid var(--mantine-color-gray-3)',
          borderBottom: '1px solid var(--mantine-color-gray-3)',
        }}
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((vItem) => {
            const row = domains[vItem.index]
            if (!row) return null
            const checked = selectedSet.has(row.domain)
            return (
              <div
                key={row.domain}
                data-index={vItem.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${vItem.start}px)`,
                }}
              >
                <Checkbox
                  label={
                    <Group gap="xs" wrap="nowrap">
                      <Text size="xs" ff="monospace" truncate>
                        {row.domain}
                      </Text>
                      <Text size="xs" c="dimmed">
                        ({row.count})
                      </Text>
                    </Group>
                  }
                  checked={checked}
                  onChange={() => toggleDomain(row.domain)}
                  size="xs"
                  pr="sm"
                  py={2}
                />
              </div>
            )
          })}
        </div>
      </Box>
    </Stack>
  )
}
