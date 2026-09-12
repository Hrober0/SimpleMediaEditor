import { useCallback, useEffect, useRef, useState, type RefCallback } from 'react';
import {
  displayToOriginalSeconds,
  nextKeptStart,
  originalToDisplaySeconds,
  type KeepRange,
} from '@shared/trim';
import type { WaveformSelection } from './Waveform';

/** How close to the end of the last segment counts as "there". */
const END_EPSILON_SECONDS = 0.05;

interface PlaybackOptions {
  /** Null while no file is open. Listeners re-attach when a different one is. */
  sourcePath: string | null;
  segments: readonly KeepRange[];
  /** The part to play over and over, or null to play straight through. */
  loop: WaveformSelection | null;
}

export interface Playback {
  /** In display time: the edited track's own timeline, not the original file's. */
  currentTime: number;
  playing: boolean;
  setMediaElement: RefCallback<HTMLMediaElement>;
  togglePlay: () => void;
  seek: (displaySeconds: number) => void;
  /** Forgets where the playhead was, for when another file is opened. */
  reset: () => void;
}

/**
 * Plays the edited track through an element that still holds the original file.
 *
 * Every position crossing that boundary is translated, and a cut part is
 * skipped rather than heard: this is what makes the preview match the track
 * being edited instead of the file on disk.
 */
export function usePlayback({ sourcePath, segments, loop }: PlaybackOptions): Playback {
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);

  const elementRef = useRef<HTMLMediaElement | null>(null);
  const setMediaElement = useCallback((element: HTMLMediaElement | null): void => {
    elementRef.current = element;
  }, []);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const onTime = (): void => {
      // A seek just issued has not resolved yet: whatever position is reported
      // right now is stale, and applying it would snap the playhead back to
      // wherever it was before the seek.
      if (element.seeking) return;

      // Nothing to map a position against: leave the displayed time alone
      // rather than let the "no segments" case fall through as zero.
      if (segments.length === 0) return;

      if (loop) {
        const loopEndOriginal = displayToOriginalSeconds(segments, loop.endSeconds);
        if (element.currentTime >= loopEndOriginal - END_EPSILON_SECONDS) {
          element.currentTime = displayToOriginalSeconds(segments, loop.startSeconds);
          return;
        }
      }

      const skipTo = nextKeptStart(segments, element.currentTime);
      if (skipTo !== null) {
        element.currentTime = skipTo;
        return;
      }

      const last = segments[segments.length - 1];
      if (last && element.currentTime > last.endSeconds + END_EPSILON_SECONDS) {
        element.pause();
        element.currentTime = last.endSeconds;
        return;
      }

      setCurrentTime(originalToDisplaySeconds(segments, element.currentTime));
    };
    const onPlay = (): void => setPlaying(true);
    const onPause = (): void => setPlaying(false);

    element.addEventListener('timeupdate', onTime);
    element.addEventListener('play', onPlay);
    element.addEventListener('pause', onPause);
    return () => {
      element.removeEventListener('timeupdate', onTime);
      element.removeEventListener('play', onPlay);
      element.removeEventListener('pause', onPause);
    };
  }, [sourcePath, segments, loop]);

  const togglePlay = (): void => {
    const element = elementRef.current;
    if (!element) return;
    if (element.paused) void element.play();
    else element.pause();
  };

  const seek = (displaySeconds: number): void => {
    const element = elementRef.current;
    // Setting currentTime before metadata has loaded is not lost: the spec
    // has the element remember it as the pending initial playback position
    // and apply it once the resource is ready, so nothing extra is needed
    // here for that case.
    if (element) element.currentTime = displayToOriginalSeconds(segments, displaySeconds);
    setCurrentTime(displaySeconds);
  };

  const reset = (): void => {
    setCurrentTime(0);
    setPlaying(false);
  };

  return { currentTime, playing, setMediaElement, togglePlay, seek, reset };
}
