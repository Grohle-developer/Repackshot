// The physics bar (UI.md §2.5, phase S2): a drawer of the bottom bar next to Animation. ▶ Start · ⏸ Pause / ▶ Resume
// · ■ Stop · ↺ Reset, then what the simulator reports (simulated time, bodies awake) and the state, stopped by
// default: nothing runs until the person starts it or drops something. Every run records itself into the animation.
// S3b: with a front glass fed by the scene, what its last frame holds (drops, motes of dust).
// U16: while stopped, one line says what Start would simulate, from the scene as it is (core/start-plan.ts): the
// dynamic parts, the rain, dust and snow on the parts (and the parts that keep dry or clean), the front glass; or that
// there is nothing to simulate, and how to give it something.

import { startPlan } from '../../core/start-plan';
import { h, icon } from '../dom';
import { dyn } from '../names';
import * as phys from '../physics';
import { planLine } from '../physics-lines';
import type { Ctx, Scope } from '../reactive';
import { formatNumber, getLang, t } from '../strings';
import type { PhysicsUi } from '../ui-state';

function stateText(p: PhysicsUi): string {
  if (p.state !== 'STOPPED') return t(dyn(`phys.state.${p.state}`));
  switch (p.ended) {
    case 'SETTLED':
    case 'STOPPED':
    case 'NO_ENGINE':
    case 'FAILED':
    case 'NOTHING':
      return t(dyn(`phys.ended.${p.ended}`));
    case 'TIME':
      return t('phys.ended.TIME', { s: formatNumber(p.time, getLang(), 1) });
    default:
      return t('phys.state.STOPPED');
  }
}

export function physicsDrawer(ctx: Ctx, scope: Scope): HTMLElement {
  const { ui } = ctx;
  const btn = (name: Parameters<typeof icon>[0], text: string, run: () => void, action: string) =>
    h('button', { type: 'button', class: 'btn', 'data-action': action, onclick: run }, icon(name, 14), h('span', null, text));
  const start = btn('play', t('phys.start'), () => phys.start(ctx), 'phys.start');
  const pause = btn('pause', t('phys.pause'), () => (ui.get().physics.state === 'PAUSED' ? phys.resume(ctx) : phys.pause(ctx)), 'phys.pause');
  const stop = btn('stop', t('phys.stop'), () => phys.stop(ctx), 'phys.stop');
  const reset = btn('refresh', t('phys.reset'), () => phys.reset(ctx), 'phys.reset');
  stop.setAttribute('data-tip', t('phys.stopTip'));
  reset.setAttribute('data-tip', t('phys.resetTip'));
  start.setAttribute('data-tip', t('phys.startTip'));
  const time = h('span', { class: 'tabular', 'data-field': 'phys.time' });
  const awake = h('span', { class: 'aux tabular', 'data-field': 'phys.awake', 'data-tip': t('phys.awakeTip') });
  // S3b: the front glass fed by the scene, as the engine's last frame left it.
  const glass = h('span', { class: 'aux tabular', 'data-field': 'phys.glass', 'data-tip': t('phys.glassTip') });
  // S3c: the parts under the scene's rain, dust and snow, as the engine's last frame left them.
  const parts = h('span', { class: 'aux tabular', 'data-field': 'phys.parts', 'data-tip': t('phys.partsTip') });
  const state = h('span', { class: 'phys-state', 'data-field': 'phys.state', role: 'status' });
  const note = h('p', { class: 'note', style: 'margin:0' });
  // U16: what Start would simulate now.
  const plan = h('p', { class: 'phys-plan', style: 'margin:0 0 4px', 'data-field': 'phys.plan', 'aria-live': 'polite' });
  scope.watch(
    // The active camera's glass and projection, not the whole camera: an orbit does not redo the plan.
    (s, u) => {
      const cam = s.camera.cameras[s.camera.active];
      return [s.scene.nodes, s.materials, s.effects, s.camera.active, cam?.optics?.frontGlass, cam?.projection, s.studio.floor, u.physics.state === 'STOPPED'] as const;
    },
    (v) => {
      const stopped = v[7];
      plan.style.display = stopped ? '' : 'none';
      if (stopped) plan.textContent = planLine(startPlan(ctx.store.get()));
    },
    (a, b) => a.every((x, i) => x === b[i]),
  );
  scope.watch(
    (_s, u) => u.physics,
    (p) => {
      const running = p.state !== 'STOPPED';
      start.toggleAttribute('disabled', running);
      pause.toggleAttribute('disabled', !running || p.state === 'STARTING');
      stop.toggleAttribute('disabled', !running);
      reset.toggleAttribute('disabled', !p.canReset && !running);
      const paused = p.state === 'PAUSED';
      pause.replaceChildren(icon(paused ? 'play' : 'pause', 14), h('span', null, t(paused ? 'phys.resume' : 'phys.pause')));
      pause.setAttribute('data-tip', t(paused ? 'phys.resumeTip' : 'phys.pauseTip'));
      pause.setAttribute('aria-pressed', String(paused));
      // Only what the simulator said: nothing before it has said it.
      const reported = p.state === 'RUNNING' || p.state === 'PAUSED' || (p.state === 'STOPPED' && p.ended !== null && (p.bodies > 0 || !!p.glass || !!p.parts) && p.ended !== 'NOTHING' && p.ended !== 'NO_ENGINE' && p.ended !== 'FAILED');
      time.textContent = reported ? t('phys.time', { t: formatNumber(p.time, getLang(), 2) }) : '';
      awake.textContent = reported && p.bodies > 0 ? t('phys.awake', { n: p.awake, total: p.bodies }) : '';
      glass.textContent = reported && p.glass ? t('phys.glass', { drops: formatNumber(p.glass.drops, getLang(), 0), motes: formatNumber(p.glass.motes, getLang(), 0) }) : '';
      parts.textContent = reported && p.parts ? t('phys.parts', { drops: formatNumber(p.parts.drops, getLang(), 0), drips: formatNumber(p.parts.drips, getLang(), 0), falling: formatNumber(p.parts.falling ?? 0, getLang(), 0) }) : '';
      state.textContent = stateText(p);
      note.textContent = running ? t('phys.fastNote') : t('phys.note');
    },
  );
  return h(
    'div',
    { class: 'phys', role: 'toolbar', 'aria-label': t('phys.bar') },
    h(
      'div',
      { class: 'anim-head phys-head' },
      start,
      pause,
      stop,
      reset,
      h('span', { class: 'phys-sep', 'aria-hidden': 'true' }),
      time,
      awake,
      glass,
      parts,
      state,
      h('span', { style: 'flex:1' }),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('render.drawerClose'), 'data-tip': t('render.drawerClose'), onclick: () => ui.set({ drawer: null }) }, icon('close')),
    ),
    h('div', { style: 'padding:8px var(--pad)' }, plan, note),
  );
}
