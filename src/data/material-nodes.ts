// The node catalogue of the material editor (phase M3a, SPEC §3.3, ARCHITECTURE §5.2 quater): every kind of node a
// material graph can hold, with its inputs, outputs and parameters. Data only: the model (core/material-graph.ts),
// the compiler (core/material-program.ts) and the editor read it. Keys are stable (CLAUDE.md rule 7): a node type,
// a socket or a parameter is added, never renamed, because projects keep them.
//
// A socket has one of four types, drawn by shape, never by colour (UI.md §1): float (circle), colour (diamond),
// vector (square) and normal (triangle). An input that is not connected reads its inline value (`default`), or, for
// the inputs that have none, an implicit source of the shading point (`implicit`): the surface normal, the mesh's
// first UV set, or the part's own coordinates in tenths of a metre.

import type { Label } from './types';

export type SocketType = 'float' | 'color' | 'vector' | 'normal';
export const SOCKET_TYPES: readonly SocketType[] = ['float', 'color', 'vector', 'normal'];

/** What an unconnected input without an inline value reads (POSITION, M3c: the point itself, part space in mm). */
export type ImplicitSource = 'NORMAL' | 'UV0' | 'OBJECT' | 'POSITION';

export interface SocketSpec {
  /** Stable. */
  key: string;
  type: SocketType;
  label: Label;
  /** The inline value of an unconnected input: a number (float), linear RGB (colour) or xyz (vector). */
  default?: number | readonly [number, number, number];
  /** An input without an inline value reads this when it is not connected. */
  implicit?: ImplicitSource;
  /** Range and step of the inline value's field (floats). */
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** Only shown (and compiled) when a parameter has one of these values. */
  when?: { param: string; values: readonly string[] };
}

export type ParamKind = 'enum' | 'number' | 'int' | 'bool' | 'color' | 'image' | 'ramp';

export interface ParamOption {
  value: string;
  label: Label;
}

/** A colour ramp's stop: position 0..1 and linear RGB. */
export interface RampStop {
  pos: number;
  color: readonly [number, number, number];
}

export interface ParamSpec {
  /** Stable. */
  key: string;
  kind: ParamKind;
  label: Label;
  /** enum: an option's value; number and int: a number; bool; color: linear RGB; image: null; ramp: stops. */
  default: string | number | boolean | readonly [number, number, number] | null | readonly RampStop[];
  options?: readonly ParamOption[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** Only shown when another parameter has one of these values. */
  when?: { param: string; values: readonly string[] };
}

export type NodeCategory = 'OUTPUT' | 'INPUT' | 'TEXTURE' | 'COLOR' | 'VECTOR' | 'MATH' | 'SURFACE';
export const NODE_CATEGORIES: readonly { key: NodeCategory; label: Label }[] = [
  { key: 'INPUT', label: { en: 'Input', es: 'Entrada' } },
  { key: 'TEXTURE', label: { en: 'Texture', es: 'Textura' } },
  { key: 'COLOR', label: { en: 'Colour', es: 'Color' } },
  { key: 'VECTOR', label: { en: 'Vector', es: 'Vector' } },
  { key: 'MATH', label: { en: 'Maths', es: 'Matemática' } },
  { key: 'SURFACE', label: { en: 'Surface', es: 'Superficie' } },
  { key: 'OUTPUT', label: { en: 'Output', es: 'Salida' } },
];

export interface NodeSpec {
  /** Stable. */
  key: string;
  category: NodeCategory;
  label: Label;
  /** One line for the Add node menu and the tooltip of the node's title. */
  description: Label;
  inputs: readonly SocketSpec[];
  outputs: readonly SocketSpec[];
  params: readonly ParamSpec[];
  /** Other words the Add node search matches (both languages). */
  keywords?: string;
  /** At most one per graph, never added from the menu and never deleted (the material output). */
  unique?: boolean;
}

const L = (en: string, es: string): Label => ({ en, es });
const opt = (value: string, en: string, es: string): ParamOption => ({ value, label: L(en, es) });

const f = (key: string, en: string, es: string, def: number, extra: Partial<SocketSpec> = {}): SocketSpec => ({ key, type: 'float', label: L(en, es), default: def, min: 0, max: 1, step: 0.01, ...extra });
const c = (key: string, en: string, es: string, def: readonly [number, number, number]): SocketSpec => ({ key, type: 'color', label: L(en, es), default: def });
const vIn = (implicit: ImplicitSource, en = 'Vector', es = 'Vector'): SocketSpec => ({ key: 'vector', type: 'vector', label: L(en, es), implicit });
const nIn = (): SocketSpec => ({ key: 'normal', type: 'normal', label: L('Normal', 'Normal'), implicit: 'NORMAL' });
const out = (key: string, type: SocketType, en: string, es: string): SocketSpec => ({ key, type, label: L(en, es) });

/** The material's inputs, in the order the Output node lists them (the order of the compiled program's outputs). */
export const OUTPUT_INPUTS: readonly SocketSpec[] = [
  c('baseColor', 'Base colour', 'Color base', [0.8, 0.8, 0.8]),
  f('metallic', 'Metal', 'Metal', 0),
  f('roughness', 'Roughness', 'Rugosidad', 0.5),
  f('anisotropic', 'Anisotropy', 'Anisotropía', 0),
  f('coat', 'Clear coat', 'Barniz', 0),
  f('coatRoughness', 'Coat roughness', 'Rugosidad del barniz', 0.03),
  f('transmission', 'Transmission', 'Transmisión', 0),
  f('ior', 'IOR', 'IOR', 1.5, { min: 1, max: 3 }),
  f('subsurface', 'Subsurface', 'Dispersión interna', 0),
  c('emission', 'Emission', 'Emisión', [0, 0, 0]),
  f('emissionStrength', 'Emission strength', 'Intensidad de emisión', 1, { max: 10000, step: 0.1 }),
  f('opacity', 'Opacity', 'Opacidad', 1),
  nIn(),
  f('bump', 'Bump height', 'Relieve', 0, { min: -100, max: 100, unit: 'mm' }),
  f('bevel', 'Bevel', 'Bisel', 1),
];

const PROJECTIONS: readonly ParamOption[] = [
  opt('UV', 'UV', 'UV'),
  opt('PLANAR', 'Planar', 'Plana'),
  opt('BOX', 'Box', 'Caja'),
  opt('CYLINDRICAL', 'Cylindrical', 'Cilíndrica'),
  opt('SPHERICAL', 'Spherical', 'Esférica'),
  opt('OBJECT', 'Object (3D)', 'Objeto (3D)'),
];
const AXES: readonly ParamOption[] = [opt('X', 'X', 'X'), opt('Y', 'Y', 'Y'), opt('Z', 'Z', 'Z')];

/** The operations of the Maths node, in the order of its menu; the codes are the program's (material-program.ts). */
export const MATH_OPS: readonly ParamOption[] = [
  opt('ADD', 'Add', 'Suma'),
  opt('SUBTRACT', 'Subtract', 'Resta'),
  opt('MULTIPLY', 'Multiply', 'Producto'),
  opt('DIVIDE', 'Divide', 'División'),
  opt('MULTIPLY_ADD', 'Multiply add', 'Producto y suma'),
  opt('POWER', 'Power', 'Potencia'),
  opt('MINIMUM', 'Minimum', 'Mínimo'),
  opt('MAXIMUM', 'Maximum', 'Máximo'),
  opt('SMOOTH_MIN', 'Smooth minimum', 'Mínimo suavizado'),
  opt('SMOOTH_MAX', 'Smooth maximum', 'Máximo suavizado'),
  opt('SMOOTHSTEP', 'Smooth step', 'Escalón suavizado'),
  opt('ABSOLUTE', 'Absolute', 'Valor absoluto'),
  opt('LESS_THAN', 'Less than', 'Menor que'),
  opt('GREATER_THAN', 'Greater than', 'Mayor que'),
  opt('FLOOR', 'Floor', 'Parte entera'),
  opt('FRACTION', 'Fraction', 'Parte fraccionaria'),
  opt('SINE', 'Sine', 'Seno'),
];
/** Maths operations that read only A. */
export const MATH_UNARY: readonly string[] = ['ABSOLUTE', 'FLOOR', 'FRACTION', 'SINE'];
/** Maths operations that also read C. */
export const MATH_TERNARY: readonly string[] = ['MULTIPLY_ADD', 'SMOOTH_MIN', 'SMOOTH_MAX', 'SMOOTHSTEP'];
const BINARY_OR_MORE = MATH_OPS.map((o) => o.value).filter((v) => !MATH_UNARY.includes(v));

export const BLEND_MODES: readonly ParamOption[] = [
  opt('MIX', 'Mix', 'Mezcla'),
  opt('ADD', 'Add', 'Suma'),
  opt('MULTIPLY', 'Multiply', 'Producto'),
  opt('SUBTRACT', 'Subtract', 'Resta'),
  opt('SCREEN', 'Screen', 'Trama'),
  opt('DIFFERENCE', 'Difference', 'Diferencia'),
  opt('LIGHTEN', 'Lighten', 'Aclarar'),
  opt('DARKEN', 'Darken', 'Oscurecer'),
  opt('OVERLAY', 'Overlay', 'Superponer'),
];

export const GRADIENT_KINDS: readonly ParamOption[] = [
  opt('LINEAR', 'Linear', 'Lineal'),
  opt('QUADRATIC', 'Quadratic', 'Cuadrático'),
  opt('EASED', 'Eased', 'Suavizado'),
  opt('DIAGONAL', 'Diagonal', 'Diagonal'),
  opt('SPHERICAL', 'Spherical', 'Esférico'),
  opt('RADIAL', 'Radial', 'Radial'),
];

/** M3c: the Wood node's parameters, the Wood family's keys in its units (rings per 100 mm, millimetres). */
const KNOTTED = { param: 'woodFigure', values: ['RINGS'] } as const;
export const WOOD_PARAMS: readonly ParamSpec[] = [
  { key: 'woodColor1', kind: 'color', label: L('Spring wood', 'Madera de primavera'), default: [0.56, 0.38, 0.21] },
  { key: 'woodColor2', kind: 'color', label: L('Summer wood', 'Madera de verano'), default: [0.3, 0.18, 0.09] },
  {
    key: 'woodFigure',
    kind: 'enum',
    label: L('Figure', 'Figura'),
    default: 'RINGS',
    options: [opt('RINGS', 'Rings', 'Anillos'), opt('STRIPS', 'Strips (bamboo)', 'Tiras (bambú)'), opt('SPECKLE', 'Speckle (fibreboard)', 'Moteado (DM)'), opt('STREAKED', 'Streaked (ebony)', 'Vetas (ébano)')],
  },
  { key: 'ringDensity', kind: 'number', label: L('Rings per 100 mm', 'Anillos por 100 mm'), default: 33, min: 1, max: 60, step: 1 },
  { key: 'woodScale', kind: 'number', label: L('Scale', 'Escala'), default: 1, min: 0.1, max: 10, step: 0.05 },
  { key: 'ringContrast', kind: 'number', label: L('Ring contrast', 'Contraste de anillos'), default: 0.3, min: 0, max: 1, step: 0.01 },
  { key: 'ringVariation', kind: 'number', label: L('Ring variation', 'Variación de anillos'), default: 0.4, min: 0, max: 1, step: 0.01 },
  { key: 'ringNoise', kind: 'number', label: L('Ring wander', 'Ondulación de anillos'), default: 0.3, min: 0, max: 1, step: 0.01 },
  { key: 'axialNoise', kind: 'number', label: L('Axial noise', 'Ruido axial'), default: 0.2, min: 0, max: 1, step: 0.01 },
  { key: 'colorNoise', kind: 'number', label: L('Colour noise', 'Ruido de color'), default: 0.2, min: 0, max: 1, step: 0.01 },
  { key: 'poreSize', kind: 'number', label: L('Pore size', 'Tamaño de poro'), default: 0.2, min: 0, max: 2, step: 0.01, unit: 'mm' },
  { key: 'poreDepth', kind: 'number', label: L('Pore depth', 'Hondo de poro'), default: 0.3, min: 0, max: 1, step: 0.01 },
  { key: 'poreBand', kind: 'number', label: L('Pores in the spring wood', 'Poros en la madera de primavera'), default: 0, min: 0, max: 1, step: 0.01 },
  { key: 'knotCount', kind: 'int', label: L('Knots', 'Nudos'), default: 0, min: 0, max: 12, step: 1, when: KNOTTED },
  { key: 'knotSize', kind: 'number', label: L('Knot size', 'Tamaño de nudo'), default: 15, min: 5, max: 40, step: 0.5, unit: 'mm', when: KNOTTED },
  { key: 'knotSizeVar', kind: 'number', label: L('Knot variation', 'Variación de nudos'), default: 0.3, min: 0, max: 1, step: 0.01, when: KNOTTED },
  { key: 'knotDarkness', kind: 'number', label: L('Knot darkness', 'Oscuridad de nudos'), default: 0.6, min: 0, max: 1, step: 0.01, when: KNOTTED },
  { key: 'seed', kind: 'int', label: L('Seed', 'Semilla'), default: 0, min: 0, max: 9999, step: 1, when: KNOTTED },
];

/** M3c: the Fabric node's parameters, the Fabric family's keys in its units (threads per cm). */
export const FABRIC_PARAMS: readonly ParamSpec[] = [
  { key: 'threadColor1', kind: 'color', label: L('Warp', 'Urdimbre'), default: [0.7, 0.7, 0.68] },
  { key: 'threadColor2', kind: 'color', label: L('Weft', 'Trama'), default: [0.6, 0.6, 0.58] },
  {
    key: 'weave',
    kind: 'enum',
    label: L('Weave', 'Tejido'),
    default: 'PLAIN',
    options: [
      opt('PLAIN', 'Plain', 'Tafetán'),
      opt('TWILL', 'Twill 2/2', 'Sarga 2/2'),
      opt('TWILL31', 'Twill 3/1 (denim)', 'Sarga 3/1 (vaquero)'),
      opt('SATIN', 'Satin', 'Raso'),
      opt('CANVAS', 'Canvas', 'Lona'),
      opt('KNIT', 'Knit', 'Punto'),
      opt('FELT', 'Felt', 'Fieltro'),
    ],
  },
  { key: 'threadCount', kind: 'number', label: L('Threads per cm', 'Hilos por cm'), default: 40, min: 2, max: 200, step: 1, unit: '/cm' },
  { key: 'weaveDepth', kind: 'number', label: L('Weave relief', 'Relieve del tejido'), default: 0.35, min: 0, max: 1, step: 0.01 },
  { key: 'yarnTwist', kind: 'number', label: L('Yarn twist', 'Torsión del hilo'), default: 1, min: 0, max: 1, step: 0.01 },
  { key: 'fuzz', kind: 'number', label: L('Fuzz', 'Pelusa'), default: 0.3, min: 0, max: 1, step: 0.01 },
  { key: 'fuzzRoughness', kind: 'number', label: L('Fuzz roughness', 'Rugosidad de la pelusa'), default: 0.4, min: 0, max: 1, step: 0.01 },
];

export const MATERIAL_NODES: readonly NodeSpec[] = [
  {
    key: 'OUTPUT',
    category: 'OUTPUT',
    unique: true,
    label: L('Material output', 'Salida de material'),
    description: L('What the material is at each point: the inputs of the engine’s material.', 'Lo que es el material en cada punto: las entradas del material del motor.'),
    inputs: OUTPUT_INPUTS,
    outputs: [],
    params: [
      { key: 'absorptionMm', kind: 'number', label: L('Absorption distance', 'Distancia de absorción'), default: 0, min: 0, max: 5000, step: 1, unit: 'mm' },
      { key: 'thinWalls', kind: 'bool', label: L('Thin walls', 'Paredes finas'), default: false },
    ],
  },
  {
    key: 'IMAGE',
    category: 'TEXTURE',
    label: L('Image texture', 'Textura de imagen'),
    description: L('A PNG or JPEG read at the vector’s u and v (the mesh’s UVs when nothing is connected).', 'Un PNG o JPEG leído en la u y la v del vector (las UV de la malla si no hay nada conectado).'),
    keywords: 'picture photo map imagen foto mapa',
    inputs: [vIn('UV0')],
    outputs: [out('color', 'color', 'Colour', 'Color'), out('alpha', 'float', 'Alpha', 'Alfa')],
    params: [
      { key: 'image', kind: 'image', label: L('Image', 'Imagen'), default: null },
      { key: 'colorSpace', kind: 'enum', label: L('Colour space', 'Espacio de color'), default: 'SRGB', options: [opt('SRGB', 'sRGB (colour)', 'sRGB (color)'), opt('LINEAR', 'Linear (data)', 'Lineal (datos)')] },
      { key: 'wrap', kind: 'enum', label: L('Edges', 'Bordes'), default: 'REPEAT', options: [opt('REPEAT', 'Repeat', 'Repetir'), opt('CLAMP', 'Clamp', 'Estirar el borde'), opt('MIRROR', 'Mirror', 'Espejo')] },
    ],
  },
  {
    key: 'MAPPING',
    category: 'VECTOR',
    label: L('Mapping', 'Mapeado'),
    description: L('Where a point is on the texture: the projections of the Textures section, or the part’s own 3D coordinates.', 'Dónde cae un punto en la textura: las proyecciones de la sección Texturas, o las coordenadas 3D de la pieza.'),
    keywords: 'projection coordinates uv box planar proyección coordenadas caja',
    inputs: [],
    outputs: [out('vector', 'vector', 'Vector', 'Vector')],
    params: [
      { key: 'projection', kind: 'enum', label: L('Projection', 'Proyección'), default: 'UV', options: PROJECTIONS },
      { key: 'axis', kind: 'enum', label: L('Axis', 'Eje'), default: 'Z', options: AXES, when: { param: 'projection', values: ['PLANAR', 'CYLINDRICAL', 'SPHERICAL', 'OBJECT'] } },
      { key: 'uvSet', kind: 'enum', label: L('UV set', 'Juego de UV'), default: '0', options: [opt('0', 'First', 'Primero'), opt('1', 'Second', 'Segundo')], when: { param: 'projection', values: ['UV'] } },
      { key: 'sizeMm', kind: 'number', label: L('Size', 'Tamaño'), default: 100, min: 0.01, max: 1e6, step: 1, unit: 'mm', when: { param: 'projection', values: ['PLANAR', 'BOX', 'CYLINDRICAL', 'OBJECT'] } },
      { key: 'rotationDeg', kind: 'number', label: L('Rotation', 'Giro'), default: 0, min: -3600, max: 3600, step: 1, unit: '°' },
      { key: 'offsetU', kind: 'number', label: L('Offset u', 'Desplazamiento u'), default: 0, min: -1e4, max: 1e4, step: 0.01 },
      { key: 'offsetV', kind: 'number', label: L('Offset v', 'Desplazamiento v'), default: 0, min: -1e4, max: 1e4, step: 0.01 },
      { key: 'repeatU', kind: 'number', label: L('Repeat u', 'Repetición u'), default: 1, min: -1e4, max: 1e4, step: 0.1 },
      { key: 'repeatV', kind: 'number', label: L('Repeat v', 'Repetición v'), default: 1, min: -1e4, max: 1e4, step: 0.1 },
    ],
  },
  {
    key: 'NOISE',
    category: 'TEXTURE',
    label: L('Noise', 'Ruido'),
    description: L('Gradient noise (Perlin or simplex) summed over octaves: 0 to 1, about 0.5 on average.', 'Ruido de gradiente (Perlin o símplex) sumado en octavas: de 0 a 1, en torno a 0,5 de media.'),
    keywords: 'perlin simplex fbm turbulence random ruido aleatorio',
    inputs: [vIn('OBJECT'), f('scale', 'Scale', 'Escala', 5, { max: 10000, step: 0.1 })],
    outputs: [out('value', 'float', 'Value', 'Valor'), out('color', 'color', 'Colour', 'Color')],
    params: [
      { key: 'kind', kind: 'enum', label: L('Kind', 'Tipo'), default: 'PERLIN', options: [opt('PERLIN', 'Perlin', 'Perlin'), opt('SIMPLEX', 'Simplex', 'Símplex')] },
      { key: 'octaves', kind: 'int', label: L('Octaves', 'Octavas'), default: 4, min: 1, max: 8, step: 1 },
      { key: 'lacunarity', kind: 'number', label: L('Lacunarity', 'Lacunaridad'), default: 2, min: 1, max: 4, step: 0.05 },
      { key: 'gain', kind: 'number', label: L('Roughness', 'Rugosidad'), default: 0.5, min: 0, max: 1, step: 0.01 },
      { key: 'seed', kind: 'int', label: L('Seed', 'Semilla'), default: 0, min: 0, max: 65535, step: 1 },
    ],
  },
  {
    key: 'GRADIENT',
    category: 'TEXTURE',
    label: L('Gradient', 'Degradado'),
    description: L('A ramp from 0 to 1 along the vector: linear, quadratic, eased, diagonal, spherical or radial.', 'Una rampa de 0 a 1 a lo largo del vector: lineal, cuadrática, suavizada, diagonal, esférica o radial.'),
    keywords: 'ramp fade degradado rampa',
    inputs: [vIn('OBJECT')],
    outputs: [out('value', 'float', 'Value', 'Valor')],
    params: [{ key: 'kind', kind: 'enum', label: L('Kind', 'Tipo'), default: 'LINEAR', options: GRADIENT_KINDS }],
  },
  {
    key: 'CHECKER',
    category: 'TEXTURE',
    label: L('Checks', 'Cuadros'),
    description: L('Alternating cells of two colours, `scale` cells per unit of the vector.', 'Celdas alternas de dos colores, tantas como la escala por unidad del vector.'),
    keywords: 'checker grid tiles damero tablero',
    inputs: [vIn('OBJECT'), c('color1', 'Colour 1', 'Color 1', [0.8, 0.8, 0.8]), c('color2', 'Colour 2', 'Color 2', [0.2, 0.2, 0.2]), f('scale', 'Scale', 'Escala', 5, { max: 10000, step: 0.1 })],
    outputs: [out('color', 'color', 'Colour', 'Color'), out('value', 'float', 'Value', 'Valor')],
    params: [],
  },
  {
    key: 'STRIPES',
    category: 'TEXTURE',
    label: L('Stripes', 'Rayas'),
    description: L('Bands of two colours across one axis of the vector, with a width and soft edges.', 'Bandas de dos colores a lo largo de un eje del vector, con anchura y bordes suaves.'),
    keywords: 'lines bands rayas líneas bandas',
    inputs: [vIn('OBJECT'), c('color1', 'Colour 1', 'Color 1', [0.8, 0.8, 0.8]), c('color2', 'Colour 2', 'Color 2', [0.2, 0.2, 0.2]), f('scale', 'Scale', 'Escala', 5, { max: 10000, step: 0.1 }), f('width', 'Width', 'Anchura', 0.5)],
    outputs: [out('color', 'color', 'Colour', 'Color'), out('value', 'float', 'Value', 'Valor')],
    params: [
      { key: 'axis', kind: 'enum', label: L('Across', 'A lo largo de'), default: 'X', options: [opt('X', 'x (u)', 'x (u)'), opt('Y', 'y (v)', 'y (v)'), opt('Z', 'z (w)', 'z (w)')] },
      { key: 'softness', kind: 'number', label: L('Softness', 'Suavidad'), default: 0.1, min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    key: 'RAMP',
    category: 'COLOR',
    label: L('Colour ramp', 'Rampa de color'),
    description: L('Turns a value from 0 to 1 into a colour, between up to eight stops.', 'Convierte un valor de 0 a 1 en un color, entre hasta ocho paradas.'),
    keywords: 'gradient map lookup rampa paradas',
    inputs: [f('fac', 'Value', 'Valor', 0.5)],
    outputs: [out('color', 'color', 'Colour', 'Color')],
    params: [
      { key: 'interpolation', kind: 'enum', label: L('Interpolation', 'Interpolación'), default: 'LINEAR', options: [opt('LINEAR', 'Linear', 'Lineal'), opt('EASE', 'Eased', 'Suavizada'), opt('CONSTANT', 'Constant', 'Constante')] },
      {
        key: 'stops',
        kind: 'ramp',
        label: L('Stops', 'Paradas'),
        default: [
          { pos: 0, color: [0, 0, 0] },
          { pos: 1, color: [1, 1, 1] },
        ],
      },
    ],
  },
  {
    key: 'MIX',
    category: 'COLOR',
    label: L('Mix', 'Mezcla'),
    description: L('Blends B over A by the factor: mix, add, multiply, screen, overlay…', 'Funde B sobre A según el factor: mezcla, suma, producto, trama, superponer…'),
    keywords: 'blend lerp combine mezclar fundir',
    inputs: [f('fac', 'Factor', 'Factor', 0.5), c('a', 'A', 'A', [0.5, 0.5, 0.5]), c('b', 'B', 'B', [0.5, 0.5, 0.5])],
    outputs: [out('color', 'color', 'Colour', 'Color')],
    params: [
      { key: 'blend', kind: 'enum', label: L('Blend', 'Fusión'), default: 'MIX', options: BLEND_MODES },
      { key: 'clamp', kind: 'bool', label: L('Clamp to 0–1', 'Limitar a 0–1'), default: false },
    ],
  },
  {
    key: 'MATH',
    category: 'MATH',
    label: L('Maths', 'Matemática'),
    description: L('One operation on numbers: add, multiply, power, minimum, maximum, smooth minimum, absolute…', 'Una operación con números: suma, producto, potencia, mínimo, máximo, mínimo suavizado, valor absoluto…'),
    keywords: 'math add multiply power min max abs smooth suma producto potencia',
    inputs: [
      f('a', 'A', 'A', 0.5, { min: -1e4, max: 1e4 }),
      f('b', 'B', 'B', 0.5, { min: -1e4, max: 1e4, when: { param: 'op', values: BINARY_OR_MORE } }),
      f('c', 'C', 'C', 0.5, { min: -1e4, max: 1e4, when: { param: 'op', values: MATH_TERNARY } }),
    ],
    outputs: [out('value', 'float', 'Value', 'Valor')],
    params: [
      { key: 'op', kind: 'enum', label: L('Operation', 'Operación'), default: 'MULTIPLY', options: MATH_OPS },
      { key: 'clamp', kind: 'bool', label: L('Clamp to 0–1', 'Limitar a 0–1'), default: false },
    ],
  },
  {
    key: 'FRESNEL',
    category: 'SURFACE',
    label: L('Fresnel / layer weight', 'Fresnel / peso de capa'),
    description: L('How much a surface faces away from the view: the dielectric Fresnel for an IOR, and a facing ramp shaped by the blend.', 'Cuánto se aparta la superficie de la vista: el Fresnel dieléctrico de un IOR, y una rampa de cara moldeada por la mezcla.'),
    keywords: 'facing rim edge view angle layer weight borde ángulo',
    inputs: [f('ior', 'IOR', 'IOR', 1.5, { min: 1, max: 3 }), f('blend', 'Blend', 'Mezcla', 0.5), nIn()],
    outputs: [out('fresnel', 'float', 'Fresnel', 'Fresnel'), out('facing', 'float', 'Facing', 'De cara')],
    params: [],
  },
  {
    key: 'CURVATURE',
    category: 'SURFACE',
    label: L('Curvature', 'Curvatura'),
    description: L('Convex edges and concave corners of the part, measured by the engine within a radius (the worn edges and the dirt in crevices of the wear).', 'Aristas convexas y rincones cóncavos de la pieza, medidos por el motor dentro de un radio (las aristas gastadas y la suciedad en rendijas del desgaste).'),
    keywords: 'edges cavity wear aristas cavidad desgaste',
    inputs: [],
    outputs: [out('edges', 'float', 'Edges', 'Aristas'), out('cavities', 'float', 'Cavities', 'Cavidades')],
    params: [{ key: 'radiusMm', kind: 'number', label: L('Radius', 'Radio'), default: 1, min: 0.01, max: 100, step: 0.1, unit: 'mm' }],
  },
  {
    key: 'VALUE',
    category: 'INPUT',
    label: L('Value', 'Valor'),
    description: L('A number.', 'Un número.'),
    keywords: 'number constant número constante',
    inputs: [],
    outputs: [out('value', 'float', 'Value', 'Valor')],
    params: [{ key: 'value', kind: 'number', label: L('Value', 'Valor'), default: 0.5, min: -1e4, max: 1e4, step: 0.01 }],
  },
  {
    key: 'COLOR',
    category: 'INPUT',
    label: L('Colour', 'Color'),
    description: L('A colour.', 'Un color.'),
    keywords: 'rgb constant constante',
    inputs: [],
    outputs: [out('color', 'color', 'Colour', 'Color')],
    params: [{ key: 'color', kind: 'color', label: L('Colour', 'Color'), default: [0.8, 0.8, 0.8] }],
  },
  {
    key: 'SEPARATE_RGB',
    category: 'COLOR',
    label: L('Separate RGB', 'Separar RGB'),
    description: L('The red, green and blue of a colour (x, y and z of a vector) as three numbers.', 'El rojo, el verde y el azul de un color (x, y, z de un vector) como tres números.'),
    keywords: 'split channels xyz canales',
    inputs: [c('color', 'Colour', 'Color', [0.8, 0.8, 0.8])],
    outputs: [out('r', 'float', 'R', 'R'), out('g', 'float', 'G', 'G'), out('b', 'float', 'B', 'B')],
    params: [],
  },
  {
    key: 'COMBINE_RGB',
    category: 'COLOR',
    label: L('Combine RGB', 'Combinar RGB'),
    description: L('Three numbers as a colour (or a vector).', 'Tres números como un color (o un vector).'),
    keywords: 'join channels xyz canales',
    inputs: [f('r', 'R', 'R', 0, { min: -1e4, max: 1e4 }), f('g', 'G', 'G', 0, { min: -1e4, max: 1e4 }), f('b', 'B', 'B', 0, { min: -1e4, max: 1e4 })],
    outputs: [out('color', 'color', 'Colour', 'Color')],
    params: [],
  },
  {
    key: 'INVERT',
    category: 'COLOR',
    label: L('Invert', 'Invertir'),
    description: L('One minus the colour, by the factor.', 'Uno menos el color, según el factor.'),
    keywords: 'negative negativo',
    inputs: [f('fac', 'Factor', 'Factor', 1), c('color', 'Colour', 'Color', [0, 0, 0])],
    outputs: [out('color', 'color', 'Colour', 'Color')],
    params: [],
  },
  {
    key: 'NORMAL_MAP',
    category: 'SURFACE',
    label: L('Normal map', 'Mapa de normales'),
    description: L('Bends the normal by a colour: a tangent-space normal map (blue up), or one in the part’s space.', 'Inclina la normal según un color: un mapa de normales en espacio tangente (azul arriba) o en el de la pieza.'),
    keywords: 'tangent normal relief tangente relieve',
    inputs: [f('strength', 'Strength', 'Intensidad', 1, { max: 10 }), c('color', 'Colour', 'Color', [0.5, 0.5, 1])],
    outputs: [out('normal', 'normal', 'Normal', 'Normal')],
    params: [{ key: 'space', kind: 'enum', label: L('Space', 'Espacio'), default: 'TANGENT', options: [opt('TANGENT', 'Tangent', 'Tangente'), opt('OBJECT', 'Part', 'Pieza')] }],
  },
  {
    key: 'BUMP',
    category: 'SURFACE',
    label: L('Bump', 'Relieve'),
    description: L('Bends the normal by how a height changes along the surface: white is `distance` millimetres high.', 'Inclina la normal según cómo cambia una altura sobre la superficie: el blanco está a `distancia` milímetros.'),
    keywords: 'height relief displacement altura relieve',
    inputs: [f('strength', 'Strength', 'Intensidad', 1, { max: 10 }), f('distance', 'Distance', 'Distancia', 0.1, { max: 100, unit: 'mm' }), f('height', 'Height', 'Altura', 0), nIn()],
    outputs: [out('normal', 'normal', 'Normal', 'Normal')],
    params: [{ key: 'invert', kind: 'bool', label: L('Invert', 'Invertir'), default: false }],
  },
  {
    key: 'WOOD',
    category: 'TEXTURE',
    label: L('Wood', 'Madera'),
    description: L(
      'The Wood family’s procedural wood (rings, figure, pores, fibres and knots), in millimetres of the part: its colour, roughness, grain and relief.',
      'La madera procedural de la familia Madera (anillos, figura, poros, fibras y nudos), en milímetros de la pieza: su color, rugosidad, veta y relieve.',
    ),
    keywords: 'timber grain rings knots pores oak pine madera veta anillos nudos poros roble pino',
    inputs: [vIn('POSITION', 'Point', 'Punto'), nIn(), f('roughness', 'Roughness', 'Rugosidad', 0.45)],
    outputs: [
      out('color', 'color', 'Colour', 'Color'),
      out('roughness', 'float', 'Roughness', 'Rugosidad'),
      out('anisotropy', 'float', 'Anisotropy', 'Anisotropía'),
      out('normal', 'normal', 'Normal', 'Normal'),
      out('height', 'float', 'Height (mm)', 'Altura (mm)'),
    ],
    params: WOOD_PARAMS,
  },
  {
    key: 'FABRIC',
    category: 'TEXTURE',
    label: L('Fabric', 'Tela'),
    description: L(
      'The Fabric family’s woven or knitted cloth (weave, threads per cm, relief, twist), in millimetres of the part: its colour, roughness, threads and relief.',
      'La tela tejida o de punto de la familia Tela (tejido, hilos por cm, relieve, torsión), en milímetros de la pieza: su color, rugosidad, hilos y relieve.',
    ),
    keywords: 'cloth textile weave thread twill denim knit felt tela tejido hilo sarga vaquero punto fieltro',
    inputs: [vIn('POSITION', 'Point', 'Punto'), nIn(), f('roughness', 'Roughness', 'Rugosidad', 0.75)],
    outputs: [
      out('color', 'color', 'Colour', 'Color'),
      out('roughness', 'float', 'Roughness', 'Rugosidad'),
      out('anisotropy', 'float', 'Anisotropy', 'Anisotropía'),
      out('normal', 'normal', 'Normal', 'Normal'),
      out('height', 'float', 'Height (mm)', 'Altura (mm)'),
      out('sheen', 'float', 'Sheen', 'Pelusa'),
    ],
    params: FABRIC_PARAMS,
  },
];

const BY_KEY = new Map(MATERIAL_NODES.map((n) => [n.key, n]));

/** A node type of the catalogue; undefined for a key this version does not know. */
export function nodeSpec(key: string): NodeSpec | undefined {
  return BY_KEY.get(key);
}
