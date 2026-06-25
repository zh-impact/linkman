import { Box, Card, Checkbox, Group } from '@mantine/core'
import type { ReactNode } from 'react'

interface ExpandableGroupCardProps {
  expanded: boolean
  onToggleExpand: () => void
  selected?: boolean
  onToggleSelect?: () => void
  header: ReactNode
  headerRight?: ReactNode
  children?: ReactNode
  expandedBg?: string
  selectedBg?: string
  defaultBg?: string
}

export function ExpandableGroupCard({
  expanded,
  onToggleExpand,
  selected,
  onToggleSelect,
  header,
  headerRight,
  children,
  expandedBg = 'var(--mantine-color-violet-light)',
  selectedBg = 'var(--mantine-color-blue-light)',
  defaultBg = 'var(--mantine-color-gray-light)',
}: ExpandableGroupCardProps) {
  const bg = selected ? selectedBg : expanded ? expandedBg : defaultBg

  return (
    <Card withBorder p="xs" bg={bg}>
      <Group justify="space-between" style={{ cursor: 'pointer' }} onClick={onToggleExpand}>
        <Group gap="xs">
          {onToggleSelect && (
            <Checkbox
              checked={selected}
              onChange={(e) => {
                e.stopPropagation()
                onToggleSelect()
              }}
            />
          )}
          {header}
        </Group>
        {headerRight && <Group gap="xs">{headerRight}</Group>}
      </Group>
      {expanded && children && (
        <Box
          mt="xs"
          pt="xs"
          style={{ borderTop: '1px solid var(--mantine-color-gray-3)' }}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </Box>
      )}
    </Card>
  )
}
