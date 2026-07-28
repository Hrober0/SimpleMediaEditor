import { describe, expect, it } from 'vitest';
import { AppFailure } from '../errors';
import { runProcess, type OutputStream } from './runner';

/**
 * These spawn real processes — the point is the parts that only exist once a
 * process is running: line splitting across chunk boundaries, exit codes, and
 * killing a tree on abort. Node itself stands in for ffmpeg/yt-dlp so the tests
 * need no external tools and behave the same on Windows and Linux.
 */
const node = process.execPath;

function script(source: string): string[] {
  return ['-e', source];
}

describe('runProcess', () => {
  it('captures stdout when asked and reports the exit code', async () => {
    const result = await runProcess({
      binary: node,
      args: script('process.stdout.write("hello")'),
      captureStdout: true,
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('hello');
    expect(result.terminated).toBe(false);
  });

  it('reports a non-zero exit rather than throwing, so the caller decides', async () => {
    const result = await runProcess({ binary: node, args: script('process.exit(3)') });
    expect(result.code).toBe(3);
  });

  it('splits output into lines on \\n and \\r', async () => {
    const lines: { line: string; stream: OutputStream }[] = [];
    await runProcess({
      // \r is how ffmpeg and yt-dlp's progress bar update in place.
      binary: node,
      args: script('process.stdout.write("a\\nb\\rc\\r\\nd\\n")'),
      onLine: (line, stream) => lines.push({ line, stream }),
    });

    expect(lines.map((entry) => entry.line)).toEqual(['a', 'b', 'c', 'd']);
    expect(lines.every((entry) => entry.stream === 'stdout')).toBe(true);
  });

  it('emits a trailing line that was never terminated', async () => {
    const lines: string[] = [];
    await runProcess({
      binary: node,
      args: script('process.stdout.write("no newline at the end")'),
      onLine: (line) => lines.push(line),
    });

    expect(lines).toEqual(['no newline at the end']);
  });

  it('keeps a bounded tail of stderr for error reporting', async () => {
    const result = await runProcess({
      binary: node,
      args: script('for (let i = 0; i < 400; i++) console.error("err " + i)'),
    });

    expect(result.stderrTail.length).toBeLessThanOrEqual(200);
    expect(result.stderrTail.at(-1)).toBe('err 399');
  });

  it('separates stderr from stdout', async () => {
    const seen: string[] = [];
    await runProcess({
      binary: node,
      args: script('console.log("out"); console.error("bad")'),
      onLine: (line, stream) => seen.push(`${stream}:${line}`),
    });

    expect(seen).toContain('stdout:out');
    expect(seen).toContain('stderr:bad');
  });

  it('terminates the process when the signal aborts', async () => {
    const controller = new AbortController();
    const started = runProcess({
      binary: node,
      // Would otherwise outlive the test run by a long way.
      args: script('setInterval(() => {}, 1000); console.log("up")'),
      signal: controller.signal,
      onLine: (line) => {
        if (line === 'up') controller.abort();
      },
    });

    const result = await started;
    expect(result.terminated).toBe(true);
  });

  it('does not spawn at all if the signal is already aborted', async () => {
    const result = await runProcess({
      binary: node,
      args: script('process.stdout.write("should not run")'),
      captureStdout: true,
      signal: AbortSignal.abort(),
    });

    expect(result.terminated).toBe(true);
    expect(result.stdout).toBe('');
  });

  it('terminates on timeout', async () => {
    const result = await runProcess({
      binary: node,
      args: script('setInterval(() => {}, 1000)'),
      timeoutMs: 300,
    });

    expect(result.terminated).toBe(true);
  });

  it('kills a child of the child, not just the process it started', async () => {
    // yt-dlp runs ffmpeg; killing only the parent leaves a transcode running and
    // the temp files locked.
    const parent = `
      const { spawn } = require('node:child_process');
      const grandchild = 'setInterval(() => {}, 1000); console.log("grandchild " + process.pid)';
      const child = spawn(process.execPath, ['-e', grandchild], { stdio: 'inherit' });
      setInterval(() => {}, 1000);
    `;

    const controller = new AbortController();
    let grandchildPid = 0;
    const result = await runProcess({
      binary: node,
      args: script(parent),
      signal: controller.signal,
      onLine: (line) => {
        const match = /^grandchild (\d+)$/.exec(line);
        if (match?.[1]) {
          grandchildPid = Number(match[1]);
          controller.abort();
        }
      },
    });

    expect(result.terminated).toBe(true);
    expect(grandchildPid).toBeGreaterThan(0);

    // Give the kill a moment to propagate through the tree, then confirm the
    // grandchild is gone. Signal 0 only tests for existence.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(isAlive(grandchildPid)).toBe(false);
  });

  it('fails with a clear message when the binary does not exist', async () => {
    await expect(
      runProcess({ binary: 'definitely-not-a-real-binary-xyz', args: [] }),
    ).rejects.toThrow(AppFailure);
  });
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
