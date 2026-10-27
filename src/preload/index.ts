import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import type { Job } from '@shared/jobs';
import {
  RENDERER_API_KEY,
  type IpcInvokeChannel,
  type IpcRequest,
  type IpcResponse,
  type MediaEditorApi,
} from '@shared/ipc-contract';

/**
 * The entire surface the renderer can see.
 *
 * Every method maps to exactly one channel from the contract. There is
 * deliberately no generic `invoke(channel, payload)` here: that would let the
 * renderer reach any channel main happens to register, which is the same as
 * having no boundary at all.
 */

function invoke<K extends IpcInvokeChannel>(
  channel: K,
  request: IpcRequest<K>,
): Promise<IpcResponse<K>> {
  return ipcRenderer.invoke(channel, request) as Promise<IpcResponse<K>>;
}

const api: MediaEditorApi = {
  getEnvironment: () => invoke('app:environment', undefined),
  recheckBinaries: () => invoke('binaries:recheck', undefined),
  readSettings: () => invoke('settings:read', undefined),
  updateSettings: (patch) => invoke('settings:update', patch),
  pickDirectory: (request) => invoke('dialog:pickDirectory', request),
  pickBinary: (request) => invoke('dialog:pickBinary', request),
  pickMediaFile: () => invoke('dialog:pickMediaFile', undefined),
  pickMediaFiles: () => invoke('dialog:pickMediaFiles', undefined),
  pickImage: () => invoke('dialog:pickImage', undefined),
  pickSaveTarget: (sourcePath) => invoke('dialog:pickSaveTarget', { sourcePath }),
  probeMedia: (path) => invoke('media:probe', { path }),
  prepareCover: (imagePath) => invoke('media:prepareCover', { imagePath }),
  coverFromClipboard: () => invoke('media:coverFromClipboard', undefined),
  grabFrame: (request) => invoke('media:grabFrame', request),
  saveTags: (request) => invoke('media:saveTags', request),
  waveform: (request) => invoke('media:waveform', request),
  trimMedia: (request) => invoke('media:trim', request),
  normalizeLoudness: (request) => invoke('media:normalize', request),
  inspectUrl: (url) => invoke('ytdlp:inspect', { url }),
  startDownloads: (request) => invoke('ytdlp:download', request),
  listJobs: () => invoke('jobs:list', undefined),
  cancelJob: (jobId) => invoke('jobs:cancel', { jobId }),
  clearFinishedJobs: () => invoke('jobs:clearFinished', undefined),
  showInFolder: (path) => invoke('shell:showInFolder', { path }),

  // A dropped File carries no usable path in a sandboxed renderer; only this
  // side can resolve one, and it is the path — never the contents — that crosses
  // back over to main.
  pathForFile: (file) => webUtils.getPathForFile(file),

  onJobsChanged: (listener) => {
    // The Electron event object stays on this side of the bridge.
    const forward = (_event: IpcRendererEvent, jobs: readonly Job[]): void => listener(jobs);
    ipcRenderer.on('jobs:changed', forward);
    return () => ipcRenderer.removeListener('jobs:changed', forward);
  },
};

contextBridge.exposeInMainWorld(RENDERER_API_KEY, api);
