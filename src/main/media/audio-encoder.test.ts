import { describe, expect, it } from 'vitest';
import { audioEncoder, containerAudioCodec, isLossless, sampleFormatArgs } from './audio-encoder';

describe('containerAudioCodec', () => {
  it('picks a codec the container can actually hold', () => {
    expect(containerAudioCodec('wav')).toBe('pcm_s16le');
    expect(containerAudioCodec('flac')).toBe('flac');
    expect(containerAudioCodec('mp3')).toBe('libmp3lame');
  });

  it('falls back to a sane default for an unlisted extension', () => {
    expect(containerAudioCodec('unknown')).toBe('aac');
  });
});

describe('audioEncoder', () => {
  it('keeps a PCM source codec, which carries its bit depth', () => {
    expect(audioEncoder('wav', 'pcm_s24le')).toBe('pcm_s24le');
    expect(audioEncoder('wav', 'pcm_f32le')).toBe('pcm_f32le');
  });

  it('uses the container default when the source is not PCM', () => {
    expect(audioEncoder('wav', 'adpcm_ms')).toBe('pcm_s16le');
    expect(audioEncoder('wav', null)).toBe('pcm_s16le');
  });

  it('never carries a PCM codec into a container that does not use one', () => {
    expect(audioEncoder('mp3', 'pcm_s24le')).toBe('libmp3lame');
  });
});

describe('sampleFormatArgs', () => {
  it('asks flac for the source depth on the given stream', () => {
    expect(sampleFormatArgs('flac', 's16', 'a:0')).toEqual(['-sample_fmt:a:0', 's16']);
    expect(sampleFormatArgs('flac', 's32', 'a')).toEqual(['-sample_fmt:a', 's32']);
  });

  it('asks for nothing it cannot keep', () => {
    expect(sampleFormatArgs('flac', 'flt', 'a')).toEqual([]);
    expect(sampleFormatArgs('flac', null, 'a')).toEqual([]);
    expect(sampleFormatArgs('libmp3lame', 's16', 'a')).toEqual([]);
  });
});

describe('isLossless', () => {
  it('knows flac and PCM from lossy codecs', () => {
    expect(isLossless('flac')).toBe(true);
    expect(isLossless('pcm_s24le')).toBe(true);
    expect(isLossless('aac')).toBe(false);
  });
});
