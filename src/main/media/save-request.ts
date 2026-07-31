import { extname, isAbsolute, relative, resolve } from 'node:path';
import { formatForExtension, type SupportedFormat } from '@shared/media-types';
import { sanitizeTagValues, type SaveTagsRequest } from '@shared/metadata';
import { AppFailure } from '../errors';

/**
 * A save request from the renderer becomes ffmpeg arguments and a destination on
 * disk, so it is validated here rather than trusted. Kept separate from the IPC
 * plumbing because these are the checks whose absence is invisible until
 * something is overwritten that should not have been.
 */
export function validateSaveTagsRequest(
  request: SaveTagsRequest,
  coverDirectory: string,
): SaveTagsRequest {
  const sourcePath = requireAbsolute(request.sourcePath, 'source file');
  const destinationPath = requireAbsolute(request.destinationPath, 'destination');

  const format = editableFormat(sourcePath);

  // Changing the container is a conversion, not a tag edit — and ffmpeg would
  // silently re-encode or fail depending on the pair.
  if (extensionOf(destinationPath) !== extensionOf(sourcePath)) {
    throw new AppFailure(
      `The destination must keep the .${format.ext} extension. Converting between formats is a separate operation.`,
    );
  }

  return {
    sourcePath,
    destinationPath,
    tags: sanitizeTagValues(request.tags),
    cover: validateCover(request.cover, format, coverDirectory),
  };
}

function validateCover(
  cover: SaveTagsRequest['cover'],
  format: SupportedFormat,
  coverDirectory: string,
): SaveTagsRequest['cover'] {
  // "Keep" touches no picture stream, so it is valid even where this container
  // cannot be given new artwork.
  if (cover?.kind === 'keep' || cover === undefined) return { kind: 'keep' };

  if (format.coverArt === 'unsupported') {
    throw new AppFailure(`${format.label} files cannot carry embedded cover art.`);
  }

  if (cover.kind === 'remove') return { kind: 'remove' };

  if (cover.kind === 'replace') {
    const imagePath = requireAbsolute(cover.imagePath, 'cover image');
    // Only images this app prepared may be embedded: every legitimate cover has
    // been through the JPEG re-encode into that directory, so accepting an
    // arbitrary path would hand ffmpeg a file the user never approved.
    if (!isInside(coverDirectory, imagePath)) {
      throw new AppFailure('That cover image was not prepared by the app. Choose it again.');
    }
    return { kind: 'replace', imagePath };
  }

  throw new AppFailure('Unrecognized cover art request.');
}

function editableFormat(path: string): SupportedFormat {
  const format = formatForExtension(extensionOf(path));
  if (!format) {
    throw new AppFailure(`.${extensionOf(path)} is not a format this app can edit.`);
  }
  if (!format.editable) {
    throw new AppFailure(`${format.label} files have to be converted before they can be tagged.`);
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

/** True when `child` is the directory itself or something under it. */
export function isInside(parent: string, child: string): boolean {
  const step = relative(resolve(parent), resolve(child));
  return step !== '' && !step.startsWith('..') && !isAbsolute(step);
}
