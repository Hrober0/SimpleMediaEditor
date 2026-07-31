import { BINARY_DESCRIPTORS, type BinaryId } from '@shared/binaries';
import { AUDIO_QUALITIES, DOWNLOAD_TARGETS, VIDEO_QUALITIES } from '@shared/download';
import { DEFAULT_SETTINGS, JOB_CONCURRENCY_RANGE, type AppSettings } from '@shared/settings';

/**
 * Settings validation, kept separate from persistence so it can be exercised
 * directly: anything read from disk or arriving over IPC is untrusted, and these
 * values end up as spawn arguments and filesystem destinations.
 *
 * Unknown or out-of-range values fall back to the default rather than throwing —
 * a hand-edited settings file should not stop the app from starting.
 */
export function normalizeSettings(settings: Partial<AppSettings>): AppSettings {
  const merged = { ...DEFAULT_SETTINGS, ...settings };

  return {
    binaryPaths: normalizeBinaryPaths(merged.binaryPaths),
    downloadDirectory: nonEmptyString(merged.downloadDirectory),
    downloadTarget: pick(
      DOWNLOAD_TARGETS.map((target) => target.id),
      merged.downloadTarget,
      DEFAULT_SETTINGS.downloadTarget,
    ),
    audioQuality: pick(
      AUDIO_QUALITIES.map((quality) => quality.value),
      merged.audioQuality,
      DEFAULT_SETTINGS.audioQuality,
    ),
    videoQuality: pick(
      VIDEO_QUALITIES.map((quality) => quality.value),
      merged.videoQuality,
      DEFAULT_SETTINGS.videoQuality,
    ),
    filenameTemplate: nonEmptyString(merged.filenameTemplate) ?? DEFAULT_SETTINGS.filenameTemplate,
    restrictFilenames: Boolean(merged.restrictFilenames),
    openInMetaEditorAfterDownload: Boolean(merged.openInMetaEditorAfterDownload),
    jobConcurrency: clampConcurrency(merged.jobConcurrency),
  };
}

/** Only paths for tools the app knows about survive, and only as strings. */
function normalizeBinaryPaths(value: unknown): Partial<Record<BinaryId, string>> {
  if (!isRecord(value)) return {};

  const result: Partial<Record<BinaryId, string>> = {};
  for (const { id } of BINARY_DESCRIPTORS) {
    const entry = value[id];
    if (typeof entry === 'string' && entry.trim()) result[id] = entry.trim();
  }
  return result;
}

function pick<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function clampConcurrency(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_SETTINGS.jobConcurrency;
  }
  const rounded = Math.round(value);
  return Math.min(JOB_CONCURRENCY_RANGE.max, Math.max(JOB_CONCURRENCY_RANGE.min, rounded));
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
