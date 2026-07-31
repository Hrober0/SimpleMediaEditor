import type { TagFamily } from '@shared/media-types';
import { TAG_FIELDS, type TagFieldDescriptor, type TagValues } from '@shared/metadata';

/**
 * The mapping between the app's tag fields and container tag keys, in both
 * directions. Kept pure and out of the process plumbing: which key "Author"
 * writes for an mp4 is exactly the sort of thing that is wrong silently.
 */

/** Reads the editable fields out of ffprobe's container tags. */
export function readTagValues(tags: Record<string, string>): TagValues {
  const values = {} as TagValues;
  for (const field of TAG_FIELDS) {
    const key = field.readKeys.find((candidate) => {
      const value = tags[candidate];
      return typeof value === 'string' && value.trim().length > 0;
    });
    values[field.id] = key ? (tags[key] ?? '').trim() : '';
  }
  return values;
}

/** Every `-metadata` key a field writes for this container. */
export function writeKeysFor(field: TagFieldDescriptor, family: TagFamily): readonly string[] {
  return [...field.writeKeys, ...(field.extraWriteKeys[family] ?? [])];
}

/**
 * `-metadata key=value` pairs for every field.
 *
 * An empty value is written as `key=`, which is how ffmpeg deletes a tag —
 * clearing a field in the UI has to actually clear it in the file, not leave the
 * old value in place.
 */
export function metadataArgs(values: TagValues, family: TagFamily): string[] {
  const args: string[] = [];
  for (const field of TAG_FIELDS) {
    for (const key of writeKeysFor(field, family)) {
      args.push('-metadata', `${key}=${values[field.id]}`);
    }
  }
  return args;
}
