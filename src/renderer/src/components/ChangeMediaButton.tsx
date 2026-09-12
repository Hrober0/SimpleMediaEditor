import type { ReactNode } from 'react';
import { Button, Stack, Text } from '@mantine/core';
import { IconFolderOpen } from '@tabler/icons-react';
import type { ErrorInfo } from '@shared/result';
import { FileDropzone } from './FileDropzone';
import { browseForMedia, openDroppedFile } from './media-drop';

interface ChangeMediaButtonProps {
  onOpen: (path: string) => void;
  onError: (error: ErrorInfo) => void;
  loading: boolean;
}

/**
 * Swaps the open file for another one, by browsing or by dropping.
 *
 * Once a file is open the large dropzone is only in the way, so this keeps both
 * ways of opening the next one available in the space of a button.
 *
 * It fills the height it is given so it squares up with the summary beside it,
 * which also makes the drop target bigger than the button it contains.
 */
export function ChangeMediaButton({ onOpen, onError, loading }: ChangeMediaButtonProps): ReactNode {
  return (
    <FileDropzone
      onDrop={(files) => openDroppedFile(files, { onOpen, onError })}
      loading={loading}
      radius="md"
      p="xs"
      // The row stretches this to the summary's height, which only works while the
      // height stays auto: a percentage height would cancel the stretch and fall
      // back to content height. So the root becomes the flex container instead, and
      // the inner element, which is what actually holds the button, fills it.
      styles={{ root: { display: 'flex' }, inner: { flex: 1, display: 'flex' } }}
      // Browsing goes through the Electron dialog, which the dropzone's own click
      // would bypass; pointer events keep the button inside it clickable.
      activateOnClick={false}
      enablePointerEvents
    >
      <Stack align="center" justify="center" gap={4} flex={1} miw={170} px="xs">
        <Text size="sm" fw={500}>
          Change media
        </Text>
        <Text size="xs" c="dimmed">
          Drop a file here
        </Text>
        <Button
          variant="default"
          size="xs"
          mt={4}
          leftSection={<IconFolderOpen size={14} />}
          onClick={() => browseForMedia({ onOpen })}
        >
          Browse
        </Button>
      </Stack>
    </FileDropzone>
  );
}
