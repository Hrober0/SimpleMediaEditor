import { useState, type ReactNode } from 'react';
import { Button, Divider, Stack } from '@mantine/core';
import { isJobActive, type Job } from '@shared/jobs';
import {
  DEFAULT_LOUDNESS_TARGET,
  type LoudnessTarget,
  type NormalizeOutput,
} from '@shared/normalize';
import type { ErrorInfo } from '@shared/result';
import { api } from '../../api';
import { FailureAlert } from '../../components/FailureAlert';
import { PanelActions } from '../../components/PanelActions';
import { useJobs } from '../../state/JobsContext';
import { AddFiles } from './AddFiles';
import { FileList } from './FileList';
import { OutputPicker, type OutputKind } from './OutputPicker';
import { TargetPicker } from './TargetPicker';

/**
 * Brings a batch of files to one loudness. The panel only collects the files
 * and the choices: main measures and rewrites each file as its own job, and the
 * list shows each file's before and after as those jobs finish.
 */
export function NormalizePanel(): ReactNode {
  const { jobs, revealJobs } = useJobs();

  const [paths, setPaths] = useState<readonly string[]>([]);
  const [jobIdsByPath, setJobIdsByPath] = useState<Readonly<Record<string, string>>>({});
  const [targetLufs, setTargetLufs] = useState<LoudnessTarget>(DEFAULT_LOUDNESS_TARGET);
  const [outputKind, setOutputKind] = useState<OutputKind>('replace');
  const [directory, setDirectory] = useState<string | null>(null);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [starting, setStarting] = useState(false);

  const jobFor = (path: string): Job | null =>
    jobs.find((job) => job.id === jobIdsByPath[path]) ?? null;
  const isBusy = (path: string): boolean => {
    const job = jobFor(path);
    return job !== null && isJobActive(job);
  };
  const readyPaths = paths.filter((path) => !isBusy(path));

  const addFiles = (added: readonly string[]): void => {
    setPaths((current) => [...new Set([...current, ...added])]);
  };
  const removeFile = (path: string): void => {
    setPaths((current) => current.filter((entry) => entry !== path));
  };
  const clearFiles = (): void => {
    setPaths((current) => current.filter(isBusy));
  };

  const output: NormalizeOutput =
    outputKind === 'replace' ? { kind: 'replace' } : { kind: 'folder', directory: directory ?? '' };
  const isMissingDirectory = outputKind === 'folder' && !directory;

  const start = (): void => {
    setStarting(true);
    void api
      .normalizeLoudness({ paths: readyPaths, targetLufs, output })
      .then((result) => {
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setError(null);
        setJobIdsByPath((current) => ({ ...current, ...result.value.jobIdsByPath }));
        revealJobs();
      })
      .finally(() => setStarting(false));
  };

  return (
    <Stack gap="lg">
      <PanelActions
        status={describeReadiness(paths.length, readyPaths.length, outputKind, isMissingDirectory)}
      >
        <Button
          onClick={start}
          loading={starting}
          disabled={readyPaths.length === 0 || isMissingDirectory}
        >
          Normalize
        </Button>
      </PanelActions>

      {error ? (
        <FailureAlert title="Could not normalize" error={error} onDismiss={() => setError(null)} />
      ) : null}

      <AddFiles onAdd={addFiles} onError={setError} />
      <FileList paths={paths} jobFor={jobFor} onRemove={removeFile} onClear={clearFiles} />

      <Divider label="Loudness" labelPosition="left" />
      <TargetPicker value={targetLufs} onChange={setTargetLufs} />

      <Divider label="Output" labelPosition="left" />
      <OutputPicker
        kind={outputKind}
        directory={directory}
        onKindChange={setOutputKind}
        onDirectoryChange={setDirectory}
      />
    </Stack>
  );
}

function describeReadiness(
  fileCount: number,
  readyCount: number,
  outputKind: OutputKind,
  isMissingDirectory: boolean,
): string {
  if (fileCount === 0) return 'Add the files to normalize.';
  if (isMissingDirectory) return 'Choose a folder to save into first.';
  if (readyCount === 0) return 'Every file is already being normalized.';

  const files = readyCount === 1 ? '1 file' : `${String(readyCount)} files`;
  return outputKind === 'replace'
    ? `${files} will be normalized in place.`
    : `${files} will be saved to the folder.`;
}
