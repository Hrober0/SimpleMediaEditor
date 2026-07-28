import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@shared/settings';
import { normalizeSettings } from './settings-validation';

/**
 * These values reach spawn arguments and the filesystem, and they come from a
 * file the user can edit by hand. Anything unrecognized has to become a default
 * rather than an error, or a bad settings file would stop the app from starting.
 */
describe('normalizeSettings', () => {
  it('fills in defaults for an empty object', () => {
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid values', () => {
    const result = normalizeSettings({
      downloadTarget: 'mp4',
      audioQuality: '5',
      videoQuality: '720',
      downloadDirectory: 'C:\\Music',
      jobConcurrency: 4,
      restrictFilenames: false,
    });

    expect(result.downloadTarget).toBe('mp4');
    expect(result.audioQuality).toBe('5');
    expect(result.videoQuality).toBe('720');
    expect(result.downloadDirectory).toBe('C:\\Music');
    expect(result.jobConcurrency).toBe(4);
    expect(result.restrictFilenames).toBe(false);
  });

  it('falls back when a choice is not one the app offers', () => {
    const hostile = {
      downloadTarget: 'exe',
      audioQuality: '../../etc',
      videoQuality: '4320',
    } as unknown as Parameters<typeof normalizeSettings>[0];

    const result = normalizeSettings(hostile);
    expect(result.downloadTarget).toBe(DEFAULT_SETTINGS.downloadTarget);
    expect(result.audioQuality).toBe(DEFAULT_SETTINGS.audioQuality);
    expect(result.videoQuality).toBe(DEFAULT_SETTINGS.videoQuality);
  });

  it('clamps concurrency into the supported range', () => {
    expect(normalizeSettings({ jobConcurrency: 0 }).jobConcurrency).toBe(1);
    expect(normalizeSettings({ jobConcurrency: 99 }).jobConcurrency).toBe(8);
    expect(normalizeSettings({ jobConcurrency: 2.6 }).jobConcurrency).toBe(3);
  });

  it('rejects a concurrency that is not a usable number', () => {
    const values = [Number.NaN, Number.POSITIVE_INFINITY, '4' as unknown as number, null];
    for (const value of values) {
      expect(normalizeSettings({ jobConcurrency: value as number }).jobConcurrency).toBe(
        DEFAULT_SETTINGS.jobConcurrency,
      );
    }
  });

  it('treats a blank or non-string directory as unset', () => {
    expect(normalizeSettings({ downloadDirectory: '   ' }).downloadDirectory).toBeNull();
    expect(
      normalizeSettings({ downloadDirectory: 42 as unknown as string }).downloadDirectory,
    ).toBeNull();
  });

  it('never leaves an empty filename template', () => {
    expect(normalizeSettings({ filenameTemplate: '' }).filenameTemplate).toBe(
      DEFAULT_SETTINGS.filenameTemplate,
    );
  });

  it('keeps only paths for tools the app knows, and only as strings', () => {
    const result = normalizeSettings({
      binaryPaths: {
        ffmpeg: '  C:\\tools\\ffmpeg.exe  ',
        ytdlp: '',
        // Not one of the app's tools, and not a string.
        rm: '/bin/rm',
        ffprobe: 7,
      } as unknown as Record<string, string>,
    });

    expect(result.binaryPaths).toEqual({ ffmpeg: 'C:\\tools\\ffmpeg.exe' });
  });

  it('ignores a non-object binaryPaths', () => {
    expect(
      normalizeSettings({ binaryPaths: 'nope' as unknown as Record<string, string> }).binaryPaths,
    ).toEqual({});
  });
});
