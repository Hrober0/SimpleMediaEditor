/** External command-line tools the app depends on. Resolution lives in main/binaries.ts. */

export type BinaryId = 'ffmpeg' | 'ffprobe' | 'ytdlp';

/** Where a resolved binary came from, in the order the resolver tries them. */
export type BinarySource = 'setting' | 'path' | 'bundled';

export interface BinaryDescriptor {
  id: BinaryId;
  /** Executable name to look for on PATH (without platform extension). */
  command: string;
  displayName: string;
  /** Argument that makes the tool print its version and exit. */
  versionArg: string;
  purpose: string;
}

export const BINARY_DESCRIPTORS: readonly BinaryDescriptor[] = [
  {
    id: 'ytdlp',
    command: 'yt-dlp',
    displayName: 'yt-dlp',
    versionArg: '--version',
    purpose: 'Downloading from YouTube',
  },
  {
    id: 'ffmpeg',
    command: 'ffmpeg',
    displayName: 'ffmpeg',
    versionArg: '-version',
    purpose: 'Audio extraction, tagging and export',
  },
  {
    id: 'ffprobe',
    command: 'ffprobe',
    displayName: 'ffprobe',
    versionArg: '-version',
    purpose: 'Reading media information and verifying output',
  },
];

export interface BinaryStatus {
  id: BinaryId;
  displayName: string;
  purpose: string;
  /** Absolute path or bare command name that worked, or null when unresolved. */
  path: string | null;
  version: string | null;
  source: BinarySource | null;
  /** Why resolution failed, verbatim where useful. */
  error: string | null;
}

export function isBinaryAvailable(status: BinaryStatus): boolean {
  return status.path !== null;
}
