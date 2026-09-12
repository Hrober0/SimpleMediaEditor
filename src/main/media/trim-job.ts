import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import type { TagFamily } from '@shared/media-types';
import { formatForExtension } from '@shared/media-types';
import type { MediaInfo } from '@shared/metadata';
import {
  sanitizeKeepRanges,
  totalKeptSeconds,
  type KeepRange,
  type TrimRequest,
} from '@shared/trim';
import { AppFailure } from '../errors';
import type { JobContext, JobSpec } from '../jobs/queue';
import { runProcess } from '../jobs/runner';
import { extractEmbeddedCover, type CoverDeps } from './cover-art';
import { parseProgressLine, progressFraction } from './ffmpeg-progress';
import { probeFile } from './probe';
import { fileExists, removeQuietly, replaceFile, tempOutputPath } from './safe-write';
import { readTagValues } from './tags';
import {
  buildConcatArgs,
  buildConcatListContent,
  buildFastSegmentArgs,
  buildPreciseTrimArgs,
  type MetadataToKeep,
} from './trim-args';
import { buildWriteArgs } from './write-args';

/**
 * Trimming, as a queue job.
 *
 * The cut itself never touches cover art: the `0:V`/`0:a` stream specifiers in
 * `trim-args.ts` exclude an attached picture by construction, so the trimmed
 * file always comes out without one. If the source had cover art, a second,
 * fast, stream-copy pass re-attaches it here — reusing the exact embedding
 * code Phase 2 uses for a tag edit, rather than teaching the cut about covers
 * as well.
 *
 * Both stages write to a temp sibling of the destination and are verified
 * before anything replaces the user's file, same as every other export.
 */

export type TrimJobDeps = CoverDeps;

export function createTrimJob(request: TrimRequest, deps: TrimJobDeps): JobSpec {
  const inPlace = request.sourcePath === request.destinationPath;
  return {
    kind: 'export',
    label: `${inPlace ? 'Trim' : 'Trim (save as)'}: ${basename(request.destinationPath)}`,
    run: (context) => runTrim(request, deps, context),
  };
}

async function runTrim(
  request: TrimRequest,
  deps: TrimJobDeps,
  context: JobContext,
): Promise<void> {
  context.setDetail('Reading the file');
  const source = await probeFile(request.sourcePath, {
    ffprobePath: deps.ffprobePath,
    signal: context.signal,
  });

  const format = formatForExtension(source.ext);
  if (!format) throw new AppFailure(`.${source.ext} files cannot be trimmed.`);
  if (!format.editable) throw new AppFailure(`${format.label} files cannot be trimmed directly.`);

  const ranges = sanitizeKeepRanges(request.ranges, source.durationSeconds ?? 0);
  if (ranges.length === 0) {
    throw new AppFailure('Nothing was kept — at least one range of the file must remain.');
  }

  const hasAudio = source.audio !== null;
  const hasVideo = source.video !== null;
  const expectedSeconds = totalKeptSeconds(ranges);

  await mkdir(dirname(request.destinationPath), { recursive: true });
  const token = context.jobId.slice(0, 8);
  const contentPath = tempOutputPath(request.destinationPath, `${token}-cut`);
  const finalPath = tempOutputPath(request.destinationPath, `${token}-final`);
  const cleanupPaths = [contentPath, finalPath];

  try {
    context.setDetail('Cutting');
    const cutOk = await cutRanges({
      sourcePath: request.sourcePath,
      outputPath: contentPath,
      ranges,
      mode: request.mode,
      hasAudio,
      hasVideo,
      ext: format.ext,
      expectedSeconds,
      ffmpegPath: deps.ffmpegPath,
      context,
      metadata: { values: readTagValues(source.tags), family: format.tagFamily },
      cleanupPaths,
    });
    if (!cutOk) return;

    let resultPath = contentPath;

    if (source.coverStreamIndexes.length > 0 && format.coverArt !== 'unsupported') {
      context.setDetail('Restoring cover art');
      const attached = await reattachCover({
        source,
        contentPath,
        finalPath,
        family: format.tagFamily,
        hasVideo,
        deps,
        context,
      });
      if (attached === 'cancelled') return;
      if (attached === 'attached') resultPath = finalPath;
      // 'unavailable' means the embedded picture could not be read back out —
      // already logged. The cut itself is still good, so it is kept rather
      // than failing the whole trim over artwork.
    }

    context.setProgress(null);
    context.setDetail('Verifying');
    const written = await probeFile(resultPath, {
      ffprobePath: deps.ffprobePath,
      signal: context.signal,
    });

    const mismatch = describeTrimMismatch(written, expectedSeconds, hasAudio, hasVideo);
    if (mismatch) {
      throw new AppFailure(
        `The trimmed file did not come out right — ${mismatch}. Your original was left unchanged.`,
      );
    }

    context.setDetail('Replacing the file');
    await replaceFile(resultPath, request.destinationPath, token);
    context.setOutputPath(request.destinationPath);
  } finally {
    for (const path of cleanupPaths) {
      if (await fileExists(path)) await removeQuietly(path);
    }
  }
}

interface CutOptions {
  sourcePath: string;
  outputPath: string;
  ranges: readonly KeepRange[];
  mode: TrimRequest['mode'];
  hasAudio: boolean;
  hasVideo: boolean;
  ext: string;
  expectedSeconds: number;
  ffmpegPath: string;
  context: JobContext;
  metadata: MetadataToKeep;
  /** Segment and list files created along the way, added here so they are removed once the job ends. */
  cleanupPaths: string[];
}

/** Runs the cut, returning false when the job was cancelled mid-flight. */
async function cutRanges(options: CutOptions): Promise<boolean> {
  const { mode, ranges, hasAudio, hasVideo, ext, expectedSeconds, ffmpegPath, context, metadata } =
    options;

  if (mode === 'precise') {
    const args = buildPreciseTrimArgs({
      sourcePath: options.sourcePath,
      outputPath: options.outputPath,
      ranges,
      hasAudio,
      hasVideo,
      ext,
      metadata,
    });
    return runFfmpeg(args, ffmpegPath, expectedSeconds, context);
  }

  if (ranges.length === 1) {
    const [range] = ranges;
    if (!range) return false;
    const args = buildFastSegmentArgs({
      sourcePath: options.sourcePath,
      outputPath: options.outputPath,
      range,
      hasAudio,
      hasVideo,
      metadata,
    });
    return runFfmpeg(args, ffmpegPath, expectedSeconds, context);
  }

  // More than one keep-range: each is its own stream-copy extraction, then the
  // concat demuxer stitches them back into a single file. Segments are
  // intermediate, so they carry no explicit tags — only the final, joined
  // file needs them.
  const segmentPaths: string[] = [];
  for (let index = 0; index < ranges.length; index += 1) {
    const range = ranges[index];
    if (!range) continue;
    // The extension has to stay last, or ffmpeg cannot guess a muxer for the
    // output at all and refuses to write it.
    const segmentPath = tempOutputPath(options.outputPath, `segment-${String(index)}`);
    segmentPaths.push(segmentPath);
    options.cleanupPaths.push(segmentPath);

    context.setDetail(`Cutting part ${String(index + 1)} of ${String(ranges.length)}`);
    const args = buildFastSegmentArgs({
      sourcePath: options.sourcePath,
      outputPath: segmentPath,
      range,
      hasAudio,
      hasVideo,
    });
    const ok = await runFfmpeg(args, ffmpegPath, range.endSeconds - range.startSeconds, context);
    if (!ok) return false;
  }

  const listPath = `${options.outputPath}.concat.txt`;
  options.cleanupPaths.push(listPath);
  await writeFile(listPath, buildConcatListContent(segmentPaths), 'utf8');

  context.setDetail('Joining the parts');
  context.setProgress(null);
  const args = buildConcatArgs({ listPath, outputPath: options.outputPath, metadata });
  return runFfmpeg(args, ffmpegPath, null, context);
}

async function runFfmpeg(
  args: string[],
  ffmpegPath: string,
  totalSeconds: number | null,
  context: JobContext,
): Promise<boolean> {
  context.log(`$ ${ffmpegPath} ${args.join(' ')}`);

  const result = await runProcess({
    binary: ffmpegPath,
    args,
    signal: context.signal,
    onLine: (line, stream) => {
      const progress = parseProgressLine(line);
      if (progress) {
        if (progress.outSeconds !== null && totalSeconds !== null) {
          context.setProgress(progressFraction(progress.outSeconds, totalSeconds));
        }
        return;
      }
      if (stream === 'stderr') context.log(line);
    },
  });

  if (context.signal.aborted || result.terminated) return false;
  if (result.code !== 0) {
    throw new AppFailure(
      `ffmpeg exited with code ${String(result.code)}.`,
      result.stderrTail.join('\n'),
    );
  }
  return true;
}

interface ReattachOptions {
  source: MediaInfo;
  contentPath: string;
  finalPath: string;
  family: TagFamily;
  hasVideo: boolean;
  deps: TrimJobDeps;
  context: JobContext;
}

type ReattachResult = 'attached' | 'unavailable' | 'cancelled';

/** Re-attaches the source's cover art onto the already-trimmed file. */
async function reattachCover(options: ReattachOptions): Promise<ReattachResult> {
  const { source, contentPath, finalPath, family, hasVideo, deps, context } = options;

  const cover = await extractEmbeddedCover(source, deps);
  if (!cover) return 'unavailable';

  const trimmed = await probeFile(contentPath, {
    ffprobePath: deps.ffprobePath,
    signal: context.signal,
  });

  const args = buildWriteArgs({
    sourcePath: contentPath,
    outputPath: finalPath,
    family,
    // The trimmed file's own tags: -map_metadata 0 already carried the
    // source's values through, so this is a same-value rewrite, not a change.
    values: readTagValues(trimmed.tags),
    cover: { kind: 'replace', imagePath: cover.path },
    existingCoverStreams: [],
    contentVideoStreams: hasVideo ? 1 : 0,
  });

  const ok = await runFfmpeg(args, deps.ffmpegPath, trimmed.durationSeconds, context);
  return ok ? 'attached' : 'cancelled';
}

function describeTrimMismatch(
  output: MediaInfo,
  expectedSeconds: number,
  hasAudio: boolean,
  hasVideo: boolean,
): string | null {
  if (output.byteSize <= 0) return 'the new file is empty';
  if (hasAudio && !output.audio) return 'the audio stream is missing from the new file';
  if (hasVideo && !output.video) return 'the video stream is missing from the new file';

  const after = output.durationSeconds;
  if (after !== null && expectedSeconds > 0) {
    // Fast mode cuts on the nearest keyframe, which can land a couple of
    // seconds off the requested point — this only needs to catch a cut that
    // is wrong, not one that merely snapped.
    const allowed = Math.max(2, expectedSeconds * 0.05);
    if (Math.abs(expectedSeconds - after) > allowed) {
      return `the new file is ${after.toFixed(1)}s long instead of the expected ${expectedSeconds.toFixed(1)}s`;
    }
  }
  return null;
}
