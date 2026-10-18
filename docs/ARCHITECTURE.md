# Architecture — stack, boundaries and contracts

Technical reference document. Self-contained: with it and the catalogues in
`src/data/`, any roadmap phase can be carried out without further context.
The decisions here are settled; changing them is a roadmap item, not an
initiative inside a PR.

---

## 1 · Stack (decided)

| Layer | Choice | Why |
| --- | --- | --- |
| Language | Strict **TypeScript**, ES2022, ES modules | One language for model, engine and interface; types as the contract between phases carried out by different agents |
| Bundling | **Vite** | Instant start-up, static `build`, no configuration to maintain |
| Interface | **HTML + CSS + TypeScript, no framework** | The interface is a set of panels with centralised state; a framework would add a dependency and a style that would then have to be taught to every agent. Components are functions that return DOM elements and subscribe to the *store* |
| Preview | **three.js** (`WebGLRenderer`) | Fast rasterisation for orbiting, selecting and placing while the camera moves. **It is not the engine**: it is the interactive view |
| Render engine | **Rust, from scratch, no external dependencies** (`engine/`): a CPU path tracer that compiles to **WebAssembly** for the browser and to a **native binary** for the command line and the desktop | Runs on any system and architecture (x86_64, ARM64, RISC-V, wasm32) with no GPU or drivers; the same code renders in the browser, in the CI runner and on the desktop; deterministic; efficient by design (wide BVH with SIMD, low-discrepancy sampling, tile queues) |
| Import | In `src/io/`, loaded on demand: three's `GLTFLoader`, `FBXLoader`, `3MFLoader`, `PLYLoader`, `ColladaLoader`, `USDZLoader` and `3DMLoader` (MIT); **rhino3dm** (openNURBS, MIT) for `.3dm`; **occt-import-js** (LGPL-2.1, OpenCascade compiled to wasm) for STEP and IGES, as the **only LGPL exception** and isolated (see below); own OBJ and STL readers. **Decided**: these libraries are accepted in the `io/` layer, are loaded only on import and never enter the engine | Import is the trunk of the product: what people export from Rhino, SolidWorks, Fusion, Maya, ZBrush and KeyShot has to come in with a drag. The proprietary native formats of those programs are not read (`SPEC.md` §5) |
| AI post-processing (optional) | **Decided** in `AI-POST.md` §7. Desktop, all native: **stable-diffusion.cpp** (MIT, on top of ggml, MIT) as a **separate process** run by the launcher, never linked and never inside `engine/`, in official builds pinned by size and `sha256` in `src/data/ai-runtimes.json` (release `master-959-d637cfb`: Vulkan and CPU for Windows and Linux x86_64, X3b), which the launcher downloads on demand from *Settings* with the system `curl`, unpacks with its own zip reader and starts as `sd-server` on a random loopback address; they are not in the installer or in the portables, and are not redistributed; the guard and the work with pixels live in `engine/crates/rt-post`, Rust with no dependencies (X3a). Web: **ONNX Runtime Web** (MIT) with WebGPU in workers and `rt-post` as a separate `post.wasm` (X3d). Default model **Z-Image-Turbo** (Apache-2.0), downloaded with a `sha256`, never in the repository | Optional, local improvement of the image with a deterministic guard that prevents changes to geometry, materials, resolution or focus; kept apart from the engine (`rt-core` does not know it exists) |
| Tests | **vitest** (model and interface), **cargo test** (engine: analytic scenes, determinism, wasm/native parity), **playwright-core** with the local Chromium for screenshots | The interface suite runs without a GPU; the engine suite runs on any CPU |
| Desktop packaging | **Own launcher in Rust, `std` only** (`engine/crates/rt-app`, binary `repackshot`), decided for the first release (P2). It serves the interface on `127.0.0.1`, opens it in an application window of Edge (Windows) or Chromium/Chrome (Linux) and renders with `rt-core` **natively** on all threads. Windows x86_64 cross-compiled with mingw-w64; Linux x86_64 static with musl; Windows installer with **NSIS** (a build tool, not a dependency) | **Tauri is ruled out**: it drags in hundreds of crates from crates.io (blocked in this environment) and needs to build on Windows (no Actions minutes). The own launcher keeps the project free of Rust dependencies, the web interface does not change, and Edge ships with Windows. See §5.5 |

The *Ambient* particles (S4a) add no dependencies: the simulator
is a crate of the engine's own (`rt-sim`) and the preview uses three.js's
`THREE.Points` and `InstancedMesh`, which were already there.

Encoded video (N1) adds none either: the encoder is the browser's
(WebCodecs, a platform API) and the WebM and MP4 containers are
written by two own *muxers* in `src/io/` (§5.4 ter). There is no
*muxing* library to list in this table.

What is **not** used: React/Vue/Svelte, Tailwind, icon fonts,
network fonts, Electron, WebGPU, any existing renderer (neither
Embree, nor OptiX, nor pbrt ports, nor `three-gpu-pathtracer`), any
external crate in the engine, any KeyShot binary or resource (see
`README.md`, clean-room rules).

Adding a dependency **to the interface** requires a line in this table
with its licence (only MIT, Apache-2.0, BSD, ISC, CC0 or compatible). The
project is distributed under **PolyForm Noncommercial 1.0.0**: a
copyleft (GPL, AGPL) or non-commercial dependency is not compatible with that
nor with the holder being able to license it commercially, and is not admitted.
**The only exception, decided: `occt-import-js` (LGPL-2.1)** for STEP and
IGES. It is admitted because the LGPL applies only to that library and not to
the program that uses it, provided the library remains a separate module
that the user can replace (LGPL-2.1 §6). Conditions, all
mandatory: it is copied **unmodified** from `node_modules` to
`public/vendor/occt-import-js/` with `tools/vendor.mjs` (like rhino3dm),
it is **never bundled** into the Vite *chunks*, it is loaded by URL in a
worker only when importing a STEP or IGES, it carries its LGPL-2.1 licence
text and the link to its source code next to it, and *About* names it. That way it
does not affect the project's licence or the holder's ability to license it
commercially. No other LGPL without a new decision. The
**engine admits no dependencies**: `engine/Cargo.lock` contains only the
crates of the workspace itself, and CI checks it.

**Plugins are not dependencies** (P6, §9). Repackshot ships no
plugin, does not link their code and does not redistribute it: the user installs them from
*Settings ▸ Plugins*, under their own licence (that of the film one, from aintfilm,
is **closed**, and the interface says so: *This plugin's code is closed; the
Repackshot licence does not cover it*). That is why they have no line in this table nor
fall under the permissive-licence rule, and their code does not enter the
repository: only the host is here, the registry (`src/data/plugins.json`,
which pins the package by its `sha256`), each plugin's own glue
(`tools/plugins/film/plugin.js`, Repackshot code) and the tool that assembles
the package from the other program's *checkout*. What is closed (the
WebAssembly module, the recipes, the logo, the licence) goes only inside the
encrypted package.

**Installed versions** in the initial scaffolding: three 0.186, Vite 8,
TypeScript 7, vitest 5, playwright-core 1.64 (`package-lock.json` is
the truth; this list is a guide). **rhino3dm 8.35.0** (openNURBS, MIT,
Robert McNeel & Associates): reads `.3dm` in `io/rhino.ts`, loaded on
demand in a worker; `rhino3dm.js` and `.wasm` are copied from
`node_modules` to `public/vendor/rhino3dm/` at build time
(`tools/vendor.mjs`). **occt-import-js 0.0.23** (OpenCascade in wasm,
LGPL-2.1, Viktor Kovács): reads STEP and IGES in `io/step.ts` with its own worker
(`io/step-worker.ts`) that downloads `occt-import-js.js` and `.wasm`
unmodified from `public/vendor/occt-import-js/`, copied by
`tools/vendor.mjs` with `license.occt-import-js.txt`, `license.occt.txt` and
a `README.txt` with the version and the links to the source;
`tests/chunks.test.ts` checks that no *chunk* contains it. Engine: stable Rust, **pinned to 1.97.0 in CI** (`RUST_VERSION` and `RUSTUP_TOOLCHAIN` in `engine.yml` and `release.yml`, the same version as the development machines: every new Rust brings new clippy *lints* and with `-D warnings` would turn CI red without anything changing; bumping the version is a deliberate change that fixes its *lints*),
targets `wasm32-unknown-unknown`, `aarch64-unknown-linux-gnu` and
`riscv64gc-unknown-linux-gnu` checked in CI besides the native one.
HDRIs (`.hdr` and `.exr`) are read with own readers, in the interface
(`src/io/hdri.ts`) and in the engine (`rt-core`: RGBE, OpenEXR and *inflate*);
three's `HDRLoader` and `EXRLoader` appear only in the tests, as an
independent reader to compare against (E5). E5 adds no dependencies. E5c
neither: the atmosphere simulator and the physical-sky fit
(`engine/crates/rt-sky`) are own Rust with `std` only, and what they produce
enters the repository as data (`rt-core/src/sky_table.rs` and
`src/core/sky-table.ts`, with their recipe and their *hash*).

---

## 2 · Repository map

```
index.html                  the page; mounts src/main.ts
src/
  main.ts                   start-up: creates the store, mounts the interface, starts the viewer
  core/                     MODEL. Pure TypeScript: no DOM, no three, no fetch
    store.ts                state, actions, undo, subscription (§4)
    scene.ts                parts, groups, hierarchy, tiered selection
    materials.ts            material instance, parameters, wear
    lighting.ts             active rig, lights (those of the light setup and L4's own: add, duplicate, delete, aim, place on a surface), their placement (`lightFrame`: position, target, roll), placement by reflection, lumens
    ies.ts                  IES photometric profiles (L5): the LM-63 format reader (a port of `rt_core::ies`'s, with the same conformance file), the profile's intensity and flux, the light that approximates it in Fast and the polar chart curves
    view-objects.ts         lights and cameras as viewer objects (L4): their *gizmo* and what a drag does, *Look through* and what navigation does, the glyphs and the click that picks one
    camera.ts               optics, framing, saved cameras; the projections (`CAMERA_PROJECTIONS`: perspective, orthographic, equirectangular, fisheye, K3) and the *Elevation* and *Plan* views
    focal.ts                the focal-length switch (C2): *Keep the size of what is in focus*, per camera (`keepFocusSize`); `camera/focal` and the interior lenses go through it: when on, the camera moves closer or farther along its axis so that the focused plane (that of `focus.ts`) keeps its size (`dollyForFocal`), and `focalBehaviour` says what a focal-length change does (framing, *dolly*, locked, orthographic, panoramic)
    focus.ts                a camera's focus (F1): by distance, by point (anchored to its part) and by object; the distance that brings a point into focus with the engine's rule (`focusDistanceFor`: the depth, the hinge of a tilt), the one each camera resolves at each pose (`resolvedFocusDistance`, `focusDistanceAt`), the engine's exact solver for a traced lens (`setFocusSolver`), the *store* step (`syncFocus`) and the slider's range
    interior-camera.ts      the interiors camera (K3): straight verticals (`verticalsOf`, `renderedCamera`: the levelled camera with the *shift* that keeps the framing), eye height and interior lenses (`camera/eyeHeight`, `camera/interiorLens`), the exterior multiplier (`exteriorOf`)
    panorama.ts             the panorama map (K3): equirectangular and equidistant fisheye, direction ↔ image point in TS and in GLSL (`PANORAMA_GLSL`), the output frame fields (`panoramaFov`); the same map as the engine's `Camera::panorama_dir`
    image-passes.ts         the passes of the `image` state (K3): their order, which ones apply (exposure and curve), deterministic auto-exposure (`meterExposure`, `ExposureMeter`), compensation and the brightness presets
    optics.ts               a camera's optics beyond the simple lens (O1; it was called thin lens until O4): bokeh, tilt and shift; neutral, limits, bokeh types; the effect-filter stack (O3a); the traced lens (O2); the two lens models (`lensModelOf`, `opticsWithLensModel`: switching erases nothing), bokeh only for the simple lens (`bokehApplies`) and each model's tilt (`tiltOf`, `withTilt`, O4); the front glass (S3, `frontGlass`: `normalizeFrontGlass`, `frontGlassOf`)
    focus-plane.ts          the focus plane of a tilted lens (O4): the engine's hinge rule, the tilt that sets it through two or three points (`solveTilt`), its reading as an amount and a direction it recedes towards (`recedeOf`), and what the viewer draws (`focusPlaneHint`)
    traced-lens.ts          a camera's traced lens (O2): the catalogue key and what the person changed (coating, variable aperture, lens behind an adapter, non-physical settings), its composition for the engine (`composeLens`) and the reading of what the engine computes (`parseLensInfo`)
    lens-edit.ts            the edited elements of a traced lens (O2c): the list (elements and iris), the operations on the prescription (radii, thickness, glass, aperture, size, air, add, delete, rotate 180°), the focus followed through them, the catalogue glass list and what is wrong before and after asking the engine
    aperture.ts             registry of the pupil images (masks and textures) at 256², like the image registry (O1)
    aspect.ts               a camera's image aspect ratio (U13): preset or custom, its reading, the size that falls to it; the viewer frame and an image's size follow it (`syncOutputSize`, in `render.ts`)
    animation.ts            shots, moves, evaluation over time (reverse, repeat, smoothness: N6); N1: the types FADE, PAN, MATERIAL_COLOR, SUN_ARC (and PATH reserved), a spin's pivot, the material target, the shot change with a fade (`shotFadeAt`)
    curve.ts                the custom two-handle time curve (N1): cubic Bézier from (0, 0) to (1, 1), Newton with bisection
    fade.ts                 the fade-to-colour of the camera track on a frame's pixels (N1): in image values or in linear light
    pass-files.ts           the files of a render's passes (N2): the four outputs (alpha, depth, normals, part id), `PassesOutput` (what and in which format: 16-bit PNG or EXR), each pass's 16-bit words, the file names and the id legend; `normalisePasses`
    job-studios.ts          the studios of the jobs inside the project (N2b): the copy of each studio a job uses, one per id and *hash* of its content (`studioHash`, `embedStudio`, `pruneEmbedded`), their images, where a job's studio comes from (`resolveStudio`: the copy, the library, the project's saved ones) and those that can be added to the library (`studiosToAdopt`); §8
    explode.ts              the configurable exploded view (N6): geometries, levels, order, exceptions; what moves and when
    timeline.ts             the timeline arithmetic (N6): tree rows, ruler, camera spans, magnet
    motion-hint.ts          what the viewer draws of the chosen animation (N6): its target and its track
    camera-moves.ts         expands a camera move from data/camera-moves.json into the timeline bars for a camera (A6)
    doctor.ts               checks and fixes on the model
    doctor-engine.ts        the Doctor checks that read the engine (D1): `rt.wasm` and workers, SIMD, denoise, view transform, fireflies, video output and time budget; `EngineFacts` (what the page tells it, `setEngineFacts`, like the particle cap in `effects.ts`), `FrameScan` (what the accumulation says) and `sameImage`; the fixes touch only the project
    doctor-interior.ts      the interiors Doctor (K1): seven checks from `INTERIORS.md` §3.6 that need no engine, only with the *Interior* scene type, each with its fix (scale and units, opening for the sun and the sky, window glass, optics, eye height, near clip, normals); `runDoctor` and `fixDoctor` call them
    scene-type.ts           the scene type (K1): `scene.type`, the `scene/setType` action, and the `scene.typeBase` memory of what each type replaced so that going back leaves the project as it was except for what was touched; the values are `data/scene-types.ts`
    physics.ts              physics (S2): a node's Physics section, what is simulated (`physicsSpec`), the simulator's poses back to the nodes, the PHYSICS clip's track and its anchor, the `physics/*` actions (§5.6)
    wet.ts                  S3b: the front glass fed by the scene: what is simulated (`wetSpec`, `wetBytes`, the `wetKey` key), the glass track of the camera's PHYSICS clip (`GlassTrackWriter`, `glassFrame`, `recordedGlass`) and the glass as the engine reports it (`parseEnginePane`) (§5.2 novendecies); S3c: `glassRendersClean`, the warning for an engine without bit 7
    wet-parts.ts            S3c: rain, dust and snow on the parts: what is simulated (`wetPartsSpec`, `wptBytes`, the `wetPartsKey` key), the parts track of the scene's PHYSICS clip (`PartsTrackWriter`, `partsFrame`, `recordedParts`, `partWeather`) and the warning for an engine without bit 8 (`partsRenderDry`) (§5.2 vicies; S3e: moving parts, the studio floor, fine samples and the motes' twin, §5.2 tervicies)
    effects.ts              the Ambient effects (S4a): the effect as data, its `effect/*` actions, the region, the count and the cap, the fields and the bytes of `FXAM`, the effects of a file; S3: the drop, the shape mix (`mixWeights`, `heaviestShape`) and the shape variation, the S3 fields only when there are any (`hasS3Fields`) and only for an engine that draws them
    section.ts              the section view (Q1): the plane as data (`state.section`), its `section/*` actions, from a click and an axis or from two points, resolved at an instant of the animation for the engines, which parts it cuts, which it caps and which are studio (`partIsExempt`)
    solid.ts                which meshes are closed solids (Q1): the same rule as the engine's `geometry/solid.rs`, so that Fast caps the same parts; and which way a closed surface faces (`solidOrientation`, K1)
    images.ts               registry of environment images (HDRI, background image), like the mesh one (E5), and of textures (M2a)
    textures.ts             image textures and labels of a material (M2a): slots, mapping, labels, their `texture/*` actions, and the maths of the projections and of the labels that the shader and the engine follow
    texture-images.ts       the texture images in the registry: content-based id, limits (M2a)
    material-graph.ts       a material's graph (M3a): nodes, typed sockets and their conversions, connections, its `graph/*` actions, Simple ↔ Nodes (§5.2 quater)
    material-program.ts     the compiler from the graph to a linear program of f32 and vec3 registers, its codes, limits and bytes: the M3b contract (§5.2 quater)
    material-interp.ts      the program's reference interpreter, in f32, and the points of the cross-check with the engine (M3a; the engine gives its bits, M3b)
    material-preview.ts     the node spheres, the Fast maps (`planBake`, `bakeRows`, `finishBake`) and the average that acts as parameters (M3a; the `MATL` of a node material, M3b)
    material-examples.ts    the ten example graphs as graphs, and their plastic's label drawn without a file (M3a)
    noise.ts                gradient noise (Perlin 2002 and simplex) and its sum in octaves, in f32: the M3b contract (M3a)
    patterns.ts             E6's wood and fabric in f32, step by step like `rt_core::pattern` (its noise with the PCG32 permutation, the knots, `sample_at`): the interpreter's Wood and Fabric nodes (M3c)
    pattern-recipe.ts       the recipe of an E6 pattern from the family's parameters (the `PATN` of `io/rsb.ts` and the constants of the Wood and Fabric nodes, M3c)
    image-header.ts         size and channels of a PNG or a JPEG from its header, without decoding (M2a)
    sky.ts                  the engine's sky ported to the preview: the physical one from E5c (the default) and Preetham's (E5)
    sky-table.ts            the physical sky coefficients, generated by `rt-sky table` (the same f32 and the same hash as rt-core)
    faces.ts                whole faces: CAD face or surface that continues; parts from “Separate by CAD faces” (M1)
    material-drop.ts        what a material drop reaches and what it assigns (U7)
    box-select.ts           box selection: on-screen geometry, window and crossing, which gesture arms it (U7)
    primitives.ts           parametric primitives: pure, deterministic generators (logical faces, UVs, normals), valid measurements, mesh id `prim:<owner>:<SHAPE>:<measurements>` (U9)
    primitive-ops.ts        primitives in the scene: where they are born (base under the product, next to it, under it), add, edit live, convert to mesh; `fitSweep` fits the infinite backdrop to the camera and the rear lights (U9)
    light-math.ts           kelvin → rgb, irradiance, polar, ease
    rig.ts                  normalised studioRig / setupRig; the distribution of a set's puddle (L6)
    sets.ts                 the sets (L6): apply, replace and remove their decoration (cards, sweep, floor, puddle), their look, Use the set’s camera
    wear.ts                 default wear values
    version.ts
  data/                     CATALOGUES. Only data and types (§3); primitives.json + primitives.ts: the twelve shapes of Add ▸ Primitive (U9); physics.ts: densities per material family and the physics defaults (S2); effects.ts: the Ambient presets (S4a; S3 adds the drop, the mix and *Water drops*); front-glass.ts: the front glass values that the interface does not show, the ranges and the start of its controls (S3), and what each effect leaves on the scene-fed glass (`GLASS_FEED`, S3b); wettability.ts: the advancing and receding angles of water per material family and the angle of repose of dust (S3b), and since S3c wood and fabric, how much each family soaks up and how much wetting darkens it, the angle of repose of snow and the material family of a part (`wettabilityFamilyOf`); wet-parts.ts: what each effect leaves on the parts (`PARTS_FEED`), the cell and the sample budget and the cap of a simulation (S3c)
  render/                   WEB-SIDE ENGINES. They depend on core, never on ui
    engine.ts               the RenderEngine interface (§5)
    preview.ts              three.js: rasterised preview while the camera moves; `aiFrame` (X4): the Fast-mode frame and its passes
    particles.ts            the Ambient particles for Fast (S4a): `rt_particles_eval` of rt.wasm on the page thread, their tint; S3: the shape of each one (`rt_particles_shapes`) and the drop outline (`dropOutline`)
    camera-projection.ts    the Fast camera's projection as a pure function (K3): the *shift* in NDC and the matrix with straight verticals (`perspectiveProjection`)
    panorama-pass.ts        the Fast panoramas (K3): the scene on the six faces of a cube (half float, linear) and the canvas drawn from it with `PANORAMA_GLSL`
    section-preview.ts      the section view in Fast (Q1): the plane shared by the model's materials, the caps, the studio without a plane, the selection and the gimbal without what was removed
    fade-preview.ts         the animation's fades and material colours in Fast (N1): the shared material set as the clip leaves it, a translucent copy per part that fades
    texture-shader.ts       Fast's texture shader (M2a): GLSL put into three's MeshPhysicalMaterial with `onBeforeCompile`, assembled without a GPU
    texture-preview.ts      the textures and labels in Fast: the shader on each material and the per-image texture cache, with mipmaps (M2a)
    lens-filter-image.ts    the lens effect filters on an image (O3a): the pixel kernels and their convolution in TS, the reference for the WebGL pass
    lens-filter-pass.ts     the WebGL pass of those kernels in Fast mode (half-float linear target, gaussians at reduced size, streaks at half resolution; each part with its colour); with a traced lens, its distortion and vignetting (O2)
    lens-info.ts            what the engine computes of a traced lens (O2): `rt_scene_lens_info` of rt.wasm on the page thread
    focus-pick.ts           click-to-focus with the engine (F1): `rt_scene_pick` (the primary ray of a view pixel) and `rt_scene_focus_at` (the distance that brings a point into focus; for a traced lens, from its rays) of rt.wasm on the page thread, with export detection; the solver of `core/focus.ts`
    lens-profile.ts         the table of the Fast viewer for a traced lens (O2): the image scale, the distortion and the engine's relative illumination; and the map from the screen to the undistorted image, once in TypeScript and once in GLSL with the same numbers: the screen pass, the outline and the overlays draw it, and the pick, the gizmo, the glyphs and the box selection invert it
    graph-preview.ts        node materials in Fast: their maps through M2a's slots, in two passes (M3a); and the family's wood, through its Simple → Nodes graph (M3d), without the knots that are painted on top, and the family's fabric when its threads are read, with its fuzz on top (M3e)
    graph-client.ts  graph-worker.ts  graph-protocol.ts  the graph workers: the editor's spheres and the map bands (M3a)
    preview-passes.ts       the passes of AI-POST.md §7.4 drawn with three.js (albedo, normal, depth, exact ids, coc) for the AI preview (X4); the floor, with the engine's central rays (X3c)
    pathtracer.ts           RenderEngine over a pool of workers that run rt.wasm (E4)
    frame-scan.ts           what the Doctor reads from the Full viewer's accumulation (D1): fireflies (bright, isolated, single-sample pixels) and the framing histogram by stops; `status().scan` in both engines, with `ScanCache`
    worker.ts               the worker: instantiates rt.wasm, receives the RSB scene, renders tiles
    pass-planes.ts          the engine's exact passes on the page (X2): gathers those of rt.wasm per tile and reads the launcher's RPP1
    physics-worker.ts       the simulator worker (S2): its rt.wasm, one simulation at a time, at the clock's pace and with acknowledgement (§5.6)
    physics.ts  phys-wasm.ts  the client of that worker (`PhysicsClient`) and the typed wrapper of the `phys_*` exports (`PhysWorld`) and, S3b, `wet_*` (`WetSim`); S3c, `wpt_*` (`PartsSim`)
    glass-overlay.ts  glass-pane.ts  S3b: the approximation of the front glass in Fast (the maps over the glass, blurred by a pixel's footprint) and the glass as the engine places it (`rt_scene_glass`) (§5.2 novendecies)
    weather-preview.ts      S3c: the parts' rain, dust and snow in Fast: the recorded frame's samples in data textures read by a patch of the materials, and the drops as instanced caps (§5.2 vicies)
  ai/                       OPTIONAL AI POST-PROCESSING (X3). Depends on core (and data), never the other way round; the guard is NOT TypeScript: it is rt-post
    post-wasm.ts            typed wrapper of public/engine/post.wasm (plan, conditioning, accept) and the runGuarded driver; worker and Node
    prompt.ts               the scene prompt (materials, lights, style) and the fixed negative; the guard's material table
    synthetic.ts            X4's synthetic service (no model, deterministic, measured report); not-built.ts, that of a version without a pipeline
  plugins/                  PLUGINS (P6, §9). They depend on core and data; the interface sees them through ui/ports.ts, like io
    rpk.ts                  the .rpk format: header, AES-256-GCM, container, key; shared by the page and the tools
    abi.ts                  the ABI v1 messages between the host and a plugin
    store.ts                IndexedDB: the encrypted package and its key apart (also in WebView2); in memory without it
    host.ts                 install (registry or file), remove, open in memory, start the Worker, the session
    service.ts              what the interface asks for: a result from a plugin (preview or full size), the pixels
  io/                       IMPORTERS AND EXPORTERS. They depend on core
    import.ts               entry point: detects the format, applies the options sheet, produces nodes
    gltf.ts  obj.ts  stl.ts  fbx.ts  rhino.ts  threemf.ts  ply.ts  collada.ts  usd.ts  three-scene.ts  step.ts step-worker.ts occt-protocol.ts occt-convert.ts (I2, OCCT)
    project.ts (.repack)  library.ts (own library, JSON)  image.ts (PNG/JPEG/EXR/TIFF/DNG)
    zip.ts                  the own ZIP writer (N2): *store* method, CRC-32, UTF-8 names, no dependencies; `zipStore` and `uniqueNames` (§5.4 quater)
    passes.ts               the pass files (N2): from the engine's planes to 16-bit PNG (`encodePngWords`) or EXR (`encodeExrPlanes`), one per pass, and the id legend (§5.4 quater)
    video.ts                encoded video (N1): WebCodecs queried at run time, the frame-by-frame video writer (§5.4 ter); webm.ts and mp4.ts, the own *muxers*; video-track.ts, their types
    rsb.ts                  writer of the engine's binary scene format (§5.2); `materialOrder`, the material order that the passes number (X3c); the node-material programs (`PROG`, M3b)
    phys.ts                 writer of PHY1, the simulator's scene (S2, §5.6)
    ai-runtime.ts           the launcher's AI execution engine (X3b); ai-post.ts, the desktop pipeline (`DesktopAiService`, X3c)
    hdri.ts                 own RGBE and OpenEXR readers, background image, copy for the preview (E5)
    gltf-materials.ts       a glTF's materials and images read from its JSON (M2a)
    mtl.ts  obj-materials.ts  an OBJ's .mtl libraries and their images (M2a)
    texture-notes.ts        what the sheet says about a file's textures (M2a)
    texture-pixels.ts       the textures' pixels for the RSB's IMGS section (M2a); main.ts decodes them before writing the scene for an engine that reads them (M2b)
    aperture.ts             reads the pupil images from public/assets/aperture (own grey PNG, no canvas) and averages them to 256² (O1)
  ui/                       INTERFACE. Talks to core through the store (§6)
    strings.ts              all strings, in es and en
    ports.ts                the services that main.ts hands it (viewer, importers…), without importing render or io (§6)
    doctor-facts.ts         what the Doctor knows about the engine (D1): `engineFactsFrom` (interface state and the viewer's `status()` to `EngineFacts`) and `installDoctorFacts`, which hands it over when it changes (`doctor/refresh`, also after undo and redo)
    section-commands.ts     the section-view commands (Q1): switch on, flip sides, arm the viewer's next click and what it does
    lens-commands.ts        the commands of the lens model, bokeh and tilt (O4): `setLensModel`, `applyBokeh` (through which all bokeh passes: with a traced lens it warns and does not touch the camera), the plane by two points (`armTiltPick`, `finishTiltPick`: one undo entry) and the text of its warning
    lens-edit-commands.ts   the lens editor's commands (O2c): the copy of the camera's lens (`lensDraft`, one undo entry per edit or gesture), applying it only if the engine checked it, discarding it and saving it to the library
    lens-peek.ts            what the lens window decides (O2b), without DOM: which camera the engine is asked about and the cache of answers per lens and per what the numbers depend on (`lensPeekCache`, one per port), when it opens and closes (`createPeekController`, 300 ms of rest) and what each card says (`peekCard`: nothing the engine has not said, rule 10)
    theme.css  layout.css  components.css  …
    components/             NumberField, Section, Grid, Palette, …
      material-drag.ts      dragging a material with pointer events: ghost, drop zones, Esc (U7)
      lens-section.ts       the SVG cross-section of a traced lens and the curves of its profile, from what the engine prepared (O2; imports only types: tools/lens-sheet.mjs uses it too)
      lens-peek.ts          the window of a lens's elements when the pointer or focus rests on it in Camera ▸ Lens (O2b): the window's DOM (taking neither focus nor pointer) and its placement; the logic without DOM, in `ui/lens-peek.ts`
      pick-menu.ts          a list drawn by the interface (button like a `select` and widgets.ts's menu), whose entries the page can see under the pointer and with focus: the lens one from O2b
    panels/                 header, scene, viewport, inspector, renderbar, status
      viewport-box.ts       the selection-box gesture over the viewer (U7)
      add-menu.ts           Add ▸ Primitive: the same entries in the header, Scene's + and the viewer's empty-space menu (U9)
      scale-panel.ts        right-click ▸ Scale…: the inline panel (uniform, per axis, custom, reset) (U9)
      insp-lens.ts          Camera ▸ Bokeh (engine thumbnails) and Advanced optics (O1), only with the simple lens (O4)
      insp-tilt.ts          the Tilt and shift block (O4), the same in Advanced optics and in More options: amount, dial and direction shortcuts, Through two points…, Show the plane, shift
      insp-filters.ts       Camera ▸ Filters: the lens effect-filter stack (O3a)
      insp-traced.ts        Camera ▸ Lens (O2): simple or traced lens, character, lens, source, lens behind, coating, variable aperture, sheets; the numbers, the curves and the engine's cross-section; More options (O4: tilt and shift, the rest of the iris, the non-physical); Save lens as…
      insp-textures.ts      inspector ▸ Textures: slots, mapping and labels (M2a)
      insp-ambient.ts       inspector ▸ Scene ▸ Ambient: list, card gallery, eight controls and Advanced (S4a)
      insp-section.ts       inspector ▸ Scene ▸ Section: switch, axis, two click modes, point and normal, flip sides, cap the cut (Q1)
      material-editor.ts    the Material editor window: bar, node panel, keys, remembered place and size (M3a, UI.md §2.10)
      lens-editor.ts        the Lens editor window (O2c, UI.md §2.11): the engine's cross-section, the chosen element's tools, the element list and what the engine computes for the copy, or why it cannot be applied
      graph-canvas.ts       the editor canvas: cards, sockets by shape, connections, zoom and pan (M3a)
      viewport-labels.ts    the viewer's label tool: place with press and drag, Move label (M2a)
      animation.ts          the animation drawer (N6): transport and the three zones; anim-tree.ts (what is animated), anim-timeline.ts (ruler, bars, magnet, camera track with its fades), anim-props.ts (properties, the three-step wizard, a shot's, presets); components/curve-editor.ts, the two-handle curve (N1)
    texture-commands.ts     what the inspector's slots and labels do (M2a)
    physics.ts              the running simulation (S2): Drop, Start, Pause, Stop, Reset, the clips that grow; S3b: and the camera's scene-fed front glass; S3c: and the parts (`partsRun`, without those the simulation moves)
    panels/physics.ts  panels/insp-physics.ts  the physics bar (drawer of the bottom bar) and the inspector's Physics section (S2)
    anim-commands.ts        what the timeline does (N6): animation selection in step with the scene and the viewer, Animate…, duplicate, delete, reverse, split, pin in the exploded view, transport and keys
    graph-commands.ts       what the material editor and the inspector do with a graph: open, Simple ↔ Nodes, examples, edits (M3a)
public/
  thumbs/setups/            88 light-setup thumbnails rendered by the engine (PNG) and manifest.json (L6, tools/setup-thumbs.mjs)
  thumbs/bokeh/             30 bokeh thumbnails rendered by rt (16 mode-1 types and their variants) + index.json (O1, tools/bokeh-thumbs.mjs)
  assets/aperture/          45 diaphragm masks and pupil textures (512² PNG, 8-bit grey) + index.json (A6)
  assets/gobo/              12 gobo patterns (1024² PNG, 8-bit grey) + index.json (A6)
  assets/README.md          provenance: generator, recipe, seed and hash of each file
  example/                  nothing: the example part is procedural
tests/                      vitest; *.test.ts per module
tools/                      development scripts: screenshots, generators, contact sheets
  setup-thumbs.mjs          the light-setup thumbnails (L6): scenes with the app's code (tests/setup-thumbs-dump.test.ts, vitest) and `rt`
  sets-sheet.mjs            the sets' contact sheet (L6): out/sets-sheet.html; rt-batch.mjs, what they share
  sets-check.mjs            browser check of the sets (L6): catalogue, apply, In the set, Reset; docs/ui/sets-catalogue.png
  k3-check.mjs              browser check of the interiors camera (K3) on the test room (tests/fixtures/k3-room.repack.json): straight verticals, plan with the ceiling hidden from the camera and the metered auto-exposure, 2:1 panorama and eye height, achromatic chrome; docs/ui/k3-verticals.png, k3-plan.png, k3-panorama.png (and their -fast) and out/k3-check.json
  scene-type-check.mjs      browser check of the scene type (K1): the control, that the controls do not change, the seven Interior recipes, the seven Doctor rows, round trip, in English and in Spanish; docs/ui/scene-type-interior.png
  plugin-pack.mjs  plugin-unpack.mjs  pack and open an .rpk (P6, §9); plugins-check.mjs, the browser check
  plugins/                  build-film.mjs (the film package from an aintfilm checkout), brand-scan.mjs (D112),
                            film/manifest.json and film/plugin.js (the ABI glue, ours)
  animation-check.mjs       browser check of the timeline and the exploded views (N6): docs/ui/animation-timeline.png, explode-types.png and the sheet out/explode-sheet.html
  assets/                   deterministic generators of public/assets/ (A6): common.mjs, aperture-masks.mjs, gobos.mjs; only node:zlib and node:crypto
docs/                       this document, SPEC, UI, ROADMAP
engine/                     THE ENGINE. Cargo workspace, Rust, no external dependencies (§5.1)
  Cargo.toml  rust-toolchain.toml  README.md
  crates/rt-core/           the tracer: maths, SIMD, BVH, BSDF, lights, integrator, RSB, PNG, TIFF and DNG (U12);
                            images (RGBE, OpenEXR, inflate, 2-D sampling) and sky (E5; the physical one, E5c);
                            Ambient particles: spheres, discs and capsules with their BVH and their screen grid (geometry/particles.rs, S4a, S4b); the forward lobe (bsdf/forward.rs, S4b);
                            the section view: the plane inside `Geometry`, rays clipped to what remains, caps of closed solids and uncut studio (geometry/section.rs and solid.rs, Q1);
                            image textures and shading labels (texture/: image and mipmaps, projections,
                            slots and labels at the point, M2b);
                            the node-material programs (program.rs and program/: reading and checking,
                            interpreter, M3a's noise, the point and the hit material, M3b);
                            the parts' rain, dust and snow: the `WETP` section, its layers and the drop caps (weather.rs, S3c, §5.2 vicies)
  crates/rt-sim/            the stateless particle simulator (S4a): `FXAM` ⇄ `AmbientParams`, `evaluate`
  crates/rt-cli/            native binary `rt`: renders an .rsb to PNG, TIFF or DNG with threads; contact sheets
                            (E5's scenes in scenes.rs)
  crates/rt-wasm/           extern "C" exports for the browser (no wasm-bindgen)
  crates/rt-app/            desktop launcher `repackshot`: local server, window, native engine (§5.5)
  crates/rt-post/           the AI post-processing guard and all its work with pixels (AI-POST.md §7.2); rt-core does not know it
  crates/rt-post-wasm/      extern "C" exports of rt-post → public/engine/post.wasm
  crates/rt-phys/           the rigid-body simulator (S2): XPBD, convex hulls, contacts, sleeping; PHY1 (§5.6); S3b: `wet`, rain and dust on the front glass, WET1 (§5.2 novendecies); S3c: `wet_parts`, rain, dust and snow on the parts, WPT1 (§5.2 vicies)
  crates/rt-sky/            offline tool `rt-sky` (E5c): spectral atmosphere simulator, Levenberg–Marquardt
                            fit of the physical sky and its table; writes rt-core/src/sky_table.rs,
                            src/core/sky-table.ts and tests/fixtures/sky-physical.json
packaging/                  packaging scripts: Windows and Linux portables, NSIS installer (P2)
public/engine/rt.wasm       the engine compiled for the browser (generated by npm run engine:build; not committed)
public/engine/post.wasm     the compiled AI guard (rt-post-wasm), generated by the same script; not committed either
```

**How textures come in** (M2a). Each reader leaves the file's materials
as instances with their slots already set (the images by their content
id) and a list of `ImportTexture` (`core/import-options.ts`):
the file of each image, its materials, and whether it is kept or why not. glTF
reads its materials and images from its JSON (`io/gltf-materials.ts`) and hands
`GLTFLoader` the same file without textures (it does not decode twice, and in
Node it could not); OBJ reads its `.mtl` files (`io/mtl.ts`, `io/obj-materials.ts`);
FBX, Collada, 3MF, USD and 3DM take the maps that their three loader
loads (`collectTextures` of `io/three-scene.ts`: the original file when
the loader has it in a *blob* or a *data URL*, otherwise a drawn PNG,
in the browser only), with a `LoadingManager` that finds among the
**files chosen with the model** (`ImportReadOptions.companions`) the
images, the `.bin` files and the libraries it names. `applyImportOptions` keeps
the images of the materials that stay; on pressing
*Import* (`ui/commands.ts`) the project budget is applied
(`fitTextureBudget`, 64 MB), those that fit are registered and those that do not are
removed from the materials. The preview decodes each image once
(`createImageBitmap`) and uploads it with mipmaps; the RSB receives it decoded
(above).

**Dependency rule**: `ui → core`, `render → core`, `io → core`,
`plugins → core`, `core → data`. Never the other way round, never `ui → render` directly (the
*store* exposes what the viewer needs and the viewer subscribes). A test
in the suite (`tests/boundaries.test.ts`, U2) walks the `import`s and
fails if the rule is violated; today there is no violation. The engine (`engine/`) knows nothing of `src/`: its
only interface with the rest is the RSB format (§5.2), the simulator's
PHY1 (§5.6) and the exports of `rt-wasm` (§5.3). The exception is a tool's, not the engine's: `rt-sky`
(offline) writes the TypeScript copy of the sky table and a
test of its own checks that it matches `rt-core`'s.

---

## 3 · Catalogues (`src/data/`)

The keys (`GOLD`, `REMBRANDT`, `JEWELLERY`…) are **stable**: the
documentation, the thumbnails and the saved projects reference them.
Adding entries is free; renaming or deleting is a roadmap item with
a migration.

Contracts (see `src/data/types.ts`, which governs over this summary):

- **`LightSpec`** — a recipe light. `az` and `el` in degrees **relative
  to the camera axis**: `az = 0` behind the camera, negative to the
  camera's left, `±90` sides, `180` behind the part. `size`,
  `sizeY` and `dist` in **part sizes**: the same recipe works for a
  ring and for a sofa. `share` (setups) is the fraction of the
  total irradiance; `energy` (studios) watts at size 1, in the sense
of Cycles: a panel of power P and area A has radiance P / (4 A). `kelvin` or
  `color`; `color` wins. `camera = true` is a luminous panel that the
  camera sees (bright field).
- **`StudioPreset`** — product type: typical size, focal length, aperture,
  environment intensity, exposure, background, floor, shadow, caustics,
  quality, and its rig of lights.
- **`LightSetup`** — catalogue light setup: label, intent, style,
  `world` (`STUDIO` dome, `SKY` sky, `FLAT` flat) and lights; `PRESET`
  uses the product type's rig. **Set** (L6, all optional: the 72
  setups of the base catalogue have none of it): `backdrop` (`SetBackdrop`: `FLAT`,
  `GRADIENT` top and bottom, `SWEEP`), `pool` (`SetPool`: `az`, `el`,
  `cone`, `share`, `kelvin` or `color`), `floor` (`SetFloor`: `CATCHER`,
  `MATTE`, `GLOSSY`, `MIRROR`, with `material` and `color`), `cards`
  (`SetCard`: `material`, `az`, `el`, `dist`, `size`, `sizeY`, `roll`),
  `exposureEv`, `envStrength`, `camera` (`SetCamera`: `el`, `focalMm`),
  `hero` (`SetHero`), `why` (`Label`) and `caustics`. The 16 sets are the
  style `SETS`, the first; two keys of the plan already existed
  (`DARK_FIELD`, `TEAL_ORANGE`) and their sets are `GLASS_DARK_FIELD` and
  `WARM_COOL_CINEMA`. **`StudioPreset.set`** (L6): the set that is the product type's
  own rig (its lights, at the type's level; with `PRESET`,
  its decoration and its look; its exposure offset already added to
  `exposure`); `PRESET_SETS` summarises it. `tests/preset-rigs-sync.test.ts`
  (with `REPACKSHOT_SYNC_PRESETS=1`) rewrites the lights and the exposure of
  those types from their sets after one is tuned.
- **`MaterialPreset`** — category, family (`SIMPLE`, `GLASS`, `WOOD`,
  `FABRIC`, `EMISSIVE`) and parameters.
- Wear, fuzz, optics, moves, smoothings, sequences,
  Doctor checks, quality and resolution: see their files.
- **Studio tools (A6)** (`docs/STUDIO-TOOLS.md`): `lenses.json`
  (the 16 lens prescriptions, with their typed loader in `lenses.ts`), `bokeh.json` (the 20 types) and
  `camera-moves.json` (14 product-relative camera moves and
  3 handheld camera presets). Their JSON files are read with a call marked
  `/* @__PURE__ */` so that the page does not carry them in the first *chunk*
  until something uses them. The masks and gobos they reference
  are in `public/assets/` and are generated with `tools/assets/`.

**Generated assets** (`public/assets/`, `tools/assets/`): each file comes from
a recipe and a seed by pure code (only `+ − × ÷` and `sqrt`, no
`Math.sin` or `Math.random`), and its `index.json` stores recipe, seed and two
*hashes*: that of the pixels (canonical) and that of the PNG. `tests/assets.test.ts`
regenerates and compares them. The desktop server (`static_files.rs`) treats as
immutable only the files in `/assets/` that carry Vite's content
*hash* (`name-XXXXXXXX.ext`, 8 characters, directly in
`assets/`); the others (these assets and their `index.json`) are revalidated on every
request with an ETag of the SHA-256 of their bytes.

**Exposure normalisation** (`src/core/rig.ts`): when applying a
setup to a product type, the sum of the irradiances of its lights
is equalised to that of the product type's rig (`presetIrradiance`), so
that changing setup does not change the exposure. It is what makes it possible to
run through 72 setups without touching the exposure, and the suite
pins it for the 16 × 71 combinations. A set's pool (L6) enters
the sum as a light at `POOL_THROW` = 2.5 part sizes
(`poolWeight`): the set and its pool add up to the type's level; its lights, the
rest. L6's product-type rigs keep the level they had before
(`tests/fixtures/old-setup-rigs.json` stores the levels and the shape of the
71 earlier setups, and `tests/sets.test.ts` compares them).

**Coordinate system** of the model and the viewer: Z up, Y towards the
back, X to the right; reference camera at `polar(CAMERA_AZIMUTH_DEG,
CAMERA_ELEVATION_DEG, d)`. three.js is Y-up: the conversion lives in
**a single place** (`src/render/preview.ts`, function `toThree`), never
spread around.

---

## 4 · The *store* (`src/core/store.ts`)

A single immutable state tree, actions as plain objects, and
undo / redo over snapshots. It is the contract between interface,
engine and importers, and that is why it is here and not in the interface.

```ts
export interface ProjectState {
  meta:      { name: string; version: string; dirty: boolean; lang: 'en' | 'es'; theme: 'dark' | 'light' | 'system' };
  scene:     { nodes: Record<NodeId, SceneNode>; roots: NodeId[]; partSizeMm: number };
  selection: { level: 'MODEL' | 'GROUP' | 'PART' | 'FACES'; ids: NodeId[]; faces?: { part: NodeId; indices: number[] } };
  materials: Record<MaterialId, MaterialInstance>;        // instances; the preset is only the origin
  studio:    { preset: StudioKey; lightSetup: LightSetupKey | 'PRESET'; built: boolean; floor: boolean; shadow: boolean;
               lights: LightInstance[]; modified: boolean };
  environment: { kind: 'STUDIO' | 'SKY' | 'FLAT' | 'HDRI'; strength: number; rotationDeg: number;
                 background: 'ENVIRONMENT' | 'COLOR' | 'TRANSPARENT' | 'BACKPLATE'; color: RGBA;
                 groundShadow: number; groundReflection: number };
  camera:    { active: CameraId; cameras: Record<CameraId, CameraState> };
  image:     { exposureEv: number; viewTransform: 'STANDARD' | 'FILMIC' | 'AGX'; bloom: number; sharpen: number;
               saturation: number; contrast: number; vignette: number };
  animation: { shots: Shot[]; clips: MotionClip[]; fps: number; playhead: number; playing: boolean };
  render:    { quality: 'DRAFT' | 'PREVIEW' | 'FINAL' | 'CUSTOM'; width: number; height: number;
               maxSamples: number; maxSeconds: number; format: 'PNG' | 'JPEG' | 'EXR' | 'TIFF' | 'DNG'; transparent: boolean;
               queue: RenderJob[]; running: RenderProgress | null };
  doctor:    { results: DoctorResult[]; stamp: number };
}
```

(The auxiliary types —`SceneNode`, `MaterialInstance`, `LightInstance`,
`CameraState`, `Shot`, `MotionClip`, `RenderJob`— are defined by phase U1 in
`src/core/*.ts` following `SPEC.md`; this skeleton fixes the top-level
names so that later phases do not have to rename them.)

Minimal API:

```ts
export interface Store {
  get(): ProjectState;
  dispatch(action: Action): void;                 // applies, records in the history, notifies
  subscribe(fn: (s: ProjectState, prev: ProjectState, action: Action) => void): () => void;
  undo(): void; redo(): void;
  history(): { undo: string[]; redo: string[] };  // readable labels ("Assign Gold to Body")
  transaction(label: string, fn: () => void): void; // groups several dispatches into one undo entry
}
```

Rules:

- **Every** mutation goes through `dispatch`. The interface does not touch the state;
  neither does the viewer.
- Each `Action` carries a `type` and, where appropriate, a `label` for the history. Continuous
  actions (dragging a field, orbiting) are grouped with
  `transaction` per gesture: one undo entry per drag.
- Reducers are pure functions in `src/core/*.ts`; effects
  (rendering, downloading) live outside, subscribed to the store.
- The state is serialisable as is to `.repack` (no class
  instances, no circular references, no `Map`). `io/project.ts` saves it
  and loads it with a schema version and migrations.
- Undo actions do not include `meta.lang`, `meta.theme`, the
  folding of panels or the `playhead`: they are interface state.
- **The Doctor** (`doctor.results`) is run again on every action that
  changes what it looks at: the scene's parts for its scene checks and,
  since D1, what the engine checks read (`engineInputsChanged`,
  `core/doctor-engine.ts`: the image settings, the engine settings, the
  budget and the animation output of `render`, and everything that gives the Full viewer
  another image). What the engine and the system report is not part of the
  project: the page hands it over as `EngineFacts` (`setEngineFacts`,
  `ui/doctor-facts.ts`) and requests `doctor/refresh`, volatile (no undo
  entry and no change to `meta.dirty`) and without effect if the results are
  the same; after undo and redo the *store* itself requests it through
  `installDoctorFacts`, because the state comes back with the findings it was
  saved with. An action that a listener sends while being notified of an
  undo, redo, reset or transaction close is applied as soon as
  the notification ends (before, it waited for the next `dispatch`).

---

## 5 · Engines

### 5.0 · The web-side interface (`src/render/engine.ts`)

```ts
export interface RenderEngine {
  readonly kind: 'preview' | 'pathtracer';
  mount(canvas: HTMLCanvasElement): void;
  sync(state: ProjectState, prev: ProjectState | null): void; // applies only what changed
  resize(width: number, height: number, dpr: number): void;
  frame(): void;                                              // one step: a frame or one more sample
  status(): { samples: number; seconds: number; converged: boolean; device: string };
  render(opts: { width: number; height: number; maxSamples: number; maxSeconds: number;
                 transparent: boolean; onProgress?: (p: RenderProgress) => void; signal?: AbortSignal }): Promise<ImageBitmap>;
  pick(x: number, y: number): { node: NodeId; face: number; point: [number, number, number]; normal: [number, number, number] } | null;
  dispose(): void;
}
```

- `status()` tells the truth: the preview reports `samples: 1` and
  `converged: true`; the tracer, the accumulated samples. The interface
  paints what the engine says, never a counter of its own.
- `pick` is used to select, to click-focus and to place by reflection.
- Two implementations coexist and **the user chooses which one is shown** with the
  *Fast · Full* switch in the header (`meta.viewportMode`,
  `'FAST' | 'FULL'`, persisted interface state, not undoable):
  **`preview`** (three.js) in *Fast*, to place lights, paint
  materials and frame with immediate response; **`pathtracer`** (the
  Rust engine via wasm) in *Full*, which simulates everything in the
  viewer itself even while the camera moves: during a gesture it renders
  at reduced resolution (½ or ¼, chosen by the time of the last
  frame) and on release goes back to the viewer's resolution and converges. There
  is no automatic switching of engine; *Full* is disabled with its
  reason when `rt.wasm` is not loaded or the browser provides no workers.
- **`render()` always uses `pathtracer`**, whatever mode the viewer is
  in: the switch is only what is seen while working. Without
  `rt.wasm` there is no render (the reason is stated); the preview is only
  used for thumbnails (`quick`).
- The tracer's `status()` includes, besides samples and time, the
  workers, whether SIMD is available, the resolution scale, the frames per
  second, the time per frame and whether it is rendering. Since D1,
  also `scan` (`FrameScan`, `core/doctor-engine.ts`): what the Doctor
  reads from the full-resolution accumulation when all pixels
  have at least 16 samples (`SCAN_MIN_SAMPLES`) and every time those
  samples double: how many pixels are *fireflies*, the framing
  histogram by stops (17 bins, from 2⁻⁸ to 2⁸, of the brightest channel)
  and the project it comes from (`basis`). It is the same object until the
  next reading, and there is no `scan` in *Fast*, during a gesture or
  before sample 16. The workers say in their first message whether their
  `rt.wasm` exports the denoiser (`denoise` in `ready`; `Pool.hasDenoiser`,
  `PathTracerEngine.canDenoise`), which the interface stores in
  `EngineInfo.denoise`.

### 5.1 · The engine: Rust, from scratch, no dependencies

It lives in `engine/`, a Cargo workspace with eight *crates*:

| Crate | What it is | Rules |
| --- | --- | --- |
| `rt-core` | **The tracer.** Library: maths, SIMD, BVH, intersection, live edges and shading bevel, image textures and labels (M2b, `texture`), material programs (M3b, `program`), BSDF, lights, environment, sampling, integrator, RSB reader and writer, PNG encoder, film and tonemapping | Only `core`/`alloc`/`std` with no system APIs (no `fs`, `net`, `time`, `thread`); `#![deny(unsafe_code)]` except the `simd` module; `#![deny(missing_docs)]`; `f32` throughout; no `unwrap` on paths that depend on input; compiles for `wasm32-unknown-unknown` |
| `rt-sim` | **The stateless particle simulator** (S0 §1–2, S4a): `AmbientParams` (reads and writes the `FXAM` payload), `evaluate(&params, max)` and `Evaluator::particle(id)`: each particle is a pure function of (seed, id, instant), in closed form; own phase (steady state: the region is full from the first instant), integrated velocity `v(a) = v_d + (v₀ − v_d)·e^{−a/τ}`, *curl noise* drift as a divergence-free displacement (Bridson, Houriham and Nordenstam, *Curl-noise for procedural fluid flow*, SIGGRAPH 2007), death at the floor and rebirth at the top (those that fall or rise are born on their face and live as long as they take to cross the box; those that float live forever and the box wraps around), cloud envelope by rejection. The exponential and the sine, tabulated with `fmath` once per effect: no `exp`/`sin` per particle | The `rt-core` rules: only `std` with no system APIs, `#![forbid(unsafe_code)]`, `f32`, counter hash `mix64((seed << 32) ^ id)`. Shares `fmath.rs` and `rng.rs` from `rt-core`, compiling them by `#[path]` (a test in `rt-core` checks that they give the same): `rt-core` depends on `rt-sim`, not the other way round |
| `rt-cli` | Native binary `rt`: reads an `.rsb`, renders with threads (`std::thread::scope`, atomic tile queue), writes PNG, measures rays/s; contact sheets and thumbnails in CI | May use all of `std` |
| `rt-wasm` | `cdylib` with hand-written `extern "C"` exports (`rt_alloc`, `rt_free`, `rt_scene_load`, `rt_render_tile`, `rt_render_tile_passes`, `rt_render_tile_albedo`, `rt_render_tile_alpha` (N2), `rt_scene_caustics`, `rt_denoise`, `rt_particles_eval` (S4a: the particles of an `FXAM`, 8 `f32` each, for Fast), `rt_particles_shapes` (S3: the shape of each one, a `u32`, for the shape mix in Fast), `rt_scene_pick` and `rt_scene_focus_at` (F1: the primary ray of an image point, what it hits and the distance that brings it into focus; the page detects them by name, with no `rt_features` bit), `rt_version`, `rt_features` (M2b: what it reads besides the usual RSB; bit 0, the textures; bit 1, the material programs, M3b; bit 2, the section view, Q1; bit 3, the IES lights, L5; bit 4, the interiors cameras, K3; bit 5, the pattern nodes, M3c; bit 6, the drops and the front glass, S3; bit 7, the drop-by-drop glass, S3b; bit 8, the rain, dust and snow of the parts, S3c)…), `rt_scene_glass_len` and `rt_scene_glass_copy` (S3b: a scene's front glass as the engine places it) and those of the simulator (`phys_new`, `phys_step`, `phys_poses`, `phys_awake`, `phys_settled`, `phys_hash`…, S2; `wet_new`, `wet_step`, `wet_frame`, `wet_frame_copy`, `wet_hash`…, S3b; `wpt_new`, `wpt_step`, `wpt_layout`, `wpt_frame`, `wpt_copy`, `wpt_hash`…, S3c). No `wasm-bindgen`; it links `rt-post` only for its *denoise* (E5b-1), `rt-sim` (S4a) and `rt-phys` (S2) | The only `unsafe` outside `simd`: the linear memory allocation, commented block by block |
| `rt-app` | Binary `repackshot`, the desktop launcher (§5.5): local server, window, native engine, data, machine | All of `std`, **no `unsafe`**; what it needs from the system it asks of system processes (`reg`, `nvidia-smi`) |
| `rt-post` | **The own *denoise*** (E5b-1, `rt_post::denoise`, §5.2 bis) and **the AI post-processing guard** (X3a, `AI-POST.md` §3.2 and §7.2): conditioning (edges of id and normal changes, normalised depth), ~1024² tiles with ≥ 128 px overlap and raised-cosine blending, padding to a multiple of 16 and cropping, the guard (shading transfer, frequency separation, regions by id with ΔE₀₀), the checks and the step machine `plan` → `conditioning`/`tile_input` → `accept` with retries; a report shaped like `GuardReport` in hand-written JSON | The `rt-core` rules: no system APIs, `#![forbid(unsafe_code)]`, `f32`, deterministic (only the functions of `rt_core::fmath` and the tone curves of `rt_core::color`, no `f32::ln`/`exp`/`powf` from `std`). Depends on `rt-core`; `rt-core` does not know it exists. On the desktop `rt-app` links it (X3c: `src/ai/post.rs`, the native driver) |
| `rt-sky` | **The physical sky, offline** (E5c): spectral atmosphere simulator (spherical shells, Rayleigh, aerosols by turbidity, ozone, Lambertian ground; single scattering by quadrature and multiple by deterministic Monte Carlo), fit of the Hošek–Wilkie form with an own Levenberg–Marquardt and the table with its recipe and its *hash* (`rt-sky table`); validation against low-noise skies, the CIE clear sky and Preetham (`rt-sky validate`) | All of `std` (threads, files) and `f64`, but reproducible: own elementary functions (`dmath`), one random stream per work item, same result with any number of threads. Depends on `rt-core` (reads and tests the table); `rt-core` does not know it |
| `rt-phys` | **The rigid-body simulator** (S2, §5.6): extended position-based dynamics (XPBD), own convex hulls, contacts by separating axes, Coulomb friction, restitution, sleeping; the PHY1 format. S3b: `wet`, rain and dust on the front glass (drops anchored by Furmidge that slide and clean, dust with an angle of repose) and the WET1 format. S3c: `wet_parts`, rain, dust and snow on the parts' meshes (arrivals by the flow with what is in between, splashing, sliding from triangle to triangle, hanging and dripping, parts as film, dust and snow per sample) and the WPT1 format | The `rt-core` rules: no system APIs, `#![forbid(unsafe_code)]`, `#![deny(missing_docs)]`, `f32` and `rt_core::fmath`, deterministic with any number of threads (`std::thread::scope` only natively; in wasm, one). Depends on `rt-core`; `rt-core` does not know it |
| `rt-post-wasm` | `cdylib` with hand-written `extern "C"` exports (`post_open`, `post_tile_input`, `post_tile_control`, `post_set_output`, `post_accept`, `post_result`…) → `public/engine/post.wasm`, a separate module so that `rt.wasm` does not grow | Its `unsafe` lives only in `src/ffi.rs`, commented block by block; everything crosses as *little-endian* bytes, with no alignment required |

**No external dependencies** means exactly that: no
crates.io *crate* in any *crate* of the workspace. `Cargo.lock` only
lists `rt-core`, `rt-sim`, `rt-cli`, `rt-wasm`, `rt-app`, `rt-post`, `rt-post-wasm`, `rt-sky` and `rt-phys`,
and CI fails if a `source =` appears. Everything the engine needs (vectors, RNG, low-discrepancy
sequences, zlib/PNG, HDR readers, threads) is written here.
Formulas and tables from the public literature (PCG, Sobol with Joe and Kuo's
direction numbers, the ACES fit, the sky model) are cited in
the comment of their module.

**Portability.** The engine compiles and passes its tests on x86_64, ARM64,
RISC-V and wasm32; CI cross-compiles the first three and builds the
wasm on every PR. There are no operating-system-specific
code paths. `simd` is an own abstraction (`f32x4`, `f32x8`) with a
**scalar reference implementation** and paths with stable
intrinsics under `cfg(target_arch)`: SSE2 as the baseline and AVX2 by run-time
detection on x86_64, NEON on aarch64, `simd128` on wasm32
when the browser supports it; any other architecture uses the
scalar one. The tests run both paths and require the same result
within 1 ulp.

**Determinism.** The same RSB scene, the same seed and the same
sample index produce the same pixels on any platform and
with any number of threads or workers: the sampler is seeded by
(tile, pixel, sample), never by thread, and accumulation is per
tile in a fixed order. A test compares the hash of a reference
image between the native binary and the wasm (parity), and between 1 and N
threads. The AI guard has the same guarantee: `cargo test -p rt-post`
pins in `tests/fixtures/ai-guard.json` the *hash* of the delivered image,
that of what the model receives and the report JSON of five scenarios,
and `tests/ai-post-wasm.test.ts` repeats them with the real `post.wasm` (in CI,
the engine job) and requires the same bit for bit.

**Efficiency, by design** (the numbers are measured targets, not
CI gates): BVH with SAH construction by *binning* and wide nodes
(BVH4/BVH8) traversed with SIMD; *watertight* ray-triangle
intersection; aligned *structure-of-arrays* layouts; tiles in
Morton order; Russian roulette; explicit light sampling with MIS; Sobol
with Owen *scrambling*; variance-adaptive sampling; guided *denoise*
at the end. Target for the example part on x86_64 with AVX2:
≥ 10 million rays per second per core; in wasm, around a
third of native.

### 5.2 · RSB: the scene format

The only interface between the interface and the engine is a **little-endian
binary blob**, `RSB1`: header and sections `[u32 tag][u32 len][payload]`
(`CAMR`, `MESH`, `MATL`, `LGHT`, `ENVR`, `RNDR`, `INST`…), with unknown
sections ignored for forward compatibility. `INST`
(instance: mesh index, row-major 3 × 4 transform, material,
flags) is optional: without it, each mesh is an identity instance.

Semantics fixed in E3 (the source of truth is the `rsb` module of
`rt-core`):

- **`GLAS`** (S3, at most one, 48 B; an earlier engine skips it and the camera
  is the usual one): the front glass, right after `LENS` (or `CAMR`
  without it). `u32 flags` (0; unknown bits are kept and
  ignored), `f32 distance_mm` (from the camera position along
  its axis; 0, automatic: 25 mm with the simple lens, 5 mm in front of the front
  vertex with the traced one, which is also the minimum), `u32 seed`, `f32
  drop_coverage` (0..0.9), `drop_size_mm` (0..50, the diameter of the contact
  circle), `drop_size_var` (0..1), `contact_angle_deg` (5..175), `ior`
  (1..3), `dust_coverage` (0..0.5), `dust_size_mm` (0..10), `dust_size_var`
  (0..1) and `dust_opacity` (0..1); an out-of-range or non-finite value is
  an invalid file, a shorter payload is an error and a longer one is read
  as far as it is known. Without drops or dust, no pixel changes; without `GLAS`
  the bytes and the *hashes* are those from before S3. `rt_features` and
  `/api/info` raise bit 6 (value 64, `FEATURE_DROPS`). Rules in §5.2
  octodecies.
- **`SECT`** (Q1, at most one, 20 B; an earlier engine skips it and shows
  the whole part): the section view's plane, `u32 flags` (bit 0:
  cap the cut; the others are ignored), `f32 normal[3]` (towards the side that
  **is removed**; normalised unless it is already unit length within rounding,
  and zero or non-finite is an invalid file) and `f32 distance` (mm, the plane is
  `normal · p = distance` and what remains is `<=`). It goes after the lights and
  the `FXAM` and before `IMGS`, `BMAP` and `ENVR`; without a plane it is not written
  (the bytes from before Q1), an update without `MESH` brings it or removes
  it, and two `SECT` are an error. `INST.flags` gains bit 1
  (`INSTANCE_NO_SECTION`): the plane neither cuts nor caps that instance (the
  studio, §5.2 terdecies). `rt_features` and `/api/info` raise bit 2
  (value 4, `FEATURE_SECTION`). Rules in §5.2 terdecies.
- **`CAMR`** (K3; 60 B as always, 76 B with the K3 fields): after
  `ortho_width`, `u32 projection` (0 the usual one, pinhole, simple
  lens or orthographic according to `ortho`; 1 equirectangular; 2 equidistant
  fisheye; ≥ 3 is an error), `f32 fov_x_deg` (360), `f32 fov_y_deg`
  (180) and `f32 exterior` (1). They are written only if any of them is not the
  default, so earlier files keep their bytes and their
  *hashes*. `INST.flags` gains bit 2 (`INSTANCE_NO_CAMERA`, value 4,
  next to the 1 of `INSTANCE_NO_SECTION`): the camera does not see that instance and the
  rest of the rays do. `rt_features` and `/api/info` raise bit 4 (value
  16, `FEATURE_CAMERAS`). Rules in §5.2 quindecies.
- **`PATN`** (E6, new, repeatable, 108 B): a material's procedural
  pattern (`u32 material kind; f32 color_a[3] color_b[3] scale_mm
  params[16]; u32 variant seed`, §5.2 octies). `kind` 1 wood, 2 fabric; an
  unknown type draws nothing; a `material` that does not exist is an error.
- **`MATL`** (100 B since E9; those of 56, 60, 72 and 76 B are read with the default values
  for what they lack): `kind` 0 main (Lambert + GGX with
  clearcoat; the `transmission` part is clear glass: GGX reflection and refraction
  with the exact dielectric Fresnel), 1 glass (the main one without
  metal), 2 emissive (radiance `emission × emission_power`); unknown =
  0. `flags` bit 0: the emitter is also sampled as a light (by its flux);
  bit 1: thin wall (no interior: light and shadow rays pass
  straight through). E5 adds `opacity` (1; below, stochastic cut-out),
  `anisotropy` (0) and `absorption_mm` (0; above, Beer–Lambert inside
  the solid: `base_color` is what white light keeps after those
  millimetres). E6 adds `bevel_mm` (byte 72; 0; above, the radius of the
  shading edge bevel, §5.2 septies; emitters ignore it).
  E9 adds, after it, in this order: `scatter_mm` (0; above, the clear
  solid is filled with a scattering medium with that mean free
  path, §5.2 sexies), `scatter_color` (three `f32`, the single-scattering albedo
  per channel; 1, 1, 1), `scatter_g` (0; the Henyey–Greenstein
  anisotropy, clamped to ±0.9) and `abbe` (0; the Abbe number of
  solid glass with no medium: above 0, chromatic dispersion,
  §5.2 sexies).
- **`LGHT`** `kind`: 0 rectangle, 1 disc, 2 sun, 3 point, 4 spot
  (L4) and 5 IES (L5, §5.2 quaterdecies); ≥ 6 is an error. Rectangle and disc:
  one-sided, `power` = flux in W (mm → m), `spread_deg` = cosⁿ falloff
  with half intensity at `spread/2` (180 = no falloff). Sun: `power`
  = irradiance in W/m², disc of `angle_deg`. Point (L4): a sphere of
  diameter `size_x` (0, a point) of uniform radiance, `power` = isotropic
  flux in W (intensity `power / 4π` W/sr). Spot (L4): the point that
  it would be, within a cone of `spread_deg` around `direction`, with a
  transition of `angle_deg` degrees inwards from the edge (smoothstep,
  like three.js's `SpotLight`); its axis has the brightness of that point whatever
  the cone. `up` orients the panel about its axis (the writer
  still puts `[0, 0, 1]` with no roll, as before L4). `flags` bit 0
  *glossy* (lights all lobes and is seen in reflections; without it, only
  diffuse by NEE), bit 1 visible to camera, bit 2 (L4) **no shadow**: its
  shadow rays are not traced (an earlier file never sets it). IES (L5):
  the point of `power` W and diameter `size_x` whose intensity follows the profile
  of the `IESP` section named by the `u32` that follows `flags` (an IES
  `LGHT` is 80 B; the others, 76 as always).
- **`IESP`** (L5, new, repeatable): `u32 byte_len`, the bytes of an IES
  LM-63 file as text and padding to 4. Each distinct profile goes once, after
  the `LGHT`s, in the order of first use; the engine reads the text with
  `rt_core::ies` (a file it cannot read makes the RSB invalid, with the reason).
  An `IESP` section that no light names is read without complaint, and an engine
  earlier than L5 skips it (and rejects `kind` 5: that is why
  `FEATURE_IES` exists). Without IES lights, the bytes are those from before L5.
- **`ENVR`** (84 B since E5c; 80 B in E5) `kind`: 0 dome (linear in z: floor −1,
  horizon 0, zenith +1, × `strength`), 1 flat, 2 sky (with
  `sky_turbidity` and the sun at `sun_azimuth_deg` / `sun_elevation_deg`,
  scaled to the horizontal irradiance of the dome with the same values;
  neutral ground below the horizon; `sky_model`, the last field, E5c: **0**
  the own physical sky, which is also what a file without the field means
  and any unknown value, **1** the classic Preetham), 3 HDRI (the `hdri_map` map,
  equirectangular in three.js's convention, rotated `rotation_deg` about
  Z; without a map, the dome); `background_mode`: 0 environment, 1 colour,
  2 transparent (alpha 0), 3 background image (`backplate_map`, for camera
  rays only, placed in the `backplate_rect` frame according to
  `backplate_fit`: 0 fill, 1 fit, 2 stretch; without a map, as 1).
- **`BMAP`** (E5, new, repeatable): `u32 format width height byte_len`,
  the data and padding to 4 bytes. `format` 0 8-bit sRGB RGB, 1 8-bit
  RGBA, 2 linear `f32` RGB, 16 a whole `.hdr`, 17 a whole `.exr`
  (scanline: uncompressed, RLE, ZIPS or ZIP). The environment names a map
  by its position among the `BMAP`s (`0xffffffff`: none). An RSB without
  `BMAP` keeps the loaded maps, as one without `MESH` keeps the
  meshes.
- **Textures** (M2a contract, the engine reads it since M2b): see
  *Textures in the RSB* at the end of this section and §5.2 decies.
- **Material programs** (`PROG`, M3b): see *Material programs in the
  RSB* at the end of this section and §5.2 undecies.
- **`FLOR`** (20 B, at most one): `mode` 0 none, 1 infinite Lambertian
  plane, 2 shadow catcher; `z`; `color[3]`.
- **`RNDR`** (52 B since E5b-1; those of 28, 36 and 40 B are read with the default
  values for what they lack): also `max_depth` (0 = 8, cap 1024),
  `clamp_indirect` (0 = disabled) and, since X2, `passes`: the **mask
  of exact passes** that are written next to the image, bit *i* =
  `PASS_KEYS[i]` of `src/core/passes.ts` (1 albedo, 2 normal, 4
  depth, 8 part id, 16 material id, 32 circle of
  confusion and, since N2, 64 alpha). 0, or an RSB earlier than X2, requests none; bits that the
  engine does not know are kept and ignored. `tonemap`: 0 linear, 1 ACES,
  2 filmic, 3 AgX, 4 standard; unknown = ACES. Exposure 2^ev before
  the curve. Since E5b-1, at the end: `denoise` (u32; bit 0, the host
  delivers the denoised image; bit 1, the earlier one too; `rt-core` does not
  read it: rendering is the same with or without it), `caustic_photons` (u32,
  caustic photons per sample; 0 = no caustics; cap 4 194 304) and
  `caustic_radius` (f32, gathering radius of the first sample in pixels
  at the distance of the camera's target; 0 = 3). An earlier RSB requests
  neither *denoise* nor caustics. Since U11b (56 B), at the end,
  `denoise_strength` (f32 in `0..=1`; outside that range the RSB is not
  valid): how much of the filtered image is delivered; without it, 1. Since E11
  (64 B), at the end, `pixel_filter` (u32: 0 the one-pixel box, as
  always; 1 the centre; 2 tent; 3 Blackman–Harris; unknown = box) and
  `edge_supersample` (u32: samples per index of an edge pixel; 0 and
  1, one; more than 16, invalid RSB); without them, the image from before. Since
  E10 (72 B, **only when requested**: without them the section is E11's byte for
  byte), at the end, `adaptive` (u32; bit 0, the host samples
  adaptively, §5.2 duodecies; unknown bits are kept and
  ignored) and `noise_threshold` (f32 in `0..=1`, the relative error of the mean
  below which a block no longer receives samples; 0, none; out of
  range, invalid RSB); one of 68 B is read without a threshold.
- **`LENS`** (O1, new, optional, at most one, right after
  `CAMR`; `CAMR` does not change): the camera's optics beyond the thin
  lens (`rt_core::optics`). 72 B of numbers and the image:
  `u32 blades` (0 round, 3 to 18), `f32 roundness rotation_deg`,
  `u32 profile` (0 uniform, 1 bright centre `1 − kρ²`, 2 bright
  ring `(1 − k) + kρ²`, 3 apodised, Gaussian with σ = k;
  unknown = 0), `f32 profile_param obstruction cats_eye squeeze
  shift_x_mm shift_y_mm tilt_deg tilt_axis_deg ca_amount swirl
  field_mm`, `u32 mask_kind` (0 none, 1 mask that replaces the
  diaphragm, 2 texture that multiplies it) `mask_width mask_height`, the
  8-bit pixels (255 open; [−1, 1]² of the pupil, rows from top
  to bottom, inscribed unit circle; up to 1024 per side) and padding to 4
  bytes. **O3a** adds at the end the three slots of the effect-filter
  stack, 28 B each (`u32 kind`: 0 none, 1 white diffusion, 2
  black, 3 gold, 4 glow, 5 softening, 6 net, 7 star, 8 streaks;
  `f32 grade` 0 to 2, `tint[3]` (zeros: the type's own), `angle_deg`; `u32
  points` 4, 6 or 8, 0 is 6), written only when there are any: a `LENS`
  without filters is O1's byte for byte, and an O1 section is read without
  filters. **F1** may add after O2's prescription an `f32
  frame_sensor_mm`: the sensor of the output frame when `CAMR`'s covers
  more (the viewer's image), from which the traced lens takes what belongs
  to the frame's corner (§5.2 septendecies); without it, `CAMR`'s. An out-of-range value makes the file invalid. An RSB without
  `LENS` is the usual simple lens, bit for bit (the *hashes* of the example,
  E5, E5c, E5b-1 and the passes did not move); a neutral `LENS` too.
  The interface writes it only for a camera with non-neutral optics
  (`src/io/rsb.ts` `lensToRsb`): the images of `public/assets/aperture/`
  averaged 2 × 2 to 256 × 256 (`src/core/aperture.ts`, read without
  *canvas* by `src/io/aperture.ts`), texture mask in a single
  image, and `field_mm` = half the diagonal of the output frame on the
  36 mm sensor, whatever part of the viewer the image covers.
  **O2** adds, after the filter slots (which are then always written,
  empty if there are no filters), the **prescription** of a traced
  lens: `u32 surface_count` (0: O1's simple lens; up to 64), and with
  surfaces `u32 stop focus_mode` (0 unit, 1 internal, 2 floating,
  3 anamorphic: the adapter in front of its lens, which focuses as a
  unit while the adapter's listed slot carries the compressed meridian
  to the same focus), `f32 f_number_min magnification_base
  magnification_near distortion vignetting spherical breathing` (the
  non-physical settings, 0 off; −1 to 1, vignetting 0 to 1), `u32
  moving_count` (up to 8) and `(u32 surface; f32 base near)` per moving
  slot, and per surface, object side first, `u32 kind` (0
  sphere, 1 plane, 2 even aspheric, 3 x-axis cylinder, 4 y-axis, 5
  mirror), `f32 radius thickness nd vd semi_aperture` (radius 0: plane;
  negative thickness after a mirror; semi-aperture 0: the engine derives it),
  `u32 coating` (0 not air–glass, 1 uncoated, 2 single layer, 3 multilayer)
  and `f32 conic a4 a6 a8 a10`. The engine scales it to `CAMR.focal_mm`,
  focuses it at `CAMR.focus_dist` and prepares it when reading the scene (§5.2 nonies).
  The interface writes it from the catalogue (`composeLens` and
  `prescriptionToRsb`): the bytes are those of `rt` for the 16 lenses
  (`tests/fixtures/lens-catalogue.json`, `rt --write-lens-catalogue`).
- **`FXAM`** (S4a, repeatable: one per *Ambient* effect; an earlier engine
  skips it as an unknown section). The effect's **parameters**, not its
  particles: 200 B (192 in S4a; 228 with the S3 fields,
  which the writer adds only when any is not the default, so
  an effect without drops, mix or shape variation keeps S4b's 200 B;
  the first 128 are mandatory; a shorter payload is an error, a
  longer one is read as far as it is known and the surplus is ignored;
  budget, 256 B). The engine evaluates the
  particles when loading the scene with `rt-sim` and builds their BVH; the
  source of truth is `rt_sim::params`.

  | Offset | Type | Field | What it is |
  | --- | --- | --- | --- |
  | 0 | `u32` | `kind` | preset code (1 `DUST_MOTES` … 8 `CONFETTI`; any other is evaluated the same: the fields decide) |
  | 4 | `u32` | `seed` | seed |
  | 8 | `f32` | `time` | frozen instant, s |
  | 12 | `u32` | `count` | particles to evaluate (the writer already applies the cap; at most 2²⁴) |
  | 16 | `f32[3]` | `region_centre` | mm |
  | 28 | `f32[3]` | `region_half` | half the box size, mm (≥ 0) |
  | 40 | `f32[2]` | `band` | heights that are kept, mm (`min ≥ max`: no band; the TypeScript writer already applies it to the box and writes 0, 0) |
  | 48 | `f32` | `size_mm` | mean diameter, mm |
  | 52 | `f32` | `size_var` | relative variation, 0..1 |
  | 56 | `u32` | `shape` | 0 sphere, 1 disc (flake), 2 capsule (streak), 3 drop (S3; an earlier engine reads it as a sphere); with a mix, the heaviest shape (what an engine without mixes draws) |
  | 60 | `f32` | `fall_speed` | terminal velocity at 1 g, mm/s |
  | 64 | `f32` | `fall_var` | relative variation, 0..1 |
  | 68 | `f32[3]` | `wind` | mm/s |
  | 80 | `f32[3]` | `turbulence` | strength (displacement, mm), scale (mm), speed (mm/s) |
  | 92 | `f32[3]` | `cloud_centre` | mm |
  | 104 | `f32` | `cloud_radius` | mm; 0: no cloud (the box is filled) |
  | 108 | `f32` | `cloud_softness` | 0 hard edge .. 1 soft |
  | 112 | `u32` | `material_id` | index of a `MATL` (if it does not exist, error) |
  | 116 | `f32` | `tint_var` | per-particle tint variation, 0..1 |
  | 120 | `u32` | `flags` | bit 0 visible to camera, bit 1 in reflections (and every secondary ray), bit 2 casts shadow |
  | 124 | `f32` | `streak` | length of the capsule divided by its speed, s |
  | 128 | `f32` | `gravity` | multiple of g (1); negative rises |
  | 132 | `f32` | `energy` | birth speed, mm/s (0) |
  | 136 | `f32` | `spin` | turns per second of the discs (0) |
  | 140 | `u32` | `palette_count` | tints each particle chooses from, 0..4 (0: the material's colour) |
  | 144 | `f32[4][3]` | `palette` | linear RGB, multiplies the material's base colour |
  | 192 | `f32` | `forward` | S4b: the part of what the particle scatters that goes to the forward lobe, 0..1 (0: none; a 192 B payload does not have it) |
  | 196 | `f32` | `forward_g` | its Henyey–Greenstein asymmetry, −1 < g < 1 |
  | 200 | `f32[4]` | `mix` | S3: weights of a shape mix (sphere, disc, capsule, drop; ≥ 0; all 0: all are `shape`) |
  | 216 | `f32` | `drop_tail` | S3: length of the drop, from the centre of its body to that of its tip, in body radii, 0..16 (1.6) |
  | 220 | `f32` | `drop_tip` | S3: radius of the tip over that of the body, 0..1 (0.15) |
  | 224 | `f32` | `shape_var` | S3: variation of the length of each drop and each streak, 0..1 (0) |

  **In the engine** (`rt-core::geometry::particles`): one set per effect
  with its flat BVH over the real sizes (one-particle leaves; the id
  breaks ties), traversed **after** the instance BVH (the nearest part
  bounds the ray; a shadow ray looks at the parts first).
  Stable sphere intersection (Haines, Günther and Akenine-Möller,
  *Precision Improvements for Ray/Sphere Intersection*, *Ray Tracing Gems*
  2019, ch. 7), oriented disc and capsule. **Minimum on-screen size**:
  for camera rays, a particle finer than 0.35 px at its
  distance is widened to that (the BVH is padded with the same margin) and the
  hit is split to preserve energy: with coverage
  `c = (r / r_widened)²`, the ray is shaded with probability
  `q = max(c, ½)` and weight `c / q`, or passes through with weight `(1 − c)/(1 − q)`
  (scaling the radiance by `c` alone would darken what is behind). A
  particle's material is that of its `material_id` with the tint of its
  seed; a disc is always a thin wall. Passes: `partId` = the index of the
  effect after the instances, `materialId` that of its `MATL`. An
  update without `MESH` with the same parameters keeps the
  particles and their BVH. Without `FXAM` (or with count 0) the pixels of any
  scene are those from before S4a (test).

  **S4b.** (1) *Screen grid*: with a perspective camera each
  set keeps a grid of 4 px cells over the image with, per
  cell, the particles whose box (widened as camera rays see it,
  and in pieces along its axis if it is a long capsule)
  projects onto it; a camera ray leaving the centre (pinhole) or
  the aperture disc (simple lens: each particle's rectangle
  grows with the circle of confusion `R |1/z − 1/z_f|` at its worst
  depth and the ray looks up the cell of its point on the focus plane)
  tests those of its cell instead of walking the BVH: the same nearest
  hit, bit for bit (test against brute force). A cell with
  more than 128 particles (`GRID_MAX_CANDIDATES`) sends its ray to the BVH,
  which stops at the nearest hit. The other rays continue with the BVH. (2) *Drops without caustics*: a particle of clear
  material (`(1 − metallic)·transmission ≥ ½`: rain, bubbles) is crossed
  straight, whole, from beyond its back face and with the straight
  transmittance of a thin wall of its material, by shadow rays (if it casts
  shadow) and by those of a path that already bounced off a wide lobe
  (`RayClass::Rough`: density < 100 sr⁻¹; then it is seen only if it
  casts shadow); the camera and the narrow-lobe paths from it
  (mirror, smooth glass) still see it refract. On a clear
  and smooth particle the next-event estimation only looks for delta lights; the
  others are found by its BSDF ray, which counts what it finds in full
  (infinite density in the MIS). (3) *Forward lobe*
  (`bsdf::forward`): with `forward > 0` and an opaque material, the particle's
  BSDF is `(1 − forward)·surface + forward·albedo·p_HG(−wi·wo)/|cos θi|`
  (Henyey and Greenstein, ApJ 1941), sampled with probability `forward` and
  with the mixture density in E12's MIS; its rays that cross
  the particle (and its shadow rays) leave from its back face.

  **S3.** A drop is the convex hull of its round body and of a
  smaller tip that follows it (against its velocity: the one that falls points
  upwards; at rest, along the normal of its life); with a
  mix, each particle draws its shape once with its own *hash*
  (`mix`), and `shape_var` lengthens or shortens each drop or streak with
  another; the salts are new, so an effect without them gives the same
  bits. The set stores one shape per particle only if they are mixed, and
  all the tests (hit, exit, normal, coverage, grid boxes)
  dispatch on it; a disc in a mix is a thin wall, its drop a
  solid. Detail in §5.2 octodecies.
- The `rt-core` writer always emits `FLOR` and the new fields; the
  TypeScript writer of E4 does the same. `rt-core`
has a reader and a writer; `src/io/rsb.ts` has the writer in
TypeScript, and a parity test writes the same scene from both
sides and compares the bytes. `.repack` remains the project
format; the RSB is what travels to the engine (and what `rt` reads on the command
line). **Updates** (E4): `rt_scene_update` accepts an RSB
without `MESH` that keeps the loaded meshes and their BVHs (camera, lights,
materials, environment, render change without rebuilding geometry); that is why
the meshes always declare material 0 and the real material goes in `INST`,
which is always written. Units: millimetres, Z up, 36 mm sensor
on the long side; flux of a panel = π/4 × rig power × size²
(Blender Cycles' area-light convention, L = P / (4 A), with which
the recipes were tuned; `src/core/photometry.ts`); the sun's angle, in degrees. Bitmaps travel in `BMAP` sections
(E5: the HDRI and the background image; the textures, in `IMGS`, below); the
mesh key of the TypeScript writer includes the image ids,
so that an image change sends the whole scene.

**Textures in the RSB** (contract written in M2a; `rt-core` reads it since M2b).
The TypeScript writer writes it **only when the view asks for it**
(`SceneView.textures`), and the view asks for it when the engine says it reads it:
`rt_features()` of `rt.wasm` (bit 0, `rt_core::FEATURE_TEXTURES`; an earlier `rt.wasm`
does not export it and counts as 0) and `features` of the launcher's `/api/info`
(`render/engine.ts` `readsTextures`: the *pool* and `NativeEngine` set it on the
*Full* and *Render* views). Before writing the scene, `main.ts`
decodes the images that the materials use (`decodeTexturePixels`, when
the materials change and before each render; if new pixels arrive, the
viewer rebuilds its scene). Off, the bytes are those from before M2a for
any scene (test: the same scene with its textures and without them gives the
same bytes, and the pinned scenes of `tests/rsb.test.ts` do not change); on
with no image, the engine paints the same pixels as without blocks
(`an_empty_texture_block_and_the_uv_sets_change_no_pixel`). On, it writes three things:

1. **`IMGS`** (new, at most one, travels with the meshes: an update RSB
   without `MESH` does not carry it either and the engine keeps the loaded
   images). `u32 count`; per image `u32 width height channels
   color_space` and `width × height × channels` bytes, rows from the top,
   padding to 4 bytes. `channels` 1 (grey), 3 (RGB) or 4 (RGBA, straight alpha);
   `color_space` **0 sRGB** (which the engine decodes to linear: the
   colour and emission slots and the labels) or **1 linear** (data:
   roughness, metal, normal, alpha; alpha is always linear). An image
   used both ways goes twice. 8 bits; the **mipmaps are computed by
   the engine**. The pixels are decoded by the interface
   (`io/texture-pixels.ts`, with the browser's decoder): the engine does not
   read PNG or JPEG.
2. **`MATL`**: the earlier fields (72 B), those of E6 (`f32 bevel_mm`, 76 B) and
   E9 (`f32 scatter_mm scatter_color[3] scatter_g abbe`, 100 B), which the
   writer always sends, and from
   **byte 100** the texture block:

   ```text
   u32 texture_block_version (1)
   6 × slot (colour, roughness, metal, normal, alpha, emission), 15 words:
     i32 image          index into IMGS, -1: none
     u32 projection     0 UV, 1 box, 2 planar, 3 cylindrical, 4 spherical
     u32 axis           0 X, 1 Y, 2 Z
     u32 uv_set         0 the first, 1 the second
     f32 size_mm        what one repetition spans across (height: from the image)
     f32 rotation_deg   counter-clockwise, v up
     f32 offset[2]
     f32 repeat[2]
     u32 wrap           0 repeat, 1 clamp to edge, 2 mirror
     u32 channel        0 R, 1 G, 2 B, 3 A, 4 luminance (Rec. 709 of the values)
     u32 flags          bit 0 invert, bit 1 cut-out, bit 2 height map
     f32 strength       normal: intensity (or mm of relief for white); emission: multiplier
     f32 cutoff         cut-out alpha: the threshold
   f32 emission_tint[3]
   u32 label_count
   label_count × label, 19 words:
     i32 image          index into IMGS (sRGB), -1: none
     f32 origin[3] u[3] v[3] normal[3]   in the part's space, u and v unit length with the roll already applied
     f32 width_mm height_mm depth_mm      depth: reach in front of and behind the plane
     f32 roughness coat relief            the finish where it covers (relief: the paper's edge)
   ```

   Size: `100 + 4·(1 + 90 + 3 + 1 + 19·n)` bytes. Each slot already carries the
   resolved mapping it uses (its own or the shared one). The `rt-core` reader
   (M2b) reads the block when the section continues at byte 100 and its version is
   1 (another version belongs to a newer file: it is skipped); a projection,
   axis, UV set, wrap or channel code out of range, a
   non-positive `size_mm`, a label without size or with negative
   reach, a truncated block or an image index that is not in `IMGS`
   make the file invalid.
3. **`MESH`**: after `material_id`, `u32 uv_sets` (0, 1 or 2) and each set of
   `2n` `f32`. The `MESH` positions are the part's own space (instances
   carry their transform), which is that of the projections and the
   labels. More than two sets, or one without a pair per vertex, is an
   error.

`IMGS` travels with the meshes in the engine too: an update without `MESH`
or `IMGS` keeps the loaded images (and their *mipmaps*); one with `MESH` and without
`IMGS` is left with none. The `rt-core` writer writes the same as the
TypeScript one when the scene has images or blocks (or `Scene::textured`, a
file whose meshes brought their UVs and nothing more): `IMGS` after the `FXAM`s and
before the `BMAP`s, the block of each material that has one and the UVs of
all the meshes; `tests/fixtures/m2b.rsb` (`rt --write-m2b-example`) is read and
written in TypeScript to the same bytes (`tests/textures-engine.test.ts`).

Semantics (those of `SPEC.md` §3.3 and `src/core/textures.ts`, whose functions
are the reference that the tests pin and that the Fast *shader* follows): texture
coordinates with v up, the texel at column `u·width` and
row `(1 − v)·height`; box with |n|⁴ weights and no mirroring; cylindrical and
spherical with the image centred in front (−T of the axis section); `uv =
R(roll)·(c ⊙ repeat) + offset` (+½ in the projections); the
image multiplies the parameter, emission adds `tint × image ×
intensity` in radiance; a label covers `|s − ½| ≤ ½`, `|t − ½| ≤ ½`,
within `depth_mm` of its plane and on surfaces with `n · normal > 0`, and
is composited in order over the substrate by its alpha.

**Material programs in the RSB** (M3b). The TypeScript writer writes them
**only when the view asks for it** (`SceneView.programs`, with `textures`: a
program reads `IMGS` and the UVs), and the view asks for it when the engine says it
runs them: bit 1 of `rt_features()` and of `features` of `/api/info`
(`rt_core::FEATURE_PROGRAMS`; `render/engine.ts` `readsPrograms`, which also
asks for bit 0; the *pool* and `NativeEngine` set it on the *Full* and
*Render* views, and *Export engine scene (.rsb)* carries it). Off, or
without node materials, the bytes are those from before (test). On, each
node material whose graph compiles writes:

- its **`MATL`** as until now: the average of each output over the sample
  sphere (`flattenGraph`), with the family of its output (glass if it has
  absorption or thin walls), and non-emitter if the emission or its intensity is not
  a constant of the program (`emissionVaries`): what the engine takes from the
  file (the type, the absorption, the thin walls, the bevel radius) and what an
  earlier engine reads;
- a **`PROG`** (new, after all the other sections, one per
  material): `u32 material` (the index of its `MATL`) and the bytes of
  `encodeProgram` (§5.2 quater), with the image table in `IMGS`
  indices (the image in the colour space its reading requires: sRGB for
  colour, linear for data);
- the **UVs** of all the meshes and the programs' **images** in
  `IMGS`, as with textures.

The `rt-core` reader: the first `PROG` of a material counts; one of another
program version belongs to a newer file and is skipped (the material keeps
its `MATL`); a program that is invalid (§5.2 undecies), that does not have the fifteen
outputs of a material, that is of a material that does not exist or that has an image that is not
from `IMGS` or not of its colour space makes the file invalid. `PROG`s
travel with the materials in an update (the programs read the
kept images). The `rt-core` writer writes the same:
`tests/fixtures/m3b.rsb` (`rt --write-m3b-example`) is read and written in
TypeScript to the same bytes (`tests/programs-engine.test.ts`).

**Exact passes** (X2, `rt_core::passes`; contract in `AI-POST.md` §7.4 and
`src/core/passes.ts`). One plane per pass, `width × height`, in rows from
the top left like the image, in `PASS_KEYS` order. The
normal, the depth, the two ids and the circle of confusion come from
**one ray through the pixel centre, with no *jitter* and through the centre of the
lens** (`render::centre_ray`), once per tile
(`render_tile_exact`): they are exact and never mix the two sides of an
edge. The albedo follows the camera ray of each image sample
(the same position in the pixel and the same lens point) and is summed in
sample order in `f32` and divided like `Film::resolve`
(`render_tile_albedo`), so with depth of field it blurs
like the image. The first hit (`integrator::first_hit`) is that of the
geometry or the floor, the nearest, as in the integrator; any
surface stops it (cut-outs and glass included: what `pick`
finds). The **studio floor** (`FLOR`, visible or shadow catcher) is
`FLOOR_ID` (`0xFFFFFFFF`) in both ids, normal `(0, 0, ±1)` towards the
camera and albedo `FLOR.color`; the **background** (0, depth +∞) is the
environment, the background image, transparency and a camera-visible
light panel crossed before anything else. The passes have their own rays: they
do not touch the film or its random numbers, and the image keeps its
*hash* (`render/passes_tests.rs` checks it with the three pinned
examples). The *hashes* of the six planes of the example and of the E5
example are pinned (`PINNED_PASS_*`, `PINNED_E5_PASS_*`) and repeat on each
SIMD path, in WASI (scalar and `simd128`), in the real `rt_wasm.wasm`
(`tools/wasm-parity.mjs --expect-passes`, in CI) and through the
launcher's API with 1 and 4 threads. The circle of confusion is that of
`src/core/lens-coc.ts` (both sides read `tests/fixtures/lens-coc.json`)
and agrees, within 1 %, with the measured blur of the lens itself
of `Camera::generate_ray`.

**The alpha pass** (N2): the seventh, added at the end as the contract requires
(`PASS_KEYS`, bit 6; `PASS_X2` is `PASS_ALL` without it and the X2 *hashes* are over
those six). It is the **coverage of the objects**: the fraction of the pixel's samples
whose camera ray finds a surface of an instance (`coverage_of` over
the same `first_hit`: a single trace serves albedo and alpha, in
`render_tile_albedo`), summed in sample order and divided like the albedo, each
on its own count, so that edges come out smoothed like the image
(with edge samples, E11, the mean of their subsamples). The studio floor, the
environment, the background, transparency and the light panels the camera sees are 0,
and cut-outs and glass count as surface, as in all passes (X2).
That is why it is not the alpha of a render with a transparent background when the path crosses
glass or the floor is a shadow catcher with its shadow; where there are only opaque objects and
background, **they are equal bit for bit** (`rt-core` proves it). New output of `rt-wasm`,
`rt_render_tile_alpha` (`w × h` coverages per sample), and the launcher's `RPP1` carries it
last. Pinned *hashes*: `PINNED_PASS_ALPHA` (the example) and
`PINNED_E5_PASS_ALPHA`, equal in scalar, SSE2 and AVX2, in WASI, in the real
`rt_wasm.wasm` (`tools/wasm-parity.mjs --expect-alpha`, in CI) and through the
launcher's API. With adaptive sampling (E10), like the albedo, it carries the samples of the
first round.

### 5.2 ter · The camera optics (O1, `rt_core::optics`)

`Camera.lens: Option<Lens>`; without it, `Camera::sample_ray` does what it
always did (the concentric map of the two lens dimensions and white
weight). With it, `Lens::sample` returns the ray **and a colour weight**
that the tile multiplies in before accumulating (`render::camera_sample_weighted`):

- **Pupil** (`optics::pupil`): disc (concentric map and radius
  remapped by the inverse CDF of the profile in `s = ρ²`), fan of
  triangles from the centre (diaphragm of N straight blades; curves with
  24 chords per blade: arcs of radius `apothem / roundness` tangent to
  the edge at its midpoint, like `tools/assets/aperture-masks.mjs`) with the
  profile of the shape's *gauge*, or a grid with marginal and
  conditional CDF of an image (mask or texture through the shape with a
  softened edge; profile and obstruction inside). Nothing is rejected and nothing
  is weighted: Sobol stratification reaches the pupil and the brightness does not
  change. Only `+ − × ÷ sqrt` and `fmath` (`exp`, `ln`, `sin_cos`, `atan2`
  when preparing).
- **Field**: image height `h` (0 on the axis, 1 at `field_mm`) and
  radial direction from the optical axis (with the shift). Swirl
  (artistic): compresses radially, stretches tangentially and rotates the
  pupil in proportion to `h`. Cat's eye: a sample outside the second
  disc (radius 1, displaced `cats_eye × h` towards the axis) weighs black, but
  traces its ray (the coverage of a transparent background does not change).
  Chromatic aberration (artistic, decision 3): with `ca_amount > 0` each
  sample takes an R, G or B band through `PixelSampler::strata` of
  `DIM_LENS_BAND` (`3 << 20`, beyond the Sobol table and the
  cut-outs: every three consecutive samples of a pixel are the three bands,
  offset by a hash of the pixel, and the three share one point of the
  pupil, the index `(i + offset) / 3` of the lens's Sobol sequence:
  each band walks its own points in order and the colours inside a
  disc coincide instead of speckling), scales the pupil by
  `1 + a·CA_SCALE[band]` and moves it `a·CA_SHIFT[band]·h` radially, and
  weighs only its channel by three. Anamorphic: the pupil's x divided by the
  squeeze.
- **Ray** (`Lens::thin_ray`, also what `Camera::generate_ray` uses
  with a lens, and therefore `render::centre_ray`): the chief ray through
  `forward·f + right·(x + shift_x) + up·(y + shift_y)`; without tilt,
  the usual focus plane; with a tilt `α` about the axis `a`
  of the sensor plane, the pupil in the rotated lens plane and the
  focus plane through the axis's focus point with normal
  `f·forward + u·sin α·(forward × a)` (hinge rule; with the sensor
  at `f u / (u cos α − f)` Scheimpflug also holds, and the test
  checks it with three points). A chief ray that does not meet that plane
  ahead focuses at infinity.
- What does not change: the `coc` pass (`passes::coc_diameter`) remains
  that of the round, untilted simple lens; the orthographic camera
  ignores `LENS`; light sampling, BSDF and cut-outs see nothing new.
- Pinned *hash* of the O1 scene (`example::o1_scene`, all the
  knobs at once and a texture of rings): `PINNED_O1_LENS_4SPP` =
  `0x087d1276` (since the merge of E9 and E12: energy compensation and per-point light selection move the hash) on each SIMD path, in WASI, in the real `rt_wasm.wasm`
  (`rt --write-o1-example`, `tools/wasm-parity.mjs`, in CI) and with 1, 4 and
  16 threads (`rt-cli/tests`).
- **Effect filters** (O3a, `optics::filters`): after the pupil, each
  filter of the stack (up to three, in order) decides with a number whether it scatters
  the sample (probability `s` of the grade: `kind_s`, tables by `GRADES`
  linear between grades, `GRADE_S` for the diffusions, glow and net,
  `STAR_S` and `STREAK_S` of their own) and, if it does, deflects the ray's
  direction `d + right·δx + up·δy` (δ in tangents, radians) and weighs it with
  `Filter::colour_at`: `a` in the core and the glints, `a·T` in the
  streaks and, in the diffusion, by the part of the tail in the density at that
  distance (the tint goes to the halo, not to the image). The PSFs are radial
  (diffusion: Gaussian of `SIGMA_CORE_DEG` and 2D Cauchy tail of
  `SIGMA_TAIL_DEG` up to 12 widths; softening: the Gaussian), line-like
  (star, streaks and the net's cross: density 1/r from
  `LINE_START_DEG` tapering to 0 at its length, `line_length_deg`:
  `STAR_LENGTH_DEG` and `NET_LENGTH_DEG` per grade, `STREAK_END_DEG` the
  streaks; thickness of `LINE_WIDTH_DEG`) or glints (glow: the Gaussian, a
  soft halo of `GLIMMER_CLOUD_DEG` and a fixed cloud of `GLIMMER_SPARKLES`
  glints, 2D Gaussian of
  `GLIMMER_CLOUD_DEG`, with exponential brightnesses from a *hash*, of which
  each sample takes one by its weight; on a 64 × 64 grid for the
  connections); all by tabulated inverse CDF (256 values, built at
  load with `fmath`), with no `exp` or `ln` in the loop. Scattered
  rays rarely hit a small light, so each camera sample
  with filters **also connects to a light** that the camera sees
  (`Lights::camera_lights`, by its bounding sphere; one chosen at random
  per filter): one lobe per part of the PSF, a deviation inside
  the light with the connection density of that lobe (the light's disc in
  the plane of deviations, `filters::light_disc`; for the streaks, the streak
  chosen by the probability that falls inside and the distance by its
  density there; for the glow, one of the glints whose box touches the light,
  by its weight and the area of that part, and a point in it), a shadow
  ray and its radiance times `s`, the lobe's colour and the probability that the following
  filters do not scatter. Scattering and connection are weighed
  against each other with the lobe-to-lobe balance heuristic
  (`Filter::mis_weight`): the lights that the first leg of a scattered
  sample's ray crosses weigh `K / (K + p·q)` (`integrator::radiance_weighted`)
  and the connection `s·L` by its colour and that same weight where it fell. Without lights that the
  camera sees, there is no connection. The numbers of each filter come from four
  dimensions of their own beyond the Sobol table (`DIM_LENS_FILTER`,
  `4 << 20`, four per filter) and those of its connection from six more
  (`DIM_LENS_FILTER_LIGHT`, `5 << 20`);
  with chromatic bands, those of the group of three (one scattering, three
  colours). A lens without filters draws none: the earlier *hashes*
  do not move. Parity scene `example::o3a_scene` (black diffusion
  1/2, 6-to-15° star and 1/2 streaks over a 6-blade diaphragm):
  `PINNED_O3A_FILTERS_4SPP` = `0x21e43bb1` (since E9a arrived; before it `0x49938f3b`) on each SIMD path, in WASI, in
  the real `rt_wasm.wasm` (`rt --write-o3a-example`, `tests/fixtures/o3a.rsb`)
  and with 1, 4 and 16 threads. The Fast viewer applies `(1 − s)·I + s·a·(I ⊗ K_T)`
  with the same kernels projected by the focal length (`render/lens-filter-*`;
  each part with its colour, the glow's cloud as the Gaussian it
  comes from), as an approximation that the meter declares.

### 5.2 bis · Film, *denoise* and caustics (E5b-1)

**Film.** `Film` accumulates, besides the premultiplied radiance, the
weight and the coverage, the **sum of the squares of the luminance** of each
sample (`Film::lum2`, `f32`, in sample order). It does not touch `rgb`, `weight`
or `alpha`: no image *hash* moves. Together with the mean it gives the variance of
each pixel, `(E[l²] − E[l]²) / (n − 1)` of the mean of `n` samples. The pool
sums it the same way in TypeScript (`Accumulator.lum2`, `render/tiles.ts`:
Rec. 709 luminance in `f32` in the same order, `l²` rounded and summed),
and the launcher reads it from its per-tile films.

**Own *denoise*** (`rt_post::denoise`, `crates/rt-post/src/denoise.rs`).
À-trous transform with edge-stopping (Dammertz, Sewtz, Hanika and
Lensch, HPG 2010: B3 kernel `(1, 4, 6, 4, 1)/16`, five passes with
steps 1, 2, 4, 8 and 16) with the luminance stop guided by the variance
of SVGF (Schied et al., HPG 2017: `exp(−|l_p − l_q| / (σ_l √g(Var_p)))`
with the variance filtered by a 3 × 3 Gaussian and carried from pass to
pass as `Σ w² Var / (Σ w)²`, normal `max(0, n_p·n_q)^128`, depth
`exp(−|z_p − z_q| / (σ_z |∇z·Δ|))`, σ_l = 4, σ_z = 1; the albedo is divided out
before and multiplied back after, and with fewer than four samples the variance
is estimated from the 7 × 7 neighbours). Guided by X2's exact passes
(`GUIDE_PASSES`: albedo, normal, depth, part id, material id),
with **zero weight between different parts or materials** (it never mixes two
parts) and the background (id 0) left intact. What is ours: the film's variance,
the exact passes as guides, the stops by id, a firefly clamp
before filtering (a pixel more than four times brighter than
all its neighbours on the same surface drops to that limit) and the
exponentials of the stops as `(1 − x/16)^16`. All `f32`, no
`std` transcendentals, in a fixed order: the same bits natively and in
wasm. It reads RGBA sums of `n` samples and returns RGBA sums (coverage
as it was). **By row bands**: `denoise_rows` computes some rows
with `HALO` = 72 rows around them (the reach of the whole filter) and gives
exactly those rows of the whole image, so hosts distribute it
among threads or *workers* without changing a bit (bands of at least 192
rows). Pinned *hash*: the example at 4 samples with *denoise*,
`0x2a430f92` (`PINNED_DENOISED_EXAMPLE_4SPP`, since the merge of E9 and E12), equal with the real `rt.wasm`
(`tools/wasm-parity.mjs --expect-denoised`) and through the page's code
(`tests/denoise.test.ts`).

**Caustics** (`rt_core::caustics`). Stochastic progressive photon map
(Hachisuka and Jensen, SIGGRAPH Asia 2009, after Hachisuka, Ogaki and Jensen
2008) in the probabilistic form of Knaus and Zwicker (ACM TOG 30(3), 2011):
each sample index is a pass with its photons and its visible points,
and its estimate is a photon map with radius
`r_i² = r_1² Π_{k=1..i} (k + α)/(k + 1)`, α = 2/3 (r_1 = `caustic_radius`
pixels at the target distance). Averaging the passes, which is what the
film does with its samples, converges like SPPM with no per-pixel state:
a tile can still be rendered on any thread and in any order with the
same bits. **Partition without counting twice**: a *caster* is glass or
metal whose sharpest direction has roughness ≤ 0.25 (brushed counts
along its brushing); everything else that scatters is a receiver (the floor
included); a straight event (cut-out, straight transmission of a thin wall) does not
count. The map carries exactly the light of the `L C+ R` legs: photons
from the lights that send them (*glossy* panels and discs, *glossy* suns,
emissive meshes; never the environment nor L4's points and spots, whose
caustics remain in the tracer), only through *casters*, stored at the
first receiver they touch; the camera gathers them, with its BSDF, at **each**
receiver along its path: the first (the caustic seen directly or
through the glass) and the following ones (a caustic that lights the scene
by a diffuse bounce, with the indirect-light clamp). The tracer
leaves out exactly that light: after any receiver, what
arrives from a photon light only through *casters* (hit by BSDF sampling
or NEE on a *caster*). Left to the tracer, the caustic seen through a
diffuse bounce arrived in rare, very bright samples: these were the
glints around the base of the jar at 1024 samples. The maximum
depth applies to both. Emission directed at the bounding spheres of the *casters* (up to 16)
with the density of the whole mixture; refraction with flux (without the 1/η² of radiance)
and the adjoint correction for shading normals (Veach 1997); PCG by (seed, sample,
photon), so a map gives the same bits traced in any split
(`PhotonMap::trace_range`). Cell-2r *hash* grid, kernel
`2(1 − d²/r²)/(π r²)`. **Shadow catcher** (the interface's floor): the
photons also land on its plane and the camera ray that sees it adds their light,
relative to that of the open floor, to the background it shows; with a transparent
background they are not shown. Cost: `caustic_photons` photons per sample,
traced by each host before the tiles of that sample (in wasm,
each *worker* keeps the 16 maps of the last pass). Pinned *hash*: the
E5 scene with 2048 photons per sample, `0x7135df4b` (since the merge of E9 and E12)
(`PINNED_E5B_CAUSTICS_4SPP`, `rt --write-e5b-example`), equal on all
SIMD paths, in the real `rt.wasm`, through the launcher with 1, 4 and 16 threads and through
the page's code.

**Interface.** `core/caustics.ts`: *Caustics* (*Automatic · On ·
Off*, in the quality section of the render window; *Automatic*
turns them on with a *caster* and a *glossy* light that, seen from the
*casters*, does not exceed 20°, a sun or a lit emitter; `projectScene`
decides it from the scene), *Caustic quality* (*Low* 4096 photons
and 4 px, *Medium* 16 384 and 3 px, *High* 65 536 and 2 px) and *Denoise* (*Off ·
Viewport · Render · Both*, default *Both*) with *Also save without
denoise*; they live in `render.advanced` (undoable, stored in the
project, copied into each job) and reach the engine as the fields of
`RNDR` above (`engineFieldsOf`). The meter says what the engine says:
*Denoised* when the image on screen is the filtered one and *Caustics ·
N photons per sample* when the engine renders them (`rt_scene_caustics`
in the pool, `FLAG_CAUSTICS` in the launcher).

**Live *denoise* of the viewer** (U11). Two filter settings
(`rt_post::denoise::Preset`): `FULL`, the one above, for the render (and for
`rt`), and `VIEWPORT`, three à-trous passes (steps 1, 2 and 4) and the 3 × 3
spatial variance below four samples, with its own halo (24 rows;
`Preset::halo` is `2^(passes+1) + 8`, 72 for the full one); both are
deterministic and a band of either is exactly those rows of the
whole image (`denoise_rows_with`; in wasm, `rt_denoise_with(1, …)` and
`rt_denoise_halo`; pinned *hash* of the example with the viewer's,
`PINNED_DENOISED_VIEWPORT_EXAMPLE_4SPP`). The setting is chosen by the type of
job, not by the RSB: the `RNDR` does not change. A full-resolution viewer
always requests *denoise* in its RSB (so the engine renders the guides and the
switch does not change the scene; while it is off, the guides' albedo
stops after the first `LIVE_ALBEDO_SAMPLES` = 8 samples) and carries the
switch separately: in the launcher, `denoise=0|1` when publishing the view and
`POST /api/render/<id>/denoise?on=0|1` afterwards; on the web, the
`PathTracerEngine` itself. **The lane**: each finished pass is handed to it
(sums, `lum2` and guides); while the switch is on, the
lane denoises the newest pass, shows the clean image as soon as
it is ready and then starts the next one on the newest, without stopping
the render. In the launcher it is one thread per viewer job that, while
it works, takes one of the viewer's render threads (the last of those
that render: `Gate::viewport_turn`), so it never takes a thread from a
final render sharing the machine; on the web, the viewer's *workers*
take their bands between tile and tile. With the switch on, the
passes last about as long as a *denoise* and at least 250 ms
(`live_pass_cap`, `livePassCap`; which pass a sample falls in does not change
a pixel), so a clean image arrives at most one pass and one
*denoise* after the previous one: every `max(2 × the denoise, 0.5 s)`. Each
launcher frame carries its image's number (52-byte header,
`Frame::version`; since E10, 68 with what adaptive sampling says about
the image, §5.2 duodecies) and the *long-poll* asks for it with `version=`: the sums only
come with a newer image, and a viewer that has already finished waits for the
clean one that the switch asked for. Off, the next frame is the noisy
accumulation; on, what has accumulated is denoised at once (also
with the viewer converged). Gesture frames (reduced resolution)
still have no guides or *denoise*; the final render denoises once, at the
end, with the full filter, as before.

**Denoise strength** (U11b). `RNDR.denoise_strength` (`s`, the
*Strength* in *Advanced*, 0–100 % in the project and `0..=1` in the engine)
blends the noisy and the filtered image in the engine, per channel and in linear
light: `noisy × (1 − s) + filtered × s` in `f32`
(`rt_post::denoise::blend`; with `s = 0.5` it is exactly the mean; alpha
is not touched). `denoise_rows_at(input, y0, y1, preset, s)` is the band already
blended; with `s = 0` it does not run the filter and returns the noisy rows
as they are, and with `s = 1` it is `denoise_rows_with` (the pinned *hashes* do not
move). It is used by the launcher (the final render and the viewer's lane: one
single control), `rt --denoise-strength` and the wasm
(`rt_denoise_with(preset, s, …)`; `rt_denoise` is `s = 1`). With `s = 0` a
final is not filtered (it carries neither flag 64 nor the noisy copy) and the
viewer's lane does not work. Changing the strength restarts the
viewer, like the rest of *Advanced*.

### 5.2 ter · Light selection (E12)

**Per point** (`rt_core::light`). Next-event estimation chooses
**one** light per vertex with probability proportional to a cheap bound on
the irradiance that each one, without occlusion, can give to the point `x` being
shaded: the flat, single-level case of the light tree of Conty
Estevez and Kulla (“Importance Sampling of Many Lights with Adaptive Tree
Splitting”, HPG 2018), with its orientation bound of §4.3. Weights at
`x`, all in W/m² with distances in metres:

| Light | Weight at `x` |
| --- | --- |
| Point, spot or IES | `lum(I) · mask(x) / max(d², r²)` (the spot's mask is exact: the model masks by direction from its centre; that of an IES light is the profile's intensity towards `x` over its peak, also exact) |
| Rectangle or disc | `lum(L) · A · cos θ' / max(d², A)` |
| Emissive mesh | the same from its centroid, with the cone of normals of its faces; two-sided or closed, `cos θ' = 1`, and it counts once (one face looks at `x`) |
| Sun | `lum(E)` |
| Environment | `π L̄` |

`θ' = max(0, θ − θo − θu)`, zero when `θ' ≥ θe = π/2`: `θ` is the angle
between the axis of the normals and the direction from the centre to `x`, `θo` the
aperture of the cone of normals (0 in a panel), `θu` the half-angle of the
sphere that encloses the light seen from `x` (`sin θu = r / d`; inside
it, any direction). Thus no light that can illuminate `x` from
any of its points has probability zero (an edge-on panel seen from its
centre counts). It is computed with dot products and roots
(`cos(a ± b)`), in `f32`, with no `sin`/`exp`/`powf` in the loop.

**Contract.** `Lights::select(x)` sums the weights at `x` and returns a
`Selection` (the vertex, that sum, the first eight weights and whether the
choice is by flux: 52 bytes, nothing the size of the light list);
`sample_selected` chooses with it, rebuilding the cumulative distribution
entry by entry, with the same operations as `build_cdf` and `pick`,
up to the light it takes (weights past the eighth are recomputed,
with the same operations). The
BSDF ray leaving the vertex carries it in `Scattered { pdf, from }`.
`crossed`, `crossed_from`, `crossed_without_photons`, `escaped`,
`escaped_environment` and `emitter_weight` receive it, and **a single
function** (`Lights::pmf`) gives the probability of a light in a selection
for next-event estimation and for the MIS weights: evaluated at
the vertex where the ray was sampled, also when it continues straight
through thin walls and cut-outs (straight events do not change `from`). From two to
`MAX_LOCAL_LIGHTS` = 64 entries (the cost per point grows with their number);
with more, every site uses the static distribution from before E12,
by flux towards the sphere that encloses the scene
(`Lights::select_by_flux`). With a single entry the choice is certain and
the image the same, bit for bit, per point or by flux (a test
checks it), so it is chosen by flux, at no cost.

**What stays by flux.** The photon emission of the caustics (there is no
point) and the **shadow catcher**: its shadow is the quotient of the light that
arrives and the light that a single sample would bring, whose value depends on how
the light is chosen; it keeps the static choice (its light sample and the MIS of
its BSDF ray) and keeps its look bit for bit. A shadow catcher that
accumulates the two sums per pixel and divides on resolve would not depend on the
choice (E13).
### 5.2 quater · Material graphs: the program, the interpreter and the noise (M3a, M3b contract)

**The model** (`core/material-graph.ts`, catalogue in `data/material-nodes.ts`).
A material in *Nodes* mode carries `graph: { version: 1, nodes, links }`:
each node `{ id, type, x, y, params, inputs }` (the parameters of its type and
the own value of each input that has one) and each link `{ from,
output, to, input }`, one per input, no cycles. The sockets are `float`,
`color`, `vector` or `normal`; the implicit conversions: number → colour
or vector, the three components equal (`F2V`); colour → number, Rec. 709
luminance (`VLUM`); vector → number, the mean (`VAVG`); colour ↔ vector and
normal → vector, the same three figures; nothing → normal except a normal.
An input with neither connection nor value reads a source of the point: `NORMAL` (N),
`UV0`, `OBJECT` (P · 0.01, the part's coordinates per 100 mm) or
`POSITION` (P, in mm: the point of the *Wood* and *Fabric* nodes, M3c).

**The nodes** (`data/material-nodes.ts`, stable keys): `OUTPUT`,
`IMAGE`, `MAPPING`, `NOISE`, `GRADIENT`, `CHECKER`, `STRIPES`, `RAMP`,
`MIX`, `MATH`, `FRESNEL`, `CURVATURE`, `VALUE`, `COLOR`, `SEPARATE_RGB`,
`COMBINE_RGB`, `INVERT`, `NORMAL_MAP`, `BUMP` (M3a) and `WOOD` and `FABRIC`
(M3c: E6's patterns as nodes, below).

**The compiler** (`core/material-program.ts`) walks the graph from the
output, compiles each (node, output) once, converts between types where
a connection requires it and gives each value a virtual register; then it
packs them: each value takes the lowest free register of its file when
written and gives it back after its last read (a destination never coincides
with an operand of the same instruction). What does not reach the output is not
compiled (except the preview probes). An output input
with no connection is a program **constant**, not an instruction. A
**bump** evaluates its height three times: at the point and at `BUMP_STEP_MM` =
0.01 mm along T and along B; the program itself moves P (`P + 0.01·T`) and the UVs
(`UV + 0.01·dUV/dT`, the same step for both sets). A 30-node graph
compiles in under 1 ms (test). Limits: **2048 instructions, 256
f32 registers, 256 vec3 (with the 9 of the point), 8192 constants, 16
images**; a graph that exceeds them gives no program but does give the reason
(`TOO_MANY_…`).

**Registers.** Two files: `F` (f32) and `V` (vec3, three f32). Before each evaluation the engine
fills the first nine vec3 with the point, in the
part's space:

| `V` | Name | What it is |
| --- | --- | --- |
| 0 | `P` | position, mm |
| 1 | `N` | shading normal, unit length, outwards |
| 2 | `UV0` | first UV set (u, v, 0); (0, 0, 0) without UVs |
| 3 | `UV1` | second set; the first if the mesh has one |
| 4 | `I` | unit direction from the point to the viewer (to the ray origin) |
| 5 | `T` | unit tangent: the direction in which UV0's u grows, orthogonalised against N; without UVs, `onb(N)` |
| 6 | `B` | N × T |
| 7 | `DUV_T` | (du/dT, dv/dT, 0) of UV0 per mm along T; 0 without UVs |
| 8 | `DUV_B` | (du/dB, dv/dB, 0) |

`onb(n)` (Frisvad revisited by Duff et al., *Building an orthonormal basis,
revisited*, JCGT 2017): `s = n.z < 0 ? −1 : 1` (written so: −0 gives 1),
`a = −1/(s + n.z)`, `b = (n.x·n.y)·a`, `T = (1 + ((s·n.x)·n.x)·a, s·b,
−(s·n.x))`.

**Instruction**: six 32-bit words, `op d a b c k`. `d a b c` are
registers (of `F` or `V` according to the code) or `NONE` (−1, `0xFFFFFFFF` in
bytes); `k` is an index into the constants (`#`), into the image table
or an immediate, according to the code. The codes are **stable**: a new one
takes a new number, none changes meaning.

**Arithmetic.** Everything in f32: **each operation rounds to f32 in the order
written** (explicit parentheses; no FMA). `sin`, `atan2`, `asin`, `powf`,
`exp2`, `log2` are those of `rt_core::fmath` (the same in TS:
`core/f32math.ts`, bit for bit); `floor` is the exact one; `min(a, b)` is `b < a
? b : a`, `max(a, b)` is `b > a ? b : a` and `clamp01(x)` is `x < 0 ? 0 : x >
1 ? 1 : x` (comparisons, never `f32::min`: a NaN passes the same on both
sides). `lerp(a, b, t) = a + t·(b − a)`; `smoothstep(e0, e1, x)`: if `e1`
is neither greater nor less than `e0`, `x < e0 ? 0 : 1`; otherwise `t = clamp01((x −
e0)/(e1 − e0))`, `(t·t)·(3 − 2·t)`.

| Code | Name | d | a | b | c | k | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | `NOP` | | | | | | nothing |
| 1 | `FCONST` | F | | | | # | `consts[k]` |
| 2 | `VCONST` | V | | | | # | `(consts[k], consts[k+1], consts[k+2])` |
| 3 | `FMOV` | F | F | | | | `a` |
| 4 | `VMOV` | V | V | | | | `a` |
| 5 | `F2V` | V | F | | | | `(a, a, a)` |
| 6 | `VLUM` | F | V | | | | `((a.x·0.2126) + (a.y·0.7152)) + (a.z·0.0722)` |
| 7 | `VAVG` | F | V | | | | `((a.x + a.y) + a.z)/3` |
| 8–10 | `VX` `VY` `VZ` | F | V | | | | one component |
| 11 | `VCOMB` | V | F | F | F | | `(a, b, c)` |
| 20 | `FADD` | F | F | F | | | `a + b` |
| 21 | `FSUB` | F | F | F | | | `a − b` |
| 22 | `FMUL` | F | F | F | | | `a·b` |
| 23 | `FDIV` | F | F | F | | | `b = 0 ? 0 : a/b` |
| 24 | `FPOW` | F | F | F | | | `a > 0`: `powf(a, b)`; `a = 0`: `b = 0 ? 1 : 0`; `a < 0` and `b` an integer (`b = floor(b)`, \|b\| ≤ 2²⁴): `±powf(−a, b)`, negative if `b % 2 ≠ 0`; NaN: NaN; otherwise 0 |
| 25 | `FMIN` | F | F | F | | | `min(a, b)` |
| 26 | `FMAX` | F | F | F | | | `max(a, b)` |
| 27 | `FSMIN` | F | F | F | F | | `m = min(a, b)`; `c ≤ 0` (or NaN): `m`; otherwise `h = max(c − \|a − b\|, 0)/c`, `m − ((h·h)·c)·0.25` |
| 28 | `FSMAX` | F | F | F | F | | `−FSMIN(−a, −b, c)` |
| 29 | `FABS` | F | F | | | | `\|a\|` |
| 30 | `FSSTEP` | F | F | F | F | | `smoothstep(b, c, a)` |
| 31 | `FMADD` | F | F | F | F | | `(a·b) + c` |
| 32 | `FLT` | F | F | F | | | `a < b ? 1 : 0` |
| 33 | `FGT` | F | F | F | | | `a > b ? 1 : 0` |
| 34 | `FFLOOR` | F | F | | | | `floor(a)` |
| 35 | `FFRACT` | F | F | | | | `a − floor(a)` |
| 36 | `FSIN` | F | F | | | | `sin(a)` |
| 37 | `FCLAMP` | F | F | | | | `clamp01(a)` |
| 38 | `FLERP` | F | F | F | F | | `lerp(a, b, c)` |
| 39 | `FINV` | F | F | | | | `1 − a` |
| 50–52 | `VADD` `VSUB` `VMUL` | V | V | V | | | per component |
| 53 | `VSCALE` | V | V | F | | | `a·b` per component |
| 54 | `VLERP` | V | V | V | F | | `lerp(a, b, c)` per component |
| 55 | `VCLAMP` | V | V | | | | `clamp01` per component |
| 56 | `VNORM` | V | V | V | | | `l = √((a.x·a.x + a.y·a.y) + a.z·a.z)`; `l > 0`: `a/l` per component; otherwise `b` |
| 57 | `VINV` | V | V | | | | `1 − a` per component |
| 58 | `VDOT` | F | V | V | | | `((a.x·b.x) + (a.y·b.y)) + (a.z·b.z)` |
| 59 | `VLEN` | F | V | | | | `√` of `VDOT(a, a)` |
| 70 | `BLEND` | V | V | V | F | mode | `t = clamp01(c)`; per component `x = a`, `y = b`, `r` according to the mode, result `lerp(x, r, t)`. Modes: 0 mix `y`; 1 add `x + y`; 2 multiply `x·y`; 3 subtract `x − y`; 4 screen `1 − (1 − x)·(1 − y)`; 5 difference `\|x − y\|`; 6 lighten `max(x, y)` (`y > x ? y : x`); 7 darken `y < x ? y : x`; 8 overlay `x < 0.5 ? (2·x)·y : 1 − (2·(1 − x))·(1 − y)` |
| 80 | `MAP` | V | V (P) | V (N) | V (UV) | # (9) | the coordinates of a projection: below |
| 90 | `TEX` | V (rgb) | V (uv) | F (alpha, or `NONE`) | | image | image `k` at `(a.x, a.y)`: below |
| 100 | `NOISE` | F | V | F | | # (5) | `fbm` of `a·b` (per component): below |
| 101 | `NOISEC` | V | V | F | | # (5) | three `fbm` with each channel's seeds |
| 110 | `GRAD` | F | V | | | type | `clamp01` of: 0 `x`; 1 `x > 0 ? x·x : 0`; 2 `smoothstep(0, 1, x)` as `(t·t)·(3 − 2·t)` with `t = clamp01(x)`; 3 `(x + y)·0.5`; 4 `1 − √((x·x + y·y) + z·z)`; 5 `(atan2(y, x)/τ) + 0.5` |
| 111 | `CHECK` | F | V | F | | | `s = ((floor(x·b) + floor(y·b)) + floor(z·b))`; `s − 2·floor(s·0.5)` (0 or 1) |
| 112 | `STRIPE` | F | V | F | F | # (2) | `q = a[axis]·b` (axis `consts[k]`: 0 x, 1 y, 2 z); `t = q − floor(q)`; `w = clamp01(c)`; `h = w·0.5`; `d = \|t − h\|`, `d = min(d, 1 − d)`; `e = (clamp01(consts[k+1])·0.5)·min(w, 1 − w)` (as `1 − w < w ? 1 − w : w`); `1 − smoothstep(h − e, h + e, d)` |
| 113 | `RAMP` | V | F | | | # | `x = clamp01(a)`; constants: `n`, interpolation (0 linear, 1 smoothed, 2 constant) and `n` stops (position, r, g, b) sorted by position (the compiler sorts them, stable). `n ≤ 1` or `x ≤ pos₀`: the first; `x ≥ posₙ₋₁`: the last; otherwise `i` the first with `x < posᵢ₊₁` (`i ≤ n − 2`); constant: the `i`-th; otherwise `t = (x − posᵢ)/(posᵢ₊₁ − posᵢ)` (smoothed: `(t·t)·(3 − 2·t)`) and `lerp` per component |
| 120 | `FRESNEL` | F | F (IOR) | V (n) | V (I) | | exact unpolarised dielectric Fresnel: `η = a`; `η ≤ 1` (or NaN): 0; `cos = clamp01(\|VDOT(c, b)\|)`, `g = √(((η·η) − 1) + cos·cos)`, `A = (g − cos)/(g + cos)`, `B = ((cos·(g + cos)) − 1)/((cos·(g − cos)) + 1)`, `clamp01((0.5·(A·A))·(1 + B·B))` |
| 121 | `FACING` | F | F (mix) | V (n) | V (I) | | `f = 1 − clamp01(\|VDOT(c, b)\|)`; `m` = `a` brought to [0.001, 0.999]; `f > 0 ? powf(f, (1 − m)/m) : 0` (mix 0.5: `f` as is) |
| 122 | `EDGE` | F | | | | # (1) | the part's convexity at the point, 0–1, within the radius `consts[k]` mm (measured by the engine, M3b; the reference gives 0) |
| 123 | `CAVITY` | F | | | | # (1) | the concavity, likewise |
| 124 | `NMAP` | V | V (colour) | F (intensity) | V (n₀) | space | `m = 2·color − 1` per component. Tangent (0): frame around `n₀`: `T' = T − (T·n₀)·n₀` (`T` of `V5`), if its length > 1e−6 `T'/\|T'\|`, otherwise `onb(n₀)`; `B' = n₀ × T'`; `VNORM(T'·(m.x·s) + B'·(m.y·s) + n₀·m.z, n₀)`, summed as `((T'ᵢ·(m.x·s)) + (B'ᵢ·(m.y·s))) + (n₀ᵢ·m.z)`. Part (1): `t = VNORM(m, n₀)`, `VNORM(n₀ + s·(t − n₀), n₀)` |
| 125 | `BUMP` | V | V (n₀) | F (dT) | F (dB) | | frame `T'`, `B'` around `n₀` as in `NMAP`; `VNORM(n₀ − ((T'·dT) + (B'·dB)), n₀)` per component |
| 130 | `WOOD` | V | V (p) | V (n) | | # (25) | M3c: the wood colour of recipe `k` at `p` (below); black if the recipe paints nothing |
| 131 | `WOODR` | F | V (p) | V (n) | F (r) | # (25) | `(c·rough) + sum`: roughness `c` times the wood's, plus that of a knot (`Tint::apply` before its `clamp`); without a recipe, `c` |
| 132 | `WOODH` | F | V (p) | V (n) | | # (25) | the surface height in mm (pores and knots below 0, bamboo's nodes above); without a recipe, 0 |
| 133 | `WOODN` | V | V (p) | V (n) | | # (25) | `n` bent by the slope of the relief `g` (differences of 0.02 mm along `Frame::from_normal(n)`): `t = g − n·(n·g)`, `normalize(n − t)`; without relief, `n` |
| 140–143 | `CLOTH` `CLOTHR` `CLOTHH` `CLOTHN` | as 130–133 | | | | # (25) | the same with the fabric of recipe `k` (the box projection by `n`; the height, a mix of the projections) |

A bump is compiled as `h₀`, `h_T` and `h_B` (the height at the point and at
the two steps), `dT = (h_T − h₀)·k` and `dB = (h_B − h₀)·k` with `k =
intensity·distance/0.01` (negative if inverted; the output's *bump*
uses `k = 1/0.01`: its height is already in mm), and `BUMP(n, dT, dB)`.

**Pattern nodes** (M3c: *Wood* and *Fabric*). The 25 constants of a
`WOOD*` or `CLOTH*` instruction are the recipe exactly as `PATN` stores it
(§5.2 octies): the two colours (linear), the scale in mm, the 16
parameters, the variant (figure or weave) and the seed (both, integers
read as `ToUint32`); the compiler computes them from the node's parameters
with the same function that writes the `PATN` of a material of those
families (`core/pattern-recipe.ts`: `ringDensity` rings per 100 mm times
`woodScale`, `threadCount` threads per cm, sizes in mm). An instruction
runs `rt_core::pattern::sample_at` (the same code as the family's
`PATN`, `pattern.rs`) at point `a` with normal `b`, which also chooses
the projection of a fabric; the outputs of the same node (the four of a
single recipe at the same point and normal) share the sample. **Where**:
the host gives the placement of each recipe (`Host::placement`, by `k` and
by type): in the engine, the family's on that instance (the mesh's
box frame with the pith along the long side, the instance's
scale and the knots placed with the surface test, when preparing
the scene); without a part (the reference, the cross-check), the space of the
point itself in mm without knots (`Placement::IDENTITY`: the pith is its `z`
axis); in *Fast*, that of the box of the material's parts with the knots
placed in the box (`core/material-preview.ts` `patternPlacements`). The
compiler connects the node's output normal only if the recipe has
relief (pores, bamboo nodes or requested knots; fabric with relief); otherwise,
the output is the normal of its input. A node's anisotropy is a
constant (0.3 along the grain, 0 in the speckle; 0.5 across the
top thread, 0 in the felt) and the direction is given by the host: the
engine stretches the roughness along the tangent that the program's first
pattern sample gives at that point (`Host::grain`), like that of a
`PATN`. TypeScript ports them step by step in `core/patterns.ts` (E6's noise
with its PCG32 permutation, the wood, the flow of the knots, the fabric),
bit for bit with the engine (cross-check).

**`MAP`.** Constants: projection (0 UV, 1 planar, 2 box, 3 cylindrical, 4
spherical, 5 object), axis (0 X, 1 Y, 2 Z), size (mm), cos and sin of the roll
(the compiler computes them: `fmath::sin_cos(roll_f32 · DEG_TO_RAD)`),
repeat u, v and offset u, v. The section axes (S, T, A) of the
axis: Z (x, y, z), X (y, z, x), Y (z, x, y). The coordinates before the roll,
`(cu, cv)`, and the centre `ce`:
- UV: `(uv.x, uv.y)`, `ce = 0`.
- Planar: Z `(p.x, p.y)`, Y `(p.x, p.z)`, X `(p.y, p.z)`, divided by the
  size; `ce = 0.5`.
- Box: the face that the normal looks at most (`|n.x| ≥ |n.y|` and `≥ |n.z|`: X;
  otherwise, `|n.y| ≥ |n.z|`: Y; otherwise Z), seen from outside without mirroring: X
  `(n.x ≥ 0 ? p.y : −p.y, p.z)`, Y `(n.y ≤ 0 ? p.x : −p.x, p.z)`, Z `(n.z ≥ 0
  ? p.x : −p.x, p.y)`, divided by the size; `ce = 0.5`. (One face, not
  M2a's mix by |n|⁴: a program is a point; *Fast* does mix and
  says so.)
- Cylindrical: `cu = turns(S, T)` with `turns = ((atan2(T, S) + π/2)/τ)`,
  `cu − floor(cu + 0.5)` (−0.5…0.5, 0 in front, towards −T); `cv = A/size`;
  `ce = 0.5`.
- Spherical: `cu = turns(S, T)`; `r = √((x·x + y·y) + z·z)`; `cv = r > 0 ?
  asin(A/r)/π : 0`; `ce = 0.5`.
- Object: `(cu, cv) = (S, T)/size` and the third `w = A/size`; `ce = 0`.
Then: `x = cu·ru`, `y = cv·rv`; result `((((cos·x) − (sin·y)) + ou) +
ce, (((sin·x) + (cos·y)) + ov) + ce, w)` (`w = 0` except in object). It is the
maths of `core/textures.ts` (M2a) in f32 (test).

**`TEX`.** The image table gives, per entry, the image (the index into
the scene's `IMGS` section in the engine; none: missing), whether it is sRGB and
the wrap (0 repeat, 1 clamp, 2 mirror). Without pixels: colour (1, 1, 1),
alpha 0. Otherwise: each coordinate is reduced before being scaled (non-finite: 0;
repeat: `u − floor(u)`; clamp: `clamp01(u)`; mirror: `u − 2·floor(u/2)`)
and `v` is read upside down (rows from the top): `ru = reduce(u)`, `rv =
reduce(1 − v)`; `x = (ru·width) − 0.5`, `y = (rv·height) − 0.5`; `x₀ =
floor(x)`, `fx = x − x₀` (likewise in y); the indices `x₀`, `x₀ + 1` (and those of
y) are brought inside with the wrap (repeat: modulo; clamp: to the edge;
mirror: period 2·n, `m < n ? m : 2n − 1 − m`). Each texel is decoded
before interpolating: the rgb of an sRGB image by the `SRGB_TO_LINEAR` table
(`c = byte/255`; `c ≤ 0.04045 ? c/12.92 : powf((c + 0.055)/1.055, 2.4)`, in
f32 with `fmath::powf`), that of a data image and the alpha as `byte/255`; then
`lerp` in x of the two rows and `lerp` in y. It is level 0, bilinear: the
engine will filter with mipmaps (M2b), the cross-check uses level 0. Since M2b
that read exists in the engine, at any level:
`rt_core::texture::image::TextureImage::bilinear` (and `sample`, trilinear, with
the *mipmaps* it computes when reading `IMGS`; §5.2 decies).

**The noise** (`core/noise.ts`; from K. Perlin, *Improving noise*, 2002, and
S. Gustavson, *Simplex noise demystified*, 2005; without the paper's
permutation table). The constants of `NOISE` are: type (0 Perlin,
1 simplex), octaves (1–8), lacunarity, gain and seed (0–65535), all
exact f32.
- *Hash* of an integer corner `(i, j, k)` and a seed (all u32, with
  32-bit products and shifts: `wrapping_mul`, logical `>>`):
  `h = (i·73856093) ^ (j·19349663) ^ (k·83492791) ^ (seed·0x9E3779B1)`
  (the primes of Teschner et al., 2003, and Knuth's constant), and the
  finaliser `lowbias32` by C. Wellons: `h ^= h >> 16; h ·= 0x7FEB352D;
  h ^= h >> 15; h ·= 0x846CA68B; h ^= h >> 16`.
- *Gradient*: `g = h & 15`, `u = g < 8 ? x : y`, `v = g < 4 ? y : (g = 12 or
  14 ? x : z)`, result `(g & 1 = 0 ? u : −u) + (g & 2 = 0 ? v : −v)`.
- `fade(t) = ((t·t)·t)·((t·((t·6) − 15)) + 10)`; `lerp(t, a, b) = a + t·(b −
  a)`.
- **Perlin**: if any component fails `|x| ≤ 1e9` (NaN included), 0.
  `xf = floor(x)`, `i = xf` as an integer; `x₀ = x − xf`, `x₁ = x₀ − 1` (likewise
  in y, z); `u, v, w = fade(x₀), fade(y₀), fade(z₀)`; the eight corners
  `gᵢⱼₖ = grad(hash(i + di, j + dj, k + dk), x_di, y_dj, z_dk)`; `a =
  lerp(u, g000, g100)`, `b = lerp(u, g010, g110)`, `c = lerp(u, g001, g101)`,
  `d = lerp(u, g011, g111)`; result `lerp(w, lerp(v, a, b), lerp(v, c,
  d))`.
- **Simplex**: the same limit. `F3 = f32(1/3)`, `G3 = f32(1/6)`; `s = ((x
  + y) + z)·F3`; `i = floor(x + s)` (likewise j, k); `t = ((i + j) + k)·G3`;
  `x₀ = x − (i − t)` (likewise y₀, z₀); the simplex by the order of x₀, y₀, z₀
  (x₀ ≥ y₀: y₀ ≥ z₀ → (1,0,0)(1,1,0); x₀ ≥ z₀ → (1,0,0)(1,0,1); otherwise
  (0,0,1)(1,0,1); x₀ < y₀: y₀ < z₀ → (0,0,1)(0,1,1); x₀ < z₀ →
  (0,1,0)(0,1,1); otherwise (0,1,0)(1,1,0)); `x₁ = (x₀ − i₁) + G3`, `x₂ = (x₀ −
  i₂) + f32(2·G3)`, `x₃ = (x₀ − 1) + f32(3·G3)` (likewise y, z); each corner:
  `τ = ((0.6 − x·x) − y·y) − z·z`, `τ < 0 ? 0 : ((τ·τ)·(τ·τ))·grad(…)`;
  result `32·(((n₀ + n₁) + n₂) + n₃)`.
- **Sum in octaves**: `sum = 0, norm = 0, amp = 1, freq = 1`; for each
  octave `o` (from 0): `n = base(x·freq, y·freq, z·freq, seed + o)`,
  `sum = sum + amp·n`, `norm = norm + amp`, `amp = amp·gain`, `freq
  = freq·lacunarity`; result `0.5 + 0.5·(sum/norm)` (about 0…1, mean
  0.5). The colour: three sums with the seeds `seed + 7919·(channel + 1)`.

**The outputs.** The program ends with fifteen references, in the order
of the output's inputs (`OUTPUT_KEYS`): base colour, metal, roughness,
anisotropy, clearcoat, clearcoat roughness, transmission, IOR, subsurface
scattering, emission, emission intensity, opacity, normal, bump (already
applied to the normal; its reference is the height) and bevel. Each is an
f32 constant (`FC`), an f32 register (`F`), a vec3 constant (`VC`) or a
vec3 register (`V`); the unconnected normal is `V1`. And two fields of the
material, not of the point: the absorption distance and the thin walls. The
engine (M3b) uses all of them except the subsurface scattering and brings each value to its
range (§5.2 undecies).

**Bytes** (`encodeProgram`, `decodeProgram`; little-endian): a header of
ten u32 (`0x4D475052` “RPGM”, version 1, instructions, constants,
images, f32 registers, vec3 registers counting the 9 of the point, outputs,
the absorption distance as f32, flags: bit 0 thin walls), the
instructions (six u32 each), the constants (f32), the image
table (three u32: index into `IMGS` or `0xFFFFFFFF`, 1 if sRGB, wrap) and
the outputs (two u32: type 0 `FC`, 1 `F`, 2 `VC`, 3 `V`; index).
**In the RSB** (M3b): one `PROG` section per node material, with these
bytes (*Material programs in the RSB*, §5.2); its `MATL` carries the **mean
of each output** over 64 points of a sphere (`core/material-preview.ts`
`flattenGraph`), which is all that an engine that does not run programs receives;
the bytes of a scene without graphs are the usual ones. The engine runs them
as §5.2 undecies says.

**The cross-check** (`tests/material-program.test.ts`). `contractPoints(n,
seed = 0x2545F491)`: an xorshift32 generator (`x ^= x << 13; x ^= x >>
17; x ^= x << 5`, all u32; a number is `(x >> 8)/2²⁴`) gives, per point and in
this order: P (`200·r − 100` mm, three times), N (`2·r − 1` three times,
normalised in f32: each component divided by the f32 length; +Z if it is zero),
UV0 (`2·r − 0.5` twice), UV1 the same, I (as N; N if it is zero), T =
`onb(N)`, B = N × T, dUV/dT (`0.02·r` twice), dUV/dB the same; each value
computed in f64 and rounded **once** to f32. For each example, the
32-bit FNV-1a of the f32 bits of all its outputs at the 1000 points
(output by output, component by component, point by point; the plastic with
label with the label of `core/material-examples.ts`) is pinned; the
Rust interpreter (M3b) gives the same ones, and M3b's cross-check
(`tests/material-program-cross.test.ts`, `tests/fixtures/material-programs.json`)
extends it to each instruction and the special cases, bit for bit.

**In Fast** (`core/material-preview.ts`, `render/graph-preview.ts`,
`render/graph-client.ts`, `render/graph-worker.ts`). The program is evaluated
in 512² maps (before, a 128² one, at once) in *workers* that share
the rows (`bakeRows`, joined with `finishBake`), over the surface that
`planBake` chooses: the UV square if it reads only UVs; the own surface of its
projection if a single one feeds it (the points of a plane, of the box's
front face, of a cylinder whose circumference is the size, of a
sphere, whose `MAP`s give exactly the texel's u, v), drawn with the
same projection and the transform fitted to the square that covers
the part (repeat/d, offset `(o + ½ − u₀)/d − ½`): it is the program,
resolution aside; otherwise, a cut by the part's front plane (y = 0)
drawn as a box. Fresnel and *facing* at 60° from the normal, curvature 0.
The colour, roughness, metal, opacity, normal (in the projection's
frame, for the derivative frame of M2a's *shader*) and emission (with
its scale as intensity) maps enter through M2a's slots with ids
`graph:<material>:<version>:<slot>` that `TexturePreview` serves as
`DataTexture`; the other outputs, their mean; a material's own image slot
wins over the graph's. The editor asks the first *worker* for its spheres
(`GraphPreviewPort`); a new request for a channel replaces the one that waits and
only one runs per channel.

### 5.2 quinquies · Pixel filter and edge samples (E11)

`rt_core::pixel_filter`. **Filter by importance sampling**: the
uniform position within the pixel that the sampler gives (`DIM_CAMERA`, two
dimensions) is shifted, axis by axis, with the inverse of the filter's CDF
(all four are separable); the sample weighs 1 and goes to its pixel, so the
image is still the mean of each pixel's samples and a tile does not
depend on its neighbours. *Standard* (0) is the position as is (the same
bits as before: the example, `0x8206111f` after E12, intact); *None* (1), 0.5 on both axes;
*Soft* (2), tent `1 − |x|` on `[−1, 1]`, inverse with two roots
(`f32::sqrt`, correctly rounded everywhere, wasm included);
*Fine* (3), Blackman–Harris of radius 1.5 px (Harris 1978, coefficients
0.35875 · 0.48829 · 0.14128 · 0.01168) with its inverse CDF in an `f32`
table of 256 values at `u = i/255` (`BLACKMAN_HARRIS_INV_CDF`; a test makes and
checks it, by bisection over the integral of the window in
`f64`) linearly interpolated: no `exp`, `sin` or `cos` when rendering.
The on-screen position (for the background image) is clamped to `[0, 1]`
when the filter reaches past the image edge.

**Edge samples.** `EdgeMask::of(scene, prepared, tile, isa)`
casts the centre rays (those of the exact passes, `centre_ray` and
`Exact`) of the tile and of a one-pixel ring around it (inside
the image) and marks as an edge the pixel whose 3 × 3 neighbourhood sees another part, another
material or a depth that differs by more than 2 %: it does not depend on how the
image is cut into tiles. `render_tile_edges` and `render_tile_albedo_edges` do
the usual outside the edges; at an edge, sample index `s`
is `k` samples of indices `s·k … s·k + k − 1` of the pixel's own sequence,
and **their mean is added once**. This way each pixel still has
one contribution per index (the film's weight, the hosts' sample counter,
the variance of the mean that *denoise* uses: all
unchanged), and an edge pixel ends up with `k` times the samples. The caustics'
photon map of `s` serves its `k` samples. Hosts
compute the mask once per tile: `rt` and the launcher in a
`OnceLock` per tile (the first one that renders it), the wasm in its loaded scene by
rectangle (`KEPT_EDGE_MASKS`, emptied when the scene is updated). In the example they are 1.8 % of the pixels. Pinned *hash* of the
example with *Fine + edges ×2*: `PINNED_E11_EDGES_4SPP` = `0xd01702ce` (with E12's light selection and E9a's energy compensation),
equal in scalar, SSE2 and AVX2, with tiles of 32 and of 23, through `rt` and the
launcher with 1, 4 and 16 threads, through the real `rt.wasm` (`wasm-parity.mjs`,
`rt --write-e11-example`) and through the page's code.

**In the interface** they are application settings (`engine.fastAa`, 4× by
default, and `engine.pixelFilter`, *Fine* by default: the same rays
as the box; `core/antialias.ts`): `PathTracerEngine` and
`NativeEngine` (`setPixelFilter`) put them in the view and in each render
(`TracerView.pixelFilter`, `.edgeSupersample`; gesture frames have
no edge samples), and its `status()` reports the filter of the image on
screen. *Fast*: `PreviewEngine.setMsaa(n)`; with the canvas's number of samples
(`antialias: true`, normally 4) it draws on the canvas as
always; with another, into a target of `n` samples (at most
`capabilities.maxSamples`) that three.js treats as the screen
(`isXRRenderTarget`: tone curve and sRGB in each material, background
colour in sRGB) stored in `RGBA8` without encoding or decoding, and
copies it as is to the canvas before the outlines and the *gizmo*.

### 5.2 sexies · Materials: energy, scattering media and dispersion (E9)

**Energy compensation** (`rt_core::bsdf::energy`, tables in
`bsdf/energy_table.rs`). Single-scattering GGX loses the light that
bounces more than once between microfacets (a white metal of roughness 1
reflected 0.356 in the *furnace*). The specular lobe (metal and opaque
dielectric) and the clearcoat carry the added lobe of Kulla and Conty (2017),
`F_ms (1 − E(μo)) (1 − E(μi)) / (π (1 − E_avg))` with
`F_ms = F_avg² E_avg / (1 − F_avg (1 − E_avg))` and Schlick's `F_avg`
`f0 + (f90 − f0)/21`, sampled by the cosine and with its density in the
MIS mixture. The clear part (Walter 2007) is divided by its own power albedo
`E_t(μo, α, η)` (Turquin 2019); with roughness, the microfacet is sampled
first and reflected with its own Fresnel (Walter 2007,
§5.3). The diffuse layer under the dielectric specular weighs
`(1 − E_s(μo)) (1 − E_s(μi)) / (1 − E_s,avg)` (Kulla and Conty), and under the
clearcoat, the product of the two transmissions normalised by their joint
mean (8-point Gauss–Legendre, `energy::joint_norm`). The tables are
ours: Monte Carlo with a fixed seed (Heitz 2018's VNDF, 64 × 64 *jittered*
grid per node, PCG), 32 × 32 nodes in `√μ` and `√α` (and 17
refraction indices entering and leaving for the clear part), in
16-bit fractions; one test regenerates them bit for bit and another measures the interpolation
error (< 0.5 % against 16 times the samples). Below
`α = 0.002` there is no compensation: roughness 0 keeps its bits.

**Scattering media** (`rt_core::integrator::medium`). A clear solid
(transmission, not thin wall, not metal, not emitter, `ior ≥ 1.0001`) with
`scatter_mm > 0` is filled with a homogeneous medium: `σt = 1/scatter_mm`,
`σs = albedo σt`, `σa = (1 − albedo) σt` per channel, plus the absorption of
`absorption_mm` and `base_color` if present. The path that refracts inside
does a random walk (Chiang, Kutz and Burley, SIGGRAPH 2016): distances
from a *hero* channel chosen once per walk with spectral MIS over the
three (Wilkie et al. 2014, ratios renormalised at each step), Henyey–Greenstein
phase and, after 32 events, Russian roulette on the walk's own weight
(what it has lost since entering: the path enters with the refraction's `1/η²`,
which the exit gives back).
**No next-event estimation inside.** A walk that does not scatter
crosses like clear glass; one that scatters, on reaching the boundary, is
reflected inwards with the exit Fresnel (total internal reflection included) or
leaves: the exit vertex is a surface vertex with a Lambertian
transmission lobe of albedo `η²` (`Bsdf::medium_exit`), where the
integrator samples a light with its MIS and continues with a cosine-sampled direction. At most 1024
steps per path (events and reflections at the
boundary); past the cap, the walk goes straight to the boundary keeping everything
except the absorption and leaves through the lobe. Media do not count against
`RNDR.max_depth`. All their numbers are *hash* dimensions beyond the
Sobol table (`sampler::medium_dim`, 8 per step), so a scene without
media does not change a bit. For the photon map a medium is a receiver:
it stores photons on its surface and none enter (`caustics::is_caster`);
the exit vertex gathers those on the outside of its surface.
**Thin walls around a medium** (an **approximation**): a shadow
ray from an exit vertex, and only from one, crosses a wall of
smooth glass (roughness ≤ 0.05, fully clear, with no clearcoat or medium of its own)
where light crossing it by refraction would leave less than 5 mm from its
entry through a face within 15° of the first, as if the two
refractions cancelled: it keeps the entry and exit Fresnel transmittances
and the wall's absorption over that stretch (its tint at each face
with no absorption distance), and continues in its direction from the exit
face; a thicker, rough or clearcoated wall still stops it. On a
slab of milk under a 3 mm plate, it ends up 2.0 % below the exact
path. For the MIS, a sample of the exit vertex's BSDF that
enters and leaves such a wall is a straight event of that vertex (it keeps
its density and its distance), so a light it finds behind weighs
against those shadow rays; with caustics, the light of a photon light
through a wall belongs to the map, as through any *caster*.
It is what lets the lights be seen by a liquid inside a jar from the side of the
jar; the exact solution (manifold NEE) is E13.
Pinned *hash*: the E5 scene with a medium in its rough glass sphere,
`PINNED_E9_MEDIA_4SPP` (`rt --write-e9-example`, `tests/fixtures/e9.rsb`),
equal on all SIMD paths, in WASI, in the real `rt.wasm` and through the
page's code. In the **Fast** viewer (`src/render/materials.ts`),
a medium is a translucent diffuse: the colour with which light returns
(van de Hulst similarity, `(1 − s)(1 − 0.139 s)/(1 + 1.17 s)` with
`s = √(1 − albedo)`) and a transmission that falls with how dense the
medium is for the part's size; the inspector's help says that Fast
approximates it.

**Chromatic dispersion** (`rt_core::integrator::dispersion`, E9c). A
clear solid without a medium with `abbe > 0` refracts each wavelength with
its index: the two-term Cauchy law, `n(λ) = A + B/λ²`, which passes
through `ior` at helium's d line (587.6 nm) and gives the Abbe number
`V = (n_d − 1)/(n_F − n_C)` (hydrogen's F line, 486.1 nm, and C, 656.3 nm). The
engine is not spectral: each channel is a band of
wavelengths (red 580–700, green 490–580, blue 400–490 nm). At the
first dispersive glass it meets, a path chooses a channel with
probability ⅓ and a uniform wavelength within its band, with a *hash*
dimension of its own (`sampler::DIM_DISPERSION`, `1 << 23`), and from
there carries only that channel, times 3, and refracts with that wavelength at
every dispersive glass; the expectation of each channel is that of refracting its
whole band. The caustics' photons do the same with their own
generator. A path that meets no dispersive glass stays white, so
a scene without any does not change a bit. The price is colour noise
where there is dispersion. Shadow rays do not cross glass (E5) and the
media's wall rule uses `ior`, without dispersion. Pinned *hash*:
the E9 scene carries, since E9c, a glass sphere of Abbe 40
(`PINNED_E9_MEDIA_4SPP`). In **Fast**, three.js's `dispersion`
(`KHR_materials_dispersion`: 20 / Abbe number, up to 2), only on solid
glass without a medium.

### 5.2 septies · Edge bevel in shading (E6)

The edges of a CAD model are mathematically sharp, and a sharp edge
catches no light. The bevel (`rt_core::bevel`, with the edges in
`rt_core::geometry::edges`) rounds the **shading normal** near
the mesh's sharp edges, as a rounding of radius
`MATL.bevel_mm` would, without touching the geometry.

**Sharp edges** (once per mesh, the first time an instance with
a bevel asks for them, and stored with the mesh, not per instance: they survive
updates without `MESH` like its BVH; `Mesh::sharp_edges`). Vertices are
welded by exact position and then by closeness, to within 10⁻⁵ of the mesh's longest
side on each axis (the seam of a lathe, whose last row repeats the
first except for the rounding of `sin 2π`), deterministically: cells of
two tolerances, set union with the smaller root, each group at the
smallest of its positions. An edge welded with **one** triangle is a
**border**; with **two**, it is **sharp** if their normals, oriented
coherently (two properly wound triangles traverse the edge in opposite
directions; otherwise one is flipped), differ by more than **20°**, unless
the mesh's vertex normals coincide on both sides at both
ends (to 2°): the mesh already shades it round; with **three or more** (non-
manifold, duplicate faces) it is ignored. Triangles without area do not count.

**Acceleration.** An own binary BVH over the segments (split at the
median of the centroids on the widest axis, leaves of 4), queried with
a sphere: the 8 nearest edges within 2 radii, visiting at
most 128 nodes. Each triangle also stores its **slack**, a lower
bound on its distance to the nearest edge (distance of the centroid
minus its farthest corner): a point far from every edge costs one
comparison. **Measured cost** (CPU time of one thread, minimum of three;
shared machine): the interface's example bottle with its default bevel of
0.303 mm, +3.1 %; the engine example with 0.3 mm, +0.7 %; the
E6 scene (parts of few triangles, all touching edges, bevels of
2 to 3 mm), +11 %.

**The normal.** With `n` the shading normal of the point, `n'` that of the
opposite face at the nearest point of the edge (its interpolated
vertex normals, or its plane), `θ` the angle between them, `v` the direction of `n'`
in the tangent plane of `n` and `d` the distance to the edge, a rounding of
radius `r` tangent to the two faces starts at `t = r tan(θ/2)` from the edge and
its normal is `normalize(r n + (t − d) v)` for `d < t`: that of the face at `t`,
the bisector at the edge (the same from both sides: continuous), and the
same formula holds for a concave edge (an interior rounding that fills the
corner). If the edge is sharper than a right angle, the footprint stays
at `r` and the radius falls to `r / tan(θ/2)`: the normal changes only within `r`
of an edge, whatever its angle. An open **border** rounds a
right angle outwards. **Several edges** (corners, and the segments of
a curved edge): each asks `w · v_i ≥ a_i` of the displacement `w` that is
added to `r n`, and the shortest `w` that satisfies all is taken (a
quadratic problem in 2D: at most two active constraints; all the
single ones and the pairs are tried). It is exactly the normal of a box rounded by a
sphere at a right-angle corner, and the largest of the requests (not their
sum) along a chain of nearly parallel segments, so a curved
edge does no arithmetic at its vertices. If they do not all fit (a wall or
a border thinner than about two radii), the radius falls at that point, by
bisection (16 steps), to the largest that fits: a thin edge becomes a half
rounding. The face of a neighbouring triangle counts as the point's surface
if its normal is within 25° and the point lies on its side of the edge;
an edge on the other side of a gap does not bend the normal.

**Space and scale.** Everything is computed in the mesh's space, with the radius
divided by the instance's scale `∛|det M|`. With non-uniform
scale the rounding is the transform of the circular one (elliptical in the world,
of mean radius `bevel_mm`) and the 20° angle is measured in the mesh's
space; the normal goes to the world through the inverse transpose like any normal.

**Shadows and reflections.** A real rounding lies below the faces
it replaces, so the light that reaches it from slightly below the
plane of a face (from the edge's side) is not blocked by the corner. The
rays leaving a bevelled point (shadow and next bounce) start from the
point lifted along the bevelled normal by `d · a_i / |r n + w|` (the
least elevation from which every direction above the rounding's tangent
plane clears the face, derived for a convex edge; the largest of
the active edges at a corner; the other edges of a chain do not
count), on top of the terminator elevation (RTG II,
`Geometry::terminator_point`). The surface's geometric normal becomes
that of the rounding (the bevel applied to the triangle's plane): the
integrator's test “a reflection leaves above the surface” is made against
the rounding. A bevelled normal that would face backwards (grazing views)
is bent towards the viewer up to a cosine of 0.01. The caustics' photons and the X2 normal pass
use the same normals and the same point (the *denoise* guide follows the rounded
bands); emitters have no bevel.

**Bias.** A bevelled normal is a shading normal like the interpolated
ones: the BSDF is evaluated in its frame for light sampling and for
BSDF sampling, so the MIS weighs both with the same densities, but
a shading normal is neither reciprocal nor exactly energy-conserving
(Veach 1997, §5.3): in a white furnace with a bevelled cube the image mean
comes out 0.99995 and the pixels between 0.988 and 1.014.

**Interface.** The material's *Edge bevel* field (mm) reaches the engine
as is (`materialToRsb`, all families except the emitter); the *Fast* view
(three.js) does not draw it and the field's note says so. Pinned *hash*:
the E6 scene at 4 samples, `0xfccda027` (`PINNED_E6_BEVEL_4SPP`, `rt
--write-e6-example`), and its six passes (`PINNED_E6_PASS_*`), equal on all
SIMD paths, in WASI, in the real `rt.wasm` (also through the
page's code, `tests/passes-engine.test.ts` with `tests/fixtures/e6.rsb`), with 1, 4
and 16 threads in `rt` and in the launcher. Scenes without a bevel do not change bits.

### 5.2 octies · Procedural patterns: wood and fabric (E6)

`rt_core::pattern`: the recipe of a material of the `WOOD` family as a
function of the point, with own noise (`pattern::noise`: gradient noise
written from Perlin's public description, “Improving Noise”,
SIGGRAPH 2002, with the 12 gradients of a cube's edges and the curve
`6t⁵ − 15t⁴ + 10t³`, and **our** permutation, a Fisher–Yates shuffle with
the engine's PCG and a fixed seed; only `+ − ×`, `floor` and integers: the same
bits everywhere; period 256, zero on the lattice, mean −0.0012 and variance
0.0730 pinned by test). A material carries at most one pattern (`PATN`
section of the RSB, 108 B, after the `MATL`s): it replaces its base colour point by
point, scales its roughness a little (and adds 0.1 at a knot), stretches it along the fibre
(anisotropy, with the shading frame's tangent in the direction of the
pith) and tilts the shading normal with its relief (a *bump*: the
finite differences of its height in the tangent plane, on top of the bevel and
the terminator). The geometric normal and the ray exit point do not
change. Camera paths and the albedo pass use it; the caustics'
photons see the material's plain colour (the wood is a receiver: the
colour with which the caustic is gathered is that of the camera path).

**Where.** In the mesh's space (it sticks to the part) and in millimetres
(the instance's scale `∛|det M|` converts). The pith runs along
the longest side of the mesh's box, at 0.8 of that side (at most
250 mm, the radius of a trunk, and at least 0.75 of the shortest side) below
the centre along the shortest side and at 0.35 of it (in the same
proportion) towards the `−` of the third axis: it never crosses the part. The
faces of a board show the arcs of the flat cut and its edges the streaks
of the quarter cut; a ball, nested arcs instead of a target (the centre of
its rings lies on its back and bottom face).

**Wood** (`pattern::wood`; **the lead's decision on the sheet**: everything in
physical millimetres). `ringDensity` is rings per **100 mm** (oak 3 mm,
maple 2.5, pine 5…; `woodScale` multiplies them). Figures (`PATN.variant`):
**0 rings**: cylinders around the pith; within each ring the
colour rises slowly from springwood to summerwood over
70 % of the ring and falls in its last 5 % (sawtooth); the two colours
approach their mean `0.6 light + 0.4 dark` until their Michelson
contrast over the luminance is the species' (`ringContrast`: maple,
birch and ash 0.15; pine, teak and cherry 0.25; oak, walnut and mahogany 0.35;
ebony 0.2), and summerwood occupies on average 40 % of the ring, so
the mean colour is still that of the *Fast* view. The rings meander
half a spacing with the catalogue's noises (wavelength 25 mm),
change width from one to the next and drift along the trunk; they
have no relief (they live in the colour). **1 strips** (bamboo, a grass): parallel
strips of the spacing's width, each with its mix of the two
colours and a darker joint; the vascular bundles as dark flecks along
the strip (0.4 × 3 mm, −10 %, about 15 per cm² on a face along
the strips: one per cell of a 0.816 × 0.816 × 4 mm grid, at
any point of its cell across so that every plane cuts the same ones)
and a node every 150 ± 30 mm of each strip (a 2 mm band across, −15 %,
0.02 mm in relief). **2 speckle** (MDF): no pattern, a fine
homogeneous speckle. **3 streaks** (ebony): faint rings under dark streaks along
the fibre. In all, **fibre**: ±5 % of colour at 0.3 mm across and
30 mm along, and a slow variation of brightness (`colorNoise`). **Pores**
of `poreSize` mm width and ten times as long, `0.15 × poreSize ×
poreDepth` deep (a vessel open along its length, half full of varnish: oak,
0.0225 mm): scattered (diffuse porosity: walnut, mahogany and teak,
medium, and walnut and mahogany half as deep; maple, birch and cherry,
very fine) or packed in each ring's springwood band, where they
draw lines (ring porosity: oak and ash, 0.3 × 3 mm); the band
enters in the first 4 % of the ring and leaves at 12 to 24 %, so that the pores
do not add a step along each ring. Pine, ebony and MDF have
none. Pores darken the colour and sink the surface. Roughness
drops 3 % in summerwood (more draws the rings as ridges in
the highlights).

**Knots** (`pattern::knots`, on request; ring figure only). A branch is born at the pith: in the wood it is a cone along
a line from the pith outwards, inclined 15–35° up the trunk, of
radius `r (0.5 + 0.5 s / s₀)` (half at birth; `s₀` where it was placed), and it is
seen where it crosses the surface: on the two faces it passes through, somewhat wider
on the one farther from the pith. It is not a decal. **Placement**: by
`hash01` of the material's seed (that of the wear), inside the part's box
in the wood's frame (along and across at one radius from the
ends, at any depth); a candidate whose cone would pass within
1 mm of another inside the part is tried elsewhere (32 attempts in
all), and one whose axis would cut the surface at less than 45° (axis against the
tangent plane, at each crossing with the mesh, found with the scene's
BVH; or that would not cut it) is drawn again, up to 8 times, and if not, is
discarded: they never touch or graze each other (a long teardrop on a ball), and in
a small part fewer fit than were requested (the inspector says so: “6 asked ·
3 fit”). A discarded knot is not replaced; more knots leave the first ones
where they were. **Around**: the fibre and the rings flow like a
potential flow around a cylinder: the across coordinate `a` becomes
`a (1 − R²/ρ²)` (the fibre wraps the knot and tightens at its sides) and the
rings bulge outwards `0.35 R (R/ρ)²`, both fading from
1.5 to 3 radii.
**Inside**: the knot's end grain, rings around the branch at three times the
trunk's density, `knotDarkness × 35 %` darker, a pocket of bark
at the edge (0.5 mm, −50 %), a 0.05 mm bowl, roughness +0.1, and in
those of 20 mm or more a radial crack from the centre (a 0.3 mm line,
−20 %). The interface (`src/core/knots.ts`) places the same knots with the
same *hash*, the same attempts and the same incidence test (against
the triangles of the part with that material, in f64: the same places to
thousandths of a millimetre). Since M3d the *Fast* view bakes the family's wood through
the graph that *Simple → Nodes* gives (`familyBakeGraph` in
`core/material-graph.ts`, the same bake as the *Wood* node: rings,
pores, flow and knots, the latter placed in the box of the parts,
`patternPlacements`); only without baking *workers* does it fall back to E6's
(`src/render/knots.ts`, a copy of the material per part that darkens the
knots, with their bark pocket, over the mean colour, without rings or flow).
Since M3e the knots are not in the bake: `programKnots`
(`core/material-preview.ts`) finds the first `WOOD` instruction (the colour
of a *Wood* node) that asks for knots, `BakePlan.knotless` carries the index of
its constants and `patternPlacements` places that recipe without knots; E6's
layer paints them on top, on each part, with `partKnots` and the knots of that
recipe (`graphKnotSpec`, the program's `f32`: the same for the family
and for the node), that is, where the engine puts them. A copy with knots is
redone when a bake arrives and recompiled when its base material
is recompiled (`base.version`).
With 0 knots the bits are those from before.

**Cost.** A dozen noise evaluations per point of a wood
part (two more for the pores' relief); each knot, a few dot
products per evaluation.

**Fabric** (`pattern::cloth`, `PATN.kind` 2; third part of E6). The recipe
of the `FABRIC` family in physical millimetres: `threadCount` is **threads per
cm** (cotton 40, denim 24, satin 100, canvas 14, knit 4 stitches per cm,
carbon 5 tows per cm…; `scale_mm = 10 / threadCount`). **Where**: a
box projection on the mesh's axes (it sticks to the part): the
plane of the two across axes of the major component of the interpolated
normal, blended with weights `|nᵢ|⁸` where two components are similar
(a narrow band, no seam); the warp runs along the plane's second
axis (upright on the sides, along `y` on top). **Weaves**
(`PATN.variant`): 0 plain (every crossing alternates), 1 twill 2/2 (diagonals),
2 five-shaft satin (the weft shows at one in five crossings, never two
together, nor on the diagonal), 3 canvas (2 × 2 basket), 4 knit (*jersey*: each stitch
a V of two elliptical legs pointing down, tilted 15°, that overlap
with those of the row above and of the neighbouring columns; each stitch, a
random mix of the two colours, a heathered yarn), 5 felt (no threads: matted fibres, an `fbm` of the size of
`scale_mm` and the two colours mixed over a few millimetres), 6 twill 3/1
(denim's: the warp on three quarters of the face). A thread is round
across (half a circle, 0.86 of the spacing, with a gap between threads)
and along its length rises where it passes over and falls where it passes under,
smoothly from one crossing to the next, with the ridges inclined by the
twist of its yarn (two per spacing, 12 % deep by `yarnTwist`, 0 in
carbon's tows and the mesh's monofilaments); the surface is
the higher of the two. Roughness is stretched **across** the thread on
top (anisotropy 0.5 with the across tangent, in the projection that weighs
most: the fibres' normals open across, as in a brushed metal); felt, with no threads, does not. Its height times `weaveDepth` and half a spacing is the relief (*bump*
by finite differences at 0.05 spacings, in each projection with its
weight); the slope does not depend on the scale. Each thread varies its colour ±6 %
and its roughness ±10 %; the ridges are lighter and the gaps darker,
normalised so that the mean colour is that of the threads mixed by the
part of the face each covers (measured: 0.5 in almost all, 0.72 in
satin and 0.685 in twill 3/1, `WEAVE_WARP_SHARE` in the interface): that of the
*Fast* view and the one the caustics' photons see. Threads finer
than a pixel (cotton at 0.25 mm in a wide shot) are averaged with
the pixel's samples, with no filter of their own: the colour converges to the mean and
the relief becomes roughness. The fuzz (`fuzz`, *sheen*) is not drawn.
The *Fast* view (M3e) bakes the family's fabric through the *Fabric* node
(`fastFamilyGraph` in `core/material-preview.ts`, the *Simple →
Nodes* graph like M3d's wood) only when a thread occupies at least
`FABRIC_MIN_THREAD_TEXELS` = 2.5 texels of the 512² bake
(`fabricThreadTexels`: `10 / threadCount` mm over the plan's texel, the
side of the cut through the front of the parts' box divided by 512); below that,
the usual mean colour, without moiré. On the bake (a *Simple*
material) the family's fuzz is applied (`applyFuzz` of
`render/materials.ts`, through the `finish` of `GraphBakes.apply`).

### 5.2 nonies · The traced lens (O2, `rt_core::optics::traced`)

With a prescription in `LENS`, the camera traces each ray from the sensor
through the lens's real surfaces (Kolb, Mitchell and Hanrahan 1995;
`docs/research/optics.md` §3 and §6):

- **Preparation** (`TracedLens::new`, when reading the scene and whenever
  the focal length, the aperture, the focus or the sensor change; if only the
  camera moves, it is reused): the prescription scaled to the requested
  paraxial focal length, with the indices of the three bands (two-term Cauchy from
  `nd` and `vd`; `ca_amount` multiplies the dispersion) and the transmission of
  each air–glass surface by its coating (T-stop and tint, no
  ghosts). Focus: *unit* (the sensor where the paraxial image falls),
  *internal* (bisection over the moving gaps), *floating* (the gaps
  follow the magnification) and *anamorphic* (`FOCUS_ANAMORPHIC`: the lens as
  a unit and the adapter's widest gap, by bisection, brings the
  horizontal meridian to the same focus). The camera position is the
  paraxial entrance pupil at infinity (the simple lens's perspective);
  the diaphragm gives the requested f/, never more open than the lens (and the
  catalogue's opens up to the fastest declared f/). The semi-apertures that
  the source does not give come from a paraxial marginal ray and chief ray and
  are widened with real rays of the framing (in both meridians) when
  those overflow. For 32 image heights a 24 × 24 grid is traced
  in the rear vertex plane in the three bands: the rectangle of what
  passes, with a cell of margin, is where sampling happens (§3.5), rotated to the
  sample's azimuth; the irradiance over a 40 × 40 grid gives the
  axis normaliser and the relative illumination.
- **Sample** (`TracedLens::sample`): one band per sample (decision 3,
  `DIM_LENS_BAND`; the three of a group share the pupil point),
  a point of the rectangle, the ray traced forward with rims and iris
  (the iris with exact shortcuts: inside the inscribed circle it passes, outside the
  circumscribed it does not), weight `A cos⁴θ / Z²` over that of the axis times the tint of the
  band. Stable intersection of §6.5 (`t = c r² / (B ± sqrt(B² − c² r²))`),
  normal without a root, Newton on the aspherics, vector Snell with the
  precomputed index ratios; only `+ − × ÷ sqrt`. A sample that
  the lens stops weighs black but keeps its own unclipped ray (for
  the coverage of a transparent background). The tile traces the samples
  of a row (the pixels that take a single one) in **batches of eight**
  (`traced::batch`, `render::camera_samples`): surface by surface, the
  eight lanes in *arrays* that the compiler vectorises, each with the
  operations of a single sample in their order, so the same bits (a
  test compares them lane by lane); E11's edge pixels and a lens
  with aspherics, one by one. The non-physical settings: the
  swirl rotates the rectangle, the distortion (`r (1 − k (r / field)²)`:
  negative is barrel) and the breathing move the sensor point, the
  vignetting weighs, the spherical is an aspheric plate at the diaphragm; the
  passes' chief rays (`TracedLens::chief`) use the same sensor
  point as the samples. An anamorphic is unsqueezed by the
  compression it traces to its focus; a lens without cylinders, by nothing (the
  simple lens's squeeze does not apply to it).
- **What the engine says** (`LensInfo`, `rt_scene_lens_info` of `rt_wasm`
  and `POST /api/lens/info` of the launcher, the same JSON): focal length at infinity and
  at the focus, **image scale** near the axis (`h = k tan θ`, with the non-physical
  settings: breathing at close focus is not distortion),
  flange distance, f/ in use and the fastest, T-stop, transmission per band,
  length, entrance pupil, elements and groups, the **design focal length**
  (`designEflMm`, O2c: that of the prescription as written, before
  scaling it; the lens editor shows its measurements at that scale), the squeeze of an
  anamorphic, the **distortion** against that scale and the **relative
  illumination** at 17 heights of the output frame (an anamorphic, on its
  vertical meridian), and the **cut** (`section`: each surface as
  it is traced, with its focused position, curvature in the horizontal meridian,
  semi-aperture and index; the iris in use and the sensor). The interface paints it
  without computing anything (rule 10): numbers, curves and the cut's SVG
  (`src/ui/components/lens-section.ts`), and the Fast viewer applies the scale,
  the distortion and the vignetting as an approximation (`render/lens-profile.ts`,
  stated in the meter).
- **Picking through the profile** (item 1.8 of the triage). The map from a point
  of the screen to that of the undistorted image it shows is in a single
  place, `render/lens-profile.ts`, in two languages side by side
  (`profileSource` and `PROFILE_GLSL`, the same steps with the same
  numbers from `profileUniforms`, the table read between its entries): through it
  draw the screen pass (`lens-filter-pass.ts`), the selection
  outline (the mask is read through the map, so the line goes around
  the part as it is drawn and measures one pixel everywhere) and the
  overlays (*gizmo*, glyphs, trajectories and, in *Full*, the selected
  faces: to a target like the canvas and from there to the canvas through the
  map), and they are inverted by `pick` (click-to-focus, select), the *gizmo*
  (`rayAt`; the drag measures in the undistorted image, where it is drawn
  before the map), `glyphAt` and `objectAt` (through `profileShown`, the map
  reversed by bisection), box selection (`Projection.shown` in
  `core/box-select.ts`) and the faces' id pass (each pixel of the
  screen reads that of its source). Without a profile (simple lens, or before the
  engine gives its numbers) the map is the identity. The profile is that of the
  camera being looked through: when looking through a light or another camera
  (L4) the active camera's is not applied.
- Pinned *hash* of the O2 scene (`example::o2_scene`: the example at f/2.8
  through the catalogue's double Gauss with seven curved plates and O1's
  background lights): `PINNED_O2_TRACED_4SPP` = `0x8f7d0ef8` (since the merge with
  E9; before it `0xe2e8e3ab`) on each SIMD path, in WASI, in the real `rt_wasm.wasm`
  (`rt --write-o2-example`, `tests/fixtures/o2.rsb`, in CI) and with 1, 4
  and 16 threads. Scenes without a traced lens do not move.
- **Cost** (`rt --lens-cost`, one thread, the fastest of three runs): in
  batches, the camera sample through the double Gauss costs 0.25 µs (0.71 µs
  one by one; 0.19 µs for the simple lens): in the example at 1024 samples it is
  13.7 % of the render (before batching, 29.1 %), below the 25 %
  of the cost rule.

### 5.2 decies · Image textures and labels in shading (M2b, `rt_core::texture`)

The engine paints in *Full* and in *Render* the slots and labels of M2a
where *Fast* paints them (`render/texture-shader.ts`), with the maths of
`core/textures.ts` in `f32` and `fmath`: both sides read
`tests/fixtures/texture-mapping.json` (projections and labels at
sample points; TypeScript pins it and Rust meets it to 2·10⁻⁵), and a browser test
(`tests/textures-full-browser.test.ts`) paints a sphere with checks through its UVs,
a rotated box with box projection and the jar's label in *Fast* and with
the real `rt.wasm` and compares where the squares and the label fall.

- **Images** (`texture::image`). They are stored as bytes in their encoding;
  the *mipmaps* are computed when the scene is read: each level half the previous one
  (rounding down, at least 1), each texel the box mean of the texels it
  covers of the previous level (fractional weights if a side is odd), in linear,
  stored in bytes again (sRGB through the nearest entry of the
  decoding table); the alpha, straight, like the GPU's pyramid. The lookup is that
  of M3a's `TEX` (§5.2 quater) at any level; the one of level of detail `λ`
  blends levels `⌊λ⌋` and `⌊λ⌋ + 1` (trilinear, L. Williams, *Pyramidal
  Parametrics*, 1983). `λ = log2` of the longest axis of the footprint in texels of
  level 0 (a GPU's isotropic filter).
- **Footprint** (`texture::shade::Footprint`). A camera ray carries its
  differentials (H. Igehy, *Tracing Ray Differentials*, SIGGRAPH 1999,
  written from the paper): those of `CAMR`'s pinhole camera (a thin
  lens, and the optics of O1 and O2, are treated as their pinhole: on the focus plane
  they change the same), carried to the point and projected onto its plane. After the
  first vertex, the width of the path's cone: that of the previous vertex plus the
  angle of a pixel times the distance, stretched by `1/|cos|` in the direction
  in which the ray leans (no curvature or roughness term: finer
  than ideal, which path integration averages). All at **a quarter
  of a pixel** (`FOOTPRINT_SCALE`): the tracer already averages samples over the
  pixel, and the whole footprint would blur it twice; a quarter leaves it as
  sharp as *Fast*'s filtered sample.
- **Slots** (`texture::shade`). In the part's space (the mesh; the
  instance transform carries the point and the vectors): colour ×
  base colour (on an emitter, × its radiance), roughness and metal × theirs (the
  channel, inverted if so stated), alpha × opacity or cut-out below the threshold,
  emission `tint × image × intensity` added to what the surface reflects.
  The box blends the texels of its three axes by `|n|⁴` of the interpolated
  normal before reading the channel. A normal map bends the shading normal
  in the frame of the surface gradients of the coordinates
  (`T ∝ ∇u`, `B ∝ ∇v`, both scaled by the larger, the frame that
  *Fast* builds with screen derivatives, M. Schüler 2013; with UVs, those of the
  triangle's UV; with projection, their exact ones), each axis of the box in its own
  and blended; a height map, `normalize(n − ∇ₛh)` by central
  differences of one texel of the level read. It works on the already bevelled normal
  (E6) and with the procedural pattern, turned to the part's exterior and back (the
  relief reads the same from both sides); the terminator point and the geometric
  normal do not change.
- **Labels**, in order: each over what is below by its alpha; its
  roughness and its varnish replace those of the surface in that proportion;
  under the coverage `A`, the surface keeps `1 − A` of its metal, its
  transmission (paper is opaque: a label on glass cannot be seen through)
  and its emission; the paper's edge bends the normal by the gradient of
  `Σ aᵢ · reliefᵢ · 0.15 mm`, with the label's rectangle included.
- **The integrator** reads them at each camera or BSDF hit on an
  instance with textures (`Prepared::textures`; particles have none),
  after the bevel and the pattern; a cut-out or a per-point opacity is seen by the
  camera ray and also by the shadow ray (an instance with an alpha image is
  traversable; the material of a cut-out or thin wall that a shadow ray crosses is read
  at level 0), and the albedo pass gives the colour with
  textures. An emitter whose radiance changes across the surface (colour
  or emission image, or labels) **is not sampled as a light**: it is found by the
  rays that hit it (unbiased, with more noise). The caustics' photons see
  the material without textures, as they see E6's patterns.
- **Cost and determinism.** A scene without textures does nothing new (its pinned
  *hashes* do not move); one with textures reads at most three
  coordinates per slot and two levels per lookup. The example
  `rt_core::example::m2b_scene` has its *hash* pinned
  (`PINNED_M2B_TEXTURES_4SPP`) on all SIMD paths, in `rt-cli` and `rt-app`
  with 1, 4 and 16 threads, in WASI and in the real `rt.wasm` (CI), and its six passes
  (`PINNED_M2B_PASS_*`).

### 5.2 undecies · Material programs in shading (M3b, `rt_core::program`)

In *Full* and in *Render* the engine runs the program of a node
material (§5.2 quater) at each hit, with the same bits as the TypeScript reference
interpreter (`core/material-interp.ts`): the cross-check
(`tests/material-program-cross.test.ts` writes and pins
`tests/fixtures/material-programs.json`; `program/tests.rs` runs it) consists of the
ten examples at 1000 points, each instruction in each mode at 200 and each
function in its special cases, at tolerance 0 (every NaN counted as
`0x7FC00000`: its sign and payload belong to the machine, and the engine does not read them;
`tests/program-hash.ts`), and the page runs the engine example's
programs the other way round (`PINNED_M3B_PROGRAM_VALUES`). A browser
test (`tests/programs-full-browser.test.ts`) compares where the patterns of the ten examples
fall in *Fast* and with the real `rt.wasm`.

- **Reading** (`program.rs`, `Program::decode`): the header, the
  instructions, the constants (finite), the image table and the outputs
  of `encodeProgram`; another version is `ProgramError::Version` (a newer
  file), and `Invalid` is an unknown code, an operand that nothing has written
  before, a destination that is an operand of its own instruction or outside its
  file (the 9 registers of the point are not written), a constant or
  image index out of range, a ramp of 0 or more than 64 stops, more than the limits, extra
  or missing bytes. `is_material` requires the fifteen outputs with vectors in the
  base colour, the emission and the normal.
- **Pattern nodes** (M3c, `program/shade.rs`, `pattern.rs`). Each recipe
  of the `WOOD*` and `CLOTH*` instructions of a program is placed on each
  instance when preparing the scene with `pattern::place` (what the family's
  `PATN` does: the mesh's box frame, the instance's scale
  and the knots with their surface test) and the host supplies it
  by `(k, type)` (`Host::placement`); an instruction runs
  `pattern::sample_at`, the same code as the `PATN`. The program's first sample with a
  tangent at the point reports it (`Host::grain`) and, if the
  resolved anisotropy exceeds 0, `Resolved::tangent` carries the grain (or
  thread) to the world and `Resolved::frame` gives the integrator the frame of
  `Tint::frame`. E6's pattern scene with its woods as nodes
  (`example::m3c_wood_scene`) gives the same bits as with its `PATN`. Bit 5
  of the capabilities, `FEATURE_PATTERN_NODES`: an engine without it does not know the
  codes and the page writes those materials as their mean.
- **Interpreter** (`program/interp.rs`, `Runner`). Register files on the
  stack, 256 `f32` and 256 `vec3`; no allocation while running (test); each
  instruction in `f32` without FMA, with `fmath` (the functions of `core/f32math.ts`)
  and the reference's order of operations. The noise (`program/noise.rs`) is
  M3a's: Perlin and simplex with the corner *hash* and the sum in octaves, with
  JavaScript's `Math.round` and `ToUint32` where the reference uses them.
  `TEX` reads with M2b's `TextureImage::sample` at the level of detail of the ray's
  footprint: the reads of one image through one `MAP` (its constants
  and its UV set), or through one UV set or a step from it (`VADD`),
  form a group, and the first measures the level (the `MAP`'s differences along the
  two axes of the footprint, with the seam of the cylindrical and spherical; or the
  change of the UV set) that the others repeat: the three heights of a bump
  are read at one level. Coordinates computed some other way, or a ray without a
  footprint (shadow rays), read level 0, which is the reference's reading.
  `EDGE` and `CAVITY` ask the `Host`.
- **The point** (`program/shade.rs`, `context`), in the part's space (the
  mesh; the instance transform carries the point, the direction and the
  normal): P; N, the shading normal (with E6's bevel) turned to the part's
  exterior; UV0 and UV1 (the second set is the first if the mesh has one;
  zero without UVs); I, towards the ray origin; T, the surface gradient of the
  first set's u orthogonalised against N (`onb(N)` without UVs); B = N × T; and the
  change of each coordinate of the first set along T and along B, per millimetre.
- **The material** (`resolve`): the scene's `MATL` with the point's base colour, metal,
  roughness, anisotropy, clearcoat and its roughness, transmission, IOR and opacity,
  each in its range (0–1; IOR ≥ 1); a value that is not a number
  leaves the file's. Subsurface scattering is not read (E9's medium belongs to the
  volume). An emitter (`MATL` of emitter type) takes `emission × intensity` as its
  radiance; any other material adds that emission to what it reflects.
- **The normal** of the program goes back to the world and to the side the ray arrived on;
  if it faces away from the viewer, it is bent to `MIN_FACING` on its side (like
  M2b's normal maps). The rays' exit point and the geometric
  normal do not change.
- **Bevel**: the output is a weight of the material's radius. Constant, it scales the
  radius for the whole part (`BevelSetup::shading_point_scaled`; 1 is the usual
  bevel bit for bit, 0 none); computed, the program runs at the unbevelled point
  for the weight and, if it is greater than 0, again at the point bevelled by
  it for everything else.
- **Curvature** (`BevelSetup::curvature`; E7 is not there): of the bevel's sharp edges
  within `r` mm of the point, `smoothstep(1 − d/r) · min(tan(θ/2), 1)`
  (θ, the angle between the faces), the largest of the convex ones (`EDGE`) and of
  the concave ones (`CAVITY`); 0 on a mesh without sharp edges. It is measured once per
  hit and radius.
- **The integrator** (`Prepared::programs`, `ProgramSetup`): at each camera or
  BSDF hit on an instance whose material has a program, after the bevel
  and before M2b's textures, which are applied over the program's material;
  a material with a program does not carry E6's pattern. An opacity that is not
  the constant 1 makes the instance traversable: the camera cuts out by it, and
  shadow rays (`walk`, S4b's straight crossing and a medium's exits)
  read the program's material at level 0 and without bevel weight. The albedo
  pass is the program's base colour; the normals pass, the bevel's. An emitter
  whose emission is not constant in the program is not sampled as a light
  (`emission_varies`, `light.rs`): it is found by the rays that hit it. Particles
  have no program and the caustics' photons see the `MATL`.
- **Cost and determinism.** A scene without programs does nothing new (its pinned
  *hashes* do not move; the same PNG as before). With programs, each
  hit runs its own (6 to 41 instructions in the examples; +41–47 % per
  ray with all the scene's parts carrying their graph, ROADMAP M3b). The example
  `rt_core::example::m3b_scene` has its *hash* pinned
  (`PINNED_M3B_PROGRAMS_4SPP`) on all SIMD paths, in `rt-cli` and `rt-app`
  with 1, 4 and 16 threads, in WASI and in the real `rt.wasm` (CI, and through the
  page's code), and its six passes (`PINNED_M3B_PASS_*`).

### 5.2 duodecies · Adaptive sampling and finishing by noise (E10, `rt_core::adaptive`)

**Rounds.** With `RNDR.adaptive` bit 0 the host renders in **rounds**.
The first gives `WARMUP` = 16 samples to all pixels with the usual tile
renderer (`render_tile_edges`: the sample index is the photon map's
iteration, as without adaptive; the exact passes and the
albedo are made only in it). At the end of each round, with all its tiles
rendered by however many threads, the **whole image decides the next one**
(`decide`): (1) the relative error of each pixel's mean,
`sqrt((E[l²] − E[l]²) / (n − 1)) / (max(mean, 0) + ε)` with the Rec. 709
luminance of the film's sums and `Film::lum2` (the variance of the mean
that *denoise* uses), `ε = EPSILON / 2^ev` (1 % of screen white,
`floor_for`), and `UNMEASURED` = 10³⁰ with fewer than two samples or non-finite sums; (2) smoothed by the 3 × 3 mean within the image; (3) per block
of `BLOCK` = 8 × 8 pixels, the largest; (4) **candidates**: the blocks above
the noise target (`RNDR.noise_threshold`; without it, any with
error) that have not reached the sample cap; the round goes to the candidates
at or above the **50 % quantile** of their errors (the threshold of the moment,
which falls as the image converges); without candidates, **converged**; (5) the
round lasts `ROUND` = 16 samples × `clamp(blocks / (4 × active), 1, 16)`,
never more than the active block with the fewest already has. A block without a
round keeps its samples and its mean: each pixel is the mean of its own
samples of indices `0..n`, in order (a test compares it bit for bit with the
uniform image of those samples). All `f32` in a fixed order: the decision
does not depend on threads, tiles or architecture. Decisions happen only at the
end of rounds, so where a round is cut into passes (by time,
by the live *denoise* lane, by any size) does not change a
pixel; after the first round the passes are of up to 16 samples.

**Caustics and edges.** In a pass all the active blocks are at the
same point of their round: sample `j` of each block's pass (index
`n_b + done + j`) uses the photon map `iteration + done + j`
(`Adaptive::iteration`): a pass traces as many maps as without adaptive and
two samples of a pixel never share a map. `render_block` is
`render_tile_edges` of a rectangle within the tile of its `EdgeMask`, with
whatever map it is given (whatever its iteration).

**Hosts.** `rt` (`render_adaptive`; `--adaptive`, `--noise P`) and the
launcher gather the tiles' films (`gather`) at the end of each
round; after the first, a pass's work is the active blocks of
all the tiles, which the threads share one by one (each block is cut
from its tile's film, `Film::cut`, rendered and returned with
`copy_region`: the same bits as rendering in it). The launcher publishes
each pixel's sums **rescaled** to the samples of the one with the most
(`rescale`: the sum as is if `n` is that, otherwise `(sum × (1/n)) × s` in
`f32`), so the page and `Frame::fitted` (U14) read them as usual, and its
frame (68-byte header, flag `FLAG_ADAPTIVE` = 1024) carries in bytes 52 to 68
the minimum and maximum of samples, the error of the noisiest block at the last decision, and the seconds it expects until the target
(what the decision says remains, in pixel-samples, at the pace of the last
pass; −1 without a target or unmeasured). *Finish by noise* reaches the launcher
as `finish=samples`: the cap is the samples and the RSB's target
ends it earlier. On the web, `src/render/adaptive.ts` is the **bit-for-bit port**
of the decision (`Math.fround` after each operation; `PINNED_E10_DECISIONS`,
of a synthetic image, checks it against the engine), `Accumulator` counts
per block (`blockSamples`, `addBlock`), the *workers* receive the message
`blocks` and render each block with `rt_render_block_rgba(… sample,
iteration …)` (the edge mask, that of its 32 tile), and
`runAdaptive` (`render/schedule.ts`) drives the *Render* rounds; the *Full*
viewer that follows the output's samples samples this way when the output
finishes by noise. `rt_adaptive_decide` exposes the engine's decision for
`tools/wasm-parity.mjs --adaptive`.

**Denoise.** `DenoiseInput::with_counts`: the sums and `lum2` rescaled to
`samples` and each pixel's own count, by which its variance is divided
(`n − 1`; below four, the spatial estimate); in wasm, the count plane after the fourteen usual ones (`DENOISE_WORDS_COUNTED`). Without
counts, the usual bits.

**Interface.** *Finish by* gains *Noise* (`FinishBy` `NOISE`,
`RenderSettings.noiseThreshold` in percent, 0.5–5, 1 by default;
`adaptiveOf` makes `SceneView.adaptive`/`RenderOptions.adaptive`). The
meter says *Adaptive · min–max samples* with the numbers of
`EngineStatus.adaptive`; the window's estimate comes from the last
pass of the viewer that samples at the same threshold (`ui.noiseEstimate`), and the
queue's progress, from the seconds the engine expects.

**Hashes.** `PINNED_E10_ADAPTIVE` = `0x264b4106` (E10's scene:
`e5b_scene` with a 3 % target, a cap of 48 samples and edges ×2, from 16 to
48 samples per pixel), equal through `rt` with 1, 4 and 16 threads, with tiles of
32, 24 and 13 and passes of 16, 5 and 3, through the launcher (final and viewer) with 1, 4 and
16 threads, through the real `rt.wasm` scalar and SIMD (`rt --write-e10-example`) and
through the page's code; without the *flag*, none of the earlier ones moved.

### 5.2 terdecies · The section view (Q1, `rt_core::geometry::section`)

The cutting plane is project data (`state.section`, SPEC §3.1) that
each engine reads in its own way and that gives **the same image**: the RSB carries it in
`SECT` (§5.2) already resolved at the animation instant
(`resolveSection(plane, offsetMm)`: `distance = normal · (point + normal ·
offset)`; the offset is the sum of the pose's `SECTION` clips,
`Pose.sectionOffsetMm`), and *Fast* puts it in a `THREE.Plane`. What
remains is `normal · p <= distance`.

**In the engine** the plane lives **inside `Geometry`**
(`Geometry::set_section`; the RSB reader and `Scene::build_particles` call
it, because a rebuilt geometry does not have it), and every query
(camera ray, secondary, shadow, photons, picking, passes, batches) sees it
without any of the SIMD kernels or the integrator changing:

- **Clipping.** A half-space cuts a ray into an interval
  (`Span::{Removed, Whole, Enters(t), Leaves(t)}`), and `t` has the same value in
  the world as in each mesh's space, so the clipped ray is an ordinary
  ray with another `t_min` and `t_max`. Without a section the path is the usual one
  (earlier *hashes* do not move: the scene without a plane is E5's
  bit for bit, and a plane that cuts nothing does not change a pixel either).
- **Cap.** A ray that crosses the plane has been outside every surface
  it did not hit, so whether the crossing is inside a solid is told by the
  **ray's own next surface**: if it finds it **from behind**
  (`Solid::inside_before`, by the triangle's winding with the
  instance's transform), the crossing was inside and there is a cap. A
  ray that enters on the side that remains reuses the same traversal (zero
  cost); one that leaves without having hit anything looks beyond the plane
  (`RayClass::Parts`: particles are not solids); a prior rejection by
  the box of the cappable instances (`cap_bounds`) leaves out almost all
  rays. The hit is `RayHit { instance, triangle: CAP_TRIANGLE
  (u32::MAX), t }`: flat, **on** the plane, with the plane's normal
  facing the ray, `front_face = outside = (normal · dir < 0)`; since it has no
  triangle there is no texture, pattern, program or bevel: the plain colour of the
  material (and a cut glass is a refracting interface, like a solid
  glass that ended there). A ray of finite `t_max` that enters inside a
  solid and ends before leaving does not see the cap (documented limit).
- **Solid** (`geometry/solid.rs`, once per mesh, `SolidCache` in
  `OnceLock`): vertices welded by exact position and then with tolerance
  `1e-5 ×` the extent; triangles without area do not count; each welded
  edge must be in exactly two triangles traversed in opposite
  directions; the signed volume (blocks of 256, relative to the centre of the
  box) says `Outward` or `Inward`; otherwise, `Open`. A part with per-face materials
  (`faceMaterials`) and a thin-wall glass are not capped
  (`partIsCapped` repeats the rule). `core/solid.ts` is the TypeScript
  twin (both read the same hand-made meshes from the tests).
- **The studio is not cut.** An instance with `INSTANCE_NO_SECTION` (the
  writer sets it, only while a plane cuts, on a set's parts:
  backdrop, floor and cards) is neither removed nor capped by the plane. Since the
  clipped ray cannot see it on the removed side, `exempt_in` walks that
  stretch inside the box of each exempt instance, stepping over
  the surfaces of the cut model (at most 48; `t` rises just
  above each one) until it meets an exempt one; a scene without exempt
  instances never enters there. Shadows see the studio from both sides.
- **Determinism.** The cap decision depends only on the meshes and on the
  plane: no time, threads or chance; the same *hash* with 1, 4 and 16
  threads, in scalar, SSE2 and AVX2, and in wasm scalar and `simd128`
  (`PINNED_Q1_SECTION_4SPP`, `rt --write-q1-example`, parity block of
  `engine.yml`).

**In Fast** (`render/section-preview.ts`): `renderer.localClippingEnabled`;
a single `THREE.Plane` in `clippingPlanes` of all the model's materials
(the identifier passes' included), with `Plane(−normal_three,
distance)` (three keeps `m·x + c >= 0`; the normal goes through `toThree`, the
only Y-up place) and **far away** (`1e9`) when there is no section: the
*shaders* do not change when it is switched on or off. While it cuts, the
model's materials are painted double-sided (an open mesh shows its
interior, as in the engine) and the **cap** is a second mesh, child of each
part that is a closed solid (`isClosedSolid`), with the part's geometry, back faces only (`BackSide`), the part's plain material with
`onBeforeCompile` setting the plane's normal as the normal and `polygonOffset −1`:
where the cut has removed the front face the back one is seen, which is the
cap (the equivalent of the *stencil*, without the second pass). A cut glass is
painted transparent (the refracting cap belongs to *Full*). The studio draws
with a copy of its material without the plane (`unclipped`, only while it cuts).
Click selection uses `firstKept` (the first hit on the side that remains;
that of a cap is the cut, with the point on the plane and its normal), the selection box
and the gimbal exclude the parts that the cut has removed
entirely (`removed`, looks at the vertices when the box ends up cut and stores
the answer), and the floor, the effects and the overlays do not carry the
plane.

**Interface** (UI.md §2.4, item *Section*): `ui/panels/insp-section.ts`,
`ui/section-commands.ts` and the viewer's `PickMode { kind: 'section' }`
click mode (own notice, `Esc` dismisses it, the first click of two points only
remembers the point). It is in the Scene inspector and not in the viewer's
bar because it is an object of the scene (it is saved, animated, seen in
Full and in Render), like the environment and the ambient.

### 5.2 quaterdecies · IES lights (L5, `rt_core::ies`)

**The reader** (`rt_core::ies`, `IesProfile::parse`; `src/core/ies.ts` is its
port). The format is the public text of IES LM-63 (1995 and
2002 editions, and the 1991 one without a version line): a header of `[KEY] value`
lines (`[MORE]` continues the previous one), `TILT=NONE`, thirteen numbers, the vertical
angles, the horizontal ones and the candelas. **Type C** photometry is read;
the vertical angles run 0–90, 0–180 or 90–180 and the horizontal ones are one
(round), 0–90 (four equal quadrants), 0–180, 90–270 or 0–360. **Type B and
type A are rejected** with their own message (converting them is a resampling of
the sphere that is not needed: any luminaire can be published as type C),
and so are `TILT=INCLUDE` and `TILT=<file>`. The reader is strict: counts that
do not match the numbers present (too few, the file is cut off; too many,
the counts are wrong), angles that do not increase, negative or non-finite candelas,
ranges the standard does not allow, more than 2 MiB or a table of all
zeros are errors with their message, never a guess. It accepts separators
as real files have them (spaces, tabs, commas, `\r\n` or `\r` line breaks).
The file's lumens, the number of lamps, the ballast factors and the
aperture dimensions are read and **not used**: the file gives the *shape*
(next section). **No manufacturer profile is shipped**: the two test files in
`tests/fixtures/ies/` are written by hand and each person brings their own.

**The distribution.** `IesProfile::intensity(γ, φ)` interpolates the candelas
**bilinearly** in the vertical angle γ (from the axis, 0° where the light points) and
the horizontal φ, with the non-uniform tables as they are, after reducing φ to the
range stored by the file's symmetry (quadrant, bilateral 0–180,
bilateral 90–270, full, round); outside the vertical range it is 0 (a
*downlight* sends no light upwards). With a direction in the light's
frame, `intensity_dir`: `+z` the axis, φ = 0 along `+y` (the light's
`up`) and φ grows from `+y` towards `+x`, counter-clockwise looking along the axis
from behind (as the standard draws the horizontal angle seen from above a
*downlight*); γ and φ come from `fmath`'s `atan2`, with no `acos` (which loses
precision near the axis). The **flux** (`IesProfile::flux`) is the integral
of that same function over the sphere, in closed form per cell (the trapezoid
is exact in φ, where it is linear, and the integral of `sin γ` times a
function linear in γ has a primitive): it is the flux of what is rendered, not an
estimate; for an isotropic profile it gives `4π c` and for 1000 cos² a sixth of
`4π · 1000` to the table's precision (0.5 % with 10° steps, 5·10⁻⁵ with
1° steps). `efficiency() = flux / (4π · peak)`.

**The light** (`LightKind::Ies`, `Light::ies`). It is the point or sphere light of
`power` W and diameter `size_x` with a per-direction mask, the same
mechanism as the spot: `mask(x) = intensity(direction from the centre to x in the
light's frame) / peak`, in [0, 1]. **The profile gives the shape and `power` the
level**: the light is as bright in the profile's brightest direction as
the point of `power` W (intensity `power / 4π` W/sr), just as a spot is as
bright on its axis as its point: a profile written for 500 lm and another for
5000 give the same image, and swapping a spot for an IES light or the reverse does not
move the exposure. `direction` is the profile's axis, `up` the origin of φ
(the page's writer sends the `up` with the light's roll: rolling the light
rolls the pattern). It is sampled by NEE like any sphere (filling cone,
delta position when it is a point, MIS with BSDF rays if *glossy*; the
mask is also evaluated for the camera ray and reflections). **Light
selection** (§5.2 ter, E12): per point, the weight `lum(I) · mask(x) / max(d²,
r²)` is exact; in the static selection (more than 64 entries, the shadow catcher)
an IES light **inside the sphere that encloses the scene** weighs by its flux
(that of the peak point times the profile's efficiency: its light goes to all
directions where the scene is) and outside it, like a spot, by the
intensity towards the scene's centre (`0.05 + 0.95 · mask(centre)`; the
file's flux is not the right measure there: a 10° beam aimed at the
scene, with little flux, is the light that counts most). It casts no caustics
photons (like the point and the spot).

**In the RSB and on the page.** `LGHT` 5 and `IESP` (§5.2). `LightInstance.type`
gains `'IES'` and `LightInstance.ies = { name, text, base }`: the file's text
(one character per byte), its name and the power with which it came in; the
inspector's multiplier is `power / base` (× 1 is the level with which
the light came in, calibrated like that of a new point: the mean of the lit
spots, so the image does not jump). It travels in the project (state JSON:
the `.repack` opens on another machine without the file; a profile that is damaged or
that the reader rejects is removed on opening and the light becomes a point), in the studios,
in a saved setup (`LightSpec.ies`) and in the library (the validator requires
a profile that the reader accepts). Its lumens are the flux of the peak point
times the profile's efficiency (`lightLumens`), not the lumens the
file states. **Fast approximates it** (the light's meter says so, rule 10) with
a three.js `SpotLight` with the axis intensity and a cone whose
transition equals exactly half the peak at the file's half-intensity
half-angle `β` (`iesSpot`: inner edge at `0.4 β`, outer
where `cos` is at half, at most 90°; a lamp that does not fall to
half is a hard-edged hemisphere): what is not seen is the whole profile.
The engine reads it **only when it says it can** (`rt_features` bit 3, value 8,
`rt_core::FEATURE_IES`; `render/engine.ts` `readsIes`; the *pool*, `NativeEngine`
and *Export engine scene (.rsb)* set it in `SceneView.ies`): for an earlier
engine the light goes as the spot that approximates it in Fast, which any
engine reads.

**Hashes.** `PINNED_L5_IES_4SPP` = `0x920f0be1` (`rt --write-l5-example`: the
example with its panel at a fifth and two IES lights, a 24 mm sphere
with the *downlight* profile and a warm point with the *wall washer* rolled
about its axis; 160 × 120), equal on each SIMD path, in `rt` with 1, 4 and 16 threads,
in WASI and in the real `rt.wasm` (CI and `tests/ies-engine.test.ts`); no earlier
hash moved.

### 5.2 quindecies · Interior cameras (K3)

**Projections** (`rt_core::scene::Projection`, `Camera::panorama_dir`).
`Standard` is the usual camera (pinhole, simple lens, traced lens or
orthographic); the two panoramic ones are pinhole (no lens, no *shift*:
`Camera::through_lens` is false) and start from `position` with the camera's
basis (`forward`, `right`, `up`). **Equirectangular**: longitude `(u − ½) ·
fov_x` to the right and latitude `(½ − v) · fov_y` upwards, direction
`forward cos φ cos λ + right cos φ sin λ + up sin φ`; with 360 × 180 the whole
2:1 image is the sphere. Equidistant **fisheye**: `x = (u − ½) · fov_x`,
`y = (½ − v) · fov_x / aspect` (in radians, square pixels), `θ = √(x² +
y²)` is the angle to the axis and the direction is `forward cos θ + (right x + up
y) sin θ / θ`; beyond `θ > π` there is nothing to see: the ray has an
empty interval and its sample weighs black (the image circle). The passes
give the distance (not the depth along the axis) as the depth of a
panorama, and the pixel footprints of particles, textures and caustics
take the cone of a pixel of the sphere. **The page** (`core/panorama.ts`) has
the same map and its inverse, and the preview draws it in GLSL from a
cube (`render/panorama-pass.ts`); the test is six directions of a quarter
of six colours in the image of the real `rt.wasm` and in that of Chromium. Rendering
a panorama in strips is K6's: today the engine renders it whole, by
tiles like any image.

**Visible to camera** (`INSTANCE_NO_CAMERA`, `PreparedInstance::camera_hidden`).
Only queries of class `RayClass::Camera` (primary rays and their straight
continuations through cut-outs and thin walls, the passes and the section
caps) and `RayClass::Seen` (the pick of focus with a click: the parts as
the image shows them, no particles) skip it (`RayClass::skips_camera_hidden`),
in the BVH, in brute force and in the caps; shadows,
bounces and reflections see it. It is the plan: the ceiling gives its light
and its shadow and the camera looks over it.

**Exterior multiplier** (`CAMR.exterior`, `integrator::exterior`):
multiplies the environment that a camera ray sees on escaping (also after
thin walls and cut-outs) and the shadow catcher's background; what the environment
illuminates does not change. 1 is exactly what it was before (the branch does not multiply).

**Straight verticals: on the page.** The engine knows nothing of them: the page
writes the levelled camera at the same position and the vertical *shift*
`−f · tan(tilt)` added to that of the optics, in the O1 `LENS` that
already existed (`core/interior-camera.ts` `renderedCamera`); the engine test reads
the file the page writes (`tests/fixtures/k3-verticals.rsb`) and measures
the vertical edges of a cube to 0.0001 px from parallel at 1920 × 1080
(6.4 px without *shift*).

**Auto-exposure: on the page.** `core/image-passes.ts` measures the accumulation's
sums (luminance in `f32`, `log2` from `core/f32math.ts`, sorted,
10 % at the bottom and 5 % at the top discarded, mean to 18 % grey, ±16, hundredths): the
same image gives the same exposure on any machine. The viewer redoes it
when the samples double and the final render measures its sums before
*denoise*. `RNDR.exposure_ev` carries only the compensation: the viewer, the
render and the queue convert the image with the exposure that the
page gives them, but a scene exported and rendered with `rt` outside the
application comes out without the measurement (a K3 limitation).

**Switch.** `rt_features` bit 4 (value 16, `rt_core::FEATURE_CAMERAS`);
`render/engine.ts` `readsCameras`, and the *pool*, `NativeEngine` and *Export
engine scene (.rsb)* set `SceneView.cameras`. For an earlier engine the page
writes the usual perspective camera, without `INST` bit 2 or the
exterior.

**Hashes.** `PINNED_K3_PLAN_4SPP` = `0x6efb1e66` (`rt --write-k3-plan-example`:
the box room of `example::k3_room` seen in orthographic plan
from above with the ceiling hidden from the camera and the exterior at 0.5; 96 × 72),
`PINNED_K3_PANORAMA_4SPP` = `0x96de8d73` (`--write-k3-panorama-example`:
128 × 64 equirectangular from inside, exterior 0.4) and
`PINNED_K3_FISHEYE_4SPP` = `0x9b85a1b6` (`--write-k3-fisheye-example`: 300°
fisheye, 96 × 72), equal on each SIMD path, in `rt` with 1, 4 and 16 threads,
in WASI and in the real `rt.wasm` (CI and `tests/interior-camera.test.ts`), and the
panorama also through the launcher's API with 1 and 4 threads
(`rt-app/tests/parity.rs`); no earlier hash moved.

### 5.2 sedecies · The tilted traced lens (O4, `rt_core::optics::traced::tilt`)

Since O4, `tilt_deg` and `tilt_axis_deg` of `LENS` also apply with a
prescription (the format does not change; before, the engine ignored them with a traced
lens, and the page writes the traced lens's own tilt,
`tracedTiltDeg`, not the simple lens's: an old traced camera does not
start to tilt). **A `LENS` with `tilt_deg = 0` never enters
the new code**: no pinned *hash* moves.

- **The rotation.** The lens rotates relative to the sensor about the camera's
  position (its entrance pupil at infinity: the perspective does not
  move), about the sensor-plane axis at `tilt_axis_deg` from the
  right and in the same sense as the simple lens (`forward` becomes
  `forward cos α' + b sin α'`). The sensor stays facing the camera's view
  and is placed where the lens forms the image of the **focus
  point** (`focus_dist` along the view): that point stays at the
  centre of the frame and sharp, and the frame does not rotate.
- **The angle.** `α'` is not the requested `α`: it is solved so that the lens's
  focus plane (the conjugate of the sensor plane through its paraxial
  optics; a collineation maps a plane to a plane: Scheimpflug and the
  hinge rule of a thick lens, Merklinger 1993 and Kingslake
  1992, ch. 4) tilts **the same as the simple lens's** of the same
  tilt, focal length and focus distance (normal
  `f·forward + u·sin α·b`). For each `α'` the lens is focused at the object
  `u cos α'` along its axis (O2's same focusing, unit, internal,
  floating, now in `focus_state`), and the paraxial transfer from the first
  vertex to the last (`Abcd`) gives the image of the focus point and the
  three-point conjugate of the sensor; 40 bisection steps on `α'`
  between 0 and 60°. This way the tilt means the same plane with both
  lenses, and the interface's plane drawing and plane through two points
  hold for both (`src/core/focus-plane.ts`). The engine reports the angle
  the lens takes (`LensInfo.tilt_deg`, `"tiltDeg"` in the JSON only with
  tilt).
- **Refocusing with real rays.** The paraxial image of the focus
  point does not see the field curvature of the lens where the tilt puts
  that point (at `f tan α'` from the axis): the sensor centre moves along
  its normal, with four secant steps, until the real rays of the centre
  (two pairs, at a fifth of the beam on each side of the chief
  ray in both meridians; their meeting point is computed as a line in
  depth, without the cancellation of two nearly parallel rays in `f32`) cross
  at `focus_dist`. The angle stays: away from the centre, the field
  curvature and the lens's astigmatism bend the plane as they bend that of the
  straight lens (it is its character; the tests measure it).
- **The samples.** A tilted sensor sees the rear plane through other
  rectangles than a straight one, and no longer only by image height: the
  bounds are traced on a 9 × 9 grid of sensor positions
  (`TILT_GRID`, 24 × 24 on the rear plane in the three bands, a cell
  of margin, as in O2) and a sample takes the union of the four surrounding
  nodes (without rotating to the azimuth). Each node's chief ray comes
  from eight Newton steps on the diaphragm point; the passes' and the selection's
  centre rays interpolate it. A sample's weight is
  `A |cos θ_rear|³ |cos θ_sensor| / Z²` over the straight lens's axis
  normaliser, the sensor cosine measured against its tilted normal
  (with the straight sensor it is O2's `A cos⁴θ / Z²`). The ray
  leaves in the lens's frame and is rotated to the camera's about the
  pupil. O2's batches (`sample_setup` and `sample_finish`) go through the
  same: the same bits as one by one. The derived semi-apertures
  are also widened for the displacement of the sensor centre.
- **What it does not do.** A lens with cylinders (the anamorphic adapter) rejects
  the tilt (*a traced lens with cylinders does not tilt*; the
  interface does not write it and says so); so does a lens whose light leaves towards `−z`. No `unsafe`, only `+ − × ÷ sqrt` and `fmath::sin_cos`: the same
  scene gives the same pixels on any platform and with any
  number of threads.
- **The shift** of a traced lens already moved the sensor in O2
  (`Lens::shifted` before `traced_film`); with tilt it is measured from
  the centre of the tilted sensor.

Pinned *hash* of the O4 scene (`example::o4_scene`: the O2 scene with the
double Gauss tilted 6° about the horizontal axis and shifted 2 mm to the
right and 3 mm down; `rt --write-o4-example`, `tests/fixtures/o4.rsb`):
`PINNED_O4_TRACED_TILT_4SPP` = `0x0b2fc327` in scalar, SSE2 and AVX2, in the
real `rt_wasm.wasm` through the page's code (`tests/lens-o4.test.ts`) and
in CI (`tools/wasm-parity.mjs`, with and without passes), and 1, 4 and 16 threads
(`rt-cli/tests/example.rs`). The sheet `rt --tilt-sheet <dir>`
(`rt-cli/src/tilt_sheet.rs`) paints lights on a receding floor, with
the simple lens and with the traced double Gauss, straight and with the
tilt that lays the plane down on the floor (`sin α = f cos β / h`), and
their 2 × 2 composite. There is no new bit in `rt_features`: the page
writes the traced lens's tilt the same with an earlier engine, which
ignores it.

### 5.2 septendecies · Click-to-focus and the focus that follows (F1, `rt_core::focus`)

The click of *Focus with a click* has to land on the exact pixel of the
exact view, and what is focused has to come out sharp in the engine's image. That is
why the engine answers the two questions, without repeating its camera in
TypeScript:

- **The ray.** `rt_scene_pick(handle, u, v, out)` writes 14 `f32` for the point
  `(u, v)` of the image (0 to 1, `v` downwards; a pixel's centre is
  `(x + 0.5) / width`): the **chief ray** (origin and direction, that of
  `Camera::generate_ray` with the pupil's `(0, 0)` point, that of the exact
  passes, `render::centre_ray`), and, if the scene has geometry, what it touches
  first (`Scene::pick`: only the parts, cut by the section, both
  faces of each triangle, glass and cut-outs included) with its `t`, its point,
  its instance, its depth and the distance that focuses it (NaN where there is none).
  The page gives it a scene **of the camera only** (`io/rsb.ts`
  `focusPickRsb`: the view's camera as `projectScene` writes it for the
  Full viewer, with the playhead's pose, the camera looked through with its
  own frame and the viewer's image around the frame) and casts the ray
  against the preview's geometry on both faces
  (`PreviewEngine.pickAlong`). Any projection the engine has (the
  thin lens with its shift, the traced one with its distortion and its
  breathing, the orthographic, and whatever comes) works this way with nothing more. A
  traced lens **breathes** (its field changes with the focus), so what the pixel
  shows moves a little when the focus reaches it: the pick is
  repeated with the camera already focused on what the previous one touched until the
  point moves no more than a micron (`render/focus-pick.ts`
  `settledFocusPick`; each round reduces the step by how much it breathes, a few
  hundredths, and by the fourth it is still). Without that, wide open, a click on the
  corner ended 0.9 mm of depth off on a surface at 45°. A
  camera whose rays do not depend on the focus (thin lens, tilt) touches
  the same point on the second pick and stops.
- **The focus.** `rt_scene_focus_at(handle, x, y, z)` returns the focus distance
  that brings the world point into focus (`Camera::focus_distance_to`):
  its depth along the axis (the thin lens, which focuses a plane
  perpendicular to the axis); with tilt, the distance whose hinge-rule plane
  passes through the point, `u (f − sin α (p · b)) = f z`; with a traced
  lens, the one that puts at the point its **best focus**, where the fine detail
  seen by the sensor point has most contrast
  (`TracedLens::film_position_through`, Newton on the chief ray;
  `TracedLens::best_focus`: a 32 × 32 grid of camera samples per
  band over the rectangle of the pupil that passes light from *that* point of the
  sensor, looked up right there and not in the render's precomputed strips, so
  that the viewer, with its larger sensor, and the render resolve the same; weighted
  by their weight and their part of the luminance; along the ray, between where
  the rays cross the chief ray, the distance of most modulation of patterns of
  10 and 5 line pairs per millimetre of the 36 mm frame (`FOCUS_LP_MM`; the
  mean of the two frequencies and of two directions, the frequency measured from
  the entrance pupil), the maximum nearest to the least squares (a
  sweep of 48 steps, uphill from there, and golden sections: with a single
  frequency, near the edge a side lobe, spurious resolution, sat
  above a weak main lobe and the focus came out 43 mm off), by
  the secant from the paraxial one with the lens refocused at each attempt
  (at most six, keeping the best), to 2·10⁻⁵ of the depth. The first criterion was
  the **circle of least confusion** (the least squares of the samples), and
  it does not work: wide open, spherical aberration spreads a halo that the least
  squares follow, and the render came out soft at the click (the fast double Gauss
  at f/1.4 with 135 mm at 600 mm has its least confusion at 601.5 mm and its
  contrast at 607–610 mm, where the render is sharp; a test checks it with
  the render's own camera samples through the focus). Measured: wide open,
  a traced lens puts its best focus millimetres from the paraxial plane, several
  depths of field; solving it costs 0.4 to 0.6 s in `rt.wasm` with the
  machine loaded.
- **K3's cameras** (§5.2 quindecies). The pick goes through `generate_ray`,
  so the orthographic, equirectangular and fisheye pick with nothing more; a
  panorama is pinhole, and its focus distance, like the depth of
  its pick and of its pass, is the distance to the point (also behind the
  camera). With straight verticals the engine receives the levelled camera
  (`renderedCamera`): the interface solves on it and stores that distance
  divided by cos(corrected tilt), which is what `renderedCamera` multiplies again.
- **With O4** (§5.2 sedecies). A tilted traced lens is solved with
  its own samples (`sample_setup` of the tilted lens, its grid of
  sensor bounds) in the camera's frame, like its chief ray; the interface's
  paraxial rule for it is the hinge one, the same
  plane that O4 asks of it. *Through two points* on a traced lens focuses at the
  mean of `exactFocusDistance` of the two points with the tilt
  resolved.
- **`frame_sensor_mm`** (at the end of `LENS`, after the prescription, optional):
  the output frame's sensor along its long side when the camera's
  covers more (the viewer's image). The traced lens takes from it what
  belongs to the frame's corner (the semi-apertures the source does not give, the height
  against which it measures its artistic distortion and vignetting, where it measures its
  squeeze), and not from the viewer's sensor: before, the Full viewer of a lens
  with distortion was not the render (2.3 mm against 1.0 mm at the corner with
  distortion +1). The page writes it only for the viewer; without it, the bytes and
  the image from before.
- **The interface** detects the two exports by name
  (`render/focus-pick.ts` `hasFocusExports`; no new `rt_features` bit,
  because they do not change what is read from the RSB): without `rt.wasm`, or with an earlier one,
  the preview's pick and the paraxial distance. The `core/focus.ts`
  solver (`setFocusSolver`) is that of `rt.wasm` on the page's thread
  for the frame's camera (`lensInfoRsb`), with the last 64
  answers stored; the frames of a gesture (`SceneView.focusFast`)
  use the last difference from the paraxial one for that lens instead of
  solving again. On the desktop the page carries its `rt.wasm`, the same
  `rt-core` that the launcher renders with.
- **What does not change.** None of this touches the render: no pinned *hash*
  moved. `focus::tests` pins the 20 picks of a grid of O1's scene
  (shift and tilt) and of O2's (traced lens, with its focus
  resolved), `PINNED_FOCUS_PICK_O1` and `PINNED_FOCUS_PICK_O2`, the same bits
  natively and in the real `rt.wasm` (`tools/wasm-parity.mjs --pick`, in CI).

### 5.2 octodecies · Drops and the front glass (S3, `rt_core::geometry::particles`, `rt_core::optics::glass`)

Request (item 1.2 of `TODO.md`, decided in *Judgement calls*):
in *Ambient*, a drop shape and particles that do not all have the same
geometry. And the part of S3 that is a still picture without simulation: the glass in
front of the lens with drops and dust.

- **The drop** (`Shape::Drop`, code 3 in `FXAM.shape`). A body of radius
  `r` (the particle's) at the centre `c` and a tip of radius
  `drop_tip · r` at `c + a`, with `|a| = drop_tail · r` (at least
  `1 − drop_tip + 0.05` radii: a tip inside the body would be a sphere):
  the two spheres and the cone tangent to both (half-angle `β`,
  `sin β = (r − r_p) / |a|`). In the plane through its axis, the cone is
  `ρ cos β + s sin β = r`, a quadratic in the ray's `t` solved
  from the point of the ray nearest to `c` (a tiny, distant drop
  keeps its digits, like Haines et al.'s sphere); the body counts
  where `s < r sin β`, the cone between that and `|a| + r_p sin β`, the tip
  beyond. Every root that is kept lies on the border of the convex drop, so the
  nearest in the interval is the entry or, from inside, the exit, as
  in the capsule. The normal is that of the part where the point falls; a test
  compares it with the gradient of the exact distance (`drop_distance`) and the
  hits with a march of that distance. **Minimum size**: for camera
  rays a fine drop is scaled whole about its body (the widened radius
  over the real one), so its coverage is the square of the scale,
  like a sphere's, and the camera boxes grow with the length of the
  longest drop (`drop_reach`).
- **The mix** (`mix`). `rt-sim` draws each particle's shape once
  with `mix64(base ^ SALT_SHAPE)` and assigns it by the weights; each shape's
  axis is its own (zero, the normal of the disc that spins, half the streak,
  the drop). `ParticleSet` stores the shape of each slot only when they are
  mixed; the integrator asks per particle whether it is a disc (thin wall) and
  per set whether all are (no medium inside). `rt_particles_shapes`
  gives *Fast* each one's shape (`shapes_hash`, pinned with
  `PINNED_S3_DROPS_SHAPES`); `positions_hash` does not include them and remains
  S4a's.
- **The front glass** (`GLAS`, `optics::glass::FrontGlass`). An ideal
  plate perpendicular to the axis, at `distance` from the camera: it neither bends nor darkens
  any ray (a coated glass), so with nothing on it the image is that of
  no glass, bit for bit (test, with the passes). What is on it is real
  geometry that camera rays cross before reaching the scene: **drops**,
  spherical caps of water on its outer face (the ball of radius
  `a / sin θ` whose centre lies `R cos θ` behind the plate, cut by
  it) which the ray enters through the base (refracted from air to water: the
  thin glass in between does not change the direction) or through the dome, and leaves through
  the dome (Snell; the weight, the exact Fresnel transmittance) or, by
  total internal reflection, bounces inside first; one that comes out again through the base
  goes towards the camera and brings nothing, like one that bounces more than 8 times. The
  light that a drop reflects is not followed (almost all of it would go back to the lens).
  A drop a few centimetres from the sensor is a strong lens: through a
  lens focused far away it is a soft disc with the scene upside down inside and
  a dark edge. **Dust**: discs on the plate that let through
  `1 − opacity`. **Where**: the plate is split into cells of four mean
  diameters in its own coordinates (mm to the right and up from the camera) and
  each cell draws its drops from *hashes* of (seed, cell, index): how many,
  from the requested coverage (the fraction by a Bernoulli draw), where,
  uniform in the cell, and of what size, `± size_var`. Only the cells that
  rays can cross (the half-field of the long side, at least 45°, times the
  distance, plus the aperture radius and the shift): changing the
  focal length or the image size moves no drop, and a viewer image wider than the
  frame has the same ones. Drops that touch **merge** into one of their summed volume
  (that of a cap at a fixed angle is
  `a³` times a constant: `∛(a₁³ + a₂³)`) at their centre of mass, in passes
  in a fixed order until none touches another. All with `+ − × ÷ sqrt` and
  `fmath`.
- **What sees it.** The image's camera rays (in `render_tile_traced`,
  after the lens and its filters), the albedo and the alpha of their samples
  (a blocked one is dark and opaque), and the screen position of a ray
  that a drop bent is recomputed from its direction for the background image.
  A connection of O3a's filters with a light that the glass would change is
  left out. The exact passes do not see it (their rays go through the centre of each
  pixel and of the lens to the scene), nor the focus picks, nor a panoramic
  camera, which has no front element.
- **Switch.** `rt_features` bit 6 (value 64, `FEATURE_DROPS`; on the page
  `render/engine.ts` `readsDrops` and `SceneView.drops`): without it the writer
  sends a drop as a sphere, a mix as its heaviest shape, no S3
  field and no `GLAS`.
- **Pinned.** `PINNED_S3_DROPS_4SPP` (the drops and mix scene,
  `example::s3_drops_scene`), `PINNED_S3_DROPS_PARTICLES` and
  `PINNED_S3_DROPS_SHAPES`, and `PINNED_S3_GLASS_4SPP` (the example at 28 mm f/8
  through a wet and dusty glass, `example::s3_glass_scene`); the
  same in scalar, SSE2, AVX2, with 1, 4 and 16 threads and in the real `rt.wasm`
  (`tools/wasm-parity.mjs --expect-shapes`, in CI). No earlier pinned value
  moved.

### 5.2 novendecies · Rain and dust on the front glass (S3b, `rt_phys::wet`, the end of `GLAS`)

S3's front glass (§5.2 octodecies) fed by the scene's effects:
a fixed-step simulation in `rt-phys`, in S2's physics *worker* with the bodies (or alone), recorded in a `PHYSICS` clip of the camera (the
cache) and sent to the engine drop by drop.

- **WET1** (`rt_phys::wet::WetSpec`; written by `src/core/wet.ts`
  `wetBytes`): `"WET1"`, version 1, seed, the half-side `h` of the square
  of the glass that the render's rays cross (the engine's, `FrontGlass::
  half_extent_of`, which the page asks of `rt_scene_glass`), gravity in the
  glass's axes (right, up and outwards from its outer face: those of
  `Camera::basis`, which the page rebuilds with `paneAxes`), the advancing
  and receding angles of the water and the angle of repose of the dust, and per source its class
  (drops or dust), its density (per mm³), its mean velocity in those axes
  (mm/s), its size and its variation.
- **The model** (`WetPane`, see the module's documentation). Per step
  of 1/240 s and source, a Poisson draw (by inversion, from `mix64` of the
  seed, the step and the source; means above 32 in parts) of mean
  `density × max(0, −v_n) × 4h² × dt`; each particle, uniform in the
  square, with its size. Drops: caps of volume `π D³ / 6` at the
  mean angle `θ̄` (`a = ∛(V / K(θ̄))`, `K` that of `optics::glass::cap_volume`); those
  that touch merge with `optics::glass::merge_drops`. Anchored while
  `ρ g K a³ sin α ≤ 2 γ a (cos θ_R − cos θ_A)` (Furmidge 1962; `sin α`, the
  gravity along the glass); above that they slide downhill at
  `v = (excess) / (C μ a)` (at most 250 mm/s), lose the water of their trail
  (a 2 µm film of the drop's width) and take with them the specks whose centre
  lies within `a` of their path (a grid of 2 mm cells); a drop
  whose centre leaves the glass is gone. Dust: a speck that arrives stays with
  probability 1 below the angle of repose minus 5°, 0 above it plus 5°,
  a smooth ramp in between (and 0 on a face that looks downwards).
  Water constants at 20 °C; `SLIDE_DRAG`, `MAX_SLIDE_SPEED`,
  `TRAIL_FILM_MM` and `REPOSE_SPREAD_DEG` are proposals (◆). All `f32`, `+ − ×
  ÷ sqrt` and `fmath`, in a fixed order: the same glass on any machine.
- **A frame's record** (`WetPane::frame`, `wet_frame`): the drops
  (`x y a`), the specks arrived since the previous one (with the index of the
  first) and those that left (their indices). The page
  (`GlassTrackWriter`) gathers it into the clip's **glass track**
  (`MotionClip.glass`: each frame's drops and each speck with the
  frame in which it arrived and the one in which it left, in base64), with the **key**
  (`wetKey`: FNV-1a of the WET1 bytes and the version): the same key
  gives the same track, bit for bit.
- **The end of `GLAS`** (`optics::glass::GlassLayout`, bit 7 of
  `FEATURES`, `FEATURE_GLASS_LAYOUT`): after the 48 B, `u32 1`, the number of
  drops and of specks and their `(x y a)` and `(x y r)`. The reader takes them as they are
  (it neither scatters nor merges them again: `FrontGlass::laid_out`), with the
  contact angle, the index and the opacity of the 48 B, whose coverage
  fields go to 0: an S3 engine reads up to byte 48 and draws a clean
  glass, so the page sends the scene-fed glass only to
  an engine with bit 7 (`SceneView.glassLayout`, `render/engine.ts`
  `readsGlassLayout`), the frame that the playhead's *pose* says
  (`Pose.glass`, `core/wet.ts` `recordedGlass`). A glass with an empty list
  is clean: the image does not change a bit (test, also through an RSB).
- **In the *worker*** (`render/physics-worker.ts`): `run` carries the PHY1 (or
  nothing) and the WET1 (or nothing); both advance the same steps, each frame
  sends its poses and the glass record, and a simulation with glass is
  not considered settled (only *Stop* or its `MAX_GLASS_SECONDS`). `rt.wasm`
  exports `wet_new`, `wet_free`, `wet_step`, `wet_steps`, `wet_hash`,
  `wet_frame` and `wet_frame_copy`, over a registry of glasses by *handle*
  (`rt-wasm/src/wet.rs`), and `rt_scene_glass_len` / `_copy` (the distance, the
  half-side, the contact angle, the index, the dust opacity and the drops
  and specks that the engine places for a scene).
- **In *Fast*** (`render/glass-overlay.ts`, the `GLASS` step of
  `lens-filter-pass.ts`): three maps over the glass in its millimetres (the
  part of each cell under drops, under their total-internal-reflection edge —from
  `1 / (n sin θ)` of the radius— and under dust by its opacity), with two boxes of
  half-width `0.61 R` (the disc's variance) times the footprint of a pixel
  `R = (f / N / 2) |1 − d / s|`; the *shader* takes each pixel to the point of
  the glass of its chief ray through the camera's projection (`paneMapping`)
  and mixes the image with the blurred image (by the mean size of the
  drops on screen) by the drops, and darkens by the edge and by the dust.
  Always from the engine's drops and specks; the meter says it is an
  approximation.
- **Pinned.** `PINNED_WET_PANE = 0x5e511523` (the glass of
  `rt_phys::example::wet_spec` after 5 s, `tests/wet.rs`) and
  `PINNED_S3B_WET_4SPP = 0x6e6e370c` (`example::s3b_wet_scene`: the example at
  28 mm f/8 through that glass, drop by drop): the same in scalar, SSE2
  and AVX2, with 1, 4 and 16 threads, in `wasm32-wasip1` (scalar and simd128) and in the
  real `rt.wasm` (`tools/wasm-parity.mjs` with `rt --write-s3b-wet-example`;
  `tests/s3b-wet.test.ts` with `tests/fixtures/s3b-wet.wet1` and `s3b-wet.rsb`).
  No earlier pinned value moved.

### 5.2 vicies · Rain, dust and snow on the parts (S3c, `rt_phys::wet_parts`, `WETP`)

The front glass model (§5.2 novendecies) carried to the meshes of the
parts: a fixed-step simulation in `rt-phys`, in the physics *worker* with
the bodies and the glass (or alone), recorded in a `PHYSICS` clip of the scene (the
cache) and sent to the engine, instance by instance, in the `WETP` section.

- **WPT1** (`rt_phys::wet_parts::PartsSpec`; written by `src/core/wet-parts.ts`
  `wptBytes`): `"WPT1"`, version 1, seed, the sample cell (mm, the
  smallest), the sample budget, the angles of repose of dust and of
  snow; the meshes (positions and triangles); the parts (their mesh, their
  object-to-world 3 × 4 row-major matrix, the advancing and receding angles, how
  much it soaks up per second and the film mark, `PART_FILM`); the sources (drops,
  dust or snow, density per mm³, mean velocity in the world in mm/s, size and
  its variation). The page gives the visible parts that the simulation does not move,
  where they are at the start (`wetPartsSpec`; the set's, film), and each effect
  with `wetParts` according to `PARTS_FEED`.
- **The samples.** Each triangle carries a grid of `R` steps per side (the
  samples `(i, j)`, `i + j ≤ R`, at the barycentric weights
  `(1 − (i + j)/R, i/R, j/R)`, row after row: `sample_index`), `R` the longest
  edge divided by the cell, but no more than twice the side of the square of its
  area (`resolution_of`: a sliver spends by its area), between 1 and 255. The cell
  grows (× 1.25) until it fits the budget; films, at a third at
  most when there are parts with drops, and the others in the rest.
- **The model** (`WetParts`, see the module's documentation). A ray BVH
  over the world's triangles for what lies in between (a ray
  upstream of each source's velocity). Drops: per step of 1/240 s,
  Poisson of the mean of the whole flux `density × |v| × max(0, −v̂·n) × area`
  of the parts with drops; the triangle by its share of the flux (a CDF), a
  uniform point in it, and the arrival if it is under the open sky. It splashes
  above `K = We^½ Re^¼ = 57.7` (Mundo, Sommerfeld and Tropea 1995):
  up to `SPLASH_SHARE` of its water (nothing at the threshold, all of that from `2K`)
  as `SPLASH_DROPS` drops thrown up to
  `SPLASH_REACH` diameters along the surface, and wets a circle of
  `LANDING_SPREAD` diameters. Furmidge, as on the glass, with the tangential
  gravity; it slides at `wet`'s speed, from triangle to triangle through the
  adjacency of their edges (the welded positions), across a fold along
  it; the trail wets, cleans the dust off samples within `a`
  (a grid of samples of `2 × cell`) and removes their film of water; merging,
  incremental (only the new or moved drops). It hangs while
  `ρ g V (ĝ·n) ≤ PENDANT_HOLD · 2π a γ sin θ̄` and otherwise drips; over an open
  edge, it drips there. A drip falls straight (the BVH) to the first part: it
  lands with velocity `√(2 g h)`, or leaves. The porous soaks `soak × π a²`
  mm³/s. Film: each sample gets wet at an instant drawn once from the
  exponential of its flux. Dust and snow: per sample, a rate (`k` of the dust,
  `1 − e^(−k t)` since the last cleaning; mm/s of the snow, times
  `SNOW_PACKING`) of the flux, the angle of repose with its ramp and the open
  sky, computed once. At most 4 096 drops. All `f32`, `+ − × ÷
  sqrt` and `fmath`, in a fixed order.
- **What it gives.** `layout` once (each triangle's resolutions and each sample's dust and snow
  rates), `frame` per frame (the drops
  new or changed by number, with their part, their triangle, their point in the
  object and their radius; those that left; the samples wetted and cleaned since
  the previous one; the drips and the drops), `weather` the state of the last step as
  the engine takes it, and `hash`. The page (`PartsTrackWriter`) gathers it into the
  **parts track** (`MotionClip.parts`, in base64, with the key
  `wetPartsKey`: FNV-1a of the WPT1 bytes and the version) and `partsFrame` rebuilds
  any frame (each sample's bytes and its drops), cached.
  `rt.wasm` exports `wpt_new`, `wpt_free`, `wpt_step`, `wpt_steps`, `wpt_hash`,
  `wpt_layout`, `wpt_frame` and `wpt_copy` over a registry by *handle*
  (`rt-wasm/src/parts.rs`).
- **`WETP`** (`rt_core::weather`, bit 8 of `FEATURES`, `FEATURE_WET_PARTS`,
  `/api/info` says 511): one section per wet instance, after `INST`:
  `u32 instance triangles samples drops; f32 cap_angle_deg porosity` (24 B),
  `u8 resolution[triangles]`, `u8 (wet dust snow)[samples]` (each
  padded to 4) and `(u32 triangle; f32 x y z r)[drops]` in object
  space. A hit reads its three linear bytes over the little triangle of the
  grid it falls in (`PartWeather::at`) and `weathered` puts on top of the material
  (already with patterns, program and textures) the dust, the film (a
  transparent layer of roughness 0.03; for the porous, the albedo to the power
  `1 + wetness × porosity`, Lekner and Dorf 1988) and the snow
  (`1 − e^(−h / 0.5 mm)`); where everything is 0, the material is not touched (bit for bit).
  The drops, water caps (`cap_mesh`: 16 segments by 4 rings) in one
  mesh, one instance and one more material (water, 1.333) after those of the file
  (`Scene::caps`; the instance id of the drops in the passes is the number of
  instances in the file); shadow rays cross them like a thin wall
  of water. An update file without `MESH` removes the caps' mesh
  before rebuilding it (they do not accumulate). The page writes it
  only for an engine with bit 8 (`SceneView.wetParts`, `readsWetParts`), from the
  frame that the *pose* says (`Pose.parts`), and for a part whose mesh is
  the recorded one; an instance with nothing carries no section.
- **In the *worker*** (`render/physics-worker.ts`): `run` also carries the WPT1
  (or nothing); the three advance the same steps, each frame sends its record
  of the parts, and a simulation with parts is not considered settled (only
  *Stop* or its `MAX_PARTS_SECONDS`).
- **In *Fast*** (`render/weather-preview.ts`): each wet part is drawn with
  a copy of its geometry without indices (each triangle with its number and the
  weights of its corners) and of its materials with a patch
  (`onBeforeCompile`) that reads the samples from two data textures
  (`texelFetch`: each triangle's first index and resolution, and each sample's three
  bytes) as the engine does and puts on the same layers with the same
  numbers (`WEATHER_LOOK`); the drops, one instanced cap per drop.
- **Pinned.** `PINNED_WET_PARTS = 0x62450071` (the parts of
  `rt_phys::example::parts_spec` after 5 s: a bottle, a plastic plate at
  45°, a metal shelf at 20° and a paper card as a film, under
  rain with wind, dust and snow; `tests/wet_parts.rs`) and
  `PINNED_S3C_WET_4SPP = 0x66fa33ab` (`example::s3c_wet_scene`: those parts with
  their `WETP`): the same in scalar, SSE2 and AVX2, with 1, 4 and 16 threads, in
  `wasm32-wasip1` (scalar and simd128) and in the real `rt.wasm`
  (`tools/wasm-parity.mjs` with `rt --write-s3c-wet-example`, also with the
  passes; `tests/s3c-parts.test.ts` with `tests/fixtures/s3c-parts.wpt1` and
  `s3c-wet.rsb`). No earlier pinned value moved. (S3d moved both, on
  purpose: §5.2 unvicies.)

### 5.2 unvicies · Drops through the air and the drops' part id (S3d, `rt_phys::wet_parts`, `WETF`)

What §5.2 vicies does, with what falls: the drip and the drops of a splash no
longer settle at once or slide along the surface; they fly.

- **The flight** (`WetParts::fly`, before the arrivals from the sky in each
  step: nothing settles in the step it leaves). Each drop in the air is a
  sphere of its volume with its velocity: gravity minus a quadratic drag
  `g |v| v / v_t²` (`terminal_speed`: Atlas, Srivastava and Sekhon 1973 above
  0.6 mm, a straight line down to 0 below), held through the step
  (`Δp = v Δt + ½ a Δt²`); the segment is cast against the parts' ray BVH and
  the first face with `n·v < 0` receives it, as an impact with the velocity
  along its normal (`impact`: it wets its circle, may splash, stays as a drop
  or wets the film). Below `min(0, lowest z of the parts) − 1 mm` or after
  `MAX_FLIGHT_STEPS` it leaves; at most `MAX_FALLING_DROPS`. They come out of
  `launch`: the hanging drip, from rest, `a` below its face; the one from an
  edge, at its sliding speed along its last stretch; each drop of a splash at
  `SPLASH_ELEVATION_DEG` from the surface, at `√(R g / sin 2θ)`. They take a
  number from the drops' count.
- **The record**: after `u32 drops`, `u32 falling; (u32 id part; f32 x y z r)
  [falling]` (world space; the sphere's radius), all of them in every frame, by
  number; `hash` counts them (id, part, point, velocity, volume). The page
  (`PartsTrackWriter`) stores them per frame in `PartsTrack.falling`
  (`u32 n; (u32 part; f32 x y z r)[n]`, base64) and `partsFrame` gives them in
  `PartsFrame.falling`; `PARTS_FORMAT_VERSION` 2 (the `wpt2:` key); a track
  without `falling` is read with no drops in the air.
- **`WETF`** (`rt_core::weather`, bit 9, `FEATURE_WET_FLIGHT`, `/api/info` says
  1023): one section per scene after the `WETP`s, `u32 drops; (u32 instance; f32
  x y z radius)[drops]` (`FallingDrop`: the instance it came from or
  `NO_INSTANCE`, world space, 0..50 mm; at most `MAX_FALLING_DROPS` = 4,096; a
  newer writer's tail is ignored). `Scene::set_wet_falling` (or the reader)
  meshes them as spheres (`water_mesh`: 12 × 6, after the caps, in the same
  water mesh, instance and material; shadows cross them the same way).
- **The passes**: `Scene::pass_instance(instance, triangle)` gives, on the
  caps' instance, that of its owner: `cap_owners` (one per cap and then one
  per sphere; `Caps::caps` caps of `CAP_TRIANGLES` triangles first, then
  spheres of `SPHERE_TRIANGLES`); `first_hit` uses it, so a drop's `partId`
  and `materialId` are those of its part (and `NO_INSTANCE`, the caps').
- **The page** writes `WETF` only for an engine with bit 9
  (`SceneView.wetFlight`, `readsWetFlight`), from the *pose* frame, each
  drop on the first instance of the node of the part it left (those of a part
  that is not drawn, left out); with bit 8 and without bit 9, the
  `partsRenderNoFlight` note in *Ambient*. *Fast* (`render/weather-preview.ts`):
  one instanced sphere (`drops:air`, the caps' water) per drop in the air of
  the parts it draws, in the `modelRoot`'s space; the meter says
  `partsShown` with `ui/sentence.ts` `partsMeterText`.
- **Pinned.** New: `PINNED_S3D_FLIGHT_4SPP = 0xf7b78a45`
  (`rt_phys::example::s3d_flight_scene`, `rt --write-s3d-flight-example`,
  `tests/fixtures/s3d-flight.rsb`) and its six passes `PINNED_S3D_PASS_*`
  (`tests/wet_parts.rs`), in scalar, SSE2 and AVX2, with 1, 4 and 16 threads, in
  `wasm32-wasip1` and in the real `rt.wasm` (`tools/wasm-parity.mjs` with
  `--expect-passes`; `tests/s3d-flight.test.ts`). Moved, on purpose:
  `PINNED_WET_PARTS` (0x62450071 → 0xe1811f7e: the simulation changes) and
  `PINNED_S3C_WET_4SPP` (0x66fa33ab → 0x827ac33c: the `WETP`s of that
  simulation; S3c's `s3c-wet.rsb` still gives 0x66fa33ab with the new
  engine). (S3f moved them again, on purpose: §5.2 duovicies.)

### 5.2 duovicies · Organic drops and their shapes (S3f, `rt_phys::wet_parts`, `WETP`'s shape tail)

What §5.2 vicies and unvicies do, with drops that behave as drops.

- **State.** Each `Drop` carries, besides S3c's, where its slide began this
  step (`from`: the segment it swept), its velocity, its Furmidge load (pinned)
  or capillary number (sliding), the merge it relaxes from (`Merging`: the axis
  between the two, the outline's stretch along and across it, its neck and shift,
  the share left and the way left to the centre of volume), a bead of a rivulet
  relaxing (`Bead`), its hanging load and how far it has pinched off, whether an
  open edge holds it, and how far it ran since its last bead. `WetParts::hash`
  eats it all.
- **The step** (`slide`, in index order): a merge relaxes first (the centre
  walks `1 − e^(−Δt/τ)` of the way left, `τ = MERGE_TIMES √(ρ a³ / γ)`); a
  hanging drop (a face with `ĝ·n > 10⁻⁴`, or held at an edge with the whole
  weight) past `2π a γ sin θ̄` pinches for `PINCH_TIMES` capillary times and
  lets go of `PINCH_OFF_SHARE` into the air (S3d's `launch`, from rest); a
  sliding drop gets Cox–Voinov's dynamic angles (`dynamic_angles`), stops and
  hangs at an open edge (S3c ran it off), and past `RUN_REAR_SHARE` of its
  receding angle leaves a bead behind the start of its step (its water taken).
  `put` marks a drop changed when what makes its shape changes.
- **The merge** (`merge`, `merged`): a fresh drop takes the first drop whose
  centre is within the two radii of the segment it swept; the survivor (the
  lower index) keeps its place, the summed volume, and a `Merging` towards the
  centre of volume of the centres the two were relaxing to.
- **Shapes** (`base_shape`, `shape_of`, `shapes`): `rt_core::weather::DropShape`,
  15 floats: the axis (motion or downhill), aspect, bulge (the shear the front
  and rear contact angles give), taper; the merge's axis, along, across, neck,
  shift; sag and pinch. In world space for the tests, in the part's object
  space in the frames (the record ends with `u32 shaped; f32 shape[15][changed]`)
  and in `Weather::shapes` (`part_weather_shaped` writes them).
- **The engine** (`rt_core::weather`). `PartWeather::shapes` and the shape tail
  of `WETP` (`SHAPE_TAG = "SHP1"`, `u32 count = drops`, `f32[15]` each; invalid
  when it does not fit, other trailing bytes ignored). `Cap::shape` carries the
  axes to world space (the instance's linear part); `water_mesh` meshes every cap
  with `SHAPED_CAP_RINGS = 8` rings when one has a shape (`cap_triangles`,
  `Caps::cap_triangles` for `pass_instance`), deforms each shaped one with
  `shape_point` in its tangent frame (`ShapeFrame`) and gives it the normals of
  its faces (turned like the sphere's). Every step of `shape_point` keeps the
  volume of a paraboloid cap. Bit 10, `FEATURE_WET_SHAPES` (1024; `/api/info`
  says 2047).
- **The page.** `core/wet-parts.ts`: `DropShape`, `PartsTrack.shapes` (one per
  version), `PartsFrameDrop.shape`, `PARTS_FORMAT_VERSION` 3, `partsRenderRound`
  (the note of bit 10); `io/rsb.ts`: `RsbWetPart.shapes` and the tail, only with
  `SceneView.wetShapes` (`render/engine.ts` `readsWetShapes`) and a track with
  shapes. *Fast* (`render/weather-preview.ts`): a shaped part's caps are an
  `InstancedMesh` of its own 16 × 8 cap with five instanced attributes
  (`localShape`: the shape in the cap's frame, gravity and the round height) and
  a material whose vertex shader runs `wShape` (the twin of `shapePointLocal`)
  on each vertex and takes the normal from the deformed surface.
- **Pinned.** New: `PINNED_S3F_PARTS = 0x1c5a82bb` (`example::organic_parts`
  after `ORGANIC_STEPS = 264`) and `PINNED_S3F_ORGANIC_4SPP = 0xbfb0b45a`
  (`example::s3f_organic_scene`, `rt --write-s3f-organic-example`,
  `tests/fixtures/s3f-organic.rsb`), in scalar, SSE2 and AVX2, with 1, 4 and 16
  threads, in `wasm32-wasip1` and in the real `rt.wasm`. Moved, on purpose (the
  simulation changes; S3d's fixtures give S3d's pins with the new engine):
  `PINNED_WET_PARTS` 0xe1811f7e → 0xdc58fa46, `PINNED_S3C_WET_4SPP` 0x827ac33c →
  0xfc96fb05, `PINNED_S3D_FLIGHT_4SPP` 0xf7b78a45 → 0x3ba00640 and the six
  `PINNED_S3D_PASS_*`. `rt --write-s3f-strip <dir>` writes the frames of
  `tools/s3f-strip.mjs`.

### 5.2 tervicies · Moving parts, the studio floor, fine samples and motes (S3e, `rt_phys::wet_parts`, `WETG`, `WTP2`, the motes tail)

What §5.2 vicies to duovicies do, on parts that move, on the studio floor, finer
on the set, with the dust's grains and the wind.

- **The spec** (`PartsSpec`, version 2 of `WPT1`; version 1 when it needs none of
  it, `needs_v2`): per part `body` (`NO_BODY`: it stays); `PartsExtras`: `wind`,
  `floor` (`FloorSpec`: z, the XY rectangle, the cell, the most cells),
  `edge_cell_mm`, `edge_budget`.
- **Moving parts** (`Mover`): the part's triangles and samples at rest, with a
  `RayTree` and a `SampleGrid` there; `now`, `prev`, `prev2` (rest to world) and
  `now_inv`. `step_with(world, ids, n)` steps `World` and the parts one step after
  the other (`begin_poses` takes the bodies' poses at the start); `step_posed`
  takes scripted poses. `move_parts` carries the triangles, normals, samples and
  drops (projected back onto their triangle), sets the part's `to_object` and its
  `gravity` (−Z less the second difference of its centre over `g`). The still
  tree holds only the parts that stay; `cast` casts it and then each mover's tree
  with the ray carried to its rest (rigid: the same distances). `land` builds,
  each step, the movers' share of the flux with the rain's velocity less each
  triangle's (`tri_velocity`); `near` reads a mover's grid at rest. Dust and snow
  rates skip movers. The hash eats each mover's `now`.
- **The floor** (`FloorGrid`): cells, their first wet step, their rates of dust
  and snow, a film of exponential wet times per drops source, the cells first wet
  since the frame before, the water landed. `fly` stops a drop at the floor's
  plane over its rectangle unless a part takes it first (`on_floor`: a disc of
  `LANDING_SPREAD` diameters). The layout and the record end with its blocks;
  `floor_weather` gives `rt_core::weather::FloorWeather`.
- **Fine samples** (`place_samples`): after S3c's two budgets, a film triangle
  whose coarse grid (at most 24 steps a side probed) is partly in the open and
  partly not for some source takes `edge_cell_mm`, up to `MAX_FINE_RESOLUTION`
  (4095), the cell growing until those triangles keep under `edge_budget`. The
  layout's flag 4 marks two-byte resolutions; `Weather::resolution` is `u16`.
- **The edge run** (`run_edge`, before the hanging test): `edge_at` (`3 × tri +
  k`) names the open edge a drop is held at; `open_edges` links each open edge to
  the open edges of its part at its corners; the drop runs while `ρ g V |ĝ·ê|`
  beats Furmidge's hold, from edge to edge, and stops where the boundary rises on
  both sides.
- **The wind**: `fly` takes the drag against `v − wind` (the S3d path when the
  wind is nothing).
- **The engine** (`rt_core::weather`). `PartWeather::resolution` is `u16`;
  `wide()` and `decode_wide` (`WTP2`: `u16 resolution[triangles]`, zero padding
  to 4). The motes tail (`MOTE_TAG = "MOT1"`, `MoteSpec`: size, variation, seed)
  after the shape tail; `motes_on` places the grains (`hash32`, `unit32`),
  `motes_of` carries them to world, `mote_mesh` meshes octahedra; the scene keeps
  them after the caps (`Scene::motes`, `mote_owners`; `file_*` stop at the first
  of the weather's own; `pass_instance` names a mote's part). `FloorWeather`
  (`WETG`) and `WeatherSetup::floor_layers`; the integrator gives a visible floor
  `floor_material` under its layers, and a shadow catcher picks, by
  `catcher_shares` and the cut-outs' dimension, the dust and snow layer
  (`catcher_cover`), the film's mirror (`catcher_film`) or the catcher, which
  `catcher_wet` darkens. Bits 11, 12 and 13: `FEATURE_WET_FLOOR` (2048),
  `FEATURE_WET_FINE` (4096), `FEATURE_WET_MOTES` (8192); `/api/info` says 16383.
- **The host** (`rt-wasm`): `wpt_step_with(parts, world, n)` and `wpt_moving`.
- **The page.** `core/wet-parts.ts`: `wetPartsSpec(state, moving)` (a map from
  part to body), `WetFloorSpec`, `needsWpt2`, `wptBytes` (version 2),
  `PARTS_FORMAT_VERSION` 4, the layout's `floor` and two-byte resolutions,
  `PartsTrack.floor` and `motes`, `PartsFrame.floor`, `coarseWeather`, `motesOn`
  (the twin of `motes_on`), `partsRenderNoFloor`, `partsRenderNoMotes`;
  `data/wet-parts.ts`: `FLOOR_CELL_MM`, `FLOOR_MAX_CELLS`, `FLOOR_POROSITY`,
  `PARTS_EDGE_CELL_MM`, `PARTS_EDGE_BUDGET`; `ui/physics.ts` passes the run's
  bodies; `render/physics-worker.ts` steps moving parts with the bodies
  (`PartsSim.stepWith`); `io/rsb.ts`: `RsbWetFloor` and `WETG`, `WTP2`, the motes
  tail, with `SceneView.wetFloor`, `wetFine` and `wetMotes` (`render/engine.ts`
  `readsWetFloor`, `readsWetFine`, `readsWetMotes`). *Fast*
  (`render/weather-preview.ts`): `placeFloor` (a plane with the cells as its map,
  patched to the catcher's layers) and `placeMotes` (instanced octahedra on the
  part, following it).
- **Pinned.** New: `PINNED_S3E_PARTS = 0x8cbf1fd2`, `PINNED_S3E_MOVING =
  0x5a95d355`, `PINNED_S3E_FLOOR_4SPP = 0xa5311343`, `PINNED_S3E_MOVING_4SPP =
  0xe7e964e9`, `PINNED_S3E_DUST_4SPP = 0xb19bc6f0` (`rt-phys/tests/wet_parts_s3e.rs`;
  `rt --write-s3e-example`, `--write-s3e-moving-example`,
  `--write-s3e-dust-example`; `--write-s3e-strip <dir>` writes the frames of
  `tools/s3e-strip.mjs`), in scalar, SSE2 and AVX2, with 1, 4 and 16 threads, in
  `wasm32-wasip1` and in the real `rt.wasm`. No earlier pin moves.

### 5.3 · In the browser: workers

`src/render/pathtracer.ts` implements `RenderEngine` with a **pool of
Web Workers** (`navigator.hardwareConcurrency − 1`, minimum 1). Each
worker instantiates its own copy of `rt.wasm` and receives the whole RSB
(without `SharedArrayBuffer`, so that it works on any server without
COOP/COEP headers, GitHub Pages included); tiles are distributed
interleaved, each worker returns linear `Float32Array`s per tile,
and the main thread accumulates (in `f32` and in sample order, which is
what gives exact parity with `rt`), applies exposure and the transform with
a fast table-driven path, and paints on the canvas; *Render*'s exact final
conversion to 8 bits is done by the workers in strips. During
camera gestures, drags of the *gizmo* and of controls, the viewer renders
at ½ or ¼ resolution; never above one image pixel per device
pixel. The three.js *preview* stays active while the camera
moves; when it stops, the tracer starts from sample 0 and the image
converges in the viewer itself. *Render* uses the same pool at the output
resolution and with the render bar's budget. With `passes`
(`RenderOptions`, X2) each job carries the mask; the worker returns,
with each tile, the albedo of each sample (`rt_render_tile_albedo`), N2: the
coverage of each sample (`rt_render_tile_alpha`, which `PassAccumulator.addAlpha`
sums the same way) and,
in the job that starts at sample 0, its exact planes
(`rt_render_tile_passes`), and the main thread gathers them with
`PassAccumulator` (`src/render/pass-planes.ts`) just like the image: the
result is the native engine's bit for bit and comes back as `RenderPasses`. With
adaptive sampling (E10, §5.2 duodecies), after the first round the
*workers* receive 8 × 8 blocks (message `blocks`) instead of tiles, and
the main thread decides each round with the decision port.

**Denoise and caustics in the pool** (E5b-1). Each *worker* traces the photon
maps of the samples it renders (the same bits as any other:
they do not travel) and says in its reply to `scene` how many photons per
sample it renders for that scene. With *denoise*, the jobs request the guide
passes and the main thread sums `lum2`; when a pass ends the pool distributes
the filter in row bands among the lane's *workers*
(`Pool.denoise`, message `denoise`, `rt_denoise`); the viewer shows the
filtered image as soon as it returns (after the first pass, after the last and
after any other when three times as long as the previous one has passed;
meanwhile, the last filtered one) and the meter counts its samples. At half and
quarter resolution (gestures) it is not filtered. A *Render* filters at the end with
all its *workers* and, if requested, also returns the image from before.

**While a *Render* runs, the viewer stays alive** (P3a): it keeps a
quarter of the workers (at least one; in a pool of one, it waits) and the
render uses the rest on each pass, or all if the viewer is in
*Fast*; with *Settings ▸ Render engine ▸ While a render runs ▸ Pause
the viewport (fastest render)*, the viewer waits and the render uses them all. Which worker renders
a tile does not change a pixel, so the render gives the same bits with or
without a viewer. Each worker has a single scene: the pool remembers the last
one it sent to each, and a worker that changes hands receives the other as an
update (the meshes stay). Since the render and the viewer run at the
same time, a cancellation is of an exact generation, and a worker that moves to
another generation for the one it had. When the render ends, the viewer starts again
on all the workers.

**Never stopped silently** (P3a, `src/render/watchdog.ts`, the same in
both engines): on every frame it checks that the current view
receives tiles (natively, that the launcher answers and passes
arrive, with the deadline according to how long the previous one took) and that what arrives
is painted; if not, the view starts again, the console says so and the
meter too (a note under the bar). Deadlines double each time
it fires without progress in between, so as not to restart a scene that is merely
slow, and a hidden window does not count. A timer paints if the
page's animation loop stopped calling, and that loop (`main.ts`)
no longer stops because of an exception in a frame.

### 5.4 · Natively

`rt` renders an `.rsb` with all the machine's threads and writes PNG
(8 bits), TIFF (`--format tiff`, with `--bits 8|16|32`) or DNG (`--format
dng`); without `--format`, the extension of `-o` decides (`.tif`, `.tiff`, `.dng`;
any other, PNG). It serves for batches, for CI's contact sheet and
for generating the catalogue thumbnails without a browser. The
desktop application (P2) links `rt-core` directly in its
launcher and uses the same RSB as the web (§5.5).

### 5.4 bis · TIFF and DNG output (U12)

Two own encoders, written from the public specification (Adobe's TIFF 6.0,
1992, §2, §6, §8, §19; Adobe's DNG 1.4.0.0, 2012) and without
looking at any other reader or writer, one on each side, that **write
the same bytes**: `rt_core::tiff` and `rt_core::dng` (only `std`) for
the CLI, and `encodeTiff` and `encodeDng` in `src/io/image.ts` for the
interface (which is what writes a render's file, also on the
desktop: the launcher only saves it, `image/tiff` as `.tif` and
`image/x-adobe-dng` as `.dng`, and allows writing those extensions).

- **TIFF.** Little-endian (`II`, 42), a single directory, uncompressed
  (`Compression` 1), in *strips* of about 8 KiB (§7), RGB (photometric 2)
  or RGBA with **unassociated** alpha (`ExtraSamples` 2), at 8 or 16 bits, or at
  32-bit `f32` (`SampleFormat` 3). `XResolution` and `YResolution` are the
  window's DPI (72 in the CLI), `ResolutionUnit` 2 (inches), with no ICC
  profile: 8 and 16 bits are sRGB by convention and the float is linear
  light with the render's exposure and no curve, like the EXR (which does
  store the alpha premultiplied; the TIFF, straight: the colour divided by the
  coverage, `straightLinearRgba` in `render/tiles.ts`). The tags are
  sorted, and the values that do not fit in the entry (>4 bytes) go after
  the directory, in the order of the entries and each at an even
  offset; the *strips* follow without gaps. 32-bit offsets:
  more than 4 GiB is rejected.
- **DNG.** A TIFF plus the DNG 1.4 tags: `NewSubFileType` 0,
  `PhotometricInterpretation` 34892 (*LinearRaw*), three `f32` samples
  (`SampleFormat` 3, no alpha), `Make`, `Model` and `UniqueCameraModel`
  “Repackshot”, `DNGVersion` and `DNGBackwardVersion` 1.4.0.0 (floating-point
  data require 1.4), `ColorMatrix1` = CIE XYZ (D65) → linear sRGB,
  **the inverse of sRGB → XYZ** of the primaries (0.64 0.33; 0.30 0.60;
  0.15 0.06) and the white (0.3127; 0.3290), computed in exact arithmetic
  and rounded to seven decimals as signed rationals with
  denominator 10⁷ (`CalibrationIlluminant1` 21: D65), `AsShotNeutral` 1 1
  1, `BaselineExposure` 0 and `WhiteLevel` 1 (the render's white is 1.0 and
  black 0; the data are not clipped to it, so a raw developer opens
  the file with the **render's full latitude**; the largest `f32` does not work
  as a white level, because the developer would normalise by it and the image
  would come out black).
- **Parity.** `tests/fixtures/tiff/` holds the seven files of a
  4×4 image with known values (RGB and RGBA at 8, 16 and 32 bits, and the
  DNG). `engine/crates/rt-cli/tests/tiff_golden.rs` checks that
  `rt_core` writes exactly those bytes (with `REPACK_WRITE_GOLDEN=1` it
  rewrites them) and `tests/tiff-dng.test.ts`, that the interface does too; each side
  is also re-read with a minimal reader in its own test (header,
  tags, offsets, values). Changing the format on purpose is
  changing both encoders and rewriting those files.
- **In the interface.** `OutputFormat` gains `TIFF` and `DNG`; `BitDepth` gains
  32 (TIFF only; the normaliser of `render/set` sets it to 8 for any
  other format, and the alpha to false for JPEG and DNG). Chromium and Firefox do not
  display TIFF or DNG: the render saves, next to the file, the 8-bit PNG copy
  that it already saved for EXR (`needsDisplayCopy`).

### 5.4 ter · Encoded video (N1)

The *Video* output of an animation (`RenderSettings.animation.output`
`VIDEO`, container `video`: `MP4` or `WEBM`) is encoded **on the page**,
also on the desktop (WebView2 is Chromium): each frame is rendered
by the engine as usual (one RSB per frame, `evaluate` at its
instant) and comes out as an opaque 8-bit PNG; the browser's encoder
compresses it and our *muxers* write the file. No dependencies.

- **What this system encodes** (`src/io/video.ts`): `probeVideo` asks
  `VideoEncoder.isConfigSupported` about each container, in order: WebM,
  **VP9** (`vp09.00.10.08`) and if not **VP8**; MP4, **H.264** *Constrained
  Baseline* (`avc1.42E0xx`, the level that the size and fps require according to
  table A-1 of ISO/IEC 14496-10: no B-frames, so the decoding order
  is the presentation order and the MP4 carries no `ctts`). Without
  WebCodecs (outside a secure context, a browser without it) there is
  nothing. `main.ts` asks once at start-up (1080p at 24 fps) and leaves it
  in `ui.video`; the render window offers only what exists (the rest
  disabled with its reason), the Doctor (`output`) warns only of a
  codec that is not encoded here, and a job asks again with its
  size and fps when it opens its writer.
- **The writer** (`createVideoWriter`): `configure` with the codec, the
  **even** size (4:2:0: an odd row or column is left out), the fps,
  ~0.1 bit per pixel (from 1 to 50 Mbit/s) and `latencyMode: 'quality'`; each
  frame `i` is a `VideoFrame` of the PNG's `ImageBitmap` with
  `timestamp = round(i · 10⁶ / fps)` µs and its duration, a key frame every
  2 s (`KEY_EVERY_S`), waiting while the encoder's queue exceeds
  two. The chunks are kept in memory with their time and whether they are key; in
  H.264 (`avc: { format: 'avc' }`) the configuration record
  (`decoderConfig.description`) is the `avcC`. At the end, `flush` and the
  *muxer*. The environment (`VideoEncoder`, `VideoFrame`, `createImageBitmap`)
  comes in as `VideoEnv`: the tests use this same code with a fake
  encoder.
- **WebM** (`src/io/webm.ts`), from the public EBML specification (RFC
  8794) and Matroska's (RFC 9559) and the WebM guidelines: EBML header
  (`DocType` `webm`, version 4), `Segment` with `Info` (`TimestampScale`
  1 ms, `Duration` in ms as `f64`, `MuxingApp` and `WritingApp`),
  `Tracks` (one video track, `V_VP9` or `V_VP8`, `DefaultDuration` in ns,
  `PixelWidth` and `PixelHeight`), `Cues` **before** the *clusters* (one
  `CuePoint` per *cluster*, with its `CueClusterPosition` relative to the start
  of the `Segment`'s data written in 8 bytes, so the size of
  `Cues` does not depend on the positions) and a `Cluster` at each key
  frame (or when a block would be more than 30 s from its start: a
  `SimpleBlock`'s offset is a signed 16-bit integer),
  with its `Timestamp` and a `SimpleBlock` per frame (track 1,
  offset in ms, key flag). All sizes are known
  before writing: EBML sizes of the minimum length.
- **MP4** (`src/io/mp4.ts`), from ISO/IEC 14496-12 (boxes) and 14496-15
  (`avc1`/`avcC`): `ftyp` (`isom`, compatible `iso2`, `avc1`, `mp41`),
  `moov` **first** (*fast start*) with `mvhd` (scale 1000), one `trak`
  (`tkhd`, `mdia`: `mdhd` with scale `fps × 1000`, `hdlr` `vide`, `minf`:
  `vmhd`, `dinf`/`dref`, `stbl`: `stsd` with the `avc1` entry and its `avcC`,
  `stts` in runs, `stss` with the key frames, `stsc` with a single
  *chunk*, `stsz` and `stco`, or `co64` if the file passes 4 GiB) and
  `mdat` with the frames one after another.
- **The queue** (`src/ui/render-queue.ts`): a video job opens its
  writer before rendering (if the system does not encode the container,
  it fails at that moment, without rendering anything, and says so), hands it each
  frame instead of saving it, and at the end saves **one file**
  (`<name>.webm` or `.mp4`, numbered like an image); the history stores
  the first frame as the PNG it is (`ResultMeta.video` says which
  video it belongs to). Job plugins do not go through a video's frames
  yet.
- **The colour fade of the camera track** (`core/fade.ts`) is applied to
  the pixels of each frame after the engine (which knows nothing of it): on
  the values of an 8- or 16-bit image and in linear light (with the
  exposure) in EXR, 32-bit TIFF and DNG, with the alpha towards opaque.
- **Tests.** `tests/video.test.ts` re-reads both containers with the test's own
  readers (`tests/video-readers.ts`: EBML and boxes, written
  apart from the writers), checks that a 2 s video at 12 fps has 24
  frames and 2 s, drives the writer with a fake encoder and a queue
  job through to the file and, where the machine has ffmpeg,
  feeds real libx264 and libvpx frames into our MP4 and WebM files and has
  ffprobe read them. `tools/video-check.mjs` does the same in Chromium with
  the real WebCodecs, and the application's whole path (the engine, the
  encoder, the download), read by ffprobe.

### 5.4 quater · Queue, passes and batches (N2)

The queue (U5, U14) already had order, progress, pause and cancellation; N2 adds
passes as files, the studio as the batch axis and the ZIP.

- **The model** (`core/render.ts`). `RenderSettings` gains `studio`
  (`StudioChoice`: `CURRENT`, `ONE {id, name}` or `ALL`), `passes`
  (`PassesOutput` of `core/pass-files.ts`: the keys `alpha`, `depth`,
  `normal`, `partId` in that order and the format `EXR` or `PNG16`) and `zip`;
  `RenderJob` gains `zip` (the ZIP group's id, or null). An earlier project
  has none of that and opens with the usual values
  (`migrateRender`, `settingsOf`, `patchSettings`; without raising
  `PROJECT_SCHEMA`: everything has its default value). `expandJobs` makes one
  job per camera and per studio (first by camera, so the files
  come out in the template's order); the job stores its already resolved studio in
  `settings.studio` (`ONE`, like the camera), `studiosOf` says
  which studios a choice is and `batchSize` how many jobs it is. An
  animation makes a single job, with no studio and no passes. The studios that
  *All* means are listed by the interface (the library, then the project's:
  `studioRefs`) and travel in the `render/enqueue` action, which remains
  a single undo entry; the jobs of one order share
  `zip: 'z<n>'` (n, the render number of the first) if the settings ask for it.
- **A job's studio.** `restoreStudio(state, saved, { camera: false })`
  (`core/lighting.ts`, the pure function that `studio/restore` already used) puts
  materials, lights, floor, environment and image of the saved studio onto a
  **copy** of the project, without taking away the job camera's view;
  `FrameRequest.state` gives it to the engine (`RenderOptions.state` already existed) and
  the open project does not even notice. The studio is looked up by its id in the
  library and, failing that, in the project's; if it is not there, the job fails with the
  reason. A job with a studio does not go through the AI.
- **The passes** (`FrameRequest.passes` + `imageName`). `main.ts` asks the engine for
  the keys (`RenderOptions.passes`), encodes the planes that come back with
  `io/passes.ts` and returns them as `FrameResult.extras`; the queue saves them
  under the image's name (`passFileName`: `<image>_depth.exr`). With the
  AI step on the desktop, the launcher renders both sets and the
  page reads them back. What each number is (`core/pass-files.ts`): alpha
  in PNG, `α × 65535`; depth in PNG, 0 the background, 1 the farthest and
  65535 the nearest, linear within the range of the image's surfaces,
  which goes in a `tEXt` chunk (*Depth range*); normals in PNG, `n × ½ + ½`
  (the background, mid grey); the id in PNG, the instance number plus 1 up to
  65534 and 65535 the studio floor; in EXR, the values as they are (`A`, `Z` with
  `+Infinity` in the background, `R G B`, `Y`). The legend `<image>_partId.json` lists
  each id with its part and its material (the instance order of
  `projectScene(...).ids`). The writers are our own and dependency-free:
  `encodePngWords` (16-bit PNG, grey or RGB, filter 0, `pHYs` and `tEXt`) and
  `encodeExrPlanes` (the minimal EXR of `encodeExr`, with the channels it
  is given, sorted).
- **The ZIP** (`io/zip.ts`). *Store* method of PKWARE APPNOTE 6.3: per file
  a local header and the data, then the central directory and the end
  record; UTF-8 names (bit 11) with `/`, no root or `..`; the CRC-32 is that of
  `io/image.ts` (the same polynomial as PNG's); the time is local DOS;
  duplicates are told apart before the extension (`a.png`, `a_2.png`); no
  ZIP64 (4 GiB or 65 534 files: clear error). The result is a `Blob` of
  the headers and the files' `Blob`s, without copying them. `ui` does not import
  `io`: the `AppServices.archive.zip` port is given to it by `main.ts`.
- **The ZIP group in the queue** (`ui/render-queue.ts`). A job with `zip`
  does not save its files (image, noise, passes, legend, AI images,
  the video): it passes them to its group's basket (`saveOutput`); `flushIdleZips`
  writes the ZIP of every group that no longer has a `QUEUED` or
  `RUNNING` job in the queue (`Project_0001-0004.zip`, `zipFileName`), when each
  job ends and on every change of the queue while there are files waiting (so
  removing the last waiting job, or undoing its *Add*, writes it too). If the ZIP fails the files are saved one by one. Job
  plugins save separately, outside the ZIP.
- **A job's studio** (N2b, `ui/render-queue.ts`). *Render*, *+ Add to
  queue* and *Save changes* of an edit take to the *store* the studios they
  use together with the studio itself (`studiosForJobs`: `StudioRef.snapshot`); the
  queue's *reducer* stores the copy in `render.studios` and the job names it
  (`studioCopy`), all in the same undo entry. `jobProject` puts into the
  copy of the project being rendered the studio that `resolveStudio` gives. The
  library remains the person's (no undo, U4): *Add to my library*
  (`addProjectStudioToLibrary`) does not change the project.
- **Tests.** `tests/batch.test.ts` (the jobs and names of a 2 × 2 batch,
  the queue with the second job stopped or removed, the studio put on
  a copy, the passes, the ZIP in all its cases read by fflate),
  `tests/zip.test.ts` (the bytes of a known package, fflate, `unzip` and
  Python's `zipfile` once by hand), `tests/pass-files.test.ts` (the numbers, the
  names, the PNGs re-read with node's `zlib` and the EXRs with three.js's
  `EXRLoader`), `tests/passes-engine.test.ts` (the real `rt.wasm`'s alpha against
  the pinned *hashes*) and `tools/batch-check.mjs` in Chromium.

### 5.5 · Desktop: the `repackshot` launcher

`engine/crates/rt-app` is a Rust binary with **`std` only** (same
workspace, same gates: `fmt`, `clippy -D warnings`, zero external
*crates*). **No `unsafe` except in `src/platform/`** (decided in P3c):
the own Windows window needs to call Win32 and WebView2's COM
interface, and that is only done through FFI; each `unsafe` block carries its
comment on why it is correct, the rest of the *crate* keeps
`#![deny(unsafe_code)]` and nothing from `platform/` enters `rt-core`. It does these things:

1. **Serve the interface**: a minimal HTTP/1.1 server on `127.0.0.1`,
   with the `app/` folder (Vite's `dist/`) next to the executable.
   It checks the `Host` header (against *DNS rebinding*) and requires on the
   API a random *token* per start-up that only the page that
   opened it knows. **Stable port per data folder** (P3e, `src/port.rs`):
   it is recorded in `<data>/launcher.json` and reused on the next
   start-up if free; only if it is taken is another free one chosen, which
   becomes the recorded one (`--port N` uses N and records nothing). That way the
   window's origin (`http://127.0.0.1:<port>`) does not change from one
   start-up to the next.
2. **Open the window**: Edge on Windows (it ships with the system) or the
   first Chromium, Chrome, Edge or Brave on Linux, with `--app=<url>` and its own
   profile in the data folder; if there is none, the default
   browser. It closes when the window closes (child process
   and the page's heartbeat). A second start-up opens another window of the
   same server.
3. **Native engine**: `POST /api/render` with the RSB (and `full=1` when the
   body is the whole scene even if it carries no `MESH`, like that of an
   empty project; without it, an RSB without meshes is an update and, if there is no
   scene loaded, the response is 409 `need-meshes`) renders with
   `rt-core` on all threads and the page collects the accumulated
   passes; same RSB, same seed, same pixels as the wasm
   (determinism rule), so the interface tells them apart only by
   speed. `src/render/native.ts` implements `RenderEngine` against
   that API and is chosen when `/api/info` answers.

   With what was learned in P3a: the page sends **one viewer view at a
   time**, numbered (`seq`; one that arrives late gets 409 `stale` and does not
   replace a newer one), and **always reads or cancels the body of each
   response**: an unread one holds one of the six HTTP/1.1 connections
   that the browser opens to the launcher, and with all six held everything
   waited forever (the viewer, the render and v0.1.0's *Pause*).
   With `share=<threads>` the viewer job **stays alive while a
   final runs**, on those threads (the page asks for a quarter, at least one),
   and the final keeps the rest, or all of them when no viewer
   is alive; without `share` (*Pause the viewport*), the viewer stops between tiles.
   Frame flag 32: shares, and the header says with how many threads.
   The launcher cuts off after 10 s the writing of a frame that nobody reads;
   a job that nobody asks about stops by itself (viewer after 10 s,
   final after 20 s: its page is gone); with all 8 windows busy, one
   that has gone 3 s without asking (a reloaded page) gives up its place, so
   reloads alone never reach 503 `busy`; a render that panics
   ends as failed and releases the gate, and a job that does not
   stop in 5 s is left behind without its scene. `GET /api/render/state` gives
   the diagnostics (the gate, the jobs, the windows, the connections)
   and with `log=1` records it in the log: the page's *watchdog* asks for it
   when it fires. *Render* requests carry the cancellation
   signal, so *Pause* and *Stop* respond at once even if
   the launcher does not answer. The full contract is in
   `engine/crates/rt-app/README.md`.

   **Live view** (U14): while the queue's live view is looking at a
   *Render* and it is due an image (`FrameRequest.frameBox`, with the cadence of
   `core/live-frame.ts`), the page asks, after the pass just published,
   `GET /api/render/<id>?fit=<an>x<al>`: the launcher averages the sums by an
   integer factor (`Frame::fitted`, on the request's thread) and the frame carries
   the reduced size and flag 512, so only the pixels of the
   image travel (a launcher without `fit=` sends them whole and the page reduces them).
   Without a live view only headers travel, as before. On the web, the *pool*
   does the same with its accumulation (`render/live-frame.ts`) after the tile
   that has just arrived.

   ***Denoise* and caustics** (E5b-1): with `RNDR.denoise` the job
   also renders the guide passes and filters with `rt_post::denoise` in
   row bands on its threads (the same bits with any number). A
   viewer publishes the filtered image (frame flag 64) after its first
   pass, the last and any other when three times as long as the previous filter
   took has passed (in between, the last filtered one at the samples
   of now); a final publishes on finishing one more frame, the last, with the
   filtered image and, with bit 1, after it the earlier one (flag 128: the
   body carries the sums twice). The image saved for the AI is
   the filtered one. With `RNDR.caustic_photons` each pass traces, before its
   tiles, the photon maps of its samples on all its threads (by
   photon ranges, gathered in order) and the frame carries flag 256.

   **Passes** (X2): a final job with `passes=albedo,normal,…` (and those
   of `RNDR.passes`) renders them alongside the image with the threads it
   has (also with those left to it by a sharing viewer), and on
   finishing with all its samples (not if it is cancelled, orphaned or
   fails) the launcher **stores the linear image and its passes by job id**
   (`src/kept.rs`) before saying it has finished, for the AI pipeline
   (`AI-POST.md` §7.3); deleting the job (`DELETE`) does not delete them.
   It keeps the last four; one of more than 64 MiB between image and passes
   goes to `<data>/cache/ai/<id>.rpx` (the `RPX1` frame) and `<id>.rpp`
   (the passes) instead of staying in memory, and what an earlier start-up
   left is deleted on start-up (the ids start over).
   `GET /api/render/<id>/passes` returns them in binary: a 32-byte `RPP1`
   header (*magic*, header length, width, height,
   mask, albedo samples, id, 0) and the mask's planes in
   `PASS_KEYS` order, *little-endian* words (`f32`; `u32` the
   ids); 404 if the id does not exist, was evicted or did not ask for passes, 409
   `not-ready` while rendering. `native.ts` reads them with
   `parsePasses` (`src/render/pass-planes.ts`) and returns them with the
   render's id. Contract in `engine/crates/rt-app/README.md`.
4. **Data and models**: data folder in `%LOCALAPPDATA%\Repackshot`
   (Windows) or `$XDG_DATA_HOME/repackshot` (Linux); in the
   **portable** versions (a `portable.txt` file next to the executable), in
   `data/` beside it, with everything inside. AI models are stored there: the
   page downloads them with `fetch` and hands them to the launcher in pieces,
   which writes them, resumes and checks them with its own SHA-256.
5. **The page's state** (P3e, `src/appdata.rs`): on the desktop the
   page is **only the interface** and everything it stores is written by the
   launcher in the data folder, never the browser storage
   of the window. `/api/store/*` and `/api/storage/usage`, with the same
   *token*, `Host` and `Origin`, lowercase names confined to the
   data folder (no links or Windows device names) and
   atomic writes (temporary, `sync_all`, `rename`). The folder:

   ```text
   settings.json        the settings document (src/core/settings.ts)
   state/<name>.json    small things of the page: downloads to resume, chosen folders,
                        the browser-migration mark
   library/             the own library (U4)
   results/             the history: one file per result (png, jpg, exr, tif, dng) and index.json; with AI, the
                        AI variants as <id>.ai.<n>.<ext> (X4b; the single <id>.ai.<ext> from
                        before is read as variant 1)
   cache/thumbs/        the material spheres (cache)
   cache/ai/            the image and passes of the large final renders that the launcher keeps (X2)
   models/              the AI models, by sha256
   logs/                the launcher's log
   browser-profile/     the Edge or Chromium window's profile
   webview2/            the own window's profile (P3c); window.json, its position
   launcher.json        the port; instance.json, the running instance
   pending-models.json  what the installer chose: device, models and (U10) the
                        execution engine, which the launcher starts downloading on start-up
   ```

   On the page, **the platform seam** (`src/io/platform.ts`): a `Platform`
   interface with every service that stores something or asks the
   machine (settings, small remembered things, library, results
   history, model store, hardware, space used, thumbnails,
   output files, projects, import and export dialogs),
   chosen once at start-up (`choosePlatform()`, before painting anything)
   with two implementations: the web one (`platform-web.ts`: localStorage,
   IndexedDB, OPFS, WebGPU, the browser's pickers and downloads) and
   the launcher's (`platform-desktop.ts`: the above, plus `/api/hardware`
   and the dialogs and file API of P3b). `main.ts` builds the interface's services with
   it, and the interface does not know which it is. On the desktop
   the page does not touch the browser storage except once per
   data folder, to copy to the launcher what an earlier version
   left in the current origin (mark `state/migration.json`).

   **The results history with AI variants** (X4b). `ResultMeta.ai` is the
   first variant (what was the only one before X4b) and `ResultMeta.aiMore` the
   others, in order, each with its name, its thumbnail, its bytes (0 if the guard
   rejected it: it has no image) and its report; `aiVariantsOf` and `aiImagesOf`
   (`src/core/results.ts`) read them the same in a new result as in an old one.
   `ResultsStore.add(meta, file, display, ai, aiMore)` and `get` (`src/io/results.ts`)
   carry them as `ai` and `aiMore` (null for a variant without an image): on the web,
   in the same IndexedDB record as the render; on the desktop, each through
   `PUT /api/store/results/<id>/ai/<n>` and back with `GET …/ai/<n>`.
6. **Dialogs and files** (P3b): `POST /api/dialog/{folder,open,save}`
   opens the system dialogs and returns a permission per path; the file
   API (`/api/files…`) only reads or writes paths granted this way in
   the current start-up, with atomic writing and without overwriting in the
   output folders. The page never names a path that a dialog did not give it.
7. **Hardware**: `repackshot --hardware <file>` writes the GPU with its
   VRAM, the RAM and the recommendation of `src/data/ai-models.json`
   (Windows registry and `/proc`, `/sys` or `nvidia-smi` on Linux, through
   system processes and without `unsafe`); the installer and
   *Settings ▸ AI post-processing ▸ Hardware* use it. Since U10 the INI also carries
   `[runtime]`: the build of the execution engine that the rule of
   `src/data/ai-runtimes.json` chooses for this system (with `--device cpu`, the
   CPU one), which the installer's *AI models* step offers next to the
   models and records in `pending-models.json` (`"runtime"`); the launcher
   downloads it on the first start-up (`Ai::start_pending_runtime`).
   `engine/crates/rt-app/tests/installer.rs` reads `models-page.nsh` as
   text and checks that each `ReadINIStr` has its key in the INI and that the
   line it writes is the one `read_pending` reads.
7. **AI post-processing, the execution engine** (X3b, `src/ai/`): the stable-diffusion.cpp
   build that the rule of `src/data/ai-runtimes.json` chooses (Vulkan if the machine
   has a GPU to use, CPU if not, or whichever is forced) is downloaded with the system `curl`
   (`https` only, resumable, to `<data>/ai/runtimes/<sha256>.zip.part`), checked with the
   own SHA-256 (if it does not match, nothing is installed), unpacked with an own zip reader and
   *inflate* (RFC 1951) into `<data>/ai/runtimes/<sha256>/` and asked
   `--version` and `--list-devices`. To infer, the launcher starts `sd-server` with the
   arguments of the model's family (paths in the model store), without a console window,
   at a random `127.a.b.c` and a free port, keeps it loaded between calls, follows its
   progress on standard output, stops it if it falls silent or takes longer than expected, if cancelled,
   after 5 min unused and on closing, and cleans up the one an earlier start-up left. API:
   `GET /api/ai/runtime` (an `AiRuntimeStatus` of `src/core/ai.ts` and more),
   `/api/ai/runtimes/<key>[/download|/pause|/import|/probe]`, and **`POST /api/ai/run`**: a raw
   *img2img* inference, without the guard (image and control as PNG), with progress through
   `GET /api/ai/run/<id>?after=n`, image at `/image` and cancellation with `DELETE`, like
   render jobs. The guard, the tiles and the pipeline are X3a and X3c. Full contract in
   `engine/crates/rt-app/README.md`.
8. **AI post-processing, the pipeline** (X3c, `src/ai/post.rs`; `rt-app` now links `rt-post`):
   **`POST /api/ai/post`** with `{source: {kind: RENDER, renderId}, settings, prompt, negative,
   modelKey, materials}`. The linear image and the passes come from X2's store by the render's id
   (with the exposure and curve of its scene, so that the model sees what the person sees); the
   Fast mode's preview sends its own in the body (`INLINE`, `RPI1` binary with the `RPL1` image
   and the `RPP1` passes, ≤ 512 px). The driver is `rt-post`'s step machine: `plan` →
   per tile `tile_input` and the control (the passes' `depth` if the family loads it) →
   `sd-server` (X3b's, loaded between calls) → `accept` → retries at `RETRY_FACTOR` up to
   `MAX_ATTEMPTS`. With Intervention 0 the plan has no tiles and nothing is started: the image is
   the engine's bit for bit. Per-tile progress and cancellation like render jobs
   (`GET /api/ai/post/<id>?after=n`, `DELETE`), an orphaned post stops after 2 min without
   queries, and the image comes back once, linear (`GET /api/ai/post/<id>/image`). `/api/info`
   says `aiPost: 1`; then the page uses `src/io/ai-post.ts` (`DesktopAiService`), and the queue
   writes the AI image from that linear light with the render's exposure and curve, like the
   engine's file.
   *X7:* the model call goes through `ModelBackend` (`src/ai/backend.rs`): `LocalRuntime` (the
   `sd-server` above) or `RemoteApi` (`src/ai/remote.rs`, a remote image-to-image API called with the
   system's `curl`, the key from `<data>/ai/api-keys.json` through `curl`'s standard input), chosen by
   the post's `remote`; `/api/ai/apikeys` stores, lists masked and forgets the keys, and `/api/info`
   says `aiRemote: 1`. On the page, `src/ai/api-service.ts` routes between the local service and the
   API one, and on the web runs the pipeline itself with `post.wasm` and `src/io/ai-api.ts` (`fetch`).
   No new dependency (`AI-POST.md` §8).
9. **Updating from the application** (P5, `src/update/`): `POST /api/update/install` with `{tag,
   assetUrl, sumsUrl}` (and `size`, only for progress), `GET /api/update` and `POST /api/update/cancel`;
   `/api/info` says `updateApi: 1` and `afterUpdate`. The launcher **decides what can be downloaded**, not
   the page: only `https://github.com/<owner>/<repo>/releases/download/<version>/<file>` of the
   repository in `src/data/update-feed.ts` (which the *crate* reads at compile time, so they cannot
   differ), the package that suits this copy (installed on Windows: `-setup.exe`; portable:
   `.zip` on Windows and `.tar.gz` on Linux) and the `SHA256SUMS.txt` of the same version; a copy that
   is neither installed (`uninstall.exe` next to the program) nor portable (`portable.txt`), or a
   processor that is not x86-64, answers 409 `not-updatable`. The job, on a thread, with the system
   `curl` like the rest of the downloads (`ai/download.rs`, which now admits a merely
   bounded size): **DOWNLOADING** (the sums and the package to `<data>/cache/update/`, with resume) →
   **VERIFYING** (the own SHA-256 against the version's sum; if it does not match, it is deleted and nothing is
   installed) → **INSTALLING**: in an installed copy the verified installer waits; in a
   portable one **everything** is extracted to `<exe folder>/update-<tag>/` (the own zip reader of
   `ai/zip.rs`; on Linux the system `tar`, after checking the names and that there are no links) and
   **replaced in place** (`update/portable.rs`): each file and folder of the package, the
   executable last, takes the place of the one with its name, which becomes `<name>.old`
   (`repackshot.old.exe`, `app.old`; an executable in use can be renamed, not overwritten);
   `data/` and `portable.txt` are not touched; if a step fails those done are undone and the old stays
   where it was (`FAILED`, with the reason). The names to delete are recorded beforehand in `update.json`.
   `ready: true` says that everything is in place and the launcher waits for the
   window to close: **the page closes it** (with its question about unsaved changes if the project has
   changed since it was answered), and `--serve-only`, which has no window, exits by itself. **Only
   when the launcher has stopped** (`launcher::run`, after the server, the window and `instance.json`)
   it starts what is due, detached from the process (`DETACHED_PROCESS` on Windows, own group on Unix):
   `setup.exe /S /LAUNCH` or the new executable with the same arguments and `--after-update`. That way
   the new version never starts alongside an old one that still holds the port, the window's profile
   or `instance.json`; and since the new one takes the same port (that of `launcher.json`), the
   origin does not change. On start-up, the new one deletes the `.old` files, the `update-*` folders and the download
   (`update::start_cleanup`; on Windows it retries for a few seconds, because the old executable may
   still be closing). The installer (`packaging/windows/installer.nsi`) waits up to 30 s for
   `repackshot.exe` to be free when running silently, starts the application when done with
   `/LAUNCH` and changes nothing of what the person chose (neither the models page nor a
   desktop shortcut that was deleted). The interface (`ui/updates.ts`) asks, requests, follows the
   state every 400 ms and closes the window; full contract in `engine/crates/rt-app/README.md`.

### 5.6 · Physics: `rt-phys`, PHY1 and its *worker* (S2)

**The simulator** (`engine/crates/rt-phys`, only `std` and `rt-core`) is
extended position-based dynamics (XPBD) for rigid bodies, as in
Müller, Macklin, Chentanez, Jeschke and Kim, “Detailed Rigid Body Simulation
with Extended Position Based Dynamics” (SCA 2020): fixed step of 1/240 s with
4 substeps and one position iteration per substep, generalised
inverse masses, the quaternion advancing with `q += ½ [ω, 0] q` and the gyroscopic
term, velocities derived from the positions and restitution with the
threshold 2 |g| h. Gravity −Z, 9 810 mm/s². The API is `World`: `add_floor`,
`add_static_mesh`, `add_dynamic` (from points, a sphere or a box, with
density, friction and restitution), `step(n)`, `poses()` (per dynamic
body, the centre of mass and the quaternion: 7 `f32`), `awake_count`,
`settled`, `hash` (FNV-1a of the poses).

- **Shapes.** Each dynamic part is its **convex hull** (own *quickhull*,
  Barber, Dobkin and Huhdanpaa 1996, with coplanar faces
  merged), of 128 vertices at most; if that fails, its box oriented by
  principal components. A cloud of ≥ 26 points at the same distance
  from the centre (0.2 %) is an exact **sphere**. A multi-part body
  (a group that falls as one) is the hull of all of them. Static means
  triangles in an own BVH (median, leaves of 4), and the floor a single
  enormous triangle (±10⁵ mm) at its height.
- **Contacts.** Separating axes with Gauss-map arc pruning
  (Gregorius, GDC 2013; a triangle is a two-face hull), Sutherland–Hodgman
  clipping and at most 4 points per pair, face axes
  before edge axes, speculative margins; the coplanar patches
  of a body against the static are merged into one. Between two surfaces,
  the geometric mean of the frictions and the larger of the restitutions.
- **Friction**: Coulomb, per patch (at its centroid) with torsion
  by the patch's radius; the static one is held against an **anchor**
  that is kept from step to step while the patch does not move, the dynamic
  is an impulse of at most μλ/h; rolling resistance of 0.02 times
  the radius. These are the deviations from the paper that were needed so that
  a resting box does not drift or turn and a stack does not fall (ROADMAP, S2).
- **Sleeping**: a body whose travel in 0.5 s does not exceed what it would make at
  the rest velocity (3 mm/s or 5 % of the radius per second) falls asleep;
  it wakes when something approaches it quickly. With all asleep,
  `settled`.
- **Determinism**: `f32` and `rt_core::fmath`; the narrow phase is split into
  chunks (threads with `std::thread::scope` natively, one in wasm) and
  contacts are sorted by (body, body, triangle, feature) before
  solving, so the *hash* does not depend on the number of threads. The tests
  pin the *hash* of a drop at 60, 90, 120 and 480 steps and also check it
  compiled to `wasm32-wasip1`; `tests/physics-engine.test.ts`
  repeats the scene of `tests/fixtures/phys-drop.json` with the real `rt.wasm`.

**PHY1** (`rt-phys/src/scene.rs`; written by `src/io/phys.ts`): `"PHY1"`,
version, the meshes (positions and triangles), the bodies (static or
dynamic, density, friction, restitution and their parts: mesh and 3 × 4 row-major
object → world matrix) and the floor; *little-endian*, 4-byte words. The interface sends the dynamic ones first, in the order of
`physicsSpec`; `phys_ids` says where each ended up among the poses (or that it
has no mass and is not simulated).

**In the browser** (`src/render/physics-worker.ts`, `physics.ts`,
`phys-wasm.ts`): an own *worker* with the scalar `rt.wasm`, started the
first time a simulation runs; without `rt.wasm`, the simulation says it needs
the engine. One simulation at a time; it advances in slices of at most 24
steps, at the clock's pace at most, stores the poses at each frame of
the project's fps (step `round(k · 240 / fps)`) and sends them as soon as it has them; the page acknowledges each send and the *worker* does not go
more than 1/8 s ahead of what was received (on a loaded page the
simulation runs slower, it does not finish without being seen). Pause, resume and
stop enter between slices. On the interface side, `ui/physics.ts`
converts each frame into the local sample of each node
(`moverSample`: Δ = T(p) R(q) T(−c₀) over its earlier matrix, in the axes
of its parent) and grows the `PHYSICS` clips with `TrackWriter`, which
encodes only what is new in base64; the playhead follows them, so the viewer
shows the fall through the animation (`evaluate`, `SPEC.md` §3.7) without touching the nodes
until it is confirmed. While it runs, the viewer stays in *Fast*.

**Through the *store***: `physics/set` (the *Physics* section), and a
simulation is `physics/begin` (the clips, and the roles that *Drop*
gives), `physics/grow` (the tracks) and `physics/commit` (the final poses and
the clips' anchor), all with the same gesture: one undo entry.
`physics/reset` is another. `AppServices.physics` (`PhysicsPort`, §6.1) is the
only thing the interface knows about the simulator. S3b: `physics/begin` also carries
the camera's glass clip, and `physics/grow` its track (`glass`);
`AppServices.glass` (`GlassPort`) gives the glass as the engine places it
(§5.2 novendecies). S3c: `physics/begin` also carries the parts' clip
(of the scene), and `physics/grow` its track (`parts`); `PhysicsPort.run` receives
the WPT1 bytes (§5.2 vicies).

## 6 · Interface (`src/ui/`)

- Components = functions `(store, props) => HTMLElement` that
  subscribe and update **only** what changed (comparing references
  of the state subtree they care about). No virtual DOM.
- All strings in `src/ui/strings.ts`: `t('inspector.material.change')`
  with an `es` / `en` table; a test requires the same keys in both.
- CSS with *tokens* in `theme.css`; no colour outside it, and none
  with saturation (test `ui-achromatic`). See `UI.md` §1.
- Shortcuts in a single map (`shortcuts.ts`), which also feeds the palette
  and the tooltips.
- Interface state that is not the project's (panel widths, folded
  sections) in `localStorage`, always inside `try/catch` and with a default
  value.
- **The guided tour** (U10): `ui/tour.ts` holds the steps as data
  (each with the `data-guide` attributes it rings and what it needs on screen,
  a `TourStage`), the rules for starting, the commands (`startTour`,
  `tourNext`, `tourBack`, `endTour`) and the card's geometry
  (`placeCard`); `ui/panels/tour.ts` is the layer. What is remembered
  (`tourSeen`) goes in the `layout` of the settings document, like
  `chooserShown`, so on the desktop it is in the data folder.
- **The execution-engine notice** (U10): `core/ai-runtimes.ts`
  decides what to say (`runtimeWarning`, pure, over the launcher's report);
  `ui/ai-runtime-state.ts` holds the only polling of
  `GET /api/ai/runtime` (`RuntimeWatch`, only while someone is listening), the
  once-per-session check at start-up (the status bar's note) and the buttons;
  `ui/panels/ai-runtime-notice.ts` draws the box in the render window and in Settings.

### 6.1 · The viewer port (`src/ui/ports.ts`)

The interface does not import `render`: `main.ts` builds a `ViewportPort`
over the engine on screen and hands it over (and, since M3a, a
`GraphPreviewPort` over the graph *workers*, with which the material editor
asks for its nodes' spheres; without it, it does not draw them). It is the only
thing the interface knows about the viewer:

- **Image and size**: `kind` (`'preview'` or `'pathtracer'`), `canvas`,
  `backdrop` (the Full mode's image, under the canvas) and `resize`.
- **Geometry, which is always the preview's in both modes**:
  `pick(x, y)` (the part, the triangle, the point and the normal under
  a canvas point), `projection()` and `visibleTriangles(part, rect)`.
  - `projection(): Projection | null` gives how the parts are projected
    **as they are drawn now** (width and height in CSS pixels and
    `mvp(part)`, a part's model-view-projection matrix). Box
    selection (`core/box-select.ts`) tests the on-screen geometry with it,
    without touching three.
  - `visibleTriangles(part, rect): Set<number> | null` returns the
    triangles of a part that are **seen** within a rectangle (CSS px of the
    canvas): the preview draws the scene with a colour id
    per triangle into an off-screen target, reads the rectangle and
    counts only a pixel whose four neighbours carry the same id (an
    erosion that removes the silhouette ones that leak from what is hidden). What
    other parts or the part itself cover does not count; `null` if the viewer cannot
    say. *X-ray* does not use it: it picks by geometry.
- **Highlights**: `setHover(ids)` (outline of parts: under the cursor or
  under a dragged material) and `setHoverFaces({ part, indices } | null)`
  (the faces that a material dragged at *Faces* level would reach: a
  tint on the part, in a layer apart from the selected
  faces').
- **Tools and *gizmo***: `setTool`, `setGizmo`, `gizmoHover`,
  `gizmoBegin`, `gizmoDrag`, `gizmoEnd`. `setGizmo` carries an optional `handles`
  (U9): `ALL` (Move) or `SCALE` (Scale: only the cubes at the end
  of each axis and the centre point, which is all that is drawn and picked),
  and since L4 `MOVE` with `object` (a light or a camera: the Move *gizmo*
  without cubes, on the object, with the aim handle at its target; the
  interface converts the drag with `objectGizmoAction` of
  `core/view-objects.ts`).
- **Lights and cameras (L4)**: `setGlyphs({ all, selected, lookThrough })`
  says which glyphs the preview draws (all or the selected one's) and
  from where the viewer looks (`lookThroughCamera`; `main.ts` gives the
  tracer the same camera, `setViewCamera`, computed from each state, and
  converts navigation with `lookThroughAction` into light or
  camera actions with a gesture *token*: live and one undo entry);
  `glyphAt(x, y)` is the object whose glyph is under a point (`pickGlyph`
  of core, with three's projection) and `objectAt(obj)`, where it is on the
  canvas (the viewer copies it into `data-object-at` for checks).
- **State and thumbnails**: `status`, `onFrame`, `materialThumbnail`,
  `thumbnailsPending`; **settings**: `setNavigation`, `setDisplay`.

The simulator (S2) is another port, `AppServices.physics` (`PhysicsPort`):
`run(spec, { fps, maxSeconds }, onUpdate)` returns a simulation
(`started`, `done`, `pause`, `resume`, `stop`); `main.ts` builds it with
`writePhysicsScene` (`io/phys.ts`) and `PhysicsClient` (`render/physics.ts`).
Without it (`null`), the physics bar says the engine is needed. The
tests use a double that answers like the *worker*.

The three new methods from U7 and M1 (`projection`, `visibleTriangles`,
`setHoverFaces`) are, in `main.ts`, one line each towards the
preview. A test double of the viewer is enough to test box
selection without a browser (`tests/box-select.test.ts`); the gesture and what is
seen are checked with `tools/box-select-check.mjs` and
`tools/material-drag-check.mjs`.

---

## 7 · Tests

| What | Where | How |
| --- | --- | --- |
| Catalogues and light maths | `tests/data.test.ts`, `light-math`, `rig` | Pinned counts, formulas with numbers, 16 × 71 normalisation |
| Model | `tests/store.test.ts`, `scene`, `materials`, `doctor`… | Pure actions: given a state, the action produces the expected one; undo gives it back |
| Interface | `tests/strings.test.ts`, `ui-achromatic.test.ts` | Static invariants over sources |
| Selection and drag | `tests/faces.test.ts`, `material-drop`, `box-select` | Faces with plate, cylinder, rounding and CAD ranges; drop rules with numbers; window and crossing over projected geometry with a simulated viewer; which keys arm the box in each mouse scheme |
| Primitives and scale | `tests/primitives.test.ts`, `primitive-ops` | Each shape: watertight where it should be, outward normals, UVs in [0, 1], logical faces that cover the mesh, same bytes, exact measurements in mm and analytic volumes; where it is born (base 1.4 × the footprint, product on top, one undo entry; the infinite backdrop fills the frame and leaves the setup's lights in front of its wall), live editing and undo, save and open byte for byte, scale per axis, uniform and custom about the pivot at each level, the *Scale* handles |
| Own lights, lights and cameras in the viewer (L4) | `tests/own-lights.test.ts`, `view-objects`; `light::tests` and `integrator::tests` of rt-core; `tools/lights-check.mjs` | Adding each type in front and above, selected, one undo entry; duplicate, delete, aim, place on a surface, roll; an own setup of three lights applied to another product type keeps its total irradiance and its parts; RSB `LGHT` 3 and 4 with their flux, shadow and roll; project and library round trip; glyphs and their click, light and camera *gizmo* with one undo entry, *Look through* that moves the object and respects the lock; in the engine, `I / d²` of points, spheres and spots, the cone and its transition, the cone's flux, MIS of the spheres, the shadow off and the weight of a narrow spot |
| IES lights (L5) | `ies::tests`, `light::tests`, `integrator::tests` and `scene::rsb::tests` of rt-core, `render::tests` (L5 pinned), `rt-cli/tests/example.rs` (1, 4 and 16 threads), `tests/ies.test.ts` (with `tests/fixtures/ies/conformance.json`, which the engine tests write), `ies-lights`, `ies-switch`, `ies-engine` (with the real `rt.wasm`); `tools/ies-check.mjs` | The two hand-written profiles: the intensity the engine samples at 0°, 30° and 60° is the file's (tests of sampling and of a floor's image, to 1e-4 of the peak, and the interpolation between nodes and the orientation of φ); the flux against the closed case (isotropic `4π c`, 1000 cos² with 1° steps to 1e-4, against a numerical quadrature of the function itself); the symmetries (the same distribution written as quadrant, bilateral and full gives the same in each direction and in flux); 68 files (sound and malformed: truncated, counts too many and too few, negatives, angles, TILT, types A and B) with what the engine does, which the page's reader repeats with the same messages; RSB with the profile once for each distinct one and 80 B `LGHT`, the bytes from before without IES lights and `l5.rsb` byte for byte with the page's writer; per-point and static selection; the `FEATURE_IES` switch of the *pool* and the launcher; the same pinned value with 1, 4 and 16 threads and in the real `rt.wasm`; project, studio, setup and library; Playwright with Chromium in *Fast* and *Full* (menu, file, polar chart, multiplier, change profile, rejected file). Nine engine mutations, all detected |
| Interior camera (K3) | `scene::camera_tests` and `render::k3_tests` of rt-core, `rt-cli/tests/example.rs` (1, 4 and 16 threads), `rt-app/tests/parity.rs`; `tests/interior-camera.test.ts` (with the real `rt.wasm` and `tests/fixtures/k3-*.rsb`), `image-passes`, `panorama-browser` (Chromium), one of the *pool* in `pathtracer`; `tools/k3-check.mjs` | Straight verticals: the edges of a cube with the camera tilted 10° at 1080p, parallel to 0 px on the page and in Fast and to 0.0001 px with the engine's rays reading the page's file (7.5 and 6.4 px without them); the 30° limit, the camera that is rendered; eye height, optics, views; the panoramas' maps and their inverse, six directions in `rt.wasm` and in Chromium (and the fisheye circle, and a camera-hidden wall that is neither drawn nor picked); `CAMR` and `INST` byte for byte with `rt`, earlier files with their bytes, invalid ones; the plan: the mean under the hidden ceiling equal to that below the ceiling (+0.0000 %) and the ceiling unseen; exterior exact at half; the exposure meter (grey, clipping, logarithmic mean, sorting, limits, the progressive meter); the three pinned values on each SIMD path, threads, WASI and wasm. 28 mutations (8 in the engine, 20 on the page), all detected |
| Ambient (S4a, S4b) | `tests/effects.test.ts`, `effects-rsb.test.ts` (with the real `rt.wasm`); `rt-sim` (`eval::tests`, `params`), `render::ambient_tests`, `geometry::tests`, `geometry::particles::grid_tests`, `bsdf::forward::tests` and `integrator::particle_tests` of rt-core; `tools/ambient-check.mjs`; the sheet `tools/ambient-sheet.mjs` | The catalogue and its keys; the four actions through the *store* (undo, gestures, nothing for a value it already has, the preset that keeps place, instant, seed, cap and name); region, count and cap; the `FXAM` fields in engine units, byte for byte against those written by `rt --write-ambient-example`; the Doctor and its fix; saving and opening each field, an earlier file without effects; in the engine, the pinned positions *hash* (native and wasm, 1 and N threads), steady state at 0, 3 and 60 s (< 3 %), nothing below the floor, the image pinned on all ISAs, the reference scenes unchanged without effects, brute force against the BVH for each ray class, and the energy of the widening (4 against 256 spp, ± 2 %). In S4b, in addition: the screen grid gives the brute-force hits (pinhole and simple lens, the three shapes, particles in the camera plane); the forward lobe integrates to 1 with g as the mean cosine, is sampled with its density, the white furnace of its BSDF and of a speck gives 1, and NEE alone, BSDF alone and MIS agree (1 %); paths after a wide lobe do not see a drop without shadow (bit for bit) and cross it with the shadow's transmittance, the camera still sees it refract, and the smooth-drop rule does not change the mean |
| Section view (Q1) | `tests/section.test.ts`, `solid.test.ts`, `section-rsb.test.ts` (with the real `rt.wasm`), `section-full-browser.test.ts` (Chromium and `rt.wasm`); `geometry::section_tests`, `integrator::section_tests`, `scene::section_rsb_tests` and `render::section_tests` of rt-core, `rt-cli/tests/example.rs`; `tools/section-check.mjs` | The plane from a click and each axis, from two points and from numbers; the actions through the *store* (undo, gestures, nothing for what does not change), save and open; `SECTION` interpolated with the clip's curve, adding, split and repeated; `SECT` byte for byte against `rt --write-q1-example` and where the writer puts it; in the engine, the ray ignores the removed side and does not let it block a shadow, a box cut in half is capped with the area of its section and its colour, open meshes and thin-wall ones are not, the cut glass refracts through its cap like a solid glass that ended there, the studio (reference: model alone + studio alone = the nearer of the two, with cap and without), the pinned *hash* on each ISA and with 1, 4 and 16 threads and in wasm; the acceptance's comparison by regions (cut bottle, per-pixel agreement 1.000 and IoU of the sections 0.963, controls that fail, the whole set's floor in both and cut like an ordinary part) and the gimbal and box selection without what was removed |
| Camera optics (O1) | `optics::tests` of rt-core, `tests/optics.test.ts`, `tools/optics-check.mjs` | 6-blade pupil inside the hexagon and outside the inscribed circle in its proportion (±1 %), curved blades, profiles with their density, obstruction, mask by CDF with the rejection mean (±1 %), Scheimpflug and hinge with three points, shift, anamorphic, cat's eye with the area of two discs, bands that add up to white; a neutral lens is the simple lens bit for bit; `LENS` round trip with `rt`'s bytes; thumbnails up to date; O1 *hash* on SIMD, WASI, wasm and 1/4/16 threads |
| Traced lens (O2) | `optics::traced_tests` of rt-core, `lens_catalogue` and `lens_sheet` of rt-cli, `tests/traced-lens.test.ts`, `tests/lens-pick-browser.test.ts`, `tools/lens-check.mjs` | Paraxial focal length and flange distance of the 15 lenses that form an image within the report's tolerance; axial rays of the double Gauss parallel to < 2e-4; f32 against f64 < 1e-4 mm; batches with the bits of the single samples (lenses, cylinders, rows of the tile with filters); each lens prepared at 50 mm with its cut, its semi-apertures, its iris inside the diaphragm and its profile; unit, internal, floating and anamorphic focus (both meridians at focus, squeeze 2 at infinity); distortion against the scale near the axis at any focus; non-physical settings in the profile and in the chief rays; derived rims that let the real rays through; iris shortcuts equal to the exact edge; the simple lens's squeeze does not stretch a traced lens; the page's prescription byte for byte with `rt` for the 16 lenses; lens library; O2 *hash* on SIMD, WASI, wasm and 1/4/16 threads; the profile map without steps and round-trip; in Chromium, each safe-colour pixel picked through a strong barrel and the catalogue's fisheye gives the part drawn on it (the identity with the simple lens and no numbers), and the outline, box selection, faces' id pass and *gizmo* follow what is drawn |
| Simple and traced lenses, tilt (O4) | `optics::traced_tests` (those of tilt and shift), `render` (`PINNED_O4_TRACED_TILT_4SPP`) and `tilt_sheet` of rt-cli, `rt-cli/tests/example.rs`, `rt-app/tests/parity.rs`, `tests/lens-o4.test.ts`, `tests/lens-modes-browser.test.ts`, `tools/o4-check.mjs`, `tools/lens-check.mjs` | With the tilted traced lens, the centre sharp at the focus distance (1.5 %), the slope of the plane at 4 mm from the centre equal to the simple lens's plus the straight lens's field curvature at those heights (3.5 % in the double Gauss and the macro, 20 % in the tele and the triplet), the nine macro points on the plane (2.5 %); the framing on the focus point; the shift moves the axis its millimetres, straight or tilted; tilt 0 the straight lens bit for bit, with any axis, and without `tiltDeg` in the JSON; batches with the bits of the single samples and the centre's light (6 %); a lens with cylinders rejects it; O4 *hash* on SIMD, wasm (through the page and in CI) and 1/4/16 threads; on the page: *Simple lens* in both languages and no string says *thin lens* (or *lente fina*), the stored values unchanged and an earlier project round-tripped, no simple-lens tilt applied to a traced one, no bokeh type applied to a traced camera by any path (fails with the fix removed), going back to the simple lens with its bokeh and its advanced optics, the plane through two and three points exact, the reading as direction, the drawing over the plane, the plane through two points as one undo entry in both models; in Chromium, the sections of each model, the dial as one entry per drag and nothing clipped in English and in Spanish |
| Lens window (O2b) | `tests/lens-peek.test.ts` (with the real `rt.wasm`), `tests/lens-peek-browser.test.ts`, `tools/lens-hover-check.mjs` | Which camera is asked about and that the lens in place is the camera as is; the cache (one query per lens, the in-flight one shared, another on changing focal length, focus, f/, framing or settings, the negative answer is stored and “no engine” and failure are not, bounded); the 300 ms rest (crossing the list opens nothing), closing on leaving, with Esc and on choosing, and not reopening until the pointer returns; the cards with only the engine's numbers (loading, no engine and denied, with no numbers or drawing; es and en); placement inside the window; the numbers of lenses that are not on the camera against the real engine's. In Chromium, over the real section: it opens next to the list and next to the chip with the name, the source, the drawing and the numbers of that lens, takes neither focus nor pointer, the keyboard opens it and moves it from lens to lens, and choosing sets the lens. With the real application and engine: the window's numbers are the section's when the lens is set, and passing again does not ask the module again |
| Drops and front glass (S3) | `rt-sim` (`params`, `eval::tests`), `geometry::particles` (`tests`, `grid_tests`), `geometry::tests`, `integrator::particle_tests`, `optics::glass::tests` and `render::s3_tests` of rt-core, `rt-cli/tests/example.rs` (1, 4 and 16 threads), `rt-wasm`; `tests/s3-drops.test.ts` (with `tests/fixtures/s3-drops.rsb` and `s3-glass.rsb`, which `rt` writes, and the real `rt.wasm`); `tools/s3-check.mjs` | The 228 B payload and the 200 B one without S3 fields; the drop follows its velocity with its length (and the tip's minimum), at rest by its normal; the shape changes no position, the mix gives its parts (± 1.5 % over 40 000), each particle keeps its shape; the variation stretches drops and streaks by the same factor; the drop's hits against a march of its exact distance and its normal against the gradient, a tiny drop at 2 m, the widened drop as a scaled copy with its coverage and its box within the margin; the grid and the BVH against brute force with drops and with a mix, and the mix against four single-shape sets; the discs of a mix, thin walls, and their drop, solid; the glass: the payload, two drops that touch add their volume (± 1e-5), no drop touches another, the same drops with another focal length and in a viewer's image, the ray through the centre of a drop with its Fresnel, a drop that brings parallel rays to its focus `R / (n − 1)` (± 8 %), the edge of a 90° drop that brings nothing, opaque and half-opaque dust; a glass with nothing that changes not a bit of the image or the passes, and a drop that turns the scene upside down; the page: the bytes of `FXAM` and `GLAS` against those of `rt`, what goes to an engine without the bit, the *store*, the files and the pinned values with the real `rt.wasm`; Chromium: the gallery, the drop and the mix in *Fast*, the glass in *Full*, achromatic chrome. Fourteen engine mutations, all detected |
| Effect filters (O3a) | `optics::filter_tests` of rt-core, `tests/lens-filters.test.ts`, `tools/lens-filters-check.mjs` | Grades → `s`; white diffusion that keeps the mean (±0.5 %), black at 1 between 0.90 and 0.97, gold towards red; 6-point star with six streaks (±2°); three grade-0 filters = no filter bit for bit; the connection with the lights and its MIS against scattering alone (image ±3 % and exact sum per lobe, also with half a light); `LENS` with slots round-tripped and O1's byte for byte; tint only in the halo and the streaks (gold with a neutral core; the floor away from the sheet's lights moves its blue/red < 3 % at 1 and < 6 % at 2 with gold and streaks); star that lengthens with grade without widening, net with the cross short and fainter than the star, glow as a cloud of glints and not a ring; the viewer's approximation against the engine in the furnace (< 2 %); O3a *hash* on SIMD, WASI, wasm and 1/4/16 threads |
| Textures in the engine (M2b) | `texture::tests` of rt-core (with `tests/fixtures/texture-mapping.json`, which `tests/texture-mapping.test.ts` pins against `core/textures.ts`), `render::tests` and `passes_tests` (M2B pinned), `rt-cli/tests/example.rs` and `rt-app` (threads); `tests/textures-engine.test.ts` (with the real `rt.wasm`), `tests/textures-full-browser.test.ts` | The five projections and the labels at 858 fixture points (±2·10⁻⁵ relative), gradients against finite differences, *mipmaps* in linear, level of detail and camera footprint, normal-map frame, cut-out and coverage also in shadows, labels in order with their edge; RSB round trip, old files and `m2b.rsb` byte for byte with the page's writer; the same pinned value with 1, 4 and 16 threads and on each SIMD path; comparison by regions with *Fast* in Chromium (≥ 97 % of settled pixels, control moved one square < 15 %; label with intersection over union > 0.9) |
| Material programs in the engine (M3b) | `program::tests` and `program::scene_tests` of rt-core (with `tests/fixtures/material-programs.json`, which `tests/material-program-cross.test.ts` pins against `core/material-interp.ts`), `integrator::tests`, `render::tests` and `passes_tests` (M3B pinned), `rt-cli/tests/example.rs` and `rt-app` (threads, `features`); `tests/programs-engine.test.ts` (with the real `rt.wasm`), `tests/programs-full-browser.test.ts` | 172 cross-check cases bit for bit (the ten examples at 1000 points, each instruction, the special cases); point-by-point values in the part's space, the normal, the cut-out also in shadows, the emission and the emitter that stops being a light, the bevel weight, the curvature, the level of detail, the ranges; `PROG` round trip, old files, new version, invalid ones and `m3b.rsb` byte for byte with the page's writer; the switch of the *pool* and the launcher; the same pinned value with 1, 4 and 16 threads and on each SIMD path; comparison by regions with *Fast* in Chromium (seven graphs at 100 % of settled pixels with correlation ≥ 0.99, control sunk; hue within 40) |
| Sets (L6) | `tests/sets.test.ts`, `data`, `rig`; `tools/setup-thumbs.mjs`, `tools/sets-sheet.mjs` | The 72 earlier setups without new fields and with the same rig as before against the 16 types (fixture); the product types with their set's lights at their level; no card in the frame (16 focal lengths, three shapes, three aspect ratios, the set's camera: polygon clipping against the camera pyramid, and a visible case so that the test does not pass on its own); apply, replace, remove with another setup and with *Reset*, *Create studio* with a set, one undo entry; the decoration is neither the product nor looked at by the Doctor; the pool (its share of the level, where it falls, its power); *Use the set’s camera*; the gradient as the RSB's background image; the thumbnails: each one's RSB scene as the code builds it now and the manifest's PNG, and the *hash* of one pinned; measurements on the thumbnails with the acceptance thresholds in `LOOK` (`tests/thumb-metrics.ts`; `REPACKSHOT_SET_MEASURES=1` prints them) |
| Browser gestures | `tools/material-drag-check.mjs`, `box-select-check.mjs`, `primitives-check.mjs` (U9), `lights-check.mjs` (L4), `sets-check.mjs` (L6) | Playwright with the local Chromium over `dist/`, in Fast and in Full, with mouse, pen and finger; captures in `docs/ui/` (those of Full, in `out/`) |
| Rain and dust on the glass (S3b) | `cargo test -p rt-phys --test wet` (also on `wasm32-wasip1`); `rt-core` `optics::glass::tests` and `render::s3_tests`; `tests/s3b-wet.test.ts`; `tools/s3b-check.mjs`; the sheet `tools/rain-dust-sheet.mjs` | A drop on glass at 30° stays up to Furmidge's critical radius (± 0.5 % of the `f64` calculation) and slides above it; two that touch add their volume (± 1 %); the trail cleans the dust; dust on a 60° face is < 10 % of that on a horizontal one; rain arrives at its flux and never on a face looking the other way; the same glass by single steps or together and rebuilt from its frames; the two pinned values on every SIMD path and in wasm; the `WET1` and the `GLAS` drop by drop byte for byte; the track (the cache) equal in two runs; the camera's clip, saved and opened; the bar runs it alone, one undo entry, *Reset* removes it; the approximation of *Fast* |
| Rain, dust and snow on the parts (S3c) | `cargo test -p rt-phys --test wet_parts` (also on `wasm32-wasip1`); `rt-core` `weather::tests`; `rt-wasm` `parts`; `rt-cli/tests/example.rs`; `tests/s3c-parts.test.ts` and `tests/s3c-warning.test.ts`; `tools/s3c-check.mjs`; the sheet `tools/rain-dust-sheet.mjs` | The glass at 30° up to the critical radius and the trail's film; from face to face and the dripping over an open edge; merging ± 1 %; the trail cleans the dust; dust at 60° < 10 %; rain at its flux, never on a face turned away nor under a roof; hanging and dripping onto what is below, splashing without losing water; the film at its pace; the snow where it rests; by steps and by frames; the two pinned values on every SIMD path, with 1, 4 and 16 threads and in wasm; a `WETP` with nothing changes no pixel; the WPT1 byte for byte; the track equal in two runs; the scene's clip, saved and opened; the bar runs it alone; the warnings of bits 7 and 8 |
| Physics (S2) | `cargo test -p rt-phys` (`tests/rigid.rs`); `tests/physics.test.ts`, `physics-engine.test.ts`; `tools/physics-check.mjs` | A sphere rests at `r ± 0.1` mm, a stack of three boxes holds for 5 s, a tilted box falls flat, a cube slides off a sphere, a ramp holds at μ 0.6 and lets it slide at 0.1, a thousand spheres settle (< 20 s in *release*), sleeping stops the simulation, pinned *hash* equal with 1 and N threads and in wasm; what is simulated, the poses back to the nodes, a simulation is one undo entry, *Reset* another, *Pause* freezes what is seen, the clip is saved, opened and played; three primitives that fall in the browser |
| Engine Doctor (D1) | `tests/doctor-engine.test.ts` (a fake engine that simulates each state and the real `installDoctorFacts`), `tests/frame-scan.test.ts` (the reading of the accumulation and the pool's `status().scan` with fake *workers*), `tests/store.test.ts` (a listener's actions during an undo); `tools/doctor-engine-check.mjs` | Each check fires and its fix clears it (project through the *store*, one undo entry; what is not the project's, only the explanation and, if a Settings row limits it, the button that opens it); *Fix all* in one click; without engine facts, everything *unavailable* as before; thresholds at their boundaries; `sameImage` agrees with `touchesImage` of both engines; the phrases in both languages; in the browser, the Doctor with two engine warnings (`docs/ui/doctor-engine.png`) |
| Viewer | `npm run screenshot` | Capture with the local Chromium (swiftshader); attached to the PR |
| Engine (E· phases) | `engine/crates/*/tests` and `cargo test` | Analytic scenes (furnace test, a panel's form factor, mirror against the dome) with numerical tolerances; determinism (same hash with 1 and N threads); wasm/native parity; SIMD against scalar; cross-compilation to ARM64 and RISC-V; `clippy -D warnings`; `Cargo.lock` without external sources |
| Contact sheet | `tools/contact-sheet.mjs` + `rt` | 16 studios × chosen setups rendered in CI with the native binary, with mean, burnt-out highlights and blocked-up shadows per image; attached to the PR |

Non-negotiable rules:

1. No change ships without `npm run qa` green.
2. Every fixed bug carries its test, and it is checked that the test **fails**
   if the bug is reintroduced.
3. If a bug slips through because a test was more permissive than reality
   (a *mock* that does not behave like the browser, a simulator that
   admits what three does not), the test or the
   simulator is fixed too.

---

## 8 · Project format (`.repack`)

**Extension.** The file is saved as `.repack` (B1, on request);
the content is the same JSON as always. Up to v0.1.6 it was called
`.repack.json`: both are still opened (`core/project-names.ts`:
`PROJECT_EXTENSION`, `PROJECT_EXTENSIONS`, `isProjectName`), both in the
browser's picker (`accept` and `types`), in the desktop dialog
(a single filter with `repack` and `repack.json`, the first being the one that
a save dialog adds to a name without an extension) and when dropped on the
window. The launcher writes `.repack` (`WRITABLE_EXTENSIONS` of
`rt-app/src/files.rs`) and remembers either as the last project.
There is no association of the extension with the program in the installers (double
click): it was not requested, and is left for a packaging phase.

`{ "format": "repackshot-project", "schema": 2, "state": ProjectState,
"meshes": [{ "id", "glb", "sharpEdges"?, "triangleSource"? }] }` (U2). The
meshes are stored **inside**, one GLB in base64 per mesh used (valid glTF 2.0,
with the Z-up mm → Y-up m transform for other
viewers, which the reader ignores); next to it go the sharp edges and the re-smoothing
map, which glTF does not have. The external reference by path is left
for later. The schema versions only `state`; migrations live in
`io/project.ts` and are tested with one fixed file per version
(`tests/fixtures/project-v1.json`, `project-v2.json`). On opening, mesh ids
that would collide with other geometry move to a `prjN:` prefix,
because the preview and the workers cache by id. **Environment
images** (E5): an optional block `"images": [{ "id", "name", "file" }]`
with the HDRI and the background image as the files they were (`file` in
base64); it is written only when the environment has any. On opening they are
decoded again (`placeImages`): an image whose id already names another in
the session gets a new id, and one that is missing or cannot be read is removed from
the environment (the dome lights, the colour is seen) with the `MISSING_IMAGES` warning,
without preventing opening. The schema stays at 2: the environment's new fields
have a default value. **Primitives** (U9): a part made with
*Add ▸ Primitive* stores its shape and measurements in the optional
`primitive` field (`{ "kind": "BOX", "params": { "width": 88.5, … } }`) of its node,
and its mesh does **not** go in `meshes`: on opening it is generated again from the measurements
(normalised), under the id it had (`prim:<owner>:<SHAPE>:<measurements>`, which
names the content), with its `MeshRef` and its `faceRanges`; a project with
primitives is saved, opened and saved again to the same bytes.
A file without the field opens as always; a shape that this version does not
know (a newer file) is left without the field and its part without
geometry, with the `MISSING_MESHES` warning; a `primitive` that is not an
object is damage. The schema stays at 2. A version earlier than U9 that opens
a project with primitives will not see them (no mesh in the file): only
backward compatibility, as decided. The engine receives the mesh like any
other: the RSB does not change.

**Ambient** (S4a). `state.effects` is the list of effects (SPEC §3.1),
their parameters and nothing else: particles are not stored, they are evaluated. A
file without the field (earlier than S4a) opens with an empty list; on opening,
`normalizeEffects` removes what is not an effect (or repeats an id), completes
the missing fields with the values of its preset and leaves with the first available
preset (and its parameters) a preset that this version does not know.
The schema stays at 2. The Doctor is run again on opening with
this version's checks: an earlier file brings its own without
`particles`.

**Section** (Q1). `state.section` is the section-view plane
(SPEC §3.1): `{ enabled, point, normal, cap }` or `null`. A file without the
field (earlier than Q1) opens without a plane; on opening, `normalizeSection` takes a
broken plane (without a normal, with numbers that are not numbers) as none, completes
the missing flags (on and capped) and makes the
normal unit length. The schema stays at 2 and there is no migration. The `SECTION` clips of
the animation are ordinary clips, with target `{ kind: 'SCENE' }`.

**Textures** (M2a). The images of the slots and of the materials' labels
go in the same `images` block, after the environment's, once each, as the PNG or JPEG
file they were, under the id that names their
content (`tex:` and 16 hexadecimal digits of their SHA-256,
`core/texture-images.ts`): a project saved and opened in another session
comes back with the same bytes and the same ids, and is saved again to the
same bytes (test). On opening they are registered without decoding
(`placeTextureImages`): one that is missing or is neither PNG nor JPEG removes its slots
and its labels and counts in `MISSING_IMAGES`. Each material's `textures` are
read with `normalizeTextures`, which also understands the flat form from before M2a
(`projection`, `scale`, `rotationDeg`, `offset`, the
slots as text that was never filled): the projection, the roll and the
offset move to the mapping, the scale to the repeat. The schema
stays at 2; an earlier version opens a project with textures without seeing them.
Meshes store their second UV set as the GLB's `TEXCOORD_1`, only
when they have one (a mesh without it writes the usual bytes).

**Physics** (S2). A node may carry its *Physics* section in the
optional `physics` field (`{ "role": "DYNAMIC", "density": 2500, "friction":
0.4, "bounciness": 0.1, "asParts": true }`, each key optional) and the
animation `PHYSICS` clips with their track (`track`: `{ "fps", "frames",
"data" }`, `data` the 7 `f32` per frame in little-endian base64) and their
anchor (`anchor`: `{ "position", "rotation" }`). It is all state JSON; there
is no new block. On opening, the section keeps what this version
knows (an unknown role or an out-of-range number is removed), a `PHYSICS`
clip whose track does not decode is removed, and a damaged anchor too
(the clip then plays its frames as they are). A project from before
S2 opens the same (`tests/fixtures/project-v2.json`). The schema stays at 2.
On opening, the Doctor is run again over the state read (also in
`migrateProject`), not only in `loadProject`.

**Material graphs** (M3a). A material in *Nodes* mode carries `graph`
(`{ "version": 1, "nodes": [...], "links": [...] }`, §5.2 quater); one in
*Simple* mode does not have the key (as before M3a). On opening it is read with
`normalizeGraph`: nodes of types this version does not know and their
connections are removed, a single output (added if missing), connections that
fit (types that convert, one per input, no cycles), values
within their range; a graph from a newer version is removed and the
material opens as *Simple*, with its parameters. The images of its image nodes
go in the `images` block with those of the textures, and one that is
missing leaves its node without an image. A graph saved and opened is the same
graph and is saved again to the same text (test). The schema stays at
2.

**Job studios** (N2b). `state.render.studios` is the list of
copies of the saved studios in which the queue's jobs render:
`[{ "hash", "studio" }]`, `studio` the `SavedStudio` as `restoreStudio`
puts it (`core/lighting.ts`; with its `id` and its `name`) and `hash` the
hexadecimal SHA-256 of its content without id or name, in JSON with the
keys sorted (`studioHash`, `core/job-studios.ts`), so the same
copy comes out the same whoever writes it. There is **one copy per id and
*hash***, whichever jobs use it, and each job names it with the
optional `studioCopy` field (the *hash*; its `settings.studio` is still
`{ kind: 'ONE', id, name }`). Only the copies that some job names are
stored (`pruneEmbedded`, in the *reducer*: removing the last job of a
studio removes its copy, and undo gives it back). Large things do not go twice:
the lights carry their IES profile in the JSON, like the project's (L5), and the
HDRI, the background image and the copy's textures are `ImageRef`s whose
files go in the `images` block with the project's, **once each
image** whoever names it (a studio with the project's HDRI
adds only its JSON). On opening, `migrateRender` takes the entries shaped
like a copy (a 64-digit *hash*, a studio with id and name, no repeats)
and `checkState` reads each as the project's blocks: its environment, its
image and its camera are completed with the values of a new project and the types
are checked, the IES profiles of its lights are read
(`withReadableProfile`), its materials like the project's (`textures`,
`graph`) and each material its parts name must be in it;
a damaged copy is removed, not the project (its job then looks for the
studio in the library, as before). `placeImages` and `placeTextureImages`
place its images with the project's and change the ids the same way
(an id that names another image in the session becomes a new one in the project
and in its copies at once). The stored *hash* is not recomputed on opening: it is
the copy's name. A job renders in its copy; without it (a
file earlier than N2b or a removed copy), in the library studio
of that id; failing that, in one that the project stored inside (`studio.saved`);
failing that, it fails with the reason (`resolveStudio`). A file earlier than N2b has
neither the list nor `studioCopy` and opens the same; an earlier version that
opens a new one ignores both fields and looks for the studios in its library.
The schema stays at 2.

---

## 9 · Plugins (P6)

A plugin is a tool from another program that works inside
Repackshot: the host gives it pixels and receives pixels. The user
installs it (*Settings ▸ Plugins*), under its licence, and it never touches the DOM or the
*store* (§1: it is not a dependency).

### 9.1 · The `.rpk` package

A single file (`src/plugins/rpk.ts`, shared by the page and by the
tools in `tools/`, which read it with Node 22.18's type stripping
or later and Node's `webcrypto`):

| Bytes | What |
| --- | --- |
| 4 | `RPK1` |
| 4 | header length, `u32` *little-endian* |
| n | **plaintext header**, UTF-8 JSON: `id`, `version`, `abi`, `bytes` (length of the ciphertext, tag included), `sha256` (hexadecimal, of the ciphertext), `nonce` (12 bytes, base64) |
| `bytes` | **AES-256-GCM** (WebCrypto) of the container, with its 16-byte tag at the end |

The container is flat: `RPKC`, `u32` version 1, `u32` number of entries and,
per entry, `u32` name length, the name (UTF-8, a relative path with
`/`, no `..` or leading dots), `u32` length and the bytes. In the film
package: `manifest.json`, `plugin.js`, `module.wasm`, `presets/`, `logo.svg`,
`LICENCE.txt`, `NOTICES.txt` (and `recipes.json`, `engine.json`). The encryption
authenticates, as additional data, the magic and all the header's fields
except the `sha256` (which is of the ciphertext itself): a hand-edited header (another
version, another `id`) does not open. On opening, first the header, the length and the
`sha256` of the ciphertext (*damaged*, without decrypting anything); then the GCM tag
(*the key does not open this package, or the package was tampered with*); then the
container. `tools/plugin-pack.mjs <folder> <output.rpk> (--new-key | --key
<b64> | --key-file <file>)` checks the manifest (`core/plugins.ts`) and that
the files it names are present, packs and encrypts, and prints the size and the
`sha256` of the file (what the registry pins); with `--new-key` it prints the key
**only on standard output**. `tools/plugin-unpack.mjs` opens it (tests, and
reviewing a package before publishing it).

**The key and what the encryption protects** (decision 1 of P6, as is): the
**activation key** (32 bytes, base64) **is not in the repository** (the
host is source-available: it cannot keep secrets): it arrives through
the registry's `keyUrl` (a developer URL, which may rotate it or
make it conditional later) or the user types it on installing. The package is
stored **encrypted** (IndexedDB, also in WebView2) and the key apart; it is
decrypted **only in memory** on loading, and never written in plaintext. What this
protects: the module at rest and in transit, and that the package is of no use outside
Repackshot without the key; what it does not: someone who debugs the browser with the key in
hand.

### 9.2 · Registry, installation and store

`src/data/plugins.json` (with its typed loader, `src/data/plugins.ts`) is the
registry, like `ai-models.json`: per plugin `id`, `name` (es/en), `publisher`,
`version`, `summary` (es/en), `licence: { kind: 'closed', label }`, `homepage`,
package `url`, its `sha256` and its `bytes`, `keyUrl` (empty: asked for on
installing) and `logo` (a file of the package, or an inline SVG `data:`; the film
one's is from the package: it is not in this repository). Keys are added,
not renamed. The test build (`vite build --mode plugin-test`) additionally accepts
`?testPlugins=<base64 of the JSON>`, for the browser check; in
the other builds that branch does not exist.

Installing from the registry (`src/plugins/host.ts`): download → the registry's size and
`sha256` → the header (its `id` and `version` must be those
of the registry; the ciphertext's `sha256`, the header's) → the key: the one an
update already has, the one from `keyUrl` or the one the user types
(`NEEDS_KEY`: *no address*, *the address failed*, *that key does not open*,
*that is not a key*) → the package opened in memory and its manifest
checked → stored. Installing from a file: the same from the header, with
the typed key. The store (`src/plugins/store.ts`) is an IndexedDB database,
`repackshot-plugins` (version 2), with three stores: `packages` (the `.rpk` as
it arrived, encrypted) and `keys` (its key), written in a single transaction, and
`thumbs` (the recipe cards' images, PNG, by `plugin@version:recipe`,
with an index per plugin: what the plugin returned from its base image, nothing from the
package in plaintext); without IndexedDB, in memory for the session, and *Settings* says
so. Removing deletes all three.

When used: the package is decrypted in memory, the manifest is checked
again, the WebAssembly module is compiled (`WebAssembly.compile`, never synchronously
on the main thread) and, if the manifest declares `wasm.noImports: true`, a module whose
`WebAssembly.Module.imports()` is not empty is rejected; `plugin.js`
is made into a Blob URL that starts a **module-type Worker** without DOM, and the
`init` message **transfers** to it the module's bytes and the files listed by
`files`. The Blob URL is revoked as soon as the plugin answers `ready`. The session
lasts until the plugin is removed, updated or stopped (a cancelled *Apply*
stops the Worker).

### 9.3 · The manifest

`manifest.json` (`parseManifest` in `src/core/plugins.ts`, which names each
problem): `abi: 1`, `id`, `name` (es/en), `version`, `publisher`, `licence: {
kind: 'closed', label (es/en), file }`, `homepage` (https), `summary` and `notice`
(es/en; the *preview of an app in development* notice), `logo`, `slots:
['render.plugins']`, `entry: 'plugin.js'`, `wasm: { file, noImports } | null`,
`notices` (the third-party notices file), `base?` (decision 8: a PNG from the
package, the base image of its recipes: what the preview shows without a
result and what the cards carry; the host reads it, it does not go to the
*worker*), `groups: [{ id, label }]`, `controls` and `files`. A control: `{ key,
label (es/en), kind: 'slider' | 'select' | 'toggle', group, default, aux? }`,
with `min`, `max`, `step`, `unit?`, `minLabel?` (what is read at its left
end: there the plugin keeps the recipe's value) and `role?: 'seed'` on
a slider (decision 9: the seed of what the plugin draws at random; an
integer slider of step 1, one per manifest) and `options: [{ value,
label }]` in a list. The interface draws the block **only** from the manifest
(`controlGroups`); the values are stored in `RenderSettings.plugins[id] = {
recipe, controls, jobs? }` (undoable, with the project; an earlier project
has `{}`; those of a plugin that is not installed are kept) and are checked
against the manifest where the plugin runs (`controlsFor`: in its range and its
step, of its type, or the default value). `jobs: true` (decision 9) sends through
the plugin each image of a queue job (`ui/render-queue.ts`, after
saving the engine's): a still image with the seed set (`seed0`), each
frame of an animation with `frameControls`: `seed0 + frame`, the frame
index in the animation (its number minus one), wrapping around the slider's
range (`frameSeed`, rule `SEED_RULE = 'seed0+frame'`); the image is
saved as `<name>_<plugin>.png` (JPEG for a JPEG job) and the first
also goes into the history with `provenance.seed = { control, seed0, frame,
rule }`.

**The recipe cards** (decision 8, `PluginsService.thumbnails`): the
base image, reduced to half (`THUMB_SIZE`, 160 × 100) in linear light, for
each recipe (and for none) with the default controls; the stored ones are delivered first
(`thumbKey(plugin, version, recipe)`) and the missing ones are made **one
at a time**, each only when no preview, no
*Apply* and no job image is in progress (the service counts those and the cards
wait until none is left), and they are stored on arrival; stopping halfway
keeps those made. A preview without a result is the base image through the
plugin (`run` with `result: null`).

### 9.4 · ABI v1

Messages only (`src/plugins/abi.ts`):

| Direction | Message | Response |
| --- | --- | --- |
| host → plugin | `init { abi, manifest, files, wasm }` (once, first; *buffers* transferred) | `ready { abi }` |
| host → plugin | `info { id }` | `info { id, info: { name, version, engine? } }` |
| host → plugin | `presets { id }` | `presets { id, presets: [{ id, name, category, aux?, tags? }], categories: [{ id, label }], filters? }` |
| host → plugin | `render { id, width, height, pixels, recipe, controls }` | `render { id, width, height, rgba8, info: { items } }` |
| host → plugin | `cancel { id }` | `cancelled { id }` if it had not started |
| plugin → host | `error { id, message }` (`id` null: the plugin itself) | — |

`pixels` is `{ kind: 'linear-f32-planes', data }` (3·w·h `f32`, red, green
and blue planes: working-space linear light, Rec. 709, values above 1
kept) or `{ kind: 'rgba8', data }` (w·h·4 bytes of sRGB image, straight
alpha); the host sends the planes when the result is an EXR (its light,
without going through 8 bits; the alpha comes from its screen image) and RGBA8 otherwise,
and puts the source's alpha back onto the response. `info.items` are
`{ key, label (es/en), value, unit? }`: the host paints them as they are and
computes none (rule 10); the time is measured by it around the render.
`filters` (P6b) are the recipe filters that the plugin offers, `[{ id, label,
options: [{ value, label }] }]`, and `tags` the values of each recipe for them
(`{ [filter id]: value }`); `cleanPresets` leaves only those of offered
filters and values. The host draws and applies them without knowing what they are
(`activeFilters`, `presetMatches`, `filterPresets` of `src/core/plugins.ts`: they
combine, a recipe without a filter's *tag* is only in its *All*, the
chosen one is kept) and stores the chosen ones in `RenderSettings.plugins[id].filters`;
the carousel's slider is arithmetic in `ui/strip-math.ts`. A
cancelled preview that arrives late is discarded.

### 9.5 · The film plugin (aintfilm)

`tools/plugins/build-film.mjs --aintfilm <checkout> [--out <folder>] [--rpk
<file> (--key-out <file> | --key-file <file>)]` assembles the folder from
an aintfilm *checkout* (which it only reads): the module
(`public/engine/itsnotfilm-engine.wasm`, checked to have no imports and to have the
exports the glue uses), its *presets* (`src/engine/presets/`)
completed with the *checkout*'s own reader (`settingsFromValue`: each one
with all its fields, as its *serde* reads them) and renamed to neutral ids, the
logo (decision 7, `tools/plugins/dot-grid.mjs`: `logo.svg`, a `rect` per
dot with the corners rounded to the dot's circle, in square cells;
with `--logo <image>`, from **the owner's logo image** —white dots
on black—, read dot by dot: the columns and rows of dots wherever there
is ink, each dot's ink its grey, the greys grouped into the levels that
the image has; without `--logo`, from the rows of the `LOGO` grid of its
`src/data/marks.ts` with the rule of its `DotGrid` —a grid with a space is
two-ink and its `.` are dots in the faint `#4A4A4A`—; the image wins: it is
what is called the logo), the licence (`LICENSE` → `LICENCE.txt`) and the
third-party notices (`public/THIRD-PARTY-NOTICES.txt` → `NOTICES.txt`); from these,
the manifest (`tools/plugins/film/manifest.json`, with its version and its list of
files), the glue (`tools/plugins/film/plugin.js`) and the base image of the
cards (`tools/plugins/film/thumb-base.png`: the `film-thumb` scene of
`rt-cli`, the perfume bottle of `glass_bottle` next to the table lamp of
`lamp` in its dark room, with the lamp lit, 320 × 200, written with
`rt --write-film-thumb` and rendered with `rt <scene> -o thumb-base.png
--samples 512 --denoise`: 8-bit sRGB PNG, what `rt` writes, which the
glue receives through `inf_render_rgba` like any PNG result).
`--key-out` cannot be inside this repository.

**The glue** (ours): follows the module's C ABI rule —every
*buffer* is reserved in its memory with `inf_alloc` and returned with `inf_free`,
and **a view is never kept between calls**: each is taken from
`memory.buffer` at the moment of use— and uses two entry points:
`inf_render_rgba` (8-bit RGBA, sRGB) and `inf_render_linear_rgba` (the linear
planes with an **empty** side record: version 1, no profile or mask,
count 1, no base exposure, shot balance 1, factors 1; 4·(14 + 3·36)
bytes). A recipe is a complete *preset*; the controls (those of aintfilm's recipe
editor: negative format, exposure and push, colour and its
model, contrast, saturation, warmth, print exposure, print or
scan, grain —amount, size, colour, tonal bias, softness, scanner
focus, response to light, scan—, halation —amount and radius—, diffusion
filter and grade, lens character and intensity, grain engine and seed)
switch off a stage, choose a format, a filter or a lens (its block, from its
*preset*) or **scale a value that the recipe already brings**; at their *Recipe* end they
send nothing. Renders are queued one per task, so a `cancel`
that arrives before its turn discards it.

**Public names** (aintfilm's rule D112: no manufacturer or
product name where the public can see it): a film is its neutral id in capitals
(*CN-01*, the catalogue's rule until the owner chooses the names, D113) with
its ISO; the filters and the formats, D112's words (*BLACK DIFFUSION 1/2*,
*INSTANT 54×86*…); the grains and the lenses, generic words. The
*build* passes the brand check (`tools/plugins/brand-scan.mjs`, the
mechanism of aintfilm's `scripts/check-brands.mjs` rewritten here, with the list
of *hashes* from the *checkout*, which is not copied) over the folder and over the strings of
Repackshot: what the public sees has to come out clean or the *build* fails; the
engine's internal labels (inside the module and the *presets*' settings: a filter's
type, a paper's key, two format ids) belong to the
*checkout* (its M38-07 and M38-08) and are counted by *hash*.
