import { Alert, Container, Paper, Stack, Text, Title } from '@mantine/core'
import { useState } from 'react'
import { useConfirm } from '../utils/use-confirm'
import { AuditPruneSection } from './settings/AuditPruneSection'
import { DatabasePruneSection } from './settings/DatabasePruneSection'
import { FilesPruneSection } from './settings/FilesPruneSection'
import { LinksPruneSection } from './settings/LinksPruneSection'

export function SettingsPage() {
  const confirmDlg = useConfirm()
  // Bumped after any successful prune execute. Each section watches this
  // value in its own useEffect to refetch — link prunes affect the DB total,
  // DB prunes zero out links, files prunes reduce the DB job count.
  const [pruneVersion, setPruneVersion] = useState(0)
  const onPruned = () => setPruneVersion((v) => v + 1)

  return (
    <Container strategy="grid" size="lg">
      <Title order={2} mb="md">
        Settings
      </Title>

      {/* TODO: replace ⚠ with @tabler/icons-react IconAlertTriangle once the lib is added */}
      <Alert color="red" variant="filled" title="⚠ DANGER ZONE" mb="md">
        These operations are irreversible. Each requires dry-run preview plus confirmation before it takes
        effect.
      </Alert>

      <Stack gap="md">
        <Paper withBorder p="md">
          <Stack gap="xs">
            <Title order={5}>Links</Title>
            <Text size="sm" c="dimmed">
              Remove links by category. Affects only the <code>links</code> table; cascades associated{' '}
              <code>test_results</code> rows via foreign key.
            </Text>
            <LinksPruneSection confirmDlg={confirmDlg} pruneVersion={pruneVersion} onPruned={onPruned} />
          </Stack>
        </Paper>

        <Paper withBorder p="md">
          <Stack gap="xs">
            <Title order={5}>Database</Title>
            <Text size="sm" c="dimmed">
              Clear <code>links</code> and <code>import_jobs</code> tables in one transaction. Preserves{' '}
              <code>operations</code> and <code>snapshots</code> history — use the Audit history section below
              to clear those.
            </Text>
            <DatabasePruneSection confirmDlg={confirmDlg} pruneVersion={pruneVersion} onPruned={onPruned} />
          </Stack>
        </Paper>

        <Paper withBorder p="md">
          <Stack gap="xs">
            <Title order={5}>Files</Title>
            <Text size="sm" c="dimmed">
              Delete every file in <code>data/files/</code> and the matching <code>import_jobs</code> rows.
              Does <strong>not</strong> touch <code>links</code> rows — use the Database section for that.
            </Text>
            <FilesPruneSection confirmDlg={confirmDlg} pruneVersion={pruneVersion} onPruned={onPruned} />
          </Stack>
        </Paper>

        <Paper withBorder p="md">
          <Stack gap="xs">
            <Title order={5}>Audit history</Title>
            <Text size="sm" c="dimmed">
              Clear <code>operations</code> and <code>snapshots</code> tables in one transaction. Does{' '}
              <strong>not</strong> touch <code>links</code>, <code>import_jobs</code>, or{' '}
              <code>test_results</code>. Rollback history will be lost.
            </Text>
            <AuditPruneSection confirmDlg={confirmDlg} pruneVersion={pruneVersion} onPruned={onPruned} />
          </Stack>
        </Paper>
      </Stack>

      {confirmDlg.modal}
    </Container>
  )
}
