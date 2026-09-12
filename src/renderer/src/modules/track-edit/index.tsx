import { IconScissors } from '@tabler/icons-react';
import type { UtilityModule } from '../types';
import { TrackEditPanel } from './TrackEditPanel';

export const trackEditModule: UtilityModule = {
  id: 'track-edit',
  title: 'Track Edit',
  description: 'Listen to a file and cut it down to the parts you want to keep',
  icon: <IconScissors size={18} />,
  section: 'edit',
  Panel: TrackEditPanel,
};
