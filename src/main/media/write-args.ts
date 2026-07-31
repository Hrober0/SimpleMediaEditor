import type { TagFamily } from '@shared/media-types';
import { COVER_MAX_EDGE, type CoverChange, type TagValues } from '@shared/metadata';
import { metadataArgs } from './tags';

/**
 * ffmpeg argument construction for a metadata write, kept pure so the flags can
 * be read and tested without the process plumbing.
 *
 * The output is always a different file from the input — ffmpeg cannot read and
 * write the same one, and the temp-then-replace dance is the caller's job.
 */

export interface WriteArgsRequest {
  sourcePath: string;
  /** A temp sibling of the real destination, with the same extension. */
  outputPath: string;
  family: TagFamily;
  values: TagValues;
  cover: CoverChange;
  /** Absolute stream indexes of artwork already in the source. */
  existingCoverStreams: readonly number[];
  /** Real video streams in the source, excluding artwork. */
  contentVideoStreams: number;
}

export function buildWriteArgs(request: WriteArgsRequest): string[] {
  const { cover } = request;
  const replacing = cover.kind === 'replace';
  // Keeping the old picture alongside a new one would leave two attached
  // pictures, and players pick whichever they meet first.
  const dropExisting = cover.kind !== 'keep';

  return [
    '-hide_banner',
    '-nostdin',
    // The output is a temp file this app just named; nothing can be overwritten
    // by surprise, and without -y ffmpeg would stop to ask.
    '-y',
    '-i',
    request.sourcePath,
    ...(replacing ? ['-i', cover.imagePath] : []),

    // Everything from the source, then the unwanted picture streams removed by
    // absolute index. Negative mapping is what makes "remove the old art"
    // expressible without listing every stream to keep.
    '-map',
    '0',
    ...(dropExisting
      ? request.existingCoverStreams.flatMap((index) => ['-map', `-0:${String(index)}`])
      : []),
    ...(replacing ? ['-map', '1:v:0'] : []),

    // Nothing is re-encoded: a tag edit must not degrade the audio.
    '-c',
    'copy',
    ...coverDispositionArgs(request),

    '-map_metadata',
    '0',
    ...metadataArgs(request.values, request.family),
    ...familyArgs(request.family),

    // Progress on stdout as key=value lines, leaving stderr for the messages
    // worth showing the user verbatim.
    '-nostats',
    '-progress',
    'pipe:1',
    request.outputPath,
  ];
}

/**
 * The new picture has to be marked `attached_pic`, or ffmpeg writes it as an
 * ordinary video stream and no player treats it as cover art.
 *
 * Its output index is counted among video streams only, so on a video file the
 * cover lands at `v:1` behind the real picture.
 */
function coverDispositionArgs(request: WriteArgsRequest): string[] {
  if (request.cover.kind !== 'replace') return [];
  const index = request.contentVideoStreams;
  const target = `:v:${String(index)}`;

  return [
    `-disposition${target}`,
    'attached_pic',
    // ID3 reads the stream comment as the APIC picture type; without it some
    // players file the image as "other" instead of showing it as the cover.
    `-metadata:s:v:${String(index)}`,
    'title=Album cover',
    `-metadata:s:v:${String(index)}`,
    'comment=Cover (front)',
  ];
}

function familyArgs(family: TagFamily): string[] {
  // ID3v2.3 is what Windows Explorer and older players read; ffmpeg defaults to
  // 2.4, whose tags they ignore.
  return family === 'id3' ? ['-id3v2_version', '3'] : [];
}

export interface CoverJpegRequest {
  /** An image file, or a media file to take a picture out of. */
  inputPath: string;
  outputPath: string;
  /** Seek before decoding — used when grabbing a frame from a video. */
  seekSeconds?: number;
  /** Absolute stream index, when pulling an embedded picture out of a file. */
  streamIndex?: number;
}

/**
 * The one way a cover image is produced: re-encoded to a baseline JPEG at a sane
 * size, whether it came from a file the user picked, a video frame, or the
 * artwork already embedded in the file.
 *
 * Oversized images and PNGs are exactly where embedding silently fails in some
 * players, so nothing skips this step — including the preview, which is then the
 * same bytes that will be written.
 */
export function buildCoverJpegArgs(request: CoverJpegRequest): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-y',
    // Before -i, so ffmpeg seeks rather than decoding everything up to that point.
    ...(request.seekSeconds === undefined ? [] : ['-ss', request.seekSeconds.toFixed(3)]),
    '-i',
    request.inputPath,
    ...(request.streamIndex === undefined ? [] : ['-map', `0:${String(request.streamIndex)}`]),
    // One frame only, so an animated GIF or a video is a single image, and
    // -update lets that be a plain filename instead of a numbered sequence.
    '-frames:v',
    '1',
    '-update',
    '1',
    '-vf',
    coverScaleFilter(),
    // mjpeg with 4:2:0 full-range chroma is baseline JPEG, which every decoder
    // handles; progressive JPEG is what some ID3 readers choke on.
    '-c:v',
    'mjpeg',
    '-pix_fmt',
    'yuvj420p',
    '-q:v',
    '3',
    request.outputPath,
  ];
}

/**
 * Shrinks to fit a square box while keeping the aspect ratio, and never scales
 * up — the quotes are ffmpeg's own, protecting the commas inside min() from its
 * filter parser.
 */
export function coverScaleFilter(): string {
  const edge = String(COVER_MAX_EDGE);
  return `scale='min(${edge},iw)':'min(${edge},ih)':force_original_aspect_ratio=decrease`;
}
