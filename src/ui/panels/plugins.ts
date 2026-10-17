// Render window ▸ Plugins (UI.md §2.7, ROADMAP P6 decision 4), after AI post-processing: a block for each installed
// plugin with the `render.plugins` slot, drawn from its manifest and nothing else: its logo, name, version, the line
// it brings (`notice`, a preview of an app in development…), its project page and the Closed licence badge; its
// recipes as a carousel of cards (decision 8, plugin-recipes.ts: each the plugin's base picture through the recipe,
// made once and kept), by its own categories and public names; its controls by group (slider, list, switch); the
// preview, the current result at the preview's width through the plugin in its worker (the plugin's base picture
// while there is no result), made again 300 ms after the last change and cancelled by the next one, with the plugin's
// own numbers under it and the time it took (measured); Apply, the result at full size through the plugin, kept as a
// new result with its provenance; and the switch that sends the render jobs through it too (decision 9, a seed a
// frame). The recipe, the controls and the switch are the project's (`RenderSettings.plugins`): every change is a
// store action, undoable, one entry per drag. Without a plugin the section says, in one line, where plugins are
// installed.

import { activeFilters, controlGroups, controlsFor, defaultControls, filterPresets, seedProvenance, sliderDigits, sliderText, withPlugin, type InstalledPlugin, type PluginControl, type PluginControlValue, type PluginManifest, type PluginPreset, type PluginPresets, type PluginRunResult } from '../../core/plugins';
import { pluginSource } from '../../core/plugin-pixels';
import type { RenderSettings } from '../../core/render';
import type { Label } from '../../data/types';
import * as cmd from '../commands';
import { select, slider, toggle } from '../components/controls';
import { filterChipRows, type ChipRows } from '../components/filter-chips';
import { splitCompare, type SplitCompare } from '../components/split-compare';
import { h, icon } from '../dom';
import { dyn } from '../names';
import { recordPluginResult } from '../plugin-results';
import type { Ctx, Scope } from '../reactive';
import { formatNumber, getLang, L, lbl, t } from '../strings';
import { recipeStrip, type RecipeCard } from './plugin-recipes';
import { faultText } from './settings-plugins';

/** The width a preview is rendered at (the result is scaled down to it). */
export const PREVIEW_WIDTH = 480;
/** Milliseconds after the last change before the preview is made again. */
export const PREVIEW_DELAY_MS = 300;

export interface PluginsSectionEnv {
  get(): RenderSettings;
  set(patch: Partial<RenderSettings>, gesture?: string, label?: Label): void;
}

/** The installed plugins the render window shows: those whose package opens and that take the `render.plugins` slot. */
export function renderPlugins(installed: readonly InstalledPlugin[] | undefined): (InstalledPlugin & { manifest: PluginManifest })[] {
  return (installed ?? []).filter((p): p is InstalledPlugin & { manifest: PluginManifest } => p.manifest !== null && p.manifest.slots.includes('render.plugins'));
}

/** The plugin's numbers as one line: "Negative per pixel 6.9 µm · Grain stochastic". */
export function infoLine(items: PluginRunResult['info']['items']): string {
  return items.map((i) => `${lbl(i.label)} ${typeof i.value === 'number' ? formatNumber(i.value, getLang(), Number.isInteger(i.value) ? 0 : 2) : i.value}${i.unit ? ` ${i.unit}` : ''}`).join(' · ');
}

function canvasOf(width: number, height: number, rgba: Uint8ClampedArray): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba) as unknown as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
  return c;
}

const secondsText = (s: number) => (s >= 59.5 ? t('time.min', { n: Math.round(s / 60) }) : t('time.s', { n: formatNumber(s, getLang(), s < 10 ? 1 : 0) }));
const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError';
const why = (err: unknown) => (err && typeof err === 'object' && 'fault' in err ? faultText((err as { fault: Parameters<typeof faultText>[0] }).fault) : err instanceof Error ? err.message : String(err));

/** One control of a manifest, drawn generically. */
function controlRow(c: PluginControl, value: PluginControlValue, onChange: (v: PluginControlValue, gesture?: string) => void, hold: { hold(): void; release(): void }): { el: HTMLElement; set(v: PluginControlValue): void } {
  const name = lbl(c.label);
  let ctl: { el: HTMLElement; set(v: never): void };
  if (c.kind === 'slider') {
    const digits = sliderDigits(c);
    const s = slider({
      value: value as number,
      min: c.min,
      max: c.max,
      step: c.step,
      digits,
      ariaLabel: name,
      // At its left stop a control with a `minLabel` reads it (the plugin keeps its own value there).
      format: (v) => sliderText(c, v, getLang(), (n, d) => formatNumber(n, getLang(), d)),
      onChange: (v, g) => onChange(v, g),
      onHold: () => hold.hold(),
      onRelease: () => hold.release(),
    });
    ctl = s as { el: HTMLElement; set(v: never): void };
  } else if (c.kind === 'select') {
    ctl = select(
      c.options.map((o) => ({ value: o.value, label: lbl(o.label) })),
      value as string,
      (v) => onChange(v),
      name,
    ) as { el: HTMLElement; set(v: never): void };
  } else {
    let on = value as boolean;
    const tg = toggle(on, () => onChange(!on), name);
    ctl = {
      el: tg.el,
      set: ((v: boolean) => {
        on = v;
        tg.set(v);
      }) as (v: never) => void,
    };
  }
  const el = h('div', { class: `rw-ai-ctl rw-pl-ctl is-${c.kind}`, 'data-control': c.key }, c.kind === 'toggle' ? h('div', { class: 'rw-inline rw-pl-toggle' }, ctl.el, h('span', { class: 'rw-ai-ctl-name' }, name)) : h('div', { class: 'rw-ai-ctl-name' }, name), c.kind === 'toggle' ? null : ctl.el, c.aux ? h('div', { class: 'note' }, lbl(c.aux)) : null);
  return { el, set: (v) => ctl.set(v as never) };
}

/** The block of one plugin. */
function pluginBlock(ctx: Ctx, scope: Scope, env: PluginsSectionEnv, plugin: InstalledPlugin & { manifest: PluginManifest }): HTMLElement {
  const port = ctx.services.plugins!;
  const { ui } = ctx;
  const m = plugin.manifest;
  const id = m.id;
  const kept = () => env.get().plugins[id];
  const controls = () => controlsFor(m, kept()?.controls);
  const recipe = () => kept()?.recipe ?? null;
  const undoOf = (what: Label): Label => L('undo.plugin', { plugin: m.name, what });
  let presets: PluginPresets | null = null;

  // ------------------------------------------------------------------ the head
  const head = h(
    'div',
    { class: 'rw-pl-head' },
    h('div', { class: 'sw-pl-logo rw-pl-logo', 'aria-hidden': 'true' }, plugin.logo ? h('img', { src: plugin.logo, alt: '', width: 32, height: 32, draggable: 'false' }) : icon('model', 18)),
    h(
      'div',
      { class: 'rw-pl-title' },
      h('div', { class: 'rw-pl-name' }, h('span', { class: 'sw-strong' }, lbl(m.name)), h('span', { class: 'aux tabular' }, t('rw.pl.version', { version: m.version })), h('span', { class: 'sw-badge aux sw-pl-licence', 'data-licence': 'closed' }, t('set.pl.closed'))),
      h('p', { class: 'note rw-pl-notice' }, lbl(m.notice), ' ', h('a', { href: m.homepage, target: '_blank', rel: 'noopener noreferrer', class: 'sw-link' }, t('set.pl.homepage'), ' ↗')),
    ),
  );

  // ------------------------------------------------------------------ recipes (decision 8: a carousel) and controls
  const strip = recipeStrip({
    label: t('rw.pl.recipes'),
    pending: t('rw.pl.thumbPending'),
    outside: t('rw.pl.outside'),
    scrub: t('rw.pl.scrub'),
    onPick: (r) => {
      if (r !== recipe()) env.set({ plugins: withPlugin(env.get().plugins, id, { recipe: r }) }, undefined, L('undo.pluginRecipe', { plugin: m.name }));
    },
  });
  scope.onDispose(() => strip.destroy());
  const recipeAux = h('div', { class: 'note rw-pl-recipe-aux' }, t('rw.pl.loadingRecipes'));
  const thumbsLine = h('div', { class: 'note tabular rw-pl-thumbs', role: 'status' });
  // P6b: the plugin's recipe filters as rows of chips (All and its options), combined; the count of what they leave.
  const chipsEl = h('div', { class: 'rw-pl-filters' });
  const countLine = h('div', { class: 'note tabular rw-pl-count', role: 'status' });
  let chipRows: ChipRows | null = null;
  let ordered: PluginPreset[] = [];
  let shownKey = '';
  const chosenFilters = () => activeFilters(presets?.filters ?? [], kept()?.filters);
  const setFilter = (filterId: string, value: string | null, label: PluginPresets['filters'][number]['label']) => {
    if ((chosenFilters()[filterId] ?? null) === value) return;
    env.set({ plugins: withPlugin(env.get().plugins, id, { filter: { id: filterId, value } }) }, undefined, L('undo.pluginFilter', { plugin: m.name, filter: label }));
  };
  const drawChips = () => {
    if (!presets || presets.filters.length === 0) return;
    const offered = presets.filters;
    chipRows = filterChipRows(
      offered.map((f) => ({ id: f.id, label: lbl(f.label), options: f.options.map((o) => ({ value: o.value, label: lbl(o.label) })) })),
      t('rw.pl.filterAll'),
      (f, value) => setFilter(f.id, value, offered.find((x) => x.id === f.id)!.label),
    );
    chipsEl.replaceChildren(...chipRows.rows);
  };
  const cardOf = (p: PluginPreset, outside = false): RecipeCard => ({ id: p.id, name: p.aux ? `${lbl(p.name)} · ${lbl(p.aux)}` : lbl(p.name), category: lbl(presets!.categories.find((x) => x.id === p.category)?.label ?? { en: p.category, es: p.category }), ...(outside ? { outside: true } : {}) });
  /** The cards the filters leave (the chosen recipe first when they leave it out), rebuilt only when that changes. */
  const showCards = () => {
    if (!presets) return;
    const f = chosenFilters();
    const res = filterPresets(ordered, f, recipe());
    const key = `${JSON.stringify(f)}|${res.kept?.id ?? ''}`;
    chipRows?.set(f);
    setText(countLine, presets.filters.length ? (res.count === 0 ? t('rw.pl.filterNone', { total: res.total }) : t('rw.pl.filterCount', { n: res.count, total: res.total })) : '');
    if (key === shownKey) return;
    shownKey = key;
    strip.setCards([...(res.kept ? [cardOf(res.kept, true)] : []), { id: null, name: t('rw.pl.noRecipe'), category: t('rw.pl.noRecipeCard') }, ...res.shown.map((p) => cardOf(p))]);
  };
  const fillRecipes = () => {
    if (!presets) return;
    // In the plugin's order, by its categories (each category's recipes together).
    ordered = presets.categories.flatMap((c) => presets!.presets.filter((p) => p.category === c.id));
    drawChips();
    shownKey = '';
    showCards();
    syncRecipe();
    makeThumbs(ordered.length + 1);
  };
  const syncRecipe = () => {
    if (!presets) return;
    showCards();
    const r = recipe();
    const p = r ? presets.presets.find((x) => x.id === r) : undefined;
    strip.select(p ? p.id : null);
    setText(recipeAux, p ? `${lbl(p.name)} · ${lbl(presets.categories.find((c) => c.id === p.category)?.label ?? { en: '', es: '' })}` : `${t('rw.pl.noRecipe')} · ${t('rw.pl.noRecipeAux')}`);
  };
  // The cards' pictures: the kept ones at once, the missing ones one by one (while no preview waits), each once.
  const thumbsAc = new AbortController();
  scope.onDispose(() => thumbsAc.abort());
  const makeThumbs = (total: number) => {
    if (!port.hasBase(id)) return;
    let done = 0;
    const line = () => setText(thumbsLine, done < total ? t('rw.pl.thumbs', { done, total }) : '');
    line();
    void port
      .thumbnails(
        id,
        (r, png) => {
          done++;
          strip.picture(r, URL.createObjectURL(png));
          line();
        },
        thumbsAc.signal,
      )
      .then(() => setText(thumbsLine, ''))
      .catch((err: unknown) => {
        if (!isAbort(err)) setText(thumbsLine, t('rw.pl.thumbsFailed', { reason: why(err) }));
      });
  };
  const rows = new Map<string, ReturnType<typeof controlRow>>();
  const groupEls = controlGroups(m, kept()?.controls).map(({ group, controls: list }) => {
    const els = list.map(({ control: c, value }) => {
      const r = controlRow(c, value, (v, g2) => env.set({ plugins: withPlugin(env.get().plugins, id, { controls: { ...controls(), [c.key]: v } }) }, g2, undoOf(c.label)), { hold: () => (held = true), release: () => ((held = false), schedule()) });
      rows.set(c.key, r);
      return r.el;
    });
    return h('div', { class: 'rw-pl-group', 'data-group': group.id }, h('h5', { class: 'rw-pl-group-title aux' }, lbl(group.label)), ...els);
  });
  const defaults = h('button', { type: 'button', class: 'btn btn-sm rw-pl-defaults', onclick: () => env.set({ plugins: withPlugin(env.get().plugins, id, { controls: defaultControls(m) }) }, undefined, L('undo.pluginDefaults', { plugin: m.name })) }, icon('refresh', 14), t('rw.pl.defaults'));
  // Decision 9: the render jobs through the plugin too (each frame of an animation with its own seed).
  const jobsToggle = toggle(kept()?.jobs === true, () => env.set({ plugins: withPlugin(env.get().plugins, id, { jobs: !(kept()?.jobs === true) }) }, undefined, L('undo.pluginJobs', { plugin: m.name })), t('rw.pl.jobs'));
  const jobsRow = h('div', { class: 'rw-ai-ctl rw-pl-ctl rw-pl-jobs', 'data-control': 'jobs' }, h('div', { class: 'rw-inline rw-pl-toggle' }, jobsToggle.el, h('span', { class: 'rw-ai-ctl-name' }, t('rw.pl.jobs'))), h('div', { class: 'note' }, t('rw.pl.jobsAux')));
  const controlsCol = h('div', { class: 'rw-ai-controls rw-pl-controls' }, ...groupEls, h('div', null, defaults));
  const recipesRow = h('div', { class: 'rw-pl-recipes' }, h('div', { class: 'rw-ai-ctl-name' }, t('rw.pl.recipe')), chipsEl, countLine, strip.el, recipeAux, thumbsLine);

  // ------------------------------------------------------------------ the preview
  const frame = h('div', { class: 'rw-ai-frame rw-pl-frame', role: 'img', 'aria-label': t('rw.pl.previewAlt') }, h('div', { class: 'note rw-ai-empty' }, t('rw.pl.starting')));
  const stateLine = h('div', { class: 'note rw-ai-state tabular rw-pl-state', role: 'status' });
  const meter = h('div', { class: 'note tabular rw-pl-meter', 'aria-label': t('rw.pl.meter') });
  const timeLine = h('div', { class: 'note tabular rw-ai-time rw-pl-time' }, t('rw.pl.timeNone'));
  const applyBtn = h('button', { type: 'button', class: 'btn btn-primary rw-pl-apply', disabled: true }, t('rw.pl.apply'));
  const cancelBtn = h('button', { type: 'button', class: 'btn rw-pl-cancel', style: 'display:none' }, t('common.cancel'));
  const applyLine = h('div', { class: 'note rw-pl-apply-line', role: 'status', 'aria-live': 'polite' });
  const baseLine = h('div', { class: 'note rw-pl-base-line' });
  const previewCol = h('div', { class: 'rw-ai-preview rw-pl-preview' }, h('div', { class: 'rw-ai-ctl-name' }, t('rw.pl.preview')), frame, stateLine, baseLine, meter, timeLine, h('div', { class: 'rw-inline' }, applyBtn, cancelBtn), applyLine, jobsRow);

  let split: SplitCompare | null = null;
  let divider = { position: 0.5, mode: 'SPLIT' as 'A' | 'B' | 'SPLIT' };
  let previewAc: AbortController | null = null;
  let timer = 0;
  let seq = 0;
  let held = false;
  const setText = (el: HTMLElement, text: string) => {
    if (el.textContent !== text) el.textContent = text;
  };
  const empty = (text: string) => {
    split?.destroy();
    split = null;
    frame.replaceChildren(h('div', { class: 'note rw-ai-empty' }, text));
  };
  const source = () => pluginSource(ui.get().results, ui.get().resultView?.id ?? null);
  const sourceName = () => ui.get().results.find((r) => r.id === source())?.name ?? t('rw.pl.base');
  const folded = () => ui.get().sections['rw.plugins'] ?? false;
  const draw = (r: PluginRunResult) => {
    split?.destroy();
    frame.style.aspectRatio = `${r.width} / ${r.height}`;
    split = splitCompare({
      a: canvasOf(r.width, r.height, r.before),
      b: canvasOf(r.width, r.height, r.after),
      labels: { a: source() ? t('rw.pl.before') : t('rw.pl.baseBefore'), b: lbl(m.name) },
      modeLabels: { a: t('rw.pl.onlyBefore'), b: t('rw.pl.onlyAfter'), split: t('split.split') },
      position: divider.position,
      mode: divider.mode,
      onPosition: (p) => (divider = { ...divider, position: p }),
      onMode: (md) => (divider = { ...divider, mode: md }),
      zoomable: false,
    });
    frame.replaceChildren(split.el);
    requestAnimationFrame(() => split?.fit());
    setText(stateLine, t('rw.pl.sizeLine', { w: r.width, h: r.height, input: t(dyn(`rw.pl.input.${r.input}`)), name: sourceName() }));
    setText(meter, infoLine(r.info.items));
    meter.style.display = r.info.items.length ? '' : 'none';
    setText(timeLine, t('rw.pl.time', { time: secondsText(r.seconds) }));
    frame.dataset.phase = source() ? 'DONE' : 'BASE';
  };
  const run = async () => {
    previewAc?.abort();
    if (folded() || held) return;
    const src = source();
    applyBtn.disabled = !src || applying !== null;
    setText(baseLine, src ? '' : t('rw.pl.baseNote'));
    // Decision 8: with no result yet the preview is the plugin's base picture (its test scene), when it has one.
    if (!src && !port.hasBase(id)) {
      empty(t('rw.pl.noResult'));
      setText(stateLine, '');
      frame.dataset.phase = 'NO_RESULT';
      return;
    }
    const ac = new AbortController();
    previewAc = ac;
    const my = ++seq;
    frame.classList.add('is-working');
    frame.dataset.phase = 'WORKING';
    setText(stateLine, t('rw.pl.working'));
    try {
      const r = await port.run({ plugin: id, result: src ?? null, maxWidth: PREVIEW_WIDTH, recipe: recipe(), controls: controls() }, ac.signal);
      if (my !== seq || ac.signal.aborted) return;
      draw(r);
    } catch (err) {
      if (isAbort(err) || my !== seq) return;
      empty(t('rw.pl.error', { reason: why(err) }));
      setText(stateLine, t('rw.pl.error', { reason: why(err) }));
      frame.dataset.phase = 'ERROR';
    } finally {
      if (my === seq) frame.classList.remove('is-working');
    }
  };
  const schedule = (delay = PREVIEW_DELAY_MS) => {
    window.clearTimeout(timer);
    // The one in flight is of settings that are no longer the ones asked for.
    previewAc?.abort();
    timer = window.setTimeout(() => void run(), delay);
  };
  scope.onDispose(() => {
    window.clearTimeout(timer);
    previewAc?.abort();
    applyAc?.abort();
  });

  // ------------------------------------------------------------------ Apply
  let applying: string | null = null;
  let applyAc: AbortController | null = null;
  applyBtn.addEventListener('click', async () => {
    const src = source();
    const meta = ui.get().results.find((r) => r.id === src);
    if (!src || !meta || applying) return;
    applying = src;
    const ac = new AbortController();
    applyAc = ac;
    applyBtn.disabled = true;
    cancelBtn.style.display = '';
    setText(applyLine, t('rw.pl.applying', { w: meta.width, h: meta.height }));
    const r0 = recipe();
    const c0 = controls();
    try {
      const r = await port.run({ plugin: id, result: src, maxWidth: null, recipe: r0, controls: c0 }, ac.signal);
      const name = presets?.presets.find((p) => p.id === r0)?.name ?? null;
      // A still, or an animation's first frame (all the history keeps of one): its seed is seed0 (decision 9).
      const out = await recordPluginResult(ctx, { source: meta, run: r, manifest: m, recipe: r0, recipeName: name, controls: c0, seed: seedProvenance(m, c0, 0) });
      setText(applyLine, t('rw.pl.applied', { name: out.name }));
      ctx.ui.toast(t('rw.pl.applied', { name: out.name }));
      ctx.ui.set({ resultView: { id: out.id, compare: meta.id, split: 'SPLIT', position: 0.5 }, renderWindow: null });
    } catch (err) {
      setText(applyLine, isAbort(err) ? t('rw.pl.applyCancelled') : t('rw.pl.applyFailed', { reason: why(err) }));
    } finally {
      applying = null;
      applyAc = null;
      cancelBtn.style.display = 'none';
      applyBtn.disabled = !source();
    }
  });
  cancelBtn.addEventListener('click', () => {
    applyAc?.abort();
    // The worker may be in the middle of a full-size render: stopped, and started again for the next preview.
    void port.stop(id).then(() => schedule(0));
  });

  // ------------------------------------------------------------------ sync
  const sync = () => {
    const values = controls();
    for (const [key, r] of rows) r.set(values[key]);
    jobsToggle.set(kept()?.jobs === true);
    syncRecipe();
  };
  let first = true;
  let previewKey = '';
  scope.watch(
    () => kept(),
    () => {
      sync();
      // A change of the recipe or a control (undo and redo included) makes the preview again; a filter does not.
      const key = JSON.stringify([recipe(), controls()]);
      if (!first && key !== previewKey) schedule();
      previewKey = key;
      first = false;
    },
  );
  scope.watch(
    (_s, u) => [source(), u.sections['rw.plugins'] ?? false] as const,
    () => schedule(0),
    (a, b) => a[0] === b[0] && a[1] === b[1],
  );
  void port
    .presets(id)
    .then((p) => {
      presets = p;
      fillRecipes();
    })
    .catch((err: unknown) => {
      strip.setCards([{ id: null, name: t('rw.pl.noRecipe'), category: t('rw.pl.noRecipeCard') }]);
      strip.select(null);
      setText(recipeAux, '');
      setText(stateLine, t('rw.pl.error', { reason: why(err) }));
    });

  return h('div', { class: 'rw-pl', 'data-plugin': id }, head, recipesRow, h('div', { class: 'rw-ai-grid rw-pl-grid' }, controlsCol, previewCol));
}

export function pluginsBody(ctx: Ctx, scope: Scope, env: PluginsSectionEnv): HTMLElement {
  const host = h('div', { class: 'rw-section rw-plugins' });
  const port = ctx.services.plugins;
  let shown = '';
  let blocks: Scope | null = null;
  scope.watch(
    (_s, u) => u.plugins,
    (snap) => {
      const list = renderPlugins(snap?.installed);
      const key = list.map((p) => `${p.id}@${p.version}:${p.sha256}`).join(',') + `|${getLang()}|${snap?.ready ? 1 : 0}`;
      if (key === shown) return;
      shown = key;
      // The blocks are rebuilt only when what is installed changes (a child scope each, disposed with them).
      blocks?.dispose();
      blocks = scope.child();
      if (!port || list.length === 0) {
        host.replaceChildren(
          h(
            'div',
            { class: 'rw-row rw-pl-none' },
            h('div', { class: 'rw-label' }, t('rw.plugins')),
            h('div', { class: 'rw-ctrl' }, h('div', { class: 'rw-inline' }, h('span', { class: 'note' }, t(snap && !snap.ready ? 'set.pl.loading' : 'rw.pl.none')), h('button', { type: 'button', class: 'btn', 'data-settings-link': 'plugins', onclick: () => cmd.openSettings(ctx, 'plugins') }, t('rw.pl.manage')))),
          ),
        );
        return;
      }
      const sc = blocks;
      host.replaceChildren(...list.map((p) => pluginBlock(ctx, sc, env, p)), h('div', { class: 'rw-inline rw-pl-foot' }, h('button', { type: 'button', class: 'btn btn-sm', 'data-settings-link': 'plugins', onclick: () => cmd.openSettings(ctx, 'plugins') }, t('rw.pl.manage'))));
    },
  );
  return host;
}
