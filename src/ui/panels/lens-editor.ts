// The lens editor (phase O2c, UI.md §2.11, the triage's 1.5): a window of its own, like the material editor, open on
// one camera's traced lens from Camera ▸ Lens ▸ Edit elements…. It floats over the application without dimming it and
// is moved by its title bar; Esc or × closes it (an edit not applied stays with the camera).
//
//   Title bar   Lens editor · the lens's name · Discard changes · Save to library… · Apply to the camera · ×
//   Left        the section as the engine traces it (the chosen element drawn stronger, each numbered), the tools
//               for the chosen element (add before or after, turn 180°, delete, smaller, larger, automatic aperture)
//               and the list: per element its radii, thickness, glass, clear diameter and the air after it; the iris
//   Right       whether the lens can be applied and, when not, why; what the engine computes of it: the design's
//               focal length, back focus, f-number and T-stop, elements and groups, length, image circle, the
//               distortion and the light towards the corner
//   Foot        the dimensions are the design's (the camera scales the lens to its focal length); undo, Esc
//
// The lens is a copy (ui/lens-edit-commands.ts): every edit is one undo entry of the store, a drag of a field one
// gesture. After each edit the engine is asked about the copy on the camera as it is (services.lens, the page's
// rt.wasm or the launcher's /api/lens/info), and the numbers and the section are the engine's (rule 10). A lens with
// something wrong says what and where, is never sent to the engine when it is wrong before it (a negative gap) and
// cannot be applied; it can always be edited.

import type { CameraId, CameraState } from '../../core/camera';
import {
  defaultSinglet,
  deleteElement,
  derivedSemis,
  elementSemis,
  engineProblems,
  gapSurfaceOf,
  groupOf,
  glassFamily,
  glassKey,
  imageCircle,
  insertionAperture,
  LENS_GLASSES,
  lensElements,
  lensRows,
  refusalProblem,
  renameEdited,
  rotateElement,
  scaleElement,
  setElement,
  setGapAfter,
  structuralProblems,
  type EditedLens,
  type LensProblem,
  type LensRow,
} from '../../core/lens-edit';
import { opticsOf } from '../../core/optics';
import { startEdit, type EngineLensInfo, type TracedLens } from '../../core/traced-lens';
import { lensPrescription } from '../../data/lenses';
import { numberField, textField, type NumberControl } from '../components/controls';
import { lensSectionSvg, profileChartSvg } from '../components/lens-section';
import { namePrompt } from '../components/library';
import { pickMenu } from '../components/pick-menu';
import { h, icon, isTyping, placeAt } from '../dom';
import { sensorHalf } from '../lens-peek';
import { addElement, applyLensDraft, closeLensEditor, copyName, discardLensDraft, editLens, editorLens, insertPlace, saveEditedToLibrary } from '../lens-edit-commands';
import type { LensCheck } from '../ports';
import type { Ctx, Scope } from '../reactive';
import { kbdText } from '../shortcuts';
import { dyn } from '../names';
import { formatNumber, t, type StringKey } from '../strings';

/** The section's drawing, px. */
const SECTION = { width: 560, height: 190 } as const;
/** How long the editor waits after an edit before it asks the engine, ms (a drag asks once it pauses). */
const ASK_DELAY_MS = 40;

const n = (v: number, digits = 1) => formatNumber(v, undefined, digits);

/** What the engine said of the editor's lens, and for which lens. */
interface Verdict {
  /** The lens asked about (JSON): a verdict for another lens says nothing of this one. */
  key: string;
  state: 'wait' | 'ready' | 'refused' | 'none' | 'invalid';
  info?: EngineLensInfo;
  problems: LensProblem[];
}

/** A row's name in a problem or a selection: "Element 3", "The iris". */
export function rowName(rows: readonly LensRow[], row: number | undefined): string {
  const r = row === undefined ? undefined : rows[row];
  if (!r) return t('lensEditor.rowElement', { n: '?' });
  if (r.kind === 'element') return t('lensEditor.rowElement', { n: r.number });
  if (r.kind === 'stop') return t('lensEditor.rowStop');
  return t('lensEditor.rowPlane', { n: (row ?? 0) + 1 });
}

/** One problem as the editor says it. */
export function problemText(rows: readonly LensRow[], p: LensProblem): string {
  return t(dyn(`lensEditor.problem.${p.code}`), { row: rowName(rows, p.row), detail: p.detail ?? '' });
}

/** A radius as the list shows it: ∞ for a plane. */
const radiusText = (v: number) => (v === 0 ? '∞' : formatNumber(v, undefined, 2));
/** A radius as typed: 0, ∞, "inf" or "plane" is a plane. */
function parseRadius(text: string): number | null {
  const s = text.trim().toLowerCase();
  if (s === '∞' || s === 'inf' || s === 'infinity' || s === 'plane' || s === 'plano' || s === '-∞' || s === '+∞') return 0;
  const v = Number(s.replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

/** The label of a glass of the list. */
export function glassLabel(g: { nd: number; vd: number }): string {
  return t('lensEditor.glassLabel', { nd: formatNumber(g.nd, undefined, 4), vd: formatNumber(g.vd, undefined, 1), family: t(`lensEditor.glassFamily.${glassFamily(g)}` as StringKey) });
}

export function lensEditor(ctx: Ctx, scope: Scope): HTMLElement {
  const { store, ui, services } = ctx;
  const camId: CameraId = ui.get().lensEditor!.camera;
  const cam = (): CameraState | undefined => store.get().camera.cameras[camId];
  /** The lens in the editor: the copy, or the camera's lens before the first edit. */
  const lens = (): TracedLens | null => editorLens(cam());
  /** Its elements: the copy's, or those of a copy of the camera's lens (nothing stored until the first edit). */
  const edited = (): EditedLens | null => {
    const tr = lens();
    return tr ? (startEdit(tr, copyName(tr))?.edited ?? null) : null;
  };
  let selected = 0;
  let verdict: Verdict = { key: '', state: 'wait', problems: [] };

  // ------------------------------------------------------------------ title bar
  const name = textField('', (v) => editLens(ctx, camId, (e) => renameEdited(e, v), 'lensEditor.op.rename'), t('lensEditor.name'));
  name.el.classList.add('le-name');
  name.el.setAttribute('data-le-name', '');
  const promptHost = h('div', { class: 'le-prompt' });
  const discardBtn = h('button', { type: 'button', class: 'btn', 'data-le-discard': '', 'data-tip': t('lensEditor.discardAux'), onclick: () => discardLensDraft(ctx, camId) }, t('lensEditor.discard')) as HTMLButtonElement;
  const saveBtn = h('button', { type: 'button', class: 'btn', 'data-le-save': '', 'data-tip': t('lensEditor.saveAux') }, t('lensEditor.save')) as HTMLButtonElement;
  const applyBtn = h('button', { type: 'button', class: 'btn btn-primary', 'data-le-apply': '', 'data-tip': t('lensEditor.applyAux') }, t('lensEditor.apply')) as HTMLButtonElement;
  /** The lens the engine checked and found valid, when it is the one in the editor. */
  const checked = (): TracedLens | null => {
    const tr = lens();
    const e = edited();
    if (!tr || !e || verdict.state !== 'ready' || verdict.problems.length > 0) return null;
    const full = tr.edited ? tr : { ...tr, edited: e };
    return verdict.key === JSON.stringify(full) ? full : null;
  };
  applyBtn.addEventListener('click', () => {
    const ok = checked();
    if (ok) applyLensDraft(ctx, camId, ok);
  });
  saveBtn.addEventListener('click', () => {
    const ok = checked();
    if (!ok) return;
    namePrompt(promptHost, { label: t('camera.lensSaveName'), initial: ok.edited?.name ?? '', onSave: (v) => saveEditedToLibrary(ctx, camId, ok, v) });
  });
  const closeBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('common.close'), 'data-tip': t('lensEditor.close'), 'data-kbd': t('key.escape'), onclick: () => closeLensEditor(ctx) }, icon('close'));
  const titleBar = h('div', { class: 'le-titlebar' }, h('span', { class: 'le-title-text' }, t('lensEditor.title')), name.el, h('span', { style: 'flex:1' }), discardBtn, saveBtn, applyBtn, closeBtn);

  // ------------------------------------------------------------------ the section
  const sectionHost = h('div', { class: 'le-section', 'data-le-section': '', role: 'img', 'aria-label': t('lensEditor.section') });
  sectionHost.addEventListener('click', (e) => {
    const s = (e.target as Element).closest('[data-surface]')?.getAttribute('data-surface');
    const e2 = edited();
    if (s === null || s === undefined || !e2) return;
    const i = lensRows(e2.surfaces).findIndex((r) => r.kind === 'element' && Number(s) >= r.front && Number(s) < r.back);
    if (i >= 0) select(i);
  });
  const drawSection = () => {
    const e = edited();
    const c = cam();
    const info = verdict.info;
    if (!e || !c || !info?.section) {
      if (verdict.state === 'none') sectionHost.replaceChildren(h('div', { class: 'note' }, t('camera.lensInfoNone')));
      sectionHost.toggleAttribute('data-stale', true);
      return;
    }
    const rows = lensRows(e.surfaces);
    const sel = rows[selected];
    const labels = lensElements(e.surfaces).map((r) => ({ front: r.front, back: r.back, text: String(r.number) }));
    sectionHost.innerHTML = lensSectionSvg(info.section, {
      ...SECTION,
      sensorHalfMm: sensorHalf(c),
      title: e.name,
      labels,
      highlight: sel?.kind === 'element' ? [[sel.front, sel.back]] : [],
    });
    sectionHost.toggleAttribute('data-stale', !fresh());
  };

  // ------------------------------------------------------------------ the tools of the chosen element
  const selectedLabel = h('span', { class: 'le-selected aux', 'data-le-selected': '' });
  const tool = (key: StringKey, aux: StringKey, attr: string, run: () => void, iconName?: Parameters<typeof icon>[0]) =>
    h('button', { type: 'button', class: 'btn', [attr]: '', 'data-tip': t(aux), onclick: run }, ...(iconName ? [icon(iconName, 14)] : []), t(key)) as HTMLButtonElement;
  const focalForNew = () => {
    const d = verdict.info?.designEflMm;
    if (d !== undefined && Number.isFinite(d) && d > 0) return d;
    const p = lensPrescription(lens()?.key ?? '');
    return p?.reported.eflMm ?? p?.referenceFocalMm ?? 100;
  };
  const add = (where: 'before' | 'after') => {
    const f = focalForNew();
    const before = edited();
    if (!before) return;
    // Where the new element's front surface will be: after the group (or the iris) it goes behind, or first.
    const at = insertPlace(before, selected, where);
    const rows0 = lensRows(before.surfaces);
    const behind = 'front' in at ? null : rows0[at.after];
    const front = behind === null || behind === undefined ? 0 : (behind.kind === 'element' ? groupOf(before.surfaces, behind.front)[1] : behind.surface) + 1;
    // As wide as the narrower of its neighbours (the engine's size for an automatic one).
    const semiAperture = insertionAperture(before, at, derivedSemis(before, fresh() ? verdict.info : undefined));
    if (addElement(ctx, camId, selected, where, { ...defaultSinglet(f), semiAperture }, f)) {
      // The new element is the one chosen now.
      const e = edited();
      const k = e ? lensRows(e.surfaces).findIndex((r) => r.kind === 'element' && r.front === front) : -1;
      if (k >= 0) select(k);
    }
  };
  const addBeforeBtn = tool('lensEditor.addBefore', 'lensEditor.addAux', 'data-le-add-before', () => add('before'), 'plus');
  const addAfterBtn = tool('lensEditor.addAfter', 'lensEditor.addAux', 'data-le-add-after', () => add('after'), 'plus');
  const onElement = (fn: (e: EditedLens, row: Extract<LensRow, { kind: 'element' }>) => EditedLens, what: StringKey) => () => {
    const e = edited();
    const r = e ? lensRows(e.surfaces)[selected] : undefined;
    if (!e || r?.kind !== 'element') return;
    editLens(ctx, camId, (x) => fn(x, r), what);
  };
  const rotateBtn = tool('lensEditor.rotate', 'lensEditor.rotateAux', 'data-le-rotate', onElement((e, r) => rotateElement(e, r.front), 'lensEditor.op.rotate'), 'refresh');
  const deleteBtn = tool(
    'lensEditor.delete',
    'lensEditor.deleteAux',
    'data-le-delete',
    () => {
      onElement((e, r) => deleteElement(e, r.front), 'lensEditor.op.delete')();
      const e = edited();
      if (e) selected = Math.min(selected, lensRows(e.surfaces).length - 1);
      refresh();
    },
    'trash',
  );
  const sizeBy = (k: number) => onElement((e, r) => scaleElement(e, r.front, k, derivedSemis(e, verdict.info)), 'lensEditor.op.size');
  const smallerBtn = tool('lensEditor.smaller', 'lensEditor.sizeAux', 'data-le-smaller', sizeBy(1 / 1.1), 'minus');
  const largerBtn = tool('lensEditor.larger', 'lensEditor.sizeAux', 'data-le-larger', sizeBy(1.1), 'plus');
  const autoBtn = tool('lensEditor.autoAperture', 'lensEditor.autoApertureAux', 'data-le-auto', onElement((e, r) => setElement(e, r.front, { diameter: null }), 'lensEditor.op.autoAperture'));
  const tools = h('div', { class: 'le-tools', role: 'toolbar', 'aria-label': t('lensEditor.list') }, selectedLabel, addBeforeBtn, addAfterBtn, rotateBtn, deleteBtn, smallerBtn, largerBtn, autoBtn);

  // ------------------------------------------------------------------ the list
  const body = h('tbody');
  const table = h(
    'table',
    { class: 'le-table', 'data-le-list': '', 'aria-label': t('lensEditor.list') },
    h(
      'thead',
      null,
      h(
        'tr',
        null,
        ...(['element', 'front', 'back', 'thickness', 'glass', 'diameter', 'air'] as const).map((c) => h('th', { scope: 'col', ...(c === 'front' || c === 'back' ? { 'data-tip': t('lensEditor.radiusAux') } : {}) }, t(`lensEditor.col.${c}` as StringKey))),
      ),
    ),
    body,
  );
  let structure = '';
  let updaters: ((e: EditedLens, derived: (number | null)[]) => void)[] = [];
  const select = (i: number) => {
    selected = i;
    refresh();
  };
  /** One number of the list: a field whose edits are one undo entry per gesture. */
  const num = (o: { value: number; step: number; digits: number; aria: string; format?: (v: number) => string; parse?: (s: string) => number | null; min?: number; edit: (e: EditedLens, v: number) => EditedLens; what: StringKey }): NumberControl =>
    numberField({
      value: o.value,
      step: o.step,
      digits: o.digits,
      min: o.min,
      compact: true,
      ariaLabel: o.aria,
      format: o.format,
      parse: o.parse,
      onChange: (v, g) => editLens(ctx, camId, (e) => o.edit(e, v), o.what, g),
    });
  const buildList = (e: EditedLens, derived: (number | null)[]) => {
    const rows = lensRows(e.surfaces);
    updaters = [];
    const trs = rows.map((r, i) => {
      const tr = h('tr', { 'data-le-row': String(i), 'data-kind': r.kind });
      tr.addEventListener('pointerdown', () => {
        if (selected !== i) select(i);
      });
      tr.addEventListener('focusin', () => {
        if (selected !== i) select(i);
      });
      const label = r.kind === 'element' ? String(r.number) : r.kind === 'stop' ? t('lensEditor.iris') : t('lensEditor.plane');
      const head = h('th', { scope: 'row' }, h('button', { type: 'button', class: 'le-row-btn', 'aria-label': rowName(rows, i), onclick: () => select(i) }, label));
      const cells: HTMLElement[] = [head];
      const dash = () => h('td', { class: 'aux' }, '—');
      if (r.kind === 'element') {
        const f = r.front;
        const front = num({ value: e.surfaces[f].r ?? 0, step: 1, digits: 2, aria: `${rowName(rows, i)}: ${t('lensEditor.col.front')}`, format: radiusText, parse: parseRadius, edit: (x, v) => setElement(x, f, { front: v }), what: 'lensEditor.op.front' });
        const back = num({ value: e.surfaces[f + 1].r ?? 0, step: 1, digits: 2, aria: `${rowName(rows, i)}: ${t('lensEditor.col.back')}`, format: radiusText, parse: parseRadius, edit: (x, v) => setElement(x, f, { back: v }), what: 'lensEditor.op.back' });
        const thick = num({ value: e.surfaces[f].d ?? 0, step: 0.1, digits: 2, aria: `${rowName(rows, i)}: ${t('lensEditor.col.thickness')}`, edit: (x, v) => setElement(x, f, { thickness: v }), what: 'lensEditor.op.thickness' });
        const glass = pickMenu(
          LENS_GLASSES.map((g) => ({ value: glassKey(g), label: glassLabel(g) })),
          e.surfaces[f].glass ? glassKey(e.surfaces[f].glass!) : '',
          (v) => {
            const g = LENS_GLASSES.find((x) => glassKey(x) === v);
            if (g) editLens(ctx, camId, (x) => setElement(x, f, { glass: g }), 'lensEditor.op.glass');
          },
          `${rowName(rows, i)}: ${t('lensEditor.col.glass')}`,
          e.surfaces[f].glass ? glassLabel(e.surfaces[f].glass!) : '',
        );
        glass.el.setAttribute('data-tip', t('lensEditor.glassAux'));
        const diam = (x: EditedLens, d: (number | null)[]) => {
          const [a, b] = elementSemis(x.surfaces, f, d);
          const m = Math.max(a ?? 0, b ?? 0);
          return 2 * m;
        };
        const isAuto = (x: EditedLens) => x.surfaces[f].semiAperture === null && x.surfaces[f + 1].semiAperture === null;
        const diameter = num({
          value: diam(e, derived),
          step: 0.5,
          digits: 1,
          min: 0,
          aria: `${rowName(rows, i)}: ${t('lensEditor.col.diameter')}`,
          format: (v) => (v > 0 ? formatNumber(v, undefined, 1) : t('lensEditor.auto')),
          edit: (x, v) => (v > 0 ? setElement(x, f, { diameter: v }, derivedSemis(x, verdict.info)) : x),
          what: 'lensEditor.op.diameter',
        });
        const autoMark = h('span', { class: 'le-auto aux', 'data-tip': t('lensEditor.autoAux') }, t('lensEditor.auto'));
        const gapS = gapSurfaceOf(e.surfaces, r);
        let gapCell: HTMLElement;
        let gap: NumberControl | null = null;
        if (gapS !== null) {
          gap = num({ value: e.surfaces[gapS].d ?? 0, step: 0.1, digits: 2, aria: `${rowName(rows, i)}: ${t('lensEditor.col.air')}`, edit: (x, v) => setGapAfter(x, gapS, v), what: 'lensEditor.op.gap' });
          gapCell = h('td', null, gap.el);
        } else gapCell = r.cementedAfter ? h('td', { class: 'aux', 'data-tip': t('lensEditor.cementedAux') }, t('lensEditor.cemented')) : dash();
        cells.push(h('td', null, front.el), h('td', null, back.el), h('td', null, thick.el), h('td', { class: 'le-glass' }, glass.el), h('td', { class: 'le-diam' }, diameter.el, autoMark), gapCell);
        updaters.push((x, d) => {
          front.set(x.surfaces[f].r ?? 0);
          back.set(x.surfaces[f + 1].r ?? 0);
          thick.set(x.surfaces[f].d ?? 0);
          glass.set(x.surfaces[f].glass ? glassKey(x.surfaces[f].glass!) : '');
          diameter.set(diam(x, d));
          autoMark.style.visibility = isAuto(x) ? '' : 'hidden';
          if (gap && gapS !== null) gap.set(x.surfaces[gapS].d ?? 0);
        });
      } else {
        const gapS = gapSurfaceOf(e.surfaces, r);
        let gapCell: HTMLElement = dash();
        let gap: NumberControl | null = null;
        if (gapS !== null) {
          gap = num({ value: e.surfaces[gapS].d ?? 0, step: 0.1, digits: 2, aria: `${rowName(rows, i)}: ${t('lensEditor.col.air')}`, edit: (x, v) => setGapAfter(x, gapS, v), what: 'lensEditor.op.gap' });
          gapCell = h('td', null, gap.el);
        }
        cells.push(dash(), dash(), dash(), dash(), dash(), gapCell);
        updaters.push((x) => {
          if (gap && gapS !== null) gap.set(x.surfaces[gapS].d ?? 0);
        });
      }
      tr.append(...cells);
      return tr;
    });
    body.replaceChildren(...trs);
  };

  // ------------------------------------------------------------------ the side: can it be applied, the numbers
  const status = h('div', { class: 'le-status', role: 'status', 'aria-live': 'polite', 'data-le-status': '' });
  const numbers = h('div', { class: 'stack le-numbers', 'data-le-info': '' });
  const focusNote = h('div', { class: 'note', 'data-le-focus-note': '' }, t('lensEditor.focusUnit'));
  const drawStatus = () => {
    const tr = lens();
    const e = edited();
    const rows = e ? lensRows(e.surfaces) : [];
    const draft = !!cam()?.lensDraft;
    status.dataset.state = verdict.state;
    if (verdict.problems.length > 0) {
      status.replaceChildren(h('p', { class: 'le-status-head' }, t('lensEditor.state.invalid')), h('ul', { class: 'le-problems' }, ...verdict.problems.map((p) => h('li', { 'data-problem': p.code }, problemText(rows, p)))));
    } else if (verdict.state === 'wait') status.replaceChildren(h('p', { class: 'aux' }, t('lensEditor.state.wait')));
    else if (verdict.state === 'none') status.replaceChildren(h('p', { class: 'note' }, t('lensEditor.state.noEngine')));
    else status.replaceChildren(h('p', { class: 'le-status-head' }, t(draft ? 'lensEditor.state.ready' : 'lensEditor.state.camera')));
    const ok = !!checked();
    applyBtn.disabled = !draft || !ok;
    // A lens of one's own (the copy, or an edited lens on the camera): the catalogue's is saved from Camera ▸ Lens.
    saveBtn.disabled = !ok || !(draft || tr?.edited);
    discardBtn.disabled = !draft;
    const p = tr ? lensPrescription(tr.key) : undefined;
    focusNote.style.display = e && p && p.focus.mode !== 'unit' && e.focus.mode === 'unit' ? '' : 'none';
  };
  const drawNumbers = () => {
    const i = verdict.info;
    const c = cam();
    if (!i || !c) {
      numbers.replaceChildren();
      return;
    }
    const row = (label: StringKey, value: string, key: string, aux?: StringKey) => {
      const r = h('div', { class: 'kv-row' }, h('span', { class: 'aux' }, t(label)), h('span', { 'data-value': key }, value));
      if (aux) r.setAttribute('data-tip', t(aux));
      return r;
    };
    const rows = [
      row('lensEditor.designFocal', t('lensEditor.designFocalValue', { f: n(i.designEflMm, 2), cam: n(i.eflMm, 1) }), 'designFocal', 'lensEditor.designFocalAux'),
      row('camera.lensInfoBack', `${n(i.bflMm, 2)} mm`, 'back'),
      row('camera.lensInfoStop', t('camera.lensInfoStopValue', { f: n(i.fNumber, 2), t: n(i.tStop, 2) }), 'stop', 'camera.lensInfoStopAux'),
      row('camera.lensInfoElements', `${i.elements} · ${i.groups}`, 'elements'),
      row('camera.lensInfoLength', `${n(i.lengthMm, 1)} mm`, 'length'),
    ];
    const circle = imageCircle(i);
    if (circle) rows.push(row('lensEditor.circle', t(circle.covers ? 'lensEditor.circleCovers' : 'lensEditor.circleShort', { d: n(circle.diameterMm, 1) }), 'circle'));
    const charts: HTMLElement[] = [];
    const d = i.distortion;
    if (d.length > 0) {
      const dMax = Math.max(1, ...d.map((p) => Math.abs(p[1])));
      const chart = h('div', { 'data-le-chart': 'distortion' });
      chart.innerHTML = profileChartSvg(d, { width: 130, height: 44, min: -dMax, max: dMax, zero: 0, title: t('camera.lensInfoDistortion') });
      charts.push(h('div', { class: 'stack', style: 'gap:2px' }, h('span', { class: 'aux' }, t('camera.lensInfoDistortion')), chart, h('span', { class: 'aux', 'data-value': 'distortion' }, t('camera.lensInfoDistortionValue', { v: n(d[d.length - 1][1], 2) }))));
    }
    const ri = i.relativeIllumination;
    if (ri.length > 0) {
      const last = ri[ri.length - 1][1];
      const chart = h('div', { 'data-le-chart': 'falloff' });
      chart.innerHTML = profileChartSvg(ri, { width: 130, height: 44, min: 0, max: 1, zero: 1, title: t('camera.lensInfoFalloff') });
      charts.push(h('div', { class: 'stack', style: 'gap:2px' }, h('span', { class: 'aux' }, t('camera.lensInfoFalloff')), chart, h('span', { class: 'aux', 'data-value': 'falloff' }, t('camera.lensInfoFalloffValue', { v: n(100 * last, 0), ev: last > 0 ? n(Math.log2(last), 1) : '−∞' }))));
    }
    numbers.replaceChildren(...rows, h('div', { class: 'le-charts' }, ...charts), h('div', { class: 'aux' }, t('camera.lensInfoNote')));
    numbers.toggleAttribute('data-stale', !fresh());
  };

  // ------------------------------------------------------------------ asking the engine
  /** The lens whose verdict the editor wants: the copy with its elements (the camera's lens before the first edit). */
  const currentKeyLens = (): TracedLens | null => {
    const tr = lens();
    const e = edited();
    return tr && e ? (tr.edited ? tr : { ...tr, edited: e }) : null;
  };
  /** True when the engine's numbers shown are this lens's (not the last good lens's before an invalid edit). */
  const fresh = () => verdict.state === 'ready' && verdict.key === JSON.stringify(currentKeyLens());
  let timer = 0;
  let seq = 0;
  const ask = () => {
    window.clearTimeout(timer);
    const c = cam();
    const full = currentKeyLens();
    if (!c || !full?.edited) return;
    const key = JSON.stringify(full);
    if (verdict.key === key && verdict.state !== 'wait') return;
    const structural = structuralProblems(full.edited);
    if (structural.length > 0) {
      // Wrong before the engine: it is not asked (the last section stays, marked as not this lens's).
      verdict = { key, state: 'invalid', info: verdict.info, problems: structural };
      drawAll();
      return;
    }
    verdict = { ...verdict, state: verdict.key === key ? verdict.state : 'wait', problems: [] };
    drawStatus();
    const mine = ++seq;
    timer = window.setTimeout(() => {
      const port = services.lens;
      const asked: CameraState = { ...c, optics: { ...opticsOf(c), traced: full } };
      const answer: Promise<LensCheck> = !port
        ? Promise.resolve({ state: 'none' })
        : port.check
          ? port.check(asked)
          : port.info(asked).then((i): LensCheck => (i ? { state: 'ready', info: i } : i === undefined ? { state: 'refused', reason: '' } : { state: 'none' }));
      void answer
        .catch((): LensCheck => ({ state: 'none' }))
        .then((a) => {
          if (mine !== seq) return;
          if (a.state === 'ready') verdict = { key, state: 'ready', info: a.info, problems: engineProblems(a.info) };
          else if (a.state === 'refused') verdict = { key, state: 'refused', info: verdict.info, problems: [refusalProblem(a.reason)] };
          else verdict = { key, state: 'none', problems: [] };
          drawAll();
          win.dataset.checks = String(mine);
        });
    }, ASK_DELAY_MS);
  };
  scope.onDispose(() => window.clearTimeout(timer));

  const drawAll = () => {
    drawStatus();
    drawSection();
    drawNumbers();
    const e = edited();
    if (e) updaters.forEach((u) => u(e, derivedSemis(e, verdict.key === JSON.stringify(currentKeyLens()) ? verdict.info : undefined)));
  };

  /** Everything again from the lens in the store (an edit, an undo, the camera's focal length…). */
  const refresh = () => {
    const e = edited();
    if (!e) return;
    const rows = lensRows(e.surfaces);
    selected = Math.max(0, Math.min(selected, rows.length - 1));
    const shape = rows.map((r) => (r.kind === 'element' ? `e${r.front}${r.cementedAfter ? 'c' : ''}` : `${r.kind}${r.surface}`)).join(',');
    if (shape !== structure) {
      structure = shape;
      buildList(e, derivedSemis(e, verdict.info));
    }
    for (const tr of body.children) tr.classList.toggle('is-selected', Number((tr as HTMLElement).dataset.leRow) === selected);
    const sel = rows[selected];
    selectedLabel.textContent = sel ? (sel.kind === 'element' ? t('lensEditor.selected', { n: sel.number }) : sel.kind === 'stop' ? t('lensEditor.selectedStop') : rowName(rows, selected)) : t('lensEditor.selectHint');
    const isElement = sel?.kind === 'element';
    for (const b of [rotateBtn, smallerBtn, largerBtn, autoBtn]) b.disabled = !isElement;
    deleteBtn.disabled = !isElement || lensElements(e.surfaces).length <= 1;
    name.set(e.name);
    drawAll();
    ask();
  };
  scope.watch(
    (s) => s.camera.cameras[camId],
    (c) => {
      if (!c) return closeLensEditor(ctx);
      refresh();
    },
  );

  // ------------------------------------------------------------------ the window
  const main = h('div', { class: 'le-main' }, sectionHost, tools, h('div', { class: 'le-list' }, table));
  const side = h('div', { class: 'le-side' }, status, promptHost, focusNote, h('div', { class: 'field-label' }, t('camera.lensInfo')), numbers);
  const foot = h('div', { class: 'le-foot' }, h('span', { class: 'le-foot-text' }, t('lensEditor.scaleNote')), h('span', { style: 'flex:1' }), h('span', { class: 'le-foot-text' }, t('lensEditor.keys', { undo: kbdText('mod+z') })));
  const win = h('div', { class: 'le', role: 'dialog', 'aria-label': t('lensEditor.title'), tabindex: '-1', 'data-lens-editor': camId }, titleBar, h('div', { class: 'le-body' }, main, side), foot);
  const host = h('div', { class: 'le-mount-inner' }, win);

  // Placed in the middle once it has its size; moved by its title bar.
  win.style.visibility = 'hidden';
  requestAnimationFrame(() => {
    const r = win.getBoundingClientRect();
    placeAt(win, Math.max(8, (window.innerWidth - r.width) / 2), Math.max(8, (window.innerHeight - r.height) / 2));
    win.style.visibility = '';
    win.focus({ preventScroll: true });
  });
  titleBar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button, input, select, .seg')) return;
    e.preventDefault();
    const start = win.getBoundingClientRect();
    const sx = e.clientX;
    const sy = e.clientY;
    try {
      titleBar.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events.
    }
    const onMove = (ev: PointerEvent) => placeAt(win, Math.max(8 - start.width + 160, Math.min(window.innerWidth - 160, start.left + ev.clientX - sx)), Math.max(8, Math.min(window.innerHeight - 48, start.top + ev.clientY - sy)));
    const up = () => {
      titleBar.removeEventListener('pointermove', onMove);
      titleBar.removeEventListener('pointerup', up);
      titleBar.removeEventListener('pointercancel', up);
    };
    titleBar.addEventListener('pointermove', onMove);
    titleBar.addEventListener('pointerup', up);
    titleBar.addEventListener('pointercancel', up);
  });
  const onKey = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || e.isComposing || document.querySelector('.floating')) return;
    if (e.key === 'Escape' && !isTyping(e) && (win.contains(e.target as Node) || e.target === document.body)) {
      e.preventDefault();
      e.stopPropagation();
      closeLensEditor(ctx);
    }
  };
  document.addEventListener('keydown', onKey, true);
  scope.onDispose(() => document.removeEventListener('keydown', onKey, true));
  // The plain keys are the editor's while it has the focus (Delete in a field never deletes a part): none reaches the
  // application's tools; Ctrl/⌘ Z and the other shortcuts with a modifier do.
  win.addEventListener('keydown', (e) => {
    if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key !== 'Tab') e.stopPropagation();
  });
  return host;
}
