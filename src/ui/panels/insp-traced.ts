// The camera's Lens in the inspector (phase O2, UI.md §2.4 Camera ▸ Lens, STUDIO-TOOLS §1 "Editor de lentes"): the
// thin lens or a traced lens of src/data/lenses.json, chosen by character; for a traced lens its source, the lens
// behind an adapter, the coating, the variable gap of the soft-focus lens and the iris; what the engine computes of
// it (rule 10: the focal length, the back focus, the f-number in use and the T-stop, elements and groups, the length,
// the entrance pupil, an anamorphic lens's squeeze, the distortion and the falloff, and its cross-section drawn from
// the lens as the engine prepared it); the artistic adjustments marked not physical; and *Save lens as…* to the
// library (U4). Everything goes through the store (camera/set with the camera's `optics`), one undo entry per change
// or drag. The numbers come from services.lens (the page's rt.wasm or the launcher's /api/lens/info).

import type { CameraId, CameraState } from '../../core/camera';
import { itemsOf, type LensItem } from '../../core/library';
import { OPTICS_LIMITS, OPTICS_NEUTRAL, opticsOf, tracedOf, type CameraOptics } from '../../core/optics';
import { DEFAULT_MASTER, isAdapter, masterLenses, newTracedLens, TRACED_LIMITS, type EngineLensInfo, type TracedLens } from '../../core/traced-lens';
import { COATINGS, LENS_CHARACTERS, LENS_PRESCRIPTIONS, lensPrescription, type LensCharacter, type LensPrescription } from '../../data/lenses';
import { createLensPeek } from '../components/lens-peek';
import { lensSectionSvg, profileChartSvg } from '../components/lens-section';
import { pickMenu } from '../components/pick-menu';
import * as cmd from '../commands';
import { field, numberField, segmented, select, slider, type Control } from '../components/controls';
import { mineEmpty, mineRows, namePrompt } from '../components/library';
import { h } from '../dom';
import { lensSourceLine, sensorHalf } from '../lens-peek';
import { type Ctx, type Scope } from '../reactive';
import { formatNumber, lbl, t, type StringKey } from '../strings';

/** The heading of the artistic knobs, marked as not physical (STUDIO-TOOLS §0). */
function artisticHead(): HTMLElement {
  return h('div', { class: 'aux', 'data-artistic': '', 'data-tip': t('camera.notPhysicalAux'), style: 'padding-top:4px' }, t('camera.notPhysical'));
}

const tip = (el: HTMLElement, key: StringKey) => {
  el.setAttribute('data-tip', t(key));
  return el;
};

/** A number the engine computed, in the interface's language. */
const n = (v: number, digits = 1) => formatNumber(v, undefined, digits);

/** The Lens subsection of camera `camId()`. */
export function tracedLensFields(ctx: Ctx, scope: Scope, camId: () => CameraId): HTMLElement {
  const { store } = ctx;
  const cam = (): CameraState | undefined => store.get().camera.cameras[camId()];
  // The window of a lens's elements, from the entries of the list and the character chips (ui/lens-peek.ts).
  const peek = createLensPeek(ctx, cam);
  scope.onDispose(() => peek.dispose());
  const optics = (): CameraOptics => {
    const c = cam();
    return c ? opticsOf(c) : OPTICS_NEUTRAL;
  };
  const dispatch = (next: CameraOptics, what: StringKey, gesture?: string) =>
    store.dispatch({ type: 'camera/set', id: camId(), patch: { optics: next }, gesture, label: cmd.editLabel('camera', what) });
  /** A change to the traced lens; the bokeh type chosen stays only when the lens does. */
  const setTraced = (patch: Partial<TracedLens>, what: StringKey, gesture?: string) => {
    const o = optics();
    const cur = tracedOf(o);
    if (!cur) return;
    const next = { ...cur, ...patch };
    const sameLens = next.key === cur.key;
    dispatch({ ...o, traced: next, ...(sameLens ? {} : { bokeh: null, variant: null }) }, what, gesture);
  };
  const setOptics = (patch: Partial<CameraOptics>, what: StringKey, gesture?: string) => dispatch({ ...optics(), ...patch, bokeh: null, variant: null }, what, gesture);
  /** Puts lens `key` on the camera (its own settings; the iris and the knobs of the optics stay). */
  const chooseLens = (key: string) => {
    const o = optics();
    if (tracedOf(o)?.key === key) return;
    dispatch({ ...o, traced: newTracedLens(key), bokeh: null, variant: null }, 'camera.lensChoice');
  };

  // --- thin or traced ---------------------------------------------------------------------------------------------
  const model = segmented(
    [
      { value: 'thin' as const, label: t('camera.lensThin') },
      { value: 'traced' as const, label: t('camera.lensTraced') },
    ],
    tracedOf(optics()) ? 'traced' : 'thin',
    (v) => {
      const o = optics();
      if (v === 'thin' && tracedOf(o)) dispatch({ ...o, traced: null, bokeh: null, variant: null }, 'camera.lensModel');
      if (v === 'traced' && !tracedOf(o)) dispatch({ ...o, traced: newTracedLens(DEFAULT_MASTER), bokeh: null, variant: null }, 'camera.lensModel');
    },
    { full: true, ariaLabel: t('camera.lensModel') },
  );
  const thinNote = h('div', { class: 'note' }, t('camera.lensThinAux'));

  // --- the lens: character, family, my lenses ----------------------------------------------------------------------
  let filter: LensCharacter | 'MINE' = lensPrescription(tracedOf(optics())?.key ?? DEFAULT_MASTER)?.character ?? 'clinical';
  const chips = h('div', { class: 'chips', role: 'tablist', 'aria-label': t('camera.lensCharacter'), 'data-lens-characters': '' });
  const listHost = h('div', { class: 'stack', 'data-lens-list': '' });
  const confirm = h('div');
  const drawChips = () => {
    peek.dismiss();
    chips.replaceChildren(
      ...LENS_CHARACTERS.map((c) => {
        const chip = h('button', { type: 'button', class: 'chip', role: 'tab', 'data-character': c.key, 'aria-pressed': String(filter === c.key), onclick: () => ((filter = c.key), drawChips(), drawList()) }, lbl(c.label));
        // Resting on a character shows the lenses of it.
        peek.attach(
          chip,
          () => ({ keys: LENS_PRESCRIPTIONS.filter((p) => p.character === c.key).map((p) => p.key), heading: lbl(c.label) }),
          () => tracedBox,
        );
        return chip;
      }),
      h('button', { type: 'button', class: 'chip', role: 'tab', 'data-character': 'MINE', 'aria-pressed': String(filter === 'MINE'), onclick: () => ((filter = 'MINE'), drawChips(), drawList()) }, t('catalog.mine')),
    );
  };
  const drawList = () => {
    const cur = tracedOf(optics());
    if (filter === 'MINE') {
      const items = itemsOf(ctx.ui.get().library, 'lens');
      const same = (i: LensItem) => !!cur && JSON.stringify(i.lens.traced) === JSON.stringify(cur);
      listHost.replaceChildren(
        ...(items.length === 0
          ? [mineEmpty(t('camera.lensMineEmpty'))]
          : mineRows(ctx, items, { active: same, choose: (i) => cmd.applyLibraryLens(ctx, camId(), i), title: (i) => lbl(lensPrescription(i.lens.traced.key)?.name ?? { en: i.name, es: i.name }), aux: (i) => lbl(lensPrescription(i.lens.traced.key)?.name ?? { en: '', es: '' }), icon: 'camera' }, confirm)),
        confirm,
      );
      return;
    }
    const lenses = LENS_PRESCRIPTIONS.filter((p) => p.character === filter);
    const inList = !!cur && lenses.some((p) => p.key === cur.key);
    // The interface's own list, not the browser's: its entries are elements the pointer can rest on, and one that
    // does shows the lens's elements (ui/lens-peek.ts).
    const sel = pickMenu(
      lenses.map((p) => ({ value: p.key, label: lbl(p.name) })),
      inList ? cur!.key : '',
      (v) => v && chooseLens(v),
      t('camera.lensChoice'),
      t('camera.lensPick'),
      {
        entry: (item, o) =>
          peek.attach(
            item,
            () => ({ keys: [o.value] }),
            () => item.closest<HTMLElement>('.floating'),
          ),
        onClose: () => peek.dismiss(),
      },
    );
    sel.el.setAttribute('data-lens-select', '');
    peek.dismiss();
    listHost.replaceChildren(field(t('camera.lensChoice'), sel.el));
  };
  scope.watch((_s, u) => u.library, () => filter === 'MINE' && drawList());

  // --- the lens's own settings (rebuilt when the lens changes) -----------------------------------------------------
  const source = h('div', { class: 'aux', 'data-lens-source': '' });
  const own = h('div', { class: 'stack', 'data-lens-own': '' });
  let ownKey = '';
  let ownUpdates: ((t: TracedLens) => void)[] = [];
  const drawOwn = (tr: TracedLens, p: LensPrescription) => {
    ownKey = tr.key;
    ownUpdates = [];
    const rows: HTMLElement[] = [];
    if (isAdapter(p)) {
      const masters = masterLenses();
      const m = select(
        masters.map((x) => ({ value: x.key, label: lbl(x.name) })),
        tr.master ?? DEFAULT_MASTER,
        (v) => setTraced({ master: v === DEFAULT_MASTER ? null : v }, 'camera.lensMaster'),
        t('camera.lensMaster'),
      );
      rows.push(tip(field(t('camera.lensMaster'), m.el), 'camera.lensMasterAux'));
      ownUpdates.push((x) => m.set(x.master ?? DEFAULT_MASTER));
    }
    const coating = select(
      [{ value: '', label: t('camera.lensCoatingOwn') }, ...COATINGS.map((c) => ({ value: c.key, label: lbl(c.label) }))],
      tr.coating ?? '',
      (v) => setTraced({ coating: (v || null) as TracedLens['coating'] }, 'camera.lensCoating'),
      t('camera.lensCoating'),
    );
    rows.push(tip(field(t('camera.lensCoating'), coating.el), 'camera.lensCoatingAux'));
    ownUpdates.push((x) => coating.set(x.coating ?? ''));
    const gap = p.variable?.[0];
    if (gap) {
      const v = slider({ value: tr.variable ?? gap.normal, min: gap.min, max: gap.max, step: 0.01, digits: 2, unit: 'mm', ariaLabel: lbl(gap.label), onChange: (x, g) => setTraced({ variable: x }, 'camera.lensChoice', g) });
      const back = h('button', { type: 'button', class: 'btn', 'data-tip': t('camera.lensVariableNormalAux'), onclick: () => setTraced({ variable: null }, 'camera.lensChoice') }, t('camera.lensVariableNormal')) as HTMLButtonElement;
      back.disabled = tr.variable === null;
      rows.push(field(lbl(gap.label), v.el), h('div', { class: 'row' }, back));
      ownUpdates.push((x) => {
        v.set(x.variable ?? gap.normal);
        back.disabled = x.variable === null;
      });
    }
    own.replaceChildren(...rows);
    source.textContent = lensSourceLine(p);
    const range = p.iris.fNumberMin !== null && p.iris.fNumberMax !== null ? t('camera.lensRange', { min: n(p.iris.fNumberMin, 2), max: n(p.iris.fNumberMax, 1) }) : '';
    rangeNote.textContent = range;
    rangeNote.style.display = range ? '' : 'none';
  };
  const rangeNote = h('div', { class: 'aux', 'data-lens-range': '' });

  // --- the iris (shared with Advanced optics) ----------------------------------------------------------------------
  const o0 = optics();
  const blades = numberField({
    value: o0.blades,
    min: 0,
    max: OPTICS_LIMITS.blades.max,
    step: 1,
    ariaLabel: t('camera.blades'),
    format: (v) => (v < 3 ? t('camera.bladesRound') : String(v)),
    onChange: (v, g) => {
      const prev = optics().blades;
      const nb = v >= 3 ? Math.round(v) : v > prev && prev === 0 ? 3 : 0;
      setOptics({ blades: nb }, 'camera.blades', g);
    },
  });

  // --- what the engine computes ------------------------------------------------------------------------------------
  const info = h('div', { class: 'stack', 'data-lens-info': '' });
  const sectionHost = h('div', { 'data-lens-section-svg': '', 'data-tip': t('camera.lensSectionAux'), style: 'color:var(--text-2, currentColor)' });
  const showInfo = (c: CameraState, i: EngineLensInfo | null | undefined, pending: boolean) => {
    if (pending) {
      info.replaceChildren(h('div', { class: 'aux' }, t('camera.lensInfoWait')));
      return;
    }
    if (i === undefined) {
      info.replaceChildren(h('div', { class: 'note', 'data-lens-info-state': 'refused' }, t('camera.lensInfoRefused')));
      sectionHost.replaceChildren();
      return;
    }
    if (i === null) {
      info.replaceChildren(h('div', { class: 'note', 'data-lens-info-state': 'none' }, t('camera.lensInfoNone')));
      sectionHost.replaceChildren();
      return;
    }
    const row = (label: StringKey, value: string, aux?: StringKey) => {
      const r = h('div', { class: 'kv-row', style: 'display:flex;justify-content:space-between;gap:8px' }, h('span', { class: 'aux' }, t(label)), h('span', { 'data-value': label }, value));
      if (aux) r.setAttribute('data-tip', t(aux));
      return r;
    };
    const rows = [
      row('camera.lensInfoFocal', t('camera.lensInfoFocalValue', { f: n(i.eflMm, 1), focused: n(i.eflFocusedMm, 1) })),
      row('camera.lensInfoBack', `${n(i.bflMm, 1)} mm`),
      row('camera.lensInfoStop', t('camera.lensInfoStopValue', { f: n(i.fNumber, 2), t: n(i.tStop, 2) }), 'camera.lensInfoStopAux'),
      row('camera.lensInfoElements', `${i.elements} · ${i.groups}`),
      row('camera.lensInfoLength', `${n(i.lengthMm, 1)} mm`),
      row('camera.lensInfoPupil', `⌀ ${n(i.entrancePupilMm[1], 1)} mm`),
    ];
    if (Math.abs(i.squeeze - 1) > 1e-3) rows.push(row('camera.lensInfoSqueeze', `${n(i.squeeze, 2)}×`));
    const d = i.distortion;
    const ri = i.relativeIllumination;
    const charts: HTMLElement[] = [];
    if (d.length > 0) {
      const dMax = Math.max(1, ...d.map((p) => Math.abs(p[1])));
      const chart = h('div', { 'data-lens-chart': 'distortion' });
      chart.innerHTML = profileChartSvg(d, { width: 140, height: 44, min: -dMax, max: dMax, zero: 0, title: t('camera.lensInfoDistortion') });
      charts.push(h('div', { class: 'stack', style: 'gap:2px' }, h('span', { class: 'aux' }, t('camera.lensInfoDistortion')), chart, h('span', { class: 'aux', 'data-value': 'distortion' }, t('camera.lensInfoDistortionValue', { v: n(d[d.length - 1][1], 1) }))));
    }
    if (ri.length > 0) {
      const last = ri[ri.length - 1][1];
      const chart = h('div', { 'data-lens-chart': 'falloff' });
      chart.innerHTML = profileChartSvg(ri, { width: 140, height: 44, min: 0, max: 1, zero: 1, title: t('camera.lensInfoFalloff') });
      charts.push(h('div', { class: 'stack', style: 'gap:2px' }, h('span', { class: 'aux' }, t('camera.lensInfoFalloff')), chart, h('span', { class: 'aux', 'data-value': 'falloff' }, t('camera.lensInfoFalloffValue', { v: n(100 * last, 0), ev: last > 0 ? n(Math.log2(last), 1) : '−∞' }))));
    }
    info.replaceChildren(...rows, h('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start;padding-top:4px' }, ...charts), h('div', { class: 'aux' }, t('camera.lensInfoNote')));
    if (i.section) {
      const name = lbl(lensPrescription(tracedOf(opticsOf(c))?.key ?? '')?.name ?? { en: '', es: '' });
      sectionHost.innerHTML = lensSectionSvg(i.section, { width: 280, height: 120, sensorHalfMm: sensorHalf(c), title: name });
    } else sectionHost.replaceChildren();
  };
  let asked = '';
  const ask = (c: CameraState) => {
    const key = JSON.stringify([c.id, c.optics, c.focalMm, c.fstop, c.focusDistance, c.aspect, c.projection]);
    if (key === asked) return;
    asked = key;
    const port = ctx.services.lens;
    if (!port) return showInfo(c, null, false);
    showInfo(c, null, true);
    void port.info(c).then(
      (i) => asked === key && showInfo(c, i, false),
      () => asked === key && showInfo(c, null, false),
    );
  };

  // --- not physical --------------------------------------------------------------------------------------------------
  const tr0 = tracedOf(o0) ?? newTracedLens(DEFAULT_MASTER);
  const L = TRACED_LIMITS;
  const distortion = slider({ value: tr0.distortion, min: L.distortion.min, max: L.distortion.max, step: 0.01, ariaLabel: t('camera.lensDistortion'), onChange: (v, g) => setTraced({ distortion: v }, 'camera.lensDistortion', g) });
  const vignetting = slider({ value: tr0.vignetting, min: L.vignetting.min, max: L.vignetting.max, step: 0.01, ariaLabel: t('camera.lensVignetting'), onChange: (v, g) => setTraced({ vignetting: v }, 'camera.lensVignetting', g) });
  const spherical = slider({ value: tr0.spherical, min: L.spherical.min, max: L.spherical.max, step: 0.01, ariaLabel: t('camera.lensSpherical'), onChange: (v, g) => setTraced({ spherical: v }, 'camera.lensSpherical', g) });
  const breathing = slider({ value: tr0.breathing, min: L.breathing.min, max: L.breathing.max, step: 0.01, ariaLabel: t('camera.lensBreathing'), onChange: (v, g) => setTraced({ breathing: v }, 'camera.lensBreathing', g) });
  const ca = slider({ value: o0.caAmount, min: 0, max: 1, step: 0.01, ariaLabel: t('camera.ca'), onChange: (v, g) => setOptics({ caAmount: v }, 'camera.ca', g) });
  const swirl = slider({ value: o0.swirl, min: 0, max: 1, step: 0.01, ariaLabel: t('camera.swirl'), onChange: (v, g) => setOptics({ swirl: v }, 'camera.swirl', g) });
  const artistic: [Control<number>, (tr: TracedLens, o: CameraOptics) => number][] = [
    [distortion, (tr) => tr.distortion],
    [vignetting, (tr) => tr.vignetting],
    [spherical, (tr) => tr.spherical],
    [breathing, (tr) => tr.breathing],
    [ca, (_tr, o) => o.caAmount],
    [swirl, (_tr, o) => o.swirl],
  ];
  const advancedBody = h(
    'div',
    { class: 'stack' },
    artisticHead(),
    tip(field(t('camera.lensDistortion'), distortion.el), 'camera.lensDistortionAux'),
    tip(field(t('camera.lensVignetting'), vignetting.el), 'camera.lensVignettingAux'),
    tip(field(t('camera.lensSpherical'), spherical.el), 'camera.lensSphericalAux'),
    tip(field(t('camera.lensBreathing'), breathing.el), 'camera.lensBreathingAux'),
    tip(field(t('camera.ca'), ca.el), 'camera.lensCaAux'),
    field(t('camera.swirl'), swirl.el),
  );
  const advancedOpen = ctx.ui.get().sections.cameraLensAdvanced ?? false;
  const advancedHead = h('button', { type: 'button', class: 'section-head', style: 'padding:0;height:28px', 'aria-expanded': String(advancedOpen), 'data-action': 'cameraLensAdvanced' }, h('span', null, t('camera.lensAdvanced')));
  advancedBody.style.display = advancedOpen ? '' : 'none';
  advancedHead.addEventListener('click', () => {
    const now = advancedBody.style.display === 'none';
    advancedBody.style.display = now ? '' : 'none';
    advancedHead.setAttribute('aria-expanded', String(now));
    ctx.ui.set({ sections: { ...ctx.ui.get().sections, cameraLensAdvanced: now } });
  });

  // --- save lens as… -------------------------------------------------------------------------------------------------
  const promptHost = h('div');
  const save = h(
    'button',
    {
      type: 'button',
      class: 'btn',
      'data-action': 'lens.saveAs',
      onclick: () => {
        const tr = tracedOf(optics());
        if (!tr) return;
        namePrompt(promptHost, { label: t('camera.lensSaveName'), initial: lbl(lensPrescription(tr.key)?.name ?? { en: '', es: '' }), onSave: (name) => cmd.saveLensToLibrary(ctx, camId(), name) });
      },
    },
    t('camera.lensSaveAs'),
  );

  const tracedBox = h(
    'div',
    { class: 'stack', 'data-lens-traced': '' },
    field(t('camera.lensCharacter'), chips),
    listHost,
    source,
    own,
    field(t('camera.blades'), blades.el),
    rangeNote,
    h('div', { class: 'field-label', style: 'margin-top:4px' }, t('camera.lensInfo')),
    sectionHost,
    info,
    h('div', { class: 'stack' }, advancedHead, advancedBody),
    h('div', { class: 'row' }, save),
    promptHost,
    h('div', { class: 'note' }, t('camera.lensFastNote')),
    h('div', { class: 'note' }, t('camera.lensThinOnly')),
  );

  scope.watch(
    (s) => s.camera.cameras[camId()],
    (c) => {
      if (!c) return;
      const o = opticsOf(c);
      const tr = tracedOf(o);
      model.set(tr ? 'traced' : 'thin');
      thinNote.style.display = tr ? 'none' : '';
      tracedBox.style.display = tr ? '' : 'none';
      blades.set(o.blades);
      if (!tr) return;
      const p = lensPrescription(tr.key);
      if (!p) return;
      if (tr.key !== ownKey) {
        // A new lens: its character's chip, its own rows.
        if (filter !== 'MINE') filter = p.character;
        drawChips();
        drawList();
        drawOwn(tr, p);
      } else ownUpdates.forEach((u) => u(tr));
      for (const [ctrl, get] of artistic) ctrl.set(get(tr, o));
      ask(c);
    },
  );
  drawChips();
  drawList();

  return h('div', { class: 'stack', 'data-guide': 'camera-lens' }, field(t('camera.lensModel'), model.el), thinNote, tracedBox);
}

