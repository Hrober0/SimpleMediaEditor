import type { ReactNode } from 'react';
import { Divider, NumberInput, Paper, Skeleton, Stack, Text, Title } from '@mantine/core';
import { JOB_CONCURRENCY_RANGE } from '@shared/settings';
import { BinaryStatusPanel } from '../../components/BinaryStatusPanel';
import { DirectoryInput } from '../../components/DirectoryInput';
import { useEnvironment } from '../../state/EnvironmentContext';
import { useSettings } from '../../state/SettingsContext';

export function SettingsPanel(): ReactNode {
  const { settings, update } = useSettings();
  const { environment } = useEnvironment();

  if (!settings) return <Skeleton height={320} radius="md" />;

  return (
    <Stack gap="xl">
      <Section
        title="External tools"
        description="Resolved once at startup and whenever you change a path here."
      >
        <BinaryStatusPanel />
      </Section>

      <Section title="Downloads" description="Where finished files are saved by default.">
        <DirectoryInput
          label="Default folder"
          value={settings.downloadDirectory}
          onChange={(path) => void update({ downloadDirectory: path })}
          dialogTitle="Choose the default download folder"
        />
      </Section>

      <Section
        title="Jobs"
        description="How many downloads, exports or conversions run at the same time."
      >
        <NumberInput
          label="Concurrent jobs"
          min={JOB_CONCURRENCY_RANGE.min}
          max={JOB_CONCURRENCY_RANGE.max}
          clampBehavior="strict"
          allowDecimal={false}
          w={160}
          value={settings.jobConcurrency}
          onChange={(value) => {
            if (typeof value === 'number') void update({ jobConcurrency: value });
          }}
        />
      </Section>

      {environment ? (
        <Section title="About">
          <Text size="sm" c="dimmed">
            MediaEditor {environment.appVersion} on {environment.platform}
          </Text>
        </Section>
      ) : null}
    </Stack>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}): ReactNode {
  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap="sm">
        <Stack gap={2}>
          <Title order={5}>{title}</Title>
          {description ? (
            <Text size="xs" c="dimmed">
              {description}
            </Text>
          ) : null}
        </Stack>
        <Divider />
        {children}
      </Stack>
    </Paper>
  );
}
