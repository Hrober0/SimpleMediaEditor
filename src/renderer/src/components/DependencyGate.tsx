import type { ReactNode } from 'react';
import { Alert, Center, Paper, Stack, Text, Title } from '@mantine/core';
import { IconTool } from '@tabler/icons-react';
import type { BinaryStatus } from '@shared/binaries';
import { BinaryStatusPanel } from './BinaryStatusPanel';

/**
 * Shown instead of the app when a required tool is missing. Every module depends
 * on ffmpeg or yt-dlp, so starting into a half-working app would only produce
 * failures further from their cause.
 */
export function DependencyGate({ missing }: { missing: readonly BinaryStatus[] }): ReactNode {
  const names = missing.map((binary) => binary.displayName).join(' and ');

  return (
    <Center h="100vh" p="xl">
      <Paper withBorder radius="md" p="xl" maw={720} w="100%">
        <Stack gap="lg">
          <Stack gap={4}>
            <Title order={3}>
              <IconTool size={22} style={{ verticalAlign: '-3px', marginRight: 8 }} />
              Set up the external tools
            </Title>
            <Text c="dimmed">
              MediaEditor drives {names} rather than bundling {missing.length === 1 ? 'it' : 'them'}
              . Install what is missing, or point the app at an existing copy.
            </Text>
          </Stack>

          <BinaryStatusPanel />

          <Alert variant="light" color="blue" title="Why these are not bundled">
            <Text size="sm">
              YouTube changes break pinned yt-dlp versions regularly, so keeping it external means
              updating it does not mean updating this app.
            </Text>
          </Alert>
        </Stack>
      </Paper>
    </Center>
  );
}
