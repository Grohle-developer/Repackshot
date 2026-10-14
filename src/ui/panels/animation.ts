// Animation drawer (phase N6, UI.md §2.5): a timeline of three zones, the way an animation workspace or the strips of
// an editor lay it out. Left, the tree of what is animated (what); centre, the ruler and the bars (when); right, the
// properties of the selected animation (how). Above them the transport. The tree and the lanes are one grid, so a row
// of the tree is always level with its lane: the tree column stays put while the lanes scroll under it.
// Selecting an animation outlines its target in the viewport and draws its track there; selecting a part in the scene
// marks the rows that move it. The keys (Space, Home, End, ← →, Delete, Ctrl D) work while the focus is in the drawer.

import { clipConflicts, totalDuration } from '../../core/animation';
import { timelineRows, timelineSpan } from '../../core/timeline';
import * as anim from '../anim-commands';
import * as cmd from '../commands';
import { numberField } from '../components/controls';
import { openMenu } from '../components/widgets';
import { h, icon } from '../dom';
import { shallowEq, type Ctx, type Scope } from '../reactive';
import { L, formatNumber, getLang, lbl, t } from '../strings';
import { SEQUENCE_PRESETS } from '../../data/animation';
import { propsColumn } from './anim-props';
import { laneCell, rulerCell, TimelineDrags, type Geometry } from './anim-timeline';
import { treeCell, type RowInfo } from './anim-tree';

/** Width of the tree column, px. */
export const TREE_W = 232;

function secs(v: number): string {
  return `${formatNumber(v, getLang(), 2)} s`;
}

function head(ctx: Ctx, scope: Scope): HTMLElement {
  const { store, ui } = ctx;
  const btn = (ic: Parameters<typeof icon>[0], label: string, run: () => void, extra: Record<string, unknown> = {}) =>
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': label, 'data-tip': label, onclick: run, ...extra }, icon(ic));
  const play = h('button', { type: 'button', class: 'icon-btn', 'data-anim-play': '', onclick: () => anim.playPause(ctx) });
  const start = btn('rewind', t('anim.stop'), () => anim.toStart(ctx));
  const end = btn('toEnd', t('anim.toEnd'), () => anim.toEnd(ctx));
  const loop = btn('loop', t('anim.loop'), () => ui.set({ animLoop: !ui.get().animLoop }));
  const time = h('span', { class: 'tabular anim-time', 'data-anim-time': '' });
  const frame = h('span', { class: 'aux tabular' });
  const fps = numberField({ value: store.get().animation.fps, min: 1, max: 120, step: 1, unit: t('anim.fps'), ariaLabel: t('anim.fps'), onChange: (v, g) => store.dispatch({ type: 'anim/setFps', fps: v, gesture: g, label: L('undo.fps') }) });
  fps.el.style.width = '84px';
  scope.watch(
    (s, u) => [s.animation.playing, s.animation.playhead, s.animation.fps, s.animation.shots, s.animation.clips, u.animLoop],
    () => {
      const s = store.get();
      const a = s.animation;
      play.replaceChildren(icon(a.playing ? 'pause' : 'play'));
      play.setAttribute('aria-label', a.playing ? t('anim.pause') : t('anim.play'));
      play.setAttribute('data-tip', a.playing ? t('anim.pause') : t('anim.play'));
      play.setAttribute('data-kbd', t('key.space'));
      const total = totalDuration(s);
      time.textContent = `${secs(a.playhead)} / ${secs(total)}`;
      frame.textContent = t('anim.frame', { n: Math.round(a.playhead * a.fps) });
      fps.set(a.fps);
      play.toggleAttribute('disabled', total <= 0);
      loop.setAttribute('aria-pressed', String(ui.get().animLoop));
    },
    shallowEq,
  );
  const zoom = (k: number) => ui.set({ animZoom: Math.min(16, Math.max(1, k === 0 ? 1 : ui.get().animZoom * k)) });
  const zoomOut = btn('minus', t('anim.zoomOut'), () => zoom(0.5));
  const zoomFit = btn('frame', t('anim.zoomFit'), () => zoom(0));
  const zoomIn = btn('plus', t('anim.zoomIn'), () => zoom(2));
  scope.watch((_s, u) => u.animZoom, (z) => {
    zoomOut.toggleAttribute('disabled', z <= 1);
    zoomFit.toggleAttribute('disabled', z <= 1);
  });
  // "+ Animate Cap…": the wizard with the scene's selection as its target.
  const animate = h('button', { type: 'button', class: 'btn btn-primary', 'data-anim-animate': '', 'data-tip': t('anim.animateTip'), onclick: () => anim.openWizard(ctx) });
  scope.watch(
    (s) => anim.animateTargetName(s),
    (name) => animate.replaceChildren(icon('plus', 14), name ? t('anim.animateThis', { name }) : t('anim.animate')),
  );
  const presets = h('button', { type: 'button', class: 'btn', 'aria-haspopup': 'menu', 'data-tip': t('anim.presetsTip') }, t('anim.presets'), icon('chevronDown', 12));
  presets.addEventListener('click', () => openMenu(presets, SEQUENCE_PRESETS.map((p) => ({ label: lbl(p.label), run: () => anim.applyPreset(ctx, p.key) }))));
  // Animations render from the render window in Animation mode (UI.md §2.5).
  const video = h(
    'button',
    {
      type: 'button',
      class: 'btn',
      'data-tip': t('anim.renderTip'),
      onclick: () => {
        if (store.get().render.mode !== 'ANIMATION') store.dispatch({ type: 'render/set', patch: { mode: 'ANIMATION' }, label: L('undo.render') });
        cmd.openRenderWindow(ctx);
      },
    },
    icon('film', 14),
    t('anim.renderAnimation'),
  );
  return h(
    'div',
    { class: 'anim-head', 'data-tip-keys': t('anim.keys') },
    play,
    start,
    end,
    loop,
    time,
    frame,
    fps.el,
    h('span', { class: 'ov-sep' }),
    zoomOut,
    zoomFit,
    zoomIn,
    h('span', { style: 'flex:1' }),
    animate,
    presets,
    video,
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('render.drawerClose'), 'data-tip': t('render.drawerClose'), onclick: () => ui.set({ drawer: null }) }, icon('close')),
  );
}

/** The tree and the lanes, one grid of rows under the ruler. */
function rows(ctx: Ctx, scope: Scope): HTMLElement {
  const { store, ui } = ctx;
  const host = h('div', { class: 'anim-rows', tabindex: 0, role: 'tree', 'aria-label': `${t('anim.tree')} · ${t('anim.keys')}` });
  const grid = h('div', { class: 'anim-grid', style: `--tree-w:${TREE_W}px` });
  host.append(grid);
  const playhead = h('div', { class: 'tl-playhead', 'aria-hidden': 'true' }, h('span', { class: 'tl-playhead-cap' }));
  const snapLine = h('div', { class: 'tl-snap', 'aria-hidden': 'true', style: 'display:none' });
  let geo: Geometry = { pxPerS: 40, span: 4, width: 160 };
  const measure = (): Geometry => {
    const s = store.get();
    const span = drags.frozen ?? timelineSpan(s);
    const fit = Math.max(120, (host.clientWidth || 800) - TREE_W - 16);
    const zoom = ui.get().animZoom;
    const pxPerS = (fit * zoom) / span;
    return { pxPerS, span, width: span * pxPerS };
  };
  const placePlayhead = () => {
    const p = store.get().animation.playhead;
    playhead.style.left = `${TREE_W + p * geo.pxPerS}px`;
    playhead.dataset.t = String(p);
  };
  const showSnap = (hit: number | null) => {
    snapLine.style.display = hit === null ? 'none' : '';
    if (hit !== null) snapLine.style.left = `${TREE_W + hit * geo.pxPerS}px`;
  };
  const drags = new TimelineDrags(ctx, () => geo, showSnap, () => rebuild());
  const rebuild = () => {
    const s = store.get();
    const u = ui.get();
    geo = measure();
    grid.style.setProperty('--lanes-w', `${geo.width}px`);
    host.dataset.pxPerS = String(geo.pxPerS);
    const list = timelineRows(s, u.animFolded);
    const selected = anim.selectedClipIds(ctx);
    const info: RowInfo = { selected: new Set(selected), primary: u.selectedClip, related: anim.relatedClips(s), conflicts: clipConflicts(s) };
    const cells: Node[] = [h('div', { class: 'anim-corner aux' }, t('anim.tree')), rulerCell(ctx, geo, drags)];
    for (const r of list) cells.push(treeCell(ctx, r, info), laneCell(ctx, r, geo, info, drags));
    if (s.animation.clips.length === 0) cells.push(h('div', { class: 'atr atr-empty note' }, t('anim.treeEmpty')), h('div', { class: 'tl-lane is-empty' }));
    grid.replaceChildren(...cells, playhead, snapLine);
    placePlayhead();
  };
  scope.watch(
    (s, u) => [s.animation.clips, s.animation.shots, s.animation.fps, s.scene.nodes, s.scene.roots, s.studio.lights, s.selection, s.camera.cameras, u.animFolded, u.selectedClips, u.selectedClip, u.animZoom],
    () => rebuild(),
    shallowEq,
  );
  scope.watch((s) => s.animation.playhead, placePlayhead);
  const ro = new ResizeObserver(() => {
    if (!drags.active) rebuild();
  });
  ro.observe(host);
  scope.onDispose(() => ro.disconnect());
  // A press anywhere in the rows puts the keys there (bars and rows are not focusable on their own); one on an empty
  // part of a lane clears the selection of clips.
  host.addEventListener(
    'pointerdown',
    (e) => {
      const el = e.target as HTMLElement;
      if (!el.closest('button, select, input, [role="spinbutton"]')) host.focus({ preventScroll: true });
      if (el.classList.contains('tl-lane') && e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey) anim.clearClips(ctx);
    },
    true,
  );
  return host;
}

export function animationDrawer(ctx: Ctx, scope: Scope): HTMLElement {
  const root = h('div', { class: 'anim', 'data-anim': '' }, head(ctx, scope), rows(ctx, scope), propsColumn(ctx, scope));
  root.addEventListener('keydown', (e) => {
    const el = e.target as HTMLElement;
    // A button takes its own Space, a field and a slider their arrows.
    if ((e.key === ' ' || e.key.startsWith('Arrow')) && el.closest('button, select, input, textarea, [role="spinbutton"], [role="switch"]')) return;
    if (anim.animKey(ctx, e)) {
      e.preventDefault();
      e.stopPropagation();
    }
  });
  // The viewport outlines the selected animations' targets and draws the track of the one the properties edit.
  const port = ctx.services.viewport;
  scope.watch(
    (s, u) => [u.selectedClips, u.selectedClip, s.animation, s.scene.nodes, s.camera],
    () => {
      const hint = anim.hintFor(ctx);
      port?.setMotionHint?.(hint);
      // A machine-readable copy for the browser check: parts outlined, segments of the track, dots.
      root.dataset.hint = hint ? `${hint.highlight.length}:${hint.lines.length / 2}:${hint.dots.length}` : '';
    },
    shallowEq,
  );
  scope.onDispose(() => port?.setMotionHint?.(null));
  return root;
}
