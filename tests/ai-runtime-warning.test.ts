// The warnings about the inference runtime of phase U10, without a DOM (the pictures of them, in the render window's AI
// section, in Settings and in the status bar, are checked against the real launcher by tools/ai-runtime-check.mjs): when
// a model is installed and the runtime is missing, on its way, paused, broken, or Windows lacks Microsoft's Visual C++
// runtime, and when nothing is said; the poller; the note at start (once per session); the buttons' effects; the
// portable's chooser starting the runtime with the first model; and the installer's device choice becoming the person's.

import { describe, expect, it } from 'vitest';
import { needsAction, runtimeWarning, type AiRuntimeEntryState, type AiRuntimePort, type AiRuntimeQuery, type AiRuntimeReport, type RuntimeWarning } from '../src/core/ai-runtimes';
import { createInitialState, createStore } from '../src/core/store';
import { emptySnapshot, type ModelsSnapshot } from '../src/core/models';
import { AI_MODELS } from '../src/data/ai-models';
import { applyInstallerChoice } from '../src/ui/commands';
import {
  dismissRuntimeNote,
  fixRuntime,
  hasModel,
  POLL_BUSY_MS,
  POLL_IDLE_MS,
  RuntimeWatch,
  runtimeWatch,
  startChosenRuntime,
  startupRuntimeCheck,
  type Timers,
  VC_RUNTIME_URL,
} from '../src/ui/ai-runtime-state';
import { warningText } from '../src/ui/panels/ai-runtime-notice';
import type { AppServices } from '../src/ui/ports';
import type { Ctx } from '../src/ui/reactive';
import { setLang } from '../src/ui/strings';
import { createUiStore, type UiState } from '../src/ui/ui-state';

// ------------------------------------------------------------------ doubles

function entry(patch: Partial<AiRuntimeEntryState> = {}): AiRuntimeEntryState {
  return {
    key: 'SDCPP_WIN_VULKAN',
    os: 'windows',
    arch: 'x86_64',
    backend: 'VULKAN',
    here: true,
    name: 'sd-master-d637cfb-bin-win-vulkan-x64.zip',
    url: 'https://example.org/sd.zip',
    sha256: 'a'.repeat(64),
    bytes: 30_139_117,
    state: 'missing',
    done: 0,
    total: 30_139_117,
    error: null,
    version: null,
    devices: [],
    probeError: null,
    supports: [],
    verified: [],
    ...patch,
  };
}

function report(runtime: Partial<AiRuntimeEntryState> | null, patch: Partial<AiRuntimeReport> = {}): AiRuntimeReport {
  const rt = runtime === null ? null : entry(runtime);
  return {
    available: false,
    reason: 'NO_RUNTIME',
    backend: 'VULKAN',
    device: null,
    supports: [],
    activeModel: null,
    detail: null,
    choice: rt ? { rowId: 'gpu', backend: rt.backend, key: rt.key } : null,
    release: { tag: 'master-959-d637cfb', commit: 'd637cfb' },
    platform: { os: 'windows', arch: 'x86_64' },
    gpu: true,
    force: null,
    runtime: rt,
    runtimes: rt ? [rt] : [],
    sidecar: { state: 'stopped', label: null, pid: null, idleSeconds: 0 },
    downloader: true,
    ...patch,
  };
}

const installedOk = (p: Partial<AiRuntimeEntryState> = {}) => report({ state: 'installed', version: 'sd 1', ...p }, { available: true, reason: undefined });

/** A port that answers from a script and records what it was asked. */
function port(answer: () => AiRuntimeReport | Error) {
  const calls: string[] = [];
  const queries: AiRuntimeQuery[] = [];
  const p: AiRuntimePort = {
    async status(q) {
      calls.push('status');
      queries.push(q);
      const a = answer();
      if (a instanceof Error) throw a;
      return a;
    },
    async download(key) {
      calls.push(`download ${key}`);
    },
    async pause(key) {
      calls.push(`pause ${key}`);
    },
    async remove(key) {
      calls.push(`remove ${key}`);
    },
    async installFromFile() {
      return false;
    },
    async release() {},
    async probe(key) {
      calls.push(`probe ${key}`);
      return null;
    },
  };
  return { p, calls, queries };
}

/** Timers that run when the test says so. */
function timers() {
  const pending: { id: number; fn: () => void; ms: number }[] = [];
  let next = 1;
  const t: Timers = {
    set(fn, ms) {
      const id = next++;
      pending.push({ id, fn, ms });
      return id;
    },
    clear(h) {
      const i = pending.findIndex((x) => x.id === h);
      if (i >= 0) pending.splice(i, 1);
    },
  };
  return { t, pending, fire: () => pending.shift()?.fn() };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function snapshot(installed: string[], ready = true): ModelsSnapshot {
  return { ...emptySnapshot(AI_MODELS), kind: 'native', ready, installed };
}

function make(opts: { port?: AiRuntimePort | null; installed?: string[]; ui?: Partial<UiState>; opened?: string[] } = {}): Ctx {
  const store = createStore(createInitialState());
  const ui = createUiStore({ models: snapshot(opts.installed ?? ['ZIMAGE_Q4']), ...opts.ui });
  const services = {
    aiRuntime: opts.port === null ? undefined : opts.port,
    openExternal: async (url: string) => void opts.opened?.push(url),
  } as unknown as AppServices;
  return { store, ui, services };
}

// ------------------------------------------------------------------ what there is to say

describe('the warning for a model with no runtime to run it', () => {
  const w = (r: AiRuntimeReport | null, model = true): RuntimeWarning | null => runtimeWarning(r, model);

  it('says nothing without a model, without an answer, and with a runtime that is fine', () => {
    for (const r of [report({}), report({ state: 'installed', vcRuntime: 'missing' }), report(null)]) expect(w(r, false)).toBeNull();
    expect(w(null)).toBeNull();
    expect(w(installedOk())).toBeNull();
    expect(w(installedOk({ vcRuntime: null }))).toBeNull();
  });

  it('a model and no runtime: Install, with its key and size, and the last failure if there was one', () => {
    expect(w(report({ state: 'missing' }))).toEqual({ kind: 'MISSING', key: 'SDCPP_WIN_VULKAN', bytes: 30_139_117, error: null });
    expect(w(report({ state: 'missing', error: 'curl: could not resolve host' }))).toMatchObject({ kind: 'MISSING', error: 'curl: could not resolve host' });
  });

  it('a download on its way is progress, never an alarm; a paused one can be resumed', () => {
    expect(w(report({ state: 'downloading', done: 15_069_559 }))).toEqual({ kind: 'PROGRESS', key: 'SDCPP_WIN_VULKAN', phase: 'downloading', pct: 50, done: 15_069_559, total: 30_139_117 });
    expect(w(report({ state: 'verifying', done: 30_139_117 }))).toMatchObject({ kind: 'PROGRESS', phase: 'verifying', pct: 100 });
    expect(w(report({ state: 'installing', done: 30_139_117 }))).toMatchObject({ kind: 'PROGRESS', phase: 'installing' });
    expect(w(report({ state: 'paused', done: 3_013_912 }))).toEqual({ kind: 'PAUSED', key: 'SDCPP_WIN_VULKAN', pct: 10 });
  });

  it('Windows without Microsoft’s Visual C++ runtime: the build is installed and does not start', () => {
    expect(w(installedOk({ vcRuntime: 'missing', vcRuntimeUrl: VC_RUNTIME_URL, probeError: 'exit code 0xC0000135' }))).toEqual({ kind: 'VC_RUNTIME', key: 'SDCPP_WIN_VULKAN', url: VC_RUNTIME_URL });
    // The launcher's own link, else none (the notice's button uses ours).
    expect(w(installedOk({ vcRuntime: 'missing' }))).toMatchObject({ kind: 'VC_RUNTIME', url: null });
  });

  it('a build that does not start for another reason is broken; one with no build for the system says so', () => {
    expect(w(installedOk({ probeError: 'libvulkan.so.1: cannot open shared object file' }))).toEqual({ kind: 'BROKEN', key: 'SDCPP_WIN_VULKAN', error: 'libvulkan.so.1: cannot open shared object file' });
    expect(w(report(null, { platform: { os: 'macos', arch: 'aarch64' } }))).toEqual({ kind: 'NO_BUILD', os: 'macos', arch: 'aarch64' });
    // A choice with no pinned build (the rule answered a row, the catalogue has no key for the system).
    expect(w(report({ state: 'missing' }, { choice: { rowId: 'gpu', backend: 'VULKAN', key: null } }))).toMatchObject({ kind: 'NO_BUILD' });
  });

  it('only the ones the person can do something about are worth a note in the status bar', () => {
    expect(needsAction(w(report({ state: 'missing' })))).toBe(true);
    expect(needsAction(w(report({ state: 'paused' })))).toBe(true);
    expect(needsAction(w(installedOk({ vcRuntime: 'missing' })))).toBe(true);
    expect(needsAction(w(installedOk({ probeError: 'x' })))).toBe(true);
    expect(needsAction(w(report({ state: 'downloading', done: 1 })))).toBe(false);
    expect(needsAction(w(report(null)))).toBe(false);
    expect(needsAction(null)).toBe(false);
  });

  it('every kind has its words in both languages, with the failure and the numbers in them', () => {
    const kinds: RuntimeWarning[] = [
      { kind: 'MISSING', key: 'K', bytes: 1, error: 'boom' },
      { kind: 'PAUSED', key: 'K', pct: 12 },
      { kind: 'PROGRESS', key: 'K', phase: 'downloading', pct: 40, done: 4, total: 10 },
      { kind: 'PROGRESS', key: 'K', phase: 'verifying', pct: 100, done: 10, total: 10 },
      { kind: 'VC_RUNTIME', key: 'K', url: null },
      { kind: 'BROKEN', key: 'K', error: 'cannot start' },
      { kind: 'NO_BUILD', os: 'macos', arch: 'arm64' },
    ];
    for (const lang of ['en', 'es'] as const) {
      setLang(lang);
      for (const k of kinds) {
        const x = warningText(k);
        expect(x.title.trim(), `${lang} ${k.kind}`).not.toBe('');
        expect(x.text.trim(), `${lang} ${k.kind}`).not.toBe('');
        expect(`${x.title} ${x.text}`).not.toMatch(/\{\w+\}|undefined/);
      }
      expect(warningText(kinds[0]).text).toContain('boom');
      expect(warningText(kinds[1]).text).toContain('12');
      expect(warningText(kinds[5]).text).toContain('cannot start');
      expect(warningText(kinds[2]).progress).toBeCloseTo(0.4);
    }
    setLang('en');
    expect(warningText(kinds[4]).title).toBe('Microsoft Visual C++ is missing');
    setLang('es');
    expect(warningText(kinds[4]).title).toBe('Falta Microsoft Visual C++');
    setLang('en');
  });
});

// ------------------------------------------------------------------ the poller

describe('the one poller of the launcher’s report', () => {
  it('asks when the first listener comes, again every few seconds, quickly while a build moves, and stops with the last', async () => {
    let state: Partial<AiRuntimeEntryState> = { state: 'missing' };
    const { p, calls, queries } = port(() => report(state));
    const clock = timers();
    const watch = new RuntimeWatch(p, () => ({ force: null, cpu: false, model: 'ZIMAGE_Q4' }), clock.t);
    expect(calls).toEqual([]);
    const seen: (string | undefined)[] = [];
    const off = watch.subscribe(() => seen.push(watch.report?.runtime?.state));
    await flush();
    expect(calls).toEqual(['status']);
    expect(queries[0]).toEqual({ force: null, cpu: false, model: 'ZIMAGE_Q4' });
    expect(seen).toEqual(['missing']);
    expect(clock.pending.map((x) => x.ms)).toEqual([POLL_IDLE_MS]);
    state = { state: 'downloading', done: 100 };
    clock.fire();
    await flush();
    expect(seen).toEqual(['missing', 'downloading']);
    expect(clock.pending.map((x) => x.ms)).toEqual([POLL_BUSY_MS]);
    // A second listener hears what is known at once and does not double the polling.
    const second: string[] = [];
    const off2 = watch.subscribe(() => second.push('x'));
    expect(second).toEqual(['x']);
    expect(clock.pending.length).toBe(1);
    off();
    expect(clock.pending.length).toBe(1);
    off2();
    expect(clock.pending.length).toBe(0);
    expect(watch.listening).toBe(0);
  });

  it('keeps the last answer and says why when the launcher does not answer', async () => {
    let fail = false;
    const { p } = port(() => (fail ? new Error('the launcher did not answer') : report({ state: 'missing' })));
    const watch = new RuntimeWatch(p, () => ({ force: null, cpu: false, model: null }), timers().t);
    await watch.refresh();
    expect(watch.failure).toBeNull();
    fail = true;
    await watch.refresh();
    expect(watch.failure).toBe('the launcher did not answer');
    expect(watch.report?.runtime?.state).toBe('missing');
  });

  it('Install, Pause and Check again go to the launcher and ask again; a refusal is kept as the failure', async () => {
    const { p, calls } = port(() => report({ state: 'missing' }));
    const watch = new RuntimeWatch(p, () => ({ force: null, cpu: false, model: null }), timers().t);
    await watch.install('SDCPP_WIN_VULKAN');
    await watch.pause('SDCPP_WIN_VULKAN');
    await watch.probe('SDCPP_WIN_VULKAN');
    expect(calls).toEqual(['download SDCPP_WIN_VULKAN', 'status', 'pause SDCPP_WIN_VULKAN', 'status', 'probe SDCPP_WIN_VULKAN', 'status']);
    p.download = async () => {
      throw new Error('other-system');
    };
    await watch.install('X');
    // Kept for the notice to say, though the question after it was answered.
    expect(watch.actionError).toBe('other-system');
    expect(watch.failure).toBeNull();
    // The next button that works clears it.
    p.download = async () => undefined;
    await watch.install('SDCPP_WIN_VULKAN');
    expect(watch.actionError).toBeNull();
  });

  it('there is one per application, and none where there is no runtime to ask (the web, a launcher without the AI API)', () => {
    const a = make({ port: port(() => report({})).p });
    expect(runtimeWatch(a)).toBe(runtimeWatch(a));
    expect(runtimeWatch(a)).not.toBeNull();
    expect(runtimeWatch(make({ port: null }))).toBeNull();
  });

  it('hasModel: a model is installed (imported ones included), as the manager says', () => {
    expect(hasModel({ models: snapshot(['A']) })).toBe(true);
    expect(hasModel({ models: snapshot([]) })).toBe(false);
    expect(hasModel({ models: null })).toBe(false);
  });
});

// ------------------------------------------------------------------ the note at start

describe('the note in the status bar at the start of the session', () => {
  it('a model is installed and the runtime is not: the note, once per session', async () => {
    const { p, calls } = port(() => report({ state: 'missing' }));
    const ctx = make({ port: p });
    const w = await startupRuntimeCheck(ctx);
    expect(w).toMatchObject({ kind: 'MISSING', key: 'SDCPP_WIN_VULKAN' });
    expect(ctx.ui.get().runtimeNote).toEqual({ checked: true, warning: w });
    // Later: it goes; asking again in this session does not bring it back or ask the launcher.
    dismissRuntimeNote(ctx);
    expect(ctx.ui.get().runtimeNote.warning).toBeNull();
    expect(await startupRuntimeCheck(ctx)).toBeNull();
    expect(ctx.ui.get().runtimeNote.warning).toBeNull();
    expect(calls).toEqual(['status']);
  });

  it('says it for Windows without Visual C++ and for a paused download', async () => {
    const vc = make({ port: port(() => installedOk({ vcRuntime: 'missing', vcRuntimeUrl: VC_RUNTIME_URL })).p });
    expect(await startupRuntimeCheck(vc)).toMatchObject({ kind: 'VC_RUNTIME' });
    const paused = make({ port: port(() => report({ state: 'paused', done: 5 })).p });
    expect(await startupRuntimeCheck(paused)).toMatchObject({ kind: 'PAUSED' });
  });

  it('says nothing when the runtime is installed, on its way, when there is no model, or no runtime to ask', async () => {
    expect(await startupRuntimeCheck(make({ port: port(() => installedOk()).p }))).toBeNull();
    expect(await startupRuntimeCheck(make({ port: port(() => report({ state: 'downloading', done: 5 })).p }))).toBeNull();
    // The installer ticked the runtime: the launcher is downloading it, and that is not worth a note.
    const noModel = port(() => report({ state: 'missing' }));
    const none = make({ port: noModel.p, installed: [] });
    expect(await startupRuntimeCheck(none)).toBeNull();
    expect(noModel.calls).toEqual([]);
    expect(none.ui.get().runtimeNote.checked).toBe(true);
    const web = make({ port: null });
    expect(await startupRuntimeCheck(web)).toBeNull();
    expect(web.ui.get().runtimeNote).toEqual({ checked: true, warning: null });
  });

  it('an unanswering launcher is no note (the Settings row says why)', async () => {
    const ctx = make({ port: port(() => new Error('down')).p });
    expect(await startupRuntimeCheck(ctx)).toBeNull();
  });
});

// ------------------------------------------------------------------ the buttons

describe('what the buttons do', () => {
  it('Install downloads the build the warning named; Resume too; Visual C++ opens Microsoft’s page', async () => {
    const { p, calls } = port(() => report({ state: 'missing' }));
    const opened: string[] = [];
    const ctx = make({ port: p, opened });
    await fixRuntime(ctx, { kind: 'MISSING', key: 'SDCPP_WIN_VULKAN', bytes: 1, error: null });
    await fixRuntime(ctx, { kind: 'PAUSED', key: 'SDCPP_WIN_VULKAN', pct: 5 });
    expect(calls.filter((c) => c.startsWith('download'))).toEqual(['download SDCPP_WIN_VULKAN', 'download SDCPP_WIN_VULKAN']);
    await fixRuntime(ctx, { kind: 'VC_RUNTIME', key: 'SDCPP_WIN_VULKAN', url: 'https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist' });
    await fixRuntime(ctx, { kind: 'VC_RUNTIME', key: 'SDCPP_WIN_VULKAN', url: null });
    expect(opened).toEqual([VC_RUNTIME_URL, VC_RUNTIME_URL]);
    // Nothing to do for a download that is going, a broken build or no build.
    const before = calls.length;
    await fixRuntime(ctx, { kind: 'PROGRESS', key: 'K', phase: 'downloading', pct: 1, done: 1, total: 100 });
    await fixRuntime(ctx, { kind: 'BROKEN', key: 'K', error: 'x' });
    await fixRuntime(ctx, { kind: 'NO_BUILD', os: 'x', arch: 'y' });
    expect(calls.length).toBe(before);
  });
});

describe('the first-start chooser of a portable offers the runtime with the first model', () => {
  const chooser = (extra: Partial<NonNullable<UiState['settingsWindow']>> = {}): Partial<UiState> => ({ settingsWindow: { section: 'ai', focus: 'ai.models', nonce: 1, chooser: true, ...extra } });

  it('starts the build the launcher chose, with the box ticked (the default)', async () => {
    const { p, calls } = port(() => report({ key: 'SDCPP_LINUX_CPU', backend: 'CPU', state: 'missing' }));
    const ctx = make({ port: p, ui: chooser() });
    expect(await startChosenRuntime(ctx)).toBe(true);
    expect(calls).toEqual(['status', 'download SDCPP_LINUX_CPU', 'status']);
  });

  it('does not when the person unticked it, outside the chooser, or when the runtime is installed or on its way', async () => {
    for (const [name, ui, answer] of [
      ['unticked', chooser({ chooserRuntime: false }), report({ state: 'missing' })],
      ['not the chooser', { settingsWindow: { section: 'ai' as const, focus: null, nonce: 1 } }, report({ state: 'missing' })],
      ['no window', {}, report({ state: 'missing' })],
      ['installed', chooser(), installedOk()],
      ['downloading', chooser(), report({ state: 'downloading', done: 3 })],
      ['no build', chooser(), report(null)],
    ] as const) {
      const { p, calls } = port(() => answer);
      expect(await startChosenRuntime(make({ port: p, ui })), name).toBe(false);
      expect(calls.filter((c) => c.startsWith('download')), name).toEqual([]);
    }
    // And a paused one goes on.
    const { p, calls } = port(() => report({ state: 'paused', done: 9 }));
    expect(await startChosenRuntime(make({ port: p, ui: chooser() }))).toBe(true);
    expect(calls).toContain('download SDCPP_WIN_VULKAN');
    expect(await startChosenRuntime(make({ port: null, ui: chooser() }))).toBe(false);
  });
});

// ------------------------------------------------------------------ the installer's device

describe('the installer’s choice of device is the person’s from the first start', () => {
  it('the processor becomes Settings ▸ AI post-processing ▸ Run on; the graphics card is what it already was', () => {
    const cpu = make();
    expect(cpu.ui.get().settings['ai.device']).toBe('GPU');
    expect(applyInstallerChoice(cpu, { device: 'cpu' })).toBe(true);
    expect(cpu.ui.get().settings['ai.device']).toBe('CPU');
    expect(applyInstallerChoice(cpu, { device: 'cpu' })).toBe(false);
    const gpu = make();
    expect(applyInstallerChoice(gpu, { device: 'gpu' })).toBe(false);
    expect(gpu.ui.get().settings['ai.device']).toBe('GPU');
  });
});
