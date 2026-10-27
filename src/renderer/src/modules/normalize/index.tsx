import { IconVolume } from '@tabler/icons-react';
import type { UtilityModule } from '../types';
import { NormalizePanel } from './NormalizePanel';

export const normalizeModule: UtilityModule = {
  id: 'normalize',
  title: 'Loudness normalization',
  description: 'Bring a batch of files to the same loudness',
  icon: <IconVolume size={18} />,
  section: 'batch',
  Panel: NormalizePanel,
};
