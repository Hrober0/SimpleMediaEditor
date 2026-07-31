import type { MediaKind } from './media-types';

/** What a download produces. The yt-dlp flags for each live in main/ytdlp/args.ts. */
export type DownloadTargetId = 'mp3' | 'mp4';

export interface DownloadTarget {
  id: DownloadTargetId;
  label: string;
  kind: MediaKind;
  ext: string;
  /** Shown under the format picker; explains what the user actually gets. */
  note: string;
}

export const DOWNLOAD_TARGETS: readonly DownloadTarget[] = [
  {
    id: 'mp3',
    label: 'MP3 (audio)',
    kind: 'audio',
    ext: 'mp3',
    note: 'Cover art and tags are embedded during download.',
  },
  {
    id: 'mp4',
    label: 'MP4 (video)',
    kind: 'video',
    ext: 'mp4',
    note: 'Tags are embedded; cover art for MP4 is set in the media meta editor.',
  },
];

export function downloadTargetById(id: DownloadTargetId): DownloadTarget {
  const target = DOWNLOAD_TARGETS.find((entry) => entry.id === id);
  if (!target) throw new Error(`Unknown download target "${id}"`);
  return target;
}

export interface QualityChoice<T extends string> {
  value: T;
  label: string;
}

/** yt-dlp `--audio-quality`: 0 is best VBR, 10 is worst. */
export const AUDIO_QUALITIES = [
  { value: '0', label: 'Best (VBR, ~245 kbps)' },
  { value: '2', label: 'High (VBR, ~190 kbps)' },
  { value: '5', label: 'Medium (VBR, ~130 kbps)' },
  { value: '7', label: 'Small (VBR, ~100 kbps)' },
] as const satisfies readonly QualityChoice<string>[];

export type AudioQuality = (typeof AUDIO_QUALITIES)[number]['value'];

/** Maximum height; 'best' takes whatever the highest MP4-compatible stream is. */
export const VIDEO_QUALITIES = [
  { value: 'best', label: 'Best available' },
  { value: '1080', label: 'Up to 1080p' },
  { value: '720', label: 'Up to 720p' },
  { value: '480', label: 'Up to 480p' },
] as const satisfies readonly QualityChoice<string>[];

export type VideoQuality = (typeof VIDEO_QUALITIES)[number]['value'];

export const DEFAULT_FILENAME_TEMPLATE = '%(title)s.%(ext)s';

/**
 * Presets only use fields that are populated for a single video. Playlist fields
 * such as `%(playlist_index)s` resolve to "NA" here, because each playlist entry
 * is downloaded as its own job by its own URL.
 */
export const FILENAME_TEMPLATE_PRESETS: readonly QualityChoice<string>[] = [
  { value: '%(title)s.%(ext)s', label: 'Title' },
  { value: '%(uploader)s - %(title)s.%(ext)s', label: 'Uploader - Title' },
  { value: '%(upload_date)s - %(title)s.%(ext)s', label: 'Date - Title' },
];

export interface DownloadOptions {
  target: DownloadTargetId;
  audioQuality: AudioQuality;
  videoQuality: VideoQuality;
  /** Absolute directory. Validated in main before anything is spawned. */
  destination: string;
  /** yt-dlp output template, not a plain filename. */
  filenameTemplate: string;
  /** yt-dlp `--restrict-filenames`: ASCII-only, no spaces. */
  restrictFilenames: boolean;
}

/** One queued download. Playlists become one item — and one job — per entry. */
export interface DownloadItem {
  url: string;
  /** Used for the job label before yt-dlp reports anything. */
  title: string;
  /**
   * An explicit name for this file, without extension — the extension follows
   * from the chosen format. Overrides `filenameTemplate` for this item only.
   * null means "use the template", which is what playlists do.
   */
  filename: string | null;
}

export interface StartDownloadsRequest {
  items: readonly DownloadItem[];
  options: DownloadOptions;
}

export interface MediaSourceEntry {
  id: string;
  url: string;
  title: string;
  uploader: string | null;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
}

/** Result of `yt-dlp --dump-single-json` for a URL the user pasted. */
export interface UrlInspection {
  kind: 'video' | 'playlist';
  title: string;
  uploader: string | null;
  entries: readonly MediaSourceEntry[];
}
