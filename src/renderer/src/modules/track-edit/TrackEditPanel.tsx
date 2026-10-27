import { useState, type ReactNode } from 'react';
import { Box, Button, Divider, Group, Stack, Text } from '@mantine/core';
import { formatDuration } from '@shared/format';
import { formatForExtension } from '@shared/media-types';
import type { OpenedMedia } from '@shared/metadata';
import type { ErrorInfo } from '@shared/result';
import {
  cutRange,
  pasteAt,
  totalKeptSeconds,
  type KeepRange,
  type TrimExportMode,
} from '@shared/trim';
import { api } from '../../api';
import { ChangeMediaButton } from '../../components/ChangeMediaButton';
import { FailureAlert } from '../../components/FailureAlert';
import { MediaFileInput } from '../../components/MediaFileInput';
import { MediaSummary } from '../../components/MediaSummary';
import { PanelActions } from '../../components/PanelActions';
import { ExportMode } from './ExportMode';
import { PasteAction } from './PasteAction';
import { PlaybackControls } from './PlaybackControls';
import { Player } from './Player';
import { SelectionActions } from './SelectionActions';
import { usePlayback } from './use-playback';
import { useSaveTrack } from './use-save-track';
import { useShortcuts } from './use-shortcuts';
import { useWaveform } from './use-waveform';
import { Waveform, type WaveformSelection, type WaveformViewRange } from './Waveform';
import { ZoomControls } from './ZoomControls';

/**
 * Opens a file, plays it, and cuts pieces out of it.
 *
 * The track lives in memory as a list of segments still kept from the original
 * file. Selecting a part of the waveform is just a UI selection: nothing
 * changes until "Cut" is pressed, which is what actually removes it from the
 * segments. Save writes out whatever the segments currently are, whether or not
 * a selection happens to be sitting there uncommitted.
 *
 * A cut part is kept on a clipboard, and pasting puts it back in at the
 * playhead. The clipboard holds parts of this file only, so opening another
 * file empties it.
 */
export function TrackEditPanel(): ReactNode {
  const [media, setMedia] = useState<OpenedMedia | null>(null);
  const [segments, setSegments] = useState<KeepRange[]>([]);
  const [initialSegments, setInitialSegments] = useState<KeepRange[]>([]);
  const [clipboard, setClipboard] = useState<KeepRange[] | null>(null);
  const [selection, setSelection] = useState<WaveformSelection | null>(null);
  const [viewRange, setViewRange] = useState<WaveformViewRange | null>(null);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [mode, setMode] = useState<TrimExportMode>('fast');
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [opening, setOpening] = useState(false);
  // Saving reopens the same path. Without a new count the preview would keep
  // playing the file as it was before the save, out of step with the waveform.
  const [openCount, setOpenCount] = useState(0);

  const waveform = useWaveform(media);

  // Null unless a loop is actually running, so dragging out a selection does
  // not tear down and rebuild the playback listeners on every pointer move.
  const loop = loopEnabled ? selection : null;
  const playback = usePlayback({ segments, loop });

  const open = (path: string): void => {
    setOpening(true);
    setError(null);

    void api
      .probeMedia(path)
      .then((result) => {
        if (!result.ok) {
          setMedia(null);
          setError(result.error);
          return;
        }

        setMedia(result.value);
        setOpenCount((count) => count + 1);
        playback.reset();
        setSelection(null);
        setClipboard(null);
        setViewRange(null);
        setLoopEnabled(false);

        const duration = result.value.info.durationSeconds ?? 0;
        // The whole file, kept: nothing has been cut yet, so nothing is shown
        // as selected, it is simply the track, in full.
        const wholeFile = duration > 0 ? [{ startSeconds: 0, endSeconds: duration }] : [];
        setSegments(wholeFile);
        setInitialSegments(wholeFile);
      })
      .finally(() => setOpening(false));
  };

  const { saving, save, saveAs } = useSaveTrack({ media, segments, mode, setError, onSaved: open });

  const format = media ? formatForExtension(media.info.ext) : undefined;
  const sourceDuration = media?.info.durationSeconds ?? 0;
  const changed = JSON.stringify(segments) !== JSON.stringify(initialSegments);
  const canEdit = media && format;
  const canSave = changed && segments.length > 0;

  /** Takes the selection out of the track, returning what was taken out. */
  const removeSelection = (): KeepRange[] => {
    if (!selection) return [];
    const { kept, removed } = cutRange(segments, selection.startSeconds, selection.endSeconds);
    setSegments(kept);
    setSelection(null);
    setLoopEnabled(false);
    setViewRange(null);
    // The removal just moved everything after it: land the playhead where the
    // removed part started rather than leaving it pointing at a time that no
    // longer means what it did a moment ago.
    playback.seek(selection.startSeconds);
    return removed;
  };

  const cutSelection = (): void => {
    const removed = removeSelection();
    if (removed.length > 0) setClipboard(removed);
  };

  // Unlike a cut, the clipboard keeps whatever was cut before.
  const deleteSelection = (): void => {
    removeSelection();
  };

  // The playhead stays where it was, which is now the start of the pasted part.
  const paste = (): void => {
    if (!clipboard) return;
    setSegments(pasteAt(segments, playback.currentTime, clipboard));
    setSelection(null);
    setLoopEnabled(false);
    setViewRange(null);
  };

  const deselect = (): void => {
    setSelection(null);
    setLoopEnabled(false);
  };

  const toggleLoop = (): void => {
    if (!selection) return;
    setLoopEnabled((current) => {
      const next = !current;
      if (next) playback.seek(selection.startSeconds);
      return next;
    });
  };

  const zoomToSelection = (): void => {
    if (!selection) return;
    setViewRange({ startSeconds: selection.startSeconds, endSeconds: selection.endSeconds });
  };

  const zoomOut = (): void => setViewRange(null);

  useShortcuts(Boolean(canEdit), {
    togglePlay: playback.togglePlay,
    seek: playback.seek,
    deselect,
    cutSelection,
    deleteSelection,
    paste,
    toggleLoop,
    zoomToSelection,
    zoomOut,
  });

  return (
    <Stack gap="lg">
      {canEdit ? (
        <PanelActions status={describeTrack(segments, sourceDuration, changed)}>
          <Button
            variant="default"
            onClick={saveAs}
            loading={saving}
            disabled={segments.length === 0}
          >
            Save as…
          </Button>
          <Button onClick={() => save(media.info.path)} disabled={!canSave} loading={saving}>
            Save
          </Button>
        </PanelActions>
      ) : null}

      {canEdit ? null : <MediaFileInput onOpen={open} onError={setError} loading={opening} />}

      {error ? (
        <FailureAlert
          title="That file could not be used"
          error={error}
          onDismiss={() => setError(null)}
        />
      ) : null}

      {canEdit ? (
        <>
          <Group align="stretch" wrap="nowrap" gap="sm">
            <Box flex={1} miw={0}>
              <MediaSummary info={media.info} />
            </Box>
            <ChangeMediaButton onOpen={open} onError={setError} loading={opening} />
          </Group>

          <Divider label="Preview" labelPosition="left" />

          <Player
            info={media.info}
            openCount={openCount}
            elementRefs={playback.elementRefs}
            activeElement={playback.activeElement}
          />

          <Group gap="sm" wrap="nowrap">
            <PlaybackControls
              playing={playback.playing}
              currentTimeSeconds={playback.currentTime}
              trackDurationSeconds={totalKeptSeconds(segments)}
              loopEnabled={loopEnabled}
              canLoop={Boolean(selection)}
              goToStart={() => playback.seek(0)}
              togglePlay={playback.togglePlay}
              toggleLoop={toggleLoop}
            />
            <ZoomControls
              canZoomIn={Boolean(selection)}
              canZoomOut={Boolean(viewRange)}
              zoomToSelection={zoomToSelection}
              zoomOut={zoomOut}
            />
          </Group>

          {waveform.peaks ? (
            <Waveform
              // A fresh instance per file: a selection left over from the file
              // that was open a moment ago means nothing for this one.
              key={media.info.path}
              peaks={waveform.peaks}
              sourceDurationSeconds={sourceDuration}
              segments={segments}
              currentTimeSeconds={playback.currentTime}
              viewRange={viewRange}
              selection={selection}
              onSelectionChange={setSelection}
              onSeek={playback.seek}
            />
          ) : (
            <WaveformNotice loading={waveform.loading} />
          )}

          <Group mih={40} gap="md" align="flex-start">
            <SelectionActions
              selection={selection}
              deselect={deselect}
              cutSelection={cutSelection}
              deleteSelection={deleteSelection}
            />
            <PasteAction clipboard={clipboard} paste={paste} />
          </Group>

          <Divider label="Export" labelPosition="left" />

          <ExportMode value={mode} onChange={setMode} />
        </>
      ) : null}
    </Stack>
  );
}

function WaveformNotice({ loading }: { loading: boolean }): ReactNode {
  return (
    <Text size="sm" c="dimmed">
      {loading ? 'Reading the waveform…' : 'This file has no audio to show a waveform for.'}
    </Text>
  );
}

function describeTrack(
  segments: readonly KeepRange[],
  sourceDurationSeconds: number,
  changed: boolean,
): string {
  if (segments.length === 0) return 'Nothing would be left to save.';
  if (!changed) return 'Nothing has been edited yet.';
  const kept = formatDuration(totalKeptSeconds(segments));
  return `Keeping ${kept} of ${formatDuration(sourceDurationSeconds)}.`;
}
