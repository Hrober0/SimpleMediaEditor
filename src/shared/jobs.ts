/** The job model. Every long-running operation in the app is one of these. */

export type JobKind = 'download' | 'export' | 'normalize' | 'convert';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface Job {
  id: string;
  kind: JobKind;
  label: string;
  status: JobStatus;
  /** 0..1, or null when the stage cannot report progress (post-processing). */
  progress: number | null;
  /** Current stage, speed, ETA — whatever is worth showing on one line. */
  detail: string;
  /** Short failure summary; the verbatim tool output is in `log`. */
  error: string | null;
  /** Tail of the tool's own stdout/stderr, kept verbatim for the error pane. */
  log: string[];
  /** Set once the operation has produced a file on disk. */
  outputPath: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

const ACTIVE_STATUSES: readonly JobStatus[] = ['queued', 'running'];

export function isJobActive(job: Job): boolean {
  return ACTIVE_STATUSES.includes(job.status);
}

export function isJobFinished(job: Job): boolean {
  return !isJobActive(job);
}
