import type { ReactNode, RefCallback } from 'react';
import { mediaFileUrl } from '@shared/media-protocol';
import type { MediaInfo } from '@shared/metadata';

interface PlayerProps {
  info: MediaInfo;
  elementRef: RefCallback<HTMLMediaElement>;
}

// Without this, nothing is fetched until the first play, which delays the
// duration and seeking becoming available. "metadata" rather than "auto":
// only what is needed to know the duration and seek, not the whole file.
const PRELOAD = 'metadata';

/**
 * Plays the opened file. Video shows a picture and audio does not, but both are
 * driven the same way — the panel holds the element and sets `currentTime` on
 * it directly — so the two only differ in what they render.
 */
export function Player({ info, elementRef }: PlayerProps): ReactNode {
  const src = mediaFileUrl(info.path);

  if (info.kind === 'video') {
    return (
      <video
        ref={elementRef}
        src={src}
        preload={PRELOAD}
        controls={false}
        style={{ width: '100%', maxHeight: 320, backgroundColor: 'black' }}
      />
    );
  }
  return <audio ref={elementRef} src={src} preload={PRELOAD} />;
}
