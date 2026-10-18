// Inspector for a selection of parts (Material, Wear, Part), for faces, for
// one light and for one camera (UI.md §2.4).

import { MATERIAL_CATEGORIES, MATERIAL_PRESETS } from '../../data/materials';
import { WEAR_LEVELS, WEAR_PRESETS, WEAR_TYPES } from '../../data/wear';
import { LIGHT_SHAPES, LIGHT_TYPES } from '../../data/light-setups';
import type { LightRole, MaterialCategory, WearProps, WearType } from '../../data/types';
import { partKnots } from '../../core/knots';
import { instanceFromItem, itemsOf, type MaterialItem } from '../../core/library';
import { instanceFromPreset, paramEnabled, partMaterials, triangleMaterials, visibleParams, wearTypesFor, type MaterialId, type MaterialInstance, type ParamSpec } from '../../core/materials';
import { SMOOTH_ANGLE_DEG } from '../../core/meshes';
import { partsUnder, type NodeId } from '../../core/scene';
import { isLocked, PATTERN_MAX, pivotModeOf, pivotPoint, PIVOT_MODES, type PatternSpec } from '../../core/transform';
import type { ProjectState } from '../../core/store';
import { iesHalfAngle, iesProfileOf, iesSpot } from '../../core/ies';
import { lightAimPoint, lightFrame, lightLumens, NEW_LIGHT, polarAboutPivot, SPOT_DEFAULTS, type LightInstance } from '../../core/lighting';
import * as cmd from '../commands';
import { colorField, field, lengthField, numberField, segmented, select, slider, textField, toggle, type Control } from '../components/controls';
import { libraryFoot, mineCards, mineEmpty, namePrompt, type MineSpec } from '../components/library';
import { iesPlot } from '../components/ies-plot';
import { dragSource } from '../components/material-drag';
import { section } from '../components/section';
import { openMenu, setThumbImage, showConfirmIn, thumb } from '../components/widgets';
import { h, icon } from '../dom';
import { cameraName, dyn, lightName, materialLabel, materialName, primitiveParamKey, targetLabel, thumbKey } from '../names';
import { primitiveEntry } from '../../data/primitives';
import { dynamic, shallowEq, type Ctx, type Scope } from '../reactive';
import { L, formatNumber, getLang, lbl, t } from '../strings';
import { kbdFor } from '../shortcuts';
import { normalize } from '../components/palette';
import { cameraFields } from './insp-scene';
import { aimMenu } from './scene';
import { texturesSection } from './insp-textures';
import { physicsPointer, physicsSection } from './insp-physics';
import * as phys from '../physics';
import * as gc from '../graph-commands';

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

function sphere(ctx: Ctx, mat: MaterialInstance, size = 64): HTMLElement {
  const ph = h('div', { class: 'mat-sphere', style: `width:${size}px;height:${size}px` });
  const port = ctx.services.viewport;
  if (port) {
    void port.materialThumbnail(mat, thumbKey(mat)).then((url) => {
      if (url) ph.replaceWith(h('img', { class: 'mat-sphere', src: url, alt: '', width: size, height: size, draggable: false }));
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
        h('button', { type: 'button', class: 'chip', role: 'tab', 'aria-pressed': String(cat === 'MINE'), onclick: () => ui.set({ materialCategory: 'MINE' }) }, t('catalog.mine')),
      ),
  );
  const foot = libraryFoot(ctx, scope);
  foot.style.display = 'none';
  // The user's own materials: the picture saved with them, or a sphere rendered now for one that came without.
  const mine: MineSpec<MaterialItem> = {
    icon: 'sphere',
    active: (item) => {
      const s = store.get();
      return targetMaterials(s, ids, faces).some((m) => s.materials[m]?.library === item.id && !s.materials[m].edited);
    },
    choose: (item) => cmd.requestAssign(ctx, { library: item.id }),
    title: () => t('material.dragHint'),
    drag: (item) => `library:${item.id}`,
    fallback: (item, set) => {
      const inst = instanceFromItem(item);
      void ctx.services.viewport?.materialThumbnail(inst, thumbKey(inst)).then((url) => url && set(url));
    },
  };
  scope.watch(
    (s, u) => [u.materialCategory, u.materialFilter, s.materials, s.scene.nodes, s.selection, u.library.materials],
    () => {
      const s = store.get();
      const u = ui.get();
      const mats = targetMaterials(s, ids, faces);
      const activeKeys = new Set(mats.map((m) => s.materials[m]).filter((m) => m && !m.edited && m.role !== 'DEFAULT').map((m) => m!.preset));
      const q = normalize(u.materialFilter);
      const own = itemsOf(u.library, 'material');
      const ownShown = u.materialCategory === 'MINE' || q ? own.filter((i) => !q || normalize(i.name).includes(q)) : [];
      const list = q
        ? MATERIAL_PRESETS.filter((p) => normalize(p.label.en).includes(q) || normalize(p.label.es).includes(q))
        : u.materialCategory === 'MINE'
          ? []
          : MATERIAL_PRESETS.filter((p) => p.category === u.materialCategory);
      const cards: HTMLElement[] = list.map((p) => {
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
      });
      cards.push(...mineCards(ctx, ownShown, mine, confirmHost, true));
      if (cards.length === 0) cards.push(u.materialCategory === 'MINE' && !q ? mineEmpty() : h('p', { class: 'note', style: 'grid-column:1/-1' }, t('material.noMatch')));
      grid.replaceChildren(...cards);
      foot.style.display = u.materialCategory === 'MINE' ? '' : 'none';
    },
    shallowEq,
  );
  return h('div', { class: 'catalog', 'data-guide': 'material' }, chips, filter, grid, foot);
}

function paramControl(ctx: Ctx, scope: Scope, matId: MaterialId, spec: ParamSpec): HTMLElement {
  const { store } = ctx;
  const mat0 = store.get().materials[matId];
  const label = (g?: string) => ({ label: L('undo.param', { material: materialLabel(store.get().materials[matId]), param: L(dyn(`param.${spec.key}`)) }), gesture: g });
  const setv = (value: unknown, g?: string) => store.dispatch({ type: 'material/setParam', id: matId, key: spec.key, value, ...label(g) });
  const cur = (m: MaterialInstance | undefined) => (m ? (m.params[spec.key] ?? spec.fallback) : spec.fallback);
  // A knob this material has no use for (the knots of bamboo) is shown, disabled, with its note.
  const enabled = !mat0 || paramEnabled(mat0, spec);
  let ctrl: Control<never>;
  if (spec.kind === 'color') {
    const c = colorField(cur(mat0) as number[], (rgb, g) => {
      const prev = cur(store.get().materials[matId]) as number[];
      setv([rgb[0], rgb[1], rgb[2], prev[3] ?? 1], g);
    }, t(dyn(`param.${spec.key}`)));
    ctrl = c as Control<never>;
  } else if (spec.kind === 'select') {
    const opts = (spec.options ?? []).map((o) => ({ value: o, label: t(dyn(`${spec.key}.${o}`)) }));
    ctrl = select(opts, String(cur(mat0)), (v) => setv(v), t(dyn(`param.${spec.key}`))) as Control<never>;
  } else if (spec.min !== undefined && spec.max !== undefined && spec.max <= 2.5) {
    ctrl = slider({ value: Number(cur(mat0)), min: spec.min, max: spec.max, step: spec.step ?? 0.01, unit: spec.unit, disabled: !enabled, ariaLabel: t(dyn(`param.${spec.key}`)), onChange: (v, g) => setv(v, g) }) as Control<never>;
  } else {
    ctrl = numberField({ value: Number(cur(mat0)), min: spec.min, max: spec.max, step: spec.step ?? 1, unit: spec.unit, disabled: !enabled, ariaLabel: t(dyn(`param.${spec.key}`)), onChange: (v, g) => setv(v, g) }) as Control<never>;
  }
  scope.watch((s) => cur(s.materials[matId]), (v) => (ctrl.set as (x: unknown) => void)(v));
  const row = field(t(dyn(`param.${spec.key}`)) + (spec.preview ? '' : ' ·'), ctrl.el);
  if (!spec.preview) row.setAttribute('data-tip', t(spec.engine ? 'material.fullOnly' : 'material.notDrawn'));
  else if (spec.tip) row.setAttribute('data-tip', t(dyn(spec.tip)));
  if (!enabled && spec.enabledWhen) row.setAttribute('data-tip', t(dyn(spec.enabledWhen.note)));
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
      const p = m ? visibleParams(m).map((x) => x.key + (paramEnabled(m, x) ? '' : '!')).join(',') : '';
      // Not keyed on name / preset / edited: editing a value must not rebuild under the pointer. Simple ↔ Nodes is.
      return `${mats.join(',')}|${m?.family ?? ''}|${p}|${u.catalogOpen}|${m?.graph ? 'nodes' : 'simple'}`;
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
        // The sphere of the material of the selection is itself a thumbnail to drag: onto another part it links that
        // part to this material, with Alt it gives it a copy (the neutral default is nothing to hand out).
        if (mat.role !== 'DEFAULT') {
          sphereHost.setAttribute('data-tip', t('material.sphereDrag'));
          dragSource(sphereHost, { payload: () => `material:${mat.id}`, ghost: () => ({ src: sphereHost.querySelector('img')?.src ?? null, name: materialName(store.get().materials[mat.id]) }) });
        }
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
          // U16: where the physics of the selection lives, in one line (the owner looked for it under the material).
          physicsPointer(ctx, sc, faces && s.selection.faces ? [s.selection.faces.part] : ids),
          h('div', null, changeBtn),
        ),
      );
      const parts: (HTMLElement | null)[] = [card, confirmHost, open ? catalog(ctx, sc, ids, faces, confirmHost) : null];
      if (mat) {
        // M3a: Simple (the family's parameters) or Nodes (a graph, edited in the material editor).
        const mode = segmented(
          [
            { value: 'SIMPLE' as const, label: t('ge.simple') },
            { value: 'NODES' as const, label: t('ge.nodes') },
          ],
          mat.graph ? 'NODES' : 'SIMPLE',
          (v) => {
            if (v === 'NODES') gc.toNodes(ctx, mat.id);
            else {
              const ask = gc.toSimple(ctx, mat.id);
              if (ask) {
                showConfirmIn(confirmHost, ask);
                mode.set('NODES');
              }
            }
          },
          { ariaLabel: t('ge.modeTip') },
        );
        const nodesBtn = h('button', { type: 'button', class: 'btn', 'data-material-nodes': '', 'data-guide': 'material-nodes', 'data-tip': t('material.nodesTip'), onclick: () => gc.openMaterialEditor(ctx, mat.id) }, t('material.nodes'));
        parts.push(h('div', { class: 'row', style: 'gap:8px;align-items:center;flex-wrap:wrap', role: 'group', 'aria-label': t('material.mode') }, mode.el, nodesBtn));
        if (mat.graph) {
          // What the graph is in Fast, and in Full and Render (M3b): the same sentences as the editor's.
          const note = h('div', { class: 'stack', style: 'gap:2px', 'data-material-graph-note': '' });
          sc.watch(
            (st) => [st.materials[mat.id]?.graph, st.scene.nodes, st.scene.partSizeMm] as const,
            ([g]) => {
              if (!g) return;
              note.replaceChildren(h('p', { class: 'note' }, t('material.graphNote', { n: g.nodes.length })), ...gc.fastNoteLines(store.get(), mat.id, g).map((line) => h('p', { class: 'note' }, line)));
            },
            (a, b) => a.every((x, i) => x === b[i]),
          );
          parts.push(note);
        } else {
          parts.push(h('div', { class: 'subhead' }, t('material.params')));
          for (const spec of visibleParams(mat)) parts.push(paramControl(ctx, sc, mat.id, spec));
        }
        const mine = partsUnder(s, faces && s.selection.faces ? [s.selection.faces.part] : ids);
        if (!mat.graph && mat.family === 'WOOD') {
          // E6: a small piece takes fewer knots than asked (they never touch nor graze its surface): say so, quietly.
          const fit = h('div', { class: 'note' });
          sc.watch(
            (st) => [st.materials[mat.id], st.scene.nodes] as const,
            () => {
              const st = store.get();
              const placed = mine.map((p) => partKnots(st, p, mat.id)).filter((k) => k !== null);
              const fewest = placed.reduce((n, k) => Math.min(n, k.knots.length), Infinity);
              const asked = placed[0]?.asked ?? 0;
              fit.textContent = placed.length > 0 && fewest < asked ? t('material.knotsFit', { asked, fit: fewest }) : '';
              fit.style.display = fit.textContent ? '' : 'none';
            },
            (a, b) => a[0] === b[0] && a[1] === b[1],
          );
          parts.push(fit);
        }
        if (!mat.graph && (mat.family === 'WOOD' || mat.family === 'FABRIC')) parts.push(h('div', { class: 'note' }, t('material.flatNote')));
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
        // Save material as…: the values it has now go to the library (Mine), with a sphere rendered by the viewport.
        const saveHost = h('div');
        const saveBtn = h('button', { type: 'button', class: 'btn', 'data-tip': t('material.saveAux'), onclick: () => namePrompt(saveHost, { label: t('material.save'), initial: cmd.suggestMaterialName(ctx, mat.id), onSave: (name) => void cmd.saveMaterialToLibrary(ctx, mat.id, name) }) }, icon('plus', 14), t('material.save'));
        parts.push(saveBtn, saveHost);
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

function vec3(
  values: readonly number[],
  labels: readonly string[],
  opts: { step: number; unit: string; digits: number; min?: number; max?: number },
  onChange: (i: number, v: number, g: string) => void,
  disabled = false,
): { el: HTMLElement; set(v: readonly number[]): void } {
  // Lengths (mm in the model) show in the interface units.
  const make = opts.unit === 'mm' ? lengthField : numberField;
  const fields = values.map((v, i) =>
    make({ value: v, step: opts.step, unit: opts.unit === 'mm' ? undefined : opts.unit, digits: opts.digits, min: opts.min, max: opts.max, label: labels[i], ariaLabel: labels[i], disabled, onChange: (x, g) => onChange(i, x, g) }),
  );
  return { el: h('div', { class: 'field-row3' }, ...fields.map((f) => f.el)), set: (v) => fields.forEach((f, i) => f.set(v[i])) };
}

const XYZ = ['X', 'Y', 'Z'];

/** Position, rotation and scale of one node (scrubbable, mm and degrees; proportional scale lock). */
function transformFields(ctx: Ctx, scope: Scope, id: NodeId, locked: boolean): HTMLElement {
  const { store, ui } = ctx;
  const node = store.get().scene.nodes[id];
  const lab = (key: 'undo.transform' | 'undo.rotate' | 'undo.scale') => L(key, { target: targetLabel(store.get(), [id]) });
  const setT = (key: 'position' | 'rotation' | 'scale', i: number, v: number, g: string) => {
    const cur = store.get().scene.nodes[id]?.transform[key];
    if (!cur) return;
    let next: [number, number, number] = [cur[0], cur[1], cur[2]];
    if (key === 'scale' && ui.get().scaleLock && cur[i] !== 0) {
      const k = v / cur[i];
      next = [cur[0] * k, cur[1] * k, cur[2] * k];
    }
    next[i] = v;
    store.dispatch({ type: 'scene/setTransform', id, transform: { [key]: next }, gesture: g, label: lab(key === 'position' ? 'undo.transform' : key === 'rotation' ? 'undo.rotate' : 'undo.scale') });
  };
  const pos = vec3(node.transform.position, XYZ, { step: 1, unit: 'mm', digits: 2 }, (i, v, g) => setT('position', i, v, g), locked);
  const rot = vec3(node.transform.rotation, XYZ, { step: 1, unit: '°', digits: 2 }, (i, v, g) => setT('rotation', i, v, g), locked);
  const scl = vec3(node.transform.scale, XYZ, { step: 0.01, unit: '', digits: 3 }, (i, v, g) => setT('scale', i, v, g), locked);
  const lockBtn = h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': t('part.scaleLock'), 'data-tip': t('part.scaleLock'), onclick: () => ui.set({ scaleLock: !ui.get().scaleLock }) });
  scope.watch(
    (_s, u) => u.scaleLock,
    (on) => {
      lockBtn.replaceChildren(icon(on ? 'lock' : 'unlock', 14));
      lockBtn.setAttribute('aria-pressed', String(on));
    },
  );
  // Live: the fields follow the gizmo while it is dragged.
  scope.watch(
    (s) => s.scene.nodes[id]?.transform,
    (tr) => {
      if (!tr) return;
      pos.set(tr.position);
      rot.set(tr.rotation);
      scl.set(tr.scale);
    },
  );
  return h(
    'div',
    { class: 'stack', 'data-field': 'transform' },
    h('div', { class: 'field-label' }, t('part.position')),
    pos.el,
    h('div', { class: 'field-label' }, t('part.rotation')),
    rot.el,
    h('div', { class: 'row', style: 'justify-content:space-between;align-items:center' }, h('span', { class: 'field-label' }, t('part.scale')), lockBtn),
    scl.el,
  );
}

/** Pivot mode of the selection (segmented) and "Set from click". */
function pivotControls(ctx: Ctx, scope: Scope, target: NodeId[]): HTMLElement {
  const { store } = ctx;
  const seg = segmented(
    PIVOT_MODES.map((m) => ({ value: m, label: t(dyn(`pivot.${m}`)), title: t(dyn(`pivot.tip.${m}`)) })),
    pivotModeOf(store.get().scene.nodes[target[0]]),
    (m) => cmd.setPivot(ctx, m, target),
    { full: true, ariaLabel: t('part.pivot') },
  );
  scope.watch((s) => pivotModeOf(s.scene.nodes[target[0]]), (m) => seg.set(m));
  const pick = h('button', { type: 'button', class: 'btn', 'data-tip': t('part.pivotPickAux'), onclick: () => (ctx.ui.get().pickMode?.kind === 'pivot' ? ctx.ui.set({ pickMode: null }) : cmd.pickPivot(ctx, target)) }, icon('target', 14), t('part.pivotPick'));
  scope.watch((_s, u) => u.pickMode?.kind === 'pivot', (on) => pick.setAttribute('aria-pressed', String(on)));
  return h('div', { class: 'stack', style: 'gap:6px', 'data-field': 'pivot' }, h('div', { class: 'field-label' }, t('part.pivot')), seg.el, pick);
}

/** Rest, centre, centre and rest, reset, camera target. */
function operationButtons(ctx: Ctx, target: NodeId[]): HTMLElement {
  const btn = (label: string, run: () => void, tip?: string) => h('button', { type: 'button', class: 'btn', style: 'flex:1', 'data-tip': tip, onclick: run }, label);
  return h(
    'div',
    { class: 'stack', style: 'gap:6px' },
    h('div', { class: 'row' }, btn(t('tree.rest'), () => cmd.restOnFloor(ctx, target)), btn(t('tree.center'), () => cmd.centerSelection(ctx, target)), btn(t('ops.centerRest'), () => cmd.centerAndRest(ctx, target))),
    h('div', { class: 'row' }, btn(t('ops.reset'), () => cmd.resetTransform(ctx, target)), btn(t('ops.cameraTarget'), () => cmd.setCameraTarget(ctx, target))),
    // Physics (S2): the selection falls onto the floor and whatever is under it.
    h('div', { class: 'row' }, btn(t('ops.drop'), () => phys.drop(ctx, target), t('ops.dropAux'))),
  );
}

function partSection(ctx: Ctx, scope: Scope, ids: NodeId[], faces: boolean): HTMLElement {
  const { store } = ctx;
  const s0 = store.get();
  const target = faces && s0.selection.faces ? [s0.selection.faces.part] : ids;
  const parts = partsUnder(s0, target);
  const smoothAll = toggle(parts.every((p) => s0.scene.nodes[p].smooth !== false), (v) => store.dispatch({ type: 'scene/setSmooth', ids: target, smooth: v, label: L('undo.smooth', { target: targetLabel(store.get(), target) }) }), t('part.smooth'));
  scope.watch((s) => partsUnder(s, target).every((p) => s.scene.nodes[p]?.smooth !== false), (v) => smoothAll.set(v));
  const angleOf = (s: ProjectState) => s.scene.nodes[partsUnder(s, target)[0]]?.smoothAngle ?? SMOOTH_ANGLE_DEG;
  const angle = slider({ value: angleOf(s0), min: 0, max: 180, step: 1, digits: 1, unit: '°', ariaLabel: t('part.smoothAngle'), disabled: parts.length === 0, onChange: (v, g) => cmd.setSmoothAngle(ctx, v, g, target) });
  scope.watch(angleOf, (v) => angle.set(v));
  const angleRow = h('div', { class: 'stack', style: 'gap:2px', 'data-field': 'smoothAngle' }, field(t('part.smoothAngle'), angle.el), h('div', { class: 'note', style: 'padding-left:112px' }, t('part.smoothAngleAux')));

  // Bevel lives on the material (SPEC §3.3); shown here as UI §2.4 asks.
  const mats = targetMaterials(s0, target, false);
  let bevelRow: HTMLElement | null = null;
  if (mats.length === 1 && s0.materials[mats[0]]) {
    const id = mats[0];
    const bevel = lengthField({ value: s0.materials[id].bevelRadiusMm, min: 0, max: 1000, step: 0.05, digits: 2, ariaLabel: t('material.bevel'), onChange: (v, g) => store.dispatch({ type: 'material/set', id, patch: { bevelRadiusMm: v }, gesture: g, label: L('undo.bevel', { material: materialLabel(store.get().materials[id]) }) }) });
    scope.watch((s) => s.materials[id]?.bevelRadiusMm ?? 0, (v) => bevel.set(v));
    bevelRow = h('div', { class: 'stack', style: 'gap:2px' }, field(t('material.bevel'), bevel.el), h('div', { class: 'note', style: 'padding-left:112px' }, t('material.bevelAux')));
  }
  const geometry = [bevelRow, field(t('part.smooth'), smoothAll.el), angleRow];

  if (target.length !== 1) {
    // Several nodes: the fields edit where their common pivot is; moving it moves them all.
    const pivotOf = (s: ProjectState) => pivotPoint(s, target);
    const at = vec3(pivotOf(s0), XYZ, { step: 1, unit: 'mm', digits: 2 }, (i, v, g) => {
      const cur = pivotOf(store.get());
      const delta: [number, number, number] = [0, 0, 0];
      delta[i] = v - cur[i];
      store.dispatch({ type: 'scene/move', ids: target, delta, space: 'GLOBAL', gesture: g, label: L('undo.transform', { target: targetLabel(store.get(), target) }) });
    });
    scope.watch((s) => pivotOf(s).join(','), () => at.set(pivotOf(store.get())));
    const body = h(
      'div',
      { class: 'stack' },
      h('p', { class: 'note', style: 'margin:0' }, t('part.multi', { n: parts.length })),
      h('div', { class: 'field-label', 'data-tip': t('part.pivotAtAux') }, t('part.pivotAt')),
      at.el,
      pivotControls(ctx, scope, target),
      operationButtons(ctx, target),
      ...geometry,
    );
    return section(ctx, 'part', t('section.part'), body);
  }
  const id = target[0];
  const node = s0.scene.nodes[id];
  const name = textField(node.name, (v) => cmd.renameNode(ctx, id, v), t('part.name'));
  name.el.setAttribute('data-field', 'name');
  const visible = toggle(node.visible, (v) => cmd.hideSelection(ctx, [id], v), t('part.visible'));
  // K3: seen by the camera or not, and still in the light (the ceiling of a plan view).
  const cameraVisible = toggle(!node.cameraHidden, (v) => cmd.setCameraHidden(ctx, [id], !v), t('part.cameraVisible'));
  cameraVisible.el.setAttribute('data-tip', t('part.cameraVisibleAux'));
  const locked = toggle(node.locked, (v) => cmd.setLocked(ctx, [id], v), t('part.locked'));
  const tris = h('div', { class: 'aux' });
  scope.watch(
    (s) => s.scene.nodes[id],
    (n) => {
      if (!n) return;
      name.set(n.name);
      visible.set(n.visible);
      cameraVisible.set(!n.cameraHidden);
      locked.set(n.locked);
      tris.textContent = n.mesh ? t('part.triangles', { n: n.mesh.triangles }) : '';
    },
  );
  // A locked node (or one inside a locked group) shows its transform without letting it change.
  const fields = dynamic(scope, (s) => isLocked(s, id), (sc, isOn) => transformFields(ctx, sc, id, isOn));
  const body = h(
    'div',
    { class: 'stack' },
    field(t('part.name'), name.el),
    field(t('part.visible'), visible.el),
    field(t('part.cameraVisible'), cameraVisible.el),
    field(t('part.locked'), locked.el),
    fields,
    pivotControls(ctx, scope, target),
    operationButtons(ctx, target),
    ...geometry,
    tris,
  );
  return section(ctx, 'part', t('section.part'), body);
}

/** The Pattern editor (a pattern group is selected): every change regenerates the copies, live. */
function patternSection(ctx: Ctx, scope: Scope, id: NodeId): HTMLElement {
  const { store } = ctx;
  const spec = () => store.get().scene.nodes[id]?.pattern;
  const spec0 = spec()!;
  const edit = (patch: Partial<Omit<PatternSpec, 'sources'>>, g?: string) => cmd.editPattern(ctx, id, patch, g);
  const kind = segmented((['LINEAR', 'CIRCULAR'] as const).map((k) => ({ value: k, label: t(dyn(`pattern.${k}`)) })), spec0.kind, (k) => edit({ kind: k }), { full: true, ariaLabel: t('pattern.kind') });
  const count = numberField({ value: spec0.count, min: 1, max: PATTERN_MAX, step: 1, digits: 0, ariaLabel: t('pattern.count'), onChange: (v, g) => edit({ count: Math.round(v) }, g) });
  const offset = vec3(spec0.offset, XYZ, { step: 1, unit: 'mm', digits: 2 }, (i, v, g) => {
    const next: [number, number, number] = [...spec()!.offset];
    next[i] = v;
    edit({ offset: next }, g);
  });
  const space = segmented((['GLOBAL', 'LOCAL'] as const).map((k) => ({ value: k, label: t(dyn(`space.${k}`)) })), spec0.space, (k) => edit({ space: k }), { full: true, ariaLabel: t('pattern.space') });
  const axis = segmented(XYZ.map((a, i) => ({ value: String(i) as '0' | '1' | '2', label: a })), String(spec0.axis) as '0', (a) => edit({ axis: Number(a) as 0 | 1 | 2 }), { full: true, ariaLabel: t('pattern.axis') });
  const angle = slider({ value: spec0.angleDeg, min: -360, max: 360, step: 1, digits: 1, unit: '°', ariaLabel: t('pattern.angle'), onChange: (v, g) => edit({ angleDeg: v }, g) });
  const center = vec3(spec0.center, XYZ, { step: 1, unit: 'mm', digits: 2 }, (i, v, g) => {
    const next: [number, number, number] = [...spec()!.center];
    next[i] = v;
    edit({ center: next }, g);
  });
  const linear = h('div', { class: 'stack' }, h('div', { class: 'field-label' }, t('pattern.offset')), offset.el);
  const circular = h('div', { class: 'stack' }, field(t('pattern.axis'), axis.el), field(t('pattern.angle'), angle.el), h('div', { class: 'field-label' }, t('pattern.center')), center.el);
  scope.watch(spec, (p) => {
    if (!p) return;
    kind.set(p.kind);
    count.set(p.count);
    offset.set(p.offset);
    space.set(p.space);
    axis.set(String(p.axis) as '0');
    angle.set(p.angleDeg);
    center.set(p.center);
    linear.style.display = p.kind === 'LINEAR' ? '' : 'none';
    circular.style.display = p.kind === 'CIRCULAR' ? '' : 'none';
  });
  const body = h(
    'div',
    { class: 'stack', 'data-field': 'pattern' },
    field(t('pattern.kind'), kind.el),
    field(t('pattern.count'), count.el),
    linear,
    circular,
    field(t('pattern.space'), space.el),
    h('p', { class: 'note', style: 'margin:0' }, t('pattern.note')),
  );
  return section(ctx, 'pattern', t('section.pattern'), body);
}

/**
 * The Primitive editor (phase U9; a primitive part is selected): its measures, live. A change regenerates the mesh
 * through one action of the store, and a drag of a field is one undo step; Convert to mesh freezes them.
 */
function primitiveSection(ctx: Ctx, scope: Scope, id: NodeId): HTMLElement | null {
  const { store } = ctx;
  const spec0 = store.get().scene.nodes[id]?.primitive;
  const entry = spec0 ? primitiveEntry(spec0.kind) : undefined;
  if (!spec0 || !entry) return null;
  const rows = entry.params.map((p) => {
    const label = t(primitiveParamKey(spec0.kind, p.key));
    const value = spec0.params[p.key];
    const onChange = (v: number, g: string) => cmd.setPrimitiveParam(ctx, id, p.key, p.kind === 'COUNT' ? Math.round(v) : v, g);
    const ctrl =
      p.kind === 'LENGTH'
        ? lengthField({ value, min: p.min, step: p.step ?? 1, digits: (p.step ?? 1) < 1 ? 2 : 1, ariaLabel: label, onChange })
        : numberField({ value, min: p.min, max: p.max, step: 1, digits: 0, ariaLabel: label, onChange });
    scope.watch((s) => s.scene.nodes[id]?.primitive?.params[p.key], (v) => v !== undefined && ctrl.set(v));
    const row = field(label, ctrl.el);
    row.setAttribute('data-param', p.key);
    return row;
  });
  // Linked copies (Duplicate linked, a pattern) share the mesh: they change with it.
  const linked = h('p', { class: 'note', style: 'margin:0' });
  scope.watch(
    (s) => s.scene.nodes,
    (nodes) => {
      const mesh = nodes[id]?.mesh?.id;
      const n = mesh ? Object.values(nodes).filter((m) => m.id !== id && m.mesh?.id === mesh).length : 0;
      linked.textContent = n > 0 ? t('primitive.linked', { n }) : '';
      linked.style.display = n > 0 ? '' : 'none';
    },
  );
  const convert = h('button', { type: 'button', class: 'btn', 'data-tip': t('primitive.convertAux'), 'data-action': 'primitive.convert', onclick: () => cmd.convertToMesh(ctx, [id]) }, t('primitive.convert'));
  // The infinity sweep: fitted to the active camera again (it faces it and covers its frame).
  const fit = spec0.kind === 'SWEEP' ? h('button', { type: 'button', class: 'btn', 'data-tip': t('primitive.fitAux'), 'data-action': 'primitive.fit', onclick: () => cmd.fitToCamera(ctx, id) }, icon('camera', 14), t('primitive.fit')) : null;
  const body = h(
    'div',
    { class: 'stack', 'data-field': 'primitive', 'data-kind': spec0.kind },
    field(t('primitive.kind'), h('span', { class: 'prim-kind' }, t(dyn(`prim.${spec0.kind}`)))),
    ...rows,
    h('p', { class: 'note', style: 'margin:0' }, t('primitive.note')),
    linked,
    fit,
    convert,
  );
  return section(ctx, 'primitive', t('section.primitive'), body);
}

export function partsInspector(ctx: Ctx, scope: Scope, ids: string[], faces: boolean): HTMLElement {
  const s = ctx.store.get();
  if (faces && (!s.selection.faces || s.selection.faces.indices.length === 0)) {
    const part = ids[0] ? s.scene.nodes[ids[0]]?.name ?? '' : '';
    return h('div', null, h('p', { class: 'note', style: 'padding:12px var(--pad)' }, t('inspector.noFaces', { part })), partSection(ctx, scope, ids, false));
  }
  const pattern = !faces && ids.length === 1 && s.scene.nodes[ids[0]]?.pattern ? patternSection(ctx, scope, ids[0]) : null;
  // A primitive's measures, until it is converted to a mesh (keyed on its shape: editing a measure does not rebuild).
  const primitive = !faces && ids.length === 1 ? dynamic(scope, (st) => st.scene.nodes[ids[0]]?.primitive?.kind ?? '', (sc, kind) => (kind ? primitiveSection(ctx, sc, ids[0]) : null)) : null;
  // Physics (S2) edits the nodes; at the Faces level, the part of the faces.
  const physTarget = faces && s.selection.faces ? [s.selection.faces.part] : ids;
  return h('div', null, pattern, primitive, materialSection(ctx, scope, ids, faces), texturesSection(ctx, scope, ids, faces), wearSection(ctx, scope, ids, faces), partSection(ctx, scope, ids, faces), physicsSection(ctx, scope, physTarget));
}

// --- Light -----------------------------------------------------------------------------

export function lightInspector(ctx: Ctx, scope: Scope, id: string): HTMLElement {
  const { store, ui } = ctx;
  const l0 = store.get().studio.lights.find((l) => l.id === id);
  if (!l0) return h('div');
  const cur = () => store.get().studio.lights.find((l) => l.id === id);
  const name = () => ({ en: lightName(store.get(), id, 'en'), es: lightName(store.get(), id, 'es') });
  const set = (patch: Partial<LightInstance>, g?: string) => store.dispatch({ type: 'studio/setLight', id, patch, gesture: g, label: L('undo.editLight', { name: name() }) });
  const nameField = textField(l0.name ?? '', (v) => set({ name: v.trim() || undefined }), t('lightEdit.name'), lightName(store.get(), id, getLang()));
  const ownNote = h('p', { class: 'note', style: 'margin:0' }, t('lightEdit.own'));
  const role = select((['KEY', 'FILL', 'RIM', 'TOP'] as const).map((r) => ({ value: r, label: t(dyn(`role.${r}`)) })), l0.role, (v) => set({ role: v as LightRole }), t('lightEdit.role'));
  const roleRow = field(t('lightEdit.role'), role.el);
  // Area, point, spot, sun (L4). A spot starts with its default cone; a point and a spot with a small bulb.
  // An IES light (L5) can be made a point or a spot and back (its profile stays); the others have no profile to go back to.
  const type = segmented(
    LIGHT_TYPES.filter((x) => x !== 'IES' || l0.ies !== undefined).map((x) => ({ value: x, label: t(dyn(`lightType.${x}`)) })),
    l0.type,
    (v) => {
      const l = cur();
      if (!l || l.type === v) return;
      const patch: Partial<LightInstance> = { type: v };
      if (v === 'SPOT' && (l.type !== 'SPOT' || l.spread >= 180)) patch.spread = SPOT_DEFAULTS.cone;
      if (v !== 'SPOT' && l.type === 'SPOT') patch.spread = 180;
      if ((v === 'POINT' || v === 'SPOT' || v === 'IES') && l.type === 'AREA' && l.shape !== 'SPHERE') patch.size = NEW_LIGHT.bulb;
      set(patch);
    },
    { full: true, compact: l0.ies !== undefined, ariaLabel: t('lightEdit.type') },
  );
  const shape = select(LIGHT_SHAPES.map((x) => ({ value: x, label: t(dyn(`shape.${x}`)) })), l0.shape, (v) => set({ shape: v as LightInstance['shape'] }), t('lightEdit.shape'));
  const shapeRow = field(t('lightEdit.shape'), shape.el);
  const num = (key: 'size' | 'sizeY' | 'az' | 'el' | 'dist' | 'spread' | 'power' | 'angle' | 'roll', min: number, max: number, step: number, unit: string, digits: number, aria: string) =>
    numberField({ value: (l0[key] as number | undefined) ?? 0, min, max, step, unit, digits, ariaLabel: aria, onChange: (v, g) => set({ [key]: v }, g) });
  // U15: the angles, each in a fixed range, are sliders with their field.
  const angleSlider = (key: 'az' | 'el' | 'spread' | 'angle' | 'roll', min: number, max: number, step: number, digits: number, aria: string) =>
    slider({ value: (l0[key] as number | undefined) ?? 0, min, max, step, unit: '°', digits, ariaLabel: aria, onChange: (v, g) => set({ [key]: v }, g) });
  const size = num('size', 0.01, 50, 0.05, '', 2, t('lightEdit.size'));
  const sizeY = num('sizeY', 0.01, 50, 0.05, '', 2, t('lightEdit.sizeY'));
  const sizeRow = field(t('lightEdit.size'), size.el);
  const sizeLabel = sizeRow.querySelector('.field-label') as HTMLElement;
  const sizeYRow = field(t('lightEdit.sizeY'), sizeY.el);
  // A point's or a spot's bulb, by its radius (the size is its diameter).
  const radius = numberField({ value: l0.size / 2, min: 0, max: 25, step: 0.005, digits: 3, ariaLabel: t('lightEdit.radius'), onChange: (v, g) => set({ size: v * 2 }, g) });
  const radiusRow = field(t('lightEdit.radius'), radius.el);
  const az = angleSlider('az', -180, 180, 1, 0, t('lightEdit.azimuth'));
  const el = angleSlider('el', -89, 89, 1, 0, t('lightEdit.elevation'));
  const dist = num('dist', 0.1, 100, 0.05, '', 2, t('lightEdit.distance'));
  const spread = angleSlider('spread', 1, 180, 1, 0, t('lightEdit.spread'));
  const spreadRow = field(t('lightEdit.spread'), spread.el);
  const cone = angleSlider('spread', 1, 179, 1, 0, t('lightEdit.cone'));
  const coneRow = field(t('lightEdit.cone'), cone.el);
  const blend = slider({ value: Math.round((l0.blend ?? SPOT_DEFAULTS.blend) * 100), min: 0, max: 100, step: 1, unit: '%', ariaLabel: t('lightEdit.blend'), onChange: (v, g) => set({ blend: v / 100 }, g) });
  const blendRow = field(t('lightEdit.blend'), blend.el);
  const sunAngle = angleSlider('angle', 0, 5, 0.05, 2, t('lightEdit.sunAngle'));
  const sunRow = field(t('lightEdit.sunAngle'), sunAngle.el);
  const roll = angleSlider('roll', -180, 180, 1, 0, t('lightEdit.roll'));
  const rollRow = field(t('lightEdit.roll'), roll.el);
  // World coordinates (mm): moving keeps the light aimed where it was.
  const xyz = ([0, 1, 2] as const).map((k) =>
    lengthField({
      value: lightFrame(store.get(), l0).position[k],
      step: 1,
      label: ['X', 'Y', 'Z'][k],
      ariaLabel: `${t('lightEdit.coords')} ${['X', 'Y', 'Z'][k]}`,
      onChange: (v, g) => {
        const s = store.get();
        const l = cur();
        if (!l) return;
        const pos = lightFrame(s, l).position;
        pos[k] = v;
        const placed = polarAboutPivot(s, pos);
        if (placed) set(placed, g);
      },
    }),
  );
  const mode = segmented(
    [
      { value: 'K' as const, label: t('lightEdit.byKelvin') },
      { value: 'C' as const, label: t('lightEdit.byColor') },
    ],
    l0.kelvin !== null ? 'K' : 'C',
    (v) => (v === 'K' ? set({ kelvin: cur()?.kelvin ?? 5600 }) : set({ color: cur()!.color })),
    { full: true, ariaLabel: t('lightEdit.colorMode') },
  );
  const kelvin = numberField({ value: l0.kelvin ?? 5600, min: 1000, max: 12000, step: 50, unit: 'K', ariaLabel: t('lightEdit.kelvin'), onChange: (v, g) => set({ kelvin: v }, g) });
  const color = colorField(l0.color, (rgb, g) => set({ color: rgb }, g), t('lightEdit.color'));
  const kelvinRow = field(t('lightEdit.kelvin'), kelvin.el);
  const colorRow = field(t('lightEdit.color'), color.el);
  const power = num('power', 0, 100000, 1, 'W', 1, t('lightEdit.power'));
  const powerRow = field(t('lightEdit.power'), power.el);
  const powerAux = h('div', { class: 'note', style: 'padding-left:112px;margin-top:-4px', 'data-field': 'lumens' });
  // IES (L5): the profile gives the shape and the level is a multiplier of the power the light came in with.
  const iesBase = (l: LightInstance): number => (l.ies && l.ies.base > 0 ? l.ies.base : 1);
  const multiplier = numberField({
    value: l0.ies ? l0.power / iesBase(l0) : 1,
    min: 0,
    max: 1000,
    step: 0.05,
    unit: '×',
    digits: 2,
    ariaLabel: t('lightEdit.iesMultiplier'),
    onChange: (v, g) => {
      const l = cur();
      if (l?.ies) set({ power: iesBase(l) * v }, g);
    },
  });
  const multiplierRow = field(t('lightEdit.iesMultiplier'), multiplier.el);
  const iesName = h('div', { class: 'ies-profile-name', 'data-field': 'ies-name' });
  const iesChange = h('button', { type: 'button', class: 'btn', 'data-action': 'light.iesChange', onclick: () => void cmd.replaceIesProfile(ctx, id) }, icon('lightIes', 14), t('lightEdit.iesReplace'));
  const iesChangeRow = h('div', { style: 'padding-left:116px' }, iesChange);
  const iesPlotHost = h('div');
  const iesInfo = h('div', { class: 'note', style: 'padding-left:116px;margin-top:-4px', 'data-field': 'ies-info' });
  const iesNote = h('p', { class: 'note', style: 'margin:0', 'data-field': 'ies-approx' });
  const iesBlock = h('div', { class: 'stack', 'data-field': 'ies' }, field(t('lightEdit.iesProfile'), iesName), iesPlotHost, iesInfo, iesNote, iesChangeRow);
  let iesShown = '';
  const glossy = toggle(l0.glossy, (v) => set({ glossy: v }), t('lightEdit.glossy'));
  const camera = toggle(l0.camera, (v) => set({ camera: v }), t('lightEdit.camera'));
  const shadow = toggle(l0.shadow !== false, (v) => set({ shadow: v ? undefined : false }), t('lightEdit.shadow'));
  const enabled = toggle(l0.enabled, (v) => set({ enabled: v }), t('lightEdit.enabled'));
  const bright = h('p', { class: 'note', style: 'margin:0' }, t('lightEdit.brightField'));
  // Aim at… (UI.md §2.4: the product's centre, the selected parts, a point, a part).
  const aimNow = h('div', { class: 'note', style: 'padding-left:112px;margin-top:-4px', 'data-field': 'aim' });
  const aimBtn = h('button', { type: 'button', class: 'btn', 'aria-haspopup': 'menu', 'data-action': 'light.aim' }, icon('target', 14), t('lightEdit.aim'));
  aimBtn.addEventListener('click', () => openMenu(aimBtn, aimMenu(ctx, id)));
  scope.watch(
    (s) => s.studio.lights.find((l) => l.id === id),
    (l) => {
      if (!l) return;
      const s = store.get();
      const area = l.type === 'AREA';
      const sphere = area && l.shape === 'SPHERE';
      const bulb = l.type === 'POINT' || l.type === 'SPOT' || l.type === 'IES';
      nameField.set(l.name ?? '');
      (nameField.el as HTMLInputElement).placeholder = lightName(s, id, getLang());
      ownNote.style.display = l.own ? '' : 'none';
      roleRow.style.display = l.own ? 'none' : '';
      role.set(l.role);
      type.set(l.type);
      shapeRow.style.display = area ? '' : 'none';
      shape.set(l.shape);
      sizeRow.style.display = area ? '' : 'none';
      sizeLabel.textContent = sphere ? t('lightEdit.diameter') : t('lightEdit.size');
      size.set(l.size);
      sizeY.set(l.sizeY);
      sizeYRow.style.display = area && !sphere && l.shape !== 'SQUARE' && l.shape !== 'DISK' ? '' : 'none';
      radiusRow.style.display = bulb ? '' : 'none';
      radius.set(l.size / 2);
      az.set(l.az);
      el.set(l.el);
      dist.set(l.dist);
      spreadRow.style.display = area && !sphere ? '' : 'none';
      spread.set(l.spread);
      coneRow.style.display = l.type === 'SPOT' ? '' : 'none';
      blendRow.style.display = l.type === 'SPOT' ? '' : 'none';
      cone.set(l.spread);
      blend.set(Math.round((l.blend ?? SPOT_DEFAULTS.blend) * 100));
      sunRow.style.display = l.type === 'SUN' ? '' : 'none';
      sunAngle.set(l.angle);
      rollRow.style.display = (area && !sphere && l.shape !== 'DISK') || l.type === 'IES' ? '' : 'none';
      roll.set(l.roll ?? 0);
      const f = lightFrame(s, l);
      xyz.forEach((c, k) => c.set(Math.round(f.position[k] * 100) / 100));
      mode.set(l.kelvin !== null ? 'K' : 'C');
      kelvin.set(l.kelvin ?? 5600);
      color.set(l.color);
      kelvinRow.style.display = l.kelvin !== null ? '' : 'none';
      colorRow.style.display = l.kelvin !== null ? 'none' : '';
      power.set(l.power);
      // Lumens (or lux for a sun) from the flux the engine is given: not a lamp's efficacy (core/photometry.ts).
      const lm = lightLumens(s, l);
      const aux = t(lm.unit === 'lx' ? 'lightEdit.lux' : 'lightEdit.lumens', { n: formatNumber(lm.value, getLang(), lm.value < 10 ? 1 : 0) });
      const ies = l.type === 'IES' && l.ies !== undefined;
      powerRow.style.display = ies ? 'none' : '';
      multiplierRow.style.display = ies ? '' : 'none';
      if (l.ies) multiplier.set(l.power / iesBase(l));
      powerAux.textContent = l.type === 'SUN' ? t('lightEdit.sunPowerAux', { aux }) : ies ? t('lightEdit.iesPowerAux', { aux }) : t('lightEdit.powerAux', { aux });
      // IES (L5): the profile's name, its plot, what the file says of it, and that Fast only approximates it.
      iesBlock.style.display = ies ? '' : 'none';
      if (ies && l.ies) {
        iesName.textContent = l.ies.name;
        iesName.title = l.ies.name;
        const profile = iesProfileOf(l.ies.text);
        if (iesShown !== l.ies.text) {
          iesShown = l.ies.text;
          iesPlotHost.replaceChildren(...(profile ? [iesPlot(profile)] : []));
        }
        if (profile) {
          iesInfo.textContent = t('lightEdit.iesInfo', { peak: formatNumber(profile.peak, getLang(), profile.peak < 10 ? 1 : 0), beam: formatNumber(2 * iesHalfAngle(profile), getLang(), 0), sym: t(dyn(`ies.sym.${profile.symmetry}`)) });
          iesNote.textContent = t('lightEdit.iesApprox', { cone: formatNumber(iesSpot(profile).cone, getLang(), 0) });
        } else {
          iesInfo.textContent = '';
          iesNote.textContent = t('lightEdit.iesBroken');
        }
      }
      const at = l.aim ? lightAimPoint(s, l) : null;
      const r = (v: number) => formatNumber(v, getLang(), 0);
      aimNow.textContent = t('lightEdit.aimNow', { what: at ? t('lightEdit.aimHere', { x: r(at[0]), y: r(at[1]), z: r(at[2]) }) : t('lightEdit.aimCentre').toLowerCase() });
      glossy.set(l.glossy);
      camera.set(l.camera);
      shadow.set(l.shadow !== false);
      enabled.set(l.enabled);
      bright.style.display = l.brightField ? '' : 'none';
    },
  );
  // Units of the coordinates follow Settings ▸ General ▸ Units: the scene moving the light updates them too.
  scope.watch((s) => [s.scene.nodes, s.scene.partSizeMm] as const, () => {
    const l = cur();
    if (!l) return;
    const f = lightFrame(store.get(), l);
    xyz.forEach((c, k) => c.set(Math.round(f.position[k] * 100) / 100));
  }, shallowEq);
  const pickBtn = (kind: 'reflect' | 'surface', label: string, tip: string, ic: 'reflect' | 'target') => {
    const b = h('button', { type: 'button', class: 'btn', 'data-tip': tip, 'data-action': `light.${kind}`, onclick: () => (kind === 'reflect' ? ui.set({ pickMode: ui.get().pickMode ? null : { kind: 'reflect', light: id } }) : cmd.pickSurface(ctx, id)) }, icon(ic, 14), label);
    scope.watch((_s, u) => u.pickMode?.kind === kind, (on) => b.setAttribute('aria-pressed', String(on)));
    return b;
  };
  const place = pickBtn('reflect', t('light.placeReflect'), t('light.placeReflectAux'), 'reflect');
  const surface = pickBtn('surface', t('light.placeSurface'), t('light.placeSurfaceAux'), 'target');
  const look = h('button', { type: 'button', class: 'btn', 'data-tip': t('viewport.lookThroughAux'), 'data-kbd': kbdFor('lookThrough'), 'data-action': 'light.look', onclick: () => cmd.toggleLookThrough(ctx, { kind: 'LIGHT', id }) }, icon('lookThrough', 14), t('viewport.lookThrough'));
  scope.watch((_s, u) => u.lookThrough?.kind === 'LIGHT' && u.lookThrough.id === id, (on) => look.setAttribute('aria-pressed', String(on)));
  const dup = h('button', { type: 'button', class: 'btn', style: 'flex:1', 'data-action': 'light.duplicate', onclick: () => cmd.duplicateLight(ctx, id) }, icon('duplicate', 14), t('common.duplicate'));
  const del = h('button', { type: 'button', class: 'btn', style: 'flex:1', 'data-action': 'light.delete', onclick: () => cmd.deleteLight(ctx, id) }, icon('trash', 14), t('common.delete'));
  const aux = (text: string) => h('div', { class: 'note', style: 'padding-left:112px;margin-top:-4px' }, text);
  const body = h(
    'div',
    { class: 'stack', 'data-field': 'light', 'data-light': id },
    field(t('lightEdit.name'), nameField.el),
    ownNote,
    roleRow,
    field(t('lightEdit.type'), type.el),
    iesBlock,
    shapeRow,
    sizeRow,
    sizeYRow,
    radiusRow,
    aux(t('lightEdit.sizeAux')),
    field(t('lightEdit.azimuth'), az.el),
    aux(t('lightEdit.azimuthAux')),
    field(t('lightEdit.elevation'), el.el),
    field(t('lightEdit.distance'), dist.el),
    h('div', { class: 'field-label' }, t('lightEdit.coords')),
    h('div', { class: 'field-row3', 'data-field': 'light-position' }, ...xyz.map((c) => c.el)),
    h('div', { class: 'note', style: 'margin-top:-4px' }, t('lightEdit.coordsAux')),
    field(t('lightEdit.aim'), aimBtn),
    aimNow,
    rollRow,
    spreadRow,
    coneRow,
    blendRow,
    sunRow,
    field(t('lightEdit.colorMode'), mode.el),
    kelvinRow,
    colorRow,
    powerRow,
    multiplierRow,
    powerAux,
    field(t('lightEdit.glossy'), glossy.el),
    field(t('lightEdit.camera'), camera.el),
    bright,
    field(t('lightEdit.shadow'), shadow.el),
    field(t('lightEdit.enabled'), enabled.el),
    h('div', { class: 'row', style: 'flex-wrap:wrap' }, place, surface, look),
    h('p', { class: 'note', style: 'margin:0' }, t('light.placeReflectAux')),
    h('div', { class: 'row' }, dup, del),
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
  // Look through (L4): a saved camera's view in the viewport, navigation moves it; not the active camera (it is the view).
  const look = h('button', { type: 'button', class: 'btn', 'data-tip': t('viewport.lookThroughAux'), 'data-kbd': kbdFor('lookThrough'), 'data-action': 'camera.look', onclick: () => cmd.toggleLookThrough(ctx, { kind: 'CAMERA', id }) }, icon('lookThrough', 14), t('viewport.lookThrough'));
  scope.watch(
    (s, u) => [s.camera.active === id, u.lookThrough?.kind === 'CAMERA' && u.lookThrough.id === id] as const,
    ([active, on]) => {
      look.style.display = active ? 'none' : '';
      look.setAttribute('aria-pressed', String(on));
    },
    (a, b) => a[0] === b[0] && a[1] === b[1],
  );
  const body = h('div', { class: 'stack' }, field(t('camera.name'), name.el), h('div', { class: 'row' }, activate, look), cameraFields(ctx, scope, () => id));
  return section(ctx, 'cameraEdit', t('section.camera'), body);
}
