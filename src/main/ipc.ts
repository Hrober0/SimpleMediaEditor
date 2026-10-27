import { stat } from 'node:fs/promises';
import { extname, isAbsolute } from 'node:path';
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';
import { BINARY_DESCRIPTORS } from '@shared/binaries';
import {
  AUDIO_QUALITIES,
  DOWNLOAD_TARGETS,
  VIDEO_QUALITIES,
  type DownloadItem,
  type DownloadOptions,
  type StartDownloadsRequest,
} from '@shared/download';
import { sanitizeFilename } from '@shared/filenames';
import type {
  IpcEventChannel,
  IpcEventPayload,
  IpcInvokeChannel,
  IpcRequest,
  IpcResponse,
} from '@shared/ipc-contract';
import { SUPPORTED_FORMATS, formatForExtension } from '@shared/media-types';
import { sanitizeTagValue, type OpenedMedia } from '@shared/metadata';
import { err, ok, type Result } from '@shared/result';
import type { BinaryResolver } from './binaries';
import { AppFailure, toErrorInfo } from './errors';
import type { JobQueue } from './jobs/queue';
import {
  coverDirectory,
  extractEmbeddedCover,
  prepareCoverFromBytes,
  prepareCoverFromFrame,
  prepareCoverFromImage,
  type CoverDeps,
} from './media/cover-art';
import { createNormalizeJob } from './media/normalize-job';
import { validateNormalizeRequest } from './media/normalize-request';
import { probeFile } from './media/probe';
import { validateSaveTagsRequest } from './media/save-request';
import { createTagWriteJob } from './media/tag-job';
import { readTagValues } from './media/tags';
import { createTrimJob } from './media/trim-job';
import { validateTrimRequest } from './media/trim-request';
import { computeWaveformPeaks } from './media/waveform';
import type { SettingsStore } from './settings-store';
import { createDownloadJob } from './ytdlp/download';
import { inspectUrl } from './ytdlp/inspect';

export interface IpcDeps {
  settings: SettingsStore;
  binaries: BinaryResolver;
  queue: JobQueue;
}

export function registerIpcHandlers(deps: IpcDeps): void {
  const { settings, binaries, queue } = deps;

  /**
   * ffmpeg and ffprobe are resolved per call rather than captured: a user can
   * change either path in Settings while the app is running.
   */
  const coverDeps = (): CoverDeps => ({
    ffmpegPath: binaries.require('ffmpeg'),
    ffprobePath: binaries.require('ffprobe'),
    coverDirectory: coverDirectory(app.getPath('temp')),
  });

  handle('app:environment', () => ({
    appVersion: app.getVersion(),
    platform: process.platform,
    binaries: binaries.list(),
  }));

  handle('binaries:recheck', () => binaries.refresh());

  handle('settings:read', () => settings.get());

  handle('settings:update', (patch) => settings.update(patch));

  handle('dialog:pickDirectory', async (request, event) => {
    const result = await dialog.showOpenDialog(windowFrom(event), {
      title: request.title,
      defaultPath: request.defaultPath ?? undefined,
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  handle('dialog:pickBinary', async (request, event) => {
    const descriptor = BINARY_DESCRIPTORS.find((entry) => entry.id === request.id);
    if (!descriptor) throw new AppFailure(`Unknown binary "${String(request.id)}".`);

    const result = await dialog.showOpenDialog(windowFrom(event), {
      title: `Select ${descriptor.displayName}`,
      properties: ['openFile'],
      filters:
        process.platform === 'win32'
          ? [{ name: 'Executables', extensions: ['exe'] }]
          : [{ name: 'All files', extensions: ['*'] }],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  handle('dialog:pickMediaFile', async (_request, event) => {
    const result = await dialog.showOpenDialog(windowFrom(event), {
      title: 'Choose a media file',
      properties: ['openFile'],
      // Built from the format table, so a new format needs no change here.
      filters: mediaFileFilters(),
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  handle('dialog:pickMediaFiles', async (_request, event) => {
    const result = await dialog.showOpenDialog(windowFrom(event), {
      title: 'Choose media files',
      properties: ['openFile', 'multiSelections'],
      filters: mediaFileFilters(),
    });
    return result.canceled ? [] : result.filePaths;
  });

  handle('dialog:pickImage', async (_request, event) => {
    const result = await dialog.showOpenDialog(windowFrom(event), {
      title: 'Choose cover art',
      properties: ['openFile'],
      filters: [
        { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'tif', 'tiff'] },
      ],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  handle('dialog:pickSaveTarget', async (request, event) => {
    if (!isAbsolute(request.sourcePath)) throw new AppFailure('Expected an absolute path.');
    const format = formatForExtension(request.sourcePath);
    if (!format) throw new AppFailure('That file is not a format this app can write.');

    const result = await dialog.showSaveDialog(windowFrom(event), {
      title: 'Save a copy',
      defaultPath: request.sourcePath,
      // Only the source's own extension: a tag edit cannot change the container.
      filters: [{ name: format.label, extensions: [format.ext] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    return result.canceled ? null : (result.filePath ?? null);
  });

  handle('media:probe', async (request) => {
    try {
      if (!isAbsolute(request.path)) throw new AppFailure('Expected an absolute path.');
      if (!formatForExtension(request.path)) {
        throw new AppFailure(
          `${extname(request.path) || 'That file type'} is not a format this app can open.`,
        );
      }

      const info = await probeFile(request.path, { ffprobePath: binaries.require('ffprobe') });
      const opened: OpenedMedia = {
        info,
        tags: readTagValues(info.tags),
        cover: await extractEmbeddedCover(info, coverDeps()),
      };
      return ok(opened);
    } catch (error) {
      return failure(error);
    }
  });

  handle('media:prepareCover', async (request) => {
    try {
      if (!isAbsolute(request.imagePath)) throw new AppFailure('Expected an absolute path.');
      return ok(await prepareCoverFromImage(request.imagePath, coverDeps()));
    } catch (error) {
      return failure(error);
    }
  });

  // Main reads the clipboard rather than the renderer: a pasted image has no path,
  // and this keeps the renderer holding neither the bytes nor a file.
  handle('media:coverFromClipboard', async () => {
    try {
      const image = clipboard.readImage();
      if (image.isEmpty()) {
        throw new AppFailure(
          'There is no image on the clipboard.',
          'Copy an image itself, not a file: copying a file in the file manager puts its name on the clipboard, not its contents.',
        );
      }
      return ok(await prepareCoverFromBytes(image.toPNG(), coverDeps()));
    } catch (error) {
      return failure(error);
    }
  });

  handle('media:grabFrame', async (request) => {
    try {
      if (!isAbsolute(request.path)) throw new AppFailure('Expected an absolute path.');
      return ok(await prepareCoverFromFrame(request.path, request.atSeconds, coverDeps()));
    } catch (error) {
      return failure(error);
    }
  });

  handle('media:saveTags', (request) => {
    try {
      const validated = validateSaveTagsRequest(request, coverDirectory(app.getPath('temp')));
      const job = queue.enqueue(
        createTagWriteJob(validated, {
          ffmpegPath: binaries.require('ffmpeg'),
          ffprobePath: binaries.require('ffprobe'),
        }),
      );
      return ok({ jobId: job.id });
    } catch (error) {
      return failure(error);
    }
  });

  handle('media:waveform', async (request) => {
    try {
      if (!isAbsolute(request.path)) throw new AppFailure('Expected an absolute path.');
      const info = await probeFile(request.path, { ffprobePath: binaries.require('ffprobe') });
      if (!info.audio) throw new AppFailure('That file has no audio to show a waveform for.');

      const bucketCount = Math.min(20_000, Math.max(1, Math.round(request.bucketCount)));
      const peaks = await computeWaveformPeaks(
        request.path,
        info.durationSeconds ?? 0,
        bucketCount,
        { ffmpegPath: binaries.require('ffmpeg') },
      );
      return ok(peaks);
    } catch (error) {
      return failure(error);
    }
  });

  handle('media:trim', (request) => {
    try {
      const validated = validateTrimRequest(request);
      const job = queue.enqueue(createTrimJob(validated, coverDeps()));
      return ok({ jobId: job.id });
    } catch (error) {
      return failure(error);
    }
  });

  handle('media:normalize', (request) => {
    try {
      const tasks = validateNormalizeRequest(request);
      const jobDeps = {
        ffmpegPath: binaries.require('ffmpeg'),
        ffprobePath: binaries.require('ffprobe'),
      };
      const jobIdsByPath: Record<string, string> = {};
      for (const task of tasks) {
        jobIdsByPath[task.sourcePath] = queue.enqueue(createNormalizeJob(task, jobDeps)).id;
      }
      return ok({ jobIdsByPath });
    } catch (error) {
      return failure(error);
    }
  });

  handle('ytdlp:inspect', async (request) => {
    try {
      const inspection = await inspectUrl(request.url, {
        ytdlpPath: binaries.require('ytdlp'),
        jsRuntime: binaries.jsRuntime(),
      });
      return ok(inspection);
    } catch (error) {
      return failure(error);
    }
  });

  handle('ytdlp:download', (request) => {
    try {
      const { items, options } = validateDownloadRequest(request, settings);
      // ffmpeg is what extracts audio and embeds art; without it yt-dlp would
      // download a webm and fail at post-processing, which is worse than saying so.
      binaries.require('ffmpeg');

      const jobDeps = {
        ytdlpPath: binaries.require('ytdlp'),
        ffmpegDirectory: binaries.ffmpegDirectory(),
        jsRuntime: binaries.jsRuntime(),
        tempRoot: app.getPath('temp'),
      };

      const jobIds = items.map(
        (item) => queue.enqueue(createDownloadJob(item, options, jobDeps)).id,
      );
      return ok({ jobIds });
    } catch (error) {
      return failure(error);
    }
  });

  handle('jobs:list', () => queue.list());

  handle('jobs:cancel', (request) => {
    queue.cancel(request.jobId);
  });

  handle('jobs:clearFinished', () => {
    queue.clearFinished();
  });

  handle('shell:showInFolder', async (request) => {
    if (!isAbsolute(request.path)) throw new AppFailure('Expected an absolute path.');

    const info = await stat(request.path).catch(() => null);
    if (!info) throw new AppFailure('That file is no longer there.');

    if (info.isDirectory()) {
      const error = await shell.openPath(request.path);
      if (error) throw new AppFailure(error);
      return;
    }
    // Highlights the file inside its folder rather than opening it.
    shell.showItemInFolder(request.path);
  });
}

/** Sends a contract-declared event to every open window. */
export function broadcast<K extends IpcEventChannel>(
  channel: K,
  payload: IpcEventPayload<K>,
): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
}

/**
 * Open-dialog filters derived from the format table, so adding a format is a data
 * change rather than an edit here as well.
 */
function mediaFileFilters(): { name: string; extensions: string[] }[] {
  const editable = SUPPORTED_FORMATS.filter((format) => format.editable);
  const extensionsOf = (kind: 'audio' | 'video'): string[] =>
    editable.filter((format) => format.kind === kind).map((format) => format.ext);

  return [
    { name: 'Audio and video', extensions: editable.map((format) => format.ext) },
    { name: 'Audio', extensions: extensionsOf('audio') },
    { name: 'Video', extensions: extensionsOf('video') },
  ];
}

type Handler<K extends IpcInvokeChannel> = (
  request: IpcRequest<K>,
  event: IpcMainInvokeEvent,
) => IpcResponse<K> | Promise<IpcResponse<K>>;

/**
 * The only bridge between a channel name and its implementation. Typing it
 * against the contract means a renamed channel or a changed payload fails to
 * compile on both sides rather than at runtime.
 */
function handle<K extends IpcInvokeChannel>(channel: K, handler: Handler<K>): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => handler(args[0] as IpcRequest<K>, event));
}

function windowFrom(event: IpcMainInvokeEvent): BrowserWindow {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) throw new AppFailure('The requesting window is no longer open.');
  return window;
}

function failure<T>(error: unknown): Result<T> {
  const info = toErrorInfo(error);
  if (!(error instanceof AppFailure)) console.error('[ipc] unexpected failure', error);
  return err(info.message, info.details);
}

/**
 * Requests from the renderer are validated here, not trusted: these values end up
 * as spawn arguments and as a filesystem destination.
 */
function validateDownloadRequest(
  request: StartDownloadsRequest,
  settings: SettingsStore,
): { items: DownloadItem[]; options: DownloadOptions } {
  const items = request.items
    .filter((item) => isHttpUrl(item.url))
    .map((item) => ({
      url: item.url.trim(),
      title: item.title.trim() || item.url,
      // Sanitized here rather than trusted from the renderer: this becomes a
      // filename on disk, and the same sanitizer serves every such path.
      filename: item.filename?.trim() ? sanitizeFilename(item.filename) : null,
      // A tag value, not a path: only control characters and length are limited.
      embeddedTitle:
        typeof item.embeddedTitle === 'string'
          ? sanitizeTagValue(item.embeddedTitle, false) || null
          : null,
    }));

  if (items.length === 0) throw new AppFailure('No downloadable URL was provided.');

  const destination = request.options.destination.trim() || settings.get().downloadDirectory;
  if (!destination || !isAbsolute(destination)) {
    throw new AppFailure('Choose a destination folder before downloading.');
  }

  const template = request.options.filenameTemplate.trim();
  if (!template) throw new AppFailure('The filename template cannot be empty.');
  // A template is a name, not a path: writing outside the chosen folder is not
  // something the download UI is allowed to do.
  if (template.includes('..') || isAbsolute(template)) {
    throw new AppFailure('The filename template must not contain a path.');
  }

  return {
    items,
    options: {
      target: allowed(
        DOWNLOAD_TARGETS.map((target) => target.id),
        request.options.target,
      ),
      audioQuality: allowed(
        AUDIO_QUALITIES.map((quality) => quality.value),
        request.options.audioQuality,
      ),
      videoQuality: allowed(
        VIDEO_QUALITIES.map((quality) => quality.value),
        request.options.videoQuality,
      ),
      destination,
      filenameTemplate: template,
      restrictFilenames: Boolean(request.options.restrictFilenames),
    },
  };
}

function allowed<T extends string>(values: readonly T[], value: T): T {
  const first = values[0];
  if (first === undefined) throw new AppFailure('No choices are configured.');
  return values.includes(value) ? value : first;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
