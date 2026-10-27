import { describe, expect, it } from 'vitest';
import { emptyTagValues } from '@shared/metadata';
import {
  buildConcatArgs,
  buildConcatListContent,
  buildFastSegmentArgs,
  buildPreciseTrimArgs,
  preciseVideoCodec,
} from './trim-args';

describe('buildFastSegmentArgs', () => {
  it('seeks before the input and cuts by duration, not by end time', () => {
    const args = buildFastSegmentArgs({
      sourcePath: 'in.mp3',
      outputPath: 'out.mp3',
      range: { startSeconds: 10, endSeconds: 25 },
      hasAudio: true,
      hasVideo: false,
    });

    expect(args.slice(0, 5)).toEqual(['-hide_banner', '-nostdin', '-y', '-ss', '10.000']);
    expect(args).toContain('-i');
    expect(args[args.indexOf('-i') + 1]).toBe('in.mp3');
    expect(args).toContain('-t');
    expect(args[args.indexOf('-t') + 1]).toBe('15.000');
  });

  it('maps only real video and real audio, never an attached picture', () => {
    const args = buildFastSegmentArgs({
      sourcePath: 'in.mp4',
      outputPath: 'out.mp4',
      range: { startSeconds: 0, endSeconds: 1 },
      hasAudio: true,
      hasVideo: true,
    });

    expect(args).toEqual(
      expect.arrayContaining(['-map', '0:V:0?', '-map', '0:a:0?', '-c', 'copy']),
    );
  });

  it('omits the audio map for a video-only range', () => {
    const args = buildFastSegmentArgs({
      sourcePath: 'in.mp4',
      outputPath: 'out.mp4',
      range: { startSeconds: 0, endSeconds: 1 },
      hasAudio: false,
      hasVideo: true,
    });

    expect(args).not.toContain('0:a:0?');
  });

  it('carries container tags through with -map_metadata 0', () => {
    const args = buildFastSegmentArgs({
      sourcePath: 'in.mp3',
      outputPath: 'out.mp3',
      range: { startSeconds: 0, endSeconds: 1 },
      hasAudio: true,
      hasVideo: false,
    });
    expect(args).toEqual(expect.arrayContaining(['-map_metadata', '0']));
  });

  it('writes tags explicitly when given, for a final (single-range) output', () => {
    const args = buildFastSegmentArgs({
      sourcePath: 'in.mp3',
      outputPath: 'out.mp3',
      range: { startSeconds: 0, endSeconds: 1 },
      hasAudio: true,
      hasVideo: false,
      metadata: { values: { ...emptyTagValues(), author: 'Kept Artist' }, family: 'id3' },
    });
    expect(args).toEqual(expect.arrayContaining(['-metadata', 'artist=Kept Artist']));
  });
});

describe('buildConcatListContent', () => {
  const part = (path: string): { path: string; durationSeconds: number } => ({
    path,
    durationSeconds: 2,
  });

  it('lists each segment with the point it should end at', () => {
    expect(
      buildConcatListContent([
        { path: '/tmp/a.mp3', durationSeconds: 2 },
        { path: '/tmp/b.mp3', durationSeconds: 1.5 },
      ]),
    ).toBe("file '/tmp/a.mp3'\noutpoint 2.000000\nfile '/tmp/b.mp3'\noutpoint 1.500000\n");
  });

  it('escapes a single quote in a path', () => {
    expect(buildConcatListContent([part("/tmp/it's mine.mp3")])).toContain(
      "file '/tmp/it'\\''s mine.mp3'\n",
    );
  });

  it('escapes a backslash in a Windows path', () => {
    expect(buildConcatListContent([part('C:\\Users\\a.mp3')])).toContain(
      "file 'C:\\\\Users\\\\a.mp3'\n",
    );
  });
});

describe('buildConcatArgs', () => {
  it('stream-copies the concat list into one output', () => {
    const args = buildConcatArgs({ listPath: 'list.txt', outputPath: 'out.mp3' });
    expect(args).toEqual(
      expect.arrayContaining(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy']),
    );
  });

  it('writes tags explicitly, since the concat demuxer does not forward an mp3’s ID3 tags through -map_metadata', () => {
    const args = buildConcatArgs({
      listPath: 'list.txt',
      outputPath: 'out.mp3',
      metadata: { values: { ...emptyTagValues(), title: 'Kept Title' }, family: 'id3' },
    });
    expect(args).toEqual(expect.arrayContaining(['-metadata', 'title=Kept Title']));
  });
});

describe('buildPreciseTrimArgs', () => {
  it('opens each range as its own seeked input, joined in play order by one concat', () => {
    const args = buildPreciseTrimArgs({
      sourcePath: 'in.mp3',
      outputPath: 'out.mp3',
      ranges: [
        { startSeconds: 10, endSeconds: 12 },
        { startSeconds: 0, endSeconds: 5 },
      ],
      hasAudio: true,
      hasVideo: false,
      ext: 'mp3',
      sourceAudio: null,
    });

    const filterIndex = args.indexOf('-filter_complex');
    expect(args.slice(3, filterIndex)).toEqual([
      '-ss',
      '10.000',
      '-t',
      '2.000',
      '-i',
      'in.mp3',
      '-ss',
      '0.000',
      '-t',
      '5.000',
      '-i',
      'in.mp3',
    ]);
    expect(args[filterIndex + 1]).toBe(
      '[0:a:0]asetpts=PTS-STARTPTS[a0];' +
        '[1:a:0]asetpts=PTS-STARTPTS[a1];' +
        '[a0][a1]concat=n=2:v=0:a=1[outa]',
    );
    expect(args).toEqual(expect.arrayContaining(['-map', '[outa]', '-c:a', 'libmp3lame']));
    expect(args).not.toContain('[outv]');
  });

  it('carries both streams through for a video source', () => {
    const args = buildPreciseTrimArgs({
      sourcePath: 'in.mp4',
      outputPath: 'out.mp4',
      ranges: [{ startSeconds: 1, endSeconds: 2 }],
      hasAudio: true,
      hasVideo: true,
      ext: 'mp4',
      sourceAudio: null,
    });

    expect(args).toEqual(
      expect.arrayContaining([
        '-map',
        '[outv]',
        '-c:v',
        'libx264',
        '-map',
        '[outa]',
        '-c:a',
        'aac',
      ]),
    );
  });

  it('keeps container tags with -map_metadata 0', () => {
    const args = buildPreciseTrimArgs({
      sourcePath: 'in.mp3',
      outputPath: 'out.mp3',
      ranges: [{ startSeconds: 0, endSeconds: 1 }],
      hasAudio: true,
      hasVideo: false,
      ext: 'mp3',
      sourceAudio: null,
    });
    expect(args).toEqual(expect.arrayContaining(['-map_metadata', '0']));
  });

  it('keeps the bit depth of a 24-bit WAV instead of cutting it to 16', () => {
    const args = buildPreciseTrimArgs({
      sourcePath: 'in.wav',
      outputPath: 'out.wav',
      ranges: [{ startSeconds: 0, endSeconds: 1 }],
      hasAudio: true,
      hasVideo: false,
      ext: 'wav',
      sourceAudio: {
        codec: 'pcm_s24le',
        width: null,
        height: null,
        channels: 2,
        sampleRate: 48_000,
        bitrate: 2_304_000,
        sampleFormat: 's32',
      },
    });
    expect(args).toEqual(expect.arrayContaining(['-c:a', 'pcm_s24le']));
  });
});

describe('preciseVideoCodec', () => {
  it('picks a codec the container can actually hold', () => {
    expect(preciseVideoCodec('webm')).toBe('libvpx-vp9');
  });

  it('falls back to a sane default for an unlisted extension', () => {
    expect(preciseVideoCodec('unknown')).toBe('libx264');
  });
});
