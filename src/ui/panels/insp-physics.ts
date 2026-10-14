// Inspector ▸ Physics (UI.md §2.4, phase S2): the role of the selection in a simulation (static or dynamic; cloth and
// liquid are coming soon), its mass by density (the material's, from the table of data/physics.ts, or its own),
// friction, bounciness and, for a group or a model, whether it falls as parts. Every change is an action of the
// store (`physics/set`), and a drag of a field is one undo step. Drop simulates the selection at once.

import { MATERIAL_CATEGORIES } from '../../data/materials';
import { BUILT_ROLES, DEFAULT_DENSITY, DENSITY_BY_CATEGORY, PHYSICS_LIMITS, PHYSICS_ROLES, type PhysicsRoleKey } from '../../data/physics';
import { fallsAsParts, materialDensity, roleOf, shownBounciness, shownFriction, type PhysicsProps, type PhysicsRole } from '../../core/physics';
import { ancestors, partsUnder, type NodeId } from '../../core/scene';
import type { ProjectState } from '../../core/store';
import { field, numberField, segmented, toggle } from '../components/controls';
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
  const friction = numberField({ value: 0.5, min: PHYSICS_LIMITS.friction.min, max: PHYSICS_LIMITS.friction.max, step: 0.05, digits: 2, fill: true, ariaLabel: t('phys.friction'), onChange: (v, g) => set({ friction: v }, g) });
  friction.el.setAttribute('data-field', 'phys.friction');
  const bounce = numberField({ value: 0.2, min: PHYSICS_LIMITS.bounciness.min, max: PHYSICS_LIMITS.bounciness.max, step: 0.05, digits: 2, fill: true, ariaLabel: t('phys.bounciness'), onChange: (v, g) => set({ bounciness: v }, g) });
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
  const body = h(
    'div',
    { class: 'stack', 'data-field': 'physics' },
    field(t('phys.role'), role.el),
    inherits,
    field(t('phys.density'), density.el),
    h('div', { class: 'row', style: 'padding-left:112px;gap:8px;align-items:center' }, densityNote, densityReset),
    field(t('phys.friction'), friction.el),
    field(t('phys.bounciness'), bounce.el),
    asParts ? h('div', { class: 'stack', style: 'gap:2px' }, field(t('phys.asParts'), asParts.el), h('div', { class: 'note', style: 'padding-left:112px' }, t('phys.asPartsAux'))) : null,
    h('p', { class: 'note', style: 'margin:0' }, t('phys.massNote')),
    h('div', { class: 'row' }, dropBtn),
  );
  return section(ctx, 'physics', t('section.physics'), body);
}
