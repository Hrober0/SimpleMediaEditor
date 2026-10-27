import type { ReactNode } from 'react';
import { Badge } from '@mantine/core';
import type { JobStatus } from '@shared/jobs';

const STATUS_COLORS: Record<JobStatus, string> = {
  queued: 'gray',
  running: 'blue',
  done: 'teal',
  failed: 'red',
  cancelled: 'gray',
};

/** A job's status, coloured the same wherever a job is shown. */
export function JobStatusBadge({ status }: { status: JobStatus }): ReactNode {
  return (
    // Without flexShrink a long neighbouring label compresses the badge until its
    // own text wraps mid-word.
    <Badge color={STATUS_COLORS[status]} variant="light" style={{ flexShrink: 0 }}>
      {status}
    </Badge>
  );
}
