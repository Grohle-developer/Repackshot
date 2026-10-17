// Render window (UI.md §2.7), KeyShot style: a floating window of about
// 760 × 640 over the dimmed viewport, moved by its title bar, closed with Esc
// or × keeping the settings (they are the project's: `state.render`, every
// change undoable). Title bar: Render and an Image · Animation segment.
// Sections: Output (name template with token chips, folder when done,
// format, camera), Size (pixels with an aspect lock, and the print size with
// its DPI: pixels rule) or, in Animation, the animation output; Quality
// (finish by samples or time, the estimate from what the engine measured,
// Advanced); AI post-processing (ui/panels/ai-post.ts). Footer: a
// one-line summary, + Add to queue and Render; editing a queued job shows
// Save changes instead. ⏎ is Render and ⇧ ⏎ + Add to queue.

import { totalDuration } from '../../core/animation';
import { aspectText, type CameraAspect } from '../../core/aspect';
import { activeCamera } from '../../core/camera';
import { outputFileName } from '../../core/name-template';
import { QUALITY_KEYS, QUALITY_PRESETS, RESOLUTION_PRESETS } from '../../data/quality';
import {
  bitDepthsOf,
  effectiveBounces,
  estimateSamples,
  estimateSeconds,
  formatExtension,
  FPS_CHOICES,
  frameRange,
  matchResolution,
  noiseFraction,
  NOISE_THRESHOLD_MAX,
  NOISE_THRESHOLD_MIN,
  settingsOf,
  supportsAlpha,
  videoExtension,
  videoLabel,
  type AdvancedSettings,
  type BitDepth,
  type CameraChoice,
  type OutputFormat,
  type RenderSettings,
} from '../../core/render';
import { matchPrintPreset, pixelsFor, printLength, printPresetPixels, PRINT_PRESETS, PRINT_UNITS, type PrintUnit } from '../../core/print-size';
import { NAME_TOKENS, type NameToken } from '../../core/name-template';
import * as cmd from '../commands';
import { CAUSTICS_MODES, CAUSTICS_PRESETS, CAUSTICS_QUALITIES, DENOISE_MODES, denoiseIn } from '../../core/caustics';
import { numberField, segmented, select, slider, timeField, toggle } from '../components/controls';
import { section } from '../components/section';
import { h, icon, isTyping, placeAt } from '../dom';
import { cameraName, dyn } from '../names';
import { aiPostBody } from './ai-post';
import { pluginsBody, renderPlugins } from './plugins';
import { runtimeBadge } from './ai-runtime-notice';
import type { Ctx, Scope } from '../reactive';
import type { VideoSupportUi } from '../ui-state';
import { nameValues } from '../render-queue';
import { kbdText } from '../shortcuts';
import { formatClock, formatNumber, framesText, getLang, lbl, t } from '../strings';

/** Seconds in words for estimates: "45 s", "4 min", "1 h 20 min". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, seconds);
  if (s < 59.5) return t('time.s', { n: Math.max(1, Math.round(s)) });
  const m = Math.round(s / 60);
  if (m < 60) return t('time.min', { n: m });
  return t('time.h', { h: Math.floor(m / 60), m: m % 60 });
}

/** "PNG 16-bit", "JPEG 92", "TIFF 32-bit float", "DNG", "EXR". */
function formatText(s: RenderSettings): string {
  if (s.format === 'PNG') return `PNG ${t('rw.bits', { n: s.bitDepth })}`;
  if (s.format === 'TIFF') return `TIFF ${t(s.bitDepth === 32 ? 'rw.bitsFloat' : 'rw.bits', { n: s.bitDepth })}`;
  if (s.format === 'JPEG') return `JPEG ${s.jpegQuality}`;
  return s.format;
}

/** E10: a noise threshold as the window writes it, "1.0 %". */
export function noiseText(percent: number): string {
  return `${formatNumber(percent, getLang(), 1)} %`;
}

function finishText(s: RenderSettings): string {
  const samples = t('rw.summarySamples', { n: formatNumber(s.maxSamples, getLang(), 0) });
  const time = formatClock(s.maxSeconds);
  if (s.finishBy === 'NOISE') return t('rw.summaryNoise', { t: noiseText(s.noiseThreshold) });
  return s.finishBy === 'SAMPLES' ? samples : s.finishBy === 'TIME' ? time : t('rw.summaryOr', { a: samples, b: time });
}

/** The footer's one line: "1920 × 1080 · 300 DPI · 256 samples · PNG 8-bit → Downloads · AI off". */
export function summaryLine(s: RenderSettings, frames: number, video: VideoSupportUi | null = null): string {
  const dest = s.destination.kind === 'FOLDER' ? s.destination.name : t('rw.downloads');
  // N1: a video is its container and codec, not the frames' format.
  const out = `${s.mode === 'ANIMATION' && s.animation.output === 'VIDEO' ? videoLabel(s.animation.video, video?.WEBM) : formatText(s)} → ${dest}`;
  // X4b: with several variants, how many AI images the one render becomes (images only).
  const ai = !s.ai.enabled ? t('rw.summaryAiOff') : s.ai.variants > 1 && s.mode !== 'ANIMATION' ? t('rw.summaryAiVariants', { n: s.ai.variants }) : t('rw.summaryAiOn');
  if (s.mode === 'ANIMATION') {
    return [t('rw.summaryFrames', { frames: framesText(frames), fps: s.animation.fps }), `${s.width} × ${s.height}`, t('rw.perFrameShort', { x: finishText(s) }), out, ai].join(' · ');
  }
  return [`${s.width} × ${s.height}`, `${s.dpi} ${t('rw.dpiUnit')}`, finishText(s), out, ai].join(' · ');
}

/** Pixel-samples per second the engine measured on this machine (never assumed). */
function throughputOf(ctx: Ctx): number | null {
  return ctx.ui.get().throughput;
}

/**
 * The estimate line of the Quality section. E10, by noise: the time the Full view sampling to the same threshold took
 * and expects from its last pass (`noise`), scaled to the output's pixels; nothing before it said so.
 */
export function estimateLine(s: RenderSettings, tp: number | null, frames: number, noise: { seconds: number; pixels: number; target: number } | null = null): string {
  if (s.finishBy === 'NOISE' && s.mode !== 'ANIMATION') {
    if (!noise || noise.target !== noiseFraction(s.noiseThreshold) || !(noise.pixels > 0) || !(noise.seconds >= 0)) return t('rw.estimateNoiseNone');
    return t('rw.estimateNoise', { time: formatDuration((noise.seconds * s.width * s.height) / noise.pixels), t: noiseText(s.noiseThreshold) });
  }
  if (s.mode === 'ANIMATION') {
    const each = estimateSeconds(s, tp, 1);
    if (each === null) return t('rw.estimateNone');
    return t('rw.estimateFrames', { each: formatDuration(each), total: formatDuration(each * frames), frames: framesText(frames) });
  }
  if (s.finishBy === 'TIME') {
    const n = estimateSamples(s, tp);
    return n === null ? t('rw.estimateTimeOnly', { time: formatClock(s.maxSeconds) }) : t('rw.estimateTime', { time: formatClock(s.maxSeconds), samples: formatNumber(n, getLang(), 0) });
  }
  const sec = estimateSeconds(s, tp, 1);
  return sec === null ? t('rw.estimateNone') : t('rw.estimate', { time: formatDuration(sec) });
}

const cameraValue = (c: CameraChoice) => (c.kind === 'ONE' ? `ONE:${c.id}` : c.kind);

/** A row: label on the left, controls on the right, an optional note under the controls. */
function row(label: string, ...controls: (Node | null)[]): HTMLElement {
  return h('div', { class: 'rw-row' }, h('div', { class: 'rw-label' }, label), h('div', { class: 'rw-ctrl' }, ...controls));
}

export function renderWindow(ctx: Ctx, scope: Scope): HTMLElement {
  const { store, ui, services } = ctx;
  const editing = ui.get().renderWindow?.kind === 'EDIT';
  const get = () => cmd.windowSettings(ctx);
  const set = (patch: Partial<RenderSettings>, gesture?: string) => cmd.setRenderSettings(ctx, patch, gesture);
  const s0 = get();

  // ------------------------------------------------------------------ title bar
  const mode = segmented(
    [
      { value: 'IMAGE' as const, label: t('rw.image') },
      { value: 'ANIMATION' as const, label: t('rw.animation') },
    ],
    s0.mode,
    (m) => set({ mode: m }),
    { ariaLabel: t('rw.title') },
  );
  const closeBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('common.close'), 'data-tip': t('rw.close'), 'data-kbd': t('key.escape'), onclick: () => cmd.closeRenderWindow(ctx) }, icon('close'));
  const titleText = h('span', { class: 'rw-title-text' }, t('rw.title'));
  const editNote = h('span', { class: 'aux' });
  const titleBar = h('div', { class: 'rw-titlebar', 'data-tip': undefined }, titleText, mode.el, editNote, h('span', { style: 'flex:1' }), closeBtn);

  // ------------------------------------------------------------------ output
  const nameInput = h('input', { type: 'text', class: 'text-input rw-name', value: s0.name, 'aria-label': t('rw.name'), spellcheck: 'false' }) as HTMLInputElement;
  const namePreview = h('div', { class: 'note rw-preview tabular' });
  const showPreview = () => {
    const s = get();
    const st = store.get();
    const cam = s.mode === 'ANIMATION' ? null : s.camera.kind === 'ONE' ? s.camera.id : st.camera.active;
    const job = { seq: st.render.seq + 1, settings: s };
    const name = outputFileName(nameInput.value, nameValues(st, job, cam, s.mode === 'ANIMATION' ? frameRange(s.animation, totalDuration(st)).first : job.seq), formatExtension(s.format), s.mode === 'ANIMATION');
    namePreview.textContent = `→ ${name}`;
  };
  const commitName = () => {
    if (nameInput.value !== get().name) set({ name: nameInput.value });
  };
  nameInput.addEventListener('input', showPreview);
  nameInput.addEventListener('blur', commitName);
  nameInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') nameInput.blur();
    else if (e.key === 'Escape') {
      nameInput.value = get().name;
      showPreview();
      nameInput.blur();
    }
  });
  const chips = h(
    'div',
    { class: 'rw-chips', role: 'group', 'aria-label': t('rw.tokens') },
    ...NAME_TOKENS.map((tok: NameToken) =>
      h(
        'button',
        {
          type: 'button',
          class: 'chip',
          'data-token': tok,
          'data-tip': t('rw.tokenTip', { token: `{${tok}}` }),
          // Keep the caret where it is in the field.
          onmousedown: (e: MouseEvent) => e.preventDefault(),
          onclick: () => {
            const v = nameInput.value;
            const at = document.activeElement === nameInput ? (nameInput.selectionStart ?? v.length) : v.length;
            const end = document.activeElement === nameInput ? (nameInput.selectionEnd ?? at) : at;
            const token = `{${tok}}`;
            nameInput.value = v.slice(0, at) + token + v.slice(end);
            set({ name: nameInput.value });
            nameInput.focus();
            nameInput.setSelectionRange(at + token.length, at + token.length);
            showPreview();
          },
        },
        t(dyn(`rw.token.${tok}`)),
      ),
    ),
  );

  const files = services.files;
  const downloadsBtn = h('button', { type: 'button', onclick: () => set({ destination: { kind: 'DOWNLOADS' } }) }, icon('download', 14), t('rw.downloads'));
  const folderBtn = h('button', { type: 'button', disabled: !files.canChooseFolder, onclick: () => void cmd.chooseFolder(ctx) }, icon('folder', 14), h('span', { class: 'rw-folder-name' }, t('rw.chooseFolder')));
  const destSeg = h('div', { class: 'seg', role: 'group', 'aria-label': t('rw.folder') }, downloadsBtn, folderBtn);
  const destNote = h('div', { class: 'note' }, files.canChooseFolder ? '' : t('rw.onlyDownload'));
  const showDone = toggle(s0.showWhenDone, (v) => set({ showWhenDone: v }), t('rw.showWhenDone'));

  const format = segmented<OutputFormat>(
    [
      { value: 'PNG', label: 'PNG' },
      { value: 'JPEG', label: 'JPEG' },
      { value: 'EXR', label: 'EXR', title: t('rw.exrTip') },
      { value: 'TIFF', label: 'TIFF', title: t('rw.tiffTip') },
      { value: 'DNG', label: t('rw.dngLabel'), title: t('rw.dngTip') },
    ],
    s0.format,
    (v) => set({ format: v }),
    { ariaLabel: t('rw.format') },
  );
  // PNG offers 8 and 16 bits; TIFF adds the 32-bit float (linear). Each has its own control, so the divider of the
  // last button is right; RAW (DNG) has no choice and says what it is.
  const bitsOf = (depths: readonly BitDepth[]) =>
    segmented(
      depths.map((d) => ({ value: String(d) as '8' | '16' | '32', label: t(d === 32 ? 'rw.bitsFloat' : 'rw.bits', { n: d }) })),
      String(s0.bitDepth) as '8' | '16' | '32',
      (v) => set({ bitDepth: v === '32' ? 32 : v === '16' ? 16 : 8 }),
      { ariaLabel: t('rw.bitDepth') },
    );
  const bitsPng = bitsOf(bitDepthsOf('PNG'));
  const bitsTiff = bitsOf(bitDepthsOf('TIFF'));
  const bitsFixed = h('span', { class: 'aux' }, t('rw.bitsFloat', { n: 32 }));
  // One line about the format when it has something to say (the same text as the button's tooltip).
  const formatNote = h('div', { class: 'note' });
  // U15: the bounded values of the window (a quality, a percentage, a threshold) are sliders with their field.
  const jpegQ = slider({ value: s0.jpegQuality, min: 1, max: 100, step: 1, ariaLabel: t('rw.jpegQuality'), onChange: (v, g) => set({ jpegQuality: v }, g) });
  const jpegBox = h('span', { class: 'rw-inline' }, h('span', { class: 'aux' }, t('rw.jpegQuality')), jpegQ.el);
  const transparent = toggle(s0.transparent, (v) => set({ transparent: v }), t('rw.transparent'));
  const transparentNote = h('span', { class: 'note' });
  const passes = toggle(false, () => {}, t('rw.passes'), true);

  const cameraSel = select([], cameraValue(s0.camera), (v) => {
    const c: CameraChoice = v === 'ALL' ? { kind: 'ALL' } : v === 'ACTIVE' ? { kind: 'ACTIVE' } : { kind: 'ONE', id: v.slice(4) };
    set({ camera: c });
  }, t('rw.camera'));
  const cameraNote = h('div', { class: 'note' });

  const outputBody = h(
    'div',
    { class: 'rw-section' },
    row(t('rw.name'), h('div', { class: 'rw-stack' }, nameInput, chips, namePreview)),
    row(t('rw.folder'), h('div', { class: 'rw-stack' }, destSeg, destNote)),
    row(t('rw.showWhenDone'), showDone.el),
    row(t('rw.format'), h('div', { class: 'rw-stack' }, h('div', { class: 'rw-inline' }, format.el, bitsPng.el, bitsTiff.el, bitsFixed, jpegBox), formatNote)),
    row(t('rw.transparent'), h('div', { class: 'rw-inline' }, transparent.el, transparentNote)),
    row(t('rw.passes'), h('div', { class: 'rw-inline' }, passes.el, h('span', { class: 'aux' }, t('common.comingSoon')), h('span', { class: 'note' }, t('rw.passesSoon')))),
    row(t('rw.camera'), h('div', { class: 'rw-stack' }, cameraSel.el, cameraNote)),
  );

  // ------------------------------------------------------------------ size
  // An image's size follows the active camera's aspect ratio (U13). A size that changes that ratio (a preset, or both
  // sides, or one with the lock open) rewrites the camera's, and the window says so in one quiet line.
  const aspectLine = h('div', { class: 'note', 'data-aspect-line': '' });
  let aspectNote: { camera: string; aspect: CameraAspect; text: string } | null = null;
  const updateAspectLine = () => {
    const st = store.get();
    const s = get();
    const cam = activeCamera(st);
    // A queued job being edited and an animation have a size of their own: no camera rules them.
    const own = ui.get().renderWindow?.kind === 'EDIT' || s.mode === 'ANIMATION';
    aspectLine.style.display = own ? 'none' : '';
    if (aspectNote && (aspectNote.camera !== cam.id || aspectNote.aspect !== cam.aspect)) aspectNote = null;
    const params = { camera: cameraName(st, cam), aspect: aspectText(cam.aspect) };
    aspectLine.textContent = aspectNote ? aspectNote.text : t(s.aspectLock ? 'rw.aspectFollows' : 'rw.aspectFree', params);
  };
  const setSize = (patch: Partial<RenderSettings>, gesture?: string) => {
    const own = ui.get().renderWindow?.kind === 'EDIT' || get().mode === 'ANIMATION';
    const before = own ? null : activeCamera(store.get());
    set(patch, gesture);
    const after = activeCamera(store.get());
    aspectNote =
      before && before.id === after.id && before.aspect !== after.aspect
        ? { camera: after.id, aspect: after.aspect, text: t('rw.aspectBecomes', { camera: cameraName(store.get(), after), aspect: aspectText(after.aspect) }) }
        : null;
    updateAspectLine();
  };
  const sizeOptions = () => {
    const opts = [
      ...RESOLUTION_PRESETS.map((r) => ({ value: `RES:${r.key}`, label: `${lbl(r.label)} · ${r.width} × ${r.height}` })),
      ...PRINT_PRESETS.map((p) => ({ value: `PRINT:${p.key}`, label: t(dyn(`rw.print.${p.key}`)) })),
      { value: 'CUSTOM', label: t('rw.custom') },
    ];
    return opts;
  };
  const presetValue = (s: RenderSettings): string => {
    const r = matchResolution(s.width, s.height);
    if (r !== 'CUSTOM') return `RES:${r}`;
    const p = matchPrintPreset(s.width, s.height, s.dpi);
    return p ? `PRINT:${p.key}` : 'CUSTOM';
  };
  const applyPreset = (v: string) => {
    const s = get();
    if (v.startsWith('RES:')) {
      const r = RESOLUTION_PRESETS.find((x) => `RES:${x.key}` === v);
      if (r) setSize({ width: r.width, height: r.height });
    } else if (v.startsWith('PRINT:')) {
      const p = PRINT_PRESETS.find((x) => `PRINT:${x.key}` === v);
      if (p) {
        const px = printPresetPixels(p, s.width >= s.height);
        setSize({ width: px.width, height: px.height, dpi: px.dpi });
      }
    }
  };
  const makeSizeControls = () => {
    const preset = select(sizeOptions(), presetValue(s0), applyPreset, t('rw.preset'));
    const w = numberField({ value: s0.width, min: 16, max: 8192, step: 1, unit: 'px', ariaLabel: t('render.width'), onChange: (v, g) => setSize({ width: v }, g) });
    const hgt = numberField({ value: s0.height, min: 16, max: 8192, step: 1, unit: 'px', ariaLabel: t('render.height'), onChange: (v, g) => setSize({ height: v }, g) });
    const lock = h('button', { type: 'button', class: 'icon-btn', onclick: () => set({ aspectLock: !get().aspectLock }) });
    return { preset, w, hgt, lock, el: h('div', { class: 'rw-inline' }, w.el, h('span', { class: 'aux' }, '×'), hgt.el, lock) };
  };
  const size = makeSizeControls();
  const unitDigits = (u: PrintUnit) => (u === 'MM' ? 1 : 2);
  const printFormat = (v: number) => formatNumber(v, getLang(), unitDigits(get().printUnit));
  const printW = numberField({ value: 0, min: 0.01, step: 0.5, format: printFormat, ariaLabel: t('rw.printWidth'), onChange: (v, g) => setSize({ width: pixelsFor(v, get().printUnit, get().dpi) }, g) });
  const printH = numberField({ value: 0, min: 0.01, step: 0.5, format: printFormat, ariaLabel: t('rw.printHeight'), onChange: (v, g) => setSize({ height: pixelsFor(v, get().printUnit, get().dpi) }, g) });
  const unitSel = select(
    PRINT_UNITS.map((u) => ({ value: u, label: t(dyn(`rw.unit.${u}`)) })),
    s0.printUnit,
    (v) => set({ printUnit: v as PrintUnit }),
    t('rw.printUnit'),
  );
  const dpi = numberField({ value: s0.dpi, min: 1, max: 9600, step: 1, unit: t('rw.dpiUnit'), ariaLabel: t('rw.dpi'), onChange: (v, g) => set({ dpi: v }, g) });
  const sizeBody = h(
    'div',
    { class: 'rw-section' },
    row(t('rw.preset'), size.preset.el),
    row(t('rw.pixels'), h('div', { class: 'rw-stack' }, size.el, aspectLine)),
    row(t('rw.print'), h('div', { class: 'rw-stack' }, h('div', { class: 'rw-inline' }, printW.el, h('span', { class: 'aux' }, '×'), printH.el, unitSel.el), h('div', { class: 'note' }, t('rw.pixelsRule')))),
    row(t('rw.dpi'), dpi.el),
    row(t('rw.region'), h('div', { class: 'rw-inline' }, h('span', { class: 'aux' }, t('common.comingSoon')), h('span', { class: 'note' }, t('rw.regionSoon')))),
  );

  // ------------------------------------------------------------------ animation
  const range = segmented(
    [
      { value: 'ALL' as const, label: t('rw.rangeAll') },
      { value: 'RANGE' as const, label: t('rw.rangeFromTo') },
    ],
    s0.animation.range,
    (v) => set({ animation: { ...get().animation, range: v } }),
    { ariaLabel: t('rw.range') },
  );
  const rangeUnit = segmented(
    [
      { value: 'FRAMES' as const, label: t('rw.unitFrames') },
      { value: 'SECONDS' as const, label: t('rw.unitSeconds') },
    ],
    s0.animation.rangeUnit,
    (v) => set({ animation: { ...get().animation, rangeUnit: v } }),
    { ariaLabel: t('rw.rangeUnit') },
  );
  const toUnit = (frame: number) => {
    const a = get().animation;
    return a.rangeUnit === 'SECONDS' ? (frame - 1) / a.fps : frame;
  };
  const fromUnit = (v: number) => {
    const a = get().animation;
    return a.rangeUnit === 'SECONDS' ? Math.round(v * a.fps) + 1 : Math.round(v);
  };
  const from = numberField({ value: 1, min: 0, max: 1_000_000, step: 1, digits: 2, ariaLabel: t('rw.rangeStart'), onChange: (v, g) => set({ animation: { ...get().animation, from: fromUnit(v) } }, g) });
  const to = numberField({ value: 1, min: 0, max: 1_000_000, step: 1, digits: 2, ariaLabel: t('rw.rangeEnd'), onChange: (v, g) => set({ animation: { ...get().animation, to: fromUnit(v) } }, g) });
  const rangeBox = h('span', { class: 'rw-inline' }, h('span', { class: 'aux' }, t('rw.from')), from.el, h('span', { class: 'aux' }, t('rw.to')), to.el, rangeUnit.el);
  const fps = segmented(
    FPS_CHOICES.map((f) => ({ value: String(f), label: String(f) })),
    String(s0.animation.fps),
    (v) => set({ animation: { ...get().animation, fps: Number(v) } }),
    { ariaLabel: t('rw.fps') },
  );
  const durationNote = h('div', { class: 'note tabular' });
  // N1: video where this system encodes it (asked at start: `ui.video`); the frames always. A codec it cannot encode
  // is there, disabled, with why; nothing is offered that would not be written.
  const animOutHost = h('span', { class: 'rw-inline' });
  const codecHost = h('span', { class: 'rw-inline' });
  let animOut: ReturnType<typeof segmented<'VIDEO' | 'FRAMES'>> | null = null;
  let codec: ReturnType<typeof segmented<'MP4' | 'WEBM'>> | null = null;
  let videoKey = '';
  const buildVideo = () => {
    const v = ui.get().video;
    const key = v ? `${v.MP4}|${v.WEBM}` : 'asking';
    if (key === videoKey) return;
    videoKey = key;
    const any = !!v && (v.MP4 !== null || v.WEBM !== null);
    animOut = segmented(
      [
        { value: 'VIDEO' as const, label: t('rw.video'), disabled: !any && get().animation.output !== 'VIDEO', title: !v ? t('rw.videoAsking') : any ? t('rw.videoTip') : t('rw.videoNone') },
        { value: 'FRAMES' as const, label: t('rw.frames') },
      ],
      get().animation.output,
      (o) => set({ animation: { ...get().animation, output: o } }),
      { ariaLabel: t('rw.animOutput') },
    );
    codec = segmented(
      [
        { value: 'MP4' as const, label: videoLabel('MP4'), disabled: !v?.MP4, title: v?.MP4 ? undefined : t('rw.codecCannot', { video: videoLabel('MP4') }) },
        { value: 'WEBM' as const, label: videoLabel('WEBM', v?.WEBM), disabled: !v?.WEBM, title: v?.WEBM ? undefined : t('rw.codecCannot', { video: videoLabel('WEBM') }) },
      ],
      get().animation.video,
      (c) => set({ animation: { ...get().animation, video: c } }),
      { ariaLabel: t('rw.video') },
    );
    animOutHost.replaceChildren(animOut.el);
    codecHost.replaceChildren(codec.el);
  };
  buildVideo();
  const framesNote = h('div', { class: 'note' });
  const videoNote = h('div', { class: 'note', 'data-video-note': '' });
  const animSize = makeSizeControls();
  const animBody = h(
    'div',
    { class: 'rw-section' },
    row(t('rw.range'), h('div', { class: 'rw-stack' }, h('div', { class: 'rw-inline' }, range.el, rangeBox), durationNote)),
    row(t('rw.fps'), fps.el),
    row(t('rw.animOutput'), h('div', { class: 'rw-stack' }, h('div', { class: 'rw-inline' }, animOutHost, codecHost), framesNote, videoNote)),
    row(t('rw.frameSize'), h('div', { class: 'rw-stack' }, animSize.preset.el, animSize.el)),
    row(t('rw.cameraShort'), h('div', { class: 'note' }, t('rw.cameraTrack'))),
  );

  // ------------------------------------------------------------------ quality
  const finishBy = segmented(
    [
      { value: 'SAMPLES' as const, label: t('rw.bySamples') },
      { value: 'TIME' as const, label: t('rw.byTime') },
      // E10: adaptive sampling to a noise threshold.
      { value: 'NOISE' as const, label: t('rw.byNoise') },
    ],
    s0.finishBy === 'FIRST' ? null : s0.finishBy,
    (v) => set({ finishBy: v }),
    { ariaLabel: t('rw.finishBy') },
  );
  const firstNote = h('span', { class: 'note' }, t('rw.firstOfOn'));
  const samples = numberField({ value: s0.maxSamples, min: 1, max: 100000, step: 16, ariaLabel: t('rw.samples'), onChange: (v, g) => set({ maxSamples: v }, g) });
  const tiers = segmented(
    QUALITY_KEYS.map((k) => ({ value: k, label: `${lbl(QUALITY_PRESETS[k].label)} ${QUALITY_PRESETS[k].samples}` })),
    s0.quality === 'CUSTOM' ? null : s0.quality,
    (q) => set({ quality: q, maxSamples: QUALITY_PRESETS[q].samples }),
    { ariaLabel: t('rw.samples') },
  );
  const time = timeField(s0.maxSeconds, (v, g) => set({ maxSeconds: v }, g), t('rw.time'));
  const samplesRow = row(t('rw.samples'), h('div', { class: 'rw-inline' }, samples.el, tiers.el));
  const timeRow = row(t('rw.time'), h('div', { class: 'rw-inline' }, time.el, h('span', { class: 'aux' }, t('rw.timeTip'))));
  // E10: the noise every pixel ends under (percent, the relative error of its mean).
  const noise = slider({
    value: s0.noiseThreshold,
    min: NOISE_THRESHOLD_MIN,
    max: NOISE_THRESHOLD_MAX,
    step: 0.1,
    digits: 1,
    format: (v) => noiseText(v),
    ariaLabel: t('rw.noiseThreshold'),
    onChange: (v, g) => set({ noiseThreshold: v }, g),
  });
  const noiseRow = row(t('rw.noiseThreshold'), h('div', { class: 'rw-stack' }, noise.el, h('div', { class: 'note' }, t('rw.noiseNote'))));
  const estimate = h('div', { class: 'rw-estimate tabular', role: 'status' });
  const perFrame = h('div', { class: 'note' }, t('rw.perFrame'));
  const firstOf = toggle(s0.finishBy === 'FIRST', (v) => set({ finishBy: v ? 'FIRST' : 'SAMPLES' }), t('rw.firstOf'));
  const bounces = numberField({
    value: s0.advanced.maxBounces ?? 0,
    min: 0,
    max: 64,
    step: 1,
    format: (v) => (v <= 0 ? t('rw.auto', { n: effectiveBounces({ ...get(), advanced: { ...get().advanced, maxBounces: null } }) }) : String(v)),
    ariaLabel: t('rw.bounces'),
    onChange: (v, g) => set({ advanced: { ...get().advanced, maxBounces: v <= 0 ? null : v } }, g),
  });
  const clamp = numberField({ value: s0.advanced.clampIndirect, min: 0, max: 1000, step: 0.5, digits: 1, format: (v) => (v <= 0 ? t('rw.clampOff') : formatNumber(v, getLang(), 1)), ariaLabel: t('rw.clamp'), onChange: (v, g) => set({ advanced: { ...get().advanced, clampIndirect: v } }, g) });
  const seed = numberField({ value: s0.advanced.seed, min: 0, max: 4294967295, step: 1, ariaLabel: t('rw.seed'), onChange: (v, g) => set({ advanced: { ...get().advanced, seed: v } }, g) });
  // E5b-1: the engine's caustics (photon map) and its own denoiser.
  const setAdvanced = (patch: Partial<AdvancedSettings>) => set({ advanced: { ...get().advanced, ...patch } });
  const caustics = segmented(
    CAUSTICS_MODES.map((m) => ({ value: m, label: t(`rw.caustics${m === 'AUTO' ? 'Auto' : m === 'ON' ? 'On' : 'Off'}`) })),
    s0.advanced.caustics,
    (v) => setAdvanced({ caustics: v }),
    { ariaLabel: t('rw.caustics') },
  );
  const causticsNote = h('div', { class: 'note' });
  const causticsQuality = segmented(
    CAUSTICS_QUALITIES.map((q) => ({ value: q, label: t(`rw.causticsQ${q === 'LOW' ? 'Low' : q === 'MEDIUM' ? 'Medium' : 'High'}`) })),
    s0.advanced.causticsQuality,
    (v) => setAdvanced({ causticsQuality: v }),
    { ariaLabel: t('rw.causticsQuality') },
  );
  const causticsQualityNote = h('div', { class: 'note' });
  const denoise = segmented(
    DENOISE_MODES.map((m) => ({ value: m, label: t(`rw.denoise${m === 'OFF' ? 'Off' : m === 'VIEWPORT' ? 'Viewport' : m === 'RENDER' ? 'Render' : 'Both'}`) })),
    s0.advanced.denoise,
    (v) => setAdvanced({ denoise: v }),
    { ariaLabel: t('rw.denoise') },
  );
  // U11b: how much of the denoised image, for the render and the Full viewport alike (one knob).
  const strength = slider({
    value: s0.advanced.denoiseStrength,
    min: 0,
    max: 100,
    step: 5,
    format: (v) => `${formatNumber(v, getLang(), 0)} %`,
    ariaLabel: t('rw.denoiseStrength'),
    onChange: (v, g) => set({ advanced: { ...get().advanced, denoiseStrength: v } }, g),
  });
  const strengthRow = row(t('rw.denoiseStrength'), h('div', { class: 'rw-stack' }, strength.el, h('div', { class: 'note' }, t('rw.denoiseStrengthNote'))));
  const saveNoisy = toggle(s0.advanced.saveNoisy, (v) => setAdvanced({ saveNoisy: v }), t('rw.saveNoisy'));
  const saveNoisyRow = row(t('rw.saveNoisy'), h('div', { class: 'rw-inline' }, saveNoisy.el, h('span', { class: 'note' }, t('rw.saveNoisyNote'))));
  const advancedBody = h(
    'div',
    { class: 'rw-section' },
    row(t('rw.firstOf'), h('div', { class: 'rw-inline' }, firstOf.el, h('span', { class: 'note' }, t('rw.firstOfNote')))),
    row(t('rw.bounces'), bounces.el),
    row(t('rw.clamp'), clamp.el),
    row(t('rw.seed'), seed.el),
    row(t('rw.causticsQuality'), h('div', { class: 'rw-stack' }, causticsQuality.el, causticsQualityNote)),
    row(t('rw.denoise'), h('div', { class: 'rw-stack' }, denoise.el, h('div', { class: 'note' }, t('rw.denoiseNote')))),
    strengthRow,
    saveNoisyRow,
  );
  const qualityBody = h(
    'div',
    { class: 'rw-section' },
    row(t('rw.finishBy'), h('div', { class: 'rw-inline' }, finishBy.el, firstNote)),
    noiseRow,
    samplesRow,
    timeRow,
    row(t('rw.estimateLabel'), h('div', { class: 'rw-stack' }, estimate, perFrame)),
    row(t('rw.caustics'), h('div', { class: 'rw-stack' }, caustics.el, causticsNote)),
    section(ctx, 'rw.advanced', t('rw.advanced'), advancedBody, null, true),
  );

  // ------------------------------------------------------------------ AI post-processing (X4, ui/panels/ai-post.ts)
  const aiBody = aiPostBody(ctx, scope, { get, set: (patch, gesture, label) => cmd.setRenderSettings(ctx, patch, gesture, label) });

  const outputSec = section(ctx, 'rw.output', t('rw.output'), outputBody);
  const sizeSec = section(ctx, 'rw.size', t('rw.size'), sizeBody);
  const animSec = section(ctx, 'rw.anim', t('rw.animSection'), animBody);
  const qualitySec = section(ctx, 'rw.quality', t('rw.quality'), qualityBody);
  const aiSec = section(ctx, 'rw.ai', t('rw.ai'), aiBody, runtimeBadge(ctx, scope), true);
  // P6: the installed plugins after the AI (ui/panels/plugins.ts); folded at first while none is installed.
  const pluginsBodyEl = pluginsBody(ctx, scope, { get, set: (patch, gesture, label) => cmd.setRenderSettings(ctx, patch, gesture, label) });
  const pluginsSec = section(ctx, 'rw.plugins', t('rw.plugins'), pluginsBodyEl, null, renderPlugins(ui.get().plugins?.installed).length === 0);
  // A queued job being edited has no result to work on: the section is the project's.
  if (editing) pluginsSec.style.display = 'none';
  const body = h('div', { class: 'rw-body' }, outputSec, sizeSec, animSec, qualitySec, aiSec, pluginsSec);

  // ------------------------------------------------------------------ footer
  const summary = h('div', { class: 'rw-summary aux tabular' });
  const addBtn = h('button', { type: 'button', class: 'btn', 'data-kbd': kbdText('shift+enter'), 'data-tip': t('rw.addTip'), onclick: () => void cmd.addToQueueFromWindow(ctx) }, icon('plus', 14), t('render.addQueue'));
  const renderBtn = h('button', { type: 'button', class: 'btn btn-primary btn-big', 'data-kbd': kbdText('enter'), 'data-tip': t('rw.renderTip'), onclick: () => void cmd.renderFromWindow(ctx) }, t('rw.render'));
  const cancelBtn = h('button', { type: 'button', class: 'btn', onclick: () => cmd.closeRenderWindow(ctx) }, t('common.cancel'));
  const saveBtn = h('button', { type: 'button', class: 'btn btn-primary btn-big', 'data-kbd': kbdText('enter'), onclick: () => cmd.saveJobEdit(ctx) }, t('rw.save'));
  const foot = h('div', { class: 'rw-foot' }, summary, h('div', { class: 'rw-foot-actions', 'data-guide': 'rw-actions' }, ...(editing ? [cancelBtn, saveBtn] : [addBtn, renderBtn])));

  const win = h('div', { class: 'rw', role: 'dialog', tabindex: -1, 'aria-label': t('rw.title'), 'aria-modal': 'false', 'data-render-window': '', 'data-guide': 'render-window' }, titleBar, body, foot);
  const backdrop = h('div', { class: 'rw-backdrop', 'aria-hidden': 'true', onpointerdown: () => cmd.closeRenderWindow(ctx) });
  const host = h('div', { class: 'rw-host' }, backdrop, win);

  // ------------------------------------------------------------------ sync
  const sync = () => {
    const s = get();
    const st = store.get();
    const anim = s.mode === 'ANIMATION';
    mode.set(s.mode);
    win.dataset.mode = s.mode;
    if (document.activeElement !== nameInput) nameInput.value = s.name;
    showPreview();
    // Folder.
    const folder = s.destination.kind === 'FOLDER' ? s.destination : null;
    downloadsBtn.setAttribute('aria-pressed', String(!folder));
    folderBtn.setAttribute('aria-pressed', String(folder !== null));
    (folderBtn.querySelector('.rw-folder-name') as HTMLElement).textContent = folder ? folder.name : t('rw.chooseFolder');
    folderBtn.setAttribute('data-tip', folder ? t('rw.changeFolder') : files.canChooseFolder ? t('rw.chooseFolderTip') : t('rw.onlyDownload'));
    destNote.textContent = files.canChooseFolder ? (folder ? t(files.desktop ? 'rw.folderNoteDesktop' : 'rw.folderNote', { name: folder.name }) : '') : t('rw.onlyDownload');
    showDone.set(s.showWhenDone);
    // Format.
    format.set(s.format);
    bitsPng.set(String(s.bitDepth) as '8' | '16' | '32');
    bitsTiff.set(String(s.bitDepth) as '8' | '16' | '32');
    bitsPng.el.style.display = s.format === 'PNG' ? '' : 'none';
    bitsTiff.el.style.display = s.format === 'TIFF' ? '' : 'none';
    bitsFixed.style.display = s.format === 'DNG' ? '' : 'none';
    formatNote.textContent = s.format === 'EXR' ? t('rw.exrTip') : s.format === 'TIFF' ? t('rw.tiffTip') : s.format === 'DNG' ? t('rw.dngTip') : '';
    jpegBox.style.display = s.format === 'JPEG' ? '' : 'none';
    jpegQ.set(s.jpegQuality);
    transparent.set(s.transparent);
    (transparent.el as HTMLButtonElement).disabled = !supportsAlpha(s.format);
    transparentNote.textContent = supportsAlpha(s.format) ? '' : t(s.format === 'DNG' ? 'rw.transparentNoDng' : 'rw.transparentNo');
    // Camera (the list is rebuilt only when the cameras change: an open dropdown stays open).
    const cams = Object.values(st.camera.cameras);
    const active = st.camera.cameras[st.camera.active];
    const opts = [
      { value: 'ACTIVE', label: t('rw.cameraActive', { name: cameraName(st, active) }) },
      ...cams.map((c) => ({ value: `ONE:${c.id}`, label: cameraName(st, c) })),
      { value: 'ALL', label: t('rw.cameraAll', { n: cams.length }), disabled: editing },
    ];
    const sel = cameraSel.el as HTMLSelectElement;
    const optKey = opts.map((o) => `${o.value}=${o.label}`).join('|');
    if (sel.dataset.options !== optKey) {
      sel.dataset.options = optKey;
      sel.replaceChildren(...opts.map((o) => h('option', { value: o.value, disabled: o.disabled }, o.label)));
    }
    sel.value = cameraValue(s.camera);
    if (sel.value === '') sel.value = 'ACTIVE';
    sel.disabled = anim;
    cameraNote.textContent = anim ? t('rw.cameraTrack') : s.camera.kind === 'ALL' ? t('rw.cameraAllNote', { n: cams.length }) : '';
    // Size.
    for (const z of [size, animSize]) {
      z.preset.set(presetValue(s));
      z.w.set(s.width);
      z.hgt.set(s.height);
      z.lock.replaceChildren(icon(s.aspectLock ? 'lock' : 'unlock', 16));
      z.lock.setAttribute('aria-pressed', String(s.aspectLock));
      z.lock.setAttribute('aria-label', s.aspectLock ? t('rw.unlock') : t('rw.lock'));
      z.lock.setAttribute('data-tip', s.aspectLock ? t('rw.unlock') : t('rw.lock'));
    }
    updateAspectLine();
    printW.set(printLength(s.width, s.dpi, s.printUnit));
    printH.set(printLength(s.height, s.dpi, s.printUnit));
    unitSel.set(s.printUnit);
    dpi.set(s.dpi);
    // Sections by mode: Size for an image, Animation for an animation.
    sizeSec.style.display = anim ? 'none' : '';
    animSec.style.display = anim ? '' : 'none';
    // Animation.
    const a = s.animation;
    const fr = frameRange(a, totalDuration(st));
    range.set(a.range);
    rangeBox.style.display = a.range === 'RANGE' ? '' : 'none';
    rangeUnit.set(a.rangeUnit);
    from.set(Number(toUnit(a.from).toFixed(2)));
    to.set(Number(toUnit(a.to).toFixed(2)));
    fps.set(String(a.fps));
    durationNote.textContent = t('rw.duration', { frames: framesText(fr.count), time: formatNumber(fr.count / a.fps, getLang(), 2) });
    buildVideo();
    const v = ui.get().video;
    const isVideo = a.output === 'VIDEO';
    animOut?.set(a.output);
    // A codec is chosen only for video.
    codec?.set(isVideo ? a.video : null);
    codecHost.style.display = isVideo ? '' : 'none';
    framesNote.style.display = isVideo ? 'none' : '';
    framesNote.textContent = t('rw.framesNote', { name: outputFileName(s.name, nameValues(st, { seq: st.render.seq + 1, settings: s }, null, fr.first), formatExtension(s.format), true) });
    videoNote.style.display = isVideo ? '' : 'none';
    if (isVideo) {
      const name = outputFileName(s.name, nameValues(st, { seq: st.render.seq + 1, settings: s }, null), videoExtension(a.video));
      const can = a.video === 'MP4' ? v?.MP4 : v?.WEBM;
      const lines = [can ? t('rw.videoNote', { name, codec: videoLabel(a.video, v?.WEBM), frames: framesText(fr.count), fps: a.fps }) : v ? t('rw.codecCannot', { video: videoLabel(a.video) }) : t('rw.videoAsking')];
      if (s.width % 2 !== 0 || s.height % 2 !== 0) lines.push(t('rw.videoEven', { w: s.width - (s.width % 2), h: s.height - (s.height % 2) }));
      videoNote.textContent = lines.join(' · ');
    }
    // Quality.
    finishBy.set(s.finishBy === 'FIRST' ? null : s.finishBy);
    firstNote.style.display = s.finishBy === 'FIRST' ? '' : 'none';
    samplesRow.style.display = s.finishBy === 'TIME' ? 'none' : '';
    timeRow.style.display = s.finishBy === 'SAMPLES' || s.finishBy === 'NOISE' ? 'none' : '';
    noiseRow.style.display = s.finishBy === 'NOISE' ? '' : 'none';
    noise.set(s.noiseThreshold);
    samples.set(s.maxSamples);
    tiers.set(s.quality === 'CUSTOM' ? null : s.quality);
    time.set(s.maxSeconds);
    firstOf.set(s.finishBy === 'FIRST');
    bounces.set(s.advanced.maxBounces ?? 0);
    clamp.set(s.advanced.clampIndirect);
    seed.set(s.advanced.seed);
    caustics.set(s.advanced.caustics);
    causticsNote.textContent = t(s.advanced.caustics === 'AUTO' ? 'rw.causticsAutoNote' : s.advanced.caustics === 'ON' ? 'rw.causticsOnNote' : 'rw.causticsOffNote');
    causticsQuality.set(s.advanced.causticsQuality);
    const preset = CAUSTICS_PRESETS[s.advanced.causticsQuality];
    causticsQualityNote.textContent = t('rw.causticsQualityNote', { n: formatNumber(preset.photons, getLang(), 0), r: preset.radiusPx });
    denoise.set(s.advanced.denoise);
    strength.set(s.advanced.denoiseStrength);
    strengthRow.style.display = s.advanced.denoise === 'OFF' ? 'none' : '';
    saveNoisy.set(s.advanced.saveNoisy);
    // Only a render that is denoised has an image without denoise to save.
    saveNoisyRow.style.display = denoiseIn(s.advanced.denoise, 'RENDER') ? '' : 'none';
    perFrame.style.display = anim ? '' : 'none';
    estimate.textContent = estimateLine(s, throughputOf(ctx), anim ? fr.count : 1, ctx.ui.get().noiseEstimate);
    summary.textContent = summaryLine(s, fr.count, ui.get().video);
    // Edit mode.
    const w = ui.get().renderWindow;
    const job = w?.kind === 'EDIT' ? st.render.queue.find((j) => j.id === w.jobId) : undefined;
    editNote.textContent = job ? t('rw.editing', { name: outputFileName(job.settings.name, nameValues(st, job, job.settings.camera.kind === 'ONE' ? job.settings.camera.id : null), formatExtension(job.settings.format)) }) : '';
  };
  // Settings, not progress: a running job's ticks change `s.render` but none of these.
  scope.watch(
    (s, u) => [u.renderWindow, ...Object.values(settingsOf(s.render)), s.render.seq, s.camera, s.meta.name, s.animation.shots, s.animation.clips, s.studio.preset, s.studio.customPreset, u.throughput, u.noiseEstimate, u.video] as unknown[],
    sync,
    (x, y) => x.length === y.length && x.every((v, i) => v === y[i]),
  );

  // ------------------------------------------------------------------ move by the title bar
  const place = (x: number, y: number) => {
    const r = win.getBoundingClientRect();
    const nx = Math.max(8 - r.width + 120, Math.min(window.innerWidth - 120, x));
    const ny = Math.max(8, Math.min(window.innerHeight - 48, y));
    win.style.transform = 'none';
    // Screen pixels; the window may be zoomed by Settings ▸ Accessibility ▸ Interface size.
    placeAt(win, nx, ny);
    return { x: nx, y: ny };
  };
  const pos0 = ui.get().renderWindowPos;
  if (pos0) requestAnimationFrame(() => place(pos0.x, pos0.y));
  titleBar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button, input, select')) return;
    e.preventDefault();
    const r = win.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    let last = { x: r.left, y: r.top };
    try {
      titleBar.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events.
    }
    win.classList.add('is-moving');
    const move = (ev: PointerEvent) => (last = place(ev.clientX - dx, ev.clientY - dy));
    const up = () => {
      win.classList.remove('is-moving');
      titleBar.removeEventListener('pointermove', move);
      titleBar.removeEventListener('pointerup', up);
      titleBar.removeEventListener('pointercancel', up);
      ui.set({ renderWindowPos: last });
    };
    titleBar.addEventListener('pointermove', move);
    titleBar.addEventListener('pointerup', up);
    titleBar.addEventListener('pointercancel', up);
  });
  titleBar.addEventListener('dblclick', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    win.style.left = '';
    win.style.top = '';
    win.style.transform = '';
    ui.set({ renderWindowPos: null });
  });

  // ------------------------------------------------------------------ keys
  const onKey = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || e.isComposing) return;
    const u = ui.get();
    if (u.paletteOpen || document.querySelector('.floating')) return;
    const target = e.target as HTMLElement | null;
    // Typing is text being entered (a field being edited); a focused number field that is not being
    // edited lets ⏎ render, so "type a value, ⏎, ⏎" commits and renders.
    const typing = isTyping(e) && target?.getAttribute?.('role') !== 'spinbutton';
    const act = (fn: () => void) => {
      e.preventDefault();
      e.stopPropagation();
      fn();
    };
    if (e.key === 'Escape' && !typing) act(() => cmd.closeRenderWindow(ctx));
    else if (e.key === 'Enter' && !e.altKey && !(e.ctrlKey || e.metaKey) && !typing && !target?.closest?.('button, a, select, textarea')) {
      act(() => (e.shiftKey ? void cmd.addToQueueFromWindow(ctx) : void cmd.renderFromWindow(ctx)));
    }
  };
  document.addEventListener('keydown', onKey, true);
  scope.onDispose(() => document.removeEventListener('keydown', onKey, true));

  // The window takes the focus, so ⏎, ⇧ ⏎ and Esc work at once.
  requestAnimationFrame(() => win.focus({ preventScroll: true }));
  return host;
}
