// Status bar (UI.md §2.6): the Doctor (dot + count, opens its popover),
// parts, triangles, engine and device, samples and time; language and
// version on the right. Everything printed here comes from the state or
// from engine.status().

import { DOCTOR_CHECKS } from '../../data/doctor';
import { effectPreset } from '../../data/effects';
import { warningCount, type DoctorResult } from '../../core/doctor';
import { allParts, triangleCount } from '../../core/scene';
import type { ProjectState } from '../../core/store';
import { VERSION } from '../../core/version';
import * as cmd from '../commands';
import { confirmBox, openFloating } from '../components/widgets';
import { h } from '../dom';
import { cameraName, dyn } from '../names';
import { Scope, shallowEq, type Ctx } from '../reactive';
import { formatClock, formatNumber, getLang, isaLabel, lbl, t } from '../strings';
import { dismissRuntimeNote, fixRuntime } from '../ai-runtime-state';
import { installActive } from '../../core/updates';
import { cancelInstall, dismissUpdateNotice, downloadUpdate, installFaultText, installRequestFor, installText, installUpdate, openReleaseNotes, restartNow, retryInstall } from '../updates';

/** The sentence of a warning of the Doctor, in the current language (the state names the cameras it speaks of). */
export function doctorSentence(r: DoctorResult, state: ProjectState): string {
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
    case 'aspect':
      return t('doctor.aspect', { count: Number(d.count), camera: cameraName(state, state.camera.cameras[String(d.camera)]), aspect: String(d.aspect), output: String(d.output) });
    case 'particles': {
      const preset = effectPreset(String(d.preset));
      const name = String(d.name ?? '') || (preset ? lbl(preset.label) : '');
      return t('doctor.particles', { name, requested: formatNumber(Number(d.requested), getLang(), 0), cap: formatNumber(Number(d.cap), getLang(), 0) });
    }
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
        const text = warn ? doctorSentence(r, ctx.store.get()) : r.status === 'UNAVAILABLE' ? t('doctor.unavailable') : lbl(check.checks);
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

/**
 * A newer version was found at startup: one quiet line, never a window (UI.md §4.3). On the desktop *Install and
 * restart* does it from inside the application and the line then follows the install (Downloading… 45 %,
 * Verifying…, Installing…, or why it failed with Try again); elsewhere *Download* opens the package for this
 * computer (or the release page). *Release notes* opens the page, *Later* hides the line until the next start.
 */
function updateNotice(ctx: Ctx, scope: Scope): HTMLElement {
  const el = h('span', { class: 'update-notice', role: 'status', 'aria-live': 'polite' });
  // The question about unsaved changes opens above the button that was pressed, in its place (UI.md §4.3).
  const askFrom = (button: HTMLElement) => (spec: Parameters<typeof confirmBox>[0]) => {
    let close = () => undefined as void;
    close = openFloating(button, confirmBox(spec, () => close()), { above: true });
  };
  scope.watch(
    (_s, u) => [u.updates.notice, u.updates.install, u.desktop] as const,
    ([release, install]) => {
      el.hidden = !release;
      el.dataset.version = release?.version ?? '';
      el.dataset.install = install.status.state;
      if (!release) {
        el.replaceChildren();
        return;
      }
      const status = install.status;
      const notes = h('button', { type: 'button', class: 'btn-link update-notes', onclick: () => openReleaseNotes(ctx, release) }, t('up.notes'));
      if (installActive(status)) {
        const ready = status.state === 'INSTALLING' && status.ready;
        const parts: HTMLElement[] = [h('span', { class: 'update-text update-progress' }, ready && install.deferred ? t('up.restartWaiting') : installText(status))];
        if (ready && install.deferred) parts.push(h('button', { type: 'button', class: 'btn-link update-restart', onclick: () => restartNow(ctx) }, t('up.restartNow')));
        else if (status.state !== 'INSTALLING') parts.push(h('button', { type: 'button', class: 'btn-link update-cancel', onclick: () => void cancelInstall(ctx) }, t('common.cancel')));
        el.replaceChildren(...parts, h('span', { class: 'sep' }));
        return;
      }
      if (status.state === 'FAILED') {
        const retry = status.error !== 'not-updatable';
        el.replaceChildren(
          h('span', { class: 'update-text is-fault', 'data-tip': status.message ?? undefined }, t('up.failedInstall', { reason: installFaultText(status.error) })),
          retry
            ? h('button', { type: 'button', class: 'btn-link update-retry', onclick: (e: Event) => retryInstall(ctx, release, askFrom(e.currentTarget as HTMLElement)) }, t('up.retry'))
            : h('button', { type: 'button', class: 'btn-link update-download', onclick: () => downloadUpdate(ctx, release) }, t('up.download')),
          notes,
          h('button', { type: 'button', class: 'btn-link update-later', onclick: () => dismissUpdateNotice(ctx) }, t('up.later')),
          h('span', { class: 'sep' }),
        );
        return;
      }
      const installable = installRequestFor(ctx, release) !== null;
      el.replaceChildren(
        h('span', { class: 'update-text' }, t('up.available', { version: release.version })),
        installable
          ? h('button', { type: 'button', class: 'btn-link update-install', onclick: (e: Event) => installUpdate(ctx, release, askFrom(e.currentTarget as HTMLElement)) }, t('up.install'))
          : h('button', { type: 'button', class: 'btn-link update-download', onclick: () => downloadUpdate(ctx, release) }, t('up.download')),
        notes,
        h('button', { type: 'button', class: 'btn-link update-later', onclick: () => dismissUpdateNotice(ctx) }, t('up.later')),
        h('span', { class: 'sep' }),
      );
    },
    shallowEq,
  );
  return el;
}

/**
 * The inference runtime is missing (or does not start) while a model is installed: one quiet line at the start of the
 * session (phase U10), never a window. *Install* downloads the build (or opens Microsoft's page for Visual C++), the
 * words open Settings ▸ AI post-processing, *Later* hides it until the next start.
 */
function runtimeNote(ctx: Ctx, scope: Scope): HTMLElement {
  const el = h('span', { class: 'update-notice runtime-note', role: 'status', 'aria-live': 'polite', 'data-runtime-note': '' });
  scope.watch(
    (_s, u) => u.runtimeNote.warning,
    (w) => {
      el.hidden = !w;
      el.dataset.kind = w?.kind ?? '';
      if (!w) {
        el.replaceChildren();
        return;
      }
      const kind = w.kind === 'MISSING' || w.kind === 'PAUSED' || w.kind === 'VC_RUNTIME' || w.kind === 'BROKEN' ? w.kind : 'MISSING';
      const fix = w.kind === 'MISSING' || w.kind === 'PAUSED' || w.kind === 'VC_RUNTIME';
      const parts: HTMLElement[] = [h('button', { type: 'button', class: 'btn-link update-text', 'data-tip': t('rt.note.settings'), onclick: () => cmd.openSettings(ctx, 'ai.runtime') }, t(`rt.note.${kind}`))];
      if (fix) {
        parts.push(
          h(
            'button',
            {
              type: 'button',
              class: 'btn-link update-download',
              'data-tip': w.kind === 'VC_RUNTIME' ? t('rt.note.vcTip') : undefined,
              onclick: () => {
                dismissRuntimeNote(ctx);
                void fixRuntime(ctx, w);
              },
            },
            t(w.kind === 'PAUSED' ? 'rt.note.resume' : 'rt.note.install'),
          ),
        );
      }
      parts.push(h('button', { type: 'button', class: 'btn-link update-later', onclick: () => dismissRuntimeNote(ctx) }, t('up.later')));
      el.replaceChildren(...parts, h('span', { class: 'sep' }));
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
  // S4a: what the preview draws of the ambient effects, as the engine evaluated them (hidden without effects).
  const particlesSep = h('span', { class: 'sep', style: 'display:none' });
  const particles = h('span', { class: 'tabular', 'data-meter': 'particles', style: 'display:none' });
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
        port.kind !== 'pathtracer'
          ? t('status.engineFast', { device: st.device })
          : st.native
            ? t('status.engineNative', { threads: st.threads ?? 0, isa: isaLabel(st.isa) })
            : t('status.engineFull', { workers: st.workers ?? 0, isa: st.simd ? t('status.isaSimd') : t('status.isaScalar') });
      const n = st.samples === 1 ? t('viewport.sample') : t('viewport.samples', { n: formatNumber(st.samples, getLang(), 0) });
      // The path tracer reports the time it has been converging; the preview, the time of its last frame.
      samples.textContent = port.kind === 'pathtracer' ? `${n} · ${formatClock(st.seconds)}` : `${n} · ${formatNumber(st.seconds * 1000, getLang(), 1)} ms`;
      const p = port.kind === 'preview' ? st.particles : undefined;
      particles.style.display = particlesSep.style.display = p ? '' : 'none';
      if (p) particles.textContent = p.boxesOnly ? t('status.particlesBoxes') : t('status.particles', { shown: formatNumber(p.shown, getLang(), 0), total: formatNumber(p.total, getLang(), 0) });
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
    particlesSep,
    particles,
    h('div', { class: 'status-right' }, runtimeNote(ctx, scope), updateNotice(ctx, scope), langBtn, h('span', { class: 'tabular' }, `v${VERSION}`)),
  );
}
