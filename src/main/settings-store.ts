import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { app } from 'electron';
import type { BinaryId } from '@shared/binaries';
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/settings';
import { errorMessage } from './errors';
import { isRecord, normalizeSettings } from './settings-validation';

/**
 * Settings live in a single JSON file under userData. Reads are synchronous from
 * memory; writes go through a temp file and a rename so a crash mid-write cannot
 * leave a truncated file that makes the app start with defaults.
 */
export class SettingsStore {
  private current: AppSettings = DEFAULT_SETTINGS;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly filePath = join(app.getPath('userData'), 'settings.json')) {}

  async load(): Promise<AppSettings> {
    const stored = await this.readFile();
    // Normalized before the fallback is applied, so a hand-edited non-string
    // downloadDirectory cannot slip through unvalidated.
    const normalized = normalizeSettings(stored ?? {});
    this.current = {
      ...normalized,
      // First run has no download folder; the OS Music folder is the least
      // surprising default and exists on both Windows and Linux.
      downloadDirectory: normalized.downloadDirectory ?? app.getPath('music'),
    };
    return this.current;
  }

  get(): AppSettings {
    return this.current;
  }

  update(patch: Partial<AppSettings>): AppSettings {
    this.current = normalizeSettings({ ...this.current, ...patch });
    this.queueWrite();
    return this.current;
  }

  binaryPathOverride(id: BinaryId): string | null {
    const value = this.current.binaryPaths[id];
    return value && value.trim() ? value : null;
  }

  private async readFile(): Promise<Partial<AppSettings> | null> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      return isRecord(parsed) ? parsed : null;
    } catch (error) {
      if (isMissingFile(error)) return null;
      // A corrupt settings file must not stop the app from starting.
      console.warn(`[settings] ignoring unreadable settings file: ${errorMessage(error)}`);
      return null;
    }
  }

  /** Serializes writes so rapid UI changes cannot interleave two renames. */
  private queueWrite(): void {
    const snapshot = this.current;
    this.writeChain = this.writeChain
      .then(async () => {
        await mkdir(dirname(this.filePath), { recursive: true });
        const temp = `${this.filePath}.tmp`;
        await writeFile(temp, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
        await rename(temp, this.filePath);
      })
      .catch((error: unknown) => {
        console.error(`[settings] failed to persist settings: ${errorMessage(error)}`);
      });
  }
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}
