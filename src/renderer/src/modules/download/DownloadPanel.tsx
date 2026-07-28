import { useCallback, useRef, useState, type ClipboardEvent, type ReactNode } from 'react';
import { Button, Divider, Group, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { downloadTargetById, type UrlInspection } from '@shared/download';
import { sanitizeFilename, stripKnownExtension } from '@shared/filenames';
import type { ErrorInfo } from '@shared/result';
import { api } from '../../api';
import { FailureAlert } from '../../components/FailureAlert';
import { useJobs } from '../../state/JobsContext';
import { useSettings } from '../../state/SettingsContext';
import { DownloadOptionsForm } from './DownloadOptionsForm';
import { SourcePreview } from './SourcePreview';

/**
 * Paste a URL, see what it is, queue it. The panel owns no download logic — it
 * asks main to inspect, then hands the queue a list of items.
 */
export function DownloadPanel(): ReactNode {
  const { settings } = useSettings();
  const { openDrawer } = useJobs();

  const [url, setUrl] = useState('');
  const [inspection, setInspection] = useState<UrlInspection | null>(null);
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [filename, setFilename] = useState('');
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [starting, setStarting] = useState(false);

  // Only the most recent inspection may update the UI: a slow first request must
  // not overwrite the result of a URL pasted after it.
  const latestRequest = useRef(0);

  const inspect = useCallback((value: string) => {
    const target = value.trim();
    if (!target) return;

    const requestId = latestRequest.current + 1;
    latestRequest.current = requestId;
    setInspecting(true);

    void api
      .inspectUrl(target)
      .then((result) => {
        if (latestRequest.current !== requestId) return;
        if (result.ok) {
          setInspection(result.value);
          setSelectedIds(result.value.entries.map((entry) => entry.id));
          // Prefilled from the title, already sanitized, so what is shown is what
          // lands on disk. Playlists keep using the template.
          const single = result.value.kind === 'video' ? result.value.entries[0] : undefined;
          setFilename(single ? sanitizeFilename(stripKnownExtension(single.title)) : '');
          setError(null);
        } else {
          setInspection(null);
          setSelectedIds([]);
          setFilename('');
          setError(result.error);
        }
      })
      .finally(() => {
        if (latestRequest.current === requestId) setInspecting(false);
      });
  }, []);

  /** Paste-and-go: pasting a URL is the whole interaction in the common case. */
  const handlePaste = (event: ClipboardEvent<HTMLInputElement>): void => {
    const pasted = event.clipboardData.getData('text').trim();
    if (!pasted) return;
    event.preventDefault();
    setUrl(pasted);
    inspect(pasted);
  };

  const selectedEntries =
    inspection?.entries.filter((entry) => selectedIds.includes(entry.id)) ?? [];
  const isSingleVideo = inspection?.kind === 'video';

  const start = (): void => {
    if (!settings || selectedEntries.length === 0) return;

    setStarting(true);
    void api
      .startDownloads({
        items: selectedEntries.map((entry) => ({
          url: entry.url,
          title: entry.title,
          // Only a single file has a name the user could have chosen.
          filename: isSingleVideo && filename.trim() ? filename : null,
        })),
        options: {
          target: settings.downloadTarget,
          audioQuality: settings.audioQuality,
          videoQuality: settings.videoQuality,
          destination: settings.downloadDirectory ?? '',
          filenameTemplate: settings.filenameTemplate,
          restrictFilenames: settings.restrictFilenames,
        },
      })
      .then((result) => {
        if (!result.ok) {
          setError(result.error);
          return;
        }
        const count = result.value.jobIds.length;
        notifications.show({
          title: count === 1 ? 'Download queued' : `${String(count)} downloads queued`,
          message: 'Progress is in the Jobs panel.',
        });
        setError(null);
        openDrawer();
      })
      .finally(() => setStarting(false));
  };

  const missingDestination = !settings?.downloadDirectory;

  return (
    <Stack gap="lg" maw={760}>
      <Group align="flex-end" gap="sm" wrap="nowrap">
        <TextInput
          style={{ flex: 1 }}
          label="YouTube URL"
          description="A video or a playlist. Playlists are queued one job per entry."
          placeholder="https://www.youtube.com/watch?v=…"
          value={url}
          onChange={(event) => setUrl(event.currentTarget.value)}
          onPaste={handlePaste}
          onKeyDown={(event) => {
            if (event.key === 'Enter') inspect(url);
          }}
        />
        <Button variant="default" loading={inspecting} onClick={() => inspect(url)}>
          Fetch
        </Button>
      </Group>

      {error ? (
        <FailureAlert
          title="yt-dlp could not use that URL"
          error={error}
          onDismiss={() => setError(null)}
        />
      ) : null}

      {inspection ? (
        <SourcePreview
          inspection={inspection}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
        />
      ) : null}

      <Divider label="Output" labelPosition="left" />

      {isSingleVideo && settings ? (
        <TextInput
          label="Save as"
          description={`The .${downloadTargetById(settings.downloadTarget).ext} extension is added automatically.`}
          value={filename}
          onChange={(event) => setFilename(event.currentTarget.value)}
          error={filename.trim() ? null : 'A file name is required.'}
        />
      ) : null}

      <DownloadOptionsForm showFilenameTemplate={!isSingleVideo} />

      <Group justify="space-between" align="center">
        <Text size="sm" c="dimmed">
          {describeSelection(inspection, selectedEntries.length, missingDestination)}
        </Text>
        <Button
          onClick={start}
          loading={starting}
          disabled={
            selectedEntries.length === 0 ||
            missingDestination ||
            (isSingleVideo && !filename.trim())
          }
        >
          Download
        </Button>
      </Group>
    </Stack>
  );
}

function describeSelection(
  inspection: UrlInspection | null,
  selectedCount: number,
  missingDestination: boolean,
): string {
  if (missingDestination) return 'Choose a folder to save into first.';
  if (!inspection) return 'Paste a URL to see what it contains.';
  if (inspection.kind === 'video') return selectedCount === 1 ? 'Ready.' : 'Nothing selected.';
  return `${String(selectedCount)} of ${String(inspection.entries.length)} entries selected.`;
}
