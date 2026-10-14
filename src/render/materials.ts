// Material instances to three.js MeshPhysicalMaterial, shared by the
// viewport and the thumbnail renderer. Approximations of the preview: wood is
// the mean colour of its pattern (the engine draws its rings, pores and grain,
// E6: rt_core::pattern), fabric the mean colour of its weave (the engine
// weaves it), fuzz is sheen, wear is not
// drawn; the engine draws glass (refraction, absorption, thin walls), the
// clear coat, opacity and anisotropy (E5).

import * as THREE from 'three';
import { kelvinToRgb } from '../core/light-math';
import { fabricMeanColor, type MaterialInstance } from '../core/materials';
import { EMIT_RADIANCE_PER_WATT } from '../core/photometry';

/** Emissive radiance per watt of an emitter material: the one the path tracer uses too. */
export const EMIT_K = EMIT_RADIANCE_PER_WATT;

function rgbOf(v: unknown, fallback: readonly number[]): readonly number[] {
  return Array.isArray(v) && v.length >= 3 ? (v as number[]) : fallback;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function setLinear(c: THREE.Color, rgb: readonly number[]): void {
  c.setRGB(rgb[0], rgb[1], rgb[2], THREE.LinearSRGBColorSpace);
}

/** Writes an instance into a physical material (in place; three bumps versions when needed). */
export function applyMaterial(m: THREE.MeshPhysicalMaterial, inst: MaterialInstance, partSizeMm: number): void {
  const p = inst.params;
  // Reset to neutral so a family change leaves nothing behind.
  setLinear(m.color, [0.8, 0.8, 0.8]);
  m.metalness = 0;
  m.roughness = 0.5;
  m.clearcoat = 0;
  m.clearcoatRoughness = 0.03;
  m.ior = 1.5;
  m.transmission = 0;
  m.thickness = 0;
  m.anisotropy = 0;
  m.sheen = 0;
  m.opacity = 1;
  m.transparent = false;
  m.emissive.setRGB(0, 0, 0);
  m.emissiveIntensity = 1;
  m.specularIntensity = 1;
  m.attenuationDistance = Infinity;
  setLinear(m.attenuationColor, [1, 1, 1]);

  switch (inst.family) {
    case 'SIMPLE': {
      const base = rgbOf(p.baseColor, [0.8, 0.8, 0.8]);
      setLinear(m.color, base);
      m.metalness = num(p.metallic, 0);
      m.roughness = num(p.roughness, 0.5);
      m.clearcoat = num(p.coat, 0);
      m.clearcoatRoughness = num(p.coatRoughness, 0.03);
      m.ior = num(p.ior, 1.5);
      m.transmission = num(p.transmission, 0);
      if (m.transmission > 0) m.thickness = partSizeMm * 0.02;
      m.anisotropy = num(p.anisotropic, 0);
      const opacity = num(p.opacity, 1) * (base[3] ?? 1);
      m.opacity = opacity;
      m.transparent = opacity < 1;
      break;
    }
    case 'GLASS': {
      // As the engine (io/rsb.ts materialToRsb): the colour is what light keeps after `absorptionMm` inside
      // (0: a surface tint); a thin wall does not refract.
      const base = rgbOf(p.baseColor, [1, 1, 1]);
      const absorption = Math.max(0, num(p.absorptionMm, 50));
      m.roughness = num(p.roughness, 0);
      m.ior = num(p.ior, 1.52);
      m.transmission = num(p.transmission, 1);
      m.thickness = p.walls === 'THIN' ? 0 : partSizeMm * 0.06;
      if (absorption > 0 && p.walls !== 'THIN') {
        setLinear(m.color, [1, 1, 1]);
        setLinear(m.attenuationColor, base);
        m.attenuationDistance = absorption;
      } else setLinear(m.color, base);
      break;
    }
    case 'WOOD': {
      const a = rgbOf(p.woodColor1, [0.56, 0.38, 0.21]);
      const b = rgbOf(p.woodColor2, [0.3, 0.18, 0.09]);
      setLinear(m.color, [a[0] * 0.6 + b[0] * 0.4, a[1] * 0.6 + b[1] * 0.4, a[2] * 0.6 + b[2] * 0.4]);
      m.roughness = num(p.roughness, 0.45);
      m.clearcoat = num(p.coat, 0);
      break;
    }
    case 'FABRIC': {
      const a = rgbOf(p.threadColor1, [0.7, 0.7, 0.68]);
      setLinear(m.color, fabricMeanColor(p));
      m.roughness = num(p.roughness, 0.75);
      m.sheen = num(p.fuzz, 0.3);
      m.sheenRoughness = num(p.fuzzRoughness, 0.5);
      setLinear(m.sheenColor, [Math.min(1, a[0] * 1.4), Math.min(1, a[1] * 1.4), Math.min(1, a[2] * 1.4)]);
      m.clearcoat = num(p.coat, 0);
      m.clearcoatRoughness = num(p.coatRoughness, 0.05);
      break;
    }
    case 'EMISSIVE': {
      setLinear(m.color, [0.03, 0.03, 0.03]);
      m.roughness = 0.4;
      const c = p.emitKind === 'COLOR' ? rgbOf(p.emitColor, [1, 1, 1]) : kelvinToRgb(num(p.temperature, 5600));
      setLinear(m.emissive, c);
      m.emissiveIntensity = num(p.emitPower, 50) * EMIT_K;
      break;
    }
  }
  m.needsUpdate = true;
}

export function makeMaterial(inst: MaterialInstance | null, partSizeMm: number): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({ side: THREE.FrontSide });
  if (inst) applyMaterial(m, inst, partSizeMm);
  return m;
}
