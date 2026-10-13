// WebAssembly parity check: renders an RSB scene with the real `rt_wasm.wasm` (the module the
// browser loads) through its C ABI and prints the hash of the resolved film, which must equal the
// one native `cargo test` pins (`PINNED_EXAMPLE_4SPP` in crates/rt-core/src/render.rs).
//
//   cargo build -p rt-wasm --target wasm32-unknown-unknown --release
//   cargo run --release -p rt-cli -- --write-example /tmp/example.rsb
//   node tools/wasm-parity.mjs target/wasm32-unknown-unknown/release/rt_wasm.wasm \
//        /tmp/example.rsb [--samples 4] [--expect 0x12345678]
//
// The render mirrors the native test exactly: 32-pixel tiles row by row, samples 0..n of each
// tile from `rt_render_tile`, accumulated per pixel in sample order in f32 (Math.fround), then
// divided by n in f32, then FNV-1a over the little-endian bytes of every float.
import { readFile } from 'node:fs/promises';
import process from 'node:process';

const args = process.argv.slice(2);
const positional = [];
let samples = 4;
let expect = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--samples') samples = Number(args[++i]);
  else if (args[i] === '--expect') expect = Number.parseInt(args[++i], 16) >>> 0;
  else positional.push(args[i]);
}
const [wasmPath, rsbPath] = positional;
if (!wasmPath || !rsbPath || !(samples > 0)) {
  console.error('usage: node wasm-parity.mjs <rt_wasm.wasm> <scene.rsb> [--samples N] [--expect HEX]');
  process.exit(2);
}

const { instance } = await WebAssembly.instantiate(await readFile(wasmPath), {});
const rt = instance.exports;
const rsb = new Uint8Array(await readFile(rsbPath));

// Image size from the RNDR section (u32 width, u32 height at the start of its payload).
const view = new DataView(rsb.buffer, rsb.byteOffset, rsb.byteLength);
let width = 0;
let height = 0;
for (let pos = 8 + view.getUint32(4, true); pos + 8 <= rsb.length; ) {
  const tag = String.fromCharCode(...rsb.subarray(pos, pos + 4));
  const len = view.getUint32(pos + 4, true);
  if (tag === 'RNDR') {
    width = view.getUint32(pos + 8, true);
    height = view.getUint32(pos + 12, true);
  }
  pos += 8 + len;
}
if (!width || !height) {
  console.error('wasm-parity: the scene has no RNDR section');
  process.exit(2);
}

const scenePtr = rt.rt_alloc(rsb.length);
new Uint8Array(rt.memory.buffer, scenePtr, rsb.length).set(rsb);
const handle = rt.rt_scene_load(scenePtr, rsb.length);
rt.rt_free(scenePtr, rsb.length);
if (handle === 0) {
  const len = rt.rt_scene_error_len();
  const ptr = rt.rt_alloc(len);
  rt.rt_scene_error_copy(ptr);
  console.error('wasm-parity: load failed:', new TextDecoder().decode(new Uint8Array(rt.memory.buffer, ptr, len)));
  process.exit(1);
}

const TILE = 32;
const acc = new Float32Array(width * height * 3);
const out = rt.rt_alloc(TILE * TILE * 3 * 4);
const start = performance.now();
for (let ty = 0; ty < height; ty += TILE) {
  for (let tx = 0; tx < width; tx += TILE) {
    const w = Math.min(TILE, width - tx);
    const h = Math.min(TILE, height - ty);
    for (let s = 0; s < samples; s++) {
      const status = rt.rt_render_tile(handle, tx, ty, w, h, s, out);
      if (status !== 0) {
        console.error(`wasm-parity: rt_render_tile returned ${status}`);
        process.exit(1);
      }
      // Re-create the view each time: memory may have grown (and detached the old buffer).
      const tile = new Float32Array(rt.memory.buffer, out, w * h * 3);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          for (let c = 0; c < 3; c++) {
            const i = ((ty + y) * width + tx + x) * 3 + c;
            acc[i] = Math.fround(acc[i] + tile[(y * w + x) * 3 + c]);
          }
        }
      }
    }
  }
}
const seconds = (performance.now() - start) / 1000;
const inv = Math.fround(1 / samples);
const resolved = new Float32Array(acc.length);
for (let i = 0; i < acc.length; i++) resolved[i] = Math.fround(acc[i] * inv);

// FNV-1a over little-endian float bytes (DataView pins the byte order on any host).
const bytes = new DataView(resolved.buffer);
let hash = 0x811c9dc5;
for (let i = 0; i < resolved.length * 4; i += 4) {
  const word = bytes.getUint32(i, true);
  for (let b = 0; b < 4; b++) {
    hash = Math.imul(hash ^ ((word >>> (8 * b)) & 0xff), 0x01000193) >>> 0;
  }
}
const hex = `0x${hash.toString(16).padStart(8, '0')}`;
const version = rt.rt_version();
console.log(
  `rt_wasm ${version >> 16}.${(version >> 8) & 0xff}.${version & 0xff}: ${width}x${height}, ${samples} spp in ${seconds.toFixed(2)} s, hash ${hex}`,
);
if (expect !== null && hash !== expect) {
  console.error(`wasm-parity: hash ${hex} differs from the native one 0x${expect.toString(16).padStart(8, '0')}`);
  process.exit(1);
}
