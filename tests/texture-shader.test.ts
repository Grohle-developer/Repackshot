// Phase M2a: the preview's texture shader is assembled into three.js' own physical shaders without a GPU. These
// tests put it into the real ShaderLib sources, expand every #include from ShaderChunk, and check what a GLSL
// compiler would refuse first (balanced code, every name declared, every uniform once) for every shape of
// material; tools/textures-check.mjs compiles it in Chromium and looks at the picture.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TEXTURE_AXES, TEXTURE_PROJECTIONS, TEXTURE_SLOTS } from '../src/core/textures';
import {
  fragmentAfterEmissive,
  fragmentAfterLights,
  fragmentAfterMap,
  fragmentAfterMetalness,
  fragmentAfterNormal,
  fragmentAfterRoughness,
  fragmentPars,
  patchShaders,
  shaderKey,
  uniformNames,
  type ShaderConfig,
  type SlotShader,
} from '../src/render/texture-shader';

/** Expands `#include <chunk>` from three's ShaderChunk, recursively. */
function expand(src: string): string {
  return src.replace(/^[ \t]*#include +<([\w\d./]+)>/gm, (_m, name: string) => {
    const chunk = (THREE.ShaderChunk as Record<string, string>)[name];
    if (chunk === undefined) throw new Error(`no chunk ${name}`);
    return expand(chunk);
  });
}

const base = () => ({ vertex: THREE.ShaderLib.physical.vertexShader, fragment: THREE.ShaderLib.physical.fragmentShader });

/** Opened minus closed brackets of each kind, comments aside. Three's own code is not balanced across its #if branches, so compare deltas. */
function delta(src: string): string {
  const code = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const n = (ch: string) => code.split(ch).length - 1;
  return `${n('(') - n(')')} ${n('{') - n('}')} ${n('[') - n(']')}`;
}

/** Our own code: every bracket closed in the order it opened. */
function balanced(src: string): boolean {
  const code = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const pairs: Record<string, string> = { ')': '(', '}': '{', ']': '[' };
  const stack: string[] = [];
  for (const ch of code) {
    if ('({['.includes(ch)) stack.push(ch);
    else if (ch in pairs && stack.pop() !== pairs[ch]) return false;
  }
  return stack.length === 0;
}

const slot = (key: SlotShader['key'], patch: Partial<SlotShader> = {}): SlotShader => ({ key, projection: 'UV', axis: 'Z', uvSet: 0, channel: 'R', height: false, cutout: false, ...patch });

/** Every tx name the code uses must be declared in it (a uniform, a varying, a function or a local). */
function undeclared(src: string): string[] {
  const used = new Set(src.match(/\btx[A-Za-z0-9_]*\b/g) ?? []);
  const declared = new Set<string>();
  for (const m of src.matchAll(/\b(?:uniform|varying|attribute)\s+\w+\s+(tx\w+)/g)) declared.add(m[1]);
  for (const m of src.matchAll(/\b(?:vec[234]|float|bool|int|mat3|sampler2D)\s+(tx\w+)\s*\(/g)) declared.add(m[1]);
  for (const m of src.matchAll(/\b(?:vec[234]|float|bool|int)\s+(tx\w+)\s*(?:=|;|,)/g)) declared.add(m[1]);
  for (const m of src.matchAll(/\bvec2\s+(tx\w+)\s*,\s*(tx\w+)\s*;/g)) declared.add(m[1]).add(m[2]);
  return [...used].filter((n) => !declared.has(n));
}

function configs(): ShaderConfig[] {
  const out: ShaderConfig[] = [];
  for (const projection of TEXTURE_PROJECTIONS) {
    for (const axis of projection === 'UV' || projection === 'BOX' ? (['Z'] as const) : TEXTURE_AXES) {
      out.push({ slots: TEXTURE_SLOTS.map((k) => slot(k, { projection, axis, channel: k === 'roughness' ? 'G' : k === 'metal' ? 'B' : k === 'alpha' ? 'A' : 'R' })), labels: 0, emissive: false });
    }
  }
  out.push({ slots: [slot('normal', { height: true, channel: 'L' }), slot('alpha', { cutout: true })], labels: 2, emissive: false });
  out.push({ slots: [slot('color', { uvSet: 1 })], labels: 1, emissive: true });
  out.push({ slots: [], labels: 3, emissive: false });
  out.push({ slots: [slot('normal', { projection: 'BOX' })], labels: 0, emissive: false });
  return out;
}

describe('the texture shader in three.js’ physical material', () => {
  it('puts its code after the chunks it follows and nowhere else', () => {
    const c: ShaderConfig = { slots: [slot('color')], labels: 1, emissive: false };
    const { vertex, fragment } = patchShaders(base().vertex, base().fragment, c);
    expect(vertex.indexOf('vTxPos = position;')).toBeGreaterThan(vertex.indexOf('#include <begin_vertex>'));
    const after = (code: string, chunk: string) => fragment.indexOf(code) > fragment.indexOf(`#include <${chunk}>`);
    expect(after('diffuseColor.rgb *= txC.rgb;', 'map_fragment')).toBe(true);
    expect(after('roughnessFactor = mix(', 'roughnessmap_fragment')).toBe(true);
    expect(after('metalnessFactor *= 1.0 - txLabelA;', 'metalnessmap_fragment')).toBe(true);
    expect(after('normal = txBump(', 'normal_fragment_maps')).toBe(true);
    expect(after('material.clearcoat = mix(', 'lights_physical_fragment')).toBe(true);
    // Before main: the declarations.
    expect(fragment.indexOf('uniform sampler2D tx_color_map;')).toBeLessThan(fragment.indexOf('void main()'));
    expect(() => patchShaders('void main() {}', base().fragment, c)).toThrow(/begin_vertex/);
  });

  it('is balanced, declares every name it uses and every uniform once, for every shape of material', () => {
    for (const c of configs()) {
      const patched = patchShaders(base().vertex, base().fragment, c);
      const v = expand(patched.vertex);
      const f = expand(patched.fragment);
      const key = shaderKey(c);
      expect(delta(v), key).toBe(delta(expand(base().vertex)));
      expect(delta(f), key).toBe(delta(expand(base().fragment)));
      for (const part of [fragmentPars(c), fragmentAfterMap(c), fragmentAfterRoughness(c), fragmentAfterMetalness(c), fragmentAfterNormal(c), fragmentAfterEmissive(c), fragmentAfterLights(c)]) expect(balanced(part), key).toBe(true);
      expect(undeclared(f), key).toEqual([]);
      for (const name of uniformNames(c)) expect(f.match(new RegExp(`uniform\\s+\\w+\\s+${name};`, 'g')), `${key} ${name}`).toHaveLength(1);
      // Every image is read through the v flip (rows from the top), never straight.
      expect(f.match(/texture(?:Grad)?\(\s*tx\w+_map/g) ?? [], key).toEqual([]);
      // uv1 is declared once whatever three defines.
      expect(v.match(/attribute vec2 uv1;/g)?.length ?? 0, key).toBeLessThanOrEqual(1);
    }
  });

  it('a cut-out discards, a blend multiplies the opacity; a height map bumps, a normal map bends in its frame', () => {
    const cut = patchShaders(base().vertex, base().fragment, { slots: [slot('alpha', { cutout: true, channel: 'A' })], labels: 0, emissive: false }).fragment;
    expect(cut).toContain('if ( txA < tx_alpha_k.y ) discard;');
    expect(cut).not.toContain('diffuseColor.a *= txA;');
    const blend = patchShaders(base().vertex, base().fragment, { slots: [slot('alpha', { channel: 'A' })], labels: 0, emissive: false }).fragment;
    expect(blend).toContain('diffuseColor.a *= txA;');
    const bump = patchShaders(base().vertex, base().fragment, { slots: [slot('normal', { height: true })], labels: 0, emissive: false }).fragment;
    expect(bump).toContain('return txBump( nv, pos, h * tx_normal_k.x );');
    const nmap = patchShaders(base().vertex, base().fragment, { slots: [slot('normal')], labels: 0, emissive: false }).fragment;
    expect(nmap).toContain('return txPerturb( nv, pos, d1, d2, m );');
    // An emitter's colour slot tints its emission, not the base colour.
    const emitter = patchShaders(base().vertex, base().fragment, { slots: [slot('color')], labels: 0, emissive: true }).fragment;
    expect(emitter).toContain('totalEmissiveRadiance *= txColourTex;');
    expect(emitter).not.toContain('diffuseColor.rgb *= txC.rgb;');
  });

  it('keys the program by everything that changes its code, and by nothing else', () => {
    const keys = configs().map(shaderKey);
    expect(new Set(keys).size).toBe(keys.length);
    const a: ShaderConfig = { slots: [slot('color')], labels: 0, emissive: false };
    expect(shaderKey(a)).toBe(shaderKey(JSON.parse(JSON.stringify(a))));
    expect(shaderKey({ ...a, slots: [slot('color', { channel: 'G' })] })).not.toBe(shaderKey(a));
  });
});
