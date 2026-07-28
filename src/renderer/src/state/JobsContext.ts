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
   * The job list is a drawer in the shell, but modules queue the work — so the
   * open/close state lives with the jobs feature instead of being drilled through
   * every panel that starts something.
   */
  drawerOpened: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
}

export const JobsContext = createContext<JobsContextValue | null>(null);

export function useJobs(): JobsContextValue {
  const value = useContext(JobsContext);
  if (!value) throw new Error('useJobs must be used inside <JobsProvider>');
  return value;
}
