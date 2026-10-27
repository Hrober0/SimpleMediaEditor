import { describe, expect, it } from 'vitest';
import { describeLoudnessChange, parseLoudnormStats, type LoudnormStats } from './loudnorm-stats';

/** The tail of a real ffmpeg 7.1 run, as the spawn wrapper splits it into lines. */
const MEASURE_OUTPUT = [
  "Output #0, null, to 'pipe:':",
  'size=N/A time=00:00:03.00 bitrate=N/A speed= 120x',
  '[Parsed_loudnorm_0 @ 000001d2c3a4b5c0] ',
  '{',
  '\t"input_i" : "-27.61",',
  '\t"input_tp" : "-4.47",',
  '\t"input_lra" : "18.06",',
  '\t"input_thresh" : "-39.20",',
  '\t"output_i" : "-16.58",',
  '\t"output_tp" : "-1.50",',
  '\t"output_lra" : "14.78",',
  '\t"output_thresh" : "-27.71",',
  '\t"normalization_type" : "dynamic",',
  '\t"target_offset" : "0.58"',
  '}',
];

function stats(overrides: Partial<LoudnormStats> = {}): LoudnormStats {
  return {
    inputIntegrated: -21.34,
    inputTruePeak: -3,
    inputRange: 6,
    inputThreshold: -31,
    outputIntegrated: -14.02,
    outputTruePeak: -1.6,
    targetOffset: 0,
    normalizationType: 'linear',
    ...overrides,
  };
}

describe('parseLoudnormStats', () => {
  it('reads the JSON block loudnorm prints at the end', () => {
    expect(parseLoudnormStats(MEASURE_OUTPUT)).toEqual({
      inputIntegrated: -27.61,
      inputTruePeak: -4.47,
      inputRange: 18.06,
      inputThreshold: -39.2,
      outputIntegrated: -16.58,
      outputTruePeak: -1.5,
      targetOffset: 0.58,
      normalizationType: 'dynamic',
    });
  });

  it('reads silence as minus infinity rather than failing', () => {
    const silent = MEASURE_OUTPUT.map((line) =>
      line.includes('"input_i"') ? '\t"input_i" : "-inf",' : line,
    );
    expect(parseLoudnormStats(silent)?.inputIntegrated).toBe(Number.NEGATIVE_INFINITY);
  });

  it('returns null when there is no block', () => {
    expect(parseLoudnormStats(['Conversion failed!'])).toBeNull();
  });

  it('returns null when a value is missing', () => {
    const lines = MEASURE_OUTPUT.filter((line) => !line.includes('"input_tp"'));
    expect(parseLoudnormStats(lines)).toBeNull();
  });

  it('returns null when the block is cut off', () => {
    expect(parseLoudnormStats(MEASURE_OUTPUT.slice(0, -1))).toBeNull();
  });
});

describe('describeLoudnessChange', () => {
  it('names the level before and after', () => {
    expect(describeLoudnessChange(stats(), stats())).toBe('Was -21.3 LUFS, now -14.0 LUFS');
  });

  it('says so when loudnorm had to compress', () => {
    expect(describeLoudnessChange(stats(), stats({ normalizationType: 'dynamic' }))).toBe(
      'Was -21.3 LUFS, now -14.0 LUFS, compressed to fit the peak limit',
    );
  });

  it('still reports the starting level when the second pass printed nothing', () => {
    expect(describeLoudnessChange(stats(), null)).toBe('Was -21.3 LUFS, now normalized');
  });
});
