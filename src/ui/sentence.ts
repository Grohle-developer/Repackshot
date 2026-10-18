// A motion clip written as a plain-language sentence ("The camera orbits
// 90° over 4 s, smooth"): the sentence is how a clip shows in the interface.

import { EASING_KINDS, moveKind } from '../data/animation';
import type { Lang } from '../data/types';
import { amountUnit, clipEnd, clipRepeat, type ClipTarget, type MotionClip } from '../core/animation';
import { resolveExplode } from '../core/explode';
import type { ProjectState } from '../core/store';
import { materialName } from './names';
import { STRINGS, formatNumber, tIn, type StringKey } from './strings';

/** What an own light (L4) is called before it has a name: its kind (an area light of shape SPHERE is a sphere). */
function ownKind(l: { type: string; shape: string }): string {
  return l.type === 'AREA' && l.shape === 'SPHERE' ? 'SPHERE' : l.type;
}

/**
 * Display name of a light: the name given to it; otherwise a setup's light by its role and an own light (L4) by its
 * kind, numbered when the role or the kind repeats.
 */
export function lightName(state: ProjectState, id: string, lang: Lang): string {
  const lights = state.studio.lights;
  const light = lights.find((l) => l.id === id);
  if (!light) return id;
  if (light.name) return light.name;
  if (light.own) {
    const kind = ownKind(light);
    const same = lights.filter((l) => l.own && !l.name && ownKind(l) === kind);
    const base = tIn(lang, `lightName.${kind}` as StringKey);
    return same.length > 1 ? `${base} ${same.indexOf(light) + 1}` : base;
  }
  const same = lights.filter((l) => !l.own && l.role === light.role);
  const base = tIn(lang, `role.${light.role}` as StringKey);
  return same.length > 1 ? `${base} ${same.indexOf(light) + 1}` : base;
}

function subject(state: ProjectState, clip: MotionClip, lang: Lang): string {
  switch (clip.target.kind) {
    case 'CAMERA':
      return tIn(lang, 'say.camera');
    case 'SUBJECT':
      return tIn(lang, 'say.subject');
    case 'NODE':
      return state.scene.nodes[clip.target.id]?.name ?? '?';
    case 'LIGHT':
      return tIn(lang, 'say.light', { name: lightName(state, clip.target.id, lang).toLowerCase() });
    case 'SCENE':
      // Q1: the section plane is what moves, not the environment; N1: the sun goes along its arc.
      // S3c: the parts get the weather of the scene's effects.
      if (clip.move === 'PHYSICS' && clip.parts) return tIn(lang, 'say.parts');
      return tIn(lang, clip.move === 'SECTION' ? 'say.section' : clip.move === 'SUN_ARC' ? 'say.sun' : 'say.scene');
    case 'MATERIAL':
      // N1: a material and every part that wears it.
      return tIn(lang, 'say.material', { name: materialName(state.materials[clip.target.id], lang) });
  }
}

/** A string key built at run time, when it exists. */
function keyIf(key: string): StringKey | null {
  return key in STRINGS.en ? (key as StringKey) : null;
}

/** The distance of an explode: "1.5 × size" or "40 mm". */
export function explodeAmountText(clip: Pick<MotionClip, 'amount' | 'explode'>, lang: Lang): string {
  const unit = resolveExplode(clip.explode).unit;
  return tIn(lang, unit === 'MM' ? 'say.amount.MM' : 'say.amount.SIZE', { n: formatNumber(Math.abs(clip.amount), lang) });
}

/** An explode with its parameters (N6): how, along or from what, how far, and what is special about it. */
function explodeVerb(clip: MotionClip, lang: Lang): string {
  const r = resolveExplode(clip.explode);
  const amount = explodeAmountText(clip, lang);
  const axis = tIn(lang, `say.axis.${r.axis}` as StringKey);
  const axisFrom = tIn(lang, `say.axisFrom.${r.axis}` as StringKey);
  const key: StringKey = r.geometry === 'LINEAR' ? (r.linear === 'STACK' ? 'say.EXPLODE.LINEAR.STACK' : 'say.EXPLODE.LINEAR.SEPARATE') : r.geometry === 'CYLINDRICAL' ? 'say.EXPLODE.CYLINDRICAL' : 'say.EXPLODE.SPHERICAL';
  const extra: string[] = [];
  if (r.levels !== 'NONE') extra.push(tIn(lang, 'say.EXPLODE.levels'));
  if (r.order !== 'AT_ONCE') extra.push(tIn(lang, 'say.EXPLODE.staggered'));
  const pinned = r.pinned.length;
  if (pinned > 0) extra.push(tIn(lang, pinned === 1 ? 'say.EXPLODE.pinned1' : 'say.EXPLODE.pinned', { n: pinned }));
  const text = tIn(lang, key, { amount, axis, axisFrom });
  return extra.length ? `${text} (${extra.join(', ')})` : text;
}

function verb(clip: MotionClip, lang: Lang): string {
  const amount = (n: number) => formatNumber(Math.abs(n), lang);
  if (clip.move === 'EXPLODE' && clip.explode) return explodeVerb(clip, lang);
  // S3b: the recorded front glass of the camera.
  if (clip.move === 'PHYSICS' && clip.glass) return tIn(lang, 'say.PHYSICS_GLASS');
  // S3c: the recorded rain, dust and snow on the parts.
  if (clip.move === 'PHYSICS' && clip.parts) return tIn(lang, 'say.PHYSICS_PARTS');
  switch (clip.move) {
    case 'RISE':
      return tIn(lang, clip.amount < 0 ? 'say.RISE.neg' : 'say.RISE', { amount: amount(clip.amount) });
    case 'DOLLY':
      return tIn(lang, clip.amount < 0 ? 'say.DOLLY.neg' : 'say.DOLLY', { amount: amount(clip.amount) });
    case 'EXPLODE':
      return clip.amount < 0 ? tIn(lang, 'say.EXPLODE.neg') : tIn(lang, 'say.EXPLODE', { amount: amount(clip.amount) });
    case 'VISIBILITY':
      return tIn(lang, clip.amount >= 0.5 ? 'say.VISIBILITY.show' : 'say.VISIBILITY.hide');
    case 'TRACK':
    case 'MOVE': {
      const v = clip.vector ?? (clip.move === 'TRACK' ? [clip.amount, 0, 0] : [0, 0, clip.amount]);
      return tIn(lang, `say.${clip.move}`, { amount: formatNumber(Math.hypot(v[0], v[1], v[2]), lang) });
    }
    case 'TINT':
      return tIn(lang, 'say.TINT');
    case 'SECTION':
      // Q1: along the normal, towards what is cut away (uncovers) or back into what is kept (cuts deeper).
      return tIn(lang, clip.amount < 0 ? 'say.SECTION.neg' : 'say.SECTION', { amount: tIn(lang, 'say.amount.SIZE', { n: amount(clip.amount) }) });
    // N1.
    case 'FADE':
      return tIn(lang, 'say.FADE', { amount: amount(Math.max(0, Math.min(100, clip.amount))) });
    case 'PAN':
      return tIn(lang, clip.amount < 0 ? 'say.PAN.neg' : 'say.PAN', { amount: amount(clip.amount) });
    case 'MATERIAL_COLOR':
      return tIn(lang, 'say.MATERIAL_COLOR');
    case 'SUN_ARC':
      return tIn(lang, 'say.SUN_ARC', { amount: amount(clip.amount), h: formatNumber(Math.abs(clip.amount) / 15, lang) });
    default: {
      // A kind without its own words (a clip kind added later, like a baked simulation): its catalogue name.
      const k = keyIf(`say.${clip.move}`);
      if (k) return tIn(lang, k, { amount: formatNumber(clip.amount, lang) });
      return (moveKind(clip.move)?.label[lang] ?? String(clip.move)).toLowerCase();
    }
  }
}

function easingText(clip: MotionClip, lang: Lang): string {
  if (clip.smoothness === undefined && clip.easing === 'CUSTOM') return tIn(lang, 'say.customCurve');
  return (EASING_KINDS.find((e) => e.key === clip.easing)?.label[lang] ?? clip.easing).toLowerCase();
}

/** "The camera orbits 90° over 4 s, smooth" / "La cámara orbita 90° durante 4 s, suave". */
export function clipSentence(state: ProjectState, clip: MotionClip, lang: Lang): string {
  // A recorded simulation (S2) has no amount and no easing: it plays what was simulated.
  if (clip.move === 'PHYSICS') {
    let p = `${subject(state, clip, lang)} ${verb(clip, lang)} ${tIn(lang, 'say.over', { d: formatNumber(clip.duration, lang) })}`;
    const m = clipRepeat(clip);
    if (m > 1) p += ` ${tIn(lang, 'say.repeat', { n: m })}`;
    if (clip.reverse) p += `, ${tIn(lang, 'say.reversed')}`;
    return p;
  }
  let s = `${subject(state, clip, lang)} ${verb(clip, lang)} ${tIn(lang, 'say.over', { d: formatNumber(clip.duration, lang) })}, ${easingText(clip, lang)}`;
  const n = clipRepeat(clip);
  if (n > 1) s += ` ${tIn(lang, 'say.repeat', { n })}`;
  if (clip.reverse) s += `, ${tIn(lang, 'say.reversed')}`;
  if (clip.target.kind === 'CAMERA' && clip.shot !== null) s += ` (${tIn(lang, 'say.inShot', { n: clip.shot + 1 })})`;
  return s;
}

/** The short form a row of the timeline's tree shows: "orbits 90° · 4 s · smooth". */
export function clipShort(clip: MotionClip, lang: Lang): string {
  const n = clipRepeat(clip);
  const parts = [verb(clip, lang), `${formatNumber(clip.duration, lang)} s${n > 1 ? ` ${tIn(lang, 'say.repeat', { n })}` : ''}`];
  // A recorded simulation (S2) has no curve.
  if (clip.move !== 'PHYSICS') parts.push(easingText(clip, lang));
  if (clip.reverse) parts.push(tIn(lang, 'say.reversed'));
  return parts.join(' · ');
}

/** What a target is called in the timeline: "Camera", the model's name, a part's, a light's, "Environment". */
export function clipTargetName(state: ProjectState, target: ClipTarget, lang: Lang): string {
  switch (target.kind) {
    case 'CAMERA':
      return tIn(lang, 'anim.target.CAMERA');
    case 'SUBJECT': {
      const roots = state.scene.roots;
      return roots.length === 1 ? (state.scene.nodes[roots[0]]?.name ?? tIn(lang, 'anim.target.SUBJECT')) : tIn(lang, 'anim.target.SUBJECT');
    }
    case 'NODE':
      return state.scene.nodes[target.id]?.name ?? '?';
    case 'LIGHT':
      return lightName(state, target.id, lang);
    case 'SCENE':
      return tIn(lang, 'anim.target.SCENE');
    case 'MATERIAL':
      return materialName(state.materials[target.id], lang);
    default:
      return String((target as { kind: string }).kind);
  }
}

/** The name of a clip's kind: "Orbit"; an explode by its geometry: "Spherical exploded view". */
export function clipKindName(clip: MotionClip, lang: Lang): string {
  if (clip.move === 'EXPLODE') {
    const r = resolveExplode(clip.explode);
    const key: StringKey = r.geometry === 'LINEAR' ? (r.linear === 'STACK' ? 'anim.kind.EXPLODE.STACK' : 'anim.kind.EXPLODE.LINEAR') : r.geometry === 'CYLINDRICAL' ? 'anim.kind.EXPLODE.CYLINDRICAL' : 'anim.kind.EXPLODE.SPHERICAL';
    return tIn(lang, key);
  }
  return moveKind(clip.move)?.label[lang] ?? String(clip.move);
}

/** A clip's amount with its unit, for the header: "90°", "40 %", "×1.25", "135 mm", "1.5 × size"; '' without one. */
export function clipAmountText(clip: MotionClip, lang: Lang): string {
  const n = (v: number) => formatNumber(v, lang);
  if (clip.move === 'EXPLODE') return explodeAmountText(clip, lang);
  // Q1: the plane's offset keeps its sign (negative cuts deeper).
  if (clip.move === 'SECTION') return tIn(lang, 'say.amount.SIZE', { n: n(clip.amount) });
  switch (amountUnit(clip.move)) {
    case 'deg':
      return `${n(clip.amount)}°`;
    case 'pct':
      return `${n(clip.amount)} %`;
    case 'factor':
      return `×${n(clip.amount)}`;
    case 'mm':
      return `${n(clip.amount)} mm`;
    case 'm':
      return `${n(clip.amount)} m`;
    case 'W':
      return `${n(clip.amount)} W`;
    case 'parts': {
      const v = clip.vector ?? [clip.amount, 0, 0];
      return tIn(lang, 'say.amount.SIZE', { n: n(Math.hypot(v[0], v[1], v[2])) });
    }
    default:
      return '';
  }
}

/** The properties' header: "Cap · Spherical exploded view · 1.5 × size · 0–3 s". */
export function clipHeader(state: ProjectState, clip: MotionClip, lang: Lang): string {
  const range = `${formatNumber(clip.start, lang)}–${formatNumber(clipEnd(clip), lang)} s`;
  return [clipTargetName(state, clip.target, lang), clipKindName(clip, lang), clipAmountText(clip, lang), range].filter((x) => x !== '').join(' · ');
}
