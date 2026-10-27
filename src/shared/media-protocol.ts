/**
 * The custom scheme main registers to stream a local file into a
 * `<video>`/`<audio>` element. Shared so the renderer can build the same URL
 * shape main's protocol handler parses, without either side hardcoding it
 * twice.
 */
export const MEDIA_PROTOCOL_SCHEME = 'mediaeditor-file';

/**
 * `revision` changes the URL without changing the file it points at. A media
 * element given the same `src` again keeps what it already loaded, so after a
 * file is saved over, reopening it under a new revision is what makes the
 * element read the new contents. Main ignores the value.
 */
export function mediaFileUrl(path: string, revision = 0): string {
  return `${MEDIA_PROTOCOL_SCHEME}://local/media?path=${encodeURIComponent(path)}&revision=${String(revision)}`;
}
