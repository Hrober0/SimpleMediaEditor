import type { CoverChange, CoverImage } from '@shared/metadata';

/**
 * The pending cover art choice.
 *
 * It carries the whole prepared image rather than just its path, because the
 * panel previews exactly the JPEG that will be embedded — main has already
 * re-encoded it, so what is on screen is what lands in the file.
 */
export type CoverDraft =
  { kind: 'keep' } | { kind: 'remove' } | { kind: 'replace'; image: CoverImage };

export function toCoverChange(draft: CoverDraft): CoverChange {
  return draft.kind === 'replace'
    ? { kind: 'replace', imagePath: draft.image.path }
    : { kind: draft.kind };
}
