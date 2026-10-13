// Render window ▸ AI post-processing (AI-POST.md §4, UI.md §2.7, phase X4): the switch with the model in use, the
// six controls of the configurator (0..100 each with its sentence, and the style list), the protections as fixed
// chips, *Another variation*, and the preview: a Fast-mode frame from the job's camera with the AI applied and a
// divider for before and after. Every control is a store action (undoable, one entry per drag); the preview
// updates when a control is released (ui/ai-preview.ts) and shows the time it measured.
//
// The section works with `AiPort` (ui/ports.ts): the service says whether it can run and why not, and the
// synthetic one of tests and screenshots (`?ai=synthetic`) answers `available`. Without a port (a build that
// cannot draw the inputs) the section stays the placeholder it was: the switch says *coming soon*.

import { AI_STYLES, type AiRuntimeStatus, type AiStyle } from '../../core/ai';
import { AI_PROTECTIONS, nextSeed, previewSize, switchAction, type SwitchAction } from '../../core/ai-post';
import { linearToRgba8 } from '../../core/ai-image';
import { activeModel, allModels } from '../../core/models';
import { AI_PERCENT_KEYS, type AiPercentKey, type AiSettings, type RenderSettings } from '../../core/render';
import type { Label } from '../../data/types';
import { aiStatusKey, recommendationOf } from '../ai-query';
import { AiPreviewController, type AiPreviewInput, type AiPreviewState } from '../ai-preview';
import { reportText } from '../ai-report';
import * as cmd from '../commands';
import { select, slider, toggle } from '../components/controls';
import { splitCompare, type SplitCompare } from '../components/split-compare';
import { h, icon } from '../dom';
import { dyn } from '../names';
import type { Ctx, Scope } from '../reactive';
import { formatNumber, getLang, L, t, type StringKey } from '../strings';
import type { SplitMode } from '../ui-state';

/** What the section needs from the render window: the settings it shows, and a way to change them. */
export interface AiSectionEnv {
  /** The settings of the window: the project's, or the draft of the job being edited. */
  get(): RenderSettings;
  set(patch: Partial<RenderSettings>, gesture?: string, label?: Label): void;
}

const REASON_KEYS = ['NO_RUNTIME', 'NO_MODEL', 'MODEL_UNSUPPORTED', 'NO_WEBGPU', 'TOO_LITTLE_MEMORY', 'NOT_BUILT'] as const;

/** The last time the pipeline took for one preview on this computer (measured), kept for the session. */
const measured = new WeakMap<object, number>();

/** A linear image as a canvas (what the divider draws). */
function toCanvas(img: { width: number; height: number; rgba: Float32Array }): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.putImageData(new ImageData(linearToRgba8(img) as unknown as Uint8ClampedArray<ArrayBuffer>, img.width, img.height), 0, 0);
  return c;
}

/** Seconds as the preview line words them: "0.4 s", "9 s", "1 min". */
function measuredText(seconds: number): string {
  if (seconds >= 59.5) return t('time.min', { n: Math.round(seconds / 60) });
  return t('time.s', { n: formatNumber(seconds, getLang(), seconds < 10 ? 1 : 0) });
}

/** The model in use and its line, from the model manager's data: "Z-Image-Turbo · Q4 · Apache-2.0 · downloaded". */
function activeModelLine(ctx: Ctx): { key: string; line: string } | null {
  const u = ctx.ui.get();
  const snap = u.models;
  if (!snap || !snap.ready) return null;
  const models = allModels(snap);
  const key = activeModel(u.settings['ai.active'], models, snap.installed, recommendationOf(u));
  const m = key ? models.find((x) => x.key === key) : undefined;
  return m ? { key: m.key, line: t('rw.aiModelLine', { name: m.label[getLang()], licence: m.licence.spdx }) } : null;
}

export function aiPostBody(ctx: Ctx, scope: Scope, env: AiSectionEnv): HTMLElement {
  const port = ctx.services.ai ?? null;
  const { ui } = ctx;
  let status: AiRuntimeStatus | null = null;
  let action: SwitchAction = { kind: 'DISABLED', reason: 'NOT_BUILT' };

  const ai = () => env.get().ai;
  /** "AI post-processing: Light", the undo entry of a control. */
  const undoOf = (what: StringKey): Label => L('undo.ai', { what: L(what) });
  const patchAi = (patch: Partial<AiSettings>, gesture: string | undefined, label: Label) => env.set({ ai: { ...ai(), ...patch } }, gesture, label);
  const collapsed = () => ui.get().sections['rw.ai'] ?? true;
  const animation = () => env.get().mode === 'ANIMATION';
  /** The switch is on and can do its work: the person asked, the service can, and the job is an image. */
  const live = () => ai().enabled && action.kind === 'SWITCH' && !animation();

  // ------------------------------------------------------------------ the preview's brain
  const read = (): AiPreviewInput | null => {
    if (!port || !live() || collapsed()) return null;
    const s = env.get();
    const st = ctx.store.get();
    const size = previewSize(s.width, s.height, status?.backend === 'CPU' ? 384 : 512);
    const camera = s.camera.kind === 'ONE' ? s.camera.id : null;
    const fullEngine = s.ai.previewFullEngine ? { finishBy: s.finishBy, maxSamples: s.maxSamples, maxSeconds: s.maxSeconds } : null;
    const settings = { intervention: s.ai.intervention, light: s.ai.light, bounce: s.ai.bounce, wear: s.ai.wear, style: s.ai.style, styleStrength: s.ai.styleStrength, seed: s.ai.seed };
    const text = port.scenePrompt(st, settings);
    return {
      // The picture depends on the scene, the camera, the look and the size; not on the AI controls.
      frameKey: [st.scene.nodes, st.scene.roots, st.materials, st.studio, st.environment, st.camera, st.image, st.animation, size.width, size.height, camera, s.ai.previewFullEngine, fullEngine?.maxSamples, fullEngine?.maxSeconds, fullEngine?.finishBy],
      frame: (signal) => port.frame({ width: size.width, height: size.height, camera, fullEngine, signal }),
      settings,
      prompt: text.prompt,
      negative: text.negative,
      modelKey: status?.activeModel ?? '',
      materials: port.materials(st, camera),
    };
  };
  const preview = new AiPreviewController(
    {
      service: port?.service ?? { post: () => Promise.reject(new Error('no AI port')) },
      read,
      now: () => performance.now(),
      setTimer: (fn, ms) => window.setTimeout(fn, ms),
      clearTimer: (hd) => window.clearTimeout(hd as number),
    },
    measured.get(ui) ?? null,
  );
  scope.onDispose(() => preview.dispose());

  // ------------------------------------------------------------------ the switch
  const sw = toggle(false, () => {
    if (action.kind === 'OPEN_SETTINGS') {
      cmd.openSettings(ctx, 'ai.models');
      return;
    }
    if (action.kind === 'SWITCH' && !animation()) {
      const was = ai().enabled;
      patchAi({ enabled: !was }, undefined, L('undo.aiSwitch'));
      // Off: the model gives its memory back now (AI-POST.md §7.3), unless a job still uses it (the launcher says no).
      if (was) void ctx.services.aiRuntime?.release().catch(() => undefined);
    }
  }, t('rw.aiSwitch'), true);
  sw.el.setAttribute('data-ai-switch', '');
  const aux = h('span', { class: 'aux rw-ai-line' });
  const why = h('p', { class: 'note rw-ai-note' });
  const manage = h(
    'div',
    { class: 'rw-inline' },
    h('button', { type: 'button', class: 'btn', 'data-settings-link': 'ai.models', onclick: () => cmd.openSettings(ctx, 'ai.models') }, t('rw.aiManage')),
    h('span', { class: 'note rw-ai-default' }),
  );
  scope.watch(
    (_s, u) => u.settings['ai.intervention'],
    (n) => (manage.querySelector('.rw-ai-default')!.textContent = t('rw.aiDefault', { n })),
  );

  // ------------------------------------------------------------------ the configurator
  const percent = new Map<AiPercentKey, ReturnType<typeof slider>>();
  const rows: HTMLElement[] = [];
  const percentRow = (key: AiPercentKey): HTMLElement => {
    const name = t(dyn(`rw.ai.${key}`));
    const ctl = slider({
      value: ai()[key],
      min: 0,
      max: 100,
      step: 1,
      ariaLabel: name,
      onChange: (v, g) => patchAi({ [key]: v } as Partial<AiSettings>, g, undoOf(dyn(`rw.ai.${key}`))),
      onHold: () => preview.hold(),
      onRelease: () => preview.release(),
    });
    percent.set(key, ctl);
    return h('div', { class: 'rw-ai-ctl', 'data-ai': key }, h('div', { class: 'rw-ai-ctl-name' }, name), ctl.el, h('div', { class: 'note' }, t(dyn(`rw.ai.${key}.aux`))));
  };
  for (const key of ['intervention', 'light', 'bounce', 'wear'] as const) rows.push(percentRow(key));
  const styleSel = select(
    AI_STYLES.map((k) => ({ value: k, label: t(dyn(`rw.ai.style.${k}`)) })),
    ai().style,
    (v) => patchAi({ style: (AI_STYLES as readonly string[]).includes(v) ? (v as AiStyle) : 'NATURAL' }, undefined, undoOf('rw.ai.style')),
    t('rw.ai.style'),
  );
  rows.push(h('div', { class: 'rw-ai-ctl', 'data-ai': 'style' }, h('div', { class: 'rw-ai-ctl-name' }, t('rw.ai.style')), styleSel.el, h('div', { class: 'note' }, t('rw.ai.style.aux'))));
  rows.push(percentRow('styleStrength'));
  // The protections: fixed chips with a lock, no switch (AI-POST.md §1).
  const protections = h(
    'div',
    { class: 'rw-ai-prot', role: 'list', 'aria-label': t('rw.aiProtected') },
    h('span', { class: 'rw-ai-ctl-name' }, t('rw.aiProtected')),
    h(
      'div',
      { class: 'rw-ai-chips' },
      ...AI_PROTECTIONS.map((k) => h('span', { class: 'rw-ai-chip', role: 'listitem', 'data-protection': k, 'data-tip': t('rw.aiProtectedTip') }, icon('lock', 12), t(dyn(`rw.aiProt.${k}`)))),
    ),
  );
  const variation = h('button', { type: 'button', class: 'btn', 'data-tip': t('rw.aiVariationTip'), onclick: () => patchAi({ seed: nextSeed(ai().seed) }, undefined, undoOf('rw.aiVariation')) }, icon('refresh', 14), t('rw.aiVariation'));
  const controls = h('div', { class: 'rw-ai-controls' }, ...rows, protections, h('div', { class: 'rw-inline' }, variation));

  // ------------------------------------------------------------------ the preview
  const frame = h('div', { class: 'rw-ai-frame', role: 'img', 'aria-label': t('rw.aiPreviewAlt') });
  const stateLine = h('div', { class: 'note rw-ai-state tabular', role: 'status' });
  const reportLine = h('div', { class: 'note rw-ai-report' });
  const reportNote = h('div', { class: 'note rw-ai-report-note' });
  const timeLine = h('div', { class: 'note tabular rw-ai-time' });
  const fullNote = h('div', { class: 'note' }, t('rw.aiPreviewNote'));
  const full = toggle(ai().previewFullEngine, () => patchAi({ previewFullEngine: !ai().previewFullEngine }, undefined, L('undo.aiFullEngine')), t('rw.aiFullEngine'));
  const fullRow = h('div', { class: 'rw-inline rw-ai-full' }, full.el, h('span', { class: 'rw-ai-full-label' }, t('rw.aiFullEngine')));
  const previewCol = h('div', { class: 'rw-ai-preview' }, h('div', { class: 'rw-ai-ctl-name' }, t('rw.aiPreview')), frame, stateLine, reportLine, reportNote, timeLine, fullNote, fullRow);

  let split: SplitCompare | null = null;
  let shown: { before: unknown; after: unknown } = { before: null, after: null };
  let divider: { position: number; mode: SplitMode } = { position: 0.5, mode: 'SPLIT' };
  /** Writes a text only when it changed: the progress ticks of a preview must not make the page churn. */
  const setText = (el: HTMLElement, text: string) => {
    if (el.textContent !== text) el.textContent = text;
  };
  const showPreview = (s: AiPreviewState) => {
    // The images: rebuilt only when they are new; the divider keeps where the person left it.
    if (s.before !== shown.before || s.after !== shown.after) {
      split?.destroy();
      split = null;
      shown = { before: s.before, after: s.after };
      if (s.before) {
        frame.style.aspectRatio = `${s.before.width} / ${s.before.height}`;
        split = splitCompare({
          a: toCanvas(s.before),
          b: s.after ? toCanvas(s.after) : null,
          labels: { a: t('rw.aiBefore'), b: t('rw.aiAfter') },
          modeLabels: { a: t('rw.aiOnlyBefore'), b: t('rw.aiOnlyAfter'), split: t('split.split') },
          position: divider.position,
          mode: divider.mode,
          onPosition: (p) => (divider = { ...divider, position: p }),
          onMode: (m) => (divider = { ...divider, mode: m }),
          zoomable: false,
        });
        frame.replaceChildren(split.el);
        requestAnimationFrame(() => split?.fit());
      } else frame.replaceChildren();
    }
    frame.dataset.phase = s.phase;
    frame.classList.toggle('is-working', s.phase === 'WORKING' || s.phase === 'FRAME');
    // Nothing to show yet: a line in the frame says why.
    if (!s.before) {
      const text = s.phase === 'ERROR' ? t('rw.aiPreviewError', { reason: s.error ?? '' }) : s.phase === 'FRAME' ? t('rw.aiPreviewFrame') : t('rw.aiPreviewIdle');
      const line = frame.querySelector('.rw-ai-empty');
      if (line) setText(line as HTMLElement, text);
      else frame.replaceChildren(h('div', { class: 'note rw-ai-empty' }, text));
    }
    setText(
      stateLine,
      s.phase === 'FRAME' ? t('rw.aiPreviewFrame') : s.phase === 'WORKING' ? t('rw.aiPreviewWorking') : s.phase === 'ERROR' ? t('rw.aiPreviewError', { reason: s.error ?? '' }) : s.before ? t('rw.aiPreviewSize', { w: s.before.width, h: s.before.height }) : '',
    );
    const rep = s.after && s.report ? reportText(s.report) : { checked: null, note: null };
    setText(reportLine, rep.checked ?? '');
    setText(reportNote, rep.note ?? '');
    reportLine.style.display = rep.checked ? '' : 'none';
    reportNote.style.display = rep.note ? '' : 'none';
    if (s.seconds !== null) measured.set(ui, s.seconds);
    setText(timeLine, s.seconds !== null ? t('rw.aiPreviewTime', { time: measuredText(s.seconds) }) : t('rw.aiPreviewTimeNone'));
  };
  preview.subscribe(showPreview);

  const grid = h('div', { class: 'rw-ai-grid' }, controls, previewCol);

  // ------------------------------------------------------------------ the section
  const host = h(
    'div',
    { class: 'rw-section rw-ai' },
    h('div', { class: 'rw-row' }, h('div', { class: 'rw-label' }, t('rw.ai')), h('div', { class: 'rw-ctrl' }, h('div', { class: 'rw-inline' }, sw.el, aux))),
    why,
    grid,
    manage,
  );

  const refreshStatus = async () => {
    if (!port) {
      status = { available: false, reason: 'NOT_BUILT', backend: null, device: null, supports: [], activeModel: null };
    } else {
      try {
        status = await port.service.status();
      } catch {
        status = { available: false, reason: 'NOT_BUILT', backend: null, device: null, supports: [], activeModel: null };
      }
    }
    sync();
    // Opening the section with the switch on (or the status arriving) makes the first preview.
    preview.refresh();
  };

  const sync = () => {
    const s = env.get();
    const model = activeModelLine(ctx);
    const synthetic = status?.backend === 'SYNTHETIC';
    action = status ? switchAction(status, model !== null || (ui.get().models?.installed.length ?? 0) > 0, !synthetic) : { kind: 'DISABLED', reason: 'NOT_BUILT' };
    const anim = s.mode === 'ANIMATION';
    const on = s.ai.enabled && action.kind === 'SWITCH' && !anim;
    sw.set(on);
    (sw.el as HTMLButtonElement).disabled = status === null || action.kind === 'DISABLED' || anim;
    // The aux line: the model in use, or why the switch cannot be turned on.
    let line = '';
    let reason = '';
    if (anim) {
      line = t('common.comingSoon');
      reason = t('rw.aiImagesOnly');
    } else if (action.kind === 'DISABLED') {
      line = action.reason === 'NOT_BUILT' ? t('common.comingSoon') : '';
      reason = t(dyn(`rw.aiWhy.${(REASON_KEYS as readonly string[]).includes(action.reason) ? action.reason : 'NOT_BUILT'}`));
    } else if (action.kind === 'OPEN_SETTINGS') {
      reason = status?.reason === 'NO_RUNTIME' ? t('rw.aiNoRuntime') : t('rw.aiNoModel');
    } else {
      line = synthetic ? t('rw.aiSyntheticLine') : (model?.line ?? '');
    }
    aux.textContent = line;
    why.textContent = reason;
    why.style.display = reason ? '' : 'none';
    // The soft note of before X4 stays as the explanation while nothing can run.
    grid.style.display = on ? '' : 'none';
    // The controls follow the settings.
    const a = s.ai;
    for (const key of AI_PERCENT_KEYS) percent.get(key)?.set(a[key]);
    styleSel.set(a.style);
    full.set(a.previewFullEngine);
    fullNote.style.display = a.previewFullEngine ? 'none' : '';
    frame.dataset.on = on ? '1' : '0';
  };

  // The settings (undo and redo included), the model manager and the section being opened all land here.
  scope.watch(
    (s, u) => [u.renderWindow?.kind === 'EDIT' ? u.renderWindow.draft.ai : s.render.ai, u.renderWindow?.kind === 'EDIT' ? u.renderWindow.draft.mode : s.render.mode, u.models?.installed.join(','), u.models?.ready, u.settings['ai.active']] as unknown[],
    (_v, prev) => {
      sync();
      if (prev === undefined) return;
      preview.touch();
    },
    (x, y) => x.length === y.length && x.every((v, i) => Object.is(v, y[i])),
  );
  // The picture itself: the scene, the camera, the look and the size.
  scope.watch(
    (s) => [s.scene.nodes, s.scene.roots, s.materials, s.studio, s.environment, s.camera, s.image, s.animation] as unknown[],
    (_v, prev) => prev !== undefined && preview.touch(),
    (x, y) => x.length === y.length && x.every((v, i) => Object.is(v, y[i])),
  );
  scope.watch(
    () => [env.get().width, env.get().height, env.get().camera] as unknown[],
    (_v, prev) => prev !== undefined && preview.touch(),
    (x, y) => x.length === y.length && x.every((v, i) => Object.is(v, y[i])),
  );
  // Unfolding the section is when the first preview is made.
  scope.watch(
    (_s, u) => u.sections['rw.ai'] ?? true,
    (folded, prev) => prev !== undefined && !folded && preview.refresh(),
  );
  // What the service can do changes with what it is asked (the active model, which may be the recommendation for the
  // hardware, so the detection is started here as Settings does) and the models on this computer: ask again.
  void cmd.detectHardware(ctx);
  scope.watch(
    (_s, u) => aiStatusKey(u),
    () => void refreshStatus(),
  );
  return host;
}
