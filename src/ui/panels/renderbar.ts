// Bottom bar (UI.md §2.5): on the left the Animation, Physics (S2) and Queue drawers (Physics with the bodies
// still awake while a simulation runs; Queue
// with the jobs waiting and, while one runs, a thin progress bar on its
// bottom edge, its name and the time left in the tooltip); in the centre the
// last result, which opens the results viewer; on the right Render…, the
// largest button on screen, which opens the render window. The render
// settings live in that window, not here.

import * as cmd from '../commands';
import { h, icon } from '../dom';
import { dynamic, type Ctx, type Scope } from '../reactive';
import { jobFileNames } from '../render-queue';
import { kbdFor } from '../shortcuts';
import { formatClock, getLang, t } from '../strings';
import { animationDrawer } from './animation';
import { physicsDrawer } from './physics';
import { queueDrawer } from './queue';

/** "2 min ago", "just now". */
export function ago(ms: number, now = Date.now()): string {
  const s = Math.round((ms - now) / 1000);
  if (Math.abs(s) < 45) return t('render.justNow');
  try {
    const rtf = new Intl.RelativeTimeFormat(getLang() === 'es' ? 'es' : 'en', { numeric: 'auto' });
    const m = Math.round(s / 60);
    if (Math.abs(m) < 60) return rtf.format(m, 'minute');
    const hr = Math.round(m / 60);
    if (Math.abs(hr) < 24) return rtf.format(hr, 'hour');
    return rtf.format(Math.round(hr / 24), 'day');
  } catch {
    return '';
  }
}

/** The name of a result without its extension. */
function baseName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

export function renderBar(ctx: Ctx, scope: Scope): HTMLElement {
  const { store, ui } = ctx;

  const drawerBtn = (id: 'animation' | 'physics' | 'queue', label: string, iconName: 'film' | 'queue' | 'drop') =>
    h('button', { type: 'button', class: 'btn drawer-btn', 'aria-pressed': 'false', 'data-drawer': id, onclick: () => ui.set({ drawer: ui.get().drawer === id ? null : id }) }, icon(iconName, 14), h('span', null, label));
  const animBtn = drawerBtn('animation', t('render.animation'), 'film');
  const physBtn = drawerBtn('physics', t('render.physics'), 'drop');
  physBtn.setAttribute('data-tip', t('render.physicsTip'));
  const physBadge = h('span', { class: 'badge tabular', 'aria-hidden': 'true', style: 'display:none' });
  physBtn.append(physBadge);
  scope.watch(
    (_s, u) => u.physics,
    (p) => {
      // While a run is on: the bodies still awake, as the simulator counts them.
      const on = p.state === 'RUNNING' || p.state === 'PAUSED';
      physBadge.textContent = on ? String(p.awake) : '';
      physBadge.style.display = on ? '' : 'none';
      physBtn.classList.toggle('is-running', on);
    },
  );
  const queueBtn = drawerBtn('queue', t('render.queue'), 'queue');
  const badge = h('span', { class: 'badge tabular', 'aria-hidden': 'true' });
  const edge = h('span', { class: 'progress-edge', style: 'width:0' });
  queueBtn.append(badge, edge);
  scope.watch((_s, u) => u.drawer, (d) => {
    animBtn.setAttribute('aria-pressed', String(d === 'animation'));
    physBtn.setAttribute('aria-pressed', String(d === 'physics'));
    queueBtn.setAttribute('aria-pressed', String(d === 'queue'));
  });
  scope.watch(
    (s) => [s.render.queue, s.render.running] as const,
    ([queue, running]) => {
      const waiting = queue.filter((j) => j.status === 'QUEUED' || j.status === 'RUNNING').length;
      badge.textContent = waiting > 0 ? String(waiting) : '';
      badge.style.display = waiting > 0 ? '' : 'none';
      const job = running?.jobId ? queue.find((j) => j.id === running.jobId) : undefined;
      edge.style.width = running ? `${Math.round(Math.min(1, running.progress) * 100)}%` : '0';
      queueBtn.classList.toggle('is-running', running !== null);
      let tip = waiting === 0 ? t('render.queueEmptyTip') : t('render.queueTip', { n: waiting });
      if (running && job) {
        const name = baseName(jobFileNames(store.get(), job)[0] ?? '');
        const elapsed = job.startedAt ? (Date.now() - job.startedAt) / 1000 : running.seconds;
        const p = running.progress;
        const left = p > 0.02 ? (elapsed * (1 - p)) / p : null;
        tip = left === null ? t('render.queueRunningTip', { name }) : t('render.queueLeftTip', { name, left: formatClock(left) });
      }
      queueBtn.setAttribute('data-tip', tip);
      queueBtn.setAttribute('aria-label', `${t('render.queue')}: ${tip}`);
    },
    (a, b) => a[0] === b[0] && a[1] === b[1],
  );

  // The last result: "Bottle_Camera 1 · 1920 × 1080 · 2 min ago"; click opens it.
  const last = h('button', { type: 'button', class: 'last-result', 'data-tip': t('render.lastResultTip'), onclick: () => cmd.openLastResult(ctx) });
  const paintLast = () => {
    const r = ui.get().results[0];
    last.style.visibility = r ? 'visible' : 'hidden';
    if (!r) {
      last.replaceChildren();
      return;
    }
    const pic = r.thumb ? h('img', { src: r.thumb, alt: '', class: 'last-result-pic' }) : null;
    last.replaceChildren(pic ?? '', h('span', { class: 'aux tabular' }, `${baseName(r.name)} · ${r.width} × ${r.height} · ${ago(r.createdAt)}`));
  };
  scope.watch((_s, u) => u.results[0], paintLast);
  // "2 min ago" moves on by itself.
  const timer = window.setInterval(paintLast, 30000);
  scope.onDispose(() => window.clearInterval(timer));

  const renderBtn = h(
    'button',
    { type: 'button', class: 'btn btn-primary btn-big render-btn', 'data-kbd': kbdFor('render'), 'data-tip': t('render.renderWindowTip'), 'data-guide': 'render', onclick: () => cmd.openRenderWindow(ctx) },
    t('render.renderWindow'),
  );

  const drawer = dynamic(
    scope,
    (_s, u) => u.drawer,
    (sc, d) => (d === 'animation' ? animationDrawer(ctx, sc) : d === 'physics' ? physicsDrawer(ctx, sc) : d === 'queue' ? queueDrawer(ctx, sc) : null),
    undefined,
    'div',
    'drawer-host',
  );
  scope.watch((_s, u) => u.drawer, (d) => {
    drawer.classList.toggle('drawer', d !== null);
    drawer.dataset.drawer = d ?? '';
  });

  const bar = h(
    'div',
    { class: 'bar', role: 'toolbar', 'aria-label': t('render.barLabel') },
    h('div', { class: 'bar-group' }, animBtn, physBtn, queueBtn),
    h('div', { class: 'bar-mid' }, last),
    h('div', { class: 'render-btn-wrap' }, renderBtn),
  );
  return h('section', { class: 'bar-wrap' }, drawer, bar);
}
