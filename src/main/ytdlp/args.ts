import type { JsRuntime } from '@shared/binaries';
import type { DownloadItem, DownloadOptions, VideoQuality } from '@shared/download';
import { stripKnownExtension } from '@shared/filenames';

/**
 * yt-dlp argument construction, kept pure and separate from spawning so the flags
 * can be read (and reasoned about) without following the process plumbing.
 */

/** Marks progress lines so they can be told apart from yt-dlp's normal output. */
export const PROGRESS_PREFIX = '@@progress@@';

/** Marks the one line naming the finished file. */
export const OUTPUT_PATH_PREFIX = '@@output@@';

/**
 * A machine-readable progress line, rather than scraping the human-facing
 * "[download]  42.3% of 4.21MiB at 1.10MiB/s ETA 00:03" text whose format is not
 * a stable interface.
 */
export const PROGRESS_TEMPLATE = [
  `download:${PROGRESS_PREFIX}`,
  '%(progress.downloaded_bytes)s',
  '%(progress.total_bytes)s',
  '%(progress.total_bytes_estimate)s',
  '%(progress.speed)s',
  '%(progress.eta)s',
].join('|');

/**
 * Asks yt-dlp to name the finished file itself, once, after it has been moved
 * into the destination. The alternative is scraping the stage lines, which is
 * guesswork: they are human-facing wording and only some of them name the file
 * that survives post-processing.
 */
export const OUTPUT_PATH_TEMPLATE = `after_move:${OUTPUT_PATH_PREFIX}%(filepath)s`;

/**
 * `--ignore-config` keeps a user's global yt-dlp config from silently changing
 * output paths or formats under the app. `--no-colors` keeps ANSI escapes out of
 * the log we show verbatim. `--encoding utf-8` is what makes the output decodable
 * at all: yt-dlp otherwise writes it in the console codepage, and on Windows a
 * path like "Żółć.mp3" then arrives as bytes that are not valid UTF-8, so the
 * file the app just downloaded cannot be found again.
 */
const BASE_ARGS: readonly string[] = ['--ignore-config', '--no-colors', '--encoding', 'utf-8'];

/**
 * YouTube withholds usable formats from the clients yt-dlp reaches for on its
 * own: most now require a GVS PO token, and android_vr, which does not, is
 * served URLs that answer HTTP 403. `web_embedded` needs no token and still
 * offers the full format ladder, so it goes first, with yt-dlp's defaults kept
 * behind it for videos that cannot be embedded. This belongs here only until
 * yt-dlp's own defaults work again.
 */
const YOUTUBE_CLIENT_ARGS: readonly string[] = [
  '--extractor-args',
  'youtube:player_client=web_embedded,default',
];

/**
 * Without a runtime to solve YouTube's JavaScript challenges with, the format
 * URLs are unsigned and the download fails with HTTP 403. yt-dlp searches for
 * Deno by itself but never for Node, so whichever was resolved is named here.
 */
function jsRuntimeArgs(runtime: JsRuntime | null): string[] {
  if (!runtime) return [];
  return ['--js-runtimes', runtime.path ? `${runtime.name}:${runtime.path}` : runtime.name];
}

export function buildInspectArgs(url: string, jsRuntime: JsRuntime | null): string[] {
  return [
    ...BASE_ARGS,
    ...jsRuntimeArgs(jsRuntime),
    ...YOUTUBE_CLIENT_ARGS,
    '--dump-single-json',
    // Playlist entries are listed without fetching each video's full metadata.
    '--flat-playlist',
    '--no-progress',
    // Everything after `--` is a URL, never a flag, whatever the user pasted.
    '--',
    url,
  ];
}

export interface DownloadArgsContext {
  /** Final directory for the finished file. */
  destination: string;
  /** Job-owned directory for partial and intermediate files. */
  tempDirectory: string;
  /** Directory holding the ffmpeg/ffprobe the app resolved, if known. */
  ffmpegDirectory: string | null;
  /** The JavaScript runtime the app resolved, if any was found. */
  jsRuntime: JsRuntime | null;
}

export function buildDownloadArgs(
  item: DownloadItem,
  options: DownloadOptions,
  context: DownloadArgsContext,
): string[] {
  return [
    ...BASE_ARGS,
    ...jsRuntimeArgs(context.jsRuntime),
    ...YOUTUBE_CLIENT_ARGS,
    // Progress on its own lines; without this it is carriage-return updates.
    '--newline',
    '--progress-template',
    PROGRESS_TEMPLATE,
    '--print',
    OUTPUT_PATH_TEMPLATE,
    // --print turns on --quiet, which would take the progress lines and the
    // verbatim tool output with it. It has to be undone after the flag that
    // implied it.
    '--no-quiet',
    // Each playlist entry is queued as its own job, so a URL is never expanded here.
    '--no-playlist',
    // Windows-safe names on Linux too, so a library moves between the two.
    '--windows-filenames',
    ...(options.restrictFilenames ? ['--restrict-filenames'] : []),
    ...(context.ffmpegDirectory ? ['--ffmpeg-location', context.ffmpegDirectory] : []),
    // Partial and intermediate files stay in a directory the job owns, so
    // cancelling means deleting one directory rather than guessing at .part files.
    '--paths',
    `home:${context.destination}`,
    '--paths',
    `temp:${context.tempDirectory}`,
    '--output',
    outputTemplate(item, options),
    ...targetArgs(options),
    '--',
    item.url,
  ];
}

/**
 * A per-item name wins over the template. It is a literal, so `%` has to be
 * escaped — otherwise a title like "50% Off" would be read as a field reference
 * and yt-dlp would fail or produce a surprising name.
 */
export function outputTemplate(item: DownloadItem, options: DownloadOptions): string {
  if (!item.filename) return options.filenameTemplate;

  const base = stripKnownExtension(item.filename).replaceAll('%', '%%');
  // The extension is yt-dlp's to fill in: it knows what post-processing produced.
  return `${base}.%(ext)s`;
}

function targetArgs(options: DownloadOptions): string[] {
  if (options.target === 'mp3') {
    return [
      '--extract-audio',
      '--audio-format',
      'mp3',
      '--audio-quality',
      options.audioQuality,
      // Cover art and tags arrive already embedded, which is most of what the
      // meta editor would otherwise have to do afterwards.
      '--embed-thumbnail',
      '--embed-metadata',
      // yt-dlp would otherwise embed the thumbnail as PNG, which several players
      // silently ignore in an ID3 APIC frame. JPEG is the reliable choice.
      '--convert-thumbnails',
      'jpg',
    ];
  }

  return [
    '--format',
    videoFormatSelector(options.videoQuality),
    '--merge-output-format',
    'mp4',
    '--embed-metadata',
    // No --embed-thumbnail for mp4: yt-dlp needs AtomicParsley for the covr atom,
    // which is not one of the app's dependencies. Cover art for video is set in
    // the meta editor through ffmpeg instead.
  ];
}

/**
 * Prefers streams that mux into mp4 without re-encoding, then falls back so an
 * unusual video still downloads rather than failing outright.
 */
export function videoFormatSelector(quality: VideoQuality): string {
  const limit = quality === 'best' ? '' : `[height<=${quality}]`;
  return [
    `bestvideo[ext=mp4]${limit}+bestaudio[ext=m4a]`,
    `bestvideo${limit}+bestaudio`,
    `best[ext=mp4]${limit}`,
    'best',
  ].join('/');
}
