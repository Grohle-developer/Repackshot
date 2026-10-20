// Viewport (UI.md §2.3): the render itself, with overlays that never cover
// the part. Talks to the engine only through the ViewportPort.

import { shotFadeAt } from '../../core/animation';
import { cameraFrameRect } from '../../core/camera';
import { viewedCamera } from '../../core/view-objects';
import * as cmd from '../commands';
import { h, icon } from '../dom';
import { dynamic, type Ctx, type Scope } from '../reactive';
import { t } from '../strings';
import { liveViewer } from './live-viewer';
import { resultsViewer } from './results-viewer';
import { viewportLabels } from './viewport-labels';
import { viewportOverlays } from './viewport-overlays';

function emptyState(ctx: Ctx, scope: Scope): HTMLElement {
  const msg = h('div', { class: 'note' });
  scope.watch((_s, u) => u.importMessage, (m) => (msg.textContent = m ?? ''));
  return h(
    'div',
    { class: 'empty' },
    h(
      'div',
      { class: 'empty-zone' },
      icon('upload', 28),
      h('div', { class: 'empty-title' }, t('empty.title')),
      h('div', { class: 'note' }, t('empty.formats')),
      h(
        'div',
        { class: 'row', style: 'justify-content:center;margin-top:8px', 'data-guide': 'empty-actions' },
        h('button', { type: 'button', class: 'btn', onclick: () => void cmd.openProject(ctx) }, t('empty.open')),
        h('button', { type: 'button', class: 'btn', onclick: () => void cmd.importDialog(ctx) }, icon('upload', 14), t('empty.import')),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => cmd.loadExample(ctx) }, t('empty.example')),
      ),
      msg,
    ),
  );
}

export function viewportPanel(ctx: Ctx, scope: Scope): HTMLElement {
  const { store, ui, services } = ctx;
  const host = h('div', { class: 'vp-canvas-host' });
  const port = services.viewport;
  if (port) {
    if (port.backdrop) {
      port.backdrop.classList.add('vp-backdrop');
      host.appendChild(port.backdrop);
    }
    host.appendChild(port.canvas);
  }
  else host.appendChild(h('div', { class: 'empty' }, h('div', { class: 'empty-zone' }, h('div', { class: 'note' }, t('viewport.noEngine')))));

  // Darken what falls outside the output frame: the viewport is the render.
  const mask = h('div', { class: 'frame-mask' }, h('div'), h('div'), h('div'), h('div'), h('div', { class: 'frame-edge' }));
  // N1: the camera track's fade to a colour at the playhead, over the frame (the render's content: black or white).
  const fade = h('div', { class: 'vp-fade', 'aria-hidden': 'true', style: 'display:none' });
  const el = h('main', { class: 'vp', 'aria-label': t('app.name') }, host, fade, mask);

  const layoutMask = () => {
    const w = el.clientWidth;
    const hh = el.clientHeight;
    // The frame is the image of the camera on screen (the active one, or the one looked through): its own ratio (U13).
    const r = cameraFrameRect(viewedCamera(store.get(), ui.get().lookThrough), w, hh);
    const [top, bottom, left, right, edge] = mask.children as unknown as HTMLElement[];
    Object.assign(top.style, { left: '0', top: '0', width: `${w}px`, height: `${r.y}px` });
    Object.assign(bottom.style, { left: '0', top: `${r.y + r.height}px`, width: `${w}px`, height: `${hh - r.y - r.height}px` });
    Object.assign(left.style, { left: '0', top: `${r.y}px`, width: `${r.x}px`, height: `${r.height}px` });
    Object.assign(right.style, { left: `${r.x + r.width}px`, top: `${r.y}px`, width: `${w - r.x - r.width}px`, height: `${r.height}px` });
    Object.assign(edge.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
    Object.assign(fade.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
  };
  // Only while the animation is shown (playing, or the playhead moved): at 0 the scene is shown as it is edited.
  scope.watch(
    (s) => {
      const a = s.animation;
      const f = a.playing || a.playhead > 0 ? shotFadeAt(s, a.playhead) : null;
      return f ? `${f.color.join(',')}|${f.amount.toFixed(3)}` : '';
    },
    (key) => {
      fade.style.display = key ? '' : 'none';
      if (!key) return;
      const [rgb, amount] = key.split('|');
      const [r, g, b] = rgb.split(',').map((v) => Math.round(Number(v) * 255));
      fade.style.background = `rgb(${r}, ${g}, ${b})`;
      fade.style.opacity = amount;
      fade.dataset.amount = amount;
    },
  );

  const ro = new ResizeObserver(() => {
    port?.resize(host.clientWidth, host.clientHeight, window.devicePixelRatio || 1);
    layoutMask();
  });
  ro.observe(el);
  scope.onDispose(() => ro.disconnect());
  scope.watch((s, u) => {
    const a = viewedCamera(s, u.lookThrough).aspect;
    return `${a.w}x${a.h}`;
  }, layoutMask);
  scope.watch(
    (s) => s.scene.roots.length === 0,
    (empty) => {
      el.querySelector('.empty')?.remove();
      mask.style.display = empty ? 'none' : '';
      if (empty && port) el.appendChild(emptyState(ctx, scope));
    },
  );
  scope.watch((_s, u) => u.tool, (tool) => el.setAttribute('data-tool', tool));
  scope.watch((_s, u) => u.pickMode, (p) => el.toggleAttribute('data-picking', p !== null));

  // The label tool (M2a) listens first: while it is on, a press on a part is its own, not the camera's or the gizmo's.
  if (port) el.append(viewportLabels(ctx, scope, el));
  if (port) el.append(...viewportOverlays(ctx, scope, el));
  // The results viewer: a layer over the viewport (UI.md §2.8), rebuilt when the result or the comparison changes; in
  // the same layer, its "in progress" mode (U14): the live view of a queue job while that job is in the queue.
  el.appendChild(
    dynamic(
      scope,
      (s, u) =>
        u.resultView
          ? `result|${u.resultView.id}|${u.resultView.compare ?? ''}`
          : u.liveView && s.render.queue.some((j) => j.id === u.liveView!.jobId)
            ? `live|${u.liveView.jobId}`
            : null,
      (sc, key) => (key?.startsWith('result|') ? resultsViewer(ctx, sc) : key ? liveViewer(ctx, sc) : null),
      undefined,
      'div',
      'rv-host',
    ),
  );
  void ui;
  return el;
}
