import type { ReactNode } from 'react';
import { SegmentedControl, Stack, Text } from '@mantine/core';
import type { TrimExportMode } from '@shared/trim';

interface ExportModeProps {
  value: TrimExportMode;
  onChange: (value: TrimExportMode) => void;
}

const DESCRIPTIONS: Record<TrimExportMode, string> = {
  fast: 'Copies the file without re-encoding. Quick, but on video each part starts at the keyframe before its cut point, so it can begin a moment early.',
  precise: 'Re-encodes to land exactly on the cut point. Slower.',
};

/** Picks how exactly the cut points are honoured, and says what that costs. */
export function ExportMode({ value, onChange }: ExportModeProps): ReactNode {
  return (
    <Stack gap={4}>
      <SegmentedControl
        value={value}
        onChange={(next) => onChange(next === 'precise' ? 'precise' : 'fast')}
        data={[
          { label: 'Fast', value: 'fast' },
          { label: 'Precise', value: 'precise' },
        ]}
        w={240}
      />
      <Text size="xs" c="dimmed">
        {DESCRIPTIONS[value]}
      </Text>
    </Stack>
  );
}
