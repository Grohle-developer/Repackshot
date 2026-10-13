// Viewport (UI.md §2.3): the render itself, with overlays that never cover
// the part. Talks to the engine only through the ViewportPort.

import { outputFrameRect } from '../../core/camera';
import * as cmd from '../commands';
import { h, icon } from '../dom';
import { dynamic, type Ctx, type Scope } from '../reactive';
import { t } from '../strings';
import { resultsViewer } from './results-viewer';
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
  const el = h('main', { class: 'vp', 'aria-label': t('app.name') }, host, mask);

  const layoutMask = () => {
    const w = el.clientWidth;
    const hh = el.clientHeight;
    const s = store.get();
    const r = outputFrameRect(w, hh, s.render.width, s.render.height);
    const [top, bottom, left, right, edge] = mask.children as unknown as HTMLElement[];
    Object.assign(top.style, { left: '0', top: '0', width: `${w}px`, height: `${r.y}px` });
    Object.assign(bottom.style, { left: '0', top: `${r.y + r.height}px`, width: `${w}px`, height: `${hh - r.y - r.height}px` });
    Object.assign(left.style, { left: '0', top: `${r.y}px`, width: `${r.x}px`, height: `${r.height}px` });
    Object.assign(right.style, { left: `${r.x + r.width}px`, top: `${r.y}px`, width: `${w - r.x - r.width}px`, height: `${r.height}px` });
    Object.assign(edge.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
  };

  const ro = new ResizeObserver(() => {
    port?.resize(host.clientWidth, host.clientHeight, window.devicePixelRatio || 1);
    layoutMask();
  });
  ro.observe(el);
  scope.onDispose(() => ro.disconnect());
  scope.watch((s) => [s.render.width, s.render.height].join('x'), layoutMask);
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

  if (port) el.append(...viewportOverlays(ctx, scope, el));
  // The results viewer: a layer over the viewport (UI.md §2.8), rebuilt when the result or the comparison changes.
  el.appendChild(
    dynamic(
      scope,
      (_s, u) => (u.resultView ? `${u.resultView.id}|${u.resultView.compare ?? ''}` : null),
      (sc, key) => (key ? resultsViewer(ctx, sc) : null),
      undefined,
      'div',
      'rv-host',
    ),
  );
  void ui;
  return el;
}
