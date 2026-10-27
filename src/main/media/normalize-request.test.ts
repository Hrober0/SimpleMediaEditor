import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NormalizeRequest } from '@shared/normalize';
import { AppFailure } from '../errors';
import { validateNormalizeRequest } from './normalize-request';

/** Absolute on both platforms, so the tests do not encode a path style. */
function abs(...segments: string[]): string {
  return resolve(join('/', ...segments));
}

function request(overrides: Partial<NormalizeRequest> = {}): NormalizeRequest {
  return {
    paths: [abs('music', 'a.mp3'), abs('music', 'b.m4a')],
    targetLufs: -14,
    output: { kind: 'replace' },
    ...overrides,
  };
}

describe('validateNormalizeRequest', () => {
  it('replaces each original when asked to', () => {
    expect(validateNormalizeRequest(request())).toEqual([
      {
        sourcePath: abs('music', 'a.mp3'),
        destinationPath: abs('music', 'a.mp3'),
        targetLufs: -14,
      },
      {
        sourcePath: abs('music', 'b.m4a'),
        destinationPath: abs('music', 'b.m4a'),
        targetLufs: -14,
      },
    ]);
  });

  it('writes into the output folder under the same name', () => {
    const tasks = validateNormalizeRequest(
      request({ output: { kind: 'folder', directory: abs('out') } }),
    );
    expect(tasks.map((task) => task.destinationPath)).toEqual([
      join(abs('out'), 'a.mp3'),
      join(abs('out'), 'b.m4a'),
    ]);
  });

  it('queues a file picked twice only once', () => {
    const path = abs('music', 'a.mp3');
    expect(validateNormalizeRequest(request({ paths: [path, path] }))).toHaveLength(1);
  });

  it('refuses two files that would land on one name in the folder', () => {
    expect(() =>
      validateNormalizeRequest(
        request({
          paths: [abs('one', 'song.mp3'), abs('two', 'Song.mp3')],
          output: { kind: 'folder', directory: abs('out') },
        }),
      ),
    ).toThrow(AppFailure);
  });

  it('refuses a target the app does not offer', () => {
    const target = -9 as NormalizeRequest['targetLufs'];
    expect(() => validateNormalizeRequest(request({ targetLufs: target }))).toThrow(AppFailure);
  });

  it('refuses an empty list', () => {
    expect(() => validateNormalizeRequest(request({ paths: [] }))).toThrow(AppFailure);
  });

  it('refuses a relative path', () => {
    expect(() => validateNormalizeRequest(request({ paths: ['a.mp3'] }))).toThrow(AppFailure);
  });

  it('refuses a format the app cannot edit', () => {
    expect(() => validateNormalizeRequest(request({ paths: [abs('docs', 'notes.txt')] }))).toThrow(
      AppFailure,
    );
  });

  it('refuses a folder output with no folder', () => {
    expect(() =>
      validateNormalizeRequest(request({ output: { kind: 'folder', directory: '' } })),
    ).toThrow(AppFailure);
  });
});
