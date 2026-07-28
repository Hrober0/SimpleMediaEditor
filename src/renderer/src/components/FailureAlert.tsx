import { useState, type ReactNode } from 'react';
import {
  ActionIcon,
  Alert,
  Anchor,
  Code,
  CopyButton,
  Group,
  ScrollArea,
  Stack,
  Tooltip,
} from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconCopy } from '@tabler/icons-react';
import type { ErrorInfo } from '@shared/result';

interface FailureAlertProps {
  title: string;
  error: ErrorInfo;
  onDismiss?: () => void;
}

/**
 * The one way failures are shown.
 *
 * ffmpeg and yt-dlp write genuinely useful messages ("Video unavailable", "Sign
 * in to confirm your age"), so their output is shown verbatim and copyable rather
 * than collapsed into a generic failure — behind a toggle, because it is long.
 */
export function FailureAlert({ title, error, onDismiss }: FailureAlertProps): ReactNode {
  const [expanded, setExpanded] = useState(false);

  return (
    <Alert
      color="red"
      variant="light"
      icon={<IconAlertTriangle size={18} />}
      title={title}
      withCloseButton={Boolean(onDismiss)}
      onClose={onDismiss}
      closeButtonLabel="Dismiss"
    >
      <Stack gap="xs">
        <span>{error.message}</span>

        {error.details ? (
          <>
            <Anchor
              component="button"
              type="button"
              size="sm"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? 'Hide output' : 'Show output'}
            </Anchor>

            {expanded ? (
              <Group align="flex-start" gap="xs" wrap="nowrap">
                <ScrollArea.Autosize mah={260} style={{ flex: 1 }} type="auto">
                  <Code block style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {error.details}
                  </Code>
                </ScrollArea.Autosize>

                <CopyButton value={error.details}>
                  {({ copied, copy }) => (
                    <Tooltip label={copied ? 'Copied' : 'Copy output'} withArrow>
                      <ActionIcon variant="subtle" color={copied ? 'teal' : 'gray'} onClick={copy}>
                        {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                      </ActionIcon>
                    </Tooltip>
                  )}
                </CopyButton>
              </Group>
            ) : null}
          </>
        ) : null}
      </Stack>
    </Alert>
  );
}
