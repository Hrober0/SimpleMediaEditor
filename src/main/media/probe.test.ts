import { describe, expect, it } from 'vitest';
import { AppFailure } from '../errors';
import { buildProbeArgs, parseProbeOutput } from './probe';

/** An mp3 with an embedded cover, which ffprobe reports as a second stream. */
const TAGGED_MP3 = JSON.stringify({
  streams: [
    {
      index: 0,
      codec_type: 'audio',
      codec_name: 'mp3',
      channels: 2,
      sample_rate: '44100',
      sample_fmt: 'fltp',
      bit_rate: '192000',
      disposition: { attached_pic: 0 },
    },
    {
      index: 1,
      codec_type: 'video',
      codec_name: 'mjpeg',
      width: 640,
      height: 640,
      disposition: { attached_pic: 1 },
    },
  ],
  format: {
    format_name: 'mp3',
    format_long_name: 'MP2/3 (MPEG audio layer 2/3)',
    duration: '215.360000',
    size: '5170000',
    bit_rate: '192000',
    tags: { title: 'Nocturne', ARTIST: 'Chopin', track: 3 },
  },
});

describe('buildProbeArgs', () => {
  it('asks for JSON about the format and every stream', () => {
    const args = buildProbeArgs('/music/song.mp3');
    expect(args).toContain('-show_format');
    expect(args).toContain('-show_streams');
    expect(args[args.indexOf('-print_format') + 1]).toBe('json');
  });

  it('passes the path as an input, so a name starting with - is not read as a flag', () => {
    const args = buildProbeArgs('-strange name.mp3');
    expect(args.at(-2)).toBe('-i');
    expect(args.at(-1)).toBe('-strange name.mp3');
  });
});

describe('parseProbeOutput', () => {
  it('normalizes an mp3 with cover art', () => {
    const info = parseProbeOutput(TAGGED_MP3, '/music/song.mp3');

    expect(info.fileName).toBe('song.mp3');
    expect(info.ext).toBe('mp3');
    expect(info.kind).toBe('audio');
    expect(info.durationSeconds).toBeCloseTo(215.36);
    expect(info.byteSize).toBe(5_170_000);
    expect(info.bitrate).toBe(192_000);
    expect(info.audio?.codec).toBe('mp3');
    expect(info.audio?.channels).toBe(2);
    expect(info.audio?.sampleRate).toBe(44_100);
    expect(info.audio?.bitrate).toBe(192_000);
    // Planar is a memory layout, not a depth, so it is reported without the "p".
    expect(info.audio?.sampleFormat).toBe('flt');
  });

  it('does not mistake embedded artwork for a video stream', () => {
    // ffprobe reports cover art as a video stream; only the disposition tells
    // them apart, and getting it wrong would label an mp3 as a video.
    const info = parseProbeOutput(TAGGED_MP3, '/music/song.mp3');
    expect(info.video).toBeNull();
    expect(info.coverStreamIndexes).toEqual([1]);
    expect(info.kind).toBe('audio');
  });

  it('lowercases tag keys, which differ in case per container', () => {
    // FLAC reports ARTIST, mp3 reports artist.
    const info = parseProbeOutput(TAGGED_MP3, '/music/song.mp3');
    expect(info.tags.artist).toBe('Chopin');
    expect(info.tags.track).toBe('3');
  });

  it('reads a video file as video, with its resolution', () => {
    const json = JSON.stringify({
      streams: [
        { index: 0, codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080 },
        { index: 1, codec_type: 'audio', codec_name: 'aac', channels: 2 },
      ],
      format: { format_name: 'mov,mp4', duration: '60.0', size: '1000' },
    });

    const info = parseProbeOutput(json, '/videos/clip.mp4');
    expect(info.kind).toBe('video');
    expect(info.video?.width).toBe(1920);
    expect(info.video?.height).toBe(1080);
    expect(info.coverStreamIndexes).toEqual([]);
  });

  it('treats an mp4 with no video as audio, which decides the Artist/Author label', () => {
    const json = JSON.stringify({
      streams: [{ index: 0, codec_type: 'audio', codec_name: 'aac' }],
      format: { format_name: 'mov,mp4', size: '1000' },
    });
    expect(parseProbeOutput(json, '/music/song.m4a').kind).toBe('audio');
  });

  it('copes with the fields ffprobe leaves out', () => {
    const json = JSON.stringify({
      streams: [{ index: 0, codec_type: 'audio', codec_name: 'flac' }],
      format: { format_name: 'flac' },
    });

    const info = parseProbeOutput(json, '/music/song.flac');
    expect(info.durationSeconds).toBeNull();
    expect(info.bitrate).toBeNull();
    expect(info.byteSize).toBe(0);
    expect(info.tags).toEqual({});
  });

  it('rejects a file with nothing playable in it', () => {
    const json = JSON.stringify({ streams: [], format: { format_name: 'jpeg_pipe' } });
    expect(() => parseProbeOutput(json, '/pics/art.jpg')).toThrow(AppFailure);
  });

  it('reports unreadable output rather than throwing a parse error', () => {
    expect(() => parseProbeOutput('not json', '/music/song.mp3')).toThrow(AppFailure);
  });
});
