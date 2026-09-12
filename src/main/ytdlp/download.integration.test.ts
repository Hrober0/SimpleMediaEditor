import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JS_RUNTIME_IDS, type JsRuntime } from '@shared/binaries';
import type { Job } from '@shared/jobs';
import { AppFailure } from '../errors';
import { JobQueue } from '../jobs/queue';
import { runProcess } from '../jobs/runner';
import { createDownloadJob } from './download';
import { inspectUrl } from './inspect';

/**
 * End-to-end against the real tools. The job layer has no Electron dependency, so
 * a download can be driven exactly as the app drives it — which is the only way to
 * know the flags, the progress parsing and the process-tree kill actually work.
 *
 * Run with: npm run test:integration
 */

/** Short, and the oldest video on YouTube — unlikely to disappear or change. */
const SHORT_VIDEO = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
/** Large enough that a download is still in flight a few seconds in. */
const LARGE_VIDEO = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

let destination: string;
let tempRoot: string;

const deps: {
  ytdlpPath: string;
  ffmpegDirectory: null;
  jsRuntime: JsRuntime | null;
  tempRoot: string;
} = { ytdlpPath: 'yt-dlp', ffmpegDirectory: null, jsRuntime: null, tempRoot: '' };

beforeAll(async () => {
  destination = await mkdtemp(join(tmpdir(), 'mediaeditor-test-out-'));
  tempRoot = await mkdtemp(join(tmpdir(), 'mediaeditor-test-tmp-'));
  deps.tempRoot = tempRoot;
  // The real thing needs a real runtime: without one YouTube answers 403, which
  // would look like a broken flag rather than a missing dependency.
  deps.jsRuntime = await findJsRuntime();
  expect(deps.jsRuntime, 'install Deno or Node to run the integration tests').not.toBeNull();
});

/** Mirrors the resolver: first runtime on PATH that reports a version, Deno first. */
async function findJsRuntime(): Promise<JsRuntime | null> {
  for (const name of JS_RUNTIME_IDS) {
    const result = await runProcess({
      binary: process.platform === 'win32' ? `${name}.exe` : name,
      args: ['--version'],
      timeoutMs: 8000,
    }).catch(() => null);
    if (result?.code === 0) return { name, path: null };
  }
  return null;
}

afterAll(async () => {
  await rm(destination, { recursive: true, force: true });
  await rm(tempRoot, { recursive: true, force: true });
});

/** Resolves when the job reaches a terminal state, collecting what it reported. */
function watch(queue: JobQueue, jobId: string): Promise<{ job: Job; details: string[] }> {
  return new Promise((resolve) => {
    const details: string[] = [];
    const unsubscribe = queue.onChanged((jobs) => {
      const job = jobs.find((candidate) => candidate.id === jobId);
      if (!job) return;
      if (details.at(-1) !== job.detail) details.push(job.detail);
      if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') {
        unsubscribe();
        resolve({ job, details });
      }
    });
  });
}

describe('inspectUrl', () => {
  it('reads a real video', async () => {
    const inspection = await inspectUrl(SHORT_VIDEO, {
      ytdlpPath: 'yt-dlp',
      jsRuntime: deps.jsRuntime,
    });

    expect(inspection.kind).toBe('video');
    expect(inspection.entries[0]?.title).toBe('Me at the zoo');
    expect(inspection.entries[0]?.durationSeconds).toBeGreaterThan(0);
    expect(inspection.entries[0]?.thumbnailUrl).toMatch(/^https:/);
  });

  it("surfaces yt-dlp's own message for an unusable URL", async () => {
    // The message ("Video unavailable", "Sign in to confirm your age") is the
    // answer the user needs, so it must reach us rather than being flattened.
    const failure: unknown = await inspectUrl('https://www.youtube.com/watch?v=BaW_jenozKc', {
      ytdlpPath: 'yt-dlp',
      jsRuntime: deps.jsRuntime,
    }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(AppFailure);
    if (!(failure instanceof AppFailure)) return;
    expect(failure.details).toContain('ERROR');
  });
});

describe('download job', () => {
  it('produces a tagged mp3 with JPEG cover art, and cleans up after itself', async () => {
    const queue = new JobQueue(() => 1);
    const job = queue.enqueue(
      createDownloadJob(
        { url: SHORT_VIDEO, title: 'Me at the zoo', filename: 'zoo test' },
        {
          target: 'mp3',
          audioQuality: '5',
          videoQuality: 'best',
          destination,
          filenameTemplate: '%(title)s.%(ext)s',
          restrictFilenames: true,
        },
        deps,
      ),
    );

    const { job: finished } = await watch(queue, job.id);

    expect(finished.status).toBe('done');
    // The explicit name wins over the template, with the extension appended.
    expect(finished.outputPath).toBe(join(destination, 'zoo test.mp3'));
    expect(await readdir(destination)).toContain('zoo test.mp3');

    // Stage labels and progress details are sampled from a deliberately coalesced
    // event stream, and this file is small enough to finish inside one flush
    // window — so they are asserted on the large download in the cancel test
    // instead. The log is complete, so the stages are checked from there. (The
    // line-to-label mapping itself is covered in output-parser.test.ts.)
    expect(finished.log.some((line) => line.startsWith('[ExtractAudio]'))).toBe(true);
    expect(finished.log.some((line) => line.startsWith('[MoveFiles]'))).toBe(true);

    const probe = await probeFile(join(destination, 'zoo test.mp3'));
    expect(probe).toContain('TAG:artist=jawed');
    expect(probe).toContain('TAG:title=Me at the zoo');
    // mjpeg, not png: PNG art is what some players silently ignore.
    expect(probe).toContain('codec_name=mjpeg');

    // The job's temp directory is gone, and nothing partial is left behind.
    expect(await readdir(join(tempRoot, 'mediaeditor')).catch(() => [])).toEqual([]);
  });

  it('reports a non-ASCII name as it is on disk, so the file can be opened again', async () => {
    // yt-dlp writes its output in the console codepage unless told otherwise, and
    // a path that arrives as undecodable bytes leaves the app unable to find the
    // file it just downloaded. This is what the meta editor handoff needs.
    const name = 'Żółć Ąę test';
    const queue = new JobQueue(() => 1);
    const job = queue.enqueue(
      createDownloadJob(
        { url: SHORT_VIDEO, title: name, filename: name },
        {
          target: 'mp3',
          audioQuality: '5',
          videoQuality: 'best',
          destination,
          filenameTemplate: '%(title)s.%(ext)s',
          // --restrict-filenames would flatten the name to ASCII and prove nothing.
          restrictFilenames: false,
        },
        deps,
      ),
    );

    const { job: finished } = await watch(queue, job.id);

    expect(finished.status).toBe('done');
    expect(finished.outputPath).toBe(join(destination, `${name}.mp3`));
    expect(await readdir(destination)).toContain(`${name}.mp3`);
  });

  it('cancels mid-download, killing the tool and leaving nothing behind', async () => {
    const queue = new JobQueue(() => 1);
    const job = queue.enqueue(
      createDownloadJob(
        { url: LARGE_VIDEO, title: 'cancel me', filename: 'cancel me' },
        {
          target: 'mp4',
          audioQuality: '0',
          // Best quality means a large file, so the download is still running when
          // the cancel arrives.
          videoQuality: 'best',
          destination,
          filenameTemplate: '%(title)s.%(ext)s',
          restrictFilenames: true,
        },
        deps,
      ),
    );

    // Cancel as soon as bytes are actually moving. Waiting for a real progress
    // line is also how "progress reaches the job" gets verified: a file this size
    // reports many times over.
    const observed = await new Promise<{ detail: string; fraction: number | null }>((resolve) => {
      const unsubscribe = queue.onChanged((jobs) => {
        const current = jobs.find((candidate) => candidate.id === job.id);
        if (current?.detail.startsWith('Downloading —')) {
          unsubscribe();
          resolve({ detail: current.detail, fraction: current.progress });
          queue.cancel(job.id);
        }
      });
    });

    expect(observed.detail).toMatch(/^Downloading — .*%/);
    expect(observed.fraction).toBeGreaterThan(0);

    const { job: finished } = await watch(queue, job.id);
    expect(finished.status).toBe('cancelled');

    expect(await readdir(destination)).not.toContain('cancel me.mp4');
    expect(await readdir(join(tempRoot, 'mediaeditor')).catch(() => [])).toEqual([]);
    expect(await isToolRunning()).toBe(false);
  });
});

async function probeFile(path: string): Promise<string> {
  const result = await runProcess({
    binary: 'ffprobe',
    args: [
      '-v',
      'error',
      '-show_entries',
      'format_tags=title,artist',
      '-show_entries',
      'stream=codec_name',
      '-of',
      'default=noprint_wrappers=1',
      path,
    ],
    captureStdout: true,
    timeoutMs: 20_000,
  });
  expect(result.code).toBe(0);
  return result.stdout;
}

/** Guards against the classic failure: the parent dies, ffmpeg keeps transcoding. */
async function isToolRunning(): Promise<boolean> {
  const windows = process.platform === 'win32';
  const result = await runProcess({
    binary: windows ? 'tasklist' : 'ps',
    args: windows ? ['/fo', 'csv', '/nh'] : ['-eo', 'comm'],
    captureStdout: true,
    timeoutMs: 20_000,
  });
  return /(^|[\\/"])(yt-dlp|ffmpeg)(\.exe)?\b/im.test(result.stdout);
}
