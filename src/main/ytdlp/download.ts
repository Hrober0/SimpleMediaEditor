import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { JsRuntime } from '@shared/binaries';
import type { DownloadItem, DownloadOptions } from '@shared/download';
import { AppFailure, errorMessage } from '../errors';
import type { JobContext, JobSpec } from '../jobs/queue';
import { runProcess } from '../jobs/runner';
import { buildDownloadArgs } from './args';
import {
  isPostProcessingStage,
  parseOutputPath,
  parsePrintedOutputPath,
  parseProgressLine,
  parseStageLine,
} from './output-parser';

export interface DownloadJobDeps {
  ytdlpPath: string;
  /** Handed to yt-dlp so it post-processes with the ffmpeg the app resolved. */
  ffmpegDirectory: string | null;
  /** Solves YouTube's JavaScript challenges; without it downloads get a 403. */
  jsRuntime: JsRuntime | null;
  /** Parent for per-job temp directories, typically app.getPath('temp'). */
  tempRoot: string;
}

/**
 * One download as a queue job: progress, cancellation, and cleanup of partial
 * output all come from the queue rather than being reimplemented here.
 */
export function createDownloadJob(
  item: DownloadItem,
  options: DownloadOptions,
  deps: DownloadJobDeps,
): JobSpec {
  return {
    kind: 'download',
    label: item.title,
    run: (context) => runDownload(item, options, deps, context),
  };
}

async function runDownload(
  item: DownloadItem,
  options: DownloadOptions,
  deps: DownloadJobDeps,
  context: JobContext,
): Promise<void> {
  // Everything partial lives here, so cancelling removes one directory instead of
  // hunting for .part and .ytdl leftovers next to the user's finished files.
  const tempDirectory = join(deps.tempRoot, 'mediaeditor', context.jobId);
  await mkdir(options.destination, { recursive: true });
  await mkdir(tempDirectory, { recursive: true });

  // What yt-dlp printed for our own template, and what could be read out of its
  // log if it printed nothing — which happens for an already-downloaded file.
  let printedPath: string | null = null;
  let loggedPath: string | null = null;

  try {
    const args = buildDownloadArgs(item, options, {
      destination: options.destination,
      tempDirectory,
      ffmpegDirectory: deps.ffmpegDirectory,
      jsRuntime: deps.jsRuntime,
    });

    // The exact invocation, so a failure report is reproducible from the log pane.
    context.log(`$ ${deps.ytdlpPath} ${args.join(' ')}`);

    const result = await runProcess({
      binary: deps.ytdlpPath,
      args,
      signal: context.signal,
      onLine: (line) => {
        const progress = parseProgressLine(line);
        if (progress) {
          // Progress ticks are not logged: they would flood the log tail and push
          // out the lines that explain a failure.
          context.setProgress(progress.fraction);
          context.setDetail(progress.detail);
          return;
        }

        const printed = parsePrintedOutputPath(line);
        if (printed) {
          // Our own machinery, like the progress lines: of no use in the log tail.
          printedPath = printed;
          return;
        }

        context.log(line);

        const path = parseOutputPath(line);
        if (path) loggedPath = path;

        const stage = parseStageLine(line);
        if (stage) {
          context.setDetail(stage);
          // Post-processing has no measurable progress; leaving the bar at 100%
          // makes a long transcode look like a hang.
          if (isPostProcessingStage(stage)) context.setProgress(null);
        }
      },
    });

    if (context.signal.aborted || result.terminated) return;

    if (result.code !== 0) {
      throw new AppFailure(
        `yt-dlp exited with code ${String(result.code)}.`,
        result.stderrTail.join('\n'),
      );
    }

    // Left unset when the file cannot be named, rather than standing in the
    // destination folder: this path is what the meta editor is handed, and a
    // folder there fails to open as a media file.
    const produced = await existingFile(printedPath ?? loggedPath);
    if (produced) context.setOutputPath(produced);
  } finally {
    await removeQuietly(tempDirectory);
  }
}

/**
 * The reported path is only useful if it survived post-processing — the file may
 * have been renamed or given a different extension along the way.
 */
async function existingFile(path: string | null): Promise<string | null> {
  if (!path) return null;
  try {
    const info = await stat(path);
    return info.isFile() ? path : null;
  } catch {
    return null;
  }
}

async function removeQuietly(directory: string): Promise<void> {
  try {
    await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  } catch (error) {
    // A leftover temp directory is untidy, not a failure worth reporting to the
    // user — on Windows an antivirus scan can hold a handle open briefly.
    console.warn(`[download] could not remove ${directory}: ${errorMessage(error)}`);
  }
}
