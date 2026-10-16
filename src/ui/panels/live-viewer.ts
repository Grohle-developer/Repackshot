// Live view (U14, UI.md §2.5 and §2.8): the results viewer's "in progress" mode, a layer over the viewport like the
// results viewer, opened by a click on a queue row that renders or waits. While the job renders it shows its picture
// as the engine accumulates it (`ui.liveFrame`, made at the queue's cadence and scaled to fit this layer), with the
// engine's samples and seconds and the job's status; a job that waits says it has not started, and its picture comes
// when it does. When the job ends with a result, the queue opens that result here (render-queue.ts); Close or Esc
// closes it, and no more pictures are made.

import type { LiveFrame } from '../../core/live-frame';
import type { RenderJob } from '../../core/render';
import type { ProjectState } from '../../core/store';
import * as cmd from '../commands';
import { h, icon, isTyping } from '../dom';
import { cameraName } from '../names';
import type { Ctx, Scope } from '../reactive';
import { jobFileNames } from '../render-queue';
import { formatClock, formatNumber, getLang, t } from '../strings';
import type { UiState } from '../ui-state';
import { statusTextOf } from './queue';

/** What the live view shows, from the state alone (tests read it without a DOM). */
export interface LiveViewModel {
  job: RenderJob;
  /**
   * WAITING: not started (a line says so, no picture); STARTING: rendering, no picture yet; LIVE: its picture;
   * FAILED, STOPPED: it ended without a result (a line says why); DONE: it ended (its result opens in its place).
   */
  kind: 'WAITING' | 'STARTING' | 'LIVE' | 'FAILED' | 'STOPPED' | 'DONE';
  /** The newest picture of this job (LIVE only). */
  frame: LiveFrame | null;
  /** The line in place of the picture (empty while there is one). */
  line: string;
  /** The status in the header: the queue row's, with the job's progress while it renders. */
  status: string;
}

/** The live view of `u.liveView`'s job, or null when there is none (no view, or the job left the queue). */
export function liveViewOf(s: ProjectState, u: UiState): LiveViewModel | null {
  const v = u.liveView;
  const job = v ? s.render.queue.find((j) => j.id === v.jobId) : undefined;
  if (!job) return null;
  const frame = u.liveFrame?.jobId === job.id ? u.liveFrame.frame : null;
  const status = statusTextOf(job, s.render.running);
  switch (job.status) {
    case 'QUEUED':
      return { job, kind: 'WAITING', frame: null, line: t('live.waiting'), status };
    case 'RUNNING':
      return frame
        ? { job, kind: 'LIVE', frame, line: '', status: `${status} · ${Math.round(job.progress * 100)} %` }
        : { job, kind: 'STARTING', frame: null, line: t('live.first'), status: `${status} · ${Math.round(job.progress * 100)} %` };
    case 'FAILED':
      return { job, kind: 'FAILED', frame: null, line: t('live.failed', { reason: job.error ?? '' }), status };
    case 'CANCELLED':
      return { job, kind: 'STOPPED', frame: null, line: t('live.stopped'), status };
    default:
      return { job, kind: 'DONE', frame: null, line: status, status };
  }
}

/**
 * The data line: the render's size, the samples of the picture (of how many, when the job finishes by samples), the
 * seconds rendered (of how many, when it finishes by time), the camera. The numbers are the engine's (rule 10); before
 * a picture, only what the job was asked for.
 */
export function liveDataText(s: ProjectState, job: RenderJob, frame: LiveFrame | null): string {
  const lang = getLang();
  const st = job.settings;
  const parts = [`${st.width} × ${st.height}`];
  if (frame) {
    const n = formatNumber(frame.samples, lang, 0);
    parts.push(st.finishBy === 'TIME' ? t('rw.summarySamples', { n }) : t('live.samplesOf', { n, of: formatNumber(st.maxSamples, lang, 0) }));
    parts.push(st.finishBy === 'SAMPLES' ? formatClock(frame.seconds) : t('live.timeOf', { t: formatClock(frame.seconds), of: formatClock(st.maxSeconds) }));
  }
  const cam = st.mode === 'ANIMATION' ? null : st.camera.kind === 'ONE' ? s.camera.cameras[st.camera.id] : s.camera.cameras[s.camera.active];
  parts.push(st.mode === 'ANIMATION' ? t('queue.timeline') : cam ? cameraName(s, cam) : '—');
  return parts.join(' · ');
}

/** The largest `w × h` of the render's proportions inside `avail` (CSS pixels). */
function fitted(rw: number, rh: number, aw: number, ah: number): { w: number; h: number } {
  if (rw <= 0 || rh <= 0 || aw <= 0 || ah <= 0) return { w: 0, h: 0 };
  const k = Math.min(aw / rw, ah / rh);
  return { w: Math.max(1, Math.floor(rw * k)), h: Math.max(1, Math.floor(rh * k)) };
}

/** The space around the picture inside the layer, CSS pixels. */
const PAD = 16;

export function liveViewer(ctx: Ctx, scope: Scope): HTMLElement {
  const { ui, store } = ctx;
  const title = h('div', { class: 'rv-title lv-title' });
  const data = h('div', { class: 'aux tabular rv-data lv-data' });
  const status = h('span', { class: 'tabular lv-status' });
  const bar = h('div', { style: 'width:0%' });
  const canvas = h('canvas', { class: 'lv-canvas' });
  const line = h('div', { class: 'note lv-line' });
  const frameEl = h('div', { class: 'rv-frame lv-frame' }, canvas, line);
  const closeBtn = h('button', { type: 'button', class: 'icon-btn rv-close', 'aria-label': t('common.close'), 'data-tip': t('common.close'), 'data-kbd': t('key.escape'), onclick: () => cmd.closeLive(ctx) }, icon('close'));
  const el = h(
    'div',
    { class: 'rv lv', role: 'region', 'aria-label': t('live.label') },
    h(
      'div',
      { class: 'rv-head' },
      h(
        'div',
        { class: 'rv-top' },
        h('div', { class: 'rv-info' }, h('div', { class: 'lv-titleline' }, h('span', { class: 'lv-badge' }, t('live.badge')), title), data),
        h('div', { class: 'rv-actions lv-actions' }, h('div', { class: 'lv-progress' }, status, h('div', { class: 'bar-meter' }, bar))),
      ),
      h('div', { class: 'note lv-note' }, t('live.note')),
      closeBtn,
    ),
    frameEl,
  );

  // The picture sits in the middle at the render's proportions, as large as the layer allows; the box the engine
  // fits it in is that size in device pixels (the queue caps it: core/live-frame.ts LIVE_MAX_BOX).
  let size = { w: 0, h: 0 };
  const layout = (): void => {
    const job = liveViewOf(store.get(), ui.get())?.job;
    if (!job) return;
    const f = fitted(job.settings.width, job.settings.height, frameEl.clientWidth - 2 * PAD, frameEl.clientHeight - 2 * PAD);
    size = f;
    canvas.style.width = `${f.w}px`;
    canvas.style.height = `${f.h}px`;
    const dpr = window.devicePixelRatio || 1;
    const box = { width: Math.round(f.w * dpr), height: Math.round(f.h * dpr) };
    const v = ui.get().liveView;
    if (v && f.w > 0 && (v.box?.width !== box.width || v.box?.height !== box.height)) ui.set({ liveView: { ...v, box } });
  };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(layout) : null;
  ro?.observe(frameEl);
  scope.onDispose(() => ro?.disconnect());

  let drawn: LiveFrame | null = null;
  const draw = (f: LiveFrame): void => {
    if (f === drawn) return;
    drawn = f;
    if (canvas.width !== f.width) canvas.width = f.width;
    if (canvas.height !== f.height) canvas.height = f.height;
    canvas.getContext('2d')?.putImageData(new ImageData(f.rgba as Uint8ClampedArray<ArrayBuffer>, f.width, f.height), 0, 0);
    el.dataset.frames = String(Number(el.dataset.frames ?? '0') + 1);
  };

  scope.watch(
    (s, u) => [liveViewOf(s, u), s.camera, s.meta.lang] as const,
    ([m]) => {
      if (!m) return;
      const s = store.get();
      title.textContent = `${jobFileNames(s, m.job)[0] ?? ''}${m.job.settings.mode === 'ANIMATION' ? '…' : ''}`;
      title.title = title.textContent;
      data.textContent = liveDataText(s, m.job, m.frame);
      status.textContent = m.status;
      bar.style.width = `${Math.round(m.job.progress * 100)}%`;
      el.dataset.job = m.job.id;
      el.dataset.kind = m.kind;
      if (m.frame) {
        el.dataset.samples = String(m.frame.samples);
        draw(m.frame);
      }
      canvas.style.display = m.frame ? '' : 'none';
      line.textContent = m.line;
      line.style.display = m.line ? '' : 'none';
      if (size.w === 0) layout();
    },
    (a, b) => a[1] === b[1] && a[2] === b[2] && (a[0] === b[0] || (a[0] !== null && b[0] !== null && a[0].job === b[0].job && a[0].frame === b[0].frame && a[0].status === b[0].status)),
  );

  // Its keys while it is open: Esc closes.
  const onKey = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || e.isComposing || isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const u = ui.get();
    if (u.paletteOpen || u.renderWindow || document.querySelector('.floating')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cmd.closeLive(ctx);
    }
  };
  document.addEventListener('keydown', onKey, true);
  scope.onDispose(() => document.removeEventListener('keydown', onKey, true));
  requestAnimationFrame(layout);
  return el;
}
