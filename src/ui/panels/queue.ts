// Queue drawer (UI.md §2.5): the jobs in order (thumbnail, name, camera,
// size, finish by, AI, status and progress), dragged to reorder (or Alt ↑ ↓),
// each with Edit (the render window with its settings and Save changes),
// Duplicate and Remove (Stop while it runs); Start queue / Pause / Resume and
// Clear finished at the top. Finished jobs keep their thumbnail and open the
// results viewer. On the right, the results history (newest first) with
// Clear history; when the browser keeps no storage, it says so.

import type { RenderJob, RenderProgress, RenderSettings } from '../../core/render';
import { aiImagesOf, aiVariantsOf, type ResultMeta } from '../../core/results';
import * as cmd from '../commands';
import { h, icon } from '../dom';
import { cameraName, dyn } from '../names';
import type { Ctx, Scope } from '../reactive';
import { jobFileNames, jobFrames } from '../render-queue';
import type { QueueRun } from '../ui-state';
import { formatClock, formatNumber, framesText, getLang, t } from '../strings';

function finishByText(s: RenderSettings): string {
  const n = t('rw.summarySamples', { n: formatNumber(s.maxSamples, getLang(), 0) });
  return s.finishBy === 'SAMPLES' ? n : s.finishBy === 'TIME' ? formatClock(s.maxSeconds) : t('rw.summaryOr', { a: n, b: formatClock(s.maxSeconds) });
}

function sizeText(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${formatNumber(mb, getLang(), 1)} MB` : `${formatNumber(bytes / 1024, getLang(), 0)} kB`;
}

/** The drawer's Start queue / Pause / Resume button for the queue's state. */
export function queueButton(run: QueueRun, waiting: boolean): { state: 'START' | 'PAUSE' | 'RESUME'; label: 'queue.start' | 'queue.pause' | 'queue.resume'; tip: 'queue.startTip' | 'queue.pauseTip' | 'queue.resumeTip'; icon: 'play' | 'pause'; disabled: boolean } {
  if (run === 'ALL' || run === 'ONLY') return { state: 'PAUSE', label: 'queue.pause', tip: 'queue.pauseTip', icon: 'pause', disabled: false };
  if (run === 'PAUSED' && waiting) return { state: 'RESUME', label: 'queue.resume', tip: 'queue.resumeTip', icon: 'play', disabled: false };
  return { state: 'START', label: 'queue.start', tip: 'queue.startTip', icon: 'play', disabled: !waiting };
}

/**
 * Where the AI post-processing of the job in flight is (X3c): "AI · tile 2 of 4", "· attempt 2" after a retry; with
 * several variants (X4b), which one: "AI · variant 2 of 4 · tile 3 of 4".
 */
export function aiStatusText(ai: NonNullable<RenderProgress['ai']>): string {
  const i = Math.max(1, ai.tile);
  const n = Math.max(1, ai.tiles);
  if (ai.variants && ai.variants > 1) {
    const step = ai.stage === 'LOADING' ? t('queue.aiStep.loading') : ai.stage === 'GUARD' ? t('queue.aiStep.guard') : ai.attempt > 1 ? t('queue.aiStep.tileRetry', { i, n, a: ai.attempt }) : t('queue.aiStep.tile', { i, n });
    return t('queue.aiVariant', { v: Math.max(1, ai.variant ?? 1), m: ai.variants, step });
  }
  if (ai.stage === 'LOADING') return t('queue.aiLoading');
  if (ai.stage === 'GUARD') return t('queue.aiGuard');
  return ai.attempt > 1 ? t('queue.aiTileRetry', { i, n, a: ai.attempt }) : t('queue.aiTile', { i, n });
}

/** A small count over a thumbnail: how many AI images a result has, when more than one (X4b). */
function variantBadge(r: ResultMeta): HTMLElement | null {
  const n = aiImagesOf(r).length;
  return n > 1 ? h('span', { class: 'variant-count tabular', 'data-variants': n, 'aria-label': t('queue.aiImages', { n }) }, `×${n}`) : null;
}

/** The status line of a job: its frame while an animation renders, where the AI is while it runs, else the status. */
function statusTextOf(j: RenderJob, running: RenderProgress | null): string {
  if (j.status === 'RUNNING' && running?.jobId === j.id && running.ai) return aiStatusText(running.ai);
  if (j.status === 'RUNNING' && j.settings.mode === 'ANIMATION' && j.frames > 0) return t('queue.frameOf', { i: j.frame || 1, n: j.frames });
  return t(dyn(`queue.status.${j.status}`));
}

export function queueDrawer(ctx: Ctx, scope: Scope): HTMLElement {
  const { store } = ctx;
  const startBtn = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => cmd.toggleQueue(ctx) });
  const clearBtn = h('button', { type: 'button', class: 'btn', onclick: () => cmd.clearFinished(ctx) }, t('queue.clearFinished'));
  const list = h('div', { class: 'queue-list', role: 'list', 'aria-label': t('render.queue') });
  const memory = h('span', { class: 'note queue-memory' }, t('queue.storageMemory'));
  scope.watch((_s, u) => u.resultsStorage, (st) => (memory.style.display = st === 'MEMORY' ? '' : 'none'));

  // Drag to reorder: the row under the pointer says where the dragged job goes.
  let dragging: string | null = null;
  const row = (j: RenderJob, index: number, results: readonly ResultMeta[]): HTMLElement => {
    const s = store.get();
    const running = j.status === 'RUNNING';
    const finished = j.status === 'DONE' || j.status === 'FAILED' || j.status === 'CANCELLED';
    const result = j.resultIds.map((id) => results.find((r) => r.id === id)).find(Boolean);
    const anim = j.settings.mode === 'ANIMATION';
    // An animation is named by its first frame, and counts the frames of its range.
    const name = `${jobFileNames(s, j)[0] ?? ''}${anim ? '…' : ''}`;
    const frameCount = j.frames || jobFrames(s, j.settings).length;
    const cam = j.settings.camera.kind === 'ONE' ? s.camera.cameras[j.settings.camera.id] : undefined;
    // A result that went through the AI shows both pictures: the engine's and the AI's (its first image), side by side,
    // and how many AI images it has when there are several (X4b).
    const aiThumb = result ? aiImagesOf(result)[0]?.info.thumb : undefined;
    const aiCount = result ? aiImagesOf(result).length : 0;
    const pic = result?.thumb
      ? aiThumb
        ? h(
            'span',
            { class: 'queue-pics', 'data-tip': aiCount > 1 ? t('queue.aiImagesTip', { n: aiCount }) : t('queue.aiPair') },
            h('img', { src: result.thumb, alt: '', class: 'queue-pic' }),
            h('img', { src: aiThumb, alt: '', class: 'queue-pic queue-pic-ai' }),
            variantBadge(result),
          )
        : h('img', { src: result.thumb, alt: '', class: 'queue-pic' })
      : h('span', { class: 'queue-pic queue-pic-empty' }, icon(anim ? 'film' : 'camera', 14));
    const statusText = statusTextOf(j, s.render.running);
    const act = (label: string, iconName: 'edit' | 'duplicate' | 'close' | 'stop', fn: () => void, disabled = false) =>
      h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': label, 'data-tip': label, disabled, onclick: (e: MouseEvent) => (e.stopPropagation(), fn()) }, icon(iconName, 14));
    const el = h(
      'div',
      {
        class: `queue-row${running ? ' is-running' : ''}${finished ? ' is-finished' : ''}`,
        role: 'listitem',
        tabindex: 0,
        draggable: running ? undefined : 'true',
        'data-job': j.id,
        'data-status': j.status,
        'data-tip': result ? t('queue.openResult') : undefined,
        onclick: () => result && cmd.openResult(ctx, result.id),
      },
      h('span', { class: 'queue-grip', 'data-tip': t('queue.dragTip') }, icon('grip', 14)),
      pic,
      h('span', { class: 'queue-name', title: name }, name),
      h('span', { class: 'aux' }, anim ? t('queue.timeline') : cam ? cameraName(s, cam) : '—'),
      h('span', { class: 'tabular' }, anim ? `${j.settings.width} × ${j.settings.height} · ${framesText(frameCount)}` : `${j.settings.width} × ${j.settings.height}`),
      h('span', { class: 'tabular' }, finishByText(j.settings)),
      h('span', { class: 'aux' }, !j.settings.ai.enabled ? t('queue.aiNo') : j.settings.ai.variants > 1 && !anim ? t('queue.aiVariants', { n: j.settings.ai.variants }) : t('queue.aiYes')),
      h('span', { class: `queue-status${j.status === 'FAILED' ? ' warn-text' : ''}`, title: j.error ?? '' }, statusText, h('div', { class: 'bar-meter' }, h('div', { style: `width:${Math.round(j.progress * 100)}%` }))),
      h(
        'span',
        { class: 'queue-actions' },
        act(t('queue.edit'), 'edit', () => cmd.editJob(ctx, j.id), running),
        act(t('common.duplicate'), 'duplicate', () => cmd.duplicateJob(ctx, j.id)),
        running ? act(t('queue.stopJob'), 'stop', () => cmd.stopJob(ctx, j.id)) : act(t('common.remove'), 'close', () => cmd.removeJob(ctx, j.id)),
      ),
    );
    el.addEventListener('dragstart', (e) => {
      dragging = j.id;
      el.classList.add('is-dragging');
      e.dataTransfer?.setData('application/x-repackshot-job', j.id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => {
      dragging = null;
      el.classList.remove('is-dragging');
      list.querySelectorAll('.drop-before, .drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
    });
    el.addEventListener('dragover', (e) => {
      if (!dragging || dragging === j.id) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      el.classList.toggle('drop-after', after);
      el.classList.toggle('drop-before', !after);
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-before', 'drop-after'));
    el.addEventListener('drop', (e) => {
      if (!dragging || dragging === j.id) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      const from = store.get().render.queue.findIndex((x) => x.id === dragging);
      let to = index + (after ? 1 : 0);
      if (from < to) to--;
      cmd.moveJob(ctx, dragging, to);
    });
    // The keyboard way: Alt ↑ / Alt ↓.
    el.addEventListener('keydown', (e) => {
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        e.stopPropagation();
        cmd.moveJob(ctx, j.id, index + (e.key === 'ArrowUp' ? -1 : 1));
        requestAnimationFrame(() => (list.querySelector(`[data-job="${j.id}"]`) as HTMLElement | null)?.focus());
      } else if (e.key === 'Enter' && result) {
        e.preventDefault();
        cmd.openResult(ctx, result.id);
      }
    });
    return el;
  };

  // Progress ticks only move the bars; anything else rebuilds the rows (a drag in progress survives the ticks).
  let shape: unknown[] = [];
  const shapeOf = (queue: readonly RenderJob[], results: readonly ResultMeta[], run: string): unknown[] => [run, results, store.get().camera, ...queue.flatMap((j) => [j.id, j.settings, j.status, j.resultIds, j.error, j.frames])];
  scope.watch(
    (s, u) => [s.render.queue, u.results, u.queueRun] as const,
    ([queue, results, run]) => {
      // One button: Pause while it runs, Resume after a Pause, Start queue otherwise; nothing to start, disabled.
      const waiting = queue.some((j) => j.status === 'QUEUED');
      const state = queueButton(run, waiting);
      startBtn.replaceChildren(icon(state.icon, 14), t(state.label));
      startBtn.setAttribute('data-tip', t(state.tip));
      startBtn.setAttribute('data-queue-state', state.state);
      startBtn.disabled = state.disabled;
      clearBtn.disabled = !queue.some((j) => j.status === 'DONE' || j.status === 'FAILED' || j.status === 'CANCELLED');
      const next = shapeOf(queue, results, run);
      const same = next.length === shape.length && next.every((v, i) => v === shape[i]);
      shape = next;
      if (same) {
        for (const j of queue) {
          const el = list.querySelector(`[data-job="${j.id}"]`);
          const bar = el?.querySelector('.bar-meter > div') as HTMLElement | null;
          if (bar) bar.style.width = `${Math.round(j.progress * 100)}%`;
          const st = el?.querySelector('.queue-status')?.firstChild;
          if (st && j.status === 'RUNNING') st.textContent = statusTextOf(j, store.get().render.running);
        }
        return;
      }
      if (queue.length === 0) {
        list.replaceChildren(h('p', { class: 'note', style: 'padding:12px var(--pad)' }, t('queue.empty')));
        return;
      }
      list.replaceChildren(...queue.map((j, i) => row(j, i, results)));
    },
    (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2],
  );

  // The history: every result kept in the browser, newest first.
  const history = h('div', { class: 'history-list' });
  const historyHead = h('div', { class: 'aux tabular' });
  const clearHistory = h('button', { type: 'button', class: 'btn btn-sm', onclick: () => void cmd.clearHistory(ctx) }, t('queue.clearHistory'));
  scope.watch(
    (_s, u) => u.results,
    (results) => {
      historyHead.textContent = t('queue.historyCount', { n: results.length, size: sizeText(results.reduce((n, r) => n + r.bytes, 0)) });
      clearHistory.disabled = results.length === 0;
      history.replaceChildren(
        ...(results.length === 0
          ? [h('p', { class: 'note' }, t('queue.historyEmpty'))]
          : results.map((r) => {
              const first = aiImagesOf(r)[0]?.info;
              const n = aiVariantsOf(r).length;
              return h(
                'button',
                { type: 'button', class: `history-item${first?.thumb ? ' history-pair' : ''}`, 'data-result': r.id, 'data-tip': `${r.name} · ${r.width} × ${r.height}${n > 1 ? ` · ${t('queue.aiImages', { n: aiImagesOf(r).length })}` : ''}`, onclick: () => cmd.openResult(ctx, r.id) },
                r.thumb ? h('img', { src: r.thumb, alt: r.name }) : h('span', { class: 'queue-pic-empty' }, icon('camera', 14)),
                first?.thumb ? h('img', { src: first.thumb, alt: first.name }) : null,
                variantBadge(r),
              );
            })),
      );
    },
  );

  return h(
    'div',
    { class: 'queue' },
    h(
      'div',
      { class: 'queue-main' },
      h('div', { class: 'queue-head' }, h('span', { class: 'field-label', style: 'font-weight:600' }, t('render.queue')), memory, h('span', { style: 'flex:1' }), clearBtn, startBtn),
      list,
    ),
    h(
      'div',
      { class: 'queue-history', 'data-guide': 'history' },
      h('div', { class: 'queue-head' }, h('span', { class: 'field-label', style: 'font-weight:600' }, t('queue.history')), historyHead, h('span', { style: 'flex:1' }), clearHistory),
      history,
    ),
  );
}
