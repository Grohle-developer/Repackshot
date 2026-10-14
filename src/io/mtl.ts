// Wavefront MTL (phase M2a, own reader, from the format's public description): the material libraries an OBJ
// names with `mtllib`, read when they are dropped with it, with the image files they name.
//
//   newmtl            a material
//   Kd Ks Ke          diffuse, specular and emitted colour (Kd and Ke as sRGB, like three's MTLLoader)
//   Ns                specular exponent (to roughness the way the other Phong readers do)
//   d / Tr            opacity (Tr = 1 − d)
//   Ni                index of refraction
//   Pr Pm Pc Pcr      the PBR extension: roughness, metal, clear coat and its roughness
//   map_Kd            colour                      map_Pr       roughness
//   map_Ns / map_Ks   roughness, inverted (a shininess or specular map: bright is glossy), when there is no map_Pr
//   map_Pm            metal                       map_d        alpha (luminance unless -imfchan says otherwise)
//   norm              tangent-space normal map
//   map_bump / bump   a height (bump) map, `-bm` its strength, unless its name says it is a tangent-space
//                     normal map (normal, nrm, _n., _nor), as many exporters write one there
//   map_Ke            emission (tint Ke)
//   map_Ka, disp, decal, refl: no slot for them (reported)
// Options before a file name: -s u v (repeat), -o u v (offset), -bm (strength), -clamp on (no repeat),
// -imfchan r|g|b|m|l|z (the channel of a scalar map), the rest are skipped with their values.

import type { MaterialParams } from '../data/types';
import { roughnessFromShininess } from './mesh-common';
import type { TextureChannel, TextureSlotKey, TextureWrap } from '../core/textures';

/** A map statement: the file and what its options say. */
export interface MtlMap {
  file: string;
  repeat: [number, number];
  offset: [number, number];
  /** -bm, the bump multiplier (1 when absent). */
  bumpMultiplier: number;
  wrap: TextureWrap;
  /** -imfchan as our channel, when given. */
  channel: TextureChannel | null;
}

/** What a material of the library becomes: parameters, and maps by slot. */
export interface MtlMaterial {
  name: string;
  params: MaterialParams;
  maps: Partial<Record<TextureSlotKey, MtlMap & { invert: boolean; height: boolean; tint?: [number, number, number] }>>;
  /** Map statements we have no slot for, by keyword. */
  unused: { keyword: string; map: MtlMap }[];
}

/** How many numbers each option takes (MTL spec). */
const OPTION_ARGS: Record<string, number> = { '-blendu': 1, '-blendv': 1, '-boost': 1, '-mm': 2, '-o': 3, '-s': 3, '-t': 3, '-texres': 1, '-clamp': 1, '-bm': 1, '-imfchan': 1, '-cc': 1, '-type': 1 };

const CHANNEL: Record<string, TextureChannel> = { r: 'R', g: 'G', b: 'B', m: 'L', l: 'L', z: 'L' };

/** Reads the options and the file name of a map statement. */
export function parseMapStatement(rest: string): MtlMap {
  const tokens = rest.trim().split(/\s+/);
  const out: MtlMap = { file: '', repeat: [1, 1], offset: [0, 0], bumpMultiplier: 1, wrap: 'REPEAT', channel: null };
  let i = 0;
  while (i < tokens.length && tokens[i].startsWith('-') && OPTION_ARGS[tokens[i].toLowerCase()] !== undefined) {
    const opt = tokens[i].toLowerCase();
    const want = OPTION_ARGS[opt];
    // Options with three values may give fewer (the rest default); take the numbers that are there.
    const args: string[] = [];
    let j = i + 1;
    while (args.length < want && j < tokens.length - 1 && (want === 1 || /^[-+]?(\d|\.\d)/.test(tokens[j]))) args.push(tokens[j++]);
    const n = (k: number, d: number) => {
      const v = Number(args[k]);
      return Number.isFinite(v) ? v : d;
    };
    if (opt === '-s') out.repeat = [n(0, 1), n(1, n(0, 1))];
    else if (opt === '-o') out.offset = [n(0, 0), n(1, 0)];
    else if (opt === '-bm') out.bumpMultiplier = n(0, 1);
    else if (opt === '-clamp') out.wrap = args[0]?.toLowerCase() === 'on' ? 'CLAMP' : 'REPEAT';
    else if (opt === '-imfchan') out.channel = CHANNEL[args[0]?.toLowerCase() ?? ''] ?? null;
    i = j;
  }
  // The file name is the rest: it may have spaces.
  out.file = tokens.slice(i).join(' ');
  return out;
}

const srgbToLinear = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** A file name that says it is a tangent-space normal map. */
export function looksLikeNormalMap(file: string): boolean {
  return /normal|nrm|[_\-.]nor(?:m)?\b|_n\./i.test(file.split(/[\\/]/).pop() ?? file);
}

/** Parses the text of a .mtl file. */
export function parseMtl(text: string): MtlMaterial[] {
  const out: MtlMaterial[] = [];
  let cur: (MtlMaterial & { raw: Record<string, number[]>; rawMaps: Record<string, MtlMap> }) | null = null;
  const finish = (): void => {
    if (!cur) return;
    out.push(resolve(cur));
    cur = null;
  };
  for (const rawLine of text.split(/\r\n|\n|\r/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const sp = line.search(/\s/);
    const key = (sp < 0 ? line : line.slice(0, sp)).toLowerCase();
    const rest = sp < 0 ? '' : line.slice(sp + 1).trim();
    if (key === 'newmtl') {
      finish();
      cur = { name: rest || 'Material', params: {}, maps: {}, unused: [], raw: {}, rawMaps: {} };
      continue;
    }
    if (!cur) continue;
    const c: NonNullable<typeof cur> = cur;
    if (key.startsWith('map_') || key === 'bump' || key === 'norm' || key === 'disp' || key === 'decal' || key === 'refl') {
      const map = parseMapStatement(rest);
      if (map.file) c.rawMaps[key === 'bump' ? 'map_bump' : key] = map;
      continue;
    }
    const nums = rest.split(/\s+/).map(Number).filter((x) => Number.isFinite(x));
    if (nums.length > 0) c.raw[key] = nums;
  }
  finish();
  return out;
}

function resolve(c: MtlMaterial & { raw: Record<string, number[]>; rawMaps: Record<string, MtlMap> }): MtlMaterial {
  const r = c.raw;
  const rgb = (k: string, d: number[]): [number, number, number] => {
    const v = r[k];
    if (!v) return [d[0], d[1], d[2]];
    return [v[0], v[1] ?? v[0], v[2] ?? v[0]];
  };
  const kd = rgb('kd', [0.8, 0.8, 0.8]).map(srgbToLinear);
  const ks = rgb('ks', [0, 0, 0]);
  const params: MaterialParams = { baseColor: [kd[0], kd[1], kd[2], 1], metallic: r.pm ? r.pm[0] : 0 };
  params.roughness = r.pr ? Math.min(1, Math.max(0, r.pr[0])) : roughnessFromShininess(r.ns ? r.ns[0] : 30, (ks[0] + ks[1] + ks[2]) / 3);
  const opacity = r.d ? r.d[0] : r.tr ? 1 - r.tr[0] : 1;
  if (opacity < 1) params.opacity = Math.max(0, opacity);
  if (r.ni && r.ni[0] >= 1) params.ior = Math.min(2.5, r.ni[0]);
  if (r.pc && r.pc[0] > 0) {
    params.coat = Math.min(1, r.pc[0]);
    params.coatRoughness = r.pcr ? Math.min(1, Math.max(0, r.pcr[0])) : 0.03;
  }
  const m = c.rawMaps;
  const maps: MtlMaterial['maps'] = {};
  const unused: MtlMaterial['unused'] = [];
  const usedKeys = new Set<string>();
  const use = (key: string, slot: TextureSlotKey, extra: { invert?: boolean; height?: boolean; tint?: [number, number, number] } = {}): boolean => {
    const map = m[key];
    if (!map || maps[slot]) return false;
    maps[slot] = { ...map, invert: extra.invert ?? false, height: extra.height ?? false, ...(extra.tint ? { tint: extra.tint } : {}) };
    usedKeys.add(key);
    return true;
  };
  use('map_kd', 'color');
  if (!use('map_pr', 'roughness') && !use('map_ns', 'roughness', { invert: true })) use('map_ks', 'roughness', { invert: true });
  use('map_pm', 'metal');
  use('map_d', 'alpha');
  if (!use('norm', 'normal')) {
    const bump = m.map_bump;
    if (bump) use('map_bump', 'normal', { height: !looksLikeNormalMap(bump.file) });
  }
  const ke = r.ke ? rgb('ke', [0, 0, 0]).map(srgbToLinear) : [1, 1, 1];
  use('map_ke', 'emission', { tint: [ke[0], ke[1], ke[2]] });
  for (const [k, map] of Object.entries(m)) if (!usedKeys.has(k)) unused.push({ keyword: k, map });
  return { name: c.name, params, maps, unused };
}
