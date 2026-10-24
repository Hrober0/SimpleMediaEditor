import { useEffect, useState, type RefCallback } from 'react';
import type { KeepRange } from '@shared/trim';
import { SegmentPlayer, type ElementIndex } from './segment-player';
import type { WaveformSelection } from './Waveform';

interface PlaybackOptions {
  segments: readonly KeepRange[];
  /** The part to play over and over, or null to play straight through. */
  loop: WaveformSelection | null;
}

export interface Playback {
  /** In display time: the edited track's own timeline, not the original file's. */
  currentTime: number;
  playing: boolean;
  /** Both elements hold the same file; see `SegmentPlayer` for why there are two. */
  elementRefs: readonly [RefCallback<HTMLMediaElement>, RefCallback<HTMLMediaElement>];
  /** Which of the two is playing, and so which one should be seen. */
  activeElement: ElementIndex;
  togglePlay: () => void;
  seek: (displaySeconds: number) => void;
  /** Forgets where the playhead was, for when another file is opened. */
  reset: () => void;
}

/**
 * Plays the edited track, so the preview sounds and looks like the track being
 * edited rather than the file on disk. The work is in `SegmentPlayer`; this
 * only connects it to React state.
 */
export function usePlayback({ segments, loop }: PlaybackOptions): Playback {
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [activeElement, setActiveElement] = useState<ElementIndex>(0);

  const [player] = useState(
    () =>
      new SegmentPlayer({
        timeChanged: setCurrentTime,
        playingChanged: setPlaying,
        activeElementChanged: setActiveElement,
      }),
  );
  const [elementRefs] = useState(
    () =>
      [
        (element: HTMLMediaElement | null) => player.setElement(0, element),
        (element: HTMLMediaElement | null) => player.setElement(1, element),
      ] as const,
  );

  // An edit moves what sits at the playhead, so the player re-reads where it is.
  useEffect(() => player.setSegments(segments), [player, segments]);
  useEffect(() => player.setLoop(loop), [player, loop]);
  useEffect(() => () => player.reset(), [player]);

  return {
    currentTime,
    playing,
    elementRefs,
    activeElement,
    togglePlay: () => player.togglePlay(),
    seek: (displaySeconds) => player.seek(displaySeconds),
    reset: () => player.reset(),
  };
}
