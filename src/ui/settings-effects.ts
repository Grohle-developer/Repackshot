// What the settings change outside the Settings window, applied at once and
// whenever they change (UI.md §2.9): the display tokens of Accessibility
// (interface size, text size, high contrast, motion, focus) on the root
// element, the tooltip delay, the viewport's navigation and drawing, the
// engine (pool size, SIMD build, gesture resolution, Full mode's limit), the
// results history's limits, and an aria-live region that announces render
// progress to screen readers.

import type { RenderJob } from '../core/render';
import { displayTokens, historyLimits, type Settings } from '../core/settings';
import * as cmd from './commands';
import { setTooltipDelay } from './components/widgets';
import { h } from './dom';
import { jobFileNames } from './render-queue';
import type { Ctx } from './reactive';
import { t } from './strings';

/** The attributes and custom properties of Accessibility on an element (the document's root). */
export function applyDisplay(root: HTMLElement, s: Settings): void {
  const d = displayTokens(s);
  for (const [k, v] of Object.entries(d.vars)) root.style.setProperty(k, v);
  for (const [k, v] of Object.entries(d.attrs)) root.setAttribute(k, v);
}

/** What the announcer says for a job, if anything new: start, every quarter, end. `name` is its file name. */
export function announcement(job: RenderJob, name: string, lastQuarter: number): { text: string; quarter: number } | null {
  if (job.status === 'DONE') return lastQuarter >= 5 ? null : { text: t('a11y.renderDone', { name }), quarter: 5 };
  if (job.status === 'FAILED') return lastQuarter >= 5 ? null : { text: t('a11y.renderFailed', { name }), quarter: 5 };
  if (job.status !== 'RUNNING') return null;
  const q = Math.min(3, Math.floor((job.progress ?? 0) * 4));
  if (lastQuarter < 0) return { text: t('a11y.renderStart', { name }), quarter: q };
  if (q > lastQuarter && q >= 1) return { text: t('a11y.renderProgress', { name, pct: q * 25 }), quarter: q };
  return null;
}

export function installSettingsEffects(ctx: Ctx): () => void {
  const { ui, services } = ctx;
  const offs: (() => void)[] = [];
  const root = document.documentElement;

  let prev: Settings | null = null;
  const apply = (s: Settings) => {
    const changed = (keys: readonly (keyof Settings)[]) => prev === null || keys.some((k) => prev![k] !== s[k]);
    applyDisplay(root, s);
    setTooltipDelay(s['a11y.tooltipDelay']);
    if (changed(['viewport.mouse', 'viewport.invertZoom', 'viewport.orbitSpeed', 'viewport.zoomSpeed'])) {
      services.viewport?.setNavigation({ mouse: s['viewport.mouse'], invertZoom: s['viewport.invertZoom'], orbitSpeed: s['viewport.orbitSpeed'] / 100, zoomSpeed: s['viewport.zoomSpeed'] / 100 });
    }
    if (changed(['viewport.floorGrid', 'viewport.gizmoSize'])) services.viewport?.setDisplay({ floorGrid: s['viewport.floorGrid'], gizmoScale: s['viewport.gizmoSize'] / 100 });
    if (changed(['engine.backend', 'engine.threads', 'engine.simd', 'viewport.gestureResolution', 'engine.viewportLimit', 'engine.viewportSamples', 'engine.viewportSeconds'])) {
      services.engine.configure({
        backend: s['engine.backend'],
        threads: s['engine.threads'],
        simd: s['engine.simd'],
        gestureResolution: s['viewport.gestureResolution'],
        viewportLimit: { by: s['engine.viewportLimit'], samples: s['engine.viewportSamples'], seconds: s['engine.viewportSeconds'] },
      });
    }
    if (prev !== null && changed(['storage.historyCount', 'storage.historyMB']) && services.results.setLimits) {
      void services.results.setLimits(historyLimits(s)).then((evicted) => {
        if (evicted.length > 0) void cmd.loadResults(ctx);
      });
    }
    // Hovering parts in the viewport outlines them only when asked.
    if (!s['selection.hoverOutline'] && ui.get().hover) ui.set({ hover: null });
    prev = s;
  };
  apply(ui.get().settings);
  offs.push(ui.subscribe((u, p) => u.settings !== p.settings && apply(u.settings)));

  // Render progress for screen readers: a polite live region, fed by the queue.
  const live = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true', 'data-announcer': '' });
  document.body.appendChild(live);
  offs.push(() => live.remove());
  // What was already there when the page opened is not news.
  const quarters = new Map<string, number>(ctx.store.get().render.queue.map((j) => [j.id, j.status === 'RUNNING' ? Math.floor(j.progress * 4) : 5]));
  offs.push(
    ctx.store.subscribe((s, p) => {
      if (s.render.queue === p.render.queue && s.render.running === p.render.running) return;
      if (!ui.get().settings['a11y.announceRender']) return;
      for (const job of s.render.queue) {
        if (job.status === 'QUEUED' || job.status === 'CANCELLED') continue;
        const a = announcement(job, jobFileNames(s, job)[0] ?? job.settings.name, quarters.get(job.id) ?? -1);
        if (!a) continue;
        quarters.set(job.id, a.quarter);
        live.textContent = a.text;
      }
    }),
  );
  return () => offs.forEach((f) => f());
}
