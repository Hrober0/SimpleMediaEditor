import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Job } from '@shared/jobs';
import { emptyTagValues, type SaveTagsRequest, type TagValues } from '@shared/metadata';
import { JobQueue } from '../jobs/queue';
import { runProcess } from '../jobs/runner';
import { coverDirectory, prepareCoverFromFrame, prepareCoverFromImage } from './cover-art';
import { probeFile } from './probe';
import { createTagWriteJob } from './tag-job';
import { readTagValues } from './tags';

/**
 * The tag writer against the real ffmpeg and ffprobe.
 *
 * The media is generated locally, so this needs the tools but no network. What it
 * checks is what cannot be checked from argument assertions: that the tags and
 * artwork are actually in the file afterwards, that reopening it reads back what
 * was written, and that a failed save leaves the original intact.
 *
 * Run with: npm run test:integration
 */

const deps = { ffmpegPath: 'ffmpeg', ffprobePath: 'ffprobe' };

let workDirectory: string;
let tempRoot: string;
let covers: string;

beforeAll(async () => {
  workDirectory = await mkdtemp(join(tmpdir(), 'mediaeditor-tags-'));
  tempRoot = await mkdtemp(join(tmpdir(), 'mediaeditor-tags-tmp-'));
  covers = coverDirectory(tempRoot);
});

afterAll(async () => {
  await rm(workDirectory, { recursive: true, force: true });
  await rm(tempRoot, { recursive: true, force: true });
});

const coverDeps = (): { ffmpegPath: string; ffprobePath: string; coverDirectory: string } => ({
  ...deps,
  coverDirectory: covers,
});

/** Resolves once the job reaches a terminal state. */
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

async function save(request: SaveTagsRequest): Promise<Job> {
  const queue = new JobQueue(() => 1);
  const job = queue.enqueue(createTagWriteJob(request, deps));
  return watch(queue, job.id);
}

async function ffmpeg(args: string[]): Promise<void> {
  const result = await runProcess({ binary: 'ffmpeg', args, timeoutMs: 120_000 });
  expect(result.code, result.stderrTail.slice(-5).join('\n')).toBe(0);
}

/** A three second sine wave as an mp3 — the same path a downloaded track takes. */
async function makeMp3(name: string): Promise<string> {
  const path = join(workDirectory, name);
  await ffmpeg([
    '-hide_banner',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=3',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '96k',
    path,
  ]);
  return path;
}

/** Video plus audio, with the native encoders so no optional build is needed. */
async function makeMp4(name: string): Promise<string> {
  const path = join(workDirectory, name);
  await ffmpeg([
    '-hide_banner',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=duration=3:size=320x240:rate=10',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=3',
    '-c:v',
    'mpeg4',
    '-c:a',
    'aac',
    '-shortest',
    path,
  ]);
  return path;
}

/** Deliberately larger than the cover limit, and a PNG rather than a JPEG. */
async function makeCoverPng(name: string): Promise<string> {
  const path = join(workDirectory, name);
  await ffmpeg([
    '-hide_banner',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=1600x1200:duration=1:rate=1',
    '-frames:v',
    '1',
    '-update',
    '1',
    path,
  ]);
  return path;
}

const filled: TagValues = {
  title: 'Nocturne in E-flat',
  author: 'Frédéric Chopin',
  album: 'Nocturnes',
  year: '1832',
  genre: 'Classical',
  comment: 'Written by MediaEditor',
};

describe('cover preparation', () => {
  it('re-encodes an oversized PNG to a bounded baseline JPEG', async () => {
    const cover = await prepareCoverFromImage(await makeCoverPng('big.png'), coverDeps());

    // 1600x1200 must come back inside the 1000px box, aspect ratio intact.
    expect(cover.width).toBe(1000);
    expect(cover.height).toBe(750);
    expect(cover.previewDataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(cover.byteSize).toBeGreaterThan(0);

    // The preview is the file: the user approves the exact bytes to be embedded.
    const bytes = await readFile(cover.path);
    expect(bytes.byteLength).toBe(cover.byteSize);
    // SOI marker, and SOF0 rather than SOF2 — baseline, not progressive.
    expect(bytes.subarray(0, 2).toString('hex')).toBe('ffd8');
    expect(bytes.includes(Buffer.from('ffc0', 'hex'))).toBe(true);
  });

  it('grabs a frame from a video', async () => {
    const cover = await prepareCoverFromFrame(await makeMp4('frames.mp4'), 1.5, coverDeps());
    expect(cover.width).toBe(320);
    expect(cover.height).toBe(240);
  });
});

describe('writing tags to an mp3', () => {
  it('sets the tags and cover art, and reads them back after a reopen', async () => {
    const path = await makeMp3('tagme.mp3');
    const before = await probeFile(path, deps);
    const cover = await prepareCoverFromImage(await makeCoverPng('mp3-cover.png'), coverDeps());

    const job = await save({
      sourcePath: path,
      destinationPath: path,
      tags: filled,
      cover: { kind: 'replace', imagePath: cover.path },
    });

    expect(job.error).toBeNull();
    expect(job.status).toBe('done');
    expect(job.outputPath).toBe(path);

    // Reopened exactly as the panel reopens it after a save.
    const after = await probeFile(path, deps);
    expect(readTagValues(after.tags)).toEqual(filled);

    // The audio is untouched: a tag edit is a stream copy.
    expect(after.durationSeconds ?? 0).toBeCloseTo(before.durationSeconds ?? 0, 1);
    expect(after.audio?.codec).toBe('mp3');

    // Cover art is an attached picture, not a stray video stream — an mp3 that
    // probes as video would be treated as one everywhere else in the app.
    expect(after.coverStreamIndexes).toHaveLength(1);
    expect(after.video).toBeNull();

    // Nothing temporary survived the save.
    expect((await readdir(workDirectory)).filter((name) => name.includes('mediaeditor-'))).toEqual(
      [],
    );
  });

  it('removes existing artwork on request', async () => {
    const path = await makeMp3('unart.mp3');
    const cover = await prepareCoverFromImage(await makeCoverPng('unart-cover.png'), coverDeps());

    await save({
      sourcePath: path,
      destinationPath: path,
      tags: emptyTagValues(),
      cover: { kind: 'replace', imagePath: cover.path },
    });
    expect((await probeFile(path, deps)).coverStreamIndexes).toHaveLength(1);

    const job = await save({
      sourcePath: path,
      destinationPath: path,
      tags: emptyTagValues(),
      cover: { kind: 'remove' },
    });

    expect(job.status).toBe('done');
    expect((await probeFile(path, deps)).coverStreamIndexes).toEqual([]);
  });

  it('keeps existing artwork when only the tags change', async () => {
    const path = await makeMp3('keepart.mp3');
    const cover = await prepareCoverFromImage(await makeCoverPng('keep-cover.png'), coverDeps());

    await save({
      sourcePath: path,
      destinationPath: path,
      tags: emptyTagValues(),
      cover: { kind: 'replace', imagePath: cover.path },
    });

    const job = await save({
      sourcePath: path,
      destinationPath: path,
      tags: { ...emptyTagValues(), title: 'Later' },
      cover: { kind: 'keep' },
    });

    expect(job.status).toBe('done');
    const after = await probeFile(path, deps);
    // Exactly one picture: keeping must not duplicate the stream.
    expect(after.coverStreamIndexes).toHaveLength(1);
    expect(after.tags.title).toBe('Later');
  });

  it('clears a tag the user emptied', async () => {
    const path = await makeMp3('clearme.mp3');
    await save({
      sourcePath: path,
      destinationPath: path,
      tags: filled,
      cover: { kind: 'keep' },
    });
    expect((await probeFile(path, deps)).tags.artist).toBe(filled.author);

    await save({
      sourcePath: path,
      destinationPath: path,
      tags: { ...filled, author: '' },
      cover: { kind: 'keep' },
    });

    // Not "still Chopin": leaving the key out of the command would have kept it.
    expect(readTagValues((await probeFile(path, deps)).tags).author).toBe('');
  });
});

describe('writing tags to an mp4', () => {
  it('writes the author, keeps the video, and embeds artwork', async () => {
    const path = await makeMp4('tagme.mp4');
    const cover = await prepareCoverFromImage(await makeCoverPng('mp4-cover.png'), coverDeps());

    const job = await save({
      sourcePath: path,
      destinationPath: path,
      tags: { ...filled, title: 'A clip' },
      cover: { kind: 'replace', imagePath: cover.path },
    });

    expect(job.error).toBeNull();
    expect(job.status).toBe('done');

    const after = await probeFile(path, deps);
    expect(after.kind).toBe('video');
    // The footage is still the footage — the cover went in behind it.
    expect(after.video?.width).toBe(320);
    expect(after.coverStreamIndexes).toHaveLength(1);

    const values = readTagValues(after.tags);
    expect(values.author).toBe(filled.author);
    expect(values.title).toBe('A clip');

    // What actually lands, as opposed to what was asked for: the mov muxer has no
    // atom for `author` and drops it, so ©ART carries the value. Asserted so the
    // day ffmpeg starts writing it, this test says so.
    expect(after.tags.artist).toBe(filled.author);
    expect(after.tags.author).toBeUndefined();
  });
});

describe('save as', () => {
  it('writes a copy and leaves the original alone', async () => {
    const source = await makeMp3('original.mp3');
    await save({
      sourcePath: source,
      destinationPath: source,
      tags: { ...emptyTagValues(), title: 'Original' },
      cover: { kind: 'keep' },
    });

    const destination = join(workDirectory, 'copy.mp3');
    const job = await save({
      sourcePath: source,
      destinationPath: destination,
      tags: { ...emptyTagValues(), title: 'Copy' },
      cover: { kind: 'keep' },
    });

    expect(job.status).toBe('done');
    expect(job.outputPath).toBe(destination);
    expect((await probeFile(destination, deps)).tags.title).toBe('Copy');
    expect((await probeFile(source, deps)).tags.title).toBe('Original');
  });
});

describe('a failed save', () => {
  it('leaves the original file exactly as it was, and cleans up after itself', async () => {
    // The guarantee that matters most: an export that fails must not cost the
    // user their file. A cover image ffmpeg cannot decode fails it mid-write.
    const path = await makeMp3('precious.mp3');
    await save({
      sourcePath: path,
      destinationPath: path,
      tags: { ...emptyTagValues(), title: 'Precious' },
      cover: { kind: 'keep' },
    });
    const before = await readFile(path);

    const brokenCover = join(workDirectory, 'not-really.jpg');
    await writeFile(brokenCover, 'this is not an image');

    const job = await save({
      sourcePath: path,
      destinationPath: path,
      tags: { ...emptyTagValues(), title: 'Should not be written' },
      cover: { kind: 'replace', imagePath: brokenCover },
    });

    expect(job.status).toBe('failed');
    // ffmpeg's own complaint is what reaches the user.
    expect(job.log.join('\n')).toMatch(/Invalid data|not-really/i);

    expect(await readFile(path)).toEqual(before);
    expect((await probeFile(path, deps)).tags.title).toBe('Precious');
    expect((await readdir(workDirectory)).filter((name) => name.includes('mediaeditor-'))).toEqual(
      [],
    );
  });

  it('refuses a file it cannot read at all', async () => {
    const path = join(workDirectory, 'garbage.mp3');
    await writeFile(path, 'not an mp3');

    const job = await save({
      sourcePath: path,
      destinationPath: path,
      tags: emptyTagValues(),
      cover: { kind: 'keep' },
    });

    expect(job.status).toBe('failed');
    expect(await readFile(path, 'utf8')).toBe('not an mp3');
  });
});
