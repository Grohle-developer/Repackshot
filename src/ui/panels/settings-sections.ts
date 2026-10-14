// What the sections of the Settings window draw with their own code (the rest
// is generated from the metadata, settings-rows.ts): the default folder of new
// renders, the list of shortcuts, Measure performance and the engine's data,
// Storage (space by category, the history's limits, persistent storage),
// Desktop and About (licence and third-party licences with their full texts).
// Numbers here come from the engine, the browser or the launcher; none is
// assumed (CLAUDE.md rule 10). In the desktop application the space used is
// the data folder as the launcher measured it, and nothing speaks of what a
// browser may keep or delete (P3e).

import { msaaSamples, PIXEL_FILTERS, type FastAa } from '../../core/antialias';
import { allItems } from '../../core/library';
import { formatBytes } from '../../core/models';
import type { RowMeta, SectionId, SettingMeta } from '../../core/settings';
import { VERSION } from '../../core/version';
import * as cmd from '../commands';
import { showConfirmIn } from '../components/widgets';
import { h, icon } from '../dom';
import { dyn } from '../names';
import type { Ctx, Scope } from '../reactive';
import { ACTIONS, kbdText, SHORTCUT_GROUPS, shortcutGroup } from '../shortcuts';
import { formatNumber, getLang, isaLabel, t } from '../strings';
import { blockEl, infoRow, rowLabel, rowShell, settingRow, valueRow, type SettingRowOptions } from './settings-rows';
import { desktopWindowText } from '../window-host';

export interface SettingsHooks {
  /** Rows drawn by their own code, by row id. */
  rows?: Record<string, (ctx: Ctx, scope: Scope, row: RowMeta) => HTMLElement | null>;
  /** Blocks drawn whole by their own code, by block id. */
  blocks?: Record<string, (ctx: Ctx, scope: Scope, rows: RowMeta[]) => HTMLElement | null>;
  /** Options for generated rows (an auxiliary line of the moment, options that are not available here…). */
  rowOptions?: Record<string, (ctx: Ctx) => SettingRowOptions>;
  /** A line at the top of a section. */
  top?: Partial<Record<SectionId, (ctx: Ctx, scope: Scope) => HTMLElement | null>>;
}

const fmt = (n: number, digits = 0) => formatNumber(n, getLang(), digits);

/** A licence text shipped with the build, in a disclosure that loads it when opened. */
export function licenceDetails(ctx: Ctx, title: string, path: string, open = false): HTMLElement {
  const pre = h('pre', { class: 'sw-licence-text' }, t('set.ai.loadingText'));
  const det = h('details', { class: 'sw-licence', 'data-licence': path }, h('summary', null, title), pre) as HTMLDetailsElement;
  let loaded = false;
  const load = () => {
    if (loaded) return;
    loaded = true;
    void ctx.services.licenceText(path).then((text) => (pre.textContent = text ?? t('set.ai.textMissing')));
  };
  det.addEventListener('toggle', () => det.open && load());
  if (open) {
    det.open = true;
    load();
  }
  return det;
}

const link = (href: string, text: string) => h('a', { href, target: '_blank', rel: 'noopener noreferrer', class: 'sw-link' }, text);

// ------------------------------------------------------------------ Preferences ▸ Render defaults

function destinationRow(ctx: Ctx, scope: Scope, row: RowMeta): HTMLElement {
  const files = ctx.services.files;
  const downloads = h('button', { type: 'button', onclick: () => cmd.setSetting(ctx, 'render.destination', { kind: 'DOWNLOADS' }) }, icon('download', 14), t('rw.downloads'));
  const folderName = h('span', null, t('rw.chooseFolder'));
  const folder = h(
    'button',
    {
      type: 'button',
      disabled: !files.canChooseFolder,
      'data-tip': files.canChooseFolder ? t('rw.chooseFolderTip') : t('rw.onlyDownload'),
      onclick: async () => {
        const f = await files.chooseFolder();
        if (f) cmd.setSetting(ctx, 'render.destination', { kind: 'FOLDER', id: f.id, name: f.name });
      },
    },
    icon('folder', 14),
    folderName,
  );
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': rowLabel(row.id) }, downloads, folder);
  scope.watch(
    (_s, u) => u.settings['render.destination'],
    (d) => {
      downloads.setAttribute('aria-pressed', String(d.kind === 'DOWNLOADS'));
      folder.setAttribute('aria-pressed', String(d.kind === 'FOLDER'));
      // A folder is a path on the desktop (P3b): the button says its name, the line under the label the whole path.
      folderName.textContent = d.kind === 'FOLDER' ? folderLabel(d.name) : t('rw.chooseFolder');
      folder.title = d.kind === 'FOLDER' ? d.name : '';
    },
  );
  return settingRow(ctx, scope, row as SettingMeta, {
    control: seg,
    aux: (s) => {
      const d = s['render.destination'];
      return !files.canChooseFolder ? t('rw.onlyDownload') : d.kind === 'FOLDER' && d.name !== folderLabel(d.name) ? d.name : null;
    },
  });
}

/** The last part of a folder's path (`/home/a/Renders` → `Renders`); a name that is not a path, as it is. */
export function folderLabel(name: string): string {
  return name.split(/[\\/]/).filter(Boolean).pop() ?? name;
}

// ------------------------------------------------------------------ Keyboard shortcuts

function shortcutsBlock(_ctx: Ctx, _scope: Scope): HTMLElement {
  const filter = h('input', { type: 'search', class: 'text-input sw-sc-filter', placeholder: t('set.sc.filter'), 'aria-label': t('set.sc.filter') }) as HTMLInputElement;
  const body = h('div', { class: 'sw-sc-body' });
  type Entry = { label: string; keys: string[] };
  const groups: { id: string; title: string; entries: Entry[] }[] = SHORTCUT_GROUPS.map((g) => ({
    id: g,
    title: t(dyn(`set.sc.group.${g}`)),
    entries: ACTIONS.filter((a) => a.keys && shortcutGroup(a.id) === g).map((a) => ({ label: t(a.label), keys: [a.keys!, ...(a.altKeys ?? [])].map(kbdText) })),
  }));
  groups.push({
    id: 'windows',
    title: t('set.sc.group.windows'),
    entries: [
      { label: t('set.sc.rwRender'), keys: [kbdText('enter')] },
      { label: t('set.sc.rwQueue'), keys: [kbdText('shift+enter')] },
      { label: t('set.sc.search'), keys: [kbdText('mod+f')] },
      { label: t('set.sc.close'), keys: [kbdText('escape')] },
    ],
  });
  const render = () => {
    const q = filter.value.trim().toLowerCase();
    const shown = groups
      .map((g) => ({ ...g, entries: g.entries.filter((e) => !q || e.label.toLowerCase().includes(q) || e.keys.some((k) => k.toLowerCase().includes(q))) }))
      .filter((g) => g.entries.length > 0);
    body.replaceChildren(
      ...(shown.length === 0
        ? [h('p', { class: 'note' }, t('set.sc.none'))]
        : shown.map((g) =>
            h(
              'div',
              { class: 'sw-sc-group', 'data-group': g.id },
              h('h5', { class: 'sw-sc-title aux' }, g.title),
              h('dl', { class: 'sw-sc-list' }, ...g.entries.flatMap((e) => [h('dt', null, e.label), h('dd', null, ...e.keys.map((k) => h('kbd', null, k)))])),
            ),
          )),
    );
  };
  filter.addEventListener('input', render);
  filter.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && filter.value) {
      e.stopPropagation();
      e.preventDefault();
      filter.value = '';
      render();
    }
  });
  render();
  const list = h('div', { class: 'sw-row is-wide', 'data-row': 'shortcuts.list' }, filter, body);
  const remap = rowShell('shortcuts.remap', { soon: true, aux: t('set.sc.remapSoon'), control: h('button', { type: 'button', class: 'btn', disabled: true }, rowLabel('shortcuts.remap')) }).el;
  return blockEl('list', t('set.block.list'), list, remap);
}

// ------------------------------------------------------------------ Render engine

function measureRow(ctx: Ctx, scope: Scope): HTMLElement {
  const btn = h('button', { type: 'button', class: 'btn btn-primary sw-measure' }, t('set.measure.run'));
  const bar = h('div', { class: 'sw-bar', 'aria-hidden': 'true' }, h('div'));
  const rate = h('div', { class: 'sw-measure-rate tabular' });
  const detail = h('div', { class: 'note tabular sw-measure-detail' });
  const out = h('div', { class: 'sw-measure-out', role: 'status', 'aria-live': 'polite' }, rate, detail, bar);
  btn.addEventListener('click', () => {
    if (ctx.ui.get().perf.state === 'RUNNING') cmd.stopMeasuring();
    else void cmd.measurePerformance(ctx);
  });
  const parts = rowShell('engine.measure', { aux: t('set.engine.measure.aux'), control: btn, wide: true });
  parts.el.appendChild(out);
  scope.watch(
    (_s, u) => [u.perf, u.engine] as const,
    ([p, engine]) => {
      const reason = cmd.fullModeReason(ctx);
      btn.disabled = engine !== 'READY' && p.state !== 'RUNNING';
      btn.textContent = p.state === 'RUNNING' ? t('set.measure.stop') : t('set.measure.run');
      bar.style.display = p.state === 'RUNNING' ? '' : 'none';
      (bar.firstElementChild as HTMLElement).style.width = p.state === 'RUNNING' ? `${Math.min(100, (p.elapsed / 10) * 100)}%` : '0';
      out.dataset.state = p.state;
      rate.classList.toggle('is-result', p.state === 'DONE');
      if (p.state === 'DONE') {
        const r = p.result;
        const perSecond = r.pixelSamplesPerSecond >= 1e6 ? `${fmt(r.pixelSamplesPerSecond / 1e6, 2)} M` : fmt(r.pixelSamplesPerSecond, 0);
        rate.textContent = t('set.measure.rate', { rate: perSecond });
        detail.textContent = t('set.measure.detail', { w: r.width, h: r.height, spp: fmt(r.samples), s: fmt(r.seconds, 1), engine: r.engine });
        out.dataset.rate = String(Math.round(r.pixelSamplesPerSecond));
      } else if (p.state === 'RUNNING') {
        rate.textContent = t('set.measure.running', { s: fmt(Math.min(10, p.elapsed), 0) });
        detail.textContent = '';
      } else if (p.state === 'FAILED') {
        rate.textContent = t('set.measure.failed', { reason: p.reason });
        detail.textContent = '';
      } else if (p.state === 'STOPPED') {
        rate.textContent = t('set.measure.stopped');
        detail.textContent = '';
      } else {
        rate.textContent = engine === 'READY' ? t('set.measure.never') : t('set.measure.noEngine', { reason: reason ? t(reason) : '' });
        detail.textContent = '';
      }
    },
    (a, b) => a[0] === b[0] && a[1] === b[1],
  );
  return parts.el;
}

function engineInfoRow(ctx: Ctx, scope: Scope): HTMLElement {
  const dl = h('dl', { class: 'sw-info' });
  const parts = rowShell('engine.info', { control: null, wide: true, hideLabel: true });
  parts.el.appendChild(dl);
  scope.watch(
    (_s, u) => [u.engineInfo, u.engine] as const,
    ([info, engine]) => {
      const rows: [string, string][] = [];
      if (!info) {
        const reason = cmd.fullModeReason(ctx);
        dl.replaceChildren(h('dt', null, t('set.info.version')), h('dd', null, t('set.info.notLoaded', { reason: reason ? t(reason) : engine })));
        return;
      }
      rows.push([t('set.info.version'), info.native?.engineVersion ?? info.version ?? '–']);
      rows.push([t('set.info.build'), info.backend === 'wasm' ? (info.build === 'rt-simd.wasm' ? t('set.info.wasmSimd') : t('set.info.wasmScalar')) : t('set.info.native', { isa: isaLabel(info.native?.isa ?? info.build) })]);
      rows.push([t('set.info.threads'), info.native ? String(info.native.threads) : t('set.info.workers', { n: info.workers })]);
      rows.push([t('set.info.simd'), info.native ? [info.native.isa, ...info.native.simd.filter((x) => x !== info.native!.isa)].join(', ') : info.simd ? 'simd128' : info.simdSupported ? `${t('set.info.no')} (simd128: ${t('set.info.yes')})` : t('set.info.no')]);
      if (info.cores !== null) rows.push([t('set.info.cores'), String(info.cores)]);
      if (info.native) rows.push([t('set.info.system'), `${info.native.os} · ${info.native.arch}`]);
      dl.replaceChildren(...rows.flatMap(([k, v]) => [h('dt', null, k), h('dd', { class: 'tabular' }, v)]));
    },
    (a, b) => a[0] === b[0] && a[1] === b[1],
  );
  return parts.el;
}

// ------------------------------------------------------------------ Render engine ▸ Edge smoothing

/**
 * E11: Full mode's and the render's pixel filter as the list it is, from the cheapest to the costliest: one radio per
 * choice with its line of help (no cost in numbers), the chosen one pressed.
 */
function pixelFilterRow(ctx: Ctx, scope: Scope, row: RowMeta): HTMLElement {
  const key = 'engine.pixelFilter' as const;
  const items = PIXEL_FILTERS.map((o, i) => {
    const btn = h(
      'button',
      { type: 'button', class: 'sw-aa-option', role: 'radio', 'aria-checked': 'false', 'data-value': o, onclick: () => cmd.setSetting(ctx, key, o) },
      h('span', { class: 'sw-aa-rank tabular', 'aria-hidden': 'true' }, String(i + 1)),
      h('span', { class: 'sw-aa-text' }, h('span', { class: 'sw-aa-name' }, t(dyn(`set.engine.pixelFilter.${o}`))), h('span', { class: 'note' }, t(dyn(`set.engine.pixelFilter.help.${o}`)))),
    );
    // Arrows move along the list, as in a radio group.
    btn.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      const next = PIXEL_FILTERS[Math.max(0, Math.min(PIXEL_FILTERS.length - 1, i + d))];
      cmd.setSetting(ctx, key, next);
      (list.querySelector(`[data-value="${next}"]`) as HTMLElement | null)?.focus();
    });
    return btn;
  });
  const list = h('div', { class: 'sw-aa-list', role: 'radiogroup', 'aria-label': rowLabel(row.id) }, ...items);
  scope.watch(
    (_s, u) => u.settings[key],
    (v) => {
      for (const b of items) {
        const on = b.dataset.value === v;
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
      }
    },
  );
  return settingRow(ctx, scope, row as SettingMeta, { control: list, stacked: true });
}

// ------------------------------------------------------------------ Storage

interface UsageRow {
  id: string;
  label: string;
  bytes: number | null;
  free: (() => void) | null;
}

function storageUsageRow(ctx: Ctx, scope: Scope): HTMLElement {
  const total = h('div', { class: 'note sw-usage-total' }, t('set.st.measuring'));
  const list = h('div', { class: 'sw-usage' });
  const confirmHost = h('div', { class: 'sw-confirm' });
  const parts = rowShell('storage.usage', { control: null, wide: true, hideLabel: true });
  parts.el.append(total, list, confirmHost);
  const storage = ctx.services.storage;
  // The desktop: the data folder, part by part, as the launcher measured it.
  const folder = storage.kind === 'folder';
  let rows: UsageRow[] = [];
  let modelBytes = 0;
  let resultBytes = 0;
  let libraryBytes = 0;
  let measuring = 0;
  const measure = async () => {
    const seq = ++measuring;
    const u = ctx.ui.get();
    const snapModels = u.models?.ready ? Object.values(u.models.blobs).reduce((a, b) => a + (b.state === 'complete' ? (b.total ?? b.contiguous) : b.contiguous), 0) : null;
    const items = allItems(u.library).length;
    if (folder) {
      const usage = await storage.usage?.().catch(() => null);
      if (seq !== measuring) return;
      const of = (id: string) => usage?.folders.find((f) => f.id === id)?.bytes ?? null;
      modelBytes = of('models') ?? snapModels ?? 0;
      resultBytes = of('results') ?? 0;
      libraryBytes = of('library') ?? 0;
      const cache = of('thumbs');
      rows = [
        { id: 'models', label: t('set.st.models'), bytes: of('models'), free: (u.models?.installed.length ?? 0) > 0 || Object.keys(u.models?.downloads ?? {}).length > 0 ? freeModels : null },
        { id: 'results', label: t('set.st.results'), bytes: of('results'), free: u.results.length > 0 ? freeResults : null },
        { id: 'library', label: t('set.st.library'), bytes: of('library'), free: items > 0 ? freeLibrary : null },
        { id: 'cache', label: t('set.st.cache'), bytes: cache, free: cache ? freeCache : null },
        { id: 'logs', label: t('set.st.logs'), bytes: of('logs'), free: null },
        { id: 'window', label: t('set.st.window'), bytes: of('window'), free: null },
        { id: 'other', label: t('set.st.other'), bytes: of('other'), free: null },
      ];
      total.textContent = usage ? t('set.st.totalFolder', { used: formatBytes(usage.total, getLang()) }) : t('set.st.totalUnknown');
      draw(Math.max(1, usage?.total ?? 0));
      return;
    }
    const [lib, cache, estimate] = await Promise.all([Promise.resolve(storage.libraryBytes()), Promise.resolve(storage.cacheBytes()), storage.estimate().catch(() => null)]);
    if (seq !== measuring) return;
    modelBytes = snapModels ?? 0;
    resultBytes = u.results.reduce((a, r) => a + (r.bytes ?? 0), 0);
    libraryBytes = lib;
    rows = [
      { id: 'models', label: t('set.st.models'), bytes: snapModels, free: snapModels ? freeModels : null },
      { id: 'results', label: t('set.st.results'), bytes: resultBytes, free: resultBytes > 0 ? freeResults : null },
      { id: 'library', label: t('set.st.library'), bytes: lib, free: lib > 0 ? freeLibrary : null },
      { id: 'cache', label: t('set.st.cache'), bytes: cache, free: cache > 0 ? freeCache : null },
    ];
    total.textContent = estimate ? t('set.st.total', { used: formatBytes(estimate.usage, getLang()), quota: formatBytes(estimate.quota, getLang()) }) : t('set.st.totalUnknown');
    draw(Math.max(1, estimate?.quota ?? 0, ...rows.map((r) => r.bytes ?? 0)));
  };
  const draw = (max: number) => {
    list.replaceChildren(
      ...rows.map((r) =>
        h(
          'div',
          { class: 'sw-usage-row', 'data-usage': r.id, 'data-bytes': r.bytes === null ? '' : String(r.bytes) },
          h('span', { class: 'sw-usage-label' }, r.label),
          h('span', { class: 'sw-bar', 'aria-hidden': 'true' }, h('span', { style: `width:${r.bytes ? Math.max(1, (100 * r.bytes) / max) : 0}%` })),
          h('span', { class: 'sw-usage-bytes tabular note' }, r.bytes === null ? '–' : formatBytes(r.bytes, getLang())),
          h('button', { type: 'button', class: 'btn btn-sm', disabled: !r.free, ...(folder && !r.free && ['logs', 'window', 'other'].includes(r.id) ? { title: t('set.st.notFreed') } : {}), onclick: () => r.free?.() }, t('set.st.free')),
        ),
      ),
    );
  };
  const done = (bytes: number) => {
    ctx.ui.toast(t('set.st.freed', { size: formatBytes(bytes, getLang()) }));
    void measure();
  };
  const freeModels = () => {
    const m = ctx.ui.get().models;
    const svc = ctx.services.models;
    if (!m || !svc) return;
    const keep = ctx.ui.get().settings['ai.active'];
    const keys = m.installed.filter((k) => k !== keep);
    showConfirmIn(confirmHost, {
      message: t('set.st.freeModels', { size: formatBytes(modelBytes, getLang()) }),
      options: [
        {
          label: t('set.st.free'),
          primary: true,
          run: async () => {
            const before = modelBytes;
            for (const k of keys) await svc.remove(k);
            for (const k of Object.keys(m.downloads)) await svc.cancel(k);
            await measure();
            done(Math.max(0, before - modelBytes));
          },
        },
      ],
    });
  };
  const freeResults = () => {
    const n = ctx.ui.get().results.length;
    showConfirmIn(confirmHost, {
      message: t('set.st.freeResults', { n, size: formatBytes(resultBytes, getLang()) }),
      options: [{ label: t('set.st.free'), primary: true, run: async () => (await cmd.clearHistory(ctx), done(resultBytes)) }],
    });
  };
  const freeLibrary = () => {
    const n = allItems(ctx.ui.get().library).length;
    showConfirmIn(confirmHost, {
      message: t('set.st.freeLibrary', { n }),
      options: [{ label: t('set.st.free'), primary: true, run: () => (cmd.clearLibrary(ctx), done(libraryBytes)) }],
    });
  };
  const freeCache = () => {
    showConfirmIn(confirmHost, { message: t('set.st.freeCache'), options: [{ label: t('set.st.free'), primary: true, run: async () => done(await storage.clearCache()) }] });
  };
  scope.watch((_s, u) => [u.models, u.results, u.library] as const, () => void measure(), (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2]);
  return parts.el;
}

function persistRow(ctx: Ctx, scope: Scope): HTMLElement | null {
  void scope;
  // What the browser may delete is a question of the web version only (the row is `webOnly`).
  if (ctx.ui.get().desktop || ctx.services.storage.kind === 'folder') return null;
  const state = h('span', { class: 'note' });
  const ask = h('button', { type: 'button', class: 'btn' }, t('set.st.persistAsk'));
  const parts = rowShell('storage.persist', { aux: t('set.storage.persist.aux'), control: h('div', { class: 'sw-inline' }, state, ask) });
  const show = (v: boolean | null, denied = false) => {
    state.textContent = v === null ? t('set.st.persistNone') : v ? t('set.st.persisted') : denied ? t('set.st.persistDenied') : t('set.st.notPersisted');
    ask.style.display = v === false ? '' : 'none';
    parts.el.dataset.persisted = String(v);
  };
  void ctx.services.storage.persisted().then((v) => show(v));
  ask.addEventListener('click', async () => {
    const v = await ctx.services.storage.persist();
    show(v, v === false);
  });
  return parts.el;
}

/** Open folder: the launcher asks the system's file manager; when there is none it says so. */
function openFolder(ctx: Ctx, port: NonNullable<Ctx['services']['desktop']>, target: 'data' | 'logs' | 'models'): void {
  port.openFolder(target).catch((err: unknown) => {
    console.warn(`open folder: ${err instanceof Error ? err.message : String(err)}`);
    ctx.ui.toast(t('set.st.openFolderFailed'));
  });
}

const folderButton = (ctx: Ctx, target: 'data' | 'logs') => {
  const port = ctx.services.desktop;
  return port ? h('button', { type: 'button', class: 'btn btn-sm', 'data-open': target, onclick: () => openFolder(ctx, port, target) }, icon('folder', 14), t('set.st.openFolder')) : null;
};

function dataFolderRow(ctx: Ctx, scope: Scope): HTMLElement | null {
  void scope;
  const d = ctx.ui.get().desktop;
  if (!d || !ctx.services.desktop) return null;
  return valueRow('storage.folder', rowLabel('storage.folder'), { path: d.dataDir, actions: [folderButton(ctx, 'data')] });
}

// ------------------------------------------------------------------ Desktop

function desktopRows(): SettingsHooks['rows'] {
  return {
    'desktop.portable': (ctx) => {
      const d = ctx.ui.get().desktop;
      if (!d) return null;
      return valueRow('desktop.portable', rowLabel('desktop.portable'), { text: d.portable ? t('set.dk.portableYes') : t('set.dk.portableNo'), path: d.dataDir, actions: [folderButton(ctx, 'data')] });
    },
    'desktop.browser': (ctx) => {
      const d = ctx.ui.get().desktop;
      return d ? infoRow('desktop.browser', rowLabel('desktop.browser'), desktopWindowText(d.window, d.browser)) : null;
    },
    'desktop.logs': (ctx) => {
      const d = ctx.ui.get().desktop;
      return d ? valueRow('desktop.logs', rowLabel('desktop.logs'), { path: d.logsDir, actions: [folderButton(ctx, 'logs')] }) : null;
    },
  };
}

// ------------------------------------------------------------------ About

/** The files tools/licences.mjs ships under `licences/` (and vendor.mjs's LGPL texts of occt-import-js). */
export const LICENCE_PATHS = {
  project: 'licences/LICENSE.txt',
  three: 'licences/three.LICENSE.txt',
  rhino3dm: 'licences/rhino3dm.LICENSE.txt',
  occt: 'vendor/occt-import-js/license.occt-import-js.txt',
  opencascade: 'vendor/occt-import-js/license.occt.txt',
  sdcpp: 'licences/stable-diffusion.cpp.LICENSE.txt',
  ggml: 'licences/ggml.LICENSE.txt',
} as const;

/** A model licence's text by its SPDX id, when the build ships it. */
export const MODEL_LICENCE_PATHS: Readonly<Record<string, string>> = {
  'Apache-2.0': 'licences/Apache-2.0.txt',
  'LicenseRef-CreativeML-OpenRAIL-M': 'licences/CreativeML-OpenRAIL-M.txt',
  'CreativeML-OpenRAIL-M': 'licences/CreativeML-OpenRAIL-M.txt',
};

function aboutRows(): SettingsHooks['rows'] {
  return {
    'about.version': () => infoRow('about.version', rowLabel('about.version'), t('set.ab.version', { version: VERSION })),
    'about.licence': (ctx) => {
      const parts = rowShell('about.licence', { control: null, wide: true, hideLabel: true });
      parts.el.append(h('p', { class: 'sw-strong' }, t('set.ab.licenceName')), h('p', { class: 'note' }, t('set.ab.licenceSummary')), licenceDetails(ctx, t('set.ab.fullText'), LICENCE_PATHS.project));
      return parts.el;
    },
    'about.thirdParty': (ctx, scope) => {
      const parts = rowShell('about.thirdParty', { control: null, wide: true, hideLabel: true });
      const models = h('div', { class: 'sw-tp-models' });
      parts.el.append(
        h('div', { class: 'sw-tp' }, licenceDetails(ctx, t('set.ab.three'), LICENCE_PATHS.three), h('p', { class: 'note' }, link('https://github.com/mrdoob/three.js', t('set.ab.source')))),
        h('div', { class: 'sw-tp' }, licenceDetails(ctx, t('set.ab.rhino'), LICENCE_PATHS.rhino3dm), h('p', { class: 'note' }, link('https://github.com/mcneel/rhino3dm', t('set.ab.source')))),
        h(
          'div',
          { class: 'sw-tp' },
          licenceDetails(ctx, t('set.ab.occt'), LICENCE_PATHS.occt),
          licenceDetails(ctx, t('set.ab.occtOcct'), LICENCE_PATHS.opencascade),
          h('p', { class: 'note' }, `${t('set.ab.source')}: `, link('https://github.com/kovacsv/occt-import-js', 'occt-import-js'), ' · ', link('https://git.dev.opencascade.org/repos/occt.git', 'OpenCascade')),
        ),
        // The desktop's AI runtime (X3b, X3c): a separate program the launcher downloads; never linked, never shipped.
        h(
          'div',
          { class: 'sw-tp', 'data-tp': 'sdcpp' },
          licenceDetails(ctx, t('set.ab.sdcpp'), LICENCE_PATHS.sdcpp),
          licenceDetails(ctx, t('set.ab.ggml'), LICENCE_PATHS.ggml),
          h('p', { class: 'note' }, `${t('set.ab.source')}: `, link('https://github.com/leejet/stable-diffusion.cpp', 'stable-diffusion.cpp'), ' · ', link('https://github.com/leejet/ggml', 'ggml')),
        ),
        h('h5', { class: 'sw-sc-title aux' }, t('set.ab.models')),
        models,
      );
      scope.watch(
        (_s, u) => u.models,
        (snap) => {
          const installed = (snap?.installed ?? []).map((k) => snap!.catalogue.models.find((m) => m.key === k) ?? snap!.imported.find((m) => m.key === k)).filter((m) => !!m);
          models.replaceChildren(
            ...(installed.length === 0
              ? [h('p', { class: 'note' }, t('set.ab.modelsNone'))]
              : installed.map((m) => {
                  const name = 'label' in m ? m.label[getLang()] : m.name;
                  const lic = m.licence;
                  const path = MODEL_LICENCE_PATHS[lic.spdx];
                  return h('div', { class: 'sw-tp' }, path ? licenceDetails(ctx, `${name} (${lic.spdx})`, path) : h('p', null, `${name} (${lic.spdx})`), h('p', { class: 'note' }, link(lic.url, t('set.ai.licenceSource'))));
                })),
          );
        },
      );
      return parts.el;
    },
    'about.credits': () => {
      const parts = rowShell('about.credits', { control: null, wide: true, hideLabel: true });
      parts.el.append(h('p', { class: 'note' }, t('set.ab.credits'), ' ', link('https://github.com/Grohle/EZPackshot', 'EZ Packshot')));
      return parts.el;
    },
  };
}

// ------------------------------------------------------------------ the hooks

export const SECTION_HOOKS: SettingsHooks = {
  rows: {
    'render.destination': destinationRow,
    'engine.measure': measureRow,
    'engine.info': engineInfoRow,
    'engine.pixelFilter': pixelFilterRow,
    'storage.usage': storageUsageRow,
    'storage.persist': persistRow,
    'storage.folder': dataFolderRow,
    ...desktopRows(),
    ...aboutRows(),
  },
  blocks: { list: shortcutsBlock },
  rowOptions: {
    'engine.backend': (ctx) => ({
      disabledOptions: ctx.ui.get().desktop ? [] : ['NATIVE'],
      optionTip: (o) => (o === 'NATIVE' && !ctx.ui.get().desktop ? t('set.eng.nativeOnly') : undefined),
    }),
    'engine.threads': (ctx) => ({
      aux: () => {
        const info = ctx.ui.get().engineInfo;
        if (!info && ctx.ui.get().engine === 'LOADING') return t('set.eng.restarting');
        // The native engine runs on the threads the launcher started with (--threads); this is the browser's.
        if (info?.backend === 'native') return t('set.eng.nativeThreads', { n: info.workers });
        return info ? `${t('set.eng.threadsAuto', { n: info.autoThreads })} · ${t('set.engine.threads.aux')}` : null;
      },
    }),
    'engine.simd': (ctx) => ({
      aux: () => {
        const info = ctx.ui.get().engineInfo;
        if (!info) return null;
        if (info.backend === 'native') return t('set.eng.nativeSimd', { isa: isaLabel(info.native?.isa) });
        return `${info.simdSupported ? t('set.eng.simdYes') : t('set.eng.simdNo')} · ${t('set.engine.simd.aux')}`;
      },
    }),
    'engine.viewportSamples': () => ({ visible: (s) => s['engine.viewportLimit'] === 'SAMPLES' }),
    'engine.viewportSeconds': () => ({ visible: (s) => s['engine.viewportLimit'] === 'TIME' }),
    // E11: what the device draws (the preview's own word), and a line of help for the filter chosen.
    'engine.fastAa': (ctx) => ({
      aux: () => {
        const aa = ctx.ui.get().fastAa;
        if (!aa) return null;
        const device = aa.max <= 0 ? t('set.engine.fastAa.noDevice') : t('set.engine.fastAa.device', { max: aa.max, n: aa.samples > 0 ? `${aa.samples}×` : t('set.engine.fastAa.none') });
        return `${t('set.engine.fastAa.aux')} · ${device}`;
      },
      optionTip: (o) => {
        const aa = ctx.ui.get().fastAa;
        return aa && msaaSamples(o as FastAa) > aa.max ? t('set.engine.fastAa.over', { max: aa.max }) : undefined;
      },
    }),
  },
};
