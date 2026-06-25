import { Box, Group, Loader, Text } from '@mantine/core'
import { useVirtualizer } from '@tanstack/react-virtual'
import { type ReactNode, useRef } from 'react'

interface VirtualListProps {
  items: string[]
  rowHeight?: number
  overscan?: number
  scrollHeight?: string
  renderItem: (item: string, index: number) => ReactNode
  header?: ReactNode
  total?: number
  onLoadMore?: () => void
  loadingMore?: boolean
  loadMoreThreshold?: number
}

export function VirtualList({
  items,
  rowHeight = 22,
  overscan = 10,
  scrollHeight,
  renderItem,
  header,
  total,
  onLoadMore,
  loadingMore,
  loadMoreThreshold = 20,
}: VirtualListProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const loadingTriggered = useRef(false)

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan,
  })

  const virtualItems = virtualizer.getVirtualItems()
  const lastVisibleIndex = virtualItems.length > 0 ? virtualItems[virtualItems.length - 1].index : 0

  const canLoadMore = total !== undefined && onLoadMore && items.length < total
  if (
    canLoadMore &&
    !loadingMore &&
    !loadingTriggered.current &&
    lastVisibleIndex >= items.length - loadMoreThreshold
  ) {
    loadingTriggered.current = true
    onLoadMore()
  }
  if (!loadingMore) {
    loadingTriggered.current = false
  }

  return (
    <>
      {header}
      <Box
        ref={parentRef}
        style={{
          height: scrollHeight,
          maxHeight: scrollHeight ? undefined : 300,
          overflow: 'auto',
        }}
      >
        <Box
          style={{
            height: virtualizer.getTotalSize(),
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualItems.map((item) => (
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
              {renderItem(items[item.index], item.index)}
            </Box>
          ))}
        </Box>
      </Box>
      {loadingMore && (
        <Group justify="center" py="xs">
          <Loader size="xs" />
        </Group>
      )}
    </>
  )
}

interface VirtualLineProps {
  index: number
  showLineNumbers?: boolean
  children: ReactNode
}

export function VirtualLine({ index, showLineNumbers, children }: VirtualLineProps) {
  return (
    <Box
      style={{
        display: 'flex',
        height: 22,
        fontFamily: 'var(--mantine-font-family-monospace)',
        fontSize: 'var(--mantine-font-size-xs)',
        lineHeight: '22px',
      }}
    >
      {showLineNumbers && (
        <Text
          c="dimmed"
          ta="right"
          w={60}
          px="xs"
          style={{
            flexShrink: 0,
            userSelect: 'none',
            borderRight: '1px solid var(--mantine-color-gray-2)',
          }}
        >
          {index + 1}
        </Text>
      )}
      {children}
    </Box>
  )
}
