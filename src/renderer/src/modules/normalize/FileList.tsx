import type { ReactNode } from 'react';
import { ActionIcon, Button, Group, Paper, Stack, Table, Text, Tooltip } from '@mantine/core';
import { IconX } from '@tabler/icons-react';
import { isJobActive, type Job } from '@shared/jobs';
import { JobStatusBadge } from '../../components/JobStatusBadge';

interface FileListProps {
  paths: readonly string[];
  /** The latest normalize job for a file, or null before it was queued. */
  jobFor: (path: string) => Job | null;
  onRemove: (path: string) => void;
  onClear: () => void;
}

/** Shows the files in the batch and how each one's normalization went. */
export function FileList({ paths, jobFor, onRemove, onClear }: FileListProps): ReactNode {
  if (paths.length === 0) return null;

  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          {paths.length === 1 ? '1 file' : `${String(paths.length)} files`}
        </Text>
        <Button variant="subtle" size="compact-sm" onClick={onClear}>
          Clear
        </Button>
      </Group>
      <Paper withBorder radius="md">
        <Table verticalSpacing="xs" layout="fixed">
          <Table.Tbody>
            {paths.map((path) => (
              <FileRow key={path} path={path} job={jobFor(path)} onRemove={onRemove} />
            ))}
          </Table.Tbody>
        </Table>
      </Paper>
    </Stack>
  );
}

interface FileRowProps {
  path: string;
  job: Job | null;
  onRemove: (path: string) => void;
}

function FileRow({ path, job, onRemove }: FileRowProps): ReactNode {
  const { name, folder } = splitPath(path);
  const isRunning = job !== null && isJobActive(job);

  return (
    <Table.Tr>
      <Table.Td>
        <Text size="sm" truncate title={path}>
          {name}
        </Text>
        <Text size="xs" c="dimmed" truncate>
          {folder}
        </Text>
      </Table.Td>
      <Table.Td>
        <FileStatus job={job} />
      </Table.Td>
      <Table.Td w={48}>
        <Tooltip label={isRunning ? 'Being normalized' : 'Remove from the list'} withArrow>
          <ActionIcon
            variant="subtle"
            color="gray"
            disabled={isRunning}
            onClick={() => onRemove(path)}
            aria-label="Remove from the list"
          >
            <IconX size={16} />
          </ActionIcon>
        </Tooltip>
      </Table.Td>
    </Table.Tr>
  );
}

/** Where the file's job is, or the before and after loudness once it is done. */
function FileStatus({ job }: { job: Job | null }): ReactNode {
  if (!job) {
    return (
      <Text size="xs" c="dimmed">
        Not started
      </Text>
    );
  }
  return (
    <Group gap="xs" wrap="nowrap">
      <JobStatusBadge status={job.status} />
      <Text size="xs" c="dimmed" truncate title={job.detail}>
        {job.status === 'failed' ? (job.error ?? job.detail) : job.detail}
      </Text>
    </Group>
  );
}

/** Either separator, since a path can come from Windows or Linux. */
function splitPath(path: string): { name: string; folder: string } {
  const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return { name: path.slice(separator + 1), folder: path.slice(0, Math.max(0, separator)) };
}
