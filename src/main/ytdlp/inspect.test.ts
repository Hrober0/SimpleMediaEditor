import { describe, expect, it } from 'vitest';
import { AppFailure } from '../errors';
import { parseInspection } from './inspect';

const url = 'https://www.youtube.com/watch?v=abc';

describe('parseInspection', () => {
  it('reads a single video', () => {
    const result = parseInspection(
      JSON.stringify({
        id: 'abc',
        title: 'Me at the zoo',
        uploader: 'jawed',
        duration: 19,
        webpage_url: url,
        thumbnails: [{ url: 'https://img/small.jpg' }, { url: 'https://img/large.jpg' }],
      }),
      url,
    );

    expect(result.kind).toBe('video');
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      id: 'abc',
      title: 'Me at the zoo',
      uploader: 'jawed',
      durationSeconds: 19,
      url,
      // thumbnails run worst-to-best, so the last one wins.
      thumbnailUrl: 'https://img/large.jpg',
    });
  });

  it('reads a playlist as one entry per video', () => {
    const result = parseInspection(
      JSON.stringify({
        _type: 'playlist',
        title: 'My mix',
        channel: 'Someone',
        entries: [
          { id: 'one', title: 'First', url: 'https://youtu.be/one', duration: 100 },
          { id: 'two', title: 'Second', url: 'https://youtu.be/two' },
        ],
      }),
      url,
    );

    expect(result.kind).toBe('playlist');
    expect(result.title).toBe('My mix');
    expect(result.uploader).toBe('Someone');
    expect(result.entries.map((entry) => entry.title)).toEqual(['First', 'Second']);
    expect(result.entries[1]?.durationSeconds).toBeNull();
  });

  it('builds a watch URL for a flat entry that only has an id', () => {
    const result = parseInspection(
      JSON.stringify({ _type: 'playlist', title: 'Mix', entries: [{ id: 'xyz', title: 'T' }] }),
      url,
    );

    expect(result.entries[0]?.url).toBe('https://www.youtube.com/watch?v=xyz');
  });

  it('skips playlist entries with nothing to download', () => {
    const result = parseInspection(
      JSON.stringify({
        _type: 'playlist',
        title: 'Mix',
        entries: [null, { title: 'no id or url' }, { id: 'ok', title: 'Fine' }],
      }),
      url,
    );

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.id).toBe('ok');
  });

  it('prefers an explicit thumbnail over the list', () => {
    const result = parseInspection(
      JSON.stringify({
        id: 'abc',
        title: 'T',
        thumbnail: 'https://img/chosen.jpg',
        thumbnails: [{ url: 'https://img/other.jpg' }],
      }),
      url,
    );

    expect(result.entries[0]?.thumbnailUrl).toBe('https://img/chosen.jpg');
  });

  it('tolerates missing optional fields', () => {
    const result = parseInspection(JSON.stringify({ id: 'abc' }), url);
    const entry = result.entries[0];

    expect(entry?.title).toBe(url);
    expect(entry?.uploader).toBeNull();
    expect(entry?.durationSeconds).toBeNull();
    expect(entry?.thumbnailUrl).toBeNull();
  });

  it('rejects an empty playlist rather than queueing nothing', () => {
    expect(() =>
      parseInspection(JSON.stringify({ _type: 'playlist', title: 'Empty', entries: [] }), url),
    ).toThrow(AppFailure);
  });

  it('reports unreadable output as a failure, not a crash', () => {
    expect(() => parseInspection('not json at all', url)).toThrow(AppFailure);
    expect(() => parseInspection('[]', url)).toThrow(AppFailure);
  });
});
