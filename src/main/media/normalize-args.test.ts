import { describe, expect, it } from 'vitest';
import type { StreamSummary } from '@shared/metadata';
import type { LoudnormStats } from './loudnorm-stats';
import {
  buildApplyArgs,
  buildMeasureArgs,
  loudnormFilter,
  type ApplyRequest,
} from './normalize-args';

const measured: LoudnormStats = {
  inputIntegrated: -27.614,
  inputTruePeak: -4.47,
  inputRange: 18.06,
  inputThreshold: -39.2,
  outputIntegrated: -16.58,
  outputTruePeak: -1.5,
  targetOffset: 0.58,
  normalizationType: 'dynamic',
};

/** The value following a flag, so a test does not depend on argument order. */
function valueAfter(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

describe('loudnormFilter', () => {
  it('only names the target for the measuring pass', () => {
    expect(loudnormFilter(-14, null)).toBe('loudnorm=I=-14:TP=-1.5:LRA=20:print_format=json');
  });

  it('feeds the measurements back for the second pass, in linear mode', () => {
    expect(loudnormFilter(-23, measured)).toBe(
      'loudnorm=I=-23:TP=-1.5:LRA=20:measured_I=-27.61:measured_TP=-4.47:measured_LRA=18.06:measured_thresh=-39.20:offset=0.58:linear=true:print_format=json',
    );
  });

  it('keeps measurements inside the ranges loudnorm accepts', () => {
    const filter = loudnormFilter(-14, { ...measured, inputThreshold: -120, inputTruePeak: 3 });
    expect(filter).toContain('measured_thresh=-99.00');
    expect(filter).toContain('measured_TP=3.00');
  });
});

describe('buildMeasureArgs', () => {
  const args = buildMeasureArgs('/music/song.mp3', -14);

  it('reads the first audio stream into the null muxer', () => {
    expect(valueAfter(args, '-i')).toBe('/music/song.mp3');
    expect(valueAfter(args, '-map')).toBe('0:a:0');
    expect(valueAfter(args, '-f')).toBe('null');
    expect(args.at(-1)).toBe('-');
  });

  it('reports progress on stdout, leaving stderr for the measurement', () => {
    expect(valueAfter(args, '-progress')).toBe('pipe:1');
  });
});

describe('buildApplyArgs', () => {
  const mp3Audio: StreamSummary = {
    codec: 'mp3',
    width: null,
    height: null,
    channels: 2,
    sampleRate: 44_100,
    bitrate: 320_000,
    sampleFormat: 'flt',
  };

  function applyArgs(overrides: Partial<ApplyRequest> = {}, audio: Partial<StreamSummary> = {}) {
    return buildApplyArgs({
      sourcePath: '/music/song.mp3',
      outputPath: '/music/song.mediaeditor-abc.mp3',
      targetLufs: -14,
      measured,
      ext: 'mp3',
      family: 'id3',
      ...overrides,
      sourceAudio: { ...mp3Audio, ...audio },
    });
  }

  it('copies every stream and re-encodes only the first audio one', () => {
    const args = applyArgs();
    expect(valueAfter(args, '-map')).toBe('0');
    expect(valueAfter(args, '-c')).toBe('copy');
    expect(valueAfter(args, '-c:a:0')).toBe('libmp3lame');
    expect(valueAfter(args, '-filter:a:0')).toContain('measured_I=-27.61');
    expect(args.at(-1)).toBe('/music/song.mediaeditor-abc.mp3');
  });

  it('keeps the source sample rate, which loudnorm would raise to 192 kHz', () => {
    expect(valueAfter(applyArgs(), '-ar:a:0')).toBe('44100');
    expect(valueAfter(applyArgs({}, { sampleRate: null }), '-ar:a:0')).toBe('48000');
  });

  it('keeps the source bitrate within what the encoders accept', () => {
    expect(valueAfter(applyArgs(), '-b:a:0')).toBe('320k');
    expect(valueAfter(applyArgs({}, { bitrate: 1_411_000 }), '-b:a:0')).toBe('320k');
    expect(valueAfter(applyArgs({}, { bitrate: null }), '-b:a:0')).toBe('192k');
  });

  it('asks a lossy encoder for no particular sample format', () => {
    expect(applyArgs()).not.toContain('-sample_fmt:a:0');
  });

  it('keeps the bit depth of a WAV by reusing its PCM codec', () => {
    const wav = { ext: 'wav', family: 'riff' as const };
    expect(valueAfter(applyArgs(wav, { codec: 'pcm_s24le' }), '-c:a:0')).toBe('pcm_s24le');
    expect(valueAfter(applyArgs(wav, { codec: 'pcm_f32le' }), '-c:a:0')).toBe('pcm_f32le');
    expect(applyArgs(wav, { codec: 'pcm_s24le' })).not.toContain('-b:a:0');
  });

  it('falls back to 16-bit PCM for a WAV that does not hold PCM', () => {
    const args = applyArgs({ ext: 'wav', family: 'riff' }, { codec: 'adpcm_ms' });
    expect(valueAfter(args, '-c:a:0')).toBe('pcm_s16le');
  });

  it('keeps the bit depth of a FLAC, and sets no bitrate', () => {
    const flac = { ext: 'flac', family: 'vorbis' as const };
    const sixteen = applyArgs(flac, { codec: 'flac', sampleFormat: 's16' });
    expect(valueAfter(sixteen, '-c:a:0')).toBe('flac');
    expect(valueAfter(sixteen, '-sample_fmt:a:0')).toBe('s16');
    expect(sixteen).not.toContain('-b:a:0');
    const deep = applyArgs(flac, { codec: 'flac', sampleFormat: 's32' });
    expect(valueAfter(deep, '-sample_fmt:a:0')).toBe('s32');
  });

  it('keeps tags, and writes ID3v2.3 for mp3', () => {
    const args = applyArgs();
    expect(valueAfter(args, '-map_metadata')).toBe('0');
    expect(valueAfter(args, '-id3v2_version')).toBe('3');
  });

  it('encodes AAC into an mp4 and leaves its video alone', () => {
    const args = applyArgs({ ext: 'mp4', family: 'mp4' }, { codec: 'aac' });
    expect(valueAfter(args, '-c:a:0')).toBe('aac');
    expect(args).not.toContain('-c:v');
  });
});
