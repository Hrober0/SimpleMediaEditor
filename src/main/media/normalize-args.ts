import type { TagFamily } from '@shared/media-types';
import type { StreamSummary } from '@shared/metadata';
import { TRUE_PEAK_LIMIT_DBTP, type LoudnessTarget } from '@shared/normalize';
import { audioEncoder, isLossless, sampleFormatArgs } from './audio-encoder';
import type { LoudnormStats } from './loudnorm-stats';
import { familyArgs } from './write-args';

/**
 * ffmpeg argument construction for two-pass loudness normalization, kept pure
 * so the flags can be read and tested without the process plumbing.
 *
 * The first pass only measures. The second feeds those measurements back into
 * `loudnorm`, which lets it apply one fixed gain to the whole file instead of
 * guessing as it goes. Single pass rides the gain up and down through the track,
 * which is audible and lands off target.
 */

/**
 * The loudness range loudnorm may leave in place. loudnorm only applies one
 * linear gain when the file's own range fits under this; anything wider gets
 * compressed. 20 LU leaves nearly all music and speech alone.
 */
const LOUDNESS_RANGE_LU = 20;

/** Used when the source does not say what it was encoded at. */
const FALLBACK_SAMPLE_RATE = 48_000;
const FALLBACK_BITRATE = 192_000;
/** libmp3lame stops at 320k, and nothing gains from going higher on the others. */
const BITRATE_RANGE = { min: 64_000, max: 320_000 };

export function loudnormFilter(targetLufs: LoudnessTarget, measured: LoudnormStats | null): string {
  const options = [
    `I=${String(targetLufs)}`,
    `TP=${String(TRUE_PEAK_LIMIT_DBTP)}`,
    `LRA=${String(LOUDNESS_RANGE_LU)}`,
  ];
  if (measured) {
    // Clamped to the ranges loudnorm accepts, which refuses to start otherwise.
    options.push(
      `measured_I=${level(measured.inputIntegrated, -99, 0)}`,
      `measured_TP=${level(measured.inputTruePeak, -99, 99)}`,
      `measured_LRA=${level(measured.inputRange, 0, 99)}`,
      `measured_thresh=${level(measured.inputThreshold, -99, 0)}`,
      `offset=${level(measured.targetOffset, -99, 99)}`,
      'linear=true',
    );
  }
  options.push('print_format=json');
  return `loudnorm=${options.join(':')}`;
}

function level(value: number, min: number, max: number): string {
  return Math.min(max, Math.max(min, value)).toFixed(2);
}

/**
 * Reads the first audio stream to the end and discards it: the measurements
 * are what `loudnorm` prints to stderr once it is done.
 */
export function buildMeasureArgs(sourcePath: string, targetLufs: LoudnessTarget): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-i',
    sourcePath,
    '-map',
    '0:a:0',
    '-filter:a',
    loudnormFilter(targetLufs, null),
    // The null muxer opens no file, so "-" does not compete with the progress
    // lines on stdout.
    '-f',
    'null',
    '-nostats',
    '-progress',
    'pipe:1',
    '-',
  ];
}

export interface ApplyRequest {
  sourcePath: string;
  outputPath: string;
  targetLufs: LoudnessTarget;
  measured: LoudnormStats;
  /** Destination extension, lowercase without the dot: picks the encoder. */
  ext: string;
  family: TagFamily;
  /** The first audio stream of the source, whose rate, depth and bitrate are kept. */
  sourceAudio: StreamSummary;
}

/**
 * Re-encodes the first audio stream through `loudnorm` and copies everything
 * else as it was: video, cover art, other audio tracks and tags.
 */
export function buildApplyArgs(request: ApplyRequest): string[] {
  const { sourceAudio } = request;
  const codec = audioEncoder(request.ext, sourceAudio.codec);
  return [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-i',
    request.sourcePath,
    '-map',
    '0',
    '-c',
    'copy',
    '-filter:a:0',
    loudnormFilter(request.targetLufs, request.measured),
    '-c:a:0',
    codec,
    ...sampleFormatArgs(codec, sourceAudio.sampleFormat, 'a:0'),
    ...bitrateArgs(codec, sourceAudio.bitrate),
    // loudnorm works at 192 kHz internally and outputs at that rate unless told
    // otherwise.
    '-ar:a:0',
    String(sourceAudio.sampleRate ?? FALLBACK_SAMPLE_RATE),
    '-map_metadata',
    '0',
    ...familyArgs(request.family),
    '-nostats',
    '-progress',
    'pipe:1',
    request.outputPath,
  ];
}

/** Keeps the source's bitrate, so normalizing a 320k file does not shrink it to 128k. */
function bitrateArgs(codec: string, sourceBitrate: number | null): string[] {
  if (isLossless(codec)) return [];
  const bitrate = Math.min(
    BITRATE_RANGE.max,
    Math.max(BITRATE_RANGE.min, sourceBitrate ?? FALLBACK_BITRATE),
  );
  return ['-b:a:0', `${String(Math.round(bitrate / 1000))}k`];
}
