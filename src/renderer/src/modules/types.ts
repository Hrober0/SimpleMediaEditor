import type { ComponentType, ReactNode } from 'react';

/**
 * A utility module is a self-contained tool. The shell renders whatever the
 * registry lists; it knows nothing about individual modules, and modules know
 * nothing about each other.
 */
export interface UtilityModule {
  id: string;
  title: string;
  /** One line, shown under the title in the sidebar and panel header. */
  description: string;
  icon: ReactNode;
  section: ModuleSection;
  Panel: ComponentType;
}

/**
 * The meta editor, named once. Another module can send a file to it, and has to
 * call it what the sidebar calls it — so both come from here rather than from a
 * string repeated in two places, or from one module importing another.
 */
export const META_EDITOR = { id: 'tags', title: 'Media meta editor' } as const;

export type ModuleSection = 'download' | 'edit' | 'batch' | 'tools';

export interface SectionDescriptor {
  id: ModuleSection;
  label: string;
}

/** Sidebar grouping and order. Empty sections are not rendered. */
export const MODULE_SECTIONS: readonly SectionDescriptor[] = [
  { id: 'download', label: 'Get media' },
  { id: 'edit', label: 'Edit' },
  { id: 'batch', label: 'Batch' },
  { id: 'tools', label: 'Tools' },
];
