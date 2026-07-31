import { mkdir } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { formatForExtension } from '@shared/media-types';
import type { SaveTagsRequest } from '@shared/metadata';
import { AppFailure } from '../errors';
import type { JobContext, JobSpec } from '../jobs/queue';
import { runProcess } from '../jobs/runner';
import { parseProgressLine, progressFraction } from './ffmpeg-progress';
import { probeFile } from './probe';
import {
  describeOutputMismatch,
  fileExists,
  removeQuietly,
  replaceFile,
  tempOutputPath,
} from './safe-write';
import { buildWriteArgs } from './write-args';

/**
 * Writing tags and cover art, as a queue job.
 *
 * A metadata edit is a stream copy, but it still rewrites the whole container —
 * minutes for a large video — so it reports progress and cancels like any other
 * long-running work instead of blocking an IPC call.
 */

export interface TagJobDeps {
  ffmpegPath: string;
  ffprobePath: string;
}

export function createTagWriteJob(request: SaveTagsRequest, deps: TagJobDeps): JobSpec {
  const inPlace = request.sourcePath === request.destinationPath;
  return {
    kind: 'export',
    label: `${inPlace ? 'Tags' : 'Save as'}: ${basename(request.destinationPath)}`,
    run: (context) => writeTags(request, deps, context),
  };
}

async function writeTags(
  request: SaveTagsRequest,
  deps: TagJobDeps,
  context: JobContext,
): Promise<void> {
  context.setDetail('Reading the file');
  // Probed here rather than trusting what the renderer read earlier: the file may
  // have changed, and the stream layout decides how the new cover is mapped.
  const source = await probeFile(request.sourcePath, {
    ffprobePath: deps.ffprobePath,
    signal: context.signal,
  });

  const format = formatForExtension(source.ext);
  if (!format) throw new AppFailure(`.${source.ext} files cannot be tagged.`);

  await mkdir(dirname(request.destinationPath), { recursive: true });

  // ffmpeg cannot read and write the same file, so the output is always a sibling
  // temp file — and it stays that way until it has been verified.
  const token = context.jobId.slice(0, 8);
  const temporaryPath = tempOutputPath(request.destinationPath, token);

  try {
    const args = buildWriteArgs({
      sourcePath: request.sourcePath,
      outputPath: temporaryPath,
      family: format.tagFamily,
      values: request.tags,
      cover: request.cover,
      existingCoverStreams: source.coverStreamIndexes,
      contentVideoStreams: source.video ? 1 : 0,
    });

    // The exact invocation, so a failure report is reproducible from the log pane.
    context.log(`$ ${deps.ffmpegPath} ${args.join(' ')}`);
    context.setDetail('Writing');
    context.setProgress(0);

    const result = await runProcess({
      binary: deps.ffmpegPath,
      args,
      signal: context.signal,
      onLine: (line, stream) => {
        const progress = parseProgressLine(line);
        if (progress) {
          // Progress ticks are not logged: they would push the lines that
          // explain a failure out of the log tail.
          if (progress.outSeconds !== null) {
            context.setProgress(progressFraction(progress.outSeconds, source.durationSeconds));
          }
          return;
        }
        // stdout is the progress stream; anything else on it is not worth keeping.
        if (stream === 'stderr') context.log(line);
      },
    });

    if (context.signal.aborted || result.terminated) return;

    if (result.code !== 0) {
      throw new AppFailure(
        `ffmpeg exited with code ${String(result.code)}.`,
        result.stderrTail.join('\n'),
      );
    }

    context.setProgress(null);
    context.setDetail('Verifying');
    const written = await probeFile(temporaryPath, {
      ffprobePath: deps.ffprobePath,
      signal: context.signal,
    });

    const mismatch = describeOutputMismatch(source, written);
    if (mismatch) {
      // The original is still untouched, and stays that way.
      throw new AppFailure(
        `The saved file did not come out right — ${mismatch}. Your original was left unchanged.`,
      );
    }

    context.setDetail('Replacing the file');
    await replaceFile(temporaryPath, request.destinationPath, token);
    context.setOutputPath(request.destinationPath);
  } finally {
    // On success the temp file has been renamed away; on any other path it is
    // what has to disappear so a failed save leaves nothing behind.
    if (await fileExists(temporaryPath)) await removeQuietly(temporaryPath);
  }
}
