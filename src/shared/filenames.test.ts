import { describe, expect, it } from 'vitest';
import { sanitizeFilename, stripKnownExtension } from './filenames';

describe('sanitizeFilename', () => {
  it('replaces characters Windows rejects', () => {
    // One replacement per illegal character: / : < > ? * " |
    expect(sanitizeFilename('AC/DC: Back <in> Black?*"|.mp3')).toBe(
      'AC_DC_ Back _in_ Black____.mp3',
    );
  });

  it('treats separators as illegal rather than as a path', () => {
    // A sanitizer that let separators through would allow writing outside the
    // chosen folder.
    // Separators become underscores and the leading dots are trimmed, so the
    // result is one harmless name in the chosen folder.
    expect(sanitizeFilename('..\\..\\windows\\system32\\evil.mp3')).toBe(
      '_.._windows_system32_evil.mp3',
    );
    expect(sanitizeFilename('/etc/passwd')).toBe('_etc_passwd');
  });

  it('strips control characters', () => {
    // Built from code points: literal control bytes would be invisible here.
    const nul = String.fromCharCode(0);
    const unitSep = String.fromCharCode(0x1f);
    const del = String.fromCharCode(0x7f);
    expect(sanitizeFilename(`be${nul}fo${unitSep}re${del}.mp3`)).toBe('before.mp3');
  });

  it('collapses whitespace runs from pasted titles', () => {
    expect(sanitizeFilename('Song\n\ttitle   here.mp3')).toBe('Song title here.mp3');
  });

  it('removes leading and trailing dots and spaces', () => {
    // Windows silently drops these, which would break temp-file-then-rename.
    expect(sanitizeFilename('  ...track...  ')).toBe('track');
    expect(sanitizeFilename('track.')).toBe('track');
  });

  it('escapes reserved device names', () => {
    expect(sanitizeFilename('CON.mp3')).toBe('_CON.mp3');
    expect(sanitizeFilename('nul')).toBe('_nul');
    expect(sanitizeFilename('com1.mp3')).toBe('_com1.mp3');
    expect(sanitizeFilename('console.mp3')).toBe('console.mp3');
  });

  it('falls back when nothing usable is left', () => {
    expect(sanitizeFilename('///')).toBe('___');
    expect(sanitizeFilename('   ')).toBe('untitled');
    expect(sanitizeFilename('', { fallback: 'audio' })).toBe('audio');
  });

  it('truncates the base but keeps the extension', () => {
    const result = sanitizeFilename(`${'a'.repeat(300)}.mp3`, { maxLength: 20 });
    expect(result).toBe(`${'a'.repeat(16)}.mp3`);
    expect(result.length).toBe(20);
  });

  it('does not leave a trailing dot after truncation', () => {
    const result = sanitizeFilename(`${'a'.repeat(10)}.....tail.mp3`, { maxLength: 15 });
    expect(result.endsWith('.mp3')).toBe(true);
    expect(result).not.toContain('..mp3');
  });

  it('only treats a plausible suffix as an extension', () => {
    expect(sanitizeFilename('Track 1.2')).toBe('Track 1.2');
    expect(sanitizeFilename('.hidden')).toBe('hidden');
  });

  it('keeps unicode, which is legal on both platforms', () => {
    expect(sanitizeFilename('Björk — Jóga.mp3')).toBe('Björk — Jóga.mp3');
  });
});

describe('stripKnownExtension', () => {
  it('drops an extension the app recognizes', () => {
    expect(stripKnownExtension('My Song.mp3')).toBe('My Song');
    expect(stripKnownExtension('clip.MP4')).toBe('clip');
  });

  it('leaves anything else alone', () => {
    expect(stripKnownExtension('Track 1.2')).toBe('Track 1.2');
    expect(stripKnownExtension('Symphony No. 5')).toBe('Symphony No. 5');
    expect(stripKnownExtension('archive.tar')).toBe('archive.tar');
  });
});
