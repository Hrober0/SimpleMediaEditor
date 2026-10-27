import type { CSSProperties, ReactNode, RefCallback } from 'react';
import { Box } from '@mantine/core';
import { mediaFileUrl } from '@shared/media-protocol';
import type { MediaInfo } from '@shared/metadata';
import type { ElementIndex } from './segment-player';

interface PlayerProps {
  info: MediaInfo;
  /** How many times a file has been opened, so reopening one after a save reloads it. */
  openCount: number;
  /** Two elements on the same file, so a cut point is crossed without a seek. */
  elementRefs: readonly [RefCallback<HTMLMediaElement>, RefCallback<HTMLMediaElement>];
  activeElement: ElementIndex;
}

// Without this, nothing is fetched until the first play, which delays the
// duration and seeking becoming available. "metadata" rather than "auto":
// only what is needed to know the duration and seek, not the whole file.
const PRELOAD = 'metadata';

/**
 * Plays the opened file. Video shows a picture and audio does not, but both are
 * driven the same way, by the playback hook setting `currentTime` on the
 * elements directly, so the two only differ in what they render.
 */
export function Player({ info, openCount, elementRefs, activeElement }: PlayerProps): ReactNode {
  const src = mediaFileUrl(info.path, openCount);

  if (info.kind === 'video') {
    // Stacked in one grid cell, the waiting video kept fully transparent
    // rather than hidden: a hidden video may not decode the frame it was
    // seeked to, and that frame is what has to be on screen at the switch.
    return (
      <Box style={{ display: 'grid', backgroundColor: 'black' }}>
        {elementRefs.map((ref, index) => (
          <video
            key={index}
            ref={ref}
            src={src}
            preload={PRELOAD}
            controls={false}
            style={stackedVideoStyle(index === activeElement)}
          />
        ))}
      </Box>
    );
  }
  return (
    <>
      {elementRefs.map((ref, index) => (
        <audio key={index} ref={ref} src={src} preload={PRELOAD} />
      ))}
    </>
  );
}

function stackedVideoStyle(isActive: boolean): CSSProperties {
  return {
    gridArea: '1 / 1',
    width: '100%',
    maxHeight: 320,
    opacity: isActive ? 1 : 0,
  };
}
