import { Button, Group, Modal, Stack, Text } from '@mantine/core'
import { useState, useCallback } from 'react'

interface ConfirmState {
  opened: boolean
  title: string
  message: string
  confirmLabel: string
  confirmColor: string
  onConfirm: () => void
}

const initialState: ConfirmState = {
  opened: false,
  title: '',
  message: '',
  confirmLabel: 'Confirm',
  confirmColor: 'blue',
  onConfirm: () => {},
}

export function useConfirm() {
  const [state, setState] = useState<ConfirmState>(initialState)

  const confirm = useCallback(
    (opts: { title: string; message: string; confirmLabel?: string; confirmColor?: string }) => {
      return new Promise<boolean>((resolve) => {
        setState({
          opened: true,
          title: opts.title,
          message: opts.message,
          confirmLabel: opts.confirmLabel ?? 'Confirm',
          confirmColor: opts.confirmColor ?? 'blue',
          onConfirm: () => {
            setState((s) => ({ ...s, opened: false }))
            resolve(true)
          },
        })
      })
    },
    [],
  )

  const cancel = useCallback(() => {
    setState(initialState)
  }, [])

  const modal = (
    <Modal
      opened={state.opened}
      onClose={cancel}
      title={state.title}
      size="sm"
      centered
      overlayProps={{ backgroundOpacity: 0.3 }}
    >
      <Stack>
        <Text size="sm">{state.message}</Text>
        <Group justify="flex-end" gap="xs">
          <Button variant="default" size="sm" onClick={cancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            color={state.confirmColor}
            onClick={state.onConfirm}
          >
            {state.confirmLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )

  return { confirm, modal }
}
