# Studio tools: optics, environment, light, camera and particles

The lead's plan (2026-10-13), following a request to integrate, *in our own
way and without brand names*, what four Blender add-ons do (lens simulation,
an HDRI studio, a lighting tool and prefabricated camera moves) and a
**particle simulator of every kind**. The research behind it is in
`docs/research/` (`products.md`, `optics.md`, `hdri-library.md`,
`particles.md`), in English as it was prepared. The phases are in
`ROADMAP.md`.

## 0 · Rules that hold for this whole document

- **Clean room.** Of the third-party products only their public
  descriptions are used (pages, manuals, FAQs, changelogs). Their
  scripts, lens files, HDRIs, textures and videos are **never** bought,
  downloaded or read: they are GPL or commercial and would contaminate the
  project's PolyForm licence. No product or brand name appears in the
  interface, in the keys or in the presets.
- **Generic names.** Lenses are named by their optical family (*Triplet*,
  *Fast double Gauss*, *Petzval portrait*, *Inverted-telephoto wide-angle*,
  *Catadioptric*…), never by manufacturer or model; the commercial
  names of designs (Tessar, Sonnar, Planar, Biotar, Heliar,
  Cooke, Imagon) are not used, nor is “retrofocus”, which was a registered
  trademark (`docs/research/optics.md` §2.1, §2.6): the generic name is
  *inverted telephoto*. A test fails if a brand or a manufacturer appears. Glasses are stored as `nd` and `vd`, never by
  their catalogue name.
- **Provenance of every asset.** Every asset is created with an own,
  deterministic generator and stored as a **recipe** (parameters, seed,
  generator version) plus the *hash* of the result; a test regenerates it
  and compares. Lens prescriptions store as provenance the number of
  the expired patent or the book they come from (facts, not works).
  Nothing is generated with AI image models: they
  give no physical values (an HDR needs real radiances) and would leave
  authorship in doubt.
- **Physics first, artistic adjustments on top and visible.** What comes
  out of the optics or the simulation is computed; non-physical adjustments
  (more chromatic aberration, exaggerated swirl…) are applied on top,
  are marked as such in the interface and are stored separately.
- **Determinism** (rule 8b): same result on any machine and with
  any number of threads; only `+ − × ÷ sqrt` and the functions of
  `fmath`, never `f32::sin/exp/powf`.

## 1 · Optics: lenses, bokeh and aberrations

**What is built.** Two camera modes in the engine:

1. **Improved thin lens** (fast, the usual one): aperture shape
   (circle, polygon of 3 to 18 blades with roundness and rotation, mask
   image with 2D CDF sampling), pupil density profile
   (uniform, bright centre, bright ring, apodized), central
   obstruction (mirror ring), cat's eye approximated by intersection
   with a second disc displaced according to image height, anamorphic
   (horizontal and vertical focal lengths, elliptical pupil, desqueeze),
   **shift and tilt** (*tilt-shift*: tilted plane of focus), *split diopter*,
   per-channel chromatic aberration and
   swirl as an adjustment. It covers most bokeh types without
   tracing the lens.
2. **Traced lens** (Kolb, Mitchell and Hanrahan 1995): the camera traces
   each ray through the real surfaces of a prescription (radius,
   thickness, `nd/vd` glass, semi-aperture, aspheric, cylindrical, mirror,
   diaphragm) from the sensor towards the pupil, with the stable `f32`
   intersection the research recommends and exit-pupil bounds
   precomputed per image height. These come out *by themselves*:
   distortion, optical and mechanical vignetting, cat's-eye bokeh, bubble
   or creamy bokeh depending on spherical aberration, coma, astigmatism, field
   curvature, lateral and longitudinal chromatic aberration, focus
   breathing and the character that changes when stopping down. Measured cost:
   0.4–1 µs per camera ray (6–16 surfaces), small compared with
   tracing the scene.

**Chromatic aberration** (decided): each camera sample picks one of
**three bands** (R, G, B), stratified, and traces the lens with the index of
that band (from `nd` and `vd`); the scene stays RGB and the sample weighs only
its channel. It gives the colour fringes without a spectral scene and without the noise
of a single wavelength.

**Bokeh, every type and selectable as is.** A *Bokeh* selector with
a thumbnail per type (the core of the blur rendered by the engine
itself): disc, polygonal (straight or curved blades), cat's eye,
swirl, bubble (bright ring), creamy (bright centre), onion
rings, catadioptric donut, anamorphic oval with streaks, apodized,
coma (comet), double line or nervous, colour fringes, textured
(dust, streaks, filter), custom shapes (star, heart…), multi-hole
diaphragm, diffraction edge (coming soon: needs wave optics) and focus breathing. Each type is a saved combination of
mode-1 parameters or a mode-2 lens; the user picks it and,
if wanted, fine-tunes it.

**Starting lenses** (`src/data/lenses.json`, stable keys; done in
A6): the 16 prescriptions of `docs/research/optics.md` §2.3 with a generic
name and their provenance (expired patent or book): triplet; four-element
split-rear; Petzval portrait; five-element symmetric;
double Gauss normal; double Gauss fast f/1.4; fast asymmetric f/1.5;
internal-focus telephoto; inverted-telephoto wide-angle; fisheye 180°;
catadioptric mirror; variable soft-focus; floating-element macro; achromatic
doublet; single meniscus; 2× anamorphic adapter. **Number of elements and groups**,
length and aperture are shown from the prescription, never invented.

Each lens record follows `optics.md` §5 and adds what A6 needed:
the surfaces go in **one signed global frame** (light travels
towards +z, a positive radius has its centre at +z, `d` is the signed distance
to the next surface and a mirror reverses the direction, so
the distances that follow it are negative; the catadioptric is kept as an unfolded
sequence); the glass is `{ nd, vd }`, plus `vdEstimated` when the
source does not give the Abbe number and `native` when the source gave indices of the
e line (the catadioptric and the fast double Gauss: `nd` is converted with
the report's formula and the native values are kept); `status`
(`verified`, `caveat`, `experimental`, `own-design`) and `stopBasis`
(`stated`, `assumed`, `placeholder`) say how far the prescription and the
position of the diaphragm can be trusted (the six that the source gives and
the nine that are assumed at the middle of the gap the report names; the
paraxial focal length and back focus do not depend on it, the look with the
diaphragm stopped down does); `reported` keeps what the report traced and what the
patent says, against which `tests/lenses.test.ts` compares an own paraxial
trace (0.05 % against what the report traced, 1 % against the patent).
The coatings by era, the diaphragm values and the bokeh values are
**provisional** until O1 judges them with renders (rule 11).

**Coatings and flare.** Reflectance per surface according to the treatment:
**uncoated** (~4 %), **single layer** (~1.3 % with a tint), **multilayer**
(~0.3 %), with their thin-film interference colour; from there come
the transmission (T-stop), the contrast veil and the flare **ghosts**
(tracing the paths with two reflections, cheaper in a separate
pass) and the lens's **colour tint**. **Diffraction
starburst** by blades (even/odd rule), **bloom and halation** as a
physical image effect on the linear buffer.

**Lens editor and own presets.** In the camera inspector:
a selector by **character** (*Clinical · Soft · Swirl · Vintage ·
Anamorphic · Macro · Wide · Tele*), the family, focal length, f/,
blades, mask, coating, focus, *tilt-shift*, and in *Advanced* the
artistic adjustments marked *non-physical*. A **cutaway of the lens** in SVG
drawn from the prescription. **Save lens as…** to the own
library (U4), with the prescription and the settings; changing lens never
touches the output resolution.

**Done in O2 and O2c** (this was phase O5 in the `ROADMAP.md` table). O2 made
the character selector, the SVG cutaway, the marked non-physical adjustments and
*Save lens as…*; O2c, the **element editor** (`UI.md` §2.11):
radii, thickness, glass, size and air gap of each element, add, delete and
flip 180°, on a copy that the engine checks before putting it on the
camera. Where O2c departs from this paragraph: the own lens stores the
prescription **only if its elements were edited** (otherwise, the catalogue key
and the settings, as O2 decided); the size of an element is its
clear aperture; the measurements are those of the design, which the engine scales to the
camera's focal length.

**Done in O1.** All of mode 1 in `rt-core/src/optics` (RSB section
`LENS`, optional, after `CAMR`): round diaphragm, 3 to 18
straight or curved blades with rotation, or a mask by 2D CDF; pupil
textures; the four profiles of `PUPIL_PROFILES`; obstruction; cat's eye
by a second disc (with its vignetting); 1.33× and 2× anamorphic with the
image desqueezed; shift and Scheimpflug plane of focus;
chromatic aberration by three bands (decision 3) and swirl as adjustments
marked *non-physical*. All with its exact density and without rejection; an RSB
without `LENS` does not change a single bit. In the interface, *Camera ▸ Bokeh* with the
thumbnails of the 16 types that mode 1 makes, rendered by `rt`
(`tools/bokeh-thumbs.mjs`), and *Advanced optics*. The *split diopter* and the
anamorphic streaks (`streaks`, flare pass) are not part of O1; the
sheet `out/bokeh-sheet.html` awaits the verdict on the values of
`bokeh.json` (rule 11).

## 2 · Environment: own HDRI studio

**What is built.** A **pin-based environment editor** (vector shapes
on the sphere): rectangular softbox, disc, ring, strip,
gradient (linear, radial, mirrored), *scrim* with a hot spot,
flag or cutter that removes light, user image, sun and sky. Each pin
is defined by the **illuminance** it gives at normal incidence (in relative
stops) and its colour temperature; the generator computes the painted radiance
with the closed forms of `docs/research/hdri-library.md`
§4.1. The engine **evaluates the pins analytically** in every direction (no
baking, independent of resolution) with an importance-sampling table that is rebuilt when
they change. *Place highlight*: click on the
part and the pin moves so that the reflection lands there. **Export HDR or
EXR** (2k, 4k, 8k) only when asked.

**Skies.** An own physical sky for daytime (phase E5c: the Hošek–Wilkie form with coefficients fitted to our atmosphere simulator, clean room; Preetham as an alternative); blue
hour and night with an own atmosphere integrator later on.

**Own library** (`src/data/environments.json`): the **39 recipes**
of the research (20 studio, 11 outdoor, 8 indoor), each
one a list of pins or a sky, with a generic name, a thumbnail on a
chrome ball and a grey ball rendered by the engine, and its *hash*. The
indoor ones are baked by rendering a room with our engine.
**Decided:** no downloads of third-party HDRIs are offered (this is removed from
K7); the user can import any HDRI of their own.

## 3 · Light: placement and shaping tools

On top of the own lights of L4 and the placement by reflection of L1:

- **Three placement modes**: *Reflection* (the highlight lands under the cursor),
  *Direct* (the light points at that point) and *Orbit* (rotates around the
  target, with lockable axes); normal smoothing with a
  *Precise* mode; obstacle avoidance with a ray; **automatic power** that
  keeps the illuminance on the target when size or distance change
  (computed by the engine, rule 10).
- **Light shaping**: emitters with a procedural profile (*scrim* with
  feather, tilt and imperfection, octabox, strip with grid, umbrella,
  beauty dish, LED panel, ring), **gobos** (patterns projected
  in light space with *keep upright*, without trapezoidal
  distortion), **flags, negative fill and reflectors** as
  cards with their own visibility.
- **Fine control**: **diffuse / specular** balance per light (weights per
  lobe in NEE and MIS, no auxiliary lights), **light and
  shadow linking** per part, **solo** of one light, deterministic flicker.
- **Measuring**: **false colour** by zones (11 one-stop zones) and a spot
  meter with the engine's luminance; **bake the light setup to an environment**
  (analytic evaluation of the emitters, noise-free) to export it or
  use it as an HDRI.
- The gobo patterns and the emitter profiles are **own
  recipes** generated by code; no library is copied.

## 4 · Camera: prefabricated moves

On top of the animation of N1 and the walkthrough of N3:

- **Library of moves** in units relative to the product
  (degrees, % of the framing distance, fraction of the sphere that
  encloses it), each one expands into timeline bars and is a pure
  function of time: *Turntable*, *Three-quarter push-in*, *Pull-back
  reveal*, *Arc rise*, *Truck slide* and *Pedestal*,
  *Dolly zoom*, *Spiral up* and *Spiral down*, *Rack focus between two parts*, *Macro
  edge slide*, *Exploded-view orbit*, *Crane*, *Whip
  pan*. Without the action categories (shots, falls…) that are no use
  for products.
- **Handheld camera** with band-limited noise and a seed (*subtle ·
  medium · strong*), scaled by focal length and distance; **speed
  ramps** with the own time curve; **motion blur**
  from the engine (shutter in degrees).
- **Drawing the path** on the floor or on a sphere around the
  part, **recording a free flight** and simplifying it to editable points,
  **target lock** with smoothed rotation.
- Preview inside the application (trajectory and framings in the
  viewport and animated thumbnail), without external videos; 2.39:1,
  9:16, 1:1 and 4:5 aspect ratios in the render window.

## 5 · Particles of every kind

> **S0 decided** and **S4a done** (`ROADMAP.md`, section “Studio
> tools”): stateless air particles (dust, pollen, rain,
> snow, smoke dust, ash, bubbles, confetti) as effects of the
> *Ambient* section of *Scene*, simulated by `engine/crates/rt-sim` and
> rendered by the engine as spheres, discs and capsules (`FXAM`,
> `ARCHITECTURE.md` §5.2). What is below is the rest of the family: the
> scene node with emitters, the forces that are not closed-form, the
> collision with the parts and the baked ones are still pending. The starting
> values of the S4a presets were accepted with the sheet
> `out/ambient-sheet.html`; the forward lobe, rain without
> caustics and the cost at the presets' densities are S4b. **S3**
> (first part) adds the drop shape, the per-particle shape mix
> and shape variation, and the camera's front glass with
> drops and dust as a still (`GLAS`, `ARCHITECTURE.md` §5.2
> octodecies). **S3b** makes the scene's rain and dust on that
> glass (`rt_phys::wet`, in the physics worker, with its cache in the camera's
> `PHYSICS` clip; §5.2 novendecies) and moves *Shape* out of
> *Advanced*; drops and dust on the parts and accumulating snow
> are **S3c**.

An **Effect** scene node with an emitter (point, surface of a part,
volume, curve or burst in one frame), amount, life, speed and
spread, size, spin, forces (gravity, wind, *curl noise* turbulence,
vortex, attractor, drag), collision with the parts,
material, seed and **freeze at frame** for stills. Two
classes (decided):

- **Stateless**: each particle is a pure function of (seed, id,
  time): dust, sparks, fireflies, bokeh lights, rain, snow,
  falling confetti, rising bubbles, scatter. It fits deterministic
  animation and needs no cache.
- **Baked**: they interact with each other and are stored in a cache: dropping and
  settling parts (rigid bodies), grains, cloths and ribbons, liquids,
  smoke and steam. A single **position-based dynamics (XPBD)** framework for
  rigids, cloths, hair, grains and liquids (PBF); grid smoke (Stam).

Presets with generic names (`docs/research/particles.md` §5.4):
ambient (dust motes, pollen, haze, light shafts, ground fog,
steam, mist, perfume spray), surface (condensation, dew, beads,
running drops, frost), scatter (on surface or in volume,
sprinkles, pebbles, grass, fur, bristles), drop and settle (grains,
pills, ice cubes, ingredients), bursts (powder, colour, confetti,
petals, glitter, sparks), liquids (splash crown, falling fruit,
pour, ripples, bubbles, foam, drips), weather (rain, snow,
hail, leaves in wind), light (fireflies, bokeh lights, embers, trail,
flame), float (levitation, orbiting parts, zero-gravity ingredients)
and fabrics (cloth over the part, ribbon, paper). The starting values of
each preset are set by the lead with captures.

What the engine needs, in order: compact instance sets
(millions), spheres, motion blur, volumes (delta and ratio
tracking, HG phase, blackbody emission), curves for hair and
grass, and reconstructed liquid surfaces.

## 6 · Assets: what is created and how

| Asset | File | How it is created |
| --- | --- | --- |
| Starting lenses | `src/data/lenses.json` | The 16 prescriptions of the research, transcribed with their provenance and checked with a paraxial focal length and back focus test (A6, done) |
| Bokeh types | `src/data/bokeh.json` | The 20 types as combinations of parameters (or the traced lens that gives them, or wave optics: coming soon); thumbnails rendered by the engine (A6, done; the thumbnails, with O1) |
| Aperture masks and pupil textures | `public/assets/aperture/` | Own generator (`tools/assets/aperture-masks.mjs`): 45 PNGs of 512²: polygons of 3 to 18 blades, straight and curved, stars, heart, multi-hole, rings with obstruction, onion rings, dust, streaks, mesh; with recipe, seed and *hash* (A6, done) |
| Environments | `src/data/environments.json` | The 39 recipes; the HDRs are generated on demand or on export, they are not committed; small thumbnails are |
| Emitter profiles and gobos | `src/data/light-shapes.json`, `public/assets/gobo/` | Procedural recipes (softbox, octabox, strip with grid, umbrella, dish, panel, ring; blinds, window, noise leaves, dots, grid). The gobos are done (A6, `tools/assets/gobos.mjs`, 12 PNGs of 1024²); the emitter profiles, with L7 |
| Camera moves | `src/data/camera-moves.json` | Data in units relative to the product: **14 moves** (the 13 of §4 with the spiral split in two, up and down) and 3 handheld camera presets; `src/core/camera-moves.ts` expands them into bars (A6, done) |
| Particle effects | `src/data/effects.json` | Keys and names; starting values set by the lead |

First to be created are those that need no new engine (lenses, bokeh
types, masks, gobos, camera moves); the environments when the pin
evaluator exists.
