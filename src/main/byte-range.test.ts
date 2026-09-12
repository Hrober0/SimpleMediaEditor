import { describe, expect, it } from 'vitest';
import { parseByteRange } from './byte-range';

const SIZE = 1000;

describe('parseByteRange', () => {
  it('asks for the whole file when no range was sent', () => {
    expect(parseByteRange(null, SIZE)).toEqual({ kind: 'whole-file' });
  });

  it('reads a range with both ends given', () => {
    expect(parseByteRange('bytes=100-199', SIZE)).toEqual({ kind: 'range', start: 100, end: 199 });
  });

  it('runs an open-ended range to the last byte', () => {
    expect(parseByteRange('bytes=100-', SIZE)).toEqual({ kind: 'range', start: 100, end: 999 });
  });

  it('counts a suffix range back from the end', () => {
    expect(parseByteRange('bytes=-200', SIZE)).toEqual({ kind: 'range', start: 800, end: 999 });
  });

  it('clamps a suffix longer than the file to the whole file', () => {
    expect(parseByteRange('bytes=-5000', SIZE)).toEqual({ kind: 'range', start: 0, end: 999 });
  });

  it('clamps an end past the last byte', () => {
    expect(parseByteRange('bytes=900-5000', SIZE)).toEqual({ kind: 'range', start: 900, end: 999 });
  });

  it('accepts a range covering the whole file', () => {
    expect(parseByteRange('bytes=0-999', SIZE)).toEqual({ kind: 'range', start: 0, end: 999 });
  });

  it('accepts a single byte', () => {
    expect(parseByteRange('bytes=0-0', SIZE)).toEqual({ kind: 'range', start: 0, end: 0 });
  });

  it('ignores surrounding whitespace and casing', () => {
    expect(parseByteRange('  BYTES= 100 - 199 ', SIZE)).toEqual({
      kind: 'range',
      start: 100,
      end: 199,
    });
  });

  it('rejects a start at or past the end of the file', () => {
    expect(parseByteRange('bytes=1000-', SIZE)).toEqual({ kind: 'unsatisfiable' });
    expect(parseByteRange('bytes=2000-3000', SIZE)).toEqual({ kind: 'unsatisfiable' });
  });

  it('rejects an end before the start', () => {
    expect(parseByteRange('bytes=200-100', SIZE)).toEqual({ kind: 'unsatisfiable' });
  });

  it('rejects any range into an empty file', () => {
    expect(parseByteRange('bytes=0-', 0)).toEqual({ kind: 'unsatisfiable' });
  });

  it('serves an empty file whole when no range was sent', () => {
    expect(parseByteRange(null, 0)).toEqual({ kind: 'whole-file' });
  });

  it.each([
    ['items=0-99', 'a unit other than bytes'],
    ['bytes=0-99,200-299', 'more than one range'],
    ['bytes=abc', 'no separator'],
    ['bytes=-', 'neither end given'],
    ['bytes=-0', 'a zero-length suffix'],
    ['bytes=x-99', 'a start that is not a number'],
    ['bytes=10-x', 'an end that is not a number'],
    ['bytes=-10.5', 'a fractional suffix'],
    ['', 'an empty header'],
  ])('falls back to the whole file for %s (%s)', (header) => {
    expect(parseByteRange(header, SIZE)).toEqual({ kind: 'whole-file' });
  });
});
