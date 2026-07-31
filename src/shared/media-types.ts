/**
 * Format support is data, not code. Every "can we handle this file?" question is
 * answered from this table so adding a format never means adding a branch.
 */

export type MediaKind = 'audio' | 'video';

/**
 * Which tagging scheme the container uses. One field ("Author") becomes a
 * different `-metadata` key per family, so the mapping is looked up from here
 * rather than branched on the extension.
 */
export type TagFamily = 'id3' | 'mp4' | 'vorbis' | 'riff' | 'matroska';

/**
 * How well embedded artwork actually survives in this container.
 *
 * `unreliable` is not a guess: the mp4 `covr` atom is honored inconsistently
 * across players, and saying so in the UI is better than letting the user
 * conclude the app is broken when VLC ignores it.
 */
export type CoverArtSupport = 'reliable' | 'unreliable' | 'unsupported';

export interface SupportedFormat {
  ext: string;
  kind: MediaKind;
  label: string;
  /** Can be tagged/trimmed directly, without converting first. */
  editable: boolean;
  /** Plays in Chromium without a proxy file. */
  webPlayable: boolean;
  tagFamily: TagFamily;
  coverArt: CoverArtSupport;
}

export const SUPPORTED_FORMATS: readonly SupportedFormat[] = [
  {
    ext: 'mp3',
    kind: 'audio',
    label: 'MP3',
    editable: true,
    webPlayable: true,
    tagFamily: 'id3',
    coverArt: 'reliable',
  },
  {
    ext: 'm4a',
    kind: 'audio',
    label: 'M4A (AAC)',
    editable: true,
    webPlayable: true,
    tagFamily: 'mp4',
    coverArt: 'unreliable',
  },
  {
    ext: 'opus',
    kind: 'audio',
    label: 'Opus',
    editable: true,
    webPlayable: true,
    tagFamily: 'vorbis',
    // Ogg carries art as a base64 METADATA_BLOCK_PICTURE comment, which ffmpeg
    // does not write. Tags work; artwork does not.
    coverArt: 'unsupported',
  },
  {
    ext: 'flac',
    kind: 'audio',
    label: 'FLAC',
    editable: true,
    webPlayable: true,
    tagFamily: 'vorbis',
    coverArt: 'reliable',
  },
  {
    ext: 'wav',
    kind: 'audio',
    label: 'WAV',
    editable: true,
    webPlayable: true,
    // RIFF INFO chunks: ffmpeg maps title/artist/album/date/genre/comment onto
    // INAM/IART/IPRD/ICRD/IGNR/ICMT.
    tagFamily: 'riff',
    coverArt: 'unsupported',
  },
  {
    ext: 'mp4',
    kind: 'video',
    label: 'MP4',
    editable: true,
    webPlayable: true,
    tagFamily: 'mp4',
    coverArt: 'unreliable',
  },
  {
    ext: 'webm',
    kind: 'video',
    label: 'WebM',
    editable: true,
    webPlayable: true,
    tagFamily: 'matroska',
    // Matroska keeps cover art as a file attachment, not an attached picture
    // stream, so the ffmpeg path used everywhere else does not apply.
    coverArt: 'unsupported',
  },
  {
    ext: 'mkv',
    kind: 'video',
    label: 'MKV',
    editable: true,
    webPlayable: false,
    tagFamily: 'matroska',
    coverArt: 'unsupported',
  },
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
