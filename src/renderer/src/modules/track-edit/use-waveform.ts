import { useEffect, useState } from 'react';
import type { OpenedMedia } from '@shared/metadata';
import { api } from '../../api';

/** Enough detail to see where things start and stop at the widths we draw at. */
const BUCKET_COUNT = 2000;

interface LoadedWaveform {
  /** Which opened file these peaks were read from. Null means reading them failed. */
  media: OpenedMedia;
  peaks: readonly number[] | null;
}

/**
 * Reads the waveform of the opened file, which a file with no audio has none of.
 *
 * Peaks are held against the file they were read from, so a response that
 * arrives after another file was opened is never drawn over the one on screen,
 * and reopening a file after saving over it reads the new shape rather than
 * leaving the old one up.
 */
export function useWaveform(media: OpenedMedia | null): {
  peaks: readonly number[] | null;
  loading: boolean;
} {
  const [loaded, setLoaded] = useState<LoadedWaveform | null>(null);

  useEffect(() => {
    if (!media?.info.audio) return;

    let cancelled = false;
    void api.waveform({ path: media.info.path, bucketCount: BUCKET_COUNT }).then((result) => {
      if (!cancelled) setLoaded({ media, peaks: result.ok ? result.value.peaks : null });
    });

    return () => {
      cancelled = true;
    };
  }, [media]);

  const current = loaded?.media === media ? loaded : null;
  return {
    peaks: current?.peaks ?? null,
    loading: Boolean(media?.info.audio) && current === null,
  };
}
