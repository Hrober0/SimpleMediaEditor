import type { ReactNode } from 'react';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Image,
  ScrollArea,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core';
import { IconMusic, IconPlaylist } from '@tabler/icons-react';
import type { MediaSourceEntry, UrlInspection } from '@shared/download';
import { formatDuration } from '@shared/format';

interface SourcePreviewProps {
  inspection: UrlInspection;
  selectedIds: readonly string[];
  onSelectionChange: (ids: readonly string[]) => void;
}

/**
 * What the URL actually points at, shown before anything is queued — a wrong or
 * unavailable link is obvious here instead of turning into a failed job.
 */
export function SourcePreview({
  inspection,
  selectedIds,
  onSelectionChange,
}: SourcePreviewProps): ReactNode {
  if (inspection.kind === 'playlist') {
    return (
      <PlaylistPreview
        inspection={inspection}
        selectedIds={selectedIds}
        onSelectionChange={onSelectionChange}
      />
    );
  }

  const [entry] = inspection.entries;
  if (!entry) return null;

  return (
    <Card withBorder radius="md" padding="md">
      <Group align="flex-start" wrap="nowrap" gap="md">
        <Thumbnail entry={entry} width={160} />
        <Stack gap={4} style={{ minWidth: 0 }}>
          <Title order={4} lineClamp={2}>
            {entry.title}
          </Title>
          {entry.uploader ? (
            <Text size="sm" c="dimmed">
              {entry.uploader}
            </Text>
          ) : null}
          {entry.durationSeconds !== null ? (
            <Badge variant="light" w="fit-content">
              {formatDuration(entry.durationSeconds)}
            </Badge>
          ) : null}
        </Stack>
      </Group>
    </Card>
  );
}

function PlaylistPreview({
  inspection,
  selectedIds,
  onSelectionChange,
}: SourcePreviewProps): ReactNode {
  const allIds = inspection.entries.map((entry) => entry.id);
  const allSelected = selectedIds.length === allIds.length;

  return (
    <Card withBorder radius="md" padding="md">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
            <ThemeIcon variant="light" size="lg">
              <IconPlaylist size={18} />
            </ThemeIcon>
            <Stack gap={0} style={{ minWidth: 0 }}>
              <Title order={5} lineClamp={1}>
                {inspection.title}
              </Title>
              <Text size="sm" c="dimmed">
                Playlist — {inspection.entries.length} entries, one job each
              </Text>
            </Stack>
          </Group>
          <Button
            variant="subtle"
            size="compact-sm"
            onClick={() => onSelectionChange(allSelected ? [] : allIds)}
          >
            {allSelected ? 'Clear' : 'Select all'}
          </Button>
        </Group>

        <ScrollArea.Autosize mah={240} type="auto" offsetScrollbars>
          <Checkbox.Group
            value={[...selectedIds]}
            onChange={onSelectionChange}
            // Keeps the checkbox list from stretching under the scrollbar.
            style={{ paddingRight: 8 }}
          >
            <Stack gap={6}>
              {inspection.entries.map((entry, index) => (
                <Checkbox
                  key={entry.id}
                  value={entry.id}
                  label={
                    <Group gap="xs" wrap="nowrap">
                      <Text size="sm" c="dimmed" w={28} ta="right">
                        {index + 1}
                      </Text>
                      <Text size="sm" lineClamp={1}>
                        {entry.title}
                      </Text>
                      {entry.durationSeconds !== null ? (
                        <Text size="xs" c="dimmed">
                          {formatDuration(entry.durationSeconds)}
                        </Text>
                      ) : null}
                    </Group>
                  }
                />
              ))}
            </Stack>
          </Checkbox.Group>
        </ScrollArea.Autosize>
      </Stack>
    </Card>
  );
}

function Thumbnail({ entry, width }: { entry: MediaSourceEntry; width: number }): ReactNode {
  if (!entry.thumbnailUrl) {
    return (
      <ThemeIcon variant="light" size={width} radius="sm">
        <IconMusic size={28} />
      </ThemeIcon>
    );
  }
  return (
    <Image
      src={entry.thumbnailUrl}
      alt=""
      w={width}
      radius="sm"
      // Remote thumbnails are the only external resource the CSP allows.
      fit="cover"
    />
  );
}
