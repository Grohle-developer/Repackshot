// Inspector for a selection of parts (Material, Wear, Part), for faces, for
// one light and for one camera (UI.md §2.4).

import { MATERIAL_CATEGORIES, MATERIAL_PRESETS } from '../../data/materials';
import { WEAR_LEVELS, WEAR_PRESETS, WEAR_TYPES } from '../../data/wear';
import { LIGHT_SHAPES } from '../../data/light-setups';
import type { LightRole, MaterialCategory, WearProps, WearType } from '../../data/types';
import { instanceFromPreset, partMaterials, triangleMaterials, visibleParams, wearTypesFor, type MaterialId, type MaterialInstance, type ParamSpec } from '../../core/materials';
import { partsUnder, type NodeId } from '../../core/scene';
import type { ProjectState } from '../../core/store';
import type { LightInstance } from '../../core/lighting';
import * as cmd from '../commands';
import { colorField, field, numberField, segmented, select, slider, textField, toggle, type Control } from '../components/controls';
import { section } from '../components/section';
import { setThumbImage, showConfirmIn, thumb } from '../components/widgets';
import { h, icon } from '../dom';
import { cameraName, dyn, lightName, materialLabel, materialName, targetLabel } from '../names';
import { dynamic, shallowEq, type Ctx, type Scope } from '../reactive';
import { L, lbl, t } from '../strings';
import { normalize } from '../components/palette';
import { cameraFields } from './insp-scene';

// --- What the selection carries ---------------------------------------------------

/** Material ids the target (parts, or selected faces) carries, in order. */
function targetMaterials(s: ProjectState, ids: readonly NodeId[], faces: boolean): MaterialId[] {
  const out: MaterialId[] = [];
  if (faces && s.selection.faces) {
    const node = s.scene.nodes[s.selection.faces.part];
    if (node) {
      const per = triangleMaterials(node);
      for (const i of s.selection.faces.indices) {
        const m = per[i];
        if (m && !out.includes(m)) out.push(m);
      }
    }
    return out;
  }
  for (const p of partsUnder(s, ids)) for (const m of partMaterials(s.scene.nodes[p])) if (!out.includes(m)) out.push(m);
  return out;
}

/** Cache key of a material sphere: presets by key, edited instances by content. */
export function thumbKey(mat: MaterialInstance): string {
  if (mat.preset && !mat.edited && mat.role !== 'DEFAULT') return `preset:${mat.preset}`;
  const text = JSON.stringify([mat.family, mat.params]);
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return `inst:${(hash >>> 0).toString(36)}`;
}

function sphere(ctx: Ctx, mat: MaterialInstance, size = 64): HTMLElement {
  const ph = h('div', { class: 'mat-sphere', style: `width:${size}px;height:${size}px` });
  const port = ctx.services.viewport;
  if (port) {
    void port.materialThumbnail(mat, thumbKey(mat)).then((url) => {
      if (url) ph.replaceWith(h('img', { class: 'mat-sphere', src: url, alt: '', width: size, height: size }));
    });
  }
  return ph;
}

// --- Material ----------------------------------------------------------------------

function catalog(ctx: Ctx, scope: Scope, ids: NodeId[], faces: boolean, confirmHost: HTMLElement): HTMLElement {
  const { store, ui } = ctx;
  const chips = h('div', { class: 'chips', role: 'tablist' });
  const filter = h('input', { type: 'search', class: 'text-input', placeholder: t('material.filter'), 'aria-label': t('material.filter'), value: ui.get().materialFilter }) as HTMLInputElement;
  filter.addEventListener('input', () => ui.set({ materialFilter: filter.value }));
  filter.addEventListener('keydown', (e) => e.stopPropagation());
  const grid = h('div', { class: 'thumbs cols-4' });
  scope.watch(
    (_s, u) => u.materialCategory,
    (cat) =>
      chips.replaceChildren(
        ...MATERIAL_CATEGORIES.map((c) => h('button', { type: 'button', class: 'chip', role: 'tab', 'aria-pressed': String(c.key === cat), onclick: () => ui.set({ materialCategory: c.key as MaterialCategory }) }, lbl(c.label))),
        h('button', { type: 'button', class: 'chip', disabled: true, 'data-tip': t('catalog.mineSoon') }, t('catalog.mine')),
      ),
  );
  scope.watch(
    (s, u) => [u.materialCategory, u.materialFilter, s.materials, s.scene.nodes, s.selection],
    () => {
      const s = store.get();
      const u = ui.get();
      const mats = targetMaterials(s, ids, faces);
      const activeKeys = new Set(mats.map((m) => s.materials[m]).filter((m) => m && !m.edited && m.role !== 'DEFAULT').map((m) => m!.preset));
      const q = normalize(u.materialFilter);
      const list = q
        ? MATERIAL_PRESETS.filter((p) => normalize(p.label.en).includes(q) || normalize(p.label.es).includes(q))
        : MATERIAL_PRESETS.filter((p) => p.category === u.materialCategory);
      if (list.length === 0) {
        grid.replaceChildren(h('p', { class: 'note', style: 'grid-column:1/-1' }, t('material.noMatch')));
        return;
      }
      grid.replaceChildren(
        ...list.map((p) => {
          const el = thumb({
            src: null,
            sphere: true,
            caption: lbl(p.label),
            active: activeKeys.has(p.key),
            title: t('material.dragHint'),
            drag: `preset:${p.key}`,
            onClick: () => {
              const spec = cmd.requestAssign(ctx, { preset: p.key });
              if (spec) showConfirmIn(confirmHost, spec);
            },
          });
          const inst = instanceFromPreset('thumb', p.key, 100)!;
          void ctx.services.viewport?.materialThumbnail(inst, `preset:${p.key}`).then((url) => url && setThumbImage(el, url));
          return el;
        }),
      );
    },
    shallowEq,
  );
  return h('div', { class: 'catalog', 'data-guide': 'material' }, chips, filter, grid);
}

function paramControl(ctx: Ctx, scope: Scope, matId: MaterialId, spec: ParamSpec): HTMLElement {
  const { store } = ctx;
  const mat0 = store.get().materials[matId];
  const label = (g?: string) => ({ label: L('undo.param', { material: materialLabel(store.get().materials[matId]), param: L(dyn(`param.${spec.key}`)) }), gesture: g });
  const setv = (value: unknown, g?: string) => store.dispatch({ type: 'material/setParam', id: matId, key: spec.key, value, ...label(g) });
  const cur = (m: MaterialInstance | undefined) => (m ? (m.params[spec.key] ?? spec.fallback) : spec.fallback);
  let ctrl: Control<never>;
  if (spec.kind === 'color') {
    const c = colorField(cur(mat0) as number[], (rgb, g) => {
      const prev = cur(store.get().materials[matId]) as number[];
      setv([rgb[0], rgb[1], rgb[2], prev[3] ?? 1], g);
    }, t(dyn(`param.${spec.key}`)));
    ctrl = c as Control<never>;
  } else if (spec.kind === 'select') {
    const opts = (spec.options ?? []).map((o) => ({ value: o, label: t(dyn(`${spec.key === 'weave' ? 'weave' : 'emitKind'}.${o}`)) }));
    ctrl = select(opts, String(cur(mat0)), (v) => setv(v), t(dyn(`param.${spec.key}`))) as Control<never>;
  } else if (spec.min !== undefined && spec.max !== undefined && spec.max <= 2.5) {
    ctrl = slider({ value: Number(cur(mat0)), min: spec.min, max: spec.max, step: spec.step ?? 0.01, unit: spec.unit, ariaLabel: t(dyn(`param.${spec.key}`)), onChange: (v, g) => setv(v, g) }) as Control<never>;
  } else {
    ctrl = numberField({ value: Number(cur(mat0)), min: spec.min, max: spec.max, step: spec.step ?? 1, unit: spec.unit, ariaLabel: t(dyn(`param.${spec.key}`)), onChange: (v, g) => setv(v, g) }) as Control<never>;
  }
  scope.watch((s) => cur(s.materials[matId]), (v) => (ctrl.set as (x: unknown) => void)(v));
  const row = field(t(dyn(`param.${spec.key}`)) + (spec.preview ? '' : ' ·'), ctrl.el);
  if (!spec.preview) row.setAttribute('data-tip', t('material.notDrawn'));
  return row;
}

function materialSection(ctx: Ctx, scope: Scope, ids: NodeId[], faces: boolean): HTMLElement {
  const { store, ui } = ctx;
  const confirmHost = h('div');
  const body = dynamic(
    scope,
    (s, u) => {
      const mats = targetMaterials(s, ids, faces);
      const m = mats.length === 1 ? s.materials[mats[0]] : undefined;
      const p = m ? visibleParams(m).map((x) => x.key).join(',') : '';
      // Not keyed on name / preset / edited: editing a value must not rebuild under the pointer.
      return `${mats.join(',')}|${m?.family ?? ''}|${p}|${u.catalogOpen}`;
    },
    (sc) => {
      const s = store.get();
      const mats = targetMaterials(s, ids, faces);
      const mat = mats.length === 1 ? s.materials[mats[0]] : undefined;
      const open = ui.get().catalogOpen || mats.length === 0;
      const nameEl = h('div', { class: 'mat-name' }, mats.length > 1 ? t('material.mixed', { n: mats.length }) : t('material.none'));
      if (mat) sc.watch((st) => st.materials[mat.id], (m) => m && (nameEl.textContent = materialName(m)));
      const changeBtn = h('button', { type: 'button', class: 'btn', 'aria-expanded': String(open), onclick: () => ui.set({ catalogOpen: !ui.get().catalogOpen, ...(mat ? { materialCategory: mat.category } : {}) }) }, open ? t('material.closeCatalog') : t('material.change'));
      const sphereHost = h('div', null, mat ? sphere(ctx, mat) : h('div', { class: 'mat-sphere' }));
      if (mat) {
        // The sphere follows edits, re-rendered once the value settles.
        let timer = 0;
        let first = true;
        sc.watch(
          (st) => st.materials[mat.id],
          (m) => {
            if (first || !m) {
              first = false;
              return;
            }
            window.clearTimeout(timer);
            timer = window.setTimeout(() => sphereHost.replaceChildren(sphere(ctx, m)), 350);
          },
        );
        sc.onDispose(() => window.clearTimeout(timer));
      }
      const card = h(
        'div',
        { class: 'mat-card' },
        sphereHost,
        h(
          'div',
          { class: 'stack', style: 'gap:4px;min-width:0' },
          nameEl,
          mat ? h('div', { class: 'aux' }, `${lbl(MATERIAL_CATEGORIES.find((c) => c.key === mat.category)!.label)} · ${t(dyn(`family.${mat.family}`))}`) : h('div', { class: 'note' }, mats.length > 1 ? t('material.mixedAux') : ''),
          h('div', null, changeBtn),
        ),
      );
      const parts: (HTMLElement | null)[] = [card, confirmHost, open ? catalog(ctx, sc, ids, faces, confirmHost) : null];
      if (mat) {
        parts.push(h('div', { class: 'subhead' }, t('material.params')));
        for (const spec of visibleParams(mat)) parts.push(paramControl(ctx, sc, mat.id, spec));
        if (mat.family === 'WOOD' || mat.family === 'FABRIC') parts.push(h('div', { class: 'note' }, t('material.flatNote')));
        const mine = partsUnder(s, faces && s.selection.faces ? [s.selection.faces.part] : ids);
        const own = h('button', { type: 'button', class: 'btn', 'data-tip': t('material.makeOwnAux'), onclick: () => store.dispatch({ type: 'material/detach', id: mat.id, parts: mine, label: L('undo.makeOwn', { material: materialLabel(store.get().materials[mat.id]) }) }) }, t('material.makeOwn'));
        // Shown while the material is linked to the catalogue or shared beyond the selection.
        sc.watch(
          (st) => [st.materials[mat.id], st.scene.nodes] as const,
          ([m]) => {
            const users = Object.values(store.get().scene.nodes).filter((n) => partMaterials(n).includes(mat.id)).map((n) => n.id);
            own.style.display = m && (m.preset !== null || users.some((u) => !mine.includes(u))) ? '' : 'none';
          },
          (a, b) => a[0] === b[0] && a[1] === b[1],
        );
        parts.push(own);
      }
      return h('div', { class: 'stack' }, ...parts);
    },
  );
  return section(ctx, 'material', t('section.material'), body);
}

// --- Wear --------------------------------------------------------------------------

const WEAR_KNOBS: Partial<Record<WearType, { key: keyof WearProps; kind: 'num' | 'color'; label: string }[]>> = {
  edges: [
    { key: 'edgeWidth', kind: 'num', label: 'wear.edgeWidth' },
    { key: 'edgeColor', kind: 'color', label: 'wear.edgeColor' },
  ],
  scratches: [
    { key: 'scratchScale', kind: 'num', label: 'wear.scratchScale' },
    { key: 'scratchDepth', kind: 'num', label: 'wear.scratchDepth' },
  ],
  smudges: [{ key: 'smudgeScale', kind: 'num', label: 'wear.smudgeScale' }],
  dust: [{ key: 'dustColor', kind: 'color', label: 'wear.dustColor' }],
  dirt: [{ key: 'dirtColor', kind: 'color', label: 'wear.dirtColor' }],
  patina: [
    { key: 'patinaColor', kind: 'color', label: 'wear.patinaColor' },
    { key: 'patinaScale', kind: 'num', label: 'wear.patinaScale' },
  ],
  roughVar: [{ key: 'roughScale', kind: 'num', label: 'wear.roughScale' }],
  dents: [{ key: 'dentScale', kind: 'num', label: 'wear.dentScale' }],
};

function wearSection(ctx: Ctx, scope: Scope, ids: NodeId[], faces: boolean): HTMLElement {
  const { store } = ctx;
  const body = dynamic(
    scope,
    (s) => {
      const mats = targetMaterials(s, ids, faces);
      return mats.length === 1 ? `${mats[0]}|${s.materials[mats[0]]?.family}` : 'none';
    },
    (sc, key) => {
      if (key === 'none') return h('p', { class: 'note' }, t('material.mixedAux'));
      const matId = key.split('|')[0];
      const mat = store.get().materials[matId];
      if (!mat) return null;
      if (mat.family === 'EMISSIVE') return h('p', { class: 'note' }, t('wear.none'));
      const label = () => L('undo.wear', { material: materialLabel(store.get().materials[matId]) });
      const set = (patch: Partial<WearProps>, g?: string) => store.dispatch({ type: 'material/setWear', id: matId, patch, gesture: g, label: label() });
      const wear = () => store.get().materials[matId]?.wear;
      const levels = segmented(
        WEAR_LEVELS.map((l) => ({ value: l.key, label: lbl(l.label) })),
        null,
        (k) => set({ amount: WEAR_LEVELS.find((l) => l.key === k)!.amount }),
        { full: true, ariaLabel: t('section.wear') },
      );
      const chips = h('div', { class: 'chips' });
      const master = slider({ value: mat.wear.amount, min: 0, max: 1, step: 0.01, ariaLabel: t('wear.master'), onChange: (v, g) => set({ amount: v }, g) });
      const types = wearTypesFor(mat.family).map((type) => {
        const info = WEAR_TYPES.find((w) => w.key === type)!;
        const ctrl = slider({ value: mat.wear[type], min: 0, max: 1, step: 0.01, ariaLabel: lbl(info.label), onChange: (v, g) => set({ [type]: v }, g) });
        const knobs = (WEAR_KNOBS[type] ?? []).map((k) => {
          if (k.kind === 'color') {
            const c = colorField(mat.wear[k.key] as unknown as readonly number[], (rgb, g) => set({ [k.key]: [rgb[0], rgb[1], rgb[2], 1] }, g), t(dyn(k.label)));
            sc.watch(() => wear()?.[k.key], (v) => v && c.set(v as unknown as readonly number[]));
            return field(t(dyn(k.label)), c.el);
          }
          const n = numberField({ value: mat.wear[k.key] as number, min: 0, max: 10, step: 0.01, digits: 3, ariaLabel: t(dyn(k.label)), onChange: (v, g) => set({ [k.key]: v }, g) });
          sc.watch(() => wear()?.[k.key], (v) => typeof v === 'number' && n.set(v));
          return field(t(dyn(k.label)), n.el);
        });
        const knobBox = h('div', { class: 'wear-knobs' }, ...knobs);
        sc.watch(
          () => wear()?.[type] ?? 0,
          (v) => {
            ctrl.set(v);
            knobBox.style.display = v > 0 && knobs.length ? '' : 'none';
          },
        );
        const row = field(lbl(info.label), ctrl.el);
        row.setAttribute('data-tip', lbl(info.description));
        return h('div', { class: 'wear-type' }, row, knobBox);
      });
      const scale = numberField({ value: mat.wear.scale, min: 0.01, max: 100, step: 0.05, digits: 2, ariaLabel: t('wear.scale'), onChange: (v, g) => set({ scale: v }, g) });
      const seed = numberField({ value: mat.wear.seed, min: 0, max: 9999, step: 1, ariaLabel: t('wear.seed'), onChange: (v, g) => set({ seed: Math.round(v) }, g) });
      const perObject = toggle(mat.wear.perObject, (v) => set({ perObject: v }), t('wear.perObject'));
      sc.watch(
        () => wear(),
        (w) => {
          if (!w) return;
          master.set(w.amount);
          scale.set(w.scale);
          seed.set(w.seed);
          perObject.set(w.perObject);
          const lvl = WEAR_LEVELS.find((l) => l.amount === w.amount)?.key ?? null;
          levels.set(lvl);
          chips.replaceChildren(
            ...WEAR_PRESETS.map((p) =>
              h('button', { type: 'button', class: 'chip', 'aria-pressed': String(w.preset === p.key), onclick: () => store.dispatch({ type: 'material/wearPreset', id: matId, key: p.key, label: label() }) }, lbl(p.label)),
            ),
          );
        },
      );
      return h(
        'div',
        { class: 'stack' },
        h('div', { class: 'note' }, t('wear.previewNote')),
        levels.el,
        h('div', { class: 'subhead' }, t('wear.basics')),
        chips,
        field(t('wear.master'), master.el),
        ...types,
        field(t('wear.scale'), scale.el),
        field(t('wear.seed'), seed.el),
        field(t('wear.perObject'), perObject.el),
        h('button', { type: 'button', class: 'btn', onclick: () => store.dispatch({ type: 'material/wearToModel', id: matId, label: L('undo.wearAll') }) }, t('wear.applyAll')),
      );
    },
  );
  return section(ctx, 'wear', t('section.wear'), body);
}

// --- Part ------------------------------------------------------------------------------

function vec3(values: readonly number[], labels: readonly string[], opts: { step: number; unit: string; digits: number }, onChange: (i: number, v: number, g: string) => void): { el: HTMLElement; set(v: readonly number[]): void } {
  const fields = values.map((v, i) => numberField({ value: v, step: opts.step, unit: opts.unit, digits: opts.digits, label: labels[i], ariaLabel: labels[i], onChange: (x, g) => onChange(i, x, g) }));
  return { el: h('div', { class: 'field-row3' }, ...fields.map((f) => f.el)), set: (v) => fields.forEach((f, i) => f.set(v[i])) };
}

function partSection(ctx: Ctx, scope: Scope, ids: NodeId[], faces: boolean): HTMLElement {
  const { store } = ctx;
  const s0 = store.get();
  const target = faces && s0.selection.faces ? [s0.selection.faces.part] : ids;
  const restCenter = h(
    'div',
    { class: 'row' },
    h('button', { type: 'button', class: 'btn', style: 'flex:1', onclick: () => cmd.restOnFloor(ctx, target) }, t('tree.rest')),
    h('button', { type: 'button', class: 'btn', style: 'flex:1', onclick: () => cmd.centerSelection(ctx, target) }, t('tree.center')),
  );
  const parts = partsUnder(s0, target);
  const smoothAll = toggle(parts.every((p) => s0.scene.nodes[p].smooth !== false), (v) => store.dispatch({ type: 'scene/setSmooth', ids: target, smooth: v, label: L('undo.smooth', { target: targetLabel(store.get(), target) }) }), t('part.smooth'));
  scope.watch((s) => partsUnder(s, target).every((p) => s.scene.nodes[p]?.smooth !== false), (v) => smoothAll.set(v));

  // Bevel lives on the material (SPEC §3.3); shown here as UI §2.4 asks.
  const mats = targetMaterials(s0, target, false);
  let bevelRow: HTMLElement | null = null;
  if (mats.length === 1 && s0.materials[mats[0]]) {
    const id = mats[0];
    const bevel = numberField({ value: s0.materials[id].bevelRadiusMm, min: 0, max: 1000, step: 0.05, digits: 2, unit: 'mm', ariaLabel: t('material.bevel'), onChange: (v, g) => store.dispatch({ type: 'material/set', id, patch: { bevelRadiusMm: v }, gesture: g, label: L('undo.bevel', { material: materialLabel(store.get().materials[id]) }) }) });
    scope.watch((s) => s.materials[id]?.bevelRadiusMm ?? 0, (v) => bevel.set(v));
    bevelRow = h('div', { class: 'stack', style: 'gap:2px' }, field(t('material.bevel'), bevel.el), h('div', { class: 'note', style: 'padding-left:112px' }, t('material.bevelAux')));
  }

  if (target.length !== 1) {
    return section(ctx, 'part', t('section.part'), h('div', { class: 'stack' }, h('p', { class: 'note', style: 'margin:0' }, t('part.multi', { n: parts.length })), restCenter, bevelRow, field(t('part.smooth'), smoothAll.el)));
  }
  const id = target[0];
  const node = s0.scene.nodes[id];
  const lab = () => L('undo.transform', { target: targetLabel(store.get(), [id]) });
  const name = textField(node.name, (v) => cmd.renameNode(ctx, id, v), t('part.name'));
  const visible = toggle(node.visible, (v) => cmd.hideSelection(ctx, [id], v), t('part.visible'));
  const locked = toggle(node.locked, (v) => cmd.setLocked(ctx, [id], v), t('part.locked'));
  const setT = (key: 'position' | 'rotation' | 'scale', i: number, v: number, g: string) => {
    const cur = store.get().scene.nodes[id].transform[key];
    const next: [number, number, number] = [cur[0], cur[1], cur[2]];
    next[i] = v;
    store.dispatch({ type: 'scene/setTransform', id, transform: { [key]: next }, gesture: g, label: lab() });
  };
  const pos = vec3(node.transform.position, ['X', 'Y', 'Z'], { step: 1, unit: 'mm', digits: 1 }, (i, v, g) => setT('position', i, v, g));
  const rot = vec3(node.transform.rotation, ['X', 'Y', 'Z'], { step: 1, unit: '°', digits: 1 }, (i, v, g) => setT('rotation', i, v, g));
  const scl = vec3(node.transform.scale, ['X', 'Y', 'Z'], { step: 0.01, unit: '', digits: 3 }, (i, v, g) => setT('scale', i, v, g));
  const tris = h('div', { class: 'aux' });
  scope.watch(
    (s) => s.scene.nodes[id],
    (n) => {
      if (!n) return;
      name.set(n.name);
      visible.set(n.visible);
      locked.set(n.locked);
      pos.set(n.transform.position);
      rot.set(n.transform.rotation);
      scl.set(n.transform.scale);
      tris.textContent = n.mesh ? t('part.triangles', { n: n.mesh.triangles }) : '';
    },
  );
  const body = h(
    'div',
    { class: 'stack' },
    field(t('part.name'), name.el),
    field(t('part.visible'), visible.el),
    field(t('part.locked'), locked.el),
    h('div', { class: 'field-label' }, t('part.position')),
    pos.el,
    h('div', { class: 'field-label' }, t('part.rotation')),
    rot.el,
    h('div', { class: 'field-label' }, t('part.scale')),
    scl.el,
    restCenter,
    bevelRow,
    field(t('part.smooth'), smoothAll.el),
    tris,
  );
  return section(ctx, 'part', t('section.part'), body);
}

export function partsInspector(ctx: Ctx, scope: Scope, ids: string[], faces: boolean): HTMLElement {
  const s = ctx.store.get();
  if (faces && (!s.selection.faces || s.selection.faces.indices.length === 0)) {
    const part = ids[0] ? s.scene.nodes[ids[0]]?.name ?? '' : '';
    return h('div', null, h('p', { class: 'note', style: 'padding:12px var(--pad)' }, t('inspector.noFaces', { part })), partSection(ctx, scope, ids, false));
  }
  return h('div', null, materialSection(ctx, scope, ids, faces), wearSection(ctx, scope, ids, faces), partSection(ctx, scope, ids, faces));
}

// --- Light -----------------------------------------------------------------------------

export function lightInspector(ctx: Ctx, scope: Scope, id: string): HTMLElement {
  const { store, ui } = ctx;
  const l0 = store.get().studio.lights.find((l) => l.id === id);
  if (!l0) return h('div');
  const name = { en: lightName(store.get(), id, 'en'), es: lightName(store.get(), id, 'es') };
  const set = (patch: Partial<LightInstance>, g?: string) => store.dispatch({ type: 'studio/setLight', id, patch, gesture: g, label: L('undo.editLight', { name }) });
  const role = select((['KEY', 'FILL', 'RIM', 'TOP'] as const).map((r) => ({ value: r, label: t(dyn(`role.${r}`)) })), l0.role, (v) => set({ role: v as LightRole }), t('lightEdit.role'));
  const type = segmented((['AREA', 'SUN'] as const).map((x) => ({ value: x, label: t(dyn(`lightType.${x}`)) })), l0.type, (v) => set({ type: v }), { full: true, ariaLabel: t('lightEdit.type') });
  const shape = select(LIGHT_SHAPES.map((x) => ({ value: x, label: t(dyn(`shape.${x}`)) })), l0.shape, (v) => set({ shape: v as LightInstance['shape'] }), t('lightEdit.shape'));
  const num = (key: 'size' | 'sizeY' | 'az' | 'el' | 'dist' | 'spread' | 'power', min: number, max: number, step: number, unit: string, digits: number) =>
    numberField({ value: l0[key], min, max, step, unit, digits, ariaLabel: t(dyn(`lightEdit.${key === 'az' ? 'azimuth' : key === 'el' ? 'elevation' : key === 'dist' ? 'distance' : key}`)), onChange: (v, g) => set({ [key]: v }, g) });
  const size = num('size', 0.01, 50, 0.05, '', 2);
  const sizeY = num('sizeY', 0.01, 50, 0.05, '', 2);
  const az = num('az', -180, 180, 1, '°', 0);
  const el = num('el', -89, 89, 1, '°', 0);
  const dist = num('dist', 0.1, 100, 0.05, '', 2);
  const spread = num('spread', 1, 180, 1, '°', 0);
  const power = num('power', 0, 100000, 1, 'W', 1);
  const mode = segmented(
    [
      { value: 'K' as const, label: t('lightEdit.byKelvin') },
      { value: 'C' as const, label: t('lightEdit.byColor') },
    ],
    l0.kelvin !== null ? 'K' : 'C',
    (v) => (v === 'K' ? set({ kelvin: store.get().studio.lights.find((l) => l.id === id)?.kelvin ?? 5600 }) : set({ color: store.get().studio.lights.find((l) => l.id === id)!.color })),
    { full: true, ariaLabel: t('lightEdit.colorMode') },
  );
  const kelvin = numberField({ value: l0.kelvin ?? 5600, min: 1000, max: 12000, step: 50, unit: 'K', ariaLabel: t('lightEdit.kelvin'), onChange: (v, g) => set({ kelvin: v }, g) });
  const color = colorField(l0.color, (rgb, g) => set({ color: rgb }, g), t('lightEdit.color'));
  const kelvinRow = field(t('lightEdit.kelvin'), kelvin.el);
  const colorRow = field(t('lightEdit.color'), color.el);
  const glossy = toggle(l0.glossy, (v) => set({ glossy: v }), t('lightEdit.glossy'));
  const camera = toggle(l0.camera, (v) => set({ camera: v }), t('lightEdit.camera'));
  const enabled = toggle(l0.enabled, (v) => set({ enabled: v }), t('lightEdit.enabled'));
  const bright = h('p', { class: 'note', style: 'margin:0' }, t('lightEdit.brightField'));
  const sizeYRow = field(t('lightEdit.sizeY'), sizeY.el);
  scope.watch(
    (s) => s.studio.lights.find((l) => l.id === id),
    (l) => {
      if (!l) return;
      role.set(l.role);
      type.set(l.type);
      shape.set(l.shape);
      size.set(l.size);
      sizeY.set(l.sizeY);
      az.set(l.az);
      el.set(l.el);
      dist.set(l.dist);
      spread.set(l.spread);
      power.set(l.power);
      mode.set(l.kelvin !== null ? 'K' : 'C');
      kelvin.set(l.kelvin ?? 5600);
      color.set(l.color);
      kelvinRow.style.display = l.kelvin !== null ? '' : 'none';
      colorRow.style.display = l.kelvin !== null ? 'none' : '';
      sizeYRow.style.display = l.shape === 'SQUARE' || l.shape === 'DISK' ? 'none' : '';
      glossy.set(l.glossy);
      camera.set(l.camera);
      enabled.set(l.enabled);
      bright.style.display = l.brightField ? '' : 'none';
    },
  );
  const place = h('button', { type: 'button', class: 'btn', 'data-tip': t('light.placeReflectAux'), onclick: () => ui.set({ pickMode: ui.get().pickMode ? null : { kind: 'reflect', light: id } }) }, icon('reflect', 14), t('light.placeReflect'));
  scope.watch((_s, u) => u.pickMode?.kind === 'reflect', (on) => place.setAttribute('aria-pressed', String(on)));
  const body = h(
    'div',
    { class: 'stack' },
    field(t('lightEdit.role'), role.el),
    field(t('lightEdit.type'), type.el),
    field(t('lightEdit.shape'), shape.el),
    field(t('lightEdit.size'), size.el),
    sizeYRow,
    h('div', { class: 'note', style: 'padding-left:112px;margin-top:-4px' }, t('lightEdit.sizeAux')),
    field(t('lightEdit.azimuth'), az.el),
    h('div', { class: 'note', style: 'padding-left:112px;margin-top:-4px' }, t('lightEdit.azimuthAux')),
    field(t('lightEdit.elevation'), el.el),
    field(t('lightEdit.distance'), dist.el),
    field(t('lightEdit.spread'), spread.el),
    field(t('lightEdit.colorMode'), mode.el),
    kelvinRow,
    colorRow,
    field(t('lightEdit.power'), power.el),
    field(t('lightEdit.glossy'), glossy.el),
    field(t('lightEdit.camera'), camera.el),
    bright,
    field(t('lightEdit.enabled'), enabled.el),
    place,
    h('p', { class: 'note', style: 'margin:0' }, t('light.placeReflectAux')),
    h('p', { class: 'note', style: 'margin:0' }, t('lightEdit.moreSoon')),
  );
  return section(ctx, 'lightEdit', t('section.lightEdit'), body);
}

// --- Camera -------------------------------------------------------------------------------

export function cameraInspector(ctx: Ctx, scope: Scope, id: string): HTMLElement {
  const { store } = ctx;
  const cam0 = store.get().camera.cameras[id];
  if (!cam0) return h('div');
  const name = textField(cam0.name || cameraName(store.get(), cam0), (v) => store.dispatch({ type: 'camera/set', id, patch: { name: v.trim() }, label: L('undo.renameCamera') }), t('camera.name'));
  const activate = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => cmd.activateCamera(ctx, id) });
  scope.watch(
    (s) => [s.camera.active === id, s.camera.cameras[id]?.name] as const,
    ([active]) => {
      activate.disabled = active;
      activate.textContent = active ? t('camera.isActive') : t('camera.activate');
      const c = store.get().camera.cameras[id];
      if (c) name.set(c.name || cameraName(store.get(), c));
    },
    (a, b) => a[0] === b[0] && a[1] === b[1],
  );
  const body = h('div', { class: 'stack' }, field(t('camera.name'), name.el), activate, cameraFields(ctx, scope, () => id));
  return section(ctx, 'cameraEdit', t('section.camera'), body);
}
