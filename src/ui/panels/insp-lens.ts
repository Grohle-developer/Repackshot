// The camera's optics in the inspector (phase O1, UI.md §2.4 Camera): the Bokeh selector, with a thumbnail of every
// type of src/data/bokeh.json rendered by the engine itself (public/thumbs/bokeh/, tools/bokeh-thumbs.mjs), and the
// subsection Advanced optics with the knobs of the enhanced thin lens, tilt and shift. Everything goes through the
// store (camera/set with the camera's `optics`), so every change is one undo entry (a drag, one gesture).

import { BOKEH_TYPES, PUPIL_PROFILES, bokehParams, bokehType, type BokehThin, type BokehType, type PupilProfile } from '../../data/bokeh';
import type { CameraId, CameraState } from '../../core/camera';
import { OPTICS_LIMITS, OPTICS_NEUTRAL, SQUEEZES, filtersOf, opticsForBokeh, opticsOf, thinOf, tracedOf, type CameraOptics } from '../../core/optics';
import { lensPrescription } from '../../data/lenses';
import * as cmd from '../commands';
import { field, numberField, segmented, select, slider, type Control } from '../components/controls';
import { thumb } from '../components/widgets';
import { h, icon } from '../dom';
import { type Ctx, type Scope } from '../reactive';
import { formatNumber, lbl, t, type StringKey } from '../strings';
import { filterFields } from './insp-filters';
import { tracedLensFields } from './insp-traced';

/** The thumbnail of a bokeh type (and variant), as tools/bokeh-thumbs.mjs names it. */
export function bokehThumb(key: string, variant: string | null = null): string {
  const name = key.replace(/_/g, '-') + (variant ? `--${variant.replace(/_/g, '-')}` : '');
  return `${import.meta.env.BASE_URL}thumbs/bokeh/${name}.png`;
}

const sameThin = (a: BokehThin | null, b: BokehThin | null) => !!a && !!b && (Object.keys(a) as (keyof BokehThin)[]).every((k) => a[k] === b[k]);

/** The variant a type's own parameters equal, if any (the type's default shows as that variant). */
function defaultVariant(type: BokehType): string | null {
  return type.variants.find((v) => sameThin(bokehParams(type, v.key), type.thin))?.key ?? null;
}

/** The heading of the artistic knobs, marked as not physical (STUDIO-TOOLS §0). */
function artisticHead(): HTMLElement {
  return h('div', { class: 'aux', 'data-artistic': '', 'data-tip': t('camera.notPhysicalAux'), style: 'padding-top:4px' }, t('camera.notPhysical'));
}

function disclosure(ctx: Ctx, id: string, title: string, body: HTMLElement, open0: boolean): HTMLElement {
  const open = ctx.ui.get().sections[id] ?? open0;
  const head = h('button', { type: 'button', class: 'section-head', style: 'padding:0;height:28px', 'aria-expanded': String(open), 'data-action': id }, icon(open ? 'chevronDown' : 'chevronRight', 14), h('span', null, title));
  body.style.display = open ? '' : 'none';
  head.addEventListener('click', () => {
    const now = body.style.display === 'none';
    body.style.display = now ? '' : 'none';
    head.setAttribute('aria-expanded', String(now));
    head.firstElementChild?.replaceWith(icon(now ? 'chevronDown' : 'chevronRight', 14));
    ctx.ui.set({ sections: { ...ctx.ui.get().sections, [id]: now } });
  });
  return h('div', { class: 'stack', 'data-optics': id }, head, body);
}

/** The Bokeh selector and the Advanced optics of camera `camId()`. */
export function opticsFields(ctx: Ctx, scope: Scope, camId: () => CameraId): HTMLElement {
  const { store } = ctx;
  const cam = (): CameraState | undefined => store.get().camera.cameras[camId()];
  const optics = (): CameraOptics => {
    const c = cam();
    return c ? opticsOf(c) : OPTICS_NEUTRAL;
  };
  const dispatch = (next: CameraOptics | undefined, what: StringKey, gesture?: string) =>
    store.dispatch({ type: 'camera/set', id: camId(), patch: { optics: next }, gesture, label: cmd.editLabel('camera', what) });
  /** A knob of the bokeh moved by hand: the type is no longer the one chosen. Tilt and shift keep it. */
  const set = (patch: Partial<CameraOptics>, what: StringKey, gesture?: string, bokeh = true) => {
    const cur = optics();
    dispatch({ ...cur, ...patch, ...(bokeh ? { bokeh: null, variant: null } : {}) }, what, gesture);
  };
  const choose = (key: string, variant: string | null) => {
    const next = opticsForBokeh(optics(), key, variant);
    if (next) dispatch(next, 'camera.bokehType');
  };

  // --- the selector ----------------------------------------------------------------------------------------------
  const grid = h('div', { class: 'thumbs cols-4', role: 'listbox', 'aria-label': t('camera.bokehType'), 'data-bokeh-grid': '' });
  const tiles = new Map<string, HTMLButtonElement>();
  for (const type of BOKEH_TYPES) {
    // O2: the types of the traced lens put their lens on the camera; wave optics is still to come.
    const traced = type.requires === 'traced' && !!type.lens && !!lensPrescription(type.lens);
    const can = (type.requires === null && type.thin !== null) || traced;
    const lensName = traced ? lbl(lensPrescription(type.lens!)!.name) : '';
    const el = thumb({
      src: can ? bokehThumb(type.key) : null,
      caption: lbl(type.name),
      active: false,
      title: traced ? `${lbl(type.description)} · ${t('camera.bokehTraced', { lens: lensName })}` : can ? lbl(type.description) : `${lbl(type.description)} · ${t('camera.bokehWave')}`,
      onClick: () => {
        if (can) choose(type.key, optics().bokeh === type.key ? optics().variant : defaultVariant(type));
      },
    });
    el.setAttribute('data-bokeh', type.key);
    if (!can) {
      el.disabled = true;
      el.setAttribute('aria-disabled', 'true');
      el.querySelector('.thumb-ph')?.append(h('span', { class: 'aux', style: 'display:block;padding-top:30%' }, t('camera.bokehSoon')));
    }
    tiles.set(type.key, el);
    grid.appendChild(el);
  }
  const variantHost = h('div');
  const describe = h('div', { class: 'note', 'data-bokeh-note': '' });
  const reset = h('button', { type: 'button', class: 'btn', 'data-tip': t('camera.bokehResetAux'), 'data-action': 'optics.reset', onclick: () => {
        // The plain thin lens; the filters in front of it stay.
        const filters = filtersOf(optics());
        dispatch(filters.length > 0 ? { ...OPTICS_NEUTRAL, filters } : undefined, 'camera.bokehReset');
      },
    },
    t('camera.bokehReset'),
  );

  // --- Advanced optics --------------------------------------------------------------------------------------------
  const o0 = optics();
  const blades = numberField({
    value: o0.blades,
    min: 0,
    max: OPTICS_LIMITS.blades.max,
    step: 1,
    ariaLabel: t('camera.blades'),
    format: (v) => (v < 3 ? t('camera.bladesRound') : String(v)),
    onChange: (v, g) => {
      // 1 and 2 blades are no iris: below 3 the iris is round, up from it the first polygon.
      const prev = optics().blades;
      const n = v >= 3 ? Math.round(v) : v > prev && prev === 0 ? 3 : 0;
      set({ blades: n }, 'camera.blades', g);
    },
  });
  const roundness = slider({ value: o0.roundness, min: 0, max: 1, step: 0.01, ariaLabel: t('camera.roundness'), onChange: (v, g) => set({ roundness: v }, 'camera.roundness', g) });
  const rotation = numberField({ value: o0.rotationDeg, min: -180, max: 180, step: 1, unit: '°', ariaLabel: t('camera.rotation'), onChange: (v, g) => set({ rotationDeg: v }, 'camera.rotation', g) });
  const profile = select(
    PUPIL_PROFILES.map((p) => ({ value: p.key, label: lbl(p.label) })),
    o0.profile,
    (v) => set({ profile: v as PupilProfile }, 'camera.profile'),
    t('camera.profile'),
  );
  const strength = slider({ value: o0.profileParam, min: 0, max: 1, step: 0.01, ariaLabel: t('camera.profileStrength'), onChange: (v, g) => set({ profileParam: v }, 'camera.profileStrength', g) });
  const obstruction = slider({ value: o0.obstruction, min: 0, max: OPTICS_LIMITS.obstruction.max, step: 0.01, ariaLabel: t('camera.obstruction'), onChange: (v, g) => set({ obstruction: v }, 'camera.obstruction', g) });
  const catsEye = slider({ value: o0.catsEye, min: 0, max: 1, step: 0.01, ariaLabel: t('camera.catsEye'), onChange: (v, g) => set({ catsEye: v }, 'camera.catsEye', g) });
  const squeeze = segmented(
    SQUEEZES.map((q) => ({ value: String(q), label: q === 1 ? t('camera.anamorphicNone') : `${formatNumber(q, undefined, 2)}×` })),
    String(o0.squeeze),
    (v) => set({ squeeze: Number(v) }, 'camera.anamorphic'),
    { full: true, ariaLabel: t('camera.anamorphic') },
  );
  const tilt = numberField({ value: o0.tiltDeg, min: OPTICS_LIMITS.tiltDeg.min, max: OPTICS_LIMITS.tiltDeg.max, step: 0.1, digits: 1, unit: '°', ariaLabel: t('camera.tilt'), onChange: (v, g) => set({ tiltDeg: v }, 'camera.tilt', g, false) });
  const tiltAxis = numberField({ value: o0.tiltAxisDeg, min: -180, max: 180, step: 1, unit: '°', ariaLabel: t('camera.tiltAxis'), onChange: (v, g) => set({ tiltAxisDeg: v }, 'camera.tiltAxis', g, false) });
  const shiftX = numberField({ value: o0.shiftXMm, min: OPTICS_LIMITS.shiftMm.min, max: OPTICS_LIMITS.shiftMm.max, step: 0.1, digits: 1, unit: 'mm', label: 'H', ariaLabel: t('camera.shiftX'), onChange: (v, g) => set({ shiftXMm: v }, 'camera.shiftX', g, false) });
  const shiftY = numberField({ value: o0.shiftYMm, min: OPTICS_LIMITS.shiftMm.min, max: OPTICS_LIMITS.shiftMm.max, step: 0.1, digits: 1, unit: 'mm', label: 'V', ariaLabel: t('camera.shiftY'), onChange: (v, g) => set({ shiftYMm: v }, 'camera.shiftY', g, false) });
  const ca = slider({ value: o0.caAmount, min: 0, max: 1, step: 0.01, ariaLabel: t('camera.ca'), onChange: (v, g) => set({ caAmount: v }, 'camera.ca', g) });
  const swirl = slider({ value: o0.swirl, min: 0, max: 1, step: 0.01, ariaLabel: t('camera.swirl'), onChange: (v, g) => set({ swirl: v }, 'camera.swirl', g) });
  const tip = (el: HTMLElement, key: StringKey) => {
    el.setAttribute('data-tip', t(key));
    return el;
  };
  // The thin lens's own knobs: off with a traced lens.
  const thinOnly = [
    field(t('camera.profile'), profile.el),
    field(t('camera.profileStrength'), strength.el),
    tip(field(t('camera.catsEye'), catsEye.el), 'camera.catsEyeAux'),
    tip(field(t('camera.anamorphic'), squeeze.el), 'camera.anamorphicAux'),
    tip(field(t('camera.tilt'), tilt.el), 'camera.tiltAux'),
    tip(field(t('camera.tiltAxis'), tiltAxis.el), 'camera.tiltAux'),
  ];
  const thinOnlyNote = h('div', { class: 'note', 'data-thin-only': '' }, t('camera.lensThinOnly'));
  const advancedBody = h(
    'div',
    { class: 'stack' },
    thinOnlyNote,
    field(t('camera.blades'), blades.el),
    field(t('camera.roundness'), roundness.el),
    field(t('camera.rotation'), rotation.el),
    thinOnly[0],
    thinOnly[1],
    field(t('camera.obstruction'), obstruction.el),
    thinOnly[2],
    thinOnly[3],
    thinOnly[4],
    thinOnly[5],
    tip(field(t('camera.shift'), shiftX.el, shiftY.el), 'camera.shiftAux'),
    artisticHead(),
    field(t('camera.ca'), ca.el),
    field(t('camera.swirl'), swirl.el),
  );
  const controls: [Control<number>, (o: CameraOptics) => number][] = [
    [blades, (o) => o.blades],
    [roundness, (o) => o.roundness],
    [rotation, (o) => o.rotationDeg],
    [strength, (o) => o.profileParam],
    [obstruction, (o) => o.obstruction],
    [catsEye, (o) => o.catsEye],
    [tilt, (o) => o.tiltDeg],
    [tiltAxis, (o) => o.tiltAxisDeg],
    [shiftX, (o) => o.shiftXMm],
    [shiftY, (o) => o.shiftYMm],
    [ca, (o) => o.caAmount],
    [swirl, (o) => o.swirl],
  ];

  scope.watch(
    (s) => s.camera.cameras[camId()]?.optics,
    () => {
      const o = optics();
      for (const [c, get] of controls) c.set(get(o));
      profile.set(o.profile);
      squeeze.set(String(o.squeeze));
      roundness.el.toggleAttribute('data-disabled', o.blades === 0);
      // With a traced lens the lens makes its own pupil, cat's eye and squeeze, and does not tilt (yet).
      const traced = !!tracedOf(o);
      for (const el of thinOnly) {
        el.toggleAttribute('data-disabled', traced);
        el.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input, button, select').forEach((x) => (x.disabled = traced));
      }
      thinOnlyNote.style.display = traced ? '' : 'none';
      for (const [key, el] of tiles) {
        const on = o.bokeh === key;
        el.classList.toggle('is-active', on);
        el.setAttribute('aria-pressed', String(on));
        const type = bokehType(key)!;
        const img = el.querySelector('img');
        if (img && type.requires !== 'wave') {
          const want = bokehThumb(key, on ? o.variant : null);
          if (!img.src.endsWith(want)) img.src = want;
        }
      }
      const type = o.bokeh ? bokehType(o.bokeh) : undefined;
      variantHost.replaceChildren();
      if (type && type.variants.length > 0) {
        const def = defaultVariant(type);
        const options = [...(def ? [] : [{ value: '', label: lbl(type.name) }]), ...type.variants.map((v) => ({ value: v.key, label: lbl(v.name) }))];
        const vsel = select(options, o.variant ?? def ?? '', (v) => choose(type.key, v || null), t('camera.bokehVariant'));
        variantHost.append(field(t('camera.bokehVariant'), vsel.el));
      }
      describe.textContent = type ? lbl(type.description) : sameThin(thinOf(o), thinOf(OPTICS_NEUTRAL)) ? t('camera.bokehAux') : t('camera.bokehCustom');
    },
  );

  const bokehBody = h('div', { class: 'stack' }, grid, variantHost, describe, h('div', { class: 'row' }, reset));
  return h(
    'div',
    { class: 'stack', 'data-guide': 'camera-optics' },
    disclosure(ctx, 'cameraLens', t('camera.lensSection'), tracedLensFields(ctx, scope, camId), true),
    disclosure(ctx, 'cameraBokeh', t('camera.bokeh'), bokehBody, true),
    disclosure(ctx, 'cameraOptics', t('camera.opticsAdvanced'), h('div', { class: 'stack' }, advancedBody, h('div', { class: 'note' }, t('camera.opticsNote'))), false),
    disclosure(ctx, 'cameraFilters', t('camera.filters'), filterFields(ctx, scope, camId), filtersOf(optics()).length > 0),
  );
}
