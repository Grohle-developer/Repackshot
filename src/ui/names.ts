// Display names for model objects, in the current language (or both, for
// undo labels that must survive a language switch).

import { materialPreset } from '../data/materials';
import { studioPreset } from '../data/studios';
import { lightSetup } from '../data/light-setups';
import type { Label, Lang, StudioPreset } from '../data/types';
import type { CameraState } from '../core/camera';
import type { MaterialInstance } from '../core/materials';
import { partsUnder, type NodeId } from '../core/scene';
import type { ProjectState } from '../core/store';
import { L, getLang, tIn, type StringKey } from './strings';
import { lightName } from './sentence';

export { lightName };

/** A material's name: the user's, or the catalogue label (+ "(edited)"). */
export function materialName(mat: MaterialInstance | undefined, lang: Lang = getLang()): string {
  if (!mat) return tIn(lang, 'material.none');
  if (mat.name) return mat.name;
  if (mat.role === 'DEFAULT') return mat.edited ? tIn(lang, 'material.edited', { name: tIn(lang, 'material.default') }) : tIn(lang, 'material.default');
  const base = mat.origin ? (materialPreset(mat.origin)?.label[lang] ?? mat.origin) : tIn(lang, 'material.own');
  return mat.edited ? tIn(lang, 'material.edited', { name: base }) : base;
}

export function materialLabel(mat: MaterialInstance | undefined): Label {
  return { en: materialName(mat, 'en'), es: materialName(mat, 'es') };
}

export function presetLabel(key: string): Label {
  return materialPreset(key)?.label ?? { en: key, es: key };
}

/**
 * Product type label; GENERIC shows as "Standard" (the boot mode). An own type (`custom`, the definition the
 * project holds) is called what the person called it.
 */
export function studioLabel(key: string, custom?: StudioPreset | null): Label {
  if (custom && custom.key === key) return custom.label;
  if (key === 'GENERIC') return { en: tIn('en', 'product.standard'), es: tIn('es', 'product.standard') };
  return studioPreset(key)?.label ?? { en: key, es: key };
}

export function setupLabel(key: string): Label {
  return lightSetup(key)?.label ?? { en: key, es: key };
}

export function cameraName(state: ProjectState, cam: CameraState | undefined, lang: Lang = getLang()): string {
  if (!cam) return '';
  if (cam.name) return cam.name;
  const i = Object.keys(state.camera.cameras).indexOf(cam.id);
  return tIn(lang, 'cameras.default', { n: i + 1 });
}

export function cameraLabel(state: ProjectState, cam: CameraState | undefined): Label {
  return { en: cameraName(state, cam, 'en'), es: cameraName(state, cam, 'es') };
}

/** What a set of nodes is called in a sentence: one name, or "3 parts". */
export function targetLabel(state: ProjectState, ids: readonly NodeId[]): Label {
  const nodes = ids.filter((id) => state.scene.nodes[id]);
  if (nodes.length === 1) {
    const n = state.scene.nodes[nodes[0]].name;
    return { en: n, es: n };
  }
  if (nodes.length === 0) {
    const roots = state.scene.roots;
    if (roots.length === 1) {
      const n = state.scene.nodes[roots[0]].name;
      return { en: n, es: n };
    }
  }
  return L('inspector.parts', { n: partsUnder(state, nodes.length ? nodes : state.scene.roots).length });
}

export function targetName(state: ProjectState, ids: readonly NodeId[]): string {
  return targetLabel(state, ids)[getLang()];
}

/** A string key built at run time (role.KEY, level.PART...), typed loosely on purpose. */
export function dyn(key: string): StringKey {
  return key as StringKey;
}

/** Cache key of a material sphere: presets by key, everything else by content (family and parameters). */
export function thumbKey(mat: MaterialInstance): string {
  if (mat.preset && !mat.edited && mat.role !== 'DEFAULT') return `preset:${mat.preset}`;
  const text = JSON.stringify([mat.family, mat.params]);
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return `inst:${(hash >>> 0).toString(36)}`;
}
