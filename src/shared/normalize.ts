/**
 * Loudness normalization: the targets offered and the request the renderer sends.
 *
 * Targets are integrated loudness in LUFS, measured the EBU R128 way. The list is
 * data so the panel and the request validation agree on what is allowed.
 */

export type LoudnessTarget = -14 | -16 | -23;

export interface LoudnessTargetDescriptor {
  lufs: LoudnessTarget;
  label: string;
  /** Where this target is the norm, so the choice means something to the user. */
  note: string;
}

export const LOUDNESS_TARGETS: readonly LoudnessTargetDescriptor[] = [
  { lufs: -14, label: '-14 LUFS', note: 'Streaming: Spotify, YouTube, Tidal.' },
  { lufs: -16, label: '-16 LUFS', note: 'Apple Music and most podcasts.' },
  { lufs: -23, label: '-23 LUFS', note: 'EBU R128 broadcast.' },
];

export const DEFAULT_LOUDNESS_TARGET: LoudnessTarget = -14;

/**
 * The true peak ceiling every target shares. A file pushed up to -14 LUFS would
 * otherwise clip once a lossy encoder adds its own overshoot.
 */
export const TRUE_PEAK_LIMIT_DBTP = -1.5;

/** Where normalized files go: over the originals, or into a folder of copies. */
export type NormalizeOutput = { kind: 'replace' } | { kind: 'folder'; directory: string };

export interface NormalizeRequest {
  paths: readonly string[];
  targetLufs: LoudnessTarget;
  output: NormalizeOutput;
}

/** One job per file, keyed by the path the renderer sent, so each file can show its own. */
export interface NormalizeJobs {
  jobIdsByPath: Record<string, string>;
}
