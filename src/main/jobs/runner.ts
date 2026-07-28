import { spawn, type ChildProcess } from 'node:child_process';
import { AppFailure } from '../errors';

/**
 * The single place processes are spawned.
 *
 * Arguments are always passed as an array — never assembled into a shell string.
 * Every path and URL here comes from the user or from YouTube, and a shell would
 * turn a title containing `&&` into a command injection.
 */

export type OutputStream = 'stdout' | 'stderr';

export interface RunOptions {
  binary: string;
  args: readonly string[];
  cwd?: string;
  /** Cancels the process, killing the whole process tree. */
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Accumulate stdout in memory — for tools we run to read their output. */
  captureStdout?: boolean;
  onLine?: (line: string, stream: OutputStream) => void;
}

export interface RunResult {
  code: number | null;
  /** True when we terminated it (cancel or timeout) rather than it exiting. */
  terminated: boolean;
  stdout: string;
  /** Last lines of stderr, verbatim, for error reporting. */
  stderrTail: readonly string[];
}

const STDERR_TAIL_LINES = 200;
/** Guards against a runaway tool filling main-process memory. */
const MAX_CAPTURED_STDOUT_BYTES = 32 * 1024 * 1024;

export async function runProcess(options: RunOptions): Promise<RunResult> {
  const { binary, args, cwd, signal, timeoutMs, captureStdout = false, onLine } = options;

  if (signal?.aborted) {
    return { code: null, terminated: true, stdout: '', stderrTail: [] };
  }

  const child = spawn(binary, [...args], {
    cwd,
    windowsHide: true,
    // A process group on POSIX is what makes killing yt-dlp's ffmpeg child possible.
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stderrTail: string[] = [];
  const stdoutChunks: string[] = [];
  let capturedBytes = 0;
  let terminated = false;
  let captureOverflow = false;

  const handleLine = (line: string, stream: OutputStream): void => {
    if (stream === 'stderr') {
      stderrTail.push(line);
      if (stderrTail.length > STDERR_TAIL_LINES) stderrTail.shift();
    }
    onLine?.(line, stream);
  };

  const stdoutSplitter = new LineSplitter((line) => handleLine(line, 'stdout'));
  const stderrSplitter = new LineSplitter((line) => handleLine(line, 'stderr'));

  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');

  child.stdout?.on('data', (chunk: string) => {
    if (captureStdout && !captureOverflow) {
      capturedBytes += Buffer.byteLength(chunk, 'utf8');
      if (capturedBytes > MAX_CAPTURED_STDOUT_BYTES) {
        captureOverflow = true;
        stdoutChunks.length = 0;
        terminated = true;
        killProcessTree(child);
      } else {
        stdoutChunks.push(chunk);
      }
    }
    stdoutSplitter.push(chunk);
  });

  child.stderr?.on('data', (chunk: string) => {
    stderrSplitter.push(chunk);
  });

  const terminate = (): void => {
    terminated = true;
    killProcessTree(child);
  };

  const timer = timeoutMs === undefined ? null : setTimeout(terminate, timeoutMs);
  signal?.addEventListener('abort', terminate, { once: true });

  try {
    const code = await waitForExit(child, binary);
    stdoutSplitter.flush();
    stderrSplitter.flush();

    if (captureOverflow) {
      throw new AppFailure(`${binary} produced more output than expected and was stopped.`);
    }

    return { code, terminated, stdout: stdoutChunks.join(''), stderrTail };
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener('abort', terminate);
  }
}

function waitForExit(child: ChildProcess, binary: string): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.once('error', (error: NodeJS.ErrnoException) => {
      reject(
        error.code === 'ENOENT'
          ? new AppFailure(`${binary} could not be started: executable not found.`)
          : new AppFailure(`${binary} could not be started: ${error.message}`),
      );
    });
    // 'close' rather than 'exit': stdio must be drained before we report output.
    child.once('close', (code) => {
      resolve(code);
    });
  });
}

/**
 * Kills the process and everything it spawned. yt-dlp runs ffmpeg as a child, and
 * killing only the parent leaves a transcode running and the temp files locked.
 */
function killProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return;

  if (process.platform === 'win32') {
    // Windows has no process groups usable from Node; taskkill /T walks the tree.
    const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
    killer.on('error', () => child.kill('SIGKILL'));
    return;
  }

  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  // Escalate if the tree ignores SIGTERM; ffmpeg occasionally does while flushing.
  const escalation = setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }, 4000);
  escalation.unref();
  child.once('close', () => clearTimeout(escalation));
}

/**
 * Splits a byte stream into lines. Both `\n` (yt-dlp with --newline) and `\r`
 * (ffmpeg progress, and yt-dlp's own progress bar) count as terminators.
 */
class LineSplitter {
  private buffer = '';

  constructor(private readonly onLine: (line: string) => void) {}

  push(chunk: string): void {
    this.buffer += chunk;
    const parts = this.buffer.split(/\r\n|\r|\n/);
    this.buffer = parts.pop() ?? '';
    for (const part of parts) {
      if (part.length > 0) this.onLine(part);
    }
  }

  flush(): void {
    const rest = this.buffer.trim();
    this.buffer = '';
    if (rest.length > 0) this.onLine(rest);
  }
}
