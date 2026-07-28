import { join } from 'node:path';
import { app, BrowserWindow, shell } from 'electron';
import { BinaryResolver } from './binaries';
import { errorMessage } from './errors';
import { JobQueue } from './jobs/queue';
import { broadcast, registerIpcHandlers } from './ipc';
import { SettingsStore } from './settings-store';

const settings = new SettingsStore();
const binaries = new BinaryResolver((id) => settings.binaryPathOverride(id));
const queue = new JobQueue(() => settings.get().jobConcurrency);

// A second instance would fight over the settings file and the job temp directories.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [existing] = BrowserWindow.getAllWindows();
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      existing.focus();
    }
  });

  void start();
}

async function start(): Promise<void> {
  // Shows the app's own name on Windows notifications and in the taskbar group.
  if (process.platform === 'win32') app.setAppUserModelId('dev.mediaeditor.app');

  await app.whenReady();
  await settings.load();
  await binaries.refresh();

  registerIpcHandlers({ settings, binaries, queue });
  queue.onChanged((jobs) => broadcast('jobs:changed', jobs));

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 900,
    minHeight: 640,
    // Avoids a white flash before Mantine has applied the colour scheme.
    show: false,
    backgroundColor: '#1a1b1e',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // The renderer spawns nothing and touches no files; everything it needs
      // arrives over the channels declared in shared/ipc-contract.ts.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once('ready-to-show', () => window.show());

  // External links open in the user's browser; nothing navigates the app window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) {
      event.preventDefault();
      void openExternal(url);
    }
  });

  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

async function openExternal(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) return;
  try {
    await shell.openExternal(url);
  } catch (error) {
    console.warn(`[main] could not open ${url}: ${errorMessage(error)}`);
  }
}

// Running jobs own child processes and temp directories; quitting has to stop
// them rather than orphan an ffmpeg holding a half-written file.
app.on('before-quit', () => {
  queue.cancelAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
