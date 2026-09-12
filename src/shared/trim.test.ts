import { describe, expect, it } from 'vitest';
import {
  cutRange,
  displayToOriginalSeconds,
  nextKeptStart,
  originalToDisplaySeconds,
  sanitizeKeepRanges,
  totalKeptSeconds,
} from './trim';

describe('sanitizeKeepRanges', () => {
  it('sorts ranges given out of order', () => {
    expect(
      sanitizeKeepRanges(
        [
          { startSeconds: 10, endSeconds: 20 },
          { startSeconds: 0, endSeconds: 5 },
        ],
        30,
      ),
    ).toEqual([
      { startSeconds: 0, endSeconds: 5 },
      { startSeconds: 10, endSeconds: 20 },
    ]);
  });

  it('clamps a range that reaches past the file duration', () => {
    expect(sanitizeKeepRanges([{ startSeconds: 5, endSeconds: 100 }], 30)).toEqual([
      { startSeconds: 5, endSeconds: 30 },
    ]);
  });

  it('clamps a negative start to zero', () => {
    expect(sanitizeKeepRanges([{ startSeconds: -5, endSeconds: 10 }], 30)).toEqual([
      { startSeconds: 0, endSeconds: 10 },
    ]);
  });

  it('drops a range too short to be an intended cut', () => {
    expect(sanitizeKeepRanges([{ startSeconds: 5, endSeconds: 5.001 }], 30)).toEqual([]);
  });

  it('merges two ranges that overlap', () => {
    expect(
      sanitizeKeepRanges(
        [
          { startSeconds: 0, endSeconds: 10 },
          { startSeconds: 5, endSeconds: 15 },
        ],
        30,
      ),
    ).toEqual([{ startSeconds: 0, endSeconds: 15 }]);
  });

  it('merges two ranges that only touch, so no zero-length gap survives', () => {
    expect(
      sanitizeKeepRanges(
        [
          { startSeconds: 0, endSeconds: 10 },
          { startSeconds: 10, endSeconds: 20 },
        ],
        30,
      ),
    ).toEqual([{ startSeconds: 0, endSeconds: 20 }]);
  });

  it('keeps two ranges with a real gap between them separate', () => {
    expect(
      sanitizeKeepRanges(
        [
          { startSeconds: 0, endSeconds: 10 },
          { startSeconds: 12, endSeconds: 20 },
        ],
        30,
      ),
    ).toEqual([
      { startSeconds: 0, endSeconds: 10 },
      { startSeconds: 12, endSeconds: 20 },
    ]);
  });

  it('returns nothing for an empty input', () => {
    expect(sanitizeKeepRanges([], 30)).toEqual([]);
  });
});

describe('totalKeptSeconds', () => {
  it('sums the length of every range', () => {
    expect(
      totalKeptSeconds([
        { startSeconds: 0, endSeconds: 10 },
        { startSeconds: 20, endSeconds: 25 },
      ]),
    ).toBe(15);
  });

  it('is zero for no ranges', () => {
    expect(totalKeptSeconds([])).toBe(0);
  });
});

describe('originalToDisplaySeconds / displayToOriginalSeconds', () => {
  // Original 0-10 kept, 10-20 cut, 20-30 kept: displayed as one 0-20 track.
  const segments = [
    { startSeconds: 0, endSeconds: 10 },
    { startSeconds: 20, endSeconds: 30 },
  ];

  it('maps a point inside the first segment to itself', () => {
    expect(originalToDisplaySeconds(segments, 5)).toBe(5);
  });

  it('maps a point inside the second segment past the closed gap', () => {
    expect(originalToDisplaySeconds(segments, 25)).toBe(15);
  });

  it('maps a point inside the cut gap to the end of the segment before it', () => {
    expect(originalToDisplaySeconds(segments, 15)).toBe(10);
  });

  it('is the inverse of displayToOriginalSeconds for a kept point', () => {
    expect(displayToOriginalSeconds(segments, 15)).toBe(25);
    expect(displayToOriginalSeconds(segments, 5)).toBe(5);
  });

  it('clamps a display time past the end of the track to the last segment’s end', () => {
    expect(displayToOriginalSeconds(segments, 999)).toBe(30);
  });

  it('treats no segments as an empty track', () => {
    expect(originalToDisplaySeconds([], 5)).toBe(0);
    expect(displayToOriginalSeconds([], 5)).toBe(0);
  });
});

describe('nextKeptStart', () => {
  const segments = [
    { startSeconds: 0, endSeconds: 10 },
    { startSeconds: 20, endSeconds: 30 },
  ];

  it('is null inside a kept segment', () => {
    expect(nextKeptStart(segments, 5)).toBeNull();
  });

  it('is the next segment’s start when playback is in a cut gap', () => {
    expect(nextKeptStart(segments, 15)).toBe(20);
  });

  it('is null once nothing kept remains after this point', () => {
    expect(nextKeptStart(segments, 35)).toBeNull();
  });
});

describe('cutRange', () => {
  const wholeFile = [{ startSeconds: 0, endSeconds: 30 }];

  it('splits a single segment when the cut is interior', () => {
    expect(cutRange(wholeFile, 10, 20)).toEqual([
      { startSeconds: 0, endSeconds: 10 },
      { startSeconds: 20, endSeconds: 30 },
    ]);
  });

  it('shrinks the segment when the cut touches the start', () => {
    expect(cutRange(wholeFile, 0, 10)).toEqual([{ startSeconds: 10, endSeconds: 30 }]);
  });

  it('shrinks the segment when the cut touches the end', () => {
    expect(cutRange(wholeFile, 20, 30)).toEqual([{ startSeconds: 0, endSeconds: 20 }]);
  });

  it('removes the segment entirely when the cut covers all of it', () => {
    expect(cutRange(wholeFile, 0, 30)).toEqual([]);
  });

  it('cuts across a display range that spans two segments left by an earlier cut', () => {
    // 0-10 kept, 20-30 kept (10-20 already cut): a display cut of 5..17
    // removes original 5-10 and 20-27.
    const alreadyCut = [
      { startSeconds: 0, endSeconds: 10 },
      { startSeconds: 20, endSeconds: 30 },
    ];
    expect(cutRange(alreadyCut, 5, 17)).toEqual([
      { startSeconds: 0, endSeconds: 5 },
      { startSeconds: 27, endSeconds: 30 },
    ]);
  });

  it('does nothing for a zero-length or backwards range', () => {
    expect(cutRange(wholeFile, 10, 10)).toEqual(wholeFile);
    expect(cutRange(wholeFile, 20, 10)).toEqual(wholeFile);
  });

  it('leaves the cut range unreachable from any display position afterwards', () => {
    const after = cutRange(wholeFile, 10, 20);
    // Every display second in the shortened track maps to original time
    // outside the strict interior of the cut range — that part is simply not
    // on the track any more.
    for (let display = 0; display < totalKeptSeconds(after); display += 1) {
      const original = displayToOriginalSeconds(after, display);
      expect(original <= 10 || original >= 20).toBe(true);
    }
  });
});
