import type { ReactNode } from 'react';
import { Button, Group, Paper, Progress, Stack, Text } from '@mantine/core';
import { IconFolderOpen, IconX } from '@tabler/icons-react';
import { isJobActive, isJobFinished, type Job } from '@shared/jobs';
import { useJobs } from '../state/JobsContext';
import { FailureAlert } from './FailureAlert';
import { JobStatusBadge } from './JobStatusBadge';

/**
 * The one progress surface in the app. Every module's long-running work shows up
 * here because it all goes through the same queue.
 *
 * Rendered in two places — the side panel when the window is wide enough, and the
 * drawer when it is not — so the list itself knows about neither.
 */
export function JobsList(): ReactNode {
  const { jobs, clearFinished } = useJobs();
  const finishedCount = jobs.filter(isJobFinished).length;

  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <Text size="sm" c="dimmed">
          {jobs.length === 0
            ? 'Nothing queued yet.'
            : `${String(jobs.length)} total, ${String(jobs.filter(isJobActive).length)} active`}
        </Text>
        <Button
          variant="subtle"
          size="compact-sm"
          disabled={finishedCount === 0}
          onClick={clearFinished}
        >
          Clear finished
        </Button>
      </Group>

      {jobs.map((job) => (
        <JobCard key={job.id} job={job} />
      ))}
    </Stack>
  );
}

function JobCard({ job }: { job: Job }): ReactNode {
  const { cancel, showInFolder } = useJobs();
  const active = isJobActive(job);

  return (
    <Paper withBorder radius="md" p="sm">
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap" align="flex-start" gap="sm">
          <Text size="sm" fw={500} lineClamp={2} style={{ flex: 1, minWidth: 0 }}>
            {job.label}
          </Text>
          <JobStatusBadge status={job.status} />
        </Group>

        {active ? (
          <Progress
            // A null progress means the stage cannot be measured (post-processing);
            // a moving full bar says "working" without claiming to be finished.
            value={job.progress === null ? 100 : job.progress * 100}
            animated={job.progress === null || job.status === 'running'}
            size="sm"
          />
        ) : null}

        <Text size="xs" c="dimmed">
          {job.detail}
        </Text>

        {job.status === 'failed' ? (
          <FailureAlert
            title="Failed"
            error={{ message: job.error ?? 'Unknown error', details: job.log.join('\n') || null }}
          />
        ) : null}

        <Group gap="xs">
          {active ? (
            <Button
              variant="default"
              size="compact-sm"
              leftSection={<IconX size={14} />}
              onClick={() => cancel(job.id)}
            >
              Cancel
            </Button>
          ) : null}
          {job.status === 'done' && job.outputPath ? (
            <Button
              variant="default"
              size="compact-sm"
              leftSection={<IconFolderOpen size={14} />}
              onClick={() => showInFolder(job.outputPath ?? '')}
            >
              Show in folder
            </Button>
          ) : null}
        </Group>
      </Stack>
    </Paper>
  );
}
