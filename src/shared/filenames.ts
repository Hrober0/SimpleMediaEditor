/**
 * The one filename sanitizer. Every code path that derives a filename — from a
 * YouTube title, a metadata tag, a temp file name — goes through here.
 *
 * The rules are Windows' rules, applied on Linux too: a library that is valid on
 * one machine and unopenable on the other is worse than a slightly duller name.
 */

import { formatForExtension } from './media-types';

/** Characters Windows rejects outright. Control characters are handled separately. */
const ILLEGAL_CHARACTERS = /[<>:"/\\|?*]/g;

/** Device names Windows reserves regardless of extension. */
const RESERVED_NAMES = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/** Leaves room for a " (2)" suffix and for long directory paths above it. */
const DEFAULT_MAX_LENGTH = 120;

export interface SanitizeOptions {
  /** Substituted for each illegal character. Must itself be legal. */
  replacement?: string;
  /** Maximum length of the returned name, extension included. */
  maxLength?: number;
  /** Used when sanitizing leaves nothing usable. */
  fallback?: string;
}

/**
 * Sanitizes a single path segment — never a path. Separators are treated as
 * illegal characters, so "a/b.mp3" yields "a_b.mp3" rather than a directory.
 */
export function sanitizeFilename(name: string, options: SanitizeOptions = {}): string {
  const { replacement = '_', maxLength = DEFAULT_MAX_LENGTH, fallback = 'untitled' } = options;

  const { base, ext } = splitExtension(name);
  const cleanExt = clean(ext, replacement);
  const cleanBase = clean(base, replacement);

  const suffix = cleanExt ? `.${cleanExt}` : '';
  const room = Math.max(1, maxLength - suffix.length);
  const truncated = trimDotsAndSpaces(cleanBase.slice(0, room));
  const safeBase = truncated || fallback;

  return RESERVED_NAMES.test(safeBase) ? `_${safeBase}${suffix}` : `${safeBase}${suffix}`;
}

/**
 * Drops a trailing extension the app recognizes, so a user who types
 * "My Song.mp3" does not end up with "My Song.mp3.mp3" once the real extension
 * is appended. An unrecognized suffix ("Track 1.2") is left alone.
 */
export function stripKnownExtension(name: string): string {
  const trimmed = name.trim();
  const match = /^(.*)\.([A-Za-z0-9]{1,8})$/.exec(trimmed);
  const base = match?.[1];
  const ext = match?.[2];
  if (!base || !ext) return trimmed;
  return formatForExtension(ext) ? base : trimmed;
}

function clean(value: string, replacement: string): string {
  const withoutControls = stripControlCharacters(value).replace(ILLEGAL_CHARACTERS, replacement);
  // Collapse whitespace runs, including newlines from pasted titles.
  return trimDotsAndSpaces(withoutControls.replace(/\s+/g, ' '));
}

/**
 * Windows silently strips trailing dots and spaces, which would break
 * "write temp file, then rename" by renaming to a name we did not choose.
 */
function trimDotsAndSpaces(value: string): string {
  return value.replace(/^[. ]+/, '').replace(/[. ]+$/, '');
}

/**
 * Drops control characters, but keeps the whitespace ones — a title pasted across
 * two lines should become "Artist Title", not "ArtistTitle". They are collapsed
 * into single spaces by the caller.
 */
function stripControlCharacters(value: string): string {
  let result = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    const isWhitespaceControl = code === 0x09 || (code >= 0x0a && code <= 0x0d);
    if (isWhitespaceControl || (code >= 0x20 && code !== 0x7f)) result += char;
  }
  return result;
}

/** Splits on the last dot, but only when what follows looks like an extension. */
function splitExtension(name: string): { base: string; ext: string } {
  const match = /^(.*)\.([A-Za-z0-9]{1,8})$/.exec(name.trim());
  if (!match) return { base: name, ext: '' };
  const [, base = '', ext = ''] = match;
  return base ? { base, ext } : { base: name, ext: '' };
}
