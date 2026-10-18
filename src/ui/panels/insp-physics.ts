// Inspector ▸ Physics (UI.md §2.4, phases S2 and U16): everything about how the selection takes part in a simulation,
// in two groups. **Motion**: its role (static or dynamic; cloth and liquid are coming soon), a line that says what that
// role does, and only the fields that role uses: its mass by density (the material's, from the table of data/physics.ts,
// or its own), friction and bounciness (a static part's are used too: S2 takes the mean of the frictions and the larger
// bounciness of what touches), for a group or a model whether it falls as parts, and Drop. **Weather** (U16): whether
// each part gets wet and whether dust and snow settle on it, the wettability family it wets as (its material's, or one
// chosen) and the size past which its drops run (core/part-weather.ts, the engine's formula); a note when no effect of
// the scene falls on the parts, with a button that shows the effect that can. Every change is an action of the store
// (`physics/set`): the Motion fields edit the nodes selected, the Weather ones every part under them, in one undo step;
// a drag of a field is one undo step. Drop simulates the selection at once.

import { MATERIAL_CATEGORIES } from '../../data/materials';
import { BUILT_ROLES, DEFAULT_DENSITY, DENSITY_BY_CATEGORY, PHYSICS_LIMITS, PHYSICS_ROLES, type PhysicsRoleKey } from '../../data/physics';
import { WETTABILITY, type WettabilityFamily } from '../../data/wettability';
import { fallsAsParts, materialDensity, physicsSpec, roleOf, shownBounciness, shownFriction, type PhysicsPatch, type PhysicsRole } from '../../core/physics';
import { weatherParts, weatherView } from '../../core/part-weather';
import { ancestors, partsUnder, type NodeId } from '../../core/scene';
import type { ProjectState } from '../../core/store';
import { field, numberField, segmented, select, slider, toggle } from '../components/controls';
import { section } from '../components/section';
import { h, icon } from '../dom';
import { dyn, targetLabel } from '../names';
import * as phys from '../physics';
import type { Ctx, Scope } from '../reactive';
import { noWeatherNote, pointerLine, roleLine as roleText, runSizeLine, selectionRole, surfaceAutoLabel } from '../physics-lines';
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

/**
 * U16: shows effect `id` in Scene ▸ Ambient at its *On the parts* switch (the scene's inspector: nothing selected, the
 * Ambient section open), or the Ambient section without one.
 */
export function showEffectOnParts(ctx: Ctx, id: string | null): void {
  // The interface first, so that the scene's inspector is built with the effect and Ambient open.
  const u = ctx.ui.get();
  ctx.ui.set({ ...(id ? { effectSelected: id } : {}), effectGallery: false, sections: { ...u.sections, ambient: false } });
  ctx.store.dispatch({ type: 'scene/select', ids: [], mode: 'set' });
  requestAnimationFrame(() => {
    // Already the scene's inspector (nothing was selected): it was not rebuilt, so open a folded Ambient by hand.
    const sec = document.querySelector<HTMLElement>('.side-right [data-section="ambient"]');
    if (sec?.hasAttribute('data-collapsed')) sec.querySelector<HTMLElement>('.section-head')?.click();
    const row = id ? document.querySelector<HTMLElement>(`[data-effect="${id}"] [data-knob="ambient.wetParts"]`) : null;
    const target = row ?? sec;
    if (!target) return;
    target.scrollIntoView({ block: 'center' });
    row?.querySelector<HTMLElement>('button.toggle')?.focus({ preventScroll: true });
  });
}

/** A switch that may show a mixed selection (`aria-checked="mixed"`, its knob in the middle); a click on mixed turns all on. */
function triSwitch(label: string, onChange: (v: boolean) => void): { el: HTMLElement; set(v: boolean | null): void } {
  let value: boolean | null = true;
  const el = h('button', { type: 'button', class: 'toggle', role: 'switch', 'aria-label': label, 'aria-checked': 'true', onclick: () => onChange(value !== true) });
  return {
    el,
    set(v) {
      value = v;
      el.setAttribute('aria-checked', v === null ? 'mixed' : String(v));
    },
  };
}

/** The Motion group: the role, what it does, and the fields it uses. */
function motionGroup(ctx: Ctx, scope: Scope, ids: NodeId[]): HTMLElement {
  const { store } = ctx;
  const first = ids[0];
  const label = () => L('undo.physics', { target: targetLabel(store.get(), ids) });
  const set = (patch: PhysicsPatch, gesture?: string) => store.dispatch({ type: 'physics/set', ids, patch, gesture, label: label() });
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
  // U16: what the chosen role does, in one line.
  const roleLine = h('p', { class: 'note', style: 'margin:0', 'data-field': 'phys.roleLine' });
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
  const dropBtn = h('button', { type: 'button', class: 'btn', 'data-action': 'phys.drop', 'data-tip': t('ops.dropAux'), onclick: () => phys.drop(ctx, ids) }, icon('drop', 14), t('ops.drop'));

  // The fields each role uses (S2): density, as parts, the mass and Drop are a dynamic body's; friction and bounciness
  // are a static part's too. A selection of mixed roles shows the fields of both.
  const densityRows = h('div', { class: 'stack', 'data-phys-for': 'DYNAMIC' }, field(t('phys.density'), density.el), h('div', { class: 'row', style: 'padding-left:112px;gap:8px;align-items:center' }, densityNote, densityReset));
  const asPartsRow = asParts ? h('div', { class: 'stack', style: 'gap:2px', 'data-phys-for': 'DYNAMIC' }, field(t('phys.asParts'), asParts.el), h('div', { class: 'note', style: 'padding-left:112px' }, t('phys.asPartsAux'))) : null;
  const massNote = h('p', { class: 'note', style: 'margin:0', 'data-phys-for': 'DYNAMIC' }, t('phys.massNote'));
  const dropRow = h('div', { class: 'row', 'data-phys-for': 'DYNAMIC' }, dropBtn);
  const dynamicOnly: HTMLElement[] = [densityRows, massNote, dropRow, ...(asPartsRow ? [asPartsRow] : [])];

  scope.watch(
    (s) => [s.scene.nodes, s.materials] as const,
    () => {
      const s = store.get();
      const p = props(s);
      const r = selectionRole(s, ids);
      role.set(r);
      roleLine.textContent = roleText(s, ids);
      roleLine.setAttribute('data-role', r ?? 'MIXED');
      for (const el of dynamicOnly) el.style.display = r === 'STATIC' ? 'none' : '';
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

  return h(
    'div',
    { class: 'stack', 'data-phys-group': 'motion' },
    h('div', { class: 'subhead' }, t('phys.motion')),
    field(t('phys.role'), role.el),
    roleLine,
    inherits,
    densityRows,
    field(t('phys.friction'), friction.el),
    field(t('phys.bounciness'), bounce.el),
    asPartsRow,
    massNote,
    dropRow,
  );
}

/** The Weather group (U16): every part under the selection, edited together in one undo step. */
function weatherGroup(ctx: Ctx, scope: Scope, ids: NodeId[]): HTMLElement {
  const { store } = ctx;
  const parts = () => weatherParts(store.get(), ids);
  const set = (patch: PhysicsPatch) => {
    const targets = parts();
    if (targets.length === 0) return;
    store.dispatch({ type: 'physics/set', ids: targets, patch, label: L('undo.weather', { target: targetLabel(store.get(), ids) }) });
  };
  const wet = triSwitch(t('phys.getsWet'), (v) => set({ getsWet: v }));
  wet.el.setAttribute('data-field', 'phys.getsWet');
  const dust = triSwitch(t('phys.getsDust'), (v) => set({ getsDust: v }));
  dust.el.setAttribute('data-field', 'phys.getsDust');
  const wetRow = field(t('phys.getsWet'), wet.el);
  wetRow.setAttribute('data-tip', t('phys.getsWetTip'));
  const dustRow = field(t('phys.getsDust'), dust.el);
  dustRow.setAttribute('data-tip', t('phys.getsDustTip'));
  const dustMoving = h('p', { class: 'note', style: 'margin:0', 'data-field': 'phys.dustMoving' }, t('phys.dustMoving'));

  // The surface: from the material (its family named), or a family of the table; a mixed selection shows Mixed.
  const surface = select(
    [{ value: 'AUTO', label: t('phys.surfaceAuto', { family: '' }) }, ...WETTABILITY.map((w) => ({ value: w.key, label: lbl(w.label) })), { value: 'MIXED', label: t('phys.mixed'), disabled: true }],
    'AUTO',
    (v) => {
      if (v === 'MIXED') return;
      set({ surface: v === 'AUTO' ? null : (v as WettabilityFamily) });
    },
    t('phys.surface'),
  );
  surface.el.setAttribute('data-field', 'phys.surface');
  const auto = surface.el.querySelector('option[value="AUTO"]') as HTMLOptionElement;
  const mixed = surface.el.querySelector('option[value="MIXED"]') as HTMLOptionElement;
  // Never offered in the list; shown as the value while the parts differ.
  mixed.hidden = true;
  const surfaceRow = field(t('phys.surface'), surface.el);
  surfaceRow.setAttribute('data-tip', t('phys.surfaceTip'));
  const runLine = h('p', { class: 'note', style: 'margin:0', 'data-field': 'phys.runSize' });

  // No effect falls on the parts: say so, with the way to the effect that can.
  const goTo = h('button', { type: 'button', class: 'btn btn-sm', 'data-action': 'phys.toEffect' });
  const noWeather = h('div', { class: 'stack', style: 'gap:6px', 'data-field': 'phys.noWeather' }, h('p', { class: 'note', style: 'margin:0' }), h('div', { class: 'row' }, goTo));

  scope.watch(
    (s) => [s.scene.nodes, s.materials, s.effects] as const,
    () => {
      const s = store.get();
      const v = weatherView(s, ids);
      wet.set(v.getsWet);
      dust.set(v.getsDust);
      const moving = movingParts(s);
      dustMoving.style.display = v.parts.length > 0 && v.parts.every((p) => moving.has(p)) ? '' : 'none';
      auto.textContent = surfaceAutoLabel(v);
      surface.set(v.surface ?? 'MIXED');
      // The size past which a drop runs, on the parts that get wet (the engine's formula).
      runLine.textContent = runSizeLine(s, ids);
      // The note, and the effect its button shows.
      const note = noWeatherNote(s);
      noWeather.style.display = note ? '' : 'none';
      if (note) {
        (noWeather.firstChild as HTMLElement).textContent = note.text;
        goTo.textContent = note.button;
        goTo.setAttribute('data-tip', note.effect ? t('phys.editEffectTip') : t('phys.openAmbient'));
        goTo.onclick = () => showEffectOnParts(ctx, note.effect);
      }
    },
    (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2],
  );

  return h('div', { class: 'stack', 'data-phys-group': 'weather' }, h('div', { class: 'subhead' }, t('phys.weather')), wetRow, dustRow, dustMoving, surfaceRow, runLine, noWeather);
}

/** The parts a Start moves (S2's bodies): dust and snow do not settle on them (S3e). */
function movingParts(s: ProjectState): Set<NodeId> {
  return new Set((physicsSpec(s)?.bodies ?? []).flatMap((b) => b.pieces.map((p) => p.part)));
}

/** U16: opens the Physics section of the inspector, if folded, and scrolls it into view. */
export function openPhysicsSection(): void {
  const sec = document.querySelector<HTMLElement>('.side-right [data-section="physics"]');
  if (!sec) return;
  const head = sec.querySelector<HTMLElement>('.section-head');
  if (sec.hasAttribute('data-collapsed')) head?.click();
  sec.scrollIntoView({ block: 'start' });
  head?.focus({ preventScroll: true });
}

/**
 * U16: the pointer of the Material section, under the material's name: *Physics: Static · gets wet as Paint*; a click
 * opens the Physics section. `ids`: the nodes the Physics section edits (at the Faces level, the part of the faces).
 */
export function physicsPointer(ctx: Ctx, scope: Scope, ids: NodeId[]): HTMLElement {
  const el = h('button', { type: 'button', class: 'btn-link phys-pointer', 'data-action': 'phys.pointer', 'data-tip': t('phys.pointerTip'), onclick: () => openPhysicsSection() });
  scope.watch(
    (s) => [s.scene.nodes, s.materials] as const,
    () => {
      el.textContent = pointerLine(ctx.store.get(), ids);
    },
    (a, b) => a[0] === b[0] && a[1] === b[1],
  );
  return el;
}

export function physicsSection(ctx: Ctx, scope: Scope, ids: NodeId[]): HTMLElement {
  const body = h('div', { class: 'stack', 'data-field': 'physics' }, motionGroup(ctx, scope, ids), weatherGroup(ctx, scope, ids));
  return section(ctx, 'physics', t('section.physics'), body);
}
