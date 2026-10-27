import type { TagFamily } from '@shared/media-types';
import type { StreamSummary, TagValues } from '@shared/metadata';
import type { KeepRange } from '@shared/trim';
import { audioEncoder, sampleFormatArgs } from './audio-encoder';
import { metadataArgs } from './tags';

/**
 * ffmpeg argument construction for trimming, kept pure so the flags can be
 * read and tested without the process plumbing.
 *
 * Cover art is deliberately left out of every one of these: `0:V` and `0:a`
 * stream specifiers already exclude an attached-picture stream, so a trim
 * never carries it through, correctly or otherwise. Re-attaching it is a
 * second, separate pass that reuses the same embedding code Phase 2 uses for
 * tag edits (`buildWriteArgs`), rather than teaching this file about covers
 * too.
 *
 * Tags are written explicitly wherever a step is the final output, rather
 * than trusted to `-map_metadata 0` alone — measured against a real ffmpeg:
 * it reads tags back fine from an actual input file, but the concat
 * demuxer's virtual input does not expose an mp3's ID3 tags through it at
 * all, so a multi-range fast trim without this would silently come out
 * untagged.
 */

const PRECISE_VIDEO_CODEC: Record<string, string> = {
  mp4: 'libx264',
  mkv: 'libx264',
  webm: 'libvpx-vp9',
};

export function preciseVideoCodec(ext: string): string {
  return PRECISE_VIDEO_CODEC[ext] ?? 'libx264';
}

/**
 * Tags to write explicitly, rather than trusting `-map_metadata 0` alone: it
 * reads container tags back correctly from a real input file, but the concat
 * demuxer's virtual input does not expose an mp3's ID3 tags through it at
 * all — verified by concatenating a tagged file and finding the tags gone.
 */
export interface MetadataToKeep {
  values: TagValues;
  family: TagFamily;
}

function explicitMetadataArgs(metadata: MetadataToKeep | undefined): string[] {
  return metadata ? metadataArgs(metadata.values, metadata.family) : [];
}

export interface FastSegmentRequest {
  sourcePath: string;
  outputPath: string;
  range: KeepRange;
  hasAudio: boolean;
  hasVideo: boolean;
  /** Only needed when this segment is the final output, i.e. a single range. */
  metadata?: MetadataToKeep;
}

/**
 * One keep-range, extracted by stream copy. `-ss` before `-i` seeks to the
 * nearest keyframe rather than decoding up to that point, which is what makes
 * this mode fast — and also why the cut can land a little off the requested
 * time.
 */
export function buildFastSegmentArgs(request: FastSegmentRequest): string[] {
  const { sourcePath, outputPath, range, hasAudio, hasVideo, metadata } = request;
  const duration = range.endSeconds - range.startSeconds;

  return [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-ss',
    range.startSeconds.toFixed(3),
    '-i',
    sourcePath,
    '-t',
    duration.toFixed(3),
    // `V` (capital) and `a` map real video and audio only — an attached-picture
    // stream matches neither, so cover art is never pulled into a segment.
    ...(hasVideo ? ['-map', '0:V:0?'] : []),
    ...(hasAudio ? ['-map', '0:a:0?'] : []),
    '-c',
    'copy',
    '-map_metadata',
    '0',
    ...explicitMetadataArgs(metadata),
    '-avoid_negative_ts',
    'make_zero',
    '-nostats',
    '-progress',
    'pipe:1',
    outputPath,
  ];
}

export interface ConcatPart {
  path: string;
  /** How long the part is meant to be, which is not always how long the copy came out. */
  durationSeconds: number;
}

/**
 * The concat demuxer's list file. Paths are ones this app just created in its
 * own temp directory, but they are still escaped rather than trusted, since a
 * destination folder chosen by the user could itself contain a quote.
 *
 * Each part gets an `outpoint`. A stream copy can only stop audio at the end of
 * a codec frame, so a copied part's audio runs up to a frame past the cut, and
 * the demuxer starts the next part after the longer of its streams. Without the
 * outpoint every part after a cut lands that much late: the saved file drifts
 * away from what the editor showed, and its keyframes stop sitting on the cut
 * points where the next edit expects them.
 */
export function buildConcatListContent(parts: readonly ConcatPart[]): string {
  const entries = parts.map(
    (part) => `file ${escapeConcatPath(part.path)}\noutpoint ${part.durationSeconds.toFixed(6)}`,
  );
  return entries.join('\n') + '\n';
}

function escapeConcatPath(path: string): string {
  const escaped = path.replace(/\\/g, '\\\\').replace(/'/g, "'\\''");
  return `'${escaped}'`;
}

export interface ConcatRequest {
  listPath: string;
  outputPath: string;
  metadata?: MetadataToKeep;
}

/** Stitches the segments `buildFastSegmentArgs` produced back into one file. */
export function buildConcatArgs(request: ConcatRequest): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    request.listPath,
    '-c',
    'copy',
    '-map_metadata',
    '0',
    ...explicitMetadataArgs(request.metadata),
    '-nostats',
    '-progress',
    'pipe:1',
    request.outputPath,
  ];
}

export interface PreciseTrimRequest {
  sourcePath: string;
  outputPath: string;
  ranges: readonly KeepRange[];
  hasAudio: boolean;
  hasVideo: boolean;
  /** Destination extension, lowercase without the dot — picks the re-encode codec. */
  ext: string;
  /** The source's audio stream, whose bit depth a lossless output keeps. */
  sourceAudio: StreamSummary | null;
  metadata?: MetadataToKeep;
}

/**
 * Every keep-range, re-encoded and joined in a single pass by the `concat`
 * filter, exact to the frame: the cost `fast` mode's keyframe seek avoids.
 *
 * Each range is its own input, opened with `-ss`/`-t`, rather than one input
 * cut up with `trim` filters. Ranges can be in any order once a part has been
 * pasted elsewhere, and `trim` on a single input would have to hold every
 * decoded frame of a later part in memory until `concat` reached it. When
 * re-encoding, an input `-ss` decodes from the keyframe before and drops
 * frames up to the requested time, so it is still exact.
 */
export function buildPreciseTrimArgs(request: PreciseTrimRequest): string[] {
  const { sourcePath, outputPath, ranges, hasAudio, hasVideo, ext } = request;

  const inputs: string[] = [];
  const chains: string[] = [];
  const concatInputs: string[] = [];
  ranges.forEach((range, index) => {
    const input = String(index);
    inputs.push(
      '-ss',
      range.startSeconds.toFixed(3),
      '-t',
      (range.endSeconds - range.startSeconds).toFixed(3),
      '-i',
      sourcePath,
    );
    if (hasVideo) {
      chains.push(`[${input}:V:0]setpts=PTS-STARTPTS[v${input}]`);
      concatInputs.push(`[v${input}]`);
    }
    if (hasAudio) {
      chains.push(`[${input}:a:0]asetpts=PTS-STARTPTS[a${input}]`);
      concatInputs.push(`[a${input}]`);
    }
  });

  const outputLabels = `${hasVideo ? '[outv]' : ''}${hasAudio ? '[outa]' : ''}`;
  chains.push(
    `${concatInputs.join('')}concat=n=${String(ranges.length)}:v=${hasVideo ? 1 : 0}:a=${hasAudio ? 1 : 0}${outputLabels}`,
  );

  return [
    '-hide_banner',
    '-nostdin',
    '-y',
    ...inputs,
    '-filter_complex',
    chains.join(';'),
    ...(hasVideo ? ['-map', '[outv]', '-c:v', preciseVideoCodec(ext)] : []),
    ...(hasAudio ? ['-map', '[outa]', ...audioCodecArgs(ext, request.sourceAudio)] : []),
    '-map_metadata',
    '0',
    ...explicitMetadataArgs(request.metadata),
    '-nostats',
    '-progress',
    'pipe:1',
    outputPath,
  ];
}

function audioCodecArgs(ext: string, sourceAudio: StreamSummary | null): string[] {
  const codec = audioEncoder(ext, sourceAudio?.codec ?? null);
  return ['-c:a', codec, ...sampleFormatArgs(codec, sourceAudio?.sampleFormat ?? null, 'a')];
}
