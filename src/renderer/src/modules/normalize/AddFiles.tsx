import type { ReactNode } from 'react';
import { Button, Group, Text } from '@mantine/core';
import { IconFolderOpen } from '@tabler/icons-react';
import type { ErrorInfo } from '@shared/result';
import { FileDropzone } from '../../components/FileDropzone';
import {
  addDroppedFiles,
  browseForMediaFiles,
  supportedExtensions,
} from '../../components/media-drop';

interface AddFilesProps {
  onAdd: (paths: string[]) => void;
  onError: (error: ErrorInfo) => void;
}

/** Lets the user drop or browse for any number of files to add to the batch. */
export function AddFiles({ onAdd, onError }: AddFilesProps): ReactNode {
  return (
    <FileDropzone
      onDrop={(files) => addDroppedFiles(files, { onAdd, onError })}
      multiple
      radius="md"
      py="md"
      // Browsing goes through the Electron dialog, which filters by the format
      // table and allows picking several files.
      activateOnClick={false}
      enablePointerEvents
    >
      <Group justify="space-between" wrap="nowrap" gap="md">
        <div>
          <Text size="sm" fw={500}>
            Drag audio or video files here
          </Text>
          <Text size="xs" c="dimmed">
            {supportedExtensions(' · ')}
          </Text>
        </div>
        <Button
          variant="default"
          size="compact-sm"
          leftSection={<IconFolderOpen size={16} />}
          onClick={() => browseForMediaFiles({ onAdd })}
        >
          Browse
        </Button>
      </Group>
    </FileDropzone>
  );
}
