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
| `crates/rt-core` | library | The engine: `math`, `rng` (PCG32), `color`, `image` (film), `png` (writer), `simd`, `geometry` (meshes, instances, BVHs, ray queries), `scene` (+ `scene::rsb`, the scene format), `render`, `example`. No OS APIs (`fs`, `net`, `time`, `thread` are forbidden). `unsafe` only in `simd`, every block with a `// SAFETY:` comment. |
| `crates/rt-cli` | binaries `rt`, `rt-bench` + library | Native front end: reads an `.rsb` file, renders on all cores, writes a PNG; `rt-bench` measures ray throughput. Files, threads and timing live here. |
| `crates/rt-wasm` | `cdylib` + `rlib` | WebAssembly build with a hand-written C ABI (no `wasm-bindgen`). Its `unsafe` is confined to `src/ffi.rs`. |
| `tools/wasi-run.mjs` | script | Cargo runner that executes `wasm32-wasip1` test binaries under Node's WASI (see below). |

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
```

The CLI prints the scene and image size, the SIMD path and BVH width in use, the number of rays
and rays per second.

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
1.4 to 15.2 Mrays/s on 4 threads (4.4 on one).

## Cross-check: any OS, any architecture

```sh
rustup target add wasm32-unknown-unknown aarch64-unknown-linux-gnu riscv64gc-unknown-linux-gnu
cargo check --workspace --target aarch64-unknown-linux-gnu
cargo check --workspace --target riscv64gc-unknown-linux-gnu
```

CI runs these on every push. Rendering is deterministic: the random numbers depend only on the
scene seed, the pixel and the sample index (never on tiling, thread count or platform), the
render path uses only IEEE add / mul / div / sqrt, and every SIMD path computes the same bits, so
a pinned test (`render.rs`) sees the same bits on native (scalar, SSE2, AVX2) and WebAssembly
(scalar, `simd128`) builds, whatever the BVH width.

## Produce the WebAssembly module

```sh
cargo build -p rt-wasm --target wasm32-unknown-unknown --release
# -> target/wasm32-unknown-unknown/release/rt_wasm.wasm  (about 115 KB, no imports)
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

`rt_render_tile` status: 0 ok, 1 bad handle, 2 empty or oversized tile, 3 null output pointer.
A wasm instance is single threaded; the host runs one instance per Web Worker.

## The RSB scene format

RSB (Repackshot Scene Binary, version 1) is little-endian: the magic `RSB1`, a `u32` header
length, then sections `[tag: 4 ASCII bytes][u32 byte length][payload]`. Tags: `CAMR`, `MESH`,
`MATL`, `LGHT`, `ENVR`, `RNDR`, `INST`. Unknown tags are skipped, so old readers keep working with
newer writers. `INST` (E2) places a mesh with a 3x4 transform, a material and flags; a file
without `INST` sections draws every mesh once, untransformed, with its own material, exactly as
before. The exact field layout is documented at the top of
[`crates/rt-core/src/scene/rsb.rs`](crates/rt-core/src/scene/rsb.rs), which contains both the
reader (`Scene::from_rsb`) and the reference writer (`Scene::to_rsb`) that the TypeScript side
is tested against.

## Roadmap of the engine

* **E1**: workspace, maths, RNG, film, PNG, RSB, a brute-force ray caster, CLI, wasm shell.
* **E2**: SIMD, SoA meshes, instances, binned-SAH BVH4/BVH8, watertight triangles, `pick`,
  shadow-ray queries, `rt-bench`; `render.rs` traces through the BVH.
* **E3**: the path tracer (materials, lights, environment) replaces the `n.l` placeholder shading.
