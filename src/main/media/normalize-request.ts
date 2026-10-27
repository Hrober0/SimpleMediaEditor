import { basename, isAbsolute, join, resolve } from 'node:path';
import { formatForExtension } from '@shared/media-types';
import {
  LOUDNESS_TARGETS,
  type LoudnessTarget,
  type NormalizeOutput,
  type NormalizeRequest,
} from '@shared/normalize';
import { AppFailure } from '../errors';

/** One file to normalize, with where the result goes. */
export interface NormalizeTask {
  sourcePath: string;
  /** Equal to `sourcePath` when the original is replaced. */
  destinationPath: string;
  targetLufs: LoudnessTarget;
}

/**
 * A normalize request from the renderer becomes ffmpeg arguments and files on
 * disk, so it is validated here rather than trusted, the same as a trim or a
 * tag edit.
 */
export function validateNormalizeRequest(request: NormalizeRequest): NormalizeTask[] {
  const targetLufs = validateTarget(request.targetLufs);
  const directory = outputDirectory(request.output);
  const sourcePaths = validatePaths(request.paths);

  const tasks = sourcePaths.map((sourcePath) => ({
    sourcePath,
    destinationPath: directory === null ? sourcePath : join(directory, basename(sourcePath)),
    targetLufs,
  }));

  if (directory === null) return tasks;

  // Two sources with the same name would be written to the same file in the
  // folder, and the second would silently replace the first.
  const seen = new Set<string>();
  for (const task of tasks) {
    const key = destinationKey(task.destinationPath);
    if (seen.has(key)) {
      throw new AppFailure(
        `Two of the files are called ${basename(task.destinationPath)}, and would overwrite each other in the output folder.`,
      );
    }
    seen.add(key);
  }
  return tasks;
}

function validateTarget(value: unknown): LoudnessTarget {
  const target = LOUDNESS_TARGETS.find((entry) => entry.lufs === value);
  if (!target) throw new AppFailure('That loudness target is not one the app offers.');
  return target.lufs;
}

function outputDirectory(output: NormalizeOutput): string | null {
  if (output.kind === 'replace') return null;
  const directory: unknown = output.directory;
  if (typeof directory !== 'string' || !directory.trim() || !isAbsolute(directory)) {
    throw new AppFailure('Choose a folder to save the normalized files into.');
  }
  return directory;
}

function validatePaths(paths: unknown): string[] {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new AppFailure('Add at least one file to normalize.');
  }
  const unique = new Map<string, string>();
  for (const path of paths) {
    if (typeof path !== 'string' || !path.trim() || !isAbsolute(path)) {
      throw new AppFailure('A file path is missing or not absolute.');
    }
    const format = formatForExtension(path);
    if (!format?.editable) {
      throw new AppFailure(`${basename(path)} is not a format this app can normalize.`);
    }
    unique.set(resolve(path), path);
  }
  return [...unique.values()];
}

/**
 * Windows paths are case-insensitive, so `Song.mp3` and `song.mp3` are one file
 * there. Comparing them as one everywhere errs on the side of refusing.
 */
function destinationKey(path: string): string {
  return resolve(path).toLowerCase();
}
