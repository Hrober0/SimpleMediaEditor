import type { ReactNode } from 'react';
import { Button, Tooltip } from '@mantine/core';
import { IconClipboard } from '@tabler/icons-react';
import { formatDuration } from '@shared/format';
import { totalKeptSeconds, type KeepRange } from '@shared/trim';

interface PasteActionProps {
  /** The part cut last, or null before anything has been cut. */
  clipboard: readonly KeepRange[] | null;
  paste: () => void;
}

/** Puts the part cut last back into the track at the playhead. */
export function PasteAction({ clipboard, paste }: PasteActionProps): ReactNode {
  if (!clipboard) return null;
  return (
    <Tooltip label="Paste at the playhead, moving everything after it later (V)">
      <Button variant="default" size="xs" leftSection={<IconClipboard size={14} />} onClick={paste}>
        Paste {formatDuration(totalKeptSeconds(clipboard))}
      </Button>
    </Tooltip>
  );
}
