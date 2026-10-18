// The AI preview's brain (AI-POST.md §4, phase X4), without a DOM: when to compute, what to keep.
//
//   - A preview costs seconds, so it updates when a control is *released*, never while it is dragged:
//     `hold()` when a drag begins, `touch()` for every change, `release()` when it ends. A change outside a
//     drag (a key, a choice in a list, "Another variation") settles after a short pause.
//   - The frame (the Fast-mode picture and its passes) only depends on the scene, the camera and the size, so it
//     is drawn once and kept while the controls change; the pipeline runs on that frame each time.
//   - A change while a preview is being made abandons it (the service gets the abort) and starts the new one.
//   - The time of a change is measured around the pipeline call, never estimated; the interface shows the last
//     measure ("≈ 9 s per change on this computer").
//
// Everything the controller needs from outside is in `AiPreviewDeps`, so the tests drive it with fakes and a
// clock they move by hand.

import type { AiGuardMaterial, AiPipelineSettings, AiPostProgress, AiPostService, GuardReport, LinearImage } from '../core/ai';
import type { RenderPasses } from '../core/passes';
import type { ProjectState } from '../core/store';
import type { UiState } from './ui-state';

/** What the preview is made from, read when it is about to be computed. */
export interface AiPreviewInput {
  /** Anything that, when it changes, makes the frame stale (the scene, the camera, the size, the engine). */
  frameKey: readonly unknown[];
  /** Draws the frame; called only when the key changed. */
  frame(signal: AbortSignal): Promise<{ image: LinearImage; passes: RenderPasses }>;
  settings: AiPipelineSettings;
  prompt: string;
  negative: string;
  modelKey: string;
  /** The guard's material table (X3c). */
  materials?: AiGuardMaterial[];
}

export interface AiPreviewDeps {
  service: Pick<AiPostService, 'post'>;
  /** The preview as it stands now, or null when there is nothing to show (the switch is off, the section is folded). */
  read(): AiPreviewInput | null;
  /** A clock in milliseconds. */
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  /** Pause after a change outside a drag before computing (default 150 ms). */
  settleMs?: number;
}

export type AiPreviewPhase = 'IDLE' | 'FRAME' | 'WORKING' | 'READY' | 'ERROR';

export interface AiPreviewState {
  phase: AiPreviewPhase;
  /** The Fast-mode picture the AI started from (kept while the next one is made). */
  before: LinearImage | null;
  after: LinearImage | null;
  report: GuardReport | null;
  /** Seconds the last pipeline call took (measured); null until one has run. */
  seconds: number | null;
  /** 0..1 of the request in progress, as the service reports it. */
  progress: number;
  error: string | null;
  /** X6: why the guard sent attempts of the last preview back, in its words (the progress' `reason`), in order. */
  sentBack: string[];
}

const IDLE: AiPreviewState = { phase: 'IDLE', before: null, after: null, report: null, seconds: null, progress: 0, error: null, sentBack: [] };

/**
 * What outside the picture makes the preview stale: the window's AI settings and mode (the draft while it is edited),
 * the models on this computer (`installed`, and `ready` when the store answers), the active model and the system
 * prompt of Settings. Never the model manager's snapshot itself: it is a new object at every tick of a download
 * (every 200 ms), and each one would abandon the preview in flight and start it again, so it never finished.
 */
export function previewTriggers(s: ProjectState, u: UiState): unknown[] {
  const edit = u.renderWindow?.kind === 'EDIT' ? u.renderWindow : null;
  return [edit ? edit.draft.ai : s.render.ai, edit ? edit.draft.mode : s.render.mode, u.models?.installed.join(','), u.models?.ready, u.settings['ai.active'], u.settings['ai.systemPrompt']];
}

/** Whether two `previewTriggers` are the same (each value by identity). */
export const sameTriggers = (a: readonly unknown[], b: readonly unknown[]): boolean => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

const sameKey = (a: readonly unknown[], b: readonly unknown[]): boolean => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const isAbort = (e: unknown): boolean => e instanceof Error && e.name === 'AbortError';

export class AiPreviewController {
  private s: AiPreviewState;
  private readonly listeners = new Set<(s: AiPreviewState) => void>();
  private held = 0;
  private dirty = false;
  private timer: unknown = null;
  private current: AbortController | null = null;
  private generation = 0;
  private cache: { key: readonly unknown[]; image: LinearImage; passes: RenderPasses } | null = null;
  private disposed = false;

  constructor(
    private readonly deps: AiPreviewDeps,
    initialSeconds: number | null = null,
  ) {
    this.s = { ...IDLE, seconds: initialSeconds };
  }

  get state(): AiPreviewState {
    return this.s;
  }

  subscribe(fn: (s: AiPreviewState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<AiPreviewState>): void {
    this.s = { ...this.s, ...patch };
    for (const fn of [...this.listeners]) fn(this.s);
  }

  /** A drag of a control began: nothing is computed until `release()`. */
  hold(): void {
    this.held++;
    this.clear();
  }

  /** A control changed (possibly in the middle of a drag). */
  touch(): void {
    this.dirty = true;
    if (this.held > 0) return;
    this.schedule(this.deps.settleMs ?? 150);
  }

  /** The drag ended: the preview updates now, if anything changed. */
  release(): void {
    this.held = Math.max(0, this.held - 1);
    if (this.held === 0 && this.dirty) this.schedule(0);
  }

  /** The scene, the camera or the size changed (or the section opened): compute with a fresh frame check. */
  refresh(): void {
    this.dirty = true;
    if (this.held === 0) this.schedule(0);
  }

  /** Stop: abandon what is in progress and forget the pending change. */
  cancel(): void {
    this.clear();
    this.dirty = false;
    this.abort();
    this.set({ phase: this.s.after ? 'READY' : 'IDLE', progress: 0 });
  }

  dispose(): void {
    this.disposed = true;
    this.clear();
    this.abort();
    this.listeners.clear();
  }

  private clear(): void {
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
  }

  private abort(): void {
    this.current?.abort();
    this.current = null;
    this.generation++;
  }

  private schedule(ms: number): void {
    this.clear();
    if (ms <= 0) {
      void this.run();
      return;
    }
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      void this.run();
    }, ms);
  }

  private async run(): Promise<void> {
    if (this.disposed) return;
    this.dirty = false;
    this.abort();
    const input = this.deps.read();
    if (!input) {
      this.set({ phase: this.s.after ? 'READY' : 'IDLE', progress: 0 });
      return;
    }
    const ctl = new AbortController();
    this.current = ctl;
    const gen = this.generation;
    const live = () => !this.disposed && gen === this.generation && !ctl.signal.aborted;
    try {
      if (!this.cache || !sameKey(this.cache.key, input.frameKey)) {
        this.set({ phase: 'FRAME', progress: 0, error: null });
        const frame = await input.frame(ctl.signal);
        if (!live()) return;
        this.cache = { key: input.frameKey, image: frame.image, passes: frame.passes };
        this.set({ before: frame.image, after: null, report: null });
      }
      const { image, passes } = this.cache;
      this.set({ phase: 'WORKING', before: image, progress: 0, error: null, sentBack: [] });
      const t0 = this.deps.now();
      const sentBack: string[] = [];
      const result = await this.deps.service.post(
        { source: { kind: 'INLINE', image, passes }, settings: input.settings, prompt: input.prompt, negative: input.negative, modelKey: input.modelKey, ...(input.materials ? { materials: input.materials } : {}) },
        (p: AiPostProgress) => {
          if (!live()) return;
          if (p.reason && !sentBack.includes(p.reason)) sentBack.push(p.reason);
          this.set({ progress: p.fraction });
        },
        ctl.signal,
      );
      if (!live()) return;
      this.set({ phase: 'READY', before: image, after: result.image, report: result.report, seconds: Math.max(0, (this.deps.now() - t0) / 1000), progress: 1, error: null, sentBack });
    } catch (e) {
      if (!live() || isAbort(e)) return;
      this.set({ phase: 'ERROR', error: e instanceof Error ? e.message : String(e), progress: 0 });
    } finally {
      if (this.current === ctl) this.current = null;
    }
  }
}
