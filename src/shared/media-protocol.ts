/**
 * The custom scheme main registers to stream a local file into a
 * `<video>`/`<audio>` element. Shared so the renderer can build the same URL
 * shape main's protocol handler parses, without either side hardcoding it
 * twice.
 */
export const MEDIA_PROTOCOL_SCHEME = 'mediaeditor-file';

export function mediaFileUrl(path: string): string {
  return `${MEDIA_PROTOCOL_SCHEME}://local/media?path=${encodeURIComponent(path)}`;
}
