// A motion clip written as a plain-language sentence ("The camera orbits
// 90° over 4 s, smooth"): the sentence is how a clip shows in the interface.

import { EASING_KINDS } from '../data/animation';
import type { Lang } from '../data/types';
import type { MotionClip } from '../core/animation';
import type { ProjectState } from '../core/store';
import { formatNumber, tIn, type StringKey } from './strings';

/** Display name of a light (its role, numbered when the role repeats). */
export function lightName(state: ProjectState, id: string, lang: Lang): string {
  const lights = state.studio.lights;
  const light = lights.find((l) => l.id === id);
  if (!light) return id;
  const same = lights.filter((l) => l.role === light.role);
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
      return tIn(lang, 'say.scene');
  }
}

function verb(clip: MotionClip, lang: Lang): string {
  const amount = (n: number) => formatNumber(Math.abs(n), lang);
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
    default:
      return tIn(lang, `say.${clip.move}` as StringKey, { amount: formatNumber(clip.amount, lang) });
  }
}

/** "The camera orbits 90° over 4 s, smooth" / "La cámara orbita 90° durante 4 s, suave". */
export function clipSentence(state: ProjectState, clip: MotionClip, lang: Lang): string {
  const easing = EASING_KINDS.find((e) => e.key === clip.easing)?.label[lang] ?? clip.easing;
  let s = `${subject(state, clip, lang)} ${verb(clip, lang)} ${tIn(lang, 'say.over', { d: formatNumber(clip.duration, lang) })}, ${easing.toLowerCase()}`;
  if (clip.target.kind === 'CAMERA' && clip.shot !== null) s += ` (${tIn(lang, 'say.inShot', { n: clip.shot + 1 })})`;
  return s;
}
