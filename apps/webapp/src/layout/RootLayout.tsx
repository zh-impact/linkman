import {
  AppShell,
  Burger,
  Container,
  Group,
  MantineProvider,
  Text,
  UnstyledButton,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { NavLink, Outlet } from 'react-router'
import classes from './RootLayout.module.css'

export function RootLayout() {
  const [opened, { toggle }] = useDisclosure()

  return (
    <MantineProvider>
      <AppShell
        padding="md"
        header={{ height: 60 }}
        navbar={{
          width: 300,
          breakpoint: 'sm',
          collapsed: { desktop: true, mobile: !opened },
        }}
      >
        <AppShell.Header>
          <Container strategy="grid" size="lg" h="100%">
            <Group h="100%" justify="space-between" wrap="nowrap">
              <Group gap="xs" wrap="nowrap">
                <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
                <Text fw={700}>LinkMan</Text>
                <Group ml="xl" gap="xs" visibleFrom="sm">
                  <UnstyledButton component={NavLink} to="/" className={classes.control}>
                    Dashboard
                  </UnstyledButton>
                  <UnstyledButton component={NavLink} to="/links" className={classes.control}>
                    Links
                  </UnstyledButton>
                  <UnstyledButton component={NavLink} to="/import" className={classes.control}>
                    Import
                  </UnstyledButton>
                  <UnstyledButton component={NavLink} to="/files" className={classes.control}>
                    Files
                  </UnstyledButton>
                  <UnstyledButton component={NavLink} to="/dedup" className={classes.control}>
                    Dedup
                  </UnstyledButton>
                  <UnstyledButton component={NavLink} to="/filter" className={classes.control}>
                    Filter
                  </UnstyledButton>
                  <UnstyledButton component={NavLink} to="/history" className={classes.control}>
                    History
                  </UnstyledButton>
                </Group>
              </Group>
            </Group>
          </Container>
        </AppShell.Header>

        <AppShell.Navbar p="md">
          Navbar is collapsed on mobile at sm breakpoint. At that point it is no longer offset by
          padding in the main element and it takes the full width of the screen when opened.
        </AppShell.Navbar>

        <AppShell.Main>
          <Outlet />
        </AppShell.Main>
      </AppShell>
    </MantineProvider>
  )
}
