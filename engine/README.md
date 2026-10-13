# Repackshot engine

The render engine of Repackshot: a CPU path tracer written in Rust, 100 % from scratch, MIT
licensed. It is built to run on any OS and any CPU architecture:

* compiled to **WebAssembly**, it runs in the browser inside Web Workers;
* compiled **natively**, it is a command line renderer today and the core of a desktop app later.

## The zero-dependency rule

The whole workspace depends on nothing but `std` / `core` / `alloc`. Vector maths, the random
number generator, the PNG writer and the scene parser are all written here. `Cargo.lock` must
list the workspace crates and nothing else; CI fails if any `[[package]]` has a `source =` line.
Do not add a dependency. If something is missing, write it.

## Layout

| Crate | Kind | Role |
|-------|------|------|
| `crates/rt-core` | library | The engine: `math`, `fmath` (deterministic `sin`, `exp2`, `log2`, `pow`...), `rng` (PCG32), `sampler` (Owen-scrambled Sobol), `warp`, `color` (tone curves), `image` (film with alpha), `png` (writer), `simd`, `geometry` (meshes, instances, BVHs, ray queries), `bsdf`, `light`, `environment`, `integrator` (the path tracer), `scene` (+ `scene::rsb`, the scene format), `render` (tiles), `example`. No OS APIs (`fs`, `net`, `time`, `thread` are forbidden). `unsafe` only in `simd`, every block with a `// SAFETY:` comment. |
| `crates/rt-cli` | binaries `rt`, `rt-bench` + library | Native front end: reads an `.rsb` file, renders progressively on all cores within the time budget, writes a PNG; `rt --sheet` renders the contact sheet; `rt-bench` measures ray throughput. Files, threads and timing live here. |
| `crates/rt-wasm` | `cdylib` + `rlib` | WebAssembly build with a hand-written C ABI (no `wasm-bindgen`). Its `unsafe` is confined to `src/ffi.rs`. |
| `tools/wasi-run.mjs` | script | Cargo runner that executes `wasm32-wasip1` test binaries under Node's WASI (see below). |
| `tools/wasm-parity.mjs` | script | Renders an RSB scene with the real `rt_wasm.wasm` in Node and checks its film hash against the native one. |

Scene units are millimetres, angles in files are degrees, the world is Z-up.

## Build and test

Everything is run from this directory (`engine/`). The toolchain is stable Rust, pinned by
`rust-toolchain.toml`.

```sh
cargo fmt --all -- --check                      # formatting
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace                          # unit and integration tests
cargo build --release -p rt-cli                 # target/release/rt
```

From the repository root, `npm run engine:test` runs the tests and `npm run engine:build` builds
the WebAssembly module and copies it to `public/engine/rt.wasm` (git-ignored).

The `test` profile uses `opt-level = 1`: the BVH tests compare against a brute-force loop over
every triangle (tens of millions of triangle tests), which is ten times faster that way. Debug
assertions and overflow checks stay on.

The rt-core tests also run as WebAssembly, scalar and with `simd128`, under Node (CI does this):

```sh
rustup target add wasm32-wasip1
export CARGO_TARGET_WASM32_WASIP1_RUNNER="node $PWD/tools/wasi-run.mjs"
cargo test -p rt-core --release --target wasm32-wasip1
RUSTFLAGS="-C target-feature=+simd128" cargo test -p rt-core --release --target wasm32-wasip1
```

(Use `--release`: Node 22 itself crashes running the whole debug-build test binary, although
every test passes on its own.)

## Render something

```sh
cargo run --release -p rt-cli -- --example -o out.png        # built-in scene, no input file
cargo run --release -p rt-cli -- --write-example scene.rsb   # the same scene as an RSB file
cargo run --release -p rt-cli -- scene.rsb -o out.png --samples 64 --threads 4 --size 1280x720
cargo run --release -p rt-cli -- scene.rsb -o out.png --samples 4096 --max-seconds 30
cargo run --release -p rt-cli -- --sheet ../out/sheet          # the contact sheet (below)
```

The CLI prints the scene and image size, the SIMD path and BVH width in use, the samples
rendered, the number of rays (camera, bounce and shadow rays) and rays per second.

Rendering is **progressive**: every tile has its own film, and passes of 1, 2, 4 ... 16 sample
indices go over all tiles. The time budget (`--max-seconds`, else the scene's
`RNDR.max_seconds`; 0 is no limit) is checked between passes, so every pixel always has the same
number of samples and at least one pass is rendered. A tile's samples are always added in index
order, so the film does not depend on the thread count or the pass sizes.

**Contact sheet.** `rt --sheet <dir>` renders the example part under six built-in light recipes
(key only, three point, split, backlit panel visible to the camera, overhead, sun; defined in
`crates/rt-cli/src/sheet.rs`, normalised to 2.5 W/m² on the part) at 480x360 and 64 spp, and
writes one PNG per recipe, `index.html` (a grid with the mean luma, the clipped-white and the
crushed-black fractions of every image) and `stats.json`. These recipes are engine fixtures; the
16 x 12 sheet over the catalogue comes in E4 with the TypeScript RSB writer. `out/` is
git-ignored.

## The path tracer (E3)

Unidirectional path tracing with next-event estimation and multiple importance sampling
(`integrator`). At every surface: add what it emits, sample **one** light and trace a shadow
ray, sample the BSDF for the next direction. Emitters found by BSDF-sampled rays are weighted
against light sampling with the power heuristic (and light samples against the BSDF), so nothing
is counted twice. Russian roulette from the third vertex on (survival `max(throughput)`,
clamped to `[0.05, 1]`); `RNDR.max_depth` surface interactions at most (default 8; 1 is direct
lighting only); `RNDR.clamp_indirect` caps every contribution of light that bounced at least
twice (0: off).

* **Sampler** (`sampler`): the Sobol sequence with the Joe and Kuo `new-joe-kuo-6.21201`
  direction numbers (first 64 dimensions, table in the module, licence below), each dimension of
  each pixel Owen-scrambled with Burley's (2020) hash, seeded by (scene seed, pixel x, y); the
  sample index is the position in the sequence. Logical dimensions: camera 2, lens 2, then per
  vertex light selection 1, light point 2, BSDF 2, roulette 1. The 2-D slots are mapped to the
  pairs of Sobol dimensions with the best 2-D projections (t <= 2 at 64 to 4096 points, chosen by
  a greedy search and re-checked in a test); vertices beyond the tenth use hashed random numbers.
* **Camera**: thin lens (focal length, sensor width on the longer side, f-number, focus
  distance; the lens point from the concentric disk map) or orthographic. Box pixel filter (a
  Gaussian or Blackman-Harris filter can replace it by weighting splats).
* **Materials** (`bsdf`), `MATL.kind`: **0 principled**: Lambert diffuse weighted by
  `(1 - F(μo))(1 - F(μi))`, GGX specular with height-correlated Smith masking (Heitz 2014),
  sampled by its visible normals (Heitz 2018), `α = roughness²`, Schlick Fresnel with
  `F0 = ((ior - 1)/(ior + 1))²` for the dielectric and `base_color` for the metal, blended by
  `metallic`, `F90 = min(1, 50 F0)` (Lagarde and de Rousiers 2014: an `ior` of 1 has no
  specular lobe); a clear coat as a second GGX lobe (ior 1.5) weighted by `coat`.
  `transmission` is ignored until E5. **1 glass**: rendered as kind 0 (an opaque tinted
  dielectric) until E5. **2 emissive**: radiance `emission * emission_power`, reflects nothing;
  with `MATL.flags` bit 0 it is also sampled as an area light (by triangle area).
  Single-scattering GGX loses energy when rough (a white metal at roughness 1 reflects
  `1 - ln 2` head on); it never gains any.
* **Lights** (`light`), `LGHT.kind`: **0 rect**, **1 disk**: one-sided, transparent, uniform
  area sampling; `power` is the flux in watts (radiance `color * power / (π area_m²)`, a scene
  millimetre being 1e-3 m); `spread_deg` adds a `cos^n` falloff whose intensity halves at
  `spread_deg / 2` (180: none; the on-axis radiance does not change). **2 sun**: a disc of
  `angle_deg` sampled in its cone, `power` the irradiance in W/m² on a surface facing it (0
  degrees: a delta direction). **3 point**, **4 spot**: reserved for L4, parsed and ignored.
  `flags` bit 0 **glossy**: seen by BSDF-sampled rays and lighting every lobe (with MIS); without
  it the light lights only the diffuse lobe, by light sampling alone, and is invisible in
  reflections (Blender's "glossy" visibility, which the recipes come from). Bit 1 **camera**:
  visible to camera rays. One light per vertex, chosen in proportion to an estimate of the flux
  it sends into the scene's bounding sphere (a light tree replaces it in K4).
* **Environment** (`environment`), `ENVR.kind`: **0 studio dome**: radiance linear in the `z`
  of the direction, `floor` at -1, `horizon` at 0, `zenith` at +1, importance sampled by the
  closed-form inverse of that piecewise-linear density in `z` times a uniform azimuth (exact
  pdf). **1 flat**: `horizon` everywhere. **2 sky**, **3 HDRI**: reserved for E5, rendered as the
  dome. All scaled by `strength`. `background_mode`: **0** the environment is visible to
  camera rays, **1** they see `background_color`, **2** transparent (black, alpha 0 in the film's
  new `alpha` channel), **3** backplate, reserved for M2 (rendered as 1). The environment lights
  the scene in every mode.
* **Floor** (new `FLOR` section): `mode` **0** none, **1** an infinite Lambertian plane at `z`
  of albedo `color`, **2** shadow catcher: only camera rays see it, as the background darkened by
  the fraction of the light reaching it that the scene blocks (next-event estimation and one BSDF
  ray, with and without occlusion); with a transparent background that fraction becomes alpha
  over black, so a composite keeps the contact shadow.
* **Coarse smooth meshes**: rays leave from the hit point lifted onto the surface the vertex
  normals describe (Hanika, "Hacking the Shadow Terminator", 2021), which keeps shadow
  terminators smooth; the shading normal is kept on the geometric side and falls back to the
  geometric normal where it would face away from the viewer.
* **Tone curves** (`color`, `Film::to_srgb8_tonemapped`), `RNDR.tonemap`: **0** linear, **1** ACES
  (Narkowicz fit), **2** filmic (Blender-like: the 16.5-stop log2 shaper of Sobotka's Filmic and
  the published polynomial fit of the AgX base contrast, per channel), **3** AgX (Sobotka's
  inset, the same shaper and curve, the inverse inset, default look), **4** standard (sRGB,
  clipped). Exposure multiplies by `2^ev` before the curve.

All of it uses `fmath` instead of `std`'s `sin`, `powf`, `exp2`...: those call the platform's
maths library, which differs between glibc, musl and the WebAssembly `libm`. `fmath` is built from
IEEE `+ - * /` and `sqrt` only, so a scene renders to the same bits everywhere.

## Geometry, BVH and SIMD

* **Meshes** (`geometry::Mesh`) are indexed triangle meshes in their own space, positions and
  normals structure-of-arrays. Building one validates it and builds its BVH, so a mesh is
  immutable.
* **Instances** place a mesh in the world with a 3x4 transform and their own material. The
  geometry (`geometry::Geometry`, `Scene::geometry`) is two-level: a BVH over the instances'
  world boxes, then each mesh's BVH; rays move into a mesh's space with the precomputed inverse
  (same `t`), normals come back with the inverse transpose.
* **BVH**: binned SAH (16 bins; leaf at 4 triangles or fewer, or up to 8 when the SAH says so),
  collapsed into BVH4 or BVH8 nodes with the child boxes stored structure-of-arrays, traversed
  with an explicit stack, nearest child first; shadow rays (`occluded`) stop at the first hit.
  The build is deterministic. BVH8 is used where AVX2 is detected, BVH4 elsewhere.
* **Triangles**: the watertight test of Woop, Benthin and Wald (JCGT 2013), four triangles per
  SIMD packet, two-sided unless an instance is flagged one-sided.
* **Queries**: `Scene::pick` / `Geometry::intersect` (instance, triangle, `t`, point, normals,
  barycentrics), `Geometry::trace` (indices and `t` only), `Geometry::occluded`, and batch forms.
  The nearest hit is the smallest `(t, instance, triangle)`, so the answer does not depend on the
  tree or the traversal order: it equals a brute-force loop over every triangle, which the tests
  check on 10 000 rays per scene, on every SIMD path and both widths.
* **SIMD** (`simd`): `F32x4`, `F32x8` and masks over the stable `core::arch` intrinsics, with a
  scalar reference implementation that every path is tested against bit for bit:

  | Path | Where | Status |
  |------|-------|--------|
  | scalar | everywhere | reference; used on RISC-V and wasm without `simd128` |
  | SSE2 | x86_64 | baseline, always on |
  | AVX2 | x86_64 | detected at run time (`is_x86_feature_detected!`), entered once per query or batch through a `#[target_feature(enable = "avx2")]` function |
  | NEON | aarch64 | compile-checked in CI (no aarch64 runner) |
  | simd128 | wasm32 built with `-C target-feature=+simd128` | tested under Node in CI |

  Fused multiply-add is never used (it would change bits between paths); `min`/`max` have the
  x86 `minps`/`maxps` semantics on every path.

## Measure ray throughput

```sh
cargo run --release -p rt-cli --bin rt-bench                  # 10 M rays per measurement
cargo run --release -p rt-cli --bin rt-bench -- --threads 1 --isa sse2 --width 4
```

It builds the example part and a displaced sphere of about a million triangles, prints the BVH
build time, and the closest-hit throughput of coherent rays (camera rays, tile by tile) and of
incoherent rays (random origins around the object aimed at random points of its bounds), plus the
any-hit throughput of the incoherent set. Ray generation is not timed.

Measured for E2 on a 4-core x86_64 VM (Xeon @ 2.8 GHz, AVX2 detected, BVH8), per thread / 4
threads, in Mrays/s:

| Scene | coherent closest | incoherent closest | incoherent any hit | build |
|-------|------------------|--------------------|--------------------|-------|
| example part (322 triangles, 3 instances) | 12.3 / 53.8 | 13.8 / 56.2 | 18.9 / 80.1 | 0.3 ms |
| displaced sphere (1 000 000 triangles) | 3.9 / 15.9 | 1.0 / 4.5 | 1.1 / 5.4 | 1.1 s |

The whole `rt --example` render path (camera rays, BVH, placeholder shading, film) went from
1.4 to 15.2 Mrays/s on 4 threads (4.4 on one) in E2. With the path tracer of E3 (about 2.7 rays
per path: camera, shadow and bounce rays, shading, sampling) it renders 7.9 Mrays/s on 4 threads
(2.0 on one) on the same VM, shared with other work at the time: the 512x384 example at 64 spp
in about 4.3 s.

## Cross-check: any OS, any architecture

```sh
rustup target add wasm32-unknown-unknown aarch64-unknown-linux-gnu riscv64gc-unknown-linux-gnu
cargo check --workspace --target aarch64-unknown-linux-gnu
cargo check --workspace --target riscv64gc-unknown-linux-gnu
```

CI runs these on every push. Rendering is deterministic: the random numbers depend only on the
scene seed, the pixel and the sample index (never on tiling, thread count or platform), the
render path uses only IEEE add / mul / div / sqrt and the `fmath` functions built from them, and
every SIMD path computes the same bits, so pinned tests (`render.rs`: two tiles, and the whole
example at 4 spp) see the same bits on native (scalar, SSE2, AVX2) and WebAssembly (scalar,
`simd128`) builds, whatever the BVH width. The real module is checked too:

```sh
cargo build -p rt-wasm --target wasm32-unknown-unknown --release
cargo run --release -p rt-cli -- --write-example /tmp/example.rsb
node tools/wasm-parity.mjs target/wasm32-unknown-unknown/release/rt_wasm.wasm /tmp/example.rsb \
     --expect "$(sed -n 's/.*PINNED_EXAMPLE_4SPP: u32 = 0x\([0-9a-f_]*\);.*/\1/p' crates/rt-core/src/render.rs | tr -d _)"
```

## Produce the WebAssembly module

```sh
cargo build -p rt-wasm --target wasm32-unknown-unknown --release
# -> target/wasm32-unknown-unknown/release/rt_wasm.wasm  (about 175 KB, no imports)
```

The module imports nothing (no WASI, no JavaScript glue). Exports:

| Export | Meaning |
|--------|---------|
| `rt_version() -> u32` | `major << 16 \| minor << 8 \| patch` |
| `rt_alloc(len) -> ptr` / `rt_free(ptr, len)` | Buffers in linear memory for the host to fill or read |
| `rt_scene_load(ptr, len) -> handle` | Parses RSB bytes; 0 on error |
| `rt_scene_error_len() -> u32` / `rt_scene_error_copy(ptr)` | The last load error as UTF-8 |
| `rt_scene_free(handle) -> status` | Forgets a scene |
| `rt_render_tile(handle, x, y, w, h, sample_index, out_ptr) -> status` | Writes `w * h * 3` linear RGB floats for one sample of a tile |
| `rt_render_tile_rgba(handle, x, y, w, h, sample_index, out_ptr) -> status` | The same with coverage: `w * h * 4` floats, RGB premultiplied by alpha (0 where a transparent background shows) |

Status: 0 ok, 1 bad handle, 2 empty or oversized tile, 3 null output pointer. The scene's lights
are prepared once, when it is loaded. `rt_version` is 0.2.0 since E3.
A wasm instance is single threaded; the host runs one instance per Web Worker.

## The RSB scene format

RSB (Repackshot Scene Binary, version 1) is little-endian: the magic `RSB1`, a `u32` header
length, then sections `[tag: 4 ASCII bytes][u32 byte length][payload]`. Tags: `CAMR`, `MESH`,
`MATL`, `LGHT`, `ENVR`, `FLOR`, `RNDR`, `INST`. Unknown tags are skipped, so old readers keep
working with newer writers. `INST` (E2) places a mesh with a 3x4 transform, a material and flags;
a file without `INST` sections draws every mesh once, untransformed, with its own material,
exactly as before. E3 appended optional fields (`MATL.flags`; `RNDR.max_depth`,
`RNDR.clamp_indirect`: shorter, older sections read their defaults), added `FLOR` and fixed the
meaning of every value (see "The path tracer" above). The exact field layout and the semantics
are documented at the top of
[`crates/rt-core/src/scene/rsb.rs`](crates/rt-core/src/scene/rsb.rs), which contains both the
reader (`Scene::from_rsb`) and the reference writer (`Scene::to_rsb`) that the TypeScript side
is tested against.

## Roadmap of the engine

* **E1**: workspace, maths, RNG, film, PNG, RSB, a brute-force ray caster, CLI, wasm shell.
* **E2**: SIMD, SoA meshes, instances, binned-SAH BVH4/BVH8, watertight triangles, `pick`,
  shadow-ray queries, `rt-bench`; `render.rs` traces through the BVH.
* **E3**: the path tracer: Owen-scrambled Sobol, principled BSDF, area lights, sun, studio dome,
  MIS, floor and shadow catcher, alpha, tone curves, progressive CLI with a time budget, the
  contact sheet, wasm parity of the whole example.

## Third-party data

`crates/rt-core/src/sampler.rs` reproduces the first 64 dimensions of the Sobol direction numbers
`new-joe-kuo-6.21201` of S. Joe and F. Y. Kuo (<https://web.maths.unsw.edu.au/~fkuo/sobol/>),
which carry this notice:

```text
Copyright (c) 2008, Frances Y. Kuo and Stephen Joe
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.

    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

    * Neither the names of the copyright holders nor the names of the
      University of New South Wales and the University of Waikato
      and its contributors may be used to endorse or promote products derived
      from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS ``AS IS'' AND ANY
EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDERS BE LIABLE FOR ANY
DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
