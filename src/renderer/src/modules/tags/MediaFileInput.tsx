import type { ReactNode } from 'react';
import { Button, Stack, Text, ThemeIcon } from '@mantine/core';
import { IconFileMusic, IconFolderOpen, IconUpload, IconX } from '@tabler/icons-react';
import type { ErrorInfo } from '@shared/result';
import { FileDropzone } from '../../components/FileDropzone';
import { browseForMedia, openDroppedFile, supportedExtensions } from './media-drop';

interface MediaFileInputProps {
  onOpen: (path: string) => void;
  onError: (error: ErrorInfo) => void;
  loading: boolean;
}

/**
 * Drag the first file in, or browse for one.
 *
 * This is the empty state: it is what the panel offers before anything is open.
 * Once a file is open it gives way to `ChangeMediaButton`, which does the same job
 * without taking the whole panel to say so.
 */
export function MediaFileInput({ onOpen, onError, loading }: MediaFileInputProps): ReactNode {
  return (
    <FileDropzone
      onDrop={(files) => openDroppedFile(files, { onOpen, onError })}
      loading={loading}
      radius="md"
      py="lg"
      // Browsing goes through the Electron dialog, which can filter by the
      // format table; the dropzone's own click would open the Chromium picker.
      activateOnClick={false}
      // Without this the dropzone's inner element keeps `pointer-events: none`
      // and the Browse button inside it cannot be clicked at all.
      enablePointerEvents
    >
      <Stack align="center" gap="xs">
        <FileDropzone.Accept>
          <ThemeIcon variant="light" size="xl" radius="xl" color="blue">
            <IconUpload size={22} />
          </ThemeIcon>
        </FileDropzone.Accept>
        <FileDropzone.Reject>
          <ThemeIcon variant="light" size="xl" radius="xl" color="red">
            <IconX size={22} />
          </ThemeIcon>
        </FileDropzone.Reject>
        <FileDropzone.Idle>
          <ThemeIcon variant="light" size="xl" radius="xl">
            <IconFileMusic size={22} />
          </ThemeIcon>
        </FileDropzone.Idle>

        <Text size="sm" fw={500}>
          Drag an audio or video file here
        </Text>
        <Text size="xs" c="dimmed">
          {supportedExtensions(' · ')}
        </Text>

        <Button
          variant="default"
          size="compact-sm"
          mt={4}
          leftSection={<IconFolderOpen size={16} />}
          onClick={() => browseForMedia({ onOpen })}
        >
          Browse
        </Button>
      </Stack>
    </FileDropzone>
  );
}
