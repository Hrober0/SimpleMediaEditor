import {
  locateDisplaySeconds,
  nextJump,
  positionToDisplaySeconds,
  totalKeptSeconds,
  type KeepRange,
  type TrackPosition,
} from '@shared/trim';

export interface SegmentPlayerEvents {
  timeChanged: (displaySeconds: number) => void;
  playingChanged: (playing: boolean) => void;
  activeElementChanged: (index: ElementIndex) => void;
}

export type ElementIndex = 0 | 1;

/**
 * A rendering frame is about 17ms, so leaving this early means the jump lands
 * within a frame of the cut point instead of a frame past it.
 */
const JUMP_AHEAD_SECONDS = 1 / 60;
/** How close a waiting element has to be to where the jump lands to take over. */
const READY_TOLERANCE_SECONDS = 0.05;
/** The playhead does not need redrawing at every frame to look smooth. */
const TIME_EVENT_INTERVAL_MS = 50;
/** Pressing play this close to the end starts the track over. */
const END_EPSILON_SECONDS = 0.05;

/**
 * Plays the edited track through two elements that both hold the original file.
 *
 * Seeking a video takes a while: the decoder has to go back to a keyframe and
 * decode forward from it. Doing that at every cut point is the stall heard and
 * seen when playback crosses one. So while one element plays, the other waits,
 * paused, already seeked to where the next jump lands. At the jump the waiting
 * one starts and the playing one stops, with no seek on the way. The plain seek
 * is only the fallback, for a jump that comes before the waiting element is
 * ready.
 *
 * Positions are watched once per rendering frame rather than on `timeupdate`,
 * which fires only about four times a second and so plays up to a quarter of a
 * second of a cut part before noticing.
 */
export class SegmentPlayer {
  private readonly elements: [HTMLMediaElement | null, HTMLMediaElement | null] = [null, null];
  private active: ElementIndex = 0;
  private segments: readonly KeepRange[] = [];
  private loop: KeepRange | null = null;
  private position: TrackPosition | null = null;
  private displaySeconds = 0;
  private playing = false;
  private frame: number | null = null;
  private lastTimeEventAt = 0;

  constructor(private readonly events: SegmentPlayerEvents) {}

  setElement(index: ElementIndex, element: HTMLMediaElement | null): void {
    this.elements[index] = element;
  }

  setSegments(segments: readonly KeepRange[]): void {
    this.segments = segments;
    this.seek(this.displaySeconds);
  }

  setLoop(loop: KeepRange | null): void {
    this.loop = loop;
    this.prepareWaitingElement();
  }

  seek(displaySeconds: number): void {
    const total = totalKeptSeconds(this.segments);
    this.displaySeconds = Math.min(Math.max(0, displaySeconds), total);
    this.position = locateDisplaySeconds(this.segments, this.displaySeconds);
    this.events.timeChanged(this.displaySeconds);

    const element = this.activeElement();
    // Setting currentTime before metadata has loaded is not lost: the element
    // keeps it as the pending start position and applies it once it can.
    if (element && this.position) element.currentTime = this.position.originalSeconds;
    this.prepareWaitingElement();
  }

  togglePlay(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  /** Stops and forgets where the playhead was, for when another file is opened. */
  reset(): void {
    this.pause();
    this.displaySeconds = 0;
    this.position = null;
    this.events.timeChanged(0);
  }

  private play(): void {
    if (!this.position) return;
    if (this.displaySeconds >= totalKeptSeconds(this.segments) - END_EPSILON_SECONDS) this.seek(0);

    const element = this.activeElement();
    if (!element) return;
    element.play().catch(() => this.pause());
    this.setPlaying(true);
    this.scheduleFrame();
  }

  private pause(): void {
    for (const element of this.elements) element?.pause();
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.setPlaying(false);
  }

  private setPlaying(playing: boolean): void {
    if (this.playing === playing) return;
    this.playing = playing;
    this.events.playingChanged(playing);
  }

  private scheduleFrame(): void {
    this.frame = requestAnimationFrame(() => {
      this.followPlayback();
      if (this.playing) this.scheduleFrame();
    });
  }

  private followPlayback(): void {
    const element = this.activeElement();
    const position = this.position;
    if (!element || !position || element.seeking) return;

    this.position = { segmentIndex: position.segmentIndex, originalSeconds: element.currentTime };
    const jump = nextJump(this.segments, this.position, this.loop);
    if (!jump) return;

    const reachedJump = element.currentTime >= jump.atOriginalSeconds - JUMP_AHEAD_SECONDS;
    if (reachedJump || element.ended) {
      if (!jump.to) {
        this.pause();
        this.position = {
          segmentIndex: position.segmentIndex,
          originalSeconds: jump.atOriginalSeconds,
        };
        this.publishTime(true);
        return;
      }
      this.jumpTo(jump.to);
    }
    this.publishTime(false);
  }

  private jumpTo(target: TrackPosition): void {
    const current = this.activeElement();
    const waiting = this.waitingElement();
    this.position = target;

    if (current && waiting && isReadyAt(waiting, target.originalSeconds)) {
      waiting.play().catch(() => this.pause());
      current.pause();
      this.active = this.active === 0 ? 1 : 0;
      this.events.activeElementChanged(this.active);
    } else if (current) {
      current.currentTime = target.originalSeconds;
    }
    this.prepareWaitingElement();
  }

  /** Parks the element not playing at wherever the next jump will land. */
  private prepareWaitingElement(): void {
    const waiting = this.waitingElement();
    if (!waiting || !this.position) return;
    const target = nextJump(this.segments, this.position, this.loop)?.to;
    if (!target) return;
    if (!waiting.paused) waiting.pause();
    if (Math.abs(waiting.currentTime - target.originalSeconds) > READY_TOLERANCE_SECONDS / 2) {
      waiting.currentTime = target.originalSeconds;
    }
  }

  private publishTime(force: boolean): void {
    if (!this.position) return;
    this.displaySeconds = positionToDisplaySeconds(this.segments, this.position);
    const now = performance.now();
    if (!force && now - this.lastTimeEventAt < TIME_EVENT_INTERVAL_MS) return;
    this.lastTimeEventAt = now;
    this.events.timeChanged(this.displaySeconds);
  }

  private activeElement(): HTMLMediaElement | null {
    return this.elements[this.active];
  }

  private waitingElement(): HTMLMediaElement | null {
    return this.elements[this.active === 0 ? 1 : 0];
  }
}

function isReadyAt(element: HTMLMediaElement, originalSeconds: number): boolean {
  return (
    !element.seeking &&
    element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
    Math.abs(element.currentTime - originalSeconds) < READY_TOLERANCE_SECONDS
  );
}
