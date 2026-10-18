// Inspector ▸ Physics (UI.md §2.4, phase S2): the role of the selection in a simulation (static, dynamic or, S9, cloth;
// liquid is coming soon), its mass by density (the material's, from the table of data/physics.ts, or its own),
// friction, bounciness and, for a group or a model, whether it falls as parts. Every change is an action of the
// store (`physics/set`), and a drag of a field is one undo step. Drop simulates the selection at once.
//
// S9: with the role Cloth, the cloth's own fields instead (`physics/cloth`): the fabric (data/fabrics.ts), its Weight
// and Stiffness on top, Thickness, the anchors (none, the top edge, a box as shares of its extent), Pressure (a closed
// shell), self-collision, keeping the area, the resolution of the simulated sheet, and which of the part is cloth (the
// faces selected at the Faces level, or the whole part); Drape over the part lays a new sheet over the selection.

import { MATERIAL_CATEGORIES } from '../../data/materials';
import { BUILT_ROLES, DEFAULT_DENSITY, DENSITY_BY_CATEGORY, PHYSICS_LIMITS, PHYSICS_ROLES, type PhysicsRoleKey } from '../../data/physics';
import { CLOTH_ANCHORS, CLOTH_DEFAULTS, CLOTH_LIMITS, FABRIC_PRESETS, fabricPreset, type ClothAnchor, type FabricKey } from '../../data/fabrics';
import { fallsAsParts, materialDensity, roleOf, shownBounciness, shownFriction, type PhysicsProps, type PhysicsRole } from '../../core/physics';
import { clothIsClosed, clothLevels, clothParams, clothPropsOf, clothSource, type ClothProps } from '../../core/cloth';
import { getMesh } from '../../core/meshes';
import { ancestors, partsUnder, worldMatrix, type NodeId } from '../../core/scene';
import type { ProjectState } from '../../core/store';
import { field, lengthField, numberField, segmented, select, slider, toggle } from '../components/controls';
import { section } from '../components/section';
import { h, icon } from '../dom';
import { dyn, targetLabel } from '../names';
import * as phys from '../physics';
import type { Ctx, Scope } from '../reactive';
import { L, formatNumber, getLang, lbl, t } from '../strings';

/** The group whose single body a part falls with (a DYNAMIC ancestor that does not fall as parts), if any. */
function fallsWith(s: ProjectState, id: NodeId): NodeId | null {
  for (const a of ancestors(s, id)) {
    const node = s.scene.nodes[a];
    if (roleOf(node) === 'DYNAMIC' && !fallsAsParts(node)) return a;
  }
  return null;
}

/** The category whose density a node's material gives, or null without a chosen material. */
function categoryOf(s: ProjectState, id: NodeId): string | null {
  for (const p of partsUnder(s, [id])) {
    const m = s.scene.nodes[p]?.material;
    const mat = m ? s.materials[m] : undefined;
    if (mat && mat.role !== 'DEFAULT') return mat.category;
  }
  return null;
}

export function physicsSection(ctx: Ctx, scope: Scope, ids: NodeId[]): HTMLElement {
  const { store } = ctx;
  const first = ids[0];
  const label = () => L('undo.physics', { target: targetLabel(store.get(), ids) });
  const set = (patch: Partial<PhysicsProps>, gesture?: string) => store.dispatch({ type: 'physics/set', ids, patch, gesture, label: label() });
  const props = (s: ProjectState) => s.scene.nodes[first]?.physics ?? {};

  const role = segmented<PhysicsRoleKey>(
    PHYSICS_ROLES.map((r) => ({
      value: r,
      label: t(dyn(`phys.role.${r}`)),
      title: BUILT_ROLES.has(r) ? t(dyn(`phys.roleTip.${r}`)) : `${t(dyn(`phys.role.${r}`))}: ${t('phys.soon')}`,
      disabled: !BUILT_ROLES.has(r),
    })),
    null,
    (r) => set({ role: r as PhysicsRole }),
    { full: true, ariaLabel: t('phys.role') },
  );
  role.el.setAttribute('data-field', 'phys.role');
  const inherits = h('p', { class: 'note', style: 'margin:0' });

  const density = numberField({
    value: DEFAULT_DENSITY,
    min: PHYSICS_LIMITS.density.min,
    max: PHYSICS_LIMITS.density.max,
    step: 10,
    digits: 0,
    unit: 'kg/m³',
    ariaLabel: t('phys.density'),
    onChange: (v, g) => set({ density: v }, g),
  });
  density.el.setAttribute('data-field', 'phys.density');
  const densityNote = h('span', { class: 'aux' });
  const densityReset = h('button', { type: 'button', class: 'btn btn-sm', onclick: () => set({ density: null }) }, t('phys.densityReset'));
  // U15: bounded factors, so sliders with their field.
  const friction = slider({ value: 0.5, min: PHYSICS_LIMITS.friction.min, max: PHYSICS_LIMITS.friction.max, step: 0.05, digits: 2, ariaLabel: t('phys.friction'), onChange: (v, g) => set({ friction: v }, g) });
  friction.el.setAttribute('data-field', 'phys.friction');
  const bounce = slider({ value: 0.2, min: PHYSICS_LIMITS.bounciness.min, max: PHYSICS_LIMITS.bounciness.max, step: 0.05, digits: 2, ariaLabel: t('phys.bounciness'), onChange: (v, g) => set({ bounciness: v }, g) });
  bounce.el.setAttribute('data-field', 'phys.bounciness');

  const groups = ids.every((id) => store.get().scene.nodes[id]?.kind !== 'PART');
  const asParts = groups ? toggle(false, (v) => set({ asParts: v }), t('phys.asParts')) : null;

  scope.watch(
    (s) => [s.scene.nodes, s.materials] as const,
    () => {
      const s = store.get();
      const p = props(s);
      const roles = new Set(ids.map((id) => roleOf(s.scene.nodes[id])));
      role.set(roles.size === 1 ? [...roles][0] : null);
      const group = fallsWith(s, first);
      inherits.textContent = group ? t('phys.inherits', { group: s.scene.nodes[group]?.name ?? '' }) : '';
      inherits.style.display = group ? '' : 'none';
      const own = typeof p.density === 'number' && p.density > 0;
      const material = materialDensity(s, first);
      density.set(own ? p.density! : material);
      const cat = categoryOf(s, first);
      const catLabel = cat ? lbl(MATERIAL_CATEGORIES.find((c) => c.key === cat)?.label ?? { en: cat, es: cat }) : '';
      densityNote.textContent = own
        ? t('phys.densityOwn')
        : cat
          ? t('phys.densityFrom', { category: catLabel, value: formatNumber(DENSITY_BY_CATEGORY[cat as keyof typeof DENSITY_BY_CATEGORY] ?? material, getLang(), 0) })
          : t('phys.densityDefault', { value: formatNumber(DEFAULT_DENSITY, getLang(), 0) });
      densityReset.style.display = own ? '' : 'none';
      friction.set(shownFriction(s.scene.nodes[first]));
      bounce.set(shownBounciness(s.scene.nodes[first]));
      asParts?.set(p.asParts === true);
    },
    (a, b) => a[0] === b[0] && a[1] === b[1],
  );

  const dropBtn = h('button', { type: 'button', class: 'btn', 'data-action': 'phys.drop', 'data-tip': t('ops.dropAux'), onclick: () => phys.drop(ctx, ids) }, icon('drop', 14), t('ops.drop'));
  const rigid = h(
    'div',
    { class: 'stack', 'data-field': 'phys.rigid' },
    field(t('phys.density'), density.el),
    h('div', { class: 'row', style: 'padding-left:112px;gap:8px;align-items:center' }, densityNote, densityReset),
    field(t('phys.friction'), friction.el),
    field(t('phys.bounciness'), bounce.el),
    asParts ? h('div', { class: 'stack', style: 'gap:2px' }, field(t('phys.asParts'), asParts.el), h('div', { class: 'note', style: 'padding-left:112px' }, t('phys.asPartsAux'))) : null,
    h('p', { class: 'note', style: 'margin:0' }, t('phys.massNote')),
    h('div', { class: 'row' }, dropBtn),
  );
  // S9: the cloth's fields, in place of the rigid body's when the role is Cloth.
  const cloth = clothFields(ctx, scope, ids);
  scope.watch(
    (s) => s.scene.nodes,
    () => {
      const s = store.get();
      const isCloth = ids.every((id) => roleOf(s.scene.nodes[id]) === 'CLOTH');
      rigid.style.display = isCloth ? 'none' : '';
      cloth.style.display = isCloth ? '' : 'none';
    },
  );
  const body = h('div', { class: 'stack', 'data-field': 'physics' }, field(t('phys.role'), role.el), inherits, rigid, cloth);
  return section(ctx, 'physics', t('section.physics'), body);
}

/** S9: the cloth fields of the Physics section (shown when every node of the selection is Cloth). */
function clothFields(ctx: Ctx, scope: Scope, ids: NodeId[]): HTMLElement {
  const { store } = ctx;
  const first = ids[0];
  const label = () => L('undo.physics', { target: targetLabel(store.get(), ids) });
  const set = (patch: { [K in keyof ClothProps]?: ClothProps[K] | null }, gesture?: string) => store.dispatch({ type: 'physics/cloth', ids, patch, gesture, label: label() });
  /** The props of the first part that takes them (a part's own, or its cloth group's). */
  const firstPart = (s: ProjectState) => partsUnder(s, [first])[0] ?? first;
  const props = (s: ProjectState): ClothProps => clothPropsOf(s, firstPart(s));
  const fabric = select(
    FABRIC_PRESETS.map((f) => ({ value: f.key, label: `${lbl(f.label)} · ${formatNumber(f.weightGsm, getLang(), 0)} g/m²` })),
    fabricPreset(undefined).key,
    (v) => set({ fabric: v as FabricKey, weightGsm: null, thicknessMm: null }),
    t('cloth.fabric'),
  );
  fabric.el.setAttribute('data-field', 'cloth.fabric');
  const weight = numberField({ value: 120, min: CLOTH_LIMITS.weight.min, max: CLOTH_LIMITS.weight.max, step: 10, digits: 0, unit: 'g/m²', ariaLabel: t('cloth.weight'), onChange: (v, g) => set({ weightGsm: v }, g) });
  weight.el.setAttribute('data-field', 'cloth.weight');
  const weightNote = h('span', { class: 'aux' });
  const weightReset = h('button', { type: 'button', class: 'btn btn-sm', onclick: () => set({ weightGsm: null }) }, t('cloth.weightReset'));
  const stiffness = slider({ value: 1, min: CLOTH_LIMITS.stiffness.min, max: CLOTH_LIMITS.stiffness.max, step: 0.05, digits: 2, unit: '×', ariaLabel: t('cloth.stiffness'), onChange: (v, g) => set({ stiffness: v }, g) });
  stiffness.el.setAttribute('data-field', 'cloth.stiffness');
  const thickness = lengthField({ value: 1, min: CLOTH_LIMITS.thickness.min, max: CLOTH_LIMITS.thickness.max, step: 0.1, digits: 1, ariaLabel: t('cloth.thickness'), onChange: (v, g) => set({ thicknessMm: v }, g) });
  thickness.el.setAttribute('data-field', 'cloth.thickness');
  const anchor = segmented<ClothAnchor>(
    CLOTH_ANCHORS.map((a) => ({ value: a, label: t(dyn(`cloth.anchor.${a}`)), title: t(dyn(`cloth.anchorTip.${a}`)) })),
    'NONE',
    (a) => set({ anchor: a === 'NONE' ? null : a }),
    { full: true, ariaLabel: t('cloth.anchor') },
  );
  anchor.el.setAttribute('data-field', 'cloth.anchor');
  // The box: from and to, as % of the cloth's extent on each axis.
  const boxField = (end: 'min' | 'max', axis: number) => {
    const c = numberField({
      value: 0,
      min: 0,
      max: 100,
      step: 5,
      digits: 0,
      unit: '%',
      compact: true,
      ariaLabel: `${t(end === 'min' ? 'cloth.boxFrom' : 'cloth.boxTo')} ${'XYZ'[axis]}`,
      onChange: (v, g) => {
        const b = props(store.get()).box ?? CLOTH_DEFAULTS.box;
        const next = { min: [...b.min] as [number, number, number], max: [...b.max] as [number, number, number] };
        next[end][axis] = Math.max(0, Math.min(1, v / 100));
        set({ box: next }, g);
      },
    });
    c.el.setAttribute('data-field', `cloth.box.${end}.${'xyz'[axis]}`);
    return c;
  };
  const box = { min: [0, 1, 2].map((a) => boxField('min', a)), max: [0, 1, 2].map((a) => boxField('max', a)) };
  const boxRows = h(
    'div',
    { class: 'stack', style: 'gap:4px' },
    field(t('cloth.boxFrom'), ...box.min.map((c) => c.el)),
    field(t('cloth.boxTo'), ...box.max.map((c) => c.el)),
    h('div', { class: 'note', style: 'padding-left:112px' }, t('cloth.boxAux')),
  );
  const pressure = slider({ value: 1, min: CLOTH_LIMITS.pressure.min, max: CLOTH_LIMITS.pressure.max, step: 0.05, digits: 2, unit: '×', ariaLabel: t('cloth.pressure'), onChange: (v, g) => set({ pressure: v }, g) });
  pressure.el.setAttribute('data-field', 'cloth.pressure');
  const pressureNote = h('div', { class: 'note', style: 'padding-left:112px' });
  const self = toggle(true, (v) => set({ selfCollision: v ? null : false }), t('cloth.self'));
  const area = toggle(false, (v) => set({ keepArea: v ? true : null }), t('cloth.keepArea'));
  const resolution = lengthField({ value: 0, min: CLOTH_LIMITS.resolution.min, max: CLOTH_LIMITS.resolution.max, step: 1, digits: 1, ariaLabel: t('cloth.resolution'), onChange: (v, g) => set({ resolutionMm: v > 0 ? v : null }, g) });
  resolution.el.setAttribute('data-field', 'cloth.resolution');
  const resolutionNote = h('div', { class: 'note', style: 'padding-left:112px' });
  // Which of the part is cloth: the faces picked at the Faces level, or all of it.
  const faceNote = h('span', { class: 'aux' });
  const useFaces = h(
    'button',
    {
      type: 'button',
      class: 'btn btn-sm',
      'data-action': 'cloth.faceUse',
      onclick: () => {
        const sel = store.get().selection;
        if (sel.faces && sel.faces.indices.length > 0) store.dispatch({ type: 'physics/cloth', ids: [sel.faces.part], patch: { triangles: [...new Set(sel.faces.indices)].sort((a, b) => a - b) }, label: label() });
      },
    },
    t('cloth.faceUse'),
  );
  const wholePart = h('button', { type: 'button', class: 'btn btn-sm', 'data-action': 'cloth.faceClear', onclick: () => set({ triangles: null }) }, t('cloth.faceClear'));
  scope.watch(
    (s) => [s.scene.nodes, s.selection] as const,
    () => {
      const s = store.get();
      const p = props(s);
      const f = fabricPreset(p.fabric);
      const r = clothParams(p);
      fabric.set(f.key);
      const ownWeight = typeof p.weightGsm === 'number';
      weight.set(r.massPerArea * 1000);
      weightNote.textContent = ownWeight ? t('cloth.weightOwn') : t('cloth.weightFrom', { fabric: lbl(f.label), value: formatNumber(f.weightGsm, getLang(), 0) });
      weightReset.style.display = ownWeight ? '' : 'none';
      stiffness.set(p.stiffness ?? CLOTH_DEFAULTS.stiffness);
      thickness.set(r.thickness);
      const a = p.anchor ?? 'NONE';
      anchor.set(a);
      boxRows.style.display = a === 'BOX' ? '' : 'none';
      const b = p.box ?? CLOTH_DEFAULTS.box;
      for (let k = 0; k < 3; k++) {
        box.min[k].set(Math.round(b.min[k] * 100));
        box.max[k].set(Math.round(b.max[k] * 100));
      }
      const part = firstPart(s);
      const closed = clothIsClosed(s, part);
      pressure.set(r.pressure);
      pressure.setDisabled(!closed);
      pressureNote.textContent = closed ? t('cloth.pressureAux') : t('cloth.pressureOpen');
      self.set(r.selfCollision);
      area.set(p.keepArea === true);
      resolution.set(p.resolutionMm ?? 0);
      // What the resolution makes of this part now: the triangles and the longest edge the simulator would get.
      const node = s.scene.nodes[part];
      const data = node?.mesh ? getMesh(node.mesh.id) : undefined;
      if (data) {
        const world = worldMatrix(s, part);
        const levels = clothLevels(data, p.triangles, world, p.resolutionMm);
        const tris = clothSource(data, p.triangles).length * 4 ** levels;
        resolutionNote.textContent = t('cloth.resolutionAux', { n: formatNumber(tris, getLang(), 0), mm: formatNumber(longestEdge(data, p.triangles, world) / 2 ** levels, getLang(), 1) });
      } else resolutionNote.textContent = '';
      const some = p.triangles && p.triangles.length > 0;
      faceNote.textContent = some ? t('cloth.faceSome', { n: formatNumber(p.triangles!.length, getLang(), 0) }) : t('cloth.faceAll');
      wholePart.style.display = some ? '' : 'none';
      const faces = s.selection.level === 'FACES' && s.selection.faces && s.selection.faces.indices.length > 0 && ids.includes(s.selection.faces.part);
      useFaces.style.display = faces ? '' : 'none';
    },
    (x, y) => x[0] === y[0] && x[1] === y[1],
  );
  const startBtn = h('button', { type: 'button', class: 'btn', 'data-action': 'phys.start', 'data-tip': t('phys.startTip'), onclick: () => phys.start(ctx) }, icon('play', 14), t('phys.start'));
  const drapeBtn = h('button', { type: 'button', class: 'btn', 'data-action': 'phys.drape', 'data-tip': t('ops.drapeAux'), onclick: () => phys.drape(ctx, ids) }, t('ops.drape'));
  return h(
    'div',
    { class: 'stack', 'data-field': 'phys.clothFields' },
    field(t('cloth.fabric'), fabric.el),
    h('div', { class: 'note', style: 'padding-left:112px' }, t('cloth.fabricAux')),
    field(t('cloth.weight'), weight.el),
    h('div', { class: 'row', style: 'padding-left:112px;gap:8px;align-items:center' }, weightNote, weightReset),
    field(t('cloth.stiffness'), stiffness.el),
    h('div', { class: 'note', style: 'padding-left:112px' }, t('cloth.stiffnessAux')),
    field(t('cloth.thickness'), thickness.el),
    h('div', { class: 'note', style: 'padding-left:112px' }, t('cloth.thicknessAux')),
    field(t('cloth.anchor'), anchor.el),
    boxRows,
    field(t('cloth.pressure'), pressure.el),
    pressureNote,
    h('div', { class: 'stack', style: 'gap:2px' }, field(t('cloth.self'), self.el), h('div', { class: 'note', style: 'padding-left:112px' }, t('cloth.selfAux'))),
    h('div', { class: 'stack', style: 'gap:2px' }, field(t('cloth.keepArea'), area.el), h('div', { class: 'note', style: 'padding-left:112px' }, t('cloth.keepAreaAux'))),
    field(t('cloth.resolution'), resolution.el),
    resolutionNote,
    field(t('cloth.face'), faceNote),
    h('div', { class: 'row', style: 'padding-left:112px;gap:8px' }, useFaces, wholePart),
    h('p', { class: 'note', style: 'margin:0' }, t('cloth.note')),
    h('div', { class: 'row' }, startBtn, drapeBtn),
  );
}

/** The longest edge of a cloth's source triangles, in the world (what the resolution halves). */
function longestEdge(data: NonNullable<ReturnType<typeof getMesh>>, triangles: readonly number[] | undefined, world: ReturnType<typeof worldMatrix>): number {
  const s = Math.max(Math.hypot(world[0], world[1], world[2]), Math.hypot(world[4], world[5], world[6]), Math.hypot(world[8], world[9], world[10])) || 1;
  const P = data.positions;
  let longest = 0;
  for (const tri of clothSource(data, triangles)) {
    for (let c = 0; c < 3; c++) {
      const a = data.indices[3 * tri + c];
      const b = data.indices[3 * tri + ((c + 1) % 3)];
      longest = Math.max(longest, Math.hypot(P[3 * a] - P[3 * b], P[3 * a + 1] - P[3 * b + 1], P[3 * a + 2] - P[3 * b + 2]));
    }
  }
  return longest * s;
}
