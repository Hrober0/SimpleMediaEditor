import { describe, expect, it } from 'vitest';
import type { Job } from '@shared/jobs';
import { AppFailure } from '../errors';
import { JobQueue, type JobContext } from './queue';

/** A job whose completion the test controls. */
function deferredJob(): {
  run: (context: JobContext) => Promise<void>;
  started: Promise<JobContext>;
  finish: () => void;
  fail: (error: unknown) => void;
} {
  let announceStart: (context: JobContext) => void = () => undefined;
  const started = new Promise<JobContext>((resolve) => {
    announceStart = resolve;
  });

  let finish: () => void = () => undefined;
  let fail: (error: unknown) => void = () => undefined;

  const run = (context: JobContext): Promise<void> => {
    announceStart(context);
    return new Promise<void>((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
  };

  return { run, started, finish: () => finish(), fail: (error) => fail(error) };
}

/** Resolves once the queue reports a job matching the predicate. */
function waitForJob(queue: JobQueue, predicate: (job: Job) => boolean): Promise<Job> {
  return new Promise((resolve) => {
    const check = (jobs: readonly Job[]): boolean => {
      const match = jobs.find(predicate);
      if (match) {
        resolve(match);
        return true;
      }
      return false;
    };
    if (check(queue.list())) return;
    const unsubscribe = queue.onChanged((jobs) => {
      if (check(jobs)) unsubscribe();
    });
  });
}

describe('JobQueue', () => {
  it('runs a job and reports it finished', async () => {
    const queue = new JobQueue(() => 1);
    const job = queue.enqueue({
      kind: 'download',
      label: 'test',
      run: (context) => {
        context.setProgress(0.5);
        context.setDetail('halfway');
        context.setOutputPath('/music/a.mp3');
        return Promise.resolve();
      },
    });

    const done = await waitForJob(queue, (entry) => entry.status === 'done');
    expect(done.id).toBe(job.id);
    expect(done.progress).toBe(1);
    expect(done.outputPath).toBe('/music/a.mp3');
    expect(done.finishedAt).not.toBeNull();
  });

  it('honours the concurrency cap', async () => {
    const queue = new JobQueue(() => 2);
    const jobs = [deferredJob(), deferredJob(), deferredJob()];
    for (const [index, entry] of jobs.entries()) {
      queue.enqueue({ kind: 'download', label: `job ${String(index)}`, run: entry.run });
    }

    await Promise.all([jobs[0]?.started, jobs[1]?.started]);
    expect(queue.list().filter((job) => job.status === 'running')).toHaveLength(2);
    expect(queue.list().filter((job) => job.status === 'queued')).toHaveLength(1);

    jobs[0]?.finish();
    await waitForJob(queue, (job) => job.label === 'job 2' && job.status === 'running');

    jobs[1]?.finish();
    jobs[2]?.finish();
  });

  it('reads the concurrency cap on each pass, so a settings change applies', async () => {
    let limit = 1;
    const queue = new JobQueue(() => limit);
    const first = deferredJob();
    const second = deferredJob();
    queue.enqueue({ kind: 'download', label: 'first', run: first.run });
    queue.enqueue({ kind: 'download', label: 'second', run: second.run });

    await first.started;
    expect(queue.list().filter((job) => job.status === 'running')).toHaveLength(1);

    limit = 2;
    first.finish();
    await second.started;
    first.finish();
    second.finish();
  });

  it('records a failure with the tool output attached', async () => {
    const queue = new JobQueue(() => 1);
    queue.enqueue({
      kind: 'download',
      label: 'failing',
      run: (context) => {
        context.log('ERROR: Video unavailable');
        return Promise.reject(
          new AppFailure('yt-dlp exited with code 1.', 'ERROR: Video unavailable'),
        );
      },
    });

    const failed = await waitForJob(queue, (job) => job.status === 'failed');
    expect(failed.error).toBe('yt-dlp exited with code 1.');
    // The verbatim message is what tells the user what actually went wrong.
    expect(failed.log.join('\n')).toContain('Video unavailable');
    expect(failed.progress).toBeNull();
  });

  it('cancels a queued job without ever starting it', async () => {
    const queue = new JobQueue(() => 1);
    const blocker = deferredJob();
    let secondStarted = false;

    queue.enqueue({ kind: 'download', label: 'blocker', run: blocker.run });
    const waiting = queue.enqueue({
      kind: 'download',
      label: 'waiting',
      run: () => {
        secondStarted = true;
        return Promise.resolve();
      },
    });

    await blocker.started;
    queue.cancel(waiting.id);

    const cancelled = queue.list().find((job) => job.id === waiting.id);
    expect(cancelled?.status).toBe('cancelled');
    expect(secondStarted).toBe(false);

    blocker.finish();
  });

  it('aborts the signal of a running job and reports it cancelled', async () => {
    const queue = new JobQueue(() => 1);
    const entry = deferredJob();
    const job = queue.enqueue({ kind: 'download', label: 'running', run: entry.run });

    const context = await entry.started;
    expect(context.signal.aborted).toBe(false);

    queue.cancel(job.id);
    expect(context.signal.aborted).toBe(true);

    // A cancelled job typically rejects as its process is killed; that must be
    // reported as cancelled, not as a failure the user needs to see.
    entry.fail(new Error('killed'));
    const cancelled = await waitForJob(queue, (candidate) => candidate.status === 'cancelled');
    expect(cancelled.error).toBeNull();
  });

  it('does not let a late progress line overwrite "Cancelling…"', async () => {
    const queue = new JobQueue(() => 1);
    const entry = deferredJob();
    const job = queue.enqueue({ kind: 'download', label: 'running', run: entry.run });

    const context = await entry.started;
    queue.cancel(job.id);
    context.setDetail('Downloading — 99%');

    expect(queue.list().find((candidate) => candidate.id === job.id)?.detail).toBe('Cancelling…');
    entry.finish();
  });

  it('clears finished jobs and keeps active ones', async () => {
    const queue = new JobQueue(() => 2);
    const active = deferredJob();
    queue.enqueue({ kind: 'download', label: 'active', run: active.run });
    queue.enqueue({ kind: 'download', label: 'quick', run: () => Promise.resolve() });

    await waitForJob(queue, (job) => job.status === 'done');
    queue.clearFinished();

    expect(queue.list()).toHaveLength(1);
    expect(queue.list()[0]?.label).toBe('active');
    expect(queue.hasActiveJobs()).toBe(true);

    active.finish();
  });

  it('caps the log so a chatty tool cannot grow it without bound', async () => {
    const queue = new JobQueue(() => 1);
    queue.enqueue({
      kind: 'download',
      label: 'chatty',
      run: (context) => {
        for (let index = 0; index < 500; index += 1) context.log(`line ${String(index)}`);
        return Promise.resolve();
      },
    });

    const done = await waitForJob(queue, (job) => job.status === 'done');
    expect(done.log.length).toBeLessThanOrEqual(200);
    // The most recent lines are the ones that explain a failure.
    expect(done.log.at(-1)).toBe('line 499');
  });

  it('cancels everything on shutdown', async () => {
    const queue = new JobQueue(() => 1);
    const entry = deferredJob();
    queue.enqueue({ kind: 'download', label: 'running', run: entry.run });
    queue.enqueue({ kind: 'download', label: 'queued', run: () => Promise.resolve() });

    const context = await entry.started;
    queue.cancelAll();

    expect(context.signal.aborted).toBe(true);
    expect(queue.list().find((job) => job.label === 'queued')?.status).toBe('cancelled');
    entry.finish();
  });
});
