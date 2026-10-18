# Behaviour specification

What Repackshot does, seen from the outside, and the data model that
supports it. It is the **black-box specification** required by the clean-room
rules of `README.md`: it describes behaviours and workflows,
never how any other product implements them. The ideas come from the normal use
of commercial product renderers (what they do, not how).

---

## 1 · Who it is for and what for

Product designers, product photographers and small studios who
need **a catalogue image or a short animation of an object**
with as little friction as possible. They come from a CAD tool (STEP, exported glTF),
know about photography and do not have to know about rendering. The
success criterion: *open, import, choose a product type,
paint materials, choose light, render*, in ten minutes and without a manual.

The product is a **web application** (and later a desktop one) that
works offline once loaded, uploads nothing to any server and
saves projects in a file.

---

## 2 · The workflow

**Standard mode, by default.** The application opens with everything already set,
as KeyShot does: the *Standard* studio (three-point, studio dome,
reference camera, preview quality, HD) is built before
importing anything, and an imported part without a material receives a default
neutral material. Nothing has to be chosen to start working; the
product types and the rest of the presets are shortcuts on top of that state,
not a requirement.

1. **Import or load the example.** Drag a file (see §5: glTF,
   OBJ, STL, FBX, 3DM, STEP, IGES, 3MF, PLY, DAE, USD) or press *Load
   example part*: an original procedural part, with several grouped
   parts, which lets you see a finished result without bringing anything.
   On import, an inline options sheet (units, up axis,
   centre, rest on the floor, frame, group by, keep
   materials, tessellation quality) with defaults that work.
2. **Scene type, product type and studio.** The **scene type**
   (*Product · Interior · Catalogue*, K1) only rewrites starting values
   (environment, bounces, caustics, floor shadow, transform, samples
   and focal length; `INTERIORS.md` §3.1; *Interior* also the *Midday window*
   light recipe on top of the product type's lights, left untouched, C1)
   and removes no control; switching and switching back
   leaves the project as it was apart from what was touched. Choose one of 16 categories (jewellery,
   watchmaking, fragrance, cosmetics, electronics, appliance,
   indoor and outdoor furniture, footwear, textile, packaging, automotive,
   tool, eyewear, medical, generic). *Create studio* sets up in one
   click: reference size, focal length, aperture, exposure, background, floor,
   shadow, caustics, quality, and a light rig suited to the
   typical reflectance of that category.
3. **Materials.** Choose the level (model, group, part, faces) and click
   or drag a material from the catalogue (86 presets in 7 categories). If
   the target already has different materials, an inventory is offered to ask.
   Edit parameters with photographer's names. Add wear.
4. **Light.** Choose a light setup from the catalogue (95 in 10 styles: the 16 sets of
   L6 first and the 7 interior recipes, K1, at the end), in two groups (L7):
   **Sets**, which build something besides the lights, and **Lights**, which only
   place lights, each with its filters; by its thumbnail and intent; the
   exposure does not change when the setup changes (except in a set, which brings its
   own, and in the interior recipes). If there are already lights, the user chooses what happens
   to them: they are replaced, hidden or added to.
   Fine-tune lights if wanted; place a light by reflection, pointing at
   where the highlight is wanted. **Or build the light from scratch**: add
   own lights (area, point, spot, sun, and the IES profile of a real lamp),
   move and aim them with the *gizmo*, and save the result as an own
   light setup in the library.
5. **Camera and image.** Optics, focal length, aperture, click-to-focus,
   framing, perspective or orthographic; exposure, view transform,
   glow, vignette. Save cameras and studios.
6. **Render.** Quality, resolution, sample or time budget,
   format; *Render* or *Add to queue*. The viewport has two modes,
   chosen with a switch in the header: **Fast** (rasterized preview,
   immediate, for editing lights, materials and framing) and
   **Full** (the engine simulating everything in the viewport, also when moving
   the camera, at lower resolution during the gesture). *Render* always uses
   the full engine, whatever the viewport is set to: it takes the image to
   full resolution and quality and saves it.
7. **Animation** (optional). Shots and moves in plain language,
   presets, block timeline, video.

The **Doctor** keeps watch all the time and fixes with one click what usually
spoils a render: absurd scale, part below the floor, smoothing,
edge bevel, camera clipping, visible lights, and, with the engine in front,
*fireflies*, *denoise*, view transform, output format and time budget.

---

## 3 · Data model

### 3.1 · Scene

A **tree** of nodes. Types: `MODEL` (root of an import), `GROUP`
(assembly), `PART` (mesh), `CAMERA`, `LIGHT`, `FLOOR` (lights and
cameras live outside the tree, in `studio.lights` and `camera.cameras`: see
§3.4 and §3.5). Each node has:
`id`, `name`, `parent`, `children`, `transform` (position, rotation in
degrees, scale; local to the parent), `visible`, `locked`. A `PART` also carries
`mesh` (geometry id: positions, normals, indices, optional uv,
and sharp edges if the importer brings them), `material`
(instance) and an optional `faceMaterials` (triangle ranges → instance,
for the *Faces* level). A `PART` made with *Add ▸ Primitive* (phase
U9) also carries `primitive`: `{ kind, params }`, the shape (stable key
of the `src/data/primitives.json` catalogue) and its measurements in mm; its mesh is generated from that (see *Primitives*, below).

**Part size** (`partSizeMm`): the largest dimension of the model's
bounding box, detected on import and editable. Everything that
has physical scale is expressed in part sizes or derived from this:
camera distance, size and distance of lights, bevel radius, wear
scale. Wood grain and fabric weave are not (E6, the lead's decision):
their rings, pores, fibres and threads have a physical size, the same
on a jewellery box as on a table.

**Resting on the floor**: the lowest point of **all** the target's meshes (not of
a single one) drops to `z = 0`. **Centre**: the centre of the bounding box
in XY at `(0, 0)`.

**Operations on parts, KeyShot style.** On any
selection (model, group or part):

- **Move tool**: *gizmo* in the viewport with translate,
  rotate and scale handles, local or global axes, increments with `Shift`,
  numeric fields in the inspector (position, rotation in degrees, scale
  with proportional lock), and *Reset transform*.
- **Pivot**: centre of the bounding box (default), base of the box,
  file origin, or a picked point; *Set pivot*.
- **Rest on the floor** (the lowest point of all the selection's meshes
  at `z = 0`), **Centre** (XY centre at `0, 0`), **Centre and
  rest** in one action.
- **Hide / Show / Isolate / Show all**, **Lock**,
  **Rename**, **Delete**, **Frame**, **Set as camera
  target** (the camera looks at the selection).
- **Duplicate** (independent copy) and **Duplicate linked** (shares
  mesh and material; changing one changes all), **Group / Ungroup**,
  **Move to group**.
- **Pattern**: linear (n copies at a distance along an axis) and circular (n
  copies around an axis), as linked instances, editable
  afterwards.
- **Materials**: *Unlink material* (the part gets its own
  copy), *Link with…* (several parts share one), *Copy / Paste
  material*, *Select by material*.
- **Geometry**: *Flip normals*, *Smooth shading* (angle), *Edge
  bevel* (radius in mm, shading only), *Separate by CAD faces* and
  *Separate by material* (each range becomes a part).

- **Scale** (phase U9): the *Scale* tool (`S`), the same *gizmo*
  with only its scale handles, and *Right click ▸ Scale…*: uniform (%),
  per axis (X, Y, Z in %) or to size (mm of width, depth or height, with the
  proportion locked), around the selection's pivot and in the
  axes of *Move* (global or local); *Reset scale* gives
  each node back the scale it entered the scene with, around its own
  pivot. To size measures the selection by its vertices projected onto
  those axes (`selectionExtents`).

All are *store* actions, undoable, and those that make sense in
bulk apply to the whole selection.

**Primitives** (phase U9, `src/core/primitives.ts` and
`src/core/primitive-ops.ts`). Twelve parametric shapes, with stable
keys: `BOX` (width, depth, height, bevel radius and its segments),
`PLANE`, `DISC`, `CYLINDER`, `PEDESTAL` (cylinder with a bevel on top),
`SPHERE`, `CONE`, `TORUS`, `CAPSULE`, `TUBE` (outer and
inner radius), `STEPS` (number of steps, rising towards +Y) and `SWEEP`
(infinity sweep: a floor that curves up into a wall at +Y).

- **Geometry**: generated pure and deterministic (the same specification gives
  the same bytes), in mm, Z up, centred in its box (its box *is*
  its measurements: angles that are multiples of 90° use exact sines and cosines);
  closed and watertight except the plane, the disc and the infinity sweep; surface
  normals within each logical face (a sphere is smooth with
  any number of segments) and triangles oriented towards them, facing
  outwards; UV in [0, 1] per face and unstretched (the long side fills the
  square; a revolution side wraps once in u, the caps are
  projected from above, the infinity sweep is unrolled in one go).
  Each **logical face** (the cap, the side, the bevel, each step…) is
  a consecutive range of triangles, stored in `faceRanges`: the *Faces*
  level, M1 and *Separate by CAD faces* use them as CAD faces, and every
  edge between two of them is a sharp edge (`sharpEdges`), as in STEP.
- **Measurements**: they are clamped to what a shape allows (a bevel does not exceed
  half the shorter side, nor the radius or height of the pedestal; the torus tube
  does not exceed the radius; a capsule is at least as tall as it is wide; the
  tube's hole is smaller than the tube; the infinity sweep's curve fits in
  its floor and its wall), lengths to the ten-thousandth of a mm and
  integer segments.
- **Where it is born** (`placePrimitive`): with a product (any part that is not
  a primitive), the scene size is its largest dimension. *Box* and
  *Pedestal* are born as a **base**: under the product, on the floor, with 1.4
  times its footprint (the sides of the box; the pedestal's radius over the
  product point farthest from its vertical axis), a height of 0.15
  (box) or 0.3 (pedestal) product sizes and a bevel of 3 % of its
  smallest measurement, and the product rises until it rests on top, in the same
  action (one undo entry); a locked product does not rise. *Plane*
  (3 times the larger side of the footprint) and *Disc* (1.4 times the footprint) are
  laid under the product. The *Infinity sweep* is **fitted to the active
  camera** (`fitSweep`): rotated in Z to the camera's azimuth (the wall
  facing it), centred sideways on the product, the wall at 1.75 times the
  product's depth behind its centre (further back if the curve would reach
  under the product, and always behind the switched-on lights of the setup
  that are behind the product: at 1.25 times what each one is behind the
  centre plus half its panel, so that the backlight fits between
  the product and the paper; a sun does not count), the width 1.3 times what the output framing covers
  where it touches the background, the height 1.15 times the highest point the framing
  reaches on the wall (and at least 1.25 times the product), the floor out to
  in front of the nearest thing the framing sees of it, and a curve of 0.3
  times the height; the rays through the framing (the optics, the 36 mm sensor
  and the camera's output format; orthographic too) all land
  on it. `scene/fitPrimitive` (*Fit to camera*) redoes it in one
  undo entry. The three are placed a
  thousandth of the size above the studio floor, because a surface
  on the floor acting as a *shadow catcher* would flicker between the two. The
  rest rest on the floor next to what is standing (at +X, at a
  tenth of the size), not counting planes or sweeps. Without a product, the size
  is that of the declared part: the first at the origin (and it then is the
  product: it sets the part size and the camera frames it), the
  following ones beside it. All carry the unedited instance of *Studio
  white* from the catalogue, shared.
- **Live**: `scene/setPrimitive` regenerates the mesh with the new measurements,
  one action and, in a drag, one undo entry; the part keeps
  its resting (the centre of its box's base, on its axes, does not move), linked
  copies change with it, per-face materials and selected
  faces follow their logical faces by name. `scene/convertPrimitive`
  (*Convert to mesh*) freezes it; *Flip normals*, *Smooth shading* and
  *Separate* also freeze it, because its mesh is no longer the one of its measurements.
- **A primitive's mesh is named** `prim:<owner>:<SHAPE>:<measurements>`:
  it names its content and its owner (the node that had it first), so
  linked copies share it and an independent copy has its
  own, even if their measurements coincide.
- **The product, not the set dressing**: the pivot of the light setup, the
  framing of *Create studio*, the part's measured size (and the Doctor's
  scale check) and the preview's shadow map measure the
  product (`productBounds`: the parts that are not primitives; if there are only
  primitives, all of them), so that an infinity sweep six times larger does not move
  the lights or change the scale. *Frame all* still means all.

**Physics** (phase S2, `src/core/physics.ts`; the simulator is the `rt-phys`
crate, in a *worker*). Each node may carry its *Physics* section
(`physics`, optional; without it the default values apply):

- **Role** (`role`): *Static* (default: it is there, does not move and is
  collided against) or *Dynamic* (falls and collides). *Fabric* (S9) and *Liquid*
  (S7) appear in the inspector as *coming soon*. A dynamic group or model
  falls **as one body** (an envelope of all its parts) unless it
  has **As parts** (`asParts`), and then each part falls on its
  own.
- **Mass by density** (`density`, kg/m³): without its own density, that of the
  family of the part's material (`DENSITY_BY_CATEGORY` in
  `src/data/physics.ts`: metal 7,800, plastic 1,100, wood 700, fabric
  400, glass 2,500, emissive 2,500, other 1,000) or 1,000 without a material.
  The mass is the density times the volume of the collision shape.
- Coulomb **friction** (`friction`, 0–2, 0.5 by default; the same
  for static and dynamic) and **bounciness** (`bounciness`, 0–1, 0.2).
  Between two surfaces, the geometric mean of the frictions and the
  larger of the bounciness values; the floor has 0.6 and 0.2.

**What is simulated** (`physicsSpec`). With *Drop*, the selection (of
each branch, the topmost node); with *Start*, the nodes whose role is
dynamic. A locked node does not move and a hidden
part is not there. Everything else visible is static, as a
triangle mesh, and the studio floor (`z = 0`) is always there. Each dynamic
part collides with its **convex hull** (own *quickhull*, at
most 128 vertices; if that is not possible, its oriented box) and a sphere
recognized as such (all its vertices at the same distance from the centre)
collides as an exact sphere. Gravity is −Z, 9.81 m/s², in mm. The
simulation advances at a fixed step of 1/240 s (4 substeps), at the pace of the clock
at most and a few frames (1/8 s) from what the interface has already
received, so on a loaded machine it goes slower instead of finishing
unseen; a body at rest for
0.5 s **sleeps** and, with all asleep, the simulation stops by itself; otherwise,
at 30 simulated seconds (S3b: with the front glass fed by the scene,
which keeps raining, it does not stop by itself; at 120 s; S3c: the same with some effect
on the parts). The same scene gives the same poses on any
machine (pose *hash* pinned in the tests, the same native and in
wasm and with any number of threads).

**What it does in the project.** While it runs, the nodes do not change:
each one has its `PHYSICS` clip (§3.7) that grows frame by frame and
the playhead follows it, so the viewport shows the fall through the
timeline. *Pause* freezes what the viewport shows (what the
simulator sends in the meantime waits for *Resume*); *Stop* confirms the
pose that is seen; falling asleep or the time limit confirm the last
frame. Confirming puts each node where its clip ends (its scale does not
change; inside a group, in the group's axes). The clips, the roles
that *Drop* gives and the final poses are **one** undo entry;
*Reset* removes the clips of the last simulation and returns the nodes to
where they were before, as another entry; undoing while it runs
abandons it without confirming anything.

**Rain, dust and snow on the parts (S3c).** An *Ambient* effect with
`wetParts` falls on the parts when *Start* runs (not *Drop*): what
each one leaves is stated by `src/data/wet-parts.ts` `PARTS_FEED` (*Rain* and
*Water drops*, drops; *Dust motes*, *Pollen*, *Dust cloud* and *Ash*,
dust; *Snow*, snow; bubbles and confetti, nothing). The visible parts
that the simulation does not move get wet (a *Dynamic* one would get wet where it was),
where they are at the start, in world mm, as triangle meshes
(`engine/crates/rt-phys` `wet_parts`, in the S2 *worker*, with its format
`WPT1`); each one with the **wettability** of its material's family
(`src/data/wettability.ts` `wettabilityFamilyOf`: the *Metal*,
*Plastic*, *Glass* category —and an emitter, as glass—, *Wood* and *Fabric* have their own; the
rest, by their recipe: metallic as metal, the rest as paint; S3c adds
wood, 85°/40°, and fabric, 110°/40°, and how long a porous material takes to drink
a drop and how much getting wet darkens it: paper 0.05 mm/s and 1, wood 0.01 and 0.6,
fabric 0.5 and 1). The parts of a **set** (backdrop, floor, cards) do not carry drops
one by one: they get wet as a **film**. Each triangle carries a grid of
samples of at least 1 mm on a side (which grows until it fits in 150,000 samples
in total, of which the set takes a third at most; a sliver, by its
area). For each effect, its density and its mean velocity (wind and fall, in
world axes): through a face of normal `n` pass `density × |v| ×
max(0, −v̂·n)` per mm² and s if nothing in the scene is in between upstream.
**The drops** settle by Poisson on the tangent plane of their point (the
S3b cap with the mesh normal) and, if they arrive fast, **splash**
(Mundo, Sommerfeld and Tropea: `K = We^½ Re^¼ > 57.7`; up to 30 % of their water as two
smaller drops thrown off the surface); they **merge**, stay
**pinned** by Furmidge and **slide** with the tangential gravity from triangle
to triangle (along a crease, down it), with their trail, which wets
the samples it passes over, carries off their dust and takes water from them; a drop that
**hangs** from a face looking downwards **drips** when its weight overcomes
its contact line (`ρ g V (ĝ·n) > 2π a γ sin θ̄`), and one that leaves through
an open edge drips there (S3f: it stops at the edge and hangs, below). **S3f:
organic drops.** A drop that keeps receiving rain grows by merging with what
lands on it and with the drops it touches, and stays pinned until it passes the
critical size of its tilt and of its part's wettability; a sliding drop
**gathers the drops on the path** it swept in each step (and none beside it),
grows and runs faster; a merge **keeps the volume** and the survivor's centre
relaxes to the centre of volume of the two over a few capillary times
(`√(ρ a³ / γ)`), without a jump. Fast enough for its rear contact angle (Cox
and Voinov's dynamic angles) to fall below 0.8 of the receding one, a drop
becomes a **continuous run** and leaves the beads of a rivulet behind it,
elongated along its path, which relax into small pinned drops. Each drop has a
**shape** from its physics (a `DropShape`): stretched along its motion with a
rounder head and a thinner tail as it slides, bulging downhill when it is pinned
on a slope (its front angle towards the advancing one, its rear towards the
receding one, by its load), spanning the two drops with a neck after a merge,
stretched along gravity as it hangs; every deformation keeps its volume. A drop
**held at an open edge** or under a face looking down hangs until its weight
passes what its contact line holds, then necks and lets go of 0.6 of its water
as one drop in the air (Harkins and Brown), the rest staying to grow again.
**S3d: through the air.** A drip (from rest,
or at the speed it was sliding along the edge) and the drops of a
splash (lifted 30° off the surface, at the speed that on a horizontal
face carries them to their reach) are spheres of their volume that fall with
gravity and air drag (at most at their terminal velocity: Atlas,
Srivastava and Sekhon 1973) and settle, in a step after the one they left,
on the first face they meet from the front (they may splash again), or
leave below the lowest part and the studio floor; while they fall they are
in the frames, in the render (bit 9, the `WETF` section) and in *Fast*. Porous
material drinks them. **Dust** settles
as a field (`1 − e^(−k t)` since the last time the rain cleaned it)
and **snow** as a layer that grows and does not slide, both only where the face
is flat enough (dust, 35°; snow, 50°; a ramp of ±5°) and in the
open air. Each frame is recorded in a `PHYSICS` clip of the **scene** (§3.7,
`parts`: the cache), and the render and Fast mode read the playhead's frame:
the engine receives, per instance of a wet part, the `WETP` section (the wetness,
dust and snow of each sample and the drops), bit 8 of its capabilities; an
engine without it is not sent it, and the inspector warns that the render will show
the parts dry. S3d: the drops in the air go in a `WETF` section of the
scene (bit 9), each with the instance of the part it came from; with
bit 8 and without bit 9 the inspector warns that drips and splashes will only
show once they land. S3f: the shapes go in a tail of each `WETP` section (bit
10); with bit 8 and without bit 10 the inspector warns that the render will show
the drops round. In the part and material passes, a drop (on a part or
in the air) is its part. **How it looks**: the film's water as an almost smooth
transparent layer over the material (roughness 0.03) and porous material
darker; dust, a matte brownish grey on top (darker when wet); snow, a
matte white that covers according to its thickness (`1 − e^(−h / 0.5 mm)`); drops,
water caps (index 1.333) on top of the part; those in the air, spheres of the
same water. Without a recording, the parts are dry.
**S3e: moving parts, the studio floor, the set's fine samples, the motes, the
wind.** A part the run moves (*Dynamic*, S2) gets wet where its body takes it at
each step: the rain it meets has the rain's velocity less its own, what is in
the way is taken where it stands, and its drops feel gravity less its
acceleration (in free fall they weigh nothing; the jolt of a landing makes them
slide); dust and snow settle only on the parts that stay. With *Studio ▸ Floor*
on, the **studio floor** under the effects' region gets wet, dusty and snowy as a
film of 2 mm cells, and takes the drips and the drops that fall on it (a wet spot
each: no puddles); the render draws it (bit 11, the `WETG` section) on the
shadow-catching floor: dust and snow where they cover it, the water film's
reflection and the floor darker where wet; *Fast* too. The large triangles of a
set's film parts that a shadow edge crosses take **fine samples** (2 mm), so the
edge of a dust or snow shadow on the set is no coarser; an engine with bit 12
reads them as they are (`WTP2`), one without gets them at 255 steps a side. Where
the dust is thick, the engine draws its **motes**, grains of the dust effect's
size over the layer (bit 13, the motes tail of `WETP`), and *Fast* the same
grains. The **wind** of the rain effects pushes the drops in the air (a drag
towards it, the same terminal-velocity law). A drop that reaches a **sloping open
edge** runs along it while its weight along the edge beats its hold, and stops at
the lowest corner, where it hangs and lets go from rest; a level edge holds it.
With bit 8 and without bit 11 the inspector warns that the floor will show dry;
with a dust effect and without bit 13, that the dust will show without its grains.

**Ambient** (phase S4a, `src/core/effects.ts`, catalogue
`src/data/effects.ts`). **Stateless** air particles: suspended
dust, pollen, rain, snow, dust cloud, ash, rising bubbles and
falling confetti. The project stores `effects: AmbientEffect[]` (0..n; a
project from before S4a opens with an empty list) and each effect is **a
piece of data, not a heap of particles**: its parameters, from which the
engine's simulator (`engine/crates/rt-sim`) derives each particle as a
pure function of (seed, id, instant). No cache and no baking.

- **Fields**: `id` (`fx1`, `fx2`…), `preset` (stable catalogue key:
  `DUST_MOTES`, `POLLEN`, `RAIN`, `SNOW`, `DUST_CLOUD`, `ASH`, `BUBBLES`,
  `CONFETTI`, and since S3 `WATER_DROPS`, *Water drops*; `HAZE`,
  `LIGHT_SHAFTS` and `GROUND_FOG` are in the catalogue
  as *coming soon*, they are S5 volumes), `name` (empty: the preset's),
  `enabled`; the amount (`amountMode` `DENSITY` with `density`
  in particles/m³ of the volume, or `COUNT` with `count`), `sizeMm` ±
  `sizeVar`, `shape` (`SPHERE` point/sphere, `DISC` flake, `CAPSULE`
  streak and, since S3, `DROP` drop: a round body and a tip that
  follows it, against the velocity), since S3 `shapeMix` (`on` and a weight per shape,
  `SPHERE`, `DISC`, `CAPSULE`, `DROP`: when on, each particle picks one in
  proportion to the weights and always keeps its own; when off, or with no
  weight, all are `shape`), `dropTail` (length of the drop, from the centre of the
  body to that of the tip, in body radii, 0..16; 1.6) and `dropTip`
  (radius of the tip over that of the body, 0..1; 0.15) and `shapeVar` (how much
  longer or shorter each drop and each streak is than the others, 0..1; 0),
  `energy` (m/s at birth in a random direction, which relaxes
  towards the fall), `chaos` (strength of the turbulence as a fraction of its
  scale), `turbulenceScaleMm`, `turbulenceSpeed` (m/s), `wind` (vector
  in m/s, Z up), `fallSpeed` (terminal velocity at 1 g, m/s) ±
  `fallVar`, `gravity` (multiple of g; negative rises), `spin` (turns/s
  of a disc), `streak` (length of the capsule: what is travelled in that many
  seconds), the region (`region`: `SCENE`, the product's box with
  `marginMm`, or `BOX` with centre and size; `band`: height band), the
  cloud (`cloud`: centre, radius in mm, softness 0..1; with it, the volume
  is its sphere), the material (`material`: key of the material
  catalogue, or empty and then `ownMaterial`, the preset's; since S4b
  `ownMaterial` also carries `forward` and `forwardG`, the part of what
  each particle scatters that goes into a forward Henyey–Greenstein
  lobe and its asymmetry: 0.5 and 0.7 in dust, pollen and the
  dust cloud, 0 in the others; only with an own, opaque material; an
  effect saved before S4b takes its preset's), `tintVar`
  and `palette` (up to 4 tints), `time` (*Freeze at*, s), `camera`,
  `reflections` and `shadows` (as on lights), `cap` (own cap; 0: the
  engine's), `seed` and, since S3c, `wetParts` (falls on the parts when
  the physics bar runs; only stored when on). An effect saved before S3 opens with the drop and the
  variation of its preset and the mix off. An engine without bit 6 of its
  capabilities (S3) receives a drop as a sphere and a mix as the shape of
  greatest weight.
- ***Store* actions**, all undoable: `effect/add` (an available preset;
  it is born with the preset's values, the region around the
  scene with a margin of 0.75 part sizes and the seed of its
  number), `effect/remove`, `effect/set` (a patch; a drag is one
  entry, and a value it already has changes nothing) and `effect/preset`
  (takes the values of the new preset and keeps where it is, its instant,
  its seed, its cap and its name). Values are clamped when applied.
- **How many particles**: the density times the volume in m³ (the region or the
  cloud's sphere) or the count, and at most the cap: the effect's, and
  never more than the engine's (*Settings ▸ Render engine ▸
  Particles per effect*; automatic: 100,000 in the browser, 1,000,000
  native). The Doctor warns (`particles`) when an effect asks for more than
  its cap, and *Fix* lowers the amount to it.
- **What travels to the engine**: an `FXAM` section per switched-on effect, after
  the lights, with the parameters in engine units (mm, mm/s; the region
  already clipped by the band and never below the floor) and an own material
  after the parts' (its `materialId`). A switched-off effect does not
  travel. The engine evaluates the particles when loading the scene and builds their
  BVH; the passes give a particle the `partId` of its effect and the
  `materialId` of its own.
- **Preview**: the *Fast* viewport paints up to 50,000 particles of
  each effect, the ones `rt_particles_eval` of `rt.wasm` evaluates (the same
  simulator, on the page's thread); without `rt.wasm` it paints the region's box
  and the meter says so. *Full* and *Render* paint them all.

**Section view (Q1).** A plane that removes one side of the part and caps the
cut, to show how the product is made on the inside.

- **Data**: `state.section`, at most **one plane** per project (`null`
  until the person makes one): `enabled` (cut or not; when off, the plane
  is kept), `point` (mm, world, Z up), `normal` (unit, towards the
  side that **is removed**) and `cap` (cap the cut). What remains is what
  is on the side opposite the normal. It is saved in the project: an earlier file
  opens without a plane, and one with a broken plane opens it without.
- **How it is placed** (all through the *store*, undoable): **click on the part + axis**
  (*X*, *Y*, *Z* or *Surface*: the normal of the surface where the
  click is made): the plane passes through the point and is perpendicular to the axis, and the
  side facing the viewer is removed; **two points**: the plane contains the two
  points and the view direction, and what is left of the
  line from the first to the second is removed (the same point twice, or two points one behind
  the other along the view, make no plane and the second is asked for again);
  **numbers**: the point and the normal (the normal is converted to a unit vector
  and one that is nothing is not taken). Also *Flip side*, *Cap the
  cut*, *Remove the plane* and the switch, which without a plane makes the default
  one: through the product's centre, facing the camera, capped. Actions
  `section/set`, `section/patch`, `section/enable`, `section/flip` and
  `section/clear`; dragging a number is one undo entry and what
  changes nothing leaves no entry.
- **What is cut**: the part and everything the person has put in the scene
  (a base, a pedestal), not the **studio**: the backdrop, the floor and the
  cards of a set (L6) are the room, not the model, and are seen whole on
  both sides of the plane. The cuts of **closed solids** (meshes without
  holes, with every edge shared by two triangles and the faces
  outwards) are capped with the smooth colour of their material (no texture or pattern);
  an **open mesh** has no inside: the cut shows its interior, and the
  interface says so (with the parts). A part with a per-face material
  and a thin-walled glass are not capped either.
- **What it does in each viewport**: *Full* and *Render* remove the side of the
  normal for all rays (camera, reflections, refractions and shadows: what is
  removed is neither seen nor casts shade) and cap as described; a cut glass
  refracts through its cap, like a solid glass that ended there. *Fast* paints
  the same with three.js's clipping plane and a cap per closed part;
  a cut glass looks transparent. The selection, the selection box and
  the gizmo do not see what the cut has taken away.
- **Animation**: the `SECTION` move (§3.7).

### 3.2 · Selection by levels

`level ∈ {MODEL, GROUP, PART, FACES}`, mutually exclusive. A click in the viewport
selects the ancestor of the chosen level; `GROUP` on a part without a
group selects the part. `FACES` stores `{part, indices[]}`: a single
part and the indices of its triangles. The selection decides the target
of materials, of *Rest*, *Centre*, *Hide*, and of the inspector. The
selection is volatile state: it is not undone and does not mark the project as
modified.

**Combining with the previous selection** (the same vocabulary in a
click and in a box): replace, **add**, **remove**, and in a click
also **toggle** (put in or take out). In the viewport: no key replaces,
`Shift` adds, `Ctrl/⌘` toggles, `Alt` removes; a click on empty space clears.

**Faces by continuity.** A click at `FACES` level takes a whole face,
not a triangle (`src/core/faces.ts`):

- On a part that comes from STEP or IGES, the **CAD face** that contains the
  triangle (`SceneNode.faceRanges`, triangle ranges): ranges
  always win.
- On any other mesh, the surface that **continues** from the picked
  triangle: adjacency by vertex
  **position** (welding at `1e-5` of the mesh diagonal,
  not by index, because tessellators duplicate vertices at
  seams); an edge is crossed if the dihedral between the triangle being
  left and the one being entered is smaller than the sharp-edge angle (30°) **and**
  smaller than 2.5 times the face's own curvature (the smallest non-flat
  dihedral among the picked triangle's edges **that could be crossed**;
  a flat face has none, and stops at the first rounding; the
  wall of a cylinder has a constant one and is taken whole, up to the
  caps); edges that the mesh marks as hard (`sharpEdges`) are never
  crossed. The single triangle (`Shift`) is taken without growing.
- Known limit: a triangle at the edge of a flat face whose only
  turning edge is a soft rounding (a few degrees per step) is
  confused with a facet of a curved face and the face follows the rounding; in
  the interior of the same face it does not happen, nor with CAD ranges.

**Box selection.** A rectangle dragged on screen takes, at the current
level, what is **entirely inside** (*window*, dragging from
left to right) or what it **touches** (*crossing*, from right to left)
(`src/core/box-select.ts`, all in screen pixels and pure):

- `MODEL`, `GROUP` and `PART`: each node of the level is tested by the
  projected geometry of its parts, first the bounding box and then
  the triangles clipped against the near plane. Hidden parts
  do not count, and **what covers what is not looked at**: a part behind another
  is taken too, as in any CAD. A window takes a group or a
  model when **all** its parts fit; a crossing when **any**
  touches.
- `FACES`: whole faces (CAD or by continuity) of **one** part
  (the selected one or, if none, the one at the centre of the box) that
  are **seen** in the rectangle; with *X-ray* the hidden ones too, by
  geometry. A window takes a face only if all its triangles
  fit.
- It combines with the previous selection: replaces, adds or removes. A
  drag of a few pixels is a click, not a box.

### 3.3 · Materials

A material **instance**: `id`, `name`, `preset` (origin key or
`null` if it is its own), `family`, `category`, `params` (those of the catalogue,
all editable), `wear` (the wear fields), `textures` (the
image textures and the labels: below), `bevelRadiusMm` and, in
*Nodes* mode, `graph` (a node graph: below).

**Image textures** (phase M2a, `src/core/textures.ts`). `textures`
has six **slots**, each empty or with an image: `color`,
`roughness`, `metal`, `normal`, `alpha` and `emission`; a **common
mapping** (`mapping`) and the **labels** (`labels`). Each slot carries the
image (`ImageRef`: id, name, width and height), its own mapping or `null`
(it uses the common one), and how it reads the image: `channel` (R, G, B, A or L,
luminance; the scalar ones —roughness, metal, alpha— read one channel: glTF
packs roughness in G and metal in B), `invert` (1 − value: a gloss map
as roughness), `strength` (normal: how much it bends the normal, glTF's
`scale`; emission: the radiance multiplier), `height`
(normal: it is a height map, a relief map, with `strength` in mm of
relief of white, and not a tangent-space normal map), `cutout` and
`cutoff` (alpha: hard cutout at the threshold, glTF's `MASK`; without it, the
value is a coverage that blends) and `tint` (emission: the linear colour that
multiplies the image, glTF's `emissiveFactor`). The image
**multiplies** the parameter's value (colour × base colour, roughness ×
roughness, metal × metal, alpha × opacity), the glTF rule, so that an
imported material is the file's; emission is **added**: tint ×
image × intensity, in radiance (1 is white at exposure 0, like the
engine's film). On an emitter (family `EMISSIVE`) the colour slot
tints what it emits.

The **mapping**: `projection` (`UV`, `BOX`, `PLANAR`,
`CYLINDRICAL`, `SPHERICAL`), `axis` (X, Y, Z: the axis
the planar one looks along, the cylinder's, the poles'), `uvSet` (UV:
the mesh's first set or the second), `sizeMm`, `rotationDeg`,
`offset`, `repeat` (in u and v) and `wrap` (outside the image: *repeat*,
*stretch the edge* or *mirror*). Conventions, which are the contract with the
preview and with the engine (M2b): texture coordinates have **v
upwards** and (0, 0) is the bottom-left corner of the image (the
convention of OBJ, FBX, Collada and USD; glTF's v goes down and its reader flips
it); a texel is read at column `u·width` and row `(1 − v)·height`
of the rows from the top. Projections work in the part's own space
(its mesh coordinates, mm, Z up): the texture moves,
rotates and scales with the part, and a shared material lands the same on each
part that carries it. *Planar* looks along its axis (Z from above, Y from
the front, X from +X); *Box* blends the three by |n|⁴ (a face
perpendicular to an axis takes only that axis, a 45° bevel half and half) and
seen from outside no face comes out mirrored; *Cylindrical* wraps once
per repeat with the centre of the image in front (−Y for the Z axis);
*Spherical* goes from pole to pole. Then, the rotation and the repeat:
`uv = R(rotation)·(c ⊙ repeat) + offset` (plus ½ in the
projections, which centre the image on the part's origin).

**Why the size is in mm and not in part sizes**: an image
texture is the photo of something with a size of its own (grain, weave, carbon, a
label) that does not depend on the part; the material is shared between parts
of different sizes and travels in the library to other products, and must
land the same on all of them; the engine works in mm. `sizeMm` is what one
repeat of the image occupies across (its height follows the image's
proportions; in the cylindrical one it is the circumference it is
drawn for, which sets its height). The first image of a material that has none sets
`sizeMm` to the part's size, so that it is seen whole at once;
*Fit to part* does it again with the larger side of the parts that
carry it; it is an option, and the size written by hand is those same
millimetres. The procedural one does not follow the part either (decision 5.1, C1): wood
grain and fabric weave have a physical size in mm, the same
on a jewellery box as on a table (§3.1, E6), and wear keeps its reference
scale in metres (`wear.refSize`), which is set from the part's size
when the material is created and does not change if the part changes.

**Labels**: images with alpha placed on the part with a
planar projection along the normal of the point where they are placed: `origin`,
`normal` and `uAxis` (the right of the unrotated image) in the part's
own space, `widthMm` (the height follows the image), `rotationDeg` (about
the normal, counter-clockwise seen from outside), `depthMm` (how far
it reaches in front of and behind its plane; 0, half its longer side) and its
finish where it covers: `roughness`, `coat` (varnish) and `relief` (how much
the paper edge stands proud). It covers its rectangle, within its reach
of its plane and only on the surfaces facing its side. Several per
material, in order (each over the previous ones); like the projections,
they live in the part's space: a shared material carries them on each
part (KeyShot's behaviour; for a single part, *Make it my own material*).

The **images** live in the registry (`core/images.ts`) as the
PNG or JPEG file they were, with an id that names their content (`tex:` and 16
digits of their SHA-256): the same image in two materials, or imported twice,
is one. Limits: 16 MB and 8192 pixels on a side per image, 64 MB of
textures per project. Every edit of slots, mappings and labels is
a *store* action (`texture/*`), undoable (a drag, one
entry), and makes the material its own. The library stores the
mapping, not the images.

**In *Full* and in *Render*** (phase M2b) the engine paints the slots and
labels in the same place as *Fast*, with the same projections, the
same size in mm and the same composition (the engine says it reads them and the
interface sends them with their pixels; an earlier engine does not receive them). What
changes is what the tracer does better than the preview, and is
stated: filtering is the ray's (*mipmaps* by the footprint of a quarter
pixel, and the average of the pixel's samples); it draws all the labels,
not the first six; alpha cutout also cuts shadows; the
paper of a label is opaque (on glass you do not see through it); an
emitter whose image changes its light looks the same but is not sampled as a light
(more noise in what it lights, no bias); and caustic photons
see the material without textures. A texture's size does not follow the solid's
(`TRIAGE.md` 5.1, decided in C1): it is in mm, as above, and
*Fit to part* adjusts it when asked.

**Material graphs** (phase M3a, `src/core/material-graph.ts`; the
contract with the engine in `ARCHITECTURE.md` §5.2 quater). A material can
be **Simple** (the parameters of its family) or **Nodes**: it then carries
`graph`, a **directed acyclic graph** of nodes from the catalogue
(`src/data/material-nodes.ts`, stable keys) and connections from an output
socket to an input socket. One of them, the **Material output**,
receives at each point what the material is there: *base colour, metal,
roughness, anisotropy, clear coat, coat roughness, transmission, IOR,
subsurface, emission* (colour) *and emission strength, opacity,
normal, bump height* (a height in mm that bends the normal) and *bevel* (a weight
0–1 of the material's bevel radius, which remains a single one: the Doctor
looks at it); and as parameters of the material, not of the point, the *absorption
distance* and the *thin walls* (those of glass). The other nodes:
*Image texture* (a PNG or JPEG from the registry, sRGB or data, repeat,
clamp or mirror; colours and alpha), *Mapping* (the M2a projections,
UV, planar, box, cylindrical, spherical, and also *Object*, the part's
3D coordinates; size in mm, rotation, offset, repeat), *Noise*
(Perlin or simplex with scale, octaves, lacunarity, roughness and seed:
value from 0 to 1 and colour), *Gradient* (linear, quadratic, eased,
diagonal, spherical, radial), *Checks*, *Stripes* (width and softness),
*Colour ramp* (up to eight stops, linear, eased or constant),
*Mix* (mix, add, multiply, subtract, screen, difference, lighten,
darken, overlay), *Maths* (add, subtract, multiply, divide,
multiply-add, power, minimum, maximum, smooth minimum and maximum,
smoothstep, absolute value, less than and greater than, integer and
fractional part, sine), *Fresnel / layer weight* (the dielectric Fresnel of
an IOR and a *facing* ramp), *Curvature* (edges and cavities, which the
engine measures), *Value*, *Colour*, *Separate RGB* and *Combine RGB*, *Invert*,
*Normal map* (tangent or part space) and *Bump*. And (M3c) the
patterns of the families as nodes: *Wood* (the procedural wood of the
*Wood* family, E6: rings with their spring and summer colours,
rings per 100 mm and scale, contrast, variation, wander and axial
noise, colour noise, pores in mm with their depth and their band, figure
—rings, bamboo strips, MDF speckle, ebony streaks— and knots with their
number, size in mm, variation, darkness and seed) and *Fabric* (the fabric of
the *Fabric* family: warp and weft, weave, threads per cm, weave relief, yarn twist
and fuzz). The same parameters, with the same
keys and in the same units as the family, give the same pattern; they read
the part's point in mm (or whatever is connected to them) and the normal, and give
colour, roughness (that of its input times that of the pattern), anisotropy (along
the grain; across the thread on top), the normal bent by its
relief and its height in mm; *Fabric* also gives its *fuzz* (a number, which
neither the engine nor the material output reads yet). Wood is placed on
each part like the family's: the pith along the longer side of
the part's box, and the knots in it without grazing its surface.

**Sockets** have a type: number, colour, vector or normal (drawn with
a shape per type: circle, diamond, square, triangle). A connection
converts a number into a colour or vector by itself (the three components equal),
a colour into a number (its Rec. 709 luminance) or into a vector, a vector into a
number (the mean) or into a colour, and a normal into a vector; **a normal only
comes from a normal** (a colour is converted into a normal with *Normal
map*), and a connection that would close a cycle or that goes from a
node to itself is rejected, saying why. An unconnected input reads its own
value; those that have none read a source from the point: the normal, the mesh's
UVs (the image) or the part's coordinates per 100 mm (the
procedurals; the part's point in mm, the *Wood* and *Fabric* nodes). What
does not reach the output does not count.

**Simple ↔ Nodes**: switching to *Nodes* gives the **minimal graph**, the output alone
with the material's values (what the engine and the preview read from
its parameters), and leaves the parameters as they were; a wood or a fabric
(M3c) also gives its *Wood* or *Fabric* node with the family's parameters,
connected to the output's colour, roughness, anisotropy and normal,
so the graph paints the same as the material. Going back to *Simple* is
immediate when the graph is minimal (the output alone, without connections, with
values that a family stores exactly: the material's own, which come back
as they were, or those of a simple, glass or emitter material) or is the
*Wood* or *Fabric* node connected to the output as the switch to *Nodes* leaves it
(the family comes back with the node's values, if its seed is the material's);
otherwise, it asks, and on accepting it keeps the output's own
values. The
**M2a textures and the labels** remain a layer over the
material in both modes: in *Nodes* they multiply what the graph gives as
parameters multiply in *Simple*.

The graph is saved inside the material (`graph`, with its `version`, 1);
the images of its image nodes travel in the project's image block,
and the library stores the graph without them. Every edit (node,
connection, parameter, value, move, duplicate, delete, an example) is a
*store* action (`graph/*`), undoable, one entry each (a
drag, one), and makes the material its own. Limits: 256 nodes, 512
connections, and those of the program (2048 instructions, 256 registers of each
type, 16 images): a graph that exceeds them is not compiled and the editor
says so. **Ten examples** (`src/data/material-graphs.ts`): plastic with a
label, brushed metal with scratches, marble, leather, wood with two
noises, glass with Fresnel dirt, checks, metallic paint with
flakes, glazed ceramic and stripes.

**How it looks.** In *Fast*, the graph's program is evaluated into
512 × 512 maps (colour, roughness, metal, opacity, normal, emission) that the
preview paints through the M2a slots: in the UV square if it only reads
UV; on the surface of its projection (a plane, a face of the box, a
cylinder, a sphere) if a single projection feeds everything, and then
it is what the graph gives; if it reads 3D coordinates, in a slice through the front
of the part set as a box projection (a 3D noise is seen as its slice).
What does not fit in maps is approximated or omitted, and the inspector and the editor
say so: Fresnel and *facing* at 60° from the normal, curvature as 0, and
outputs without a slot (clear coat, transmission, IOR…) with their mean value. In
*Full* and in *Render* the engine runs the graph at each point (phase M3b):
its filtered images, Fresnel and *facing* with the real view, curvature
on the part's sharp edges, the bevel weight, the cutout
also in shadows; subsurface is not read, and an emitter whose
emission changes across the surface lights through the rays that hit it (it is not
sampled as a light). An engine earlier than M3b receives the mean value of each
output over a sphere of samples. The inspector and the editor say so.

**Edge bevel** (`bevelRadiusMm`, E6): radius in mm of a rounding
that the engine draws **in the shading only** (the geometry does not change):
near the mesh's sharp edges (more than 20° between faces, and open
borders), the normal turns like that of a circular rounding of that radius
tangent to both faces, so the edge catches light in reflections and in
shadow like a truly rounded edge. It works for convex and concave edges, corners (like a
box rounded by a sphere) and curved edges; it never changes the normal further than that radius from an edge; where a
part is thinner than about two radii, the rounding is adjusted to what fits.
It belongs to the material (all families except the emitter, which has none); a new
instance of a preset carries 0.25 % of the part's size (the
Doctor's fix). *Full* mode and renders draw it; the *Fast*
view shows the sharp edges. Technical detail: `ARCHITECTURE.md`
§5.2 septies.

Families and what they mean for the engine:

| Family | Model | Own parameters |
| --- | --- | --- |
| `SIMPLE` | Physically principled BSDF: base, metal, roughness, clear coat, anisotropy, subsurface, opacity | — |
| `GLASS` | dielectric with transmission, IOR, roughness, absorption colour: the colour is what white light keeps after `absorptionMm` millimetres inside the part (0: surface tint); with `walls` `THIN`, a thin wall without an interior (sheet, bulb, visor modelled as a surface), which lets light through straight. With `scatterMm` above 0 (E9), the solid is filled with a scattering medium: translucent plastic, wax, soap, milk, juice; `scatterMm` is the mean free path in mm, `scatterColor` what each bounce keeps of each colour (the albedo) and `scatterG` where the light goes at each bounce (Henyey–Greenstein, from −0.9 backwards to 0.9 forwards). Full mode does the random walk inside the part; Fast approximates it with a translucent diffuse. With `abbe` above 0 (E9c), solid glass without a medium splits light into colours (chromatic dispersion): it is its Abbe number, the lower, the more it splits (crystal 30–40, window glass about 60); Full mode refracts each wavelength with its own index and Fast uses three.js's dispersion | `ior`, `transmission`, `absorptionMm` (50), `walls` (`SOLID` · `THIN`), `scatterMm` (0), `scatterColor` (white), `scatterG` (0), `abbe` (0) |
| `WOOD` | procedural grain (E6): two colours (spring and summer) with the species' contrast, rings per 100 mm (physical) and their scale, ring variation and meander, axial and colour noise, fibre, pores (width, depth, in rings or diffuse), the figure (rings, bamboo strips with their bundles and nodes, MDF speckle, ebony streaks) and the knots of woods with rings (how many per part, 0–12; diameter in mm, 5–40, ± variation; darkness), placed according to the material's seed. The *Fast* view bakes it by the same path as the *Wood* node (M3d: the graph that *Simple → Nodes* gives, in a slice through the front of the parts projected onto each face): its rings and pores, the same pixels as the wood turned into nodes; the knots, since M3e, are not in the bake but on top, on each part where the engine puts them (wood turned into nodes, the same); without the baking *workers*, its mean colour and where the knots fall | `woodColor1/2`, `ringDensity`, `woodScale`, `ringContrast`, `poreSize`, `poreDepth`, `poreBand`, `woodFigure`, `knotCount`, `knotSize`, `knotSizeVar`, `knotDarkness`… |
| `FABRIC` | procedural weave (E6): two thread colours (warp and weft), weave (plain, 2/2 twill, 3/1 denim twill, satin, canvas, knit, felt), threads per cm (physical, 2–200: those of each fabric in the catalogue), relief; fuzz (the *Fast* view draws it as *sheen*; the engine not yet). The *Fast* view shows the weave's mean colour, except, since M3e, when a thread (`10 / threadCount` mm) takes up at least 2.5 texels of the 512² bake on the material's parts: then it bakes it through the *Fabric* node (the *Simple → Nodes* graph, like the M3d wood), with the fuzz on top | `threadColor1/2`, `weave`, `threadCount`, `weaveDepth`, `fuzz` |
| `EMISSIVE` | emitter: blackbody at a temperature or colour, power | `emitKind`, `temperature`, `emitPower` |

**Energy** (E9a): in Full mode materials do not lose light with
roughness. A white metal, a clear glass or a white plastic, with
or without clear coat and with any roughness, come out white in a uniform
environment (±1 %): light that bounces several times between microfacets
comes back, and the diffuse layer receives exactly what the gloss does not reflect.
With roughness 0, metal and glass do not change; plastic gains the
8.6 % that its diffuse layer used to lose (ior 1.5).

**Wear**: eight types (edges, scratches, fingerprints, dust, dirt in
cavities, patina, roughness micro-variation, dents), each
with its own amount and controls, a master control, scale in part
sizes, seed and per-part variation. Each preset brings its physics (copper
takes verdigris, gold does not). Nine one-click basics. Types
that make no sense in a family do not exist for it.

**Thumbnails**: a sphere with the material, rendered by the product
itself and cached; never static images that lie.

**Assigning, and dragging a material** (`material/assign`, a single action
and one undo entry, also when the target is several parts):

- **Target**: nodes at any level (the action reaches all the
  parts that hang from them) or **faces** of a part (triangles, through
  `faceMaterials`). A click on a thumbnail assigns to the
  selection; dropping it on something assigns to what **a click there would
  select** at the current level (part, assembly, model or the whole face under
  the cursor), or to the tree row and everything that hangs from it
  (`src/core/material-drop.ts`).
- **Source and what is assigned**: a catalogue preset or an element of
  *Mine* enters with the **instance the scene already has** (created if there is
  none; the same one a click gives, so dropping and clicking leave the
  same project); an instance (the sphere of the selection's material)
  **links** the target to that instance, which it shares with the parts
  that already carry it; with **copy** (`Alt` on drop), whatever the
  source, the target receives an instance **of its own**, shared with
  no part outside: editing it changes nothing else.
- **Mode**: `REPLACE` replaces what was there and `KEEP` only fills in where there is
  no material; if the target carries different materials, the interface
  asks first (`UI.md` §4.1) and nothing is assigned until it is answered.
- **No changes, no entry**: assigning what the target already carries
  returns the same state (no undo entry). Instances
  left unused are pruned as usual.

### 3.4 · Light

The **active rig** is a list of resolved lights (`LightInstance`:
role, type, shape, size, azimuth and elevation relative to the camera,
distance, spread, colour, power, visible in reflections, visible to
camera, on). It comes from `studioRig(type)` or `setupRig(type, setup)`
and can be edited light by light; editing it sets `modified`. Changing the
product type rebuilds it; changing the light setup, according to what is chosen
for the lights that are there (L7, below).

**Normalisation**: the total irradiance of an applied setup is made equal to
that of the product type's rig. Changing the setup does not change the
exposure.

**Sets** (phase L6). A light setup can be a **set**: lights plus what the
product reflects and what it rests on. `LightSetup` gains optional fields
(the 72 earlier setups have none and resolve to exactly the same
rig as before): `backdrop` (`FLAT` background colour; `GRADIENT` two
colours, top and bottom of the framing, which the engine receives as a generated and stretched
background image; `SWEEP` the U9 infinity sweep in matte paper
of the colour, which receives light and shadow), `pool` (the pool of light on the backdrop
behind the product: `az`, `el`, `cone`, `share`, kelvin or colour), `floor`
(`CATCHER` the shadow catcher; `MATTE` matte of one colour; `GLOSSY` and `MIRROR`
a catalogue material under the product, with its `roughness` if it
has one), `cards` (cards: planes of *White card*, *Black card* or
brushed aluminium as a silver card, with `az`, `el`, `dist`, `size`,
`sizeY` and rotation, facing the product), `exposureEv` (offset from the
product type's base exposure), `envStrength` (the dome while
the set is in charge), `camera` (`el`, `focalMm`: suggested, not applied by itself),
`hero` (the object of its thumbnail), `why` (the photographic reason, two
sentences, in the help of its thumbnail) and `caustics`. The 16 sets are the
`SETS` style, the first of the catalogue.

- **Applying a set** (`studio/setSetup` with its key) is a single undo entry:
  its lights (normalised like those of any setup; the
  pool takes its `share` of the level and the lights split the rest),
  its look (backdrop, dome, the type's base exposure plus the offset; floor
  and shadow on) and its **dressing**: first the sweep (if the
  backdrop is `SWEEP`, or if it is `FLAT` or `GRADIENT` with a pool, which needs
  a wall to fall on), fitted to the active camera like the U9 one; then
  the floor; then the cards; then the pool. A scene with nothing of the
  user's receives the lights and the look; the dressing arrives with the
  product (`studio/fitSet`, which the interface requests when loading the example and on
  import, in the same undo entry).
- **The floor.** Matte on a sweep is the sweep itself. Glossy or
  mirror on a sweep is the sweep's *floor* face in that material
  (seamless); if there is also a pool, a sheet over the sweep that
  stops at 55 % of the way to where the pool falls (the pool falls on paper
  and the sheet reflects it). Without a sweep, a plane the size of the floor that the
  sweep of that camera would see, with the background (colour or gradient) behind
  its edge, through the shadow catcher. The **glossy** floor is
  acrylic with a slight haze (`roughness` 0.12: it blurs what it
  reflects a little, it is not a mirror); the **mirror** is a mirror. *Backlit liquid*
  carries its sheet at 0.2: the backlight's reflection is a soft glow.
- **Strips on a glossy floor.** In sets with a `GLOSSY` or
  `MIRROR` floor, the specular image of each strip (a reflected panel at
  least four times longer than wide) in the floor plane, seen with
  the set's camera (or the reference one at 85 mm), falls behind the product's
  footprint or outside the framing: a test checks it with three product
  shapes and two proportions; the design rule, otherwise, is to raise the
  strip in steps of 10° at distance 3.
- **The pool** falls where the camera sees the backdrop just above the
  product: its ray through the top of the product's box, on its farthest side,
  over the sweep. That makes a halo that peeks out behind the product at
  any camera height. The light is aimed from behind the product
  (the set's `az` and `el`, at 0.75 part sizes from the pivot) and placed on
  that line so close to the paper that its light, which falls off with angle and
  distance (to half at 37.5° from its axis), draws a pool as wide as
  the set's cone would draw it at 2.5 part sizes (`POOL_THROW`). Its
  cone is 150° and soft from the axis: the pool has no edge. Its
  power makes its `share` of the level arrive at its centre, measured at that
  distance and facing the paper (it compensates up to 72° of incidence). It is not
  seen by the camera or in reflections.
- **The cards** face the pivot, with the width parallel to the floor; one
  that would go through the floor is raised without rotating until it rests on it. By
  construction they stay **outside the framing**: a test checks it for
  each card with the focal length of the 16 product types, three product
  shapes, three output proportions and the set's camera.
- **Set dressing.** Each piece carries `setPiece` (`CARD`, `BACKDROP`,
  `FLOOR`; the pool, in its light) and is dressing: it does not count for the
  part size, the rig's pivot or *Frame* without a selection, and the
  Doctor does not look at it. Applying another setup replaces it (the
  user's pieces, primitives included, are not touched); a setup that is not a set
  removes it and gives back the product type's backdrop, dome and exposure;
  **Reset setup** removes it and gives back the set's lights as
  they were; *Create studio* with a set in force puts it back,
  fitted to the new framing. Choosing the set again brings it back.
- **Use the set's camera** (`studio/useSetCamera`): the elevation and
  focal length it suggests, the product framed again and the sweep, the
  floor and the pool fitted to the new view (the cards do not
  move); one undo entry; it does nothing with the camera locked.
- **Product types are sets.** 15 of the 16 product types are a
  set (`StudioPreset.set`, `PRESET_SETS`): their lights are the set's, at the
  irradiance level the type had (setups that normalise to
  it do not change), and with their own rig (the setup *The product type's*,
  `PRESET`, which is the one of *Create studio*) they also bring the
  set's dressing and look; the set's exposure offset is
  added to the type's `exposure`, and any other setup starts from the
  exposure from before (`baseExposure`, `setupExposure`). The floor and
  shadow are the type's. *Outdoor furniture* keeps its sun: it is not a
  set.

**Sets and Lights** (phase L7). The catalogue is seen in two groups, without changing
any key, style or order (`core/setup-groups.ts`): **Sets**, the entries
that when applied put dressing in the scene (`hasDecoration`: backdrop, floor,
pool or cards), and **Lights**, the rest (lights only; they may choose world,
exposure and environment intensity, like the interior recipes and the three
sun setups, but dress nothing). `PRESET` belongs to the group of the product
type in force: *Sets* if the type is a set (15 of 16), *Lights* with
*Outdoor furniture*. With a type that is a set: 17 *Sets* and 78 *Lights*; with
*Outdoor furniture*, 16 and 79 (a test pins it and checks, applying each
entry, that a *Set* leaves dressing and a *Lights* one does not). Filters, which
combine (AND) like the filters of a plugin's recipes (P6b): *Sets* by **product
type** (the types whose `StudioPreset.set` is that set, and `PRESET` by the type in
force) and by **subject** (`hero`); *Lights* by **style**. The entry in
force that the filters leave out is still shown, marked.

**The lights that are there** (L7). `studio/setSetup` and `studio/applySetup` carry
`previous` (`REPLACE`, `HIDE`, `ADD`; `core/previous-lights.ts`) and
`keptNames`. *Replace* (or none) is as always. *Hide* and *Add*,
with lights that are not dressing (`previousLights`), keep them after
those of the new setup: with their `id` (an animation clip or the selection that
points at them stays valid; a new light with a taken `id` takes another), `own`
(they are not the setup's: *Reset setup* removes them) and a name that says
where they come from; *Hide* leaves them with `enabled: false`, the switch of the
*Lights* list, which already existed (the project format does not change and
earlier projects open the same), and *Add* as they were. `modified` stays
set. A **set** that comes in replaces the previous one's dressing whatever the
choice (a scene has one set); a **Lights** setup with *Hide* or *Add* leaves the
dressing, the pool light and the set's look as they were, and an interior recipe puts its
look on top. One undo entry, with the choice in its name. The interface asks unless
the `light.previous` setting (*Ask* by default) remembers an answer; it does not
ask without lights or when choosing the setup in force again.

**Interior recipes** (phase K1, `INTERIOR` style, the last of the catalogue).
Seven setups (*Morning window*, *Midday*, *Afternoon*, *Overcast*,
*Night lamps*, *Blue hour*, *White studio room*; keys
`INT_WINDOW_MORNING`, `INT_WINDOW_NOON`, `INT_WINDOW_AFTERNOON`,
`INT_OVERCAST`, `INT_NIGHT_LAMPS`, `INT_BLUE_HOUR`, `INT_WHITE_ROOM`) that are
sets **without dressing**: they choose their world (`SKY` with a sun light that places the
sky's sun, or `STUDIO`) and bring `exposureEv` and `envStrength`, but not
`backdrop`, `floor`, `pool` or `cards` (`hasDecoration`), so they leave the
floor, contact shadow and background as the scene had them and, when leaving them
for another setup, do not restore a background they did not put. Their lights are
normalised to the product type's level like those of any setup; a recipe
that mixes a sun with panels carries *shares* on the scale of
`specIrradiance` (a sun counts its irradiance and a panel its watts over
4π d²). Their figures are a proposal pending a decision (`ROADMAP.md` K1).

**Own lights, KeyShot style** (phase L4). Besides the setups, **lights can be
added** from the *Lights* tab (*+ Add light ▸*), from
*Add ▸* in the header menu, from the viewport's right click on empty space and
from the palette: **Area** (rectangle, disc or sphere, with size), **Point**
(radius), **Spot** (cone angle and transition), **Sun** (disc
angle) and **IES…** (a photometric profile file, phase L5: see *IES lights*,
below). Stable keys: `RECTANGLE`, `DISK`, `SPHERE`, `POINT`,
`SPOT`, `SUN` (`NEW_LIGHT_KINDS`) and `IES` (a light type, which needs its
file: it is born from `studio/addIesLight`). A new light is born **in front of and above the part** as
the active camera sees it (25° to its right, 40° elevation, 50° for the sun,
at two part sizes from the pivot), switched on, **selected** and with the
**mean irradiance** of the switched-on lights (a sun, π times that mean: see
*Units*), so the image does not jump. It is a single undo entry.

- **Where it lives.** Each light is a `LightInstance` of `studio.lights` (those of the
  setup and the user's own in the same list, `own: true` on the own ones), not
  a tree node: it is the list that the preview, the engine, the
  animation, the Doctor, the studios and the library already read, so an own light
  can be animated, saved in a studio and enters *Save setup as…* with
  nothing more. Its **own transform** is its position around the setup's pivot
  (`az`, `el`, `dist` in part sizes, like a recipe light), its **target** `aim` (in part sizes from the pivot;
  absent, the pivot: where all the setups' lights aim) and its
  **roll** `roll` (degrees about its axis; 0, the panel's sides
  parallel to the floor). All in part sizes: the light follows the product and
  works for a ring and for a sofa.
- **It is moved and aimed** with the *Move* *gizmo* (see *Lights and cameras
  in the viewport*, below), with the inspector fields (azimuth, elevation and
  distance; or X, Y, Z in mm, which move it without changing where it aims), with
  **Aim at…** (the product's centre, a picked point, the centre of a picked
  part; and, from a part's context menu, *Aim a light
  here ▸*), **by reflection** or **onto a surface** (click on a part: the
  light ends up on that point along the normal, at the distance
  it was from its target, and aims at it).
- **Properties**: name (by default, the role if it belongs to the setup or the type if
  it is its own, numbered), type, shape, size (width and height; diameter of the
  sphere; radius of the point and the spot), spread (area), cone angle and
  transition in % of the half-angle (spot), sun disc, roll, colour
  temperature or colour, **power in watts** with its **equivalent in lumens** (or
  lux for the sun) as an auxiliary line, *visible in reflections*, *visible to camera*,
  ***casts shadow*** (without it the engine does not trace its shadow rays) and
  on. *Duplicate* (an own copy, 15° to the side, selected) and
  *Delete* work for the setup's lights and the own ones.
- **Units.** Those of the setups (watts at part size 1, in the
  Cycles sense; W/m² for the sun). For the new types, which no recipe
  has, **a point or a spot of P W is as bright on its axis as
  a panel of P W facing the product at the same distance**: isotropic
  flux `π · P · S²` for the engine (S, the part size in metres) and
  intensity `P · S² / 4` (S in mm) for the preview; a spot
  is the point it would be without its cone (its axis does not change brightness
  with the cone). Thus the measure used to normalise setups
  (`specIrradiance`) is the same fraction, 1/π, of what arrives for panels,
  points and spots, and a setup that mixes them keeps its balance. An area
  sphere is a point with a size. The **lumens** are the flux given to
  the engine (narrowed by a panel's spread; the part of its
  cone for a spot) times 683 lm/W and times the colour's luminance: the
  convention of RGB renderers, not the efficacy of a lamp.
- **Save setup as…** saves the switched-on lights (with their type, shape,
  target, roll, transition and shadow) to the library; applied to another
  product type it is normalised like those of the catalogue: the total irradiance
  is that of that type and each light keeps its share. **Reset to setup**
  removes the own lights and gives back the setup's as they were.

Any part with an emissive material also lights.

**IES lights** (phase L5). *+ Add light ▸ IES…* opens an `.ies` file (the public
text format of IES LM-63: what luminaire manufacturers publish with the
intensity in each direction; an `.ies` can also be dropped onto the window)
and creates a light of type `IES` in front of and above the
part, switched on, selected and with the mean irradiance of the
switched-on lights, like the new point: one undo entry. **No manufacturer
profile is shipped**: each person brings their own (the two used in the tests,
`tests/fixtures/ies/`, are written by hand and are not the measurement of
any luminaire). A file the reader does not accept adds nothing and says
why in a notice: **type C** photometry with `TILT=NONE` is read; type
B or A and `TILT=INCLUDE` are rejected with their message (“export the profile as
type C”, “with TILT=NONE”), and so are truncated files, counts that do not match,
angles that do not increase and negative candelas.

- **What the file gives and what the light gives.** The profile gives the **shape** (the
  relative intensity in each direction, interpolated bilinearly between its
  angles and with the file's symmetries: round, four quadrants,
  bilateral or full) and the light gives the **level**: it is as bright in the
  brightest direction of the profile as a point of the same power. The
  lumens and the multiplier the file states do not count (a profile
  written for 500 lm and another for 5000 give the same light), so swapping a
  point for an IES light does not move the exposure. The **lumens** the
  inspector shows are the flux of its point times the part of the sphere that the profile
  fills (a narrow beam gives few lumens).
- **It is oriented** like a spot: its axis (vertical angle 0° of the profile) goes to its
  target, and the **roll** (horizontal angle 0°) turns the pattern about the
  axis; it is moved, aimed, duplicated and deleted like any light, and
  can be a sphere of small radius (seen by the camera and in reflections, with the
  profile's pattern) or a point.
- **The inspector** shows the **profile name** (the luminaire description from the file,
  or the file name), a **polar plot** of its intensity drawn from the file (the
  planes C0–C180, solid, and C90–C270, dashed, with the axis pointing down; one only if the profile is
  round), the peak, the beam angle and the symmetry, **Change…** (another
  file for the same light, which keeps its place and its level) and a
  **multiplier** (× 1 is the level the light came in with; instead of the
  watts, which change with the product type when applying a setup). The type
  can be switched to *Point* or *Spot* and back: the profile stays on the light.
- **Fast approximates it** (and the inspector note says so): a spot with the
  axis intensity and a cone taken from the angle at which the profile falls to
  half; *Full* and the render use the whole file.
- **The profile travels** in the project (`.repack`: the file's text goes in the
  light, and the project opens on another machine without it), in the studios, in a
  setup saved with *Save setup as…* and in the library. A damaged profile,
  or one the reader rejects, is removed on opening and the light is a point.

**Lights and cameras in the viewport** (extension of L4). Lights and
**saved cameras** (not the active one, which is the view) are drawn as
**achromatic glyphs** in the theme's ink: the panel outline (rectangle
or ellipse, with a mark towards where it lights), the sphere, the point (with a
small star), the spot cone (with the inner cone where the transition starts), the
sun's arrow and the camera pyramid (with a triangle
saying where up is). They are drawn over everything, dashed, and the
selected one solid; they never appear in a render. The **Lights and cameras**
button of the view bar shows them all **while working with them**: with the
*Lights* or *Cameras* tab open, with a light or a camera
selected or looking through one; otherwise (with *Parts* and the part
selected), none, so that the outline of a setup panel
that crosses the product (the main one is usually between the camera and the part) is not
read as part of it. When off, only that of the selected object. A **click**
on a glyph (within 6 px of one of its lines) selects its light or camera (one
at a time; `Ctrl/⌘` or `Alt` removes it), above any part
behind it; a **double click** looks through; the **right click** opens *Look
through*, *Duplicate*, *Aim at…* and *Delete* (or *Activate* on a camera).
With a light or a camera selected, *Move* puts the *gizmo* on it
without the scale cubes: **move** carries it without changing where it aims,
**rotate** turns it around where it aims (and a panel's roll
about its axis), and the **aim handle** (the line to its target) moves
the light's or the camera's target; in global axes or its own
(right, up, back), with `Shift` increments. A drag is one
undo entry, and moving a saved camera does not move the active one. A
locked camera has no *gizmo*. The selection box (U7) and *Scale*
(U9) do not see the glyphs: the box selects parts at the current level and the
size of a light is changed in the inspector.

**Look through** the selected light or camera (button in the view bar and
in the inspector, `Ctrl/⌘ ⇧ L`, double click on its glyph): the viewport looks
from it, in *Fast* and in *Full*. A light is seen from its position
towards its target, with the active camera's optics; a spot
adjusts the focal length so that its cone fills the short side of the framing (what is
seen is what it lights). **Orbit, Pan and Zoom move that object**: the
light goes where the view is and aims where it looks, the camera takes the view;
the whole gesture is one undo entry and the active camera does not move.
**It respects *Lock camera***: a locked camera is seen but does not move
(the notice says so). `Esc` or the button go back to the active camera, just as
it was.

**Place by reflection**: given a point on the part and its normal, the selected
light is placed in the reflected direction of the camera ray, at its current
distance. It is the natural way of saying "I want the highlight here".

**Environment**: `STUDIO` (procedural dome: grey 0.12 on the floor, 0.45 at
the horizon, 0.85 at the zenith; it lights and is reflected, needs no
file), `SKY` (procedural sun and sky from the sun-type light),
`FLAT` (plain colour), `HDRI` (user file, with rotation and
intensity). What lights and what the camera sees are separate: the background
can be the environment, a colour, a two-colour gradient (L6),
transparent or an image, without changing the light.

`EnvironmentState` (E5) also stores `hdri` and `backplate` (`ImageRef`:
id, name, width and height; the bytes live in the image registry,
like meshes, and the project carries them inside), `backplateFit`
(`FILL` · `FIT` · `STRETCH`: the image covers the framing by cropping,
fits whole with the colour around it, or is stretched), `skyTurbidity` (sky
haze, 3 by default: 2 very clean, 6 hazy) and `skySun` (`az`,
`el`: the sky's sun when the setup has no sun light, relative to
the camera like a light; −55°, 55° by default). With a sun light
switched on in the setup, that light places the sky's sun. `skyModel`
(E5c) chooses the model: `PHYSICAL` (default, also for
projects saved before it existed), our physical sky: the
functional form of Hošek and Wilkie (2012) with coefficients fitted by
us to our own simulation of the atmosphere; or `CLASSIC`, the Preetham
(1999) one from E5. Both are scaled so that a horizontal surface
receives the same light as with the dome of the same values;
daytime only (the sun, at 0° minimum in the physical one and at 1° in the classic one). An `HDRI` without a loaded file lights with the
dome; a background image without a file shows the colour. A panel with `camera = true` is painted as a **light field in the
background** (soft disc centred in the framing), never as a visible
rectangle with edges.

### 3.5 · Camera

`CameraState`: name, position and target (or azimuth, elevation and
distance around the target), focal length in mm on a 36 mm sensor,
aperture, focus distance, perspective or orthographic (with orthographic
width), clipping, `locked`. Reference camera: azimuth −35°,
elevation 22° (three-quarter), distance derived from the focal length and part
size so that it fits with a 10 % margin.

**Image aspect ratio** (U13). Each camera carries its own,
`CameraState.aspect: { preset, w, h }`, with `preset` a stable key of
`src/data/aspects.ts` (`3:2`, `4:3`, `16:9`, `1:1`, `5:4`, `4:5`, `9:16`,
`21:9`, `2:1`, `65:24` panoramic) or `CUSTOM` with free `w : h` (the
ratio stays between 1 : 512 and 512 : 1, that of the most extreme sizes the
render window admits, 16 × 8192 and 8192 × 16). It is the width over the height of the image that camera
takes: a new camera is 16:9; *New from current view* and duplicating
copy the origin's; `camera/set` changes it (undoable) and reads it like
any field (`normaliseAspect`: a known key brings its terms,
something that cannot be one is discarded). The **single source** is the camera:

- the **viewport frame** is that of the camera being seen (the active one or the one
  being looked through), with its proportion;
- the **size in pixels of an image** keeps the width and takes the height
  from the active camera's proportion (`syncOutputSize`, on every action,
  also when changing the active camera, on undo and when opening a project).
  If a size is typed that breaks that proportion (both sides at once,
  or one with the lock open) the camera receives it, in the same
  action: the list preset if the size is exactly one
  (`aspectForSize`), otherwise `CUSTOM` with those pixels as `w : h`;
- an **animation** has a single output size, that of the render
  window, which does not follow the camera; the Doctor warns (`aspect`) when the
  camera of a shot has another proportion;
- a queue job for a camera with a different proportion from the window's
  comes out with the same width and the height of that camera.

A project saved earlier has no `aspect` on its cameras: each takes
the proportion of the saved render size (the preset that fits within a
tolerance of 0.5 %, otherwise `CUSTOM` with those pixels), and the saved size
is not touched. Repositioning the camera when the proportion changes is not done
by itself: *Frame* adjusts it to the new image.

**Frame**: adjusts the distance (or the orthographic width) so that the
bounding box of the selection (or of everything) fits with a margin, without moving
the orientation. **Saved cameras** are seen in the viewport as pyramids,
are moved with the *gizmo* (the position without changing its target, the roll, the
handle of its target) and can be **looked through** (§3.4, *Lights and cameras
in the viewport*). **Views**: three-quarter, front, side, top,
back.

**Focus** (F1, `core/focus.ts`). Each camera chooses how it focuses,
`CameraState.focusMode`: `DISTANCE` (the typed distance,
`focusDistance`, as always; a camera, a project, a saved camera
or a library studio from before F1 do not have the field and are read
that way), `POINT` (a point picked with a click, `focusPoint: { node, point }`,
stored **in the coordinates of the part it touched**, so that it follows
its transforms and its animation) or `OBJECT` (a part, a group or the
model, `focusObject`, at the selection level it was chosen with; the point
that is followed is the **surface the camera sees at the centre of its
outline** on the image (decided after the owner's report of 2026-10-18: the
centre of its box, the first rule, lies inside a solid product, and wide
open the face the camera sees was out of focus; the other two candidates,
the centre of the box and the vertex nearest along the axis, are written in
`objectFocusPoint` and unused). In
`POINT` and `OBJECT` the focus distance **is computed** from the camera as
it is at each moment and the point where it is at that moment: when navigating,
when looking through, at each frame of an animation, in the render
window, in the queue and in batches (`resolvedFocusDistance`, and
`focusDistanceAt(state, camera, t)` as a hook for whoever renders an
instant); the RSB still carries one distance per frame. The *store*
keeps in `focusDistance` the one that comes out at rest (`syncFocus`, after each
action that changes a camera or the scene), and it is the one the camera goes back to
if the point's part or the object is deleted: it goes to `DISTANCE` in the same
action (undoing returns everything) and the interface warns of it. A `FOCUS`
clip (a focus change) pulls from the distance that follows. **"In
focus" is the engine's rule** (`rt-core` `focus`): the thin lens focuses the
plane perpendicular to the view axis, so a point's distance is
its depth along the axis; with tilt (O1) it is the distance
whose plane of the hinge rule passes through the point; a traced lens
(O2) is focused paraxially, but wide open its spherical aberration and field
curvature put its sharpest image millimetres from that plane,
and the engine resolves the distance with its own rays (where the fine detail
that the sensor point sees has the most contrast, `rt_scene_focus_at`:
10 and 5 line pairs per millimetre of the 36 mm frame, decided); without `rt.wasm`
the paraxial one is used. A panorama (K3) has no depth of field: its
distance is the point's; with straight verticals the levelled camera
that is rendered counts. A traced lens breathes, so the click settles:
it is repeated with the camera already focused until the pixel shows the same
point. **Focus with a click** picks the exact pixel in
the exact view: the engine's principal ray for that pixel (the camera
looked through with its own frame, the playhead's pose, the viewport image
around the frame, the lens with its distortion and its breathing) and the
first part **the engine itself** meets along it in the view's whole scene:
the surface the image shows at that pixel, the face the camera sees (since
the owner's report of 2026-10-18; the engine's pick also steps over the parts
hidden to the camera, as its camera rays do). Only where the engine shows no
part of the scene there is the ray cast against the viewport geometry
(through both faces of each triangle, with the section). The camera that
receives it is the one that is seen (the one looked through, the playhead
shot's, or the active one).

**Focal length and size of what is in focus** (C2, `core/focal.ts`). Each camera carries
the switch *Keep the size of what is in focus*,
`CameraState.keepFocusSize` (optional: a camera, a project or a
library studio from before C2 does not have it and is read as off; on
opening, any value other than `true` is off). The focal length changes with
`camera/focal` (the inspector field: an arrow step, a drag
or a typed value, each one an undo entry) or with an
interior lens (`camera/interiorLens`), and goes through it:

- **off** (default, as on a camera): the camera stays where
  it is and the framing changes;
- **on**: the camera moves along its axis so that the focused plane
  keeps its size in the image. A point at depth *z* comes out *f/z*
  times its size, so the plane at distance *D* keeps it if it becomes
  *D·f′/f*: the camera advances *D − D·f′/f* (moves back if the focal length grows) and the
  focus distance and the orbit distance drop by the same amount. *D* is the F1 one at
  rest: the one typed in *Distance*; in *Point* and *Object*, the one that puts
  the point being followed in focus (`focusDistanceFor`: its depth; with
  tilt, where the hinge plane that passes through it cuts the axis;
  with straight verticals it is measured along the camera's own axis, which is the one it
  moves along, and the levelled camera that is rendered keeps the size and
  the place of the plane). The **orbit target** stays where it is
  as long as the camera stays in front of it by more than a tenth of the
  orbit distance scaled by the same ratio; otherwise, it advances along the axis
  in front of the camera (it is never left behind). The far clipping plane stays
  where it was in the world.

It moves nothing with the camera **locked** (the focal length changes as if off), nor
with the **orthographic** one or the **panoramas**, whose framing does not depend on the
focal length (the width, the field of view). Choosing an **optics preset**
(`camera/lens`) still frames the part as before; the `ZOOM` clips of
an animation change the focal length without moving the camera. *New from current
view* and duplicating copy the switch.

**Optics (O1, the simple lens; until O4 it was called the *thin lens*, and the
project still stores it as `thin`).** `CameraState.optics` (optional;
a camera without it, like all those before O1, is the usual simple lens
and the engine renders it bit for bit the same): the chosen **bokeh type**
(`bokeh`, `variant`, keys of `src/data/bokeh.json`; it goes back to
`null` as soon as a blur control is moved by hand) and its
parameters, which are those of `BokehThin`: blades (0 round, 3 to 18) with
roundness and rotation, mask (replaces the diaphragm) and pupil texture
(multiplies; the onion rings with their amplitude), pupil
profile (uniform, bright centre, bright ring, apodized) with its
intensity, central obstruction, cat's eye, anamorphic squeeze
(1, 1.33 or 2; the image comes out already desqueezed: only the blur
is oval) and, marked *non-physical*, chromatic aberration and swirl; plus
**shift** (mm on the sensor, horizontal and vertical: it moves the
framing without changing the perspective) and **tilt** (degrees and axis in
the sensor plane: the plane of focus rotates by Scheimpflug around
the axis's focus point). Choosing a type only changes the blur
controls; the tilt and the shift stay. The cat's
eye clips the beam towards the corners and darkens them (it is the optical
vignetting that goes with it); chromatic aberration paints each sample in
one of three bands (decision 3) without moving the plane of focus. The types
that need the traced lens (coma comet, focus breathing,
variable spherical aberration) put their catalogue lens on the camera
(O2; since O4 the bokeh grid does not show them, they are *Traced
lens* lenses) and the diffraction one waits for wave optics. **Bokeh and
advanced optics belong to the simple lens (O4)**: no bokeh type is
applied to a camera with a traced lens nor takes it out of it
(`opticsForBokeh` returns `null`; the command all paths use,
`applyBokeh`, warns and does not touch the camera). Changing the lens model does not
delete anything: the bokeh type, its parameters and the simple lens's tilt
stay in `optics` while the camera carries the traced lens and
come back as they were (`opticsWithLensModel`).

**Tilt (O4).** Each model has its own: the simple lens,
`tiltDeg` and `tiltAxisDeg`; the traced one, `tracedTiltDeg` and
`tracedTiltAxisDeg` (optional; without them, 0). That way a traced camera
from before O4 with a saved simple-lens tilt (the engine
ignored it with a traced lens) does not start tilting. Both give **the
same plane of focus** for the same numbers: by the hinge rule of the
simple lens (through the focus point, at `focusDistance` along
the view, with normal `f·forward + u·sin α·b`); the traced lens
is rotated as much as needed so that its own plane is that one (see
`ARCHITECTURE.md` §5.2 sedecies) and, away from the centre, its field
curvature bends it as that of the straight lens does. The interface reads the pair
as one quantity (0° to 12°) and the image direction towards which the plane
recedes (`recedeOf`/`tiltFromRecede` of `src/core/focus-plane.ts`;
at 0° axis and positive sign, the plane lies down towards the floor and recedes
upwards). **By two points**: of the planes that pass through two points,
the least tilted (its normal is the view made perpendicular to the line
through the two); with three, the plane of the three; the hinge rule
is inverted exactly and gives the tilt, its axis and the focus distance, or
the reason why there is none (the same point, points in line with the view,
behind the camera, more than 12°). An anamorphic adapter (with cylinders)
does not tilt. The **shift** belongs to the camera, whatever the
lens (O2 already moved the framing of a traced one with it). What the engine does is in `ARCHITECTURE.md` (`LENS` section)
and in `rt-core/src/optics`. The `coc` pass (X2) is still that of the
round, untilted simple lens, whatever the optics. Fast mode
does not draw depth of field; of the rest it only shows the
shift (the framing).

**Effect filters (O3a).** `CameraOptics.filters` (optional; without it,
none, and earlier projects do not change by a byte): a stack of
up to three filters in front of the lens, in order. Each one has its
**type** (`src/data/lens-filters.ts`, stable keys and generic names,
never a brand's: *White diffusion*, *Black diffusion*,
*Gold diffusion*, *Glimmer*, *Soft*, *Net*, *Star*, *Streaks*), its
**grade** (1/8, 1/4, 1/2, 1 or 2, like real filters) and, depending on the
type, its **tint** (gold, net and streaks; `null` is the type's own),
its **points** (star: 4, 6 or 8) and its **angle** (star, streaks and
the net's axes). The engine scatters the camera ray in the pupil sample: with the probability
`s` of the grade it deflects it according to the filter's angular PSF and otherwise
lets it continue, so that the image is
`(1 − s)·I + s·a·(I ⊗ K_T)` (`a`, what the particles let through: 1
except for black diffusion; the tint `T`, of luminance 1, only in the
wide parts of the PSF: the tail of the diffusion, which is the halo, and the
streaks; the narrow core, which falls on the image, and the glimmer's
sparkles stay neutral); so the halo carries the lens's bokeh and focus,
and a light outside the framing veils the image. The grade decides `s`
and, in the star and the net, the length of their streaks (in angle: on an
85 mm, the star reaches a quarter of the half frame at 1/4, 60 % at 1
and the edge at 2, with the same brightness next to the light; the net's cross,
at most 15 % of the width at 2). Glimmer is a fixed cloud of
fine sparkles around each light. A grade-0 filter does nothing. Choosing a bokeh
type or *Plain disc* does not remove the filters. An orthographic camera has no
filters (as it has no lens). Fast mode draws an
approximation in image space with the same kernels and the meter says so.

**Front glass (S3).** `CameraOptics.frontGlass` (optional; without it, or
off, or without drops or dust, none, and earlier projects do not change
by a byte): a sheet in front of the lens with water drops and dust on it,
like a lens in the rain. It stores `on`, `drops` (the part of the glass that
the drops cover before merging, 0..0.9), `dropSizeMm` (the mean diameter
of a drop's footprint, 0.2..10 mm), `dust` (the part covered by motes,
0..0.5), `seed` and `distanceMm` (from the centre of the lens; 0, automatic:
where the front element is; up to 200 mm, a glass or a window in front of
the camera). The rest of the sheet (the water's contact angle, the
spread of the sizes, the size and opacity of the motes) are the
fixed values of `src/data/front-glass.ts`. The engine traces the glass as real
geometry in front of the lens (`rt_core::optics::glass`): each drop
refracts like the lens it is (through a lens focused far away, a
soft disc with the scene upside down inside and a dark edge), those that
touch merge into one with their volume added and the dust is dark, soft
motes; with nothing on it, the image is that of no glass, bit for bit. The drops
are on the glass, not in the framing: changing the focal length or the image size
does not move them. Only the Full and Render modes trace it, and only an
engine with bit 6 of its capabilities; a panoramic camera has no
front element and does not use it. It is stored with each camera, in the project and in
the studios.

**Front glass fed by the scene (S3b).** `frontGlass.source`
(optional; without it, `MANUAL`, the drops and dust from the controls, as in S3):
`SCENE` makes the drops and dust come from the *Ambient* effects that
fall on the glass (`src/data/front-glass.ts` `GLASS_FEED`: *Rain* and *Water
drops* wet it; *Dust motes*, *Pollen*, *Dust cloud* and *Ash* throw dust;
snow, bubbles and confetti leave nothing) as simulated by the physics
bar (`engine/crates/rt-phys` `wet`, in the S2 *worker*). The engine says
where the glass is and what square of it the render's rays cross
(`rt_scene_glass`); the page gives it, in the glass's axes (right, up and
outwards, those of the camera), the gravity and for each effect its density (the
particles it asks for divided by the volume they fill) and its mean velocity (its
wind and its fall), its size, the advancing and receding angles of water
on glass (`src/data/wettability.ts`, a table per family: glass,
plastic, metal, paper, paint) and the dust's angle of repose (35°). On the
glass arrive the particles that cross its outer face (`density × max(0,
−v·n)` per mm² and s: a camera looking down in a vertical rain
does not get wet; a wind blowing towards it does), by a Poisson draw per
step of 1/240 s. **The drops** are caps of their volume at the mean angle,
**merge** by volume at their centre of mass, stay **pinned** up to
Furmidge's critical radius (`ρ g V sin α = γ 2a (cos θ_R − cos θ_A)`) and
**slide** down according to the camera's *up*, leaving a **trail**
(a 2 µm film the width of the drop, whose water they lose) that **cleans
the dust** where it passes; a drop that leaves the glass is gone. **The dust** stays
where the face looks upwards below the angle of repose (a soft
ramp of ±5°). Each frame of the simulation is recorded in a
`PHYSICS` clip of the camera (§3.7, `glass`: the cache), and the render and Fast mode
read the playhead's frame: the engine receives the glass drop by drop (the end
of `GLAS`, bit 7 of its capabilities; an engine without it is not sent it, because
it would draw it clean). Without a recording, the glass is dry. Drops that fall and
slide over the parts, dust that settles on them and snow belong to
S3c.

**The glass in Fast (S3b).** Fast mode draws an approximation of the
glass with the drops and motes that the engine places (by hand, `rt_scene_glass`;
from the scene, the recorded frame): each point of the image gathers the light from
a disc of the glass, the aperture cone cut by it (radius
`(f / N / 2) |1 − d / s|`); the part of that disc under the drops takes the
blurred image (attenuated by the two faces of the water), the part under their edge (where
a ray along the axis returns by total reflection, from `1 / (n sin θ)` of the
radius) is dark, and the part under the dust, by its opacity, darkens it: drops
are soft discs with a dark edge and dust a tint or some motes. The
scene upside down inside each drop is not drawn. The meter says it is an
approximation of the engine's N drops and M motes.

**Traced lens (O2).** `CameraOptics.traced` (optional; without it or `null`,
the simple lens, and earlier projects do not change by a byte): a
lens from the `src/data/lenses.json` catalogue (16 prescriptions from expired
patents and books, generic names, stable keys) that the engine traces
surface by surface. The project stores the **key** and what the
person changed, never a copy of the surfaces: the **coating** of
the air–glass surfaces (`null`: the lens's own; uncoated, single layer,
multilayer), the soft lens's **variable gap** (`null`: the
design's), the **lens behind** an adapter (`null`: the normal
double Gauss) and four **non-physical** adjustments (distortion −1 barrel … 1 pincushion,
vignetting 0 … 1, spherical character −1 undercorrected … 1
overcorrected, breathing −1 none … 1 double). The lens is scaled to the
camera's focal length and focused at its focus distance; the camera's f/
is never wider than the lens's. With it, the iris
(blades, roundness, rotation, obstruction) goes in the lens's diaphragm and
the optics' chromatic aberration and swirl are its non-physical
adjustments; the simple lens's pupil profile, cat's eye and anamorphic squeeze
do not apply (the lens makes its own pupil, its own cat's eye and its own
fringes), and since O4 the tilt is its own (`tracedTiltDeg`,
above); the shift does. An anamorphic adapter desqueezes the image by the
squeeze it traces at that focus. What the interface shows of the lens is
computed by the engine (rule 10): focal length at infinity and at the focus, back focus, f/ in use
and T-stop, elements and groups, length, entrance pupil, the squeeze
of an anamorphic, the distortion and the light towards the corner, and the section. Fast
mode applies the engine's distortion and vignetting as an approximation
and the meter says so; Full and the render trace the lens. What is drawn
on top (the selection outline, the *gizmo*, the glyphs) follows that
same distortion, and a click (click to focus, select, the box, the
*gizmo*) lands on what is under the cursor: the same map in reverse. Changing
lens does not touch the output resolution.

**Edited lens (O2c).** The **elements** of a traced lens are edited in
the lens editor (`UI.md` §2.11): their radii, their thickness, their glass, their clear
aperture (the size) and the air up to the next one; an element is added
where chosen, one is deleted and one is flipped 180° (its radii are
swapped and change sign; a cemented group turns whole). The catalogue lens
is not touched: `TracedLens.edited` (optional; without it, the catalogue
lens, and earlier projects do not change by a byte) stores the
**edited prescription** —the surfaces at the design's scale, with the
same conventions as `lenses.json` (radius, distance to the next one,
glass by `nd` and `vd`, semi-aperture or `null` for the engine's, the
diaphragm by its role), its **name** and its **focus** (that of the lens with
its moving gaps tracked through the edits; if an edit removes
one, the lens focuses by moving as a whole)— and the `key` still names the lens
it came from (its diaphragm and its source). The engine scales it to the
camera's focal length like a catalogue one. Lenses that only refract are edited:
the anamorphic adapter (cylinders) and the mirror one are not. While being edited, the
copy is `CameraState.lensDraft` (optional): each edit is an undo
entry and the camera's lens does not change until it is **applied**, and only
a lens that the engine has checked is applied: with a negative air gap, a
glass without thickness, surfaces that cross or elements that collide within
the given apertures, an aperture wider than its sphere, without a real image,
without light along the axis or with the image inside the lens, the editor says why
and the lens can still be edited. A file with `edited` data that cannot
be read opens the catalogue lens; a copy that cannot be read is discarded. The
list of glasses is those of the catalogue prescriptions (index and Abbe
number at the d line), without manufacturer names. What the interface shows
of the edited lens is the engine's (rule 10), plus the **design
focal length** (`designEflMm`: that of the prescription as written, before
scaling it) and the image circle that comes out of its light towards the corner.

**Interiors camera (K3).** `CameraState.projection` is
`PERSPECTIVE`, `ORTHOGRAPHIC`, `EQUIRECTANGULAR` (2:1 panorama, 360° ×
180° over the whole image) or `FISHEYE` (equidistant, `fisheyeFovDeg`
from 60° to 360° over the image diagonal, 180° by default); a
project with an unknown key opens in perspective. Both
panoramas start from the camera's position and its frame
(azimuth and elevation): the centre of the image looks at the target and the preview
draws them from the six faces of a cube with the same map as
the engine. New **views**: *Elevation* (orthographic at 0° elevation) and
*Plan* (orthographic from above, 89.9°). **Straight verticals**
(`straightVerticals`, can be turned off): the levelled camera is rendered at the
same position and the same azimuth, with the vertical *shift* that leaves the
target where it was (−f · tan tilt, added to the
*shift* of the O1 optics), up to 30° of tilt; beyond 30° the excess
stays as tilt (`VERTICALS_MAX_TILT_DEG`). On an
orthographic camera it is not needed and in a *fisheye* the verticals are curved: it
does not apply; an equirectangular is rendered levelled, without *shift*.
**Eye height** (`camera/eyeHeight`): raises or lowers the camera to that
height above the floor (world Z) and leaves it looking at the same target;
presets *Standing* 1.5 m and *Seated*
1.1 m. **Interior lenses** (`camera/interiorLens`): 24, 28 and 35 mm
(`src/data/interior-camera.ts`). A locked camera does not move with
either of the two actions. A part with **Visible to camera**
off (`SceneNode.cameraHidden`, inherited by children) is not seen by the
camera (nor by the passes, nor by the section caps, nor by picking) but still
gives shadow, bounces and reflections: the plan without a ceiling and with the
ceiling light.

### 3.6 · Image

Exposure in EV, view transform (`STANDARD`, `FILMIC`, `AGX`),
glow (threshold, size, mix), sharpening, saturation, contrast, vignette.
They are applied in this fixed order on the linear image: glow → sharpening →
colour → vignette → transform. With everything at zero, the image does not change.

**Exposure as a pass (K3).** `image.exposureMode` is `MANUAL` (the usual,
the exposure is `exposureEv` stops) or `AUTO`: the exposure pass
measures the linear image on the page (`core/image-passes.ts`,
deterministic: luminance in `f32`, base-2 logarithm, the darkest
10 % and the lightest 5 % are discarded, the mean is brought to the 18 % grey,
±16 stops, rounded to the hundredth) and `exposureEv` is then the
*Brightness (EV)* compensation on top of what was measured. The measurement is redone when
the samples double and, in a final render, on the sums before the
*denoise*. The *Bright day* (EV₁₀₀ 7) and *Evening lamps*
(EV₁₀₀ 5) **presets** set the exposure by hand: `exposureEv = log2(683 / 1.2) − EV₁₀₀`.
The **exterior multiplier** (`environment.exterior`, 0.05 … 1, 1 by
default and not written) multiplies the environment that the camera ray sees
(also through thin glass and cutouts) and the shadow catcher's background, and not the light
that environment gives the room. The passes
that the page applies are `exposure` and `curve` (the transform); the rest
stays the same.

### 3.7 · Animation, KeyShot style

The model follows KeyShot's, seen from the outside: **there are no keyframes
to edit by hand**; each animation is a **bar** with a
target, a type, parameters, a start, a duration and a time
curve, and all of them live together in **a single timeline** with one track
per target. What in the first version were "shots" is the **camera
track**: each segment says which camera is active (a *camera
cut* is one more event of the track).

**Animation types** (`MOVE_KINDS`; existing keys are kept
and the missing ones are added), grouped as the wizard groups them:

| Group | Type | What it does |
| --- | --- | --- |
| Parts | **Turntable** (`SPIN` on the model) | The whole model turns about its vertical axis |
| | **Rotation** (`SPIN`, `TUMBLE` and free axis) | A part or group turns about an axis around a **pivot** (N1, `MotionClip.pivot`): its own origin (without a pivot, as before), the **centre of another part** or group (a lid on its hinge) or **a point** in mm. The axis is the target's own: Z in the spin (`SPIN`), X in the tumble (`TUMBLE`); the free axis (any direction) belongs to a later phase. With a pivot, the target describes an arc at constant distance from it |
| | **Translation** (`MOVE`, `TRACK`) | Moves a distance along an axis, local or global |
| | **Scale** (`SCALE`) | Changes size by a factor |
| | **Fade** (`FADE`, N1) | Opacity drops to the **final opacity** (the amount, 0–100 %; 0 % by default, it disappears); **inverted**, it appears from it. The fades of a node and of its groups are multiplied; in the engine, a part that fades is a stochastic cutout of that coverage (with its shadow), an emitter lowers its emission, and at 0 % the part is not there |
| | **Explode** (`EXPLODE`) | The parts of the model or of a group separate: linear, radial, spherical or by levels, with exceptions (see below) |
| | **Visibility** (`VISIBILITY`) | Appears or disappears |
| | **Simulation** (`PHYSICS`, S2) | The recorded fall of a simulation (§3.1, *Physics*); it is not created from the wizard: each simulation creates it |
| Camera | **Orbit** (`ORBIT`) | Turns around the target, degrees |
| | **Rise** (`RISE`) | Goes up or down in an arc, degrees |
| | **Zoom** (`ZOOM`) | Changes the focal length, mm |
| | **Push** (`DOLLY`) | Moves closer or away, % of the distance |
| | **Pan** (`PAN`, N1) | Turns on itself, without moving, degrees (positive: to its right): its target goes around its position. The library's *whip pan* (`camera-moves.json`, A6) is still a fast orbit with a strong curve around the product; a variant with `PAN` next to it is pending |
| | **Focus** (`FOCUS`) | Changes the focus distance |
| | **Camera cut** (event of the camera track) | Switches to another camera at that instant, with a cut or a fade |
| | **Path** (`PATH`, reserved in N1) | Follows a curve through points. The key is in the catalogue; nothing creates or plays it yet, and the wizard does not offer it |
| | **Walk** (`WALK`) | The camera walks along a path at eye height, with or without footstep simulation (see below) |
| Light and environment | **Light sweep** (`HDRI`) | Rotates the environment |
| | **Intensity** (`INTENSITY`), **Colour** (`TINT`) | Of a light |
| | **Sun arc** (`SUN_ARC`, N1, with the E5 sky) | The sun traces its arc of the day: it turns around the **celestial pole** (towards the west, 15° per hour; the amount is degrees of that turn), so it keeps its angle to the pole and 360° is a whole day. It moves the first sun light of the setup that is lit; without one, the sky's own sun. The pole is behind the product, at 45° height (`SUN_POLE_AZ`, `SUN_LATITUDE`), in the frame of the lights (relative to the camera) |
| | **Section** (`SECTION`, Q1, on the scene like `HDRI`) | The section view's plane moves along its normal, in part sizes: a negative amount cuts deeper (default −0.5); a positive one uncovers. It adds up with other `SECTION` clips and is split without a jump; it does nothing without a plane or with the plane off |
| Materials | **Material colour** (`MATERIAL_COLOR`, N1), **Material fade** (`FADE` on the material) | On a **material** (target `MATERIAL`) and with it all the parts that carry it: its base colour goes to the clip's (`color`, from the one the previous clips left) or its opacity drops as in a fade. A node material (M3a) fades but does not change colour (its look comes from its graph) |

**Walk (`WALK`)**, designed for furniture and interiors: it creates the
camera path for you. The path is traced in the viewport with
the *Draw walk* tool (click on the floor for each point, `⏎`
to finish; the points are dragged afterwards) or generated with a click:
*Walk around the selection* (an arc at eye height that circles the
part at the framing distance) and, with the K2 room, *Room
tour* (enters through the door and covers the free space). The curve is
smooth (centripetal Catmull–Rom) and is travelled at **constant speed**
(1.2 m/s by default, editable), with soft start and stop. Parameters:
**eye height** (1.5 m standing, 1.1 m seated, or free), **gaze**
(*forward*, *towards a target* —a part or a point—, or *by
points*, with smoothed rotation), and the **Simulate steps** switch: it adds
the movement of a person walking —cadence (1.8 steps/s), vertical
sway (2.5 cm), lateral sway (1 cm), slight tilt (0.5°)—
synchronized with the distance travelled, which switches off when stopping. Without
simulation, the camera glides as in a cinema *dolly*. Everything is
a deterministic function of time, like the rest of the animations.

**Explode (`EXPLODE`)**, configurable (N6). CAD tools
with an exploded view agree on three geometries and on hierarchical order
(public documentation of Onshape, Fusion 360, SolidWorks
Composer and Inventor; black-box observation, no code); the explode
takes them as follows (`src/core/explode.ts`, keys of `EXPLODE_MODES`):

| Geometry | Key | What it does |
| --- | --- | --- |
| **Linear** | `LINEAR` | Along an axis (vertical Z, horizontal X or Y, or a custom direction). *Separate*: each part moves away from the central plane on its own side. *Stack*: all in the same direction, spread in their order along the axis; the first stays and the last travels the whole distance (the classic explode of a container: body, thread, cap) |
| **Radial** | `CYLINDRICAL` | Moving away from an **axis** that passes through the centre, perpendicular to it; what is on the axis does not move |
| **Spherical** | `SPHERICAL` (and its synonym `RADIAL`) | Moving away from a **point**, the centre, in all directions |

and, combinable with any of the three, the **hierarchy**: *parts*
(each part on its own), *one level* (the target's children as
blocks: a group moves whole) or *all levels* (first the
blocks and then, in stages, the parts inside each group, which
separate from their group's centre and in proportion to their size).

Parameters (`MotionClip.explode`): **distance** (the animation's
amount: × model size or mm), **spread** (*equal*: each part
travels the distance; *by distance*: the farther from the centre the more it
moves away, and the farthest travels the distance), **proportional to the part's
size** (the largest travels the whole distance, the others in proportion),
**centre** (the assembly's, a chosen part, the target's pivot or
a custom point), **axis or direction**, **order** (*all at once*,
*staggered by distance* —the farthest first— or *by depth*
—what hangs from the model before what is inside groups—, with an
**overlap** from 0 % —one after another— to 100 % —at once—, which also chains
the stages of *all levels*), **speed** (the duration),
**smoothness** (a single control from 0 % to 100 % that goes from *linear* to *smooth*
and to *very smooth* of `EASING_KINDS`, blending them in between, and writes the nearest
into the curve), **exceptions** (pinned parts; they are filled from the
selection or with *Pin in the exploded view* in the context menu; pinning a group
pins its parts), **keep orientation** (off, each part
tilts a little —up to 20°— as it moves away), **invert** (assembly: starts
separated and ends assembled) and the **target**, the whole model or a group.
The parts of a set (L6) are never exploded.

The earlier keys remain valid: `RADIAL` is the **spherical** (what it
always meant: “each part goes outwards from the centre”),
`AXIS_X/Y/Z` are linear *separate* on that axis and `CUSTOM` (one direction
per part, not built) is read as the spherical. An explode without
parameters —all those saved before N6— is the one from then: spherical,
each part the same distance, from the model's centre, all at once; it is
read exactly the same (`tests/fixtures/explode-legacy.json`). The new radial
uses the key `CYLINDRICAL`, which was already in the catalogue with that
meaning (“they fan out without going up or down”).
**Simulation (`PHYSICS`, phase S2).** **Every simulation records itself**:
at the start, each falling body receives a `PHYSICS` clip on its node,
which starts at the playhead (rounded to a frame) and grows while
it runs; it stays where the simulation stops and *Reset* removes it
(undoable). There is no separate record step: the still uses
the playhead's frame and the animation already has the simulation. The clip carries a
**baked track** (`track`: the project's fps, number of frames and,
per frame, the local position in mm and the rotation as a quaternion,
`f32` *little endian* in base64, 7 numbers per frame) and an **anchor**
(`anchor`: the position and rotation of the node that the track
refers to; on confirming, where the simulation left it). On playback, the
position is interpolated linearly between frames and the rotation along the
short arc; before its start the node has the first frame and
after it the last. If the node is moved or turned afterwards, the whole fall goes
with it (the track by the change from the anchor); its scale is its own.
Stretching the bar slows it down; it repeats and inverts with the same
timing as any other (inverted, the fall goes backwards: the parts
rise from rest); it has no amount or time curve, is not split
and *Animate…* does not offer it. The other animations of the same node are added
on top. With the playhead at 0, not playing and without inverted clips, the
scene is shown as it is edited (N1, N6), **except the nodes
that a recorded simulation holds**, which show their frame there
too (a fall from 0 starts at 0, and the edited pose is already the final one);
while a node is like this, the *gizmo* does not appear on it.
**The front glass (S3b).** A simulation that carries the active camera's
front glass fed by the scene gives a `PHYSICS` clip to the
**camera** (`target` *Camera*, all shots), in the same undo
entry: it does not move the camera, it says which frame of its glass is seen at each
instant (the nearest; drops are not interpolated), also at 0 without
playing. It carries the **glass track** (`glass`: the camera, the fps and the
frames, the simulation's **key** —the FNV-1a of its `WET1` bytes and the
format version—, the contact angle with which its drops are drawn, the
drops of each frame and each mote with the frame it arrived in and the one it
left in, `f32` and `u32` *little endian* in base64): it is the cache that is saved with
the project. A simulation with the same key gives the same frames, bit for
bit; the inspector warns when the scene no longer gives the recorded key. A track
that cannot be read is removed on opening, like a node's.
**The parts (S3c).** A simulation with some effect on the parts gives a
`PHYSICS` clip to the **scene** (`target` *Scene*), in the same undo
entry: it moves nothing, it says which frame the parts show (the nearest),
also at 0 without playing. It carries the **parts track** (`parts`: the fps
and the frames, the **key** —the FNV-1a of its `WPT1` bytes and the format
version—, each part with its mesh, its triangles, its samples, the angle of
its drops and its porosity, the layout of the samples that the engine gave, each
drop with the frames in which it was as it was, the frame in which each
sample got wet and those in which the rain cleaned it, the drops and drips of each
frame and, since S3d, the drops in the air of each frame —the part each one
came from, its centre and its radius—, and, since S3f, the shape of each version
of each drop, in base64; version 3 of the format, and a track of before, without
them, is still read, its drops round; S3e: the studio floor's cells as they got wet,
and the dust's motes, version 4): the cache. A part whose mesh is no longer the recorded one
stays dry. A track that cannot be read is removed on opening.

**An animation** (`MotionClip`): name, target (part, group, model,
camera, light, environment, material), type, type parameters (amount,
axis, pivot, local or global; those of the explode, above), start and duration
in seconds, **time curve** (`EASING_KINDS`: linear, smooth, ease in,
ease out, strong, and **custom**, N1, `CUSTOM`: a cubic Bézier from (0, 0)
to (1, 1) with **two handles** (`MotionClip.curve`, x1, y1, x2, y2; the x within
0..1, so that it never goes back in time, and the y between −0.25 and 1.25, a
little overshoot), solved by Newton with bisection when the curve goes
vertical (`core/curve.ts`); or the **smoothness**, a control over the three
symmetric ones), **inverted** (yes/no:
it plays backwards and, before starting, holds its final state) and
**repeat** (n times in a row: the bar lasts n times its duration). Its plain-language sentence (“The camera orbits 90°
for 4 s, smooth”) is its default name and its representation in the
interface; it also appears **under its target in the scene tree**,
as KeyShot does (N1: under its part or group, and those of the model under the
model; those of cameras, lights, environment and materials only in the
timeline).

**Evaluation**: `evaluate(state, t)` returns the transforms and
parameters at instant `t` by applying each active animation with its
curve and composing per target (rotations are composed in
start order); it is a pure function that the preview uses to
play and the engine to render frame by frame. Two
animations of the same type on the same target and time are added if
they are translations or rotations and are marked in the interface if they cannot
coexist; they are never silenced.

**The timeline** (N6) has **three zones** so that it is clear
**what** is animated and **how**: on the left the **tree of what is animated**
(one row per target —the camera track first, then the model, its
groups and parts, the lights and the environment— with its animations nested,
each with its icon and short sentence); in the centre **when** (the
ruler in seconds and frames, the playhead and one bar per animation,
dragged and stretched with a **magnet** to the edges of the other
bars, to the playhead and to whole seconds); on the right **how** (the
properties of the chosen animation under a one-line header:
“Cap · Spherical explode · 1.5 × size · 0–3 s”). Choosing an animation
highlights its target in the viewport and draws its track (the orbit's arc,
the translation's arrow, the explode's vectors, the spin's axis); choosing a part in the scene marks the rows of what moves it.
The tree and the bars do not know the types: they read the sentence and the target,
and a new type (the physics simulation recorded on the
timeline) is drawn the same way.

**Playback**: the timeline has a playhead, fps (24, 25, 30, 60),
total duration (that of the last event), play, pause, go to the
start and to the end, loop, and **quick preview** (the rasterized
preview) or **rendered preview** (the engine at a few samples per
frame, a later phase).

**Fades** between cameras (N1): each shot says how it is entered
(`Shot.transition`): **cut** (no field, like all the earlier ones) or
**fade to colour**, black or white, of a duration (0.04–10 s, 0.5 s by
default) centred on the cut: the image goes to the colour in the first half,
the camera changes underneath and the image comes back in the second, with the smooth
curve and never longer than half of either of the two shots; in the
first shot, the animation starts at the colour and the image appears
(`shotFadeAt`). The engine renders the shot as it is and the frame is
mixed with the colour afterwards (in the image values, or in linear light in
linear formats); the viewport shows it over the framing while
it plays or the playhead is not at 0. The **cross** fade (two cameras
at once) is left for a later phase.

**Output**: in the render bar, the **Animation** mode adds a frame range
(all, or from–to), fps, and output as **video** (N1: WebM with
VP9, or VP8 where VP9 is not available, or MP4 with H.264, encoded in the page with
WebCodecs and written by our *muxers*; only what this system
encodes, asked at run time) or as a **frame
sequence** (PNG or JPEG with numbering, always available), with the
sample or time budget **per frame** and the estimate of the
total; the job enters the queue like any other and a video is **one
file**. A video has an even size (4:2:0).

### 3.8 · Render

It is configured in the **render window** (`UI.md` §2.7), in the style of
KeyShot's, and not in the bottom bar. A **render job**
(`RenderJob`) stores: mode (*image* or *animation*), name as
template, destination folder (in the browser, *Downloads* or a
folder chosen with file-system access where it exists),
format (PNG 8/16 bit, JPEG with quality, linear EXR, TIFF 8/16 bit
sRGB or 32-bit linear, linear RAW DNG), transparent
background (not in JPEG or DNG), **passes** (N2: alpha, depth, normals, part
id, one per file next to the image, in 16-bit PNG or EXR), camera (one or all),
**studio** (N2: the scene as it is, one of the saved ones or all), whether the files of what is
sent to the queue go in a single **ZIP** (N2), size in pixels with its print
size and **DPI** (the pixels rule; the DPI is written into the
file), **finish by** samples, by time (or whichever comes first,
in advanced) or **by noise** (E10: with adaptive sampling, when the relative
error of each pixel's mean falls below a threshold from 0.5 to
5 %, 1 % by default, with the samples as the cap; samples go where
the noise is, in 8 × 8 blocks, and each pixel is still the mean of
its own samples), advanced engine settings, in animation the range, the fps
and the output (MP4/WebM video or frame sequence), and the
**AI post-processing** with its settings (`AI-POST.md`): since X6 each band
control (Light, Bounces, Wear, Style strength) is a gain on what the model did
in its band (none at 0, as made at 50, twice at 100), the style is a colour
grade the guard applies itself, and the section's preview is first a stored
example (the reference scene by the Full engine with the test model, in
`public/ai-preview/`) that follows the controls without calling a model, with
*Preview my scene (Full engine)* for the job's own scene; the project still
stores `ai.previewFullEngine`, which is no longer read. *Render* puts the
job first in the **queue** and starts it; *+ Add to queue* puts it
at the end. In the state, `render` stores the window's settings
and the queue; each job carries its copy of the settings, state, progress,
creation, start and end dates, the ids of its results, the error if there
was one and the current frame. *All cameras* is expanded into one
job per camera when entering the queue; an animation is a single
job. Editing the queue is undoable; progress is not. The queue runs in series, with progress, pause, reordering and
cancellation (*Stop* the running job, which ends *Cancelled* and lets the
next one go on; *Remove* one that is waiting, which does not touch the others), **always with the full engine**. Each result stores the
engine image and, if there was post-processing, the AI one too, to
compare them with a sliding divider. The running job can be **watched
live** (U14; `UI.md` §2.5 and §2.8): when chosen in the queue, its image as the
engine accumulates it, reduced to what fits and with the samples and seconds that the
engine reports, at most twice a second and only while it is being looked at (the
engine does none while nobody is looking); a waiting job says it
has not started, and a finished one opens its result. The live view is interface
state, not project state: it is neither saved nor undone.

**The AI model through an API** (X7, `AI-POST.md` §8). Where the AI model runs
is an application setting of this computer, not of the project:
`ai.source` (`LOCAL` · `API`), `ai.apiProvider` (`GENERIC`, `STABILITY_SD3`,
`OPENAI_EDIT`; stable keys), `ai.apiEndpoint` (the generic endpoint: URL,
method, key header and prefix, more headers, body kind and template, answer
kind and path, longest side, multiple, fixed sizes), `ai.apiSendPasses`
(false), `ai.apiTimeout` (120 s), `ai.apiAttempts` (2) and `ai.apiConsent` (the
hosts allowed). None of them holds a key: **the API key is stored apart, on
this computer only** (the launcher's `<data>/ai/api-keys.json` on the desktop,
the site's local storage on the web), one per host, sent only to that host,
and never written in a `.repack`, the library, the settings document, a log or
a message. A render goes to a host only after the person allowed that host
(asked once, in place, revocable). The pipeline, its guard and its report are
the same as with a local model; every result an API returns is guarded, and a
rejected or failed one leaves the engine image as the result's own. A call
that fails (a refused key, a rate limit, a time-out, an answer that is not an
image or is far too large, a redirect) is tried again only when it can help,
at most *Tries of a call* times, and then the AI step ends with the reason.

**Passes, batches and ZIP** (N2). An image job can ask for, besides the
image, the object **passes** that the engine renders with it (`RNDR.passes`,
`ARCHITECTURE.md` §5.2): **alpha** (the objects' coverage from 0 to 1, with edges
smoothed like the image; the studio floor, the background and the environment are 0),
**depth** (the distance along the view axis), **normals** (in
world space, Z up) and **part id** (the instance number that the engine gives
to each part, with a `.json` legend of who is who). Each pass is a file next
to the image with its name plus `_alpha`, `_depth`, `_normal` or `_partId`, in **16-bit PNG** (grey, or RGB for the normals; depth
normalized to 0 = background and 65535 = the nearest, with the range in the file) or in
**EXR** (32-bit floats, the values as they are, `+Infinity` where there is nothing). A
transparent image background does not change the passes. An animation writes no passes.

The job's **studio** is the scene as it is, one of the **saved
studios** (the *Studios* tab; those of an old project too) or *all*:
the studio is put on a **copy** of the project and that copy is what is rendered,
with the job's camera (the studio does not take its view away); the open project is not
touched. *All cameras* × *All studios* is a **batch**: one job per camera
and studio (camera first), with the template's name (`{project}_{camera}_{studio}`,
whose chips say *Project*, *Camera* and *Studio*, gives four different files in a 2 × 2;
`{studio}` is the job's saved studio and, without one, the name of the product type as before). A job with a
studio does not go through the AI (its passes are drawn from the open project).

**The studio travels with the project** (N2b). When creating a job with a saved studio,
the project stores a **copy** of that studio (what *Restore* sets: lights, environment,
image, camera, per-part materials and visibility), one per studio and content
even if many jobs use it, and the job names it by the *hash* of its content.
That copy is what the job renders: with the project opened on another machine or in another
browser profile without that studio in the library, the jobs come out the same; and if the
library has a studio with the same id but other content (it was saved over), **the copy
wins** for the jobs that were already there; a new one takes the studio as it is now.
Editing a job without changing its studio keeps its copy; changing it takes that of the
new one. The copy leaves the project with the last job that names it (and comes back with
undo). Its HDRI, its background image and its textures are not stored twice: they go with
those of the project, once per image. A studio that arrived in the project and is not in
the library can be **added to the library** from the queue. A job from a
project earlier than N2b has no copy: it looks for its studio in the library, as before,
and without it fails with the reason and the queue goes on.

With **ZIP**, the files of the jobs that a *Render* or *+ Add to queue* command
put in the queue (images, passes, legends) are not saved one by one: they are accumulated and, when
the group's last job ends (finished, failed, stopped or removed), **a single ZIP** is written
(*store* method, own writer, `Project_0001-0004.zip`) at the
destination; if the ZIP could not be created, the files are saved one by one, so an image
is never lost. A group whose queue is paused waits in memory; closing the page
loses it.

**Plugins** (P6; `ARCHITECTURE.md` §9). Tools from other programs that
work on a **finished result**: they are installed in *Settings ▸ Plugins*
from the Repackshot registry or from an `.rpk` file, with their activation
key and under **their own licence** (closed in the film one, and it says so).
Each plugin installed with the `render.plugins` *slot* has its block in the
**Plugins** section of the render window, drawn from its manifest: its
recipes (with their public names), its controls, a **preview** of the
current result through the plugin with the numbers the plugin gives, and **Apply**,
which leaves a **new result** in the history next to its origin, with its
provenance (`provenance: { plugin, version, recipe, controls }`). Each plugin's recipe and
controls belong to the project (`render.plugins`): undoable and
saved with it; an earlier project has none. The recipes are a
**carousel** of cards, each with the plugin's base image (its test
scene) through that recipe, made once per machine and version; with no result
yet, the preview is that test scene. With **Apply to render jobs**,
each image of a queue job also goes through the plugin and
is saved next to the engine's; in an animation, each frame with its
seed, `seed + frame` (`provenance.seed` stores the seed and the
rule). A plugin does not touch the project: it receives pixels and returns pixels. The
first is the **film simulation by aintfilm** (the photo-editing and film-simulation
app by the same developer, in development).

### 3.9 · Studios, own library and project

A **studio** stores a camera, a light and environment setup, a set of
materials per part and the visibility of parts; restoring it is a single
undoable action. With an L6 set (§3.4) in force, the studio stores its
lights (the pool included) and its backdrop; its cards, sweep and floor are
pieces of the scene and stay in it. `GRADIENT` backdrop (L6): the environment
stores its two colours (`gradient`), in the project and in the library's
studios. The **project** is the complete state in a
`.repack` file, with the meshes inside. The content is JSON (the extension
distinguishes it from any other JSON); up to v0.1.6 it was called `.repack.json`,
and those files are still opened the same way (picker, desktop dialog and
when dropped on the window). *Save* and *Save as…* propose `.repack`;
saving over an open file writes it where it is, with whatever name it
has. The studios used by the queue's jobs go inside the project
(N2b, §3.8), even if the studio belongs to the library.

The **own library** stores what the user creates and wants to reuse
between projects: materials (*Save material as…*), light setups
(*Save setup as…*), product types (*Save as product
type…*: the current studio as a preset), studios and lenses (*Save
lens as…*, O2: the camera's traced lens with its iris and its non-physical
adjustments, the prescription by its catalogue key; O2c: an
edited lens, with its edited prescription and its name, also from the
lens editor with *Save to library…*). It appears as a
*Mine* tab in each catalogue, with thumbnails rendered by the product, is
persisted in the browser and is exported and imported as a JSON file to
take it to another machine. Factory presets are not edited: editing one
creates a copy of your own.

---

### 3.10 · Interiors and furniture

A **scene type** (*Product · Interior · Catalogue studio*) that
only changes default values (done in K1: `scene.type` in the project,
`scene/setType`, the `scene.typeBase` memory of what each type replaced, and
earlier projects open as *Product*); a parametric **room** as a node
(measurements, openings, material per surface, hidden front wall,
cyclorama); **windows that light the scene by themselves** (automatic portals, thin
glass, outside view on a plane with parallax); **interiors camera**
(straight verticals, eye height, panorama, elevations and plan,
automatic exposure, walkthrough; done in K3 except the walkthrough, §3.5 and
§3.6); interiors Doctor (seven scene checks, K1; the rest, with the
engine); light groups
adjustable after the render; furniture deliverables (cut-outs with alpha and
dimensions, variants, 360). The decisions, sources and phases are in
`INTERIORS.md`.

## 4 · The Doctor

Nineteen checks, each with detection and, when the project can
change something, a fix (`DOCTOR_CHECKS` in `src/data/doctor.ts`), and seven more
with the *Interior* scene type (below). The scene
ones are evaluated on the model: plausible scale
for the product type (a 3 m piece of jewellery is wrong), origin and
resting on the floor, normal smoothing, edge bevel (without a bevel, the
edges of a CAD model reflect nothing and give the render away), camera
clipping, lights visible to the camera by accident, and a dynamic part that
starts passing through the floor (S2: the fix raises it until it rests). The Doctor does not
change anything without being asked and explains each warning in one sentence.

**The engine ones** (D1, `src/core/doctor-engine.ts`) also look at what the
engine and the system say, which is not part of the project: the page hands it over
(workers, SIMD, whether the engine can *denoise*, the measured speed and what
the *Full* viewport's accumulation says) and, while it does not know, those
checks are *unavailable* with their reason (the engine is loading, is not
running, the *Full* viewport is needed, it is still measuring). Every fix changes the
project and nothing else: it goes through the *store* and is an undo entry. What the
project cannot change (`rt.wasm` is missing, the system gives a single worker, there is no
simd128) is a warning that says why and **has no fake fix**; if a *Settings* row
limits it (*Threads*, *SIMD*), the warning brings the button that opens it, because
the Doctor does not touch the application's settings (they are not undone).

| Check | Warns of | Fix |
| --- | --- | --- |
| `engine` · *Engine* | `rt.wasm` is not compiled, is older than the page, did not start, the system gives no *workers*; or the *pool* has a single *worker* (the system gives no more, or *Threads* says so and *Automatic* would give more) | none; with *Threads* involved, opens that row |
| `simd` · *SIMD* | the scalar build is running: the system has no simd128, *SIMD* is *Off*, `rt-simd.wasm` is missing, or the desktop engine has no vector path | none; with *SIMD* *Off*, opens that row |
| `denoise` · *Denoising* | it is on in the viewport and off in the render (the image would come out noisy), or at strength 0, or the engine cannot do it; off everywhere is a decision and does not warn | turns on the render's / returns the strength to 100 % (an engine without a *denoiser* has none) |
| `color` · *View transform* | with *Standard*, more than 1 % of the framing is more than one stop above white once the exposure is applied, and is clipped to pure white (read from the accumulation's histogram; *Filmic* and *AgX* do not clip and need no image). It is a **warning**, never a failure: a plain white background is meant to be clipped (C1) | proposes *AgX* |
| `caustics` · *Fireflies* | the accumulation has *fireflies*: pixels brighter than white, four times brighter than the best of their eight neighbours and, if the accumulation stores the squared luminance (with the viewport *denoise* on), with a single sample that contributes half of its light or more; it warns from 8 pixels (or one hundred-thousandth of the framing). With the image already filtered by the launcher's *denoise*, there is nothing to count | returns the caustics from *Off* to *Automatic* and clamps the indirect light at 10; if it is already so, it says that only more samples help |
| `output` · *Output format* | the animation comes out as video in a container that this system does not encode (what the browser says it encodes, since N1; a video that does get encoded is not a failure) | switches to a frame sequence |
| `budget` · *Time budget* | with the speed the engine measured here, the render's time does not reach the samples: with *whichever comes first*, less than half of those requested; with *Time*, less than a Draft | raises the time to what those samples need plus a quarter (the measured speed moves from one reading to the next), rounded to ten seconds |

`lighttree` (*Light tree*, from K4) and `persist` (*Persistent data*, specific to
Blender) remain in the list as *unavailable*: the engine does not yet have a light
tree, and in this engine there is nothing equivalent to persistent data. The
engine checks are run again when what they read changes (the interface
state, the image, engine, budget and animation-output settings of the
render, the image the viewport accumulates) and after undo and
redo.

**Interiors Doctor** (K1, `core/doctor-interior.ts`). With the *Interior* scene
type, seven more checks that do not need the engine, each with its
fix, which is a normal *store* action: *scale and units* (the scene
size outside 100 mm–30 m: rescales by the importer's factor or
by a power of ten), *opening for the sun and sky* (the camera inside
a closed space lit by the sun or sky and no glass or transparent
part: sets the *White studio room*), *window glass*
(a flat glass part with solid walls: makes it thin, on a copy if
another part shares the material), *lens* (less than 18 mm: 24 mm), *eye
height* (outside 0.3–2.2 m above the floor: 1.5 m, looking at the same point),
*near clipping* (that of a camera inside the room reaches the nearest
wall: half the distance) and *inverted normals* (a closed surface
or a flat wall that faces the wrong side for where the camera
is: flips them). In *Interior* the Doctor's scale check
does not compare with the product type's size. While the room node
(K2) does not exist, “closed space”, “opening” and “wall” are read from the box
of the parts, from glass and from transparent materials. With another scene
type these checks are not in the list.

---

## 5 · Import: what comes in and how

Import is the trunk of the product: what does not come in, is not
rendered. It behaves as in KeyShot: drag or *Import*, an options
sheet with values that work, and the part appears centred,
resting and framed.

**Formats and origin.** The source programs have proprietary native formats
with no public documentation; in a clean room they are not read (nor
will their binaries be analysed, see `README.md`). What is read is
what each one **exports** with one click, which is what anyone
who works with KeyShot does:

| Source | Native | Read? | Path that works |
| --- | --- | --- | --- |
| Rhinoceros | `.3dm` | **Yes** (openNURBS is MIT): render meshes saved in the file, layers, basic materials; B-reps without a render mesh warn to save with meshes | `.3dm` directly; or STEP / OBJ / FBX |
| KeyShot | `.bip`, `.ksp` | No (proprietary, no specification) | KeyShot's *File ▸ Export* to glTF, FBX, OBJ, USD or STL |
| Maya | `.ma`, `.mb` | No | FBX, OBJ, USD, glTF |
| SolidWorks | `.sldprt`, `.sldasm` | No (proprietary) | **STEP AP214** (what SolidWorks exports by default), IGES, 3MF, STL |
| ZBrush | `.ztl`, `.zpr` | No | OBJ (with polygroups), FBX |
| Fusion 360 | `.f3d` | No | STEP, OBJ, FBX, 3MF, STL |
| Blender, Cinema 4D, 3ds Max, SketchUp… | various | No | glTF, FBX, OBJ, USD |
| Universal | glTF / GLB, OBJ, STL, FBX, STEP, IGES, 3MF, PLY, DAE (Collada), USD / USDZ | **Yes** | directly |

STEP and IGES (real CAD: surfaces, not meshes) are tessellated on
import with adjustable quality, keeping **each CAD face** as a range
of triangles (which makes *Faces* select a whole face) and the assembly's
**colours and names**. FBX brings hierarchy, materials,
embedded textures and units. Mesh formats bring what they
bring; the importer rebuilds normals and sharp edges if they are missing, and
keeps the file's per-vertex normals when it brings them.

**Materials and textures from the file** (phase M2a). glTF and GLB bring their
materials read from their own JSON: metallic-roughness PBR (base colour,
metal-roughness with G roughness and B metal, normal with its `scale`, emission
with its factor and `KHR_materials_emissive_strength`, `alphaMode` and
`alphaCutoff`; occlusion has no slot and a warning is given),
`KHR_materials_transmission`, `_ior` and `_clearcoat`, and
`KHR_texture_transform` and each map's sampler as its mapping. OBJ
reads its `.mtl` libraries (`Kd`, `Ks`, `Ns`, `d`/`Tr`, `Ni`, `Ke` and the
PBR extension `Pr`, `Pm`, `Pc`; `map_Kd`, `map_Pr`, `map_Ns`/`map_Ks` as
inverted roughness, `map_Pm`, `map_d`, `norm`, `map_Bump`/`bump` as
a height map unless its name says it is a normal map, `map_Ke`, with
`-s`, `-o`, `-bm`, `-clamp` and `-imfchan`). FBX, Collada, 3MF, USD and 3DM
bring the maps that their three.js reader loads (colour, roughness, metal,
normal or bump, alpha, emission, with their transform). The images and
libraries that a model names and does not carry inside (those of an OBJ, a
`.gltf` with its `.bin` files, an FBX or a `.dae` with its images) are looked for
among the files **chosen or dropped with it**, by name. UVs are
stored per vertex, and a second set if there is one (glTF `TEXCOORD_1`, FBX
`uv1`). PNG and JPEG images travel in the project as they are; the others
are converted to PNG in the browser when the reader has decoded them, and those
that are not, are left out. The sheet says how many images are saved and how much
they weigh, and each one that is not (more than 16 MB, more than 8192 pixels on a side, not
PNG or JPEG, was not among the chosen files, the project already
carries 64 MB) and why; with *default material* none is imported.

**Import sheet** (inline, not modal), with the default values
already set: file **units** (mm, cm, m, inches; detected
when the format declares them), **up axis** (Y or Z; detected), **centre**,
**rest on the floor**, **frame the camera**, **add to scene** or
**new scene**, **group by** (object, material, layer), **keep
materials and textures** from the file or apply the default material,
**separate parts** (by material, by CAD face), **tessellation quality**
(CAD only: chord tolerance and angle), **import hidden layers**,
**flip normals**. A file dragged onto a scene with parts
asks *add or replace* inline.

The format-reading libraries live in the `io/` layer on the web
side and are loaded on demand; the render engine does not know them
(`ARCHITECTURE.md` §1).

## 6 · What sets this product apart

- **The viewport is the render.** In *Full* mode the image converges where
  you work and *Render* only saves it at full size; *Fast* mode
  exists so that editing lights and materials responds instantly, and the
  switch is always in view in the header.
- **Photographer's language** in all the controls and a written **intent**
  for each preset.
- **Catalogues for the eye**: light setups and materials are chosen by
  thumbnail, with filters by style and category.
- **Nothing breaks silently**: Doctor, inventory before overwriting,
  visible animation conflicts, an honest meter.
- **Everything scales with the part**: a recipe works for a ring and a sofa.
- **No environment to download**: the procedural studio dome lights
  and reflects without any HDRI.
- **Black-and-white interface**: the only colour on screen is the image.
- **Standard mode by default**: it opens ready to import and render;
  presets are shortcuts, and everything a preset does can be done by
  hand and saved as your own.
- **Imports what people export**: STEP, IGES, 3DM, FBX, OBJ, glTF,
  USD, 3MF, STL, PLY, DAE, with a KeyShot-style options sheet.
- **Own engine, in Rust and without dependencies**, which runs on any
  machine: in the browser through WebAssembly, on the command line and on
  the desktop natively, with the same result pixel for pixel.
- **Accessible by keyboard and by settings.** The Tab order follows the layout
  of each panel and there is no positive tabindex. Every button without text has its
  name, from `strings.ts`, in Spanish and in English. The command palette,
  menus, confirmations and windows keep the focus while
  they are open and give it back to the control that opened them. *Settings ▸
  Accessibility* offers the size of the interface and of the text, high
  contrast, *Reduce motion* (which also turns off smooth scrolling) and
  an always-visible focus. The main text (`ink-0`, `ink-1`) reaches
  7:1 on all its surfaces and the secondary (`ink-2`) 4.5:1 (WCAG
  AA; H1 decision, applied in C1), without flattening the hierarchy of greys.
  `ink-3`, the grey of what is switched off (disabled controls, hidden rows,
  separators), is below `ink-2`, with no minimum of its own except in high
  contrast, where it also reaches 4.5:1.
