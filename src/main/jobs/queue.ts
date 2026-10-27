import { randomUUID } from 'node:crypto';
import { isJobFinished, type Job, type JobKind } from '@shared/jobs';
import { toErrorInfo } from '../errors';

/**
 * One queue for every module. Downloads, exports and normalization all report
 * progress, cancel, and clean up the same way — there is deliberately no second
 * progress mechanism for a new feature to invent.
 */

export interface JobContext {
  readonly jobId: string;
  /** Aborted when the user cancels or the app is quitting. */
  readonly signal: AbortSignal;
  /** 0..1, or null while in a stage that cannot report progress. */
  setProgress(value: number | null): void;
  setDetail(detail: string): void;
  setOutputPath(path: string): void;
  /** What the job's line says once it is done, in place of "Finished". */
  setFinishedDetail(detail: string): void;
  /** Records a line of tool output verbatim for the error pane. */
  log(line: string): void;
}

export interface JobSpec {
  kind: JobKind;
  label: string;
  run(context: JobContext): Promise<void>;
}

type JobsListener = (jobs: readonly Job[]) => void;

interface JobRecord {
  job: Job;
  spec: JobSpec;
  controller: AbortController;
  /** Set when cancellation was requested, so a rejection is not reported twice. */
  cancelRequested: boolean;
  finishedDetail: string | null;
}

/** Progress lines arrive many times a second; the UI does not need every one. */
const CHANGE_FLUSH_MS = 120;
const LOG_TAIL_LINES = 200;

export class JobQueue {
  private readonly records = new Map<string, JobRecord>();
  private readonly listeners = new Set<JobsListener>();
  private running = 0;
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(private readonly getConcurrency: () => number) {}

  onChanged(listener: JobsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  list(): readonly Job[] {
    return [...this.records.values()].map((record) => snapshot(record.job));
  }

  enqueue(spec: JobSpec): Job {
    const job: Job = {
      id: randomUUID(),
      kind: spec.kind,
      label: spec.label,
      status: 'queued',
      progress: null,
      detail: 'Queued',
      error: null,
      log: [],
      outputPath: null,
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
    };

    this.records.set(job.id, {
      job,
      spec,
      controller: new AbortController(),
      cancelRequested: false,
      finishedDetail: null,
    });
    this.notify({ immediate: true });
    this.pump();
    return snapshot(job);
  }

  cancel(jobId: string): void {
    const record = this.records.get(jobId);
    if (!record || isJobFinished(record.job)) return;

    record.cancelRequested = true;

    if (record.job.status === 'queued') {
      // Never started, so there is nothing to kill and nothing to clean up.
      this.finish(record, 'cancelled', 'Cancelled before starting');
      return;
    }

    record.job.detail = 'Cancelling…';
    record.controller.abort();
    this.notify({ immediate: true });
  }

  /** Used when the app is quitting: stop work and let each job clean up. */
  cancelAll(): void {
    for (const record of this.records.values()) {
      if (!isJobFinished(record.job)) this.cancel(record.job.id);
    }
  }

  clearFinished(): void {
    for (const [id, record] of this.records) {
      if (isJobFinished(record.job)) this.records.delete(id);
    }
    this.notify({ immediate: true });
  }

  hasActiveJobs(): boolean {
    return [...this.records.values()].some((record) => !isJobFinished(record.job));
  }

  private pump(): void {
    const limit = Math.max(1, this.getConcurrency());
    while (this.running < limit) {
      const next = [...this.records.values()].find((record) => record.job.status === 'queued');
      if (!next) return;
      void this.start(next);
    }
  }

  private async start(record: JobRecord): Promise<void> {
    this.running += 1;
    record.job.status = 'running';
    record.job.startedAt = Date.now();
    record.job.detail = 'Starting…';
    this.notify({ immediate: true });

    try {
      await record.spec.run(this.contextFor(record));
      if (record.cancelRequested) {
        this.finish(record, 'cancelled', 'Cancelled');
      } else {
        record.job.progress = 1;
        this.finish(record, 'done', record.finishedDetail ?? 'Finished');
      }
    } catch (error) {
      if (record.cancelRequested) {
        this.finish(record, 'cancelled', 'Cancelled');
      } else {
        const info = toErrorInfo(error);
        record.job.error = info.message;
        if (info.details) appendLog(record.job, info.details);
        this.finish(record, 'failed', info.message);
      }
    } finally {
      this.running -= 1;
      this.pump();
    }
  }

  private contextFor(record: JobRecord): JobContext {
    return {
      jobId: record.job.id,
      signal: record.controller.signal,
      setProgress: (value) => {
        record.job.progress = value === null ? null : Math.min(1, Math.max(0, value));
        this.notify();
      },
      setDetail: (detail) => {
        // A cancel in flight must not be overwritten by a late progress line.
        if (record.cancelRequested) return;
        record.job.detail = detail;
        this.notify();
      },
      setOutputPath: (path) => {
        record.job.outputPath = path;
        this.notify();
      },
      setFinishedDetail: (detail) => {
        record.finishedDetail = detail;
      },
      log: (line) => {
        appendLog(record.job, line);
        this.notify();
      },
    };
  }

  private finish(record: JobRecord, status: Job['status'], detail: string): void {
    record.job.status = status;
    record.job.detail = detail;
    record.job.finishedAt = Date.now();
    if (status !== 'done') record.job.progress = null;
    this.notify({ immediate: true });
  }

  private notify({ immediate = false }: { immediate?: boolean } = {}): void {
    if (immediate) {
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
      this.emit();
      return;
    }
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.emit();
    }, CHANGE_FLUSH_MS);
  }

  private emit(): void {
    const jobs = this.list();
    for (const listener of this.listeners) listener(jobs);
  }
}

function appendLog(job: Job, text: string): void {
  for (const line of text.split('\n')) {
    job.log.push(line);
  }
  if (job.log.length > LOG_TAIL_LINES) {
    job.log.splice(0, job.log.length - LOG_TAIL_LINES);
  }
}

function snapshot(job: Job): Job {
  return { ...job, log: [...job.log] };
}
