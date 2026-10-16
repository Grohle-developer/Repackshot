// Viewport overlays (UI.md §2.3): view toolbar (top left), camera and output
// size (top right), quality meter (bottom left), axes and part size (bottom
// right), hover label, pick modes and drag and drop of materials (pointer events) and files.

import { DEFAULT_PIXEL_FILTER, pixelFilterSetting } from '../../core/antialias';
import { aspectText } from '../../core/aspect';
import { activeCamera, cameraBasis, VIEW_KEYS, type ViewKey } from '../../core/camera';
import { boxSize, isEmptyBox } from '../../core/math';
import { clickModeOf, clickMods, CLICK_PIXELS, type Mods } from '../../core/box-select';
import { dropNodes, viewportDropTarget, type DropTarget } from '../../core/material-drop';
import { allParts, effectiveVisible, partsUnder, resolvePick, sceneBounds, selectedNodes, type NodeId } from '../../core/scene';
import type { ProjectState } from '../../core/store';
import { gizmoTransforms, movableTargets, selectionFrame, type GizmoFrame, type GizmoHandle } from '../../core/transform';
import { focusPickAction, objectFrame, objectGizmoAction, sameObject, selectedObject, type ViewObject } from '../../core/view-objects';
import * as cmd from '../commands';
import { newGesture } from '../components/controls';
import { materialDragActive, registerDropZone } from '../components/material-drag';
import { boxSelection } from './viewport-box';
import { confirmBox, openMenu, openMenuAt } from '../components/widgets';
import { h, icon } from '../dom';
import type { IconName } from '../icons';
import { cameraLabel, cameraName, dyn, lightName, targetLabel } from '../names';
import { shallowEq, type Ctx, type Scope } from '../reactive';
import { kbdFor } from '../shortcuts';
import { L, formatNumber, getLang, isaLabel, t } from '../strings';
import { drawAllGlyphs, type Tool } from '../ui-state';
import { partMenu } from './part-menu';
import { aimMenu } from './scene';
import { lightMenuItems, primitiveMenuItems } from './add-menu';
import { openScalePanel } from './scale-panel';
import { cameraMenuEntries } from '../camera-menu';

const SVG_NS = 'http://www.w3.org/2000/svg';

function toolbar(ctx: Ctx, scope: Scope): HTMLElement {
  const { store, ui } = ctx;
  const tools: { id: Tool; icon: IconName; action: string }[] = [
    { id: 'select', icon: 'select', action: 'tool.select' },
    { id: 'orbit', icon: 'orbit', action: 'tool.orbit' },
    { id: 'pan', icon: 'pan', action: 'tool.pan' },
    // The scale tool (phase U9), next to Pan as the roadmap asks.
    { id: 'scale', icon: 'scale', action: 'tool.scale' },
    { id: 'zoom', icon: 'zoom', action: 'tool.zoom' },
    { id: 'move', icon: 'move', action: 'tool.move' },
  ];
  const tip = (tl: { id: Tool; action: string }) =>
    tl.id === 'select' ? `${t(dyn(tl.action))} · ${t('tool.selectBox')}` : tl.id === 'scale' ? `${t('tool.scale')} · ${t('tool.scaleAux')}` : t(dyn(tl.action));
  const buttons = tools.map((tl) =>
    h(
      'button',
      {
        type: 'button',
        class: 'icon-btn',
        'aria-label': t(dyn(tl.action)),
        'data-tip': tip(tl),
        'data-kbd': kbdFor(tl.action),
        'data-tool': tl.id,
        onclick: () => cmd.setTool(ctx, tl.id),
      },
      icon(tl.icon, 20),
    ),
  );
  const toolButtons = [...buttons];
  scope.watch((_s, u) => u.tool, (tool) => toolButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(tools[i].id === tool))));
  // Lights and cameras (L4): every light's and saved camera's glyph, or only the selected one's. Left of Pan, so the
  // scale tool (U9) stays on its right.
  const glyphs = h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('viewport.glyphs'), 'data-tip': `${t('viewport.glyphs')} · ${t('viewport.glyphsAux')}`, 'data-glyphs': '', onclick: () => cmd.toggleGlyphs(ctx) }, icon('glyphs', 20));
  scope.watch((_s, u) => u.showGlyphs, (on) => glyphs.setAttribute('aria-pressed', String(on)));
  buttons.splice(tools.findIndex((x) => x.id === 'pan'), 0, glyphs);
  // Look through (L4): shown when a light or a saved camera is selected, or while looking through one.
  const look = h('button', { type: 'button', class: 'ov-text-btn', 'data-tip': t('viewport.lookThroughAux'), 'data-kbd': kbdFor('lookThrough'), 'data-look': '', onclick: () => cmd.toggleLookThrough(ctx) });
  scope.watch(
    (_s, u) => [u.lookThrough !== null, cmd.lookThroughTarget(ctx) !== null] as const,
    ([on, can]) => {
      look.style.display = on || can ? '' : 'none';
      look.textContent = on ? t('viewport.lookThroughBack') : t('viewport.lookThrough');
      look.setAttribute('aria-pressed', String(on));
    },
    (a, b) => a[0] === b[0] && a[1] === b[1],
  );
  // Axes of the move tool, shown while it is on (L / G).
  const space = h('button', { type: 'button', class: 'ov-text-btn', 'data-tip': t('viewport.space'), 'data-kbd': `${kbdFor('space.local')} / ${kbdFor('space.global')}` });
  space.addEventListener('click', () => cmd.setSpace(ctx, ui.get().space === 'LOCAL' ? 'GLOBAL' : 'LOCAL'));
  scope.watch(
    (_s, u) => [u.tool, u.space] as const,
    ([tool, sp]) => {
      space.style.display = tool === 'move' || tool === 'scale' ? '' : 'none';
      space.textContent = t(dyn(`space.${sp}`));
      space.setAttribute('aria-pressed', String(sp === 'LOCAL'));
      space.setAttribute('aria-label', `${t('viewport.space')}: ${t(dyn(`space.${sp}`))}`);
    },
    (a, b) => a[0] === b[0] && a[1] === b[1],
  );
  // X-ray of the box selection at the Faces level: hidden faces count too.
  const xray = h('button', { type: 'button', class: 'ov-text-btn', 'data-tip': t('viewport.xrayAux'), onclick: () => ui.set({ boxXray: !ui.get().boxXray }) }, t('viewport.xray'));
  scope.watch(
    (s, u) => [s.selection.level === 'FACES' && (u.tool === 'select' || u.tool === 'move' || u.tool === 'scale'), u.boxXray] as const,
    ([show, on]) => {
      xray.style.display = show ? '' : 'none';
      xray.setAttribute('aria-pressed', String(on));
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
  return h('div', { class: 'ov ov-tl', role: 'toolbar', 'aria-label': t('viewport.views'), 'data-guide': 'tools' }, ...buttons, space, xray, look, h('span', { class: 'ov-sep' }), frame, views, proj, h('span', { class: 'ov-sep' }), lock);
}

function topRight(ctx: Ctx, scope: Scope): HTMLElement {
  const { store } = ctx;
  const camBtn = h('button', { type: 'button', class: 'ov-text-btn', 'aria-haspopup': 'menu', 'data-tip': t('viewport.cameraList') });
  camBtn.addEventListener('click', () => openMenu(camBtn, cameraMenuEntries(ctx), 'end'));
  const resBtn = h('button', { type: 'button', class: 'ov-text-btn', 'data-tip': t('viewport.output'), onclick: () => cmd.openRenderWindow(ctx) });
  scope.watch(
    (s) => [s.camera, s.render.width, s.render.height],
    () => {
      const s = store.get();
      camBtn.replaceChildren(icon('camera', 16), h('span', null, cameraName(s, activeCamera(s))));
      camBtn.style.display = 'inline-flex';
      camBtn.style.alignItems = 'center';
      camBtn.style.gap = '6px';
      // The camera's ratio with the size: the frame is the camera's, the size is what the render window says (U13).
      resBtn.textContent = `${aspectText(activeCamera(s).aspect)} · ${s.render.width} × ${s.render.height}`;
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
  const title = h('div', { style: 'font-weight:600;font-size:var(--fs-label)' });
  const line = h('div', { class: 'aux tabular' });
  const bar = h('div', { class: 'bar-meter' }, h('div', { style: 'width:0%' }));
  const note = h('div', { class: 'note', style: 'font-size:var(--fs-aux)' });
  // E5b-1: what the engine says of the image on screen (denoised, caustics) and the Full viewport's denoise switch.
  const extras = h('div', { class: 'aux tabular', 'data-meter-extras': '' });
  // U11: the same switch as the top bar's Denoise and `D` (one state: Advanced ▸ Denoise ▸ Viewport).
  const denoiseBtn = h('button', {
    type: 'button',
    class: 'btn-link ov-denoise',
    'aria-pressed': 'false',
    'data-tip': t('viewport.denoiseTip'),
    'data-kbd': kbdFor('viewportDenoise'),
    onclick: () => cmd.toggleViewportDenoise(ctx),
  }, t('viewport.denoiseToggle'));
  // Without the engine, a way to its settings (UI.md §2.9: deep links).
  const engineLink = h('button', { type: 'button', class: 'btn-link ov-engine-link', 'data-settings-link': 'engine', onclick: () => cmd.openSettings(ctx, 'engine') }, t('viewport.engineSettings'));
  const el = h('div', { class: 'ov ov-bl', role: 'status', 'aria-live': 'off', 'data-guide': 'meter' }, title, line, extras, bar, note, denoiseBtn, engineLink);
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
      // While a Render runs the viewport shares the engine (and says with how much of it), or waits.
      title.textContent = st.rendering && st.renderShare === 'SHARED' && st.share
        ? t(st.native ? 'viewport.meterSharingThreads' : 'viewport.meterSharingWorkers', { n: st.share.n, total: st.share.of })
        : st.rendering && st.renderShare === 'PAUSED'
        ? t('viewport.meterRendering')
        : scale >= 4
          ? t('viewport.meterQuarter')
          : scale >= 2
            ? t('viewport.meterHalf')
            : t('viewport.meterFull', { samples, time: clock(st.seconds) });
      line.textContent = st.native
        ? t('viewport.native', { threads: st.threads ?? 0, isa: isaLabel(st.isa) })
        : t('viewport.pool', { workers: st.workers ?? 0, isa: st.simd ? t('status.isaSimd') : t('status.isaScalar') });
      // What this machine does, measured here (the render window's estimate): pixel-samples per second.
      if (!st.rendering && scale === 1 && st.pixels && st.samples >= 2 && st.seconds >= 2) {
        const tp = (st.samples * st.pixels) / st.seconds;
        const prev = ctx.ui.get().throughput;
        if (prev === null || Math.abs(tp - prev) > prev * 0.1) ctx.ui.set({ throughput: tp });
      }
      // Full mode stops where Settings ▸ Render engine says: the output's samples, N samples, or a time.
      const set = ctx.ui.get().settings;
      const max = set['engine.viewportLimit'] === 'SAMPLES' ? Math.max(1, set['engine.viewportSamples']) : Math.max(1, ctx.store.get().render.maxSamples);
      (bar.firstElementChild as HTMLElement).style.width = `${st.converged ? 100 : Math.min(100, Math.round((st.samples / max) * 100))}%`;
      // Never "0 samples" in silence: when the engine does not answer, refuses the view or had to be restarted,
      // the meter says so (the engine's own words in the tooltip).
      const issue = st.issue;
      note.textContent = !issue
        ? ''
        : issue.kind === 'WAITING'
          ? t('viewport.issueWaiting', { s: issue.seconds ?? 0 })
          : issue.kind === 'FAILED'
            ? issue.seconds
              ? t('viewport.issueFailed', { detail: issue.detail, s: issue.seconds })
              : t('viewport.issueFailedNow', { detail: issue.detail })
            : t('viewport.issueRestarted');
      note.title = issue?.detail ?? '';
      note.style.display = issue ? '' : 'none';
      el.dataset.issue = issue ? issue.kind.toLowerCase() : '';
      // What the engine reports of the image (E5b-1): denoised, and the caustics' photons per sample.
      // E11: and the pixel filter it renders with, when it is not the factory one (Fine): the usual case stays quiet.
      const shownFilter = st.pixelFilter ? pixelFilterSetting(st.pixelFilter) : null;
      const filter = shownFilter !== DEFAULT_PIXEL_FILTER ? shownFilter : null;
      const parts = [
        st.denoised ? t('viewport.meterDenoised') : '',
        st.caustics ? t('viewport.meterCaustics', { n: formatNumber(st.caustics, lang, 0) }) : '',
        filter ? t('viewport.meterFilter', { name: t(dyn(`set.engine.pixelFilter.${filter}`)) }) : '',
      ].filter(Boolean);
      extras.textContent = parts.join(' · ');
      extras.style.display = parts.length ? '' : 'none';
      const on = cmd.viewportDenoiseOn(ctx.store.get());
      denoiseBtn.setAttribute('aria-pressed', String(on));
      // What the live denoise measured (U11): the denoised images shown and the last one's cost, for the checks.
      el.dataset.cleanImages = String(st.liveDenoise?.images ?? 0);
      el.dataset.denoiseMs = st.liveDenoise?.ms !== undefined ? st.liveDenoise.ms.toFixed(0) : '';
      el.dataset.accumulated = String(st.liveDenoise?.accumulated ?? '');
      el.dataset.cleanAt = st.liveDenoise?.at ? st.liveDenoise.at.toFixed(1) : '';
      denoiseBtn.style.display = '';
      el.dataset.denoised = st.denoised ? '1' : '0';
      el.dataset.caustics = String(st.caustics ?? 0);
      el.dataset.pixelFilter = String(st.pixelFilter?.pixelFilter ?? 0);
      el.dataset.edgeSamples = String(st.pixelFilter?.edgeSupersample ?? 1);
    } else {
      // E11: Fast mode's multisampling when it is not the canvas's usual 4×.
      const msaa = st.msaa;
      extras.textContent = msaa && msaa.samples !== 4 ? (msaa.samples > 0 ? t('viewport.meterMsaa', { n: msaa.samples }) : t('viewport.meterNoMsaa')) : '';
      extras.style.display = extras.textContent ? '' : 'none';
      el.dataset.msaa = msaa ? String(msaa.samples) : '';
      denoiseBtn.style.display = 'none';
      title.textContent = t('viewport.meterFast');
      line.textContent = t('viewport.frameMs', { ms: formatNumber(st.seconds * 1000, lang, 1) });
      (bar.firstElementChild as HTMLElement).style.width = st.converged ? '100%' : '30%';
      note.textContent = t('viewport.renderNote');
      note.style.display = '';
    }
    const engine = ctx.ui.get().engine;
    engineLink.style.display = engine === 'READY' || engine === 'LOADING' ? 'none' : '';
    // Machine-readable copies of the same numbers (screenshots and browser checks read them).
    el.dataset.mode = port.kind === 'pathtracer' ? 'full' : 'fast';
    el.dataset.samples = String(st.samples);
    el.dataset.seconds = st.seconds.toFixed(3);
    el.dataset.scale = String(st.scale ?? 1);
    el.dataset.frames = String(st.frames ?? 0);
    el.dataset.frameMs = st.frameMs !== undefined ? st.frameMs.toFixed(1) : '';
    el.dataset.converged = st.converged ? '1' : '0';
    el.dataset.passes = String(st.passes ?? '');
    el.dataset.watchdog = String(st.watchdog ?? 0);
    el.dataset.rendering = st.rendering ? '1' : '0';
    el.dataset.share = st.rendering ? (st.renderShare ?? '').toLowerCase() : '';
    el.dataset.shownKey = st.shownKey ?? '';
    el.dataset.wantKey = st.wantKey ?? '';
    if (port.kind !== 'pathtracer') el.dataset.issue = '';
  };
  scope.onDispose(port.onFrame(() => update()));
  scope.onDispose(() => window.clearTimeout(trailing));
  scope.watch((_s, u) => [u.viewportMode, u.engine].join(), () => update(true));
  // U11: the switch shows at once when the top bar, D or Advanced turns it.
  scope.watch((s) => cmd.viewportDenoiseOn(s), () => update(true));
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
      else if (pm?.kind === 'surface') pickBanner.textContent = t('viewport.pickSurface', { light: lightName(s, pm.light, getLang()) });
      else if (pm?.kind === 'aim') pickBanner.textContent = t(pm.part ? 'viewport.pickAimPart' : 'viewport.pickAim', { light: lightName(s, pm.light, getLang()) });
    },
  );
  // Lights and cameras (L4): the glyphs the viewport draws (all of them, or the selected one's) and what it looks
  // through. Looking through something that is gone (deleted, undone) comes back to the active camera.
  const objectName = (o: ViewObject) => {
    const s = store.get();
    return o.kind === 'LIGHT' ? lightName(s, o.id, getLang()) : cameraName(s, s.camera.cameras[o.id]);
  };
  const lookBanner = h('div', { class: 'ov ov-pick ov-look', role: 'status', style: 'display:none' });
  scope.watch(
    (s, u) => [drawAllGlyphs(u, selectedObject(s)), selectedObject(s), u.lookThrough, s.studio.lights, s.camera] as const,
    ([all, selected, lookThrough]) => {
      const s = store.get();
      if (lookThrough && !cmd.lookThroughTarget(ctx, lookThrough)) {
        cmd.exitLookThrough(ctx);
        return;
      }
      port.setGlyphs({ all, selected, lookThrough });
      lookBanner.style.display = lookThrough ? '' : 'none';
      if (lookThrough) {
        const locked = lookThrough.kind === 'CAMERA' && s.camera.cameras[lookThrough.id]?.locked;
        lookBanner.replaceChildren(
          h('span', null, t(locked ? 'viewport.lookingThroughLocked' : 'viewport.lookingThrough', { name: objectName(lookThrough) })),
          h('button', { type: 'button', class: 'btn-link', onclick: () => cmd.exitLookThrough(ctx) }, t('viewport.lookThroughBack')),
        );
      }
    },
    (a, b) => a[0] === b[0] && sameObject(a[1], b[1]) && sameObject(a[2], b[2]) && a[3] === b[3] && a[4] === b[4],
  );
  scope.onDispose(() => port.setGlyphs({ all: false, selected: null, lookThrough: null }));
  // Machine-readable copies for checks and screenshots, like the meter's: the selected light or camera and where it is.
  scope.onDispose(
    port.onFrame(() => {
      const o = selectedObject(store.get());
      const at = o && port.objectAt ? port.objectAt(o) : null;
      const text = o ? `${o.kind}:${o.id}` : '';
      if (vp.dataset.object !== text) vp.dataset.object = text;
      const where = at ? `${Math.round(at.x)},${Math.round(at.y)}` : '';
      if (vp.dataset.objectAt !== where) vp.dataset.objectAt = where;
      const lt = ui.get().lookThrough;
      const look = lt ? `${lt.kind}:${lt.id}` : '';
      if (vp.dataset.lookThrough !== look) vp.dataset.lookThrough = look;
    }),
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
      // A dragged material owns the outline and the label (its zone, below).
      if (materialDragActive()) return;
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
      // A light's or a camera's glyph (L4): its name, and it is what a click selects.
      const glyph = ui.get().pickMode ? null : port.glyphAt(p.x, p.y);
      vp.toggleAttribute('data-glyph-hover', glyph !== null);
      if (glyph) {
        if (ui.get().hover) ui.set({ hover: null });
        label.textContent = objectName(glyph);
        label.style.display = '';
        label.style.left = `${p.x + 14}px`;
        label.style.top = `${p.y + 12}px`;
        return;
      }
      const tg = targetAt(p.x, p.y);
      // Settings ▸ Preferences ▸ Outline on hover: off, the part under the cursor is not outlined (its name still shows).
      const id = ui.get().settings['selection.hoverOutline'] ? (tg?.id ?? null) : null;
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

  // The move tool (UI.md §2.3): the gizmo sits on the pivot of the selection, in the chosen axes. The scale tool
  // (phase U9) shows the same gizmo with only its scale handles.
  const gizmoIds = (s: ProjectState) => movableTargets(s, selectedNodes(s));
  const gizmoOn = () => (ui.get().tool === 'move' || ui.get().tool === 'scale') && !ui.get().pickMode;
  // A light or a camera selected (L4): the move tool's gizmo without its scale handles, with the aim handle at what
  // it looks at. The scale tool leaves them alone (their size is the inspector's).
  scope.watch(
    (s, u) => [u.tool, u.space, u.pickMode === null, s.selection, s.scene.nodes] as const,
    ([tool, space, free]) => {
      const s = store.get();
      const object = selectedObject(s);
      if (object) {
        port.setGizmo(tool === 'move' && free ? { ids: [], space, handles: 'MOVE', object } : null);
        return;
      }
      const ids = gizmoIds(s);
      port.setGizmo((tool === 'move' || tool === 'scale') && free && ids.length > 0 ? { ids, space, handles: tool === 'scale' ? 'SCALE' : 'ALL' } : null);
    },
    shallowEq,
  );
  scope.onDispose(() => port.setGizmo(null));

  // A drag of a handle: measured by the engine from where it began, applied here from the state at that
  // moment, every step under one gesture token, so the whole drag is one undo entry.
  let drag: { start: ProjectState; ids: NodeId[]; object: ViewObject | null; frame: GizmoFrame; handle: GizmoHandle; gesture: string; pointer: number } | null = null;
  const dragLabel = (handle: GizmoHandle, ids: NodeId[], object: ViewObject | null) => {
    if (object) {
      const s = store.get();
      const name = object.kind === 'LIGHT' ? { en: lightName(s, object.id, 'en'), es: lightName(s, object.id, 'es') } : cameraLabel(s, s.camera.cameras[object.id]);
      const verb = handle === 'aim' ? 'aim' : handle.startsWith('r') ? 'turn' : 'move';
      const key = object.kind === 'LIGHT' ? (verb === 'aim' ? 'undo.aimLight' : verb === 'turn' ? 'undo.turnLight' : 'undo.moveLight') : verb === 'aim' ? 'undo.aimCamera' : verb === 'turn' ? 'undo.turnCamera' : 'undo.moveCamera';
      return L(key, { name });
    }
    const target = targetLabel(store.get(), ids);
    const key = handle === 'aim' ? 'undo.aim' : handle.startsWith('r') ? 'undo.rotate' : handle.startsWith('s') ? 'undo.scale' : 'undo.transform';
    return L(key, { target });
  };
  vp.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target !== canvas || !gizmoOn()) return;
    const p = local(e);
    const s = store.get();
    const object = selectedObject(s);
    const ids = object ? [] : gizmoIds(s);
    const frame = object ? (objectFrame(s, object, ui.get().space)?.frame ?? null) : selectionFrame(s, ids, ui.get().space);
    if (!frame) return;
    const handle = port.gizmoBegin(p.x, p.y);
    if (!handle) return;
    // Taken before the camera controls see it: dragging a handle does not orbit.
    e.stopPropagation();
    e.preventDefault();
    canvas.focus({ preventScroll: true });
    drag = { start: s, ids, object, frame, handle, gesture: newGesture('gizmo'), pointer: e.pointerId };
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
    const label = dragLabel(drag.handle, drag.ids, drag.object);
    if (drag.object) {
      // A light or a camera: measured from the state the drag began in, one gesture token (one undo entry).
      const action = objectGizmoAction(drag.start, drag.object, drag.frame, delta, e.shiftKey, { gesture: drag.gesture, label });
      if (action) store.dispatch(action);
      return;
    }
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
  const clickAt = (e: { clientX: number; clientY: number }, mods: Mods) => {
    const p = local(e);
    const s = store.get();
    const pm = ui.get().pickMode;
    const tg = targetAt(p.x, p.y);
    if (pm) {
      if (!tg) return;
      if (pm.kind === 'focus') {
        // From the camera that is seen (Look through), along its view axis: the engine focuses a plane, not a sphere
        // around the camera.
        const action = focusPickAction(s, ui.get().lookThrough, tg.hit.point, { label: L('undo.focusClick') });
        if (action) store.dispatch(action);
      } else if (pm.kind === 'pivot') {
        cmd.setPivot(ctx, 'CUSTOM', pm.ids, tg.hit.point);
      } else if (pm.kind === 'link') {
        cmd.linkMaterial(ctx, pm.parts, tg.part);
      } else if (pm.kind === 'surface' || pm.kind === 'aim') {
        cmd.finishLightPick(ctx, pm, tg.part, tg.hit.point, tg.hit.normal);
      } else {
        store.dispatch({ type: 'studio/placeLight', id: pm.light, point: tg.hit.point, normal: tg.hit.normal, label: L('undo.placeLight', { name: { en: lightName(s, pm.light, 'en'), es: lightName(s, pm.light, 'es') } }) });
      }
      ui.set({ pickMode: null });
      return;
    }
    // The move and scale tools select with a click too (a drag on a handle never gets here).
    if (ui.get().tool !== 'select' && ui.get().tool !== 'move' && ui.get().tool !== 'scale') return;
    // Plain: replace. Shift: add. Ctrl / Cmd: in or out. Alt: out (UI.md §4.1; the same for a face).
    const mode = clickModeOf(mods);
    // A light's or a camera's glyph (L4) comes before the part behind it: it is drawn over everything. One object
    // at a time (SPEC §3.2): Ctrl / Cmd or Alt on the selected one takes it out.
    const glyph = port.glyphAt(p.x, p.y);
    if (glyph) {
      cmd.selectObject(ctx, glyph, mode === 'toggle' || mode === 'remove' ? 'toggle' : 'set');
      return;
    }
    if (!tg) {
      if (mode === 'set') cmd.deselect(ctx);
      return;
    }
    if (s.selection.level === 'FACES') {
      // Phase M1: the whole face under the pointer; Shift takes the triangle alone (and adds it).
      cmd.selectFaceAt(ctx, tg.part, tg.face, { loose: mods.shift, mode });
      return;
    }
    if (mode === 'remove') {
      if (s.selection.ids.includes(tg.id)) store.dispatch({ type: 'scene/select', ids: [tg.id], mode: 'toggle' });
      return;
    }
    store.dispatch({ type: 'scene/select', ids: [tg.id], mode });
  };
  let down: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
    canvas.focus({ preventScroll: true });
  }, listen);
  canvas.addEventListener('pointerup', (e) => {
    if (!down || e.button !== 0 || materialDragActive()) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > CLICK_PIXELS) return;
    // Alt takes out, except where "Alt + left button orbits": there it is the camera's.
    clickAt(e, clickMods(ui.get().settings['viewport.mouse'], { shift: e.shiftKey, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey }));
  }, listen);
  // Selection by box with the Select tool (UI.md §4.1): Ctrl/Cmd + drag, or a plain drag where the left button is free; see core/box-select.ts.
  const box = boxSelection(ctx, scope, vp, canvas, { busy: () => drag !== null, local, click: clickAt });
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
    // On a light's or a camera's glyph (L4): what acts on it.
    const glyph = port.glyphAt(p.x, p.y);
    if (glyph) {
      cmd.selectObject(ctx, glyph);
      const look = { label: t('viewport.lookThrough'), icon: 'lookThrough' as IconName, kbd: kbdFor('lookThrough'), run: () => cmd.toggleLookThrough(ctx, glyph) };
      openMenuAt(
        e.clientX,
        e.clientY,
        glyph.kind === 'LIGHT'
          ? [look, null, { label: t('common.duplicate'), icon: 'duplicate', run: () => cmd.duplicateLight(ctx, glyph.id) }, { label: t('lights.aimMenu'), icon: 'target', submenu: aimMenu(ctx, glyph.id) }, null, { label: t('common.delete'), icon: 'trash', run: () => cmd.deleteLight(ctx, glyph.id) }]
          : [look, { label: t('camera.activate'), icon: 'camera', run: () => cmd.activateCamera(ctx, glyph.id) }, null, { label: t('common.delete'), icon: 'trash', run: () => cmd.deleteCamera(ctx, glyph.id) }],
      );
      return;
    }
    const tg = targetAt(p.x, p.y);
    if (!tg) {
      // On empty space: Add ▸ Primitive (phase U9) and Light (L4), and what acts on the whole scene.
      const s = store.get();
      const at = { x: e.clientX, y: e.clientY };
      openMenuAt(at.x, at.y, [
        { label: t('menu.add'), icon: 'plus', submenu: [...primitiveMenuItems(ctx), null, ...lightMenuItems(ctx)] },
        null,
        { label: t('viewport.frameAll'), kbd: kbdFor('frame'), disabled: s.scene.roots.length === 0, run: () => cmd.frameSelection(ctx, []) },
        { label: t('tree.showAll'), kbd: kbdFor('showAll'), disabled: !allParts(s).some((q) => !effectiveVisible(s, q)), run: () => cmd.showAll(ctx) },
      ]);
      return;
    }
    const s = store.get();
    let ids = selectedNodes(s);
    if (!ids.includes(tg.id)) {
      store.dispatch({ type: 'scene/select', ids: [tg.id], mode: 'set' });
      ids = [tg.id];
    }
    const at = { x: e.clientX, y: e.clientY };
    openMenuAt(at.x, at.y, partMenu(ctx, ids, { scale: () => openScalePanel(ctx, ids, at) }));
  }, listen);
  canvas.addEventListener('dblclick', (e) => {
    const p = local(e);
    // A double click on a light's or a camera's glyph looks through it (L4).
    const glyph = port.glyphAt(p.x, p.y);
    if (glyph) {
      cmd.toggleLookThrough(ctx, glyph);
      return;
    }
    const tg = targetAt(p.x, p.y);
    if (tg) cmd.frameSelection(ctx, [tg.id]);
  }, listen);

  // A material dragged from the inspector (pointer events, ui/components/material-drag.ts) lands on what a click
  // there would select at the level in force; at Faces, on the whole face under the pointer. The part, the group
  // or the faces light up while it is over them.
  // The face under the pointer is worked out once per triangle, not once per frame.
  let memo: { nodes: ProjectState['scene']['nodes']; level: string; node: NodeId; face: number; target: DropTarget | null } | null = null;
  let tinted: DropTarget | null = null;
  const dropTarget = (x: number, y: number) => {
    const p = local({ clientX: x, clientY: y });
    const s = store.get();
    const hit = port.pick(p.x, p.y);
    if (hit && memo && memo.nodes === s.scene.nodes && memo.level === s.selection.level && memo.node === hit.node && memo.face === hit.face) return { p, target: memo.target };
    const target = viewportDropTarget(s, hit, s.selection.level);
    memo = hit ? { nodes: s.scene.nodes, level: s.selection.level, node: hit.node, face: hit.face, target } : null;
    return { p, target };
  };
  const shown = (target: DropTarget | null) => {
    const ids = target?.kind === 'nodes' ? target.ids[0] : null;
    if (ui.get().hover !== ids) ui.set({ hover: ids });
    const faces = target?.kind === 'faces' ? target : null;
    if (faces === tinted) return;
    tinted = faces;
    port.setHoverFaces(faces ? { part: faces.part, indices: faces.indices } : null);
  };
  scope.onDispose(
    registerDropZone(canvas, {
      over: (pt) => {
        const { p, target } = dropTarget(pt.x, pt.y);
        shown(target);
        const name = target ? store.get().scene.nodes[dropNodes(target)[0]]?.name : undefined;
        label.style.display = name ? '' : 'none';
        if (name) {
          label.textContent = name;
          label.style.left = `${p.x + 14}px`;
          label.style.top = `${p.y + 12}px`;
        }
        return target !== null;
      },
      leave: () => {
        shown(null);
        memo = null;
        label.style.display = 'none';
      },
      drop: (pt, payload) => {
        const src = cmd.parseMaterialDrag(payload);
        const { p, target } = dropTarget(pt.x, pt.y);
        if (!src || !target) return;
        const spec = cmd.requestDrop(ctx, src, target, pt.alt);
        if (spec) {
          confirmHost.style.left = `${Math.max(0, Math.min(p.x, vp.clientWidth - 370))}px`;
          confirmHost.style.top = `${Math.max(0, Math.min(p.y, vp.clientHeight - 140))}px`;
          confirmHost.replaceChildren(confirmBox(spec, () => confirmHost.replaceChildren()));
        }
      },
    }),
  );

  // Model files anywhere on the viewport.
  const isFile = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false;
  vp.addEventListener('dragover', (e) => {
    if (isFile(e)) {
      e.preventDefault();
      vp.classList.add('is-drop-target');
    }
  });
  vp.addEventListener('dragleave', (e) => {
    if (e.target === vp || !vp.contains(e.relatedTarget as Node)) vp.classList.remove('is-drop-target');
  });
  vp.addEventListener('drop', (e) => {
    vp.classList.remove('is-drop-target');
    if (!isFile(e)) return;
    e.preventDefault();
    // A project opens; models go to the import sheet.
    const { files, handles } = cmd.readDrop(e.dataTransfer);
    cmd.dropFiles(ctx, files, handles);
  });

  // Nothing to work with in an empty project, so the tools and the axes are hidden; the guided tour shows the tools there
  // anyway (it is a tour of the screen, and the first start is an empty project).
  const hideWhenEmpty = (el: HTMLElement, shownInTour = false) => {
    scope.watch(
      (s, u) => (s.scene.roots.length === 0 && !(shownInTour && u.tour !== null)) as boolean,
      (hide) => (el.style.visibility = hide ? 'hidden' : ''),
    );
    return el;
  };
  return [hideWhenEmpty(toolbar(ctx, scope), true), topRight(ctx, scope), meter(ctx, scope), hideWhenEmpty(axes(ctx, scope)), label, box, pickBanner, lookBanner, confirmHost];
}
