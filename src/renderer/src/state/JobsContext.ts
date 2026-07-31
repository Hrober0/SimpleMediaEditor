import { createContext, useContext } from 'react';
import type { Job } from '@shared/jobs';

export interface JobsContextValue {
  jobs: readonly Job[];
  /** Queued or running, across every module. */
  activeCount: number;
  cancel: (jobId: string) => void;
  clearFinished: () => void;
  showInFolder: (path: string) => void;
  /**
   * Resolves once the job reaches a terminal state, or with null if it was
   * cleared from the list first. Lets a module react to its own work finishing
   * without keeping a second copy of job state or polling.
   */
  waitForJob: (jobId: string) => Promise<Job | null>;
  /**
   * Puts the job list in front of the user after queueing something. On a wide
   * window it is already on screen as a side panel and this does nothing; on a
   * narrow one it opens the drawer. Callers do not need to know which.
   */
  revealJobs: () => void;
  /**
   * The drawer's own state. The list is a drawer only on narrow windows, but
   * modules queue the work — so this lives with the jobs feature rather than
   * being drilled through every panel that starts something.
   */
  drawerOpened: boolean;
  closeDrawer: () => void;
}

export const JobsContext = createContext<JobsContextValue | null>(null);

export function useJobs(): JobsContextValue {
  const value = useContext(JobsContext);
  if (!value) throw new Error('useJobs must be used inside <JobsProvider>');
  return value;
}
