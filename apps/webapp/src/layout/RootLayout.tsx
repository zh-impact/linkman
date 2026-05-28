import { AppShell, Burger, Group, MantineProvider, Text, UnstyledButton } from '@mantine/core'
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
          collapsed: { mobile: !opened },
        }}
      >
        <AppShell.Header>
          <Group h="100%" px="md">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Group style={{ flex: 1 }}>
              <Text fw={700}>LinkMan</Text>
              <Group ml="xl" gap={0} visibleFrom="sm">
                <UnstyledButton component={NavLink} to="/" className={classes.control}>
                  Dashboard
                </UnstyledButton>
                <UnstyledButton component={NavLink} to="/links" className={classes.control}>
                  Links
                </UnstyledButton>
                <UnstyledButton component={NavLink} to="/import" className={classes.control}>
                  Import
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
