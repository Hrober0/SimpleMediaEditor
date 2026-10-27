/**
 * What ffmpeg's `loudnorm` filter reports with `print_format=json`.
 *
 * The block is printed to stderr once the input has been read to the end, after
 * a `[Parsed_loudnorm_0 @ ...]` line. Every value arrives as a string, and
 * `-inf` stands for silence.
 */

interface LoudnormLevels {
  inputIntegrated: number;
  inputTruePeak: number;
  inputRange: number;
  inputThreshold: number;
  outputIntegrated: number;
  outputTruePeak: number;
  targetOffset: number;
}

export interface LoudnormStats extends LoudnormLevels {
  /** "linear" when one gain was applied, "dynamic" when loudnorm had to compress. */
  normalizationType: string;
}

export function parseLoudnormStats(stderrLines: readonly string[]): LoudnormStats | null {
  const start = stderrLines.findLastIndex((line) => line.trim() === '{');
  if (start === -1) return null;
  const end = stderrLines.findIndex((line, index) => index > start && line.trim() === '}');
  if (end === -1) return null;

  const values = parseObject(stderrLines.slice(start, end + 1).join('\n'));
  if (!values) return null;

  const levels = {
    inputIntegrated: asLevel(values.input_i),
    inputTruePeak: asLevel(values.input_tp),
    inputRange: asLevel(values.input_lra),
    inputThreshold: asLevel(values.input_thresh),
    outputIntegrated: asLevel(values.output_i),
    outputTruePeak: asLevel(values.output_tp),
    targetOffset: asLevel(values.target_offset),
  };
  if (!hasEveryLevel(levels)) return null;

  const type = values.normalization_type;
  return { ...levels, normalizationType: typeof type === 'string' ? type : '' };
}

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function hasEveryLevel(
  levels: Record<keyof LoudnormLevels, number | null>,
): levels is LoudnormLevels {
  return Object.values(levels).every((value) => value !== null);
}

function asLevel(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === '-inf') return Number.NEGATIVE_INFINITY;
  if (text === 'inf' || text === '+inf') return Number.POSITIVE_INFINITY;
  const parsed = Number.parseFloat(text);
  return Number.isNaN(parsed) ? null : parsed;
}

/** The before and after a finished job reports, so the result can be checked. */
export function describeLoudnessChange(before: LoudnormStats, after: LoudnormStats | null): string {
  const was = `Was ${formatLufs(before.inputIntegrated)}`;
  if (!after) return `${was}, now normalized`;

  const now = `${was}, now ${formatLufs(after.outputIntegrated)}`;
  // Dynamic mode means loudnorm could not reach the target with one gain without
  // crossing the peak limit, so it compressed. That changes how the track sounds.
  return after.normalizationType === 'dynamic' ? `${now}, compressed to fit the peak limit` : now;
}

export function formatLufs(value: number): string {
  return Number.isFinite(value) ? `${value.toFixed(1)} LUFS` : 'silent';
}
