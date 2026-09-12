/**
 * Waveform peaks: a min/max pair per bucket, downsampled in the main process
 * from raw PCM so the renderer never decodes a whole file itself — a long
 * file's samples would exhaust renderer memory long before the timeline
 * needed that much detail.
 */

export interface WaveformPeaks {
  durationSeconds: number;
  /** `[min0, max0, min1, max1, …]`, each in -1..1. */
  peaks: readonly number[];
}

/**
 * Reduces interleaved 16-bit PCM samples to `bucketCount` min/max pairs.
 *
 * Pure so the bucketing math can be tested without spawning ffmpeg. Samples
 * are averaged across channels first, since the timeline shows one waveform
 * regardless of the source's channel count.
 */
export function downsamplePcm(
  samples: Int16Array,
  channelCount: number,
  bucketCount: number,
): number[] {
  const frameCount = channelCount > 0 ? Math.floor(samples.length / channelCount) : 0;
  if (frameCount === 0 || bucketCount <= 0) return [];

  const peaks: number[] = new Array<number>(bucketCount * 2).fill(0);
  const framesPerBucket = frameCount / bucketCount;

  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = Math.floor(bucket * framesPerBucket);
    const end = Math.max(start + 1, Math.floor((bucket + 1) * framesPerBucket));
    let min = Infinity;
    let max = -Infinity;

    for (let frame = start; frame < end && frame < frameCount; frame += 1) {
      let sum = 0;
      for (let channel = 0; channel < channelCount; channel += 1) {
        sum += samples[frame * channelCount + channel] ?? 0;
      }
      const value = sum / channelCount / 32768;
      if (value < min) min = value;
      if (value > max) max = value;
    }

    peaks[bucket * 2] = Number.isFinite(min) ? min : 0;
    peaks[bucket * 2 + 1] = Number.isFinite(max) ? max : 0;
  }

  return peaks;
}
