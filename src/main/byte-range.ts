/**
 * Resolving the `Range` header a media element sends when it seeks.
 *
 * Chromium only treats a source as seekable once a range request comes back as
 * a 206 whose `Content-Range` matches what it asked for. A reply that quietly
 * carries the right bytes under a plain 200 is read as the start of the file,
 * so the offsets have to be worked out here rather than left to whatever is
 * serving the bytes.
 */

export type ByteRangeRequest =
  | { kind: 'whole-file' }
  /** Both ends inclusive, the way HTTP counts them. */
  | { kind: 'range'; start: number; end: number }
  | { kind: 'unsatisfiable' };

/**
 * A header this function cannot make sense of asks for the whole file rather
 * than failing: RFC 9110 has a recipient ignore a `Range` it does not
 * understand, and a playable file beats a 416 the user cannot act on.
 */
export function parseByteRange(header: string | null, sizeBytes: number): ByteRangeRequest {
  const spec = byteRangeSpec(header);
  if (!spec) return { kind: 'whole-file' };
  if (sizeBytes === 0) return { kind: 'unsatisfiable' };

  const [startText, endText] = spec;

  if (startText === '') {
    const suffixLength = wholeNumber(endText);
    if (suffixLength === null || suffixLength === 0) return { kind: 'whole-file' };
    return { kind: 'range', start: Math.max(0, sizeBytes - suffixLength), end: sizeBytes - 1 };
  }

  const start = wholeNumber(startText);
  if (start === null) return { kind: 'whole-file' };
  if (start >= sizeBytes) return { kind: 'unsatisfiable' };
  if (endText === '') return { kind: 'range', start, end: sizeBytes - 1 };

  const end = wholeNumber(endText);
  if (end === null) return { kind: 'whole-file' };
  if (end < start) return { kind: 'unsatisfiable' };
  return { kind: 'range', start, end: Math.min(end, sizeBytes - 1) };
}

const BYTES_PREFIX = 'bytes=';

function byteRangeSpec(header: string | null): [string, string] | null {
  if (!header) return null;
  const value = header.trim().toLowerCase();
  if (!value.startsWith(BYTES_PREFIX)) return null;

  const spec = value.slice(BYTES_PREFIX.length);
  // Several ranges at once would have to be answered as multipart/byteranges.
  // A media element never asks for that, so it is not worth serving.
  if (spec.includes(',')) return null;

  const separator = spec.indexOf('-');
  if (separator < 0) return null;
  return [spec.slice(0, separator).trim(), spec.slice(separator + 1).trim()];
}

function wholeNumber(text: string): number | null {
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}
