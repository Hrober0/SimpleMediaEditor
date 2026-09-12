import { describe, expect, it } from 'vitest';
import { emptyTagValues } from '@shared/metadata';
import {
  buildConcatArgs,
  buildConcatListContent,
  buildFastSegmentArgs,
  buildPreciseTrimArgs,
  preciseAudioCodec,
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
  it('lists each segment on its own quoted line', () => {
    expect(buildConcatListContent(['/tmp/a.mp3', '/tmp/b.mp3'])).toBe(
      "file '/tmp/a.mp3'\nfile '/tmp/b.mp3'\n",
    );
  });

  it('escapes a single quote in a path', () => {
    expect(buildConcatListContent(["/tmp/it's mine.mp3"])).toBe("file '/tmp/it'\\''s mine.mp3'\n");
  });

  it('escapes a backslash in a Windows path', () => {
    expect(buildConcatListContent(['C:\\Users\\a.mp3'])).toBe("file 'C:\\\\Users\\\\a.mp3'\n");
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
  it('builds one trim/atrim pair per range plus a single concat', () => {
    const args = buildPreciseTrimArgs({
      sourcePath: 'in.mp3',
      outputPath: 'out.mp3',
      ranges: [
        { startSeconds: 0, endSeconds: 5 },
        { startSeconds: 10, endSeconds: 12 },
      ],
      hasAudio: true,
      hasVideo: false,
      ext: 'mp3',
    });

    const filterIndex = args.indexOf('-filter_complex');
    const filter = args[filterIndex + 1];
    expect(filter).toBe(
      '[0:a:0]atrim=start=0.000:end=5.000,asetpts=PTS-STARTPTS[a0];' +
        '[0:a:0]atrim=start=10.000:end=12.000,asetpts=PTS-STARTPTS[a1];' +
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
    });
    expect(args).toEqual(expect.arrayContaining(['-map_metadata', '0']));
  });
});

describe('preciseAudioCodec / preciseVideoCodec', () => {
  it('picks a codec the container can actually hold', () => {
    expect(preciseAudioCodec('wav')).toBe('pcm_s16le');
    expect(preciseAudioCodec('flac')).toBe('flac');
    expect(preciseVideoCodec('webm')).toBe('libvpx-vp9');
  });

  it('falls back to a sane default for an unlisted extension', () => {
    expect(preciseAudioCodec('unknown')).toBe('aac');
    expect(preciseVideoCodec('unknown')).toBe('libx264');
  });
});
