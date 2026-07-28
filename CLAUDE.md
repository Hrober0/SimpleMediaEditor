# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

**MediaEditor** — a local Electron desktop app for editing audio/video files and
downloading media from YouTube. It is a shell hosting independent utility modules;
new tools are added as modules rather than by extending existing ones.

Read [plan.md](plan.md) for the phased roadmap, architecture rationale, and current
priorities. Keep it updated as phases complete — it is the source of truth for what
is built and what is next.

**Current priority order:** (1) YouTube music download to mp3, (2) setting author and
thumbnail on a selected file. Do not start later phases while these are unfinished.

## Stack

TypeScript (strict) · Electron · React + Vite · **Mantine** · electron-builder.
Media work is delegated to `ffmpeg`/`ffprobe`; YouTube to `yt-dlp`.

UI is built from Mantine components — reach for one before writing a custom
component or hand-rolling CSS. Theme values (`useMantineTheme`, style props) rather
than hardcoded colors and spacing, so dark mode keeps working. The Phase 3 timeline
is the deliberate exception: it is a custom canvas component with Mantine chrome
around it.

Target platforms are Windows and Linux. Both matter equally — never write a
Windows-only path, and never assume POSIX either.

## Commands

<!-- Fill in as the project is scaffolded. -->

```
npm run dev              # Vite + Electron in watch mode
npm run typecheck        # tsc -b, must pass before any change is done
npm run lint
npm test                 # unit tests (vitest) — no network, safe to run always
npm run test:integration # drives the real yt-dlp against YouTube; opt-in
npm run build            # production bundle
npm run package          # electron-builder for the current platform
```

## Layout

```
src/main/       Node side: process spawning, filesystem, job queue
src/preload/    contextBridge — the only surface the renderer can see
src/shared/     types imported by both sides, incl. the IPC contract
src/renderer/   React UI; modules/ holds one folder per utility
```

## Rules that matter

These reflect real failure modes in this domain. Follow them without needing to be
reminded.

### Never write ffmpeg output over its input

ffmpeg cannot read and write the same file. Every "save in place" writes to a sibling
temp file, verifies it with ffprobe, and only then replaces the original. A failed
export must never leave the user without their file. This applies to metadata edits,
trims, and normalization alike — route them all through the same helper.

### The renderer spawns nothing and touches no files

All process spawning and filesystem access lives in `src/main/`. `contextIsolation`
stays on and `nodeIntegration` stays off. If the renderer needs something, add a
typed channel to `src/shared/ipc-contract.ts` — never widen the preload surface with
a generic passthrough.

### Every IPC channel is typed in shared/

Request and response types live in `src/shared/ipc-contract.ts` and are imported by
both main and renderer, so a drift between the two sides is a compile error rather
than a runtime one.

### Long-running work is a Job, not an awaited call

Downloads, exports, and normalization go through the queue in `src/main/jobs/`. They
report progress, they are cancellable, and cancelling kills the whole process tree
and cleans up partial output (`.part` files, temp files). Do not add a second
progress mechanism for a new feature.

### External binary paths are resolved in one place

`src/main/binaries.ts` only. Never hardcode a path and never assume a binary is on
`PATH` without checking. Resolution order is user setting → `PATH` → bundled
fallback. On this machine: ffmpeg 7.1 and yt-dlp 2026.06.09 are installed and on
`PATH`.

### Surface ffmpeg and yt-dlp errors verbatim

Their stderr is genuinely informative ("video unavailable", "sign in to confirm your
age", codec complaints). Show it, in a details pane if it is long. Do not collapse it
into a generic "Download failed" — that hides the answer the user needs.

### Sanitize filenames centrally

Windows rejects `< > : " / \ | ? *` and trailing dots; Linux does not. YouTube titles
contain all of them. One sanitizer, used by every code path that derives a filename.

### Adding a utility means adding a module

New feature → new folder under `src/renderer/modules/`, exporting a `UtilityModule`
descriptor, plus one line in `registry.ts`. The shell reads the registry; it does not
know about individual modules. Do not add feature-specific branching to `App.tsx`.

## Conventions

- No `any`. No non-null `!` to silence the compiler — narrow properly.
- ffmpeg argument arrays are built as `string[]` and passed to `spawn`. Never
  assemble a shell command string; user-supplied paths and URLs will break it and it
  is a command injection surface.
- Format support is data, not code: extend the `SupportedFormat` table rather than
  adding `if (ext === ...)` checks.
- Keep media-domain knowledge in `src/main/media/`, not in React components.

## Verification

`npm run typecheck` and `npm test` must both pass before any change is considered
done.

Tests live next to what they test. What is worth testing here is the logic where a
mistake is _silent_: argument construction, output parsing, filename sanitizing,
settings validation, and the queue's cancel behaviour. A wrong yt-dlp flag or a
missed progress line looks exactly like working software, which is why these are
covered rather than the React tree.

Anything that needs the real tools and the network goes in `*.integration.test.ts`
and runs only from `npm run test:integration` — never make `npm test` depend on
YouTube being reachable.

The GUI cannot be verified without a human running it. After UI changes, say what you
changed and what the user should look at, rather than asserting it works. Linux
behavior is unverified from a Windows dev machine — flag anything platform-sensitive
so it can be tested there.
