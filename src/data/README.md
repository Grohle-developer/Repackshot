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
| `aspects.ts` | `ASPECT_PRESETS` (10, U13): the image aspect ratios a camera is offered (`3:2`, `4:3`, `16:9`, `1:1`, `5:4`, `4:5`, `9:16`, `21:9`, `2:1`, `65:24`) with stable keys, and `CUSTOM` (`w : h` kept on the camera). Logic is `src/core/aspect.ts` |
| `studios.ts` | `STUDIO_PRESETS` (16 product types, 50 lights) |
| `light-setups.ts` | `LIGHT_STYLES` (10: the 16 sets of L6 first, the Interior style of K1 last), `LIGHT_SETUPS` (95: 16 sets, the 72 of the base catalogue, the 7 of Interior), `SPEC_DEFAULTS`, `LIGHT_ROLES`, camera angles |
| `scene-types.ts` | `SCENE_TYPES` (3, K1): Product, Interior and Catalogue with their label, intent and the default values each writes (INTERIORS.md §3.1). Logic is `src/core/scene-type.ts` |
| `materials.ts` | `MATERIAL_CATEGORIES` (7), `MATERIAL_PRESETS` (77) |
| `wear.ts` | `WEAR_TYPES` (8), per-family and per-category tables, `WEAR_PRESETS` (9) |
| `fuzz.ts` | `FUZZ_PRESETS` (10), data only |
| `lenses.ts` | `LENS_PRESETS` (8), and the loader of `lenses.json`: `LENS_PRESCRIPTIONS` (16), `lensPrescription(key)`, `LENS_CHARACTERS` (8), `COATINGS` (3) and the types of a prescription |
| `lenses.json` | The 16 starting lens prescriptions of the traced-lens mode (research/optics.md §2.3, §5): surfaces (radius, thickness, glass as `nd`/`vd`, semi-aperture, kind, stop, coating), reference focal length, f-number, focus travel, iris defaults, the values the research traced, the patent or book each comes from. Generic names only; one global signed frame, a mirror folds the path (see the header of `lenses.ts`) |
| `bokeh.ts`, `bokeh.json` | `BOKEH_TYPES` (20, the taxonomy of optics.md §1), `BOKEH_NEUTRAL`, `PUPIL_PROFILES`, `bokehType(key)`, `bokehParams(type, variant)`. Each type is a set of thin-lens parameters (blades, roundness, mask id, pupil profile, obstruction, cat's eye, squeeze, CA, swirl, rings, texture), or needs a traced lens (`requires: 'traced'`, `lens` key) or wave optics (`requires: 'wave'`, coming soon). Mask ids are those of `public/assets/aperture/index.json` |
| `camera-moves.ts`, `camera-moves.json` | `CAMERA_MOVE_LIBRARY` (14) and `HANDHELD_PRESETS` (3): product-relative camera moves as lists of the existing animation kinds (degrees, % of the framing distance, part sizes, focal and focus factors; times as fractions of the duration), and the handheld noise parameters. `src/core/camera-moves.ts` expands a move into the clips of the timeline |
| `animation.ts` | `MOVE_KINDS` (16, `PHYSICS` from S2), `EASING_KINDS` (5), `TARGET_KINDS`, `EXPLODE_MODES`, move groups, `SEQUENCE_PRESETS` (16) |
| `doctor.ts` | `DOCTOR_CHECKS` (19: the 14 base checks, with the texts of the engine ones rewritten for Repackshot's engine in D1; `simd` after `engine` and `budget` after `output`, D1; and, appended after them, `aspect`, U13, `physics`, S2, and `particles`, S4a), descriptors only; `doctorCheck(key)` also knows those of `doctor-interior.ts` |
| `doctor-interior.ts` | `INTERIOR_DOCTOR_CHECKS` (7, K1): the checks of the interior Doctor, which only run while the scene type is Interior (`src/core/doctor-interior.ts`), descriptors only |
| `wettability.ts` | S3b: `WETTABILITY` (5 families, stable keys: `GLASS`, `PLASTIC`, `METAL`, `PAPER`, `PAINT`), the advancing and receding contact angles of water on each, degrees (◆ typical values); `DUST_REPOSE_DEG`; `FRONT_GLASS_FAMILY`. The front glass uses `GLASS`; the parts use the rest in S3c |
| `front-glass.ts` | S3: the front glass's fixed values, its knobs' ranges and start (`FRONT_GLASS_FIXED`, `FRONT_GLASS_LIMITS`, `FRONT_GLASS_START`); S3b: `GLASS_FEED` (what each ambient effect leaves on a pane fed by the scene) and `MAX_GLASS_SECONDS` |
| `physics.ts` | Physics (S2): `DENSITY_BY_CATEGORY` (kg/m³ by material category), `DEFAULT_DENSITY`, `PHYSICS_DEFAULTS` (friction, bounciness), `FLOOR_SURFACE`, `PHYSICS_LIMITS`, `PHYSICS_ROLES` (4; S9 built cloth, liquid coming soon), `BUILT_ROLES`, `MAX_SIMULATED_SECONDS` |
| `fabrics.ts` | Cloth (S9): `FABRIC_PRESETS` (11, stable keys `SILK` … `NEOPRENE`: weight g/m², stretch N/m, bending N·m, damping, thickness, friction; ◆ proposals), `DEFAULT_FABRIC`, `fabricPreset(key)`, `CLOTH_LIMITS`, `CLOTH_DEFAULTS`, `MAX_CLOTH_TRIANGLES`, `AUTO_DIVISIONS`, `CLOTH_ANCHORS`, `GUST_PER_CHAOS`, `DRAPE_SHEET`, `DRAPE_MATERIAL`. `SILK` and `LEATHER_THICK` are also the engine tests' (`tests/fixtures/cloth-fabrics.json`) |
| `environment.ts` | Studio dome grey levels and bright-field limits |
| `primitives.json`, `primitives.ts` | `PRIMITIVES` (12, U9): the shapes of *Add ▸ Primitive* with a stable key, a role in the studio (`BASE`, `FLOOR`, `BACKDROP`, `OBJECT`) and measures (key, length or count, minimum, step, factor of the scene size or default value), and the neutral material they carry; the names and labels are interface strings and the geometry is in `src/core/primitives.ts` |
| `update-feed.ts` | `UPDATE_FEED`: the GitHub repository (`owner`, `repo`) whose releases are the update feed; change it here only |
| `ai-models.json`, `ai-models.ts` | AI post-processing models (files with pinned URLs, sizes and `sha256`, licences, requirements) and the recommendation table (AI-POST.md §2.4); JSON because the desktop launcher embeds it too. Types in `ai-models.ts` |

## Conventions

- Catalogue names (`STUDIO_PRESETS`, `LIGHT_SETUPS`, ...) and catalogue keys
  (`'JEWELLERY'`, `'WRAP'`, `'ALU_ANOD'`, ...) are stable, so documentation can
  reference them. Keys inside objects are camelCase (`sizeY`,
  `coatRoughness`).
- Every user-facing string is a `Label` (`{ es, en }`). The Spanish text of the
  base catalogue is ASCII without accents. Newer files (`ai-models.json`
  and the studio-tools data: `lenses.json`, `bokeh.json`, `camera-moves.json`, `aspects.ts`) use
  proper Spanish with accents, like the interface strings.
- Catalogues are arrays when order matters (UI lists) and have a
  `key` field on every entry; use the `xxxPreset(key)` lookups to find one.
- Wear: the intensity of a wear type is the `WearProps` field with the type's
  own name.

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

The studio-tools data (`lenses.json`, `bokeh.json`, `camera-moves.json`, with their
loaders) follows STUDIO-TOOLS §0. The lens prescriptions are facts re-keyed from
expired patents and a textbook, each with its patent number or book in `source`; no
name of a brand, maker or catalogue glass appears in any key, label or value
(`tests/lenses.test.ts` fails if one does).

## Keys and counts

Keep keys stable; counts are pinned by `tests/data.test.ts`.

Oddities worth knowing about:

- There are 16 sequence presets: the sixteenth, `CATALOG`, has four shots and
  no clips.
- Sequence clips use the target `CAM` (the camera of shot number `shot`),
  which is not one of `TARGET_KINDS`; it becomes an `OBJECT` target once the
  shot cameras exist.
- `FURNITURE_WALK` has a `TRACK` clip with amount 0: a track is driven by a
  vector, which the preset format cannot carry, so as shipped it moves nothing.
- `colorFromPreset` is supported by the maths but no setup uses it. It takes the
  colour of the FIRST light of the preset rig, which is not always the key
  (`JEWELLERY` and `EYEWEAR` start with `TOP`, `PERFUME` with `RIM`).
- The 72 recipes of the base catalogue use only AREA and SUN lights.
- The default wear master is 0.45, in `WEAR_CATEGORY_DEFAULTS`.
- Woods (E6, the lead's ruling on the wood sheet): `ringDensity` counts
  rings per 100 mm (physical) and its values are each species' own (oak 33,
  i.e. 3 mm); the woods have `ringContrast`, `poreSize`, `poreDepth`,
  `poreBand` and, for bamboo, MDF and ebony, `woodFigure`; ebony has no pores
  and walnut and mahogany half the depth (second ruling). Knots (`knotCount`,
  `knotSize`, `knotSizeVar`, `knotDarkness`; asked for by the user): pine 4,
  cherry and walnut 1, the rest 0.
- Fabrics (E6): `threadCount` counts threads per cm (physical; knit:
  stitches per cm; felt: fibres of `1 / threadCount` cm) and its values are
  each fabric's own (cotton 40, linen 18, twill 36, denim 24, satin 100,
  canvas 14, velvet 30, felt 20, knit 4, mesh 8, microfibre 120, carbon 5
  tows per cm). Denim's weave is `TWILL31` (a 3/1 warp-faced twill; `TWILL`
  is a 2/2). `yarnTwist` (0 to 1, default 1): carbon's tows and the mesh's
  monofilaments are smooth (0). The lead accepted these values on the cloth
  sheet, and chose for carbon a `weaveDepth` of 0.05: its clear coat follows
  the relief, and a deeper one makes the tows read as glossy tubes.
