// E6: the Fast preview's knots: the material of a part with knots darkens them (their place from core/knots.ts, as
// the engine puts them), with their bark pocket, on the mean colour it shows. It draws no rings, so neither the flow
// of the grain around the knots.
import * as THREE from 'three';
import { MAX_KNOTS, type Knot, type WoodFrame } from '../core/knots';

type V3 = [number, number, number];
const BARK_MM = 0.5;

/** The uniforms of a material that draws knots. */
export interface KnotUniforms {
  knotCount: { value: number };
  knotDark: { value: number };
  knotMm: { value: number };
  knotOrigin: { value: THREE.Vector3 };
  knotFrame: { value: THREE.Matrix3 };
  knotO: { value: THREE.Vector3[] };
  knotAxis: { value: THREE.Vector3[] };
  knotAcross: { value: THREE.Vector3[] };
  knotFlow: { value: THREE.Vector3[] };
  knotR: { value: number[] };
  knotMid: { value: number[] };
}

function knotUniforms(): KnotUniforms {
  const vs = () => Array.from({ length: MAX_KNOTS }, () => new THREE.Vector3());
  return {
    knotCount: { value: 0 },
    knotDark: { value: 0 },
    knotMm: { value: 1 },
    knotOrigin: { value: new THREE.Vector3() },
    knotFrame: { value: new THREE.Matrix3() },
    knotO: { value: vs() },
    knotAxis: { value: vs() },
    knotAcross: { value: vs() },
    knotFlow: { value: vs() },
    knotR: { value: new Array<number>(MAX_KNOTS).fill(1) },
    knotMid: { value: new Array<number>(MAX_KNOTS).fill(1) },
  };
}

const VERTEX_DECL = 'varying vec3 vKnotPos;\n';
const FRAGMENT_DECL = `varying vec3 vKnotPos;
uniform int knotCount;
uniform float knotDark;
uniform float knotMm;
uniform vec3 knotOrigin;
uniform mat3 knotFrame;
uniform vec3 knotO[${MAX_KNOTS}];
uniform vec3 knotAxis[${MAX_KNOTS}];
uniform vec3 knotAcross[${MAX_KNOTS}];
uniform vec3 knotFlow[${MAX_KNOTS}];
uniform float knotR[${MAX_KNOTS}];
uniform float knotMid[${MAX_KNOTS}];
`;
// After the base colour: a knot is darker by knotDark x 35 %, its bark pocket by half again.
const FRAGMENT_KNOTS = `
{
  vec3 kq = (knotFrame * (vKnotPos - knotOrigin)) * knotMm;
  for (int i = 0; i < ${MAX_KNOTS}; i++) {
    if (i >= knotCount) break;
    vec3 rel = kq - knotO[i];
    float s = dot(rel, knotAxis[i]);
    if (s <= 0.0) continue;
    float a = dot(rel, knotAcross[i]);
    float b = dot(rel, knotFlow[i]);
    float r = knotR[i] * (0.5 + 0.5 * s / knotMid[i]);
    float rho = sqrt(a * a + b * b);
    if (rho < r) {
      float pocket = 1.0 - smoothstep(${(BARK_MM - 0.1).toFixed(2)}, ${BARK_MM.toFixed(2)}, r - rho);
      diffuseColor.rgb *= (1.0 - 0.35 * knotDark) * (1.0 - 0.5 * pocket);
      break;
    }
  }
}
`;

// Kept aside (not in userData, which `Material.copy` replaces).
const UNIFORMS = new WeakMap<THREE.Material, KnotUniforms>();
/** The material a knotted copy was made from, whose own shader patch (M2a's textures) runs first. */
const UNDER = new WeakMap<THREE.Material, THREE.Material>();

/**
 * Makes `m` draw knots (once; its uniforms are then set with `setKnots`). With `under`, the material `m` copies, the
 * patch of `under` (its textures, render/texture-preview.ts) is applied first, and the program follows its key too.
 */
export function enableKnots(m: THREE.MeshPhysicalMaterial, under?: THREE.Material): KnotUniforms {
  if (under) UNDER.set(m, under);
  const existing = UNIFORMS.get(m);
  if (existing) return existing;
  const uniforms = knotUniforms();
  UNIFORMS.set(m, uniforms);
  m.onBeforeCompile = (shader, renderer) => {
    UNDER.get(m)?.onBeforeCompile(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = VERTEX_DECL + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvKnotPos = transformed;');
    shader.fragmentShader = FRAGMENT_DECL + shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>${FRAGMENT_KNOTS}`);
  };
  m.customProgramCacheKey = () => `repack-knots|${UNDER.get(m)?.customProgramCacheKey() ?? ''}`;
  m.needsUpdate = true;
  return uniforms;
}

/** Points the knot uniforms of `m` at the knots of one part. */
export function setKnots(m: THREE.MeshPhysicalMaterial, frame: WoodFrame, knots: readonly Knot[], darkness: number, under?: THREE.Material): void {
  const u = enableKnots(m, under);
  const v = (x: V3, to: THREE.Vector3) => to.set(x[0], x[1], x[2]);
  u.knotCount.value = Math.min(knots.length, MAX_KNOTS);
  u.knotDark.value = darkness;
  u.knotMm.value = frame.mm;
  v(frame.origin, u.knotOrigin.value);
  const [x, y, z] = frame.axes;
  // Rows are the axes: frame * p = (p.x', p.y', p.z').
  u.knotFrame.value.set(x[0], x[1], x[2], y[0], y[1], y[2], z[0], z[1], z[2]);
  knots.slice(0, MAX_KNOTS).forEach((k, i) => {
    v(k.origin, u.knotO.value[i]);
    v(k.axis, u.knotAxis.value[i]);
    v(k.across, u.knotAcross.value[i]);
    v(k.flow, u.knotFlow.value[i]);
    u.knotR.value[i] = k.radius;
    u.knotMid.value[i] = k.middle;
  });
}
