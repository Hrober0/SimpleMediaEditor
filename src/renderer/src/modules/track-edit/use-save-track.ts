import { useState } from 'react';
import { notifications } from '@mantine/notifications';
import type { OpenedMedia } from '@shared/metadata';
import type { ErrorInfo } from '@shared/result';
import { sanitizeKeepRanges, type KeepRange, type TrimExportMode } from '@shared/trim';
import { api } from '../../api';
import { useJobs } from '../../state/JobsContext';

interface SaveTrackOptions {
  media: OpenedMedia | null;
  segments: readonly KeepRange[];
  mode: TrimExportMode;
  setError: (error: ErrorInfo | null) => void;
  /** Called with the written file once the job is done, so the panel can reopen it. */
  onSaved: (path: string) => void;
}

interface SaveTrack {
  saving: boolean;
  save: (destinationPath: string) => void;
  saveAs: () => void;
}

/**
 * Queues the export of whatever the segments currently are.
 *
 * The work itself is a job: this only reports that it was accepted and waits
 * for that job to finish, so progress and cancelling stay in the Jobs list
 * rather than being tracked a second time here.
 */
export function useSaveTrack({
  media,
  segments,
  mode,
  setError,
  onSaved,
}: SaveTrackOptions): SaveTrack {
  const { revealJobs, waitForJob } = useJobs();
  const [saving, setSaving] = useState(false);

  const save = (destinationPath: string): void => {
    if (!media) return;
    setSaving(true);

    void api
      .trimMedia({
        sourcePath: media.info.path,
        destinationPath,
        ranges: sanitizeKeepRanges(segments, media.info.durationSeconds ?? 0),
        mode,
      })
      .then(async (result) => {
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setError(null);
        notifications.show({ title: 'Saving', message: 'Progress is in the Jobs list.' });
        revealJobs();

        const finished = await waitForJob(result.value.jobId);
        if (finished?.status === 'done') onSaved(destinationPath);
      })
      .finally(() => setSaving(false));
  };

  const saveAs = (): void => {
    if (!media) return;
    void api.pickSaveTarget(media.info.path).then((path) => {
      if (path) save(path);
    });
  };

  return { saving, save, saveAs };
}
