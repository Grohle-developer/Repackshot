// Inspector with nothing selected: the scene (UI.md §2.4): Product, Light,
// Environment, Ambient (S4a, insp-ambient.ts), Section (Q1, insp-section.ts), Camera and Image sections.

import { LENS_PRESETS } from '../../data/lenses';
import { LIGHT_STYLES, lightSetup } from '../../data/light-setups';
import { SCENE_TYPES } from '../../data/scene-types';
import { STUDIO_PRESETS } from '../../data/studios';
import type { LightSetup } from '../../data/types';
import type { UiState } from '../ui-state';
import { activeCamera, CAMERA_PROJECTIONS, type CameraId, type CameraProjection, type CameraState } from '../../core/camera';
import { EXPOSURE_PRESETS, EXTERIOR_MAX, EXTERIOR_MIN, FISHEYE_FOV_MAX, FISHEYE_FOV_MIN, VERTICALS_MAX_TILT_DEG } from '../../data/interior-camera';
import { EYE_HEIGHT_PRESETS, exteriorOf, eyeHeightOf, INTERIOR_LENSES, verticalsOf } from '../../core/interior-camera';
import { fisheyeFov } from '../../core/panorama';
import { autoExposure, presetExposure } from '../../core/image-passes';
import { itemsOf, type LightSetupItem, type ProductTypeItem } from '../../core/library';
import { libraryKey, lightShares, lightIrradiance, presetRefOf } from '../../core/lighting';
import { resolvePreset } from '../../core/rig';
import { activeSet, setBackground, setPieceIds } from '../../core/sets';
import { filterSetups, groupFilters, SETUP_GROUPS, type SetupFilter } from '../../core/setup-groups';
import type { ThumbSize } from '../../core/settings';
import type { EnvironmentState, ImageState, ProjectState } from '../../core/store';
import * as cmd from '../commands';
import { colorField, field, lengthField, numberField, segmented, select, slider, toggle, type Control } from '../components/controls';
import { libraryFoot, mineCards, mineEmpty, mineRows, namePrompt, type MineSpec } from '../components/library';
import { section } from '../components/section';
import { ambientSection } from './insp-ambient';
import { sectionSection } from './insp-section';
import { opticsFields } from './insp-lens';
import { confirmBox, showConfirmIn, thumb, type ConfirmSpec } from '../components/widgets';
import { filterChipRows, type ChipRows } from '../components/filter-chips';
import { h, icon } from '../dom';
import { cameraName, dyn, lightName, setupLabel, setupTip, studioLabel } from '../names';
import { dynamic, shallowEq, type Ctx, type Scope } from '../reactive';
import { L, formatNumber, getLang, lbl, t, type StringKey } from '../strings';
import { aspectRows } from './insp-aspect';

/** URL of a light-setup thumbnail in public/thumbs/setups. */
export function setupThumb(key: string, small = false): string {
  return `${import.meta.env.BASE_URL}thumbs/setups/${small ? 'setup' : 'thumb'}_${key.toLowerCase()}.png`;
}

// --- Product -------------------------------------------------------------------

function productSection(ctx: Ctx, scope: Scope): HTMLElement {
  const { store } = ctx;
  const s0 = store.get();
  // K1: the scene type, over the product type. It rewrites starting values and removes no control.
  const sceneType = segmented(
    SCENE_TYPES.map((x) => ({ value: x.key, label: lbl(x.label), title: lbl(x.intent) })),
    s0.scene.type,
    (v) => cmd.setSceneType(ctx, v),
    { full: true, compact: true, ariaLabel: t('product.sceneType') },
  );
  scope.watch((s) => s.scene.type, (v) => sceneType.set(v));
  const typeSel = select(
    STUDIO_PRESETS.map((p) => ({ value: p.key, label: lbl(studioLabel(p.key)) })),
    s0.studio.preset,
    (v) => cmd.setProductType(ctx, v),
    t('product.type'),
  );
  // The own types are a group of the same dropdown. The one in force is listed even if its library item is gone:
  // the project holds its definition.
  const fillMine = (s: ProjectState, u: UiState) => {
    typeSel.el.querySelector('optgroup')?.remove();
    const own = itemsOf(u.library, 'productType').map((i) => ({ key: libraryKey(i.id), name: i.name }));
    const cur = s.studio.customPreset;
    if (cur && !own.some((o) => o.key === cur.key)) own.push({ key: cur.key, name: lbl(cur.label) });
    if (own.length === 0) return;
    typeSel.el.appendChild(h('optgroup', { label: t('catalog.mine') }, ...own.map((o) => h('option', { value: o.key }, o.name))));
  };
  const mineHost = h('div', { class: 'stack', style: 'gap:6px' });
  const mineConfirm = h('div');
  const mineSpec: MineSpec<ProductTypeItem> & { aux(item: ProductTypeItem): string } = {
    icon: 'studio',
    active: (item) => store.get().studio.preset === libraryKey(item.id),
    choose: (item) => void cmd.setProductType(ctx, libraryKey(item.id)),
    title: (item) => t('product.typeAux', { focal: item.preset.focalMm, fstop: item.preset.fstop, size: item.preset.sizeMm }),
    aux: (item) => t('product.typeAux', { focal: item.preset.focalMm, fstop: item.preset.fstop, size: item.preset.sizeMm }),
  };
  const saveHost = h('div');
  const saveType = h(
    'button',
    { type: 'button', class: 'btn btn-block', 'data-tip': t('product.saveTypeAux'), onclick: () => namePrompt(saveHost, { label: t('product.saveType'), initial: cmd.suggestTypeName(ctx), onSave: (name) => void cmd.saveProductTypeToLibrary(ctx, name) }) },
    icon('plus', 14),
    t('product.saveType'),
  );
  const typeAux = h('div', { class: 'aux' });
  const size = lengthField({
    value: s0.scene.partSizeMm,
    min: 0.1,
    max: 100000,
    step: 1,
    digits: 1,
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
    (s, u) => [s.studio, u.library.productTypes] as const,
    ([st]) => {
      fillMine(store.get(), ctx.ui.get());
      typeSel.set(st.preset);
      const p = resolvePreset(presetRefOf(st));
      typeAux.textContent = p ? t('product.typeAux', { focal: p.focalMm, fstop: p.fstop, size: p.sizeMm }) : '';
      floor.set(st.floor);
      shadow.set(st.shadow);
      status.textContent = st.built ? t('product.built', { preset: lbl(studioLabel(st.preset, st.customPreset)) }) : t('product.notBuilt');
    },
    (a, b) => a[0] === b[0] && a[1] === b[1],
  );
  const mineFoot = libraryFoot(ctx, scope);
  scope.watch(
    (s, u) => [u.library.productTypes, s.studio.preset] as const,
    ([types]) => {
      const rows = mineRows(ctx, types, mineSpec, mineConfirm);
      // The list of own types is there once there is one: until then the button and the dropdown say it all.
      mineHost.style.display = types.length === 0 ? 'none' : '';
      mineHost.replaceChildren(h('div', { class: 'subhead' }, t('catalog.mine')), h('div', { class: 'list', style: 'padding:0' }, ...rows), mineConfirm, mineFoot);
    },
    (a, b) => a[0] === b[0] && a[1] === b[1],
  );
  scope.watch((s) => s.scene.partSizeMm, (v) => size.set(v));
  const body = h(
    'div',
    { class: 'stack' },
    h('div', { class: 'stack', style: 'gap:3px', 'data-guide': 'scene-type' }, field(t('product.sceneType'), sceneType.el), h('div', { class: 'note', style: 'padding-left:112px' }, t('product.sceneTypeAux'))),
    h('div', { class: 'stack', style: 'gap:3px', 'data-guide': 'product-type' }, field(t('product.type'), typeSel.el), h('div', { style: 'padding-left:112px' }, typeAux)),
    field(t('product.partSize'), size.el),
    h('div', { class: 'note', style: 'padding-left:112px;margin-top:-4px' }, t('product.partSizeAux')),
    field(t('product.floor'), floor.el),
    field(t('product.shadow'), shadow.el),
    create,
    confirmHost,
    status,
    saveType,
    saveHost,
    mineHost,
  );
  return section(ctx, 'product', t('section.product'), body);
}

// --- Light ------------------------------------------------------------------------

/**
 * What rebuilds the light fields: the shape of the list and what names each light (its role, whether it is own, its
 * name), so a setup whose lights keep the same ids (the scene type's recipe, C1) does not leave the names of the lights
 * before it. Values update in place.
 */
export function tuneLightsKey(s: ProjectState): string {
  return s.studio.lights.map((l) => `${l.id}:${l.role}:${l.own ? 'o' : ''}:${l.name ?? ''}:${l.kelvin === null ? 'c' : 'k'}`).join(',');
}

function tuneLights(ctx: Ctx, scope: Scope): HTMLElement {
  const { store } = ctx;
  return dynamic(
    scope,
    tuneLightsKey,
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

/**
 * L6: what the set in force brings, under the catalogue: Use the set's camera (when it suggests one) and a row per
 * piece of its decoration (cards, backdrop, floor; the pool is a light, in Tune lights) with a switch. Nothing for a
 * setup that is not a set.
 */
function setBlock(ctx: Ctx, scope: Scope): HTMLElement {
  const { store } = ctx;
  return dynamic(
    scope,
    (s) => {
      const set = activeSet(s);
      const pieces = setPieceIds(s).map((id) => `${id}:${s.scene.nodes[id].visible ? 1 : 0}:${s.scene.nodes[id].name}`);
      if (!set && pieces.length === 0) return '';
      return [set?.key ?? '', activeCamera(s)?.locked ? 'L' : '', s.environment.background, ...pieces].join('|');
    },
    () => {
      const s = store.get();
      const set = activeSet(s);
      // L7: Lights added (or hidden) over a set leave its pieces in the scene: their rows stay, without the set's camera.
      if (!set && setPieceIds(s).length === 0) return h('div');
      const rows: HTMLElement[] = [];
      if (set?.camera) {
        const view = [set.camera.el !== undefined ? t('set.cameraEl', { el: set.camera.el }) : '', set.camera.focalMm !== undefined ? t('set.cameraFocal', { focal: set.camera.focalMm }) : ''].filter(Boolean).join(', ');
        const locked = activeCamera(s)?.locked === true;
        const btn = h('button', { type: 'button', class: 'btn btn-block', 'data-tip': locked ? t('set.cameraLocked') : t('set.cameraAux', { view }), disabled: locked, onclick: () => cmd.useSetCamera(ctx) }, icon('camera', 14), t('set.camera')) as HTMLButtonElement;
        rows.push(btn);
      }
      const pieces = setPieceIds(s);
      const items: HTMLElement[] = [];
      const row = (name: string, on: boolean, change: (v: boolean) => void) => {
        const sw = toggle(on, change, t('set.toggle', { name }));
        items.push(h('div', { class: 'row', style: 'justify-content:space-between' }, h('span', { class: 'field-label' }, name), sw.el));
      };
      // A colour or a gradient behind (no sweep): the background, on or off.
      const bg = set ? setBackground(set) : null;
      if (bg) row(t(bg === 'GRADIENT' ? 'set.bg.GRADIENT' : 'set.bg.FLAT'), s.environment.background === (bg === 'GRADIENT' ? 'GRADIENT' : 'COLOR'), (v) => cmd.toggleSetBackdrop(ctx, v));
      for (const id of pieces) {
        const n = s.scene.nodes[id];
        row(n.name, n.visible, (v) => cmd.hideSelection(ctx, [id], v));
      }
      if (items.length > 0) rows.push(h('div', { class: 'subhead', 'data-tip': t('set.piecesAux') }, t('set.pieces')), ...items);
      return h('div', { class: 'stack', style: 'gap:6px', 'data-set': set?.key ?? '' }, ...rows);
    },
  );
}

/** L7: the next size of the catalogue's thumbnails (the header's button goes round them). */
const NEXT_SIZE: Readonly<Record<ThumbSize, ThumbSize>> = { S: 'M', M: 'L', L: 'S' };
/** Columns of the grid at each size: medium is the size every setup's thumbnail had (Dark field's). */
export const THUMB_COLUMNS: Readonly<Record<ThumbSize, number>> = { S: 4, M: 3, L: 2 };

/** The names of a filter's values in the light catalogue (L7): product types, subjects, styles. */
function filterOptions(f: SetupFilter): { value: string; label: string }[] {
  if (f.id === 'type') return f.values.map((v) => ({ value: v, label: lbl(studioLabel(v)) }));
  if (f.id === 'hero') return f.values.map((v) => ({ value: v, label: t(`light.hero.${v}` as StringKey) }));
  return [...f.values.map((v) => ({ value: v, label: lbl(LIGHT_STYLES.find((x) => x.key === v)!.label) })), { value: 'MINE', label: t('catalog.mine') }];
}

function lightSection(ctx: Ctx, scope: Scope): HTMLElement {
  const { store, ui } = ctx;
  // The own setups of the library, as the cards of the Mine tab.
  const mineConfirm = h('div');
  const mineFoot = libraryFoot(ctx, scope);
  mineFoot.style.display = 'none';
  const mineSpec: MineSpec<LightSetupItem> = {
    icon: 'light',
    active: (item) => store.get().studio.lightSetup === libraryKey(item.id),
    choose: (item) => cmd.requestSetup(ctx, libraryKey(item.id)),
    title: (item) => t('library.ownSetup', { n: item.lights.length }),
  };
  // L7: two groups, Sets (what dresses the scene besides lights) and Lights (what only places lights), each with its
  // filters (rows of chips that combine, P6b), and one thumbnail size for both, chosen in the section's header.
  const group = segmented(
    SETUP_GROUPS.map((g) => ({ value: g, label: t(`light.group.${g}` as StringKey), title: t(`light.group.${g}.aux` as StringKey) })),
    ui.get().lightGroup,
    (g) => ui.set({ lightGroup: g }),
    { full: true, ariaLabel: t('light.group') },
  );
  scope.watch((_s, u) => u.lightGroup, (g) => group.set(g));
  const filtersEl = h('div', { class: 'rw-pl-filters', 'data-light-filters': '' });
  const countLine = h('div', { class: 'note tabular', role: 'status', 'data-light-count': '' });
  const grid = h('div', { class: 'stack', style: 'gap:6px', 'data-guide': 'setups' });
  const intent = h('p', { class: 'note', style: 'margin:0' });
  const confirmHost = h('div', { 'data-light-question': '' });

  const ask = (spec: ConfirmSpec | null) => {
    if (!spec) return;
    showConfirmIn(confirmHost, spec);
    // The question is above the grid: in view, whichever thumbnail asked it.
    confirmHost.scrollIntoView?.({ block: 'nearest' });
  };
  const choose = (key: string) => ask(cmd.requestSetup(ctx, key));
  /** The entries the group and its filters leave, in order (the one in force first when they leave it out). */
  const listed = () => {
    const u = ui.get();
    const s = store.get();
    const preset = presetRefOf(s.studio);
    if (u.lightGroup === 'LIGHTS' && u.lightStyle === 'MINE') return { kind: 'MINE' as const };
    const chosen = u.lightGroup === 'SETS' ? u.lightFilters : { style: u.lightStyle === 'ALL' ? undefined : u.lightStyle };
    return { kind: 'CATALOGUE' as const, ...filterSetups(u.lightGroup, chosen, preset, s.studio.lightSetup) };
  };
  const step = (dir: 1 | -1) => {
    const l = listed();
    const list = l.kind === 'MINE' ? itemsOf(ui.get().library, 'lightSetup').map((i) => ({ key: libraryKey(i.id) })) : l.shown;
    const cur = list.findIndex((x) => x.key === store.get().studio.lightSetup);
    const next = list[(cur + dir + list.length) % list.length];
    if (next) choose(next.key);
  };

  // The filter rows: drawn again when the group changes; the chips pressed follow the choice.
  let rows: ChipRows | null = null;
  scope.watch(
    (_s, u) => u.lightGroup,
    (g) => {
      rows = filterChipRows(
        groupFilters(g).map((f) => ({ id: f.id, label: t(`light.filter.${f.id}` as StringKey), options: filterOptions(f) })),
        t('light.all'),
        (f, value) => {
          if (f.id === 'style') ui.set({ lightStyle: (value ?? 'ALL') as UiState['lightStyle'] });
          else {
            const next = { ...ui.get().lightFilters };
            if (value === null) delete next[f.id];
            else next[f.id] = value;
            ui.set({ lightFilters: next });
          }
        },
      );
      filtersEl.replaceChildren(...rows.rows);
    },
  );

  scope.watch(
    (s, u) => [u.lightGroup, u.lightStyle, u.lightFilters, u.thumbSize, s.studio.lightSetup, s.studio.preset, s.studio.customPreset, u.library.lightSetups],
    () => {
      const s = store.get();
      const u = ui.get();
      const active = s.studio.lightSetup;
      const l = listed();
      rows?.set(u.lightGroup === 'SETS' ? u.lightFilters : { style: u.lightStyle === 'ALL' ? undefined : u.lightStyle });
      if (l.kind === 'MINE') {
        const own = itemsOf(u.library, 'lightSetup');
        grid.replaceChildren(...(own.length === 0 ? [mineEmpty()] : mineCards(ctx, own, mineSpec, mineConfirm)));
        countLine.textContent = '';
      } else {
        const small = u.thumbSize === 'S';
        const card = (st: LightSetup, outside = false) => {
          const tip = setupTip(st);
          const el = thumb({ src: setupThumb(st.key), caption: lbl(st.label), active: st.key === active, title: outside ? `${t('light.outside')} · ${tip}` : small ? `${lbl(st.label)} · ${tip}` : tip, onClick: () => choose(st.key) });
          el.setAttribute('aria-label', lbl(st.label));
          el.setAttribute('data-setup', st.key);
          if (outside) el.classList.add('is-outside');
          return el;
        };
        const cards = [...(l.kept ? [card(l.kept, true)] : []), ...l.shown.map((st) => card(st))];
        const noun = u.lightGroup === 'SETS' ? 'Sets' : 'Lights';
        countLine.textContent =
          l.count === 0 ? t(`light.none${noun}` as StringKey) : l.count === l.total ? t(`light.count${noun}` as StringKey, { n: l.total }) : t(`light.countOf${noun}` as StringKey, { n: l.count, total: l.total });
        grid.replaceChildren(
          ...(cards.length > 0 ? [h('div', { class: `thumbs cols-${THUMB_COLUMNS[u.thumbSize]}`, 'data-size': u.thumbSize, 'data-group': u.lightGroup }, ...cards)] : []),
        );
      }
      mineFoot.style.display = l.kind === 'MINE' ? '' : 'none';
      const setup = lightSetup(active);
      const own = s.studio.customSetup && s.studio.customSetup.key === active ? s.studio.customSetup : null;
      intent.replaceChildren(h('span', { class: 'aux' }, `${t('light.intent')} · `), setup ? lbl(setup.intent) : own ? t('library.ownSetup', { n: own.lights.length }) : '');
    },
    shallowEq,
  );

  // The size of the thumbnails, at the right of the section's header: small, medium, large, round again.
  const sizeBtn = h('button', { type: 'button', class: 'icon-btn', 'data-action': 'light.thumbSize' }) as HTMLButtonElement;
  sizeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    ui.set({ thumbSize: NEXT_SIZE[ui.get().thumbSize] });
  });
  scope.watch(
    (_s, u) => u.thumbSize,
    (size) => {
      sizeBtn.replaceChildren(icon(size === 'S' ? 'thumbsS' : size === 'L' ? 'thumbsL' : 'thumbsM', 14));
      const text = t('light.thumbSize', { size: t(`light.thumbSize.${size}` as StringKey), next: t(`light.thumbSize.${NEXT_SIZE[size]}` as StringKey) });
      sizeBtn.setAttribute('aria-label', text);
      sizeBtn.setAttribute('data-tip', text);
      sizeBtn.setAttribute('data-size', size);
    },
  );

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
  // Save light setup as…: the rig as it is now goes to Mine; on another product type it keeps that type's exposure.
  const saveHost = h('div');
  const saveSetup = h(
    'button',
    { type: 'button', class: 'btn btn-block', 'data-tip': t('light.saveSetupAux'), onclick: () => namePrompt(saveHost, { label: t('light.saveSetup'), initial: cmd.suggestSetupName(ctx), onSave: (name) => void cmd.saveSetupToLibrary(ctx, name) }) },
    icon('plus', 14),
    t('light.saveSetup'),
  ) as HTMLButtonElement;
  scope.watch((s) => s.studio.lights.some((l) => l.enabled), (on) => (saveSetup.disabled = !on));
  const body = h('div', { class: 'stack' }, group.el, filtersEl, countLine, confirmHost, grid, mineConfirm, mineFoot, intent, nav, setBlock(ctx, scope), saveSetup, saveHost, tuneHead, tuneBody);
  return section(ctx, 'light', t('section.light'), body, sizeBtn);
}

// --- Environment ---------------------------------------------------------------------

function envSection(ctx: Ctx, scope: Scope): HTMLElement {
  const { store } = ctx;
  const e0 = store.get().environment;
  const set = (patch: Partial<EnvironmentState>, what: StringKey, gesture?: string) =>
    store.dispatch({ type: 'env/set', patch, gesture, label: cmd.editLabel('env', what) });
  const kind = select(
    (['STUDIO', 'SKY', 'FLAT', 'HDRI'] as const).map((k) => ({ value: k, label: t(dyn(`env.kind.${k}`)) })),
    e0.kind,
    (v) => set({ kind: v as EnvironmentState['kind'] }, 'env.kind'),
    t('env.kind'),
  );
  const strength = slider({ value: e0.strength, min: 0, max: 3, step: 0.01, ariaLabel: t('env.strength'), onChange: (v, g) => set({ strength: v }, 'env.strength', g) });
  const rotation = slider({ value: e0.rotationDeg, min: -180, max: 180, step: 1, unit: '°', ariaLabel: t('env.rotation'), onChange: (v, g) => set({ rotationDeg: v }, 'env.rotation', g) });
  const rotationRow = field(t('env.rotation'), rotation.el);

  // HDRI: the file and its button.
  const hdriInfo = h('p', { class: 'note', style: 'margin:0;overflow-wrap:anywhere' });
  const hdriRow = h(
    'div',
    { class: 'stack' },
    h('button', { type: 'button', class: 'btn btn-block', onclick: () => void cmd.loadEnvironmentHdri(ctx) }, icon('plus', 14), t('env.loadHdri')),
    hdriInfo,
  );

  // Sky: its model, haze, and the sun when the setup has no sun light.
  const skyModel = segmented(
    (['PHYSICAL', 'CLASSIC'] as const).map((m) => ({ value: m, label: t(dyn(`env.skyModel.${m}`)), title: t(dyn(`env.skyModel.tip.${m}`)) })),
    e0.skyModel,
    (v) => set({ skyModel: v }, 'env.skyModel'),
    { full: true, ariaLabel: t('env.skyModel') },
  );
  // The physical sky covers turbidity 1 to 10; the classic one starts at 1.7 (it clamps lower values there).
  const turbidity = slider({ value: e0.skyTurbidity, min: 1, max: 10, step: 0.1, digits: 1, ariaLabel: t('env.turbidity'), onChange: (v, g) => set({ skyTurbidity: v }, 'env.turbidity', g) });
  const sunAz = slider({ value: e0.skySun.az, min: -180, max: 180, step: 1, unit: '°', ariaLabel: t('env.sunAz'), onChange: (v, g) => set({ skySun: { ...store.get().environment.skySun, az: v } }, 'env.sunAz', g) });
  const sunEl = slider({ value: e0.skySun.el, min: 1, max: 90, step: 1, unit: '°', ariaLabel: t('env.sunEl'), onChange: (v, g) => set({ skySun: { ...store.get().environment.skySun, el: v } }, 'env.sunEl', g) });
  const sunOwn = h('div', { class: 'stack' }, field(t('env.sunAz'), sunAz.el), field(t('env.sunEl'), sunEl.el));
  const sunNote = h('p', { class: 'note', style: 'margin:0' }, t('env.sunFromLight'));
  const skyBox = h('div', { class: 'stack' }, field(t('env.skyModel'), skyModel.el), field(t('env.turbidity'), turbidity.el), sunOwn, sunNote);

  const bg = segmented(
    (['ENVIRONMENT', 'COLOR', 'GRADIENT', 'TRANSPARENT', 'BACKPLATE'] as const).map((b) => ({ value: b, label: t(dyn(`env.bg.${b}`)) })),
    e0.background,
    (v) => set({ background: v }, 'env.background'),
    { ariaLabel: t('env.background') },
  );
  bg.el.style.flexWrap = 'wrap';
  // Background image: the file, its button and how it fits the frame.
  const plateInfo = h('p', { class: 'note', style: 'margin:0;overflow-wrap:anywhere' });
  const fit = segmented(
    (['FILL', 'FIT', 'STRETCH'] as const).map((f) => ({ value: f, label: t(dyn(`env.fit.${f}`)) })),
    e0.backplateFit,
    (v) => set({ backplateFit: v }, 'env.fit'),
    { full: true, ariaLabel: t('env.fit') },
  );
  const plateBox = h(
    'div',
    { class: 'stack' },
    h('button', { type: 'button', class: 'btn btn-block', onclick: () => void cmd.loadBackplateImage(ctx) }, icon('plus', 14), t('env.loadPlate')),
    plateInfo,
    field(t('env.fit'), fit.el),
  );
  const color = colorField(e0.color, (rgb, g) => set({ color: [rgb[0], rgb[1], rgb[2], 1] }, 'env.color', g), t('env.color'));
  const colorRow = field(t('env.color'), color.el);
  // L6: the two colours of a gradient background, top and bottom of the frame.
  const gradTop = colorField(e0.gradient.top, (rgb, g) => set({ gradient: { ...store.get().environment.gradient, top: [rgb[0], rgb[1], rgb[2]] } }, 'env.gradientTop', g), t('env.gradientTop'));
  const gradBottom = colorField(e0.gradient.bottom, (rgb, g) => set({ gradient: { ...store.get().environment.gradient, bottom: [rgb[0], rgb[1], rgb[2]] } }, 'env.gradientBottom', g), t('env.gradientBottom'));
  const gradBox = h('div', { class: 'stack' }, field(t('env.gradientTop'), gradTop.el), field(t('env.gradientBottom'), gradBottom.el));
  const shadow = slider({ value: e0.groundShadow, min: 0, max: 1, step: 0.01, ariaLabel: t('env.groundShadow'), onChange: (v, g) => set({ groundShadow: v }, 'env.groundShadow', g) });
  const refl = slider({ value: e0.groundReflection, min: 0, max: 1, step: 0.01, ariaLabel: t('env.groundReflection'), onChange: (v, g) => set({ groundReflection: v }, 'env.groundReflection', g) });
  const show = (el: HTMLElement, on: boolean) => (el.style.display = on ? '' : 'none');
  const imageInfo = (ref: EnvironmentState['hdri'], none: StringKey) =>
    ref ? t('env.imageInfo', { name: ref.name, width: ref.width, height: ref.height }) : t(none);
  scope.watch(
    (s) => s.environment,
    (e) => {
      kind.set(e.kind);
      strength.set(e.strength);
      rotation.set(e.rotationDeg);
      bg.set(e.background);
      color.set(e.color);
      // The sky is placed by its sun, not turned.
      show(rotationRow, e.kind !== 'SKY');
      show(hdriRow, e.kind === 'HDRI');
      hdriInfo.textContent = imageInfo(e.hdri, 'env.noHdri');
      hdriInfo.title = e.hdri?.name ?? '';
      show(skyBox, e.kind === 'SKY');
      skyModel.set(e.skyModel);
      turbidity.set(e.skyTurbidity);
      sunAz.set(e.skySun.az);
      sunEl.set(e.skySun.el);
      show(plateBox, e.background === 'BACKPLATE');
      show(gradBox, e.background === 'GRADIENT');
      gradTop.set(e.gradient.top);
      gradBottom.set(e.gradient.bottom);
      plateInfo.textContent = imageInfo(e.backplate, 'env.noPlate');
      plateInfo.title = e.backplate?.name ?? '';
      fit.set(e.backplateFit);
      // The colour is the background's, FLAT's, and what shows around (or instead of) a background image.
      show(colorRow, e.background === 'COLOR' || e.background === 'BACKPLATE' || e.kind === 'FLAT');
      shadow.set(e.groundShadow);
      refl.set(e.groundReflection);
    },
  );
  // The sky's sun is the setup's sun light when there is one.
  scope.watch(
    (s) => s.studio.lights.some((l) => l.type === 'SUN' && l.enabled && l.power > 0),
    (fromLight) => {
      show(sunOwn, !fromLight);
      show(sunNote, fromLight);
    },
  );
  const body = h(
    'div',
    { class: 'stack' },
    field(t('env.kind'), kind.el),
    hdriRow,
    skyBox,
    field(t('env.strength'), strength.el),
    rotationRow,
    h('div', { class: 'field-label', style: 'margin-top:4px' }, t('env.background')),
    bg.el,
    plateBox,
    gradBox,
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
  const focus = lengthField({ value: cam0.focusDistance, min: 1, max: 1e6, step: 1, ariaLabel: t('camera.focus'), onChange: (v, g) => set({ focusDistance: v }, 'camera.focus', g) });
  const focusBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('camera.focusClick'), 'data-tip': t('camera.focusClick'), onclick: () => ui.set({ pickMode: ui.get().pickMode?.kind === 'focus' ? null : { kind: 'focus' } }) }, icon('focus'));
  scope.watch((_s, u) => u.pickMode?.kind === 'focus', (on) => focusBtn.setAttribute('aria-pressed', String(on)));
  // K3: the four projections; the equirectangular panorama takes the 2:1 frame with it (one undo step).
  const proj = select(
    CAMERA_PROJECTIONS.map((p) => ({ value: p, label: t(dyn(`camera.projection.${p}`)) })),
    cam0.projection,
    (v) => {
      const projection = v as CameraProjection;
      set({ projection, ...(projection === 'EQUIRECTANGULAR' ? { aspect: { preset: '2:1', w: 2, h: 1 } } : {}) }, dyn(`camera.projection.${projection}`));
    },
    t('camera.projection'),
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
  const interior = interiorCameraFields(ctx, scope, camId);
  return h(
    'div',
    { class: 'stack', 'data-guide': 'camera' },
    field(t('camera.lens'), lens.el),
    field(t('camera.focal'), focal.el),
    field(t('camera.fstop'), fstop.el),
    field(t('camera.focus'), focus.el, focusBtn),
    h('div', { class: 'note' }, t('camera.dofNote')),
    field(t('camera.projection'), proj.el),
    interior,
    aspectRows(ctx, scope, camId),
    opticsFields(ctx, scope, camId),
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

/**
 * K3 (INTERIORS.md §3.4): the interior camera's fields under the projection: the fisheye's field, the straight verticals
 * (perspective and the equirectangular panorama), the eye height with its presets and the interior lenses. Every change
 * is one undo step.
 */
function interiorCameraFields(ctx: Ctx, scope: Scope, camId: () => CameraId): HTMLElement {
  const { store } = ctx;
  const camOf = () => store.get().camera.cameras[camId()] ?? activeCamera(store.get());
  const c0 = camOf();
  const set = (patch: Partial<CameraState>, what: StringKey, gesture?: string) =>
    store.dispatch({ type: 'camera/set', id: camId(), patch, gesture, label: cmd.editLabel('camera', what) });
  const fov = numberField({ value: fisheyeFov(c0), min: FISHEYE_FOV_MIN, max: FISHEYE_FOV_MAX, step: 1, digits: 0, unit: '°', ariaLabel: t('camera.fisheyeFov'), onChange: (v, g) => set({ fisheyeFovDeg: v }, 'camera.fisheyeFov', g) });
  const fovRow = h('div', { class: 'stack' }, field(t('camera.fisheyeFov'), fov.el), h('div', { class: 'note' }, t('camera.fisheyeFovAux')), h('div', { class: 'note' }, t('camera.fisheyeNote')));
  const panoNote = h('div', { class: 'note' }, t('camera.panoramaNote'));
  const verticals = toggle(c0.straightVerticals === true, (v) => set({ straightVerticals: v }, 'camera.verticals'), t('camera.verticals'));
  verticals.el.setAttribute('data-tip', t('camera.verticalsAux', { max: VERTICALS_MAX_TILT_DEG }));
  const verticalsNote = h('div', { class: 'note', 'data-verticals': '' });
  const verticalsRow = h('div', { class: 'stack' }, field(t('camera.verticals'), verticals.el), verticalsNote);
  const eye = lengthField({ value: eyeHeightOf(c0), min: 1, max: 1e6, step: 10, ariaLabel: t('camera.eyeHeight'), onChange: (v, g) => store.dispatch({ type: 'camera/eyeHeight', id: camId(), heightMm: v, gesture: g, label: cmd.editLabel('camera', 'camera.eyeHeight') }) });
  eye.el.setAttribute('data-tip', t('camera.eyeHeightAux'));
  const eyePresets = h(
    'div',
    { class: 'chips' },
    ...EYE_HEIGHT_PRESETS.map((p) =>
      h('button', { type: 'button', class: 'chip', 'data-eye': p.key, onclick: () => store.dispatch({ type: 'camera/eyeHeight', id: camId(), heightMm: p.heightMm, label: L('undo.eyeHeight', { name: p.label }) }) }, `${lbl(p.label)} · ${formatNumber(p.heightMm / 1000, getLang(), 1)} m`),
    ),
  );
  const eyeRow = h('div', { class: 'stack' }, field(t('camera.eyeHeight'), eye.el), eyePresets);
  const lenses = h(
    'div',
    { class: 'chips', role: 'group', 'aria-label': t('camera.interiorLenses') },
    ...INTERIOR_LENSES.map((l) =>
      h('button', { type: 'button', class: 'chip', 'data-lens': l.key, onclick: () => store.dispatch({ type: 'camera/interiorLens', id: camId(), key: l.key, label: L('undo.lens', { name: `${l.focalMm} mm` }) }) }, t('camera.interiorLensAux', { focal: l.focalMm })),
    ),
  );
  const lensRow = h('div', { class: 'stack' }, h('div', { class: 'field-label' }, t('camera.interiorLenses')), lenses);
  scope.watch(
    (s) => s.camera.cameras[camId()],
    (c) => {
      if (!c) return;
      fov.set(fisheyeFov(c));
      verticals.set(c.straightVerticals === true);
      eye.set(Math.round(eyeHeightOf(c)));
      const perspective = c.projection === 'PERSPECTIVE';
      fovRow.style.display = c.projection === 'FISHEYE' ? '' : 'none';
      panoNote.style.display = c.projection === 'EQUIRECTANGULAR' ? '' : 'none';
      verticalsRow.style.display = perspective || c.projection === 'EQUIRECTANGULAR' ? '' : 'none';
      lensRow.style.display = perspective ? '' : 'none';
      eyeRow.style.display = c.projection === 'ORTHOGRAPHIC' ? 'none' : '';
      for (const b of lenses.children) (b as HTMLElement).setAttribute('aria-pressed', String(INTERIOR_LENSES.find((l) => l.key === (b as HTMLElement).dataset.lens)?.focalMm === c.focalMm));
      // What the straight verticals do now: the shift for the tilt, from the camera's numbers (rule 10).
      const v = verticalsOf(c);
      verticalsNote.style.display = c.straightVerticals ? '' : 'none';
      verticalsNote.textContent = !v ? t('camera.verticalsLevel') : c.projection === 'EQUIRECTANGULAR' ? t('camera.verticalsPano') : t('camera.verticalsShift', { mm: formatNumber(v.shiftYMm, getLang(), 1), deg: formatNumber(v.correctedDeg, getLang(), 1) });
    },
  );
  return h('div', { class: 'stack', 'data-guide': 'interior-camera' }, fovRow, panoNote, verticalsRow, eyeRow, lensRow);
}

function cameraSection(ctx: Ctx, scope: Scope): HTMLElement {
  const { store } = ctx;
  // The title says which camera these fields edit (the active one, by name): every camera has its own lens and
  // placement. The pencil opens that camera's own inspector (name, Activate, Look through).
  const title = h('span', null, t('section.camera'));
  const who = h('span', { class: 'aux', 'data-camera-title': '' });
  const pencil = h('button', { type: 'button', class: 'icon-btn', 'data-action': 'camera.edit' }, icon('edit', 14));
  pencil.addEventListener('click', (e) => {
    e.stopPropagation();
    cmd.editCamera(ctx, store.get().camera.active);
  });
  const note = h('div', { class: 'note' });
  scope.watch(
    (s) => [s.camera.active, cameraName(s, activeCamera(s))] as const,
    ([, name]) => {
      who.textContent = name;
      pencil.setAttribute('aria-label', t('cameras.edit', { name }));
      pencil.setAttribute('data-tip', t('cameras.edit', { name }));
      note.textContent = t('camera.editingNote', { name });
    },
    (a, b) => a[0] === b[0] && a[1] === b[1],
  );
  const body = h('div', { class: 'stack' }, note, cameraFields(ctx, scope, () => store.get().camera.active));
  return section(ctx, 'camera', title, body, h('span', { class: 'row', style: 'gap:6px;align-items:center' }, who, pencil));
}

// --- Image ------------------------------------------------------------------------------

function imageSection(ctx: Ctx, scope: Scope): HTMLElement {
  const { store } = ctx;
  const i0 = store.get().image;
  const set = (patch: Partial<ImageState>, what: StringKey, gesture?: string) =>
    store.dispatch({ type: 'image/set', patch, gesture, label: cmd.editLabel('image', what) });
  const exposure = slider({ value: i0.exposureEv, min: -5, max: 5, step: 0.05, unit: 'EV', ariaLabel: t('image.exposure'), onChange: (v, g) => set({ exposureEv: v }, 'image.exposure', g) });
  // K3: the exposure pass, by hand or metered from the image (the dial is then its compensation), its presets and the
  // exterior factor of the camera ray (environment.exterior: it reaches the render, not only the image).
  const mode = segmented(
    (['MANUAL', 'AUTO'] as const).map((v) => ({ value: v, label: t(dyn(`image.exposure${v}`)) })),
    autoExposure(i0) ? 'AUTO' : 'MANUAL',
    (v) => set(v === 'AUTO' ? { exposureMode: 'AUTO', exposureEv: 0 } : { exposureMode: undefined }, 'image.exposureMode'),
    { full: true, ariaLabel: t('image.exposureMode') },
  );
  const exposureLabel = h('div', { class: 'field-label' }, t('image.exposure'));
  const metered = h('div', { class: 'note', 'data-metered': '' });
  const presets = h(
    'div',
    { class: 'chips', role: 'group', 'aria-label': t('image.presets') },
    ...EXPOSURE_PRESETS.map((p) =>
      h(
        'button',
        { type: 'button', class: 'chip', 'data-exposure-preset': p.key, 'data-tip': t('image.presetAux', { ev: p.ev100 }), onclick: () => store.dispatch({ type: 'image/set', patch: { exposureMode: undefined, exposureEv: presetExposure(p.key) ?? 0 }, label: L('undo.exposurePreset', { name: p.label }) }) },
        t('image.preset', { name: lbl(p.label), ev: p.ev100 }),
      ),
    ),
  );
  const exterior = slider({
    value: exteriorOf(store.get().environment.exterior),
    min: EXTERIOR_MIN,
    max: EXTERIOR_MAX,
    step: 0.01,
    ariaLabel: t('image.exterior'),
    onChange: (v, g) => store.dispatch({ type: 'env/set', patch: { exterior: v >= EXTERIOR_MAX ? undefined : v }, gesture: g, label: cmd.editLabel('image', 'image.exterior') }),
  });
  exterior.el.setAttribute('data-tip', t('image.exteriorAux'));
  const port = ctx.services.viewport;
  const showMetered = () => {
    const img = store.get().image;
    metered.style.display = autoExposure(img) ? '' : 'none';
    if (!autoExposure(img)) return;
    const ev = port ? port.status().meteredEv : undefined;
    metered.textContent = typeof ev === 'number' ? t('image.metered', { ev: `${ev >= 0 ? '+' : ''}${formatNumber(ev, getLang(), 2)}` }) : t('image.meteredNone');
  };
  if (port) {
    let last = 0;
    scope.onDispose(
      port.onFrame(() => {
        const now = performance.now();
        if (now - last < 500) return;
        last = now;
        showMetered();
      }),
    );
  }
  scope.watch(
    (s) => s.environment.exterior,
    (k) => exterior.set(exteriorOf(k)),
  );
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
      mode.set(autoExposure(img) ? 'AUTO' : 'MANUAL');
      exposureLabel.textContent = autoExposure(img) ? t('image.brightness') : t('image.exposure');
      exposureLabel.setAttribute('data-tip', autoExposure(img) ? t('image.brightnessAux') : '');
      showMetered();
      vt.set(img.viewTransform);
      for (const p of post) p.ctrl.set(img[p.k]);
    },
  );
  const body = h(
    'div',
    { class: 'stack' },
    field(t('image.exposureMode'), mode.el),
    exposureLabel,
    exposure.el,
    metered,
    h('div', { class: 'field-label' }, t('image.presets')),
    presets,
    field(t('image.exterior'), exterior.el),
    field(t('image.viewTransform'), vt.el),
    ...post.map((p) => field(t(dyn(`image.${p.k}`)), p.ctrl.el)),
    h('div', { class: 'note' }, t('image.postSoon')),
  );
  return section(ctx, 'image', t('section.image'), body);
}

export function sceneInspector(ctx: Ctx, scope: Scope): HTMLElement {
  return h('div', null, productSection(ctx, scope), lightSection(ctx, scope), envSection(ctx, scope), ambientSection(ctx, scope), sectionSection(ctx, scope), cameraSection(ctx, scope), imageSection(ctx, scope));
}

export { confirmBox, formatNumber, setupLabel };
