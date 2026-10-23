// S7: the commands of the liquids: Convert to liquid (the context menu, the Physics section's Liquid role, the palette)
// and the Liquid section's edits. Every change is one action of the store (core/liquid.ts), one undo step.

import { convertible } from '../core/liquid';
import type { NodeId } from '../core/scene';
import { DEFAULT_LIQUID, liquidPreset } from '../data/liquids';
import { targetLabel } from './names';
import type { Ctx } from './reactive';
import { L, t } from './strings';

/** Convert to liquid: each part of `ids` (or under them) becomes a liquid of `preset`, one undo step per gesture. */
export function convertToLiquid(ctx: Ctx, ids: readonly NodeId[], preset: string = DEFAULT_LIQUID): void {
  const s = ctx.store.get();
  const parts = convertible(s, ids);
  const p = liquidPreset(preset);
  if (parts.length === 0 || !p) {
    ctx.ui.toast(t('liquid.nothing'));
    return;
  }
  const gesture = `liquid:${Date.now()}:${Math.random()}`;
  const label = L('undo.toLiquid', { target: targetLabel(s, parts), liquid: p.label });
  for (const source of parts) ctx.store.dispatch({ type: 'liquid/convert', source, preset: p.key, gesture, label });
  // The physics bar is where the liquid is poured.
  ctx.ui.set({ drawer: 'physics' });
}

/** The Liquid section: a new preset for the liquid parts `ids`. */
export function setLiquidPreset(ctx: Ctx, ids: readonly NodeId[], preset: string): void {
  ctx.store.dispatch({ type: 'liquid/set', ids: [...ids], preset, label: L('undo.liquid', { target: targetLabel(ctx.store.get(), [...ids]) }) });
}

/** The Liquid section: the particle spacing (null: automatic); a drag of the field is one gesture. */
export function setLiquidSpacing(ctx: Ctx, ids: readonly NodeId[], spacingMm: number | null, gesture?: string): void {
  ctx.store.dispatch({ type: 'liquid/set', ids: [...ids], spacingMm, gesture, label: L('undo.liquid', { target: targetLabel(ctx.store.get(), [...ids]) }) });
}
