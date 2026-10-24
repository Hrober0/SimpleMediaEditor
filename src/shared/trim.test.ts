import { describe, expect, it } from 'vitest';
import {
  cutRange,
  displayToOriginalSeconds,
  locateDisplaySeconds,
  nextJump,
  pasteAt,
  positionToDisplaySeconds,
  sanitizeKeepRanges,
  totalKeptSeconds,
} from './trim';

describe('sanitizeKeepRanges', () => {
  it('keeps ranges in the order given, since that is the play order', () => {
    expect(
      sanitizeKeepRanges(
        [
          { startSeconds: 10, endSeconds: 20 },
          { startSeconds: 0, endSeconds: 5 },
        ],
        30,
      ),
    ).toEqual([
      { startSeconds: 10, endSeconds: 20 },
      { startSeconds: 0, endSeconds: 5 },
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

  it('joins a range that carries straight on from the one before it', () => {
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

  it('keeps a part that was pasted twice', () => {
    const part = { startSeconds: 5, endSeconds: 10 };
    expect(sanitizeKeepRanges([part, { startSeconds: 20, endSeconds: 25 }, part], 30)).toEqual([
      part,
      { startSeconds: 20, endSeconds: 25 },
      part,
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

describe('locateDisplaySeconds / positionToDisplaySeconds', () => {
  // Original 20-30 plays first, then original 0-10: displayed as one 0-20 track.
  const reordered = [
    { startSeconds: 20, endSeconds: 30 },
    { startSeconds: 0, endSeconds: 10 },
  ];

  it('finds the segment and the original time for a display time', () => {
    expect(locateDisplaySeconds(reordered, 5)).toEqual({ segmentIndex: 0, originalSeconds: 25 });
    expect(locateDisplaySeconds(reordered, 15)).toEqual({ segmentIndex: 1, originalSeconds: 5 });
  });

  it('puts a point exactly on a boundary at the start of the next segment', () => {
    expect(locateDisplaySeconds(reordered, 10)).toEqual({ segmentIndex: 1, originalSeconds: 0 });
  });

  it('clamps past the end to the end of the last segment', () => {
    expect(locateDisplaySeconds(reordered, 999)).toEqual({ segmentIndex: 1, originalSeconds: 10 });
  });

  it('is null for an empty track', () => {
    expect(locateDisplaySeconds([], 5)).toBeNull();
    expect(displayToOriginalSeconds([], 5)).toBe(0);
  });

  it('maps a position back to the display time it came from', () => {
    expect(positionToDisplaySeconds(reordered, { segmentIndex: 1, originalSeconds: 5 })).toBe(15);
    expect(positionToDisplaySeconds(reordered, { segmentIndex: 0, originalSeconds: 25 })).toBe(5);
  });

  it('tells two copies of the same part apart by segment', () => {
    const twice = [
      { startSeconds: 0, endSeconds: 10 },
      { startSeconds: 0, endSeconds: 10 },
    ];
    expect(positionToDisplaySeconds(twice, { segmentIndex: 0, originalSeconds: 4 })).toBe(4);
    expect(positionToDisplaySeconds(twice, { segmentIndex: 1, originalSeconds: 4 })).toBe(14);
  });
});

describe('nextJump', () => {
  const segments = [
    { startSeconds: 0, endSeconds: 10 },
    { startSeconds: 20, endSeconds: 30 },
  ];

  it('leaves at the end of the segment for the start of the next one', () => {
    expect(nextJump(segments, { segmentIndex: 0, originalSeconds: 5 }, null)).toEqual({
      atOriginalSeconds: 10,
      to: { segmentIndex: 1, originalSeconds: 20 },
    });
  });

  it('stops at the end of the last segment', () => {
    expect(nextJump(segments, { segmentIndex: 1, originalSeconds: 25 }, null)).toEqual({
      atOriginalSeconds: 30,
      to: null,
    });
  });

  it('goes back to the loop start when the loop ends inside this segment', () => {
    // Display 12-15 is original 22-25.
    const loop = { startSeconds: 12, endSeconds: 15 };
    expect(nextJump(segments, { segmentIndex: 1, originalSeconds: 23 }, loop)).toEqual({
      atOriginalSeconds: 25,
      to: { segmentIndex: 1, originalSeconds: 22 },
    });
  });

  it('crosses into the next segment first when the loop ends further on', () => {
    const loop = { startSeconds: 5, endSeconds: 15 };
    expect(nextJump(segments, { segmentIndex: 0, originalSeconds: 6 }, loop)).toEqual({
      atOriginalSeconds: 10,
      to: { segmentIndex: 1, originalSeconds: 20 },
    });
  });
});

describe('cutRange', () => {
  const wholeFile = [{ startSeconds: 0, endSeconds: 30 }];

  it('splits a single segment when the cut is interior, and hands back what was cut', () => {
    expect(cutRange(wholeFile, 10, 20)).toEqual({
      kept: [
        { startSeconds: 0, endSeconds: 10 },
        { startSeconds: 20, endSeconds: 30 },
      ],
      removed: [{ startSeconds: 10, endSeconds: 20 }],
    });
  });

  it('shrinks the segment when the cut touches the start', () => {
    expect(cutRange(wholeFile, 0, 10).kept).toEqual([{ startSeconds: 10, endSeconds: 30 }]);
  });

  it('shrinks the segment when the cut touches the end', () => {
    expect(cutRange(wholeFile, 20, 30).kept).toEqual([{ startSeconds: 0, endSeconds: 20 }]);
  });

  it('removes the segment entirely when the cut covers all of it', () => {
    expect(cutRange(wholeFile, 0, 30)).toEqual({ kept: [], removed: wholeFile });
  });

  it('cuts across a display range that spans two segments left by an earlier cut', () => {
    // 0-10 kept, 20-30 kept (10-20 already cut): a display cut of 5..17
    // removes original 5-10 and 20-27.
    const alreadyCut = [
      { startSeconds: 0, endSeconds: 10 },
      { startSeconds: 20, endSeconds: 30 },
    ];
    expect(cutRange(alreadyCut, 5, 17)).toEqual({
      kept: [
        { startSeconds: 0, endSeconds: 5 },
        { startSeconds: 27, endSeconds: 30 },
      ],
      removed: [
        { startSeconds: 5, endSeconds: 10 },
        { startSeconds: 20, endSeconds: 27 },
      ],
    });
  });

  it('cuts only the copy that is selected when a part appears twice', () => {
    const twice = [
      { startSeconds: 0, endSeconds: 10 },
      { startSeconds: 0, endSeconds: 10 },
    ];
    expect(cutRange(twice, 12, 14).kept).toEqual([
      { startSeconds: 0, endSeconds: 10 },
      { startSeconds: 0, endSeconds: 2 },
      { startSeconds: 4, endSeconds: 10 },
    ]);
  });

  it('does nothing for a zero-length or backwards range', () => {
    expect(cutRange(wholeFile, 10, 10)).toEqual({ kept: wholeFile, removed: [] });
    expect(cutRange(wholeFile, 20, 10)).toEqual({ kept: wholeFile, removed: [] });
  });

  it('leaves the cut range unreachable from any display position afterwards', () => {
    const { kept } = cutRange(wholeFile, 10, 20);
    for (let display = 0; display < totalKeptSeconds(kept); display += 1) {
      const original = displayToOriginalSeconds(kept, display);
      expect(original <= 10 || original >= 20).toBe(true);
    }
  });
});

describe('pasteAt', () => {
  const pasted = [{ startSeconds: 10, endSeconds: 20 }];

  it('inserts inside a segment and pushes the rest of it later', () => {
    const kept = [
      { startSeconds: 0, endSeconds: 10 },
      { startSeconds: 20, endSeconds: 30 },
    ];
    expect(pasteAt(kept, 15, pasted)).toEqual([
      { startSeconds: 0, endSeconds: 10 },
      { startSeconds: 20, endSeconds: 25 },
      { startSeconds: 10, endSeconds: 20 },
      { startSeconds: 25, endSeconds: 30 },
    ]);
  });

  it('inserts at the very start', () => {
    expect(pasteAt([{ startSeconds: 0, endSeconds: 5 }], 0, pasted)).toEqual([
      { startSeconds: 10, endSeconds: 20 },
      { startSeconds: 0, endSeconds: 5 },
    ]);
  });

  it('joins the pasted part to a neighbour it carries straight on into', () => {
    expect(pasteAt([{ startSeconds: 20, endSeconds: 30 }], 0, pasted)).toEqual([
      { startSeconds: 10, endSeconds: 30 },
    ]);
  });

  it('appends past the end', () => {
    expect(pasteAt([{ startSeconds: 0, endSeconds: 5 }], 999, pasted)).toEqual([
      { startSeconds: 0, endSeconds: 5 },
      { startSeconds: 10, endSeconds: 20 },
    ]);
  });

  it('puts a part cut out back together when pasted where it came from', () => {
    const { kept, removed } = cutRange([{ startSeconds: 0, endSeconds: 30 }], 10, 20);
    expect(pasteAt(kept, 10, removed)).toEqual([{ startSeconds: 0, endSeconds: 30 }]);
  });

  it('lengthens the track by exactly the pasted length', () => {
    const kept = [{ startSeconds: 0, endSeconds: 30 }];
    expect(totalKeptSeconds(pasteAt(kept, 7, pasted))).toBe(40);
  });
});
