// Viewport overlays (UI.md §2.3): view toolbar (top left), camera and output
// size (top right), quality meter (bottom left), axes and part size (bottom
// right), hover label, pick modes and drag and drop of materials and files.

import { activeCamera, cameraBasis, cameraPosition, VIEW_KEYS, type ViewKey } from '../../core/camera';
import { boxSize, isEmptyBox, length, sub } from '../../core/math';
import { partsUnder, resolvePick, sceneBounds, type NodeId } from '../../core/scene';
import * as cmd from '../commands';
import { confirmBox, openMenu } from '../components/widgets';
import { h, icon } from '../dom';
import type { IconName } from '../icons';
import { cameraName, dyn, lightName } from '../names';
import { shallowEq, type Ctx, type Scope } from '../reactive';
import { kbdFor } from '../shortcuts';
import { L, formatNumber, getLang, t } from '../strings';
import type { Tool } from '../ui-state';

const SVG_NS = 'http://www.w3.org/2000/svg';

function toolbar(ctx: Ctx, scope: Scope): HTMLElement {
  const { store, ui, services } = ctx;
  const tools: { id: Tool; icon: IconName; action: string }[] = [
    { id: 'select', icon: 'select', action: 'tool.select' },
    { id: 'orbit', icon: 'orbit', action: 'tool.orbit' },
    { id: 'pan', icon: 'pan', action: 'tool.pan' },
    { id: 'zoom', icon: 'zoom', action: 'tool.zoom' },
  ];
  const buttons = tools.map((tl) =>
    h(
      'button',
      {
        type: 'button',
        class: 'icon-btn',
        'aria-label': t(dyn(tl.action)),
        'data-tip': t(dyn(tl.action)),
        'data-kbd': kbdFor(tl.action),
        onclick: () => {
          ui.set({ tool: tl.id });
          services.viewport?.setTool(tl.id);
        },
      },
      icon(tl.icon, 20),
    ),
  );
  scope.watch((_s, u) => u.tool, (tool) => buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(tools[i].id === tool))));
  const views = h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('viewport.views'), 'data-tip': t('viewport.views'), 'aria-haspopup': 'menu' }, icon('views', 20));
  views.addEventListener('click', () =>
    openMenu(
      views,
      VIEW_KEYS.map((v: ViewKey) => ({
        label: t(dyn(`view.${v}`)),
        run: () => store.dispatch({ type: 'camera/view', view: v, label: L('undo.view', { name: L(dyn(`view.${v}`)) }) }),
      })),
    ),
  );
  const proj = h('button', { type: 'button', class: 'icon-btn', onclick: () => cmd.toggleProjection(ctx) });
  const lock = h('button', { type: 'button', class: 'icon-btn', onclick: () => cmd.toggleCameraLock(ctx) });
  scope.watch(
    (s) => activeCamera(s),
    (cam) => {
      const ortho = cam.projection === 'ORTHOGRAPHIC';
      proj.replaceChildren(icon(ortho ? 'ortho' : 'perspective', 20));
      proj.setAttribute('aria-label', ortho ? t('viewport.ortho') : t('viewport.perspective'));
      proj.setAttribute('data-tip', `${t('viewport.perspective')} / ${t('viewport.ortho')}`);
      proj.setAttribute('aria-pressed', String(ortho));
      lock.replaceChildren(icon(cam.locked ? 'lock' : 'unlock', 20));
      lock.setAttribute('aria-pressed', String(cam.locked));
      const label = cam.locked ? t('viewport.unlockCamera') : t('viewport.lockCamera');
      lock.setAttribute('aria-label', label);
      lock.setAttribute('data-tip', label);
    },
  );
  const frame = h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('viewport.frameAll'), 'data-tip': t('viewport.frameAll'), 'data-kbd': kbdFor('frame'), 'data-guide': 'frame', onclick: () => cmd.frameSelection(ctx) }, icon('frame', 20));
  return h('div', { class: 'ov ov-tl', role: 'toolbar', 'aria-label': t('viewport.views') }, ...buttons, h('span', { class: 'ov-sep' }), frame, views, proj, h('span', { class: 'ov-sep' }), lock);
}

function topRight(ctx: Ctx, scope: Scope): HTMLElement {
  const { store } = ctx;
  const camBtn = h('button', { type: 'button', class: 'ov-text-btn', 'aria-haspopup': 'menu', 'data-tip': t('viewport.cameraList') });
  camBtn.addEventListener('click', () => {
    const s = store.get();
    openMenu(
      camBtn,
      Object.values(s.camera.cameras).map((c) => ({ label: cameraName(s, c), checked: c.id === s.camera.active, run: () => cmd.activateCamera(ctx, c.id) })),
      'end',
    );
  });
  const resBtn = h('button', { type: 'button', class: 'ov-text-btn', 'data-tip': t('viewport.output'), onclick: () => (document.querySelector('[data-guide="resolution"]') as HTMLElement | null)?.focus() });
  scope.watch(
    (s) => [s.camera, s.render.width, s.render.height],
    () => {
      const s = store.get();
      camBtn.replaceChildren(icon('camera', 16), h('span', null, cameraName(s, activeCamera(s))));
      camBtn.style.display = 'inline-flex';
      camBtn.style.alignItems = 'center';
      camBtn.style.gap = '6px';
      resBtn.textContent = `${s.render.width} × ${s.render.height}`;
    },
    shallowEq,
  );
  return h('div', { class: 'ov ov-tr' }, camBtn, h('span', { class: 'ov-sep' }), resBtn);
}

function meter(ctx: Ctx): HTMLElement {
  const port = ctx.services.viewport!;
  const line = h('div', { class: 'aux tabular' });
  const bar = h('div', { class: 'bar-meter' }, h('div', { style: 'width:0%' }));
  const el = h('div', { class: 'ov ov-bl', role: 'status', 'aria-live': 'off' }, h('div', { style: 'font-weight:600;font-size:12px' }, t('viewport.meterPreview')), line, bar, h('div', { class: 'note', style: 'font-size:11px' }, t('viewport.meterTracer')));
  let last = 0;
  const update = () => {
    const now = performance.now();
    if (now - last < 250) return;
    last = now;
    // The meter prints what the engine reports, nothing else.
    const st = port.status();
    line.textContent = `${st.samples === 1 ? t('viewport.sample') : t('viewport.samples', { n: st.samples })} · ${formatNumber(st.seconds * 1000, getLang(), 1)} ms`;
    (bar.firstElementChild as HTMLElement).style.width = st.converged ? '100%' : '30%';
  };
  port.onFrame(update);
  return el;
}

function axes(ctx: Ctx, scope: Scope): HTMLElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '44');
  svg.setAttribute('height', '44');
  svg.setAttribute('viewBox', '-22 -22 44 44');
  svg.setAttribute('class', 'axes');
  svg.setAttribute('aria-hidden', 'true');
  const size = h('span', { class: 'aux tabular' });
  scope.watch(
    (s) => [activeCamera(s), s.scene.nodes],
    () => {
      const s = ctx.store.get();
      const cam = activeCamera(s);
      const { right, up } = cameraBasis(cam.azimuth, cam.elevation);
      svg.replaceChildren();
      const axesList: [string, number[], string][] = [
        ['X', [1, 0, 0], '1.5'],
        ['Y', [0, 1, 0], '1'],
        ['Z', [0, 0, 1], '1.5'],
      ];
      for (const [name, a, w] of axesList) {
        const x = (a[0] * right[0] + a[1] * right[1] + a[2] * right[2]) * 13;
        const y = -(a[0] * up[0] + a[1] * up[1] + a[2] * up[2]) * 13;
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', '0');
        line.setAttribute('y1', '0');
        line.setAttribute('x2', String(x));
        line.setAttribute('y2', String(y));
        line.setAttribute('stroke', 'currentColor');
        line.setAttribute('stroke-width', w);
        if (name === 'Y') line.setAttribute('stroke-dasharray', '2 2');
        const label = document.createElementNS(SVG_NS, 'text');
        label.setAttribute('x', String(x * 1.45));
        label.setAttribute('y', String(y * 1.45 + 3));
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('font-size', '8');
        label.setAttribute('fill', 'currentColor');
        label.textContent = name;
        svg.append(line, label);
      }
      const b = sceneBounds(s, true);
      const d = boxSize(b);
      const f = (v: number) => formatNumber(v, getLang(), v < 10 ? 1 : 0);
      size.textContent = isEmptyBox(b) ? '' : t('viewport.size', { x: f(d[0]), y: f(d[1]), z: f(d[2]) });
    },
    shallowEq,
  );
  return h('div', { class: 'ov ov-br' }, svg as unknown as HTMLElement, size);
}

export function viewportOverlays(ctx: Ctx, scope: Scope, vp: HTMLElement): HTMLElement[] {
  const { store, ui, services } = ctx;
  const port = services.viewport!;
  const canvas = port.canvas;
  const label = h('div', { class: 'hover-label', style: 'display:none' });
  const pickBanner = h('div', { class: 'ov ov-pick', role: 'status', style: 'display:none' });
  const confirmHost = h('div', { class: 'ov-confirm' });

  scope.watch(
    (_s, u) => u.pickMode,
    (pm) => {
      const s = store.get();
      pickBanner.style.display = pm ? '' : 'none';
      if (pm?.kind === 'focus') pickBanner.textContent = t('viewport.pickFocus');
      else if (pm?.kind === 'reflect') pickBanner.textContent = t('viewport.pickReflect', { light: lightName(s, pm.light, getLang()) });
    },
  );
  // Outline what the tree or the cursor hovers.
  scope.watch(
    (s, u) => [u.hover, s.scene.nodes] as const,
    ([hover]) => port.setHover(hover ? partsUnder(store.get(), [hover]) : []),
    shallowEq,
  );

  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const targetAt = (x: number, y: number): { id: NodeId; part: NodeId; face: number; hit: NonNullable<ReturnType<typeof port.pick>> } | null => {
    const hit = port.pick(x, y);
    if (!hit) return null;
    const s = store.get();
    return { id: resolvePick(s, hit.node, s.selection.level), part: hit.node, face: hit.face, hit };
  };

  // Hover: outline and a small name label that follows the cursor.
  let raf = 0;
  let lastMove: PointerEvent | null = null;
  canvas.addEventListener('pointermove', (e) => {
    lastMove = e;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const ev = lastMove!;
      if (ev.buttons !== 0) {
        label.style.display = 'none';
        return;
      }
      const p = local(ev);
      const tg = targetAt(p.x, p.y);
      const id = tg?.id ?? null;
      if (ui.get().hover !== id) ui.set({ hover: id });
      if (tg) {
        label.textContent = store.get().scene.nodes[tg.id]?.name ?? '';
        label.style.display = '';
        label.style.left = `${p.x + 14}px`;
        label.style.top = `${p.y + 12}px`;
      } else label.style.display = 'none';
    });
  });
  canvas.addEventListener('pointerleave', () => {
    label.style.display = 'none';
    if (ui.get().hover) ui.set({ hover: null });
  });

  // Click (a press without a drag): pick modes, then selection by level.
  let down: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
    canvas.focus({ preventScroll: true });
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || e.button !== 0) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > 4) return;
    const p = local(e);
    const s = store.get();
    const pm = ui.get().pickMode;
    const tg = targetAt(p.x, p.y);
    if (pm) {
      if (!tg) return;
      if (pm.kind === 'focus') {
        const cam = activeCamera(s);
        const d = length(sub(tg.hit.point, cameraPosition(cam)));
        store.dispatch({ type: 'camera/set', id: cam.id, patch: { focusDistance: d }, label: L('undo.focusClick') });
      } else {
        store.dispatch({ type: 'studio/placeLight', id: pm.light, point: tg.hit.point, normal: tg.hit.normal, label: L('undo.placeLight', { name: { en: lightName(s, pm.light, 'en'), es: lightName(s, pm.light, 'es') } }) });
      }
      ui.set({ pickMode: null });
      return;
    }
    if (ui.get().tool !== 'select') return;
    const add = e.shiftKey;
    const toggle = e.ctrlKey || e.metaKey;
    if (!tg) {
      if (!add && !toggle) cmd.deselect(ctx);
      return;
    }
    if (s.selection.level === 'FACES') {
      store.dispatch({ type: 'scene/selectFaces', part: tg.part, indices: [tg.face], mode: toggle ? 'toggle' : add ? 'add' : 'set' });
      return;
    }
    store.dispatch({ type: 'scene/select', ids: [tg.id], mode: toggle ? 'toggle' : add ? 'add' : 'set' });
  });
  canvas.addEventListener('dblclick', (e) => {
    const p = local(e);
    const tg = targetAt(p.x, p.y);
    if (tg) cmd.frameSelection(ctx, [tg.id]);
  });

  // Drag and drop: materials onto parts, model files anywhere.
  const isMaterial = (e: DragEvent) => e.dataTransfer?.types.includes('application/x-repackshot-material') ?? false;
  const isFile = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false;
  vp.addEventListener('dragover', (e) => {
    if (isMaterial(e)) {
      e.preventDefault();
      const p = local(e);
      const tg = targetAt(p.x, p.y);
      if (ui.get().hover !== (tg?.id ?? null)) ui.set({ hover: tg?.id ?? null });
      if (e.dataTransfer) e.dataTransfer.dropEffect = tg ? 'copy' : 'none';
    } else if (isFile(e)) {
      e.preventDefault();
      vp.classList.add('is-drop-target');
    }
  });
  vp.addEventListener('dragleave', (e) => {
    if (e.target === vp || !vp.contains(e.relatedTarget as Node)) vp.classList.remove('is-drop-target');
  });
  vp.addEventListener('drop', (e) => {
    vp.classList.remove('is-drop-target');
    if (isFile(e)) {
      e.preventDefault();
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) void cmd.importFiles(ctx, files);
      return;
    }
    if (!isMaterial(e)) return;
    e.preventDefault();
    ui.set({ hover: null });
    const src = cmd.parseMaterialDrag(e.dataTransfer?.getData('application/x-repackshot-material') ?? '');
    const p = local(e);
    const tg = targetAt(p.x, p.y);
    if (!src || !tg) return;
    const spec = cmd.requestAssign(ctx, src, [tg.id]);
    if (spec) {
      confirmHost.style.left = `${Math.min(p.x, vp.clientWidth - 370)}px`;
      confirmHost.style.top = `${Math.min(p.y, vp.clientHeight - 140)}px`;
      confirmHost.replaceChildren(confirmBox(spec, () => confirmHost.replaceChildren()));
    }
  });

  const hideWhenEmpty = (el: HTMLElement) => {
    scope.watch((s) => s.scene.roots.length === 0, (empty) => (el.style.visibility = empty ? 'hidden' : ''));
    return el;
  };
  return [hideWhenEmpty(toolbar(ctx, scope)), topRight(ctx, scope), meter(ctx), hideWhenEmpty(axes(ctx, scope)), label, pickBanner, confirmHost];
}
