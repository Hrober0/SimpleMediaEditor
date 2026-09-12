/**
 * The cut model: a list of ranges to keep, not a single in/out pair. Trimming
 * the start, trimming the end, and removing an interior segment are then the
 * same operation — just a different set of ranges — and multiple interior
 * cuts cost nothing extra.
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
 * Sorted, clamped to the file's duration, stripped of empty or out-of-range
 * entries, and merged where two ranges touch or overlap — so a request built
 * from imprecise UI dragging always becomes a clean, non-overlapping list.
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
    .filter((range) => range.endSeconds - range.startSeconds > MIN_RANGE_SECONDS)
    .sort((a, b) => a.startSeconds - b.startSeconds);

  const merged: KeepRange[] = [];
  for (const range of clamped) {
    const last = merged[merged.length - 1];
    if (last && range.startSeconds <= last.endSeconds) {
      last.endSeconds = Math.max(last.endSeconds, range.endSeconds);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/** Below this, a range is a slip of the pointer rather than an intended cut. */
const MIN_RANGE_SECONDS = 0.05;

export function totalKeptSeconds(ranges: readonly KeepRange[]): number {
  return ranges.reduce((total, range) => total + (range.endSeconds - range.startSeconds), 0);
}

/**
 * The track as it plays and displays now is the segments with every cut
 * closed up — no gaps. These convert between that "display" timeline (what
 * the waveform draws, what the playhead moves along) and the original
 * file's own timeline (what a segment's `startSeconds`/`endSeconds` and the
 * source's peaks are measured in).
 */
export function originalToDisplaySeconds(
  segments: readonly KeepRange[],
  originalSeconds: number,
): number {
  let displayed = 0;
  for (const segment of segments) {
    if (originalSeconds < segment.startSeconds) return displayed;
    if (originalSeconds <= segment.endSeconds)
      return displayed + (originalSeconds - segment.startSeconds);
    displayed += segment.endSeconds - segment.startSeconds;
  }
  return displayed;
}

export function displayToOriginalSeconds(
  segments: readonly KeepRange[],
  displaySeconds: number,
): number {
  let displayed = 0;
  for (const segment of segments) {
    const length = segment.endSeconds - segment.startSeconds;
    if (displaySeconds <= displayed + length) {
      return segment.startSeconds + (displaySeconds - displayed);
    }
    displayed += length;
  }
  const last = segments[segments.length - 1];
  return last ? last.endSeconds : 0;
}

/**
 * If `originalSeconds` currently sits in a gap (a part already cut), the
 * original-time position of the next surviving segment — where playback
 * should jump to keep sounding like the edited track rather than the
 * original one. Null when it is already inside a kept segment.
 */
export function nextKeptStart(
  segments: readonly KeepRange[],
  originalSeconds: number,
): number | null {
  for (const segment of segments) {
    if (originalSeconds < segment.startSeconds) return segment.startSeconds;
    if (originalSeconds <= segment.endSeconds) return null;
  }
  return null;
}

/**
 * Removes a range given in display time from the current segments, splitting
 * or shrinking whichever segment(s) it falls across. This is what "Cut"
 * does: the selection the user dragged is a display-time range, but a
 * segment's own bounds — and what actually has to change — are in the
 * original file's time.
 */
export function cutRange(
  segments: readonly KeepRange[],
  displayStart: number,
  displayEnd: number,
): KeepRange[] {
  if (displayEnd <= displayStart) return [...segments];
  const cuts = toOriginalCuts(segments, displayStart, displayEnd);
  return cuts.reduce<KeepRange[]>((current, cut) => removeInterval(current, cut), [...segments]);
}

function toOriginalCuts(
  segments: readonly KeepRange[],
  displayStart: number,
  displayEnd: number,
): KeepRange[] {
  const cuts: KeepRange[] = [];
  let displayed = 0;
  for (const segment of segments) {
    const length = segment.endSeconds - segment.startSeconds;
    const segmentDisplayStart = displayed;
    const segmentDisplayEnd = displayed + length;
    const overlapStart = Math.max(displayStart, segmentDisplayStart);
    const overlapEnd = Math.min(displayEnd, segmentDisplayEnd);
    if (overlapEnd > overlapStart) {
      cuts.push({
        startSeconds: segment.startSeconds + (overlapStart - segmentDisplayStart),
        endSeconds: segment.startSeconds + (overlapEnd - segmentDisplayStart),
      });
    }
    displayed = segmentDisplayEnd;
  }
  return cuts;
}

function removeInterval(segments: readonly KeepRange[], cut: KeepRange): KeepRange[] {
  return segments.flatMap((segment) => {
    const cutStart = Math.max(segment.startSeconds, cut.startSeconds);
    const cutEnd = Math.min(segment.endSeconds, cut.endSeconds);
    if (cutEnd <= cutStart) return [segment];

    const pieces: KeepRange[] = [];
    if (cutStart > segment.startSeconds) {
      pieces.push({ startSeconds: segment.startSeconds, endSeconds: cutStart });
    }
    if (cutEnd < segment.endSeconds) {
      pieces.push({ startSeconds: cutEnd, endSeconds: segment.endSeconds });
    }
    return pieces;
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
