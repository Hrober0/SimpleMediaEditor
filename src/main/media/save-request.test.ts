import { isAbsolute, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { emptyTagValues, type SaveTagsRequest } from '@shared/metadata';
import { AppFailure } from '../errors';
import { isInside, validateSaveTagsRequest } from './save-request';

/** Absolute on both platforms, so the tests do not encode a path style. */
function abs(...segments: string[]): string {
  return resolve(join('/', ...segments));
}

const COVERS = abs('temp', 'mediaeditor', 'covers');

function request(overrides: Partial<SaveTagsRequest> = {}): SaveTagsRequest {
  return {
    sourcePath: abs('music', 'song.mp3'),
    destinationPath: abs('music', 'song.mp3'),
    tags: { ...emptyTagValues(), title: 'Nocturne' },
    cover: { kind: 'keep' },
    ...overrides,
  };
}

describe('validateSaveTagsRequest', () => {
  it('accepts a save in place', () => {
    const validated = validateSaveTagsRequest(request(), COVERS);
    expect(validated.sourcePath).toBe(validated.destinationPath);
    expect(validated.tags.title).toBe('Nocturne');
  });

  it('sanitizes the tag values, which become process arguments', () => {
    const validated = validateSaveTagsRequest(
      request({ tags: { ...emptyTagValues(), title: '  Two\nLines  ' } }),
      COVERS,
    );
    expect(validated.tags.title).toBe('Two Lines');
  });

  it('rejects a relative path', () => {
    expect(() => validateSaveTagsRequest(request({ sourcePath: 'song.mp3' }), COVERS)).toThrow(
      AppFailure,
    );
  });

  it('rejects a format the app cannot edit', () => {
    const path = abs('docs', 'notes.txt');
    expect(() =>
      validateSaveTagsRequest(request({ sourcePath: path, destinationPath: path }), COVERS),
    ).toThrow(AppFailure);
  });

  it('refuses to change the container, which would be a conversion', () => {
    // ffmpeg would silently re-encode or fail depending on the pair.
    expect(() =>
      validateSaveTagsRequest(request({ destinationPath: abs('music', 'song.m4a') }), COVERS),
    ).toThrow(/extension/i);
  });

  it('accepts a different name in a different folder', () => {
    const destinationPath = abs('backup', 'copy.mp3');
    expect(validateSaveTagsRequest(request({ destinationPath }), COVERS).destinationPath).toBe(
      destinationPath,
    );
  });

  it('only embeds cover images the app itself prepared', () => {
    // Every legitimate cover has been re-encoded into that directory, so any
    // other path is a request to hand ffmpeg a file the user never approved.
    expect(() =>
      validateSaveTagsRequest(
        request({ cover: { kind: 'replace', imagePath: abs('etc', 'passwd') } }),
        COVERS,
      ),
    ).toThrow(/prepared by the app/);

    const prepared = join(COVERS, 'cover-1.jpg');
    const validated = validateSaveTagsRequest(
      request({ cover: { kind: 'replace', imagePath: prepared } }),
      COVERS,
    );
    expect(validated.cover).toEqual({ kind: 'replace', imagePath: prepared });
  });

  it('does not let a traversal out of the cover directory pass', () => {
    const escape = join(COVERS, '..', '..', 'evil.jpg');
    expect(() =>
      validateSaveTagsRequest(request({ cover: { kind: 'replace', imagePath: escape } }), COVERS),
    ).toThrow(AppFailure);
  });

  it('refuses new artwork for a container that cannot hold it', () => {
    const path = abs('videos', 'clip.mkv');
    expect(() =>
      validateSaveTagsRequest(
        request({
          sourcePath: path,
          destinationPath: path,
          cover: { kind: 'replace', imagePath: join(COVERS, 'cover-1.jpg') },
        }),
        COVERS,
      ),
    ).toThrow(/cannot carry embedded cover art/);
  });

  it('still allows keeping artwork on such a container, since nothing is touched', () => {
    const path = abs('videos', 'clip.mkv');
    const validated = validateSaveTagsRequest(
      request({ sourcePath: path, destinationPath: path }),
      COVERS,
    );
    expect(validated.cover).toEqual({ kind: 'keep' });
  });

  it('treats a missing cover instruction as keeping what is there', () => {
    const validated = validateSaveTagsRequest(
      // The renderer is not trusted to always send a well-formed value.
      { ...request(), cover: undefined } as unknown as SaveTagsRequest,
      COVERS,
    );
    expect(validated.cover).toEqual({ kind: 'keep' });
  });
});

describe('isInside', () => {
  it('accepts a file directly in the directory and in a subdirectory', () => {
    expect(isInside(COVERS, join(COVERS, 'cover.jpg'))).toBe(true);
    expect(isInside(COVERS, join(COVERS, 'nested', 'cover.jpg'))).toBe(true);
  });

  it('rejects the directory itself, a sibling, and a parent', () => {
    expect(isInside(COVERS, COVERS)).toBe(false);
    expect(isInside(COVERS, abs('temp', 'mediaeditor', 'other', 'cover.jpg'))).toBe(false);
    expect(isInside(COVERS, abs('temp'))).toBe(false);
  });

  it('resolves traversal before deciding', () => {
    expect(isInside(COVERS, join(COVERS, '..', 'cover.jpg'))).toBe(false);
    expect(isAbsolute(COVERS)).toBe(true);
  });
});
