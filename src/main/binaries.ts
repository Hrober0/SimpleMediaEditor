import { dirname, join } from 'node:path';
import { app } from 'electron';
import {
  BINARY_DESCRIPTORS,
  JS_RUNTIME_IDS,
  type BinaryDescriptor,
  type BinaryId,
  type BinarySource,
  type BinaryStatus,
  type JsRuntime,
} from '@shared/binaries';
import { AppFailure, errorMessage } from './errors';
import { runProcess } from './jobs/runner';

/**
 * The only place external binary paths are resolved.
 *
 * Resolution order is user setting, then PATH, then a bundled copy. Nothing else
 * in the app may hardcode a path or assume a tool is on PATH — everything asks
 * here, so a user with ffmpeg in an unusual place configures it once.
 */
export class BinaryResolver {
  private statuses: readonly BinaryStatus[] = BINARY_DESCRIPTORS.map(unresolved);

  constructor(private readonly overrideFor: (id: BinaryId) => string | null) {}

  async refresh(): Promise<readonly BinaryStatus[]> {
    this.statuses = await Promise.all(BINARY_DESCRIPTORS.map((d) => this.resolve(d)));
    for (const status of this.statuses) {
      const where = status.path ? `${status.path} (${status.source})` : 'not found';
      console.info(`[binaries] ${status.displayName}: ${status.version ?? where}`);
    }
    return this.statuses;
  }

  list(): readonly BinaryStatus[] {
    return this.statuses;
  }

  pathFor(id: BinaryId): string | null {
    return this.statuses.find((status) => status.id === id)?.path ?? null;
  }

  /** Use when the operation cannot proceed without the tool. */
  require(id: BinaryId): string {
    const status = this.statuses.find((entry) => entry.id === id);
    if (!status?.path) {
      const name = status?.displayName ?? id;
      throw new AppFailure(
        `${name} was not found.`,
        status?.error ?? `Set the path to ${name} in Settings, or install it and restart.`,
      );
    }
    return status.path;
  }

  /**
   * yt-dlp needs a directory containing both ffmpeg and ffprobe. Passing it
   * explicitly means yt-dlp uses the same build the rest of the app resolved,
   * rather than a different one that happens to be earlier on PATH.
   */
  ffmpegDirectory(): string | null {
    const ffmpegPath = this.pathFor('ffmpeg');
    if (!ffmpegPath) return null;
    // A bare command name resolved from PATH has no directory to hand over.
    const directory = dirname(ffmpegPath);
    return directory === '.' ? null : directory;
  }

  /**
   * The runtime yt-dlp solves YouTube's JavaScript challenges with. Without one,
   * YouTube only offers formats that then fail with HTTP 403, so it is passed on
   * every call: yt-dlp looks for Deno by itself but never for Node.
   */
  jsRuntime(): JsRuntime | null {
    for (const id of JS_RUNTIME_IDS) {
      const status = this.statuses.find((entry) => entry.id === id);
      if (!status?.path) continue;
      // A bare command name is handed over as no path at all: yt-dlp wants a real
      // path or a directory there, and can find the runtime on PATH itself.
      return { name: id, path: status.source === 'path' ? null : status.path };
    }
    return null;
  }

  private async resolve(descriptor: BinaryDescriptor): Promise<BinaryStatus> {
    const attempts: string[] = [];

    for (const candidate of this.candidates(descriptor)) {
      try {
        const version = await probeVersion(candidate.path, descriptor);
        return {
          ...unresolved(descriptor),
          path: candidate.path,
          version,
          source: candidate.source,
          error: null,
        };
      } catch (error) {
        attempts.push(`${candidate.source}: ${candidate.path} — ${errorMessage(error)}`);
      }
    }

    return { ...unresolved(descriptor), error: attempts.join('\n') };
  }

  private candidates(descriptor: BinaryDescriptor): { path: string; source: BinarySource }[] {
    const candidates: { path: string; source: BinarySource }[] = [];

    const override = this.overrideFor(descriptor.id);
    if (override) candidates.push({ path: override, source: 'setting' });

    // A bare command name lets the OS search PATH; no manual PATH parsing.
    candidates.push({ path: executableName(descriptor.command), source: 'path' });

    const bundled = bundledPath(descriptor.command);
    if (bundled) candidates.push({ path: bundled, source: 'bundled' });

    return candidates;
  }
}

async function probeVersion(binary: string, descriptor: BinaryDescriptor): Promise<string> {
  const result = await runProcess({
    binary,
    args: [descriptor.versionArg],
    captureStdout: true,
    timeoutMs: 8000,
  });

  if (result.terminated) throw new AppFailure('timed out while reporting its version');
  if (result.code !== 0) {
    const detail = result.stderrTail.at(-1) ?? `exit code ${String(result.code)}`;
    throw new AppFailure(detail);
  }

  return parseVersion(descriptor.id, result.stdout);
}

function parseVersion(id: BinaryId, stdout: string): string {
  const firstLine = stdout.split('\n')[0]?.trim() ?? '';
  if (id === 'ytdlp') return firstLine || 'unknown';
  // "ffmpeg version 7.1 Copyright (c) ..." — keep just the version token.
  const match = /^ff(?:mpeg|probe) version (\S+)/.exec(firstLine);
  return match?.[1] ?? (firstLine || 'unknown');
}

function executableName(command: string): string {
  return process.platform === 'win32' ? `${command}.exe` : command;
}

/**
 * Last resort: a copy shipped with the app. Present only if binaries were placed
 * in build/bin at packaging time (see electron-builder.yml).
 */
function bundledPath(command: string): string | null {
  const name = executableName(command);
  return app.isPackaged
    ? join(process.resourcesPath, 'bin', name)
    : join(app.getAppPath(), 'build', 'bin', name);
}

function unresolved(descriptor: BinaryDescriptor): BinaryStatus {
  return {
    id: descriptor.id,
    displayName: descriptor.displayName,
    purpose: descriptor.purpose,
    path: null,
    version: null,
    source: null,
    error: null,
  };
}
