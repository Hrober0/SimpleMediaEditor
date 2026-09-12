import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useComputedColorScheme, useMantineTheme } from '@mantine/core';
import { displayToOriginalSeconds, totalKeptSeconds, type KeepRange } from '@shared/trim';

export interface WaveformSelection {
  startSeconds: number;
  endSeconds: number;
}

/** Which part of the track's own (display) timeline is currently visible. */
export interface WaveformViewRange {
  startSeconds: number;
  endSeconds: number;
}

interface WaveformProps {
  /** Peaks over the whole original file — the track shown here may only use part of it. */
  peaks: readonly number[];
  sourceDurationSeconds: number;
  /** The track as it stands now: cut parts are simply not drawn, no gap shown. */
  segments: readonly KeepRange[];
  /** In display time — the edited track's own timeline, not the original file's. */
  currentTimeSeconds: number;
  /** Null shows the whole track. */
  viewRange: WaveformViewRange | null;
  /** At most one at a time; a drag replaces whatever was selected before. */
  selection: WaveformSelection | null;
  onSelectionChange: (selection: WaveformSelection | null) => void;
  onSeek: (displaySeconds: number) => void;
}

const HEIGHT = 140;
/** Below this many pixels of drag, it is a click (seek), not a selection. */
const DRAG_THRESHOLD_PX = 4;

/**
 * The waveform of the track as it currently stands, with a click to seek and
 * a drag to select one part of it. Selection and zoom are both controlled —
 * this component only ever reports what the user did with the pointer.
 *
 * Peaks arrive precomputed from main for the whole original file; this only
 * ever draws the slice of it the current segments (and the current zoomed
 * view, if any) still include.
 */
export function Waveform({
  peaks,
  sourceDurationSeconds,
  segments,
  currentTimeSeconds,
  viewRange,
  selection,
  onSelectionChange,
  onSeek,
}: WaveformProps): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);

  const theme = useMantineTheme();
  const colorScheme = useComputedColorScheme('dark');
  const trackDuration = totalKeptSeconds(segments);
  const viewStart = viewRange?.startSeconds ?? 0;
  const viewEnd = viewRange?.endSeconds ?? trackDuration;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = width * ratio;
    canvas.height = HEIGHT * ratio;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.scale(ratio, ratio);

    const primary = theme.colors[theme.primaryColor] ?? theme.colors.blue;
    const waveColor = theme.colors.gray[5] ?? '#868e96';
    const selectionFill = primary?.[colorScheme === 'dark' ? 8 : 2] ?? '#a5b4fc';
    const playhead = theme.colors.red[colorScheme === 'dark' ? 4 : 6] ?? '#e03131';

    context.clearRect(0, 0, width, HEIGHT);

    if (selection && selection.endSeconds > viewStart && selection.startSeconds < viewEnd) {
      const x = secondsToX(Math.max(selection.startSeconds, viewStart), viewStart, viewEnd, width);
      const endX = secondsToX(Math.min(selection.endSeconds, viewEnd), viewStart, viewEnd, width);
      context.fillStyle = selectionFill;
      context.fillRect(x, 0, endX - x, HEIGHT);
    }

    drawPeaks(
      context,
      peaks,
      width,
      waveColor,
      segments,
      sourceDurationSeconds,
      viewStart,
      viewEnd,
    );

    if (currentTimeSeconds >= viewStart && currentTimeSeconds <= viewEnd) {
      const playheadX = secondsToX(currentTimeSeconds, viewStart, viewEnd, width);
      context.fillStyle = playhead;
      context.fillRect(playheadX - 1, 0, 2, HEIGHT);
    }
  }, [
    peaks,
    width,
    segments,
    sourceDurationSeconds,
    viewStart,
    viewEnd,
    selection,
    currentTimeSeconds,
    theme,
    colorScheme,
  ]);

  const pointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current;
    if (!canvas || viewEnd <= viewStart) return;
    const startX = event.clientX - canvas.getBoundingClientRect().left;
    const startSeconds = xToSeconds(startX, viewStart, viewEnd, width);
    let dragged = false;
    let pending: WaveformSelection = { startSeconds, endSeconds: startSeconds };

    const handleMove = (moveEvent: PointerEvent): void => {
      const x = moveEvent.clientX - canvas.getBoundingClientRect().left;
      if (Math.abs(x - startX) > DRAG_THRESHOLD_PX) dragged = true;
      const seconds = xToSeconds(x, viewStart, viewEnd, width);
      pending = {
        startSeconds: Math.min(startSeconds, seconds),
        endSeconds: Math.max(startSeconds, seconds),
      };
      onSelectionChange(pending);
    };

    const handleUp = (): void => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      if (dragged) {
        onSelectionChange(pending);
      } else {
        onSelectionChange(null);
        onSeek(startSeconds);
      }
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: HEIGHT, display: 'block', cursor: 'crosshair' }}
        onPointerDown={pointerDown}
      />
    </div>
  );
}

function secondsToX(seconds: number, viewStart: number, viewEnd: number, width: number): number {
  const span = viewEnd - viewStart;
  if (span <= 0) return 0;
  return ((seconds - viewStart) / span) * width;
}

function xToSeconds(x: number, viewStart: number, viewEnd: number, width: number): number {
  if (width <= 0) return viewStart;
  const span = viewEnd - viewStart;
  return Math.min(viewEnd, Math.max(viewStart, viewStart + (x / width) * span));
}

function drawPeaks(
  context: CanvasRenderingContext2D,
  peaks: readonly number[],
  width: number,
  color: string,
  segments: readonly KeepRange[],
  sourceDurationSeconds: number,
  viewStart: number,
  viewEnd: number,
): void {
  const bucketCount = peaks.length / 2;
  if (bucketCount === 0 || width === 0 || sourceDurationSeconds <= 0 || viewEnd <= viewStart)
    return;
  const mid = HEIGHT / 2;
  context.fillStyle = color;

  for (let x = 0; x < width; x += 1) {
    const displaySeconds = xToSeconds(x, viewStart, viewEnd, width);
    const originalSeconds = displayToOriginalSeconds(segments, displaySeconds);
    const bucket = Math.min(
      bucketCount - 1,
      Math.floor((originalSeconds / sourceDurationSeconds) * bucketCount),
    );
    const min = peaks[bucket * 2] ?? 0;
    const max = peaks[bucket * 2 + 1] ?? 0;

    const top = mid - max * mid;
    const bottom = mid - min * mid;
    context.fillRect(x, top, 1, Math.max(1, bottom - top));
  }
}
