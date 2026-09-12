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

`package` runs electron-builder with `--experimental-require-module`. app-builder-lib
26.15.x is CommonJS but requires `@noble/hashes` 2.x, which is ESM only, so the build
dies with `ERR_REQUIRE_ESM` on Node older than 22.12. The flag is a no-op once
everyone is on 22.12 or later, and it can be dropped when electron-builder fixes the
import.

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
fallback. On this machine: ffmpeg 7.1, yt-dlp 2026.06.09 and Node 22.10 are
installed and on `PATH`.

yt-dlp also needs a JavaScript runtime, Deno or Node, or YouTube answers every
download with `HTTP Error 403: Forbidden`. Only one is needed, so both are
optional descriptors: they must never gate startup, and the download panel warns
when neither was found.

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

A module never imports from another module. Anything two of them need belongs in
`renderer/src/components/`, `renderer/src/state/`, or `src/shared/`.

## Conventions

- No `any`. No non-null `!` to silence the compiler — narrow properly.
- ffmpeg argument arrays are built as `string[]` and passed to `spawn`. Never
  assemble a shell command string; user-supplied paths and URLs will break it and it
  is a command injection surface.
- Format support is data, not code: extend the `SupportedFormat` table rather than
  adding `if (ext === ...)` checks.
- Keep media-domain knowledge in `src/main/media/`, not in React components.

## Naming

Use plain, simple language. A name is the two or three words a teammate would use to
describe the thing out loud, not an invented term.

- No coined or clever names. If `downloadProgress` says it, do not write
  `downloadTelemetryEnvelope`.
- No abbreviations or invented acronyms. Write `selectedEntry`, not `selEnt`.
- Do not encode the type or the implementation in the name: `jobs`, not `jobsArray`;
  `isOpen`, not `openBooleanFlag`.
- Do not repeat the surrounding context. Inside `CoverArtCard`, a header is `Header`,
  not `CoverArtCardHeader`.
- Booleans read as a question: `isLoading`, `hasCoverArt`, `canEdit`.
- `on*` names a reaction to something that already happened: `onDrop`,
  `onSelectionChange`. Something the code is asked to do gets a plain action name:
  `saveTags`, `revealJobs`.
- Keep the same word for the same concept everywhere. Do not mix `entry`, `item` and
  `track` for one thing.
- Never invent a fuzzy term for a simple behaviour. No `bestEffortSync`,
  `smartRefresh`, `gracefulHandoff`. Say what it does: `retryOnceThenIgnore`. If it
  cannot be named in two or three plain words, it is doing too much: split it.

Comments explain **why**, never **what**. If a comment restates the code, delete it
and fix the name instead. No section-label comments, no commented-out code, no TODOs
without context, no file-header banners.

## Renderer conventions

### A JSX comment labelling a section means a missing component

If a section needs a comment to say what it is (`{/* Toolbar */}`, `{/* Footer */}`),
it should be its own component. Named components are self-documenting. This is about
labels, not about the "why" comments the rest of this file asks for.

### One component does one thing

That thing fits in one sentence you could say out loud. "Shows what a URL points at."
"Lets the user pick cover art." If the sentence needs an "and", or a "but only when",
it is already two components.

When a component grows, extract a new one rather than adding another branch, another
flag, or another block of JSX. Signals that it is time:

- The sentence describing it needs "and".
- Props are turning into mode switches: `variant`, `isCompact`, `showFooter`.
- Nested conditional JSX, or markup rendered in only one mode.
- The file is long enough that the return statement does not fit on screen.

Push logic out the same way. Shared state goes into a provider under `state/`, pure
transforms into `src/shared/`, and process work into `src/main/`. A component body
reads as a short list of named pieces, not as an algorithm.

An extracted component stays in the same file while it is small and used only there.
It moves into its own file in the module folder once it has its own props or state, or
into `renderer/src/components/` once a second module needs it.

### Reach for Mantine, then for the shared components, then write one

`src/renderer/src/components/` holds what is shared across modules: `FailureAlert`,
`PanelActions`, `DirectoryInput`, `JobsList`, `FileDropzone`. Check there before
building a UI element, and check Mantine before that. A one-off variant is a prop or a
style override on the shared component, never a fork of it into a module folder.

Anything that accepts a dropped file uses `FileDropzone`, never Mantine's `Dropzone`
directly. react-dropzone resolves dropped items through the File System Access API,
and Electron cannot map the resulting `File` back to a path, so the drop arrives with
an empty path and main refuses it. `FileDropzone` reads the files off the drop event
instead.

### Do not repeat the same styling

Three elements carrying the same style props want a small named wrapper in the same
file:

```tsx
<Fact>{formatDuration(seconds)}</Fact>
<Fact>{formatBytes(bytes)}</Fact>

function Fact({ children }: { children: ReactNode }): ReactNode {
  return <Badge variant="light">{children}</Badge>;
}
```

Prefer Mantine theme values and style props over inline CSS, so dark mode keeps
working. Where a raw CSS value is unavoidable, use a Mantine variable
(`var(--mantine-color-body)`), never a hardcoded colour.

### A config object beats a ternary chain in JSX

When what renders depends on several conditions, derive the props in TypeScript first
and pass them in. Keep the JSX a single flat expression.

```tsx
// bad
const alert = missing ? <Alert title="Missing" /> : failed ? <Alert title="Failed" /> : null;

// good
const alert = describeProblem(state);
return alert ? <FailureAlert {...alert} /> : null;
```

## Writing style

Do not use em dashes (`—`) or double hyphens (`--`) in comments, commit messages,
documentation, UI copy, or replies. Use a comma, a colon, or rewrite the sentence.

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
