// WebAssembly parity check: renders an RSB scene with the real `rt_wasm.wasm` (the module the
// browser loads) through its C ABI and prints the hash of the resolved film, which must equal the
// one native `cargo test` pins (`PINNED_EXAMPLE_4SPP` in crates/rt-core/src/render.rs).
//
//   cargo build -p rt-wasm --target wasm32-unknown-unknown --release
//   cargo run --release -p rt-cli -- --write-example /tmp/example.rsb
//   node tools/wasm-parity.mjs target/wasm32-unknown-unknown/release/rt_wasm.wasm \
//        /tmp/example.rsb [--samples 4] [--expect 0x12345678] \
//        [--passes] [--expect-passes 0x...,0x...,0x...,0x...,0x...,0x...]
//        [--denoise] [--expect-denoised 0x12345678]
//
// The render mirrors the native test exactly: 32-pixel tiles row by row, samples 0..n of each
// tile from `rt_render_tile`, accumulated per pixel in sample order in f32 (Math.fround), then
// divided by n in f32, then FNV-1a over the little-endian bytes of every float.
//
// `--passes` (X2) also renders every exact pass, interleaved with the image as a host does it:
// per tile `rt_render_tile_passes` once, then after every sample `rt_render_tile_albedo`, the
// albedo summed like the image. The image's hash must not change, and each plane's FNV-1a (in the
// order of PASS_KEYS) must equal `--expect-passes` (`PINNED_PASS_*` of
// crates/rt-core/src/render/passes_tests.rs).
//
// A scene with caustic photons (E5b-1, `RNDR.caustic_photons`, `rt --write-e5b-example`) renders
// them inside the module: each worker traces the photon map of a sample itself, and the image must
// still have the native hash (`PINNED_E5B_CAUSTICS_4SPP`).
//
// A scene with a pixel filter and edge samples (E11, `rt --write-e11-example`) renders them inside the
// module too: it finds each tile's edges from its centre rays, and the image must have the native hash
// (`PINNED_E11_EDGES_4SPP`).
//
// `--denoise` (E5b-1) also denoises the image as the page's pool does: RGBA tiles
// (`rt_render_tile_rgba`), the squared luminance of every sample summed in f32 next to them (the
// page's rule, src/render/tiles.ts), the guide passes, then `rt_denoise` over three bands of rows,
// each with its halo; the hash of the denoised means must equal `--expect-denoised`
// (`PINNED_DENOISED_EXAMPLE_4SPP` of crates/rt-post/src/denoise/tests.rs).
import { readFile } from 'node:fs/promises';
import process from 'node:process';

const args = process.argv.slice(2);
const positional = [];
let samples = 4;
let expect = null;
let passes = false;
let expectPasses = null;
let denoise = false;
let expectDenoised = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--samples') samples = Number(args[++i]);
  else if (args[i] === '--expect') expect = Number.parseInt(args[++i], 16) >>> 0;
  else if (args[i] === '--passes') passes = true;
  else if (args[i] === '--expect-passes') {
    passes = true;
    expectPasses = args[++i].split(',').map((h) => Number.parseInt(h, 16) >>> 0);
  } else if (args[i] === '--denoise') denoise = true;
  else if (args[i] === '--expect-denoised') {
    denoise = true;
    expectDenoised = Number.parseInt(args[++i], 16) >>> 0;
  } else positional.push(args[i]);
}
// The denoiser is guided by the passes.
if (denoise) passes = true;
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
// The passes (PASS_KEYS order): albedo sums, then the exact planes of every pixel.
const KEYS = ['albedo', 'normal', 'depth', 'partId', 'materialId', 'coc'];
const CHANNELS = [3, 3, 1, 1, 1, 1];
const EXACT = 0b111110;
if (passes && (typeof rt.rt_render_tile_passes !== 'function' || typeof rt.rt_render_tile_albedo !== 'function')) {
  console.error('wasm-parity: this rt_wasm.wasm has no passes (rt_render_tile_passes)');
  process.exit(1);
}
const albedoSum = passes ? new Float32Array(width * height * 3) : null;
// With --denoise: coverage and the squared luminance of every sample, summed like the radiance.
const alphaSum = denoise ? new Float32Array(width * height) : null;
const lum2 = denoise ? new Float32Array(width * height) : null;
const f = Math.fround;
const [LR, LG, LB] = [f(0.2126), f(0.7152), f(0.0722)];
const rgbaOut = denoise ? rt.rt_alloc(TILE * TILE * 4 * 4) : 0;
const planes = passes ? KEYS.map((_, k) => new Uint32Array(width * height * CHANNELS[k])) : null;
const exactOut = passes ? rt.rt_alloc(TILE * TILE * 7 * 4) : 0;
const albedoOut = passes ? rt.rt_alloc(TILE * TILE * 3 * 4) : 0;
const start = performance.now();
for (let ty = 0; ty < height; ty += TILE) {
  for (let tx = 0; tx < width; tx += TILE) {
    const w = Math.min(TILE, width - tx);
    const h = Math.min(TILE, height - ty);
    if (passes) {
      const status = rt.rt_render_tile_passes(handle, tx, ty, w, h, EXACT, exactOut);
      if (status !== 0) {
        console.error(`wasm-parity: rt_render_tile_passes returned ${status}`);
        process.exit(1);
      }
      const words = new Uint32Array(rt.memory.buffer, exactOut, w * h * 7);
      let o = 0;
      for (let k = 1; k < KEYS.length; k++) {
        const c = CHANNELS[k];
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w * c; x++) planes[k][((ty + y) * width + tx) * c + x] = words[o + y * w * c + x];
        }
        o += w * h * c;
      }
    }
    for (let s = 0; s < samples; s++) {
      if (denoise) {
        const status = rt.rt_render_tile_rgba(handle, tx, ty, w, h, s, rgbaOut);
        if (status !== 0) {
          console.error(`wasm-parity: rt_render_tile_rgba returned ${status}`);
          process.exit(1);
        }
        const tile4 = new Float32Array(rt.memory.buffer, rgbaOut, w * h * 4);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const p = (ty + y) * width + tx + x;
            const q = (y * w + x) * 4;
            alphaSum[p] = f(alphaSum[p] + tile4[q + 3]);
            const l = f(f(f(LR * tile4[q]) + f(LG * tile4[q + 1])) + f(LB * tile4[q + 2]));
            lum2[p] = f(lum2[p] + f(l * l));
          }
        }
      }
      const status = rt.rt_render_tile(handle, tx, ty, w, h, s, out);
      if (status !== 0) {
        console.error(`wasm-parity: rt_render_tile returned ${status}`);
        process.exit(1);
      }
      if (passes) {
        const a = rt.rt_render_tile_albedo(handle, tx, ty, w, h, s, albedoOut);
        if (a !== 0) {
          console.error(`wasm-parity: rt_render_tile_albedo returned ${a}`);
          process.exit(1);
        }
        const tile = new Float32Array(rt.memory.buffer, albedoOut, w * h * 3);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w * 3; x++) {
            const i = ((ty + y) * width + tx) * 3 + x;
            albedoSum[i] = Math.fround(albedoSum[i] + tile[y * w * 3 + x]);
          }
        }
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

// FNV-1a over little-endian 4-byte words (DataView pins the byte order on any host).
function fnv1a(buffer) {
  const bytes = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let h = 0x811c9dc5;
  for (let i = 0; i < buffer.byteLength; i += 4) {
    const word = bytes.getUint32(i, true);
    for (let b = 0; b < 4; b++) h = Math.imul(h ^ ((word >>> (8 * b)) & 0xff), 0x01000193) >>> 0;
  }
  return h;
}
const hex32 = (h) => `0x${h.toString(16).padStart(8, '0')}`;
const hash = fnv1a(resolved);
const hex = hex32(hash);
const version = rt.rt_version();
console.log(
  `rt_wasm ${version >> 16}.${(version >> 8) & 0xff}.${version & 0xff}: ${width}x${height}, ${samples} spp in ${seconds.toFixed(2)} s, hash ${hex}`,
);
if (expect !== null && hash !== expect) {
  console.error(`wasm-parity: hash ${hex} differs from the native one 0x${expect.toString(16).padStart(8, '0')}`);
  process.exit(1);
}
if (passes) {
  // The albedo divided like the image: the sum times the f32 reciprocal of the samples.
  const albedo = new Float32Array(albedoSum.length);
  for (let i = 0; i < albedo.length; i++) albedo[i] = Math.fround(albedoSum[i] * inv);
  planes[0] = new Uint32Array(albedo.buffer);
  const got = planes.map(fnv1a);
  console.log(`passes: ${KEYS.map((k, i) => `${k} ${hex32(got[i])}`).join(', ')}`);
  if (expectPasses) {
    if (expectPasses.length !== KEYS.length) {
      console.error(`wasm-parity: --expect-passes needs ${KEYS.length} hashes`);
      process.exit(2);
    }
    const wrong = KEYS.filter((_, i) => got[i] !== expectPasses[i]);
    if (wrong.length > 0) {
      console.error(`wasm-parity: the passes ${wrong.join(', ')} differ from the native ones (${expectPasses.map(hex32).join(', ')})`);
      process.exit(1);
    }
  }
}

if (denoise) {
  if (typeof rt.rt_denoise !== 'function') {
    console.error('wasm-parity: this rt_wasm.wasm has no denoiser (rt_denoise)');
    process.exit(1);
  }
  const HALO = 72;
  const n = width * height;
  const albedo = new Float32Array(planes[0].buffer);
  const normal = new Float32Array(planes[1].buffer);
  const depth = new Float32Array(planes[2].buffer);
  const out4 = new Float32Array(n * 4);
  const bands = 3;
  for (let k = 0; k < bands; k++) {
    const y0 = Math.floor((height * k) / bands);
    const y1 = Math.floor((height * (k + 1)) / bands);
    const lo = Math.max(0, y0 - HALO);
    const hi = Math.min(height, y1 + HALO);
    const m = width * (hi - lo);
    const words = new Uint32Array(m * 14);
    const fl = new Float32Array(words.buffer);
    for (let i = 0; i < m; i++) {
      const p = lo * width + i;
      for (let c = 0; c < 3; c++) fl[i * 4 + c] = acc[p * 3 + c];
      fl[i * 4 + 3] = alphaSum[p];
      fl[m * 4 + i] = lum2[p];
      for (let c = 0; c < 3; c++) {
        fl[m * 5 + i * 3 + c] = albedo[p * 3 + c];
        fl[m * 8 + i * 3 + c] = normal[p * 3 + c];
      }
      fl[m * 11 + i] = depth[p];
      words[m * 12 + i] = planes[3][p];
      words[m * 13 + i] = planes[4][p];
    }
    const inPtr = rt.rt_alloc(words.byteLength);
    new Uint8Array(rt.memory.buffer, inPtr, words.byteLength).set(new Uint8Array(words.buffer));
    const outLen = width * (y1 - y0) * 4 * 4;
    const outPtr = rt.rt_alloc(outLen);
    const status = rt.rt_denoise(width, height, lo, hi - lo, samples, y0, y1, inPtr, outPtr);
    if (status !== 0) {
      console.error(`wasm-parity: rt_denoise returned ${status}`);
      process.exit(1);
    }
    out4.set(new Float32Array(rt.memory.buffer, outPtr, width * (y1 - y0) * 4), y0 * width * 4);
    rt.rt_free(inPtr, words.byteLength);
    rt.rt_free(outPtr, outLen);
  }
  const means = new Float32Array(n * 3);
  for (let p = 0; p < n; p++) for (let c = 0; c < 3; c++) means[p * 3 + c] = f(out4[p * 4 + c] * inv);
  const dh = fnv1a(means);
  console.log(`denoised: ${hex32(dh)}`);
  if (expectDenoised !== null && dh !== expectDenoised) {
    console.error(`wasm-parity: the denoised hash ${hex32(dh)} differs from the native one ${hex32(expectDenoised)}`);
    process.exit(1);
  }
}
