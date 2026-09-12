import { formatBytes, formatDuration } from '@shared/format';
import { OUTPUT_PATH_PREFIX, PROGRESS_PREFIX } from './args';

/**
 * Turns yt-dlp's output lines into job updates.
 *
 * Progress comes from our own --progress-template, so it is parsed as fields
 * rather than scraped from human-facing text. Stage and path lines are yt-dlp's
 * own wording and are matched conservatively: an unrecognized line is ignored,
 * never guessed at.
 */

export interface DownloadProgress {
  /** 0..1, or null when the total size is unknown. */
  fraction: number | null;
  /** One-line summary: percentage, size, speed, ETA. */
  detail: string;
}

export function parseProgressLine(line: string): DownloadProgress | null {
  if (!line.startsWith(PROGRESS_PREFIX)) return null;

  const [, downloaded, total, estimate, speed, eta] = line.split('|');
  const done = toNumber(downloaded);
  const size = toNumber(total) ?? toNumber(estimate);
  const fraction = done !== null && size !== null && size > 0 ? Math.min(1, done / size) : null;

  const parts: string[] = [];
  if (fraction !== null) parts.push(`${(fraction * 100).toFixed(1)}%`);
  if (size !== null) parts.push(`of ${formatBytes(size)}`);
  else if (done !== null) parts.push(formatBytes(done));
  const rate = toNumber(speed);
  if (rate !== null) parts.push(`at ${formatBytes(rate)}/s`);
  const remaining = toNumber(eta);
  if (remaining !== null) parts.push(`ETA ${formatDuration(remaining)}`);

  return {
    fraction,
    detail: parts.length > 0 ? `Downloading — ${parts.join(' ')}` : 'Downloading',
  };
}

/**
 * Post-processing stages. Reporting these is what keeps the UI from sitting at
 * 100% looking hung while ffmpeg transcodes a long track.
 */
const STAGE_LABELS: readonly (readonly [RegExp, string])[] = [
  [/^\[youtube[^\]]*\]/, 'Reading video info'],
  [/^\[download\] Destination:/, 'Downloading'],
  [/^\[download\].*has already been downloaded/, 'Already downloaded'],
  [/^\[Merger\]/, 'Merging audio and video'],
  [/^\[ExtractAudio\]/, 'Extracting audio'],
  [/^\[VideoConvertor\]/, 'Converting video'],
  [/^\[Metadata\]/, 'Writing metadata'],
  [/^\[ThumbnailsConvertor\]/, 'Preparing cover art'],
  [/^\[EmbedThumbnail\]/, 'Embedding cover art'],
  [/^\[Fixup[A-Za-z0-9]*\]/, 'Fixing container'],
  [/^\[MoveFiles\]/, 'Moving into place'],
];

export function parseStageLine(line: string): string | null {
  for (const [pattern, label] of STAGE_LABELS) {
    if (pattern.test(line)) return label;
  }
  return null;
}

/** True for stages whose duration yt-dlp cannot report progress for. */
export function isPostProcessingStage(stage: string): boolean {
  return stage !== 'Downloading' && stage !== 'Reading video info';
}

/**
 * The finished file, as yt-dlp printed it for our --print template. This is the
 * answer where there is one; the log patterns below are only a fallback.
 */
export function parsePrintedOutputPath(line: string): string | null {
  if (!line.startsWith(OUTPUT_PATH_PREFIX)) return null;
  return line.slice(OUTPUT_PATH_PREFIX.length).trim() || null;
}

const OUTPUT_PATH_PATTERNS: readonly RegExp[] = [
  /^\[download\] Destination: (.+)$/,
  /^\[ExtractAudio\] Destination: (.+)$/,
  /^\[VideoConvertor\] Destination: (.+)$/,
  /^\[Merger\] Merging formats into "(.+)"$/,
  /^\[download\] (.+) has already been downloaded$/,
  /^\[EmbedThumbnail\] ffmpeg: Adding thumbnail to "(.+)"$/,
  // Last one to appear, and the only one naming the final destination when
  // intermediates are written to a temp directory.
  /^\[MoveFiles\] Moving file "(?:.+)" to "(.+)"$/,
];

/**
 * The path yt-dlp last reported writing, read out of its human-facing output.
 * Callers keep the most recent match: later stages rename the file, and only the
 * final name is useful. Used only when nothing was printed for our own template,
 * which is the case for a file that was already downloaded.
 */
export function parseOutputPath(line: string): string | null {
  for (const pattern of OUTPUT_PATH_PATTERNS) {
    const match = pattern.exec(line);
    const captured = match?.[1]?.trim();
    if (captured) return captured;
  }
  return null;
}

/** yt-dlp prints "NA" for fields that do not apply to the current stage. */
function toNumber(value: string | undefined): number | null {
  if (!value || value === 'NA') return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}
