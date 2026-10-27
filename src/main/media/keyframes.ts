import type { KeepRange } from '@shared/trim';
import { AppFailure } from '../errors';
import { runProcess } from '../jobs/runner';

/**
 * Keyframe times, for fast (stream copy) trimming.
 *
 * A stream copy can only start a video on a keyframe. Asked to start anywhere
 * else, ffmpeg quietly starts at the keyframe before and keeps everything from
 * there, so each part comes out longer than asked by up to a whole keyframe
 * interval. Over several parts of a video with sparse keyframes, that adds up
 * to many seconds, and the export fails its length check. Moving each start
 * back to its keyframe up front makes what ffmpeg writes and what was asked for
 * the same thing, so the check can stay strict.
 */

/** Reading packet headers only, no decoding, is quick even for a long film. */
const KEYFRAME_TIMEOUT_MS = 2 * 60 * 1000;

export interface KeyframeDeps {
  ffprobePath: string;
  signal?: AbortSignal;
}

export function buildKeyframeArgs(path: string): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    // `V` (capital) skips an attached picture, which is a one-frame "video".
    '-select_streams',
    'V:0',
    '-show_entries',
    'packet=pts_time,flags:format=start_time',
    '-of',
    'compact',
    '-i',
    path,
  ];
}

export type KeyframeLine =
  { kind: 'keyframe'; seconds: number } | { kind: 'start'; seconds: number } | null;

/** One line of `-of compact` output, e.g. `packet|pts_time=4.000000|flags=K__`. */
export function parseKeyframeLine(line: string): KeyframeLine {
  const [section, ...fields] = line.trim().split('|');
  const values = new Map(
    fields.map((field) => {
      const separator = field.indexOf('=');
      return [field.slice(0, separator), field.slice(separator + 1)] as const;
    }),
  );

  if (section === 'packet') {
    const seconds = Number.parseFloat(values.get('pts_time') ?? '');
    const isKeyframe = (values.get('flags') ?? '').includes('K');
    return isKeyframe && Number.isFinite(seconds) ? { kind: 'keyframe', seconds } : null;
  }
  if (section === 'format') {
    const seconds = Number.parseFloat(values.get('start_time') ?? '');
    return Number.isFinite(seconds) ? { kind: 'start', seconds } : null;
  }
  return null;
}

/**
 * Keyframe times measured from the start of the file, which is what `-ss`
 * counts from: ffmpeg adds the container's start time to it before seeking.
 */
export async function readKeyframes(path: string, deps: KeyframeDeps): Promise<number[]> {
  const raw: number[] = [];
  let startSeconds = 0;

  const result = await runProcess({
    binary: deps.ffprobePath,
    args: buildKeyframeArgs(path),
    timeoutMs: KEYFRAME_TIMEOUT_MS,
    signal: deps.signal,
    onLine: (line, stream) => {
      if (stream !== 'stdout') return;
      const parsed = parseKeyframeLine(line);
      if (parsed?.kind === 'keyframe') raw.push(parsed.seconds);
      if (parsed?.kind === 'start') startSeconds = parsed.seconds;
    },
  });

  if (result.terminated && !deps.signal?.aborted) {
    throw new AppFailure('ffprobe took too long to read the keyframes and was stopped.');
  }
  if (!result.terminated && result.code !== 0) {
    throw new AppFailure('ffprobe could not read the keyframes.', result.stderrTail.join('\n'));
  }

  return raw.map((seconds) => seconds - startSeconds).sort((a, b) => a - b);
}

/**
 * How far ahead of a start a keyframe may sit and still count as on it.
 *
 * A file this app already saved in fast mode has its keyframes a few
 * milliseconds after where the cuts were: each copied part keeps the audio
 * frame that began just before its keyframe, which pushes the picture that much
 * later. Cutting there again would otherwise go back a whole keyframe interval
 * and bring back a second or more of what was cut. Starting up to this much
 * late instead loses less than one video frame.
 */
const ON_KEYFRAME_SECONDS = 0.03;

/**
 * Moves each range's start back to the keyframe at or before it, or forward
 * onto one only a few milliseconds ahead. The end is left alone: a copy can
 * stop on any frame.
 *
 * The new start is rounded up to the next millisecond, never down. ffmpeg
 * seeks to the last keyframe at or before `-ss`, and a time rounded to just
 * under the keyframe would land on the one before it instead.
 */
export function snapToKeyframes(
  ranges: readonly KeepRange[],
  keyframes: readonly number[],
): KeepRange[] {
  if (keyframes.length === 0) return ranges.map((range) => ({ ...range }));
  return ranges.map((range) => {
    const keyframe = lastAtOrBefore(
      keyframes,
      Math.min(range.startSeconds + ON_KEYFRAME_SECONDS, range.endSeconds),
    );
    if (keyframe === null) return { ...range };
    return {
      startSeconds: Math.max(0, Math.ceil(keyframe * 1000) / 1000),
      endSeconds: range.endSeconds,
    };
  });
}

function lastAtOrBefore(sorted: readonly number[], seconds: number): number | null {
  let found: number | null = null;
  for (const value of sorted) {
    if (value > seconds) break;
    found = value;
  }
  return found;
}
