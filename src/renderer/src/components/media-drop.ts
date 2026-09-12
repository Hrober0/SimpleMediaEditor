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

export function supportedExtensions(separator: string): string {
  return SUPPORTED_FORMATS.map((format) => format.ext).join(separator);
}
