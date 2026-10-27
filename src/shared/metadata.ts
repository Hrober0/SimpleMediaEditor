/**
 * The tag editing model: what a file currently holds, what the user may change,
 * and how each field maps onto container tag keys.
 *
 * The field table lives here because both sides need it — the renderer for
 * labels, main for the `-metadata` keys — and because "which key does Author
 * write?" is data, not a branch on the extension.
 */

import type { MediaKind, TagFamily } from './media-types';

export type TagFieldId = 'title' | 'author' | 'album' | 'year' | 'genre' | 'comment';

export interface TagFieldDescriptor {
  id: TagFieldId;
  /** Label for audio files. */
  label: string;
  /** Used instead of `label` for video, where "Artist" reads wrong. */
  videoLabel: string | null;
  description: string | null;
  /**
   * ffprobe tag keys to read, best first. ffprobe normalizes most containers
   * onto these names already (RIFF `INAM` arrives as `title`).
   */
  readKeys: readonly string[];
  /** `-metadata` keys written for every container. All get the same value. */
  writeKeys: readonly string[];
  /** Additional keys for containers whose players disagree about the key. */
  extraWriteKeys: Partial<Record<TagFamily, readonly string[]>>;
  multiline: boolean;
}

export const TAG_FIELDS: readonly TagFieldDescriptor[] = [
  {
    id: 'title',
    label: 'Title',
    videoLabel: null,
    description: null,
    readKeys: ['title'],
    writeKeys: ['title'],
    extraWriteKeys: {},
    multiline: false,
  },
  {
    id: 'author',
    label: 'Artist',
    // Same tag, different word: music players show "Artist", video players and
    // file managers show "Author". Labeling it per kind avoids explaining that.
    videoLabel: 'Author',
    description: null,
    // `artist` first: it is what nearly every file in the wild actually uses.
    // `author` is read as well, for files another tool tagged that way.
    readKeys: ['artist', 'author'],
    writeKeys: ['artist'],
    // Asked for on mp4 because players disagree about which key they display.
    // Verified behaviour with ffmpeg 7.1: the mov muxer has no atom for `author`
    // and drops it, so `artist` (©ART) is what actually lands — which is also
    // what Windows Explorer shows in its Authors column for mp4. The key is kept
    // here so a muxer that does map it gets it, and the integration test records
    // what is really written rather than what was intended.
    extraWriteKeys: { mp4: ['author'] },
    multiline: false,
  },
  {
    id: 'album',
    label: 'Album',
    videoLabel: null,
    description: null,
    readKeys: ['album'],
    writeKeys: ['album'],
    extraWriteKeys: {},
    multiline: false,
  },
  {
    id: 'year',
    label: 'Year',
    videoLabel: null,
    description: null,
    readKeys: ['date', 'year'],
    // ffmpeg turns `date` into ID3 TDRC, mp4 ©day, Vorbis DATE, RIFF ICRD.
    writeKeys: ['date'],
    extraWriteKeys: {},
    multiline: false,
  },
  {
    id: 'genre',
    label: 'Genre',
    videoLabel: null,
    description: null,
    readKeys: ['genre'],
    writeKeys: ['genre'],
    extraWriteKeys: {},
    multiline: false,
  },
  {
    id: 'comment',
    label: 'Comment',
    videoLabel: null,
    description: null,
    readKeys: ['comment', 'description'],
    writeKeys: ['comment'],
    extraWriteKeys: {},
    multiline: true,
  },
];

export type TagValues = Record<TagFieldId, string>;

export function emptyTagValues(): TagValues {
  return { title: '', author: '', album: '', year: '', genre: '', comment: '' };
}

export function tagFieldLabel(field: TagFieldDescriptor, kind: MediaKind): string {
  return kind === 'video' ? (field.videoLabel ?? field.label) : field.label;
}

/**
 * Tag values become ffmpeg arguments, so they are bounded and stripped of
 * control characters here. A stray newline in a title is not something a user
 * types on purpose, but it does end up in the file and in every player.
 */
const MAX_TAG_LENGTH = 2000;

export function sanitizeTagValue(value: string, multiline: boolean): string {
  let result = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0x0a) {
      // Newlines survive only where the field is meant to hold them.
      if (multiline) result += char;
      else result += ' ';
      continue;
    }
    // Tabs and carriage returns become spaces; other controls are dropped.
    if (code === 0x09 || code === 0x0d) result += ' ';
    else if (code >= 0x20 && code !== 0x7f) result += char;
  }
  return result.slice(0, MAX_TAG_LENGTH).trim();
}

export function sanitizeTagValues(values: Partial<Record<TagFieldId, unknown>>): TagValues {
  const result = emptyTagValues();
  for (const field of TAG_FIELDS) {
    const raw = values[field.id];
    result[field.id] = typeof raw === 'string' ? sanitizeTagValue(raw, field.multiline) : '';
  }
  return result;
}

/** One audio or video stream, as far as the tag editor cares. */
export interface StreamSummary {
  codec: string;
  /** Video only. */
  width: number | null;
  height: number | null;
  /** Audio only. */
  channels: number | null;
  sampleRate: number | null;
  /** Bits per second, when the container reports one per stream. */
  bitrate: number | null;
  /** Audio only: ffmpeg's sample format, without the planar suffix ("s16", "s32", "flt"). */
  sampleFormat: string | null;
}

/** What ffprobe says about a file the user opened. */
export interface MediaInfo {
  path: string;
  fileName: string;
  byteSize: number;
  /** Lowercase, without the dot. */
  ext: string;
  /** ffprobe's `format_long_name`, e.g. "MP2/3 (MPEG audio layer 2/3)". */
  containerLabel: string | null;
  /**
   * From the streams, not from the extension: an mp4 holding only audio is
   * treated as audio, which is what decides the Artist/Author label.
   */
  kind: MediaKind;
  durationSeconds: number | null;
  /** Bits per second. */
  bitrate: number | null;
  audio: StreamSummary | null;
  /** Excludes attached pictures, which ffprobe also reports as video streams. */
  video: StreamSummary | null;
  /** Absolute stream indexes carrying embedded artwork. */
  coverStreamIndexes: readonly number[];
  /** Container-level tags, keys lowercased. */
  tags: Record<string, string>;
}

/**
 * A JPEG prepared by main and ready to embed, plus a preview the renderer can
 * show without reading the file itself.
 */
export interface CoverImage {
  /** Absolute path inside the app's cover temp directory. */
  path: string;
  /** `data:image/jpeg;base64,…` — the renderer has no filesystem access. */
  previewDataUrl: string;
  width: number;
  height: number;
  byteSize: number;
}

export interface OpenedMedia {
  info: MediaInfo;
  /** Current values of the editable fields, read through the field table. */
  tags: TagValues;
  /** Preview of the artwork already embedded, if any. */
  cover: CoverImage | null;
}

/**
 * What to do with artwork on save. `keep` leaves the existing attached picture
 * untouched, which is also how Save As preserves it.
 */
export type CoverChange =
  { kind: 'keep' } | { kind: 'remove' } | { kind: 'replace'; imagePath: string };

export interface SaveTagsRequest {
  sourcePath: string;
  /** Equal to `sourcePath` for a save in place. Must keep the same extension. */
  destinationPath: string;
  tags: TagValues;
  cover: CoverChange;
}

/** Largest side of an embedded cover, in pixels. */
export const COVER_MAX_EDGE = 1000;
