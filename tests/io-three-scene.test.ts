// What the three.js readers share (src/io/three-scene.ts), checked on scenes
// built by hand rather than through a loader: the hierarchy rules, baked
// transforms, visibility, multi-material meshes and the material conversion.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { describePayload } from '../src/core/import-options';
import { collectTextures, convertScene, roughnessFromShininess, surfaceParams, toPayload } from '../src/io/three-scene';
import { colorOf, meshOf } from './io-helpers';

const close = (got: readonly number[], want: readonly number[], digits = 4) => want.forEach((w, i) => expect(got[i], `[${i}]`).toBeCloseTo(w, digits));
const box = (name: string, material: THREE.Material | THREE.Material[] = new THREE.MeshStandardMaterial({ name: 'M' }), w = 2, h = 2, d = 2) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.name = name;
  return m;
};
const convert = (root: THREE.Object3D, o: Partial<Parameters<typeof convertScene>[1]> = {}) => convertScene(root, { fileName: 'scene.test', format: 'TEST', ...o });
const byName = (c: ReturnType<typeof convert>, name: string, kind?: string) => Object.values(c.nodes).find((n) => n.name === name && (!kind || n.kind === kind))!;

describe('hierarchy', () => {
  it('objects with children become groups, meshes parts, the root the model; empty groups, lights and cameras vanish', () => {
    const root = new THREE.Group();
    const group = new THREE.Group();
    group.name = 'Fittings';
    group.add(box('Cap'));
    root.add(group, box('Body'));
    const empty = new THREE.Group();
    empty.name = 'Nothing';
    empty.add(new THREE.PointLight(), new THREE.PerspectiveCamera());
    root.add(empty, new THREE.AmbientLight());
    const c = convert(root, { fileName: 'bottle.fbx', format: 'FBX' });
    expect(describePayload({ nodes: c.nodes, roots: c.roots, materials: c.materials })).toEqual({ parts: 2, groups: 1, triangles: 24, materials: 1 });
    const model = c.nodes[c.roots[0]];
    expect(model).toMatchObject({ kind: 'MODEL', name: 'bottle', source: { kind: 'FILE', name: 'bottle.fbx', format: 'FBX' } });
    expect(model.children.map((id) => c.nodes[id].name)).toEqual(['Fittings', 'Body']);
    expect(byName(c, 'Cap').parent).toBe(byName(c, 'Fittings').id);
    expect(byName(c, 'Nothing')).toBeUndefined();
  });

  it('a mesh with children is a group holding the part and the children, so nothing is flattened', () => {
    const root = new THREE.Group();
    const body = box('Body');
    body.add(box('Cap'));
    root.add(body);
    const c = convert(root);
    const g = byName(c, 'Body', 'GROUP');
    expect(g.children.map((id) => [c.nodes[id].kind, c.nodes[id].name])).toEqual([['PART', 'Body'], ['PART', 'Cap']]);
    expect(c.nodes[c.roots[0]].children).toEqual([g.id]);
  });

  it('a file that is a bare mesh is a model with one part; one without meshes is an error', () => {
    const c = convert(box('Solo'), { fileName: 'solo.ply' });
    expect(describePayload({ nodes: c.nodes, roots: c.roots, materials: c.materials }).parts).toBe(1);
    expect(c.nodes[c.roots[0]].name).toBe('solo');
    expect(() => convert(new THREE.Group())).toThrow('no meshes');
    const lines = new THREE.Group();
    lines.add(new THREE.Line(new THREE.BufferGeometry()));
    expect(() => convert(lines)).toThrow('no meshes');
  });

  it('names parts and groups that have no name', () => {
    const root = new THREE.Group();
    const g = new THREE.Group();
    g.add(box(''));
    root.add(g);
    const c = convert(root);
    expect(Object.values(c.nodes).filter((n) => n.kind !== 'MODEL').map((n) => n.name).every((n) => /^(Part|Group) \d+$/.test(n))).toBe(true);
  });

  it('collapseSingleParts: a build item around one part is that part, which takes the item name when it has none', () => {
    const root = new THREE.Group();
    const item = new THREE.Group();
    item.name = 'Item A';
    item.add(box(''));
    const pair = new THREE.Group();
    pair.name = 'Item B';
    pair.add(box('P1'), box('P2'));
    root.add(item, pair);
    const c = convert(root, { collapseSingleParts: true });
    expect(c.nodes[c.roots[0]].children.map((id) => [c.nodes[id].kind, c.nodes[id].name])).toEqual([['PART', 'Item A'], ['GROUP', 'Item B']]);
    // Off, the group stays.
    expect(describePayload({ ...convert(root) , roots: convert(root).roots }).groups).toBe(2);
  });
});

describe('geometry', () => {
  it('bakes the world transform into the vertices and re-centres the part: the node carries the offset', () => {
    const root = new THREE.Group();
    const g = new THREE.Group();
    g.position.set(10, 0, 0);
    g.scale.set(2, 1, 1);
    const b = box('Body', undefined, 2, 2, 2);
    b.position.set(5, 0, 0);
    g.add(b);
    root.add(g);
    const c = convert(root);
    const body = byName(c, 'Body', 'PART');
    // Local x 5 scaled by 2 and moved by 10: centre 20; the 2-wide box is 4 wide.
    close(body.transform.position, [20, 0, 0]);
    close(body.mesh!.bounds.max, [2, 1, 1]);
    close(body.mesh!.bounds.min, [-2, -1, -1]);
    // The group keeps no transform of its own.
    expect(byName(c, 'Body', 'GROUP')).toBeUndefined();
    expect(c.nodes[body.parent!].transform.position).toEqual([0, 0, 0]);
  });

  it('welds the box and finds its hard edges, like the OBJ and STL readers', () => {
    const c = convert(box('Body'));
    const body = byName(c, 'Body', 'PART');
    expect(body.mesh).toMatchObject({ vertices: 24, triangles: 12 });
    expect(meshOf(body).sharpEdges!.length / 2).toBe(12);
  });

  it('drops the triangles that have no area and says so', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 1, 2, 2, 2], 3));
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    mesh.name = 'Sliver';
    const c = convert(mesh);
    expect(byName(c, 'Sliver').mesh!.triangles).toBe(1);
    expect(c.warnings).toEqual([{ code: 'degenerate', params: { part: 'Sliver', count: 1 } }]);
    // A mesh with nothing but slivers is skipped, with the count.
    const flat = new THREE.BufferGeometry();
    flat.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 1, 2, 2, 2], 3));
    const good = box('Good');
    const root = new THREE.Group();
    const dead = new THREE.Mesh(flat, new THREE.MeshStandardMaterial());
    dead.name = 'Dead';
    root.add(dead, good);
    const c2 = convert(root);
    expect(byName(c2, 'Dead')).toBeUndefined();
    expect(c2.warnings).toEqual([{ code: 'degenerate', params: { part: 'Dead', count: 1 } }]);
  });

  it('ignoreNormals discards the loader normals so hard edges come from the angle', () => {
    const smooth = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2).toNonIndexed(), new THREE.MeshStandardMaterial());
    const g = smooth.geometry;
    g.deleteAttribute('uv'); // the box's uvs would split the corners by themselves
    // Pretend a loader smoothed the cube: every normal points away from the centre.
    const pos = g.getAttribute('position');
    const n = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i).normalize();
      n.set([v.x, v.y, v.z], 3 * i);
    }
    g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    smooth.name = 'Ball';
    expect(byName(convert(smooth), 'Ball').mesh!.vertices).toBe(8);
    expect(byName(convert(smooth, { ignoreNormals: true }), 'Ball').mesh!.vertices).toBe(24);
  });
});

describe('visibility', () => {
  it('keeps the flag of a part, of its group and of the model, and counts the hidden parts', () => {
    const root = new THREE.Group();
    const hiddenGroup = new THREE.Group();
    hiddenGroup.name = 'Construction';
    hiddenGroup.visible = false;
    hiddenGroup.add(box('Guide'), box('Guide 2'));
    const lone = box('Spare');
    lone.visible = false;
    root.add(hiddenGroup, lone, box('Body'));
    const c = convert(root);
    expect(byName(c, 'Construction').visible).toBe(false);
    expect(byName(c, 'Spare').visible).toBe(false);
    expect(byName(c, 'Body').visible).toBe(true);
    expect(c.hiddenParts).toBe(3);
  });

  it('a hidden mesh with children hides them: the group carries the flag', () => {
    const root = new THREE.Group();
    const body = box('Body');
    body.visible = false;
    body.add(box('Cap'));
    root.add(body);
    const c = convert(root);
    expect(byName(c, 'Body', 'GROUP').visible).toBe(false);
    expect(c.hiddenParts).toBe(2);
  });
});

describe('materials', () => {
  it('turns a mesh with several materials into a part with face ranges', () => {
    const a = new THREE.MeshStandardMaterial({ name: 'A', color: 0xff0000 });
    const b = new THREE.MeshStandardMaterial({ name: 'B', color: 0x00ff00 });
    // BoxGeometry has six groups, one per face (two triangles each), with material index 0..5: indices past the list use the first.
    const c = convert(box('Body', [a, b]));
    const body = byName(c, 'Body', 'PART');
    expect(Object.values(c.materials).map((m) => m.name)).toEqual(['A', 'B']);
    expect(c.materials[body.material!].name).toBe('A');
    expect(body.faceMaterials).toEqual([{ start: 2, count: 2, material: 'tm2' }]);
    expect(c.materials.tm2.name).toBe('B');
  });

  it('gives equal materials one instance, and different ones their own', () => {
    const root = new THREE.Group();
    const make = (name: string, color: number) => new THREE.MeshStandardMaterial({ name, color });
    root.add(box('A1', make('Paint', 0xff0000)), box('A2', make('Paint', 0xff0000)), box('B', make('Paint', 0x0000ff)), box('C', make('Other', 0xff0000)));
    const c = convert(root);
    expect(Object.keys(c.materials)).toEqual(['tm1', 'tm2', 'tm3']);
    expect(byName(c, 'A1').material).toBe(byName(c, 'A2').material);
    expect(new Set([byName(c, 'A1').material, byName(c, 'B').material, byName(c, 'C').material]).size).toBe(3);
  });

  it('a mesh whose material the loader made up takes the neutral Default', () => {
    const fallback = new THREE.MeshStandardMaterial({ name: '__DEFAULT' });
    const root = new THREE.Group();
    root.add(box('Plain', fallback), box('Real', new THREE.MeshStandardMaterial({ name: 'Real' })));
    const c = convert(root, { isFallbackMaterial: (m) => m.name === '__DEFAULT' });
    expect(byName(c, 'Plain').material).toBe('tm_default');
    expect(c.materials.tm_default.role).toBe('DEFAULT');
    expect(c.materials[byName(c, 'Real').material!].name).toBe('Real');
  });

  it('converts colour, metal, roughness, opacity, transmission and coat', () => {
    const m = new THREE.MeshPhysicalMaterial({ color: 0x336699, metalness: 0.8, roughness: 0.3, opacity: 0.5, transparent: true, transmission: 0.4, clearcoat: 0.6 });
    const p = surfaceParams(m);
    close([...(p.baseColor ?? [])], [m.color.r, m.color.g, m.color.b, 1], 6);
    expect([p.metallic, p.roughness, p.opacity, p.transmission, p.coat]).toEqual([0.8, 0.3, 0.5, 0.4, 0.6]);
    // A plain standard material has none of the extras.
    const plain = surfaceParams(new THREE.MeshStandardMaterial());
    expect('opacity' in plain || 'transmission' in plain || 'coat' in plain).toBe(false);
    // A material without a roughness (Basic, Lambert) is half rough and not metal.
    expect(surfaceParams(new THREE.MeshLambertMaterial({ color: 0xffffff }))).toMatchObject({ metallic: 0, roughness: 0.5 });
  });

  it('maps Blinn-Phong shininess to roughness: 30 is 0.5, a black specular is fully rough', () => {
    expect(roughnessFromShininess(30, 0.5)).toBeCloseTo(0.5, 6);
    expect(roughnessFromShininess(50, 0.5)).toBeCloseTo((2 / 52) ** 0.25, 9);
    expect(roughnessFromShininess(1000, 0.5)).toBeGreaterThanOrEqual(0.05);
    expect(roughnessFromShininess(0, 0.5)).toBeLessThanOrEqual(1);
    expect(roughnessFromShininess(100, 0)).toBe(1);
    const phong = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 30, specular: 0x808080 });
    expect(surfaceParams(phong).roughness).toBeGreaterThan(0.4);
    expect(surfaceParams(phong).metallic).toBe(0);
  });

  it('converts colours the loader left in sRGB, and roughness it left at three\'s 1, when asked', () => {
    const m = new THREE.MeshStandardMaterial({ name: 'Rhino' });
    m.color.setRGB(200 / 255, 40 / 255, 30 / 255); // as the 3DM loader does: raw values
    const root = new THREE.Group();
    root.add(box('A', m));
    const plain = convert(root);
    const fixed = convert(root, { srgbColors: true, roughnessWhenDefault: 0.5 });
    const srgb = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    close(colorOf(plain.materials.tm1), [200 / 255, 40 / 255, 30 / 255, 1], 5);
    close(colorOf(fixed.materials.tm1), [srgb(200 / 255), srgb(40 / 255), srgb(30 / 255), 1], 4);
    expect(plain.materials.tm1.params.roughness).toBe(1);
    expect(fixed.materials.tm1.params.roughness).toBe(0.5);
    // A roughness the file did set is left alone.
    const set = new THREE.MeshStandardMaterial({ roughness: 0.2 });
    root.clear();
    root.add(box('B', set));
    expect(convert(root, { roughnessWhenDefault: 0.5 }).materials.tm1.params.roughness).toBe(0.2);
  });
});

describe('payload', () => {
  it('says the size, the layers and the hidden parts, and keeps what the reader passes', () => {
    const root = new THREE.Group();
    root.add(box('A', undefined, 10, 20, 30));
    const hidden = box('B');
    hidden.visible = false;
    root.add(hidden);
    const c = convert(root, { layerOf: (m) => (m.name === 'A' ? 'Layer 1' : undefined) });
    const p = toPayload(c, { units: 'cm', upAxis: 'Y', upAxisDeclared: true });
    expect(p.detected).toEqual({ units: 'cm', upAxis: 'Y', upAxisDeclared: true, size: 30, hasLayers: true, hiddenParts: 1 });
    expect(Object.values(p.layers!)).toEqual(['Layer 1']);
    expect(p.textures).toBeUndefined();
    const none = toPayload(convert(box('Solo')), { units: null, upAxis: 'Z', upAxisDeclared: false });
    expect(none.layers).toBeUndefined();
    expect(none.detected.hasLayers).toBe(false);
  });

  it('collects no textures where there is no document to decode them (Node)', async () => {
    const m = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
    expect(await collectTextures({ materials: {}, sources: new Map([['tm1', m]]) })).toEqual([]);
  });
});
