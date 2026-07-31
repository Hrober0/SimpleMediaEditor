import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CoverImage, MediaInfo } from '@shared/metadata';
import { AppFailure, errorMessage } from '../errors';
import { runProcess } from '../jobs/runner';
import { probeFile } from './probe';
import { buildCoverJpegArgs } from './write-args';

/**
 * Cover art preparation.
 *
 * Every image the app is going to embed — picked from disk, grabbed from a video
 * frame, or read back out of a file for preview — is re-encoded here to one
 * baseline JPEG in a directory the app owns. That means the preview the user
 * approves is byte-for-byte what gets written, and that the only cover paths the
 * save step has to trust are ones this module produced.
 */

/** Generous for a 4K frame grab on a slow disk, short enough not to hang the UI. */
const COVER_TIMEOUT_MS = 60_000;

/** A picked image larger than this is a mistake, not a cover. */
const MAX_SOURCE_IMAGE_BYTES = 64 * 1024 * 1024;

export interface CoverDeps {
  ffmpegPath: string;
  ffprobePath: string;
  /** Directory the app owns for prepared covers; see coverDirectory(). */
  coverDirectory: string;
}

/** Prepared covers live under the app's temp root, and only there. */
export function coverDirectory(tempRoot: string): string {
  return join(tempRoot, 'mediaeditor', 'covers');
}

/**
 * Wipes covers left by an earlier run. They are only useful for the session that
 * made them, and each one is a megabyte of temp space.
 */
export async function clearCoverDirectory(directory: string): Promise<void> {
  try {
    await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  } catch (error) {
    console.warn(`[media] could not clear ${directory}: ${errorMessage(error)}`);
  }
}

/** An image the user picked or dropped, re-encoded ready to embed. */
export async function prepareCoverFromImage(
  imagePath: string,
  deps: CoverDeps,
): Promise<CoverImage> {
  const info = await stat(imagePath).catch(() => null);
  if (!info?.isFile()) throw new AppFailure('That image is no longer there.');
  if (info.size > MAX_SOURCE_IMAGE_BYTES) {
    throw new AppFailure('That image is too large to use as cover art.');
  }
  return encodeCover({ inputPath: imagePath }, deps, 'That image could not be read.');
}

/**
 * An image pasted from the clipboard. A clipboard bitmap has no path, so the bytes
 * are written into the cover directory first and then encoded down the same path as
 * every other cover.
 */
export async function prepareCoverFromBytes(
  bytes: Uint8Array,
  deps: CoverDeps,
): Promise<CoverImage> {
  if (bytes.byteLength === 0) throw new AppFailure('There is no image on the clipboard.');
  if (bytes.byteLength > MAX_SOURCE_IMAGE_BYTES) {
    throw new AppFailure('That image is too large to use as cover art.');
  }

  await mkdir(deps.coverDirectory, { recursive: true });
  const sourcePath = join(deps.coverDirectory, `pasted-${randomUUID()}.png`);
  await writeFile(sourcePath, bytes);

  try {
    return await encodeCover({ inputPath: sourcePath }, deps, 'That image could not be read.');
  } finally {
    // The encoded JPEG is the one that gets embedded; this is scratch either way.
    await rm(sourcePath, { force: true }).catch(() => undefined);
  }
}

/** One frame of a video, for files whose cover should come from the footage. */
export async function prepareCoverFromFrame(
  mediaPath: string,
  atSeconds: number,
  deps: CoverDeps,
): Promise<CoverImage> {
  const seekSeconds = Number.isFinite(atSeconds) ? Math.max(0, atSeconds) : 0;
  return encodeCover(
    { inputPath: mediaPath, seekSeconds },
    deps,
    'No frame could be read at that position.',
  );
}

/**
 * The artwork already in a file, for the preview. Returns null when there is
 * none — or when the embedded image is one ffmpeg cannot decode, which is worth
 * showing as "no art" rather than as a failure to open the file.
 */
export async function extractEmbeddedCover(
  info: MediaInfo,
  deps: CoverDeps,
): Promise<CoverImage | null> {
  const [streamIndex] = info.coverStreamIndexes;
  if (streamIndex === undefined) return null;

  try {
    return await encodeCover(
      { inputPath: info.path, streamIndex },
      deps,
      'The embedded artwork could not be read.',
    );
  } catch (error) {
    console.warn(`[media] unreadable embedded cover in ${info.path}: ${errorMessage(error)}`);
    return null;
  }
}

async function encodeCover(
  source: { inputPath: string; seekSeconds?: number; streamIndex?: number },
  deps: CoverDeps,
  failureMessage: string,
): Promise<CoverImage> {
  await mkdir(deps.coverDirectory, { recursive: true });
  const outputPath = join(deps.coverDirectory, `cover-${randomUUID()}.jpg`);

  const result = await runProcess({
    binary: deps.ffmpegPath,
    args: buildCoverJpegArgs({ ...source, outputPath }),
    timeoutMs: COVER_TIMEOUT_MS,
  });

  if (result.terminated) {
    await rm(outputPath, { force: true }).catch(() => undefined);
    throw new AppFailure('ffmpeg took too long to prepare that image and was stopped.');
  }
  if (result.code !== 0) {
    await rm(outputPath, { force: true }).catch(() => undefined);
    throw new AppFailure(failureMessage, result.stderrTail.join('\n'));
  }

  return describeCover(outputPath, deps);
}

/**
 * Measures the finished JPEG and reads it back as a data URL, since the renderer
 * has no filesystem access and cannot preview a path.
 */
async function describeCover(path: string, deps: CoverDeps): Promise<CoverImage> {
  const probed = await probeFile(path, { ffprobePath: deps.ffprobePath });
  const bytes = await readFile(path);

  return {
    path,
    previewDataUrl: `data:image/jpeg;base64,${bytes.toString('base64')}`,
    width: probed.video?.width ?? 0,
    height: probed.video?.height ?? 0,
    byteSize: bytes.byteLength,
  };
}
