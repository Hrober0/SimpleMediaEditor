/**
 * The cut model: a list of ranges to keep, not a single in/out pair. Trimming
 * the start, trimming the end, and removing an interior segment are then the
 * same operation — just a different set of ranges — and multiple interior
 * cuts cost nothing extra.
 *
 * The list is in play order, not in the original file's order: a part that was
 * cut and pasted elsewhere plays where it was pasted, and a part pasted twice
 * appears twice.
 */

export interface KeepRange {
  startSeconds: number;
  endSeconds: number;
}

/**
 * `fast` copies streams and cuts on the nearest keyframe — quick, but the cut
 * can land up to a few seconds off. `precise` re-encodes to land exactly on
 * the requested time, at the cost of speed.
 */
export type TrimExportMode = 'fast' | 'precise';

export interface TrimRequest {
  sourcePath: string;
  /** Equal to `sourcePath` for a trim in place. Must keep the same extension. */
  destinationPath: string;
  ranges: readonly KeepRange[];
  mode: TrimExportMode;
}

/**
 * Clamped to the file's duration, stripped of empty or out-of-range entries,
 * and joined where one range carries straight on from the one before it, so a
 * request built from imprecise UI dragging always becomes a clean list.
 *
 * Order is kept as given rather than sorted, since it is the play order.
 */
export function sanitizeKeepRanges(
  ranges: readonly KeepRange[],
  durationSeconds: number,
): KeepRange[] {
  const clamped = ranges
    .map((range) => ({
      startSeconds: clamp(range.startSeconds, 0, durationSeconds),
      endSeconds: clamp(range.endSeconds, 0, durationSeconds),
    }))
    .filter((range) => range.endSeconds - range.startSeconds > MIN_RANGE_SECONDS);
  return joinContinuing(clamped);
}

/** Below this, a range is a slip of the pointer rather than an intended cut. */
const MIN_RANGE_SECONDS = 0.05;

/**
 * Closer than this to a segment's edge, a cut or paste point is taken to be
 * the edge itself, so splitting there does not leave a sliver of a segment.
 */
const EDGE_SECONDS = 0.001;

export function totalKeptSeconds(ranges: readonly KeepRange[]): number {
  return ranges.reduce((total, range) => total + (range.endSeconds - range.startSeconds), 0);
}

/**
 * The track as it plays and displays now is the segments, in order, with
 * every cut closed up: no gaps. "Display" time is that track's own timeline
 * (what the waveform draws, what the playhead moves along); "original" time is
 * the file's (what a segment's bounds and the source's peaks are measured in).
 *
 * Because segments can be reordered or repeated, one original time can sit at
 * several display times. A playback position is therefore a segment plus a
 * time inside it, never an original time alone.
 */
export interface TrackPosition {
  segmentIndex: number;
  originalSeconds: number;
}

export function displayToOriginalSeconds(
  segments: readonly KeepRange[],
  displaySeconds: number,
): number {
  return locateDisplaySeconds(segments, displaySeconds)?.originalSeconds ?? 0;
}

/** Null for an empty track. Past the end, the end of the last segment. */
export function locateDisplaySeconds(
  segments: readonly KeepRange[],
  displaySeconds: number,
): TrackPosition | null {
  let displayed = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (!segment) continue;
    const length = segment.endSeconds - segment.startSeconds;
    if (displaySeconds < displayed + length) {
      return {
        segmentIndex: index,
        originalSeconds: segment.startSeconds + Math.max(0, displaySeconds - displayed),
      };
    }
    displayed += length;
  }
  const lastIndex = segments.length - 1;
  const last = segments[lastIndex];
  return last ? { segmentIndex: lastIndex, originalSeconds: last.endSeconds } : null;
}

export function positionToDisplaySeconds(
  segments: readonly KeepRange[],
  position: TrackPosition,
): number {
  const segment = segments[position.segmentIndex];
  if (!segment) return totalKeptSeconds(segments);
  const inside = clamp(
    position.originalSeconds - segment.startSeconds,
    0,
    segment.endSeconds - segment.startSeconds,
  );
  return totalKeptSeconds(segments.slice(0, position.segmentIndex)) + inside;
}

/**
 * Where playback next has to leave the stretch of the file it is playing, and
 * where in the file it carries on. `to` is null at the end of the track.
 *
 * A running loop ends inside a segment rather than at its edge, which is why a
 * jump is not always "on to the next segment".
 */
export interface PlaybackJump {
  atOriginalSeconds: number;
  to: TrackPosition | null;
}

export function nextJump(
  segments: readonly KeepRange[],
  position: TrackPosition,
  loop: KeepRange | null,
): PlaybackJump | null {
  const segment = segments[position.segmentIndex];
  if (!segment) return null;

  const segmentDisplayStart = totalKeptSeconds(segments.slice(0, position.segmentIndex));
  const segmentDisplayEnd = segmentDisplayStart + (segment.endSeconds - segment.startSeconds);
  const displayNow = positionToDisplaySeconds(segments, position);

  if (loop && displayNow < loop.endSeconds && loop.endSeconds <= segmentDisplayEnd) {
    return {
      atOriginalSeconds: segment.startSeconds + (loop.endSeconds - segmentDisplayStart),
      to: locateDisplaySeconds(segments, loop.startSeconds),
    };
  }

  const following = segments[position.segmentIndex + 1];
  return {
    atOriginalSeconds: segment.endSeconds,
    to: following
      ? { segmentIndex: position.segmentIndex + 1, originalSeconds: following.startSeconds }
      : null,
  };
}

export interface CutResult {
  kept: KeepRange[];
  /** What was cut out, in play order, ready to be pasted somewhere else. */
  removed: KeepRange[];
}

/**
 * Removes a range given in display time from the current segments, splitting
 * whichever segments it starts and ends inside. The selection the user dragged
 * is a display-time range, but what actually has to change is the segments'
 * own bounds, in original time.
 */
export function cutRange(
  segments: readonly KeepRange[],
  displayStart: number,
  displayEnd: number,
): CutResult {
  if (displayEnd <= displayStart) return { kept: [...segments], removed: [] };
  const atStart = splitAt(segments, displayStart);
  const atEnd = splitAt(atStart.segments, displayEnd);
  return {
    kept: joinContinuing([
      ...atEnd.segments.slice(0, atStart.index),
      ...atEnd.segments.slice(atEnd.index),
    ]),
    removed: atEnd.segments.slice(atStart.index, atEnd.index),
  };
}

/** Inserts `pasted` at a display time, pushing everything after it later by its length. */
export function pasteAt(
  segments: readonly KeepRange[],
  displaySeconds: number,
  pasted: readonly KeepRange[],
): KeepRange[] {
  const split = splitAt(segments, displaySeconds);
  return joinContinuing([
    ...split.segments.slice(0, split.index),
    ...pasted,
    ...split.segments.slice(split.index),
  ]);
}

/**
 * Splits the segment `displaySeconds` falls inside, so that point becomes a
 * boundary. `index` is the first segment starting at or after it.
 */
function splitAt(
  segments: readonly KeepRange[],
  displaySeconds: number,
): { segments: KeepRange[]; index: number } {
  const result: KeepRange[] = [];
  let displayed = 0;
  let index: number | null = null;

  for (const segment of segments) {
    const length = segment.endSeconds - segment.startSeconds;
    const offset = displaySeconds - displayed;
    if (index === null && offset < length - EDGE_SECONDS) {
      if (offset > EDGE_SECONDS) {
        const splitPoint = segment.startSeconds + offset;
        result.push({ startSeconds: segment.startSeconds, endSeconds: splitPoint });
        index = result.length;
        result.push({ startSeconds: splitPoint, endSeconds: segment.endSeconds });
      } else {
        index = result.length;
        result.push({ ...segment });
      }
    } else {
      result.push({ ...segment });
    }
    displayed += length;
  }
  return { segments: result, index: index ?? result.length };
}

/** Joins neighbours where one ends exactly where the next begins in the original file. */
function joinContinuing(segments: readonly KeepRange[]): KeepRange[] {
  const joined: KeepRange[] = [];
  for (const segment of segments) {
    const last = joined[joined.length - 1];
    if (last && Math.abs(segment.startSeconds - last.endSeconds) < EDGE_SECONDS) {
      last.endSeconds = segment.endSeconds;
    } else {
      joined.push({ ...segment });
    }
  }
  return joined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
