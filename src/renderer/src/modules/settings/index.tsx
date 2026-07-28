import { IconSettings } from '@tabler/icons-react';
import type { UtilityModule } from '../types';
import { SettingsPanel } from './SettingsPanel';

export const settingsModule: UtilityModule = {
  id: 'settings',
  title: 'Settings',
  description: 'Tool paths, default folders, job concurrency',
  icon: <IconSettings size={18} />,
  section: 'tools',
  Panel: SettingsPanel,
};
