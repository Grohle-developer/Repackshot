# Repackshot

A free, open-source (MIT) KeyShot-style 3D product renderer that runs in
the browser — **written from scratch as a clean-room implementation**.

Goal: the product-rendering workflow (import a model, pick a product type,
assign materials, pick a light setup, get a beautiful render fast) without
the price tag or the license server, with an interface that is simpler
than the commercial ones: three columns, one inspector that edits whatever
is selected, one *Render* button, and a strictly black-and-white chrome so
the only colour on screen is the image.

It reuses the ideas and several solutions of
[EZ Packshot](https://github.com/Grohle/EZPackshot), a Blender add-on by
the same author: 16 product-type studios, a catalogue of 72 light setups
in 8 styles with exposure normalisation, 77 materials with procedural
wear, a Doctor panel, four-level selection, and photographer's language
everywhere.

## Clean-room rules

This is what keeps the project lawful and shippable. Non-negotiable:

1. **No KeyShot binaries in this repo.** No installers, no DLLs, no
   extracted resources. The `.gitignore` enforces this as a second line
   of defense (it also ignores any file name containing "keyshot", so
   never name a file that way).
2. **No disassembly or decompilation of KeyShot, ever.** No REA/Ghidra/
   Hopper/IDA sessions against KeyShot binaries, no pasted disassembly,
   no reconstructed algorithms from its code.
3. **Implementation sources are:** public rendering literature and
   open-source renderers with compatible licenses, plus black-box
   behavioral observation (using the product normally and writing down
   what it does — ideas and workflows, never code).
4. **All contributions must be original work** or from MIT/Apache-2.0/
   BSD-compatible sources, with attribution preserved.

Anyone who has studied KeyShot's internals writes the *behavioral spec*
(`docs/SPEC.md`); anyone who implements from the spec must not have seen
those internals.

## Stack

- **Interface**: TypeScript + Vite, no UI framework, no icon fonts, no
  network fonts; three.js only for the interactive preview while the
  camera moves.
- **Render engine**: **Rust, written from scratch, zero external
  dependencies** (`engine/`). A CPU path tracer compiled to WebAssembly
  for the browser (a pool of Web Workers) and to native binaries for the
  command line and the desktop app. It runs on any operating system and
  any CPU architecture (x86_64, ARM64, RISC-V, wasm32), is deterministic
  across platforms, and is built for efficiency: wide SIMD BVH traversal,
  low-discrepancy sampling, tile queues, adaptive sampling.
- **Tests**: vitest for the interface and model, `cargo test` for the
  engine, the local Chromium for screenshots.

Decisions and module boundaries are in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Getting started

Requires Node 22 and a stable Rust toolchain (`rustup`) with the
`wasm32-unknown-unknown` target.

```bash
npm ci
npm run dev            # http://localhost:5173
npm run qa             # typecheck + tests + build — must be green before any PR
npm run screenshot     # screenshots dist/ with the local Chromium (build first)
npm run engine:test    # cargo test for the engine workspace
npm run engine:build   # builds rt.wasm into public/engine/
cargo run --manifest-path engine/Cargo.toml --release -p rt-cli -- --example -o out/example.png
```

## Documentation

| File | What |
| --- | --- |
| [`CLAUDE.md`](CLAUDE.md) | Entry point for agents and humans: reading order and work rules |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Phases, which model executes each one, acceptance criteria |
| [`docs/SPEC.md`](docs/SPEC.md) | What the product does, and its data model |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Stack, repository map, store, render engines |
| [`docs/UI.md`](docs/UI.md) | The interface, control by control |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | How to contribute |

Documentation is written in Spanish; code, identifiers and comments are
in English; the interface ships in English and Spanish.

## Status

Scaffold, catalogues and documentation in place; the interface is being
built (phase U1). See the milestones in `docs/ROADMAP.md`:

- **v0.1** — glTF import, product types, materials, light setups, and
  the Rust path tracer rendering progressively in the viewport and to
  PNG, in the browser and from the command line.
- **v0.2** — glass and emitters, wood and fabric, edge bevel, place by
  reflection, bright field, sky, own thumbnails, CAD-face selection,
  render queue and passes.
- **v0.3** — visible wear, textures and labels, animation and video,
  STEP, desktop build.

## License

MIT — see [LICENSE](LICENSE).

The catalogue data under `src/data/` (studio presets, light setups,
material presets, wear tables) and the photometric formulas in
`src/core/light-math.ts`, `rig.ts` and `wear.ts` were ported from
EZ Packshot (GPL-3.0) **by its copyright holder**, who relicenses that
data for this project under MIT. The implementation is new; no Python
code was copied. The light-setup thumbnails under `public/thumbs/` come
from the same source and are replaced by locally generated ones in phase
L2.
