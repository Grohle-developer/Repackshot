// Updating from inside the application (phase P5), the interface side with no DOM: the question about unsaved
// changes with its three buttons (Save · Save as… · Don’t save, Cancel and Esc dismiss), the request sent to
// the launcher (the package that matches the kind of copy, only the feed’s own release downloads), the answers of
// `GET /api/update` turned into the words of the row, the follower that waits for the launcher and then closes the
// window (asking again if the project changed meanwhile), failures with Try again, cancelling, and reloading the
// page in the middle. The launcher is a script of answers; the real one is tested in Rust (rt-app/tests/update.rs)
// and the rows in a browser (tools/update-install-check.mjs).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  downloadUrlAllowed,
  formatProgress,
  installActive,
  installPercent,
  installRequest,
  NO_INSTALL,
  parseInstallStatus,
  parseRelease,
  SUMS_NAME,
  type InstallerPort,
  type InstallRequest,
  type InstallStatus,
  type ReleaseInfo,
  type UpdateTarget,
} from '../src/core/updates';
import { createInitialState, createStore } from '../src/core/store';
import { NativeError } from '../src/io/native';
import * as cmd from '../src/ui/commands';
import type { AppServices, SaveResult } from '../src/ui/ports';
import type { Ctx } from '../src/ui/reactive';
import { setLang, STRINGS, t, type StringKey } from '../src/ui/strings';
import { createUiStore, type DesktopInfo } from '../src/ui/ui-state';
import { cancelInstall, INSTALL_POLL_MS, installFaultText, installRequestFor, installText, installUpdate, restartNow, retryInstall, syncInstall } from '../src/ui/updates';

beforeEach(() => {
  setLang('en');
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  setLang('en');
});

// ------------------------------------------------------------------ fixtures

const BASE = 'https://github.com/Grohle-developer/Repackshot/releases/download/v0.2.0';
const SETUP = 'Repackshot-0.2.0-windows-x64-setup.exe';
const ZIP = 'Repackshot-0.2.0-windows-x64-portable.zip';
const TARGZ = 'Repackshot-0.2.0-linux-x64-portable.tar.gz';

const asset = (name: string, size: number, base = BASE) => ({ name, size, browser_download_url: `${base}/${name}` });

function releaseOf(assets: unknown[] = [asset(SETUP, 38_400_000), asset(ZIP, 41_000_000), asset(TARGZ, 39_000_000), asset(SUMS_NAME, 300)]): ReleaseInfo {
  return parseRelease({ tag_name: 'v0.2.0', html_url: 'https://github.com/Grohle-developer/Repackshot/releases/tag/v0.2.0', published_at: '2026-10-14T09:30:00Z', assets })!;
}
const RELEASE = releaseOf();

const desktop = (os: string, portable: boolean, extra: Partial<DesktopInfo> = {}): DesktopInfo => ({ portable, dataDir: 'd', modelsDir: 'm', logsDir: 'l', browser: null, version: '0.1.5', os, arch: 'x86_64', ...extra });
const target = (os: string, portable: boolean): UpdateTarget => ({ desktop: true, os, arch: 'x86_64', portable });

const status = (patch: Partial<InstallStatus>): InstallStatus => ({ ...NO_INSTALL, tag: '0.2.0', ...patch });

/** The launcher as a script: each question gets the next answer (the last one repeats). */
class FakeInstaller implements InstallerPort {
  requests: InstallRequest[] = [];
  asked = 0;
  cancels = 0;
  /** The answers of `GET /api/update`; an Error is a launcher that does not answer. */
  script: (InstallStatus | Error)[] = [];
  /** What `POST /api/update/install` answers, or throws. */
  onInstall: InstallStatus | Error = status({ state: 'DOWNLOADING' });
  async install(req: InstallRequest): Promise<InstallStatus> {
    this.requests.push(req);
    if (this.onInstall instanceof Error) throw this.onInstall;
    return this.onInstall;
  }
  async status(): Promise<InstallStatus> {
    this.asked++;
    const next = this.script.length > 1 ? this.script.shift()! : this.script[0];
    if (next instanceof Error) throw next;
    return next ?? NO_INSTALL;
  }
  async cancel(): Promise<InstallStatus> {
    this.cancels++;
    return NO_INSTALL;
  }
}

interface Harness {
  ctx: Ctx;
  launcher: FakeInstaller;
  opened: string[];
  saves: { name: string; saveAs: boolean }[];
  closed: () => number;
  /** What the next save answers. */
  saveResult: { next: SaveResult | null };
}

function harness(opts: { os?: string; portable?: boolean; web?: boolean; installer?: boolean; window?: 'host' | 'browser' | 'none' } = {}): Harness {
  const launcher = new FakeInstaller();
  const opened: string[] = [];
  const saves: { name: string; saveAs: boolean }[] = [];
  const saveResult: { next: SaveResult | null } = { next: null };
  let closes = 0;
  const windowKind = opts.window ?? 'host';
  const services = {
    updates: { latest: async () => ({ ok: true, release: RELEASE }), installer: opts.installer === false ? null : launcher },
    openExternal: async (url: string) => void opened.push(url),
    project: { serialize: () => new Blob(['{}']) },
    projectFiles: {
      canSaveInPlace: true,
      async save(make: () => Blob, name: string, o: { saveAs: boolean }) {
        make();
        saves.push({ name, saveAs: o.saveAs });
        return saveResult.next ?? { kind: 'SAVED', name, inPlace: true };
      },
      adopt: () => undefined,
    },
    windowHost: windowKind === 'host' ? { closeOk: () => void closes++ } : null,
    desktop: windowKind === 'browser' ? { closeWindow: () => void closes++ } : null,
  } as unknown as AppServices;
  const ui = createUiStore({ desktop: opts.web ? null : desktop(opts.os ?? 'linux', opts.portable ?? true) });
  const ctx: Ctx = { store: createStore(createInitialState()), ui, services };
  return { ctx, launcher, opened, saves, closed: () => closes, saveResult };
}

const edit = (ctx: Ctx, name = 'Bottle') => ctx.store.dispatch({ type: 'meta/rename', name, label: { en: 'Rename', es: 'Renombrar' } });
const flush = async () => {
  await vi.advanceTimersByTimeAsync(0);
};
const tick = async (ms = INSTALL_POLL_MS) => {
  await vi.advanceTimersByTimeAsync(ms);
};
const labels = (ctx: Ctx) => ctx.ui.get().prompt?.options.map((o) => o.label);
const install = (ctx: Ctx) => ctx.ui.get().updates.install;

// ------------------------------------------------------------------ the question

describe('the question about unsaved changes (UI.md §4.3)', () => {
  it('has Save, Save as… and Don’t save, and Cancel (or Esc) dismisses it; the same for every use', () => {
    for (const ask of [
      (ctx: Ctx) => cmd.requestNewProject(ctx),
      (ctx: Ctx) => cmd.requestCloseWindow(ctx),
      (ctx: Ctx) => installUpdate(ctx, RELEASE),
    ]) {
      const h = harness();
      edit(h.ctx);
      ask(h.ctx);
      expect(labels(h.ctx)?.slice(0, 2)).toEqual(['Save', 'Save as…']);
      expect(h.ctx.ui.get().prompt!.options).toHaveLength(3);
      expect(h.ctx.ui.get().prompt!.options[0]).toMatchObject({ label: 'Save', primary: true });
      // Esc: the widget dismisses the question (`prompt` back to null) and nothing else happens.
      h.ctx.ui.set({ prompt: null });
      expect(h.saves).toEqual([]);
      expect(h.closed()).toBe(0);
      expect(h.launcher.requests).toEqual([]);
      expect(h.ctx.store.get().meta.dirty).toBe(true);
    }
  });

  it('asks nothing when there is nothing to lose', async () => {
    const h = harness();
    cmd.requestCloseWindow(h.ctx);
    expect(h.ctx.ui.get().prompt).toBeNull();
    expect(h.closed()).toBe(1);
    installUpdate(h.ctx, RELEASE);
    expect(h.ctx.ui.get().prompt).toBeNull();
    await flush();
    expect(h.launcher.requests).toHaveLength(1);
  });

  it('Save as… writes with the dialog and goes on; a cancelled or failed save does not', async () => {
    const h = harness();
    edit(h.ctx);
    cmd.requestCloseWindow(h.ctx);
    h.ctx.ui.get().prompt!.options[1].run(); // Save as…
    await flush();
    expect(h.saves).toEqual([{ name: 'bottle.repack.json', saveAs: true }]);
    expect(h.closed()).toBe(1);
    expect(h.ctx.store.get().meta.dirty).toBe(false);

    // The dialog is cancelled: nothing was written, so nothing goes on.
    const c = harness();
    edit(c.ctx);
    cmd.requestCloseWindow(c.ctx);
    c.saveResult.next = { kind: 'CANCELLED' };
    c.ctx.ui.get().prompt!.options[1].run();
    await flush();
    expect(c.saves).toHaveLength(1);
    expect(c.closed()).toBe(0);
    expect(c.ctx.store.get().meta.dirty).toBe(true);

    // The file cannot be written.
    const f = harness();
    edit(f.ctx);
    cmd.requestCloseWindow(f.ctx);
    f.saveResult.next = { kind: 'FAILED', reason: 'disk full' };
    f.ctx.ui.get().prompt!.options[1].run();
    await flush();
    expect(f.closed()).toBe(0);
    expect(f.ctx.store.get().meta.dirty).toBe(true);
  });

  it('Save writes where the project is (no dialog) and goes on, only when it was written', async () => {
    const h = harness();
    edit(h.ctx);
    cmd.requestNewProject(h.ctx);
    h.ctx.ui.get().prompt!.options[0].run();
    await flush();
    expect(h.saves).toEqual([{ name: 'bottle.repack.json', saveAs: false }]);
    expect(h.ctx.store.get().meta.name).toBe('');
    const c = harness();
    edit(c.ctx);
    cmd.requestNewProject(c.ctx);
    c.saveResult.next = { kind: 'CANCELLED' };
    c.ctx.ui.get().prompt!.options[0].run();
    await flush();
    expect(c.ctx.store.get().meta.name).toBe('Bottle');
  });

  it('Save as… and Don’t save are Guardar como… and No guardar in Spanish; the update says Salir sin guardar', () => {
    setLang('es');
    const h = harness();
    edit(h.ctx, 'Botella');
    cmd.requestNewProject(h.ctx);
    expect(labels(h.ctx)).toEqual(['Guardar', 'Guardar como…', 'No guardar']);
    h.ctx.ui.set({ prompt: null });
    installUpdate(h.ctx, RELEASE);
    expect(h.ctx.ui.get().prompt!.message).toBe('¿Guardar los cambios de «Botella» antes de actualizar?');
    expect(labels(h.ctx)).toEqual(['Guardar', 'Guardar como…', 'Salir sin guardar']);
  });

  it('the update asks “before updating” and its third button quits the application', async () => {
    const h = harness();
    edit(h.ctx);
    installUpdate(h.ctx, RELEASE);
    const prompt = h.ctx.ui.get().prompt!;
    expect(prompt.message).toBe('Save changes to “Bottle” before updating?');
    expect(labels(h.ctx)).toEqual(['Save', 'Save as…', 'Quit without saving']);
    // Nothing is asked of the launcher until the person answers.
    await flush();
    expect(h.launcher.requests).toEqual([]);
    prompt.options[2].run();
    await flush();
    expect(h.launcher.requests).toHaveLength(1);
    expect(h.saves).toEqual([]);
    // Save first: the project is written, then the launcher is asked.
    const s = harness();
    edit(s.ctx);
    installUpdate(s.ctx, RELEASE);
    s.ctx.ui.get().prompt!.options[0].run();
    await flush();
    expect(s.saves).toHaveLength(1);
    expect(s.launcher.requests).toHaveLength(1);
    // A save that wrote nothing does not install.
    const n = harness();
    edit(n.ctx);
    installUpdate(n.ctx, RELEASE);
    n.saveResult.next = { kind: 'CANCELLED' };
    n.ctx.ui.get().prompt!.options[1].run();
    await flush();
    expect(n.launcher.requests).toEqual([]);
    expect(install(n.ctx).status.state).toBe('IDLE');
  });
});

// ------------------------------------------------------------------ what is asked of the launcher

describe('the request to the launcher', () => {
  it('carries the package that matches the kind of copy, its checksums and the release’s version', () => {
    const asks = (os: string, portable: boolean) => installRequest(RELEASE, target(os, portable));
    expect(asks('windows', false)).toEqual({ tag: '0.2.0', assetUrl: `${BASE}/${SETUP}`, sumsUrl: `${BASE}/${SUMS_NAME}`, size: 38_400_000 });
    expect(asks('windows', true)).toEqual({ tag: '0.2.0', assetUrl: `${BASE}/${ZIP}`, sumsUrl: `${BASE}/${SUMS_NAME}`, size: 41_000_000 });
    expect(asks('linux', true)).toEqual({ tag: '0.2.0', assetUrl: `${BASE}/${TARGZ}`, sumsUrl: `${BASE}/${SUMS_NAME}`, size: 39_000_000 });
    // The only Linux package is the portable one.
    expect(asks('linux', false)?.assetUrl).toBe(`${BASE}/${TARGZ}`);
    // No package for it: the application cannot install, so Download.
    expect(asks('macos', false)).toBeNull();
    expect(installRequest(RELEASE, { desktop: true, os: 'windows', arch: 'aarch64', portable: false })).toBeNull();
    expect(installRequest(RELEASE, { desktop: false })).toBeNull();
    // A size the feed did not give is left out.
    const nosize = releaseOf([{ name: TARGZ, browser_download_url: `${BASE}/${TARGZ}` }, asset(SUMS_NAME, 300)]);
    expect(installRequest(nosize, target('linux', true))).toEqual({ tag: '0.2.0', assetUrl: `${BASE}/${TARGZ}`, sumsUrl: `${BASE}/${SUMS_NAME}` });
  });

  it('installUpdate sends exactly that, for each kind of copy', async () => {
    for (const [os, portable, file] of [
      ['windows', false, SETUP],
      ['windows', true, ZIP],
      ['linux', true, TARGZ],
    ] as const) {
      const h = harness({ os, portable });
      installUpdate(h.ctx, RELEASE);
      await flush();
      expect(h.launcher.requests, `${os} ${portable}`).toEqual([{ tag: '0.2.0', assetUrl: `${BASE}/${file}`, sumsUrl: `${BASE}/${SUMS_NAME}`, size: expect.any(Number) }]);
      expect(h.opened).toEqual([]);
    }
  });

  it('never a URL outside the feed’s release downloads: then Download (or nothing), and the launcher is not asked', async () => {
    const hostile = (url: string) => releaseOf([{ name: TARGZ, size: 1, browser_download_url: url }, asset(SUMS_NAME, 300)]);
    const sumsHostile = (url: string) => releaseOf([asset(TARGZ, 1), { name: SUMS_NAME, size: 3, browser_download_url: url }]);
    for (const url of [
      `https://evil.example/Grohle-developer/Repackshot/releases/download/v0.2.0/${TARGZ}`,
      `https://github.com.evil.example/Grohle-developer/Repackshot/releases/download/v0.2.0/${TARGZ}`,
      `https://github.com/someone-else/Repackshot/releases/download/v0.2.0/${TARGZ}`,
      `https://github.com/Grohle-developer/Other/releases/download/v0.2.0/${TARGZ}`,
      `http://github.com/Grohle-developer/Repackshot/releases/download/v0.2.0/${TARGZ}`,
      `https://github.com/Grohle-developer/Repackshot/releases/latest/download/${TARGZ}`,
      `https://github.com/Grohle-developer/Repackshot/archive/refs/tags/${TARGZ}`,
      `https://github.com/Grohle-developer/Repackshot/releases/download/v0.9.9/${TARGZ}`,
      `${BASE}/${TARGZ}?token=x`,
      `${BASE}/${TARGZ}#x`,
      `${BASE}/../v0.2.0/${TARGZ}`,
      `${BASE}/sub/${TARGZ}`,
      `${BASE}/${TARGZ.replace('-', '%2D')}`,
      `${BASE}/`,
      'https://github.com/',
    ]) {
      const h = harness({ os: 'linux', portable: true });
      expect(installRequestFor(h.ctx, hostile(url)), url).toBeNull();
      expect(installRequestFor(h.ctx, sumsHostile(url.replace(TARGZ, SUMS_NAME))), url).toBeNull();
      // The click falls back to the old Download: the asset URL itself is opened only if it is https.
      installUpdate(h.ctx, hostile(url));
      await flush();
      expect(h.launcher.requests, url).toEqual([]);
    }
    expect(downloadUrlAllowed(`${BASE}/${TARGZ}`, '0.2.0')).toBe(true);
    expect(downloadUrlAllowed(`${BASE.replace('/v0.2.0', '/0.2.0')}/${TARGZ}`, '0.2.0')).toBe(true);
    expect(downloadUrlAllowed(`${BASE}/${TARGZ}`, '0.3.0')).toBe(false);
    expect(downloadUrlAllowed(`${BASE}/${TARGZ}`, '0.2.0', { owner: 'a', repo: 'b' })).toBe(false);
    expect(downloadUrlAllowed(`https://GitHub.com/grohle-developer/repackshot/releases/download/v0.2.0/${TARGZ}`, '0.2.0')).toBe(true);
  });

  it('a release without its checksums, or without a package for this computer, is not installed from inside', async () => {
    const h = harness({ os: 'linux', portable: true });
    const noSums = releaseOf([asset(TARGZ, 1)]);
    expect(installRequestFor(h.ctx, noSums)).toBeNull();
    installUpdate(h.ctx, noSums);
    await flush();
    expect(h.launcher.requests).toEqual([]);
    // Download opens the package, as before.
    expect(h.opened).toEqual([`${BASE}/${TARGZ}`]);
    expect(installRequestFor(h.ctx, releaseOf([asset(ZIP, 1), asset(SUMS_NAME, 3)]))).toBeNull();
  });

  it('the web version has no Install and restart: Download opens the release page', async () => {
    const h = harness({ web: true });
    h.ctx.services.updates.installer = null;
    expect(installRequestFor(h.ctx, RELEASE)).toBeNull();
    installUpdate(h.ctx, RELEASE);
    await flush();
    expect(h.opened).toEqual([RELEASE.pageUrl]);
    // A launcher from before this phase has no update API: the same.
    const old = harness({ installer: false });
    expect(installRequestFor(old.ctx, RELEASE)).toBeNull();
    installUpdate(old.ctx, RELEASE);
    await flush();
    expect(old.opened).toEqual([`${BASE}/${TARGZ}`]);
  });
});

// ------------------------------------------------------------------ what the launcher says

describe('the launcher’s answers become the words of the row', () => {
  it('reads GET /api/update', () => {
    expect(parseInstallStatus({ state: 'IDLE', tag: null, received: 0, total: 0, ready: false, error: null, message: null, mode: null })).toEqual(NO_INSTALL);
    expect(parseInstallStatus({ state: 'DOWNLOADING', tag: '0.2.0', received: 3_200_000, total: 7_100_000, ready: false, error: null, message: null, mode: 'portable' })).toEqual({
      state: 'DOWNLOADING',
      tag: '0.2.0',
      received: 3_200_000,
      total: 7_100_000,
      ready: false,
      error: null,
      message: null,
    });
    expect(parseInstallStatus({ state: 'INSTALLING', ready: true })).toMatchObject({ state: 'INSTALLING', ready: true });
    expect(parseInstallStatus({ state: 'FAILED', error: 'checksum', message: 'nothing was installed' })).toMatchObject({ state: 'FAILED', error: 'checksum', message: 'nothing was installed' });
    // A code this version does not know is still a failure; numbers that are not numbers are zero.
    expect(parseInstallStatus({ state: 'FAILED', error: 'something-new', received: -4, total: 'x' })).toMatchObject({ error: 'other', received: 0, total: 0 });
    for (const bad of [null, 5, 'IDLE', [], {}, { state: 'DONE' }, { state: 7 }]) expect(parseInstallStatus(bad), JSON.stringify(bad)).toBeNull();
    expect(installActive({ state: 'DOWNLOADING' })).toBe(true);
    expect(installActive({ state: 'VERIFYING' })).toBe(true);
    expect(installActive({ state: 'INSTALLING' })).toBe(true);
    expect(installActive({ state: 'FAILED' })).toBe(false);
    expect(installActive({ state: 'IDLE' })).toBe(false);
  });

  it('Downloading… 45 % · 3,2 of 7,1 MB, then Verifying…, then Installing…', () => {
    const downloading = status({ state: 'DOWNLOADING', received: 3_200_000, total: 7_100_000 });
    expect(installPercent(downloading)).toBe(45);
    expect(installText(downloading)).toBe('Downloading… 45% · 3.2 of 7.1 MB');
    expect(installText(status({ state: 'VERIFYING', received: 7_100_000, total: 7_100_000 }))).toBe('Verifying…');
    expect(installText(status({ state: 'INSTALLING' }))).toBe('Installing… the application will restart');
    expect(installText(status({ state: 'IDLE' }))).toBe('');
    // The size is not known (the feed did not say): what arrived, and no percentage.
    expect(installPercent(status({ state: 'DOWNLOADING', received: 500, total: 0 }))).toBeNull();
    expect(installText(status({ state: 'DOWNLOADING', received: 3_200_000, total: 0 }))).toBe('Downloading… 3.2 MB');
    setLang('es');
    expect(installText(downloading)).toBe('Descargando… 45 % · 3,2 de 7,1 MB');
    expect(installText(status({ state: 'VERIFYING' }))).toBe('Comprobando…');
    expect(installText(status({ state: 'INSTALLING' }))).toBe('Instalando… la aplicación se reiniciará');
    expect(installText(status({ state: 'DOWNLOADING', received: 3_200_000, total: 0 }))).toBe('Descargando… 3,2 MB');
  });

  it('the amounts share one unit and never pass the total', () => {
    expect(formatProgress(0, 41_000_000, 'en', 'of')).toBe('0 of 41 MB');
    expect(formatProgress(40_999_999, 41_000_000, 'en', 'of')).toBe('41 of 41 MB');
    expect(formatProgress(50_000_000, 41_000_000, 'en', 'of')).toBe('41 of 41 MB');
    expect(formatProgress(1_200, 7_100, 'en', 'of')).toBe('1.2 of 7.1 kB');
    expect(formatProgress(2_500_000_000, 3_000_000_000, 'es', 'de')).toBe('2,5 de 3,0 GB');
    expect(installPercent({ received: 41_000_001, total: 41_000_000 })).toBe(100);
    expect(installPercent({ received: 0, total: 41_000_000 })).toBe(0);
  });

  it('every failure has its words, in both languages, and no word about a browser', () => {
    for (const code of ['download', 'disk-full', 'sums', 'checksum', 'extract', 'install', 'not-updatable', 'busy', 'lost', 'other', null] as const) {
      setLang('en');
      const en = installFaultText(code);
      setLang('es');
      const es = installFaultText(code);
      expect(en.length, String(code)).toBeGreaterThan(10);
      expect(es.length, String(code)).toBeGreaterThan(10);
      expect(es).not.toBe(en);
      expect(`${en} ${es}`).not.toMatch(/browser|navegador/i);
    }
    setLang('en');
    expect(installFaultText('checksum')).toContain('does not match its checksum');
    expect(installFaultText('disk-full')).toContain('not enough space');
    expect(installFaultText('not-updatable')).toContain('neither installed nor portable');
    expect(t('up.failedInstall', { reason: installFaultText('download') })).toMatch(/^The update failed: the download did not finish/);
  });

  it('every string of the install exists in English and in Spanish', () => {
    const keys = Object.keys(STRINGS.en).filter((k) => /^up\.(install|of|downloading|verifying|installing|restart|retry|cancelInstall|failedInstall|fail\.|webNote|updated)/.test(k) || /^project\.(saveAs|quitWithout|unsavedUpdate)$/.test(k)) as StringKey[];
    expect(keys.length).toBeGreaterThanOrEqual(26);
    for (const k of keys) {
      expect(STRINGS.en[k], k).toBeTruthy();
      expect(STRINGS.es[k], k).toBeTruthy();
      // The placeholders are the same in both.
      const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(holes(STRINGS.es[k]), k).toEqual(holes(STRINGS.en[k]));
    }
    expect(STRINGS.en['up.install']).toBe('Install and restart');
    expect(STRINGS.es['up.install']).toBe('Instalar y reiniciar');
    expect(STRINGS.en['project.saveAs']).toBe('Save as…');
    expect(STRINGS.es['project.saveAs']).toBe('Guardar como…');
  });
});

// ------------------------------------------------------------------ the install, followed

describe('Install and restart', () => {
  it('follows the launcher and, when the files are in place, closes the window', async () => {
    const h = harness();
    h.launcher.script = [
      status({ state: 'DOWNLOADING', received: 1_000_000, total: 38_400_000 }),
      status({ state: 'DOWNLOADING', received: 20_000_000, total: 38_400_000 }),
      status({ state: 'VERIFYING', received: 38_400_000, total: 38_400_000 }),
      status({ state: 'INSTALLING', received: 38_400_000, total: 38_400_000, ready: false }),
      status({ state: 'INSTALLING', received: 38_400_000, total: 38_400_000, ready: true }),
    ];
    installUpdate(h.ctx, RELEASE);
    await flush();
    // Told at once; the row already says it is downloading.
    expect(h.launcher.requests).toHaveLength(1);
    expect(install(h.ctx).status.state).toBe('DOWNLOADING');
    expect(install(h.ctx).request).toEqual(h.launcher.requests[0]);
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      await tick();
      seen.push(`${install(h.ctx).status.state}${install(h.ctx).status.ready ? '+ready' : ''}`);
    }
    expect(seen).toEqual(['DOWNLOADING', 'DOWNLOADING', 'VERIFYING', 'INSTALLING', 'INSTALLING+ready']);
    // The window is not closed while the files are being put in place, only once the launcher says it is ready.
    expect(h.closed()).toBe(1);
    // And it stops asking.
    const asked = h.launcher.asked;
    await tick(5000);
    expect(h.launcher.asked).toBe(asked);
  });

  it('does not close the window before the launcher is ready', async () => {
    const h = harness();
    h.launcher.script = [status({ state: 'INSTALLING', ready: false })];
    installUpdate(h.ctx, RELEASE);
    await tick(INSTALL_POLL_MS * 6);
    expect(install(h.ctx).status.state).toBe('INSTALLING');
    expect(h.closed()).toBe(0);
    expect(h.launcher.asked).toBeGreaterThan(3);
  });

  it('closes the app window of the browser, too, when there is no window of ours', async () => {
    const h = harness({ window: 'browser' });
    h.launcher.script = [status({ state: 'INSTALLING', ready: true })];
    installUpdate(h.ctx, RELEASE);
    await tick();
    expect(h.closed()).toBe(1);
  });

  it('asks again about what changed while it downloaded; Cancel keeps the window and Restart now asks once more', async () => {
    const h = harness();
    h.launcher.script = [status({ state: 'DOWNLOADING', received: 1 }), status({ state: 'INSTALLING', ready: true })];
    installUpdate(h.ctx, RELEASE);
    await flush();
    // The person goes on working while the package comes down.
    edit(h.ctx, 'Lamp');
    await tick(INSTALL_POLL_MS * 2);
    expect(h.closed()).toBe(0);
    const prompt = h.ctx.ui.get().prompt!;
    expect(prompt.message).toBe('Save changes to “Lamp” before updating?');
    expect(labels(h.ctx)).toEqual(['Save', 'Save as…', 'Quit without saving']);
    // Cancel (Esc): the window stays, the new version waits, and the row offers to restart.
    h.ctx.ui.set({ prompt: null });
    await flush();
    expect(h.closed()).toBe(0);
    expect(install(h.ctx).deferred).toBe(true);
    expect(install(h.ctx).status).toMatchObject({ state: 'INSTALLING', ready: true });
    // Restart now: the same question; Save as… writes it and the window closes.
    restartNow(h.ctx);
    expect(install(h.ctx).deferred).toBe(false);
    h.ctx.ui.get().prompt!.options[1].run();
    await flush();
    expect(h.saves).toEqual([{ name: 'lamp.repack.json', saveAs: true }]);
    expect(h.closed()).toBe(1);
  });

  it('a save that wrote nothing keeps the window too', async () => {
    const h = harness();
    h.launcher.script = [status({ state: 'INSTALLING', ready: true })];
    edit(h.ctx);
    installUpdate(h.ctx, RELEASE);
    h.ctx.ui.get().prompt!.options[2].run(); // Quit without saving: the install starts
    await flush();
    await tick();
    expect(h.ctx.ui.get().prompt).not.toBeNull();
    h.saveResult.next = { kind: 'CANCELLED' };
    h.ctx.ui.get().prompt!.options[0].run();
    await flush();
    expect(h.closed()).toBe(0);
    expect(install(h.ctx).deferred).toBe(true);
  });

  it('Quit without saving closes with the changes lost, as the person said', async () => {
    const h = harness();
    h.launcher.script = [status({ state: 'DOWNLOADING', received: 1 }), status({ state: 'INSTALLING', ready: true })];
    installUpdate(h.ctx, RELEASE);
    await flush();
    edit(h.ctx);
    await tick(INSTALL_POLL_MS * 2);
    h.ctx.ui.get().prompt!.options[2].run();
    await flush();
    expect(h.closed()).toBe(1);
    expect(h.saves).toEqual([]);
  });

  it('Settings (modal) makes way for the question, which sits under the project name', async () => {
    const h = harness();
    h.launcher.script = [status({ state: 'DOWNLOADING', received: 1 }), status({ state: 'INSTALLING', ready: true })];
    installUpdate(h.ctx, RELEASE);
    await flush();
    edit(h.ctx);
    h.ctx.ui.set({ settingsWindow: { section: 'updates' } } as never);
    await tick(INSTALL_POLL_MS * 2);
    expect(h.ctx.ui.get().prompt).not.toBeNull();
    expect(h.ctx.ui.get().settingsWindow).toBeNull();
  });

  it('there is no way to close the window: the new version waits, and the row says so', async () => {
    const h = harness({ window: 'none' });
    h.launcher.script = [status({ state: 'INSTALLING', ready: true })];
    installUpdate(h.ctx, RELEASE);
    await tick();
    expect(install(h.ctx).deferred).toBe(true);
    expect(h.ctx.ui.get().prompt).toBeNull();
  });

  it('a second click while it installs does nothing', async () => {
    const h = harness();
    h.launcher.script = [status({ state: 'DOWNLOADING', received: 1 })];
    installUpdate(h.ctx, RELEASE);
    await flush();
    installUpdate(h.ctx, RELEASE);
    installUpdate(h.ctx, RELEASE);
    await flush();
    expect(h.launcher.requests).toHaveLength(1);
  });
});

describe('when it fails', () => {
  it('a download that fails is told in the row, and Try again sends the same request', async () => {
    const h = harness();
    h.launcher.script = [status({ state: 'DOWNLOADING', received: 10 }), status({ state: 'FAILED', error: 'download', message: 'curl 22' })];
    installUpdate(h.ctx, RELEASE);
    await flush();
    await tick(INSTALL_POLL_MS * 2);
    expect(install(h.ctx).status).toMatchObject({ state: 'FAILED', error: 'download', message: 'curl 22' });
    // The follower stopped at the failure.
    const asked = h.launcher.asked;
    await tick(3000);
    expect(h.launcher.asked).toBe(asked);
    const first = h.launcher.requests[0];
    h.launcher.script = [status({ state: 'DOWNLOADING', received: 1 })];
    retryInstall(h.ctx);
    await flush();
    expect(h.launcher.requests).toEqual([first, first]);
    expect(install(h.ctx).status.state).toBe('DOWNLOADING');
  });

  it('a checksum that does not match, no room on the disk and a package that cannot be unpacked are failures, not restarts', async () => {
    for (const error of ['checksum', 'disk-full', 'extract', 'install', 'sums'] as const) {
      const h = harness();
      h.launcher.script = [status({ state: 'FAILED', error })];
      installUpdate(h.ctx, RELEASE);
      await tick();
      expect(install(h.ctx).status, error).toMatchObject({ state: 'FAILED', error });
      expect(h.closed(), error).toBe(0);
    }
  });

  it('a launcher that refuses is a failure in the row, with its code', async () => {
    const h = harness();
    h.launcher.onInstall = new NativeError(409, 'not-updatable', 'this copy is neither installed nor portable');
    installUpdate(h.ctx, RELEASE);
    await flush();
    expect(install(h.ctx).status).toMatchObject({ state: 'FAILED', error: 'not-updatable', message: 'this copy is neither installed nor portable' });
    expect(h.closed()).toBe(0);
    // A refusal the page does not know, and a launcher that cannot be reached.
    const odd = harness();
    odd.launcher.onInstall = new NativeError(500, 'io', 'cannot start the update');
    installUpdate(odd.ctx, RELEASE);
    await flush();
    expect(install(odd.ctx).status).toMatchObject({ state: 'FAILED', error: 'other' });
    const gone = harness();
    gone.launcher.onInstall = new Error('Failed to fetch');
    installUpdate(gone.ctx, RELEASE);
    await flush();
    expect(install(gone.ctx).status).toMatchObject({ state: 'FAILED', message: 'Failed to fetch' });
  });

  it('a launcher that stops answering while it downloads is lost, after a while', async () => {
    const h = harness();
    h.launcher.script = [new Error('Failed to fetch')];
    installUpdate(h.ctx, RELEASE);
    await flush();
    await tick(INSTALL_POLL_MS * 20);
    expect(install(h.ctx).status).toMatchObject({ state: 'FAILED', error: 'lost' });
  });
});

describe('cancelling and coming back', () => {
  it('Cancel stops the download: the launcher is told and the row goes back to the offer', async () => {
    const h = harness();
    h.launcher.script = [status({ state: 'DOWNLOADING', received: 1 })];
    installUpdate(h.ctx, RELEASE);
    await flush();
    await tick();
    h.launcher.script = [NO_INSTALL];
    await cancelInstall(h.ctx);
    expect(h.launcher.cancels).toBe(1);
    expect(install(h.ctx).status).toEqual(NO_INSTALL);
    const asked = h.launcher.asked;
    await tick(3000);
    expect(h.launcher.asked).toBe(asked);
    // And it can be started again.
    installUpdate(h.ctx, RELEASE);
    await flush();
    expect(h.launcher.requests).toHaveLength(2);
  });

  it('closing Settings does not stop it: the state is the launcher’s and the follower is not the window’s', async () => {
    const h = harness();
    h.launcher.script = [status({ state: 'DOWNLOADING', received: 1 }), status({ state: 'DOWNLOADING', received: 2 }), status({ state: 'VERIFYING' })];
    h.ctx.ui.set({ settingsWindow: { section: 'updates' } } as never);
    installUpdate(h.ctx, RELEASE);
    await flush();
    h.ctx.ui.set({ settingsWindow: null });
    await tick(INSTALL_POLL_MS * 3);
    expect(install(h.ctx).status.state).toBe('VERIFYING');
    expect(h.launcher.cancels).toBe(0);
  });

  it('a page that was reloaded picks the update up where the launcher has it, and asks nothing', async () => {
    const h = harness();
    h.launcher.script = [status({ state: 'DOWNLOADING', received: 5, total: 10 }), status({ state: 'VERIFYING' })];
    await syncInstall(h.ctx);
    expect(install(h.ctx).status).toMatchObject({ state: 'DOWNLOADING', received: 5 });
    expect(h.ctx.ui.get().prompt).toBeNull();
    await tick();
    expect(install(h.ctx).status.state).toBe('VERIFYING');
    // Nothing under way: nothing to follow. A launcher that does not answer: the same.
    const idle = harness();
    idle.launcher.script = [NO_INSTALL];
    await syncInstall(idle.ctx);
    expect(install(idle.ctx).status).toEqual(NO_INSTALL);
    const mute = harness();
    mute.launcher.script = [new Error('down')];
    await syncInstall(mute.ctx);
    expect(install(mute.ctx).status).toEqual(NO_INSTALL);
    // An update that is already ready closes the window as soon as it is seen.
    const ready = harness();
    ready.launcher.script = [status({ state: 'INSTALLING', ready: true })];
    await syncInstall(ready.ctx);
    await tick();
    expect(ready.closed()).toBe(1);
  });
});
