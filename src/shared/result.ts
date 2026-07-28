/**
 * Failures that carry information the user needs (yt-dlp / ffmpeg stderr) are
 * modelled as data rather than thrown: Electron strips custom properties from
 * errors crossing the IPC boundary, so `details` would not survive a throw.
 */

export interface ErrorInfo {
  /** One-line summary, safe to show in an Alert title. */
  message: string;
  /** Verbatim tool output. Long — belongs in a collapsible pane. */
  details: string | null;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: ErrorInfo };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T>(message: string, details: string | null = null): Result<T> {
  return { ok: false, error: { message, details } };
}
