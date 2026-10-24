# Done

What is built, when it landed, and why it was built the way it was. Newest work
is at the bottom of each section. What comes next is in [roadmap.md](roadmap.md).

---

## Foundations

_Added 2026-07-29._

A local desktop app for editing audio and video and for pulling media off
YouTube, built as a shell hosting independent **utility modules**, so a new tool
is added without touching the existing ones.

### Stack

| Concern    | Choice                                                        |
| ---------- | ------------------------------------------------------------- |
| Language   | TypeScript, strict mode, everywhere                           |
| Shell      | Electron, built with electron-vite                            |
| UI         | React + Vite, **Mantine** components                          |
| Media work | `ffmpeg` / `ffprobe` as child processes                       |
| YouTube    | `yt-dlp` as a child process                                   |
| Packaging  | electron-builder (NSIS for Windows, AppImage + deb for Linux) |

- **Electron over Tauri:** Electron's bundled Chromium has H.264 and AAC on both
  Windows and Linux, which video preview depends on. Tauri's Linux webview
  (WebKitGTK) often ships without H.264, so preview would work on Windows and
  silently break on Linux.
- **TypeScript over C#:** a timeline and a waveform view come nearly free in a
  browser engine and are hand-built work in Avalonia.
- **Mantine** supplies buttons, inputs, modals, notifications and dark mode
  (`defaultColorScheme="auto"` follows the OS). It uses CSS Modules, so its
  stylesheets must be imported once at the root; forgetting one gives an
  unstyled app rather than an error. It stops at the timeline: the waveform is a
  custom canvas component with Mantine chrome around it.
- **TypeScript is pinned to 5.9**, not 7: no `typescript-eslint` release supports
  7 yet, and typed linting is worth more than the newer compiler.

### External binaries

`ffmpeg`, `ffprobe` and `yt-dlp` are not bundled; they are found at runtime, in
one place (`main/binaries.ts`), in this order: the path set in Settings, then
`PATH`, then a bundled fallback (not built yet). On startup the app probes them
and shows a blocking setup screen naming any required one that is missing.
yt-dlp in particular must stay user-updatable: YouTube changes break pinned
versions regularly.

### Process boundary

The renderer never spawns anything and never touches the filesystem. It sends
typed requests over IPC and receives progress events. `nodeIntegration` is off,
`contextIsolation` is on, and the preload runs **sandboxed**, exposing named
methods only, never a generic `invoke(channel, …)`. Every channel is declared in
`shared/ipc-contract.ts`, so the two sides fail to compile when they drift.

### Job model

Long-running work (download, export, normalize) is a `Job` with a status,
a progress fraction (or null for indeterminate), a one-line detail and an error.
One queue with a configurable concurrency cap serves every module, so batch work
and a persistent progress list come for free instead of being rebuilt per
feature. Renderer state lives in providers under `renderer/src/state/`
(environment, settings, jobs, navigation). There is no data-fetching library:
job state is pushed from main, so a query cache would only be a layer to bypass.

### Module registry

Each utility is a folder exporting a `UtilityModule` descriptor (id, title,
description, icon, section, panel). `registry.ts` is an array of them; the shell
builds its navigation from it and renders the active panel. A **Settings** module
(tool paths, default folder, how many jobs run at once) was added alongside, so
binary paths are configurable once the startup gate is passed.

---

## YouTube download

_Added 2026-07-29. Download failures fixed 2026-09-12._

Paste a video or playlist URL, see what it points at, pick MP3 or MP4, and queue
it.

- A preview from `yt-dlp --dump-single-json` before committing (title, uploader,
  duration, thumbnail), so a wrong URL is obvious. Playlists are detected and
  each entry is queued as its own job.
- MP3 output carries `title`, `artist` and `date` and embedded cover art.
  `--convert-thumbnails jpg` is set because yt-dlp embeds PNG by default, which
  some players ignore in an ID3 picture frame.
- Progress comes from `--progress-template`, parsed as fields rather than scraped
  from human-facing text. Post-processing stages (merging, extracting audio,
  writing metadata, embedding cover art) report indeterminate progress, so the
  bar never sits at 100% looking hung.
- Cancel kills the whole process tree, including yt-dlp's ffmpeg child. Partial
  output is contained by `--paths temp:<job dir>`, so cleanup is deleting one
  directory the job owns rather than guessing at `.part` files. Verified with
  229 MB of partial download left behind: nothing.
- A single video offers **Save as**, prefilled with the sanitized title; the
  filename template is then hidden, since only one of the two can decide the
  name. A literal name has its `%` escaped, or a title like "50% Off" would be
  read as a yt-dlp field reference.
- **Open in Media meta editor when finished** is a remembered switch for single
  videos. The handoff goes through `state/NavigationProvider`, so neither module
  imports the other.
- yt-dlp's stderr is shown verbatim on failure: its messages ("video
  unavailable", "sign in to confirm your age") are the answer the user needs.

### Two failures found once downloads ran for real

**`HTTP Error 403: Forbidden` on every download.** YouTube withholds usable
formats from the clients yt-dlp picks by itself. Two things are needed together:

- A JavaScript runtime to sign the format URLs. yt-dlp looks for Deno on its own
  but never for Node, so whichever the app found is passed with `--js-runtimes`.
  Both are optional binaries: only one is needed, so a missing runtime warns in
  the download panel rather than gating startup.
- `--extractor-args youtube:player_client=web_embedded,default`. `web_embedded`
  needs no PO token and still offers up to 1080p; yt-dlp's defaults stay behind
  it for videos that cannot be embedded. This stays only until yt-dlp's own
  defaults work again.

**A finished download would not open in the meta editor.** yt-dlp wrote its
output in the console codepage (cp1250 here) while the spawn wrapper decodes
UTF-8, so a name like `Żółć.mp3` came back garbled, matched nothing on disk, and
the job reported the folder as its output. Fixed with `--encoding utf-8`, with
`--print after_move:%(filepath)s` so yt-dlp names the finished file itself
(plus `--no-quiet`, since `--print` silently implies `--quiet`), and by making a
job's `outputPath` either the produced file or nothing, never a folder.

Covered by unit tests (argument construction, progress and path parsing,
filename sanitizing, settings validation, the spawn wrapper killing a grandchild
process, the queue's cancel behaviour) and by integration tests against the real
yt-dlp, including a download to a non-ASCII filename.

---

## Media meta editor

_Added 2026-07-31._

Edit tags and cover art on a file you already have: Author (labelled Artist for
audio, since that is what music players read), Title, Album, Year, Genre and
Comment. Cover art can be picked, dropped, pasted, grabbed from a video frame,
or removed.

- **Never write over the input.** ffmpeg cannot read and write the same file.
  Every save writes a temp sibling, re-probes it and compares it with the input
  (a lost stream or a changed duration fails the job), and only then replaces
  the original, moving it aside first and restoring it if the rename fails.
  `main/media/safe-write.ts` is that one path, and every later write reuses it.
  A failed save leaves the original byte-identical.
- **The save is a queue job**, not an awaited call: even a stream copy rewrites
  the whole container, which is minutes for a large video. Progress comes from
  ffmpeg's `-progress pipe:1`, leaving stderr for the messages shown verbatim.
- **Tag keys differ per container.** On mp4, ffmpeg 7.1's muxer has no atom for
  `author` and drops it, so the value lands in `artist` (`©ART`) alone, which is
  also what Windows Explorer shows. Clearing a field writes `key=`, which is how
  ffmpeg deletes a tag; leaving the key out would have kept the old value.
- **Every cover image goes through one path** into a baseline JPEG of at most
  1000 px in a temp directory the app owns. The preview is the exact bytes that
  get embedded, and the save only accepts cover paths from that directory, so
  the renderer cannot point ffmpeg at an arbitrary file.
- **Cover art support is data:** `SupportedFormat` carries `tagFamily` and
  `coverArt: 'reliable' | 'unreliable' | 'unsupported'`. mp4 is `unreliable` and
  the UI says why; opus, wav, webm and mkv get an explanation instead of a picker.
- **Dropped files go through `components/FileDropzone`**, which reads them off
  the drop event. react-dropzone resolves items through the File System Access
  API, and Electron returns an empty path for such a `File`, so every drop was
  refused until this was in place.
- `JobsProvider` gained `waitForJob(id)`, so a module can react to its own work
  finishing without keeping a second copy of job state.

Covered by unit tests (tag mapping per container, write arguments for keeping,
removing and replacing artwork, ffprobe parsing including telling cover art from
real video, temp-and-replace against a real filesystem) and by integration tests
that round-trip tags and art on an mp3 and an mp4.

---

## Track Edit

_Added 2026-09-12. Cut and paste, gap-free preview and the fast export fix added
2026-10-24._

Open a file, play it, and cut parts out of it. Shown in the sidebar as
**Track Edit**.

### The cut model

- The track is a list of **segments** kept from the original file, in play
  order. Dragging on the waveform makes one selection, which is UI state only:
  nothing changes until **Cut** (X) or **Delete** (Backspace). Save writes out
  whatever the segments are.
- Cut keeps the removed part on a clipboard; **Paste** (V) inserts it at the
  playhead and pushes everything after it later. Delete removes the part without
  touching the clipboard. Opening another file empties it.
- The waveform draws only the current segments: a cut closes the gap, so the
  display reads as the track as it now is, not the original with parts marked.
  Preview follows the same rule, so what plays is what Save would produce.
- Because parts can be reordered or repeated, a playback position is a segment
  index plus a time inside it (`TrackPosition` in `shared/trim.ts`), never an
  original time alone. `cutRange` splits by display time rather than removing an
  original-time interval, which would hit every copy of a repeated part. This is
  interval arithmetic that is silently wrong rather than loudly wrong, so it is
  all pure and unit tested.
- Waveform peaks are computed in main (ffmpeg to raw PCM to a downsampled peaks
  array). A long file is never decoded in the renderer.
- Playback controls: go to start, loop the selection, zoom in to the selection
  and back out, each with a shortcut (Space, Home, L, +, -, Escape deselects).
  Shortcuts are ignored while typing in a text field.

### Preview

- `main/media-protocol.ts` serves the file to the `<video>`/`<audio>` element
  through a `mediaeditor-file://` scheme, answering Range requests with a 206.
  Chromium's own `file://` loader answers them with a plain 200, which the
  player reads as "cannot seek". Only a path the app would open for editing is
  served.
- **Crossing a cut used to stall.** `timeupdate` fires about four times a
  second, so up to 250 ms of a cut part played before the jump, and the jump was
  a seek, which for video means decoding forward from a keyframe. Playback is now
  `track-edit/segment-player.ts`: two elements on the same file, the idle one
  parked (paused, already seeked) where the next jump lands and swapped in at
  the jump, with positions checked every animation frame. A plain seek is only
  the fallback when the parked element is not ready.

### Export

Two modes, chosen explicitly:

- **Fast** copies streams. A copy can only start video on a keyframe, and asked
  to start elsewhere ffmpeg quietly starts at the keyframe before, so each part
  came out up to a keyframe interval long and exports with several parts failed
  their own length check. `main/media/keyframes.ts` reads keyframe times (packet
  flags only, no decoding) and the job moves each start back onto one before
  cutting, so what is written is what was expected. Parts are joined with the
  concat demuxer.
- **Precise** re-encodes, exact to the frame: one `concat` filter pass over one
  `-ss`/`-t` input per part, with a codec chosen per container. One input per
  part rather than `trim` filters on a single input, because with parts out of
  order `trim` would hold every decoded frame of a later part in memory until
  `concat` reached it.

Things learned against the real ffmpeg:

- The concat demuxer does not pass an mp3's ID3 tags through `-map_metadata 0`,
  so every step producing final output writes tags explicitly.
- Cover art is left out of the cut by construction (`0:V`/`0:a` never match an
  attached picture) and re-attached in a second pass with the meta editor's own
  write code. If the picture cannot be read back, the trim still succeeds
  without it rather than failing over artwork.
- A temp segment file must keep its extension last (`foo.segment-0.mp3`, not
  `foo.mp3.segment-0`), or ffmpeg cannot guess a muxer and refuses to write it.

Covered by unit tests (the segment model, argument construction, keyframe
parsing and snapping, request validation) and by integration tests against the
real ffmpeg on generated media: single and multi-part trims with tags and cover
art, precise length, a sparse-keyframe mp4 cut into three out-of-order parts,
save as, and a failed trim leaving the original untouched.
