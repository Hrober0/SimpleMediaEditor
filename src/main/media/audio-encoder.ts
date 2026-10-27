/**
 * Which encoder re-encoded audio goes through, shared by every write that has to
 * re-encode: Track Edit's precise export and loudness normalization.
 *
 * Stream copy needs none of this. It only matters once audio is decoded, which
 * is also when a lossless file can silently lose bit depth.
 */

/** Per container, so the output can still be opened as what its extension claims. */
const CONTAINER_AUDIO_CODEC: Record<string, string> = {
  mp3: 'libmp3lame',
  m4a: 'aac',
  mp4: 'aac',
  opus: 'libopus',
  flac: 'flac',
  wav: 'pcm_s16le',
  webm: 'libopus',
  mkv: 'aac',
};

/**
 * The sample formats a lossless encoder can be asked to keep. Decoded audio
 * reaches the encoder as floating point after any filter, and left to choose,
 * flac picks 24-bit even for a 16-bit source, which makes the file bigger for
 * nothing.
 */
const KEEPABLE_SAMPLE_FORMATS: Record<string, readonly string[]> = {
  flac: ['s16', 's32'],
};

export function containerAudioCodec(ext: string): string {
  return CONTAINER_AUDIO_CODEC[ext] ?? 'aac';
}

/**
 * The container's encoder, except that a PCM source keeps its own PCM codec:
 * the name carries the bit depth (`pcm_s24le`, `pcm_f32le`), and the
 * container's default would cut a 24-bit WAV down to 16 bits.
 */
export function audioEncoder(ext: string, sourceCodec: string | null): string {
  const encoder = containerAudioCodec(ext);
  return sourceCodec !== null && isPcm(encoder) && isPcm(sourceCodec) ? sourceCodec : encoder;
}

/**
 * Asks the encoder for the source's sample format when it can hold it.
 * `outputStream` is the stream specifier the flag applies to, such as `a:0`.
 */
export function sampleFormatArgs(
  codec: string,
  sourceFormat: string | null,
  outputStream: string,
): string[] {
  const keepable = KEEPABLE_SAMPLE_FORMATS[codec] ?? [];
  return sourceFormat !== null && keepable.includes(sourceFormat)
    ? [`-sample_fmt:${outputStream}`, sourceFormat]
    : [];
}

export function isLossless(codec: string): boolean {
  return codec === 'flac' || isPcm(codec);
}

function isPcm(codec: string): boolean {
  return codec.startsWith('pcm_');
}
