import type { ReactNode } from 'react';
import { ActionIcon, Group, Text, Tooltip } from '@mantine/core';
import { IconScissors, IconTrash, IconX } from '@tabler/icons-react';
import { formatDuration } from '@shared/format';
import type { WaveformSelection } from './Waveform';

interface SelectionActionsProps {
  selection: WaveformSelection | null;
  deselect: () => void;
  cutSelection: () => void;
  deleteSelection: () => void;
}

/** What can be done with the selected part of the waveform, or how to make one. */
export function SelectionActions({
  selection,
  deselect,
  cutSelection,
  deleteSelection,
}: SelectionActionsProps): ReactNode {
  if (!selection) {
    return (
      <Text size="xs" c="dimmed">
        Drag on the waveform to select a part, then cut it out. Click to move the playhead, where a
        cut part can be pasted back in.
      </Text>
    );
  }

  return (
    <Group gap="xs">
      <Tooltip label="Deselect (Esc)">
        <ActionIcon variant="default" onClick={deselect} aria-label="Deselect">
          <IconX size={16} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Cut this part out (X)">
        <ActionIcon color="red" onClick={cutSelection} aria-label="Cut this part out">
          <IconScissors size={16} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Delete this part, without keeping it to paste (Backspace)">
        <ActionIcon
          color="red"
          variant="light"
          onClick={deleteSelection}
          aria-label="Delete this part"
        >
          <IconTrash size={16} />
        </ActionIcon>
      </Tooltip>
      <Text size="xs" c="dimmed">
        {formatDuration(selection.endSeconds - selection.startSeconds)} selected
      </Text>
    </Group>
  );
}
