import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { notifications } from '@mantine/notifications';
import type { AppSettings } from '@shared/settings';
import { api } from '../api';
import { SettingsContext, type SettingsContextValue } from './SettingsContext';

/**
 * Settings are shared state: the download panel and the settings panel must not
 * hold separate copies that drift apart. Main remains the owner — it validates
 * and persists — and the value it returns is what we keep.
 */
export function SettingsProvider({ children }: { children: ReactNode }): ReactNode {
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    void api.readSettings().then(setSettings);
  }, []);

  const update = useCallback(async (patch: Partial<AppSettings>) => {
    // Applied locally first so inputs stay responsive, then replaced by main's
    // normalized version — which may differ if a value was out of range.
    setSettings((current) => (current ? { ...current, ...patch } : current));
    try {
      setSettings(await api.updateSettings(patch));
    } catch (error) {
      notifications.show({
        color: 'red',
        title: 'Could not save settings',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  const value = useMemo<SettingsContextValue>(() => ({ settings, update }), [settings, update]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}
