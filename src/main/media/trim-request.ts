import { extname, isAbsolute } from 'node:path';
import { formatForExtension, type SupportedFormat } from '@shared/media-types';
import type { KeepRange, TrimExportMode, TrimRequest } from '@shared/trim';
import { AppFailure } from '../errors';

/**
 * A trim request from the renderer becomes ffmpeg arguments and a destination
 * on disk, so it is validated here rather than trusted — the same reasoning
 * as `save-request.ts` for a tag edit.
 */
export function validateTrimRequest(request: TrimRequest): TrimRequest {
  const sourcePath = requireAbsolute(request.sourcePath, 'source file');
  const destinationPath = requireAbsolute(request.destinationPath, 'destination');

  const format = editableFormat(sourcePath);
  if (extensionOf(destinationPath) !== extensionOf(sourcePath)) {
    throw new AppFailure(
      `The destination must keep the .${format.ext} extension. Converting between formats is a separate operation.`,
    );
  }

  return {
    sourcePath,
    destinationPath,
    ranges: validateRanges(request.ranges),
    mode: validateMode(request.mode),
  };
}

function validateRanges(ranges: unknown): KeepRange[] {
  if (!Array.isArray(ranges) || ranges.length === 0) {
    throw new AppFailure('At least one range to keep must be given.');
  }
  return ranges.map((range: unknown) => {
    if (
      typeof range !== 'object' ||
      range === null ||
      !isFiniteNumber((range as { startSeconds: unknown }).startSeconds) ||
      !isFiniteNumber((range as { endSeconds: unknown }).endSeconds)
    ) {
      throw new AppFailure('A keep-range is malformed.');
    }
    const { startSeconds, endSeconds } = range as { startSeconds: number; endSeconds: number };
    return { startSeconds: Math.max(0, startSeconds), endSeconds: Math.max(0, endSeconds) };
  });
}

function validateMode(mode: unknown): TrimExportMode {
  return mode === 'precise' ? 'precise' : 'fast';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function editableFormat(path: string): SupportedFormat {
  const format = formatForExtension(extensionOf(path));
  if (!format) throw new AppFailure(`.${extensionOf(path)} is not a format this app can edit.`);
  if (!format.editable) {
    throw new AppFailure(`${format.label} files have to be converted before they can be trimmed.`);
  }
  return format;
}

function extensionOf(path: string): string {
  return extname(path).replace('.', '').toLowerCase();
}

function requireAbsolute(value: unknown, what: string): string {
  if (typeof value !== 'string' || !value.trim() || !isAbsolute(value)) {
    throw new AppFailure(`The ${what} path is missing or not absolute.`);
  }
  return value;
}
