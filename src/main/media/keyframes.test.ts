import { describe, expect, it } from 'vitest';
import { buildKeyframeArgs, parseKeyframeLine, snapToKeyframes } from './keyframes';

describe('buildKeyframeArgs', () => {
  it('reads packet flags from the real video stream only', () => {
    const args = buildKeyframeArgs('in.mp4');
    expect(args).toEqual(expect.arrayContaining(['-select_streams', 'V:0', '-of', 'compact']));
    expect(args.slice(-2)).toEqual(['-i', 'in.mp4']);
  });
});

describe('parseKeyframeLine', () => {
  it('reads a keyframe packet', () => {
    expect(parseKeyframeLine('packet|pts_time=4.000000|flags=K__')).toEqual({
      kind: 'keyframe',
      seconds: 4,
    });
  });

  it('ignores a packet that is not a keyframe', () => {
    expect(parseKeyframeLine('packet|pts_time=4.040000|flags=___')).toBeNull();
  });

  it('ignores a packet with no timestamp', () => {
    expect(parseKeyframeLine('packet|pts_time=N/A|flags=K__')).toBeNull();
  });

  it('reads the container start time', () => {
    expect(parseKeyframeLine('format|start_time=1.400000')).toEqual({
      kind: 'start',
      seconds: 1.4,
    });
  });

  it('ignores anything else', () => {
    expect(parseKeyframeLine('')).toBeNull();
    expect(parseKeyframeLine('stream|index=0')).toBeNull();
  });
});

describe('snapToKeyframes', () => {
  const keyframes = [0, 4, 8, 12];

  it('moves each start back to the keyframe at or before it, keeping the end', () => {
    expect(
      snapToKeyframes(
        [
          { startSeconds: 13, endSeconds: 15 },
          { startSeconds: 5, endSeconds: 7 },
        ],
        keyframes,
      ),
    ).toEqual([
      { startSeconds: 12, endSeconds: 15 },
      { startSeconds: 4, endSeconds: 7 },
    ]);
  });

  it('leaves a start already on a keyframe where it is', () => {
    expect(snapToKeyframes([{ startSeconds: 8, endSeconds: 9 }], keyframes)).toEqual([
      { startSeconds: 8, endSeconds: 9 },
    ]);
  });

  it('rounds up, so ffmpeg does not seek to the keyframe before', () => {
    expect(snapToKeyframes([{ startSeconds: 5, endSeconds: 9 }], [4.0004])).toEqual([
      { startSeconds: 4.001, endSeconds: 9 },
    ]);
  });

  it('moves onto a keyframe a few milliseconds ahead rather than a whole interval back', () => {
    // Where a file saved in fast mode has its keyframes: just after the old cut.
    expect(snapToKeyframes([{ startSeconds: 2, endSeconds: 4 }], [0, 1, 2.005957, 3])).toEqual([
      { startSeconds: 2.006, endSeconds: 4 },
    ]);
  });

  it('still goes back when the next keyframe is more than a frame ahead', () => {
    expect(snapToKeyframes([{ startSeconds: 2, endSeconds: 4 }], [0, 1, 2.05, 3])).toEqual([
      { startSeconds: 1, endSeconds: 4 },
    ]);
  });

  it('changes nothing when no keyframes were found', () => {
    expect(snapToKeyframes([{ startSeconds: 5, endSeconds: 9 }], [])).toEqual([
      { startSeconds: 5, endSeconds: 9 },
    ]);
  });
});
