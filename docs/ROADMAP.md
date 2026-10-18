# Roadmap — Repackshot

What has to be done, in what order, and **which model executes each
phase**. It is self-contained: each phase can be executed by reading this
document, the ones it links to (`SPEC.md`, `ARCHITECTURE.md`, `UI.md`) and
the repository.

---

## Context (read first)

Repackshot is a KeyShot-style product renderer, source-available and free
for non-commercial use (PolyForm Noncommercial 1.0.0), written from scratch
in a **clean room** (rules in `../README.md`, non-negotiable) and running in
the browser. Its pillars: product types, a catalogue of light setups by
style with exposure normalisation, materials with procedural wear, the
Doctor, tiered selection, photographer's language, and a guide with arrows
that does not cover the subject.

**Key files:**

- `src/core/` — pure data model and *store* (`ARCHITECTURE.md` §4)
- `src/data/` — catalogues: 16 studios, 72 light setups, 77
  materials, wear, optics, motions, sequences, Doctor
- `engine/` — **the engine**: Rust from scratch, dependency-free, portable
  (`ARCHITECTURE.md` §5.1); `rt-core`, `rt-cli`, `rt-wasm`
- `src/render/` — preview (three.js) and the bridge to the engine in wasm
  (`ARCHITECTURE.md` §5.0, §5.3)
- `src/ui/` — the interface (`UI.md`)
- `tests/` — vitest; `tools/screenshot.mjs` — capture with the local Chromium
- `.github/workflows/qa.yml` and `engine.yml` — both suites run on every
  pull request; the engine's cross-compiles to ARM64, RISC-V and wasm

**Non-negotiable working rules** (expanded in `../CLAUDE.md`):

1. No change ships without `npm run qa` green (and `npm run
   engine:test`, `clippy` and `fmt` if it touches the engine).
2. Every fixed bug carries its regression test, checked to fail if the bug
   is reintroduced.
3. One phase per PR; when it closes it is marked here with a paragraph on
   what was done and what did not fit the plan.
4. Achromatic chrome; strings in `es` and `en`; everything through the
   *store*; stable catalogue keys; no KeyShot binaries or resources; **no
   external dependency in the engine** and no code from another renderer.
5. What is marked **Fable** is not decided by another model: the ground is
   prepared and noted.

---

## How to use the executor column

Each phase carries the model that executes it. The criterion is the kind
of work, not the difficulty:

- **Fable** — decisions with no test to stand in for them: architecture,
  contracts, photography (the numbers of a recipe, sign-off on a render),
  visual judgement of the interface, review of what was delivered. It
  writes the phases; it does not execute them unless they are data only.
- **Opus** — construction with a large design surface and many coupled
  decisions: the interface, the Rust engine (BVH, integrator, materials),
  the complex importers, animation. It reads the phase, executes it in
  full and notes what did not fit.
- **Sonnet** — mechanical work with a clear, testable correctness
  criterion: porting data, implementing reducers over a given contract,
  simple importers, generators, invariant tests.
- **Haiku** — maintenance: CI, templates, versions, changelog, strings,
  clean-up, syncing documentation with what was done.

If a phase turns out larger than expected, the agent **does not split it
on its own**: it delivers what closes with tests, notes what is missing as
a proposed sub-phase, and leaves it here for Fable to distribute.

### How a phase is launched

Whoever directs the project opens a session with the indicated model and
gives it this brief, changing only the identifier:

> Execute phase **U1** of `docs/ROADMAP.md` in the Repackshot repository.
> First read `CLAUDE.md` and the documents the phase links to. Work on a
> branch, with `npm run qa` green, open a PR with the template and
> mark the phase as done in the roadmap with a paragraph on what you did
> and what did not fit. Do not touch other people's phases or the
> contracts; if something does not fit, note it and carry on.

For a **Fable** phase the brief is the same, and what is expected is
written decisions (data, contracts, review), not code.

---

## Milestones

| Version | What can be done | Phases |
| --- | --- | --- |
| **v0.1** — "looks like the product" | Opens in standard mode; imports glTF, OBJ, STL, FBX, 3DM, 3MF, PLY, DAE and USD with the import sheet; product type, catalogue materials, light setup; the Rust engine rendering progressively in the viewer and to PNG, in the browser and on the command line. **First release `v0.1.0`** (requested by the owner): in addition, what was already done of v0.2 (U3, U4, U5, I2), the Settings with the model manager, and desktop with portable Windows, portable Linux and the Windows installer | F0, A1–A3, U1, U2, I1, I3, E1–E4; for the release also U6, X1 part A, P2, P1 |
| **v0.2** — "good enough to work with" | STEP and IGES with CAD faces; move tool and part operations in the style of KeyShot; custom lights and saved setups; own library; KeyShot-style render window with queue and results viewer; real glass and emitters, wood and fabric, bevel, reflection placement, clear field, sky, HDRI, own thumbnails, revised recipes, CAD face, passes | I2, U3, U4, U5, L4, E5, E6, L1, L2, L3, M1, N2, D1 |
| **v0.3** — "replaces the commercial one" | Visible wear, textures and labels, animation and video in the style of KeyShot with a camera walkthrough, IES lights, native batches, desktop; *Interior* scene type with its defaults, parametric room and interiors camera; optional AI post-processing | E7, E8, M2, N1, N3, L5, Q1, K1, K2, K3, X1–X4 |
| **v0.4** — "interiors and furniture" | The engine renders window-lit rooms with portals, light tree, adaptive sampling and *denoise*; path guiding; furniture deliverables; light groups after the render | K4, K5, K6, K7, K8 |

---

## Already done (do not repeat)

- **F0** · Starter documentation: `CLAUDE.md`, `README.md`,
  `docs/SPEC.md`, `docs/ARCHITECTURE.md`, `docs/UI.md`, this roadmap —
  **Fable**.
- **A1** · Vite + TypeScript + vitest scaffolding + capture with the local
  Chromium (`tools/screenshot.mjs`) — **Sonnet**.
- **A2** · Catalogues in `src/data/` with types, and light maths in
  `src/core/light-math.ts`, `rig.ts`, `wear.ts`, with tests of
  count, formula and 16 × 71 normalisation — **Sonnet**.
- **A3** · `.github/workflows/qa.yml`, PR template, `CONTRIBUTING.md`
  — **Haiku**.
- **E1** · Dependency-free Rust engine workspace: `rt-core`,
  `rt-cli`, `rt-wasm`, RSB format, own PNG, placeholder ray launcher, CI
  with cross-compilation to ARM64, RISC-V and wasm — **Sonnet**.
- **U1** · The complete interface of `UI.md` over the *store*, with the
  three.js preview viewer, standard mode by default, 201 tests and
  captures in `docs/ui/` — **Opus**.
- **I1** · Own OBJ and STL importers with welding, angle-weighted normals,
  hard edges, scale detection and a units fix in the Doctor; common
  `importFile` for glTF, OBJ and STL — **Sonnet**.
- **E2** · Own SIMD (scalar, SSE2, AVX2, NEON, simd128, bit-for-bit
  identical), BVH4/8 with SAH and SIMD traversal, *watertight*
  intersection, instances, `pick`, `rt-bench`; 121 tests, also run in wasm
  — **Opus**.
- **I3** · FBX, 3DM, 3MF, PLY, DAE and USD through on-demand MIT loaders,
  inline import sheet with units and axis detected per format, pure
  options pipeline; 405 tests — **Sonnet**.
- **U3** · Move tool with *gizmo*, pivots, drop-to-surface and centring,
  duplicate and linking, groups, patterns, material and geometry
  operations, full context menu and shortcuts; 442 tests — **Opus**.
- **E3** · Integrator: Sobol with Owen scrambling, physical BSDF, area
  lights and sun with NEE and MIS, dome with importance sampling, floor and
  shadow catcher, tone curves, contact sheet, wasm parity; 178
  tests with furnace, form factor and energy conservation — **Opus**.
- **U4** · Own library: materials, light setups, product types and
  studios with thumbnail, *Mine* tabs, persistence,
  JSON export and import; 504 tests — **Sonnet**.
- **E4** · The engine in the browser: RSB writer in TypeScript
  byte-identical to the one in `rt-core`, worker pool with scalar `rt.wasm`
  and `simd128`, **Fast · Full** switch, *Render* always with the
  tracer, exact browser / native parity; 561 web tests and 182 for the
  engine — **Opus**.
- **I2** · STEP and IGES with isolated occt-import-js, CAD faces as
  triangle ranges with topological hard edges, assembly, colours,
  units and tessellation quality; 682 tests — **Opus**.
- **U2** · Save and open `.repack.json` with the meshes inside, file
  remembered with File System Access, unsaved changes with an inline
  question, layer-boundary test; 792 tests — **Sonnet**.
- **P2** · Own desktop launcher with a native engine identical to the
  wasm one, model store by `sha256`, Windows and Linux portables and
  NSIS installer; 846 web tests and 241 for the engine — **Opus**.
- **P1** · First release `v0.1.0`: Windows and Linux portables and
  Windows installer, CHANGELOG and notes — **Haiku**.
- **U6** · Settings window with search and grouped sections, AI model
  manager with resumable downloads verified by `sha256`,
  import and per-machine recommendation; 939 tests — **Opus**.
- **U5** · KeyShot-style render window with *Image · Animation*,
  template-based output, folder, dpi written into PNG and JPEG, 16-bit
  PNG and EXR, *Finish by* samples or time, undoable queue, results
  viewer with divider and history in IndexedDB; 621 tests — **Opus**.
- **E12** · Per-point light selection: the flat list of the light tree of
  Conty Estevez and Kulla with its orientation bound, weights in
  irradiance units, MIS with the same probability at the BSDF ray's
  vertex; the shadow catcher and the photons still go by flux; no
  fireflies in sets with a *pool*; 614 engine tests — **Opus**.
- **M2b** · Textures and labels in the engine: `IMGS`, the texture block
  of `MATL` and the UVs of `MESH` in `rt-core`, *mipmaps* and footprint by
  ray and cone differentials, the five *Fast* projections, normal and
  height maps, cut-out and per-point opacity also in shadows,
  labels as a layer; `rt_features`; the same pixels without textures; 474
  `rt-core` tests — **Opus**.

- **N1** · Animation and video: `FADE`, `PAN`, `MATERIAL_COLOR`, `SUN_ARC` (and
  `PATH` reserved), pivot turn, custom two-handle curve, camera
  change with a fade to black or white, three-step wizard with a grid of
  types, animations under their target in the tree, WebM/MP4 video through
  WebCodecs with own *muxers* and the `output` Doctor wired up; a U1 project
  plays back the same; 2907 web tests and 1098 for the engine (untouched) — **Opus**.

- **N2** · Queue, passes and batches: the **alpha** pass (the seventh, `RNDR.passes` bit 6,
  `rt_render_tile_alpha`, with its own *hashes* and the six from X2 unmoved), the
  *Alpha*, *Depth*, *Normals* and *Part ID* passes as files next to the image
  (EXR or 16-bit PNG), the **cameras × studios batch** with the name template, the
  queue's **own ZIP** (*store* method, dependency-free) and the proof that
  stopping the second leaves the third; an old queue bug fixed;
  3005 web tests, 1112 engine tests and 46 mutants killed — **Sonnet**.

- **N2b** · The studio travels with the project: each job with a saved studio
  saves a copy of it in the project (`render.studios`, one per id and content
  *hash*, the job names it with `studioCopy`) and renders on it, also on a
  machine whose library does not have it; the copy's images go once in `images`;
  *Add to my library* in the queue; the schema stays at 2 — **Opus**.

(The phases in this list are closed by whoever executes them in the same PR
in which they are delivered; the detail of each is in its section.)

---

## F0 · Starter documentation — **Fable** — done

This document and its siblings. Decisions taken here and not open to
discussion inside a PR: stack (`ARCHITECTURE.md` §1), three-column black
and white interface with a contextual inspector (`UI.md`), single *store*
with undo (`ARCHITECTURE.md` §4), catalogues as data with stable keys,
camera-relative coordinate system, a viewer that is the render.

## A1 · Scaffolding — **Sonnet** — done

Vite 8, TypeScript 7, vitest 5, three 0.186, playwright-core 1.64.
`npm run qa` and `npm run screenshot` green over a placeholder `main.ts`.
The capture uses `--use-gl=swiftshader` and waits for
`#app[data-ready="1"]`.

## A2 · Catalogues — **Sonnet** — done

See `src/data/README.md`. The keys are stable. The tests
pin: 16 studios; 72 setups (PRODUCT 12, TRADITIONAL 13, CINEMATIC
11, CREATIVE 8, EMOTIONAL 8, EXPERIMENTAL 8, SIGNATURE 6, SPICY 6; three
with `world: 'SKY'`); 77 materials in 7 categories; 8 optics; 16
sequences; 14 checks; 9 wear basics and 8 types. `setupRig`
equalises the irradiance of any setup to that of the product type.

## A3 · CI and templates — **Haiku** — done

The suite runs on every PR and uploads `dist/` as an artefact so the
interface of any commit can be tried without a release.

---

## U1 · The interface — **Opus** — done

**What.** The whole interface of `UI.md`, working over the *store* of
`ARCHITECTURE.md` §4 and a three.js preview viewer behind
`RenderEngine`. No path tracer and no importers beyond GLB.

**Depends on.** A1, A2.

**Acceptance.** The list in `UI.md` §7, point by point, and:

- **Standard mode by default** (`SPEC.md` §2): on opening, and after *New*,
  the `GENERIC` studio (label *Standard*) is already built with its
  rig, the dome, the reference camera and preview quality; an imported
  part without a material receives the default material; undo
  cannot undo that initial state.

- `tests/store.test.ts`: assigning a material per level (all four),
  confirmation inventory when the materials differ and none when
  they are equal, undo and redo of a sequence of ten actions,
  a `transaction` that leaves a single entry, round-trip serialisation
  (`JSON.parse(JSON.stringify(state))` equal to the state).
- `tests/strings.test.ts`: same keys in `es` and `en`, none empty.
- `tests/ui-achromatic.test.ts`: no colour with saturation in
  `src/ui/**/*.css`.
- `tests/doctor.test.ts`: each scene check detects its case and its
  fix leaves it clean (scale, grounding, smoothing, bevel, clipping,
  visible lights).
- `out/screenshot.png` attached to the PR with the example part, the
  jewellery studio created and a setup chosen.

**Do not touch.** `src/data/` (except adding, never changing values),
`src/core/light-math.ts`, `rig.ts`, `wear.ts`, the documents in `docs/`
(if something does not fit, it is noted in the PR).

**What to leave ready for later.** `RenderEngine` implemented by the
preview and used by `main.ts` through a variable, so that
E4 only has to add the second implementation (the worker pool
over `rt.wasm`), the automatic *preview while moving,
tracer when it stops* switch, and a `setEngine` action.

**Done.** The whole interface of `UI.md` works over the *store*
(`src/core/store.ts`: immutable state, undo and redo with bilingual
labels, per-gesture transactions, `reset`) and the three.js preview
viewer (`src/render/preview.ts`, with the Z-up → Y-up conversion
only in `toThree`). The mouse-free acceptance flow (palette: example →
jewellery → create studio → gold → `Ctrl ⏎`) downloads a 1920 × 1080 PNG
and undo reverts it step by step; dragging a `.glb` onto the empty
state imports, grounds and frames; the four selection levels, the
confirmation inventory, the 72 thumbnails and the 77 spheres
rendered in the browser, the animation drawer with playback, the
queue, the Doctor with seven scene checks, the guide with arrows, the
two themes and the two languages live, and standard mode at start-up
(the base state of the history, which undo cannot remove). 201 tests
in 16 files; `tests/ui-achromatic.test.ts` and `tests/strings.test.ts`
green. Captures: `docs/ui/dark-studio.png`, `light-materials.png`,
`animation-drawer.png`. URL parameters for demos and captures
documented in `src/ui/README.md`.

What did not fit the plan, resolved this way: the geometry lives in a
registry outside the state (`core/meshes.ts`) and the state keeps only
id, counts and box, so as to remain plain JSON; the selection and the
render queue are not undoable (the queue is, since U5); lights are placed and aimed at the
centre of the visible part, not at the world origin, because the part
rests its base on the origin; the bevel is stored in the material and
shown in the Part section; `render()` accepts a camera so that each
queue job uses its own; *Create studio* always asks for
confirmation because with standard mode there is always a studio; the
glTF importer does its own Y-up → Z-up conversion (it belongs to the
format, not the viewer); the *System* theme is dark unless the system
asks for light; three.js leaves the bundle at 1.1 MB; in the preview,
*Sky* and *HDRI* use the dome, the clear field is a soft disc at the
panel's position, and floor reflection, halo, sharpness, saturation,
contrast and vignette are stored but not painted (all marked
*coming soon*). Left for U2: opening projects and the embedded meshes. The types `SceneNode`, `MaterialInstance`, `LightInstance`,
`CameraState`, `Shot`, `MotionClip`, `RenderJob` in `src/core/*.ts`,
exported and documented with one line each.

## U2 · Project file and boundaries — **Sonnet** — done

**What.** `src/io/project.ts`: save and load `.repack.json` with the
meshes embedded (GLB in base64), `schema: 1`, and an empty migration
table with its mechanism. `tests/boundaries.test.ts`: walks the `import`s
of `src/` and fails if `core` imports from `ui`/`render`/`io`, if `ui`
imports from `render` or `io`, or if `data` imports from anything else.
`tests/project.test.ts`: round trip of a project with two parts and
three materials; a fixed file `tests/fixtures/project-v1.json` that
must keep loading in every version.

**Depends on.** U1.

**Acceptance.** The three tests green; the menu's *Save* and *Open*
work in the browser with download and `<input type="file">`.

**Done.** `src/io/project.ts` saves and opens `.repack.json` (`schema` 2:
`state` and a `meshes` block with one base64 GLB per mesh used, with
`sharpEdges` and `triangleSource` alongside; `-0` preserved), with
`glb.ts`/`base64.ts` (in chunks) and `project-file.ts` (File System Access
with the remembered file: `Ctrl/⌘ S` writes to it, `Ctrl/⌘ ⇧ S`
asks, `Ctrl/⌘ O` opens; download and `<input>` where there is no API; dropping
a project opens it). Opening validates everything before touching anything, renames the
mesh ids that would collide (`prjN:`), regenerates the example's geometry in
old files and does `store.reset` (the history starts afresh).
The unsaved-changes marker comes from a revision counter of the
*store* (`revision()`; undoing back to the saved point clears it); *New* and
*Open* ask inline (*Save · Don’t save · Cancel*) and
`beforeunload` warns. `tests/boundaries.test.ts` (no violations),
`project.test.ts` (including a STEP assembly from I2 saved and reopened
identical, CAD faces and hard edges included), `project-files.test.ts`,
`fixtures/project-v1.json` (generated by U1's own code) and
`project-v2.json`; 102 new tests, about 110 mutations checked.

What did not fit the plan: the schema was already 2 (U5) and is not bumped; there is no
external reference by path, only meshes inside; opening is not undoable
(like *New*); undoing back to the saved point leaves the project clean.

**Later change (B1, requested by the owner): the extension.** The project is
saved as `.repack` (the same JSON); `.repack.json` is what was written
up to v0.1.6 and it still opens, in the picker, in the
desktop dialog and when dropped on the window (`core/project-names.ts`; the launcher
accepts `repack` in `WRITABLE_EXTENSIONS`). Where `.repack.json` is read above,
it is what was done at the time.

## I1 · OBJ and STL importers — **Sonnet** — done

**What.** Own `src/io/obj.ts` and `src/io/stl.ts` (ASCII and binary for
STL; OBJ with `o`/`g` groups as parts and `usemtl` as the initial
grey `SIMPLE`-family material), dependency-free. Normals: if the file does not
bring them, by smoothing angle (30°). Hard edges marked
by dihedral > 30° in `mesh.sharpEdges`. Detection of `partSizeMm` and of
units (a 0.03-tall STL in a "jewellery" type is metres; ×1000 is
offered with the Doctor). The empty state accepts all three formats.

**Depends on.** U1.

**Acceptance.** `tests/io-*.test.ts` with small hand-written fixtures
(an OBJ cube with two groups, a binary STL and an ASCII one of the same
tetrahedron) checking vertices, faces, groups, normals and hard edges
with exact numbers. The Doctor suggests the scale when appropriate.

**Done.** `src/io/obj.ts`, `stl.ts`, `mesh-common.ts` (welding by
position with a tolerance of 1e-5 of the size, normals with a
30° smoothing angle, hard edges, Y-up → Z-up conversion) and
`import.ts` (`importFile` by extension and header, with each reader in
its own *chunk*; glTF goes through here too). 49 new tests with
exact counts and 46 mutations checked one by one; dragging OBJ,
ASCII and binary STL and GLB works in the browser; 1 M triangles
in ~4 s (OBJ) and ~3 s (binary STL) on the main thread. The Doctor
offers exact ×1000 / ÷1000 when the importer leaves a units hint
(`ModelSource.unitHint`).

What did not fit the plan: hard edges are per part and do not count open
ones, so a CAD that exports one group per face has no hard
edges (M1 will take them from the topology); vertices are split along
the hard edges (24 in a cube), and the "welded" counts are
pinned as distinct positions; STL is left Z-up and in millimetres,
unscaled; an OBJ group with several `usemtl` is one part with
`faceMaterials`; `.mtl` files are ignored with a warning; a file in metres
looks empty at first because the camera's near plane (1 mm) covers it
until the scale fix is applied: I3 solves it by applying the
import sheet's units before adding the model and by adjusting
the clipping planes when framing.

## I2 · STEP and IGES — **Opus** — done

**Decision taken (Fable).** STEP (AP203, AP214, AP242) and IGES are read with
**OpenCascade** compiled to wasm through `occt-import-js` 0.0.23. The
whole package is **LGPL-2.1** (not MIT, as an earlier version
of this document said): it is the project's only LGPL exception and is
isolated under the conditions of `ARCHITECTURE.md` §1 (copied unmodified
to `public/vendor/occt-import-js/` by `tools/vendor.mjs`, never
bundled, loaded by URL in a worker, licence and link to the source
alongside, named in *About*). It enters only the web side's `io/` layer,
is loaded **on demand** when the first CAD file is dropped (a few MB that are
not paid if unused), and the render engine does not know it. An own B-rep tessellator in Rust remains an idea for
later, not a requirement.

**What.** `src/io/step.ts`: deferred loading of the module, reading with the
**tessellation quality** of the import sheet (chord tolerance and
angle), keeping **each CAD face** as a triangle range
(`faceRanges`, what M1 uses so that *Faces* picks a whole face), the
assembly's **names and colours** as a hierarchy of groups and
initial materials, and the declared units. IGES by the same path.
Hard edges from the topology (edges between faces), not by angle.

**Depends on.** I3 (the import sheet and `import.ts`).

**Acceptance.** Small STEP fixtures written by hand or exported from a free
CAD (a cube with name and colour, a cylinder, an assembly of two
parts): exact number of CAD faces, parts and groups; changing the
quality changes the number of triangles; the module is not downloaded until
a STEP is imported (test that `import('…/occt')` does not appear in the
initial chunk of `vite build`).

**Done.** STEP (AP203/214/242) and IGES with occt-import-js 0.0.23 in a
module worker, loaded when the first CAD file is dropped; the sheet
opens instantly with a status line (download in MB, reading,
parts) and live tessellation quality (Low · Medium · High and
*Custom* with chord as a % of the size and angle), which re-reads
the file. Each CAD face is a triangle range
(`SceneNode.faceRanges`) with its own vertices and normals; hard edges =
edges between faces; assembly as named groups; colours as SIMPLE
instances; declared units read from the file's text;
*Separate by CAD faces* in the sheet. The library is copied unmodified
to `public/vendor/occt-import-js/` with its two LGPL-2.1 texts
and a README with the link to the source, and a test after `vite build`
checks that it is in no *chunk*. 61 new tests (682 in total),
41 mutations checked; capture `docs/ui/import-step.png`.

What did not fit the plan: the library flattens sub-assemblies (one level
of groups at most) and gives no colour names (instances are
named by their hexadecimal); STEP and IGES do not declare an up axis and **Z**
is taken (pending Fable, see *Judgement calls*); the worker runs the script
unmodified with `new Function` (a future CSP would need
`unsafe-eval` or a classic worker); the conversion runs on the main
thread (≈ 0.65 s per 230 k triangles) and `ReadFile` reports no
progress while it tessellates; in an assembly with several units the
first one rules; tangent faces also remain as hard edges, with
equal normals, so shading stays smooth; the first read
is always at Medium quality.

## I3 · Importers and import sheet — **Sonnet** — done

**What.** `src/io/import.ts`: detection by extension and header,
inline **import sheet** (`UI.md` §2.3, `SPEC.md` §5) with
units, up axis, centre, ground, frame, add or replace,
group by, keep materials, split parts, flip normals, and
the corresponding conversions to *store* nodes. Formats through
MIT libraries already decided in `ARCHITECTURE.md` §1, each in a
chunk loaded on demand: **FBX** (`FBXLoader`: hierarchy, materials,
embedded textures, units), **3DM** (`3DMLoader` + rhino3dm: render
meshes, layers as groups, materials; a clear warning when a B-rep
brings no mesh), **3MF**, **PLY**, **DAE**, **USD/USDZ**. OBJ and STL remain
own (I1). The materials the file brings are converted to
`SIMPLE` instances with approximated colour, roughness and metal; the
textures are saved for M2.

**Depends on.** U1, I1.

**Acceptance.** One small fixture per format (generated with free tools
and with its licence noted) with exact counts of parts,
groups, triangles and materials; the sheet applies each option (*store*
test: units × 25.4, up axis swaps Y/Z, group by
material produces N groups); the initial chunk contains no
importer (test over `dist/`).

**Done.** Readers `fbx.ts` (ASCII and binary 7400/7500, `UnitScaleFactor`
and `UpAxis`), `rhino.ts` (rhino3dm 8.35.0 MIT in a worker, layers as
groups, hidden layers, document units, warning for a B-rep without
render mesh), `threemf.ts`, `ply.ts`, `collada.ts`, `usd.ts` (`USDLoader`,
because `USDZLoader` is deprecated in three 0.186) and `three-scene.ts`
(common conversion of `Object3D` to nodes); `src/core/import-options.ts`
with a pure `applyImportOptions` (units, axis, flip normals, group
by, material policy, split) which glTF, OBJ
and STL also go through, and which no longer scale or rotate on their own; import sheet in
the inspector with the detected values; `frameBox` adjusts the clipping
planes. 405 tests in 29 files, 58 mutations checked; in the
browser, FBX, 3DM, 3MF, DAE, PLY, USDA and USDZ open the sheet and import
with `Enter`, with no console errors.

What did not fit the plan: one file per reader instead of `mesh-formats.ts`;
`npm run qa` becomes `check → build → test` so that the *chunk* test
always runs over the fresh `dist/`; *Centre* also moves the model's origin
to the centre (`centrePivot`) so that the Doctor does not warn after
importing; embedded textures are collected in the *payload* and not
applied (M2); the preview limits the near plane to 0.01 mm, so
a model below 0.05 mm can still be clipped; binary `.usdc` is
not scanned; FBX with X up is not offered; Phong materials with
roughness derived from shininess. `rhino3dm` is copied to `public/vendor/`
in `predev` and `prebuild` (`tools/vendor.mjs`).

## E1 · Rust engine scaffolding — **Sonnet** — done

**What.** The Cargo workspace in `engine/` with the three *crates* of
`ARCHITECTURE.md` §5.1 and **zero external dependencies**: `rt-core` with
maths (`Vec3`, `Ray`, `Aabb`), PCG32 RNG, colour (sRGB, ACES,
exposure), film, own PNG encoder (stored zlib + CRC-32 +
Adler-32), reader and writer of the **RSB** v1 scene format
(`ARCHITECTURE.md` §5.2) and a placeholder `render_tile` that is already a
real ray launcher (thin-lens camera, brute-force Möller–Trumbore,
`n·l`); `rt-cli` with a tile queue and threads, `--example` and
`--write-example`; `rt-wasm` with hand-written `extern "C"`
exports. `.github/workflows/engine.yml`: fmt, clippy `-D warnings`, test,
native and wasm build, cross `cargo check` to `aarch64-unknown-linux-gnu`
and `riscv64gc-unknown-linux-gnu`, and a step that fails if `Cargo.lock`
contains an external source. `npm run engine:test` and `npm run
engine:build`.

**Depends on.** —

**Acceptance.** The five *gates* green; the example renders a PNG with
the centre lighter than the corner; determinism tests (tiles in
any order give the same film), RSB round trip with an unknown section
ignored, structurally valid PNG; the `.wasm` imports
nothing from WASI.

**Done.** 79 tests (`rt-core` 63, `rt-cli` 10, `rt-wasm` 6), fmt, clippy
and `cargo doc -D warnings` clean; `Cargo.lock` with no external
source; cross `cargo check` to `aarch64-unknown-linux-gnu` and
`riscv64gc-unknown-linux-gnu` green; `rt_wasm.wasm` of 50 KB with no
imports section. The same RSB rendered natively on x86_64 and in
wasm (loaded in Node) gives the same tile hash, and a test pins it.
Brute force over 322 triangles on 4 threads: 1.4 M rays/s, which is the
number E2 has to multiply.

What did not fit the plan, or was left open, for E2–E4: the RNG seed is
per (scene, pixel, sample) and not per tile, so the film is
identical with any tile size, not just any order;
`MATL.kind`, `ENVR.background_mode` and `LGHT.flags` are stored raw
because their meanings are set by E3; `RNDR.max_seconds` is read but the
CLI does not apply it yet; the placeholder shading ignores the light's
power. The example scene lives in `rt_core::example` because `rt-wasm`
also needs it in its tests. The `rt-wasm` functions that receive
pointers are `unsafe extern "C"`; the scene registry is a `Mutex`,
not a `static mut`.

## E2 · Geometry and acceleration — **Opus** — done

**What.** In `rt-core`: the `simd` module (`f32x4`/`f32x8` with a scalar
reference and SSE2/AVX2, NEON and `simd128` paths, equality test within
1 ulp); indexed meshes in *structure-of-arrays*; BVH with SAH
construction by *binning* and wide nodes (BVH4, BVH8 where there are 8 lanes)
traversed with SIMD and an explicit stack; *watertight* intersection; smooth
normals by barycentric interpolation; instances (same mesh, several transforms);
shadow rays with early exit; `pick` (single ray with node id,
face, point and normal). An `rt-bench` binary in `rt-cli` that measures
rays/s over the example part and a million-triangle model
generated procedurally.

**Depends on.** E1.

**Acceptance.** Tests: the BVH returns exactly the same as brute
force on 10,000 random rays over three scenes (sphere, example
part, random mesh with degenerate triangles); deterministic
construction; SIMD = scalar. Measured target (noted in the PR, not
a gate): ≥ 10 M rays/s per core on x86_64 with AVX2 over the example part.

**Done.** Measured on a 4-core virtual machine (Xeon 2.8 GHz,
AVX2, BVH8): example part **12–14 M rays/s per core** (54–80 M on
4 threads depending on coherence and *any-hit*); million-triangle mesh,
3.9 M per core coherent and 1.0 M incoherent (limited by cache
misses); BVH construction for 1 M in 1.1 s. Full example render:
from 1.4 M to **15.2 M rays/s** on 4 threads. In wasm under Node, one
thread: 2.8 M scalar and 3.7 M with `simd128`, against 4.5 M native. The
scalar, SSE2, AVX2 and `simd128` SIMD paths are run and compared bit for
bit (no FMA, `min`/`max` with x86 semantics in all of them, reductions
in a fixed tree); NEON only compiled and checked with clippy (there is no
ARM machine here). 121 tests (rt-core 102, rt-cli 13, rt-wasm 6) in
debug, release and **wasm32-wasip1 under Node** (`engine/tools/wasi-run.mjs`),
with three mutations checked (culling, tie-break, operand order
of `min` in SSE). The film hash is now pinned over two tiles
and on all SIMD paths; the real wasm gives the same hashes.

What did not fit the plan: new RSB section **`INST`** (mesh, 3 × 4 transform,
material, flags) so that instances travel; without it, one identity
instance per mesh as before (noted in `ARCHITECTURE.md`
§5.2). AVX2 detection lives in `rt-core` (`Isa::detect`, CPUID, not
a system API) with per-tile dispatch and a safe fall-back to
scalar. The BVH width depends on the machine (BVH8 only with AVX2),
with an identical result because the nearest hit is the smallest
`(t, instance, triangle)`. Triangle packets of 4 on all
paths; 8 lanes only in the nodes. `Scene.meshes` becomes
`Scene.geometry` and `Mesh` is immutable. An instance with a singular
transform is never hit; it is not an error. `[profile.test] opt-level = 1`
(the brute-force tests go from 18 s to 2 s); `rt-cli` now has
two binaries (`rt`, `rt-bench`) and `default-run`. CI additionally runs the
`rt-core` tests in wasm (scalar and `simd128`, in `--release` because
Node 22 fails with the whole debug binary) and an `rt-bench`
smoke test. The `.wasm` goes from 50 to 114 KB; `engine:build` is still
scalar and the `simd128` variant is decided in E4.

## E3 · Integrator v1 — **Opus** — done

**What.** The real path tracer: Sobol sampler with Owen
*scrambling* (Joe and Kuo direction numbers, cited) seeded
by (tile, pixel, sample); thin-lens camera with aperture and
focus, orthographic; physically based BSDF (Lambert/Burley diffuse +
GGX specular with Fresnel + metal) with roughness and colour; rectangular,
square and disc area lights with explicit sampling and MIS against
the BSDF, with `glossy` (visible in reflections) and `spread`; directional sun
with angular disc; **procedural studio dome** (floor → horizon →
zenith) as an environment light with importance sampling; plain,
transparent or the environment itself as background; floor with contact shadow and
*shadow only* mode; Russian roulette; progressive accumulation per tile;
exposure and Standard, Filmic and AgX transforms (settings from the
literature, cited). All deterministic and identical with 1 and N threads.

**Depends on.** E2.

**Acceptance.** Analytic tests in `cargo test`: furnace test (white
sphere in a uniform environment converges to the environment radiance ±1 %);
diffuse sphere under a panel against the analytic form factor (±2 %);
flat mirror reflecting the dome with the correct gradient; energy
conserved with roughness 0 → 1 (the image gains no light); identical hash with
1 and 4 threads. Contact sheet with `rt`: 16 studios × 12 chosen
setups, with mean, burnt and blocked per image (`tools/contact-sheet.mjs`
calls the binary; it produces `out/contact-sheet.html` and is attached to the PR).

**Do not touch.** The recipes (`src/data/`): if a setup comes out wrong, it is
noted for L3, not changed.

**Done.** Sobol sampler with Owen *scrambling* (Joe and Kuo table
of 63 dimensions verified against the original file, BSD licence in
the module; 2-D pairs with t ≤ 2; seed per pixel and dimension), thin-lens
and orthographic camera, main BSDF (Lambert × (1−F)² + GGX with
correlated Smith and VNDF, Schlick with F0 from `ior` or colour according to `metallic`,
clearcoat as a second lobe), emitters, rectangle and disc lights with
`spread` falloff, sun as a disc, NEE with MIS by power heuristic and
no double counting, studio dome with CDF by elevation, background environment,
colour or transparent with alpha, visible floor or shadow catcher (section
`FLOR`), Russian roulette, `clamp_indirect`, `max_depth`, `max_seconds` in the
CLI by passes, linear, ACES, filmic, AgX and standard curves, `--sheet`
with six internal recipes and statistics, `rt_render_tile_rgba` and
parity of the real `.wasm` in Node (`tools/wasm-parity.mjs`, in CI). 178
tests: furnace 1 ± 1 % at 1024 samples, rough metal with no energy
gain, reciprocity, form factor ±2 %, dome gradient in
a mirror, same emitter by NEE and by BSDF ±2 %, alpha, shadow catcher,
monotonic curves, threads and passes with no effect on the film. Performance
with real shading: 7.9 M rays/s on 4 threads (2.7 rays per path).

What did not fit the plan: own deterministic maths (`fmath`: sin, cos,
exp2, log2, pow, atan2, acos using only the four operations and square root),
because those of `std` call the system library and would break
pixel equality across platforms; new `MATL.flags` (bit 0: the
emitter is also sampled as a light); `glossy` means "lights all
lobes and is seen in reflections" (without it, only diffuse by NEE); F90 =
min(1, 50·F0) so that `ior` 1 is pure Lambert; rough metals
lose energy (single-scattering GGX; Kulla–Conty compensation is
proposed for later); lights by uniform area, one per vertex
chosen by flux (the light tree is K4's); filmic as a log2 range
plus the AgX polynomial; the AgX matrix and polynomial were written
from memory and **Fable must judge the look**; shadow and
bounce rays on smooth meshes start from a point raised to the surface
that the normals describe (Hanika 2021), which removes the jagged terminator
and leaves a dark edge on silhouettes of coarse meshes; the example's light
goes from 1000 to 5 W; `rt_version` 0.2.0 and `.wasm` of 180 KB.

## E4 · The engine in the browser — **Opus** — done

**What.** `src/io/rsb.ts`: RSB writer in TypeScript from the
`ProjectState` (meshes, instances, materials with the semantics fixed
in E3, rig resolved by `setupRig`, camera, environment, `FLOR` floor,
render), with a byte-for-byte parity test against the `rt-core` writer
(fixture generated by `rt --write-example`). `src/render/worker.ts`
and `src/render/pathtracer.ts`: worker pool, each with its own `rt.wasm`
(`simd128` variant when the browser supports it, scalar otherwise) and its
copy of the scene, interleaved tiles, accumulation, exposure and
transform on the main thread, honest `status()` (mode, samples,
time, workers, SIMD). **A *Fast · Full* switch in the header**
(`meta.viewportMode`, shortcut `Ctrl ⇧ R`): *Fast* = rasterised preview
always; *Full* = tracer always, also during camera
gestures, at reduced resolution (½ or ¼ depending on the time of the
last frame) while the gesture lasts and at full resolution on
release, with accumulation restarting when anything in the
scene changes. **`render()` and the queue always use the tracer** at the
output resolution and with the budget, in any mode. If
`rt.wasm` is missing (`npm run engine:build` has not been run) or the
browser provides no workers, *Full* is disabled with the reason and the
interface works in *Fast*.

**Depends on.** U1, E3.

**Acceptance.** Parity: the same scene rendered by `rt` and by the pool
in the local Chromium (via `tools/screenshot.mjs` with `?mode=full`) gives the
same image hash at 4 samples; `tests/rsb.test.ts` green; capture
of the viewer in *Full* converging with the meter showing real
samples and another in *Fast*; orbiting in *Full* keeps at least 10
frames per second at reduced resolution in the local Chromium with
swiftshader (or whatever it gives, noted); the *Render* button in *Fast* mode
produces the tracer's image, not the preview's (pixel test:
the downloaded image has sampling noise and soft shadows).

**Done.** `src/io/rsb.ts` writes the RSB from the state and reproduces
`rt --write-example` byte for byte; `src/render/{pathtracer,worker,
pool-protocol,tiles,tonemap}.ts` with a worker pool (scalar or
`simd128` depending on the browser), interleaved tiles, a generation counter to
discard stale tiles, accumulation in `f32` and in sample order, and
the engine's tone curves ported to TypeScript **bit for bit**
(compared with `rt --tone-table`). *Fast · Full* switch in the
header with `Ctrl ⇧ R`, remembered, and disabled with its reason when
there is no `rt.wasm`. **Parity**: the jewellery scene with Rembrandt and
shadow catcher, rendered in the page at 4 samples and with native `rt`,
gives the same hash at 1920 × 1080 (0 differing bytes). On the test VM
with swiftshader: the *Full* viewer converges at 3.6 samples/s at
1000 × 875 (3.15 M paths/s with 3 workers and SIMD) and orbits at 13 fps at ¼
resolution; *Render* of 1920 × 1080 at 128 samples, 84–111 s. The
render in *Fast* mode comes from the tracer (sampling noise and contact
shadow measured). *Full* brightness against *Fast*: 0.95 (0.94 after
the correction below), within the ±10 % tolerance. Common photometry
in `src/core/photometry.ts`: flux of a panel = π/4 × power ×
size² (Cycles convention; **corrected after E4**: with `/ 4` the
panels gave π times less light than in Blender and the dome covered them, so
that changing setup barely changed the render; regression test
in `tests/photometry.test.ts`); 36 mm sensor on the long side. Captures
`docs/ui/viewport-full.png`, `viewport-fast.png`, `render-output.png`.

What did not fit the plan: new export `rt_scene_update`
(`Scene::update_from_rsb`): an RSB without `MESH` keeps the meshes and their
BVHs, so as not to rebuild the geometry at every camera move; the
final 8-bit conversion of *Render* runs in the workers and the viewer uses
a fast table path (exact except where the engine's filmic curve
oscillates at ulp level); drags of the *gizmo* and of controls also
render at reduced resolution; the viewer renders at CSS pixels, without
HiDPI supersampling; with swiftshader, the selection outline and the
overlaid WebGL canvas are switched off during gestures so as not to read
the canvas on every frame; palette action *Export engine scene
(.rsb)*; `groundShadow`, `groundReflection` and the flat environment colour
have no equivalent in the engine yet; the engine's ACES gives NaN
above ~1e19 of radiance. Two corrections by the lead on
receiving the phase: the **sun angle** was documented in radians and
came out as a 31° disc, when the catalogue gives it in **degrees**
(0.545° is the real sun; it is now passed as is, with a regression test); and
*Render* **no longer falls back to the preview** when `rt.wasm` is missing: it says so
and does not render, as the owner decided.

## E5 · Dielectrics, emitters, clearcoat, sky, HDRI — **Opus** — done

**What.** In `rt-core`: transmission with IOR and absorption (glass, acrylic,
polycarbonate, tinted), roughness in transmission; clearcoat as a
dielectric layer; anisotropy; approximate subsurface (short *random walk*
or Burley profile); black-body and colour emitters; caustics
control (AUTO follows the product type); procedural sky (public-literature
model, cited) for `world: 'SKY'` with the rig's sun;
own readers for **RGBE (.hdr)** and **OpenEXR** (scanline only, uncompressed
or ZIP: the *inflate* is also written in-house) for file HDRIs,
with rotation and intensity, as an RSB section; image background; a light
*denoise* of its own at the end (filter guided by normals and albedo).

**Depends on.** E3.

**Acceptance.** Glass in a furnace test with zero absorption loses no energy
(±2 %); a glass sphere in front of a panel with `camera = true`
produces the BACKLIT setup's clear field; sky test: zenith against
horizon in the expected order and sun colour of 5200 K; the HDR reader
reproduces a test file generated by the project's own writer; contact
sheet with the three SKY setups and the clear-field ones.

**Done.** In `rt-core`: the `transmission` part of the main material is
real glass, smooth or rough GGX transmission (Walter et al. 2007) with the
exact dielectric Fresnel, total internal reflection and the 1/η² of
radiance transport; Beer–Lambert absorption inside solids
(`absorption_mm`: the colour is what white light keeps after those
millimetres), thin wall (reflects 2R/(1+R) and lets the rest through without
refraction), cut-outs by `opacity`, GGX anisotropy (Burley 2012, brought
forward from E6) and clearcoat that attenuates the layers beneath. The integrator tracks
the solid the path is in; thin walls and cut-outs are
straight events that keep the density of the last vertex so that MIS
stays correct, and shadow rays pass through them. Emitters are
chosen as lights by their flux and respect `emitKind`; radiance = colour ×
emitPower × `EMIT_RADIANCE_PER_WATT` (0.06, `src/core/photometry.ts`).
Preetham, Shirley and Smits (1999) sky, with the rig's sun, scaled to
the dome's horizontal irradiance with the same values. Own
readers for RGBE (`.hdr`), scanline OpenEXR (uncompressed, RLE, ZIPS and
ZIP) and *inflate* (RFC 1950/1951); equirectangular HDRI in the
three.js convention, with rotation, intensity and 2-D importance sampling with its
exact density; background image (fill, fit, stretch) in the output
frame. RSB: 72 B `MATL`, 80 B `ENVR` and the new `BMAP` section; an
RSB without `BMAP` keeps the loaded maps. E3's opaque path gives the
same bits as before (its pinned hashes do not change); two new hashes
pin an E5 scene with glass, thin walls, cut-outs, anisotropy, HDRI
read from its bytes, background image and sky on native (scalar, SSE2,
AVX2), in WASI (scalar and `simd128`) and with the real `rt_wasm.wasm`. In the
interface: *Environment* with *Studio dome*, *Sky*, *Flat* and *HDRI
file*, *Load HDRI…*, haze and the sky's own sun, *Background image* with
*Load image…* and fit; the preview uses the same HDRI pixels,
the same sky (ported to TypeScript, equal to the engine's to 7·10⁻⁷) and the
same background placement; the project saves the images (`images`
block). Glass with *Absorption distance* and *Walls*. `env.kindSoon`,
`env.backplateSoon` and `light.skyNote` are removed. Contact sheet
with the glass bottle in front of the BACKLIT panel (clear field, also
with a test), the materials board, the filament in a thin-walled
bulb, the three SKY setups and the procedural studio HDRI
(`tests/fixtures/studio.hdr`): `docs/ui/engine-e5-*.png`. The new tests
were checked by reintroducing fourteen errors (without the 1/η², another
Fresnel, half absorption, without the MIS offset, shadows
blocked by thin walls, mirrored `u`, fit the wrong way round, RGBE rounded
to the centre, EXR predictor not undone, badly scaled sky and four on the
TypeScript side): all fail. Performance of the opaque example: same
image and same rays; no measurable difference above the noise of a
shared machine (single-thread median +6 %, best −2 %).

What did not fit the plan:

- **Hošek–Wilkie was not ported.** The lead decided on it (reference
  implementation v1.4a, 3-clause BSD), but the session's permissions classifier
  blocked using the downloaded implementation; it is pending
  explicit approval from the owner (the owner afterwards asked for an own
  clean-room sky: phase **E5c**). Preetham, the planned fallback,
  is behind the same interface (`Preetham::new`, `radiance`) and the
  TypeScript port follows it with a pixel-by-pixel test, so the change
  will be local. Twilight and night, outside E5.
- **Background image in *Fast* against *Full*: judgement call for the
  lead.** In *Full* and in the render it goes through the exposure and the tone
  curve like the rest of the film, so it does not come out identical to the
  photo; in *Fast* it is painted as is. The right thing seems to be to composite it in
  screen space after the curve (this affects the film contract
  and the output); it is noted. Rays refracted by a
  solid or reflected see the environment, not the background image.
- **Rough glass loses energy** (single scattering): at roughness 1 and
  from the inside it keeps only 42 % in the worst case. A
  multiple-scattering term (Kulla and Conty 2017, Heitz et al. 2016) would
  restore it.
- **HDRI memory per worker**: each worker decodes its copy (up to
  4096 × 2048 in `f32`, about 100 MB each); wider HDRIs are
  halved when read.
- **Solid glass blocks shadow rays**: its caustics come only from
  BSDF sampling, with visible fireflies when a small emitter is seen
  by specular reflection (the sheet's bulb). Caustics control
  and *denoise* move to **E5b**, as the wave plan says.
- **Subsurface, wood, fabric and bevel**, to **E6**. PIZ, PXR24, B44, DWA
  and tiled or deep EXRs are rejected with a message that names them.
  Thin walls are not blurred by roughness. The sky
  ignores rotation (its sun places it) and clamps the sun to 1° at minimum.

## E5c · Own physical sky, clean room — **Opus** — done

**Lead's decision (2026-10-13, at the owner's request: “port the sky from a
clean room”).** Neither the Hošek–Wilkie reference implementation nor its
coefficient tables are read or used (the copy
downloaded in E5 was deleted unopened). From the public literature only the
**functional form** of the model is taken (Hošek and Wilkie, “An Analytic Model
for Full Spectral Sky-Dome Radiance”, ACM TOG 31(4), 2012): extended Perez
with nine coefficients and the halo term χ(H, γ), with
interpolation over the sun's elevation by a degree-5 Bézier over
elevation^(1/3), linear in ground albedo and in turbidity. **We fit
the coefficients ourselves** against **our own atmosphere
simulator**, as the authors did with theirs. Everything is ours and is
licensed with the project.

**What.**
1. **Simulator** (offline tool, Rust `std` only, without touching
   `rt-core`): stratified spherical atmosphere; Rayleigh from the
   refractive index of air with the King factor; aerosols with optical
   thickness from turbidity (Linke/Ångström) and Cornette–Shanks or
   double Henyey–Greenstein phase; ozone absorption per layer; ground albedo;
   **deterministic** Monte Carlo multiple scattering (fixed seed,
   the same with any number of threads); spectral (≥ 32 bands from 380 to
   720 nm) to XYZ with the analytic fit of the CIE functions by Wyman,
   Sloan and Shirley (2013), and to linear Rec.709. Physical data only from
   public-domain sources or published formulas, cited.
2. **Fit**: own Levenberg–Marquardt per channel and per knot (turbidity
   1–10, albedo 0 and 1, elevations), with the scale radiance separate. The
   resulting table enters as data with a **recipe, seed and *hash***
   (like the A6 resources) and is regenerated with an `rt` command.
3. **Engine and preview**: the new model in `sky.rs` behind
   the Preetham interface, with the same normalisation to the
   dome's irradiance; Preetham stays as an alternative (*Classic*) with a
   model field in `ENVR` (stable key); the new model is the default;
   TypeScript port for *Fast* that matches the engine (≤ 1e-6
   relative); pinned *hashes* for the new sky.
4. **Validation**: fit error against the simulator by elevation and
   turbidity (target: < 5 % relative RMS outside the solar corona), shape
   of the distribution against the CIE standard clear sky (ISO
   15469/CIE S 011, types 12 and 13, published formula) and against Preetham.
5. **Captures at each milestone** (requested): simulator skies in
   fisheye at several elevations; fit against simulator
   with a difference map; the product scene with the new sky against
   Preetham (dawn, golden hour, noon, hazy).

**Depends on.** E5.

**Acceptance.** The above measured and in tests (simulator and fit
determinism, engine/preview agreement, new *hashes* without moving
the old ones), and the lead's visual sign-off on the captures.

**Done.** A new *crate*, `engine/crates/rt-sky` (offline tool,
Rust with `std` only; `rt-core` does not know it), with the `rt-sky`
binary:

- **Simulator** (`atmosphere.rs`, `trace.rs`, `simulate.rs`): Earth of
  6371 km and atmosphere up to 86 km in 64 spherical layers (the first one
  50 m, the thickness growing in geometric progression), each with the
  mean density of its stretch; air from the U.S. Standard Atmosphere 1976;
  Rayleigh cross-section of Bodhaine et al. (1999) with the index of
  Peck and Reeder (1972) at 360 ppm of CO₂ and the King factor of Bates
  (1984) (τ_R(550 nm) = 0.097 at sea level, as in their table), Rayleigh
  phase with the molecular anisotropy of Chandrasekhar; aerosols with
  τ_a(550) = (T − 1) τ_R(550) (Linke; equivalent to Preetham's ratio
  between his turbidity and the Ångström β) and λ^−1.3, scale height
  1.2 km, single-scattering albedo 0.95, Cornette and Shanks phase with **asymmetry
  0.7** (their parameter is not the asymmetry: it is solved for, 0.638; the first
  milestone used 0.7 as the parameter, that is, 0.757 of asymmetry, and the
  lead's review caught it: mean-cosine test); ozone of 300 DU in a
  Gaussian layer at 22 km with the Leckner (1978) coefficients tabulated by
  Bird and Riordan (1986); black-body sun at 5772 K with the IAU 2015
  nominal radius (1361 W/m²); 34 bands of 10 nm from 380 to
  720 nm → XYZ with the Wyman, Sloan and Shirley (2013) fit → linear Rec. 709.
  Single scattering by quadrature along the ray (steps
  of 2 km and 0.05 of optical depth, the transmittance towards the
  observer integrated exactly at each step; a test compares it with Monte
  Carlo to 1 %); multiple scattering by Monte Carlo with a sun estimate at
  each event, all bands at once with one-sample MIS between
  bands (balance heuristic), forced upward collision,
  directions from the mixture of the two phases and a lobe towards the sun,
  Lambertian ground and the two albedos (0 and 1, and 0.2 for validation) from the
  same paths. Deterministic: own elementary `f64` functions
  (`dmath`), one xoshiro256** stream per (seed, sky, direction),
  results in fixed bins.
- **Fit** (`model.rs`, `fit.rs`): the Hošek and Wilkie functional form,
  per channel, turbidity 1–10 and albedo 0 and 1 (60 knots); `L_M` by linear
  least squares (6-point Bézier in (elevation/90°)^(1/3)), each
  elevation alone (grid of the four non-linear coefficients with the
  five linear ones solved exactly, Levenberg–Marquardt from the eight
  best and from the previous elevation with a weak pull towards it, and
  another pass dividing by its own model and not by the noisy data),
  Bézier curves through the non-linear ones, the 30 linear points solved
  exactly for them, and own Levenberg–Marquardt over the 54 points
  against all the elevations. Bounds: |H| < 0.95 and E ≤ −0.5 (without it
  pairs C ≈ −100, D ≈ +100 appeared that imitated a straight line in γ and
  ruined the joint start).
- **Recipe** (`dataset.rs`, in the header of `sky_table.rs`): seed
  `0x0e5c5c1e`, 272 multiple-scattering paths per direction, 16
  sun elevations (90° (i/15)³), 768 directions (3° rings up to
  84° and 1.5° up to the horizon by 24 azimuths) and 34 bands. Table:
  3240 coefficients and 360 `f32` radiances, **SHA-256
  `2329ac7376204749a317d5b31e23e17fa27950515be0f0d50018cd9c16e8a721`**.
  `cargo run --release -p rt-sky -- table` simulates (about 10 min with 3
  threads on the shared machine) and fits (about 12 min). Regenerated from
  scratch with 2 threads instead of 3: the simulation and the table come out
  byte for byte identical.
- **Engine**: `PhysicalSky` in `rt-core/src/sky.rs` behind the Preetham
  interface (`new`, `radiance`), blending radiances (not
  coefficients) between turbidities and albedos, ground albedo 0.2, sun from 0
  to 90°; `sky_image` normalises it to the dome's irradiance as before,
  with compensated sums (Neumaier) only in the physical one: the classic gives the
  same bits as in E5. `ENVR.sky_model` (84 B): 0 physical (also an RSB
  without the field and any unknown value), 1 classic; it is the last
  field. *Hashes*: the earlier ones do not move (example `0x223515c3`, E5 HDRI
  `0xbf8abd5b`, E5 sky `0x2fcb098a`, which now asks for *Classic*
  explicitly); new **`0x8bb09f6b`**, the E5 scene with the physical
  sky at 12° and turbidity 2.5 (`rt --write-e5c-example`), equal in
  scalar, SSE2, AVX2, scalar WASI and `simd128` and with the real
  `rt_wasm.wasm` (new `engine.yml` step). The contact sheet adds four
  physical/classic pairs (dawn, golden hour, noon, haze).
- **Preview and interface**: `src/core/sky.ts` ports the physical sky
  over `src/core/f32math.ts`, which emulates the engine's `fmath` in `f32`;
  `tests/fixtures/sky-physical.json` (6 skies, 354 pixels, written by
  `rt-sky fixture` and checked up to date by an `rt-sky` test) matches
  **bit for bit** (6372 values). `skyModel` (`PHYSICAL` · `CLASSIC`) in the
  state, the project (without the field: `PHYSICAL`) and the library;
  *Environment* ▸ *Sky* ▸ *Model* (*Physical · Classic*, with help), in es and en;
  haze goes down to 1.
- **Validation** (`rt-sky validate`, `validation.json`): 40 low-noise
  skies (4352 paths; turbidity 2, 2.5, 4, 6.5 and 9, sun at 0.5, 3, 10, 20,
  35, 50, 70 and 85°, none at a fit elevation and half between
  two turbidities), 143 directions. Relative RMS error of luminance
  outside the aureole (10°), ground black / white / grey 0.2 interpolated:
  **sun ≥ 20°: 1.0–7.9 % (mean 3.8) / 1.4–5.3 % (2.3) / 2.8–7.3 % (4.1)**;
  sun at 10°: 5.2–14.6 % (8.5) / 3.5–10.0 % / 4.6–13.7 %; **sun ≤ 3°:
  9.2–16.7 % (12.9)** / 6.4–11.1 % / 8.7–15.6 %. The noise of the fit
  data is 1.8 % per sky at T 1, 3–5 % at T 2 and 5–9 % at T 6–9 (another
  seed): the 9.5 % mean of `table.json` against that data is mostly
  noise. Shape against the CIE clear sky (ISO 15469, L/L_z
  outside the aureole, sun ≥ 10°): type 12 against turbidity ≤ 2.5,
  23 % mean (Preetham 44 %); type 13 against 4–6.5, 22 % (Preetham
  43 %). On the almucantar, at 65° the physical one follows type 12 to within
  10 % from 3 to 30° of the sun; at 30°, the aureole of turbidity 2.5 comes out 1.45–1.7
  times that of type 12, close to 13 (informative). Ozone checked: at
  1° the zenith goes from xy (0.300, 0.318) without ozone to (0.265, 0.279) with it
  (Preetham: 0.281, 0.301).
- **New tests**: 22 in `rt-sky` (elementary functions against `std`,
  standard atmosphere and Rayleigh against their tables, normalised phases and
  mean cosine, Linke turbidity, layer geometry, simulation equal
  with 1 and 3 threads, quadrature against Monte Carlo, analytic gradient,
  fit of a synthetic sky and its determinism, SHA-256, cache, grids,
  the table against its *hash* and against the two generated sources, the
  *fixture* up to date), 4 in `rt-core` (physical sky, linearity and inputs, classic
  intact, RSB `sky_model`) plus the E5c *hash*, the sheet's physical/classic pair
  in `rt-cli` and 6 in `tests/sky-physical.test.ts`; they were
  checked to fail by reintroducing six errors (Cornette–Shanks
  parameter = asymmetry, turbidity weights swapped in engine and
  preview, old RSB read as classic, uncompensated sums, the
  model not written to the RSB).

Captures of each milestone (for the sign-off, which the lead gave): simulator
skies in fisheye, fit against simulator with an error map at
automatic and fixed exposure, the product scene with both models and
the *Fast* view with the *Inspector*.

What did not fit the plan:

- **Limit of the functional form with a low sun (accepted by the
  lead).** The < 5 % target is met with the sun at 20° or more (except
  turbidity 9 at 20°, 7.9 %); at 10° the error is 5–15 % and below
  3° it is 9–17 %, and fitting each elevation separately already leaves it at
  12–18 %: it is the form, not the fit nor the interpolation (loosening
  the bounds does not improve it either). It shows as an azimuthal pattern of ±20 % at dawn and a
  golden-hour glow with haze about 20 % dark next to the sun, along
  the horizon. **Proposed continuation** (not built):
  a small residual-correction table for the sun below
  ~10°, fitted with the same simulator (ours, with recipe, seed and
  *hash*) and applied as a factor after the analytic model.
- **The regeneration command is `rt-sky table`**, a separate binary, not
  an option of `rt`: the simulator must not ship in the `rt` that is distributed.
- **Ozone** uses the Leckner coefficients as tabulated by Bird and
  Riordan, written with two or three digits and, at the Chappuis peak
  (0.12 (atm·cm)⁻¹), about 10 % below modern laboratory
  cross-sections; they should be checked against the original table. **The
  sun** is a 5772 K black body, not the measured spectrum (it lacks
  the Fraunhofer lines and runs about 10 % low between 450 and 550 nm); it only
  affects colour, and little, because the sky is scaled to the dome.
- **Ground albedo fixed at 0.2** (the usual one in solar engineering): the
  model accepts 0–1 (`PhysicalSky::new` receives it) but `ENVR` has no
  field and the interface no control; product decision for the lead. Mixing
  linearly between albedos 0 and 1 costs what is seen in the grey
  column of the validation (2.8–7.3 % with a high sun).
- **Old projects and RSBs open with the physical sky** (the default
  value, as the plan said): an E5 project with *Sky* changes
  look when opened; if it is preferred that it keep the classic one, it is a
  one-line schema step. E5's pinned scene asks for *Classic* so that
  its *hash* does not move.
- **The preview is not `f64`**: in the first factor (1 + A e^(B/(cos θ
  + 0.01))) A ≈ −1.1 and the result cancels down to ~0.12 near the zenith,
  and the engine's `f32` differed from `f64` by 1.5·10⁻⁶; emulating `f32` gives
  the same bits. Haze goes from 1 to 10 in both models; the classic one
  clamps it to 1.7.
- **The milestone captures (a)** were made before correcting the aerosol
  asymmetry; those of (b) to (d), with the final table.

## E5b-1 · Caustics and own *denoise* — **Opus** — done

**Request from the owner (2026-10-13):** “also integrate caustics,
*denoise*…”. This part of E5b is brought forward; floor reflection, image
effects and the render region stay in **E5b-2**.

**Lead's decisions.**
- **Own *denoise***, in dependency-free Rust (in `rt-post` or in a
  *crate* of its own, native and wasm), written from the public literature
  (feature-guided non-local means, Rousselle, Knaus and Zwicker 2012;
  edge-aware à-trous, Dammertz et al. 2010): guided by X2's exact passes
  (albedo, normal, depth, ids) and by the **per-pixel variance**
  (the film also accumulates the sum of squares). Deterministic: the
  same input gives the same bits natively and in wasm. No networks and no
  third-party weights.
- Where: *Render settings ▸ Advanced ▸ Denoise* (*Off · Viewport ·
  Render · Both*, default **Both**) and a switch in the *Full*
  viewer; in the render the clean image is saved and, if requested, the
  original (*Also save without denoise*). It never touches the AI image
  except as input.
- **Caustics**: progressive photon map (SPPM, Hachisuka and Jensen
  2009) for light → specular → diffuse paths, deterministic, without
  counting twice what the tracer already brings; *Caustics* switch in
  the render window (default **automatic**: on when the
  scene has glass or polished metal and small lights), with its quality in
  *Advanced*. Solid glass still blocks the direct shadow; the light that
  passes through it arrives by the caustics.

**Acceptance.** *Denoise*: error against a many-sample reference
lower than the unfiltered image at the same number of samples (`--sheet`
scenes), id edges intact (no mixing between parts), bit-for-bit
native/wasm parity, *hashes* of the image without *denoise* unmoved.
Caustics: a glass sphere on the floor with a small light
gives its pool of light with the expected energy (analytic test or against a
long tracer reference), no fireflies in the image with
*denoise*; determinism with any number of threads. Captures before and
after.

**Done.**

- **Variance in the film.** `Film::lum2` sums the square of each sample's
  luminance (`f32`, in sample order) without touching the
  radiance, the weight or the coverage: no image *hash* moved
  (example `0x223515c3`, E5 `0xbf8abd5b`, E5 sky `0x2fcb098a`, E5c
  `0x8bb09f6b` and the six X2 passes, on all SIMD paths, WASI and
  the real `rt.wasm`). The page sums it with the same rule
  (`Accumulator.lum2`, `Math.fround`).
- ***Denoise*** (`rt_post::denoise`, Rust with `std`, no one's weights):
  edge-stopping à-trous of Dammertz, Sewtz, Hanika and Lensch (HPG
  2010; B3 kernel, five passes with steps 1–16 px) with the luminance
  stop guided by the SVGF variance (Schied et al., HPG 2017:
  variance blurred 3 × 3 and propagated as `Σ w² Var / (Σ w)²`, normal
  `max(0, n·n')^128`, depth with its gradient, albedo divided out and
  multiplied back in, 7 × 7 spatial variance below four
  samples). What is ours: the film's variance, X2's exact passes as
  guide, **zero weight between two parts or two materials** (it never
  mixes them) and the background intact, a firefly clamp before filtering
  (a pixel more than four times brighter than all its neighbours on the
  same surface drops to that) and `(1 − x/16)^16` instead of exponentials.
  Row bands with a 72-row halo, exactly those rows of the whole
  image, so `rt`, the launcher and the page split the work
  as they like with the same bits. Relative error (relMSE) against a
  384-sample reference on sheet scenes (48 × 36, the test):
  *key-only* 0.0401 → 0.0132 at 4 spp and 0.0048 → 0.0030 at 16; glass
  jar 0.1259 → 0.0301 and 0.0284 → 0.0070; at the sheet's size, between
  4 and 20 % of the unfiltered error at 4 spp. Cost: 4.6 s for a
  1920 × 1080 image on one thread and 2.4 s on four (shared, loaded machine).
  Pinned *hash* `0xab15f290` (`PINNED_DENOISED_EXAMPLE_4SPP`, the example
  at 4 spp), equal natively, in the real `rt.wasm` by bands and in the
  page's code with 1 and 2 *workers*.
- **Caustics** (`rt_core::caustics`): SPPM (Hachisuka and Jensen 2009) in
  the probabilistic form of Knaus and Zwicker (2011): each sample index
  is a pass with its photons, with no per-pixel state, and the film
  averages the passes. *Caster* / receiver / straight-event partition, map
  of the `L C+ R` stretches gathered at **each** receiver of the camera path
  and the tracer without that light (see the glints, below); emission directed at
  the *casters'* bounding spheres with the mixture density,
  flux without 1/η², Veach's adjoint normal correction, PCG per
  (seed, sample, photon), *hash* grid, Epanechnikov kernel;
  shadow catcher with caustics relative to the open floor. Measured cost: the
  jar at 640 × 480 and 64 spp, 9.2 s without photons and 11.4 s with 16,384 per
  sample (*Medium*), 24 % more. Pinned *hash* **`0x55d60f2f`**
  (`PINNED_E5B_CAUSTICS_4SPP`, the E5 scene with 2048 photons per
  sample, `rt --write-e5b-example`), equal in scalar, SSE2, AVX2, WASI
  scalar and `simd128`, the real `rt.wasm`, the launcher with 1, 4 and 16 threads and
  the page's code.
- **RSB**: `RNDR` grows to 52 B with `denoise` (bit 0 clean image, bit 1
  also the original), `caustic_photons` (up to 2²²) and `caustic_radius`
  (px); an earlier RSB is read without *denoise* or caustics. **Hosts**:
  `rt --denoise --keep-noisy --caustics N --caustic-radius R` and the sheet
  with the new pairs; the launcher traces the maps by ranges on all
  its threads, in the viewer it denoises on the first frame, on the last
  and in between only if three times what the last one cost has passed, and
  the final render delivers the clean one and, if requested, the original; in the
  page each *worker* traces the maps for its samples (guard 16) and the
  *pool* denoises by bands (`rt_denoise`).
- **Interface**: *Quality* ▸ *Caustics* (*Automatic · On ·
  Off*; *Automatic*: a *caster* and a *glossy* light that seen from
  them does not exceed 20°, a sun or a lit emitter); *Advanced* ▸
  *Caustic quality* (*Low* 4096 photons and 4 px, *Medium* 16,384 and
  3 px, *High* 65,536 and 2 px), *Denoise* (*Off · Viewport ·
  Render · Both*, default *Both*) and *Also save without
  denoise*; in the *Full* viewer, the meter says *Denoised*
  and *Caustics · N photons per sample* when the engine does it,
  and the *Denoise* button changes only the viewer part. The AI receives
  the clean image as input.
- **Tests**: 19 new in `rt-core` (classification of *casters*; flux of a glass sphere against
  an exact `f64` integration, 0.2 %; kernel; split and SIMD of a
  map; radius schedule; partition against the tracer alone in the
  shadow of a sphere, under a polished-metal sphere, with two overlapping
  spheres, on a floor lit by a wall's caustic and with an L4
  point light next to the map; solid
  glass; shadow catcher; light enclosed in glass with an empty map; partition
  states; tile order; `lum2`; RSB; pinned *hash*), 7 in
  `rt-post`, those of `rt-cli` (threads 1/4/16, *denoise*
  error, CLI), `rt-wasm`, `rt-app` (parity with `rt`, viewer, caustics
  with 1/4/16 threads) and the interface (`tests/denoise.test.ts` with the
  real `rt.wasm`, *pool*, launcher, queue, RSB). They were checked to fail
  by reintroducing each error: without the discard rule, without gathering, without η²,
  badly normalised kernel, without shadow catcher, frozen radius, state that
  changes on a straight event, NEE not discarded at a *caster*, single-cone
  density, state that does not restart at the second receiver,
  gathering only at the first, a point's light removed with the map
  on, without the id stop, short halo, `lum2` without the square (in Rust and
  in the page), without saving the original, without reading it from the launcher.

**Caustic convergence (question from the lead).** Yes: the radius
shrinks with the passes as Knaus and Zwicker say,
`r_i² = r_1² Π_{k=1..i} (k + α)/(k + 1)` with α = 2/3, so
`r_i ∝ i^(−1/6)` (r_1024 ≈ 0.33 r_1); it converges to final quality without per-pixel
state. Measured on the jar at 240 × 180 (r_1 = 3 px, 16,384 photons per
sample), caustic region = 2328 floor pixels in the shadow of the
centre of the light more than 2 px from the silhouette; relMSE (mean of
`(x − r)²/(r² + 0.01)` per channel, values clamped to 1) against a
long reference with another seed:

| samples | radius | dome 0.12 (ref. 8192 spp) without / with *denoise* | black environment (ref. 4096) without / with |
|---|---|---|---|
| 16 | 1.98 mm | 0.0224 / 0.0104 | 0.0325 / 0.0168 |
| 64 | 1.58 mm | 0.0074 / 0.0052 | 0.0107 / 0.0077 |
| 256 | 1.25 mm | 0.0037 / 0.0032 | 0.0051 / 0.0044 |
| 1024 | 1.00 mm | 0.0026 / 0.0025 | 0.0031 / 0.0031 |

Region mean at 1024: 0.2852 against 0.2864 for the reference
(dome) and 0.2181 against 0.2186 (black). Before correcting the glints
the curve rose at 1024 (0.0048 and 0.0068): two pixels with a glint
accounted for 77 % of the error. The references were made before that
correction (the tracer is unbiased for those paths, so they are valid).
The sheet adds the requested pair: the jar with caustics at 1024 samples
(*Final*), without and with *denoise* (`e5b-bottle-caustics-final`).

**The glints of the *Final* pair (question from the lead).** With each sample
split by path type (260 × 125 crop around the base,
1024 spp): of 324 pixels with a glint, **157 were of type (a)**: light from
a photon light that, after the path's **second** receiver, arrived
through the glass (`L C+ R C* R E`, a caustic seen through a diffuse bounce:
the floor next to the jar seeing the caustic through the glass). The
partition gathered the map only at the first receiver and left to the tracer
everything after: it did not count twice (the energy added up), but those
paths arrived in one sample out of a thousand with about 1300 times the mean
value. **Fixed**: each receiver gathers the map (those after the
first with the indirect-light clamp) and the tracer discards that light
after any receiver; new tests (light enclosed in a glass ball:
with an empty map all receiver pixels stay black, and the
energy of a floor lit by a wall's caustic matches the tracer alone to −3 %;
with the earlier code, 305 of 814 pixels light up and the floor comes out −11 % at 192
spp). Of type (b) there is nothing: solid
glass blocks NEE and NEE at a *caster* after a receiver is
discarded. **40 pixels of type (c)** remain, real highlights: the light seen
through the glass base (`E C+ L`, also the stopper's highlight through
it), two 2–4 px spots with means of up to 81 that *denoise*
keeps, and the focal line of the caustic at the edge of the base (stable
from sample to sample). Captures: `docs/ui/engine-e5b1-bottle-caustics-final.png`
(the pair redone) and `docs/ui/engine-e5b1-bottle-glints-4x.png`
(the base at 4×: before, after and after with *denoise*). Scenes without
caustics do not change bits.

Captures: `docs/ui/engine-e5b1-denoise-4spp.png` (4 spp without and with
*denoise*), `docs/ui/engine-e5b1-bottle-caustics.png` (the jar at 64 spp
without and with caustics) and the two above.

What did not fit the plan:

- **SPPM without per-pixel statistics**: the radius is global per pass
  (Knaus and Zwicker) and not Hachisuka and Jensen's per visible point; this is what
  allows rendering tiles in any order and thread with the same
  bits. It converges the same, but the radius does not adapt to local density.
- **The environment emits no photons** (its caustics stay in the tracer) nor
  do non-*glossy* lights, nor the **points, spheres and directional spots of
  L4** (they arrived with the merge: their caustics stay in the tracer, so
  a point gives none, and *Automatic* does not count them; a test
  checks that with the map on the tracer does not remove their light through
  the glass); the `E C+ L` highlights of small lights on smooth
  glass remain the tracer's (they are real, but converge slowly).
- **Caustics of the first receiver do not go through the indirect-light
  clamp** (`clamp_indirect`); those of the following ones do.
- **Shadow catcher with a transparent background**: no caustics (its alpha carries
  only the shadow).
- ***Denoise* filters RGB, not the coverage**, and is not applied to the
  reduced-resolution frames of gestures; between two *denoise* runs the
  viewer shows the last clean one. The firefly clamp loses some
  energy where there are any.
- **The *Caustics* switch is in *Quality*** and its quality in
  *Advanced*, as the plan asked, but both fields are saved in the project's
  `advanced`; old projects open with *denoise*
  *Both* and caustics *Automatic* (the defaults).
- ***Automatic*** decides with a 20° threshold for “small light” and
  counts brushed metal as a *caster* along its brush direction
  (`r ⁴√(1 − 0.9 a)` ≤ 0.25), so the jar's stopper is one.
  **Decision taken (Fable): both stay.** *Automatic* means
  “on when a sharp caustic can appear that the tracer would only
  find by chance”, which is exactly what gives fireflies. A light
  of more than 20° seen from the object (a 1 m *softbox* closer than about
  2.8 m) gives caustics so soft that the tracer resolves them well, and it does not
  turn them on. A brushed metal under a small light does cast onto the floor
  a streak of light along the brush, so it counts. The cost
  (≈ +24 %) is only paid with a small light in the scene, and *Off* remains
  available by hand.
- **The cost in the *Full* viewer** is stated in the meter (photons per
  sample) and in the help, not in seconds.

## Towards the best Full mode — decision **Fable** (after v0.1.5)

**What is already there, and is good.** Sobol with Owen *scramble* per pixel and
dimension (Burley 2020) and a verified pair *layout*; next-event
estimation with the power heuristic; anisotropic GGX with glass refracted by microfacets
(Walter 2007), absorption, thin wall, cut-out
and clearcoat with an energy-conserving layer; HDRI by 2D CDF, own physical
sky, sun as a disc; caustics by progressive photon map; own
pass-guided *denoise*; soft shadow terminator (RTG II); ACES,
filmic and AgX curves; bit-level determinism with any number of threads. It is
a serious foundation. What follows is what separates a “correct” render from
a photograph, in order of how much it shows in a product photo.

**What is missing, in order of visual importance.**

1. **Hard edges.** A CAD model has mathematically sharp edges,
   and a sharp edge catches no light: the “3D look” shows at first glance.
   The bevel in shading (E6, brought forward and moved to Opus) is the cheapest and
   most visible realism improvement we have left.
2. **Translucent materials and liquids.** Bottle plastic (HDPE, PP),
   soap, wax, frosted acrylic, milk, juice, creams: today they cannot be
   done well (there is absorption, not scattering). It is the material of
   *packaging*. Scattering media inside a solid (E9b).
3. **GGX energy.** A rough metal or plastic loses up to 40 %
   of light with single microfacet scattering: they come out dark and
   dull compared with reality. Multiple-scattering compensation
   (E9a). Small and with an immediate effect across the whole catalogue.
4. **Noise where it matters.** Today every pixel receives the same samples; the
   per-pixel variance we already keep (`lum2`) allows giving more to
   shadow edges, glass and highlights and less to the background. Deterministic
   adaptive sampling and “finish by noise” (E10): the same cleanliness
   in less time, or more cleanliness in the same.
5. **Live noise reduction** in the viewer, with its switch in
   the top bar (U11, requested by the owner).
6. **Textures and labels** (M2): without the pack artwork there is no
   product photo. It is not engine quality, it is what is missing for “the
   best result”; it goes in the next wave.
7. **Chromatic dispersion** of glass (perfume, crystal): E9c, at the end
   of E9 if it fits, with a wavelength per path (no spectral engine).
8. **Camera optics** (aperture blades, cat's eye, vignetting,
   chromatic aberration): already planned in `STUDIO-TOOLS.md` §1 and not
   duplicated here.
9. Afterwards: light tree (K4) when there are many lights; manifold
   estimation (MNEE) for the highlights of small lights through glass;
   temporal viewer *denoise*; BVH performance (E8); IES (L5).

**What is not done, and why.** Spectral engine: it multiplies the cost and
only adds value in dispersion and metamerism; dispersion is solved with
one wavelength per path. Bidirectional or Metropolis: caustics
are already given by the photon map and adaptive sampling solves the rest better.
GPU: outside the engine's rules (portable, dependency-free, deterministic).

**Order.** Wave A, in parallel: U11, E9 (a, then b, then c if it fits) and
E6 (bevel first). Wave B: E10 (touches the render loop, after U11)
and M2. Each phase, one PR; `npm run qa`, `engine:test` in *debug* and
*release*, pinned *hashes* intact except where the phase says otherwise.

## U11 · Live noise reduction — **Opus** — done

**What.** A **Denoise** switch in the top bar, to the right of
*Fast · Full*, with the same state as the viewer meter's button and as the
*Viewport* bit of *Advanced ▸ Denoise*
(a single source of truth, undoable, saved in the project as until now);
in *Fast* it appears disabled with the help “applies to Full
mode”. And it must be **live**: today the viewer denoises on the
first frame, on the last and in between only if three times what the
last one cost has passed, and meanwhile shows the last clean one,
which lags behind. It must become: (1) on switching it on, denoise the current
accumulation at once; (2) while accumulating, a *denoise* in a
separate lane (one launcher thread; on the web, the *workers* by bands
as now) that does not stop the render and presents the result as soon as it
finishes, with the next one starting then, so that the viewer
refreshes the clean image as often as a *denoise* costs and never
shows a clean one older than one *denoise*; (3) a **viewer preset**
of the filter (3 à-trous passes instead of 5 and no 7×7 spatial variance
from 4 samples, or whatever measures best) so that at the viewer's size
it stays under ~0.4 s on 4 threads; the final render keeps the
full filter. Keyboard shortcut (a free one; document it), guided-tour step
updated, string in `es` and `en`.

**Depends on.** E5b-1.

**Acceptance.** With the viewer in *Full* and the switch on, the clean
image refreshes at least every `max(2 × denoise cost,
0.5 s)` (launcher test with a fake *denoise* of fixed cost); on
switching it off, the next frame is the noisy one; the final render does not
change *hash* (`0xab15f290` of the example with *denoise*); gestures
keep going at reduced resolution without *denoise*; capture `docs/ui/
denoise-live.png` with the top bar.

**Done.**

- ***Denoise* switch** in the top bar, to the right of
  *Fast · Full* and in the same area (`data-guide="viewport-mode"`,
  the one that surrounds the *Fast and Full* step of the guided tour, whose
  text names it with its shortcut): a one-position button, achromatic,
  inverted when on, with its *tooltip* and the shortcut **`D`**
  (free; in the table of UI.md §3). **A single source of truth**: the *Viewport* part
  of `render.advanced.denoise` (*Both* ↔ *Render*, *Viewport* ↔
  *Off*), which the bar, the meter button and `D` read and change with
  the same command (`toggleViewportDenoise`), through the *store*, undoable
  with its name (*Denoise the viewport* / *Stop denoising the
  viewport*) and saved in the project. In *Fast* it appears disabled
  with the help *Applies to Full mode* and `D` only says so.
- **Viewer preset of the filter** (`rt_post::denoise::Preset`): `FULL`
  (E5b-1's, for the render and `rt`, same bits: `0xab15f290`) and
  `VIEWPORT`, **three à-trous passes and 3 × 3 spatial variance**
  below four samples, with its own halo of 24 rows
  (`Preset::halo = 2^(passes+1) + 8`, which gives the 72 of the full one).
  Bands exactly equal to the whole image with both; pinned *hashes*
  of the example with the viewer one at 2 and 4 samples
  (`PINNED_DENOISED_VIEWPORT_EXAMPLE_2SPP` = `0x04d4a08c` and `_4SPP` =
  `0xc90ee509`; with E12's light selection, `0x17514303` and
  `0x6db6039b`), equal natively, in the real `rt.wasm`
  (`rt_denoise_with`, `rt_denoise_halo`) and by the page's code with
  1 and 3 *workers*. It is chosen by the kind of job; the `RSB`/`RNDR` does not change.
  Measured (table below): of the eight combinations tried it is the one that gives
  the best quality under ~0.4 s at the viewer's size with four
  threads.
- **Live, in the launcher** (`rt-app/src/render.rs`): a full-resolution
  viewer always renders the guides and has its switch
  (`denoise=0|1` when published, `POST /api/render/<id>/denoise?on=0|1`
  afterwards). Each pass is handed to its own **lane** (one thread per
  viewer job) which, when on, denoises the newest pass,
  presents it as soon as it finishes and then starts the next one on the newest;
  while working it **takes one of the viewer's render threads**
  (the last of those rendering, `Gate::viewport_turn`), so
  with a final render running it never takes a thread from that one. On switching on
  it denoises what has accumulated at once (if it already had the
  clean one for that pass, it just shows it), also with the viewer already
  finished; on switching off, the next frame is the noisy
  accumulation, published in the same call. With the switch on the
  passes last as long as a *denoise* and at least 250 ms (`live_pass_cap`):
  as a sample falls into whichever pass without changing a pixel, the clean
  image arrives at most one pass and one *denoise* after the
  previous one. The earlier rule (first, last and in between if three
  times what the previous one cost had passed) disappears in the viewer; the
  final render still ends with a *denoise* using the full filter.
- **On the web** (`render/pathtracer.ts`): the same, with the lane in the
  viewer's *workers* by bands between their tiles (the passes continue);
  the page keeps the sums of the last pass for it. The same short
  passes (`livePassCap`).
- **Frames with an image number**: the `RPX1` header grows to 52 bytes
  with `Frame::version`, which changes every time the sums change (a
  pass, a clean image, the switch). The page's *long-poll*
  requests it with `version=`; the launcher sends the sums only with a newer
  image, and with a viewer already finished it waits for the clean one that was requested.
  An older reader reads the header by its length, which is in it.
- **Gestures** keep going at reduced resolution, without guides or *denoise*.
- **Tests** (rt-post 4, rt-wasm 1, rt-app 6 unit and 1 over HTTP; the
  interface: `tests/live-denoise.test.ts`, 12; `tests/pathtracer.test.ts`,
  3 new and 1 redone; `tests/denoise.test.ts`, 2 new, one with the
  real `rt.wasm`) and a check in the browser
  (`tools/denoise-live-check.mjs`). They were checked to fail
  by reintroducing each error (list below).

**Measurements.** Shared 4-core machine; the “calm” times are
from when the other agents were barely loading it (load 1–3), the “loaded” ones with
load 10–16.

*Quality* (relMSE against 1024 samples with another seed, 480 × 280, part
pixels only; five passes and 7 × 7 is the full filter, `L3r1` the
chosen viewer one):

| scene · spp | unfiltered | full | L4 7×7 | L4 5×5 | L3 7×7 | L3 5×5 | **L3 3×3** | L2 5×5 | L2 3×3 |
|---|---|---|---|---|---|---|---|---|---|
| example · 1 | 0.5123 | 0.0137 | 0.0147 | 0.0149 | 0.0195 | 0.0195 | **0.0215** | 0.0375 | 0.0393 |
| example · 2 | 0.1646 | 0.0044 | 0.0046 | 0.0045 | 0.0058 | 0.0057 | **0.0060** | 0.0108 | 0.0111 |
| example · 4 | 0.0634 | 0.0019 | 0.0019 | 0.0019 | 0.0021 | 0.0021 | **0.0021** | 0.0034 | 0.0034 |
| example · 16 | 0.0077 | 0.0007 | 0.0007 | 0.0007 | 0.0007 | 0.0007 | **0.0007** | 0.0008 | 0.0008 |
| jar · 1 | 0.3279 | 0.0447 | 0.0457 | 0.0415 | 0.0453 | 0.0421 | **0.0371** | 0.0443 | 0.0439 |
| jar · 2 | 0.1612 | 0.0396 | 0.0401 | 0.0354 | 0.0389 | 0.0350 | **0.0266** | 0.0311 | 0.0269 |
| jar · 4 | 0.0739 | 0.0144 | 0.0145 | 0.0145 | 0.0151 | 0.0151 | **0.0151** | 0.0163 | 0.0163 |
| jar · 16 | 0.0223 | 0.0067 | 0.0067 | 0.0067 | 0.0068 | 0.0068 | **0.0068** | 0.0072 | 0.0072 |
| board · 1 | 0.4434 | 0.0466 | 0.0482 | 0.0462 | 0.0530 | 0.0508 | **0.0468** | 0.0675 | 0.0634 |
| board · 2 | 0.1622 | 0.0365 | 0.0370 | 0.0346 | 0.0386 | 0.0360 | **0.0304** | 0.0421 | 0.0365 |
| board · 4 | 0.0812 | 0.0171 | 0.0172 | 0.0172 | 0.0176 | 0.0176 | **0.0176** | 0.0199 | 0.0199 |
| board · 16 | 0.0352 | 0.0073 | 0.0072 | 0.0072 | 0.0073 | 0.0073 | **0.0073** | 0.0080 | 0.0080 |

At 64 samples all nine come out equal (0.0002 / 0.0021 / 0.0033–0.0034).

*Time* at 1200 × 700 (the best of 3–5; “4 bands” are four threads with the
halo of each preset):

| | full, 1 thread | full, 4 bands | viewer, 1 thread | viewer, 4 bands |
|---|---|---|---|---|
| example (all part), calm, 2 / 4 / 16 spp | 1.92 / 1.77 / 1.54 s | 1.04 / 1.12 / 0.82 s | 1.16 / 0.94 / 0.91 s | 0.46 / 0.33–0.40 / 0.33 s |
| jar, calm, 2 / 4 / 16 spp | 1.28 / 1.04 / 1.12 s | 1.06 / 0.65 / 0.82 s | 0.70 / 0.69 / 0.75 s | 0.35 / 0.31 / 0.31 s |
| example, loaded, 2 / 4 / 16 spp | 1.90 / 1.67 / 1.68 s | 1.71 / 2.16 / 1.81 s | 1.05 / 0.99 / 1.07 s | 0.63 / 0.66 / 1.04 s |
| example at 1920 × 1080, loaded, 2 / 4 spp | 6.46 / 6.39 s | 8.69 / 8.70 s | 4.56 / 3.46 s | 4.25 / 4.08 s |

With four free threads the viewer one stays under the ~0.4 s of the plan
at 1200 × 700 (0.31–0.46 s); L4 no longer does (0.45–0.69 s). The guides, when the
switch is on, add 30 % per sample to the example and 19 %
to the E5 scene (1200 × 700, 4 spp, 4 threads).

*The launcher's lane*, taking a viewer thread or as an extra thread
(the example at 1200 × 700, 4 threads, real filter, 15–20 s): calm, 12 against
16 samples rendered and 5 against 4 clean images (*denoise* of
3.4 against 3.1 s, with the viewer and the lane competing); loaded, 8 against
8–9 samples and 3–4 against 2–3 clean (*denoise* 3.5–5.1 against
5.1–5.2 s). Indistinguishable at this load; the one that takes a thread
from the viewer stays, since it takes nothing from a final render. Observed refresh: the
mean of the gaps between clean images is what a *denoise* costs (4.8–5.2 s
at that cost), the maximum 6.6 s, below `2 × denoise`.

*On the web* (`tools/denoise-live-check.mjs`, swiftshader, 3 *workers*, viewer
of 840 × 775, loaded): 20 clean images in 24 s, gaps of 0.72 to
1.77 s with *denoise* of 0.33 to 0.97 s; 16 of 19 within
`max(2 × denoise, 0.5 s)` and 3 bounded by the pass (one sample of the whole
view cost ~1.2 s and arrived more than one *denoise* after the previous
clean one); no clean image from an old pass.

*Checked to fail* by reintroducing each error: the launcher with the
earlier rule (wait twice the cost after each clean one), with the
lane on an old input (300 ms delay before filtering), without
publishing the noisy one on switching off, without waiting for the clean one of a finished
job, without starting the lane on switching on, without the albedo of the
first samples, without taking the viewer's thread, without shortening the passes,
with the full filter in the viewer or the viewer one in the final, with the
sums even if the image is not new; `rt-post` with a short halo and with the
7 × 7 in the viewer; `rt_denoise_with` ignoring the preset; the web without
starting the next *denoise* on return, stopping the passes while
filtering, without filtering on switching on, without removing the clean one on switching off, without
shortening the passes, with the switch counting as an image change,
with the albedo always; the page's launcher republishing the
view, without following it again once finished, without `version`; the command
changing the render window's draft and without refusing in *Fast*;
a page halo different from the engine's; the guides without accepting gaps.
Capture: `docs/ui/denoise-live.png`.

**What did not fit the plan.**

- **The guides are always rendered at full resolution**, also with
  the switch off: this is what allows denoising “the current
  accumulation at once” on switching it on. They cost (the albedo
  ray of each sample) between 19 and 30 % more per sample (the
  example and the E5 scene at 1200 × 700 on four threads), so
  with it off the albedo is rendered only for the first 8 samples
  (`LIVE_ALBEDO_SAMPLES`) and the clean image afterwards is made with those
  guides (the test compares it with a reference made that way). The plan did not say so.
- **The refresh has a floor: one sample of the whole viewer.** The shortest
  pass is one sample; if a sample of the whole view costs more
  than `max(2 × denoise, 0.5 s)` − *denoise* (a very large view, a
  slow scene, swiftshader on a loaded machine: in this machine's
  browser check, at 840 × 775, a sample took ~1.2–1.3 s and
  the *denoise* 0.3–1.0 s), there is nothing newer to filter and the clean one arrives
  a pass later: the lane never waits while it has work (the
  check verifies it and counts those gaps separately). Meeting it there too
  would require filtering half-finished passes (tiles with `n` and `n + 1`
  samples, normalised): left for the lead if needed.
- **The launcher's lane is one thread** (what the plan asked for); the viewer
  preset drops below ~0.4 s on four threads by bands, but on one thread
  it costs ~0.7–1.2 s at 1200 × 700, and that is how long the
  clean one takes to refresh in the launcher. Giving it more threads would refresh sooner at the cost of
  converging more slowly: **Fable** decision (the data, below).
  *Lead's verdict*: the lane stays at one thread (the viewer
  shares the machine with the render, as decided in P3e).
- **“No 7 × 7 spatial variance from 4 samples”**: the 7 × 7
  is only used below 4 samples; the viewer preset leaves it at
  3 × 3 there, which measured is equal or better on the product scenes and worse
  on the example's smooth surface at 1–2 samples.
- **The last clean image of the converged viewer** also uses the viewer preset
  (the contract: it is chosen by the kind of job). A full *denoise* on
  converging would give somewhat more quality in the image that stays on
  screen: noted for the lead.
- **The launcher's protocol changes** (not the RSB): the `RPX1` header goes
  from 48 to 52 bytes with the image number, `GET /api/render/<id>`
  accepts `version=`, `POST /api/render` accepts `denoise=0|1` (only for
  views) and there is a `POST /api/render/<id>/denoise?on=0|1`. The RSB of a
  full-resolution view always says `denoise` bit 0 (the guides), whatever
  the mode; the switch goes separately.
- **Fixed along the way**: the meter button changed the queue job's
  draft when the render window was editing it (it used
  `setRenderSettings`); the new command always changes the project (with its
  test). And changing *Also save without denoise* or the *Render* part
  of *denoise* no longer restarts the viewer's image
  (`advancedTouchesView`).
- **The launcher's meter does not know what its *denoise* costs** (it is in
  `GET /api/render/state`, `liveDenoise.costMs`); the web's does, in its
  `data-*` attributes. Neither paints it as text.

## U11b · Denoise strength — **Opus** (with U11) — done

**What.** Request from the owner: choose how much *denoise* is applied. In the
render window, *Advanced ▸ Denoise* gains **Strength**
(0–100 %, default 100): the delivered image is the linear blend
`noisy × (1 − s) + clean × s`, per channel, in linear light, in the engine
(`rt_post::denoise` receives `s`; `RNDR` gains `denoise_strength` as a
final field; without it, 100 %: *hashes* intact). It applies to the final
render, to the *Full* viewer (the same strength: a single control) and
to `rt --denoise-strength`. At 0 % the filter is not run (the image
is the noisy one, byte for byte). Undoable, saved in the project's `advanced`;
earlier projects open at 100 %. `es`/`en` string.

**Acceptance.** Test: 50 % gives exactly the mean of the two images
(bits), 0 % the noisy one and 100 % the clean one; the `0xab15f290` *hash* at 100 %
does not change; wasm parity.

**Done.**

- **Engine** (`rt-post`): `blend(noisy, clean, s)` does in place
  `n × (1 − s) + c × s` per colour channel in `f32` (alpha is not touched;
  with `s = 0.5` the product by 0.5 is exact and gives `(n + c) / 2` bit for
  bit) and `denoise_rows_at(input, y0, y1, preset, s)` is the band already
  blended: with `s = 0` it does not run the filter and returns the noisy rows
  (still checking that the band brings its halo), with `s = 1` it is
  `denoise_rows_with`; outside `0..=1` it is clamped and NaN is 1. A band at
  any strength is exactly those rows of the whole image.
- **RSB**: `RNDR` gains `denoise_strength` (f32) at the end, 56 B; without it, 1;
  outside `0..=1`, the RSB is not valid. `rt-core` and
  `src/io/rsb.ts` write it byte for byte (fixtures `example.rsb`, `e5.rsb` and
  `e5b.rsb` regenerated: 16 bytes more each).
- **A single control**: the launcher uses it in the final render (full
  filter, in bands) and in the viewer lane (viewer preset); `rt
  --denoise-strength <S>`; wasm `rt_denoise_with(preset, s, …)`
  (`rt_denoise` is `s = 1`); the web, in the render (`Pool.denoise`) and in its
  lane. At 0 % a final is not filtered (without flag 64 or the noisy
  copy: the image is the noisy one) and no lane works.
- **Interface**: *Advanced ▸ Denoise ▸ Strength* in the render
  window (0–100 %, steps of 5, hidden when denoise is *Off*), with
  its note; `render.advanced.denoiseStrength` in the project, undoable
  (one drag, one entry), earlier projects open at 100 % and
  `engineFieldsOf` passes it to the engine as a fraction (`denoiseFraction`).
  `es`/`en` strings.
- **Tests**: `rt-post` (50 % is the mean bit for bit with both presets,
  0 % the noisy one, 100 % the clean one, bands equal to the whole image, the
  blend at 25 % and alpha intact; the example at 100 % keeps
  `0xab15f290`); `rt-core` (without the field, 1; out of range, error;
  round trip); `rt-app` (a final and a viewer at 50 % are the blend of
  `rt`, at 0 % the noisy one with no flag or lane); `rt-cli` (the option);
  `rt-wasm` (50 % and 0 % through the export); and on the page: the real
  `rt.wasm` at 50 % is exactly the mean and at 0 % the noisy one (both
  presets), the RSB bytes, the *store* (default, migration,
  clamping), the *pool* render and the viewer lane with the project's
  strength (and without *denoise* at 0 %). In the browser
  (`tools/denoise-live-check.mjs`, *strength* step): the *Strength* row
  under denoise, 100 % by default with its note; at 50 % the
  viewer restarts and is filtered again. Capture
  `docs/ui/denoise-strength.png`.

*Checked to fail* by reintroducing each error: the blend with the
weights swapped or touching alpha, NaN as 0, the band at 0 % without
checking its halo, `RNDR` reading 0 without the field or always writing 1,
the final filtering at 0 %, the lane working at 0 %, both ignoring the
strength (launcher and `rt`), `--denoise-strength` not reaching the scene,
wasm ignoring it; on the page, `engineFieldsOf` without it, the migration
to 0, the RSB writer (field and projection), the *pool* render
filtering at 0 %, the lane always at 100 % or working at 0 %, and the
band using `rt_denoise` (without strength) with a strength.

**What did not fit the plan.**

- **Changing the strength restarts the viewer's image**: it goes in the
  view's `RNDR`, like the rest of *Advanced*, and the launcher reads it from
  there. Not restarting it (like U11's switch) would require passing it
  separately (`POST /api/render/<id>/denoise?strength=`); the web lane
  already knows how to change it without restarting (it discards the clean one of another strength and
  filters the last pass again). Left for the lead if it is wanted
  to adjust while looking at the converged image. *Lead's verdict*:
  accepted, it restarts.
- **0 % is not “the filter with weight 0”**: it is not run, so a render at
  0 % carries neither the filtered image nor the “-noisy” copy (it would be the same) and
  the meter does not say *Denoised*, even if the viewer switch is still
  on. *Lead's verdict*: correct as it is.

## E11 · Edge smoothing, from cheaper to costlier — **Opus** (after U11) — done

**What.** Request from the owner: choose in *Settings ▸ Render engine*
the kind of edge smoothing, ordered from least to most costly. Two
lists, each in that order, with no invented cost figures (rule 10:
the order and a help sentence, not percentages nobody measured):

**Fast viewer** (three.js): *None · MSAA 2× · MSAA 4× · MSAA 8×*
(default 4×; the maximum the device gives, and it says which).

**Full and render** (the engine), the *pixel filter* and the extra on
edges, in a single list:
1. **None**: all samples through the pixel centre (no *jitter*
   in the image plane): jagged edges, the cheapest.
2. **Standard**: 1 px box with uniform *jitter* (today's; the
   default).
3. **Soft**: 2 px tent filter by filter importance sampling
   (the sample is displaced with the inverse CDF; weight 1).
4. **Fine**: 3 px Blackman–Harris (the usual production filter),
   with an inverse CDF tabulated in `f32` (256 entries, computed by a
   reference test, no `exp` or `cos` in the loop: determinism).
5. **Fine + edges ×2**: the above and double the samples in
   edge pixels (those that in their 3×3 neighbourhood change `partId` or
   material, or whose depth jumps more than 2 % of the distance: the
   central-ray passes already give that, deterministic).
6. **Fine + edges ×4**: ditto with four times.

Engine: `RNDR` gains `pixel_filter` (0 standard) and `edge_supersample` (1)
as final fields; without them, today's behaviour, *hashes* intact. The
*jitter* uses the same camera dimensions with a different warp. The extra
edge samples are distributed by passes (in each pass an edge
pixel receives `k` consecutive samples, with their own consecutive sample indices,
so that the decision depends only on the passes and the
image is the same with any number of threads); *denoise* and the
passes receive the number of samples per pixel. The viewer meter says
the filter in use when it is not the standard one. A **global setting** (not
the project's), like the rest of *Render engine*; on desktop it lives in the launcher's
`settings.json` (P3e). `UI.md` and `ARCHITECTURE.md`.

**Depends on.** U11, E5b-1, X2 (passes).

**Acceptance.** Test: with *None* all the samples of a pixel generate
the same primary ray; with *Soft* and *Fine* the distribution of the
displacement follows the filter's CDF (χ² over 10⁶ samples); with
edges ×2 edge pixels end up with double the samples and the
others with the same, with any number of threads (equal bits); the
example with *Standard* keeps `0x223515c3`; wasm parity; sheet
`out/aa-sheet.html`: a 4× crop of the jar's edge with the six
settings and the time of each (the times go in the PR, not in the
interface); capture `docs/ui/settings-aa.png`.

**Done.**

- **Engine** (`rt_core::pixel_filter`, §5.2 quinquies of `ARCHITECTURE.md`):
  the four filters by importance sampling (the sample weighs 1 and
  stays in its pixel), *Standard* with the usual bits; 3 px Blackman–Harris
  with its inverse CDF in a 256-point `f32` table made and
  checked by a test (bisection over the window's integral in
  `f64`); **edge samples** (`EdgeMask`, `render_tile_edges`,
  `render_tile_albedo_edges`) from the central rays of the tile and of
  its one-pixel ring: part, material or depth more than 2 % away in the
  3 × 3 neighbour; an edge pixel takes `k` samples per index, the
  indices `s·k … s·k + k − 1` of its sequence, and sums their mean. `RNDR`
  gains `pixel_filter` and `edge_supersample` (64 B; without them, the earlier
  image). Used by `rt` (`--pixel-filter`, `--edge-samples`,
  `--write-e11-example`), the launcher (finals and viewer) and wasm (mask
  per tile rectangle in the loaded scene).
- **Interface**: *Settings ▸ Render engine ▸ Edge smoothing*
  with the two lists in their order (`engine.fastAa`, four-way segment;
  `engine.pixelFilter`, numbered vertical list with each option's
  sentence), application settings (on desktop, in `settings.json`
  with the others), `es`/`en` strings. **By default, *Fine*** (decision of the
  lead on seeing the sheet: it costs the same rays as *Standard* and is the
  production filter); an already saved setting is kept, and the engine,
  faced with an RSB without the field, continues with the box (*hashes* intact).
  *Fast* stays at 4× by default and draws with the multisampling requested
  up to the device's maximum, which the line states
  (`PreviewEngine.setMsaa`, `msaa()`); *Full* and the renders carry the
  filter (`setPixelFilter` of both engines; gestures, without edge
  samples). The meter says *Filter · …* when it is not the default
  (*Fine*; e.g. *Filter · Standard*) and the
  *Fast* multisampling when it is not 4×.
- **Tests**: the table against its reference; *Standard* is the position
  as is and *None* the centre (all samples of a pixel, the
  same primary ray through a pinhole; with a lens, the same point
  of the image); χ² over 10⁶ displacements in 0.1 px bins
  (*Fine* 33.0 with 29 degrees of freedom, bound 58.30; *Soft*
  9.2 with 19, bound 43.82) and the filter's variance within
  0.3 %; the edge rule; the mask equal with any tile
  split; an edge pixel at ×2 and ×4 is the mean of its `k` samples
  (image and albedo) and the others the usual sample; pinned *hash* of the
  example with *Fine + edges ×2* (`0xf3787fe7`; with E12's light selection,
  `0x3d8f85de`) in scalar, SSE2 and AVX2,
  with tiles of 32 and 23, equal through the real `rt.wasm`
  (`wasm-parity.mjs`, also in CI) and through the page's code; `rt` and
  the launcher (final and viewer) with 1, 4 and 16 threads, the same bits; the
  example with *Standard* keeps `0x223515c3` (the one at the time; with
  E12's light selection, `0x8206111f`, equal with and without E11) and all the
  pinned *hashes* continue; RSB (without the fields, the box and none; more than 16, not
  valid) in `rt-core` and in `src/io/rsb.ts`; the settings (defaults,
  validation, block, strings without cost figures); the two engines of the
  page (the view restarts with another filter and not with the same one, the
  gestures without edge samples, the renders with the filter, `status()`).
  In the browser (`tools/settings-aa-check.mjs`): the order of the two
  lists, MSAA 8× limited to the device's maximum (4× with swiftshader)
  and stated, *None* and 2× change only the preview's edges
  (mean difference 0.48 and 0.42 out of 255, 98.5 % and 99.1 % of the
  pixels equal to 4×), *Fine + edges ×2* in *Full* with its word
  in the meter, saved on reload and in Spanish. Captures
  `docs/ui/settings-aa.png` (the block, with *Fine + edges ×2* chosen) and
  `docs/ui/meter-filter.png` (the meter with *Filter · Standard*).

*The sheet* (`tools/aa-sheet.mjs` → `out/aa-sheet.html`, the example jar at
960 × 540, 64 samples, 4 threads; 100 × 75 px crop
enlarged 4×), on this loaded machine (other agents at the same time):

| Setting | Rays | Against *Standard* | CPU | Clock |
| --- | --- | --- | --- | --- |
| None | 92.79 M | 1.0000 × | 24.4 s (0.97 ×) | 83.3 s |
| Standard | 92.80 M | 1.0000 × | 25.2 s (1.00 ×) | 88.6 s |
| Soft | 92.80 M | 1.0000 × | 26.2 s (1.04 ×) | 77.3 s |
| Fine | 92.80 M | 1.0000 × | 25.3 s (1.00 ×) | 79.2 s |
| Fine + edges ×2 | 93.95 M | 1.0125 × | 26.5 s (1.05 ×) | 76.8 s |
| Fine + edges ×4 | 95.10 M | 1.0248 × | 27.5 s (1.09 ×) | 87.5 s |

The extra samples are few because edges are (in the sheet's jar,
1.2 % more rays with ×2; in the engine's example,
1.8 % of the pixels are edge); the filter costs no rays, only its
arithmetic.

*Checked to fail* by reintroducing each error: the linear tent, the
table without interpolation or without its point distribution, the depth
threshold at 20 %, the neighbourhood without the right-hand column, *None*
with *jitter*, the `k` samples with the same index, the sum not divided
(image and albedo), the on-screen position not clamped, the same number
for both axes, `RNDR` reading another filter without the field or not writing
the edge samples, `rt`, the launcher and wasm without an edge mask,
wasm not forgetting the masks when updating the scene (this one passed
at first: the test only updated to a scene without edge samples, which
does not look at the cache; it now also moves the camera with them, and it fails); on the page,
the list with another number of samples, another filter or default
multisampling, gestures with edge samples, renders without the filter (both
engines), a filter change that does not restart the view, the
launcher state without the filter, the RSB always writing the box or
not limiting the edge samples; and in the browser, the multisampling
target saved in sRGB8 (with 2× the preview came out lighter:
mean difference 21/255).

**What did not fit the plan.**

- **Edge samples are averaged into a single contribution per
  index**, instead of “*denoise* and the passes receiving the number of
  samples per pixel”: this way the film weight, the hosts' sample
  counter, the launcher's frame, the web pool
  and the variance used by *denoise* (that of the mean of `k`) do not change,
  and an edge pixel still ends up with `k` times the samples. Nothing
  in the protocol had to change.
- **The Blackman–Harris table is not at `u = i/255`** (deviation
  accepted by the lead): with points
  equally spaced in `u` the first and last cell (1/255 of the
  samples each) are spread uniformly over the outer half pixel,
  where the window is almost zero: the variance came out 1.6 % larger and the χ²
  with 0.1 px bins did not pass (it did with equal-probability bins over
  the table's points, which do not see the shape inside a cell). With
  the points at `q(i/255)` (`2s²` and its symmetric; its inverse, two square
  roots) they cluster towards the ends: variance within 0.2 % and χ² in
  uniform bins. They are still 256 `f32` values with no trigonometry.
- **The material almost never decides**: in the RSB each instance has one
  material, so where the material changes the part changes. It is compared
  anyway (the contract asks for it; a mesh with several materials will
  need it).
- **Gesture frames** use the filter but not the edge
  samples (they are gone before it would show and cost rays of their mask).
- **The photon map of the caustics** of sample `s` serves the
  `k` samples of an edge pixel (there are no maps for the indices `s·k + j`):
  their caustics do not gain samples of their own.
- **The multisampling of *Fast*** with a number other than the canvas's
  (`antialias: true`, whatever the browser picks, normally 4) draws into
  a target that three.js treats as the screen thanks to
  `isXRRenderTarget` (tone curve and sRGB in each material): an internal
  detail of three.js 0.186 that the browser check watches (if
  a version changes it, the colours come out different and the check
  fails). Swiftshader reaches 4×: 8× has not been seen drawn here.
- **The meter says the filter that was requested of the engine** with the view on
  screen (the engine does not return it in its frames); in *Fast* it says the
  multisampling three.js gives.
- **No pinned byte of the example RSB moved with the new default
  value**: the `tests/fixtures/*.rsb` fixtures are the `rt-core` scenes
  (without interface settings) and the project-to-RSB tests
  pass their view without a filter, so `projectScene` still writes
  `pixel_filter` 0 (`edge_supersample` 1) as long as nobody asks for it; the
  default filter is set by the page's two engines on every view and
  every render (`setPixelFilter`), and what changed are the expectations of
  their tests (the first view carries `pixel_filter` 3 and `status()` says
  *Fine*; before, 0 and nothing).
- **The meter names the filter when it is not the default**, not “when
  it is not the standard” as the plan said: with *Fine* by default, the plan
  would have said *Filter · Fine* almost always. Lead's decision; this way the
  usual case stays quiet and *Filter · Standard* appears when someone
  chooses it. The `status()` of both engines always says the filter of the
  full-resolution view; the meter decides.
- **The sheet's timings** are from a machine with other processes (mean
  load of about 35): the clock says as much about them as about the setting;
  that is why the sheet also gives the process's CPU time and the rays.

## E12 · Per-point light selection (flat light tree) — **Opus**, decision **Fable** — done

**Why.** L6's diagnosis on the final 96 spp thumbnails:
scattered white sparks on the paper of sets with a small *pool* light
close to its paper (STRIP_EDGE, BLACK_ON_BLACK,
WARM_COOL_CINEMA). With the *pool* off they disappear; with *glossy* off
the key or the *rim*, or with caustics, they do not. The cause is in the engine:
`Lights::new` chooses the next-event-estimation light by
flux (`flux × towards × reach`), and `reach` bounds the distance to the
radius of the sphere enclosing the scene, so every light inside
that sphere (all of them, with the background swept) has the same reach. A
*pool* at 0.5 m from its paper has (0.5/2.5)² of the key's flux and the
same irradiance where it lands: it is chosen 3.9–6.5 % of the time and, when
it comes out from the paper, it returns 15–25× the mean. Fireworks. Choosing
by global flux is what fails in every renderer when
a small light is near a surface; what fixes it is
choosing **per point**, with the importance of each light seen from the
vertex being shaded. It is the degenerate case of K4's light tree
(a flat list instead of a hierarchy): K4 will hang the hierarchy from this
same measure.

**Decision Fable.** It is done in the engine (option 1 of L6), not in the
data (moving the *pool* away changes the photo that was already signed off) nor in the
thumbnails (a clamp in `thumbView` hides the noise from us and not from the
user). L6 publishes its thumbnails as they come out; on merging E12 the sets
with sparks are re-rendered.

**What.** Per-point importance over the flat list of lights, with the
bounds of Conty Estevez and Kulla, “Importance Sampling of Many Lights with
Adaptive Tree Splitting” (HPG 2018), §4.3, without hierarchy:
- For each vertex `x` of the next-event estimation, each entry's weight
  is a cheap upper bound on its unoccluded contribution:
  sphere/point, `lum(intensity) × mask(x) / max(d², r²)`; panel,
  `lum(radiance) × area × orientation / max(d², area)`, with the reference's
  orientation bound (angles `θ_o`, `θ_e`, `θ_u`), so that
  **no light that can illuminate `x` has probability zero** (a
  panel seen edge-on from its centre does not look at `x` but does from its
  edge, and counts); sun, `π E`; environment, `4π² L̄`; mesh emitter, its
  flux over `max(d², area)` from its centroid. The weights are computed
  in a stack buffer (up to 64 entries; above that, today's static CDF
  by flux, the same rule everywhere: deterministic).
- **MIS consistency**: the same probability function, evaluated at the
  vertex the BSDF ray left from, in `crossed`, `crossed_from`,
  `crossed_without_photons`, `escaped`, `escaped_environment` and
  `emitter_weight` (the point of origin wins; `crossed_from` with `offset`
  uses the vertex where the ray was sampled, not the thin wall). The
  per-light `pmf` fields become the base weight; nothing is left with the
  global probability in one place and the local one in another.
- Photon emission for the caustics keeps choosing by flux (there is
  no point).
- Cost ≤ 3 % on the reference scenes (`engine:bench`); `f32`, no
  `sin`/`exp` in the loop, same pixels with any number of threads.

**Depends on.** E5b-1 (caustics), E3.

**Acceptance.** (1) Unbiasedness test: the white-furnace scene and
a scene with a panel and a spot, with three strategies (NEE only, BSDF only,
MIS) converge to the same mean with an error < 1 % at 4096 samples per
pixel over an 8×8 crop. (2) Regression test of the diagnosis:
a 20 mm spot at 300 mm from a white paper plus a 1 m panel at
2.5 m; at 64 spp, the per-pixel variance (`Film::lum2`) in the paper
patch under the spot falls to ≤ 1/4 of that of flux selection, and in the
area the panel lights it rises no more than 10 %; the test fails if
flux selection comes back (mutation check noted in the
PR). (3) A panel that from its centre does not look at the point but does from its
edge has probability > 0 (test). (4) With a single light, the *hashes*
do not change; with several they do: list of *hashes* moved in the ROADMAP
paragraph, re-pinned; wasm parity. (5) Sheet `out/light-select-sheet.html`:
STRIP_EDGE, BLACK_ON_BLACK and WARM_COOL_CINEMA at 96 spp before and after
(the diagnosis `.rsb` files are in L6's *scratchpad*), plus the
example and the white furnace; by eye, no sparks and the same photo.
`ARCHITECTURE.md` (engine: light selection) and CHANGELOG.

**Done.**

- **Per-point selection** (`rt_core::light`, with the citation of Conty Estevez
  and Kulla, HPG 2018, §4.3, in the module comment; nothing from another
  renderer). Weights at `x`, all in irradiance units (W/m²,
  distances in metres; see *What did not fit the plan*): point and spot
  `lum(I) · mask(x) / max(d², r²)`; rectangle and disc
  `lum(L) · A · cos θ' / max(d², A)` with the reference's orientation bound
  (`θo` = 0, `θe` = π/2, `θu` of the radius of the sphere enclosing the
  panel seen from `x`); emitting mesh, the same from its
  centroid with the cone of normals of its faces as `θo` (two-sided
  or closed, `cos θ'` = 1 and it counts once); sun `lum(E)`; environment `π L̄`.
  The bound is written with dot products and roots (`cos(a ± b)`):
  `f32`, no `sin`/`exp`/`powf` in the loop. `Lights::select(x)` sums the
  weights and returns a `Selection` (the vertex, the sum, the first eight
  weights and whether it is by flux); `sample_selected` rebuilds the
  cumulative distribution entry by entry, with the same operations as `build_cdf`
  and `pick`, up to the light it takes. From two to `MAX_LOCAL_LIGHTS` = 64
  entries; above that, the earlier static CDF by flux everywhere
  (`Lights::select_by_flux`); with a single one, also by flux: the
  choice is certain anyway and costs nothing (a test renders it in both
  modes, bit for bit).
- **MIS consistency**: a single function, `Lights::pmf(entry,
  selection)`, gives the probability of the next-event estimation and that
  of the MIS weights. The BSDF ray carries `Scattered { pdf, from }`, which
  lends the `Selection` of the vertex where it was sampled; `crossed`,
  `crossed_from`, `crossed_without_photons`, `escaped`,
  `escaped_environment` and `emitter_weight` receive it instead of the loose
  density. Through thin walls and cut-outs (`offset`), `from`
  remains that vertex: straight events do not change it. The per-light
  `pmf` fields become `base` (the weight without distance or orientation)
  and `entry`.
- **Caustics**: photon emission still goes by flux (its own CDF,
  untouched). **Shadow catcher**: still by flux, its light sample and the MIS
  of its BSDF ray (decision Fable after seeing the data, below): its pixels
  are bit for bit those of d1f356f.
- **Checks**: flux selection through the new code
  renders STRIP_EDGE bit for bit the same as the d1f356f binary; the
  same scene with 1 and 4 threads gives the same PNG; with a single light the
  per-point film is the flux film, bit for bit.
- **Tests** (each with its mutation, which makes it fail):
  - `light_selection_is_unbiased_with_either_technique_and_with_both`
    (criterion 1; the strategies are a `cfg(test)` control, `Techniques`):
    white furnace MIS 1.00006, NEE only 1.00006, BSDF only 1 (exact);
    floor with panel, spot and dim world MIS 1.49876, NEE only 1.49861,
    BSDF only 1.49950 (4096 spp, 8 × 8). Mutation: in `crossed_areas`,
    `self.pmf(light.entry, &self.select_by_flux(s.from.point))` (the BSDF side
    with the global probability) → MIS 1.719 against 1.499,
    fails; the same in `escaped_environment` → MIS 1.476, fails. Both
    also make `next_event_estimation_and_bsdf_rays_agree_on_every_probability`
    fail (each light, in `light::tests`: a BSDF ray of the density of the light
    sample receives exactly ½ of the power heuristic).
  - `a_small_spot_close_to_its_paper_is_chosen_where_it_lands` (criterion 2:
    20 mm spot at 300 mm from the paper, 1 m panel at 2.5 m, 64 spp):
    per-pixel variance (`Film::lum2`) under the spot 0.0015 per point against
    1.653 by flux (1/1100; ≤ 1/4 was asked); where only the
    panel lights, 0.00024 against 0.0043 (it does not rise: it falls). Mutation: in
    `select`, `if true || !self.per_point || n == 0` (by flux
    everywhere) → the two variances equal, fails; so does
    `a_light_close_to_the_point_is_chosen_there`.
  - `a_panel_seen_edge_on_keeps_a_chance` (criterion 3: a panel in whose
    plane, past its edge, is `x`; and 1 mm above) and
    `the_orientation_bound_holds_for_every_point_of_the_panel` (400
    random panels and points: the bound never drops below the cosine from any
    point of the panel). Mutation: `let sin_u = 0.0 * bound * inv_d;` (without
    `θu`, the centre's cosine) → both fail (probability 0 in the
    plane; bound 0.944 < 0.962).
  - `one_light_renders_the_same_pixels_chosen_per_point_or_by_flux`
    (criterion 4: panel, sampled emitter, spot, sun and the furnace, the
    per-point film bit for bit equal to the flux one). Mutation: the spot's weight
    by its inner cone, `let mask = if self.mask(x) >= 1.0 { 1.0 }
    else { 0.0 };` → fails. (The unbiasedness test does not see it: with *glossy*
    lights, what next-event estimation leaves out is found by
    the BSDF ray with weight 1; hence this test.)
  - `the_orientation_bound_holds_for_every_face_of_a_one_sided_emitter`
    (one-sided cap and points around it). Mutation: the mesh weight
    with `(1.0, 0.0)` instead of its cone of normals → fails.
  - `beyond_sixty_four_lights_every_point_chooses_by_flux` (64 entries per
    point, 65 by flux, in the sample and in the MIS). Mutation:
    `(2..MAX_LOCAL_LIGHTS).contains(&entries.len())` → fails.
  - `the_shadow_catcher_keeps_choosing_its_light_by_flux` (its coverage,
    bit for bit, with two lights, per point or by flux). Mutation: `let
    selection = lights.select(x);` in the shadow catcher → fails.
  - `through_thin_walls_mis_takes_the_probabilities_of_the_vertex_the_ray_left`
    (a transparent thin wall at 140 mm below a 200 mm light sphere:
    its probability is 0.166 on the floor and 0.429 on the wall; MIS
    0.7238, BSDF only 0.7197). Mutation: in the straight-events branch,
    `sampled_at = selection;` (the origin becomes the wall) → MIS 0.6853,
    fails.
  - No test sees it, as it should be: evaluating the probability at the
    ray's displaced origin (`lights.select(next_origin)`) instead of the
    shading point (a difference of 10⁻⁴ mm).
  - The mutations were run on the final code, in a copy of the
    engine: each makes its tests fail (eleven in total), which pass
    without it.
- **Cost** (≤ 3 %): measured with *valgrind* (instructions executed,
  deterministic and independent of the machine's load: the difference
  between 6 and 2 spp at 128², one thread, so the scene preparation
  cancels out), d1f356f binary against E12's, per sample: example
  88.5 M → 93.4 M (+5.6 %; rays +4.7 %), STRIP_EDGE 282.0 M →
  299.6 M (+6.2 %; rays +3.3 %), BLACK_ON_BLACK 215.4 M → 227.8 M
  (+5.8 %; +1.0 %), WARM_COOL_CINEMA 245.8 M → 262.0 M (+6.6 %; +3.2 %),
  white furnace 60.0 M → 61.4 M (+2.3 %, one entry, by flux). The
  CPU time (one thread, 16 spp, the minimum of three on a machine with
  load ~40 on 4 cores: ±7 %, the furnace gives +7 % with the same work)
  says the same: +5.6 %, +5.5 %, +2.6 %, +6.0 %. At equal samples the
  noise drops (16 spp, two seeds, RMS in sRGB): variance ×0.57
  (STRIP_EDGE), ×0.25 (BLACK_ON_BLACK), ×0.69 (WARM_COOL_CINEMA), ×0.40
  (example); at equal noise, the time ×0.61, ×0.27, ×0.74 and ×0.42.
  See *What did not fit the plan*.
- **Sheet** `out/light-select-sheet.html`: STRIP_EDGE, BLACK_ON_BLACK and
  WARM_COOL_CINEMA at 96 spp before (d1f356f binary) and after, with
  *denoise* and the unfiltered image below, the time of each one;
  STRIP_EDGE with a third column, the flux reference at 1024 spp;
  the example and the white furnace. Probability of choosing the *pool* on the
  paper under it (measured, 10⁵ choices): STRIP_EDGE 0.08 % by flux →
  22.7 % per point (the environment, from 76 % to 22 %); BLACK_ON_BLACK 0.27 %
  → 48.3 %; WARM_COOL_CINEMA 0.08 % → 21.0 %.
- ***Hashes* moved** (re-pinned once, with the irradiance
  units; the same in scalar, SSE2 and AVX2, in scalar WASI and
  `simd128` and in the real `rt.wasm`):
  - `PINNED_CENTRE` (`a_tile_of_the_example_has_a_pinned_hash_on_every_platform`):
    `0x7a5ae28b` → `0x8023c8cf`;
  - `PINNED_SMALL_SPHERE` (the same test): `0xb43bda52` → `0x8b220e08`;
  - `PINNED_EXAMPLE_4SPP` (`the_whole_example_at_four_samples_has_a_pinned_hash`,
    `asking_for_passes_changes_no_pixel_of_the_image`, the check of
    the unfiltered image in `the_denoised_example_has_a_pinned_hash`):
    `0x223515c3` → `0x8206111f`;
  - `PINNED_E5_HDRI_4SPP` (`the_e5_example_has_pinned_hashes_on_every_platform`):
    `0xbf8abd5b` → `0x065d16e0`;
  - `PINNED_E5_SKY_4SPP` (the same test): `0x2fcb098a` → `0x1c24c35c`;
  - `PINNED_E5C_SKY_4SPP` (`the_e5c_physical_sky_has_a_pinned_hash_on_every_platform`):
    `0x8bb09f6b` → `0x9f4af472`;
  - `PINNED_E5B_CAUSTICS_4SPP` (`the_e5b_caustics_have_a_pinned_hash_on_every_platform`
    and, in `rt-app`, `caustics_give_the_pinned_image_with_any_thread_count`):
    `0x55d60f2f` → `0x5419866e`;
  - `PINNED_DENOISED_EXAMPLE_4SPP` (`rt-post`,
    `the_denoised_example_has_a_pinned_hash`): `0xab15f290` → `0x9ef7c8a0`.

  The twelve X2 passes do not move (`PINNED_PASS_*`,
  `PINNED_E5_PASS_*`): they do not depend on the light. The criteria of
  pending phases that cite `0x223515c3`, `0x55d60f2f` or `0xab15f290` (E9, E10,
  O1…) were written before E12: they are read with the new values.

**What did not fit the plan.**

- **The units of the weights.** The brief mixed flux and irradiance:
  point, spot and panel in irradiance, and sun `π E`, environment `4π² L̄` and mesh
  with its flux `π L A` per face, which against the irradiance they give weigh
  π, 4π and π–2π times too much. With the brief's weights the STRIP_EDGE
  *pool* was chosen 6.4 % of the time on its paper and the dome
  took 78 % of the light samples; in irradiance units, it is
  22.7 % and 22 %. Decision Fable: irradiance units (sun `E`,
  environment `π L̄`, mesh `L · A · cos θ' / max(d², A)` from its centroid,
  one face). RMSE against the 1024 spp reference (STRIP_EDGE, with
  *denoise*): before 0.0200, the brief's weights 0.0114, irradiance
  units 0.0113 (both at the reference's noise floor): the
  RMSE does not decide between them; the physics and those probabilities do.
- **The shadow catcher.** Its shadow is the quotient of the light that arrives and
  the light that would arrive in **one** sample, so its value converges to something
  that depends on how the light is chosen, not only on the scene. In the scene of
  `the_shadow_catcher_keeps_the_shadow_and_writes_alpha`, the shadow
  coverage at (−170, 0) at 1024 spp: by flux 0.356; per point with the
  brief's weights 0.207 (the test, which asks for > 0.3, failed); per point in
  irradiance 0.429; the truth, on a visible floor with direct light,
  0.286. Decision Fable: E12 leaves the shadow catcher by flux (a test pins
  it: `the_shadow_catcher_keeps_choosing_its_light_by_flux`); **a
  quotient-of-sums shadow catcher (accumulating per pixel the light that arrives
  and the open light, and dividing on resolve) is E13** and would converge to the truth
  with any choice.
- **The diagnosis numbers.** The brief gave the *pool* 3.9–6.5 %
  by flux; measured on the paper under it, 0.08 % in STRIP_EDGE: the centre
  of the scene is outside the spot's cone, so it weighed a twentieth
  of its flux (L4's rule for a spot aimed elsewhere).
- **The stack buffer.** Written as the brief asked (64 weights per vertex
  on the stack), the profile (*callgrind*) gave the `memset` of those 256 bytes
  1.9 % of all the example's instructions: the `Selection` keeps
  the sum and the first eight weights (32 bytes), and the choice redoes the cumulative
  distribution up to the light it takes, with the same operations
  (the same pixels, bit for bit); past the eighth, the weights are
  recomputed. The limit of 64 entries stays as a rule.
- **The cost per sample exceeds 3 %**: +5.6 to +6.6 % of instructions on
  the reference scenes with several lights (above). The profile
  (*callgrind*, example) splits it between extra useful work (light
  samples fall more often on a light that reaches the point: +17 %
  of shadow rays and +23 % of BSDF densities for the MIS) and the bound itself
  (per panel and vertex, three roots and two divisions) with its
  plumbing. Six versions were tried and measured (+8.7 % the first);
  the one that remains copies and fills nothing of the list's size and chooses by
  flux, at no cost, with a single entry. As the noise drops more than
  the cost rises, at equal noise it comes out between 1.4 and 3.8 times
  faster; the 3 % is not met: noted.
- **There is no `engine:bench`** in `package.json`, and `rt-bench` measures the
  BVH's performance, not the integrator's: the cost was measured with `rt` (see
  above).
- **The reference's bound also carries the receiver's cosine**
  (`|cos θ'i|`, with the point's normal); the brief does not ask for it and the
  selection API only knows the point: left for K4.
- **The tests' strategies** (`Techniques`, only in `cfg(test)`):
  *NEE only* is valid without specular paths to the light; the thin-wall
  test compares MIS with *BSDF only*.

## E13 · Manifold estimation (MNEE) for light through glass — **Opus** (after E9)

**Why.** Shadow rays stop at a refractive surface
(E5's design): a liquid inside a bottle, or anything
behind a pane of glass, only receives the lights' light by paths that
refract by chance or through E5b-1's photon map (which *Automatic*
does not switch on for a softbox). E9b saves it with the thin-wall rule
(explicit approximation, measured bias). The right thing is **manifold next
event estimation** (Hanika, Droske, Fascione, “Manifold Next
Event Estimation”, EGSR 2015): from the vertex, search by Newton
iteration for the refraction path that reaches the light point through
one or two smooth surfaces, and use it as a connection with its Jacobian.

**What.** MNEE in `rt-core` for up to two smooth refractions (thin
glass and a bottle with liquid), with the *half-vector* as the variable, 8
iterations maximum, `f32`, deterministic; MIS with the BSDF continuation;
E9b's thin-wall rule is retired when MNEE covers it (test
that the result converges to the reference's). Cost ≤ 1.3× on E5's
bottle.

**Acceptance.** E9b's milk bottle at 64 spp without grain and within
3 % of the reference; caustics of a glass of water under a small
spot with MNEE vs photon map; re-pinned *hashes*; wasm parity.

## E9 · Materials towards realism: energy, scattering media, dispersion — **Opus** — done (a, b and c)

**What.** Three parts, in this order, each with its commit and its
*hashes*; (c) only if (a) and (b) are green.

**(a) GGX energy compensation** (Kulla and Conty 2017, “Revisiting
Physically Based Shading at Imageworks”; Turquin 2019, “Practical
multiple scattering compensation for microfacet models”). Own table
`E(μ, α)` and `E_avg(α)` of the GGX directional reflectance with
Fresnel 1, integrated by ourselves (Monte Carlo with a fixed seed, 32 × 32
or whatever the error test asks for, < 0.5 % against a reference integration
with more samples; not one copied number), for conductors
(`F_avg` of the colour), dielectrics (specular and refraction, Walter) and the
clearcoat. The added lobe is `(1 − E(μo)) (1 − E(μi)) / (π (1 − E_avg))`
scaled by the mean Fresnel, sampled as a cosine and with its PDF in the
MIS. With roughness 0 the image does not change (pixel test over the
example: *hash* `0x223515c3` intact if the example has no roughness
> 0 where it counts; if it changes, the new one is pinned and the amount stated). Furnace
test: a rough white-metal sphere in a uniform environment comes out
white to ±1 % at any roughness (today it comes out grey: measure it and leave it
in the PR).

**(b) Scattering media inside solids.** Material with new fields
(stable keys, at the end of the RSB `MATL` record and of the project):
mean free path `scatter_mm` (0: none), scattering colour
(the medium's albedo per channel) and anisotropy `g` (Henyey–Greenstein).
Inside a solid with `scatter_mm > 0` the path does a random walk (distance by
`−ln(ξ)·mfp`, HG scattering event, per-channel Beer with `σ_t` per channel
chosen with one-channel-per-path *spectral MIS*, as in Pixar 2016
“Practical and Controllable Subsurface
Scattering for Production Path Tracing”, Chiang, Kulla and Fajardo:
written from the paper), next-event estimation at each
medium event through the dielectric boundary (the boundary's straight
transmittance, without refraction, as their paper does), and exit
through the boundary with the surface's Fresnel. The medium's random
dimensions are *hash* dimensions beyond the Sobol table
(like the cut-outs), so that the image of a scene without media does not
change by a single bit. Photon map: a medium is a receiver; no photons are
launched inside (note it). In the Fast viewer, an approximation:
the medium's colour as translucent diffuse (whatever three.js gives
without new dependencies); the help says so. New catalogue recipes
(added, not renamed): translucent plastic (white HDPE, natural PP),
frosted acrylic, wax, glycerin soap, milk, juice
(orange, apple), cream. Interface: in the material inspector, under
*Transmission*: *Internal scattering* (mm), *Scattering colour*,
*Direction* (−0.9 to 0.9, with the help “forward / backward”).
Contact sheet `out/sss-sheet.html` with spheres and a jar: with and
without medium, 64 and 1024 samples.

**(c) Chromatic dispersion** (solid glass only): field `abbe` (0:
none; typical 30–70), IOR per wavelength with Cauchy from
`ior` and `abbe`; one wavelength per path sampled at the first dispersive glass
(*hero wavelength* with three wavelengths, one per channel,
Wilkie et al. 2014, or a single one with *spectral MIS* if that comes out simpler), and
the rest of the path at that wavelength; materials without `abbe` do
not change. Recipe: perfume crystal with Abbe 40. Test: a prism
under a small spot separates the colours on the floor (pixel test by
regions).

**Depends on.** E5, E5b-1.

**Acceptance.** (a)'s furnace to ±1 %; (b): a sphere with a medium and albedo 1
in a uniform environment neither creates nor loses energy (±2 %); the example without
media keeps `0x223515c3` (or the new one from (a)); the caustics keep
`0x55d60f2f` unless (a) touches rough glass (say by how much);
determinism with 1, 4 and 16 threads and in wasm; `clippy -D warnings`;
times before and after in the PR (the medium costs what it costs, it is
measured); the contact sheet with Fable's visual verdict before
closing.

**Done (a) · GGX energy compensation** (commit `d736374`).

- **Own tables** (`rt_core::bsdf::energy`, data in
  `bsdf/energy_table.rs`): `E(μ, α)` of the GGX with Fresnel 1, the
  Schlick moment `E5(μ, α) = ∫(1 − wo·h)⁵ G2/G1` (so that
  `E_s = f0 E + (f90 − f0) E5` needs no other table) and the power albedo of
  the clear part `E_t(μ, α, η)` entering and leaving; integrated by our
  Monte Carlo with a fixed seed (`0xe9ae9a`): per node, the half-vector by
  VNDF (Heitz 2018) on a 64 × 64 *jittered* grid with an own PCG
  stream. Nodes at `μ = (i/31)²`, `r = j/31` (`α = r²`) and 17 indices
  uniform in `(ior − 1)/(ior + 1)` up to 3; 16 bits per value (~70 kB).
  `E_avg` is the integral of the table itself. Error against an
  integration with 16 times the samples, at points between nodes: 0.11 % the
  worst (the test's bound is 0.5 % for `μ ≥ 0.05`; with 24 × 24 nodes it was not
  met). A test regenerates a sample of nodes bit for bit
  (`REPACK_WRITE_TABLES=1` rewrites them whole in seconds).
- **Reflection** (metal, specular of the opaque dielectric and clearcoat): the
  added lobe of Kulla and Conty (2017),
  `F_ms (1 − E(μo)) (1 − E(μi)) / (π (1 − E_avg))` with
  `F_ms = F_avg² E_avg / (1 − F_avg (1 − E_avg))` and Schlick's `F_avg`
  `f0 + (f90 − f0)/21`; sampled by the cosine, with its density in the
  MIS mixture. **Refraction** (the clear part): divided by its own
  power albedo `E_t(μo, α, η)` (Turquin 2019). Below
  `α = 0.002` there is no compensation: roughness 0 keeps all its bits
  (test).
- **(a2) diffuse layer under the specular** (lead's request, rule 11, after seeing (a)):
  weight `(1 − E_s(μo)) (1 − E_s(μi)) / (1 − E_s,avg)` (Kulla and Conty), with
  `E_s` the directional albedo of the dielectric specular (its single
  scattering with Schlick plus its added lobe; Schlick's curve itself if it is
  smooth), and under the clearcoat the joint normalisation of the two layers
  (below).
- ***Furnace*** (white sphere in a uniform world of radiance 1, mean
  of its pixels), before → after, roughness 0.2 / 0.5 / 0.8 / 1.0:
  metal 0.998 / 0.895 / 0.574 / 0.356 → 1.000 / 1.001 / 0.999 / 0.999;
  clear glass (ior 1.5) 0.994 / 0.828 / 0.515 / 0.361 → 0.997 / 0.998 /
  1.004 / 0.995 (16 × 16 px × 256 spp in the test; 0.999 / 1.001 / 1.001 /
  1.000 at 32 × 32 × 1024). White plastic (base 1, ior 1.5), roughness
  0 / 0.2 / 0.5 / 0.8 / 1.0: bare 0.918 / 0.918 / 0.914 / 0.900 / 0.891
  → 1.000 / 1.000 / 1.000 / 1.000 / 1.001; with smooth clearcoat 1 0.860…0.833 →
  0.998…0.997; with clearcoat 1 of roughness 0.3, 0.860…0.833 → 0.999…0.998.
  The tests ask for ±1 %.
- ***Hashes*** that move (every rough lobe changes the sampling mix
  and the diffuse layer gains what it lost), with the mean linear luminance
  before → after, so that L6 can measure it again:

  | Image | Before E9 | After (a) + (a2) | Mean luminance |
  | --- | --- | --- | --- |
  | Example, 4 spp (`PINNED_EXAMPLE_4SPP`) | `0x223515c3` | `0x51ade97c` | +15.6 % |
  | E5, HDRI (`PINNED_E5_HDRI_4SPP`) | `0xbf8abd5b` | `0x284f75e1` | +13.6 % |
  | E5, classic sky (`PINNED_E5_SKY_4SPP`) | `0x2fcb098a` | `0x96f673b1` | — |
  | E5c, physical sky (`PINNED_E5C_SKY_4SPP`) | `0x8bb09f6b` | `0x83410b6e` | +13.2 % |
  | E5b-1, caustics (`PINNED_E5B_CAUSTICS_4SPP`) | `0x55d60f2f` | `0x8bff5f8a` | +13.6 % |
  | Example with *denoise* (`PINNED_DENOISED_EXAMPLE_4SPP`) | `0xab15f290` | `0x7483f82e` | — |
  | Example tiles (`PINNED_CENTRE`, `PINNED_SMALL_SPHERE`) | `0x7a5ae28b`, `0xb43bda52` | `0x023525f2`, `0x40ae1775` | — |

  Almost all of it is the diffuse light that was being lost (and its
  interreflections). The six X2 pass *hashes* do not move. With (a) alone, the changes were
  +0.40 % (example), +0.51 % (E5) and +0.65 % (E5c).

**What did not fit the plan in (a), and why that is fine.**

- **Sampling of rough glass.** With Turquin's factor, the old sampling
  of the clear part (reflect or refract according to the macroscopic
  Fresnel, at most 0.99) gave weights of 25 to 60 to microfacets in
  total internal reflection inside a solid: enough glints to read
  1.046 at 256 spp. Rough glass (compensated) now samples the microfacet
  first and reflects with its own Fresnel (Walter 2007, §5.3, the
  choice with a *hash* number of the 2-D sample); smooth glass keeps the
  earlier procedure and its bits.
- **(a2), two deviations from the literal recipe.** (1) Under the clearcoat,
  normalising each lobe by `1/(1 − E_c,avg)` overshot by +1.5 %: a
  specular lobe under the clearcoat does not redistribute the light, so it only
  carries `(1 − E_c(μo))(1 − E_c(μi))`, unnormalised. (2) The diffuse layer
  under the two layers needs its **joint** normalisation
  `1/∫(1 − E_s)(1 − E_c) 2μ dμ`: the product of the two normalisations
  separately came out +1.4 % bright because both transmissions fall
  together at grazing angles. It is computed per BSDF with 8-point Gauss–Legendre
  (exact for Schlick curves), only in diffuse with clearcoat. Both
  are what energy conservation asks for, and the furnace with clearcoat
  checks it to ±1 %.
- **Roughness 0 does change in plastic**, and must: `E_s(μ)` with
  `α → 0` is `F(μ)`, so the shape is as before, but the
  normalisation `1/(1 − E_s,avg)` is new: `1/(1 − F_avg)` = × 1.094 on
  diffuse with ior 1.5 (exactly the 8.6 % it was losing; smooth white
  plastic 0.918 → 1.000). The floor (Lambert, `f0 = 0`) and bases with ior 1
  keep all their bits. The phase's criterion (“with roughness 0 the
  image does not change”) holds for metal and glass, not for diffuse.
- **Anisotropic** lobes use the isotropic tables with width
  `√(αx αy)` (approximation); **thin walls** are not compensated; the
  clearcoat's added lobe does not attenuate the layers beneath (its `F_avg` is
  0.08: the term stays below 0.6 %); E5b-1's photons
  use the same BSDF sampling with Turquin's factor on the photon's side
  (not reciprocal, as the paper accepts; *casters* have
  roughness ≤ 0.25, where the factor is almost 1).
- The criteria of U11 and E10 cite `0xab15f290` and `0x223515c3`: with E9a
  they are `0x7483f82e` and `0x51ade97c` (their text is not touched).

**Mutations of (a)** (each deliberately breaks a line; in
parentheses, the tests that fail): remove the specular's added lobe
in `eval` (`rough_white_metal_reflects_everything_once_compensated`,
`rough_metal_and_glass_come_out_white_in_a_furnace`,
`rough_metal_never_gains_energy`); remove its weight from the mixture
density (`no_material_reflects_more_than_it_receives` and two others); `F_ms` →
`F_avg` (`smooth_surfaces_have_no_compensation_and_rough_ones_do`); remove
Turquin's factor (`rough_glass_never_gains_energy`, the furnace);
reflect rough glass with the macroscopic Fresnel (the glass furnace);
`MIN_COMPENSATED_ALPHA` = 0 (`smooth_surfaces_…`); look up in `μ` instead
of `√μ` (`energy_tables_are_what_the_generator_writes`,
`the_energy_tables_are_within_half_a_percent_of_a_finer_integration`);
remove the clearcoat's added lobe (the first time nobody saw it: 
`the_extra_lobes_are_kulla_and_contys_shape_times_their_fresnel` was
added);
(a2) remove the diffuse layer's normalisation
(`white_plastic_comes_out_white_in_a_furnace`), remove the added lobe
from the layer's albedo (`layers_pass_what_they_do_not_reflect`), normalise
without the clearcoat step or attenuate with `under` instead of `passes`, and the
smooth mean at 0 (the two previous ones). No test, and it is not a bias: the weight
of the added lobe in the reflectance estimate that chooses the lobe to
sample (it only changes the variance).

**Done (b) · scattering media inside solids.**

- **Fields** (stable keys, at the end): `MATL` grows to 100 B with, in this
  order, `bevel_mm` (byte 72, reserved for E6: it is read and kept, the
  interface writes 0), `scatter_mm`, `scatter_color[3]`, `scatter_g` and
  `abbe` (which is written already and E9c will render); the 56, 60 and
  72 B records are read as before. In the project, `scatterMm`, `scatterColor` and
  `scatterG` of the GLASS family; an earlier project opens with the
  same parameters it had and without a medium.
- **The medium** (`rt_core::integrator::medium`): a clear solid
  (transmission, not thin wall, not metal, not emitter, `ior ≥ 1.0001`) with
  `scatter_mm > 0`; `σt = 1/scatter_mm`, `σs = albedo σt` and
  `σa = (1 − albedo) σt` per channel, plus the absorption of `absorption_mm`
  and `base_color` (which makes `σt` differ per channel); `g` clamped to ±0.9.
- **The walk** (Chiang, Kutz and Burley, “Practical and Controllable
  Subsurface Scattering for Production Path Tracing”, SIGGRAPH 2016 Talks,
  written from the talk): distances `−ln(ξ)/σt` of a *hero* channel
  chosen once per walk, with one-sample spectral MIS over the
  three channels (Wilkie et al., EGSR 2014) carried as ratios
  renormalised at each step (a long walk does not overflow); Henyey–Greenstein
  phase by its inverse; from event 33, Russian roulette on
  the walk's own weight (survival `max(throughput)/max(throughput
  on entering)`, between 0.05 and 1: what the walk has lost since it entered;
  the lead's decision with the measurements below).
  **No NEE inside.** A walk that does not scatter crosses like clear glass
  (the surface BSDF takes it). One that did scatter, on reaching the
  boundary from inside, is reflected inward (mirror about the geometric
  normal) with the exit Fresnel probability —1 beyond the critical
  angle— or exits: the exit vertex is a surface vertex with a Lambertian
  transmission lobe of albedo `η²`
  (`Bsdf::medium_exit`; radiance inside a solid is `η²` that of
  outside, and the path that entered carries the `1/η²`), where the integrator
  samples a light with its MIS and continues by the cosine. The boundary's
  roughness does not change the lobe. **Cap**: 1024 steps per path (events and
  reflections at the boundary); beyond it, the walk goes straight to the boundary
  keeping everything except absorption and exits through the lobe without reflecting
  (otherwise total reflection would trap it in a curved solid). Media
  do not count against `RNDR.max_depth`. The exit vertex sees no cut-outs
  or the floor, and the last stretch of the walk collects no crossed lights.
- **Thin walls around a medium** (lead's decision; an
  **approximation**): a shadow ray from an exit vertex, and only
  from one, passes through a smooth glass wall (roughness ≤ 0.05, fully
  clear, with no clearcoat or medium of its own) where the light that crossed it
  by refracting would exit less than 5 mm from its entry on a face less than
  15° from the first, as if the two refractions cancelled: it carries the
  product of the entry and exit Fresnel transmittances and the
  wall's absorption over that stretch, and continues in its direction; a
  thick, rough wall or one with clearcoat still stops it. So that it does not count twice, a sample of the
  BSDF of the exit vertex that enters and leaves a wall that the shadow ray
  would cross (the same test, on the straight ray) is a straight event
  of that vertex for the MIS (it keeps its density and its distance). With
  caustics, what a photon light sends through a wall belongs to the
  map, as through any *caster*. Measured bias: a slab of
  milk under a 3 mm glass plate lit by a panel, −2.0 %
  against the tracer without the rule at 2048 spp (with photons, −1.7 %), with
  4.8 times less variance at 32 spp. In the milk jar, the pixel noise
  (deviation against its neighbours, relative) drops from 0.112 (the straight
  connection) to 0.081 at 64 spp; a milk sphere without glass gives 0.070
  (it was 0.131) and the floor 0.03. The exact solution (manifold NEE) is left
  for E13.
- **Random numbers**: *hash* dimensions beyond the Sobol table
  (`sampler::medium_dim(bounce, step)`, 8 per step, from `1 << 21`;
  `1 << 23` is left for E9c), so a scene without media does not change by a single
  bit: the eight earlier *hashes* and the pass ones stay the same.
- **Caustics**: a medium is a receiver (`caustics::is_caster`); it stores
  photons on its surface and none enter. The exit vertex collects
  the photons from the **outside** of its surface, towards where its
  lobe faces (the sheet found this: see below).
- **Fast** (`src/render/materials.ts`): a translucent diffuse, the colour
  with which the light returns by the van de Hulst similarity
  (`(1 − s)(1 − 0.139 s)/(1 + 1.17 s)`, `s = √(1 − albedo)`), and a
  transmission that decreases with how dense the medium is for the size of the
  part; the help of *Internal scattering* says Fast approximates it.
- **Recipes** (nine, new keys; 86 in total): `HDPE_WHITE` (mfp
  0.08 mm, albedo 0.996 / 0.995 / 0.99, roughness 0.35, ior 1.54),
  `PP_NATURAL` (0.6; 0.995 / 0.994 / 0.988; 0.3; 1.49), `PMMA_FROST` (4;
  0.999; g 0.3; 0.45; 1.49), `WAX` (0.35; 0.997 / 0.993 / 0.975; 0.4;
  1.44), `SOAP_GLYCERIN` (12; 0.995 / 0.99 / 0.98; g 0.4; amber with
  absorption at 60 mm; 0.12; 1.47), `MILK` (0.31; 0.9996 / 0.9993 / 0.9963;
  1.35) and `CREAM` (0.19; 0.99997 / 0.9995 / 0.9949; 0.25; 1.4) from the
  measured reduced coefficients of Jensen et al. (SIGGRAPH 2001, whole
  milk and cream), `JUICE_ORANGE` (0.9; 0.997 / 0.94 / 0.55; 1.35) and
  `JUICE_APPLE` (40; 1; g 0.5; amber with absorption at 25 mm; 1.35); the
  plastic ones under *Plastic* and the rest under *Other*; liquids do not
  wear. The others, by eye.
- **Interface**: under the glass's *Walls*, *Internal scattering* (mm),
  *Scattering colour* and *Direction* (−0.9 to 0.9, “forward /
  backward”), with their help in both languages; *store* mutation
  undoable like any parameter.
- **Tests** (all with their mutation, below): the white-medium
  *furnace* (mfp 0.1 at 60 mm, g −0.4 to 0.4, smooth and rough boundary): between
  0.998 and 1.008 (before, with the straight connection, 0.983–1.015); a medium that
  only absorbs gives Beer–Lambert in each channel (the spectral MIS) to 2 %; a
  grey half-space of isotropic scattering under a boundary of index
  1.001 gives Chandrasekhar's plane albedo for normal light
  (`1 − H(1) √(1 − a)`, his H function solved in the test): 0.4118 against
  0.4149 with albedo 0.9 and 0.7503 against 0.7527 with 0.99 (bound 2 %; it is
  the absolute reference for the roulette and for sampling with albedo between 0 and 1);
  a small emitter seen through a slab of one hundredth of an mfp
  stays sharp and keeps what clear glass lets through (0.918 against
  0.914): what does not scatter exits by refracting, not through the lobe;
  a grey medium (albedo 0.9 and 0.97) in a uniform world gives the same with the
  lobe as with the exact boundary (0.2787 against 0.2776 and 0.4501
  against 0.4496, bound 2 %: there the lobe is exact and only how much
  the boundary reflects inward matters, which the white *furnace* does not
  see); milk under a side panel: the lobe at 256 spp against the exact
  boundary (the walk exits by refracting through the real surface; 4096 spp
  different) gives 2.881 against 2.790 (+3.3 %, bound 6 %) and its worst lit
  pixel is at 0.971; the milk slab under the glass plate (the
  walls rule, above); a medium behind a glass ball
  receives by photons the same light as the tracer (−4.0 %, bound 10 %); forward scattering lets more light through a slab
  than isotropic and that more than backward (0.820 / 0.643 / 0.511); an
  emitter that is not a light is found after a walk; the phase is a density
  and its samples follow it; a medium is its mfp, its albedo and its absorption;
  media are receivers, without Beer–Lambert medium and with their own
  dimensions; the contact sheet has the nine recipes and its scenes
  are valid; on the interface side, the recipes, the parameters and their
  strings, the 100 B record, earlier projects, Fast, that
  `sss_sheet.rs` repeats exactly the catalogue's numbers and that the real
  `rt.wasm` gives the pinned *hash*.
- **Parity**: E9's scene (E5's with a warm wax medium, mfp
  4 mm and absorption in its rough glass sphere) has its *hash*
  **`0xc6c9036e`** (`PINNED_E9_MEDIA_4SPP`, `rt --write-e9-example`,
  `tests/fixtures/e9.rsb`), equal on all SIMD paths, in scalar WASI
  and `simd128`, with 1, 4 and 16 threads, in the real `rt.wasm`
  (`tools/wasm-parity.mjs`, also in CI) and by the page's code.
- **Cost** (the sheet, 240 × 180, four threads on a shared machine
  with load ~40; rays per camera sample do not depend on the load),
  medium against clear, 64 / 256 spp: spheres 22.9 against 4.0 rays
  (5.7 ×; time 169.5 / 28.0 s = 6.1 × and 578.9 / 97.3 s = 5.9 ×); milk
  jar 9.3 against 3.7 (2.5 ×; 56.2 / 21.4 s = 2.6 × and 236.1 / 69.4 s
  = 3.4 ×); juice jar 6.2 against 3.7 (1.7 ×; 39.3 / 22.1 s = 1.8 × and
  157.3 / 85.4 s = 1.8 ×); the milk one with photons, 10.1 rays (75.2 and
  270.3 s). With the straight connection they were 15 ×, 7.6 × and 5.8 × in time at
  64 spp. The lead's target for the milk jar, ≤ 6 ×: met.
- **Contact sheet** `out/sss-sheet.html` (`rt --sss-sheet out`):
  the nine recipes on spheres and E5's jar filled with milk and orange
  juice, with and without medium, and the milk one with photons, at 64 and 256
  samples, with the time and the rays per camera sample.

**Mutations of (b)**: albedo of the exit lobe `η²` → 1 (the
*furnace*: 0.47); always exit without reflecting inward, or the exit Fresnel
without total reflection (both invisible to the white *furnace*:
`an_absorbing_medium_in_a_uniform_world_is_what_the_exact_boundary_gives`, 0.460 and 0.442 against 0.278); the phase reversed (`the_phase_function_is_a_density…`,
`forward_scattering_sends_the_light_onwards`); the medium's dimensions
inside the Sobol table (`media_are_receivers_with_their_own_random_numbers`);
a medium as a *caster* (the same); Beer–Lambert in addition to the walk
(`a_medium_that_only_absorbs_is_beer_lambert_in_every_channel`); remove the
roulette's division (`a_grey_half_space_reflects_chandrasekhars_plane_albedo`: 0.676 against 0.753 with albedo 0.99); a walk that hits without exiting is lost
(the *furnace*, mfp 0.1); fixed hero channel (Beer–Lambert); distances with
`2 σt` (Beer–Lambert, the *furnace*); the lobe without `1/π` or its density on the
wrong side (the *furnace*, the milk); the surface BSDF at the
exit vertex in addition to the walk's decision (the *furnace*); a walk
without events exiting through the lobe (`a_sparse_medium_lets_what_does_not_scatter_through_straight`: 0.051 against 0.914); collecting the photons from the
inside (`a_medium_behind_glass_gathers_its_photons_where_its_walks_leave`);
without the MIS straight event, without the walls rule, or without leaving to the
map the photon light that crosses a wall
(`a_medium_sees_the_lights_through_a_thin_glass_wall`). No test, and it is not
a bias: removing the spectral MIS (a single hero channel with `f/p_hero` is
unbiased; the MIS only lowers the variance). On the interface side: the order
of the record's fields, `scatterG` unclamped, the van de
Hulst formula (the test now pins it: before it only checked the extremes), removing
Fast's clarity, the milk's wear, the *Direction* help and
a number of the sheet's recipes different from the catalogue: all fail.

**What did not fit the plan in (b).**

- **The contract's estimator** (NEE at each event through the
  boundary with its straight transmittance) was built first and the lead rejected it
  after seeing the sheet: from the camera side, a straight connection
  to a light beyond the critical angle of the local normal (47.8° with ior
  1.35; 41.8° through the glass wall) carries nothing, so almost
  all the walks at the front do not see the light and the few that reach
  the lit side bring it: on a milk pixel under a side panel, median
  0.011, mean 0.098, and the brightest 1 % of samples carried
  23 % of the mean. At 64 spp, 240 × 180 and four threads it cost 15 times
  clear on the spheres, 7.6 on the milk jar and 5.8 on the juice one.
  Measured afterwards against the exact path (the walk exits by refracting through
  the real boundary, with no lobe or connection), it was also 25 % dark on
  the milk sphere; the exit lobe ends up 3.5 % above. Its three decisions
  were discarded with it: carrying **radiance** at each
  crossing, `(1 − F(cos, η))/η²` far → near with total reflection (the
  flux version read 0.88–0.95 in the *furnace*); at a **rough**
  boundary, the weight of a BSDF sample instead of the smooth
  formula (which read 0.89), and the **roulette with `η²`** (`max(throughput)·η²`,
  so that the `1/η²` of entering did not kill half of the walks at the
  first event). The cap of 1024 stays (256 lost 3 % at 300 mfp
  wide).
- **The roulette**: the lead's plan was roulette on the *throughput*; the
  path enters the solid with `1/η²`, so the first roulette (event
  33) killed about half of the walks that arrived there. Measured
  (efficiency `1/(relative variance × rays)`, 12 × 12 px, two halves of
  128 spp): milk 2.71 on the *throughput*, 4.30 with `× η²`, 4.29 on
  the walk's own weight, 4.14 without roulette; HDPE 4.40, 5.65, 5.37 and 2.05.
  The lead chose the walk's own weight (the version with a leading
  `× η²`).
- **The citation**: the contract says “Pixar 2016, Chiang, Kulla and Fajardo”; the
  talk of that title is by Matt Jen-Yuan Chiang, Peter Kutz and Brent
  Burley (Walt Disney Animation Studios, SIGGRAPH 2016 Talks). It is cited
  that way in the code.
- **The exit lobe is the talk's production approximation**:
  it ignores where the arrival direction would refract to and gives every exit the
  same cosine distribution. With uniform light it is exact (the *furnace*);
  under a side panel, +3.5 % against the exact path.
- **A liquid inside a glass jar**: solid glass stops shadow
  rays (E5), so the exit vertex's NEE does not see the
  lights through the wall, and only continuations by
  the cosine that cross the glass find them: the milk jar is still grainy at
  64 spp with any estimator. With caustics, the photons carry it
  (and that is where the failure below appeared); *Automatic* only switches on
  caustics with lights of less than 20° seen from the *casters*, so
  with the jar's *softbox* they are not switched on. Decision for the lead.
- **The walls rule, measured on the refraction.** The lead's decision
  spoke of the shadow ray's entry and exit points and of
  the absorption over the straight stretch. Measured that way (5 mm along the
  straight ray), in the jar it stopped half of the exits' shadow rays
  (90 of 183 in an instrumented 60 × 45 render at 4 spp): a
  light more than 53° from the normal of a 3 mm wall crosses it in more than
  5 mm. Measured on the path that refracts (the real light's), a
  3 mm wall lets any angle through (the stretch inside is at most
  4.0 mm with ior 1.5); the ray then continues in its direction. With that, the
  bias on the plate stays at −2.0 % and the variance drops 4.8 times (with the
  straight measure, −2.1 % and 2.3 times).
- **“The jar at 64 spp must lose its grain”** is not fully met: the
  milk's pixel noise drops 28 % (0.112 → 0.081) and ends up at the level
  of a milk sphere without glass (0.070), but is still above the
  floor (0.03). What remains belongs to the medium itself: each sample exits at a
  different point and its NEE chooses one of three lights and the dome, and the
  backlight panel, the most powerful, is not seen from the front exits.
  That grain belongs to E12 (per-point light selection) and E13 (manifold
  NEE through glass, instead of this rule).
- **Failure found with the sheet**: with caustics, the exit vertex
  collected the photons with the normal on its side (the inside) and saw
  none: a medium inside glass lost all the light reaching it
  through the glass (the jar's milk came out 19 % darker). Now
  it collects them from the outside of its surface; new test (a block of medium
  lit only through a glass ball: photons and tracer
  agree; with the failure reintroduced, it fails).
- **The milk test and the variance**: the plan asked that a mutation
  reintroducing the connection from inside fail by variance. On a
  sphere they do not separate: with the light to one side, in front at 45° or 70° and from
  the side with a large panel, the worst lit pixel at 256 spp of the
  straight connection is at 0.98 / 0.83 / 0.87 / 0.85 of its reference and that
  of the lobe at 0.87 / — / 0.88 / 0.91; with the light behind (a lit
  edge) both fail (0.00 and 0.22). Its heavy tail was seen in the
  jar. By the lead's decision, the test compares with the exact boundary
  (the straight connection gives 2.089 against 2.790, −25 %, and fails) and keeps
  the worst pixel ≥ 0.6; the variance clause is dropped.
- **No nested media** (a liquid inside another medium), a solid with
  ior 1 has no medium (for the BSDF it is a thin wall), a `g` near
  ±0.9 converges slowly (the *furnace* tests up to ±0.4) and the medium
  *furnace* only runs in *release* (half a million paths per case; CI
  runs it natively and in WASI). Caustics do not enter a medium.
- The sheet was made at 64 and 256 samples, not at 64 and 1024 as the
  contract says (lead's decision).

**Done (c) · chromatic dispersion.**

- **Field**: `abbe`, the last of `MATL` since (b) (byte 96); in the
  project, `abbe` of the GLASS family (0 by default: none). An earlier
  project or RSB opens without dispersion.
- **The index per wavelength** (`rt_core::integrator::dispersion`):
  the two-term Cauchy law, `n(λ) = A + B/λ²`, which passes through `ior`
  at the helium d line (587.6 nm) and gives the Abbe number
  `V = (n_d − 1)/(n_F − n_C)` (F 486.1 nm and C 656.3 nm, the hydrogen
  lines): `B = (n_d − 1)/(V (1/λ_F² − 1/λ_C²))`, `A = n_d − B/λ_d²`.
  Only in a clear solid **without a medium** (a walk exits through its boundary with
  `ior`, so its surface does not disperse either) and never in a thin wall.
- **One wavelength per path**: each channel is a band (red
  580–700, green 490–580, blue 400–490 nm). At the first dispersive glass,
  the path chooses a channel with probability ⅓ and a uniform
  wavelength in its band, with an own *hash* dimension
  (`sampler::DIM_DISPERSION`, `1 << 23`, beyond those of the medium), and
  from there carries only that channel, times 3, and refracts with that wavelength
  at every dispersive glass (rough too: the whole BSDF, with its energy
  compensation, is built with that index). The caustics' photons do
  the same with their own generator at the first dispersive *caster*. A path that finds no
  dispersive glass stays white:
  a scene without `abbe` does not change by a single bit (all the pinned *hashes*
  except E9's, below, stay the same).
- **Fast** (`src/render/materials.ts`): three.js's `dispersion` with
  the glTF definition (`KHR_materials_dispersion`, 20 / Abbe number,
  up to 2), only in solid glass without a medium; the help says Fast
  approximates it.
- **Recipe**: `CRYSTAL`, *Perfume crystal* (ior 1.56, Abbe 40, smooth,
  no absorption), under *Glass*; 87 recipes.
- **Interface**: *Abbe number* (0 to 100, step 1) under the glass's *Direction*,
  with its help in both languages; *store* mutation like
  any parameter.
- **Tests**: the contract's prism (45°, 100 mm, at 300 mm from the floor,
  Abbe 25) under a 20 mm disc light with a 10° beam at 800 mm:
  with photons, on the floor blue falls farther than green and that farther than
  red (centroids 23.76 / 23.03 / 22.69 px of 40; by regions, the
  blue/red quotient of the far half of the band is 1.073 and that of the
  near one 0.880) and without `abbe` the band is white bit for bit; the same
  prism seen from above over an emitting strip separates the channel
  images (red 16.99, green 13.65, blue 8.53 px; without `abbe`, the
  three equal bit for bit); a crystal sphere (Abbe 30) smooth and rough
  (0.3) in a uniform world comes out white in each channel (0.992 / 1.005 /
  1.002 and 0.993 / 1.004 / 1.004; bound 1.5 %); the Cauchy law passes through
  `ior` at d and gives the requested Abbe; the band choice preserves the mean;
  which materials disperse; on the interface side, the recipe, the
  parameter and its strings, Fast (and that a material reused for
  another family forgets it) and the real `rt.wasm` with the new *hash*.
- **Parity**: E9's scene now carries, in addition to the medium, a
  crystal sphere of Abbe 40 (radius 40 mm, front right): **`0xc6c9036e`
  → `0xf693c26b`** (`PINNED_E9_MEDIA_4SPP`, `tests/fixtures/e9.rsb` of
  10,804 B), equal in scalar, SSE2 and AVX2, in scalar WASI and `simd128`,
  with 1, 4 and 16 threads, in the real `rt.wasm` and by the page's code.
- **Cost**: one random number per path; rays do not change (E9's
  scene at 480 × 360 and 256 spp, two threads: 479.9 M rays in 427.9 s
  with the crystal, 475.4 M in 428.4 s with Abbe 0). The price is colour
  noise: in a 191 × 109 px box around the sphere, the relative pixel
  noise (against its neighbours) goes from 0.029 to 0.037 at 256 spp
  (0.071 at 64 spp).

- **Gates** on the final tree: `cargo fmt`, `clippy -D warnings`
  (the whole *workspace* with all *targets*, and `rt-app` for Windows),
  the `rt-wasm` build, `cargo test --workspace` in *debug* (624
  tests) and in *release* (630), `rt-core` in scalar WASI and `simd128`
  (272 each), `tools/wasm-parity.mjs` with E9's scene
  (`0xf693c26b`) and the example (`0x51ade97c`), the `e9.rsb` *fixture*
  identical to what `rt` writes, and `npm run check`, `build` and `vitest`
  (1830 tests).

**Mutations of (c)**, all caught: the channel without the factor 3 (the
crystal *furnace*: 0.331 in red; the mean of the bands); choosing the band again
at each surface (the *furnace* diverges and the prism's floor inverts the colours);
refracting with `ior` instead of the band's index (the prism seen through,
the three channels at 15.6 px); not masking the *throughput*
(the same); in the photons, not masking their power,
choosing the band again or refracting with `ior` (the prism's floor); the
sign of `A` in Cauchy (its test and the two prisms); the bands reversed
(the two prisms); also dispersing a medium
(`only_clear_solids_without_a_medium_disperse`). Only with E9's *hash*:
the wavelength of the band's centre instead of a uniform one
(the centroids move 0.1 px) and the wavelength dimension
inside the Sobol table.

**What did not fit the plan in (c).**

- **One wavelength, without spectral MIS.** The contract offered the
  hero wavelength with three (Wilkie et al. 2014) or a single one with spectral
  MIS. With channels that are disjoint bands, each wavelength
  only contributes to its channel and, in smooth glass, the hero's three wavelengths
  separate at the first refraction (Wilkie leaves the
  secondary ones there), so in the case that matters there is nothing to weigh: the
  channel is chosen with probability ⅓ and carried times 3. What the
  hero with MIS would gain is in **rough** crystal, where the three wavelengths
  could continue with weights; it was not done.
- **What still has no dispersion**: shadow rays do not cross
  glass (E5) and the media's walls rule uses `ior`; a solid
  with a medium does not disperse.
- **Colour noise**: a light seen through a crystal converges
  like its caustic (each sample carries a single colour); in E9's scene,
  at 64 spp the crystal has visible colour grain and at 256 spp almost none.
- **The prism's floor**: with a 100 mm prism the band is wide and the
  colours only separate at its edges (red near, blue far, visibly);
  the channels' centroids separate by less than one pixel of 40,
  which is why the test also measures by regions.
- E9's parity scene changes *hash* in (c): a single scene was chosen
  for the medium and the dispersion instead of a new one.

**Lead's verdict** (on the sheets of (b) and (c)): E9 (a, b and c)
accepted. At 256 spp the milk and the juice read as milk and juice, the nine
recipes are distinguishable, the fringes at the edge of the crystal with Abbe 40 are
those that correspond to that glass and on the prism's floor red stays near and
blue far, as it should. One wavelength per path without spectral MIS is accepted; the
hero wavelength with MIS is noted as an option if
rough crystal ever needs it. A single parity scene for the
medium and the dispersion is right: no separate scene is made for the
crystal. The colour grain at 64 spp around the crystal and the caustic-like
convergence of light seen through the crystal are accepted as the
cost of the physics. It is accepted that shadow rays, the walls rule
and solids with a medium still have no dispersion.

**Merge with the session branch** (U12, O1, U13, P6/P6b, E12, N6, M3a, S2,
S4a). What was decided when resolving:

- **Media and E12**: a walk's exit vertex does its NEE with the
  per-point selection (`Lights::select`) and its MIS with `sampled_weight`,
  like any vertex; a thin wall's straight event keeps, besides
  the exit vertex's density, **its selection** (`Selection`), so
  that the light found behind it weighs with the probabilities with which the
  shadow ray that crossed it chose the light. The scattering wavelength does not
  touch the selection (it is a *throughput* channel).
- **Media and S4a**: particles carry no scattering medium (a drop, a
  bubble or a speck is crossed like clear glass or absorbs); the shadow ray
  of an exit vertex and the wall test see the particles as
  any shadow ray (`trace_shadow`, with each particle's tinted
  material).
- **Random dimensions and O1**: the lens's chromatic band
  (`DIM_LENS_BAND = 3 << 20`) fell inside the media block
  (`1 << 21` onwards, 256 vertices); walks now have their own block
  up to vertex 127 (`MEDIUM_BOUNCES`; those after share
  the last), which ends just where the band starts (test).
- **`MATL`**: M2a's texture block starts at byte 100, after
  E9's fields, which are now always written (no padding); the
  *fixtures* `o1.rsb` (11,644 B) and `ambient.rsb` (9,680 B) are regenerated.
- **Catalogue**: 92 recipes (77, the five of L6's sets, nine from E9b and
  E9c's crystal); keys intact.
- ***Hashes*** **re-pinned** (E9a's energy compensation and E12's
  per-point selection add up): example `0x75ba4cb4`, its tiles
  `0xe2515c9a` and `0x7b62574d`, E5 `0xfdf0c2ac` (sky `0x47fa4eb7`), E5c
  `0xf6fbc84f`, E5b-1 `0x7135df4b`, O1 `0x087d1276`, S4a `0xeb60bea2`
  (particles `0xe38b8480`, the same), E9 `0x5b5ea281`, example with *denoise*
  `0x2a430f92`; the pass ones, the same. With U11, U11b and E11 (second
  merge): E11 `0x3d8f85de` → `0xd01702ce` (its scene is the example with the
  fine filter: E9a reaches it) and the example with the viewer *denoise* (U11) at
  2 and 4 spp `0x17514303` → `0x7000ceb2` and `0x6db6039b` → `0x5318d4c5`;
  the rest do not move; the 88 light-setup thumbnails are re-rendered.
  With O3a (third merge, after v0.1.6): O3a `0x49938f3b` →
  `0x21e43bb1` and its `o3a.rsb` *fixture* of 9,436 B; the scattering-colour
  dimensions (`1 << 23`) stay above those of the lens
  filters (`4 << 20` and `5 << 20`, test); the RSB *fixtures*
  grow 12 B because of the 64 B `RNDR` (E9's, 10,816 B). E9's section
  in `ARCHITECTURE.md` becomes §5.2 sexies (E11 took the quinquies). The numbers of the tests of (a),
  (b) and (c) (*furnace*, media, prisms) do not move at four digits: their
  scenes have one light or only the environment.

## E10 · Adaptive sampling and finish by noise — **Opus** — done (the error criterion, not: **Fable** decision pending)

**What.** Distribution of samples per pixel according to the variance (`Film::lum2`),
deterministic: after each whole pass (all the tiles, all the
threads), the per-pixel error estimator (relative error of the mean,
`sqrt(var/n) / (mean + ε)`, smoothed 3×3 so that it is not noisy)
decides which pixels receive the next pass, in 8×8 blocks so
that the BVH and the cache benefit; the decision depends only on the
image data, so it is the same with any number of threads and
tiles (test). At the start, 16 samples for everyone; after that, each pass
goes to the blocks above the threshold of the moment (the 50 % quantile of the
error, descending), and a block that is no longer sampled keeps its mean (the
image remains unbiased per pixel). *Denoise* receives `n` per
pixel (it already has it in the passes) and weights the variance by it. Interface:
in *Quality*, *Finish by* gains **Noise** (threshold 0.5–5 %, default
1 %, with a time estimate that comes from the previous pass); the
viewer meter says “adaptive · n min–max”. A new `RNDR` *flag* at
the end; without it everything is as before (*hashes* intact).

**Depends on.** E5b-1, U11 (they share the launcher's loop).

**Acceptance.** Same time, less error: on E5b-1's sheet (glass jar
and key alone), the adaptive relMSE at equal time is ≤
0.6 × the uniform one (measured and in the PR); determinism 1/4/16 threads and
tiles of two sizes; with the *flag* off, `0x223515c3` intact.

**Done.**

- **Engine** (`rt_core::adaptive`, §5.2 duodecies of `ARCHITECTURE.md`):
  rounds. The first gives 16 samples to everyone with the usual tile
  renderer; at the end of each round the whole image decides the
  next: relative error of the mean per pixel,
  `sqrt((E[l²] − E[l]²) / (n − 1)) / (max(mean, 0) + ε)` from the sums and
  `Film::lum2`, `ε` 1 % of the screen white at the scene's exposure,
  smoothed 3 × 3 within the image, the largest of each 8 × 8
  block; candidates, the blocks above the target (`RNDR.noise_threshold`;
  without it, any) and below the sample cap; the round goes to the
  candidates at or above the median of their errors; with no candidates,
  converged. A round lasts 16 × `clamp(blocks / (4 × active), 1, 16)`
  samples, never more than those of the active block with the fewest. A block without a
  round keeps its mean: each pixel is the mean of its samples `0..n`
  in order. All `f32` in a fixed order. `RNDR` gains `adaptive` (bit 0) and
  `noise_threshold` (72 B, written only when requested: without them the
  section is E11's byte for byte). `render::render_block` (a rectangle
  of a tile, with its edge mask and the photon map it is
  given: in a pass sample `j` of all active blocks uses the map
  `iteration + done + j`), `Film::cut`; *denoise* receives each
  pixel's count (`DenoiseInput::with_counts`: sums and `lum2` rescaled to the
  samples of the one with the most, the variance divided by its own `n − 1`).
- **Hosts**: `rt` (`--adaptive`, `--noise P`, `--write-e10-example`,
  `--adaptive-noise`), the launcher (finals and viewer; 68-byte frame
  with `FLAG_ADAPTIVE`, the minimum and maximum of samples, the noise of the
  worst block and the seconds it waits until the target; the sums rescaled,
  so `Frame::fitted` and the page read them as usual) and the web
  pool (`src/render/adaptive.ts`, the bit-for-bit port of the decision;
  `Accumulator` by blocks, the `blocks` message and `rt_render_block_rgba` in
  the *workers*, `runAdaptive` in `render/schedule.ts`). After the first
  round the threads (or *workers*) share the active blocks of all
  the tiles one by one: the image does not depend on who did what.
  `rt_adaptive_decide` exposes the engine's decision for
  `tools/wasm-parity.mjs --adaptive` and its CI block.
- **Interface**: *Quality ▸ Finish by* gains *Noise* (0.5–5 %, 1 % by
  default, with its note and the *Samples* field as the cap); the estimate
  comes from the last pass of the *Full* viewer that samples at the same
  threshold (what it carries plus what the engine says it still needs, scaled to
  the output pixels), and without it says where it will come from; the meter
  says *Adaptive · 16–212 samples* with the engine's numbers; the live
  view, the noise against the target and what the engine expects; the queue,
  its progress by that time. `es`/`en` strings, achromatic chrome.
  Captures `docs/ui/render-window-noise.png` and `docs/ui/meter-adaptive.png`
  (`tools/noise-check.mjs`, which also checks the segment, the field, the
  note, the meter and the estimate in both languages).
- **Tests**: the per-pixel error and the decision (half a noisy image, a
  single noisy block, the cap, the target, convergence); the distribution of
  work covers exactly the active blocks with tiles of 8, 13, 32 and
  64; each pixel is bit for bit the uniform mean of its `n` samples;
  `PINNED_E10_ADAPTIVE` = `0x264b4106` (E10's scene, from 16 to 48
  samples per pixel) equal with tiles of 32, 24 (in reverse order) and 13
  (shuffled), passes of 16, 5 and 3, through `rt` with 1, 4 and 16 threads, through the
  launcher (final and viewer) with 1, 4 and 16 threads, in scalar and SIMD WASI, through
  the real scalar and SIMD `rt.wasm` (CI) and through the page's code;
  `PINNED_E10_DECISIONS` = `0xb492454a` (six decisions of a synthetic
  image) through the engine and through the port; a render by time stops between
  passes and one by noise ends clean (rt and launcher); *denoise* with
  counts weights each pixel by its own; the launcher's adaptive frames
  fit in the live view pass by pass (U14) and carry their
  numbers round trip; RSB with and without the fields (`rt-core` and
  `src/io/rsb.ts`, fixture `tests/fixtures/e10.rsb`); the page with fake
  *workers* (*Render* by noise, the adaptive viewer) and with the real
  `rt.wasm`. With the *flag* off no pinned *hash* moved:
  `0x223515c3` is today `PINNED_EXAMPLE_4SPP` = `0x75ba4cb4` (moved by E9
  and E12) and holds. Two tests were more permissive than reality and were
  fixed: the launcher's noise one failed (noise 0.2036 over a
  target of 0.2) because on converging it exited without publishing the last
  decision; the page one with fake *workers* gave `min = max` because
  the fake noise was equal over the whole image (it now varies by zones).

*The measurement* (`rt --adaptive-noise <dir> --size 480x360 --max-seconds 20
--samples 4096 --rounds 3 --threads 4`, `crates/rt-cli/src/adaptive_noise.rs`):
the two scenes of E5b-1's sheet (the *key alone* recipe on the example part
and the backlit glass jar) at 480 × 360; the reference,
two uniform renders of 4096 samples (seeds 1000 and 2000; the first one,
349 s on the key alone and 425 s on the jar), whose own relMSE (half of that of one against the other: 3.6·10⁻⁶ on the
key alone, 4.7·10⁻⁵ on the jar) is subtracted; three rounds (seeds 1–3) of
a 20 s uniform render, a 20 s adaptive one and an adaptive one up to
the same rays as the uniform one, with no noise target (the samples only
change place), 4 threads, on this 4-core machine with other agents
at the same time (mean load 8). E5b-1's relMSE (values at 8 at most,
`(x − r)² / (r² + 0.01)`), mean of the three rounds, minus that of the
reference:

| Scene | Uniform | Adaptive, same time | Adaptive, same rays | Samples (unif. · adapt.) |
| --- | --- | --- | --- | --- |
| Key alone | 1.451·10⁻⁴ | 1.220·10⁻⁴ (**0.841 ×**) | 1.069·10⁻⁴ (0.737 ×) | 143–175 · 16–272 |
| Glass jar | 1.706·10⁻³ | 1.415·10⁻³ (**0.829 ×**) | 1.125·10⁻³ (0.659 ×) | 159–175 · 16–224 |

At equal time the adaptive one traces fewer rays (5 % fewer on the key
alone, 16 % fewer on the jar: its samples go to the glass, with
longer paths that are costlier per ray, and each pass waits for its last block);
at an equal number of rays it takes 2 % and 18 % longer.

**What did not fit the plan.**

- **The criterion is not met**: 0.84 × and 0.83 × at equal time (0.74 × and
  0.66 × at an equal number of rays), not ≤ 0.6 ×. It is not the cost of the
  mechanism (with one thread, the adaptive one does 2–4 % fewer rays per
  second than the uniform one): it is the distribution. The contract's rule (the
  round to the blocks above the error median) brings all the
  blocks to the same relative error, and that mainly wins what the
  uniform one takes to clean the noisiest blocks; with the two references,
  the **optimal** distribution by 8 × 8 blocks (samples proportional to the
  deviation of each block, at an equal number of samples and equal cost per
  sample) would give 0.476 × on the key alone and 0.383 × on the jar: the
  0.6 × only fits very close to the optimum and without the glass samples
  costing more. Measured without improvement beyond the measurement noise: ordering
  by `error × √n` (what one more sample removes) instead of by error,
  rounds of per-block length, the block's mean error instead of the
  largest, `ε` of 10 %, targets of 1 and 2 %. The contract's rule stays; whether the
  criterion is changed, the rule, or this is accepted as it is, is for
  the lead to decide (**Fable**, rule 11). Numbers from another machine without load
  may be somewhat better at equal time (the per-pass barriers cost
  more with the cores busy with others); the equal-rays one does not
  depend on the load.
- **It decides by rounds, not after each pass**: a decision only at the end
  of a whole round (which lasts one or more passes), so cutting it into
  passes by time, by the live *denoise* lane or by the host's
  pass size does not change a pixel, and the round grows
  when few active blocks remain (otherwise each round of few blocks
  would be a barrier for all the threads).
- **The exact passes and the albedo come from the first round** (everyone's
  16 samples): the albedo is the mean of those, not of each pixel's
  `n`; the central-ray passes do not depend on the samples.
- **The contract does not say which `ε` or which block error**: `ε` is 1 % of the
  screen white at the scene's exposure (so that black does not
  count as noisy) and the block takes the largest of its pixels (the 3 × 3
  smoothing already removes the estimator's own noise).
- **The *Noise* estimate comes from the viewer, not from “the previous pass” of
  a render that does not exist yet**: from the last pass of the *Full* viewer
  that samples at the same threshold (the viewer only samples
  adaptively then: when it follows the output's samples, at scale 1);
  during the render, from what the engine expects. *Finish by noise* reaches
  the launcher as `finish=samples`: the cap is the samples and the
  RSB's target ends it sooner.
- `engine/README.md` is in English, like the rest of that file.

## Materials and sets with effect — decision **Fable** (after v0.1.5)

Request from the owner: import materials with their normals, UVs and
textures; create and edit materials with a conventional node system; a
realism layer in our materials; and light setups that do not all look
the same. Four different things, four phases.

**Why the setups look the same (Fable's diagnosis).** A setup
today is only the *shape* of the light (sources, position, size, tone), with
the level set by the product type, over the same dark flat background
and the same floor, and its thumbnail is always a matte ring with the
same camera and the same exposure. But a product photo is not made
by the light alone: it is made by the light **and what is reflected** (white and
black cards that draw the edges of a chrome piece or the clean strip of a
bottle), the **background** (a gradient with a pool of light behind the
product, a sweep, a luminous background), the **floor** (glossy black
with reflection, mirror, matte white) and the **tonal contrast** (warm key
and cool counter). A setup that only moves panels cannot surprise.

**Decision.** A setup becomes a **set**: lights + cards +
background + floor + exposure + environment (+ a suggested camera), with a
photographic reason written in the help. 16 designed sets are added
(new style `SETS`, first in the list) and the 16 product-type rigs are
redesigned with the same criteria; the 72 earlier setups
stay (stable keys) and move to the end of the list, with
the thumbnails of all of them re-rendered by the engine with the same
system, each set on the object it is meant for. The sets are
built with what already exists (L4 lights, U9 primitives as cards,
sweep and floor, catalogue materials, flat background or gradient image,
environment strength, exposure): nothing new in the engine.
Sources (principles, not tables): the “family of angles” and the
bright/dark field of Hunter, Biver and Fuqua, *Light: Science & Magic*; the
classic key/fill proportions; the usual practice of studio
still life.

**Order.** Now, in parallel with wave A and without touching the engine: **L6**
and **M2a**. Afterwards, in this order: **M3a** (as soon as U11 frees the
machine), **M2b** and **M3b** (engine, after E9 and E6), **M4** (after E9, E6 and
M2b). The machine has 4 cores: five agents at once is the cap, and
those that do not touch the engine do not compile Rust (they use `/home/user/bin/rt` and
the already built `rt.wasm`).

## L6 · Studio sets with photographic judgement — **Opus**, design **Fable** — done

**What.** `LightSetup` gains optional fields (the 72 old setups do not
change): `backdrop` (`FLAT` colour; `GRADIENT` two colours, top and
bottom, as a generated background image; `SWEEP` infinite background from U9 with
material and colour, which receives light and shadow), `pool` (a *spot* aimed at the
background behind the product: `az`, `el`, cone, `share`, kelvin: the pool of
light), `floor` (`CATCHER` shadow catcher; `MATTE` engine floor with
colour; `GLOSSY` and `MIRROR`: a primitive plane under the product with a
catalogue material —glossy black acrylic, white acrylic, black
mirror—), `cards` (primitive planes with new catalogue materials
*White card* 0.92 matte, *Black card* 0.02, *Silver card*
brushed aluminium; `az`, `el`, `dist`, `size`, `sizeY`, turn; by
construction outside the frame: `|az| ≥ 55°` or `el ≥ 60°`, and a test
checks it with the product type's focal length), `exposureEv` (offset
from the product type's), `envStrength`, `kelvin` per light (already
exists), suggested `camera` (`el`, `focalMm`: not applied on its own; a button
*Use the set’s camera*), `hero` (the thumbnail's object: `BOTTLE`,
`BOX`, `RING`, `CHROME`, `SHOE`, `SPHERES`) and `why` (`Label`: the
photographic reason, two sentences, in the thumbnail's help). Applying a set
creates its primitives (cards, sweep, floor) marked as *of the set*
(decoration: they do not count for part size, the Doctor or *Frame
the product*) and applying another replaces them without touching the
user's parts; *Reset to setup* removes them. One undo entry.

**The 16 sets** (starting numbers in part sizes; the agent
refines them on the contact sheet and Fable gives the verdict, rule 11):

1. `STRIP_EDGE` **Long strip and black edge** (bottle, cosmetics).
   Key: strip 0.35 × 4.5 at `az −115, el 25, dist 3`, 5300 K, 55 %;
   fill: panel 3 × 3 at `az 70, el 20, dist 3.5`, 25 %, `glossy
   false`; rim: strip 0.3 × 3 at `az 160, el 30`, 20 %. Cards: black
   2 × 5 at `az 60, el 15, dist 1.6` (draws the edge); white 2 × 4 at
   `az −60, el 10, dist 2`. Background `GRADIENT` 0.10→0.02 with `pool` at
   `az 180, el 10`, cone 25°, 15 %. Floor `GLOSSY` black. EV −0.3.
   Camera `el 8, 85 mm`. Hero `BOTTLE`. Why: a single clean strip
   runs down the bottle from top to bottom and the black edge separates it from the
   background; the floor reflection grounds it.
2. `DARK_FIELD` **Dark field** (glass, perfume). No front light: two
   strips 0.4 × 4 at `az ±135, el 15, dist 2.8`, 40 % each, just
   outside the frame; weak overhead 2 × 2 at `el 85`, 20 %, `glossy
   false`. Background `FLAT` 0.01; `envStrength 0`. Floor `GLOSSY` black.
   Black cards 3 × 4 at `az ±70, el 10, dist 1.8`. EV −0.5. Hero
   `BOTTLE`. Why: glass is seen only by its edges; on black,
   two strips behind draw them in white (Hunter et al., *dark-field*).
3. `BRIGHT_FIELD` **Bright field** (glass, transparent items). Luminous
   background: panel 6 × 6 at `az 180, el 10, dist 3`, `camera true`,
   60 %; overhead 3 × 3 at `el 80`, 20 %; fill 2 × 2 at `az 0, el 20`,
   20 %, `glossy false`. Black cards 2 × 5 at `az ±65, el 10, dist
   1.6`. Floor `GLOSSY` white (acrylic). EV +0.3. Hero `BOTTLE`. Why:
   on white the glass is drawn with black edges, which the
   cards provide, not the light.
4. `HIGH_KEY_WHITE` **Infinite white** (e-commerce). Background `SWEEP`
   white 0.9; overhead 5 × 4 at `el 75, az 0, dist 2.6`, 45 %; two
   side lights 2 × 4 at `az ±95, el 20`, 20 % each; front fill 3 ×
   3 at `az 0, el 25`, 15 %, `glossy false`. Floor `GLOSSY` white, soft
   shadow. EV +0.5. Hero `BOX`. Why: a background blown out to white and a barely visible
   contact shadow is the shop standard.
5. `JEWEL_BOX` **Light box with blacks** (jewellery). Tent of four
   panels 3 × 3 at `az ±60, ±120, el 30, dist 2.5`, 15 % each, and
   overhead 3 × 3, 20 %; hard *spot* 0.05 at `az −40, el 55, dist 3`,
   10 %, cone 12° (sparkle, caustics on); black cards 2 × 2 at `az 0,
   el 70, dist 1.5` (gold needs dark reflections to read as
   gold) and 2 × 3 at `az −30, el 5`. Background `GRADIENT` 0.06→0.015. Floor
   `GLOSSY` black. EV 0. Camera `100 mm`. Hero `RING`. Why: wrap-around light
   so that the stone shines, and blacks placed so that the
   metal has form.
6. `CHROME_FAMILY` **Family of angles** (watch, chrome). A large panel
   with a two-panel gradient: 4 × 4 at `az −35, el 45, dist 2.2`,
   50 %, and 2 × 4 superimposed at `az −25, el 50, dist 2.0`, 20 %; black
   card 4 × 4 at `az 50, el 35, dist 1.8` and silver 2 × 3 at `az 120, el
   10`; rim strip 0.3 × 3 at `az 170, el 20`, 15 %; fill 15 %
   `glossy false`. Background `GRADIENT` 0.12→0.03. Floor `GLOSSY` black.
   EV −0.2. Hero `CHROME`. Why: chrome shows only what it
   reflects; a large gradient and a clean black are put in front of it.
7. `RAKING_TEXTURE` **Raking with fill** (footwear, textile, leather).
   Key strip 4 × 0.8 at `az −85, el 10, dist 3`, 4800 K, 65 %, `spread
   60`; fill 4 × 3 at `az 55, el 30, dist 3.6`, 6200 K, 20 %, `glossy
   false`; rim 0.3 × 3 at `az 150, el 35`, 15 %. Background `SWEEP` grey
   0.25. Floor `MATTE` 0.3, shadow. EV 0. Camera `el 15, 50 mm`. Hero
   `SHOE`. Why: the weave reads with raking light, and the warm key
   against the cool fill separates volume from surface.
8. `BLACK_ON_BLACK` **Black on black** (electronics). Two strips 0.3 ×
   4 at `az ±150, el 30, dist 2.6`, 35 % each; front fill 2 × 2 at
   `az 0, el 20`, 8 %, `glossy false`; `pool` at `az 180, el 5`, cone 20°,
   22 %, 6500 K. Background `FLAT` 0.01. Floor `GLOSSY` black. `envStrength
   0.1`. EV −0.6. Hero `BOX`. Why: a black product is drawn by
   two lines of light on its edges and a faint halo behind.
9. `WARM_WINDOW` **Warm window** (food, home). Key 5 × 4 at
   `az −65, el 40, dist 2.4`, 4300 K, 70 %; fill 3 × 3 at `az 40, el
   15, dist 3.5`, 6500 K, 15 %, `glossy false`; black card 3 × 4 at
   `az 75, el 10, dist 1.8` (negative fill). Background `SWEEP` 0.35 ×
   (1, 0.9, 0.8). Floor `MATTE` 0.35. EV 0. Hero `SPHERES`. Why:
   a large side window and one side left in shadow is the tabletop light
   of all time.
10. `BACKLIT_LIQUID` **Backlit liquid** (drinks). Rim panel 2 × 3
    at `az 180, el 8, dist 2.2`, 55 %, `camera false`; two edge strips
    at `az ±130, el 20`, 15 % each; front fill 2 × 2, 10 %
    `glossy false`; white card 2 × 2 at `az 0, el 65, dist 1.4`.
    Background `GRADIENT` 0.08→0.02. Floor `GLOSSY` black. Caustics on.
    EV −0.2. Hero `BOTTLE`. Why: the liquid lights up when the
    light passes through it towards the camera.
11. `TEAL_ORANGE` **Warm-cool cinema**. Key 3 × 3 at `az −45, el 35,
    dist 2.8`, 3800 K, 55 %; rim strip 0.3 × 3 at `az 140, el 25`, colour
    (0.55, 0.8, 1), 25 %; fill 10 % 5600 K; `pool` 8000 K at `az 180,
    el 10`, 10 %. Background `GRADIENT` (0.03, 0.06, 0.08)→0.01. Floor
    `GLOSSY` black. EV −0.3. Hero `BOTTLE`. Why: two opposite
    temperatures in key and rim is the colour contrast most used
    in cinema.
12. `POP_COLOR` **Pop colour**. Background `SWEEP` colour (0.95, 0.55, 0.45);
    overhead 4 × 4 at `el 70`, 45 %; two strips 0.4 × 4 at `az ±110, el 20`,
    complementary colours (0.4, 0.7, 1) and (1, 0.85, 0.5), 20 % each;
    fill 15 % `glossy false`. Floor = background, `MATTE`. EV +0.2.
    Hero `BOX`. Why: the saturated background colour and two colour rims
    are the language of social-media shopping.
13. `GRADIENT_POOL` **Gradient backdrop with a pool** (catalogue). Key 3 ×
    2.5 at `az −40, el 40, dist 2.8`, 50 %; fill 3 × 3 at `az 60, el 20`,
    20 % `glossy false`; rim 0.3 × 3 at `az 165, el 30`, 15 %; `pool`
    at `az 180, el 15`, cone 30°, 15 %. Background `SWEEP` grey 0.45. Floor
    `GLOSSY` light grey. EV 0. Hero `SPHERES`. Why: the pool of light
    behind separates the product and gives depth to a neutral background.
14. `MIRROR_FLOOR` **Mirror floor** (perfume, cosmetics). Floor `MIRROR`
    (black mirror); overhead 3 × 3 at `el 80`, 35 %; two low strips 0.4 ×
    3 at `az ±120, el 5, dist 2.5`, 25 % each (they light the reflection);
    fill 15 % `glossy false`. Background `GRADIENT` 0.05→0.01. EV −0.3.
    Hero `BOTTLE`. Why: the full reflection under the product is the
    perfumery shot par excellence.
15. `FLAT_LAY` **Flat lay**. Suggested camera `el 85, 50 mm`; overhead
    5 × 5 at `el 60, az −30, dist 2.5`, 60 %; fill 3 × 3 at `az 150, el
    40`, 25 % `glossy false`; white card 3 × 3 at `az 180, el 20, dist
    1.6`. Background = floor `MATTE` 0.8 (paper). EV +0.2. Hero `BOX`. Why:
    light from a high side and a soft shadow towards the other is
    the magazine flat-lay shot.
16. `SILHOUETTE_GLOW` **Silhouette with a halo** (dramatic). Strong `pool` at
    `az 180, el 15`, cone 35°, 55 %, 5600 K; front fill 2 × 2 at `az
    0, el 25`, 12 %, `glossy false`; two strips 0.3 × 3 at `az ±140, el
    25`, 16 % each. Background `SWEEP` 0.2. Floor `GLOSSY` black.
    `envStrength 0`. EV −0.4. Hero `BOTTLE`. Why: the halo behind
    cuts out the silhouette and the strips finish it with two edges of light.

**Product-type rigs (the 16 in `studios.ts`).** Each becomes
a set with the same criteria: jewellery ← 5; watch and chrome ← 6;
perfume and cosmetics ← 1 (with a mirror floor if the type asks for it); glass and
drinks ← 10 (dark field if the liquid is clear); electronics ← 8;
footwear, textile and leather ← 7; food and home ← 9; *packaging* ← 13;
the generic one ← 13. The agent maps the 16 and leaves it written down.

**Thumbnails.** `tools/setup-thumbs.mjs`: builds the RSB with the
application's own code (`core/rig.ts` → `io/rsb.ts`, in Node) and
renders with `rt` (`/home/user/bin/rt` in this environment; in CI the
job's binary) at 256 × 256, 96 samples, *denoise*, fixed seed, each
set on its hero (`BOTTLE` the example jar with glass and liquid;
`BOX` a box with a band of another material; `RING` a gold torus;
`CHROME` a chrome torus; `SHOE` a leather capsule; `SPHERES` three
spheres, matte, glossy and metal); the 72 old ones are re-rendered with the
same system (hero by style). Deterministic: a capture changes only
if the set or the engine changes (a test pins the *hash* of one).

**Interface.** The *Sets* style first, large thumbnails (double those
of the current ones) with the photographic reason in the help, *Use the set’s
camera*, and the inspector's *Light* section shows the set's cards and background
as rows of their own (they can be switched off). String in `es` and `en`.

**Depends on.** L4, U9.

**Acceptance.** Sheet `out/sets-sheet.html` with the 16 sets × 3 heroes at
512 px and 256 samples, **with Fable's verdict before closing**; the
72 old setups keep their keys and their result (test: each one's
resolved rig is the same as before); no set's cards
enter the frame with the type's focal length (test); one undo
entry per set; `npm run qa` green.

**Done.** *Schema.* `LightSetup` gains, all optional, `backdrop`,
`pool`, `floor` (with `roughness`), `cards`, `exposureEv`, `envStrength`,
`camera`, `hero`, `why` and `caustics` (`data/types.ts`); `StudioPreset` gains
`set`; `LightStyle` gains `SETS`, the first of `LIGHT_STYLES`. The 16 sets
go first in `LIGHT_SETUPS` and the 72 from before behind them, with their keys. A
test compares the resolved rig of the 71 old setups (except `PRESET`)
against the 16 product types with a snapshot taken before touching
anything (`tests/fixtures/old-setup-rigs.json`: shape and relative energies, and
each type's level): they still give the same, and their exposure too.

*Applying a set* (`core/sets.ts`, which `store.ts` consults before the
lights reducer): `studio/setSetup` with a set puts its lights, its look
(`COLOR` background, `GRADIENT` —a new environment background, two colours that the
RSB carries as a stretched background image and the preview paints the same— or
the sweep; dome; exposure) and its decoration: U9's sweep fitted to
the camera (with a `SWEEP` background, or `FLAT`/`GRADIENT` with a pool), the floor
(the sweep's *floor* face in the material, or a sheet that stops short of
the pool, or a plane the size of the sweep's floor without it), the
cards (planes facing the pivot, raised without turning until they rest on the
floor) and the pool (a directional light, `setPiece: 'POOL'`). All in one
action: one undo entry. The pieces carry `SceneNode.setPiece` and
are not product (`productParts`, pivot, size), nor does the Doctor look at them
(`ownParts`), nor does *Frame* without a selection frame them. Another set
replaces them; a setup that is not a set removes them and restores the
type's look; *Reset setup* removes them (the plan's rule) and restores the
lights; *Create studio* fits them again; `studio/useSetCamera` (button
*Use the set’s camera*) puts the suggested elevation and focal length, frames
and refits sweep, floor and pool; `studio/fitSet` dresses the product that
arrives (example, import) in the same undo entry.

*The 16 sets*, with the plan's numbers except what the contact
sheet, the tests and the verdict say: keys `GLASS_DARK_FIELD` and
`WARM_COOL_CINEMA` (the plan's ones already existed); cards moved only where
the test saw them in the frame (`STRIP_EDGE` black az 60→70;
`BRIGHT_FIELD` black ±65→±70; `JEWEL_BOX` overhead el 70→80, side
az −30 el 5 → az −70 dist 1.7; `CHROME_FAMILY` black az 50 el 35 → az 75
el 20, silver az 120→90; `BACKLIT_LIQUID` white el 65 dist 1.4 → el 80
dist 1.5; `FLAT_LAY` white el 20 dist 1.6 → el 45 dist 2.8); strips
raised by the rule of their reflection (`STRIP_EDGE` rim el 30→50;
`GLASS_DARK_FIELD` ±135 el 15→55, dist 3; `CHROME_FAMILY` rim el 20→70;
`BLACK_ON_BLACK` ±150 el 30→70, dist 3; `BACKLIT_LIQUID` edges el 20→30,
dist 3; `WARM_COOL_CINEMA` rim el 25→55; `GRADIENT_POOL` rim el
30→70; `SILHOUETTE_GLOW` ±140 el 25→55); `BRIGHT_FIELD` panel 6×6 at dist 3
→ 4.5×4.5 at dist 4, shares 0.9/0.06/0.04, EV +1.2, dome 1.2;
`HIGH_KEY_WHITE` EV +1.4, dome 2 and a background wash (pool of cone 90,
share 1.5); `BLACK_ON_BLACK` sweep 0.04, pool 30 %, cone 18°;
`GRADIENT_POOL` sweep 0.30, key at dist 2.2, pool 70 % and cone 22°,
dome 0; `SILHOUETTE_GLOW` pool 45 %, cone 45°; `BACKLIT_LIQUID` sheet
with roughness 0.2. Where the plan gave no
geometry (fills, some distance) a 3 × 3 panel was put at az 30–60,
el 20, dist 3–3.5 and the strips at dist 3. `BRIGHT_FIELD` background `FLAT`
0.9; `FLAT_LAY` is a paper sweep 0.8.

*Product types* (`studios.ts`, `PRESET_SETS`): GENERIC and PACKAGING ←
`GRADIENT_POOL`; JEWELLERY ← `JEWEL_BOX`; WATCH, AUTOMOTIVE and TOOL ←
`CHROME_FAMILY`; PERFUME and COSMETICS ← `STRIP_EDGE`; ELECTRONICS ←
`BLACK_ON_BLACK`; APPLIANCE and MEDICAL ← `HIGH_KEY_WHITE`; FURNITURE_IN ←
`WARM_WINDOW`; FOOTWEAR and TEXTILE ← `RAKING_TEXTURE`; EYEWEAR ←
`BRIGHT_FIELD`; FURNITURE_OUT keeps its sun. Each takes the whole set
(verdict): its lights at the irradiance level the type had, the
exposure offset added to its `exposure`, and with its own rig the
decoration and the look; the product-type presets change (same keys), the
earlier setups do not.

*New materials* (new keys, nothing renamed): `CARD_WHITE` (0.92
matte), `CARD_BLACK` (0.02 matte), `ACRYLIC_BLACK` and `ACRYLIC_WHITE`
(acrylic with roughness 0.12) and `MIRROR_BLACK`; the silver card is
`ALU_BRUSH`, which is exactly that.

*Thumbnails* (`tools/setup-thumbs.mjs`): all 88 rendered by `rt` at
256 × 256, 96 samples, *denoise*, seed 1 (and re-encoded losslessly:
`rt` saves the PNG uncompressed, 197 kB each; the 176 come to 2.5 MB), with the scene built by
the application's code (`tests/setup-thumbs-dump.test.ts` in vitest;
heroes in `tests/set-heroes.ts`), `setup_<key>.png` at 64 × 64 by
averaging, and `manifest.json` with the *hash* of each RSB and each PNG: a
test rebuilds the 88 scenes and compares them, another pins the *hash* of one
thumbnail, and others measure on the thumbnails what the verdict asked for
(background ≥ 0.92 without burning the label; pool ≥ 2 times the edge; halo that
falls with no plateau), with the thresholds in a single place (`LOOK`,
`tests/thumb-metrics.ts`); `REPACKSHOT_SET_MEASURES=1 npx vitest run
tests/sets.test.ts -t measures` prints the 16 sets' measurements against them,
to readjust only the exposure of the set that crosses one if the engine changes. Contact sheet: `tools/sets-sheet.mjs` →
`out/sets-sheet.html` (sets × BOTTLE/BOX/CHROME and the 15 types that are
a set, before and after). Interface: *Sets* style first, set thumbnails in two
columns and square (double the height), the reason in the help, *Use the set’s
camera*, the *In the set* list with switches; *Gradient* background
in *Environment*; checked in the browser with
`tools/sets-check.mjs`.

What did not fit the plan:
- A pool on a `FLAT` or `GRADIENT` background has nowhere to land (the background
  is an image): those sets carry a sweep of the colour (`GRADIENT`: the top one).
- The pool does not land at the pivot's `az`/`el`: with the camera at 22° the sweep's
  wall, behind the rim lights, barely appears in the frame.
  It lands where the camera sees the background just above the product, and the light
  (aimed from `az`/`el` at 0.75 of the pivot) is placed near the paper with a
  150° cone: the halo falls from the centre, with no edge; the set's `cone`
  states its width.
- A matte floor on a sweep is the sweep (a paper has no two
  albedos): the grey of `RAKING_TEXTURE`'s floor (0.3 against 0.25) is not
  used.
- The starting numbers of `HIGH_KEY_WHITE`, `BRIGHT_FIELD` and
  `GRADIENT_POOL` did not reach their criteria measured with *Filmic* (which
  compresses highlights): see above for what was needed.
- *Reset setup* removes the decoration (the plan's rule); choosing the set
  again brings it back.
- An empty scene receives no pieces: the example or the imported model brings them
  (`studio/fitSet`); loading a project or replacing the scene with
  another does not remake them on its own.
- The final sheet is 512 px at 96 samples with *denoise*, not at 256 (the
  machine is shared and 256 changes nothing of the verdict); its product-type
  pairs are the 15 that are a set on BOTTLE, and Standard and
  Electronics also on BOX.
- The thumbnails of `STRIP_EDGE`, `BLACK_ON_BLACK` and `WARM_COOL_CINEMA`
  carry stray dots on the paper (*fireflies*). Their pool is a light
  near the paper with little power, and the engine chooses the light of each
  sample by its flux: the pool gets 4–6 % of the time, even though
  where it lands it lights like a whole light. With the pool off they
  disappear; neither removing the gloss from the key or the rim nor the
  caustics change anything. It goes to the engine (E12, per-point light selection) and
  those thumbnails are re-rendered when it lands; the pool is not
  moved nor do the thumbnails clamp the indirect light.
- With E9a's energy compensation (rough materials no longer
  lose light) the paper of `GRADIENT_POOL` rose more than its pool and the
  test's criterion (pool ≥ 2× the background) came to 1.96: the pool goes
  from 0.70 to 0.85 (0.75 gave 1.99, still red). As that set is also
  the PRESET studio's and PACKAGING/GENERIC's, its thumbnails and those of
  `PRESET` were redone with the 88 (`tools/setup-thumbs.mjs`); the rest
  did not change.
- *In the set* showed the gradient background row of `STRIP_EDGE` after
  *Reset setup* (its gradient is a sweep, because of the pool): the
  row now appears only for a background that the set puts behind without a sweep
  (`setBackground`, with its test). `tools/sets-check.mjs` found it.
- The preview (*Fast*) does not distinguish lights with `glossy: false`
  (it was already so before L6): `STRIP_EDGE`'s fill leaves its highlight on
  the preview's acrylic floor (`docs/ui/sets-catalogue.png`, bottom
  right) and the render does not. The sets' glossy floors make it
  more visible; it has not been touched.
- `tests/chunks.test.ts` took as the `io/import.ts` *chunk* the first
  whose name began with `import-`; `import-options-<hash>.js` also
  begins that way and which comes first depends on the *hash*: with this phase's
  the other came out and the test failed without the *bundle* changing. It now
  looks it up by its exact name.

## L7 · Sets and Lights: reorganised catalogue — **Opus** — done

**Request from the owner** (2026-10-17), verbatim (translated from the Spanish original):

> “Let's reorganise the lights and studio topic. I want us to group them by Sets / Lights. Inside sets, we'll have everything that creates things apart from lights, and in lights those that only apply lights. Inside each of these there will be filters, in which you can choose whether jewellery, dark field... Everything that used to be product type we'll put as a filter next to sets that is product type. If some lights were already applied, let me choose whether the previous lights are deleted, only hidden, or simply added to. All thumbnails will be the same size as Dark field and the rest, but I want, to the right of the section start, an icon that lets the thumbnail size be changed.”

**What.** The *Light* section in two groups, **Sets** (what creates something besides
lights) and **Lights** (what only puts lights), classified by what each
entry does and not by its style, without changing keys or order (rule 7); filters in
each group, combined like those of P6b, with the product type as a filter of
*Sets*; when choosing with lights in the scene, *Replace · Hide · Add* in one
undo entry, with *Remember my choice* in *Settings*; all the
thumbnails the size of the setups' and a button in the header that
changes the size.

**Done.** *Classification* (`core/setup-groups.ts`): an entry is a *Set* if
it brings decoration (`hasDecoration` of `core/sets.ts`: background, floor, pool or
cards), and *Lights* if not. Reading `sets.ts` and `rig.ts` gives **17 Sets and 78
Lights** with a product type that is a set, and 16 and 79 with *Outdoor furniture*:
the 16 sets of L6, plus `PRESET` (*The product type's*), which with
15 of the 16 types dresses the scene with the type's set and with *Outdoor
furniture* only puts its sun; in *Lights*, the 71 setups from before and the 7 recipes
of *Interior*. Two surprises: `PRESET` changes group according to the type in force,
and the *Interior* recipes (and `SUN`, `GOLDEN_HOUR`, `DAWN`) change the
environment (sky, exposure, intensity) without creating anything; they are counted as *Lights*
(◆ 1). `tests/light-catalogue.test.ts` pins the counts with the 16 types and
applies each of the 95 entries to check that the one that is a *Set* leaves
decoration and the one in *Lights* does not.

*Filters*: *Sets* by **Product type** (the 16; it leaves the set that is that
type's own rig, `StudioPreset.set`, and `PRESET` if it is the type in force) and by
**Subject** (the set's `hero`: *Bottle, Box, Ring, Chrome, Shoe,
Spheres*); *Lights* by **Style** (the usual nine except *Sets*, and
*Mine*). They combine (AND), with the count (*7 of 17 sets*), a short notice if
nothing is left, and the entry in force that they leave out first, dimmed and
marked *Outside the filters*, like a plugin's recipe. The rows are P6b's
component, extracted to `ui/components/filter-chips.ts` (the plugins panel
uses it too, with the same DOM). Group, filters, style and size are
saved in the settings' `layout` (per person, like the earlier style);
a previous document opens *Sets* if its style was *Sets* or *All*, and
`lightStyle: 'SETS'` (an earlier URL) is the *Sets* group.

*The lights that are there* (`core/previous-lights.ts`): `studio/setSetup` and
`studio/applySetup` gain `previous` (`REPLACE`, `HIDE`, `ADD`) and `keptNames`.
*Replace* is the usual behaviour; *Hide* and *Add* keep the lights that are not
decoration behind the new ones, with their `id`, `own` and a source name
(“Key · Rembrandt”); *Hide* with `enabled: false`. **Lights already
had that switch** (`LightInstance.enabled`, the *Lights* list's), so
the project format does not change and no migration is needed: the projects
of `tests/fixtures/project-v1.json` and `-v2.json` open with their lights
identical, and one with hidden lights round-trips the same. A set that comes in
always replaces the previous one's decoration; a *Lights* setup with
*Hide* or *Add* leaves the set's decoration, pool and look (◆ 4).
One undo entry with the answer in its name. The interface asks
(inline, above the grid; also from the palette, which shows the question)
unless `light.previous` (*Settings ▸ Preferences ▸ Lights*: *Ask ·
Replace · Hide · Add*) remembers an answer; *Remember my choice*
writes it. With no lights, or choosing the setup in force again, it does not ask.

*Thumbnails*: a single size for all, the setups' (*Dark field*:
three columns, 4:3; the sets stop going in two square columns), and the button
to the right of the *Light* header cycles *small* (four columns,
image only) → *medium* → *large* (two). Labels are no longer cut
to two lines: they wrap onto as many as needed.

*Tests*: `tests/light-catalogue.test.ts` (19: the classification and its counts,
the filters and their combination, Replace/Hide/Add with their undo and the
hidden ones that are switched on again, set over set and lights over set, an own
setup, the question and *Remember*, the setting and the `layout`, persistence, the
earlier projects) and `tests/light-panel-browser.test.ts` (4: in `en` and `es`, at
1600 × 1000 and 1280 × 800, nothing clipped or outside the column, a single
thumbnail measure per group and size, the button changes the size and it is
remembered after reload, the question). `data.test.ts`, `sets.test.ts` and
`rig.test.ts`, untouched. Browser check and captures:
`tools/light-catalogue-check.mjs`.

**What did not fit the plan:**
- No new state was needed for *Hide*: `enabled` was already there, and with it
  there is no format change or migration.
- Every project starts with the product type's lights, so with
  *Ask* (the starting setting) the question appears almost every time a
  setup is chosen; *Remember my choice* removes it (◆ 5). That is why
  `tests/library.test.ts` now answers *Replace* in two places where the
  setup used to go in directly; nothing else changes in it.
- The question appears above the grid, not next to the clicked thumbnail, and the
  section scrolls to it.
- The palette shows the question with its three answers, without *Remember*.
- The *Product type* row is 16 *chips*: at 340 px they take six lines.
- The sets' thumbnails are square and are cropped to 4:3 like the others.
- *In the set* still shows a set's pieces after *Hide* or *Add*
  of a *Lights* setup, without *Use the set’s camera* (it is no longer the set in
  force).
- `tools/sets-check.mjs`, `tools/scene-type-check.mjs` and
  `tools/viewport-stress.mjs` follow the new section (they answer *Replace*);
  `sets-catalogue.png` and `scene-type-interior.png` were re-recorded;
  `library-setups.png` has no tool and is marked as superseded.
- The thumbnails' `large` variant (L6) was removed: nobody uses it.

**◆ For Fable** (rule 11; also in *Judgement calls*):
1. That the setups that change the environment without creating anything (the 7
   *Interior* recipes, the three sun ones) be *Lights*, and that `PRESET` change group with
   the product type.
2. The product type only filters *Sets*: no *Lights* setup is
   tied to a type (except `PRESET` with *Outdoor furniture*). And the filter
   uses only `StudioPreset.set` (almost all types leave a set); a table
   of which sets serve which type is a photographic decision, not made.
3. The second *Sets* filter, *Subject* (the `hero`), which nobody asked for.
4. What happens to a set's geometry: a set that comes in replaces the earlier
   one's with any answer; *Lights* with *Hide* or *Add* leaves it,
   with its pool lit and its exposure.
5. Ask by default, also with the product type's untouched lights
   (the literal request), versus asking only if they are
   modified or there are own lights.
6. The three sizes (four, three and two columns; the small one without a label) and
   a single size for both groups.

## M2a · Textures: import, mapping, labels and preview — **Opus** — done

**What.** The engine-free part of M2 (the model already has `textures`, the
importers already keep the textures and the UVs: today they are not seen
anywhere). (1) **Import**: glTF/GLB, FBX, OBJ+MTL, USD, Collada and
3MF bring their materials with base colour, roughness, metal, normal, alpha
and emission (maps and intensities), their UVs (and a second set if there is one)
and their per-vertex normals, to material instances with their maps, and
the maps travel in the project embedded (PNG/JPEG as is; size limit
with a warning in the import sheet). (2) **Texture slots**
in the material inspector: colour, roughness, metal, normal, alpha, with
*Projection* (UV, box, planar, cylindrical, spherical), scale (mm or
part sizes), rotation, offset, repeat, and normal-map
intensity; image preview and *Load…*, *Remove*. (3)
**Labels**: an image with alpha placed by click and drag on
an area of the part (planar projection from the normal of the clicked
point, with its own size, rotation and finish: roughness, clearcoat and paper
relief), several per material, in order; *Move label* with the
gizmo. (4) **Fast preview** (three.js): all maps and
projections are visible (box, cylindrical and spherical with an own *shader*
of triplanar projection in `preview.ts`; labels with a second alpha
map). (5) **RSB contract for M2b** (written in `ARCHITECTURE.md` §5.2,
the engine reads it in M2b): section `IMGS` (images: width, height, channels,
sRGB or linear, 8 bits, mipmaps computed in the engine) and in `MATL`
final fields (after those of E6 and E9): image index and mapping per
slot, and a labels subsection. (6) `UI.md` and `SPEC.md` §3.3.

**Depends on.** U9, E5. It does not touch `engine/`.

**Acceptance.** A GLB with maps (colour, normal, roughness-metal,
emission) is imported and seen in Fast with the same maps as in a
reference glTF viewer (capture comparison, tolerance); a cube
with box projection receives the texture unstretched on all six faces
(*shader* test by capture); the project saves and opens the embedded
images in the same bytes; a label placed by click and drag
on the example jar stays where it was put (capture
`docs/ui/label-placed.png`).

**Done.** Model in `src/core/textures.ts`: six slots (colour,
roughness, metal, normal, alpha, emission) with image, own or
shared mapping, channel, invert, intensity, height map, cut-out and threshold,
tint; the mapping (UV with two sets, box, planar, cylindrical, spherical;
axis, **size in mm** —an image texture is the photo of something with its own
size, the material is shared between parts and travels in the library, the
engine works in mm; the first image sets it to the part's size—,
rotation, offset, repeat, borders) and the labels (origin, normal
and axis in part space, width, rotation, reach, roughness, clearcoat,
relief), with the `texture/*` actions (undoable, one drag one
entry, no entry if nothing changes) and the maths of the projections and
of the labels as a reference pinned by the tests (box without mirroring or
stretching on all six faces, counter-clockwise rotation with v up, cylindrical
centred in front, placement from a point and a normal through the world
matrix, also with unequal scale). Images in the registry
as their PNG or JPEG, with a content id (SHA-256) and limits (16 MB and 8192
px per image, 64 MB per project). **Import**: glTF from its JSON
(`io/gltf-materials.ts`: PBR, emission with `KHR_materials_emissive_strength`,
`alphaMode`/`alphaCutoff`, transmission, IOR and clearcoat, `KHR_texture_transform`
converted exactly to v up and checked against three's `setUvTransform`,
samplers; the loader receives the file without textures); OBJ with
its `.mtl` (`io/mtl.ts`, `io/obj-materials.ts`, with its options); FBX,
Collada, 3MF, USD and 3DM with the maps from their loaders
(`collectTextures`); the files **chosen or dropped with the model**
(images, `.mtl`, `.bin`) are given to it as companions and a
`LoadingManager` finds them by name; UVs with a second set throughout the
pipeline (welding, cuts, the project's GLB `TEXCOORD_1`), the file's normals
kept. The import sheet has its *Textures* section
(how many, how much they weigh, each one that does not and why, maps without a slot) and the
project budget is applied on pressing *Import*. **Project**: the
images in the `images` block, same bytes and same ids when opened in another
session and when saved again; missing ones remove their slots with
`MISSING_IMAGES`; earlier projects and libraries are read with
`normalizeTextures`. **Inspector**: *Textures* section
(`ui/panels/insp-textures.ts`) with the slots, the mapping and the
labels; label tool in the viewer
(`ui/panels/viewport-labels.ts`): press and drag, *Move label*.
**Fast**: `render/texture-shader.ts` (GLSL in the `MeshPhysicalMaterial`
with `onBeforeCompile`: projections, triplanar box by |n|⁴, seamless cylindrical and
spherical by Tarini's gradient, normal in Schüler's derivative frame, heights and label edge by
Mikkelsen's relief, labels over colour, roughness, metal and clearcoat) and
`render/texture-preview.ts` (per-image cache, mipmaps, device
anisotropy). **RSB contract for M2b** written in `ARCHITECTURE.md` §5.2
(`IMGS`; `MATL` texture block from byte 100, after E6's and E9's fields; UVs in `MESH`) and implemented in `io/rsb.ts` behind
`SceneView.textures`; switched off, the bytes of any scene are those
from before (test), and the pixels are decoded by `io/texture-pixels.ts`. Tests:
`textures`, `textures-import`, `textures-project`, `textures-rsb`,
`texture-shader`, `textures-ui` (62 cases, each deliberately broken:
46 mutations, all fail); `tools/textures-check.mjs` in Chromium: the four-map
GLB, a Collada with its image alongside, the box with
box projection, the label on the jar, the achromatic chrome in both
themes. Captures `docs/ui/textures-fast.png` (next to
`docs/ui/textures-reference.png`, the same file with three.js's `GLTFLoader` and
`MeshStandardMaterial`, the viewer on which almost all are built: same quadrants, straight
arrows, normal-map ridges, emission ring and clipped corner; the top face looks
somewhat softer because of the camera angle, not the filtering: with
anisotropy 8 and 16 the pixels are identical, with 1 they change),
`docs/ui/box-projection.png`, `docs/ui/label-placed.png`,
`docs/ui/textures-inspector.png`.

What did not fit the plan: (1) the comparison with a reference glTF viewer
is by eye, not by pixel tolerance (cameras and environments are not
the same). (2) *Move label* does not use the *Move* *gizmo*: it drags the
label over the surface under the cursor (a label lives on the
surface; a 3D *gizmo* would take it off it). (3) The inspector edits only
the shared mapping; a slot's own mapping comes from the files and
can be returned to the shared one (*Use the shared one*); the *store* already supports editing it
(`texture/setMapping` with `slot`). (4) The material spheres do not
show the textures (their renderer is separate). (5) Emission exists
only through its slot: a glTF with `emissiveFactor` and no texture does not emit,
as before (the `SIMPLE` family has no emission field). (6) In Fast,
an alpha cut-out and the labels do not cut the shadows of three's shadow map; it
draws six labels per material (each is a *sampler*), the engine all of them. (7) three applies its texture transform
as scale after rotation and we rotation after scale: the same with uniform
repeat or without rotation; in FBX, Collada and USD with rotation and unequal repeat
it is an approximation (glTF is converted exactly). (8) WebP or KTX2 images of
a glTF are left out with a warning; those from three loaders that
are neither PNG nor JPEG (FBX's TGA, and those of a USDZ, whose *blobs* the loader has
already released) are converted to PNG in the browser; in Node there is nothing to do so with and those
formats bring no textures (glTF and OBJ do). (9) Switching on the texture writer
is left for M2b: `rt_features` (bit 0) is proposed in `rt.wasm` and in
`/api/info`, and `decodeTexturePixels` before writing the scene; with no
FBX with a texture in the *fixtures*, the path of three's loaders is
tested in the browser with a Collada and its image (the same code).

## M2b · Textures and labels in the engine — **Opus** (after E6 and E9) — done

**What.** `rt-core` reads `IMGS` and `MATL`'s mapping: bilinear sampling
with mipmaps by ray differentials (Igehy 1999, written from the
paper; on bounces, the path's cone width), box
(blend by normal), planar, cylindrical, spherical and UV projections; normal
map (tangent space, with tangents by UV or by projection),
relief composed with E6's bevel and the terminator; alpha as cut-out
(the path already exists); labels as a layer over the substrate (alpha
softens; the layer's own finish). All deterministic in wasm and
native. It costs what it costs: measure it. With the per-point alpha opacity,
E6's technical mesh (an open plain weave, without holes) can have them.

**Acceptance.** Wasm parity and new pinned *hashes*; a sphere with a
checker texture and a box with box projection rendered by `rt`
match the Fast preview in texture position
(comparison by regions); the label from M2a's criterion renders
in place in Full.

**Done.** New module `rt_core::texture` (ARCHITECTURE §5.2 decies):
`image` (the `IMGS` image as bytes in its encoding, its *mipmaps* on
reading the scene —box in linear, fractional weights on odd sides, back to
sRGB bytes by the nearest entry of the table—, the reading of M3a's
`TEX` at any level, trilinear and the `log2` level of detail of the major
axis of the footprint), `mapping` (the five projections of `core/textures.ts`
in `f32` with their exact surface gradients, and the labels) and `shade`
(per-instance `TextureSetup`, the footprint: Igehy differentials of the pinhole
camera at the first hit and the path's cone width afterwards, at
`FOOTPRINT_SCALE` = ¼ pixel; the six slots, the normal map in the
frame of `∇u`, `∇v` like Schüler's in *Fast*, each axis of the box in its
own, the height map by centred differences of one texel, the labels in
order with their finish and the relief of their edge). **RSB**: `IMGS`, the
`MATL` block from byte 100 and the UVs of `MESH`, in `rt-core`'s reader and writer
(the TypeScript's bytes: `tests/fixtures/m2b.rsb` round trip), with
their validations; images travel with the meshes in an update; a
file without texture data is read as before. **Integrator**: the material with
textures at each camera or BSDF hit, after E6's bevel and pattern;
an image's emission is added (an emitter takes it in its radiance); the
cut-out and per-point opacity are seen by the camera and the shadow rays (an
instance with alpha can be passed through); the albedo pass with textures; an emitter
with an image is not sampled as a light (`light.rs`, one condition). Small changes in
`walk` and `shadow_from_exit` (two lines each: the material of a cut-out or
of a thin wall that a shadow ray crosses, with its textures, level 0).
**The engine's word**: `rt_core::FEATURES` (bit 0, `FEATURE_TEXTURES`),
`rt_features` in `rt.wasm`, `features` in `/api/info`; the *pool*
(`Pool.features`, from the *worker*'s `ready` message) and `NativeEngine` set
`textures: true` in the *Full* and *Render* views
(`render/engine.ts` `readsTextures`), and `main.ts` decodes the images before
writing the scene (when materials change, it redoes the viewer's when
new pixels arrive; before each render; *Export engine scene* carries
them). The inspector's note drops the *coming soon*. **Example and pinned values**:
`rt_core::example::m2b_scene` (`rt --write-m2b-example`): floor with checks by
planar projection (minified: its *mipmaps*), rotated box with checks and a normal
map by box and a label with an edge, ball with spherical checks and
roughness and metal from some bands, jar with mirrored cylindrical bands and a
wrapped label, card with cut-out holes, emission ring by the
second UV set and height map, and an emitter tinted by an image. **New** pinned values
(none moved): `PINNED_M2B_TEXTURES_4SPP` **`0x5d94b21c`**
(all ISAs, WASI, `rt-cli` and `rt-app` with 1, 4 and 16 threads, the real `rt.wasm`
in CI and by the page's code) and its six passes `PINNED_M2B_PASS_*` (albedo
`0x478bfcc8`, normal `0xc1491d6a`, depth `0x30474c2a`, ids `0xb4c6eb60`,
circle of confusion `0x6ad58dc5`), with its parity block in `engine.yml`.
**Tests** (each fails without what it tests): 18 in `rt-core` in
`texture/tests.rs` (the projections and the labels against
`tests/fixtures/texture-mapping.json`, which `tests/texture-mapping.test.ts` pins
against `core/textures.ts`: 810 projection cases and 48 label cases; the
gradients against finite differences; *mipmaps*, reads, borders and v up;
the level of detail and the camera's footprint; the normal-map frame with
UV, rotated UV, planar and box; the height map; colour, roughness, metal, alpha
and emission, and the emitter that stops being a light; the cut-out and the coverage, also
for shadow rays; the labels in order and their edge; the RSB
round trip, old files and bad blocks, the updates; an empty
block and the UVs do not change a pixel; the same figures on each SIMD path), the
pinned value and the passes, the threads in `rt-cli` and `rt-app`, `features` in
`/api/info`; in TypeScript `tests/textures-engine.test.ts` (the switch with
an engine that reads textures and one from before, the bytes of `m2b.rsb`, the real
`rt.wasm`: `rt_features`, the `ready` message of the *pool*'s own *worker*
with its `features`, the pinned value by the page's code, a project scene
with and without textures) and the **comparison by regions**
`tests/textures-full-browser.test.ts`: *Fast* in Chromium and the `rt.wasm` with
the page's writer paint the same scene at 240 × 160 (24 samples) and each pixel
is classified by its tone. Sphere with checks by its UVs and box rotated
30° with box projection: of 1722 pixels far from the cell edges in
both, **100 %** coincide; with the engine's image moved one cell, **0
%**. The jar label of M2a's criterion: intersection over union
**0.989** (364 pixels). Each test was checked by hand against its failure: 25
engine mutations (each projection, v, the borders, the *mipmaps*, the level of
detail, the footprint, the frame and the sign of the relief, the cut-out, the labels'
layer and their edge, the emission and the emitter as a light, the shadows,
the integrator's material, the albedo, the RSB reader and its updates) and 8
on the page (the switch, the *pool*, the *worker*, the writer, the projection
and label references) each turn their test red.
**Cost** (native `rt`, AVX2, shared machine,
alternating rounds; the M2b scene, with textures on everything, the floor included,
against the same without `IMGS`, blocks or UVs):

| Measure | With textures | Without textures | Difference |
| --- | --- | --- | --- |
| 1 thread, 320 × 240, 16 samples, 6 rounds (median) | 2.48 s (1.64 Mrays/s) | 2.08 s (2.00 Mrays/s) | +19 % time, +22 % per ray |
| 4 threads, 640 × 480, 64 samples, 5 rounds (median) | 13.69 s (4.76 Mrays/s) | 11.77 s (5.65 Mrays/s) | +16 % time, +19 % per ray |
| The scene without textures, earlier engine (`09d8196`) and M2b's, 1 thread, 6 rounds | 2.13 s (M2b) | 2.11 s (before) | +1 %, noise; the same PNG byte for byte |

What did not fit the plan: (1) The footprint is **a quarter of a pixel** and not one: the
tracer already integrates the pixel with its samples, and with the whole footprint the
texture would come out twice as soft as in *Fast*; with a quarter, the sharpness
is that of its trilinear and anisotropic sample (at the cost of some noise with few
samples in minified areas). (2) The camera's differentials are those of its
pinhole also with a thin lens, O1 or O2 (in the focal plane they change the same; outside,
the lens already blurs), and the bounces' cone has no curvature or
roughness term (finer than ideal; the path averages it). The
filtering is isotropic (the major axis; the quarter pixel absorbs up to 4:1). (3)
The height map and the paper edge derive by differences of one texel of the
level read, not of a screen pixel like *Fast*: up close, the edge of
a label is a finer ridge than *Fast*'s. (4) A label **removes
transmission** (the paper is opaque: on glass you do not see through); *Fast* does not
do so. On an emitter, a label covers its light but does not reflect (an emitter
has no BSDF). (5) An emitter whose image changes its light is **not sampled as a
light** (unbiased, with more noise in what it lights); the caustics' photons
see the materials without textures, like E6's patterns. (6) The normals
pass is the bevel's, without the normal map or the relief (as with
E6's patterns); the albedo one does carry the textures. (7) The reader is
strict with the texture block (an out-of-range code or an image index
that does not exist make the RSB invalid, like `LENS`); the contract said
nothing. (8) E6's technical mesh: per-point opacity exists (an image's
alpha cuts out, and the shadow rays see it), but the procedural fabric does not yet give
holes of its own: how far to open the plain weave is a recipe and a visual
criterion (rule 11), noted for the lead; with an alpha image it can already be done. (9) **Size**: still in mm, as in M2a; whether it should follow
the solid's size is the pending decision of `TRIAGE.md` 5.1 (not taken here). (10) Node
materials still use the mean of their outputs until M3b; a slot
with an image of its own on one of them is painted over, as in *Fast*. (11) The
comparison by regions needs Chromium and `rt.wasm`: it is skipped in the CI
engine job; its Node half (`textures-engine.test.ts`) goes in the
*Passes through the page's own code* step with the real `rt.wasm`. (12) Each
*worker* keeps its copy of the images and their *mipmaps* (a third more),
as with the meshes.

## M3a · Node material editor: model, editor and preview — **Opus** (after U11) — done

**What.** A **material graph** like KeyShot's or Blender's,
reduced to what our engine can evaluate: *Material output* nodes
(the material's inputs: base colour, metal, roughness,
anisotropy, clearcoat, transmission, IOR, absorption, internal scattering
(E9), emission, opacity, normal, bump, bevel), *Image texture*,
*Mapping* (M2a's projections), *Noise* (E6's Perlin/simplex, with
scale and octaves), *Gradient*, *Checks*, *Stripes*, *Colour ramp*,
*Mix*, *Maths* (add, multiply, power, minimum, maximum,
smoothstep, absolute value), *Fresnel / layer weight*, *Curvature*
(edges, from E7), *Value*, *Colour*, *Separate/Combine RGB*, *Invert*,
*Normal map*, *Bump*. Model in `src/core/material-graph.ts`
(typed DAG: sockets of type colour, float, vector, normal; documented implicit
conversions), serialised in the project (versioned schema),
undoable node by node and connection by connection through the *store*.
**Compilation to a program**: the graph is compiled to a linear program
(*bytecode*: `f32` and `vec3` registers, instructions with stable
codes, image reads) which is the contract with the engine (M3b);
`ARCHITECTURE.md` documents it instruction by instruction; size limit
and a test that a 30-node graph compiles in < 1 ms. **Editor**:
a *Material editor* window (like the render one), canvas with zoom and
pan, draggable nodes, sockets with achromatic types and colours
per type (shape, not colour), connections by dragging with type
validation, *Add node* menu with search, a small preview
on each node (CPU evaluation on a 64 × 64 sphere in a
*worker*, with the same interpreter as the preview), *Simple ↔ Nodes*
(a parameter material becomes its minimal graph; going back to
*Simple* only if the graph is the minimal one, otherwise it asks). **Fast
preview**: a TypeScript interpreter of the program evaluates the
graph into a 512² texture per projection (UV or triplanar) in a
*worker* and hands it to three.js as maps; what does not fit in maps
(Fresnel, curvature) is approximated or omitted, and this is stated. Shortcuts, tour,
`es`/`en` string.

**Depends on.** M2a, E6 (noise), U11 (machine).

**Acceptance.** Ten example graphs (`src/data/material-graphs.ts`:
plastic with label, brushed metal with noise scratches, marble,
leather, wood with two noises, glass with dirt by Fresnel, checks,
metallic paint with flakes (fine noise in the normal), ceramic with
glaze (clearcoat by ramp), stripes) compile and are seen in Fast; a saved
graph opens identical; undo and redo of 50 edits returns the
original graph (test); the TS interpreter and the contract's reference
one (a small test evaluator in Rust in M3b) give the same values
at 1000 random points (cross test when M3b arrives).

**Done.** **Model** in `src/core/material-graph.ts`: a material in
*Nodes* mode carries `graph` (version 1), a DAG of nodes from the catalogue
`src/data/material-nodes.ts` (19 types, stable keys, `es`/`en`) with
sockets of four types and the implicit conversions of the table (a normal
only comes from a normal); `graph/*` actions (add, remove, move,
duplicate, connect, disconnect, parameter, value, whole graph, Simple ↔
Nodes), undoable, one entry each, none if nothing changes or the
connection is rejected; *Simple → Nodes* gives the minimal graph (the output with
the material's values) without touching its parameters, and *Nodes → Simple* is
exact if the graph is minimal with values a family stores, otherwise it
asks and keeps those of the output; the graph in the project
(`normalizeGraph`) and in the library (without images), its images in the
`images` block. **Noise** in `src/core/noise.ts`: Perlin 2002 and simplex
(Gustavson 2005) with a corner *hash* (Teschner's primes, Knuth,
Wellons' `lowbias32`) instead of the table, and octave sum, in f32.
**Compiler** (`src/core/material-program.ts`): linear program of
f32 and vec3 registers packed by last read, instructions of six
words with stable codes, constants, image table, fifteen
outputs, bump by three evaluations of the height, limits with their
reason, shape in bytes; **reference interpreter**
(`src/core/material-interp.ts`) in f32 over `core/f32math.ts` (the same
elementary functions as `rt_core::fmath`); all written instruction by
instruction in `ARCHITECTURE.md` §5.2 quater together with the noise, the image
sampling and the cross-test points. **Editor**
(`src/ui/panels/material-editor.ts`, `graph-canvas.ts`,
`src/ui/graph-commands.ts`; `UI.md` §2.10): floating window that does not dim the
viewer, movable, resizable, with position and size remembered; canvas with
zoom and pan, draggable cards with their 64 × 64 sphere
(computed in a *worker*, `render/graph-worker.ts`), sockets with a shape per
type, connection by dragging with validation and its reason, moving an
input connection, *Add node* with search, selection by click and box,
context menus, node panel (parameters, image, ramp, inputs),
*Examples*, shortcuts, `Simple · Nodes` and *Nodes…* in the inspector, *Edit
with nodes…* in the part menu, the palette and a tour step.
**Fast** (`src/core/material-preview.ts`, `render/graph-preview.ts`,
`render/graph-client.ts`): 512² maps (formerly 128²) evaluated in bands
in several *workers*, over the UV square, the projection's surface
(exact: test) or a front cut drawn as a box, which enter through
M2a's slots as `DataTexture`; Fresnel at 60°, curvature 0 and outputs
without a slot with their mean, stated in the inspector and the editor. *Full*
receives the mean of each output (`flattenGraph`) and says so. **Ten
examples** in `src/data/material-graphs.ts`. Tests:
`material-graph`, `material-program`, `material-preview`,
`material-nodes-ui` (50 cases; 43 mutations reintroduced, all fail);
`tools/material-nodes-check.mjs` in Chromium (open, add with search,
connection rejected and made, the viewer changes, undo, keys, example,
achromatic chrome in both themes). Captures `docs/ui/material-nodes.png`
and `docs/ui/material-nodes-preview.png`.

What did not fit the plan: (1) **the label** of the plastic with label is a
*Image texture* node with an image drawn by code
(`core/material-examples.ts`) and cylindrical mapping (on the example jar it falls under its own paper *Label* part, which covers the front;
on any other part it is seen); M2a's labels
are still the material's (they are placed in the viewer) and in both modes they are
put on top of what the graph gives, like M2a's slots, which multiply
their outputs. (2) **The box** in a program takes the face the normal looks at
most (a point cannot blend three evaluations); *Fast* does blend
by |n|⁴ like M2a, and says so. (3) **The 3D in Fast** is a cut through the
front of the part drawn as a box (a 2D map cannot be a 3D noise):
the wood's ring grain looks fine on the sides of a vertical part, not on top; the three faces with three cuts are left for
when needed (more *samplers*). (4) The output's **absorption** is a
material parameter (distance, like glass), not a per-point input; the output's
**bevel** is a weight of the material's bevel radius, which is still a single one
(the Doctor looks at it). (5) **Curvature**: the reference gives 0 (the engine measures it in
M3b, from E7 or the bevel); E6's noise did not yet exist and was
written here, from public sources, as a contract for Rust. (6) What reads the material's
parameters (the Doctor, the catalogue spheres) sees in *Nodes* those of their
family or the graph's mean: the thumbnails use the mean; the Doctor, the
parameters. (7) There are **three windows** (render, Settings, material
editor): `UI.md` §4.3 and the `README` line are updated; the editor is not
modal. (8) The colours in this step are those of
`MATERIAL_GRAPHS`, by our own judgement: a **Fable** glance at the ten
examples (above all marble and wood) is pending.

**Lead's verdict** (2026-10-14, with `docs/ui/material-nodes.png` and
`material-nodes-preview.png`). The example marble is fine (fine grey
veins on white, believable scale on the jar): it stays. The wood is not
judged here: when E6 arrives with its procedural wood (grain, knots at 45°),
the wood example in `MATERIAL_GRAPHS` has to give the same look as
the catalogue's *Wood* family with the same controls, and M3b looks at that
when connecting the engine. The rest of the “What did not fit the plan” items (1–7, 9): accepted as is; the RSB's `PROG`
contract is written in M3b over the linear program of §5.2
quater, not before. The trailers of this phase's *commits* were rewritten
on merging (same authorship, the line required by the session).

## M3b · The engine evaluates graphs — **Opus** (after M2b and M3a) — done

**What.** `rt-core` executes M3a's program at each hit (an
allocation-free interpreter in the loop, registers on a fixed stack, `f32`,
deterministic; image reads through M2b; E6's noise; E7's curvature
or, if it has not arrived, an approximation from the bevel). The material
resolved at the hit feeds E9's BSDF. Cost measured in the PR.

**Acceptance.** M3a's ten graphs rendered with `rt` match
the Fast preview in position and tone (regions); M3a's TS/Rust
cross test green; wasm parity.

**Done.** New module `rt_core::program` (ARCHITECTURE §5.2 undecies): the
contract of §5.2 quater in Rust (`program.rs`: the stable codes, the instruction
shapes, the limits, the reading of `encodeProgram`'s bytes
with all its checks —each operand written before it is read, no
destination equal to an operand, indices, finite constants, ramps of 1 to 64
stops— and the writing), the interpreter (`program/interp.rs`: register
files on a fixed-size stack, 256 `f32` and 256 `vec3`, not one allocation during
execution —test—, `f32` without FMA with the `fmath` functions, each
instruction like the TypeScript reference), M3a's noise
(`program/noise.rs`: Perlin and simplex with the corner *hash* and the octave sum,
with JavaScript's `Math.round` rounding and `ToUint32` seeds), what a program does at a
hit (`program/shade.rs`) and a hand program
writer for the engine (`program/build.rs`). **The point**:
P, N, UV0, UV1, I, T, B and the UV shift by T and B, in part space
(the mesh; the instance transform carries the point, the vectors
and the normal); N is the shaded one (with the bevel), turned to the outside of the part,
and the program's normal returns to the world and to the ray's side, never facing away
from the viewer (like M2b). **The material**: the `MATL` (which the page fills with the
mean of each output, its family, its absorption and its thin walls) with each
output of the point brought to its range (what is not a number leaves the file's
value); internal scattering is not read. **Images**: M2b's read at
the level of detail of the ray's footprint; reads of an image through the
same `MAP` (or the same UV set, or steps from it) take the level of the
first, so a bump's three heights are read at one level; coordinates
computed another way, at level 0; shadow rays, at
0. **Curvature** (`EDGE`, `CAVITY`): from E6's bevel hard edges
(E7 has not arrived): `smoothstep(1 − d/r) · min(tan(θ/2), 1)` of the strongest edge
within `r` mm, convex or concave. **Bevel**: the output is a weight
of the material's radius: constant, it scales it for the whole part; computed, the
program runs twice (at the unbevelled point for the weight, and at the point
bevelled by it for the rest). **Emission**: an emitter (`MATL` of type 2) sends
`emission × intensity` of the point; another material adds it to what it reflects; an
emitter whose emission is not a program constant is not sampled as a light
(`light.rs`), and the page writes it as a non-emitter (it reflects and adds
its emission). **Cut-outs**: an opacity that is not the constant 1 makes the instance
passable; the camera, the shadow rays (also from a medium's exits and through S4b's
straight crossing) and the albedo pass read the program.
**Integrator**: bevel → program → M2b textures on top (they multiply what the
program gives, like a flat material); a material with a program does not carry
E6's pattern. **RSB**: section `PROG` (`u32 material` and the program
bytes, one per material, after all the others; the first for a material
counts; a newer version is skipped and the material keeps its `MATL`; an
invalid program, one for a material that does not exist or with an image that is not in
`IMGS` in its colour space makes the RSB invalid), in `rt-core`'s reader and
writer and in `src/io/rsb.ts`; a file without `PROG` is read and
written as before. **The engine's word**: `FEATURE_PROGRAMS` (bit 1 of
`rt_core::FEATURES`, `rt_features`, `features` of `/api/info`); the page
(`render/engine.ts` `readsPrograms`, which also asks for bit 0: a program reads
`IMGS` and the UVs) sets `programs: true` in the *Full* and
*Render* views of the *pool* and the launcher, and *Export engine scene* carries them;
`projectScene` then writes each node material as its program over
its mean (with the meshes' UVs and the programs' images); to an earlier
engine, the mean of each output (`flattenGraph`), as until now. The inspector
and editor note (`ge.full.note`) says what *Full* and
*Render* do. **Example and pinned values**: `rt_core::example::m3b_scene`
(`rt --write-m3b-example`, `tests/fixtures/m3b.rsb`): seven hand programs
over M2b's scene (noise-and-ramp marble on the floor; checks worn
by `EDGE` with a bevel of weight 0.5; leather with relief by three evaluations;
a label by `TEX` of an image with a computed bevel weight; a
striped card cut out with flakes from `NOISEC` and `NMAP`; a checkered
emitter; a thin glass with dirt by `FACING` and `FRESNEL`). **New**
pinned values (no earlier one moved): `PINNED_M3B_PROGRAMS_4SPP`
**`0x0d6e20ba`** (all ISAs, WASI, `rt-cli` and `rt-app` with 1, 4 and 16 threads,
the real `rt.wasm` in CI and by the page's code), its six passes
`PINNED_M3B_PASS_*` (albedo `0xa0543b58`, normal `0xc28ef77c`, depth
`0x8f3d03ed`, part and material ids `0xa67fd1e5`, circle of confusion
`0x6ad58dc5`) with their parity block in `engine.yml`, and the values of the
seven programs at 1000 points (`PINNED_M3B_PROGRAM_VALUES`, which the page
reproduces: the cross test in reverse). Capture `docs/ui/m3b-graphs.png`: the
ten examples in *Full*, with their mean (left, what it was before) and with their
program (right).

**Cross test** (`tests/material-program-cross.test.ts` writes and pins
`tests/fixtures/material-programs.json`; `rt-core`'s `program/tests.rs` runs
it): 172 cases —the ten examples at the 1000 points of `contractPoints`
(with M3a's pinned values), 102 of each single instruction in each mode,
projection, axis and border at 200 points, and 60 of each function with 0, −0, ±1,
halves, integers, the tiny and the huge, ±∞ and NaN—: **the same bits in
all** (tolerance 0: both sides do the same `f32` operations in the
same order with the same elementary functions, without FMA; a change from 0.25 to
0.24 in `FSMIN` turns 10 cases red), with each NaN counted as the
quiet NaN `0x7FC00000` (`tests/program-hash.ts`, and the same in Rust): a NaN's
sign and payload are not fixed by IEEE 754 or WebAssembly, and in WASI one
case (`FSMAX` with ±∞) gave a NaN of the other sign when run among all the `rt-core`
tests and the reference's when run alone; the engine never reads those bits
(a NaN output leaves the file's value). The 44 cases with some NaN
changed *hash*; the ten examples did not (they are M3a's pinned values).

**Comparison by regions** (`tests/programs-full-browser.test.ts`, with
`tests/browser/programs-scene.ts`): *Fast* in Chromium (each graph baked
by the app's *workers*, a new preview per scene) and the real `rt.wasm`
through the page's writer, 200 × 150 at 32 samples, each graph on a
part where *Fast*'s maps are the graph (a plate seen head-on whose face
is the part's plane y = 0, a cylinder for the label), in a flat white
world (the brushed metal, under the studio). Each image is classified
by the thirds of its luminance; *match* is the share of settled pixels
(dark or light, far from the edges) in the same class in both;
the *control* renders the engine with the pattern moved under the same surface
(the part's coordinates shifted or rotated, or half a UV band); the
tone is the part's mean colour in both (screen values).

| Graph | Compared | Match (settled pixels) | Control | Correlation (control) | Tone *Fast* / *Full* (distance) |
| --- | --- | --- | --- | --- | --- |
| Flat material (reference) | tone | — | — | — | 220 220 220 / 195 195 195 (25) |
| Plastic with label | place and tone | 100 % (2821) | 75 % | 0.996 (0.08) | 119 134 175 / 120 132 161 (14) |
| Brushed metal | tone | 98 % (2938) | 98 % | 0.45 (0.43) | 166 165 165 / 128 128 129 (38) |
| Marble | place and tone | 100 % (4707) | 29 % | 0.998 (−0.16) | 215 214 213 / 190 190 189 (25) |
| Leather | place and tone | 100 % (3864) | 63 % | 0.997 (0.14) | 119 89 69 / 123 101 84 (15) |
| Wood with two noises | place and tone | 100 % (602) | 39 % | 0.991 (0.02) | 174 144 111 / 158 137 112 (16) |
| Glass with dirt | tone | 98 % (1273) | 99 % | 0.60 (0.68) | 100 100 100 / 130 131 130 (30) |
| Checks | place and tone | 100 % (4024) | 0 % | 0.996 (−0.97) | 154 154 155 / 146 146 146 (9) |
| Paint with flakes | place | 0 % (157) | 45 % | **−0.91** (−0.005) | 206 145 144 / 100 43 43 (106) |
| Glazed ceramic | place and tone | 100 % (5865) | 0 % | 0.999 (−0.91) | 173 191 180 / 155 170 162 (21) |
| Stripes | place and tone | 100 % (1695) | 0 % | 0.998 (−0.98) | 149 151 160 / 141 143 150 (10) |

Seven graphs match in place (100 % of the settled pixels, correlation
0.99 or more, the control collapses) and in tone (within 9–25 of *Fast*, within the
difference of the two renderers with a flat material, 25: *Fast* comes out
lighter with any material). The brushed metal and the glass are compared
by tone (see “What did not fit the plan” 6 and 7); the flakes, by place (8). With the
programs switched off in the writer (the engine with the mean), the eight place
tests fail.

**Tests** (each fails without what it tests): in `rt-core`, 7 in
`program/tests.rs` (the cross test and its points, M3a's and the
noise's pinned values, the example programs' values, reading and 15 shapes of a
bad program or one of another version, an execution that neither allocates nor depends on the previous one), 12 in
`program/scene_tests.rs` (point-by-point values in part space;
the UVs, the tangent, the UV shift and the view; the normal in the world, with
the instance rotated and from behind; the cut-out for the camera and shadows; the
emission that is added and the emitter that stops being a light; the constant and
computed bevel weight; curvature on the cube and on the fold, also through
a program; the level of detail, that of a bump and that of each UV set; each
value to its range; `PROG` round trip, old files, the new
version, invalid ones, the first that counts and the updates; E6's pattern
that yields and a scene without programs that does not change), one in
`integrator/tests.rs` (shadow rays from a medium's exits through a
program cut-out), the pinned value and the passes, the threads in `rt-cli` and `rt-app`,
`features` in `/api/info` and in `rt.wasm`; in TypeScript, the cross test (3: the file, the values and that all
the codes are there),
`tests/programs-engine.test.ts` (15: the switch with an engine that runs them,
one from M2b and one from before, in the *pool* and in the launcher, in *Render* and in the
viewer; `PROG` at the end over the mean; the same figures without node
materials; the emitter that varies; the label image in sRGB; the bytes of
`m3b.rsb`; the engine's values through the page's interpreter; the real `rt.wasm`:
the pinned value by the page's code and a node material that changes
the image), the note in `material-nodes-ui` and the comparison by regions (11).
**Mutations**: 33 of the engine (each instruction and the noise, the level of detail
and its groups, part space, the tangent, the UVs, the normal and its side,
the cut-outs and the three shadow paths, the emission and the emitter as a light, the
constant and computed bevel weight, convex and concave curvature, `EDGE`,
the `PROG` reader, E6's pattern, the albedo, validation, the ranges, each
UV set): 31 turn their test red; the other two were equivalent (the
emitter's radiance is already the program's emission; the shadow-normal flip that
the context redoes, removed from the code). 12 on the page (the
switch and its two bits, the writer, the `PROG` material, the emitter that
varies, the colour space, the *pool* and launcher views in *Render* and
in the viewer, the note): all 12 red. The first round left 10 of the
engine alive (8 genuinely) and 4 of the page: hence the new tests.

**Cost** (native `rt`, AVX2, shared machine, alternating rounds, measured
before merging v0.1.11; the ten example parts —nine boxes of
100 × 60 × 100 mm and the label's cylinder— each with its graph, the
default studio, written by the page with the programs and without them, with
their mean):

| Measure | With programs | With the mean | Difference |
| --- | --- | --- | --- |
| 1 thread, 320 × 240, 16 samples, 6 rounds (median) | 1.91 s (1.85 Mrays/s) | 1.30 s (2.73 Mrays/s) | +47 % time, +47 % per ray |
| 4 threads, 640 × 480, 64 samples, 5 rounds (median) | 7.27 s (7.76 Mrays/s) | 5.17 s (10.96 Mrays/s) | +41 % time, +41 % per ray |
| The scene with the mean, earlier engine (`3497ab5`) and M3b's, 1 thread, 6 rounds | 1.30 s (M3b) | 1.27 s (before) | +2 %, noise; the same PNG byte for byte |

All the parts carry a program (6 to 41 instructions: checks 6,
ceramic 9, stripes and flakes 10, label 11, marble 13, glass 18, wood 24,
leather 34, brushed metal 41; the multi-octave noises are the expensive part). A
scene without node materials does nothing new.

What did not fit the plan: (1) **`PROG`** is not the proposal of §5.2 quater (a
section with the scene's programs and each one's index in `MATL`): it is
a section per material with its index in front, at the end of the file; `MATL`
does not change (an earlier reader does not even notice, and the material of a program the
engine does not read is still its mean), and an update carries the programs
with the materials. (2) **The noise** is M3a's (its contract, written for
this), not E6's (`pattern/noise.rs`, which is another): the cross test asks for it
bit for bit. (3) **Curvature**: from the bevel's hard edges (E7 is not there); a
smooth mesh without hard edges gives 0, and `EDGE`'s radius is in mm of the part.
(4) The graph's **internal scattering** is not read: E9's medium belongs to the
volume (free path, colour, direction), not to a point; neither does a flat material's
reach the engine. Absorption and thin walls are the
`MATL`'s (the page writes those of the output in both places). (5) **An emitter
whose emission varies** is not a sampled light: it lights through the paths that find it
(unbiased, with more noise), like M2b's image one; the page
writes it as a non-emitter (its mean does not emit) so that the earlier engine does not
paint a uniform light that is not there. (6) **The brushed metal**: its pattern is
in the roughness and the relief, which the white world does not show; under the studio
three.js's lights and the traced ones differ (correlation 0.45, tone at 38):
it is compared by tone. (7) **The glass with dirt**: *Fast* has no transmission
map (transmission is the graph's mean), and dust is mostly less
transmission: in *Fast* it is barely seen and in *Full* it is. By tone. (8) **The flakes of the metallic paint**: the place matches (correlation
−0.91: the same pattern, the tone reversed), but M3a's `NORMAL_MAP` takes the
blue as `2b − 1` without the intensity, and a noise's colour puts half of
the normals pointing into the surface (49 % of the plate's points);
the engine folds them to the edge on the side that faces, like M2b's
normal maps (they come out dark), and three.js lights them with the world (they come out light).
**Decision for Fable** (rule 11/12, the contract is M3a's; decided in *Judgement calls* and done in C1): that
`NORMAL_MAP` blend towards the map's normal by the intensity and leave it out
(like Blender's), or that the example pass the noise through a range with the blue
near 1, or that the engine reflect a back-facing program normal instead of
folding it; the first two change *Fast* and *Full* at the same time. With
today's example, the flakes look darker in *Full* than in *Fast*.
(9) **Level of detail**: M2b's footprint one for reads through a
`MAP` or a UV set (and its steps); coordinates computed another
way are read at level 0 (*Fast* filters them in its maps), and shadow rays
too. (10) **What the program does not see**: the particles (they have no
node material), the caustics' photons (they see the `MATL`, the mean,
as they see patterns and textures) and the normals pass (the bevel's, without
the program's normal, like M2b). (11) **Tone**: *Fast* comes out about 25
units lighter on whites with any material (the table's flat reference):
it is the difference between the two renderers, not between the programs. (12) **Observation on *Fast*** (not touched): a preview reused
from one scene to another in the test showed the previous graph's maps until
re-baking; with one preview per scene it does not happen. It was not reproduced in the
app; noted for whoever looks at `render/graph-preview.ts`. (13) **The wood**
(what M3a's verdict left to M3b): `docs/ui/m3b-wood.png`, both in the
engine: on the left the catalogue's *Wood* family (oak, E6's grain:
fine straight rings, pores), on the right the *Wood with two noises* example (wide, wavy rings
around the part's vertical axis,
no pores): they do not look alike. Making them look alike is a recipe and a visual
criterion (**Fable**). **The *Wood* and *Fabric* nodes** are not added (pending decision,
TRIAGE 1.6). The interpreter would make them easy in the engine: a `PATTERN`
instruction with the constants of `PATN` (family, colours, scale, the 16
parameters, variant and seed) that calls `pattern.rs` at the part's point
through the `Host` (which already gives curvature; knots are placed per
instance as today) and gives colour, roughness and height (the relief, with the three
evaluations); the big part is *Fast* and the cross test: TypeScript does not have
E6's recipes (it paints the wood with its mean colour and the knots), so
they would need to be ported to `f32` in TypeScript (phase L). (14) The comparison by
regions needs Chromium and `rt.wasm`: it is skipped in the CI engine
job; its Node half (`programs-engine.test.ts`) goes in *Passes through the
page's own code* with the real `rt.wasm`. (15) The shadow from a medium's exit
through a passable surface runs the program twice (once for the
wall's material and once at S4b's straight crossing), like the textures.

## M3c · Wood and Fabric nodes — **Opus** — done

**What** (decision 1.6 of *Judgement calls*; the owner, `TODO.md`
§1.6: “all materials must be functional with respect to nodes”).
*Wood* and *Fabric* nodes in the material editor with E6's recipes
(wood: rings, figure, pores, fibres and knots; fabric: weave, threads
per cm, relief, twist), with the families' parameters in their
units; the engine executes them in M3b's interpreter with E6's code;
the graphs' wood example is made with the *Wood* node and looks like
the family (`m3b-wood.png`).

**Done.**

- **Engine** (`rt_core::program`, ARCHITECTURE §5.2 quater and undecies). Eight
  new, stable codes: `WOOD` 130, `WOODR` 131, `WOODH` 132, `WOODN` 133
  and `CLOTH`/`CLOTHR`/`CLOTHH`/`CLOTHN` 140–143. Each reads a point (`a`,
  part space, mm), a normal (`b`) and the 25 constants of its recipe
  in `k`, which are the `PATN` as is (two colours, scale, 16 parameters,
  variant and seed); `WOODR`/`CLOTHR` also read the roughness (`c`) and give
  `(c·rug) + sum`, which `Tint::apply` does before its `clamp`. **There is
  no second wood**: `pattern.rs` was split into `Placement` (where the pattern is
  on a part: the frame, the mm per unit and the knots), `place` (what
  `PatternSetup::new` did per instance: the mesh box's frame, the
  instance's scale, the knots with their surface test) and
  `sample_at` (what `Placed::sample` did, which now calls it), and the
  instructions run `sample_at` with the placement the host gives
  (`Host::placement`, new and with a default value: without a part,
  `Placement::IDENTITY`, the point's own space in mm without knots).
  `ProgramSetup` places each recipe of a program on each instance when
  preparing the scene (`place`, the family's), and a node's outputs
  share a sample (the last, per recipe, point and normal: unallocated). The
  roughness is stretched along the grain or thread: the first pattern sample
  of the program at the point gives its tangent (`Host::grain`) and
  `Resolved::frame` gives the integrator's frame as `Tint::frame` does for a
  `PATN`. Bit 5 of the capabilities, `FEATURE_PATTERN_NODES` (32), in
  `rt_features` and `/api/info`.
- **TypeScript.** `core/patterns.ts` ports E6's noise step by step in `f32`
  (the Fisher–Yates permutation with the engine's PCG32, in `BigInt`),
  the wood, the knots' flow and end grain, the fabric and `sample_at`;
  `core/pattern-recipe.ts` derives the recipe from the parameters (the same function
  for `io/rsb.ts`'s `PATN` and for the compiler's constants:
  `ringDensity` per 100 mm times `woodScale`, `threadCount` per cm, mm); the
  compiler (`core/material-program.ts`) and the interpreter
  (`core/material-interp.ts`, with its per-recipe placement `PlacementOf`)
  have the eight codes. The catalogue (`data/material-nodes.ts`) has
  `WOOD` and `FABRIC` (category *Texture*, new keys): inputs *Point*
  (unconnected, `POSITION`: the point in mm), *Normal* and *Roughness*;
  outputs *Colour*, *Roughness*, *Anisotropy*, *Normal*, *Height (mm)* and, for
  fabric, *Sheen*; parameters with the family's keys and ranges (plus
  `poreSize`, `poreBand`, `woodFigure`, the seed and `yarnTwist`, which the
  family stores without a control). The normal is only connected to an instruction if
  the recipe has relief. `es`/`en` strings in the catalogue and
  `ge.implicit.POSITION` in `ui/strings.ts`.
- ***Fast*.** The pattern nodes read 3D coordinates, so the baking
  is M3a's cut through the front of the part; `patternPlacements`
  (`core/material-preview.ts`) places each recipe in the box of the material's
  parts (the frame of `wood_frame` in `f32`, the knots of `core/knots.ts`
  with the box as the surface) and the nodes' spheres and the graph's mean,
  in that of the 100 mm ball. In *Fast* a wood node material
  shows its rings (the family keeps its mean colour and the
  knots).
- **Conversion** (`core/material-graph.ts`). *Simple → Nodes* of a wood
  or a fabric gives its node with the family's parameters (RGBA colours
  become RGB, the seed is the material's, the roughness its input)
  connected to the output's colour, roughness, anisotropy and normal
  (`minimalGraph`, `PATTERN_LINKS`). *Nodes → Simple* is immediate if the
  graph is that one (`patternGraphOf`): untouched, the material returns as it was;
  with the node edited, the family with the node's values (and the roughness and
  the clearcoat); with another seed, another node or one connection fewer, it asks.
- **Page.** `programsView` (`render/engine.ts`) sets `patternNodes: false`
  in the view of an engine with programs and without bit 5, and `projectScene`
  then writes a node material with patterns as the mean of its
  outputs (such an engine would reject the program: unknown code); the
  *pool*, the launcher, the viewer and *Render* use it.
- **Example.** `WOOD_TWO_NOISES` (the key stays) is the catalogue's oak
  with the *Wood* node connected to the output, *Oak (Wood node)*:
  the graph that *Simple → Nodes* gives for the oak.

**Pinned values.** None of the earlier ones moves except the M3a wood example's,
which had to move (it was the two-noise graph that did not look like
the family: decision 1.6): `WOOD_TWO_NOISES` `043e3493` → **`6600a83f`** in
`EXAMPLE_PINS` (`tests/material-program.test.ts`) and in
`the_ten_examples_are_the_m3a_pins` (`program/tests.rs`); its cross-test
case, with it. New: `PINNED_M3C_WOOD_4SPP` = **`0x5ed1bf32`**,
E6's patterns scene with the oak and walnut painted by *Wood*
nodes (`example::m3c_wood_scene`, `rt --write-m3c-wood-example`): **the
same *hash* as the family's** (`PINNED_E6_PATTERNS_4SPP`; the test
requires it), and `PINNED_M3C_CLOTH_4SPP` = **`0x1cb5860d`**, the fabric scene with
*Fabric* nodes (`rt --write-m3c-cloth-example`), different from E6's
(`0x53e6a855`) only by the bevel (below). Both in scalar, SSE2 and AVX2,
with 1, 4 and 16 threads in `rt` and in the launcher, and in `engine.yml` (alone and with
the passes) against the real `rt.wasm`.

**Tests** (each fails without what it tests). In `rt-core`,
`program/pattern_tests.rs` (6): over 400 rays from outside at each part of
E6's scenes, the family's material and the program's give the same
bits of colour, roughness, anisotropy, shading normal, frame
tangent and albedo, for wood (with its three knots, bevelled) and fabric (without
bevel), and for the other three figures and the other five weaves; the
program's knots are the family's; without a part, each output is `sample_at` in
the point's space; a recipe without scale paints nothing; the constants are the
`PATN` and the reader checks them. The two new pinned values and their threads in
`rt-cli` and `rt-app`. The **cross test** (`tests/material-program-cross.test.ts`,
`tests/fixtures/material-programs.json`, `program/tests.rs`) adds 18 cases:
the four instructions of each catalogue wood (oak, pine, walnut,
maple, ebony, bamboo, MDF) at 300 points and at a fifth, each weave (cotton,
twill, denim, satin, canvas, felt, knit and untwisted carbon) at
three scales, an oak with 26 mm knots placed around the points
(the case carries its placement in the file, `placement`: frame and knots in
`f32`) at 1000 points and a recipe that does not paint: **the same bits** in
all. `tests/pattern-nodes.test.ts` (10): the permutation, the nodes' parameters and
outputs, the compiler's constants equal to the `PATN` of
each catalogue wood and fabric, the normal only with relief, the common recipe
with `patternToRsb`, the round trip of *Simple ↔ Nodes* (untouched, edited,
another seed, one connection fewer), the engine switch, *Fast*'s
placement (frame and knots) and the baking with it, and the example
with rings in *Fast* with the oak's mean. `material-graph`,
`material-nodes-ui` and `material-program`, up to date. **Browser**
(`tests/programs-full-browser.test.ts`, “the wood graph sphere renders as
the Wood family sphere”): a 100 mm ball in the white world, in
*Full* with the real `rt.wasm` through the page's writer, with the family's
oak and with the example (and with the oak converted to nodes): **the same
image byte for byte** in both cases (correlation 1, 100 % of the 928
settled pixels, tone 172 155 132 in all three, distance 0); the control
(the example turned a quarter turn) falls to 0.67. The threshold is that of the
comparison by regions (correlation > 0.75, agreement > 0.85, tone within
40, the control 0.2 below). The
wood example of M3b's comparison by regions (*Fast* against
*Full* on the plate) now uses as control the plate turned upside down (a
mesh shift also moves its frame) and is compared by the
correlation, like the flakes: 3 mm rings are five pixels on the
plate and almost no settled pixels remain (the control matches on them 98
%). *Fast* and *Full*: correlation **0.995** (the control, 0.08), tone
192 168 137 / 171 153 129 (distance 21, within that of the flat material,
25). Until M3c the example was compared by agreement (100 % of 602 pixels,
correlation 0.991).
**Mutations** (each put in and taken out by hand, with its test red): in
the engine, the host's placement ignored (the instructions in the
point's space), the grain tangent not reported, the integrator without the
program's frame and the knots' roughness not added: all four red
(the third is caught only by the pinned values, which look at the image). In TypeScript,
nine: the interpreter's placement, the roughness sum, the normal not
folded, the knots' flow, the fabric height not blended (the five,
the cross test), the engine switch, the placement of *Fast*'s
baking (it survived the first time: hence the baking test), the
seed on the return to *Simple* and the normal connected without relief: all
nine red. And two genuine failures of the first attempt, which the
tests caught: a literal `0.225` in `f64` instead of `f32` in the rings'
profile (the cross test turned the five woods with rings red; on reviewing
the literals the luminance weights came out too), and the family's
RGBA colours that the RGB node did not accept (the node came out with
the default colours: caught by `material-graph`, the mean of each
catalogue material).

**Cost** (native `rt`, 1 thread, 320 × 240, 16 samples, median of three
alternating rounds): E6's patterns scene with the family 2.41 s and with
*Wood* nodes 2.36 s (the same image: machine noise); the fabric one
1.99 s and with *Fabric* nodes 2.12 s (+6 %: the program's context and the return
of its normal to the world).

**Gates.** `npm run engine:build` and `npm run qa` green (3179 tests:
3153 pass, 26 skipped; in a run with another at the same time, `ai-passes` and
`pathtracer` went over time and pass with `--maxWorkers=2`, and the two
cross-test cases now have a 120 s limit: their pattern cases
are a few thousand E6 points in `f32`). In `engine/`: `cargo fmt --check`,
`clippy --workspace --all-targets -D warnings`, `cargo test --workspace
--release` (1163 pass, 5 ignored), the wasm32 build of `rt-wasm` and
`rt-post-wasm`, the parity blocks of `engine.yml` against the real
`rt_wasm.wasm` (45 images, with M3c's four: `0x5ed1bf32` and
`0x1cb5860d`, alone and with the passes) and the page-code tests with
the real `rt.wasm` (131 pass). `tests/programs-full-browser.test.ts` (12) and
`tools/material-nodes-check.mjs --only wood,chrome` in Chromium.

**Captures** (in *Unreleased* of `GALERIA.md`): `m3b-wood.png` re-recorded
(now made by `tests/m3c-wood-sheet.test.ts` with
`REPACK_WRITE_CAPTURES=1`): the two oak boxes in *Full*, the family's
and the node example's, the same wood; and the new
`material-nodes-wood.png`: the editor with the oak example and the *Wood* node
selected (`tools/material-nodes-check.mjs --only wood`, which
also checks that the jar turns to wood in *Fast*).

What did not fit the plan (what is marked ◆ is decided in *Judgement calls*):

1. ◆ **The fuzz reaches nowhere.** *Fabric* gives its *Sheen* (the material's
   `fuzz`, a number) as the brief asks, but the material output
   has no fuzz-sheen input and the engine does not paint it
   (S8/M5); *Fast* does paint it in the family (three.js's *sheen*) and not
   in a node material. Adding it to the output is a new output of the
   program contract (the 16th).
2. ◆ **Fabric under a bevel.** The node chooses its box projection by its
   *Normal* input (the shading one, bevelled); the family, by the
   interpolated normal without bevel. Within an edge's bevel radius the
   projection can change sooner; outside, the same bits (test). That is why the
   fabric scene with nodes has its own pinned value. The alternative is for the
   host to give the node the interpolated normal when its input is not
   connected.
3. ◆ **The family's wood in *Fast*** is still its mean colour with
   the knots, while the same wood in nodes shows its rings in
   *Fast* (the cut through the front of the part). Baking the family
   by the same path would answer the other half of 1.6 (“the wood in
   the scene must look like in the spheres”) also in *Fast*.
4. **Seen from inside**: the program receives the outward normal of the
   part and the family that of the ray's side; an open part seen from
   behind folds its relief with the other face (the tests look from outside).
5. **No relief at run time**: the compiler does not connect the normal if
   the recipe has no relief, but if knots are requested and none fits the
   output normal is a copy of the input one and returns to the world with a
   rounding (the family does not touch it): a one-bit difference in the normal.
6. ***Fast*'s knots** are placed in the parts' box with the box
   as the surface (the engine tests the mesh) and for the union of the material's
   parts (the engine, per part): on a round part they may not be the
   same.
7. **The mean** of a wood node material (the one an engine without
   programs sees, and the thumbnails) is that of the pattern at the sphere's 64 points,
   within 0.01–0.02 of the family's (`0.6 light + 0.4 dark`).
8. **The node's seed** is a copy of the material's when switching to
   *Nodes*; changing the wear afterwards does not move the node's knots.
9. **Bit 5** is taken by this phase; another phase in parallel that adds
   a capability has to take 6.
10. The example changes name (*Wood with two noises* → *Oak (Wood
    node)*), not key.

## M3d · The family's wood in *Fast* through the path of the *Wood* node — done

**What** (M3c ◆3, decided in *Judgement calls*). A wood of the
*Wood* family, in *Simple* mode, looks in *Fast* like the same wood with
the *Wood* node: the preview bakes it by the same path as the
node, so that the wood in the scene looks as it does in the spheres also in
*Fast* (the other half of 1.6). In *Full* and in the renders nothing
changes: M3c already left the family and the node byte for byte equal.

**Done.**

- **Core** (`core/material-graph.ts`). `familyBakeGraph(inst)`: the graph
  that *Simple → Nodes* gives for a wood of the family (`minimalGraph`: the
  *Wood* node with the family's parameters and seed, its colour,
  roughness, anisotropy and normal in the output), stored per instance (the
  *store* changes the instance when the material changes, so the program and
  the baking are done once); `null` for a material with its own graph and
  for the other families. `FAST_BAKED_FAMILIES` = `['WOOD']`: not fabric
  (◆2). The project state does not change: the graph is seen only by the
  preview; the page's writer, the thumbnails and the engine continue with the
  family.
- ***Fast*** (`render/preview.ts`). `bakeGraph(inst)`: the own graph, or
  with baking *workers* that of `familyBakeGraph`; `syncMaterials` gives
  `GraphBakes` (`render/graph-preview.ts`, M3a) the instance with that graph,
  and the baking is the node's: the same `planBake` (the cut through the front
  of the part, in the box of the material's parts), the same placement
  (`patternPlacements`: the frame of `wood_frame` and the knots of
  `core/knots.ts` with the box as the surface), the two passes (128² and
  512²) and the same slots. A baked wood no longer carries E6's knot layer
  per part (`render/knots.ts`): its knots are in its maps;
  without that they came out twice. Without *workers* (a browser without `Worker`) the
  family continues as in E6, its mean colour with the knots, which is better than
  the means of an unbaked graph; if the *workers* arrive after the
  first synchronisation, the materials are set again.
  `GraphBakes.hasWorkers()` says so.
- **Timeline** (`render/fade-preview.ts`). A material clip
  (*Fade*, *Material colour*, N1) sets the material again from its
  instance on each frame: the preview now does it
  (`resetMaterial`), and a baked wood returns to its baking (with the
  fade's opacity on top) instead of to its mean colour, which is what
  `applyMaterial` did. A colour does not reach a wood (it has no base
  colour): as before.
- **Inspector.** The wood's controls (ring density, scale,
  contrast, variation, noises, pores) become `preview: true` and lose their
  “·” dot and the help *painted by Full mode and the renders; the Fast view
  shows the mean colour*; the `engine` field is removed from them (it stays
  for the fabric's weave). The family note (`material.flatNote`,
  `es`/`en`) now says that *Fast* shows the rings, pores and knots as
  the *Wood* node bakes them, a cut through the front of the parts
  projected onto each face, and that *Full* and the renders paint the wood
  as it runs through the part. The fabric's, the same.
- **Engine**: `engine/` is not touched; no pinned value moves.

**Tests** (each fails without what it tests).
`tests/m3d-family-fast.test.ts` (5, without a browser): the graph of each
of the catalogue's 13 woods is `minimalGraph`'s, with its *Wood*
node, one per instance (an edited instance has its own, with the new
value); none for cotton, denim, studio white, glass or a wood with its own graph; for the oak and the pine, the program
(code and constants), the plan and the baking's maps are **equal** to
those of the material converted to nodes with `graph/enable` (`toEqual` of
the whole result), with colour and normal maps; and `GraphBakes` draws it
with its baked colour map (white underneath), not with its mean colour.
**Browser** (`tests/wood-fast-browser.test.ts`, 3 and the capture; headless Chromium
with SwiftShader and the application's baking *workers*,
without `rt.wasm`): M3c's 100 mm ball (`woodSphereScene`, now with the
species and a fade optional; the `programs-page.ts` page draws it with
`WOOD_SPHERE:<type>:<species>[:FADED]` and with or without *workers*) in oak and
in knotty pine, the family and the family converted to nodes: **the same
pixels, 0 of 120,000 channels different** in both; the fine detail (how far
each pixel departs from the mean of its 7 × 7) is 5.61 in the oak and
5.46 in the pine, and the control, the family without *workers* (what was seen
before M3d), 0.20 and 0.58, with 19,550 and 19,720 channels different from
the node's. Under a timeline fade (the pine at 80 % and then at
75 % once the bakings have arrived), its rings continue (detail 4.09).
**Mutations** (put in and taken out by hand, each red): the family
unbaked in `bakeGraph` (oak and pine: 19,550 and 19,720 channels
different); E6's knot layer on top of the baking (the pine: 21,025
channels different; the oak, with no knots, stays green, as it should);
`FAST_BAKED_FAMILIES` empty (4 of the 5 tests without a browser); and
`resetMaterial` with the earlier `applyMaterial` (the fade: detail 0.07).
The last one survived the first version of the test, which used a colour clip:
a colour does not reach a wood, the fade's key did not change and
the baking, which arrives later, covered the error; the test now uses a
fade and moves the timeline when the bakings have already arrived.

**Gates.** `npm run engine:build` and `npm run qa` green (3249 tests: 3216 pass and 33 are skipped, among them the M3d capture one, which only runs with `REPACK_WRITE_CAPTURES=1`; with Chromium, the three of `wood-fast-browser` run and pass, also alone).
`engine/` is not touched.

**Captures** (in *Unreleased* of `GALERIA.md`): the new
`m3d-wood-fast.png`, made by `tests/wood-fast-browser.test.ts` with
`REPACK_WRITE_CAPTURES=1` and the `rt.wasm`: the family's oak (top) and knotty
pine (bottom) on the ball, in *Fast* before M3d (without
*workers*: mean colour and E6's knots), in *Fast* now (the *Wood*
node's baking) and in *Full*. No earlier capture shows a family
wood in *Fast* (the wood ones are of *Full* or of the node editor),
so none is re-recorded.

What did not fit the plan (what is marked ◆ is decided in *Judgement calls*: both go to **M3e**):

1. ◆ **The knots in *Fast* change place.** Before, E6's layer put them per part, in 3D and with the mesh test, where
   *Full* puts them; now they are those of the node's baking, placed in the box of
   the parts with the box as the surface (M3c, “What did not fit the plan” 6) and seen in
   the cut through the part's plane y = 0, projected onto the faces. On a flat front
   face (the plate, a box) they coincide; on the 100 mm pine ball,
   *Full* has three small knots (top left,
   bottom right, bottom) and the baking two large ones at the sides
   (`m3d-wood-fast.png`, bottom row). Cutting through the front of the
   box (y = min) instead of y = 0 was tried: the knots still land somewhere else (it is the
   placement), and it is not kept. Options: (a) as is, the family the same as
   the node; (b) E6's layer on top of the baking, for the family and for the
   node, with the baking without knots: the knots where *Full* puts them and
   the baking's rings, and the family stays the same as the node; (c) the baking's
   knot list taken from `partKnots` (the mesh test)
   when the material is in a single part, with the usual cut.
2. ◆ **Not the fabric.** It is the same path and in code it costs one entry in
   `FAST_BAKED_FAMILIES`, but it looks worse: (i) the baking gives a *Simple* material
   without *sheen*, and the fabric would lose in *Fast* the fuzz it paints today
   (it is M3c's ◆1, from the family's side); (ii) at 512² over
   a 120 mm part the texel is 0.23 mm and the thread measures `10 / threads per
   cm` mm: cotton has 1.07 texels per thread, twill 1.19, velvet
   1.42, denim 1.78, satin 0.43 and microfibre 0.36
   (six of the twelve fabrics, moiré or noise); linen 2.4, felt 2.1, canvas
   3.0, mesh 5.3, carbon 8.5 and knit 10.7 would be seen.
   Options: (a) as is, the mean colour and the fuzz; (b) bake the fabric
   only when its threads have at least 2–3 texels, with the family's *sheen*
   on top; (c) always bake it.
3. **A material fade over a node material** is not applied in
   *Fast* (`fade-preview.ts` skips materials with a graph since N1); over the
   baked family it is. Under a material fade, the family and
   the node look different in *Fast*; outside the plan, I do not touch it.
4. **Large parts**: the baking is 512² over the box of the
   parts, so the oak's rings (3 mm) fall below three texels on a
   part of more than about 500 mm. The node has had the same since M3c.
5. **While the baking arrives**, the family shows the graph's means
   (`flattenGraph`, within 0.01–0.02 of the family's mean colour: M3c, “What did not
   fit” 7) and not its knots, during the first pass.
6. **A section cut** (Q1) still covers the family's wood
   with its mean colour, and the node one with the white of a material with no
   parameters: the caps are not baked.

## M3e · *Fast* knots where *Full* puts them and fabric baked when its threads are readable — done

**What** (M3d ◆1 and ◆2, decided in *Judgement calls*, option
(b) of each). ◆1: a wood baked in *Fast* (the family's,
M3d, and a node material with the *Wood* node) is baked without knots and the
E6 knot layer, that of each part with its mesh test, the one that
matches *Full*, paints them on top; the family and the node still
give the same pixels. ◆2: the family's fabric is baked through the *Fabric*
node only when a thread takes up at least 2.5 texels of the 512² baking
in its parts, with its fuzz (*sheen*) on top; below that, as until now.

**Done.**

- **The knots outside the baking** (`core/material-preview.ts`).
  `programKnots(p)`: the first `WOOD` instruction of the program (the colour of
  a *Wood* node) whose recipe asks for knots, with the index of its constants
  and its knots as the engine reads them (the recipe's `f32`).
  `BakePlan.knotless`, new and optional: that recipe is placed without knots
  (`patternPlacements(p, box, knotless)`, and `bakeRows` passes it).
  `GraphBakes.apply` (`render/graph-preview.ts`) sets it in the plan of
  every material that *Fast* bakes in the scene; the editor's spheres,
  the graph's mean and *Fast*'s notes do not use it and do not change.
- **The knots on top** (`render/preview.ts`). `partKnotsOf`: the knots of
  each part are those of `partKnots` (`core/knots.ts`, which now accepts the
  request: the node's, `graphKnotSpec`, or the family's,
  `knotSpecOf`) for every material that is baked, whether family or
  node, and E6's layer (`render/knots.ts`) darkens them over the
  baking. As the baked family and its conversion have the same
  program, they have the same knots. When a baking arrives, the preview
  assigns the materials again (each part's copy with knots
  is made anew from the already baked material), and the copy is recompiled when
  its base material is recompiled (`base.version` in its key): without that, a
  material fade left the copy opaque (three.js's `OPAQUE`), an
  E6 failure that without *workers* was already there and that M3e would have extended to every
  wood with knots.
- **The fabric** (`core/material-preview.ts`). `FAST_BAKED_FAMILIES` =
  `['WOOD', 'FABRIC']` (`core/material-graph.ts`; `familyBakeGraph` also
  gives the *Fabric* node's graph); `fabricThreadTexels(s, inst)`: the
  thread spacing (`10 / threadCount` mm, the recipe's) divided by the
  plan's texel it would be baked at (`bakeTexelMm`: the side of the cut
  through the front of the parts' box divided by 512), cached per
  instance, scene and size; `fastFamilyGraph(s, inst)`: the family's graph
  for wood, and for fabric only with
  `FABRIC_MIN_THREAD_TEXELS` = 2.5 or more. The preview uses it instead
  of `familyBakeGraph` and, when the fabric changes side as its
  parts change, sets it again. To the baking, a *Simple* material, it adds
  the family's fuzz: `applyFuzz` (`render/materials.ts`, the usual one extracted
  from `applyMaterial`) through the new `finish` of
  `GraphBakes.apply`, which runs after each drawing of the material (the means
  while it arrives and each pass).
- **Inspector.** The family note (`material.flatNote`) says that the
  knots go on each part where *Full* puts them and that the fabric is woven
  in *Fast* when a thread takes up 2.5 texels of its baking, with the
  fuzz on top; the help of the “·” dot on the weave controls
  (`material.fullOnly`, used only by them) says the same. Both in `es`
  and `en`.
- **Engine**: `engine/` is not touched; no pinned value moves. *Full* and
  the renders do not change (the page's writer is not touched).

**Tests** (each fails without what it tests).
`tests/m3e-fast-knots-fabric.test.ts` (6, without a browser): the knots of the
family's pine and of the converted one are the same (`toEqual`), those of the
family by the recipe in `f32` (to 10⁻⁶) and placed on the part within
a micron of the family's; the oak has none; the colour map of the
pine baked with `knotless` is **equal** to that of the pine without knots requested, and
that without `knotless` is different; `GraphBakes` asks for the pine's two passes
with `knotless` and the oak's without it; the texels per thread of the twelve
catalogue fabrics on a 120 mm part (M3d's to 0.01) and those that
are baked (canvas, carbon, knit and mesh); cotton baked on a
50 mm part (2.56) and not on a 52 one (2.46); nothing for a fabric with its own graph,
wood always; and the family's fuzz stays in the material while
the baking arrives and after its two passes (without `finish`, 0).
`tests/m3d-family-fast.test.ts`, up to date: `FAST_BAKED_FAMILIES` has the
fabric, and cotton and denim have their graph with the *Fabric* node (whether
they are baked or not is said by `fastFamilyGraph`).
**Browser** (headless Chromium with SwiftShader and the application's *workers*,
without `rt.wasm`). In `tests/wood-fast-browser.test.ts`, “PINE:
the knots in Fast fall where Full puts them”: on M3d's pine ball,
the pixels that the *Fast* view darkens as knots (more than 6 of 255
below the same ball without knots requested, which outside the knots gives
the same pixels) against those the knots of `partKnots` cover (the engine's list,
projected by the scene's camera; two pixels from the edge,
where the faceted mesh and the sphere separate): overlap **0.977**
(128 pixels expected, 131 measured), the three visible knots with their
centre at **0.13, 0 and 0 pixels** from the expected one, and the node's ball, the
same pixels. In `tests/fabric-fast-browser.test.ts` (2 and the capture):
the knit (12.8 texels per thread on the 100 mm ball) baked, with
fine detail 2.45 against 0.14 for the earlier one (18,216 channels different); cotton
(1.28), **0 channels different** from the earlier one; and the knit baked
with its fuzz and without it, 19,977 channels different and 2.1 more
mean luminance with it.
**Mutations** (put in and taken out by hand, each red): M3d's
behaviour (the knots in the baking and no layer: overlap
0.019, the centres at 23.7, 6.9 and 27.3 pixels); the knots in the baking
**and** on top (0.084); the preview not assigning the materials again
when the baking arrives (the copy with knots keeps the means: 0.021);
the copy with knots without `base.version` (M3d's fade: 0 channels
different); `patternPlacements` without `knotless` and `GraphBakes` without setting it
(without a browser, one each); the fabric without a threshold (cotton: 10,646
channels different); and without `finish` (the fuzz: 0 channels different, and the
test without a browser). A test of a fade of the part (not the material)
over the baked pine also passed without assigning the materials again,
so it is not kept.

**Gates.** `npm run engine:build` and `npm run qa` green (3259 tests: 3225 pass and 34 are skipped, among them the two captures, M3d's and the new one, which only run with `REPACK_WRITE_CAPTURES=1`; with Chromium, those of `wood-fast-browser` and `fabric-fast-browser` run and pass, also alone with `--maxWorkers=2`).
`engine/` is not touched.

**Captures** (in *Unreleased* of `GALERIA.md`): `m3d-wood-fast.png`
re-recorded (the middle column, *Fast* now: the pine's knots where
*Full* has them, on the right), and the new `m3e-fabric-fast.png`, made
by `tests/fabric-fast-browser.test.ts` with `REPACK_WRITE_CAPTURES=1` and the
`rt.wasm`: the knit, the canvas and the family's cotton on the ball, in
*Fast* before M3e, in *Fast* now and in *Full*.

What did not fit the plan (what is marked ◆ is decided in *Judgement calls*):

1. ◆ **The threshold leaves out linen and felt.** M3d's report counted them
   among the fabrics that are readable (2.4 and 2.1 texels per thread on a
   120 mm part, with “2–3 texels” as the criterion), but with 2.5 they are not
   baked: at 120 mm canvas, mesh, carbon and knit are baked.
   On the 100 mm ball linen (2.84) and felt (2.56) are. Options:
   (a) 2.5, as decided; (b) 2.0, which adds linen and felt at
   120 mm (and leaves out denim, 1.78).
2. ◆ **How a knot looks on top.** E6's layer darkens the knot
   (`knotDarkness` × 35 %, the bark pocket 50 % more) over what is there:
   the baking's rings cross it straight, without the knot's end grain (its
   rings around the branch), without its crack, without the grain flow around
   it and without its roughness or its bowl, which the baking brought (in
   another place) and *Full* paints. Under the test's white world the
   knot is about 20 of 255 darker, less than in *Full*. Options:
   (a) as is; (b) have the layer also draw the end grain (concentric
   rings with the knot's density) in the *shader*.
3. **Only one wood knot per material.** The layer paints the knots of the
   first `WOOD` instruction that asks for them; a graph with two *Wood* nodes
   with knots leaves the second's in the baking, placed in the box as
   in M3d. And the layer darkens the material's final colour: if the colour of
   the *Wood* node goes through a mix, the knot also darkens what is mixed;
   if only its roughness arrives, there is no layer and the knot stays in the baking.
4. **The family and its conversion part ways in fabric.** The baked family's
   fabric carries its fuzz on top; the same fabric converted to nodes does
   not (the node's *Sheen* does not reach the output: M3c ◆1, for M5). In
   wood they remain the same.
5. **The threshold is per material, not per part**: the baking covers the box
   of all the material's parts, so a fabric on a small part
   and on a large one is baked in both or in neither, depending on the box.
6. **Parts that change without touching the material.** The preview
   sets the materials again only when the materials change (like
   the bakings since M3a): moving or scaling a part does not redo the
   baking or change a fabric's side until something touches the materials.
7. **The “·” dot on the weave controls** stays (it says “painted by
   *Full*”), although *Fast* weaves coarse fabrics: its help says
   when. Removing it according to the fabric and its parts would be a control that changes
   with the scene.

## M4 · Realism layer in the materials catalogue — **Opus**, verdict **Fable** (after E9, E6 and M2b)

**What.** (1) **Engine**: “artist-friendly” conductor Fresnel of
Gulbrandsen (2014) with reflectivity and *edge tint* (our metals
today are F0 by colour: they lack the edge tone), the catalogue's metals
with (reflectivity, edge) pairs taken from the public
refractive-index literature (values from public tables of n, k
integrated by ourselves to RGB); perceptual roughness (`α = r²`) if it is
not already; *specular tint* for dielectrics. (2) **Catalogue**: a pass over
all the recipes with physical and photographic criteria: real albedos
(HDPE white is not 1), IOR by type of glass and plastic, clearcoat
where there really is one (glossy plastics, glazed ceramic,
varnished wood), anisotropy on brushed finishes, **micro-bevel by
default** (0.2–0.5 mm depending on material) on everything hard, scattering medium
(E9) on translucent things, **micro-variation** of roughness and normal by
fine noise (E6) at a scale that does not read as texture but removes the
“computer plastic” look, and optional *subtle imperfections* (E7
when it arrives). Pending from E6 (the fabric verdict): **the clearcoat ignores the
pattern's *bump*** (today the fabric's and wood's relief tilts the
normal of the whole BSDF, clearcoat included; a real clearcoat is flat over
the weave or the grain): with that the carbon can return to its full relief
(now 0.05) and the varnished wood gains a clean reflection over its pores. (3) Sheet `out/materials-sheet.html`: each material
before and after, on a sphere and on the jar, with the `STRIP_EDGE` set;
**Fable's verdict** material by material before closing (rule 11).

**Acceptance.** No material changes key; old projects
open with the new recipes (which is what is wanted) except the edited
instances, which keep their values; the sheet with the verdict.

## Optics: lens simulation — decision **Fable** (after v0.1.5)

`STUDIO-TOOLS.md` §1 and `docs/research/optics.md` left six
decisions open (§7). They are taken as follows:

1. **Default character**: *Clinical* (round pupil, well-corrected lens).
   Product photography wants a lens that is not noticed; the
   character is chosen on purpose. Of the 16 prescriptions all are
   shown; the `verified` ones without a notice, the `caveat` and `experimental` ones with
   a note in the help, and the `own-design` ones marked as own design.
2. **Swirl**: both. It arises only from the traced Petzval with its real
   half-apertures, and in the thin lens there is an artistic control
   marked *not physical*.
3. **Chromatic aberration**: the hybrid three-band scheme (each
   camera sample chooses R, G or B stratified, traces the lens with that
   band's index and weights only its channel). Nothing spectral.
4. **Polynomial fitting**: no high-degree polynomial is fitted.
   The fast profile is `f32` sampled tables (distortion and
   relative illumination by image height, cardinal points) drawn from
   a few-ray trace when the lens is loaded.
5. **Flare ghosts**: not in this first delivery. *Coatings*
   enter only as per-surface transmission (T-stop and tint). Ghosts
   and the diffraction star are left for O3.
6. **Names**: neutral, those of the A6 catalogue.

And a cost rule: the traced camera cannot exceed 25 % of the
render time of the example at 1024 samples with the double Gauss (measured
and in the PR); if it does, it is batched (§6.1 of the report) before
closing.

## O1 · Improved thin lens and bokeh selector — **Opus** — done

**What.** `STUDIO-TOOLS.md` §1 mode 1, in `rt-core` and in the interface.
Engine: new optional RSB section `LENS` after `CAMR` (`CAMR` does not
change: an RSB without `LENS` renders bit for bit as today): aperture
shape (circle; polygon of 3 to 18 blades with roundness 0–1 and rotation;
monochrome mask image with 2D CDF sampling), pupil profile
(uniform, bright centre, bright ring, apodised: the weights of
`src/data/bokeh.ts` `PUPIL_PROFILES`), central obstruction (ratio ε),
approximate cat's eye (intersection with a second disc displaced in
proportion to the image height, with an intensity control),
anamorphic (horizontal compression of the pupil and un-stretching of the
image, 1.33× and 2×), **shift and tilt** (*tilt-shift*:
sensor displacement in mm and a focus plane tilted by
Scheimpflug, with the focus point at the centre), band-wise chromatic
aberration (decision 3: one band per sample, radial displacement of the
origin in the pupil per band, weight in its channel) and swirl as an
artistic control (rotation and stretching of the pupil with image height).
The new random dimensions (band, mask) are *hash* dimensions
beyond the Sobol table, like the cut-outs: a scene without
`LENS` does not change by a single bit. The `coc` pass is still the thin
lens's (note it). **Interface**: in the *Camera* section, *Bokeh* with the
thumbnails of the 20 types of `src/data/bokeh.json` that are made with
mode 1 (those that require a traced lens wait for O2 and say so), each
thumbnail **rendered by the engine itself** (a blur kernel:
defocused points of light on black, `tools/bokeh-thumbs.mjs` with
`rt`, deterministic, pinned hash); *Blades*, *Roundness*, *Rotation*,
*Profile*, *Obstruction*, *Anamorphic*, *Tilt* and *Shift*,
*Chromatic aberration* and *Swirl* (these two marked *not physical*) in
an *Advanced optics* subsection; the Fast viewer does not draw depth of field
(it already says so) and does not change. Project: optional camera
fields; earlier cameras open the same.

**Depends on.** A6, E5.

**Acceptance.** The example without `LENS` keeps `0x223515c3`; sheet
`out/bokeh-sheet.html`: the scene of points of light with each type, at 256
samples, **with Fable's verdict**; test: with 6 blades the sampled
pupil falls inside the hexagon and outside the inscribed circle in the
expected proportion (±1 %); *tilt* moves the focus plane as
Scheimpflug says (geometric test with three points); the mask with
CDF sampling gives the same mean as rejection sampling (±1 %);
determinism 1/4/16 threads and wasm.

**Done.**

- **Engine** (`rt-core/src/optics`, new RSB section `LENS`, optional,
  right after `CAMR`; `CAMR` does not change). `Camera.lens:
  Option<Lens>`; `Camera::sample_ray` returns the ray and a **colour
  weight** that the tile multiplies (`render::camera_sample_weighted`). The
  **pupil** is sampled with its exact density and without rejection
  (`optics::pupil`): disc by the concentric map with the radius remapped
  by the inverse of the profile's CDF in `s = ρ²` (stable roots of a
  quadratic; the apodised one with `fmath::exp`/`ln`), triangle fan
  from the centre for 3 to 18 blades (straight: N equal triangles; curved:
  arcs of radius `apothem / roundness` tangent to the edge at its midpoint, 24
  chords per blade, the geometry of `tools/assets/aperture-masks.mjs`) with
  the profile of the shape's gauge, and a grid with marginal and conditional CDF
  for a mask (replaces the aperture; rotates with it) or a texture
  (multiplies the shape, drawn with a softened edge), with the profile and
  the obstruction inside. Sobol stratification reaches the pupil and the
  brightness does not change. **Cat's eye**: second disc of radius 1 displaced
  `cats_eye × h` towards the axis (h = 1 at `field_mm`, the corner of the
  frame); outside it the sample weighs black but traces its ray (the
  coverage of a transparent background does not change): it is the optical vignetting that
  accompanies it. **Anamorphic**: x of the pupil divided by the compression; the image,
  un-stretched. **Shift** on the principal ray and **tilt** by
  the hinge rule (normal of the focus plane `f·forward + u·sin α·b`,
  through the axis focus point; with the sensor at `f u / (u cos α − f)` Scheimpflug
  is also satisfied), with the pupil in the rotated lens plane.
  **Chromatic aberration** (decision 3) and **swirl** as artistic
  settings. The only new dimension, the band, is `DIM_LENS_BAND =
  3 << 20` used by `PixelSampler::strata`: every three consecutive samples of
  a pixel are the three bands (the offset, a *hash* of the pixel) and **share one
  pupil point**, the index `(i + offset) / 3` of the lens's Sobol
  sequence, so each band runs through its own points in order and
  the colours in the interior of a disc coincide (after the sheet: before, each
  band had its own point and the interior came out speckled with colour). A neutral `LENS`
  renders bit for bit as the thin lens; without `LENS` not a single bit changes:
  example `0x223515c3`, E5 `0xbf8abd5b`, E5 sky `0x2fcb098a`, E5c
  `0x8bb09f6b`, caustics `0x55d60f2f` and *denoise* `0xab15f290` intact.
  Parity scene `example::o1_scene` (all controls at once and a
  48² ring texture; `rt --write-o1-example`, `tests/fixtures/o1.rsb`):
  `PINNED_O1_LENS_4SPP = 0x1439a1a8 (re-pinned after E12)` in scalar, SSE2 and AVX2, in WASI
  (scalar and `simd128`), in the real `rt_wasm.wasm` (also with the passes
  interleaved; in CI), by the page's code (`tests/optics.test.ts`)
  and with 1, 4 and 16 threads (`rt-cli/tests`). The `coc` pass is still that of the
  round, untilted thin lens (noted in `passes.rs` and in
  ARCHITECTURE §5.2 ter); `render::centre_ray` respects the shift.
- **Interface.** `CameraState.optics` (optional, `src/core/optics.ts`;
  earlier cameras without it, the usual thin lens: the RSB of a U2 project
  comes out byte for byte the same, test). *Camera ▸ Bokeh*
  (`src/ui/panels/insp-lens.ts`): grid with the 20 types, 16 with their
  thumbnail rendered by the engine and the 4 that mode 1 does not make
  switched off with what they are waiting for (traced lens, O2; wave optics,
  coming soon); variants with their thumbnail; moving a control by hand says *Custom*; *Plain disc*. *Advanced optics*: *Blades* (0 round
  aperture), *Roundness*, *Rotation*, *Profile* and *Intensity*, *Obstruction*, *Cat's
  eye*, *Anamorphic*, *Tilt* and its *Axis*, *Shift* H and V,
  and under **NOT PHYSICAL** *Chromatic aberration* and *Swirl*. All through the
  *store*, one undo entry per gesture. The pupil images are read by
  `src/io/aperture.ts` without a *canvas* (own PNG decoder, exact in
  any browser) and averaged 2 × 2 to 256²; `main.ts` requests them on
  a state change and restarts the tracer when they arrive (meanwhile, the
  blade aperture). The Fast viewer does not draw depth of field,
  but it does draw the **shift** (the projection matrix: the viewer's
  framing is still the render's). `tools/optics-check.mjs` walks through it in
  the local Chromium (six checks) and leaves
  `docs/ui/camera-bokeh.png` and `docs/ui/camera-optics.png`.
- **Thumbnails** (`tools/bokeh-thumbs.mjs` with `rt`, scene from
  `tools/bokeh-scene.mjs`: an 85 mm at f/1.6 focused at 600 mm and twelve lights of
  100 mm at 6 m in a 4 × 3 grid, a fifth of the blur disc,
  black background, sRGB curve, 1024 samples): 30 PNGs in `public/thumbs/bokeh/`
  (16 types and their variants, 416 kB) with `index.json` (parameters, *hash*
  of the RSB and of the pixels); `--check` renders them again and compares. A
  test requires that the tool's scene write the same `LENS` as the
  page for each type, that the thumbnails be up to date with
  `bokeh.json` (RSB *hash*), and with the real `rt.wasm` it pins the *hash* of
  the curved polygon's at 4 samples (`0xfa8496aa`).
- **Sheet** `out/bokeh-sheet.html` (`node tools/bokeh-thumbs.mjs --sheet`):
  the 30 kernels at 480 × 360 and 256 samples with lights of a fifth of the disc
  (the “convolved” look), with their recipe, and below, as the
  verdict asked, a row of **pure kernel** with 32 mm lights (a fifteenth
  of the disc, the radiance scaled by the area ratio) at 512 samples
  for the textures (onion rings, dust, stripes, mesh), the chromatic
  fringes and the reference disc. The textures **are not readable** in that
  row, not even by raising the amplitude (onion rings at 1 instead of 0.45,
  tried: it comes out the same): their details are smaller than the source and almost the
  size of a pixel (one period of the rings, about 4 px on a 90 px disc;
  the mesh, about 3 px; the source of a fifteenth, 6 px), and each
  pixel hits the light in 1 of every 225 samples. So **the amplitude
  stays** (`onionAmplitude` 0.45, unchanged) and the sheet adds a third
  row of **close-ups** (`CLOSE_UP` of `tools/bokeh-scene.mjs`): a
  single light that fills the frame (a 300 mm at f/5.6, the same entrance pupil;
  a disc of about 320 px) of a fortieth of the disc, at 1024
  samples: the rings (about 14 px per period) can be guessed through the
  grain; the stripes and the mesh, barely. Cleaning it would take on the order of
  50,000 samples per pixel. **Verdict**: the amplitude (0.45) and the
  recipes stay; dust, stripes and mesh read only in
  close-ups of large bokeh, as happens with real filters. The **chromatic fringes**, stratified (above), were
  rendered again at 256 samples. **Lead's verdict**: the set of
  kernels is accepted as is; the swirl constants (`SWIRL_COMPRESS` 0.35,
  `SWIRL_STRETCH` 0.25, `SWIRL_TURN` 0.6 rad) and those of the chromatic
  aberration are kept; the anamorphic oval's overexposure is physical and
  stays (the control's help says so: oval bokeh concentrates more light
  at the same aperture).
- **Tests** (each checked by reintroducing the error): 18 in
  `optics::tests` of rt-core: 6 blades inside the hexagon and outside the inscribed
  circle in the expected proportion, `1 − π cos² 30° / (3 sin 60°)`
  ± 1 % (without the radius root, it fails); curved blades inside their arcs
  (ends at the circumscribed circle, fails); the eight profiles with their mean of
  `s` ± 0.5 % (sign of the root or 2σ² swapped, fail); obstruction
  (forgotten, fails); Scheimpflug and hinge with three points, with four
  tilts and axes (the normal with cos, the pupil rotated the wrong way —
  its points outside the lens plane—, fail); towards the floor with positive tilt (inverted axis, fails);
  shift without changing the plane (ignored, fails) and neutral lens bit
  for bit (another order of operations, fails); anamorphic (multiplying instead of
  dividing, fails); cat's eye with the area of two discs ± 1 % (double the
  displacement, fails); mask by CDF with the rejection mean ± 1 % in
  centroid and `E[r²]` (mirrored, fails); texture inside the aperture and
  mask that replaces it point by point; three bands per three samples
  (unstratified, fails), the three bands of a group with a single
  pupil point (not sharing it, fails) and bands that add to white in a neutral scene
  without obstruction, exact at 3 samples and with no cast at 256 (weight 2.9,
  fails); same film on each SIMD path and in any tile order;
  `LENS` round trip (without padding, fails); out-of-range values
  rejected (two blades accepted, fails); O1 *hash* (another
  band dimension, fails). `rt-cli`: 1/4/16 threads with the lens.
  `tests/optics.test.ts` (14): neutral optics without `LENS` (a neutral one that writes it,
  fails), types that keep tilt and shift (a type
  that erases it, fails), normalisation of a file, `o1.rsb` round trip
  byte for byte with `rt`, field of the output frame and not of the
  viewer's image (fails), mask, texture and rings with their amplitude
  (amplitude ignored, fails), PNG decoder and 2 × 2 average pixel by pixel
  (Paeth changed or without rounding, fail), the tool and the page with the
  same `LENS` (another field in the tool, fails), thumbnails up to date (a
  value of `bokeh.json` changed, fails), U2 projects without optics and
  byte for byte equal, optics normalised on opening (unnormalised, fails),
  and with the real `rt.wasm` the O1 *hash* and the thumbnail's.

**What did not fit the plan.** (1) The **mask dimension** was not
needed: the mask is sampled with the two lens dimensions (row with the
first, column with the second, the position within the texel with what
is left of each), which preserves stratification better than two *hash*
numbers; the only new dimension is the band. (2) **Chromatic
aberration** is, as decision 3 asks, one band per sample with
radial displacement of its origin in the pupil; so that what is in focus stays
sharp the focus plane is the same in the three bands, so the
fringes (green edge and magenta core) come out the same in front of and behind the focus:
the colour inversion between in front and behind arrives with the traced lens (O2).
The coefficients (`CA_SCALE`, `CA_SHIFT`) and those of the swirl
(`SWIRL_*`) are proposals for the verdict. (3) **The cat's eye
darkens** the corners (the clipped sample weighs black): it is the optical
vignetting that accompanies it in a real lens; if it is preferred without it, a
sampling of the intersection would be needed that is not exact for polygons or masks.
(4) The **amplitude** `onionAmplitude` scales only the onion-ring
texture (`1 − a + a·t`); the other textures (dust, stripes, mesh) are applied
as they are: with amplitude 0 they would not be seen. (5) The **anamorphic streaks**
(`streaks`) belong to the *flare* pass and are stored without being drawn; the *split
diopter* of STUDIO-TOOLS §1 was not in the phase. (6) So that the sheet comes out at
256 samples without salt-and-pepper noise, each light measures a fifth of the blur disc:
the kernel comes out convolved with that disc (polygon corners somewhat rounded, fine textures
smoothed). (7) The Fast viewer
shows the **shift** (it changes the framing, and the viewer is the
render); the tilt, like depth of field, only in Full.
(8) **Cost**, measured with the machine heavily loaded by other agents: the
camera sample of the lens with all the controls (`example::busy_lens`:
texture, swirl, chromatic aberration, cat's eye, anamorphic,
tilt and shift) costs 0.4 to 0.6 µs more than that of the thin
lens (bench of 786,000 camera samples, three rounds: 0.48–0.85 µs
against 0.88–1.07 µs), against about 26 µs per sample of the example at
512 × 384 with 8 threads: on the order of 2 %. The example's wall-clock time
with and without the lens (three alternating pairs: 34.0–58.1 s without it, 41.1–72.8 s
with it) does not separate that difference from the load noise; the lens also changes
the framing (shift and tilt) and with it the rays that
are traced (35.2 M against 33.6 M).

## O2 · Traced lens — **Opus** (after O1), verdict **Fable** — done

**What.** `STUDIO-TOOLS.md` §1 mode 2, from the paper of Kolb,
Mitchell and Hanrahan (1995) and `docs/research/optics.md` §3, §5 and §6:
sequential tracing from the sensor through the surfaces of a
prescription from `src/data/lenses.json` (sphere, plane, aspheric,
cylindrical, mirror, aperture) with the stable intersection of §6.5
(`t = c r² / (B + sqrt(B² − c² r²))`), only `+ − × ÷ sqrt` (no
`sin`, `exp` or `powf` in the trace: determinism across platforms),
uniform scaling to the requested focal length, iris with blades, *coatings* as
per-surface transmission (decision 5: T-stop and tint, no
ghosts), `unit`, `internal` and `floating` focus modes according to the
prescription, exit-pupil limits precomputed by image height
(union of the three bands), band-wise chromatic aberration
(decision 3), and what comes out on its own (distortion, vignetting, cat's eye,
bubble and creamy look from spherical aberration, coma, field curvature,
focus breathing). RSB: `LENS` grows with the prescription (optional fields
at the end; O1's RSB can still be read). **Physical outputs
to the inspector, computed by the engine and never invented** (rule 10):
effective focal length, flange distance, f/, T-stop, distortion curve and relative illumination
by image height; `rt_wasm` exports them and the launcher
serves them (`/api/lens/info`); the interface shows them in the
*Camera* ▸ *Lens* section. **Lens editor**: selector by *character*,
family, focal length, f/, blades, *coating*, focus, *tilt-shift*; *Advanced*:
the artistic controls of §5 marked *not physical* (amount of chromatic
aberration, distortion, vignetting, swirl, spherical character,
breathing); **SVG cross-section of the lens** drawn from the
prescription; *Save lens as…* to the own library (U4). The bokeh
types that require a traced lens are enabled in O1's selector.
**Fast profile** (decision 4): on loading the lens the engine derives
cardinal points, distortion and relative illumination (`f32` tables), and the Fast
viewer applies distortion and vignetting as an approximation (stated in the
help). Changing lens never touches the output resolution.

**Depends on.** O1, A6.

**Acceptance.** Paraxial focal length and flange distance of the 16 lenses within
0.05 % of `reported` (test, like `tests/lenses.test.ts` but in Rust);
axial rays of the double Gauss come out parallel to < 2e-4 slope;
f32 against reference f64 (test with `f64` only in the test) below
1e-4 mm; wasm parity and determinism 1/4/16 threads; cost of
the traced camera ≤ 25 % of the example's render with the double Gauss at
1024 samples (measured); sheet `out/lens-sheet.html`: the jar with the
16 lenses at maximum f/ and at f/8, and the scene of points of light with those that
give cat's eye, bubble, creamy and swirl, **with Fable's
verdict**; captures `docs/ui/lens-editor.png` and `docs/ui/lens-section.png`.

**Done.**

- **Engine** (`rt-core/src/optics/traced.rs` and `paraxial.rs`). The
  prescription goes at the end of `LENS`, after O3a's filter
  gaps (which are then always written); a `LENS` without it is O1's
  byte for byte. Surfaces sphere, plane, even aspheric, cylinder (x or
  y axis), mirror (the unfolded sequence of the catadioptric) and the aperture;
  the stable intersection of §6.5, normal without root, Newton on
  aspherics, vector Snell, only `+ − × ÷ sqrt`. On reading the scene (and
  every time focal length, f/, focus or sensor change; if only the camera is
  moved it is reused) the lens is **scaled** to the requested paraxial focal length,
  takes the indices of the **three bands** (two-term Cauchy from
  `nd` and `vd`; non-physical chromatic aberration multiplies the dispersion)
  and the **transmission** of each air–glass surface by its treatment
  (T-stop and tint, no ghosts), and is **focused**: unit, internal
  (bisection over the gaps), floating (the gaps follow the magnification) and,
  new, **anamorphic** (`FOCUS_ANAMORPHIC`: the adapter in front of a
  lens that focuses as a unit; its widest gap, between the
  cylinders, travels up to 60 % to bring the compressed meridian to the
  same focus; the image is un-stretched by the compression that it traces at that
  focus: 2.00 at infinity, 1.96 at 3 m, 1.72 at the jar's distance). The
  camera is placed at the paraxial entrance pupil at infinity (the thin
  lens's perspective); the aperture gives the requested f/, never wider
  than the lens, and opens to the fastest declared f/ even if
  the source gives its diameter for another (the triplet, f/4 in the patent and
  f/3.7 in the catalogue). The semi-apertures the source does not give come from a
  paraxial marginal ray and a principal one and are **widened with real
  rays** of the frame in both meridians (on a wide angle the paraxial
  principal fell short and clipped the corners: the fast double
  Gauss went from 0.79 to 0.88 of light in the corner of a 50 mm at
  f/1.4). Exit-pupil limits at 32 heights (24 × 24 grid
  at the rear vertex, three bands, one cell of margin) and the
  irradiance at 40 × 40 for the normaliser and the relative illumination.
  Each sample: a band (decision 3; the three of a group share the
  pupil point), a point of the rectangle, the trace with rims and
  iris and the weight `A cos⁴θ / Z²` over that of the axis times the tint; a sample
  that the lens stops weighs black and keeps its own unclipped ray for
  the coverage (before, the principal ray was traced again). Exact iris
  shortcuts (inside the inscribed circle it passes, outside the
  circumscribed one it does not; a test compares 160,000 points with the exact edge in
  five irises) and precomputed index ratios: the same bits. The
  **non-physical** settings (distortion, vignetting, spherical as a plate at the
  aperture, breathing, swirl, chromatic aberration) are applied
  on top; the passes' central rays use the same sensor point
  as the samples.
- **What the engine says** (`LensInfo`, `rt_scene_lens_info` of `rt_wasm`,
  `POST /api/lens/info` of the launcher): focal length at infinity and at the focus, the
  **image scale** near the axis (with breathing: at close focus
  the lens frames less), flange distance, f/ in use and the fastest, T-stop,
  transmission per band, length, entrance pupil, elements and groups,
  an anamorphic's compression, the **distortion** against that scale and the
  **relative illumination** at 17 heights of the output frame, and the
  **cross-section** (each surface as traced, focused, with its semi-aperture;
  the iris in use and the sensor).
- Pinned *hash* of the O2 scene (`example::o2_scene`: the example at f/2.8
  through the catalogue's double Gauss with seven curved blades and O1's background
  lights, `tests/fixtures/o2.rsb`, 10,008 bytes):
  `PINNED_O2_TRACED_4SPP` = `0x8f7d0ef8` (was `0xe2e8e3ab`; moved by the
  merge with E9, like O1's and O3a's; E6 did not move it) in scalar, SSE2 and AVX2,
  in WASI, in the real `rt_wasm.wasm` (in CI, after E6), by the
  page's code and with 1, 4 and 16 threads. No other *hash* moved.
- **The catalogue as the engine traces it** (`rt-cli/src/lens_catalogue.rs`,
  `rt --write-lens-catalogue`, `tests/fixtures/lens-catalogue.json`): the
  same composition as the page (the adapter in front of the double Gauss,
  scaled to clear its front, its focus gap); the page
  writes the same bytes for the 16 lenses (test).
- **Interface.** `CameraOptics.traced` (`src/core/traced-lens.ts`: the catalogue
  key and what was changed; earlier optics do not have it and
  do not change by a byte). *Camera ▸ **Lens*** (`insp-traced.ts`, the
  lens editor): *Simple lens · Traced lens*; *Character* in chips and
  *Mine*; *Lens*; the source (patent or book and what was checked); *Lens
  behind* (adapter), *Coating*, the soft lens's variable gap
  and *Normal*, *Blades* and the aperture travel; the numbers, the two
  curves and the engine's **SVG cross-section** (`ui/components/lens-section.ts`);
  *Advanced* under **NOT PHYSICAL**; **Save lens as…** to the own
  library (new `lens` type, with its validation on import). The three
  traced-lens bokeh types can now be chosen, with their thumbnail
  rendered by `rt` with their lens (`tools/bokeh-thumbs.mjs`). With a traced
  lens, *Advanced optics* switches off the thin lens's profile, cat's eye,
  compression and tilt with a note, and the thin lens's
  compression no longer stretches the image of a traced lens
  (the engine does not apply it either). The Fast viewer applies the engine's scale,
  distortion and vignetting (`render/lens-profile.ts`) and the
  meter says *Traced lens: distortion and falloff approximated, the render
  traces it*. `tools/lens-check.mjs` (local Chromium, 13 checks)
  leaves `docs/ui/lens-editor.png` and `docs/ui/lens-section.png`.
- **Clicking through the profile** (triage item 1.8). The Fast viewer
  draws distortion as a screen pass and `pick` cast the undistorted
  ray: with a wide angle or the fisheye, click-to-focus, selection, the box and the *gizmo*
  did not land on what was under the cursor.
  Now the map from screen to undistorted image is in one place
  in `render/lens-profile.ts`, in TypeScript and in GLSL side by side
  with the same numbers (`profileSource`, `PROFILE_GLSL`,
  `profileUniforms`): through it the screen pass draws, the selection
  outline (the mask is read through the map: the line surrounds the part as it is
  drawn) and the overlays (*gizmo*, glyphs, paths; in *Full*,
  the selected faces), and it is inverted by the pick (click-to-focus and
  selection), the *gizmo*, the glyphs, `objectAt` (by `profileShown`, the
  reverse map by bisection), box selection
  (`Projection.shown`) and the faces' id pass. Without a profile (thin
  lens, or before the engine gives its numbers) it is the identity. The table
  is now read between its entries (the pass read the nearest: a step,
  a ring, at each one), and the profile is that of the camera being looked
  through (when looking through another camera or a light, L4, the active one's
  was applied). The *Focus with a click* logic that undoes the orbit's `end`
  (`main.ts`, `core/view-objects.ts`) belongs to B1 and has not been touched.
- **Sheet** `out/lens-sheet.html` (`rt --lens-sheet out/lens-sheet`,
  `node tools/lens-sheet.mjs --reuse`), 400 × 300: per lens the jar
  open and at f/8 (96 samples), the points of light open and with the thin
  lens at the same f/ (480 samples, with close-ups of the centre light
  and of the corner), a chart of focused lights on a rectilinear grid at
  its own field (96 samples), the cross-section, the numbers, the curves and the
  cost; at the top the reference thin lens and the cost table
  (`rt --lens-cost`, `out/lens-sheet/cost.json`).
- **Batches** (the brief's cost rule, §6.1 of the report). In the
  first delivery the traced camera was 29.1 % of the example's render
  with the double Gauss at 1024 samples (0.71 µs per camera sample), above
  25 %: now the tile traces through the lens, row by row, the
  samples of pixels that take a single one in **batches of eight**
  (`optics::traced::batch`: the eight at once, surface by surface, in
  the form of a structure of *arrays*, each lane with the same operations and
  in the same order as a single one, so the same bits; E11's edge pixels
  and a lens with aspherics, one by one), with the camera base
  once per batch. The trace alone goes from 0.60 to 0.14 µs per
  sample; no *hash* moves (`PINNED_O2_TRACED_4SPP` stays at
  `0x8f7d0ef8`, on each SIMD path, in the real `rt_wasm.wasm` and with 1, 4 and
  16 threads).
- **Cost** (`rt --lens-cost`, one thread, the fastest of three rounds of
  each measurement, `out/lens-sheet/cost.json`):

  | Scene | Camera | Camera sample | Share of the render | Render |
  | --- | --- | --- | --- | --- |
  | Example, 64 × 48, 1024 spp | Double Gauss, before the batches | 0.71 µs | **29.1 %** | 7.7 s |
  | Example, 64 × 48, 1024 spp | Double Gauss, in batches | 0.25 µs (0.71 one by one) | **13.7 %** | 5.7 s |
  | Example, 64 × 48, 1024 spp | Thin lens | 0.19 µs | 10.6 % | 5.6 s |
  | Jar, 96 × 72, 256 spp | Double Gauss, in batches | 0.26 µs (0.68 one by one) | 12.9 % | 3.6 s |
  | Jar, 96 × 72, 256 spp | Thin lens | 0.19 µs | 10.1 % | 3.4 s |

  What the traced lens adds over the thin lens's camera is now
  3 % of the example's render. With the machine loaded the individual rounds
  vary (from 12.4 to 23.5 % in three single-round measurements); the fastest of
  three is the one that counts. Per lens, in batches (one round on the points
  scene), the camera sample goes from 0.21 µs (four elements with
  rear doublet) and 0.22 µs (meniscus) to 0.43 µs (fisheye, 17
  surfaces) and 0.51 µs (fast asymmetric); the thin lens's, 0.16 µs.
- **Tests** (each checked by reintroducing the error where it fixes
  one). rt-core `optics::traced_tests`: paraxial focal length and flange distance of the 15
  lenses that form an image within the report's tolerance; axial rays of
  the double Gauss parallel to < 2e-4; f32 against f64 < 1e-4 mm; each lens
  at 50 mm with its cross-section, semi-apertures, iris inside the aperture (without
  opening the aperture to the declared f/, it fails with the triplet) and profile;
  unit, internal and floating focus; distortion of the double Gauss < 2.5 % at
  infinity, 3 m and 0.5 m (against the focal length at the focus it gave +15.7 %, fails);
  distortion −1 that gives barrel (with the earlier sign, pincushion, fails) and
  central rays that follow the samples with it (the earlier central ray,
  at 0.045 rad, fails); the fast double Gauss with 0.85 of light in the
  corner (without widening the rims, 0.79, fails); the thin
  lens's compression that does not change a traced lens's ray (fails without
  the fix); the iris shortcuts. rt-cli: the catalogue and its file up to date,
  the anamorphic focus with both meridians at the focus at 1.5 and 4 m (without moving
  the gap, the horizontal focuses at another distance, fails) and the compression
  2 at infinity; the sheet's cells and the field of its chart; the command
  line; 1/4/16 threads. rt-app: `POST /api/lens/info`. The **batches**:
  each lane of a batch with the bits of the single sample in the 15 lenses
  that form an image, with and without settings and swirl, batches of 1, 3 and 8
  (rt-core), the adapter's cylinders (rt-cli) and the tile
  rows, also with filters and a row that is not a multiple of eight,
  against `camera_sample_filtered` pixel by pixel (rt-core).
  `tests/traced-lens.test.ts` (14): a project's lens, the bokeh
  types that set it, the composition (coating, variable gap,
  adapter and its focus gap, on another lens its focus), the viewer's
  profile with the engine's scale and not its focal length, the engine's
  information (and what is not), `o2.rsb` byte for byte, the page's prescription
  equal to `rt`'s for the 16 lenses, the settings, the adapter's compression
  and not the thin lens's, with the real `rt.wasm` the O2 *hash*
  and the 16 lenses prepared with their scale, their cross-section and the adapter's compression, the lens
  library (round trip through the file, an unknown key rejected), the SVG
  cross-section and the profile map (the identity without a profile, the table's
  entries, no steps between them
  —with the nearest entry, it fails— and round trip).
  `tests/optics.test.ts`: the traced lens's types set their lens and their
  thumbnails are up to date with the tool's scene.
  `tests/box-select.test.ts`: parts and faces where `shown` puts them.
  `tests/lens-pick-browser.test.ts` (Chromium with SwiftShader, the real
  preview): a wall of plates in three colours at 24 mm through a
  −20 % barrel and the catalogue's fisheye as the real `rt.wasm` states it;
  the canvas is read and each pixel of safe colour is picked (about 32,000):
  none gives a part other than the one drawn, and about 5,000 show another than the
  undistorted image (with the earlier ray, 4,022 failures); the thin
  lens, without numbers and the view through another camera, the identity (with
  the active camera's profile, 5,010 pixels moved); the outline within two
  pixels of the part's drawn edge (without the map, 13 %); the box
  around the drawn part takes it (without `shown`, not); the ids pass
  finds its faces (without the map, none); and the *gizmo* gives its handle at
  95 % of the pixels it paints, as without a profile (drawn straight or picked
  without the map, 70 to 79 %).

**What did not fit the plan.** (1) **Cost**: in the first delivery the traced
camera exceeded 25 % (29.1 %); the brief's rule asked for batches before
closing and they were made (above): 13.7 %. The batches are of eight samples in
*arrays* that the compiler vectorises by itself (what §6.1 measured), not with the
types of the `simd` module, which have no square root; the same bits on
each platform because each lane does the IEEE operations of a single
sample. The measurement takes the fastest of three rounds because a single
round, with the shared machine, varies a lot. (2) **Noise**: with one band per
sample (decision 3) each channel receives a third of the samples, and the
rectangle around the exit pupil loses 33 to 40 % of them
(the round aperture inside its box plus a cell of margin): at equal
samples the bokeh has about five times the variance of the thin
lens's, and the sheet renders the points at 480 samples so that they read.
Sampling the cells that pass (a mask grid per height instead
of the rectangle) would remove almost all of the second; it is proposed. (3) The
**tilt** is not traced (the traced lens has no rotated lens
plane): it is switched off with a note (*coming soon*); shift does
work. The mask and the pupil textures belong to the thin lens. (4) The
**lens editor** (O5 in the table, for Sonnet) came in O2's brief
and is done here; focal length, f/ and focus are the usual camera
fields, and shift stays in *Advanced optics*. (5) A **lens of one's
own** stores the catalogue key (stable) and its settings, not a copy
of the surfaces, like the project. (6) **Anamorphic**: the image
keeps O1's projection (the lens's field, with half the sensor
width), the compression changes with focus, the viewer's profile is that
of the vertical meridian and the pupil limits assume rotational symmetry
(those of the lens, which the adapter clips from inside). (7) The
**distortion** is now measured against the image scale near the axis: the
earlier measurement, against the focal length at the focus, read breathing at close focus
as distortion. The **non-physical distortion** had the sign
reversed from what its documentation said (negative gave pincushion) and the passes' central
rays did not follow it: fixed with their test. (8) The
focal lengths of the sheet's charts (those of the source's field; 50 mm or
135 mm on the tele lenses when it gives none; the fisheye at 18 mm) are
a choice made for the sheet. (9) The thumbnail of *Breathing* is that
of the telephoto at f/5.6: breathing is not seen in a still kernel. (10)
A stopped sample now gives the coverage of its own unclipped ray instead of
that of the principal ray (the colour does not change by a bit; the alpha of a
transparent background, slightly). (11) **Decisions for the verdict**
(rule 11), pending: the sheet, lens by lens (what they give in cat's eye,
bubble, creamy and swirl, and whether the assumed prescriptions and apertures, the
`stopBasis: assumed`, stay); the bands' noise and
the cell-sampling proposal of (2); the adapter's constants
(`ADAPTER_GAP_MM` 5, `ADAPTER_CLEARANCE` 2.2, `ADAPTER_FOCUS_TRAVEL` 0.6);
and the focal lengths of the sheet's charts in (8). (12) **Clicking through
the profile** arrived after the delivery, from the triage (1.8). The map holds in both
modes: in *Full* the image is the engine's and the profile approximates it with
its own tables, as in *Fast*. The overlays are drawn to a target
and from there to the canvas through the map: with SwiftShader at 800 × 600 the
*gizmo* costs on the order of 30 to 60 ms more per frame with a traced lens
(on a GPU, negligible), and its lines, of fixed thickness in
pixels, thin out where the profile shrinks the image. The screen pass
holds the image's edge where the source falls outside it (a strong barrel
at the corners of a wide angle): the pick casts through that edge,
what is seen; drawing a wider field so as not to stretch the edge is
proposed.

## O2b · Lens window on hover — **Sonnet** — done

**What.** Request 1.4 of the owner's bug report (`TRIAGE.md`:
“when hovering over the lens, a window showing the
elements must appear”), after O2: leaving the pointer (or keyboard focus) on a
lens in the *Lens* list or on a *character* chip opens beside it a
small window with that lens's **cross-section** (the element, the aperture, the
image plane), its **name**, its **source** (the patent or the book, as in the
section) and its **numbers** (focal length, aperture, elements and groups, length),
all those the **engine** gives for that lens. For a lens that is not on
the camera there is no `LensInfo`: the engine is asked about the lens pointed at
(`rt_scene_lens_info` of the page's `rt.wasm`, or `/api/lens/info` of the
launcher), without blocking anything, with a cache per lens and per what the numbers
depend on (focal length, focus distance, f/, framing, lens settings);
while it arrives it says so, and without an engine (the web version without `rt.wasm`) it says that the
engine is not loaded and leaves only the name and the source (rule 10).

**Depends on.** O2.

**Acceptance.** Tests that fail without the feature: resting opens the window with
the data of the lens pointed at (with a fake lens port that counts its
questions), the cache (passing twice over the same lens asks the
engine once), the *asking* and *no engine* states, and closing on moving the
pointer away, with Esc and on choosing; keyboard focus opens it. A browser
check (`tools/lens-hover-check.mjs`, like `tools/lens-check.mjs`) that
passes over two lenses in the real interface with the real `rt.wasm` and leaves
`docs/ui/lens-hover.png` (and `lens-hover-dark.png`). Strings in `es` and `en`;
achromatic chrome; neither the lens catalogue, nor the prescriptions, nor the
engine's optics change (rule 11).

**Done.**

- **The logic, without DOM** (`src/ui/lens-peek.ts`): `peekCamera` (the camera
  as is, with the lens pointed at set as it would leave it when chosen: its own
  settings, none of the person's; the lens in place is asked about with its own),
  `lensPeekCache` (a cache per port, up to 48 answers; the key is what
  the engine reads: the camera's `optics` with its lens, the focal length, the f/, the
  focus, the framing and the projection; a question in flight is shared; what
  the engine said and its refusal are stored, not “no engine” or a failure, so
  that a lens is asked about again when the engine arrives),
  `createPeekController` (the 300 ms rest with injectable timers:
  crossing the list opens nothing, leaving or moving to another entry closes, and a
  window closed with Esc or on choosing does not reopen until the pointer or
  focus returns) and `peekCard` (what a card says: only the engine's; without an
  answer, *Asking the engine…*; without an engine, the name and the source and *The
  engine is not loaded…*; refused, *The engine forms no image…*). The source of
  a lens in one line (`lensSourceLine`) and the section's half sensor
  (`sensorHalf`) come from `insp-traced.ts` and are shared with the section.
- **The window** (`src/ui/components/lens-peek.ts`): a `role="tooltip"` beside
  the list and at the entry's height (beside the inspector, for the chips),
  on the side with room, always inside the browser window (a
  maximum size; on a short screen it clips); it draws with `lensSectionSvg`
  of `components/lens-section.ts`, the single drawing of a lens; it **takes neither
  focus nor the pointer** (`pointer-events: none`, there is nothing to
  focus), is linked to the entry with `aria-describedby`, closes with Esc
  (which does nothing else) and when the entry is pressed. A chip opens the window
  of the lenses of its character (up to four, in two columns, with the character's
  name); each card arrives when its answer arrives. Focus opens
  only if it is keyboard focus (`:focus-visible`: focus given by a click opens
  nothing); touch, nothing.
- **The *Lens* list is the interface's own** (`src/ui/components/pick-menu.ts`):
  the same frame and the same arrow as a `select`, which opens the menu of
  `widgets.ts` (arrows, Enter, Esc; the lens in place, marked and with focus).
- **Wiring** (`src/ui/panels/insp-traced.ts`): the chips are built once (they
  are no longer rebuilt when pressed: focus stays on the chip) and each one, and each
  entry of the open list, opens its window; the *What the engine computes* section
  asks through the cache, so the lens in place is a single question
  for the section and for the window. New strings: `camera.lensPeekNoEngine`
  and `camera.lensPeekLabel` (the rest are the section's).
- **Tests.** `tests/lens-peek.test.ts` (20, Node): the camera that is
  asked about, the cache (one question per lens, the shared one, the one that changes with
  the focal length, the focus, the f/, the framing, the settings, the refusal that is stored,
  “no engine” and the failure that are not, the limit), the controller with hand
  timers, the cards (with different data per lens, *asking*, no engine,
  refused, in Spanish), the placement inside the window and, with the real
  `rt.wasm`, the numbers of four lenses that are not on the camera against the
  engine's. `tests/lens-peek-browser.test.ts` (14, Chromium): the real section
  with a fake port that counts, holds, refuses or is missing: it opens beside the list
  and beside the chip after the rest, not before, with that lens's name, source, drawing
  and numbers; one question per lens; the one that is awaited, the no-engine one
  and the refused one; leaving, Esc (also with the list open) and choosing
  close it; the keyboard opens it and moves it from lens to lens; it takes neither focus nor
  pointer; inside a small screen; in Spanish.
  `tools/lens-hover-check.mjs` with the built application and the real `rt.wasm`:
  the window's numbers are those of the section on setting that lens (6 · 4 the
  double Gauss, 5 · 3 the symmetric five), passing again asks nothing of the
  module (counted by wrapping `rt_scene_load`), and the captures
  `docs/ui/lens-hover.png`, `lens-hover-dark.png` and `lens-hover-chip.png`.
  `tools/lens-check.mjs` chooses the lens in the new list. Checked by hand
  that the tests fail without the feature, removing one at a time: hooking it to
  the entries, the cache (and, separately, its memory), the 300 ms rest, Esc,
  closing on leaving, keyboard focus, the *asking* card (said as
  no engine), the “no engine” that shows a number, the window that takes the
  pointer and the wrong camera (the lens in place's for all); closing on
  choosing goes by three paths (the list closing, the entry being pressed
  and the list being redrawn) and fails on removing all three.

**What did not fit the plan.** (1) **The list could not be a `select`**: the
browser draws the entries of a native dropdown and the page receives
nothing until one is chosen (no `mouseover` or focus), so “hovering
over an entry of the dropdown” does not exist; the *Lens* list becomes
the interface's own (`pick-menu.ts`). How the open menu looks changes (the interface's,
not the system's) and it has no search by initial letter; the closed one
is the same. (2) **A chip is a character, not a lens**: the brief said “the
window with the cross-section of that lens”; a chip has between one and four lenses,
so its window shows all those of the character, each with its card (with
a single one, it is the same as an entry's). *Mine* opens no window and the
own-lens rows neither (their lens comes from a stored setting: left for
whoever edits lenses, 1.5). (3) The numbers are the three in the brief plus the
*length* (what most separates one lens from another, with the focal length already scaled to
the camera's) and, for the anamorphic adapter, the compression. (4) **The engine and
orthographic**: with an orthographic camera the engine does not trace the lens and the
port answers that there is no lens; the window then says that the engine
is not loaded, as the section already does with its notice (saying something else would be left
to that notice). (5) **The desktop** asks through `/api/lens/info` with the
same port (`services.lens`) as the section, which was not touched: what was checked
is the page's module with the real `rt.wasm`; it was not tested against the
launcher. (6) On very short screens the window of a character with four
lenses (about 550 px) is clipped instead of moving or shrinking; with less than
1,100 px of width the inspector folds and the window passes over its column.
(7) The rest is always 300 ms, without a “warm-up” that shortens it between neighbouring
entries: leaving closes and entering waits again.

## O2c · Lens element editor — **Opus** — done

**Request from the owner** (`TODO.md` §1.5, verbatim, translated): “A lens editor
where, besides the current options, one can: edit the elements,
change the size or distances between each element, add a new one, rotate it
180°.” Decided in *Judgement calls*, 1.5: yes, over O2's own
lens.

**What.** From *Camera ▸ Lens ▸ Traced lens*, a **lens editor** (a
window like the material editor) over a **copy** of the lens: the
catalogue's is never edited, editing makes a lens of one's own. It shows the engine's
**cross-section** (`components/lens-section.ts`) and the **list of elements**; per
element, its radii, thickness, glass (from the existing list) and clear aperture,
its **size**, the **air** to the next one, **add** a singlet wherever
chosen, **delete** and **rotate 180°** (swaps and negates the radii). Each
edit is an undo entry; a drag, one gesture. After each edit
the engine checks the prescription and the numbers are brought up to date (focal length,
flange distance, f/, image circle, the curves the application already shows); an
invalid lens says why, is not applied and can still be edited; never
a failure or a NaN. It is saved as an own lens in the project and in the
library, with O2's mechanisms, renamed, and round-trips.

**Depends on.** O2, O2b, O4, F1.

**Acceptance.** Tests of the effect of each operation on the prescription, with what is
physically correct (rotating a biconvex changes nothing; an asymmetric one
keeps the focal length and changes the flange distance and the aberrations); undo; the
invalid lens; persistence; a browser test (vitest and playwright-core,
skipped without Chromium) that opens the editor, adds an element, rotates one and sees
the focal length change and the cross-section redraw, with nothing clipped. Two captures.

**Done.**

- **The model** (`src/core/lens-edit.ts`, no DOM). `TracedLens.edited`
  (optional) stores the **edited prescription** at the design scale (the
  surfaces with the conventions of `lenses.json`), its **name** and its
  **focus**; `composeLens` sends it to the engine instead of the catalogue's, and the
  `key` still says which lens it came from (its aperture, its source). Without
  `edited`, nothing changes by a byte. `startEdit` copies what the engine traces
  of the lens now (with the person's coating and variable gap).
  The list (`lensRows`): each glass element between its front
  and rear surface, cemented ones marked, and the aperture. The
  operations, a prescription in and another out: `setElement` (radii
  —`0` or `∞` is a plane—, thickness, glass, diameter: the two semi-apertures
  scaled so that the larger is half of it, `null` returns to automatic),
  `scaleElement` (smaller, larger: the aperture by the factor, the
  automatic one from the engine's), `setGapAfter`, `insertElement`,
  `deleteElement` (a singlet in air leaves the rest where it was; in a
  cemented group, the others stay cemented), `rotateElement` (the
  surfaces in reverse order with negated radii, the glasses and
  thicknesses reversed, coatings and apertures with their surface; a cemented group
  rotates whole; the air in front and behind, the same) and
  `renameEdited`. **The new element** (`defaultSinglet`,
  `insertionAperture`): a weak biconvex of the glass of the catalogue's simple lens,
  radii ±4 f and thickness 4 % of f (between 1 and 12 mm), f the design's focal length,
  as wide as the narrowest of its neighbours; in the middle of the gap if
  it fits with 1 % of f of air on each side **also at the edges** (otherwise,
  the lens is pushed apart), at 5 % of f in front of the first or behind the last,
  never inside a cemented group, and thick enough for its own
  edge. **The focus**: the gaps that an internal-focus or floating lens moves
  are tracked through the edits (editing one moves its
  travel; adding in front shifts them two surfaces); if an edit removes
  one, the lens focuses by moving whole, and the editor says so. **The glass
  list** (`LENS_GLASSES`): there was none; they are the 66 distinct glasses
  of the catalogue's prescriptions, by index and Abbe number at the d line
  (crown or flint by the line of 50), without manufacturer names.
- **What is wrong** (`structuralProblems`, before asking the engine: nothing is sent
  with a negative gap, which the engine would trace without complaint):
  2 to 64 surfaces, some glass and in air at the end, a single aperture,
  each number a number, positive glass thickness, non-negative air, a given
  aperture no wider than its sphere, and with the **given** apertures,
  the two surfaces of an element that cross within it (the edge)
  or two elements that collide; from the engine (`refusalProblem`, `engineProblems`):
  no real image or afocal, no light along the axis, the image inside the lens;
  and another reason, in its words. Each problem says where (*Element 3*).
- **The engine** (`rt-core/src/optics/traced.rs`): `LensInfo.design_efl_mm`,
  `"designEflMm"` in the JSON of `rt_scene_lens_info` and of
  `/api/lens/info`: the prescription's paraxial focal length as it is
  written (in its green band), before scaling it to the camera's. Without
  it, the focal length the engine gives is always the camera's and adding an
  element would change no focal length number. No render change: **no pinned
  *hash* moves**. The rejection reason already came out through
  `rt_scene_error_copy` and the launcher's error JSON:
  `render/lens-info.ts readLensVerdict` and `LensPort.check` carry it to the
  editor (`main.ts`, with the page or the launcher, and a module trap is
  “no engine”, never a failure).
- **The copy and its commands** (`src/ui/lens-edit-commands.ts`).
  `CameraState.lensDraft` (optional, saved with the project): the first
  edit copies the camera's lens, with its name and *(edited)*; each
  edit is `camera/set` with the copy, one entry (*Lens editor: rotate
  an element 180°*…), or one per gesture; one that changes no number
  records nothing. **Apply** puts the copy on the camera (one entry) and only if
  it is the lens the engine checked (the window passes it; another is
  rejected); **Discard**, one entry; **Save to library…** with
  `saveLensToLibrary` (which accepts the lens to save).
- **The window** (`src/ui/panels/lens-editor.ts`, `lens-editor.css`, `UI.md`
  §2.11): bar with the name (a field), *Discard changes*, *Save to
  library…* and *Apply to the camera*; the engine's cross-section with the number of
  each element and the chosen one darker (`lensSectionSvg` with `highlight` and
  `labels`; a click on an element chooses it; dimmed when it is not that of the
  lens in place); the chosen one's tools; the table of fields (the list
  is rebuilt only when its shape changes, so a drag does not lose its field);
  on the right, whether it can be applied or why not, and what the engine computes:
  *Focal length of the design* (and the camera's), *Back focus*, *Aperture*, *Elements ·
  groups*, *Length*, *Image circle* (from the light towards the engine's
  corner: how far it reaches and whether it covers the frame) and the
  distortion and light curves. It asks the engine 40 ms after the last edit and
  counts only the last one's answer. *Camera ▸ Lens*: **Edit
  elements…** (switched off and saying why with the adapter and the mirror
  lens), *Edited lens: name* and the notice of an unapplied edit;
  choosing a lens from the list puts the catalogue's back; no variable
  gap for an edited lens; its cross-section and numbers are asked of the
  engine without O2b's cache, and the list window (O2b) shows the catalogue's
  for the lens an edited one came from.
- **Persistence.** The project carries `edited` and `lensDraft` and they come back the same
  (`io/project.ts` reads the copy; an `edited` that cannot be read opens the catalogue
  lens, a copy that cannot be read is discarded); the library carries the
  edited lens in `LensPayload.traced` and rejects an item whose `edited`
  cannot be read (never a catalogue lens silently put in its place).
- **Tests.** `tests/lens-edit.test.ts` (20): the list and the copy (each lens
  of the catalogue that is edited, with nothing wrong; the adapter and the mirror one, not);
  rotating (radii swapped and negated, twice is the lens, a plane is
  a plane, the biconvex is itself, the doublet rotates whole, the
  aperture does not rotate); radii, thickness, glass, diameter with its proportion,
  size with the engine's aperture, what is not a number changes nothing;
  the air and only it; adding in the middle of a wide gap (the rear vertices
  where they were), in a narrow one (the lens grows), in front, behind,
  never inside a cemented one; **adding at every place of four lenses without
  colliding at the edges**; deleting (a singlet, the crown and the flint of a
  doublet); internal focus tracked and lost; what is wrong and where, and
  the engine's words; with the real `rt.wasm`, the **design focal length** of
  the 14 lenses against the report's and its scale, the **rotation of a
  biconvex** (same focal length, flange distance and distortion), of a **plano-convex**
  (the same focal length to 1e-4, the flange distance moved t/n —the rear principal plane
  passes from one vertex to the other— and another distortion), of the achromat
  (same focal length, another flange distance), **adding at every place of the 14 lenses** (the
  engine traces it, one more element), adding shortens the focal length and deleting
  restores it, and the rejection without real image or afocal with its reason; the copy in
  the *store* (the first edit makes it, one entry per edit or gesture,
  nothing without change, undo down to no copy, the catalogue intact; apply
  only the checked one, in one entry, with undo; discard; without a traced
  lens or with the mirror one it does not open); the project round trip (with
  the copy; earlier ones, byte for byte; damaged ones, to the catalogue lens and no
  copy) and the library (renamed, round trip, the damaged one
  rejected); the cross-section with the chosen one and the numbers, and the list
  window. `tests/lens-editor-browser.test.ts` (3, Chromium and the page's real
  `rt.wasm`): opens the editor, **adds an element** (eight rows, the
  design focal length shorter, seven glasses in the cross-section, the new one chosen),
  **rotates the first** (another system focal length and another flange distance, another cross-section), two
  undo entries and back, the camera's lens intact until
  applied; a negative gap typed (*Element 1*, unapplied, the cross-section
  dimmed), corrected and checked; a radius that leaves the lens without an image
  (the engine's reason); apply; and **nothing clipped** in English and Spanish
  in a smaller window. rt-core
  `the_lens_information_tells_the_focal_length_of_the_design_before_the_scale`.
  `tools/lens-editor-check.mjs` (five checks on the application
  built with the real `rt.wasm`) leaves `o2c-lens-editor.png` and
  `o2c-lens-modified.png`.

**What did not fit the plan.** (1) **O2 did not store the prescription.** Decision
1.5 says “over the lens of one's own that O2 already stores”, but O2 (its point
5) stored the catalogue key and the settings, not the surfaces. O2c adds
`TracedLens.edited` (optional, only on an edited lens); `STUDIO-TOOLS` did
speak of storing “the prescription and the settings”. (2) **There was no list of
glasses**: it is that of the glasses of the catalogue's prescriptions. (3) **The
focal length does not change on the camera**: the engine scales every lens to the camera's focal
length (O2), so what changes on adding an element is the **design focal
length**, which the engine needed to state (`designEflMm`, no render).
The list's measures are the design's, and the footer says so. (4) **Size**
is the element's clear aperture (its diameter), not its whole scale. (5) The
copy lives on the camera (`lensDraft`) and travels with the project: this way each
edit is a *store* entry and a bad lens never reaches the
camera. (6) **Rotating a cemented element rotates its group** (rotating one alone
would break the cement). (7) **Lenses that are not edited**: the anamorphic
adapter (cylinders, composed with another lens) and the mirror one (it folds
the light: its negative distances are not gaps). (8) **The edge and the collision** are
checked only with the given apertures: with those the engine computes for the beam
(it widens them with real rays of the frame), several catalogue lenses
would give collisions that do not exist. (9) Without an engine the lens can be edited but is not
applied (it cannot be checked). (10) The window moves but is not
resizable and does not remember where it was (the material editor does). (11) The
aperture travel of an edited lens is still that of the lens it
came from. (12) The list window (O2b) shows the catalogue lens
for the one an edited lens came from, and the camera's section asks the
engine about the edited one without O2b's cache. (13) An image circle smaller than
the frame is stated but does not prevent applying (a circular fisheye is one).
**◆ Decided** in *Judgement calls* (accepted as is): the default new element
(radii ±4 f, thickness 4 % of f, the glass of the catalogue's simple lens, as wide
as the narrowest neighbour, centred in the gap); the margins (1 % of f of air,
5 % in front and behind, 1e-3 mm tolerance at the
edges); the step of *Smaller · Larger* (10 %); the image-circle threshold
(a relative light of 0.001) and whether a circle that does not cover
the frame should prevent applying; and whether an edited lens should keep
the aperture travel of the catalogue lens.

## O3a · Lens effect filters: black, white and gold diffusion, glimmer, net, star, streaks — **Opus** (after O1, before O2), verdict **Fable** — done

Request from the owner (2026-10-14): in the lens, “style” filters (black
diffusion, gold…), not colour recipes. They are the physical filters that are
screwed on in front of the lens: a plate that **scatters** part of the light
that enters, and what differs between them is how much, with what angular
shape and with what colour. They are done in the engine, in ray space, so that they
interact well with the bokeh, the blur and lights outside the
frame, and with an image equivalent for the preview.

**Decisions.**
1. **Physical model, in the pupil.** A camera ray, with probability
   `s` (the filter's grade), is deflected by an angle drawn from the filter's
   **angular PSF**; otherwise it continues straight. Energy: `(1 − s)·I +
   s·a·T·(I ⊗ K)`: `a` is what the particles absorb (1 in
   whites and golds; < 1 in blacks: the halo comes out but the shadows
   rise less, which is why a black filter “keeps the contrast”), `T` the
   tint of the scattered beam (neutral; gold: warm, normalised in
   luminance), `K` the PSF. It happens in O1's pupil sample, so
   the bokeh and the focus come for free and a light outside the frame
   still veils.
2. **Types** (`src/data/lens-filters.ts`, stable keys, generic es/en
   names, **no brand**): `DIFFUSION_WHITE` White diffusion
   (narrow Gaussian + wide Lorentzian tail: halo and low contrast),
   `DIFFUSION_BLACK` Black diffusion (same shape, `a` < 1),
   `DIFFUSION_GOLD` Gold diffusion (diffusion with warm `T`), `GLIMMER`
   Glimmer (fine, sparse tail: small glints around
   lights, through a second narrow lobe whose direction is tied to a
   *hash* of the pupil position), `SOFT` Soft (only the narrow
   Gaussian, high `s`: loses sharpness without halo), `NET` Net (scattering
   concentrated on two axes at 90°, with soft tint), `STAR` Star
   (`points` 4/6/8 straight streaks from the lights, angle `angle`, 1/r
   falloff), `STREAK` Streaks (a single horizontal line, blue tint by
   default, like an anamorphic lens). **Grades** 1/8, 1/4, 1/2, 1, 2
   (list, like real filters) → proposed `s` 0.03 / 0.06 / 0.12 /
   0.22 / 0.38 and proposed widths σ₁ = 0.25°, σ₂ = 2.5° of field; the
   final ones are set with the sheet (rule 11).
3. **Stack** of up to three filters per camera (in practice two are stacked:
   a diffusion and a star), each with type, grade and, depending on
   the type, tint (gold, net, streaks), points and angle (star).
4. **RSB.** `LENS` grows with three filters at the end (`kind u32, grade f32,
   tint[3] f32, angle f32, points u32`, 28 B each; zeros = none,
   *hashes* intact without filters). The PSF is sampled by inverse CDF
   tabulated in `f32` (no `exp`/`log` in the loop; determinism).
5. **Preview.** Image equivalent: `(1 − s)·I + s·a·T·(I ⊗ K)`
   with `K` projected to pixels by the focal length, as a WebGL pass of the Fast
   viewer (separable into two Gaussians + tail by subsampling) and the same
   convolution in TS for the render window; the meter says
   “approximation: the render is done by the engine” (rule 10).
6. **Interface.** Camera ▸ Lens ▸ **Filters**: the stack (add/remove,
   up to three), per filter: type (list with a one-sentence help: what it does
   photographically), grade, and the type's controls. Saved with the
   camera (each camera, its own). es/en strings.

**Depends on.** O1 (the pupil, `LENS`).

**Acceptance.** Tests: white field with white diffusion grade 1 keeps the
mean ± 0.5 %; black diffusion grade 1 stays between 0.90 and 0.97; star 6
gives six streaks (angular histogram of the energy of a point light with
peaks at six angles ± 2°); gold shifts the mean of the scattered beam
towards red; a stack of three with zero grades = no filter bit for bit;
preview against engine in the furnace scene: mean difference
< 2 %; list of *hashes* unchanged with `LENS` without filters; wasm
parity. Sheet `out/lens-filters-sheet.html`: the bottle with a small backlight
inside the frame and another outside, 512 px / 128 spp, each
type at grades 1/4, 1 and 2, and two stacks (black diffusion 1/2 + star 6;
gold 1 + streaks); by eye. Captures `docs/ui/lens-filters.png`.
`UI.md`, `SPEC.md` §3.5, `ARCHITECTURE.md` (`LENS`), CHANGELOG.

**Done.**

- **Engine** (`rt-core/src/optics/filters.rs`). The eight types with their
  `FILTER_*` (1 white diffusion … 8 streaks) and the stack of up to three in
  `LensParams.filters`; `Lens::new` builds each filter that scatters
  (grade > 0) and rejects out-of-range types, grades (0 to 2), negative tints and points
  (4, 6, 8). In `Lens::sample`, after O1's pupil,
  each filter decides with its number whether it scatters the sample (probability
  `s` of the grade, `kind_s`: the table of the diffusions, glimmer and
  net, `GRADES` 1/8 … 2 → `GRADE_S` 0.03 … 0.38, and the star's and
  streaks' own, linear between grades) and deflects it `d + right·δx
  + up·δy` with the weight of its lobe (`Filter::colour_at`: `a` in the
  core and the glints, `a·T` in the streaks and in the diffusion's
  tail), so the image is `(1 − s)·I + s·a·(I ⊗ K_T)` with the
  lens's bokeh and focus and the lights outside the frame. PSF
  by tabulated inverse CDF (256 `f32` values, built on loading
  with `fmath`; in the loop, search, interpolation and the direction with
  `fmath::sin_cos`): diffusion, 0.25° Gaussian (60 % of the scattered)
  and 2D Cauchy tail of 2.5° up to 12 widths; soft, the Gaussian
  alone with double `s` (maximum 0.8); glimmer, the Gaussian and a soft
  1° halo (70 % of the scattered, the halo with 40 % of that) and,
  with 30 %, a fixed cloud of 4096 glints of ±0.03° (2D Gaussian
  of 1°, their distances stratified and their directions and brightnesses,
  exponential like those of a speckle, from a *hash*) from which each
  sample takes one by its brightness; net, the Gaussian (its softening, 90
  %) and a cross on two axes at 90° from `angle`; star, `points`
  streaks from `angle`; streaks, a horizontal line (two half-streaks) of
  15°; the streaks with 1/r density from 0.05° that tapers to 0 over their
  length (`line_length_deg`: the star from 1.9° at 1/8 to 12° at 2, the net
  from 0.6° to 3.5°) and 0.02° thickness. `a` = 0.7 in the black diffusion and 1
  in the others; default tints of the gold (1.08, 1, 0.86), the net
  (1.06, 1, 0.94) and the streaks (0.82, 0.95, 1.25), brought to luminance
  1. Own numbers (four per filter) in `DIM_LENS_FILTER` = `4 <<
  20`, beyond the Sobol table; with chromatic bands, those of the
  group of three.
- **Connection with the lights** (after the first sheet and the lead's
  direction: MIS between the scattering in the pupil and a direct sampling of
  the lights through the PSF). A scattered ray rarely hits a small
  light, and the sheet without the connection came out speckled (the star as
  loose dots, the diffusions' halo as sparks all over the
  image). Each camera sample with filters connects, per filter, to
  one of the lights the camera sees (`Lights::camera_lights`: the
  area ones and the spheres with the *camera* flag, by their bounding sphere;
  chosen with uniform probability): a lobe for its part of the PSF;
  the deflection, within the disc that the light occupies in the plane of
  deflections (`filters::light_disc`), with the lobe's connection density
  (radial: uniform on the disc; streaks: the streak by the
  probability of the PSF that falls within the light and the distance by its
  1/r there; glimmer: one of the glints whose box touches the light, by its
  brightness and the area of that part, and a point in it; a 64 ×
  64 grid makes it visit only the nearby glints); a shadow ray, and
  that light's radiance times `s`, the lobe's colour, the colour before the
  filter and the probability that the following ones do not scatter. The
  two estimates are weighted with the balance heuristic lobe by
  lobe (`Filter::mis_weight`, `K / (K + p·q)`): the lights crossed by the
  first stretch of the ray of a sample the filter scattered weigh that
  (`integrator::radiance_weighted`, `Lights::crossed_camera_weighted`) and
  the connection, `s·L` times its colour and the same weight. Numbers in
  `DIM_LENS_FILTER_LIGHT` = `5 << 20` (six per filter). **Measured** (`rt
  --filter-noise`, the table at the end of the sheet) on the sheet's jar
  at 192 × 144, 16 samples, six seeds (variance of each channel
  of each pixel between the seeds, clamped to 64, mean over the
  image; without a filter, 1.49), with the verdict's filters: star 1,
  from 4.68 without the connection to 1.81 with it; streaks 1, 2.98 → 1.60; glimmer 1,
  11.09 → 3.29; white diffusion 1, 12.09 → 3.25; black diffusion 2, 18.41
  → 3.69; net 1, 5.41 → 3.09. The noise the filter adds (what exceeds
  1.49) drops 10.2 times for the star, 13.8 for the streaks, 5.3 for
  glimmer, 6 and 7.7 for the diffusions and 2.5 for the net (whose noise is already
  mostly that of its softening), with the means equal within the
  noise of the scattering alone (from −0.9 % to 0 %; the exact sum in the test
  confirms it lobe by lobe); it costs, in rays, 0.2 to 2.4 % more
  in the scattered cores and 31 % in the diffusions, whose tail
  reaches the light from the whole image (the time, with the machine
  loaded, does not separate it; glimmer, which walks the glints near
  each light, took 20 % longer on the sheet than the gold). On the first
  sheet: star 10.03 → 2.71, streaks 8.57 → 2.71, glimmer 10.37 → 9.24
  (its glint depended on the pupil cell, which the connection did not
  choose), net 7.72 → 3.04. Aperture, bokeh and focus do not change: the
  connection comes from the sample's pupil point. What remains of
  noise is from the surfaces' highlights (reflections of the lights),
  which the connection does not see: only the scattering reaches them.
- A lens without filters draws no new number and traces nothing new:
  **all earlier *hashes* intact** (example, E5, E5c, E5b-1,
  passes, *denoise* and O1 `0xcfc57d4a`). **RSB**: three 28 B gaps at the
  end of `LENS`, after the image padding, written only when there is
  any filter (an O1 `LENS` comes out byte for byte the same and is read without
  filters). Parity scene `example::o3a_scene` (black diffusion 1/2,
  6-point star at 15°, streaks 1/2 over a 6-blade aperture, O1's
  background lights; `rt --write-o3a-example`, `tests/fixtures/o3a.rsb`):
  `PINNED_O3A_FILTERS_4SPP = 0x49938f3b`
  (`0x715dc88e` on the first sheet and `0x625d565d` after the verdict, before
  the merge with E12, which moved it) in scalar, SSE2 and AVX2, in WASI
  (scalar and `simd128`), in the real `rt_wasm.wasm` (also with the passes;
  in CI), by the page's code and with 1, 4 and 16 threads.
- **Interface.** `src/data/lens-filters.ts` (stable keys, generic es/en
  names, a sentence on what each does; the numbers are the
  engine's and a test compares them with `filters.rs`). `CameraOptics.filters`
  (optional: earlier optics do not write it); choosing a bokeh type
  or *Plain disc* keeps the filters. *Camera ▸ **Filters***
  (`src/ui/panels/insp-filters.ts`): the stack, *Add filter* (up to
  three), and per filter type with its sentence, ×, *Grade* (1/8 … 2), and depending on the
  type *Tint* (with *Own tint*), *Points* and *Angle*; all through the
  *store*, one undo entry per change. **Preview**:
  `render/lens-filter-image.ts` computes the kernels in pixels (the
  Gaussians; the Cauchy tail as four Gaussians fitted to its
  energy, CDF error ≤ 1 %; the streaks as 49 taps of weight 1/r; the
  glimmer's points with the same *hash* as the engine) and their convolution in
  TS; `render/lens-filter-pass.ts` does the same in WebGL for Fast
  mode (the scene to a half-float linear target, wide Gaussians at reduced
  size, streaks and points at half resolution with the taps in
  pairs, and the viewer's curve and colour space at the end) and in
  the preview's fast images; the meter says *Filters:
  approximation, the render is done by the engine*. `tools/lens-filters-check.mjs`
  (local Chromium): eight checks, `docs/ui/lens-filters.png` and, for
  looking, `out/lens-filters-viewport.png`.
- **Sheet** `out/lens-filters-sheet.html` (`node
  tools/lens-filters-sheet.mjs`, `rt --filter-sheet`): the perfume
  bottle with a small light behind it, inside the frame, and another just
  above the frame, 512 × 384 and 128 samples, each type at 1/4, 1 and 2
  next to the unfiltered image, the two stacks (black diffusion 1/2 +
  star 6; gold 1 + streaks) and, for comparison, star 1, black
  diffusion 2 and glimmer 1 without the connection; at the end, the table of noise
  measured with and without the connection (`rt --filter-noise`,
  `out/lens-filters-sheet/noise.json`). What is seen in the second, for
  the verdict (rule 11): the diffusions, as in the first (halo
  around the light and veil from the one outside the frame, the black
  with less lift of the shadows); the gold warms the halo and
  the veil of the light and not the floor; the star at 1/4 gives short streaks, at 1
  they reach half the distance to the edge and at 2 the edge, thin and sharp
  (their visible thickness is the light's, which measures 0.73°), and those of the light
  outside the frame enter from the top at 1 and 2; the net softens and leaves
  a short, faint cross; the streaks are a thin, bluish line that does not
  tint the floor; glimmer is a soft halo with grain at the edge (with
  a light as large as this one, each glint is a copy of the light; with
  small lights they would be fine points). Stray sparks remain from
  the lights' reflections in the glass (the connection sees only the lights, not
  their highlights).
- **Verdict on the first sheet** (the lead's) and what changed. (1) The
  gold and the streaks tinted the whole frame: the tint goes only to the
  wide scattering (the diffusion's tail, by its share of the density at
  each distance, and the streaks); the narrow core, which falls over the
  image, stays neutral; the tints are softer (gold 1.25/0.98/0.62
  → 1.08/1/0.86; streaks 0.7/0.92/1.4 → 0.82/0.95/1.25), the streaks have
  their own `s` (`STREAK_S`, 0.02 … 0.07) and the gold that of the black diffusion.
  In the sheet's scene, the floor's blue/red away from the lights
  moves 1.8 % at 1 and 3.1 % at 2 with the gold, and 2.3 % and 3.2 %
  with the streaks (test, limits 3 % and 6 %). (2) The net's cross crossed
  the frame: it now measures from 0.6° to 3.5° according to the grade (at 2, 14.6 %
  of the sheet's width) and carries 10 % of the scattered (before, half); the
  rest is its softening, and each streak of the cross is fainter
  next to the light than one of the star of the same grade. (3) The star's streaks
  did not grow with the grade: now their length is the grade's
  (1.9°, 3°, 4.6°, 7.2° and 12°: on the sheet, a quarter of the half-frame at
  1/4, 60 % at 1 and all of it at 2), with a 1/r density that tapers to
  0 at its tip, and its `s` (`STAR_S`, 0.073 … 0.11) grows like the
  integral of that density, so that next to the light they shine the same at
  each grade (± 15 %, test) and their thickness (0.02°) does not change. (4) Glimmer
  came out as a crown of blotches (the pupil's 36 cells): it is now
  a soft halo (a 1° Gaussian, 40 % of its radial lobe, the
  rest the 0.25° core) with the grain of a fixed cloud of 4096
  glints (30 % of the scattered); each sample takes a glint from
  the cloud (2D Gaussian of 1°, stratified distances, directions and
  brightnesses from a *hash*, the brightnesses exponential like those of a
  speckle), no matter where it crosses the pupil; the connection chooses
  one of the glints that touch the light, by its brightness and the area of its
  box inside (a 64 × 64 grid limits the search to the
  nearby ones), and a point in that part. Without cells, the virtual pupil of the
  pinhole of (6) was superfluous and was removed. (5) The `s` tables change only
  for the star and the streaks: the net and glimmer keep that of the
  diffusions, and the white and black diffusions and the soft give the
  same bits as before (their sheet cells are those of the first).
  O3a's *hash* moved (the star and the streaks of its stack).
- **Lead's verdict (second sheet).** Accepted: the gold
  warms the halo and leaves the frame neutral, the net is a modest cross
  over its softening, the star's streaks grow with the grade and
  remain thin, the streaks are a line with the image neutral and glimmer
  is a soft halo with grain. On the “What did not fit the plan” points: (9) the
  lengths in angle calibrated on the sheet's 85 mm are right (a real
  filter is angular; that with a 50 mm the star looks shorter relative to the frame
  is what really happens): they stay so, not scaled
  with the field; (10) the fixed cloud of glints is right
  (a glimmer glass is a fixed pattern): it stays; (11) to (13),
  accepted.
- **Tests** (each checked by reintroducing the error): 16 in
  `optics::filter_tests` of rt-core and one in `optics::filters`: grades →
  `s` (not interpolated, fails); white diffusion that keeps the mean of
  a white field ± 0.5 % (a 95 % weight, fails); black diffusion at 1
  between 0.90 and 0.97 (without absorption, fails); star of 6 with the energy
  in six streaks ± 2° beyond 1° (one streak too many, fails); gold with
  the warm tail and the neutral core, also in an image (the tint
  also in the core, or the tail's share reversed, fail); three
  filters of grade 0 = no filter bit for bit (grade 0 that scatters,
  fails); filters that change the image and give the same bits on each
  SIMD path; `LENS` round trip and O1's byte for byte (always
  writing the gaps, fails); out-of-range values (a 5-point star,
  fails); the glimmer glints' *hash*, fixed; the connection that
  gives the same image as the scattering alone at 1024 samples ± 3 % in
  each type (the crossed lights without weight or the connection without `s`, fail);
  the exact sum, without rendering, of the weighted scattering and the connection
  against the scattering alone in each lobe, also with a light that is only
  half a disc, with a glimmer and a small light and with the gold (the
  streaks without MIS, the radial density doubled, the glint's box badly
  measured or the streak chosen without its probability, fail); glimmer as a
  cloud and not a crown (the glints in a ring, or all equally
  bright, fail), with each sample's glint by its brightness and
  the connection choosing it by its brightness and its part inside the light (without
  the brightness in one or the other, fail); the glint grid against
  all of them in 3000 lights (without the box margin, fails); the
  star that lengthens with the grade without widening (the fixed length, or
  the fixed `s`, fail); and the net with the cross shorter and fainter than the
  star (half its light in the cross, fails). O3a's *hash* (the
  filters' numbers in the Sobol table, fails). `rt-cli`: 1/4/16
  threads with filters, the sheet's cells (one light inside and another outside the
  frame), `--only`, the sheet floor's blue/red away from
  the lights with the gold and the streaks at 1 and 2 (the tint also in the
  core, or the first sheet's tints, fail), the star's and net's lengths
  in the sheet's frame, the variance between seeds of
  `--filter-noise` (unclamped, or divided by the seeds and not
  by one fewer, fails) and its two rows per filter, the connection's
  with more rays. `tests/lens-filters.test.ts` (14): the data are those of
  `filters.rs` (keys, grades, `s` and length tables, widths,
  tints), names and sentences in both languages and without brands, `gradeS`,
  `filterS` and `lineLengthDeg` (the star with the diffusions' `s`,
  fails), non-neutral optics with filters (one that ignores them, fails) and
  normalised to three (unclamped, fails), the `LENS` gaps as
  `rt` reads them (without the points or without the angle, fail), `o3a.rsb` and
  `o1.rsb` byte for byte, the approximation's energy (the tail without its
  part, fails), the star at its angle (5° too much, fails), the gold
  with the warm halo and the neutral core, and the net with the cross tinted and
  the softening not (the tail without tint or the softening tinted, fail), the
  star's streaks up to the length of their grade (a fixed length, or without
  tapering, fail), and with the real `rt.wasm` O3a's *hash* and the
  approximation against the engine in the white furnace with the example's parts in
  4 × 4 blocks, < 2 % (without the black's absorption,
  fails).

**What did not fit the plan.** (1) The **connection with the lights** was not
in the brief: the lead proposed it after the first sheet and, measured, it
is carried by all the types and not only the scattering ones (star, streaks,
glimmer), because the diffusions' tail gave the same spark noise
around a small light; it is the same image on average and remains
ray space. (2) The render window has no image: the
convolution in TS is the reference of the WebGL pass, the one the tests compare
with the engine and the one applied to the preview's fast images.
The AI frame (X4) still has no filters. (3) There is as yet no
*Lens* section in the inspector (it arrives with O2): *Filters* is a
subsection of *Camera* next to *Bokeh* and *Advanced optics*. (4) The
comparison with the engine “in the furnace scene” is done in blocks of
4 × 4 (otherwise, the noise of two renders at 128 samples counts as a
difference). (5) The grades → `s`, the widths and the rest of the numbers are
proposals for the verdict (rule 11). (6) The first sheet was rendered
without the connection and with a pinhole that fixed the glimmer's cell: the
glint came out as a ghost of the whole image; it was fixed by taking the
cell from a virtual pupil, and after the verdict the glint no longer
depends on the pupil and that virtual pupil was removed. (7)
`rt --filter-sheet --only` renders single cells of the sheet again;
the three glimmer ones and the comparison one come from there. (8) The proposal
for glimmer (that the connection also choose the cell) was accepted by the
verdict with the glints random per sample: the connection chooses the
glint and, as it no longer depends on the pupil, the lens point is
the sample's (there is no cell to choose). (9) The verdict asked for the
star's and net's lengths as fractions of the frame; they are in
angle, like those of a real filter, calibrated on the sheet's 85 mm:
with another focal length they occupy another part of the frame (with a 50 mm, the star at
2 reaches 60 % of the half-frame). If they are wanted relative to the frame, the
lens would have to know the camera's field. (10) “Random directions
per sample” is a fixed cloud of 4096 glints from which each
sample takes one at random: with a new direction on every sample the
image would converge to a smooth halo, without grain; with the fixed cloud it converges
to a halo with the grain of its glints, and with the soft halo underneath
they do not read as loose blotches. (11) The net tints only its cross: its
softening falls over the image, like the gold's core. (12) The Fast
viewer draws the glimmer cloud as the Gaussian it comes from
(its average); the grain belongs to the engine. (13) O3a's *hash* moved with
the verdict (`0x715dc88e` → `0x625d565d`); the others did not. The merge with the session branch (E11, E12) moved it again, to `0x49938f3b`, and `o3a.rsb` grew to 9352 bytes with the 64 B `RNDR`.

## O4 · Simple and traced lens: options for each — **Opus** — done

**Request from the owner** (two messages, verbatim; translated from the Spanish original):

> “Besides, bokeh is chosen under thin lens, and when you select it, it takes you out of
> traced lens if you were in it. What I want is for it to be simple lens instead of
> thin, and for bokeh to appear only under simple lens.”

> “bokeh and advanced optics belong to thin lens, so the same as I told you about
> bokeh, that it applies only to simple lens, in traced I do not want these
> options. I want to put tilt and shift in traced, in advanced (which I
> want to call more options) and make tilt more intuitive and easy
> to use for both, advanced optics and more options.”

**What.** (1) The *thin lens* is renamed **simple lens** in everything
visible, with the stored keys and values intact. (2) The **bokeh**
and the **advanced optics** belong to the simple lens: with a traced lens they
are not shown, no path applies a bokeh to a traced camera or takes it out
of its lens (a short notice in its place), and returning to the simple lens
restores what it had. (3) The traced lens's *Advanced* is called
**More options** and carries the traced lens's **tilt and shift**,
in the engine if it fits, from the optics literature. (4) An
**easy tilt** in both: amount and direction instead of axis
numbers, the focus plane drawn in the viewer, and the plane through two points.
*Straighten verticals* no (that is K3's): only leave the shift ready.
(5) Documentation, captures and (6) this phase.

**Depends on.** O1, O2, O2b.

**Acceptance.** The bug with its test, which fails on removing the fix, for each
path that had it; each model's sections and the return; the rename
with old projects round-tripping; the maths of the plane
through points in TS and, in the engine, the plane through the requested points, the
shift by the expected amount and tilt and shift 0 bit for bit;
a browser test per model with nothing clipped; all pinned *hashes*
intact and a new one for the tilted traced lens, with its wasm
parity.

**Done.**

- **Simple lens.** `camera.lensThin` says *Simple lens · Lente simple* (the
  key and the stored value `thin` do not change; `lensModelOf` reads it) and the
  other strings, the help, `bokehResetAux`, UI.md, SPEC.md and
  ARCHITECTURE.md speak of the simple lens (a test checks that no
  string in `strings.ts` says *thin lens* or *lente fina*). The *Lens
  model* row puts its label on top and the two buttons at full width: the
  browser clipping test found that *Simple lens · Traced lens*
  did not fit side by side in Spanish.
- **Bokeh and advanced optics, only with the simple lens.** With a
  traced lens the *Bokeh* and *Advanced optics* sections are not painted
  (`display: none`, not a single visible control). The bug had **two
  paths**, both in `insp-lens.ts`: a type's checkbox and the
  *Variant* list, which called `opticsForBokeh`, and that function set
  `traced: null` (return to the simple lens). There were no more: neither the palette, nor
  the camera menu, nor the URL parameters, nor a drag or a drop
  of a bokeh resource applies a bokeh (A6's resources are the
  pupil images, which only a type names). Now `opticsForBokeh`
  returns `null` with a traced lens, for any type, and all
  paths go through one command, `applyBokeh` (`src/ui/lens-commands.ts`), which
  with a traced lens does not touch the camera and warns *Bokeh is an option of
  the simple lens: this camera has a traced lens, which makes its own*
  (what a future drag or menu will use). Switching model
  (`opticsWithLensModel`, `setLensModel`) no longer erases the bokeh type or its
  variant: the bokeh, its parameters and the simple lens's tilt
  stay in `optics` and come back as they were; changing traced lens does not
  erase it either. The traced lens's three types (coma comet, focus
  breathing, variable spherical aberration) **are not in the grid** of the simple
  lens: they belong to its lenses in *Lens ▸ Traced lens* (decided, below; at
  first they came out switched off saying where their lens was). Tests: `tests/lens-o4.test.ts` (each type and each variant
  against a traced camera; the command with its notice; the return with the bokeh and
  the advanced optics) and `tests/traced-lens.test.ts`, whose O2 test
  expected exactly the bug (“a thin-lens type returns the camera to the
  thin lens”) and now expects the opposite. With `opticsForBokeh` and the
  `applyBokeh` guard restored to what they were, three tests fail (checked).
  In the browser (`tests/lens-modes-browser.test.ts`): no bokeh
  checkbox visible with a traced lens, `applyBokeh` of three types without changing
  lens, and the return with the bubble marked.
- **Tilt of the traced lens, in the engine**
  (`rt-core/src/optics/traced/tilt.rs`, ARCHITECTURE §5.2 sedecies). The
  lens rotates relative to the sensor around the camera position (its
  entrance pupil), the sensor stays facing the view where the lens
  forms the image of the focus point (the frame does not rotate and the centre
  stays sharp), and the angle is solved with the lens's paraxial optics
  (the conjugate of the sensor plane, `Abcd`, bisection) so that its focus
  plane tilts **like the simple lens's** for the same
  tilt (decided); the centre is refocused with real rays (the field
  curvature where the tilt puts the focus point: without that the centre
  was up to 4.5 % off on the tele); the pupil limits are
  traced at 9 × 9 sensor positions and the weight carries the cosine of the tilted
  sensor. The engine states the angle the lens rotates (`tiltDeg`
  in the information, the *Tilt of the lens* row: 5.95° for 6° on the
  double Gauss at 85 mm). Tests in `traced_tests`: the centre at the
  focus distance (≤ 1.5 %) and the plane's slope equal to the simple
  lens's plus the field curvature of the straight lens at the same heights
  (2 % on the double Gauss, 0.1 % on the macro, up to 15 % on the tele and the
  triplet with an oblique axis); the macro's nine points on the plane
  (2.5 %); the frame on the focus point; each catalogue lens
  without cylinders tilts in both directions; batches with the bits of
  the single samples; the centre light within 6 %; tilt 0 with
  any axis, the straight lens bit for bit; the adapter (cylinders) rejects
  it. **The shift** of a traced lens already existed in the engine
  since O2 (sensor shifted before tracing): new test that it moves the
  axis its millimetres, straight or tilted. New *hash*
  `PINNED_O4_TRACED_TILT_4SPP` = `0x0b2fc327` (`example::o4_scene`, the
  double Gauss at 6° and shifted (2, −3) mm; `rt --write-o4-example`,
  `tests/fixtures/o4.rsb`) in scalar, SSE2 and AVX2, in the real `rt.wasm` through
  the page's code and in CI with `tools/wasm-parity.mjs` (with and without
  passes), and 1/4/16 threads. **No other *hash* moved** (example, E5,
  O1, O2, O3a and the rest: `cargo test --workspace` green). No new bit
  in `rt_features` (32 is not used).
- **The easy tilt** (`src/ui/panels/insp-tilt.ts`, the same block
  in *Advanced optics* and in *More options*; `src/core/focus-plane.ts`). The
  stored pair (signed tilt and axis) is read as an **amount**
  (slider from 0° to 12°) and **towards where in the image the plane runs away**:
  a draggable **dial** (one drag, one undo entry;
  keyboard and Shift) with **four shortcuts** (*like the floor*, *like the ceiling*,
  *like a wall* on each side) and the angle. **Through two points…**: two
  clicks on the product set the tilt **and the focus distance**
  so that both come out sharp, in one entry (*Tilt the focus plane through
  two points*): of the planes through the two, the less tilted one;
  two points at the same depth only focus; an impossible second point
  (more than 12°, in line with the view, behind) warns and waits. The
  function also solves the plane through **three** points (test), although the
  viewer only asks for two (decided: no third point for now). **The plane in the viewer**: a translucent
  square with a grid, in the interface's ink, around the product and in
  perspective, with the focus point (and the first chosen point), in
  Fast and in Full, while the pointer or focus is in the block,
  while the points are being chosen and always with *Show the plane*
  (`ViewportPort.setFocusPlane`). The **shift** stays in the same
  block and belongs to the camera (the usual fields). With K3's
  *Straight verticals* (arrived on merging) its shift is added to that of these
  fields when rendering, with the simple lens and the traced one, and the drawn
  plane and *Through two points* use the levelled camera that is rendered
  (`renderedCamera`; the focus distance comes back divided by the cosine
  of what was corrected, like K3's click-to-focus): test that fails without it.
  With a panorama no plane is drawn (it has no lens).
  With the anamorphic adapter the block says it does not tilt. In *More
  options*, in addition, the rest of the aperture (*Roundness*, *Rotation*,
  *Obstruction*), which a traced lens uses and which was no longer visible after
  hiding the advanced optics.
- **Tools, captures.** `tools/o4-check.mjs` (seven checks on
  the built application, its captures `o4-simple-optics.png`,
  `o4-traced-more.png` and `o4-tilt-overlay.png`), `rt --tilt-sheet <dir>`
  (lights on a floor with both lenses, straight and lying over the
  floor; its composition is `o4-traced-tilt.png`); `tools/lens-check.mjs` and
  `tools/optics-check.mjs` up to date (the latter counted 16 checkboxes with thumbnails,
  as in O1: O2 had left it behind), with `lens-editor.png`,
  `lens-section.png`, `camera-bokeh.png` and `camera-optics.png` re-recorded.

**What did not fit the plan.** (1) **The id O4 was already taken** in `STUDIO-TOOLS`'s
optics phase table (further down), for a planned and unstarted phase:
*Flare with ghosts, diffraction star…*. This phase keeps O4 and that one becomes
**O6**, the next free (O5 is the lens editor of the same table). (2) **What
tilting a traced lens means.** It was chosen that the same number give the
same plane as the simple lens (the real lens rotates the angle that is
needed, and the engine says it), so that the plane's drawing and the two points
are valid with both lenses; the other option, that the number be the lens's
physical rotation and the plane come out of its optics, makes the interface's
arithmetic false with a traced lens. (3) **Field curvature.** With a
traced lens the plane through two points is exact at the centre and paraxial
outside: a point in the corner of the double Gauss at f/8 falls 3–10 % of
depth off the plane (in the triplet, much more: it is its curved field, the same as
straight). Solving it with real rays would ask the engine for the plane of a
camera (a new port): pending until after F1 (below). (4) **The traced lens's tilt is
stored separately** (`tracedTiltDeg`, `tracedTiltAxisDeg`): an earlier traced camera
with a stored simple-lens tilt (the engine ignored it) does not start
tilting; the shift, on the other hand, is a single one for both lenses, because the engine
already applied it to both. (5) **The aperture and the chromatic aberration and the swirl**
belong to the camera, not to each lens (the engine uses them with both and they were stored
that way): touching them with a traced lens leaves the simple lens's bokeh at *Custom*.
(6) **The traced lens's bokeh types** in the grid: at first
they came out switched off saying where their lens was; with the decision they are removed
from the grid. (7) The viewer's plane is drawn on top of everything
(like the glyphs and the *gizmo*), without being cut by the product. (8) The dial
stores, when touched, the positive tilt and the axis rotated 180° if
needed: the same plane (test); what was stored before is not touched until it is
edited. (9) **Coordination**: *Through two points* writes the focus
distance, which is its result (F1, which brings click-to-focus and its modes,
will have to decide whether it goes through its modes on merging); the focus click
and its ray were not touched. K3: its straight verticals do not write the fields
`shiftXMm`/`shiftYMm`, they add their shift when rendering; the two are
composed (above). (10) Fast mode
still has no blur: the drawn plane is what replaces it
while it is adjusted. (11) The 12° limit is the simple lens's from O1
for both (a real tilt-shift reaches about 8.5°).

**Decided** (by the session lead, on the points this
paragraph left open):

1. **No third point for now**: *Through two points* is enough. The viewer's
   plane stays as is (on top of everything, on pointer hover, when choosing
   the points or always with *Show the plane*). `solveTilt` still solves
   three points (test), with no control.
2. **A traced lens's tilt is “the same plane as the simple
   lens”**, as is.
3. **With a traced lens, *Through two points* must be solved with real
   rays.** Done with F1: with the simple lens's plane rotation, the
   distance is the mean of those the engine solves with real rays for
   each point (`core/focus.ts exactFocusDistance`, `rt_scene_focus_at`);
   without `rt.wasm`, the plane's. Checked by `tests/lens-o4.test.ts`.
4. **The aperture, the chromatic aberration and the swirl are shared**
   by both models, as is.
5. **The traced lens's three bokeh types are removed** from the simple lens's
   grid (the owner does not want the traced one's options
   mixed in). Done: the grid has 17 types; checked by
   `tests/lens-modes-browser.test.ts`, `tools/lens-check.mjs` and
   `tools/optics-check.mjs`, and `camera-bokeh.png` is re-recorded.
6. **The 12° limit stays.**
7. **The `rt --tilt-sheet` sheet is accepted.**

## P5 · Update from within the application — **Sonnet** — done

**What.** Request from the owner: today *Settings ▸ Updates ▸
Download* opens the installer in the browser; it must **install the
update and restart the application** from within, asking first
about unsaved changes.

1. **Question** (only if the project has changes): “Save the
   changes to “X” before updating?” with **Save**, **Save
   as…** and **Quit without saving**; `Esc` cancels (`UI.md` §4.3, in
   place). *Save* and *Save as…* continue only if the project was
   actually written. It is the same question as on closing, with the third
   button: `afterUnsavedCheck` gains *Save as…* for all uses
   (close, new, open), which is the coherent thing.
2. **Installed desktop (Windows)**: the launcher downloads the release's
   `-setup.exe` (the same `curl` as the models, with
   progress), downloads `SHA256SUMS.txt` and **checks the sum** with its own
   `sha256` (if it does not match, it is not installed and this is stated); it launches the
   installer silently, `setup.exe /S /LAUNCH`, detached from the process, and
   the application exits cleanly (the window closes). The installer
   (`packaging/windows/installer.nsi`, without *plugins*): waits up to 30 s for
   `repackshot.exe` to become free (a `FileOpen` loop in write mode
   with `Sleep`), installs, and with `/LAUNCH` starts the application when done
   (also silently). A contract test reads the `.nsi` as text and
   checks the wait loop and the `/LAUNCH`, as U10 did.
3. **Portable (Windows and Linux)**: the launcher downloads the portable
   (`.zip` or `.tar.gz`), checks the sum, extracts it to
   `<exe folder>/update-<tag>/` (the AI runtime's own `zip`; on Linux `tar.gz` with the system's `tar`, like
   `curl`), and **replaces itself**: renames the executable in use
   to `repackshot.old(.exe)` (an executable in use can be renamed,
   not overwritten), moves the new files into place without touching
   `data/` or `portable.txt`, starts the new executable detached
   with `--after-update` and exits; the new one, on starting, deletes the `.old` files and the
   `update-*` folder. If something fails halfway, it leaves the old files where they were
   (order: extract everything first, rename afterwards) and says so.
4. **Interface**: in *Settings ▸ Updates*, when there is a new
   version the main button is **Install and restart** (on the web it remains
   *Download*, which opens the release, and says so); *Release notes* stays. The
   row shows the progress: *Downloading… 45 % · 3.2 of 7.1 MB*,
   *Verifying*, *Installing… the application will restart*; failures
   (download, sum, no space, neither portable nor installed) in the row
   with *Try again*. The start-up notice (when there is a new version) offers
   the same *Install and restart*. While downloading, *Settings* can be closed;
   the progress continues in the row on returning.
5. **Launcher API** (`rt-app`, documented in its README):
   `POST /api/update/install` `{tag, assetUrl, sumsUrl}` → `202` and
   `GET /api/update` `{state: IDLE|DOWNLOADING|VERIFYING|INSTALLING|
   FAILED, received, total, error, message}`; `POST /api/update/cancel`.
   Only `https://github.com/<owner>/<repo>/releases/download/…` URLs of the
   configured *feed* (allowlist, like the other downloads).

**Depends on.** P2, P3e, U6 (Check for updates).

**Acceptance.** TS test: with unsaved changes the question has the
three buttons and cancels with `Esc`; *Save as…* writes and continues; without
changes it does not ask; the request to the launcher carries the URL of the asset
that applies (installer or portable according to the mode) and never a URL outside the
allowlist; `es`/`en` strings. Rust test: a sum that does not match
does not install; the portable's replacement over a test folder with
a fake executable leaves the new files, the `.old`, `data/`
intact and the relaunch with `--after-update`; the subsequent start-up
cleans up; the `.nsi` contract. Browser check
`tools/update-install-check.mjs` against the real launcher and a local
server that stands in for GitHub (fake release, fake asset with its
`SHA256SUMS.txt`): the Linux portable path end to end (the
application restarts with the new version, in a copy in
`out/update-check/`), and the Windows one only up to “launch the installer”
(Wine does not run NSIS: note it). Capture `docs/ui/update-install.png`.
The first real update from the application will be from the version
that carries this to the next one: note it in the release notes.

**Done.** `engine/crates/rt-app/src/update/` (`feed.rs`: the allowlist —only
`github.com/<owner>/<repo>/releases/download/<version>/<file>` of the repository in
`src/data/update-feed.ts`, which the *crate* reads when compiled—, the package names and the
sums; `portable.rs`: extract, replace in place with undo, clean up on start; `mod.rs`: the
state, the thread and the routes `GET /api/update`, `POST /api/update/install` and `…/cancel`);
`ai/download.rs` admits a bounded-only size; `process::spawn_detached`; `--after-update`;
`/api/info` says `updateApi` and `afterUpdate`. Installed on Windows: it downloads the `-setup.exe` and the
sums, checks the own SHA-256 and, with the launcher stopped, runs `setup.exe /S /LAUNCH`; portable
(Windows `.zip` with the own reader, Linux `.tar.gz` with the system's `tar`, after looking at its list):
extracts everything to `update-<tag>/`, renames the old to `.old`, puts the new without touching `data/` or
`portable.txt`, undoes what was done if a step fails (tested by injecting the failure at each of the
eight) and starts the new executable with the earlier arguments and `--after-update`; the new one deletes
the `.old`, the `update-*` folders and the download. `installer.nsi`: the wait of up to 30 s
(`FileOpen` in `a` mode and `Sleep 500`, 60 turns), `/LAUNCH` in `.onInstSuccess`, and silently
no models page nor the desktop shortcut that was deleted. Interface (`ui/updates.ts`,
`io/update-install.ts`): *Install and restart* in the row and in the notice (on the web, *Download* and
a line that says what it does), progress (*Downloading… 45 % · 3.2 of 7.1 MB* with a bar,
*Verifying…*, *Installing…*), *Cancel the update*, failures with their reason and *Try again*,
launcher polling every 400 ms (closing *Settings* does not stop it; a reloaded page
picks it up), and the question about unsaved changes with **Save as…** for all uses
(`afterUnsavedCheck`: close, new, open, update; *Save* and *Save as…* continue only if
it was written; `Esc` cancels), which in the update appears in the button's place. Tests: 15 of
sockets in `tests/update.rs` with the real `curl` and `tar` against a local server (end to
end the Linux portable and the Windows one, the sum that does not match, the allowlist, cancel,
resume), 16 unit tests of the module, 4 `.nsi` contract tests in `tests/installer.rs`, 35 of
TypeScript in `tests/update-install.test.ts` (plus the usual ones, adjusted to three buttons).
`tools/update-install-check.mjs` against the real launcher: the Linux portable end to end in
`out/update-check/linux/` (the new version starts on the same port with `--after-update`, the
marker is in its `app/`, the `.old` files are gone, `data/` and `portable.txt` as they were) and the
installed Windows one under Wine up to the installer started with `/S /LAUNCH`. Capture
`docs/ui/update-install.png`. `tools/updates-check.mjs` was repaired along the way (broken since U10 and
P3b: a second `.update-notice`, links through an anchor instead of `window.open`, the launcher's `open-url`, the version pinned to 0.1.0) and *Settings*' `Esc` with a question open, which
cancelled the whole window instead of the question.

What did not fit the plan: (1) *INSTALLING* covers unpacking and swapping files, and the
page cannot close the window until they are in place, so `GET /api/update` carries one
more field, `ready` (contract extended, not changed). (2) The launcher **does not exit itself when done**: it exits
when the window is closed (the page closes it on seeing `ready`; `--serve-only` without a window exits
by itself) and **only then** starts the installer or the new executable; if it started earlier, the new one
would meet the old one's port, `instance.json` and window profile (and an orphaned browser
window). (3) `POST /api/update/install` accepts an optional `size`: `curl` does not give the total
before the body and the bar does not invent numbers; without it, only the MB received. (4) The installer's 30 s wait
goes **only when silent**; by hand, it asks at once as before, so as not to make
whoever runs it with the application open wait half a minute. (5) A silent installer also
does not rewrite `pending-models.json` or recreate a desktop shortcut that the person deleted: it
was not in the text and it would have done so on every update. (6) The third button says *Quit without
saving* only in the update; on close, new and open it is still *Don’t save*. (7) If the
project changes while downloading, the question is asked again on closing to restart; if it has not changed
since it was answered, it is not. (8) NSIS does not run under Wine: the `.nsi` is compiled with `makensis -WX` and its
contract is read as text; the real installer, the closing of the own window (WebView2) with
`close-ok`, the swap of an executable in use on Windows and SmartScreen remain to be tested on a
real Windows. (9) The own zip requires names of `[A-Za-z0-9._+-]` and 8 levels: today's `dist/`
complies, a file in `app/` with a space in its name would make the extraction fail (with `extract`,
without changing anything). (10) With the machine at load 20–30 (other agents), two tests unrelated to this phase go over time:
the *pool* *denoise* one in `pathtracer` (it passes on its own when repeated) and the `afterAll` of
`ai-passes-browser` (it closes the browser in 10 s; its seven tests pass, the closing does not).

## E6 · Edge bevel, wood and fabric in shading — **Opus** (bevel first; was Sonnet) — done

**What.** First the **edge bevel in shading** (decision Fable,
after v0.1.5: it is the most visible realism improvement left for
CAD models): normal rounded near hard edges with a radius in mm per
material (the inspector's *Edge bevel* field stops saying
*coming soon*), by the method of the edges nearest the point
(searched for in the mesh, with a precomputation of the hard edges by dihedral
angle > 20° and an edge grid or BVH of its own), blending the normal
of the two faces according to the distance to the edge with a circular profile;
it applies to the reflection (the light catches the edge) and to the shadow;
measured cost limit (≤ +15 % on the example with 0.3 mm). Then, bring to
`rt-core` the catalogue's procedural recipes (ring
grain with two colours, variation, axial noise and pore; thread weave
with weave type, threads per cm and relief) as shading functions
with own noise (Perlin or *simplex*, written here and with the statistics
pinned by a test), scale in part sizes; edge bevel in
shading (normal rounded near hard edges, radius in mm). The
fuzz is left out.

**Depends on.** E3.

**Acceptance.** Evaluate the functions over a plane and check
statistics (ring period, contrast, roughness mean);
renders of the 13 woods and 12 fabrics as spheres with `rt`; the bevel
changes the normal only within the radius of a hard edge (cube).

**Done — edge bevel** (first part, its own *commit*).

- **Hard edges** (`rt_core::geometry::edges`): once per mesh, the
  first time an instance with a bevel asks for it, and stored with the mesh
  (they survive updates without `MESH`). Welded by exact position
  and then to within 10⁻⁵ of the mesh size (a lathe seam);
  edge with one triangle = border; with two = hard if their normals,
  consistently oriented, differ by more than 20° and the mesh does not
  smooth it with its vertex normals; with three or more, ignored. Own
  binary BVH of segments (leaves of 4) and a slack per triangle; each point
  looks at most 128 nodes and 8 edges within two radii.
- **The normal** (`rt_core::bevel`): that of a circular fillet tangent to
  both faces, `normalize(r n + (r tan(θ/2) − d) v)`, with the point's
  shading normal and that of the opposite face interpolated at the edge;
  convex and concave with the same formula; the footprint never exceeds `r`
  (sharp edges: the radius drops to `r / tan(θ/2)`); open borders, a
  right angle outward. Several edges: the shortest displacement that
  satisfies all (exact at a box's corner; the largest request, not the
  sum, on a curved edge); if they do not fit, the radius drops by bisection (a
  thin border becomes a half round). Instance scale: the radius is
  divided by `∛|det M|` (with non-uniform scale, the transformed fillet:
  elliptical, of mean radius `bevel_mm`). It composes with the terminator (RTG
  II): rays leave from the point raised by the terminator and then by the
  fillet, `d · a / |r n + w|` along the bevelled normal (just
  enough for every direction above the fillet's tangent plane to clear
  the face), and the geometric normal becomes the fillet's; a normal
  that would face backwards is folded towards the viewer. Used by the
  integrator, the caustics' photons and the normal pass.
- **Cost** (CPU time of one thread, minimum of three, machine shared
  with two other agents): the interface's example bottle with its default bevel of
  0.303 mm, 1.444 s → 1.489 s (**+3.1 %**); engine example with
  0.3 mm on its three materials, +0.7 %; E6 scene (few triangles,
  all touching edges, bevels of 2–3 mm), +11 %. Below +15 %.
- **Bias**: one more shading normal; MIS weights the two strategies with
  the same BSDF, but it is not reciprocal: white furnace with a bevelled cube,
  mean 0.99995, pixels between 0.988 and 1.014.
- **RSB**: `MATL` grows to 76 B with `bevel_mm` (f32, 0 = sharp), in the order
  agreed with E9 (behind will go `scatter_mm`, `scatter_color[3]`,
  `scatter_g`, `abbe`); a 72 B `MATL` is read without bevel. The TypeScript
  writer sends `bevelRadiusMm` of all families except the emitter.
- **Interface**: the note of the *Edge bevel* field stops saying
  *coming soon* (“It belongs to the material. Full mode rounds the hard
  edges in shading, like a fillet of this radius; the Fast view
  shows them sharp”). The *Fast* view does not draw it.
- **Hashes**: the pinned ones do not move (no pinned scene carries a bevel:
  example `0x223515c3`, E5 `0xbf8abd5b`, E5 sky `0x2fcb098a`, E5c
  `0x8bb09f6b`, *denoise* `0xab15f290`, caustics `0x55d60f2f`). New:
  E6's scene (`rt --write-e6-example`: two-colour box in two meshes with
  non-uniform scale, 48-sided metal cylinder, plate thinner than two
  bevels) **`0xfccda027`** and its six passes (`PINNED_E6_PASS_*`), equal
  in scalar, SSE2, AVX2, WASI, the real `rt.wasm` (also through the page's
  code) and with 1, 4 and 16 threads in `rt` and in the launcher; new step in
  `engine.yml`.
- **Tests**: 29 new in `rt-core` (extraction: box, smooth and
  faceted spheres, borders and incoherent winding, lathe seam, queries
  against brute force and slack; bevel: the cube changes only within the
  radius and in the exact shape, symmetry between faces, corner as a sphere,
  smooth sphere intact, curved edge without arithmetic, elevation of a curved
  edge, part in two meshes the same as in one and flat seam, concave,
  thin border, instance scale, sharp and barely marked edges, neighbour on the
  other side of a gap, never facing away, emitters; renders: the edge
  catches a light below the face's plane, a highlight that the sharp edge
  does not have, a mirror reflects what is below the plane, white furnace; normal
  pass; RSB), `rt-cli` and `rt-app` (1/4/16 threads) and the interface
  (`materialToRsb`, section sizes, round trip, `e6.rsb` with the
  real `rt.wasm`).

**What did not fit the plan (bevel):**

- **Borders between meshes of one part.** The interface sends a part with
  per-face materials as one mesh per material, with the same
  transform: their shared borders are not borders. `BevelSetup` pairs
  the meshes' borders with the same transform (bit for bit): if the
  surface remains smooth it is a seam (no bevel) and if it bends more than 20° it is
  a hard edge with the other mesh's face. It is computed at each
  scene preparation, per instance. A seam that does not match
  (T-junctions, welds beyond 10⁻⁵) is still read as a border.
- **The normal pass carries the bevel** (it is the normal used for shading):
  scenes with a bevel change their passes; the pinned ones do not carry it.
- **All instances of a preset already carried 0.25 % of the part's
  size** (the Doctor's fix): from now on every existing project
  looks bevelled in *Full* without touching anything. It is what the Doctor asked for,
  but it changes the look of saved projects.
- **What is not rounded**: edges that the mesh smooths with its vertex
  normals (they are already round), non-manifold edges and duplicate faces;
  with non-uniform scale, the 20° threshold is measured in mesh space.
- **A border thinner than two radii** is adjusted only at that point: the
  wide face next to it keeps its radius, so the fillet is elliptical
  (continuous at the edge).

**Done — wood** (second part, its own *commit*; detail in
ARCHITECTURE §5.2 octies).

- **Own noise** (`rt_core::pattern::noise`): gradient noise from Perlin's
  public description (2002) with our permutation (Fisher–Yates
  with the engine's PCG, fixed seed), `fbm` and an integer *hash*. Pinned
  statistics: mean −0.0012, variance 0.0730 (2¹⁸ points), range
  [−0.993, 0.941]; 4-octave `fbm`, variance 0.0274; the first eight
  values of the permutation, pinned.
- **The recipe** (`pattern::wood`), in physical millimetres: sawtooth
  rings (rising for 70 %, falling in the last 5 %) with the Michelson
  contrast of each species and the mean of the *Fast* view; meander of
  half the spacing at 25 mm; fibre ±5 % at 0.3 × 30 mm; ring or
  diffuse pores, of `0.15 × width × poreDepth` depth; strip figures
  (bamboo, with its bundles and nodes), speckle (MDF) and streaks (ebony).
  Anisotropic roughness 0.3 along the pith (the shading frame's tangent
  follows the grain; nothing is left for another phase).
- **Knots** (`pattern::knots`, requested by the owner): cone branches from
  the pith that cross the part, placed by the material's seed without
  touching one another and without grazing the surface (≥ 45°, up to 8 new tries, otherwise
  discarded), with the fibre and rings flowing around them (from 1.5
  to 3 radii, bulge 0.35 R) and their end grain, bark pocket, bowl and
  crack; the interface places them the same (`src/core/knots.ts`), the *Fast* view
  darkens them over the mean colour (`src/render/knots.ts`) and the
  inspector warns of those that do not fit (“6 asked · 3 fit”). Controls
  *Knots*, *Knot size*, *Size variation*, *Knot darkness* (disabled with a note in
  bamboo, MDF and ebony); by default, pine 4 of 10–25 mm (darkness 0.9),
  cherry and walnut 1 (0.6).
- **Where**: in mesh space, the pith along the longest side, at 0.8 of it
  below and 0.35 to one side, never inside the part.
- **RSB**: new section `PATN` (108 B, after the `MATL`s): material,
  type, two colours, scale, 16 parameters, figure and seed. The TypeScript
  writer sends it for each wood material.
- **Hashes**: the pinned ones do not move. New: E6's patterns scene
  (`rt --write-e6-patterns-example`: bevelled oak table and walnut
  sphere) **`0x2a3a7416`**, equal in scalar, SSE2, AVX2, WASI, the real `rt.wasm`
  and with 1, 4 and 16 threads in `rt` and in the launcher; new step in
  `engine.yml`. With 0 knots, the bits of wood without knots.
- **Sheet** `out/wood-sheet.html` (`rt --pattern-sheet`, materials from
  `tests/fixtures/patterns.rsb`, written by the TypeScript writer): the 13
  woods on a sphere and on a 60 × 40 × 25 mm box, before, after and
  close up, and the pine knots row (0, 2 and 6 of 15 mm, 6 of 30 mm) on the
  large face of the box and on a 300 × 100 × 20 mm board.
- **Cost** (CPU time of one thread, minimum of three, loaded machine):
  E6's patterns scene, almost all wood (board and sphere), 0.762 s →
  1.058 s (**+39 %**) against the same with flat colour: a dozen
  noise evaluations per wood point; the relief reuses the
  ring fraction of the sample (without that, +56 %). The knots, a few
  dot products per knot and point; their placement, a few tens of rays
  per part when preparing the scene.
- **Tests**: 34 new in `rt-core` (noise: permutation, lattice and period,
  pinned statistics, *hash*; wood: sawtooth profile and its mean,
  exact ring period, Michelson contrast and mean of the *Fast*
  view, summer wood at its 40 %, mean of each figure on a
  board, pores in the spring band and their depth by width, the pores
  of a ring do not add a step, fibre ±5 %, bamboo nodes every
  150 mm and their specks 11–19 per cm² on any plane, the end grain of a
  knot; knots: placed as requested and without overlapping, the seed and the
  first ones still, flow around and nothing at 3 radii, wider away from
  the pith, never grazing and the discarded ones are not replaced, placement pinned
  for the interface; scene: the pattern belongs to its material, sticks to the part
  and scales with it, pith along the long side and never inside, the
  roughness stretched along the grain, a deterministic render different from
  the flat one, the albedo pass is the path's colour, a board shows the
  requested knots and of their size (2 / 6 / 6 discs of 17.3 / 15.9 / 33.9 mm
  for 2 × 15, 6 × 15 and 6 × 30 mm), the seed and 0 knots equal bit for bit,
  a rougher knot and its bowl, on a ball they never graze; RSB), `rt-cli` and
  `rt-app` (1/4/16 threads of the pinned scene) and the interface (`patternToRsb`
  of the 13 woods and their knots, disabled controls, the placement the same
  as the engine's, `meetsSurface`, a part's knots, the *fixture* up to
  date).

**What did not fit the plan (wood):**

- **The scale is physical, not in part sizes** (lead's decision on
  the first sheet, for realism): `ringDensity` becomes rings per
  100 mm and the presets carry each species' (oak 33, pine 20, maple
  40…; before 14 for oak, per part); the new *Scale* control
  multiplies them. SPEC §3.3 says so. A saved project keeps its old
  `ringDensity`, which is now read per 100 mm.
- **New fields**: `ringContrast`,
  `poreSize`, `poreBand`, `woodFigure`, `woodScale` and the four of the
  knots (new keys; none renamed).
- **The rings' relief, out** (lead's decision: the spheres
  looked turned on a lathe); only relief from pores, knots and bamboo nodes. The
  first sheet showed that ring pores added a step at each
  ring (the band began abruptly): it now enters gradually, with a test
  that fails with the earlier band.
- **Limitation of the *Fast* view**: it paints no rings, only the mean colour
  and the darkened knots; hence neither the fibre flow around
  the knots that the lead asked for (“the same placement and deviation”): the
  placement is the same, the deviation has nothing to deviate.
  Accepted by the lead.
- **On a small part fewer knots fit than were requested** (they never touch
  or graze): in the 60 × 40 × 25 mm box, 2, 3 and 1 of 2 × 15, 6 × 15 and
  6 × 30 mm; on the 300 × 100 × 20 mm board, all. The inspector says so
  with a discreet note.
- **The incidence threshold, 30° → 60° → 45°** (lead's rules after the
  sheet): a knot whose axis cuts the surface at less than the threshold is drawn again
  up to 8 times and otherwise discarded. With 30° the pine ball still
  showed teardrops: its knots cut it at 34–39°, and the cone's edge
  grazes before its axis. With 60° (what the lead asked for to keep the
  head-on knots) flat parts lost knots: the branches rise 15–35°
  up the trunk and the pith is 24° to one side, so a flat face sees its
  knots at 49–66° (the test board, 1 of 2 and 10 of 12). With 45° flat
  parts do not change (2 / 6 / 6) and the ball only loses the teardrops (its
  knots, at 47–64°): the measurement decided, with the lead's sign-off.
- **Lead's adjustments on the knot row**: the flow around a knot
  fades from 1.5 to 3 radii (not from 3 to 5) and bulges 0.35 R (not 0.5 R):
  on the box face it read as liquid.
- **Fuzz (*fuzz*, *sheen*) is still out**, as the plan said.

**Done — fabric** (third part, its own *commit*; detail in
ARCHITECTURE §5.2 octies).

- **The recipe** (`rt_core::pattern::cloth`, `PATN.kind` 2), in physical
  millimetres: round warp and weft threads in cross-section, with a gap
  between them, which rise where they pass over and sink where they pass
  under (a long float stays up) and show the slanted ridges of their
  thread's twist; each thread varies ±6 % in colour and
  ±10 % in roughness. Weaves: plain, twill 2/2, five-harness satin,
  canvas (2 × 2 basket), knit (*jersey*: two-legged Vs that overlap
  row by row, each stitch with a random heathering), felt (matted
  fibres, no threads) and **twill 3/1** (new, denim's). The
  relief (`weaveDepth`, half spacing at 1) tilts the normal; the
  roughness is stretched **across** the thread on top (anisotropy 0.5:
  the fibres' sheen; not for felt). The mean colour is that of the
  threads blended by the share of the face each covers (0.5; satin
  0.72; twill 3/1 0.685), and is that of the *Fast* view (`fabricMeanColor`).
- **Where**: box projection on the mesh axes, blended with
  weights `|nᵢ|⁸` in a narrow seamless band; the warp upright on
  the sides.
- **RSB**: `PATN` of type 2 (the same 108 B): the two thread colours,
  `scale_mm = 10 / threadCount`, relief (`weaveDepth`) and twist
  (`yarnTwist`), the weave in `variant`. The TypeScript writer sends it for each fabric material.
- **Interface**: *Threads per cm* (2–200, physical), *Weave* (with *Twill 3/1
  (denim)*) and *Weave relief* are painted by Full mode (“painted
  by Full mode and the renders”); the fabric note no longer says
  it is a flat colour.
- **Hashes**: the pinned ones do not move (the patterns scene stays at
  `0x2a3a7416`). New: E6's fabric scene
  (`rt --write-e6-cloth-example`: bevelled denim cushion and knit ball)
  **`0xbb26399f`**, equal in scalar, SSE2, AVX2, WASI, the real `rt.wasm` and with
  1, 4 and 16 threads in `rt` and in the launcher; new step in `engine.yml`.
- **Sheet** `out/cloth-sheet.html` (`rt --pattern-sheet --only cloth`, from the
  same *fixture*, which now also carries the 12 fabrics): each fabric on a
  sphere and box, before, after and close up, a 10 mm field seen
  head-on (where the threads are seen at their real size) and the denim woven in
  2/2 for comparison with its 3/1 (the first sheet also showed carbon
  with 0.05 relief, which the lead chose: it is now its row).
- **Cost** (CPU time of one thread, minimum of three, loaded machine):
  the fabric scene (cushion and ball, 320 × 240, 8 samples), 0.784 s →
  0.844 s (**+7.6 %**) against the same with flat colour: a woven fabric
  is a few operations per projection (three evaluations with the *bump*);
  the knit, 18 ellipses per evaluation.
- **Tests**: 10 new in `rt-core` (fabric: the share of the face covered by the
  warp of each weave and its mean colour, periods and structure —satin
  never shows two wefts together, not even diagonally; canvas goes in pairs; the
  3/1—, half-spacing relief and flat at 0, per-thread variation, the
  twist and its period, and none without it, the knit's downward V;
  scene: projection on the mesh axes, the anisotropy across the
  thread on top and the felt without it, the seamless blend and exact
  where two and three projections meet, the fabric PATN read; the pinned
  scene), `rt-cli` (sheet, `--only`, `--write-e6-cloth-example`, 1/4/16
  threads), `rt-app` (1/4/16 threads) and the interface (`patternToRsb` of the 12
  fabrics, physical, limits and default values; mean colour equal to the engine's
  in the *Fast* view and in the `MATL`; controls painted by the engine;
  `projectScene`; the *fixture* with the fabrics). They were checked to fail with
  22 fabric mutations: all caught; one (projections of weight
  below 0.5, ignored) escaped at first and the new blend test catches it.

**What did not fit the plan (fabric):**

- **Threads per cm, physical and proposed** (like the wood): the catalogue's
  `threadCount` was per part size (cotton 200, carbon
  90); they are now threads per cm and each fabric carries its real ones
  (cotton 40, linen 18, twill 36, denim 24, satin 100, canvas 14,
  velvet 30, felt 20, knit 4 stitches per cm, mesh 8, microfibre
  120, carbon 5 tows per cm), accepted by the lead (verdict below).
  A saved project keeps its old `threadCount`, which
  is now read per cm (up to 200: the earlier cotton comes out at 200 threads per
  cm, invisible).
- **Denim becomes twill 3/1** (`TWILL31`, new key; `TWILL` is
  2/2 and is still used by the twill and the carbon): with 2/2 its
  mean colour was a bluish grey (half the face, white weft); the
  real one is warp-faced. It changes its colour in the *Fast* view. The sheet
  shows both for the verdict.
- **New fields**: `yarnTwist` (0 in carbon and mesh: smooth tows and
  monofilaments; 1 by default, without a control).
- **At real size, most fabrics are not seen** on a
  product shot (cotton at 0.25 mm, less than a pixel at 100 mm over 300 px):
  they are averaged with the pixel's samples, without a filter of their own (the colour
  converges to the mean and the relief becomes roughness); some *moiré* on
  twill spheres at few samples.
- **The carbon's clearcoat follows the relief** (the *bump* belongs to the whole
  BSDF): up close, bright tubes are read, when a real clearcoat is
  flat. Options for the lead: less relief on the carbon or have the
  clearcoat use the normal without *bump* (an engine change, also for varnished
  wood).
- **The technical mesh has no holes** (there is no per-point opacity): it is
  an open plain weave of dark threads.
- **Velvet and fuzz**: without *sheen* in the engine, velvet is
  a fine dark point; the *Fast* view does paint its fuzz.

**Lead's verdict (fabric)** (on the fabric sheet, rows and
10 mm fields; E6 accepted):

1. **Threads per cm**: the proposed table stays as catalogue values
   (the real typical ones). The old `threadCount` of a saved project
   is still read per cm, with the cap of 200.
2. **Denim in twill 3/1** (`TWILL31`): accepted; the face reads as indigo
   on white, as it should.
3. **Carbon**: the 0.05 relief alternative (with the full relief, the bright
   tubes are wrong; with 0.05 the sphere and the field read
   as 3K twill under clearcoat). Having the clearcoat ignore the *bump* is an
   engine change for the realism layer (M4), not now: noted there.
4. **`yarnTwist`** without a control (0 in carbon and mesh, 1 in the rest):
   accepted.
5. **Accepted as they are**: the mesh without holes until the engine has
   per-point opacity (the alpha textures of M2b bring it: noted in its
   brief), velvet without *sheen* until the fuzz (S8), the *moiré* at
   few samples (E11's *Fine* filter, now the default, softens it) and
   the box projection on the mesh axes.

Done after the verdict: the catalogue's carbon lowers its `weaveDepth` from
0.3 to 0.05 (the sheet's *fixture*, up to date) and the sheet no longer shows that
alternative; the clearcoat without *bump* noted in M4 and the mesh's holes
in M2b.

**Merge with the session branch** (M2a, O1, E12, M3a, S2, S4a, U11,
U11b, E11…). E12's per-point light selection moves E6's three pinned values,
as it moved the others: bevel **`0x2f228634`** (was `0xfccda027`),
wood **`0x6fbc91f7`** (was `0x2a3a7416`) and fabric **`0x5604ec69`** (was
`0xbb26399f`), in `rt-core` (all ISAs), `rt-cli` and `rt-app` (1, 4 and
16 threads) and in `engine.yml` (its steps, behind those of O1, S4a and E11).
E6's `MATL` (76 B, `bevel_mm` at byte 72) is the one M2a's texture
block reserved, which stays at byte 100 behind E9's fields. A node material (M3a) carries no `PATN` or knots in the *Fast*
view: until M3b it is the mean of its outputs. E6's sections in
ARCHITECTURE were then §5.2 sexies (bevel) and §5.2 septies (wood and
fabric); since the second merge, §5.2 septies and octies.

**Second merge with the session branch** (O3a, v0.1.6, the
smoke-test fix, E9 a, b and c, the `GRADIENT_POOL` adjustment).

- **`MATL`** is E9's, of 100 B: E6's `bevel_mm` at byte 72 (the gap
  E9 reserved for it), and behind it `scatter_mm`, `scatter_color[3]`,
  `scatter_g` and `abbe`. The engine and the TypeScript writer write all of them;
  a 72 B record is read without bevel and a 76 B one (E6 before E9), with
  the bevel and without medium or dispersion (new test). M2a's texture block
  stays at byte 100, now without padding.
- **The integrator**: E9's BSDF (medium exit, dispersive glass
  with its band, surface, floor) with E6's frame (the pattern's grain
  tangent, if any); the bevelled shading point with its pattern feeds both.
- **`rt`**: all the commands of both sides; a single `--only` for the
  three sheets (comma list in `--filter-sheet` and `--filter-noise`, `wood`
  or `cloth` in `--pattern-sheet`). In `engine.yml`, all the parity
  steps: O1, S4a, E11, O3a, E9 and the three of E6.
- **Hashes**: E9a's energy compensation moves E6's three pinned values
  (all its parts have rough GGX, from 0.12 to 0.85): bevel
  **`0xeacaae75`** (was `0x2f228634`), wood **`0x5ed1bf32`** (was
  `0x6fbc91f7`) and fabric **`0x53e6a855`** (was `0x5604ec69`), in `rt-core`
  (all ISAs), `rt-cli` and `rt-app` (1, 4 and 16 threads) and in the real `rt.wasm`;
  E6's six passes, equal. No scene without bevel, wood or
  fabric moves, and all RSB *fixtures* without E6 come out byte for byte identical
  to the session's; `e6.rsb` becomes 9,852 B and `patterns.rsb` 6,332 B.
- **The setup thumbnails**: their scenes do change, and not because of this
  merge: every instance of a preset carries an *Edge bevel* of
  0.25 % of the part's size (the Doctor's fix) and since E6 the
  writer sends it, so the sets' heroes carry a bevel in
  *Full*. With the bevel at zero in the writer, the manifest's 88 scene *hashes*
  match; the manifest test was already failing in E6 before
  this merge (`1dc375e`). They are not re-rendered or pinned:
  that is left to the lead (render them again with the bevel, or have the
  thumbnails not carry it).
  **Lead's verdict (2026-10-16):** they are rendered again with the
  bevel. A thumbnail shows what the setup gives over the scene that the
  code builds, and that scene carries the Doctor's bevel; removing it
  only from the thumbnails would make them not match the user's first
  render. The 88 were redone with `rt` and E6's wasm
  (`tools/setup-thumbs.mjs`) and the PNG *hash* of `STRIP_EDGE` in
  `tests/sets.test.ts` was re-pinned.
- **Docs**: E9 keeps ARCHITECTURE §5.2 sexies and E6's sections become
  §5.2 septies (bevel) and §5.2 octies (wood and fabric); E6's CHANGELOG
  lines go in *Unreleased*, not in v0.1.6.

## E7 · Visible wear — **Opus**, with sign-off **Fable**

**What.** The eight wear types of `src/data/wear.ts` as shading
layers in `rt-core` (edges by curvature and bevel, scratches by level
curve of stretched noises, fingerprints, dust by upward normal,
dirt by occlusion, patina by blotches, micro-roughness, dents),
with the recipe's physical scale, seed and per-part variation.
Calibration: Opus implements and Fable adjusts thresholds on a wear
contact sheet (materials × basics) rendered with `rt`.
After the sign-off, the wear panel stops saying
*coming soon*.

**Depends on.** E6.

**Acceptance.** Sheet `out/wear-sheet.html`; with the master at 0 the image is
identical to without wear (pixel test); the same material on two parts
with `wearPerObject` does not repeat the pattern (low correlation between masks).

## E8 · Native batches and performance — **Sonnet**

**What.** `rt` also reads `.repack.json` (own JSON parser, with
tests) and renders whole projects: cameras × studios, animation
frames (use the same `evaluate` ported to Rust or receive an RSB per
frame generated by the interface: to be decided with Fable), 16-bit PNG
output and own EXR; `--bench` with a rays/s report per thread; profiling
and improvements to the BVH and sampling with before and after figures in the PR.

**Depends on.** E5, N1.

**Acceptance.** A 2 × 2 batch produces 4 images named by
template; `--bench` in CI leaves the number in the job summary (not
a gate); no determinism regression.

## U3 · Move tool and part operations — **Opus** — done

**What.** Everything in `SPEC.md` §3.1 “Operations on parts, KeyShot-style”:
translate, rotate and scale *gizmo* in the viewer (local
and global axes, increments, one undo entry per drag),
pivot (centre, base, origin, picked point), drop to surface, centre, reset
transform, set as camera target, duplicate and linked
duplicate, group, ungroup, move to group, linear and circular pattern
as instances, unlink and link materials, copy and paste
material, select by material, flip normals, smoothing, split
by CAD faces and by material; the full context menu of `UI.md` §2.2
and the numeric fields of the part inspector.

**Depends on.** U1.

**Acceptance.** `tests/transform.test.ts`: each operation as a pure action
with numbers (drop leaves `minZ = 0` for a group of three parts; circular
pattern of 6 leaves angles of 60°; linked duplicate shares `meshId` and
`materialId`, unlinking separates them; undo reverts each one);
capture with the *gizmo* on a selected part.

**Done.** `src/core/transform.ts` (composition and decomposition with
continuous Euler, local and global axes, pivots CENTER, BASE, ORIGIN and
CUSTOM in node space, common pivot in multi-selection,
increments with `Shift`), scene and material reducers (duplicate,
linked duplicate, group, ungroup, move to group keeping the
world position, linear and circular patterns as linked copies
under a group that remembers its parameters and regenerates when they are edited,
unlink, link with, copy and paste, select by material,
flip normals as a new mesh, smoothing, split by material,
`scene/aim` for lights), `src/render/gizmo.ts` drawn by the
preview in ink with axis letters and constant screen size, one
gesture per drag (one undo entry), the inspector's *Part* section
with draggable fields and proportional lock, the full context menu
of `UI.md` §2.2 with submenus and disabled entries, shortcuts
`M`, `L`/`G`, `Ctrl D`, `Ctrl ⇧ D`, `Ctrl G`, `Ctrl ⇧ G`, `Ctrl ⇧ C/V`;
URL parameter `tool`. 442 tests (37 new), 22 mutations checked;
in the browser: *gizmo* drag with a single undo entry,
ring and cube with increments, circular pattern edited live, pivot
by click, menus. Capture `docs/ui/move-tool.png`.

What did not fit the plan: `boundsOf` now measures the vertices of rotated
parts (this affects the Doctor and the framing, for the better); each click on the
viewer left a “move the camera” undo entry and was fixed with
`sameView` and its test; nodes store their `initial` transform for
*Reset* (the import sheet sets it after placing the model);
a non-uniform global scale on a rotated node loses the shear on
returning to position, rotation and scale; the circular pattern rotates around
the pivot, so with the pivot at the box's centre the copies
stack up until *Origin* or a point is chosen; regenerating a pattern removes
the children that are not originals; `buildMesh` and `sliceMesh` now live
in `core/meshes.ts` and are re-exported from `io`; the lights' aim handle
is tested only in the model because L4 does not yet create lights.

## U4 · Own library — **Sonnet** — done

**What.** `src/core/library.ts` and `src/io/library.ts`: save own materials,
light setups, product types and studios with a name and
thumbnail (rendered by the viewer like the catalogue's), a
*Mine* tab in each catalogue with rename and delete, persistence in
`localStorage` (in `try/catch`) and export and import as JSON with
a schema version. Factory presets are not edited: editing one creates
a copy of one's own.

**Depends on.** U1.

**Acceptance.** JSON round trip; an own material appears in the
command palette; deleting one in use does not break the scene (the instance
continues, now without an origin).

**Done.** `src/core/library.ts` (pure model: four collections with
`id`, name, date, thumbnail and origin; `fromMaterialInstance`,
`fromCurrentRig` with `share` normalised to 1, `fromCurrentProductType`,
`fromCurrentStudio`, `applyLibrarySetup` with the catalogue's exposure
normalisation, migration of `studio.saved`) and
`src/io/library.ts` (`repackshot-library` v1 wrapper that is both
the exported file and the single `localStorage` entry;
field-by-field validation, images only `data:image/png|jpeg|webp`, backup
copy if the storage is corrupt, retry without images if
it is full). Save material, setup, product type and studio with
an inline name field; thumbnails: catalogue sphere for
materials and a real 160 × 120 capture of the preview for
the rest (≈0.5 s with swiftshader, ≈3 KB). *Mine* tabs in materials,
light styles, product type and studios, with inline rename and delete,
and *Export / Import library* at the foot and in the menu; the palette
lists them as *Mine*. 504 tests (62 new), 40 mutations; in the
browser, an own setup applied to Watchmaking gives exactly its
irradiance (difference 0). Captures `docs/ui/library-*.png`.

What did not fit the plan: the library lives in `UiState` (user state,
like the theme), outside the history; own setups and types
are applied as `LIB:<id>` keys and their definition travels in the project
(`studio.customSetup`, `studio.customPreset`), so deleting the
item does not change the scene; deleting a material in use emits
`material/unlinkLibrary`, which is undoable but does not return the
item to the library; image textures do not travel in
own materials (M2); studios restore materials only onto
nodes with the same id, as `studio.saved` already did; the
160 × 120 capture uses the framing as is (the part comes out small); importing with
an existing id keeps the one that was there even if the content differs.

## L4 · Own lights — **Opus** — done

**What.** The content of `SPEC.md` §3.4 “Own lights, KeyShot-style”: add
lights (area rectangle, disc and sphere; point; directional spot with cone
and transition; sun), `LIGHT` nodes with their own transform moved and
aimed with U3's *gizmo*, *Aim at…*, *Place on surface*,
full properties (power in watts with lumens as auxiliary,
temperature or colour, size, spread, visible in reflections and to camera,
shadow, on/off), duplicate and delete, *Save setup as…* to U4's
library with exposure normalisation when applied to another product
type, *Reset to setup*. In the preview, each type with
its three.js light; in the engine, the corresponding `LGHT` sections (E3
already covers area and sun; point and directional spot are added to the integrator
here, with an energy test).

**Depends on.** U3, U4, E3.

**Acceptance.** An own setup of three lights saved and applied to
another product type keeps the type's total irradiance (test);
capture with a directional spot aimed at a part; native /
wasm parity stays green.

### L4 · Extension: lights and cameras in the viewer, “look through” (request from the owner, 2026-10-13)

“Integrate… lights, and the ability to move a camera and lights
as desired, also with panning.” Lead's decisions, within L4:
- Lights and **saved cameras** (not the active one) are drawn in the
  viewer as achromatic glyphs (panel outline, spot cone, point, sun
  arrow; camera pyramid), with a *Lights and cameras* button
  in the view bar, next to *Pan*, to show or hide them.
- They are selected with a click in the viewer or in their tabs, and are **moved and
  rotated with the *gizmo*** of *Move* (the light with its aim handle; the
  camera, with its target); one gesture, one undo entry.
- ***Look through*** the selected light or camera (button and `Ctrl/⌘
  ⇧ L`): the viewer looks from it and **Orbit, Pan and Zoom move that
  object** (the light aims where the viewer looks); `Esc` or the button return to
  the active camera. It respects *Lock camera*.

**Done.** *Own lights.* `LightType` gains `POINT` and `SPOT` and `LightShape`
gains `SPHERE` (added, not renamed). `core/lighting.ts`: own lights
are `LightInstance`s of `studio.lights` with `own: true`, in the same
list as those of the setup, with new optional fields (`name`, `blend`,
`shadow`, `aim` in part sizes from the pivot, `roll`), so an earlier
project, studio or library opens the same. `lightFrame`
(position, target, *up* with its roll), `placementOf`, `polarAboutPivot`,
`aimOffset`, `newLight` (in front of and above the part from the active
camera, with the mean irradiance of the lit ones; the sun, π times that) and the
actions `studio/addLight`, `duplicateLight`, `deleteLight`, `aimLight` and
`placeOnSurface`; `studio/resetLights` now removes own ones. Units of
points and spots (`core/photometry.ts`): **a point or spot of P W is as
bright on its axis as a panel of P W** (flux `π P S²` for the engine,
intensity `P S² / 4` for three.js), lumens from the engine's flux
(`lightLumens`, `spotFraction`). The library (`specOf`, the validators of
`io/library.ts`) carries type, shape, target, roll, transition and shadow.
`io/rsb.ts` writes `LGHT` 3 and 4, bit 2 *no shadow* and the rolled *up*
(without roll, `[0, 0, 1]` as before: the bytes of projects without
own lights do not change). Preview: three's `PointLight` and `SpotLight` with the
engine's intensity, panels rotated with their *up*. Engine (`rt-core`,
`light.rs`): uniform-radiance spheres sampled in their cone, points
by position, the spot's mask in *smoothstep* from the centre direction
(three's), camera and reflections with MIS, `LightSample::shadow` and the
integrator that does not trace the shadow of a light without it (nor in the
*shadow catcher*). Interface: *+ Add light* with its menu (and the header's *Add ▸*,
the empty viewer and the palette), the selected light's row with
duplicate, aim and delete, *Aim a light here ▸* in a part's menu,
the full inspector of `UI.md` §2.4 and the two *coming soon* items
removed (`lights.addSoon`, `lightEdit.moreSoon`).

*Lights and cameras in the viewer, Look through.* `core/view-objects.ts`:
`objectFrame` and `objectGizmoAction` (the *Move* *gizmo* on a light or
a saved camera: move without changing where it points, rotate its target and
the panel's roll, the aim handle; a locked camera has none),
`lookThroughCamera` and `lookThroughAction` (the view from the object and the
navigation that moves it; a spot sets the focal length to its cone), `glyphsOf`,
`pickGlyph` and `viewProjector`. The preview draws the glyphs on the
*gizmo* layer (dashed; the selected one, solid), the *gizmo*'s `MOVE` mode
(without cubes) and looks through; the tracer (wasm and native) renders
from the same camera (`setViewCamera`). `main.ts` turns the navigation
live, with a gesture *token* that is born when the gesture starts (one undo entry
per orbit, pan or wheel pull). In the view bar,
*Lights and cameras* (remembered) and *Look through*; `Ctrl/⌘ ⇧ L`, `Esc`
returns before anything else; a notice under the bar; double click and right click on
a glyph.

*Tests.* `tests/own-lights.test.ts` (20) and `tests/view-objects.test.ts`
(16): the criterion (an own setup of a panel, a spot and a point,
saved in Jewellery and applied to Watchmaking, Indoor furniture and
Standard, gives each type's total irradiance with the same distribution, the
same target and the same transition), add and undo, ids that do not collide,
duplicate and delete, reset, aim, roll, place on surface,
RSB round trip, the sun that places the sky from its target,
project and library, glyphs and their click, the light and camera *gizmo* (one
undo entry, the active camera still, the locked one without a *gizmo*),
*Look through* that moves the light and the camera and respects the lock, the
projection. In `rt-core`, 7 tests of `light.rs` (`I / d²` of the point and of the
sphere, its seen radiance, the cone and its transition, the cone's flux
against the interface's calculation, the tiny sphere as a point, the
selection of a narrow spot, the no-shadow mark) and 4 of the integrator (the
irradiance of points, spheres and spots on a white floor, the sphere
counted once with MIS, the dark outside the cone, the light without shadow that
passes through a slab). Mutations: 9 in the engine and 21 in TypeScript, all
detected in the end (the projector one escaped and gained a test).
`tools/lights-check.mjs` (Playwright, *Fast* and *Full*) checks the
menu, aiming at a part with a click, step-by-step undo, clicking the
glyphs (and that it picks nothing with the button off or in *Parts*), the *gizmo*
of a light and of a saved camera, *Look through* with orbit, undo and
`Esc`, and a locked camera that does not move; captures
`docs/ui/lights-add-menu.png`, `lights-spot-aimed.png`,
`lights-spot-full.png` (converged, canvas only),
`lights-glyphs-gizmo.png` and `lights-look-through.png`.

What did not fit the plan:

- **They are not `LIGHT` nodes of the tree.** The plan (and `SPEC.md` §3.1) says
  `LIGHT` nodes with their own transform, and U3 left `scene/aim` and the aim
  handle for them. But since U1 lights live in `studio.lights` and
  cameras in `camera.cameras`, and the preview, the
  engine, the animation (clips point at a light by its id), the Doctor,
  the studios, the library and the share bars all draw on that list. Two light systems
  would have duplicated everything and the setup's lights could not have been
  moved with the *gizmo*. Own lights are `LightInstance`s with their own
  placement (position, target and roll in part sizes from the pivot)
  and those of the setup gain the same; the *Parts* tree does not list them (*Lights*
  lists them). `scene/aim` stays as it was, unused. If Fable prefers
  nodes, it is a migration of `studio.lights`.
- **The watts of a point and of a spot** are not Cycles' (which would be π
  times darker): no recipe uses them, and this way a setup that mixes
  panels, points and spots keeps its balance and a new light with the
  mean irradiance looks like the others. A new sun is born with π times the
  mean (its measure is what arrives; a panel's, 1/π of what arrives on
  its axis), so its share bar looks larger. Lumens come out
  small on small parts (they are the real flux: watts are given
  for a 1 m part), and the inspector's note says so.
- **Glyphs are drawn only while working with lights or cameras**
  (lead's decision after the first capture): with the *Lights* or
  *Cameras* tab open, a light or a camera selected, or looking through;
  with *Parts* and a part, none. The lower edge of the *Standard* setup's main
  panel crossed the jar's shoulder like a straight line
  (the light is between the camera and the part, above): a second pass
  with depth would not have attenuated it, because it is in front. In addition,
  those not selected are **dashed**, like construction
  lines. *Lights and cameras* is on by default and is remembered.
- **The *Lights and cameras* button is to the left of *Pan***: U9
  left *Scale* to its right and the two decisions ask for “next to
  *Pan*”.
- **Aiming at the selection** moved to the part's context menu (*Aim
  a light here ▸*): the selection is one thing at a time, and when selecting a
  light the parts stop being selected; the row actions appear in the row
  of the selected light (on hover they moved under the click that
  selects the row) and its *aim at…* is the same menu as the inspector's.
- **Lock camera** applies to what is looked through when it is a
  camera (its own lock; the bar's button is still the active
  camera's). A light has no lock: looking through a light moves it
  even if the active camera is locked, and the active camera never moves
  when looking through. The active camera has no glyph and cannot be looked through
  (it is the view); to choose a saved camera without activating it, its
  glyph (the *Cameras* row activates it, as §2.2 says).
- **The selection box does not pick glyphs and *Scale* does not put a *gizmo* on a
  light or a camera**: the box selects parts at the level in force, and a
  light's size belongs to the inspector. The *Move* *gizmo* on them
  has no scale cubes.
- **The engine chooses a narrow spot as its point** when its cone spans
  the centre of the scene (and at a twentieth if not): by its flux, a 9° spot
  almost never came out against the dome and its circle of light was full
  of noise. Only the noise changes, not the mean; no scene without points or
  spots changes (no *hash* or image test has moved). New test:
  `a_narrow_spot_aimed_at_the_scene_is_chosen_like_its_point_light`.
- **Coordinates instead of a dropdown**: the inspector always shows X, Y, Z,
  like a part's position.
- For the checks, the viewer copies the selected object, where it is
  on the canvas and what is looked through into `data-object`, `data-object-at`
  and `data-look-through`, as the meter does with its numbers.

## L5 · IES lights — **Sonnet** — done

**What.** Own reader of the IES LM-63 format (public text) in
`rt-core`, IES-type light in the engine and in the preview (approximated
by a directional spot with the axis intensity), own RSB section,
and the type in *+ Add light*.

**Depends on.** L4, E5.

**Acceptance.** Two hand-written IES test profiles; the intensity
sampled at 0°, 30° and 60° matches the file.

**Done.**

*Reader* (`rt_core::ies`, `IesProfile::parse`). IES LM-63 text (1995 and
2002; also 1991, without a version line): `[KEY]` header with
`[MORE]`, `TILT=NONE`, the thirteen numbers, the angles and the candelas,
separated by spaces, tabs, commas or line breaks of any style.
**Type C photometry**; **types B and A are rejected** with their message (they are
not converted: it is a resampling of the sphere that nothing needs, because every
luminaire can be published in type C), and also `TILT=INCLUDE` and
`TILT=<file>`. Strict, with the reason and the file's numbers: counts
that do not match (too few, “truncated”; too many, “counts wrong”), angles that do not
increase or outside the standard's ranges (vertical 0–90, 0–180 or 90–180;
horizontal one, 0–90, 0–180, 90–270 or 0–360), values that are not numbers or
are not finite, negative candelas, non-positive multiplier, an all-zero table,
more than 2 MiB; before reserving anything it is checked that the numbers that
are there cover those the counts ask for. What the file says about lumens,
lamps, ballast, watts and aperture size is read and not used: the
file is the **shape** (divided by its peak) and the light gives the level.

*Distribution.* `intensity(γ, φ)` interpolates **bilinearly** in the
vertical and horizontal angle over the file's angles (they need not
be equally spaced), after reducing φ by the symmetry: round,
quadrant, bilateral 0–180, bilateral 90–270 and full; outside the vertical
range it is 0. Its frame is the light's: axis = `direction` (γ = 0), φ = 0 along
`up`, φ grows from `up` towards `up × direction`, counter-clockwise
looking along the axis from behind. The **flux** is integrated from the same
function that is evaluated, in closed form per cell (the trapezoid is exact in
φ and `∫ sin γ · linear(γ)` has an antiderivative): `4π c` for an isotropic profile
(with any symmetry and irregular grids, to 4·10⁻⁶), and for the hand-written
1000 cos² `2π · 1000 / 3` to the table's precision (0.5 % with 10° steps,
5·10⁻⁵ with 1° steps: it grows with h²), and against a numerical
quadrature of `intensity` over the sphere, to 1.5·10⁻³.

*Light* (`LightKind::Ies`, `Light::ies`, `LGHT` of type 5). A point or
small-sphere light of `power` W with a per-direction mask, by the same
path as the spot (cone that fills the sphere, delta position, MIS with the BSDF
rays, also to camera and in reflections): `mask = intensity(towards x) /
peak`. **The profile gives the shape and `power` the level**: as bright in its
brightest direction as the point of `power` W (like a spot on its axis),
so a profile written for 500 lm and another for 5000 give the same light and
changing a point for an IES light does not move the exposure; the interface's
multiplier is `power / base`, with `base` the power with which it entered (the
mean of the lit lights, like a new point). Light selection (E12):
per point, the weight `lum(I) · mask(x) / max(d², r²)` is exact; in the
static one (more than 64 entries, shadow catcher) a light **inside the sphere
enclosing the scene** weighs by its flux (that of the peak point times the
profile's efficiency, `flux / (4π · peak)`) and one outside it, like a
spot, by the intensity towards the scene's centre. It launches no photons. Measured
cost: the parity scene (the panel and two IES lights) takes 16 % longer than
the example with its panel (7.2 s against 8.3 s, 128 samples at 480 × 360 with 4
threads, 61 million rays both): the weight and shading of two more entries
in the per-point selection and the profile lookup.

*RSB.* `LGHT` kind 5 with one more word (the position of its profile: 80 B) and
the section `IESP` (the file's text, `u32` length, bytes and padding to 4)
once per distinct profile, after the lights. Files and scenes without
IES lights are as before, byte for byte (a test), and **no pinned hash
moved**. `rt_core::FEATURE_IES` (bit 3 of `rt_features`, value 8, after
bit 2 of Q1's section; the launcher's `features` goes from 7 to 15): the page writes the light as IES only when the
engine says so (`readsIes`, `SceneView.ies`, in the *pool*, `NativeEngine` and
*Export engine scene*) and, otherwise, as the spot that approximates it.
`rt --write-l5-example` (`example::l5_scene`: the example with its panel at
a fifth, a 24 mm sphere with the *downlight* profile and a warm point with the
*wall washer* rotated about its axis, 160 × 120),
`PINNED_L5_IES_4SPP` = `0x920f0be1` on the three SIMD paths, with 1, 4 and 16
threads, in WASI and with the real `rt.wasm`, and its parity block in
`.github/workflows/engine.yml`, which `tests/ies-engine.test.ts` repeats through
the page's code.

*Page.* `core/ies.ts` is the reader's port (the engine writes, in
`tests/fixtures/ies/conformance.json`, 68 files with what it does with each
one, sound and malformed; the page's reader repeats each rejection, with the
same message, and each name, symmetry, peak, flux and intensity). `LightInstance`
gains `type: 'IES'` and `ies: { name, text, base }`; it travels in the project, the
studios, `Save setup as…` (`LightSpec.ies`) and the library (the
validator requires a profile that the reader accepts; a damaged profile on opening a
project is removed and the light is a point). *+ Add light ▸ IES…* opens
the file (also dropping it on the window and the palette), one undo entry
(`studio/addIesLight`); a file that is no good adds nothing and says why,
in both languages. Inspector: profile name, **polar plot** drawn
from the file (C0–C180 solid, C90–C270 dashed, in greys),
peak, beam and symmetry, *Change…*, **multiplier** (instead of the watts) and
the lumens (the peak point's flux times the profile's efficiency). Fast
**approximates** it, and the inspector says so (rule 10), with a `SpotLight` of the
axis intensity and a cone whose transition is worth exactly half the
peak at the half-intensity half-angle (`iesSpot`); the viewer's glyphs
and *Look through* use the cone of that half-angle. **No manufacturer
profile is shipped**: the two test ones are hand-written
(`tests/fixtures/ies/`, with nothing from any luminaire) and each user brings their
own; this is stated in SPEC, UI and the *fixtures*' README.

*The criterion, with numbers.* The hand-written *downlight* (1000 cd peak,
1000 cos², a table at 10° steps) with the engine at 12 W, sampled in three
directions (the values are the candelas the engine gives, from the intensity
`P/4π · c/c_peak`, with their error against the file's measured in `f32`):

| γ | file (cd) | engine (cd) | error / peak |
| --- | --- | --- | --- |
| 0° | 1000 | 1000.0000 | 0 |
| 30° | 750 | 750.0000 | 0 |
| 60° | 250 | 250.0000 | 0 |
| 35° (between nodes) | 668.5 (linear; 1000 cos² would give 671.1) | 668.5001 | 6·10⁻⁸ |
| 45° | 500 | 500.0001 | 3·10⁻⁸ |
| 75° | 73.5 | 73.5001 | 6·10⁻⁸ |

The *wall washer* (900 cd, each side different) gives 560, 430, 330 and 380 cd at 60°
in C0, C90, C180 and C270, and 800 and 765 cd at the points between nodes (30° in C0 and
at 45° of azimuth), with the same error. The test's tolerance is **10⁻⁶ of the
peak**: the measured error is `f32` rounding (6.3·10⁻⁸; the angle comes back from
a vector through a good `atan2` at about 10⁻⁷ rad and the table's steepest slope
is 14 cd/°), sixteen times that and 2,600 times less than the 0.26 %
by which the smooth curve differs from the file at 35°, so an engine that
took the nearest node or the curve the numbers come from would fail.
And the same test by the image: a white Lambertian floor under the light, with
radiance `I(θ) cos³θ / h² / π`, to 8·10⁻⁶ (a normal point gives 6·10⁻⁶ with the
same formula), and the multiplier of 2 that doubles the light in the interface.

*Tests.* In `rt-core`: 20 of `ies` (the reader and its rejections, the flux,
the symmetries and conformance with the page), 7 of `light` (the criterion, orientation,
power and colour, the sphere with a profile, without a profile or axis, the per-point
selection and the static one; the “all classes” MIS test gains an IES
light), 2 of the integrator (the floor at 0°, 30° and 60° and the four sides of the
*wall washer*), 4 of `scene::rsb` (the profile once per distinct one, 80 B,
the earlier bytes, invalid ones and the update), the `render` pinned value
and, in `rt-cli`, 1, 4 and 16 threads and `--write-l5-example`. On the page:
`ies.test.ts` (85: conformance and the two profiles), `ies-lights.test.ts`
(17: add, undo, multiplier, lumens, setup, library,
studio, project, RSB, `l5.rsb` byte for byte, glyph and look through),
`ies-ui.test.ts` (11), `ies-switch.test.ts` (6: the *pool* and launcher
bit) and `ies-engine.test.ts` (with the real `rt.wasm`: the pinned hash and a
scene written by the page); `tools/ies-check.mjs` (Playwright, *Fast* and
*Full*: the menu, the file, the plot, the multiplier, *Change…*, the
rejected file; captures `docs/ui/ies-light.png` and `ies-light-full.png`).
Mutations: 9 in the engine (the fold of φ, its direction, the mask, the scene's radius
in the static weight, the slope term of the flux, the profile
deduplication, the interpolation in φ, the γ range and the normalisation by
the peak) and 1 on the page (the `FEATURE_IES` bit that
never reaches the view), all detected.

What did not fit the plan:

- **“Light selection by its flux, integrated from the file”**: per point, the
  profile's intensity towards the point being shaded **is** the exact weight
  (like the spot: the per-direction mask), and the flux counts for nothing there; in
  the static selection the file's flux is the correct measure only for
  a light **inside** the sphere enclosing the scene. Outside it, the intensity
  towards the scene rules, as was decided for the narrow spot in L4
  (a 10° beam with little flux, aimed at the part, is the light that counts
  most; weighting it by its flux left it full of noise again). The flux
  is integrated, tested against the closed cases and used in the interior static
  selection and in the inspector's lumens. If the lead prefers the total
  flux also outside, it is one line of `Lights::new`.
- **Types B and A rejected, not converted** (the brief said “rejected or
  converted if simple”; it is not: it is another angle system and another
  resampling, and everything people export for rendering is type C).
- **Level with which the light enters**: the profile is normalised by its peak and the light
  enters with the mean irradiance of the lit lights, like a new point
  (the profile's peak aimed at the pivot gives the same as the point). The file's
  absolute candelas do not count: the scenes here have Cycles watts, not physical ones
  (at 683 lm/W a real profile would give a black image). It is an
  exposure convention (the plan does not mark it as a lead's decision, but it is
  photographic): the lead may prefer to normalise by flux
  (a narrow beam would enter much brighter on its axis).
- **“A multiplier” is `power / base`**, not the candelas times a factor: the
  level is still `power` (what the Doctor, the animation, the
  studios, the share bars and the normalisation when applying a setup to
  another product type read) and the inspector shows that level as a multiple of the
  entry level. On applying a setup that carries an IES light, the multiplier
  goes back to × 1 (the power is renormalised).
- **`NEW_LIGHT_KINDS` does not gain `IES`**: an IES light needs its file, so
  it is born from another action (`studio/addIesLight`) and the menu, the palette
  and file dropping call it; the `IES` type does enter `LightType` and
  `LIGHT_TYPES` (added, not renamed). The type segmented control only
  offers *IES* to a light that has a profile.
- **Fast is an approximation and cannot be more**: a three.js `SpotLight`
  does not go beyond 90° of half-cone, so a wide profile (the *wall washer* has
  a 139° beam) or a lamp that does not fall to half (a bulb) is
  drawn as a hard-edged hemisphere: with no light backwards and without the soft
  falloff of the file. The inspector says so and *Full* gives the whole file.
- **The file does not set the light's size**: the dimensions of the file's luminous
  opening are ignored (the light is a point or a sphere of its own radius,
  a point's: 0.01 part sizes at birth).
- No caustics photons, like the point and the spot; **the reader is strict
  also with extra numbers** (more values than the counts is an error,
  they are not ignored): a file with junk at the end is rejected with its count.
- **`features` of `/api/info` adds bit 3** (`FEATURE_IES` = 8; with
  Q1's section it goes from 7 to 15): the assertion in `rt-app/tests/server.rs` that
  pinned it changes with the phase; it is the only earlier test that moved, and it
  is not a pixel one. Q1 took bit 2 (value 4) before L5 was integrated: the IES lights'
  is the next.
- `tools/lights-check.mjs` (L4) **fails in this environment at a step that is not L5's**:
  *activate Camera 1 from the menu* (after *New from the current view*); it fails the same at the
  session head `2505ed6`, so it does not serve as a gate for this phase beyond that point. Its check of
  the menu was updated (the *IES…* entry live) and `lights-add-menu.png` was regenerated.
- **`engine/README.md` is in English** (as each phase has left it); the L5 part
  goes there in English, like the rest of that file.

## L1 · Reflection placement, clear field, editable lights — **Sonnet**

**What.** Exact reflection placement with the Rust engine's `pick`
(mirror the camera ray about the picked normal and put the light at its
distance);
clear field per environment for `camera = true` (a soft disc in window
coordinates, apparent radius from the panel's size and distance,
bounded radiance), so that no light is ever seen as an object with
edges; light-by-light editing with `modified`; *Reset setup*.

**Depends on.** E4.

**Acceptance.** Geometric test: with a sphere and a click at its point
(x, y), the light ends up in the reflected direction (dot product > 0.999);
capture of BACKLIT, SILHOUETTE and ECLIPSE with the disc visible and no
rectangles.

## L2 · Own thumbnails — **Sonnet**

**What.** `tools/render-thumbs.mjs`: generates one RSB per thumbnail with
`src/io/rsb.ts` and renders them with the native `rt` binary (no
browser, in CI): the 72 light-setup thumbnails (160 × 120 and 64 × 64) with
the sample part in neutral grey, and the spheres of the 77 materials,
with the hash of their recipe in a `tEXt` chunk of the PNG; `--check` fails if
any is out of date and the suite runs it. It replaces the previous PNGs in
`public/thumbs/`.

**Depends on.** E4, E5 (so that the colour and glass ones come out right).

**Acceptance.** `--check` green in CI; changing a number in a setup
without regenerating makes the suite fail.

## L3 · Photographic review of the recipes — **Fable**

**What.** With the contact sheet from E3/E5 and the thumbnails from L2, review
the 72 setups and the 16 product-type rigs on the own engine and
adjust **data only** (`src/data/light-setups.ts`, `studios.ts`). What is
measured: one highlight per source with the shape of the source; less than 1 % of
the part's pixels blown out at exposure 0; mean luminance of the part
within ±0.3 EV between setups of the same product type; no
black areas above 5 % on light backgrounds; the thumbnail has the
brightness of the render.

**Starting data (light power correction, after U5).**
The recipes are now evaluated with the Cycles convention. With JEWELLERY, the
irradiance of the lights versus the dome on an upward-facing face is 2.31× in the far field and 1.4–1.9× integrating over the panel; the dome
still gives about half of the part's brightness, just as in
Blender with the same values. REMBRANDT versus NEON_NOIR change
48 % of the part's pixels (77 % without the dome). The balance between
lights and dome per product type is decided by Fable here;
`tools/setup-contrast.mjs` measures it.

**Depends on.** E5, L2.

## U7 · Dragging a material and box selection — **Sonnet** — done

**What.** Drag a material (a catalogue thumbnail, one from *Mine*, or
the material sphere of the selection) onto a part in the viewport or
onto a tree row, with highlighting (`UI.md` §2.2 and §2.3). With the
*Select* tool, box selection (window and crossing) at every level
(`UI.md` §4.1), which was added to the phase once it had started.

**Depends on.** U1, U4.

**Acceptance.** Drag-assignment rules as a pure action with numbers; box
selection tested on projected geometry; browser check with mouse, pen
and finger in *Fast* and *Full*.

**Done.**

*Dragging a material.* With pointer events, not with the browser's
drag and drop (a desktop webview does not always provide the
native session, and does not let you decide the ghost, the pen or `Esc`):
`src/ui/components/material-drag.ts` is the controller (5 px threshold,
ghost thumbnail above and to the right of the pointer, drop zones
registered per element, `Esc` in the capture phase, click swallowed after dragging; a finger does not drag and keeps its usual gesture). The
rules live in `src/core/material-drop.ts` and are tested with numbers: in
the viewport, a drop reaches what a click would select at the current
level (part, assembly, model or, at the *Faces* level, the whole face
under the cursor); on a tree row, the node and everything that hangs from
it. A catalogue preset or a library item enters with
**the instance that the scene already has of it** (the same one a click on
the thumbnail uses, so dropping and clicking leave the same project); the
selection's sphere links to **that instance**; with **`Alt`** the
drop gives **an own copy** (`material/assign` with `copy`, label
*assign a copy*). It is always **a single action** `material/assign` and
one undo entry, with the name of the material and of the target.
Highlighting: outline (the viewport's) on parts, tint on faces and
dashed border on the tree row, which also outlines in the viewport
what it would reach; the ghost shows *Copy* while `Alt` is held.
`src/core/materials.ts` gains `copy` and `material/assign` no longer creates
an entry when nothing changes.

*Box selection.* `src/core/box-select.ts` (pure, in screen
pixels) and `src/ui/panels/viewport-box.ts` (the gesture). **`Ctrl/⌘` +
drag** draws the box with *Select* and with *Move* (where there is no
handle under the pointer), in the three mouse schemes; without `Shift` or
`Alt` it **replaces** the selection, with `Shift` it **adds** and with `Alt`
it **removes**. Left to right is a **window** (what remains
entirely inside; continuous outline), right to left is **crossing**
(what it touches; dashed outline), both achromatic. At the *Part*,
*Group* or *Model* level the projected geometry is tested (bounding box
first, then the triangles; without looking at what covers what, as in
a CAD: a part behind another is also picked, and hidden ones do not
count); at the *Faces* level it picks whole faces (CAD or by continuity,
see **M1**) of a part, with the *X-ray* button in the view bar
to pick the hidden ones as well. A drag of a few pixels is a
click, `Esc` cancels, the pen does what the mouse does and a finger does not draw
a box (it keeps orbiting); the selection is not undoable (a box is not a
history entry). With the schemes that leave the left button free
(*Alt + left button orbits* and *Middle button orbits*), a plain
drag already draws the box and `Shift` adds without `Ctrl`; with
*Middle button*, `Alt` removes without `Ctrl`; with *Alt + left button*,
`Alt` is the orbit and removing is `Ctrl/⌘ + Alt`. Clicks do not change:
click selects, `Shift` click adds, `Ctrl/⌘` click toggles, `Alt`
click removes (except with *Alt + left button orbits*, where `Alt` belongs to
the camera). In *Full* the preview's geometry is used, just
like `pick`. New `ViewportPort` methods: `projection`,
`visibleTriangles` and `setHoverFaces`.

*Owner's decision on the gesture (2026-10-13).* The left button
still orbits by default, and **`Ctrl/⌘` + drag** is the box; the
first version armed the box with `Shift`, `Ctrl` or `Alt`. What
changes with respect to the previous viewport: with *Select* and *Move*, `Ctrl/⌘`
+ drag with the left button no longer pans (it was the hidden shortcut
of the orbit controls; the right button, the wheel and the
*Pan* tool remain). `Shift` + drag and `Alt` + drag do not arm
anything and do what the camera did before. The text of *Settings ▸
Preferences ▸ Viewport and navigation ▸ Mouse* and the tooltip of *Select*
say so in both languages, and it was checked in the browser that they do not
overflow (the Settings row goes to four lines and the tooltip fits in
its 280 px).

*Tests.* 89 new tests (25 in `material-drop.test.ts`, 35 in
`box-select.test.ts` and the 29 from M1 in `faces.test.ts`; 1031 in total);
63 mutations of the unit tests, all detected except two
equivalent ones (F9, and the one where `Ctrl` does not arm in *Alt + left button
orbits*, which already arms earlier through another branch), and 16 in the browser, all
except one order guard between the drop highlight and the hover outline
that the browser cannot observe.
`tools/material-drag-check.mjs` and `tools/box-select-check.mjs`
(Playwright with the local Chromium, in *Fast* and *Full*, with mouse,
pen and finger); captures `docs/ui/material-drag.png`,
`material-drag-tree.png`, `material-drag-faces.png`, `box-window.png`,
`box-crossing.png` and `box-faces.png`. The *Full* ones, which are very
heavy, are written to `out/` and do not go into the repository.

**What did not fit the plan:**

- **A drop on a target with different materials keeps the inline
  question from `UI.md` §4.1** (*Replace all · Keep existing · Cancel*, with an inventory): it is the case of dropping on
  a group or a model whose parts carry different materials. The
  phase asked for "a single action" and it is one (a single undo entry
  once answered), but it is not applied blindly. If it is preferred that a
  drop replace without asking, that is an interface decision (Fable);
  in the meantime §4.1 applies.
- **At the *Faces* level the catalogue only appears when a face is
  selected**, so there is no thumbnail to drag before
  picking the first one; the drop lands on **the face under the cursor**, not on
  the selected ones.
- **The drag highlight ignores the *Outline on hover* setting:**
  without it, dropping would have no signal of where it is going.
- **A finger neither drags nor draws a box** (it keeps what it did:
  panning the panels and orbiting); the pen is a mouse.
- **The box does not show a preview of what it will pick:** only the
  rectangle; the selection changes on release.
- **In the default scheme the box is not drawn with a plain drag**,
  but with `Ctrl/⌘` + drag (owner's decision): the
  left button orbits and a box with a plain drag would take the orbit away from it. Whoever wants it without a key can choose the
  *Alt + left button orbits* or *Middle button orbits* scheme.
- Two structural things: `Alt` clicks on the viewport go through
  `clickMods` to respect the *Alt + left button orbits* scheme,
  and `ViewportPort` was extended with three methods (`ARCHITECTURE.md`
  §6.1).

## M1 · Whole CAD face — **Sonnet** — done

**What.** Face selection by surface continuity: adjacency
by vertex **position**
(welding at 1e-5 of the mesh size), edge crossing if the dihedral is
smaller than the sharp-edge angle (30°) **and** smaller than 2.5 times the
clicked face's own curvature; edges marked by the
importer always cut; `Shift` gives the single triangle. With STEP (I2),
the original face ranges win.

**Depends on.** U1, I1.

**Acceptance.** Tests with a plate, a plate with duplicated vertices, a cylinder
with caps (the whole wall, stops at the caps), a flat-fillet-wall
profile, a marked edge. Verify that each one fails if its condition is
removed.

**Done.** `src/core/faces.ts` (pure model): `cadFaceRegion` grows
the face from the picked triangle with the rules above and, on
a STEP or IGES part, returns the CAD range that contains it (the
ranges win); the topology is computed once per mesh and stored in
a `WeakMap`. In the viewport, at the *Faces* level a click picks **the whole
face**: a plain click replaces, `Shift` adds **a single triangle**,
`Ctrl/⌘` toggles the whole face and `Alt` removes it; when dragging a
material the face that would receive it is tinted (`ViewportPort.setHoverFaces`).
*Separate by CAD faces* (`scene/separateByCadFaces`) stops being
*coming soon*: it is in the part menu and in the import sheet
(which now uses the same `facePieces`), each new part keeps the
colour of its face, the selection follows the parts and the level goes from
*Faces* to *Part*. The action shares `replaceByPieces` with *Separate by
material*. In addition, box selection (see **U7**) picks whole faces.
29 new tests (`tests/faces.test.ts`: plate, plate with duplicated
vertices, cylinder with caps, flat-fillet-wall profile, marked
edge, CAD ranges, separated parts; the mutations are counted in
**U7**); captures `docs/ui/box-faces.png` and
`docs/ui/material-drag-faces.png`; checked in the browser with
`tests/fixtures/box.step` (six CAD faces).

**What did not fit the plan:**

- **Edge limit with smooth curvature (pending judgement call for
  Fable).** The curvature estimate only counts the edges that
  could be crossed (test *a flat face is flat to its rim*): if it also counted
  the ones that are a boundary (marked or sharper than 30°), a
  triangle on the edge of a flat face, next to a wall, would measure the
  curvature of the corner and the face would escape through a chamfer. What remains
  is the case that a click on a mesh cannot distinguish: a triangle on the edge of a flat face whose only
  turning edge is a smooth fillet (a few degrees per step)
  looks like a facet of a curved face, and the face follows the fillet; the
  interior of the same flat face does not. It does not affect STEP or IGES (the
  ranges do not hesitate) and the header of `faces.ts` explains it. Data to
  decide whether it is enough or a mesh criterion is needed (for example,
  measuring the curvature inside the region already picked): nothing has been
  changed unilaterally.
- **Loose `Shift` and `Shift` adds.** M1 asked for "`Shift` gives the
  single triangle" and `UI.md` §4.1 "`Shift` adds": at the *Faces* level,
  `Shift` does both, `Shift` click **adds the single
  triangle**. Since `Shift` only makes the triangle single and the other
  keys keep their meaning, `Ctrl/⌘ ⇧` click toggles it and `Alt
  ⇧` click removes it (with *Alt + left button orbits*, where `Alt` belongs
  to the camera, there is no `Alt ⇧`); `Ctrl/⌘` and `Alt` without `Shift` act
  on the whole face.
- **The face box works on a single part** (`Selection.faces`
  is `{part, indices}`): the selected one and, if there is none, the one at
  the centre of the box. Without *X-ray* it only picks what is visible, measured
  with an identifier pass of the viewport (one id per triangle, with
  a one-pixel erosion so that the silhouettes of hidden things do not
  count), so a face narrower than about 3 px is not picked; with
  *X-ray* it also picks the hidden ones, by geometry.
- ***Separate by CAD faces* only exists for parts with ranges** that
  cover the mesh (`canSeparateByFaces`); on a mesh without them it stays
  disabled instead of splitting by continuity.
- **The counter says *faces* and counts triangles** (`inspector.faces`:
  a whole six-CAD-face cube says *12 faces of* its part): the data
  model stores triangles. Counting CAD faces requires also storing
  which ranges were picked; noted for later.
- **A click does not tint the face before picking it**: when hovering without
  dragging anything, at the *Faces* level only the part is outlined; the face
  is seen when it is picked. The preview tint is only that of the
  dragged material.
- The help that `UI.md` called `faceSel.help` does not exist under that
  name: it was `level.tip.FACES`, which no longer says "coming soon" (it was
  rewritten), and `ops.separateCadSoon` was removed.
- Fixes for failures that were already there: the inspector was not rebuilt when
  the first face was picked (`contextKey` did not distinguish whether there were faces;
  with a test), and `material/assign` without changes created an empty undo
  entry (it now returns the same state; with a test).

## U9 · Primitives and scale tool — **Opus** — done

**Request (2026-10-13):** add simple geometries (base rectangles,
cylinders, spheres…), plus the usual scale section alongside panning,
besides being able to scale each part with a right click.

**Lead's decisions.**
- **Add ▸ Primitive** (the *Add* menu in the header, the `+` button of the
  *Scene* panel, the command palette and the viewport's context menu on
  empty space): *Box* (with bevel radius), *Plane*, *Disc*, *Cylinder*,
  *Pedestal* (bevelled cylinder), *Sphere*, *Cone*, *Torus*, *Capsule*,
  *Tube*, *Steps* and *Infinity sweep* (the studio curve: a floor that
  rises in a curve into a wall). Stable keys in a data catalogue.
- **Parametric and live**: each primitive stores its type and its measurements in
  mm (width, depth, height, radius, bevel, segments…), editable in the
  inspector (*Primitive* section); changing a measurement regenerates the mesh with
  **one store action** and one undo entry (a drag, a
  single one). *Convert to mesh* freezes it.
- **Default size and place with a studio criterion**: it is created resting
  on the floor, next to the product or below it if it is a base (the *Box* and
  the *Pedestal* are born as a base: 1.4 × the product's footprint and the product
  resting on top), scaled to the scene; without a product, at a reasonable
  size. Neutral material from the catalogue.
- **Clean geometry**: pure, deterministic generation in `src/core/`,
  correct normals and UVs (for M2), smoothing by angle, and **CAD faces**
  (`faceRanges`) per logical face (the cap, the side, the bevel…), so
  that the *Faces* level and M1 work with them.
- **Project**: the primitive is saved as parameters (not as a mesh) in
  an optional field of the node; *schema* 2 remains valid and an old project
  opens the same. The engine receives it as one more mesh (RSB
  unchanged).
- **The *Scale* tool** (`S`) in the view bar, next to
  *Pan*: the same gizmo as *Move* but with only the scale handles
  (per axis and uniform at the centre), around the pivot, in local
  or global axes, with increments with `Shift`; the inspector shows
  the scale live. One drag, one undo entry.
- **Right click ▸ Scale…** on a part (viewport and tree): an inline
  panel with *Uniform* (%), per axis (X, Y, Z in %) or **to size** (mm of
  width, depth or height with locked proportion), *Apply* and *Reset
  scale*; it acts on the selection at the current level.

**Acceptance.** Tests of each primitive (closed where it must be, normals
outwards, UVs in [0, 1], `faceRanges` that cover the mesh, determinism,
exact measurements in mm), of the undoable regeneration, of saving and
opening, of scaling per axis, uniform and to size (around the
pivot, at each level); captures of the menu, the inspector and the
tool; strings in `es` and `en`; achromatic chrome.

**Done.** `src/data/primitives.json` (+ `primitives.ts`): the twelve shapes
with stable keys (`BOX`, `PLANE`, `DISC`, `CYLINDER`, `PEDESTAL`,
`SPHERE`, `CONE`, `TORUS`, `CAPSULE`, `TUBE`, `STEPS`, `SWEEP`), their role
(`BASE`, `FLOOR`, `BACKDROP`, `OBJECT`), their measurements (keys, minimums,
steps, scene-size factor or fixed value) and the neutral material
`WHITE_STUDIO`; the names and the labels of the measurements are interface
strings. `src/core/primitives.ts`: pure and deterministic generators,
in mm, Z up, **centred on their box** (which is exactly their measurements:
exact sines and cosines at multiples of 90°, no `h − b + b`), with
a builder that orients each triangle towards its normals and removes
slivers; surfaces of revolution with per-segment poles (the tip of the
cone has the normal of its facet), a rounded box with edges and corners
that meet bit for bit (symmetric quarter-turn table),
steps on a grid without T-junctions, unrolled infinity sweep;
watertight except plane, disc and sweep; surface normals within
each logical face; UVs in [0, 1] per face and unstretched; each logical face is
a `faceRanges` range (and its edge, a sharp edge), so *Faces*, M1 and
*Separate by CAD faces* work; measurements bounded to what a shape allows;
the mesh id `prim:<owner>:<SHAPE>:<measurements>` names content and owner.
`src/core/primitive-ops.ts`: `placePrimitive` (base 1.4 × the footprint under
the product, with the product on top; planes under it, one thousandth above the
floor; the rest next to whatever stands; without a product, at the origin and
framed), `fitSweep` (the lead's decision during the phase, after seeing the
first captures: the infinity sweep facing the active camera, rotated about
Z to its azimuth, the wall at 1.75 depths from the product behind it and behind
the setup's lights that sit behind the product
(`wallBehindLights`), width 1.3 times the framing where it touches it, above
the top of the framing, curve of 0.3 times the height;
*Fit to camera* redoes it with `scene/fitPrimitive`), and the actions `scene/addPrimitive` (one
undo entry with the lift), `scene/setPrimitive` (regenerates, keeps the
support, drags the linked copies along, the per-face materials and the selected
faces follow their faces by name) and `scene/convertPrimitive`.
`SceneNode.primitive` is the optional project field: `io/project.ts`
does not write those meshes and regenerates them on opening (schema 2, byte for byte).
*Scale* tool (`S`, next to *Pan*): the gizmo with only
scale handles (`Gizmo.setMode('SCALE')`, cubes at the end of whole axes
that can be grabbed, and the central point; one more cube length doubles);
*Right click ▸ Scale…* with `ui/panels/scale-panel.ts` (uniform, per
axis, to size with a lock, *Apply* and *Reset scale* =
`scene/resetScale`) in the viewport and in the tree; `selectionExtents` measures the
selection in the axes in force. *Add ▸ Primitive* in the header
menu, the `+` of the *Scene* panel, the palette (*Add box*…) and the viewport
menu on empty space; *Primitive* section of the inspector with *Convert to
mesh*, which is also in *Geometry ▸*. Tests: `tests/primitives.test.ts`
(each shape: same bytes, exact and centred box, UVs, normals, faces that
cover the mesh, watertightness, sharp edges, analytic volumes, bounded
measurements, id) and `tests/primitive-ops.test.ts` (placement, base and footprint,
product on top, one undo entry, locked product, planes and
sweep, the light pivot and the scale that do not see the set dressing, live editing and
undo, linked and independent copies, painted and
selected faces, convert, save and open byte for byte, unknown shape and
out-of-range measurements in a file, uniform scale, per axis (also in
local axes) and to size around the pivot at the *Model*, *Group* and
*Part* levels, *Reset scale*, the *Scale* handles, the shortcut and the
strings). `tools/primitives-check.mjs` checks it in the browser in
*Fast* and *Full* and takes the captures `docs/ui/primitives-add-menu.png`,
`primitives-base-box.png`, `primitives-pedestal.png`,
`primitives-pedestal-full.png`, `primitive-inspector.png`,
`scale-tool.png` and `scale-panel.png`, and it also checks with pixels
that the infinity sweep fills the framing (corners and centre of the top edge
light, not the dark dome) and that *Fit to camera* refills it
after orbiting. 133 new tests (91 in `primitives.test.ts` and 42
in `primitive-ops.test.ts`; 1627 in total); 42 mutations of the new code,
all detected (five were not at first: the UV clamping
hid a bad mapping and was removed, and the cone tip's normal, the
per-face materials that shift, what stands next to a sweep
and a sweep that moves away along its curve had no test or had one that was too
permissive; the tests were fixed).

**What did not fit the plan:**

- **The product, not the set dressing.** An infinity sweep six times larger than
  the product moved the lights' pivot (`rigPivot` was the centre of the
  scene), the framing of *Create studio*, the measured size (and the Doctor's
  scale check, whose fix would rescale everything) and the shadow
  map. Now all of them measure `productBounds`: the parts that are not
  primitives (if there are only primitives, all of them). It is an architecture
  criterion that was not in the plan; *Frame all* still
  frames everything. If Fable prefers to mark the set dressing another way (for
  example, only bases and sweeps, not any primitive), it is a change to
  one function.
- **The part size** is now also detected when the first product enters a
  scene that only had primitives (before, only in an empty
  scene).
- **Centred meshes, not resting on their origin**: the Doctor warned of an
  off-centre origin on every primitive and its fix moved it. The
  part keeps its support when changing measurements by the centre of the base of
  its box, in its own axes.
- **Planes, discs and infinity sweeps one thousandth above the floor**: their top
  face is where the studio floor is, which in the engine is a *shadow
  catcher*, and a distance tie between the two flickers. Above it,
  the geometry wins, and it receives real shadows in *Full*; in
  *Fast* the contact shadow stays under the sweep (the preview only
  draws it on the floor). The studio floor is not switched off when adding
  a sweep: that is a photographic decision (Fable).
- **A version prior to U9 does not see the primitives** of a new project
  (there is no mesh in the file; it opens with the missing-geometry warning):
  compatibility is backward, as requested.
- **Changing the measurements of a base does not raise the product again**, and
  a new base under a product that already sits on another goes to the floor (the
  product rests on the new one). A part scaled with *Scale* still
  shows its unscaled measurements in the *Primitive* section (the note
  says so).
- **Flip normals, Smoothing and Separate freeze the primitive** (they stop
  being parametric), because their mesh is no longer the one of their measurements.
- **The infinity sweep fits the camera**, not the world axes
  (the lead's request mid-phase): the first captures let the dark
  environment show in one corner of the framing. If the curve would reach under
  the product (a very flat product in depth), the wall moves further than
  the 1.75 depths. Moving the camera afterwards does not readjust it on its own: that is what
  *Fit to camera* is for. The test casts rays through a 7 × 7 grid
  of the framing in eight cameras (front, top-down, orthographic, tele in
  portrait, square wide angle, a thin product) and all of them hit the
  sweep.
- **An infinity sweep covered the lights that sit behind its wall
  (decided by Fable mid-phase).** With the *Standard* setup and the
  reference camera, the backlight (*RIM*, 70 W, about 290 mm behind
  the product) ended up behind the wall, which was at 154 mm: in
  *Full* the wall blocked it and the image came out flatter and greyer than in
  *Fast* (the preview does not cast shadows from lights). **Decision:** a
  photographer places the paper far enough back for the backlight and the
  rear lights to fit between the product and the backdrop, so the light that
  the owner chose keeps working. `fitSweep` (when adding and in
  *Fit to camera*) moves the wall behind each lit light of the
  setup that is behind the product according to the camera's direction, to
  1.25 times how far that light is behind the centre of the product plus half
  of its panel (`SWEEP_FIT.lights`, `wallBehindLights`; a sun does not
  count), and then computes width, height and curve to cover the framing at
  that distance as before. In the reference view the wall goes from
  154 mm to about 480 mm. Rear lights that end up inside the framing
  are outside this decision. Test: with the *Standard* setup and the
  reference camera no light is left behind the wall (it fails with the
  old distance), and without lights behind it the wall is again at 1.75
  depths.
- **The name of *Add*.** There is no *Add* menu of its own in the header
  (UI.md §2.1 lists nothing beyond the application menu): it is an *Add ▸* entry of the application
  menu, with the label *Primitive* and the twelve shapes below it.
- *Scale…* in the context menu shows no shortcut (`S` switches the
  tool on, it does not open the panel). The modifiers of the selection box and of the clicks
  are those of *Move*.
## U10 · Guided tour and AI notices — **Sonnet** — done

**Request (2026-10-13):** warn if the *inference runtime* is not installed;
on the first launch of the app, a tutorial that can be skipped but that
guides through all the options; when installing, if the AI is selected,
ask to install the *inference runtime* too.

**Lead's decisions.**
- **Guided tour** on first launch (and from *Help ▸ Guided
  tour*): a layer of its own (never browser windows) that highlights
  each area in order — header and menu, tree and selection levels,
  view tools (Select, Move, Scale, Orbit, Pan,
  Zoom, box with `Ctrl`), *Fast/Full*, inspector (product, light and
  setups, environment and sky, camera and click-to-focus, materials and
  dragging), tabs for lights, cameras and studios, *Add ▸ Primitive*,
  render window (queue, AI), results viewer and *Settings* by
  sections — with a short text per step, *Next · Back · Skip*,
  progress dots and keyboard (`→`, `←`, `Esc`); in `es` and `en`;
  achromatic; it uses the `data-guide` attributes that already exist. Whether it has been seen is remembered in the platform state
  (data folder on desktop); *Skip*
  counts as seen.
- **AI runtime notice**: if there is an AI model and the AI
  runtime is missing (or Visual C++ is missing), the AI section of the
  render window and *Settings ▸ AI post-processing* say so with an
  *Install* button; at startup, a discreet note in the status bar, only
  once per session.
- **Installer**: if any model is chosen in the *AI models* step, the
  **AI runtime** recommended for the machine is also ticked
  (Vulkan with a GPU, CPU without one), it can be unticked, and the app
  downloads it on first launch like the models (the rule from P2: the
  installer chooses, the app downloads). The same in the first-launch
  chooser of the portables.

**Acceptance.** Tests of the tour order (every step points at something
that exists; no step points at a hidden element), of *Skip* and of
the memory (it does not come back; it does from *Help*), of the notice with and without an AI
runtime, of the installer's choice file with the runtime
included (and of the NSIS script that writes it); captures of three steps and of the notice.

**Done.** *Guided tour* (`src/ui/tour.ts`, `src/ui/panels/tour.ts`,
`src/ui/tour.css`; `UI.md` §4.7): 30 steps on the web and 31 on desktop,
in the order above (welcome, menu, parts and levels, tools,
*Fast/Full*, product, light, environment, camera, materials, the three
tabs, *Add ▸ Primitive*, *Render…*, render window, queue, AI,
results, one Settings section per step and the closing), with short text in
`es` and `en`, *Next · Back · Skip*, one dot per step and `→ ← Esc`. It is
modal (it keeps the pointer and all the keys: `Del` does not delete beneath
it), achromatic, and locates the areas by the `data-guide` attributes (those of the guide and
the new ones). A step whose area is not in view brings it into view (tab, side
panel —in a narrow window only the one that is needed—, render window
or Settings window, *Queue* drawer, material catalogue, selection) and when everything finishes
everything goes back to how it was; a step whose area does not appear within 0.7 s is skipped.
The card goes beside the area, outside the render window or
Settings when there is room and, if not, inside, where it does not cover any control.
*Skip*, *Done* and `Esc` count as seen: `layout.tourSeen` in the
settings document (the data folder on desktop, nothing in browser
storage there). It appears only on first launch, after the
model chooser of a portable, and from *Help ▸ Guided tour* (a new
submenu of the application menu, and the palette).

*AI runtime notice*: `runtimeWarning` (`core/ai-runtimes.ts`, pure)
says what is happening with an installed model —missing, paused, downloading, does not
start, Visual C++ missing on Windows, no build for the system—;
`ui/ai-runtime-state.ts` holds the single launcher probe; the box with
*Install · 26 MB* (the flow of the runtime row in Settings), *Resume*,
*Pause*, *Install Microsoft Visual C++ runtime…* and *Check again*
appears in the AI section of the render window (with a mark on its
collapsed title) and at the top of *Settings ▸ AI post-processing*, and the status bar
carries a discreet note once per session. **Installer**: `repackshot
--hardware` writes `[runtime]` (the build chosen by the rule in
`ai-runtimes.json` for the system; with `--device cpu`, the CPU one), the
*AI models* step ticks the box when the first model is chosen, it can be
unticked and writes `"runtime"` into `pending-models.json`; the launcher
downloads it on first launch (`Ai::start_pending_runtime`); the first-launch
chooser of a portable offers it equally and downloads it with the first
model. Tests: the rule, the notice table, the probe, the note once per
session and the buttons (`tests/ai-runtime-warning.test.ts`); the tour
order, that each anchor exists in the code, that each step opens what it
needs and gives it back, *Skip* and what is remembered, when it starts, the keys, the
card and the texts in both languages (`tests/tour.test.ts`); the NSIS script read
as text against the launcher (`engine/crates/rt-app/tests/installer.rs`,
`tests/installer-page.test.ts`); the launcher downloading what the installer
left, over sockets with the real `curl` and a local server, and downloading
nothing with a key from another system, an unknown one or one without a runtime
(`tests/ai.rs`). Browser checks: `tools/tour-check.mjs` (the whole
tour, wide, narrow and in Spanish, with its captures) and
`tools/ai-runtime-check.mjs` (against the real launcher: chooser, notices, note,
Visual C++ and the state in the data folder). Each test fails if what it guards
is broken. Captures in `docs/ui/`: `tour-tools.png`,
`tour-camera.png`, `tour-render-ai.png`, `tour-settings-es.png`,
`ai-runtime-warning-render.png`, `ai-runtime-warning-settings.png`,
`ai-runtime-warning-vc.png`, `ai-runtime-chooser.png`, `ai-runtime-note.png`.

**What did not fit the plan.** (1) The installer's *Run on the processor*
was not applied to anything: so that the runtime the installer ticks is the one
the application expects, the first launch turns it into *Settings ▸
AI post-processing ▸ Run on* (`applyInstallerChoice`); this is a decision
that was not in the plan. (2) The installer page cannot be seen here
(*makensis* compiles it with `-WX`, but Wine does not run an NSIS installer):
its logic is covered as text, and it remains to check on a real Windows that the new
row fits on the page with six two-line models. (3) The download
of the runtime from the installer, end to end, cannot be
tested here either; the launcher (sockets) and the page (real launcher) can. (4) A missing
Visual C++ cannot be produced on Linux: the browser tests it with the
launcher's response altered. (5) The card of a Settings step goes
inside the window, where it covers no control but does cover description text; a section that is all controls would put it in the lower right corner.
(6) Whoever updates from an earlier version sees the
tour once (there is no earlier mark to distinguish it from a first
launch). (7) *Help ▸* groups what used to be three separate entries
(*Guide*, *Shortcuts*, *About*); the six-step *Guide* stays as it was and
the tour does not replace it. (8) With the models still downloading (the
installer left them pending) there is no notice: "there is a model" means an
installed model.

## M2 · Image textures and labels — **Opus** — superseded by M2a and M2b

**Note (Fable, after v0.1.5).** This phase is split into M2a (no engine:
import, slots, labels, preview and RSB contract) and M2b (the
engine), defined further up in “Materials and sets with an effect”. The following text
is kept as the origin.

**What.** Colour, roughness, metal, normal and alpha textures with
box, planar, cylindrical and UV projection, scale, rotation and offset; labels:
an image with alpha projected onto an area of the part,
placed with click and drag, with its own finish (a different gloss from the
substrate). It is the most used feature in packaging and cosmetics. The
images travel to the engine as RSB sections of their own.

**Depends on.** E5.

**Acceptance.** Capture with a labelled bottle; box projection test
(a cube receives the texture unstretched on all six faces); the project
saves the embedded images.

## N1 · Animation and video in the KeyShot style — **Opus** — done

**What.** Replace the editor from U1 (shots + cards) with the model of
`SPEC.md` §3.7 and the interface of `UI.md` §2.5, which follow how
KeyShot's works: a single timeline with **one track per target** and
draggable, stretchable **bars**; the **camera track** with spans
of active camera and **camera change** events (cut or fade to
colour); the **animation wizard** in three steps (type in a grid of
grouped cards, target, parameters) inline in the inspector; the
**animation inspector** with timing curve (including *custom*
with two handles), reverse and repeat; the animations **under their target
in the tree**; playback with playhead, fps, loop and fast preview.
New types in `src/data/animation.ts` without renaming the existing ones:
`FADE`, `PAN`, `MATERIAL_COLOR`, `SUN_ARC` (the latter is enabled with E5),
`PATH` reserved. A complete `evaluate(state, t)` for all types,
composition per target and visible conflicts; exploded view (centre,
layout, factor). Migration of the U1 state: the shots become
spans of the camera track and the movements become bars, losing nothing
(test with a saved U1 project). **Output**: *Animation* mode in
the render bar (range, fps, video or frames, per-frame budget,
estimate), one RSB per frame rendered by the worker pool,
encoding in the browser (WebCodecs → WebM/MP4; PNG/JPEG sequence as an
always-available alternative), animation jobs in
the queue. The *rendered preview* (engine at a few samples per frame)
and the crossfade are left for later and marked *coming soon*.

**Depends on.** U1, U3 (the pivot and the local axes of rotations),
E4 (for the rendered output; the timeline and the fast preview
do not depend on it and can go earlier).

**Acceptance.** `evaluate` tests with numbers (a 90° orbit in 4 s at
the midpoint with *soft* gives 45°; rotation with a pivot on another part keeps
the distance to that pivot; `FADE` reversed and repeated 2 times gives the
expected value at 5 instants; a custom curve with handles at (0.42, 0) and
(0.58, 1) matches the reference one ±1e-3); the 16 presets produce
a valid state at every frame; a bar dragged on the
timeline produces a single undo entry; the U1 project migrates with
the same result at `t = 2 s`; a 2 s video at 12 fps comes out and
plays; capture of the timeline with three tracks and the wizard
open at step 1.

**Do not touch.** The existing keys of `MOVE_KINDS` and
`SEQUENCE_PRESETS` (they are added to, not renamed); the engine (`engine/`).

**Audit at the start** (on `main` at v0.1.15, point by point from the
brief and the acceptance criteria; N6 and U5 had already built part of it):

| Point | State at the start | From which phase | What N1 did |
| --- | --- | --- | --- |
| A timeline with one track per target and draggable, stretchable bars | Done | N6: tree of what is animated + lanes, magnet, one drag = one undo entry | Nothing to redo; new rows for materials |
| Camera track with spans of active camera | Done | N6 (spans, draggable edge, the shot's camera in its menu) | Click on a span: its properties |
| Camera change: cut or fade to colour | Partial: only the implicit cut at the edge of a shot | U1, N6 | `Shot.transition`: cut or fade to black or white with duration; shot properties, mark on the track, the viewport and every frame |
| Three-step wizard (type in a grid of grouped cards, target, parameters), inline | Partial: three sections at once, the type in a list | U1; N6 put the selection's target | Three steps with *Back* and *Next*, the grouped card grid; target first (N6's order) |
| Animation inspector: timing curve, *custom* with two handles | Partial: curve with preview, no custom | N6 | `CUSTOM` with the two-handle editor |
| Reverse and repeat | Done | N6 (`reverse`, `repeat`) | Tested in the `FADE` criterion |
| The animations under their target in the tree | Missing | — | Under parts, groups and the model |
| Playback: playhead, fps, loop, fast preview | Done | U1, N6 | The fades, colours and the sun in the fast preview |
| Types `FADE`, `PAN`, `MATERIAL_COLOR`, `SUN_ARC`, `PATH` reserved | Missing | — | All five, at the end of `MOVE_KINDS` |
| Complete `evaluate`, composition per target, visible conflicts | Partial: the types of the time; conflicts marked | U1, N6 | The new types, the pivot of a rotation, the material target |
| Exploded view (centre, layout, factor) | Done | N6 | — |
| Migration of the U1 state (shots to spans, movements to bars), with a U1 project | Partial: N6's model is U1's (shots and clips) and it is read; no test said it reproduces the same | N6, U2 (`project-v1.json`) | Test with `project-v1.json` against the poses that U1's code gave |
| Output: *Animation* mode (range, fps, video or frames, per-frame budget, estimate) | Done except the video | U5 | The video |
| One RSB per frame rendered by the pool | Done | U5 | — |
| Encoding in the browser (WebCodecs → WebM/MP4), sequence always available | Missing (*coming soon*); the Doctor's `output` dormant | U5, D1 | WebCodecs, own muxers, the Doctor connected |
| Animation jobs in the queue | Done | U5 | Video jobs |
| Rendered preview and crossfade: *coming soon* | — | — | They remain *coming soon* |
| Criterion: 90° orbit in 4 s at the midpoint with *soft* gives 45° | Done | U1 (`tests/animation.test.ts`) | — |
| Criterion: rotation with a pivot on another part keeps the distance | Missing (there was no pivot) | — | `tests/animation-n1.test.ts` |
| Criterion: `FADE` reversed and repeated 2 times, 5 instants | Missing | — | Ditto |
| Criterion: custom curve (0.42, 0) and (0.58, 1) ±1e-3 | Missing | — | Ditto (against the test's own bisection) |
| Criterion: the 16 presets give a valid state at every frame | Done | U1 | Extended to the new fields of the pose |
| Criterion: a dragged bar is one undo entry | Done | N6 (test and `tools/animation-check.mjs`) | The same for a curve handle and a fade |
| Criterion: the U1 project migrates the same at t = 2 s | Missing | — | `tests/animation-migration.test.ts` |
| Criterion: a 2 s video at 12 fps comes out and plays | Missing | — | `tests/video.test.ts` and `tools/video-check.mjs` |
| Criterion: capture of the timeline with three tracks and the wizard at step 1 | Missing | — | `docs/ui/animation-n1-wizard.png` |

**Done.** What was missing or half done, without redoing N6's or U5's work:

- **New types** (`src/data/animation.ts`, added at the end; the 17 keys from
  before, untouched): `FADE` (the amount is the **final opacity** in %, by
  default 0; reversed, it appears; those of a node and its groups multiply),
  `PAN` (the camera turns where it stands: its target goes around its
  position; positive, to its right), `MATERIAL_COLOR` (the base colour of a
  material, from the one the earlier clips left, towards the clip's),
  `SUN_ARC` (the sun turns around the celestial pole, 15° per hour: the first
  sun light that is lit or, without it, the sky's own sun) and `PATH`, only in the
  catalogue (`RESERVED_MOVES`: nothing offers or plays it). `CUSTOM` is added to
  `EASING_KINDS`; `MOVE_GROUPS` gives the wizard its groups. A new target,
  `MATERIAL` (`ClipTarget`), and with it all the parts that wear it
  (`partsWearing`).
- **Rotation with pivot** (`MotionClip.pivot`): `SPIN` and `TUMBLE` of a part or
  group around the centre of another part or a point, about its own axis (Z or
  X), done in the world and returned to the parent; without a pivot, exactly what it was before.
- **Custom curve** (`src/core/curve.ts`): two-handle cubic Bézier
  (x in 0..1, y in −0.25..1.25), Newton from the phase and bisection where the curve
  goes vertical. Editor in the properties (`ui/components/curve-editor.ts`):
  drag with one undo entry, arrows, and its four numbers.
- **Camera change** (`Shot.transition`, `shotFadeAt`): cut or fade to
  black or white (0.04–10 s, 0.5 s by default) centred on the cut, with the soft
  curve and never longer than half of either of the two shots; on the
  first shot, a fade-in. Shot properties on clicking its
  span, mark over the cut on the track, the colour over the viewport frame
  during playback, and in every rendered frame (`src/core/fade.ts`: on the values
  of an 8- or 16-bit image, in linear light in EXR, 32-bit TIFF and DNG).
- **The engine untouched**: the RSB scene (`src/io/rsb.ts`) carries the fades
  as coverage (one copy of the material per opacity, with its wood or
  fabric pattern and its program; an emitter lowers its emission; at 0 % the part is not there), the colour
  of a posed material and the moved sky sun. Without new animation, the same
  bytes as before (the parity tests remain pinned).
- **Fast** (`src/render/fade-preview.ts`): the shared material set as the clip
  leaves it (and returned to its instance afterwards), a translucent copy for
  each part that fades, the arc's sun in the sky and in the lights.
- **Three-step wizard** with the card grid (icon, name, phrase),
  grouped into *Parts · Camera · Light and environment · Materials* with the target's
  group first; *A material* as a target; the colour in step 3.
- **Under their target in the scene tree**: the animations of a part or
  group under it, those of the model under the model, with their icon and short phrase;
  a click opens the drawer with it chosen.
- **Encoded video** (`src/io/video.ts`, `webm.ts`, `mp4.ts`; ARCHITECTURE
  §5.4 ter): WebCodecs queried at run time (WebM with VP9 or VP8, MP4
  with H.264 *Constrained Baseline* at the level the size requires), own muxers
  from the public specifications, a video job in the queue that passes each
  frame to the encoder and saves **one file**; the render window only
  offers what the system encodes (the rest disabled with its reason). In the
  Chromium here: **VP9, VP8 and AV1 yes, H.264 no**.
- **Doctor** (`output`): `EngineFacts.videoCodecs` comes from the browser's
  response (`ui.video`, `encodableCodecs`) and the check warns **only** of a
  video with a container that this system does not encode (fix: frames); the
  D1 tests were rewritten with that (a video that can be encoded is no longer a
  warning), and a new one follows the browser's response down to the warning.
- **Drawer accessibility** (what the H1 review left for this phase): the
  presets are buttons again, each inside a `listitem` element of a
  named list; the tree of what is animated (`role="tree"`, with a name and focus)
  says which row is active with `aria-activedescendant` (each row with its `id` and
  `aria-selected`) and **↑ ↓** go to the animation above or below; the ruler,
  which is inside the tree, is left to the pointer (`aria-hidden`, without a label;
  its help remains) because the playhead already moves with the keyboard from the tree.
  `tests/a11y-timeline.test.ts` (4, in Chromium like the H1 one) and a test of the
  keys.
- **The fade mark** on the camera track covered the beginning of the next
  shot's name and used the requested duration even though the frames cut it to half
  of a shot: `shotFadeSpan` (core) is now the span used by the
  frames (`shotFadeAt`) and the track, and the shot name starts after the
  mark (one test of the span and one in Chromium, which fail without the fix).
- **Gallery**: the four captures, with their entry in `docs/GALERIA.md` under
  *Unreleased* (by version and by feature) and a row in “No screenshot” with what
  of N1 has no image (the fade in the viewport and in a frame, a part that
  fades, the pivot, the solar arc, a frame of the video and the MP4).
- **U1 migration**: `tests/fixtures/u1-hero-poses.json`, taken with U1's
  `evaluate` (commit `67b9154`) on `project-v1.json` at 0, 2, 5.5 and 9 s;
  the project opened today reproduces the same to 1e-9, with its shots as spans and
  its movements as bars.

Tests: `tests/animation-n1.test.ts` (21: pivot on another part and on a point,
also with a parent away from the origin; `FADE` reversed and repeated at five
instants, its multiplications and its partition; `PAN`; `MATERIAL_COLOR`;
`SUN_ARC` and its angle to the pole; the curve against the test's own bisection, also
with handles at the extremes, and its drag as one undo entry; the track's fades,
their span and their pixels; the 16 presets at every frame; the wizard, the
shots and the materials), `tests/animation-migration.test.ts` (2) and
`tests/video.test.ts` (12: the two containers re-read by separate readers, a
2 s video at 12 fps of 24 frames, the writer with a fake encoder, a
queue job through to the file, and real frames from libx264 and libvpx in
our MP4 and WebM read by ffprobe where the machine has ffmpeg). Mutations:
**48**, all killed (in `evaluate` of the new types and of the pivot, in the curve,
in the two muxers and the writer, in the video queue, in the Doctor, in the
drawer accessibility and in the fade mark); one survived
at first (removing the return to the parent of the rotation with pivot: the lid's parent is
at the origin) and was killed with a test on the body, which hangs from the model.
In the browser, `tools/video-check.mjs` (Chromium with real WebCodecs): the
codecs, a 2 s video at 12 fps through the application's writer in VP9
(18,760 bytes) and in VP8 (6,798 bytes) read by ffprobe (24 frames, 2 s,
320 × 180), the three-step wizard, a fade to black, a handle dragged and
undone, the fade in the viewport, and an application render in WebM VP9 of 48
frames (2 s at 24 fps, 160 × 90) read by ffprobe; captures
`docs/ui/animation-n1-wizard.png` (the timeline with three tracks and the
wizard at step 1), `animation-n1-cards.png`, `animation-n1-curve.png` and
`render-window-video.png`. The Rust engine was not touched. Gates, with `main`
merged (H1 and the gallery) and `rt.wasm` built: `npm run qa` green (169
files and 2907 tests pass, 4 files and 6 tests skipped; at the start 161
and 2836 passed, and H1 brings its own) and `npm run engine:test` green (1098 pass, 11
ignored), as before.

**What did not fit the plan** (rule 12; what is marked ◆ is a **Fable**
judgement call, who decides whether it changes):
- ◆ **The wizard order.** The brief asks for type → target → parameters; N6
  delivered target first (*+ Animate Cap…* brings it filled in) and it stays: step
  2 is the grid, with only the types of that target and its group first.
- **One track per target with bars**: N6's model stays (one row per
  target and, below, one per animation; collapsed, the bars of all of them in the
  target's row), which was already accepted.
- ◆ **What a fade is**: the amount is the final opacity and appearing is the
  reversed fade (the SPEC said “from 0 to 1 or from 1 to 0”). In the engine it is a
  stochastic coverage (with few samples it looks like a dither) and an emitter lowers
  its emission, because the engine does not give coverage to emitters; in *Fast*, a
  translucent copy without depth writing.
- ◆ **The solar arc**: a fixed pole behind the product at 45° elevation, in the frame of
  the lights (`SUN_POLE_AZ`, `SUN_LATITUDE`); the latitude and where north is
  are not part of this phase.
- ◆ **The fade to colour**: centred on the cut, half in each shot, soft curve,
  never more than half of a shot; the fade-in only on the first one, and there is no
  fade-out at the end of the animation. It is blended in the pixels after
  the engine: in the linear formats, towards the colour in linear light with the
  exposure (white is 1, which with *Filmic* or *AgX* is not the white of the
  image).
- ◆ **Video quality**: UI.md said *with quality*; there is no knob, it is
  automatic (about 0.1 bits per pixel, from 1 to 50 Mbit/s). No alpha and no sound.
- **H.264** only *Constrained Baseline* (no B-frames, so the MP4 does not need
  `ctts`); the open-source Chromium here does not encode it, so the MP4 was
  tested in Node with real libx264 frames and ffprobe, not with WebCodecs.
  WebM falls back to VP8 where there is no VP9; AV1 is not offered even though Chromium encodes it.
- **The window's fps** are 24, 25, 30 and 60: the 12 fps video of the criterion
  comes out through the application's writer (the test with the fake encoder and the
  browser with the real one); the whole application path was tested at 24 fps.
- **A video is saved at the end**: a stopped job leaves nothing; job plugins
  do not go through its frames and the history saves the first one as PNG
  (`ResultMeta.video` says which video it belongs to).
- **D1's notice “a file that a failure loses entirely”** is removed: the brief
  says that `output` should warn only of a codec that is not encoded (that was D1's ◆).
- **Pivot**: the axis is the target's own (Z or X); the free axis is not
  built. If the pivot part moves, the pivot does not follow it (it is taken at rest).
- **Material colour**: the base colour of the *Simple* parameters; a node-based
  material (M3a) does not change colour, neither in the engine nor in *Fast* (it does fade).
- **Under their target in the tree**: only parts, groups and model; those of camera,
  lights, environment and materials are seen in the timeline.
- The *quick sweep* of the motion library (A6) is still an
  orbit; the variant with `PAN` is pending.
- `ease()` in `light-math` treats `CUSTOM` as linear: a clip's curve lives in
  `clipCurve`, which is the one that uses it.
- `tools/render-window-check.mjs` stops at its step (g) (after choosing *Copper* in the
  palette, Ctrl+Shift+Enter does not start the render and waits until timing out); it passes
  the same on a `main` build without N1 (`3096821`), so it is not from this phase and
  is not touched here. That is why `render-window-animation.png` (U5) has not been re-recorded and
  still shows the video as *coming soon*; the current state is in
  `render-window-video.png`.
  *Resolved later, outside this phase*: the failure was in the tool, not in the
  interface. It closed the results viewer with Esc right after the JPEG download
  started, before the job finished and the viewer opened; that Esc reached the
  scene and deselected the body (`Esc` deselects, UI §2.3), so *Copper* asked for
  *Replace all* inside the palette, which was still open (it is modal) and swallowed
  Ctrl+Shift+Enter. It happened or not depending on timing. The tool now waits for the viewer,
  checks the selection and that the palette closes, and `render-window-animation.png` and the
  other three U5 captures were re-recorded.
- **The timeline ruler** is not a `slider`: it is inside the tree, which
  can only contain its rows, and the playhead already has the keyboard (Home, End,
  ← →) from the tree; it is hidden from assistive technology. If a dedicated control
  for the playhead is wanted, it goes outside the tree (another drawer structure).
## N2 · Queue, passes and batches — **Sonnet** — done

**What.** Render queue with progress and cancellation on top of the engine's `render()`;
alpha, depth, normals and part-id passes as optional integrator outputs
(`RNDR` section with a pass mask; 16-bit PNG or EXR); batch of cameras × studios with
a file name from a template (`{project}_{camera}_{studio}`); download as an own ZIP (no
dependency: the ZIP store format is trivial).

**Depends on.** E4.

**Acceptance.** File-name and queue tests (order, cancelling the
second leaves the third); a 2 × 2 batch produces 4 images.

**Done.** The audit below says what was already there (the queue, its cancellation, the six
engine passes and the camera batch came from U5, U14, X2 and E4) and what was missing; N2
built only what was missing:

- **Engine: the alpha pass** (`rt_core::passes`, the seventh, bit 6 of `RNDR.passes`, without
  changing the section size or moving a hash): the object coverage of each
  pixel, from 0 to 1; it is sampled like the albedo (it shares with it the camera ray of each
  sample, so the edges come out smoothed just like the image) and is divided by the
  reciprocal of the number of samples, bit for bit like `Film::resolve`. `PASS_EXACT` remains
  `0b111110` and `PASS_X2` (the six from before) is what the X2 hashes pin.
  `rt_render_tile_alpha` in `rt.wasm` (with no new `rt_features` bit), the page's pool and the
  launcher's `RPP1` carry it, and the `RPP1` reader no longer has an arm
  that would have swallowed a new plane.
- **Passes as files**: *Alpha*, *Depth*, *Normals* and *Part ID* next to the
  image, in 32-bit EXR (default) or 16-bit PNG (`encodeExrPlanes`,
  `encodePngWords`, `core/pass-files.ts`, `io/passes.ts`), with the part legend
  (`<name>_partId.json`) and the depth range in a `tEXt` chunk.
- **Cameras × studios batch**: *Studio* in the window (the scene as it is, one saved, or
  all of them); with *All cameras*, 2 × 2 are four jobs, camera by camera, each
  with its camera and its studio and with the template's name; warning about repeated names.
- **Own ZIP** (`io/zip.ts`, store method, CRC-32, UTF-8 names, no ZIP64) and the queue's
  ZIP group: one *Render* command is a single file when the last job finishes, with
  an alternative of loose files if it cannot be assembled.
- **Queue**: the missing test (*Stop* the second leaves the third) and an old failure
  in `ensureLoop` (see below).

Numbers. Web: `npm run qa` green (types, interface and 177 test files with 3005 tests and 6 skipped, after merging `main`; before the phase there were 168 files and 2902 tests). Engine: `cargo test --workspace --release` 1112 tests and `npm run engine:test` 1106 (debug), with no failures; in WebAssembly (WASI) 588 from `rt-core`, scalar and with simd128; `cargo fmt`, `clippy -D warnings` (also for Windows), `cargo check` for aarch64 and riscv64, and the real `rt.wasm` equal to the native one in every parity block of `engine.yml`. With the machine heavily loaded, `ai_post::retries_lower_the_strength_…` (a wait on sampling) failed in two full runs and passes on its own (9 of 9): it touches nothing of this phase. New tests: `tests/batch.test.ts` (28),
`tests/zip.test.ts` (10), `tests/pass-files.test.ts` (17), 6 in
`tests/passes-engine.test.ts` and, in the engine, those of alpha in `passes_tests.rs` (coverage,
floor and background, equal to the film with a transparent background bit for bit, with other passes and with
other tiles, light panel, with edge samples, equal in scalar, SSE2 and AVX2), in
`rt-wasm` (`the_alpha_pass_through_the_c_api_is_the_engines`) and in `rt-app` (`RPP1` with
mask 127). **New hashes** pinned: `PINNED_PASS_ALPHA = 0xd4eaac78` (sample) and
`PINNED_E5_PASS_ALPHA = 0xef9ead68` (E5), equal in the real `rt.wasm`
(`wasm-parity.mjs --expect-alpha`, in `engine.yml`) and in scalar and simd128 WASI; **none
of the earlier ones moved** (albedo `0x43571da9`, normals `0x0aabfd24`, depth
`0x25f8dd11`, ids `0xccd3d6c7`, circle `0xdf87494c`, nor those of the images). Each new test
was checked with a mutation: 46 mutants (38 in the page, one in the queue and 7 in
the engine), all killed; two taught something: dividing by the number of samples instead of
multiplying by its reciprocal survived until it was tested with 7 samples, and one mutant
hung the tests (it was the `ensureLoop` failure). `tools/batch-check.mjs` (Chromium and the real
`rt.wasm`): a 2 × 2 batch with three passes in a 20-file ZIP that `unzip` and `fflate` accept,
the EXRs read by the specification, the 16-bit PNGs, and *Stop* on the second leaves the
third. Captures `batch-window.png` and `batch-queue.png`.

**Audit at the start** (on `main` at v0.1.16, point by point from the
brief and the acceptance criteria; U5, U14, X2 and X4 had already built part of it):

| Point | State at the start | From which phase | What N2 did |
| --- | --- | --- | --- |
| Render queue with order and progress, on top of the engine's `render()` | Done | U5 (drawer, reorder, edit, duplicate, pause, finished), U14 (live view), E4 (the tracer) | Nothing to redo |
| Cancellation | Done | U5: *Stop* the running job (ends as *Cancelled* and the next continues), *Remove* a waiting one, *Pause* | Nothing to redo; the test |
| Depth, normals and part-id passes as integrator output, with a mask in `RNDR` | Done in the engine | X2 (`RNDR.passes`, `rt_core::passes`, six passes with pinned hashes), X4 (three.js draws them for the AI) | Nothing to redo in the engine; they are only read by the AI guard and the denoiser: no pass reaches a file |
| Alpha pass | Missing (only the image's alpha with a transparent background existed) | — | The seventh pass, `alpha`, bit 6 of the mask: without changing the size of `RNDR` or moving a hash |
| Passes as files: 16-bit PNG or EXR | Missing (the image writers exist: PNG 8/16 bits, EXR, TIFF, DNG) | U5, U12 | `encodePngWords` and `encodeExrPlanes`, the numbers of each pass and their names |
| Selectable passes in the render window | Missing (a *coming soon* row) | U5 | Chips and format |
| Batch by cameras | Done | U5 (*All cameras*, one job per camera with its aspect ratio) | — |
| Batch by studios | Missing (saved studios were not an axis of the queue) | U4 (the library's studios), L6 | The studio as an axis: `studio` in the settings and in the job |
| Name from a template with project, camera and studio | Done where it matters | U5 (`{project}`, `{camera}`, `{studio}`, `{date}`, `{n}`: the keys in English, the chips in es and en) | `{studio}` becomes the job's saved studio (it was the product-type name); warning about repeated names |
| Download as an own ZIP | Missing (a ZIP writer existed only in `tests/zip.ts` for test files, and fflate to *read* 3MF) | — | `io/zip.ts` and the queue's ZIP group |
| Criterion: name and queue tests in order | Partial: the order and stopping the first | U5 (`tests/render-queue.test.ts`) | `tests/batch.test.ts` |
| Criterion: cancelling the second leaves the third | Missing | — | Two tests (stopping it and removing it) and the same case in Chromium |
| Criterion: a 2 × 2 batch produces 4 images | Missing | — | Test with the queue, the ZIP read by fflate and `tools/batch-check.mjs` |
| E8, native batches (`rt` reads projects) | Missing | — | Not built here (it overlaps; it stays in its phase) |

**What did not fit the plan** (rule 12; what is marked ◆ is a **Fable**
judgement call, who decides whether it changes):
- **The name chips** are `{project}`, `{camera}`, `{studio}`, `{date}` and
  `{n}` (U5's model, with keys in English and chips labelled
  in each language), not `{proyecto}_{camara}_{estudio}` as the brief says: what
  exists is kept, since it already does what is asked (in Spanish the chip says *Proyecto*,
  *Cámara*, *Estudio*). There is no Spanish alias inside the template.
- **`{studio}` changes meaning in batches**: it was the product-type name
  (*Jewellery*) and now, in a job with a saved studio, it is that studio's name;
  without one (everything from before) it is still the product type.
- ◆ **What alpha is.** The brief asked for an “alpha” pass and nothing more. It was built as an
  **object mask**: each sample counts whether its camera ray finds a
  surface of an instance; the studio floor (visible or shadow catcher), the
  environment, the background and the visible light panels are worth 0, and cut-outs and glass
  count as surface, as in all the X2 passes. It is therefore not the alpha of the
  image with *Transparent background* when there is a shadow catcher (there the alpha is the
  shadow) nor of what the path sees through glass; where there are only opaque objects and
  background, it is the film's alpha bit for bit (test). Decide whether the floor goes into the
  mask, and whether cut-outs with an alpha texture should give partial coverage (today they do not).
- ◆ **Which passes are offered**: the four in the brief. The engine also renders the albedo, the
  material id and the circle of confusion (those of the AI): they could be offered through the same
  channel, and the material id would need its legend.
- ◆ **How the numbers are written.** Default format of the passes, **EXR** (depth
  and normals are floating point); in 16-bit PNG, depth is a z map with
  **near is white**, 0 the background and the distance range in a `tEXt` chunk; the
  normals, `n × ½ + ½` (the background, mid grey); the ids, the instance number with the
  floor at 65535 and a cap of 65534 parts. All of that is prepared, not decided: they are
  photographic and convention choices.
- ◆ **The ZIP**: off by default (today each file is downloaded separately, as always), a
  group is what **one** *Render* or *+ Add to queue* command puts together, and it is called
  `Project_0001-0004.zip` (with the render numbers). Decide whether a batch to *Downloads*
  should be packaged by default, and the name.
- ◆ **The order of a batch** is camera by camera (each camera across all studios), that of
  the `{camera}_{studio}` templates; the other order (studio by studio) is equally
  defensible.
- **The studio does not move the camera.** `studio/restore` does set the studio's camera (its
  view and its optics); a batch keeps the job's own, because otherwise 2 cameras × 2
  studios would be 2 images. A pure `restoreStudio` with `{ camera: false }` does both things.
- **The batch's studios are the saved ones**: those of the *Studios* tab (library, in the
  browser or in the desktop data folder) and those that an old project kept
  inside. A job stores the id and the name, not the studio: opened on another machine without
  that studio it fails with the reason. ◆ Whether the studio should travel with the project (decided: yes; done in N2b).
- **A job with a studio does not go through the AI** (its passes are drawn from the open project in
  Fast mode); a notice says so and the engine's image is saved. Job plugins
  save separately, outside the ZIP.
- **The passes are for images**: an animation does not write them (nor carry a studio), and with
  *Finish by noise* the alpha, like the albedo, carries the samples of the first round.
- **The ZIP is assembled in memory** and written when the last job of the group ends: closing the
  page before that loses it (the image results are in the history), there is no ZIP64 and
  a huge batch of 32-bit EXRs may not fit. A group that is paused waits in memory.
- **Cancel**: it was already there; the test was missing. *Stop* (the running one) and *Remove* (one
  waiting) are the two modes; a waiting job does not become *Cancelled*, it leaves the list.
- **Desktop**: the launcher renders the alpha and stores it in its `RPP1` (tested through the
  API with 1 and 4 threads, and the page's reader with a file written by the launcher),
  but `tools/batch-check.mjs` only covers the web: the batch in the native window was not
  recorded. **E8** (native command-line batches) is not built here.
- **Changes outside the plan, from a bug that almost got in**: the launcher's `RPP1` reader
  (`kept.rs`) had a `_ =>` arm that would have stored any new plane in the circle of
  confusion; now alpha has its own and the test file
  `tests/fixtures/passes-3x2.rpp` includes it (its first six planes are the same bytes).
- **An old queue failure, found while testing**: a *Start* with nothing waiting
  ended the loop before its first `await` and left the already finished promise as “the
  running loop”; no later *Start* launched another. Fixed in `ensureLoop`
  (the promise clears itself on finishing) and with its test, which fails if the old code returns.

## N2b · The studio travels with the project — **Opus** — done

**What** (from *Judgement calls*, N2). The studio of a batch job travels **inside
the project**: a project opened on another machine, or in another browser profile, does not
fail its jobs because a library studio is missing there.

**Done:**

- **The copy in the project** (`core/job-studios.ts`). `render.studios` is a list of
  `{ hash, studio }`: `studio`, the `SavedStudio` that `restoreStudio` applies (lights,
  environment, image, camera, per-part materials and visibility, with its id and its name);
  `hash`, the SHA-256 of its content without id or name as JSON with sorted keys
  (`canonicalJson`, `studioHash`, with the `core/sha256.ts` that already existed). **One copy per
  id and hash**: the four jobs of a 2 × 2 over two studios are two copies, and
  *+ Add to queue* twice with the same studio is still one. Each job
  names it with the optional field `RenderJob.studioCopy` (its `settings.studio` does not change:
  `{ kind: 'ONE', id, name }`). The queue *reducer* stores the copy with the jobs
  in the same action (`render/enqueue` and `render/updateJob` receive in `studios` each
  `StudioRef` with its `snapshot`; the interface supplies them with `studiosForJobs`), so
  undoing *Add to queue* takes both things away, and it only keeps the copies that some
  job names (`pruneEmbedded` in `withQueue`: removing the last job of a studio
  removes its copy, undoing returns it; *Duplicate* shares the original's).
- **The large things, once.** The lights carry their IES profile in the JSON, like those of the project
  (L5); the HDRI, the background image and the copy's textures are `ImageRef`s, and their
  files go in the `images` block with those of the project (U2/E5/M2a), **once for each
  image** whoever names it (`embeddedImageRefs` in `serializeProject`). On opening,
  `placeImages` and `placeTextureImages` place them with those of the project, decoding each
  one only once, and change its id at the same time in the project and in the copies when in the
  session another image already uses it; `replaceProject` keeps the copies' images in the registry.
- **On opening and on rendering.** `migrateRender` takes from `render.studios` what has the shape
  of a copy (a 64-digit hash, a studio with id and name, no repeats) and `studioCopy`
  from each job; `checkState` reads each copy like the project blocks (environment,
  image and camera completed with the values of a new project and with the types
  checked, IES profiles with `withReadableProfile`, materials with `readMaterial`, which is
  what was there before extracted into a function, and the materials that name their present parts); a
  damaged copy is removed, not the project. On rendering, `resolveStudio` gives the job's
  studio: **its copy**; without one, the library one with that id; if not, one that the
  project kept inside (`studio.saved`); if not, the failure with its reason, as before.
- **Format.** The conventions of `io/project.ts`: two fields added with their default
  value, with no schema step; **the schema stays at 2** (header of `io/project.ts` and
  `ARCHITECTURE.md` §8). An earlier project opens the same (no copies, the same jobs;
  `project-v1.json` and `project-v2.json`), and an earlier version opening a new one ignores
  the two fields and looks for the studios in its library.
- **Add to my library.** In the *Queue* drawer, between the header and the list, one line per
  studio that came with the project and is not in the library (nor saved in the project):
  *The studio “Studio A” came with the project; it is not in your library* · **Add to my
  library** (`studiosToAdopt`, `addProjectStudioToLibrary`), which saves it in *Mine* with
  its id and removes the line. In the render window, when editing a job whose studio is only
  in the project, the list names it *Studio A (in the project)* instead of *(no longer
  saved)*. Strings in `es` and `en` (`queue.studioInProject`, `queue.addToLibrary`,
  `rw.studioInProject`).

**Tests.** `tests/job-studios.test.ts` (13): the **2 × 2 over two library studios**
saved, opened on another “machine” with an empty library through *Open
project* and rendered: the four jobs finish, with the template's names, each
with the product type, the lights and the exposure of its studio and through its camera; **without
the change it fails** (all four *Failed* with “The studio “Studio A” is not saved any more”:
checked with `git stash` of `src/` and the same test without importing anything new). The copy wins
over a library studio saved on top with the same id, and a new one takes the current one;
one copy per studio (two identical *Add*s, the file has it once and the jobs
name it by its hash); the hash does not depend on key order, id or name;
the copies follow the jobs (undo, remove, duplicate); editing keeps the copy or
takes that of the new studio; **the project's HDRI in a studio is not duplicated** (one entry
in `images`, the file grows by less than half of the image's base64; opened
in a new session the copy names the placed HDRI, and in a session where `hdri:1` is another image
the project and the copy move to the same new id) and an HDRI that only the studio has travels
equally; earlier projects open the same; a job from before N2b uses the library and,
without the studio, fails with the reason; editing it gives it a copy; a damaged copy is removed and the
project opens; *Add to my library* (what it offers, the id it keeps, that it does not touch the
project). In `tests/batch.test.ts`, the N2 test “a studio that is no longer saved
fails” now says the current thing: deleted from the library, the job renders its copy; without
a copy either, it fails with the reason. Each new test was checked with a mutation (10
mutants, all killed: without the copies' images in the file, without changing their id
on opening, without pruning, the library before the copy, without removing repeats, the hash without
sorting keys, an edit that changes the copy, without reading the copies on opening, without
keeping their images on opening, and the render without looking at the copy); two survived at
first (the hash without sorting and the edit) and their tests were strengthened.
`tools/batch-check.mjs` (g), in Chromium with the real `rt.wasm`: two studios and a batch
over both added to the queue in one profile, *Save project* (the `.repack` has both
copies and the jobs name them), opened in another profile with an empty library: the queue
offers the two lines, *Start queue* gives distinct `Studio 1.png` and `Studio 2.png`, and adding
one leaves the other's line. New capture `batch-queue-adopt.png`.

**Gates.** `npm run engine:build` and `npm run qa`: types and build green; of 3180 tests
(192 files), 3148 pass, 31 are skipped and one, `tests/material-program-cross.test.ts` “has a
fixture of every case”, exceeded the 5 s time limit with the machine loaded by other agents
(it touches nothing of this phase): on its own it passes (3 of 3). `tools/batch-check.mjs` in Chromium with the
real `rt.wasm`: the nine checks green, (a)–(f) from N2 and (g1), (g2) from N2b. The engine
is not touched.

**What did not fit the plan** (rule 12; what is marked ◆ is decided in *Judgement calls*: it is accepted as it stands):

- ◆ **The copy wins** over a library studio with the same id and different content
  (saved on top), for the jobs that already had it; a new job of that studio
  takes the library's as it is and carries another copy with the same id. There is no *Update
  from library* nor a notice that they differ.
- ◆ **Editing** a job without changing its studio keeps its copy, even if the library
  has changed; changing it takes that of the new studio (and the old one leaves if nobody names it).
- ◆ ***Add to my library*** saves the studio with **its id** (the jobs find it
  there too), it is not undoable (the library belongs to the person, with no history, U4: rule 6
  is met in everything about the project, which does not change) and it is only offered for an id that the
  library does not have: a copy with the id of a library studio that was saved on top is not
  offered as a separate studio. It is in the *Queue* drawer, not in a job detail
  (there is no detail view).
- ◆ **The schema stays at 2**, by the format's convention (what is added with a default
  value does not raise the schema): an earlier version opens a new project without error, without
  the copies.
- **A job from before N2b receives no copy on opening** (opening does not change the project: earlier
  projects open the same), nor on saving (the file does not see the library): it looks for its
  studio in the library, as before; it receives one when edited or added again.
- **The copy may carry more than the library.** The library does not store images (E5):
  after reloading the page its studios have no HDRI; the copy carries what the studio
  had when the job was created (in the same session, its HDRI too, which then does travel).
- **What is repeated, small**: the IES profile of a light in the copy that is also
  in the project goes twice in the JSON (the format has no profiles block: L5 carries them
  in the light), and the copy's materials, as in every saved studio. Images
  are never repeated.
- **The studios that an old project kept inside** (`studio.saved`) still do not
  write their HDRI to the file, as before N2b: it is not part of this phase.
- **The hash is not recalculated on opening**: it is the copy's name (completing its fields on
  reading would change the text); a hand-edited copy keeps its hash.
- **The reason for the failure** is still “The studio “…” is not saved any more”, also for an old
  project opened on another machine.
- `tools/batch-check.mjs` was run with `--shots` to a separate folder and only the new
  capture was copied: those of N2 (`batch-window.png`, `batch-queue.png`) do not change.
## D1 · Engine Doctor — **Sonnet** — done

**What.** The checks that depend on the engine: `rt.wasm` loaded and
number of workers (and a warning if the browser only gives one), SIMD available
in wasm, denoise, view transform, caustics (fireflies: very bright
isolated samples detected in the accumulation), video output
format, estimated time against the budget. *Fix all* in one
click.

**Depends on.** E4.

**Acceptance.** `tests/doctor-engine.test.ts` with a fake engine that simulates
each state; each check fires and clears.

**Done.** The engine checks live in a module of their own,
`src/core/doctor-engine.ts`, plugged into `runDoctor` and `fixDoctor` through their
default branch: the ten scene checks, their keys and their tests were not
touched. What the engine and the system say is not project data, so the page
hands it to the Doctor as `EngineFacts` (`setEngineFacts`, like the particle
cap from S4a) through `installDoctorFacts` (`src/ui/doctor-facts.ts`),
which builds it from the interface state and the viewport's `status()`, requests
`doctor/refresh` only when something changes (volatile, with no undo entry) and
repeats it after undo and redo; `main.ts` gives it a one-second pulse for what
only the engine knows. Without facts, the seven engine checks and the two that are not
touched (`lighttree`, `persist`) remain *unavailable* with the same shape as
before. The catalogue goes to **19** entries: `simd` after `engine` and `budget`
after `output` (new), and the texts of `engine`, `denoise`, `color`,
`caustics` and `output`, which spoke of Cycles, rewritten for this engine with
their keys intact. Detection, fix and test of each one:

- **`engine`**: the availability of `ui.engine` (`NO_WASM`, `OUTDATED`,
  `FAILED`, `NO_WORKERS`, each with its sentence) and a pool of a single worker
  with the WebAssembly engine. No fix; if it is *Threads* that limits it
  (Automatic would give more), the notice brings the **Settings** button that opens that row.
- **`simd`**: `EngineInfo.simd` against what the system supports and the setting:
  without simd128, *SIMD* set to *Off* (with a button to that row), missing
  `rt-simd.wasm`, or a desktop engine without a vector path.
- **`denoise`**: in the viewport and not in the render, at strength 0, or an `rt.wasm` without
  `rt_denoise` (the workers say so in their first message, `ready.denoise`; before,
  nobody outside the worker knew). Off everywhere does not warn. Fix:
  *Both* / 100 %, through `render/set`.
- **`color`**: with *Standard*, the fraction of the frame more than one stop above
  white (2 linear, with the exposure applied) read from the accumulation's stop
  histogram; with *Filmic* and *AgX* no image is needed. Fix:
  *Filmic*.
- **`caustics` (Fireflies)**: `render/frame-scan.ts` reads the accumulation that the
  page already has (without touching the engine): a pixel is a firefly if its mean
  exceeds white, is 4 times that of the best of its eight neighbours and, with
  squared luminance, a single sample contributes half of its light or more (the
  quotient `lum2 / (Σ luminance)²` is an exact lower bound of the share of the
  largest sample). It warns from 8 pixels or 10⁻⁵ of the frame; fix: caustics
  *Off* → *Automatic* and indirect clamp at 10, or, if already there, just
  “more samples”. It is done by `status().scan` of the pool and the launcher, read again
  when the samples double (from the 16th onwards).
- **`output`**: video with a codec that the system does not encode, or video plain
  (a file that a failure loses entirely). Fix: frame sequence.
- **`budget`**: with the speed the engine measured (`ui.throughput`, never
  invented), the *Time* setting's time does not reach a Draft (64), or that of
  *Whichever comes first* half of the samples. Fix: raise the time to what is
  needed plus a quarter of headroom (`BUDGET_HEADROOM`), rounded to the ten
  seconds: the browser test showed that the speed the viewport measures
  moves from one reading to the next and a tight budget fell short again
  right after being fixed.

A scan belongs to **one image**: it carries the project it comes from (`basis`) and
`sameImage` (which repeats `touchesImage` of the two engines, with a test that
compares them) says when it stops being valid; the Doctor does not use a reading from another image
(`Measuring…`). The store reruns the Doctor when what the
checks read changes (`engineInputsChanged`). The fixes go through the store and are
one undo entry; *Fix all* joins them into one, and what the project
cannot change is a notice with its explanation and no false fix.
`tests/doctor-engine.test.ts` (72 tests) carries a fake engine that writes
where the real one writes and uses the real `installDoctorFacts`: each of the
fourteen failures in the table fires and clears, plus *Fix all*, the
thresholds at their boundaries, `doctorSentence` in both languages, and that undo
refreshes; `tests/frame-scan.test.ts` (17) reads synthetic accumulations, the
`status().scan` of the pool with fake workers and that of the launcher with its simulator;
`tests/frame-scan-engine.test.ts` (3), the real `rt.wasm`. Each new check
was tested by **disabling its detection** (and each fix, and each threshold):
about a hundred mutations, all killed except three equivalent ones: not clipping the
top or bottom row of the neighbours (outside the frame `undefined` is read and
beats nobody) and the `full` of the pool's `status()` (the cache, which asks for 16
samples, already covers it). `tools/doctor-engine-check.mjs` runs it in Chromium with the real `rt.wasm`
(27 checks: the engine and the viewport healthy, *SIMD* set to *Off* with
its button to *Settings*, denoise only in the viewport and a 5 s budget with the
speed the engine measured, *Fix all* and an undo) and leaves
`docs/ui/doctor-engine.png`. The Rust engine was not touched: neither `rt_features` nor
any pinned hash moves. Gates: `npm run qa` green (159 files and
2746 tests pass, 4 files and 6 tests skipped; at the start 2635 passed) and
`npm run engine:test` green (1098 pass, 11 ignored). With K1 on the
same branch the two coexist: `runDoctor` gives the 19 of `DOCTOR_CHECKS` and, with the
*Interior* type, the seven of `INTERIOR_CHECKS` after them; `fixDoctor` routes each key to its
Doctor (`isInteriorCheck`) and *Fix all* clears both classes in one undo
entry (four tests in `tests/doctor-engine.test.ts`, which also pins that the
interior keys are neither scene nor engine ones). Cost: reading the
accumulation runs on the main thread every time the samples double
(from 16 onwards: five or six times per view) and takes, measured in Node with
hot code, 40 ms at 1280 × 720, 160 ms at 2560 × 1440 and 330 ms at 4K.

A failure that appeared while testing and was fixed with its test
(`tests/store.test.ts`): an action that a store listener dispatches while being
notified of an undo, a redo, a reset or the closing of a transaction
waited for the next `dispatch` (`apply` was only drained in `dispatch`); the
Doctor needs to request `doctor/refresh` after undo, and it did not arrive.

**What did not fit the plan** (rule 12; what is marked ◆ is a judgement call and is
left noted for whoever decides, rule 11):
- ◆ **`color` does not have in this engine the original's check** (“the scene's
  transform does not match the one chosen in the settings”): there is a single source
  (`image.viewTransform`) and the page converts the sums itself, so there
  is nothing to disagree. The proposal is something else that the engine does know: with
  *Standard* the highlights are clipped. Pending: whether that is a failure (a plain
  white background is wanted clipped), the threshold (**1 %** of the frame, more than
  **one stop** above white: `CLIP_FRACTION`, `CLIP_OVER_WHITE`) and whether the
  fix is *Filmic* or *AgX*.
- ◆ **`caustics` / Fireflies changes meaning**: the original warned of
  caustics that were *on* needlessly; here caustics are a photon map that removes
  fireflies, and when off they leave them. Proposed thresholds, all in
  `render/frame-scan.ts` and `core/doctor-engine.ts`: brightness ≥ 1 (white), isolation
  ×4, share of one sample ≥ 0.5, 16 samples minimum, 8 pixels or 10⁻⁵ of the
  frame, indirect clamp **10** (a clamp removes energy: it is a bias, not a
  free fix). Real data was looked at (`tests/frame-scan-engine.test.ts`): two
  ordinary scenes at 16 samples, 0 fireflies; mirrors with pinpoint lights at 64,
  4 with one sample of up to ~76 times white; it was not tuned with more scenes.
- **What is not measured**: two fireflies stuck together look like a bright neighbour to each
  other and do not count; with the launcher viewport's denoise on, the sums that
  reach the page are the filtered image (`fireflies: null`, and the check says
  there is nothing to count; the pool always reads the unfiltered sums); in *Fast*
  there is no accumulation.
- ◆ **`budget`: what “too slow for the budget” is**. There is no time budget
  if it finishes by samples or by noise (it does not warn); with *Time*, that of
  a Draft (64 samples) is the minimum for a usable image; with *Whichever comes
  first*, half of the requested samples (`BUDGET_REACH`). The fix
  raises the time (with 25 % headroom) and does not lower the samples (the other honest
  way out); an animation is
  judged by the budget of each frame, and its total is compared with nothing.
- ◆ **`output` dormant**: until N1 the settings force the frame
  sequence, so only a project from a future with video triggers it. It is to be decided
  whether it should also warn when the codec can be encoded (today it does, because of “a file
  that a failure loses”); the fix is always the sequence, without changing
  codec.
- ◆ **`denoise`**: it only warns of the viewport without the render (not the other way round: the raw
  viewport is an everyday decision) and of strength 0; the fix is *Both* / 100 %.
- **`lighttree` and `persist`** remain in the list as *unavailable* with their reason
  (the light tree belongs to K4; persistent data belongs to Blender and has no
  equivalent): the keys are stable and are not removed. If preferred, `persist`
  can be withdrawn from the catalogue in a clean-up phase.
- **Application settings**: what limits *Threads* and *SIMD* does not belong to the project
  and is not undoable; the Doctor points to it with a button that opens the row and does not
  change it. If a fix that changes it is preferred, that is a decision (rule 6 says
  that every mutation is undoable).
- `sameImage` repeats the list of `touchesImage` of the pool and that of the launcher (they
  were already two copies): `tests/doctor-engine.test.ts` compares them across sixteen
  actions. It differs in the playhead, on purpose (the Doctor does not run on every frame).
- The help bubble of *Fix* uses the catalogue text; the engine ones
  say it in general (“No fix in the project: …”), and the notice of each case, the
  reason.

## U5 · Render window and results viewer — **Opus** — done

**What.** `UI.md` §2.5, §2.7 and §2.8: the bottom bar loses quality,
resolution, budget and format, and is left with *Animation*, *Queue* (with
counter and progress) and **Render…**; the KeyShot-style **render window**
with *Image · Animation*, *Output* (name from a template with
chips, folder when done with access to the browser's file system
where it exists and *Downloads* where not, format, transparent,
camera one or all, size in pixels and print size with linked **dpi**
written into the file —`pHYs` in PNG, JFIF density in
JPEG—), *Quality* (*Finish by* samples or time, *whichever comes first*
in advanced, estimate from the measured samples per second),
*Animation* (range, fps, video or frames, per-frame budget,
total estimate; the frame sequence already works, encoded
video arrives with N1 and is marked *coming soon* until then),
the *AI post-processing* section as a collapsed placeholder (*coming soon* until
X3), and the footer with **+ Add to queue** and **Render** (the latter puts
the job first and starts it); a complete `RenderJob` in the store
with migration of the U1 state; *Queue* drawer with reorder, edit,
duplicate, pause and finished; **results viewer** over the viewport
with zoom, data and the generic **comparison component with a sliding
divider** (any two images), which X3 reuses;
results history in browser storage (IndexedDB or
OPFS) with a limit and deletion; shortcuts `Ctrl ⏎`, `Ctrl ⇧ ⏎`, `⏎`, `⇧ ⏎`.

**Depends on.** E4 (render always with the tracer).

**Acceptance.** Tests: `px = size × dpi` in both directions with
rounding and lock; the PNG carries `pHYs` with the dpi (reading the
file in the test) and the JPEG its density; name template with all
the chips; *Render* and *+ Add to queue* produce the expected queue;
*All cameras* creates one job per camera; *Finish by time*
cuts at the limit (±1 pass); migration of a U1 project; the
window does not appear in the viewport capture. Captures of the window in
*Image* and in *Animation*, of the *Queue* drawer with three jobs and of the
results viewer with the divider.

**Done.** The bottom bar is left with *Animation*, *Queue* (counter and
progress), the latest result and **Render…**; the render window
(`ui/panels/render-window.ts`) with *Output* (template with chips,
*Downloads* or a chosen folder with the permission remembered, PNG 8/16 bits,
JPEG with quality, uncompressed linear EXR, transparent, active camera,
one or all, pixels ↔ print with lock and dpi), *Quality* (*Finish
by* samples, time or whichever is first, estimate with the measured samples per
second, advanced with bounces, clamp and seed), *Animation*
(range, fps, frames already working, video *coming soon*), the collapsed
placeholder of AI post-processing and the footer with **+ Add to queue** and
**Render**. The dpi go into `pHYs` (PNG) and into the JFIF density (JPEG).
*Finish by time* is decided by `render/schedule.ts` between passes,
measuring the time per sample, always within one pass of the limit.
Complete `RenderJob` with pure migration of the U1 state and
`PROJECT_SCHEMA = 2`. Queue with reorder, edit, duplicate, pause and
finished; results viewer with zoom, data and the generic component
`ui/components/split-compare.ts`; history in IndexedDB (50 results or
500 MB) with memory as a fallback. 621 tests; 31 mutations checked;
8 checks in the browser (`tools/render-window-check.mjs`), among
them that the window never appears in the viewport image. Captures
`render-window-image.png`, `render-window-animation.png`,
`queue-drawer.png` and `results-split.png`.

What did not fit the plan: the queue becomes **undoable** (U1 made it not
undoable; this brief governs); *Render* with the queue running does not
interrupt the job in progress, it goes first and starts afterwards; in
*Animation* a *Frame size* row is needed (pixels only) and
the sections are stacked; the history stores only the first frame
of an animation; *Pause* restarts the job, because a render is not
resumed halfway; `{n}` is the render number in an image and the frame
number in an animation; EXR also for sequences, without dpi; the advanced
settings only apply to the render, not to the Full viewport; *Open
folder* is hidden in the browser. Observation for L3: with the jewellery
studio, REMBRANDT and NEON_NOIR change only 3 % of the pixels; it
is reviewed with the recipes on the own engine.

## U6 · Settings window and model manager — **Opus** — done

**What.** Request: professional Settings, everything
configurable separated into modules and grouped in a column on the
left. `UI.md` §2.9 in full: the window (960 × 680, search box,
groups *Application* · *Render* · *System*, changes immediately, dot and
*Reset* per row and per section, direct links and
`?settings=<section>`), and its sections **General**, **Preferences**,
**Accessibility**, **Keyboard shortcuts**, **Render engine** (with
a real *Measure performance*), **AI post-processing**, **Storage**,
**Desktop** (only in the desktop application) and **About** (with
the complete third-party licences). The settings are a typed object
with version, factory values and migration in `src/core/settings.ts`
(pure), saved by `src/ui/prefs.ts`; today's loose preferences
(theme, language, widths, viewport mode) migrate into it.

The **model manager** of `AI-POST.md` §5 (it absorbs X5): the list in
`src/data/ai-models.json` (from X1 part A) and the imported ones; downloads
with progress, pause, resumption after closing (`Range` requests), and
`sha256` per file; storage in OPFS on the web and in the data folder
through the launcher on desktop (P2), behind a single
`ModelStore` interface; *Use*, *Delete*, *Import model…* with the
`model.repackshot.json` manifest validated and *pickle* rejected;
licence shown and accepted before the first download; the
**configuration of the active model**; the **machine detection** (WebGPU limits
on the web; the launcher's `/api/hardware` on desktop) and the
**recommendation rule** evaluated over the JSON table. If the
installer left a choice, its downloads start on first
launch. In the desktop portable versions the chooser appears
once on first launch; on the web, the first time post-processing
is enabled (`AI-POST.md` §2.2) and always in *Settings*, because today there
is no model for the browser. As long as X3 does not exist, post-processing does not
run: the section says so in one line and everything else works.

**Depends on.** U5 (the render window links to *Manage
models…*), X1 part A (the JSON with files and `sha256`). The desktop part
of storage is tested with the P2 launcher.

**Acceptance.** Tests: migration of the loose preferences; every setting
has a factory value and *Reset* returns it; the search finds
a setting by a keyword in `es` and in `en`; the recommendation rule
gives the row of `AI-POST.md` §2.4 at the edges of each band
(case file `tests/fixtures/ai-recommend-cases.json`, the same one
used by P2's Rust test); without detection it does not recommend; an invalid manifest
is rejected with the reason; a `.ckpt` is rejected; a non-commercial model
cannot be the default one; deleting the active one returns to the
recommendation; an interrupted download resumes from the last byte
written (test server with `Range`) and a wrong `sha256` leaves the
file *Damaged*; high contrast and interface size change the
tokens and remain achromatic. English captures of *General*,
*Accessibility*, *Render engine* and *AI post-processing ▸ Models*
with a download in progress.

**Done.** `src/core/settings.ts`: some 57 typed settings with version,
factory values, validation, migration of the loose preferences and
a metadata table (`SETTING_ROWS`) from which the window, the
search in both languages, and the *changed* dots and *Reset* are derived. The
window (`ui/panels/settings-*.ts`) with the groups *Application*,
*Render* and *System*, direct links and `?settings=`; every section
genuinely connected (navigation and mouse buttons, resolution during
gestures, interface and text size, high contrast, reduce
motion, announcements for screen readers, engine *Automatic ·
Native · WebAssembly*, threads and SIMD, viewport limit, *Measure
performance* with a real 10 s render, history limits, data
folder, complete third-party licences copied at build time).
*Last project* works: the header asks on startup whether to open
the last file. Model manager with a `ModelStore` interface and three
implementations (OPFS in a worker with the same layout by
`sha256` as the launcher, the launcher, and memory), downloads in
4 MiB chunks with `Range`, resumption after reload, own streaming SHA-256
(file *Damaged* if it does not match), two files at a time, shared
files once, licence accepted before downloading, import
with manifest and *pickle* rejection, the installer's choice on
startup and the chooser once in the portables. 939 tests; checks
in a web browser (`tools/settings-check.mjs`) and on desktop with
the real launcher (`tools/settings-desktop-check.mjs`). Captures
`settings-general.png`, `settings-accessibility.png`,
`settings-engine.png`, `settings-ai-models.png` and `settings-desktop.png`.

What did not fit the plan: *Coming soon* are the automatic backup, the access
letters, changing shortcuts, *Check for updates* and the AI pipeline; the
catalogue downloads through the launcher were not tested with multi-GB
files (the import covers the store end to end); the U2 limits test
had a false positive and the achromatic test was reading empty strings instead of the CSS
(both fixed, with their case); *On start*
is *Empty project* by default, as until now, with the standard mode
already mounted. It found a P2 failure: an empty project is never
rendered natively (the launcher asks for meshes that are not there).
## N3 · Camera walk — **Sonnet**

**What.** The `WALK` animation type from `SPEC.md` §3.7: a
*Trace walk* tool in the viewport (click on the floor per point, `⏎` finishes,
draggable points, the curve drawn in ink), *Walk around the
selection* in one click, centripetal Catmull–Rom travelled at
constant speed by arc length with soft start and stop, eye height,
look-ahead / towards a target / by points with smoothed turning, and **Simulate steps** (cadence, vertical and lateral sway,
tilt, synchronised with the distance and switched off when stopping). It is
edited in the animation inspector and appears as a bar in the camera
track. *Room walkthrough* is enabled once K2 exists.

**Depends on.** N1.

**Acceptance.** `evaluate` tests: the speed is constant ±1 % over the
whole curve except start and stop; the camera height is the eye
height ±0 without steps and oscillates with the requested amplitude and cadence
with steps; with *towards a target* the target stays at the centre of the
framing ±0.5°; stopping halfway along the curve switches off the sway in less than
one step; the same `t` always gives the same camera. A 4 s video of the
walk around the bottle, with and without steps.

## X1 · Confirm the AI model — **Fable**, with Sonnet preparing

**Part A, brought forward (U6 needs it) — done.** Sonnet prepared and the
lead confirmed the data (2026-10-13): the seven keys with their files
pinned to a commit, sizes and `sha256` checked against two sources, and the
licences quoted in `docs/ai-licences.md`. The lead's decisions:
`ZIMAGE_WEB` stays **unavailable** (the published ONNX export
does not include the VAE encoder; X3 exports it); official Qwen3-4B text encoder,
ggml-org's Qwen2.5-VL and Unsloth's klein Q4_K_M, all three to
be tested in part B; storage by `sha256` so as not to download shared files
twice. What did not fit the table: SD 1.5 weighs 3.6 GB and not
3.1 (the encoder and VAE were missing) and Qwen-Edit 19 GB (the vision
projector was missing); the "lighting LoRA" has no chosen file and comes from
the description. The JSON enters the repository with P2.

What was asked for: Sonnet prepares and Fable confirms `src/data/ai-models.json`: for each key of `AI-POST.md` §2.4,
the source repository, each file with its direct download URL,
exact size and `sha256`, the licence with its quoted text and its URL, and the
recommendation rule as a data table. No measurements yet: the
thresholds are those of the table, marked *provisional*.

**Part B, after X3c.** `AI-POST.md` §2: re-read and quote verbatim the licences
of Z-Image-Turbo, its encoder, its VAE and its ControlNet, and of FLUX.2
klein 4B, and that of stable-diffusion.cpp and ggml; Sonnet prepares a
**tool** that generates the comparison sheet (8 engine renders
—product and interior—, 3 interventions, the two models, with the metrics of the §3.2
guard, the time and the memory peak, on Vulkan
and on CPU) and that is run **on a machine with a GPU** (there is none here); with
that sheet **Fable chooses** the model and sets the initial tolerances
(ΔE₀₀, edges, sharpness) and the thresholds of the §2.4 rule. The web `sha256`s
(q4f16) are pinned by X3d.

**Depends on.** X3c (the pipeline has to exist in order to measure).

## X2 · Engine passes for the AI — **Opus** — done

**What.** Contract in `AI-POST.md` §7.4 and `src/core/passes.ts`. In
`rt-core`: albedo (first non-specular bounce), normal,
depth, part id, material id and blur map (circle of
confusion of the thin lens) passes, with a pass mask in `RNDR`; export
in `rt-wasm`, accumulation in the E4 pool and reading in TypeScript; in the
launcher, `passes=…` in `/api/render` for final jobs, which stores them by id
for the pipeline, and `GET /api/render/<id>/passes`. It coincides
with the passes part of N2 and brings it forward.

**Depends on.** E4, and **E5 merged** (both touch the integrator).

**Acceptance.** Tests: the part id of each pixel matches the `pick`
at the pixel centre; the albedo of a diffuse material is its colour; the
blur map is zero at the focus plane and grows with
distance according to the thin-lens formula (±1 %); requesting passes does not change
a single pixel of the image; determinism and native/wasm parity intact.

**Done** (2026-10-13). `rt_core::passes` with the contract of §7.4:
`RNDR.passes` (40 B; earlier RSBs request none, unknown
bits are preserved), `render_tile_exact` (normal, depth,
ids and circle of confusion from **one ray through the pixel centre and the
lens centre**, `render::centre_ray`, once per tile) and `render_tile_albedo`
(the camera ray of each image sample, summed in `f32` in sample
order and divided like `Film::resolve`), on top of `integrator::first_hit`
(the nearest between geometry and floor; a light panel visible to the camera
crossed earlier is background) and `PassFilm`/`Passes`. The studio floor
(visible or shadow catcher) is `FLOOR_ID` in both ids; the background, 0 and
+∞. The passes have rays of their own: the image keeps its hashes
(`0x223515c3`, `0xbf8abd5b`, `0x2fcb098a`) with all the passes
interleaved. Pinned hashes of the six planes of the sample (albedo
`0x43571da9`, normal `0x0aabfd24`, depth `0x25f8dd11`, ids
`0xccd3d6c7` both, `coc` `0xdf87494c`) and of the E5 sample (`0xace93461`,
`0x714253d6`, `0x9b1b61c8`, `0x2c21fa55` ×2, `0x73bf76f1`), equal in
scalar, SSE2 and AVX2, in both WASI passes, in the real `rt.wasm`
(scalar and `simd128`, `tools/wasm-parity.mjs --expect-passes`, in CI),
through the launcher API with 1 and 4 threads and through the page code
(`tests/passes-engine.test.ts`). `rt-wasm`: `rt_render_tile_passes` and
`rt_render_tile_albedo`; the pool requests them with the job's mask and
joins them with `PassAccumulator` (`src/render/pass-planes.ts`), and
`renderPixels` returns `RenderPasses`. Launcher: `passes=` on
finals (400 if it names a pass that does not exist or in the viewport), a store of
the **last four** renders with passes by id (linear image and passes;
those over 64 MiB in `<data>/cache/ai/<id>.rpx` and `.rpp`, which is
cleaned on startup; the job's `DELETE` does not remove them), served as
`RPP1` in `GET /api/render/<id>/passes` (404 if it does not exist or was evicted,
409 while it is rendering), `Engine::kept` for X3c; `native.ts` requests it
and reads it with `parsePasses` and also returns `renderId`. The circle of
confusion is that of `lens-coc.ts` (both sides read
`tests/fixtures/lens-coc.json`) and matches within 1 % (in practice,
1e-5) the blur measured from the lens of `Camera::generate_ray`.
The three.js passes of X4 match those of the engine in ids and
depth in their test scene (compared in
`tests/ai-passes-browser.test.ts` with the real `rt.wasm`), except the
floor. Tests: 22 new in Rust (15 in `rt-core`, 1 in `rt-wasm` and 6 in the
launcher: store, `RPP1` format, jobs and API) and 12 in vitest; 19
mutations checked (each test fails if what it guards is broken).

**What did not fit the plan.** (1) **The floor in the three.js passes**: the
corrected contract (floor = `FLOOR_ID`) is met by the engine; the X4
preview still draws it as background (0, +∞). It is not touched here:
§7.4 gives it to X3c, and the browser test today accepts 0 on the floor
pixels and notes it. (2) Decisions where the contract said nothing,
noted in §7.4: the albedo of an emitter is its `base_color`; that of the
floor, `FLOR.color` also in the shadow catcher (which does not use it to
paint); with depth of field the albedo follows each sample through the
lens and is blurred like the image (X2's comparison with the X4
reference only requires the exact colour where `coc` < 0.25 px); a
cut-out or a glass stops the passes' ray, like `pick`; an
instance with an out-of-range material index carries `materialId` 0.
(3) In the sample and in the E5 one, instance *i* carries material *i*, so
their id planes have the same hash: the order of the two planes
is guarded by the file `tests/fixtures/passes-3x2.rpp` (written by the
launcher and read by the page) and by the X4 scene, where they do not coincide.
(4) The mask travels by two routes in the launcher (`RNDR.passes` and
`passes=`): a final renders the union. (5) The passes' rays
count towards the job's rays (`rays` of the frame): one per pixel for
the exact ones and one per sample for the albedo. (6) `engine/README.md` is
entirely in English; its passes section too, so as not to split the
file. (7) **With P3a** (merged afterwards): the passes are rendered with
the threads or workers that the render has, also when the viewport
is still alive in its share (`share=`, the pool's lanes), and the same bits come out
(proved by the launcher and the pool); a cancelled, orphaned
(its page stopped asking) or failed final stores nothing; `native.ts` reads the
passes with the render's cancellation signal and before releasing the
job (`DELETE`, `pagehide`), and `GET /api/render/state` gives the mask of
each job.
## X3 · Post-processing pipeline and guard — split into X3a–X3d

The lead's decision (`AI-POST.md` §7): on desktop everything native (the
page only sends settings and receives results), the guard in a crate of its own
without dependencies, and the web behind it.

### X3a · `rt-post`: the guard and the pixels — **Opus** — done

**What.** `AI-POST.md` §3.2 and §7.2: `engine/crates/rt-post` (`std` only,
`f32`, deterministic, no `unsafe`) with conditioning (edges at the id and
normal changes, normalised depth), a tile plan with overlap and blending,
padding to a multiple of 16 and cropping, the complete **guard** (shading
transfer, frequency separation, regions by id with ΔE₀₀, sharpness against
the blur map), the checks and the step machine with backoff; `rt-post-wasm` →
`public/engine/post.wasm`; in `src/ai/`, the TypeScript wrapper of that
wasm and the prompt from materials and lights (`prompt.ts`). Report with the
shape of `GuardReport` (`src/core/ai.ts`).

**Depends on.** Nothing (the passes are synthesised in the tests).

**Acceptance.** The guard, tested with a synthetic "model" that does
forbidden things (moves an edge, changes the colour of a material,
blurs what is in focus, sharpens what is blurred, changes the size, touches
outside the regions): each one is detected and corrected or rejected;
with intervention 0 the output is bit-for-bit identical to the input without
calling the model; the output resolution is always the job's; the
same result native and in wasm, bit for bit; engine gates
(`fmt`, `clippy`, no dependencies in `Cargo.lock`).

**Done.** `engine/crates/rt-post` (`#![forbid(unsafe_code)]`, only
`std` and `rt-core` for `fmath` and the tone curves) with the step machine
`plan(&job) → Plan` (tiles of ≤ 1024² with overlap ≥ 128 px and
the same size, padding to a multiple of 16 repeating the edge; no tiles
if Intervention is 0 or all the aspects are at 0, and then the output
is the input bit for bit without calling the model), `tile_input` (the engine's
image with its exposure and curve, 8-bit sRGB), `conditioning`
(edges 255 on both sides of each change of `partId`, `materialId` or
a normal of more than 30°; depth normalised over the whole image, near
255, the farthest surface 16, background 0) and `accept(&plan, &original,
&passes, &outputs, attempt) → Accepted{image, report} | Retry{strength,
attempt, reason} | Rejected{report}`; `run` is the driver for a
model given as a function. The guard always multiplies the engine's
image by a gain: (a) transfer `ln blur(model) − ln
blur(engine)` (normalised Gaussian over the open regions,
σ = 16·√MP between 8 and 32, computed on a grid up to 8 times
coarser and returned with a cubic B-spline), brought to scene light by the
local slope of the tone curve and split into common change (Style
strength), local luminance (Light, grey gain) and local colour
(Bounces), each part by its control and capped by control × strength of the
attempt; (b) the model's mid band (σ 3 px to low σ) only on materials
with wear, in focus (coc ≤ 1 px, none at ≥ 3 px) and more than 8 px from
an edge; (c) background and locked materials intact and the colour change
of each material reduced until its mean and p95 ΔE₀₀ are within
80 % of the tolerance. Checks independent of how the
result was made: size, pixels changed outside what is allowed (bit
for bit), edge displacement (gradient peak with parabolic refinement,
in the channel with the largest jump), high-band SSIM, sharpness
per 32² block against the blur map and ΔE₀₀ per material
(Sharma, Wu and Dalal's CIEDE2000, 2005, tested with its 34 pairs).
**Provisional** tolerances in a single `struct` (`Tolerances`, stable keys,
can be passed in the job to calibrate): mean ΔE ≤ 2,
p95 ≤ 3, edges ≤ 1.5 px, high SSIM ≥ 0.98, focus ≤ 15 %, caps of
Light 0.3, Bounces 0.15, Style 0.2 and Wear 0.15 (natural logarithm, at
control and intervention 100). JSON report written by hand with the exact
shape of `GuardReport`. `rt-post-wasm` → `public/engine/post.wasm`
(189 KB, no imports) from `npm run engine:build`; `src/ai/post-wasm.ts`
(`PostGuard`, `PostSession`, `runGuarded`, `encodeJob`; worker and Node,
checks the sizes before passing pointers) and `src/ai/prompt.ts`
(`buildPrompt`, fixed negative, `guardMaterials`); `AiGuardMaterial`
added to `src/core/ai.ts`. 50 Rust tests (47 in `rt-post`, 3 for the ABI)
and 16 in vitest; the synthetic "model" moves edges, changes the colour of
a material, blurs what is in focus, sharpens what is blurred, touches the background,
puts wear everywhere and returns another size, and each test fails
if the step that covers it is switched off (checked by switching them off one by one in the
code). Parity: `tests/fixtures/ai-guard.json` (five scenarios:
intact, forbidden, strong, limited, rejected) is pinned by the native test and
the real `post.wasm` reproduces it bit for bit (image, model inputs and
JSON), also in CI. Single-thread native performance: ≈ 2.3 s per attempt
at 1 MP and 7 s at 4 MP.

What did not fit the plan: (1) "Transfer in the logarithmic
domain" was done as the logarithm of the ratio of the blurs (of
light, not of logarithms: blurring logarithms turns smudged text
into a change of light, by Jensen's inequality), as §3.2 says.
(2) The guard works in scene light: the change the model
makes on screen is carried to the scene by the curve's slope, and Light
is a grey scene gain (like more light in the engine); at the shoulder
of the curve that desaturates slightly, so the ΔE₀₀ per material is measured
against the engine's image **with the allowed change** (style and
luminance within the caps) seen through the same curve: it measures the change
in the material's colour, not that of the light. **Fable must confirm that
criterion** in X1b. (3) Sharpness, detail and edges are measured in scene
light (the curve compresses the contrast of highlights as a brighter
render would, and that is not blur), and detail and focus look at
the interior of the regions (4 px from an edge, the jump of a
silhouette changes when relighting only one side; edges have their own
check). The high-band SSIM also excludes the pixels where
Wear may add detail. (4) Edge check per channel
(maximum of the three): with luminance only, relighting a part to the
luminance of the background "erased" an edge that is still seen through
colour. (5) A tile of another size is rejected at the first attempt (a lower strength would not
fix it) and the engine's image is delivered. (6) Provisional
rules it leaves noted for X1b: wear is admitted by every family
with wear types in the catalogue (all but the emissive one; perhaps
glass should not), emitters stay locked, depth of the farthest
surface 16. (7) `AiPostRequest` does not carry the guard's material table
nor the RSB's material order: X3c will have to
add `materials?: AiGuardMaterial[]` (or derive it in the launcher)
and `io/rsb.ts` export the order (`guardMaterials(state, order)` already
expects it); the tone curve code (`tonemapFor`) also lives in
`io/`, so the job receives it as a number. (8) The reason of a
LIMITED says how much was reduced, not why the first attempt failed; the
reason for each retry comes out in `Retry.reason` for the log. (9)
Alignment: the `post.wasm` ABI receives *little-endian* bytes, not
aligned `f32`, so as not to require pointer alignment.

### X3b · stable-diffusion.cpp on desktop — **Opus** — done

**What.** `AI-POST.md` §7.1: `src/data/ai-runtimes.json` with the official
builds pinned (Vulkan and CPU, Windows and Linux x86_64:
URL, size, `sha256`, quoted licence, version, `supports` checked),
the selection rule (Vulkan with a GPU, CPU without one) evaluated identically by the
interface and the launcher, download and installation from *Settings ▸
AI post-processing* (*Inference runtime* row, with progress, resumption
and `sha256`, to `<data>/ai/runtimes/<sha256>/`), the helper process in
`rt-app` (startup, arguments per model key, progress,
cancellation, time limit, shutdown with the application, no
console window on Windows) and the API `/api/ai/runtime` (state as
`AiRuntimeStatus`) and `/api/ai/run` (one *img2img* inference without guard:
image, control, prompt, strength, seed).

**Depends on.** P2.

**Acceptance.** Tests with a **fake** helper process (a test binary
that speaks the same protocol): exact arguments per key, progress,
cancellation, time limit, hung process, output of a different size rejected; a `sha256` that does not
match is not installed. With the real Linux CPU build, `--help`/version are
read and the *Settings* row shows it. Without downloading multi-GB weights in this environment: the
first real image is made on a machine with a GPU.

**Done.** `src/data/ai-runtimes.json` pins the official release
**`master-959-d637cfb`** of stable-diffusion.cpp (commit `d637cfb9…`,
2026-10-12; ggml `d25b121c…`): `SDCPP_WIN_VULKAN` (30,139,117 B),
`SDCPP_WIN_CPU` (17,558,769 B), `SDCPP_LINUX_VULKAN` (37,009,067 B) and
`SDCPP_LINUX_CPU` (26,143,940 B), each zip downloaded once to measure it
and compute its `sha256`; MIT licences quoted in `docs/ai-licences.md` §7.
`supports`: the six desktop keys according to the tag's documentation
and the arguments we build; `verified: []`. In the same JSON, as
data that X1 can correct without touching code: the **selection rule**
(`choice` rows, evaluated identically by `src/core/ai-runtimes.ts` and
`rt-app/src/ai/catalogue.rs`, both against
`tests/fixtures/ai-runtime-cases.json`) and the **profiles per family**
(load arguments with `@role`, steps, cfg, sampler, *flow shift*,
image as `init` or `init+ref`, ControlNets). In `rt-app/src/ai/`, `std` only:
own *inflate* (RFC 1951) and zip (APPNOTE, Zip64), a complete PNG reader
(all types, filters, Adam7), base64; the runtime store
(`<data>/ai/runtimes/<sha256>/`, `sha256` before installing, safe
decompression, `--version` and `--list-devices`); the **server mode** (`sd-server`,
native API `/sdcpp/v1/img_gen`, the model stays loaded) on a random local
loopback address, with progress read from standard output,
cancellation, time limit, hang detection, crash handling, rejection of a different
size, release on inactivity and on closing, and clean-up of
one left over by a previous launch; the API `/api/ai/runtime`,
`/api/ai/runtimes/<key>/…` and `/api/ai/run`. Interface: `src/io/ai-runtime.ts`
and the *Inference runtime* row of *Settings* with *Run on*
(`ai.backend`). Tests with `rt-fake-sd`, a test binary that speaks
the same protocol, and with the real `curl` against a local server. **For
real**, here: the four zips unpacked by our reader come out
identical file by file to those of Python's `zipfile`; the real
Linux CPU build is installed through the launcher and answers `--version`
(*stable-diffusion.cpp version unknown, commit d637cfb*), `--list-devices`
and `--help`, and the row shows it; the real download from GitHub with a pause at
4.7 MB and resumption takes 4.3 s; and a real *img2img* with `SD15_LIGHT` on
CPU (512², 8 steps × strength 0.5 = 5 sampling steps, pinned weights
checked by `sha256` and deleted afterwards) gave a correct image in
**1307 s** end to end (the machine shared with other agents, with
a load average of 10 to 15 on 4 vCPU: 1 s to start the server,
3.5 min reading weights on first use, 6 min until the first step (encoding the
image), 2.5 to 3 min per step and 3.5 min decoding; it is not a
performance measurement, which belongs to X1 part B).

**What did not fit the plan.** (1) The download cannot be done by the page
like the models': GitHub release downloads do not send CORS
headers. The launcher does it with the system's `curl` (on Windows
since 10 1803), with the same progress, pause, resumption and `sha256`; without
`curl`, *Install from a file…*. (2) There is no official "AVX2"
build: the CPU one carries all the x86-64 variants of ggml and chooses at
run time. (3) The Windows ones need the Visual C++ 2015–2022 runtime
(they do not bring it): if it is missing, the row says which DLL; the installer
(P2) should install it. The Linux ones need glibc 2.38 (Ubuntu 24.04
or later). (4) `sd-server` reflects any `Origin` and numbers its
jobs: hence the random address `127.a.b.c`. (5) It loads the weights
on first use: the first job shows *Loading*. (6) The editing ones
(klein, Qwen-Edit) go as *img2img* plus a reference image
(`init+ref`): our own construction, untested. (7) `ai.gpu` (which GPU) is
not passed: there is no reliable correspondence with the Vulkan indices; stable-diffusion.cpp
chooses. (8) The limits (load 30 min, image 60 min,
silence 10 min, inactivity 5 min) are starting values, for X1. (9) The catalogue of builds is
always the bundled one; the tests supply their own with `server::Options` when building the server, a field that the
application never fills. (10) *About* does not yet list
stable-diffusion.cpp and ggml: their texts go in the runtime folder and in
`docs/ai-licences.md`.

**Correction after merging (CI in release).** The first version read
`<data>/ai/runtimes-override.json` only in debug builds, and the tests
came in through there. The engine job in CI also runs
`cargo test --workspace --release`, and there 9 of the 11 tests in
`tests/ai.rs` failed: the tests were more permissive than the real
binary. Now the catalogue and the test downloader enter through
`server::Options { ai_runtimes }` (`Server::start_with`). `Ai::new` no longer
reads anything from the data folder in any build, and
`a_catalogue_in_the_data_folder_is_never_read` checks it, failing if the reading
returns. There was a second debug assumption: the pause and resume test
expected more than 1 MB downloaded, and in release the fake takes up less than 600 kB. The
file now carries 8 MiB of padding and the pause is requested at 1/8 of the total. Both pass: `cargo test --workspace`
and `cargo test --workspace --release`.

**Second correction (CI, the orphan server).** On the GitHub
runner, `a_server_left_by_a_previous_launch_is_stopped_at_start` failed
one time in two with "the orphan still runs". The cause was in the
test. It started the fake server an instant before the clean-up.
`posix_spawn` is a *vfork*, and Linux lets the parent continue before the
child's `execve` finishes, while the child is still using the parent's memory.
At that moment `/proc/<pid>/exe` still names the test's executable,
so the clean-up was right not to kill it. It was reproduced
locally by holding the child's `exec_update_lock` (`/proc/<pid>/syscall`):
the `exe` read was the test binary. Now the test waits, by condition and
with a 60 s deadline, for the fake to have created `args.log`
(which its own code does), and kills it at the end even if it fails. With
the lock held it passes 20 of 20 times; the earlier form failed 2 of
20. While reviewing how the process is recognised, a real orphan appeared:
the clean-up compared the path as it was written, and if the data folder
is behind a symbolic link, the kernel gives the path with the link
resolved. A server left there was never stopped. Now the file is compared
(device and inode, `proc::runs_server`), or the path with links resolved
when the file no longer exists. Checked by
`a_server_left_in_a_data_folder_behind_a_link_is_stopped_too` and the
unit test `a_server_is_recognised_through_a_link`; both fail
with the previous comparison.

### X3c · The complete desktop pipeline — **Opus** — done

**What.** `AI-POST.md` §7.3: `/api/ai/post` in the launcher (stored passes
of the render → `rt-post` → stable-diffusion.cpp per tile →
`rt-post` → retries), progress and cancellation; the desktop
`AiPostService` in `src/io/`; integration in the queue (the job stores the
two images and the report; the history keeps them); `AI_AVAILABLE`
becomes whatever `status()` says. In addition, what X3a and X4 left noted: the floor with `FLOOR_ID`
(`AI-POST.md` §7.4) in the guard, the synthetic service and the three.js
passes; the guard's material table in `AiPostRequest` and the
material order exported by `io/rsb.ts`; the real prompt from
`src/ai/prompt.ts`; the `RENDER` source in the queue; the Visual C++
libraries that stable-diffusion.cpp needs on Windows (next to the
executable or in the installer); stable-diffusion.cpp and ggml in *About*.

**Depends on.** X2, X3a, X3b; X4 to see it end to end.

**Acceptance.** End to end with the fake helper process: a final
render with AI leaves two images and the report in the history; with
intervention 0, the AI image is the engine's bit for bit; cancelling
halfway leaves the engine's; a model that the build does not load comes out with
the reason. A short checklist for a machine with a GPU (Vulkan,
a 1024² image, time noted).

**Done** (2026-10-13). **Launcher** (`rt-app/src/ai/post.rs`, which now links `rt-post`):
`POST /api/ai/post` with `{source: {kind: RENDER, renderId}, settings, prompt, negative, modelKey,
materials}` or, for the preview, the binary `RPI1` body (JSON, `RPL1` image, `RPP1` passes,
≤ 512 px); `GET /api/ai/post/<id>?after=n` (state, `stage`, tile and attempt from 1, fraction
that does not go backwards, `calls`, the `GuardReport` at the end), `GET …/image` (`RPL1`, linear with straight
alpha) and `DELETE`; `aiPost: 1` in `/api/info`. The native driver is the step machine of X3a
(`plan` → `tile_input` and `control_planes` per tile → the `sd-server` of X3b, loaded between
calls → `accept` → retries at `RETRY_FACTOR` up to `MAX_ATTEMPTS`); with Intervention 0 the plan
has no tiles, the inference runtime is neither prepared nor started (it works without it installed) and
the image is the engine's bit for bit; a tile of another size reaches the guard as such (the
`size` check) and is rejected at the first attempt; a post that nobody asks about for 2 min is stopped.
The X2 store keeps with each render its exposure and its curve (`Look`, also on disk), and the
linear image is the page's conversion (`linear_of`: the sums by `fround(1/n)`, the colour divided by
the coverage where it is not opaque, the threshold `1 − 1e-6` in `f64` like the JavaScript number; an
`f32` threshold would have called the `f32` just below opaque, and the test watches for it). The fake
`rt-fake-sd` gains a `gain` mode (it brightens smoothly, like a model that obeys) and `acceptMs` (an engine that takes time to accept the job, to see the start state of each tile). **Visual C++**:
`proc::missing_dll`, `Probe.dllMissing` and `needs_vc_runtime` (Windows, a DLL that is missing and some from the
Visual C++ runtime absent from the engine's folder and from `System32`) → `vcRuntime: "missing"` and
`vcRuntimeUrl` in the row; the interface shows *Install Microsoft Visual C++ runtime…* (Microsoft's official
page with `openExternal`: we do not redistribute its DLLs) and *Check again*.
*About* lists stable-diffusion.cpp and ggml with their MIT texts, copied byte for byte from the pinned commits
(`tools/third-party/`, `tools/licences.mjs`). **Page**: `src/io/ai-post.ts`
(`DesktopAiService`: `status()` is `/api/ai/runtime` with the person's settings and the active model,
`aiRuntimeQuery` from `src/ui/ai-query.ts`; `post()` sends, follows, reads the image and forgets; an abort sends `DELETE`); `main.ts` uses it
when the launcher says `aiPost`, the web continues with `notBuiltService` and `?ai=synthetic` with the
synthetic one; **`AI_AVAILABLE` no longer exists**. The queue asks the render to leave the guard's passes in the
launcher (`aiPasses`, `passesInLauncher`: they do not even come back to the page; without albedo, which the guard does not
use and which costs one ray per sample), sends the `RENDER` source with the material table
(`guardMaterials` over `ProjectScene.materialOrder`) and the prompt from `src/ai/prompt.ts`, shows the
progress per tile in the row (*AI · tile 2 of 4 · attempt 2*, `RenderProgress.ai`) and writes the
AI image from linear light with the render's exposure and curve (`straightBytes`,
`straightWords16`, `straightExr`: 8- and 16-bit PNG bit for bit with the engine's, EXR on every opaque pixel);
stopping or pausing during the AI keeps the engine's image in the history and, with *Pause*, the job
goes back to waiting as in P3a. **The floor, `FLOOR_ID`**: in the guard it was almost a region, but
`FLOOR_ID` is `u32::MAX`, the same value the region cache started with, so a floor seen
before any part stayed as background; now it is a real region, which is relit and has
its colour check (*Floor*, no wear); the control's depth is normalised over the parts
and the floor is drawn at that scale, clipped (its plane reaches the horizon); the synthetic service names it;
the three.js passes find it with the engine's central rays (`floorHits`, perspective and
orthographic, also from below the floor) and match the engine's on every floor pixel,
horizon included. **For real here**: the real launcher with all of the page's code (native engine,
queue, desktop service) against the fake installed where the pinned Linux build would go
(`tests/ai-desktop.test.ts`); and once the whole pipeline with real stable-diffusion.cpp and SD 1.5 with its
depth ControlNet on CPU (`real_post_with_sd15_and_its_depth_controlnet_on_the_cpu`, ignored without the weights): the 256 × 192 sample with the floor, Intervention 100 and 10 steps (5 of sampling at strength 0.4), **53 s** on 4 cores (13 s of weight loading, ~6.5 s per step), accepted at the first attempt: detail 0.998, edges 0.02, ΔE₉₅ 1.9 on the coral and 1.6 on the blue; the floor reached 2.2 and the guard left its colour change at 71 %. The weights were deleted afterwards. **With the fake**: everything else. Tests: 13 new in
Rust (3 in `rt-post`, 3 unit tests in `rt-app` and 9 in `tests/ai_post.rs`, one more ignored with the real
weights) and 29 in vitest (14 for the service and what is asked of it, 4 against the real launcher, 4 for the queue, 3 for the passes, 1 for the
synthetic, 3 for the runtime row and *About*), plus those of X2 and X4 that change with the floor; 26
mutations checked, each test fails if what it guards is broken.

**What did not fit the plan.** (1) **The control**: §3.2 asks for edges and depth from the ControlNet, and *tile*
for large outputs; `sd-server` carries a single loaded ControlNet and only SD 1.5 has any in the
profiles (*tile* and *depth*), so the depth from the passes is sent (the first `depth`, `tile`
that the family has) in preview and in final alike, so as not to restart the server between one and
the other; edges have no ControlNet in the profiles. Provisional decision for X1b. (2) **Depth
with floor**: §7.2 says "normalised over the whole image"; with the floor as a surface, its plane to
the horizon left the product in a few levels, so the scale is that of the parts and the floor is
clipped to it (without parts, the floor sets the scale). Pending for Fable in X1b. (3) **EXR in the
viewer**: the history stores the AI image of an EXR job as it is (EXR) and browsers do not
show it: the thumbnail comes from an 8-bit copy, but the viewer does not compare *Render | AI* in EXR (it would need
a second view image in the history, like the engine's `display`; noted). (4)
**Pause during the AI**: the job goes back to waiting (P3a: a render is not resumed halfway) and the engine's
image is already in the history, so *Resume* leaves a second result of the same job. (5)
**`AiPostRequest`** gains `materials?` (added); the rest of the added contract goes outside `core/ai.ts`:
`FrameRequest.aiPasses`, `FrameResult.renderId` and `tone`, `AiEncodeOptions.tone`, `AiPort.materials` and
`renderSource`, `AiPort.scenePrompt(state, settings?)`, `RenderProgress.ai`, `PassIds.floor`,
`RenderOptions.passesInLauncher`, `AI_GUARD_PASSES` (`core/ai-post.ts`). (6) The AI fraction takes up the
job's bar in its place (the render has already finished): the row says what it measures. (7) The Visual C++ libraries do not go
next to the executable nor in the installer: they are not redistributed; the button leads to Microsoft. (8) *Settings ▸
AI post-processing* no longer says *arrives in a future version* where the service does not say `NOT_BUILT`.
(9) Switching the toggle off releases the model (`DELETE /api/ai/sidecar`, which does nothing if a job
is using it). (10) The `detailSsim` tolerance (and the others) can be passed in the request (`tolerances`) to
calibrate in X1b; the tests use it to force retries. (11) With the real engine, the first
call says *inference* half a second before `sd-server` paints its loading bar (the job is already
`generating` and there is no bar yet); the fraction does not go backwards and then says *loading*: cosmetic,
noted for X3b. (12) **The active model in the render window**: without a hand-chosen model, the active one
is the recommendation for the machine, and the machine detection was only launched by *Settings*; with the
desktop service, the toggle said *No model downloaded* and led to *Settings* even though the model
was installed (the captures against the real launcher showed it). Now the desktop with `aiPost`
detects the machine at startup, the section also launches it, and the section asks again when what
it asks about changes (`aiStatusKey`: the device, the backend, the active model, the installed models), with its
test. (13) **The results viewer header** squeezed the guard report into a narrow column
next to the title, one or two words per line (the button bar did not give way): now the report has its
own line at full width (a single one, with an ellipsis and the full text in the tooltip), the bar goes under
the title when they do not fit together and *Close* stays in the corner. `tools/ai-post-check.mjs` (j) measures it at
1600, 1280 and 960 px in English and in Spanish (overlaps, header overflows, a single line, full width, the
full title) and fails with the earlier header; captures `docs/ui/ai-results-viewer.png` and
`ai-results-light.png` redone.

### X3d · The web — **Opus**

**What.** `AI-POST.md` §2.3: ONNX Runtime Web (MIT) with WebGPU in
per-stage workers, **export the VAE encoder to ONNX** from the Apache-2.0
`ae.safetensors` so that `ZIMAGE_WEB` exists (with its
`sha256`s), cache in OPFS with `persist()`, fragments of ≤ 1 GiB, the
step-machine driver in a worker with `post.wasm`.
New dependency noted in `ARCHITECTURE.md` §1.

**Depends on.** X3c.

**Acceptance.** The same as X3c with the web service; without WebGPU, the
toggle stays disabled with the reason.

## X4 · Post-processing interface — **Sonnet** — done

**What.** `AI-POST.md` §4 and §7.5: toggle, six-control
configurator, protection chips, *Another variation*, preview in Fast
mode with a divider (the §7.4 passes drawn with three.js at the preview's
size), updating on release with the measured time, a full-engine
preview option, the guard's report in the results viewer
with U5's divider, and the two thumbnails in the queue; the
settings in the store (§7.5). All against `AiPostService`
(`src/core/ai.ts`) with a **synthetic service** (deterministic, no
model) until X3c connects the real one; in the meantime the toggle says
*coming soon* outside the tests.

**Depends on.** U5, U6; the contract in `src/core/ai.ts`.

**Acceptance.** Each control at 0 does not change the look (test with the synthetic
service); the preview is not recomputed during a drag; the
three.js passes match the engine's in ids and depth in a test
scene; captures of the section and of the viewer with the divider.

**Done.** *Store* (§7.5): `RenderSettings.ai` is `{ enabled, previewFullEngine }
& AiPipelineSettings` with `DEFAULT_AI`; `normaliseAi` leaves the controls as
integers 0..100, an unknown style as `NATURAL` and the seed as u32, and
returns the same object when nothing changes; an old project (`{ enabled }`)
opens with the default values; each control is an undoable `render/set`
action (dragging a control, one step), *Another variation* changes the seed
(`nextSeed`, congruential without repetition), jobs copy the settings and
the default intervention from Settings reaches new projects. **Render
window** (`ui/panels/ai-post.ts`): toggle with the line for the model in
use (data from the Settings manager), the reason from `AiUnavailableReason` when it
cannot, and open Settings when the model or runtime is missing; the six controls with their
sentence, the six chips with a lock and no toggle, and *Another variation*; Fast-mode
preview at 384–512 px with U5's divider, **on release** (the
brain is in `ui/ai-preview.ts`, without DOM: `hold`/`touch`/`release`, the
frame is reused while only the controls change, an old preview
is abandoned), time **measured** around the pipeline call,
the Fast-mode note and the full-engine option. **Passes with three.js**
(`render/preview-passes.ts`, `PreviewEngine.aiFrame`): albedo, world normal
with Z up, depth along the axis, part and material ids
(RSB index + 1, which `projectScene` now delivers in `ids`) packed
into bytes in an 8-bit target without filtering or multisample, and the circle of
confusion of the thin lens (`core/lens-coc.ts`). **Synthetic service**
(`ai/synthetic.ts`): a soft gain over the engine's image (light lifts
the shadows, bounces warm the low frequencies, style tints, wear
adds nothing, the seed only ripples), everything at 0 returns the input
bit for bit, a **measured** guard report (size, pixels outside, edge
displacement, high-band SSIM, sharpness per tile, ΔE₀₀ per material with
CIEDE2000) and the retry rule of §7.2 (`LIMITED`, `REJECTED`). It only runs
with `?ai=synthetic`; without it the toggle says *coming soon*. **Viewer and
queue**: the job stores the engine's image and, next to it, the AI's
(`…_AI.png`); the result keeps both and the report (`ResultMeta.ai`,
only added fields); the viewer opens *Render | AI* with the divider, the line
*Checked: …*, *The AI was limited to N %* or the rejection sentence, and saves
each image separately; the queue and the history show the two thumbnails.
**Storage of the second image**: an optional fourth parameter `ai` of
`ResultsStore.add` and `ai?` in what `get` returns; IndexedDB stores it in the
same blob record and the desktop, through P3e's slot, as
`<data>/results/<id>.ai.<ext>` with `PUT`/`GET /api/store/results/<id>/ai`
(a small change in `rt-app/src/appdata.rs`, its test and the crate's
README); no new access to browser storage on
desktop. Tests: 1,390 in vitest (98 for X4, 6 of them in a Chromium with SwiftShader
that is skipped where there is no browser: three.js against the CPU ray with the
engine's rules) and one new launcher test (`rt-app`, 9 in `appdata`);
8 mutations checked; 25 browser checks in
`tools/ai-post-check.mjs` (and those of U5 and U6 remain green).
Captures: `docs/ui/ai-section-dark.png`, `ai-section-light.png`,
`ai-results-viewer.png`, `ai-results-light.png` and `ai-queue.png`.

**What did not fit the plan.** (1) `AI_AVAILABLE` is no longer read by the store:
`patchSettings` left `enabled` false while the constant was, and
with a service that says `available` that cannot hold; the toggle and the
queue look at `AiPostService.status()` (U5's test *“video and AI stay off”*
became *“video stays off…”*). (2) Until X3c the AI's input in the queue
is **INLINE**: the 8-bit image that has already been stored is decoded
(`display ?? file`) and the passes are drawn with three.js at the job's size,
instead of the `RENDER` source that the launcher will store with the
linear image; that is why the AI image comes out at 8-bit quality, even
in an EXR or 16-bit PNG job. The preview treats the Fast-mode image
(with its tone curve) as linear light decoded with sRGB; which curve
the real model sees is decided by X3c. (3) The `coc` follows `Camera::generate_ray`
(sensor at the focal length, aperture `focal/fstop`, focus plane at
`focusDist`): the footprint of a pixel on the focus plane is
`sensor/longSide × focusDist/focal`; the exact thin lens changes `focusDist`
to `focusDist − focal`. **X2 must emit the same formula.** (4) The
three.js passes are an approximation of the contract: the albedo is the base colour of the
first hit (it does not follow specular bounces), the floor and the light panels
do not count (background 0 / +∞), both faces of a triangle count and the
normal is given oriented towards the viewer; X2 has to decide the same or the difference
is noted. (5) *ΔE max* is the largest **mean** ΔE₀₀ of a material, and
*geometry ✓* gathers edges, pixels outside and high-band detail; if the real guard
splits the checks differently, `reportItems` changes. (6) The
synthetic service uses as limits the factory values of Settings ▸
Advanced, not X1's. (7) Animations do not go through the AI (the toggle
is disabled in *Animation*, with *coming soon*); the AI image is
saved alone next to the engine's, with the `_AI` suffix, so that a batch
has it without opening each result. (8) `numberField` and `slider` gain `onHold` and
`onRelease`, and the slider **now follows the value on undo** even if it has
focus (before, the knob stayed where it was while the field changed:
the browser check found it, and now guards it). (9) The
prompt is a placeholder (`AiPort.scenePrompt`: empty and the fixed negative of §3.2)
until X3a brings `src/ai/prompt.ts`; `rw.aiWhy.NO_WEBGPU` goes into
`WEB_ONLY_STRINGS` (it names the browser and can only occur on the web).

**Waits for X3c.** Connecting the real service (today `main.ts` chooses between the
synthetic one and `notBuiltService`), changing the queue's input to the
`RENDER` source with the passes that the launcher stores, the per-tile progress in the
job (today `onProgress` is ignored in the queue), X3a's prompt, removing
`AI_AVAILABLE`, and having the two history images come from the engine's linear
image. And X2: the same ids, the same depth and the same `coc`
that the preview draws (the browser test is the yardstick).

## X4b · Own prompt and variants — **Opus** — done

**Request (2026-10-13):** if the model supports it, leave a text
prompt in the settings of that render, and let a few
variants be made; by default, just one.

**Lead's decisions.**
- **Own prompt** in the *AI post-processing* section of the render
  window (it belongs to the job: it is stored in the project, is undoable and each
  job in the queue carries its own): a multi-line field, empty by
  default, of up to 400 characters, with the note *Describe the light or the mood; the geometry, the materials and the focus stay protected*.
  It is **appended** to the prompt generated from the scene (`src/ai/prompt.ts`),
  never replaces it, and the fixed negative remains. It only appears if the active
  model supports it: a new `textPrompt` capability in
  `src/data/ai-models.json` (added, nothing renamed; the bundled models
  have it; an imported one declares it in its `model.repackshot.json`);
  otherwise the field is shown disabled with the reason.
- **Variants**: a number from 1 to 8, **1 by default**, next to *Another
  variation*. A job with N variants makes **a single engine render**
  and N AI passes with consecutive seeds (seed, seed + 1…),
  with the model loaded once; the queue says *AI · variant 2 of 4 ·
  tile 3 of 4*; each variant carries its guard report. The preview
  remains a single variant. The estimated time is shown (N × what was measured)
  when there is a measurement.
- **Results**: a result stores the render and its N AI images
  (on desktop, `<id>.ai.<n>.<ext>` in the results folder; the earlier
  `ai` is read as variant 1); the viewer shows a strip of
  thumbnails to choose a variant, the divider compares the chosen one with the
  render and one can *Save this variant* or *Save all*; the
  history and the queue show how many there are. File names with the
  suffix `_AI`, `_AI_2`, `_AI_3`…

- **System prompt** (request, 2026-10-13): in *Settings ▸
  AI post-processing* a *System prompt* section, general for all
  images (it is an application setting, not a project one), with a
  multi-line field, *Restore default* and a note that
  the guard's protections do not depend on it. Order when composing:
  **system → scene → the job's own**; the fixed negative, separate. The
  default is set by the lead, in English (the models' text encoders
  perform better in English):

  > Photorealistic product photograph. Keep the image exactly as rendered:
  > the same composition, framing, geometry, proportions, edges,
  > materials, colours, labels, text and logos. Respect the existing
  > lighting: the direction, size, softness and colour of every light,
  > and the shadows and reflections they cast. Respect the existing depth
  > of field: what is in focus stays sharp, what is out of focus stays
  > soft. Improve only realism and naturalness: subtle light falloff,
  > soft contact shadows, natural bounce light and colour bleeding,
  > believable highlight roll-off, fine surface micro-detail and gentle,
  > plausible imperfections. True-to-life tones, as if shot with a
  > high-end camera and lens. No stylisation, no added objects or props,
  > no change of background.

  For models with a prompt length limit (SD 1.5: 77 CLIP tokens;
  a `maxPromptTokens` capability in `ai-models.json`), the short version
  is used, also from the lead, and the rest is trimmed in this
  order (the job's own first, then the scene, then the
  system), warning about what was trimmed:

  > photorealistic product photo, same composition, geometry, materials
  > and labels, same lighting and depth of field, natural soft shadows,
  > subtle bounce light, realistic highlights, fine micro-detail,
  > true-to-life colours, nothing added

**Acceptance.** Tests: the own prompt reaches the model after the scene's
and the fixed negative is intact; without the `textPrompt` capability, it is not sent and the
field says so; N variants = one engine render and N calls with
consecutive seeds, and cancelling halfway leaves the render and the finished
variants; save and open (project and results, including those with a
single earlier `ai`); undo of the prompt (a text change is one
entry on leaving the field) and of the number; strings in `es` and `en`; achromatic
chrome; captures of the section and of the viewer with several variants.

**Done** (2026-10-13). **Own prompt**: `AiPipelineSettings.userPrompt` (trimmed, up to
`MAX_USER_PROMPT` = 400 characters) in the render window section, under the six controls: a
multi-line field (`textArea` from `ui/components/controls.ts`) with a counter and the lead's note; it is
saved on stopping typing (700 ms) and on leaving the field, and everything in one visit carries the same gesture,
so it is **one** undo entry (*AI post-processing: Own prompt*); while it has focus, what
comes back from the store does not overwrite what is typed (trimming a trailing space does not eat it). It goes in the
project and each job carries its own; an earlier project opens without it. It is composed **system → scene →
own** (`composePrompt`, `src/core/ai-prompt.ts`; `buildPrompt(state, settings, context?)` in
`src/ai/prompt.ts`, which without context still gives only the scene's) and the fixed negative goes apart, the same. **Capabilities**: `capabilities: { textPrompt, maxPromptTokens? }` in each model of `ai-models.json` (all
with `textPrompt`; `SD15_LIGHT` with 77) and in the manifest of an imported one (the import form
asks for it); `ModelView.textPrompt`/`maxPromptTokens`; the model the service says is active governs
(`promptCaps`; the synthetic one admits everything, an unknown one nothing). Without `textPrompt` the field is shown
disabled with the reason and is not sent. **System prompt** (`ai.systemPrompt`, *Settings ▸
AI post-processing ▸ System prompt*): the lead's text by default, multi-line field,
counter, *Restore default* and the note that the guard does not depend on it; it may be left
empty; on desktop it goes in `settings.json` like every setting (test with P3e's spy). With
`maxPromptTokens` the **short version** is used while the text is the default (with the same
spaces or not) and it is trimmed word by word from the end, **the own, then the scene, then the
system**, with a conservative estimate documented in `AI-POST.md` §4; the line under the field in the
window says what is left out, and the one in Settings what the model in use receives. **Variants**:
`AiPipelineSettings.variants` (1–8, 1 by default) next to *Another variation*, undoable, with the line
of the seeds and the estimated time; changing it does not redo the preview (it is still one image). In the
queue, `aiStep` makes **one render** and N requests from the same origin (the stored `renderId`, or the image
decoded only once) with `variantSettings` (seed + n − 1), each image with its report and
`aiFileName(name, n)` (`_AI`, `_AI_2`…); the row says *AI · variant 2 of 4 · tile 3 of 4* and the bar
measures the variants together; stopping halfway keeps the render and the finished ones; a rejected one is left with
its report and no image; if one fails, the earlier ones stay. **Results**: `ResultMeta.aiMore` (the
first still in `ai`), `aiVariantsOf`/`aiImagesOf`, `ResultsStore.add(…, ai, aiMore)` in memory, in the
IndexedDB record and in the launcher as `<id>.ai.<n>.<ext>` with `PUT/GET /api/store/results/<id>/ai/<n>`
(`appdata.rs`, additive: `aiVariants` in the index; the earlier `<id>.ai.<ext>` is read as variant 1 and
`…/ai` remains); the migration from the browser copies them. The viewer has the **thumbnail strip** (a
line of its own between the header and the image), the divider compares the chosen one without losing the zoom
(`SplitCompare.setB`), its report on the line, *Save this variant* and *Save all*; the queue and the
history show *×4* and the queue *AI × 4*; the window footer, *AI on · 4 variants*. Tests: 39
new in vitest (22 for the prompt, the capabilities, the system and the store; 15 for variants against the
synthetic one, a service like the launcher's and the `DesktopAiService` against a stand-in launcher; 1 for
persistence of the setting on desktop; 1 end to end with the real launcher and `rt-fake-sd`: three
variants, one render, seeds 20, 21 and 22 in the fake engine's log, which does not start again), plus
those that changed (the launcher double learns `…/ai/<n>` as strict as the real one); 1 in Rust
(`appdata`); 10 new browser checks in `tools/ai-post-check.mjs` (k, l and the strip in j;
36 in total, all green);
18 mutations checked. Captures: `docs/ui/ai-section-prompt.png`, `ai-results-variants.png` and
`settings-ai-prompt.png`.

**What did not fit the plan.** (1) `userPrompt` and `variants` are **optional** in the contract
(`AiPipelineSettings`, so as not to break whoever builds one without them) and mandatory in the store
(`AiSettings` is `Required<…>`); the launcher does not read them: each request is one image with its seed and the
prompt already composed. (2) The composition and the count live in `src/core/ai-prompt.ts` (pure, so that
Settings can use them without the AI port) and `src/ai/prompt.ts` calls them. (3) On desktop the new variant 1
is written `<id>.ai.1.<ext>`, as the plan asks; `<id>.ai.<ext>` is kept for reading earlier ones. (4) The
*token* estimate is genuinely conservative: the short version counts 65 of the 77 (with real CLIP, about
45), so with SD 1.5 the own prompt almost never fits; refining it (or bringing the CLIP vocabulary,
1.6 MB) is left for X1b. (5) The system and scene prompts are also sent to a model without
`textPrompt` (as the scene's was before); only the job's own is withheld. An imported `sd15` or
`sdxl` without `maxPromptTokens` reads 77. Z-Image, FLUX.2 klein and Qwen carry no limit: their encoders
read hundreds of tokens and the longest composed text fits; X1b confirms it. (6) **The estimated time** is N ×
the job's pixels / the AI speed measured around each request of the last AI job
on this machine (`UiState.aiThroughput`), not N × the preview's measurement (at 512 px it says nothing about the
tiles of a final); without a measurement, the line says it is measured with the first one; it includes loading the model
if there was one, so it errs on the high side. (7) When comparing with another result (*Compare with…*) the strip only
changes the report line: the divider compares the two results. (8) `src/main.ts` did not pass the list
of variants to the history (`results.add` with four arguments): reading found it before a test did; it is guarded by
browser check (k), which is the one that goes through `main.ts`.

## X5 · Settings and models — absorbed into U6

The model manager, the chooser and the machine detection arrive in
**U6**, because they do not need the pipeline. What does need it (checking
live that the active model fits, and a one-image test from
*Settings*) moves to X4.

## X6 · The AI that shows and its stored preview — **Opus** — done

**Owner's request (2026-10-17):** «greatly improve the use of the local AI and
its interface: right now it barely affects anything the way it is asked to, and
I doubt the sliders affect anything at all. I'd like the preview to use saved
images, so the model doesn't have to be called just to see it, made with the
test model. And since we're doing it that way, render it with the full engine.»

**Audit (before X6).** What each control changed in what reaches the model or
the guard, read from the code (`src/core/ai.ts`, `src/ai/prompt.ts`,
`engine/crates/rt-post`, `rt-app/src/ai/post.rs`, `src/ai/synthetic.ts`) and
measured with the test model built in this phase (the mean |Δ ln| of the
product's pixels against the same job with that control at 0, at 0/25/50/75/100,
the others at their defaults; `every_band_control_rises_step_by_step_with_the_test_model`
run with the constants of before):

| Control | What reached the model | What reached the guard | Effect at 0/25/50/75/100 before X6 | After X6 |
| --- | --- | --- | --- | --- |
| **Intervention** | The img2img strength, `0.4 × I/100`: **0.2 at the default 50** (a fifth of the steps of an 8-step turbo model); the guard's retries lowered it to 0.12, 0.072… | Every cap scaled by `I/100` × the retry factor | 0, 0.018, 0.037, 0.055, 0.073 | 0, 0.059, 0.118, 0.176, 0.235; strength 0.15/0.30/0.45/0.60 |
| **Light** | Words only, and only whether it was above 0 (the same sentence at 1 and at 100) | **It did act**, contrary to the first reading: the band of local luminance, but as an attenuator: `light/100 ×` the model's change, capped at `light/100 × I/100 × 0.3`; at the defaults it let **half** of what the model did through | 0, 0.0038, 0.0076, 0.0114, 0.0152 | 0, 0.0114, 0.0227, 0.0341, 0.0454 |
| **Bounces** | Words, on/off | The band of local colour, same attenuating law (cap 0.15), then each material's ΔE limit | 0, 0.011, 0.022, 0.034, 0.045 | 0, 0.028, 0.056, 0.084, 0.112 |
| **Wear and micro-detail** | Words, on/off, naming the materials that allow wear | The model's mid band in wear materials, in focus, away from edges, same law (cap 0.15) | 0, 0.0009, 0.0018, 0.0028, 0.0037 | 0, 0.0028, 0.0055, 0.0083, 0.0111 |
| **Style** | **Words only** (`STYLE_PROMPTS`): the job did not even carry the style to the guard (`RPJ1` had no field) | Nothing: the six styles gave the same pixels with any model that ignores words | identical for all six | six different grades (warm above natural above cool in ln r/b by more than 0.02 each) |
| **Style strength** | Words, on/off | The model's change common to the whole image, same law (cap 0.2) | 0, 0.010, 0.020, 0.030, 0.040 | 0, 0.044, 0.088, 0.132, 0.175 |
| **Your prompt** | Words, after the scene's, only to a model with `textPrompt` (tested in X4b) | Nothing (by design) | — | the same: words, and the section says so |
| **Variants** | N requests, seeds `seed … seed + N − 1` (tested in X4b) | One report each | — | the same |
| **Another variation** | The seed (`sd-server`'s `seed`) | Echoed in the report | — | the same; the stored example has four seeds at the defaults |

So the first reading was half right: Light, Bounces and Wear never asked the model
for anything but words, which a small img2img model largely ignores, and the overall
strength was small; but in the guard each did gate its own band, only as a filter that
could at most let through **half** of what the model did at the defaults (and the band's
cap scaled with both the control and the Intervention, so the defaults' effect was
quadratic). The **Style** list did nothing at all past the words. And the synthetic
service the interface is shown with (`?ai=synthetic`) made Wear and the *Natural* style
do nothing on purpose (`'Natural adds nothing'`, `'wear has nothing to add'` were its
tests): there the sliders really did nothing visible. No test measured that a control
changed its band step by step: the tests checked 0 against 100 only.

**What was done.**
- **Each band control is a gain on the model's change in its band** (`BAND_GAIN_AT_100`
  = 2, `rt-post/src/prepared.rs`): 0 none, 50 the model's change as it made it, 100 twice;
  the model's change is clamped at the attempt's cap (`scale × cap`) first, so inside the
  cap the result is linear in the control. Light: the local luminance band; Bounces: the
  local colour band (and the materials' ΔE limit after it); Wear: the mid band in wear
  materials, in focus, away from edges; Style strength: the model's change common to the
  image.
- **The style is a real grade in post** (`rt-post/src/style.rs`, mirrored in
  `src/core/ai-style.ts` and checked by `tests/ai-style.test.ts`): per style a tint of the
  shadows, a tint of the highlights and a contrast, as a scene log gain that follows the
  low band of the engine's luminance (smooth, so edges, text and focus are the engine's by
  construction), by `2 × Style strength / 100 × the attempt's scale`, never on the
  background or a locked material. The colour check measures each material against the
  engine image *with the grade applied* (it is asked for), like the style's common change
  before it. The job carries the style: `RPJ2` (`RPJ1` still reads, as *Natural*), the
  launcher reads `settings.style` (an unknown key is *Natural*).
- **`MAX_STRENGTH` 0.4 → 0.6** (◆): the default Intervention 50 now asks for 0.3.
- **The report says where the guard limited an effect** (`GuardReport.capped`: the share
  of the open image where each band's cap held the model's change back; and
  `GuardMaterialCheck.kept`: the share of a material's colour change kept). The interface
  says it in plain words (`guardWords`, `src/ui/ai-report.ts`), with the checks that sent
  the stronger attempts back (*The AI was limited to 60 % to respect the protections: the
  stronger attempts changed the focus*).
- **A deterministic test model** (`rt-post/src/test_model.rs`, `AI-POST.md` §7.2): a
  stand-in for an img2img model that acts in every band the guard separates and ignores
  the words; `post.wasm` exports it (`post_test_model`, `PostGuard.testModel` and
  `testModelFor`), `rt-fake-sd` has it as its `model` image, and the stored preview is made
  with it. No small real model could run here: there is no GPU, and the one CPU run of
  X3c (SD 1.5, 53 s for a 256 × 192 image) would have taken hours for the sheet; the
  weights were not kept.
- **The synthetic service** gives Wear (a seeded micro-variation inside the materials the
  request lets wear into, in focus) and every style, *Natural* included, an effect of its
  own; its grade is the guard's table at a quarter of the guard's amount.
- **The preview is a stored example** (`src/core/ai-preview-sheet.ts`, `public/ai-preview/`):
  the example bottle, framed closer (the camera at 0.7 of its distance, its target 40 mm
  lower), rendered by the **Full engine** (`rt`, 512 × 288, 256 samples, 20 s on 4 threads;
  `rt --ai-inputs` writes its linear image and its passes), and its AI results through the
  real `post.wasm` with the test model at 0/25/50/75/100 of every control with the others
  at their stored defaults (the defaults snapped to the steps: Light 50, Bounces 50, Wear
  25, *Natural* 25), every style at every non-zero strength, Style strength 0, four seeds
  at the defaults, at Intervention 25, 50, 75 and 100, and the engine's image for 0:
  **161 images in WebP (quality 0.95), 0.74 MB** with `index.json`, reproduced by
  `tools/ai-preview-sheet.mjs` (which also writes `out/ai-preview-sheet.html`). All 161
  passed the guard at once. The section shows the one for the current controls as a
  slider moves (the nearest stored step; among examples equally near, the one with the
  control moved last at its value), never calls a model, keeps the divider, and labels
  itself: *Example: reference scene, Full engine, test model; your render will differ*,
  *Made at Intervention 50 · Light 50 · … — yours: Bounces 40, Wear and micro-detail 20,
  Style strength 30*, and what the guard did there.
- **Preview my scene (Full engine)**: the real pipeline on the job's own scene, always
  drawn by the Full engine with the job's samples and time (the option *Use the full
  engine for the preview* is gone); its result stays until a control, the scene, the
  camera or the size changes, and the button then says *again*.
- **The interface**: under each control, a line on what it acts on (Intervention's says
  the strength it asks for, from `MAX_STRENGTH`); the guard's words as a list under the
  preview; the time line is that of the person's own preview. Strings in `en` and `es`,
  achromatic chrome.
- **Two bugs found and fixed, each with its test:** (1) the median of the change common to
  the image was the histogram bin's **centre**, half a bin (5 × 10⁻⁴) off a change of
  exactly 0; it cancelled only while Light and Style strength scaled it alike, so with the
  band gains an **identity model brightened the image** (`median3` takes the mean of the
  samples in the median bin; `an_identity_model_changes_nothing_across_tiles`, which fails
  with the bin's centre). (2) The **focus check read Wear's detail as sharpening** on blocks
  that straddle the depth of field (a block whose mean circle of confusion is out of focus
  but which holds in-focus pixels of a wear material, the example bottle against its
  floor): it rejected every Wear above 50 on the example (`focus changed 1.43`); the focus
  check now leaves out the pixels where Wear may add detail and that are in focus enough
  to take it, as the detail check already did
  (`wear_on_a_surface_across_the_depth_of_field_is_not_read_as_sharpening`, which fails
  without it with *focus 44.0*).

**Tests** (each fails if its control is ignored; checked by mutation, below). Rust
(`rt-post`): `every_band_control_rises_step_by_step_with_the_test_model` (Light, Bounces,
Wear, Style strength: 0 at 0, every step at least 5 % above the one before),
`intervention_rises_step_by_step_and_asks_the_model_for_more` (and the strengths 0, 0.15,
0.30, 0.45, 0.60), `every_style_is_its_own_grade_and_warm_and_cool_go_their_ways` (also
with a model that changes nothing, and never on the background),
`style_strength_moves_both_the_grade_and_the_models_common_change`,
`another_seed_is_another_result_and_the_same_seed_the_same`,
`the_report_says_where_a_cap_held_a_band_back`, the depth-of-field test above,
`a_job_of_before_x6_reads_as_natural`, the style's unit test, the test model's, and in
`rt-cli` `writes_the_ai_inputs_of_a_render`; in `rt-app`, the style read from the request.
Vitest: `tests/ai-post-wasm.test.ts` (the test model through `post.wasm` and every
control's rising effect through the web's own driver; `RPJ2`; the report's `capped` and
`kept`), `tests/ai-synthetic.test.ts` (every control step by step, Wear only in its
material, every style its own), `tests/ai-style.test.ts` (the table is the guard's),
`tests/ai-preview-sheet.test.ts` (the grid, the lookup step by step, the differences said,
the store complete and under 4 MB, the guard's words in both languages). Mutations, each
making its test fail: Light, Bounces, Wear and Style strength ignored by the guard (each
its gain fixed at 50), the style ignored (every style Natural's grade), the grade's amount
or the common change ignoring Style strength, the strength ignoring Intervention, the
median's bin centre, the caps not reported, the focus fix removed; on the web side, Wear,
Light and the style ignored by the synthetic service, the lookup ignoring Light, and the
guard's words leaving the caps out.

**Judgement calls prepared for the verdict (◆):**
- ◆1 `MAX_STRENGTH` = **0.6** (was 0.4): the default asks 0.3. Measured with the test model
  only; X1b should confirm on Z-Image with the guard's verdicts.
- ◆2 `BAND_GAIN_AT_100` = **2** for every band control (50 = as the model made it).
- ◆3 The caps stay as they were (light 0.3, bounce 0.15, style 0.2, wear 0.15 natural log at
  100 % of the Intervention); with the gain, the most a band can change is twice that.
- ◆4 The six styles' grades (`style.rs`) and their amount (`2 × Style strength / 100 ×
  Intervention / 100`): at the defaults (30, 50) a Warm highlight takes +3.7 % red; at 100
  and 100, +27 %. The synthetic service uses a quarter of the guard's amount.
- ◆5 The reference scene (the example bottle, the camera at 0.7 of its distance and 40 mm
  lower, 512 × 288, 256 samples), the stored steps (0/25/50/75/100, one control at a time,
  four seeds at the defaults) and the lookup rule (nearest step, the control moved last).
- ◆6 The focus check now ignores the in-focus pixels of wear materials (point (2) above):
  it loosens a check on purpose, inside what Wear is allowed to do.
- ◆7 The test model's numbers (`test_model.rs`): what it does to light, bounce, the common
  change, the micro-variation and the grain at each strength.

**What did not fit the plan.** (1) The brief's examples asked for Light, Bounces and Wear
as per-band *strength or conditioning* sent to the model; `sd-server` takes one strength
and one ControlNet per call, so the band mechanism lives in the guard (a per-band gain), and
what reaches the model per control is still only words. (2) The prompt's sentences still
say only whether a control is above 0; scaling the words with the control was left out (a
small img2img model largely ignores them and the prompt tests pin the sentences). (3) The
stored example cannot cover every combination: one control at a time off the stored
defaults (and the style with its strength); the line under it says which of the person's
values differ. (4) `previewFullEngine` stays in the project's settings (stable keys) and is
no longer read. (5) The desktop launcher's `rt-fake-sd` gives the test model the tile's
own origin (0, 0): it does not know where the tile lies in the image. (6) The merge of
`origin/main` into the branch is a plain merge commit without the session's attribution
lines. (7) `tools/ai-post-check.mjs` (X4) was adapted: its checks of the old preview
(updated on release, the full-engine option) now check the example and *Preview my scene*.

## K1 · Scene type, interior lighting and interiors Doctor — **Sonnet** — done

**What.** `scene.type ∈ {PRODUCT, INTERIOR, CATALOGUE}` in the store and in
the inspector's *Product* section, with the table of default values
from `INTERIORS.md` §3.1 applied on changing it (defaults only: no
control disappears); a new **Interior** style in `LIGHT_STYLES` and
`LIGHT_SETUPS` (*Morning window*, *Midday window*, *Afternoon window*,
*Overcast*, *Night lamps*, *Blue hour*, *White studio room*),
each recipe with `world` and exposure, without touching the 72 existing ones; the
scene checks of the interiors Doctor from `INTERIORS.md` §3.6 that
do not depend on the engine (scale and units, missing opening with sun or
sky, thick glass, lens < 18 mm, eye height, near clipping,
inverted normals) with their fixes.

**Depends on.** U1, L4.

**Acceptance.** Switching type and back leaves the state identical except what
the owner touched (test); the new setups pass the count and normalisation
tests; each new check detects its case and its fix
clears it; capture with the *Interior* type active.

**Done.**

*Scene type.* `ProjectState.scene.type` (`PRODUCT` · `INTERIOR` · `CATALOGUE`, `Product` by default) and the
action `scene/setType`, a single undo entry. The values are data (`src/data/scene-types.ts`, `SCENE_TYPES`:
stable key, label and intent in both languages, and the default values of each type) and what applies them is
`src/core/scene-type.ts`. In the inspector's *Product* section, above *Product type*, a segmented control
*Product · Interior · Catalogue* with each type's intent in its help and a note saying that no control moves;
the *Light* section jumps to the *Interior* style when it is chosen (interface state, not project state) and goes back to *All* on
leaving it. **Switching type and back leaves the project as it was except for what was touched in between**: each value that a
type writes is a slot (10 fixed ones and one per camera, `camera.focal:<id>`) with what was there (`base`) and what the type
put (`applied`), stored in `scene.typeBase`. On switching, a slot whose value is still `applied` was touched by nobody
and goes back to `base` before the new type writes its own; one that no longer is was touched by the person, and its value is the new
`base`. A type that writes what was already there remembers nothing, and going back to Product leaves no memory (`scene.typeBase` disappears).
A loaded HDRI is not replaced by any type (it is the table's “or interior HDRI”, and `worldFor` also lets it win) and a
locked camera keeps its optics. **Project**: `scene.type` is saved and, as long as it is not Product, `scene.typeBase`; the
schema stays at 2; an earlier project has neither and opens as Product, a type this version does not know opens as
Product and of the memory only the slots this version knows are kept, with values that slot admits
(`normalizeSceneType`, `normalizeTypeBase`).

*The table of `INTERIORS.md` §3.1, as applied* (what Product does not write is what the project already has; the
rows that name something that does not exist yet are under “What did not fit the plan”):

| Row | Product | Interior | Catalogue |
| --- | --- | --- | --- |
| Environment | writes nothing | environment type *Sky* (sun and sky) | *Studio dome* and white colour background `[1, 1, 1, 1]` |
| Bounces | writes nothing (those of the quality level) | 16 (`render.advanced.maxBounces`) | 8 |
| Caustics | writes nothing (Automatic) | Off | Off |
| Floor shadow | writes nothing | no contact shadow (`studio.shadow` off) | contact shadow on and soft (`environment.groundShadow` 0.35) |
| Transform | writes nothing | AgX | Standard |
| Target samples | writes nothing (256) | 512 (the level becomes *Custom*), finish by noise and denoise in viewport and render | 256 (the *Preview* level) |
| Camera | writes nothing | 28 mm on each camera that is not locked | 50 mm |

*Interior style.* `LIGHT_STYLES` goes from 9 to 10 entries (`INTERIOR` last) and `LIGHT_SETUPS` from 88 to 95: the seven
recipes are **at the end**, so no earlier key or order moved (the 72 setups of the base catalogue and the
16 sets, intact: a test compares the 71 rigs with the fixture from before L6). Each recipe is a set without decoration:
it chooses its world (`SKY` with a sun light that places the sky's sun, or `STUDIO`), and brings its exposure offset
(`exposureEv`) and the environment intensity (`envStrength`), because the time of day **is** the image's brightness and here,
unlike the other setups, choosing one does change the look. The lights are normalised to the product-type level
as all of them are (a test with the 16 types: error < 10⁻⁶). A recipe that mixes a sun with panels carries *shares* on
the `specIrradiance` scale (a sun counts its irradiance in W/m² and a panel its watts over 4π d²): the *share* of a
panel that gives `r` times what the sun does is 4 d² r times the sun's (hence the windows carry 5 to 14 against the sun's 1; the
calculation is in the comment in `light-setups.ts`). The figures of the seven recipes are a proposal (◆ pending Fable: the
table is under “What did not fit the plan”, 1). Looking at the thumbnails (`SPHERES`, 256 × 256, 96 samples) the morning leans warm, midday is
neutral, the afternoon is amber, *Overcast* and *White room* are soft and bright, the lamps leave the room dark and the blue
hour splits warm on the left and blue on the right. **Thumbnails**: the seven were rendered with the native engine
(`node tools/setup-thumbs.mjs --keys INT_WINDOW_MORNING,…`: 21 s of rendering in total) and are in
`public/thumbs/setups/` (`thumb_int_*.png` and `setup_int_*.png`) and in `manifest.json`, which goes to 95 entries (the test that
rebuilds each scene with the code and compares its hash checks it); `tests/set-heroes.ts` sets `SPHERES` as the style's object.

*Two fixes in `core/sets.ts`, each with its test.* A recipe is a set without decoration, and that uncovered three things that
a set with decoration did not make noticeable: (1) `applySet` switched on the floor and contact shadow with any set, also
with one that brings nothing to rest on (against the *Interior* that carries no shadow of its own); now only with decoration
(`hasDecoration`: backdrop, floor, puddle or cards, all 16 sets have it). (2) A recipe chosen after a set with a backdrop
left **the set's backdrop** in the frame (the thumbnail showed it: the sweep's light backdrop behind the spheres); now the
backdrop goes back to the product type's, as when choosing any other setup. (3) Leaving a recipe for another setup
restored the product type's backdrop even though the recipe never touched it, overwriting the person's backdrop (the white of
*Catalogue*); now only whoever left a backdrop restores it (`presetLook(…, background)`). Mutations: all three
are reintroduced and `tests/interior-setups.test.ts` fails (the second also the thumbnails test, because the scene's hash
changes).

*Interiors Doctor.* `core/doctor-interior.ts` (logic) and `data/doctor-interior.ts` (descriptors in both languages,
`INTERIOR_DOCTOR_CHECKS`), plugged into the Doctor in a few lines: `runDoctor` adds `runInteriorDoctor(state)`, the `default`
of `fixDoctor` calls `fixInterior`, `doctorCheck(key)` knows both lists and the Doctor window looks up the
descriptor with `doctorCheck`. **They only run with the *Interior* type**: in a product scene they are not in the results
(and `DOCTOR_CHECKS`, the Doctor's list, is not touched). Seven stable keys: `interiorScale`, `interiorOpening`,
`interiorGlass`, `interiorLens`, `interiorEye`, `interiorClip`, `interiorNormals`. All with a fix, which is a
normal store action (one undo entry):

| Check | Detection | Fix | Test | Mutations |
| --- | --- | --- | --- | --- |
| Scale and units | the scene's largest size (the box of the parts that are not decoration) outside 100 mm–30 m | rescales by the importer's factor (metres, micrometres) if it falls in the range; if not, by the smallest power of ten that achieves it; if none, up to the limit; the importer's factor is used up | “scale and units” (5 tests: the limits, ×10, ×100, ×1000, ÷1000, the most absurd, the importer and the product-type size) | 6 |
| Opening for sun and sky | the active camera inside the scene's box (more than 1.5 m on each side), the sky or a lit sun lights it and no visible part carries a glass material, with `transmission` ≥ 0.5 or `opacity` ≤ 0.5 | sets the *White studio room* setup (panels and lamps instead of sun and sky) | “an opening for the sun and sky” (5) | 9 |
| Window glass | a visible, flat part (thickness ≤ 12 % of its longest side, with two large sides and the longest ≥ 300 mm, measured in its own box by its matrix scale: a rotated or stretched part of a cube is equally flat) with a `GLASS` material with `SOLID` walls | sets `walls` to `THIN` (the same `material/setParam` as the interface); if the material is shared by a part that is not a pane, a `material/detach` gives the panes a copy and only it is made thin | “window glass” (5) | 8 |
| Lens | a perspective camera with less than 18 mm | 24 mm and no lens preset, on all that fail it | “a lens wider than 18 mm” (3) | 7 |
| Eye height | a perspective camera, not locked, less than 0.3 m or more than 2.2 m above the floor (z = 0) | 1.5 m: changes the elevation looking at the same point from the same side at the same distance; if it does not reach that reasonable angle (80°), it backs off and drags the focus along | “eye height” (5) | 8 |
| Near clipping | a perspective camera inside the scene's box whose `clipStart` reaches the nearest face of that box (the wall) | `clipStart` to half that distance (minimum 0.01 mm) | “near clipping against the wall” (4) | 6 |
| Normals | a closed surface (`solidOrientation`, new in `core/solid.ts`) that faces outwards with the camera inside its box, or inwards with the camera outside (a solid inside out, a room with the walls to the outside; a mirrored part is looked at as it ends up in the world); and, with the camera in the room, a flat wall (over 1 m and as thin as 2 %) whose faces do not face the camera; with a budget of 500,000 triangles per pass, in tree order | `scene/flipNormals` of those parts | “inverted normals” (7, one of them the triangle budget) + 3 in `solid.ts` | 11 |

There are 57 Doctor mutations (2 of them for the scene type: that it runs or fixes in a product scene; each
check's detection switched off, each fix emptied, each threshold and each condition, the rest) and 1 for `solidOrientation`; every one is caught by some test (two survived the first round, the glass's
rotation and the lens preset, and their test was fixed). The Doctor's own scale check
(`scale`) does not compare an *Interior* scene with the product-type size (a 5 m living room against the 200 mm of
*Standard* gives twenty-five times): it keeps asking about the declared size.

*Tests.* New: `tests/scene-type.test.ts` (32: each type's table, the five round trips with a new
project and with all the slots touched by hand, what the person touched, the HDRI, the locked camera, each camera with
its own, the same type with no change, a single undo, the project saved and opened, an earlier one, an unknown type, the damaged
memory, the command and its strings), `tests/interior-setups.test.ts` (14: the style, the worlds, the recipes as sets
without decoration, the sky's sun where the light says, normalisation with the 16 types, choosing and leaving a recipe),
`tests/doctor-interior.test.ts` (41) and 3 in `tests/solid.test.ts`. Updated with their new numbers, without touching what does not
change: `data.test.ts` (95 setups and 10 styles, 7 `SKY` worlds, 7 suns), `rig.test.ts` (78 setups normalised with the
16 types), `sets.test.ts` (the 72 from before without L6 fields; 95 scenes in the manifest) and `palette.test.ts` (95
setups). Scene-type mutations: 5 (not restoring, restoring everything, not saving the memory, not normalising the type,
writing a locked camera), all detected. In the browser: `tools/scene-type-check.mjs` (Playwright, *Fast*: the
control, that the inspector has the same controls with each type, *Interior* in one undo entry with its seven
recipes and their thumbnails loaded, the contact shadow off and AgX, the seven Doctor rows, a recipe, *Catalogue*,
back to *Product*); capture `docs/ui/scene-type-interior.png`.

**What did not fit the plan** (rule 12; what is marked ◆ is a Fable judgement call: noted, not decided).

1. ◆ **The figures of the seven recipes** are a proposal, **pending Fable**: sun height, azimuth and temperature,
   weight of the window and of the bounce, sky intensity and exposure offset. They follow the orders of magnitude of
   interior photography and are normalised like the rest, but they are photographic decisions and have not been taken. The
   comment in `light-setups.ts` says so. The proposal, recipe by recipe (azimuths relative to the camera; sizes in
   part sizes, at the stated distance; *share* on the `specIrradiance` scale, see above):

   | Recipe | Label | World | Environment intensity | Exposure (EV) | Lights: type az/el/temperature, size in part sizes at its distance, *share* |
   | --- | --- | --- | --- | --- | --- |
   | `INT_WINDOW_MORNING` | Morning window | `SKY` | 0.12 | +0.2 | sun −65°/20°/4300 K ×1; panel −70°/30°/7200 K 5×4 at 2.6 ×12.2; panel 70°/12°/5200 K 4×4 at 3.5 ×5.9 |
   | `INT_WINDOW_NOON` | Midday window | `SKY` | 0.15 | +0.2 | sun −55°/62°/5600 K ×1; panel −75°/40°/6800 K 5×4 at 2.6 ×8.1; panel 70°/12°/5600 K 4×4 at 3.5 ×4.9 |
   | `INT_WINDOW_AFTERNOON` | Afternoon window | `SKY` | 0.11 | 0 | sun 70°/14°/3200 K ×1; panel 75°/24°/5600 K 5×4 at 2.6 ×10.8; panel −70°/10°/4600 K 4×4 at 3.5 ×7.4 |
   | `INT_OVERCAST` | Overcast | `STUDIO` | 0.8 | +0.3 | panel −75°/38°/7000 K 7×5 at 3 ×0.5; panel 0°/82°/6800 K 6×6 at 2.8 ×0.25; panel 75°/14°/6800 K 5×5 at 3.6 ×0.25 |
   | `INT_NIGHT_LAMPS` | Night lamps | `STUDIO` | 0.04 | −0.7 | disc −110°/28°/2600 K 0.7 at 2.2 ×0.45; disc 125°/48°/2400 K 0.5 at 2.8 ×0.25; square 0°/80°/2900 K 1.4 at 2.8 ×0.2; panel 60°/12°/8500 K 4×4 at 3.5 ×0.1 |
   | `INT_BLUE_HOUR` | Blue hour | `SKY` | 0.45 | −0.5 | sun 115°/3°/2300 K ×0.15; disc −100°/28°/2700 K 0.7 at 2.2 ×20; disc 135°/45°/2500 K 0.5 at 2.8 ×12; panel 75°/25°/10500 K 5×4 at 2.6 ×14; panel −35°/12°/7500 K 4×4 at 3.5 ×7 |
   | `INT_WHITE_ROOM` | White studio room | `STUDIO` | 1 | +0.5 | panel 0°/85°/5600 K 6×5 at 2.6 ×0.3; panel −80°/28°/5600 K 6×5 at 2.8 ×0.3; panel 80°/22°/5600 K 5×5 at 3.2 ×0.2; panel 0°/15°/5600 K 4×4 at 3.5 ×0.2 |

   The azimuths are relative to the camera (`LightSpec.az`). The orders of magnitude: the sun 2 to 4 times the sky at midday and
   1.5 to 2 in the evening (the environment intensity comes from the sky giving the studio dome's irradiance, about 2 per unit
   of intensity in the normaliser's units, and the sun `sin(height)` times its energy), tungsten lamps at 2400–2900 K, a clear sky through
   glass at 6500–10,500 K.
2. ◆ **The interiors Doctor's thresholds**, a proposal **pending Fable** (`INTERIORS.md` §3.6 names the
   checks, not the figures); they are constants exported from `core/doctor-interior.ts`:

   | Constant | Value | What for |
   | --- | --- | --- |
   | `INTERIOR_MIN_MM`, `INTERIOR_MAX_MM` | 100 mm and 30 m | the size of a scene that is a piece of furniture or a room (a vase and a loft) |
   | `WIDE_LENS_MM` | 18 mm | a lens that stretches the edges (the figure is that of §3.4) |
   | `INTERIOR_LENS_MM` | 24 mm | what the fix sets: the widest of the interior lenses of §3.4 |
   | `EYE_MIN_MM`, `EYE_MAX_MM` | 0.3 m and 2.2 m | plausible eye height above the floor (z = 0) |
   | `EYE_STANDING_MM` | 1.5 m | what the fix sets: a person standing (§3.4) |
   | room, pane, wall | 1.5 m per side; thickness ≤ 12 % and ≥ 300 mm; ≤ 2 % and ≥ 1 m | which box is a room, which part is a window pane, which flat part is a wall |
   | clipping | half the distance to the wall (≥ 0.01 mm) | what the fix sets |
   | `INTERIOR_NORMALS_TRIANGLES` | 500,000 | triangle budget of the normals check per pass |

3. ◆ **Values in the §3.1 table that are a number where the document gives a range or a word**: *Bounces* “16–24” is
   16 (the lower limit; the *Final* could ask for 24); *soft contact shadow* is an opacity of 0.35 in the viewport (the engine's contact
   shadow has no intensity: it is the shadow catcher, and its softness comes from the size of the lights); *white
   dome* is the studio dome with a pure white colour background. The scene type **does not change the light setup**: it chooses
   the environment, and the *Light* section opens on the *Interior* recipes, but which of the seven is the starting one is a
   photographer's decision that has not been made.
4. **Rows of §3.1 that are not applied because they name something that does not exist yet or that is not part of the project.** *Environment*: the catalogue
   cyclorama (K2). *Exposure*: the automatic one with its EV knob (K3; the exposure stays at the product type's
   and the recipe's offset). *Camera*: the 1.5 m eye height and straight verticals (K3), and “elevation or three-quarter” (a
   view, not a value: the existing one stays). *Transform*: “long shoulder” and *Low contrast* — the tone mapping has no
   shoulder parameter and *Contrast* is stored but the engine does not apply it yet (`image.postSoon`), so only AgX is set
   (and, incidentally, `INTERIORS.md` §3.5 asks for a curve per recipe: `LightSetup` has no field for it). *Displayed units*:
   it is an application preference (*Settings ▸ General*), not a project one, and moving it with the type would break “every mutation
   goes through the store and is undoable” and the round trip; the Doctor does speak in mm and metres. “**Interior HDRI**”: there are no
   environment recipes of their own yet (`STUDIO-TOOLS.md` §2); the HDRI the person has loaded is respected.
5. **The table says “Product (today): Standard / AgX” and the new project starts at *Filmic*.** Product writes nothing, so
   there is no conflict; the table row is not what the project brings.
6. **The sky haze per recipe** (turbidity is `environment.skyTurbidity`, not the setup's) **is not there**: `LightSetup`
   has no field for it and adding it requires a rule for what to return when leaving the recipe. The day recipes use whatever haze
   there is (3 by default); *Overcast* is the studio dome with a diffuse window, not a covered sky (there is no cloud
   model). ◆
7. **Without K2's `ROOM` node the Doctor uses what there is.** “Closed room” is the camera inside the box of the parts;
   “opening” is a glass or transparent material; “wall” is a face of that box. K2 replaces the first two
   with the room's openings; the checks and fixes remain. **The opening fix is a stand-in**:
   the lights of the *White room* recipe are around the product at distances in part sizes, so in a really closed
   imported room they end up outside its walls; the good fix (*add a window*) belongs to K2.
8. **Normals: only closed surfaces and flat walls with the camera inside.** An open mesh that is not a wall (more
   than 1 m, 2 % thick) is not examined, nor are parts beyond a budget of 500,000 triangles per pass, in tree order
   (the first time a mesh is examined its vertices are welded and a whole furnished room would stall the first
   scene change; triangles are counted and not what is in the cache, so the same scene always gives the same
   answer), nor is the “one face” case detected (a wall with no thickness where light leaks in at the corners); a known edge case: a closed
   room seen **from outside** with the faces pointing inward (a cutaway) gives a warning.
9. **The interior checks are not in `DOCTOR_CHECKS`** (the 17 the Doctor already had) but in their own,
   `INTERIOR_DOCTOR_CHECKS`, so as not to move that list (another phase, D1, adds its engine checks) nor the order of
   the results of a product scene; `doctorCheck(key)` knows both.
10. **Switching to *Interior* does not move the camera**: it sets 28 mm and the part looks smaller until K3 brings the eye height
    and the interiors framing. *Create studio* writes the product type's quality and samples again (as
    always) and does not reapply the scene type's values.
11. Mixing a sun with panels in a recipe (which `specIrradiance` measures in different units) forces *shares* of 5 to 20
    on the windows and on the blue hour's lamps; those made only of panels add up to 1 like the others. It is the
    normaliser's usual scale, not a new one: it is explained in the comment.

## K2 · Room, portals and exterior view — **Opus**

**What.** A parametric `ROOM` node from `INTERIORS.md` §3.2 (width, depth,
height; openings with position, size and sill; material per surface;
skirting; *hide the wall on the camera side*; cyclorama variant with the
infinity sweep profile of the primitives), editable in the inspector
and in the viewport (handles on the openings), saved in the project and exported to the RSB as meshes
plus a `PORT` section per opening; **automatic portals** also
for imported rooms (heuristic: glass or transparent quadrilaterals
in the envelope), with no jargon in the interface; a thin, non-refractive
*Window glass* material; **exterior view** as an image
on a plane behind each window with optional parallax (M2's RSB image
section). A procedural example room (*Load example room*) with a sofa and a lamp.

**Depends on.** U3, I3, M2 (for the view image).

**Acceptance.** Geometry tests (cut-out openings with the expected number of
triangles, portals with the exact area of each opening, wall
hidden only in camera); the heuristic marks the glass of an imported-room fixture
and does not mark a drinking glass; capture of the example room
in the preview.

## K3 · Interiors camera — **Opus** — done

**What.** `INTERIORS.md` §3.4: shift with automatic calculation
(*straight verticals*, can be switched off), eye height with presets, interior
lenses, **per-object camera visibility** (in the preview and in the
RSB), orthographic for elevations and plan, equirectangular 2:1
**panoramic** camera and *fisheye* (in the preview, by six faces; in the
engine, by strips), **automatic exposure** with an EV knob and presets
and the exterior multiplier on the camera ray, WASD walking with
fixed height. Exposure and curve as passes of the `image` state.

**Depends on.** U1, E3.

**Acceptance.** *Shift* test: with the camera tilted 10° the verticals
of a cube stay parallel in the projection (±0.1 px at 1080p); the
preview panorama matches the engine's in six test
directions; the plan does not show the ceiling and the room
stays lit by it (comparison of means); captures.

**Done.**

*Engine.* Two new projections in `rt_core::scene` (`Projection`, `Camera::panorama_dir`): the **equirectangular**
(longitude and latitude over the image, 360° × 180° at 2:1) and the **equidistant fisheye** (`θ` proportional to the distance
from the centre, black beyond a half turn), pinhole and from the camera's base; the passes' depth is the
distance, and the pixel footprints of particles, textures and caustics take the sphere's cone. `CAMR` gains 16 bytes at the
end (`u32 projection; f32 fov_x_deg fov_y_deg exterior`) that **are only written if any is not the default**: earlier
files keep their bytes and no hash moved. **Visible to camera** per instance: `INST.flags` bit 2
(`INSTANCE_NO_CAMERA`, value 4, next to bit 1 `INSTANCE_NO_SECTION`); only the `RayClass::Camera` queries (primary
rays and their straight continuations, passes, section caps) skip it, in the BVH, in brute force and in the
caps. The **exterior multiplier** (`CAMR.exterior`) multiplies the environment a camera ray sees on escaping
(also through thin walls and cut-outs) and the shadow catcher's background. `rt_features` and `/api/info` raise bit 4 (value
16, `FEATURE_CAMERAS`). Three parity scenes over the box room of `example::k3_room` (`rt
--write-k3-plan-example`, `--write-k3-panorama-example`, `--write-k3-fisheye-example`, and their `tests/fixtures/k3-*.rsb`):
`PINNED_K3_PLAN_4SPP` = `0x6efb1e66`, `PINNED_K3_PANORAMA_4SPP` = `0x96de8d73`, `PINNED_K3_FISHEYE_4SPP` = `0x9b85a1b6`,
equal in scalar, SSE2 and AVX2, with 1, 4 and 16 threads, in scalar and `simd128` WASI, in the real `rt.wasm` and (the
panorama) through the launcher API; a K3 parity block in `engine.yml`, image alone and with `--passes`.

*Page.* `CameraState.projection` (`PERSPECTIVE · ORTHOGRAPHIC · EQUIRECTANGULAR · FISHEYE`) in the *Projection* list of the
*Camera* section, `fisheyeFovDeg` (60°–360° on the diagonal of the frame) and the *Elevation* and *Plan* views (orthographic).
**Straight verticals** (`straightVerticals`, `core/interior-camera.ts`): the camera is written levelled at the same
position and the same azimuth, with the shift `−f · tan(tilt)` added to that of the lens in the O1 `LENS` that already
existed (as O4 asked: a tool that moves the shift, without reordering the lens); the preview applies the same
correction in the projection (`render/camera-projection.ts`, `P · Rx`), so picking, outline and gizmo follow it. **Eye height** (`camera/eyeHeight`, presets *Standing* 1.5 m and *Seated* 1.1 m) and **interior lenses**
(`camera/interiorLens`, 24 · 28 · 35 mm), one undo entry each, nothing with the camera locked. **Visible to
camera** on *Part* (`SceneNode.cameraHidden`, inherited, `scene/setCameraHidden`): bit 2 of `INST` for the engine; in
Fast, a material that writes neither colour nor depth and still casts shadow, out of picking, of the box, of the
tints and of the id pass. **Panoramas in Fast** (`render/panorama-pass.ts`): the scene on the six faces of a cube
(half float, linear) and the canvas from the cube with `PANORAMA_GLSL`, the same map as the engine
(`core/panorama.ts`), over the whole canvas with the output frame inside, like the Full viewport's image; picking
follows the map. **Exposure as a pass** of the `image` state (`core/image-passes.ts`): `exposureMode` *By hand ·
Automatic*; the automatic one measures in the page the accumulation sums (`f32` luminance, the engine's `log2`, 10 % darkest
and 5 % brightest left out, mean to 18 % grey, ±16 EV, hundredths), and `exposureEv` becomes the *Brightness (EV)*
compensation; the viewport redoes it when the samples double, and the final render measures its sums before the
denoise, in the pool and in the launcher. Presets *Bright day · EV 7* and *Evening lamps · EV 5* (manual exposure,
`log2(683/1.2) − EV₁₀₀`) and the *Exterior (camera ray)* slider (`environment.exterior`, also in the background of
Fast). The *Interior* type switches on straight verticals and automatic exposure through K1's slot mechanism
(`image.exposureMode`, `camera.verticals:<id>`): switching type back leaves the project as it was. Project, library and
studio save and normalise the new fields; an earlier project opens the same.

*Acceptance, in numbers.* **Verticals**: with the camera tilted 10° (28 mm, 1920 × 1080), the vertical edges of a
600 mm cube are **0 px** from parallel in the page's projection and in Fast's, and **0.0001 px** with the
engine's rays (`rt-core`, reading the file the page writes, `tests/fixtures/k3-verticals.rsb`); without
straight verticals, 7.5 px (page) and 6.4 px (engine). Fast and engine match point by point to < 0.01 px; the target
stays at the centre (< 10⁻⁶ px). **Panorama**: in a closed room of six walls of six colours, the six
directions ±X ±Y ±Z of the equirectangular (and five of the 360° fisheye, and black outside the image circle) give
their wall's colour in the real `rt.wasm` and in Chromium, and Fast's picking takes that wall. **Plan**: in the
test room, the mean of the floor seen from above with the ceiling hidden to camera is **0.010220**; the same
room seen from below the ceiling, **0.010220** (+0.0000 %); without a ceiling, 0.002109 (20.6 %), and the ceiling does not appear
(0.000000 of what the camera sees of it). In the browser (`tools/k3-check.mjs`), the plan with the ceiling hidden changes the
Fast image and the Full viewport shows it lit (viewport mean 85 out of 255; the test's threshold is 12) with the automatic exposure measured (+2.6 EV).

*Tests.* `scene::camera_tests` and `render::k3_tests` in rt-core (maps, CAMR round trip and invalid ones, verticals,
the three pinned images, plan means, passes, ray classes with caps, exact exterior at half,
the room without K3 fields the same as before), `rt-cli/tests/example.rs` (1, 4 and 16 threads, writing the examples),
`rt-app/tests/parity.rs`; `tests/interior-camera.test.ts` (24: the verticals criterion in page and Fast, the
limit, eye height, lenses, views, maps, `CAMR` and `INST` byte for byte with `rt`, inheritance, exterior, project,
`readsCameras`, *Interior* round trip, the real `rt.wasm` with the three pinned and the six directions),
`tests/image-passes.test.ts` (11: the meter), `tests/panorama-browser.test.ts` (4, Chromium: six and five directions,
the image circle, a wall hidden to camera is neither drawn nor picked) and a pool test in
`tests/pathtracer.test.ts`. **Mutations**: 28, all detected. In the engine (8): the BVH not skipping what is hidden to camera, what is hidden to all rays (shadows too), brute force not skipping it, the section cap of a hidden part seen by the camera, the sign of the equirectangular longitude, the fisheye without blindness beyond a half turn, the exterior unapplied and the `CAMR` fields always written. In the page (20): the sign of the longitude in the map and in the GLSL, the fisheye circle in the GLSL, the sign of the shift, the camera not being levelled, Fast's projection without rotating, the `INST` bit unwritten and written for an engine that does not read it, the exterior unwritten, the `CAMR` fields always written, the inheritance of *Visible to camera*, Fast drawing and picking a hidden part, the meter's two clippings, the sum instead of the mean of the samples, the logarithm of the mean, the progressive meter measuring every frame, the pool not giving the reading and the preset against the wrong zero. Three survived the first pass (the fisheye circle in the GLSL, what is hidden also to shadows and the hidden cap) and the tests were strengthened until they were detected: a canvas corner outside the image circle, a shadow segment that ends between ceiling and floor, and two rays at the height of the ceiling cap, from the removed side and from inside the slab.

*Captures.* `docs/ui/k3-verticals.png` (the room in Full with straight verticals and the *Camera* section),
`k3-plan.png` (the plan in Full with the ceiling hidden and the automatic exposure in the status bar) and
`k3-panorama.png` (the 2:1 panorama in Full), with their Fast versions in `-fast`; entries in `GALERIA.md`
under *Unreleased*.

**What did not fit the plan** (rule 12; what is marked ◆ is a **Fable** judgement call and is left proposed, undecided):
(1) **There is no WASD walking** with fixed height: N3 (*Camera walk*) covers it, with the specification deferred in `TODO.md` §3 (*Walks on foot*).
(2) **There is no `ROOM` node** (it is K2): the tests and the browser check use a box room and
per-part camera visibility, which works for any geometry; the hidden front wall and the automatic near
clipping of `INTERIORS.md` §3.4 are left for K2. (3) **The engine does not render the panorama in strips**: it renders it
whole, by tiles like any image; the strips for large sizes belong to K6. (4) **The shift goes in `LENS`,
not in `CAMR`**: straight verticals move the shift of the O1 lens (what O4 asked for); the engine knows nothing about them.
(5) **The curve is the view transform**: *Low contrast*, the long shoulder and ISO and shutter under *Advanced* are still not
done; the curve pass is `RNDR.tonemap`. (6) **Interior does not move the camera to eye height**: doing it as one more
slot broke the round trip of K1's interiors Doctor checks (which measure the framing); the
presets are in *Camera*. (7) In Fast nothing is drawn over a panorama (outline, gizmo, glyphs), and the
gradient or image background is seen as a colour. (8) The plan is orthographic at 89.9° (the camera's elevation cap),
not at 90°. (9) No check for “tilted camera without straight verticals” was added to the Doctor. (10) The automatic
exposure is measured by the page: a scene exported and rendered with `rt` outside the application carries only the
compensation in `RNDR.exposure_ev`. (11) **For F1** (exact picking by the engine's primary ray): a pixel →
ray API has to serve orthographic (origin on the image plane, fixed direction), both panoramas (the
`Camera::panorama_dir` map from the position, no lens, and “nothing” outside the fisheye circle) and straight
verticals (the camera that is rendered, `renderedCamera`, not the orbit's); `focusDistanceFor` already gives the
focus distance with straight verticals and is not used until F1. ◆ (12) **Eye-height presets** 1.5 and 1.1 m and
**interior lenses** 24 · 28 · 35 mm (28 without a lens preset: `INT_28` is only a focal length), taken from §3.4. ◆ (13)
**Automatic exposure measurement**: trimmed logarithmic mean (10 % below, 5 % above) to 18 % grey, ±16 EV.
◆ (14) **EV presets** 7 and 5 from §3.4 and their calibration `EV₁₀₀ = log2(683/1.2) − exposure` (that the engine's EV 0 be
EV₁₀₀ ≈ 9.15). ◆ (15) **Exterior multiplier** 1 by default (no effect) and a range of 0.05–1. ◆ (16) **Interior
switches on straight verticals** by default (as §3.1 says), and up to **30°** of corrected tilt
(`VERTICALS_MAX_TILT_DEG`). ◆ (17) The 180° fisheye **on the diagonal** of the frame (it fills the frame; wider,
the circle is seen).

## K4 · Engine for interiors, minimum set — **Opus**

**What.** `INTERIORS.md` §4, points 1 to 7, in `rt-core`: origin offset
by ULP (Wächter and Binder) and a two-level BVH with instances;
sun as a disc with cone sampling and excluded from the environment; physical
sky (done in E5c: the Hošek–Wilkie shape with own coefficients,
without their tables) and HDRI with a 2D CDF; rectangles and discs by solid angle;
thin glass; **portals** (`PORT` section) with a summed-area table per
portal and MIS; **light tree** (Conty and Kulla, compact node as in
pbrt-v4; all lights if ≤ 8); direct and indirect *clamping* in
exposure units, regularisation, roulette; **adaptive sampling**
by two half buffers in blocks; AOVs (albedo, normal, depth,
variance, count) and variance-guided demodulated à-trous **denoise**
at the end and in previews; *Interior* scene-type settings passed
through RSB.

**Depends on.** E5, K2.

**Acceptance.** Test scenes of our own (a closed room with one
window, a room with twelve lamps, a glass table) with numerical tests:
with portals the squared error at 64 samples drops by at least half
compared with without them; the light tree gives the same mean as
sampling all of them (±1 %) with less variance; the image without *clamping* and
with it differ by less than 2 % in mean; the denoise at 64 samples ends up
closer to the 4096 reference than the 256 one without denoise (PSNR);
determinism and native/wasm parity intact; contact sheet of the
seven interior recipes with mean, blown-out and blocked pixels.

## K5 · Path guiding — **Opus**, with **Fable**'s approval

**What.** The SD tree of Müller, Gross and Novák 2017 implemented **from the
paper** (the reference is GPL and is not looked at): a binary spatial tree
with directional quadtrees in the leaves, iterations that double the
samples, structure frozen per iteration and summed across workers without
shared memory, MIS with explicit light sampling and portals;
configurable memory budget; on by default in *Interior*.
Automatic portals by visibility map as a by-product.

**Depends on.** K4.

**Acceptance.** In the one-window room, the same quality (PSNR against
reference) with at least 1.5× fewer samples than K4; no loss on the
product bottle (±2 % of time); tree memory below the
budget in the three test scenes.

## K6 · Furniture deliverables — **Sonnet**

**What.** `INTERIORS.md` §3.7 on top of N2: silhouette on white with alpha and with
dimensions (the bounding box's dimensions drawn on a layer), a sheet of
fabric and finish **variants** of a scene (list of materials ×
parts → batch), panorama by strips in the browser, elevations and plan
as batch jobs, name template with variant.

**Depends on.** K3, N2.

**Acceptance.** A batch of 3 variants × 2 views produces 6 images with
correct names; the 4096 × 2048 panorama is assembled without seams
(continuity test at the strip edges); capture of a variants
sheet.

## K7 · Sample assets and interiors in CI — **Sonnet**

**What.** A procedural example room with a sofa and a lamp (K2) and, as
assets downloadable on demand and never in the base package, a
selection from Poly Haven (furniture models, CC0) and ambientCG
(textures, CC0) with **licence and origin recorded per file** in an
`assets.json`; **no third-party HDRI** (owner's decision,
`STUDIO-TOOLS.md` §2: the environments are recipes of our own); nothing from Quaternius or 3D Warehouse;
attribution for Khronos if used. Interiors contact sheet in CI
with `rt`.

**Depends on.** K2, K4.

**Acceptance.** A test that fails if an asset has no recorded licence or
if its licence is not on the allowed list; the contact sheet comes out
in CI.

## K8 · Light groups after the render — **Opus**

**What.** *LightMix*-style: each light (and the sun, the sky and the
emitters) belongs to a **group**; the engine emits one pass per group
(linear sum) and the interface offers, after the render or in the viewport, a
mixer with intensity and colour per group whose output is a linear
combination; saving the mix as a scene setting (it applies the
factors to the real lights) and as variants (*day*, *evening*,
*night*) for the queue.

**Depends on.** K4.

**Acceptance.** The sum of the per-group passes equals the full render
(±1e-4); a saved and re-rendered mix matches the mix
(±2 %); capture of the mixer.

## P1 · Releases and public demo — **Haiku** — done (v0.1.0)

**What.** Request: the first release with **Windows
portable**, **Linux portable** and **Windows installer**. While
GitHub Actions has no minutes, the release is built **locally** with
`npm run release` (from P2: `packaging/release.mjs`), which leaves in
`out/release/` the three packages, their `sha256` in `SHA256SUMS.txt` and the
notes. Version in `package.json` and in the engine workspace, tag
`vX.Y.Z` created on publishing, `docs/CHANGELOG.md` from the start,
release notes in English (what is there, what is not, requirements: Windows 10/11
x64 with Edge, Linux x86_64 with a Chromium browser, SmartScreen warning
because it is unsigned). The `release.yml` workflow that will do the same
in CI on pushing a tag is left written, along with the GitHub Pages one for the demo,
for when there are minutes again.

**Depends on.** P2.

**Acceptance.** `npm run release` reproduces the three packages from a clean
tree; `SHA256SUMS.txt` adds up; the tag points at the release
commit; the CHANGELOG lists the phases that are done.

**Done.** `docs/CHANGELOG.md` with v0.1.0 and its limitations,
notes in English in `docs/release-notes/v0.1.0.md` (the path that
`release.yml` reads), and `npm run release` from the commit tagged `v0.1.0`:
Windows portable, Linux portable and Windows installer, checked
with `packaging/smoke.mjs` (native and under Wine, pinned hash) and
`sha256sum -c`. The release is published by hand from the tag while
there are no Actions minutes. The engine keeps its own version (0.3.0);
the application's is that of `package.json`.

**How it is published now (since 0.1.4).** With Actions minutes, the
release is published by `release.yml` launched by hand (*workflow_dispatch*)
**on `main`**, with `tag` = `vX.Y.Z` (the `package.json` version) and
`commit` empty or a commit already on `main`: it builds, creates the
tag and the release at that commit and uploads the four files. No session
needs to push tags. Launched from another branch, GitHub refused to create
the release with *Resource not accessible by integration* (twice, with
0.1.4); from `main` it worked first time. The workflow now stops at the
first step if a publication is not launched on the default branch. Without
`tag`, any branch will do to build the test artefact.

**With a plugin (since 0.1.6).** The `.rpk` package that
`src/data/plugins.json` names (its `url` points at the assets of that version's release)
is uploaded by hand to the release once published, with the REST API
(`gh release upload <tag> <file>`), and checked against the registry's `sha256` and
`bytes`; the activation key is not uploaded anywhere
(`docs/release-notes/plugins.md`).

**With the version's captures.** The notes of each release
(`docs/release-notes/vX.Y.Z.md`) carry that version's new captures:
those that `docs/GALERIA.md` keeps under *Unreleased*, which the version PR
moves under the new version. A release body is read outside the
repository and does not resolve relative paths, so each image goes with an absolute URL
and that same version's tag (created on publishing):
`https://github.com/Grohle-developer/Repackshot/raw/vX.Y.Z/docs/ui/<file>.png`.

## P2 · Desktop: own launcher, portables and installer — **Opus** — done

**Decision taken (Fable), replaces the Tauri one.** The desktop is
an **own launcher in Rust with `std` only** (`engine/crates/rt-app`,
binary `repackshot`), described in `ARCHITECTURE.md` §5.5: local
interface server with a *token* and `Host` checking, an Edge or Chromium
application window with its own profile, **native engine** with
all threads, data folder (or `data/` in portable mode), model store
with its own SHA-256 and machine detection. Tauri is ruled out
because it needs crates.io (blocked here) and compiling on Windows (no
Actions minutes), and the own launcher keeps the project free of
dependencies in Rust.

**What.**
- `rt-app`: minimal HTTP/1.1 server (statics with MIME types, `Range`,
  API with *token*), opening the window and ending the application on
  closing it, single instance, log in the data folder; API:
  `/api/info`, `/api/render` (RSB → passes accumulated in `f32`, with
  cancellation), `/api/models/*` (list, write in chunks with
  offset, resume, verify, delete, serve with `Range`),
  `/api/hardware`, `/api/open-folder`; command line `--hardware
  <file>` (INI read by the installer), `--serve-only` (no window,
  for tests) and `--version`. Own SHA-256 with the NIST vectors.
  The recommendation rule evaluated over `src/data/ai-models.json` with
  the same case file as the TypeScript test.
- In `src/`: `render/native.ts` (`RenderEngine` against `/api/render`,
  chosen when `/api/info` responds; Full mode and Render use
  it) and `io/native.ts` (the launcher's model store and data folder)
  behind the same interfaces as the web; no further changes.
- `packaging/`: `release.mjs` (builds the interface and the two wasm,
  compiles `repackshot` for `x86_64-pc-windows-gnu` with mingw-w64 and for
  static `x86_64-unknown-linux-musl`, and assembles the packages), the
  **Windows portable** (`Repackshot-<v>-windows-x64-portable.zip`:
  `repackshot.exe`, `app/`, `portable.txt`, licences), the **Linux
  portable** (`Repackshot-<v>-linux-x64-portable.tar.gz`, the same, plus an example
  `.desktop`; AppImage if the tool can be obtained with a
  permissive licence) and the **Windows installer** with NSIS
  (`Repackshot-<v>-windows-x64-setup.exe`): per user, without administrator
  permissions, in `%LOCALAPPDATA%\Programs\Repackshot`, with licence,
  folder, Start shortcuts and an optional desktop one, a registered uninstaller,
  the **AI models** step (`AI-POST.md` §2.2: reads the INI from
  `repackshot --hardware`, ticks the recommended one, one, several or none,
  licence visible, and leaves the choice for the application to
  download) and *Open Repackshot* at the end. Achromatic application
  icon, generated from `docs/media/logo.svg`.

**Depends on.** U5, U6 for the models step and the store; it can
start earlier with the launcher and the native engine.

**Acceptance.** `rt-app` tests (`cargo test`): SHA-256 with the NIST
vectors; the server rejects a foreign `Host` and an API call without a *token*;
`Range` returns the requested bytes; a model written in
out-of-order chunks and resumed gives the expected `sha256`; the recommendation
rule with the case file. Parity: the same scene through
`/api/render` and through wasm gives the same hash. The `.exe` starts under
Wine with `--serve-only` and serves the interface (smoke check; the real
window is tested on Windows). The Linux portable
starts, opens the window with the local Chromium and renders natively
(capture `docs/ui/desktop-linux.png`). The installer is built with
`makensis` without warnings.

**Done.** `engine/crates/rt-app` (binary `repackshot`, `std` only, no
`unsafe`): HTTP/1.1 server on `127.0.0.1` with `Host` checking
(421), a 128-bit *token* per launch in the URL fragment (401) and a foreign
`Origin` rejected (403); Edge or Chromium window with its own profile,
single instance and ending on close or when the heartbeat is missing; **native
engine** through `/api/render` that repeats `rt`'s loop and gives the same
hash as `rt` and the wasm pool (`0x223515c3` in the sample, with 1 and 4
threads, also the `.exe` under Wine), with *Finish by* samples, time
or whichever comes first, cancellation and `f32` sums for 16-bit PNG and EXR;
model store **by `sha256`** with its own SHA-256, writing in
out-of-order chunks and resumption; machine detection and the recommendation rule
in Rust and TypeScript over the same file of 36 cases,
with memory read as *measured / 0.94*. `packaging/release.mjs`
(`npm run release`): Windows portable (zip), Linux portable (tar.gz,
static musl binary) and NSIS installer (per user, English and Spanish,
AI models step, uninstaller), with an achromatic icon of its own,
third-party notices (three, rhino3dm, occt-import-js with their licences and
sources) and `SHA256SUMS.txt`; three builds give the same bytes.
846 web tests and 241 engine tests. Capture `docs/ui/desktop-linux.png`.

What did not fit the plan: AppImage only on demand (its runtime links
libfuse LGPL); 64-bit installer only; the installer's rows have no room for summary, quality
or speed; on Windows `--version` is only seen
redirected (graphical subsystem); untested on a real Windows (Edge via
App Paths, VRAM with real drivers, the installer clicked through by hand,
SmartScreen: the `.exe` is not signed).

## Q1 · Section view — **Sonnet** — done

**What.** A cutting plane by click + axis, by two points, or animated as one more
motion (`MOVE_KINDS` gains `SECTION`); implemented in the
integrator (discard the part beyond the plane, cap with the material's
colour) and in the preview with three's `clippingPlanes`.

**Depends on.** E3, N1.

**Acceptance.** A region comparison like that of
`tests/textures-full-browser.test.ts`: the sample bottle cut in
half, with the real `rt.wasm` through the page's writer against
*Fast* (three.js in Chromium), and the agreement stated in numbers. Tests that
fail without the feature: plane from click + axis and from two points, round trip through
RSB, the engine discards the removed side and caps closed meshes
(a box cut in half: area and colour of the cap),
interpolation of `SECTION`, undo and redo, determinism with 1, 4 and
16 threads, wasm parity (`rt --write-q1-example` with its hash pinned and a
block in `.github/workflows/engine.yml`).

**Done.** (1) *Data*: `state.section` (`core/section.ts`), a single plane
per project: `{ enabled, point, normal, cap }` with the normal towards the side
that **is removed**; actions `section/set|patch|enable|flip|clear` through
the store (undoable, a drag is one entry, nothing for what does not
change), saved in the project (an earlier file opens without a plane).
It is set in three ways: **click on the part + axis** (X, Y, Z or the surface
normal; the side facing the viewer is removed), **two
points** (the plane contains both and the view direction; what lies
to the left of the line from the first to the second is removed) and
**numbers** (point and normal); plus *Flip side*, *Cap the cut* and the
switch, which without a plane makes one through the centre of the product, facing the
camera. (2) *Animation*: `SECTION` is one more motion of
`MOVE_KINDS`, on the scene (`{ kind: 'SCENE' }`, like `HDRI`): its
amount is the plane's displacement along its normal in
part sizes (negative cuts deeper, positive uncovers; default −0.5), with
the clip's curve, adding with other clips and splitting without a
jump; `Pose.sectionOffsetMm` carries it to both engines. (3) *Engine*
(`geometry/section.rs`, `geometry/solid.rs`): the plane lives **inside
`Geometry`**, so camera, reflections, refractions, shadows, photons,
picking and passes see the same thing without touching the SIMD kernels or
the integrator: a ray is clipped to the interval in which it is on the side that
remains (a half-space cuts a ray in an interval, and `t` is the same in
the world and in mesh space) and is an ordinary ray with another
`t_min` and `t_max`. **The cap** goes where the cut passes inside a closed
solid: the first surface the ray meets after the plane
is seen **from behind** (`Solid::inside_before`), and then the crossing was
inside; the hit is flat, on the plane, with the plane's normal facing the ray
and the solid's material (no texture, pattern, program or
bevel: the plain colour). The solid analysis (welding vertices by
position and then with tolerance, each shared edge by exactly
two triangles in opposite directions, signed volume for the orientation)
is done once per mesh (`SolidCache`) and `core/solid.ts` repeats it in TypeScript
so that *Fast* caps the same parts. (4) *Format*:
new `SECT` section (20 B: `u32 flags` with bit 0 = cap, `f32
normal[3]`, `f32 distance`), at most one, after `FXAM` and before
`IMGS`, `BMAP` and `ENVR`; without a plane it is not written (the bytes from before);
new `rt_features` bit (4) and in `/api/info`. (5) *Preview*
(`render/section-preview.ts`): a `THREE.Plane` shared by all the
model's materials (far away when there is no section: the shaders
do not change when switching it on), cap with a copy of each closed part's
geometry that paints only the back faces with the part's material and
the plane's normal (the equivalent of the stencil), double-sided materials while cutting, and picking, the selection box (which looks at the vertices when
the part's box is cut), the outline and the gizmo (which hides
for a selection that the cut has taken away entirely) ignore what is removed. (6) *Interface*: **Section** section of the
Scene inspector (decision and why below), click modes with a
notice in the viewport and `Esc`, palette actions *Section
view on or off* and *Section view: flip the side*, motion sentences, all in
`es` and `en`. (7) *The studio is not cut*: the pieces of a set
(*Backdrop*, *Floor*, cards) are not the model; the writer marks them
with bit 1 of `INST.flags` (`INSTANCE_NO_SECTION`, only while a
plane cuts) and the engine also looks for them on the removed side, skipping
the surfaces of the cut model (at most 48; a scene without
marked instances does not take that path); *Fast* gives them a copy of the
material without the plane.

*Measured.* **Region** (`tests/section-full-browser.test.ts`, bottle
cut along the axis with a plane through the camera, 300 × 220, 32
samples; the engine is the real `rt.wasm` through `projectScene` + `writeRsb`):
the per-pixel agreement on what both images take as settled is
**1.000** (8,903 pixels), the union of the body, cap, collar and core sections overlaps at **0.963** (IoU) and, by class, body 0.962,
cap 0.948, collar 0.839 (a ring a few millimetres wide) and the core disc
hidden inside the body 0.977 (only the first surface
after the plane can tell). Without caps the cut stops being flat in
both images (highlight irregularity 0.054 versus 0.027 in *Fast*,
0.100 versus 0.034 in the engine) and by tone they agree at 1.000. The
controls fail as they should: the engine's plane moved 15 mm leaves the
core at 20 pixels against *Fast*'s 1,954 (agreement 0.74) and
flipped, 19 (agreement 0.46). The **studio**: a set floor under the
bottle has 31,335 pixels in *Fast* and 31,317 in the engine
(IoU 0.996) and fills the bottom strip of the frame (1.00 and 1.00); the same
floor as an ordinary part is cut in both (20,512 and 20,809,
IoU 0.983; bottom strip 0.00 and 0.00); the gizmo and the box selection
do not reach the label that the cut took away entirely and do reach the body and
the cap. Captures: `docs/ui/section-fast.png` and `docs/ui/section-full.png`
(`tools/section-check.mjs`). **Pinned**:
`PINNED_Q1_SECTION_4SPP = 0x7a4182ea` (the E5 scene cut at `x = 0`,
with its lacquered floor as studio, equal in scalar, SSE2 and AVX2, with 1, 4 and
16 threads, in scalar and `simd128` wasm); no earlier hash moved
(the scene without a plane is E5's bit for bit). **Cost**: at 640 × 480 and 32
samples with 4 threads, the cut scene gives 4.99 Mrays/s against 4.74 for
E5's without a plane (with half removed it drops from 7.1 s to 6.4 s); the
studio path is not noticeable.

**What did not fit the plan** (rule 12; what is marked ◆ is a
Fable judgement call: noted, not decided).

1. ◆ **Where the control lives**: in the **Scene inspector**, between
   *Ambient* and *Camera*, collapsed and with the switch in the header, and
   not in the viewport bar. It is a stored and animated scene object,
   like the environment and the ambient; the bar's tools
   are for navigation and transformation. The click modes do notify
   in the viewport. The guided tour does not list *Ambient* or *Section*, so it does not
   gain a step.
2. ◆ **Cap of a glass.** In the engine a cut glass solid has
   a cap that **refracts** (physically it is a cut glass, seen
   through); *Fast* draws it as transparent glass. An **opaque**
   cap in the glass's colour would be an option for the
   photographer; it was not done. The interface says so in a note.
3. ◆ **The studio is not cut.** The brief said "one side of the model"; it was
   understood that way (a cut floor leaves the product floating over the
   background). Any other use of the plane on the studio (cutting the
   background to see behind it) cannot be requested today: there is no per-part
   switch.
4. **Open meshes, inside-out solids and parts with per-face material.**
   An open mesh has no inside: the cut shows its interior (and a note says so, with the
   parts). A closed solid with faces inside out is capped by the engine (it decides by the sign of the
   volume) and not by *Fast* (it treats it as open). A part with a material per face is not capped
   in either (the engine sees each group as a sheet) and neither is a thin-walled glass.
5. **Known engine limits**: a finite-`t_max` ray that enters
   the remaining side inside a solid and ends before leaving does not see
   the cap (the next surface lies beyond its end), and an emissive
   mesh sampled as a light still illuminates from its removed part.
6. **Fast passes for the AI** (depth, normals,
   identifiers) do not know the plane; the colour does. The post-processing AI
   would receive the whole part with the cut colour.
7. **The open geometry in *Fast* and in the engine** is not painted the same: the base's
   cup, which is an open mesh, is seen from inside in both
   but with 509 yellow pixels against 339 (IoU 0.24 in that class: the
   interior of a thin cup depends on each one's shading); what is
   compared for open meshes is that the cut stops being flat.
8. `FEATURE_SECTION` (bit 4) is published by the module and the launcher, but the
   interface does not use it: both engines that are published cut. An old
   `rt.wasm` in `public/engine/` would show the whole part in
   *Full* without warning (fixed with `npm run engine:build`).

---

## H1 · Accessibility and i18n — **Haiku**

**What.** Focus order of all panels, `aria-label` on every icon,
contrast ≥ 7:1 verified by test over the tokens, `prefers-reduced-motion`,
review of the `es` (accents, tone) and `en` strings, documentation
kept in sync with what was done (README, SPEC) after each milestone.

**Depends on.** U1; repeated at the close of each version.

**Pass v0.1.16** (2026-10-17). **Done:**

- **Contrast** (`tests/ui-contrast.test.ts`): each text (`ink-0` to `ink-3`, and `inv-ink`) measured on its surfaces in the four themes, with the WCAG ratio of the tokens. `ink-0`, `ink-1` and the inverted one pass 7:1 on all of them. **36 pairs** fall below and are listed as pending: `ink-2` (light 3.8–5.3:1; dark 5.1–6.9:1) and `ink-3` (light 2.0–2.8:1; dark 2.7–3.6:1) on all surfaces, and `ink-3` in high contrast (light 5.1–6.6:1; dark 5.5–6.3:1). No token changes; the test fails on a new pair below 7:1 and on a pending pair that now reaches it.
- **Names** (`tests/a11y-browser.test.ts`): in Chromium, 20 interface states (panels, drawers, windows, Settings, guide, tour, Doctor, material editor, menus and palette) in Spanish and in English. Each button without text has its name from `strings.ts`. None was missing; the test removes the name of *Undo* and fails with 16 buttons.
- **Focus.** The palette let focus out with Tab and Escape did not work outside the field: now Tab stays in it, Escape closes it from anywhere and focus returns to the control that opened it. Menus and confirmations cycle with Tab and return focus to the button that opened them; a window opened from the main menu (*Settings*) returns it to the menu button. No positive `tabindex`; the Tab order does not go backwards in any column (`tests/a11y-static.test.ts`).
- **Motion.** *Reduce motion* did not switch off the smooth scrolling of the render window's plugin strip: now it does (`theme.css`). With the preference emulated, no element transitions or animates. The interface has no JavaScript animation: the guide and the tour only follow positions.
- **Strings.** All 2,997 strings reviewed in both languages: no missing accents, no missing opening marks, no detectable typos, and the Spanish uses the informal “tú” throughout. One change: *Center* becomes *Centre*. Two guards in `tests/strings.test.ts`.
- **Documentation.** SPEC §6 (accessibility), README (one line and the two new tests), CHANGELOG (*Unreleased*).

**What did not fit the plan:**

- **Fable decision: auxiliary greys.** For 7:1 on all their surfaces, `ink-2` and `ink-3` would have to be `#434343` or darker in light and `#b5b5b5` or lighter in dark; that equalises the three greys and the hierarchy then depends on weight and size. Alternative: 7:1 only on `bg-0`, `bg-1` and the *hover*, with `ink-2` of `#4e4e4e` or darker in light and `#afafaf` or lighter in dark, and no text on `bg-2`, `bg-3`, *soft* or *overlay*. In high contrast, `ink-3` of `#434343` or darker (light) and `#c1c1c1` or lighter (dark). When a token changes, its pairs are removed from `PENDING` in the test.
- English strings with a space before the % (`10 %`) follow the SI convention that Spanish also uses: they are left as is.
- The README is in English as a whole; the new paragraph too, so as not to mix languages in the file.
- **Not audited in the browser, pending for a later pass.** Button names are checked in the render window (*image* and *animation*), the material editor and Settings (*General* and *Engine*); focus is not checked in any of these. Left out entirely: the import sheet; the results viewer (needs a finished render); the Settings subsections other than *General* and *Engine*; and the *Free up* confirmations in storage (they need installed models). The render window and the material editor are deliberately not modal: they do not trap focus, and their Escape has not been verified.
- **For N1** (animation, not touched): `src/ui/panels/anim-props.ts:327` gives `role="listitem"` to the preset buttons, so they stop being announced as buttons; `src/ui/panels/animation.ts:115` puts `role="tree"` on the focusable row container (the rows are `treeitem`). Small fix: a button with its own role inside the list.

---

## Pending Fable decisions (do not anticipate)

- **I2**: decided: `occt-import-js` (LGPL-2.1) as the only LGPL
  exception, isolated under the conditions of `ARCHITECTURE.md` §1. Pending:
  the **up axis** of STEP and IGES (today Z); SolidWorks and Creo export
  with Y up, so reading `originating_system` from the STEP
  header to choose it is being considered, and the **catalogue look** for
  CAD colours (today SIMPLE, roughness 0.5).
- **Desktop**: decided: an own launcher with `std` only instead of
  Tauri (`ARCHITECTURE.md` §5.5); NSIS installer; the installer chooses
  the models and the application downloads them (`AI-POST.md` §2.2).
- **AI post-processing** (`AI-POST.md`): the default model
  (provisional: Z-Image-Turbo) and the guard tolerances, after the
  X1 comparison.
- **Interiors** (`INTERIORS.md`): ~~exact licence of the Hošek–Wilkie
  tables~~ (resolved in E5c: they are not used; own sky with the
  published shape and coefficients fitted to our simulator); whether cross-origin
  isolation is enabled to share the scene between workers; the number of
  lights from which the tree comes in.
- **Native formats** (`.bip`, `.ksp`, `.sldprt`, `.ma`, `.ztl`, `.f3d`):
  decided that they are **not** read (proprietary, no public specification;
  reading them would require analysing their binaries, which the clean-room rules
  forbid). Input is whatever each program exports (`SPEC.md` §5).
  Revisited only if a public specification or an
  MIT/Apache library that reads them appears.
- **E4**: decided by the owner: two explicit modes, *Fast*
  (three.js) and *Full* (always the tracer, at lower resolution during
  gestures), with a switch in the header; *Render* always with the
  tracer. Only the reduced-resolution threshold remains to be decided.
- **E8**: how `rt` renders an animation (port `evaluate` to Rust or
  one RSB per frame).
- **L3**: the numbers of the recipes on the own engine.
- **E7**: wear thresholds on the contact sheet.
- **UI**: whether, after U1, the contextual inspector needs a separate
  *Library* tab (the decision in `UI.md` is that it does not; to be reviewed with
  real use).

---

## After testing v0.1.0: desktop fixes and everything marked *coming soon*

Request (2026-10-13), after testing the installer on Windows:
Full mode stops after a while of making changes; the queue does not
pause or resume; a material cannot be dragged onto a part; choosing a
folder fails (*this folder cannot be opened because it contains system
files*); and the window behaves like a web page (it offers to translate, the
logo does not appear, right click and text selection bring up browser
menus). **Decision: on desktop nothing appears that is not our
interface**, the interface stays in HTML and everything else (file dialogs,
file writing, engine) is done by the Rust launcher. In addition: **everything
the interface marks *coming soon* is integrated**.

| Phase | Executor | What |
| --- | --- | --- |
| **P3a** (done) | Opus | Full mode that does not stop (reproduce with a long session of changes against the launcher and fix the cause), *Pause* / *Resume* / *Start queue* that work on web and desktop |
| **P3b** | Opus | Desktop with no trace of a browser: native folder and file dialogs from the launcher (PowerShell on Windows, `zenity`/`kdialog` on Linux, no `unsafe`), writing of renders, projects and models by the launcher, context menu, selection, translation, zoom, reload, printing, search and browser navigation disabled, own icon and title; WebView2 study for Windows |
| **P3c** | Opus | **Own window on Windows** (the lead's decision after the capture of Edge's “Do you want to exit the application?” notice: *all notices and windows with our interface, no web notices; a closed, professional product*): frameless Win32 window with **WebView2** (the Edge engine that ships with Windows 10/11) and a title bar drawn by us (title, minimise, maximise, close, drag), context menus, shortcuts, status bar, zoom, autofill, translation, downloads and browser script dialogs **disabled through the API**, and closing (button, `Alt F4`, taskbar) **intercepted** to ask with our own window if there are unsaved changes; Edge `--app` only as an automatic fallback if the runtime is missing. On Linux, Chromium in application mode continues with P3b's hardening until P3d (own window with WebKitGTK, which requires a glibc binary and not the static musl one) |
| **P3e** | Opus | **Desktop: everything over the launcher** (the lead's decision after “the text overlaps” and “it says it cannot see the GPU because it is a browser”: *on desktop the page is only interface*): a platform seam with a web and a launcher implementation; settings, library, history, thumbnails, hardware and space used in the data folder by the launcher; stable port per data folder; not a single row that talks about the browser; Settings rows that do not overlap |
| **U7** (done) | Sonnet | Dragging a material (a catalogue or *Mine* thumbnail) onto a part in the viewport or the tree, with highlighting (`UI.md` §2.3), and **M1** (whole CAD face and *Separate by CAD faces*), plus box selection with `Ctrl/⌘` + drag. See U7 and M1 above |
| **E5** | Opus | Already described: glass and transmission, varnish, real emitters, sky, HDRI, background image |
| **E5b** | Opus | Floor reflection, image effects (halo, sharpening, saturation, contrast, vignette), render region, passes (alpha, depth, normals, part id), caustics and own denoise |
| **E5c** (done) | Opus | Own clean-room physical sky: the Hošek–Wilkie shape with coefficients fitted to our atmosphere simulator (`rt-sky`), *Physical · Classic* in *Environment*. See E5c above |
| **E6**, **E7** | Sonnet, Opus | Already described: wood, fabric, bevel, subsurface (anisotropy arrived with E5); wear visible in engine and viewport |
| **L4**, **L5** | Opus, Sonnet | Already described: own lights (area, point, spot, sun) with all their operations; IES |
| **M2** | Opus | Already described: image textures and labels |
| **N1**, **N2** | Opus, Sonnet | Encoded video (WebCodecs and own MP4 and WebM muxers) and whatever remains of passes and batches |
| **U8** | Sonnet | The small things in the interface: automatic backup and recovery, access letters in menus, changing shortcuts, *Check for updates*, the Doctor checks that are missing and their *Fix* buttons (**D1**) |
| **X1b–X4** | Fable, Opus, Sonnet | Already described: the complete AI post-processing (X3 split into X3a–X3d, `AI-POST.md` §7) |

**P3a done.** Reproduced for real with a long session of changes
against the launcher (`tools/viewport-stress.mjs`, new): in v0.1.0, after
90–300 s no request to `/api/render` was answered any more, and
`gdb` showed the launcher's HTTP threads blocked writing frames
that nobody read. **Main cause (native only)**: when replacing a view,
the page abandoned the polling of the previous one without reading or cancelling
its response; each unread response holds one of the six
HTTP/1.1 connections that Chromium (and WebView2) opens to the launcher, and with all six
held every request waits forever. That explains the three
symptoms the owner saw (the old image with the new outline on top;
*Fast → Full* in grey with “0 samples”; a render that never finishes,
with *Full · paused while rendering*) and the native half of the
queue that does not pause (*Pause* did not reach the launcher). Other causes, each
with its test: *Render* requests did not carry the cancellation
signal; a view that the launcher forgot (404) or rejected (503) was
not requested again, and at reduced resolution its “frame in flight” stayed
marked forever; two views could go out at once and arrive in reverse order;
in the pool, switching to *Fast* during a reduced frame left that same
mark set and *Full* never started again; in the launcher, a failed
write was drained again with the 120 s deadline, jobs
of pages that had gone away kept rendering, reloads filled the 8
window slots (`503 busy`, found by P3e), a render that panicked
never finished and a stuck job blocked the next one;
and `main.ts`'s animation loop stopped forever on any
exception.

Fixes: in `render/native.ts`, every response is read, cancelled or
aborted; one view at a time, numbered (`seq`); rejected or lost ones are
requested again with growing back-off and the meter says why; all
requests carry the signal; the page cancels its jobs on `pagehide`.
In the launcher: `409 stale` for a view that arrives late, writing
an unread frame is cut off after 10 s, jobs that nobody asks about
stop themselves (viewport 10 s, final 20 s), with all 8 slots
taken a window that has been silent for 3 s gives up its own, a panic ends
the job as failed and releases the port, and `GET /api/render/state` gives the
diagnosis (with `log=1`, to the log as well). A *watchdog* in both
engines (`render/watchdog.ts`) restarts the view if the launcher
stops answering, if passes do not arrive, or if they arrive and are not painted, says so
in the console and in the launcher's log, and the meter says the
reason: never “0 samples” in silence.

**The lead's decision** (with the owner's capture: the viewport was *paused
while rendering*): **the viewport stays alive while
rendering**, sharing the machine. Natively it keeps a quarter
of the threads (at least one) and the render gets the rest, or all of them
when the viewport has converged; in the pool, a quarter of the
workers. The meter says so (*Full · shared with the render · 4 of 16
threads*) and *Settings ▸ Render engine ▸ While a render runs* chooses it
(*Keep the viewport live (shared)*, the default, · *Pause the viewport
(fastest render)*). The render gives the same bits with or without the viewport (tests
in Rust, also against the pinned hash with 16 threads, and in the browser
the same file `4e3aa886…` in both engines).

**The queue**: the v0.1.0 button became *Start queue* as soon as
*Pause* was pressed, with the job still finishing, and a *Resume* pressed
then was lost. Now there is a *Paused* state: the button says *Pause*
while running, *Resume* after a pause and *Start queue* otherwise
(disabled with nothing waiting); *Pause* stops the job and releases the
engine (473 ms until the launcher has no final left; 167 ms in the
pool) and *Resume* continues with what was paused (only the *Render* job if that is
what it was; the paused job starts again).

Tests: 23 new on the web, with a simulated launcher that models the six
connections (the earlier simulated ones answered everything at once, and that is why
this escaped), and 13 new or redone in Rust (4, 16 and 32 threads); each
fix, removed one by one, makes its test fail (18 mutations in
TypeScript and 15 in Rust). The timing test for a queued final measures
the job's own clock and not how long the machine takes (10 of 10 with another
build running). 10-minute sessions of
`tools/viewport-stress.mjs` (determinism, queue and long session with bursts
of orbiting, dropping and moving a part, checking that the canvas shows the current
scene):

| Engine, 10 min | Actions | Renders | Stalls | Old image | *Watchdog* | Queue |
| --- | --- | --- | --- | --- | --- | --- |
| Native, 16 threads, 1st | 171 | 1 (cancelled by undo) | 0 | 0 of 15 | 0 | 10 of 10 |
| Native, 16 threads, 2nd | 163 | 6 (5 finished, 1 cancelled by undo) | 0 | 0 of 16 | 0 | — |
| Pool, 3 workers | 143 | 5 (3 finished, 2 cancelled by undo) | 0 | 0 of 6 | 0 | 10 of 10 |

What did not fit the plan: with the machine heavily loaded by other agents
(load of 10 to 47 on 4 cores), about 16 actions per minute and not
*dozens*; the pool's 5-minute session against v0.1.0 does not conclude
(a lost click left it in *Fast*), so the pool's own failure is
proved by its test and not by the session; an *undo* that takes away the queue's job
still cancels its render (as decided in U5); in the pool, when
a render finishes the viewport starts over to recover all the
workers (it loses that view's samples); and since on desktop the
renders are written by the launcher (P3b), the check waits for the file
in its *Downloads* folder (`XDG_DOWNLOAD_DIR`) and not for a browser
download. Not tested on a real Windows.

**P3b done.** System dialogs (folder, open, save) from the
launcher with PowerShell on Windows and `zenity`/`kdialog` on Linux, and a file
API that only touches what the person chose in a dialog during
that launch (output folders only for new files, never
overwriting; allowed extensions; *Downloads* and the last project
as the launcher's only exceptions); renders, projects, imports,
exports and models go through there and the downloads bubble does not
appear. Hardening switches and profile preferences for
Edge/Chromium in a single constant reused by P3c; the page blocks
the browser's context menu, chrome selection, translation, zoom, reload, printing,
search and navigation (`src/ui/guards.ts`), without breaking any shortcut of its own; `Ctrl W`/`Ctrl Q`
go through our question; external links go out through a single
`openExternal` (launcher on desktop) and a test forbids `alert`,
`confirm`, `prompt`, `print` and `window.open`; favicon, icons and
manifest of its own. Not tested on a real Windows: that the dialogs come up
in front of the window and that Edge's mini-menu disappears entirely (guaranteed
by P3c).

**P3c done.** Own Win32 window with WebView2 on Windows
(`engine/crates/rt-app/src/platform/`, the launcher's only place with
`unsafe`, each block with its why): hand-written COM (vtables
transcribed from the SDK's IDL, with their method count and the position of
each method used checked in the tests), Microsoft's
`WebView2Loader.dll` loader next to the executable (NuGet
`Microsoft.Web.WebView2` 1.0.4258.31, BSD-style licence that allows
redistributing it with its notice; SHA-256 of the package and the DLL pinned in
`packaging/lib/webview2.mjs`) and the system's Evergreen runtime; profile
in `webview2/` of the data folder (portable included). Everything that is not
our interface, switched off through the API: context menus, script
dialogs, browser shortcuts, status bar, zoom, pinch, swipe
to go back, autofill, passwords, SmartScreen, error page and,
in release, developer tools; navigation only to our
origin, clicked `https` links to the system browser, no new
windows, downloads cancelled without their panel (and the page never downloads
in that window: a test checks it), permissions denied except the
files the person chose and persistent storage. Closing
(button, `Alt F4`, taskbar, system menu) reaches the page
as `close-requested` and goes through the same question as `Ctrl W`
(`requestCloseWindow`, *Save · Don’t save · Cancel*), without
`beforeunload`. Own icon, title `Repackshot — <project>`, dark title
bar with the dark theme, AppUserModelID `Repackshot.App` (and the
same in the installer's shortcuts, with `repackshot
--shortcut-id`), size, position and theme remembered in `window.json`, and
P3b's file dialogs with the window as owner. If the loader or the runtime is missing, or any step fails, it is noted
in the log and Edge's `--app` window is opened; *Settings ▸ Desktop* says which
window it is and why, and `--window=webview2|browser` forces it. In the
header, the logo with a downward arrow instead of the three
lines (web and desktop). Linux unchanged.

What did not fit the plan: by the lead's decision, after comparing it with
a reference application, the window uses the **system's** title bar and not
one drawn by the page (the frameless version, with the top edge and
*Snap Layouts* over our maximise button, was made, tested under
Wine and removed). WebView2 is passed `browser.rs`'s `DISABLED_FEATURES` and
the slowdown switches (a single source),
but not the `HARDENING_SWITCHES`: they belong to the browser's own interface,
which WebView2 does not have or whose API already switches them off, and they are not documented for
WebView2. Under Wine the AppUserModelID of a shortcut cannot be read back
(its property store is a sketch), so that, and
everything about WebView2, remains to be tested on a real Windows. The random
port per launch, which makes `localStorage` get lost between launches
(in the Edge window and in the own one), is left for P3e.

**P3e done.** On desktop the page is only the interface. A `Platform`
seam (`src/io/platform.ts`), chosen once at startup, with two
implementations behind the same interface: the web (`platform-web.ts`:
localStorage, IndexedDB, OPFS, WebGPU, as until now) and the launcher's
(`platform-desktop.ts`), where every service and every byte of state belongs
to the launcher: settings in `settings.json` of the data folder, small things
remembered in `state/`, library in `library/`, results history
as files in `results/` with their index, thumbnails in `cache/thumbs/`,
models (they already were), hardware always through `/api/hardware` and space used
measured by the launcher (`/api/storage/usage`), with *Free up* going through
it. New routes `/api/store/*` and `/api/storage/usage`
(`rt-app/src/appdata.rs`) with the usual *token*, `Host` and `Origin`,
lowercase names confined to the data folder (no links or
Windows device names), atomic writes, and a document
that could not be read at startup is never overwritten. **Stable port per
data folder** (`launcher.json`, `rt-app/src/port.rs`): the window's origin
no longer changes on every launch, which is why in v0.1.x settings, library and history
were lost on closing. Migration, once per data folder (mark `state/migration.json`), of whatever remains in the
browser storage of the current origin; for those coming from v0.1.x
it is usually empty (each launch had another port) and only leaves the mark.
No row talks about the browser on desktop: the strings that
named it have their desktop version (`DESKTOP_TABLE` of
`strings.ts`) or their hidden row (`webOnly`: *Persistent storage*;
WebGPU, quota and browser memory only on the web), *Window drawn
by* says a name (*Microsoft Edge app window*, and it already reads
P3c's `window` for *Native window (WebView2 x.y)*), the GPU row
lists the launcher's cards and follows the detection even if it arrives later, the
badge *Only in the desktop application* does not appear inside it and
the browser-only model is not listed. Settings rows that do not overlap
at any width or interface size: label column with a minimum,
controls and badges that wrap, stacked rows for long values
(monospaced paths broken where needed, button below, title with
the full text) and container queries that stack everything in narrow windows. Tests: the seam chooses the launcher and then does not touch
`localStorage`, `indexedDB` or `navigator.storage` (spies), the migration
once and with an empty origin, writes in order, results with their
limits, the browser strings covered; in Rust, `tests/appdata.rs`
(security, confinement, links, limits, cut-off request, results,
cache, space, another launch) and `tests/port.rs`. Check
`tools/desktop-platform-check.mjs` against the real launcher (settings that
survive a restart in a new browser profile, the same port,
nothing in browser storage, a render in `results/`, the launcher's
GPUs, no mention of the browser in either language, *Free up*
through the launcher, and no overlap in any section at 1600, 1280 and
960 px, 90–150 %, two languages, dark, light and high contrast); captures
`settings-desktop-paths.png`, `settings-storage-desktop.png`,
`settings-ai-desktop.png`. With P3b and P3c merged, 1044 web tests and 309 for the
engine.

Merged with P3b and P3c: the output folders, the projects (with the last one
the launcher remembers) and the import and export dialogs also come
from the platform (on desktop, P3b's; never the browser's pickers
or handles), the chosen folders are remembered in
`state/desktop.folders.json` and not in `localStorage`, and *Window drawn
by* is a single function (P3c's, with its reasons) that says *Repackshot’s
own window (WebView2 x.y)* and never the name of an executable
(with no launcher window, `--serve-only`, it no longer says *The default browser*). The real-launcher check adds that *Choose folder…* and
*Save project* go through the launcher's dialogs (a test `zenity`)
without touching the browser's pickers, that the folder ends up in
the data and that *Downloads* is written by the launcher. On merging: the chosen output
folder, which P3b shows by its path, overflowed its row; the
button now says its name and the full path goes below. An intermittent failure of the parity test was also fixed
(`tests/parity.rs`: if the last
pass arrived between two queries, the returned frame was not marked
as finished).

What did not fit the plan: the *token* stays in `sessionStorage` (it is the launch's
secret, not state).
The automatic backup does not exist yet (U8): when it arrives, to the data
folder through the platform. `REPACKSHOT_TEST_GPUS` (fake cards, for
tests only) is also read by the release binary. On Windows, if the
remembered port is still in `TIME_WAIT` on reopening, another is taken once and
remembered. Found along the way (from P3a): a native viewport job from a
page that reloads stays alive until the cap of 8 (`503 busy`). Not
tested on a real Windows.

**Correction after testing v0.1.2.** On a real Windows the launcher
found no graphics card on any machine, only the CPU, and *Settings ▸ AI post-processing ▸ Hardware*, the *GPU* row and the AI engine's
Vulkan/CPU choice depend on that. Cause: `reg query <display class> /s` reaches
the `Properties` subkey, which gives “Access denied” (“ERROR: Acceso
denegado.” in Spanish), and `reg` exits with 1; `process::output` threw away the
output of any program that did not exit with 0, with the adapters
inside. The parser's test fed it the text directly, without an exit
code: it was more permissive than reality, and it has been fixed along with it.
Now `process::output_any` returns what was printed together with the code (and
`output` stays strict for the single-key queries of
`browser.rs` and `files.rs`, where exiting with 1 means “not there”), and the cards
come from four sources: **DXGI** (`rt-app/src/platform/dxgi.rs`, hand-written COM
like P3c's: `CreateDXGIFactory1`, `EnumAdapters1`, `GetDesc1`; exact 64-bit
dedicated VRAM, without the software adapter or Microsoft's, `dxgi.dll` only from `System32`), **the registry** (one query to list the subkeys and another per adapter, never `/s` or `Properties`,
read whatever their code), **CIM** (`Win32_VideoController` in the same
PowerShell run as the RAM) and **wmic** if PowerShell does not answer.
They are merged per adapter: the first one that lists only what is there now governs
(DXGI, otherwise CIM, otherwise wmic), because the registry keeps the key of a
card that has already been removed, and exact VRAM wins over the 32-bit one, which
caps at 4 GiB. Each source leaves in `logs/repackshot.log` what it found or
why it failed, `/api/hardware` gives it in `gpuSources` and `gpuDetection`, and the
interface distinguishes “The graphics cards could not be read: see the logs” from
“No graphics card found”. System programs
go by their absolute path in `System32` (`reg.exe`,
`powershell.exe`, `WMIC.exe`, also in `browser.rs`, `files.rs` and
`dialogs.rs`). Tests, each checked failing without its fix: a
program that prints and exits with 1 is read (`sh` on Linux, `cmd` under Wine),
the registry source with a fake `reg` and with real programs that
exit with 1, the parser with “Access is denied” and “Acceso denegado.”
between keys, CIM and `wmic`, the merge (the removed card, two identical
cards, “no card” versus “could not ask”), the vtables and
`DXGI_ADAPTER_DESC1` against the IDL, and the interface. Under Wine with `xvfb-run`
DXGI lists its adapter (*NVIDIA GeForce GTX 470*, 15.7 GiB, what Wine
invents), Wine's registry calls it *Wine Adapter* with no VRAM, Wine's
PowerShell does not answer and `wmic` gives the same name as DXGI: one
card remains, DXGI's. Found while running everything under Wine: a test in
`rt-app/tests/ai.rs` assumed the machine has no GPU (a request
without `"device":"cpu"` asked for the Vulkan build, which is not installed, and was
rejected for that before the image was read); it failed the same on Linux with a
GPU (`REPACKSHOT_TEST_GPUS`) and now asks for the CPU like the others. What did not fit the plan: it is still untested on a real Windows
(if it still fails, `logs/repackshot.log` says what each source answered); that
`reg /s` stops at the first error is not verified, which is why it is queried
key by key; the installer reads the same `--hardware` and now sees the cards,
but its models page does not distinguish “could not be read” from “there is none” (the
INI does not change).

Order: wave 1 **P3a**, **P3b**, **U7**, **E5** in parallel; wave 2
**E5b**, **E6**, **L4**, **N1**, **U8**; wave 3 **E7**, **M2**, **L5**,
**N2**. AI post-processing, **brought forward at the owner's request (2026-10-13)**: **X3a**, **X3b**, **X4**, **X2** and **X3c** now; **X3d** and **X1b** after (`AI-POST.md` §7.6). Each phase removes its
*coming soon* items and leaves no new one without noting it here.

## Studio tools (optics, environment, light, camera, particles)

Full plan in `docs/STUDIO-TOOLS.md`. Phases, in waves starting from
wave 2 (E5b's DoF moves to O1):

*Renumbered:* the ghost flare was **O4** in this table and becomes
**O6**; O4 is now the completed phase *Simple and traced lens: options for each
one*.

| Phase | Executor | What |
| --- | --- | --- |
| **A6** — done | Sonnet | Assets without a new engine: `lenses.json` (16 prescriptions with a paraxial test), `bokeh.json` (20 types), generated aperture masks and gobos, `camera-moves.json` |
| **O1** | Opus | Improved thin lens: polygonal and mask aperture, pupil profiles, obstruction, approximate cat's eye, anamorphic, *tilt-shift*, *split diopter*, per-channel CA; bokeh selector |
| **O2** | Opus | Traced lens: prescriptions, stable intersection, pupil limits, autofocus, breathing; the 16 lenses |
| **O3** | Opus | Three-band CA, coatings (transmission, tint, T-stop), veiling glare |
| **O6** | Opus | Ghost flare, diffraction star, bloom and halation, dust and scratches |
| **O5** — done (in O2 and O2c) | Sonnet | Lens editor: character, SVG cross-section, non-physical adjustments marked, *Save lens as…* (O2); the lens elements (O2c) |
| **W1** | Opus | Pin evaluator in the engine with importance sampling; pin editor; *Place highlight* |
| **W2** | Sonnet | Library of 39 environments (recipes, thumbnails, hash), export HDR/EXR, baked interiors |
| **L6** | Sonnet | *Reflection · Direct · Orbit* placement, smoothed normal, obstacles, automatic power |
| **L7** | Opus | Emitters with procedural profile, gobos, flags, reflectors |
| **L8** | Opus | Diffuse/specular per light, light and shadow linking, solo, flicker |
| **L9** | Sonnet | False colour by zones, light meter, baking the light setup to an environment |
| **N4** | Sonnet | Library of camera moves, handheld camera, ramps, aspect ratios |
| **N5** | Opus | Drawing and recording walk-throughs, target lock, motion blur |
| **S0** | Fable | Particle decisions: where the simulator lives, cache format, RSB sections |
| **S4a** — done | Opus | Ambient: stateless air particles (`rt-sim`, `FXAM`, spheres, discs and capsules, the *Ambient* section of *Scene*); preset values accepted; what follows, in S4b |
| **S4b** — done | Opus | Particles: the cost at the presets' densities, measured (the screen grid for camera rays, because rain went over 1.3×); a forward lobe (Henyey–Greenstein) for dust, pollen and dust cloud; drops without caustics; the lobe's share and the rain's cost, for the verdict |
| **S1**–**S10** | Opus, Sonnet | Scattering and instances; falling and resting; drops and condensation; stateless emitters; volumes; smoke; liquids; hair and grass; cloth; improvements (detail in `docs/research/particles.md` §6) |

### A6 · Assets without a new engine — **Sonnet** — done

**Done.** All the assets of the studio tools that need no
new engine, without brands or manufacturer names and generated by code from the
repository (nothing comes from AI image models):

- `src/data/lenses.json` (+ typed loader in `lenses.ts`, which keeps
  `LENS_PRESETS`): the 16 prescriptions of `docs/research/optics.md` §2.3 in
  the registry of §5 (surfaces with radius, thickness, glass `nd`/`vd`,
  semi-aperture, type, stop and *coating*; reference focal length, f-number, field,
  image circle, focus and moving gaps, iris), with the patent or the
  book in `source`. `tests/lenses.test.ts` traces a paraxial ray of its own and
  reproduces the focal length and back focus of each lens within 0.05 % of what the
  report traced and within 1 % of what the patent says (also the telephoto's
  breathing, the macro's floating element, the soft lens's gap travel, the adapter's 1/2
  magnification and the image behind the mirror of the
  catadioptric); the stop exists only once in each lens, the keys
  are unique and stable, no brand or catalogue glass appears, and every
  glass has `nd` in [1.4; 2.1] and `vd` in [15; 100]. An independent
  re-reading of the report's table found no differences from what was
  transcribed (except the symbolic gap `dB0` and the estimated `vd`s).
- `src/data/bokeh.json` (+ `bokeh.ts`): the 20 types of `optics.md` §1 with
  stable keys, names and descriptions in es/en and the parameters of the
  thin-lens mode (blades, roundness, rotation, mask, pupil profile,
  obstruction, cat's eye, anamorphic squeeze, CA, swirl, rings,
  texture), or the traced lens that provides them (`requires: "traced"`), or `requires:
  "wave"` for the diffraction ring (coming soon). A test checks that
  everything resolves to masks and lenses that exist.
- `tools/assets/` (`common.mjs`, `aperture-masks.mjs`, `gobos.mjs`) and
  `public/assets/aperture/` (45 masks of 512²: straight and curved polygons with 3 to 18
  blades, stars, heart, several holes, rings with
  obstruction 0.3 and 0.5, onion rings, dust, scratches, mesh) and
  `public/assets/gobo/` (12 patterns of 1024²: windows, blinds, leaves,
  dappled light, dots, lines, radial burst, soft breakup), each with
  recipe, seed and hash in its `index.json`. The canonical hash is that of the
  pixels (the bytes of a zlib stream may change between versions);
  `tests/assets.test.ts` regenerates everything with the generator's pure functions and
  compares. The generator uses only `+ − × ÷` and `sqrt` and functions of its own.
- `src/data/camera-moves.json` (+ `camera-moves.ts` and `src/core/camera-moves.ts`):
  14 moves (the 13 of STUDIO-TOOLS §4 with the spiral split in two) as lists
  of the animation types that already exist, in units relative to the product
  (degrees, % of the framing distance, part sizes, focal and
  focus factors), and 3 handheld camera presets. `tests/camera-moves.test.ts` expands
  each into bars, evaluates them with `evaluate` at t = 0 and t = end (finite
  and deterministic, and at t = 0 nothing has moved), and checks that the dolly zoom
  keeps focal length / distance, that the turntable makes one revolution, etc.
- **Desktop server** (`engine/crates/rt-app/src/static_files.rs`): until
  now everything under `/assets/` went out with a one-year `Cache-Control: immutable`
  because Vite names everything there by hash; the new assets carry no hash and a
  file regenerated under the same name would have looked stale forever. Now
  only what is directly in `/assets/` and is called
  `name-XXXXXXXX.ext` (the 8-character base64url pattern that Vite 8 emits) is immutable;
  everything else goes out with `no-cache` and an ETag from the SHA-256 of its bytes (files
  up to 8 MiB; it answers 304 if unchanged, and a file regenerated with the same
  size and the same time is no longer confused with the earlier one). Rust tests that
  fail if anything without a hash is served immutable (with the names this
  same build emitted and those of `aperture/` and `gobo/`). `tests/chunks.test.ts` no longer reads the
  folders of `dist/assets/` as if they were files.

**Provisional values, awaiting O1 (rule 11, Fable's visual judgement).**
The lenses' *coatings* by era (before 1935 uncoated,
up to 1969 single-layer, afterwards multi-layer), the stop's default values
(circle, f/22 at most), the starting values of the bokeh
types (swirl 0.7, strength of the pupil profiles, the catadioptric's 0.49 obstruction…), the
meaning of `profileParam` in each profile and the handheld camera's
amplitudes (subtle, medium, strong) are starting points
with the keys as the contract; O1 will judge them with renders. The bokeh thumbnails
rendered by the engine are also left for O1.

**What did not fit the plan:** the `PAN` animation type does not exist yet (SPEC
§3.7), so the quick sweep is a fast orbit with a strong curve and the turntable
is `SPIN` on the model; the name “retrofocus” was a brand and the
lens is called *inverted-telephoto wide angle*; `CAMERA_MOVES` already existed in
`animation.ts` (the set of camera-only types) and the library is
`CAMERA_MOVE_LIBRARY`; an expander was needed in `src/core/camera-moves.ts` that
the plan did not name (N4 extends it); the stop position is only given by the
source for 6 of the 16 lenses (`stopBasis`) and for 9 it is assumed to be in the middle of the
gap that the report names; the report gives neither f-number nor semi-apertures for the macro,
nor semi-apertures for almost any lens, so those fields are left empty or
derived and marked.

### S0 · Particle decisions — **Fable** — done

Request: ambient particle simulation (rain,
suspended dust and how it reflects the lights, snow, dust cloud…) as
one more option inside *Scene*, fully configurable and simulated
in 3D. It is the **stateless** class of `STUDIO-TOOLS.md` §5 and of
`docs/research/particles.md` (§2.1, §2.6, §3.2, §4, §5): it needs no
cache or baking, and enters now as **S4a**. Decisions that hold for
the whole S family:

1. **Where the simulator lives.** A new crate `engine/crates/rt-sim`,
   `std` only, no `unsafe`, no system APIs, with the engine's
   determinism contract (`f32`, `fmath`, counter hash
   `mix64(seed ^ id)`): the same seed and the same instant give the
   same particles natively and in wasm (test with a position hash).
   It is used by `rt-core` (the render), `rt-wasm` (the Fast viewer, through a
   `particles_eval` export) and native `rt`. **There is no TypeScript
   port**: without wasm, the viewer draws only the emitter's box and the
   meter says so (rule 10).
2. **Time model.** Each particle is a pure function of (seed, id,
   time): birth = its own phase within its life (steady
   state, the scene is “full” from the first instant), closed-form
   motion (terminal velocity `v = v₀ + (v_t − v₀)(1 − e^{−t/τ})`
   integrated, no steps; constant wind; *curl noise* drift as a divergence-free
   **displacement** `d(x₀, t)`, not as an integrated velocity:
   so any `t` costs the same). No collisions except the
   floor (they die below `z = 0` and are reborn by phase). *Freeze at* the
   `time` instant of the effect; the N1 animation will move it later.
3. **What travels to the engine.** The **parameters**, not the particles: RSB
   section `FXAM` (≤ 256 B per effect, several allowed, ignored by an
   old engine), and the engine evaluates the particles on loading the scene and
   builds its BVH. An RSB with 1 M particles would be 24 MB per
   worker in the browser; this way it is 256 B.
4. **Primitives** in `rt-core`: sphere (stable intersection), oriented
   disc (flake) and capsule (swept sphere: the rain streak without
   motion blur), with a flat BVH of its own over the set and a
   single node in the TLAS. Catalogue materials by key (`MATL` already
   existing), with per-particle tint variation from its seed.
   **Minimum screen size**: a particle thinner than 0.35 px is
   widened to that for camera rays and its radiance is scaled by
   (real area / widened area), so the energy does not change (test).
5. **What does not enter S4a.** Haze, light shafts, ground fog and the
   dust cloud as a volume (participating medium with delta tracking): S5,
   after E9b (scattering media), and in S4a's list they appear
   as *coming soon*. Motion blur (N5). Collisions with
   parts, cache and baking (S2). Reading `.vdb`: no.
6. **Cost.** With 200 k particles, ≤ 1.3× the time per sample of the
   same scene without them; default cap 100 k in the browser and 1 M
   natively, in *Settings ▸ Render engine*.

### S4a · Ambient: stateless air particles — **Opus**, verdict **Fable** — done

**What.** In the *Scene* tab, a new **Ambient** section (in the
list of sections, after *Light* and before *Camera*) with a list of
effects (0..n; *Add* opens a gallery of cards) and, per effect:

- **Type / preset** (stable keys in `src/data/effects.ts`, names
  es/en): `DUST_MOTES` Dust motes, `POLLEN` Pollen, `RAIN` Rain,
  `SNOW` Snow, `DUST_CLOUD` Dust cloud, `ASH` Ash, `BUBBLES` Rising
  bubbles, `CONFETTI` Falling confetti; and, dimmed with *coming soon*
  (S5): `HAZE` Haze, `LIGHT_SHAFTS` Light shafts, `GROUND_FOG` Ground
  fog. Starting values for each preset: set by the lead with the contact sheet (rule
  11); the agent proposes some in the JSON and notes them as a proposal.
- **Eight photographer controls** (always visible): Amount, Size,
  Energy (speed), Chaos (spread + turbulence), Wind (strength and
  direction in degrees), Gravity, Variation, Seed (with shuffle).
- **Advanced** (collapsed): region (box around the scene with a margin
  in mm; or own box with centre and size; height band), density
  (particles/m³) or count, shape (point/sphere, flake/disc, streak/
  capsule), size mm ± variation, fall (terminal) speed ±
  variation, spin, wind (vector), turbulence (strength, scale, speed),
  cloud envelope (centre, radius, softness, for the dust cloud),
  material (catalogue key; by default the preset's: dust = light
  diffuse with a little specular; rain = glass; snow = white diffuse
  with a short `absorption`; pollen = yellowish diffuse; confetti = list of
  tints), tint variation, instant (*Freeze at*, s), visible to
  camera / in reflections / casts shadow (like lights), and the particle
  cap.
- Everything in `ProjectState` (new field `effects: AmbientEffect[]`), through the
  store and undoable, saved with the project (U2), the Doctor warns if
  there are more particles than the cap.
- **Fast viewer**: `THREE.Points` (dust, snow) or `InstancedMesh`
  (rain capsules) with the positions returned by `particles_eval`
  from the wasm, up to 50 k; selecting the effect shows its region's
  box. **Full and render**: the engine, through `FXAM`.
- **Light on the particles.** Nothing special: they are geometry with their
  material, so backlit dust glows through its specular and
  NEE lights them like everything else; a light behind the product makes the
  “dust in the beam”. The sheet has to show it.

**Engine.** `rt-sim` (S0 §1–2), `FXAM` in `rt-core::scene::rsb` (fields:
`kind u32`, `seed u32`, `time f32`, `count u32`, region (centre, half
size, band), size and variation, shape, terminal velocity and
variation, wind xyz, turbulence (strength, scale, speed), cloud
(centre, radius, softness), `material_id`, `tint_var`, `flags` (camera,
reflections, shadow), streak (length as a multiplier of the speed);
any left over, zero), the three primitives with stable intersection in
`geometry/` and a flat BVH (S0 §4), `Film` and passes unchanged
(a particle's `partId` = the effect's id; `materialId` its own).
`rt-wasm` exports `particles_eval(params, max) → f32[]` (xyz, radius,
orientation) for the viewer. No `sin`/`exp` per particle in the hot
loop: the terminal-velocity exponential is tabulated by `fmath`
once per effect.

**Depends on.** E3, E5 (glass for rain), E12 (light selection per
point: with 100 k particles, NEE from them must not choose blindly).

**Acceptance.** (1) Determinism: `hash(positions)` equal natively and in wasm
and with 1 and N threads, and the same pixel by pixel (test); with the effect at
count 0 the hashes of all reference scenes do not change.
(2) Steady state: the density measured in the region at `t = 0`,
`t = 3 s` and `t = 60 s` differs by < 3 % (test). (3) Rain dies on the
floor and is reborn above (test: no particle below `z = 0`). (4)
Energy of the widening to 0.35 px: a fine-dust image at 4 spp and at
256 spp has the same mean ± 2 % (test). (5) Cost: ≤ 1.3× with 200 k
particles in the sample scene (measured, in the ROADMAP paragraph).
(6) *Sheet* `out/ambient-sheet.html`: the sample bottle with the eight
presets at 512 px / 128 spp, each under two lights (side key and a backlight
behind the product, to see the dust glow in the beam),
plus rain with three streak lengths and the dust cloud with two
softnesses; by eye. (7) Captures `docs/ui/ambient-section.png` and
`docs/ui/ambient-gallery.png`; browser check
`tools/ambient-check.mjs` (add, change preset, undo, save and
open, cap). `SPEC.md` §3.1 (the effect as data), `UI.md`,
`ARCHITECTURE.md` (crate `rt-sim`, `FXAM`), `STUDIO-TOOLS.md` §5
(note: S0 decided, S4a done), CHANGELOG. Strings es/en, achromatic
chrome.

**Done.** **Engine.** `engine/crates/rt-sim` (`std` only,
`#![forbid(unsafe_code)]`): `AmbientParams` reads and writes the `FXAM`
payload (192 B; the first 128 are the fields of this section, in their
order), `evaluate(&params, max)` and `Evaluator::particle(id)`. Each
particle comes from `mix64((seed << 32) ^ id)` and a per-life hash: own
phase, velocity in closed form `v(a) = v_d + (v₀ − v_d)·e^{−a/τ}`
integrated (`τ` from the fall and gravity, `v₀` the drift plus *Energy* in
a random direction), *curl noise* drift as a displacement (three
gradient noises with quintic *fade* and analytic gradient; Bridson et
al. 2007), exponential and sine tabulated with `fmath` once per effect.
Those that fall (or rise) are born on the top (or bottom) face and live
as long as it takes to cross the box: so they die on the floor and are reborn above
without a density jump; those that float live forever and the box wraps. The
cloud, by rejection with a *smoothstep* edge. Tests: pinned position hash
(`PINNED_PARTICLES_HASH`), density at 0, 3 and 60 s within 3 %
(dust and rain, 200,000 particles, and the box equally full at the top as at the bottom), nothing below `z = 0`, rain is reborn above, any prefix
and any number of threads give the same particles, the cloud remains a
cloud. `rt-core`: `geometry/particles.rs` (sphere with the
stable intersection of *Ray Tracing Gems* ch. 7, oriented disc, capsule; flat BVH
per effect with one-particle leaves and the id as tie-breaker; `RayClass`
camera / secondary / shadow / parts for the three flags), `FXAM` in
`scene/rsb.rs` (reader and writer, several, validated; an earlier engine
skips them), each particle's material with its seed's tint,
passes with `partId` = the effect's index after the instances and `materialId`
its own, an update with the same parameters keeps the
particles and their BVH. Minimum size of 0.35 px for camera rays
with energy conserved (below). `rt --write-ambient-example` writes
the parity scene (`example::ambient_scene`: widened dust, glass
rain, snow with palette and no shadow); pinned image
`PINNED_AMBIENT_4SPP = 415d7d74` (it was `c4406309` before E12's per-point
light selection, which moves it; the particles did not) and particles
`e38b8480`, equal in scalar, SSE2, AVX2 and in scalar and
`simd128` wasm, with 1 and N threads; without effects all reference scenes
give the same hashes.
`rt-wasm`: `rt_particles_eval(params, len, max, out) → u32` (8 `f32` per
particle: centre, radius, axis, tint seed; `u32::MAX` if the payload
is not valid) and `engine/tools/wasm-parity.mjs --particles --expect-particles`.
**Interface.** `src/data/effects.ts` (the eight presets and the three from S5
*coming soon*, stable keys, es/en), `src/core/effects.ts`
(`ProjectState.effects`, undoable `effect/add|remove|set|preset`, the region,
the count and the cap, the fields and bytes of `FXAM`, the effects
of a file), the *Ambient* section (`insp-ambient.ts`), the Doctor's
`particles` check with its fix, *Settings ▸ Render engine ▸
Particles per effect*, the RSB writer (one `FXAM` per lit effect,
with its material after those of the parts) and the *Fast* viewer
(`THREE.Points` for spheres and discs, `InstancedMesh` of cylinders for
the streaks, up to 50,000 per effect, from `rt_particles_eval`; without
`rt.wasm`, the region's box and the meter says so). Tests:
`tests/effects.test.ts`, `tests/effects-rsb.test.ts` (the payload byte for
byte against that of `rt --write-ambient-example`, `tests/fixtures/ambient.rsb`;
with the real `rt.wasm`, the particles and the native engine's image),
`tools/ambient-check.mjs` (add from the gallery, change preset, a
control, undo and redo, save and open, the cap and the Doctor, the box
without `rt.wasm`, achromatic chrome in both themes; captures
`docs/ui/ambient-section.png` and `docs/ui/ambient-gallery.png`) and the sheet
`tools/ambient-sheet.mjs` → `out/ambient-sheet.html` (the eight presets
with a side key and a backlight, rain with 4, 12 and
30 ms streaks and the dust cloud with softness 0.2 and 0.9; 512 × 288, the 16:9 of the
camera, 128 spp, `--threads 2`; the sample camera with focal length × 1.5
so that the particles read, a dark flat studio and *Key only* as the only
light; scenes from `tests/ambient-rsb-dump.test.ts`).

**Criteria.** (1), (2), (3) by test, above. (4) The widening's energy: the
fine-dust image gives a mean of 1.0820557 at 4 spp
widened, 1.0820074 at 256 spp widened and 1.0809593 at 256 spp with the
exact particles (+0.10 %, within ± 2 %). (6) and (7), done; the presets'
values, accepted in the verdict. (5) **Not met**: see
*cost*.

**Cost** (criterion 5; native `rt`, AVX2, 2 threads, with the machine
shared with other agents: load 30–38 on 4 cores, so what counts are the ratios of
alternating rounds). The sample bottle
(9,248 triangles) with the side key, 512 × 288, 16 spp, three rounds:
without effect 5.46 / 5.68 / 7.31 s; with 200,000 dust motes (camera and
reflections, no shadow: the preset) 18.27 / 17.78 / 22.30 s, **3.2×** (3.35,
3.13, 3.05 per round); the same camera-only 15.04 / 15.91 / 16.52 s,
2.6×; with count 0, 5.16 / 7.36 / 6.96 s (the same as without effect). By
quantity, in two more rounds: 20,000 → 1.8×, 50,000 → 2.0×, 200,000 →
3.0×. Evaluating the 200,000 and building their BVH: 1.6–2.0 s, once per
scene load (not per sample). In the scene of `rt --example` (322
triangles, 512 × 384, 4 spp) it was 2.0–2.6 s versus 10.0–10.5 s. Two
variants tried that lower nothing: accepting with probability equal to the
coverage (more rays that pass through and are cast again: 3.4–3.5×) and
accepting or not within the traversal itself, without recasting the ray (3.1–3.4×;
camera-only 2.5–2.6×). The cost is **traversing the particles' BVH**:
20,000 particles already cost as much as the bottle's 9,248 triangles, and
the sample scene is too light for 200,000 exact primitives
to fit within 30 %. What could meet it, to decide: for camera
rays (all leave from the same point with a pinhole camera),
a screen grid with the particles projected, so that each
ray only tests those of its pixel instead of traversing the BVH; or lower
default caps.

**What did not fit the plan.**
- **The widening does not scale the radiance.** Multiplying the shading by
  `real area / widened area`, as S0 §4 says, darkens what is
  behind the widened disc (it covers it entirely): measured, −5.6 % in the
  test image. With coverage `c` the ray is shaded with probability
  `q = max(c, ½)` and weight `c/q`, or continues on with weight `(1 − c)/(1 − q)`:
  the expectation is that of the exact particle (test of criterion 4).
- **The particles are not a TLAS node** (S0 §4): each set is
  traversed after the instance BVH, with the ray already bounded by the
  nearest part (and a shadow ray looks at the parts first). It was the
  fastest of what was measured (one-particle leaves and sets afterwards: from 8.8× to
  4.4×), and a set's BVH does not depend on the camera: it is filled with
  the widening margin.
- **`FXAM` has 64 B more** than the fields of this section: `gravity`,
  `energy`, `spin` and a palette of 4 tints (the *Gravity* and
  *Energy* controls, the flakes' spin and the confetti colours had no
  field). The first 128 B are the plan's, in their order; within the
  256 B. The flags are positive (1 camera, 2 reflections, 4 shadow), not
  like bit 2 of `LGHT` (*no* shadow). The band is applied by the TypeScript
  writer to the box (it writes 0, 0); the engine respects it all the same.
- `rt-sim` cannot depend on `rt-core` (it is the other way round): it shares
  `fmath.rs` and `rng.rs` by compiling them through `#[path]`, and an `rt-core` test
  checks that they give the same bits.
- **E12 is not done** (a plan dependency): NEE from the particles
  uses the light selection that exists. With many lights and 100 k particles
  there will be more noise than there will be with E12.
- A disc is always thin-walled; snow with a “short `absorption`” is a
  thin white diffuse with 30 % transmission, because a flat flake has no
  interior. *Energy* is the birth velocity (m/s), which relaxes
  towards the fall.
- The section goes after *Environment* (which already went after *Light*) and before
  *Camera*. The cap row is in the *Engine* block of *Settings* (after
  SIMD), so as not to split the blocks.
- The viewer's picker does not pick particles (a click still picks parts).
  The AI post-processing guard sees the effects' materials as
  *Default* and their `partId`s name no node.
- `tests/project.test.ts` compared the state of `parseProject` with that of
  `loadProject` including the Doctor's results, which `loadProject`
  runs again with this version's checks: with the new `particles` they
  no longer match on an earlier file. The comparison leaves those
  results out and checks that they are this version's.
- **What CI does not have yet** (`.github/` is not touched in this phase): in the
  engine job, `rt --write-ambient-example` and `wasm-parity.mjs
  --expect 415d7d74 --expect-particles e38b8480` on that scene, and
  `tests/effects-rsb.test.ts` in the real `rt.wasm` step.

**Preset values** (rule 11; `src/data/effects.ts`; proposed
with the sheet and **accepted** in the verdict). Photographic densities, not
physical ones: the region is the product's box
with its margin (or the cloud's sphere) and the camera sees no more than
that. On the sample bottle (12.7 l of region; 1.6 l of cloud):

| Preset | Density (/m³) → particles | Size | Shape | Fall (m/s) | Others | Material | Shadow |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Dust motes | 150,000 → 1,912 | 0.2 mm ± 60 % | sphere | 0.3 × 0.05 g | energy 0.02, chaos 30 %, scale 80 mm, wind 0.02 | light diffuse, roughness 0.35 | no |
| Pollen | 40,000 → 510 | 0.3 mm ± 40 % | sphere | 0.2 × 0.1 g | energy 0.03, chaos 40 %, wind 0.05 at 20° | yellowish diffuse 0.6 | no |
| Rain | 20,000 → 255 | 1.2 mm ± 40 % | streak 12 ms | 6.5 ± 20 % | chaos 5 %, wind 1 | glass, ior 1.33 | no |
| Snow | 12,000 → 153 | 4 mm ± 50 % | flake | 1 ± 30 % | spin 0.5, wind 0.4 at 30° | thin white, 30 % transmission | yes |
| Dust cloud | 3,000,000 → 4,889 | 0.3 mm ± 60 % | sphere | 0.1 × 0.2 g | cloud 0.6 part sizes, softness 0.6, energy 0.3, chaos 80 % | brown diffuse 0.8 | no |
| Ash | 15,000 → 191 | 1.5 mm ± 60 % | flake | 0.4 | spin 0.8, wind 0.3 at 200° | almost black 0.85 | no |
| Bubbles | 10,000 → 127 | 2.5 mm ± 60 % | sphere | 0.25 × −1 g | energy 0.05 | thin glass | no |
| Confetti | 5,000 → 64 | 8 mm ± 30 % | flake | 0.8 ± 40 % | spin 1.5, 4 tints | paper 0.5 | yes |

**For the verdict, from the sheet**: backlit dust **barely glows**
in the beam. An opaque diffuse sphere lit from behind shows its dark side, the
specular of roughness 0.35 gives a very thin edge, and one of
0.2 mm at 512 px stays at the minimum size (its coverage spreads the
energy); a thin diffuse with 60 % transmission was tried and changes nothing
by eye (thin transmission is specular and NEE does not see it). The “dust in the
beam” of photographs is forward scattering: either a lobe of its own for
the particles, or wait for the E9b / S5 media. Backlit rain
does light up in the beam.

**Lead's verdict** (2026-10-14).

1. **Cost** (criterion 5): the ≤ 1.3× holds at the presets'
   densities, not at the 200,000 cap. By the measured curve (20,000 → 1.8×,
   200,000 → 3.2×), the presets on the bottle (≈ 1,900 motes, 4,900
   dust-cloud grains) should come out near 1.1×, but it is an
   estimate: S4b measures it first. The particles' BVH stays; the
   screen grid for pinhole camera rays is the first thing
   in S4b only if a measured preset scene exceeds 1.3×. The default cap
   stays as it is.
2. **Preset densities**: accepted as proposed
   (photographic, not physical). The table above stops being a
   proposal.
3. **Backlit dust**: accepted for now. S4b gives dust motes,
   pollen and the dust cloud a forward-scattering lobe so that
   a beam lights them: in the sheet, `DUST_MOTES-back` is barely visible at
   512 px, and “how they reflect the lights” is what was asked for. Rain that
   lights up in the beam is already fine.
4. **The little dots of the rain with the side key**: S4b. Drops
   make no caustics (a shadow ray that crosses a drop passes with its
   coverage and without refraction), the usual rule for small refractive
   particles; refraction stays for camera rays.
5. The widening by probability instead of scaling by area, the 192 B
   `FXAM`, the particle sets after the instance BVH,
   the placement (*Ambient* after *Environment*, the cap in the engine block),
   the maths shared through `#[path]` and the change to the project test:
   accepted as noted.
6. The missing CI lines are added by the lead to
   `.github/workflows/engine.yml` on merging.

## S4b · Particles: forward lobe, rain without caustics and measured cost — Opus — done

**What** (from the S4a verdict):

1. **The cost at the presets' densities, measured first.**
   `tools/ambient-sheet.mjs` gains a cost scene per preset, at the
   preset's count on the sample bottle (besides the 200,000 one), with its ratio against the
   scene without the effect in alternating rounds. Criterion: ≤ 1.3× per sample in each preset. Only if any
   exceeds 1.3× is the first job of the phase a screen grid for the
   camera rays of a pinhole camera (the particles projected;
   each ray tests those of its pixel instead of traversing the BVH). The BVH of
   the particles stays for the other rays; the default cap does not
   change.
2. **A forward lobe** for `DUST_MOTES`, `POLLEN` and `DUST_CLOUD`:
   Henyey–Greenstein scattering with g ≈ 0.7 (Henyey and Greenstein,
   *Diffuse radiation in the galaxy*, ApJ 1941; public literature), one more
   lobe of the particle's material, sampled and evaluated with E12's NEE
   MIS, so that a light behind the product lights them
   in its beam. Criterion: the sheet's `DUST_MOTES-back` is visible; energy is
   conserved (test).
3. **Drops without caustics**: a shadow ray that crosses a small
   refractive particle (rain, bubbles) passes with its coverage and without
   refraction; refraction stays for camera rays. Criterion:
   the sheet's little dots in `RAIN-side` disappear and backlit rain
   does not change by eye.

**Depends on.** S4a, E12.

**Done.**

**1. The cost, measured first.** `tools/ambient-sheet.mjs` gains a cost scene
per preset (`cost-<KEY>`: the preset at its density on the
sample bottle, with the side key, like those of the sheet), besides
the 200,000-mote one, and measures them in **alternating rounds**: each round
renders the scene without the effect and straight after that of the effect (so the load of
the shared machine weighs the same on both), its ratio is the cost per
sample of that round (the same samples; the evaluation of the particles,
once per load, aside) and the sheet gives the median (`--rounds`,
`--cost-samples`, `--only cost`). With S4a's engine (512 × 288, 32 spp,
2 threads, 3 rounds; `out/s4b-cost-before`, the binary of `09d8196`):

| Preset (particles) | Rounds | Median |
| --- | --- | --- |
| Dust motes (1,912) | 1.15 / 1.28 / 1.18 | 1.18× |
| Pollen (510) | 1.27 / 1.27 / 1.05 | 1.27× |
| **Rain (255)** | 2.08 / 1.76 / 2.02 | **2.02×** |
| Snow (153) | 1.07 / 1.18 / 1.21 | 1.18× |
| Dust cloud (4,889) | 1.37 / 1.14 / 1.08 | 1.14× |
| Ash (191) | 1.11 / 1.06 / 1.04 | 1.06× |
| Bubbles (127) | 1.24 / 1.19 / 1.14 | 1.19× |
| Confetti (64) | 1.07 / 1.11 / 1.14 | 1.11× |
| 200,000 motes (the cap, not a preset) | 2.93 / 2.70 / 2.99 | 2.93× |

Rain exceeds 1.3×, so the first thing was the **screen grid**
(`geometry::particles`, `ScreenGrid`): with a perspective camera each
set keeps a grid of 4 px cells over the image (larger cells if it would exceed 2²⁰) with, per cell, the particles whose box
(widened as camera rays see it, with the rounding margin of the
BVH boxes, and a long capsule in up to 32 pieces along
its axis) projects into it; a camera ray tests those of its cell (and
those that touch the camera plane, which every ray tests) instead of
traversing the BVH, with the same test and the same order: the same hit,
bit for bit. A box in front of the camera projects within the envelope of
its corners and every point of a ray leaving the centre projects where
its direction does, so the cell has everything the ray can touch. The
BVH stays for the other rays; the default cap does not change.
**But the camera of the sample and of the sheet (that of every new project) is
a thin lens at f/5.6**, whose rays do not leave from a point: a
pinhole grid would never have used it (measured: 0 candidates). It is
generalised without losing exactness: a ray leaving the aperture disc (radius `R`)
and crossing the focus plane (depth `z_f`) at `F`
passes, at depth `z`, within `R |1/z − 1/z_f|` (in tangent) of
the projection of `F`; each rectangle grows by that circle of confusion at
the worst depth of its box and the ray looks up `F`'s cell. A ray that
does not leave from the disc (a traced lens, the continuation from a cut-out)
traverses the BVH. The grid tests all the cell's candidates and the BVH
stops at the nearest hit: a cell with more than 128 particles
(`GRID_MAX_CANDIDATES`) sends its ray to the BVH (without a cap, 200,000 motes at
128 × 72 cost 721 M instructions per sample against 147 M without a
grid; measured on the camera ray of those motes with caps of 16, 64, 128,
256 and none, at 128 × 72, 512 × 288 and 1920 × 1080, 128 is the best or
ties with the BVH in all three: 1,355, 457 and 153 ns against 1,313, 1,137 and
550 with 16). In the rain cost scene, the grid leaves 1.8
candidate particles per camera ray.

With the grid, the lobe and the drops below, and the capsule that discards
earlier the ray that does not touch its infinite cylinder, the cost at the
presets' densities (the same method, 5 rounds, the final binary;
`out/ambient-sheet`, load ≈ 2.8 on 4 cores) and, to remove the noise of
the shared machine, the **instructions per sample** (*valgrind*,
deterministic: 3 spp minus 1 spp at 512 × 288, one thread; before, the binary of
`09d8196`):

| Preset (particles) | Time, rounds | Time | Instructions, S4a | Instructions, S4b |
| --- | --- | --- | --- | --- |
| Dust motes (1,912) | 1.07 / 1.07 / 1.06 / 0.93 / 1.09 | 1.07× | 1.22× | 1.08× |
| Pollen (510) | 1.02 / 1.10 / 1.14 / 1.07 / 1.05 | 1.07× | 1.15× | 1.07× |
| **Rain (255)** | 1.76 / 1.63 / 1.62 / 1.63 / 1.77 | **1.63×** | 1.75× | **1.50×** |
| Snow (153) | 1.18 / 1.19 / 1.16 / 1.22 / 1.21 | 1.19× | 1.17× | 1.15× |
| Dust cloud (4,889) | 1.15 / 1.14 / 1.09 / 1.13 / 1.09 | 1.13× | 1.21× | 1.10× |
| Ash (191) | 1.09 / 1.06 / 1.09 / 1.12 / 1.12 | 1.09× | 1.11× | 1.07× |
| Bubbles (127) | 1.13 / 1.03 / 1.18 / 1.09 / 1.21 | 1.13× | 1.11× | 1.10× |
| Confetti (64) | 1.11 / 1.16 / 1.14 / 1.07 / 1.10 | 1.11× | 1.11× | 1.11× |
| 200,000 motes (the cap, not a preset) | 2.00 / 1.94 / 2.08 / 1.91 / 1.91 | 1.94× | 2.17× | 1.94× |

All the presets stay below 1.3× except rain. The scene without an
effect goes from 874.2 M to 879.5 M instructions per sample (+0.61 %: the new
integrator checks; they are skipped without particles and the
BSDF entries are inlined), with the same pixels. Snow, ash
and confetti are opaque discs: neither the grid nor anything in S4b changes them much.

**Why rain is still above** (counted with counters in a copy
of the engine, 512 × 288, 8 spp): without an effect, most camera rays
go out to the background (1,179,648 camera rays and 124,644 shaded vertices);
with rain, the streaks cover 26 % of the frame and each camera ray
that touches a drop gives two glass vertices (entering and leaving) and the rays
that follow: the vertices of the drops alone are 699,326, 5.6 times all those
of the scene without an effect. It is the light transport
of a quarter of the frame being glass, not the BVH traversal (the
grid left it at 1.8 candidates per camera ray and 1.7 leaves per
traversal of the rays that follow, at 10 spp). What useless work remained was
removed: on a clear, smooth particle (`is_mirror`: roughness at the minimum, no
metal or diffuse) the next-event estimation only looks for delta lights
and the others are found by its BSDF ray, which counts what it finds in full
(an infinite density in the MIS: the power heuristic gives 1); the NEE
of an α = 10⁻³ lobe found almost nothing and traced a shadow ray
per vertex. Bounding the ray that enters a drop by its
own exit was tried (exact, falling back to the full search): 0.7 % of the
instructions, removed.

**2. Forward lobe** (`bsdf::forward`, with the citation of Henyey and
Greenstein, *Diffuse radiation in the galaxy*, ApJ 93, 1941). One more lobe
of the particle's BSDF: `(1 − s)·surface + s·albedo·p(μ)/|cos θi|`
with `p(μ) = (1 − g²)/(4π (1 + g² − 2gμ)^{3/2})`, `μ = −wi·wo` (the cosine
between the light's direction before and after), per unit of radiance and
solid angle, whatever the normal of the point hit (the particle
scatters like a small cloud, not like a surface; hence the
`1/|cos θi|`, which the integrator multiplies back). It is chosen with
probability `s` and within it `μ` by the inverse of its cumulative distribution
(isotropic if `|g| < 10⁻³`, the azimuth uniform, `fmath`'s `sin`/`cos`);
`Bsdf::pdf` is the density of the mixture, which is what E12's NEE MIS
weights; the NEE evaluates it with all lights (also those that are not
`glossy`, like the diffuse). Its rays that pass through the particle, and its
shadow rays, leave from its back face (from the widened particle if
a camera ray hit it). `FXAM` grows to 200 B: `forward` (the share `s`,
0..1) and `forward_g` (−1 < g < 1); a 192 B payload (S4a) has no
lobe. In the interface it is part of the effect's own material
(`EffectMaterial.forward`, `forwardG`): g 0.7 in dust, pollen
and the dust cloud, **share 0.5 (proposal, rule 11)**, 0 in the others; with
a catalogue material, or a transparent one, none (the engine could not distinguish
its rays from refraction); an effect saved before S4b takes its
preset's on opening. The parity scene (`example::ambient_scene`) gives it to
its dust. `DUST_MOTES-back` is visible (sheet, above): the motes in the beam
glow where before they barely did; with the side key, the image mean
goes from 24.64 to 24.57 (out of 255).

**3. Drops without caustics.** A particle with clear material
(`is_clear_material`: `(1 − metallic)·transmission ≥ ½`, no emission:
rain, bubbles) is crossed **straight, whole and without refraction** by shadow
rays (if the effect casts shadows, it now passes through it: `passable`) and
by the rays of a path that has already bounced off a broad lobe
(`RayClass::Rough`, `Tracer::trace_rough`: BSDF sample density <
`SHARP_PDF` = 100 sr⁻¹, wider than a GGX of roughness ≈ 0.15), with the
straight transmittance of a thin wall of its material (the Fresnel of the
two faces and its tint, once) and from beyond its back face
(`Prepared::straight_through`); a ray of that class only sees the effect if it
casts shadows, and its crossing is a straight event (it keeps the density and
the light selection of the last vertex for the MIS). The camera
and the narrow-lobe paths from it (a mirror, the bottle's smooth glass)
still see the drops refract. The caustic photons
already stopped at the particles (they are not among the parts that focus them,
S4a). In
`RAIN-side` the little dots on the body and the label of the
bottle and the floor disappear (sheet, crop); `RAIN-back` does not change by eye.

**Tests** (each with its mutation, in a copy of the engine: all fifteen
make it fail, and they pass without it):
- `geometry::particles::grid_tests::camera_rays_find_through_the_screen_grid_what_brute_force_finds`
  (pinhole, f/2 at 900 mm and f/1.4 at 300 mm; spheres, discs and capsules
  of 600 particles, widened motes, some on the camera plane or
  behind it; 6,000 rays, also outside the frame, through the grid, the same
  hit as brute force; a ray that does not leave from the lens, through the BVH;
  and a crowd of 40,000 whose full cells send their rays to the BVH,
  with the same hit). Mutations: without the circle of confusion; without the
  particles on the camera plane.
- `bsdf::forward::tests`: the phase integrates to 1 with `g` of mean cosine (g 0;
  0.3; 0.7; −0.5; 0.95); sampling gives its density (histogram of `μ` to
  5σ); the BSDF's white furnace (white Lambert and white lobe with share
  0.25, 0.5 and 1: 1 ± 1 % from 0°, 45° and 80°) and the dust mixture
  (`(1 − s)·surface + s·colour`, ± 1.5 %); weights `f |cos| / pdf` and the
  mixture's density integrates to 1 over the sphere; without the lobe, the surface's numbers
  bit for bit. Mutations: the density without the lobe; the
  evaluation without `1/|cos θi|`.
- `integrator::particle_tests` (new): `the_forward_lobe_is_unbiased_with_either_technique_and_with_both`
  (a 120 mm white mote with a light sphere behind it and to one side: MIS
  2.38148, NEE only 2.38179, BSDF only 2.38721; 4096 spp, 8 × 8; the mote
  casts shadows, so it also proves that its rays leave from its back face);
  `a_white_mote_with_a_forward_lobe_vanishes_in_the_white_furnace`
  (share 0.5: 0.99997; 1: 1.00014); `a_light_behind_a_mote_lights_it_through_its_forward_lobe`
  (0.050 without the lobe, 2.38 with it); `rough_paths_do_not_see_a_drop_that_casts_no_shadow`
  (the floor under a drop with no shadow is the floor without it, bit for bit);
  `shadow_rays_cross_a_drop_straight_with_its_transmittance` (under the drop,
  0.9585 of the light without it; the calculation, `(1 − R)/(1 + R)` = 0.9607);
  `rough_paths_cross_a_drop_that_casts_shadows_as_shadow_rays_do` (a large drop
  under a panel: MIS 2.18132, NEE only 2.18133, BSDF only 2.18051, and
  less light than without it); `camera_rays_still_see_a_drop_refract` (a water ball
  in front of a wall with the left half lit: the camera
  sees it upside down, 0 on the left and 0.956 on the right);
  `smooth_drops_leave_their_lights_to_their_bsdf_rays_without_bias`
  (10.85212 with the rule, 10.85208 with NEE on the drop). Mutations: the
  rough ray sees the shadowless drop; the rough ray refracts; the shadow
  ray takes it as solid; crosses each face; is not `passable`; shadow rays
  and lobe rays from inside the mote; no lobe; every path
  stays sharp; the camera crosses it straight; the smooth-drop rule with density 0.
- `rt-sim::params`: the 200 B payload with its offsets, the 192 B one
  without a lobe, share outside 0..1 and `g` outside (−1, 1) rejected.
- TypeScript: `tests/effects.test.ts` (which presets send the lobe, none
  with a catalogue or transparent material, the limits, an effect from before S4b takes its preset's) and `tests/effects-rsb.test.ts` (the payload
  byte for byte against that of `rt --write-ambient-example`, with the dust's
  lobe).

**Hashes**: `PINNED_AMBIENT_4SPP` `0xeb60bea2` → `0x8f9efac8` (the lobe of
its dust and its glass rain, which casts shadows, crossed straight by the
shadow rays and the rough ones), the same in scalar, SSE2, AVX2, in scalar
and `simd128` WASI and in the real `rt.wasm` (`wasm-parity.mjs`); the
particles, `PINNED_AMBIENT_PARTICLES` `0xe38b8480`, do not move; no
other hash moves (without particles, the scenes do not change a bit). In
`engine.yml` the *Ambient* parity block reads the two pins from the
source; only its comment changes.

**Sheet** `out/ambient-sheet.html` (512 × 288, 128 spp, 2 threads): at the top,
before and after (the binary of `09d8196` against this one, `--rt-before`) of
`DUST_MOTES-back`, `POLLEN-back`, `DUST_CLOUD-back`, `DUST_MOTES-side`,
`RAIN-side` and `RAIN-back`, each pair with a ×2 crop; the eight presets with
both lights; the motes with shares 0.25, 0.75 and 1 (those above have
0.5); `RAIN-side` at 1,024 spp; the streaks and softnesses of S4a; the
cost table.

**What did not fit the plan.**
- **A pinhole camera's grid would not have served**: the camera of
  every new project (and the sheet's) is f/5.6. It was made for the thin lens
  too, exact (above); without it the criterion would not have moved.
- **Rain is still above 1.3×** (1.63× in time, 1.50× in
  instructions, above): its cost is
  shading the glass that covers a quarter of the frame, not traversing the BVH. What
  would lower it is no longer exact or cheap (shorter or less dense
  streaks, or simpler camera drops): for the verdict.
- **The dots in `RAIN-side` had two sources.** The one the verdict asked for
  (the caustics: rays from the bottle's body and label and from the floor that refracted
  through the drops to the key) disappears. The other
  stays, because it is the refraction the verdict keeps: the key seen
  **through each drop** by the camera is a tiny bright detail inside
  each streak, and at 128 spp it comes out grainy; it converges
  (`RAIN-side` at 1,024 spp, in the sheet: the streaks come out
  smooth). For the verdict.
- **“Passes with its coverage”**: read as the straight transmittance of a thin
  wall of its material (Fresnel of the two faces, once). And not only the shadow
  rays: the preset's rain casts no shadow, so changing only those did not touch the dots; the floor's and the bottle's BSDF rays that cross it have to do
  the same so that the NEE and the BSDF estimate the same thing (test of the three
  techniques).
- **“Refraction stays for camera rays”**: extended to the
  narrow-lobe paths from the camera (`SHARP_PDF`), so that
  rain is still seen through the bottle's glass and in mirrors; with the strict rule it would disappear there. For the verdict.
- **The smooth-drop rule** (NEE of delta lights only) was not in
  the brief: it comes from the rain count; it does not change the mean (test).
- **The lobe travels in `FXAM`, not in `MATL`**: it belongs to the effect (its own
  material), `MATL` is the parts' (and M2b is changing it); only with
  opaque material. *Fast* does not show it (the preview's points).
- The capsule discards the ray that does not touch its infinite cylinder before
  computing roots (−2 % of the rain's instructions); the bound on the
  ray entering a drop was tried and removed (0.7 %).
- **TRIAGE 1.2** (drop shape and varied geometries, pending decision,
  rule 11; not done): what S4b leaves done: the grid and the BVH are
  per set and already split a capsule into pieces (`camera_boxes`), so
  a new shape only needs its hit test, its normal, its exit
  (`exit`) and its boxes; mixing shapes per particle would be a
  per-particle shape code in `rt-sim` and in `ParticleSet` (all routes
  already dispatch by shape in `hit`, `exit` and `normal`); and a
  teardrop of water would be clear (`is_clear_material`) and smooth (`is_mirror`),
  so it would inherit the caustics and NEE rules without touching them.

**For the verdict** (rule 11):
1. The **lobe share**: 0.5 proposed; the sheet has 0.25, 0.75 and 1
   with both lights. With a higher share, the motes in the beam glow more and those
   under the side key lose some of their diffuse.
2. The **rain's cost** (1.63× in time, 1.50× in instructions):
   accept it, or shorter or less dense streaks in the preset, or a simpler
   camera drop.
3. The **grain inside the streaks** with the side key (the refraction
   that stays): accept it as noise that converges or regularise it.
4. The **sharp-path rule** (`SHARP_PDF`) versus strictly “camera rays
   only”.

## Physics: rigid bodies, cloth and liquids — **Fable** decision

Request (2026-10-14): realistic physics with its own *Start / Stop*
(stopped by default); “**Drop**” in the context menu of a
model or solid, with the simulation stopping on its own when the solids
come to rest; **cloth** over a face or a solid of a model, with
behaviour according to the **weight per area** and the type of fabric (a fine cotton
does not fold like a thick leather) and the **stiffness** to choose;
**liquids** by viscosity, with the option to turn a solid into liquid; and
for everything to be usable for animations too. These are S2, S9 and S7 of
`STUDIO-TOOLS.md` §5 and `docs/research/particles.md` §6. Decisions:

1. **Where it lives.** A new crate `engine/crates/rt-phys` (`std` only,
   no `unsafe`, deterministic: `f32`, `fmath`, fixed step of 1/240 s with
   4 substeps, contacts ordered by (id, id, feature), transform hash
   equal with 1 and N threads and native = wasm; v1 on a single
   thread). A single **extended position-based dynamics (XPBD)** framework:
   rigid bodies (Müller, Macklin, Chentanez, Jeschke, Kim, "Detailed Rigid
   Body Simulation with Extended Position Based Dynamics", SCA 2020),
   cloth (Macklin, Müller, Chentanez, "XPBD", MIG 2016), liquids (PBF,
   Macklin and Müller 2013). Separate from `rt-sim` (S4a, stateless).
2. **Where it runs.** In the interface, in a worker through `rt-wasm`
   (`phys_*`): the Fast viewer shows the simulation live without touching the
   store; **Stop** confirms the current pose as **one** undoable
   action; **Reset** goes back to the previous pose. Native is not
   needed in v1 (the desktop uses the same interface).
3. **The physics bar** (at the bottom, next to the animation one): ▶ Start ·
   ⏸ Pause / ▶ Resume · ■ Stop · ↺ Reset, simulated time,
   bodies awake, state (*stopped* by default). Pause freezes the
   simulation where it is (cloth, liquids and rain are expensive: the person decides when to continue); Stop confirms it; Reset
   undoes it. The meter says what the simulator says
   (rule 10). A **Physics** section in the part inspector: role
   (static / dynamic / cloth / liquid), mass by density (table per
   material family; it can be fixed), friction, bounce, *as
   parts* (a group falls as one body or each part on its own).
4. **Sleeping.** A body with velocity below a threshold for 0.5 s sleeps;
   with all asleep the simulation stops on its own and confirms the pose.
5. **Animation.** **Every simulation enters the animation on its own** (request,
   2026-10-14): on starting, a `PHYSICS` motion clip is born
   on the timeline (baked track: positions and quaternions per
   frame at the project's fps, `f32`, saved with the project) that
   grows while the simulation runs, stays where it stops and the
   N1 timeline plays like any other clip; *Reset* removes it
   (undoable). There is no separate “record” step: the still image
   uses the frame at the playhead, and the animation already has the simulation. Cloth and liquids store their mesh per
   frame in a cache next to the project (key = hash of
   parameters + geometry + seed + version).
6. **Order.** S2 now (the basis of everything); S9 and S7 after S2, when the
   machine allows it (eight agents in parallel already saturate it).

### S2 · Rigid bodies: “Drop”, the physics bar and recording — **Opus** — done

**What.** `rt-phys` v1: XPBD rigid bodies with automatic **convex hull**
per part (own *quickhull*) for the dynamic ones, and static
parts and the floor as triangle meshes (`rt-core`'s BVH);
hull–hull contacts (own separating axes / GJK–EPA) and hull–triangle contacts;
Coulomb friction, restitution, sleeping (§4). Gravity −Z (the model is Z-up), 9.81 m/s², mm in the
scene. `rt-wasm` exports `phys_new(scene)`, `phys_step(n)`,
`phys_poses()`, `phys_awake()`. Interface: **Drop** in the context
menu and in the *Part* menu (the selected parts become
dynamic, the rest and the floor static, it starts and stops on its own on
sleeping; with a group, *as parts* decides), the physics bar (§3), the
*Physics* section of the inspector (§3), *Record as animation* (§5) with the
`PHYSICS` clip in `src/core/animation.ts` and the bar on the timeline.
Doctor: warns if a dynamic part goes through the floor at the
start. Strings es/en; achromatic chrome; everything through the store.

**Depends on.** U3 (move), U9 (primitives), N1 (animation).

**Acceptance.** `rt-phys` tests: a sphere falls onto the floor and
rests at `z = r ± 0.1 mm`; a stack of three boxes stays stacked for 5 s;
a box tilted 30° falls over on its side and rests flat; the cube on a
static sphere slides off and falls; a thousand spheres settle in < 20 s
natively, one thread (the time goes in the ROADMAP paragraph); sleeping stops the
simulation; pose hash equal with 1 and N threads and native = wasm;
interface tests (mutation checked): *Drop* is a single undoable
action, *Reset* restores, the `PHYSICS` clip is saved and opened.
Browser check `tools/physics-check.mjs` with captures
`docs/ui/physics-bar.png`, `docs/ui/physics-drop.png` (before/after
dropping three primitives onto the floor) and a GIF or 6-frame strip
`docs/ui/physics-drop-strip.png`. `SPEC.md` §3.1 and §3.7,
`UI.md`, `ARCHITECTURE.md` (crate `rt-phys`, the worker), CHANGELOG.

**Done.** In three steps:

- **`engine/crates/rt-phys`** (`std` and `rt-core` only, `#![forbid(unsafe_code)]`):
  XPBD of Müller et al. (SCA 2020) at 1/240 s with 4 substeps; convex
  hull by own *quickhull* (Barber et al. 1996, coplanar faces
  merged by normal and by distance to the plane) with a cap of 128 vertices and
  an oriented box by principal components as a fallback; spheres
  recognised as such (≥ 26 points within 0.2 % of the radius) and treated as
  exact spheres; contacts by separating axes with pruning by the Gauss
  map (Gregorius), Sutherland–Hodgman clipping, ≤ 4 points, speculative
  margins; Coulomb friction, restitution with the 2|g|h threshold,
  sleeping and waking; the PHY1 format; `World` (`add_floor`,
  `add_static_mesh`, `add_dynamic`, `step`, `poses`, `awake_count`,
  `settled`, `hash`). Eleven tests in `tests/rigid.rs`, those of the criterion plus
  a ramp (holds at μ 0.6, slides at 0.1), the drop pinned by hash
  at 60, 90, 120 and 480 steps (`tests/fixtures/phys-drop.json`) and the hash
  equal with 1, 2, 3, 5, 8 and 13 pieces of narrow phase and with 3 threads.
  **A thousand spheres** (radius 10 mm, ten layers of ten by ten in a tray)
  settle in **1.70 s simulated**; in release, one thread, **7.05 s**
  of wall clock on the 4-core virtual machine with seven other agents
  compiling (load ~30; an earlier measurement with less load gave 2.4 s of
  CPU).
- **`rt-wasm`**: `phys_new`, `phys_free`, `phys_step`, `phys_bodies`,
  `phys_ids`, `phys_poses`, `phys_awake`, `phys_settled`, `phys_steps`,
  `phys_hash`, over a registry of worlds by *handle*. Native = wasm:
  the `rt-phys` tests pass compiled to `wasm32-wasip1` with the same
  hash, and `tests/physics-engine.test.ts` repeats the pinned drop with the
  real `rt.wasm`.
- **Interface**: `core/physics.ts` (roles, density per material
  family, `physicsSpec`, the poses back to the nodes inside rotated
  and scaled groups, the `PHYSICS` track and its anchor, the
  `physics/*` actions), `io/phys.ts` (PHY1), `render/physics-worker.ts` and
  `physics.ts`, `ui/physics.ts` (the running simulation), the physics
  bar, the *Physics* section, *Drop* in the context menu, in the
  inspector and in the palette, the `PHYSICS` clip on the timeline and the Doctor's
  `physics` check (16 checks with U13's `aspect`; 16 animation
  types).
  `tests/physics.test.ts` (24 tests, each checked by reintroducing its
  error) and `tools/physics-check.mjs`, with the three captures.

**What did not fit the plan** (rule 12):

- **There is no *Part* menu in the header.** *Drop* is in the context
  menu (the same in the tree and the viewport), in the *Part*
  and *Physics* sections of the inspector and in the palette.
- **“`rt-core`'s BVH”**: `rt-core`'s answers rays (width 4/8,
  SAH), not “which triangles touch this box”; `rt-phys` has its own,
  small (median split, leaves of 4), and `rt-core` is not touched. **GJK–EPA** was
  not needed: separating axes for hull–hull and
  hull–triangle, and an analytic sphere. The floor is a single enormous
  triangle: with two, the diagonal skewed the friction.
- **Deviations from the paper** needed so that a resting box
  neither drifts nor turns and a stack of three does not fall: friction per patch
  (at its centroid, with torsion by the patch radius, and at minimum a
  rolling arm: a ball that spun on its support point
  never stopped) and not per point;
  static friction **anchors** that are kept from step to step; dynamic friction
  as an impulse of at most μλ/h; the coplanar patches of a body against static ones
  merged into one; rolling resistance of
  0.02 r (a rolling ball ends up stopping); sleeping by travel in a
  0.5 s window and not by instantaneous velocity (contact jitter
  let nothing sleep); waking only by something approaching fast
  (chains of wake-ups did not let the thousand spheres settle).
- **The cube on the sphere**: on a coarsely tessellated sphere a cube
  can really rest on a facet. The test uses a 32 × 64 sphere,
  μ 0.2 and the cube slightly displaced from the summit; it slides off and falls.
- **The time of the thousand spheres** is required (< 20 s) only in release; in
  *debug* the test checks that they settle.
- **The exports** are more than the plan's four (`phys_new(scene)`,
  `phys_step(n)`, `phys_poses()`, `phys_awake()`): a *handle* per world and
  `phys_ids` (where each body ended up; one without mass is not simulated).
- **Recording** (decisions 3 and 5, changed midway through the phase): there is no
  *Record as animation* button; every simulation records itself into one
  `PHYSICS` clip per body that grows while it runs. Hence decision 2
  (“the Fast viewer shows the simulation live without touching the store”) is
  met only in part: the **nodes** do not change until confirmed, but the
  clips grow and the playhead follows them through the store (`physics/grow`,
  `anim/playhead`, within the simulation's gesture: one undo entry
  with the start and the confirmation), and the viewer shows it through the
  animation. While it runs, the viewer stays in *Fast*.
- **Pausing on a loaded page.** The browser check found
  that, with the main thread busy, the worker finished the simulation
  before the page saw the pause. Now the page acknowledges each
  send and the worker gets no more than 1/8 s ahead (it goes more slowly
  instead of finishing unseen), what arrives while paused waits for *Resume*,
  *Stop* confirms the pose that is seen (not the one the simulator reached
  afterwards), and a pause requested before the worker has the
  simulation reaches it just afterwards. With their tests.
- **The clip's anchor** (not in the plan): without it, a `PHYSICS` clip
  pinned the node to its frames and the part could no longer be moved afterwards
  after a drop. The clip stores the pose it refers to (`anchor`) and
  plays moved by whatever the node has moved since.
- **The playhead at 0** (for **Fable**'s judgement): N1 shows at 0 the
  scene as it is edited, and after a drop from 0 the edited pose is already the
  final one, so at 0 the part was seen at rest and one frame later
  in the air. What was built: at 0 the nodes held by a recorded simulation
  show their frame (also the still image: “uses the frame at the
  playhead”), the rest as edited, and the gizmo does not appear on those nodes
  at 0 (as it does not appear with the playhead past 0). The other option, following N1
  to the letter, is to remove `playheadPose` and its gizmo rule.
- **Density per material family**: the table goes by the seven
  `MATERIAL_CATEGORIES` (metal, plastic, wood, fabric, glass, emissive,
  other), which is the stable key each material has; the values are
  typical ones, for **Fable** to review.
- `migrateProject` (`io/project.ts`) runs the Doctor again on opening,
  as `loadProject` already did: with a new check, a project opened
  through it carried the earlier results. The session branch did the same
  (U13); on merging it ends up only once, its own, with S2's test that fails
  without it.
- CI is not touched (`.github/` is outside the phase): native = wasm
  parity is checked by the `rt-phys` tests on `wasm32-wasip1` and
  `tests/physics-engine.test.ts` when there is an `rt.wasm`.
- **On merging the session branch** (N6, E12, U13, P6/P6b, O1, U12, L6,
  M2a, P5): the `PHYSICS` clip lives in N6's three-zone timeline
  (its properties: start, duration, end, repeat, reverse and the note;
  no amount or curve), goes through the same time as any clip
  (`clipPhase`: repeated, reversed) and `playheadPose` respects N6's
  `poseActive` (a reversed clip holds its end before
  starting). The Doctor: the 14 of origin, `aspect` (U13) and `physics` (S2).

**Lead's verdict.**

1. **The playhead at 0**: confirmed as built. At 0, the
   nodes held by a recorded simulation show their clip's frame
   (in the viewport and in the still image) and the gizmo does not appear on them.
   Reason: frame 0 of a rendered animation has to be the
   start of the fall, and the still image follows the playhead, which a
   simulation leaves at the end, so *Drop* and render gives the pose
   at rest; following N1 to the letter would introduce a jump between frames
   0 and 1 of every animation. `playheadPose` and the gizmo
   rule stay.
2. **Densities per material family**: accepted as typical
   values; they are reviewed with the materials phases (M4), not now.
3. **Decision 2 met in part** (the clips grow through the store, inside
   the simulation's single undo entry): accepted. It is exactly what
   “every simulation records itself” asks for, and one undo entry is
   right.
4. The rest of what was noted (from the *Part* menu to parity without touching CI):
   accepted as is. The Doctor that is run again in `migrateProject`
   stays, with its test.

### S9 · Cloth with real physics — **Opus** (after S2)

**What.** XPBD cloth (distance, dihedral bending, optional area) over
**a face** (the mesh of the chosen part or of the face selected by
levels) or **a solid** (its shell, with pressure for closed ones: cushion,
soft container). Presets by **fabric type and weight per area** (`src/data/
fabrics.ts`, stable keys: silk 60 g/m², fine cotton 120, poplin
150, linen 200, wool 300, denim 400, canvas 600, felt 800, thin leather
900, thick leather 1,200, neoprene 1,500…) with mass per area, stretch
stiffness, bending stiffness and damping; **Stiffness** and **Weight**
editable on top of the preset, and *Thickness* for collision. Collision
with the static parts and the rigid bodies of S2, self-collision by a spatial hash
grid, anchors (by vertex selection in a box or by the
top edge), wind from S4a. A *Drape over the part* preset (a plane
of cloth over the product). The physics bar and recording from S2; the
cloth's mesh per frame in the cache (§5). **The shading of the
fabric is M5**, not this phase.

**Acceptance.** A 1 m cloth hangs from two corners and its lowest point
ends up within 2 % of the analytic catenary for the weight; silk
and thick leather, with the same cloth over the sphere, give wrinkles of
different scale (metric: mean curvature; silk ≥ 3× the leather's);
nothing goes through the sphere (minimum distance test); determinism;
sheet `out/cloth-sheet.html` with the presets over the sample bottle.

### S7 · Liquids — **Opus** (after S2 and the nested dielectric)

**What.** Position-based fluid (PBF) with viscosity (XSPH), cohesion and
surface tension; presets (`src/data/liquids.ts`: water, oil,
honey, milk, gel, syrup…) with density, viscosity and colour/absorption;
**Convert to liquid** in the context menu: the part is filled with
particles by ray parity, hidden, and a *Liquid* part is born
whose surface is rebuilt by marching cubes every frame (in
the worker); the containers are the static parts. Engine:
**nested dielectrics** by priority (Schmidt and Budge, "Simple Nested
Dielectrics in Ray Traced Images", JGT 2002) for liquid inside
glass; glass material with absorption. Bar, recording and cache from S2.

**Acceptance.** A litre poured into a closed glass keeps its volume
± 3 %; honey takes ≥ 5× longer than water to level (test); nothing
goes through the glass; determinism; sheet `out/liquid-sheet.html`.

### S3 · Rain and dust on the set and on the lens — **Opus** (after S4a and S2) — first part done (the drop, the shape mix and the front glass); the second, S3b (the glass fed by the scene); the rest, S3c

Request (2026-10-14): S4a's rain falling onto the set and the
part and **running down** realistically; dust **settling**; and for
drops and dust to be able to affect **the lens** or not, like a glass in front. It is an expensive computation: it goes in the physics worker with Pause /
Resume, with a cache, and enters only in the animation (§3 and §5 above).

**What.**
1. **Drops on surfaces.** A rain particle of S4a that touches
   a surface (its path is deterministic by seed: the
   landings are reproducible events) is born as a **drop**: a spherical
   cap stuck to the surface (a sphere with its centre below it, the
   engine already traces spheres: S4a), with water material (glass IOR 1.33). The
   drops **grow when they merge**, stay **anchored** by the
   contact-angle hysteresis of the material (wettability per family:
   glass, plastic, metal, paper, paint; table in `src/data/`) and
   **run down** when their weight along the tangent overcomes it,
   leaving a **wet trail** (thin film: lowers the roughness and
   darkens porous material: wetness mask in the material) and picking up
   the drops they meet; at an edge they **drip** (become
   falling particles again) and on impact they splash (secondary drops). Snow:
   accumulates as a layer (S4a profile) and does not run.
2. **Settled dust.** A coverage field per surface (texel grid
   per part or per vertex) that accumulates what S4a's dust flow
   deposits (upward exposure × time × density), with
   an **angle of repose** (it sheds from steep faces) and that rain
   **cleans** where its trail passes. It is rendered as a layer
   (greyish diffuse that raises roughness, blended by coverage) with
   visible motes (tiny discs from S4a where coverage is high).
3. **The lens glass.** In Camera ▸ Lens ▸ Filters, **Front
   glass** (yes/no): a sheet attached to the camera at the distance of the
   front element (20–40 mm from the pupil, depending on the lens) onto which
   the rain and dust of the scene's effects fall with the same
   models (drops run according to the camera's *up*; dust
   settles if it looks upwards). It is **real geometry** in front of the
   lens: camera rays pass through it and each drop refracts
   like the lens it is (inverted and heavily defocused blotches, as in
   a real photo), the dust is dark soft motes. Manual controls
   for a still image without simulating: number of drops, size,
   dust, seed. Without the glass, nothing touches the lens.
4. **Simulation.** In `rt-phys` (fixed step, deterministic), with the physics
   bar (Pause / Resume), a cache next to the project (drops per
   frame, coverage per frame, key = hash of parameters +
   geometry + seed + version) and the automatic `PHYSICS` clip (§5).
   The Fast viewer shows the drops as spheres and the coverage as a
   tint; the engine renders the real thing.

**Depends on.** S4a (particles and primitives), S2 (`rt-phys`, bar,
cache, clip), O1 (`LENS`: the front element's distance).

**Acceptance.** Tests: a drop on glass tilted 30° stays until
the table's critical radius and slides above it (numerical test against
the tangential force / contact angle equilibrium); two drops that touch
add their volume (± 1 %); the trail cleans the dust; dust coverage
on a face at 60° is < 10 % of the horizontal; the front glass with 0
drops and 0 dust leaves the render bit for bit the same as without glass;
determinism and reproducible cache; the clip exists after starting and
disappears with Reset (undoable). Sheet `out/rain-dust-sheet.html`:
the bottle under rain at 0, 2, 5 and 15 s (drops, trails, dripping), dust at
0, 30 and 120 s, and the same photo with the front glass wet and
dusty; by eye (**Fable**'s verdict). Captures `docs/ui/physics-rain.png`,
`docs/ui/lens-glass.png`. `SPEC.md`, `UI.md`, `ARCHITECTURE.md`,
CHANGELOG.

**Done (first part; the rest, S3b, below).** The phase is large and did not
fit entirely in one PR without lowering quality: what enters is decision **1.2**
(the drop shape and the geometry mix in *Ambient*, requested by the
owner) and point 3 as a still image without simulation (the front glass with
its manual controls: number of drops, size, dust, seed). The drops
that fall and run down the parts, the dust that settles, the glass
fed by the scene's effects and the simulation with cache and clip
are the **S3b** proposal.

**1. The drop and the shape mix (1.2).**
- **`rt-sim`.** `Shape::Drop` (code 3 of `FXAM.shape`; an earlier engine
  reads it as a sphere): the particle's round body and a tip of
  `drop_tip` times its radius whose centre lies `drop_tail` radii behind,
  **against the velocity** (the falling drop points up, the rising bubble
  down; at rest, along the normal of its life), with at least
  0.05 radii of tip outside the body. The **mix** (`mix`, one weight per
  shape: sphere, disc, capsule, drop) draws each particle's shape once with its own hash, so that each keeps it at any
  instant; `shape_var` lengthens or shortens each one's drop or streak
  (`± shape_var`) with another. The salts are new: the shape changes no
  position, size or tint, and an effect without S3 fields gives its usual bits. `Particle` gains its `shape`; `positions_hash` does not include it (it is
  S4a's) and `shapes_hash` pins it separately. `FXAM` grows to **228 B** only when
  there are S3 fields (`has_s3_fields`): an effect without drops, mix or variation
  keeps S4b's 200 B (and `tests/fixtures/ambient.rsb` does not change).
- **`rt-core`.** The drop is the convex hull of two spheres: the
  tangent cone `ρ cos β + s sin β = r` solved as a quadratic from the point of the
  ray nearest the body (without cancellation for a tiny distant drop),
  the body where `s < r sin β`, the tip beyond the contact circle;
  every root that remains is on the convex boundary, so the nearest one in the
  interval is valid, as in the capsule. Piecewise normal; `drop_distance`
  (the exact distance) for the tests. Widened for the camera, the drop is
  scaled whole around its body (coverage = square of the scale) and
  the boxes' margin grows with its length (`drop_reach`). A set that
  mixes stores each slot's shape and all the tests dispatch on it
  (hit, exit, normal, coverage, screen-grid boxes); the
  integrator asks per particle whether it is a disc (thin wall) and per
  set whether all are (no medium inside). `rt_particles_shapes` (wasm)
  gives *Fast* each particle's shape.
- **The page.** `EffectShape` gains `DROP`; `AmbientEffect` gains `shapeMix`
  (`on` and the four weights), `dropTail`, `dropTip` and `shapeVar`
  (`core/effects.ts`: `mixWeights`, `effectHasShape`, `heaviestShape`,
  `hasS3Fields`); the new preset **`WATER_DROPS`** *Water drops* (code
  12). In *Ambient ▸ Advanced* the **Shape** becomes a list (*Point ·
  Flake · Streak · Drop · Mix*), with the mix weights and the share of
  each, the drop's length and tip and the shape variation, each
  one undo entry; the spin and streak length also appear when
  the mix has flakes or streaks. *Fast* draws the drops with the engine's outline
  (`dropOutline`, in an instanced `LatheGeometry`, stretched to the
  length of each one) and each particle of a mix with its shape. An engine without
  bit 6 receives a drop as a sphere and a mix as its heaviest
  shape, without S3 fields.

**2. The front glass (point 3, still image).** `CameraOptics.frontGlass`
(`on`, `drops`, `dropSizeMm`, `dust`, `seed`, `distanceMm`) in *Camera ▸
Lens ▸ Filters ▸ Front glass*, and in the engine the new section **`GLAS`**
(48 B, right after `LENS`) and `rt_core::optics::glass`. An ideal sheet
(it neither bends nor darkens anything: with no drops or dust the image is that of no
glass, **bit for bit**, test with the passes) at `distance` from the camera (0,
automatic: 25 mm with the simple lens, 5 mm in front of the front vertex of
a traced one); on top, **drops** as spherical caps of water (contact angle and
index in `src/data/front-glass.ts`) through which camera rays
enter by the base or the dome and leave by the dome with Snell and exact Fresnel
transmittance, or bounce by total internal reflection (up to 8
times; those that leave again by the base go towards the camera and bring
nothing), and **dust**, discs that let `1 − opacity` through. The drops come from
cells of the glass itself (four mean diameters) with hashes of (seed,
cell, index): the requested coverage, the position, the size; only the cells
that the rays can cross (at least 45° of half-field, so that the image of
a viewport, which is wider, has those of the frame). Those that touch **merge** into
one of their summed volume at their centre of mass (`∛(a₁³ + a₂³)` at a fixed
angle), in passes of fixed order. The image's camera rays see it
(after the lens and its filters), the albedo and the alpha of their samples;
the screen position of a ray that a drop bent is recomputed for the
background image. The exact passes, click-to-focus and a panoramic camera do not see it. In the interface: the switch and its five controls, each
an undo entry, a note that only *Full* and the render trace it,
and another if the camera is panoramic; it is saved with the camera (project
and studios) and written only for an engine with bit 6.

**3. Engine, capabilities and pins.** Bit 6 of `FEATURES`, `FEATURE_DROPS`
(64): the drop, the mix and the variation of `FXAM` and the `GLAS`; the page
(`render/engine.ts` `readsDrops`, `SceneView.drops`) writes them only for an
engine that says so, and *Export scene* for `rt` always. Two parity
scenes: `example::s3_drops_scene` (2,500 water drops, clear and smooth, and
3,000 opaque particles in a 1 : 1 : 1 : 2 mix with palette, shadow and
variation) and `example::s3_glass_scene` (the sample at 28 mm f/8 through a
glass with 35 % drops of 2 mm and 3 % dust), with `rt
--write-s3-drops-example` and `--write-s3-glass-example`. **New pins**:
`PINNED_S3_DROPS_4SPP = 0x73ebde26`, `PINNED_S3_DROPS_PARTICLES =
0x401e61d5`, `PINNED_S3_DROPS_SHAPES = 0xec380974`, `PINNED_S3_GLASS_4SPP =
0xf410d5f0`: the same in scalar, SSE2 and AVX2, with 1, 4 and 16 threads, through
an RSB, and in the real `rt.wasm` (`tools/wasm-parity.mjs`, which gains
`--expect-shapes`; the glass scene also with the passes interleaved);
`.github/workflows/engine.yml` reads them from the source and runs
`tests/s3-drops.test.ts` with the real `rt.wasm`. **No earlier pin
moves.**

**Cost** (instructions per sample with *valgrind*, deterministic: 3 spp
minus 1 spp at 160 × 120, one thread). The drops scene with its two effects as
spheres, 337.5 M; as 10 ms streaks, 407.9 M; as drops, 398.5 M (a
drop costs like a short streak: its cone is another quadratic); the
pinned scene (drops, mix and variation), 385.4 M. The sample, 199.4 M; with a
glass with nothing on it, 200.0 M (+0.3 %: the check on every camera ray); with
the wet glass of 35 % and dust, 219.7 M (+10 %). Against the engine from before S3 (that of `ec6deee`), with the same files: the
sample, 198.9 M → 199.4 M (+0.24 %), and S4a's *Ambient* scene, 539.9 M →
548.3 M (+1.6 %: the shape of each slot looked at in every hit test;
the same pixels).

**Tests** (each checked with its mutation: all 21, 14 in the engine and 7 in the
page, make it fail, and they pass without it; three in the engine survived the
first pass and were closed: the mix drawn with the set's shape
fooled the comparison with brute force, which uses the same test, and
the one below against single-shape sets had to be added; the other two were
mutations badly chosen for the test that was run and are caught by the ones
next to them):
- `rt-sim::params`: the 228 B payload and its offsets, the 200 B one without
  S3 fields (and S4b's, shorter, with the defaults), the ranges;
  `shape_for` and `can_be`. Mutations: the S3 fields never written; the
  mix without its weights.
- `rt-sim::eval::tests`: the drop follows its velocity with its length, the
  minimum tip and the resting one according to its normal; the shape changes no positions,
  sizes or tints; the 1 : 2 : 0 : 5 mix gives its parts (± 1.5 % over 40,000)
  and each particle keeps its shape; the variation stretches drops and streaks
  by the same factor. Mutations: the drop pointing forwards; without
  variation.
- `geometry::particles::tests`: 400 drops of varied shapes against a
  march of their exact distance (hit, exit and normal against the
  gradient); a 0.02 mm drop at 2 m, and widened as a scaled copy with
  its coverage, its box and the camera margin. Mutations: without the cone; the
  widened drop unscaled; the margin without the drop's length.
- `geometry::particles::grid_tests` and `geometry::tests`: the screen grid
  and the BVH against brute force with drops and with a mix of the four
  shapes (also rays of every class), and `a_mix_hits_each_particle_as_its_own_shape`:
  each ray hits in the mix the same particle, at the same distance, as in
  four single-shape sets. Mutation: the mix drawn with the
  set's shape.
- `integrator::particle_tests`: the flakes of a mix are thin-walled and their
  drops solid. Mutation: the set's disc, not the particle's.
- `optics::glass::tests`: the payload and its ranges; two drops that touch add
  their volume (± 1e-5), a chain merges entirely and a separate one does not; no
  drop on the glass touches another, the coverage after merging, the same drops
  with another focal length and in a viewport's image; the ray through a drop's centre
  continues straight with its Fresnel and leaves through the top of the cap; a drop carries
  parallel rays to its focus `R / (n − 1)` (± 8 %); the edge of a 90° drop
  brings nothing (15 of 20 rays of the last fifth) and the centre does; opaque
  dust stops and half-opacity dust lets half through. Mutations: the exit without
  Fresnel; total internal reflection taken as an exit; drops that add radii;
  without merging them.
- `render::s3_tests`: the four pins; the rendered particles are the
  evaluated ones; drops and mix equal to brute force; **a glass with nothing on it
  does not change a bit** of the sample's image or of its passes, also through
  an RSB, and a wet one does; a 6 mm drop on a pinhole camera puts
  the scene upside down (the left half of the drop sees the right of the
  wall), and outside it nothing changes. Mutation: the sheet that moves the ray.
- `rt-cli/tests/example.rs`: the two scenes, the same pixels with 1, 4 and 16
  threads and after an RSB; the two `--write-s3-*-example`. `rt-wasm`: the shapes
  through the C API are the simulator's, and bit 6. `rt-app`: `/api/info`
  says 127.
- `tests/s3-drops.test.ts`: the `FXAM` and `GLAS` byte for byte against those of
  `rt` (`tests/fixtures/s3-drops.rsb`, `s3-glass.rsb`); the new effect with its
  default drop and its 200 B; *Water drops*; the mix, its heaviest
  shape and its streak, and what goes to an engine without the bit; the ranges through the
  store and undo; an earlier file and one with a mix; the outline of
  the drop; the glass off, with nothing, at the limits of a file, written
  after the camera with its fixed values, not for an engine without the bit or with
  a panoramic camera, saved and opened; with the real `rt.wasm`, the mix's shapes
  and the pinned particles, the two pinned images and a project
  with glass and drops. Mutations (seven): the bit ignored, the S3 fields
  always, the `GLAS` without the bit and through a panorama, the glass without
  clamping, the weights without clamping, the mix without its streak.
- `tools/s3-check.mjs` (Chromium and SwiftShader): the gallery with *Water
  drops*, the drop and its rows, the drops in *Fast* (the meter and the
  pixels), the mix with its parts and its weights (one entry per change) and
  undo; the glass in *Full* (off with no controls; on, one
  entry; 8 mm drops at 150 mm and f/16, and the image changes; undo); the
  achromatic chrome in both themes. Captures `docs/ui/ambient-drops.png`,
  `docs/ui/ambient-mix.png` and `docs/ui/lens-glass.png`.

**What did not fit the plan.**
- **The phase split.** This part is 1.2 and the front glass as a still image;
  everything that is simulation (drops on the parts, running down, dripping, settled
  dust, the glass fed by the scene's rain, the physics
  bar, the cache and the clip) is S3b. That is why the sheet
  `out/rain-dust-sheet.html` and `docs/ui/physics-rain.png` are missing, and
  so are the criteria for glass at 30°, dust at 60° and the trail that cleans.
- **The glass does not go in `LENS`.** It goes in its own section (`GLAS`): it also works with
  an orthographic camera, does not touch the `LENS` bytes of O1–O4, and an earlier engine
  skips it. A single capability bit (6) for the drop, the mix and
  the glass.
- **The sheet is ideal** (no Fresnel of its own), so that with nothing on it the
  image is the same bit for bit (the criterion); the glass under a drop
  does not count either (0.4 % between glass and water). The light a drop reflects
  is not followed: a little is lost at the faces (a few percent), which is
  what would go towards the lens.
- **Visibility is physics.** A drop on the glass is a strong, heavily
  defocused lens: with a long, open lens (the 85 mm f/5.6 of every new
  project crosses 15 mm of glass per pixel) 2 mm drops only
  veil the image; they show as discs when they are wider than that footprint
  (a stopped-down wide angle, like the parity scene at 28 mm f/8, or the glass
  far away, a window). The capture uses 8 mm drops at 150 mm and f/16. For the
  verdict (◆ 7).
- **The distance** is measured from the camera position (the centre of the
  simple lens, the entrance pupil of the traced one); the automatic one is a
  proposal (◆ 6). The glass covers at least 45° of half-field so that the
  viewport and the render see the same drops.
- **What sees it**: neither the exact passes (their rays go through the centre of the pixel and
  of the lens to the scene, and the AI guard compares them with the image), nor
  click-to-focus, nor the connections of O3a's filters with the lights
  that the glass would change (left out).
- **The shape becomes a list**: five buttons did not fit in the width of the
  inspector (the first capture came out cut off). It stays in *Advanced* (◆ 5).
- **A 228 B `FXAM` only with S3 fields**, like the “only if set”
  fields of `CAMR` and `RNDR`: S4b's payload does not change size and
  `tests/fixtures/ambient.rsb` is the same.
- **`positions_hash` does not see the shapes**: it is S4a's, and including them moved
  `PINNED_AMBIENT_PARTICLES`; `shapes_hash` (and `--expect-shapes`) pins them
  separately.
- **The glass's contact angle** is a fixed value in
  `src/data/front-glass.ts` (60°), not from the per-family wettability table,
  which belongs to S3b.
- **Fast does not draw the glass** (the plan asked for the drops as spheres and the
  coverage as a tint for the simulation, which is S3b); the section says so.
- `rt-app/tests/server.rs` checked `features == 63`; now 127.
- `tools/ambient-check.mjs` expected eight available cards; now nine.
  `docs/ui/ambient-gallery.png` has not been re-recorded (it still has S4a's eleven).

**For the verdict** (rule 11, ◆; decided in *Judgement calls*):
1. ◆ The default drop: length 1.6 body radii and a tip of 0.15
   (`rt_sim::DROP_TAIL`, `DROP_TIP`), and the minimum tip of 0.05 radii outside
   the body.
2. ◆ The orientation: the tip **behind**, against the velocity (the teardrop that
   falls with its tip up). A real raindrop falls nearly spherical or
   flattened; the teardrop is the shape that was asked for.
3. ◆ The mix *Mix* starts with: 1 : 1 : 1 : 2 (points, flakes,
   streaks, drops).
4. ◆ The *Water drops* preset: 8,000 /m³, 3 mm ± 50 %, fall 2.5 m/s ± 30 %,
   shape variation 30 %, wind 0.3 m/s, chaos 5 %, water ior 1.33, no
   shadow.
5. ◆ Whether *Shape* moves out of *Advanced* to the visible controls (the owner asked
   for the drop and the mix explicitly).
6. ◆ The glass: contact angle 60°, size spread ± 60 %, motes
   of 0.3 mm ± 60 % that stop 90 %; on switching on, 30 % of 2 mm drops and
   2 % of dust; the ranges (drops up to 90 %, 0.2 to 10 mm, dust up to 50 %,
   distance up to 200 mm); the automatic distance, 25 mm with the simple lens
   and 5 mm in front of the traced one's front vertex.
7. ◆ How strongly the effect shows: with today's physics, drops the
   size of the aperture veil the image and do not read as drops (above).
   Accept it, or larger drops by default, or a non-physical control that
   focuses them more (marked as such, like those of O2).
8. ◆ The dust as absorbing motes: a backlit mote does not glow (on a real
   lens, the dust on the front element lights up a little when backlit).
9. ◆ The glass in *Fast*: nothing now; with S3b, an approximation (soft
   blotches) or continue without drawing it.

### S3b · Rain and dust that settle, run down and fall on the lens (simulation) — **Opus** (after S3) — done in part (the front glass fed by the scene, ◆5 and ◆9); the rest, S3c

What remains of S3, as its section above asks for it and on top of what the
first part leaves done:

1. **Drops on surfaces** (S3 point 1): the landings of an effect's
   rain (its path is closed-form in `rt-sim`: the
   instant at which it crosses a part is searched along it) in a fixed-step
   `rt-phys::wet`; the **wettability** table per material family
   (`src/data/wettability.ts`: advancing and receding angles of glass,
   plastic, metal, paper and paint) and Furmidge's condition for anchoring or
   sliding (`m g sin α = γ w (cos θ_R − cos θ_A)`; the glass-at-30° test
   with the table's critical radius); merging by volume (the rule of
   `optics::glass::merge_drops`); the **wet trail** as the material's
   wetness mask (less roughness, darker for porous ones: a new section
   or a channel of M3b's program); dripping at edges (they become
   falling particles again) and splashing; snow as a layer that does not run.
   The drops, as sphere caps on the part (the front glass's
   intersection, in the tangent plane).
2. **Settled dust** (point 2): the coverage per part (texels or
   vertices) that accumulates what a dust effect deposits, with the angle of
   repose (the test of the face at 60° against the horizontal) and the rain that
   cleans it where the trail passes; the layer in the shading and the motes where
   coverage is high.
3. **The glass fed by the scene** (point 3, what is missing): the rain
   and dust of the effects fall onto the front glass of this part with
   the same models, the drops run according to the camera's *up*; S3's
   manual controls remain for the still image.
4. **Simulation** (point 4): in S2's physics worker with *Pause /
   Resume*, the cache next to the project (key = hash of parameters +
   geometry + seed + version) and the automatic `PHYSICS` clip; *Fast*
   shows the drops as spheres and the coverage as a tint (and the glass, if
   verdict ◆ 9 asks for it).
5. **Remaining criteria** of S3: glass at 30°, coverage at 60° < 10 %
   of the horizontal, the trail that cleans dust, determinism and a reproducible
   cache, the clip that is born and goes away with *Reset*; the sheet
   `out/rain-dust-sheet.html` (the bottle under rain at 0, 2, 5 and 15 s, dust
   at 0, 30 and 120 s, and the photo with the glass wet and dusty) and
   `docs/ui/physics-rain.png`.

**Done (S3b: the front glass fed by the scene; the parts' side,
S3c, below).** The whole proposal did not fit in one PR without lowering quality.
What enters is the two decisions (S3 ◆5 and ◆9) and, of the simulation, everything that happens
**on the front glass**: it is a plane, so the whole model (landings
by flux, wettability, Furmidge anchoring, running with a trail, merging,
dust with an angle of repose, the trail that cleans) is built and tested
on it, with the worker, the bar, the cache and the clip; S3's numerical criteria
(glass at 30°, face at 60°, the trail that cleans, merging
± 1 %) are met on that model. Taking it to the parts' meshes
(drops on curved surfaces, the material's wetness mask, per-texel
coverage, dripping at edges, splashing, snow) is S3c.

**1. *Shape* out of *Advanced* (S3 ◆5).** In *Ambient*, *Shape* is a
visible control right after *Size*, with the *Mix* weights below it
when there is one; the drop's length and tip and the shape variation remain in
*Advanced*. `tools/s3b-check.mjs --only shape` (the list among the controls,
outside *Advanced*, which stays collapsed; *Mix*, one undo entry, and its
weights there) and the capture `docs/ui/ambient-shape.png`; `ambient-drops.png` and
`ambient-mix.png` are re-recorded (the shape is no longer in *Advanced*).

**2. The glass in *Fast* (S3 ◆9).** `render/glass-overlay.ts` and the
`GLASS` step of `render/lens-filter-pass.ts`: with the **engine's** drops and motes
(`rt_scene_glass_len` / `_copy` over a scene of only the camera and its glass,
`io/rsb.ts` `glassPaneRsb`; for the scene, the recorded frame), three maps over
the glass in its millimetres (the part under drops; under their edge, where a ray along
the axis comes back by total internal reflection, from `1 / (n sin θ)` of the radius:
0.87 at 60°, no ◆, from physics; under dust, by its opacity) blurred
by the footprint of a pixel on the glass, `R = (f / N / 2) |1 − d / s|`; each pixel
takes the blurred image (through the two faces of the water) for the drops and is
darkened by the edge and the dust. The drops are soft discs with a dark edge; the
dust, a tint (or motes, if they are sharper than the footprint). It does not draw the
scene upside down inside each drop. The meter: *Front glass: approximation
of the engine’s N drops and M motes* (without `rt.wasm`, which draws it with the engine).
Capture `docs/ui/lens-glass-fast.png` (8 mm drops at 150 mm, f/16).

**3. The simulation (`rt_phys::wet`, §5.2 novendecies of ARCHITECTURE).**
- **Arrivals.** Per 1/240 s step and effect, a Poisson draw with mean
  `density × max(0, −v·n) × area × dt`: what crosses the outer face of the
  glass. Density = what the effect asks for divided by its volume (the presets'
  photographic densities); `v`, its wind plus its fall, in the glass's axes
  (the camera's). Uniform over the square of the glass that the render's
  rays cross (the engine's). What each effect deposits: `GLASS_FEED`
  (`src/data/front-glass.ts`: *Rain* and *Water drops*, drops; *Dust
  motes*, *Pollen*, *Dust cloud*, *Ash*, dust; snow, bubbles and confetti,
  nothing).
- **Drops.** Caps of their volume `π D³ / 6` at the mean of the advancing and
  receding angles; they merge with `optics::glass::merge_drops` (S3's rule, by
  volume); they stay anchored by **Furmidge**
  (`ρ g V sin α ≤ γ 2a (cos θ_R − cos θ_A)`), slide above that according to the
  camera's *up* at `v = excess / (C μ a)` and leave a **trail** (a
  film that takes water from them, so a running drop ends up stopping) that
  carries the dust away; one that leaves the glass is gone (drips).
- **Dust.** A mote stays with probability 1 below the angle of
  repose minus 5°, 0 above it plus 5°, a soft ramp in between; never on
  a face that looks downwards.
- **Wettability.** `src/data/wettability.ts` (new keys: `GLASS`,
  `PLASTIC`, `METAL`, `PAPER`, `PAINT`): advancing and receding angles; glass,
  70° and 50°, averaging S3's 60° glass. In S3b only the glass uses it.
- **WET1**, the page-to-engine format (`core/wet.ts` `wetBytes`); each
  frame comes back as its record (`WetPane::frame`: the drops, the motes
  that arrived and those that left).
- **Cost**: the 5 s of the parity scene (189 drops at the end), 1,200 steps
  with a frame every 10, in the real `rt.wasm`, 12–16 ms.

**4. In the worker, with cache and clip.** `render/physics-worker.ts` runs
PHY1 and WET1 together (the same steps) or only one; each frame carries the
poses and the glass record. *Start* (not *Drop*) carries the glass of the
active camera when it is on *Drops and dust ▸ From the scene* and some effect feeds it,
also without any *Dynamic* body; with a glass the simulation does not
stop when the bodies fall asleep (it keeps raining): it is stopped by *Stop* or 120 s
(`MAX_GLASS_SECONDS`). *Pause* and *Resume*, S2's. **The cache** is the glass
track of the camera's `PHYSICS` clip (`MotionClip.glass`: each frame's drops
and each mote with the frame it arrived and the one it left, in
base64, and the **key**, the FNV-1a of the WET1 and the format version): it is saved
with the project, the render and *Fast* read the frame the playhead says
(`Pose.glass`), and a simulation with the same key gives the same track, bit for bit
(test with the real `rt.wasm`). The inspector says which effects feed it, what is
at the playhead (*Recorded: 97 frames, 215 drops and 0 motes at the playhead*) and whether the scene no
longer gives the recorded key. The clip is born on starting, is the same undo entry
as the simulation, and *Reset* removes it (undoable). The bar says *Glass:
215 drops · 0 motes*.

**5. Engine, capabilities and pins.** The end of `GLAS` (from byte 48: `u32
1`, drops, motes, `(x y a)`, `(x y r)`; `optics::glass::GlassLayout`,
`FrontGlass::laid_out`: as is, without spreading or merging), **bit 7**,
`FEATURE_GLASS_LAYOUT` (128); the page writes it only for an engine with it
(`SceneView.glassLayout`) and with coverage at 0, so an S3 engine draws
the glass clean. `rt_phys::example::wet_spec` (the S3 scene's glass at
28 mm f/8 under the preset's rain pushed by 3 m/s of wind towards the lens,
and pollen) and `s3b_wet_scene`; `rt --write-s3b-wet-example` and
`--write-s3b-wet-spec` (`tests/fixtures/s3b-wet.rsb`, `s3b-wet.wet1`); `rt-cli`
now depends on `rt-phys`. **New pins**: `PINNED_WET_PANE = 0x5e511523` and
`PINNED_S3B_WET_4SPP = 0x6e6e370c`, the same in scalar, SSE2 and AVX2 (the
second), with 1, 4 and 16 threads (`rt-cli/tests/example.rs`), in scalar and simd128
`wasm32-wasip1` (`cargo test -p rt-phys --test wet`, new in CI) and in the
real `rt.wasm` (`tools/wasm-parity.mjs`, with the passes interleaved;
`tests/s3b-wet.test.ts` in the CI step that runs the tests with the real
`rt.wasm`). **No earlier pin moves.** `rt-app`: `/api/info` says 255.

**Tests** (each checked with its mutation: all 23, 10 in the engine and 13 in the
page, make it fail and pass without it; two survived the first pass
and were closed: the mote log not emptied between frames passed because the
frames test used the parity glass, which cleans no mote
—it now uses a glass at 30° with rain and dust and requires that each mote leave only
once—, and *Reset* while running without the glass clip, which was only
tested after *Stop*):
- `rt-phys/tests/wet.rs`: glass at 30° (the critical radius ± 0.5 % of the
  Furmidge calculation in `f64`; at 0.97 and 0.995 it stays, at 1.005 and 1.05 it slides; flat,
  never), slides faster the steeper it is and loses in the trail the water that
  it should, one that leaves is gone; merging adds the volume (± 1 %) at the centre of mass;
  the trail cleans dust (a clean band, the rest with its dust; and rain
  on a glass at 30° leaves less than 0.9 of the dust compared with no rain); dust at 60°
  < 10 % of the horizontal, at 30° the cosine (± 10 %), looking down nothing; rain
  arrives at its flux (± 4σ) and never at a face that looks the other way; the same
  glass by separate and joined steps and rebuilt from its frames; the two
  pins. Mutations: half hysteresis; without merging; the trail that does not clean;
  without angle of repose; the flux without looking at the face; the trail without losing water;
  the log not emptied.
- `rt-core`: `optics::glass::tests` (the end of `GLAS` goes and comes back, its ranges
  and its counts; a laid-out glass takes its drops and motes as they are and its mote
  stops the ray); `render::s3_tests` (a laid-out glass with nothing on it, also through
  an RSB, changes no bit of the sample). Mutations: the list ignored (it is
  spread); merging it again; the writer without the list. `rt-wasm`: the
  glass registry is the native one; `scene_glass` is what the engine lays out.
  `rt-cli`: the scene with 1, 4 and 16 threads and after an RSB, the two `--write-*`.
- `tests/s3b-wet.test.ts` (18): the table and that glass and repose are the
  engine's; which effects feed it; the glass's axes and a camera looking down
  stays dry; the sources (density, wind and fall in the axes); the WET1 byte for byte
  with the engine's and its key; the track rebuilds each frame and rejects a
  record that does not follow; with the real `rt.wasm`, the pinned glass and two
  runs with the same track; the camera's clip (the pose's frame,
  the camera still, also at 0), saved and opened, a broken one is removed; the
  `GLAS` drop by drop only for bit 7 and with a recording; the bar runs the
  glass alone (one entry; *Reset*, another, undoable; also while
  running); *Drop* and *By hand* do not run it; the footprint, the maps (sharp,
  blurred, the edge, the dust) and the projection; with the real `rt.wasm`, the
  hand-set glass that the engine lays out and the parity image. Mutations (13): the
  WET1 with an extra word; motes that do not leave; the clip that moves the
  camera; without glass at 0; the list for any engine; the by-hand glass
  runs; *Reset* (running and after stopping) without the clip; a project that drops
  the clip; the velocity in world axes; without blur; the footprint without the
  focus; the track that does not grow.
- `tools/s3b-check.mjs` (Chromium and SwiftShader): *Shape* (above); the
  glass in *Fast* (the pixels change, 74,980; the meter; *From the scene*
  unrecorded, dry); rain with 6 m/s wind towards a 35 mm camera at
  f/11: *Start*, paused at 4 s with *Glass: 148 drops*, the recording in the
  inspector, the viewport draws it, *Stop* (one entry), *Reset* removes it and
  *Undo* returns it; the achromatic chrome in both themes. Captures
  `docs/ui/ambient-shape.png`, `lens-glass-fast.png` and `physics-rain.png`.
- The sheet `out/rain-dust-sheet.html` (`tools/rain-dust-sheet.mjs`, with
  `tests/rain-dust-dump.test.ts`): the sample at 28 mm f/8 with rain pushed
  by 6 m/s towards the lens at 0, 2, 5 and 15 s (about 175 drops: it fills in a couple
  of seconds and then as many run as arrive), and the lens looking 60° upwards
  under *Dust motes* (143 motes at 30 s, 522 at 120 s: not visible) and under
  the density of a windless *Dust cloud* (5,866 and 23,113: a mottled veil),
  each photo with the drawing of the glass beside it, and the photos without glass.

**What did not fit the plan.**
- **The phase split again.** S3b is the glass; the parts' side is S3c
  (below). That is why the sheet does not have the bottle under the rain (drops, trails and
  dripping on it) or the dust on the set, and `physics-rain.png` shows
  the rain on the glass.
- **Landings do not follow each particle of the effect**: the plan said to
  search for the instant at which each particle's closed-form path
  crosses the glass. An effect's region is a box around the product
  that the camera is almost never inside, and the particles wrap around in it;
  what reaches the glass is the effect's **flux** (its density times its
  velocity through the face), by Poisson. The glass receives the scene's rain
  wherever the camera is (◆ whether the region should count).
- **Physics leaves a camera looking down dry**: with vertical rain nothing
  crosses the outer face of its glass; wind towards the lens is needed (or
  looking upwards). Dust, likewise, only stays on a glass that looks
  upwards by less than 35°. For the verdict (◆).
- **The cache is the clip's track**, as in S2 (not a separate file “next to the
  project”): it goes inside the project, and the key (`wetKey`) says when the
  scene is no longer the recorded one. It is not simulated again on its own: the inspector says so
  and *Start* redoes it.
- **The clip belongs to the camera** (`target` *Camera*, all shots), with the camera's id
  in its track, and does not move it; `evaluate` leaves it out of the clips
  that move the camera.
- **The trail is not seen in the render**: on the glass it is a thin film (like
  the sheet, ideal) and what it does is take water from the drop and carry the dust away.
  The material's wetness mask (less roughness, darker for porous ones) belongs to the
  parts, S3c.
- **Dripping and splashing**: on the glass, a drop that leaves the square is gone; it
  does not fall again as a particle or splash (S3c). A drop hanging from a
  glass that looks down does not detach (S3c).
- **Snow does not feed the glass** (it would melt into drops or pile up; S3c),
  nor do bubbles (they rise) or confetti (it does not stick) (◆).
- **The dark edge in *Fast*** comes from physics (the total internal reflection of a
  ray along the axis), with no ◆; the scene upside down inside the drop is not
  drawn (*Full* and the render do it).
- **An engine without bit 7** (an earlier desktop launcher) does not receive the
  scene's glass: the render shows it clean. The inspector does not warn of it (the
  page does not know here the capabilities of the render's engine); neither does the
  *Full* meter.
- **`rt-cli` depends on `rt-phys`** to write the parity scene from the
  simulation (`rt-core`'s example cannot: `rt-phys` depends on it).
- **The image pin lives in `rt-phys/tests/wet.rs`**, not in
  `rt-core/src/render`, for the same reason; it goes through `Isa::available()` with `rt-core`'s
  public API.
- `rt-app/tests/server.rs` checked `features == 127`; now 255.

**For the verdict** (rule 11, ◆; decided in *Judgement calls*):
1. ◆ Wettability per family (`src/data/wettability.ts`): glass 70°/50°
   (mean 60°, S3's glass), plastic 90°/65°, metal 80°/50°, paper
   100°/20°, paint 85°/60°; with them the critical radius on vertical glass is
   2.1 mm of footprint (a drop of about 4 mm slides) and 3.0 mm at 30°.
2. ◆ Sliding: the drag `C = 300` (a drop 50 % above its critical
   size on vertical glass goes at about 40 mm/s), the cap of 250 mm/s and the
   trail film of 2 µm (how far a drop runs before stopping).
3. ◆ Dust: the angle of repose of 35° with its ±5° ramp, and that a vertical
   face keeps nothing (on a real glass something sticks).
4. ◆ Which effect feeds the glass and as what (`GLASS_FEED`): snow, bubbles
   and confetti, nothing.
5. ◆ Whether the effect's region should count (now rain reaches the glass
   wherever the camera is) and whether a camera looking down should get anything wet
   without wind (splashes, the photographer's hand).
6. ◆ How strongly it shows: with the presets' photographic densities, the
   *Rain* fills the glass in a couple of seconds and the *Dust motes* are not
   visible in 120 s (the *Dust cloud* is). Accept it, or an intensity knob (non-physical,
   marked as such) for the glass's dust.
7. ◆ How strong *Fast*'s approximation is: soft discs blurred
   by the real footprint; with a new project's 85 mm f/5.6, a veil (like the
   render, S3 ◆7).
8. ◆ `MAX_GLASS_SECONDS = 120`.

### S3c · Drops and dust on the parts (simulation) — **Opus** (after S3b) — done in part (the bit 7 warning; rain, dust and snow on the parts, in the engine and in *Fast*); the rest, S3d

What remains of S3 after S3b, on top of the `rt_phys::wet` model (which already does the
glass):

1. **Drops on surfaces**: the landings of rain on the
   meshes (the effect's flux over each triangle facing the rain, or the
   crossing of each particle with `rt-phys`'s BVH), the drop in the
   tangent plane of its point (the same cap, with the mesh's normal), the
   anchoring and sliding with tangential gravity (the same Furmidge, with the
   **wettability** of the material's family: `src/data/wettability.ts` and a
   table from the material's category to the family, ◆), following the surface
   from triangle to triangle; **dripping** at edges (when the curvature
   turns the normal beyond what the contact angle can hold, the drop
   becomes a falling particle again, with S4a's `rt-sim`) and **splashing**
   (secondary drops); **snow** as a layer that does not run.
2. **The wet trail as the material's mask**: a wetness channel per
   part (texels or vertices) that lowers roughness and darkens porous ones, in the
   engine (a section or a channel of M3b's program) and in *Fast*.
3. **Settled dust**: the coverage per part (texels or vertices) with S3b's
   angle of repose and the rain that cleans it where the trail passes; the
   layer in the shading and the motes where coverage is high.
4. **Cache and clip**: the drops and the coverage per frame in the `PHYSICS`
   clip (or one clip per wet part), with S3b's key.
5. **Remaining criteria** of S3: the sheet with the bottle under rain at 0, 2,
   5 and 15 s (drops, trails, dripping) and the dust on the set at 0, 30 and 120 s;
   `docs/ui/physics-rain-set.png`.

**Done (S3c: the warning and the parts' side; what remains, S3d, below).** What enters is
everything that happens **on parts** that stay still: drops one by one
on the meshes, the trail as the material's mask, dust and snow per
sample, the cache and the clip, in the engine (*Full* and the render) and in
*Fast*, and the sheet and the capture. What does not enter (the drops that fall through the
air when dripping and splashing, the dust motes, moving parts, the
studio floor) is the **S3d** proposal.

**0. The warning (first, with its test).** `core/wet.ts` `glassRendersClean`: with
the front glass on, on *From the scene*, some effect feeding it,
a camera that is not panoramic and an engine that says it lacks bit 7
(`EngineInfo.glassLayout`, which `main.ts` takes from the capabilities of the render's engine:
the native one or the pool), *Camera ▸ Lens ▸ Filters ▸ Front glass*
says *the render will show this glass clean* (`camera.glassOldEngine`, es and
en). An engine not yet known or one with the bit, nothing; *By hand*, nothing (that one is
drawn by an S3 engine). The same for what is new in this phase with bit 8
(`core/wet-parts.ts` `partsRenderDry`, the note under *On the parts*:
*the render will show them dry and clean*). `tools/s3c-check.mjs --only
warning,parts` checks it in the built application with an `rt.wasm` whose
capabilities are patched without the bit (`tools/wasm-features.mjs`, the `rt_features`
constant in place), in English and in Spanish.

**1. The simulation (`rt_phys::wet_parts`, §5.2 vicies of ARCHITECTURE).**
- **The parts** are the meshes of the visible parts that the simulation does not move, in world mm
  where they are at the start, each with the wettability of its
  material's family (◆1) and the set's as a
  **film** (without drops one by one: each sample gets wet at the instant
  drawn from the exponential of its flux; ◆6). Each triangle carries a barycentric
  **grid of samples** (cell of 1 mm at least, growing
  until it fits in 150,000 samples, ◆7; films at a third at most;
  a sliver, by its area; `R` ≤ 255).
- **Arrivals.** Each effect's flux (`density × |v| × max(0, −v̂·n)`) through
  each triangle, **if nothing is in the way** upstream (a ray
  against `v̂` through a BVH of the world's triangles): drops, by Poisson
  over the whole flux and the triangle by its share; dust and snow, as
  per-sample fields. What each effect deposits: `src/data/wet-parts.ts`
  `PARTS_FEED` (◆2).
- **Drops.** S3b's cap in the tangent plane; they **splash** above
  `K = We^½ Re^¼ = 57.7` (Mundo, Sommerfeld and Tropea 1995) throwing up to
  30 % of their water as 2 drops along the surface (◆3); they **merge** (by
  volume, incrementally: only the new or moved ones, 30 times faster than
  all against all); **anchored** by Furmidge with tangential gravity and otherwise
  **slide** from triangle to triangle across shared edges (the welded
  positions; across a fold, along it), with S3b's trail
  that wets the samples, carries away their dust and takes water from them; they **hang** from
  a face that looks down until `ρ g V (ĝ·n) > 2π a γ sin θ̄` and **drip**
  (also across an open edge): the drip falls straight to the first part below
  and settles there (at `√(2 g h)`, and may splash) or leaves (◆4); porous
  material **drinks** them.
- **Dust** `1 − e^(−k t)` since the last cleaning and **snow** as a layer
  that grows with its flux (◆5), where the face is below the angle of
  repose (dust 35°, snow 50°, ±5°) and in the open.
- **WPT1** (`core/wet-parts.ts` `wptBytes`) and, per frame, the record
  (`WetParts::frame`: the new or changed drops **by number**, those that
  left, the samples wetted and cleaned, the drips). The page joins it into the
  **parts track** of a `PHYSICS` clip of the **scene** (the cache,
  with the key `wetPartsKey`), which `partsFrame` rebuilds at any frame.
  `rt.wasm` exports `wpt_*`. In the worker it runs with the bodies and the glass
  (the same steps) or alone, and does not stop by itself (*Stop* or 120 s,
  `MAX_PARTS_SECONDS`).

**2. In the engine (`WETP`, bit 8).** `rt_core::weather`: one `WETP` section per
wet instance with each sample's three bytes (wet, dust, snow) and
its drops (§5.2 vicies). A hit reads them linearly over its small triangle of the
grid; on top of the material (with patterns, program and textures) go the
**dust** (a matte brownish grey, darker when wet), the **water film** (a
transparent layer of roughness 0.03 over everything, and porous material darker: the
albedo to the power `1 + wet × porosity`, Lekner and Dorf 1988) and the
**snow** (white and matte, `1 − e^(−h / 0.5 mm)`) (◆8); the **drops** are
water caps (index 1.333; 16 × 4) in one more mesh, instance and material,
after those in the file, which shadows cross like a thin wall of water
(a drop does not cast a black disc). Where there is nothing, the material is not touched:
the image does not change a bit (test). Bit 8, `FEATURE_WET_PARTS` (256;
`/api/info` says 511); the page sends `WETP` only to an engine with it
(`SceneView.wetParts`), from the *pose* frame (`Pose.parts`).

**3. In *Fast*** (`render/weather-preview.ts`). The wet parts are
drawn with a copy of their unindexed geometry and of their materials with a
patch that reads the frame's samples (two data textures,
`texelFetch`) like the engine and puts the same layers with the same numbers; the
drops, one instanced cap per drop. The meter: *Rain on the parts:
1,443 drops on 7 parts*.

**4. The interface.** *Ambient*: the **On the parts** switch (one
undo entry, saved with the effect, `AmbientEffect.wetParts`) on the
effects that leave something, with its help per class; the physics bar: *Parts:
N drops · M drips*; the scene's clip on the timeline (*The parts
receive the rain, dust and snow of the scene's effects, according to the
simulation*), which *Reset* removes. Strings in es and en.

**5. Pins** (§5.2 vicies). New: `PINNED_WET_PARTS = 0x62450071` (the
parity parts of `rt_phys::example::parts_spec` after 5 s: a glass bottle, a
plastic plate at 45°, a metal shelf at 20° and a paper card as a film, under rain with wind, dust and snow) and
`PINNED_S3C_WET_4SPP = 0x66fa33ab` (`s3c_wet_scene`, with its `WETP`): the same
in scalar, SSE2 and AVX2, with 1, 4 and 16 threads, in scalar and
simd128 `wasm32-wasip1` (`cargo test -p rt-phys --test wet_parts`, new in CI) and in the
real `rt.wasm` (`tools/wasm-parity.mjs`, also with the passes;
`tests/s3c-parts.test.ts` in the CI step of the real `rt.wasm`). `rt
--write-s3c-wet-example` and `--write-s3c-parts-spec`
(`tests/fixtures/s3c-wet.rsb`, `s3c-parts.wpt1`). **No earlier pin
moves.** `rt-app`: `/api/info` says 511.

**Tests** (each checked with its mutation: change it, the test fails, and
it passes without it; those that survived the first pass were closed with a
stricter test):
- `rt-phys/tests/wet_parts.rs` (17): WPT1 goes and comes back and a broken one is rejected;
  the samples cover each triangle, fit in the budget, a sliver
  spends by its area and a film fits in its third; glass at 30° stays
  until Furmidge's critical radius (± 0.5 % of the `f64` calculation) and slides
  above it losing in the trail the 2 µm film it should; a drop
  crosses from face to face and drips across an open edge; merging adds the volume
  (± 1 %); the trail cleans dust and rain leaves less; dust at 60° <
  10 % of the horizontal, at 30° the cosine, looking down nothing, under a roof
  nothing; rain arrives at its flux (± 4σ), never at a face that looks the other
  way nor under a roof; a hanging drop drips on weighing what it should and falls
  on what is below (it splashes from 44 mm, not from 12 mm); a fast drop
  splashes without losing water; a film gets wet at its rate; snow piles up
  where it rests; the same parts by steps and rebuilt from their frames by
  number; the two pins; a `WETP` with nothing does not change a pixel, only
  the values or only the drops change the image, and an update without `MESH`
  three times in a row leaves 5 meshes. Mutations: half hysteresis; without merging;
  the trail that does not clean; without angle of repose; without looking at what is in
  the way; hanging with twice the grip; the drip that does not settle; the water
  lost uncounted; the film's area without π; the snow without its angle; not
  crossing edges; the wet log not emptied; without dripping across the edge; the
  trail without film (survived: the lost film was added); the drip at
  velocity 0 or 10 times (survived: the 12 mm case without
  splashing was added); the ids of departed drops not noted; no limit by area; the
  film with the whole budget. The flux with `|cos|` instead of the face
  is only killed by the pin: almost equivalent, because the back face is covered
  by the part itself.
- `rt-core` (`weather::tests`, 5): the `WETP` goes and comes back and a broken one is
  rejected; a hit blends the samples of its small triangle; nothing on top does not
  touch the material and each layer changes it; a cap is the part of its sphere
  above the surface; a drop is meshed on its part and lets
  light through. Mutations: the
  writer without `WETP`; the layers ignored; the caps that do not let the
  shadow through; the update that does not remove the old caps (survived:
  the update without `MESH` was added); the top small triangle unused.
  `rt-wasm`: the parts registry is the native one. `rt-cli`: the scene with 1, 4
  and 16 threads, the two `--write-*` and the comparison with the fixtures.
- `tests/s3c-warning.test.ts` (4): bit 7 (when it warns and when not: dust
  yes, snow no, off, *By hand*, the effect off, panoramic, unknown
  camera) and bit 8; the strings, the inspector and `main.ts`. Mutations
  (8): for bit 7, an unknown engine warned; without looking at the effects that feed
  it; without looking at *From the scene*; without looking at the panoramic; `main.ts` without
  the bit; the inspector not looking at it when the engine changes; for bit 8, an unknown
  engine warned; without looking at the effects.
- `tests/s3c-parts.test.ts` (17): the table (wood and cloth added; plastic,
  metal, paper and snow, the engine's); a material's family by its
  category or its recipe; what each effect deposits; only an effect with the
  switch falls, and is saved; the visible still parts, where they are, with
  their family, and the sources; the set, film; the WPT1 byte for byte with the engine's; the track rebuilds each frame (drops by number, wet, dust
  since the last cleaning); a group of faces takes its samples in its order;
  the *pose* gives the frame also at 0 and the clip moves nothing; `WETP` per
  instance only for bit 8; saved and opened, a broken track is removed;
  the bar runs the parts alone (one entry; *Reset*, another,
  undoable), *Drop* and the effect without the switch do not; a
  *Dynamic* part does not get wet where it was; with the real `rt.wasm`, the pin of the
  parts, two runs with the same track, its last frame is the time
  of the native engine (± 1 of the dust byte) and the pinned image. Mutations (8):
  the cleanings ignored; the wet frame shifted by one; `WETP` without the
  bit 8; an empty `WETP` written; the parts that move wet
  (survived: the *Dynamic* test was added); the metal recipe as
  paint; a broken track saved; the *pose* without parts.
- `tools/s3c-check.mjs` (Chromium and SwiftShader): the two warnings (above); the
  sample's rain with 3 m/s wind and *On the parts* (one undo
  entry): *Start*, paused at 3 s with *Parts: 1,443 drops · 0
  drips*, *Fast*'s meter with the drops, 334,891 pixels change,
  *Stop* (one entry), *Reset* removes it and *Undo* returns it; the achromatic
  chrome (the switch too) in both themes. Capture
  `docs/ui/physics-rain-set.png`.
- The sheet `out/rain-dust-sheet.html` (`tools/rain-dust-sheet.mjs`, with
  `tests/rain-dust-dump.test.ts`) adds three rows: the sample bottle on
  the *Fragrance* set, at 28 mm f/8, with the particles hidden to the
  camera, under windless *Rain* at 0, 2, 5 and 15 s (691, 618 and 690 drops; 9
  drips at 15 s; 18, 28 and 52 % of samples wet), under
  the density of a windless *Dust cloud* at 0, 30 and 120 s, and under *Snow* at 0,
  10 and 30 s, each photo the `rt` render of the scene with the recorded frame's
  `WETP`s.

**What did not fit the plan.**
- **The phase split again.** The drops that drip and splash do not become
  falling `rt-sim` particles again: the drip falls straight and settles
  in the same step, and the splash throws its drops along the surface. The dust
  motes where coverage is high are not there (only the layer). S3d.
- **Moving parts do not get wet**: a *Dynamic* one would get wet where
  it was at the start, so it is left out. S3d.
- **The studio floor** (the `z = 0` plane, which is not a mesh) does not get wet;
  the set's floor does (it is a part). S3d.
- **Samples per triangle, not texels or vertices**: a barycentric grid
  per triangle, independent of the UVs (many parts have none) and of how fine the mesh is.
  A large triangle of a set (2 triangles of 700 mm in a
  card) stays in a cell of about 10 mm with the page's budget,
  and the edge of a snow or dust shadow on the set is seen in steps
  in the sheet; the bottle, at 1 mm. A grid that follows the shadow, or splitting the
  large triangles, in S3d (◆7).
- **Landings are the flux, not each particle of the effect**, as on the
  glass (S3b): the effect's region does not limit where it rains (◆, like S3b ◆5).
  The *Ambient* particles still go through the parts in the image.
- **The clip belongs to the scene** (`target` *Scene*), one per simulation, not one
  per part; it moves nothing.
- **The drops are a separate instance** in the part and material passes
  (the one after those in the file), not their part's.
- **Snow does not feed the glass** (S3b ◆4, decided: it deposits nothing); on the
  parts it does, as a layer.
- **The meter says *Rain on the parts*** even when there is only dust or
  snow (with 0 drops).
- `rt-app/tests/server.rs` checked `features == 255`; now 511.

**For the verdict** (rule 11, ◆; decided in *Judgement calls*):
1. ◆ Each material's family (`wettabilityFamilyOf`): the categories
   *Metal*, *Plastic*, *Glass* (and an emitter, as glass), *Wood* and *Cloth*
   their own; the others by their recipe (metallic ≥ 0.5 as metal, the rest as
   paint). The new families: wood 85°/40°, drinks 0.01 mm/s, porosity
   0.6; cloth 110°/40°, 0.5 mm/s, 1; paper drinks 0.05 mm/s with porosity 1;
   the others neither drink nor darken.
2. ◆ What each effect deposits on the parts (`PARTS_FEED`): rain and water
   drops, drops; motes, pollen, dust cloud and ash, dust; snow, snow;
   bubbles and confetti, nothing.
3. ◆ The splash: up to 30 % of the water (from nothing at the threshold to all of that
   at double), 2 drops, thrown up to 4 diameters; the impact wets 2 diameters.
4. ◆ The drip: the grip of a hanging drop (`PENDANT_HOLD = 1`), and that the
   drip falls straight and settles at once.
5. ◆ Snow: its angle of repose (50°), the packing (half the layer
   is flakes) and its look (albedo 0.9, roughness 0.85, covers 63 % at 0.5 mm;
   the byte reaches 5.1 mm).
6. ◆ The set's parts as a film (`SET_PIECES_AS_FILM`).
7. ◆ The budget: the 1 mm cell, 150,000 samples (films a
   third), `MAX_PARTS_SECONDS = 120` and 4,096 drops at most.
8. ◆ How dark and how bright the wet look is: the film with roughness 0.03, the
   porous albedo exponent `1 + wet × porosity`; the dust (albedo 0.42,
   0.39, 0.35; roughness 0.9) and its darkening when wet.
9. ◆ That what is sheltered (under a roof, behind the bottle with respect to the
   wind) stays completely dry: it is the physics, with no splashes from the floor or
   bounces.

### S3d · What remains of drops and dust on the parts (simulation) — **Opus** (after S3c) — done in part (the meter, the drops' part id and the drops through the air, in the engine and in *Fast*); the rest, S3e

What remains of S3c, on top of `rt_phys::wet_parts`:

1. **Drops through the air**: a drip and the drops of a splash become
   falling particles again (with S4a's `rt-sim`, or a closed-form path of
   their own), drawn in *Full*, in the render and in *Fast* while
   they fall, and settling where they land (or leaving); the drip stops settling in the
   same step.
2. **The dust motes** where coverage is high (grains over the layer,
   in the engine and in *Fast*).
3. **Moving parts**: the *Dynamic* ones get wet where they are in each
   frame (the samples in the part's space, its pose of the step) and their
   drops move with them.
4. **The studio floor**: the `z = 0` plane gets wet and dusty (puddles,
   a drip trail), as a part or as a section of its own.
5. **Fine samples where needed**: splitting the set's large triangles
   or a grid that adapts to shadow edges, so that the edge of
   snow and dust on a set is not seen in steps (S3c ◆7).
6. **The passes**: the drops with their part's id in the part and
   material passes.
7. **The meter**: what is really there (drops, dust or snow) instead of
   *Rain on the parts* always.
8. **Criteria**: the sheet with dripping in the air and dust with its motes;
   a capture of a *Dynamic* part that gets wet as it falls.

**Done (S3d: the meter, the drops' part id and the drops through the air; what
remains, S3e, below).** Points 7, 6 and 1 of the proposal go in, in that
order: the meter text, the drops with their part's id in the passes, and the
dripping and splashes that become drops falling through the air again, in the
simulation, in the engine (*Full* and the render) and in *Fast*. Points 2 to 5
(the dust motes, moving parts, the studio floor and the fine samples on the
set) are each the size of a phase and do not fit in this PR without lowering
the quality: they are the **S3e** proposal, together with what remains of
point 8.

**1. The meter (first, with its test).** `core/wet-parts.ts` `partsShown` says
what the frame has on the parts the viewer draws: whether there is rain (a
wet sample, a drop on a part or in the air), dust or snow, on how many parts
(those that have something, not those that are drawn), and the drops on them
and in the air; `ui/sentence.ts` `partsMeterText` says it: *Rain and dust on 4
parts: 1,443 drops, 12 in the air*, *Dust on 3 parts* (without mentioning
drops), *Snow on 2 parts*, and *Nothing on the parts yet* before anything
settles (keys `status.partsOn.*` and `status.partsDrops`, es and en;
`status.partsWeather` goes). The physics bar adds those in the air: *Parts: N
drops · M drips · K in the air* (`phys.parts`).

**2. The drops with their part's id (with its test).** `Scene::pass_instance`:
for the part and material passes, a hit on the caps' instance gives the
instance the drop is on (`Scene::cap_owners`, one per cap in mesh order, and
`Caps::caps`, how many caps go first), and for a drop in the air the instance
it came from; `first_hit` uses it, so the `partId` and `materialId` of a pixel
over a drop are those of its part, and the page (`passInstances`) takes them
to its node. The image does not change: S3c's earlier fixture renders with the
new engine to its earlier pinned hash (`0x66fa33ab`).

**3. The drops through the air (`rt_phys::wet_parts`, ARCHITECTURE §5.2
unvicies).**
- **A drip** (the hanging drop that weighs more than its contact line holds,
  or the one that slides across an open edge) **and the drops of a splash**
  are spheres of their volume **in the air**, with their velocity: the hanging
  drip starts from rest; the one that leaves across an edge, at the speed it
  was sliding, along its last stretch (◆4); those of a splash, lifted off the
  surface at `SPLASH_ELEVATION_DEG = 30°` (◆3) in the direction S3c already
  drew, at the speed that on a horizontal face would carry them to the drawn
  reach (`v = √(R g / sin 2θ)`, `R` from 1 to `SPLASH_REACH = 4` diameters:
  the reach decided in S3c ◆3, now as a flight).
- **Each step** (before the arrivals from the sky, so nothing settles in the
  step it leaves): gravity and air drag, quadratic so that a drop falls at
  most at its **terminal velocity** (`terminal_speed`: Atlas, Srivastava and
  Sekhon 1973, `9.65 − 10.3 e^(−0.6 D)` m/s above 0.6 mm, and a straight line
  down to 0 below; ◆2), with the step's acceleration held through it (exact
  with gravity alone: the splash's reach does not fall short by a step); the
  step's segment is cast against the parts' BVH and **the first face it meets
  from the front** (`n·v < 0`) **receives it**: an impact with the velocity
  along its normal, which wets its circle, may splash again (and its drops fly
  from the next step) and stays as a drop (or wets the film of a set part).
  Below the lowest part and the studio floor (`z = 0`), or after
  `MAX_FLIGHT_STEPS = 2400` steps (10 s), it leaves (the lost water); at most
  `MAX_FALLING_DROPS = 1024` at a time (◆6).
- **The record**: each frame carries at the end the drops in the air in full,
  by number (`u32 falling; (u32 id part; f32 x y z r)`, the world position and
  the radius of their sphere; they have numbers of their own, from the same
  count as those on the parts), `WetParts::falling`, `falling_velocities`,
  `water_in_air`, `landed_from_air`, `add_falling`; the `hash` includes them.
- In the parity scene at 5 s: 1,951 drops on the parts and **70 in the air**,
  8,839 arrivals from the sky, 7,079 splashes, 5 drips and 13,943 drops
  settled from the air; 15,987 wet samples; 8,516 mm³ on the parts, 10.7 in
  the air, 10.9 in the trails and 62.4 lost (S3c: 1,834 drops, 8 drips,
  16,010 samples, 8,479, 13.3 and 68.6).

**4. In the engine (`WETF`, bit 9).** `rt_core::weather`: `FallingDrop` (the
instance it came from or `NO_INSTANCE`, the centre in the world, the radius)
and the **`WETF`** section, one per scene after the `WETP`s: `u32 drops; (u32
instance; f32 x y z radius)[drops]` (`decode_falling`, `encode_falling`,
`check_falling`: a missing instance, a radius outside 0..50 mm, more than
4,096 or two `WETF`s invalidate the file). `Scene::set_wet_falling` meshes
them as **water spheres** (12 × 6, `SPHERE_SEGMENTS`, `SPHERE_RINGS`) in the
same mesh, instance and material as the caps, after them (`water_mesh`), with
the same straight shadows (a drop in the air does not cast a black disc). Bit
9, `FEATURE_WET_FLIGHT` (512; `/api/info` says 1023): the engine draws `WETF`
and gives a drop its part's id in the passes; the page writes `WETF` only for
an engine with it (`SceneView.wetFlight`, `readsWetFlight`), with each drop on
the first instance of the part it came from (those of a part that is not
drawn are left out, like its weather). An S3c engine skips the section: it
draws the wet parts but not what falls, and the note *drips and splashes will
show only once they land* (`ambient.wetFlightOldEngine`, `core/wet-parts.ts`
`partsRenderNoFlight`: with bit 8 and without bit 9, for a drops effect) says
so under *On the parts*.

**5. In the page.** The parts track stores, per frame, its drops in the air
(`PartsTrack.falling`, base64; `PartsFrame.falling`); an S3c track, without
them, is still read (with no drops in the air), and the format version goes to
2 (`PARTS_FORMAT_VERSION`: the `wpt2:` key; the simulation is no longer S3c's).
**In *Fast*** (`render/weather-preview.ts`) one instanced sphere with the caps'
water per drop in the air, where the engine has it (the `modelRoot`'s space),
for the parts that draw their weather.

**6. Pins** (§5.2 unvicies). **New**: `PINNED_S3D_FLIGHT_4SPP =
0xf7b78a45` (`rt_phys::example::s3d_flight_scene`: S3c's scene with its
`WETF`, the 70 drops in the air at 5 s) and its six passes
`PINNED_S3D_PASS_ALBEDO = 0x38681bb3`, `_NORMAL = 0x45b8b9a8`, `_DEPTH =
0x2a0c1589`, `_PART_ID = 0xde2688e3`, `_MATERIAL_ID = 0xde2688e3` (in this
scene instance `k` carries material `k`: the two planes are equal) and
`_COC = 0x14b5c1e9`: the same in scalar, SSE2 and AVX2, with 1, 4 and 16
threads (`rt-cli`), in scalar and simd128 `wasm32-wasip1` (`cargo test -p
rt-phys --test wet_parts`) and in the real `rt.wasm` (`tools/wasm-parity.mjs`
with `rt --write-s3d-flight-example`, the image alone and with the six passes;
`tests/s3d-flight.test.ts` with `tests/fixtures/s3d-flight.rsb`, in the CI step
of the real `rt.wasm`). **Moved, on purpose**: `PINNED_WET_PARTS`
`0x62450071` → `0xe1811f7e` and `PINNED_S3C_WET_4SPP` `0x66fa33ab` →
`0x827ac33c`. The first is the simulation itself: drips no longer settle at
once and splashes fly instead of their drops sliding along the surface, so at
5 s the drops, the wet samples and the water are not S3c's, and the `hash`
also counts the drops in the air. The second is only a consequence of the
first: `s3c_wet_scene` carries the `WETP`s of that simulation; with S3c's
`tests/fixtures/s3c-wet.rsb`, the new engine gives the earlier `0x66fa33ab`
(checked), so the engine does not change the image of a `WETP`.
`tests/fixtures/s3c-wet.rsb` was remade with `rt --write-s3c-wet-example`; the
WPT1 (`s3c-parts.wpt1`) does not change. **No other pin moves.** `rt-app`:
`/api/info` says 1023.

**Tests** (each checked with its mutation: change it, the test fails, and it
passes without it):
- `rt-phys/tests/wet_parts.rs` (21; 4 new and 3 remade): a hanging drop drips
  on weighing what it should, **is in the air** and not on the floor right
  after, falls (each step lower, from the part it left, with the radius of its
  volume) for about 23 steps (`√(2 h / g)` of 44 mm) and settles, splashes, and
  its two drops fly from the next step and settle too, without losing water; a
  2 mm drop released at 20 m reaches its terminal velocity (± 1 %) and never
  exceeds it (Atlas at 2 mm: 6.55 m/s; below 0.6 mm, the straight line) and
  one that finds no part leaves below the floor with its water counted; a
  2.5 mm drop at 9 m/s on a pad throws its two drops into the air (none
  settles in the step it splashes), they fly and rise, and each settles
  separately between 1 and 4 diameters away (S3c ◆3's reach); under fast rain
  the water is conserved counting the water in the air; the frames list the
  drops in the air in full, by number, with numbers of their own, equal to
  `falling()`; the parity parts have drops in the air; the S3d scene, through
  RSB, in scalar, SSE2 and AVX2 (and different from S3c's); the six passes,
  with no pixel carrying the caps' instance and each pixel of a drop with the
  id and material of a part. Mutations: the drip that settles at once (S3c's);
  without drag; never leaving below the floor; the frame without those in the
  air; the splash along the surface (S3c's); the `hash` without those in the
  air (only the pin kills it); the back face that also receives (only the pins
  kill it: in the parity parts there are plates with something on top).
- `rt-core` (`weather::tests`, 2 new): `WETF` goes and comes back (a newer
  writer's tail is ignored) and a broken one, or one with a missing instance,
  is rejected; a drop in the air is a sphere of its radius after the caps, in
  the same instance, which shadows cross, and `first_hit` gives the sphere the
  part it came from, the one with no owner the caps' instance, and the cap its
  part's; removing them leaves the cap. Mutations: `first_hit` with the caps'
  instance (also killed by `rt-phys`'s passes test); without spheres; the
  spheres without an owner; the cap count at 0; the writer without `WETF`
  (killed by the round trip of the S3d scene). `rt-cli`: the S3d scene with 1,
  4 and 16 threads and its `--write-*`. `rt-wasm` and `rt-app`: bit 9.
- `tests/s3d-flight.test.ts` (9): the track stores each frame's drops in the
  air by the part they left, a record without them or from a missing part is
  rejected, and a cut list is not a track; an earlier track is read without
  them and the key is `wpt2:`; the meter's words (nothing yet, dust, snow, dust
  and snow, a film is rain, rain and dust with the drops and those in the air,
  all three together in Spanish, rain and snow; those in the air alone are
  already rain) and that it counts the parts it draws; the strings in es and
  en; `WETF` only with bit 9, each drop on the first instance of its part (the
  track in a different order from the instances), byte for byte and after the
  `WETP`s, those of a hidden part left out; *Fast* draws one sphere per drop in
  the air where the engine has it, and none without them; the bit 9 note (yes
  with bit 8 without 9 and rain; no with the bit, unknown, without bit 8, with
  dust or without the switch); with the real `rt.wasm`, the parity parts' last
  frame has the drops in the air of the native `WETF` and the S3d scene gives
  its image and pass pins. Mutations (9): the writer without those in the air;
  a track without them rejected; the meter that always says rain; the parts
  counted whether they have something or not; `WETF` without bit 9; a drop's
  instance as its part index (survived: the track in a different order was
  added); no spheres in *Fast*; the note with dust too; the bar without those
  in the air (killed by `tests/s3c-parts.test.ts`).
- `tests/s3c-parts.test.ts`: the page's record with its tail of drops in the
  air, the new strings, the bar with those in the air.
- `tools/s3d-check.mjs` (Chromium and SwiftShader): the note for an engine
  without bit 9 in English and in Spanish (and none with this build's engine
  or with dust); the sample's rain with 3 m/s wind, paused with drops in the
  air (*Parts: 875 drops · 0 drips · 62 in the air*, *Rain on 7 parts: 875
  drops, 62 in the air*), and the capture; the *Dust cloud* on the parts says
  *Dust on 6 parts* without mentioning drops; the note's achromatic chrome in
  both themes. `tools/s3c-check.mjs --only rain,parts` passes with the new
  words (after *Undo*, at frame 0, *Nothing on the parts yet*).

**Captures.** `docs/ui/physics-rain-air.png` (`tools/s3d-check.mjs --only
air`): the sample's rain with 3 m/s wind on the parts, paused with drops in
the air, and the new meter. The sheet `out/rain-dust-sheet.html`
(`tools/rain-dust-sheet.mjs`, with `tests/rain-dust-dump.test.ts`) now also
writes the `WETF` of each photo of the parts and says how many drops are in
the air: the bottle under windless rain has 34, 36 and 37 at 2, 5 and 15 s
(656, 604 and 616 on the parts; 5 drips at 15 s), almost all splashes that fly
a couple of millimetres.

**What did not fit the plan.**
- **The phase split again.** The dust motes, moving parts, the studio floor
  and the fine samples on the set (points 2 to 5) are S3e. The capture of a
  *Dynamic* part that gets wet as it falls and the dust sheet with its motes
  (point 8) go with them.
- **`rt-sim` was not needed**: the drops in the air are few and are born in
  the parts simulation, so their path is its own (one step with the held
  acceleration, against the same BVH), not S4a particles.
- **The studio floor does not receive them**: a drop that reaches `z = 0`
  with no part below leaves, as in S3c; the floor that gets wet is S3e.
- **A drop in the air that hits the back face of a part goes through it** (a
  thin plate seen from below): S3c's samples are only on the front face and a
  hanging drop only exists on it (◆5).
- **The wind does not push the drops in the air**: the drag is against still
  air (almost all fall in the shelter of the part they leave; ◆2).
- **No streak or motion blur**: the engine has no shutter; a drop in the air
  is a sphere standing still at its place in the frame (◆1).
- **The drops' part id belongs to bit 9**: an S3c engine still gives the drops
  the caps' instance; the bit 9 note does not say so (*Full*'s meter shows no
  passes).
- **The earlier track is not remade by itself**: S3c's is still read (with no
  drops in the air), but its key (`wpt1:`) is no longer that of the current
  simulation.
- `rt-app/tests/server.rs` checked `features == 511`; now 1023.

**For the verdict** (rule 11, ◆; decided in *Judgement calls*):
1. ◆ How a drop in the air looks: a water sphere of its volume (12 × 6),
   without a streak, without flattening and without motion blur; in *Fast*,
   the same sphere with the caps' water.
2. ◆ The air: Atlas, Srivastava and Sekhon's terminal velocity above 0.6 mm
   and a straight line below, the quadratic drag, and that the effect's wind
   does not push the drops in the air.
3. ◆ The splash into the air: the 30° elevation and the speed that gives, on
   a horizontal face, the reach decided in S3c ◆3 (a drop from a 2.5 mm one
   flies for 4 to 8 steps and rises at most 1.5 mm).
4. ◆ The drip across an edge leaves at the speed it was sliding; the hanging
   one, from rest.
5. ◆ What reaches the studio floor or the back face of a part: it leaves, or
   goes through it.
6. ◆ The caps: `MAX_FALLING_DROPS = 1024` and `MAX_FLIGHT_STEPS = 2400` (10 s).
7. ◆ The meter's words: what there is (rain, dust, snow), on how many parts
   (those that have something), the drops and those in the air; *Nothing on
   the parts yet*.
8. ◆ That in the passes a drop in the air is the part it came from (and not
   none).

### S3e · Dust motes, moving parts, the studio floor and the set's fine samples (simulation) — **Opus** (after S3d) — proposed

What remains of S3d, on top of `rt_phys::wet_parts` and `rt_core::weather`:

1. **Moving parts** (S2's *Dynamic* ones). The parts simulation runs in the
   same loop as the bodies (`render/physics-worker.ts`): the WPT1 marks each
   dynamic part (a `PART_MOVING` bit in `flags` and its body's index, in a
   version 2 of the format) and each step `WetParts::step` receives the
   bodies' poses; the samples and the drops live in their part's space, and
   the flux, what is in the way (the per-part ray BVH, with its transform) and
   the tangential gravity are taken with the step's pose, and a drop on the
   part also feels the body's acceleration (◆). The per-frame record does not
   change (the drops already go in object space); the part's `WETP` follows
   its instance, which the part's clip already moves. Acceptance: a capture of
   a *Dynamic* part that gets wet as it falls, and the test that a part that
   does not move gives the same bits as in S3d.
2. **The studio floor** (`z = 0`, which is not a mesh). An implicit film part
   in the page (a square under the product the size of the effects' region,
   ◆), with its regular XY grid, that receives the rain, dust, snow, drips and
   drops in the air that reach it (puddles: ◆ whether drops merge on the
   floor); in the engine a new section (`WETG`: the grid's origin, step and
   size and the three bytes per cell) that the `FLOR` shading reads like
   `weather`'s layers (also in shadow-catcher mode, ◆), with a new bit (11: S3f took 10); in
   *Fast*, the same patch in the floor material. Acceptance: the sheet with the
   wet floor under the bottle and its drip trail.
3. **Fine samples on the set.** Either split the films' large triangles in
   the simulation (their children share the samples and the `WETP` stays with
   the mesh triangle: a two-byte `resolution`, in a version 2 of `WETP` with
   its bit), or a per-area sample budget in the open that spends more where
   the shadow changes; acceptance: the edge of the snow and dust shadow on the
   sheet's set card at 2 mm or less, without steps (S3c ◆7).
4. **The dust motes** where coverage passes a threshold (◆): grains the size
   of the effect placed by a per-sample seed, in the engine (a mesh of motes
   after the caps, like the drops, or the particles of
   `rt_core::geometry::particles`) and in *Fast* (instances), with their
   colour and size (◆). Acceptance: the dust sheet at 30 and 120 s with its
   motes.
5. **The wind on the drops in the air** (S3d's judgement call): the drip
   and the splash drops that fly (`WETF`) feel the effect's wind as a drag
   towards its velocity, with the same terminal-velocity law. Acceptance:
   the drops that leave a part under a side wind land downwind, and without
   wind the S3d bits do not change.
6. **A drop that runs along a side edge** (S3f's judgement call): at a side
   edge of a tilted face, a drop whose weight along the edge beats its hold
   runs along it instead of stopping; the lowest edge still holds and lets
   go from rest. Acceptance: on a tilted plate, the drops that reach a side
   edge run down it and gather at the lowest corner.
7. **Acceptance criteria** that remain: the three sheets and the capture
   above.

### S3f · Organic drops — **Opus** (after S3d) — done

The owner's request (2026-10-18): *"Rain drops that accumulate on a part
should, once they reach a certain size, fall like a real drop, merging with
the next drop in an organic way."* On top of `rt_phys::wet_parts` (S3c, S3d),
`rt_core::weather` and *Fast*.

**Audit of what existed (what was already right).**
- **Growth to the critical size was already right.** A landing is a new drop
  that merges with every drop it touches (by volume, at the centre of mass),
  so a drop that keeps receiving rain grows; it stays pinned while Furmidge's
  balance holds, `ρ g V sin α ≤ 2 γ a (cos θ_R − cos θ_A)`, the critical size
  of its tilt and of its part's wettability, and slides past it. The S3c test
  (glass at 30°, ± 0.5 % of the `f64` radius) already pinned it; S3f adds the
  growth itself (below).
- **Sliding** already grew faster with the volume (`v = excess / (C μ a)`),
  left a trail (wet samples, the dust wiped, a 2 µm film of its water) and
  merged with what it touched **where it stopped** each step.
- **Not there:** the merge put the survivor at the centre of mass at once (a
  jump of up to half the distance between the two); no drop had a shape (round
  caps everywhere, in the engine and in *Fast*); no rivulet; a hanging drop
  past its hold dripped whole, and a drop that slid to an open edge ran off it
  as a drip.

**1. Growth and letting go.** Unchanged physics, now tested as growth: drops
of a fortieth of the critical volume fed onto one point of glass and of
plastic at 20°, 45° and 90° merge into one that does not move while its
volume is below 0.985 of the critical one and slides past 1.05 of it.

**2. Gathering (the coalescence cascade).** The merge looks along the
**segment each drop swept** in the step (`Drop::from` → `p`), so a sliding
drop takes every drop it crossed and none beside its path. **A merge conserves
the volume** (the sum, in `f32`) and **does not teleport**: the survivor (the
lower number, as before) stays where it was and its centre relaxes to the
volume-weighted centre of the two (the centres they were themselves relaxing
to count) by `1 − e^(−Δt/τ)` a step, `τ = MERGE_TIMES × √(ρ a³ / γ)` (◆4,
a few capillary times: about 10 steps for a 2 mm drop); below 1 % left the
merge is over. It grows as it runs, and so runs faster (Furmidge's excess
grows as `a³` against a hold that grows as `a`).

**3. Rivulets and the continuous run.** A sliding drop has Cox and Voinov's
dynamic contact angles (`θ_f³ = θ_A³ + 9 Ca Λ`, `θ_r³ = θ_R³ − 9 Ca Λ`,
`Ca = μ v / γ`, `Λ = COX_VOINOV_LOG = 12`, ◆): when its rear angle falls
below `RUN_REAR_SHARE = 0.8` of the receding one (a large drop on a steep
face: glass from about 215 mm/s) it becomes a **continuous run** and leaves
behind it, every `RUN_BEAD = 3` widths of `RUN_WIDTH = 0.2` of its own width
(◆5), a bead of the rivulet: a drop of that footprint, elongated along the path
(aspect 3), its water taken from the runner, which relaxes into a small round
pinned drop over `RUN_RELAX_TIMES = 60` capillary times (◆5) and is gathered by
the next drop down the same path. The trail of S3c (wet samples, wiped dust, the
film) goes on as before.

**4. Shapes (`DropShape`, 15 floats).** Driven by the drop's physics
(`wet_parts::base_shape`, `WetParts::shapes`):
- **pinned on a slope:** along the downhill axis, its front angle moves from
  the mean towards the advancing one and its rear towards the receding one by
  its load (the weight along the face over the hold, 0..1); its top is sheared
  downhill by `q tan(θ̄/2) / tan θ̄`, `q = (θ_f − θ_r) / (θ_f + θ_r)` (the
  shear of a cap whose front and rear slopes are those angles, small-slope
  limit), and it is longer by `PIN_STRETCH × (cos θ_R − cos θ_A) × load`
  (◆1): it bulges downhill;
- **sliding:** along its velocity, the same shear with the dynamic angles,
  longer by `SLIDE_STRETCH` and thinner at its tail by `SLIDE_TAPER` as its
  rear angle falls from the receding one to 0 (◆1: the corner of Podgorski,
  Flesselles and Limat 2001), at most `MAX_ASPECT = 4`;
- **merging:** along the line between the two, its outline first spanning
  both (`merge_along`, `merge_across`, off its centre by `shift`) with a neck
  `NECK_DEPTH × r_small / r_big` deep (◆2), all relaxing with the merge;
- **hanging:** stretched along gravity by `1 + HANG_SAG × (load + pinch)` and
  pinched under its contact line by `HANG_PINCH × pinch` (◆1, ◆3).
The shape is monotonic in speed and tilt (tested), continuous where a pinned
drop lets go (load 1 is speed 0), and every deformation keeps the volume of a
paraboloid cap exactly (area-preserving stretches, an odd taper, a shear, and
the height compensated for the merge's footprint and neck, `35/48` of the
neck's depth, and for the hanging pinch).

**5. Hanging and dripping.** A drop under a face that looks down, or **held at
an open edge** (a sliding drop now stops at the open edge it reaches and hangs
there, instead of running off as a drip), hangs while `ρ g V (ĝ·n)` (the whole
weight at an edge: Tate's law) is at most `2π a γ sin θ̄`; past it, it necks for
`PINCH_TIMES = 3` capillary times (◆3) and lets go of `PINCH_OFF_SHARE = 0.6`
of its water as **one drop in the air** (S3d's flight, from rest), the rest
staying where it hung to grow again (Harkins and Brown 1919: about 60 % of a
pendant drop falls). Below its hold, a neck that began relaxes.

**6. In the record, the hash and the engine.** Each frame ends with the shapes
of its changed drops (`u32 shaped; f32 shape[15][changed]`, axes in the part's
object space; a drop whose shape changes is changed); `WetParts::hash` eats the
state that makes them. **`WETP` with a shape tail, bit 10**
(`FEATURE_WET_SHAPES = 1024`, `/api/info` says 2047): after the drops,
`"SHP1"`, `u32 count` (= drops), `f32 shape[15][count]`; a tail with that tag
that does not fit invalidates the file, other trailing bytes are still ignored.
`rt_core::weather::shape_point` deforms the cap in its tangent frame; a section
with a tail is meshed with `SHAPED_CAP_RINGS = 8` rings (16 × 8, 240 triangles a
cap; `Caps::cap_triangles` maps a hit to its cap in the passes) and a deformed
cap takes the normals of its faces. An engine of before ignores the tail
(trailing bytes) and draws round caps; the page writes it only for an engine with
bit 10 (`SceneView.wetShapes`, `readsWetShapes`), and only for a track with
shapes. Under *On the parts*, a drops effect with an engine that has bit 8 but
not 10 says *the render engine in use draws the drops on the parts round*
(`ambient.wetShapesOldEngine`, `partsRenderRound`, en and es).

**7. On the page and in *Fast*.** `PartsTrack.shapes` (f32 × 15 per version,
base64); a record of before (no shapes) reads round, and a track that never had
shapes has none; `PARTS_FORMAT_VERSION` 3 (key `wpt3:`). In *Fast* a part whose
drops have shapes draws its caps with 8 rings and five instanced attributes (the
shape in the cap's own frame: `localShape`), and the vertex shader moves every
vertex the way the engine does (`shapePointLocal` is its TypeScript twin) with
the normals of the deformed surface (differences along two tangents).

**8. Pins.** **New:** `PINNED_S3F_PARTS = 0x1c5a82bb`
(`rt_phys::example::organic_parts` after 264 steps: a vertical glass pane with
220 seeded drops below their size and one past it near the top, and a glass
ceiling with a drop about to pinch off, under a light rain; 365 drops, 1 sliding,
8 relaxing a merge, 7 beads, 53 in the air, 1 drip) and `PINNED_S3F_ORGANIC_4SPP
= 0xbfb0b45a` (`s3f_organic_scene`, its drops with their shapes), the same in
scalar, SSE2 and AVX2, with 1, 4 and 16 threads (`rt-cli`), in `wasm32-wasip1`
scalar and simd128 and in the real `rt.wasm` (`tools/wasm-parity.mjs` with `rt
--write-s3f-organic-example`, alone and with the passes;
`tests/s3f-organic.test.ts` with `tests/fixtures/s3f-organic.rsb`). **Moved, on
purpose, all because the simulation changed and for no other reason:**
`PINNED_WET_PARTS` `0xe1811f7e` → `0xdc58fa46` (the S3c parity parts: swept
gathering, relaxing merges, rivulet beads on the steep faces, drops held at the
plate's open edge instead of dripping, and the hash eats the shape state; 1 810
drops, 7 held at an edge, 0 drips at 5 s against S3d's 1 951 and 5);
`PINNED_S3C_WET_4SPP` `0x827ac33c` → `0xfc96fb05` and `PINNED_S3D_FLIGHT_4SPP`
`0xf7b78a45` → `0x3ba00640` with its six passes (`ALBEDO 0x95e59402`, `NORMAL
0x63734817`, `DEPTH 0x04dee46d`, `PART_ID` and `MATERIAL_ID 0x787b3f07`, `COC
0x79183f06`), because those scenes carry the `WETP` and `WETF` of that
simulation (they are written round, without the tail, as an engine of S3d reads
them). The engine itself does not change their image: S3d's fixtures
(`s3c-wet.rsb`, `s3d-flight.rsb` before this phase) render with the new engine to
S3d's `0x827ac33c` and `0xf7b78a45` and S3d's six passes exactly (checked; the
fixtures were then rewritten with `rt --write-s3c-wet-example` and
`--write-s3d-flight-example`; the WPT1 `s3c-parts.wpt1` does not change). **No
other pin moves.** `rt-app`: `/api/info` says 2047.

**Tests** (each checked with its mutation: the test fails with it and passes
without):
- `rt-phys/tests/wet_parts.rs` (9 new, 4 redone): growth and letting go at the
  critical size on glass and plastic at 20°, 45° and 90° (mutations: half the
  hold; no merging); a drop that gathers the nine drops on its path and none of
  the nine 6.5 mm beside it, grows by what it took and runs at least 1.3× faster
  (mutation: a reach of 1.5 radii); the volume through a cascade of 400 drops and
  three runners, every five steps to 2·10⁻⁵ (mutations: a merge that keeps 0.999
  of the smaller; a bead whose water is not taken); the shape monotonic in load
  and speed, continuous where the drop lets go, and on the parts in tilt and size
  (mutations: the pinned or the sliding stretch reversed); a merge whose centre
  moves at most 0.24 radii a step and ends at the centre of volume, with its
  neck and outline at first (mutation: the whole way in one step); a drop that
  reaches an open edge hangs, stretched along gravity, and once fed past its hold
  necks for more than 10 steps and lets go of 60 %, the rest staying (mutations:
  the edge that does not hold; the whole drop falling; no neck); a fast drop on a
  vertical face leaves at least five beads on its path, elongated along it,
  which relax and stay, and at 25° none (mutation: no run); the organic parts the
  same however the steps are split, with frames in between, and their pin
  (mutation: the hash without the shape state, killed by the pin); the S3f scene
  through RSB, shaped (240 triangles a cap), another image than round, on every
  SIMD path (mutations: the shapes not carried to the caps; the sphere's normals
  kept, killed by the pin); a pinned drop that takes another on its very point is
  in the next frame when its load (and so its shape) changes without it moving
  (mutation: `put` not marking it changed; the redone frames test did not catch
  it). The swept merge alone (an end-only merge) is caught only by the pins.
  Redone: the hanging drop (it necks, lets go of 60 %
  and the rest grows again), the drop from face to face (it stops at the edge),
  two drops that merge (no jump, then the centre of volume), the frames (with
  their shapes, by number, equal to the weather's).
- `rt-core` (`weather::tests`, 3 new): the shape tail goes and comes back, an
  S3c layout byte for byte before it, other trailing bytes ignored, a bad count,
  a cut tail or a value out of range refused (mutation: the tail not read); a
  shaped cap keeps its volume within 4 % for each kind, has unit normals, and
  takes its form (longer along its motion with a wider head and a top sheared
  forward; a neck narrower than its lobes; hanging longer along gravity)
  (mutation: the merge's height not compensated); the passes count shaped caps
  by their own triangles (mutation: counted as round). `rt-cli`: the S3f scene
  with 1, 4 and 16 threads, `--write-s3f-organic-example` and `--write-s3f-strip`.
  `rt-wasm` and `rt-app`: bit 10.
- `tests/s3f-organic.test.ts` (7): the record keeps each changed drop's shape
  with its version, a record of before reads round, a bad block is refused
  before anything is written, a damaged track is not one, a track of before has
  no shapes and the key is `wpt3:`; the WETP tail only for bit 10, byte for byte,
  and none for a track without shapes; *Fast*'s shaped caps (8 rings, the shapes
  in the cap's frame) and round ones for a track of before; the shader's twin
  keeps the volume and gives each shape its form; the note of bit 10 and its
  strings; with the real `rt.wasm`, the S3f scene's pin. `tests/s3d-flight.test.ts`:
  the key is now `wpt3:`. The S3c test of the record caught the first version of
  the writer, which gave every track round shapes (fixed: a track has shapes only
  when a record carried them).

**Capture.** `docs/ui/rain-organic.png` (`tools/s3f-strip.mjs`): the S3f scene at
0, 0.25, 0.5, 0.75, 1 and 1.25 s, each frame aimed at the largest drop on the
pane: it slides down through the pinned drops, gathers them (the path above it is
clean), grows, stretches as it speeds up, and leaves the beads of a rivulet.

**What did not fit the plan.**
- **The sweep rarely matters at these speeds.** At 250 mm/s a drop moves about
  1 mm a step, less than its radius, so the end-only merge of S3c already caught
  nearly everything on the path; the swept merge is kept because it is the
  correct test, but no mutation of it alone is caught by a test (only the pins).
- **An open edge holds every drop that reaches it**, side edges too: a drop
  that reaches the side edge of a tilted plate stays there instead of running
  along it (S3d ◆4, the drip off an edge at the speed it slid, is replaced: a
  drop now stops and hangs at an edge and lets go from rest; ◆6).
- **Physics and drawing share one round footprint for the merge:** the shapes
  are drawn but the touch test is still between circles of the contact radius.
- **The drawn volume is exact for a paraboloid**, not for the spherical cap:
  within 4 % on the 16 × 8 mesh.
- **Furmidge keeps the round width** `2a` for the hold, also for a stretched
  drop (the S3c threshold test pins it).
- **Bit 10 was proposed for S3e's `WETG`** (the studio floor): S3f takes it, so
  S3e's floor needs bit 11.
- **No new browser check** (`tools/s3f-check.mjs`): the note of bit 10 and *Fast*'s
  shaped caps are covered by `tests/s3f-organic.test.ts` in Node, and the capture
  is an engine strip, not a screenshot of the app.

**For the verdict** (rule 11, ◆; to be decided in *Judgement calls*):
1. ◆ The shapes' exaggeration: `PIN_STRETCH = 1`, `SLIDE_STRETCH = 2`,
   `SLIDE_TAPER = 0.45`, `MAX_ASPECT = 4`, `HANG_SAG = 0.6`; the bulge is the
   shear the contact angles give, without a gain.
2. ◆ The neck: `NECK_DEPTH = 0.5` (equal drops) and its profile `(1 − u²)²`.
3. ◆ Hanging: `PINCH_TIMES = 3` capillary times to pinch off and
   `HANG_PINCH = 0.6`; `PINCH_OFF_SHARE = 0.6` is Harkins and Brown's.
4. ◆ The merge's duration: `MERGE_TIMES = 4` capillary times.
5. ◆ The rivulet: `RUN_REAR_SHARE = 0.8`, `RUN_WIDTH = 0.2`, `RUN_BEAD = 3`,
   `RUN_RELAX_TIMES = 60`, and `COX_VOINOV_LOG = 12`.
6. ◆ That an open edge holds every drop that reaches it, and lets go from rest
   (S3d ◆4 replaced).

## M5 · Thread-by-thread weave and real fuzz — **Opus**, verdict **Fable** (after E6 and E9; the fuzz after S8)

Request: fabric type (*plain weave*, twill…) simulated
thread by thread and an editable, real fuzz. Two parts:

**M5a · Weave.** A `WOVEN` material with weave types (`src/data/
weaves.ts`, stable keys): plain, twill 2/1 and 3/1, 5-harness satin,
basket (panama), herringbone, knit (jersey), gabardine; parameters: threads per cm
(warp and weft), thread width, twist, warp and weft colour, fibre
roughness, highlight width, sheen, wear. Per-thread shading
model of Irawan and Marschner, "Specular Reflection from
Woven Cloth", ACM TOG 2012 (public), implemented from the paper: the
weave pattern gives the visible thread segment at each point and the
thread's BRDF (fibres with twist) the reflection; the fabric's bump comes from
the same pattern (no textures). The Fast viewer approximates with a
sheen and the pattern as a procedural normal. It replaces E6's procedural
cloth as the “realistic cloth”; E6's remains as the “simple
cloth” (stable keys, nothing is renamed).

**M5b · Fuzz.** After **S8** (curve primitive, curve BVH and
fibre shading in the engine): **geometric** fuzz generated in the
engine from parameters (like `FXAM`: density per cm², length ±
variation, radius, curl, gravity, seed, only on visible faces) in the
*Fuzz* material of the inspector, with a point preview in the viewport.
Fibre shading: diffuse + two lobes (R and TT) first; Marschner
afterwards.

**Acceptance.** M5a: plain, twill and satin can be told apart at 1 cm distance
in the sheet (spheres with `rt`); the satin's highlight is anisotropic and turns
with the weft (numerical test); energy ≤ 1 (white furnace). M5b: 100 k
fibres ≤ 1.5× the time per sample; determinism; sheet with four
densities.

## U12 · TIFF and RAW (DNG) output — **Sonnet** — done

Request: for images to be output as TIFF and as RAW.
**Fable decision.** RAW = **linear floating-point DNG** (DNG 1.4, TIFF
with `PhotometricInterpretation = LinearRaw`, 32-bit `f32`,
`ColorMatrix1` = XYZ → linear sRGB primaries (the inverse of the sRGB → XYZ D65
matrix), `AsShotNeutral = 1 1 1`, `BaselineExposure 0`,
`UniqueCameraModel = "Repackshot"`): a photo developer opens it
as a *raw* with the full latitude of the render, unclipped. TIFF: uncompressed
(baseline, *little-endian*), 8 and 16-bit RGB/RGBA and 32-bit
floating-point RGB/RGBA (`SampleFormat 3`, linear), with resolution and no
ICC profile (the 8/16-bit one carries implicit sRGB; the floating-point one is
linear, like EXR). The TIFF 6.0 and DNG specifications are public;
nothing copied from any reader.

**What.** Encoders on both sides, like EXR: `rt-core::tiff` and
`rt-core::dng` (`std` only) for the desktop and the CLI (`rt --format
tiff|dng`), and `src/io/image.ts` (`encodeTiff`, `encodeDng`) for the
browser, with a **byte-parity** test between the two. Render
window: format *TIFF* (bits: 8, 16, 32 float; alpha) and *RAW (DNG)*
(no alpha); the results viewer saves and opens them (preview
from the linear data); `formatExtension`, `supportsAlpha`,
`WRITABLE_FORMATS`; es/en strings with a short help text for each format.

**Acceptance.** Tests: a 4×4 image with known values written in
each variant is read back bit for bit with a minimal reader in the test (the
tags, the offsets and the values); TS = Rust in bytes; the DNG
contains the mandatory DNG 1.4 tags and the matrix is the
inverse of sRGB→XYZ (product = identity ± 1e-6); the results
viewer shows the preview of a 32-bit TIFF; captures
`docs/ui/render-format-tiff.png`. `UI.md`, `ARCHITECTURE.md` §5,
CHANGELOG.

**Done.** `rt_core::tiff` and `rt_core::dng` (`std` only, from TIFF 6.0 and
DNG 1.4; the directory builder is shared: a DNG is a TIFF with
more tags) and, in `src/io/image.ts`, `encodeTiff` and `encodeDng`, which
write **the same bytes**: `tests/fixtures/tiff/` holds eight files
(RGB and RGBA at 8, 16 and 32 bits, one with two strips and the DNG) that
`rt-cli/tests/tiff_golden.rs` and `tests/tiff-dng.test.ts` compare with each
encoder, and each side is read back with a minimal reader of its own test
(ordered tags, even offsets, packed values,
strips without gaps, each sample); the files are also opened by
ImageMagick/libtiff and PIL, third-party readers used only to check.
`ColorMatrix1` is the inverse of sRGB → XYZ of the primaries and the D65
white, computed in exact arithmetic and stored with denominator 10⁷
(product with sRGB → XYZ = identity with error < 3·10⁻⁷, the test asks for
1·10⁻⁶). The interface: `OutputFormat` with `TIFF` and `DNG`, `BitDepth` with 32
(TIFF only), `bitDepthsOf`, `needsDisplayCopy` and `needsLinearSums` in
`core/render.ts`; the normaliser removes alpha from DNG and 32 bits from everything
that is not TIFF; the window offers *TIFF* (8, 16, 32 bits float,
alpha) and *RAW (DNG)* (no alpha, fixed “32 bits float”) with a help line
each; the render saves next to the file an 8-bit PNG copy
for the viewer and thumbnails (like EXR) and the desktop history
asks for it for TIFF and DNG too; the launcher stores `image/tiff` and
`image/x-adobe-dng` and writes `.tif`, `.tiff` and `.dng`; `rt` writes
`--format tiff|dng` and `--bits 8|16|32` (or by the extension of `-o`). The AI
(`encodeLinear`) also writes both formats. Tests: 39 in
TypeScript (`tests/tiff-dng.test.ts`, and one more in `ai-results` and in
`render-queue`) and 22 in Rust (`rt-core`, `rt-cli`, `rt-app`), each one
checked by reintroducing the failure it guards against; and in the browser,
`tools/render-format-check.mjs` and `docs/ui/render-format-tiff.png`.

**What did not fit the plan** (rule 12; what is marked ◆ is a
**Fable** judgement call, who decides whether it changes):
- ◆ `WhiteLevel`: the brief said “the floating-point maximum”. A `WhiteLevel`
  equal to the largest `f32` would make a developer, on normalising by it, leave
  the image black; **1** is written (`LONG`, the render's white; black
  stays at 0 and the data are not clipped to it, so the latitude remains
  whole). If Fable wanted something else, it is a constant in each encoder.
- DPI: the brief fixed 72; `encodeTiff` writes the window's (72
  if none are given, and a fixed 72 in `rt`, which has no `--dpi`).
- The PNG copy for the viewer is made also for 8 and 16-bit TIFF
  (Chromium decodes TIFF at no depth), not only for the 32-bit one.
- In the DNG, `bitDepth` stays at 8 as in EXR and JPEG (“the depth that
  is not chosen”); what is shown is a fixed label “32 bits float”.
- “A DOM test like the viewer's”: there is none (vitest runs without DOM
  and the viewer has only been tested in the browser). There is `previewOf` (what the viewer
  decodes, with a test), the memory history and the desktop one
  with TIFF and DNG, and `tools/render-format-check.mjs`, which renders in
  Chromium a 32-bit TIFF and a DNG and checks that the pixels of the viewer's
  canvas are those of the same render's PNG.
- The AI image of a TIFF or DNG job is saved in its format but
  the viewer does not compare it with the render (it cannot decode it), as
  with EXR (`UI.md`, X3c); the copy for the view of the AI image
  is still pending.
- `rt` writes colour only (no alpha), as with PNG.

## U13 · Image aspect ratio in the camera — **Sonnet** — done

Request (2026-10-14): to edit the **aspect ratio** (16:9, 4:3… or a
custom one) **in the camera itself**, besides in the render window.

**Fable decision.** The aspect ratio **belongs to the camera**: each camera carries
its own (`CameraState.aspect: { preset, w, h }`; presets with stable
keys in `src/data/aspects.ts`: `3:2`, `4:3`, `16:9`, `1:1`, `5:4`,
`4:5`, `9:16`, `21:9`, `2:1`, `65:24` panoramic and `CUSTOM` with free
`w:h`), the **viewport frame** follows the active camera, and the render
window **reads and writes the same** aspect ratio (a single source): the
pixel size keeps the width and derives the height from the active camera's
aspect ratio; typing both sides with the lock open leaves a custom
aspect ratio **in the camera**; choosing a size preset with another
aspect ratio changes the camera's (and says so in a line). *New from view*
copies the active one's aspect ratio; the viewport's camera chip
shows the aspect ratio next to the size (`16:9 · 1920 × 1080`). Animation:
the output size remains the render window's (a video has a single
size); the Doctor warns if a shot uses a camera with another aspect ratio.
Old projects: cameras without `aspect` take that of the saved render size.

**What.** Inspector camera section: an **Aspect ratio** row (list +
`w : h` fields with *Custom*), with the same row in the inspector of the
active camera in the *Cameras* tab; undoable `camera/set`; the
viewport frame (`src/render/preview.ts` / `viewport-overlays.ts`) and the
chip; the render window (`core/render.ts` `aspect`/`aspectLock`
become derived from the camera: `aspect` stops being state of its own
except for animation); save/open; es/en strings; `UI.md`,
`SPEC.md` §3.5, CHANGELOG.

**Depends on.** U5, the camera section (list with pencil).

**Acceptance.** Tests (mutation checked): changing the aspect ratio in the
camera changes the render's height and the viewport frame; typing both
sides in the render window leaves `CUSTOM` in the camera with that `w:h`;
a size preset with another aspect ratio changes the camera's; each
camera keeps its own when the active one changes; old project without
`aspect` → that of the saved size; animation: own size and a Doctor
warning when a shot disagrees. Browser check
`tools/aspect-check.mjs` with captures `docs/ui/camera-aspect.png` (the
section with 4:3 and the viewport frame changed) and
`docs/ui/render-size-from-camera.png`.


**Done.** `src/data/aspects.ts` (the ten presets with stable key and
`CUSTOM`, with their es/en label) and `src/core/aspect.ts` (`CameraAspect`,
`normaliseAspect`, `aspectNearPixels`, `aspectText`); `CameraState.aspect`
with `aspectRatio(cam)` in `core/camera.ts`, 16:9 by default (1920 × 1080
as before), `camera/set` reads it and undoes it, and `camera/add` (*New from
view*, duplicate) copies it. **A single source**: the camera. An image's size
is derived from it in `syncOutputSize`, which runs on every store action
(changing the aspect ratio, changing the active camera, deleting the
active one, undo, opening a project, returning from *Animation*): it keeps the
width and computes the height; `render/set` in image mode is `setSettings`, which
with the lock closed lets one side follow the aspect ratio and, with it
open or with both sides at once (a size preset), **writes the
aspect ratio into the camera in the same action** (one undo entry):
the list preset if the size is exactly one (`aspectForSize`),
otherwise `CUSTOM` with those pixels as `w : h`, and a size almost that of a preset
is respected as it is (no 1081 that quietly becomes 1080). Queue jobs
for another camera with another aspect ratio go out with the window's width
and that camera's height (`sizedFor`). Viewport: the frame (the mask,
the image background and the gradient, Full's *rsb*) and Fast's
`placeCamera` use the aspect ratio of the camera being seen (active, or
the one being looked through: `viewedCamera`), each viewport pyramid its own,
and the chip says `16:9 · 1920 × 1080`. Inspector: the **Aspect ratio** row
(`insp-aspect.ts`: list and `w : h` fields, off with a preset) lives in
`cameraFields`, so it appears in the camera section and in each camera's
card with a single added line; the render window says in a discreet line
who governs and what happened (*Camera 1's aspect ratio becomes
4:3*); the camera list puts the aspect ratio after the lens. Projects:
a camera without `aspect` takes that of the saved size (preset within ≤ 0.5 %, otherwise
*Custom* with those pixels) and the saved size **is not touched**. The Doctor
gains the `aspect` check (**Animation aspect ratio**, the 15th,
added after the original 14, with a fix). Tests: `tests/aspect.test.ts`
(33) plus those that already existed and were adjusted, each one checked by
reintroducing the failure it guards against; and in the browser
`tools/aspect-check.mjs`, with `docs/ui/camera-aspect.png` and
`docs/ui/render-size-from-camera.png`.

**What did not fit the plan** (rule 12; what is marked ◆ is a judgement call and is
left noted for whoever decides, rule 11):
- ◆ **The animation's size is the same `width`/`height` pair as the
  image's**: “own size” was read as “does not follow the camera while the
  window is in *Animation*”, and on returning to *Image* the width is kept and the
  height comes from the camera (the height that might have been typed for the video
  is lost). Storing a separate animation size (`animation.width/height`) is
  one more field if wanted.
- ◆ **In *Animation* the viewport frame is still the active camera's**,
  not the video size's (the decision says it follows the active camera);
  if the video has another aspect ratio, the frame does not show it and it is the
  Doctor that warns.
- ◆ **The Doctor's fix** sets the aspect ratio of the output on the shots'
  cameras, not the other way round (the output would change the size of the whole video).
- ◆ **The terms of a custom aspect ratio are the typed pixels** (1000
  × 700 is *Custom* 1000 : 700, not 10 : 7) and, in the viewport and the list, are
  written `1.43:1` when they are not small numbers; a camera's ratio is
  limited to 1 : 512 – 512 : 1 (that of 16 × 8192 and 8192 × 16, the most extreme the
  window admits), which is a cap of our own choosing.
- ◆ **Changing the aspect ratio does not reposition the camera**: the product may end up
  outside the frame of a 9:16 until *Frame* is pressed.
- Restoring a saved **studio** brings the lens and the view but **not** the
  aspect ratio of the camera it lands on (the aspect ratio belongs to the project, not to the
  studio); library studios and those saved before open with
  16:9 if they did not bring one.
- Editing a **queue job** (*Save changes*) leaves its size as it is
  and writes into no camera: the draft belongs to the job.
- `migrateProject` (`parseProject`, the state without geometry) now computes
  the Doctor's results again as `loadProject` already did: with the enlarged
  catalogue, those in the file would have left the two different.
- The tests in `tests/primitive-ops.test.ts`, `tests/rsb.test.ts` and
  `tests/render.test.ts` gave a render size without the camera's aspect ratio
  (a mock more permissive than the program: there size and camera were a
  single thing): they now use `render/set`, and the U1 project goes without `aspect` in
  the cameras, as it really was.
- At the extremes (3 : 700 at 1000 wide) the height stays at the window's limit
  and the pair stops having the aspect ratio, **without losing the width**: the
  aspect ratio that comes next gives the height back (typing the terms of a custom
  aspect ratio one at a time goes through extremes).

## U14 · Live view in the queue — **Opus** — done

Request (item 3.1 of the 2026-10-14/15 report, `TODO.md`: when switching
to the queue, a real-time preview of a selected render); triage in
`TRIAGE.md` 3.1.

**What.** Choosing in the queue the job that **is rendering** shows its image
live, refreshed as it accumulates; a **finished** one still opens the
results viewer; one **waiting** says in a line that it has not started yet
(es/en). The image is the job's own, fitted to the view, with the
samples the engine reports (rule 10): on desktop, the frames of the job
from the launcher's `/api/render`; on the web, the pool's accumulation. An
`onFrame` (or equivalent) in `FrameRequest` with a bounded cadence; without slowing
the render (cost measured with and without the view, under 2 %); with the view
closed or another job chosen, no images are made or copied.

**Acceptance.** Tests that fail without the feature: the queue with a fake render that
delivers images (the running job chosen shows them, the finished one opens the
viewer, the waiting one says it has not started, clearing the selection stops the
images), the cadence with a fake clock and the launcher's side. `npm run qa`,
`npm run engine:test`, `cargo fmt` and `clippy`; captures of the queue with a
running job in the view, in both themes.

**Done.**

- **Where: the results viewer in “in progress” mode**, not a panel of the drawer.
  The drawer is 240 px: the image would stay at about 360 × 200, a thumbnail;
  the results viewer layer has the viewport's size (950 × 530 in the
  1600 × 1000 window). The same click opens the same place for a finished job
  and for one in progress, and when it finishes the in-progress view **becomes
  the result** without anyone doing anything. The drawer does not change shape: the
  chosen row is marked (hover background and an ink bar), and its
  tooltip says *Watch it render*. `ui/panels/live-viewer.ts`, in the
  same layer (`rv-host`) as `results-viewer.ts`: the **Live** chip, the
  name, the engine's data (*1280 × 720 · 15 of 96 samples · 0:14 · Camera
  1*, with *Finish by time* “0:14 of 1:00”), the row's status with its
  progress and its bar, a note and *Close* (`Esc`); the image at the render's
  aspect ratio, as large as fits, over the neutral checkerboard. One waiting
  says *This job has not started yet: its image will appear here as soon as it
  renders* and shows the image as soon as the queue reaches it (also after a
  pause, which returns it to waiting); a stopped or failed one says so; removing it
  from the queue takes the view with it.
- **Interface state**, like `resultView`: `ui.liveView` (`{jobId, box}`,
  the box the viewer measured in screen pixels) and `ui.liveFrame` (the latest
  image); never at the same time as `resultView`. Commands `selectJob` (the click and `⏎`
  of the row), `watchJob` and `closeLive` (`ui/commands.ts`); `openResult` and the
  guided tour close it.
- **The port**: `FrameRequest.frameBox(image?)` and `onFrame(frame)`
  (`ui/ports.ts`; the same in `RenderOptions`, `render/engine.ts`). Types and
  cadence in `core/live-frame.ts`: `LiveFrame`, `FrameCadence` (injected
  clock), `LIVE_FRAME_MS` = 500, `LIVE_MAX_BOX` = 960 × 600, `fitFactor`
  (the smallest integer factor that fits, the same rule as the launcher) and
  `liveBox`. The queue (`liveTap`, `ui/render-queue.ts`) says yes only
  while the view shows **that** job and the tab is visible, at most every
  500 ms (the first at once, also on opening it again or on a size change)
  and never twice the same image (the launcher's pass); an image
  that arrives when the view has already gone is discarded.
- **The image** (`render/live-frame.ts`): the sums reduced by an integer
  factor with a box (each pixel, the mean of its box; in boxes larger than
  2 × 2, from a 2 × 2 grid, so it costs about four reads per pixel
  whatever the render), each pixel divided by the samples of its tile (halfway through a pass
  the pool has tiles with different counts) and converted with the viewer's
  fast curve (`DisplayCurve`) with the render's exposure and curve. **Web**:
  `pathtracer.ts` makes it after the tile that has just arrived when the queue
  asks for it, and keeps it between two (`LivePicture`): it only redoes
  the boxes over the tiles that have changed since the previous one. **Desktop**:
  `native.ts`, after each pass the launcher publishes, requests
  `GET /api/render/<id>?fit=<w>x<h>`; the launcher (`rt-app`: `Frame::fitted`,
  `fit_factor`, `parse_fit`, `FLAG_SCALED` = 512) averages the sums on the
  request's thread and only the image travels (640 × 360 × 16 bytes = 3.7 MB instead of
  14.7 MB for a 1280 × 720); with `data=0` nothing changes and a malformed
  box is 400 `bad-query`. A launcher without `fit=` would send the whole sums and the
  page reduces them. Without a live view only headers travel, as before.
- **Tests** (all fail without the feature: 19 mutations checked one by one,
  at the end of this list): `tests/live-view.test.ts` (17: the cadence and the box with a fake clock,
  the image —mean of boxes, grid, tiles without samples, coverage, the
  stored image equal to a new one and redoing only what changed—, the queue's tap,
  the queue with a fake render that delivers images, the desktop engine against the
  simulated launcher, a launcher without `fit=` and one that
  fails), `tests/pathtracer.test.ts` (1: the pool makes images only when
  asked, with the samples of each tile, and the render is the same bits), and
  in `rt-app` `render.rs` (2: `fit_factor` and `parse_fit`, `Frame::fitted` with
  boxes cut by the edge) and `tests/server.rs` (1: a final requested with
  `fit=16x16` arrives at 16 × 12 with the flag and the means of its boxes).
  `tests/launcher-mock.ts` answers `fit=` like the launcher. The mutations, each
  with some test red: a click on a running or waiting row only opens
  results; the request without the tap; no cadence; the tap for any
  job in the view; the desktop without requesting an image; the pool without making it;
  *Close* that does not close; the watched job that does not become its result; the one
  waiting without its line; the stored image redone entirely; a single weight for
  all tiles; the hidden tab that keeps requesting; the same pass
  requested twice; removing the job without closing its view; the simulated launcher
  without `fit=`; the grid that reads the whole boxes; and in `rt-app`, `fit=`
  ignored, the mean of edge boxes without counting only their pixels and
  `fit_factor` rounding down.
- **Browser check** `tools/queue-live-check.mjs` (web and
  `--desktop`, with the release launcher in `--serve-only`), both
  green: (a) the running row opens the view and images with more samples arrive;
  (b) the waiting row says it has not started, with no image; (c) `Esc` closes
  it and, on desktop, there are no more `fit=` requests (5 with the view
  open, 0 afterwards); (d) the finished row opens the results viewer; (e)
  the job watched to the end becomes its result. Captures
  `docs/ui/queue-live.png` and `docs/ui/queue-live-dark.png`.
- **Cost measured** (`node tools/queue-live-check.mjs [--desktop] --measure`):
  the same job (the sample bottle, viewport in *Fast*, the same
  samples) in pairs, one with the view closed and another with the view open
  on it (which goes first alternates), after a warm-up render; the
  time is the engine's (`data-seconds` of the history) and the CPU that of this
  browser and this launcher. **Web** (3-worker wasm pool, 1280 × 720,
  16 samples, 10 pairs): closed median 11.33 s, open 11.53 s (+1.8 %);
  median of each pair's ratios 0.983 (−1.7 %), between 0.946 and 1.092;
  CPU, 0.990; 13 or 14 images per render (about 1.2 per second, at
  640 × 360). **Desktop** (native launcher on 4 threads, 1280 × 720, 64
  samples, 8 pairs): closed median 14.97 s, open 15.01 s (+0.3 %);
  median of the ratios 1.007 (+0.7 %), between 0.948 and 1.061; CPU, 1.000; 7 or
  8 images per render (one per pass) and as many `fit=` requests. In
  both, the cost is **within the noise** of the machine (±5 % from one pair to
  another: it has 4 cores and other agents share it) and under 2 % in
  both readings. What an image costs, outside the browser
  (`liveImage`, Node, the machine loaded): 18 ms for a whole 1280 × 720 to
  640 × 360, 41 ms for a 1920 × 1080 to 960 × 540; the pool's stored image
  only redoes the boxes of the tiles that have arrived since the previous one.
  The first version (each image whole, with all the reads of each box
  and a 1280 × 800 cap) measured +11 % median in four pairs of 1280 × 720
  at 32 samples (between −2 and +31 %, with the machine heavily loaded): hence the
  960 × 600 cap, the 2 × 2 grid and the stored image.

**What did not fit the plan** (rule 12):

- **The results viewer in “in progress” mode** was chosen and not a panel in the
  queue (the brief left both): the reasons, above.
- **On desktop the image changes once per pass**, not every half
  second: the launcher publishes its sums at the end of each pass (1, 2, 4, 8 and
  then 16 samples), so in a large render the new image arrives every
  few seconds; on the web it arrives tile by tile. An image halfway through a pass
  would ask the launcher for a frame format with per-tile counts: noted.
- **The samples the web reports** are those that all pixels already have
  (`minSamples`): halfway through a pass there are tiles with more; in the first pass they are
  0 while tiles are missing (they look transparent).
- The in-progress view **has no zoom or 100 %**: the image is reduced (at
  most 960 × 600) and zoom would show no more; they arrive with the result.
- The in-progress row's **thumbnail** is still the icon: it was not asked for.
- History items carry `data-samples` and `data-seconds` (the engine's)
  so that the measurement reads them without rounding.
- `tests/launcher-mock.ts` sent sums before the first pass; the
  launcher does not (`Frame::is_empty`): now neither does the simulated one (it was more
  permissive than reality; no test depended on it).
- In `engine/crates/rt-app/README.md` the frame flags table
  lacked those of E5b-1 (64, 128, 256): they are there, with 512.

## U15 · Arrows and sliders on values — **Opus** — done

Request (2026-10-17): up and down arrows on all values, or sliders where
that suits better; the focus controls could use both: a slider with the
value beside it with up and down.

**What.** ▲ ▼ arrows visible on **every** numeric field, put in
`numberField` itself so that all its uses carry them: a click raises or lowers
one step (`Shift` finer, `Ctrl` coarser, like dragging), held down they
repeat after a pause, a whole press is one gesture and one undo entry,
the value stays within its limits and the limit's arrow switches off,
it respects *disabled*, it does not drag the field, it calls `onHold`/`onRelease`
and they are not tab stops (the *spinbutton* continues with the keyboard). That
they fit in the inspector's narrow columns, in the X, Y, Z triplets, in
the timeline and in the Settings rows **without clipping anything or making the rows
grow**, measured in a browser. And a **written rule** for
when a value is better as a slider with its field and arrows beside it
(`UI.md` §4.4), applied in the inspector, the timeline, the render
window and Settings. The camera's *Focus distance* is not touched: phase F1
redoes it as a slider with its field, and it receives the arrows of this
change.

**Acceptance.** Field tests (click with `Shift` and `Ctrl`, hold, one
undo entry per press in the store, limits, disabled,
typing and dragging, `onHold`/`onRelease`) and a browser test of the
layout in the main states, in es and en, at 1600 × 1000 and
1280 × 800, which is checked to fail by breaking the CSS; `npm run qa` green;
captures.

**Done.**

- **The arrows** (`ui/components/controls.ts`, `numberField`): two stacked
  `button`s at the end of the field (`.num-steps`, `.num-up`,
  `.num-down`), with the icon set's `chevronUp`/`chevronDown` at
  12 px (1.5 px stroke), in `ink-2`, `ink-0` with a `soft` background on hover
  and `line` on press; inside the frame and its height, 26 px, without
  growing. The field's right padding (7 px) becomes its column (14 px
  and 4 px of margin). The press goes on `pointerdown` (and `click` without a pointer,
  `detail` 0, for a screen reader or a script: one step): it stops
  propagation (there is no drag), prevents the button from taking focus and gives it
  to the *spinbutton*, captures the pointer on the pair (the press ends where it
  is released, also if the arrow switches off under the finger on reaching the limit)
  and repeats: one step on pressing, another after `STEP_REPEAT_DELAY_MS` = 400 ms and one
  every `STEP_REPEAT_MS` = 50 ms; `Shift` and `Ctrl` pressed in the meantime
  change the following steps. All with the same `newGesture('step')`, so
  the store joins it into one entry; `onHold` on pressing and `onRelease` on
  releasing (the AI preview and the plugins' wait). A field that
  disappears under the press (its panel is redrawn) or becomes disabled ends it.
  Double-clicking an arrow is two steps, not editing; if one was
  typing, the press takes what was typed and steps up from there. They are
  named *Increase* (es *Aumentar*) and *Decrease* (es *Disminuir*)
  (`common.increase`, `common.decrease`), `tabindex` −1.
- **Disabled**: the field also looks at the `is-disabled` class (the one the
  *coming soon* Settings rows set) for dragging, keys,
  editing and the arrows, and gains `setDisabled` (`NumberControl`; also
  in `lengthField` and `slider`), used by the aspect ratio terms
  (`insp-aspect.ts`, which used to touch the props by hand) and the thin-lens
  controls with a traced lens (`insp-lens.ts`: before, their `input`s were switched off
  but the field could still be dragged).
- **Compact variant** (◆ Fable): a field with an inline label (X, Y, Z;
  U, V; H, V) and a slider's field (`slider()` asks for it) carry a pair
  of 10 px with 10 px icons, 5 px of left padding and margins of 3 and
  2 px next to the label and the unit: the value keeps its previous room
  (in a 102 px triplet, 47 px of value, as before; in a
  78 px slider's field, 59 px against 62). It is the default proposal; the
  alternative (arrows only on hover or with focus) moves the
  value or covers the unit when they appear.
- **The time field** of the render window (`timeField`) stops being a
  text `input` and is a `numberField` of seconds that is shown and typed
  as `hh:mm:ss` (new `parse` of the field: with it, editing starts from the
  text that is seen): draggable, with its arrows (one minute; `Shift` 6 s,
  `Ctrl` 10 min), one undo entry per gesture; what is not a time or
  does not exceed 0 is rejected, as before. No maximum in the field (the store
  limits it to a week): a bounded field covers its whole range in 240 px.
  `tools/doctor-engine-check.mjs` types into it with a double click.
- **The rule and what was converted** (`UI.md` §4.4; ◆ Fable confirms the list):
  a value with a bounded natural range (factor 0–1, percentage, angle in a fixed
  range, opacity) is a slider with its field and arrows; a physical or unbounded
  magnitude (mm, sizes, powers, kelvin, counts, times, seeds)
  stays a field with arrows. Converted: **inspector**
  —physics *Friction* (0–2) and *Bounciness* (0–1); bokeh *Rotation*
  (±180°), *Tilt* (±12°) and *Tilt axis* (±180°) of the advanced
  optics; a filter's *Angle* (±180°); the *Smoothing angle* (0–180°); the *Angle* of a circular
  pattern (±360°); the *Rotation* of a texture and a label (±360°); on an own light *Azimuth*
  (±180°), *Elevation* (±89°), *Roll* (±180°), *Spread* (1–180°),
  *Cone angle* (1–179°), *Soft edge* (0–100 %) and *Sun disc*
  (0–5°)—; **render window** —JPEG *Quality* (1–100), *Noise* of
  *Finish by noise* (0.5–5 %) and *Intensity* of noise reduction
  (0–100 %)—; **Settings** —*Orbit speed*, *Zoom speed*
  (25–300 %), *Gizmo size* (50–200 %) and *Default intervention*
  (0–100), in `SLIDER_SETTINGS` of `settings-rows.ts`—. Material parameters
  were already sliders up to 2.5 (`insp-parts.ts`) and those of the node editor
  with a range of 10 or less; the *Ambient* feelings,
  the AI's and the plugins' already were. CSS: `.rw .slider .num`,
  `.rw-stack > .slider` (up to 300 px), `.rw-inline > .slider` (220 px, the
  quality next to the format) and `.sw-slider` (up to 240 px).
- **Tests**: `tests/number-field-browser.test.ts` (10, with the page
  `tests/browser/number-field.html`: the real field, slider and time field
  writing into a real store, with Playwright's fake clock for
  repetition): the pair in each field, on the right, inside, not covering the
  value and not a tab stop; click, `Shift` and `Ctrl`, one entry
  per click; holding (nothing before 400 ms, then one every 50 ms, `Shift`
  during repetition, nothing after release, **one** entry that an undo
  removes whole, releasing outside the button); limits and switched-off arrow (also
  with a press held to the maximum and with the keyboard); disabled
  and `setDisabled`, also halfway through a press; `onHold`/`onRelease`;
  no drag, no editing with double click and with focus in the field; typing,
  dragging and the keys; the slider and the time field; a click without a pointer.
  `tests/number-layout-browser.test.ts` (2, one per language): the states
  below, each at both sizes.
- **Measurements**: in a real Chromium (no GPU), before the arrows no field in the
  sample states clipped anything; with them, the layout test measures
  per language 1,592 fields and 620 sliders in 34 views (seven states at
  both sizes and the ten Settings sections at both sizes), **0
  problems** in es and en (524 s for both). The tightest margin between the value
  and its room is 13 px (*Automatic* in *Threads*, 110 px field), 14 px
  (*-183* in a 102 px coordinate triplet) and 17 px (*fps*, 84 px).
  **That the test catches clipping**: with `.num { height: 16px }` on purpose
  (less than its content), the English one fails with 3,184 problems (*its
  content is taller than it (17 > 14)*, *the step buttons are not a stacked
  pair*…); undone, it goes green again. And eight mutations of the field, each
  with some `number-field-browser` test red: one gesture per repetition
  (one undo entry per step), no repetition, the arrows not switching
  off at the limit, no `onRelease`, dragging from the arrows, focus
  on the arrow, the arrows on a disabled field and no `Shift`.
- **Browser check** `tools/number-fields-check.mjs`: (a) the
  arrows on all fields of the initial screen; (b) a click on *Focal length*'s ▲
  is one step and one entry, and holding ▼ for a second is many steps
  and another entry that an undo removes whole; (c) the angles of an own light
  are sliders and *Distance* and *Power* fields; (d) the *Preferences* speeds
  are sliders and *Interface size* a field. Captures `docs/ui/u15-light-fields.png`,
  `u15-part-triplets.png` and `u15-settings-sliders.png`.

**What did not fit the plan** (rule 12):

- The tests “in the DOM environment of the component tests”: vitest runs in
  Node without a DOM and no test used `numberField`; components with DOM are
  tested in Chromium through Vite (`tests/browser/*.html`), so
  the field's are a page of those, with a fake clock.
- `SPEC.md` does not describe the numeric field: it does not change.
- Not converted, by the rule of not squeezing rows: the azimuth,
  elevation, part and size of a studio's lights (a two-column grid
  with inline label, `insp-scene.ts`) and the curve handles; nor
  *Interface size* or *Text size* (percentages, but they
  rescale the window under the thumb while dragging) nor the *Ambient* wind
  direction (it wraps around, no range). The import sheet
  (the tessellation angle) was not among the brief's areas.
- A long value in a narrow field was already cut off before (`overflow:
  hidden` on the value; in a triplet, beyond about 6 characters); the compact
  variant leaves the same room, no more. The layout test measures
  the values of the states it opens.
- The ◆ items (the compact variant, the list of what was converted and the
  repetition rhythm) are in *Judgement calls*.

## N6 · Configurable exploded view and clear timeline — **Opus**, decision **Fable** — done

Request (2026-10-14): animation lacked **explosions
(exploded views)** of a model, configurable in speed and smoothness, with
**exception** parts that do not move, and of several types (vertical,
horizontal, radial, spherical…; “research types”); and **improve the
animation interface**: more comfortable, intuitive, similar to existing
systems, and making it clear **what** is animated and **how**.

**Exploded-view types (research).** CAD tools with an exploded view
agree on three basic geometries and two ordering modes
(public documentation of Onshape —*Linear / Radial / Spherical*—,
Fusion 360 —*auto explode: one level / all levels*—, SolidWorks
Composer and Inventor —levels and directions—; black-box observation,
no code):
1. **Linear** (`LINEAR`): along an axis (vertical = Z;
   horizontal = X or Y; or own direction). Two flavours: *separate* (each
   part moves away from the central plane on its side) and *stack* (all in the
   same direction, spread in their order along the axis: the
   classic exploded view of a container with cap, thread and body).
2. **Radial** (`RADIAL`, cylindrical): moving away from an **axis** (the parts
   move perpendicular to it). What is today called RADIAL becomes
   spherical; the key `RADIAL` is kept with its new meaning
   only if no saved project uses it (check); otherwise, a new key
   `CYLINDRICAL` and `RADIAL` stays as a synonym for the spherical one.
3. **Spherical** (`SPHERICAL`): moving away from a **point** (the centre).
4. **By hierarchy** (`LEVELS`): first the groups as blocks and then
   the parts inside each group (*one level* / *all levels*),
   combinable with any of the three geometries.
Parameters: distance (× model size or mm; *proportional to the
part's size* yes/no), **centre** (model centre, chosen part,
pivot, own point), axis or direction, **order** (all at once / staggered
by distance from the centre / by hierarchy depth, with overlap %),
**speed** (duration) and **smoothness** (curve: linear → soft → very
soft, a single control that chooses and weights the curve of `EASING_KINDS`),
**exceptions** (fixed parts: a list filled from the selection or
with *Pin in the exploded view* in the context menu), keep the
orientation, reverse (assembly), and the target can be the model or a
group. The existing `AXIS_X/Y/Z` keys remain valid (= linear
separate on that axis).

**The animation interface** (decision): the drawer becomes a three-zone
timeline, like KeyShot's animation space and the strips of Blender/After Effects,
copying nothing:
- **Left, the tree of what is animated** (*what*): one row per target
  (camera track, model, groups, parts, lights, environment, set,
  physics) with their animations nested (icon + plain phrase: “orbits
  90° · 4 s · soft”); selecting a row selects the animation and
  **highlights its target in the viewport**; selecting a part in the
  scene highlights its rows; a contextual **+ Animate…** button (“Animate
  Cap…”) that opens the wizard with the target set; context menu:
  duplicate, delete, reverse, split at the playhead, pin in the exploded view.
- **Centre, the timeline** (*when*): ruler in seconds and
  frames, draggable playhead, bars with their phrase, dragging to
  move and stretching at the ends, **magnet** to the edges of other bars,
  to the playhead and to the seconds, multiple selection, tracks grouped by
  target and collapsible, the camera track with its spans.
- **Right, the properties** of the chosen animation (*how*):
  header “Cap · Spherical exploded view · 1.5 × size · 0–3 s”, the controls
  of the type, the curve with preview, start/duration/end, repeat,
  reverse.
- **Viewport**: with an animation chosen, its path is drawn (arc of the
  orbit, arrow of the displacement, exploded-view vectors, rotation) and the target
  highlighted; the playhead moves the preview.
- Keyboard: space plays/pauses, Home/End, ←/→ one frame,
  Shift+←/→ ten, Del deletes, Ctrl+D duplicates. Presets stay in their
  list. Any clip type is drawn the same (also the `PHYSICS`
  that S2 adds: “physical simulation · 0–4 s”): the tree and the bars
  do not know the types, they read the phrase and the target.

**Depends on.** N1, U3. S2 adds `PHYSICS` in parallel: keep
`MotionClip` and `evaluate` as the API and draw generically.

**Acceptance.** Tests (mutation checked): each geometry moves the
parts where it says (linear separate/stack, radial perpendicular to the
axis, spherical from the point, levels by stages); exceptions do not
move; the staggered order respects the overlap; linear vs very
soft smoothness change the curve; reversing assembles; old projects with
`EXPLODE` and `AXIS_*`/`RADIAL` are read the same as before (snapshot);
tree ↔ selection ↔ viewport synchronised; dragging and stretching bars with
magnet (tests of the magnet's arithmetic). Browser check
`tools/animation-check.mjs` with captures `docs/ui/animation-timeline.png`
(tree + bars + properties with an exploded view chosen and its path in the
viewport) and `docs/ui/explode-types.png` (strip of 4 frames per type with
the sample container). Sheet `out/explode-sheet.html` for the visual
verdict. `SPEC.md` §3.7, `UI.md` §2.5, CHANGELOG; es/en strings; achromatic
chrome; everything through the store and undoable.

**Done.** The exploded view lives in `src/core/explode.ts` and is evaluated inside
`evaluate` (pure and deterministic; `MotionClip` and `evaluate` remain
the API): `explodeMovers` computes what moves as a unit
(a part, or a block in the levels), its final displacement and its time
window within the bar, and `evaluate` applies in each window
the clip's curve. Geometries `LINEAR` (*separate* and *stack* in Z, X, Y or
an own direction), `CYLINDRICAL` (the radial) and `SPHERICAL`; hierarchy
`NONE` / `ONE` / `ALL` (by stages chained with the overlap, and within
a group the parts move away from the group's centre in proportion to their
size); distance in × size or mm, even or by-distance distribution,
proportional to size, centre (assembly, part, pivot, point), order (all at once,
by distance with the farthest first, by depth) with
overlap, exceptions (`pinned`, which stores parts; pinning a group pins
its own), keep the orientation (off, each part tilts up to
20° about its own centre), model or group target. Generic optional
`MotionClip` fields: `reverse` (before starting it holds its
final state; `poseActive` makes the viewport and the engine show that state from
frame 0), `repeat` (the bar lasts `duration × repeat`, `clipEnd`),
`smoothness` (one control over *linear → soft → very soft*, blending them, that
writes the nearest one into `easing`) and `explode`. New store actions,
all undoable: `removeClips`, `duplicateClips`,
`setClipTimes` (absolute values: a drag with its gesture is one entry),
`splitClip` (the two halves follow one another in the types that add or
multiply), `reverseClips`, `setExplode`, `pinExplode`. The keys
`LINEAR` and `SPHERICAL` are **added** to `EXPLODE_MODES`.

**Decision on `RADIAL`.** No saved project or preset uses
`RADIAL`: `MotionClip` had no mode field at all (the `EXPLODE_MODES`
catalogue existed, but nothing wrote it, and the evaluator always did “outwards from
the centre”). Even so, `RADIAL` is a catalogue key with a written meaning
(“each part goes outwards from the centre” = spherical), and rule 7 does not allow changing its
meaning; besides, the catalogue already had `CYLINDRICAL` with the exact meaning of the new radial
(“they go out in a fan without going up or down”). So **`RADIAL` stays as a
synonym for the spherical one and the radial is `CYLINDRICAL`** (in the interface,
*Radial*). `AXIS_X/Y/Z` = linear *separate* on that axis; `CUSTOM` (a
direction per part) is not built and is read as the spherical one, which is what it
did before. An exploded view without parameters —all the earlier ones— is the one from
then: spherical, **each part the same distance** (`EVEN`), from the
centre, all at once; `tests/fixtures/explode-legacy.json` was taken with the
earlier code (six cases: the two presets, different curves, `RADIAL`,
the model and the closure moved and rotated, and with a turntable at
the same time) and is read the same to 1e-9 mm.

**The timeline** replaces U1's drawer (`src/ui/panels/animation.ts`
keeps its name; `anim-tree.ts`, `anim-timeline.ts`, `anim-props.ts`, and the
commands in `src/ui/anim-commands.ts`): three zones in a grid, the tree
fixed on the left and the ruler on top while the tracks scroll;
the camera track with its spans (draggable edge, the shot's camera and
remove in its menu, **+** to add); bars with their phrase, dragging of
all those chosen, stretching at both ends, magnet to edges, playhead,
shot cuts and seconds (within 6 px; otherwise, to frames; `Shift`
free) with a line that says where it snaps; multiple selection with
`Ctrl/⌘` and `Shift`; collapsible targets; properties with a one-line
header, the controls of the type and of the exploded view, exceptions, time (start,
duration, end, repeat, reverse), curve or smoothness with its preview;
the usual wizard, now with the target set; presets in their
list and in the header; loop and zoom. The arithmetic (rows, ruler, spans,
magnet) is in `src/core/timeline.ts`; the tree and the bars only read
the phrase and the target (a `PHYSICS` is drawn with a dot as icon and its
phrase or the name of its type). **Viewport**: `src/core/motion-hint.ts` gives
the target's outline (that of the part under the pointer) and the path in
model space —ring with an orbit's angle and a dot where
the camera is, arc of an elevation, arrow of a displacement, a
vector and a dot per part of an exploded view, axis and rotation of a *spin about
itself*—, and the preview (`setMotionHint`) draws it in the theme's ink
on top of everything, also in *Full* and while playing. A part's context
menu gains *Animate Cap…* and *Pin in the exploded view* /
*Free from the exploded view*. es/en strings; achromatic chrome.

Tests: `tests/explode.test.ts` (27: the snapshot, each geometry where
it says, units and proportionality, levels by stages, the
group as target, exceptions, order with overlap, smoothness,
reverse, repeat, orientation, splitting) and
`tests/animation-timeline.test.ts` (18: the magnet, the ruler, rows, the
header, tree ↔ selection ↔ viewport in the stores, commands and
keys, the path in the viewport), each checked by reintroducing the
failure it guards against; in the browser, `tools/animation-check.mjs` (the three
zones, the wizard, the outline and the path, rows marked from the
scene, dragging and stretching with magnet and undo, the keys, the menus,
each type moving the parts) with `docs/ui/animation-timeline.png` and
`docs/ui/explode-types.png`, and the sheet `out/explode-sheet.html` for the
visual verdict (◆ Fable: which default values and what look).

**What did not fit the plan** (rule 12; what is marked ◆ is a
**Fable** judgement call, who decides whether it changes):
- N1 was not built (its heading does not say *done*): the drawer being
  replaced is U1's (shots, cards and blocks). N6 brings from N1
  what its interface needed (reverse, repeat, header, curve with
  preview, camera track with spans); still pending from N1 are the *custom*
  curve with handles, `FADE`, `PAN`, `MATERIAL_COLOR`, camera
  changes with fade and animations under their target in the
  scene tree.
- ◆ Default values of a new exploded view: spherical, parts, **distribution
  by distance**, centre of the assembly, all at once, smoothness 50 %. *By
  distance* (the farthest travels the distance, the others in
  proportion) separates parts that are on the same side, like the neck and the
  cap; *even* (what it was before) moves them together. The sheet shows both.
- ◆ In the sample container the radial about Z only moves the label: the
  other parts are on the axis (which is what the geometry asks for); the sheet
  also shows the radial about X.
- ◆ *Keep the orientation* off tilts each part up to 20° as it moves
  away; the brief did not say how. It is the constant `EXPLODE_TILT_DEG`.
- By levels, the brief separated *all levels* and the order *by depth*; here
  *all levels* already goes by stages (the blocks and then
  their interior, chained with the overlap) and the order acts within
  each stage; *by depth* is mostly useful with *parts*.
- Two behaviour fixes that change projects with a set (L6) or with
  an exploded view on a node, never the snapshot's example: before, the exploded view
  also moved the set's backdrop and floor and took its centre
  from the whole scene; now a set's parts are never exploded. And
  an exploded view with target *a part or a group* moved the whole model
  (the target was ignored); now it moves what is under the group.
- Splitting at the playhead: only in types that add (rotations, distances,
  all-at-once exploded view) or multiply (scale, zoom in), played
  once and forwards; each half keeps the curve, so the
  position continues but the velocity is not that of the whole bar.
- The viewport's paths are drawn where the target is at rest: if the
  model also rotates, the exploded view's vectors do not rotate with it.
- No box selection in the tracks or double click to rename (bars
  have no name of their own yet: their phrase is it).
- The drawer grows to 300 px tall for the three zones.
- *+ Animate…* with the model chosen in a scene with a set: the set's backdrop and
  floor are scene roots, so the model is not “the whole
  model” (`SUBJECT`, which acts on all the roots) but a node, and the
  wizard sets it as *A part or group* (before *A part*: the label
  changes text, not key). Outside this phase and untouched: a rotation
  on `SUBJECT` (the presets' turntable) also rotates a set's backdrop and
  floor, because it rotates all the roots; noted for L6.
- In the strips, the base that goes below the floor appears darkened by
  the studio's shadow floor (it is behind it from the camera).

**Fable's verdict (2026-10-14).** Accepted with the choices marked ◆:
separation by distance by default, the radial about Z moves only what
is off the axis (the sheet shows the radial about X), the 20°
tilt with free orientation, the label's order in the Z stack, and the
decision on the keys `RADIAL` (spherical, as it was) / `CYLINDRICAL` (the new
radial), which applies rule 7 correctly.

## P6 · Plugins, and the film plugin (aintfilm) — **Opus**, decision **Fable** — done

Request (2026-10-14): a **Plugins** section in *Settings* with a
tool to add plugins to the view, and as the first downloadable
plugin the **film simulation engine of aintfilm** (the photo
editing and film simulation app from the same developer, in
development): its wasm engine, its settings and its recipes, in the
render window in a *Plugins* section after the AI one, with preview,
recipes and a grain simulator; the module **encrypted**, with the plugin's
logo, a link to the project (notice: app in development, this is a
preview) and the **closed licence** stated clearly.

**Decisions.**
1. **`.rpk` package** (*Repackshot plugin*): `RPK1` + a clear JSON header
   (`id`, `version`, `abi`, `bytes`, `sha256` of the ciphertext, `nonce`)
   + **AES-256-GCM** (WebCrypto) of a flat container (name/bytes
   entries: `manifest.json`, `plugin.js`, `module.wasm`, `presets/`,
   `logo.svg`, `LICENCE.txt`, `NOTICES.txt`). The **activation key**
   (32 bytes, base64) **is not in the repository** (the host is source-available:
   it cannot keep secrets): it arrives through the registry's `keyUrl` (a URL of the developer's, who can rotate it or make it conditional
   later) or is typed by the user on installing. The package is stored
   **encrypted** (IndexedDB, also in WebView2) and the key apart; it is
   decrypted **only in memory** on loading, never written in clear. What
   this protects: the module at rest and in transit, and that the package
   is of no use outside Repackshot without the key; what it does not: whoever debugs the
   browser with the key in hand. Stated that way in `ARCHITECTURE.md`.
2. **Host** (`src/plugins/`): registry (`src/data/plugins.json`: id,
   name, publisher, version, es/en summary, `closed` licence, `homepage`,
   package `url`, `sha256`, `bytes`, `keyUrl`), store (IndexedDB),
   loader (decrypts in memory → `plugin.js` as an ES module from a
   Blob URL in a **Worker** without DOM, with the `module.wasm` transferred;
   an empty `WebAssembly.Module.imports()` required for a module that
   declares it), ABI v1 by messages: `info`, `presets`, `render({w, h,
   linear f32 pixels by planes or RGBA8, settings}) → RGBA8 + info`,
   `cancel`. The manifest declares where it plugs in (`slots: ['render.plugins']`)
   and **its controls** (`controls`: key, es/en label, type
   slider/list/switch, min/max/step/default, group): the section's interface
   is **generic** and is drawn from the manifest; `plugin.js`
   translates controls and recipe into the engine's settings. A plugin never touches the
   DOM or the store: the host gives it pixels and receives pixels.
3. **Settings ▸ Plugins** (*system* group, before *Storage*):
   the registry's list with logo, name, publisher, version, size,
   summary, **“Closed licence”** and link; *Install* (download →
   check `sha256` → key by `keyUrl` or requested → store), *Update*,
   *Remove*, **Install from a file…** (`.rpk` + key): the tool
   stays in view for future plugins. Each installed plugin shows its
   full licence in an expandable block and the sentence: “This plugin's code is
   closed; Repackshot's licence does not cover it”.
4. **Render window ▸ Plugins**, after *AI*: a block per plugin
   with `render.plugins` slot. For the film one: logo, name,
   “Preview of a photo editing and film simulation app from the
   same developer, in development” with the link, closed licence;
   **preview** (the current result at preview size through the engine,
   in the worker, with a delay); **recipes** (the plugin's list by its
   categories and with **its public names**: aintfilm shows no manufacturer
   or film brands (its rule D112) and neither does this); the manifest's
   **controls** (exposure and push/pull, negative format,
   grain: amount and size, halation, diffusion, print/scan, seed,
   whatever the plugin declares); **Apply** → a new result in the results
   viewer, like the AI, with `provenance: { plugin, version, recipe,
   controls }`. The plugin's settings live in the render's
   (`plugins: Record<id, …>`), undoable and saved with the project.
5. **The film package** is built with `tools/plugins/build-film.mjs
   --aintfilm <checkout path>`: it takes `public/engine/itsnotfilm-engine.wasm`
   (reproducible build with no imports), the recipes
   (`src/engine/presets/`), the logo (`assets/exported/marks/LOGO.svg`) and
   the licence of that repository; the plugin's `plugin.js` (the C ABI
   glue: `inf_alloc`, `inf_render_linear_rgba`… with the rule of
   not retaining views between calls) is written **new** in
   `tools/plugins/film/` (it is ours; no code is copied from the other
   repository into ours: the closed part goes only inside the encrypted package).
   `tools/plugin-pack.mjs <folder> <out.rpk> [--key b64 | --new-key]`
   packs and encrypts. Brand check on the package and the
   host's strings with aintfilm's list of hashes
   (`scripts/check-brands.mjs` from that repository, run from there).
6. **Publication.** The `.rpk` as an *asset* of the Repackshot release
   (v0.1.6) and the registry pointing to it with its `sha256`; the developer
   keeps the key (the agent leaves it in the scratchpad for the
   lead, never in the repository) and `keyUrl` stays empty until
   it is hosted: meanwhile, it is asked for on installing.

Three more from the owner (2026-10-14, with the phase already built):

7. **The logo is the current one**, not `assets/exported/marks/LOGO.svg` (that is
   the old one and is not used anywhere): the 35 mm cartridge as a
   16×16 two-ink dot grid from `src/data/marks.ts` (`LOGO`, with
   the three tab columns closest to the cartridge in the dim
   ink, rule M32-02/D50), the one drawn by `src/components/DotGrid.tsx` and
   rasterised by `scripts/build-icons.mjs` into `design/icon/itsnotfilm-1024.png`
   and into the test sheet `design/icon/aintfilm-mark.png` (the reference for
   how it has to look, with the wordmark). `tools/plugins/build-film.mjs`
   builds the package's `logo.svg` from the rows of `LOGO`: one `rect`
   per dot, the two inks as two greys, square cells (it is vector:
   no need to worry about antialiasing), with exactly the same dim-ink
   rule as `DotGrid`. Afterwards (2026-10-14) the owner supplied **their logo
   as an image** (2000×2000, white dots on black: the cartridge seen
   from the front —axis at top and bottom, shoulders, body, the label band as a
   gap— and the tab coming out to the right, with its three columns closest
   to the cartridge in three greys from dark to light and then white):
   the `logo.svg` has to reproduce that dot pattern exactly, and this is
   checked by rasterising it at 2000×2000 on black with the local Chromium and
   comparing it with the image dot by dot. If `marks.ts` and the image do not
   match, the image wins: it is what the owner calls the logo. The logo goes
   on a black or dark tile on the plugin's card, so that the white
   dots read in both themes.
8. **The recipes are a horizontal carousel**, like the film strip of
   the mobile app: one card per recipe (the thumbnail on top, the public
   name below, the category as a small label), which scrolls
   sideways with the wheel or the trackpad and with the arrows, with the chosen card
   outlined, snapping to cards and fades at both ends
   when there are more; achromatic chrome, colour only inside the
   thumbnails. Each card's thumbnail is the recipe applied to **a
   single test scene**: a new `rt-cli` scene, `film-thumb`, in
   `engine/crates/rt-cli/src/scenes.rs` next to `e5-lamp` and
   `e5-glass-bottle` (the perfume bottle from `glass_bottle` next to the
   desk lamp from `lamp`, in the dark room, lamp lit,
   16:10, 320×200), rendered once with `rt` at 512 samples with
   denoise and put into the package as `thumb-base.png` (16-bit linear or
   8-bit sRGB, whichever the plugin's input prefers). On loading the plugin,
   the host asks the worker for each recipe's thumbnail from that
   base (stored in IndexedDB by plugin version and recipe id: it is
   done once) and shows a placeholder until each one arrives. That same base
   is what the preview shows when there is no result yet. If
   each thumbnail is slow for ~70 recipes, at half resolution (160×100)
   and enlarged by CSS; the time per thumbnail is reported.
9. **Animation**: when the plugin is applied to an animation job,
   each frame goes through the engine with its own seed, `seed = seed0 +
   frame index` (the engine's `seed` field), so that the grain is
   that of a real film frame by frame and not a fixed layer;
   the still image uses `seed0`; the preview shows frame 0;
   `provenance` stores `seed0` and the rule. A per-frame test with the test
   plugin (frame 0 and frame 1 differ where the test one uses the
   seed; the same `seed0` twice gives the same bytes).

**Depends on.** U5 (render window, viewer), X2 (derived result),
U6 (settings window).

**Acceptance.** Tests (mutation checked): packing → decrypting returns
the same files; a wrong key and a tampered package fail cleanly
(GCM tag); the registry's `sha256` checked; a test plugin from
the fixtures (no wasm: it inverts the pixels) goes through the worker end to
end and leaves a result with `provenance`; the manifest draws
its controls; the plugin's settings are undoable and are saved.
Browser check `tools/plugins-check.mjs` (installs the test plugin
from a local server with a typed key; opens the render window's *Plugins*;
applies) with captures `docs/ui/settings-plugins.png` and
`docs/ui/render-plugins-film.png` (the latter with the real film package
built from the checkout). `UI.md`, `ARCHITECTURE.md` (§1: plugins
are not dependencies: the user installs them, under their own licence;
new §: the `.rpk` format, the ABI and what the encryption protects), `SPEC.md`
§3.8, CHANGELOG, `release-notes` (how to publish the `.rpk`).

**Done** (2026-10-14). **The package** (`src/plugins/rpk.ts`, the same code in
the page and in the tools thanks to Node's type stripping): `RPK1`, the
clear header of decision 1 and AES-256-GCM of a flat container; the
encryption also authenticates the header (except its `sha256`), so an edited header
does not open; the `sha256` and the length are checked before decrypting.
`tools/plugin-pack.mjs` (`--new-key`, which only prints it, `--key`, `--key-file`)
and `tools/plugin-unpack.mjs`. **The host** (`src/plugins/`, a new layer of
`tests/boundaries.test.ts`: `plugins → core, data`): the registry
`src/data/plugins.json` with its loader; the IndexedDB store (encrypted package
and key apart in one transaction; in memory without it); installation from the
registry (registry size and `sha256`, header with its `id` and `version`,
the key that an update already has, the one from `keyUrl` or the typed one) and from a
file; startup (decryption in memory, `WebAssembly.compile` and the
`noImports` rule, `plugin.js` in a Blob URL as a module Worker, `init` with the
module and the files transferred) and ABI v1 (`info`, `presets`, `render`,
`cancel`, plus `ready`, `cancelled` and `error`); the service that passes a result
through a plugin (an EXR as linear planes of its light, otherwise RGBA8; the preview
at 480 px; the source's alpha put back). **Settings ▸ Plugins** (*System* group,
before *Storage*) and **Render window ▸ Plugins**
(after *AI*), both drawn from data: the registry and the
manifest; the settings in `RenderSettings.plugins` (undoable, a drag
one entry, with the project; an earlier project has `{}`); *Apply* leaves
a new result with `provenance: { plugin, version, recipe, controls, from,
label }`, saved where its source is and opened in the viewer compared with it, which
says where it comes from. **The film plugin**: `tools/plugins/film/manifest.json`
(the controls from §9 of aintfilm's manual: negative format, exposure and
push/pull, colour and its model, contrast, saturation, warmth, print
exposure, print or scan, grain —amount, size, colour, tonal bias, softness,
scanner sharpness, light response, scanning—, halation, diffusion, lens,
grain engine, seed), `tools/plugins/film/plugin.js` (new: the C ABI with
`inf_render_rgba` and `inf_render_linear_rgba` and an empty side registry, without
retaining views between calls) and `tools/plugins/build-film.mjs --aintfilm`, which
assembles and packs it. **The package built** (with decisions 7–9):
`film-0.1.0.rpk`, version **0.1.0** (aintfilm's; engine 0.1.0), **1,948,807
bytes**, `sha256`
**`e6b1e2c70beae17375d3eba222a2095fb653cce39264af12a0faa9229216b264`**, 137
files and 127 recipes (51 films, their colour alone, 8 grains, 13 filters, 4
lenses), pinned in the registry with the `url` of the v0.1.6 release and empty `keyUrl`;
the key is held by the lead (outside the repository). Tests: 62
new in seven files (`plugins-rpk`, `plugins-host`, `plugins-settings`,
`plugins-brands`, `plugins-film`, `plugins-thumbs` and `plugins-frames`; part
of `plugins-film` only where there is an aintfilm checkout; and that `?testPlugins=`
is not in a production version), with 44 mutations checked (each one
breaks what a test guards and that test fails; one more survives on purpose:
removing the ciphertext length check, which its `sha256` already covers); `tools/plugins-check.mjs` green
with the real package (installing from the local server with the typed key,
a wrong key, removing and installing from a file, the preview with the plugin's
numbers, undo, *Apply*, achromatic, reload) and the captures
`docs/ui/settings-plugins.png` and `docs/ui/render-plugins-film.png`.
`docs/release-notes/plugins.md`: how the `.rpk` is published and what is done with the
key.

**Done, decisions 7–9** (2026-10-14). **The logo** (7):
`tools/plugins/dot-grid.mjs` writes the package's `logo.svg`, a `rect` per
dot in square cells, from the **owner's logo image** (`build-film
--logo`: read dot by dot, its dot columns and rows by where there is ink
and each one's ink grouped into the image's levels) or, without it, from
the `LOGO` rows of the checkout's `marks.ts` with `DotGrid`'s two-ink rule; the old SVG is no longer used. The package's comes from the image: 15×15,
121 dots, the tab in `#808080`, `#BFBFBF` and `#E0E0E0` and the rest `#FFFFFF`,
the dot 0.862 of the cell. **Checked** by rasterising the SVG at 2000×2000 on
black with the local Chromium, placed where the image has its grid:
**225 of 225 cells equal** (the same ink class and each dot's mean
equal: maximum difference 0), the centres within 1 px at most, the four levels
128 · 191 · 224 · 255 in both, 98.9 % of pixels within 24 levels
and 96.2 % overlap of the ink (the image's dots are hand-drawn, they are not
perfect circles). It goes on the black tile in *Settings* and in the
render window, in both themes. **The carousel** (8): the `film-thumb` scene
of `rt-cli` (`rt --write-film-thumb`; the bottle and the lamp come from
`bottle_meshes`/`lamp_meshes`, and the E5 scenes of both still give
the same bytes) rendered at 512 samples with denoise (147 s on 4 threads) into
`tools/plugins/film/thumb-base.png`; the manifest names it (`base`); the preview
without a result is that image through the plugin (Apply still waits for
a result); the cards (`ui/panels/plugin-recipes.ts`) carry the base image
reduced to 160 × 100 for each recipe with the default controls, made one by
one, stored in IndexedDB (version 2, `thumbs` store) and delivered
at once the next time. **Time per thumbnail**: with the film engine,
~1 s at 320 × 200 and ~0.2 s at 160 × 100 in Node with the machine loaded (median
of 20 recipes: 963 ms and 199 ms), so they go at half resolution; in the
browser, the 128 cards in 27 s (0.21 s each, from the first opening to the
last image) and 1.7 s on opening again. **The per-frame seed** (9):
`role: 'seed'` on the seed slider (the film one and the test one, which gains a noise derived from it),
`frameControls`/`frameSeed`/`SEED_RULE`, the switch **Apply to render jobs**
(`RenderSettings.plugins[id].jobs`) and the queue step that sends each image through the
plugin; the first, to the history with `provenance.seed`. Browser check
green with the new points (`d2_base_preview_and_cards`, `d2_film_cards`,
`d2_film_cards_kept`, `e_jobs_switch_undoable`, `f_carousel_keys_wheel`) and the
two captures redone.

**What did not fit the plan.** (1) **The public names**: aintfilm's tree
still shows brands (its M38-07, the renaming, is pending; its
`check:brands` is red on purpose). What was decided there was used: a film is
its neutral id in capitals (*CN-01*, D113, from `stocks-map.json`, until
the owner chooses names in M38-10, and then the package has to be rebuilt),
with its box ISO; filters and formats, the words of D112 (*BLACK DIFFUSION*,
*WARM DIFFUSION*, *SPARKLE*, *PEARL*, *INSTANT 54×86*, *15-PERF 70 MM*); grains
and lenses, generic words, with those from aintfilm's dictionary where there
are any. (2) **The brand check**: aintfilm's `scripts/check-brands.mjs`
only walks its own list of paths and the checkout has no `node_modules`
(it imports `typescript`), so it cannot be run from there over another
folder. Its mechanism was rewritten, as it describes it, in
`tools/plugins/brand-scan.mjs` (it reads the checkout's list of hashes, which is not
copied) and was also checked with the exported functions of the script itself
(with a resolution hook towards a system TypeScript, without touching the
checkout): both give the same. Clean: the manifest, `recipes.json`,
`plugin.js`, the logo, the licence and Repackshot's strings. What remains, inside
the encrypted package and never shown, are the engine's internal labels: the
module (15 matches in the latest build, its `--dist` is red for the same reason), the
presets' settings (490: the type of the diffusion filters and the key of the paper of the
spectral model, which every complete preset has), `engine.json` (3: two format
ids) and `NOTICES.txt` (9, what a licence requires naming); they belong to its M38-07
and M38-08 (renaming *serde* labels by patch). (3) **The presets go
complete**, not sparse: the build reads them with `settingsFromValue` of the
checkout itself (run with Node's type stripping) so that the glue
scales values without guessing *serde*'s default values; they are 1.1 MB of the
package. A *colour only* recipe brings the engine's default grain (that is how
*serde* fills in a preset that does not say it): the *Grain* switch removes it.
(4) Added to the manifest, without being in the list: `groups` (the titles of the
groups), `minLabel` on a slider (aintfilm's rule that the left stop
says *PRESET* and sends nothing), `aux` and `notices`; and to the ABI, `init`,
`ready`, `cancelled` and `error`. (5) The registry's logo cannot be inline (it belongs
to the closed package): before installing a neutral icon is shown. `homepage` is
`https://aintfilm.app`, the domain configured by aintfilm's `src/lib/appConfig.ts`;
`publisher`, *Grohle*. The default seed is the engine's (1). (6) *Apply* saves the image where its source was
saved, like the AI's: in the browser it is a download. Cancelling it stops the worker
(the module's render is a single synchronous call) and the next use starts it again.
(7) The 480 px preview shows the grain of a small negative (*75 µm per
pixel*): it is what the engine says; *Apply* does it at the result's size. (8)
The tools need Node 22.18 or later. (9) `modelCatalogue()` in
`src/main.ts` reads `?testModels=` with `atob` without decoding UTF-8 (a name with
accents would come out wrong); the plugins one does it right; the models one was not touched. (10)
The launcher does not change (the store is IndexedDB in WebView2 too) and testing
on a real Windows stays on the list in `docs/release-notes/plugins.md`.

**What did not fit the plan, decisions 7–9.** (11) **The `marks.ts` logo is not
the image's**, and not only in the greys: the `LOGO` grid of the checkout is 16×16
with 137 dots (axis of 4, shoulders of 10, body of 12 that passes over the
tab) and a single dim ink `#4A4A4A`; the owner's image (like
the owner's drawing in their `design/screens/owner-0912b-film-cartridge.jpg`) is
15×15 with 121 dots (axis of 3, shoulders of 7, body of 9) and three greys.
The image won, as asked, but then the logo cannot come from the rows of
`LOGO`: it comes from the image, read by `build-film --logo` at build time
(the image belongs to the owner and goes only inside the package, like their logo: it is not stored in
this repository, nor its rows); without `--logo` the `LOGO` one comes out, which is not
published (the release notes say so). `DotGrid`'s rule is that of the
`marks.ts` path. It would be worth telling aintfilm that its `LOGO` is not the owner's logo. (12) **“One `rect` per dot” and round dots**: the image and
`DotGrid` draw circles; each dot is a `rect` with `rx = ry` half
its side (a circle), in its square cell, to satisfy both. (13) The
base image is **8-bit sRGB PNG**, what `rt` writes (it does not write 16-bit
linear), and enters through `inf_render_rgba`, like any PNG result; the scene carries
`clamp_indirect` 2: the filament seen through two glasses gives
caustics that the tracer finds as fireflies even at 512 samples with
denoise. (14) The cards are made when the plugin's block appears for the
first time (that is where its worker starts), not at application startup, and the
*No recipe* one also carries its image; a new version redoes them (the key is
the version, not the `sha256`: a different package with the same version would keep
the earlier ones, which is why the package rebuilt here, which was never published,
is still 0.1.0). (15) **Applying to an animation job did not exist**: the
plugin only worked on a history result, and the history stores
only the first frame of an animation. The switch *Apply to
render jobs* (`jobs`, off by default) was added, which passes every image of
the jobs (stills and frames) through the plugin, after saving the engine's one
and without entering the progress bar. (16) “The frame index” is its
number in the animation minus one, not its position in the job: a span
rendered separately (3–4) has the grain it has in the whole animation; the seed wraps
the slider's range (the film one's reaches 999,999,999). (17) The preview does not show other frames: it is always the
set seed, that of frame 0. (18) The IndexedDB thumbnail store
has no Node test (there is no IndexedDB in the tests): the browser check
sees that it stores and returns (`d2_film_cards_kept`); that *Remove* deletes them
is only checked by the tests on the in-memory store.

**P6b** (2026-10-14, request: the carousel like the film search of
aintfilm's app). **Done**: a thin slider under the carousel, as wide as it, tied to its
scrolling in both directions (its steps are the carousel's snap
positions, one per card and the last its end: `ui/strip-math.ts`), with the
chosen card marked on its track and operable with the keyboard; and the filters, which the
plugin declares in its `presets` response (`filters` and each recipe's
`tags`) and the host draws as rows of chips over the carousel, combined (AND), with
the count (*23 of 127 recipes*), the chosen recipe first and marked *Outside the filters* when they leave it
out, and saved with the plugin's settings (`filters`, undoable). The film one
brings those of the app (aintfilm's `docs/MANUAL.md` §7 and `src/lib/filmFilter.ts`): **Type** (its words:
*COLOUR* for colour negative, *B&W*, *SLIDE*, *CINEMA*, by each film's class) and **ISO** (its three
bands, *≤ 100 · 200–400 · ≥ 800*, cut at 100 and 400 by the box ISO),
plus **Group** (films, a film's colour, grain, diffusion, lens: the
package's groups). Package rebuilt with the same key: 1,956,072
bytes, `sha256`
`a60dd9edea828f4ed29acd3d29b9ab1ffde384284da8c6a6a6619cc1d6ba3d8a`, version
0.1.0 (not published yet). Tests: 9 new (`plugins-filters`, and one in
`plugins-film`), 15 mutations checked; the browser check
drags the slider, moves it with the wheel and with the keyboard, and applies two
filters (`f_scrub_slider`, `f_two_filters`). **What did not fit the plan.** (1) The app has a
third filter, **BRAND**, and it is not there: those are manufacturer names (its D112); the
fourth, **ORIGIN** (from the app, mine, others'), would have only one here. There are no
more facets in the app (format, process, era): none were invented. (2) *Colour /
B&W* is the app's **Type**, with its four values: slide and cinema
are also colour, and the app separates them that way. (3) The app draws its filters
as dropdowns in a row (M31-03); here they are chips, as asked. (4) A
recipe without a film (grain, filter, lens) has no Type or ISO: it is only in
*All*, the app's rule.

## Owner's bug report (2026-10-14/15) — triage, B1 and decisions

The owner sent a report of serious bugs (stored verbatim in
`TODO.md`, second document). Its triage, point by point against the code
of `main` (`72e4f79`) and the O2 branch, is in **`TRIAGE.md`**: what exists
today, whether it reproduces, whether it is a *bug*, *missing* or a *decision*, cause, fix and
dependencies. From it come:

### B1 · Fixes from the report — **Sonnet** — done

**What.** The confirmed failures and what the owner asked for, leaving nothing
open:

1. **Click to focus (1.8).** The pick is already the pixel's; the same click
   undoes it: OrbitControls fires `end` on every `pointerup` and
   `src/main.ts` patches the camera with `focusDistance: v.distance`. A
   pure function in `core/camera.ts` (`orbitPatch(cam, view)`): no patch
   if the view did not change; the focus follows the orbit distance only if it
   already followed it (the gizmo rule from `view-objects.ts`). It is used in
   `onViewChange`, in the gesture and in *Look through*. Along the way: `clickAt`
   measures from the **viewed** camera (`viewedCamera`), not the active one.
2. **Cloth to *Nodes* (1.6, along the way).** The cloth's `outputSetup` uses
   `fabricMeanColor`, not `(a + b) / 2`: denim does not go back to the bluish
   grey that E6 corrected.
3. **`.repack` extension (4.1).** The owner asks for it, so the change
   to U2's contract is theirs (rule 12): `.repack` is saved, the content
   remains the same JSON, `.repack` and `.repack.json` are opened (also
   when dropped on the window); the launcher admits `repack` in
   `WRITABLE_EXTENSIONS` and in its dialogs; the Wine test and the
   documents (SPEC, ARCHITECTURE, UI) say so. The file association
   in the installer is left out (not asked for).
4. **AI attempts (2.2).** There is no endless loop in the code (cap of
   4 per variant), but the queue does not count it: the row says “attempt *a* of
   4”, the variant and the reason for the last failure, and the bar is divided by
   attempts. And the render window's preview stops restarting
   with every model-manager snapshot that changes neither what is installed nor
   what is ready (triage hypothesis: during a download they arrive every 200 ms).

**Acceptance.** Each fix with its test, which fails without the fix (rule
3): `tests/camera-focus.test.ts` (same view without a patch, orbit with the focus
following, orbit after a click-focus); the cloth's colour for all
`MATERIAL_PRESETS` (fails today on `DENIM`, `SATIN`, `MICROFIB`); the
`.repack` names and filters in the page and in `rt-app` (`files.rs`,
`dialogs.rs`); the queue row and the preview controller with
a fake clock. A browser check in `tools/` that makes the real click
on the sample bottle and reads *Focus distance* (in the triage
it went 688 → 660 → 688). `npm run qa`, `npm run engine:test`, fmt and clippy.

**Done.** (1) *Click to focus*: `orbitPatch(cam, view)` and
`focusFollowsOrbit` in `core/camera.ts` (no patch if azimuth, elevation,
distance, target and orthographic width do not change; the focus follows the distance
only if it already followed it), used by `onViewChange` and by the gesture in
`src/main.ts`, by `lookThroughAction` and by the camera's gizmo; the click
measures from the viewed camera (`focusPickAction` in `core/view-objects.ts`, which
`clickAt` calls: the camera of *Look through*, or the active one if looking through a
light). `tests/camera-focus.test.ts` (11 new tests) and
`tools/focus-click-check.mjs`: the real click on the bottle gives 688 → 660 and
stays (with the earlier `main.ts`, 688 → 660 → 688 and *Move the camera* in
undo: 4 of the 8 checks red). (2) *Cloth to Nodes*:
`fabricMeanColor` and `WEAVE_WARP_SHARE` move to `core/fabric.ts` (re-exported
by `core/materials.ts`, so that the graph uses them without an import cycle) and
the cloth's `outputSetup` uses them; test in `tests/material-graph.test.ts` with
all the `MATERIAL_PRESETS` (fails on denim, satin and microfibre without
the fix). (3) `.repack`: `core/project-names.ts` (`PROJECT_EXTENSION`,
`PROJECT_EXTENSIONS`, `PROJECT_FILTER_EXTENSIONS`, `isProjectName`), the browser's
picker (`accept` and `types`), the desktop dialog (one filter with
`repack` and `repack.json`), dropping and *Import*; `WRITABLE_EXTENSIONS`,
`is_project_name` and the tests of `files.rs`, `dialogs.rs` and `tests/files.rs`
in `rt-app`; `packaging/wine-dialogs.mjs` (run here against a Windows
build of the launcher under Wine: it passes, with `RPX_EXT=repack` and the filter
`*.repack;*.repack.json`); SPEC §3.9, ARCHITECTURE §8, UI.md and the U2 note.
(4) *AI attempts*: `AiPostProgress` carries `maxAttempts` and `reason`
(1-based, divided by attempts); the launcher gives `lastFailure` in the *post*
state and divides the bar into quarters (`attempt_range` in `post.rs`), the synthetic
service and the wasm driver likewise; the row says *AI · tile 2 of
4 · attempt 2 of 4* (also with the variant) and, below, *Attempt 1 did not pass:
<reason>* (`aiStatusText`, `aiWhyText`, es and en); the render window's preview
is only redone if the installed models or `ready` change
(`previewTriggers` in `ui/ai-preview.ts`; with the fake clock, 40 consecutive
download snapshots give 1 request and not 40). Each fix with its test, and each test
fails on reintroducing the failure (mutations checked one by one).

**What did not fit the plan.** (1) **The cap is 4 everywhere** (`MAX_ATTEMPTS` of
`rt-post/job.rs` and `core/ai.ts`, the launcher's `maxAttempts`, the
synthetic one's loop): there is no endless loop, and with N variants it is up to 4 × N attempts. But
the wasm driver (`runGuarded`) counted attempts from 0 in the progress
and the rest from 1: now all from 1. What the person sees still cannot
be reproduced without the launcher's log (which now says *attempt k of 4
failed*). (2) **The bar in quarters has a cost**: with a single attempt
accepted the AI bar reaches 23 % before the job finishes and jumps
to the end (the row says *attempt 1 of 4*); it is what was asked for, but if it looks odd,
an uneven split (the first attempt with more bar) is a visual-judgement
call (rule 11). (3)
The reason goes on a second line of the row and in its tooltip; **the final
notice was not touched** (the triage mentioned it): the viewer's report already
says it. A running task's row with a retry grows (status and reason
wrap instead of being cut off) and the queue's columns are redistributed (the name
gives up width to the status). (4) **Click focus**: the focus plane with
*tilt* (b of the triage) and the pick through a traced lens's distortion
(O2) are not touched; with an animation shot with the playhead beyond 0 the click measures from
the viewed camera without the pose (the shot animates that focus anyway). (5)
**`.repack`**: no file association in the installers (not asked for);
saving over an open file writes it where it is, with whatever name it
has (a `.repack.json` stays one); `tools/desktop-window-check.mjs` and
`desktop-platform-check.mjs` now save `.repack`, but could not be
run here (they need the release launcher and its window). (6) **Finding
outside the brief**: on moving to *Nodes* a translucent plastic with internal scattering
(`HDPE_WHITE`, `PP_NATURAL`, `PMMA_FROST`) the graph loses the medium
(`kind`, `scatterMm`, `scatterColor`, `scatterG`: the graph has no inputs for
that); the base colour does now match in all materials. (7) A mock more
permissive than reality: the *post* state in `tests/ai-desktop-service.test.ts`
did not carry `lastFailure`; now it does.

**Pending from the owner** to close what could not be reproduced:
the launcher's log (`<data>/logs/repackshot.log`) of an AI pass
that gets stuck in attempts (2.2), and a saved scene where
denoise washes out lights and colours, with and without it (4.2: measured on the sample,
it changes mean luminance and saturation by less than 0.1 %).

### With O2

- O2 draws a traced lens's distortion in *Fast*, but the pick
  uses the undistorted ray: with a wide angle or the fisheye the click does not
  land under the cursor. Fixed in O2 (`593d480`: a single map in
  `render/lens-profile.ts` for the screen pass and the pick).
- **1.3** (really choosing the lens, distortion and bokeh) is O2.
- **1.4** (a window with the elements when hovering a lens in the list)
  comes after O2: the SVG cross-section already exists; what is missing is the floating notice and asking the
  engine for the information of the pointed-at lens (S–M, Sonnet). Done in **O2b**.

### Missing items that already have a phase

- **1.1 and 5.1** (mapping type, size, offset, size
  relative to the solid): M2a's controls exist, but only appear with an image in
  the slot; *Full* and *Render* draw them from **M2b** (done). The
  rest of 1.1 and the decision on 5.1 are still pending.
- **1.6** (nodes do not drive the material in *Full*, the default
  mode): **M3b** (done).
- **3.1** (live view of the render selected in the queue): new phase
  **U14** (Opus, M), after B1 because both touch the queue row: the
  running job shows its frames when selected (desktop: those of the job from
  `/api/render`; web: the pool's accumulation), without slowing
  the render (cost measured); finished ones still open the viewer.
  **Done**: see U14.

### Judgement calls (formerly “Decisions for Fable”)

**Since 2026-10-17 the lead takes them**, at the owner's instruction. Agents keep preparing and noting them with ◆, and do not take them on their own (rule 11). This list collects what was decided. Each entry says whether what exists is enough or which phase builds it. The starting data remain in `TRIAGE.md` and in each phase's paragraph.

**Phases that come out of this:**
- **C1** · Judgement calls applied: the small changes of this list, in a single PR. **Done**: see C1, below.
- **C2** · Focal-length switch (1.7). **Done**: see C2, below.
- **M3c** · *Wood* and *Cloth* nodes (1.6). **Done**: see M3c, after M3b.
- **M3d** · The family's wood in *Fast* through the *Wood* node's path (M3c ◆3). **Done**: see M3d, after M3c.
- **M3e** · *Fast*'s knots where *Full* puts them and the baked cloth when its threads are legible (M3d ◆1 and ◆2). **Done**: see M3e, after M3d.
- **N2b** · The studio travels with the project. **Done**: see N2b, after N2.
- **O2c** · Lens element editor (1.5). **Done**: see O2c, after O2b.
- 1.2 goes into **S3**. (done in S3)
- **S3b** · The rest of S3 (rain that settles and runs, dust that settles, the glass fed by the scene, the simulation in the worker with cache), with *Shape* out of *Advanced* and the glass approximated in *Fast* (S3 ◆5 and ◆9). **Done in part**: the *Shape*, the glass in *Fast* and everything that happens on the front glass; the parts' side, **S3c** (see S3b and S3c, after S3). **Done in part**: see S3b (the front glass); the rest, S3c.
- **S3c** · Drops and dust on the parts: rain that settles, runs and drips over the meshes, snow, the wet mark on the material and dust per part (S3b, “S3c”); and a warning when the engine lacks bit 7 and the scene's glass would come out clean. **Done in part**: the warning (and the bit 8 one) and everything that happens on still parts, in the engine and in *Fast*; drops through the air, dust motes, moving parts and the studio floor, **S3d** (see S3c and S3d, after S3b). **Done in part**: see S3c; the rest, S3d.
- **S3d** · What remains of drops and dust on the parts: dripping and splashes that fall through the air, dust motes, dynamic parts getting wet, the studio floor, finer samples on the set, the drops' part id and the meter text (S3c, “S3d”). **Done in part**: the meter text, the drops' part id in the passes and the dripping and splashes that fall through the air (in the simulation, the engine and *Fast*); the dust motes, moving parts, the studio floor and the set's fine samples, **S3e** (see S3d and S3e, after S3c).
- **S3e** · The dust motes, dynamic parts that get wet as they move, the studio floor that gets wet and dusty, and the set's fine samples (S3d, “S3e”); and the wind pushing the drops in the air (S3d ◆2).
- **S3f** · Organic drops (the owner's request of 2026-10-18): drops that grow to their critical size and let go, gather the drops on their path, merge with a neck and no jump, leave a rivulet on a steep face, take shapes from their physics (in the engine, `WETP`'s shape tail with bit 10, and in *Fast*), and hang, neck and drip one drop at a time. **Done**: see S3f, after S3e; its ◆ to decide.

- **O2** (the traced-lens sheet). Accepted as it stands:
  - which lenses give cat's eye, bubble, creamy and swirl;
  - the assumed prescriptions and stops;
  - the anamorphic adapter's constants;
  - the charts' focal lengths;
  - mask sampling.

  Revisited only if a real render contradicts it.
- **2.1** (the AI guard). The owner says the AI phase “does almost nothing” (`TODO.md` §2.1), and the guard is almost invisible by design. Therefore:
  - the guard's default tolerances are **doubled**;
  - the **default intervention goes from 30 to 50**.

  Both remain in *Settings*. **C1.** (done in C1)
- **1.7** (the focal-length switch). It is a switch next to the focal length, *Keep the size of what is in focus*:
  - **off** (the default, as in a camera): the camera stays and the framing changes;
  - **on**: the camera moves closer or further along its axis so that the focused plane keeps its size in the image, i.e. the perspective changes and the size does not.

  The inspector says which is active. It is undoable in one step. **C2.** (done in C2)
- **6.1–6.3** (sets inside *Studios*, their lights switchable). **Closed by L7.** Sets are a group of their own, and each light is switched on and off in the *Lights* list without touching the rest.
- **5.1** (the size of textures and procedurals). **In millimetres**, absolute, as E6 already does. *Fit to part* remains as an option. The manual size writes those millimetres. SPEC l. 456 is corrected to say the same as l. 101 and E6. **C1**: check that the code already does it this way and correct the SPEC. (done in C1)
- **E13** (MNEE). **Not merged.** It costs 1.8–2× with curved glass and does not improve what is seen. Caustics stay in the photon map. The branch `wip/ccr-8df3f848/e13` stays as a reference.
- **E10** (adaptive sampling). **Accepted**, with 0.83× at equal time: it is only behind *Finish by noise* and makes nothing worse. The allocation rule is revisited if a real render asks for it.
- **1.2** (the drop and the geometry mix in *Ambient*). **Yes.** It goes into **S3**, the rain and dust phase, which already touches those geometries. (done in S3)
- **S4b** (ambient particles). Everything proposed is accepted:
  - the forward lobe, at 0.5;
  - the rain's cost (1.63×), which is only paid with rain;
  - the grain in the trails under side light;
  - the narrow-path rule, in which drops also refract.
- **1.5** (the editor for a lens's elements). **Yes**: edit, move, add and rotate 180°, on the own lens that O2 already stores. **O2c.** (done in O2c)
- **1.6** (*Wood* and *Cloth* nodes). **Yes**, with E6's recipes. The graphs' wood example has to resemble the *Wood* family (`m3b-wood.png`). **M3c.** (done in M3c)
- **M3b** (`NORMAL_MAP` with blue below 0.5). The node **does not let a normal point inward**: it brings it to the outward hemisphere. The flakes example is redone with outward normals. **C1**, with its test and, if the engine changes, with the pins that move explained. (done in C1)
- **4.2** (the fireflies clamp and the denoise edge by luminance only). **They stay as they are** until we have the owner's scene. Without it there is nothing to measure with.
- **Q1** (the section):
  - the control stays in the *Scene* inspector, and in the palette;
  - the cap of a cut glass **refracts**, as now, which is the physical thing;
  - the studio is **never cut**.
- **K1** (the interior recipes and the interiors Doctor):
  - the figures of the seven recipes are accepted;
  - the **starting recipe of the *Interior* type is *Midday window***;
  - the Doctor's thresholds are accepted as proposed: scale from 100 mm to 30 m, lens below 18 mm (warning from 24 mm), eye height from 0.3 to 2.2 m (to 1.5 m), near clipping at half the distance to the wall.

  **C1** sets the starting recipe. (done in C1)
- **D1** (the engine Doctor):
  - clipping with *Standard* is a **warning**, not a failure, because flat white backgrounds look for it;
  - the fix proposes **AgX**;
  - the thresholds for fireflies and the budget are accepted;
  - the video warning is woken up, because N1 is already done;
  - the denoise one stays as it is.

  **C1.** (done in C1)
- **N1** (animation). Everything proposed is accepted:
  - the wizard order, target first;
  - what a *Fade* is;
  - the solar arc's pole;
  - the shape of the fade to colour;
  - the automatic video quality.
- **L7** (*Sets* and *Lights*). The classification is accepted, the *Product type* filter only in *Sets*, the *Subject* filter, that a new set replaces the decoration and the three thumbnail sizes. One change: **it is not asked whether the lights present are the product type's untouched ones**; they are simply replaced. **C1.** (done in C1)
- **H1** (the auxiliary greys):
  - **4.5:1** (WCAG AA) is accepted for secondary text;
  - primary text stays at 7:1;
  - the hierarchy of greys is not flattened.

  If any pair in H1's report falls below 4.5:1, that pair is raised. **C1.** (done in C1)
- **U15** (the arrows):
  - the compact variant, always visible (the owner asked for arrows on all values);
  - the list of what was converted to sliders, as is;
  - repetition, 400 ms and then every 50 ms.
- **N2** (passes, batches and ZIP). Accepted:
  - alpha as an object mask, without the floor;
  - the four passes;
  - the encodings;
  - the ZIP off by default;
  - camera-by-camera order.

  A cut-out with texture will give partial coverage when the engine has it. One change: **a job's studio travels with the project**, stored inside, so that a project opened on another machine does not fail its jobs. **N2b.** (done in N2b)
- **K3** (the interiors camera). Everything proposed is accepted:
  - eye heights, 1.5 and 1.1 m;
  - interior lenses, 24, 28 and 35 mm;
  - the automatic measurement;
  - the EV 7 and 5 presets, with their calibration;
  - the exterior, from 0.05 to 1, with 1 by default;
  - that *Interior* switches on straight verticals;
  - the fisheye's field, measured on the diagonal.

- **F1** (focus by point and by object): the *Object* follows the centre of its box; the slider's range and logarithmic scale, as they are; in *Point* and *Object* **moving the slider becomes *Distance***; the best focus of the traced lens by fine-detail contrast, as it is (the corner with distortion +1 stays open); a focus clip wins; a click on a glass focuses its front face. **Done in F1.**
- **N2b** (the studio travels with the project). The four are accepted as they stand: the copy wins over a library studio with the same id and different content; editing a job without changing its studio keeps its copy; *Add to my library* saves with its id, is not undoable and lives in the *Queue* drawer; the schema stays at 2. **Done in N2b.**
- **C2** (focal-length switch). The six are accepted as they stand: the switch goes on each camera (it travels with it into the project and the studios); a locked camera changes the focal length without moving; the orbit's target advances along the axis when the camera would end up at less than 0.1 × distance × f′/f; the interior lenses go through the switch, the lens presets still frame the product and the *ZOOM* clips do not move; the row goes below *Focal length*; with orthographic or panoramic the switch remains usable, does nothing and says so. **Done in C2.**
- **O2c** (lens element editor). Accepted as it stands: the new element's default (radii ±4 f, 4 % of f thickness, the catalogue's simple-lens glass, as wide as the narrowest neighbour, centred in the gap), the margins (1 % of f of air, 5 % in front and behind, 1e-3 mm at the edges), the 10 % step of *Smaller · Larger* and the image-circle threshold (relative illumination 0.001). A circle that does not cover the frame **does not prevent applying** (strong vignetting is a look one may want, and the render shows it). The edited lens **keeps the stop's travel** from the catalogue's. **Done in O2c.**
- **M3c** (*Wood* and *Cloth* nodes). ◆1, the fuzz: it stays as is, a numeric output of the *Cloth* that can be used in the graph; the fuzz input of the material output (the program's 16th) arrives with **M5**, when the engine paints the fuzz, not before. ◆2, cloth under a bevel: accepted as is (outside the bevel radius, the same bits as the family; its own pin). ◆3, the family's wood in *Fast*: **yes**, to be baked through the same path as the node, so that wood in the scene looks as on the spheres in *Fast* too: **M3d**. The rest (view from inside, the normal's bit, knots against the box in *Fast*, the mean colour, the seed copied on converting), as is. **Done in M3c**, except M3d and what goes to M5.
- **M3d** (the family's wood in *Fast*). Accepted as is: the family is baked through the node's path and gives the same pixels. ◆1, the knots: **(b)**, E6's knot layer (each part's own, the one that matches *Full*) on top of a bake without knots, for the family and for the node; that *Fast*'s knots land where the render puts them matters more than the bake bringing them. ◆2, the cloth: **(b)**, baked only when a thread occupies at least 2.5 texels, with the fuzz (sheen) on top; below that it stays as today, without moiré. Both, in **M3e**. **Done in M3d**, except M3e.
- **M3e** (knots and cloth in *Fast*). Accepted as is. ◆1, the threshold: **it stays at 2.5 texels per thread**; at 2 the limit where moiré appears is brushed, and unbaked linen and felt read well in *Fast*. ◆2, the knot on top: **the darkened disc stays**; *Fast* is a preview, and the end grain, the crack and the grain around come out in *Full*. **Done in M3e.**
- **S3** (the drop, the shape mix and the front glass; first part). ◆1–4, 6 and 8 are accepted as they stand: the drop of 1.6 radii with a 0.15 tip; the tip behind the velocity (the teardrop the owner asked for, although a real drop falls almost round); the 1 : 1 : 1 : 2 mix; the *Water drops* preset; the glass's figures and ranges; the motes that only absorb. ◆5: **yes, *Shape* leaves *Advanced*** for the visible controls, because the owner asked for it and hidden it cannot be found; it goes in **S3b**. ◆7: **the physics stays**, without a non-physical control that sharpens the drops: with the lens and stop that call for it (wide angles, stopped down, glass far away) they read; revisited with a real render from the owner. ◆9: *Fast* does not draw the glass in this part; an approximation (the drops as discs) goes in **S3b**. **First part done in S3**; the rest, S3b.
- **S3b** (the front glass fed by the scene; the visible *Shape*; the glass in *Fast*). Accepted as it stands: ◆1, wettabilities per family (glass 70/50, plastic 90/65, metal 80/50, paper 100/20, paint 85/60); ◆2, sliding (C = 300, cap of 250 mm/s, 2 µm film); ◆3, the dust angle of repose of 35° ± 5°, and a vertical glass without dust; ◆4, snow, bubbles and confetti leave nothing on the glass (snow, with its layer, in S3c); ◆5, the effect's region does not limit the glass, and a lens looking down stays dry without wind, as the physics says; ◆6, **there is no non-physical intensity knob** (like S3 ◆7): with the presets' densities the dust is barely visible at 120 s, and whoever wants it raises the density; ◆7, *Fast*'s approximation as it comes out of the optics; ◆8, `MAX_GLASS_SECONDS` = 120. The warning for an engine without bit 7 goes in **S3c**. **Done in part in S3b**; the rest, S3c.
- **S3c** (rain, dust and snow on the parts; the bit 7 warning). Everything is accepted as it stands: ◆1, the wettability family of each category (`wettabilityFamilyOf`) and the values for wood (85/40, absorbs 0.01, porosity 0.6), cloth (110/40, 0.5, 1) and paper (absorbs 0.05); ◆2, what each effect deposits (`PARTS_FEED`); ◆3, the splash (up to 30 % of the water, 2 drops, at 4 diameters; an impact wets 2); ◆4, hanging = 1 and the drip that falls in the same step (the fall through the air, in S3d); ◆5, snow (repose 50°, packing 0.5, albedo 0.9, roughness 0.85, covers at 0.5 mm); ◆6, the set gets wet as a film; ◆7, the budgets (1 mm cell, 150,000 samples with a third for films, 120 s, 4096 drops); ◆8, how dark and bright wet things become (film at roughness 0.03, albedo exponent 1 + wet × porosity) and the dust's colour and roughness; ◆9, what is sheltered stays completely dry. **Done in part in S3c**; the rest, S3d.
- **S3d** (drips and splashes through the air; the meter; the drops' part id). Accepted as it stands: ◆1, the drop in the air as a water sphere of its volume, without a streak (the engine has no shutter); ◆2, Atlas, Srivastava and Sekhon's terminal velocity with the linear rule below 0.6 mm and the quadratic drag, **but the wind must push the drops in the air: it goes to S3e**; ◆3, the splash at 30° with the reach decided in S3c; ◆4, the drip from an edge leaves at its sliding speed and the hanging one, from rest (**replaced in S3f**: a drop that reaches an open edge stops, hangs and lets go from rest); ◆5, the drop that reaches the studio floor is removed (the floor that gets wet is S3e) and the one that hits the back of a face goes through it; ◆6, `MAX_FALLING_DROPS` = 1024 and `MAX_FLIGHT_STEPS` = 2400 (10 s); ◆7, the meter's words, which counts only the parts that have something; ◆8, in the passes, a drop in the air carries the id of the part it came from. **Done in part in S3d**; the rest, S3e.
- **X6** (the AI that shows and its stored preview). Accepted as it stands: ◆1, `MAX_STRENGTH` = 0.6 (an img2img strength of 0.3 at the default Intervention of 50, still well inside what keeps the geometry); ◆2, `BAND_GAIN_AT_100` = 2 for Light, Bounces, Wear and Style strength (none at 0, as made at 50, twice at 100, linear in between); ◆3, the caps stay (light 0.3, bounce 0.15, style 0.2, wear 0.15): the gains now make the controls visible and the caps keep them honest; ◆4, the six style grades and their amount of 2 × Style strength × Intervention, applied by the guard itself so they are the same with any model, and a quarter of it in the synthetic service; ◆5, the reference scene (the example bottle, closer and lower), the stored steps and the lookup rule (nearest step; the control moved last wins), with the example labelled as such; ◆6, the focus check skips in-focus pixels of wear materials: Wear's detail there is what Wear is allowed to do, and out-of-focus areas are still checked; ◆7, the test model's numbers, which only drive the stored example and the tests.
- **S3f** (organic drops). Accepted as it stands: ◆1, the shape exaggeration (`PIN_STRETCH` 1, `SLIDE_STRETCH` 2, `SLIDE_TAPER` 0.45, `MAX_ASPECT` 4, `HANG_SAG` 0.6, the bulge without a gain): the running drop reads as a drop that runs, not as an ellipse, and the volume is kept; ◆2, the neck (`NECK_DEPTH` 0.5, profile (1−u²)²); ◆3, the hanging drop (`PINCH_TIMES` 3, `HANG_PINCH` 0.6, and Harkins–Brown's 60 % that falls); ◆4, `MERGE_TIMES` = 4 capillary times, so two drops visibly flow into one instead of jumping; ◆5, the rivulet (`RUN_REAR_SHARE` 0.8, `RUN_WIDTH` 0.2, `RUN_BEAD` 3, `RUN_RELAX_TIMES` 60, `COX_VOINOV_LOG` 12): a run on a steep face and none at 25°, as the strip shows; ◆6, every open edge holds the drop that reaches it, which hangs and lets go from rest, replacing S3d ◆4. **A drop that runs along a side edge** of a tilted plate, instead of stopping there, goes to **S3e** with the rest of the edges' behaviour.

**1.9** (double bar in aintfilm's LUT carousel) belongs to another
repository; the triage notes that Repackshot also draws the plugin's recipe
carousel, with no vertical bar.


## C1 · Judgement calls applied — **Opus** — done

**What.** The small changes from *Judgement calls* marked **C1**, in a single PR: 2.1, 5.1, M3b, K1, D1, L7 and H1.

**Done:**

- **2.1 · The AI guard.** Factory values: *Intervention* 50 (was 30) in `DEFAULT_AI_PIPELINE`, in `rt-post`'s `Settings::DEFAULT` and in *Settings* (`ai.intervention`); the tolerances, doubled: mean ΔE₀₀ 4 and 95th percentile 6 per material, and edges 4 px in *Settings* (`ai.guard*`, they were 2, 3 and 2) and in the synthetic service (`SYNTHETIC_LIMITS`); in the engine's guard (`Tolerances::PROVISIONAL`) 4, 6 and **3 px** (was 1.5). `AI-POST.md` §3.2 and §4 say so. *Migration*: the *Settings* document stores all the keys and `validateSettings` keeps what was stored (there is no schema step), so a value equal to the earlier factory one cannot be told apart from a choice: an existing installation continues with what it had; only a new one (or *Reset*) takes the new values. Tests: `tests/ai-settings.test.ts` (the new values, the synthetic one with the same, a stored document that keeps 30 and 2/3/2 and one without the key that takes 4) and `the_constants_are_the_contracts` in `rt-post` (50, 4/6/3 and the ΔEs equal to those in `settings.ts`). `tests/fixtures/ai-guard.json` regenerated: the *forbidden* scenario (which uses the default values) changes image, and *strong* and *limited* no longer need to clip the colour of the cap or the label.
- **5.1 · Size in millimetres.** The code already does it: `sizeMm` in mm (`core/textures.ts`), the size field is a `lengthField` that shows in the *Settings* unit and writes mm, *Fit to part* is a button (`insp-textures.ts`), wood and cloth are physical (rings per 100 mm, `pattern/wood.rs`) and wear stores its `refSize` in metres when the material is created. Only the SPEC was corrected (§3.3, the two paragraphs that said “still in part sizes” and “pending decision”).
- **M3b · `NORMAL_MAP`.** In tangent space the blue's `2b − 1` is taken as an absolute value: a normal with blue below 0.5 is reflected into the outward hemisphere, the same in `program/interp.rs` and in `core/material-interp.ts` (the same bits). The example *Metallic paint with flakes* passes the noise through *Separate RGB* → *Combine RGB* with blue at 1. Tests (each fails without the fix): `a_tangent_space_normal_map_never_points_into_the_surface` (Rust), the normal map in `tests/material-program.test.ts` and “the metallic flakes face out of the surface at every point” (it fails if both the fix and the new example are removed). **Pins that move, all because of a normal map with blue below 0.5:** the graph example `METALLIC_FLAKES` (`eb24ca6b` → `3795f601`, new example and new node), two cases of the cross test (`NMAP 0` and `NMAP 4`, the instruction alone in tangent space over colours with blue below 0.5; `NMAP 1`, in the part's, does not move), the fifth of `PINNED_M3B_PROGRAM_VALUES` (`0x587e_907c` → `0x6d55_bcef`: the flakes card from `NOISEC` into `NMAP`) and `PINNED_M3B_PROGRAMS_4SPP` (`0x0d6e_20ba` → `0x90b4_2b6b`, the same card in the image; also in `rt-app` and `rt-cli`). M3b's six passes and every pin of a scene without `NMAP` stay the same. `engine.yml` reads the pins from the code (`sed`), so its blocks do not change. In the region comparison (`tests/programs-full-browser.test.ts`) the flakes go from correlation −0.91 and a hue distance of 106 to **+0.87** and **28**, within the margin of the others: the test now requires hue and positive correlation of them.
- **K1 · *Interior* starting recipe.** `SceneTypeDefaults.lightSetup` (`INT_WINDOW_NOON` in *Interior*) and one more slot of K1's mechanism, `studio.lighting`: it stores the setup, its lights, `modified`, the dome intensity and the exposure, and writes the same as choosing the recipe in the catalogue (`applySet` with the decoration kept). It only acts on the untouched product-type lights (L7's definition, below); a chosen setup or edited lights stay. Going back to the previous type returns the lights as they were (the same fix), and if the person touched one of the recipe's lights, theirs stay. Tests in `tests/scene-type.test.ts` (six new; K1's round-trip ones pass unchanged, “removes nothing” no longer asks for the same lights in *Interior*).
- **D1 · Engine Doctor.** Clipping with *Standard* was already a warning (`WARN`: the Doctor has no other failure state); now the catalogue says so and the sentence (“it is what a plain white background looks for”) and the fix sets **AgX**. The video check already woke in N1 (dormant meant that until N1 the settings forced the frame sequence): it warns only of a container the system does not encode; the SPEC still said the earlier thing and was corrected. The denoise one does not change. Tests: three new in `tests/doctor-engine.test.ts` (warning and AgX in the fix and in the sentence in both languages; the video awake; the denoise the same) and the two that pinned *Filmic*.
- **L7 · The question about lights.** “The untouched product-type lights” is `typeLightsUntouched` (`core/lighting.ts`): the setup in force is the type's (`PRESET`), `studio.modified` is off (any added, duplicated, edited, placed, aimed or deleted light turns it on, and only setting a setup turns it off) and the lights, without a set's decoration, are value by value those of the type's `lightsFromRig` (so there are no own or kept lights, and a type chosen without redoing the studio does not count). With them, `requestSetup` replaces without asking, also if *Settings* remembers *Hide* or *Add*. Tests: two new in `tests/light-catalogue.test.ts`; `tests/library.test.ts` and `tests/light-panel-browser.test.ts` no longer expect the question on a freshly opened project (the second first chooses a setup without a question and then another, which does ask).
- **H1 · Contrast.** `tests/ui-contrast.test.ts` demands 7:1 of primary text (`ink-0`, `ink-1`, the inverted one) and 4.5:1 of secondary (`ink-2`) on all surfaces of the four themes, and that each grey be at least 10 % below the one above on each surface (the hierarchy is not flattened). The only pair below 4.5:1 was the light theme's `ink-2`: **`#6b6b6b`** (3.78:1 on `bg-3`, 4.39 on `bg-2`, 4.43 on *overlay*) becomes **`#5f5f5f`** (4.52:1 on `bg-3`, 6.4 on `bg-0`); the dark one (`#9a9a9a`, 5.10 to 6.86) and the high-contrast ones already reached it.

**What did not fit the plan** (rule 12; ◆ for whoever decides):

1. **The *Settings* guard controls did not reach the guard** (decided and done in the second round, below): `ai.guardDeltaE`, `ai.guardDeltaE95` and `ai.guardEdgePx` were stored and shown, but the guard always used `Tolerances::PROVISIONAL`, and the factory edge differed (1.5 px in the engine, 2 in *Settings*).
2. **Existing installations kept 30 and 2/3/2** by the *Settings* convention (what is stored governs): it was decided to migrate them (second round).
3. **`NORMAL_MAP` in the part's space** could still bend the normal inward with an intensity above 0.5: it was decided to fold that too (second round).
4. **K1**: the decoration of a product type that is a set (the puddle light, the backdrop) stays under the recipe, as when adding a recipe keeping the lights; removing it would force the slot to store scene parts to give them back. With *Interior*'s automatic exposure, the exposure the recipe sets (the type's plus 0.2) is the compensation, just as when choosing it in the catalogue.
5. **D1**: clipping was already a warning and the video had been awake since N1; what is new is the fix (AgX), the sentences, the SPEC and the tests.
6. **H1: `ink-3` is not raised.** It is the grey of the switched-off (disabled controls, separators, handles, empty thumbnails), which WCAG 1.4.3 does not measure; raising it to 4.5:1 would put it above `ink-2` and flatten the hierarchy. The text that is read and used it moves to `ink-2` (second round).
7. **Captures**: those this change left stale were re-recorded in the second round.

**Gates.** `npm run engine:build`, `npm run qa` (types and build green; of 3071 tests, in one pass only `tests/ai-desktop.test.ts` “cancelling mid-way” failed, a timing race with the machine loaded that sets the intervention to 100 and does not depend on the factory values: it passes alone three times in a row, and the whole suite with `npx vitest run --maxWorkers=2` gives 3065 pass and 6 skipped). In `engine/`: `cargo fmt --check`, `clippy --workspace --all-targets -D warnings`, `cargo test --workspace --release` (1130 pass, 5 ignored), the wasm32 build of `rt-wasm` and `rt-post-wasm` with no WASI imports, the parity blocks of `engine.yml` against the real `rt_wasm.wasm` (40 images; M3b gives `0x90b42b6b` with its six passes equal), the guard parity with the real `post.wasm` (`tests/ai-post-wasm.test.ts`) and the page-code tests with the real `rt.wasm` (107 pass). `tests/programs-full-browser.test.ts` and `tests/light-panel-browser.test.ts`, in Chromium.

**Second round** (what is marked ◆, decided by the lead):

- **Merge of `main`** (v0.1.17, the startup in *Fast* and O4): the CHANGELOG joins the two parts by areas; in the ROADMAP the name *Judgement calls* stays (O4 noted its decisions in its own phase and did not touch the list).
- **Migration of the earlier factory values.** `SETTINGS_SCHEMA` becomes **2** and its step 1 → 2 (`STEPS[1]`, with `OLD_AI_FACTORY`) changes a stored `ai.intervention` equal to 30 into 50, and tolerances equal to 2, 3 and 2 px into 4, 6 and 4 px, each on its own; any other value stays, and a schema-2 document is read as is (there a 30 is a choice). Test in `tests/ai-settings.test.ts`: an old document takes the new ones, one with 35 keeps 35 (and a ΔE of 5 or an edge of 1 their own), one of schema 2 keeps 30.
- **The guard controls reach the guard.** `AiPostRequest.tolerances` (`deltaEMean`, `deltaEP95`, `edgesPx`, the keys of `Tolerances::KEYS`) and `withGuardTolerances` (`core/ai-post.ts`), which wraps the application's service (`main.ts`) and puts in each request, the queue's and the preview's, what *Settings* says at that moment (`guardTolerances`). On desktop, `DesktopAiService` sends them in the JSON and the launcher already accepted them (`PostRequest.tolerances`); on the web, the synthetic service measures against them and `jobTolerances` puts them in the `post.wasm` job. The factory edge is **4 px everywhere** (`Tolerances::PROVISIONAL.edges_px`, was 3). With that a failure appeared: the profile that measures the edge reached 4 px on each side and could not measure more than about 3, so with a limit of 4 the check could never fail; it now reaches two pixels beyond the limit (`edge_reach`, from 4 to 16). Tests: with the real `post.wasm`, the plan and the report use 7.5, 9 and 6 if *Settings* says so, and the factory ones if not (`tests/ai-post-wasm.test.ts`); the synthetic service through `withGuardTolerances`, read on every call (`tests/ai-synthetic.test.ts`); the JSON the launcher receives (`tests/ai-desktop-service.test.ts`) and, with the real launcher and the fake runtime, the report of its guard with 7.5 and 6 (`tests/ai-desktop.test.ts`); in `rt-post`, `the_edge_profile_reaches_past_the_limit` and the two tests of a moved edge, which moved 3 px (within the new limit) and now move 6. `tests/fixtures/ai-guard.json` only changes the edge limit the report states (3 → 4): no image moved.
- **`NORMAL_MAP` in the part's space**: a result on the other side of the surface is reflected in its plane (`r − 2(r·n)n`, normalised), the same in `program/interp.rs` and in `core/material-interp.ts`. With intensity 0.5 or less it never happens (the normal is at least `1 − 2s` outward). Tests that fail without the fix: `a_part_space_normal_map_never_points_into_the_surface` (Rust) and the one in `tests/material-program.test.ts`. **Pin that moves:** only the `NMAP 1` case of the cross test (`9b01860a` → `6c271a5b`: the instruction alone in the part's space with intensity 1 and the one that gives a UV coordinate, over colours that point against the normal); the ten examples and the engine scenes use no part-space maps, and no pinned image moved.
- **Text in `ink-3`**: the *coming soon* label of the effect cards (`.fx-card-soon`), the *Edge smoothing* rank (`.sw-aa-rank`) and the names of hidden rows and switched-off lights (`.tree-row.is-hidden`, `.list-row.is-off`) move to `ink-2` (4.5:1). `tests/ui-contrast.test.ts` reads the stylesheets and demands that every rule with text in `ink-3` be a disabled or rejected control or decoration (separator, handle, icon, empty thumbnail), and that those four roles be `ink-2`; it fails if one goes back to `ink-3`.
- **A failure in the *Light* section that the starting recipe uncovered**: each light's fields were redone only when the lights' ids changed, and the recipe's are the type's (`l1`…`l3` and the puddle's), so with *Interior* the type's names (*Fill*, *Back 1*) continued over the recipe's lights, and on going back the recipe's. Now the role is also redone, if it is own, and its name (`tuneLightsKey`); test in `tests/scene-type.test.ts`, which fails with the earlier key. The browser check (`tools/scene-type-check.mjs`) found it; along the way what K3 had left stale was removed from it (it read the transform in the exposure control, and the name *Brightness (EV)* of the automatic exposure counted as a new control) and it does not compare the lights' rows, which with *Interior* are those of its recipe. `tools/ai-post-check.mjs` chose *PNG* by a text that is now also that of *PNG 16 bits*: it is given exactly.
- **Captures re-recorded** (in *Unreleased* in `GALERIA.md`): `scene-type-interior.png` (*Interior* with its starting recipe; `tools/scene-type-check.mjs` follows C1: it then chooses another recipe, which does ask), `m3b-graphs.png` (the flakes facing outward; now made by `tests/m3b-graphs-sheet.test.ts`, with `REPACK_WRITE_CAPTURES=1`) and, of the light theme, `ai-section-light.png` and `ai-results-light.png` (`tools/ai-post-check.mjs`, which expected the factory intervention at 30).

**Gates of the second round**, after the merge: `npm run engine:build` and `npm run qa` green (3108 tests: 3101 pass, 7 skipped); in `engine/`, `cargo fmt --check`, `clippy --workspace --all-targets -D warnings`, `cargo test --workspace --release` (1142 pass, 5 ignored), the wasm32 build with no WASI imports, the parity blocks of `engine.yml` against the real `rt_wasm.wasm` (42 images, with O4's; none moved), the guard parity with the real `post.wasm` (11 pass) and the page-code tests with the real `rt.wasm` (129 pass); the real launcher with the fake runtime (`tests/ai-desktop.test.ts`); `tools/scene-type-check.mjs` and `tools/ai-post-check.mjs` (36 checks) in Chromium.

## C2 · Focal-length switch — **Opus** — done

**Request** (`TODO.md` §1.7), as it stands: when the focal length changes
the zoom relative to the focused object changes, and this should be a
toggle: either the camera moves closer or the focused object / point does.
Decided in *Judgement calls* (1.7): a switch next to the focal length, *Keep
the size of what is in focus*; off by default (the camera stays and the framing
changes, as in a camera); on, the camera moves closer or further
along its axis so that the focused plane keeps its size (the perspective
changes, not the size); the inspector says which is active and each change
is an undo entry.

**Done:**

- **The state, per camera**: `CameraState.keepFocusSize` (optional; ◆ per
  camera and not as an inspector preference: each camera has its lens and
  its place, and so it travels by itself with the project, with *New from current
  view* and on duplicating, and with the library studios, which store the
  whole camera). On opening, only `true` is on (`io/project.ts`
  `withInteriorCamera`, `io/library.ts` `camera`); a project or a studio from
  before C2 is read as off.
- **The calculation, in the core** (`core/focal.ts`, ARCHITECTURE §2, SPEC §3.5
  *Focal length and the size of what is in focus*). A point at depth *z* comes out *f/z*
  times its size: the plane at *D* keeps it if it goes to *D·f′/f*, so
  the camera advances *D − D·f′/f* along the line joining it to its target, and the
  orbit distance and the focus distance drop by the same amount. *D* comes from
  F1's resolution (`focusedPlaneDistance`): the one typed in *Distance*; in
  *Point* and *Object*, `focusDistanceFor` of the point being followed at rest
  (the depth; with tilt, where the hinge plane cuts the
  axis; with straight verticals, measured along the camera's own axis, which is
  the one it moves along: the levelled camera that is rendered keeps the size
  and the place of the plane, checked in the tests). The **orbit target** stays as long as
  the camera stays in front of it at more than
  `MIN_ORBIT_FRACTION` (0.1) of the orbit distance scaled by the same
  ratio; otherwise it advances along the axis in front of it (◆ the rule and the 0.1). The far clipping plane stays
  where it was in the world when moving away.
  **Locked camera**: the focal length changes and the camera does not move (◆, as with
  the switch off; before C2 a locked camera's focal length could already
  be changed). **Orthographic and panoramic**: they do nothing (their framing
  is the width or the field of view, not the focal length), and the inspector's line
  says so (`focalBehaviour`). The action is `camera/focal` (`store.ts` sends it
  to `reduceFocal`), and K3's **interior lenses**
  (`camera/interiorLens`) go through the same place (◆).
- **The interface** (UI.md §5.1 *Camera*, §3): the switch in its row right
  below *Focal length* (in the scene's *Camera* section and in the card of
  a saved camera, which both `cameraFields` draw), with its helper line,
  which says which is active and how the other is, or why it does nothing
  (locked, orthographic, panoramic); the focal length field dispatches
  `camera/focal` with the field's gesture, so each press of the
  arrows (held, a single gesture), each drag and each typed value is
  an entry (*Camera: Focal length*); the switch, another (*Camera: Keep the
  size of what is in focus*). In the palette, *Focal length: keep the size of what
  is in focus (on or off)* for the camera being viewed, with a notice.
  Strings in `es` and `en`; the chrome is the usual switch's
  (achromatic, checked in both themes).

**Tests** (each was checked by undoing its change: it fails).

- `tests/focal-switch.test.ts` (19): off, the camera stays and the plane
  grows by the focal length ratio; on, in *Distance* with the focus on the
  target and off it, in *Point* and in *Object*, and with straight verticals,
  the points of the focused plane **projected** with the camera that is
  rendered (its levelled one and its shift) land where they did (< 10⁻⁹ mm) and their
  size does not change (< 10⁻⁹ relative), while what is in front shrinks and what is
  behind grows; in *Point* the point governs even if the stored distance
  is stale; the pushed target; the far clip; no NaN; the
  interior lenses; the locked camera, the orthographic and the two
  panoramic ones, still; undo (the switch and the focal length, one entry
  each, and undo returns the exact camera), a drag one entry
  (and it ends where a direct change does), each press of the arrows its own;
  round trip in the project (also a new camera copied), an older one
  and one with `"yes"` open as off; a library studio stores it
  and an older one is read as off; the palette command.
  Mutations: removing the movement fails 11 (and 3 in the browser);
  removing the path through the store, 16 (and 4); measuring *D* up to the target instead of
  the focused plane, 5 (and 1); reading *D* from the stored distance in
  *Point*, 1; removing the check for locked, for orthographic and
  panoramic, for the target push, for the clipping, for the interior
  lenses, for the project reading, for the library's or for the palette
  command, 1 each.
- `tests/focal-browser.test.ts` (5, Chromium with SwiftShader; skipped without
  it): the page `tests/browser/focal-page.ts` draws with the preview engine
  two glowing cards, changes the focal length through the store like the
  field (a drag from 50 to 85 mm, a press to 35 mm, straight
  verticals with 18° from 35 to 70 mm) and reads the canvas: on, the focused plane's card
  comes out with **the same pixels** (5145 of 5145, 83 px
  wide; in *Point* on the card behind, 2595 of 2595; with verticals,
  2806 of 2806), within the 1 % asked for, and in its place within one
  pixel, while the other changes; off, the card grows 1.70× (83 → 141
  px). One undo entry each time.
- `tools/focal-check.mjs` (20 checks on the built interface,
  `npm run build` first): the switch below the focal length, off and its line;
  off, the arrow changes the focal length and leaves the focus distance; switching on
  is one entry; the arrow moves the focus distance by the focal length ratio (688.4 → 696.5 mm from 85 to 86 mm) in one entry that a Ctrl+Z
  undoes whole; a drag, one entry; the orthographic and locked line
  (and the locked one does not move); the palette switches it off with its notice;
  the line in Spanish; achromatic in the dark theme and the light one. With the
  earlier field (`camera/set`) `on_the_camera_dollies` and
  `drag_dollies` fail. `--shots docs/ui` leaves the capture.

**Capture**: `docs/ui/c2-focal-switch.png` (the *Camera* block with the
switch on and its line; in `GALERIA.md`, *Unreleased*).

**What did not fit the plan** (rule 12; what is marked ◆ is decided in *Judgement calls*: it is accepted as it stands):

1. **The focal length has no slider**: it is a field with arrows that can be dragged
   (U15). The “slider gesture” is that drag (one entry); no slider was
   added to the focal length.
2. **There are no inspector preferences** where to store the switch; per
   camera fits with the rest (see above).
3. **With tilt (O1)** the size is kept where the plane cuts the
   axis: the hinge rule depends on the focal length, so the tilted
   plane rotates a little when it changes and its off-axis points
   do not keep exactly the same size.
4. **With a traced lens**, *D* is the paraxial distance that the
   store stores (it does not ask the engine); wide open, the best focus falls millimetres
   from it, and the size in the image depends on the geometry, not on that.
5. **The *Lens* presets** (`camera/lens`) still frame the part
   as before, with the switch on or off; and the animation's `ZOOM` clips
   change the focal length without moving the camera (an animated *dolly zoom*
   would be another clip).
6. **The switch stays active** with orthographic and panoramic (it can
   be left on for when the camera returns to perspective); the line says that
   there is nothing to keep there.

**Gates.** `npm run engine:build` (the usual `rt.wasm`, `rt-simd.wasm` and `post.wasm`: the engine was not touched, so `cargo fmt`, `clippy` and the separate wasm build are not needed) and `npm run qa` green: types, build and 193 test files, 186 pass and 7 skipped, with 3191 tests (3160 pass, 31 skipped; before the phase 191 files), without repeating anything with `--maxWorkers=2`. `tests/focal-browser.test.ts` ran inside, in Chromium; `tools/focal-check.mjs` (20 of 20) on the built `dist/`.

## F1 · Focus by point and by object — **Opus** — done

**Request** (2026-10-17, after B1): clicking on a point still does not
focus exactly on that face, at that pixel — marked as crucial. In addition, a
second focus mode is wanted in which an object is focused, with both
modes available at once. And, about values: up and down arrows
on all values, or sliders where they suit better, with the focus
controls using both: a slider with the value beside it with up and down
(the same request as U15). It is item 1.8 of `TODO.md`: the exact pixel of the
exact view.

**What.** (1) That the click leave sharp, in the final render, exactly what
is under the pixel, in any view: *Fast* and *Full*, thin lens,
tilt and shift (O1), traced lens (O2), U13's aspect ratios,
looking through a saved camera, the timeline with the camera
animated, and after orbiting or zooming in. (2) Three focus modes per
camera: *Distance* (the usual one), *Point* (the picked point, which the focus
follows) and *Object* (a part, a group or the model).

**Measured first.** A scene built for it (`tests/browser/focus-scene.ts`):
a 1.3 mm checkerboard tilted 45° in depth that fills the frame, flat light,
135 mm at f/1.4 at 600 mm (the depth of field is a couple of
millimetres: a millimetre of error moves the sharp band several pixels). A
headless browser draws the preview and makes the click like the viewer
(`tests/browser/focus-page.ts`); Node applies the action, asks the engine for the
exact depth and circle-of-confusion passes of the *Full* view
(640 × 400) and of the final render (480 × 270) at the click's pixel, its own
focus for what that pixel sees (`rt_scene_pick`), and renders the final one with
`rt` to see where the sharp band falls (a band-pass contrast along the
depth gradient, the centre of the band, measured the same before and
after; the band measures ±15 px with the thin lens and ±25 px with the traced
ones wide open, and about ±2 px is measurement noise; `tests/focus-measure.test.ts`,
`REPACK_FOCUS_MEASURE=1`). Seven clicks per case (centre, edges, corners;
the band, at the centre and two corners). Before F1 (at `319614b`) and after,
sharp band in render pixels from the click, and focus error in mm:

| case | before | after |
| --- | --- | --- |
| thin lens | 0.00 mm; band −0.5 to −2 px | the same (B1's pick was already the pixel's) |
| tilt 6° | exact depth, but band at +34.5 and −36.5 px in the corners | −1 and −2 px |
| shift | 0.00 mm | 0.00 mm |
| double Gauss f/1.4 (O2) | band at −31 px in the centre, −42 and −50.5 px in the corners, the click outside it | +5, −14.5 and −13 px, the click inside the band in all three (its contrast, 88 % of the maximum) |
| Petzval (O2) | −31.5 px in the centre, −32.5 and −44.5 in the corners | −2, +14 and +11 px, the click inside the band |
| distortion +1 (O2) | *Full* −2.28 mm and the final −0.97 mm in the corner (the viewport was not the render); band −31, −16.5 and −52.5 px | both at 0.00 mm from the engine's focus; band +5.5 and −15.5 px, the click inside; bottom right, −38.5 px (see “What did not fit the plan”) |
| 1:1 and 9:16 active | 0.00 mm | 0.00 mm |
| looking through, 9:16 | *Full* up to 34.8 mm and 15 px of circle of confusion in the corner; the final, fine | 0.00 mm and 0.1 px in both |
| timeline, t = 1 with orbit | ±6.5 mm, 3–4 px of circle; band −24.5 and +19.5 px | 0.00 mm; band 0 and −1.5 px |
| orbiting 8° after the click | up to 16.9 mm, 8 px of circle; band ±42–44 px (at the click's pixel) | 0.00 mm where the point has gone (leaving the distance, as before, would leave it up to 10.3 mm off); band −1 to −1.5 px |
| zooming in 15 % after the click | 80–101 mm, 45–70 px of circle | 0.00 mm where the point has gone (left, 90 mm off) |
| moving the part 15 mm after the click | — | 0.00 mm (left, 15 mm off) |

**Measured causes** (the brief's hypotheses, h1–h6):

1. **h1, the tilt.** The click set the point's depth, but the tilted
   lens focuses the plane of the hinge rule, which passes through the
   point at another distance: `u (f − sin α (p · b)) = f z`. The engine and the
   interface now use the same rule (`Camera::focus_distance_to`,
   `core/focus.ts focusDistanceFor`, with a parity test against `rt.wasm`).
2. **h3, the traced lens.** It was focused paraxially, and wide open its
   spherical aberration and field curvature put its sharp image several
   millimetres further. The engine solves the distance with its own rays.
   The first criterion, the circle of least confusion, did not serve either (the
   render stayed soft at −27.5 px): the halo drags the least squares.
   The one that remains is the fine-detail contrast (10 and 5 line pairs per
   mm of the 36 mm frame, the maximum nearest the least confusion): for the
   case's double Gauss, 601.5 mm by least confusion and 609.7 mm by
   contrast, which is where the render's own samples give most contrast
   (607–610 mm). With a single frequency and the maximum of the whole stretch, a point
   near the top edge came out at 538 mm instead of 585 (a side lobe, spurious
   resolution, above a weak main one).
3. **h1, the viewport was not the render.** The *Full* viewport widens the sensor
   to cover the viewport, and the traced lens took from the viewport's sensor the
   semi-apertures, the height of its distortion and its vignetting: with distortion, the
   viewport's pixel did not see the same as the render's. `LENS` now carries
   `frame_sensor_mm`.
4. **h1, looking through.** The *Full* viewport of a camera looked through
   used the active camera's frame: with another aspect ratio, another sensor.
5. **h2 and h4, the pose and the tracking.** On the timeline the click
   measured from the stored camera, not from the camera at that instant; and after the click
   the distance stayed still when orbiting or zooming. *Point* mode fixes it:
   the distance comes out, at each instant, from the camera as it is and from the
   point where it is.
6. **h6, the face.** The preview draws only the front face of each
   triangle and its pick did not see the back of a single-sided surface,
   which the engine does render. The ray is now cast through both faces.
7. **h5, rounding:** not a cause (only of what is shown).
8. **Another appeared while measuring:** a traced lens **breathes** (its field changes
   with the focus), so what the pixel shows moves when the
   focus reaches it (0.9 mm of depth in the corner with the tilted
   checkerboard). The click settles: it is repeated with the camera already focused until
   the point stops moving (`settledFocusPick`).

**What was done.**

- **The engine** (`rt_core::focus`, ARCHITECTURE §5.2 septendecies):
  `rt_scene_pick` (the primary ray of an image point, that of
  `generate_ray` with the pupil at its centre, and what it hits through both faces)
  and `rt_scene_focus_at` (the distance that focuses a point); `LENS
  frame_sensor_mm`; the best focus of a traced lens by contrast.
  `tools/wasm-parity.mjs --pick` and CI pin the picks of the O1 and
  O2 scenes (`PINNED_FOCUS_PICK_O1`, `PINNED_FOCUS_PICK_O2`). No render
  hash changed.
- **The click** (`main.ts focusPickAt`): the scene of only the view's camera
  as `projectScene` writes it for *Full* (`io/rsb.ts focusPickRsb`:
  pose, camera looked through with its frame, viewport image around
  the frame), the engine's ray, cast against the preview's geometry
  through both faces (`PreviewEngine.pickAlong`), settled with a traced
  lens. Without `rt.wasm` or with an earlier one (detected by the name of the
  exports, with no new `rt_features` bit), the preview's pick
  and the paraxial distance.
- **The modes** (`CameraState.focusMode`, `focusPoint`, `focusObject`;
  SPEC §3.5): the point is stored in the part's coordinates; the distance is
  resolved where it is used (`resolvedFocusDistance`, and `focusDistanceAt(state,
  camera, t)` for the queue, batches and the render window); the store leaves
  the resting one in `focusDistance` (`syncFocus`). If the part or the
  object is deleted, the camera goes back to its last distance in the same action,
  with a notice. Earlier projects, saved cameras and library studios
  are read as *Distance*; round trip on saving and opening; all undoable.
- **The interface** (UI.md): *Focus* segmented *Distance · Point · Object*;
  the distance as a logarithmic slider with its field beside it (`slider`
  now admits its own scale, `scale`, and there is `lengthSlider`); in *Point*,
  *Focus with a click* (the same undo entry); in *Object*, choosing in the
  viewport or in the tree, with the name; *Keep in focus* in a part's
  menu; four commands in the palette; the point's mark in the viewport with the
  camera selected.

**Tests.** `tests/focus-modes.test.ts` (27: each lens's rule, parity
with `rt.wasm`, tracking when orbiting, zooming in, moving the part,
animating it and animating the camera, the focus clip, *Object*, the return to
*Distance* on deleting, no NaN, undo, old and damaged projects, the
mark, the slider, the ray of a camera looked through and that of a traced
lens in the viewport, the settling); `tests/focus-browser.test.ts` (9, with
Chromium: the click in the browser lands on the engine's focus for that pixel
in six cases, the exact depth with the thin lens, the sharp band of the
tilt by the click, and the viewport without engine); `rt-core focus::tests` (10,
among them that the render's own samples, through the focus, give more
contrast where the pick focuses); `tools/focus-click-check.mjs` (15
checks on the built interface). Each fix was checked by
undoing it: the corresponding test fails (the PR report lists them).

**What did not fit the plan:**

1. **The traced lens needs the engine to focus.** Without `rt.wasm` the
   distance is the paraxial one (millimetres off, wide open). With it, solving
   costs 0.4 to 0.6 s in the page with the machine loaded (and the settled click, up to three); the frames of
   a gesture use the last difference from the paraxial for that lens.
2. **The desktop has no call of its own**: the page carries its
   `rt.wasm`, the same `rt-core` the launcher renders with; there is no
   `/api/pick`.
3. **The artistic *swirl*** enters the best focus as in the image.
4. **The camera walk (N3) is not wired**: the hook
   (`focusDistanceAt`) is there; the queue and batches are touched by N2.
5. **The library's camera reader** (`io/library.ts`) still does not read
   a camera's optics (it already was so); it reads the focus modes.
6. **`slider()`** changed inside just enough: an optional scale
   (`toUnit`/`fromUnit`, 1000 positions), together with the arrows, the compact
   variant and U15's `setDisabled` (merged).
7. **A click on glass** focuses its front face, like the rest (decided).
8. **The corner of a traced lens with artistic distortion +1** (bottom right,
   at f/1.4) still has the band at −38.5 px from the click, outside it:
   the focus written is the engine's for that pixel (0.00 mm), so what
   does not match is the best-focus criterion with what the render sees there (a
   sensor point far out, with a lot of aberration); the other traced corners
   fall inside the band. The criterion was accepted; this corner stays
   open.
9. **`cargo test --workspace`** with the machine loaded: four tests of
   `rt-app` (downloads and updates with local servers, the
   adaptive one with several threads) and four of `rt-cli` (TIFF) sometimes fail and
   pass alone; they do not touch F1.

**With K3 and N2** (merged after the phase): the pick's ray is that of
`Camera::generate_ray` with the pupil at its centre, so orthographic, the
two panoramas and straight verticals pick by themselves. `Camera::focus_distance_to`
and `core/focus.ts focusDistanceFor` were extended: a panorama is
pinhole and its focus distance (and the pick's depth, like its
pass) is the distance to the point, also behind the camera; with straight
verticals the camera that is rendered is the levelled one (`renderedCamera`),
and the distance is that of that camera divided by cos(corrected tilt), a traced
lens solved on it. Tests: the pick and the primary ray in
`rt-core focus::tests` with orthographic, equirectangular and fisheye cameras;
the TS–`rt.wasm` parity and the click path, one per projection, in
`focus-modes.test.ts`. N2: the queue and batches already write the distance that
each camera follows (resolved by the engine boundary, `viewCamera`, with the
job's camera and pose); `batch.test.ts` checks it in a cameras × studios
batch and in the frames of an animation, and fails without that
resolution.

**With O4** (merged after the phase): *Through two points* leaves the camera in
*Distance* (it could follow a point or an object) in the same undo
entry, and with a traced lens it focuses on the mean of the distances
that the engine resolves for the two points with the chosen tilt (O4's
decision 3). The best focus of a tilted traced lens uses the
samples of the tilted lens (its grid of sensor limits); the interface's paraxial
rule for it is the simple lens's hinge, like O4's plane. The earlier
unused focus functions
(`camera.ts focusDistanceTo`, `interior-camera.ts focusDistanceFor`) were
removed; their tests point to `core/focus.ts focusDistanceFor`.

**Decisions** (2026-10-17, by the session lead; they were ◆): the *Object*
follows the centre of its box (the other two candidates remain written and unused); the slider's range and logarithmic scale, as they are; in
*Point* and *Object* the slider shows the distance that comes out and **moving it moves
the camera to *Distance*** from there, in a single undo entry (the
slider is not redrawn when the mode changes, so the drag
continues; `tools/focus-click-check.mjs` checks it); the best focus of a
traced lens by the contrast of 10 and 5 line pairs per millimetre, the maximum
nearest the least confusion (the corner with distortion +1 stays open);
a focus clip on a camera in *Point* wins, as now; a click on a
glass focuses its front face.

## Suggested order

1. **U1** (Opus) and **E1** (Sonnet), in parallel: the interface and the
   engine skeleton. Without the first there is nowhere to see anything; without the
   second there is nowhere to build the tracer.
2. **E2** → **E3** (Opus): acceleration and integrator. Meanwhile,
   **U2**, **I1** and **I3** (Sonnet): project in a file, OBJ and STL, and the
   rest of the importers with the import sheet. Import is
   the trunk: it goes ahead of everything that is not the engine.
3. **E4** (Opus): the engine in the browser. It closes v0.1 with a real render
   in the viewport and on the command line.
4. **U5** (render window), **I2** (STEP and IGES), **L4** (own
   lights): what makes it behave like KeyShot in daily use
   (U3 and U4 are already there).
4 bis. **First release `v0.1.0`**, on request: **U2**
   (project in a file), **X1 part A** (files and `sha256` of the
   models), **U6** (Settings and model manager), **P2** (launcher,
   portables and installer; the launcher and the native engine can start
   in parallel with U5) and **P1** (the release). L4 follows afterwards.
5. **E5** → **E6** → **L1** → **L2** → **L3**: light and materials
   until the 72 recipes are reviewed on the own engine.
6. **M1**, **N2**, **D1**, **P1**: they close v0.2.
7. **E7**, **M2**, **N1** → **N3**, **L5**, **E8**, **Q1**, **P2**,
   **X1** → **X5** (AI post-processing, `AI-POST.md`), and **K1** →
   **K2** → **K3** (scene type, room and interiors camera):
   v0.3.
8. **K4** → **K5**, **K6**, **K7**, **K8**: interiors and furniture, v0.4.
9. **H1** at the close of each version.
