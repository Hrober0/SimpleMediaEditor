import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Job } from '@shared/jobs';
import type { LoudnessTarget } from '@shared/normalize';
import { JobQueue } from '../jobs/queue';
import { runProcess } from '../jobs/runner';
import { parseLoudnormStats } from './loudnorm-stats';
import { buildMeasureArgs } from './normalize-args';
import { createNormalizeJob } from './normalize-job';
import type { NormalizeTask } from './normalize-request';
import { probeFile } from './probe';

/**
 * Normalization against the real ffmpeg and ffprobe, on generated media.
 *
 * What it checks is what argument assertions cannot: that the file really
 * comes out at the target loudness, that tags, cover art and video survive the
 * re-encode, and that a failed run leaves the original alone.
 *
 * Run with: npm run test:integration
 */

const deps = { ffmpegPath: 'ffmpeg', ffprobePath: 'ffprobe' };

let workDirectory: string;

beforeAll(async () => {
  workDirectory = await mkdtemp(join(tmpdir(), 'mediaeditor-normalize-'));
});

afterAll(async () => {
  await rm(workDirectory, { recursive: true, force: true });
});

function normalize(task: NormalizeTask): Promise<Job> {
  const queue = new JobQueue(() => 1);
  const job = queue.enqueue(createNormalizeJob(task, deps));
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

async function ffmpeg(args: string[]): Promise<void> {
  const result = await runProcess({ binary: 'ffmpeg', args, timeoutMs: 120_000 });
  expect(result.code, result.stderrTail.slice(-5).join('\n')).toBe(0);
}

/** Measured the same way the job's first pass measures, independently of it. */
async function loudnessOf(path: string, target: LoudnessTarget): Promise<number> {
  const result = await runProcess({ binary: 'ffmpeg', args: buildMeasureArgs(path, target) });
  const stats = parseLoudnormStats(result.stderrTail);
  if (!stats) throw new Error(`No measurement for ${path}`);
  return stats.inputIntegrated;
}

/** A quiet tagged mp3 with cover art, the shape of a typical downloaded track. */
async function makeQuietMp3(name: string, volume: number): Promise<string> {
  const path = join(workDirectory, name);
  await ffmpeg([
    '-hide_banner',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:duration=4,volume=${String(volume)}`,
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=64x64:duration=1:rate=1',
    '-map',
    '0:a',
    '-map',
    '1:v',
    '-frames:v',
    '1',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '256k',
    '-c:v',
    'mjpeg',
    '-disposition:v',
    'attached_pic',
    '-metadata',
    'title=Quiet song',
    '-metadata',
    'artist=Someone',
    '-id3v2_version',
    '3',
    path,
  ]);
  return path;
}

async function makeMp4(name: string): Promise<string> {
  const path = join(workDirectory, name);
  await ffmpeg([
    '-hide_banner',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=duration=4:size=320x240:rate=10',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=4,volume=0.05',
    '-c:v',
    'mpeg4',
    '-c:a',
    'aac',
    '-shortest',
    path,
  ]);
  return path;
}

async function leftovers(directory: string): Promise<string[]> {
  return (await readdir(directory)).filter((name) => name.includes('mediaeditor-'));
}

describe('normalizing an mp3 in place', () => {
  it('reaches the target and keeps tags, cover art, sample rate and bitrate', async () => {
    const path = await makeQuietMp3('quiet.mp3', 0.05);
    const before = await probeFile(path, deps);

    const job = await normalize({ sourcePath: path, destinationPath: path, targetLufs: -14 });

    expect(job.error).toBeNull();
    expect(job.status).toBe('done');
    expect(job.detail).toMatch(/^Was -\d+\.\d LUFS, now -1[34]\.\d LUFS$/);
    expect(job.outputPath).toBe(path);

    expect(await loudnessOf(path, -14)).toBeCloseTo(-14, 0);

    const after = await probeFile(path, deps);
    expect(after.tags.title).toBe('Quiet song');
    expect(after.tags.artist).toBe('Someone');
    expect(after.coverStreamIndexes).toHaveLength(1);
    expect(after.video).toBeNull();
    expect(after.audio?.sampleRate).toBe(before.audio?.sampleRate);
    expect(after.audio?.bitrate).toBe(256_000);
    expect(after.durationSeconds ?? 0).toBeCloseTo(before.durationSeconds ?? 0, 0);

    expect(await leftovers(workDirectory)).toEqual([]);
  });

  it('leaves a file already at the target untouched', async () => {
    const path = await makeQuietMp3('again.mp3', 0.05);
    await normalize({ sourcePath: path, destinationPath: path, targetLufs: -16 });
    const modified = (await stat(path)).mtimeMs;

    const job = await normalize({ sourcePath: path, destinationPath: path, targetLufs: -16 });

    expect(job.status).toBe('done');
    expect(job.detail).toMatch(/^Already at -1[56]\.\d LUFS, left unchanged$/);
    expect((await stat(path)).mtimeMs).toBe(modified);
  });
});

/** A quiet sine in a lossless format, at a given sample format and codec. */
async function makeLossless(name: string, codecArgs: string[]): Promise<string> {
  const path = join(workDirectory, name);
  await ffmpeg([
    '-hide_banner',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=3,volume=0.05',
    '-ar',
    '48000',
    ...codecArgs,
    path,
  ]);
  return path;
}

describe('keeping the bit depth of lossless files', () => {
  it.each([
    { name: 'deep.wav', codecArgs: ['-c:a', 'pcm_s24le'], codec: 'pcm_s24le', sampleFormat: 's32' },
    {
      name: 'float.wav',
      codecArgs: ['-c:a', 'pcm_f32le'],
      codec: 'pcm_f32le',
      sampleFormat: 'flt',
    },
    {
      name: 'plain.wav',
      codecArgs: ['-c:a', 'pcm_s16le'],
      codec: 'pcm_s16le',
      sampleFormat: 's16',
    },
    {
      name: 'plain.flac',
      codecArgs: ['-c:a', 'flac', '-sample_fmt', 's16'],
      codec: 'flac',
      sampleFormat: 's16',
    },
    {
      name: 'deep.flac',
      codecArgs: ['-c:a', 'flac', '-sample_fmt', 's32'],
      codec: 'flac',
      sampleFormat: 's32',
    },
  ])(
    '$name comes out as $codec in $sampleFormat',
    async ({ name, codecArgs, codec, sampleFormat }) => {
      const path = await makeLossless(name, codecArgs);

      const job = await normalize({ sourcePath: path, destinationPath: path, targetLufs: -14 });

      expect(job.error).toBeNull();
      expect(job.status).toBe('done');
      const after = await probeFile(path, deps);
      expect(after.audio?.codec).toBe(codec);
      expect(after.audio?.sampleFormat).toBe(sampleFormat);
      expect(after.audio?.sampleRate).toBe(48_000);
      expect(await loudnessOf(path, -14)).toBeCloseTo(-14, 0);
    },
  );
});

describe('normalizing into a folder', () => {
  it('writes a copy with its video intact and leaves the original alone', async () => {
    const source = await makeMp4('clip.mp4');
    const original = await stat(source);
    const output = join(workDirectory, 'normalized');
    await mkdir(output);
    const destination = join(output, 'clip.mp4');

    const job = await normalize({
      sourcePath: source,
      destinationPath: destination,
      targetLufs: -23,
    });

    expect(job.error).toBeNull();
    expect(job.status).toBe('done');
    expect(job.outputPath).toBe(destination);
    expect(await loudnessOf(destination, -23)).toBeCloseTo(-23, 0);

    const written = await probeFile(destination, deps);
    expect(written.video?.codec).toBe('mpeg4');
    expect(written.audio?.codec).toBe('aac');

    const unchanged = await stat(source);
    expect(unchanged.size).toBe(original.size);
    expect(unchanged.mtimeMs).toBe(original.mtimeMs);
    expect(await leftovers(output)).toEqual([]);
  });
});

describe('a file that cannot be normalized', () => {
  it('fails on silence and leaves the original as it was', async () => {
    const path = await makeQuietMp3('silent.mp3', 0);
    const original = await stat(path);

    const job = await normalize({ sourcePath: path, destinationPath: path, targetLufs: -14 });

    expect(job.status).toBe('failed');
    expect(job.error).toMatch(/silent/);
    expect((await stat(path)).mtimeMs).toBe(original.mtimeMs);
    expect(await leftovers(workDirectory)).toEqual([]);
  });
});
