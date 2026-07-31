import { useEffect, useState, type ReactNode } from 'react';
import {
  Box,
  Button,
  Divider,
  Group,
  LoadingOverlay,
  SimpleGrid,
  Stack,
  Textarea,
  TextInput,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { formatForExtension } from '@shared/media-types';
import {
  TAG_FIELDS,
  emptyTagValues,
  tagFieldLabel,
  type OpenedMedia,
  type TagValues,
} from '@shared/metadata';
import type { ErrorInfo } from '@shared/result';
import { api } from '../../api';
import { FailureAlert } from '../../components/FailureAlert';
import { PanelActions } from '../../components/PanelActions';
import { useJobs } from '../../state/JobsContext';
import { useNavigation } from '../../state/NavigationContext';
import { META_EDITOR } from '../types';
import { ChangeMediaButton } from './ChangeMediaButton';
import { CoverArtCard } from './CoverArtCard';
import { MediaFileInput } from './MediaFileInput';
import { MediaSummary } from './MediaSummary';
import { toCoverChange, type CoverDraft } from './cover-draft';

/** Long enough that covering the panel is feedback rather than a blink. */
const OVERLAY_DELAY_MS = 300;

/**
 * Editing the tags and artwork of a file the user already has.
 *
 * The panel holds no media knowledge: main probes the file, prepares any cover
 * image, and performs the write as a job. Saving in place goes through the same
 * verified temp-then-replace path as every other export, so a failed save cannot
 * leave the user without their file.
 */
export function TagsPanel(): ReactNode {
  const { revealJobs, waitForJob } = useJobs();
  const { takeFileFor } = useNavigation();

  const [media, setMedia] = useState<OpenedMedia | null>(null);
  const [cover, setCover] = useState<CoverDraft>({ kind: 'keep' });
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [opening, setOpening] = useState(false);
  const [saving, setSaving] = useState(false);
  const [overlayVisible, setOverlayVisible] = useState(false);

  // Controlled: the Save button is enabled by `form.isDirty()`, which only tracks
  // the latest keystroke if the panel re-renders on it.
  const form = useForm<TagValues>({ mode: 'controlled', initialValues: emptyTagValues() });

  const open = (path: string): void => {
    setOpening(true);
    setError(null);
    // The panel is only covered once probing has run long enough to be worth it.
    // Reopening after a save is usually a blink, and an overlay that appears and
    // vanishes that fast reads as a flash rather than as something happening.
    const overlayTimer = setTimeout(() => setOverlayVisible(true), OVERLAY_DELAY_MS);

    void api
      .probeMedia(path)
      .then((result) => {
        if (!result.ok) {
          setMedia(null);
          setError(result.error);
          return;
        }
        setMedia(result.value);
        setCover({ kind: 'keep' });
        form.setValues(result.value.tags);
        // resetDirty rather than setInitialValues: isDirty() answers from the
        // per-field dirty map whenever that map has entries, and only resetDirty
        // clears it. Moving the snapshot alone left Save enabled after a save.
        form.resetDirty(result.value.tags);
      })
      .finally(() => {
        clearTimeout(overlayTimer);
        setOverlayVisible(false);
        setOpening(false);
      });
  };

  // A file another module sent here, a finished download being the one case so far.
  // Taking it clears it, so it opens once rather than on every visit. Opening is
  // queued rather than called outright: it is asynchronous work that belongs after
  // the render that mounted this panel, not inside it.
  useEffect(() => {
    const path = takeFileFor(META_EDITOR.id);
    if (path) queueMicrotask(() => open(path));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on arrival only
  }, [takeFileFor]);

  const format = media ? formatForExtension(media.info.ext) : undefined;
  const changed = form.isDirty() || cover.kind !== 'keep';

  const save = (destinationPath: string): void => {
    if (!media) return;
    setSaving(true);

    void api
      .saveTags({
        sourcePath: media.info.path,
        destinationPath,
        tags: form.getValues(),
        cover: toCoverChange(cover),
      })
      .then(async (result) => {
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setError(null);
        notifications.show({ title: 'Saving', message: 'Progress is in the Jobs list.' });
        revealJobs();

        // Reopening the file is what shows the tags actually survived the round
        // trip, rather than only that ffmpeg exited cleanly. A failure needs no
        // handling here: the jobs list holds the verbatim output.
        const finished = await waitForJob(result.value.jobId);
        if (finished?.status === 'done') open(destinationPath);
      })
      .finally(() => setSaving(false));
  };

  const saveAs = (): void => {
    if (!media) return;
    void api.pickSaveTarget(media.info.path).then((path) => {
      if (path) save(path);
    });
  };

  const canEdit = media && format;

  return (
    <Stack gap="lg" maw={860} pos="relative">
      <LoadingOverlay visible={overlayVisible} zIndex={10} transitionProps={{ duration: 150 }} />

      {canEdit ? (
        <PanelActions
          status={
            changed
              ? 'Saving in place writes a verified copy first, then replaces the file.'
              : 'No changes yet.'
          }
        >
          <Button variant="default" onClick={saveAs} loading={saving}>
            Save as…
          </Button>
          <Button onClick={() => save(media.info.path)} disabled={!changed} loading={saving}>
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

          <Divider label="Tags" labelPosition="left" />

          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            {TAG_FIELDS.filter((field) => !field.multiline).map((field) => (
              <TextInput
                key={field.id}
                label={tagFieldLabel(field, media.info.kind)}
                description={field.description ?? undefined}
                {...form.getInputProps(field.id)}
              />
            ))}
          </SimpleGrid>

          {TAG_FIELDS.filter((field) => field.multiline).map((field) => (
            <Textarea
              key={field.id}
              label={tagFieldLabel(field, media.info.kind)}
              autosize
              minRows={2}
              maxRows={6}
              {...form.getInputProps(field.id)}
            />
          ))}

          <Divider label="Cover art" labelPosition="left" />

          <CoverArtCard
            info={media.info}
            support={format.coverArt}
            formatLabel={format.label}
            original={media.cover}
            draft={cover}
            onDraftChange={setCover}
            onError={setError}
          />
        </>
      ) : null}
    </Stack>
  );
}
