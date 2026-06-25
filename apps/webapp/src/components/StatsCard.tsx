import { Card, Skeleton, Text } from '@mantine/core'

interface StatsCardProps {
  label: string
  value: number | string
  color?: string
  bg?: string
  loading?: boolean
}

export function StatsCard({ label, value, color, bg, loading }: StatsCardProps) {
  return (
    <Card withBorder p="lg" bg={bg}>
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      {loading ? (
        <Skeleton height={28} width="55%" mt="xs" />
      ) : (
        <Text fw={700} size="xl" mt="xs" c={color}>
          {value}
        </Text>
      )}
    </Card>
  )
}
