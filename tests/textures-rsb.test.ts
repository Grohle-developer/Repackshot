// Phase M2a: the RSB contract for M2b (ARCHITECTURE §5.2). Without the `textures` switch the writer's bytes are
// those of before M2a, whatever the materials hold; with it, the IMGS section, the MATL texture block from byte 100
// and the meshes' UVs are written as documented. This reads them back with its own reader of the layout.

import { describe, expect, it } from 'vitest';
import { getImage } from '../src/core/images';
import { getMesh } from '../src/core/meshes';
import { defaultTextures, TEXTURE_SLOTS, textureImages } from '../src/core/textures';
import type { ProjectState } from '../src/core/store';
import { MATL_TEXTURE_OFFSET, projectScene, TEXTURE_BLOCK_VERSION, writeRsb, type SceneView } from '../src/io/rsb';
import { decodeTexturePixels } from '../src/io/texture-pixels';
import { sections } from './rsb-reader';
import { fixtureDecoder, texturedProject } from './texture-helpers';

const VIEW: SceneView = { width: 64, height: 48, maxSamples: 4, maxSeconds: 0 };

function stripped(s: ProjectState): ProjectState {
  const materials = Object.fromEntries(Object.entries(s.materials).map(([id, m]) => [id, { ...m, textures: defaultTextures() }]));
  return { ...s, materials };
}

describe('the RSB writer with textures off (until M2b)', () => {
  it('writes the same bytes as for the materials without their textures', async () => {
    const s = await texturedProject();
    await decodeTexturePixels(s, fixtureDecoder);
    const a = writeRsb(projectScene(s, VIEW).scene);
    const b = writeRsb(projectScene(stripped(s), VIEW).scene);
    expect(a).toEqual(b);
    expect(sections(a).map((x) => x.tag)).not.toContain('IMGS');
    // E5's fields and E6's bevel_mm: the texture block is not written.
    for (const sec of sections(a)) if (sec.tag === 'MATL') expect(sec.payload.byteLength).toBe(76);
    expect(projectScene(s, VIEW).meshKey).toBe(projectScene(stripped(s), VIEW).meshKey);
    expect(projectScene(s, VIEW).scene.materials.every((m) => m.textures === undefined)).toBe(true);
  });

  it('ignores a material’s texture block and a scene’s images unless the scene says it carries textures', async () => {
    const s = await texturedProject();
    await decodeTexturePixels(s, fixtureDecoder);
    const on = projectScene(s, { ...VIEW, textures: true }).scene;
    const off = { ...on, textures: undefined };
    const bytes = writeRsb(off);
    expect(sections(bytes).map((x) => x.tag)).not.toContain('IMGS');
    for (const sec of sections(bytes)) if (sec.tag === 'MATL') expect(sec.payload.byteLength).toBe(76);
    expect(bytes).toEqual(writeRsb(projectScene(stripped(s), VIEW).scene));
  });
});

describe('the RSB writer with textures on (the contract M2b reads)', () => {
  it('writes the images decoded, one per image and colour space, rows from the top', async () => {
    const s = await texturedProject();
    await decodeTexturePixels(s, fixtureDecoder);
    for (const id of textureImages(s).keys()) expect(getImage(id)?.rgba8, id).toBeDefined();
    const ps = projectScene(s, { ...VIEW, textures: true });
    const bytes = writeRsb(ps.scene);
    const imgs = sections(bytes).filter((x) => x.tag === 'IMGS');
    expect(imgs).toHaveLength(1);
    const v = imgs[0].payload;
    const count = v.getUint32(0, true);
    // colour (sRGB) and the same image as alpha (linear), metal-rough (linear, used twice: once), normal, emission (sRGB).
    expect(count).toBe(5);
    let at = 4;
    const read: { w: number; h: number; c: number; cs: number }[] = [];
    for (let i = 0; i < count; i++) {
      const w = v.getUint32(at, true);
      const h = v.getUint32(at + 4, true);
      const c = v.getUint32(at + 8, true);
      const cs = v.getUint32(at + 12, true);
      read.push({ w, h, c, cs });
      at += 16 + w * h * c + ((4 - ((w * h * c) % 4)) % 4);
    }
    expect(at).toBe(v.byteLength);
    expect(read[0]).toEqual({ w: 64, h: 64, c: 4, cs: 0 });
    // The first image's first row is the top of the colour image: red (its top-left quadrant), opaque.
    expect([v.getUint8(20), v.getUint8(21), v.getUint8(22), v.getUint8(23)]).toEqual([220, 40, 40, 255]);
    expect(read.map((r) => r.cs)).toEqual([0, 1, 1, 1, 0]);
    expect(ps.meshKey).toMatch(/\|textures:/);
  });

  it('writes each MATL with its texture block after byte 100: version, six slots, the tint, the labels', async () => {
    const s = await texturedProject();
    await decodeTexturePixels(s, fixtureDecoder);
    const scene = projectScene(s, { ...VIEW, textures: true }).scene;
    const bytes = writeRsb(scene);
    const matl = sections(bytes).filter((x) => x.tag === 'MATL');
    expect(matl).toHaveLength(1);
    const p = matl[0].payload;
    // The contract: the block starts at byte 100, after E6's bevel_mm and E9's six fields.
    expect(MATL_TEXTURE_OFFSET).toBe(100);
    expect(p.byteLength).toBe(100 + 4 * (1 + 6 * 15 + 3 + 1 + 19));
    // E6's bevel_mm (bytes 72 to 76) is the material's; E9's fields (76 to 100) are zeros until it writes them.
    expect(p.getFloat32(72, true)).toBe(Math.fround(scene.materials[0].bevelMm));
    for (let i = 76; i < 100; i += 4) expect(p.getUint32(i, true)).toBe(0);
    let at = MATL_TEXTURE_OFFSET;
    const u32 = () => {
      const x = p.getUint32(at, true);
      at += 4;
      return x;
    };
    const f32 = () => {
      const x = p.getFloat32(at, true);
      at += 4;
      return x;
    };
    expect(u32()).toBe(TEXTURE_BLOCK_VERSION);
    const slots = TEXTURE_SLOTS.map(() => ({ image: u32() | 0, projection: u32(), axis: u32(), uvSet: u32(), sizeMm: f32(), rotationDeg: f32(), offset: [f32(), f32()], repeat: [f32(), f32()], wrap: u32(), channel: u32(), flags: u32(), strength: f32(), cutoff: f32() }));
    expect(slots.map((x) => x.image)).toEqual([0, 1, 1, 2, 3, 4]);
    expect(slots.map((x) => x.channel)).toEqual([0, 1, 2, 0, 3, 0]);
    expect(slots[3].strength).toBeCloseTo(0.8);
    expect(slots[4].flags).toBe(2); // the alpha is a cut-out
    expect(slots[4].cutoff).toBeCloseTo(0.4);
    expect(slots[5].strength).toBe(2);
    expect(slots.every((x) => x.projection === 0 && x.repeat[0] === 1)).toBe(true);
    expect([f32(), f32(), f32()]).toEqual([1, 0.5, 0.25]);
    expect(u32()).toBe(1);
    const label = { image: u32() | 0, origin: [f32(), f32(), f32()], u: [f32(), f32(), f32()], v: [f32(), f32(), f32()], n: [f32(), f32(), f32()], size: [f32(), f32(), f32()], finish: [f32(), f32(), f32()] };
    expect(at).toBe(p.byteLength);
    expect(label.image).toBe(0); // the colour image as sRGB: the colour slot's entry
    expect(label.origin).toEqual([0, -50, 10]);
    expect(label.u).toEqual([1, 0, 0]);
    expect(label.v).toEqual([0, 0, 1]);
    expect(label.n).toEqual([0, -1, 0]);
    expect(label.size).toEqual([30, 30, 15]);
    expect(label.finish.map((x) => Math.round(x * 100) / 100)).toEqual([0.6, 0, 0.3]);
  });

  it('writes the meshes’ UV sets after their material id', async () => {
    const s = await texturedProject();
    await decodeTexturePixels(s, fixtureDecoder);
    const on = sections(writeRsb(projectScene(s, { ...VIEW, textures: true }).scene)).find((x) => x.tag === 'MESH')!.payload;
    const off = sections(writeRsb(projectScene(s, VIEW).scene)).find((x) => x.tag === 'MESH')!.payload;
    const n = off.getUint32(0, true);
    expect(on.byteLength).toBe(off.byteLength + 4 + 2 * 8 * n);
    expect(on.getUint32(off.byteLength, true)).toBe(2);
    // The first set, then the second, vertex by vertex, as the mesh holds them.
    const mesh = getMesh(Object.values(s.scene.nodes).find((x) => x.mesh)!.mesh!.id)!;
    const at = off.byteLength + 4;
    for (let i = 0; i < 2 * n; i++) expect(on.getFloat32(at + 4 * i, true)).toBe(mesh.uvs![i]);
    for (let i = 0; i < 2 * n; i++) expect(on.getFloat32(at + 8 * n + 4 * i, true)).toBe(mesh.uvs2![i]);
  });

  it('an image without decoded pixels gives its slots no image (-1)', async () => {
    const s = await texturedProject();
    // Forget the pixels of every texture image: only their files are left.
    for (const id of textureImages(s).keys()) {
      const d = getImage(id)!;
      delete d.rgba8;
    }
    const bytes = writeRsb(projectScene(s, { ...VIEW, textures: true }).scene);
    const p = sections(bytes).find((x) => x.tag === 'MATL')!.payload;
    expect(p.getInt32(MATL_TEXTURE_OFFSET + 4, true)).toBe(-1);
    expect(sections(bytes).map((x) => x.tag)).not.toContain('IMGS');
  });
});
