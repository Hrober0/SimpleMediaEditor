import { useState, type ReactNode } from 'react';
import {
  AppShell,
  Button,
  Center,
  Group,
  Indicator,
  Loader,
  NavLink,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { IconListDetails } from '@tabler/icons-react';
import { DependencyGate } from './components/DependencyGate';
import { JobsDrawer } from './components/JobsDrawer';
import { MODULE_REGISTRY } from './modules/registry';
import { MODULE_SECTIONS, type UtilityModule } from './modules/types';
import { useEnvironment } from './state/EnvironmentContext';
import { useJobs } from './state/JobsContext';

/**
 * The shell. It renders whatever the module registry contains and knows nothing
 * about individual modules — adding a utility never means editing this file.
 */
export function App(): ReactNode {
  const { environment, missingBinaries } = useEnvironment();
  const { activeCount, openDrawer } = useJobs();
  const [activeModuleId, setActiveModuleId] = useState(MODULE_REGISTRY[0]?.id ?? '');

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
    <AppShell header={{ height: 56 }} navbar={{ width: 264, breakpoint: 'xs' }} padding="lg">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Text fw={600}>MediaEditor</Text>
          <Indicator
            label={activeCount}
            size={18}
            disabled={activeCount === 0}
            offset={4}
            color="blue"
          >
            <Button
              variant="default"
              leftSection={<IconListDetails size={16} />}
              onClick={openDrawer}
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
                    onClick={() => setActiveModuleId(module.id)}
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
