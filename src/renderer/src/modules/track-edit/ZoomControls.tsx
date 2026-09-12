import type { ReactNode } from 'react';
import { ActionIcon, Group, Tooltip } from '@mantine/core';
import { IconZoomIn, IconZoomOut } from '@tabler/icons-react';

interface ZoomControlsProps {
  canZoomIn: boolean;
  canZoomOut: boolean;
  zoomToSelection: () => void;
  zoomOut: () => void;
}

/** How much of the track the waveform shows. */
export function ZoomControls({
  canZoomIn,
  canZoomOut,
  zoomToSelection,
  zoomOut,
}: ZoomControlsProps): ReactNode {
  return (
    <Group gap="sm" wrap="nowrap" ml="auto">
      <Tooltip label="Zoom to the selected part (+)">
        <ActionIcon variant="default" onClick={zoomToSelection} disabled={!canZoomIn}>
          <IconZoomIn size={16} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Zoom out to the whole track (-)">
        <ActionIcon variant="default" onClick={zoomOut} disabled={!canZoomOut}>
          <IconZoomOut size={16} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}
