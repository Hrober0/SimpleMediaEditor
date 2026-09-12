import type { ReactNode } from 'react';
import { Box, Group, Text } from '@mantine/core';

interface PanelActionsProps {
  /** What the action will do, or why it is unavailable. */
  status: ReactNode;
  /** The primary buttons, in reading order. */
  children: ReactNode;
}

/**
 * A panel's primary actions, pinned to the top of the panel.
 *
 * The button that starts the work stays reachable no matter how far down the form
 * the user has scrolled — a Save or Download button that scrolls off the bottom of
 * a long form is a button you have to go looking for.
 *
 * It sticks to the top of its own scroll area — the `ScrollArea` `App` wraps
 * the active panel in — rather than the viewport top: the fixed shell header
 * sits entirely above that scroll area, so nothing else needs to be
 * compensated for here. It still paints an opaque background so the form
 * passes behind it while scrolling.
 */
export function PanelActions({ status, children }: PanelActionsProps): ReactNode {
  return (
    <Box
      pos="sticky"
      top={0}
      py="sm"
      style={{
        zIndex: 2,
        backgroundColor: 'var(--mantine-color-body)',
        borderBottom: '1px solid var(--mantine-color-default-border)',
      }}
    >
      <Group justify="space-between" align="center" wrap="nowrap" gap="md">
        <Text size="sm" c="dimmed">
          {status}
        </Text>
        <Group gap="sm" wrap="nowrap">
          {children}
        </Group>
      </Group>
    </Box>
  );
}
