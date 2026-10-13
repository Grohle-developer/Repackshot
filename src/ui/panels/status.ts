// Status bar (UI.md §2.6): the Doctor (dot + count, opens its popover),
// parts, triangles, engine and device, samples and time; language and
// version on the right. Everything printed here comes from the state or
// from engine.status().

import { DOCTOR_CHECKS } from '../../data/doctor';
import { warningCount, type DoctorResult } from '../../core/doctor';
import { allParts, triangleCount } from '../../core/scene';
import { VERSION } from '../../core/version';
import * as cmd from '../commands';
import { openFloating } from '../components/widgets';
import { h } from '../dom';
import { dyn } from '../names';
import { Scope, type Ctx } from '../reactive';
import { formatClock, formatNumber, getLang, lbl, t } from '../strings';

function sentence(r: DoctorResult): string {
  const d = r.detail;
  switch (r.key) {
    case 'scale':
      if (d.factor === 1000) return t('doctor.scale.metres', { actual: formatNumber(Number(d.actual), getLang(), 4) });
      if (d.factor === 0.001) return t('doctor.scale.micro', { actual: formatNumber(Number(d.actual), getLang(), 4) });
      return t(d.reason === 'preset' ? 'doctor.scale.preset' : 'doctor.scale.declared', { actual: Number(d.actual), expected: Number(d.expected) });
    case 'transform':
      return t('doctor.transform', { count: Number(d.count) });
    case 'origin':
      return t('doctor.origin', { gap: Number(d.floorGap) });
    case 'shading':
      return t('doctor.shading', { name: String(d.name) });
    case 'bevel':
      return t('doctor.bevel', { count: Number(d.count) });
    case 'clip':
      return t('doctor.clip', { clipStart: Number(d.clipStart) });
    case 'lights':
      return t('doctor.lights', { count: Number(d.count) });
    default:
      return '';
  }
}

function doctorPopover(ctx: Ctx, scope: Scope): HTMLElement {
  const el = h('div', { class: 'doctor', role: 'dialog', 'aria-label': t('doctor.title') });
  scope.watch(
    (s) => s.doctor.results,
    (results) => {
      const fixable = results.some((r) => r.status === 'WARN' && r.fixable);
      const rows = results.map((r) => {
        const check = DOCTOR_CHECKS.find((c) => c.key === r.key)!;
        const warn = r.status === 'WARN';
        const text = warn ? sentence(r) : r.status === 'UNAVAILABLE' ? t('doctor.unavailable') : lbl(check.checks);
        let action: HTMLElement | null = null;
        if (warn && r.fixable) action = h('button', { type: 'button', class: 'btn', 'data-tip': lbl(check.fix), onclick: () => cmd.doctorFix(ctx, r.key) }, t('doctor.fix'));
        else if (warn) action = h('span', { class: 'aux' }, t('doctor.fixSoon'));
        else if (r.status === 'OK') action = h('span', { class: 'aux' }, t('doctor.ok'));
        return h(
          'div',
          { class: `doctor-row${warn ? ' is-warn' : ''}` },
          h('span', { class: `status-dot${warn ? ' is-filled' : ''}`, style: r.status === 'UNAVAILABLE' ? 'opacity:0.4' : '' }),
          h('div', null, h('div', { class: 'doctor-title' }, lbl(check.label)), h('div', { class: 'note' }, text)),
          action,
        );
      });
      el.replaceChildren(
        h('div', { class: 'row', style: 'justify-content:space-between;padding:2px 4px 6px' }, h('strong', null, t('doctor.title')), h('button', { type: 'button', class: 'btn btn-primary', disabled: !fixable, onclick: () => cmd.doctorFixAll(ctx) }, t('doctor.fixAll'))),
        ...rows,
      );
    },
  );
  return el;
}

export function statusBar(ctx: Ctx, scope: Scope): HTMLElement {
  const { store, ui, services } = ctx;
  const dot = h('span', { class: 'status-dot' });
  const label = h('span');
  const doctorBtn = h('button', { type: 'button', class: 'doctor-btn', 'aria-haspopup': 'dialog' }, dot, label);
  let popScope: Scope | null = null;
  const openDoctor = () => {
    popScope?.dispose();
    popScope = scope.child();
    const sc = popScope;
    openFloating(doctorBtn, doctorPopover(ctx, sc), {
      above: true,
      onClose: () => {
        sc.dispose();
        if (ui.get().doctorOpen) ui.set({ doctorOpen: false });
      },
    });
  };
  doctorBtn.addEventListener('click', () => ui.set({ doctorOpen: !ui.get().doctorOpen }));
  scope.watch((_s, u) => u.doctorOpen, (open) => {
    if (open) openDoctor();
    else popScope?.dispose();
  });
  scope.watch(
    (s) => s.doctor.results,
    (results) => {
      const n = warningCount(results);
      dot.classList.toggle('is-filled', n > 0);
      label.className = n > 0 ? 'warn-text' : '';
      label.textContent = n === 0 ? t('status.allGood') : n === 1 ? t('status.warning') : t('status.warnings', { n });
    },
  );
  const counts = h('span', { class: 'tabular' });
  scope.watch(
    (s) => s.scene.nodes,
    () => {
      const s = store.get();
      const n = allParts(s).length;
      counts.textContent = `${n === 1 ? t('status.part') : t('status.parts', { n })} · ${t('status.triangles', { n: formatNumber(triangleCount(s), getLang(), 0) })}`;
    },
  );
  const engine = h('span');
  const samples = h('span', { class: 'tabular' });
  const port = services.viewport;
  if (port) {
    let last = 0;
    let trailing = 0;
    const update = () => {
      const now = performance.now();
      if (now - last < 500) {
        if (!trailing) trailing = window.setTimeout(() => ((trailing = 0), (last = 0), update()), 500 - (now - last));
        return;
      }
      last = now;
      const st = port.status();
      engine.textContent =
        port.kind === 'pathtracer'
          ? t('status.engineFull', { workers: st.workers ?? 0, isa: st.simd ? t('status.isaSimd') : t('status.isaScalar') })
          : t('status.engineFast', { device: st.device });
      const n = st.samples === 1 ? t('viewport.sample') : t('viewport.samples', { n: formatNumber(st.samples, getLang(), 0) });
      // The path tracer reports the time it has been converging; the preview, the time of its last frame.
      samples.textContent = port.kind === 'pathtracer' ? `${n} · ${formatClock(st.seconds)}` : `${n} · ${formatNumber(st.seconds * 1000, getLang(), 1)} ms`;
    };
    scope.onDispose(port.onFrame(update));
    scope.onDispose(() => window.clearTimeout(trailing));
    update();
  } else engine.textContent = t('status.noEngine');
  const langBtn = h('button', { type: 'button', class: 'doctor-btn', onclick: () => cmd.setLanguage(ctx, store.get().meta.lang === 'en' ? 'es' : 'en'), 'data-tip': t('menu.language') }, t(dyn(`lang.${store.get().meta.lang}`)));
  return h(
    'footer',
    { class: 'status' },
    doctorBtn,
    h('span', { class: 'sep' }),
    counts,
    h('span', { class: 'sep' }),
    engine,
    h('span', { class: 'sep' }),
    samples,
    h('div', { class: 'status-right' }, langBtn, h('span', { class: 'tabular' }, `v${VERSION}`)),
  );
}
