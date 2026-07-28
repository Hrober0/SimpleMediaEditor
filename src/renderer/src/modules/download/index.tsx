import { IconBrandYoutube } from '@tabler/icons-react';
import type { UtilityModule } from '../types';
import { DownloadPanel } from './DownloadPanel';

export const downloadModule: UtilityModule = {
  id: 'download',
  title: 'YouTube download',
  description: 'Save music as MP3, or video as MP4',
  icon: <IconBrandYoutube size={18} />,
  section: 'download',
  Panel: DownloadPanel,
};
