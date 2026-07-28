# MediaEditor

A local desktop app for editing audio/video files and downloading media from
YouTube. Electron + React + Mantine on the front, `ffmpeg` and `yt-dlp` doing the
actual media work as child processes.

Nothing leaves your machine, and there is no account or cloud anything.

See [plan.md](plan.md) for the roadmap and the reasoning behind the architecture,
and [CLAUDE.md](CLAUDE.md) for the rules that code in this repo follows.

## What works today

- **YouTube download** — paste a video or playlist URL, preview what it is, pick
  MP3 or MP4, and queue it. MP3s arrive with tags and cover art already embedded.
  Live progress, working cancel, and yt-dlp's own error messages shown verbatim.
- **Settings** — tool paths, default download folder, how many jobs run at once.

Next up is setting author and cover art on files you already have.

## Requirements

| Tool        | Why                                  | Notes                                         |
| ----------- | ------------------------------------ | --------------------------------------------- |
| Node.js 20+ | build tooling                        | only needed to develop or build               |
| `yt-dlp`    | downloading                          | keep it updated — YouTube breaks old versions |
| `ffmpeg`    | audio extraction, tagging, export    |                                               |
| `ffprobe`   | reading media info, verifying output | ships with ffmpeg                             |

The three tools are **not bundled**; they are found at runtime. Resolution order is
the path you set in Settings, then `PATH`, then a copy shipped alongside the app.
If any are missing, the app opens on a setup screen naming them instead of failing
later with something cryptic.

On Windows, `winget install ffmpeg` and `winget install yt-dlp` are enough.

> yt-dlp may warn `No supported JavaScript runtime could be found … some formats
may be missing`. Installing [Deno](https://deno.com) clears it and restores full
> format availability. The warning shows up in the job log.

## Commands

```
npm install              # once

npm run dev              # Vite + Electron in watch mode
npm run typecheck        # tsc, must pass before any change is done
npm run lint             # eslint
npm test                 # unit tests — fast, no network
npm run test:watch       # unit tests in watch mode
npm run test:integration # drives the real yt-dlp against YouTube (needs network)
npm run format           # prettier

npm run build            # typecheck + production bundle into out/
npm run package          # installer for the current platform into release/
```

`npm test` never touches the network, so it is safe to run constantly.
`npm run test:integration` really downloads a short video, checks the tags and
cover art that come out, then cancels a large download and verifies nothing is
left behind — it takes about ten seconds.

## Layout

```
src/
  main/           Node side — the only place that spawns processes or touches disk
    index.ts        app lifecycle, window creation, external-link handling
    binaries.ts     ffmpeg/ffprobe/yt-dlp discovery and version probing
    ipc.ts          channel handlers, and validation of everything the UI sends
    settings-store.ts       settings file, written atomically
    settings-validation.ts  untrusted values in, valid settings out
    errors.ts       AppFailure — an error carrying tool output worth showing
    jobs/
      queue.ts        the job queue: concurrency, progress, cancel
      runner.ts       the only spawn wrapper; kills whole process trees
    ytdlp/
      args.ts         argument construction, kept pure
      output-parser.ts  yt-dlp output -> progress, stage, output path
      inspect.ts      what a URL points at, before committing to a download
      download.ts     one download as a queue job
  preload/        contextBridge — the only surface the renderer can see
  shared/         types and helpers imported by both sides
    ipc-contract.ts   every channel, typed; a drift is a compile error
    filenames.ts      the one filename sanitizer
    jobs.ts, settings.ts, download.ts, media-types.ts, result.ts, format.ts
  renderer/       React UI
    src/
      App.tsx         the shell: nav built from the registry, job drawer
      api.ts          the renderer's single point of contact with main
      state/          environment, settings and jobs providers
      components/     shared UI (job drawer, failure alert, tool status…)
      modules/        one folder per utility, plus registry.ts
```

Tests sit next to what they test (`*.test.ts`), with the network-dependent ones
named `*.integration.test.ts`.

**Adding a utility** means adding a folder under `src/renderer/src/modules/` that
exports a `UtilityModule`, plus one line in `registry.ts`. The shell reads the
registry; it does not know about individual modules.

## Running it as an app on Windows

### With an installer (what you want for everyday use)

```
npm run package
```

This produces `release/MediaEditor Setup 0.1.0.exe`. Run it — it is a normal NSIS
installer, so it lets you choose the install location and creates Start-menu and
desktop shortcuts for you. After that, MediaEditor behaves like any installed app
and you can pin it to the taskbar.

To get a proper icon instead of the default Electron one, drop a 256×256
`icon.ico` into `build/` before packaging.

### Without an installer (a shortcut to a portable build)

```
npx electron-builder --dir
```

That writes an unpacked app to `release/win-unpacked/`. Then:

1. Open `release/win-unpacked/` in Explorer.
2. Right-click `MediaEditor.exe` → **Show more options** → **Send to** →
   **Desktop (create shortcut)**.
3. Optionally right-click the running app in the taskbar → **Pin to taskbar**.

Note this folder is rebuilt by later packaging runs; the installer route is the
sturdier one.

### A shortcut that starts the dev version

Useful while working on the app. Create a shortcut with this as its target:

```
cmd /c "cd /d C:\Coding\MediaEditor && npm run dev"
```

Set **Start in** to `C:\Coding\MediaEditor`. It opens a console window alongside
the app — that console is where main-process logs and errors appear, which is the
point.

## Linux

`npm run package` produces an AppImage and a `.deb`. Linux is a supported target
but is currently **unverified** — path handling, filename rules and process
killing are all written for both platforms, and none of it has been run there yet.
