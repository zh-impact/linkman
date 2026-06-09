import { Button, createTheme } from '@mantine/core'

export const theme = createTheme({
  /** Put your mantine theme override here */
  defaultRadius: 'xs',
  components: {
    Button: Button.extend({
      defaultProps: {
        // radius: 'xs',
      },
    }),
  },
})
