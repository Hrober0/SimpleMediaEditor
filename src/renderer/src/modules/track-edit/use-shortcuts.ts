import { useEffect, useRef } from 'react';

export interface TrackEditActions {
  togglePlay: () => void;
  seek: (displaySeconds: number) => void;
  deselect: () => void;
  cutSelection: () => void;
  toggleLoop: () => void;
  zoomToSelection: () => void;
  zoomOut: () => void;
}

const SHORTCUTS: Record<string, (actions: TrackEditActions) => void> = {
  ' ': (actions) => actions.togglePlay(),
  Home: (actions) => actions.seek(0),
  Escape: (actions) => actions.deselect(),
  x: (actions) => actions.cutSelection(),
  l: (actions) => actions.toggleLoop(),
  '+': (actions) => actions.zoomToSelection(),
  '=': (actions) => actions.zoomToSelection(),
  '-': (actions) => actions.zoomOut(),
};

/**
 * The keyboard shortcuts for editing a track, while one is open.
 *
 * The listener is registered once rather than rebuilt on every keystroke, so it
 * reads the current actions through a ref. Each action already ignores a press
 * that means nothing right now, which is why the table needs no guards.
 */
export function useShortcuts(enabled: boolean, actions: TrackEditActions): void {
  const actionsRef = useRef(actions);
  useEffect(() => {
    actionsRef.current = actions;
  });

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      // Ctrl+X and its neighbours belong to the browser and the OS, not here.
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;

      const run = SHORTCUTS[event.key] ?? SHORTCUTS[event.key.toLowerCase()];
      if (!run) return;
      event.preventDefault();
      run(actionsRef.current);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}
