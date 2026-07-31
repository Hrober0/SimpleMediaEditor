import type { ReactNode } from 'react';
import {
  Autocomplete,
  SegmentedControl,
  Select,
  Skeleton,
  Stack,
  Switch,
  Text,
} from '@mantine/core';
import {
  AUDIO_QUALITIES,
  DEFAULT_FILENAME_TEMPLATE,
  DOWNLOAD_TARGETS,
  FILENAME_TEMPLATE_PRESETS,
  VIDEO_QUALITIES,
  downloadTargetById,
} from '@shared/download';
import { DirectoryInput } from '../../components/DirectoryInput';
import { useSettings } from '../../state/SettingsContext';
import { META_EDITOR } from '../types';

interface DownloadOptionsFormProps {
  /**
   * The template only decides names when more than one file is coming. For a
   * single video the panel offers an explicit "Save as" field instead, and
   * showing both would raise the question of which one wins.
   */
  showFilenameTemplate: boolean;
}

/**
 * Output options. Every field is persisted as it changes, so the destination
 * folder and template are remembered between runs rather than re-entered.
 */
export function DownloadOptionsForm({ showFilenameTemplate }: DownloadOptionsFormProps): ReactNode {
  const { settings, update } = useSettings();

  if (!settings) return <Skeleton height={260} radius="md" />;

  const target = downloadTargetById(settings.downloadTarget);

  return (
    <Stack gap="md">
      <div>
        <SegmentedControl
          fullWidth
          value={settings.downloadTarget}
          onChange={(value) => {
            void update({ downloadTarget: value });
          }}
          data={DOWNLOAD_TARGETS.map((entry) => ({ value: entry.id, label: entry.label }))}
        />
        <Text size="xs" c="dimmed" mt={6}>
          {target.note}
        </Text>
      </div>

      {target.kind === 'audio' ? (
        <Select
          label="Audio quality"
          data={[...AUDIO_QUALITIES]}
          value={settings.audioQuality}
          onChange={(value) => {
            if (value) void update({ audioQuality: value });
          }}
          allowDeselect={false}
        />
      ) : (
        <Select
          label="Video quality"
          description="Falls back to the closest available stream."
          data={[...VIDEO_QUALITIES]}
          value={settings.videoQuality}
          onChange={(value) => {
            if (value) void update({ videoQuality: value });
          }}
          allowDeselect={false}
        />
      )}

      <DirectoryInput
        label="Save to"
        value={settings.downloadDirectory}
        onChange={(path) => {
          void update({ downloadDirectory: path });
        }}
        dialogTitle="Choose where downloads are saved"
      />

      {showFilenameTemplate ? (
        <Autocomplete
          label="Filename template"
          description="yt-dlp output template — %(title)s and %(ext)s are filled in per video."
          placeholder={DEFAULT_FILENAME_TEMPLATE}
          data={FILENAME_TEMPLATE_PRESETS.map((preset) => preset.value)}
          value={settings.filenameTemplate}
          onChange={(value) => {
            void update({ filenameTemplate: value });
          }}
        />
      ) : null}

      <Switch
        checked={settings.restrictFilenames}
        onChange={(event) => {
          void update({ restrictFilenames: event.currentTarget.checked });
        }}
        label="Restrict filenames to safe characters"
        description="Recommended: YouTube titles contain characters Windows rejects."
      />

      <Switch
        checked={settings.openInMetaEditorAfterDownload}
        onChange={(event) => {
          void update({ openInMetaEditorAfterDownload: event.currentTarget.checked });
        }}
        label={`Open in ${META_EDITOR.title} when finished`}
        description="A single video only: a playlist has no one file to open."
      />
    </Stack>
  );
}
