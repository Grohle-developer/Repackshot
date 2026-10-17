// The scene's Section section (phase Q1, UI.md §2.4): the cutting plane of the section view. A switch in the header; to
// make the plane, the axis a click on the model cuts across (X, Y, Z or the surface's normal) and two buttons that arm
// the viewport's next click (one point and the axis, or two points of a line); and, once there is a plane, its point
// and normal in numbers, Flip side, Cap the cut, Remove, and a note of which cut parts are open meshes (no cap).
// Every change is an action of the store (`section/*`), one undo entry per drag.

import type { Vec3 } from '../../core/math';
import { openPartsCut, SECTION_AXES, type SectionAxis } from '../../core/section';
import type { ProjectState } from '../../core/store';
import { field, lengthField, numberField, segmented, toggle } from '../components/controls';
import { section } from '../components/section';
import { h, icon } from '../dom';
import { dynamic, type Ctx, type Scope } from '../reactive';
import { armSection, flipSection, sectionPicking, setSectionAxis, toggleSection } from '../section-commands';
import { L, t } from '../strings';

/** The point and the normal, one row of three fields each; the numbers follow the state. */
function planeEditor(ctx: Ctx, scope: Scope): HTMLElement {
  const { store } = ctx;
  const get = () => store.get().section!;
  const vec = (what: 'point' | 'normal'): HTMLElement => {
    const fields = (['X', 'Y', 'Z'] as const).map((label, k) => {
      const props = {
        value: get()[what][k],
        step: what === 'point' ? 1 : 0.05,
        digits: what === 'point' ? 1 : 3,
        label,
        ariaLabel: `${t(what === 'point' ? 'section.point' : 'section.normal')} ${label}`,
        onChange: (v: number, gesture: string) => {
          const next = [...get()[what]] as Vec3;
          next[k] = v;
          store.dispatch({ type: 'section/patch', patch: { [what]: next }, gesture, label: L(what === 'point' ? 'undo.sectionPoint' : 'undo.sectionNormal') });
          // A normal that came to nothing is not taken: the field goes back to what the plane has.
          control.set(get()[what][k]);
        },
      };
      const control = what === 'point' ? lengthField(props) : numberField(props);
      scope.watch(
        (s) => s.section?.[what][k],
        (v) => {
          if (v !== undefined) control.set(v);
        },
      );
      return control.el;
    });
    const row = field(t(what === 'point' ? 'section.point' : 'section.normal'), h('div', { class: 'row', style: 'gap:4px' }, ...fields));
    row.setAttribute('data-section-field', what);
    if (what === 'normal') row.setAttribute('data-tip', t('section.normalTip'));
    return row;
  };
  const flip = h('button', { type: 'button', class: 'btn', 'data-section-action': 'flip', 'data-tip': t('section.flipTip'), onclick: () => flipSection(ctx) }, icon('refresh', 14), t('section.flip'));
  const cap = toggle(get().cap, (v) => store.dispatch({ type: 'section/patch', patch: { cap: v }, label: L(v ? 'undo.sectionCap' : 'undo.sectionUncap') }), t('section.cap'));
  scope.watch((s) => s.section?.cap, (v) => v !== undefined && cap.set(v));
  const capRow = field(t('section.cap'), cap.el);
  capRow.setAttribute('data-tip', t('section.capTip'));
  capRow.setAttribute('data-section-field', 'cap');
  const remove = h('button', { type: 'button', class: 'btn', 'data-section-action': 'remove', onclick: () => store.dispatch({ type: 'section/clear', label: L('undo.sectionClear') }) }, icon('trash', 14), t('section.remove'));
  return h('div', { class: 'stack', 'data-section': 'plane' }, vec('point'), vec('normal'), capRow, h('div', { class: 'row', style: 'gap:6px' }, flip, remove));
}

/** Which cut parts show their inside: the open meshes the plane crosses. */
function openNote(scope: Scope): HTMLElement {
  return dynamic(
    scope,
    (s) => {
      const p = s.section;
      return p && p.enabled && p.cap ? openPartsCut(s, p).map((id) => s.scene.nodes[id].name).join('\u0000') : '';
    },
    (_sc, key) => {
      if (!key) return null;
      const names = key.split('\u0000');
      return h('div', { class: 'note', 'data-section': 'open' }, names.length === 1 ? t('section.open1', { name: names[0] }) : t('section.openN', { n: names.length, names: names.join(', ') }));
    },
  );
}

export function sectionSection(ctx: Ctx, scope: Scope): HTMLElement {
  const { store, ui } = ctx;
  const sw = toggle(!!store.get().section?.enabled, () => toggleSection(ctx), t('section.switch'));
  sw.el.setAttribute('data-section-switch', '');
  scope.watch((s) => s.section?.enabled ?? false, (on) => sw.set(on));

  // The axis a click cuts across, and the two ways to arm the next click.
  const axis = segmented(
    SECTION_AXES.map((a) => ({ value: a, label: t(`section.axis.${a}`) })),
    ui.get().sectionAxis,
    (a: SectionAxis) => setSectionAxis(ctx, a),
    { ariaLabel: t('section.axis') },
  );
  scope.watch((_s, u) => u.sectionAxis, (a) => axis.set(a));
  const axisRow = field(t('section.axis'), axis.el);
  axisRow.setAttribute('data-tip', t('section.axisTip'));
  const click = h('button', { type: 'button', class: 'btn', 'data-section-action': 'click', 'data-tip': t('section.clickTip'), onclick: () => armSection(ctx, { kind: 'axis', axis: ui.get().sectionAxis }) }, icon('target', 14), t('section.click'));
  const line = h('button', { type: 'button', class: 'btn', 'data-section-action': 'line', 'data-tip': t('section.lineTip'), onclick: () => armSection(ctx, { kind: 'line', first: null }) }, icon('section', 14), t('section.line'));
  scope.watch((_s, u) => u.pickMode, () => {
    click.setAttribute('aria-pressed', String(sectionPicking(ctx)?.kind === 'axis'));
    line.setAttribute('aria-pressed', String(sectionPicking(ctx)?.kind === 'line'));
  });

  // Before there is a plane, a sentence says how to make one; after, its numbers.
  const planeHost = dynamic(
    scope,
    (s: ProjectState) => s.section !== null,
    (sc, has) => (has ? planeEditor(ctx, sc) : h('div', { class: 'note', 'data-section': 'empty' }, t('section.empty'))),
  );
  const body = h(
    'div',
    { class: 'stack', 'data-section': 'body' },
    axisRow,
    h('div', { class: 'row', style: 'gap:6px' }, click, line),
    planeHost,
    openNote(scope),
    h('div', { class: 'note' }, t('section.animate')),
    h('div', { class: 'note' }, t('section.preview')),
  );
  return section(ctx, 'section', t('section.section'), body, sw.el, true);
}
