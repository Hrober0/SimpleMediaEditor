import { describe, expect, it } from 'vitest';
import { buildPcmArgs } from './waveform';

describe('buildPcmArgs', () => {
  it('decodes to mono 8kHz raw PCM, audio only', () => {
    const args = buildPcmArgs('in.mp4', 'out.pcm');
    expect(args).toEqual(
      expect.arrayContaining(['-map', '0:a:0?', '-ac', '1', '-ar', '8000', '-f', 's16le', '-vn']),
    );
    expect(args[args.length - 1]).toBe('out.pcm');
  });
});
