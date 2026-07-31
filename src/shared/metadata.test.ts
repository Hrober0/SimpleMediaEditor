import { describe, expect, it } from 'vitest';
import { SUPPORTED_FORMATS } from './media-types';
import {
  TAG_FIELDS,
  emptyTagValues,
  sanitizeTagValue,
  sanitizeTagValues,
  tagFieldLabel,
} from './metadata';

describe('sanitizeTagValue', () => {
  it('trims and keeps ordinary text as it is', () => {
    expect(sanitizeTagValue('  Ludwig van Beethoven  ', false)).toBe('Ludwig van Beethoven');
  });

  it('flattens a newline in a single-line field instead of running the words together', () => {
    expect(sanitizeTagValue('Artist\nTitle', false)).toBe('Artist Title');
  });

  it('keeps newlines where the field is meant to hold them', () => {
    expect(sanitizeTagValue('line one\nline two', true)).toBe('line one\nline two');
  });

  it('drops control characters that would otherwise end up in the file', () => {
    expect(sanitizeTagValue('So\u0000n\u0007g', false)).toBe('Song');
    // Tabs and carriage returns are whitespace, not noise, so they become spaces.
    expect(sanitizeTagValue('Song\tName', false)).toBe('Song Name');
  });

  it('bounds the length, since these become process arguments', () => {
    expect(sanitizeTagValue('x'.repeat(5000), false).length).toBe(2000);
  });
});

describe('sanitizeTagValues', () => {
  it('returns every field, empty where nothing was supplied', () => {
    expect(sanitizeTagValues({ title: 'Only this' })).toEqual({
      ...emptyTagValues(),
      title: 'Only this',
    });
  });

  it('ignores values that are not strings', () => {
    // The renderer is not trusted: these end up as ffmpeg arguments.
    expect(sanitizeTagValues({ title: 42, author: null }).title).toBe('');
  });
});

describe('tagFieldLabel', () => {
  it('says Artist for audio and Author for video', () => {
    const author = TAG_FIELDS.find((field) => field.id === 'author');
    expect(author).toBeDefined();
    if (!author) return;

    expect(tagFieldLabel(author, 'audio')).toBe('Artist');
    expect(tagFieldLabel(author, 'video')).toBe('Author');
  });

  it('uses the same label for both kinds where there is no difference', () => {
    const title = TAG_FIELDS.find((field) => field.id === 'title');
    expect(title).toBeDefined();
    if (!title) return;

    expect(tagFieldLabel(title, 'video')).toBe('Title');
  });
});

describe('the format table', () => {
  it('describes a tag family and cover-art behaviour for every format', () => {
    for (const format of SUPPORTED_FORMATS) {
      expect(format.tagFamily, format.ext).toBeTruthy();
      expect(['reliable', 'unreliable', 'unsupported']).toContain(format.coverArt);
    }
  });

  it('marks mp4 artwork as unreliable rather than working', () => {
    // The covr atom is honored inconsistently; the UI says so instead of letting
    // the user conclude the app is broken when VLC ignores it.
    const mp4 = SUPPORTED_FORMATS.find((format) => format.ext === 'mp4');
    expect(mp4?.coverArt).toBe('unreliable');
  });
});
