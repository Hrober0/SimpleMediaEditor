import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Job } from '@shared/jobs';
import type { TrimRequest } from '@shared/trim';
import { JobQueue } from '../jobs/queue';
import { runProcess } from '../jobs/runner';
import { coverDirectory, prepareCoverFromImage } from './cover-art';
import { probeFile } from './probe';
import { readTagValues } from './tags';
import { createTrimJob, type TrimJobDeps } from './trim-job';

/**
 * The trim writer against the real ffmpeg and ffprobe.
 *
 * Argument construction is covered by `trim-args.test.ts`; what this checks is
 * what only a real ffmpeg run can prove: that a multi-range fast trim (the
 * concat path) still carries tags and cover art, that precise mode lands
 * exactly on the requested duration, and that a failed trim leaves the
 * original untouched.
 *
 * Run with: npm run test:integration
 */

const probeDeps = { ffprobePath: 'ffprobe' };

let workDirectory: string;
let tempRoot: string;
let covers: string;

beforeAll(async () => {
  workDirectory = await mkdtemp(join(tmpdir(), 'mediaeditor-trim-'));
  tempRoot = await mkdtemp(join(tmpdir(), 'mediaeditor-trim-tmp-'));
  covers = coverDirectory(tempRoot);
});

afterAll(async () => {
  await rm(workDirectory, { recursive: true, force: true });
  await rm(tempRoot, { recursive: true, force: true });
});

const deps = (): TrimJobDeps => ({
  ffmpegPath: 'ffmpeg',
  ffprobePath: 'ffprobe',
  coverDirectory: covers,
});

function watch(queue: JobQueue, jobId: string): Promise<Job> {
  return new Promise((resolve) => {
    const unsubscribe = queue.onChanged((jobs) => {
      const job = jobs.find((candidate) => candidate.id === jobId);
      if (!job) return;
      if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') {
        unsubscribe();
        resolve(job);
      }
    });
  });
}

async function trim(request: TrimRequest): Promise<Job> {
  const queue = new JobQueue(() => 1);
  const job = queue.enqueue(createTrimJob(request, deps()));
  return watch(queue, job.id);
}

async function ffmpeg(args: string[]): Promise<void> {
  const result = await runProcess({ binary: 'ffmpeg', args, timeoutMs: 120_000 });
  expect(result.code, result.stderrTail.slice(-5).join('\n')).toBe(0);
}

/** A tagged sine-wave mp3, the same shape a downloaded track has. */
async function makeMp3(name: string, durationSeconds: number): Promise<string> {
  const path = join(workDirectory, name);
  await ffmpeg([
    '-hide_banner',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:duration=${String(durationSeconds)}`,
    '-metadata',
    'artist=Test Artist',
    '-metadata',
    'title=Test Title',
    '-c:a',
    'libmp3lame',
    path,
  ]);
  return path;
}

/** Embeds cover art into `path`, producing a new file since ffmpeg cannot
 *  write over its own input — mirroring the rule the app itself follows. */
async function withCover(path: string, coverName: string): Promise<string> {
  const coverPngPath = join(workDirectory, coverName);
  await ffmpeg([
    '-hide_banner',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=64x64:duration=1:rate=1',
    '-frames:v',
    '1',
    '-update',
    '1',
    coverPngPath,
  ]);
  const cover = await prepareCoverFromImage(coverPngPath, {
    ffmpegPath: 'ffmpeg',
    ffprobePath: 'ffprobe',
    coverDirectory: covers,
  });

  const embedded = `${path}.with-cover.mp3`;
  await ffmpeg([
    '-hide_banner',
    '-y',
    '-i',
    path,
    '-i',
    cover.path,
    '-map',
    '0',
    '-map',
    '1',
    '-c',
    'copy',
    '-disposition:v:0',
    'attached_pic',
    embedded,
  ]);
  return embedded;
}

/** Video plus audio, tagged, for the video trim case. */
async function makeMp4(
  name: string,
  durationSeconds: number,
  keyframeIntervalFrames = 12,
): Promise<string> {
  const path = join(workDirectory, name);
  await ffmpeg([
    '-hide_banner',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `testsrc=duration=${String(durationSeconds)}:size=320x240:rate=10`,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:duration=${String(durationSeconds)}`,
    '-metadata',
    'title=Clip Title',
    '-c:v',
    'mpeg4',
    '-g',
    String(keyframeIntervalFrames),
    '-c:a',
    'aac',
    '-shortest',
    path,
  ]);
  return path;
}

describe('trimming an mp3', () => {
  it('keeps one range, its tags, and its cover art', async () => {
    const plain = await makeMp3('single.mp3', 12);
    const path = await withCover(plain, 'single-cover.png');

    const job = await trim({
      sourcePath: path,
      destinationPath: path,
      ranges: [{ startSeconds: 2, endSeconds: 8 }],
      mode: 'fast',
    });

    expect(job.error).toBeNull();
    expect(job.status).toBe('done');

    const after = await probeFile(path, probeDeps);
    expect(after.durationSeconds ?? 0).toBeGreaterThan(5);
    expect(after.durationSeconds ?? 0).toBeLessThan(7);
    expect(readTagValues(after.tags).author).toBe('Test Artist');
    expect(after.coverStreamIndexes).toHaveLength(1);

    expect((await readdir(workDirectory)).filter((name) => name.includes('mediaeditor-'))).toEqual(
      [],
    );
  });

  it('keeps two ranges and still carries the tags through the concat step', async () => {
    const path = await makeMp3('multi.mp3', 12);

    const job = await trim({
      sourcePath: path,
      destinationPath: path,
      ranges: [
        { startSeconds: 0, endSeconds: 3 },
        { startSeconds: 8, endSeconds: 12 },
      ],
      mode: 'fast',
    });

    expect(job.status).toBe('done');
    const after = await probeFile(path, probeDeps);
    // ~7s total (3 + 4), with slack for the keyframe/frame-boundary snap fast mode allows.
    expect(after.durationSeconds ?? 0).toBeGreaterThan(5);
    expect(after.durationSeconds ?? 0).toBeLessThan(9);
    expect(readTagValues(after.tags).author).toBe('Test Artist');
    expect(readTagValues(after.tags).title).toBe('Test Title');
  });

  it('lands on the exact duration in precise mode', async () => {
    const path = await makeMp3('precise.mp3', 12);

    const job = await trim({
      sourcePath: path,
      destinationPath: path,
      ranges: [
        { startSeconds: 0, endSeconds: 3 },
        { startSeconds: 8, endSeconds: 12 },
      ],
      mode: 'precise',
    });

    expect(job.status).toBe('done');
    const after = await probeFile(path, probeDeps);
    expect(after.durationSeconds ?? 0).toBeCloseTo(7, 0);
    expect(readTagValues(after.tags).author).toBe('Test Artist');
  });

  it('a failed trim leaves the original untouched', async () => {
    const path = await makeMp3('untouched.mp3', 5);
    const before = await readFile(path);

    // Past the end of the file: nothing survives sanitizeKeepRanges, which the
    // job itself refuses rather than handing ffmpeg an empty request.
    const job = await trim({
      sourcePath: path,
      destinationPath: path,
      ranges: [{ startSeconds: 50, endSeconds: 60 }],
      mode: 'fast',
    });

    expect(job.status).toBe('failed');
    expect(await readFile(path)).toEqual(before);
    expect((await readdir(workDirectory)).filter((name) => name.includes('mediaeditor-'))).toEqual(
      [],
    );
  });
});

describe('trimming an mp4', () => {
  it('keeps both streams and the tags', async () => {
    const path = await makeMp4('video.mp4', 6);

    const job = await trim({
      sourcePath: path,
      destinationPath: path,
      ranges: [{ startSeconds: 1, endSeconds: 4 }],
      mode: 'precise',
    });

    expect(job.status).toBe('done');
    const after = await probeFile(path, probeDeps);
    expect(after.video?.width).toBe(320);
    expect(after.audio).not.toBeNull();
    expect(after.durationSeconds ?? 0).toBeCloseTo(3, 0);
    expect(after.tags.title).toBe('Clip Title');
  });
});

describe('fast trimming an mp4 with keyframes far apart', () => {
  // One keyframe every 4s (40 frames at 10fps): before starts were moved onto
  // keyframes, each part here came out up to 4s longer than asked, and the
  // export failed its own length check.
  it('joins several parts, in the order given, and passes the length check', async () => {
    const path = await makeMp4('sparse.mp4', 20, 40);

    const job = await trim({
      sourcePath: path,
      destinationPath: path,
      ranges: [
        { startSeconds: 13, endSeconds: 15 },
        { startSeconds: 5, endSeconds: 7 },
        { startSeconds: 17, endSeconds: 19 },
      ],
      mode: 'fast',
    });

    expect(job.error).toBeNull();
    expect(job.status).toBe('done');
    const after = await probeFile(path, probeDeps);
    expect(after.video).not.toBeNull();
    expect(after.audio).not.toBeNull();
    // Starts move back to 12, 4 and 16: 3 + 3 + 3.
    expect(after.durationSeconds ?? 0).toBeCloseTo(9, 0);
  });

  it('lands on the exact length in precise mode with the parts out of order', async () => {
    const path = await makeMp4('sparse-precise.mp4', 20, 40);

    const job = await trim({
      sourcePath: path,
      destinationPath: path,
      ranges: [
        { startSeconds: 13, endSeconds: 15 },
        { startSeconds: 5, endSeconds: 7 },
      ],
      mode: 'precise',
    });

    expect(job.error).toBeNull();
    expect(job.status).toBe('done');
    expect((await probeFile(path, probeDeps)).durationSeconds ?? 0).toBeCloseTo(4, 0);
  });
});

describe('save as', () => {
  it('writes a trimmed copy and leaves the source untouched', async () => {
    const source = await makeMp3('save-as-source.mp3', 6);
    const destination = join(workDirectory, 'save-as-copy.mp3');

    const job = await trim({
      sourcePath: source,
      destinationPath: destination,
      ranges: [{ startSeconds: 0, endSeconds: 2 }],
      mode: 'fast',
    });

    expect(job.status).toBe('done');
    expect(job.outputPath).toBe(destination);
    expect((await probeFile(source, probeDeps)).durationSeconds ?? 0).toBeGreaterThan(5);
    expect((await probeFile(destination, probeDeps)).durationSeconds ?? 0).toBeLessThan(3);
  });
});
