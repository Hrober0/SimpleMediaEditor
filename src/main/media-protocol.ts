import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { Readable } from 'node:stream';
import { protocol } from 'electron';
import { formatForExtension } from '@shared/media-types';
import { MEDIA_PROTOCOL_SCHEME } from '@shared/media-protocol';
import { parseByteRange } from './byte-range';

/**
 * Serves a local media file to the renderer's `<video>`/`<audio>` elements.
 *
 * The renderer has no filesystem access and the IPC contract only carries
 * JSON-shaped responses, so neither fits handing over a multi-hundred-MB file
 * for playback.
 *
 * The bytes are read here rather than forwarded to Chromium's `file://` loader
 * because that loader answers a `Range` request with a plain 200 and no
 * `Content-Range` or `Content-Length`. The player reads that as "this source
 * cannot seek and has no known length", drops every seek, and reports position
 * zero back. Seeking only works once the reply is a 206 that says which bytes
 * it carries.
 *
 * Only a path this app would open for editing is ever served: the same check
 * `media:probe` applies, so this cannot become a way to read an arbitrary file
 * off disk.
 */

/** Must run before `app.whenReady()`. */
export function registerMediaProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_PROTOCOL_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ]);
}

/** Must run after `app.whenReady()`. */
export function registerMediaProtocolHandler(): void {
  protocol.handle(MEDIA_PROTOCOL_SCHEME, async (request) => {
    const path = new URL(request.url).searchParams.get('path');
    const format = path ? formatForExtension(path) : undefined;
    if (!path || !isAbsolute(path) || !format) {
      return new Response('Not a file this app can play.', { status: 404 });
    }

    const sizeBytes = await fileSize(path);
    if (sizeBytes === null) {
      return new Response('That file could not be read.', { status: 404 });
    }

    const range = parseByteRange(request.headers.get('Range'), sizeBytes);
    if (range.kind === 'unsatisfiable') {
      return new Response(null, {
        status: 416,
        headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes */${sizeBytes}` },
      });
    }

    const start = range.kind === 'range' ? range.start : 0;
    const end = range.kind === 'range' ? range.end : sizeBytes - 1;

    const headers = new Headers({
      'Accept-Ranges': 'bytes',
      'Content-Type': format.mimeType,
      'Content-Length': String(sizeBytes === 0 ? 0 : end - start + 1),
      // Saving in place rewrites the file behind a URL that has not changed,
      // so a cached copy would be the version from before the edit.
      'Cache-Control': 'no-store',
    });
    if (range.kind === 'range') {
      headers.set('Content-Range', `bytes ${start}-${end}/${sizeBytes}`);
    }

    const body = sizeBytes === 0 ? null : Readable.toWeb(createReadStream(path, { start, end }));
    return new Response(body, { status: range.kind === 'range' ? 206 : 200, headers });
  });
}

async function fileSize(path: string): Promise<number | null> {
  try {
    const info = await stat(path);
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
}
