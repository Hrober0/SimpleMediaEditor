/**
 * Format support is data, not code. Every "can we handle this file?" question is
 * answered from this table so adding a format never means adding a branch.
 */

export type MediaKind = 'audio' | 'video';

export interface SupportedFormat {
  ext: string;
  kind: MediaKind;
  label: string;
  /** Can be tagged/trimmed directly, without converting first. */
  editable: boolean;
  /** Plays in Chromium without a proxy file. */
  webPlayable: boolean;
}

export const SUPPORTED_FORMATS: readonly SupportedFormat[] = [
  { ext: 'mp3', kind: 'audio', label: 'MP3', editable: true, webPlayable: true },
  { ext: 'm4a', kind: 'audio', label: 'M4A (AAC)', editable: true, webPlayable: true },
  { ext: 'opus', kind: 'audio', label: 'Opus', editable: true, webPlayable: true },
  { ext: 'flac', kind: 'audio', label: 'FLAC', editable: true, webPlayable: true },
  { ext: 'wav', kind: 'audio', label: 'WAV', editable: true, webPlayable: true },
  { ext: 'mp4', kind: 'video', label: 'MP4', editable: true, webPlayable: true },
  { ext: 'webm', kind: 'video', label: 'WebM', editable: true, webPlayable: true },
  { ext: 'mkv', kind: 'video', label: 'MKV', editable: true, webPlayable: false },
];

/** Normalizes ".MP3" / "mp3" / "file.mp3" to a table lookup. */
export function formatForExtension(value: string): SupportedFormat | undefined {
  const ext = value.split('.').pop()?.toLowerCase().trim();
  if (!ext) return undefined;
  return SUPPORTED_FORMATS.find((format) => format.ext === ext);
}

export function formatsOfKind(kind: MediaKind): readonly SupportedFormat[] {
  return SUPPORTED_FORMATS.filter((format) => format.kind === kind);
}
