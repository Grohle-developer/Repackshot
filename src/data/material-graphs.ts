// The example material graphs (phase M3a, the criterion of ROADMAP M3a): ten graphs the editor's Examples menu
// lays on a material, each built from the nodes of data/material-nodes.ts. Data only: core/material-examples.ts
// makes a graph of each (the catalogue's defaults for whatever an entry does not set). Keys are stable.
//
// A link is [from node, its output, to node, its input]. Coordinates are where the nodes sit on the editor's canvas.
// Sizes are in millimetres of the part; the cylindrical label of PLASTIC_LABEL is laid out for the example bottle
// (radius 31 mm, body from 5 to 98 mm): 40 mm tall at 44 mm, a third of the turn, facing the reference camera.

import type { Label } from './types';

export interface ExampleNode {
  id: string;
  type: string;
  x: number;
  y: number;
  params?: Readonly<Record<string, unknown>>;
  inputs?: Readonly<Record<string, number | readonly [number, number, number]>>;
}

export type ExampleLink = readonly [from: string, output: string, to: string, input: string];

export interface ExampleGraph {
  key: string;
  label: Label;
  description: Label;
  nodes: readonly ExampleNode[];
  links: readonly ExampleLink[];
  /** The image node that receives the built-in label picture (core/material-examples.ts `labelPixels`). */
  labelImage?: string;
}

const OUT = (inputs: ExampleNode['inputs'] = {}, params: ExampleNode['params'] = {}): ExampleNode => ({ id: 'out', type: 'OUTPUT', x: 940, y: 40, inputs, params });

export const MATERIAL_GRAPHS: readonly ExampleGraph[] = [
  {
    key: 'PLASTIC_LABEL',
    label: { en: 'Plastic with a label', es: 'Plástico con etiqueta' },
    description: { en: 'Glossy blue plastic with a printed paper label wrapped around the front.', es: 'Plástico azul brillante con una etiqueta de papel impresa alrededor del frente.' },
    labelImage: 'img',
    nodes: [
      { id: 'map', type: 'MAPPING', x: 40, y: 60, params: { projection: 'CYLINDRICAL', axis: 'Z', sizeMm: 40, repeatU: 2.857, repeatV: 1, offsetU: 0.2778, offsetV: -1.1 } },
      { id: 'img', type: 'IMAGE', x: 280, y: 60, params: { wrap: 'CLAMP' } },
      { id: 'base', type: 'MIX', x: 520, y: 40, inputs: { a: [0.012, 0.06, 0.28] } },
      { id: 'rough', type: 'MIX', x: 520, y: 250, inputs: { a: [0.16, 0.16, 0.16], b: [0.55, 0.55, 0.55] } },
      { id: 'coat', type: 'MATH', x: 520, y: 460, params: { op: 'MULTIPLY_ADD' }, inputs: { b: -0.5, c: 0.5 } },
      OUT({ roughness: 0.16, coatRoughness: 0.02 }),
    ],
    links: [
      ['map', 'vector', 'img', 'vector'],
      ['img', 'alpha', 'base', 'fac'],
      ['img', 'color', 'base', 'b'],
      ['img', 'alpha', 'rough', 'fac'],
      ['img', 'alpha', 'coat', 'a'],
      ['base', 'color', 'out', 'baseColor'],
      ['rough', 'color', 'out', 'roughness'],
      ['coat', 'value', 'out', 'coat'],
    ],
  },
  {
    key: 'BRUSHED_SCRATCHED',
    label: { en: 'Brushed metal with scratches', es: 'Metal cepillado con arañazos' },
    description: { en: 'Steel brushed in fine horizontal lines, with scratches from a second noise that also bump it.', es: 'Acero cepillado en líneas horizontales finas, con arañazos de un segundo ruido que además lo marcan.' },
    nodes: [
      { id: 'map', type: 'MAPPING', x: 40, y: 60, params: { projection: 'OBJECT', axis: 'Z', sizeMm: 100 } },
      { id: 'sep', type: 'SEPARATE_RGB', x: 260, y: 40 },
      { id: 'zz', type: 'MATH', x: 480, y: 40, params: { op: 'MULTIPLY' }, inputs: { b: 60 } },
      { id: 'comb', type: 'COMBINE_RGB', x: 700, y: 40 },
      { id: 'brush', type: 'NOISE', x: 260, y: 300, params: { octaves: 3, gain: 0.6 }, inputs: { scale: 4 } },
      { id: 'scratch', type: 'NOISE', x: 260, y: 560, params: { kind: 'SIMPLEX', octaves: 2, seed: 7 }, inputs: { scale: 30 } },
      { id: 'mask', type: 'MATH', x: 480, y: 560, params: { op: 'SMOOTHSTEP' }, inputs: { b: 0.7, c: 0.78 } },
      { id: 'ramp', type: 'RAMP', x: 480, y: 300, params: { stops: [{ pos: 0.3, color: [0.2, 0.2, 0.2] }, { pos: 0.7, color: [0.34, 0.34, 0.34] }] } },
      { id: 'rough', type: 'MATH', x: 700, y: 330, params: { op: 'MULTIPLY_ADD' }, inputs: { b: 0.25 } },
      { id: 'bump', type: 'BUMP', x: 700, y: 560, inputs: { distance: 0.02 } },
      OUT({ baseColor: [0.62, 0.63, 0.64], metallic: 1, anisotropic: 0.8 }),
    ],
    links: [
      ['map', 'vector', 'sep', 'color'],
      ['sep', 'b', 'zz', 'a'],
      ['sep', 'r', 'comb', 'r'],
      ['sep', 'g', 'comb', 'g'],
      ['zz', 'value', 'comb', 'b'],
      ['comb', 'color', 'brush', 'vector'],
      ['map', 'vector', 'scratch', 'vector'],
      ['scratch', 'value', 'mask', 'a'],
      ['brush', 'value', 'ramp', 'fac'],
      ['mask', 'value', 'rough', 'a'],
      ['ramp', 'color', 'rough', 'c'],
      ['mask', 'value', 'bump', 'height'],
      ['rough', 'value', 'out', 'roughness'],
      ['bump', 'normal', 'out', 'normal'],
    ],
  },
  {
    key: 'MARBLE',
    label: { en: 'Marble', es: 'Mármol' },
    description: { en: 'White marble with grey veins: the sine of a coordinate bent by a noise, through a colour ramp, under a clear coat.', es: 'Mármol blanco con vetas grises: el seno de una coordenada doblada por un ruido, por una rampa de color, bajo un barniz.' },
    nodes: [
      { id: 'map', type: 'MAPPING', x: 40, y: 60, params: { projection: 'OBJECT', axis: 'Z', sizeMm: 100, rotationDeg: 30 } },
      { id: 'noise', type: 'NOISE', x: 260, y: 40, params: { octaves: 6, gain: 0.55 }, inputs: { scale: 2.5 } },
      { id: 'sep', type: 'SEPARATE_RGB', x: 260, y: 330 },
      { id: 'phase', type: 'MATH', x: 480, y: 120, params: { op: 'MULTIPLY_ADD' }, inputs: { b: 7 } },
      { id: 'x4', type: 'MATH', x: 480, y: 360, params: { op: 'MULTIPLY' }, inputs: { b: 5 } },
      { id: 'sin', type: 'MATH', x: 700, y: 120, params: { op: 'SINE' } },
      { id: 'abs', type: 'MATH', x: 700, y: 330, params: { op: 'ABSOLUTE' } },
      { id: 'pow', type: 'MATH', x: 700, y: 520, params: { op: 'POWER' }, inputs: { b: 0.3 } },
      {
        id: 'ramp',
        type: 'RAMP',
        x: 700,
        y: 720,
        params: {
          stops: [
            { pos: 0, color: [0.16, 0.16, 0.18] },
            { pos: 0.45, color: [0.62, 0.61, 0.6] },
            { pos: 1, color: [0.9, 0.89, 0.87] },
          ],
        },
      },
      OUT({ roughness: 0.15, coat: 0.7, coatRoughness: 0.03 }),
    ],
    links: [
      ['map', 'vector', 'noise', 'vector'],
      ['map', 'vector', 'sep', 'color'],
      ['sep', 'r', 'x4', 'a'],
      ['noise', 'value', 'phase', 'a'],
      ['x4', 'value', 'phase', 'c'],
      ['phase', 'value', 'sin', 'a'],
      ['sin', 'value', 'abs', 'a'],
      ['abs', 'value', 'pow', 'a'],
      ['pow', 'value', 'ramp', 'fac'],
      ['ramp', 'color', 'out', 'baseColor'],
    ],
  },
  {
    key: 'LEATHER',
    label: { en: 'Leather', es: 'Cuero' },
    description: { en: 'Brown leather: a fine grain bumped from a noise, its colour mottled by a coarser one.', es: 'Cuero marrón: un grano fino en relieve por un ruido, su color moteado por otro más grueso.' },
    nodes: [
      { id: 'grain', type: 'NOISE', x: 40, y: 60, params: { kind: 'SIMPLEX', octaves: 3, gain: 0.6 }, inputs: { scale: 90 } },
      { id: 'pits', type: 'MATH', x: 260, y: 60, params: { op: 'POWER' }, inputs: { b: 1.8 } },
      { id: 'bump', type: 'BUMP', x: 480, y: 40, inputs: { distance: 0.12, strength: 1 } },
      { id: 'mottle', type: 'NOISE', x: 40, y: 360, params: { octaves: 4 }, inputs: { scale: 6 } },
      {
        id: 'ramp',
        type: 'RAMP',
        x: 260,
        y: 360,
        params: {
          stops: [
            { pos: 0.3, color: [0.07, 0.035, 0.018] },
            { pos: 0.7, color: [0.2, 0.1, 0.05] },
          ],
        },
      },
      { id: 'rough', type: 'MATH', x: 480, y: 330, params: { op: 'MULTIPLY_ADD' }, inputs: { b: 0.3, c: 0.42 } },
      OUT({ coat: 0.08, coatRoughness: 0.3 }),
    ],
    links: [
      ['grain', 'value', 'pits', 'a'],
      ['pits', 'value', 'bump', 'height'],
      ['mottle', 'value', 'ramp', 'fac'],
      ['grain', 'value', 'rough', 'a'],
      ['ramp', 'color', 'out', 'baseColor'],
      ['rough', 'value', 'out', 'roughness'],
      ['bump', 'normal', 'out', 'normal'],
    ],
  },
  {
    key: 'WOOD_TWO_NOISES',
    label: { en: 'Wood with two noises', es: 'Madera con dos ruidos' },
    description: { en: 'Growth rings around the part’s axis, wavered by one noise, with the grain of a second, stretched one.', es: 'Anillos de crecimiento alrededor del eje de la pieza, ondulados por un ruido, con la veta de un segundo, estirado.' },
    nodes: [
      { id: 'map', type: 'MAPPING', x: 40, y: 60, params: { projection: 'OBJECT', axis: 'Z', sizeMm: 25 } },
      { id: 'sep', type: 'SEPARATE_RGB', x: 260, y: 40 },
      { id: 'xx', type: 'MATH', x: 480, y: 20, params: { op: 'MULTIPLY' } },
      { id: 'r2', type: 'MATH', x: 700, y: 20, params: { op: 'MULTIPLY_ADD' } },
      { id: 'r', type: 'MATH', x: 920, y: 520, params: { op: 'POWER' }, inputs: { b: 0.5 } },
      { id: 'warp', type: 'NOISE', x: 260, y: 300, params: { octaves: 3 }, inputs: { scale: 0.8 } },
      { id: 'rr', type: 'MATH', x: 480, y: 300, params: { op: 'MULTIPLY_ADD' }, inputs: { b: 0.9 } },
      { id: 'rings', type: 'MATH', x: 700, y: 300, params: { op: 'MULTIPLY' }, inputs: { b: 4 } },
      { id: 'frac', type: 'MATH', x: 700, y: 520, params: { op: 'FRACTION' } },
      {
        id: 'ramp',
        type: 'RAMP',
        x: 480,
        y: 560,
        params: {
          stops: [
            { pos: 0, color: [0.5, 0.3, 0.15] },
            { pos: 0.65, color: [0.42, 0.24, 0.11] },
            { pos: 0.9, color: [0.2, 0.1, 0.04] },
            { pos: 1, color: [0.5, 0.3, 0.15] },
          ],
        },
      },
      { id: 'stretch', type: 'COMBINE_RGB', x: 40, y: 560 },
      { id: 'zs', type: 'MATH', x: 40, y: 360, params: { op: 'MULTIPLY' }, inputs: { b: 0.05 } },
      { id: 'grain', type: 'NOISE', x: 260, y: 560, params: { octaves: 2, seed: 11 }, inputs: { scale: 12 } },
      { id: 'mix', type: 'MIX', x: 700, y: 760, params: { blend: 'MULTIPLY' }, inputs: { fac: 0.45 } },
      OUT({ roughness: 0.42, coat: 0.25, coatRoughness: 0.08 }),
    ],
    links: [
      ['map', 'vector', 'sep', 'color'],
      ['sep', 'r', 'xx', 'a'],
      ['sep', 'r', 'xx', 'b'],
      ['sep', 'g', 'r2', 'a'],
      ['sep', 'g', 'r2', 'b'],
      ['xx', 'value', 'r2', 'c'],
      ['r2', 'value', 'r', 'a'],
      ['map', 'vector', 'warp', 'vector'],
      ['warp', 'value', 'rr', 'a'],
      ['r', 'value', 'rr', 'c'],
      ['rr', 'value', 'rings', 'a'],
      ['rings', 'value', 'frac', 'a'],
      ['frac', 'value', 'ramp', 'fac'],
      ['sep', 'b', 'zs', 'a'],
      ['sep', 'r', 'stretch', 'r'],
      ['sep', 'g', 'stretch', 'g'],
      ['zs', 'value', 'stretch', 'b'],
      ['stretch', 'color', 'grain', 'vector'],
      ['ramp', 'color', 'mix', 'a'],
      ['grain', 'value', 'mix', 'b'],
      ['mix', 'color', 'out', 'baseColor'],
    ],
  },
  {
    key: 'GLASS_DIRT',
    label: { en: 'Glass with Fresnel dirt', es: 'Vidrio con suciedad por Fresnel' },
    description: { en: 'Clear glass whose dust settles in patches and shows where the surface turns away from the view.', es: 'Vidrio transparente cuyo polvo se posa en manchas y se ve donde la superficie se aparta de la vista.' },
    nodes: [
      { id: 'fres', type: 'FRESNEL', x: 40, y: 60, inputs: { blend: 0.35 } },
      { id: 'noise', type: 'NOISE', x: 40, y: 300, params: { octaves: 5 }, inputs: { scale: 8 } },
      { id: 'patch', type: 'MATH', x: 260, y: 300, params: { op: 'SMOOTHSTEP' }, inputs: { b: 0.45, c: 0.7 } },
      { id: 'dirt', type: 'MATH', x: 480, y: 120, params: { op: 'MULTIPLY' } },
      { id: 'base', type: 'MIX', x: 700, y: 20, inputs: { a: [0.97, 0.98, 0.98], b: [0.42, 0.37, 0.3] } },
      { id: 'trans', type: 'MATH', x: 700, y: 260, params: { op: 'MULTIPLY_ADD' }, inputs: { b: -0.75, c: 1 } },
      { id: 'rough', type: 'MATH', x: 700, y: 470, params: { op: 'MULTIPLY_ADD' }, inputs: { b: 0.6, c: 0.01 } },
      OUT({ ior: 1.52 }, { absorptionMm: 60 }),
    ],
    links: [
      ['noise', 'value', 'patch', 'a'],
      ['fres', 'facing', 'dirt', 'a'],
      ['patch', 'value', 'dirt', 'b'],
      ['dirt', 'value', 'base', 'fac'],
      ['dirt', 'value', 'trans', 'a'],
      ['dirt', 'value', 'rough', 'a'],
      ['base', 'color', 'out', 'baseColor'],
      ['trans', 'value', 'out', 'transmission'],
      ['rough', 'value', 'out', 'roughness'],
    ],
  },
  {
    key: 'CHECKS',
    label: { en: 'Checks', es: 'Cuadros' },
    description: { en: 'Black and white checks on a box projection, glossy.', es: 'Cuadros negros y blancos con una proyección de caja, brillante.' },
    nodes: [
      { id: 'map', type: 'MAPPING', x: 40, y: 60, params: { projection: 'BOX', sizeMm: 100 } },
      { id: 'check', type: 'CHECKER', x: 300, y: 60, inputs: { scale: 8, color1: [0.82, 0.82, 0.8], color2: [0.03, 0.03, 0.035] } },
      OUT({ roughness: 0.28, coat: 0.3, coatRoughness: 0.04 }),
    ],
    links: [
      ['map', 'vector', 'check', 'vector'],
      ['check', 'color', 'out', 'baseColor'],
    ],
  },
  {
    key: 'METALLIC_FLAKES',
    label: { en: 'Metallic paint with flakes', es: 'Pintura metalizada con copos' },
    description: { en: 'Deep red car paint under a clear coat, its flakes a fine noise that tilts the normal and lifts the colour.', es: 'Pintura roja de coche bajo un barniz, sus copos un ruido fino que inclina la normal y aclara el color.' },
    nodes: [
      { id: 'flakes', type: 'NOISE', x: 40, y: 60, params: { octaves: 1 }, inputs: { scale: 900 } },
      { id: 'nmap', type: 'NORMAL_MAP', x: 300, y: 60, inputs: { strength: 0.35 } },
      { id: 'sparkle', type: 'NOISE', x: 40, y: 330, params: { octaves: 1, seed: 3 }, inputs: { scale: 900 } },
      { id: 'mix', type: 'MIX', x: 300, y: 330, inputs: { a: [0.3, 0.012, 0.02], b: [0.62, 0.07, 0.06] } },
      OUT({ metallic: 0.7, roughness: 0.33, coat: 1, coatRoughness: 0.02 }),
    ],
    links: [
      ['flakes', 'color', 'nmap', 'color'],
      ['sparkle', 'value', 'mix', 'fac'],
      ['mix', 'color', 'out', 'baseColor'],
      ['nmap', 'normal', 'out', 'normal'],
    ],
  },
  {
    key: 'GLAZED_CERAMIC',
    label: { en: 'Glazed ceramic', es: 'Cerámica con esmalte' },
    description: { en: 'Celadon glaze that pools towards the foot: its clear coat and its colour follow a ramp of the height.', es: 'Esmalte celadón que se acumula hacia el pie: su barniz y su color siguen una rampa de la altura.' },
    nodes: [
      { id: 'map', type: 'MAPPING', x: 40, y: 60, params: { projection: 'OBJECT', axis: 'Y', sizeMm: 100 } },
      { id: 'grad', type: 'GRADIENT', x: 260, y: 40 },
      { id: 'noise', type: 'NOISE', x: 260, y: 230, inputs: { scale: 3 } },
      { id: 'g', type: 'MATH', x: 480, y: 120, params: { op: 'MULTIPLY_ADD' }, inputs: { b: 0.25 } },
      {
        id: 'coat',
        type: 'RAMP',
        x: 700,
        y: 40,
        params: {
          stops: [
            { pos: 0, color: [1, 1, 1] },
            { pos: 0.55, color: [0.8, 0.8, 0.8] },
            { pos: 1, color: [0.35, 0.35, 0.35] },
          ],
        },
      },
      {
        id: 'color',
        type: 'RAMP',
        x: 700,
        y: 300,
        params: {
          stops: [
            { pos: 0.05, color: [0.1, 0.2, 0.15] },
            { pos: 0.6, color: [0.3, 0.46, 0.36] },
            { pos: 1, color: [0.42, 0.56, 0.47] },
          ],
        },
      },
      OUT({ roughness: 0.3, coatRoughness: 0.01, subsurface: 0.2 }),
    ],
    links: [
      ['map', 'vector', 'grad', 'vector'],
      ['map', 'vector', 'noise', 'vector'],
      ['noise', 'value', 'g', 'a'],
      ['grad', 'value', 'g', 'c'],
      ['g', 'value', 'coat', 'fac'],
      ['g', 'value', 'color', 'fac'],
      ['coat', 'color', 'out', 'coat'],
      ['color', 'color', 'out', 'baseColor'],
    ],
  },
  {
    key: 'STRIPES',
    label: { en: 'Stripes', es: 'Rayas' },
    description: { en: 'Navy and cream bands along the mesh’s UVs, the cream ones matte.', es: 'Bandas azul marino y crema a lo largo de las UV de la malla, las crema mates.' },
    nodes: [
      { id: 'map', type: 'MAPPING', x: 40, y: 60, params: { projection: 'UV' } },
      { id: 'stripes', type: 'STRIPES', x: 260, y: 60, params: { axis: 'Y', softness: 0.15 }, inputs: { scale: 10, width: 0.5, color1: [0.74, 0.69, 0.58], color2: [0.015, 0.03, 0.09] } },
      { id: 'rough', type: 'MATH', x: 520, y: 260, params: { op: 'MULTIPLY_ADD' }, inputs: { b: 0.35, c: 0.2 } },
      OUT({ coat: 0.2 }),
    ],
    links: [
      ['map', 'vector', 'stripes', 'vector'],
      ['stripes', 'color', 'out', 'baseColor'],
      ['stripes', 'value', 'rough', 'a'],
      ['rough', 'value', 'out', 'roughness'],
    ],
  },
];

export function exampleGraphDef(key: string): ExampleGraph | undefined {
  return MATERIAL_GRAPHS.find((g) => g.key === key);
}
