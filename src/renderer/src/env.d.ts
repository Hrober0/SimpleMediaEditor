import type { MediaEditorApi } from '@shared/ipc-contract';

declare global {
  interface Window {
    /** Injected by the preload script; see src/preload/index.ts. */
    readonly mediaEditor: MediaEditorApi;
  }
}
