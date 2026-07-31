import type { ReactNode } from 'react';
import {
  AppShell,
  Button,
  Center,
  Group,
  Indicator,
  Loader,
  NavLink,
  ScrollArea,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { IconListDetails } from '@tabler/icons-react';
import { DependencyGate } from './components/DependencyGate';
import { JobsDrawer } from './components/JobsDrawer';
import { JobsList } from './components/JobsList';
import {
  JOBS_PANEL_BREAKPOINT,
  JOBS_PANEL_WIDTH,
  SHELL_HEADER_HEIGHT,
  SHELL_NAVBAR_WIDTH,
} from './layout';
import { MODULE_REGISTRY } from './modules/registry';
import { MODULE_SECTIONS, type UtilityModule } from './modules/types';
import { useEnvironment } from './state/EnvironmentContext';
import { useJobs } from './state/JobsContext';
import { useNavigation } from './state/NavigationContext';

/**
 * The shell. It renders whatever the module registry contains and knows nothing
 * about individual modules — adding a utility never means editing this file.
 */
export function App(): ReactNode {
  const { environment, missingBinaries } = useEnvironment();
  const { activeCount, revealJobs } = useJobs();
  const { activeModuleId, showModule } = useNavigation();

  if (!environment) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }

  if (missingBinaries.length > 0) {
    return <DependencyGate missing={missingBinaries} />;
  }

  const active = MODULE_REGISTRY.find((module) => module.id === activeModuleId);

  return (
    <AppShell
      header={{ height: SHELL_HEADER_HEIGHT }}
      navbar={{ width: SHELL_NAVBAR_WIDTH, breakpoint: 'xs' }}
      // The jobs list stays on screen whenever the window is wide enough for it;
      // below the breakpoint it collapses and the drawer takes over.
      aside={{
        width: JOBS_PANEL_WIDTH,
        breakpoint: JOBS_PANEL_BREAKPOINT,
        collapsed: { mobile: true, desktop: false },
      }}
      padding="lg"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Text fw={600}>MediaEditor</Text>
          {/* Hidden where the side panel already shows the list. */}
          <Indicator
            label={activeCount}
            size={18}
            disabled={activeCount === 0}
            offset={4}
            color="blue"
            hiddenFrom={JOBS_PANEL_BREAKPOINT}
          >
            <Button
              variant="default"
              leftSection={<IconListDetails size={16} />}
              onClick={revealJobs}
            >
              Jobs
            </Button>
          </Indicator>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        <Stack gap="lg">
          {MODULE_SECTIONS.map((section) => {
            const modules = MODULE_REGISTRY.filter((module) => module.section === section.id);
            if (modules.length === 0) return null;

            return (
              <Stack key={section.id} gap={4}>
                <Text size="xs" tt="uppercase" fw={600} c="dimmed" px="xs">
                  {section.label}
                </Text>
                {modules.map((module) => (
                  <NavLink
                    key={module.id}
                    active={module.id === activeModuleId}
                    label={module.title}
                    description={module.description}
                    leftSection={module.icon}
                    onClick={() => showModule(module.id)}
                  />
                ))}
              </Stack>
            );
          })}
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main>
        {active ? <ModulePanel module={active} /> : <Text c="dimmed">No module selected.</Text>}
      </AppShell.Main>

      <AppShell.Aside p="sm">
        <AppShell.Section>
          <Group justify="space-between" align="center" mb="sm">
            <Text fw={600}>Jobs</Text>
            <Indicator label={activeCount} size={18} disabled={activeCount === 0} offset={-2}>
              <IconListDetails size={18} />
            </Indicator>
          </Group>
        </AppShell.Section>
        {/* A long queue scrolls inside the panel, not with the page. */}
        <AppShell.Section grow component={ScrollArea} type="auto">
          <JobsList />
        </AppShell.Section>
      </AppShell.Aside>

      <JobsDrawer />
    </AppShell>
  );
}

function ModulePanel({ module }: { module: UtilityModule }): ReactNode {
  const { Panel } = module;

  return (
    <Stack gap="lg">
      <Stack gap={2}>
        <Title order={1}>{module.title}</Title>
        <Text c="dimmed">{module.description}</Text>
      </Stack>
      {/* Remounts on module change, so a panel never inherits another's state. */}
      <Panel key={module.id} />
    </Stack>
  );
}
