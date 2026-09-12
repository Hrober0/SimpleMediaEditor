import type { TagFamily } from '@shared/media-types';
import type { TagValues } from '@shared/metadata';
import type { KeepRange } from '@shared/trim';
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

/** Re-encode audio codec per container, so the output can still be opened as
 *  what its extension claims. Stream copy in `fast` mode needs none of this —
 *  it only applies to `precise` mode. */
const PRECISE_AUDIO_CODEC: Record<string, string> = {
  mp3: 'libmp3lame',
  m4a: 'aac',
  mp4: 'aac',
  opus: 'libopus',
  flac: 'flac',
  wav: 'pcm_s16le',
  webm: 'libopus',
  mkv: 'aac',
};

const PRECISE_VIDEO_CODEC: Record<string, string> = {
  mp4: 'libx264',
  mkv: 'libx264',
  webm: 'libvpx-vp9',
};

export function preciseAudioCodec(ext: string): string {
  return PRECISE_AUDIO_CODEC[ext] ?? 'aac';
}

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

/**
 * The concat demuxer's list file. Paths are ones this app just created in its
 * own temp directory, but they are still escaped rather than trusted, since a
 * destination folder chosen by the user could itself contain a quote.
 */
export function buildConcatListContent(segmentPaths: readonly string[]): string {
  return segmentPaths.map((path) => `file ${escapeConcatPath(path)}`).join('\n') + '\n';
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
  metadata?: MetadataToKeep;
}

/**
 * Every keep-range, re-encoded and joined in a single pass via `trim`/`atrim`
 * plus the `concat` filter. One invocation regardless of how many ranges
 * there are, and exact to the frame — the cost `fast` mode's keyframe seek
 * avoids.
 */
export function buildPreciseTrimArgs(request: PreciseTrimRequest): string[] {
  const { sourcePath, outputPath, ranges, hasAudio, hasVideo, ext } = request;

  const chains: string[] = [];
  const concatInputs: string[] = [];
  ranges.forEach((range, index) => {
    const start = range.startSeconds.toFixed(3);
    const end = range.endSeconds.toFixed(3);
    if (hasVideo) {
      chains.push(`[0:V:0]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${String(index)}]`);
      concatInputs.push(`[v${String(index)}]`);
    }
    if (hasAudio) {
      chains.push(`[0:a:0]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${String(index)}]`);
      concatInputs.push(`[a${String(index)}]`);
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
    '-i',
    sourcePath,
    '-filter_complex',
    chains.join(';'),
    ...(hasVideo ? ['-map', '[outv]', '-c:v', preciseVideoCodec(ext)] : []),
    ...(hasAudio ? ['-map', '[outa]', '-c:a', preciseAudioCodec(ext)] : []),
    '-map_metadata',
    '0',
    ...explicitMetadataArgs(request.metadata),
    '-nostats',
    '-progress',
    'pipe:1',
    outputPath,
  ];
}
