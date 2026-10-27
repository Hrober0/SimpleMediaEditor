import { basename, extname } from 'node:path';
import type { MediaInfo, StreamSummary } from '@shared/metadata';
import { AppFailure } from '../errors';
import { runProcess } from '../jobs/runner';

/**
 * ffprobe, normalized into `MediaInfo`.
 *
 * Everything the app needs to know about a file — what it is, how long, whether
 * it already carries artwork — comes from here, so no other module has to
 * interpret ffprobe's JSON shape.
 */

/** ffprobe is fast; a hang means something is wrong with the file or the tool. */
const PROBE_TIMEOUT_MS = 30_000;

export interface ProbeDeps {
  ffprobePath: string;
  signal?: AbortSignal;
}

export function buildProbeArgs(path: string): string[] {
  return [
    '-hide_banner',
    // Keeps stderr for real problems only; the JSON we want is on stdout.
    '-loglevel',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    // `-i` rather than a bare positional, so a path starting with "-" is read as
    // a filename instead of an option.
    '-i',
    path,
  ];
}

export async function probeFile(path: string, deps: ProbeDeps): Promise<MediaInfo> {
  const result = await runProcess({
    binary: deps.ffprobePath,
    args: buildProbeArgs(path),
    captureStdout: true,
    timeoutMs: PROBE_TIMEOUT_MS,
    signal: deps.signal,
  });

  if (result.terminated) {
    throw new AppFailure('ffprobe took too long to read that file and was stopped.');
  }
  if (result.code !== 0) {
    // ffprobe's own wording ("Invalid data found when processing input") is the
    // useful part, so it goes through untouched.
    throw new AppFailure('ffprobe could not read that file.', result.stderrTail.join('\n'));
  }

  return parseProbeOutput(result.stdout, path);
}

/**
 * Exported so the shape handling can be exercised directly. Every field ffprobe
 * reports is optional in practice — numbers arrive as strings, durations are
 * missing for some containers, and tag keys differ per format.
 */
export function parseProbeOutput(stdout: string, path: string): MediaInfo {
  const root = parseJsonObject(stdout);
  const format = isRecord(root.format) ? root.format : {};
  const streams = asArray(root.streams).filter(isRecord);

  const coverStreamIndexes = streams
    .filter(isAttachedPicture)
    .map((stream) => asNumber(stream.index))
    .filter((index): index is number => index !== null);

  const audioStream = streams.find((stream) => stream.codec_type === 'audio');
  const videoStream = streams.find(
    (stream) => stream.codec_type === 'video' && !isAttachedPicture(stream),
  );

  if (!audioStream && !videoStream) {
    throw new AppFailure('That file contains no audio or video stream.');
  }

  return {
    path,
    fileName: basename(path),
    byteSize: asNumber(format.size) ?? 0,
    ext: extname(path).replace('.', '').toLowerCase(),
    containerLabel: asString(format.format_long_name) ?? asString(format.format_name),
    // From the streams, not the extension: an mp4 holding only audio is audio.
    kind: videoStream ? 'video' : 'audio',
    durationSeconds: asNumber(format.duration) ?? asNumber(audioStream?.duration),
    bitrate: asNumber(format.bit_rate),
    audio: toStreamSummary(audioStream),
    video: toStreamSummary(videoStream),
    coverStreamIndexes,
    tags: lowercaseTags(format.tags),
  };
}

function toStreamSummary(stream: Record<string, unknown> | undefined): StreamSummary | null {
  if (!stream) return null;
  return {
    codec: asString(stream.codec_name) ?? 'unknown',
    width: asNumber(stream.width),
    height: asNumber(stream.height),
    channels: asNumber(stream.channels),
    sampleRate: asNumber(stream.sample_rate),
    bitrate: asNumber(stream.bit_rate),
    // Planar or packed is how the decoder lays samples out in memory, not part
    // of the file, so "s16p" and "s16" are the same depth.
    sampleFormat: asString(stream.sample_fmt)?.replace(/p$/, '') ?? null,
  };
}

/**
 * Embedded artwork is reported as a video stream; the disposition is the only
 * thing that tells it apart from actual video.
 */
function isAttachedPicture(stream: Record<string, unknown>): boolean {
  if (stream.codec_type !== 'video') return false;
  const disposition = isRecord(stream.disposition) ? stream.disposition : {};
  return asNumber(disposition.attached_pic) === 1;
}

/**
 * Tag keys are case-inconsistent across containers — FLAC reports `TITLE`, mp3
 * reports `title` — so lookups are done against lowercased keys.
 */
function lowercaseTags(value: unknown): Record<string, string> {
  const tags: Record<string, string> = {};
  if (!isRecord(value)) return tags;
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'string') tags[key.toLowerCase()] = raw;
    else if (typeof raw === 'number') tags[key.toLowerCase()] = String(raw);
  }
  return tags;
}

function parseJsonObject(stdout: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (!isRecord(parsed)) throw new Error('expected a JSON object');
    return parsed;
  } catch (error) {
    throw new AppFailure(
      'ffprobe returned output the app could not read.',
      error instanceof Error ? error.message : String(error),
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

/** ffprobe reports numbers as strings, and "N/A" where a value is unknown. */
function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value === 'N/A') return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}
