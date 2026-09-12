import { IconTags } from '@tabler/icons-react';
import { META_EDITOR, type UtilityModule } from '../types';
import { MetaEditorPanel } from './MetaEditorPanel';

export const metaEditorModule: UtilityModule = {
  id: META_EDITOR.id,
  title: META_EDITOR.title,
  description: 'Set the artist, title and artwork on a file',
  icon: <IconTags size={18} />,
  section: 'edit',
  Panel: MetaEditorPanel,
};
