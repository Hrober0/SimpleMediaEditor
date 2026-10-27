import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MediaInfo } from '@shared/metadata';
import { describeOutputMismatch, fileExists, replaceFile, tempOutputPath } from './safe-write';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mediaeditor-safe-write-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('tempOutputPath', () => {
  it('keeps the extension, which is how ffmpeg picks its muxer', () => {
    // A ".tmp" name would make ffmpeg guess, and it would guess wrong.
    const temp = tempOutputPath('/music/song.mp3', 'abc123');
    expect(extname(temp)).toBe('.mp3');
    expect(basename(temp)).toBe('song.mediaeditor-abc123.mp3');
  });

  it('stays in the destination directory, so the final move cannot cross a filesystem', () => {
    // Compared through resolve, since join uses the platform separator.
    const destination = resolve('/music/song.mp3');
    expect(dirname(tempOutputPath(destination, 'abc'))).toBe(dirname(destination));
  });

  it('is distinct per token, so two jobs on one file cannot collide', () => {
    expect(tempOutputPath('/music/song.mp3', 'a')).not.toBe(tempOutputPath('/music/song.mp3', 'b'));
  });
});

describe('replaceFile', () => {
  it('moves the new file into place and leaves nothing behind', async () => {
    const target = join(directory, 'song.mp3');
    const temp = tempOutputPath(target, 'abc');
    await writeFile(target, 'old');
    await writeFile(temp, 'new');

    await replaceFile(temp, target, 'abc');

    expect(await readFile(target, 'utf8')).toBe('new');
    expect(await readdir(directory)).toEqual(['song.mp3']);
  });

  it('works when the destination does not exist yet, as with Save As', async () => {
    const target = join(directory, 'copy.mp3');
    const temp = tempOutputPath(target, 'abc');
    await writeFile(temp, 'new');

    await replaceFile(temp, target, 'abc');

    expect(await readFile(target, 'utf8')).toBe('new');
    expect(await readdir(directory)).toEqual(['copy.mp3']);
  });

  it('leaves the original in place when there is no new file to swap in', async () => {
    // The failure that must never destroy a file: the write went wrong, so the
    // rename has nothing to move.
    const target = join(directory, 'song.mp3');
    await writeFile(target, 'original');

    await expect(replaceFile(tempOutputPath(target, 'abc'), target, 'abc')).rejects.toThrow();

    expect(await readFile(target, 'utf8')).toBe('original');
    expect(await readdir(directory)).toEqual(['song.mp3']);
  });
});

describe('fileExists', () => {
  it('is false for a missing path and for a directory', async () => {
    expect(await fileExists(join(directory, 'nothing.mp3'))).toBe(false);
    expect(await fileExists(directory)).toBe(false);
  });

  it('is true for a file', async () => {
    const path = join(directory, 'song.mp3');
    await writeFile(path, 'x');
    expect(await fileExists(path)).toBe(true);
  });
});

function info(overrides: Partial<MediaInfo>): MediaInfo {
  return {
    path: '/music/song.mp3',
    fileName: 'song.mp3',
    byteSize: 1000,
    ext: 'mp3',
    containerLabel: 'mp3',
    kind: 'audio',
    durationSeconds: 200,
    bitrate: 192_000,
    audio: {
      codec: 'mp3',
      width: null,
      height: null,
      channels: 2,
      sampleRate: 44_100,
      bitrate: 192_000,
      sampleFormat: 'flt',
    },
    video: null,
    coverStreamIndexes: [],
    tags: {},
    ...overrides,
  };
}

describe('describeOutputMismatch', () => {
  it('accepts an output that matches the input', () => {
    expect(describeOutputMismatch(info({}), info({ byteSize: 1200 }))).toBeNull();
  });

  it('accepts the rounding a container introduces', () => {
    expect(describeOutputMismatch(info({}), info({ durationSeconds: 200.4 }))).toBeNull();
  });

  it('rejects an output that lost the audio', () => {
    // A stream copy that dropped a stream means the file is not what was asked
    // for, and the original must stay untouched.
    expect(describeOutputMismatch(info({}), info({ audio: null }))).toContain('audio');
  });

  it('rejects an output that lost the video', () => {
    const video = {
      codec: 'h264',
      width: 1920,
      height: 1080,
      channels: null,
      sampleRate: null,
      bitrate: null,
      sampleFormat: null,
    };
    const source = info({ kind: 'video', video });
    expect(describeOutputMismatch(source, info({ kind: 'video', video: null }))).toContain('video');
  });

  it('rejects an output of the wrong length', () => {
    expect(describeOutputMismatch(info({}), info({ durationSeconds: 12 }))).toContain('12.0s');
  });

  it('rejects an empty output', () => {
    expect(describeOutputMismatch(info({}), info({ byteSize: 0 }))).toContain('empty');
  });

  it('does not fail a file whose duration is unknown', () => {
    expect(describeOutputMismatch(info({ durationSeconds: null }), info({}))).toBeNull();
    expect(describeOutputMismatch(info({}), info({ durationSeconds: null }))).toBeNull();
  });
});
