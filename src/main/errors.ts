import type { ErrorInfo } from '@shared/result';

/**
 * A failure with something worth showing the user attached to it — usually the
 * verbatim stderr of ffmpeg or yt-dlp, whose messages answer the question
 * ("video unavailable", "sign in to confirm your age") that a generic
 * "Download failed" would hide.
 */
export class AppFailure extends Error {
  readonly details: string | null;

  constructor(message: string, details: string | null = null) {
    super(message);
    this.name = 'AppFailure';
    this.details = details;
  }
}

export function toErrorInfo(error: unknown): ErrorInfo {
  if (error instanceof AppFailure) {
    return { message: error.message, details: error.details };
  }
  if (error instanceof Error) {
    return { message: error.message, details: error.stack ?? null };
  }
  return { message: String(error), details: null };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
