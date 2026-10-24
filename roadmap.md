# Roadmap

What is planned next, in the order it will be worked on: top to bottom. What is
already built, and why it was built the way it was, is in [done.md](done.md).

When an item is finished, move it to `done.md` with the date it landed.

---

## Track Edit: what is still open

Track Edit (cut, paste, delete, trim, fast and precise export) works. Left over:

- Keyboard scrubbing: frame-by-frame stepping with the arrow keys. The current
  shortcuts cover play, seek, loop, zoom, cut, paste and delete, not fine
  stepping.
- A keyframe indicator for fast mode. The export now moves each part's start
  back onto a keyframe, but the waveform does not show where that is, so the
  user cannot see how far early a part will begin.
- A preview proxy for files Chromium cannot play (HEVC, 10-bit H.264). On load,
  check the codec; if it is not web-playable, generate a fast low-resolution
  proxy for the preview and apply the edit to the original file. Today such a
  file simply does not play.
- Linux: everything here is unverified there, the two stacked `<video>`
  elements of the gap-free preview in particular.

---

## Media library

A view over a whole folder of music and video, grouped by its tags, where moving
a file to another group rewrites that tag. It is the quickest way to tidy a
collection: drag a track onto the right album instead of opening it in the meta
editor and retyping the album name.

### What the user sees

- Pick a folder (the shared `DirectoryInput`). It is read recursively.
- Group by **Genre**, **Artist** or **Album**, switched with a `SegmentedControl`.
  Each group shows its name, how many files it holds, and the files themselves
  (title, artist, duration). Files with the tag missing go in an **Unknown**
  group rather than being hidden.
- A search box that filters by title, artist or album.
- **Drag a file onto another group** and that file's tag becomes the group's
  name. Select several files first to move them together. Dragging onto a
  **New group** target asks for a name.
- **Renaming a group** retags every file in it: a typo in an album name is one
  edit, not twenty.
- Moving more than a handful of files asks for confirmation first, naming how
  many files will be rewritten.
- Clicking a file opens it in the meta editor, through `NavigationProvider` the
  same way a finished download does.

### Formats

mp3 and mp4 first, plus m4a, which needs nothing extra. Which formats are
included is a filter over the `SupportedFormat` table (formats whose tags can be
written), not a list in this module, so adding flac or opus later is a data
change.

### How it works

- **Reading is a job.** A folder of a few thousand files is a few thousand
  ffprobe runs, which takes long enough to need progress and cancel. Scanning
  goes through the shared queue, reports files read out of files found, and
  runs several probes at once. Only the fields the view needs are kept: title,
  artist, album, genre, duration. The finished job's result has to reach the
  renderer somehow: jobs only carry an `outputPath` today, so this needs a
  typed channel that hands over a finished scan's entries by job id, or a
  result field on the job. Decide which before building.
- **Writing reuses the meta editor's tag write.** Each moved file is one tag
  job: same `buildWriteArgs`, same temp-then-replace through `safe-write.ts`,
  same verification. Only the one field being changed is different; every
  other tag and the cover art are written back as they were. Moving a group of
  fifty files is fifty jobs in the Jobs list, each cancellable.
- **After a write, only the touched files are read again**, not the folder.
- **Drag and drop is inside the page**, so it uses plain HTML5 drag events on
  the rows and groups. This is not `FileDropzone`, which is for files dragged
  in from the system. No new dependency is needed for it.
- The grouping itself (entries in, groups out, Unknown handling, sort order) is
  a pure function in `src/shared/`, so it is unit tested rather than checked by
  clicking.

### Things to get right

- **mp4 writes are slow.** A tag change on an mp4 is a stream copy of the whole
  file, so moving a large video takes as long as copying it. The confirmation
  should say so when videos are involved.
- **One tag, several values.** ID3 allows a genre like `Rock; Pop`. The first
  version treats the whole string as one group name; splitting is a later
  choice, and must not silently rewrite the value when the file is moved.
- **Artist on video** is labelled Author elsewhere in the app. The Artist
  grouping reads the same field, and the label should follow the same rule the
  meta editor uses.
- **Case and spacing.** `Rock` and `rock ` should probably be one group. Decide
  whether to merge them for display only or offer to fix the tags.
- **Files that fail to read** (corrupt, locked) are listed in a collapsed
  "Could not read" section with ffprobe's own message, not dropped silently.

**Done when:** pointed at a folder of mixed mp3 and mp4 files, the library shows
them grouped by genre, artist or album; dragging a track onto another album
moves it there after the rewrite; and that file's other tags and cover art are
unchanged.

---

## Batch audio normalization

- Multi-file selection, one job per file through the shared queue.
- **Two-pass** `loudnorm`: measure, then apply. Single pass is inaccurate; this
  is not an optimization to skip.
- Target EBU R128, default -14 LUFS (streaming-typical), configurable to -16 or
  -23.
- Per-file before and after LUFS reported, so the result is verifiable.
- Write to an output folder or in place, using the same temp-then-replace path
  every other write uses.

---

## Format support and conversion

One table already drives the app (`SupportedFormat` in
`src/shared/media-types.ts`). What is left:

- Opening a file that cannot be edited directly offers conversion to mp3 or mp4
  first.
- Adding wav, flac, mkv or webm everywhere becomes a data change plus whatever
  ffmpeg flags that format needs, not new UI.

---

## Packaging

- A bundled fallback for ffmpeg and ffprobe, the last step of the binary
  resolution order (user setting, then `PATH`, then bundled). yt-dlp stays
  user-updatable rather than bundled: YouTube changes break pinned versions too
  often.
- An **Update yt-dlp** button in Settings that runs `yt-dlp -U`.
- An application icon in `build/`.
- Linux: the AppImage and `.deb` are built but have never been run.

---

## Risks to keep in mind

| Risk                                         | Handling                                                 |
| -------------------------------------------- | -------------------------------------------------------- |
| Trim lands on the wrong frame with `-c copy` | Two explicit export modes; show the real cut point       |
| In-place save destroys a file                | Temp file, verify, then replace, always                  |
| yt-dlp breaks when YouTube changes           | Keep it external, expose `-U`, surface its stderr        |
| Video will not preview (HEVC, 10-bit)        | Probe the codec, generate a proxy for the preview        |
| Filenames valid on Linux, illegal on Windows | Sanitize centrally; default the restrict-chars toggle on |
| Long files exhaust renderer memory           | Peaks computed in main, never a full decode in renderer  |
| Electron bundle is about 150 MB              | Accepted; the app already depends on ffmpeg              |

## Not in scope

Multi-track editing, effects and filters beyond normalization, transitions,
subtitles, and any cloud or account features.
