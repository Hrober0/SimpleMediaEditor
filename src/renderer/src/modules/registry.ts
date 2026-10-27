import { downloadModule } from './download';
import { metaEditorModule } from './meta-editor';
import { normalizeModule } from './normalize';
import { settingsModule } from './settings';
import { trackEditModule } from './track-edit';
import type { UtilityModule } from './types';

/**
 * The module list. Adding a utility means adding a folder and one line here —
 * nothing in the shell changes, and no other module needs to know about it.
 */
export const MODULE_REGISTRY: readonly UtilityModule[] = [
  downloadModule,
  metaEditorModule,
  trackEditModule,
  normalizeModule,
  settingsModule,
];
