import { describe, expect, it } from 'vitest';
import { downsamplePcm } from './waveform';

describe('downsamplePcm', () => {
  it('reports the full-scale swing of a square wave', () => {
    const samples = Int16Array.from([32767, -32768, 32767, -32768]);
    expect(downsamplePcm(samples, 1, 1)).toEqual([-1, 32767 / 32768]);
  });

  it('averages channels into one waveform', () => {
    // Left at max, right at zero: the reported peak is the average, not either channel alone.
    const samples = Int16Array.from([32767, 0]);
    expect(downsamplePcm(samples, 2, 1)).toEqual([32767 / 2 / 32768, 32767 / 2 / 32768]);
  });

  it('produces one min/max pair per bucket', () => {
    const samples = Int16Array.from([1000, -1000, 2000, -2000]);
    const peaks = downsamplePcm(samples, 1, 2);
    expect(peaks).toHaveLength(4);
    expect(peaks[0]).toBeCloseTo(-1000 / 32768);
    expect(peaks[1]).toBeCloseTo(1000 / 32768);
    expect(peaks[2]).toBeCloseTo(-2000 / 32768);
    expect(peaks[3]).toBeCloseTo(2000 / 32768);
  });

  it('returns an empty array for no samples', () => {
    expect(downsamplePcm(new Int16Array(0), 1, 10)).toEqual([]);
  });

  it('returns an empty array when no buckets were asked for', () => {
    expect(downsamplePcm(Int16Array.from([1, 2, 3]), 1, 0)).toEqual([]);
  });

  it('never divides by a zero channel count', () => {
    expect(downsamplePcm(Int16Array.from([1, 2, 3]), 0, 10)).toEqual([]);
  });
});
