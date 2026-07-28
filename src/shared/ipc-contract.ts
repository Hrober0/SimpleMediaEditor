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
import type { Result } from './result';
import type { AppSettings } from './settings';

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

/** Channels the renderer invokes and awaits. */
export interface IpcInvokeContract {
  'app:environment': { request: void; response: AppEnvironment };
  'binaries:recheck': { request: void; response: readonly BinaryStatus[] };
  'settings:read': { request: void; response: AppSettings };
  'settings:update': { request: Partial<AppSettings>; response: AppSettings };
  'dialog:pickDirectory': { request: PickDirectoryRequest; response: string | null };
  'dialog:pickBinary': { request: PickBinaryRequest; response: string | null };
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
  inspectUrl(url: string): Promise<Result<UrlInspection>>;
  startDownloads(request: StartDownloadsRequest): Promise<Result<{ jobIds: string[] }>>;
  listJobs(): Promise<readonly Job[]>;
  cancelJob(jobId: string): Promise<void>;
  clearFinishedJobs(): Promise<void>;
  showInFolder(path: string): Promise<void>;
  /** Returns an unsubscribe function. */
  onJobsChanged(listener: (jobs: readonly Job[]) => void): () => void;
}

export const RENDERER_API_KEY = 'mediaEditor' as const;
