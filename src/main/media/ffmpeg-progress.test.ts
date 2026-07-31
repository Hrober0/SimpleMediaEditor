import { describe, expect, it } from 'vitest';
import { parseProgressLine, parseTimestamp, progressFraction } from './ffmpeg-progress';

describe('parseProgressLine', () => {
  it('reads the output position', () => {
    expect(parseProgressLine('out_time=00:01:02.500000')).toEqual({
      outSeconds: 62.5,
      finished: false,
    });
  });

  it('reports the final block', () => {
    expect(parseProgressLine('progress=end')).toEqual({ outSeconds: null, finished: true });
    expect(parseProgressLine('progress=continue')).toBeNull();
  });

  it('ignores the other keys in the block', () => {
    // ffmpeg emits a dozen keys per update; only two of them mean anything here.
    expect(parseProgressLine('bitrate=  192.0kbits/s')).toBeNull();
    expect(parseProgressLine('total_size=1048576')).toBeNull();
    // out_time_ms is deliberately not used: its unit has differed between
    // ffmpeg versions, which would make progress silently wrong.
    expect(parseProgressLine('out_time_ms=62500000')).toBeNull();
  });

  it('ignores a position ffmpeg cannot report yet', () => {
    expect(parseProgressLine('out_time=N/A')).toBeNull();
  });

  it('ignores anything that is not a key=value line', () => {
    expect(parseProgressLine('')).toBeNull();
    expect(parseProgressLine('Press [q] to stop')).toBeNull();
  });
});

describe('parseTimestamp', () => {
  it('reads hours, minutes and fractional seconds', () => {
    expect(parseTimestamp('00:00:00.000000')).toBe(0);
    expect(parseTimestamp('01:02:03.250000')).toBeCloseTo(3723.25);
  });

  it('rejects anything that is not a timestamp', () => {
    expect(parseTimestamp('N/A')).toBeNull();
    expect(parseTimestamp('12')).toBeNull();
    expect(parseTimestamp('00:99:00.0')).toBeNull();
  });
});

describe('progressFraction', () => {
  it('is the position over the duration', () => {
    expect(progressFraction(50, 200)).toBe(0.25);
  });

  it('never exceeds one, even when ffmpeg overshoots the probed duration', () => {
    expect(progressFraction(205, 200)).toBe(1);
  });

  it('is indeterminate when the duration is unknown, rather than a made-up number', () => {
    expect(progressFraction(50, null)).toBeNull();
    expect(progressFraction(50, 0)).toBeNull();
  });
});
