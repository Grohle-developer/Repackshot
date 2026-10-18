# public/assets: generated assets

Everything in this folder comes from **the repository's own deterministic generator** (`tools/assets/`), never
from an AI image model, a photograph or any third-party library (clean room, `docs/STUDIO-TOOLS.md`
§0). Each file is stored as a **recipe** (type and parameters), a **seed** and the
**hash** of the result; the `index.json` of each folder lists it.

| Folder | What | Generator | Size |
| --- | --- | --- | --- |
| `aperture/` | 45 aperture masks and pupil textures: polygons of 3 to 18 blades (straight and curved), stars of 4, 5, 6 and 8 points, heart, several holes (7 and 19), rings with obstruction 0.3 and 0.5, onion rings, dust, scratches and filter mesh | `tools/assets/aperture-masks.mjs` | 512 × 512, 8-bit grey |
| `gobo/` | 12 gobo patterns: windows (2×3, 3×4, arched), blinds (straight and slanted), leaves (two densities), dappled light, dots, lines, radial burst and soft break-up | `tools/assets/gobos.mjs` | 1024 × 1024, 8-bit grey |

## How they are regenerated and checked

```bash
node tools/assets/aperture-masks.mjs           # writes public/assets/aperture/
node tools/assets/gobos.mjs                    # writes public/assets/gobo/
node tools/assets/aperture-masks.mjs --check   # regenerates in memory and compares with what is on disk
node tools/assets/gobos.mjs --check
```

`tests/assets.test.ts` does this on every `npm run qa`: it regenerates each file with
the generator's pure functions and requires the same hash. A hand-edited file,
a recipe changed without regenerating, or a generator that stops being
deterministic fails there.

## What `index.json` says

For each file: `id` (stable key, added to and never renamed), `file`,
`recipe` (the parameters the result depends on), `seed`, `size`,
`bytes` and two SHA-256 hashes:

- `pixelsSha256`: of the raw pixels (8-bit grey). **This is the canonical one**:
  it depends on nothing but the recipe and the seed.
- `sha256`: of the PNG as written, to check its integrity. The bytes
  of a compressed stream can change between zlib versions; the pixels cannot.

## Determinism

The generator uses only `+ − × ÷` and `sqrt` (which IEEE 754 fixes to the bit) and its own
functions (`sin`, `cos`, value noise from an integer hash, `mulberry32`); never
`Math.sin`, `Math.exp`, `Math.pow` or `Math.random`. The seeds are in the recipe.

## Conventions

- **Aperture masks.** The image covers [−1, 1]², with v up and the unit
  circle inscribed. The grey is the **pupil transmission** (255 open,
  0 closed). Shapes have their circumscribed radius at 1 (the vertices touch the
  circle); the first vertex points up. Curved blades use a roundness of
  0.5 (`docs/research/optics.md` §1: κ = inscribed radius / radius of the blade's
  arc; 1 is a circle, 0 straight blades). Textures (dust, scratches, mesh,
  onion rings) are drawn inside the unit disc and are 0 outside: the engine
  multiplies them by the shape of the aperture. Onion rings are an
  amplitude modulation of 1: the engine scales it with its amplitude.
- **Gobos.** The image covers [−1, 1]², with v up; the grey is the light that
  passes (255 open). The light projects it in its own space.

## What uses these files

`src/data/bokeh.json` points to the masks by their `id` (a test checks that
they all exist and that every one that is not a polygon is used); the gobos will be used by
phase L7. If an asset is added: its recipe is added to the generator, it is regenerated
and committed with the `index.json`.
