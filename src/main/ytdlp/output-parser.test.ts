import { describe, expect, it } from 'vitest';
import { PROGRESS_PREFIX } from './args';
import {
  isPostProcessingStage,
  parseOutputPath,
  parseProgressLine,
  parseStageLine,
} from './output-parser';

/** Builds the line yt-dlp emits for our --progress-template. */
function progressLine(fields: {
  downloaded: string;
  total: string;
  estimate: string;
  speed: string;
  eta: string;
}): string {
  return [
    PROGRESS_PREFIX,
    fields.downloaded,
    fields.total,
    fields.estimate,
    fields.speed,
    fields.eta,
  ].join('|');
}

describe('parseProgressLine', () => {
  it('reports a fraction and a readable summary', () => {
    const result = parseProgressLine(
      progressLine({
        downloaded: '1048576',
        total: '4194304',
        estimate: 'NA',
        speed: '1153434',
        eta: '3',
      }),
    );
    expect(result?.fraction).toBeCloseTo(0.25);
    expect(result?.detail).toBe('Downloading — 25.0% of 4.0 MB at 1.1 MB/s ETA 0:03');
  });

  it('falls back to the estimated total when the real one is unknown', () => {
    const result = parseProgressLine(
      progressLine({
        downloaded: '500',
        total: 'NA',
        estimate: '1000',
        speed: 'NA',
        eta: 'NA',
      }),
    );
    expect(result?.fraction).toBeCloseTo(0.5);
  });

  it('reports no fraction when the size is unknown, rather than guessing', () => {
    const result = parseProgressLine(
      progressLine({ downloaded: '500', total: 'NA', estimate: 'NA', speed: 'NA', eta: 'NA' }),
    );
    expect(result?.fraction).toBeNull();
    expect(result?.detail).toContain('500 B');
  });

  it('never exceeds 1, even if yt-dlp overshoots its estimate', () => {
    const result = parseProgressLine(
      progressLine({ downloaded: '2000', total: 'NA', estimate: '1000', speed: 'NA', eta: 'NA' }),
    );
    expect(result?.fraction).toBe(1);
  });

  it('ignores lines that are not progress', () => {
    expect(parseProgressLine('[download] Destination: a.mp3')).toBeNull();
    expect(parseProgressLine('')).toBeNull();
  });
});

describe('parseStageLine', () => {
  it.each([
    ['[youtube] abc: Downloading webpage', 'Reading video info'],
    ['[download] Destination: /tmp/a.webm', 'Downloading'],
    ['[Merger] Merging formats into "/tmp/a.mp4"', 'Merging audio and video'],
    ['[ExtractAudio] Destination: /tmp/a.mp3', 'Extracting audio'],
    ['[Metadata] Adding metadata to "/tmp/a.mp3"', 'Writing metadata'],
    ['[ThumbnailsConvertor] Converting thumbnail "/tmp/a.webp" to jpg', 'Preparing cover art'],
    ['[EmbedThumbnail] ffmpeg: Adding thumbnail to "/tmp/a.mp3"', 'Embedding cover art'],
    ['[FixupM4a] Correcting container of "/tmp/a.m4a"', 'Fixing container'],
    ['[MoveFiles] Moving file "/tmp/a.mp3" to "/music/a.mp3"', 'Moving into place'],
  ])('recognizes %s', (line, expected) => {
    expect(parseStageLine(line)).toBe(expected);
  });

  it('ignores lines it does not recognize instead of guessing', () => {
    expect(parseStageLine('[info] Downloading 1 format(s): 251')).toBeNull();
    expect(parseStageLine('random noise')).toBeNull();
  });
});

describe('isPostProcessingStage', () => {
  it('treats measurable stages as not post-processing', () => {
    expect(isPostProcessingStage('Downloading')).toBe(false);
    expect(isPostProcessingStage('Reading video info')).toBe(false);
  });

  it('treats the rest as post-processing, so progress becomes indeterminate', () => {
    // Otherwise the bar sits at 100% while ffmpeg transcodes and looks hung.
    expect(isPostProcessingStage('Extracting audio')).toBe(true);
    expect(isPostProcessingStage('Moving into place')).toBe(true);
  });
});

describe('parseOutputPath', () => {
  it.each([
    ['[download] Destination: C:\\tmp\\a.webm', 'C:\\tmp\\a.webm'],
    ['[ExtractAudio] Destination: C:\\tmp\\a.mp3', 'C:\\tmp\\a.mp3'],
    ['[Merger] Merging formats into "C:\\tmp\\a.mp4"', 'C:\\tmp\\a.mp4'],
    ['[download] C:\\music\\a.mp3 has already been downloaded', 'C:\\music\\a.mp3'],
    ['[EmbedThumbnail] ffmpeg: Adding thumbnail to "C:\\tmp\\a.mp3"', 'C:\\tmp\\a.mp3'],
  ])('reads a path from %s', (line, expected) => {
    expect(parseOutputPath(line)).toBe(expected);
  });

  it('takes the destination, not the source, from a move', () => {
    // This is the only line naming the final file when intermediates live in a
    // temp directory, so getting the capture backwards would report a deleted path.
    expect(parseOutputPath('[MoveFiles] Moving file "C:\\tmp\\a.mp3" to "C:\\music\\a.mp3"')).toBe(
      'C:\\music\\a.mp3',
    );
  });

  it('returns null for lines without a path', () => {
    expect(parseOutputPath('[info] Downloading 1 format(s): 251')).toBeNull();
    expect(parseOutputPath('[download] 100% of 4.00MiB')).toBeNull();
  });
});
