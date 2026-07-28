import { describe, expect, it } from 'vitest';
import type { DownloadItem, DownloadOptions } from '@shared/download';
import {
  PROGRESS_TEMPLATE,
  buildDownloadArgs,
  buildInspectArgs,
  outputTemplate,
  videoFormatSelector,
} from './args';

const item: DownloadItem = { url: 'https://youtu.be/abc', title: 'A song', filename: null };

const mp3: DownloadOptions = {
  target: 'mp3',
  audioQuality: '0',
  videoQuality: 'best',
  destination: '/music',
  filenameTemplate: '%(title)s.%(ext)s',
  restrictFilenames: true,
};

const context = { destination: '/music', tempDirectory: '/tmp/job', ffmpegDirectory: '/bin' };

/** Reads the value that follows a flag, so tests do not depend on argument order. */
function valueOf(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

describe('buildInspectArgs', () => {
  it('asks for one JSON document without expanding playlist entries', () => {
    const args = buildInspectArgs('https://youtu.be/abc');
    expect(args).toContain('--dump-single-json');
    expect(args).toContain('--flat-playlist');
  });

  it('puts the URL after -- so it can never be read as a flag', () => {
    const args = buildInspectArgs('--version');
    expect(args.at(-2)).toBe('--');
    expect(args.at(-1)).toBe('--version');
  });

  it('ignores the user global yt-dlp config', () => {
    expect(buildInspectArgs('https://youtu.be/abc')).toContain('--ignore-config');
  });
});

describe('buildDownloadArgs', () => {
  it('requests machine-readable progress on its own lines', () => {
    const args = buildDownloadArgs(item, mp3, context);
    expect(args).toContain('--newline');
    expect(valueOf(args, '--progress-template')).toBe(PROGRESS_TEMPLATE);
  });

  it('never expands a playlist, since each entry is its own job', () => {
    expect(buildDownloadArgs(item, mp3, context)).toContain('--no-playlist');
  });

  it('keeps partial files in the job temp directory and finished files in the destination', () => {
    const args = buildDownloadArgs(item, mp3, context);
    expect(args).toContain('home:/music');
    expect(args).toContain('temp:/tmp/job');
  });

  it('extracts audio as mp3 with tags and JPEG cover art', () => {
    const args = buildDownloadArgs(item, mp3, context);
    expect(args).toContain('--extract-audio');
    expect(valueOf(args, '--audio-format')).toBe('mp3');
    expect(valueOf(args, '--audio-quality')).toBe('0');
    expect(args).toContain('--embed-thumbnail');
    expect(args).toContain('--embed-metadata');
    // PNG art is what players silently ignore in an ID3 APIC frame.
    expect(valueOf(args, '--convert-thumbnails')).toBe('jpg');
  });

  it('does not ask for embedded art on mp4, which would need AtomicParsley', () => {
    const args = buildDownloadArgs(item, { ...mp3, target: 'mp4' }, context);
    expect(args).not.toContain('--embed-thumbnail');
    expect(args).toContain('--embed-metadata');
    expect(valueOf(args, '--merge-output-format')).toBe('mp4');
  });

  it('always produces Windows-safe names, and restricts further on request', () => {
    const args = buildDownloadArgs(item, mp3, context);
    expect(args).toContain('--windows-filenames');
    expect(args).toContain('--restrict-filenames');

    const relaxed = buildDownloadArgs(item, { ...mp3, restrictFilenames: false }, context);
    expect(relaxed).toContain('--windows-filenames');
    expect(relaxed).not.toContain('--restrict-filenames');
  });

  it('points yt-dlp at the resolved ffmpeg, and omits the flag when unknown', () => {
    expect(valueOf(buildDownloadArgs(item, mp3, context), '--ffmpeg-location')).toBe('/bin');

    const withoutFfmpeg = buildDownloadArgs(item, mp3, { ...context, ffmpegDirectory: null });
    expect(withoutFfmpeg).not.toContain('--ffmpeg-location');
  });

  it('puts the URL after -- so a hostile title or URL cannot inject a flag', () => {
    const args = buildDownloadArgs({ ...item, url: '--exec' }, mp3, context);
    expect(args.at(-2)).toBe('--');
    expect(args.at(-1)).toBe('--exec');
  });
});

describe('outputTemplate', () => {
  it('uses the template when no explicit name was given', () => {
    expect(outputTemplate(item, mp3)).toBe('%(title)s.%(ext)s');
  });

  it('appends the extension yt-dlp decides on', () => {
    expect(outputTemplate({ ...item, filename: 'My Song' }, mp3)).toBe('My Song.%(ext)s');
  });

  it('does not double up an extension the user typed', () => {
    expect(outputTemplate({ ...item, filename: 'My Song.mp3' }, mp3)).toBe('My Song.%(ext)s');
  });

  it('escapes percent signs so a literal name is not read as a field', () => {
    // Unescaped, "50%" would make yt-dlp fail or invent a name.
    expect(outputTemplate({ ...item, filename: '50% Off' }, mp3)).toBe('50%% Off.%(ext)s');
  });
});

describe('videoFormatSelector', () => {
  it('prefers streams that mux into mp4 without re-encoding', () => {
    expect(videoFormatSelector('best').startsWith('bestvideo[ext=mp4]+bestaudio[ext=m4a]')).toBe(
      true,
    );
  });

  it('caps height when a quality is chosen', () => {
    expect(videoFormatSelector('720')).toContain('[height<=720]');
    expect(videoFormatSelector('best')).not.toContain('height<=');
  });

  it('always ends in a fallback, so an unusual video still downloads', () => {
    expect(videoFormatSelector('1080').split('/').at(-1)).toBe('best');
  });
});
