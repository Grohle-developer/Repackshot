# src/data

Static catalogues: product studios, light setups, materials, wear, fuzz, lenses,
animation sequences, scene-doctor checks and the procedural environment. No
logic lives here beyond tiny lookups (`studioPreset(key)`, `materialPreset(key)`,
...). The maths that uses these tables is in `src/core/` (`light-math.ts`,
`rig.ts`, `wear.ts`).

| File | Contents |
| --- | --- |
| `types.ts` | Shared contracts: `Label`, `LightSpec`, `StudioPreset`, `MaterialPreset`, `WearProps`, ... |
| `quality.ts` | `QUALITY_PRESETS` (3), `RESOLUTION_PRESETS` (5) |
| `studios.ts` | `STUDIO_PRESETS` (16 product types, 50 lights) |
| `light-setups.ts` | `LIGHT_STYLES` (8), `LIGHT_SETUPS` (72), `SPEC_DEFAULTS`, `LIGHT_ROLES`, camera angles |
| `materials.ts` | `MATERIAL_CATEGORIES` (7), `MATERIAL_PRESETS` (77) |
| `wear.ts` | `WEAR_TYPES` (8), per-family and per-category tables, `WEAR_PRESETS` (9) |
| `fuzz.ts` | `FUZZ_PRESETS` (10), data only |
| `lenses.ts` | `LENS_PRESETS` (8), and the loader of `lenses.json`: `LENS_PRESCRIPTIONS` (16), `lensPrescription(key)`, `LENS_CHARACTERS` (8), `COATINGS` (3) and the types of a prescription |
| `lenses.json` | The 16 starting lens prescriptions of the traced-lens mode (research/optics.md §2.3, §5): surfaces (radius, thickness, glass as `nd`/`vd`, semi-aperture, kind, stop, coating), reference focal length, f-number, focus travel, iris defaults, the values the research traced, the patent or book each comes from. Generic names only; one global signed frame, a mirror folds the path (see the header of `lenses.ts`) |
| `bokeh.ts`, `bokeh.json` | `BOKEH_TYPES` (20, the taxonomy of optics.md §1), `BOKEH_NEUTRAL`, `PUPIL_PROFILES`, `bokehType(key)`, `bokehParams(type, variant)`. Each type is a set of thin-lens parameters (blades, roundness, mask id, pupil profile, obstruction, cat's eye, squeeze, CA, swirl, rings, texture), or needs a traced lens (`requires: 'traced'`, `lens` key) or wave optics (`requires: 'wave'`, coming soon). Mask ids are those of `public/assets/aperture/index.json` |
| `camera-moves.ts`, `camera-moves.json` | `CAMERA_MOVE_LIBRARY` (14) and `HANDHELD_PRESETS` (3): product-relative camera moves as lists of the existing animation kinds (degrees, % of the framing distance, part sizes, focal and focus factors; times as fractions of the duration), and the handheld noise parameters. `src/core/camera-moves.ts` expands a move into the clips of the timeline |
| `animation.ts` | `MOVE_KINDS` (15), `EASING_KINDS` (5), `TARGET_KINDS`, `EXPLODE_MODES`, move groups, `SEQUENCE_PRESETS` (16) |
| `doctor.ts` | `DOCTOR_CHECKS` (14), descriptors only |
| `environment.ts` | Studio dome grey levels and bright-field limits |
| `update-feed.ts` | `UPDATE_FEED`: the GitHub repository (`owner`, `repo`) whose releases are the update feed; change it here only |
| `ai-models.json`, `ai-models.ts` | AI post-processing models (files with pinned URLs, sizes and `sha256`, licences, requirements) and the recommendation table (AI-POST.md §2.4); JSON because the desktop launcher embeds it too. Types in `ai-models.ts` |

## Conventions

- Catalogue names (`STUDIO_PRESETS`, `LIGHT_SETUPS`, ...) and catalogue keys
  (`'JEWELLERY'`, `'WRAP'`, `'ALU_ANOD'`, ...) are the upstream ones, unchanged,
  so documentation can reference them. Keys inside objects are camelCase
  (`size_y` is `sizeY`, `coat_roughness` is `coatRoughness`).
- Every user-facing string is a `Label` (`{ es, en }`). Spanish text is ASCII
  without accents, as upstream. The files that are not ported (`ai-models.json`
  and the studio-tools data: `lenses.json`, `bokeh.json`, `camera-moves.json`) use
  proper Spanish with accents, like the interface strings.
- Catalogues are arrays when order matters (UI lists) and have a
  `key` field on every entry; use the `xxxPreset(key)` lookups to find one.
- Wear: the upstream `wear_` prefix is dropped (`wear_edge_color` is
  `edgeColor`, `rough_var` is `roughVar`). The intensity of a wear type is the
  `WearProps` field with the type's own name.

## Azimuth convention

Light azimuths in this directory (`LightSpec.az`, in both studio presets and
light setups) are **relative to the camera axis**, in degrees:

- `0` is behind the camera (the light points the same way the camera does),
- negative is camera-left, positive is camera-right,
- `180` is behind the part (backlight, rim).

`el` is the elevation above the horizon. `dist`, `size` and `sizeY` are in
multiples of the part size, so one preset suits a ring and a sofa.

The default camera sits at world azimuth `CAMERA_AZIMUTH_DEG` (-35) and
elevation `CAMERA_ELEVATION_DEG` (22). The world azimuth of a light is
`az + CAMERA_AZIMUTH_DEG` (`toWorldAzimuth` in `src/core/light-math.ts`); it is
not wrapped to a half-turn, so `-165` becomes `-200`. World space is Z up, and
`polar(azimuth, elevation, distance)` turns the pair into a position: azimuth 0
is on -Y, azimuth 90 on +X.

`LIGHT_ROLES` is the one table that already stores world azimuths
(`azimuthWorld`); it is a generic fallback for a role a rig does not cover.

Levels: a studio preset stores `energy` (watts at part size 1). A light setup
stores `share`, the fraction of the total irradiance; `src/core/rig.ts` scales
the shares so every setup has the same total irradiance as the active studio
preset, which is why changing setup changes the look of the light but not the
exposure.

## Licence note

The values in this directory are data ported by hand from EZPackshot
(https://github.com/Grohle/EZPackshot, GPL-3.0). Both repositories belong to
the same author, who asked for this port. Only the data and the formulas were
carried over, rewritten as TypeScript; no upstream code, node graphs or
operators were copied. Every source file says so in its header.

The studio-tools data (`lenses.json`, `bokeh.json`, `camera-moves.json`, with their
loaders) is not from EZPackshot: it is Repackshot's own (STUDIO-TOOLS §0). The lens
prescriptions are facts re-keyed from expired patents and a textbook, each with its
patent number or book in `source`; no name of a brand, maker or catalogue glass
appears in any key, label or value (`tests/lenses.test.ts` fails if one does).

## Keeping it in sync

Ported by hand from EZPackshot; keep keys stable; counts are pinned by
`tests/data.test.ts`.

Deviations and oddities worth knowing about (values were ported as they are):

- Upstream has 16 sequence presets, not 15 (`CATALOG` has four shots and no
  clips).
- Sequence clips use the target `CAM` (the camera of shot number `shot`),
  which is not one of `TARGET_KINDS`; it becomes an `OBJECT` target once the
  shot cameras exist.
- `FURNITURE_WALK` has a `TRACK` clip with amount 0: a track is driven by a
  vector, which the preset format cannot carry, so as shipped it moves nothing.
- `colorFromPreset` is supported by the maths but no setup uses it. It takes the
  colour of the FIRST light of the preset rig, which is not always the key
  (`JEWELLERY` and `EYEWEAR` start with `TOP`, `PERFUME` with `RIM`).
- Upstream light types also list POINT and SPOT; no recipe uses them and they
  are not ported (`LightType` is `AREA | SUN`).
- The upstream roadmap says the default wear master "sits at 0.30"; the code
  (and so this port) uses 0.45 in `WEAR_CATEGORY_DEFAULTS`.
