import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Job } from '@shared/jobs';
import {
  cutRange,
  pasteAt,
  sanitizeKeepRanges,
  totalKeptSeconds,
  type KeepRange,
  type TrimExportMode,
} from '@shared/trim';
import { JobQueue } from '../jobs/queue';
import { runProcess } from '../jobs/runner';
import { coverDirectory } from './cover-art';
import { probeFile } from './probe';
import { createTrimJob } from './trim-job';
import { computeWaveformPeaks } from './waveform';

/**
 * Track Edit's save, end to end on the main side: the segments are built with
 * the same model the editor uses, sent the way the editor sends them, and the
 * saved file is then read back the way the editor reads it after reopening.
 *
 * The source has a recognisable shape (two seconds of tone, two of silence, two
 * of tone), so "the saved file matches what the editor showed" can be checked
 * by where the silence ended up, not only by the length.
 *
 * Run with: npm run test:integration
 */

const deps = { ffmpegPath: 'ffmpeg', ffprobePath: 'ffprobe' };
const BUCKETS_PER_SECOND = 10;
/** Buckets this close to an expected change of loud and silent are not judged. */
const EDGE_SECONDS = 0.3;

let workDirectory: string;
let tempRoot: string;

beforeAll(async () => {
  workDirectory = await mkdtemp(join(tmpdir(), 'mediaeditor-track-edit-'));
  tempRoot = await mkdtemp(join(tmpdir(), 'mediaeditor-track-edit-tmp-'));
});

afterAll(async () => {
  await rm(workDirectory, { recursive: true, force: true });
  await rm(tempRoot, { recursive: true, force: true });
});

async function ffmpeg(args: string[]): Promise<void> {
  const result = await runProcess({ binary: 'ffmpeg', args, timeoutMs: 120_000 });
  expect(result.code, result.stderrTail.slice(-5).join('\n')).toBe(0);
}

/** Tone 0 to 2s, silence 2 to 4s, tone 4 to 6s. Video, when asked for, has a keyframe every second. */
async function makeSource(name: string, withVideo: boolean): Promise<string> {
  const path = join(workDirectory, name);
  const video = withVideo ? ['-f', 'lavfi', '-i', 'testsrc=duration=6:size=160x120:rate=10'] : [];
  await ffmpeg([
    '-hide_banner',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2:sample_rate=44100',
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=44100:cl=mono:d=2',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2:sample_rate=44100',
    ...video,
    '-filter_complex',
    '[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]',
    '-map',
    '[out]',
    ...(withVideo ? ['-map', '3:v', '-c:v', 'mpeg4', '-g', '10', '-c:a', 'aac'] : []),
    path,
  ]);
  return path;
}

function save(path: string, segments: readonly KeepRange[], mode: TrimExportMode): Promise<Job> {
  const queue = new JobQueue(() => 1);
  const job = queue.enqueue(
    createTrimJob(
      { sourcePath: path, destinationPath: path, ranges: sanitizeKeepRanges(segments, 6), mode },
      { ...deps, coverDirectory: coverDirectory(tempRoot) },
    ),
  );
  return new Promise((resolve) => {
    const unsubscribe = queue.onChanged((jobs) => {
      const current = jobs.find((candidate) => candidate.id === job.id);
      if (current && ['done', 'failed', 'cancelled'].includes(current.status)) {
        unsubscribe();
        resolve(current);
      }
    });
  });
}

/** One letter per tenth of a second: L for loud, s for silent. */
async function loudnessShape(path: string): Promise<{ seconds: number; shape: string }> {
  const info = await probeFile(path, deps);
  const seconds = info.durationSeconds ?? 0;
  const bucketCount = Math.round(seconds * BUCKETS_PER_SECOND);
  const { peaks } = await computeWaveformPeaks(path, seconds, bucketCount, deps);
  let shape = '';
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const max = Math.max(Math.abs(peaks[bucket * 2] ?? 0), Math.abs(peaks[bucket * 2 + 1] ?? 0));
    shape += max > 0.1 ? 'L' : 's';
  }
  return { seconds, shape };
}

/**
 * Checks each bucket against the silent stretches the editor showed, skipping
 * the ones that sit on a boundary, where a codec frame or two either way is fine.
 */
function expectShape(shape: string, silent: readonly KeepRange[], seconds: number): void {
  const mismatches: string[] = [];
  for (let bucket = 0; bucket < shape.length; bucket += 1) {
    const time = (bucket + 0.5) / BUCKETS_PER_SECOND;
    const edges = [
      0,
      seconds,
      ...silent.flatMap((range) => [range.startSeconds, range.endSeconds]),
    ];
    if (edges.some((edge) => Math.abs(edge - time) < EDGE_SECONDS)) continue;

    const shouldBeSilent = silent.some(
      (range) => time > range.startSeconds && time < range.endSeconds,
    );
    if ((shape[bucket] === 's') !== shouldBeSilent) mismatches.push(time.toFixed(2));
  }
  expect(mismatches, `shape was ${shape}`).toEqual([]);
}

const CASES: readonly { name: string; withVideo: boolean; mode: TrimExportMode }[] = [
  { name: 'mp3, fast', withVideo: false, mode: 'fast' },
  { name: 'mp3, precise', withVideo: false, mode: 'precise' },
  { name: 'mp4, fast', withVideo: true, mode: 'fast' },
  { name: 'mp4, precise', withVideo: true, mode: 'precise' },
];

describe.each(CASES)('saving a Track Edit cut ($name)', ({ withVideo, mode }) => {
  const ext = withVideo ? 'mp4' : 'mp3';
  const wholeFile: KeepRange[] = [{ startSeconds: 0, endSeconds: 6 }];

  it('removes exactly the part that was cut', async () => {
    const path = await makeSource(`cut-${mode}.${ext}`, withVideo);
    const { kept } = cutRange(wholeFile, 2, 4);

    const job = await save(path, kept, mode);

    expect(job.error).toBeNull();
    expect(job.status).toBe('done');
    const { seconds, shape } = await loudnessShape(path);
    expect(seconds).toBeCloseTo(totalKeptSeconds(kept), 0);
    expectShape(shape, [], seconds);
  });

  it('puts a pasted part where the playhead was', async () => {
    const path = await makeSource(`paste-${mode}.${ext}`, withVideo);
    // Cut the first tone, leaving silence then tone, and paste it at the end.
    const { kept, removed } = cutRange(wholeFile, 0, 2);
    const edited = pasteAt(kept, totalKeptSeconds(kept), removed);

    const job = await save(path, edited, mode);

    expect(job.error).toBeNull();
    expect(job.status).toBe('done');
    const { seconds, shape } = await loudnessShape(path);
    expect(seconds).toBeCloseTo(6, 0);
    expectShape(shape, [{ startSeconds: 0, endSeconds: 2 }], seconds);
  });

  it('can be edited again after reopening, against the new file', async () => {
    const path = await makeSource(`twice-${mode}.${ext}`, withVideo);
    await save(path, cutRange(wholeFile, 2, 4).kept, mode);

    // Reopened the way the editor reopens it: the whole new file, from its probe.
    const reopened = await probeFile(path, deps);
    const reopenedFile: KeepRange[] = [
      { startSeconds: 0, endSeconds: reopened.durationSeconds ?? 0 },
    ];
    // Cut at the same point as the first save. In fast mode this lands right on
    // where that save put a keyframe, so nothing already cut may come back.
    const job = await save(path, cutRange(reopenedFile, 0, 2).kept, mode);

    expect(job.status).toBe('done');
    const { seconds, shape } = await loudnessShape(path);
    expect(seconds).toBeCloseTo(2, 0);
    expectShape(shape, [], seconds);
  });
});
