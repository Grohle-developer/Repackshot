// Render window ▸ AI post-processing (AI-POST.md §4, UI.md §2.7, phase X4): the switch with the model in use, the
// six controls of the configurator (0..100 each with its sentence, and the style list), the protections as fixed
// chips, *Another variation*, and the preview with a divider for before and after. Every control is a store action
// (undoable, one entry per drag).
//
// X6: the preview is first a **stored example** (src/core/ai-preview-sheet.ts, public/ai-preview/): the reference scene
// rendered by the Full engine and passed through the real guard with the test model at every step of every control.
// It follows the controls the moment they move, never calls a model, says what it is and at which values it was made,
// and what the guard did there in plain words. *Preview my scene* runs the real pipeline on the job's own scene,
// drawn by the Full engine (ui/ai-preview.ts), and its result shows until a control or the scene changes.
//
// The section works with `AiPort` (ui/ports.ts): the service says whether it can run and why not, and the
// synthetic one of tests and screenshots (`?ai=synthetic`) answers `available`. Without a port (a build that
// cannot draw the inputs) the section stays the placeholder it was: the switch says *coming soon*.
//
// X4b: the job's own prompt (a multi-line field with the protections' note, committed when typing stops or the field
// is left: one undo entry a visit; disabled with the reason for a model that takes no text prompt; a line says what a
// model with a token limit leaves out) and the number of variants next to *Another variation*, with the seeds they
// take and, once the AI's time was measured on this computer, the time they would take. The preview stays one image.

import { AI_STYLES, MAX_STRENGTH, MAX_USER_PROMPT, MAX_VARIANTS, type AiRuntimeStatus, type AiStyle } from '../../core/ai';
import { pickExample, parseSheet, SHEET_DIR, type PreviewSheet, type SheetControl, type SheetPick } from '../../core/ai-preview-sheet';
import { AI_PROTECTIONS, nextSeed, previewSize, switchAction, variantSeed, type SwitchAction } from '../../core/ai-post';
import { normaliseUserPrompt, type ComposedPrompt, type PromptCut } from '../../core/ai-prompt';
import { linearToRgba8 } from '../../core/ai-image';
import { activeModel, allModels } from '../../core/models';
import { AI_PERCENT_KEYS, type AiPercentKey, type AiSettings, type RenderSettings } from '../../core/render';
import type { Label } from '../../data/types';
import { aiStatusKey, promptContext, recommendationOf } from '../ai-query';
import { hasModel, runtimeWatch } from '../ai-runtime-state';
import { runtimeNotice } from './ai-runtime-notice';
import { AiPreviewController, previewTriggers, sameTriggers, type AiPreviewInput, type AiPreviewState } from '../ai-preview';
import { guardWords, reportText } from '../ai-report';
import * as cmd from '../commands';
import { numberField, select, slider, textArea, toggle } from '../components/controls';
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

/** The stored example's index (X6), fetched once a page; null when this build has none. */
let sheetLoad: Promise<PreviewSheet | null> | null = null;
function loadSheet(): Promise<PreviewSheet | null> {
  sheetLoad ??= fetch(new URL(`${SHEET_DIR}index.json`, document.baseURI))
    .then((r) => (r.ok ? r.json() : null))
    .then((v) => parseSheet(v))
    .catch(() => null);
  return sheetLoad;
}
/** The stored images, decoded once a page. */
const sheetImages = new Map<string, Promise<HTMLImageElement | null>>();
function sheetImage(file: string): Promise<HTMLImageElement | null> {
  let p = sheetImages.get(file);
  if (!p) {
    const img = new Image();
    img.src = new URL(`${SHEET_DIR}${file}`, document.baseURI).href;
    p = img
      .decode()
      .then(() => img)
      .catch(() => null);
    sheetImages.set(file, p);
  }
  return p;
}

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

/** An estimate in words: "45 s", "4 min", "1 h 20 min" (as the render window's). */
function durationText(seconds: number): string {
  const sec = Math.max(0, seconds);
  if (sec < 59.5) return t('time.s', { n: Math.max(1, Math.round(sec)) });
  const m = Math.round(sec / 60);
  if (m < 60) return t('time.min', { n: m });
  return t('time.h', { h: Math.floor(m / 60), m: m % 60 });
}

/** What a model with a token limit leaves out of the prompt, in words (X4b): "the end of your prompt, the scene description". */
export function cutText(cut: ComposedPrompt['cut']): string {
  const part = (key: 'user' | 'scene' | 'system', c: PromptCut) => (c === 'NONE' ? null : t(dyn(`rw.aiCut.${key}${c === 'ALL' ? 'All' : 'Part'}`)));
  return [part('user', cut.user), part('scene', cut.scene), part('system', cut.system)].filter((x): x is string => x !== null).join(', ');
}

/** The line under the job's prompt (X4b): why nothing is sent, what does not fit, or how much of the model's limit it takes. */
export function promptLine(composed: ComposedPrompt | undefined, textPrompt: boolean, modelName: string | null): string {
  if (!textPrompt) return modelName ? t('rw.aiPromptNoTextModel', { model: modelName }) : t('rw.aiPromptNoText');
  if (!composed || composed.limit === null) return '';
  const cut = cutText(composed.cut);
  if (cut) return t('rw.aiPromptCut', { limit: composed.limit, what: cut });
  return t(composed.shortSystem ? 'rw.aiPromptFitShort' : 'rw.aiPromptFit', { used: composed.tokens + 2, limit: composed.limit });
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
    // X6: the preview of the person's own scene is always drawn by the Full engine (the user's request, 17-10).
    const fullEngine = { finishBy: s.finishBy, maxSamples: s.maxSamples, maxSeconds: s.maxSeconds };
    // One image (the first variant's seed), with the words the job would send.
    const settings = { intervention: s.ai.intervention, light: s.ai.light, bounce: s.ai.bounce, wear: s.ai.wear, style: s.ai.style, styleStrength: s.ai.styleStrength, seed: s.ai.seed, userPrompt: s.ai.userPrompt };
    const pc = promptContext(ui.get(), status);
    const text = port.scenePrompt(st, settings, { system: pc.system, caps: pc.caps });
    return {
      // The picture depends on the scene, the camera, the look and the size; not on the AI controls.
      frameKey: [st.scene.nodes, st.scene.roots, st.materials, st.studio, st.environment, st.camera, st.image, st.animation, size.width, size.height, camera, fullEngine.maxSamples, fullEngine.maxSeconds, fullEngine.finishBy],
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
      // No runtime: the Runtime row has the Install button; no model: the model chooser.
      cmd.openSettings(ctx, status?.reason === 'NO_RUNTIME' ? 'ai.runtime' : 'ai.models');
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
  /** X6: each control's line on what it acts on (Intervention's says the strength it asks for). */
  const hows = new Map<string, HTMLElement>();
  /** The control moved last: the stored example prefers the one that has it at its value. */
  let lastMoved: SheetControl | null = null;
  const rows: HTMLElement[] = [];
  const percentRow = (key: AiPercentKey): HTMLElement => {
    const name = t(dyn(`rw.ai.${key}`));
    const ctl = slider({
      value: ai()[key],
      min: 0,
      max: 100,
      step: 1,
      ariaLabel: name,
      onChange: (v, g) => {
        lastMoved = key;
        patchAi({ [key]: v } as Partial<AiSettings>, g, undoOf(dyn(`rw.ai.${key}`)));
      },
    });
    percent.set(key, ctl);
    const how = h('div', { class: 'note rw-ai-how', 'data-how': key }, t(dyn(`rw.ai.${key}.how`)));
    hows.set(key, how);
    return h('div', { class: 'rw-ai-ctl', 'data-ai': key }, h('div', { class: 'rw-ai-ctl-name' }, name), ctl.el, h('div', { class: 'note' }, t(dyn(`rw.ai.${key}.aux`))), how);
  };
  for (const key of ['intervention', 'light', 'bounce', 'wear'] as const) rows.push(percentRow(key));
  const styleSel = select(
    AI_STYLES.map((k) => ({ value: k, label: t(dyn(`rw.ai.style.${k}`)) })),
    ai().style,
    (v) => {
      lastMoved = 'style';
      patchAi({ style: (AI_STYLES as readonly string[]).includes(v) ? (v as AiStyle) : 'NATURAL' }, undefined, undoOf('rw.ai.style'));
    },
    t('rw.ai.style'),
  );
  rows.push(h('div', { class: 'rw-ai-ctl', 'data-ai': 'style' }, h('div', { class: 'rw-ai-ctl-name' }, t('rw.ai.style')), styleSel.el, h('div', { class: 'note' }, t('rw.ai.style.aux')), h('div', { class: 'note rw-ai-how', 'data-how': 'style' }, t('rw.ai.style.how'))));
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

  // The job's own prompt (X4b): kept in the project, one undo entry a visit to the field.
  const promptCount = h('span', { class: 'note tabular rw-ai-count' });
  const promptWhy = h('div', { class: 'note rw-ai-prompt-line', role: 'status' });
  const promptField = textArea({
    value: ai().userPrompt,
    maxLength: MAX_USER_PROMPT,
    rows: 3,
    ariaLabel: t('rw.aiPrompt'),
    placeholder: t('rw.aiPromptPlaceholder'),
    normalise: normaliseUserPrompt,
    onCommit: (v, g) => patchAi({ userPrompt: v }, g, undoOf('rw.aiPrompt')),
    onInput: (v) => updatePrompt(v),
  });
  const promptBox = h(
    'div',
    { class: 'rw-ai-ctl rw-ai-prompt', 'data-ai': 'userPrompt' },
    h('div', { class: 'rw-ai-ctl-head' }, h('span', { class: 'rw-ai-ctl-name' }, t('rw.aiPrompt')), promptCount),
    promptField.el,
    h('div', { class: 'note' }, t('rw.aiPromptNote')),
    promptWhy,
  );
  /** The counter and the line under the field, for the text being typed (`typed`) or the kept one. */
  const updatePrompt = (typed?: string) => {
    const s = env.get();
    const text = normaliseUserPrompt(typed ?? s.ai.userPrompt);
    promptCount.textContent = t('rw.aiPromptCount', { n: text.length, max: MAX_USER_PROMPT });
    const pc = promptContext(ui.get(), status);
    promptField.setDisabled(!pc.caps.textPrompt);
    promptBox.dataset.text = pc.caps.textPrompt ? '1' : '0';
    let composed: ComposedPrompt | undefined;
    if (port && pc.caps.textPrompt && pc.caps.maxPromptTokens !== null) composed = port.scenePrompt(ctx.store.get(), { ...s.ai, userPrompt: text }, { system: pc.system, caps: pc.caps }).composed;
    const line = promptLine(composed, pc.caps.textPrompt, pc.model ? pc.model.label[getLang()] : null);
    promptWhy.textContent = line;
    promptWhy.style.display = line ? '' : 'none';
    promptWhy.dataset.cut = composed && cutText(composed.cut) ? '1' : '0';
  };

  // Variants (X4b): one render, then as many AI images with the seeds that follow.
  const variantsField = numberField({
    value: ai().variants,
    min: 1,
    max: MAX_VARIANTS,
    step: 1,
    ariaLabel: t('rw.aiVariants'),
    onChange: (v, g) => patchAi({ variants: v }, g, undoOf('rw.aiVariants')),
  });
  variantsField.el.classList.add('rw-ai-variants-num');
  const variantsLine = h('div', { class: 'note tabular rw-ai-variants-line' });
  const updateVariants = () => {
    const s = env.get();
    const n = s.ai.variants;
    const seeds = n > 1 ? t('rw.aiVariantsSeeds', { n, from: variantSeed(s.ai.seed, 1), to: variantSeed(s.ai.seed, n) }) : t('rw.aiVariantsOne');
    const tp = ui.get().aiThroughput;
    const time = tp && tp > 0 ? t('rw.aiVariantsTime', { time: durationText((n * s.width * s.height) / tp) }) : t('rw.aiVariantsTimeNone');
    variantsLine.textContent = `${seeds} · ${time}`;
  };
  const variantsRow = h(
    'div',
    { class: 'rw-inline rw-ai-variants', 'data-ai': 'variants' },
    variation,
    h('label', { class: 'rw-inline rw-ai-variants-label', 'data-tip': t('rw.aiVariantsTip') }, h('span', { class: 'rw-ai-ctl-name' }, t('rw.aiVariants')), variantsField.el),
  );
  const controls = h('div', { class: 'rw-ai-controls' }, ...rows, promptBox, protections, h('div', { class: 'rw-ai-ctl' }, variantsRow, variantsLine));

  // ------------------------------------------------------------------ the preview
  const frame = h('div', { class: 'rw-ai-frame', role: 'img', 'aria-label': t('rw.aiPreviewAlt') });
  const sourceLine = h('div', { class: 'note rw-ai-source', 'data-ai-source': '' });
  const valuesLine = h('div', { class: 'note tabular rw-ai-values' });
  const stateLine = h('div', { class: 'note rw-ai-state tabular', role: 'status' });
  const reportLine = h('div', { class: 'note rw-ai-report' });
  const reportNote = h('div', { class: 'note rw-ai-report-note' });
  const guardList = h('ul', { class: 'note rw-ai-guard', 'aria-label': t('rw.aiGuardWords') });
  const timeLine = h('div', { class: 'note tabular rw-ai-time' });
  const runMine = h('button', { type: 'button', class: 'btn', 'data-ai-run': '', 'data-tip': t('rw.aiRunMineTip'), onclick: () => runMyScene() }, t('rw.aiRunMine'));
  const runRow = h('div', { class: 'rw-inline rw-ai-run' }, runMine);
  const previewCol = h('div', { class: 'rw-ai-preview' }, h('div', { class: 'rw-ai-ctl-name' }, t('rw.aiPreview')), frame, sourceLine, valuesLine, stateLine, reportLine, reportNote, guardList, runRow, timeLine);

  let split: SplitCompare | null = null;
  /** What the divider shows now: the two images and which they are. */
  let shown: { before: unknown; after: unknown } = { before: null, after: null };
  let divider: { position: number; mode: SplitMode } = { position: 0.5, mode: 'SPLIT' };
  /** Writes a text only when it changed: the progress ticks of a preview must not make the page churn. */
  const setText = (el: HTMLElement, text: string) => {
    if (el.textContent !== text) el.textContent = text;
  };
  const setGuard = (lines: string[]) => {
    const now = [...guardList.children].map((li) => li.textContent).join('\n');
    if (now !== lines.join('\n')) guardList.replaceChildren(...lines.map((l) => h('li', {}, l)));
    guardList.style.display = lines.length > 0 ? '' : 'none';
  };
  /** Shows two pictures under the divider; the divider keeps where the person left it, an image swap keeps the zoom. */
  const showPair = (before: HTMLImageElement | HTMLCanvasElement, after: HTMLImageElement | HTMLCanvasElement | null, keys: { before: unknown; after: unknown }) => {
    if (keys.before === shown.before && keys.after === shown.after) return;
    // (A swap only when there already is an After: a divider made without one has no After to swap.)
    if (split && keys.before === shown.before && after && shown.after) {
      split.setB(after, t('rw.aiAfter'));
      shown = keys;
      return;
    }
    split?.destroy();
    shown = keys;
    frame.style.aspectRatio = `${before.width} / ${before.height}`;
    split = splitCompare({
      a: before,
      b: after,
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
  };
  const showEmpty = (text: string) => {
    split?.destroy();
    split = null;
    shown = { before: null, after: null };
    frame.replaceChildren(h('div', { class: 'note rw-ai-empty' }, text));
  };

  // The person's own scene (the button): what it was made with, so it shows only while that still holds.
  let mineKey: string | null = null;
  let mineCanvases: { before: HTMLCanvasElement; after: HTMLCanvasElement | null; of: unknown } | null = null;
  /** The controls and the words that make a preview: the same key, the same picture. */
  const settingsKey = () => {
    const a = env.get().ai;
    return JSON.stringify([a.intervention, a.light, a.bounce, a.wear, a.style, a.styleStrength, a.seed, a.userPrompt]);
  };
  const runMyScene = () => {
    if (!port) return;
    mineKey = settingsKey();
    preview.refresh();
    render();
  };
  /** The scene, the camera or the size changed: the preview of the scene made before no longer shows it. */
  const forgetMine = () => {
    mineKey = null;
    preview.cancel();
    render();
  };

  // The stored example.
  let sheet: PreviewSheet | null | undefined;
  void loadSheet().then((v) => {
    sheet = v;
    render();
  });
  const controlName = (c: SheetControl): string => t(dyn(`rw.ai.${c}`));
  const valueText = (c: SheetControl, v: number | string): string => (c === 'style' ? t(dyn(`rw.ai.style.${v}`)) : String(v));
  const exampleValues = (pick: SheetPick): string => {
    const e = pick.entry.settings;
    const parts = [`${controlName('intervention')} ${e.intervention}`];
    if (e.intervention > 0) {
      for (const c of ['light', 'bounce', 'wear'] as const) parts.push(`${controlName(c)} ${e[c]}`);
      parts.push(`${t(dyn(`rw.ai.style.${e.style}`))} ${e.styleStrength}`);
    }
    const yours = pick.differs.map((d) => `${controlName(d.control)} ${valueText(d.control, d.yours)}`);
    const line = t('rw.aiExampleAt', { values: parts.join(' · ') });
    return yours.length > 0 ? `${line} — ${t('rw.aiExampleYours', { values: yours.join(', ') })}` : line;
  };
  const showExample = () => {
    const a = env.get().ai;
    if (sheet === undefined) {
      showEmpty(t('rw.aiExampleLoading'));
      setText(sourceLine, '');
      setText(valuesLine, '');
      setGuard([]);
      return;
    }
    const pick = sheet ? pickExample(sheet, { intervention: a.intervention, light: a.light, bounce: a.bounce, wear: a.wear, style: a.style, styleStrength: a.styleStrength, seed: a.seed }, lastMoved) : null;
    if (!sheet || !pick) {
      showEmpty(t('rw.aiExampleMissing'));
      setText(sourceLine, '');
      setText(valuesLine, '');
      setGuard([]);
      return;
    }
    frame.dataset.example = pick.entry.key;
    setText(sourceLine, t('rw.aiExampleLabel'));
    setText(valuesLine, exampleValues(pick) + (pick.seedDiffers ? ` · ${t('rw.aiExampleSeed')}` : ''));
    const r = pick.entry.report;
    const words = guardWords({ verdict: r.verdict, usedFraction: r.usedFraction, ...(r.capped ? { capped: r.capped } : {}), materials: r.kept ? [r.kept] : [], sentBack: r.sentBack ?? [] });
    setGuard(words);
    setText(reportLine, '');
    reportLine.style.display = 'none';
    const note = r.verdict === 'REJECTED' ? t('rw.aiExampleRejected') : '';
    setText(reportNote, note);
    reportNote.style.display = note ? '' : 'none';
    const want = pick.entry.file;
    void Promise.all([sheetImage(sheet.before), sheetImage(want)]).then(([before, after]) => {
      // Only if it is still the one to show (a slider may have moved on).
      if (frame.dataset.example !== pick.entry.key || mineShowing()) return;
      if (!before) return;
      showPair(before, after, { before: sheet!.before, after: want });
      // What is drawn (the checks and the captures wait for it: the images arrive after the controls move).
      frame.dataset.drawn = pick.entry.key;
    });
  };
  /** Whether the person's own preview is the one to show: made (or being made) with the controls of now. */
  const mineShowing = () => mineKey !== null && mineKey === settingsKey();
  const showMine = (s: AiPreviewState) => {
    frame.dataset.example = '';
    const model = activeModelLine(ctx);
    setText(sourceLine, t('rw.aiMine', { model: status?.backend === 'SYNTHETIC' ? t('rw.aiSyntheticLine') : (model?.line ?? '') }));
    setText(valuesLine, '');
    if (s.before) {
      if (!mineCanvases || mineCanvases.of !== s.after || mineCanvases.before.width !== s.before.width) mineCanvases = { before: toCanvas(s.before), after: s.after ? toCanvas(s.after) : null, of: s.after };
      showPair(mineCanvases.before, mineCanvases.after, { before: s.before, after: s.after });
    } else showEmpty(s.phase === 'ERROR' ? t('rw.aiPreviewError', { reason: s.error ?? '' }) : t('rw.aiPreviewFrameFull'));
    const rep = s.after && s.report ? reportText(s.report) : { checked: null, note: null };
    setText(reportLine, rep.checked ?? '');
    setText(reportNote, rep.note ?? '');
    reportLine.style.display = rep.checked ? '' : 'none';
    reportNote.style.display = rep.note ? '' : 'none';
    const r = s.report;
    setGuard(s.after && r ? guardWords({ verdict: r.verdict, usedFraction: r.usedFraction, ...(r.capped ? { capped: r.capped } : {}), materials: r.materials, sentBack: s.sentBack }).filter((l) => !(r.verdict === 'LIMITED' && l === rep.note)) : []);
  };
  const render = () => {
    const s = preview.state;
    frame.dataset.phase = mineShowing() ? s.phase : 'EXAMPLE';
    frame.classList.toggle('is-working', mineShowing() && (s.phase === 'WORKING' || s.phase === 'FRAME'));
    if (mineShowing()) showMine(s);
    else showExample();
    const working = mineShowing() && (s.phase === 'WORKING' || s.phase === 'FRAME');
    setText(stateLine, working ? (s.phase === 'FRAME' ? t('rw.aiPreviewFrameFull') : t('rw.aiPreviewWorking')) : mineShowing() && s.phase === 'ERROR' ? t('rw.aiPreviewError', { reason: s.error ?? '' }) : mineShowing() && s.before ? t('rw.aiPreviewSize', { w: s.before.width, h: s.before.height }) : '');
    stateLine.style.display = stateLine.textContent ? '' : 'none';
    (runMine as HTMLButtonElement).disabled = !port || working;
    setText(runMine, mineKey !== null && !mineShowing() ? t('rw.aiRunMineAgain') : t('rw.aiRunMine'));
    if (s.seconds !== null) measured.set(ui, s.seconds);
    setText(timeLine, s.seconds !== null ? t('rw.aiPreviewTime', { time: measuredText(s.seconds) }) : t('rw.aiPreviewTimeNone'));
  };
  preview.subscribe(() => render());

  const grid = h('div', { class: 'rw-ai-grid' }, controls, previewCol);

  // ------------------------------------------------------------------ the section
  // A model is installed and the inference runtime is not (or does not start): said here, with its Install button (U10).
  const notice = runtimeNotice(ctx, scope, 'render');
  const host = h(
    'div',
    { class: 'rw-section rw-ai' },
    h('div', { class: 'rw-row' }, h('div', { class: 'rw-label' }, t('rw.ai')), h('div', { class: 'rw-ctrl' }, h('div', { class: 'rw-inline' }, sw.el, aux))),
    notice,
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
      // With a model installed the notice above says what is missing and offers the fix; the line is for the rest.
      const noticed = status?.reason === 'NO_RUNTIME' && runtimeWatch(ctx) !== null && hasModel(ui.get());
      reason = noticed ? '' : status?.reason === 'NO_RUNTIME' ? t('rw.aiNoRuntime') : t('rw.aiNoModel');
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
    promptField.set(a.userPrompt);
    variantsField.set(a.variants);
    updatePrompt(document.activeElement === promptField.el ? promptField.el.value : undefined);
    updateVariants();
    setText(hows.get('intervention')!, t('rw.ai.intervention.how', { s: formatNumber((a.intervention / 100) * MAX_STRENGTH, getLang(), 2) }));
    frame.dataset.on = on ? '1' : '0';
    // The example follows the controls at once (X6): it calls no model.
    if (on) render();
  };

  // The model manager's snapshot is a new object at every tick of a download: the lines follow it, the preview does
  // not (it is made again only when the models on this computer change: `previewTriggers`).
  scope.watch((_s, u) => u.models, () => sync());
  // The settings (undo and redo included), the models installed and the section being opened all land here.
  scope.watch(
    (s, u) => previewTriggers(s, u),
    (v, prev) => {
      sync();
      if (prev === undefined) return;
      // The number of variants does not change the preview (it is one image): nothing to make again (X4b).
      const [a, b] = [v[0] as AiSettings, prev[0] as AiSettings];
      if (a !== b && v.slice(1).every((x, i) => Object.is(x, prev[i + 1])) && (Object.keys(a) as (keyof AiSettings)[]).every((k) => k === 'variants' || a[k] === b[k])) return;
      // X6: nothing is computed when a control moves; the example already follows it (sync above).
    },
    sameTriggers,
  );
  // The AI's measured time (a job finished) and the size: the variants' estimate.
  scope.watch(
    (_s, u) => [u.aiThroughput, env.get().width, env.get().height] as unknown[],
    () => updateVariants(),
    (x, y) => x.length === y.length && x.every((v, i) => Object.is(v, y[i])),
  );
  // The picture itself: the scene, the camera, the look and the size.
  scope.watch(
    (s) => [s.scene.nodes, s.scene.roots, s.materials, s.studio, s.environment, s.camera, s.image, s.animation] as unknown[],
    (_v, prev) => {
      if (prev === undefined) return;
      // The scene's words changed with it: what a model with a limit leaves out may too.
      updatePrompt(document.activeElement === promptField.el ? promptField.el.value : undefined);
      forgetMine();
    },
    (x, y) => x.length === y.length && x.every((v, i) => Object.is(v, y[i])),
  );
  scope.watch(
    () => [env.get().width, env.get().height, env.get().camera] as unknown[],
    (_v, prev) => prev !== undefined && forgetMine(),
    (x, y) => x.length === y.length && x.every((v, i) => Object.is(v, y[i])),
  );
  // Unfolding the section shows the example; the person's own preview only comes from the button (X6).
  scope.watch(
    (_s, u) => u.sections['rw.ai'] ?? true,
    (folded, prev) => prev !== undefined && !folded && render(),
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
