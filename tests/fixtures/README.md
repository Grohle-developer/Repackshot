# Test fixtures

Everything here was written for Repackshot's tests and is under the project's licence (PolyForm Noncommercial 1.0.0), like the repository. Nothing is
derived from another program's files or binaries.

| File | What it is | How it was made |
| --- | --- | --- |
| `cube-two-groups.obj` | A cube of 20 with two groups (Caps, Body) and one `usemtl` | Written by hand (phase I1) |
| `tetrahedron.stl` | ASCII STL of a tetrahedron | Written by hand (phase I1) |
| `two-parts.fbx` | ASCII FBX 7.4: two Null groups (Assembly, Fittings), a box in each, one Phong material "Steel", `UnitScaleFactor` 1 (centimetres), `UpAxis` 1 (Y) | Written by hand from the public FBX ASCII layout (nodes, properties, `Connections`); no exporter was used |
| `cube.ply` | ASCII PLY: a cube of 20 units, 8 vertices, 6 quads | Written by hand |
| `two-parts.dae` | Collada 1.4.1: group Assembly with nodes Body and Cap, one Phong effect, `unit` inch, `up_axis` Z_UP | Written by hand |
| `two-parts.usda` | USD text layer: Xform Bottle with two meshes and one UsdPreviewSurface material, `metersPerUnit` 0.01, `upAxis` Y | Written by hand |
| `example.rsb` | The engine's example scene as RSB v1 (8576 bytes): the byte-parity reference of `src/io/rsb.ts` (phase E4) | `cargo run --manifest-path engine/Cargo.toml --release -p rt-cli -- --write-example tests/fixtures/example.rsb` |
| `u1-render.json` | The `render` block of a project saved by U1 (schema 1): settings with `quality`, `maxSamples` and `maxSeconds`, and a queue of three flat jobs (done, running, waiting), one in EXR, the field set of U1's `RenderJob` (phase U5, migration test) | Written by hand from U1's types (`src/core/render.ts` before U5) |
| `project-v1.json` | A project exactly as U1 wrote it (schema 1: the state as it was, no `meshes` block, U1's flat render queue, `meta.dirty` saved as `true`): the bottle example with Copper on the cap, Rubber on four faces of the body, the Jewellery studio with Rembrandt, a second camera, the Hero animation, one queued render. It must keep loading in every version (phase U2, `tests/project.test.ts`) | `serializeProject` of commit `67b9154` (U1 closed) run on that project: `git archive 67b9154 src tests package.json tsconfig.json vite.config.ts` into a scratch folder with this repository's `node_modules`, and a test that builds the project through the store and writes `await serializeProject(state).text()` |
| `project-v2.json` | A project as phase U2 writes it (schema 2 with the `meshes` block): the imported box of `tests/project.test.ts` (UVs on the caps, two `usemtl` on the body = face ranges, hard edges), Gold on the caps, a linked copy of the body, a flipped caps mesh (a derived id), the Jewellery studio, a second camera, an animation, a queued JPEG render, a name. 19 kB | `REPACK_WRITE_FIXTURES=1 npx vitest run tests/project.test.ts -t "writes the fixtures"` (writes `buildBusyProject()` through `serializeProject`) |
| `tonemap.json` | What the engine computes for 20 inputs: every tone curve, the sRGB encoding, the exposure gain and the 8-bit pixels of `Film::to_srgb8_tonemapped`; and `fmath`'s exp2, log2 and pow on 48 inputs (phase E4) | `cargo run --manifest-path engine/Cargo.toml --release -p rt-cli -- --tone-table > tests/fixtures/tonemap.json` |

Files that are cheaper to build than to commit are generated inside the tests, so they are always what the
library of this version writes:

- `.3dm` (`tests/rhino-fixture.ts`): written with the `rhino3dm` package (openNURBS, MIT): four layers, three
  box meshes, one material, a hidden layer, a sphere B-rep without render meshes.
- `.3mf` (`tests/threemf-fixture.ts`): a stored zip (`tests/zip.ts`) with a minimal model: two objects with base
  materials, two build items, one of them with a transform.
- `.usdz`: a stored zip around `two-parts.usda`.
- Binary FBX (`tests/fbx-binary.ts`): the ASCII fixture re-encoded as binary at versions 7400 and 7500.
- Binary PLY, little and big endian, point clouds and damaged files: built in `tests/io-ply.test.ts`.
