import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { isJobActive, type Job, type JobStatus } from '@shared/jobs';
import { api } from '../api';
import { JobsContext, type JobsContextValue } from './JobsContext';

/**
 * Holds the job list for the whole app. Main owns the state and pushes it here,
 * so this never polls and never keeps a second copy of progress.
 */
export function JobsProvider({ children }: { children: ReactNode }): ReactNode {
  const [jobs, setJobs] = useState<readonly Job[]>([]);
  const previousStatuses = useRef(new Map<string, JobStatus>());

  useEffect(() => {
    // Subscribe before the initial read so a job starting in between is not missed.
    const unsubscribe = api.onJobsChanged(setJobs);
    void api.listJobs().then(setJobs);
    return unsubscribe;
  }, []);

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

  const [drawerOpened, { open: openDrawer, close: closeDrawer }] = useDisclosure(false);

  const value = useMemo<JobsContextValue>(
    () => ({
      jobs,
      activeCount: jobs.filter(isJobActive).length,
      cancel,
      clearFinished,
      showInFolder,
      drawerOpened,
      openDrawer,
      closeDrawer,
    }),
    [jobs, cancel, clearFinished, showInFolder, drawerOpened, openDrawer, closeDrawer],
  );

  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>;
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
