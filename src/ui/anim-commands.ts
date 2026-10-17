// Commands of the animation timeline (phase N6, UI.md §2.5): which clips are selected (and the scene's selection in
// step with them), the "+ Animate…" wizard with its target, duplicate, delete, reverse, split at the playhead, pin in
// the exploded view, the transport and its keys. Every change of the project goes through the store and is undoable;
// the clip selection is interface state, like the scene's.

import { RESERVED_MOVES, sequencePreset } from '../data/animation';
import type { EasingKind, MoveKind } from '../data/types';
import {
  TARGET_MOVES,
  canSplit,
  clipsActingOn,
  defaultAmount,
  explodeClipsFor,
  isPinned,
  materialBaseColor,
  partsWearing,
  totalDuration,
  type ClipTarget,
  type MotionClip,
} from '../core/animation';
import { activeCamera } from '../core/camera';
import { DEFAULT_CURVE } from '../core/curve';
import { explodeParts, newExplode } from '../core/explode';
import { motionHint, type MotionHint } from '../core/motion-hint';
import { partsUnder, selectedNodes, type NodeId } from '../core/scene';
import type { ProjectState } from '../core/store';
import { targetKey, timelineRows } from '../core/timeline';
import { isTyping } from './dom';
import type { Ctx } from './reactive';
import { clipTargetName } from './sentence';
import { L, getLang } from './strings';
import type { WizardState } from './ui-state';

/** The clips selected in the timeline that still exist, the primary one last. */
export function selectedClipIds(ctx: Ctx): string[] {
  const s = ctx.store.get();
  const u = ctx.ui.get();
  const have = new Set(s.animation.clips.map((c) => c.id));
  const ids = u.selectedClips.filter((id) => have.has(id));
  if (u.selectedClip && have.has(u.selectedClip) && !ids.includes(u.selectedClip)) ids.push(u.selectedClip);
  return ids;
}

/** Selects clips (`primary` is the one the properties edit: the last one by default); the wizard closes. */
export function selectClips(ctx: Ctx, ids: readonly string[], primary: string | null = ids[ids.length - 1] ?? null): void {
  const list = [...new Set(ids)];
  if (primary && !list.includes(primary)) list.push(primary);
  ctx.ui.set({ selectedClips: list, selectedClip: primary, wizard: null, selectedShot: null });
}

/** Ctrl / ⌘ click on a clip: in or out of the selection. */
export function toggleClip(ctx: Ctx, id: string): void {
  const cur = selectedClipIds(ctx);
  if (cur.includes(id)) {
    const rest = cur.filter((x) => x !== id);
    selectClips(ctx, rest, rest[rest.length - 1] ?? null);
  } else selectClips(ctx, [...cur, id], id);
}

export function clearClips(ctx: Ctx): void {
  ctx.ui.set({ selectedClips: [], selectedClip: null, selectedShot: null });
}

/** N1: a shot of the camera track to the properties (its camera, length and change); the clips and the wizard go. */
export function selectShot(ctx: Ctx, id: string | null): void {
  ctx.ui.set({ selectedShot: id, selectedClips: [], selectedClip: null, wizard: null });
}

/**
 * A target's row of the tree: selects the target in the scene (a node, the model, a light) and every clip on it. The
 * camera and the environment are not in the scene's selection: only their clips are selected.
 */
export function selectTargetRow(ctx: Ctx, target: ClipTarget): void {
  const s = ctx.store.get();
  const key = targetKey(target);
  const clips = s.animation.clips.filter((c) => targetKey(c.target) === key).map((c) => c.id);
  if (target.kind === 'NODE' && s.scene.nodes[target.id]) {
    const kind = s.scene.nodes[target.id].kind;
    ctx.store.dispatch({ type: 'scene/select', ids: [target.id], mode: 'set', level: kind === 'MODEL' ? 'MODEL' : kind === 'GROUP' ? 'GROUP' : 'PART' });
  } else if (target.kind === 'SUBJECT' && s.scene.roots.length > 0) {
    ctx.store.dispatch({ type: 'scene/select', ids: [...s.scene.roots], mode: 'set', level: 'MODEL' });
  } else if (target.kind === 'LIGHT') {
    ctx.store.dispatch({ type: 'scene/select', ids: [target.id], mode: 'set' });
  } else if (target.kind === 'MATERIAL') {
    // N1: a material's row selects the parts that wear it.
    const parts = partsWearing(s, target.id);
    if (parts.length > 0) ctx.store.dispatch({ type: 'scene/select', ids: parts, mode: 'set', level: 'PART' });
  }
  selectClips(ctx, clips);
}

/** The clips the scene's selection is animated by: their rows are marked in the tree. */
export function relatedClips(state: ProjectState): Set<string> {
  return new Set(clipsActingOn(state, state.selection.ids));
}

/**
 * What "+ Animate…" would animate: the scene's selection (a part or a group as a node, the model as the whole model,
 * a light), or the whole model when nothing is selected; the camera in an empty scene.
 */
export function animateTarget(state: ProjectState): ClipTarget {
  const nodes = selectedNodes(state);
  const node = nodes.length > 0 ? nodeTarget(state, nodes[0]) : null;
  if (node) return node;
  const light = state.selection.ids.find((id) => state.studio.lights.some((l) => l.id === id));
  if (light) return { kind: 'LIGHT', id: light };
  return state.scene.roots.length > 0 ? { kind: 'SUBJECT' } : { kind: 'CAMERA' };
}

/** The target that animates a scene node: the model as the whole model (when it is the only one), a group or a part as itself. */
export function nodeTarget(state: ProjectState, id: NodeId): ClipTarget | null {
  const n = state.scene.nodes[id];
  if (!n) return null;
  if (n.kind === 'MODEL' && state.scene.roots.length === 1) return { kind: 'SUBJECT' };
  return n.kind === 'MODEL' || n.kind === 'GROUP' || n.kind === 'PART' ? { kind: 'NODE', id } : null;
}

/** The name the "+ Animate…" button carries: "Animate Cap…"; null for the whole model or the camera (plain "Animate…"). */
export function animateTargetName(state: ProjectState): string | null {
  const t = animateTarget(state);
  return t.kind === 'NODE' || t.kind === 'LIGHT' ? clipTargetName(state, t, getLang()) : null;
}

/** The amount a new clip of this kind starts with on this target. */
export function wizardAmount(state: ProjectState, target: ClipTarget | null, move: MotionClip['move']): number {
  if (move === 'INTENSITY') return Math.round((state.studio.lights.find((l) => target?.kind === 'LIGHT' && l.id === target.id)?.power ?? 50) * 2);
  if (move === 'ZOOM') return Math.round(activeCamera(state).focalMm * 1.5);
  return defaultAmount(move);
}

/** N1: the colour a new MATERIAL_COLOR goes to without one picked: a warmer version of the material's own. */
export function wizardColor(state: ProjectState, target: ClipTarget): [number, number, number] {
  const c = target.kind === 'MATERIAL' ? materialBaseColor(state.materials[target.id]) : null;
  return c ? [Math.min(1, c[0] * 0.3 + 0.55), Math.min(1, c[1] * 0.3 + 0.1), Math.min(1, c[2] * 0.3 + 0.05)] : [1, 0.62, 0.35];
}

/** Whether a node can be the target of an explode: a model or a group with two parts or more. */
export function canExplode(state: ProjectState, target: ClipTarget): boolean {
  if (target.kind === 'SUBJECT') return explodeParts(state, null).length > 1;
  if (target.kind !== 'NODE') return false;
  const n = state.scene.nodes[target.id];
  return !!n && n.kind !== 'PART' && explodeParts(state, n.id).length > 1;
}

/** N1: the kinds the wizard offers a target: its own, without the reserved ones; an explode only for two parts or more. */
export function wizardMoves(s: ProjectState, target: ClipTarget): MoveKind[] {
  return TARGET_MOVES[target.kind].filter((m) => !RESERVED_MOVES.has(m) && (m !== 'EXPLODE' || canExplode(s, target)));
}

/** Opens the wizard in the properties with a target (the scene's selection by default), at its first step. */
export function openWizard(ctx: Ctx, target: ClipTarget | null = animateTarget(ctx.store.get())): void {
  const s = ctx.store.get();
  const move = target ? (wizardMoves(s, target)[0] ?? null) : null;
  const w: WizardState = {
    target,
    move,
    amount: move ? wizardAmount(s, target, move) : 0,
    start: Math.round(s.animation.playhead * 10) / 10,
    duration: 3,
    easing: 'EASE' as EasingKind,
    shot: null,
    step: 1,
  };
  ctx.ui.set({ wizard: w, selectedClip: null, selectedClips: [], selectedShot: null, drawer: 'animation' });
}

/** The wizard's Add: the new clip, selected. An explode starts with the parameters of `newExplode`. */
export function finishWizard(ctx: Ctx): string | null {
  const w = ctx.ui.get().wizard;
  if (!w || !w.move || !w.target) return null;
  const clip: Omit<MotionClip, 'id'> = { target: w.target, move: w.move, shot: w.target.kind === 'CAMERA' ? w.shot : null, start: w.start, duration: w.duration, amount: w.amount, easing: w.easing };
  if (w.move === 'TINT') clip.color = w.color ?? [1, 0.62, 0.35];
  // N1: a material's colour goes to the one picked (a warmer one of its own when none was).
  if (w.move === 'MATERIAL_COLOR') clip.color = w.color ?? wizardColor(ctx.store.get(), w.target);
  if (w.easing === 'CUSTOM') clip.curve = [...DEFAULT_CURVE];
  if (w.move === 'EXPLODE') clip.explode = newExplode();
  const before = new Set(ctx.store.get().animation.clips.map((c) => c.id));
  ctx.store.dispatch({ type: 'anim/addClip', clip, label: L('undo.addClip') });
  const id = ctx.store.get().animation.clips.find((c) => !before.has(c.id))?.id ?? null;
  ctx.ui.set({ wizard: null });
  if (id) selectClips(ctx, [id]);
  return id;
}

function idsOr(ctx: Ctx, ids?: readonly string[]): string[] {
  return ids ? [...ids] : selectedClipIds(ctx);
}

/** Copies of the clips, each right after its original; the copies are selected. */
export function duplicateClips(ctx: Ctx, ids?: readonly string[]): string[] {
  const which = idsOr(ctx, ids);
  if (which.length === 0) return [];
  const before = new Set(ctx.store.get().animation.clips.map((c) => c.id));
  ctx.store.dispatch({ type: 'anim/duplicateClips', ids: which, label: L('undo.duplicateClips') });
  const made = ctx.store.get().animation.clips.filter((c) => !before.has(c.id)).map((c) => c.id);
  if (made.length > 0) selectClips(ctx, made);
  return made;
}

export function deleteClips(ctx: Ctx, ids?: readonly string[]): void {
  const which = idsOr(ctx, ids);
  if (which.length === 0) return;
  ctx.store.dispatch({ type: 'anim/removeClips', ids: which, label: L(which.length > 1 ? 'undo.removeClips' : 'undo.removeClip') });
  const left = selectedClipIds(ctx).filter((id) => !which.includes(id));
  selectClips(ctx, left, left[left.length - 1] ?? null);
}

export function reverseClips(ctx: Ctx, ids?: readonly string[]): void {
  const which = idsOr(ctx, ids);
  if (which.length > 0) ctx.store.dispatch({ type: 'anim/reverseClips', ids: which, label: L('undo.reverseClip') });
}

/** Whether the clip can be split where the playhead is. */
export function canSplitAtPlayhead(ctx: Ctx, id: string): boolean {
  const s = ctx.store.get();
  const c = s.animation.clips.find((x) => x.id === id);
  return !!c && canSplit(c, s.animation.playhead);
}

export function splitAtPlayhead(ctx: Ctx, id: string): void {
  const s = ctx.store.get();
  if (!canSplitAtPlayhead(ctx, id)) return;
  const before = new Set(s.animation.clips.map((c) => c.id));
  ctx.store.dispatch({ type: 'anim/splitClip', id, t: s.animation.playhead, label: L('undo.splitClip') });
  const second = ctx.store.get().animation.clips.find((c) => !before.has(c.id));
  if (second) selectClips(ctx, [second.id]);
}

/**
 * The context menu's "Pin in the exploded view" for some nodes: their parts become exceptions of the explodes that hold
 * them (or only of `clips`), or are freed when every one of them already is. Null when no explode holds them.
 */
export function pinState(state: ProjectState, nodes: readonly NodeId[], clips?: readonly string[]): { pinned: boolean; clips: MotionClip[] } | null {
  const parts = partsUnder(state, nodes);
  if (parts.length === 0) return null;
  const which = clips ? state.animation.clips.filter((c) => clips.includes(c.id) && c.move === 'EXPLODE') : explodeClipsFor(state, parts);
  if (which.length === 0) return null;
  return { pinned: which.every((c) => isPinned(state, c, parts)), clips: which };
}

export function togglePin(ctx: Ctx, nodes: readonly NodeId[], clips?: readonly string[]): void {
  const s = ctx.store.get();
  const st = pinState(s, nodes, clips);
  if (!st) return;
  const pinned = !st.pinned;
  ctx.store.dispatch({ type: 'anim/pinExplode', parts: partsUnder(s, nodes), pinned, clips: st.clips.map((c) => c.id), label: L(pinned ? 'undo.pinExplode' : 'undo.unpinExplode') });
}

/** A sequence preset replaces the animation (one undo entry brings it back). */
export function applyPreset(ctx: Ctx, key: string): void {
  const p = sequencePreset(key);
  if (!p) return;
  ctx.store.dispatch({ type: 'anim/preset', key, label: L('undo.sequence', { name: p.label }) });
  clearClips(ctx);
}

// --- Transport ---------------------------------------------------------------------------------

export function playPause(ctx: Ctx): void {
  const s = ctx.store.get();
  if (totalDuration(s) <= 0) return;
  if (!s.animation.playing && s.animation.playhead >= totalDuration(s)) ctx.store.dispatch({ type: 'anim/playhead', t: 0 });
  ctx.store.dispatch({ type: 'anim/play', playing: !s.animation.playing });
}

/** The playhead to time t (never before 0). */
export function seek(ctx: Ctx, t: number): void {
  ctx.store.dispatch({ type: 'anim/playhead', t: Math.max(0, t) });
}

export function toStart(ctx: Ctx): void {
  ctx.store.dispatch({ type: 'anim/play', playing: false });
  ctx.store.dispatch({ type: 'anim/playhead', t: 0 });
}

export function toEnd(ctx: Ctx): void {
  ctx.store.dispatch({ type: 'anim/play', playing: false });
  ctx.store.dispatch({ type: 'anim/playhead', t: totalDuration(ctx.store.get()) });
}

/** The playhead `n` frames on (back when negative), on whole frames, never before 0. */
export function stepFrames(ctx: Ctx, n: number): void {
  const a = ctx.store.get().animation;
  const fps = a.fps > 0 ? a.fps : 24;
  ctx.store.dispatch({ type: 'anim/play', playing: false });
  ctx.store.dispatch({ type: 'anim/playhead', t: Math.max(0, (Math.round(a.playhead * fps) + n) / fps) });
}

/**
 * N1: the animation above or below the one the properties edit, in the order of the tree's rows (folded targets
 * skipped); the first one when none is. False when there is none to go to.
 */
export function stepClip(ctx: Ctx, dir: -1 | 1): boolean {
  const s = ctx.store.get();
  const order = timelineRows(s, ctx.ui.get().animFolded).flatMap((r) => (r.kind === 'CLIP' ? [r.clip] : []));
  if (order.length === 0) return false;
  const cur = ctx.ui.get().selectedClip;
  const i = cur ? order.indexOf(cur) : -1;
  const next = i < 0 ? (dir > 0 ? 0 : order.length - 1) : Math.max(0, Math.min(order.length - 1, i + dir));
  if (order[next] === cur) return true;
  selectClips(ctx, [order[next]]);
  return true;
}

/**
 * The timeline's keys while the focus is in it: Space plays or pauses, Home and End jump, ← → move one frame (Shift:
 * ten), Delete removes the selected clips, Ctrl / ⌘ D duplicates them. True when the key was the timeline's.
 */
export function animKey(ctx: Ctx, e: KeyboardEvent): boolean {
  if (isTyping(e) || e.altKey) return false;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && (e.code === 'KeyD' || e.key.toLowerCase() === 'd') && !e.shiftKey) {
    duplicateClips(ctx);
    return true;
  }
  if (mod) return false;
  switch (e.key) {
    case ' ':
      playPause(ctx);
      return true;
    case 'Home':
      toStart(ctx);
      return true;
    case 'End':
      toEnd(ctx);
      return true;
    case 'ArrowLeft':
    case 'ArrowRight':
      stepFrames(ctx, (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1));
      return true;
    case 'ArrowUp':
    case 'ArrowDown':
      // N1 (H1): the tree's own keys, the animation above or below.
      return stepClip(ctx, e.key === 'ArrowUp' ? -1 : 1);
    case 'Delete':
    case 'Backspace':
      if (selectedClipIds(ctx).length === 0) return false;
      deleteClips(ctx);
      return true;
    default:
      return false;
  }
}

/** What the viewport draws for the timeline's selection now (core/motion-hint.ts). */
export function hintFor(ctx: Ctx): MotionHint | null {
  const s = ctx.store.get();
  return motionHint(s, selectedClipIds(ctx), ctx.ui.get().selectedClip, s.animation.playhead);
}
