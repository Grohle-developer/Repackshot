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
| `crates/rt-core` | library | The engine: `math`, `rng` (PCG32), `color`, `image` (film), `png` (writer), `scene` (+ `scene::rsb`, the scene format), `render`, `example`. No OS APIs (`fs`, `net`, `time`, `thread` are forbidden), no `unsafe`. |
| `crates/rt-cli` | binary `rt` + library | Native front end: reads an `.rsb` file, renders on all cores, writes a PNG. Files, threads and timing live here. |
| `crates/rt-wasm` | `cdylib` + `rlib` | WebAssembly build with a hand-written C ABI (no `wasm-bindgen`). The only crate with `unsafe`, confined to `src/ffi.rs`. |

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

## Render something

```sh
cargo run --release -p rt-cli -- --example -o out.png        # built-in scene, no input file
cargo run --release -p rt-cli -- --write-example scene.rsb   # the same scene as an RSB file
cargo run --release -p rt-cli -- scene.rsb -o out.png --samples 64 --threads 4 --size 1280x720
```

The CLI prints the image size, the number of rays and rays per second.

## Cross-check: any OS, any architecture

```sh
rustup target add wasm32-unknown-unknown aarch64-unknown-linux-gnu riscv64gc-unknown-linux-gnu
cargo check --workspace --target aarch64-unknown-linux-gnu
cargo check --workspace --target riscv64gc-unknown-linux-gnu
```

CI runs these on every push. Rendering is deterministic: the random numbers depend only on the
scene seed, the pixel and the sample index (never on tiling, thread count or platform), and the
render path uses only IEEE add / mul / div / sqrt, so a pinned test (`render.rs`) sees the same
bits on native and WebAssembly builds.

## Produce the WebAssembly module

```sh
cargo build -p rt-wasm --target wasm32-unknown-unknown --release
# -> target/wasm32-unknown-unknown/release/rt_wasm.wasm  (about 50 KB, no imports)
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
`MATL`, `LGHT`, `ENVR`, `RNDR`. Unknown tags are skipped, so old readers keep working with newer
writers. The exact field layout is documented at the top of
[`crates/rt-core/src/scene/rsb.rs`](crates/rt-core/src/scene/rsb.rs), which contains both the
reader (`Scene::from_rsb`) and the reference writer (`Scene::to_rsb`) that the TypeScript side
is tested against.

## Roadmap of the engine

* **E1 (this skeleton)**: workspace, maths, RNG, film, PNG, RSB, a brute-force ray caster, CLI, wasm shell.
* **E2**: BVH replaces the brute-force intersection in `render.rs`.
* **E3**: the path tracer (materials, lights, environment) replaces the `n.l` placeholder shading.
