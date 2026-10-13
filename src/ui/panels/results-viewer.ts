// Results viewer (UI.md §2.8): a layer over the viewport (not a window) with
// a finished image fitted or at 100 %, zoom (wheel, + -, 0 fit, 1 100 %) and
// pan, its name and data, *Save again*, *Open folder* (only where the
// platform can), *Delete* and *Close* (Esc). *Compare with…* puts an earlier
// result next to it with the split-compare divider (the component X3 reuses
// for Render against AI).

import { compareCandidates, type ResultMeta } from '../../core/results';
import * as cmd from '../commands';
import { splitCompare, type SplitCompare, type SplitImage } from '../components/split-compare';
import { openMenu } from '../components/widgets';
import { h, icon, isTyping } from '../dom';
import type { Ctx, Scope } from '../reactive';
import { formatClock, formatNumber, getLang, t } from '../strings';

async function decode(ctx: Ctx, id: string): Promise<SplitImage | null> {
  const blobs = await ctx.services.results.get(id);
  if (!blobs) return null;
  const blob = blobs.display ?? blobs.file;
  try {
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

/** "1920 × 1080 · 300 DPI · 256 samples · 1:24 · Camera 1" */
export function resultData(r: ResultMeta): string {
  const lang = getLang();
  const parts = [`${r.width} × ${r.height}`, `${r.dpi} ${t('rw.dpiUnit')}`, t('rw.summarySamples', { n: formatNumber(r.samples, lang, 0) }), formatClock(r.seconds), r.camera];
  if (r.frames) parts.push(t('rv.frameOf', { i: r.frame ?? 1, n: r.frames }));
  return parts.join(' · ');
}

function timeOf(ms: number): string {
  try {
    return new Intl.DateTimeFormat(getLang() === 'es' ? 'es-ES' : 'en-GB', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }).format(new Date(ms));
  } catch {
    return '';
  }
}

export function resultsViewer(ctx: Ctx, scope: Scope): HTMLElement {
  const { ui } = ctx;
  const v0 = ui.get().resultView!;
  const meta = ui.get().results.find((r) => r.id === v0.id);
  const other = v0.compare ? ui.get().results.find((r) => r.id === v0.compare) : undefined;
  const title = h('div', { class: 'rv-title' }, meta?.name ?? '');
  const data = h('div', { class: 'aux tabular rv-data' }, meta ? resultData(meta) : '');
  const zoomText = h('span', { class: 'aux tabular rv-zoom' });
  const frame = h('div', { class: 'rv-frame' }, h('div', { class: 'note rv-loading' }, '…'));
  let split: SplitCompare | null = null;

  const compareBtn = h('button', { type: 'button', class: 'btn', 'aria-haspopup': 'menu', 'data-tip': t('rv.compareTip') }, icon('duplicate', 14), t('rv.compare'));
  compareBtn.addEventListener('click', () => {
    if (!meta) return;
    const list = compareCandidates(ui.get().results, meta).slice(0, 12);
    const v = ui.get().resultView;
    openMenu(compareBtn, [
      ...(list.length === 0 ? [{ label: t('rv.noCompare'), disabled: true }] : []),
      ...list.map((r) => ({ label: `${r.name} · ${timeOf(r.createdAt)}`, checked: v?.compare === r.id, run: () => ui.set({ resultView: { ...ui.get().resultView!, compare: r.id, split: 'SPLIT' } }) })),
      ...(v?.compare ? [null, { label: t('rv.stopCompare'), run: () => ui.set({ resultView: { ...ui.get().resultView!, compare: null } }) }] : []),
    ]);
  });
  const fitBtn = h('button', { type: 'button', class: 'btn btn-sm', 'data-kbd': '0', onclick: () => split?.fit() }, t('rv.fit'));
  const actualBtn = h('button', { type: 'button', class: 'btn btn-sm', 'data-kbd': '1', onclick: () => split?.actual() }, '100 %');
  const saveBtn = h('button', { type: 'button', class: 'btn', onclick: () => meta && void cmd.saveResultAgain(ctx, meta.id) }, icon('download', 14), t('rv.saveAgain'));
  const folderBtn =
    ctx.services.files.canOpenFolder && meta?.savedTo.kind === 'FOLDER'
      ? h('button', { type: 'button', class: 'btn', onclick: () => meta.savedTo.kind === 'FOLDER' && void ctx.services.files.openFolder(meta.savedTo.id) }, icon('folder', 14), t('rv.openFolder'))
      : null;
  const deleteBtn = h('button', { type: 'button', class: 'btn', 'data-tip': t('rv.deleteTip'), onclick: () => meta && void cmd.deleteResult(ctx, meta.id) }, icon('trash', 14), t('common.delete'));
  const closeBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('common.close'), 'data-tip': t('common.close'), 'data-kbd': t('key.escape'), onclick: () => cmd.closeResult(ctx) }, icon('close'));
  const memory = h('div', { class: 'note rv-memory' }, t('queue.storageMemory'));
  scope.watch((_s, u) => u.resultsStorage, (st) => (memory.style.display = st === 'MEMORY' ? '' : 'none'));

  const el = h(
    'div',
    { class: 'rv', role: 'region', 'aria-label': t('rv.label') },
    h(
      'div',
      { class: 'rv-head' },
      h('div', { class: 'rv-info' }, title, data, memory),
      h('div', { class: 'rv-actions' }, compareBtn, h('span', { class: 'rv-sep' }), fitBtn, actualBtn, zoomText, h('span', { class: 'rv-sep' }), saveBtn, folderBtn, deleteBtn, closeBtn),
    ),
    frame,
  );

  // The images arrive from the history (blobs), then the split takes them.
  void (async () => {
    if (!meta) {
      frame.replaceChildren(h('div', { class: 'note rv-loading' }, t('rv.missing')));
      return;
    }
    const [a, b] = await Promise.all([decode(ctx, meta.id), other ? decode(ctx, other.id) : Promise.resolve(null)]);
    if (!a) {
      frame.replaceChildren(h('div', { class: 'note rv-loading' }, t('rv.missing')));
      return;
    }
    const v = ui.get().resultView;
    split = splitCompare({
      a,
      b,
      labels: { a: meta.name, b: other?.name ?? '' },
      mode: v?.split ?? 'SPLIT',
      position: v?.position ?? 0.5,
      onPosition: (position) => {
        const cur = ui.get().resultView;
        if (cur) ui.set({ resultView: { ...cur, position } });
      },
      onMode: (split) => {
        const cur = ui.get().resultView;
        if (cur) ui.set({ resultView: { ...cur, split } });
      },
      onView: (view, fitted) => (zoomText.textContent = fitted ? t('rv.fitted', { pct: Math.round(view.scale * 100) }) : `${Math.round(view.scale * 100)} %`),
    });
    frame.replaceChildren(split.el);
    el.dataset.ready = '1';
    requestAnimationFrame(() => split?.fit());
  })();
  scope.onDispose(() => split?.destroy());

  // Its keys while it is open: Esc closes, + - zoom, 0 fits, 1 is 100 %.
  const onKey = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || e.isComposing || isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const u = ui.get();
    if (u.paletteOpen || u.renderWindow || document.querySelector('.floating')) return;
    const act = (fn: () => void) => {
      e.preventDefault();
      e.stopPropagation();
      fn();
    };
    if (e.key === 'Escape') act(() => cmd.closeResult(ctx));
    else if (e.key === '+' || e.key === '=') act(() => split?.zoom(1.25));
    else if (e.key === '-' || e.key === '_') act(() => split?.zoom(0.8));
    else if (e.key === '0') act(() => split?.fit());
    else if (e.key === '1') act(() => split?.actual());
  };
  document.addEventListener('keydown', onKey, true);
  scope.onDispose(() => document.removeEventListener('keydown', onKey, true));
  return el;
}
