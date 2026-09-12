import type { ReactNode } from 'react';
import { ActionIcon, Group, Text, Tooltip } from '@mantine/core';
import {
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerSkipBack,
  IconRepeat,
} from '@tabler/icons-react';
import { formatDuration } from '@shared/format';

interface PlaybackControlsProps {
  playing: boolean;
  currentTimeSeconds: number;
  trackDurationSeconds: number;
  loopEnabled: boolean;
  canLoop: boolean;
  goToStart: () => void;
  togglePlay: () => void;
  toggleLoop: () => void;
}

/** Moves the playhead, and says where it is. */
export function PlaybackControls({
  playing,
  currentTimeSeconds,
  trackDurationSeconds,
  loopEnabled,
  canLoop,
  goToStart,
  togglePlay,
  toggleLoop,
}: PlaybackControlsProps): ReactNode {
  return (
    <Group gap="sm" wrap="nowrap">
      <Tooltip label="Go to start (Home)">
        <ActionIcon variant="default" onClick={goToStart}>
          <IconPlayerSkipBack size={16} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={playing ? 'Pause (Space)' : 'Play (Space)'}>
        <ActionIcon variant="default" size="lg" onClick={togglePlay}>
          {playing ? <IconPlayerPause size={18} /> : <IconPlayerPlay size={18} />}
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Loop the selected part (L)">
        <ActionIcon
          variant={loopEnabled ? 'filled' : 'default'}
          onClick={toggleLoop}
          disabled={!canLoop}
        >
          <IconRepeat size={16} />
        </ActionIcon>
      </Tooltip>
      <Text size="sm" c="dimmed">
        {formatDuration(currentTimeSeconds)} / {formatDuration(trackDurationSeconds)}
      </Text>
    </Group>
  );
}
