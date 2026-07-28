import { createContext, useContext } from 'react';
import type { AppSettings } from '@shared/settings';

export interface SettingsContextValue {
  /** null only while the first read is in flight. */
  settings: AppSettings | null;
  /**
   * Applies the patch locally, then persists it in main. Resolves once main has
   * stored it, so callers that depend on the new value — re-probing a binary
   * after its path changed — can wait for it.
   */
  update: (patch: Partial<AppSettings>) => Promise<void>;
}

export const SettingsContext = createContext<SettingsContextValue | null>(null);

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettings must be used inside <SettingsProvider>');
  return value;
}
