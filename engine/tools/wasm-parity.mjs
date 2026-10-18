// WebAssembly parity check: renders an RSB scene with the real `rt_wasm.wasm` (the module the
// browser loads) through its C ABI and prints the hash of the resolved film, which must equal the
// one native `cargo test` pins (`PINNED_EXAMPLE_4SPP` in crates/rt-core/src/render.rs).
//
//   cargo build -p rt-wasm --target wasm32-unknown-unknown --release
//   cargo run --release -p rt-cli -- --write-example /tmp/example.rsb
//   node tools/wasm-parity.mjs target/wasm32-unknown-unknown/release/rt_wasm.wasm \
//        /tmp/example.rsb [--samples 4] [--expect 0x12345678] \
//        [--passes] [--expect-passes 0x...,0x...,0x...,0x...,0x...,0x...]
//        [--alpha] [--expect-alpha 0x12345678]
//        [--denoise] [--expect-denoised 0x12345678]
//        [--particles] [--expect-particles 0x12345678] [--expect-shapes 0x12345678]
//        [--adaptive] [--expect-adaptive 0x12345678]
//        [--pick] [--expect-pick 0x12345678]
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
// `--alpha` (N2) renders the alpha pass: after every sample `rt_render_tile_alpha` gives the coverage of that sample, summed in
// sample order in f32 and divided by the f32 reciprocal of the count, like the film; the plane's FNV-1a must equal
// `--expect-alpha` (`PINNED_PASS_ALPHA`, or `PINNED_E5_PASS_ALPHA`, of crates/rt-core/src/render/passes_tests.rs). It is a
// pass of its own so the six hashes of `--expect-passes` stay what X2 pinned.
//
// A scene with caustic photons (E5b-1, `RNDR.caustic_photons`, `rt --write-e5b-example`) renders
// them inside the module: each worker traces the photon map of a sample itself, and the image must
// still have the native hash (`PINNED_E5B_CAUSTICS_4SPP`).
//
// A scene with a pixel filter and edge samples (E11, `rt --write-e11-example`) renders them inside the
// module too: it finds each tile's edges from its centre rays, and the image must have the native hash
// (`PINNED_E11_EDGES_4SPP`).
//
// `--particles` (S4a) also evaluates every ambient effect of the scene (its `FXAM` sections, in file
// order) with `rt_particles_eval`, the export of the Fast preview, and hashes all their particles
// one after another (FNV-1a over the 8 little-endian words of each: centre, radius, axis, tint
// bits); it must equal `--expect-particles` (`PINNED_AMBIENT_PARTICLES` of
// crates/rt-core/src/render/ambient_tests.rs, for `rt --write-ambient-example`). The image of such
// a scene has the native hash too (`PINNED_AMBIENT_4SPP`): the module evaluates the particles
// when it loads the scene.
//
// `--expect-shapes` (S3, with `--particles`) also asks `rt_particles_shapes` for the shape of every particle of every
// effect, in the same order, and hashes their little-endian `u32` codes one after another (FNV-1a); it must equal
// `PINNED_S3_DROPS_SHAPES` of crates/rt-core/src/render/s3_tests.rs (`rt --write-s3-drops-example`), whose particles are
// `PINNED_S3_DROPS_PARTICLES` and image `PINNED_S3_DROPS_4SPP`. A scene with a front glass (`GLAS`, `rt
// --write-s3-glass-example`) needs no option: the module lays the glass out when it loads the scene, and the image has
// the native hash (`PINNED_S3_GLASS_4SPP`).
//
// `--adaptive` (E10) renders the scene adaptively as its RSB asks (`RNDR.adaptive`, `RNDR.noise_threshold`, at most
// `RNDR.max_samples` per pixel; `rt --write-e10-example`): the first round, every 32-pixel tile through
// `rt_render_tile_rgba`, then rounds of the blocks the module's own decision (`rt_adaptive_decide`) chooses, through
// `rt_render_block_rgba` with the photon map of the round's iteration, every block's samples added in index order in
// f32; each pixel divided by its own count. The hash must equal `--expect-adaptive` (`PINNED_E10_ADAPTIVE` of
// crates/rt-core/src/adaptive/tests.rs), and the pixels' fewest and most samples are printed.
//
// `--pick` (F1) only picks: the chief ray and the part met of a 5 × 4 grid of image points through `rt_scene_pick`
// (and each hit's focus distance again through `rt_scene_focus_at`), hashed like the native test; it must equal
// `--expect-pick` (`PINNED_FOCUS_PICK_O1` and `PINNED_FOCUS_PICK_O2` of crates/rt-core/src/focus/tests.rs, for
// `rt --write-o1-example` and `rt --write-o2-example`).
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
let alpha = false;
let expectAlpha = null;
let denoise = false;
let expectDenoised = null;
let particles = false;
let expectParticles = null;
let expectShapes = null;
let adaptive = false;
let expectAdaptive = null;
let pick = false;
let expectPick = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--samples') samples = Number(args[++i]);
  else if (args[i] === '--expect') expect = Number.parseInt(args[++i], 16) >>> 0;
  else if (args[i] === '--passes') passes = true;
  else if (args[i] === '--alpha') alpha = true;
  else if (args[i] === '--expect-alpha') {
    alpha = true;
    expectAlpha = Number.parseInt(args[++i], 16) >>> 0;
  }
  else if (args[i] === '--expect-passes') {
    passes = true;
    expectPasses = args[++i].split(',').map((h) => Number.parseInt(h, 16) >>> 0);
  } else if (args[i] === '--denoise') denoise = true;
  else if (args[i] === '--particles') particles = true;
  else if (args[i] === '--expect-particles') {
    particles = true;
    expectParticles = Number.parseInt(args[++i], 16) >>> 0;
  } else if (args[i] === '--expect-shapes') {
    particles = true;
    expectShapes = Number.parseInt(args[++i], 16) >>> 0;
  }
  else if (args[i] === '--adaptive') adaptive = true;
  else if (args[i] === '--expect-adaptive') {
    adaptive = true;
    expectAdaptive = Number.parseInt(args[++i], 16) >>> 0;
  } else if (args[i] === '--pick') pick = true;
  else if (args[i] === '--expect-pick') {
    pick = true;
    expectPick = Number.parseInt(args[++i], 16) >>> 0;
  } else if (args[i] === '--expect-denoised') {
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

// Image size from the RNDR section (u32 width, u32 height at the start of its payload); the
// payloads of the ambient effects (FXAM).
const view = new DataView(rsb.buffer, rsb.byteOffset, rsb.byteLength);
let width = 0;
let height = 0;
let rndr = null;
const effects = [];
for (let pos = 8 + view.getUint32(4, true); pos + 8 <= rsb.length; ) {
  const tag = String.fromCharCode(...rsb.subarray(pos, pos + 4));
  const len = view.getUint32(pos + 4, true);
  if (tag === 'RNDR') {
    width = view.getUint32(pos + 8, true);
    height = view.getUint32(pos + 12, true);
    rndr = new DataView(rsb.buffer, rsb.byteOffset + pos + 8, len);
  }
  if (tag === 'FXAM') effects.push(rsb.slice(pos + 8, pos + 8 + len));
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

if (particles) {
  if (typeof rt.rt_particles_eval !== 'function') {
    console.error('wasm-parity: this rt_wasm.wasm has no particles (rt_particles_eval)');
    process.exit(1);
  }
  let h = 0x811c9dc5;
  let total = 0;
  for (const payload of effects) {
    const count = new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(12, true);
    const inPtr = rt.rt_alloc(payload.length);
    new Uint8Array(rt.memory.buffer, inPtr, payload.length).set(payload);
    const outLen = count * 8 * 4;
    const outPtr = rt.rt_alloc(outLen);
    const n = rt.rt_particles_eval(inPtr, payload.length, count, outPtr);
    if (n !== count) {
      console.error(`wasm-parity: rt_particles_eval returned ${n} for ${count} particles`);
      process.exit(1);
    }
    const bytes = new Uint8Array(rt.memory.buffer, outPtr, outLen);
    for (let i = 0; i < outLen; i++) h = Math.imul(h ^ bytes[i], 0x01000193) >>> 0;
    total += n;
    rt.rt_free(inPtr, payload.length);
    rt.rt_free(outPtr, outLen);
  }
  const hp = `0x${h.toString(16).padStart(8, '0')}`;
  console.log(`particles: ${total} in ${effects.length} effects, hash ${hp}`);
  if (expectParticles !== null && h !== expectParticles) {
    console.error(`wasm-parity: the particles' hash ${hp} differs from the native one 0x${expectParticles.toString(16).padStart(8, '0')}`);
    process.exit(1);
  }
  if (expectShapes !== null) {
    if (typeof rt.rt_particles_shapes !== 'function') {
      console.error('wasm-parity: this rt_wasm.wasm has no shapes of particles (rt_particles_shapes)');
      process.exit(1);
    }
    let hs = 0x811c9dc5;
    for (const payload of effects) {
      const count = new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(12, true);
      const inPtr = rt.rt_alloc(payload.length);
      new Uint8Array(rt.memory.buffer, inPtr, payload.length).set(payload);
      const outLen = Math.max(4, count * 4);
      const outPtr = rt.rt_alloc(outLen);
      const n = rt.rt_particles_shapes(inPtr, payload.length, count, outPtr);
      if (n !== count) {
        console.error(`wasm-parity: rt_particles_shapes returned ${n} for ${count} particles`);
        process.exit(1);
      }
      const bytes = new Uint8Array(rt.memory.buffer, outPtr, count * 4);
      for (let i = 0; i < bytes.length; i++) hs = Math.imul(hs ^ bytes[i], 0x01000193) >>> 0;
      rt.rt_free(inPtr, payload.length);
      rt.rt_free(outPtr, outLen);
    }
    const hsx = `0x${hs.toString(16).padStart(8, '0')}`;
    console.log(`shapes: hash ${hsx}`);
    if (hs !== expectShapes) {
      console.error(`wasm-parity: the shapes' hash ${hsx} differs from the native one 0x${expectShapes.toString(16).padStart(8, '0')}`);
      process.exit(1);
    }
  }
}

// F1: the picks of focus with a click (rt_scene_pick) at a 5 × 4 grid of image points, row by row, hashed as the
// native test does (the floats one after another, FNV-1a over their little-endian bytes); the scene's camera alone
// decides them (and its focus solve for a traced lens), so the image is not rendered.
if (pick) {
  if (typeof rt.rt_scene_pick !== 'function' || typeof rt.rt_scene_focus_at !== 'function') {
    console.error('wasm-parity: this rt_wasm.wasm has no focus pick (rt_scene_pick, rt_scene_focus_at)');
    process.exit(1);
  }
  const FLOATS = 14;
  const outPtr = rt.rt_alloc(FLOATS * 4);
  let h = 0x811c9dc5;
  let hits = 0;
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 5; i++) {
      const status = rt.rt_scene_pick(handle, Math.fround((i + 0.5) / 5), Math.fround((j + 0.5) / 4), outPtr);
      if (status !== 0) {
        console.error(`wasm-parity: rt_scene_pick returned ${status}`);
        process.exit(1);
      }
      const bytes = new Uint8Array(rt.memory.buffer, outPtr, FLOATS * 4);
      for (let k = 0; k < bytes.length; k++) h = Math.imul(h ^ bytes[k], 0x01000193) >>> 0;
      const f = new Float32Array(rt.memory.buffer.slice(outPtr, outPtr + FLOATS * 4));
      if (f[6] === 1) {
        hits++;
        // The focus distance of the hit point asked on its own is the pick's.
        const again = rt.rt_scene_focus_at(handle, f[8], f[9], f[10]);
        if (Math.fround(again) !== f[13] && !(Number.isNaN(again) && Number.isNaN(f[13]))) {
          console.error(`wasm-parity: rt_scene_focus_at gives ${again}, the pick ${f[13]}`);
          process.exit(1);
        }
      }
    }
  }
  rt.rt_free(outPtr, FLOATS * 4);
  const hp = `0x${h.toString(16).padStart(8, '0')}`;
  console.log(`picks: 20, ${hits} on a part, hash ${hp}`);
  if (expectPick !== null && h !== expectPick) {
    console.error(`wasm-parity: the picks' hash ${hp} differs from the native one 0x${expectPick.toString(16).padStart(8, '0')}`);
    process.exit(1);
  }
  rt.rt_scene_free(handle);
  process.exit(0);
}

const TILE = 32;
if (adaptive) {
  for (const name of ['rt_adaptive_decide', 'rt_render_block_rgba', 'rt_render_tile_rgba']) {
    if (typeof rt[name] !== 'function') {
      console.error(`wasm-parity: this rt_wasm.wasm has no adaptive sampling (${name})`);
      process.exit(1);
    }
  }
  // The RSB's budget: at most max_samples per pixel, the exposure (the floor of the error) and the noise target.
  const cap = rndr.getUint32(8, true);
  const ev = rndr.getFloat32(20, true);
  const target = rndr.byteLength >= 72 ? rndr.getFloat32(68, true) : 0;
  const BLOCK = 8;
  const cols = Math.ceil(width / BLOCK);
  const rows = Math.ceil(height / BLOCK);
  const blocks = cols * rows;
  const counts = new Uint32Array(blocks);
  const active = new Uint8Array(blocks).fill(1);
  const sum = new Float32Array(width * height * 4);
  const sq = new Float32Array(width * height);
  const f32 = Math.fround;
  const [R, G, B] = [f32(0.2126), f32(0.7152), f32(0.0722)];
  const outPtr = rt.rt_alloc(TILE * TILE * 4 * 4);
  // Adds one sample of the rectangle (its RGBA at `outPtr`) to the sums, in f32, as the page's accumulator does.
  const add = (x0, y0, w, h) => {
    const px = new Float32Array(rt.memory.buffer, outPtr, w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = (y0 + y) * width + x0 + x;
        const q = (y * w + x) * 4;
        for (let c = 0; c < 4; c++) sum[p * 4 + c] = f32(sum[p * 4 + c] + px[q + c]);
        const l = f32(f32(f32(R * px[q]) + f32(G * px[q + 1])) + f32(B * px[q + 2]));
        sq[p] = f32(sq[p] + f32(l * l));
      }
    }
  };
  let round = cap > 0 ? Math.min(16, cap) : 16;
  let iteration = 0;
  let warm = true;
  let rounds = 0;
  const quota = (b) => (!active[b] ? 0 : cap > 0 ? Math.min(round, Math.max(0, cap - counts[b])) : round);
  const t0 = performance.now();
  for (;;) {
    // The whole round in one pass (where a round is cut changes no pixel).
    if (warm) {
      for (let ty = 0; ty < height; ty += TILE) {
        for (let tx = 0; tx < width; tx += TILE) {
          const w = Math.min(TILE, width - tx);
          const h = Math.min(TILE, height - ty);
          for (let s = 0; s < round; s++) {
            const status = rt.rt_render_tile_rgba(handle, tx, ty, w, h, iteration + s, outPtr);
            if (status !== 0) throw new Error(`rt_render_tile_rgba returned ${status}`);
            add(tx, ty, w, h);
          }
        }
      }
    } else {
      for (let b = 0; b < blocks; b++) {
        const q = quota(b);
        if (q === 0) continue;
        const x = (b % cols) * BLOCK;
        const y = Math.floor(b / cols) * BLOCK;
        const w = Math.min(BLOCK, width - x);
        const h = Math.min(BLOCK, height - y);
        for (let s = 0; s < q; s++) {
          const status = rt.rt_render_block_rgba(handle, x, y, w, h, counts[b] + s, iteration + s, outPtr);
          if (status !== 0) throw new Error(`rt_render_block_rgba returned ${status}`);
          add(x, y, w, h);
        }
      }
    }
    // The round is over: its samples count, and the module decides the next one.
    for (let b = 0; b < blocks; b++) counts[b] += quota(b);
    iteration += round;
    rounds++;
    const planes = [new Uint8Array(counts.buffer), new Uint8Array(sum.buffer), new Uint8Array(sq.buffer)];
    const ptrs = planes.map((p) => {
      const ptr = rt.rt_alloc(p.byteLength);
      new Uint8Array(rt.memory.buffer, ptr, p.byteLength).set(p);
      return ptr;
    });
    const activePtr = rt.rt_alloc(blocks);
    const decisionPtr = rt.rt_alloc(24);
    const status = rt.rt_adaptive_decide(width, height, ev, target, cap, ptrs[0], ptrs[1], ptrs[2], activePtr, decisionPtr);
    if (status !== 0) throw new Error(`rt_adaptive_decide returned ${status}`);
    active.set(new Uint8Array(rt.memory.buffer, activePtr, blocks));
    round = new DataView(rt.memory.buffer, decisionPtr, 24).getUint32(0, true);
    planes.forEach((p, i) => rt.rt_free(ptrs[i], p.byteLength));
    rt.rt_free(activePtr, blocks);
    rt.rt_free(decisionPtr, 24);
    warm = false;
    if (round === 0) break;
  }
  const seconds = (performance.now() - t0) / 1000;
  // Each pixel divided by its own count, as `Film::resolve` does: the sum times the f32 reciprocal.
  const resolved = new Float32Array(width * height * 3);
  let lo = Infinity;
  let hi = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const n = counts[Math.floor(y / BLOCK) * cols + Math.floor(x / BLOCK)];
      lo = Math.min(lo, n);
      hi = Math.max(hi, n);
      const inv = f32(1 / n);
      for (let c = 0; c < 3; c++) resolved[p * 3 + c] = f32(sum[p * 4 + c] * inv);
    }
  }
  const bytes = new Uint8Array(resolved.buffer);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193) >>> 0;
  const hex = `0x${h.toString(16).padStart(8, '0')}`;
  console.log(`adaptive: ${width}x${height}, ${rounds} rounds, ${lo}..${hi} spp in ${seconds.toFixed(2)} s, hash ${hex}`);
  if (expectAdaptive !== null && h !== expectAdaptive) {
    console.error(`wasm-parity: the adaptive image's hash ${hex} differs from the native one 0x${expectAdaptive.toString(16).padStart(8, '0')}`);
    process.exit(1);
  }
  process.exit(0);
}
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
if (alpha && typeof rt.rt_render_tile_alpha !== 'function') {
  console.error('wasm-parity: this rt_wasm.wasm has no alpha pass (rt_render_tile_alpha)');
  process.exit(1);
}
const coverageSum = alpha ? new Float32Array(width * height) : null;
const alphaOut = alpha ? rt.rt_alloc(TILE * TILE * 4) : 0;
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
      if (alpha) {
        const a = rt.rt_render_tile_alpha(handle, tx, ty, w, h, s, alphaOut);
        if (a !== 0) {
          console.error(`wasm-parity: rt_render_tile_alpha returned ${a}`);
          process.exit(1);
        }
        const cover = new Float32Array(rt.memory.buffer, alphaOut, w * h);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const i = (ty + y) * width + tx + x;
            coverageSum[i] = Math.fround(coverageSum[i] + cover[y * w + x]);
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

if (alpha) {
  // The coverage divided like the image: the sum times the f32 reciprocal of the samples.
  const cover = new Float32Array(coverageSum.length);
  for (let i = 0; i < cover.length; i++) cover[i] = Math.fround(coverageSum[i] * inv);
  const ah = fnv1a(cover);
  console.log(`alpha: ${hex32(ah)}`);
  if (expectAlpha !== null && ah !== expectAlpha) {
    console.error(`wasm-parity: the alpha pass ${hex32(ah)} differs from the native one ${hex32(expectAlpha)}`);
    process.exit(1);
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
