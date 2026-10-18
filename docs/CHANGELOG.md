# Changelog

Each version lists what it brings, grouped by area. In parentheses, the
roadmap phase (`ROADMAP.md`) each line comes from.

## Unreleased

### AI post-processing

- **Every control does what its sentence says, step by step**: Light, Bounces, Wear and micro-detail and Style strength are now a gain on what the model did in their band (none at 0, as the model made it at 50, twice at 100), where before they could only let through half of it at their defaults; the default Intervention asks the model for an img2img strength of 0.3 (0.2 before; 0.6 at 100) (X6).
- **The style is a real colour grade**: each of the six styles, *Natural* included, is a grade the guard applies itself, the same with any model; before, a style was only words for the model and the six gave the same pixels (X6).
- **The preview is a stored example**: the reference scene rendered by the Full engine and passed through the guard with the test model at every step of every control, which changes as a slider moves without calling any model, says what it is and at which values it was made; *Preview my scene (Full engine)* runs the AI on the job's own scene, always drawn by the Full engine (X6).
- **What the guard did, in plain words**: where its caps held Light, Bounces, Wear or the style's overall change back, how much of a material's colour change it kept, and which checks made it lower the strength; and under each control, what it acts on (X6).
- Fixed: an AI model that changed nothing brightened the image by a hair (the guard's median of the overall change was half a histogram bin off); the focus check rejected the Wear a material in focus rightly took next to an out-of-focus floor (X6).

### Engine

- **`rt-post`**: the band gains (`BAND_GAIN_AT_100`), the styles' grades (`style.rs`), `MAX_STRENGTH` 0.6, the job's style (`RPJ2`; `RPJ1` still reads, as *Natural*), the report's `capped` and each material's `kept`, and a deterministic **test model** (`test_model.rs`) that `post.wasm` exports (`post_test_model`) and `rt-fake-sd` serves as its `model` image. `tests/fixtures/ai-guard.json` moves on purpose with the guard's new law (X6).
- **`rt --ai-inputs <prefix>`** writes the linear image (`RPL1`) and the passes (`RPP1`) of a render, what the AI post-processing starts from (X6).

### Tools

- `tools/ai-preview-sheet.mjs` makes the stored example (`public/ai-preview/`, 161 WebP images, 0.74 MB) and a contact sheet; `tools/ai-x6-check.mjs` checks the section in the browser and makes its captures; `tools/ai-post-check.mjs` follows the new preview (X6).

### Scene and ambient

- **Drips and splashes fall through the air**: the drop that drips off a part and those a splash throws fly with gravity and the air (at most at their terminal velocity) and settle afterwards, where they land, instead of at once; while they fall they show in *Fast*, in *Full* and in the render, and the physics bar says how many are in the air (S3d).
- **The meter says what is on the parts**: *Rain*, *Dust*, *Snow* or whatever there is together, on how many parts and, with rain, the drops on them and in the air (*Rain and dust on 4 parts: 1,443 drops, 12 in the air*), or *Nothing on the parts yet*; before, it said *Rain on the parts* even with only dust or snow (S3d).
- **Notice for an engine that would not draw the drops in the air**: with an older render engine (with bit 8 and without bit 9), a drops effect says so below *On the parts* (S3d).

### Engine

- **Drops through the air in `rt_phys::wet_parts`**: the drip and the drops of a splash fly (gravity and a drag with Atlas, Srivastava and Sekhon's terminal velocity) and settle on the first face they meet from the front, in a later step; each frame lists them (S3d).
- **The `WETF` section**: the scene's drops in the air, which the engine draws as water spheres next to the caps; bit 9 of the capabilities (`FEATURE_WET_FLIGHT`, `/api/info` says 1023) (S3d).
- **The drops with their part's id in the part and material passes**: a cap, that of the part it is on; a drop in the air, that of the part it came from (before, that of the caps' instance) (S3d).
- New pinned hashes: the parity scene with the drops in the air (`PINNED_S3D_FLIGHT_4SPP`, `rt --write-s3d-flight-example`) and its six passes (`PINNED_S3D_PASS_*`), the same in scalar, SSE2, AVX2, with 1, 4 and 16 threads, in `wasm32-wasip1` and in the real `rt.wasm`. `PINNED_WET_PARTS` and `PINNED_S3C_WET_4SPP` move, on purpose: the parts simulation is no longer S3c's; with S3c's scene, the engine gives its earlier image (S3d).

### Tools

- `tools/s3d-check.mjs`: the note for an engine without bit 9 (in English and in Spanish; with dust, none), the drops in the air with the physics bar and the new meter with its capture, the meter with only dust, and the achromatic chrome; the sheet `out/rain-dust-sheet.html` carries the drops in the air of each photo of the parts and says how many there are (S3d).

## v0.1.21 — 2026-10-18

### Scene and ambient

- **The *Shape* leaves *Advanced***: it is one of the always-visible controls of an effect, right after the *Size*, with the *Mix* weights below it (S3b).
- **Rain, dust and snow fall on the parts** (*On the parts*, in the controls of *Rain*, *Water drops*, *Dust motes*, *Pollen*, *Dust cloud*, *Ash* and *Snow*): *Start* on the physics bar simulates them on the parts that do not move. Drops settle and splash, merge, stay anchored until their critical size according to the part's material, slide over the surface from face to face, hang and drip off the edges onto what lies below, and leave the surfaces wet (glossier, and darker on porous ones); dust settles where the part is flat enough and sliding rain carries it away; snow piles up where it is supported. What is sheltered stays dry. The set's parts get wet as a film. The recording is a *Physics* clip of the scene that is saved with the project; *Fast*, *Full* and the render show the playhead's frame, and the bar says how many drops and drips there are (S3c).
- **Notice for an engine that would draw the parts dry**: with an older render engine (without bit 8), the effect says so below *On the parts* (S3c).

### Camera and lens

- **The front glass in *Fast***: an approximation made with the drops and motes the engine places, the drops as soft discs with a dark edge and the dust as a tint or a few motes, as defocused as the aperture leaves them; the meter says it is an approximation and of how many drops and motes (S3b).
- **The front glass fed by the scene** (*Drops and dust ▸ From the scene*): *Start* on the physics bar simulates the rain and dust of the *Ambient* effects falling on the glass. Drops settle where the rain crosses it (a camera looking down does not get wet with vertical rain; with wind towards it, it does), merge, stay anchored until their critical size and slide according to the camera's up, and their trail carries the dust away; dust stays where the glass faces upward. The simulation is recorded in a *Physics* clip of the camera that is saved with the project; the inspector says which effects feed it, what is at the playhead and whether the scene has changed since it was recorded (S3b).
- **Notice for an engine that would draw the scene's glass clean**: with an older render engine (without bit 7, such as an earlier desktop launcher), *Camera ▸ Lens ▸ Filters ▸ Front glass* says that the render will show the scene-fed glass clean (S3c).

### Engine

- **`rt_phys::wet`**, rain and dust on the front glass, fixed-step and deterministic: arrivals by each effect's flux through the glass face, drops that merge by volume, anchored by the hysteresis of their contact line (Furmidge) and that slide with their trail, dust with an angle of repose that the trail cleans; the WET1 format and `wet_*` in `rt.wasm` (S3b).
- **The glass drop by drop**: the end of `GLAS` carries the drops and motes of a simulated glass, and the engine takes them as they are; capabilities bit 7 (`FEATURE_GLASS_LAYOUT`, `/api/info` says 255). `rt_scene_glass_len` / `_copy` give the page the glass as the engine places it (S3b).
- New pinned hashes: the parity glass after 5 s of rain (`PINNED_WET_PANE`) and the example through it (`PINNED_S3B_WET_4SPP`, `rt --write-s3b-wet-example`; the WET1, `--write-s3b-wet-spec`), the same in scalar, SSE2, AVX2, with 1, 4 and 16 threads, in `wasm32-wasip1` and in the real `rt.wasm`. No previously pinned hash moves (S3b).
- **`rt_phys::wet_parts`**, rain, dust and snow on the parts' meshes, fixed-step and deterministic: samples per triangle, arrivals by each effect's flux with what stands in between, splashes (Mundo, Sommerfeld and Tropea), Furmidge with tangential gravity, sliding from triangle to triangle with their trail, hanging and dripping, parts as a film, dust and snow with their angle of repose; the WPT1 format and `wpt_*` in `rt.wasm` (S3c).
- **The `WETP` section**: the water, dust and snow of each sample of an instance and its drops; the engine puts dust, a film of water (and darker porous surfaces) and snow on top of the material, and draws the drops as water caps. Capabilities bit 8 (`FEATURE_WET_PARTS`, `/api/info` says 511) (S3c).
- New pinned hashes: the parity parts after 5 s of rain, dust and snow (`PINNED_WET_PARTS`) and their render (`PINNED_S3C_WET_4SPP`, `rt --write-s3c-wet-example`; the WPT1, `--write-s3c-parts-spec`), the same in scalar, SSE2, AVX2, with 1, 4 and 16 threads, in `wasm32-wasip1` and in the real `rt.wasm`. No previously pinned hash moves (S3c).

### Tools

- `tools/s3b-check.mjs`: the *Shape* among the visible controls, the glass in *Fast* and the rain on the glass with the physics bar, with its three captures; `tools/rain-dust-sheet.mjs`, the `out/rain-dust-sheet.html` sheet (rain at 0, 2, 5 and 15 s and dust at 0, 30 and 120 s on the glass, with the drawing of the glass beside it) (S3b).
- `tools/s3c-check.mjs`: the notices of an engine without bit 7 or without bit 8 (with an `rt.wasm` of patched capabilities, `tools/wasm-features.mjs`), rain on the parts with the physics bar and its capture, and the achromatic chrome; the `out/rain-dust-sheet.html` sheet adds the bottle on the *Perfume* product-type set under rain at 0, 2, 5 and 15 s, dust at 0, 30 and 120 s and snow at 0, 10 and 30 s (S3c).

## v0.1.20 — 2026-10-18

### Materials

- **The wood of the *Wood* family shows its rings, pores and knots in *Fast***, like the same wood with the *Wood* node: the preview bakes it through the graph that *Simple → Nodes* gives, the same path, and the same pixels come out. Before, in *Fast*, it had only its average colour and its knots; in *Full* and in renders nothing changes (M3d).
- **The knots of a wood in *Fast* fall where *Full* puts them**: baked wood (that of the family and that of the *Wood* node) no longer carries the knots in its bake, placed in the parts' box, but on top, on each part and with its mesh's test, like the engine. On the knotty pine ball, the three visible knots fall within a tenth of a pixel of those in *Full*; the family and the node still give the same pixels (M3e).
- **The fabric of the *Fabric* family is woven in *Fast* when its threads are visible**: if a thread takes up at least 2.5 texels of the bake on its parts (on a 120 mm part, canvas, mesh, carbon and knit), the preview bakes it through the *Fabric* node and puts its fuzz on top; a finer fabric stays with its average colour, without moiré, as before (M3e).
- **A material fade on a knotty wood shows in *Fast***: the copy of each part with its knots did not become transparent with the fade (M3e).

### Scene and ambient

- **Drop shape** in *Ambient ▸ Advanced ▸ Shape*: a round body and a tip that follows it, against the velocity (a falling drop points upward), with its *Drop length* and its *Tip*. In *Full* and in renders the water of a drop refracts like that of rain, without caustics (S3).
- **Mix of shapes**: *Shape ▸ Mix* distributes an effect's particles among points, flakes, streaks and drops according to a weight per shape, and says the share each gives; each particle keeps its shape for good. And *Shape variation*: some drops and streaks longer or shorter than others (S3).
- New preset, **Water drops**: transparent drops that fall with their drop shape and different lengths (S3).
- The shape is now a list (*Point · Flake · Streak · Drop · Mix*): the five buttons did not fit in the inspector (S3).
- *Fast* draws drops as drops and each particle of a mix with its shape, the one the engine gives (S3).

### Camera and lens

- **Front glass** in *Camera ▸ Lens ▸ Filters*: a sheet in front of the lens with water drops and dust on it, like a lens in the rain or a wet window. Controls: *Drops* (the share of the glass they cover), *Drop size*, *Dust*, *Seed* and *Distance* (automatic, where the front element is, or up to 200 mm). The engine traces it as real geometry: each drop refracts like the lens it is (a soft disc with the scene upside down inside and the dark edge), those that touch merge into one with their volume, and the dust is dark, soft motes. Without drops or dust, the image does not change by a bit. It shows in *Full* and in renders; *Fast* does not draw it and says so (S3).

### Engine

- The **drop** as a particle primitive (the convex hull of two spheres, with its cone solved from the point of the ray closest to it) and the **mix of shapes** per particle, with the new fields of `FXAM` (228 B, written only when there is any: earlier effects keep their 200 B). `rt_particles_shapes` gives *Fast* the shape of each particle (S3).
- The **front glass** (`GLAS`, `rt_core::optics::glass`): drops as spherical caps that merge by volume and refract camera rays with their Fresnel and total internal reflection, and dust motes; the drops are on the glass, not in the frame (S3).
- Engine capabilities bit 6 (`FEATURE_DROPS`): an engine without it receives a drop as a sphere, a mix as its heaviest shape and no front glass (S3).
- Two new parity scenes with their hashes (`rt --write-s3-drops-example` and `--write-s3-glass-example`), the same in scalar, SSE2, AVX2, with 1, 4 and 16 threads and in the real `rt.wasm`. No previously pinned hash moves (S3).

### Tools

- `tools/s3-check.mjs`: the drop and the mix in *Fast* and the front glass in *Full* in Chromium, with its three captures; `tools/wasm-parity.mjs --expect-shapes` (S3).

## v0.1.19 — 2026-10-17

### Queue and project

- **A job's studio travels with the project.** A queue job with a saved studio (one, or *All studios* of a batch) saves in the project a copy of that studio, just one per studio even if many jobs use it, and renders in it. A project opened on another machine or in another browser profile, without those studios in the library, renders its batches just the same; before, they failed with *The studio “…” is not saved any more*. If the library has a studio with the same id but saved over, jobs that were already there keep their copy and a new one takes the studio as it is now (N2b).
- The HDRI, background image and textures of those studios go in the project **once per image**: a studio with the project's HDRI only adds a few kB of JSON (N2b).
- In the queue, a studio that came with the project and is not in your library has a line with **Add to my library** (N2b).
- Earlier projects open the same; a job from a project older than N2b looks for its studio in the library, as before, and if it is not there it fails with the reason. When edited with the studio in the library, it takes its copy (N2b).

### Camera and lens

- **Focal-length switch, *Keep the size of what is in focus***, next to the focal length in the camera inspector and in the palette. Off (the default, as in a camera), when the focal length changes the camera stays and the framing changes; on, the camera moves closer or farther along its axis so that the plane in focus (the distance, point or object of F1) keeps its size in the image: the perspective changes, not the size. A line below says which is active, and that with a locked, orthographic or panoramic camera there is nothing to move. Each arrow step, each drag and each typed value is an undo entry; the interior lenses follow it too. It is saved with each camera, in the project and in the library's studios; earlier ones open it off (C2).
- **Lens editor** (*Camera ▸ Lens ▸ Edit elements…*): the elements of a traced lens, on a copy (the catalogue's never changes): the radii, thickness, glass (those of the catalogue's lenses) and diameter of each one, smaller or larger, the air to the next, **adding** an element in front of or behind the chosen one, **deleting** one and **turning it 180°**. Each edit is an undo entry. After each one the engine checks the lens and gives the design focal length, flange distance, f-number, image circle, distortion and light towards the corner, with the cross-section kept up to date; a lens that forms no image, lets no light through or has a negative gap says why and is not applied, but you can keep editing. *Apply to the camera* sets it as the camera's own lens and *Save to library…* saves it in *Mine*; it goes back and forth with the project and with the library file (O2c).

### Materials

- **The *Wood* and *Fabric* nodes** in the material editor: the procedural wood of the *Wood* family (rings, figure, pores, fibres and knots) and the fabric of the *Fabric* family (weave, threads per cm, relief, twist), with the same parameters in the same units; they give colour, roughness, anisotropy, the normal of their relief and its height (the fabric, also its fuzz). Switching a wood or a fabric to *Nodes* gives its node connected to the output, and going back to *Simple* returns it as it was; the graph paints the same as the material in *Full* and in renders, and in *Fast* the rings are now visible (a cut through the front of the part) (M3c).
- The wood graph example becomes the catalogue's oak with the *Wood* node (*Oak (Wood node)*): it looks like the *Wood* family. Before it was two noises and a ramp with rings around the part's axis (M3c).

### Engine

- The information of a traced lens now also gives the **design focal length** (`designEflMm`: that of the prescription as written, before scaling it to the camera's), which the lens editor shows. Nothing of render: no pinned hash changes (O2c).
- **Pattern nodes in material programs**: eight new instructions (`WOOD`, `WOODR`, `WOODH`, `WOODN` and the four `CLOTH*`) run E6's wood and fabric with the same code as their family, placed on each part like the material (the mesh's box frame, the instance's scale and the knots with their surface test); the roughness is stretched along its grain or across the thread. E6's pattern scene painted with *Wood* nodes gives the same hash as the family's (`0x5ed1bf32`); the fabric one with *Fabric* nodes, a new one. Engine capabilities bit 5 (`FEATURE_PATTERN_NODES`); `rt --write-m3c-wood-example` and `--write-m3c-cloth-example`. No earlier pinned hash moves (M3c).

### Tools

- `tools/batch-check.mjs` also checks N2b in Chromium: a batch over two studios saved in one profile and opened in another with an empty library renders in its studios, and the queue offers *Add to my library* (N2b).
- `tools/lens-editor-check.mjs`: the lens editor in the built application with the real `rt.wasm` (open, add, turn, apply) and its two captures (O2c).

## v0.1.18 — 2026-10-17

### Camera and lens

- The **thin lens** is now called the **simple lens** (*Simple lens*), in the interface, the help and the documentation; projects still save it the same way and open unchanged (O4).
- **Bokeh and advanced optics belong to the simple lens**: with a traced lens they do not appear, and choosing a bokeh no longer takes the camera out of its traced lens by any path (if one arrives, a notice says it is an option of the simple lens). Going back to the simple lens finds the bokeh and advanced optics as they were. The three bokeh types of the traced lens (coma comet, focus breathing, variable spherical aberration) leave the grid, which keeps the simple lens's 17: they belong to its lenses in *Lens ▸ Traced lens* (O4).
- The traced lens has **More options** (formerly *Advanced*) with its own **tilt and shift**: the engine turns the real lens relative to the sensor until its plane of focus is the one the simple lens would have with the same tilt, and says how much it turns it; the rest of the diaphragm (roundness, rotation, obstruction) is also there. The anamorphic adapter does not tilt, and says so (O4).
- **Easier tilt**, on both lenses: the amount on a slider and the direction towards which the plane recedes on a dial with four shortcuts (*like the floor, like the ceiling, like a wall*); **Through two points…**: two clicks on the product set the tilt and the focus distance so that both come out sharp, in a single undo step; and the **plane of focus drawn in the viewport** while it is adjusted or always (*Show the plane*) (O4).

### Camera

- **Click-to-focus lands on the exact pixel** of the exact view: the click takes the primary ray the engine traces through that pixel (with the playhead's pose, the camera looked through with its own frame, the distortion of a traced lens) and what it hits, on both faces; the distance that makes it sharp is the engine's (the depth; with tilt, the hinge plane that passes through the point; with a traced lens, where the fine detail has the most contrast, which wide open lands millimetres from the paraxial plane). Measured on a tilted checkerboard with 135 mm at f/1.4: the sharp band passes through the click (F1).
- **Three focus modes per camera**: *Distance* (as before), *Point* (a point on a part that the focus follows when orbiting, approaching, moving the part, on the timeline, in the queue and in batches) and *Object* (a part, a group or the model, by its centre). In the camera inspector, with the distance as a logarithmic slider next to its value (in *Point* or *Object*, moving it switches to *Distance* from the distance it was following, in a single undo entry); in a part's menu, *Keep in focus*; in the palette, four commands. The viewport marks the selected camera's point. If the point's part or the object are deleted, the camera returns to its last distance and says so. Earlier projects and cameras open by distance (F1).
- With the interior cameras: the click also focuses with the orthographic, the 360° panorama and the fisheye (without depth of field: the distance is the point's), and with *Straight verticals*, where the level camera that is rendered counts (F1).
- *Through two points* (O4) leaves the camera focused by distance, in the same undo entry, and with a traced lens it focuses with its real rays: the average of what the engine solves for the two points (F1).
- Fixed: the *Full* viewport of a camera looked through used the active camera's frame (a 9:16 one focused up to 35 mm off in the corner); a traced lens in the *Full* viewport was traced for the viewport's sensor and was not the render's; the focus chosen with a click did not follow the camera when orbiting or approaching; and the click did not see the back face of a single-sided surface that the engine does render (F1).

### Engine

- `rt.wasm` exports `rt_scene_pick` (the primary ray of an image point and what it hits) and `rt_scene_focus_at` (the distance that focuses a point); `LENS` accepts `frame_sensor_mm` at the end. No pinned render hash changes; the peaks of the O1 and O2 scenes are pinned and checked in `rt.wasm` in CI (F1).
- **Tilted traced lens** (Scheimpflug through the real surfaces): the angle is solved with the lens's paraxial optics so that the plane is the simple lens's, the centre is refocused with real rays and the pupil limits are traced on a 9 × 9 grid of sensor positions. Without tilt, not a bit changes: all pinned hashes hold; a new one for the O4 scene. `rt --write-o4-example` and the `rt --tilt-sheet` sheet (O4).
- The tangent-space **Normal map** node no longer lets a normal point into the surface: a blue below 0.5 is reflected to the outer hemisphere, the same in the engine and in *Fast* (C1).
- The AI post-processing guard tolerates double by default: mean ΔE₀₀ 4 and 95th percentile 6 per material, and 4 px of edges, the same numbers as *Settings*. It measures an edge moved up to two pixels beyond the limit (before it did not see more than about 3 px) (C1).
- The **Normal map** node in part space also lets no normal point inward: with an intensity above 0.5 and a map against the surface, it reflects it in its plane (C1).
- Two pinned hashes move, and only because of the flakes of the M3b example's card (a noise in a normal map): `PINNED_M3B_PROGRAMS_4SPP` and the fifth of `PINNED_M3B_PROGRAM_VALUES` (C1).

### Interface

- **The viewport always starts in *Fast*.** Before, it started in the last mode, and on a fresh install that was *Full*: the engine started rendering as soon as the application opened, without a model. The *Viewport mode at start-up* setting disappears; *Full* is chosen in the top bar. `tests/start-mode-browser.test.ts` guards it, and it fails with the previous start-up.
- The default AI **intervention** goes from 30 to 50, and the guard's factory tolerances in *Settings ▸ AI post-processing ▸ Advanced* are doubled (4, 6 and 4 px). Saved settings that still had the earlier factory values take the new ones; a chosen one stays (C1).
- The guard tolerances in *Settings* **really apply**: each post-processing, in the queue and in the preview, takes them to the launcher or to the web guard (C1).
- The **Interior** scene type starts with the *Midday window* light recipe when the lights are those of the untouched product type; going back to the previous type leaves the lights as they were (C1).
- Choosing a set or a setup over the untouched product-type lights replaces them without asking; with own or edited lights, the *Replace · Hide · Add* question stays as it was (C1).
- Doctor: clipping with *Standard* is a warning (a plain white background looks for it) and the fix proposes **AgX** instead of *Filmic* (C1).
- The *Metallic paint with flakes* graph example tilts the normal with the noise's red and green and leaves the blue at 1: all the flakes face outward (C1).

### Accessibility

- Secondary text (`ink-2`) reaches 4.5:1 (WCAG AA) on all its surfaces: in the light theme it goes from `#6b6b6b` to `#5f5f5f`. Main text stays at 7:1 (C1).
- The *coming soon* label, the *Smoothing* range and the names of hidden rows and switched-off lights go from the muted grey (`ink-3`) to the secondary one, at 4.5:1 (C1).

### Tools

- `tools/o4-check.mjs`: both lenses in the built application (sections of each, the plane through two points as one undo entry, the plane in the viewport, the traced lens's tilt with the engine's angle, the return to the simple lens) and their captures; `tools/lens-check.mjs` and `tools/optics-check.mjs` follow O4 (O4).

### Documentation

- The SPEC says in a single place that the size of textures and procedurals is in millimetres, absolute, with *Fit to the part* as an option (C1).

## v0.1.17 — 2026-10-17

### Engine

- Two new camera projections: **equirectangular panorama** (360° × 180° in a 2:1 image) and equidistant **fisheye** (up to 360°, black outside the image circle), at the end of `CAMR`; a file without them keeps its bytes (K3).
- **Visible to camera** per instance (bit 2 of `INST.flags`, `INSTANCE_NO_CAMERA`): the camera does not see the part, while shadows, bounces and reflections still do; it is the plan with the ceiling that keeps giving light (K3).
- **Exterior multiplier** on the camera ray: it darkens what the camera sees of the environment, also through the windows, without darkening the light that comes in (K3).
- `rt_features` and `/api/info` say the engine reads the interior cameras (bit 4, `FEATURE_CAMERAS`); three new pinned images (plan, panorama and fisheye), equal on every SIMD path, with 1, 4 and 16 threads, in WASI and in `rt.wasm`; none of the earlier ones moved (K3).
- A new pass, **alpha** (the seventh, bit 6 of `RNDR.passes`): the coverage of the objects, from 0 to 1, with edges smoothed like the image (each camera sample counts if its ray finds a surface). The studio floor, the environment, the background and the light panels the camera sees are worth 0 (N2).
- `rt_render_tile_alpha` in `rt.wasm` and in the pool; the launcher's `RPP1` file carries it last, and the pool and the launcher give the same plane (N2).
- The pinned hashes of X2's six passes and of the images do not move; alpha has its own (`PINNED_PASS_ALPHA`, `PINNED_E5_PASS_ALPHA`), equal in scalar, SSE2 and AVX2, in WASI, in the real `rt.wasm` (`tools/wasm-parity.mjs --expect-alpha`, two new CI blocks) and through the launcher's API (N2).
- With a transparent background and only opaque objects, the alpha pass is the film's alpha bit for bit, also with edge samples (N2).

### Interface

- The **Light** section groups the catalogue into **Sets** (what builds background, floor, cards or pool of light with their lights: the 16 sets and the product type's rig) and **Lights** (what only places lights: the usual setups and the *Interior* recipes). Each group has its filters, which combine: *Product type* and *Subject* in *Sets*, *Style* (with *Mine*) in *Lights*, with the count of what they leave and a short notice if they leave nothing. No key changes (L7).
- With lights in the scene, choosing a set or a setup asks what happens to them: **Replace**, **Hide** (they stay switched off and the *Lights* list switches them on again) or **Add**, with *Remember my choice*; it is changed in *Settings ▸ Preferences ▸ Lights*. An undo entry that states the answer (L7).
- All the thumbnails of the light catalogue have the same size (that of the setups, like *Dark field*), and a button to the right of the section header makes them small, medium or large; it is remembered (L7).
- **Straight verticals** in the *Camera* section: the camera is rendered level and the lens is shifted to keep the framing, with the shift note; the *Interior* type switches them on (K3).
- **Eye height** with the presets *Standing* 1.5 m and *Seated* 1.1 m, and **interior lenses** 24, 28 and 35 mm (K3).
- **Projection**: *Perspective*, *Orthographic*, *Panorama 360° (2:1)* and *Fisheye*; the *Elevation* and *Plan* views; Fast mode draws panoramas from the six faces of a cube with the same map as the engine (K3).
- **Visible to camera** in the *Part* section, in Fast and in Full (K3).
- **Automatic exposure** in the *Image* section, with the *Brightness (EV)* control, the measurement in a note and in the status bar, the *Bright day · EV 7* and *Evening lamps · EV 5* presets and the *Exterior (camera ray)* slider; the *Interior* type switches it on (K3).
- *Settings ▸ Preferences ▸ Default render for new projects*: the *Downloads* and *Choose folder…* buttons of *Folder when finished* are no longer cut off. The icon was on its own line and the text fell below it, outside the button's 26 px; now icon and text go on the same line in any segmented control with an icon. `tests/seg-clip-browser.test.ts` guards it, in the browser and in both languages.
- *About*: the credits stay with the public literature the engine follows and the third-party licences.
- **Step arrows on every value**: each numeric field carries two stacked arrows **▲ ▼** on its right. A click steps up or down (with `Shift`, a tenth; with `Ctrl`, ten), and held down they repeat after a pause; a press, however long, is a single undo entry. The arrow that reaches the minimum or maximum switches off, and a disabled field switches off both. They are not tab stops: the field keeps its usual keyboard, drag and typing. In the X, Y, Z triplets and in a slider's field the pair is finer, and the value keeps the room it had (U15).
- **Sliders where they fit**: a value with a natural range (a factor from 0 to 1, a percentage, an angle in a fixed range) becomes a slider with its field and its arrows beside it: *Friction* and *Bounce*; the bokeh's *Rotation*, *Tilt* and *Tilt axis*; the *Angle* of a filter and of a circular pattern; the *Smoothing angle*; the *Rotation* of a texture and of a label; on an own light *Azimuth*, *Elevation*, *Rotation*, *Spread*, *Cone angle*, *Transition* and *Sun disc*; in the render window the JPEG *Quality*, the denoise *Noise* and *Strength*; in Settings *Orbit speed*, *Zoom speed*, *Gizmo size* and *Default intervention*. Distances, sizes, powers, counts and times remain fields (U15).
- The render window's **Time** field (`hh:mm:ss`) is now a numeric field like the others: it can be dragged, has its arrows (one minute per step) and is typed as a time, `mm:ss` or seconds (U15).
- The simple-lens controls that switch off with a traced lens (*Profile intensity*, *Cat's eye*, *Tilt*, *Tilt axis*) can no longer be dragged while they are off (U15).
- **Passes** in the render window, where it said *coming soon*: *Alpha*, *Depth*, *Normals* and *Part ID*, each a file next to the image (`<name>_alpha`, `_depth`, `_normal`, `_partId`), in 32-bit float **EXR** or **16-bit PNG**; the part ID carries a `.json` legend of who is who (N2).
- **Studio** in the render window: the scene as it is, a saved studio or **all**; with *All cameras*, a **cameras × studios batch** (2 × 2 gives four images, camera by camera), with the template `{project}_{camera}_{studio}`. The studio is put on a copy of the project: the open project is not touched and the camera keeps its view (N2).
- The window says the size of the batch (*Batch of 4 images: cameras 2 × studios 2*) and warns when the template would give two files the same name (N2).
- **ZIP**: a switch packs the files of whatever a *Render* or *+ Add to the queue* command put in the queue into a single ZIP (own writer, uncompressed, no dependencies), which downloads when the last job of the group finishes; if the ZIP could not be created, the files are saved one by one (N2).
- The queue shows each job's studio next to its camera and *+3 passes · ZIP* at the end of the name; *Stop* on the second of three jobs leaves it *Cancelled* and the queue goes on with the third (N2).
- `{studio}` in the name is the job's saved studio; without it, the name of the product type as before. A studio that is no longer saved makes its job fail with the reason and the queue goes on (N2).

### Tools

- `tools/batch-check.mjs`: in Chromium with the real `rt.wasm`, a 2 × 2 batch with alpha, depth and part ID in a 20-file ZIP that `unzip` and an own reader accept, the passes read by the specification, the 16-bit PNGs, and cancelling the second of three jobs; captures `docs/ui/batch-window.png` and `docs/ui/batch-queue.png` (N2).
- `tools/light-catalogue-check.mjs` checks in the browser the two groups, their filters, the question and the sizes, and makes L7's captures; `tools/sets-check.mjs` and `tools/scene-type-check.mjs` follow the new section (L7).
- `tools/number-fields-check.mjs`: the arrows on all the fields of the start screen, a click and a held press on *Focal length* (one step, one undo entry each), the angles of an own light and the *Preferences* speeds as sliders; captures `docs/ui/u15-light-fields.png`, `u15-part-triplets.png` and `u15-settings-sliders.png` (U15).
- `tools/doctor-engine-check.mjs` types the render time into the new numeric field (U15).
- `tools/k3-check.mjs`: the interior camera in the browser on a test room (straight verticals, plan with the ceiling hidden, panorama, achromatic chrome), with three new captures (K3).
- `tools/render-window-check.mjs` no longer times out at its step (g): it closed the results viewer with a fixed pause, and an Esc that arrived before the viewer opened deselected the body; *Copper* then asked for *Replace all* inside the palette, which was still open and swallowed Ctrl+Shift+Enter. Now it waits for the viewer before closing it, checks the selection and that the palette closes, and if something fails it says so within seconds; U5's four captures were re-recorded with today's interface, `render-window-animation.png` with video now available.

### Known limitations of this version

- There is no WASD walkthrough with a fixed height: it is left for the walkthrough phase (N3) (K3).
- The panorama is rendered whole, not in strips: strips belong to the deliverables (K6) (K3).
- In Fast, nothing is drawn on top of a panorama (outline, gizmo, glyphs) and the panorama carries no gradient background or background image: they show as colour (K3).
- Automatic exposure is measured by the page: a scene exported and rendered with `rt` outside the application carries only the compensation (K3).
- The image curve is the view transform; *Low contrast*, the long roller, ISO and shutter are still not done (K3).
- The *Interior* type does not move the camera to eye height; the presets are in the *Camera* section (K3).
- The alpha pass is an **object mask**: it is not the alpha of a render with a transparent background when the path goes through glass (which does count as a surface) or the floor is a shadow catcher with its shadow; a texture's cutouts count as a surface. With *Finish by noise* it carries the samples of the first round (N2).
- Passes are for images: an animation does not write them. Of the engine's six passes only four are offered (not albedo, material ID or circle of confusion) (N2).
- A job with a batch studio does not go through AI post-processing, and job plugins save their images separately, outside the ZIP (N2).
- The library's studios live in the browser: a project opened on another machine with jobs that use a studio that does not exist there fails them with the reason (N2).
- The ZIP is assembled in memory and written when the last job finishes: closing the page before then loses it, and a very large batch with EXR passes may not fit (no ZIP64, 4 GiB at most) (N2).
- Native command-line batches (`rt` reading projects, E8) are still not done (N2).

## v0.1.16 — 2026-10-17

### Accessibility

- The command palette keeps focus while it is open (Tab does not leave its field), closes with Escape from anywhere and returns focus to the control that opened it (H1).
- Menus and inline confirmations cycle with Tab without letting focus out, and when they close they return focus to the button that opened them; a window opened from the main menu (*Settings*) returns it to the menu button (H1).
- *Reduce motion* also switches off the smooth scrolling of the render window's plugin strip (H1).
- A browser test checks in 20 interface states, in Spanish and English, that every button without text has its name from `strings.ts`, the Tab order and the focus of palette, menus and confirmations (H1).
- A test measures the contrast of every grey text on its surfaces in the four themes. 36 pairs fall below 7:1 (auxiliary greys) and are pending a visual decision; no colour changes (H1).
- In the animation drawer, presets are announced as buttons again (inside a list), the tree of what is animated tells assistive technology which row is active and **↑ ↓** go to the animation above or below; the ruler, which is for the pointer, no longer has a label without a role (N1).

### Interface

- English: *Center* becomes *Centre*, like the rest of the strings in British spelling; the Spanish strings were reviewed (accents, tone) with no further changes (H1).
- **Encoded video**: in the render window in *Animation* mode, *Video* stops being *coming soon* and writes **a single file** WebM (VP9, or VP8 where VP9 is not available) or MP4 (H.264), encoded in the page with the browser's WebCodecs (also on the desktop, which is Chromium) and written by own muxers. Only what this system encodes is offered, asked at start-up; what it does not shows disabled saying why, and the frame sequence is always there. A video has an even size (N1).
- The Doctor's **Output format** check now reads what the system encodes: it warns only of a video with a codec that is not encoded here (a project made on another machine), with *Fix* to frames; a video that is encoded is no longer a warning (N1).
- New animation types: **Fade** (the opacity of a part, a group, the model or a material goes down to a percentage; reversed, it appears), **Pan** (the camera turns on itself), **Material colour** (the colour of a material, and of all the parts that carry it, changes to another) and **Sun arc** (the sun travels its arc of the day around the celestial pole, 15° per hour). *Tour* stays reserved in the catalogue (N1).
- A **spin** or a **flip** of a part or group can turn around a **pivot**: the centre of another part (a lid on its hinge) or a point (N1).
- **Custom curve** with **two handles** that are dragged (one undo entry per drag), moved with the arrows or typed (N1).
- **Camera change** on the camera track: a click on a shot opens its properties (camera, duration, and *Cut*, *Fade to black* or *Fade to white* with its duration; the cross-fade, *coming soon*). The fade is drawn over the cut, shows in the viewport on playback and comes out in every rendered frame (N1).
- The **wizard** of *+ Animate…* goes in **three steps** with *Back* and *Next*: the target (also *A material*), a **grid of cards** of types grouped into *Parts*, *Camera*, *Light and environment* and *Materials*, and the numbers (N1).
- Animations appear **under their target in the scene tree** (those of a part or a group, and those of the model under the model); a click opens the timeline with it chosen (N1).
- A project from the first interface opens in the timeline with its shots as segments of the camera track and its moves as bars, and plays back the same as it did (N1).

### Tools

- `tools/video-check.mjs`: Chromium's codecs, a 2 s video at 12 fps with the application's writer and the real encoder (VP9 and VP8), the three-step wizard, a fade to black, the curve with a handle dragged and undone, the whole path of a WebM render read by ffprobe; captures `docs/ui/animation-n1-wizard.png`, `animation-n1-cards.png`, `animation-n1-curve.png` and `render-window-video.png` (N1).

### Known limitations of this version

- Open-source Chromium (the one used for tests) does not encode H.264: there MP4 shows disabled; Chrome, Edge and the desktop's WebView2 usually do encode it. Video quality is automatic (about 0.1 bits per pixel) and the video carries no alpha or sound.
- A video is saved whole at the end: if the job stops, nothing is left (a frame sequence is written image by image). Job plugins do not yet go through the frames of a video, and the history keeps its first frame.
- The cross-fade between cameras and the rendered preview are still *coming soon*; so are a spin's free axis and the *Tour*.
- In *Fast*, a node material does not change colour with *Material colour* (it does fade in the engine); a fading part is seen as a translucent copy that writes no depth.
- The sun arc uses a fixed pole (behind the product, at 45°): the latitude and where north is are pending a decision.
- There are no changes in the Rust engine (`engine/`).

## v0.1.15 — 2026-10-17

### Interface

- **Scene type** in the *Product* section of the inspector, above the product type: *Product · Interior · Catalogue*. Changing it rewrites the starting values and removes no control: **Interior** sets sun and sky, 16 bounces, no caustics, no contact shadow of its own, AgX transform, 512 samples that finish by noise with denoise and 28 mm; **Catalogue**, the studio dome with a white background, soft contact shadow, 8 bounces, no caustics, Standard transform, 256 samples and 50 mm. It is a single undo entry; changing type and going back leaves the project as it was except for what was touched in between; a loaded HDRI and a locked camera are not touched. It is saved in the project, and earlier projects open as *Product* (K1).
- **Interior** style in the light-setup catalogue (the last of the ten), with seven recipes: *Morning window*, *Midday window*, *Afternoon window*, *Overcast*, *Night lamps*, *Blue hour* and *White studio room*. Each one chooses its world (sun and sky, or the studio dome) and brings its exposure and the environment's intensity: the time of day is the brightness of the image. They carry no decoration, and the 88 earlier setups do not change. Their figures are a proposal pending a decision (K1).
- **Interior Doctor**: with the *Interior* type, seven more checks in the Doctor, each with its *Fix*: *Scale and units* (a file in metres read as millimetres), *Opening for sun and sky*, *Window glass* (thick or refractive: it makes it thin), *Lens too wide* (under 18 mm), *Eye height*, *Near clipping* against the wall and *Wall normals*. In *Interior* the Doctor's scale check no longer compares with the product type's size (K1).
- Choosing a recipe (or any set without decoration) no longer switches on the floor and contact shadow, and stops leaving the previous set's background in the frame or overwriting the background that had been set (K1).
- **Engine Doctor**: the Doctor gains the checks that read the engine, in the same popover and with the same form as the scene ones (each with its sentence, its fix and *Fix all*). **Engine**: `rt.wasm` loaded and with its workers, with the reason if not (it is not compiled, it predates the page, it did not start, the system gives no workers) and a warning if the pool is of one only. **SIMD**: warns that the scalar build is running and why (the system has no simd128, *SIMD* is on *Off*, `rt-simd.wasm` is missing, the desktop engine has no vector path). **Denoise**: in the viewport but not in the render, at strength 0, or an engine without a denoiser; off everywhere is a decision and does not warn. **Tone**: with *Standard*, the clipped highlights of what the engine has accumulated. **Fireflies**: isolated very bright samples in the *Full* viewport's accumulation. **Output format**: video (a codec that is not encoded here, or a single file that a failure loses). **Time budget**: the time does not reach the samples, with the speed the engine measured (D1).
- What the project can change has a *Fix* (one undo entry, *Doctor: Denoise*) and goes into *Fix all*; what it cannot (`rt.wasm` missing, a single worker, no simd128) is a warning that says why and *Not fixable here*, with no false fix; if a *Settings* row limits it (*Threads*, *SIMD*), the **Settings** button opens it highlighted and the Doctor does not change the application's settings (D1).
- The checks that cannot be stated now show switched off with their reason (*The engine is still loading*, *Needs the viewport in Full…*, *Measuring…*, *Not measured yet…*) instead of the generic *Not available yet: needs the engine* (D1).
- The Doctor runs again when what the engine ones read changes (image, engine, budget and render animation output settings, or the viewport image) and also after **undo** and **redo**, which before left the findings the state was saved with (D1).
- The texts of *Engine*, *Denoise*, *Tone*, *Fireflies* and *Output format* in the Doctor's catalogue, which spoke of Cycles, now speak of Repackshot's engine; their keys remain. Two new keys come in, `simd` and `budget` (D1).
- `status().scan` in both engines (the pool and the launcher): what the Doctor reads of the accumulation (pixels that are fireflies, the framing by stops), read again when the samples double; the workers say in their first message whether their `rt.wasm` exports the denoiser (D1).

### Fixes

- An action that a store listener sent while it was being notified of an undo, a redo, a reset or the closing of a transaction waited for the next `dispatch`, which could take a long time; now it is applied when the notification ends (D1).

### Tools

- `tools/scene-type-check.mjs`: checks in the browser the control, that the inspector has the same controls with each type, the seven recipes with their thumbnails, the seven Doctor rows and the round trip; it leaves `docs/ui/scene-type-interior.png` (K1).
- `tools/doctor-engine-check.mjs`: the Doctor with the real engine in Chromium (*SIMD* on *Off*, denoise only in the viewport, a 5 s budget, *Fix all* and an undo) and the capture `docs/ui/doctor-engine.png` (D1).

### Known limitations of this version

- The *Interior* type sets 28 mm without moving the camera: the part looks smaller until the interior camera arrives (eye height, straight verticals, automatic exposure; K3). The *Catalogue* cyclorama and the room are not there yet either (K2).
- The interior checks read the room from what is there: the closed space is the parts' box with the camera inside, the opening is a glass or a transparent material. The *Opening* fix sets the *White studio room* recipe, whose lights stay around the part and not inside an imported closed room; the good fix belongs to K2.
- *Wall normals* looks at closed surfaces and flat walls with the camera inside; it does not see a wall without thickness, and only looks at the first 500,000 triangles of the scene per pass.
- *Long roller* and *Low contrast* from the *Interior* table are not applied: the tone mapping does not have the parameter and *Contrast* is not yet applied by the engine. The displayed units are an application preference and do not change with the type.
- The day recipes use whatever sky haze there is (that of *Environment*), and *Overcast* is the studio dome with a diffuse window, not a clouded sky.
- The thresholds of *Tone*, *Fireflies* and *Time budget* are a proposal, pending a decision (ROADMAP D1, “What did not fit the plan”).
- With the launcher's engine and its viewport denoise on, the sums that reach the page are the filtered image: fireflies show as “nothing to count” (the framing by stops is still read).
- Two fireflies next to each other see each other as a bright neighbour and do not count; in *Fast* there is no accumulation to read.
- Reading the accumulation runs on the main thread every time the samples double (from 16 on): about 40 ms in a 1280 × 720 viewport, 160 ms at 2560 × 1440 and 330 ms at 4K.
- The video check does not yet fire with this version's settings: encoded video arrives with N1 and until then the output is a frame sequence.
- There are no changes in the Rust engine (`engine/`): no pinned hash has moved.

## v0.1.14 — 2026-10-17

### Engine

- **Section view**: a plane that removes one side of the part and caps the cut with the colour of its material (closed solids only; an open mesh shows its interior). What is removed is neither seen nor shades, in the camera, reflections, refractions, shadows and photons; a cut glass refracts through its cap. The same image with any number of threads, equal in the browser, in the launcher and in `rt` (`rt --write-q1-example`). Without a plane, the same pixels as before. The background, floor and cards of a set are not cut (Q1).
- New `SECT` section of the scene format (20 B) and bit 1 of `INST.flags` (the studio is not cut); `rt_features` and `/api/info` publish the section bit (Q1).
- **IES lights**: an own reader of the IES LM-63 text format (type C photometry, `TILT=NONE`; type B or A and `TILT=INCLUDE` are rejected with their message, and so are truncated files, counts that do not match, angles that do not grow and negative candelas) and an IES-type light: a point or a small sphere whose intensity in each direction is the file's, bilinearly interpolated between its angles with the file's symmetries, oriented by the light's axis and rotation and scaled by its power (the profile gives the shape and the power the level: as bright in its brightest direction as a point of that power). It is sampled by next-event estimation, with MIS if glossy, and in the light choice it weighs by the exact intensity towards each point (L5).
- **RSB**: `LGHT` of type 5 (80 bytes) and the `IESP` section with the file's text, once per profile; files and scenes without IES lights stay the same, byte for byte, and no pinned hash has moved. The engine says so in `rt_features` (bit 3) and the page writes an IES light as the spot that approximates it for an engine that does not say it (L5).
- `rt --write-l5-example`, a parity scene with its pinned hash and its parity block with `rt.wasm` in CI (L5).

### Interface

- **Section** section in the Scene inspector: a plane by click on the part and an axis (*X*, *Y*, *Z* or the surface normal), by two points or in numbers, with *Flip side*, *Cap the cut* and a switch; all undoable (Q1).
- The **Section** move of the timeline shifts the plane along its normal, in part sizes, with the clip's curve (Q1).
- *Fast* cuts and caps with three.js's clipping plane; selection, the selection box and the gizmo do not see what the cut has taken away. Two actions in the palette: *Section view: switch on or off* and *flip side* (Q1).
- ***+ Add light ▸ IES…*** stops being *coming soon*: it opens an `.ies` file (it can also be dropped on the window) and creates the light in front of and above the part, with the average brightness of the lit lights. The inspector shows the **profile name**, a **polar plot** drawn from the file (the C0–C180 and C90–C270 planes), the peak, the beam angle, **Change…** and a **multiplier** (× 1 is the level the light came in with). A file that cannot be read adds nothing and says why (L5).
- The profile **travels in the project** (`.repack`), in studios, in a saved setup and in the library, so it opens on another machine without the file. No manufacturer profile is shipped: everyone brings their own (L5).
- In *Fast* the IES light is a spot with the axis intensity and a cone taken from the angle at which the profile drops to half: an approximation, and the inspector says so; *Full* and the render use the whole file (L5).

### Tools

- `tools/lights-check.mjs` passes end to end again, in *Fast* and in *Full*: it activated the camera from the top-right menu looking for a text row exactly `Camera 1`, and since each row also carries the lens and the aspect ratio (and the pencil) that text no longer matched. Now it opens the menu through the only button in that corner with `aria-haspopup="menu"` and picks the row by its label (L4).

### Known limitations of this version

- *Fast* draws a glass's cap as transparent glass; *Full* and *Render* refract through it.
- A part with a material per face, a thin-walled glass or an open mesh are not capped; a closed solid with its faces inside out is capped by the engine and not by *Fast*.
- The *Fast* passes for the AI (depth, normals, identifiers) do not know the plane.
- Type C photometry only: a type B or A file is rejected (“export it as type C”).
- An IES light does not shoot caustic photons, like the point and the spot.

## v0.1.13 — 2026-10-16

Preview release with adaptive sampling and *Finish by noise* in the render
window. Everything from v0.1.2 to v0.1.12 stays the same.

### Engine

- **Adaptive sampling**: after 16 samples on every pixel, the engine distributes the following ones in 8 × 8 blocks according to each one's noise (the relative error of each pixel's mean, from the variance the film already carried), round by round, the same image with any number of threads, tiles or passes, equal in the browser, in the launcher and in `rt` (`--adaptive`, `--noise P`). A block that no longer receives samples keeps its mean. Without asking for it, the same pixels as before (E10).
- The denoise weights each pixel's variance by its own samples (E10).

### Interface

- *Render ▸ Quality ▸ Finish by* gains **Noise**: the render ends when every part of the image falls below the threshold (0.5–5 %, 1 % by default), with the samples as a cap, and the estimate comes from the last pass of the *Full* viewport (E10).
- The viewport meter says *Adaptive · min–max samples*, and the render's live view, the noise that remains against the target and the time the engine expects (E10).

### Known limitations of this version

- Adaptive sampling leaves, at equal time, 83–84 % of the uniform error in
  the test scenes (the target was 60 %): the current distribution rule gives
  no more and changing it is pending a decision. It is only used with
  *Finish by noise*; renders by samples or by time do not change.
- The time estimate for *Noise* comes from the last pass of the *Full*
  viewport with the same threshold; with *Denoise* on, the meter may show in
  its first line the samples of the filtered image.
- Those of v0.1.12 remain.

## v0.1.12 — 2026-10-16

Preview release with node materials working in *Full* mode and in renders
(what the bug report of 2026-10-14 asked for in its point 1.6). Everything
from v0.1.2 to v0.1.11 stays the same.

### Engine

- **Node materials work in *Full* and in *Render***: the engine runs the graph at every point of the surface, with the same numbers as the *Fast* view (noises, ramps, mixes, checks and stripes, images by their projection, Fresnel and *facing* with the real view, relief and normal map, curvature on sharp edges, the bevel weight, the opacity that also cuts out shadows, the emission). The editor's ten examples fall where *Fast* draws them (M3b).
- The engine says it does so (`rt_features` bit 1 in `rt.wasm`, `features` in the launcher's `/api/info`) and the page sends it the program of each node material; to an older engine, the mean value of each output, as until now. A scene without node materials gives the same pixels as before; with all its parts as nodes, a sample costs 41–47 % more (M3b).

### Interface

- *Inspector* and *Material editor*: the note on node materials no longer says *coming soon*; it says what *Full* and *Render* do (M3b).

### Known limitations of this version

- A graph's *Internal scattering* output is not read in the engine; a node material whose emission varies across the surface lights by the rays that find it, not as a sampled light (more noise in what it lights); caustics see it with its mean (M3b).
- The flakes of the example metallic paint come out darker in *Full* than in *Fast* (the *Normal map* node turns half of its normals inward): pending a decision. The wood example does not yet resemble the catalogue's *Wood* family, and there are no *Wood* or *Fabric* nodes (M3b).

## v0.1.11 — 2026-10-16

Preview release with improved ambient particles: dust shines against the
light, rain no longer speckles the product and particles cost less.
Everything from v0.1.2 to v0.1.10 stays the same.

### Engine

- **Dust that shines against the light**: dust motes, pollen and dust cloud scatter part of the light forward (a Henyey–Greenstein lobe, g 0.7, half of what they scatter: a proposal pending the verdict), so a light behind the product lights them in its beam; with side light they look almost as before (S4b).
- **Rain without dots**: drops and bubbles no longer make caustics; light crosses them straight, with their transmittance, in shadow rays and in paths that have already bounced off a matte surface, and the dots that rain left on the product with the side key light disappear. The camera (and what is seen through smooth glass and mirrors) still sees them refract (S4b).
- **Cheaper particles**: camera rays (pinhole or with blur) test only the particles of their piece of the image instead of walking their BVH, without changing a pixel; at each preset's density over the example bottle, a sample costs from 1.07× to 1.19× that of the scene without the effect, except rain (1.63×: its streaks cover a quarter of the glass frame) (S4b).

### Known limitations of this version

- **Rain** still costs about 1.6 times the scene without it per sample (the
  other effects, between 1.07 and 1.19): it is not the search for the drops
  but the light that passes through them; making it cheaper would change its
  look and is pending a decision. Inside the rain streaks under a side light
  some grain remains that cleans up with samples.
- How much light goes to the dust's forward lobe (half) is a proposal
  pending review; *Fast* does not show it.
- Those of v0.1.10 remain.

## v0.1.10 — 2026-10-16

Preview release with image textures, their mapping and labels in *Full*
mode and in renders (what the bug report of 2026-10-14 asked for in its
point 1.1). Everything from v0.1.2 to v0.1.9 stays the same.

### Engine

- **Image textures and labels in *Full* and in *Render***: the engine paints a material's six slots (colour, roughness, metal, normal or heights, alpha, emission) and its labels where *Fast* paints them, with the same projection (UV, box, planar, cylindrical, spherical), the same size in mm, rotation, offset, repeat and borders. Images carry mipmaps computed by the engine and are read with the ray's footprint (ray differentials at the camera, the path's cone afterwards); normal maps bend the normal over the bevel; alpha also cuts out shadows; a label puts its paper, with its roughness, its clear coat and the relief of its edge (M2b).
- The engine says what it reads (`rt_features` in `rt.wasm`, `features` in the launcher's `/api/info`) and the page sends the textures with their pixels only to an engine that reads them; a scene without textures gives the same pixels as before (M2b).

### Interface

- *Inspector ▸ Textures*: the note no longer says *coming soon*; *Fast*, *Full* and *Render* draw the textures and labels in the same place (M2b).

### Known limitations of this version

- A texture's size is still in mm and does not follow the solid's: it is a pending decision (`TRIAGE.md` 5.1). Node materials are still painted with the mean of their outputs until M3b.
- An emitter with an image is not sampled as a light (what it lights has more noise); caustic photons see the material without textures; the normals pass does not carry the normal map (M2b).

## v0.1.9 — 2026-10-16

Preview release with the live view of the selected render in the queue
(a request from the bug report of 2026-10-14). Everything from v0.1.2 to
v0.1.8 stays the same.

### Interface

- **Live view in the queue** (requested): a click on the row of the job being rendered opens its image while it is made, over the viewport (the results viewer in *in progress* mode), with the samples and seconds the engine reports, the row's state and progress; the chosen row is marked. A waiting job says it has not started yet and shows its image as soon as it starts; a finished one still opens its result, and the one that finishes with the view open becomes its result in the viewer. Closing it (`Esc`) or choosing another job makes the engine stop producing images: they are only made while being watched, at most every half second (U14).

### Desktop

- The launcher sends a render's frame **reduced** to a box (`GET /api/render/<id>?fit=<w>x<h>`, flag 512): the queue's live view receives only the pixels of its image and not the whole sums (U14).

### Known limitations of this version

- On the desktop the live image changes once per engine pass
  (1, 2, 4, 8, 16 samples…), not every half second; on the web the number of
  samples is the one each pixel already has (0 while the first pass fills
  the tiles). There is no zoom or 100 % in the in-progress view, and the
  thumbnail of the running row is still the icon.
- Those of v0.1.8 remain.

## v0.1.8 — 2026-10-16

Preview release with a single new feature: the window with a lens's elements
when the pointer rests on it (a request from the bug report of 2026-10-14).
Everything from v0.1.2 to v0.1.7 stays the same.

### Interface

- *Camera* ▸ **Lens**: when the pointer rests for a moment on a lens in the list, or when it is reached with the keyboard, a **window with its elements** opens beside it (requested on 2026-10-14): the lens cross-section (the same drawing as the section), its name, its source and the numbers the engine gives for it with the camera's focal length, aperture, focus and framing (focal length, aperture and T-stop, elements and groups, length, and the anamorphic adapter's squeeze). Over a *character* chip it opens that of the lenses of that character. While the engine answers it says *Asking the engine…*; without an engine (the web version without `rt.wasm`) it leaves the name and the source and says the engine is not loaded, with no invented numbers. It closes when the pointer or the focus leaves, with Esc and on choosing; it takes neither focus nor pointer. The *Lens* list is now the interface's own (arrows, Enter and Esc) instead of a browser `select`, which does not tell the page which entry the pointer is over; the character chips are no longer rebuilt on being pressed, so focus stays on the one that was pressed (O2b).

### Known limitations of this version

- The window is cut off on screens under about 550 px tall when a
  character has four lenses; it has not been tested against the desktop
  launcher (it uses the same service as the *Lens* section). The lens list
  is no longer a system dropdown: it does not search when typing.
- Those of v0.1.7 remain.

## v0.1.7 — 2026-10-16

Preview release with wood, fabric and edge bevel in *Full* mode and in
renders, rough materials that no longer lose light, scattering media and
chromatic dispersion of glass, the traced lens with the catalogue's 16
lenses, effect filters on the lens, the 88 setup thumbnails redone and the
fixes from the bug report of 2026-10-14 (click-to-focus, the colour of a
fabric in nodes, the `.repack` extension, the AI's attempts). It is the
first one reached with *Update from the app*. Everything from v0.1.2 to
v0.1.6 stays the same.

### Interface

- *Camera* ▸ **Filters** (O3a): up to three effect filters per camera, each with its type and a sentence about what it does, its strength and, depending on the type, tint, points and angle. Fast mode draws them as an approximation (and the meter says so); Full mode and the render, with the engine.
- In a glass's inspector, under *Walls*: **Internal scattering** (mm), **Scattering colour** and **Direction** (−0.9 to 0.9, backward / forward), with its help; the Fast viewport approximates it with a translucent diffuse and says so (E9b).
- **Nine new materials** (92 in total with those of L6's sets and E9c's glass): white HDPE, natural PP and frosted acrylic among the plastics; wax, glycerine soap, milk, orange juice, apple juice and cream among the others. Liquids do not wear (E9b).
- **Abbe number** in the glass inspector (0 to 100; 0, no dispersion), with its help; the Fast viewport approximates it with three.js's dispersion. New material: **Perfume crystal** (Abbe 40) in *Glass* (E9c).
- The 88 **setup thumbnails** are rendered again with this version's engine (E12's per-point light, E9a's energy, E11's denoise, E6's edge bevel on the heroes): the stray dots of `STRIP_EDGE`, `BLACK_ON_BLACK` and `WARM_COOL_CINEMA` are gone. The pool of **Gradient backdrop with a pool** (`GRADIENT_POOL`) goes up from 0.70 to 0.85 to remain at least twice as bright as the paper with the corrected materials (L6, E9).
- Wood gains *Scale*, *Ring contrast* and *Pores*; its *Ring density* counts rings per 100 mm, and the presets carry each species' own (oak 33: 3 mm). Its fields say that *Full* mode paints them; the *Fast* view shows its average colour (E6).
- **Knots** in wood: *Knots*, *Knot size*, *Size variation* and *Knot darkness*, placed with the material's *Seed*; the *Fast* view already shows where they fall. In bamboo, MDF and ebony they are disabled with a note (E6).
- The material's *Edge bevel* field no longer says *coming soon*: *Full* mode and renders draw it; the *Fast* view still shows the sharp edges, and the field's note says so (E6).
- Fabric gains *Threads per cm* (2–200, each fabric's own) and the *Twill 3/1 (denim)* weave; weave, density and relief are painted by *Full* mode, and the *Fast* view shows the weave's average colour (denim, indigo: its face is warp) (E6).
- *Camera* ▸ **Lens** (O2): *Simple lens* or **traced lens**, one of the catalogue's 16 chosen by character (*Clinical, Soft, Swirl, Vintage, Anamorphic, Macro, Wide, Tele*), with its source, its coating, the lens behind the anamorphic adapter, the soft lens's gap and the blades; what the engine computes for that camera (focal length, flange distance, f-number and T-stop, elements and groups, length, entrance pupil, distortion and light towards the corner) and the **lens cross-section** in SVG; in *Advanced*, the settings marked *non-physical* (distortion, vignetting, spherical character, breathing, chromatic aberration, swirl); **Save lens as…** to *Mine*. Fast mode draws its distortion and vignetting as an approximation and the meter says so.
- The **Coma comet**, **Focus breathing** and **Variable spherical aberration** bokeh types can now be chosen: they put their traced lens on the camera, with a thumbnail rendered by the engine (O2).
- With a traced lens, **a click lands on what is under the cursor**: click-to-focus, selection, the gizmo, light and camera glyphs and box selection follow the distortion the viewport draws, and the selection outline and the gizmo are drawn with it; when looking through another camera or a light the viewport no longer applies the active camera's lens (O2).
- **Click-to-focus** no longer undoes itself with the same click: the viewport finished the orbit gesture on releasing the button and returned the focus to the orbit distance (688 → 660 → 688 in the example, with the undo entry *Move the camera*). Now a click that does not move the view does not touch the camera, and an orbit drags the focus only if it was already at the orbit distance; it also applies to *Look through* a saved camera. The click measures from the camera that is seen, not from the active one (B1).
- **AI attempts counted** (the queue): the row says *AI · tile 2 of 4 · attempt 2 of 4* (the guard repeats at most 4 times per variant and there is no endless loop), and after a retry a second line with the guard's reason (*Attempt 1 did not pass: …*); the bar is divided by attempts, a quarter each, instead of getting close to the end at every retry. The launcher's log says *attempt k of 4 failed*. In the render window, the AI preview is no longer abandoned and restarted with each snapshot of the model manager (they arrive every 200 ms during a download): only when the installed models change or the store starts responding (B1).
- Switching a **fabric to *Nodes*** keeps its colour: the minimal graph averaged the two threads in equal parts, so denim went back to the bluish grey that E6 had corrected (and satin and microfibre drifted); now it uses the weave's average colour that the engine and the Fast view read (B1).

### Engine

- **Effect filters on the lens** (O3a): white, black and gold diffusion, glow, softening, net, star (4, 6 or 8 points) and streaks, as scattering of the camera ray at the pupil: with the strength's probability (1/8 to 2) the ray is deflected according to the filter's PSF (inverse-CDF tables), so the halo carries the bokeh and the focus and a light outside the frame veils the image; up to three stacked; the tint (gold, net, streaks) goes to the halo and the streaks, not to the image; the strength lengthens the star's streaks without widening them, the net leaves a short, faint cross, and the glow is a cloud of fine sparkles. Each camera sample is also connected, through the PSF, to a light the camera sees, weighted against the scattering (MIS): the same image with several times less noise around small lights (`rt --filter-noise` measures it). New fields at the end of `LENS`; without filters not a bit changes (O3a).
- **Rough materials no longer lose light** (E9a): the light that bounces several times between the GGX microfacets comes back (Kulla and Conty 2017's added lobe in metal, plastic gloss and clear coat; Turquin 2019's scaling in rough glass), with tables integrated by us. In a uniform white environment, a white metal of roughness 1 goes from 0.356 to 0.999, rough glass from 0.361 to 0.995 and white plastic from 0.918 to 1.000 (0.860 to 0.998 with clear coat). The diffuse layer under the gloss receives exactly what the gloss does not reflect (Kulla and Conty), also with roughness 0. Images gain light: the example 15.6 % of mean luminance, E5's scene 13.6 %, E5c's sky 13.2 % (E9a).
- **Scattering media inside solids** (E9b): a glass with *Internal scattering* is filled with a medium that scatters light inside (translucent plastic, wax, soap, milk, juice, cream), with a random walk through the interior, its colour and its direction per channel, and the light found where the walk exits. Scenes without media do not change by a bit. The same bits on the desktop and in the browser (E9b).
- **Chromatic dispersion of glass** (E9c): a solid glass with an *Abbe number* splits light into colours when refracting (each wavelength with its index, by Cauchy's law); a path picks a wavelength at the first dispersive glass and caustics are coloured too. Scenes without it do not change.
- **Procedural wood** (E6): the catalogue's 13 woods draw their rings (sawtooth, with each species' contrast, that meander and change width), their grain, their pores (ring-porous in oak and ash, diffuse in walnut or very fine in maple; none in pine or ebony) with their relief, and the roughness stretched along the grain; bamboo in strips with its bundles and nodes, mottled MDF and streaked ebony. Physical sizes: rings of 2 to 5 mm depending on the species, on any part; the pith never crosses the part (a ball does not show a bullseye). **Knots**: branches that cross the part from the pith, with the grain and rings surrounding them, their darker end grain, their bark pocket and their crack; pine brings four, cherry and walnut one. Own noise. New `PATN` section of the RSB (E6).
- **Edge bevel in shading** (E6): each material's *Edge bevel* radius rounds the normal near the mesh's sharp edges (more than 20° between faces, and open borders) like a fillet of that radius, in reflections and in shadows; concave edges, corners and curved edges included, also between the meshes of a part with per-face materials. Edges are searched once per mesh, with an own BVH; the measured cost is +3 % on the example bottle with its 0.3 mm bevel. The same bits with any number of threads and in the browser (E6).
- **Traced lens** (O2): the camera traces each ray through the real surfaces of a catalogue lens (spheres, planes, aspheres, cylinders, mirrors), scaled to the focal length and focused like the lens (unit, internal focusing, floating element, the anamorphic adapter with its own gap), with chromatic aberration in three bands, coatings as transmission (T-stop and tint) and what comes out by itself: distortion, vignetting, cat's eye, bubble or creamy, coma, field curvature, breathing. The engine tells the page and the launcher what it computes for the lens (focal length, image scale, flange distance, f-number, T-stop, distortion, relative illumination, the cross-section) (`/api/lens/info`). Camera rays cross the lens in batches of eight: the traced camera is 13.7 % of the example's render (0.25 µs per sample, the thin lens 0.19 µs). Scenes without a traced lens do not change by a bit (O2).
- **Procedural fabric** (E6): the catalogue's 12 fabrics (carbon among them) weave their warp and weft threads, round, that go up and down at each crossing and show their thread's twist, in plain weave, twill 2/2, twill 3/1 (denim), satin, canvas, knit (overlapping Vs) and felt; the relief tilts the normal and the gloss stretches across the thread on top. Physical sizes: each fabric's threads per cm (cotton 40, denim 24, satin 100, knit 4, carbon 5…), on any part, with a seamless box projection. `PATN` of type 2 (E6).

### Project

- The project is saved as **`.repack`** (requested): it is the same JSON, with another name. Earlier `.repack.json` files still open the same, from the picker, the desktop dialog or dropped on the window, and *Save* over one that was opened writes it where it is. The launcher writes `.repack` and remembers either as the last project. The installers do not associate the extension with the program (double click): that is left for packaging (B1).
- Earlier projects open the same and their glasses still have no medium; the engine scene's `MATL` record goes to 100 bytes (with E6's bevel, the medium and E9c's Abbe number) and earlier files are read as before (E9).
- A camera saves its traced lens by its catalogue key and what was changed (`optics.traced`); earlier projects do not have it and open the same. The own library gains **lenses** (O2).
- Saved projects show rounded edges in *Full* without touching anything: every preset instance already carried an *Edge bevel* of 0.25 % of the part's size (the Doctor's fix). A saved wood or fabric keeps its `ringDensity` and `threadCount`, which are now read as rings per 100 mm and threads per cm (up to 200). The bevel goes in byte 72 of the `MATL` record and the patterns in the new `PATN` section (E6).

### Known limitations of this version

- **Textures**, **labels** and **node materials** still show only in *Fast*;
  *Full* and the render use the mean of each output until the engine reads
  them (M2b and M3b).
- From the bug report of 2026-10-14, this version fixes what was confirmed
  (B1) and brings the traced lens (O2); the rest is classified in
  `TRIAGE.md` and awaits its phases (M2b, M3b, U14) or a decision. The AI
  attempts loop and the denoise that washes out colours could not be
  reproduced: the launcher's log and a scene are needed.
- The photographic verdict on O2's lens sheet (which lens gives which
  bokeh, the prescriptions and the assumed apertures, the anamorphic
  adapter's constants) is pending: the values are the proposed ones.
- Those of earlier versions remain, above all that the new desktop features
  **have not been tested on a real Windows machine** and that the first real
  AI image on a graphics card is still pending.
- Light leaves a medium as from a diffuse surface (the production approximation of Chiang, Kutz and Burley 2016): in a milk sphere under a side panel it stays 3.3 % brighter than the path that really refracts. There are no nested media (a liquid inside another), a solid with index 1 has no medium, and with a strongly marked direction (near ±0.9) it converges slowly (E9b).
- **A liquid inside a glass bottle** sees the lights through a thin, smooth wall (up to 5 mm, nearly parallel faces) as if the glass did not deflect them, an approximation that in a milk slab under a 3 mm plate stays 2 % below the exact path; through a thick base, of rough glass or with clear coat, light reaches it only through paths that find it at random (with grain at few samples) or, with *Caustics* on, through photons (E9b).
- Energy compensation approximates anisotropic lobes with the equivalent isotropic width and does not touch thin walls (E9a).
- Dispersion carries a single colour per path: around a crystal there is colour grain at few samples, and a light seen through it converges like a caustic. Shadow rays, thin walls around a medium and solids with a medium do not disperse (E9c).
- The traced lens paints each sample in one band (R, G or B): at equal samples the bokeh has about five times the variance of the thin lens's (the bands and the samples the lens stops), so it asks for more samples to converge; the thin lens's tilt does not apply to a traced lens (coming soon) and Fast mode approximates its distortion and vignetting with a radial curve (in an anamorphic, that of the vertical meridian) (O2).
- The *Fast* view does not paint the wood's rings or the fabric's threads, only their average colour (and the knots, darkened); at real size, the threads of most fabrics are finer than a pixel and are averaged in it. The clear coat of carbon and varnished wood follows the pattern's relief (M4), the technical mesh has no holes (M2b) and velvet has no sheen (S8) (E6).

## v0.1.6 — 2026-10-14

Preview release with textures and labels, the node-based material editor,
studio sets with photographic intent, improved thin lens with a bokeh
chooser, lens filters planned for the next one, TIFF and RAW output, the
aspect ratio in the camera, plugins with the first one for film, per-point
light choice, configurable exploded views and a new timeline, rigid bodies
with *Drop*, ambient particles, live *denoise* with strength and edge
smoothing, and updating from the app. Everything from v0.1.2 to v0.1.5
stays the same.

### Known limitations of this version

- **Textures**, **labels** and **node materials** show in
  *Fast*; *Full* and the render use the mean of each output until the
  engine reads them (M2b and M3b, under way). Knotty wood, bevel and
  thread-by-thread fabric (E6), energy, media and dispersion (E9) and lens
  filters (O3a) are done and arrive in the next version.
- **Particles**: dust against the light barely shines in the beam and rain
  under a hard key light speckles the product (both in S4b); they cannot be
  selected in the viewport; at 200,000 particles the render costs 3.2×, at
  the presets' densities about 1.1×.
- **Physics**: rigid bodies only; *Cloth* and *Liquid* say *coming soon*.
  While a simulation runs the viewport switches to *Fast*. With the playhead
  at 0 a part held by a recorded simulation shows its initial frame.
- **Film plugin**: closed licence, a preview of an app in development; the
  activation key is provided by its developer (the registry does not carry
  it: it is typed on install). The `film-0.1.0.rpk` package is an asset of
  this release.
- **Live denoising**: the launcher's lane is one thread; the refresh never
  exceeds one sample of the whole view. MSAA 8× has not been seen drawn
  (the Chromium here reaches 4×).
- **Update from the app**: the first real update is from this version to the
  next; the installation on Windows has not been tested on a real Windows
  machine.
- The 88 **setup thumbnails** were rendered before the per-point light
  choice (E12); they are redone in the next version.
- Those of earlier versions remain, above all that the new desktop features
  **have not been tested on a real Windows machine** and that the first real
  AI image on a graphics card is still pending.

### Desktop

- **Update from the app** (P5): *Settings ▸ Updates ▸ **Install and restart*** (and the same button in the status bar notice) downloads the new version, checks its SHA-256 against the release's `SHA256SUMS.txt`, installs it and restarts the application with it, without going through the browser. On **installed Windows** it runs the installer silently (`/S /LAUNCH`: it waits for the application to close, installs and opens it again); on a **portable** (Windows and Linux) it extracts the package next to the program and replaces the files in place —the executable in use is renamed to `.old`, `data/` and `portable.txt` are not touched, and if something fails halfway the old one stays where it was—, and the new version deletes the `.old` files at start-up. It only downloads from the application repository's releases (`github.com/<owner>/<repo>/releases/download/…`); a sum that does not match installs nothing. The row shows *Downloading… 45 % · 3.2 of 7.1 MB*, *Checking…* and *Installing…*, failures with their reason and *Retry*, and *Cancel the update*; closing *Settings* does not stop it. The web version keeps *Download*, which opens the version's page. The first update from the app will be from the version that carries this to the next (P5).
- The Windows installer, silently, waits up to 30 s for `repackshot.exe` to be free, does not touch the AI model choice nor recreate a desktop shortcut that was deleted, and with `/LAUNCH` opens the application when finished (P5).

### Interface

- *Camera* section ▸ **Bokeh** (O1): the 20 bokeh types with a thumbnail rendered by the engine itself (twelve out-of-focus points of light on black); those that need the traced lens or wave optics say what they expect. Variants (straight or curved blades, stars, heart, holes…), *Plain disc* to go back to the usual thin lens, and **Advanced optics**: blades, roundness, rotation, profile and intensity, obstruction, cat's eye, anamorphic, tilt and its axis, horizontal and vertical shift (Fast mode moves the framing), and, marked *non-physical*, chromatic aberration and swirl. All undoable; earlier cameras open the same.
- **The question about unsaved changes** gains **Save as…** (with the dialog) in all its uses —closing, *New*, *Open* and updating—: *Save · Save as… · Don’t save*, and *Cancel* or `Esc`. *Save* and *Save as…* continue only if the project was really written. In *Settings*, `Esc` cancels an open question instead of closing the window (P5).
- The viewport's camera list (top right) shows each camera's lens (*85 mm · f/5.6*) and a **pencil** per row that opens that camera's card in the inspector (name, *Activate*, *Look through*, lens and position) with the *Cameras* tab open; and the *Camera* section of the scene inspector says **which camera it edits** (the active one, by name), with the same pencil and a note that each camera has its own lens and position (reported: it was not visible that *Camera 1* was being edited).
- **Node-based material editor** (M3a): a material can be **Simple** (its family's parameters) or **Nodes**, a graph of nodes edited in the new **Material editor** window (*Nodes…* in the inspector, *Material ▸ Edit with nodes…* in a part's menu, the palette). Canvas with zoom and pan, cards that are dragged with a sphere of what each node gives, sockets with a shape per type (number, colour, vector, normal), connections by dragging that reject types that do not match and loops, saying why, **Add node** with search, selection by click and by box, *Duplicate*, *Delete*, shortcuts, and the node panel with its parameters and inputs. Nineteen nodes: *Material output*, *Image texture*, *Mapping*, *Noise* (Perlin and simplex), *Gradient*, *Checks*, *Stripes*, *Colour ramp*, *Mix*, *Math*, *Fresnel / layer weight*, *Curvature*, *Value*, *Colour*, *Separate* and *Combine RGB*, *Invert*, *Normal map* and *Bump*; and **ten examples** (plastic with a label, brushed metal with scratches, marble, leather, wood with two noises, dirty glass by Fresnel, checks, metallic paint with flakes, glazed ceramic, stripes). Switching to *Nodes* gives the minimal graph and going back to *Simple* from it is exact; from a richer one, it asks. All undoable, one entry per edit (M3a).
- The **Fast** view draws node materials with 512 × 512 maps evaluated in workers (before, a 128² one); the inspector and the editor say on which surface (the UVs, their projection, or a front cut for what reads 3D coordinates) and what they approximate (Fresnel at 60°, curvature omitted, the mean value of outputs without a map). *Full* and *Render* use the mean value of each output until the engine evaluates graphs (*coming soon*, M3b) (M3a).
- **Image textures** (M2a): a material's inspector gains the **Textures** section, with six slots —*Colour*, *Roughness*, *Metal*, *Normal*, *Alpha* and *Emission*—, each with its preview, *Load…* (PNG or JPEG; the system dialog on desktop) and *Remove*, and how its image is read (channel, invert, normal or height map intensity, alpha cutoff and threshold, emission tint and intensity); and a common **mapping**: *Projection* (*UV · Box · Planar · Cylindrical · Spherical*), axis, UV set, size in mm with *Fit to the part*, rotation, offset, repeat and borders. All undoable, a drag one entry (M2a).
- **Labels** (M2a): *Add label…* picks an image with alpha, and a click on the part with a drag places it there (flat from the surface normal, upright) with its width; several per material, in order (*Bring forward*, *Send back*), with width, rotation, reach and its finish (roughness, clear coat, paper relief); **Move label** slides it over the surface (M2a).
- The **Fast** view draws all the slots, the five projections (box blends three axes, cylindrical and spherical with no visible seam) and the labels, with mipmaps, over the usual look (lights, environment, shadows, outline). *Full* and *Render* paint them when the engine reads them (*coming soon*, M2b) (M2a).
- The **import sheet** gains the **Textures** section: how many images are saved and how much they weigh, and each one that is not, with the reason (M2a).
- **Denoise** in the top bar, to the right of *Fast · Full* (shortcut `D`): the *Full* viewport's live denoise. It is the same switch as the meter's button and as the *Viewport* part of *Advanced ▸ Denoise*: one single truth, the project's, undoable and saved with it. In *Fast* it shows disabled (*Applies to Full mode*). The *Fast and Full* step of the guided tour names it (U11).
- **The *Full* viewport denoises as it accumulates**: switching it on cleans what has accumulated at once (also with the image already converged) and switching it off shows the noisy image in the next frame, without starting over; while rendering, the clean image is refreshed as often as a denoise costs (at least every `max(2 × its cost, 0.5 s)`) and is never more than one denoise old. Before, it was refreshed at the start, at the end and only when three times what the last one cost had passed, and in between it fell behind (U11).
- *Advanced ▸ Denoise* gains **Strength** (0–100 %, 100 % by default): how much of the filtered image is delivered, blended with the noisy one per channel in linear light. A single control for the render and the *Full* viewport; at 0 % nothing is filtered. Undoable and saved in the project; earlier projects open at 100 % (U11b).
- **Settings ▸ Render engine ▸ Edge smoothing**: two lists from less to more cost. *Fast mode*: *None · MSAA 2× · MSAA 4× · MSAA 8×* (4× by default; the line says how far the device reaches and what it draws with). *Full and render*: *None · Standard · Soft · Fine · Fine + edges ×2 · Fine + edges ×4*, each with its sentence (*Fine* by default, which costs the same rays as *Standard*, the previous one). They are application settings (on desktop, in `settings.json`), not the project's. The meter states the filter when it is not the factory one (*Filter · Standard*, for example) and *Fast*'s multisampling when it is not 4× (E11).
- **Drop** (S2): in the context menu of a part, a group or a model (in the tree and in the viewport), in the *Part* and *Physics* sections of the inspector and in the palette. What is selected falls onto the floor and onto what lies below it and the simulation stops by itself when everything is still; the whole fall is one undo entry (S2).
- The **physics bar** (S2), a drawer of the bottom bar next to *Animation*: *▶ Start · ⏸ Pause / ▶ Resume · ■ Stop · ↺ Reset*, the simulated time and the awake bodies as the simulator counts them, and the state (*Stopped* by default, and how it ended). *Pause* freezes what is seen, *Stop* confirms the pose and *Reset* undoes it as another undo entry (S2).
- Inspector ▸ **Physics** (S2): role (*Static · Dynamic*; *Cloth* and *Liquid*, coming soon), density in kg/m³ (the material family's, or own), friction, bounce and, on a group, *As parts* (S2).
- The **Doctor** warns of a dynamic part that starts passing through the floor, and raises it (S2).
- **TIFF and RAW (DNG) output** (U12): the render window offers **TIFF** —uncompressed, with *8-bit*, *16-bit* (sRGB) or *32-bit float* (linear light with the render's exposure, like EXR), with a transparent background and the window's DPI as resolution— and **RAW (DNG)** —a linear floating-point DNG 1.4 that a raw developer opens like a camera's, with all the render's latitude and no alpha—, each with a help line. The name ends in `.tif` or `.dng`; the results viewer and thumbnails use an 8-bit PNG copy of the same render (browsers show neither TIFF nor DNG); *Save again* writes the file. Old settings open the same, and *Preferences ▸ Render ▸ Format* offers both (U12).

- **The image's aspect ratio belongs to the camera** (U13): each camera carries its own —*3:2*, *4:3*, *16:9*, *1:1*, *5:4*, *4:5*, *9:16*, *21:9*, *2:1*, panoramic *65:24* or *Custom* with its `w : h`—, in an **Aspect ratio** row of the Camera section and of each camera's card (undoable). The **viewport frame** follows the camera being seen, the chip at the top right states the ratio with the size (*16:9 · 1920 × 1080*) and the camera list puts it after the lens. The **render window** reads and writes the same one: in an image the width is kept and the height comes from the active camera's ratio; a size that breaks it (both sides, or one with the padlock open, or a size preset of another ratio) rewrites it on the camera and the window says so in one line (*Camera 1's aspect ratio becomes 4:3*). *New from the current view* copies the ratio; each camera keeps its own when the active one changes; a job for another camera comes out with that camera's height. The animation keeps its own size and the Doctor gains **Animation aspect ratio**, which warns of shots whose camera has another ratio (and fixes it).
- **Ambient** (S4a): the *Scene* tab gains the **Ambient** section, between *Environment* and *Camera*: airborne particle effects —*Dust motes*, *Pollen*, *Rain*, *Snow*, *Dust cloud*, *Ash*, *Rising bubbles*, *Falling confetti*— added from a gallery of cards (*Haze*, *Light shafts* and *Low fog*, *coming soon*), with eight always-visible photographer controls (amount, size, energy, chaos, wind and its direction, gravity, variation, seed with *Shuffle*) and a folded *Advanced* with everything else (region, band, shape, fall, spin, trail, turbulence, cloud, material, tints, *Freeze at*, visibility, cap). All undoable. The *Fast* viewport draws up to 50,000 particles per effect with the engine's own simulator (or the region's box without `rt.wasm`, and the meter says so); *Settings ▸ Render engine ▸ Particles per effect* sets the cap (automatic: 100,000 in the browser, 1,000,000 native) and the Doctor warns of what exceeds it.

### Plugins

- **Settings ▸ Plugins** (P6): the plugins of Repackshot's registry, each with its logo, publisher, version, size, summary, the **Closed licence** tag, its page and the sentence *This plugin's code is closed; Repackshot's licence does not cover it*; **Install**, **Update** and **Remove**; the **activation key** asked for in its row when the registry does not say where to ask for it; **Install from a file…** (`.rpk` and its key); its full licence and third-party notices, expandable (P6).
- **Render window ▸ Plugins** (P6), after the AI: one block per plugin, drawn from its manifest: recipes by their categories, its controls by groups, a **preview** of the current result through the plugin (at 480 px, 300 ms after the last change, cancellable) with the numbers the plugin itself gives and the measured time, and **Apply**, a new result in the viewer with its provenance, saved as *<source>_<plugin>.png*. Each plugin's settings belong to the project: undoable and saved with it (P6).
- **The first plugin: aintfilm · film simulation** (P6): the film engine of aintfilm, the photo-editing and film simulation app from the same developer, in development (a preview): 51 films, their colour alone, 8 grains, 13 diffusion filters and 4 lens characters, with their public names; the controls of its recipe editor (negative format, exposure and push, colour, contrast, saturation, warmth, print or scan, grain, halation, diffusion, lens, grain engine, seed). An EXR comes in as linear light, without going through 8 bits. Closed licence; downloaded as an asset of the v0.1.6 release (P6).
- The `.rpk` package (P6): header in the clear and content encrypted with AES-256-GCM; it is stored encrypted on this machine with its key kept apart and only decrypted in memory. `tools/plugin-pack.mjs` packs a plugin (P6).
- **The recipes, a carousel** (P6): one card per recipe with its image —the plugin's test scene (for the film one, a perfume bottle next to a lit lamp in a dark room) through that recipe—, its name and its category; it scrolls sideways with the wheel and is chosen with the arrows. The images are made once on each machine. Before the first render, the preview shows that test scene (P6).
- **Filters and slider in the recipe carousel** (P6b), as in the film search of the aintfilm app: chips of **Type** (colour, B&W, slide, cinema), **ISO** (≤ 100 · 200–400 · ≥ 800) and **Group** (films, a film's colour, grain, diffusion, lens), which combine, with the count (*23 of 127 recipes*); the chosen recipe stays in view, first and marked, even if the filters leave it out, and the filters are saved with the project. Below the carousel, a slider to go through the recipes, tied to its scrolling, with the chosen one marked (P6b).
- **Apply to render jobs** (P6): a plugin can also pass every image the queue renders; in an animation, each frame with its seed (*seed + frame*), so the film's grain changes from frame to frame as in a real film (P6).
- The film plugin's logo is the plugin owner's: the 35 mm cartridge in dots, with the tongue in three greys (P6).

### Animation

- **Configurable exploded views** (N6): the exploded view (`EXPLODE`) gains three geometries —**linear** along Z, X, Y or an own direction, *separate* (each part on its side of the centre) or *stack* (all in the same direction, in their order: the classic exploded view of a package); **radial**, moving away from an axis; **spherical**, moving away from a point— and the **hierarchy** (parts, one level with groups as blocks, or all levels in stages), with distance in × size or mm, equal or by-distance spacing, proportional to the part's size, centre (the assembly, a part, the pivot or a point), order (at once, by distance or by depth, with overlap), **smoothness** in a single control (from linear to very smooth), **exceptions** that do not move (*Pin in the exploded view* in a part's menu), keeping the orientation or tilting the parts, and the model or a group as target. A set's parts are not exploded (N6).
- Any animation can be **reversed** (a reversed exploded view assembles: it starts apart and ends together) and **repeated** n times; splitting one at the playhead leaves two halves that follow one another (N6).
- **Three-zone timeline** (N6): on the left the tree of what is animated (one row per target with its animations and its short phrase, *+ Animate Cap…* on each), in the centre the ruler in seconds and frames, the playhead and the bars, which are dragged and stretched with **snapping** to the edges of the others, the playhead and the seconds (`Shift`: free), with multiple selection, collapsible targets and the camera track with its shots; on the right the properties of the chosen animation, with its one-line header (*Cap · Spherical exploded view · 1.5 × size · 0–3 s*), its controls and the curve with its preview. Choosing an animation highlights its target in the viewport and draws its track (orbit arc, arrow, exploded-view vectors, spin axis); choosing a part marks the rows that move it. Keys: `Space`, `Home`/`End`, `←`/`→` (`Shift`: ten frames), `Del`, `Ctrl D`; *Loop* and zoom in the header (N6).
- Exploded views saved before are read **exactly the same** (the `RADIAL` key is still the spherical one; the new radial is `CYLINDRICAL`) (N6).
- **Every simulation is recorded in the animation** (S2): each falling body receives a **Simulation** clip (`PHYSICS`) on the timeline, which grows frame by frame while it runs, with the playhead behind it; it moves in time, stretches to slow it down, repeats and reverses like any other, is saved with the project and follows the node if it is moved afterwards. The still photo uses the playhead's frame (S2).

### Import

- glTF and GLB bring their **materials with their maps** read from their JSON (base colour, metal-roughness, normal with its scale, emission with its factor and `KHR_materials_emissive_strength`, alpha with its mode and threshold; transmission, IOR and clear coat from their extensions; `KHR_texture_transform`); OBJ reads its **`.mtl`** and their images (with `-s`, `-o`, `-bm`, `-clamp`, `-imfchan`); FBX, Collada, 3MF, USD and 3DM, the maps their reader loads. The images and libraries a model names are searched among the files **chosen or dropped with it**; *Import model…* allows choosing several (M2a).
- **UVs** are kept, also a **second set** (glTF `TEXCOORD_1`), and the file's per-vertex normals (M2a).

### Project

- Each node's *Physics* section and the `PHYSICS` clips (baked track in base64 and anchor) are saved in the project; an earlier project opens the same and the schema stays at 2 (S2).
- Cameras save their aspect ratio (`aspect`); an earlier project takes it from the render size it saved (the preset that fits within 0.5 %, otherwise *Custom* with those pixels) and keeps that size (U13). Opening a project recomputes the Doctor's checks with this version's catalogue, also when reading only the state.
- A material's **graph** travels in the project (with its version) and in the library (without its images, which belong to the project); a saved graph opens identical. Earlier projects open with their materials in *Simple* (M3a).
- Texture images **travel in the project** as they are (PNG or JPEG, base64), once each, under an id that names their content: a saved and reopened project comes back with the same bytes. Up to 16 MB per image and 64 MB per project. Earlier projects open the same (M2a).
- *Ambient* effects are saved with the project as parameters (the particles are not: they are evaluated); an earlier project opens with none (S4a).

### Engine

- **Improved thin lens** (O1): new, optional `LENS` section of the RSB, right after `CAMR`. Round diaphragm or one of 3 to 18 straight or curved blades with their rotation, or a mask (stars, heart, several holes…) sampled by its 2D CDF; pupil texture (dust, streaks, mesh, onion rings); pupil profile (uniform, bright centre, bright ring, apodised), central obstruction, approximate cat's eye (with the vignetting that goes with it), 1.33× and 2× anamorphic squeeze (the image comes out desqueezed), shift and **tilt with a Scheimpflug plane of focus**, and, as artistic settings, chromatic aberration by three bands (each sample one band, stratified, without moving the focus) and swirl. Everything sampled with its exact density, without rejection, deterministic on any platform. A scene without `LENS` renders bit for bit as before (O1).
- **Per-point light choice** (E12): next-event estimation chooses the light each time by what can illuminate the point being shaded (Conty Estevez and Kulla's bounds, HPG 2018), not by its flux over the whole scene. A small light near its paper —the pool of STRIP_EDGE, BLACK_ON_BLACK or WARM_COOL_CINEMA— stops seeding white sparks on the paper: under the light it is chosen 21–48 % of the time instead of 0.08–0.3 %. With a single light the image is the same, bit for bit; the shadow catcher and caustics still choose by flux (the shadow catcher keeps its look); the same bits with any number of threads and in the browser (E12).
- **`rt-phys`**, the own rigid-body simulator (S2): extended position-based dynamics (XPBD, Müller et al. 2020) at 240 steps per second with 4 substeps, convex hulls by an own quickhull (or oriented box) and exact spheres, contacts by separating axes against hulls, triangles and the floor, Coulomb friction with anchors and torsion, restitution, rolling resistance and sleeping. Deterministic: the same pose hash with 1 and N threads and in wasm. A thousand spheres settle in 1.7 simulated seconds (S2).
- `rt-wasm` exports the simulator (`phys_new`, `phys_step`, `phys_poses`, `phys_awake`, `phys_settled`, `phys_hash`…), which runs in a worker of the page's own (S2).
- The **contract of graphs with the engine** is written for M3b (`ARCHITECTURE.md` §5.2 quater): the linear program (f32 and vec3 registers, six-word instructions with stable codes, constants, image table, outputs, their byte form), each instruction in f32 with its order of operations, the noise (corner hash, Perlin 2002 gradients, simplex, octaves) and the 1000 points of the cross test, with the values of the ten examples pinned in the TypeScript interpreter (M3a).
- The **RSB contract of textures** is written for M2b (`ARCHITECTURE.md` §5.2: `IMGS` section, `MATL` texture block from byte 100, UVs in `MESH`); the writer produces it only when asked, and until then the bytes of any scene are the same as before (M2a).
- **Viewport setting of the denoise** (`Preset::VIEWPORT`): three à-trous passes instead of five and a 3 × 3 spatial variance below four samples, with its own 24-row halo. Against 1024-sample references, from 8 samples its error stays within 3 % of the full filter and at 4 samples between 3 and 11 % above, in 60 % of the time on one thread and 40 % by bands. The final render and `rt` keep the full filter and its bits (`0xab15f290`) (U11).
- The launcher denoises the viewport in a lane of its own, a thread that takes one of the viewport's threads while it works (never one of a final render), with passes of about as long as a denoise lasts; the web does it with the viewport's workers by bands, between tile and tile. The launcher's frames carry their image number and the viewport follows it without asking for the sums again if they did not change (U11).
- `RNDR` gains `denoise_strength` at the end (56 B; without it, 1: the usual hashes) and the engine blends `noisy × (1 − s) + filtered × s` (`rt_post::denoise::blend`, `denoise_rows_at`); at 0 it does not run the filter. `rt --denoise-strength <S>` and `rt_denoise_with(preset, s, …)` in wasm (U11b).
- **Pixel filters** by importance sampling: centre, 1 px box (the usual one), 2 px tent and 3 px Blackman–Harris (inverse CDF tabulated in `f32`, no trigonometry at render time), and **extra samples on edges** (×2, ×4): pixels whose neighbour sees another part, another material or another depth, from the central rays, take `k` samples by index and add their mean; the same image with any number of threads and any tile cut. `RNDR` gains `pixel_filter` and `edge_supersample` at the end (64 B; without them, the earlier image); `rt --pixel-filter none|standard|soft|fine --edge-samples K` and `rt --write-e11-example` (E11).
- `rt-core::tiff` and `rt-core::dng`, the output's TIFF 6.0 and DNG 1.4 writers, with `std` only and from the public specification; the interface writes the same bytes (`encodeTiff`, `encodeDng`), with the files in `tests/fixtures/tiff/` as parity test. `rt` writes `--format tiff` (with `--bits 8|16|32`) and `--format dng`, or by the extension of `-o`; the launcher saves those results and allows writing `.tif`, `.tiff` and `.dng` (U12).
- **Stateless air particles** (S4a): new `rt-sim` crate (each particle is a pure function of seed, id and instant, in closed form, with curl-noise drift and death at the floor); RSB section `FXAM` with each effect's parameters (192 B, `ARCHITECTURE.md` §5.2); spheres with stable intersection, discs and capsules with their BVH in `rt-core`, a minimum size of 0.35 px for camera rays that preserves energy, visibility to camera, in reflections and in shadows; `rt_particles_eval` in `rt.wasm` for the viewport, and `rt --write-ambient-example`. Without effects, the pixels of any scene do not change.

### Light

- **Studio sets** (L6): 16 new setups, the **Sets** style, the first in the catalogue, which bring, besides the lights, what the product reflects and what it rests on: white, black and silver **cards** outside the frame, a **background** (colour, **gradient** or infinity sweep that receives light and shadow), a **floor** (glossy black or white acrylic, black mirror, matte or the shadow catcher), a **pool of light** behind the product, an exposure offset and the dome's strength. Each with its photographic reason in the help of its thumbnail: *Long strip and black edge*, *Dark field*, *Bright field*, *Infinite white*, *Light box with blacks*, *Family of angles*, *Grazing with fill*, *Black on black*, *Warm window*, *Liquid backlight*, *Warm-cool cinema*, *Colour pop*, *Gradient backdrop with a pool*, *Mirror floor*, *Overhead* and *Silhouette with halo* (L6).
- Applying a set is one undo entry; another setup replaces its decoration without touching your parts, *Reset setup* removes it and *Create studio* fits it again. The set's parts do not count for the part size, the framing or the Doctor, and can be switched off one by one in the *Light* section. **Use the set's camera** puts the view it is designed for (L6).
- The 15 studio product types **are a set**: *Create studio* (and *The product type's own*) puts its lights, its background, its floor, its cards and its pool of light, and the example or the imported model arrive already dressed (jewellery, *Light box with blacks*; watchmaking, automotive and tool, *Family of angles*; perfumery and cosmetics, *Long strip and black edge*; electronics, *Black on black*; appliances and medical instruments, *Infinite white*; indoor furniture, *Warm window*; footwear and textiles, *Grazing with fill*; optics, *Bright field*; standard and packaging, *Gradient backdrop with a pool*). The other setups look on them the same as before. Outdoor furniture keeps its sun (L6).
- The 88 **setup thumbnails** are now rendered by our engine, each set on the object it is designed for and the earlier setups on that of their style; those of the sets, twice as large (L6).

### Materials

- Five new materials for the sets: *White card*, *Black card*, *Glossy black acrylic* and *White acrylic* (with the slight haze of a real sheet) and *Black mirror* (the silver card is the *Brushed aluminium*) (L6).

### Environment

- **Gradient** background: two colours, top and bottom of the frame, in the preview and in the engine (L6).

## v0.1.5 — 2026-10-14

Preview release with own caustics and denoising, own lights that move in the
viewport, the AI's own prompt and variants, and a guided tour.
Everything from v0.1.2 to v0.1.4 stays the same.

### Engine

- **Own *denoise*** (E5b-1): an à-trous filter with edge stops (Dammertz et al. 2010) with the luminance stop guided by SVGF's variance (Schied et al. 2017), guided by the albedo, normals, depth and ids of each pixel and by its variance, which the film now accumulates; it never blends two parts. At 4 samples per pixel the error against a long render drops to between 4 and 20 % of that of the unfiltered image in the contact sheet's scenes. The same bits on the desktop and in the browser (E5b-1).
- **Caustics** with a progressive photon map (SPPM, Hachisuka and Jensen 2009, in Knaus and Zwicker 2011's form): light that passes through glass or bounces off polished metal onto the floor, the shadow catcher or a matte part arrives by photons and not by the tracer's noisy paths (also what lights the scene after a diffuse bounce, which gave sparkles), without being counted twice; the shadow of solid glass is no longer black. Deterministic with any number of threads (E5b-1).
- **Points and spots** in the integrator (`LGHT` 3 and 4): a sphere of uniform radiance sampled in its cone of directions (a point, by position), the cone with *smoothstep* transition as in the preview, visible to camera and in reflections with MIS; a narrow spot aimed at the scene is chosen like its point, so its circle of light does not come out noisy. Bit 2 of `LGHT.flags`: **no shadow** (L4).

### Interface

- Render window ▸ *Quality* ▸ **Caustics**: *Automatic* (default: on with glass or polished metal and a small light) · *On* · *Off*; in *Advanced*, **Caustic quality** (*Low · Medium · High*), **Denoise** (*Off · Viewport · Render · Both*, *Both* by default) and **Also save without denoise** (E5b-1).
- The *Full* viewport's meter says *Denoised* and *Caustics · N photons per sample* when the engine does so, and its *Denoise* button switches the viewport filter on or off (E5b-1).
- **Own lights** (L4): *+ Add light* in the *Lights* tab (and in the header's *Add ▸*, the viewport's right click on empty space and the palette) adds an **area** (rectangle, disc or sphere), a **point**, a **spot** (cone and transition) or a **sun**, in front of and above the part, switched on, selected and with the average brightness of the lit lights; *IES* is still *coming soon* (L5). Duplicate, delete and aim in the selected light's row; *Aim a light here ▸* in a part's context menu.
- A light's inspector has everything: name, type, shape, size or radius, azimuth, elevation and distance, **X, Y, Z coordinates**, **Aim at…** (the product's centre, a point, a part), rotation, spread, cone and transition, sun disc, temperature or colour, **power in watts with its lumens** (or lux), visible in reflections and to camera, **casts shadow**, on, *Place by reflection*, **Place on surface**, *Look through*, *Duplicate* and *Delete*. It no longer says *coming soon* (L4).
- **Save setup as…** also saves the own lights (type, target, rotation, transition, shadow); applied to another product type it keeps that type's total irradiance and the split between lights. **Reset to the setup** removes the own lights (L4).
- **Lights and cameras in the viewport**: achromatic glyphs (the panel's outline, the sphere, the point, the spot's cone, the sun's arrow, the pyramid of each saved camera) while the *Lights* or *Cameras* tab is open or one is selected; the view bar's **Lights and cameras** button, to the left of *Move*, shows or hides them. A click on a glyph selects it and **Move** moves and turns it (the light with its aim handle, the camera with its target), one undo entry per drag (L4).
- **Look through** (`Ctrl/⌘ ⇧ L`, the view bar's or inspector's button, double click on the glyph): the viewport looks from the selected light or camera, in *Fast* and in *Full*, and Orbit, Pan and Zoom move it (the light aims where the viewport looks); a locked camera does not move; `Esc` returns to the active camera (L4).
- **Guided tour** (U10): a layer of its own that goes through the screen zone by zone —application menu, tree and selection levels, view tools, *Fast* and *Full*, the inspector (product, light and setups, environment and sky, camera and focus, materials), the *Lights*, *Cameras* and *Studios* tabs, *Add ▸ Primitive*, the render window (queue and AI), the results and *Settings* section by section— with a short text per step, *Next · Back · Skip*, progress dots and the keys `→`, `←` and `Esc`; in Spanish and English, achromatic, and the steps open what they need (the render window, Settings, the tab, the drawer) and leave it as it was. It appears by itself on the first start and from *Help ▸ Guided tour*; *Skip* counts as seen, and it is remembered in the settings document (the data folder on desktop).
- The application menu gains **Help ▸** with *Guided tour*, *Guide*, *Keyboard shortcuts* and *About*.

### Project

- A project saves the own lights with their target, rotation, transition and shadow; earlier projects, studios and libraries open the same, with their lights aiming at the product's centre (L4).
- The AI settings of the render window and of each job also save the own prompt and the number of variants; an earlier project opens with no prompt and one variant (X4b).

### AI post-processing

- **Runtime notice** (U10): with a model installed and no runtime (or with the download paused, or not starting, or without Microsoft Visual C++ on Windows), the render window's AI section and *Settings ▸ AI post-processing* say so with an **Install** button (the same flow as the *Runtime* row), and the status bar carries a discreet note once per session. Without a model, or with a runtime that starts, they say nothing.
- **The installer also asks for the runtime** (U10): when choosing some model in the *AI models* step the runtime recommended for the machine is ticked (Vulkan with a graphics card, CPU without one: the same rule and data as the application), it can be unticked, and the launcher downloads it on the first start along with the models. The portables' first-start selector offers it the same way. What the installer chooses in *Run on the processor* becomes *Settings ▸ AI post-processing ▸ Run on*.
- **Own prompt** in the render window's *AI post-processing* section: a multi-line field (up to 400 characters) to describe the light or the mood; it goes with the job (it is saved in the project, undone in one go on leaving the field and each queue job carries its own) and is added at the end of the scene's prompt, without replacing it; the fixed negative stays the same. If the model in use does not accept a text prompt, the field shows disabled with the reason and nothing is sent (X4b).
- **Variants**: a number from 1 to 8 (1 by default) next to *Another variation*. A job with N variants does a single engine render and N AI passes with consecutive seeds, with the model loaded once; the queue says *AI · variant 2 of 4 · tile 3 of 4*; each variant carries its guard report and its file (`_AI`, `_AI_2`, `_AI_3`…). Stopping halfway keeps the render and the finished variants. The section warns of the estimated AI time once it has been measured on this machine (X4b).
- The results viewer shows a **strip of thumbnails** of the variants under the header: the chosen one is the one the divider compares with the render, with its report; *Save this variant* and *Save all*. The queue and the history say how many AI images each result has (X4b).
- **System prompt** in *Settings ▸ AI post-processing*: a few general words for all images, which go before those of the scene and the job's own prompt, with *Restore default*. The guard's protections do not depend on it. For a model that reads few tokens (SD 1.5: 77) its short version is used while it has not been changed, and what does not fit is trimmed starting with the own prompt, then the scene and lastly the system one, with a line saying what was left out (X4b).
- An imported model declares in its `model.repackshot.json` whether it follows a text prompt (`capabilities.textPrompt`) and how many tokens it reads (`capabilities.maxPromptTokens`); the import form asks for it (X4b).

### Fixes

- Tests only, no effect on the application: the launcher test that follows a tiled post-processing demanded that the response to the job say *waiting*, and with the machine heavily loaded the job had already started; now it accepts any state before the first tile.

### Known limitations

- **The AI is still untested on a graphics card**, now also with the own prompt and the variants. With SD 1.5 (77 tokens) the own prompt almost never fits: the token count is prudent and runs out of room before the model does (X4b).
- With *Compare with…* (another result), choosing a variant in the strip only changes the report line (X4b).
- **The installer page with the runtime has not been seen on a real Windows machine**: it is built and a test checks its script, but the installer cannot be run here. Anyone updating sees the guided tour once, as on a first start, and the runtime notice appears when a model is already downloaded, not while it is downloading (U10).
- IES profiles are still *coming soon* (L5). Points, spheres and spots shoot no photons: they give no caustics (L4, E5b-1).
- **Caustics**: only from *glossy* area lights, the sun and emitters, not from the environment; the gathering radius is one per pass, not per pixel; the highlights of a small light seen through polished glass still come from the tracer and take long to clean up; with a transparent background the shadow catcher picks up no caustics. They cost about 24 % more time (E5b-1).
- **Denoising**: it filters colour without separating direct from indirect light, does not act on reduced-resolution frames while the view moves, and the firefly clamp loses some energy where there are any. At 1920 × 1080 it takes a few seconds (E5b-1).
- Those of v0.1.2 to v0.1.4 remain, above all that **none of the new desktop features has been tested on a real Windows machine**.

## v0.1.4 — 2026-10-13

Preview release with AI post-processing working end to end
on the desktop, the own physical sky, primitives and the scale
tool. Everything in v0.1.2 and v0.1.3 stays the same.

### Engine

- **Own physical sky** (E5c): the default daytime sky has the functional form of Hošek and Wilkie (2012) with coefficients fitted by us to our own spectral simulation of the atmosphere (spherical layers, molecules, haze, ozone, ground), in a clean room. Preetham's remains as *Classic*. The Fast mode preview draws the same sky as the engine, bit for bit (E5c).

### Interface

- *Environment* ▸ *Sky* debuts **Model**: *Physical* (default) or *Classic*; haze now goes down to 1 (clean air) in the physical one. Projects saved earlier open with the physical one (E5c).
- Parametric **primitives** in *Add ▸ Primitive* (header menu, the *Scene* panel's `+`, the command palette and the viewport's right click on empty space): *Box* (with bevel radius), *Plane*, *Disc*, *Cylinder*, *Pedestal* (bevelled cylinder), *Sphere*, *Cone*, *Torus*, *Capsule*, *Tube*, *Steps* and *Infinity sweep* (the floor that curves up into a wall). They are born with a studio's judgement: the *Box* and the *Pedestal* as a base under the product, 1.4 times its footprint with the product resting on top (a single undo entry); the plane and the disc under it; the infinity sweep with its wall behind; the rest on the floor, next to the product. Neutral *Studio white* material (U9).
- The **infinity sweep** is born facing the active camera and filling its whole frame with margin (the lens and the output format count), with the wall behind the product (and behind the setup's backlight and rear lights, which keep lighting) and a soft curve; *Fit to camera* redoes it after moving the camera (U9).
- **Primitive** section of the inspector: the dimensions in mm (width, depth, height, radii, bevel, segments, steps), live: changing one regenerates the part, a drag is one undo entry and the part does not come off the floor. *Convert to mesh* freezes the dimensions (also in the *Geometry ▸* menu) (U9).
- Primitives have CAD faces per logical face (the lid, the side, the bevel, each step), so the *Faces* level, per-face materials and *Separate by CAD faces* work with them; UVs in [0, 1] and correct normals (U9).
- **Scale** tool (`S`) in the view bar, next to *Move*: the *Move* gizmo with only its scale handles (a cube per axis and the central point for all three), around the pivot, in local or global axes, 10 % increments with `Shift`; a drag is one undo entry (U9).
- **Right click ▸ Scale…** on a part in the viewport or the tree: an inline panel with *Uniform* (%), *Per axis* (X, Y, Z in %) and *Custom* (mm of width, depth and height with the proportion locked), *Apply* and *Reset scale*; it acts on the selection at the current level, around its pivot (U9).
- Lights, *Create studio*, the part size and the Doctor look at the product and not at the set dressing: an infinity sweep six times larger does not move the lights or change the scale (U9).

### Project

- A project saves primitives as dimensions in an optional field of the node, not as a mesh, and generates them again on opening; it is saved, opened and saved again in the same bytes. The schema stays at 2 and earlier projects open the same (U9).

### AI post-processing

- On desktop the render window's *AI post-processing* switch **now works** and stops saying *coming soon*; so does *Settings ▸ AI post-processing*. On the web it still says it (X3c).
- **The desktop pipeline, end to end**: a final render with *AI post-processing* on is done by the launcher without the pixels going to the page and back: tiles, stable-diffusion.cpp with the active model (loaded once, also between previews), the deterministic guard and retries with less intervention if a protection does not pass. The history keeps both images and the guard's report (X3c).
- The AI image is written from the render's linear light, with its exposure and its curve: a 16-bit PNG or an EXR remain so, and with Intervention 0 it is the same file as the engine's, byte for byte. With Intervention 0 the runtime is not even started (X3c).
- The queue shows where the AI is: *AI · loading the model*, *AI · tile 2 of 4*, *· attempt 2*, *AI · checking*. Stopping or pausing at that moment keeps the engine image in the history (X3c).
- The render window's preview uses the same pipeline on desktop, with the Fast mode frame (X3c).
- The studio floor counts as a surface the AI can relight (its contact shadows and bounced light), with its own colour check; before, a floor seen before any part was treated as background. The preview passes draw it the same as the engine (X3c).
- The prompt comes from the scene's materials, lights and style, with the fixed negative; the guard receives the table of materials with their names (X3c).
- On Windows, if the runtime lacks the Microsoft Visual C++ 2015–2022 environment, *Settings ▸ AI post-processing ▸ Runtime* says so and offers *Install Microsoft Visual C++ runtime…* (Microsoft's official page) and *Check again* (X3c).
- *About* lists stable-diffusion.cpp and ggml with their MIT licences (X3c).
- The results viewer gives the guard's report its own line, full width under the title and buttons, instead of squeezing it into a narrow column next to the title; the buttons go below the title when they do not fit beside it, and *Close* stays in the corner (X3c).
- A post-processing nobody asks about (its window was closed) stops by itself after two minutes, and switching the switch off frees the model from memory (X3c).

### Fixes

- *Focus with a click* focuses exactly on the clicked point: it measured the distance in a straight line and the engine focuses a plane perpendicular to the view, so any point off-centre ended up behind the focus plane (reported).
- The camera note no longer says depth of field is *coming soon*: it shows in *Full* and in the render; *Fast* does not draw it.
- Tests only, no effect on the application: the viewer's “unread answers” test, which failed from time to time with the machine heavily loaded, now waits on conditions and not on times (P3a).

### Known limitations

- **The first real AI image on a graphics card has not been tested.** There is no GPU here: the pipeline was tested end to end with a fake runtime and just once with real SD 1.5 on CPU (a 256 × 192 example, 53 s). Timings with Z-Image, the editing models (FLUX.2 klein and Qwen-Image-Edit, which go as *img2img* plus a reference image) and the guard's tolerances are provisional until phase X1 part B (X3c).
- Only SD 1.5 carries ControlNet (depth); with the other models, and with edges in all of them, the protection of shapes is given by the guard (X3c).
- **On Windows the runtime needs the Microsoft Visual C++ 2015–2022 (x64) environment**, which does not ship with Repackshot or the installer. *Settings ▸ AI post-processing ▸ Runtime* says so and its button opens Microsoft's download page (X3c). On Linux glibc 2.38 or later is needed (X3b).
- **The web version still has no AI** (phase X3d): there the switch says *coming soon*. Animations do not go through the AI either (X4).
- With an EXR job, the history keeps the AI image as EXR and the viewer does not compare *Render | AI*, because browsers do not show EXR. If a job is paused during the AI, *Resume* leaves a second result of the same job (X3c).
- **Physical sky with a low sun.** With the sun at 20° or more the error against our simulator is 1 to 8 %; at 10° it rises to 5–15 % and below 3° to 9–17 %, and it shows: at dawn, an azimuthal pattern of ±20 %, and in the golden hour with haze a glow 20 % darker next to the sun. It is the limit of the functional form. The ground albedo is fixed (0.2) and the sun is a 5772 K black body. Earlier projects open with the physical sky and may change in appearance: *Classic* returns the previous one (E5c).
- **Primitives.** Moving the camera does not refit the infinity sweep (*Fit to camera* redoes it); changing a base's dimensions does not raise the product again; *Flip normals*, *Smoothing* and *Separate* turn the primitive into a mesh; a part scaled with *Scale* still shows its unscaled dimensions in the *Primitive* section; and versions earlier than this one do not see the primitives of a new project (U9).
- Lights, *Create studio* and the Doctor look at the product and not at the set dressing (the parts that are not primitives); *Frame all* still frames everything (U9).
- Those of v0.1.2 and v0.1.3 remain, above all that **none of the new desktop features has been tested on a real Windows machine**.

## v0.1.3 — 2026-10-13

Preview release that fixes the detection of graphics cards on Windows,
found when testing v0.1.2. Everything else is as in v0.1.2.

### Desktop

- On Windows, graphics cards are finally visible: v0.1.2 found none on any machine (only the CPU), because `reg` exits with an error on reaching a protected registry subkey and the launcher threw away its whole answer. Now it asks DXGI, with the exact video memory, and also the registry (key by key), `Win32_VideoController` and `wmic`; the launcher's log (`logs/repackshot.log`, `hardware:` lines) says what each one answered, and if none can answer *Settings* says that the cards could not be read instead of saying there are none (P3e).
- *Settings ▸ AI post-processing ▸ This computer*, the *GPU* row, the Vulkan or CPU choice of the AI engine and the installer's model step depend on that detection; the installer reads the same `--hardware` and now sees the cards (P3e).
- System programs (`reg.exe`, `powershell.exe`, `WMIC.exe`) are launched by their absolute path in `System32` (P3e).

### Engine

- Internal, no visible changes: exact engine passes for AI post-processing (albedo, normal, depth, part ID, material ID and the lens's circle of confusion). Requesting them does not change a pixel of the image. On desktop, the launcher keeps those of the last four final renders. Nothing uses them yet: the AI pipeline will consume them (X2).

### Fixes

- A test of the card parser fed it the text without `reg`'s exit code, and that is why the bug escaped: it was more permissive than reality. Now the test reads programs that print and exit with an error, like the real `reg` (P3e).
- An AI launcher test took for granted that the machine has no graphics card and failed on any that had one; now it asks for the CPU explicitly (P3e).

### Known limitations

- All those of v0.1.2 remain, including the main one: AI post-processing generates no image yet (X3c pipeline).
- Card detection is still untested on a real Windows machine beyond Wine. If it still fails, `logs/repackshot.log` says what each source answered.
- The installer's models page does not distinguish “could not be read” from “no card”.

## v0.1.2 — 2026-10-13

Preview release with the desktop fixes requested after testing
v0.1.0, plus half-done AI post-processing (the interface and the
runtime, not the pipeline) and several engine and interface improvements.

### Desktop

- Own window on Windows, drawn by Edge WebView2 (the one Windows 10 and 11 ship) and not by a browser tab. It uses the system title bar, dark with the dark theme, with the title *Repackshot — project* and the own icon (P3c).
- Closing the window (button, `Alt F4`, taskbar, system menu) asks with our own window *Save · Don’t save · Cancel* if there are unsaved changes; never Edge's prompt (P3c).
- Taskbar icon with its own identity (`Repackshot.App`), also in the installer's shortcuts, so that they group when pinned. The window remembers size, position and theme (P3c).
- If the loader or the WebView2 runtime is missing, Edge's app window opens as a fallback, and *Settings ▸ Desktop* says which of the two it is and why. `--window=webview2|browser` forces one (P3c).
- The header shows the logo with a downward arrow instead of the three bars (P3c).
- Nothing from the browser: no context menu, text-selection mini menu, offer to translate, `Ctrl F`, `Ctrl P`, `Ctrl R`, keyboard zoom or navigation; external links open in the system browser (P3b, P3c).
- Folder, open and save dialogs are the system's, opened by the launcher (PowerShell on Windows; `zenity` or `kdialog` on Linux) and appear in front of the window (P3b).
- Renders, projects, imports, exports and models are written by the launcher, only where the person chose in a dialog; the browser's downloads bubble does not appear (P3b).
- On desktop the page is only the interface: settings, library, results history, thumbnails and models live in the launcher's data folder and not in the browser's storage (P3e).
- The window's origin no longer changes at every start (stable port per data folder), so settings, library and history **survive a restart**; before, they were lost (P3e).
- *Settings ▸ Storage* measures the space used and the data folder with the launcher, and *Free up* goes through it (P3e).
- The list of graphics cards in *Settings* comes from the launcher, with the machine's real cards (P3e).
- No *Settings* row talks about the browser on desktop, and rows no longer overlap at any width or interface size (P3e).
- The desktop server no longer sends the files of `assets/` that carry no hash as “immutable”, so a regenerated resource does not look old forever (A6).

### Viewport and queue

- Full mode no longer stalls after a while of changes. Cause: the viewport held the six connections the browser opens to the launcher and requests waited endlessly (P3a).
- Never again a silent “0 samples”: a watchdog restarts the viewport if it stops and the meter says why (P3a).
- The viewport stays alive while rendering, sharing the machine (*Full · sharing with Render*). *Settings ▸ Render engine ▸ While a render runs* chooses between keeping it alive or pausing it to render faster (P3a).
- The queue pauses and resumes: the button says *Pause* while it runs, *Resume* after a pause and *Start queue* otherwise. *Pause* frees the engine and *Resume* carries on where it was (P3a).

### Interface

- Dragging a material (a thumbnail from the catalogue or from *Mine*, or the sphere of the selection's material) onto a part in the viewport or a tree row assigns it, with ghost, highlight and `Esc` to cancel; a single undo entry. In the viewport it reaches what a click would select at the current level (part, assembly, model or face). `Alt` on drop gives it an own copy. If the target carries different materials, it still asks inline (U7).
- Box selection with *Select* and *Move*: `Ctrl/⌘` + drag replaces the selection, with `Shift` it adds and with `Alt` it removes. From left to right it is a window (what stays entirely inside, continuous outline) and from right to left a crossing (what it touches, dashed outline), at *Model*, *Group*, *Part* or *Faces* level; the *X-ray* button also picks hidden faces. With the mouse schemes that leave the left button free, a plain drag draws the box. Without `Ctrl/⌘`, the left button still orbits; `Ctrl/⌘` + drag no longer pans with those tools (U7).
- At *Faces* level, a click picks the whole face (the CAD face in STEP and IGES; in other meshes, the surface that continues). `Shift` click adds a single triangle, `Ctrl/⌘` click toggles the face in or out and `Alt` click removes it (M1).
- *Separate by CAD faces* stops being *coming soon*: it is in the part menu and splits a STEP or IGES part into one per CAD face, each with its colour (M1).
- Clicks in the viewport combine with the selection that was there: `Shift` adds, `Ctrl/⌘` toggles, `Alt` removes (U7).
- Settings ▸ Preferences ▸ Viewport and navigation ▸ Mouse and the *Select* tooltip explain how the box is drawn, in Spanish and English (U7).

### Engine and environment

- Real glass: transmission with IOR and roughness, colour absorption inside the solid (*Absorption distance*), thin walls and cutouts by opacity (E5).
- Clear coat over any material, anisotropy and emitters that light the scene (E5).
- New environment: procedural *Sky* with the setup's sun, *Plane*, and *HDRI file* with own `.hdr` and `.exr` readers, with rotation and intensity and importance sampling (E5).
- *Background image* (fill, fit, stretch), saved inside the project (E5).

### AI post-processing (half done)

- Guard engine: a Rust library and its wasm version that, from the render's passes, check that the AI does not move edges, change the materials' colours or smudge what is in focus, and limit or reject whatever goes over (X3a).
- Download and installation of the runtime (stable-diffusion.cpp, Vulkan and CPU builds for Windows and Linux) from *Settings ▸ AI post-processing ▸ Runtime*, with progress, pause, resume and `sha256` check, and *Run on* (Automatic, Vulkan or CPU) (X3b).
- The launcher knows how to start the runtime as a helper process with progress, cancellation and time limit, and stops it on closing (X3b).
- The render window debuts the **AI post-processing** section (folded and off): a switch with the model in use or the reason it cannot, six controls from 0 to 100 with their sentence (*Intervention*, *Light*, *Bounces*, *Wear and micro-detail*, *Style*, *Style strength*), the protections as fixed chips with a padlock, *Another variation* and a Fast mode preview with a before-and-after divider that updates on releasing a control and states the measured time. Until the real pipeline arrives (X3c) the switch says *coming soon*; with `?ai=synthetic` a synthetic service runs, with no model (X4).
- A result with AI keeps both images and the guard's report: the viewer opens them with the divider (*Render | AI*) and a line *Checked: geometry ✓ · materials ✓ (max ΔE 1.8) · resolution ✓ · focus ✓*, and the queue and history show both thumbnails; on desktop the AI image is one more file of the result (`<id>.ai.<ext>`) (X4).

### Studio resources

- Data prepared for the studio tools to come: 16 lens prescriptions, 20 bokeh types, 45 diaphragm masks, 12 gobos and 14 camera moves, all generated by code in the repository. No interface yet (A6).

### Fixes

- The inspector was not rebuilt when picking the first face of a part (M1).
- Assigning a material the target already carried created an empty undo entry (U7).
- The slider did not follow the value on undo while it had focus: the field changed and the knob stayed where it was (X4).
- A view of the engine that the launcher forgot or rejected was not requested again, and the animation loop stopped forever on any exception (P3a).
- A render job that panicked never finished and blocked the next; now it ends as failed (P3a).
- An AI server left by an earlier start stopped badly if the data folder is behind a symbolic link (X3b).
- When reopening on Windows with the remembered port still in `TIME_WAIT`, another one is taken once instead of failing (P3e).
- CI and test-only fixes, with no effect on the application (CI, X3b, P3e): the Rust toolchain pinned to 1.97.0; the AI engine's test catalogue enters through the server options and not through a file that only the debug build read; the orphan-server test waited badly for the process to start (a race with `vfork`); and the engine's parity test had a race when returning the last frame.

### Known limitations

- **AI post-processing generates no image yet.** The interface is in the render window, but the switch says *coming soon*: the real pipeline is phase X3c. The models and the runtime (stable-diffusion.cpp) can be downloaded and installed, and nothing more.
- The Windows builds of the runtime need the **Visual C++ 2015–2022 (x64)** environment; they do not bring it and the installer does not install it yet. If it is missing, *Settings* says so. The Linux ones need glibc 2.38 or later. Downloading uses the system's `curl` (Windows 10 1803 or later); without it, *Install from a file…*.
- The update check reads GitHub's public releases: while the repository is private it will say it finds no published versions.
- **None of the new desktop features has been tested on a real Windows machine** (only under Wine and with Chromium on Linux): the WebView2 window and its closing; dialogs appearing in front of the window; the Edge mini menu disappearing entirely; taskbar grouping and the shortcuts' identifier (Wine does not let it be read); Edge found through *App Paths*; video memory with real drivers; the installer clicked by hand; Vulkan with a real card; settings that survive a restart; Full mode for a long while; and SmartScreen, because the `.exe` is not signed.
- On Windows, `repackshot --version` is only seen with the output redirected (graphical subsystem).
- On Linux the window is still Chromium's in app mode, with P3b's hardening; the own window arrives with P3d.
- The sky is Preetham's; the own physical sky is phase E5c. In *Fast* the background image is painted as is, and in *Full* and in the render it goes through the exposure and the tone curve. Very rough glass loses some energy and solid glass gives noisy caustics with small emitters. `.exr` files with PIZ, PXR24, B44 or DWA compression, tiled or deep, are rejected.
- At *Faces* level: the counter says *faces* but counts triangles; the box picks the faces of a single part; the catalogue only appears with a face selected; and a flat face next to a very soft fillet may follow the fillet in meshes that are not STEP or IGES (M1, U7).
- Those of v0.1.0 remain: no video encoding (animations come out as frame sequences), STEP and IGES assume Z up and there is no macOS version.

## v0.1.1 — 2026-10-13

### Settings

- **Updates**, a new section above *About*: *Check for updates*
  with the result in its row, *Check at start-up*
  (on by default) and *Last check*. On start it checks
  in the background and notifies in the status bar, with *Download* (the
  package for your platform), *Release notes* and *Later*.

### Known limitations

- The check reads the public GitHub releases of
  `Grohle-developer/Repackshot`; while the repository is private
  it will say it finds no published versions.
- Those of v0.1.0 remain; the desktop fixes that were requested (live
  viewport during the render, a queue that pauses, own window without browser
  notices, native dialogs, dragging materials) arrive in the
  next one.

## v0.1.0 — 2026-10-13

First release. It opens in standard mode, with a studio already set up.

### Interface

- Three columns and a button: scene, image and inspector; **Render…** opens the render window (U1).
- Light and dark themes, in black and white; Spanish and English, switchable on the fly (U1).
- Preview viewport with three.js; selection on four levels; guide with arrows (U1).
- Undo and redo across the whole state, with labels in both languages (U1).
- Move tool with gizmo, pivots, rest and centre, with a single undo per gesture (U3).
- Duplicate, link, group, linear and circular patterns, and material and geometry operations (U3).
- Full context menu and keyboard shortcuts (U3).
- Own library of materials, light setups, product types and studios, with thumbnails, export and import in JSON (U4).

### Engine

- Render engine in Rust with no dependencies (`rt-core`, `rt-cli`, `rt-wasm`), with the RSB scene format and an own PNG (E1).
- 4- or 8-way BVH with SAH and SIMD traversal (scalar, SSE2, AVX2 and simd128), with bit-for-bit equal results (E2).
- Path tracer with Owen-scrambled Sobol sampling, physical BSDF, area lights and sun with NEE and MIS (E3).
- Studio dome, floor and shadow catcher, colour or transparent background, and linear, ACES, filmic, AgX and standard tone curves (E3).
- The engine runs in the browser with a worker pool and `rt.wasm`, with the same image as the command line (E4).
- *Fast* (preview) and *Full* (tracer) modes in the viewport, with a switch in the header (E4).
- Fix for the power of panel lights: their flux follows Cycles' convention (π/4 × power × size²); before they gave π times less light (a fix after E4).

### Import

- OBJ, STL (ASCII and binary), glTF and GLB, with welding, angle-based normals and sharp edges (I1, U1).
- STEP (AP203, AP214 and AP242) and IGES, with CAD faces, assemblies, colours and adjustable tessellation quality (I2).
- FBX, 3DM, 3MF, PLY, DAE and USD (I3).
- Import sheet with detected units and axis; it applies the units before adding the model (I3).
- The Doctor offers ×1000 and ÷1000 when the file declares its units (I1).
- Dropping a model onto the empty state imports it, rests it and frames it (U1).

### Render and queue

- Render window with *Image* and *Animation*; output in 8- or 16-bit PNG, JPEG and linear EXR (U5).
- Name template, folder, size in pixels or in print, with dpi written into the PNG and JPEG (U5).
- *Finish by* samples, by time or by whichever comes first (U5).
- Animations as frame sequences; video stays *coming soon* (U5).
- Undoable queue, with reorder, edit, duplicate, pause and viewing the finished ones (U5).
- Results viewer with zoom, data, divider comparison and history in IndexedDB (U5).
- *Render* always uses the tracer, also in the browser (E4).

### Project

- Save and open `.repack.json` with the meshes inside; it does not depend on external paths (U2).
- File remembered with File System Access: `Ctrl/⌘ S` saves to it and `Ctrl/⌘ ⇧ S` asks where (U2).
- Unsaved changes: inline question and a notice on closing the tab (U2).
- Opening validates the file before touching anything; dropping a project on the window opens it (U2).

### Settings and AI models

- Settings window with search, about 57 settings and the Application, Render and System groups (U6).
- Accessibility: interface and text size, high contrast, reduce motion and announcements for screen readers (U6).
- AI model manager: chunked downloads that resume and `sha256` verification (U6).
- Catalogue of seven models, with files pinned to a commit, sizes and `sha256` checked, and licences cited in `ai-licences.md` (X1, part A).
- Model recommendation according to the machine; import with a manifest that rejects pickle files (U6).

### Desktop

- Own `repackshot` launcher in Rust, with the standard library only: it opens the interface in an Edge or Chromium window with its own profile (P2).
- Local server on `127.0.0.1` only, with a per-start token and `Host` and `Origin` checks (P2).
- Native engine with all the machine's threads, with the same result as the browser (P2).
- Windows portable (zip), Linux portable (tar.gz with a static binary) and Windows installer (NSIS, per user and without administrator) (P2).
- The installer lets you choose which AI models the application will download at start-up (P2).
- Own data folder, or `data/` next to the program in portable mode (P2).
- Black-and-white application icon, third-party notices included, and `SHA256SUMS.txt` with the packages' sums (P2).
- Fix: an empty project now renders in the native engine; before, the launcher asked for meshes that did not exist (a bug found in P2).

### Known limitations

- There is no AI post-processing yet. Models can be downloaded and left ready.
- There is no video encoding; animations come out as frame sequences.
- The Windows version has been tested under Wine, not on a real Windows machine, and is not signed: SmartScreen will warn when running it.
- In STEP and IGES the vertical axis is assumed to be Z, because the format does not declare it.
- There is no macOS version.
