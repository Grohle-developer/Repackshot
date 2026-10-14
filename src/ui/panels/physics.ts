// The physics bar (UI.md §2.5, phase S2): a drawer of the bottom bar next to Animation. ▶ Start · ⏸ Pause / ▶ Resume
// · ■ Stop · ↺ Reset, then what the simulator reports (simulated time, bodies awake) and the state, stopped by
// default: nothing runs until the person starts it or drops something. Every run records itself into the animation.

import { h, icon } from '../dom';
import { dyn } from '../names';
import * as phys from '../physics';
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
  const state = h('span', { class: 'phys-state', 'data-field': 'phys.state', role: 'status' });
  const note = h('p', { class: 'note', style: 'margin:0' });
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
      const reported = p.state === 'RUNNING' || p.state === 'PAUSED' || (p.state === 'STOPPED' && p.ended !== null && p.bodies > 0 && p.ended !== 'NOTHING' && p.ended !== 'NO_ENGINE' && p.ended !== 'FAILED');
      time.textContent = reported ? t('phys.time', { t: formatNumber(p.time, getLang(), 2) }) : '';
      awake.textContent = reported ? t('phys.awake', { n: p.awake, total: p.bodies }) : '';
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
      state,
      h('span', { style: 'flex:1' }),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('render.drawerClose'), 'data-tip': t('render.drawerClose'), onclick: () => ui.set({ drawer: null }) }, icon('close')),
    ),
    h('div', { style: 'padding:8px var(--pad)' }, note),
  );
}
