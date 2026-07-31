import { rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import type { MediaInfo } from '@shared/metadata';
import { AppFailure, errorMessage } from '../errors';

/**
 * The single path by which any ffmpeg output replaces an existing file.
 *
 * ffmpeg cannot read and write the same file, so every "save in place" writes a
 * sibling temp file first. Beyond that, the replace itself is staged: the
 * original is moved aside and only deleted once the new file is in position, so
 * a failure at any point leaves the user with a complete file rather than none.
 *
 * Metadata edits, trims and normalization all go through here.
 */

/**
 * A temp file next to the destination, keeping the extension — ffmpeg picks its
 * muxer from that, so a ".tmp" name would produce the wrong container.
 *
 * Next to the destination rather than in the system temp directory: a rename
 * within one directory cannot cross a filesystem boundary, which is what makes
 * the final step near-atomic instead of a copy.
 */
export function tempOutputPath(destinationPath: string, token: string): string {
  const directory = dirname(destinationPath);
  const ext = extname(destinationPath);
  const base = basename(destinationPath, ext);
  return join(directory, `${base}.mediaeditor-${token}${ext}`);
}

function backupPath(destinationPath: string, token: string): string {
  return `${destinationPath}.mediaeditor-backup-${token}`;
}

/**
 * Puts `temporaryPath` in place of `destinationPath`.
 *
 * The original is renamed aside first and restored if the swap fails, so the
 * destination is never left missing or half-written. `rename` overwrites on both
 * Windows and Linux, but the backup is what makes a mid-operation failure
 * recoverable rather than silent data loss.
 */
export async function replaceFile(
  temporaryPath: string,
  destinationPath: string,
  token: string,
): Promise<void> {
  if (!(await fileExists(destinationPath))) {
    await rename(temporaryPath, destinationPath);
    return;
  }

  const backup = backupPath(destinationPath, token);
  await rename(destinationPath, backup);

  try {
    await rename(temporaryPath, destinationPath);
  } catch (error) {
    // The new file never landed; put the user's file back exactly as it was.
    await rename(backup, destinationPath).catch((restoreError: unknown) => {
      throw new AppFailure(
        `The file could not be replaced, and the original could not be restored. It is at ${backup}.`,
        `${errorMessage(error)}\n${errorMessage(restoreError)}`,
      );
    });
    throw error;
  }

  await removeQuietly(backup);
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export async function removeQuietly(path: string): Promise<void> {
  try {
    await rm(path, { force: true, maxRetries: 3 });
  } catch (error) {
    // A leftover temp or backup file is untidy, not a failure worth reporting —
    // on Windows an antivirus scan can hold a handle open briefly.
    console.warn(`[media] could not remove ${path}: ${errorMessage(error)}`);
  }
}

/** Tolerance for the duration check: containers round, and copies are exact. */
const DURATION_TOLERANCE_SECONDS = 1;
const DURATION_TOLERANCE_FRACTION = 0.02;

/**
 * Compares what ffmpeg produced against what went in, before anything is
 * replaced. A metadata write is a stream copy, so anything that lost a stream or
 * changed length means the output is not the file the user asked for — and the
 * original must stay untouched.
 *
 * Returns a description of the mismatch, or null when the output is sound.
 */
export function describeOutputMismatch(source: MediaInfo, output: MediaInfo): string | null {
  if (output.byteSize <= 0) return 'the new file is empty';
  if (source.audio && !output.audio) return 'the audio stream is missing from the new file';
  if (source.video && !output.video) return 'the video stream is missing from the new file';

  const before = source.durationSeconds;
  const after = output.durationSeconds;
  if (before !== null && after !== null && before > 0) {
    const allowed = Math.max(DURATION_TOLERANCE_SECONDS, before * DURATION_TOLERANCE_FRACTION);
    if (Math.abs(before - after) > allowed) {
      return `the new file is ${after.toFixed(1)}s long instead of ${before.toFixed(1)}s`;
    }
  }
  return null;
}
