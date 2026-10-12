// Inspector with nothing selected: the scene (UI.md §2.4): Product, Light,
// Environment, Camera and Image sections.

import { LENS_PRESETS } from '../../data/lenses';
import { LIGHT_STYLES, lightSetup, setupsInStyle } from '../../data/light-setups';
import { STUDIO_PRESETS, studioPreset } from '../../data/studios';
import type { LightStyle } from '../../data/types';
import { activeCamera, type CameraId, type CameraState } from '../../core/camera';
import { lightShares, lightIrradiance } from '../../core/lighting';
import type { EnvironmentState, ImageState } from '../../core/store';
import * as cmd from '../commands';
import { colorField, field, numberField, segmented, select, slider, toggle, type Control } from '../components/controls';
import { section } from '../components/section';
import { confirmBox, showConfirmIn, thumb } from '../components/widgets';
import { h, icon } from '../dom';
import { dyn, lightName, setupLabel, studioLabel } from '../names';
import { dynamic, shallowEq, type Ctx, type Scope } from '../reactive';
import { L, formatNumber, getLang, lbl, t, type StringKey } from '../strings';

/** URL of a light-setup thumbnail in public/thumbs/setups. */
export function setupThumb(key: string, small = false): string {
  return `${import.meta.env.BASE_URL}thumbs/setups/${small ? 'setup' : 'thumb'}_${key.toLowerCase()}.png`;
}

// --- Product -------------------------------------------------------------------

function productSection(ctx: Ctx, scope: Scope): HTMLElement {
  const { store } = ctx;
  const s0 = store.get();
  const typeSel = select(
    STUDIO_PRESETS.map((p) => ({ value: p.key, label: lbl(p.label) })),
    s0.studio.preset,
    (v) => cmd.setProductType(ctx, v),
    t('product.type'),
  );
  const typeAux = h('div', { class: 'aux' });
  const size = numberField({
    value: s0.scene.partSizeMm,
    min: 0.1,
    max: 100000,
    step: 1,
    digits: 1,
    unit: 'mm',
    ariaLabel: t('product.partSize'),
    onChange: (mm, gesture) => store.dispatch({ type: 'scene/setPartSize', mm, gesture, label: L('undo.partSize') }),
  });
  const floor = toggle(s0.studio.floor, (v) => store.dispatch({ type: 'studio/set', patch: { floor: v }, label: L('undo.floor') }), t('product.floor'));
  const shadow = toggle(s0.studio.shadow, (v) => store.dispatch({ type: 'studio/set', patch: { shadow: v }, label: L('undo.shadow') }), t('product.shadow'));
  const confirmHost = h('div');
  const create = h('button', { type: 'button', class: 'btn btn-primary btn-block', 'data-guide': 'create-studio', onclick: () => {
    const spec = cmd.requestBuildStudio(ctx);
    if (spec) showConfirmIn(confirmHost, spec);
  } }, t('product.create'));
  const status = h('div', { class: 'note' });
  scope.watch(
    (s) => s.studio,
    (st) => {
      typeSel.set(st.preset);
      const p = studioPreset(st.preset);
      typeAux.textContent = p ? t('product.typeAux', { focal: p.focalMm, fstop: p.fstop, size: p.sizeMm }) : '';
      floor.set(st.floor);
      shadow.set(st.shadow);
      status.textContent = st.built ? t('product.built', { preset: lbl(studioLabel(st.preset)) }) : t('product.notBuilt');
    },
  );
  scope.watch((s) => s.scene.partSizeMm, (v) => size.set(v));
  const body = h(
    'div',
    { class: 'stack' },
    h('div', { class: 'stack', style: 'gap:3px', 'data-guide': 'product-type' }, field(t('product.type'), typeSel.el), h('div', { style: 'padding-left:112px' }, typeAux)),
    field(t('product.partSize'), size.el),
    h('div', { class: 'note', style: 'padding-left:112px;margin-top:-4px' }, t('product.partSizeAux')),
    field(t('product.floor'), floor.el),
    field(t('product.shadow'), shadow.el),
    create,
    confirmHost,
    status,
  );
  return section(ctx, 'product', t('section.product'), body);
}

// --- Light ------------------------------------------------------------------------

function tuneLights(ctx: Ctx, scope: Scope): HTMLElement {
  const { store } = ctx;
  // Rebuilt when the list of lights changes shape (setup change), values update in place.
  return dynamic(
    scope,
    (s) => s.studio.lights.map((l) => l.id + (l.kelvin === null ? 'c' : 'k')).join(','),
    (sc) => {
      const s = store.get();
      const blocks = s.studio.lights.map((l) => {
        const name = { en: lightName(s, l.id, 'en'), es: lightName(s, l.id, 'es') };
        const label = L('undo.editLight', { name });
        const set = (patch: object, gesture: string) => store.dispatch({ type: 'studio/setLight', id: l.id, patch, gesture, label });
        const share = numberField({
          value: 0,
          min: 0,
          max: 99,
          step: 1,
          unit: '%',
          label: t('lightEdit.power'),
          onChange: (pct, gesture) => {
            const cur = store.get().studio.lights;
            const me = cur.find((x) => x.id === l.id)!;
            const others = cur.reduce((a, x) => a + (x.id === l.id ? 0 : lightIrradiance(x)), 0);
            const g = lightIrradiance({ ...me, power: 1, enabled: true });
            const p = Math.min(0.99, pct / 100);
            const power = others > 0 && g > 0 ? (p * others) / ((1 - p) * g) : me.power;
            set({ power }, gesture);
          },
        });
        const sizeF = numberField({ value: l.size, min: 0.01, max: 50, step: 0.1, digits: 2, label: t('lightEdit.size'), onChange: (v, g) => set({ size: v }, g) });
        const temp: Control<number> | null =
          l.kelvin !== null ? numberField({ value: l.kelvin, min: 1000, max: 12000, step: 100, unit: 'K', onChange: (v, g) => set({ kelvin: v }, g) }) : null;
        const color = l.kelvin === null ? colorField(l.color, (rgb, g) => set({ color: rgb }, g), t('lightEdit.color')) : null;
        const az = numberField({ value: l.az, min: -180, max: 180, step: 1, unit: '°', label: t('lightEdit.azimuth'), onChange: (v, g) => set({ az: v }, g) });
        const el = numberField({ value: l.el, min: -89, max: 89, step: 1, unit: '°', label: t('lightEdit.elevation'), onChange: (v, g) => set({ el: v }, g) });
        sc.watch(
          (st) => st.studio.lights,
          (lights) => {
            const i = lights.findIndex((x) => x.id === l.id);
            const me = lights[i];
            if (!me) return;
            share.set(Math.round(lightShares(lights)[i] * 100));
            sizeF.set(me.size);
            temp?.set(me.kelvin ?? 5600);
            color?.set(me.color);
            az.set(me.az);
            el.set(me.el);
          },
        );
        return h(
          'div',
          { class: 'tune-light' },
          h('div', { class: 'row', style: 'justify-content:space-between' }, h('span', { class: 'field-label' }, name[getLang()]), temp ? h('div', { style: 'width:96px' }, temp.el) : color!.el),
          h('div', { class: 'field-row3', style: 'grid-template-columns:1fr 1fr' }, share.el, sizeF.el, az.el, el.el),
        );
      });
      return h('div', { class: 'stack' }, ...blocks);
    },
  );
}

function lightSection(ctx: Ctx, scope: Scope): HTMLElement {
  const { store, ui } = ctx;
  const styles: (LightStyle | 'ALL')[] = ['ALL', ...LIGHT_STYLES.map((x) => x.key)];
  const chips = h('div', { class: 'chips', role: 'tablist', 'aria-label': t('light.style') });
  const grid = h('div', { class: 'thumbs cols-3', 'data-guide': 'setups' });
  const intent = h('p', { class: 'note', style: 'margin:0' });
  const confirmHost = h('div');
  const skyNote = h('p', { class: 'note', style: 'margin:0' }, t('light.skyNote'));

  const choose = (key: string) => {
    const spec = cmd.requestSetup(ctx, key);
    if (spec) showConfirmIn(confirmHost, spec);
  };
  const step = (dir: 1 | -1) => {
    const list = setupsInStyle(ui.get().lightStyle);
    const cur = list.findIndex((x) => x.key === store.get().studio.lightSetup);
    const next = list[(cur + dir + list.length) % list.length];
    if (next) choose(next.key);
  };

  scope.watch(
    (_s, u) => u.lightStyle,
    (style) => {
      chips.replaceChildren(
        ...styles.map((st) =>
          h('button', { type: 'button', class: 'chip', role: 'tab', 'aria-pressed': String(st === style), onclick: () => ui.set({ lightStyle: st }) }, st === 'ALL' ? t('light.all') : lbl(LIGHT_STYLES.find((x) => x.key === st)!.label)),
        ),
      );
    },
  );
  scope.watch(
    (s, u) => [u.lightStyle, s.studio.lightSetup],
    () => {
      const active = store.get().studio.lightSetup;
      grid.replaceChildren(
        ...setupsInStyle(ui.get().lightStyle).map((st) =>
          thumb({ src: setupThumb(st.key), caption: lbl(st.label), active: st.key === active, title: lbl(st.intent), onClick: () => choose(st.key) }),
        ),
      );
      const setup = lightSetup(active);
      intent.replaceChildren(h('span', { class: 'aux' }, `${t('light.intent')} · `), setup ? lbl(setup.intent) : '');
    },
    shallowEq,
  );
  scope.watch((s) => s.environment.kind === 'SKY', (sky) => (skyNote.style.display = sky ? '' : 'none'));

  const modified = h('span', { class: 'aux' });
  scope.watch((s) => s.studio.modified, (m) => (modified.textContent = m ? t('light.modified') : ''));

  const tuneOpen = ui.get().tuneOpen;
  const tuneHead = h('button', { type: 'button', class: 'section-head', style: 'padding:0;height:28px', 'aria-expanded': String(tuneOpen) }, icon(tuneOpen ? 'chevronDown' : 'chevronRight', 14), h('span', null, t('light.tune')));
  const tuneBody = h('div', { class: 'stack' });
  const placeBtn = h('button', { type: 'button', class: 'btn', 'data-tip': t('light.placeReflectAux') }, icon('reflect', 14), t('light.placeReflect'));
  placeBtn.addEventListener('click', () => {
    const s = store.get();
    const sel = s.studio.lights.find((l) => s.selection.ids.includes(l.id)) ?? s.studio.lights.find((l) => l.role === 'KEY') ?? s.studio.lights[0];
    if (sel) ui.set({ pickMode: ui.get().pickMode ? null : { kind: 'reflect', light: sel.id } });
  });
  scope.watch((_s, u) => u.pickMode?.kind === 'reflect', (on) => placeBtn.setAttribute('aria-pressed', String(on)));
  const resetBtn = h('button', { type: 'button', class: 'btn', onclick: () => store.dispatch({ type: 'studio/resetLights', label: L('undo.resetLights') }) }, t('light.reset'));
  scope.watch((s) => s.studio.modified, (m) => (resetBtn.disabled = !m));
  tuneBody.append(tuneLights(ctx, scope), h('div', { class: 'row' }, placeBtn, resetBtn), h('p', { class: 'note', style: 'margin:0' }, t('light.placeReflectAux')));
  tuneBody.style.display = tuneOpen ? '' : 'none';
  tuneHead.addEventListener('click', () => {
    const open = tuneBody.style.display === 'none';
    tuneBody.style.display = open ? '' : 'none';
    tuneHead.setAttribute('aria-expanded', String(open));
    tuneHead.firstElementChild?.replaceWith(icon(open ? 'chevronDown' : 'chevronRight', 14));
    ui.set({ tuneOpen: open });
  });

  const nav = h(
    'div',
    { class: 'row', style: 'justify-content:space-between' },
    h('button', { type: 'button', class: 'btn', onclick: () => step(-1), 'aria-label': t('common.previous') }, icon('chevronLeft', 14), t('common.previous')),
    modified,
    h('button', { type: 'button', class: 'btn', onclick: () => step(1), 'aria-label': t('common.next') }, t('common.next'), icon('chevronRight', 14)),
  );
  const body = h('div', { class: 'stack' }, chips, grid, intent, skyNote, nav, confirmHost, tuneHead, tuneBody);
  return section(ctx, 'light', t('section.light'), body);
}

// --- Environment ---------------------------------------------------------------------

function envSection(ctx: Ctx, scope: Scope): HTMLElement {
  const { store } = ctx;
  const e0 = store.get().environment;
  const set = (patch: Partial<EnvironmentState>, what: StringKey, gesture?: string) =>
    store.dispatch({ type: 'env/set', patch, gesture, label: cmd.editLabel('env', what) });
  const kind = select(
    (['STUDIO', 'SKY', 'FLAT', 'HDRI'] as const).map((k) => ({ value: k, label: t(dyn(`env.kind.${k}`)) + (k === 'SKY' || k === 'HDRI' ? ` · ${t('common.comingSoon')}` : ''), disabled: k === 'SKY' || k === 'HDRI' })),
    e0.kind,
    (v) => set({ kind: v as EnvironmentState['kind'] }, 'env.kind'),
    t('env.kind'),
  );
  const strength = slider({ value: e0.strength, min: 0, max: 3, step: 0.01, ariaLabel: t('env.strength'), onChange: (v, g) => set({ strength: v }, 'env.strength', g) });
  const rotation = slider({ value: e0.rotationDeg, min: -180, max: 180, step: 1, unit: '°', ariaLabel: t('env.rotation'), onChange: (v, g) => set({ rotationDeg: v }, 'env.rotation', g) });
  const bg = segmented(
    (['ENVIRONMENT', 'COLOR', 'TRANSPARENT', 'BACKPLATE'] as const).map((b) => ({
      value: b,
      label: t(dyn(`env.bg.${b}`)),
      disabled: b === 'BACKPLATE',
      title: b === 'BACKPLATE' ? t('env.backplateSoon') : undefined,
    })),
    e0.background,
    (v) => set({ background: v }, 'env.background'),
    { ariaLabel: t('env.background') },
  );
  bg.el.style.flexWrap = 'wrap';
  const color = colorField(e0.color, (rgb, g) => set({ color: [rgb[0], rgb[1], rgb[2], 1] }, 'env.color', g), t('env.color'));
  const colorRow = field(t('env.color'), color.el);
  const shadow = slider({ value: e0.groundShadow, min: 0, max: 1, step: 0.01, ariaLabel: t('env.groundShadow'), onChange: (v, g) => set({ groundShadow: v }, 'env.groundShadow', g) });
  const refl = slider({ value: e0.groundReflection, min: 0, max: 1, step: 0.01, ariaLabel: t('env.groundReflection'), onChange: (v, g) => set({ groundReflection: v }, 'env.groundReflection', g) });
  scope.watch(
    (s) => s.environment,
    (e) => {
      kind.set(e.kind);
      strength.set(e.strength);
      rotation.set(e.rotationDeg);
      bg.set(e.background);
      color.set(e.color);
      colorRow.style.display = e.background === 'COLOR' || e.kind === 'FLAT' ? '' : 'none';
      shadow.set(e.groundShadow);
      refl.set(e.groundReflection);
    },
  );
  const body = h(
    'div',
    { class: 'stack' },
    field(t('env.kind'), kind.el),
    h('div', { class: 'note', style: 'padding-left:112px;margin-top:-4px' }, t('env.kindSoon')),
    field(t('env.strength'), strength.el),
    field(t('env.rotation'), rotation.el),
    h('div', { class: 'field-label', style: 'margin-top:4px' }, t('env.background')),
    bg.el,
    colorRow,
    field(t('env.groundShadow'), shadow.el),
    field(t('env.groundReflection'), refl.el),
    h('div', { class: 'note' }, t('env.reflectionSoon')),
  );
  return section(ctx, 'environment', t('section.environment'), body);
}

// --- Camera ---------------------------------------------------------------------------

/** Camera fields for one camera (the active one in the scene context). */
export function cameraFields(ctx: Ctx, scope: Scope, camId: () => CameraId): HTMLElement {
  const { store, ui } = ctx;
  const cam0 = store.get().camera.cameras[camId()] ?? activeCamera(store.get());
  const set = (patch: Partial<CameraState>, what: StringKey, gesture?: string) =>
    store.dispatch({ type: 'camera/set', id: camId(), patch, gesture, label: cmd.editLabel('camera', what) });
  const lens = select(
    [{ value: '', label: t('camera.lensCustom') }, ...LENS_PRESETS.map((l) => ({ value: l.key, label: lbl(l.label) }))],
    cam0.lens ?? '',
    (v) => {
      if (!v) return;
      if (camId() !== store.get().camera.active) cmd.activateCamera(ctx, camId());
      const lensP = LENS_PRESETS.find((l) => l.key === v)!;
      store.dispatch({ type: 'camera/lens', key: v, label: L('undo.lens', { name: lensP.label }) });
    },
    t('camera.lens'),
  );
  const focal = numberField({ value: cam0.focalMm, min: 8, max: 600, step: 1, unit: 'mm', ariaLabel: t('camera.focal'), onChange: (v, g) => set({ focalMm: v }, 'camera.focal', g) });
  const fstop = numberField({ value: cam0.fstop, min: 0.95, max: 32, step: 0.1, digits: 1, prefix: 'f/', ariaLabel: t('camera.fstop'), onChange: (v, g) => set({ fstop: v }, 'camera.fstop', g) });
  const focus = numberField({ value: cam0.focusDistance, min: 1, max: 1e6, step: 1, unit: 'mm', ariaLabel: t('camera.focus'), onChange: (v, g) => set({ focusDistance: v }, 'camera.focus', g) });
  const focusBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('camera.focusClick'), 'data-tip': t('camera.focusClick'), onclick: () => ui.set({ pickMode: ui.get().pickMode?.kind === 'focus' ? null : { kind: 'focus' } }) }, icon('focus'));
  scope.watch((_s, u) => u.pickMode?.kind === 'focus', (on) => focusBtn.setAttribute('aria-pressed', String(on)));
  const proj = segmented(
    [
      { value: 'PERSPECTIVE' as const, label: t('viewport.perspective') },
      { value: 'ORTHOGRAPHIC' as const, label: t('viewport.ortho') },
    ],
    cam0.projection,
    (v) => set({ projection: v }, v === 'PERSPECTIVE' ? 'viewport.perspective' : 'viewport.ortho'),
    { full: true, ariaLabel: t('camera.projection') },
  );
  scope.watch(
    (s) => s.camera.cameras[camId()],
    (c) => {
      if (!c) return;
      lens.set(c.lens ?? '');
      focal.set(c.focalMm);
      fstop.set(c.fstop);
      focus.set(Math.round(c.focusDistance));
      proj.set(c.projection);
    },
  );
  return h(
    'div',
    { class: 'stack', 'data-guide': 'camera' },
    field(t('camera.lens'), lens.el),
    field(t('camera.focal'), focal.el),
    field(t('camera.fstop'), fstop.el),
    field(t('camera.focus'), focus.el, focusBtn),
    h('div', { class: 'note' }, t('camera.dofSoon')),
    field(t('camera.projection'), proj.el),
    h(
      'div',
      { class: 'row' },
      h('button', { type: 'button', class: 'btn', style: 'flex:1', onclick: () => {
        if (camId() !== store.get().camera.active) cmd.activateCamera(ctx, camId());
        cmd.frameSelection(ctx);
      } }, icon('frame', 14), t('camera.frame')),
      h('button', { type: 'button', class: 'btn', style: 'flex:1', onclick: () => cmd.newCamera(ctx) }, icon('plus', 14), t('camera.saveAs')),
    ),
  );
}

function cameraSection(ctx: Ctx, scope: Scope): HTMLElement {
  return section(ctx, 'camera', t('section.camera'), cameraFields(ctx, scope, () => ctx.store.get().camera.active));
}

// --- Image ------------------------------------------------------------------------------

function imageSection(ctx: Ctx, scope: Scope): HTMLElement {
  const { store } = ctx;
  const i0 = store.get().image;
  const set = (patch: Partial<ImageState>, what: StringKey, gesture?: string) =>
    store.dispatch({ type: 'image/set', patch, gesture, label: cmd.editLabel('image', what) });
  const exposure = slider({ value: i0.exposureEv, min: -5, max: 5, step: 0.05, unit: 'EV', ariaLabel: t('image.exposure'), onChange: (v, g) => set({ exposureEv: v }, 'image.exposure', g) });
  const vt = segmented(
    (['STANDARD', 'FILMIC', 'AGX'] as const).map((v) => ({ value: v, label: t(dyn(`vt.${v}`)) })),
    i0.viewTransform,
    (v) => set({ viewTransform: v }, 'image.viewTransform'),
    { full: true, ariaLabel: t('image.viewTransform') },
  );
  const post = (['bloom', 'sharpen', 'saturation', 'contrast', 'vignette'] as const).map((k) => {
    const signed = k === 'saturation' || k === 'contrast';
    const ctrl = slider({ value: i0[k], min: signed ? -1 : 0, max: 1, step: 0.01, ariaLabel: t(dyn(`image.${k}`)), onChange: (v, g) => set({ [k]: v }, dyn(`image.${k}`), g) });
    return { k, ctrl };
  });
  scope.watch(
    (s) => s.image,
    (img) => {
      exposure.set(img.exposureEv);
      vt.set(img.viewTransform);
      for (const p of post) p.ctrl.set(img[p.k]);
    },
  );
  const body = h(
    'div',
    { class: 'stack' },
    field(t('image.exposure'), exposure.el),
    field(t('image.viewTransform'), vt.el),
    ...post.map((p) => field(t(dyn(`image.${p.k}`)), p.ctrl.el)),
    h('div', { class: 'note' }, t('image.postSoon')),
  );
  return section(ctx, 'image', t('section.image'), body);
}

export function sceneInspector(ctx: Ctx, scope: Scope): HTMLElement {
  return h('div', null, productSection(ctx, scope), lightSection(ctx, scope), envSection(ctx, scope), cameraSection(ctx, scope), imageSection(ctx, scope));
}

export { confirmBox, formatNumber, setupLabel };
