import type { ReactNode } from 'react';
import { SegmentedControl, Text } from '@mantine/core';
import { LOUDNESS_TARGETS, type LoudnessTarget } from '@shared/normalize';

interface TargetPickerProps {
  value: LoudnessTarget;
  onChange: (value: LoudnessTarget) => void;
}

/** Lets the user pick the loudness every file is brought to. */
export function TargetPicker({ value, onChange }: TargetPickerProps): ReactNode {
  const selected = LOUDNESS_TARGETS.find((target) => target.lufs === value);

  return (
    <div>
      <SegmentedControl
        fullWidth
        value={String(value)}
        onChange={(next) => {
          const target = LOUDNESS_TARGETS.find((entry) => String(entry.lufs) === next);
          if (target) onChange(target.lufs);
        }}
        data={LOUDNESS_TARGETS.map((target) => ({
          value: String(target.lufs),
          label: target.label,
        }))}
      />
      <Text size="xs" c="dimmed" mt={6}>
        {selected?.note} Peaks are kept under -1.5 dBTP.
      </Text>
    </div>
  );
}
