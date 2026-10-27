import { SUPPORTED_FORMATS, formatForExtension } from '@shared/media-types';
import type { ErrorInfo } from '@shared/result';
import { api } from '../api';

interface MediaSource {
  onOpen: (path: string) => void;
  onError: (error: ErrorInfo) => void;
}

/**
 * Browsing goes through the Electron dialog rather than a Chromium file input, so
 * it can filter by the format table and hand main a real path.
 */
export function browseForMedia({ onOpen }: Pick<MediaSource, 'onOpen'>): void {
  void api.pickMediaFile().then((path) => {
    if (path) onOpen(path);
  });
}

/**
 * Only a path reaches main: the renderer never reads the file, so a dropped File
 * is resolved to its path and handed straight over.
 */
export function openDroppedFile(files: File[], { onOpen, onError }: MediaSource): void {
  const [file] = files;
  if (!file) return;

  // Checked here so an obviously wrong file is refused before a process is
  // spawned; main validates the path it is given regardless.
  if (!formatForExtension(file.name)) {
    onError({
      message: `${file.name} is not a format this app can edit.`,
      details: `Supported: ${supportedExtensions(', ')}`,
    });
    return;
  }
  onOpen(api.pathForFile(file));
}

interface MediaFilesSource {
  onAdd: (paths: string[]) => void;
  onError: (error: ErrorInfo) => void;
}

export function browseForMediaFiles({ onAdd }: Pick<MediaFilesSource, 'onAdd'>): void {
  void api.pickMediaFiles().then((paths) => {
    if (paths.length > 0) onAdd(paths);
  });
}

/**
 * Every supported file in a drop. The rest are named in one error rather than
 * failing the whole drop, so a folder's worth of tracks with a stray cover
 * image still goes in.
 */
export function addDroppedFiles(files: File[], { onAdd, onError }: MediaFilesSource): void {
  const supported = files.filter((file) => formatForExtension(file.name));
  const refused = files.filter((file) => !formatForExtension(file.name));

  if (refused.length > 0) {
    onError({
      message: `${refused.map((file) => file.name).join(', ')} ${refused.length === 1 ? 'is not a format' : 'are not formats'} this app can edit.`,
      details: `Supported: ${supportedExtensions(', ')}`,
    });
  }
  if (supported.length > 0) onAdd(supported.map((file) => api.pathForFile(file)));
}

export function supportedExtensions(separator: string): string {
  return SUPPORTED_FORMATS.map((format) => format.ext).join(separator);
}
