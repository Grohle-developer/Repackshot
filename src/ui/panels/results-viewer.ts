// Results viewer (UI.md §2.8): a layer over the viewport (not a window) with
// a finished image fitted or at 100 %, zoom (wheel, + -, 0 fit, 1 100 %) and
// pan, its name and data, *Save again*, *Open folder* (only where the
// platform can), *Delete* and *Close* (Esc). *Compare with…* puts an earlier
// result next to it with the split-compare divider. A result that went through
// the AI post-processing (X4) opens as Render against AI under the same divider,
// with the guard's report in one line, and both images can be saved. With several
// AI variants (X4b) a strip of their thumbnails under the header chooses the one
// the divider compares with the render (its own report on the line), and *Save
// this variant* and *Save all* save it or every one under its name.

import { aiImagesOf, aiVariantsOf, compareCandidates, type AiResultInfo, type ResultMeta } from '../../core/results';
import { reportDetails, reportText } from '../ai-report';
import * as cmd from '../commands';
import { splitCompare, type SplitCompare, type SplitImage } from '../components/split-compare';
import { openMenu } from '../components/widgets';
import { h, icon, isTyping } from '../dom';
import type { Ctx, Scope } from '../reactive';
import { formatClock, formatNumber, getLang, t } from '../strings';

async function bitmap(blob: Blob | null | undefined): Promise<SplitImage | null> {
  if (!blob) return null;
  try {
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

/**
 * The images of a result: the engine's (what the browser can show), and the AI's when it has one: `variant` (1-based,
 * X4b), and a way to decode any other variant when it is chosen.
 */
async function decode(ctx: Ctx, id: string, variant = 1): Promise<{ render: SplitImage | null; ai: SplitImage | null; variant: (n: number) => Promise<SplitImage | null> }> {
  const blobs = await ctx.services.results.get(id);
  if (!blobs) return { render: null, ai: null, variant: async () => null };
  const list = [blobs.ai ?? null, ...(blobs.aiMore ?? [])];
  const cache = new Map<number, Promise<SplitImage | null>>();
  const of = (n: number) => {
    if (!cache.has(n)) cache.set(n, bitmap(list[n - 1]));
    return cache.get(n)!;
  };
  return { render: await bitmap(blobs.display ?? blobs.file), ai: await of(variant), variant: of };
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
  // The AI images exist when the guard let one through (bytes): a REJECTED variant keeps its report and no image.
  const variants: AiResultInfo[] = meta ? aiVariantsOf(meta) : [];
  const images = meta ? aiImagesOf(meta) : [];
  const several = variants.length > 1;
  const hasAi = images.length > 0;
  /** The variant the divider compares with the render (X4b): the one chosen, else the first with an image. */
  let chosen = images.find((i) => i.variant === v0.variant)?.variant ?? images[0]?.variant ?? 1;
  const saveBtn = h('button', { type: 'button', class: 'btn', onclick: () => meta && void cmd.saveResultAgain(ctx, meta.id) }, icon('download', 14), hasAi ? t('rv.saveRender') : t('rv.saveAgain'));
  const saveAiBtn = hasAi ? h('button', { type: 'button', class: 'btn', 'data-save': 'ai', onclick: () => meta && void cmd.saveResultAgain(ctx, meta.id, 'AI', chosen) }, icon('download', 14), several ? t('rv.saveVariant') : t('rv.saveAi')) : null;
  const saveAllBtn = images.length > 1 ? h('button', { type: 'button', class: 'btn', 'data-save': 'all', 'data-tip': t('rv.saveAllTip', { n: images.length }), onclick: () => meta && void cmd.saveAllVariants(ctx, meta.id) }, icon('download', 14), t('rv.saveAll')) : null;
  // The guard's report (AI-POST.md §4): what was checked, and what the guard did. Its own line under the title and
  // the toolbar, the whole width, one line; where it does not fit it ends in an ellipsis and the tooltip has it all,
  // with what ran. With several variants, the chosen one's (X4b).
  const reportEl = variants.length > 0 ? h('div', { class: 'rv-report' }) : null;
  const showReport = () => {
    const info = variants[chosen - 1] ?? variants[0];
    if (!reportEl || !info) return;
    const report = reportText(info.report);
    const prefix = several ? t('rv.variantN', { n: chosen }) : '';
    reportEl.dataset.verdict = info.report.verdict;
    reportEl.title = `${[prefix, report.checked, report.note].filter(Boolean).join(' · ')}\n${reportDetails(info.report, info.report.modelKey)}`;
    reportEl.replaceChildren(
      ...(several ? [h('span', { class: 'rv-report-variant tabular' }, prefix)] : []),
      ...(report.checked ? [h('span', { class: 'rv-report-checked tabular' }, report.checked)] : []),
      ...(report.note ? [h('span', { class: `rv-report-note${info.report.verdict === 'REJECTED' ? ' is-rejected' : ''}` }, report.note)] : []),
    );
  };
  showReport();
  // The strip of variants (X4b): one thumbnail each, the chosen one pressed; a rejected one says so and has no image.
  let pickVariant: (n: number) => void = () => undefined;
  const strip = several
    ? h(
        'div',
        { class: 'rv-strip', role: 'radiogroup', 'aria-label': t('rv.variants') },
        h('span', { class: 'aux rv-strip-label' }, t('rv.variants')),
        ...variants.map((v, i) => {
          const n = i + 1;
          const rejected = v.bytes <= 0;
          return h(
            'button',
            {
              type: 'button',
              class: `rv-variant${rejected ? ' is-rejected' : ''}`,
              role: 'radio',
              'aria-checked': String(n === chosen),
              'aria-label': rejected ? t('rv.variantRejected', { n }) : t('rv.variantN', { n }),
              'data-variant': n,
              'data-tip': rejected ? t('rv.variantRejected', { n }) : `${t('rv.variantN', { n })} · ${t('rv.seed', { seed: v.report.seed })}`,
              disabled: rejected,
              onclick: () => pickVariant(n),
            },
            v.thumb ? h('img', { src: v.thumb, alt: '' }) : h('span', { class: 'rv-variant-none' }, icon('close', 12)),
            h('span', { class: 'rv-variant-n tabular' }, String(n)),
          );
        }),
      )
    : null;
  // Where the image went, in the file manager (the desktop: with the file selected; Downloads too).
  const files = ctx.services.files;
  const folderId = meta?.savedTo.kind === 'FOLDER' ? meta.savedTo.id : meta && files.canOpenDownloads ? 'downloads' : null;
  const folderBtn =
    files.canOpenFolder && meta && folderId
      ? h(
          'button',
          {
            type: 'button',
            class: 'btn',
            onclick: () =>
              void files.openFolder(folderId, meta.name).catch((err: unknown) => {
                console.warn(`open folder: ${err instanceof Error ? err.message : String(err)}`);
                ctx.ui.toast(t('set.st.openFolderFailed'));
              }),
          },
          icon('folder', 14),
          t('rv.openFolder'),
        )
      : null;
  const deleteBtn = h('button', { type: 'button', class: 'btn', 'data-tip': t('rv.deleteTip'), onclick: () => meta && void cmd.deleteResult(ctx, meta.id) }, icon('trash', 14), t('common.delete'));
  const closeBtn = h('button', { type: 'button', class: 'icon-btn rv-close', 'aria-label': t('common.close'), 'data-tip': t('common.close'), 'data-kbd': t('key.escape'), onclick: () => cmd.closeResult(ctx) }, icon('close'));
  const memory = h('div', { class: 'note rv-memory' }, t('queue.storageMemory'));
  scope.watch((_s, u) => u.resultsStorage, (st) => (memory.style.display = st === 'MEMORY' ? '' : 'none'));

  const el = h(
    'div',
    { class: 'rv', role: 'region', 'aria-label': t('rv.label') },
    h(
      'div',
      { class: 'rv-head' },
      // The title block and the toolbar share a line while both fit; otherwise the toolbar goes under the title.
      // Close stays in the corner.
      h(
        'div',
        { class: 'rv-top' },
        h('div', { class: 'rv-info' }, title, data, memory),
        h('div', { class: 'rv-actions' }, compareBtn, h('span', { class: 'rv-sep' }), fitBtn, actualBtn, zoomText, h('span', { class: 'rv-sep' }), saveBtn, saveAiBtn, saveAllBtn, folderBtn, deleteBtn),
      ),
      reportEl,
      closeBtn,
    ),
    strip,
    frame,
  );

  // The images arrive from the history (blobs), then the split takes them.
  void (async () => {
    if (!meta) {
      frame.replaceChildren(h('div', { class: 'note rv-loading' }, t('rv.missing')));
      return;
    }
    const [mine, theirs] = await Promise.all([decode(ctx, meta.id, chosen), other ? decode(ctx, other.id) : Promise.resolve(null)]);
    const a = mine.render;
    if (!a) {
      frame.replaceChildren(h('div', { class: 'note rv-loading' }, t('rv.missing')));
      return;
    }
    // Render against AI by default; another result chosen to compare with takes the AI's place.
    const versusAi = !theirs && mine.ai !== null;
    const b = theirs ? theirs.render : mine.ai;
    const v = ui.get().resultView;
    const aiLabel = (n: number) => (several ? t('rv.labelAiN', { n }) : t('rv.labelAi'));
    // Another variant: the divider compares it with the render, where it was, at the same zoom (X4b).
    pickVariant = (n) => {
      if (n === chosen || !images.some((i) => i.variant === n)) return;
      chosen = n;
      strip?.querySelectorAll<HTMLElement>('.rv-variant').forEach((el) => el.setAttribute('aria-checked', String(Number(el.dataset.variant) === n)));
      showReport();
      const cur = ui.get().resultView;
      if (cur) ui.set({ resultView: { ...cur, variant: n } });
      void mine.variant(n).then((img) => {
        if (img && chosen === n && versusAi) split?.setB(img, aiLabel(n));
      });
    };
    split = splitCompare({
      a,
      b,
      labels: versusAi ? { a: t('rv.labelRender'), b: aiLabel(chosen) } : { a: meta.name, b: other?.name ?? '' },
      ...(versusAi ? { modeLabels: { a: t('rv.onlyRender'), b: t('rv.onlyAi'), split: t('split.split') } } : {}),
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
