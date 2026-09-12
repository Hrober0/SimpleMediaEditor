# MediaEditor — Plan

A local desktop app for editing audio and video, and for pulling media off YouTube.
Built as a shell hosting independent **utility modules**, so new tools can be added
without touching existing ones.

## Priorities

1. **Download music from YouTube** (mp3) — first thing that must work end to end. ✅
2. **Set author and thumbnail** on a selected file. ✅
3. Everything else below, in roughly the order listed. Next up is Phase 3.

---

## Stack

| Concern           | Choice                                                        |
| ----------------- | ------------------------------------------------------------- |
| Language          | TypeScript, strict mode, everywhere                           |
| Shell             | Electron                                                      |
| UI                | React + Vite                                                  |
| Component library | **Mantine**                                                   |
| Media work        | `ffmpeg` / `ffprobe` as child processes                       |
| YouTube           | `yt-dlp` as a child process                                   |
| Packaging         | electron-builder (NSIS for Windows, AppImage + deb for Linux) |

Electron is chosen over Tauri because its bundled Chromium has H.264/AAC enabled on
both Windows and Linux, which the video timeline (later phase) depends on. Tauri's
Linux webview (WebKitGTK) frequently ships without H.264, which would make video
preview work on Windows and silently break on Linux.

TypeScript is chosen over C# because the timeline editor and waveform view are
essentially free in a browser engine and hand-built work in Avalonia.

### UI: Mantine

Mantine supplies the component layer, so no time goes into buttons, inputs, modals,
or theming. It fits this app well: the two priority features are essentially forms
plus progress reporting, and Mantine covers all of it out of the box.

Packages:

| Package                  | Used for                                       |
| ------------------------ | ---------------------------------------------- |
| `@mantine/core`          | components, theming, dark mode                 |
| `@mantine/hooks`         | `useDisclosure`, `useLocalStorage`, debouncing |
| `@mantine/dropzone`      | drag-and-drop file input (Phase 2)             |
| `@mantine/notifications` | job completion and failure toasts              |
| `@mantine/form`          | metadata form state and validation (Phase 2)   |

Mapping to the features:

- **Shell** — `AppShell` with a `NavLink` sidebar built from the module registry;
  `Drawer` for the job list.
- **Phase 1 (download)** — `TextInput` for the URL, `Select` for format and quality,
  `Card` for the fetched video preview, `Progress` for download progress, `Code`
  inside `Collapse`+`Alert` for verbatim yt-dlp stderr on failure.
- **Phase 2 (metadata)** — `Dropzone` for file input, `TextInput` fields, `Image` for
  cover preview, `FileButton` for choosing artwork, `Group`/`Stack` for layout.
- **Dark mode** — `MantineProvider` with `defaultColorScheme="auto"`, which follows
  the OS on both Windows and Linux. No custom theming work needed.

Two practical notes:

- Current Mantine uses CSS Modules, not CSS-in-JS. `@mantine/core/styles.css` must be
  imported once at the app root (plus a stylesheet per extra package), and forgetting
  it produces an unstyled app rather than an error. There is no Emotion or Vite plugin
  setup to do.
- Mantine stops at the timeline (Phase 3). The waveform and cut-range editor is a
  custom canvas component — `Slider` is not a substitute for a multi-range,
  zoomable, scrubbable timeline. Mantine still supplies the chrome around it
  (toolbar, zoom controls, export modal).

### External binaries

`ffmpeg`, `ffprobe`, and `yt-dlp` are **not** bundled initially — they are resolved
at runtime. Verified present on this machine: ffmpeg 7.1, yt-dlp 2026.06.09,
Node 22.10.

A JavaScript runtime, **Deno or Node**, is resolved the same way. yt-dlp needs one
to solve the challenge YouTube signs its media URLs with; without it every
download fails with `HTTP Error 403: Forbidden`. Only one of the two is needed, so
both are optional: a missing runtime is a warning in the download panel, not a
startup gate.

Resolution order, implemented once in `main/binaries.ts`:

1. Path configured by the user in Settings
2. `PATH` lookup
3. Bundled fallback (added at packaging time, later phase)

On startup the app probes them all and shows a blocking setup screen naming the
missing **required** one. `yt-dlp` in particular must stay user-updatable — YouTube changes break
pinned versions regularly, so bundling a frozen copy is a support burden.

---

## Architecture

```
src/
  main/                  Node side — the only place that touches disk or spawns processes
    index.ts             app lifecycle, window creation
    binaries.ts          ffmpeg/ffprobe/yt-dlp discovery + version probing
    ipc.ts               channel registration
    jobs/
      queue.ts           job queue: concurrency cap, cancel, progress events
      runner.ts          spawn wrapper, stderr/stdout line parsing
    media/
      probe.ts           ffprobe -> normalized MediaInfo
      metadata.ts        read/write tags, cover art
      export.ts          trim / concat / re-encode (later phase)
      normalize.ts       two-pass loudnorm (later phase)
    ytdlp/
      download.ts        format selection, progress parsing
  preload/
    index.ts             contextBridge — the single typed surface renderer can see
  shared/
    ipc-contract.ts      request/response types, imported by BOTH sides
    media-types.ts       MediaInfo, Tags, JobStatus, SupportedFormat
  renderer/
    App.tsx              shell: module nav + active panel
    modules/
      registry.ts        the module list — one entry per utility
      download/          Priority 1
      metadata/          Priority 2
      trim/
      normalize/
      convert/
    components/          shared UI primitives
```

### Module registry

Each utility is a folder exporting one descriptor:

```ts
export interface UtilityModule {
  id: string;
  title: string;
  icon: ReactNode;
  section: 'download' | 'edit' | 'batch' | 'tools';
  Panel: React.ComponentType;
}
```

`registry.ts` is an array of those. The shell builds its navigation from the array
and renders `Panel` for the active entry. Adding a utility later means one new
folder plus one line in the registry — no changes to the shell, and no other module
needs to know it exists.

### Process boundary

The renderer never spawns anything and never touches the filesystem. It sends typed
requests over IPC and receives progress events. `nodeIntegration` stays off,
`contextIsolation` stays on. Every channel is declared in
`shared/ipc-contract.ts` so both sides fail to compile when they drift.

### Job model

Long-running work (download, export, normalize) becomes a `Job`:

```ts
type Job = {
  id: string;
  kind: 'download' | 'export' | 'normalize' | 'convert';
  label: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  progress: number | null; // null = indeterminate
  detail: string; // current speed / ETA / stage
  error?: string;
};
```

One queue with a configurable concurrency cap (default 2) serves every module, so
batch operations and a persistent progress list come for free instead of being
rebuilt per feature.

---

## Phase 0 — Scaffold ✅ done

- Electron + Vite + React + TS project, strict tsconfig, ESLint + Prettier
- Mantine installed and wired: `MantineProvider` at the root with
  `defaultColorScheme="auto"`, `Notifications` mounted, all required stylesheets
  imported
- Three-process structure with a typed IPC contract and one smoke-test channel
- `binaries.ts` probing ffmpeg/ffprobe/yt-dlp, with the missing-dependency screen
- App shell: Mantine `AppShell` with the sidebar built from the module registry,
  empty panel, job list drawer
- Dev scripts working on Windows and Linux

**Done when:** the app launches, reports the three binary versions it found, and the
sidebar renders from the registry.

**Built.** `npm run dev` boots and logs `yt-dlp 2026.06.09`, `ffmpeg 7.1`,
`ffprobe 7.1`. Deviations from the sketch above, all deliberate:

- Build tooling is **electron-vite** (one config for the three processes).
- TypeScript is pinned to **5.9**, not 7: no `typescript-eslint` release supports
  TS 7 yet, and typed linting is worth more than the newer compiler.
- Preload runs **sandboxed**; it exposes named methods only, never a generic
  `invoke(channel, …)`.
- Renderer state lives in three providers under `renderer/src/state/`
  (environment, settings, jobs). No data-fetching library — job state is pushed
  from main, so a query cache would only add a layer to bypass.
- A **Settings** module was added (tool paths, default folder, concurrency) so
  binary paths are configurable once the startup gate is satisfied.

---

## Phase 1 — YouTube download (priority 1) ✅ done

Focused on **music as mp3** first; video mp4 is the same code path with different
flags and lands in the same phase if it's cheap.

UI:

- URL input; paste-and-go. Playlist URLs detected and reported (queue each entry as
  its own job).
- Metadata preview via `yt-dlp --dump-single-json` before committing: title,
  uploader, duration, thumbnail. Cheap, and it makes wrong-URL mistakes obvious.
- Output: format (mp3 / mp4), quality, destination folder (remembered between runs).
- Filename template, defaulting to `%(title)s.%(ext)s` with a
  restrict-to-safe-characters toggle — needed because Windows rejects characters
  that Linux allows, and YouTube titles are full of them.

Audio download:

```
yt-dlp -x --audio-format mp3 --audio-quality 0 \
       --embed-thumbnail --embed-metadata \
       --newline -o <template> <url>
```

`--embed-thumbnail` and `--embed-metadata` mean downloaded music arrives with cover
art and tags already set, which is most of Priority 2 handled for free on this path.
Both require ffmpeg, which is present.

Video download:

```
yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" \
       --merge-output-format mp4 --newline -o <template> <url>
```

Implementation notes:

- `--newline` forces yt-dlp to emit progress on its own lines; parse
  `[download]  42.3% of 4.21MiB at 1.10MiB/s ETA 00:03` into the `Job`.
- Distinguish download from post-processing stages so the UI stops showing 100% and
  looking hung while ffmpeg transcodes.
- Cancel must kill the whole process tree and remove `.part` files.
- Surface yt-dlp's own stderr verbatim on failure. Its messages are genuinely
  informative ("video unavailable", "sign in to confirm your age") and paraphrasing
  them into a generic error only hides the answer.

**Done when:** a YouTube URL yields a tagged mp3 with cover art in the chosen folder,
with live progress and working cancel.

**Built and verified at the process level** (the job layer has no Electron
dependency, so it was driven directly against the real yt-dlp):

- mp3 output carries `title`/`artist`/`date` and an embedded cover art stream.
- Progress comes from `--progress-template`, parsed as fields rather than scraped
  from human-facing text, and reaches the job as a fraction plus a one-line detail.
- Post-processing stages (`Merging`, `Extracting audio`, `Writing metadata`,
  `Embedding cover art`, `Moving into place`) report indeterminate progress, so the
  bar never sits at 100% looking hung.
- Cancel during ffmpeg post-processing killed the whole tree — no stray `yt-dlp` or
  `ffmpeg` — and left nothing behind after 229 MB of partial download.
- `--convert-thumbnails jpg` was added: yt-dlp embeds PNG art by default, which is
  exactly the case some players ignore in an ID3 APIC frame.
- Partial output is contained by giving yt-dlp `--paths temp:<job dir>`, so cleanup
  is deleting one directory the job owns rather than guessing at `.part` files.
- For a single video the panel offers **Save as**, prefilled with the sanitized
  title; the filename template is then hidden, since only one of the two can decide
  the name. Playlists keep using the template. A literal name has its `%` escaped,
  or a title like "50% Off" would be read as a yt-dlp field reference.
- **Open in Media meta editor when finished** is a remembered switch, and applies to
  a single video only: a playlist has no one file to open. The handoff goes through
  `state/NavigationProvider`, which holds the active module and any file a module has
  been asked to open, so neither module imports the other and the switch still works
  if the user navigates away while the download runs. The editor takes the file once,
  so returning to it later does not reopen anything.

Covered by tests (`npm test`, 93 assertions, no network): argument construction,
progress/stage/path parsing, filename sanitizing, settings validation, the spawn
wrapper (including that a _grandchild_ process is killed), and the queue's
concurrency and cancel semantics. `npm run test:integration` drives the real yt-dlp:
tags and JPEG art on the produced mp3, and a cancel mid-download that leaves no file
and no stray `yt-dlp`/`ffmpeg` behind.

Still unverified: the GUI itself, and Linux behaviour.

### Two failures found once downloads were run for real

The `No supported JavaScript runtime could be found` warning was noted here as
cosmetic. It was not: it was the whole story behind downloads failing.

**`HTTP Error 403: Forbidden` on every download.** YouTube now withholds usable
formats from the clients yt-dlp reaches for on its own. Most require a GVS PO
token, and `android_vr`, which does not, is handed URLs that answer 403. Two
things are needed together, and neither works alone:

- A JavaScript runtime, which signs the format URLs. yt-dlp looks for Deno by
  itself but never for Node, so whichever the app resolved is named with
  `--js-runtimes`. Deno and Node are both optional binaries: only one is needed,
  so a missing runtime warns in the download panel rather than gating startup.
- `--extractor-args youtube:player_client=web_embedded,default`. `web_embedded`
  needs no PO token and still offers the full ladder up to 1080p, so it goes
  first, with yt-dlp's defaults kept behind it for videos that cannot be
  embedded. Verified against four videos. This stays only until yt-dlp's own
  defaults work again.

**"That file could not be used" when a finished download opened in the meta
editor.** yt-dlp writes its output in the console codepage, cp1250 on this
machine, while the spawn wrapper decodes UTF-8. A name like `Żółć.mp3` therefore
arrived as bytes that are not valid UTF-8, the path no longer matched anything on
disk, and the job fell back to reporting the destination _folder_ as its output
path. The meta editor then probed a directory. Fixed three ways:

- `--encoding utf-8`, so what yt-dlp writes is what the wrapper expects.
- `--print after_move:%(filepath)s`, so the finished file is named by yt-dlp
  rather than scraped from log lines. `--print` implies `--quiet`, which silently
  took the progress lines and the verbatim log with it, so `--no-quiet` follows
  it. The log-scraping patterns stay as a fallback for an already-downloaded file.
- A job's `outputPath` is now the produced file or nothing. It is never a folder,
  which is what turned an unknown filename into a confusing failure one step
  later. The cost is that "Show in folder" does not appear when the filename
  could not be determined, which the two fixes above should make unreachable.

Covered by an integration test that downloads to a non-ASCII filename and asserts
the reported path is the file on disk.

---

## Phase 2 — Author and thumbnail (priority 2) ✅ done

Editing tags on a file the user already has.

UI:

- File picker plus drag-and-drop
- Header from ffprobe: format, codec, duration, bitrate, resolution
- Current cover art shown if present
- Fields: **Author**, Title, Album, Year, Genre, Comment
- Thumbnail: pick an image, drop one, paste one with Ctrl+V, or (for video) grab the
  current frame; preview before saving; option to remove existing art
- Save (in place) / Save As

Tag mapping. `ffmpeg -metadata` keys differ per container, so one field maps to
different tags depending on the file:

| Field  | mp3 (ID3v2) | mp4/m4a               |
| ------ | ----------- | --------------------- |
| Author | `artist`    | `author` and `artist` |
| Title  | `title`     | `title`               |

For audio files "Author" is labeled **Artist** in the UI, because that is what every
music player reads. For video it is labeled **Author**. Both write the container's
conventional key; mp4 gets `author` and `artist` written together since players
disagree about which one they display.

Measured afterwards: ffmpeg 7.1's mov muxer has no atom for `author` and silently
drops it, so on mp4 the value lands in `artist` (`©ART`) alone — which is also what
Windows Explorer reads for its Authors column. Both keys are still requested, and an
integration test asserts what is actually written rather than what was intended.

Cover art embedding:

```
ffmpeg -i input.mp3 -i cover.jpg -map 0 -map 1 -c copy \
       -disposition:v:0 attached_pic \
       -metadata:s:v title="Album cover" out.mp3
```

Two things to get right here:

- **Never write over the input.** ffmpeg cannot read and write the same file. "Save
  in place" writes to a sibling temp file, verifies it with ffprobe, and only then
  replaces the original. A failed export must never destroy the user's file.
- **mp4 cover art is unreliable.** The `covr` atom is honored inconsistently across
  players. Write it, but say so in the UI rather than letting the user conclude the
  app is broken when VLC ignores it.

Cover art must be re-encoded to baseline JPEG at a sane size. PNGs and huge images
are where embedding silently fails in some players.

**Done when:** author and thumbnail can be set on an mp3 and an mp4, changes survive
a reopen, and in-place save cannot lose data.

**Built and verified against the real ffmpeg** (the media layer has no Electron
dependency, so the write path is driven exactly as the app drives it, on media
generated locally — no network):

- Tags round-trip on both an mp3 and an mp4: written, then read back by reopening
  the file, which is what the panel itself does after every save.
- Cover art is embedded as a JPEG attached picture, and an mp3 carrying one still
  probes as audio rather than as a video file.
- Clearing a field writes `key=`, which is how ffmpeg deletes a tag. Leaving the key
  out would have silently kept the old value — so that case is tested explicitly.
- A failed save leaves the original **byte-identical** and no temp file behind. The
  test proves it by feeding a cover image ffmpeg cannot decode.
- Save As writes the copy and leaves the source untouched.

Deviations from the sketch above, all deliberate:

- The write is a **queue job**, not an awaited IPC call: a stream copy still rewrites
  the whole container, which is minutes for a large video. Progress comes from
  ffmpeg's `-progress pipe:1` on stdout, leaving stderr entirely for the messages
  shown verbatim.
- Every cover image, picked, dropped, pasted, grabbed from a frame, or read back out
  of the file for preview, is re-encoded through **one** path into a baseline JPEG bounded
  at 1000 px, in a temp directory the app owns. The preview is therefore the exact
  bytes that get embedded, and the save step only accepts cover paths from that
  directory, so the renderer cannot point ffmpeg at an arbitrary file.
- Before replacing anything, the output is **re-probed** and compared with the input:
  a lost stream or a changed duration fails the job with the original untouched. The
  swap then moves the original aside and restores it if the rename fails, so
  `src/main/media/safe-write.ts` is the one path Phases 3 and 4 will reuse.
- Cover-art behaviour per container is **data**: `SupportedFormat` gained
  `tagFamily` and `coverArt: 'reliable' | 'unreliable' | 'unsupported'`. mp4 is
  `unreliable` and the UI says why; opus, wav, webm and mkv are `unsupported` and the
  artwork picker is replaced by an explanation instead of failing at save time.
- Dropped files go through `components/FileDropzone`, which takes the files straight
  off the drop event. react-dropzone otherwise resolves each item through the File
  System Access API, and `webUtils.getPathForFile` returns an empty string for a
  `File` that came from a `FileSystemFileHandle` rather than from the drag: measured
  in a throwaway Electron app driven by a CDP drag event, where the same drop gave a
  real path one way and an empty string the other. Every drop was refused with
  "Expected an absolute path" until this was in place.
- "Grab the current frame" is a **timestamp input**, not a scrubber: there is no
  video preview until Phase 3, and a scrub bar with nothing to scrub would be worse
  than an honest seconds field. It defaults to a tenth of the way in, since opening
  frames are often black.
- `JobsProvider` gained `waitForJob(id)`, so a module can react to its own work
  finishing without keeping a second copy of job state. Resolves immediately for a
  job that already finished, which is the common case on a small file.

Covered by `npm test` (177 assertions, no network): the tag key mapping per
container, ffmpeg argument construction for keep/remove/replace artwork,
ffprobe output parsing including telling an attached picture apart from real video,
ffmpeg progress parsing, temp-and-replace behaviour against a real filesystem, and
save-request validation. `npm run test:integration` covers the round trips above.

Still unverified: the GUI itself, and Linux behaviour.

---

## Phase 3 — Trim and timeline ← next

The largest piece of UI work.

- `<video>` element for preview, WaveSurfer.js for the waveform
- Waveform peaks are computed in the main process (ffmpeg → raw PCM → downsampled
  peaks array) and sent to the renderer. Never decode a long file in the renderer.
- Cut model: a list of **keep** ranges, not a single in/out pair. Trimming from the
  start, the end, or removing an interior segment are then the same operation, and
  multiple middle cuts cost nothing extra.
- Zoom, snap-to-keyframe indicators, keyboard scrubbing

Export has two modes, exposed explicitly:

- **Fast (lossless)** — `-c copy`, cuts snap to the nearest keyframe. The UI must
  show where the cut actually landed; this is the classic trap where a trim silently
  moves by up to several seconds or the audio desyncs.
- **Precise** — re-encodes, exact to the frame, slower.

Interior cuts are split-then-concat via the concat demuxer.

Unplayable inputs: HEVC and 10-bit mp4 will not preview in Chromium. On load,
ffprobe the codec; if it is not web-playable, generate a fast low-resolution proxy
for the timeline and apply the edit to the original file.

---

## Phase 4 — Batch audio normalization

- Multi-file selection, one job per file through the shared queue
- **Two-pass** `loudnorm`: measure, then apply. Single-pass is inaccurate — this is
  not an optimization to skip.
- Target EBU R128, default -14 LUFS (streaming-typical), configurable to -16 or -23
- Per-file before/after LUFS reported, so the result is verifiable
- Write to an output folder or in place, using the same temp-then-replace path as
  Phase 2

---

## Phase 5 — Format support and conversion

One table drives the whole app:

```ts
type SupportedFormat = {
  ext: string;
  kind: 'audio' | 'video';
  editable: boolean; // can be trimmed/tagged directly
  webPlayable: boolean; // previews without a proxy
};
```

Opening a non-editable file offers conversion to mp3 or mp4 first. Adding wav,
flac, mkv, or webm becomes a data change plus whatever ffmpeg flags that format
needs — not new UI.

---

## Phase 6 — Packaging

- electron-builder: NSIS installer for Windows, AppImage and deb for Linux
- Optional bundled ffmpeg for machines without it; yt-dlp stays external and
  updatable, with an "update yt-dlp" button invoking `yt-dlp -U`
- Settings persisted to `app.getPath('userData')`
- Verify on both platforms: path handling, filename sanitization, spawn behavior

---

## Risks

| Risk                                         | Handling                                                 |
| -------------------------------------------- | -------------------------------------------------------- |
| Trim lands on the wrong frame with `-c copy` | Two explicit export modes; show the real cut point       |
| In-place save destroys a file                | Temp file, verify, then atomic replace — always          |
| yt-dlp breaks when YouTube changes           | Keep it external, expose `-U`, surface its stderr        |
| Video will not preview (HEVC, 10-bit)        | Probe codec, generate a proxy for the timeline           |
| Filenames valid on Linux, illegal on Windows | Sanitize centrally; default the restrict-chars toggle on |
| Long files exhaust renderer memory           | Peaks computed in main, never full decode in renderer    |
| Electron bundle is ~150 MB                   | Accepted; the app already depends on ffmpeg              |

## Not in scope

Multi-track editing, effects and filters beyond normalization, transitions,
subtitles, and any cloud or account features.
