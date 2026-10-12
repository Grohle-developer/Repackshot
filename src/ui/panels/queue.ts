// Queue drawer (UI.md §2.5): jobs with camera, size, quality, status and
// progress; Start queue and Clear.

import { QUALITY_PRESETS } from '../../data/quality';
import * as cmd from '../commands';
import { h, icon } from '../dom';
import { cameraName, dyn } from '../names';
import type { Ctx, Scope } from '../reactive';
import { lbl, t } from '../strings';

export function queueDrawer(ctx: Ctx, scope: Scope): HTMLElement {
  const { store } = ctx;
  const startBtn = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => void cmd.startQueue(ctx) });
  const clearBtn = h('button', { type: 'button', class: 'btn', onclick: () => cmd.clearQueue(ctx) }, t('queue.clear'));
  const list = h('div', { class: 'queue-list' });
  scope.watch(
    (s) => s.render.queue,
    (queue) => {
      const s = store.get();
      const running = cmd.isQueueRunning();
      startBtn.replaceChildren(icon(running ? 'stop' : 'play', 14), running ? t('render.stop') : t('queue.start'));
      startBtn.disabled = !running && !queue.some((j) => j.status === 'QUEUED');
      clearBtn.disabled = queue.length === 0;
      if (queue.length === 0) {
        list.replaceChildren(h('p', { class: 'note', style: 'padding:12px var(--pad)' }, t('queue.empty')));
        return;
      }
      list.replaceChildren(
        ...queue.map((j) =>
          h(
            'div',
            { class: 'queue-row' },
            h('span', null, j.name),
            h('span', { class: 'aux' }, cameraName(s, s.camera.cameras[j.camera]) || j.camera),
            h('span', null, `${j.width} × ${j.height}`),
            h('span', null, j.quality === 'CUSTOM' ? t('render.custom') : lbl(QUALITY_PRESETS[j.quality].label)),
            h('span', { class: j.status === 'FAILED' ? 'warn-text' : '' }, t(dyn(`queue.status.${j.status}`))),
            h('div', { class: 'bar-meter' }, h('div', { style: `width:${Math.round(j.progress * 100)}%` })),
            h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': t('common.remove'), 'data-tip': t('common.remove'), disabled: j.status === 'RUNNING', onclick: () => store.dispatch({ type: 'render/removeJob', id: j.id }) }, icon('close', 14)),
          ),
        ),
      );
    },
  );
  return h('div', { class: 'queue' }, h('div', { class: 'queue-head' }, h('span', { class: 'field-label', style: 'font-weight:600' }, t('render.queue')), h('span', { style: 'flex:1' }), clearBtn, startBtn), list);
}
