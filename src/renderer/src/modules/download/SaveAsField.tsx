import type { ReactNode } from 'react';
import { Stack, Switch, TextInput } from '@mantine/core';
import { downloadTargetById } from '@shared/download';
import { useSettings } from '../../state/SettingsContext';

interface SaveAsFieldProps {
  value: string;
  onChange: (value: string) => void;
}

/** Lets the user name the one file a single video is saved as. */
export function SaveAsField({ value, onChange }: SaveAsFieldProps): ReactNode {
  const { settings, update } = useSettings();
  if (!settings) return null;

  return (
    <Stack gap="sm">
      <TextInput
        label="Save as"
        description={`The .${downloadTargetById(settings.downloadTarget).ext} extension is added automatically.`}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        error={value.trim() ? null : 'A file name is required.'}
      />
      <Switch
        checked={settings.useFilenameAsTitle}
        onChange={(event) => {
          void update({ useFilenameAsTitle: event.currentTarget.checked });
        }}
        label="Use a changed name as the title tag"
        description="When you rename the file, players show the new name instead of the YouTube title."
      />
    </Stack>
  );
}
