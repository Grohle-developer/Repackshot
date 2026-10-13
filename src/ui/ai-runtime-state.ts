// The inference runtime as the interface keeps watching it (phase U10, AI-POST.md §7.1): one poller of the launcher's
// `GET /api/ai/runtime` shared by everything that talks about the runtime (the render window's AI section, Settings ▸
// AI post-processing, the chooser of a portable's first start), the words' trigger (`runtimeWarning` of
// core/ai-runtimes.ts), the buttons a warning offers, and the once-per-session check at start whose result is a
// quiet note in the status bar. The pure rules are in core/ai-runtimes.ts; the Settings row (settings-ai.ts) keeps
// its own, richer view of the same report.

import { needsAction, runtimeWarning, type AiRuntimePort, type AiRuntimeQuery, type AiRuntimeReport, type RuntimeWarning } from '../core/ai-runtimes';
import { aiRuntimeQuery } from './ai-query';
import type { Ctx } from './reactive';
import type { UiState } from './ui-state';

/** Microsoft's page with the official downloads of the Visual C++ runtime (the launcher sends the same). */
export const VC_RUNTIME_URL = 'https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist';

/** What the Runtime row offers for a build in a state. */
export type RuntimeAction = 'download' | 'fromFile' | 'pause' | 'resume' | 'remove' | 'vcRuntime' | 'probe';

/**
 * The Runtime row's buttons, in order: download it (or install the archive the person downloaded), pause, resume,
 * remove; and for an installed Windows build that does not start for want of Microsoft's Visual C++ runtime (X3c),
 * *Install Microsoft Visual C++ runtime…* (Microsoft's own page: we do not redistribute it) and *Check again*.
 */
export function runtimeActions(rt: { state: string; vcRuntime?: 'missing' | null }): RuntimeAction[] {
  switch (rt.state) {
    case 'missing':
      return ['download', 'fromFile'];
    case 'downloading':
      return ['pause'];
    case 'paused':
      return ['resume', 'remove'];
    case 'installed':
      return rt.vcRuntime === 'missing' ? ['vcRuntime', 'probe', 'remove'] : ['remove'];
    default:
      return [];
  }
}

/** Opens Microsoft's download page of the Visual C++ runtime in the system's browser (the launcher's link, else ours). */
export function openVcRuntime(ctx: Ctx, rt: { vcRuntimeUrl?: string | null }): Promise<void> {
  return ctx.services.openExternal(rt.vcRuntimeUrl ?? VC_RUNTIME_URL);
}

/** Whether a model is on this computer to use the runtime with (the manager has read the store and found one). */
export function hasModel(u: Pick<UiState, 'models'>): boolean {
  return (u.models?.installed.length ?? 0) > 0;
}

// ------------------------------------------------------------------ the poller

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const REAL_TIMERS: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

/** Seconds between two questions while something moves (a download), and while nothing does. */
export const POLL_BUSY_MS = 400;
export const POLL_IDLE_MS = 3000;

/**
 * The launcher's report of the runtime, asked again every few seconds for as long as anything listens (quick while a
 * build downloads, unpacks or is checked), and not at all when nothing does. `refresh()` asks once.
 */
export class RuntimeWatch {
  report: AiRuntimeReport | null = null;
  /** Why the last question failed; null when it was answered. */
  failure: string | null = null;
  /** What the launcher refused of the last button (Install, Pause, Check again); null once another one works. */
  actionError: string | null = null;
  private readonly listeners = new Set<() => void>();
  private timer: unknown = null;

  constructor(
    private readonly port: AiRuntimePort,
    private readonly query: () => AiRuntimeQuery,
    private readonly timers: Timers = REAL_TIMERS,
  ) {}

  /** Calls `fn` at every answer (and at once with what is known). The first listener starts the polling, the last stops it. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    if (this.listeners.size === 1) void this.refresh();
    else fn();
    return () => {
      this.listeners.delete(fn);
      if (this.listeners.size === 0 && this.timer !== null) {
        this.timers.clear(this.timer);
        this.timer = null;
      }
    };
  }

  get listening(): number {
    return this.listeners.size;
  }

  async refresh(): Promise<void> {
    if (this.timer !== null) {
      this.timers.clear(this.timer);
      this.timer = null;
    }
    try {
      this.report = await this.port.status(this.query());
      this.failure = null;
    } catch (e) {
      this.failure = e instanceof Error ? e.message : String(e);
    }
    for (const fn of [...this.listeners]) fn();
    if (this.listeners.size === 0) return;
    const busy = this.report?.runtime ? ['downloading', 'verifying', 'installing'].includes(this.report.runtime.state) : false;
    this.timer = this.timers.set(() => void this.refresh(), busy ? POLL_BUSY_MS : POLL_IDLE_MS);
  }

  /** A button of the notice: what it asked of the launcher, and then the report again. A refusal is kept for the notice to say. */
  private async act(run: () => Promise<unknown>): Promise<void> {
    this.actionError = null;
    try {
      await run();
    } catch (e) {
      this.actionError = e instanceof Error ? e.message : String(e);
    }
    await this.refresh();
  }

  /** Starts downloading a build (or resumes it), then asks again. */
  install(key: string): Promise<void> {
    return this.act(() => this.port.download(key));
  }

  pause(key: string): Promise<void> {
    return this.act(() => this.port.pause(key));
  }

  /** Asks an installed build for its version and devices again (after Microsoft's runtime was installed). */
  probe(key: string): Promise<void> {
    return this.act(() => this.port.probe(key));
  }
}

const watches = new WeakMap<object, RuntimeWatch>();

/** The one watch of this application, or null where there is no runtime to watch (the web, a launcher without the AI API). */
export function runtimeWatch(ctx: Ctx): RuntimeWatch | null {
  const port = ctx.services.aiRuntime;
  if (!port) return null;
  let w = watches.get(ctx.ui);
  if (!w) {
    w = new RuntimeWatch(port, () => aiRuntimeQuery(ctx.ui.get()));
    watches.set(ctx.ui, w);
  }
  return w;
}

/** What to say about the report now. */
export function currentWarning(ctx: Ctx, report: AiRuntimeReport | null): RuntimeWarning | null {
  return runtimeWarning(report, hasModel(ctx.ui.get()));
}

// ------------------------------------------------------------------ the note at start

/**
 * Once per session, when the application has started: if a model is installed and the inference runtime is not (or it
 * does not start), a quiet note in the status bar says so (UI.md §2.6). Nothing opens by itself. A session that has
 * already had its turn, a page with no runtime to ask, a runtime on its way and a runtime that is fine all say nothing.
 */
export async function startupRuntimeCheck(ctx: Ctx): Promise<RuntimeWarning | null> {
  const u = ctx.ui.get();
  if (u.runtimeNote.checked) return null;
  ctx.ui.set({ runtimeNote: { ...u.runtimeNote, checked: true } });
  const watch = runtimeWatch(ctx);
  if (!watch || !hasModel(ctx.ui.get())) return null;
  await watch.refresh();
  const w = currentWarning(ctx, watch.report);
  if (!needsAction(w)) return null;
  ctx.ui.set({ runtimeNote: { checked: true, warning: w } });
  return w;
}

/** *Later* on the note: it goes until the next start. */
export function dismissRuntimeNote(ctx: Ctx): void {
  const n = ctx.ui.get().runtimeNote;
  if (n.warning) ctx.ui.set({ runtimeNote: { ...n, warning: null } });
}

/** The note's *Install* (and the notice's): the build is downloaded, or Microsoft's page for Visual C++ is opened. */
export async function fixRuntime(ctx: Ctx, w: RuntimeWarning): Promise<void> {
  const watch = runtimeWatch(ctx);
  if (w.kind === 'VC_RUNTIME') {
    await openVcRuntime(ctx, { vcRuntimeUrl: w.url }).catch(() => undefined);
    return;
  }
  if ((w.kind === 'MISSING' || w.kind === 'PAUSED') && watch) await watch.install(w.key);
}

/**
 * The portable's first-start chooser (phase U10, AI-POST.md §2.2) offers the inference runtime beside the models, as
 * the installer's page does: ticked unless the person unticked it, and downloaded with the first model they start.
 * Called when a model download has started; it does nothing outside the chooser, with the box unticked, or when the
 * runtime is installed or on its way. The launcher is asked afresh: the build is the one its rule chooses.
 */
export async function startChosenRuntime(ctx: Ctx): Promise<boolean> {
  const w = ctx.ui.get().settingsWindow;
  if (!w?.chooser || w.chooserRuntime === false) return false;
  const watch = runtimeWatch(ctx);
  if (!watch) return false;
  await watch.refresh();
  const rt = watch.report?.runtime;
  if (!rt || !watch.report?.choice?.key || (rt.state !== 'missing' && rt.state !== 'paused')) return false;
  await watch.install(rt.key);
  return true;
}
