/**
 * The IPC contract. Both main and renderer import this file, so a change to one
 * side that the other does not follow is a compile error, not a runtime surprise.
 *
 * Adding a feature means adding a channel here — never widening the preload
 * surface with a generic passthrough.
 */

import type { BinaryId, BinaryStatus } from './binaries';
import type { StartDownloadsRequest, UrlInspection } from './download';
import type { Job } from './jobs';
import type { CoverImage, OpenedMedia, SaveTagsRequest } from './metadata';
import type { NormalizeJobs, NormalizeRequest } from './normalize';
import type { Result } from './result';
import type { AppSettings } from './settings';
import type { TrimRequest } from './trim';
import type { WaveformPeaks } from './waveform';

export interface AppEnvironment {
  appVersion: string;
  /** 'win32' | 'linux' | ... — kept as a string so shared/ stays Node-free. */
  platform: string;
  binaries: readonly BinaryStatus[];
}

export interface PickDirectoryRequest {
  title: string;
  defaultPath: string | null;
}

export interface PickBinaryRequest {
  id: BinaryId;
}

export interface PickSaveTargetRequest {
  /** The file being edited; its extension is the only one offered. */
  sourcePath: string;
}

export interface GrabFrameRequest {
  path: string;
  atSeconds: number;
}

export interface WaveformRequest {
  path: string;
  /** How many min/max pairs to reduce the audio to. */
  bucketCount: number;
}

/** Channels the renderer invokes and awaits. */
export interface IpcInvokeContract {
  'app:environment': { request: void; response: AppEnvironment };
  'binaries:recheck': { request: void; response: readonly BinaryStatus[] };
  'settings:read': { request: void; response: AppSettings };
  'settings:update': { request: Partial<AppSettings>; response: AppSettings };
  'dialog:pickDirectory': { request: PickDirectoryRequest; response: string | null };
  'dialog:pickBinary': { request: PickBinaryRequest; response: string | null };
  'dialog:pickMediaFile': { request: void; response: string | null };
  'dialog:pickMediaFiles': { request: void; response: string[] };
  'dialog:pickImage': { request: void; response: string | null };
  'dialog:pickSaveTarget': { request: PickSaveTargetRequest; response: string | null };
  'media:probe': { request: { path: string }; response: Result<OpenedMedia> };
  'media:prepareCover': { request: { imagePath: string }; response: Result<CoverImage> };
  'media:coverFromClipboard': { request: void; response: Result<CoverImage> };
  'media:grabFrame': { request: GrabFrameRequest; response: Result<CoverImage> };
  'media:saveTags': { request: SaveTagsRequest; response: Result<{ jobId: string }> };
  'media:waveform': { request: WaveformRequest; response: Result<WaveformPeaks> };
  'media:trim': { request: TrimRequest; response: Result<{ jobId: string }> };
  'media:normalize': { request: NormalizeRequest; response: Result<NormalizeJobs> };
  'ytdlp:inspect': { request: { url: string }; response: Result<UrlInspection> };
  'ytdlp:download': { request: StartDownloadsRequest; response: Result<{ jobIds: string[] }> };
  'jobs:list': { request: void; response: readonly Job[] };
  'jobs:cancel': { request: { jobId: string }; response: void };
  'jobs:clearFinished': { request: void; response: void };
  'shell:showInFolder': { request: { path: string }; response: void };
}

export type IpcInvokeChannel = keyof IpcInvokeContract;
export type IpcRequest<K extends IpcInvokeChannel> = IpcInvokeContract[K]['request'];
export type IpcResponse<K extends IpcInvokeChannel> = IpcInvokeContract[K]['response'];

/** Channels main pushes to the renderer. */
export interface IpcEventContract {
  'jobs:changed': readonly Job[];
}

export type IpcEventChannel = keyof IpcEventContract;
export type IpcEventPayload<K extends IpcEventChannel> = IpcEventContract[K];

/**
 * What `window.mediaEditor` exposes: one named method per channel, so the
 * renderer cannot reach a channel this file does not describe.
 */
export interface MediaEditorApi {
  getEnvironment(): Promise<AppEnvironment>;
  recheckBinaries(): Promise<readonly BinaryStatus[]>;
  readSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  pickDirectory(request: PickDirectoryRequest): Promise<string | null>;
  pickBinary(request: PickBinaryRequest): Promise<string | null>;
  pickMediaFile(): Promise<string | null>;
  /** Several files at once; empty when the dialog was cancelled. */
  pickMediaFiles(): Promise<string[]>;
  pickImage(): Promise<string | null>;
  pickSaveTarget(sourcePath: string): Promise<string | null>;
  probeMedia(path: string): Promise<Result<OpenedMedia>>;
  prepareCover(imagePath: string): Promise<Result<CoverImage>>;
  /** Cover art from whatever image is on the clipboard; main is the side that reads it. */
  coverFromClipboard(): Promise<Result<CoverImage>>;
  grabFrame(request: GrabFrameRequest): Promise<Result<CoverImage>>;
  saveTags(request: SaveTagsRequest): Promise<Result<{ jobId: string }>>;
  waveform(request: WaveformRequest): Promise<Result<WaveformPeaks>>;
  trimMedia(request: TrimRequest): Promise<Result<{ jobId: string }>>;
  normalizeLoudness(request: NormalizeRequest): Promise<Result<NormalizeJobs>>;
  inspectUrl(url: string): Promise<Result<UrlInspection>>;
  startDownloads(request: StartDownloadsRequest): Promise<Result<{ jobIds: string[] }>>;
  listJobs(): Promise<readonly Job[]>;
  cancelJob(jobId: string): Promise<void>;
  clearFinishedJobs(): Promise<void>;
  showInFolder(path: string): Promise<void>;
  /**
   * The real path of a file the user dropped or picked in the renderer. Not a
   * channel: it is a preload-side lookup, and reading the file is still main's
   * job — the renderer only ever forwards the path.
   */
  pathForFile(file: File): string;
  /** Returns an unsubscribe function. */
  onJobsChanged(listener: (jobs: readonly Job[]) => void): () => void;
}

export const RENDERER_API_KEY = 'mediaEditor' as const;
