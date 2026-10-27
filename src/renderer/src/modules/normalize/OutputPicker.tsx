import type { ReactNode } from 'react';
import { SegmentedControl, Stack, Text } from '@mantine/core';
import type { NormalizeOutput } from '@shared/normalize';
import { DirectoryInput } from '../../components/DirectoryInput';

export type OutputKind = NormalizeOutput['kind'];

interface OutputPickerProps {
  kind: OutputKind;
  directory: string | null;
  onKindChange: (kind: OutputKind) => void;
  onDirectoryChange: (directory: string) => void;
}

const OUTPUT_CHOICES: readonly { value: OutputKind; label: string; note: string }[] = [
  {
    value: 'replace',
    label: 'Replace the originals',
    note: 'Each file is written to a temporary copy and checked before it replaces the original.',
  },
  {
    value: 'folder',
    label: 'Save copies to a folder',
    note: 'The originals stay as they are. A file of the same name in that folder is replaced.',
  },
];

/** Lets the user choose where the normalized files are written. */
export function OutputPicker({
  kind,
  directory,
  onKindChange,
  onDirectoryChange,
}: OutputPickerProps): ReactNode {
  const selected = OUTPUT_CHOICES.find((choice) => choice.value === kind);

  return (
    <Stack gap="md">
      <div>
        <SegmentedControl
          fullWidth
          value={kind}
          onChange={(next) => {
            const choice = OUTPUT_CHOICES.find((entry) => entry.value === next);
            if (choice) onKindChange(choice.value);
          }}
          data={OUTPUT_CHOICES.map(({ value, label }) => ({ value, label }))}
        />
        <Text size="xs" c="dimmed" mt={6}>
          {selected?.note}
        </Text>
      </div>

      {kind === 'folder' ? (
        <DirectoryInput
          label="Save to"
          value={directory}
          onChange={onDirectoryChange}
          dialogTitle="Choose where normalized files are saved"
        />
      ) : null}
    </Stack>
  );
}
