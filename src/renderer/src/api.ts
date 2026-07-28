import { RENDERER_API_KEY, type MediaEditorApi } from '@shared/ipc-contract';

/**
 * The renderer's single point of contact with main. Importing this instead of
 * touching `window` keeps the dependency visible in every module that uses it —
 * and gives one place to wrap should the transport ever change.
 */
export const api: MediaEditorApi = window.mediaEditor;

if (!api) {
  throw new Error(
    `window.${RENDERER_API_KEY} is missing — the preload script did not load. ` +
      'Check webPreferences.preload in src/main/index.ts.',
  );
}
