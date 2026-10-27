import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (request: Request) => Promise<Response>>();

vi.mock('electron', () => ({
  protocol: {
    registerSchemesAsPrivileged: vi.fn(),
    handle: (scheme: string, handler: (request: Request) => Promise<Response>) => {
      handlers.set(scheme, handler);
    },
  },
}));

const { MEDIA_PROTOCOL_SCHEME, mediaFileUrl } = await import('@shared/media-protocol');
const { registerMediaProtocolHandler } = await import('./media-protocol');

const CONTENT = Buffer.from(Array.from({ length: 1000 }, (_, index) => index % 256));

let directory = '';
let mediaPath = '';

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mediaeditor-protocol-'));
  mediaPath = join(directory, 'track.mp3');
  await writeFile(mediaPath, CONTENT);
  registerMediaProtocolHandler();
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

function fetchMedia(path: string, headers?: Record<string, string>): Promise<Response> {
  const handler = handlers.get(MEDIA_PROTOCOL_SCHEME);
  if (!handler) throw new Error('The media protocol handler was never registered.');
  return handler(new Request(mediaFileUrl(path), { headers }));
}

describe('the media protocol', () => {
  it('serves the whole file and says ranges are welcome', async () => {
    const response = await fetchMedia(mediaPath);

    expect(response.status).toBe(200);
    expect(response.headers.get('Accept-Ranges')).toBe('bytes');
    expect(response.headers.get('Content-Length')).toBe('1000');
    expect(response.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(CONTENT);
  });

  // A 200 here is what broke seeking: the player takes it to mean the source
  // cannot seek, drops the seek, and reports position zero.
  it('answers a range with a 206 and the bytes it names', async () => {
    const response = await fetchMedia(mediaPath, { Range: 'bytes=100-199' });

    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe('bytes 100-199/1000');
    expect(response.headers.get('Content-Length')).toBe('100');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(CONTENT.subarray(100, 200));
  });

  it('runs an open-ended range to the end of the file', async () => {
    const response = await fetchMedia(mediaPath, { Range: 'bytes=900-' });

    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe('bytes 900-999/1000');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(CONTENT.subarray(900));
  });

  it('refuses a range that starts past the end of the file', async () => {
    const response = await fetchMedia(mediaPath, { Range: 'bytes=5000-6000' });

    expect(response.status).toBe(416);
    expect(response.headers.get('Content-Range')).toBe('bytes */1000');
  });

  it('never caches, so a file saved in place is not served stale', async () => {
    const response = await fetchMedia(mediaPath);

    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('gives a reopened file a new URL, and serves the same file under it', async () => {
    expect(mediaFileUrl(mediaPath, 2)).not.toBe(mediaFileUrl(mediaPath, 1));

    const handler = handlers.get(MEDIA_PROTOCOL_SCHEME);
    if (!handler) throw new Error('The media protocol handler was never registered.');
    const response = await handler(new Request(mediaFileUrl(mediaPath, 2)));

    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(CONTENT);
  });

  it('refuses a relative path', async () => {
    expect((await fetchMedia('track.mp3')).status).toBe(404);
  });

  it('refuses an extension this app does not play', async () => {
    expect((await fetchMedia(join(directory, 'notes.txt'))).status).toBe(404);
  });

  it('refuses a file that is not there', async () => {
    expect((await fetchMedia(join(directory, 'missing.mp3'))).status).toBe(404);
  });
});
