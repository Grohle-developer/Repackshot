// Texture fixtures (phase M2a), made from code so the repository holds no binary images: PNG files written from
// the specification (IHDR, IDAT through node:zlib, IEND, CRC-32), a textured GLB (the four maps of the M2a
// criterion: colour with alpha, metallic-roughness, normal, emission; a transform; a second UV set; occlusion) and
// an OBJ with its MTL and images. The tests (tests/textures*.test.ts) and tools/textures-check.mjs use them.

import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** A PNG of `width × height` pixels, `channels` 1 (grey), 3 (RGB) or 4 (RGBA), from `pixel(x, y)` → [r, g, b, a] (0..255), rows from the top. */
export function png(width, height, channels, pixel) {
  const colorType = channels === 1 ? 0 : channels === 3 ? 2 : 6;
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  const raw = new Uint8Array(height * (1 + width * channels));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * channels);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const p = pixel(x, y);
      for (let c = 0; c < channels; c++) raw[row + 1 + x * channels + c] = p[c];
    }
  }
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', new Uint8Array(deflateSync(raw))), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** The colour image: four quadrants (red top-left, green top-right, blue bottom-left, white bottom-right), a black arrow pointing up, an alpha hole. */
export function colourImage(size = 64) {
  return png(size, size, 4, (x, y) => {
    const top = y < size / 2;
    const left = x < size / 2;
    let c = top ? (left ? [220, 40, 40] : [40, 200, 60]) : left ? [40, 70, 220] : [235, 235, 235];
    // An arrow up the middle: the image's up must be the part's up.
    const cx = Math.abs(x - size / 2 + 0.5);
    if ((y > size * 0.2 && y < size * 0.8 && cx < size * 0.04) || (y >= size * 0.12 && y < size * 0.35 && cx < (y - size * 0.12) * 0.9)) c = [10, 10, 10];
    // A transparent square in the bottom-right corner: the cut-out.
    const hole = x > size * 0.8 && y > size * 0.8;
    return [...c, hole ? 0 : 255];
  });
}

/** Roughness in G (a gradient across), metal in B (left half metal). */
export function metalRoughImage(size = 32) {
  return png(size, size, 3, (x) => [0, Math.round((255 * x) / (size - 1)), x < size / 2 ? 255 : 0]);
}

/** A tangent-space normal map of ridges along v. */
export function normalImage(size = 32) {
  return png(size, size, 3, (x) => {
    const s = Math.sin((x / size) * Math.PI * 8) * 0.6;
    const n = [s, 0, Math.sqrt(1 - s * s)];
    return [Math.round((n[0] * 0.5 + 0.5) * 255), Math.round((n[1] * 0.5 + 0.5) * 255), Math.round((n[2] * 0.5 + 0.5) * 255)];
  });
}

/** Emission: a bright ring. */
export function emissionImage(size = 32) {
  return png(size, size, 3, (x, y) => {
    const r = Math.hypot(x - size / 2 + 0.5, y - size / 2 + 0.5) / (size / 2);
    return r > 0.55 && r < 0.75 ? [255, 180, 60] : [0, 0, 0];
  });
}

/** A grey occlusion map (no slot: reported). */
export function occlusionImage(size = 8) {
  return png(size, size, 1, () => [200]);
}

/** A label: a cream rounded card with a dark band across its middle and alpha around it. */
export function labelImage(w = 96, h = 64) {
  return png(w, h, 4, (x, y) => {
    const r = Math.min(w, h) * 0.12;
    const dx = Math.max(0, Math.abs(x - w / 2 + 0.5) - (w / 2 - r - 1));
    const dy = Math.max(0, Math.abs(y - h / 2 + 0.5) - (h / 2 - r - 1));
    const inside = Math.hypot(dx, dy) < r;
    const band = y > h * 0.38 && y < h * 0.62 && x > w * 0.1 && x < w * 0.9;
    const c = band ? [150, 30, 30] : [240, 232, 214];
    return [...c, inside ? 255 : 0];
  });
}

/** A checker for the box projection: `cells` squares a side, with a letter-like mark in the top-left cell. */
export function checkerImage(size = 128, cells = 4) {
  return png(size, size, 3, (x, y) => {
    const cx = Math.floor((x * cells) / size);
    const cy = Math.floor((y * cells) / size);
    const mark = cx === 0 && cy === 0 && x > size * 0.04 && x < size * 0.08;
    if (mark) return [200, 30, 30];
    return (cx + cy) % 2 ? [30, 30, 30] : [230, 230, 230];
  });
}

const pad4 = (n) => (n + 3) & ~3;

/**
 * A GLB with one textured box (24 vertices, positions in metres, normals, UVs in glTF's v-down convention and a
 * second set) and one material with every map, or the options' subset.
 */
export function texturedGlb(opts = {}) {
  const size = opts.size ?? 0.1;
  const h = size / 2;
  // Faces: +X, -X, +Y, -Y, +Z, -Z (glTF Y up), each a quad with uv (0,0) top-left.
  const faces = [
    [[h, -h, h], [h, -h, -h], [h, h, -h], [h, h, h], [1, 0, 0]],
    [[-h, -h, -h], [-h, -h, h], [-h, h, h], [-h, h, -h], [-1, 0, 0]],
    [[-h, h, h], [h, h, h], [h, h, -h], [-h, h, -h], [0, 1, 0]],
    [[-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h], [0, -1, 0]],
    [[-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h], [0, 0, 1]],
    [[h, -h, -h], [-h, -h, -h], [-h, h, -h], [h, h, -h], [0, 0, -1]],
  ];
  const pos = [];
  const nor = [];
  const uv = [];
  const uv1 = [];
  const idx = [];
  faces.forEach((f, i) => {
    const base = i * 4;
    // Corners in order bottom-left, bottom-right, top-right, top-left: glTF uv v runs down.
    const uvs = [[0, 1], [1, 1], [1, 0], [0, 0]];
    for (let k = 0; k < 4; k++) {
      pos.push(...f[k]);
      nor.push(...f[4]);
      uv.push(...uvs[k]);
      uv1.push(uvs[k][0] * 0.5, uvs[k][1] * 0.5);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  const images = [];
  const addImage = (bytes, name) => images.push({ bytes, name }) - 1;
  const colour = addImage(opts.colour ?? colourImage(), 'colour.png');
  const mr = addImage(opts.metalRough ?? metalRoughImage(), 'metal-rough.png');
  const normal = addImage(opts.normal ?? normalImage(), 'normal.png');
  const emission = addImage(opts.emission ?? emissionImage(), 'emission.png');
  const occlusion = addImage(occlusionImage(), 'occlusion.png');

  const streams = [
    { data: new Float32Array(pos), type: 'VEC3', comp: 5126, target: 34962, minmax: true },
    { data: new Float32Array(nor), type: 'VEC3', comp: 5126, target: 34962 },
    { data: new Float32Array(uv), type: 'VEC2', comp: 5126, target: 34962 },
    { data: new Float32Array(uv1), type: 'VEC2', comp: 5126, target: 34962 },
    { data: new Uint16Array(idx), type: 'SCALAR', comp: 5123, target: 34963 },
  ];
  const chunks = [];
  let offset = 0;
  const bufferViews = [];
  const accessors = [];
  for (const s of streams) {
    const bytes = new Uint8Array(s.data.buffer);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target: s.target });
    const per = s.type === 'VEC3' ? 3 : s.type === 'VEC2' ? 2 : 1;
    const a = { bufferView: bufferViews.length - 1, componentType: s.comp, count: s.data.length / per, type: s.type };
    if (s.minmax) {
      a.min = [-h, -h, -h];
      a.max = [h, h, h];
    }
    accessors.push(a);
    chunks.push({ at: offset, bytes });
    offset = pad4(offset + bytes.length);
  }
  const imageDefs = images.map((img) => {
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: img.bytes.length });
    chunks.push({ at: offset, bytes: img.bytes });
    offset = pad4(offset + img.bytes.length);
    return { bufferView: bufferViews.length - 1, mimeType: 'image/png', name: img.name };
  });
  const tex = (i) => ({ index: i });
  const material = {
    name: opts.materialName ?? 'Textured',
    pbrMetallicRoughness: {
      baseColorFactor: [1, 1, 1, 1],
      baseColorTexture: opts.transform ? { index: colour, extensions: { KHR_texture_transform: opts.transform } } : tex(colour),
      metallicFactor: 1,
      roughnessFactor: 0.9,
      metallicRoughnessTexture: tex(mr),
    },
    normalTexture: { index: normal, scale: 0.8 },
    occlusionTexture: { index: occlusion },
    emissiveTexture: tex(emission),
    emissiveFactor: [1, 0.5, 0.25],
    alphaMode: opts.alphaMode ?? 'MASK',
    alphaCutoff: 0.4,
    extensions: { KHR_materials_emissive_strength: { emissiveStrength: 2 } },
  };
  const json = {
    asset: { version: '2.0', generator: 'Repackshot texture fixtures' },
    extensionsUsed: ['KHR_materials_emissive_strength', ...(opts.transform ? ['KHR_texture_transform'] : [])],
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: opts.nodeName ?? 'Box' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2, TEXCOORD_1: 3 }, indices: 4, material: 0 }] }],
    materials: [material],
    textures: images.map((_, i) => ({ source: i, sampler: 0 })),
    samplers: [{ wrapS: 10497, wrapT: 10497 }],
    images: imageDefs,
    accessors,
    bufferViews,
    buffers: [{ byteLength: offset }],
  };
  const bin = new Uint8Array(offset);
  for (const c of chunks) bin.set(c.bytes, c.at);
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = pad4(text.length);
  const total = 12 + 8 + jsonLen + 8 + bin.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLen, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(text, 20);
  out.fill(0x20, 20 + text.length, 20 + jsonLen);
  view.setUint32(20 + jsonLen, bin.length, true);
  view.setUint32(24 + jsonLen, 0x004e4942, true);
  out.set(bin, 28 + jsonLen);
  return { glb: out, images };
}

/** An OBJ quad with UVs and its MTL naming maps with options, and the images it names. */
export function texturedObj() {
  const obj = ['mtllib quad.mtl', 'o Quad', 'v 0 0 0', 'v 10 0 0', 'v 10 10 0', 'v 0 10 0', 'vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0 1', 'vn 0 0 1', 'usemtl Paint', 'f 1/1/1 2/2/1 3/3/1 4/4/1', ''].join('\n');
  const mtl = [
    '# written by the tests',
    'newmtl Paint',
    'Kd 0.5 0.5 0.5',
    'Ks 0.5 0.5 0.5',
    'Ns 200',
    'd 1',
    'map_Kd -s 2 2 1 -o 0.25 0 0 paint colour.png',
    'map_Ns gloss.png',
    'map_d -imfchan r mask.png',
    'map_Bump -bm 0.5 bumps.png',
    'map_Ka ambient.png',
    '',
  ].join('\n');
  const images = {
    'paint colour.png': colourImage(32),
    'gloss.png': png(16, 16, 1, (x) => [x * 16]),
    'mask.png': png(16, 16, 1, (x, y) => [x > 8 && y > 8 ? 0 : 255]),
    'bumps.png': png(16, 16, 1, (x, y) => [((x >> 2) + (y >> 2)) % 2 ? 255 : 0]),
    'ambient.png': png(4, 4, 1, () => [128]),
  };
  return { obj, mtl, images };
}

/** A Collada quad with UVs whose effect reads an image named by the file: the image is a file next to it (`tex.png`). */
export function texturedDae() {
  const dae = `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset><unit name="centimeter" meter="0.01"/><up_axis>Z_UP</up_axis></asset>
  <library_images><image id="tex-image" name="tex"><init_from>tex.png</init_from></image></library_images>
  <library_effects>
    <effect id="paint-effect">
      <profile_COMMON>
        <newparam sid="tex-surface"><surface type="2D"><init_from>tex-image</init_from></surface></newparam>
        <newparam sid="tex-sampler"><sampler2D><source>tex-surface</source></sampler2D></newparam>
        <technique sid="common">
          <phong>
            <diffuse><texture texture="tex-sampler" texcoord="UVMap"/></diffuse>
            <specular><color sid="specular">0.2 0.2 0.2 1</color></specular>
            <shininess><float sid="shininess">20</float></shininess>
          </phong>
        </technique>
      </profile_COMMON>
    </effect>
  </library_effects>
  <library_materials><material id="paint" name="Paint"><instance_effect url="#paint-effect"/></material></library_materials>
  <library_geometries>
    <geometry id="quad-mesh" name="QuadMesh">
      <mesh>
        <source id="quad-pos"><float_array id="quad-pos-array" count="12">0 0 0 10 0 0 10 0 10 0 0 10</float_array>
          <technique_common><accessor source="#quad-pos-array" count="4" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
        <source id="quad-uv"><float_array id="quad-uv-array" count="8">0 0 1 0 1 1 0 1</float_array>
          <technique_common><accessor source="#quad-uv-array" count="4" stride="2"><param name="S" type="float"/><param name="T" type="float"/></accessor></technique_common></source>
        <vertices id="quad-vertices"><input semantic="POSITION" source="#quad-pos"/></vertices>
        <triangles material="paint-slot" count="2">
          <input semantic="VERTEX" source="#quad-vertices" offset="0"/>
          <input semantic="TEXCOORD" source="#quad-uv" offset="1" set="0"/>
          <p>0 0 1 1 2 2 0 0 2 2 3 3</p>
        </triangles>
      </mesh>
    </geometry>
  </library_geometries>
  <library_visual_scenes>
    <visual_scene id="scene" name="Scene">
      <node id="quad" name="Quad" type="NODE">
        <instance_geometry url="#quad-mesh">
          <bind_material><technique_common><instance_material symbol="paint-slot" target="#paint"><bind_vertex_input semantic="UVMap" input_semantic="TEXCOORD" input_set="0"/></instance_material></technique_common></bind_material>
        </instance_geometry>
      </node>
    </visual_scene>
  </library_visual_scenes>
  <scene><instance_visual_scene url="#scene"/></scene>
</COLLADA>
`;
  return { dae, image: colourImage(32) };
}
