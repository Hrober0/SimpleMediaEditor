/**
 * ffmpeg's `-progress` output, turned into job updates.
 *
 * The stream is `key=value` lines, one block per update, ending in
 * `progress=continue` or `progress=end`. `out_time` is parsed rather than
 * `out_time_ms`, whose unit has differed between ffmpeg versions.
 */

export interface FfmpegProgress {
  /** Position in the output, in seconds. */
  outSeconds: number | null;
  /** True once ffmpeg reports the final block. */
  finished: boolean;
}

export function parseProgressLine(line: string): FfmpegProgress | null {
  const separator = line.indexOf('=');
  if (separator === -1) return null;

  const key = line.slice(0, separator).trim();
  const value = line.slice(separator + 1).trim();

  if (key === 'progress') {
    return value === 'end' ? { outSeconds: null, finished: true } : null;
  }
  if (key !== 'out_time') return null;

  const seconds = parseTimestamp(value);
  return seconds === null ? null : { outSeconds: seconds, finished: false };
}

/** "00:01:02.500000" — and "N/A" before the first frame is written. */
export function parseTimestamp(value: string): number | null {
  const match = /^(\d+):([0-5]?\d):([0-5]?\d(?:\.\d+)?)$/.exec(value);
  if (!match) return null;

  const [, hours = '0', minutes = '0', seconds = '0'] = match;
  const total =
    Number.parseInt(hours, 10) * 3600 +
    Number.parseInt(minutes, 10) * 60 +
    Number.parseFloat(seconds);
  return Number.isFinite(total) ? total : null;
}

/**
 * Progress as a fraction, or null when the duration is unknown — an
 * indeterminate bar is honest, a bar that jumps to a made-up number is not.
 */
export function progressFraction(
  outSeconds: number,
  durationSeconds: number | null,
): number | null {
  if (durationSeconds === null || durationSeconds <= 0) return null;
  return Math.min(1, Math.max(0, outSeconds / durationSeconds));
}
