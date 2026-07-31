import { describe, expect, it } from 'vitest';
import { TAG_FIELDS, emptyTagValues } from '@shared/metadata';
import { metadataArgs, readTagValues, writeKeysFor } from './tags';

/** Reads every value written for a key, so order does not matter to the test. */
function valuesFor(args: readonly string[], key: string): string[] {
  const values: string[] = [];
  for (const [index, arg] of args.entries()) {
    if (arg !== '-metadata') continue;
    const pair = args[index + 1] ?? '';
    if (pair.startsWith(`${key}=`)) values.push(pair.slice(key.length + 1));
  }
  return values;
}

describe('readTagValues', () => {
  it('reads the common keys', () => {
    expect(
      readTagValues({
        title: 'Nocturne',
        artist: 'Chopin',
        album: 'Nocturnes',
        date: '1832',
        genre: 'Classical',
        comment: 'From a CD rip',
      }),
    ).toEqual({
      title: 'Nocturne',
      author: 'Chopin',
      album: 'Nocturnes',
      year: '1832',
      genre: 'Classical',
      comment: 'From a CD rip',
    });
  });

  it('falls back through the alternatives a container might have used', () => {
    // An mp4 written by another tool may carry `author` where mp3 uses `artist`.
    expect(readTagValues({ author: 'Someone' }).author).toBe('Someone');
    expect(readTagValues({ year: '1999' }).year).toBe('1999');
  });

  it('prefers the earlier key when a file has both', () => {
    expect(readTagValues({ artist: 'Artist', author: 'Author' }).author).toBe('Artist');
  });

  it('treats a blank tag as absent rather than as a value', () => {
    expect(readTagValues({ artist: '   ', author: 'Author' }).author).toBe('Author');
  });

  it('returns empty strings for a file with no tags', () => {
    expect(readTagValues({})).toEqual(emptyTagValues());
  });
});

describe('metadataArgs', () => {
  const values = { ...emptyTagValues(), title: 'Nocturne', author: 'Chopin' };

  it('writes the author as artist for audio containers', () => {
    expect(valuesFor(metadataArgs(values, 'id3'), 'artist')).toEqual(['Chopin']);
    expect(valuesFor(metadataArgs(values, 'id3'), 'author')).toEqual([]);
  });

  it('writes both keys for mp4, where players disagree about which they show', () => {
    const args = metadataArgs(values, 'mp4');
    expect(valuesFor(args, 'artist')).toEqual(['Chopin']);
    expect(valuesFor(args, 'author')).toEqual(['Chopin']);
  });

  it('writes the year as date, which every muxer maps to its own field', () => {
    const args = metadataArgs({ ...values, year: '1832' }, 'vorbis');
    expect(valuesFor(args, 'date')).toEqual(['1832']);
  });

  it('writes an empty value for a cleared field, which is how ffmpeg deletes a tag', () => {
    // Leaving the key out would keep the old value in the file, so clearing a
    // field in the UI would silently do nothing.
    const args = metadataArgs(emptyTagValues(), 'id3');
    expect(valuesFor(args, 'title')).toEqual(['']);
    expect(valuesFor(args, 'artist')).toEqual(['']);
  });

  it('covers every field in the table', () => {
    const args = metadataArgs(emptyTagValues(), 'mp4');
    for (const field of TAG_FIELDS) {
      for (const key of writeKeysFor(field, 'mp4')) {
        expect(valuesFor(args, key), key).toHaveLength(1);
      }
    }
  });
});
