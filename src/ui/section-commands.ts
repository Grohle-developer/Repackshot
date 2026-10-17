// The commands of the section view (phase Q1, core/section.ts): switch it on and off, flip it, arm the viewport's next
// click to make the plane (across an axis, or by two points) and what that click does. The plane itself is project data
// (`section/*` actions of the store, undoable); the pick mode is interface state.

import { sectionClick, type SectionAxis, type SectionPick } from '../core/section';
import type { Ctx } from './reactive';
import { L, t } from './strings';

/** Section on or off (the first press on a project without a plane makes the default one: across the camera). */
export function toggleSection(ctx: Ctx): void {
  const on = !ctx.store.get().section?.enabled;
  ctx.store.dispatch({ type: 'section/enable', enabled: on, label: L(on ? 'undo.sectionOn' : 'undo.sectionOff') });
}

/** The other side of the plane goes. */
export function flipSection(ctx: Ctx): void {
  ctx.store.dispatch({ type: 'section/flip', label: L('undo.sectionFlip') });
}

/** True when the next click is making a section plane. */
export function sectionPicking(ctx: Ctx): SectionPick | null {
  const pm = ctx.ui.get().pickMode;
  return pm?.kind === 'section' ? pm.pick : null;
}

/** Arms the viewport's next click to make the plane (pressing again, or Esc, puts it down). */
export function armSection(ctx: Ctx, pick: SectionPick): void {
  const now = sectionPicking(ctx);
  const same = now !== null && now.kind === pick.kind && (pick.kind === 'line' || (now.kind === 'axis' && now.axis === pick.axis));
  ctx.ui.set({ pickMode: same ? null : { kind: 'section', pick } });
}

export function setSectionAxis(ctx: Ctx, axis: SectionAxis): void {
  ctx.ui.set({ sectionAxis: axis });
  // Armed already: it goes on with the new axis.
  if (sectionPicking(ctx)?.kind === 'axis') ctx.ui.set({ pickMode: { kind: 'section', pick: { kind: 'axis', axis } } });
}

/**
 * The click of a section pick on the model at `point` (the surface's `normal` there): makes the plane, or remembers the
 * first point of a line. A second point that makes no plane is refused and the mode waits for another.
 */
export function finishSectionPick(ctx: Ctx, pick: SectionPick, point: readonly number[], normal: readonly number[]): void {
  const { action, next } = sectionClick(ctx.store.get(), ctx.ui.get().lookThrough, pick, point, normal);
  if (action) ctx.store.dispatch({ ...action, label: L('undo.sectionSet') });
  else if (next === pick) ctx.ui.toast(t('section.pickRefused'));
  ctx.ui.set({ pickMode: next ? { kind: 'section', pick: next } : null });
}

/** What the pick banner says for a section pick. */
export function sectionBanner(pick: SectionPick): string {
  if (pick.kind === 'line') return t(pick.first ? 'section.pickSecond' : 'section.pickFirst');
  return t('section.pickAxis', { axis: t(`section.axis.${pick.axis}`) });
}
