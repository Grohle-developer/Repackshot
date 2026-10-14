// Catalogue data ported from EZPackshot (https://github.com/Grohle/EZPackshot, GPL-3.0) by its author for Repackshot (PolyForm Noncommercial 1.0.0); values are data, the implementation is new.

import type {
  EasingItem,
  ExplodeItem,
  Label,
  MoveItem,
  MoveKind,
  SequencePreset,
  TargetItem,
} from './types';

// Animation catalogues (upstream MOVE_ITEMS_*, EASING_ITEMS_*, TARGET_ITEMS_*,
// EXPLODE_ITEMS_*, SEQUENCE_PRESETS). A sequence is two independent lists:
//   - Shots: which camera is seen at each moment. They generate the cuts.
//   - Clips: what moves, when and how much. They add up.
// Everything is baked frame by frame with the easing curve applied
// analytically (see `ease` in core/light-math.ts), so there is no Bezier
// interpolation to surprise anyone.

/** The 15 move kinds. `amountLabel` says what the clip's single amount means. */
export const MOVE_KINDS: readonly MoveItem[] = [
  {
    key: 'ORBIT',
    label: { es: 'Orbita', en: 'Orbit' },
    description: {
      es: 'Gira alrededor del centro de la pieza',
      en: 'Circles the centre of the model',
    },
    amountLabel: { es: 'Grados', en: 'Degrees' },
  },
  {
    key: 'RISE',
    label: { es: 'Elevacion', en: 'Rise' },
    description: { es: 'Sube o baja describiendo un arco', en: 'Rises or drops in an arc' },
    amountLabel: { es: 'Grados', en: 'Degrees' },
  },
  {
    key: 'DOLLY',
    label: { es: 'Acercar', en: 'Push' },
    description: {
      es: 'Se acerca o aleja del centro, en %',
      en: 'Moves toward or away from the centre, in %',
    },
    amountLabel: { es: 'Porcentaje', en: 'Percent' },
  },
  {
    key: 'TRACK',
    label: { es: 'Travelling', en: 'Track' },
    description: {
      es: 'Desplazamiento lateral y vertical propio',
      en: 'Sideways and vertical move along its own axes',
    },
  },
  {
    key: 'MOVE',
    label: { es: 'Desplazar', en: 'Translate' },
    description: { es: 'Traslacion libre en X, Y, Z', en: 'Free translation in X, Y, Z' },
  },
  {
    key: 'SPIN',
    label: { es: 'Giro propio', en: 'Spin' },
    description: { es: 'Gira sobre su propio eje Z', en: 'Rotates about its own Z axis' },
    amountLabel: { es: 'Grados', en: 'Degrees' },
  },
  {
    key: 'TUMBLE',
    label: { es: 'Vuelco', en: 'Tumble' },
    description: { es: 'Gira sobre su propio eje X', en: 'Rotates about its own X axis' },
    amountLabel: { es: 'Grados', en: 'Degrees' },
  },
  {
    key: 'SCALE',
    label: { es: 'Escalar', en: 'Scale' },
    description: { es: 'Cambia de tamano por un factor', en: 'Changes size by a factor' },
    amountLabel: { es: 'Factor', en: 'Factor' },
  },
  {
    key: 'ZOOM',
    label: { es: 'Zoom optico', en: 'Optical zoom' },
    description: {
      es: 'Cambia la focal en mm. Solo camaras',
      en: 'Changes focal length in mm. Cameras only',
    },
    amountLabel: { es: 'Focal destino (mm)', en: 'Target focal (mm)' },
  },
  {
    key: 'FOCUS',
    label: { es: 'Foco', en: 'Focus pull' },
    description: {
      es: 'Cambia la distancia de enfoque. Solo camaras',
      en: 'Changes focus distance. Cameras only',
    },
    amountLabel: { es: 'Distancia destino', en: 'Target distance' },
  },
  {
    key: 'INTENSITY',
    label: { es: 'Intensidad', en: 'Intensity' },
    description: {
      es: 'Sube o baja la potencia. Solo luces',
      en: 'Raises or lowers power. Lights only',
    },
    amountLabel: { es: 'Potencia destino (W)', en: 'Target power (W)' },
  },
  {
    key: 'TINT',
    label: { es: 'Color de luz', en: 'Light colour' },
    description: { es: 'Transicion de color. Solo luces', en: 'Colour transition. Lights only' },
  },
  {
    key: 'HDRI',
    label: { es: 'Barrido de luz', en: 'Light sweep' },
    description: { es: 'Rota el HDRI del entorno', en: 'Rotates the environment HDRI' },
    amountLabel: { es: 'Grados', en: 'Degrees' },
  },
  {
    key: 'EXPLODE',
    label: { es: 'Despiece', en: 'Explode' },
    description: {
      es: 'Separa las piezas marcadas desde el centro',
      en: 'Separates the marked parts from the centre',
    },
    amountLabel: { es: 'Separacion', en: 'Spread' },
  },
  {
    key: 'VISIBILITY',
    label: { es: 'Visibilidad', en: 'Visibility' },
    description: { es: 'Aparece u oculta el objetivo', en: 'Shows or hides the target' },
  },
];

/** Fallback meaning of a clip's amount for moves without an `amountLabel`. */
export const DEFAULT_AMOUNT_LABEL: Label = { es: 'Cantidad', en: 'Amount' };

/** Easing curves; see `ease` in core/light-math.ts. */
export const EASING_KINDS: readonly EasingItem[] = [
  {
    key: 'LINEAR',
    label: { es: 'Lineal', en: 'Linear' },
    description: {
      es: 'Velocidad constante. Obligatorio en bucles',
      en: 'Constant speed. Required for loops',
    },
  },
  {
    key: 'EASE',
    label: { es: 'Suave', en: 'Smooth' },
    description: {
      es: 'Arranca y frena. El look cinematografico',
      en: 'Accelerates and brakes. The cinematic look',
    },
  },
  {
    key: 'EASE_IN',
    label: { es: 'Entrada suave', en: 'Ease in' },
    description: { es: 'Arranca despacio, acaba a tope', en: 'Starts slow, ends fast' },
  },
  {
    key: 'EASE_OUT',
    label: { es: 'Salida suave', en: 'Ease out' },
    description: { es: 'Arranca a tope, frena al final', en: 'Starts fast, brakes at the end' },
  },
  {
    key: 'EASE_STRONG',
    label: { es: 'Muy suave', en: 'Very smooth' },
    description: { es: 'Arranque y frenada largos', en: 'Long ramp up and down' },
  },
];

/** What a clip can act on. */
export const TARGET_KINDS: readonly TargetItem[] = [
  {
    key: 'OBJECT',
    label: { es: 'Objeto', en: 'Object' },
    description: { es: 'Una camara, luz o pieza concreta', en: 'A specific camera, light or part' },
  },
  {
    key: 'SUBJECT',
    label: { es: 'Pieza', en: 'Model' },
    description: {
      es: 'Todo el conjunto importado, girando sobre su centro',
      en: 'The whole imported assembly, about its centre',
    },
  },
  {
    key: 'SCENE',
    label: { es: 'Entorno', en: 'Environment' },
    description: { es: 'El HDRI y ajustes globales', en: 'The HDRI and global settings' },
  },
];

/** How the parts separate in an EXPLODE move. */
export const EXPLODE_MODES: readonly ExplodeItem[] = [
  {
    key: 'RADIAL',
    label: { es: 'Radial', en: 'Radial' },
    description: {
      es: 'Cada pieza sale hacia fuera desde el centro',
      en: 'Each part moves outward from the centre',
    },
  },
  {
    key: 'AXIS_X',
    label: { es: 'Eje X', en: 'X axis' },
    description: {
      es: 'Todas se separan a lo largo del eje X',
      en: 'Everything separates along the X axis',
    },
  },
  {
    key: 'AXIS_Y',
    label: { es: 'Eje Y', en: 'Y axis' },
    description: {
      es: 'Todas se separan a lo largo del eje Y',
      en: 'Everything separates along the Y axis',
    },
  },
  {
    key: 'AXIS_Z',
    label: { es: 'Eje Z', en: 'Z axis' },
    description: {
      es: 'Todas se separan en vertical, como una torre',
      en: 'Everything separates vertically, like a tower',
    },
  },
  {
    key: 'CYLINDRICAL',
    label: { es: 'Cilindrica', en: 'Cylindrical' },
    description: {
      es: 'Salen en abanico sin subir ni bajar',
      en: 'Fans out without rising or dropping',
    },
  },
  {
    key: 'CUSTOM',
    label: { es: 'Por pieza', en: 'Per part' },
    description: {
      es: 'Cada pieza en la direccion que le fijes',
      en: 'Each part in the direction you set for it',
    },
  },
  // N6: the three geometries of an exploded view. CYLINDRICAL (above) is the radial one: away from an axis.
  {
    key: 'LINEAR',
    label: { es: 'Lineal', en: 'Linear' },
    description: {
      es: 'A lo largo de un eje: se separan desde el centro o se apilan en orden',
      en: 'Along an axis: they separate from the middle or stack in order',
    },
  },
  {
    key: 'SPHERICAL',
    label: { es: 'Esferica', en: 'Spherical' },
    description: {
      es: 'Cada pieza se aleja de un punto, el centro',
      en: 'Each part moves away from a point, the centre',
    },
  },
];

// Move groups (upstream AIMING_MOVES ... COLOR_MOVES).
/** Moves that make the target look at the centre of the part. */
export const AIMING_MOVES: ReadonlySet<MoveKind> = new Set<MoveKind>(['ORBIT', 'RISE', 'DOLLY']);
/** Moves that only make sense for cameras. */
export const CAMERA_MOVES: ReadonlySet<MoveKind> = new Set<MoveKind>(['ZOOM', 'FOCUS']);
/** Moves that only make sense for lights. */
export const LIGHT_MOVES: ReadonlySet<MoveKind> = new Set<MoveKind>(['INTENSITY', 'TINT']);
/** Moves that act on the environment. */
export const SCENE_MOVES: ReadonlySet<MoveKind> = new Set<MoveKind>(['HDRI']);
/** Moves driven by a displacement vector instead of a single amount. */
export const VECTOR_MOVES: ReadonlySet<MoveKind> = new Set<MoveKind>(['TRACK', 'MOVE']);
/** Moves driven by a colour. */
export const COLOR_MOVES: ReadonlySet<MoveKind> = new Set<MoveKind>(['TINT']);

// Sequence presets. `shots` are the durations in seconds of each shot, in
// order. A clip with target CAM acts on the camera of shot number `shot`
// (zero based); SUBJECT and SCENE clips have `shot: null`. Times are seconds
// from the start of the whole sequence.
export const SEQUENCE_PRESETS: readonly SequencePreset[] = [
  {
    key: 'TURNTABLE',
    label: { es: 'Plato giratorio 360', en: 'Turntable 360' },
    shots: [4],
    clips: [
      { move: 'SPIN', target: 'SUBJECT', shot: null,
        start: 0, duration: 4, amount: 360, easing: 'LINEAR' },
    ],
  },
  {
    key: 'ORBIT360',
    label: { es: 'Orbita completa', en: 'Full orbit' },
    shots: [8],
    clips: [
      { move: 'ORBIT', target: 'CAM', shot: 0,
        start: 0, duration: 8, amount: 360, easing: 'LINEAR' },
    ],
  },
  {
    key: 'LOOP_WEB',
    label: { es: 'Bucle corto para web', en: 'Short web loop' },
    shots: [3],
    clips: [
      { move: 'SPIN', target: 'SUBJECT', shot: null,
        start: 0, duration: 3, amount: 360, easing: 'LINEAR' },
    ],
  },
  {
    key: 'HERO',
    label: { es: 'Presentacion hero', en: 'Hero presentation' },
    shots: [4, 3, 4],
    clips: [
      { move: 'ORBIT', target: 'CAM', shot: 0,
        start: 0, duration: 4, amount: 90, easing: 'EASE' },
      { move: 'RISE', target: 'CAM', shot: 0,
        start: 0, duration: 4, amount: 18, easing: 'EASE' },
      { move: 'DOLLY', target: 'CAM', shot: 1,
        start: 4, duration: 3, amount: 40, easing: 'EASE_OUT' },
      { move: 'SPIN', target: 'SUBJECT', shot: null,
        start: 7, duration: 4, amount: 360, easing: 'LINEAR' },
    ],
  },
  {
    key: 'REVEAL',
    label: { es: 'Revelado cinematografico', en: 'Cinematic reveal' },
    shots: [5, 3],
    clips: [
      { move: 'ORBIT', target: 'CAM', shot: 0,
        start: 0, duration: 5, amount: 130, easing: 'EASE' },
      { move: 'RISE', target: 'CAM', shot: 0,
        start: 0, duration: 5, amount: -12, easing: 'EASE' },
      { move: 'HDRI', target: 'SCENE', shot: null,
        start: 0, duration: 8, amount: 60, easing: 'EASE' },
      { move: 'DOLLY', target: 'CAM', shot: 1,
        start: 5, duration: 3, amount: 25, easing: 'EASE_OUT' },
    ],
  },
  {
    key: 'MACRO_PUSH',
    label: { es: 'Macro: acercamiento a detalle', en: 'Macro push-in' },
    shots: [2, 4],
    clips: [
      { move: 'ORBIT', target: 'CAM', shot: 0,
        start: 0, duration: 2, amount: 20, easing: 'EASE_IN' },
      { move: 'DOLLY', target: 'CAM', shot: 1,
        start: 2, duration: 4, amount: 55, easing: 'EASE_OUT' },
      { move: 'FOCUS', target: 'CAM', shot: 1,
        start: 2, duration: 4, amount: 0.12, easing: 'EASE' },
    ],
  },
  {
    key: 'JEWEL_SPARKLE',
    label: { es: 'Joyeria: giro lento con barrido', en: 'Jewellery: slow spin and rake' },
    shots: [10],
    clips: [
      { move: 'SPIN', target: 'SUBJECT', shot: null,
        start: 0, duration: 10, amount: 360, easing: 'LINEAR' },
      { move: 'HDRI', target: 'SCENE', shot: null,
        start: 0, duration: 10, amount: 200, easing: 'LINEAR' },
    ],
  },
  {
    key: 'PERFUME_REVEAL',
    label: { es: 'Perfumeria: revelado a contraluz', en: 'Fragrance: backlit reveal' },
    shots: [4, 4],
    clips: [
      { move: 'HDRI', target: 'SCENE', shot: null,
        start: 0, duration: 8, amount: 90, easing: 'EASE' },
      { move: 'DOLLY', target: 'CAM', shot: 0,
        start: 0, duration: 4, amount: 30, easing: 'EASE_OUT' },
      { move: 'ORBIT', target: 'CAM', shot: 1,
        start: 4, duration: 4, amount: 60, easing: 'EASE' },
    ],
  },
  {
    key: 'ELECTRONICS_TOUR',
    label: { es: 'Electronica: recorrido de detalles', en: 'Electronics: detail tour' },
    shots: [3, 2.5, 2.5, 3],
    clips: [
      { move: 'ORBIT', target: 'CAM', shot: 0,
        start: 0, duration: 3, amount: 45, easing: 'EASE' },
      { move: 'DOLLY', target: 'CAM', shot: 1,
        start: 3, duration: 2.5, amount: 40, easing: 'EASE_OUT' },
      { move: 'DOLLY', target: 'CAM', shot: 2,
        start: 5.5, duration: 2.5, amount: 40, easing: 'EASE_OUT' },
      { move: 'SPIN', target: 'SUBJECT', shot: null,
        start: 8, duration: 3, amount: 180, easing: 'EASE' },
    ],
  },
  {
    key: 'FURNITURE_WALK',
    label: { es: 'Mobiliario: travelling lateral', en: 'Furniture: lateral track' },
    shots: [6, 4],
    clips: [
      { move: 'TRACK', target: 'CAM', shot: 0,
        start: 0, duration: 6, amount: 0, easing: 'EASE' },
      { move: 'ORBIT', target: 'CAM', shot: 1,
        start: 6, duration: 4, amount: 55, easing: 'EASE' },
    ],
  },
  {
    key: 'PACK_LABEL',
    label: { es: 'Packaging: giro de etiqueta', en: 'Packaging: label spin' },
    shots: [6],
    clips: [
      { move: 'SPIN', target: 'SUBJECT', shot: null,
        start: 0, duration: 6, amount: 360, easing: 'LINEAR' },
    ],
  },
  {
    key: 'EXPLODE',
    label: { es: 'Despiece tecnico', en: 'Technical exploded view' },
    shots: [1, 3, 2],
    clips: [
      { move: 'EXPLODE', target: 'SUBJECT', shot: null,
        start: 1, duration: 3, amount: 1.5, easing: 'EASE_OUT' },
      { move: 'ORBIT', target: 'CAM', shot: 2,
        start: 4, duration: 2, amount: 45, easing: 'EASE' },
    ],
  },
  {
    key: 'EXPLODE_ASSEMBLE',
    label: { es: 'Despiece y montaje', en: 'Explode and reassemble' },
    shots: [3, 1, 3],
    clips: [
      { move: 'EXPLODE', target: 'SUBJECT', shot: null,
        start: 0, duration: 3, amount: 1.5, easing: 'EASE_OUT' },
      { move: 'EXPLODE', target: 'SUBJECT', shot: null,
        start: 4, duration: 3, amount: -1.5, easing: 'EASE_IN' },
      { move: 'ORBIT', target: 'CAM', shot: 1,
        start: 3, duration: 1, amount: 20, easing: 'LINEAR' },
    ],
  },
  {
    key: 'LIGHTSWEEP',
    label: { es: 'Barrido de luz', en: 'Light rake' },
    shots: [5],
    clips: [
      { move: 'HDRI', target: 'SCENE', shot: null,
        start: 0, duration: 5, amount: 140, easing: 'EASE' },
    ],
  },
  {
    key: 'FOCUS_SHIFT',
    label: { es: 'Cambio de foco entre planos', en: 'Focus shift between shots' },
    shots: [3, 3],
    clips: [
      { move: 'FOCUS', target: 'CAM', shot: 0,
        start: 0, duration: 3, amount: 0.25, easing: 'EASE' },
      { move: 'FOCUS', target: 'CAM', shot: 1,
        start: 3, duration: 3, amount: 0.1, easing: 'EASE' },
      { move: 'SPIN', target: 'SUBJECT', shot: null,
        start: 0, duration: 6, amount: 60, easing: 'EASE' },
    ],
  },
  {
    key: 'CATALOG',
    label: { es: 'Catalogo 4 vistas', en: '4-view catalogue' },
    shots: [2, 2, 2, 2],
    clips: [],
  },
];

const MOVE_BY_KEY: ReadonlyMap<string, MoveItem> = new Map(MOVE_KINDS.map((m) => [m.key, m]));

export function moveKind(key: string): MoveItem | undefined {
  return MOVE_BY_KEY.get(key);
}

export function sequencePreset(key: string): SequencePreset | undefined {
  return SEQUENCE_PRESETS.find((p) => p.key === key);
}
