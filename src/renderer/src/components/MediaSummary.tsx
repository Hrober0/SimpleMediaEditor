import type { ReactNode } from 'react';
import { Badge, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { formatBytes, formatDuration } from '@shared/format';
import type { MediaInfo } from '@shared/metadata';

/**
 * What the file actually is, from ffprobe — so a user who opened the wrong file,
 * or a file whose extension lies about its contents, can see it immediately.
 */
export function MediaSummary({ info }: { info: MediaInfo }): ReactNode {
  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap="xs">
        <Stack gap={2}>
          <Title order={5} lineClamp={1}>
            {info.fileName}
          </Title>
          <Text size="xs" c="dimmed" lineClamp={1}>
            {info.path}
          </Text>
        </Stack>

        <Group gap="xs">
          {facts(info).map((fact) => (
            <Badge key={fact} variant="light">
              {fact}
            </Badge>
          ))}
        </Group>
      </Stack>
    </Paper>
  );
}

function facts(info: MediaInfo): string[] {
  const parts: string[] = [info.containerLabel ?? info.ext.toUpperCase()];

  if (info.durationSeconds !== null) parts.push(formatDuration(info.durationSeconds));
  if (info.byteSize > 0) parts.push(formatBytes(info.byteSize));
  if (info.bitrate !== null) parts.push(`${Math.round(info.bitrate / 1000).toString()} kbps`);

  if (info.video) {
    const size =
      info.video.width && info.video.height
        ? ` ${String(info.video.width)}×${String(info.video.height)}`
        : '';
    parts.push(`${info.video.codec}${size}`);
  }

  if (info.audio) {
    const channels = info.audio.channels === null ? '' : ` ${String(info.audio.channels)}ch`;
    parts.push(`${info.audio.codec}${channels}`);
  }

  if (info.coverStreamIndexes.length > 0) parts.push('has cover art');

  return parts;
}
