import { describe, expect, it } from 'vitest';
import { emptyTagValues } from '@shared/metadata';
import { buildCoverJpegArgs, buildWriteArgs, type WriteArgsRequest } from './write-args';

const base: WriteArgsRequest = {
  sourcePath: '/music/song.mp3',
  outputPath: '/music/song.mediaeditor-abc.mp3',
  family: 'id3',
  values: { ...emptyTagValues(), title: 'Nocturne', author: 'Chopin' },
  cover: { kind: 'keep' },
  existingCoverStreams: [],
  contentVideoStreams: 0,
};

/** The value that follows a flag, so tests do not depend on argument order. */
function valueOf(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function pairsOf(args: readonly string[], flag: string): string[] {
  return args.flatMap((arg, index) => (arg === flag ? [args[index + 1] ?? ''] : []));
}

describe('buildWriteArgs', () => {
  it('never writes over its input', () => {
    // ffmpeg cannot read and write the same file; the output is always a sibling
    // temp file that the caller moves into place afterwards.
    const args = buildWriteArgs(base);
    expect(valueOf(args, '-i')).toBe('/music/song.mp3');
    expect(args.at(-1)).toBe('/music/song.mediaeditor-abc.mp3');
    expect(args.at(-1)).not.toBe(base.sourcePath);
  });

  it('copies every stream instead of re-encoding', () => {
    // A tag edit that degraded the audio would be a silent quality loss.
    const args = buildWriteArgs(base);
    expect(valueOf(args, '-c')).toBe('copy');
    expect(pairsOf(args, '-map')).toContain('0');
  });

  it('asks for machine-readable progress on stdout, leaving stderr for errors', () => {
    const args = buildWriteArgs(base);
    expect(valueOf(args, '-progress')).toBe('pipe:1');
    expect(args).toContain('-nostats');
  });

  it('writes ID3v2.3 for mp3, which older players and Explorer actually read', () => {
    expect(valueOf(buildWriteArgs(base), '-id3v2_version')).toBe('3');
    expect(buildWriteArgs({ ...base, family: 'mp4' })).not.toContain('-id3v2_version');
  });

  it('leaves existing artwork alone when keeping it', () => {
    const args = buildWriteArgs({ ...base, existingCoverStreams: [1] });
    expect(pairsOf(args, '-map')).toEqual(['0']);
    expect(args).not.toContain('attached_pic');
  });

  it('drops the old picture streams when removing artwork', () => {
    const args = buildWriteArgs({
      ...base,
      cover: { kind: 'remove' },
      existingCoverStreams: [1, 2],
    });
    expect(pairsOf(args, '-map')).toEqual(['0', '-0:1', '-0:2']);
    expect(args).not.toContain('attached_pic');
  });

  it('replaces artwork by dropping the old stream and adding the new image', () => {
    // Keeping both would leave two attached pictures, and players show whichever
    // they meet first.
    const args = buildWriteArgs({
      ...base,
      cover: { kind: 'replace', imagePath: '/tmp/covers/cover-1.jpg' },
      existingCoverStreams: [1],
    });

    expect(pairsOf(args, '-i')).toEqual(['/music/song.mp3', '/tmp/covers/cover-1.jpg']);
    expect(pairsOf(args, '-map')).toEqual(['0', '-0:1', '1:v:0']);
    expect(valueOf(args, '-disposition:v:0')).toBe('attached_pic');
  });

  it('puts the cover behind the real video stream on a video file', () => {
    const args = buildWriteArgs({
      ...base,
      sourcePath: '/videos/clip.mp4',
      outputPath: '/videos/clip.mediaeditor-abc.mp4',
      family: 'mp4',
      cover: { kind: 'replace', imagePath: '/tmp/covers/cover-1.jpg' },
      contentVideoStreams: 1,
    });
    // v:0 is the footage; marking that as attached_pic would break the video.
    expect(valueOf(args, '-disposition:v:1')).toBe('attached_pic');
    expect(args).not.toContain('-disposition:v:0');
  });

  it('marks the picture as a front cover, not as a generic image', () => {
    const args = buildWriteArgs({
      ...base,
      cover: { kind: 'replace', imagePath: '/tmp/covers/cover-1.jpg' },
    });
    // ID3 takes the picture type from the stream comment; without it some players
    // file the image as "other" and never show it.
    expect(args).toContain('comment=Cover (front)');
    expect(args).toContain('title=Album cover');
  });

  it('carries the tag values through', () => {
    const args = buildWriteArgs(base);
    expect(args).toContain('title=Nocturne');
    expect(args).toContain('artist=Chopin');
  });
});

describe('buildCoverJpegArgs', () => {
  it('re-encodes to a baseline JPEG, never larger than the source', () => {
    const args = buildCoverJpegArgs({ inputPath: '/pics/art.png', outputPath: '/tmp/c.jpg' });

    expect(valueOf(args, '-c:v')).toBe('mjpeg');
    // Progressive JPEG and PNG are what some ID3 readers silently ignore.
    expect(valueOf(args, '-pix_fmt')).toBe('yuvj420p');
    expect(valueOf(args, '-vf')).toContain('force_original_aspect_ratio=decrease');
    expect(valueOf(args, '-vf')).toContain("'min(1000,iw)'");
  });

  it('takes a single frame, so an animation or a video is one image', () => {
    const args = buildCoverJpegArgs({ inputPath: '/pics/art.gif', outputPath: '/tmp/c.jpg' });
    expect(valueOf(args, '-frames:v')).toBe('1');
    expect(valueOf(args, '-update')).toBe('1');
  });

  it('seeks before the input when grabbing a frame, so it does not decode up to it', () => {
    const args = buildCoverJpegArgs({
      inputPath: '/videos/clip.mp4',
      outputPath: '/tmp/c.jpg',
      seekSeconds: 12.5,
    });
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
    expect(valueOf(args, '-ss')).toBe('12.500');
  });

  it('maps the picture stream when pulling artwork out of a file', () => {
    const args = buildCoverJpegArgs({
      inputPath: '/music/song.mp3',
      outputPath: '/tmp/c.jpg',
      streamIndex: 1,
    });
    expect(valueOf(args, '-map')).toBe('0:1');
  });
});
