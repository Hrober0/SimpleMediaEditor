import type { BinaryId } from './binaries';
import type { AudioQuality, DownloadTargetId, VideoQuality } from './download';
import { DEFAULT_FILENAME_TEMPLATE } from './download';

export interface AppSettings {
  /** User-configured overrides; tried before PATH. Empty string means "unset". */
  binaryPaths: Partial<Record<BinaryId, string>>;
  /** Remembered between runs. null until main resolves the default Music folder. */
  downloadDirectory: string | null;
  downloadTarget: DownloadTargetId;
  audioQuality: AudioQuality;
  videoQuality: VideoQuality;
  filenameTemplate: string;
  restrictFilenames: boolean;
  /**
   * Whether a finished download opens in the meta editor. Only a single video
   * does: a playlist has no one file the app could pick.
   */
  openInMetaEditorAfterDownload: boolean;
  /** How many jobs run at once across every module. */
  jobConcurrency: number;
}

export const JOB_CONCURRENCY_RANGE = { min: 1, max: 8 } as const;

export const DEFAULT_SETTINGS: AppSettings = {
  binaryPaths: {},
  downloadDirectory: null,
  downloadTarget: 'mp3',
  audioQuality: '0',
  videoQuality: 'best',
  filenameTemplate: DEFAULT_FILENAME_TEMPLATE,
  // Windows rejects characters that YouTube titles are full of; on by default so
  // the same title produces a valid file on both platforms.
  restrictFilenames: true,
  // Off by default: downloading a batch of music is the common case, and jumping
  // into the editor after each one would interrupt it.
  openInMetaEditorAfterDownload: false,
  jobConcurrency: 2,
};
