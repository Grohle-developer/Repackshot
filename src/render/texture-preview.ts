// Image textures and labels in the Fast preview (phase M2a): the shader of texture-shader.ts on the preview's
// MeshPhysicalMaterial of each material instance, and a cache of three textures by image (decoded once from the
// file's bytes in the registry, with mipmaps). A texture that is still decoding shows as nothing (white for the
// maps that multiply, a flat normal, a transparent label) and the preview draws again when it arrives.

import * as THREE from 'three';
import { getImage } from '../core/images';
import type { MaterialInstance } from '../core/materials';
import { hasTextures, labelFrame, slotMapping, TEXTURE_SLOTS, type MaterialTextures, type TextureSlotKey, type TextureWrap } from '../core/textures';
import { MAX_PREVIEW_LABELS, patchShaders, shaderKey, type ShaderConfig } from './texture-shader';

type Uniforms = Record<string, THREE.IUniform>;

interface TxState {
  config: ShaderConfig;
  key: string;
  uniforms: Uniforms;
  /** The cache keys of the textures this material shows. */
  textures: string[];
}

const WRAP: Record<TextureWrap, THREE.Wrapping> = { REPEAT: THREE.RepeatWrapping, CLAMP: THREE.ClampToEdgeWrapping, MIRROR: THREE.MirroredRepeatWrapping };

/** The slots whose image is colour (sRGB); the others are data. */
const COLOUR_SLOTS: readonly TextureSlotKey[] = ['color', 'emission'];

function pixel(rgba: [number, number, number, number]): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array(rgba), 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
}

/** The shader configuration of a material's textures (what changes the code). */
export function shaderConfigOf(inst: MaterialInstance): ShaderConfig {
  const t = inst.textures;
  return {
    slots: TEXTURE_SLOTS.filter((k) => t[k]).map((k) => {
      const s = t[k]!;
      const m = slotMapping(t, k);
      return { key: k, projection: m.projection, axis: m.axis, uvSet: m.uvSet, channel: s.channel, height: s.height, cutout: s.cutout };
    }),
    labels: Math.min(MAX_PREVIEW_LABELS, t.labels.length),
    emissive: inst.family === 'EMISSIVE',
  };
}

export class TexturePreview {
  private readonly textures = new Map<string, THREE.Texture>();
  private readonly bitmaps = new Map<string, Promise<ImageBitmap | null>>();
  private readonly decoded = new Map<string, ImageBitmap>();
  private readonly white = pixel([255, 255, 255, 255]);
  private readonly flatNormal = pixel([128, 128, 255, 255]);
  private readonly clear = pixel([0, 0, 0, 0]);
  private disposed = false;

  /** `ready`: a texture finished decoding (draw again). `anisotropy`: the renderer's most. */
  constructor(
    private readonly ready: () => void,
    private readonly anisotropy = 8,
  ) {}

  /** The decoded image of a registered texture file (once per image). */
  private bitmap(id: string): Promise<ImageBitmap | null> {
    let p = this.bitmaps.get(id);
    if (!p) {
      const data = getImage(id);
      p =
        data && typeof createImageBitmap === 'function'
          ? createImageBitmap(new Blob([data.bytes as Uint8Array<ArrayBuffer>], { type: data.format === 'PNG' ? 'image/png' : 'image/jpeg' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
              .then((b) => {
                if (this.disposed) {
                  b.close();
                  return null;
                }
                this.decoded.set(id, b);
                return b;
              })
              .catch(() => null)
          : Promise.resolve(null);
      this.bitmaps.set(id, p);
    }
    return p;
  }

  /** The three texture of an image read as colour or data, with a wrap; `fallback` while it decodes. */
  private texture(id: string, colour: boolean, wrap: TextureWrap, uniform: THREE.IUniform, fallback: THREE.Texture): string {
    const key = `${id}|${colour ? 's' : 'l'}|${wrap}`;
    const hit = this.textures.get(key);
    if (hit) {
      uniform.value = hit.image ? hit : fallback;
      if (!hit.image) void this.bitmap(id).then(() => this.textures.get(key) === hit && hit.image && (uniform.value = hit));
      return key;
    }
    const tex = new THREE.Texture();
    tex.flipY = false;
    tex.colorSpace = colour ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.wrapS = tex.wrapT = WRAP[wrap];
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = this.anisotropy;
    this.textures.set(key, tex);
    uniform.value = fallback;
    void this.bitmap(id).then((b) => {
      if (!b || this.textures.get(key) !== tex) return;
      tex.image = b;
      tex.needsUpdate = true;
      uniform.value = tex;
      this.ready();
    });
    return key;
  }

  /**
   * Gives the preview material of an instance its textures (after `applyMaterial`, which resets everything else):
   * the shader when the configuration changed, the uniforms always. A material without textures loses the shader.
   */
  apply(m: THREE.MeshPhysicalMaterial, inst: MaterialInstance): void {
    const t = inst.textures;
    const prev = m.userData.tx as TxState | undefined;
    if (!hasTextures(t)) {
      if (prev) {
        delete m.userData.tx;
        m.onBeforeCompile = () => undefined;
        m.customProgramCacheKey = () => '';
        m.needsUpdate = true;
      }
      return;
    }
    const config = shaderConfigOf(inst);
    const key = shaderKey(config);
    const uniforms: Uniforms = prev?.uniforms ?? {};
    const used = this.fill(uniforms, t, config);
    const state: TxState = { config, key, uniforms, textures: used };
    m.userData.tx = state;
    if (!prev || prev.key !== key) {
      m.onBeforeCompile = (shader) => {
        const s = m.userData.tx as TxState | undefined;
        if (!s) return;
        const patched = patchShaders(shader.vertexShader, shader.fragmentShader, s.config);
        shader.vertexShader = patched.vertex;
        shader.fragmentShader = patched.fragment;
        Object.assign(shader.uniforms, s.uniforms);
      };
      m.customProgramCacheKey = () => (m.userData.tx as TxState | undefined)?.key ?? '';
      m.needsUpdate = true;
    }
    // An alpha slot that blends draws the material see-through.
    if (t.alpha && !t.alpha.cutout) m.transparent = true;
    // Three has the clear coat code only for a material that has a coat: a label with one needs it.
    if (config.labels > 0 && t.labels.some((l) => l.coat > 0) && m.clearcoat === 0) m.clearcoat = 1e-4;
  }

  /** Sets the uniforms of a material's textures; returns the cache keys of the textures it uses. */
  private fill(u: Uniforms, t: MaterialTextures, c: ShaderConfig): string[] {
    const used: string[] = [];
    const set = (name: string, value: unknown) => {
      if (u[name]) u[name].value = value;
      else u[name] = { value };
    };
    for (const s of c.slots) {
      const slot = t[s.key]!;
      const m = slotMapping(t, s.key);
      const aspect = slot.image.width > 0 && slot.image.height > 0 ? slot.image.width / slot.image.height : 1;
      const a = (m.rotationDeg * Math.PI) / 180;
      set(`tx_${s.key}_xf`, new THREE.Vector4(m.repeat[0], m.repeat[1], m.offset[0], m.offset[1]));
      set(`tx_${s.key}_rs`, new THREE.Vector4(Math.cos(a), Math.sin(a), m.sizeMm, m.sizeMm / aspect));
      set(`tx_${s.key}_k`, new THREE.Vector4(slot.strength, slot.cutoff, slot.invert ? 1 : 0, 0));
      const name = `tx_${s.key}_map`;
      if (!u[name]) u[name] = { value: null };
      const fallback = s.key === 'normal' && !slot.height ? this.flatNormal : s.key === 'emission' ? this.clear : this.white;
      used.push(this.texture(slot.image.id, COLOUR_SLOTS.includes(s.key), m.wrap, u[name], fallback));
    }
    if (t.emission) set('tx_emission_tint', new THREE.Vector3(...t.emission.tint));
    for (let i = 0; i < c.labels; i++) {
      const l = t.labels[i];
      const f = labelFrame(l, l.image.width / l.image.height);
      set(`tx_label${i}_o`, new THREE.Vector3(...f.origin));
      set(`tx_label${i}_u`, new THREE.Vector3(...f.u));
      set(`tx_label${i}_v`, new THREE.Vector3(...f.v));
      set(`tx_label${i}_n`, new THREE.Vector3(...f.normal));
      set(`tx_label${i}_size`, new THREE.Vector3(f.width, f.height, f.depth));
      set(`tx_label${i}_finish`, new THREE.Vector3(l.roughness, l.coat, l.relief));
      const name = `tx_label${i}_map`;
      if (!u[name]) u[name] = { value: null };
      used.push(this.texture(l.image.id, true, 'CLAMP', u[name], this.clear));
    }
    return used;
  }

  /** Frees the textures no material in `materials` shows any more. */
  prune(materials: Iterable<THREE.Material>): void {
    const keep = new Set<string>();
    for (const m of materials) for (const k of (m.userData.tx as TxState | undefined)?.textures ?? []) keep.add(k);
    const ids = new Set<string>();
    for (const [k, tex] of this.textures) {
      if (keep.has(k)) {
        ids.add(k.split('|')[0]);
        continue;
      }
      tex.dispose();
      this.textures.delete(k);
    }
    for (const [id, b] of this.decoded) {
      if (ids.has(id)) continue;
      b.close();
      this.decoded.delete(id);
      this.bitmaps.delete(id);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const t of this.textures.values()) t.dispose();
    for (const b of this.decoded.values()) b.close();
    this.textures.clear();
    this.decoded.clear();
    this.bitmaps.clear();
    this.white.dispose();
    this.flatNormal.dispose();
    this.clear.dispose();
  }
}
