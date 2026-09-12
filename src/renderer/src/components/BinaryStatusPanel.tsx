import type { ReactNode } from 'react';
import { Badge, Button, Code, Group, Stack, Text, ThemeIcon, Tooltip } from '@mantine/core';
import { IconCheck, IconMinus, IconRefresh, IconSearch, IconX } from '@tabler/icons-react';
import {
  isBinaryAvailable,
  isBinaryRequired,
  type BinaryId,
  type BinaryStatus,
} from '@shared/binaries';
import { api } from '../api';
import { useEnvironment } from '../state/EnvironmentContext';
import { useSettings } from '../state/SettingsContext';
import { FailureAlert } from './FailureAlert';

/**
 * The state of the external tools, and the one place their paths are configured.
 * Shared by the startup gate and the settings panel so both stay in step.
 */
export function BinaryStatusPanel(): ReactNode {
  const { binaries, recheck, rechecking } = useEnvironment();
  const { settings, update } = useSettings();

  const locate = async (id: BinaryId): Promise<void> => {
    const picked = await api.pickBinary({ id });
    if (!picked) return;
    // Persist before re-probing: resolution reads the stored override.
    await update({ binaryPaths: { ...settings?.binaryPaths, [id]: picked } });
    await recheck();
  };

  const clearOverride = async (id: BinaryId): Promise<void> => {
    const remaining = { ...settings?.binaryPaths };
    delete remaining[id];
    await update({ binaryPaths: remaining });
    await recheck();
  };

  return (
    <Stack gap="sm">
      {binaries.map((binary) => (
        <BinaryRow
          key={binary.id}
          binary={binary}
          hasOverride={Boolean(settings?.binaryPaths[binary.id])}
          onLocate={() => void locate(binary.id)}
          onClearOverride={() => void clearOverride(binary.id)}
        />
      ))}

      <Group>
        <Button
          variant="default"
          leftSection={<IconRefresh size={16} />}
          loading={rechecking}
          onClick={() => void recheck()}
        >
          Check again
        </Button>
        <Text size="xs" c="dimmed">
          Resolution order: configured path, then PATH, then a bundled copy.
        </Text>
      </Group>
    </Stack>
  );
}

interface BinaryRowProps {
  binary: BinaryStatus;
  hasOverride: boolean;
  onLocate: () => void;
  onClearOverride: () => void;
}

function BinaryRow({ binary, hasOverride, onLocate, onClearOverride }: BinaryRowProps): ReactNode {
  const available = isBinaryAvailable(binary);
  // A missing optional tool is a state, not a fault: only one of the JavaScript
  // runtimes is needed, so flagging both in red would say something untrue.
  const required = isBinaryRequired(binary);
  const mark = describeAvailability(available, required);

  return (
    <Stack gap={6}>
      <Group justify="space-between" wrap="nowrap" align="center">
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
          <ThemeIcon variant="light" color={mark.color} radius="xl">
            {mark.icon}
          </ThemeIcon>

          <Stack gap={0} style={{ minWidth: 0 }}>
            {/* Version strings can be long ("7.1-full_build-www.gyan.dev"); the
                badges keep their own width and the path below truncates instead. */}
            <Group gap="xs" wrap="nowrap">
              <Text fw={500}>{binary.displayName}</Text>
              {binary.version ? (
                <Badge variant="light" size="sm" style={{ flexShrink: 0 }}>
                  {binary.version}
                </Badge>
              ) : null}
              {binary.source ? (
                <Badge variant="outline" size="sm" color="gray">
                  {binary.source}
                </Badge>
              ) : null}
            </Group>
            <Text size="xs" c="dimmed">
              {binary.purpose}
            </Text>
            {binary.path ? (
              <Tooltip label={binary.path} multiline maw={420} withArrow>
                <Code style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {binary.path}
                </Code>
              </Tooltip>
            ) : null}
          </Stack>
        </Group>

        <Group gap="xs" wrap="nowrap">
          {hasOverride ? (
            <Button variant="subtle" size="compact-sm" onClick={onClearOverride}>
              Use PATH
            </Button>
          ) : null}
          <Button
            variant="default"
            size="compact-sm"
            leftSection={<IconSearch size={14} />}
            onClick={onLocate}
          >
            Locate…
          </Button>
        </Group>
      </Group>

      {required && !available && binary.error ? (
        <FailureAlert
          title={`${binary.displayName} was not found`}
          error={{
            message: `Install it and press "Check again", or point the app at it with "Locate…".`,
            details: binary.error,
          }}
        />
      ) : null}
    </Stack>
  );
}

function describeAvailability(
  available: boolean,
  required: boolean,
): { color: string; icon: ReactNode } {
  if (available) return { color: 'teal', icon: <IconCheck size={16} /> };
  return required
    ? { color: 'red', icon: <IconX size={16} /> }
    : { color: 'gray', icon: <IconMinus size={16} /> };
}
