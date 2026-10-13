// Viewport overlays (UI.md §2.3): view toolbar (top left), camera and output
// size (top right), quality meter (bottom left), axes and part size (bottom
// right), hover label, pick modes and drag and drop of materials and files.

import { activeCamera, cameraBasis, cameraPosition, VIEW_KEYS, type ViewKey } from '../../core/camera';
import { boxSize, isEmptyBox, length, sub } from '../../core/math';
import { partsUnder, resolvePick, sceneBounds, selectedNodes, type NodeId } from '../../core/scene';
import type { ProjectState } from '../../core/store';
import { gizmoTransforms, movableTargets, selectionFrame, type GizmoFrame, type GizmoHandle } from '../../core/transform';
import * as cmd from '../commands';
import { newGesture } from '../components/controls';
import { confirmBox, openMenu, openMenuAt } from '../components/widgets';
import { h, icon } from '../dom';
import type { IconName } from '../icons';
import { cameraName, dyn, lightName, targetLabel } from '../names';
import { shallowEq, type Ctx, type Scope } from '../reactive';
import { kbdFor } from '../shortcuts';
import { L, formatNumber, getLang, t } from '../strings';
import type { Tool } from '../ui-state';
import { partMenu } from './part-menu';

const SVG_NS = 'http://www.w3.org/2000/svg';

function toolbar(ctx: Ctx, scope: Scope): HTMLElement {
  const { store, ui } = ctx;
  const tools: { id: Tool; icon: IconName; action: string }[] = [
    { id: 'select', icon: 'select', action: 'tool.select' },
    { id: 'orbit', icon: 'orbit', action: 'tool.orbit' },
    { id: 'pan', icon: 'pan', action: 'tool.pan' },
    { id: 'zoom', icon: 'zoom', action: 'tool.zoom' },
    { id: 'move', icon: 'move', action: 'tool.move' },
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
        'data-tool': tl.id,
        onclick: () => cmd.setTool(ctx, tl.id),
      },
      icon(tl.icon, 20),
    ),
  );
  scope.watch((_s, u) => u.tool, (tool) => buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(tools[i].id === tool))));
  // Axes of the move tool, shown while it is on (L / G).
  const space = h('button', { type: 'button', class: 'ov-text-btn', 'data-tip': t('viewport.space'), 'data-kbd': `${kbdFor('space.local')} / ${kbdFor('space.global')}` });
  space.addEventListener('click', () => cmd.setSpace(ctx, ui.get().space === 'LOCAL' ? 'GLOBAL' : 'LOCAL'));
  scope.watch(
    (_s, u) => [u.tool, u.space] as const,
    ([tool, sp]) => {
      space.style.display = tool === 'move' ? '' : 'none';
      space.textContent = t(dyn(`space.${sp}`));
      space.setAttribute('aria-pressed', String(sp === 'LOCAL'));
      space.setAttribute('aria-label', `${t('viewport.space')}: ${t(dyn(`space.${sp}`))}`);
    },
    (a, b) => a[0] === b[0] && a[1] === b[1],
  );
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
  return h('div', { class: 'ov ov-tl', role: 'toolbar', 'aria-label': t('viewport.views') }, ...buttons, space, h('span', { class: 'ov-sep' }), frame, views, proj, h('span', { class: 'ov-sep' }), lock);
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
  const resBtn = h('button', { type: 'button', class: 'ov-text-btn', 'data-tip': t('viewport.output'), onclick: () => cmd.openRenderWindow(ctx) });
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

/** Seconds as MM:SS (the meter's clock). */
function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function meter(ctx: Ctx, scope: Scope): HTMLElement {
  const port = ctx.services.viewport!;
  const title = h('div', { style: 'font-weight:600;font-size:12px' });
  const line = h('div', { class: 'aux tabular' });
  const bar = h('div', { class: 'bar-meter' }, h('div', { style: 'width:0%' }));
  const note = h('div', { class: 'note', style: 'font-size:11px' });
  const el = h('div', { class: 'ov ov-bl', role: 'status', 'aria-live': 'off', 'data-guide': 'meter' }, title, line, bar, note);
  let last = 0;
  let trailing = 0;
  const update = (force = false) => {
    const now = performance.now();
    if (!force && now - last < 250) {
      // Throttled: the last frame of a burst is still shown, a moment later.
      if (!trailing) trailing = window.setTimeout(() => ((trailing = 0), update(true)), 250 - (now - last));
      return;
    }
    last = now;
    // The meter prints what the engine on screen reports, nothing else.
    const st = port.status();
    const lang = getLang();
    const samples = st.samples === 1 ? t('viewport.sample') : t('viewport.samples', { n: formatNumber(st.samples, lang, 0) });
    if (port.kind === 'pathtracer') {
      const scale = st.scale ?? 1;
      title.textContent = st.rendering
        ? t('viewport.meterRendering')
        : scale >= 4
          ? t('viewport.meterQuarter')
          : scale >= 2
            ? t('viewport.meterHalf')
            : t('viewport.meterFull', { samples, time: clock(st.seconds) });
      line.textContent = t('viewport.pool', { workers: st.workers ?? 0, isa: st.simd ? t('status.isaSimd') : t('status.isaScalar') });
      // What this machine does, measured here (the render window's estimate): pixel-samples per second.
      if (!st.rendering && scale === 1 && st.pixels && st.samples >= 2 && st.seconds >= 2) {
        const tp = (st.samples * st.pixels) / st.seconds;
        const prev = ctx.ui.get().throughput;
        if (prev === null || Math.abs(tp - prev) > prev * 0.1) ctx.ui.set({ throughput: tp });
      }
      const max = Math.max(1, ctx.store.get().render.maxSamples);
      (bar.firstElementChild as HTMLElement).style.width = `${Math.min(100, Math.round((st.samples / max) * 100))}%`;
      note.textContent = '';
      note.style.display = 'none';
    } else {
      title.textContent = t('viewport.meterFast');
      line.textContent = t('viewport.frameMs', { ms: formatNumber(st.seconds * 1000, lang, 1) });
      (bar.firstElementChild as HTMLElement).style.width = st.converged ? '100%' : '30%';
      note.textContent = t('viewport.renderNote');
      note.style.display = '';
    }
    // Machine-readable copies of the same numbers (screenshots and browser checks read them).
    el.dataset.mode = port.kind === 'pathtracer' ? 'full' : 'fast';
    el.dataset.samples = String(st.samples);
    el.dataset.seconds = st.seconds.toFixed(3);
    el.dataset.scale = String(st.scale ?? 1);
    el.dataset.frames = String(st.frames ?? 0);
    el.dataset.frameMs = st.frameMs !== undefined ? st.frameMs.toFixed(1) : '';
  };
  scope.onDispose(port.onFrame(() => update()));
  scope.onDispose(() => window.clearTimeout(trailing));
  scope.watch((_s, u) => [u.viewportMode, u.engine].join(), () => update(true));
  update(true);
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
      else if (pm?.kind === 'pivot') pickBanner.textContent = t('viewport.pickPivot');
      else if (pm?.kind === 'link') pickBanner.textContent = t('viewport.pickLink');
    },
  );
  // Outline what the tree or the cursor hovers.
  scope.watch(
    (s, u) => [u.hover, s.scene.nodes] as const,
    ([hover]) => port.setHover(hover ? partsUnder(store.get(), [hover]) : []),
    shallowEq,
  );

  // The canvas outlives a rebuild of the interface (language switch): its listeners go with the scope.
  const off = new AbortController();
  scope.onDispose(() => off.abort());
  const listen = { signal: off.signal };
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
        // Orbiting, panning or dragging a handle: no hover outline (it would follow the camera on every frame).
        label.style.display = 'none';
        if (ui.get().hover && !drag) ui.set({ hover: null });
        return;
      }
      const p = local(ev);
      // Over a handle of the gizmo the handle lights up instead of the part.
      const handle = gizmoOn() && !drag ? port.gizmoHover(p.x, p.y) : null;
      if (handle) {
        vp.setAttribute('data-gizmo', 'hover');
        vp.setAttribute('data-gizmo-handle', handle);
        label.style.display = 'none';
        if (ui.get().hover) ui.set({ hover: null });
        return;
      }
      if (!drag) {
        vp.removeAttribute('data-gizmo');
        vp.removeAttribute('data-gizmo-handle');
      }
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
  }, listen);
  canvas.addEventListener('pointerleave', () => {
    label.style.display = 'none';
    if (ui.get().hover) ui.set({ hover: null });
    if (!drag) {
      port.gizmoHover(-1, -1);
      vp.removeAttribute('data-gizmo');
    }
  }, listen);

  // The move tool (UI.md §2.3): the gizmo sits on the pivot of the selection, in the chosen axes.
  const gizmoIds = (s: ProjectState) => movableTargets(s, selectedNodes(s));
  const gizmoOn = () => ui.get().tool === 'move' && !ui.get().pickMode;
  scope.watch(
    (s, u) => [u.tool, u.space, u.pickMode === null, s.selection, s.scene.nodes] as const,
    ([tool, space, free]) => {
      const ids = gizmoIds(store.get());
      port.setGizmo(tool === 'move' && free && ids.length > 0 ? { ids, space } : null);
    },
    shallowEq,
  );
  scope.onDispose(() => port.setGizmo(null));

  // A drag of a handle: measured by the engine from where it began, applied here from the state at that
  // moment, every step under one gesture token, so the whole drag is one undo entry.
  let drag: { start: ProjectState; ids: NodeId[]; frame: GizmoFrame; handle: GizmoHandle; gesture: string; pointer: number } | null = null;
  const dragLabel = (handle: GizmoHandle, ids: NodeId[]) => {
    const target = targetLabel(store.get(), ids);
    const key = handle === 'aim' ? 'undo.aim' : handle.startsWith('r') ? 'undo.rotate' : handle.startsWith('s') ? 'undo.scale' : 'undo.transform';
    return L(key, { target });
  };
  vp.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target !== canvas || !gizmoOn()) return;
    const p = local(e);
    const s = store.get();
    const ids = gizmoIds(s);
    const frame = selectionFrame(s, ids, ui.get().space);
    if (!frame) return;
    const handle = port.gizmoBegin(p.x, p.y);
    if (!handle) return;
    // Taken before the camera controls see it: dragging a handle does not orbit.
    e.stopPropagation();
    e.preventDefault();
    canvas.focus({ preventScroll: true });
    drag = { start: s, ids, frame, handle, gesture: newGesture('gizmo'), pointer: e.pointerId };
    vp.setAttribute('data-gizmo', 'drag');
    label.style.display = 'none';
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events have no active pointer to capture.
    }
  }, { capture: true, signal: off.signal });
  window.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    const p = local(e);
    const delta = port.gizmoDrag(p.x, p.y);
    if (!delta) return;
    const label = dragLabel(drag.handle, drag.ids);
    if (delta.kind === 'aim') {
      store.dispatch({ type: 'scene/aim', id: drag.ids[0], target: delta.target, gesture: drag.gesture, label });
      return;
    }
    // Shift: increments of 10 mm, 15 degrees, 0.1.
    store.dispatch({ type: 'scene/setTransforms', transforms: gizmoTransforms(drag.start, drag.ids, drag.frame, delta, e.shiftKey), gesture: drag.gesture, label });
  }, listen);
  const endDrag = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    drag = null;
    port.gizmoEnd();
    vp.removeAttribute('data-gizmo');
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      // Not captured.
    }
  };
  window.addEventListener('pointerup', endDrag, listen);
  window.addEventListener('pointercancel', endDrag, listen);

  // Click (a press without a drag): pick modes, then selection by level.
  let down: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
    canvas.focus({ preventScroll: true });
  }, listen);
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
      } else if (pm.kind === 'pivot') {
        cmd.setPivot(ctx, 'CUSTOM', pm.ids, tg.hit.point);
      } else if (pm.kind === 'link') {
        cmd.linkMaterial(ctx, pm.parts, tg.part);
      } else {
        store.dispatch({ type: 'studio/placeLight', id: pm.light, point: tg.hit.point, normal: tg.hit.normal, label: L('undo.placeLight', { name: { en: lightName(s, pm.light, 'en'), es: lightName(s, pm.light, 'es') } }) });
      }
      ui.set({ pickMode: null });
      return;
    }
    // The move tool selects with a click too (a drag on a handle never gets here).
    if (ui.get().tool !== 'select' && ui.get().tool !== 'move') return;
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
  }, listen);
  // Right click on a part (a press without a drag: a right drag pans): the context menu of UI.md §2.2.
  let rightDown: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 2) rightDown = { x: e.clientX, y: e.clientY };
  }, listen);
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const moved = rightDown ? Math.hypot(e.clientX - rightDown.x, e.clientY - rightDown.y) : 0;
    rightDown = null;
    if (moved > 4 || ui.get().pickMode) return;
    const p = local(e);
    const tg = targetAt(p.x, p.y);
    if (!tg) return;
    const s = store.get();
    let ids = selectedNodes(s);
    if (!ids.includes(tg.id)) {
      store.dispatch({ type: 'scene/select', ids: [tg.id], mode: 'set' });
      ids = [tg.id];
    }
    openMenuAt(e.clientX, e.clientY, partMenu(ctx, ids));
  }, listen);
  canvas.addEventListener('dblclick', (e) => {
    const p = local(e);
    const tg = targetAt(p.x, p.y);
    if (tg) cmd.frameSelection(ctx, [tg.id]);
  }, listen);

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
      // A project opens; models go to the import sheet.
      const { files, handles } = cmd.readDrop(e.dataTransfer);
      cmd.dropFiles(ctx, files, handles);
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
  return [hideWhenEmpty(toolbar(ctx, scope)), topRight(ctx, scope), meter(ctx, scope), hideWhenEmpty(axes(ctx, scope)), label, pickBanner, confirmHost];
}
