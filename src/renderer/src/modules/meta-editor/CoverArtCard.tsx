import { useState, type ReactNode } from 'react';
import {
  Alert,
  Box,
  Button,
  Code,
  Group,
  Image,
  NumberInput,
  Stack,
  Text,
  ThemeIcon,
} from '@mantine/core';
import { useHotkeys } from '@mantine/hooks';
import { IconClipboard, IconInfoCircle, IconPhoto, IconPhotoOff } from '@tabler/icons-react';
import { formatBytes } from '@shared/format';
import type { CoverArtSupport } from '@shared/media-types';
import { COVER_MAX_EDGE, type CoverImage, type MediaInfo } from '@shared/metadata';
import type { ErrorInfo, Result } from '@shared/result';
import { api } from '../../api';
import { FileDropzone } from '../../components/FileDropzone';
import type { CoverDraft } from './cover-draft';

interface CoverArtCardProps {
  info: MediaInfo;
  support: CoverArtSupport;
  formatLabel: string;
  /** The artwork already in the file, if any. */
  original: CoverImage | null;
  draft: CoverDraft;
  onDraftChange: (draft: CoverDraft) => void;
  onError: (error: ErrorInfo) => void;
}

/**
 * Choosing artwork. Every image goes through main first, which re-encodes it to a
 * baseline JPEG — so the preview here is the exact image that gets embedded,
 * rather than a browser rendering of the original.
 */
export function CoverArtCard({
  info,
  support,
  formatLabel,
  original,
  draft,
  onDraftChange,
  onError,
}: CoverArtCardProps): ReactNode {
  const [busy, setBusy] = useState(false);
  const [frameSeconds, setFrameSeconds] = useState(defaultFrameSeconds(info.durationSeconds));

  const prepare = (run: () => Promise<Result<CoverImage>>): void => {
    setBusy(true);
    // run() is called inside the chain rather than before it: a synchronous throw
    // would otherwise escape and leave the spinner running with nothing reported.
    void Promise.resolve()
      .then(run)
      .then((result) => {
        if (result.ok) onDraftChange({ kind: 'replace', image: result.value });
        else onError(result.error);
      })
      .catch((error: unknown) => {
        onError({ message: 'That image could not be prepared.', details: String(error) });
      })
      .finally(() => setBusy(false));
  };

  const pasteImage = (): void => {
    if (support === 'unsupported') return;
    prepare(() => api.coverFromClipboard());
  };

  // Ctrl+V anywhere in the panel sets the artwork. Mantine skips the hotkey while a
  // text field has focus, where Ctrl+V has to keep meaning paste text.
  useHotkeys([['mod+V', pasteImage]]);

  if (support === 'unsupported') {
    return (
      <Alert
        variant="light"
        color="gray"
        icon={<IconInfoCircle size={18} />}
        title="No embedded artwork"
      >
        {formatLabel} files cannot carry embedded cover art. Tags can still be edited.
      </Alert>
    );
  }

  const chooseImage = (): void => {
    void api.pickImage().then((path) => {
      if (path) prepare(() => api.prepareCover(path));
    });
  };

  const grabFrame = (): void => {
    prepare(() => api.grabFrame({ path: info.path, atSeconds: frameSeconds }));
  };

  const shown = draft.kind === 'replace' ? draft.image : draft.kind === 'keep' ? original : null;
  const frame = previewFrame(shown);

  return (
    <Stack gap="sm">
      <Group align="flex-start" gap="md" wrap="nowrap">
        <FileDropzone
          onDrop={(files) => {
            const [file] = files;
            if (!file) return;
            // The renderer never reads the file; it forwards the path and main
            // does the decoding.
            prepare(() => api.prepareCover(api.pathForFile(file)));
          }}
          loading={busy}
          p={0}
          radius="md"
          w={frame.width}
          h={frame.height}
          style={{ flexShrink: 0 }}
          // "Choose image…" uses the Electron dialog; the dropzone's own click
          // would open the Chromium picker instead.
          activateOnClick={false}
          // The buttons live outside this dropzone, but the preview inside it
          // would otherwise be inert too — including its scroll and hover.
          enablePointerEvents
        >
          <Box w={frame.width} h={frame.height} style={{ display: 'grid', placeItems: 'center' }}>
            {shown ? (
              <Image
                src={shown.previewDataUrl}
                alt="Cover art"
                w={frame.width}
                h={frame.height}
                fit="contain"
              />
            ) : (
              <Stack gap={4} align="center" c="dimmed">
                <ThemeIcon variant="transparent" c="dimmed">
                  {draft.kind === 'remove' ? <IconPhotoOff size={28} /> : <IconPhoto size={28} />}
                </ThemeIcon>
                <Text size="xs">
                  {draft.kind === 'remove' ? 'Will be removed' : 'Drop or paste an image'}
                </Text>
              </Stack>
            )}
          </Box>
        </FileDropzone>

        <Stack gap="xs" style={{ minWidth: 0 }}>
          <Group gap="xs">
            <Button variant="default" onClick={chooseImage} loading={busy}>
              Choose image…
            </Button>
            <Button
              variant="default"
              onClick={pasteImage}
              loading={busy}
              leftSection={<IconClipboard size={16} />}
            >
              Paste
            </Button>
            {original || draft.kind === 'replace' ? (
              <Button
                variant="subtle"
                color="red"
                onClick={() => onDraftChange({ kind: 'remove' })}
                disabled={draft.kind === 'remove'}
              >
                Remove
              </Button>
            ) : null}
            {draft.kind === 'keep' ? null : (
              <Button variant="subtle" onClick={() => onDraftChange({ kind: 'keep' })}>
                Undo
              </Button>
            )}
          </Group>

          <Text size="xs" c="dimmed">
            {describe(shown, draft)}
          </Text>

          {info.kind === 'video' ? (
            <Group align="flex-end" gap="xs" wrap="nowrap">
              <NumberInput
                label="Frame at"
                description="Seconds into the video"
                suffix=" s"
                min={0}
                max={info.durationSeconds ?? undefined}
                clampBehavior="strict"
                decimalScale={1}
                w={140}
                value={frameSeconds}
                onChange={(value) => {
                  if (typeof value === 'number') setFrameSeconds(value);
                }}
              />
              <Button variant="default" onClick={grabFrame} loading={busy}>
                Grab frame
              </Button>
            </Group>
          ) : null}
        </Stack>
      </Group>

      {support === 'unreliable' ? (
        <Alert variant="light" color="yellow" icon={<IconInfoCircle size={18} />}>
          {formatLabel} artwork is written to the <Code>covr</Code> atom, which players honor
          inconsistently — some, including VLC, ignore it. The tag itself is written correctly.
        </Alert>
      ) : null}
    </Stack>
  );
}

/** The longest edge of the preview, and the whole box while there is nothing to show. */
const PREVIEW_EDGE = 180;

/** Short enough that a panorama does not leave a sliver to drop onto. */
const PREVIEW_MIN_EDGE = 90;

/**
 * The preview box takes the shape of the image, so artwork is neither cropped nor
 * sitting in empty bands inside a square that has nothing to do with it.
 *
 * Cover art is conventionally square and usually is, which is why the box only
 * looks like a decision when it is not.
 */
function previewFrame(shown: CoverImage | null): { width: number; height: number } {
  if (!shown || shown.width <= 0 || shown.height <= 0) {
    return { width: PREVIEW_EDGE, height: PREVIEW_EDGE };
  }

  const scale = PREVIEW_EDGE / Math.max(shown.width, shown.height);
  return {
    width: Math.max(PREVIEW_MIN_EDGE, Math.round(shown.width * scale)),
    height: Math.max(PREVIEW_MIN_EDGE, Math.round(shown.height * scale)),
  };
}

function describe(shown: CoverImage | null, draft: CoverDraft): string {
  if (draft.kind === 'remove') return 'The existing artwork will be removed on save.';
  if (!shown) return `Baseline JPEG, at most ${String(COVER_MAX_EDGE)} px on the longest side.`;

  const size = `${String(shown.width)}×${String(shown.height)}, ${formatBytes(shown.byteSize)}`;
  return draft.kind === 'replace'
    ? `New artwork — ${size}. This is exactly what will be embedded.`
    : `Currently embedded, previewed at ${size}.`;
}

/**
 * A tenth of the way in. The opening frames of a video are often black or a title
 * card, which makes a poor thumbnail.
 */
function defaultFrameSeconds(durationSeconds: number | null): number {
  if (durationSeconds === null || durationSeconds <= 0) return 0;
  return Math.round(durationSeconds * 0.1 * 10) / 10;
}
