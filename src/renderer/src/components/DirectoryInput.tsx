import type { ReactNode } from 'react';
import { Button, Group, TextInput } from '@mantine/core';
import { IconFolderOpen } from '@tabler/icons-react';
import { api } from '../api';

interface DirectoryInputProps {
  label: string;
  description?: string;
  value: string | null;
  onChange: (path: string) => void;
  dialogTitle: string;
}

/**
 * Folder picking always goes through the main process dialog — the renderer has
 * no filesystem access to browse with, by design.
 */
export function DirectoryInput({
  label,
  description,
  value,
  onChange,
  dialogTitle,
}: DirectoryInputProps): ReactNode {
  const browse = (): void => {
    void api.pickDirectory({ title: dialogTitle, defaultPath: value }).then((picked) => {
      if (picked) onChange(picked);
    });
  };

  return (
    <Group align="flex-end" gap="sm" wrap="nowrap">
      <TextInput
        style={{ flex: 1 }}
        label={label}
        description={description}
        placeholder="No folder chosen"
        value={value ?? ''}
        // Typed paths cannot be validated as you type, and a half-typed path is
        // never what the user wants; the dialog is the way in.
        readOnly
        onClick={browse}
      />
      <Button variant="default" leftSection={<IconFolderOpen size={16} />} onClick={browse}>
        Browse
      </Button>
    </Group>
  );
}
