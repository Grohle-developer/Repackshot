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
| `box.step` | STEP AP214 (ISO 10303-21): product Box, a 40 x 30 x 20 mm B-rep with six planar faces, colour `COLOUR_RGB` (0.8, 0.2, 0.1), millimetres (phase I2) | Written for the tests entity by entity from the public AP214 schema (contexts, product, `MANIFOLD_SOLID_BREP`, styled item); no CAD program or exporter was used |
| `box-inch.step` | The same structure: product Inch box, 2 x 1.5 x 1, no colour, length unit `CONVERSION_BASED_UNIT('INCH')` | Same |
| `cylinder.step` | STEP AP214: product Cylinder, radius 10, height 30 mm, two planar caps and a cylindrical wall with a seam edge, no colour | Same |
| `assembly.step` | STEP AP214 assembly Bottle (`NEXT_ASSEMBLY_USAGE_OCCURRENCE`, `ITEM_DEFINED_TRANSFORMATION`) of Body (a 40 x 40 x 60 box, blue) and Cap (a cylinder of radius 12 and height 15, red) placed at (20, 20, 60) | Same |
| `quarter.igs` | IGES 5.3, 80 columns: one rational B-spline surface (entity 128) that is a quarter of a cylinder of radius 10 and height 20, a name property (406 form 15) "Quarter shell", colour number 2 (red), unit flag 2 (mm) | Written for the tests record by record from the public IGES 5.3 layout |
| `quarter-inch.igs` | The same surface with unit flag 1 (inches) | Same |
| `example.rsb` | The engine's example scene as RSB v1 (8576 bytes): the byte-parity reference of `src/io/rsb.ts` (phase E4) | `cargo run --manifest-path engine/Cargo.toml --release -p rt-cli -- --write-example tests/fixtures/example.rsb` |
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
