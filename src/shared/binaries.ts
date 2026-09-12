/** External command-line tools the app depends on. Resolution lives in main/binaries.ts. */

export type BinaryId = 'ffmpeg' | 'ffprobe' | 'ytdlp' | 'deno' | 'node';

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
  /** False for a tool only one module needs, which must not gate startup. */
  isRequired: boolean;
}

/**
 * The JavaScript runtimes yt-dlp can drive, highest priority first — the same
 * order yt-dlp itself prefers them in. Only one is needed, which is why both are
 * optional, and why a missing runtime is a warning in the download panel rather
 * than a startup gate.
 */
export const JS_RUNTIME_IDS = ['deno', 'node'] as const;

export type JsRuntimeId = (typeof JS_RUNTIME_IDS)[number];

export const BINARY_DESCRIPTORS: readonly BinaryDescriptor[] = [
  {
    id: 'ytdlp',
    command: 'yt-dlp',
    displayName: 'yt-dlp',
    versionArg: '--version',
    purpose: 'Downloading from YouTube',
    isRequired: true,
  },
  {
    id: 'ffmpeg',
    command: 'ffmpeg',
    displayName: 'ffmpeg',
    versionArg: '-version',
    purpose: 'Audio extraction, tagging and export',
    isRequired: true,
  },
  {
    id: 'ffprobe',
    command: 'ffprobe',
    displayName: 'ffprobe',
    versionArg: '-version',
    purpose: 'Reading media information and verifying output',
    isRequired: true,
  },
  {
    id: 'deno',
    command: 'deno',
    displayName: 'Deno',
    versionArg: '--version',
    purpose: "Solving YouTube's JavaScript challenges (Deno or Node, either one)",
    isRequired: false,
  },
  {
    id: 'node',
    command: 'node',
    displayName: 'Node',
    versionArg: '--version',
    purpose: "Solving YouTube's JavaScript challenges (Deno or Node, either one)",
    isRequired: false,
  },
];

/** A JavaScript runtime as yt-dlp needs it named on the command line. */
export interface JsRuntime {
  name: JsRuntimeId;
  /** null when it came off PATH, where yt-dlp can look it up by name itself. */
  path: string | null;
}

export function isBinaryRequired(status: BinaryStatus): boolean {
  return BINARY_DESCRIPTORS.find((entry) => entry.id === status.id)?.isRequired ?? true;
}

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
