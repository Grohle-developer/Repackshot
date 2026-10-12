# Test fixtures (phase I3 and before)

Everything here was written for Repackshot's tests and is licensed MIT, like the repository. Nothing is
derived from another program's files or binaries.

| File | What it is | How it was made |
| --- | --- | --- |
| `cube-two-groups.obj` | A cube of 20 with two groups (Caps, Body) and one `usemtl` | Written by hand (phase I1) |
| `tetrahedron.stl` | ASCII STL of a tetrahedron | Written by hand (phase I1) |
| `two-parts.fbx` | ASCII FBX 7.4: two Null groups (Assembly, Fittings), a box in each, one Phong material "Steel", `UnitScaleFactor` 1 (centimetres), `UpAxis` 1 (Y) | Written by hand from the public FBX ASCII layout (nodes, properties, `Connections`); no exporter was used |
| `cube.ply` | ASCII PLY: a cube of 20 units, 8 vertices, 6 quads | Written by hand |
| `two-parts.dae` | Collada 1.4.1: group Assembly with nodes Body and Cap, one Phong effect, `unit` inch, `up_axis` Z_UP | Written by hand |
| `two-parts.usda` | USD text layer: Xform Bottle with two meshes and one UsdPreviewSurface material, `metersPerUnit` 0.01, `upAxis` Y | Written by hand |

Files that are cheaper to build than to commit are generated inside the tests, so they are always what the
library of this version writes:

- `.3dm` (`tests/rhino-fixture.ts`): written with the `rhino3dm` package (openNURBS, MIT): four layers, three
  box meshes, one material, a hidden layer, a sphere B-rep without render meshes.
- `.3mf` (`tests/threemf-fixture.ts`): a stored zip (`tests/zip.ts`) with a minimal model: two objects with base
  materials, two build items, one of them with a transform.
- `.usdz`: a stored zip around `two-parts.usda`.
- Binary FBX (`tests/fbx-binary.ts`): the ASCII fixture re-encoded as binary at versions 7400 and 7500.
- Binary PLY, little and big endian, point clouds and damaged files: built in `tests/io-ply.test.ts`.
