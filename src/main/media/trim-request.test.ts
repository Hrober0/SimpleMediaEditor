import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TrimRequest } from '@shared/trim';
import { AppFailure } from '../errors';
import { validateTrimRequest } from './trim-request';

/** Absolute on both platforms, so the tests do not encode a path style. */
function abs(...segments: string[]): string {
  return resolve(join('/', ...segments));
}

function request(overrides: Partial<TrimRequest> = {}): TrimRequest {
  return {
    sourcePath: abs('music', 'song.mp3'),
    destinationPath: abs('music', 'song.mp3'),
    ranges: [{ startSeconds: 0, endSeconds: 10 }],
    mode: 'fast',
    ...overrides,
  };
}

describe('validateTrimRequest', () => {
  it('accepts a trim in place', () => {
    const validated = validateTrimRequest(request());
    expect(validated.sourcePath).toBe(validated.destinationPath);
    expect(validated.ranges).toEqual([{ startSeconds: 0, endSeconds: 10 }]);
  });

  it('rejects a relative path', () => {
    expect(() => validateTrimRequest(request({ sourcePath: 'song.mp3' }))).toThrow(AppFailure);
  });

  it('rejects a destination with a different extension', () => {
    expect(() =>
      validateTrimRequest(request({ destinationPath: abs('music', 'song.wav') })),
    ).toThrow(AppFailure);
  });

  it('rejects a format the app cannot edit', () => {
    const path = abs('docs', 'notes.txt');
    expect(() => validateTrimRequest(request({ sourcePath: path, destinationPath: path }))).toThrow(
      AppFailure,
    );
  });

  it('rejects an empty range list', () => {
    expect(() => validateTrimRequest(request({ ranges: [] }))).toThrow(AppFailure);
  });

  it('rejects a malformed range', () => {
    expect(() =>
      validateTrimRequest(request({ ranges: [{ startSeconds: Number.NaN, endSeconds: 10 }] })),
    ).toThrow(AppFailure);
  });

  it('clamps a negative start rather than rejecting it', () => {
    const validated = validateTrimRequest(
      request({ ranges: [{ startSeconds: -5, endSeconds: 10 }] }),
    );
    expect(validated.ranges).toEqual([{ startSeconds: 0, endSeconds: 10 }]);
  });

  it('falls back to fast mode for an unrecognized mode value', () => {
    const validated = validateTrimRequest({
      ...request(),
      mode: 'blazing' as unknown as TrimRequest['mode'],
    });
    expect(validated.mode).toBe('fast');
  });
});
