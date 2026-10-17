// K1, not ported from EZ Packshot: the scene types of INTERIORS.md §3.1. A scene type is not a mode: it rewrites default
// values and leaves every control where it is. This file is the table of those values; what applies them, and remembers
// what they replaced so that switching back leaves the project as it was, is src/core/scene-type.ts.

import type { Label, RGBA, SceneType } from './types';

/**
 * What switching to a scene type writes. A field left out is not written (Product writes nothing: it is what the
 * project is today). Each field is one row of the table of INTERIORS.md §3.1 that exists in the program today; the
 * rows that name a feature of a later phase are not here (the room and the cyclorama of K2, the auto exposure, the eye
 * height and the straight verticals of K3), nor the displayed unit, which is a setting of the application and not of
 * the project (ROADMAP K1, "Qué no encajó").
 */
export interface SceneTypeDefaults {
  /**
   * Row "Entorno": the environment kind. SKY is the sun and sky of a window; STUDIO is the studio dome. An HDRI that the
   * person loaded is never replaced (it is the "o HDRI interior" of the table, and `worldFor` lets it win too).
   */
  environment?: 'SKY' | 'STUDIO';
  /** Row "Entorno", "cúpula blanca": the background is this plain colour (linear RGBA) instead of the environment. */
  background?: RGBA;
  /** Row "Rebotes": most surface interactions per path (Advanced ▸ Max bounces). */
  maxBounces?: number;
  /** Row "Cáusticas": the render window's switch. */
  caustics?: 'OFF';
  /**
   * Row "Sombra de suelo": the contact shadow of the studio floor, on or off, and when on, how dark it draws in the
   * Fast viewport (`environment.groundShadow`). Interior has none of its own: the room puts it.
   */
  floorShadow?: { on: boolean; opacity?: number };
  /** Row "Transformada": the view transform. */
  viewTransform?: 'STANDARD' | 'AGX';
  /** Row "Muestras objetivo": samples per pixel (the quality tier is the one with exactly these, else custom). */
  samples?: number;
  /** Row "Muestras objetivo", "adaptativo": finish by noise, so the easy pixels stop early. */
  adaptive?: boolean;
  /** Row "Muestras objetivo", "denoise": denoise in the viewport and in the render. */
  denoise?: boolean;
  /** Row "Cámara": the focal length of every camera that is not locked. */
  focalMm?: number;
  /** K3, row "Cámara", "verticales rectas": the straight verticals of every camera that is not locked. */
  straightVerticals?: boolean;
  /** K3, row "Exposición": the automatic exposure (the dial becomes its compensation). */
  autoExposure?: boolean;
}

export interface SceneTypeEntry {
  key: SceneType;
  label: Label;
  /** What the type is for, one line (the tooltip of its button). */
  intent: Label;
  defaults: SceneTypeDefaults;
}

/** The scene types, in the order of the control. The keys are stable. */
export const SCENE_TYPES: readonly SceneTypeEntry[] = [
  {
    key: 'PRODUCT',
    label: { es: 'Producto', en: 'Product' },
    intent: {
      es: 'Una pieza en un estudio: la cúpula de estudio y la exposición y la óptica del tipo de producto.',
      en: 'One piece in a studio: the studio dome, and the exposure and lens of the product type.',
    },
    defaults: {},
  },
  {
    key: 'INTERIOR',
    label: { es: 'Interior', en: 'Interior' },
    intent: {
      es: 'Mobiliario en su contexto: sol y cielo por la ventana, más rebotes, sin cáusticas, AgX, muestras adaptativas con denoise, una óptica ancha con verticales rectas y exposición automática.',
      en: 'Furniture in its context: sun and sky through the window, more bounces, no caustics, AgX, adaptive samples with denoise, a wide lens with straight verticals, and automatic exposure.',
    },
    defaults: {
      environment: 'SKY',
      maxBounces: 16,
      caustics: 'OFF',
      floorShadow: { on: false },
      viewTransform: 'AGX',
      samples: 512,
      adaptive: true,
      denoise: true,
      focalMm: 28,
      straightVerticals: true,
      autoExposure: true,
    },
  },
  {
    key: 'CATALOGUE',
    label: { es: 'Catálogo', en: 'Catalogue' },
    intent: {
      es: 'Estudio de catálogo: cúpula blanca, silo sobre blanco con una sombra de contacto suave, menos rebotes, sin cáusticas, transformada Estándar y una óptica normal.',
      en: 'Catalogue studio: white dome, a shot on white with a soft contact shadow, fewer bounces, no caustics, the Standard view transform and a normal lens.',
    },
    defaults: {
      environment: 'STUDIO',
      background: [1, 1, 1, 1],
      maxBounces: 8,
      caustics: 'OFF',
      floorShadow: { on: true, opacity: 0.35 },
      viewTransform: 'STANDARD',
      samples: 256,
      focalMm: 50,
    },
  },
];

export const SCENE_TYPE_KEYS: readonly SceneType[] = SCENE_TYPES.map((t) => t.key);

export function sceneTypeEntry(key: SceneType): SceneTypeEntry {
  return SCENE_TYPES.find((t) => t.key === key) ?? SCENE_TYPES[0];
}
