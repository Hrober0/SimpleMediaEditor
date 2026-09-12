import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WaveformPeaks } from '@shared/waveform';
import { downsamplePcm } from '@shared/waveform';
import { AppFailure } from '../errors';
import { runProcess } from '../jobs/runner';

/**
 * Waveform peaks for the timeline, computed here rather than in the renderer.
 *
 * ffmpeg decodes to raw PCM in a temp file — never piped through `runProcess`,
 * whose stdout capture is UTF-8 text and would corrupt binary samples — and
 * the file is read back as a whole. A single mono 8kHz track is small even
 * for a long file (about 1 MB per two minutes), so reading it into memory in
 * one pass is not the risk decoding the *source* file in the renderer would be.
 */

const PEAK_SAMPLE_RATE = 8000;
/** Long enough for a full-length film's audio to decode. */
const WAVEFORM_TIMEOUT_MS = 5 * 60 * 1000;

export interface WaveformDeps {
  ffmpegPath: string;
  signal?: AbortSignal;
}

export function buildPcmArgs(sourcePath: string, outputPath: string): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-i',
    sourcePath,
    '-vn',
    '-map',
    '0:a:0?',
    '-ac',
    '1',
    '-ar',
    String(PEAK_SAMPLE_RATE),
    '-f',
    's16le',
    outputPath,
  ];
}

export async function computeWaveformPeaks(
  sourcePath: string,
  durationSeconds: number,
  bucketCount: number,
  deps: WaveformDeps,
): Promise<WaveformPeaks> {
  const directory = join(tmpdir(), 'mediaeditor', 'waveform');
  await mkdir(directory, { recursive: true });
  const pcmPath = join(directory, `${randomUUID()}.pcm`);

  try {
    const result = await runProcess({
      binary: deps.ffmpegPath,
      args: buildPcmArgs(sourcePath, pcmPath),
      signal: deps.signal,
      timeoutMs: WAVEFORM_TIMEOUT_MS,
    });

    if (result.terminated) {
      throw new AppFailure('ffmpeg took too long to read the audio for the waveform.');
    }
    if (result.code !== 0) {
      throw new AppFailure('The waveform could not be generated.', result.stderrTail.join('\n'));
    }

    const bytes = await readFile(pcmPath);
    const samples = new Int16Array(
      bytes.buffer,
      bytes.byteOffset,
      Math.floor(bytes.byteLength / 2),
    );
    const peaks = downsamplePcm(samples, 1, bucketCount);
    return { durationSeconds, peaks };
  } finally {
    await rm(pcmPath, { force: true }).catch(() => undefined);
  }
}
