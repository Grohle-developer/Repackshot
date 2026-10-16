// U14: the live view of a queue job (UI.md §2.5, §2.8, SPEC §3.8): the picture of the job in flight as it
// accumulates, scaled to fit the viewer, at a bounded cadence and only while someone looks at it. The engines make
// the picture (render/live-frame.ts, from the pool's accumulation or the launcher's frames); the queue decides when
// one is wanted (`FrameRequest.frameBox`, ui/ports.ts) with the cadence below. Pure: no DOM, no clock of its own.

/** Shortest time between two pictures of the live view, milliseconds (measured cost: ROADMAP U14). */
export const LIVE_FRAME_MS = 500;

/**
 * The largest picture the live view asks for, device pixels. Bigger viewers get it scaled up: the picture of a render
 * in progress is for watching it come, not for judging its pixels (the results viewer does that at the end).
 */
export const LIVE_MAX_BOX: FrameBox = { width: 960, height: 600 };

/** A box a picture is fitted in, pixels. */
export interface FrameBox {
  width: number;
  height: number;
}

/** A picture of a render in progress. */
export interface LiveFrame {
  /** The picture: 8-bit straight RGBA, `width × height`, the render scaled down by a whole factor. */
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  /** The render's own size. */
  renderWidth: number;
  renderHeight: number;
  /** Samples every pixel of the picture has, and the seconds rendered so far: the engine's numbers. */
  samples: number;
  seconds: number;
}

/**
 * When the next picture is due: `ms` after the last one was taken (the first at once). The clock is handed in, so a
 * test runs it with a fake one.
 */
export class FrameCadence {
  private last = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly now: () => number,
    readonly ms = LIVE_FRAME_MS,
  ) {}

  /** A picture may be made now. */
  due(): boolean {
    return this.now() - this.last >= this.ms;
  }

  /** A picture was taken now: the next one is due `ms` later. */
  mark(): void {
    this.last = this.now();
  }

  /** The next picture is due at once (the view opened again, or on another job). */
  reset(): void {
    this.last = Number.NEGATIVE_INFINITY;
  }
}

/** The box a live view asks for: what it measured (device pixels), within LIVE_MAX_BOX, at least 1 × 1. */
export function liveBox(measured: FrameBox | null): FrameBox {
  const m = measured ?? LIVE_MAX_BOX;
  const w = Number.isFinite(m.width) ? Math.floor(m.width) : LIVE_MAX_BOX.width;
  const h = Number.isFinite(m.height) ? Math.floor(m.height) : LIVE_MAX_BOX.height;
  return { width: Math.max(1, Math.min(LIVE_MAX_BOX.width, w)), height: Math.max(1, Math.min(LIVE_MAX_BOX.height, h)) };
}

/**
 * The smallest whole factor `k` that fits `width × height` in `box`: the picture is `ceil(width / k) × ceil(height /
 * k)` (1: the render as it is). The launcher's `fit=` uses the same rule (rt-app render.rs `fit_factor`).
 */
export function fitFactor(width: number, height: number, box: FrameBox): number {
  const bw = Math.max(1, Math.floor(box.width));
  const bh = Math.max(1, Math.floor(box.height));
  return Math.max(1, Math.ceil(width / bw), Math.ceil(height / bh));
}
