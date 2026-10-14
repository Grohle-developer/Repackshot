// Phase M2a: the texture model (core/textures.ts), its maths (the contract the preview's shader and the engine of
// M2b follow), the image headers and the store actions with their undo.

import { describe, expect, it } from 'vitest';
import { fitTextureBudget, withoutImages, type ImportTexture } from '../src/core/import-options';
import { readImageHeader } from '../src/core/image-header';
import { mat4Compose, transformDirection, transformPoint } from '../src/core/math';
import { cloneInstance, instanceFromPreset } from '../src/core/materials';
import { worldMatrix } from '../src/core/scene';
import { checkTextureFile, registerTextureImage, textureImageId } from '../src/core/texture-images';
import {
  boxCoords,
  boxWeights,
  defaultMapping,
  defaultTextures,
  labelCoords,
  labelFrame,
  labelWidthFromDrag,
  newLabel,
  newSlot,
  nextLabelId,
  normalizeTextures,
  placeLabel,
  projectPoint,
  sharedMapping,
  tangentOf,
  texelOf,
  textureImages,
  TEXTURE_MAX_BYTES,
  transformUv,
  wrapCoord,
  type TextureMapping,
} from '../src/core/textures';
import { colourImage, png } from '../tools/texture-fixtures.mjs';
import { exampleStore, keyIds } from './helpers';

const close = (got: readonly number[], want: readonly number[], digits = 6) => want.forEach((w, i) => expect(got[i], `[${i}] of ${JSON.stringify(got)}`).toBeCloseTo(w, digits));
const IMG = { id: 'tex:0000000000000000', name: 'a.png', width: 200, height: 100 };

describe('image headers', () => {
  it('reads the size and the channels of a PNG without decoding it', () => {
    expect(readImageHeader(png(7, 5, 4, () => [1, 2, 3, 4]))).toEqual({ format: 'PNG', width: 7, height: 5, channels: 4 });
    expect(readImageHeader(png(3, 9, 3, () => [1, 2, 3]))).toEqual({ format: 'PNG', width: 3, height: 9, channels: 3 });
    expect(readImageHeader(png(2, 2, 1, () => [9]))).toEqual({ format: 'PNG', width: 2, height: 2, channels: 1 });
  });

  it('counts a tRNS chunk as alpha', () => {
    const grey = png(2, 2, 1, () => [9]);
    // Put a tRNS chunk (length 2, a grey key) right after IHDR (8 + 25 bytes); its CRC is not checked by the header reader.
    const trns = new Uint8Array([0, 0, 0, 2, 0x74, 0x52, 0x4e, 0x53, 0, 9, 0, 0, 0, 0]);
    const withAlpha = new Uint8Array(grey.length + trns.length);
    withAlpha.set(grey.subarray(0, 33));
    withAlpha.set(trns, 33);
    withAlpha.set(grey.subarray(33), 33 + trns.length);
    expect(readImageHeader(withAlpha)?.channels).toBe(4);
  });

  it('reads the frame header of a JPEG (grey and colour), past the markers before it', () => {
    const jpeg = (components: number) =>
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0x4a, 0x46, 0xff, 0xc0, 0, 11, 8, 0x01, 0x2c, 0x00, 0xc8, components, 1, 0x11, 0, 0xff, 0xd9]);
    expect(readImageHeader(jpeg(3))).toEqual({ format: 'JPEG', width: 200, height: 300, channels: 3 });
    expect(readImageHeader(jpeg(1))?.channels).toBe(1);
  });

  it('is null for anything else, and the check says why a file is not a texture', () => {
    expect(readImageHeader(new TextEncoder().encode('GIF89a'))).toBeNull();
    expect(checkTextureFile(new TextEncoder().encode('not an image'))).toEqual({ reason: 'format' });
    expect(checkTextureFile(new Uint8Array(TEXTURE_MAX_BYTES + 1))).toEqual({ reason: 'tooLarge' });
    expect(checkTextureFile(png(8193, 1, 1, () => [0]))).toEqual({ reason: 'tooManyPixels' });
    expect('header' in checkTextureFile(colourImage(8))).toBe(true);
  });

  it('names a texture by its content: the same bytes, the same id', () => {
    const a = colourImage(8);
    expect(textureImageId(a)).toBe(textureImageId(new Uint8Array(a)));
    expect(textureImageId(a)).not.toBe(textureImageId(colourImage(16)));
    const ref = registerTextureImage('a.png', a);
    expect(ref).toEqual({ id: textureImageId(a), name: 'a.png', width: 8, height: 8 });
  });
});

describe('the shape of a material’s textures', () => {
  it('starts empty, with a UV mapping one part wide and no labels', () => {
    const t = defaultTextures();
    expect([t.color, t.roughness, t.metal, t.normal, t.alpha, t.emission]).toEqual([null, null, null, null, null, null]);
    expect(t.mapping).toEqual({ projection: 'UV', axis: 'Z', uvSet: 0, sizeMm: 100, rotationDeg: 0, offset: [0, 0], repeat: [1, 1], wrap: 'REPEAT' });
    expect(t.labels).toEqual([]);
  });

  it('a new slot reads what glTF packs there: roughness in G, metal in B, alpha in A', () => {
    expect(newSlot('roughness', IMG).channel).toBe('G');
    expect(newSlot('metal', IMG).channel).toBe('B');
    expect(newSlot('alpha', IMG).channel).toBe('A');
    expect(newSlot('color', IMG)).toMatchObject({ mapping: null, strength: 1, invert: false, cutout: false, cutoff: 0.5, tint: [1, 1, 1] });
  });

  it('reads the flat shape of the files written before M2a: images never filled, one mapping', () => {
    const old = { color: null, roughness: null, metal: null, normal: null, alpha: null, projection: 'CYLINDRICAL', scale: 3, rotationDeg: 45, offset: [0.25, 0] };
    const t = normalizeTextures(old);
    expect(t.mapping).toMatchObject({ projection: 'CYLINDRICAL', repeat: [3, 3], rotationDeg: 45, offset: [0.25, 0] });
    expect(t.color).toBeNull();
    // A slot of the old shape held a string: no image is no slot.
    expect(normalizeTextures({ ...old, color: 'tex1' }).color).toBeNull();
    expect(normalizeTextures(undefined)).toEqual(defaultTextures());
    expect(normalizeTextures({ mapping: { projection: 'NOPE', sizeMm: -5 } }).mapping).toMatchObject({ projection: 'UV', sizeMm: 0.01 });
  });

  it('keeps what it reads bit for bit, so a project saved again has the same bytes', () => {
    const t = defaultTextures();
    t.color = newSlot('color', IMG);
    const at = placeLabel(mat4Compose([1, 2, 3], [10, 20, 30], [1, 1, 1]), [5, 6, 7], [0.36, 0.48, 0.8]);
    t.labels.push(newLabel('lb1', IMG, at, 12.5));
    const again = normalizeTextures(JSON.parse(JSON.stringify(t)));
    expect(JSON.stringify(again)).toBe(JSON.stringify(t));
  });

  it('a copy of an instance shares nothing of its textures', () => {
    const m = instanceFromPreset('m1', 'WHITE_STUDIO', 100)!;
    m.textures.color = newSlot('color', IMG);
    m.textures.labels.push(newLabel('lb1', IMG, { origin: [0, 0, 0], normal: [0, -1, 0], uAxis: [1, 0, 0] }, 10));
    const c = cloneInstance(m, 'm2');
    c.textures.color!.tint[0] = 0;
    c.textures.labels[0].origin[0] = 9;
    c.textures.mapping.offset[0] = 3;
    expect(m.textures.color!.tint[0]).toBe(1);
    expect(m.textures.labels[0].origin[0]).toBe(0);
    expect(m.textures.mapping.offset[0]).toBe(0);
  });

  it('takes the mapping most slots share as the material’s', () => {
    const a = defaultMapping();
    const b = { ...defaultMapping(), repeat: [2, 2] as [number, number] };
    expect(sharedMapping([b, a, a])).toEqual(a);
    expect(sharedMapping([b, a])).toEqual(b);
    expect(sharedMapping([])).toBeNull();
  });
});

describe('projections (the contract with the shader and the engine)', () => {
  const m = (patch: Partial<TextureMapping>): TextureMapping => ({ ...defaultMapping(), ...patch });

  it('turns counter-clockwise after the repeat, then offsets', () => {
    close(transformUv(m({ rotationDeg: 90 }), 1, 0), [0, 1]);
    close(transformUv(m({ repeat: [2, 3] }), 1, 1), [2, 3]);
    close(transformUv(m({ repeat: [2, 1], rotationDeg: 90, offset: [0.5, 0] }), 1, 0), [0.5, 2]);
  });

  it('UV reads the mesh coordinates with the transform; v up, row from the top', () => {
    const [p] = projectPoint(m({ offset: [0.1, 0.2] }), [0, 0, 0], [0, 0, 1], 1, [0.25, 0.5]);
    close([p.u, p.v], [0.35, 0.7]);
    // (0, 0) is the bottom-left of the image: its last row.
    expect(texelOf(0, 0, 4, 4)).toEqual([0, 3]);
    expect(texelOf(0.99, 0.99, 4, 4)).toEqual([3, 0]);
  });

  it('BOX: every face of a cube shows the image once, square, upright and never mirrored', () => {
    // A cube of side 10 mm about the part's origin, sizeMm 10: each face is one repeat. Seen from outside each face
    // (up +Z on the sides, +Y on the top and underneath), its top-left corner is (0, 1) and its bottom-right (1, 0).
    const mapping = m({ projection: 'BOX', sizeMm: 10 });
    const faces: { n: [number, number, number]; r: [number, number, number]; u: [number, number, number] }[] = [
      { n: [0, -1, 0], r: [1, 0, 0], u: [0, 0, 1] }, // front
      { n: [0, 1, 0], r: [-1, 0, 0], u: [0, 0, 1] }, // back
      { n: [1, 0, 0], r: [0, 1, 0], u: [0, 0, 1] }, // +X
      { n: [-1, 0, 0], r: [0, -1, 0], u: [0, 0, 1] }, // -X
      { n: [0, 0, 1], r: [1, 0, 0], u: [0, 1, 0] }, // top
      { n: [0, 0, -1], r: [-1, 0, 0], u: [0, 1, 0] }, // underneath
    ];
    const at = (f: (typeof faces)[number], a: number, b: number) => [0, 1, 2].map((i) => 5 * f.n[i] + a * f.r[i] + b * f.u[i]);
    for (const f of faces) {
      const tl = projectPoint(mapping, at(f, -5, 5), f.n, 1);
      const br = projectPoint(mapping, at(f, 5, -5), f.n, 1);
      expect(tl, JSON.stringify(f.n)).toHaveLength(1);
      expect(tl[0].weight).toBe(1);
      close([tl[0].u, tl[0].v], [0, 1]);
      close([br[0].u, br[0].v], [1, 0]);
      // Square: 1 mm to the right is as much u as 1 mm up is v (no stretch), both growing (no mirror).
      const c = projectPoint(mapping, at(f, 0, 0), f.n, 1)[0];
      const right = projectPoint(mapping, at(f, 1, 0), f.n, 1)[0];
      const up = projectPoint(mapping, at(f, 0, 1), f.n, 1)[0];
      close([right.u - c.u, right.v - c.v, up.u - c.u, up.v - c.v], [0.1, 0, 0, 0.1]);
    }
  });

  it('BOX blends the axes by |n|⁴: a face square to an axis takes it alone, a 45° bevel half and half', () => {
    expect(boxWeights([0, 0, 1])).toEqual([0, 0, 1]);
    close(boxWeights([Math.SQRT1_2, 0, Math.SQRT1_2]), [0.5, 0, 0.5]);
    const w = boxWeights([0.6, 0, 0.8]);
    close(w, [0.6 ** 4 / (0.6 ** 4 + 0.8 ** 4), 0, 0.8 ** 4 / (0.6 ** 4 + 0.8 ** 4)]);
    // The side the normal points to decides the mirror of each axis.
    expect(boxCoords('Y', [1, -5, 2], [0, -1, 0])).toEqual([1, 2]);
    expect(boxCoords('Y', [1, 5, 2], [0, 1, 0])).toEqual([-1, 2]);
  });

  it('PLANAR looks along its axis, the image as tall as its proportions say', () => {
    // A 200 × 100 image 20 mm wide is 10 mm tall: the point 5 mm up is its top edge.
    const [p] = projectPoint(m({ projection: 'PLANAR', axis: 'Y', sizeMm: 20 }), [10, 0, 5], [0, -1, 0], 2);
    close([p.u, p.v], [1, 1]);
    const [q] = projectPoint(m({ projection: 'PLANAR', axis: 'Z', sizeMm: 20 }), [0, -5, 7], [0, 0, 1], 2);
    close([q.u, q.v], [0.5, 0]);
  });

  it('CYLINDRICAL wraps once around its axis, the front (−Y for Z) at the image centre, left to right', () => {
    const mapping = m({ projection: 'CYLINDRICAL', axis: 'Z', sizeMm: 100 });
    const at = (x: number, y: number, z = 0) => projectPoint(mapping, [x, y, z], [x, y, 0], 1)[0];
    close([at(0, -10).u], [0.5]);
    close([at(10, 0).u], [0.75]);
    close([at(-10, 0).u], [0.25]);
    expect(Math.abs(at(0.001, 10).u - at(-0.001, 10).u)).toBeCloseTo(1, 3); // the seam is at the back
    // sizeMm is the circumference the image is drawn for: the height follows (a square image, 100 mm tall).
    close([at(0, -10, 50).v], [1]);
  });

  it('SPHERICAL: the poles are the bottom and the top of the image', () => {
    const mapping = m({ projection: 'SPHERICAL', axis: 'Z' });
    close([projectPoint(mapping, [0, 0, 7], [0, 0, 1], 1)[0].v], [1]);
    close([projectPoint(mapping, [0, 0, -7], [0, 0, -1], 1)[0].v], [0]);
    close([projectPoint(mapping, [0, -3, 0], [0, -1, 0], 1)[0].v, projectPoint(mapping, [0, -3, 0], [0, -1, 0], 1)[0].u], [0.5, 0.5]);
  });

  it('wraps past the edge: repeat, clamp, mirror', () => {
    expect(wrapCoord(1.25, 'REPEAT')).toBeCloseTo(0.25);
    expect(wrapCoord(-0.25, 'REPEAT')).toBeCloseTo(0.75);
    expect(wrapCoord(1.25, 'CLAMP')).toBe(1);
    expect(wrapCoord(1.25, 'MIRROR')).toBeCloseTo(0.75);
    expect(wrapCoord(-0.25, 'MIRROR')).toBeCloseTo(0.25);
  });
});

describe('labels: where a press puts them and what they cover', () => {
  it('a press on the front of a part lays it upright: right +X, up +Z', () => {
    const at = placeLabel(mat4Compose([0, 0, 0], [0, 0, 0], [1, 1, 1]), [3, -10, 4], [0, -1, 0]);
    expect(at.origin).toEqual([3, -10, 4]);
    close(at.normal, [0, -1, 0]);
    close(at.uAxis, [1, 0, 0]);
    close(tangentOf([0, 0, 1]), [1, 0, 0]); // on top, upright towards +Y
  });

  it('takes the point and the normal into the part’s own space through its world matrix', () => {
    const world = mat4Compose([100, 20, 5], [0, 0, 90], [2, 2, 2]);
    // The part-space point (1, -3, 2) with the part-space normal (0, -1, 0), seen in the model.
    const p = transformPoint(world, [1, -3, 2]);
    const n = transformDirection(world, [0, -1, 0]).map((x) => x / 2);
    const at = placeLabel(world, p, n, [0, 0, 1]);
    close(at.origin, [1, -3, 2]);
    close(at.normal, [0, -1, 0]);
    close(at.uAxis, [1, 0, 0]);
  });

  it('covers its rectangle in front of its plane, as tall as its image says, and nothing behind or facing away', () => {
    const l = { ...newLabel('lb1', IMG, { origin: [0, -10, 0], normal: [0, -1, 0], uAxis: [1, 0, 0] }, 20), depthMm: 0 };
    const f = labelFrame(l, 2);
    expect([f.width, f.height, f.depth]).toEqual([20, 10, 10]);
    close(labelCoords(f, [0, -10, 0], [0, -1, 0])!, [0.5, 0.5]);
    close(labelCoords(f, [10, -10, 5], [0, -1, 0])!, [1, 1]);
    close(labelCoords(f, [-10, -10, -5], [0, -1, 0])!, [0, 0]);
    expect(labelCoords(f, [11, -10, 0], [0, -1, 0])).toBeNull();
    expect(labelCoords(f, [0, -10, 6], [0, -1, 0])).toBeNull();
    expect(labelCoords(f, [0, 1, 0], [0, -1, 0])).toBeNull(); // 11 mm behind: past its reach
    expect(labelCoords(f, [0, -10, 0], [0, 1, 0])).toBeNull(); // the back of a sheet
  });

  it('turns about its normal counter-clockwise seen from outside', () => {
    const l = { ...newLabel('lb1', IMG, { origin: [0, 0, 0], normal: [0, -1, 0], uAxis: [1, 0, 0] }, 20), rotationDeg: 90 };
    const f = labelFrame(l, 1);
    close(f.u, [0, 0, 1]);
    close(f.v, [-1, 0, 0]);
  });

  it('a drag sets its width from the farther of the two directions', () => {
    const at = { origin: [0, 0, 0] as [number, number, number], normal: [0, -1, 0] as [number, number, number], uAxis: [1, 0, 0] as [number, number, number], rotationDeg: 0 };
    expect(labelWidthFromDrag(at, 2, [6, 0, 1], 0.5)).toBeCloseTo(12);
    expect(labelWidthFromDrag(at, 2, [1, 0, 5], 0.5)).toBeCloseTo(20);
    expect(labelWidthFromDrag(at, 2, [0, 0, 0], 0.5)).toBe(0.5);
  });
});

describe('the store: slots, mappings and labels are actions, undoable', () => {
  it('the first image of a material makes a repeat one part wide and the material the user’s own', () => {
    const { store, ids } = exampleStore();
    const s = store.get();
    const mat = s.scene.nodes[ids.body].material!;
    expect(s.materials[mat].preset).not.toBeNull();
    store.dispatch({ type: 'texture/setSlot', material: mat, slot: 'color', value: newSlot('color', IMG), label: 'load' });
    const m = store.get().materials[mat];
    expect(m.textures.color?.image).toEqual(IMG);
    expect(m.textures.mapping.sizeMm).toBe(s.scene.partSizeMm);
    expect(m.preset).toBeNull();
    expect(m.edited).toBe(true);
    expect(textureImages(store.get()).get(IMG.id)).toEqual(IMG);
    store.undo();
    expect(store.get().materials[mat]).toEqual(s.materials[mat]);
  });

  it('a drag of a mapping field is one undo entry; a change to nothing is none', () => {
    const { store, ids } = exampleStore();
    const mat = store.get().scene.nodes[ids.body].material!;
    store.dispatch({ type: 'texture/setSlot', material: mat, slot: 'color', value: newSlot('color', IMG), label: 'load' });
    const loaded = store.get();
    for (const r of [1, 2, 3, 4]) store.dispatch({ type: 'texture/setMapping', material: mat, patch: { rotationDeg: r * 10 }, gesture: 'g1', label: 'turn' });
    expect(store.get().materials[mat].textures.mapping.rotationDeg).toBe(40);
    const before = store.history().undo.length;
    store.dispatch({ type: 'texture/setMapping', material: mat, patch: { rotationDeg: 40 }, label: 'same' });
    expect(store.history().undo.length).toBe(before);
    store.undo();
    expect(store.get().materials[mat].textures).toEqual(loaded.materials[mat].textures);
  });

  it('a slot gets its own mapping from the shared one, and gives it back', () => {
    const { store, ids } = exampleStore();
    const mat = store.get().scene.nodes[ids.body].material!;
    store.dispatch({ type: 'texture/setSlot', material: mat, slot: 'normal', value: newSlot('normal', IMG), label: 'load' });
    store.dispatch({ type: 'texture/setMapping', material: mat, slot: 'normal', patch: { projection: 'BOX' }, label: 'own' });
    const t = store.get().materials[mat].textures;
    expect(t.normal?.mapping?.projection).toBe('BOX');
    expect(t.mapping.projection).toBe('UV');
    store.dispatch({ type: 'texture/shareMapping', material: mat, slot: 'normal', label: 'share' });
    expect(store.get().materials[mat].textures.normal?.mapping).toBeNull();
  });

  it('labels: added in order, edited, moved to the front, removed; each one undo entry', () => {
    const { store } = exampleStore();
    const s = store.get();
    const ids = keyIds(s);
    const mat = s.scene.nodes[ids.body].material!;
    const world = worldMatrix(s, ids.body);
    const at = placeLabel(world, transformPoint(world, [0, -31, 40]), [0, -1, 0]);
    const add = (i: number) => {
      const id = nextLabelId(store.get().materials[mat].textures);
      store.dispatch({ type: 'texture/addLabel', material: mat, value: newLabel(id, { ...IMG, name: `l${i}.png` }, at, 10 + i), label: `add ${i}` });
      return id;
    };
    const a = add(1);
    const b = add(2);
    const c = add(3);
    expect([a, b, c]).toEqual(['lb1', 'lb2', 'lb3']);
    const order = () => store.get().materials[mat].textures.labels.map((l) => l.id);
    expect(order()).toEqual(['lb1', 'lb2', 'lb3']);
    store.dispatch({ type: 'texture/moveLabel', material: mat, labelId: 'lb1', index: 2, label: 'front' });
    expect(order()).toEqual(['lb2', 'lb3', 'lb1']);
    for (const w of [11, 12, 13]) store.dispatch({ type: 'texture/setLabel', material: mat, labelId: 'lb2', patch: { widthMm: w }, gesture: 'drag', label: 'width' });
    expect(store.get().materials[mat].textures.labels[0].widthMm).toBe(13);
    store.dispatch({ type: 'texture/removeLabel', material: mat, labelId: 'lb3', label: 'remove' });
    expect(order()).toEqual(['lb2', 'lb1']);
    store.undo();
    expect(order()).toEqual(['lb2', 'lb3', 'lb1']);
    store.undo();
    expect(store.get().materials[mat].textures.labels[0].widthMm).toBe(12);
    store.undo();
    expect(order()).toEqual(['lb1', 'lb2', 'lb3']);
    // A label with an id already there, or a move to where it is, changes nothing.
    const now = store.get();
    store.dispatch({ type: 'texture/addLabel', material: mat, value: newLabel('lb1', IMG, at, 5), label: 'dup' });
    store.dispatch({ type: 'texture/moveLabel', material: mat, labelId: 'lb1', index: 0, label: 'same' });
    expect(store.get()).toBe(now);
  });
});

describe('the budget of an import', () => {
  const tex = (id: string, size: number, extra: Partial<ImportTexture> = {}): ImportTexture => ({ id, name: `${id}.png`, bytes: new Uint8Array(size), width: 1, height: 1, materials: ['tm1'], dropped: null, ...extra });

  it('keeps new images while they fit, counts what the project holds, and never counts an image twice', () => {
    const out = fitTextureBudget([tex('a', 40), tex('b', 30), tex('a', 40), tex('c', 10)], new Map([['old', 50]]), 100);
    expect(out.map((t) => t.dropped)).toEqual([null, 'budget', null, null]);
    // One the project has already costs nothing.
    expect(fitTextureBudget([tex('old', 90)], new Map([['old', 90]]), 100)[0].dropped).toBeNull();
  });

  it('the materials lose the slots and labels of a dropped image, and only those', () => {
    const m = instanceFromPreset('tm1', 'WHITE_STUDIO', 100)!;
    m.textures.color = newSlot('color', { ...IMG, id: 'a' });
    m.textures.normal = newSlot('normal', { ...IMG, id: 'b' });
    m.textures.labels = [newLabel('lb1', { ...IMG, id: 'b' }, { origin: [0, 0, 0], normal: [0, -1, 0], uAxis: [1, 0, 0] }, 10)];
    const kept = { tm1: m };
    expect(withoutImages(kept, new Set())).toBe(kept);
    const out = withoutImages(kept, new Set(['b']));
    expect(out.tm1.textures.color?.image.id).toBe('a');
    expect(out.tm1.textures.normal).toBeNull();
    expect(out.tm1.textures.labels).toEqual([]);
  });
});
