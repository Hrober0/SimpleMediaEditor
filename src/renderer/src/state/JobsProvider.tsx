import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useDisclosure, useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { isJobActive, isJobFinished, type Job, type JobStatus } from '@shared/jobs';
import { api } from '../api';
import { JOBS_PANEL_MEDIA_QUERY } from '../layout';
import { JobsContext, type JobsContextValue } from './JobsContext';

/**
 * Holds the job list for the whole app. Main owns the state and pushes it here,
 * so this never polls and never keeps a second copy of progress.
 */
export function JobsProvider({ children }: { children: ReactNode }): ReactNode {
  const [jobs, setJobs] = useState<readonly Job[]>([]);
  const previousStatuses = useRef(new Map<string, JobStatus>());
  // The latest list outside of render, so a job that finished before anyone asked
  // about it is still answerable.
  const latestJobs = useRef<readonly Job[]>([]);
  const waiters = useRef(new Map<string, ((job: Job | null) => void)[]>());

  useEffect(() => {
    const receive = (next: readonly Job[]): void => {
      latestJobs.current = next;
      setJobs(next);
      resolveWaiters(waiters.current, next);
    };
    // Subscribe before the initial read so a job starting in between is not missed.
    const unsubscribe = api.onJobsChanged(receive);
    void api.listJobs().then(receive);
    return unsubscribe;
  }, []);

  const waitForJob = useCallback(
    (jobId: string) =>
      new Promise<Job | null>((resolve) => {
        // Already finished by the time we were asked — which is the common case
        // for a small file, since the push can arrive before the caller returns.
        const current = latestJobs.current.find((job) => job.id === jobId);
        if (current && isJobFinished(current)) {
          resolve(current);
          return;
        }
        const pending = waiters.current.get(jobId) ?? [];
        pending.push(resolve);
        waiters.current.set(jobId, pending);
      }),
    [],
  );

  useEffect(() => {
    const seen = previousStatuses.current;
    for (const job of jobs) {
      const previous = seen.get(job.id);
      seen.set(job.id, job.status);
      if (previous === undefined || previous === job.status) continue;
      notifyStatusChange(job);
    }
    for (const id of [...seen.keys()]) {
      if (!jobs.some((job) => job.id === id)) seen.delete(id);
    }
  }, [jobs]);

  const cancel = useCallback((jobId: string) => {
    void api.cancelJob(jobId);
  }, []);

  const clearFinished = useCallback(() => {
    void api.clearFinishedJobs();
  }, []);

  const showInFolder = useCallback((path: string) => {
    void api.showInFolder(path).catch((error: unknown) => {
      notifications.show({
        color: 'red',
        title: 'Could not open that folder',
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }, []);

  const [drawerOpened, drawerHandlers] = useDisclosure(false);
  // Open by default: the side panel is the normal state on a wide window,
  // same as before this could be closed at all.
  const [asideOpened, asideHandlers] = useDisclosure(true);

  // Evaluated immediately rather than after an effect, so queueing something in
  // the first moments after startup still opens the right surface.
  const panelVisible = useMediaQuery(JOBS_PANEL_MEDIA_QUERY, false, {
    getInitialValueInEffect: false,
  });

  const revealJobs = useCallback(() => {
    if (panelVisible) asideHandlers.open();
    else drawerHandlers.open();
  }, [panelVisible, asideHandlers, drawerHandlers]);

  const toggleJobs = useCallback(() => {
    if (panelVisible) asideHandlers.toggle();
    else drawerHandlers.toggle();
  }, [panelVisible, asideHandlers, drawerHandlers]);

  const value = useMemo<JobsContextValue>(
    () => ({
      jobs,
      activeCount: jobs.filter(isJobActive).length,
      cancel,
      clearFinished,
      showInFolder,
      waitForJob,
      revealJobs,
      toggleJobs,
      asideOpened,
      drawerOpened,
      closeDrawer: drawerHandlers.close,
    }),
    [
      jobs,
      cancel,
      clearFinished,
      showInFolder,
      waitForJob,
      revealJobs,
      toggleJobs,
      asideOpened,
      drawerOpened,
      drawerHandlers.close,
    ],
  );

  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>;
}

/**
 * Wakes anything waiting on a job that has just finished — or that has been
 * cleared from the list, which would otherwise leave a caller waiting forever.
 */
function resolveWaiters(
  waiters: Map<string, ((job: Job | null) => void)[]>,
  jobs: readonly Job[],
): void {
  for (const [jobId, callbacks] of [...waiters]) {
    const job = jobs.find((candidate) => candidate.id === jobId);
    if (job && !isJobFinished(job)) continue;

    waiters.delete(jobId);
    for (const callback of callbacks) callback(job ?? null);
  }
}

/**
 * Toasts are for outcomes only. Progress belongs in the job drawer, where it can
 * be watched without covering the app.
 */
function notifyStatusChange(job: Job): void {
  if (job.status === 'done') {
    notifications.show({ color: 'teal', title: 'Finished', message: job.label });
    return;
  }
  if (job.status === 'failed') {
    notifications.show({
      color: 'red',
      title: job.label,
      // The verbatim tool output stays in the drawer rather than a toast.
      message: `${job.error ?? 'Failed'} — see Jobs for details.`,
      autoClose: 8000,
    });
  }
}
