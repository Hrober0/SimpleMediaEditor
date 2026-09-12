import type { JsRuntime } from '@shared/binaries';
import type { MediaSourceEntry, UrlInspection } from '@shared/download';
import { AppFailure } from '../errors';
import { runProcess } from '../jobs/runner';
import { buildInspectArgs } from './args';

/**
 * Reads what a URL points at before committing to a download, so a mistyped or
 * unavailable link is obvious in the UI instead of turning into a failed job.
 */

/** Generous: yt-dlp may retry extraction, but a hang must not be permanent. */
const INSPECT_TIMEOUT_MS = 60_000;

export interface InspectDeps {
  ytdlpPath: string;
  /** Extraction reads the player script, which needs a runtime to run it. */
  jsRuntime: JsRuntime | null;
  signal?: AbortSignal;
}

export async function inspectUrl(rawUrl: string, deps: InspectDeps): Promise<UrlInspection> {
  const url = requireHttpUrl(rawUrl);

  const result = await runProcess({
    binary: deps.ytdlpPath,
    args: buildInspectArgs(url, deps.jsRuntime),
    captureStdout: true,
    timeoutMs: INSPECT_TIMEOUT_MS,
    signal: deps.signal,
  });

  if (result.terminated) {
    throw new AppFailure('yt-dlp took too long to read that URL and was stopped.');
  }
  if (result.code !== 0) {
    // yt-dlp's own message is the useful part ("Video unavailable", "Sign in to
    // confirm your age"), so it is passed through untouched.
    throw new AppFailure('yt-dlp could not read that URL.', result.stderrTail.join('\n'));
  }

  return parseInspection(result.stdout, url);
}

function requireHttpUrl(value: string): string {
  const trimmed = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new AppFailure('That does not look like a URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AppFailure(`Only http and https URLs are supported (got "${parsed.protocol}").`);
  }
  return trimmed;
}

/**
 * Exported so the shape-handling can be exercised directly: yt-dlp's JSON varies
 * by extractor and by whether the URL was a video or a playlist, and every field
 * here is optional in practice.
 */
export function parseInspection(stdout: string, requestedUrl: string): UrlInspection {
  const root = parseJsonObject(stdout);

  if (root._type === 'playlist') {
    const entries = asArray(root.entries)
      .map((entry) => toEntry(entry, requestedUrl))
      .filter((entry): entry is MediaSourceEntry => entry !== null);

    if (entries.length === 0) {
      throw new AppFailure('That playlist contains no downloadable entries.');
    }

    return {
      kind: 'playlist',
      title: asString(root.title) ?? 'Playlist',
      uploader: asString(root.uploader) ?? asString(root.channel),
      entries,
    };
  }

  const single = toEntry(root, requestedUrl);
  if (!single) {
    throw new AppFailure('yt-dlp returned no usable information for that URL.');
  }

  return { kind: 'video', title: single.title, uploader: single.uploader, entries: [single] };
}

function toEntry(value: unknown, requestedUrl: string): MediaSourceEntry | null {
  if (!isRecord(value)) return null;

  const id = asString(value.id);
  const url = asString(value.webpage_url) ?? asString(value.url) ?? (id ? watchUrl(id) : null);
  if (!url) return null;

  return {
    id: id ?? url,
    url,
    title: asString(value.title) ?? asString(value.fulltitle) ?? requestedUrl,
    uploader: asString(value.uploader) ?? asString(value.channel) ?? asString(value.creator),
    durationSeconds: asNumber(value.duration),
    thumbnailUrl: bestThumbnail(value),
  };
}

/**
 * Flat playlist entries sometimes carry only an id. Building the canonical watch
 * URL keeps each entry downloadable as its own job.
 */
function watchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
}

function bestThumbnail(value: Record<string, unknown>): string | null {
  const direct = asString(value.thumbnail);
  if (direct) return direct;

  // `thumbnails` is ordered worst-to-best; the last entry with a URL wins.
  for (const candidate of [...asArray(value.thumbnails)].reverse()) {
    if (!isRecord(candidate)) continue;
    const url = asString(candidate.url);
    if (url) return url;
  }
  return null;
}

function parseJsonObject(stdout: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (!isRecord(parsed)) throw new Error('expected a JSON object');
    return parsed;
  } catch (error) {
    throw new AppFailure(
      'yt-dlp returned output the app could not read.',
      error instanceof Error ? error.message : String(error),
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
