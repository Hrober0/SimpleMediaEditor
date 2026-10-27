import { mkdir } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { formatForExtension } from '@shared/media-types';
import { TRUE_PEAK_LIMIT_DBTP } from '@shared/normalize';
import { AppFailure } from '../errors';
import type { JobContext, JobSpec } from '../jobs/queue';
import { runProcess, type RunResult } from '../jobs/runner';
import { parseProgressLine, progressFraction } from './ffmpeg-progress';
import { describeLoudnessChange, formatLufs, parseLoudnormStats } from './loudnorm-stats';
import { buildApplyArgs, buildMeasureArgs } from './normalize-args';
import type { NormalizeTask } from './normalize-request';
import { probeFile } from './probe';
import {
  describeOutputMismatch,
  fileExists,
  removeQuietly,
  replaceFile,
  tempOutputPath,
} from './safe-write';

/**
 * Two-pass loudness normalization of one file, as a queue job.
 *
 * The first pass measures, the second applies. Both read the whole file, so
 * each takes half of the progress bar. The output is written to a temp sibling
 * and verified before it replaces anything, like every other write.
 */

export interface NormalizeJobDeps {
  ffmpegPath: string;
  ffprobePath: string;
}

/**
 * Below this the file is silence or close to it: EBU R128 gates out anything
 * quieter than -70 LUFS, and raising it to a target would only amplify noise.
 */
const SILENCE_LUFS = -70;

/**
 * Close enough that re-encoding would cost more than it gains. Only applies when
 * replacing the original: a folder of copies should hold every file asked for.
 */
const ALREADY_AT_TARGET_LU = 0.5;

export function createNormalizeJob(task: NormalizeTask, deps: NormalizeJobDeps): JobSpec {
  return {
    kind: 'normalize',
    label: `${isInPlace(task) ? 'Normalize' : 'Normalize (copy)'}: ${basename(task.destinationPath)}`,
    run: (context) => runNormalize(task, deps, context),
  };
}

async function runNormalize(
  task: NormalizeTask,
  deps: NormalizeJobDeps,
  context: JobContext,
): Promise<void> {
  context.setDetail('Reading the file');
  const source = await probeFile(task.sourcePath, {
    ffprobePath: deps.ffprobePath,
    signal: context.signal,
  });

  const format = formatForExtension(source.ext);
  if (!format?.editable) throw new AppFailure(`.${source.ext} files cannot be normalized.`);
  if (!source.audio) throw new AppFailure(`${source.fileName} has no audio to normalize.`);

  context.setDetail('Measuring loudness');
  context.setProgress(0);
  const measuring = await runFfmpeg(
    buildMeasureArgs(task.sourcePath, task.targetLufs),
    { from: 0, to: 0.5, durationSeconds: source.durationSeconds },
    deps.ffmpegPath,
    context,
  );
  if (!measuring) return;

  const measured = parseLoudnormStats(measuring.stderrTail);
  if (!measured) {
    throw new AppFailure(
      'ffmpeg finished without reporting a loudness measurement.',
      measuring.stderrTail.join('\n'),
    );
  }
  if (!(measured.inputIntegrated >= SILENCE_LUFS)) {
    throw new AppFailure(
      `${source.fileName} is silent or nearly so (${formatLufs(measured.inputIntegrated)}), so there is nothing to normalize.`,
    );
  }

  const isAtTarget =
    Math.abs(measured.inputIntegrated - task.targetLufs) < ALREADY_AT_TARGET_LU &&
    measured.inputTruePeak <= TRUE_PEAK_LIMIT_DBTP;
  if (isInPlace(task) && isAtTarget) {
    context.setFinishedDetail(`Already at ${formatLufs(measured.inputIntegrated)}, left unchanged`);
    context.setOutputPath(task.destinationPath);
    return;
  }

  await mkdir(dirname(task.destinationPath), { recursive: true });
  // ffmpeg cannot read and write the same file, so the output is always a sibling
  // temp file until it has been verified.
  const token = context.jobId.slice(0, 8);
  const temporaryPath = tempOutputPath(task.destinationPath, token);

  try {
    context.setDetail('Normalizing');
    const applying = await runFfmpeg(
      buildApplyArgs({
        sourcePath: task.sourcePath,
        outputPath: temporaryPath,
        targetLufs: task.targetLufs,
        measured,
        ext: format.ext,
        family: format.tagFamily,
        sourceAudio: source.audio,
      }),
      { from: 0.5, to: 1, durationSeconds: source.durationSeconds },
      deps.ffmpegPath,
      context,
    );
    if (!applying) return;

    context.setProgress(null);
    context.setDetail('Verifying');
    const written = await probeFile(temporaryPath, {
      ffprobePath: deps.ffprobePath,
      signal: context.signal,
    });

    const mismatch = describeOutputMismatch(source, written);
    if (mismatch) {
      throw new AppFailure(
        `The normalized file did not come out right: ${mismatch}. Your original was left unchanged.`,
      );
    }

    context.setDetail('Replacing the file');
    await replaceFile(temporaryPath, task.destinationPath, token);
    context.setOutputPath(task.destinationPath);
    context.setFinishedDetail(
      describeLoudnessChange(measured, parseLoudnormStats(applying.stderrTail)),
    );
  } finally {
    // On success the temp file has been renamed away; otherwise it is what has
    // to go so a failed run leaves nothing behind.
    if (await fileExists(temporaryPath)) await removeQuietly(temporaryPath);
  }
}

function isInPlace(task: NormalizeTask): boolean {
  return resolve(task.sourcePath) === resolve(task.destinationPath);
}

/** The slice of the job's progress bar one ffmpeg pass fills. */
interface ProgressSpan {
  from: number;
  to: number;
  durationSeconds: number | null;
}

/** Runs one pass, returning null when the job was cancelled mid-flight. */
async function runFfmpeg(
  args: string[],
  span: ProgressSpan,
  ffmpegPath: string,
  context: JobContext,
): Promise<RunResult | null> {
  context.log(`$ ${ffmpegPath} ${args.join(' ')}`);

  const result = await runProcess({
    binary: ffmpegPath,
    args,
    signal: context.signal,
    onLine: (line, stream) => {
      const progress = parseProgressLine(line);
      if (progress) {
        const fraction =
          progress.outSeconds === null
            ? null
            : progressFraction(progress.outSeconds, span.durationSeconds);
        if (fraction !== null) context.setProgress(span.from + fraction * (span.to - span.from));
        return;
      }
      if (stream === 'stderr') context.log(line);
    },
  });

  if (context.signal.aborted || result.terminated) return null;
  if (result.code !== 0) {
    throw new AppFailure(
      `ffmpeg exited with code ${String(result.code)}.`,
      result.stderrTail.join('\n'),
    );
  }
  return result;
}
