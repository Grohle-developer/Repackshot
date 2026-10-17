// Image aspect ratios of a camera (U13). The camera carries its own output ratio
// (`CameraState.aspect`), and these are the presets it is offered. Keys are stable: they are added, never
// renamed, because projects and library studios save them. A ratio is `w : h`, width over height, so 4:5 is
// a portrait. CUSTOM keeps its own `w : h` on the camera.

import type { Label } from './types';

export type AspectPresetKey = '3:2' | '4:3' | '16:9' | '1:1' | '5:4' | '4:5' | '9:16' | '21:9' | '2:1' | '65:24';
/** A preset's key, or CUSTOM for a ratio typed by hand. */
export type AspectKey = AspectPresetKey | 'CUSTOM';

export interface AspectPreset {
  key: AspectPresetKey;
  w: number;
  h: number;
  /** The ratio and, where it has one, what it is for. */
  label: Label;
}

/** The presets, in the order the list offers them (the common landscape ones first, then square and portrait, then wide). */
export const ASPECT_PRESETS: readonly AspectPreset[] = [
  { key: '3:2', w: 3, h: 2, label: { es: '3:2 · Foto 35 mm', en: '3:2 · 35 mm photo' } },
  { key: '4:3', w: 4, h: 3, label: { es: '4:3', en: '4:3' } },
  { key: '16:9', w: 16, h: 9, label: { es: '16:9 · Vídeo', en: '16:9 · Video' } },
  { key: '1:1', w: 1, h: 1, label: { es: '1:1 · Cuadrado', en: '1:1 · Square' } },
  { key: '5:4', w: 5, h: 4, label: { es: '5:4', en: '5:4' } },
  { key: '4:5', w: 4, h: 5, label: { es: '4:5 · Retrato', en: '4:5 · Portrait' } },
  { key: '9:16', w: 9, h: 16, label: { es: '9:16 · Vertical', en: '9:16 · Tall' } },
  { key: '21:9', w: 21, h: 9, label: { es: '21:9 · Ultra ancho', en: '21:9 · Ultrawide' } },
  { key: '2:1', w: 2, h: 1, label: { es: '2:1', en: '2:1' } },
  { key: '65:24', w: 65, h: 24, label: { es: '65:24 · Panorámica', en: '65:24 · Panoramic' } },
];

/** The entry of the list for a ratio typed by hand. */
export const ASPECT_CUSTOM_LABEL: Label = { es: 'Propia', en: 'Custom' };

/** Every key the list offers: the presets and CUSTOM last. */
export const ASPECT_KEYS: readonly AspectKey[] = [...ASPECT_PRESETS.map((p) => p.key), 'CUSTOM'];

/** The preset a key names, or undefined (CUSTOM and anything unknown have none). */
export function aspectPreset(key: string): AspectPreset | undefined {
  return ASPECT_PRESETS.find((p) => p.key === key);
}

/** The label of a key in the list. */
export function aspectLabel(key: AspectKey): Label {
  return aspectPreset(key)?.label ?? ASPECT_CUSTOM_LABEL;
}
