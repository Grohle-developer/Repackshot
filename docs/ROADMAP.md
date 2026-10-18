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

What did not fit or was left open, for E2–E4: the RNG seed is
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
  distances in metres; see *What did not fit*): point and spot
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
  See *What did not fit*.
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
when connecting the engine. The rest of the “did not fit” items (1–7, 9): accepted as is; the RSB's `PROG`
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
by tone (see “did not fit” 6 and 7); the flakes, by place (8). With the
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
   the parts with the box as the surface (M3c, “What did not fit” 6) and seen in
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
  is a soft halo with grain. On the “What did not fit” points: (9) the
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

## L1 · Colocación por reflejo, campo claro, luces editables — **Sonnet**

**Qué.** Colocación por reflejo exacta con `pick` del motor en Rust
(reflejar el rayo de cámara en la normal picada y poner el foco a su
distancia);
campo claro por entorno para `camera = true` (disco suave en coordenadas
de ventana, radio aparente a partir del tamaño y la distancia del panel,
radiancia acotada), de modo que ningún foco se vea nunca como objeto con
bordes; edición foco a foco con `modified`; *Restablecer montaje*.

**Depende de.** E4.

**Criterio.** Test geométrico: con una esfera y un clic en su punto
(x, y), el foco acaba en la dirección reflejada (producto escalar > 0.999);
captura de BACKLIT, SILHOUETTE y ECLIPSE con el disco visible y sin
rectángulos.

## L2 · Miniaturas propias — **Sonnet**

**Qué.** `tools/render-thumbs.mjs`: genera un RSB por miniatura con
`src/io/rsb.ts` y las renderiza con el binario nativo `rt` (sin
navegador, en CI): las 72 miniaturas de montaje (160 × 120 y 64 × 64) con
la pieza de ejemplo en gris neutro, y las esferas de los 77 materiales,
con el hash de su receta en un chunk `tEXt` del PNG; `--check` falla si
alguna está desactualizada y la suite lo ejecuta. Sustituye las PNG
anteriores de `public/thumbs/`.

**Depende de.** E4, E5 (para que las de color y vidrio salgan bien).

**Criterio.** `--check` en verde en CI; cambiar un número de un montaje
sin regenerar hace fallar la suite.

## L3 · Revisión fotográfica de las recetas — **Fable**

**Qué.** Con la hoja de contactos de E3/E5 y las miniaturas de L2, revisar
los 72 montajes y los 16 rigs de tipo de producto sobre el motor propio y
ajustar **solo datos** (`src/data/light-setups.ts`, `studios.ts`). Lo que
se mide: un brillo por fuente con la forma de la fuente; menos del 1 % de
píxeles de la pieza quemados a exposición 0; luminancia media de la pieza
dentro de ±0.3 EV entre montajes del mismo tipo de producto; nada de
zonas negras por encima del 5 % en fondos claros; la miniatura tiene el
brillo donde el render.

**Datos de partida (corrección de la potencia de las luces, tras U5).**
Las recetas se evalúan ya con la convención de Cycles. Con JEWELLERY, la
irradiancia de los focos frente a la de la cúpula sobre una cara hacia
arriba es 2,31× en campo lejano y 1,4–1,9× integrando el panel; la cúpula
sigue dando cerca de la mitad del brillo de la pieza, igual que en
Blender con los mismos valores. REMBRANDT frente a NEON_NOIR cambian el
48 % de los píxeles de la pieza (77 % sin cúpula). El equilibrio entre
focos y cúpula por tipo de producto lo decide Fable aquí;
`tools/setup-contrast.mjs` lo mide.

**Depende de.** E5, L2.

## U7 · Arrastrar un material y selección por caja — **Sonnet** — hecha

**Qué.** Arrastrar un material (una miniatura del catálogo, de *Míos* o
la esfera del material de la selección) sobre una pieza del visor o
sobre una fila del árbol, con resaltado (`UI.md` §2.2 y §2.3). Con la
herramienta *Seleccionar*, selección por caja (ventana y cruce) a cada
nivel (`UI.md` §4.1), que se añadió a la fase con ella empezada.

**Depende de.** U1, U4.

**Criterio.** Reglas de la asignación por arrastre como acción pura con
números; la selección por caja probada sobre geometría proyectada;
comprobación en el navegador con ratón, lápiz y dedo en *Rápido* y
*Completo*.

**Hecho.**

*Arrastrar un material.* Con eventos de puntero, no con el arrastrar y
soltar del navegador (un *webview* de escritorio no siempre da la sesión
nativa, y no deja decidir el fantasma, el lápiz ni `Esc`):
`src/ui/components/material-drag.ts` es el controlador (umbral de 5 px,
miniatura fantasma sobre y a la derecha del puntero, zonas de suelta
registradas por elemento, `Esc` en fase de captura, clic tragado tras
arrastrar; un dedo no arrastra y conserva su gesto de siempre). Las
reglas viven en `src/core/material-drop.ts` y se prueban con números: en
el visor, una suelta alcanza lo que seleccionaría un clic al nivel
vigente (pieza, ensamblaje, modelo o, a nivel *Caras*, la cara entera
bajo el cursor); en una fila del árbol, el nodo y todo lo que cuelga de
él. Un preset del catálogo o un elemento de la biblioteca entran con
**la instancia que la escena ya tiene de él** (la misma que un clic en
la miniatura, así que soltar y hacer clic dejan el mismo proyecto); la
esfera de la selección enlaza con **esa instancia**; con **`Alt`** la
suelta da **una copia propia** (`material/assign` con `copy`, etiqueta
*asignar una copia*). Siempre es **una sola acción** `material/assign` y
una entrada de deshacer, con el nombre del material y del destino.
Resaltado: contorno (el del visor) en las piezas, tinte en las caras y
borde discontinuo en la fila del árbol, que además contornea en el visor
lo que alcanzaría; el fantasma pone *Copia* mientras se pulsa `Alt`.
`src/core/materials.ts` gana `copy` y `material/assign` ya no crea
entrada cuando no cambia nada.

*Selección por caja.* `src/core/box-select.ts` (puro, en píxeles de
pantalla) y `src/ui/panels/viewport-box.ts` (el gesto). **`Ctrl/⌘` +
arrastrar** dibuja la caja con *Seleccionar* y con *Mover* (donde no hay
un asa bajo el puntero), en los tres esquemas del ratón; sin `Shift` ni
`Alt` **sustituye** la selección, con `Shift` **añade** y con `Alt`
**quita**. De izquierda a derecha es una **ventana** (lo que queda
entero dentro; contorno continuo), de derecha a izquierda es **cruce**
(lo que toca; contorno discontinuo), ambos acromáticos. Al nivel
*Pieza*, *Grupo* o *Modelo* se prueba la geometría proyectada (primero
la caja envolvente, luego los triángulos; sin mirar qué tapa a qué, como
en un CAD: una pieza detrás de otra también se coge, y las ocultas no
cuentan); a nivel *Caras* coge las caras enteras (CAD o por continuidad,
ver **M1**) de una pieza, con el botón *Rayos X* en la barra de vista
para coger también las ocultas. Un arrastre de unos pocos píxeles es un
clic, `Esc` cancela, el lápiz hace lo que el ratón y un dedo no dibuja
caja (sigue orbitando); la selección no se deshace (una caja no es una
entrada de historial). Con los esquemas que dejan libre el botón
izquierdo (*Alt + botón izquierdo orbita* y *Botón central orbita*), un
arrastre sin más ya dibuja la caja y `Shift` añade sin `Ctrl`; con
*Botón central*, `Alt` quita sin `Ctrl`; con *Alt + botón izquierdo*,
`Alt` es la órbita y quitar es `Ctrl/⌘ + Alt`. Los clics no cambian:
clic selecciona, `Shift` clic añade, `Ctrl/⌘` clic mete o saca, `Alt`
clic quita (salvo con *Alt + botón izquierdo orbita*, donde `Alt` es de
la cámara). En *Completo* se usa la geometría de la vista previa, igual
que `pick`. Nuevos métodos de `ViewportPort`: `projection`,
`visibleTriangles` y `setHoverFaces`.

*Decisión del usuario sobre el gesto (2026-10-13).* El botón izquierdo
sigue orbitando por defecto, y **`Ctrl/⌘` + arrastrar** es la caja; la
primera versión armaba la caja con `Shift`, `Ctrl` o `Alt`. Lo que
cambia respecto al visor anterior: con *Seleccionar* y *Mover*, `Ctrl/⌘`
+ arrastrar con el botón izquierdo ya no desplaza (era el atajo oculto
de los controles de órbita; quedan el botón derecho, la rueda y la
herramienta *Desplazar*). `Shift` + arrastrar y `Alt` + arrastrar no
arman nada y hacen lo que hacía la cámara antes. El texto de *Ajustes ▸
Preferencias ▸ Visor y navegación ▸ Ratón* y el tooltip de *Seleccionar*
lo dicen en los dos idiomas, y se comprobó en el navegador que no
desbordan (la fila de Ajustes pasa a cuatro líneas y el tooltip cabe en
sus 280 px).

*Pruebas.* 89 tests nuevos (25 de `material-drop.test.ts`, 35 de
`box-select.test.ts` y los 29 de M1 en `faces.test.ts`; 1031 en total);
63 mutaciones de los tests unitarios, todas detectadas salvo dos
equivalentes (F9, y la de que `Ctrl` no arme en *Alt + botón izquierdo
orbita*, que ya arma antes por otra rama), y 16 en el navegador, todas
salvo una guarda de orden entre el resaltado de la suelta y el contorno
al pasar que el navegador no puede observar.
`tools/material-drag-check.mjs` y `tools/box-select-check.mjs`
(Playwright con el Chromium local, en *Rápido* y *Completo*, con ratón,
lápiz y dedo); capturas `docs/ui/material-drag.png`,
`material-drag-tree.png`, `material-drag-faces.png`, `box-window.png`,
`box-crossing.png` y `box-faces.png`. Las de *Completo*, que pesan
mucho, se escriben en `out/` y no entran en el repositorio.

No encajó con el plan:

- **La suelta sobre un destino con materiales distintos conserva la
  pregunta en línea de `UI.md` §4.1** (*Sustituir todos · Mantener los
  existentes · Cancelar*, con inventario): es el caso de soltar sobre
  un grupo o un modelo cuyas piezas llevan materiales distintos. La
  fase pedía "una sola acción" y lo es (una entrada de deshacer una
  vez respondida), pero no se aplica a ciegas. Si se prefiere que una
  suelta sustituya sin preguntar, es una decisión de interfaz (Fable);
  mientras tanto vale lo que dice §4.1.
- **A nivel *Caras* el catálogo solo aparece cuando hay una cara
  seleccionada**, así que no hay miniatura que arrastrar antes de
  coger la primera; la suelta cae en **la cara bajo el cursor**, no en
  las seleccionadas.
- **El resaltado del arrastre ignora el ajuste *Contorno al pasar*:**
  sin él, soltar no tendría ninguna señal de a dónde va.
- **Un dedo no arrastra ni dibuja caja** (conserva lo que hacía:
  desplazar los paneles y orbitar); el lápiz es un ratón.
- **La caja no enseña una vista previa de lo que cogerá:** solo el
  rectángulo; la selección cambia al soltar.
- **En el esquema por defecto la caja no se dibuja con un arrastre sin
  más**, sino con `Ctrl/⌘` + arrastrar (decisión del usuario): el
  botón izquierdo orbita y una caja con un arrastre sin más le
  quitaría la órbita. Quien la quiera sin tecla puede elegir el
  esquema *Alt + botón izquierdo orbita* o *Botón central orbita*.
- Dos cosas de estructura: los clics de `Alt` sobre el visor pasan por
  `clickMods` para respetar el esquema *Alt + botón izquierdo orbita*,
  y `ViewportPort` se amplió con tres métodos (`ARCHITECTURE.md`
  §6.1).

## M1 · Cara CAD entera — **Sonnet** — hecha

**Qué.** Selección de caras por continuidad de superficie: adyacencia
por **posición** de vértice
(soldadura a 1e-5 del tamaño de la malla), cruce de arista si el diedro es
menor que el ángulo de arista viva (30°) **y** menor que 2.5 veces la
curvatura propia de la cara clicada; las aristas marcadas por el
importador cortan siempre; `Shift` da el triángulo suelto. Con STEP (I2),
los rangos de cara originales ganan.

**Depende de.** U1, I1.

**Criterio.** Tests con placa, placa con vértices duplicados, cilindro
con tapas (la pared entera, se para en las tapas), perfil
plano-redondeo-pared, arista marcada. Verificar que cada uno falla si se
quita su condición.

**Hecho.** `src/core/faces.ts` (modelo puro): `cadFaceRegion` hace
crecer la cara desde el triángulo picado con las reglas de arriba y, en
una pieza de STEP o IGES, devuelve el rango CAD que lo contiene (los
rangos ganan); la topología se calcula una vez por malla y se guarda en
un `WeakMap`. En el visor, a nivel *Caras* un clic coge **la cara
entera**: clic sin más sustituye, `Shift` añade **un triángulo suelto**,
`Ctrl/⌘` mete o saca la cara entera y `Alt` la quita; al arrastrar un
material se tiñe la cara que recibiría (`ViewportPort.setHoverFaces`).
*Separar por caras CAD* (`scene/separateByCadFaces`) deja de ser
*próximamente*: está en el menú de pieza y en la hoja de importación
(que ahora usa el mismo `facePieces`), cada pieza nueva conserva el
color de su cara, la selección sigue a las piezas y el nivel pasa de
*Caras* a *Pieza*. La acción comparte `replaceByPieces` con *Separar por
material*. Además la selección por caja (ver **U7**) coge caras enteras.
29 tests nuevos (`tests/faces.test.ts`: placa, placa con vértices
duplicados, cilindro con tapas, perfil plano-redondeo-pared, arista
marcada, rangos CAD, piezas separadas; las mutaciones se cuentan en
**U7**); capturas `docs/ui/box-faces.png` y
`docs/ui/material-drag-faces.png`; comprobado en el navegador con
`tests/fixtures/box.step` (seis caras CAD).

No encajó con el plan:

- **Límite del borde con curvatura suave (decisión pendiente de
  Fable).** La estimación de la curvatura solo cuenta las aristas que
  se podrían cruzar (test *a flat face is flat to its rim*): si contara
  también las que son frontera (marcadas o más agudas que 30°), un
  triángulo en el borde de una cara plana, junto a una pared, mediría la
  curvatura de la esquina y la cara se escaparía por un chaflán. Queda
  el caso que un clic sobre una malla no puede distinguir: un triángulo en el borde de una cara plana cuya única
  arista que gira es un redondeo suave (unos pocos grados por paso)
  parece una faceta de una cara curva, y la cara sigue el redondeo; el
  interior de la misma cara plana no. No afecta a STEP ni IGES (los
  rangos no dudan) y la cabecera de `faces.ts` lo cuenta. Datos para
  decidir si basta o si hace falta un criterio de malla (por ejemplo,
  medir la curvatura en el interior de la región ya cogida): no se ha
  cambiado nada por cuenta propia.
- **`Shift` suelto y `Shift` añade.** M1 pedía "`Shift` da el
  triángulo suelto" y `UI.md` §4.1 "`Shift` añade": a nivel *Caras*,
  `Shift` hace las dos cosas, `Shift` clic **añade el triángulo
  suelto**. Como `Shift` solo vuelve suelto el triángulo y el resto de
  teclas conservan su sentido, `Ctrl/⌘ ⇧` clic lo mete o saca y `Alt
  ⇧` clic lo quita (con *Alt + botón izquierdo orbita*, donde `Alt` es
  de la cámara, no hay `Alt ⇧`); `Ctrl/⌘` y `Alt` sin `Shift` actúan
  sobre la cara entera.
- **La caja de caras trabaja sobre una sola pieza** (`Selection.faces`
  es `{part, indices}`): la seleccionada y, si no hay, la que está en
  el centro de la caja. Sin *Rayos X* solo coge lo que se ve, medido
  con un pase de identificadores del visor (un id por triángulo, con
  una erosión de un píxel para que no cuenten las siluetas de lo
  oculto), así que una cara más estrecha que unos 3 px no se coge; con
  *Rayos X* coge también las ocultas, por geometría.
- ***Separar por caras CAD* solo existe para piezas con rangos** que
  cubren la malla (`canSeparateByFaces`); en una malla sin ellos sigue
  deshabilitado en lugar de partir por continuidad.
- **El contador dice *caras* y cuenta triángulos** (`inspector.faces`:
  un cubo de seis caras CAD entero dice *12 caras de* su pieza): el
  modelo de datos guarda triángulos. Contar caras CAD pide guardar
  también qué rangos se han cogido; se deja anotado.
- **Un clic no tiñe la cara antes de cogerla**: al pasar el ratón sin
  arrastrar nada, a nivel *Caras* solo se contornea la pieza; la cara
  se ve al cogerla. El tinte previo es solo el del material
  arrastrado.
- La ayuda que `UI.md` llamaba `faceSel.help` no existe con ese
  nombre: era `level.tip.FACES`, que ya no dice "próximamente" (se
  reescribió), y se quitó `ops.separateCadSoon`.
- Arreglos de fallos que ya estaban: el inspector no se reconstruía al
  coger la primera cara (`contextKey` no distinguía si había caras;
  con test), y `material/assign` sin cambios creaba una entrada de
  deshacer vacía (ahora devuelve el mismo estado; con test).

## U9 · Primitivas y herramienta de escalar — **Opus** — hecha

**Petición del usuario (2026-10-13):** «quiero poder añadir geometrías
sencillas, algo así como rectángulos de base, cilindros, esferas… y con el
paneo, el típico apartado de escalar, aparte de poder escalar cada pieza
con clic derecho».

**Decisiones del líder.**
- **Añadir ▸ Primitiva** (menú *Añadir* de la cabecera, el botón `+` del
  panel *Escena*, la paleta de comandos y el menú contextual del visor en
  vacío): *Caja* (con radio de bisel), *Plano*, *Disco*, *Cilindro*,
  *Pedestal* (cilindro con bisel), *Esfera*, *Cono*, *Toro*, *Cápsula*,
  *Tubo*, *Escalones* y *Fondo infinito* (la curva de estudio: suelo que
  sube en curva hasta una pared). Claves estables en un catálogo de datos.
- **Paramétricas y vivas**: cada primitiva guarda su tipo y sus medidas en
  mm (ancho, fondo, alto, radio, bisel, segmentos…), editables en el
  inspector (sección *Primitiva*); cambiar una medida regenera la malla con
  **una acción del *store*** y una entrada de deshacer (un arrastre, una
  sola). *Convertir en malla* la congela.
- **Tamaño y sitio por defecto con criterio de estudio**: se crea apoyada
  en el suelo, junto al producto o debajo si es una base (la *Caja* y el
  *Pedestal* nacen como base: 1,4 × la huella del producto y el producto
  apoyado encima), escalada a la escena; sin producto, a un tamaño
  razonable. Material neutro del catálogo.
- **Geometría limpia**: generación pura y determinista en `src/core/`,
  normales y UV correctas (para M2), suavizado por ángulo, y **caras CAD**
  (`faceRanges`) por cara lógica (la tapa, el lateral, el bisel…), para
  que el nivel *Caras* y M1 funcionen con ellas.
- **Proyecto**: la primitiva se guarda como parámetros (no como malla) en
  un campo opcional del nodo; *schema* 2 sigue valiendo y un proyecto
  antiguo abre igual. El motor la recibe como una malla más (RSB sin
  cambios).
- **Herramienta *Escalar*** (`S`) en la barra de vista, junto a
  *Desplazar*: el mismo *gizmo* de *Mover* pero solo con las asas de
  escala (por eje y uniforme en el centro), alrededor del pivote, en ejes
  locales o globales, con incrementos con `Shift`; el inspector muestra
  la escala en vivo. Un arrastre, una entrada de deshacer.
- **Clic derecho ▸ Escalar…** en una pieza (visor y árbol): un panel en
  línea con *Uniforme* (%), por eje (X, Y, Z en %) o **a medida** (mm del
  ancho, fondo o alto con proporción bloqueada), *Aplicar* y *Restablecer
  escala*; actúa sobre la selección al nivel vigente.

**Criterio.** Tests de cada primitiva (cerrada donde debe, normales hacia
fuera, UV en [0, 1], `faceRanges` que cubren la malla, determinismo,
medidas exactas en mm), de la regeneración deshacible, del guardado y la
apertura, de la escala por eje, uniforme y a medida (alrededor del
pivote, a cada nivel); capturas del menú, del inspector y de la
herramienta; cadenas en `es` y `en`; cromo acromático.

**Hecho.** `src/data/primitives.json` (+ `primitives.ts`): las doce formas
con claves estables (`BOX`, `PLANE`, `DISC`, `CYLINDER`, `PEDESTAL`,
`SPHERE`, `CONE`, `TORUS`, `CAPSULE`, `TUBE`, `STEPS`, `SWEEP`), su papel
(`BASE`, `FLOOR`, `BACKDROP`, `OBJECT`), sus medidas (claves, mínimos,
pasos, factor del tamaño de la escena o valor fijo) y el material neutro
`WHITE_STUDIO`; los nombres y las etiquetas de las medidas son cadenas de
la interfaz. `src/core/primitives.ts`: generadores puros y deterministas,
en mm, Z arriba, **centrados en su caja** (que es exactamente sus medidas:
senos y cosenos exactos en los múltiplos de 90°, ningún `h − b + b`), con
un constructor que orienta cada triángulo hacia sus normales y quita las
astillas; superficies de revolución con polos por segmento (la punta del
cono tiene la normal de su faceta), caja redondeada con aristas y esquinas
que se encuentran bit a bit (tabla de cuarto de vuelta simétrica),
escalones en rejilla sin uniones en T, fondo infinito desenrollado;
estancas salvo plano, disco y fondo; normales de la superficie dentro de
cada cara lógica; UV en [0, 1] por cara y sin estirar; cada cara lógica es
un rango de `faceRanges` (y su borde, arista viva), así que *Caras*, M1 y
*Separar por caras CAD* funcionan; medidas acotadas a lo que da una forma;
el id de malla `prim:<dueño>:<FORMA>:<medidas>` nombra contenido y dueño.
`src/core/primitive-ops.ts`: `placePrimitive` (base 1,4 × la huella bajo
el producto, con el producto encima; planos bajo él, una milésima sobre el
suelo; el resto junto a lo que está de pie; sin producto, en el origen y
encuadrado), `fitSweep` (decisión del líder durante la fase, tras ver las
primeras capturas: el fondo infinito de cara a la cámara activa, girado en
Z a su acimut, la pared a 1,75 fondos del producto detrás de él y detrás
de los focos del montaje que quedan detrás del producto
(`wallBehindLights`), ancho 1,3 veces el encuadre donde lo toca, por
encima de lo más alto del encuadre, curva de 0,3 veces el alto;
*Ajustar a la cámara* lo rehace con `scene/fitPrimitive`), y las acciones `scene/addPrimitive` (una entrada de
deshacer con el levantamiento), `scene/setPrimitive` (regenera, conserva el
apoyo, arrastra las copias enlazadas, los materiales por cara y las caras
seleccionadas siguen a sus caras por nombre) y `scene/convertPrimitive`.
`SceneNode.primitive` es el campo opcional del proyecto: `io/project.ts`
no escribe esas mallas y las regenera al abrir (esquema 2, byte a byte).
Herramienta *Escalar* (`S`, junto a *Desplazar*): el *gizmo* con solo
asas de escala (`Gizmo.setMode('SCALE')`, cubos al final de ejes enteros
que se cogen y el punto central; una longitud de cubo más duplica);
*Clic derecho ▸ Escalar…* con `ui/panels/scale-panel.ts` (uniforme, por
eje, a medida con candado, *Aplicar* y *Restablecer escala* =
`scene/resetScale`) en el visor y en el árbol; `selectionExtents` mide la
selección en los ejes en vigor. *Añadir ▸ Primitiva* en el menú de la
cabecera, el `+` del panel *Escena*, la paleta (*Añadir caja*…) y el menú
del visor en vacío; sección *Primitiva* del inspector con *Convertir en
malla*, que también está en *Geometría ▸*. Pruebas: `tests/primitives.test.ts`
(cada forma: mismos bytes, caja exacta y centrada, UV, normales, caras que
cubren la malla, estanqueidad, aristas vivas, volúmenes analíticos, medidas
acotadas, id) y `tests/primitive-ops.test.ts` (colocación, base y huella,
producto encima, una entrada de deshacer, producto bloqueado, planos y
fondo, el pivote de luces y la escala que no ven el decorado, edición viva y
deshacer, copias enlazadas e independientes, caras pintadas y
seleccionadas, convertir, guardar y abrir byte a byte, forma desconocida y
medidas fuera de rango en un archivo, escala uniforme, por eje (también en
ejes locales) y a medida alrededor del pivote a nivel *Modelo*, *Grupo* y
*Pieza*, *Restablecer escala*, las asas de *Escalar*, el atajo y las
cadenas). `tools/primitives-check.mjs` lo comprueba en el navegador en
*Rápido* y *Completo* y hace las capturas `docs/ui/primitives-add-menu.png`,
`primitives-base-box.png`, `primitives-pedestal.png`,
`primitives-pedestal-full.png`, `primitive-inspector.png`,
`scale-tool.png` y `scale-panel.png`, y además comprueba con los píxeles
que el fondo infinito llena el encuadre (esquinas y centro del borde de
arriba claros, no la cúpula oscura) y que *Ajustar a la cámara* lo
rellena tras orbitar. 133 tests nuevos (91 de `primitives.test.ts` y 42
de `primitive-ops.test.ts`; 1627 en total); 42 mutaciones del código
nuevo, todas detectadas (cinco no lo eran a la primera: el recorte de las
UV ocultaba un mapeo malo y se quitó, y la normal de la punta del cono, los
materiales por cara que se desplazan, lo que está de pie junto a un fondo
y un fondo que se aleja por su curva no tenían test o lo tenían demasiado
permisivo; se arreglaron los tests).

No encajó con el plan:

- **El producto, no el decorado.** Un fondo infinito seis veces mayor que
  el producto movía el pivote de las luces (`rigPivot` era el centro de la
  escena), el encuadre de *Crear estudio*, el tamaño medido (y el chequeo
  de escala del Doctor, cuyo arreglo reescalaría todo) y el mapa de
  sombras. Ahora todos miden `productBounds`: las piezas que no son
  primitivas (si solo hay primitivas, todas). Es un criterio de
  arquitectura que no estaba en el plan; *Encuadrar todo* sigue
  encuadrando todo. Si Fable prefiere marcar el decorado de otro modo (por
  ejemplo, solo bases y fondos, no cualquier primitiva), es un cambio de
  una función.
- **El tamaño de pieza** se detecta ahora también cuando entra el primer
  producto en una escena que solo tenía primitivas (antes, solo en una
  escena vacía).
- **Mallas centradas, no apoyadas en su origen**: el Doctor avisaba de un
  origen descentrado en cada primitiva y su arreglo la desplazaba. La
  pieza conserva su apoyo al cambiar medidas por el centro de la base de
  su caja, en sus propios ejes.
- **Planos, disco y fondo infinito una milésima sobre el suelo**: su cara
  de arriba está donde el suelo del estudio, que en el motor es un *shadow
  catcher*, y un empate de distancias entre los dos parpadea. Por encima
  gana la geometría, que recibe sombras de verdad en *Completo*; en
  *Rápido* la sombra de contacto queda bajo el fondo (la vista previa solo
  la dibuja en el suelo). No se apaga el suelo del estudio al añadir un
  fondo: es una decisión fotográfica (Fable).
- **Una versión anterior a U9 no ve las primitivas** de un proyecto nuevo
  (no hay malla en el archivo; abre con el aviso de geometría que falta):
  la compatibilidad es hacia atrás, como se pidió.
- **Cambiar las medidas de una base no vuelve a subir el producto**, y
  una base nueva bajo un producto que ya está sobre otra va al suelo (el
  producto se apoya en la nueva). Una pieza escalada con *Escalar* sigue
  mostrando sus medidas sin escala en la sección *Primitiva* (la nota lo
  dice).
- **Invertir normales, Suavizado y Separar congelan la primitiva** (dejan
  de ser paramétricas), porque su malla ya no es la de sus medidas.
- **El fondo infinito se ajusta a la cámara**, no a los ejes del mundo
  (petición del líder a mitad de fase): las primeras capturas dejaban ver
  el entorno oscuro en una esquina del encuadre. Si la curva llegaría bajo
  el producto (un producto muy plano de fondo), la pared se aleja más de
  los 1,75 fondos. Mover la cámara después no lo reajusta solo: para eso
  está *Ajustar a la cámara*. El test lanza rayos por una rejilla de 7 × 7
  del encuadre en ocho cámaras (de frente, cenital, ortográfica, tele en
  vertical, gran angular cuadrada, un producto delgado) y todos dan en el
  fondo.
- **Un fondo infinito tapaba los focos que quedan detrás de su pared
  (decidido por Fable a mitad de fase).** Con el montaje *Estándar* y la
  cámara de referencia, el contraluz (*RIM*, 70 W, a unos 290 mm detrás
  del producto) quedaba detrás de la pared, que estaba a 154 mm: en
  *Completo* la pared lo tapaba y la imagen salía más plana y gris que en
  *Rápido* (la vista previa no hace sombras de los focos). **Decisión:** un
  fotógrafo pone el papel lo bastante atrás para que el contraluz y los
  focos traseros quepan entre el producto y el fondo, así que la luz que
  eligió el usuario sigue funcionando. `fitSweep` (al añadir y en
  *Ajustar a la cámara*) lleva la pared detrás de cada foco encendido del
  montaje que está detrás del producto según la dirección de la cámara, a
  1,25 veces lo que ese foco está detrás del centro del producto más la
  mitad de su panel (`SWEEP_FIT.lights`, `wallBehindLights`; un sol no
  cuenta), y luego calcula ancho, alto y curva para cubrir el encuadre a
  esa distancia como antes. En la vista de referencia la pared pasa de
  154 mm a unos 480 mm. Los focos traseros que acaben dentro del encuadre
  quedan fuera de esta decisión. Test: con el montaje *Estándar* y la
  cámara de referencia ningún foco queda detrás de la pared (falla con la
  distancia antigua), y sin focos detrás la pared vuelve a estar a 1,75
  fondos.
- **El nombre de *Añadir*.** No hay un menú *Añadir* propio en la cabecera
  (UI.md §2.1 es *nada más*): es una entrada *Añadir ▸* del menú de
  aplicación, con el rótulo *Primitiva* y las doce formas debajo.
- *Escalar…* del menú contextual no muestra atajo (`S` enciende la
  herramienta, no abre el panel). Los modificadores de la caja de
  selección y los clics son los de *Mover*.

## U10 · Recorrido guiado y avisos de la IA — **Sonnet** — hecha

**Petición del usuario (2026-10-13):** «avisar si no se tiene instalado el
*inference runtime*; la primera vez que se inicie la app, un tutorial que
se pueda saltar pero que te guíe por todas las opciones; al instalar, si
se selecciona la IA, que pida instalar también el *inference runtime*».

**Decisiones del líder.**
- **Recorrido guiado** al primer arranque (y desde *Ayuda ▸ Recorrido
  guiado*): una capa propia (nunca ventanas del navegador) que resalta
  cada zona en orden — cabecera y menú, árbol y niveles de selección,
  herramientas de vista (Seleccionar, Mover, Escalar, Orbitar, Desplazar,
  Zoom, caja con `Ctrl`), *Rápido/Completo*, inspector (producto, luz y
  montajes, entorno y cielo, cámara y enfoque con clic, materiales y
  arrastre), pestañas de luces, cámaras y estudios, *Añadir ▸ Primitiva*,
  ventana de render (cola, IA), visor de resultados y *Ajustes* por
  secciones — con un texto corto por paso, *Siguiente · Atrás · Saltar*,
  puntos de progreso y teclado (`→`, `←`, `Esc`); en `es` y `en`;
  acromático; usa los `data-guide` que ya existen. Se recuerda en el estado
  de la plataforma (carpeta de datos en escritorio) que ya se vio; *Saltar*
  cuenta como visto.
- **Aviso del motor de ejecución**: si hay un modelo de IA y no está el
  motor de ejecución (o le falta Visual C++), la sección de IA de la
  ventana de render y *Ajustes ▸ Post-procesado IA* lo dicen con un botón
  *Instalar*; al arrancar, una nota discreta en la barra de estado, una
  sola vez por sesión.
- **Instalador**: si en el paso *Modelos de IA* se elige algún modelo, se
  marca también el **motor de ejecución** recomendado para el equipo
  (Vulkan con GPU, CPU sin ella), se puede desmarcar, y la app lo
  descarga en el primer arranque como los modelos (la regla de P2: el
  instalador elige, la app descarga). Lo mismo en el selector del primer
  arranque de los portables.

**Criterio.** Tests del orden del recorrido (todos los pasos apuntan a algo
que existe; ningún paso apunta a un elemento oculto), de *Saltar* y del
recuerdo (no vuelve a salir; sí desde *Ayuda*), del aviso con y sin motor
de ejecución, del archivo de elección del instalador con el motor
incluido (y del NSIS que lo escribe); capturas de tres pasos y del aviso.

**Hecho.** *Recorrido guiado* (`src/ui/tour.ts`, `src/ui/panels/tour.ts`,
`src/ui/tour.css`; `UI.md` §4.7): 30 pasos en la web y 31 en el escritorio,
en el orden de arriba (bienvenida, menú, piezas y niveles, herramientas,
*Rápido/Completo*, producto, luz, entorno, cámara, materiales, las tres
pestañas, *Añadir ▸ Primitiva*, *Render…*, ventana de render, cola, IA,
resultados, una sección de Ajustes por paso y el cierre), con texto corto en
`es` y `en`, *Siguiente · Atrás · Saltar*, un punto por paso y `→ ← Esc`. Es
modal (se queda con el puntero y con todas las teclas: `Supr` no borra bajo
él), acromático, y localiza las zonas por los `data-guide` (los de la guía y
los nuevos). Un paso cuya zona no está a la vista la pone (pestaña, panel
lateral —en una ventana estrecha solo el que hace falta—, ventana de render
o de Ajustes, cajón *Cola*, catálogo de materiales, selección) y al terminar
todo vuelve a como estaba; un paso cuya zona no aparece en 0,7 s se salta.
La tarjeta va al lado de la zona, fuera de la ventana de render o de
Ajustes cuando hay sitio y, si no, dentro, donde no tape ningún control.
*Saltar*, *Hecho* y `Esc` cuentan como visto: `layout.tourSeen` en el
documento de ajustes (la carpeta de datos en escritorio, nada en el
almacenamiento del navegador allí). Sale solo en el primer arranque, tras el
selector de modelos de un portable, y desde *Ayuda ▸ Recorrido guiado* (nuevo
submenú del menú de la aplicación, y la paleta).

*Aviso del motor de ejecución*: `runtimeWarning` (`core/ai-runtimes.ts`, puro)
dice qué pasa con un modelo instalado —no está, en pausa, bajando, no
arranca, falta Visual C++ en Windows, no hay compilación para el sistema—;
`ui/ai-runtime-state.ts` tiene el único sondeo del lanzador; el recuadro con
*Instalar · 26 MB* (el flujo de la fila del motor de Ajustes), *Reanudar*,
*Pausar*, *Instalar el entorno de Microsoft Visual C++…* y *Comprobar de
nuevo* sale en la sección de IA de la ventana de render (con una marca en su
título plegado) y arriba de *Ajustes ▸ Post-procesado IA*, y la barra de estado
lleva una nota discreta una sola vez por sesión. **Instalador**: `repackshot
--hardware` escribe `[runtime]` (la compilación que elige la regla de
`ai-runtimes.json` para el sistema; con `--device cpu`, la de CPU), el paso
*Modelos de IA* marca la casilla al elegir el primer modelo, se puede
desmarcar y anota `"runtime"` en `pending-models.json`; el lanzador la
descarga en el primer arranque (`Ai::start_pending_runtime`); el selector del
primer arranque de un portable la ofrece igual y la baja con el primer
modelo. Tests: la regla, la tabla de avisos, el sondeo, la nota una vez por
sesión y los botones (`tests/ai-runtime-warning.test.ts`); el orden del
recorrido, que cada ancla existe en el código, que cada paso abre lo que
necesita y lo devuelve, *Saltar* y lo recordado, cuándo arranca, las teclas, la
tarjeta y los textos en los dos idiomas (`tests/tour.test.ts`); el NSIS leído
como texto contra el lanzador (`engine/crates/rt-app/tests/installer.rs`,
`tests/installer-page.test.ts`); el lanzador descargando lo que el instalador
dejó, sobre sockets con el `curl` real y un servidor local, y sin descargar
nada con una clave de otro sistema, desconocida o sin motor
(`tests/ai.rs`). Comprobaciones del navegador: `tools/tour-check.mjs` (el
recorrido entero, ancho, estrecho y en español, con sus capturas) y
`tools/ai-runtime-check.mjs` (contra el lanzador real: selector, avisos, nota,
Visual C++ y el estado en la carpeta de datos). Cada test falla si se
rompe lo que guarda. Capturas en `docs/ui/`: `tour-tools.png`,
`tour-camera.png`, `tour-render-ai.png`, `tour-settings-es.png`,
`ai-runtime-warning-render.png`, `ai-runtime-warning-settings.png`,
`ai-runtime-warning-vc.png`, `ai-runtime-chooser.png`, `ai-runtime-note.png`.

**No encajó con el plan.** (1) El *Ejecutar en el procesador* del instalador
no se aplicaba a nada: para que el motor que marca el instalador sea el que
la aplicación espera, el primer arranque lo convierte en *Ajustes ▸
Post-procesado IA ▸ Ejecutar en* (`applyInstallerChoice`); es una decisión
que no estaba en el plan. (2) La página del instalador no se puede ver aquí
(*makensis* la compila con `-WX`, pero Wine no ejecuta un instalador NSIS):
su lógica está cubierta como texto, y falta mirar en un Windows real que la
fila nueva cabe en la página con seis modelos de dos líneas. (3) La
descarga del motor desde el instalador, de punta a punta, tampoco se puede
probar aquí; sí el lanzador (sockets) y la página (lanzador real). (4) Falta
Visual C++ no se puede producir en Linux: el navegador lo prueba con la
respuesta del lanzador cambiada. (5) La tarjeta de un paso de Ajustes va
dentro de la ventana, donde no tapa ningún control pero sí texto de
descripción; una sección que sea toda controles la dejaría en la esquina
inferior derecha. (6) Quien actualiza desde una versión anterior ve el
recorrido una vez (no hay marca previa que lo distinga de un primer
arranque). (7) *Ayuda ▸* agrupa lo que antes eran tres entradas sueltas
(*Guía*, *Atajos*, *Acerca de*); la *Guía* de seis pasos sigue como estaba y
el recorrido no la sustituye. (8) Con los modelos todavía bajando (el
instalador los dejó pendientes) no hay aviso: «hay un modelo» es un modelo
instalado.

## M2 · Texturas de imagen y etiquetas — **Opus** — sustituida por M2a y M2b

**Nota (Fable, tras v0.1.5).** Esta fase se divide en M2a (sin motor:
importación, ranuras, etiquetas, vista previa y contrato RSB) y M2b (el
motor), definidas más arriba en «Materiales y sets con efecto». El texto
siguiente se conserva como origen.

**Qué.** Texturas de color, rugosidad, metal, normal y alfa con proyección
caja, plana, cilíndrica y UV, escala, rotación y desplazamiento; etiquetas
(*labels*): una imagen con alfa proyectada sobre una zona de la pieza,
colocada con clic y arrastre, con su propio acabado (brillo distinto del
sustrato). Es la función más usada de packaging y cosmética. Las
imágenes viajan al motor como secciones RSB propias.

**Depende de.** E5.

**Criterio.** Captura con una botella etiquetada; test de proyección caja
(un cubo recibe la textura sin estirar en las seis caras); el proyecto
guarda las imágenes embebidas.

## N1 · Animación y vídeo al estilo KeyShot — **Opus** — hecha

**Qué.** Sustituir el editor de U1 (planos + tarjetas) por el modelo de
`SPEC.md` §3.7 y la interfaz de `UI.md` §2.5, que siguen cómo funciona
el de KeyShot: una sola línea de tiempo con **una pista por objetivo** y
**barras** arrastrables y estirables; la **pista de cámara** con tramos
de cámara activa y eventos de **cambio de cámara** (corte o fundido a
color); el **asistente de animación** en tres pasos (tipo en rejilla de
tarjetas agrupadas, objetivo, parámetros) en línea en el inspector; el
**inspector de animación** con curva de tiempo (incluida *personalizada*
con dos asas), invertir y repetir; las animaciones **bajo su objetivo en
el árbol**; reproducción con cabezal, fps, bucle y vista previa rápida.
Tipos nuevos en `src/data/animation.ts` sin renombrar los existentes:
`FADE`, `PAN`, `MATERIAL_COLOR`, `SUN_ARC` (este último se activa con E5),
`PATH` reservado. `evaluate(state, t)` completo para todos los tipos,
composición por objetivo y conflictos visibles; despiece (centro,
disposición, factor). Migración del estado de U1: los planos pasan a
tramos de la pista de cámara y los movimientos a barras, sin perder nada
(test con un proyecto de U1 guardado). **Salida**: modo *Animación* en
la barra de render (rango, fps, vídeo o fotogramas, presupuesto por
fotograma, estimación), un RSB por fotograma renderizado por el pool de
workers, codificación en el navegador (WebCodecs → WebM/MP4; secuencia
PNG/JPEG como alternativa siempre disponible), trabajos de animación en
la cola. La *previa renderizada* (motor a pocas muestras por fotograma)
y el fundido cruzado quedan para después y se marcan *próximamente*.

**Depende de.** U1, U3 (el pivote y los ejes locales de las rotaciones),
E4 (para la salida renderizada; la línea de tiempo y la vista previa
rápida no dependen de él y pueden ir antes).

**Criterio.** Tests de `evaluate` con números (órbita de 90° en 4 s a
mitad con *suave* da 45°; rotación con pivote en otra pieza mantiene la
distancia a ese pivote; `FADE` invertida y repetida 2 veces da el valor
esperado en 5 instantes; curva personalizada con asas en (0.42, 0) y
(0.58, 1) coincide con la de referencia ±1e-3); los 16 presets producen
un estado válido en cada fotograma; una barra arrastrada en la línea de
tiempo produce una sola entrada de deshacer; el proyecto de U1 migra con
el mismo resultado en `t = 2 s`; un vídeo de 2 s a 12 fps sale y se
reproduce; captura de la línea de tiempo con tres pistas y el asistente
abierto en el paso 1.

**Qué no tocar.** Las claves existentes de `MOVE_KINDS` y
`SEQUENCE_PRESETS` (se añade, no se renombra); el motor (`engine/`).

**Auditoría al empezar** (sobre `main` en v0.1.15, punto por punto del
brief y del criterio; N6 y U5 ya habían construido una parte):

| Punto | Estado al empezar | De qué fase | Qué hizo N1 |
| --- | --- | --- | --- |
| Una línea de tiempo con una pista por objetivo y barras arrastrables y estirables | Hecho | N6: árbol de lo animado + carriles, imán, un arrastre = una entrada de deshacer | Nada que rehacer; filas nuevas para los materiales |
| Pista de cámara con tramos de cámara activa | Hecho | N6 (tramos, borde arrastrable, cámara del plano en su menú) | Clic en un tramo: sus propiedades |
| Cambio de cámara: corte o fundido a color | Parcial: solo el corte implícito en el borde de un plano | U1, N6 | `Shot.transition`: corte o fundido a negro o blanco con duración; propiedades del plano, marca en la pista, el visor y cada fotograma |
| Asistente en tres pasos (tipo en rejilla de tarjetas agrupadas, objetivo, parámetros), en línea | Parcial: tres secciones a la vez, el tipo en una lista | U1; N6 puso el objetivo de la selección | Tres pasos con *Atrás* y *Siguiente*, la rejilla de tarjetas agrupada; el objetivo primero (el orden de N6) |
| Inspector de animación: curva de tiempo, *personalizada* con dos asas | Parcial: curva con vista previa, sin personalizada | N6 | `CUSTOM` con el editor de dos asas |
| Invertir y repetir | Hecho | N6 (`reverse`, `repeat`) | Probados en el criterio de `FADE` |
| Las animaciones bajo su objetivo en el árbol | Falta | — | Bajo piezas, grupos y el modelo |
| Reproducción: cabezal, fps, bucle, vista previa rápida | Hecho | U1, N6 | Los fundidos, colores y el sol en la vista previa rápida |
| Tipos `FADE`, `PAN`, `MATERIAL_COLOR`, `SUN_ARC`, `PATH` reservado | Falta | — | Los cinco, al final de `MOVE_KINDS` |
| `evaluate` completo, composición por objetivo, conflictos visibles | Parcial: los tipos de entonces; conflictos marcados | U1, N6 | Los tipos nuevos, el pivote de un giro, el objetivo material |
| Despiece (centro, disposición, factor) | Hecho | N6 | — |
| Migración del estado de U1 (planos a tramos, movimientos a barras), con un proyecto de U1 | Parcial: el modelo de N6 es el de U1 (planos y clips) y se lee; ningún test decía que reproduce lo mismo | N6, U2 (`project-v1.json`) | Test con `project-v1.json` contra las poses que daba el código de U1 |
| Salida: modo *Animación* (rango, fps, vídeo o fotogramas, presupuesto por fotograma, estimación) | Hecho salvo el vídeo | U5 | El vídeo |
| Un RSB por fotograma renderizado por el *pool* | Hecho | U5 | — |
| Codificación en el navegador (WebCodecs → WebM/MP4), secuencia siempre disponible | Falta (*próximamente*); el `output` del Doctor dormido | U5, D1 | WebCodecs, *muxers* propios, el Doctor conectado |
| Trabajos de animación en la cola | Hecho | U5 | Trabajos de vídeo |
| Previa renderizada y fundido cruzado: *próximamente* | — | — | Siguen *próximamente* |
| Criterio: órbita de 90° en 4 s a mitad con *suave* da 45° | Hecho | U1 (`tests/animation.test.ts`) | — |
| Criterio: rotación con pivote en otra pieza mantiene la distancia | Falta (no había pivote) | — | `tests/animation-n1.test.ts` |
| Criterio: `FADE` invertida y repetida 2 veces, 5 instantes | Falta | — | Ídem |
| Criterio: curva personalizada (0.42, 0) y (0.58, 1) ±1e-3 | Falta | — | Ídem (frente a una bisección propia de la prueba) |
| Criterio: los 16 presets dan un estado válido en cada fotograma | Hecho | U1 | Extendido a los campos nuevos de la pose |
| Criterio: una barra arrastrada es una entrada de deshacer | Hecho | N6 (prueba y `tools/animation-check.mjs`) | Lo mismo para un asa de la curva y un fundido |
| Criterio: el proyecto de U1 migra igual en t = 2 s | Falta | — | `tests/animation-migration.test.ts` |
| Criterio: un vídeo de 2 s a 12 fps sale y se reproduce | Falta | — | `tests/video.test.ts` y `tools/video-check.mjs` |
| Criterio: captura de la línea de tiempo con tres pistas y el asistente en el paso 1 | Falta | — | `docs/ui/animation-n1-wizard.png` |

**Hecho.** Lo que faltaba o estaba a medias, sin rehacer lo de N6 ni U5:

- **Tipos nuevos** (`src/data/animation.ts`, añadidos al final; las 17 claves de
  antes, intactas): `FADE` (la cantidad es la **opacidad final** en %, por
  defecto 0; invertido, aparece; los de un nodo y sus grupos se multiplican),
  `PAN` (la cámara gira donde está: su objetivo da la vuelta alrededor de su
  posición; positivo, a su derecha), `MATERIAL_COLOR` (el color base de un
  material, desde el que dejaron los clips anteriores, hacia el del clip),
  `SUN_ARC` (el sol gira alrededor del polo celeste, 15° por hora: el primer foco
  solar que alumbra o, sin él, el sol propio del cielo) y `PATH`, solo en el
  catálogo (`RESERVED_MOVES`: nada lo ofrece ni lo reproduce). `CUSTOM` se añade a
  `EASING_KINDS`; `MOVE_GROUPS` da sus grupos al asistente. Un objetivo nuevo,
  `MATERIAL` (`ClipTarget`), y con él todas las piezas que lo llevan
  (`partsWearing`).
- **Giro con pivote** (`MotionClip.pivot`): `SPIN` y `TUMBLE` de una pieza o
  grupo alrededor del centro de otra pieza o de un punto, sobre su propio eje (Z o
  X), hecho en el mundo y devuelto al padre; sin pivote, exactamente lo de antes.
- **Curva personalizada** (`src/core/curve.ts`): Bézier cúbica de dos asas
  (x en 0..1, y en −0,25..1,25), Newton desde la fase y bisección donde la curva
  se pone vertical. Editor en las propiedades (`ui/components/curve-editor.ts`):
  arrastre con una entrada de deshacer, flechas, y sus cuatro números.
- **Cambio de cámara** (`Shot.transition`, `shotFadeAt`): corte o fundido a
  negro o blanco (0,04–10 s, 0,5 s por defecto) centrado en el corte, con la curva
  suave y nunca más largo que la mitad de cualquiera de los dos planos; en el
  primer plano, un fundido de entrada. Propiedades del plano al hacer clic en su
  tramo, marca sobre el corte en la pista, el color sobre el encuadre del visor al
  reproducir, y en cada fotograma renderizado (`src/core/fade.ts`: en los valores
  de una imagen de 8 o 16 bits, en luz lineal en EXR, TIFF de 32 bits y DNG).
- **El motor sin tocarlo**: la escena RSB (`src/io/rsb.ts`) lleva los fundidos
  como cobertura (una copia del material por opacidad, con su dibujo de madera o
  tela y su programa; un emisor baja su emisión; a 0 % la pieza no está), el color
  de un material posado y el sol del cielo movido. Sin animación nueva, los mismos
  bytes que antes (las pruebas de paridad siguen fijadas).
- **Rápido** (`src/render/fade-preview.ts`): el material compartido puesto como lo
  deja el clip (y devuelto a su instancia después), una copia translúcida para
  cada pieza que se funde, el sol del arco en el cielo y en los focos.
- **Asistente en tres pasos** con la rejilla de tarjetas (icono, nombre, frase),
  agrupada en *Piezas · Cámara · Luz y entorno · Materiales* con el grupo del
  objetivo primero; *Un material* como objetivo; el color en el paso 3.
- **Bajo su objetivo en el árbol de la escena**: las animaciones de una pieza o
  grupo bajo ella, las del modelo bajo el modelo, con su icono y su frase corta;
  clic abre el cajón con ella elegida.
- **Vídeo codificado** (`src/io/video.ts`, `webm.ts`, `mp4.ts`; ARCHITECTURE
  §5.4 ter): WebCodecs preguntado en tiempo de ejecución (WebM con VP9 o VP8, MP4
  con H.264 *Constrained Baseline* del nivel que pide el tamaño), *muxers* propios
  de las especificaciones públicas, un trabajo de vídeo en la cola que pasa cada
  fotograma al codificador y guarda **un archivo**; la ventana de render solo
  ofrece lo que el sistema codifica (lo demás deshabilitado con su porqué). En el
  Chromium de aquí: **VP9, VP8 y AV1 sí, H.264 no**.
- **Doctor** (`output`): `EngineFacts.videoCodecs` sale de la respuesta del
  navegador (`ui.video`, `encodableCodecs`) y el chequeo avisa **solo** de un
  vídeo con un contenedor que este sistema no codifica (arreglo: fotogramas); las
  pruebas de D1 se reescribieron con eso (un vídeo que sí se codifica ya no es un
  aviso), y una nueva sigue la respuesta del navegador hasta el aviso.
- **Accesibilidad del cajón** (lo que el repaso de H1 dejó a esta fase): los
  presets vuelven a ser botones, cada uno dentro de un elemento `listitem` de una
  lista con nombre; el árbol de lo animado (`role="tree"`, con nombre y el foco)
  dice qué fila está activa con `aria-activedescendant` (cada fila con su `id` y
  `aria-selected`) y **↑ ↓** van a la animación de arriba o de abajo; la regla,
  que está dentro del árbol, queda para el puntero (`aria-hidden`, sin etiqueta;
  su ayuda sigue) porque el cabezal ya se mueve con el teclado desde el árbol.
  `tests/a11y-timeline.test.ts` (4, en Chromium como el de H1) y una prueba de las
  teclas.
- **La marca del fundido** en la pista de cámara tapaba el principio del nombre del
  plano siguiente y usaba la duración pedida aunque los fotogramas la recorten a la
  mitad de un plano: `shotFadeSpan` (core) es ahora el tramo que usan los
  fotogramas (`shotFadeAt`) y la pista, y el nombre del plano empieza pasada la
  marca (una prueba del tramo y otra en Chromium, que fallan sin el arreglo).
- **Galería**: las cuatro capturas, con su entrada en `docs/GALERIA.md` bajo
  *Sin publicar* (por versión y por función) y una fila en «Sin captura» con lo de
  N1 que no tiene imagen (el fundido en el visor y en un fotograma, una pieza que
  se funde, el pivote, el arco solar, un fotograma del vídeo y el MP4).
- **Migración de U1**: `tests/fixtures/u1-hero-poses.json`, tomadas con el
  `evaluate` de U1 (commit `67b9154`) sobre `project-v1.json` en 0, 2, 5,5 y 9 s;
  el proyecto abierto hoy reproduce lo mismo a 1e-9, con sus planos como tramos y
  sus movimientos como barras.

Pruebas: `tests/animation-n1.test.ts` (21: pivote en otra pieza y en un punto,
también con un padre fuera del origen; `FADE` invertida y repetida en cinco
instantes, sus multiplicaciones y su partición; `PAN`; `MATERIAL_COLOR`;
`SUN_ARC` y su ángulo al polo; la curva frente a una bisección propia, también
con asas en los extremos, y su arrastre como una entrada de deshacer; los fundidos
de la pista, su tramo y sus píxeles; los 16 presets en cada fotograma; el asistente, los
planos y los materiales), `tests/animation-migration.test.ts` (2) y
`tests/video.test.ts` (12: los dos contenedores releídos por lectores aparte, un
vídeo de 2 s a 12 fps de 24 fotogramas, el escritor con un codificador falso, un
trabajo de la cola hasta el archivo, y fotogramas reales de libx264 y libvpx en
nuestros MP4 y WebM leídos por ffprobe donde la máquina tiene ffmpeg). Mutaciones:
**48**, todas muertas (en `evaluate` de los tipos nuevos y del pivote, en la curva,
en los dos *muxers* y el escritor, en la cola de vídeo, en el Doctor, en la
accesibilidad del cajón y en la marca del fundido); una sobrevivió
al principio (quitar la vuelta al padre del giro con pivote: el padre de la tapa está
en el origen) y se mató con una prueba sobre el cuerpo, que cuelga del modelo.
En el navegador, `tools/video-check.mjs` (Chromium con WebCodecs de verdad): los
códecs, un vídeo de 2 s a 12 fps por el escritor de la aplicación en VP9
(18 760 bytes) y en VP8 (6 798 bytes) leídos por ffprobe (24 fotogramas, 2 s,
320 × 180), el asistente en tres pasos, un fundido a negro, un asa arrastrada y
deshecha, el fundido en el visor, y un render de la aplicación en WebM VP9 de 48
fotogramas (2 s a 24 fps, 160 × 90) leído por ffprobe; capturas
`docs/ui/animation-n1-wizard.png` (la línea de tiempo con tres pistas y el
asistente en el paso 1), `animation-n1-cards.png`, `animation-n1-curve.png` y
`render-window-video.png`. El motor de Rust no se tocó. Compuertas, con `main`
mezclado (H1 y la galería) y `rt.wasm` compilado: `npm run qa` en verde (169
archivos y 2907 pruebas pasan, 4 archivos y 6 pruebas omitidas; al empezar pasaban
161 y 2836, y H1 trae las suyas) y `npm run engine:test` en verde (1098 pasan, 11
ignoradas), como antes.

**Qué no encajó con el plan** (regla 12; lo marcado ◆ es del criterio de
**Fable**, que decide si se cambia):
- ◆ **El orden del asistente.** El brief pide tipo → objetivo → parámetros; N6
  entregó el objetivo primero (*+ Animar Tapón…* lo trae puesto) y se mantiene: el
  paso 2 es la rejilla, con solo los tipos de ese objetivo y su grupo primero.
- **Una pista por objetivo con barras**: se queda el modelo de N6 (una fila por
  objetivo y, debajo, una por animación; plegado, las barras de todas en la fila
  del objetivo), que ya estaba aceptado.
- ◆ **Qué es un fundido**: la cantidad es la opacidad final y aparecer es el
  fundido invertido (el SPEC decía «de 0 a 1 o de 1 a 0»). En el motor es una
  cobertura estocástica (con poco muestreo se ve como un tramado) y un emisor baja
  su emisión, porque el motor no da cobertura a los emisores; en *Rápido*, una
  copia translúcida sin escritura de profundidad.
- ◆ **El arco solar**: polo fijo detrás del producto a 45° de altura, en el marco de
  los focos (`SUN_POLE_AZ`, `SUN_LATITUDE`); la latitud y dónde está el norte no
  son de esta fase.
- ◆ **El fundido a color**: centrado en el corte, medio en cada plano, curva suave,
  nunca más de la mitad de un plano; el de entrada solo en el primero, y no hay
  fundido de salida al final de la animación. Se mezcla en los píxeles después
  del motor: en los formatos lineales, hacia el color en luz lineal con la
  exposición (el blanco es 1, que con *Fílmica* o *AgX* no es el blanco de la
  imagen).
- ◆ **La calidad del vídeo**: UI.md decía *con calidad*; no hay mando, es
  automática (unos 0,1 bits por píxel, de 1 a 50 Mbit/s). Sin alfa ni sonido.
- **H.264** solo *Constrained Baseline* (sin fotogramas B, así el MP4 no necesita
  `ctts`); el Chromium de código abierto de aquí no lo codifica, así que el MP4 se
  probó en Node con fotogramas reales de libx264 y ffprobe, no con WebCodecs.
  WebM cae a VP8 donde no hay VP9; AV1 no se ofrece aunque Chromium lo codifique.
- **Los fps de la ventana** son 24, 25, 30 y 60: el vídeo de 12 fps del criterio
  sale por el escritor de la aplicación (la prueba con el codificador falso y el
  navegador con el de verdad); el camino entero de la aplicación se probó a 24 fps.
- **Un vídeo se guarda al final**: un trabajo detenido no deja nada; los plugins de
  trabajos no pasan por sus fotogramas y el historial guarda el primero como PNG
  (`ResultMeta.video` dice de qué vídeo).
- **El aviso de D1 «un archivo que un fallo pierde entero»** se quita: el encargo
  dice que `output` avise solo de un códec que no se codifica (era la ◆ de D1).
- **Pivote**: el eje es el propio del objetivo (Z o X); el eje libre no se
  construye. Si la pieza pivote se mueve, el pivote no la sigue (se toma en reposo).
- **Color de material**: el color base de los parámetros *Simple*; un material de
  nodos (M3a) no cambia de color, ni en el motor ni en *Rápido* (sí se funde).
- **Bajo su objetivo en el árbol**: solo piezas, grupos y modelo; las de cámara,
  focos, entorno y materiales se ven en la línea de tiempo.
- El *barrido rápido* de la biblioteca de movimientos (A6) sigue siendo una
  órbita; la variante con `PAN` queda pendiente.
- `ease()` de `light-math` trata `CUSTOM` como lineal: la curva de un clip vive en
  `clipCurve`, que es la que la usa.
- `tools/render-window-check.mjs` se para en su paso (g) (tras elegir *Copper* en la
  paleta, Ctrl+Mayús+Intro no arranca el render y espera hasta agotar el tiempo); pasa
  igual en una compilación de `main` sin N1 (`3096821`), así que no es de esta fase y
  no se toca aquí. Por eso `render-window-animation.png` (U5) no se ha regrabado y
  sigue enseñando el vídeo como *próximamente*; lo de ahora está en
  `render-window-video.png`.
  *Resuelto después, fuera de esta fase*: el fallo era de la herramienta, no de la
  interfaz. Cerraba el visor de resultados con Esc nada más empezar la descarga del
  JPEG, antes de que el trabajo terminase y el visor abriera; ese Esc llegaba a la
  escena y deseleccionaba el cuerpo (`Esc` deselecciona, UI §2.3), así que *Copper* pedía
  *Sustituir todos* dentro de la paleta, que seguía abierta (es modal) y se tragaba
  Ctrl+Mayús+Intro. Pasaba o no según el momento. La herramienta espera ahora al visor,
  comprueba la selección y que la paleta se cierre, y `render-window-animation.png` y las
  otras tres capturas de U5 se regrabaron.
- **La regla de la línea de tiempo** no es un `slider`: está dentro del árbol, que
  solo puede contener sus filas, y el cabezal ya tiene el teclado (Inicio, Fin,
  ← →) desde el árbol; se oculta a las ayudas técnicas. Si se quiere un control
  propio para el cabezal, va fuera del árbol (otra estructura del cajón).

## N2 · Cola, pases y lotes — **Sonnet** — hecha

**Qué.** Cola de render con progreso y cancelación sobre `render()` del
motor; pases alfa, profundidad, normales e id de pieza como salidas
opcionales del integrador (sección `RNDR` con máscara de pases; PNG 16
bits o EXR); lote cámaras × estudios con nombre de archivo por plantilla
(`{proyecto}_{camara}_{estudio}`); descarga en ZIP propio (sin
dependencia: el formato *store* de ZIP es trivial).

**Depende de.** E4.

**Criterio.** Tests de nombre de archivo y de cola (orden, cancelar el
segundo deja el tercero); un lote de 2 × 2 produce 4 imágenes.

**Hecho.** La auditoría de abajo dice qué había (la cola, su cancelación, los seis
pases del motor y el lote por cámaras venían de U5, U14, X2 y E4) y qué faltaba; N2
construyó solo lo que faltaba:

- **Motor: el pase alfa** (`rt_core::passes`, el séptimo, bit 6 de `RNDR.passes`, sin
  cambiar el tamaño de la sección ni mover un *hash*): la cobertura de objetos de cada
  píxel, de 0 a 1; se muestrea como el albedo (comparte con él el rayo de cámara de cada
  muestra, así que los bordes salen suavizados igual que la imagen) y se divide por el
  recíproco del número de muestras, bit a bit como `Film::resolve`. `PASS_EXACT` sigue
  siendo `0b111110` y `PASS_X2` (los seis de antes) es lo que fijan los *hash* de X2.
  `rt_render_tile_alpha` en `rt.wasm` (sin bit de `rt_features` nuevo), el pool de la
  página y el `RPP1` del lanzador lo llevan, y el lector del `RPP1` ya no tiene un brazo
  que se habría tragado un plano nuevo.
- **Pases como archivos**: *Alfa*, *Profundidad*, *Normales* e *Id de pieza* junto a la
  imagen, en EXR de 32 bits (por defecto) o PNG de 16 bits (`encodeExrPlanes`,
  `encodePngWords`, `core/pass-files.ts`, `io/passes.ts`), con la leyenda de piezas
  (`<nombre>_partId.json`) y el rango de la profundidad en un trozo `tEXt`.
- **Lote cámaras × estudios**: *Estudio* en la ventana (la escena como está, uno guardado,
  o todos); con *Todas las cámaras*, 2 × 2 son cuatro trabajos, cámara por cámara, cada uno
  con su cámara y su estudio y con el nombre de la plantilla; aviso de nombres repetidos.
- **ZIP propio** (`io/zip.ts`, método *store*, CRC-32, nombres UTF-8, sin ZIP64) y el grupo de
  ZIP de la cola: una orden *Render* es un solo archivo al acabar el último trabajo, con
  alternativa de archivos sueltos si no se puede armar.
- **Cola**: la prueba que faltaba (*Detener* el segundo deja el tercero) y un fallo antiguo
  de `ensureLoop` (ver abajo).

Números. Web: `npm run qa` en verde (tipos, interfaz y 177 archivos de prueba con 3005 tests y 6 omitidos, tras fusionar `main`; antes de la fase eran 168 archivos y 2902 tests). Motor: `cargo test --workspace --release` 1112 tests y `npm run engine:test` 1106 (depuración), sin fallos; en WebAssembly (WASI) 588 de `rt-core`, escalar y con simd128; `cargo fmt`, `clippy -D warnings` (también para Windows), `cargo check` para aarch64 y riscv64, y el `rt.wasm` real igual al nativo en cada bloque de paridad de `engine.yml`. Con la máquina muy cargada, `ai_post::retries_lower_the_strength_…` (una espera por muestreo) falló en dos pasadas completas y pasa sola (9 de 9): no toca nada de esta fase. Pruebas nuevas: `tests/batch.test.ts` (28),
`tests/zip.test.ts` (10), `tests/pass-files.test.ts` (17), 6 en
`tests/passes-engine.test.ts` y, en el motor, las del alfa en `passes_tests.rs` (cobertura,
suelo y fondo, igual a la película con fondo transparente bit a bit, con otros pases y con
otros mosaicos, panel de luz, con muestras de borde, igual en escalar, SSE2 y AVX2), en
`rt-wasm` (`the_alpha_pass_through_the_c_api_is_the_engines`) y en `rt-app` (`RPP1` con
máscara 127). **Hashes nuevos** fijados: `PINNED_PASS_ALPHA = 0xd4eaac78` (ejemplo) y
`PINNED_E5_PASS_ALPHA = 0xef9ead68` (E5), iguales en el `rt.wasm` real
(`wasm-parity.mjs --expect-alpha`, en `engine.yml`) y en WASI escalar y simd128; **ninguno
de los anteriores se movió** (albedo `0x43571da9`, normales `0x0aabfd24`, profundidad
`0x25f8dd11`, ids `0xccd3d6c7`, círculo `0xdf87494c`, ni los de las imágenes). Cada prueba
nueva se comprobó con una mutación: 46 mutantes (38 en la página, uno en la cola y 7 en
el motor), todos muertos; dos enseñaron algo: dividir entre el número de muestras en vez de
multiplicar por su recíproco sobrevivía hasta que se probó con 7 muestras, y un mutante
colgaba las pruebas (era el fallo de `ensureLoop`). `tools/batch-check.mjs` (Chromium y el `rt.wasm`
real): un lote 2 × 2 con tres pases en un ZIP de 20 archivos que `unzip` y `fflate` aceptan,
los EXR leídos por la especificación, los PNG de 16 bits, y *Detener* el segundo deja el
tercero. Capturas `batch-window.png` y `batch-queue.png`.

**Auditoría al empezar** (sobre `main` en v0.1.16, punto por punto del
brief y del criterio; U5, U14, X2 y X4 ya habían construido una parte):

| Punto | Estado al empezar | De qué fase | Qué hizo N2 |
| --- | --- | --- | --- |
| Cola de render con orden y progreso, sobre `render()` del motor | Hecho | U5 (cajón, reordenar, editar, duplicar, pausar, terminados), U14 (vista en vivo), E4 (el trazador) | Nada que rehacer |
| Cancelación | Hecho | U5: *Detener* el trabajo en curso (acaba *Cancelado* y sigue el siguiente), *Quitar* uno en espera, *Pausar* | Nada que rehacer; la prueba |
| Pases de profundidad, normales e id de pieza como salida del integrador, con máscara en `RNDR` | Hecho en el motor | X2 (`RNDR.passes`, `rt_core::passes`, seis pases con hashes fijados), X4 (los dibuja three.js para la IA) | Nada que rehacer en el motor; solo los leen la guarda de la IA y el *denoise*: ningún pase llega a un archivo |
| Pase alfa | Falta (solo existía el alfa de la imagen con fondo transparente) | — | El séptimo pase, `alpha`, bit 6 de la máscara: sin cambiar el tamaño de `RNDR` ni mover un *hash* |
| Los pases como archivos: PNG de 16 bits o EXR | Falta (escritores de la imagen sí: PNG 8/16 bits, EXR, TIFF, DNG) | U5, U12 | `encodePngWords` y `encodeExrPlanes`, los números de cada pase y sus nombres |
| Pases elegibles en la ventana de render | Falta (una fila *próximamente*) | U5 | Fichas y formato |
| Lote por cámaras | Hecho | U5 (*Todas las cámaras*, un trabajo por cámara con su proporción) | — |
| Lote por estudios | Falta (los estudios guardados no eran un eje de la cola) | U4 (los estudios de la biblioteca), L6 | El estudio como eje: `studio` en los ajustes y en el trabajo |
| Nombre por plantilla con proyecto, cámara y estudio | Hecho en lo que importa | U5 (`{project}`, `{camera}`, `{studio}`, `{date}`, `{n}`: las claves en inglés, las fichas en es y en) | `{studio}` pasa a ser el estudio guardado del trabajo (era el nombre del tipo de producto); aviso de nombres repetidos |
| Descarga en ZIP propio | Falta (un escritor de ZIP solo en `tests/zip.ts` para los archivos de prueba, y fflate para *leer* el 3MF) | — | `io/zip.ts` y el grupo de ZIP de la cola |
| Criterio: pruebas de nombre y de cola en orden | Parcial: el orden y detener el primero | U5 (`tests/render-queue.test.ts`) | `tests/batch.test.ts` |
| Criterio: cancelar el segundo deja el tercero | Falta | — | Dos pruebas (detenerlo y quitarlo) y el mismo caso en Chromium |
| Criterio: un lote de 2 × 2 produce 4 imágenes | Falta | — | Prueba con la cola, el ZIP leído por fflate y `tools/batch-check.mjs` |
| E8, lotes nativos (`rt` lee proyectos) | Falta | — | No se construye aquí (se solapa; sigue en su fase) |

**Qué no encajó con el plan** (regla 12; lo marcado ◆ es del criterio de
**Fable**, que decide si se cambia):
- **Las fichas del nombre** son `{project}`, `{camera}`, `{studio}`, `{date}` y
  `{n}` (el modelo de U5, con las claves en inglés y las fichas con su etiqueta
  en cada idioma), no `{proyecto}_{camara}_{estudio}` como dice el encargo: se
  mantiene lo que hay, que ya hace lo que pide (en español la ficha dice *Proyecto*,
  *Cámara*, *Estudio*). No hay alias en español dentro de la plantilla.
- **`{studio}` cambia de significado en los lotes**: era el nombre del tipo de producto
  (*Joyería*) y ahora, en un trabajo con estudio guardado, es el nombre de ese estudio;
  sin él (todo lo de antes) sigue siendo el tipo de producto.
- ◆ **Qué es el alfa.** El encargo pedía un pase «alfa» sin más. Se construyó como
  **máscara de objetos**: cada muestra cuenta si su rayo de cámara encuentra una
  superficie de una instancia; el suelo del estudio (visible o atrapasombras), el
  entorno, el fondo y los paneles de luz visibles valen 0, y los recortes y el vidrio
  cuentan como superficie, como en todos los pases de X2. No es, por tanto, el alfa de la
  imagen con *Fondo transparente* cuando hay un atrapasombras (ahí el alfa es la
  sombra) ni en lo que el camino ve a través del vidrio; donde solo hay objetos opacos y
  fondo, es el alfa de la película bit a bit (test). Decidir si el suelo entra en la
  máscara, y si los recortes con textura de alfa deben dar cobertura parcial (hoy no).
- ◆ **Qué pases se ofrecen**: los cuatro del encargo. El motor renderiza también el albedo, el
  id de material y el círculo de confusión (los de la IA): se podrían ofrecer con el mismo
  cauce, y el id de material necesitaría su leyenda.
- ◆ **Cómo se escriben los números.** Formato por defecto de los pases, **EXR** (la
  profundidad y las normales son flotantes); en PNG de 16 bits, la profundidad es un mapa de
  z con **lo cercano blanco**, 0 el fondo y el rango de distancias en un trozo `tEXt`; las
  normales, `n × ½ + ½` (el fondo, el gris medio); los ids, el número de instancia con el
  suelo en 65535 y un tope de 65534 piezas. Todo eso es preparado, no decidido: son
  elecciones fotográficas y de convención.
- ◆ **El ZIP**: apagado por defecto (hoy cada archivo se descarga aparte, como siempre), un
  grupo es lo que mete **una** orden *Render* o *+ Añadir a la cola*, y se llama
  `Proyecto_0001-0004.zip` (con los números de render). Decidir si un lote a *Descargas*
  debería ir empaquetado por defecto, y el nombre.
- ◆ **El orden de un lote** es cámara por cámara (cada cámara en todos los estudios), el de
  las plantillas `{camera}_{studio}`; el otro orden (estudio por estudio) es igual de
  defendible.
- **El estudio no mueve la cámara.** `studio/restore` sí pone la cámara del estudio (su
  vista y su óptica); un lote la conserva (la del trabajo), porque si no, 2 cámaras × 2
  estudios serían 2 imágenes. Una `restoreStudio` con `{ camera: false }`, pura, hace las dos cosas.
- **Los estudios del lote son los guardados**: los de la pestaña *Estudios* (biblioteca, del
  navegador o de la carpeta de datos del escritorio) y los que un proyecto antiguo guardaba
  dentro. Un trabajo guarda el id y el nombre, no el estudio: abierto en otro equipo sin
  ese estudio falla con el motivo. ◆ Si el estudio debería viajar con el proyecto (decidido: sí; hecho en N2b).
- **Un trabajo con estudio no pasa por la IA** (sus pases se dibujan del proyecto abierto en
  el modo Rápido); lo dice un aviso y se guarda la imagen del motor. Los plugins de trabajos
  guardan aparte, fuera del ZIP.
- **Los pases son para imágenes**: una animación no los escribe (ni lleva estudio), y con
  *Terminar por ruido* el alfa, como el albedo, lleva las muestras de la primera ronda.
- **El ZIP se arma en memoria** y se escribe al acabar el último trabajo del grupo: cerrar la
  página antes lo pierde (los resultados de la imagen están en el historial), no hay ZIP64 y
  un lote enorme de EXR de 32 bits puede no caber. Un grupo que se pausa espera en memoria.
- **Cancelar**: ya estaba; faltaba la prueba. *Detener* (el que corre) y *Quitar* (uno en
  espera) son los dos modos; un trabajo en espera no pasa a *Cancelado*, sale de la lista.
- **El escritorio**: el lanzador renderiza el alfa y lo guarda en su `RPP1` (probado por la
  API con 1 y 4 hilos, y el lector de la página con un archivo que escribe el lanzador),
  pero `tools/batch-check.mjs` solo recorre la web: el lote en la ventana nativa no se
  grabó. **E8** (lotes nativos de línea de órdenes) no se construye aquí.
- **Cambios fuera del plan, de un bug que casi entra**: el lector del `RPP1` del lanzador
  (`kept.rs`) tenía un brazo `_ =>` que habría guardado cualquier plano nuevo en el círculo de
  confusión; ahora el alfa tiene el suyo y el archivo de prueba
  `tests/fixtures/passes-3x2.rpp` lo incluye (sus seis primeros planos son los mismos bytes).
- **Un fallo antiguo de la cola, encontrado al probar**: un *Iniciar* sin nada en espera
  terminaba el bucle antes de su primer `await` y dejaba la promesa ya acabada como «el
  bucle en marcha»; ningún *Iniciar* posterior arrancaba otro. Arreglado en `ensureLoop`
  (la promesa se limpia sola al acabar) y con su prueba, que falla si vuelve el código viejo.

## N2b · El estudio viaja con el proyecto — **Opus** — hecha

**Qué** (de *Decisiones de criterio*, N2). El estudio de un trabajo de lote viaja **dentro
del proyecto**: un proyecto abierto en otro equipo, o en otro perfil del navegador, no
falla sus trabajos porque allí falte un estudio de la biblioteca.

**Hecho:**

- **La copia en el proyecto** (`core/job-studios.ts`). `render.studios` es una lista de
  `{ hash, studio }`: `studio`, el `SavedStudio` que aplica `restoreStudio` (focos,
  entorno, imagen, cámara, materiales por pieza y visibilidad, con su id y su nombre);
  `hash`, el SHA-256 de su contenido sin id ni nombre en JSON de claves ordenadas
  (`canonicalJson`, `studioHash`, con el `core/sha256.ts` que ya había). **Una copia por
  id y *hash***: los cuatro trabajos de un 2 × 2 sobre dos estudios son dos copias, y
  *+ Añadir a la cola* dos veces con el mismo estudio sigue siendo una. Cada trabajo la
  nombra con el campo opcional `RenderJob.studioCopy` (su `settings.studio` no cambia:
  `{ kind: 'ONE', id, name }`). El *reducer* de la cola guarda la copia con los trabajos
  en la misma acción (`render/enqueue` y `render/updateJob` reciben en `studios` cada
  `StudioRef` con su `snapshot`; la interfaz los da con `studiosForJobs`), así que
  deshacer *Añadir a la cola* se lleva las dos cosas, y solo guarda las copias que nombra
  algún trabajo (`pruneEmbedded` en `withQueue`: quitar el último trabajo de un estudio
  quita su copia, deshacer la devuelve; *Duplicar* comparte la del original).
- **Lo grande, una vez.** Las luces llevan su perfil IES en el JSON, como las del proyecto
  (L5); el HDRI, la imagen de fondo y las texturas de la copia son `ImageRef`, y sus
  archivos van en el bloque `images` con los del proyecto (U2/E5/M2a), **una vez cada
  imagen** la nombre quien la nombre (`embeddedImageRefs` en `serializeProject`). Al abrir,
  `placeImages` y `placeTextureImages` las colocan con las del proyecto, decodificando cada
  una una sola vez, y le cambian el id a la vez en el proyecto y en las copias cuando en la
  sesión ya nombra otra imagen; `replaceProject` conserva en el registro las de las copias.
- **Al abrir y al renderizar.** `migrateRender` toma de `render.studios` lo que tiene forma
  de copia (un *hash* de 64 cifras, un estudio con id y nombre, sin repetir) y `studioCopy`
  de cada trabajo; `checkState` lee cada copia como los bloques del proyecto (entorno,
  imagen y cámara completados con los valores de un proyecto nuevo y con los tipos
  comprobados, perfiles IES con `withReadableProfile`, materiales con `readMaterial`, que es
  lo de antes sacado a una función, y los materiales que nombran sus piezas presentes); una
  copia dañada se quita, no el proyecto. Al renderizar, `resolveStudio` da el estudio del
  trabajo: **su copia**; sin ella, el de la biblioteca con ese id; si no, uno que el
  proyecto guardaba dentro (`studio.saved`); si no, el fallo con su motivo, como antes.
- **Formato.** Las convenciones de `io/project.ts`: dos campos añadidos con su valor por
  defecto, sin paso de esquema; **el esquema sigue en 2** (cabecera de `io/project.ts` y
  `ARCHITECTURE.md` §8). Un proyecto anterior abre igual (sin copias, los mismos trabajos;
  `project-v1.json` y `project-v2.json`), y una versión anterior que abra uno nuevo ignora
  los dos campos y busca los estudios en su biblioteca.
- **Añadir a mi biblioteca.** En el cajón *Cola*, entre la cabecera y la lista, una línea por
  estudio que vino con el proyecto y no está en la biblioteca (ni guardado en el proyecto):
  *El estudio «Estudio A» vino con el proyecto; no está en tu biblioteca* · **Añadir a mi
  biblioteca** (`studiosToAdopt`, `addProjectStudioToLibrary`), que lo guarda en *Míos* con
  su id y quita la línea. En la ventana de render, al editar un trabajo cuyo estudio solo
  está en el proyecto, la lista lo nombra *Estudio A (en el proyecto)* en vez de *(ya no está
  guardado)*. Cadenas en `es` y `en` (`queue.studioInProject`, `queue.addToLibrary`,
  `rw.studioInProject`).

**Pruebas.** `tests/job-studios.test.ts` (13): el **2 × 2 sobre dos estudios de la
biblioteca** guardado, abierto en otra «máquina» con la biblioteca vacía por *Abrir
proyecto* y renderizado: los cuatro trabajos terminan, con los nombres de la plantilla, cada
uno con el tipo de producto, los focos y la exposición de su estudio y por su cámara; **sin
el cambio falla** (los cuatro en *Fallido* con «El estudio “Studio A” ya no está guardado»:
comprobado con `git stash` de `src/` y el mismo test sin importar nada nuevo). La copia gana
a un estudio de la biblioteca guardado encima con el mismo id, y uno nuevo toma el de ahora;
una copia por estudio (dos *Añadir* iguales, el archivo la tiene una vez y los trabajos la
nombran por su *hash*); el *hash* no depende del orden de las claves, del id ni del nombre;
las copias siguen a los trabajos (deshacer, quitar, duplicar); editar conserva la copia o
toma la del estudio nuevo; **el HDRI del proyecto en un estudio no se duplica** (una entrada
en `images`, el archivo crece menos de la mitad del base64 de la imagen; abierto en una
sesión nueva la copia nombra el HDRI colocado, y en una sesión donde `hdri:1` es otra imagen
el proyecto y la copia pasan al mismo id nuevo) y un HDRI que solo tiene el estudio viaja
igual; los proyectos de antes abren igual; un trabajo de antes de N2b usa la biblioteca y,
sin el estudio, falla con el motivo; editarlo le da copia; una copia dañada se quita y el
proyecto abre; *Añadir a mi biblioteca* (qué ofrece, el id que conserva, que no toca el
proyecto). En `tests/batch.test.ts`, la prueba de N2 «un estudio que ya no está guardado
falla» pasa a decir lo de ahora: borrado de la biblioteca, el trabajo renderiza su copia; sin
copia tampoco, falla con el motivo. Cada prueba nueva se comprobó con una mutación (10
mutantes, todos muertos: sin las imágenes de las copias en el archivo, sin cambiarles el id
al abrir, sin podar, la biblioteca antes que la copia, sin quitar repetidas, el *hash* sin
ordenar las claves, una edición que cambia la copia, sin leer las copias al abrir, sin
conservar sus imágenes al abrir, y el render sin mirar la copia); dos sobrevivían al
principio (el *hash* sin ordenar y la edición) y sus pruebas se reforzaron.
`tools/batch-check.mjs` (g), en Chromium con el `rt.wasm` real: dos estudios y un lote
sobre los dos añadido a la cola en un perfil, *Guardar proyecto* (el `.repack` tiene las dos
copias y los trabajos las nombran), abierto en otro perfil con la biblioteca vacía: la cola
ofrece las dos líneas, *Iniciar cola* da `Studio 1.png` y `Studio 2.png` distintas, y añadir
uno deja la línea del otro. Captura nueva `batch-queue-adopt.png`.

**Puertas.** `npm run engine:build` y `npm run qa`: tipos y *build* en verde; de 3180 tests
(192 archivos), 3148 pasan, 31 se saltan y uno, `tests/material-program-cross.test.ts` «has a
fixture of every case», pasó del tiempo límite de 5 s con la máquina cargada por otros agentes
(no toca nada de esta fase): solo pasa (3 de 3). `tools/batch-check.mjs` en Chromium con el
`rt.wasm` real: las nueve comprobaciones en verde, (a)–(f) de N2 y (g1), (g2) de N2b. El motor
no se toca.

**Qué no encajó con el plan** (regla 12; lo marcado ◆ está decidido en *Decisiones de criterio*: se acepta tal como está):

- ◆ **La copia gana** sobre un estudio de la biblioteca con el mismo id y otro contenido
  (guardado encima), para los trabajos que ya la tenían; un trabajo nuevo de ese estudio
  toma el de la biblioteca como está y lleva otra copia con el mismo id. No hay *Actualizar
  desde la biblioteca* ni un aviso de que difieren.
- ◆ **Editar** un trabajo sin cambiarle el estudio conserva su copia, aunque la biblioteca
  haya cambiado; cambiárselo toma la del estudio nuevo (y la vieja sale si nadie la nombra).
- ◆ ***Añadir a mi biblioteca*** guarda el estudio con **su id** (los trabajos lo encuentran
  también allí), no se deshace (la biblioteca es de la persona, sin historial, U4: la regla 6
  se cumple en todo lo del proyecto, que no cambia) y solo se ofrece para un id que la
  biblioteca no tiene: una copia con el id de un estudio de la biblioteca que se guardó
  encima no se ofrece como estudio aparte. Está en el cajón *Cola*, no en un detalle del
  trabajo (no hay vista de detalle).
- ◆ **El esquema sigue en 2**, por la convención del formato (lo añadido con valor por
  defecto no sube el esquema): una versión anterior abre un proyecto nuevo sin error, sin
  las copias.
- **Un trabajo de antes de N2b no recibe copia al abrir** (abrir no cambia el proyecto: los
  proyectos de antes abren igual), ni al guardar (el archivo no ve la biblioteca): busca su
  estudio en la biblioteca, como antes; la recibe al editarlo o al volver a añadirlo.
- **La copia puede llevar más que la biblioteca.** La biblioteca no guarda imágenes (E5):
  tras recargar la página sus estudios no tienen HDRI; la copia lleva lo que el estudio
  tenía al crear el trabajo (en la misma sesión, también su HDRI, que entonces sí viaja).
- **Lo que sí va repetido, pequeño**: el perfil IES de un foco de la copia que también está
  en el proyecto va dos veces en el JSON (el formato no tiene un bloque de perfiles: L5 los
  lleva en la luz), y los materiales de la copia, como en todo estudio guardado. Las imágenes
  no se repiten nunca.
- **Los estudios que un proyecto antiguo guardaba dentro** (`studio.saved`) siguen sin
  escribir su HDRI en el archivo, como antes de N2b: no es de esta fase.
- **El *hash* no se recalcula al abrir**: es el nombre de la copia (completar sus campos al
  leerla cambiaría el texto); una copia editada a mano conserva su *hash*.
- **El motivo del fallo** sigue siendo «El estudio «…» ya no está guardado», también para un
  proyecto antiguo abierto en otro equipo.
- `tools/batch-check.mjs` se corrió con `--shots` a una carpeta aparte y solo se copió la
  captura nueva: las de N2 (`batch-window.png`, `batch-queue.png`) no cambian.

## D1 · Doctor de motor — **Sonnet** — hecha

**Qué.** Los chequeos que dependen del motor: `rt.wasm` cargado y
número de workers (y aviso si el navegador solo da uno), SIMD disponible
en wasm, denoise, transformada de vista, cáusticas (fireflies: muestras
aisladas muy brillantes detectadas en la acumulación), formato de salida
de vídeo, tiempo estimado frente al presupuesto. *Arreglar todo* en un
clic.

**Depende de.** E4.

**Criterio.** `tests/doctor-engine.test.ts` con un motor falso que simula
cada estado; cada chequeo se dispara y se limpia.

**Hecho.** Los chequeos de motor viven en un módulo propio,
`src/core/doctor-engine.ts`, enchufado a `runDoctor` y a `fixDoctor` por su
rama por defecto: los diez de escena, sus claves y sus pruebas no se
tocaron. Lo que el motor y el sistema dicen no es proyecto, así que la página
se lo entrega al Doctor como `EngineFacts` (`setEngineFacts`, igual que el tope
de partículas de S4a) a través de `installDoctorFacts` (`src/ui/doctor-facts.ts`),
que lo construye del estado de la interfaz y del `status()` del visor, pide
`doctor/refresh` solo cuando cambia algo (volátil, sin entrada de deshacer) y lo
repite tras deshacer y rehacer; `main.ts` le da un pulso de un segundo para lo que
solo sabe el motor. Sin hechos, los siete chequeos de motor y los dos que no se
tocan (`lighttree`, `persist`) siguen en *no disponible* con la misma forma de
antes. El catálogo pasa a **19** entradas: `simd` detrás de `engine` y `budget`
detrás de `output` (nuevas), y los textos de `engine`, `denoise`, `color`,
`caustics` y `output`, que hablaban de Cycles, reescritos para este motor con
sus claves intactas. Detección, arreglo y prueba de cada uno:

- **`engine`**: la disponibilidad de `ui.engine` (`NO_WASM`, `OUTDATED`,
  `FAILED`, `NO_WORKERS`, cada una con su frase) y un *pool* de un solo worker
  con el motor de WebAssembly. Sin arreglo; si es *Hilos* quien lo limita
  (Automático daría más), el aviso trae el botón **Ajustes** que abre esa fila.
- **`simd`**: `EngineInfo.simd` frente a lo que el sistema soporta y al ajuste:
  sin simd128, *SIMD* en *Desactivado* (con botón a esa fila), falta
  `rt-simd.wasm`, o un motor de escritorio sin camino vectorial.
- **`denoise`**: en el visor y no en el render, a fuerza 0, o un `rt.wasm` sin
  `rt_denoise` (los *workers* lo dicen en su primer mensaje, `ready.denoise`; antes
  nadie fuera del worker lo sabía). Apagado en todas partes no avisa. Arreglo:
  *Los dos* / 100 %, por `render/set`.
- **`color`**: con *Estándar*, la fracción del encuadre a más de una parada sobre el
  blanco (2 lineal, con la exposición aplicada) leída del histograma por
  paradas de la acumulación; con *Fílmica* y *AgX* no hace falta imagen. Arreglo:
  *Fílmica*.
- **`caustics` (Fireflies)**: `render/frame-scan.ts` lee la acumulación que la
  página ya tiene (sin tocar el motor): un píxel es un *firefly* si su media
  pasa del blanco, es 4 veces la del mejor de sus ocho vecinos y, con la
  luminancia al cuadrado, una sola muestra aporta la mitad de su luz o más (el
  cociente `lum2 / (Σ luminancia)²` es una cota inferior exacta de la parte de la
  mayor muestra). Avisa desde 8 píxeles o 10⁻⁵ del encuadre; arreglo: cáusticas
  *Apagado* → *Automático* y recorte de indirecta en 10, o, si ya está, solo
  «más muestras». Lo hacen `status().scan` del *pool* y del lanzador, leído de nuevo
  cuando las muestras se doblan (de la 16 en adelante).
- **`output`**: vídeo con un códec que el sistema no codifica, o vídeo a secas
  (un archivo que un fallo pierde entero). Arreglo: secuencia de fotogramas.
- **`budget`**: con la velocidad que el motor midió (`ui.throughput`, nunca
  inventada), el tiempo de *Tiempo* no llega a un Borrador (64), o el de *Lo que
  llegue antes* a la mitad de las muestras. Arreglo: subir el tiempo al
  necesario más una cuarta parte de holgura (`BUDGET_HEADROOM`), a la decena de
  segundos: la prueba en el navegador mostró que la velocidad que mide el visor se
  mueve de una lectura a la siguiente y un presupuesto justo volvía a quedarse corto
  nada más arreglarlo.

Un escaneo es de **una imagen**: lleva el proyecto del que sale (`basis`) y
`sameImage` (que repite `touchesImage` de los dos motores, con una prueba que las
compara) dice cuándo deja de valer; el Doctor no usa una lectura de otra imagen
(`Midiendo…`). El *store* vuelve a pasar el Doctor cuando cambia lo que los
chequeos leen (`engineInputsChanged`). Los arreglos pasan por el *store* y son
una entrada de deshacer; *Arreglar todo* los junta en una, y lo que el proyecto
no puede cambiar es un aviso con su explicación y sin arreglo falso.
`tests/doctor-engine.test.ts` (72 pruebas) lleva un motor falso que escribe
donde escribe el real y usa el `installDoctorFacts` de verdad: cada uno de los
catorce fallos de la tabla se dispara y se limpia, más *Arreglar todo*, los
umbrales en sus fronteras, `doctorSentence` en los dos idiomas, y que deshacer
refresca; `tests/frame-scan.test.ts` (17) lee acumulaciones sintéticas, el
`status().scan` del *pool* con *workers* falsos y el del lanzador con su simulador;
`tests/frame-scan-engine.test.ts` (3), el `rt.wasm` de verdad. Cada chequeo
nuevo se probó **desactivando su detección** (y cada arreglo, y cada umbral):
cerca de cien mutaciones, todas muertas salvo tres equivalentes: no recortar la
fila superior ni la inferior de los vecinos (fuera del marco se lee `undefined` y
no gana a nadie) y el `full` del `status()` del *pool* (la caché, que pide 16
muestras, ya lo cubre). `tools/doctor-engine-check.mjs` lo recorre en Chromium con el `rt.wasm`
real (27 comprobaciones: el motor y el visor sanos, *SIMD* en *Desactivado* con
su botón a *Ajustes*, *denoise* solo en el visor y un presupuesto de 5 s con la
velocidad que el motor midió, *Arreglar todo* y un deshacer) y deja
`docs/ui/doctor-engine.png`. El motor de Rust no se tocó: ni `rt_features` ni
ningún *hash* fijado se mueve. Compuertas: `npm run qa` en verde (159 archivos y
2746 pruebas pasan, 4 archivos y 6 pruebas omitidas; al empezar pasaban 2635) y
`npm run engine:test` en verde (1098 pasan, 11 ignoradas). Con K1 en la
misma rama conviven los dos: `runDoctor` da los 19 de `DOCTOR_CHECKS` y, con el tipo
*Interior*, los siete de `INTERIOR_CHECKS` detrás; `fixDoctor` encamina cada clave a su
Doctor (`isInteriorCheck`) y *Arreglar todo* limpia las dos clases en una entrada de
deshacer (cuatro pruebas en `tests/doctor-engine.test.ts`, que también fija que las claves
de interior no son ni de escena ni de motor). Coste: la lectura de
la acumulación corre en el hilo principal cada vez que las muestras se doblan
(de 16 en adelante: cinco o seis veces por vista) y tarda, medida en Node con el
código caliente, 40 ms a 1280 × 720, 160 ms a 2560 × 1440 y 330 ms a 4K.

Un fallo que apareció al probarlo y se corrigió con su prueba
(`tests/store.test.ts`): una acción que un oyente del *store* envía mientras se le
avisa de un deshacer, un rehacer, un reinicio o el cierre de una transacción
esperaba al siguiente `dispatch` (`apply` se vaciaba solo en `dispatch`); el
Doctor necesita pedir `doctor/refresh` tras deshacer, y no llegaba.

**Qué no encajó con el plan** (regla 12; lo marcado ◆ es de criterio y se
deja anotado para quien decide, la regla 11):
- ◆ **`color` no tiene en este motor el chequeo de origen** («la transformada
  de la escena no coincide con la elegida en los ajustes»): hay una sola fuente
  (`image.viewTransform`) y la página convierte las sumas ella misma, así que no
  hay nada que discrepe. La propuesta es otra cosa que el motor sí sabe: con
  *Estándar* se recortan las altas luces. Pendiente: si eso es un fallo (un fondo
  blanco liso se quiere recortado), el umbral (**1 %** del encuadre, a más de
  **una parada** sobre el blanco: `CLIP_FRACTION`, `CLIP_OVER_WHITE`) y si el
  arreglo es *Fílmica* o *AgX*.
- ◆ **`caustics` / Fireflies cambia de sentido**: el de origen avisaba de
  cáusticas *encendidas* sin necesidad; aquí las cáusticas son un mapa de
  fotones que quita fireflies, y apagadas los dejan. Umbrales propuestos, todos en
  `render/frame-scan.ts` y `core/doctor-engine.ts`: brillo ≥ 1 (blanco), aislamiento
  ×4, parte de una muestra ≥ 0,5, 16 muestras como mínimo, 8 píxeles o 10⁻⁵ del
  encuadre, recorte de indirecta **10** (un recorte quita energía: es un sesgo, no un
  arreglo gratis). Se miraron datos reales (`tests/frame-scan-engine.test.ts`): dos
  escenas ordinarias a 16 muestras, 0 *fireflies*; espejos con luces de alfiler a 64,
  4 con una muestra de hasta ~76 veces el blanco; no se afinó con más escenas.
- **Lo que no se mide**: dos *fireflies* pegados se ven como vecino brillante uno al
  otro y no cuentan; con el *denoise* del visor del lanzador encendido, las sumas que
  llegan a la página son la imagen filtrada (`fireflies: null`, y el chequeo dice que
  no hay nada que contar; el *pool* lee siempre las sumas sin filtrar); en *Rápido*
  no hay acumulación.
- ◆ **`budget`: qué es «demasiado lento para el presupuesto»**. No hay presupuesto
  de tiempo si se termina por muestras o por ruido (no avisa); con *Tiempo*, el
  de un Borrador (64 muestras) es el mínimo para una imagen utilizable; con *Lo
  que llegue antes*, la mitad de las muestras pedidas (`BUDGET_REACH`). El arreglo
  sube el tiempo (con un 25 % de holgura) y no baja las muestras (la otra salida
  honesta); una animación se
  juzga por el presupuesto de cada fotograma, y su total no se compara con nada.
- ◆ **`output` dormido**: hasta N1 los ajustes fuerzan la secuencia de
  fotogramas, así que solo un proyecto de un futuro con vídeo lo dispara. Se decide
  si debe avisar también cuando el códec sí se codifica (hoy sí, por «un archivo
  que un fallo pierde»); el arreglo es siempre la secuencia, sin cambiar de
  códec.
- ◆ **`denoise`**: solo avisa del visor sin el render (no al revés: el visor en
  bruto es una decisión de cada día) y de fuerza 0; el arreglo es *Los dos* / 100 %.
- **`lighttree` y `persist`** siguen en la lista como *no disponibles* con su motivo
  (el árbol de luces es de K4; los datos persistentes son de Blender y no tienen
  equivalente): las claves son estables y no se quitan. Si se prefiere, `persist`
  puede retirarse del catálogo en una fase de limpieza.
- **Ajustes de la aplicación**: lo que limita *Hilos* y *SIMD* no es del proyecto
  ni se deshace; el Doctor lo señala con un botón que abre la fila y no lo
  cambia. Si se prefiere un arreglo que lo cambie, es una decisión (la regla 6 dice
  que toda mutación es deshacible).
- `sameImage` repite la lista de `touchesImage` del *pool* y la del lanzador (ya
  eran dos copias): `tests/doctor-engine.test.ts` las compara en dieciséis
  acciones. Difiere en el cabezal, a propósito (el Doctor no corre en cada fotograma).
- La burbuja de ayuda de *Arreglar* usa el texto del catálogo; los de motor lo
  dicen en general («Sin arreglo en el proyecto: …»), y el aviso de cada caso, la
  razón.

## U5 · Ventana de render y visor de resultados — **Opus** — hecha

**Qué.** `UI.md` §2.5, §2.7 y §2.8: la barra inferior pierde calidad,
resolución, presupuesto y formato, y queda con *Animación*, *Cola* (con
contador y progreso) y **Render…**; la **ventana de render** al estilo de
KeyShot con *Imagen · Animación*, *Salida* (nombre por plantilla con
fichas, carpeta al terminar con el acceso al sistema de archivos del
navegador donde exista y *Descargas* donde no, formato, transparente,
cámara una o todas, tamaño en píxeles y tamaño de impresión con **ppp**
enlazados y escritos en el archivo —`pHYs` en PNG, densidad JFIF en
JPEG—), *Calidad* (*Terminar por* muestras o tiempo, *lo que llegue
antes* en avanzado, estimación a partir de las muestras por segundo
medidas), *Animación* (rango, fps, vídeo o fotogramas, presupuesto por
fotograma, estimación total; la secuencia de fotogramas funciona ya, el
vídeo codificado llega con N1 y se marca *próximamente* hasta entonces),
la sección *Post-procesado IA* como hueco plegado (*próximamente* hasta
X3), y el pie con **+ Añadir a la cola** y **Render** (este último pone
el trabajo el primero y lo arranca); `RenderJob` completo en el *store*
con migración del estado de U1; cajón *Cola* con reordenar, editar,
duplicar, pausar y terminados; **visor de resultados** sobre el visor
con zoom, datos y el **componente de comparación con divisor
deslizable** genérico (dos imágenes cualesquiera), que X3 reutiliza;
historial de resultados en el almacenamiento del navegador (IndexedDB u
OPFS) con límite y borrado; atajos `Ctrl ⏎`, `Ctrl ⇧ ⏎`, `⏎`, `⇧ ⏎`.

**Depende de.** E4 (render siempre con el trazador).

**Criterio.** Tests: `px = tamaño × ppp` en los dos sentidos con
redondeo y candado; el PNG lleva `pHYs` con los ppp (lectura del
fichero en el test) y el JPEG su densidad; plantilla de nombre con todas
las fichas; *Render* y *+ Añadir a la cola* producen la cola esperada;
*Todas las cámaras* crea un trabajo por cámara; *Terminar por tiempo*
corta en el límite (±1 pasada); migración de un proyecto de U1; la
ventana no aparece en la captura del visor. Capturas de la ventana en
*Imagen* y en *Animación*, del cajón *Cola* con tres trabajos y del
visor de resultados con el divisor.

**Hecho.** La barra inferior queda con *Animación*, *Cola* (contador y
progreso), el último resultado y **Render…**; la ventana de render
(`ui/panels/render-window.ts`) con *Salida* (plantilla con fichas,
*Descargas* o carpeta elegida con el permiso recordado, PNG 8/16 bits,
JPEG con calidad, EXR lineal sin comprimir, transparente, cámara activa,
una o todas, píxeles ↔ impresión con candado y ppp), *Calidad* (*Terminar
por* muestras, tiempo o lo primero, estimación con las muestras por
segundo medidas, avanzado con rebotes, recorte y semilla), *Animación*
(rango, fps, fotogramas funcionando ya, vídeo *próximamente*), el hueco
plegado del post-procesado IA y el pie con **+ Añadir a la cola** y
**Render**. Los ppp van en `pHYs` (PNG) y en la densidad JFIF (JPEG).
*Terminar por tiempo* lo decide `render/schedule.ts` entre pasadas
midiendo el tiempo por muestra, siempre dentro de una pasada del límite.
`RenderJob` completo con migración pura del estado de U1 y
`PROJECT_SCHEMA = 2`. Cola con reordenar, editar, duplicar, pausar y
terminados; visor de resultados con zoom, datos y el componente genérico
`ui/components/split-compare.ts`; historial en IndexedDB (50 resultados o
500 MB) con memoria como respaldo. 621 tests; 31 mutaciones comprobadas;
8 comprobaciones en el navegador (`tools/render-window-check.mjs`), entre
ellas que la ventana nunca aparece en la imagen del visor. Capturas
`render-window-image.png`, `render-window-animation.png`,
`queue-drawer.png` y `results-split.png`.

No encajó con el plan: la cola pasa a ser **deshacible** (U1 la hizo no
deshacible; manda este brief); *Render* con la cola en marcha no
interrumpe el trabajo en curso, va el primero y empieza después; en
*Animación* hace falta una fila *Tamaño del fotograma* (solo píxeles) y
las secciones van apiladas; el historial guarda solo el primer fotograma
de una animación; *Pausar* reinicia el trabajo, porque un render no se
reanuda a medias; `{n}` es el número de render en imagen y el de
fotograma en animación; EXR también para secuencias, sin ppp; los ajustes
avanzados solo se aplican al render, no al visor Completo; *Abrir
carpeta* se oculta en el navegador. Observación para L3: con el estudio
de joyería, REMBRANDT y NEON_NOIR solo cambian un 3 % de los píxeles; se
revisa con las recetas sobre el motor propio.

## U6 · Ventana de Ajustes y gestor de modelos — **Opus** — hecha

**Qué.** Petición del usuario: unos Ajustes profesionales, todo lo
configurable separado por módulos y agrupado en una columna a la
izquierda. `UI.md` §2.9 entero: la ventana (960 × 680, buscador,
grupos *Aplicación* · *Render* · *Sistema*, cambios al momento, punto y
*Restablecer* por fila y por sección, enlaces directos y
`?settings=<sección>`), y sus secciones **General**, **Preferencias**,
**Accesibilidad**, **Atajos de teclado**, **Motor de renderizado** (con
*Medir rendimiento* de verdad), **Post-procesado IA**, **Almacenamiento**,
**Escritorio** (solo en la aplicación de escritorio) y **Acerca de** (con
las licencias de terceros completas). Los ajustes son un objeto tipado
con versión, valores de fábrica y migración en `src/core/settings.ts`
(puro), guardado por `src/ui/prefs.ts`; las preferencias sueltas de hoy
(tema, idioma, anchos, modo del visor) migran a él.

El **gestor de modelos** de `AI-POST.md` §5 (absorbe X5): la lista de
`src/data/ai-models.json` (de X1 parte A) y los importados; descargas
con progreso, pausa, reanudación tras cerrar (peticiones `Range`), y
`sha256` por fichero; almacenamiento en OPFS en la web y en la carpeta
de datos a través del lanzador en escritorio (P2), detrás de una sola
interfaz `ModelStore`; *Usar*, *Eliminar*, *Importar modelo…* con el
manifiesto `model.repackshot.json` validado y rechazo de *pickle*;
licencia mostrada y aceptada antes de la primera descarga; la
**configuración del modelo activo**; la **detección del equipo** (límites
de WebGPU en la web; `/api/hardware` del lanzador en escritorio) y la
**regla de recomendación** evaluada sobre la tabla del JSON. Si el
instalador dejó una elección, sus descargas arrancan en el primer
arranque. En las versiones portables de escritorio el selector aparece
una vez en el primer arranque; en la web, la primera vez que se activa el
post-procesado (`AI-POST.md` §2.2) y siempre en *Ajustes*, porque hoy no
hay modelo para navegador. Mientras no exista X3 el post-procesado no
corre: la sección lo dice en una línea y lo demás funciona.

**Depende de.** U5 (la ventana de render enlaza con *Gestionar
modelos…*), X1 parte A (el JSON con ficheros y `sha256`). La parte de
escritorio del almacenamiento se prueba con el lanzador de P2.

**Criterio.** Tests: migración de las preferencias sueltas; cada ajuste
tiene valor de fábrica y *Restablecer* lo devuelve; el buscador encuentra
un ajuste por una palabra clave en `es` y en `en`; la regla de
recomendación da la fila de `AI-POST.md` §2.4 en los bordes de cada tramo
(fichero de casos `tests/fixtures/ai-recommend-cases.json`, el mismo que
usa el test en Rust de P2); sin detección no recomienda; un manifiesto
inválido se rechaza con el motivo; un `.ckpt` se rechaza; un modelo no
comercial no puede ser el de por defecto; borrar el activo vuelve a la
recomendación; una descarga cortada se reanuda desde el último byte
escrito (servidor de prueba con `Range`) y un `sha256` erróneo deja el
fichero *Dañado*; contraste alto y tamaño de interfaz cambian los
*tokens* y siguen acromáticos. Capturas en inglés de *General*,
*Accesibilidad*, *Motor de renderizado* y *Post-procesado IA ▸ Modelos*
con una descarga en curso.

**Hecho.** `src/core/settings.ts`: unos 57 ajustes tipados con versión,
valores de fábrica, validación, migración de las preferencias sueltas y
una tabla de metadatos (`SETTING_ROWS`) de la que salen la ventana, el
buscador en los dos idiomas, los puntos de *cambiado* y *Restablecer*. La
ventana (`ui/panels/settings-*.ts`) con los grupos *Aplicación*,
*Render* y *Sistema*, enlaces directos y `?settings=`; cada sección
conectada de verdad (navegación y botones del ratón, resolución durante
gestos, tamaño de interfaz y de texto, contraste alto, reducir
movimiento, anuncios para lectores de pantalla, motor *Automático ·
Nativo · WebAssembly*, hilos y SIMD, límite del visor, *Medir
rendimiento* con un render real de 10 s, límites del historial, carpeta
de datos, licencias de terceros completas copiadas al construir).
*Último proyecto* funciona: el encabezado pregunta al arrancar si abrir
el último archivo. Gestor de modelos con una interfaz `ModelStore` y tres
implementaciones (OPFS en un worker con la misma disposición por
`sha256` que el lanzador, el lanzador y memoria), descargas por trozos de
4 MiB con `Range`, reanudación tras recargar, SHA-256 propio en
streaming (fichero *Dañado* si no cuadra), dos ficheros a la vez, lo
compartido una sola vez, licencia aceptada antes de descargar, importación
con manifiesto y rechazo de *pickle*, la elección del instalador al
arrancar y el selector una vez en los portables. 939 tests; comprobaciones
en navegador web (`tools/settings-check.mjs`) y de escritorio con el
lanzador real (`tools/settings-desktop-check.mjs`). Capturas
`settings-general.png`, `settings-accessibility.png`,
`settings-engine.png`, `settings-ai-models.png` y `settings-desktop.png`.

No encajó con el plan: *Próximamente* la copia automática, las letras de
acceso, cambiar atajos, *Buscar actualizaciones* y la tubería de IA; las
descargas del catálogo por el lanzador no se probaron con ficheros de
varios GB (la importación cubre el almacén de punta a punta); el test de
límites de U2 tenía un falso positivo y el test acromático leía cadenas
vacías en vez del CSS (los dos corregidos, con su caso); *Al arrancar*
vale *Proyecto vacío* por defecto, como hasta ahora, con el modo
estándar ya montado. Encontró un fallo de P2: un proyecto vacío nunca se
renderiza en nativo (el lanzador pide mallas que no hay).

## N3 · Paseo de cámara — **Sonnet**

**Qué.** El tipo de animación `WALK` de `SPEC.md` §3.7: herramienta
*Trazar paseo* en el visor (clic en el suelo por punto, `⏎` termina,
puntos arrastrables, la curva dibujada en tinta), *Paseo alrededor de la
selección* en un clic, Catmull–Rom centrípeta recorrida a velocidad
constante por longitud de arco con arranque y parada suaves, altura de
ojos, mirada hacia delante / hacia un objetivo / por puntos con giro
suavizado, y **Simular pasos** (cadencia, balanceo vertical y lateral,
inclinación, sincronizados con la distancia y apagados al pararse). Se
edita en el inspector de animación y aparece como barra en la pista de
cámara. *Recorrido de la sala* se activa cuando exista K2.

**Depende de.** N1.

**Criterio.** Tests de `evaluate`: la velocidad es constante ±1 % en
toda la curva salvo arranque y parada; la altura de la cámara es la de
ojos ±0 sin pasos y oscila con la amplitud y la cadencia pedidas con
pasos; con *hacia un objetivo* el objetivo queda en el centro del
encuadre ±0,5°; parar a mitad de curva apaga el balanceo en menos de un
paso; el mismo `t` da la misma cámara siempre. Un vídeo de 4 s del
paseo alrededor de la botella, con y sin pasos.

## X1 · Confirmar el modelo de IA — **Fable**, con Sonnet preparando

**Parte A, adelantada (la necesita U6) — hecha.** Sonnet preparó y el
líder confirmó los datos (2026-10-13): las siete claves con sus ficheros
fijados a *commit*, tamaños y `sha256` comprobados por dos fuentes, y las
licencias citadas en `docs/ai-licences.md`. Decisiones del líder:
`ZIMAGE_WEB` queda **no disponible** (la exportación ONNX publicada no
trae codificador del VAE; lo exporta X3); codificador de texto oficial
Qwen3-4B, Qwen2.5-VL de ggml-org y klein Q4_K_M de Unsloth, los tres a
probar en la parte B; almacenamiento por `sha256` para no descargar dos
veces lo compartido. No encajó con la tabla: SD 1.5 pesa 3,6 GB y no
3,1 (faltaban codificador y VAE) y Qwen-Edit 19 GB (faltaba el proyector
de visión); la "LoRA de iluminación" no tiene fichero elegido y sale de
la descripción. El JSON entra en el repositorio con P2.

Lo que se pidió: Sonnet prepara y Fable confirma `src/data/ai-models.json`: para cada clave de `AI-POST.md` §2.4,
el repositorio de origen, cada fichero con su URL de descarga directa,
tamaño exacto y `sha256`, la licencia con su texto citado y su URL, y la
regla de recomendación como tabla de datos. Sin medidas todavía: los
umbrales son los de la tabla, marcados *provisionales*.

**Parte B, tras X3c.** `AI-POST.md` §2: releer y citar al pie de la letra las licencias
de Z-Image-Turbo, su codificador, su VAE y su ControlNet, y de FLUX.2
klein 4B, y la de stable-diffusion.cpp y ggml; Sonnet prepara una
**herramienta** que genera la hoja comparativa (8 renders del motor
—producto e interior—, 3 intervenciones, los dos modelos, con las
métricas de la guarda de §3.2, el tiempo y el pico de memoria, en Vulkan
y en CPU) y que el usuario ejecuta **en su equipo** (aquí no hay GPU); con
esa hoja **Fable elige** el modelo y fija las tolerancias iniciales
(ΔE₀₀, bordes, nitidez) y los umbrales de la regla de §2.4. Los `sha256`
de la web (q4f16) los fija X3d.

**Depende de.** X3c (la tubería tiene que existir para medir).

## X2 · Pases del motor para la IA — **Opus** — hecha

**Qué.** Contrato en `AI-POST.md` §7.4 y `src/core/passes.ts`. En
`rt-core`: pases de albedo (primer rebote no especular), normal,
profundidad, id de pieza, id de material y mapa de desenfoque (círculo de
confusión de la lente fina), con máscara de pases en `RNDR`; exportación
en `rt-wasm`, acumulación en el pool de E4 y lectura en TypeScript; en el
lanzador, `passes=…` en `/api/render` para los trabajos finales, que los
guarda por id para la tubería, y `GET /api/render/<id>/passes`. Coincide
con la parte de pases de N2 y la adelanta.

**Depende de.** E4, y **E5 fusionada** (los dos tocan el integrador).

**Criterio.** Tests: el id de pieza de cada píxel coincide con el `pick`
del centro del píxel; el albedo de un material difuso es su color; el
mapa de desenfoque es cero en el plano de enfoque y crece con la
distancia según la fórmula de lente fina (±1 %); pedir pases no cambia
ni un píxel de la imagen; determinismo y paridad nativo/wasm intactos.

**Hecho** (2026-10-13). `rt_core::passes` con el contrato de §7.4:
`RNDR.passes` (40 B; los RSB anteriores no piden ninguno, los bits
desconocidos se conservan), `render_tile_exact` (normal, profundidad,
ids y círculo de confusión de **un rayo por el centro del píxel y de la
lente**, `render::centre_ray`, una vez por baldosa) y `render_tile_albedo`
(el rayo de cámara de cada muestra de la imagen, sumado en `f32` en orden
de muestra y dividido como `Film::resolve`), sobre `integrator::first_hit`
(lo más cercano entre geometría y suelo; un panel de luz visible a cámara
cruzado antes es fondo) y `PassFilm`/`Passes`. El suelo del estudio
(visible o atrapasombras) es `FLOOR_ID` en los dos ids; el fondo, 0 y
+∞. Los pases tienen rayos propios: la imagen conserva sus *hash*
(`0x223515c3`, `0xbf8abd5b`, `0x2fcb098a`) con todos los pases
intercalados. *Hash* fijados de los seis planos del ejemplo (albedo
`0x43571da9`, normal `0x0aabfd24`, profundidad `0x25f8dd11`, ids
`0xccd3d6c7` los dos, `coc` `0xdf87494c`) y del ejemplo de E5 (`0xace93461`,
`0x714253d6`, `0x9b1b61c8`, `0x2c21fa55` ×2, `0x73bf76f1`), iguales en
escalar, SSE2 y AVX2, en las dos pasadas de WASI, en el `rt.wasm` real
(escalar y `simd128`, `tools/wasm-parity.mjs --expect-passes`, en CI),
por la API del lanzador con 1 y 4 hilos y por el código de la página
(`tests/passes-engine.test.ts`). `rt-wasm`: `rt_render_tile_passes` y
`rt_render_tile_albedo`; el pool los pide con la máscara del trabajo y los
junta con `PassAccumulator` (`src/render/pass-planes.ts`), y
`renderPixels` devuelve `RenderPasses`. Lanzador: `passes=` en los
finales (400 si nombra un pase que no existe o en el visor), almacén de
los **cuatro últimos** renders con pases por id (imagen lineal y pases;
los de más de 64 MiB en `<datos>/cache/ai/<id>.rpx` y `.rpp`, que se
limpia al arrancar; `DELETE` del trabajo no los borra), servido como
`RPP1` en `GET /api/render/<id>/passes` (404 si no existe o se desalojó,
409 mientras se renderiza), `Engine::kept` para X3c; `native.ts` lo pide
y lo lee con `parsePasses` y devuelve también `renderId`. El círculo de
confusión es el de `lens-coc.ts` (los dos lados leen
`tests/fixtures/lens-coc.json`) y coincide dentro de 1 % (en la práctica,
1e-5) con el desenfoque medido de la lente de `Camera::generate_ray`.
Los pases de three.js de X4 coinciden con los del motor en ids y
profundidad en su escena de prueba (comparados en
`tests/ai-passes-browser.test.ts` con el `rt.wasm` real), salvo el
suelo. Tests: 22 nuevos en Rust (15 de `rt-core`, 1 de `rt-wasm` y 6 del
lanzador: almacén, formato `RPP1`, trabajos y API) y 12 de vitest; 19
mutaciones comprobadas (cada test falla si se rompe lo que guarda).

**No encajó con el plan.** (1) **El suelo en los pases de three.js**: el
contrato corregido (suelo = `FLOOR_ID`) lo cumple el motor; la vista
previa de X4 todavía lo dibuja como fondo (0, +∞). No se toca aquí:
§7.4 se lo da a X3c, y el test del navegador acepta hoy 0 en los píxeles
del suelo y lo anota. (2) Decisiones donde el contrato no decía nada,
anotadas en §7.4: el albedo de un emisor es su `base_color`; el del
suelo, `FLOR.color` también en el atrapasombras (que no lo usa para
pintar); con profundidad de campo el albedo sigue cada muestra por la
lente y se emborrona como la imagen (la comparación de X2 con la
referencia de X4 solo exige el color exacto donde `coc` < 0,25 px); un
recorte o un vidrio paran el rayo de los pases, como `pick`; una
instancia con índice de material fuera de rango lleva `materialId` 0.
(3) En el ejemplo y en el de E5 la instancia *i* lleva el material *i*, así
que sus planos de ids tienen el mismo *hash*: el orden de los dos planos
lo vigilan el fichero `tests/fixtures/passes-3x2.rpp` (lo escribe el
lanzador y lo lee la página) y la escena de X4, donde no coinciden.
(4) La máscara viaja por dos sitios en el lanzador (`RNDR.passes` y
`passes=`): un final renderiza la unión. (5) Los rayos de los pases
cuentan en los rayos del trabajo (`rays` de la trama): uno por píxel para
los exactos y uno por muestra para el albedo. (6) `engine/README.md` está
entero en inglés; su sección de pases también, para no partir el
fichero. (7) **Con P3a** (fusionada después): los pases se renderizan con
los hilos o los workers que tenga el render, también cuando el visor
sigue vivo en su parte (`share=`, los carriles del pool), y salen los
mismos bits (lo prueban el lanzador y el pool); un final cancelado, huérfano
(su página dejó de preguntar) o fallido no guarda nada; `native.ts` lee los
pases con la señal de cancelación del render y antes de soltar el
trabajo (`DELETE`, `pagehide`), y `GET /api/render/state` da la máscara de
cada trabajo.

## X3 · Tubería de post-procesado y guarda — partida en X3a–X3d

Decisión del líder (`AI-POST.md` §7): en escritorio todo nativo (la
página solo envía ajustes y recibe resultados), la guarda en un *crate*
propio sin dependencias, y la web detrás.

### X3a · `rt-post`: la guarda y los píxeles — **Opus** — hecha

**Qué.** `AI-POST.md` §3.2 y §7.2: `engine/crates/rt-post` (solo `std`,
`f32`, determinista, sin `unsafe`) con condicionamiento (bordes de los
cambios de id y normal, profundidad normalizada), plan de mosaicos con
solape y fusión, relleno a múltiplo de 16 y recorte, la **guarda**
completa (transferencia de sombreado, separación de frecuencias, regiones
por id con ΔE₀₀, nitidez frente al mapa de desenfoque), las
comprobaciones y la máquina de pasos con retroceso; `rt-post-wasm` →
`public/engine/post.wasm`; en `src/ai/`, la envoltura TypeScript de ese
wasm y el *prompt* desde materiales y luces (`prompt.ts`). Informe con la
forma de `GuardReport` (`src/core/ai.ts`).

**Depende de.** Nada (los pases se sintetizan en los tests).

**Criterio.** La guarda, probada con un "modelo" sintético que hace
cosas prohibidas (mueve una arista, cambia el color de un material,
emborrona lo enfocado, enfoca lo desenfocado, cambia el tamaño, toca
fuera de las regiones): cada una se detecta y se corrige o se rechaza;
con intervención 0 la salida es idéntica bit a bit a la entrada sin
llamar al modelo; la resolución de salida es siempre la del trabajo;
mismo resultado en nativo y en wasm, bit a bit; puertas del motor
(`fmt`, `clippy`, sin dependencias en `Cargo.lock`).

**Hecho.** `engine/crates/rt-post` (`#![forbid(unsafe_code)]`, solo
`std` y `rt-core` para `fmath` y las curvas de tono) con la máquina de
pasos `plan(&job) → Plan` (mosaicos de ≤ 1024² con solape ≥ 128 px y
mismo tamaño, relleno a múltiplo de 16 repitiendo el borde; sin mosaicos
si Intervención es 0 o todos los aspectos están a 0, y entonces la salida
es la entrada bit a bit sin llamar al modelo), `tile_input` (la imagen del
motor con su exposición y su curva, sRGB de 8 bits), `conditioning`
(bordes 255 a los dos lados de cada cambio de `partId`, `materialId` o
normal de más de 30°; profundidad normalizada sobre toda la imagen, cerca
255, la superficie más lejana 16, fondo 0) y `accept(&plan, &original,
&passes, &salidas, intento) → Accepted{image, report} | Retry{strength,
attempt, reason} | Rejected{report}`; `run` es el conductor para un
modelo dado como función. La guarda multiplica siempre la imagen del
motor por una ganancia: (a) transferencia `ln blur(modelo) − ln
blur(motor)` (gaussiana normalizada sobre las regiones abiertas,
σ = 16·√MP entre 8 y 32, calculada en una rejilla hasta 8 veces más
gruesa y devuelta con B-spline cúbica), llevada a luz de escena por la
pendiente local de la curva de tono y partida en cambio común (Fuerza
del estilo), luminancia local (Luz, ganancia gris) y color local
(Rebotes), cada parte por su control y topada por control × fuerza del
intento; (b) banda media del modelo (σ 3 px a σ baja) solo en materiales
con desgaste, enfocados (cdc ≤ 1 px, nada a ≥ 3 px) y a más de 8 px de
una arista; (c) fondo y materiales bloqueados intactos y el cambio de
color de cada material rebajado hasta que su ΔE₀₀ medio y p95 queden en
el 80 % de la tolerancia. Comprobaciones independientes de cómo se hizo
el resultado: tamaño, píxeles cambiados fuera de lo permitido (bit a
bit), desplazamiento de aristas (pico del gradiente con refinamiento
parabólico, en el canal de mayor salto), SSIM de la banda alta, nitidez
por bloque de 32² frente al mapa de desenfoque y ΔE₀₀ por material
(CIEDE2000 de Sharma, Wu y Dalal 2005, probado con sus 34 pares).
Tolerancias **provisionales** en un solo `struct` (`Tolerances`, claves
estables, se pueden pasar en el trabajo para calibrar): ΔE medio ≤ 2,
p95 ≤ 3, aristas ≤ 1,5 px, SSIM alta ≥ 0,98, enfoque ≤ 15 %, topes de
Luz 0,3, Rebotes 0,15, Estilo 0,2 y Desgaste 0,15 (logaritmo natural, a
control e intervención 100). Informe JSON escrito a mano con la forma
exacta de `GuardReport`. `rt-post-wasm` → `public/engine/post.wasm`
(189 KB, sin importaciones) desde `npm run engine:build`; `src/ai/post-wasm.ts`
(`PostGuard`, `PostSession`, `runGuarded`, `encodeJob`; worker y Node,
comprueba los tamaños antes de pasar punteros) y `src/ai/prompt.ts`
(`buildPrompt`, negativo fijo, `guardMaterials`); `AiGuardMaterial`
añadido a `src/core/ai.ts`. 50 tests de Rust (47 de `rt-post`, 3 del ABI)
y 16 de vitest; el "modelo" sintético mueve aristas, cambia el color de
un material, emborrona lo enfocado, enfoca lo desenfocado, toca el fondo,
mete desgaste en todas partes y devuelve otro tamaño, y cada test falla
si se apaga el paso que lo cubre (comprobado apagándolos uno a uno en el
código). Paridad: `tests/fixtures/ai-guard.json` (cinco escenarios:
intacto, prohibido, fuerte, limitado, rechazado) lo fija el test nativo y
el `post.wasm` real lo reproduce bit a bit (imagen, entradas del modelo y
JSON), también en CI. Rendimiento nativo de un hilo: ≈ 2,3 s por intento
a 1 MP y 7 s a 4 MP.

Lo que no encajaba con el plan: (1) "Transferencia en dominio
logarítmico" se hizo como logaritmo de la razón de los desenfoques (de
luz, no de logaritmos: desenfocar logaritmos convierte un texto
emborronado en un cambio de luz, por la desigualdad de Jensen), como dice
§3.2. (2) La guarda trabaja en luz de escena: el cambio que el modelo
hace en pantalla se pasa a escena por la pendiente de la curva, y la Luz
es una ganancia gris de escena (como más luz en el motor); en el hombro
de la curva eso desatura un poco, así que el ΔE₀₀ por material se mide
contra la imagen del motor **con el cambio permitido** (estilo y
luminancia dentro de los topes) vista por la misma curva: mide el cambio
del color del material, no el de la luz. **Fable debe confirmar ese
criterio** en X1b. (3) Nitidez, detalle y aristas se miden en luz de
escena (la curva comprime el contraste de las altas luces como lo haría
un render más claro, y eso no es desenfoque), y detalle y enfoque miran
el interior de las regiones (a 4 px de una arista, el salto de una
silueta cambia al reiluminar un solo lado; las aristas tienen su propia
comprobación). El SSIM de la banda alta excluye además los píxeles donde
Desgaste puede añadir detalle. (4) Comprobación de aristas por canal
(máximo de los tres): con solo luminancia, reiluminar una pieza hasta la
luminancia del fondo "borraba" una arista que sigue viéndose por el
color. (5) Un mosaico de otro tamaño rechaza a la primera (una fuerza
menor no lo arreglaría) y entrega la imagen del motor. (6) Reglas
provisionales que deja anotadas para X1b: admite desgaste toda familia
con tipos de desgaste en el catálogo (todas menos la emisiva; quizá el
vidrio no debería), los emisores quedan bloqueados, profundidad de
superficie más lejana 16. (7) `AiPostRequest` no lleva la tabla de
materiales de la guarda ni el orden de materiales del RSB: X3c tendrá
que añadir `materials?: AiGuardMaterial[]` (o derivarla en el lanzador)
y `io/rsb.ts` exportar el orden (`guardMaterials(state, orden)` ya lo
espera); el código de la curva de tono (`tonemapFor`) también vive en
`io/`, así que el trabajo lo recibe como número. (8) La razón de un
LIMITED dice cuánto se rebajó, no por qué falló el primer intento; el
motivo de cada reintento sale en `Retry.reason` para el registro. (9)
Las alineaciones: el ABI de `post.wasm` recibe bytes *little-endian*, no
`f32` alineados, para no exigir alineación de punteros.

### X3b · stable-diffusion.cpp en escritorio — **Opus** — hecha

**Qué.** `AI-POST.md` §7.1: `src/data/ai-runtimes.json` con las
compilaciones oficiales fijadas (Vulkan y CPU, Windows y Linux x86_64:
URL, tamaño, `sha256`, licencia citada, versión, `supports` comprobado),
la regla de elección (Vulkan con GPU, CPU sin ella) evaluada igual por la
interfaz y el lanzador, descarga e instalación desde *Ajustes ▸
Post-procesado IA* (fila *Motor de ejecución*, con progreso, reanudación
y `sha256`, a `<datos>/ai/runtimes/<sha256>/`), el proceso auxiliar en
`rt-app` (arranque, argumentos por clave de modelo, progreso,
cancelación, tiempo límite, cierre con la aplicación, sin ventana de
consola en Windows) y la API `/api/ai/runtime` (estado como
`AiRuntimeStatus`) y `/api/ai/run` (una inferencia *img2img* sin guarda:
imagen, control, *prompt*, fuerza, semilla).

**Depende de.** P2.

**Criterio.** Tests con un proceso auxiliar **falso** (un binario de
prueba que habla el mismo protocolo): argumentos exactos por clave,
progreso, cancelación, tiempo límite, proceso colgado, salida de tamaño
distinto rechazada; un `sha256` que no coincide no se instala. Con la
compilación real de Linux CPU, `--help`/versión se leen y la fila de
*Ajustes* lo muestra. Sin descargar pesos de varios GB en este entorno: la
primera imagen real se hace en el equipo del usuario.

**Hecho.** `src/data/ai-runtimes.json` fija la *release* oficial
**`master-959-d637cfb`** de stable-diffusion.cpp (*commit* `d637cfb9…`,
2026-10-12; ggml `d25b121c…`): `SDCPP_WIN_VULKAN` (30 139 117 B),
`SDCPP_WIN_CPU` (17 558 769 B), `SDCPP_LINUX_VULKAN` (37 009 067 B) y
`SDCPP_LINUX_CPU` (26 143 940 B), cada zip descargado una vez para medirlo
y calcular su `sha256`; licencias MIT citadas en `docs/ai-licences.md` §7.
`supports`: las seis claves de escritorio según la documentación del *tag*
y los argumentos que construimos; `verified: []`. En el mismo JSON, como
datos que X1 puede corregir sin tocar código: la **regla de elección**
(filas `choice`, evaluadas igual por `src/core/ai-runtimes.ts` y
`rt-app/src/ai/catalogue.rs`, las dos contra
`tests/fixtures/ai-runtime-cases.json`) y los **perfiles por familia**
(argumentos de carga con `@rol`, pasos, cfg, muestreador, *flow shift*,
imagen como `init` o `init+ref`, ControlNets). En `rt-app/src/ai/`, solo
`std`: *inflate* (RFC 1951) y zip (APPNOTE, Zip64) propios, lector PNG
completo (todos los tipos, filtros, Adam7), base64; el almacén de motores
(`<datos>/ai/runtimes/<sha256>/`, `sha256` antes de instalar, descompresión
segura, `--version` y `--list-devices`); el **modo servidor** (`sd-server`,
API nativa `/sdcpp/v1/img_gen`, el modelo queda cargado) en una dirección
de bucle local aleatoria, con progreso leído de la salida estándar,
cancelación, tiempo límite, detección de cuelgue, caída, rechazo de
tamaño distinto, liberación por inactividad y al cerrar, y limpieza del
que dejara un arranque anterior; la API `/api/ai/runtime`,
`/api/ai/runtimes/<clave>/…` y `/api/ai/run`. Interfaz: `src/io/ai-runtime.ts`
y la fila *Motor de ejecución* de *Ajustes* con *Ejecutar con*
(`ai.backend`). Pruebas con `rt-fake-sd`, un binario de prueba que habla
el mismo protocolo, y con el `curl` real contra un servidor local. **De
verdad**, aquí: los cuatro zips descomprimidos por nuestro lector salen
idénticos fichero a fichero a los de `zipfile` de Python; la compilación
real de Linux CPU se instala por el lanzador y responde `--version`
(*stable-diffusion.cpp version unknown, commit d637cfb*), `--list-devices`
y `--help`, y la fila lo muestra; la descarga real desde GitHub con pausa a
4,7 MB y reanudación tarda 4,3 s; y un *img2img* real con `SD15_LIGHT` en
CPU (512², 8 pasos × fuerza 0,5 = 5 pasos de muestreo, pesos fijados
comprobados por `sha256` y borrados después) dio una imagen correcta en
**1307 s** de punta a punta (la máquina compartida con otros agentes, con
carga media de 10 a 15 en 4 vCPU: 1 s en arrancar el servidor, 3,5 min
leyendo pesos en el primer uso, 6 min hasta el primer paso (codificar la
imagen), de 2,5 a 3 min por paso y 3,5 min en decodificar; no es una
medida de rendimiento, que es de X1 parte B).

**No encajó con el plan.** (1) La descarga no puede hacerla la página
como la de los modelos: las descargas de *releases* de GitHub no mandan
cabeceras CORS. La hace el lanzador con el `curl` del sistema (en Windows
desde 10 1803), con el mismo progreso, pausa, reanudación y `sha256`; sin
`curl`, *Instalar desde un archivo…*. (2) No hay compilación «AVX2»
oficial: la de CPU lleva todas las variantes x86-64 de ggml y elige en
tiempo de ejecución. (3) Las de Windows necesitan el entorno de Visual C++
2015–2022 (no lo traen): si falta, la fila dice qué DLL; el instalador
(P2) debería instalarlo. Las de Linux necesitan glibc 2.38 (Ubuntu 24.04
o posterior). (4) `sd-server` refleja cualquier `Origin` y numera sus
trabajos: por eso la dirección aleatoria `127.a.b.c`. (5) Carga los pesos
en el primer uso: el primer trabajo enseña *Cargando*. (6) Las de edición
(klein, Qwen-Edit) van como *img2img* más imagen de referencia
(`init+ref`): construcción nuestra, sin probar. (7) `ai.gpu` (qué GPU) no
se pasa: no hay correspondencia fiable con los índices de Vulkan; elige
stable-diffusion.cpp. (8) Los límites (carga 30 min, imagen 60 min,
silencio 10 min, inactividad 5 min) son de partida, para X1. (9) El
catálogo de compilaciones es siempre el incluido; las pruebas ponen el
suyo con `server::Options` al construir el servidor, campo que la
aplicación no rellena nunca. (10) *Acerca de* no lista aún
stable-diffusion.cpp y ggml: sus textos van en la carpeta del motor y en
`docs/ai-licences.md`.

**Corrección tras fusionar (CI en *release*).** La primera versión leía
`<datos>/ai/runtimes-override.json` solo en depuración, y las pruebas
entraban por ahí. El trabajo del motor en CI también corre
`cargo test --workspace --release`, y allí 9 de las 11 pruebas de
`tests/ai.rs` fallaban: las pruebas eran más permisivas que el binario
de verdad. Ahora el catálogo y el descargador de prueba entran por
`server::Options { ai_runtimes }` (`Server::start_with`). `Ai::new` ya no
lee nada de la carpeta de datos en ninguna compilación, y lo comprueba
`a_catalogue_in_the_data_folder_is_never_read`, que falla si vuelve la
lectura. Había un segundo supuesto de depuración: la prueba de pausa y
reanudación esperaba más de 1 MB descargado, y en *release* el falso
ocupa menos de 600 kB. El archivo lleva ahora 8 MiB de relleno y la
pausa se pide a 1/8 del total. Se pasan las dos: `cargo test --workspace`
y `cargo test --workspace --release`.

**Segunda corrección (CI, el servidor huérfano).** En el ejecutor de
GitHub, `a_server_left_by_a_previous_launch_is_stopped_at_start` fallaba
una de cada dos veces con «the orphan still runs». La causa estaba en la
prueba. Arrancaba el servidor falso un instante antes de la limpieza.
`posix_spawn` es un *vfork*, y Linux deja seguir al padre antes de que
termine el `execve` del hijo, cuando el hijo aún usa la memoria del
padre. En ese momento `/proc/<pid>/exe` todavía nombra el ejecutable de
la prueba, así que la limpieza acertaba al no matarlo. Se reprodujo en
local reteniendo el `exec_update_lock` del hijo (`/proc/<pid>/syscall`):
el `exe` leído era el binario de la prueba. Ahora la prueba espera, por
condición y con un plazo de 60 s, a que el falso haya creado `args.log`
(eso lo hace su propio código), y lo mata al terminar aunque falle. Con
el bloqueo retenido pasa 20 de 20 veces; la forma anterior fallaba 2 de
20. Al revisar cómo se reconoce el proceso apareció un huérfano real:
la limpieza comparaba la ruta tal cual estaba escrita, y si la carpeta de
datos está detrás de un enlace simbólico, el núcleo da la ruta con el
enlace resuelto. Un servidor dejado ahí no se paraba nunca. Ahora se
compara el archivo (dispositivo e inodo, `proc::runs_server`), o la ruta
con los enlaces resueltos cuando el archivo ya no existe. Lo comprueban
`a_server_left_in_a_data_folder_behind_a_link_is_stopped_too` y la
prueba unitaria `a_server_is_recognised_through_a_link`; las dos fallan
con la comparación anterior.

### X3c · La tubería completa de escritorio — **Opus** — hecha

**Qué.** `AI-POST.md` §7.3: `/api/ai/post` en el lanzador (pases
guardados del render → `rt-post` → stable-diffusion.cpp por mosaico →
`rt-post` → reintentos), progreso y cancelación; el `AiPostService` de
escritorio en `src/io/`; integración en la cola (el trabajo guarda las
dos imágenes y el informe; el historial las conserva); `AI_AVAILABLE`
pasa a ser lo que diga `status()`. Además, lo que dejaron anotado X3a y X4: el suelo con `FLOOR_ID`
(`AI-POST.md` §7.4) en la guarda, el servicio sintético y los pases de
three.js; la tabla de materiales de la guarda en `AiPostRequest` y el
orden de materiales exportado por `io/rsb.ts`; el *prompt* real de
`src/ai/prompt.ts`; la fuente `RENDER` en la cola; las bibliotecas de
Visual C++ que necesita stable-diffusion.cpp en Windows (junto al
ejecutable o en el instalador); stable-diffusion.cpp y ggml en *Acerca de*.

**Depende de.** X2, X3a, X3b; X4 para verlo de punta a punta.

**Criterio.** De punta a punta con el proceso auxiliar falso: un render
final con IA deja dos imágenes y el informe en el historial; con
intervención 0, la imagen de la IA es la del motor bit a bit; cancelar a
mitad deja la del motor; un modelo que la compilación no carga sale con
el motivo. Lista corta de comprobación para el equipo del usuario (Vulkan,
una imagen de 1024², tiempo anotado).

**Hecho** (2026-10-13). **Lanzador** (`rt-app/src/ai/post.rs`, que enlaza ahora `rt-post`):
`POST /api/ai/post` con `{source: {kind: RENDER, renderId}, settings, prompt, negative, modelKey,
materials}` o, para la vista previa, el cuerpo binario `RPI1` (JSON, imagen `RPL1`, pases `RPP1`,
≤ 512 px); `GET /api/ai/post/<id>?after=n` (estado, `stage`, mosaico y intento desde 1, fracción
que no retrocede, `calls`, el `GuardReport` al terminar), `GET …/image` (`RPL1`, lineal con alfa
recto) y `DELETE`; `aiPost: 1` en `/api/info`. El conductor nativo es la máquina de pasos de X3a
(`plan` → `tile_input` y `control_planes` por mosaico → el `sd-server` de X3b, cargado entre
llamadas → `accept` → reintentos a `RETRY_FACTOR` hasta `MAX_ATTEMPTS`); con Intervención 0 el plan
no tiene mosaicos, no se prepara ni se arranca el motor de ejecución (funciona sin él instalado) y
la imagen es la del motor bit a bit; un mosaico de otro tamaño llega a la guarda como tal (la
comprobación `size`) y rechaza a la primera; un post por el que nadie pregunta en 2 min se para.
El almacén de X2 guarda con cada render su exposición y su curva (`Look`, también en disco), y la
imagen lineal es la conversión de la página (`linear_of`: las sumas por `fround(1/n)`, el color entre
la cobertura donde no es opaca, el umbral `1 − 1e-6` en `f64` como el número de JavaScript; un
umbral `f32` habría llamado opaco al `f32` justo por debajo, y la prueba lo vigila). El falso
`rt-fake-sd` gana un modo `gain` (aclara con suavidad, como un modelo que obedece) y `acceptMs` (un motor que tarda en tomar el trabajo, para ver el estado de inicio de cada mosaico). **Visual C++**:
`proc::missing_dll`, `Probe.dllMissing` y `needs_vc_runtime` (Windows, una DLL que falta y alguna del
entorno de Visual C++ ausente de la carpeta del motor y de `System32`) → `vcRuntime: "missing"` y
`vcRuntimeUrl` en la fila; la interfaz enseña *Instalar el entorno de Microsoft Visual C++…* (la página
oficial de Microsoft con `openExternal`: no redistribuimos sus DLL) y *Comprobar de nuevo*.
*Acerca de* lista stable-diffusion.cpp y ggml con sus textos MIT, copiados byte a byte de los *commits*
fijados (`tools/third-party/`, `tools/licences.mjs`). **Página**: `src/io/ai-post.ts`
(`DesktopAiService`: `status()` es `/api/ai/runtime` con los ajustes de la persona y el modelo activo,
`aiRuntimeQuery` de `src/ui/ai-query.ts`; `post()` manda, sigue, lee la imagen y olvida; un aborto manda `DELETE`); `main.ts` lo
usa cuando el lanzador dice `aiPost`, la web sigue con `notBuiltService` y `?ai=synthetic` con el
sintético; **`AI_AVAILABLE` ya no existe**. La cola pide al render que deje los pases de la guarda en el
lanzador (`aiPasses`, `passesInLauncher`: ni siquiera vuelven a la página; sin albedo, que la guarda no
usa y cuesta un rayo por muestra), manda la fuente `RENDER` con la tabla de materiales
(`guardMaterials` sobre `ProjectScene.materialOrder`) y el *prompt* de `src/ai/prompt.ts`, enseña el
progreso por mosaico en la fila (*IA · mosaico 2 de 4 · intento 2*, `RenderProgress.ai`) y escribe la
imagen de la IA desde la luz lineal con la exposición y la curva del render (`straightBytes`,
`straightWords16`, `straightExr`: PNG de 8 y 16 bits bit a bit con el del motor, EXR en cada píxel opaco);
detener o pausar durante la IA conserva la imagen del motor en el historial y, con *Pausar*, el trabajo
vuelve a esperar como en P3a. **El suelo, `FLOOR_ID`**: en la guarda era casi una región, pero
`FLOOR_ID` es `u32::MAX`, el mismo valor con el que empezaba la caché de regiones, así que un suelo visto
antes que cualquier pieza se quedaba como fondo; ahora es una región de verdad, que se reilumina y tiene
su comprobación de color (*Floor*, sin desgaste); la profundidad del control se normaliza sobre las piezas
y el suelo se dibuja a esa escala, recortado (su plano llega al horizonte); el servicio sintético lo nombra;
los pases de three.js lo encuentran con los rayos centrales del motor (`floorHits`, perspectiva y
ortográfica, también desde debajo del suelo) y coinciden con los del motor en cada píxel del suelo,
horizonte incluido. **De verdad aquí**: el lanzador real con todo el código de la página (motor nativo,
cola, servicio de escritorio) contra el falso instalado donde iría la compilación fijada de Linux
(`tests/ai-desktop.test.ts`); y una vez la tubería entera con stable-diffusion.cpp real y SD 1.5 con su
ControlNet de profundidad en CPU (`real_post_with_sd15_and_its_depth_controlnet_on_the_cpu`, ignorada sin los pesos): el ejemplo de 256 × 192 con el suelo, Intervención 100 y 10 pasos (5 de muestreo a fuerza 0,4), **53 s** en 4 núcleos (13 s de carga de pesos, ~6,5 s por paso), aceptada al primer intento: detalle 0,998, bordes 0,02, ΔE₉₅ 1,9 en el coral y 1,6 en el azul; el suelo llegó a 2,2 y la guarda dejó su cambio de color al 71 %. Los pesos se borraron después. **Con el falso**: todo lo demás. Pruebas: 13 nuevas en
Rust (3 de `rt-post`, 3 unitarias de `rt-app` y 9 de `tests/ai_post.rs`, una más ignorada con los pesos
reales) y 29 de vitest (14 del servicio y de lo que se le pregunta, 4 contra el lanzador real, 4 de la cola, 3 de los pases, 1 del
sintético, 3 de la fila del motor y *Acerca de*), más las de X2 y X4 que cambian con el suelo; 26
mutaciones comprobadas, cada prueba falla si se rompe lo que guarda.

**No encajó con el plan.** (1) **El control**: §3.2 pide bordes y profundidad al ControlNet, y *tile*
para salidas grandes; `sd-server` lleva un solo ControlNet cargado y solo SD 1.5 tiene alguno en los
perfiles (*tile* y *depth*), así que se manda la profundidad de los pases (la primera de `depth`, `tile`
que tenga la familia) en vista previa y en final por igual, para no reiniciar el servidor entre una y
otra; los bordes no tienen ControlNet en los perfiles. Decisión provisional para X1b. (2) **La profundidad
con suelo**: §7.2 dice «normalizada sobre toda la imagen»; con el suelo como superficie, su plano hasta
el horizonte dejaba el producto en unos pocos niveles, así que la escala es la de las piezas y el suelo se
recorta a ella (sin piezas, el suelo marca la escala). Pendiente de Fable en X1b. (3) **EXR en el
visor**: el historial guarda la imagen de la IA de un trabajo EXR tal cual (EXR) y los navegadores no la
muestran: la miniatura sale de una copia de 8 bits, pero el visor no compara *Render | IA* en EXR (haría
falta una segunda imagen de vista en el historial, como el `display` del motor; queda anotado). (4)
**Pausar durante la IA**: el trabajo vuelve a esperar (P3a: un render no se reanuda a medias) y la imagen
del motor ya está en el historial, así que *Reanudar* deja un segundo resultado del mismo trabajo. (5)
**`AiPostRequest`** gana `materials?` (añadido); el resto del contrato añadido va fuera de `core/ai.ts`:
`FrameRequest.aiPasses`, `FrameResult.renderId` y `tone`, `AiEncodeOptions.tone`, `AiPort.materials` y
`renderSource`, `AiPort.scenePrompt(state, settings?)`, `RenderProgress.ai`, `PassIds.floor`,
`RenderOptions.passesInLauncher`, `AI_GUARD_PASSES` (`core/ai-post.ts`). (6) La fracción de la IA ocupa la
barra del trabajo en su lugar (el render ya terminó): la fila dice qué mide. (7) Las Visual C++ no van
junto al ejecutable ni en el instalador: no se redistribuyen; el botón lleva a Microsoft. (8) *Ajustes ▸
Post-procesado IA* ya no dice *llega en una próxima versión* donde el servicio no dice `NOT_BUILT`.
(9) Apagar el interruptor libera el modelo (`DELETE /api/ai/sidecar`, que no hace nada si un trabajo lo
usa). (10) La tolerancia `detailSsim` (y las demás) se puede pasar en la petición (`tolerances`) para
calibrar en X1b; las pruebas lo usan para forzar reintentos. (11) Con el motor real, la primera
llamada dice *inferencia* medio segundo antes de que `sd-server` pinte su barra de carga (el trabajo ya
está `generating` y aún no hay barra); la fracción no retrocede y luego dice *cargando*: cosmético,
anotado para X3b. (12) **El modelo activo en la ventana de render**: sin un modelo elegido a mano, el activo
es la recomendación para el equipo, y la detección del equipo solo la lanzaba *Ajustes*; con el servicio de
escritorio, el interruptor decía *No hay ningún modelo descargado* y llevaba a *Ajustes* aunque el modelo
estuviera instalado (lo enseñaron las capturas contra el lanzador real). Ahora el escritorio con `aiPost`
detecta el equipo al arrancar, la sección también la lanza, y la sección vuelve a preguntar cuando cambia lo
que pregunta (`aiStatusKey`: el dispositivo, el *backend*, el modelo activo, los modelos instalados), con su
prueba. (13) **La cabecera del visor de resultados** apretaba el informe de la guarda en una columna estrecha
junto al título, una o dos palabras por línea (la barra de botones no cedía sitio): ahora el informe tiene su
línea propia a todo lo ancho (una sola, con puntos suspensivos y el texto entero en el aviso), la barra pasa bajo
el título cuando no caben juntos y *Cerrar* se queda en la esquina. `tools/ai-post-check.mjs` (j) lo mide a
1600, 1280 y 960 px en inglés y en español (solapes, salidas de la cabecera, una línea, a todo lo ancho, el
título entero) y falla con la cabecera de antes; capturas `docs/ui/ai-results-viewer.png` y
`ai-results-light.png` rehechas.

### X3d · La web — **Opus**

**Qué.** `AI-POST.md` §2.3: ONNX Runtime Web (MIT) con WebGPU en
workers por etapa, **exportar el codificador del VAE a ONNX** desde el
`ae.safetensors` Apache-2.0 para que exista `ZIMAGE_WEB` (con sus
`sha256`), caché en OPFS con `persist()`, fragmentos de ≤ 1 GiB, el
conductor de la máquina de pasos en un worker con `post.wasm`.
Dependencia nueva anotada en `ARCHITECTURE.md` §1.

**Depende de.** X3c.

**Criterio.** El mismo de X3c con el servicio web; sin WebGPU, el
interruptor queda deshabilitado con el motivo.

## X4 · Interfaz del post-procesado — **Sonnet** — hecha

**Qué.** `AI-POST.md` §4 y §7.5: interruptor, configurador de seis
controles, fichas de protecciones, *Otra variación*, vista previa en modo
Rápido con divisor (los pases de §7.4 dibujados con three.js al tamaño de
la vista previa), actualización al soltar con el tiempo medido, opción
de vista previa con el motor completo, informe de la guarda en el visor
de resultados con el divisor de U5, y las dos miniaturas en la cola; los
ajustes en el *store* (§7.5). Todo contra `AiPostService`
(`src/core/ai.ts`) con un **servicio sintético** (determinista, sin
modelo) hasta que X3c conecte el real; mientras, el interruptor dice
*próximamente* fuera de los tests.

**Depende de.** U5, U6; el contrato de `src/core/ai.ts`.

**Criterio.** Cada control a 0 no cambia su aspecto (test con el servicio
sintético); la vista previa no se recalcula durante un arrastre; los
pases de three.js coinciden con los del motor en ids y profundidad en una
escena de prueba; capturas de la sección y del visor con el divisor.

**Hecho.** *Store* (§7.5): `RenderSettings.ai` es `{ enabled, previewFullEngine }
& AiPipelineSettings` con `DEFAULT_AI`; `normaliseAi` deja los controles en
enteros 0..100, un estilo desconocido en `NATURAL` y la semilla en u32, y
devuelve el mismo objeto cuando nada cambia; un proyecto antiguo (`{ enabled }`)
se abre con los valores por defecto; cada control es una acción de `render/set`
deshacible (arrastrar un control, un paso), *Otra variación* cambia la semilla
(`nextSeed`, congruencial sin repetición), los trabajos copian los ajustes y
la intervención por defecto de Ajustes llega a los proyectos nuevos. **Ventana
de render** (`ui/panels/ai-post.ts`): interruptor con la línea del modelo en
uso (datos del gestor de Ajustes), motivo de `AiUnavailableReason` cuando no
puede, y abrir Ajustes cuando falta modelo o motor; los seis controles con su
frase, las seis fichas con candado sin interruptor y *Otra variación*; vista
previa del modo Rápido a 384–512 px con el divisor de U5, **al soltar** (el
cerebro está en `ui/ai-preview.ts`, sin DOM: `hold`/`touch`/`release`, el
fotograma se reutiliza mientras solo cambian los controles, una vista previa
vieja se abandona), tiempo **medido** alrededor de la llamada a la tubería,
la nota del modo Rápido y la opción del motor completo. **Pases con three.js**
(`render/preview-passes.ts`, `PreviewEngine.aiFrame`): albedo, normal en el
mundo con Z arriba, profundidad a lo largo del eje, ids de pieza y de material
(índice RSB + 1, que `projectScene` entrega ahora en `ids`) empaquetados en
bytes en un blanco de 8 bits sin filtro ni *multisample*, y el círculo de
confusión de la lente fina (`core/lens-coc.ts`). **Servicio sintético**
(`ai/synthetic.ts`): una ganancia suave sobre la imagen del motor (la luz sube
las sombras, los rebotes calientan las bajas frecuencias, el estilo tiñe, el
desgaste no añade nada, la semilla solo ondula), todo a 0 devuelve la entrada
bit a bit, informe de la guarda **medido** (tamaño, píxeles fuera, desplazamiento
de bordes, SSIM de la banda alta, nitidez por mosaico, ΔE₀₀ por material con
CIEDE2000) y la regla de reintentos de §7.2 (`LIMITED`, `REJECTED`). Solo corre
con `?ai=synthetic`; sin él el interruptor dice *próximamente*. **Visor y
cola**: el trabajo guarda la imagen del motor y, al lado, la de la IA
(`…_AI.png`); el resultado conserva las dos y el informe (`ResultMeta.ai`,
solo campos añadidos); el visor abre *Render | IA* con el divisor, la línea
*Comprobado: …*, *La IA se limitó al N %* o la frase del rechazo, y guarda
cada imagen por separado; la cola y el historial enseñan las dos miniaturas.
**Almacenamiento de la segunda imagen**: un cuarto parámetro opcional `ai` de
`ResultsStore.add` y `ai?` en lo que devuelve `get`; IndexedDB la guarda en el
mismo registro de blobs y el escritorio, por el asiento de P3e, como
`<datos>/results/<id>.ai.<ext>` con `PUT`/`GET /api/store/results/<id>/ai`
(cambio pequeño en `rt-app/src/appdata.rs`, su prueba y el README del
*crate*); ningún acceso nuevo al almacenamiento del navegador en el
escritorio. Tests: 1.390 de vitest (98 de X4, 6 de ellos en un Chromium con SwiftShader
que se salta donde no hay navegador: tres.js contra el rayo de la CPU con las
reglas del motor) y una prueba nueva del lanzador (`rt-app`, 9 de `appdata`);
8 mutaciones comprobadas; 25 comprobaciones del navegador en
`tools/ai-post-check.mjs` (y siguen verdes las de U5 y U6).
Capturas: `docs/ui/ai-section-dark.png`, `ai-section-light.png`,
`ai-results-viewer.png`, `ai-results-light.png` y `ai-queue.png`.

**No encajó con el plan.** (1) `AI_AVAILABLE` ya no lo lee el *store*:
`patchSettings` dejaba `enabled` en falso mientras la constante lo fuera, y
con un servicio que dice `available` eso no se sostiene; el interruptor y la
cola miran `AiPostService.status()` (el test de U5 *«video and AI stay off»*
cambió a *«video stays off…»*). (2) Hasta X3c la entrada de la IA en la cola
es **INLINE**: se decodifica la imagen de 8 bits que ya se ha guardado
(`display ?? file`) y los pases se dibujan con three.js al tamaño del
trabajo, en lugar de la fuente `RENDER` que guardará el lanzador con la
imagen lineal; por eso la imagen de la IA sale con la calidad de 8 bits, aun
en un trabajo EXR o PNG de 16 bits. La vista previa trata la imagen del modo
Rápido (con su curva de tono) como luz lineal decodificada con sRGB; qué curva
ve el modelo real lo decide X3c. (3) El `coc` sigue `Camera::generate_ray`
(sensor a la distancia focal, apertura `focal/fstop`, plano de enfoque a
`focusDist`): la huella de un píxel en el plano de enfoque es
`sensor/ladoLargo × focusDist/focal`; la lente fina exacta cambia `focusDist`
por `focusDist − focal`. **X2 debe emitir la misma fórmula.** (4) Los pases de
three.js son una aproximación del contrato: el albedo es el color base del
primer impacto (no sigue los rebotes especulares), el suelo y los paneles de
luz no cuentan (fondo 0 / +∞), las dos caras de un triángulo cuentan y la
normal se da orientada hacia quien mira; X2 tiene que decidir lo mismo o se
anota la diferencia. (5) *ΔE máx* es el mayor ΔE₀₀ **medio** de un material, y
*geometría ✓* reúne bordes, píxeles fuera y detalle de banda alta; si la guarda
real reparte las comprobaciones de otro modo, cambia `reportItems`. (6) El
servicio sintético usa como límites los valores de fábrica de Ajustes ▸
Avanzado, no los de X1. (7) Las animaciones no pasan por la IA (el interruptor
queda deshabilitado en *Animación*, con *próximamente*); la imagen de la IA se
guarda sola junto a la del motor, con el sufijo `_AI`, para que un lote la
tenga sin abrir cada resultado. (8) `numberField` y `slider` ganan `onHold` y
`onRelease`, y el deslizador **sigue ahora al valor al deshacer** aunque tenga
el foco (antes la perilla se quedaba donde estaba mientras el campo cambiaba:
lo encontró la comprobación del navegador, que ahora lo vigila). (9) El
*prompt* es un hueco (`AiPort.scenePrompt`: vacío y el negativo fijo de §3.2)
hasta que X3a traiga `src/ai/prompt.ts`; `rw.aiWhy.NO_WEBGPU` entra en
`WEB_ONLY_STRINGS` (nombra el navegador y solo puede darse en la web).

**Espera a X3c.** Conectar el servicio real (hoy `main.ts` elige entre el
sintético y `notBuiltService`), cambiar la entrada de la cola a la fuente
`RENDER` con los pases que guarda el lanzador, el progreso por mosaico en el
trabajo (hoy se ignora `onProgress` en la cola), el *prompt* de X3a, quitar
`AI_AVAILABLE`, y que las dos imágenes del historial salgan de la imagen
lineal del motor. Y X2: los mismos ids, la misma profundidad y el mismo `coc`
que dibuja la vista previa (el test del navegador es la vara de medir).

## X4b · Prompt propio y variantes — **Opus** — hecha

**Petición del usuario (2026-10-13):** «si lo soporta el modelo, que deje
un prompt de texto en la configuración del render en cuestión, y que se
puedan hacer unas cuantas variantes; por defecto, una sola».

**Decisiones del líder.**
- **Prompt propio** en la sección *Post-procesado IA* de la ventana de
  render (es del trabajo: se guarda en el proyecto, se deshace y cada
  trabajo de la cola lleva el suyo): un campo de varias líneas, vacío por
  defecto, de hasta 400 caracteres, con la nota *Describe la luz o el
  ambiente; la geometría, los materiales y el enfoque siguen protegidos*.
  Se **añade** al *prompt* que se genera de la escena (`src/ai/prompt.ts`),
  nunca lo sustituye, y el negativo fijo sigue. Solo aparece si el modelo
  activo lo admite: una capacidad nueva `textPrompt` en
  `src/data/ai-models.json` (se añade, no se renombra nada; los modelos de
  origen la tienen; un importado la declara en su `model.repackshot.json`);
  si no, el campo se ve deshabilitado con el motivo.
- **Variantes**: un número de 1 a 8, **1 por defecto**, junto a *Otra
  variación*. Un trabajo con N variantes hace **un solo render del motor**
  y N pasadas de IA con semillas consecutivas (semilla, semilla + 1…),
  con el modelo cargado una vez; la cola dice *IA · variante 2 de 4 ·
  mosaico 3 de 4*; cada variante lleva su informe de la guarda. La vista
  previa sigue siendo de una sola variante. Se avisa del tiempo estimado
  (N × lo medido) cuando hay medida.
- **Resultados**: un resultado guarda el render y sus N imágenes de IA
  (en escritorio, `<id>.ai.<n>.<ext>` en la carpeta de resultados; el
  `ai` de antes se lee como la variante 1); el visor muestra una tira de
  miniaturas para elegir variante, el divisor compara la elegida con el
  render y se puede *Guardar esta variante* o *Guardar todas*; el
  historial y la cola muestran cuántas hay. Nombres de archivo con el
  sufijo `_AI`, `_AI_2`, `_AI_3`…

- **Prompt del sistema** (petición del usuario, 2026-10-13): en *Ajustes ▸
  Post-procesado IA* un apartado *Prompt del sistema*, general para todas
  las imágenes (es un ajuste de la aplicación, no del proyecto), con un
  campo de varias líneas, *Restablecer el predeterminado* y la nota de que
  las protecciones de la guarda no dependen de él. Orden al componer:
  **sistema → escena → propio del trabajo**; el negativo fijo, aparte. El
  predeterminado lo fija el líder, en inglés (los codificadores de texto
  de los modelos rinden mejor en inglés):

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

  Para modelos con límite de longitud del *prompt* (SD 1.5: 77 *tokens*
  de CLIP; una capacidad `maxPromptTokens` en `ai-models.json`), se usa
  la versión corta, también del líder, y el resto se recorta en este
  orden (lo propio del trabajo primero, luego la escena, luego el
  sistema), avisando de lo recortado:

  > photorealistic product photo, same composition, geometry, materials
  > and labels, same lighting and depth of field, natural soft shadows,
  > subtle bounce light, realistic highlights, fine micro-detail,
  > true-to-life colours, nothing added

**Criterio.** Tests: el prompt propio llega al modelo tras el de la escena
y el negativo fijo intacto; sin capacidad `textPrompt`, no se envía y el
campo lo dice; N variantes = un render del motor y N llamadas con
semillas consecutivas, y cancelar a mitad deja el render y las variantes
terminadas; guardar y abrir (proyecto y resultados, también los de una
sola `ai` de antes); deshacer del prompt (un cambio de texto es una
entrada al salir del campo) y del número; cadenas en `es` y `en`; cromo
acromático; capturas de la sección y del visor con varias variantes.

**Hecho** (2026-10-13). **Prompt propio**: `AiPipelineSettings.userPrompt` (recortado, hasta
`MAX_USER_PROMPT` = 400 caracteres) en la sección de la ventana de render, bajo los seis controles: un
campo de varias líneas (`textArea` de `ui/components/controls.ts`) con contador y la nota del líder; se
guarda al dejar de escribir (700 ms) y al salir del campo, y todo lo de una visita lleva el mismo gesto,
así que es **una** entrada de deshacer (*Post-procesado IA: Prompt propio*); mientras tiene el foco, lo que
vuelve del *store* no pisa lo que se escribe (el recorte de un espacio final no se lo come). Va en el
proyecto y cada trabajo lleva el suyo; un proyecto anterior abre sin él. Se compone **sistema → escena →
propio** (`composePrompt`, `src/core/ai-prompt.ts`; `buildPrompt(state, settings, context?)` en
`src/ai/prompt.ts`, que sin contexto sigue dando solo el de la escena) y el negativo fijo va aparte, igual.
**Capacidades**: `capabilities: { textPrompt, maxPromptTokens? }` en cada modelo de `ai-models.json` (todos
con `textPrompt`; `SD15_LIGHT` con 77) y en el manifiesto de un importado (el formulario de importar lo
pregunta); `ModelView.textPrompt`/`maxPromptTokens`; manda el modelo que el servicio dice activo
(`promptCaps`; el sintético lo admite todo, uno desconocido nada). Sin `textPrompt` el campo se ve
deshabilitado con el motivo y no se envía. **Prompt del sistema** (`ai.systemPrompt`, *Ajustes ▸
Post-procesado IA ▸ Prompt del sistema*): el texto del líder por defecto, campo de varias líneas,
contador, *Restablecer el predeterminado* y la nota de que la guarda no depende de él; puede quedarse
vacío; en escritorio va en `settings.json` como todo ajuste (prueba con el espía de P3e). Con
`maxPromptTokens` se usa la **versión corta** mientras el texto sea el predeterminado (los mismos
espacios o no) y se recorta palabra a palabra desde el final, **el propio, luego la escena, luego el
sistema**, con una estimación prudente documentada en `AI-POST.md` §4; la línea bajo el campo de la
ventana dice qué se queda fuera, y la de Ajustes qué recibe el modelo en uso. **Variantes**:
`AiPipelineSettings.variants` (1–8, 1 por defecto) junto a *Otra variación*, deshacible, con la línea
de las semillas y el tiempo estimado; cambiarlo no rehace la vista previa (sigue siendo una imagen). En la
cola, `aiStep` hace **un render** y N peticiones del mismo origen (el `renderId` guardado, o la imagen
decodificada una sola vez) con `variantSettings` (semilla + n − 1), cada imagen con su informe y
`aiFileName(nombre, n)` (`_AI`, `_AI_2`…); la fila dice *IA · variante 2 de 4 · mosaico 3 de 4* y la barra
mide las variantes juntas; detener a mitad conserva el render y las terminadas; una rechazada queda con
su informe y sin imagen; si una falla, se quedan las anteriores. **Resultados**: `ResultMeta.aiMore` (la
primera sigue en `ai`), `aiVariantsOf`/`aiImagesOf`, `ResultsStore.add(…, ai, aiMore)` en memoria, en el
registro de IndexedDB y en el lanzador como `<id>.ai.<n>.<ext>` con `PUT/GET /api/store/results/<id>/ai/<n>`
(`appdata.rs`, aditivo: `aiVariants` en el índice; el `<id>.ai.<ext>` de antes se lee como la variante 1 y
`…/ai` sigue); la migración desde el navegador las copia. El visor tiene la **tira de miniaturas** (una
línea propia entre la cabecera y la imagen), el divisor compara la elegida sin perder el zum
(`SplitCompare.setB`), su informe en la línea, *Guardar esta variante* y *Guardar todas*; la cola y el
historial ponen *×4* y la cola *IA × 4*; el pie de la ventana, *IA activada · 4 variantes*. Pruebas: 39
nuevas de vitest (22 del *prompt*, las capacidades, el sistema y el *store*; 15 de variantes contra el
sintético, un servicio como el del lanzador y el `DesktopAiService` contra un lanzador de pega; 1 de
persistencia del ajuste en escritorio; 1 de punta a punta con el lanzador real y el `rt-fake-sd`: tres
variantes, un render, semillas 20, 21 y 22 en el registro del motor falso, que no vuelve a arrancar), más
las que cambiaron (el doble del lanzador aprende `…/ai/<n>` tan estricto como el de verdad); 1 de Rust
(`appdata`); 10 comprobaciones nuevas del navegador en `tools/ai-post-check.mjs` (k, l y la tira en j;
36 en total, todas en verde);
18 mutaciones comprobadas. Capturas: `docs/ui/ai-section-prompt.png`, `ai-results-variants.png` y
`settings-ai-prompt.png`.

**No encajó con el plan.** (1) `userPrompt` y `variants` son **opcionales** en el contrato
(`AiPipelineSettings`, para no romper a quien construye uno sin ellos) y obligatorios en el *store*
(`AiSettings` es `Required<…>`); el lanzador no los lee: cada petición es una imagen con su semilla y el
*prompt* ya compuesto. (2) La composición y la cuenta viven en `src/core/ai-prompt.ts` (puras, para que
Ajustes las use sin el puerto de la IA) y `src/ai/prompt.ts` las llama. (3) En escritorio la variante 1
nueva se escribe `<id>.ai.1.<ext>`, como pide el plan; `<id>.ai.<ext>` queda para leer los de antes. (4) La
estimación de *tokens* es prudente de verdad: la versión corta cuenta 65 de los 77 (con CLIP real, unos
45), así que con SD 1.5 el *prompt* propio casi nunca entra; afinarla (o traer el vocabulario de CLIP,
1,6 MB) queda para X1b. (5) El prompt del sistema y el de la escena se mandan también a un modelo sin
`textPrompt` (como antes el de la escena); solo se retiene el propio del trabajo. Un importado `sd15` o
`sdxl` sin `maxPromptTokens` lee 77. Z-Image, FLUX.2 klein y Qwen no llevan límite: sus codificadores
leen cientos de *tokens* y lo compuesto más largo cabe; X1b lo confirma. (6) **El tiempo estimado** es N ×
los píxeles del trabajo / la velocidad de la IA medida alrededor de cada petición del último trabajo con IA
de este equipo (`UiState.aiThroughput`), no N × la medida de la vista previa (a 512 px no dice nada de los
mosaicos de un final); sin medida, la línea dice que se mide con el primero; incluye la carga del modelo
si la hubo, así que tira por arriba. (7) Al comparar con otro resultado (*Comparar con…*) la tira solo
cambia la línea del informe: el divisor compara los dos resultados. (8) `src/main.ts` no pasaba la lista
de variantes al historial (`results.add` con cuatro argumentos): lo encontró la lectura antes que una
prueba; lo vigila la comprobación del navegador (k), que es la que pasa por `main.ts`.

## X5 · Ajustes y modelos — absorbida en U6

El gestor de modelos, el selector y la detección del equipo llegan en
**U6**, porque no necesitan la tubería. Lo que sí la necesita (comprobar
en vivo que el modelo activo cabe y una prueba de una imagen desde
*Ajustes*) pasa a X4.

## K1 · Tipo de escena, luz de interior y Doctor de interiores — **Sonnet** — hecha

**Qué.** `scene.type ∈ {PRODUCT, INTERIOR, CATALOGUE}` en el *store* y en
la sección *Producto* del inspector, con la tabla de valores por defecto
de `INTERIORS.md` §3.1 aplicada al cambiarlo (solo defaults: ningún
control desaparece); nuevo estilo **Interior** en `LIGHT_STYLES` y
`LIGHT_SETUPS` (*Ventana de mañana*, *de mediodía*, *de tarde*,
*Nublado*, *Lámparas de noche*, *Hora azul*, *Sala blanca de estudio*),
cada receta con `world` y exposición, sin tocar las 72 existentes; los
chequeos de escena del Doctor de interiores de `INTERIORS.md` §3.6 que
no dependen del motor (escala y unidades, abertura ausente con sol o
cielo, vidrio grueso, óptica < 18 mm, altura de ojo, recorte cercano,
normales invertidas) con su arreglo.

**Depende de.** U1, L4.

**Criterio.** Cambiar de tipo y volver deja el estado idéntico salvo lo
que el usuario tocó (test); los montajes nuevos pasan los tests de
recuento y normalización; cada chequeo nuevo detecta su caso y su arreglo
lo limpia; captura con el tipo *Interior* activo.

**Hecho.**

*Tipo de escena.* `ProjectState.scene.type` (`PRODUCT` · `INTERIOR` · `CATALOGUE`, `Producto` por defecto) y la
acción `scene/setType`, una sola entrada de deshacer. Los valores son datos (`src/data/scene-types.ts`, `SCENE_TYPES`:
clave estable, etiqueta e intención en los dos idiomas, y los valores por defecto de cada tipo) y lo que los aplica es
`src/core/scene-type.ts`. En la sección *Producto* del inspector, encima de *Tipo de producto*, un control segmentado
*Producto · Interior · Catálogo* con la intención de cada tipo en su ayuda y una nota que dice que ningún control se mueve;
la sección *Luz* salta al estilo *Interior* al elegirlo (estado de interfaz, no del proyecto) y vuelve a *Todos* al
dejarlo. **Cambiar de tipo y volver deja el proyecto como estaba salvo lo que se tocó entre medias**: cada valor que un
tipo escribe es una *casilla* (10 fijas y una por cámara, `camera.focal:<id>`) con lo que había (`base`) y lo que el tipo
puso (`applied`), guardado en `scene.typeBase`. Al cambiar, una casilla cuyo valor sigue siendo `applied` no la tocó nadie
y vuelve a `base` antes de que el tipo nuevo escriba la suya; una que ya no lo es la tocó la persona, y su valor es el `base`
nuevo. Un tipo que pone lo que ya había no recuerda nada, y volver a Producto no deja memoria (`scene.typeBase` desaparece).
Un HDRI cargado no lo sustituye ningún tipo (es el «o HDRI interior» de la tabla, y `worldFor` también lo deja ganar) y una
cámara bloqueada conserva su óptica. **Proyecto**: se guarda `scene.type` y, mientras no sea Producto, `scene.typeBase`; el
esquema sigue en 2; un proyecto anterior no tiene ninguno y abre como Producto, un tipo que esta versión no conoce abre como
Producto y de la memoria se conservan solo las casillas que esta versión conoce y con valores que esa casilla admite
(`normalizeSceneType`, `normalizeTypeBase`).

*La tabla de `INTERIORS.md` §3.1, tal como está aplicada* (lo que no escribe Producto es lo que el proyecto ya tiene; las
filas que nombran algo que no existe aún están en «Qué no encajó»):

| Fila | Producto | Interior | Catálogo |
| --- | --- | --- | --- |
| Entorno | no escribe | tipo de entorno *Cielo* (sol y cielo) | *Cúpula de estudio* y fondo de color blanco `[1, 1, 1, 1]` |
| Rebotes | no escribe (los del nivel de calidad) | 16 (`render.advanced.maxBounces`) | 8 |
| Cáusticas | no escribe (Automático) | Apagadas | Apagadas |
| Sombra de suelo | no escribe | sin sombra de contacto (`studio.shadow` apagado) | sombra de contacto encendida y suave (`environment.groundShadow` 0,35) |
| Transformada | no escribe | AgX | Estándar |
| Muestras objetivo | no escribe (256) | 512 (el nivel pasa a *Personalizado*), terminar por ruido y *denoise* en visor y render | 256 (el nivel *Vista previa*) |
| Cámara | no escribe | 28 mm en cada cámara que no esté bloqueada | 50 mm |

*Estilo Interior.* `LIGHT_STYLES` pasa de 9 a 10 entradas (`INTERIOR` la última) y `LIGHT_SETUPS` de 88 a 95: las siete
recetas están **al final**, así que ninguna clave ni ningún orden anterior se movió (los 72 montajes del catálogo base y los
16 sets, intactos: un test compara los 71 rigs con el fixture de antes de L6). Cada receta es un set sin decoración:
elige su mundo (`SKY` con un foco de sol que coloca el sol del cielo, o `STUDIO`), y trae su desvío de exposición
(`exposureEv`) y la intensidad del entorno (`envStrength`), porque la hora del día **es** el brillo de la imagen y aquí,
a diferencia del resto de montajes, elegir una sí cambia el aspecto. Los focos están normalizados al nivel del tipo de
producto como todos (un test con los 16 tipos: error < 10⁻⁶). Una receta que mezcla un sol con paneles lleva *shares* en
la escala de `specIrradiance` (un sol cuenta su irradiancia en W/m² y un panel sus vatios sobre 4π d²): el *share* de un
panel que da `r` veces lo que el sol es 4 d² r veces el del sol (por eso las ventanas llevan 5 a 14 frente al 1 del sol; el
cálculo está en el comentario de `light-setups.ts`). Las cifras de las siete recetas son una propuesta (◆ pendiente de Fable: la
tabla está en «Qué no encajó», 1). Mirando las miniaturas (`SPHERES`, 256 × 256, 96 muestras) la mañana tira a cálido, el mediodía es
neutro, la tarde es ámbar, *Nublado* y *Sala blanca* son suaves y claras, las lámparas dejan la sala a oscuras y la hora
azul parte cálido a la izquierda y azul a la derecha. **Miniaturas**: las siete se han renderizado con el motor nativo
(`node tools/setup-thumbs.mjs --keys INT_WINDOW_MORNING,…`: 21 s de render en total) y están en
`public/thumbs/setups/` (`thumb_int_*.png` y `setup_int_*.png`) y en `manifest.json`, que pasa a 95 entradas (el test que
reconstruye cada escena con el código y compara su hash lo comprueba); `tests/set-heroes.ts` pone `SPHERES` de objeto del
estilo.

*Dos arreglos en `core/sets.ts`, con su prueba cada uno.* Una receta es un set sin decoración, y eso destapó tres cosas que
un set con decoración no hacía notar: (1) `applySet` encendía el suelo y la sombra de contacto con cualquier set, también
con uno que no trae nada que apoyar (contra el *Interior* que no lleva sombra propia); ahora solo con decoración
(`hasDecoration`: fondo, suelo, charco o tarjetas, los 16 sets la tienen). (2) Una receta elegida tras un set con fondo
dejaba **el fondo del set** en el marco (lo vio la miniatura: el fondo claro del barrido detrás de las esferas); ahora el
fondo vuelve al del tipo de producto, como al elegir cualquier otro montaje. (3) Dejar una receta por otro montaje
restauraba el fondo del tipo de producto aunque la receta nunca lo tocó, pisando el fondo de la persona (el blanco de
*Catálogo*); ahora solo lo restaura quien dejó un fondo (`presetLook(…, background)`). Mutaciones: las tres se
reintroducen y `tests/interior-setups.test.ts` falla (la segunda también el test de las miniaturas, porque el hash de la
escena cambia).

*Doctor de interiores.* `core/doctor-interior.ts` (lógica) y `data/doctor-interior.ts` (descriptores en los dos idiomas,
`INTERIOR_DOCTOR_CHECKS`), enchufados al Doctor en pocas líneas: `runDoctor` añade `runInteriorDoctor(state)`, el `default`
de `fixDoctor` llama a `fixInterior`, `doctorCheck(key)` conoce los dos listados y la ventana del Doctor busca el
descriptor con `doctorCheck`. **Solo corren con el tipo *Interior***: en una escena de producto no están en los resultados
(y `DOCTOR_CHECKS`, el listado del Doctor, no se toca). Siete claves estables: `interiorScale`, `interiorOpening`,
`interiorGlass`, `interiorLens`, `interiorEye`, `interiorClip`, `interiorNormals`. Todos con arreglo, que es una acción
normal del *store* (una entrada de deshacer):

| Chequeo | Detección | Arreglo | Prueba | Mutaciones |
| --- | --- | --- | --- | --- |
| Escala y unidades | el tamaño mayor de la escena (la caja de las piezas que no son decoración) fuera de 100 mm–30 m | reescala por el factor del importador (metros, micrómetros) si cae en el rango; si no, por la potencia de diez más pequeña que lo logra; si ninguna, hasta el límite; el factor del importador se gasta | «escala y unidades» (5 pruebas: los límites, ×10, ×100, ×1000, ÷1000, lo más absurdo, el importador y el tamaño del tipo de producto) | 6 |
| Abertura para el sol y el cielo | la cámara activa dentro de la caja de la escena (de más de 1,5 m por cada lado), el cielo o un sol encendido la ilumina y ninguna pieza visible lleva un material de vidrio, con `transmission` ≥ 0,5 u `opacity` ≤ 0,5 | pone el montaje *Sala blanca de estudio* (paneles y lámparas en lugar de sol y cielo) | «una abertura para el sol y el cielo» (5) | 9 |
| Vidrio de ventana | una pieza visible, plana (grosor ≤ 12 % de su lado mayor, con dos lados grandes y el mayor ≥ 300 mm, medido en su caja propia por la escala de su matriz: una pieza girada o estirada de un cubo es igual de plana) con un material `GLASS` de paredes `SOLID` | pone `walls` a `THIN` (el mismo `material/setParam` de la interfaz); si el material lo comparte una pieza que no es un panel, un `material/detach` da a los paneles una copia y solo ella queda fina | «vidrio de ventana» (5) | 8 |
| Óptica | una cámara en perspectiva con menos de 18 mm | 24 mm y sin preset de óptica, en todas las que lo pasan | «una óptica más ancha de 18 mm» (3) | 7 |
| Altura de ojo | una cámara en perspectiva, no bloqueada, a menos de 0,3 m o más de 2,2 m sobre el suelo (z = 0) | 1,5 m: cambia la elevación mirando al mismo punto por el mismo lado a la misma distancia; si no llega a ese ángulo razonable (80°), retrocede y arrastra el enfoque | «altura de ojo» (5) | 8 |
| Recorte cercano | una cámara en perspectiva dentro de la caja de la escena cuyo `clipStart` llega a la cara más cercana de esa caja (la pared) | `clipStart` a la mitad de esa distancia (mínimo 0,01 mm) | «el recorte cercano contra la pared» (4) | 6 |
| Normales | una superficie cerrada (`solidOrientation`, nueva en `core/solid.ts`) que mira hacia fuera con la cámara dentro de su caja, o hacia dentro con la cámara fuera (un sólido al revés, una habitación con las paredes al exterior; una pieza reflejada se mira como queda en el mundo); y, con la cámara en la habitación, una pared plana (de más de 1 m y delgada como el 2 %) cuyas caras no miran a la cámara; con un presupuesto de 500 000 triángulos por pasada, en el orden del árbol | `scene/flipNormals` de esas piezas | «normales invertidas» (7, una el presupuesto de triángulos) + 3 de `solid.ts` | 11 |

Hay 57 mutaciones del Doctor (2 de ellas, del tipo de escena: que corra o arregle en una escena de producto; la detección
de cada chequeo apagada, cada arreglo vacío, cada umbral y cada condición, el resto) y 1 de `solidOrientation`; todas las detecta alguna prueba (dos sobrevivieron a la primera ronda, el giro del
cristal y el preset de la óptica, y su prueba se arregló). La comprobación de escala del propio Doctor
(`scale`) no compara una escena *Interior* con el tamaño del tipo de producto (un salón de 5 m frente a los 200 mm de
*Estándar* da veinticinco veces): sigue preguntando por el tamaño declarado.

*Pruebas.* Nuevas: `tests/scene-type.test.ts` (32: la tabla de cada tipo, los cinco recorridos de ida y vuelta con un
proyecto nuevo y con todas las casillas tocadas a mano, lo que la persona tocó, el HDRI, la cámara bloqueada, cada cámara con
la suya, el mismo tipo sin cambio, un solo deshacer, el proyecto guardado y abierto, uno anterior, un tipo desconocido, la
memoria dañada, el comando y sus cadenas), `tests/interior-setups.test.ts` (14: el estilo, los mundos, las recetas como sets
sin decoración, el sol del cielo donde dice la luz, la normalización con los 16 tipos, elegir y dejar una receta),
`tests/doctor-interior.test.ts` (41) y 3 en `tests/solid.test.ts`. Actualizadas con sus números nuevos, sin tocar lo que no
cambia: `data.test.ts` (95 montajes y 10 estilos, 7 mundos `SKY`, 7 soles), `rig.test.ts` (78 montajes normalizados con los
16 tipos), `sets.test.ts` (los 72 de antes sin campos de L6; 95 escenas en el manifiesto) y `palette.test.ts` (95
montajes). Mutaciones del tipo de escena: 5 (no restaurar, restaurar todo, no guardar la memoria, no normalizar el tipo,
escribir una cámara bloqueada), todas detectadas. En el navegador: `tools/scene-type-check.mjs` (Playwright, *Rápido*: el
control, que el inspector tiene los mismos controles con cada tipo, *Interior* en una entrada de deshacer con sus siete
recetas y sus miniaturas cargadas, la sombra de contacto apagada y AgX, las siete filas del Doctor, una receta, *Catálogo*,
volver a *Producto*); captura `docs/ui/scene-type-interior.png`.

**Qué no encajó con el plan** (regla 12; lo marcado ◆ es del criterio de Fable: queda anotado, no decidido).

1. ◆ **Las cifras de las siete recetas** son una propuesta mía, **pendiente de Fable**: altura, azimut y temperatura del sol,
   peso de la ventana y del rebote, intensidad del cielo y desvío de exposición. Siguen los órdenes de magnitud de la
   fotografía de interiores y están normalizadas como el resto, pero son decisiones fotográficas y no las he tomado. El
   comentario de `light-setups.ts` lo dice. La propuesta, receta a receta (azimuts relativos a la cámara; tamaños en
   tamaños de pieza, a la distancia dicha; *share* en la escala de `specIrradiance`, ver arriba):

   | Receta | Etiqueta | Mundo | Intensidad del entorno | Exposición (EV) | Luces: tipo az/el/temperatura, tamaño en tamaños de pieza a su distancia, *share* |
   | --- | --- | --- | --- | --- | --- |
   | `INT_WINDOW_MORNING` | Ventana de mañana | `SKY` | 0,12 | +0,2 | sol −65°/20°/4300 K ×1; panel −70°/30°/7200 K 5×4 a 2,6 ×12,2; panel 70°/12°/5200 K 4×4 a 3,5 ×5,9 |
   | `INT_WINDOW_NOON` | Ventana de mediodía | `SKY` | 0,15 | +0,2 | sol −55°/62°/5600 K ×1; panel −75°/40°/6800 K 5×4 a 2,6 ×8,1; panel 70°/12°/5600 K 4×4 a 3,5 ×4,9 |
   | `INT_WINDOW_AFTERNOON` | Ventana de tarde | `SKY` | 0,11 | 0 | sol 70°/14°/3200 K ×1; panel 75°/24°/5600 K 5×4 a 2,6 ×10,8; panel −70°/10°/4600 K 4×4 a 3,5 ×7,4 |
   | `INT_OVERCAST` | Nublado | `STUDIO` | 0,8 | +0,3 | panel −75°/38°/7000 K 7×5 a 3 ×0,5; panel 0°/82°/6800 K 6×6 a 2,8 ×0,25; panel 75°/14°/6800 K 5×5 a 3,6 ×0,25 |
   | `INT_NIGHT_LAMPS` | Lámparas de noche | `STUDIO` | 0,04 | −0,7 | disco −110°/28°/2600 K 0,7 a 2,2 ×0,45; disco 125°/48°/2400 K 0,5 a 2,8 ×0,25; cuadrado 0°/80°/2900 K 1,4 a 2,8 ×0,2; panel 60°/12°/8500 K 4×4 a 3,5 ×0,1 |
   | `INT_BLUE_HOUR` | Hora azul | `SKY` | 0,45 | −0,5 | sol 115°/3°/2300 K ×0,15; disco −100°/28°/2700 K 0,7 a 2,2 ×20; disco 135°/45°/2500 K 0,5 a 2,8 ×12; panel 75°/25°/10500 K 5×4 a 2,6 ×14; panel −35°/12°/7500 K 4×4 a 3,5 ×7 |
   | `INT_WHITE_ROOM` | Sala blanca de estudio | `STUDIO` | 1 | +0,5 | panel 0°/85°/5600 K 6×5 a 2,6 ×0,3; panel −80°/28°/5600 K 6×5 a 2,8 ×0,3; panel 80°/22°/5600 K 5×5 a 3,2 ×0,2; panel 0°/15°/5600 K 4×4 a 3,5 ×0,2 |

   Los azimuts son relativos a la cámara (`LightSpec.az`). Los órdenes de magnitud: el sol de 2 a 4 veces el cielo a mediodía y
   de 1,5 a 2 al atardecer (la intensidad del entorno sale de que el cielo da la irradiancia de la cúpula de estudio, unos 2 por unidad
   de intensidad en las unidades del normalizador, y el sol `sen(altura)` por su energía), lámparas de tungsteno a 2400–2900 K, un cielo claro a través de un
   vidrio a 6500–10 500 K.
2. ◆ **Los umbrales del Doctor de interiores**, propuesta mía **pendiente de Fable** (`INTERIORS.md` §3.6 nombra los
   chequeos, no las cifras); son constantes exportadas de `core/doctor-interior.ts`:

   | Constante | Valor | Para qué |
   | --- | --- | --- |
   | `INTERIOR_MIN_MM`, `INTERIOR_MAX_MM` | 100 mm y 30 m | tamaño de la escena que es un mueble o una habitación (un jarrón y un loft) |
   | `WIDE_LENS_MM` | 18 mm | óptica que estira los bordes (la cifra es la de §3.4) |
   | `INTERIOR_LENS_MM` | 24 mm | lo que pone el arreglo: la más ancha de las ópticas de interior de §3.4 |
   | `EYE_MIN_MM`, `EYE_MAX_MM` | 0,3 m y 2,2 m | altura de ojo plausible sobre el suelo (z = 0) |
   | `EYE_STANDING_MM` | 1,5 m | lo que pone el arreglo: una persona de pie (§3.4) |
   | habitación, panel, pared | 1,5 m por lado; grosor ≤ 12 % y ≥ 300 mm; ≤ 2 % y ≥ 1 m | qué caja es una habitación, qué pieza es un cristal de ventana, qué pieza plana es una pared |
   | recorte | la mitad de la distancia a la pared (≥ 0,01 mm) | lo que pone el arreglo |
   | `INTERIOR_NORMALS_TRIANGLES` | 500 000 | presupuesto de triángulos de la comprobación de normales por pasada |

3. ◆ **Valores de la tabla de §3.1 que son un número donde el documento da un intervalo o una palabra**: *Rebotes* «16–24» es
   16 (el límite bajo; el *Final* podría pedir 24); *sombra de contacto suave* es una opacidad de 0,35 en el visor (la sombra
   de contacto del motor no tiene intensidad: es el atrapasombras, y su suavidad la da el tamaño de las luces); *cúpula
   blanca* es la cúpula de estudio con un fondo de color blanco puro. El tipo de escena **no cambia el montaje de luz**: elige
   el entorno, y la sección *Luz* se abre en las recetas de *Interior*, pero cuál de las siete es la de partida es una
   decisión de fotógrafo que no tomé.
4. **Filas de §3.1 que no se aplican porque nombran algo que aún no existe o que no es del proyecto.** *Entorno*: el ciclorama
   del catálogo (K2). *Exposición*: la automática con su mando EV (K3; la exposición queda en la del tipo de producto y el
   desvío de la receta). *Cámara*: la altura de ojo de 1,5 m y las verticales rectas (K3), y «alzado o tres cuartos» (una
   vista, no un valor: se queda la que hay). *Transformada*: «rodillo largo» y *Low contrast* — el mapeo de tonos no tiene
   parámetro de rodillo y *Contraste* se guarda pero el motor aún no lo aplica (`image.postSoon`), así que solo se pone AgX
   (y, de paso, `INTERIORS.md` §3.5 pide una curva por receta: `LightSetup` no tiene campo para ella). *Unidades mostradas*:
   es una preferencia de la aplicación (*Ajustes ▸ General*), no del proyecto, y moverla con el tipo rompería «toda mutación
   pasa por el *store* y es deshacible» y la ida y vuelta; el Doctor sí habla en mm y metros. «**HDRI interior**»: no hay
   recetas de entorno propias todavía (`STUDIO-TOOLS.md` §2); se respeta el HDRI que la persona haya cargado.
5. **La tabla dice «Producto (hoy): Estándar / AgX» y el proyecto nuevo arranca en *Fílmica*.** Producto no escribe nada, así
   que no hay conflicto; la fila de la tabla no es lo que el proyecto trae.
6. **La bruma del cielo por receta** (la turbidez es `environment.skyTurbidity`, no del montaje) **no está**: `LightSetup`
   no tiene el campo y dejarlo exige una regla de qué devolver al salir de la receta. Las recetas de día usan la bruma que
   haya (3 por defecto); *Nublado* es la cúpula de estudio con una ventana difusa, no un cielo cubierto (no hay modelo de
   nubes). ◆
7. **Sin el nodo `ROOM` de K2 el Doctor usa lo que hay.** «Habitación cerrada» es la cámara dentro de la caja de las piezas;
   «abertura» es un material de vidrio o transparente; «pared» es una cara de esa caja. K2 sustituye lo primero y lo segundo
   por las aberturas de la habitación; los chequeos y los arreglos se quedan. **El arreglo de la abertura es un sustituto**:
   los focos de la receta *Sala blanca* están alrededor del producto a distancias en tamaños de pieza, así que en una
   habitación importada de verdad cerrada quedan fuera de sus paredes; el arreglo bueno (*añadir una ventana*) es de K2.
8. **Normales: solo superficies cerradas y paredes planas con la cámara dentro.** Una malla abierta que no es una pared (más
   de 1 m, 2 % de grosor) no se mira, ni las piezas que pasan de un presupuesto de 500 000 triángulos por pasada, en el orden
   del árbol (la primera vez que se mira una malla se sueldan sus vértices y una sala amueblada entera pararía el primer
   cambio de la escena; se cuentan triángulos y no lo que está en la caché, así que la misma escena da siempre la misma
   respuesta), ni se detecta lo de «una cara» (una pared sin grosor por donde la luz se cuela en las esquinas); un caso borde conocido: una habitación
   cerrada vista **desde fuera** con las caras hacia dentro (un corte) da aviso.
9. **Los chequeos de interior no están en `DOCTOR_CHECKS`** (los 17 que ya tenía el Doctor) sino en el suyo,
   `INTERIOR_DOCTOR_CHECKS`, para no mover ese listado (otra fase, D1, añade sus chequeos de motor) ni el orden de los
   resultados de una escena de producto; `doctorCheck(clave)` los conoce a los dos.
10. **Cambiar a *Interior* no mueve la cámara**: pone 28 mm y la pieza se ve más pequeña hasta que K3 traiga la altura de ojo
    y el encuadre de interiores. *Crear estudio* vuelve a escribir de su tipo de producto la calidad y las muestras (como
    siempre) y no reaplica los valores del tipo de escena.
11. La mezcla de un sol con paneles en una receta (que `specIrradiance` mide en unidades distintas) obliga a *shares* de 5 a 20
    en las ventanas y las lámparas de la hora azul; los que son solo de paneles suman 1 como los demás. Es la escala del
    normalizador de siempre, no una nueva: está explicada en el comentario.

## K2 · Habitación, portales y vista exterior — **Opus**

**Qué.** Nodo `ROOM` paramétrico de `INTERIORS.md` §3.2 (ancho, fondo,
alto; aberturas con posición, tamaño y alféizar; material por superficie;
zócalo; *ocultar pared del lado de la cámara*; variante ciclorama con el
perfil del barrido infinito de las primitivas), editable en el inspector
y en el visor (asas en las aberturas), guardado en el proyecto y exportado al RSB como mallas
más una sección `PORT` por abertura; **portales automáticos** también
para habitaciones importadas (heurística: cuadriláteros de vidrio o
transparentes en la envolvente), sin jerga en la interfaz; material
*Vidrio de ventana* fino no refractivo; **vista exterior** como imagen
en un plano detrás de cada ventana con paralaje opcional (sección RSB de
imagen de M2). Habitación de ejemplo procedural (*Cargar sala de
ejemplo*) con un sofá y una lámpara.

**Depende de.** U3, I3, M2 (para la imagen de la vista).

**Criterio.** Tests de geometría (aberturas recortadas con el número de
triángulos esperado, portales con el área exacta de cada hueco, pared
oculta solo en cámara); la heurística marca el vidrio de un fixture de
habitación importada y no marca un vaso; captura de la sala de ejemplo
en la vista previa.

## K3 · Cámara de interiores — **Opus** — hecha

**Qué.** `INTERIORS.md` §3.4: *shift* con cálculo automático
(*verticales rectas*, apagable), altura de ojo con presets, ópticas de
interior, **visibilidad a cámara por objeto** (en vista previa y en el
RSB), ortográfica para alzados y planta, cámara **panorámica**
equirectangular 2:1 y *fisheye* (en la vista previa, por seis caras; en
el motor, por franjas), **exposición automática** con mando EV y presets
y el multiplicador de exterior en el rayo de cámara, recorrido WASD con
altura fija. Exposición y curva como pases del estado `image`.

**Depende de.** U1, E3.

**Criterio.** Test de *shift*: con la cámara inclinada 10° las verticales
de un cubo quedan paralelas en la proyección (±0,1 px a 1080p); la
panorámica de la vista previa coincide con la del motor en seis
direcciones de prueba; la planta no muestra el techo y la habitación
sigue iluminada por él (comparación de medias); capturas.

**Hecho.**

*Motor.* Dos proyecciones nuevas en `rt_core::scene` (`Projection`, `Camera::panorama_dir`): la **equirectangular**
(longitud y latitud sobre la imagen, 360° × 180° en 2:1) y el **ojo de pez equidistante** (`θ` proporcional a la distancia
al centro, negro más allá de media vuelta), estenopeicas y desde la base de la cámara; la profundidad de los pases es la
distancia, y las huellas de píxel de partículas, texturas y cáusticas toman el cono de la esfera. `CAMR` gana 16 bytes al
final (`u32 projection; f32 fov_x_deg fov_y_deg exterior`) que **solo se escriben si alguno no es el de por defecto**: los
archivos de antes conservan sus bytes y ningún *hash* se movió. **Visible a cámara** por instancia: `INST.flags` bit 2
(`INSTANCE_NO_CAMERA`, valor 4, junto al bit 1 de `INSTANCE_NO_SECTION`); solo las consultas `RayClass::Camera` (rayos
primarios y sus continuaciones rectas, pases, tapas de sección) se la saltan, en la BVH, en la fuerza bruta y en las
tapas. El **multiplicador de exterior** (`CAMR.exterior`) multiplica el entorno que ve un rayo de cámara al escapar
(también por paredes finas y recortes) y el fondo del atrapasombras. `rt_features` y `/api/info` suben el bit 4 (valor
16, `FEATURE_CAMERAS`). Tres escenas de paridad sobre la habitación de cajas de `example::k3_room` (`rt
--write-k3-plan-example`, `--write-k3-panorama-example`, `--write-k3-fisheye-example`, y sus `tests/fixtures/k3-*.rsb`):
`PINNED_K3_PLAN_4SPP` = `0x6efb1e66`, `PINNED_K3_PANORAMA_4SPP` = `0x96de8d73`, `PINNED_K3_FISHEYE_4SPP` = `0x9b85a1b6`,
iguales en escalar, SSE2 y AVX2, con 1, 4 y 16 hilos, en WASI escalar y `simd128`, en el `rt.wasm` real y (la
panorámica) por la API del lanzador; un bloque de paridad K3 en `engine.yml`, imagen sola y con `--passes`.

*Página.* `CameraState.projection` (`PERSPECTIVE · ORTHOGRAPHIC · EQUIRECTANGULAR · FISHEYE`) en la lista *Proyección* de la
sección *Cámara*, `fisheyeFovDeg` (60°–360° en la diagonal del encuadre) y las vistas *Alzado* y *Planta* (ortográficas).
**Verticales rectas** (`straightVerticals`, `core/interior-camera.ts`): se escribe la cámara nivelada en la misma
posición y el mismo acimut, con el *shift* `−f · tan(inclinación)` sumado al de la óptica en el `LENS` de O1 que ya
existía (como pidió O4: una herramienta que mueve el *shift*, sin reordenar la óptica); la vista previa pone la misma
corrección en la proyección (`render/camera-projection.ts`, `P · Rx`), así que el picado, el contorno y el *gizmo* la
siguen. **Altura de ojo** (`camera/eyeHeight`, presets *De pie* 1,5 m y *Sentado* 1,1 m) y **ópticas de interior**
(`camera/interiorLens`, 24 · 28 · 35 mm), una entrada de deshacer cada una, nada con la cámara bloqueada. **Visible a
cámara** en *Pieza* (`SceneNode.cameraHidden`, heredado, `scene/setCameraHidden`): bit 2 de `INST` para el motor; en
Rápido, un material que no escribe color ni profundidad y sigue dando sombra, fuera del picado, de la caja, de los
tintes y del pase de ids. **Panorámicas en Rápido** (`render/panorama-pass.ts`): la escena en las seis caras de un cubo
(medio flotante, lineal) y el lienzo desde el cubo con `PANORAMA_GLSL`, el mismo mapa que el motor
(`core/panorama.ts`), sobre el lienzo entero con el encuadre de salida dentro, como la imagen del visor Completo; el
picado sigue el mapa. **Exposición como pase** del estado `image` (`core/image-passes.ts`): `exposureMode` *A mano ·
Automática*; la automática mide en la página las sumas de la acumulación (luminancia `f32`, `log2` del motor, 10 % más
oscuro y 5 % más claro fuera, media al gris del 18 %, ±16 EV, centésimas), y `exposureEv` pasa a ser la compensación
*Brillo (EV)*; el visor la rehace cuando las muestras se duplican, y el render final mide sus sumas antes del
*denoise*, en el *pool* y en el lanzador. Presets *Día luminoso · EV 7* y *Tarde de lámparas · EV 5* (exposición a mano,
`log2(683/1,2) − EV₁₀₀`) y el deslizador *Exterior (rayo de cámara)* (`environment.exterior`, también en el fondo de
Rápido). El tipo *Interior* enciende las verticales rectas y la exposición automática por el mecanismo de casillas de
K1 (`image.exposureMode`, `camera.verticals:<id>`): volver de tipo deja el proyecto como estaba. Proyecto, biblioteca y
estudio guardan y normalizan los campos nuevos; un proyecto de antes abre igual.

*Criterio, en números.* **Verticales**: con la cámara inclinada 10° (28 mm, 1920 × 1080), las aristas verticales de un
cubo de 600 mm quedan a **0 px** de paralelas en la proyección de la página y en la de Rápido, y a **0,0001 px** con los
rayos del motor (`rt-core`, leyendo el archivo que escribe la página, `tests/fixtures/k3-verticals.rsb`); sin
verticales rectas, 7,5 px (página) y 6,4 px (motor). Rápido y motor coinciden punto a punto a < 0,01 px; el objetivo
sigue en el centro (< 10⁻⁶ px). **Panorámica**: en un cuarto cerrado de seis paredes de seis colores, las seis
direcciones ±X ±Y ±Z de la equirectangular (y cinco del ojo de pez de 360°, y negro fuera del círculo de imagen) dan
el color de su pared en el `rt.wasm` real y en Chromium, y el picado de Rápido coge esa pared. **Planta**: en la
habitación de prueba, la media del suelo visto desde arriba con el techo oculto a cámara es **0,010220**; la misma
habitación vista desde debajo del techo, **0,010220** (+0,0000 %); sin techo, 0,002109 (20,6 %), y el techo no aparece
(0,000000 de lo que la cámara ve de él). En el navegador (`tools/k3-check.mjs`), la planta con el techo oculto cambia la
imagen de Rápido y el visor Completo la muestra iluminada (media del visor 85 sobre 255; el umbral de la prueba es 12) con la exposición automática medida (+2,6 EV).

*Pruebas.* `scene::camera_tests` y `render::k3_tests` de rt-core (mapas, CAMR de ida y vuelta e inválidos, verticales,
las tres imágenes fijadas, medias de la planta, pases, clases de rayo con tapas, exterior exacto a la mitad, la
habitación sin campos K3 igual que antes), `rt-cli/tests/example.rs` (1, 4 y 16 hilos, escribir los ejemplos),
`rt-app/tests/parity.rs`; `tests/interior-camera.test.ts` (24: el criterio de verticales en página y Rápido, el
límite, altura de ojo, ópticas, vistas, mapas, `CAMR` e `INST` byte a byte con `rt`, herencia, exterior, proyecto,
`readsCameras`, *Interior* de ida y vuelta, el `rt.wasm` real con los tres fijados y las seis direcciones),
`tests/image-passes.test.ts` (11: el medidor), `tests/panorama-browser.test.ts` (4, Chromium: seis y cinco direcciones,
el círculo de imagen, una pared oculta a cámara ni se dibuja ni se pica) y una prueba del *pool* en
`tests/pathtracer.test.ts`. **Mutaciones**: 28, todas detectadas. En el motor (8): la BVH que no se salta lo oculto a cámara, lo oculto para todos los rayos (también las sombras), la fuerza bruta que no se lo salta, la tapa de sección de una pieza oculta vista por la cámara, el signo de la longitud equirectangular, el ojo de pez sin ceguera más allá de media vuelta, el exterior sin aplicar y los campos de `CAMR` escritos siempre. En la página (20): el signo de la longitud en el mapa y en el GLSL, el círculo del ojo de pez en el GLSL, el signo del *shift*, la cámara que no se nivela, la proyección de Rápido sin girar, el bit de `INST` sin escribir y escrito para un motor que no lo lee, el exterior sin escribir, los campos de `CAMR` escritos siempre, la herencia de *Visible a cámara*, Rápido que dibuja y que pica una pieza oculta, los dos recortes del medidor, la suma en vez de la media de las muestras, el logaritmo de la media, el medidor progresivo que mide cada fotograma, el *pool* que no da la lectura y el preset contra el cero equivocado. Tres sobrevivieron a la primera pasada (el círculo del ojo de pez en el GLSL, lo oculto también para las sombras y la tapa oculta) y se reforzaron las pruebas hasta detectarlas: una esquina del lienzo fuera del círculo de imagen, un segmento de sombra que termina entre el techo y el suelo, y dos rayos a la altura de la tapa del techo, desde el lado quitado y desde dentro de la losa.

*Capturas.* `docs/ui/k3-verticals.png` (la habitación en Completo con las verticales rectas y la sección *Cámara*),
`k3-plan.png` (la planta en Completo con el techo oculto y la exposición automática en la barra de estado) y
`k3-panorama.png` (la panorámica 2:1 en Completo), con sus versiones de Rápido en `-fast`; entradas en `GALERIA.md`
bajo *Sin publicar*.

**Qué no encajó con el plan** (regla 12; lo marcado ◆ es del criterio de **Fable** y queda propuesto, sin decidir):
(1) **No hay recorrido WASD** con altura fija: lo cubre N3 (*Paseo de cámara*), con la especificación aplazada en `TODO.md` §3 (*Paseos a pie*).
(2) **No hay nodo `ROOM`** (es K2): las pruebas y la comprobación del navegador usan una habitación de cajas y la
visibilidad a cámara por pieza, que vale para cualquier geometría; la pared frontal oculta y el recorte cercano
automático de `INTERIORS.md` §3.4 quedan para K2. (3) **El motor no renderiza la panorámica por franjas**: la renderiza
entera, por baldosas como cualquier imagen; las franjas para tamaños grandes son de K6. (4) **El *shift* va en `LENS`,
no en `CAMR`**: las verticales rectas mueven el *shift* de la óptica de O1 (lo que pidió O4); el motor no sabe de ellas.
(5) **La curva es la transformada de vista**: *Low contrast*, el rodillo largo y ISO y obturador en *Avanzado* siguen sin
hacer; el pase de curva es `RNDR.tonemap`. (6) **Interior no mueve la cámara a la altura de ojo**: hacerlo como una
casilla más rompía el viaje de ida y vuelta de los chequeos del Doctor de interiores de K1 (que miden el encuadre); los
presets están en *Cámara*. (7) En Rápido no se dibuja nada encima de una panorámica (contorno, *gizmo*, glifos), y el
fondo degradado o de imagen se ve como color. (8) La planta es ortográfica a 89,9° (el tope de elevación de la cámara),
no a 90°. (9) No se añadió al Doctor un chequeo de «cámara inclinada sin verticales rectas». (10) La exposición
automática la mide la página: una escena exportada y renderizada con `rt` fuera de la aplicación lleva solo la
compensación en `RNDR.exposure_ev`. (11) **Para F1** (picado exacto por el rayo primario del motor): una API de píxel →
rayo tiene que servir a la ortográfica (origen en el plano de la imagen, dirección fija), a las dos panorámicas (el
mapa de `Camera::panorama_dir` desde la posición, sin lente, y «nada» fuera del círculo del ojo de pez) y a las
verticales rectas (la cámara que se renderiza, `renderedCamera`, no la de la órbita); `focusDistanceFor` ya da la
distancia de enfoque con verticales rectas y no se usa hasta F1. ◆ (12) **Presets de altura de ojo** 1,5 y 1,1 m y
**ópticas de interior** 24 · 28 · 35 mm (28 sin preset de lente: `INT_28` es solo una focal), tomados de §3.4. ◆ (13)
**Medición de la exposición automática**: media logarítmica recortada (10 % abajo, 5 % arriba) al gris del 18 %, ±16 EV.
◆ (14) **Presets de EV** 7 y 5 de §3.4 y su calibración `EV₁₀₀ = log2(683/1,2) − exposición` (que EV 0 del motor sea
EV₁₀₀ ≈ 9,15). ◆ (15) **Multiplicador de exterior** 1 por defecto (sin efecto) y 0,05–1 de rango. ◆ (16) **Interior
enciende las verticales rectas** por defecto (como dice §3.1), y hasta **30°** de inclinación corregida
(`VERTICALS_MAX_TILT_DEG`). ◆ (17) El ojo de pez de 180° **en la diagonal** del encuadre (llena el encuadre; más ancho,
se ve el círculo).

## K4 · Motor para interiores, conjunto mínimo — **Opus**

**Qué.** `INTERIORS.md` §4, puntos 1 a 7, en `rt-core`: desplazamiento
de origen por ULP (Wächter y Binder) y BVH de dos niveles con instancias;
sol como disco con muestreo de cono y excluido del entorno; cielo
físico (hecho en E5c: la forma de Hošek–Wilkie con coeficientes propios,
sin sus tablas) e HDRI con CDF 2D; rectángulos y discos por ángulo sólido;
vidrio fino; **portales** (sección `PORT`) con tabla de área sumada por
portal y MIS; **árbol de luces** (Conty y Kulla, nodo compacto como
pbrt-v4; todas las luces si ≤ 8); *clamping* de directo e indirecto en
unidades de exposición, regularización, ruleta; **muestreo adaptativo**
por dos medios búferes en bloques; AOV (albedo, normal, profundidad,
varianza, recuento) y **denoise** à-trous demodulado guiado por varianza
al final y en previas; ajustes de *Interior* del tipo de escena pasados
por RSB.

**Depende de.** E5, K2.

**Criterio.** Escenas de prueba propias (una sala cerrada con una
ventana, una sala con doce lámparas, una mesa de cristal) con tests
numéricos: con portales el error cuadrático a 64 muestras baja al menos
a la mitad frente a sin ellos; el árbol de luces da la misma media que
muestrear todas (±1 %) con menos varianza; la imagen sin *clamping* y
con él difieren menos del 2 % en media; el *denoise* a 64 muestras queda
más cerca de la referencia de 4096 que la de 256 sin *denoise* (PSNR);
determinismo y paridad nativo/wasm intactos; hoja de contactos de las
siete recetas de interior con media, quemados y tapados.

## K5 · Guiado de caminos — **Opus**, con visto bueno **Fable**

**Qué.** Árbol SD de Müller, Gross y Novák 2017 implementado **desde el
artículo** (la referencia es GPL y no se mira): árbol espacial binario
con cuadtrees direccionales en las hojas, iteraciones que doblan las
muestras, estructura congelada por iteración y sumada entre workers sin
memoria compartida, MIS con el muestreo explícito de luz y los portales;
presupuesto de memoria configurable; encendido por defecto en *Interior*.
Portales automáticos por mapa de visibilidad como subproducto.

**Depende de.** K4.

**Criterio.** En la sala con una ventana, la misma calidad (PSNR frente a
referencia) con al menos 1,5× menos muestras que K4; sin pérdida en la
botella de producto (±2 % de tiempo); memoria del árbol por debajo del
presupuesto en las tres escenas de prueba.

## K6 · Entregables de mobiliario — **Sonnet**

**Qué.** `INTERIORS.md` §3.7 sobre N2: silo sobre blanco con alfa y con
cotas (dimensiones de la caja envolvente dibujadas en una capa), hoja de
**variantes** de tela y acabado de una escena (lista de materiales ×
piezas → lote), panorámica por franjas en el navegador, alzados y planta
como trabajos de lote, plantilla de nombre con variante.

**Depende de.** K3, N2.

**Criterio.** Un lote de 3 variantes × 2 vistas produce 6 imágenes con
nombres correctos; la panorámica 4096 × 2048 se ensambla sin costuras
(test de continuidad en los bordes de franja); captura de una hoja de
variantes.

## K7 · Activos de ejemplo e interiores en CI — **Sonnet**

**Qué.** Habitación de ejemplo procedural con sofá y lámpara (K2) y, como
activos descargables bajo demanda y nunca en el paquete base, una
selección de Poly Haven (modelos de mobiliario, CC0) y ambientCG
(texturas, CC0) con **licencia y origen registrados por archivo** en un
`assets.json`; **ningún HDRI de terceros** (decisión del usuario,
`STUDIO-TOOLS.md` §2: los entornos son recetas propias); nada de Quaternius ni 3D Warehouse;
atribución para Khronos si se usa. Hoja de contactos de interiores en CI
con `rt`.

**Depende de.** K2, K4.

**Criterio.** Test que falla si un activo no tiene licencia registrada o
si su licencia no está en la lista permitida; la hoja de contactos sale
en CI.

## K8 · Grupos de luz tras el render — **Opus**

**Qué.** Al estilo *LightMix*: cada luz (y el sol, el cielo y los
emisores) pertenece a un **grupo**; el motor emite un pase por grupo
(suma lineal) y la interfaz ofrece, tras el render o en el visor, un
mezclador con intensidad y color por grupo cuya salida es una
combinación lineal; guardar la mezcla como ajuste de la escena (aplica
los factores a las luces reales) y como variantes (*día*, *atardecer*,
*noche*) para la cola.

**Depende de.** K4.

**Criterio.** La suma de los pases por grupo es igual al render completo
(±1e-4); una mezcla guardada y re-renderizada coincide con la mezcla
(±2 %); captura del mezclador.

## P1 · Releases y demo pública — **Haiku** — hecha (v0.1.0)

**Qué.** Petición del usuario: la primera release con **Windows
portable**, **Linux portable** e **instalador de Windows**. Mientras
GitHub Actions no tenga minutos, la release se construye **en local** con
`npm run release` (de P2: `packaging/release.mjs`), que deja en
`out/release/` los tres paquetes, sus `sha256` en `SHA256SUMS.txt` y las
notas. Versión en `package.json` y en el workspace del motor, etiqueta
`vX.Y.Z` creada al publicar, `docs/CHANGELOG.md` desde el principio,
notas de la release en inglés (qué hay, qué no, requisitos: Windows 10/11
x64 con Edge, Linux x86_64 con un navegador Chromium, aviso de
SmartScreen por no estar firmado). Se deja escrito el workflow
`release.yml` que hará lo mismo en CI al subir una etiqueta, y el de
GitHub Pages para la demo, para cuando vuelva a haber minutos.

**Depende de.** P2.

**Criterio.** `npm run release` reproduce los tres paquetes desde un
árbol limpio; `SHA256SUMS.txt` cuadra; la etiqueta apunta al commit de la
release; el CHANGELOG lista las fases hechas.

**Hecho.** `docs/CHANGELOG.md` con la v0.1.0 y sus limitaciones,
notas en inglés en `docs/release-notes/v0.1.0.md` (la ruta que lee
`release.yml`), y `npm run release` desde el commit etiquetado `v0.1.0`:
Windows portable, Linux portable e instalador de Windows, comprobados
con `packaging/smoke.mjs` (nativo y bajo Wine, *hash* fijado) y
`sha256sum -c`. La release se publica a mano desde la etiqueta mientras
no haya minutos de Actions. El motor conserva su propia versión (0.3.0);
la de la aplicación es la de `package.json`.

**Cómo se publica ahora (desde la 0.1.4).** Con minutos de Actions, la
release la publica `release.yml` lanzado a mano (*workflow_dispatch*)
**en `main`**, con `tag` = `vX.Y.Z` (la versión de `package.json`) y
`commit` vacío o un commit que ya esté en `main`: construye, crea la
etiqueta y la release en ese commit y sube los cuatro archivos. La sesión
no necesita subir etiquetas. Lanzado desde otra rama, GitHub rechazó crear
la release con *Resource not accessible by integration* (dos veces, con la
0.1.4); desde `main` salió a la primera. El workflow ahora se para en el
primer paso si una publicación no se lanza en la rama por defecto. Sin
`tag`, cualquier rama sirve para construir el artefacto de prueba.

**Con un plugin (desde la 0.1.6).** El paquete `.rpk` que nombra
`src/data/plugins.json` (su `url` apunta a los *assets* de la release de esa
versión) se sube a mano a la release una vez publicada, con la API REST
(`gh release upload <tag> <archivo>`), y se comprueba contra el `sha256` y
los `bytes` del registro; la clave de activación no se sube a ningún sitio
(`docs/release-notes/plugins.md`).

**Con las capturas de la versión.** Las notas de cada release
(`docs/release-notes/vX.Y.Z.md`) llevan las capturas nuevas de esa versión:
las que `docs/GALERIA.md` guarda bajo *Sin publicar*, que el PR de versión
mueve bajo la versión nueva. El cuerpo de una release se lee fuera del
repositorio y no resuelve rutas relativas, así que cada imagen va con URL
absoluta y la etiqueta de esa misma versión (se crea al publicar):
`https://github.com/Grohle-developer/Repackshot/raw/vX.Y.Z/docs/ui/<archivo>.png`.

## P2 · Escritorio: lanzador propio, portables e instalador — **Opus** — hecha

**Decisión tomada (Fable), sustituye a la de Tauri.** El escritorio es
un **lanzador propio en Rust solo con `std`** (`engine/crates/rt-app`,
binario `repackshot`), descrito en `ARCHITECTURE.md` §5.5: servidor local
de la interfaz con *token* y comprobación de `Host`, ventana de
aplicación de Edge o Chromium con perfil propio, **motor nativo** con
todos los hilos, carpeta de datos (o `data/` en modo portable), almacén
de modelos con SHA-256 propio y detección del equipo. Tauri se descarta
porque necesita crates.io (bloqueado aquí) y compilar en Windows (sin
minutos de Actions), y el lanzador propio mantiene el proyecto sin
dependencias en Rust.

**Qué.**
- `rt-app`: servidor HTTP/1.1 mínimo (estáticos con tipos MIME, `Range`,
  API con *token*), apertura de la ventana y fin de la aplicación al
  cerrarla, instancia única, registro en la carpeta de datos; API:
  `/api/info`, `/api/render` (RSB → pasadas acumuladas en `f32`, con
  cancelación), `/api/models/*` (listar, escribir por trozos con
  desplazamiento, reanudar, comprobar, borrar, servir con `Range`),
  `/api/hardware`, `/api/open-folder`; línea de órdenes `--hardware
  <fichero>` (INI que lee el instalador), `--serve-only` (sin ventana,
  para pruebas) y `--version`. SHA-256 propio con los vectores del NIST.
  La regla de recomendación evaluada sobre `src/data/ai-models.json` con
  el mismo fichero de casos que el test de TypeScript.
- En `src/`: `render/native.ts` (`RenderEngine` contra `/api/render`,
  elegido cuando `/api/info` responde; el modo Completo y el Render lo
  usan) y `io/native.ts` (almacén de modelos y carpeta de datos del
  lanzador) detrás de las mismas interfaces que la web; sin más cambios.
- `packaging/`: `release.mjs` (construye la interfaz y los dos wasm,
  compila `repackshot` para `x86_64-pc-windows-gnu` con mingw-w64 y para
  `x86_64-unknown-linux-musl` estático, y monta los paquetes), el
  **portable de Windows** (`Repackshot-<v>-windows-x64-portable.zip`:
  `repackshot.exe`, `app/`, `portable.txt`, licencias), el **portable de
  Linux** (`Repackshot-<v>-linux-x64-portable.tar.gz`, igual, más un
  `.desktop` de ejemplo; AppImage si la herramienta se puede obtener con
  licencia permisiva) y el **instalador de Windows** con NSIS
  (`Repackshot-<v>-windows-x64-setup.exe`): por usuario, sin permisos de
  administrador, en `%LOCALAPPDATA%\Programs\Repackshot`, con licencia,
  carpeta, accesos en Inicio y opcional en el escritorio, desinstalador
  registrado, el paso **Modelos de IA** (`AI-POST.md` §2.2: lee el INI de
  `repackshot --hardware`, marca el recomendado, uno, varios o ninguno,
  licencia visible, y deja la elección para que la aplicación la
  descargue) y *Abrir Repackshot* al terminar. Icono de la aplicación
  acromático, generado desde `docs/media/logo.svg`.

**Depende de.** U5, U6 para el paso de modelos y el almacén; puede
empezar antes por el lanzador y el motor nativo.

**Criterio.** Tests de `rt-app` (`cargo test`): SHA-256 con los vectores
del NIST; el servidor rechaza un `Host` ajeno y una API sin *token*;
`Range` devuelve los bytes pedidos; un modelo escrito por trozos
desordenados y reanudado da el `sha256` esperado; la regla de
recomendación con el fichero de casos. Paridad: la misma escena por
`/api/render` y por el wasm da el mismo *hash*. El `.exe` arranca bajo
Wine con `--serve-only` y sirve la interfaz (comprobación de humo; la
ventana real se prueba en Windows por el usuario). El portable de Linux
arranca, abre la ventana con el Chromium local y renderiza en nativo
(captura `docs/ui/desktop-linux.png`). El instalador se construye con
`makensis` sin avisos.

**Hecho.** `engine/crates/rt-app` (binario `repackshot`, solo `std`, sin
`unsafe`): servidor HTTP/1.1 en `127.0.0.1` con comprobación de `Host`
(421), *token* de 128 bits por arranque en el fragmento de la URL (401) y
`Origin` ajeno rechazado (403); ventana de Edge o Chromium con perfil
propio, instancia única y fin al cerrar o al faltar el latido; **motor
nativo** por `/api/render` que repite el bucle de `rt` y da el mismo
*hash* que `rt` y el pool wasm (`0x223515c3` en el ejemplo, con 1 y 4
hilos, también el `.exe` bajo Wine), con *Terminar por* muestras, tiempo
o lo primero, cancelación y sumas `f32` para PNG de 16 bits y EXR;
almacén de modelos **por `sha256`** con SHA-256 propio, escritura por
trozos desordenados y reanudación; detección del equipo y la regla de
recomendación en Rust y TypeScript sobre el mismo fichero de 36 casos,
con la memoria leída como *medida / 0,94*. `packaging/release.mjs`
(`npm run release`): Windows portable (zip), Linux portable (tar.gz,
binario musl estático) e instalador NSIS (por usuario, inglés y español,
paso de modelos de IA, desinstalador), con icono propio acromático,
avisos de terceros (three, rhino3dm, occt-import-js con sus licencias y
fuentes) y `SHA256SUMS.txt`; tres construcciones dan los mismos bytes.
846 tests web y 241 del motor. Captura `docs/ui/desktop-linux.png`.

No encajó con el plan: AppImage solo bajo demanda (su *runtime* enlaza
libfuse LGPL); instalador solo de 64 bits; en las filas del instalador no
caben resumen, calidad ni velocidad; en Windows `--version` solo se ve
redirigido (subsistema gráfico); sin probar en un Windows real (Edge por
App Paths, VRAM con drivers reales, el instalador pulsado a mano,
SmartScreen: el `.exe` no está firmado).

## Q1 · Vista en sección — **Sonnet** — hecha

**Qué.** Plano de corte por clic + eje, por dos puntos, o animado como un
movimiento más (`MOVE_KINDS` gana `SECTION`); se implementa en el
integrador (descartar la parte del plano, tapar con el color del
material) y en la vista previa con `clippingPlanes` de three.

**Depende de.** E3, N1.

**Criterio.** Una comparación por regiones como la de
`tests/textures-full-browser.test.ts`: la botella de ejemplo cortada por
la mitad, con el `rt.wasm` real por el escritor de la página frente a
*Rápido* (three.js en Chromium), y el acuerdo dicho en números. Tests que
fallan sin la función: plano desde clic + eje y desde dos puntos, ida y
vuelta por RSB, el motor descarta el lado quitado y tapa las mallas
cerradas (una caja cortada por la mitad: área y color de la tapa),
interpolación de `SECTION`, deshacer y rehacer, determinismo con 1, 4 y
16 hilos, paridad wasm (`rt --write-q1-example` con su *hash* fijado y un
bloque en `.github/workflows/engine.yml`).

**Hecho.** (1) *Dato*: `state.section` (`core/section.ts`), un solo plano
por proyecto: `{ enabled, point, normal, cap }` con la normal hacia el
lado que **se quita**; acciones `section/set|patch|enable|flip|clear` por
el *store* (deshacibles, un arrastre es una entrada, nada para lo que no
cambia), guardado en el proyecto (un archivo anterior se abre sin plano).
Se pone de tres maneras: **clic en la pieza + eje** (X, Y, Z o la normal
de la superficie; se quita el lado que mira al espectador), **dos
puntos** (el plano contiene los dos y la dirección de la vista; se quita
lo que queda a la izquierda de la línea del primero al segundo) y
**números** (punto y normal); más *Cambiar de lado*, *Tapar el corte* y el
interruptor, que sin plano hace uno por el centro del producto, de cara a
la cámara. (2) *Animación*: `SECTION` es un movimiento más de
`MOVE_KINDS`, sobre la escena (`{ kind: 'SCENE' }`, como `HDRI`): su
cantidad es el desplazamiento del plano a lo largo de su normal en
tamaños de pieza (negativa corta más adentro, positiva descubre; por
defecto −0,5), con la curva del clip, suma con otros clips y se parte sin
salto; `Pose.sectionOffsetMm` lo lleva a los dos motores. (3) *Motor*
(`geometry/section.rs`, `geometry/solid.rs`): el plano vive **dentro de
`Geometry`**, así que cámara, reflejos, refracciones, sombras, fotones,
selección y pases ven lo mismo sin tocar los núcleos SIMD ni el
integrador: un rayo se recorta al intervalo en que está en el lado que
queda (un semiespacio corta un rayo en un intervalo, y `t` es el mismo en
el mundo y en el espacio de la malla) y es un rayo corriente con otro
`t_min` y `t_max`. **La tapa** va donde el corte pasa por dentro de un
sólido cerrado: la primera superficie que el rayo encuentra tras el plano
se ve **por detrás** (`Solid::inside_before`), y entonces el cruce estaba
dentro; el impacto es plano, sobre el plano, con la normal del plano de
cara al rayo y el material del sólido (sin textura, dibujo, programa ni
bisel: el color liso). El análisis de sólido (soldar vértices por
posición y luego con tolerancia, cada arista compartida por exactamente
dos triángulos en sentido contrario, volumen con signo para el sentido)
se hace una vez por malla (`SolidCache`) y lo repite en TypeScript
`core/solid.ts` para que *Rápido* tape las mismas piezas. (4) *Formato*:
sección `SECT` nueva (20 B: `u32 flags` con el bit 0 = tapar, `f32
normal[3]`, `f32 distance`), a lo sumo una, después de `FXAM` y antes de
`IMGS`, `BMAP` y `ENVR`; sin plano no se escribe (los bytes de antes);
bit nuevo de `rt_features` (4) y de `/api/info`. (5) *Vista previa*
(`render/section-preview.ts`): un `THREE.Plane` compartido por todos los
materiales del modelo (lejos cuando no hay sección: los *shaders* no
cambian al encenderla), tapa con una copia de la geometría de cada pieza
cerrada que pinta solo las caras de atrás con el material de la pieza y
la normal del plano (el equivalente al *stencil*), materiales a doble
cara mientras se corta, y la selección, la caja de selección (que mira los vértices cuando
la caja de la pieza queda cortada), el contorno y el cardán (que se oculta
para una selección que el corte se ha llevado entera) ignoran lo quitado. (6) *Interfaz*: sección **Sección** del
inspector de Escena (decisión y por qué abajo), modos de clic con
aviso en el visor y `Esc`, acciones de la paleta *Vista en sección:
activar o desactivar* y *cambiar de lado*, frases del movimiento, todo en
`es` y `en`. (7) *El estudio no se corta*: las piezas de un set
(*Backdrop*, *Floor*, tarjetas) no son el modelo; el escritor las marca
con el bit 1 de `INST.flags` (`INSTANCE_NO_SECTION`, solo mientras corta
un plano) y el motor las busca también en el lado quitado, saltando
las superficies del modelo cortado (como mucho 48; una escena sin
instancias marcadas no toma ese camino); *Rápido* les da una copia del
material sin plano.

*Medido.* **Región** (`tests/section-full-browser.test.ts`, botella
cortada por el eje con un plano a través de la cámara, 300 × 220, 32
muestras; el motor es el `rt.wasm` real por `projectScene` + `writeRsb`):
el acuerdo por píxel en lo que ambas imágenes dan por asentado es de
**1,000** (8 903 píxeles), la unión de las secciones de cuerpo, tapón,
collar y núcleo se solapa en **0,963** (IoU) y, por clase, cuerpo 0,962,
tapón 0,948, collar 0,839 (un anillo de unos milímetros) y el disco del
núcleo escondido dentro del cuerpo 0,977 (solo la primera superficie
tras el plano puede decirlo). Sin tapas el corte deja de ser plano en las
dos imágenes (irregularidad del brillo 0,054 frente a 0,027 en *Rápido*,
0,100 frente a 0,034 en el motor) y por tono coinciden en 1,000. Los
controles se caen como deben: el plano del motor movido 15 mm deja el
núcleo en 20 píxeles frente a los 1 954 de *Rápido* (acuerdo 0,74) y
cambiado de lado, 19 (acuerdo 0,46). El **estudio**: un suelo de set bajo
la botella tiene 31 335 píxeles en *Rápido* y 31 317 en el motor
(IoU 0,996) y llena la franja de abajo del cuadro (1,00 y 1,00); el mismo
suelo como pieza corriente se corta en las dos (20 512 y 20 809,
IoU 0,983; franja de abajo 0,00 y 0,00); el cardán y la selección en caja
no alcanzan la etiqueta que el corte se llevó entera y sí el cuerpo y el
tapón. Capturas: `docs/ui/section-fast.png` y `docs/ui/section-full.png`
(`tools/section-check.mjs`). **Fijado**:
`PINNED_Q1_SECTION_4SPP = 0x7a4182ea` (la escena de E5 cortada por `x = 0`,
con su suelo lacado como estudio, igual en escalar, SSE2 y AVX2, con 1, 4 y
16 hilos, en wasm escalar y `simd128`); ningún *hash* de antes se movió
(la escena sin plano es la de E5 bit a bit). **Coste**: a 640 × 480 y 32
muestras con 4 hilos, la escena cortada da 4,99 Mrayos/s frente a 4,74 de
la de E5 sin plano (con la mitad quitada baja de 7,1 s a 6,4 s); el
camino del estudio no se nota.

**Qué no encajó con el plan** (regla 12; lo marcado ◆ es del criterio de
Fable: queda anotado, no decidido).

1. ◆ **Dónde vive el control**: en el **inspector de Escena**, entre
   *Ambiente* y *Cámara*, plegado y con el interruptor en la cabecera, y
   no en la barra del visor. Es un objeto de la escena guardado y
   animado, como el entorno y el ambiente; las herramientas de la barra
   son de navegación y transformación. Los modos de clic sí avisan en el
   visor. El recorrido guiado no lista *Ambiente* ni *Sección*, así que no
   gana paso.
2. ◆ **Tapa de un vidrio.** En el motor un sólido de vidrio cortado tiene
   una tapa que **refracta** (físicamente es un vidrio cortado, que se
   ve a su través); *Rápido* la dibuja como vidrio transparente. Una
   tapa **opaca** del color del vidrio sería una opción de cara al
   fotógrafo; no se hizo. La interfaz lo dice en una nota.
3. ◆ **El estudio no se corta.** El brief decía "un lado del modelo"; se
   entendió así (un suelo cortado deja el producto flotando sobre el
   fondo). Cualquier otro uso del plano sobre el estudio (cortar el
   fondo para ver detrás) no se puede pedir hoy: no hay interruptor por
   pieza.
4. **Mallas abiertas, sólidos al revés y piezas con material por cara.**
   Una malla abierta no tiene dentro: el corte enseña su interior (y se
   dice en una nota con las piezas). Un sólido cerrado con las caras al
   revés lo tapa el motor (decide por el signo del volumen) y *Rápido* no
   (lo trata como abierto). Una pieza con un material por cara no se tapa
   en ninguno (el motor ve cada grupo como una lámina) y un vidrio de
   pared fina tampoco.
5. **Límites conocidos del motor**: un rayo de `t_max` finito que entra
   en el lado que queda dentro de un sólido y acaba antes de salir no ve
   la tapa (la siguiente superficie queda más allá de su final), y una
   malla emisiva muestreada como luz sigue alumbrando desde su parte
   quitada.
6. **Pases de *Rápido* para la IA** (profundidad, normales,
   identificadores) no conocen el plano; el color sí. La IA del
   post-procesado recibiría la pieza entera con el color cortado.
7. **El abierto en *Rápido* y en el motor** no se pinta igual: la copa de
   la base, que es una malla abierta, se ve por dentro en los dos pero
   con 509 píxeles amarillos frente a 339 (IoU 0,24 en esa clase: el
   interior de una copa fina depende del sombreado de cada uno); lo que
   se compara de las mallas abiertas es que el corte deje de ser plano.
8. `FEATURE_SECTION` (bit 4) lo publican el módulo y el lanzador, pero la
   interfaz no lo usa: los dos motores que se publican cortan. Un
   `rt.wasm` viejo en `public/engine/` mostraría la pieza entera en
   *Completo* sin avisar (se arregla con `npm run engine:build`).

---

## H1 · Accesibilidad e i18n — **Haiku**

**Qué.** Orden de foco de todos los paneles, `aria-label` en cada icono,
contraste ≥ 7:1 verificado por test sobre los *tokens*, `prefers-reduced-motion`,
revisión de las cadenas `es` (acentos, tono) y `en`, documentación
sincronizada con lo hecho (README, SPEC) tras cada hito.

**Depende de.** U1; se repite al cierre de cada versión.

**Pasada v0.1.16** (2026-10-17). **Hecho:**

- **Contraste** (`tests/ui-contrast.test.ts`): cada texto (`ink-0` a `ink-3`, y `inv-ink`) medido sobre sus superficies en los cuatro temas, con la razón WCAG de los tokens. `ink-0`, `ink-1` y el invertido pasan 7:1 en todas. **36 pares** quedan por debajo y están listados como pendientes: `ink-2` (claro 3,8–5,3:1; oscuro 5,1–6,9:1) e `ink-3` (claro 2,0–2,8:1; oscuro 2,7–3,6:1) sobre todas las superficies, y `ink-3` en alto contraste (claro 5,1–6,6:1; oscuro 5,5–6,3:1). Ningún token cambia; el test falla ante un par nuevo por debajo de 7:1 y ante un par pendiente que ya llega.
- **Nombres** (`tests/a11y-browser.test.ts`): en Chromium, 20 estados de la interfaz (paneles, cajones, ventanas, Ajustes, guía, recorrido, Doctor, editor de materiales, menús y paleta) en español y en inglés. Cada botón sin texto tiene su nombre de `strings.ts`. No faltaba ninguno; el test quita el nombre de *Deshacer* y falla con 16 botones.
- **Foco.** La paleta sacaba el foco con Tab y Escape no funcionaba fuera del campo: ahora Tab se queda en ella, Escape la cierra desde cualquier sitio y el foco vuelve al control que la abrió. Menús y confirmaciones dan vueltas con Tab y devuelven el foco al botón que los abrió; una ventana abierta desde el menú principal (*Ajustes*) lo devuelve al botón del menú. Sin `tabindex` positivo; el orden de Tab no vuelve atrás en ninguna columna (`tests/a11y-static.test.ts`).
- **Movimiento.** *Reducir movimiento* no apagaba el desplazamiento suave del tira de plugins de la ventana de render: ahora sí (`theme.css`). Con la preferencia emulada, ningún elemento transiciona ni se anima. La interfaz no tiene animación en JavaScript: el guía y el recorrido solo siguen posiciones.
- **Cadenas.** Revisadas las 2.997 cadenas en los dos idiomas: sin acentos que falten, sin signos de apertura que falten, sin erratas detectables, y el español usa tú en todo. Un cambio: *Center* pasa a *Centre*. Dos guardas en `tests/strings.test.ts`.
- **Documentación.** SPEC §6 (accesibilidad), README (una línea y los dos tests nuevos), CHANGELOG (*Sin publicar*).

**Qué no encajó:**

- **Decisión Fable: grises auxiliares.** Para 7:1 sobre todas sus superficies, `ink-2` e `ink-3` tendrían que ser `#434343` o más oscuros en claro y `#b5b5b5` o más claros en oscuro; eso iguala los tres grises y la jerarquía pasa a depender del peso y del tamaño. Alternativa: 7:1 solo sobre `bg-0`, `bg-1` y el *hover*, con `ink-2` de `#4e4e4e` o más oscuro en claro y `#afafaf` o más claro en oscuro, y sin texto sobre `bg-2`, `bg-3`, *soft* ni *overlay*. En alto contraste, `ink-3` de `#434343` o más oscuro (claro) y `#c1c1c1` o más claro (oscuro). Al cambiar un token, se quitan sus pares de `PENDING` en el test.
- Las cadenas en inglés con espacio antes del % (`10 %`) siguen la convención SI que usa también el español: se dejan.
- El README está en inglés en su conjunto; el párrafo nuevo también, para no mezclar idiomas en el archivo.
- **Sin auditar en el navegador, pendiente para una pasada posterior.** Los nombres de los botones se comprueban en la ventana de render (*imagen* y *animación*), el editor de materiales y Ajustes (*General* y *Motor*); el foco no se comprueba en ninguna de estas. Quedan fuera por completo: la hoja de importación; el visor de resultados (necesita un render terminado); las subsecciones de Ajustes distintas de *General* y *Motor*; y las confirmaciones de *Liberar* en el almacenamiento (necesitan modelos instalados). La ventana de render y el editor de materiales no son modales a propósito: no atrapan el foco, y su Escape no se ha verificado.
- **Para N1** (animación, no tocado): `src/ui/panels/anim-props.ts:327` da `role="listitem"` a los botones de los presets, con lo que dejan de anunciarse como botones; `src/ui/panels/animation.ts:115` pone `role="tree"` en el contenedor de filas enfocable (las filas sí son `treeitem`). Arreglo pequeño: un botón con su propio rol dentro de la lista.

---

## Decisiones pendientes de Fable (no adelantar)

- **I2**: decidido: `occt-import-js` (LGPL-2.1) como única excepción
  LGPL, aislada con las condiciones de `ARCHITECTURE.md` §1. Pendiente:
  el **eje arriba** de STEP e IGES (hoy Z); SolidWorks y Creo exportan
  con Y arriba, así que se valora leer `originating_system` de la
  cabecera del STEP para elegirlo, y el **aspecto de catálogo** para los
  colores CAD (hoy SIMPLE, rugosidad 0,5).
- **Escritorio**: decidido: lanzador propio solo con `std` en lugar de
  Tauri (`ARCHITECTURE.md` §5.5); instalador NSIS; el instalador elige
  los modelos y la aplicación los descarga (`AI-POST.md` §2.2).
- **Post-procesado IA** (`AI-POST.md`): el modelo por defecto
  (provisional: Z-Image-Turbo) y las tolerancias de la guarda, tras la
  comparación de X1.
- **Interiores** (`INTERIORS.md`): ~~licencia exacta de las tablas de
  Hošek–Wilkie~~ (resuelto en E5c: no se usan; cielo propio con la forma
  publicada y coeficientes ajustados a nuestro simulador); si se activa el aislamiento
  de origen cruzado para compartir la escena entre workers; número de
  luces a partir del cual entra el árbol.
- **Formatos nativos** (`.bip`, `.ksp`, `.sldprt`, `.ma`, `.ztl`, `.f3d`):
  decidido que **no** se leen (propietarios, sin especificación pública;
  leerlos exigiría analizar sus binarios, que las reglas de sala limpia
  prohíben). La entrada es lo que cada programa exporta (`SPEC.md` §5).
  Se revisa solo si aparece una especificación pública o una biblioteca
  MIT/Apache que los lea.
- **E4**: decidido por el usuario: dos modos explícitos, *Rápido*
  (three.js) y *Completo* (trazador siempre, a menos resolución durante
  los gestos), con conmutador en la cabecera; *Render* siempre con el
  trazador. Queda por decidir solo el umbral de resolución reducida.
- **E8**: cómo renderiza `rt` una animación (portar `evaluate` a Rust o
  un RSB por fotograma).
- **L3**: los números de las recetas sobre el motor propio.
- **E7**: umbrales del desgaste sobre la hoja de contactos.
- **UI**: si tras U1 el inspector contextual necesita una pestaña
  *Biblioteca* separada (la decisión de `UI.md` es que no; se revisa con
  uso real).

---

## Tras probar v0.1.0: arreglos de escritorio y todo lo *próximamente*

Petición del usuario (2026-10-13), tras probar el instalador en Windows:
el modo Completo se queda parado al rato de hacer cambios; la cola no se
pausa ni se reanuda; no se puede arrastrar un material a una pieza; elegir
carpeta falla (*no se puede abrir esta carpeta porque contiene archivos del
sistema*); y la ventana se comporta como una web (ofrece traducir, no sale
el logo, el clic derecho y la selección de texto sacan menús del
navegador). **Decisión: en escritorio no aparece nada que no sea nuestra
interfaz**, la interfaz sigue en HTML y todo lo demás (diálogos de archivo,
escritura de archivos, motor) lo hace el lanzador en Rust. Además: **se
integra todo lo que la interfaz marca *próximamente***.

| Fase | Responsable | Qué |
| --- | --- | --- |
| **P3a** (hecha) | Opus | Modo Completo que no se para (reproducir con una sesión larga de cambios contra el lanzador y arreglar la causa), *Pausar* / *Reanudar* / *Iniciar cola* que funcionan en web y escritorio |
| **P3b** | Opus | Escritorio sin rastro de navegador: diálogos nativos de carpeta y archivo desde el lanzador (PowerShell en Windows, `zenity`/`kdialog` en Linux, sin `unsafe`), escritura de renders, proyectos y modelos por el lanzador, menú contextual, selección, traducción, zoom, recarga, impresión, búsqueda y navegación del navegador desactivados, icono y título propios; estudio de WebView2 para Windows |
| **P3c** | Opus | **Ventana propia en Windows** (decisión del líder tras la captura del aviso «¿Desea salir de la aplicación?» de Edge: *todos los avisos y ventanas con nuestra interfaz, nada de avisos web; producto cerrado y profesional*): ventana Win32 sin marco con **WebView2** (el motor de Edge que trae Windows 10/11) y barra de título dibujada por nosotros (título, minimizar, maximizar, cerrar, arrastre), menús contextuales, atajos, barra de estado, zoom, autorrelleno, traducción, descargas y diálogos de script del navegador **desactivados por la API**, y el cierre (botón, `Alt F4`, barra de tareas) **interceptado** para preguntar con nuestra propia ventana si hay cambios sin guardar; Edge `--app` solo como respaldo automático si falta el *runtime*. En Linux sigue Chromium en modo aplicación con el endurecimiento de P3b hasta P3d (ventana propia con WebKitGTK, que exige un binario glibc y no el musl estático) |
| **P3e** | Opus | **Escritorio: todo sobre el lanzador** (decisión del líder tras «se pisa el texto» y «dice no pillar la GPU por ser browser»: *en escritorio la página es solo interfaz*): una costura de plataforma con implementación web y de lanzador; ajustes, biblioteca, historial, miniaturas, equipo y espacio usado en la carpeta de datos por el lanzador; puerto estable por carpeta de datos; ni una fila que hable del navegador; filas de Ajustes que no se pisan |
| **U7** (hecha) | Sonnet | Arrastrar un material (miniatura del catálogo o de *Míos*) sobre una pieza del visor o del árbol, con resaltado (`UI.md` §2.3), y **M1** (cara CAD entera y *Separar por caras CAD*), más selección por caja con `Ctrl/⌘` + arrastrar. Ver U7 y M1 más arriba |
| **E5** | Opus | Ya descrita: vidrio y transmisión, barniz, emisores reales, cielo, HDRI, imagen de fondo |
| **E5b** | Opus | Reflejo del suelo, efectos de imagen (halo, nitidez, saturación, contraste, viñeta), región de render, pases (alfa, profundidad, normales, id de pieza), cáusticas y *denoise* propio |
| **E5c** (hecha) | Opus | Cielo físico propio en sala limpia: la forma de Hošek–Wilkie con coeficientes ajustados a nuestro simulador de atmósfera (`rt-sky`), *Físico · Clásico* en *Entorno*. Ver E5c más arriba |
| **E6**, **E7** | Sonnet, Opus | Ya descritas: madera, tela, bisel, subsuperficie (la anisotropía llegó con E5); desgaste visible en motor y visor |
| **L4**, **L5** | Opus, Sonnet | Ya descritas: focos propios (área, punto, foco, sol) con todas sus operaciones; IES |
| **M2** | Opus | Ya descrita: texturas de imagen y etiquetas |
| **N1**, **N2** | Opus, Sonnet | Vídeo codificado (WebCodecs y muxers MP4 y WebM propios) y lo que quede de pases y lotes |
| **U8** | Sonnet | Lo pequeño de la interfaz: copia automática y recuperación, letras de acceso en menús, cambiar atajos, *Buscar actualizaciones*, los chequeos del Doctor que faltan y sus *Arreglar* (**D1**) |
| **X1b–X4** | Fable, Opus, Sonnet | Ya descritas: el post-procesado IA completo (X3 partida en X3a–X3d, `AI-POST.md` §7) |

**P3a hecha.** Reproducido de verdad con una sesión larga de cambios
contra el lanzador (`tools/viewport-stress.mjs`, nuevo): en la v0.1.0, a
los 90–300 s ninguna petición a `/api/render` volvía a contestarse, y
`gdb` mostraba los hilos HTTP del lanzador bloqueados escribiendo tramas
que nadie leía. **Causa principal (solo nativo)**: al sustituir una vista,
la página abandonaba el sondeo de la anterior sin leer ni cancelar su
respuesta; cada respuesta sin leer retiene una de las seis conexiones
HTTP/1.1 que Chromium (y WebView2) abre al lanzador, y con las seis
retenidas todas las peticiones esperan para siempre. Eso explica los tres
síntomas que vio el usuario (la imagen vieja con el contorno nuevo encima;
*Rápido → Completo* en gris con «0 muestras»; un render que no acaba nunca,
con *Completo · en pausa mientras se renderiza*) y la mitad nativa de la
cola que no se pausa (*Pausar* no llegaba al lanzador). Otras causas, cada
una con su test: las peticiones de *Render* no llevaban la señal de
cancelación; una vista que el lanzador olvidaba (404) o rechazaba (503) no
se volvía a pedir, y a resolución reducida su «fotograma en vuelo» quedaba
marcado para siempre; dos vistas podían salir a la vez y llegar al revés;
en el pool, pasar a *Rápido* durante un fotograma reducido dejaba esa misma
marca puesta y *Completo* no volvía a arrancar; en el lanzador, una
escritura fallida se vaciaba otra vez con el plazo de 120 s, los trabajos
de páginas que se fueron seguían renderizando, las recargas llenaban los 8
sitios de ventana (`503 busy`, lo que encontró P3e), un render que entrase
en pánico no terminaba nunca y un trabajo atascado bloqueaba al siguiente;
y el bucle de animación de `main.ts` se paraba para siempre con cualquier
excepción.

Arreglos: en `render/native.ts`, toda respuesta se lee, se cancela o se
aborta; una vista cada vez, numerada (`seq`); las rechazadas o perdidas se
piden otra vez con espera creciente y el medidor dice por qué; todas las
peticiones llevan la señal; la página cancela sus trabajos en `pagehide`.
En el lanzador: `409 stale` para una vista que llega tarde, la escritura de
una trama sin leer se corta a los 10 s, los trabajos por los que nadie
pregunta se paran solos (visor 10 s, final 20 s), con los 8 sitios
ocupados una ventana que lleva 3 s callada cede el suyo, un pánico termina
el trabajo como fallido y suelta la puerta, y `GET /api/render/state` da el
diagnóstico (con `log=1`, también al registro). Un *watchdog* en los dos
motores (`render/watchdog.ts`) vuelve a arrancar la vista si el lanzador
deja de contestar, si no llegan pasadas o si llegan y no se pintan, lo
dice en la consola y en el registro del lanzador, y el medidor dice el
motivo: nunca «0 muestras» en silencio.

**Decisión del líder** (con la captura del usuario: el visor estaba *en
pausa mientras se renderiza*): **el visor sigue vivo mientras se
renderiza**, compartiendo el equipo. En nativo se queda con la cuarta
parte de los hilos (al menos uno) y el render con el resto, o con todos
cuando el visor ha convergido; en el pool, con la cuarta parte de los
workers. El medidor lo dice (*Completo · compartido con el render · 4 de 16
hilos*) y *Ajustes ▸ Motor de render ▸ Mientras se renderiza* lo elige
(*Mantener el visor vivo (compartido)*, por defecto, · *Pausar el visor
(render más rápido)*). El render da los mismos bits con o sin visor (tests
en Rust, también contra el *hash* fijado con 16 hilos, y en el navegador
el mismo archivo `4e3aa886…` en los dos motores).

**La cola**: el botón de la v0.1.0 pasaba a *Iniciar cola* en cuanto se
pulsaba *Pausar*, con el trabajo aún terminándose, y un *Reanudar* pulsado
entonces se perdía. Ahora hay un estado *En pausa*: el botón dice *Pausar*
mientras corre, *Reanudar* tras una pausa e *Iniciar cola* si no
(desactivado sin nada en espera); *Pausar* para el trabajo y libera el
motor (473 ms hasta que el lanzador no tiene ningún final; 167 ms en el
pool) y *Reanudar* sigue con lo pausado (solo el trabajo de *Render* si era
eso; el trabajo pausado vuelve a empezar).

Tests: 23 nuevos en la web, con un lanzador simulado que modela las seis
conexiones (los simulados de antes contestaban todo al momento, y por eso
se escapó), y 13 nuevos o rehechos en Rust (4, 16 y 32 hilos); cada
arreglo, quitado de uno en uno, hace fallar su test (18 mutaciones en
TypeScript y 15 en Rust). El test de tiempos de un final en cola mide el
reloj del propio trabajo y no lo que tarda la máquina (10 de 10 con otra
compilación en marcha). Sesiones de 10 minutos de
`tools/viewport-stress.mjs` (determinismo, cola y sesión larga con ráfagas
de órbita, soltar y mover una pieza, comprobando que el lienzo muestra la
escena actual):

| Motor, 10 min | Acciones | Renders | Paradas | Imagen vieja | *Watchdog* | Cola |
| --- | --- | --- | --- | --- | --- | --- |
| Nativo, 16 hilos, 1.ª | 171 | 1 (cancelado por deshacer) | 0 | 0 de 15 | 0 | 10 de 10 |
| Nativo, 16 hilos, 2.ª | 163 | 6 (5 terminados, 1 cancelado por deshacer) | 0 | 0 de 16 | 0 | — |
| Pool, 3 workers | 143 | 5 (3 terminados, 2 cancelados por deshacer) | 0 | 0 de 6 | 0 | 10 de 10 |

Lo que no encajó con el plan: con la máquina muy cargada por otros agentes
(carga de 10 a 47 en 4 núcleos), unas 16 acciones por minuto y no
*docenas*; la sesión de 5 minutos del pool contra la v0.1.0 no concluye
(un clic perdido la dejó en *Rápido*), así que el fallo propio del pool lo
prueba su test y no la sesión; un *deshacer* que se lleva el trabajo de la
cola sigue cancelando su render (lo decidido en U5); en el pool, al
terminar un render el visor vuelve a empezar para recuperar todos los
workers (pierde las muestras de esa vista); y como en escritorio los
renders los escribe el lanzador (P3b), la comprobación espera el archivo
en su carpeta de *Descargas* (`XDG_DOWNLOAD_DIR`) y no una descarga del
navegador. Sin probar en un Windows real.

**P3b hecha.** Diálogos del sistema (carpeta, abrir, guardar) desde el
lanzador con PowerShell en Windows y `zenity`/`kdialog` en Linux, y API
de archivos que solo toca lo que la persona eligió en un diálogo durante
ese arranque (carpetas de salida solo para archivos nuevos, nunca se
sobrescribe; extensiones permitidas; *Descargas* y el último proyecto
como únicas excepciones del lanzador); renders, proyectos, importaciones,
exportaciones y modelos pasan por ahí y la burbuja de descargas no
aparece. Interruptores de endurecimiento y preferencias de perfil para
Edge/Chromium en una sola constante que reutiliza P3c; la página bloquea
el menú contextual, la selección del cromo, la traducción, el zoom, la
recarga, la impresión, la búsqueda y la navegación del navegador
(`src/ui/guards.ts`), sin romper ningún atajo propio; `Ctrl W`/`Ctrl Q`
pasan por nuestra pregunta; los enlaces externos salen por un único
`openExternal` (lanzador en escritorio) y un test impide `alert`,
`confirm`, `prompt`, `print` y `window.open`; favicon, iconos y
manifiesto propios. Sin probar en Windows real: que los diálogos salgan
delante de la ventana y que el minimenú de Edge desaparezca del todo (lo
garantiza P3c).

**P3c hecha.** Ventana Win32 propia con WebView2 en Windows
(`engine/crates/rt-app/src/platform/`, el único sitio del lanzador con
`unsafe`, cada bloque con su porqué): COM escrito a mano (tablas virtuales
transcritas del IDL del SDK, con su número de métodos y la posición de
cada método usado comprobados en los tests), el cargador
`WebView2Loader.dll` de Microsoft junto al ejecutable (NuGet
`Microsoft.Web.WebView2` 1.0.4258.31, licencia de estilo BSD que permite
redistribuirlo con su aviso; SHA-256 del paquete y de la DLL fijados en
`packaging/lib/webview2.mjs`) y el *runtime* Evergreen del sistema; perfil
en `webview2/` de la carpeta de datos (portable incluido). Todo lo que no
es nuestra interfaz, apagado por la API: menús contextuales, diálogos de
script, atajos del navegador, barra de estado, zoom, pellizco, deslizar
para volver, autorrelleno, contraseñas, SmartScreen, página de error y,
en *release*, herramientas de desarrollo; navegación solo a nuestro
origen, enlaces `https` pulsados al navegador del sistema, ninguna
ventana nueva, descargas canceladas sin su panel (y la página no descarga
nunca en esa ventana: lo comprueba un test), permisos denegados salvo los
archivos que la persona eligió y el almacenamiento persistente. Cerrar
(botón, `Alt F4`, barra de tareas, menú del sistema) llega a la página
como `close-requested` y pasa por la misma pregunta que `Ctrl W`
(`requestCloseWindow`, *Guardar · No guardar · Cancelar*), sin
`beforeunload`. Icono propio, título `Repackshot — <proyecto>`, barra de
título oscura con el tema oscuro, AppUserModelID `Repackshot.App` (y el
mismo en los accesos directos del instalador, con `repackshot
--shortcut-id`), tamaño, posición y tema recordados en `window.json`, y
los diálogos de archivo de P3b con la ventana como dueña. Si falta el
cargador o el *runtime*, o falla cualquier paso, se apunta en el registro
y se abre la ventana `--app` de Edge; *Ajustes ▸ Escritorio* dice qué
ventana es y por qué, y `--window=webview2|browser` la fuerza. En la
cabecera, el logotipo con una flecha hacia abajo en lugar de las tres
rayas (web y escritorio). Linux sin cambios.

Lo que no encajó con el plan: por decisión del líder, tras compararlo con
NesTube, la ventana usa la barra de título **del sistema** y no una
dibujada por la página (la versión sin marco, con el borde superior y
*Snap Layouts* sobre nuestro botón de maximizar, se hizo, se probó bajo
Wine y se quitó). A WebView2 se le pasan las `DISABLED_FEATURES` y los
interruptores contra la ralentización de `browser.rs` (una sola fuente),
pero no los `HARDENING_SWITCHES`: son de la interfaz del propio navegador,
que WebView2 no tiene o que su API ya apaga, y no están documentados para
WebView2. Bajo Wine no se puede leer de vuelta el AppUserModelID de un
acceso directo (su almacén de propiedades es un esbozo), así que eso, y
todo lo de WebView2, queda por probar en Windows real. El puerto
aleatorio por arranque, que hace perder `localStorage` entre arranques
(en la ventana de Edge y en la propia), queda para P3e.

**P3e hecha.** En escritorio la página es solo la interfaz. Una costura
`Platform` (`src/io/platform.ts`), elegida una vez al arrancar, con dos
implementaciones detrás de la misma interfaz: la web (`platform-web.ts`:
localStorage, IndexedDB, OPFS, WebGPU, como hasta ahora) y la del lanzador
(`platform-desktop.ts`), donde cada servicio y cada byte de estado son del
lanzador: ajustes en `settings.json` de la carpeta de datos, cosas pequeñas
recordadas en `state/`, biblioteca en `library/`, historial de resultados
como archivos en `results/` con su índice, miniaturas en `cache/thumbs/`,
modelos (ya lo eran), equipo siempre por `/api/hardware` y espacio usado
medido por el lanzador (`/api/storage/usage`), con *Liberar* a través de
él. Rutas nuevas `/api/store/*` y `/api/storage/usage`
(`rt-app/src/appdata.rs`) con el *token*, `Host` y `Origin` de siempre,
nombres en minúscula confinados a la carpeta de datos (ni enlaces ni
nombres de dispositivo de Windows), escrituras atómicas, y un documento
que no se pudo leer al arrancar nunca se sobrescribe. **Puerto estable por
carpeta de datos** (`launcher.json`, `rt-app/src/port.rs`): el origen de la
ventana ya no cambia en cada arranque, que era por lo que en v0.1.x se
perdían ajustes, biblioteca e historial al cerrar. Migración, una sola vez
por carpeta de datos (marca `state/migration.json`), de lo que quede en el
almacenamiento del navegador del origen actual; para quien venga de v0.1.x
suele estar vacío (cada arranque tenía otro puerto) y solo deja la marca.
Ninguna fila habla del navegador en escritorio: las cadenas que lo
nombraban tienen su versión de escritorio (`DESKTOP_TABLE` de
`strings.ts`) o su fila oculta (`webOnly`: *Almacenamiento persistente*;
WebGPU, cuota y memoria del navegador solo en la web), *Ventana dibujada
por* dice un nombre (*Ventana de aplicación de Microsoft Edge*, y ya lee el
`window` de P3c para *Ventana nativa (WebView2 x.y)*), la fila GPU lista
las tarjetas del lanzador y sigue a la detección aunque llegue después, el
distintivo *Solo en la aplicación de escritorio* no sale dentro de ella y
el modelo solo para navegador no se lista. Filas de Ajustes que no se pisan
a ningún ancho ni tamaño de interfaz: columna de etiqueta con mínimo,
controles y distintivos que se parten, filas apiladas para valores largos
(rutas en monoespaciado partidas donde haga falta, botón debajo, título con
el texto entero) y consultas de contenedor que lo apilan todo en ventanas
estrechas. Tests: la costura elige el lanzador y entonces no toca
`localStorage`, `indexedDB` ni `navigator.storage` (espías), la migración
una vez y con el origen vacío, escrituras en orden, resultados con sus
límites, las cadenas del navegador cubiertas; en Rust, `tests/appdata.rs`
(seguridad, confinamiento, enlaces, límites, petición cortada, resultados,
caché, espacio, otro arranque) y `tests/port.rs`. Comprobación
`tools/desktop-platform-check.mjs` contra el lanzador real (ajustes que
sobreviven a reiniciar en un perfil de navegador nuevo, el mismo puerto,
nada en el almacenamiento del navegador, un render en `results/`, las GPU
del lanzador, ninguna mención del navegador en los dos idiomas, *Liberar*
por el lanzador, y ningún solape en todas las secciones a 1600, 1280 y
960 px, 90–150 %, dos idiomas, oscuro, claro y contraste alto); capturas
`settings-desktop-paths.png`, `settings-storage-desktop.png`,
`settings-ai-desktop.png`. Con P3b y P3c unidas, 1044 tests web y 309 del
motor.

Unida con P3b y P3c: las carpetas de salida, los proyectos (con el último
que recuerda el lanzador) y los diálogos de importar y exportar salen
también de la plataforma (en escritorio, los de P3b; nunca los selectores
ni los *handles* del navegador), las carpetas elegidas se recuerdan en
`state/desktop.folders.json` y no en `localStorage`, y *Ventana dibujada
por* es una sola función (la de P3c, con sus motivos) que dice *La ventana
propia de Repackshot (WebView2 x.y)* y nunca el nombre de un ejecutable
(sin ventana del lanzador, `--serve-only`, ya no dice *El navegador por
defecto*). La comprobación del lanzador real suma que *Elegir carpeta…* y
*Guardar proyecto* pasan por los diálogos del lanzador (un `zenity` de
prueba) sin tocar los selectores del navegador, que la carpeta queda en
los datos y que *Descargas* lo escribe el lanzador. Al unir: la carpeta
de salida elegida, que P3b muestra por su ruta, se salía de su fila; el
botón dice su nombre y la ruta entera va debajo. Arreglado de paso un
fallo intermitente del test de paridad (`tests/parity.rs`: si la última
pasada llegaba entre dos consultas, el marco devuelto no venía marcado
como terminado).

No encajó con el plan: el *token* sigue en `sessionStorage` (es el secreto
del arranque, no estado).
La copia automática no existe todavía (U8): cuando llegue, a la carpeta de
datos por la plataforma. `REPACKSHOT_TEST_GPUS` (tarjetas falsas, solo para
pruebas) la lee también el binario de *release*. En Windows, si el puerto
recordado está aún en `TIME_WAIT` al reabrir, se toma otro una vez y se
recuerda. Encontrado de paso (de P3a): un trabajo de visor nativo de una
página que se recarga sigue vivo hasta el tope de 8 (`503 busy`). Sin
probar en un Windows real.

**Corrección tras probar v0.1.2.** En Windows de verdad el lanzador no
encontraba ninguna tarjeta gráfica en ningún equipo, solo la CPU, y de eso
dependen *Ajustes ▸ Post-procesado IA ▸ Equipo*, la fila *GPU* y la elección
Vulkan/CPU del motor de IA. Causa: `reg query <clase de pantalla> /s` llega a
la subclave `Properties`, que da «Acceso denegado» («ERROR: Acceso
denegado.» en español), y `reg` sale con 1; `process::output` tiraba la
salida de cualquier programa que no saliera con 0, con los adaptadores
dentro. El test del analizador le pasaba el texto directamente, sin código
de salida: era más permisivo que la realidad, y se ha arreglado con él.
Ahora `process::output_any` devuelve lo impreso junto con el código (y
`output` sigue estricto para las consultas de una sola clave de
`browser.rs` y `files.rs`, donde salir con 1 es «no está»), y las tarjetas
salen de cuatro fuentes: **DXGI** (`rt-app/src/platform/dxgi.rs`, COM a mano
como el de P3c: `CreateDXGIFactory1`, `EnumAdapters1`, `GetDesc1`; VRAM
dedicada exacta de 64 bits, sin el adaptador de software ni los de
Microsoft, `dxgi.dll` solo de `System32`), **el registro** (una consulta
para listar las subclaves y otra por adaptador, nunca `/s` ni `Properties`,
leídas sea cual sea su código), **CIM** (`Win32_VideoController` en la misma
ejecución de PowerShell que la RAM) y **wmic** si PowerShell no contesta.
Se mezclan por adaptador: manda la primera que lista solo lo que hay ahora
(DXGI, si no CIM, si no wmic), porque el registro guarda la clave de una
tarjeta que ya se quitó, y gana la VRAM exacta sobre la de 32 bits, que se
queda en 4 GiB. Cada fuente deja en `logs/repackshot.log` qué encontró o por
qué falló, `/api/hardware` lo da en `gpuSources` y `gpuDetection`, y la
interfaz distingue «No se han podido leer las tarjetas gráficas: mira los
registros» de «No se ha encontrado ninguna tarjeta gráfica». Los programas
del sistema van por su ruta absoluta en `System32` (`reg.exe`,
`powershell.exe`, `WMIC.exe`, también en `browser.rs`, `files.rs` y
`dialogs.rs`). Tests, cada uno comprobado fallando sin su arreglo: un
programa que imprime y sale con 1 se lee (`sh` en Linux, `cmd` bajo Wine),
la fuente del registro con un `reg` falso y con programas de verdad que
salen con 1, el analizador con «Access is denied» y «Acceso denegado.»
entre claves, CIM y `wmic`, la mezcla (la tarjeta quitada, dos tarjetas
iguales, «sin tarjeta» frente a «no se pudo preguntar»), las vtables y
`DXGI_ADAPTER_DESC1` contra el IDL, y la interfaz. Bajo Wine con `xvfb-run`
DXGI lista su adaptador (*NVIDIA GeForce GTX 470*, 15,7 GiB, lo que Wine
inventa), el registro de Wine lo llama *Wine Adapter* sin VRAM, el
PowerShell de Wine no contesta y `wmic` da el mismo nombre que DXGI: queda
una tarjeta, la de DXGI. Encontrado al pasarlo todo bajo Wine: un test de
`rt-app/tests/ai.rs` daba por hecho que el equipo no tiene GPU (una petición
sin `"device":"cpu"` pedía la compilación Vulkan, que no está instalada, y se
rechazaba por eso antes de leer la imagen); fallaba igual en Linux con una
GPU (`REPACKSHOT_TEST_GPUS`) y ya pide la CPU como las demás. No encajó: sigue sin probarse en un Windows real
(si aún falla, `logs/repackshot.log` dice qué contestó cada fuente); que
`reg /s` se pare en el primer error no está comprobado, por eso se consulta
clave a clave; el instalador lee el mismo `--hardware` y ya ve las tarjetas,
pero su página de modelos no distingue «no se pudo leer» de «no hay» (el
INI no cambia).

Orden: oleada 1 **P3a**, **P3b**, **U7**, **E5** en paralelo; oleada 2
**E5b**, **E6**, **L4**, **N1**, **U8**; oleada 3 **E7**, **M2**, **L5**,
**N2**. El post-procesado IA, **adelantado a petición del usuario (2026-10-13)**: **X3a**, **X3b**, **X4**, **X2** y **X3c** ya; **X3d** y **X1b** detrás (`AI-POST.md` §7.6). Cada fase quita sus
*próximamente* y no deja ninguno nuevo sin anotarlo aquí.

## Herramientas de estudio (óptica, entorno, luz, cámara, partículas)

Plan completo en `docs/STUDIO-TOOLS.md`. Fases, por oleadas a partir de la
2 (la DoF de E5b pasa a O1):

*Renumerada:* el flare con fantasmas era **O4** en esta tabla y pasa a
**O6**; O4 es ya la fase hecha *Lente simple y trazada: opciones de cada
una*.

| Fase | Responsable | Qué |
| --- | --- | --- |
| **A6** — hecha | Sonnet | Assets sin motor nuevo: `lenses.json` (16 prescripciones con test paraxial), `bokeh.json` (20 tipos), máscaras de diafragma y gobos generados, `camera-moves.json` |
| **O1** | Opus | Lente fina mejorada: diafragma poligonal y por máscara, perfiles de pupila, obstrucción, ojo de gato aproximado, anamórfico, *tilt-shift*, *split diopter*, CA por canal; selector de bokeh |
| **O2** | Opus | Lente trazada: prescripciones, intersección estable, límites de pupila, autoenfoque, respiración; las 16 lentes |
| **O3** | Opus | CA por tres bandas, coatings (transmisión, tinte, T-stop), velo |
| **O6** | Opus | Flare con fantasmas, estrella de difracción, bloom y halación, polvo y rayas |
| **O5** — hecha (en O2 y O2c) | Sonnet | Editor de lentes: carácter, corte en SVG, ajustes no físicos marcados, *Guardar lente como…* (O2); los elementos de la lente (O2c) |
| **W1** | Opus | Evaluador de pines en el motor con muestreo por importancia; editor de pines; *Colocar brillo* |
| **W2** | Sonnet | Biblioteca de 39 entornos (recetas, miniaturas, *hash*), exportar HDR/EXR, interiores horneados |
| **L6** | Sonnet | Colocación *Reflejo · Directo · Órbita*, normal suavizada, obstáculos, potencia automática |
| **L7** | Opus | Emisores con perfil procedural, gobos, banderas, reflectores |
| **L8** | Opus | Difuso/especular por luz, enlazado de luz y sombra, solo, parpadeo |
| **L9** | Sonnet | Falso color por zonas, fotómetro, hornear el montaje a entorno |
| **N4** | Sonnet | Biblioteca de movimientos de cámara, cámara en mano, rampas, proporciones |
| **N5** | Opus | Dibujar y grabar recorridos, bloqueo de objetivo, desenfoque de movimiento |
| **S0** | Fable | Decisiones de partículas: dónde vive el simulador, formato de caché, secciones RSB |
| **S4a** — hecha | Opus | Ambiente: partículas de aire sin estado (`rt-sim`, `FXAM`, esferas, discos y cápsulas, la sección *Ambiente* de *Escena*); valores de los presets aceptados; lo que sigue, en S4b |
| **S4b** — hecha | Opus | Partículas: el coste a las densidades de los presets, medido (la rejilla de pantalla de los rayos de cámara, porque la lluvia pasaba de 1,3×); un lóbulo hacia delante (Henyey–Greenstein) para polvo, polen y polvareda; gotas sin cáusticas; la cuota del lóbulo y el coste de la lluvia, para el veredicto |
| **S1**–**S10** | Opus, Sonnet | Dispersión e instancias; caída y reposo; gotas y condensación; emisores sin estado; volúmenes; humo; líquidos; pelo y césped; telas; mejoras (detalle en `docs/research/particles.md` §6) |

### A6 · Assets sin motor nuevo — **Sonnet** — hecha

**Hecho.** Todos los assets de las herramientas de estudio que no necesitan
motor nuevo, sin marcas ni nombres de fabricante y generados por código del
repositorio (nada sale de modelos de imagen por IA):

- `src/data/lenses.json` (+ cargador tipado en `lenses.ts`, que conserva
  `LENS_PRESETS`): las 16 prescripciones de `docs/research/optics.md` §2.3 en
  el registro de §5 (superficies con radio, espesor, vidrio `nd`/`vd`,
  semiapertura, tipo, diafragma y *coating*; focal de referencia, número f,
  campo, círculo de imagen, foco y gaps móviles, iris), con la patente o el
  libro en `source`. `tests/lenses.test.ts` traza un rayo paraxial propio y
  reproduce focal y tiraje de cada lente dentro del 0,05 % de lo que trazó el
  informe y del 1 % de lo que dice la patente (también la respiración del
  teleobjetivo, el elemento flotante del macro, el recorrido del hueco del
  blando, el aumento 1/2 del adaptador y la imagen detrás del espejo del
  catadióptrico); el diafragma existe una sola vez en cada lente, las claves
  son únicas y estables, ninguna marca ni vidrio de catálogo aparece, y todo
  vidrio tiene `nd` en [1,4; 2,1] y `vd` en [15; 100]. Una relectura
  independiente de la tabla del informe no encontró diferencias con lo
  transcrito (salvo el hueco simbólico `dB0` y los `vd` estimados).
- `src/data/bokeh.json` (+ `bokeh.ts`): los 20 tipos de `optics.md` §1 con
  claves estables, nombres y descripciones en es/en y los parámetros del
  modo de lente fina (láminas, redondez, giro, máscara, perfil de pupila,
  obstrucción, ojo de gato, compresión anamórfica, CA, remolino, anillos,
  textura), o la lente trazada que los da (`requires: "traced"`), o `requires:
  "wave"` para el anillo de difracción (próximamente). Un test comprueba que
  todo resuelve a máscaras y lentes que existen.
- `tools/assets/` (`common.mjs`, `aperture-masks.mjs`, `gobos.mjs`) y
  `public/assets/aperture/` (45 máscaras de 512²: polígonos de 3 a 18 láminas
  rectos y curvos, estrellas, corazón, varios agujeros, anillos con
  obstrucción 0,3 y 0,5, anillos de cebolla, polvo, rayas, malla) y
  `public/assets/gobo/` (12 patrones de 1024²: ventanas, persianas, hojas,
  luz moteada, puntos, líneas, ráfaga radial, rotura suave), cada uno con
  receta, semilla y *hash* en su `index.json`. El *hash* canónico es el de los
  píxeles (los bytes de un flujo de zlib pueden cambiar entre versiones);
  `tests/assets.test.ts` regenera todo con las funciones puras del generador y
  compara. El generador usa solo `+ − × ÷` y `sqrt` y funciones propias.
- `src/data/camera-moves.json` (+ `camera-moves.ts` y `src/core/camera-moves.ts`):
  14 movimientos (los 13 de STUDIO-TOOLS §4 con la espiral en dos) como listas
  de los tipos de animación que ya existen, en unidades relativas al producto
  (grados, % de la distancia de encuadre, tamaños de pieza, factores de focal y
  de foco), y 3 presets de cámara en mano. `tests/camera-moves.test.ts` expande
  cada uno en barras, las evalúa con `evaluate` en t = 0 y t = fin (finitas y
  deterministas, y a t = 0 nada se ha movido), y comprueba que el contra-zoom
  conserva focal / distancia, que el plato giratorio da una vuelta, etc.
- **Servidor de escritorio** (`engine/crates/rt-app/src/static_files.rs`): hasta
  ahora todo `/assets/` salía con `Cache-Control: immutable` de un año porque
  Vite nombra ahí todo por *hash*; los assets nuevos no llevan *hash* y un
  fichero regenerado con el mismo nombre se habría visto viejo para siempre. Ahora
  solo es inmutable lo que está directamente en `/assets/` y se llama
  `nombre-XXXXXXXX.ext` (el patrón de 8 caracteres base64url que emite Vite 8);
  lo demás sale con `no-cache` y un ETag del SHA-256 de sus bytes (los ficheros
  de hasta 8 MiB; responde 304 si no cambió, y un fichero regenerado con el mismo
  tamaño y la misma hora ya no se confunde con el anterior). Tests de Rust que
  fallan si algo sin *hash* se sirve inmutable (con los nombres que emitió esta
  misma build y los de `aperture/` y `gobo/`). `tests/chunks.test.ts` ya no lee las
  carpetas de `dist/assets/` como si fueran ficheros.

**Valores provisionales, a la espera de O1 (regla 11, criterio visual de
Fable).** Los *coatings* por época de las lentes (antes de 1935 sin tratar,
hasta 1969 monocapa, después multicapa), los valores por defecto del
diafragma (círculo, f/22 como máximo), los valores de partida de los tipos de
bokeh (remolino 0,7, fuerza de los perfiles de pupila, obstrucción 0,49 del
catadióptrico…), el significado de `profileParam` en cada perfil y las
amplitudes de la cámara en mano (sutil, medio, fuerte) son puntos de partida
con las claves como contrato; O1 los juzgará con renders. También quedan para
O1 las miniaturas de bokeh renderizadas por el motor.

**No encajó con el plan:** el tipo de animación `PAN` no existe todavía (SPEC
§3.7), así que el barrido rápido es una órbita rápida con curva fuerte y el plato
giratorio es `SPIN` sobre el modelo; el nombre «retrofoco» fue una marca y la
lente se llama *gran angular de telefoto invertido*; `CAMERA_MOVES` ya existía en
`animation.ts` (el conjunto de tipos solo de cámara) y la biblioteca es
`CAMERA_MOVE_LIBRARY`; hizo falta un expansor en `src/core/camera-moves.ts` que
el plan no nombraba (N4 lo amplía); la posición del diafragma solo la dan la
fuente para 6 de las 16 lentes (`stopBasis`) y para 9 se supone en el medio del
hueco que el informe nombra; el informe no da número f ni semiaperturas del macro,
ni semiaperturas de casi ninguna lente, así que esos campos quedan vacíos o
derivados y marcados.

### S0 · Decisiones de partículas — **Fable** — hecha

Petición del usuario: simulación de partículas del ambiente (lluvia,
polvo en suspensión y cómo refleja las luces, nieve, polvareda…) como
una opción más dentro de *Escena*, completamente configurable y simulada
en 3D. Es la clase **sin estado** de `STUDIO-TOOLS.md` §5 y de
`docs/research/particles.md` (§2.1, §2.6, §3.2, §4, §5): no necesita
caché ni horneado, y entra ahora como **S4a**. Decisiones que valen para
toda la familia S:

1. **Dónde vive el simulador.** Un *crate* nuevo `engine/crates/rt-sim`,
   solo `std`, sin `unsafe`, sin APIs del sistema, con el contrato de
   determinismo del motor (`f32`, `fmath`, hash contador
   `mix64(seed ^ id)`): la misma semilla y el mismo instante dan las
   mismas partículas en nativo y en wasm (test con *hash* de posiciones).
   Lo usan `rt-core` (el render), `rt-wasm` (el visor Rápido, por una
   exportación `particles_eval`) y `rt` nativo. **No hay puerto a
   TypeScript**: sin wasm, el visor pinta solo la caja del emisor y el
   medidor lo dice (regla 10).
2. **Modelo de tiempo.** Cada partícula es función pura de (semilla, id,
   tiempo): nacimiento = fase propia dentro de su vida (régimen
   estacionario, la escena «llena» desde el primer instante), movimiento
   de forma cerrada (velocidad terminal `v = v₀ + (v_t − v₀)(1 − e^{−t/τ})`
   integrada, sin pasos; viento constante; deriva de *curl noise* como
   **desplazamiento** `d(x₀, t)` sin divergencia, no como velocidad
   integrada: así cualquier `t` cuesta lo mismo). Sin colisiones salvo
   el suelo (mueren bajo `z = 0` y renacen por fase). *Congelar en* el
   instante `time` del efecto; la animación N1 lo moverá más adelante.
3. **Qué viaja al motor.** Los **parámetros**, no las partículas: sección
   RSB `FXAM` (≤ 256 B por efecto, varias permitidas, ignorada por un
   motor viejo), y el motor evalúa las partículas al cargar la escena y
   construye su BVH. Un RSB con 1 M de partículas serían 24 MB por
   trabajador en el navegador; así son 256 B.
4. **Primitivas** en `rt-core`: esfera (intersección estable), disco
   orientado (copo) y cápsula (esfera barrida: la estela de la lluvia sin
   desenfoque de movimiento), con BVH plana propia sobre el conjunto y un
   único nodo en la TLAS. Materiales del catálogo por clave (`MATL` ya
   existente), con variación de tinte por partícula desde su semilla.
   **Tamaño mínimo en pantalla**: una partícula más fina que 0,35 px se
   ensancha a eso para los rayos de cámara y su radiancia se escala por
   (área real / área ensanchada), así la energía no cambia (test).
5. **Lo que no entra en S4a.** Calima, haces de luz, niebla baja y la
   polvareda como volumen (medio participante con seguimiento delta): S5,
   después de E9b (medios dispersores), y en la lista de S4a aparecen
   como *próximamente*. Desenfoque de movimiento (N5). Colisiones con
   las piezas, caché y horneado (S2). Lectura de `.vdb`: no.
6. **Coste.** Con 200 k partículas, ≤ 1,3× el tiempo por muestra de la
   misma escena sin ellas; tope por defecto 100 k en el navegador y 1 M
   en nativo, en *Ajustes ▸ Motor de renderizado*.

### S4a · Ambiente: partículas de aire sin estado — **Opus**, veredicto **Fable** — hecha

**Qué.** En la pestaña *Escena*, una sección nueva **Ambiente** (en la
lista de secciones, tras *Luz* y antes de *Cámara*) con una lista de
efectos (0..n; *Añadir* abre una galería de tarjetas) y, por efecto:

- **Tipo / preset** (claves estables en `src/data/effects.ts`, nombres
  es/en): `DUST_MOTES` Motas de polvo, `POLLEN` Polen, `RAIN` Lluvia,
  `SNOW` Nieve, `DUST_CLOUD` Polvareda, `ASH` Ceniza, `BUBBLES` Burbujas
  que suben, `CONFETTI` Confeti que cae; y, atenuados con *próximamente*
  (S5): `HAZE` Calima, `LIGHT_SHAFTS` Haces de luz, `GROUND_FOG` Niebla
  baja. Valores de partida de cada preset: los pongo yo con la hoja (regla
  11); el agente propone unos en el JSON y los anota como propuesta.
- **Ocho mandos de fotógrafo** (siempre visibles): Cantidad, Tamaño,
  Energía (velocidad), Caos (dispersión + turbulencia), Viento (fuerza y
  dirección en grados), Gravedad, Variación, Semilla (con barajar).
- **Avanzado** (plegado): región (caja alrededor de la escena con margen
  en mm; o caja propia con centro y tamaño; banda de alturas), densidad
  (partículas/m³) o cuenta, forma (punto/esfera, copo/disco, estela/
  cápsula), tamaño mm ± variación, velocidad de caída (terminal) ±
  variación, giro, viento (vector), turbulencia (fuerza, escala, velocidad),
  envolvente de nube (centro, radio, suavidad, para la polvareda),
  material (clave del catálogo; por defecto el del preset: polvo = difuso
  claro con un poco de especular; lluvia = vidrio; nieve = difuso blanco
  con `absorption` corto; polen = difuso amarillento; confeti = lista de
  tintes), variación de tinte, instante (*Congelar en*, s), visible a
  cámara / en reflejos / proyecta sombra (como las luces), y el tope de
  partículas.
- Todo en `ProjectState` (nuevo campo `effects: AmbientEffect[]`), por el
  *store* y deshacible, guardado con el proyecto (U2), Doctor avisa si
  hay más partículas que el tope.
- **Visor Rápido**: `THREE.Points` (polvo, nieve) o `InstancedMesh`
  (cápsulas de lluvia) con las posiciones que devuelve `particles_eval`
  del wasm, hasta 50 k; selección del efecto muestra la caja de su
  región. **Completo y render**: el motor, por `FXAM`.
- **Luz sobre las partículas.** Nada especial: son geometría con su
  material, así que el polvo a contraluz brilla por el especular y la
  NEE las ilumina como a todo; un foco detrás del producto hace el
  «polvo en el haz». La hoja lo tiene que enseñar.

**Motor.** `rt-sim` (S0 §1–2), `FXAM` en `rt-core::scene::rsb` (campos:
`kind u32`, `seed u32`, `time f32`, `count u32`, región (centro, mitad de
tamaño, banda), tamaño y variación, forma, velocidad terminal y
variación, viento xyz, turbulencia (fuerza, escala, velocidad), nube
(centro, radio, suavidad), `material_id`, `tint_var`, `flags` (cámara,
reflejos, sombra), estela (longitud como multiplicador de la velocidad);
los que sobren, cero), las tres primitivas con intersección estable en
`geometry/` y una BVH plana (S0 §4), `Film` y pases sin cambios
(`partId` de una partícula = el id del efecto; `materialId` el suyo).
`rt-wasm` exporta `particles_eval(params, max) → f32[]` (xyz, radio,
orientación) para el visor. Sin `sin`/`exp` por partícula en el bucle
caliente: la exponencial de la velocidad terminal va tabulada por `fmath`
una vez por efecto.

**Depende de.** E3, E5 (vidrio para la lluvia), E12 (elección de luz por
punto: con 100 k partículas la NEE desde ellas no debe elegir a ciegas).

**Criterio.** (1) Determinismo: `hash(posiciones)` igual en nativo y wasm
y con 1 y N hilos, y el mismo píxel a píxel (test); con el efecto a
cuenta 0 los *hashes* de todas las escenas de referencia no cambian.
(2) Régimen estacionario: la densidad medida en la región a `t = 0`,
`t = 3 s` y `t = 60 s` difiere < 3 % (test). (3) La lluvia muere en el
suelo y renace arriba (test: ninguna partícula bajo `z = 0`). (4)
Energía del ensanchado a 0,35 px: una imagen de polvo fino a 4 spp y a
256 spp tiene la misma media ± 2 % (test). (5) Coste: ≤ 1,3× con 200 k
partículas en la escena de ejemplo (medido, en el párrafo del ROADMAP).
(6) *Hoja* `out/ambient-sheet.html`: la botella del ejemplo con los ocho
presets a 512 px / 128 spp, cada uno en dos luces (clave lateral y foco
a contraluz detrás del producto, para ver el polvo brillar en el haz),
más la lluvia con tres longitudes de estela y la polvareda con dos
suavidades; a ojo. (7) Capturas `docs/ui/ambient-section.png` y
`docs/ui/ambient-gallery.png`; comprobación de navegador
`tools/ambient-check.mjs` (añadir, cambiar preset, deshacer, guardar y
abrir, tope). `SPEC.md` §3.1 (el efecto como dato), `UI.md`,
`ARCHITECTURE.md` (crate `rt-sim`, `FXAM`), `STUDIO-TOOLS.md` §5
(apunte: S0 decidido, S4a hecha), CHANGELOG. Cadenas es/en, cromo
acromático.

**Hecho.** **Motor.** `engine/crates/rt-sim` (solo `std`,
`#![forbid(unsafe_code)]`): `AmbientParams` lee y escribe la carga de
`FXAM` (192 B; los 128 primeros son los campos de este apartado, en su
orden), `evaluate(&params, max)` y `Evaluator::particle(id)`. Cada
partícula sale de `mix64((seed << 32) ^ id)` y de un hash por vida: fase
propia, velocidad en forma cerrada `v(a) = v_d + (v₀ − v_d)·e^{−a/τ}`
integrada (`τ` de la caída y la gravedad, `v₀` la deriva más *Energía* en
una dirección al azar), deriva de *curl noise* como desplazamiento (tres
ruidos de gradiente con *fade* quíntico y gradiente analítico; Bridson et
al. 2007), exponencial y seno tabulados con `fmath` una vez por efecto.
Las que caen (o suben) nacen en la cara de arriba (o de abajo) y viven lo
que tardan en cruzar la caja: así mueren en el suelo y renacen arriba sin
salto de densidad; las que flotan viven siempre y la caja se envuelve. La
nube, por rechazo con borde *smoothstep*. Tests: *hash* de posiciones
fijado (`PINNED_PARTICLES_HASH`), densidad a 0, 3 y 60 s dentro del 3 %
(polvo y lluvia, 200 000 partículas, y la caja igual de llena arriba que
abajo), nada bajo `z = 0`, la lluvia renace arriba, cualquier prefijo y
cualquier número de hilos dan las mismas partículas, la nube sigue siendo
nube. `rt-core`: `geometry/particles.rs` (esfera con la intersección
estable de *Ray Tracing Gems* cap. 7, disco orientado, cápsula; BVH plana
por efecto con hojas de una partícula y el id como desempate; `RayClass`
cámara / secundario / sombra / piezas para las tres banderas), `FXAM` en
`scene/rsb.rs` (lector y escritor, varias, validadas; un motor anterior
las salta), el material de cada partícula con el tinte de su semilla,
pases con `partId` = índice del efecto tras las instancias y `materialId`
el suyo, una actualización con los mismos parámetros conserva las
partículas y su BVH. Tamaño mínimo de 0,35 px para los rayos de cámara
con la energía conservada (abajo). `rt --write-ambient-example` escribe
la escena de paridad (`example::ambient_scene`: polvo ensanchado, lluvia
de vidrio, nieve con paleta y sin sombra); imagen fijada
`PINNED_AMBIENT_4SPP = 415d7d74` (era `c4406309` antes de la selección
de luces por punto de E12, que la mueve; las partículas no) y partículas
`e38b8480`, iguales en escalar, SSE2, AVX2 y en wasm escalar y
`simd128`, con 1 y N hilos; sin efectos todas las escenas de referencia
dan los mismos *hashes*.
`rt-wasm`: `rt_particles_eval(params, len, max, out) → u32` (8 `f32` por
partícula: centro, radio, eje, semilla del tinte; `u32::MAX` si la carga
no vale) y `engine/tools/wasm-parity.mjs --particles --expect-particles`.
**Interfaz.** `src/data/effects.ts` (los ocho presets y los tres de S5
*próximamente*, claves estables, es/en), `src/core/effects.ts`
(`ProjectState.effects`, `effect/add|remove|set|preset` deshacibles, la
región, la cuenta y el tope, los campos y los bytes de `FXAM`, los efectos
de un archivo), la sección *Ambiente* (`insp-ambient.ts`), el chequeo
`particles` del Doctor con su arreglo, *Ajustes ▸ Motor de renderizado ▸
Partículas por efecto*, el escritor RSB (una `FXAM` por efecto encendido,
con su material detrás de los de las piezas) y el visor *Rápido*
(`THREE.Points` para esferas y discos, `InstancedMesh` de cilindros para
las estelas, hasta 50 000 por efecto, de `rt_particles_eval`; sin
`rt.wasm`, la caja de la región y el medidor lo dice). Pruebas:
`tests/effects.test.ts`, `tests/effects-rsb.test.ts` (la carga byte a
byte frente a la de `rt --write-ambient-example`, `tests/fixtures/ambient.rsb`;
con el `rt.wasm` real, las partículas y la imagen del motor nativo),
`tools/ambient-check.mjs` (añadir desde la galería, cambiar preset, un
mando, deshacer y rehacer, guardar y abrir, el tope y el Doctor, la caja
sin `rt.wasm`, cromo acromático en los dos temas; capturas
`docs/ui/ambient-section.png` y `docs/ui/ambient-gallery.png`) y la hoja
`tools/ambient-sheet.mjs` → `out/ambient-sheet.html` (los ocho presets
con clave lateral y foco a contraluz, la lluvia con estelas de 4, 12 y
30 ms y la polvareda con suavidad 0,2 y 0,9; 512 × 288, el 16:9 de la
cámara, 128 spp, `--threads 2`; la cámara del ejemplo con la focal × 1,5
para que las partículas se lean, un estudio plano oscuro y *Solo
principal* como única luz; escenas de `tests/ambient-rsb-dump.test.ts`).

**Criterios.** (1), (2), (3) por test, arriba. (4) La energía del
ensanchado: la imagen de polvo fino da de media 1,0820557 a 4 spp
ensanchada, 1,0820074 a 256 spp ensanchada y 1,0809593 a 256 spp con las
partículas exactas (+0,10 %, dentro del ± 2 %). (6) y (7), hechos; los
valores de los presets, aceptados en el veredicto. (5) **No se cumple**: ver
*coste*.

**Coste** (criterio 5; `rt` nativo, AVX2, 2 hilos, con la máquina
compartida por otros agentes: carga 30–38 en 4 núcleos, así que lo que
vale son los cocientes de rondas alternadas). La botella del ejemplo
(9 248 triángulos) con la clave lateral, 512 × 288, 16 spp, tres rondas:
sin efecto 5,46 / 5,68 / 7,31 s; con 200 000 motas de polvo (cámara y
reflejos, sin sombra: el preset) 18,27 / 17,78 / 22,30 s, **3,2×** (3,35,
3,13, 3,05 por ronda); las mismas solo a cámara 15,04 / 15,91 / 16,52 s,
2,6×; con cuenta 0, 5,16 / 7,36 / 6,96 s (lo mismo que sin efecto). Por
cantidad, en dos rondas más: 20 000 → 1,8×, 50 000 → 2,0×, 200 000 →
3,0×. Evaluar las 200 000 y construir su BVH: 1,6–2,0 s, una vez por
carga de escena (no por muestra). En la escena de `rt --example` (322
triángulos, 512 × 384, 4 spp) era 2,0–2,6 s frente a 10,0–10,5 s. Dos
variantes probadas que no bajan nada: aceptar con probabilidad igual a la
cobertura (más rayos que atraviesan y se vuelven a lanzar: 3,4–3,5×) y
aceptar o no dentro del propio recorrido, sin relanzar el rayo (3,1–3,4×;
solo cámara 2,5–2,6×). El coste es **recorrer la BVH de las partículas**:
20 000 partículas ya cuestan lo que los 9 248 triángulos de la botella, y
la escena de ejemplo es demasiado ligera para que 200 000 primitivas
exactas quepan en un 30 %. Lo que podría cumplirlo, para decidir: para los
rayos de cámara (todos salen del mismo punto con una cámara estenopeica),
una rejilla de pantalla con las partículas proyectadas, de modo que cada
rayo solo pruebe las de su píxel en lugar de recorrer la BVH; o topes por
defecto más bajos.

**Lo que no encajó con el plan.**
- **El ensanchado no escala la radiancia.** Multiplicar el sombreado por
  `área real / área ensanchada`, como dice S0 §4, oscurece lo que hay
  detrás del disco ensanchado (lo tapa entero): medido, −5,6 % en la
  imagen de prueba. Con cobertura `c` el rayo se sombrea con probabilidad
  `q = max(c, ½)` y peso `c/q`, o sigue de largo con peso `(1 − c)/(1 − q)`:
  la esperanza es la de la partícula exacta (test del criterio 4).
- **Las partículas no son un nodo de la TLAS** (S0 §4): cada conjunto se
  recorre después de la BVH de instancias, con el rayo ya acotado por la
  pieza más cercana (y un rayo de sombra mira antes las piezas). Fue lo
  más rápido de lo medido (hojas de 1 y conjuntos después: de 8,8× a
  4,4×), y la BVH de un conjunto no depende de la cámara: se rellena con
  el margen del ensanchado.
- **`FXAM` tiene 64 B más** que los campos de este apartado: `gravity`,
  `energy`, `spin` y una paleta de 4 tintes (los mandos *Gravedad* y
  *Energía*, el giro de los copos y los colores del confeti no tenían
  campo). Los primeros 128 B son los del plan, en su orden; dentro de los
  256 B. Las banderas son positivas (1 cámara, 2 reflejos, 4 sombra), no
  como el bit 2 de `LGHT` (*sin* sombra). La banda la aplica el escritor
  TypeScript a la caja (escribe 0, 0); el motor la respeta igual.
- `rt-sim` no puede depender de `rt-core` (es al revés): comparte
  `fmath.rs` y `rng.rs` compilándolos por `#[path]`, y un test de `rt-core`
  comprueba que dan los mismos bits.
- **E12 no está hecha** (dependencia del plan): la NEE desde las partículas
  usa la elección de luces que hay. Con muchos focos y 100 k partículas
  habrá más ruido que el que tendrá con E12.
- Un disco es siempre pared fina; la nieve con «`absorption` corto» es un
  difuso blanco fino con un 30 % de transmisión, porque un copo plano no
  tiene interior. *Energía* es la velocidad de nacimiento (m/s), que se
  relaja hacia la caída.
- La sección va tras *Entorno* (que ya iba tras *Luz*) y antes de
  *Cámara*. La fila del tope está en el bloque *Motor* de *Ajustes* (tras
  SIMD), para no partir los bloques.
- El selector del visor no coge partículas (un clic sigue cogiendo piezas).
  La guarda del post-procesado IA ve los materiales de los efectos como
  *Por defecto* y sus `partId` no nombran ningún nodo.
- `tests/project.test.ts` comparaba el estado de `parseProject` con el de
  `loadProject` incluidos los resultados del Doctor, que `loadProject`
  vuelve a pasar con los chequeos de esta versión: con `particles` nuevo ya
  no coinciden en un archivo anterior. La comparación deja fuera esos
  resultados y comprueba que son los de esta versión.
- **Lo que CI no tiene todavía** (`.github/` no se toca en esta fase): en el
  trabajo del motor, `rt --write-ambient-example` y `wasm-parity.mjs
  --expect 415d7d74 --expect-particles e38b8480` sobre esa escena, y
  `tests/effects-rsb.test.ts` en el paso del `rt.wasm` real.

**Valores de los presets** (regla 11; `src/data/effects.ts`; propuestos
con la hoja y **aceptados** en el veredicto). Densidades fotográficas, no
físicas: la región es la caja del
producto con su margen (o la esfera de la nube) y la cámara no ve más que
eso. Sobre la botella del ejemplo (12,7 l de región; 1,6 l de nube):

| Preset | Densidad (/m³) → partículas | Tamaño | Forma | Caída (m/s) | Otros | Material | Sombra |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Motas de polvo | 150 000 → 1 912 | 0,2 mm ± 60 % | esfera | 0,3 × 0,05 g | energía 0,02, caos 30 %, escala 80 mm, viento 0,02 | difuso claro, rugosidad 0,35 | no |
| Polen | 40 000 → 510 | 0,3 mm ± 40 % | esfera | 0,2 × 0,1 g | energía 0,03, caos 40 %, viento 0,05 a 20° | difuso amarillento 0,6 | no |
| Lluvia | 20 000 → 255 | 1,2 mm ± 40 % | estela 12 ms | 6,5 ± 20 % | caos 5 %, viento 1 | vidrio, ior 1,33 | no |
| Nieve | 12 000 → 153 | 4 mm ± 50 % | copo | 1 ± 30 % | giro 0,5, viento 0,4 a 30° | blanco fino, 30 % transmisión | sí |
| Polvareda | 3 000 000 → 4 889 | 0,3 mm ± 60 % | esfera | 0,1 × 0,2 g | nube 0,6 tamaños de pieza, suavidad 0,6, energía 0,3, caos 80 % | difuso pardo 0,8 | no |
| Ceniza | 15 000 → 191 | 1,5 mm ± 60 % | copo | 0,4 | giro 0,8, viento 0,3 a 200° | casi negro 0,85 | no |
| Burbujas | 10 000 → 127 | 2,5 mm ± 60 % | esfera | 0,25 × −1 g | energía 0,05 | vidrio fino | no |
| Confeti | 5 000 → 64 | 8 mm ± 30 % | copo | 0,8 ± 40 % | giro 1,5, 4 tintes | papel 0,5 | sí |

**Para el veredicto, de la hoja**: el polvo a contraluz **apenas brilla**
en el haz. Una esfera opaca y difusa iluminada por detrás enseña su lado
oscuro, el especular de rugosidad 0,35 da un borde muy fino, y una de
0,2 mm a 512 px queda en el tamaño mínimo (su cobertura reparte la
energía); probé un difuso fino con 60 % de transmisión y no cambia nada a
ojo (la transmisión fina es especular y la NEE no la ve). El «polvo en el
haz» de las fotos es dispersión hacia delante: o un lóbulo propio para
las partículas, o esperar a los medios de E9b / S5. La lluvia a contraluz
sí se enciende en el haz.

**Veredicto del responsable** (14-10).

1. **Coste** (criterio 5): el ≤ 1,3× vale a las densidades de los
   presets, no al tope de 200 000. Por la curva medida (20 000 → 1,8×,
   200 000 → 3,2×), los presets sobre la botella (≈ 1 900 motas, 4 900
   granos de polvareda) deberían quedar cerca de 1,1×, pero es una
   estimación: S4b lo mide primero. La BVH de las partículas se queda; la
   rejilla de pantalla para los rayos de cámara estenopeicos es lo primero
   de S4b solo si una escena de preset medida pasa de 1,3×. El tope por
   defecto se queda como está.
2. **Densidades de los presets**: aceptadas como se propusieron
   (fotográficas, no físicas). La tabla de arriba deja de ser una
   propuesta.
3. **Polvo a contraluz**: aceptado por ahora. S4b da a las motas de polvo,
   al polen y a la polvareda un lóbulo de dispersión hacia delante para
   que un haz las encienda: en la hoja, `DUST_MOTES-back` casi no se ve a
   512 px, y «cómo reflejan las luces» es lo que se pidió. La lluvia que se
   enciende en el haz ya está bien.
4. **Los puntitos de la lluvia con la clave lateral**: S4b. Las gotas no
   hacen cáusticas (un rayo de sombra que cruza una gota pasa con su
   cobertura y sin refracción), la regla habitual para partículas
   refractivas pequeñas; la refracción se queda para los rayos de cámara.
5. El ensanchado por probabilidad en lugar de escalar por el área, `FXAM`
   de 192 B, los conjuntos de partículas después de la BVH de instancias,
   el sitio (*Ambiente* tras *Entorno*, el tope en el bloque del motor),
   las matemáticas compartidas por `#[path]` y el cambio del test del
   proyecto: aceptados como se anotan.
6. Las líneas de CI que faltan las añade el responsable a
   `.github/workflows/engine.yml` al fusionar.

## S4b · Partículas: lóbulo hacia delante, lluvia sin cáusticas y coste medido — Opus — hecha

**Qué** (del veredicto de S4a):

1. **El coste a las densidades de los presets, medido primero.**
   `tools/ambient-sheet.mjs` gana una escena de coste por preset, a la
   cuenta del preset sobre la botella del ejemplo (además de la de
   200 000), con su cociente frente a la escena sin efecto en rondas
   alternadas. Criterio: ≤ 1,3× por muestra en cada preset. Solo si alguno
   pasa de 1,3×, lo primero de la fase es una rejilla de pantalla para los
   rayos de cámara de una cámara estenopeica (las partículas proyectadas;
   cada rayo prueba las de su píxel en lugar de recorrer la BVH). La BVH de
   las partículas se queda para los demás rayos; el tope por defecto no
   cambia.
2. **Un lóbulo hacia delante** para `DUST_MOTES`, `POLLEN` y `DUST_CLOUD`:
   dispersión de Henyey–Greenstein con g ≈ 0,7 (Henyey y Greenstein,
   *Diffuse radiation in the galaxy*, ApJ 1941; literatura pública), un
   lóbulo más del material de la partícula, muestreado y evaluado con el
   MIS de la NEE de E12, para que un foco detrás del producto las encienda
   en su haz. Criterio: `DUST_MOTES-back` de la hoja se ve; la energía se
   conserva (test).
3. **Gotas sin cáusticas**: un rayo de sombra que cruza una partícula
   refractiva pequeña (lluvia, burbujas) pasa con su cobertura y sin
   refracción; la refracción se queda para los rayos de cámara. Criterio:
   los puntitos de `RAIN-side` de la hoja desaparecen y la lluvia a
   contraluz no cambia a ojo.

**Depende de.** S4a, E12.

**Hecho.**

**1. El coste, medido primero.** `tools/ambient-sheet.mjs` gana una escena
de coste por preset (`cost-<CLAVE>`: el preset a su densidad sobre la
botella del ejemplo, con la clave lateral, como las de la hoja), además de
la de 200 000 motas, y las mide en **rondas alternadas**: cada ronda
renderiza la escena sin efecto y enseguida la del efecto (así la carga de
la máquina compartida pesa igual en las dos), su cociente es el coste por
muestra de esa ronda (las mismas muestras; la evaluación de las partículas,
una vez por carga, aparte) y la hoja da la mediana (`--rounds`,
`--cost-samples`, `--only cost`). Con el motor de S4a (512 × 288, 32 spp,
2 hilos, 3 rondas; `out/s4b-cost-before`, el binario de `09d8196`):

| Preset (partículas) | Rondas | Mediana |
| --- | --- | --- |
| Motas de polvo (1 912) | 1,15 / 1,28 / 1,18 | 1,18× |
| Polen (510) | 1,27 / 1,27 / 1,05 | 1,27× |
| **Lluvia (255)** | 2,08 / 1,76 / 2,02 | **2,02×** |
| Nieve (153) | 1,07 / 1,18 / 1,21 | 1,18× |
| Polvareda (4 889) | 1,37 / 1,14 / 1,08 | 1,14× |
| Ceniza (191) | 1,11 / 1,06 / 1,04 | 1,06× |
| Burbujas (127) | 1,24 / 1,19 / 1,14 | 1,19× |
| Confeti (64) | 1,07 / 1,11 / 1,14 | 1,11× |
| 200 000 motas (el tope, no un preset) | 2,93 / 2,70 / 2,99 | 2,93× |

La lluvia pasa de 1,3×, así que lo primero fue la **rejilla de pantalla**
(`geometry::particles`, `ScreenGrid`): con una cámara en perspectiva cada
conjunto guarda una rejilla de celdas de 4 px sobre la imagen (celdas
mayores si pasaría de 2²⁰) con, por celda, las partículas cuya caja
(ensanchada como la ven los rayos de cámara, con el margen de redondeo de
las cajas de la BVH, y una cápsula larga en hasta 32 trozos a lo largo de
su eje) proyecta en ella; un rayo de cámara prueba las de su celda (y las
que tocan el plano de la cámara, que prueba todo rayo) en lugar de
recorrer la BVH, con la misma prueba y el mismo orden: el mismo impacto,
bit a bit. Una caja delante de la cámara proyecta dentro de la envolvente
de sus esquinas y todo punto de un rayo que sale del centro proyecta donde
su dirección, así que la celda tiene todo lo que el rayo puede tocar. La
BVH se queda para los demás rayos; el tope por defecto no cambia.
**Pero la cámara del ejemplo y de la hoja (la de todo proyecto nuevo) es
una lente fina a f/5,6**, cuyos rayos no salen de un punto: la rejilla de
una estenopeica no la habría usado nunca (medido: 0 candidatos). Se
generaliza sin perder la exactitud: un rayo que sale del disco de la
apertura (radio `R`) y cruza el plano de foco (profundidad `z_f`) en `F`
pasa, a la profundidad `z`, a menos de `R |1/z − 1/z_f|` (en tangente) de
la proyección de `F`; cada rectángulo crece con ese círculo de confusión en
la peor profundidad de su caja y el rayo busca la celda de `F`. Un rayo que
no sale del disco (una lente trazada, la continuación desde un recorte)
recorre la BVH. La rejilla prueba todas las candidatas de la celda y la BVH
para en el impacto más cercano: una celda de más de 128 partículas
(`GRID_MAX_CANDIDATES`) manda su rayo a la BVH (sin tope, 200 000 motas a
128 × 72 costaban 721 M de instrucciones por muestra frente a 147 M sin
rejilla; medido el rayo de cámara de esas motas con topes de 16, 64, 128,
256 y ninguno, a 128 × 72, 512 × 288 y 1920 × 1080, 128 es el mejor o
empata con la BVH en los tres: 1 355, 457 y 153 ns frente a 1 313, 1 137 y
550 con 16). En la escena de coste de la lluvia, la rejilla deja 1,8
partículas candidatas por rayo de cámara.

Con la rejilla, el lóbulo y las gotas de abajo, y la cápsula que descarta
antes el rayo que no toca su cilindro infinito, el coste a las densidades
de los presets (el mismo método, 5 rondas, el binario final;
`out/ambient-sheet`, carga ≈ 2,8 en 4 núcleos) y, para quitar el ruido de
la máquina compartida, las **instrucciones por muestra** (*valgrind*,
deterministas: 3 spp menos 1 spp a 512 × 288, un hilo; antes, el binario de
`09d8196`):

| Preset (partículas) | Tiempo, rondas | Tiempo | Instrucciones, S4a | Instrucciones, S4b |
| --- | --- | --- | --- | --- |
| Motas de polvo (1 912) | 1,07 / 1,07 / 1,06 / 0,93 / 1,09 | 1,07× | 1,22× | 1,08× |
| Polen (510) | 1,02 / 1,10 / 1,14 / 1,07 / 1,05 | 1,07× | 1,15× | 1,07× |
| **Lluvia (255)** | 1,76 / 1,63 / 1,62 / 1,63 / 1,77 | **1,63×** | 1,75× | **1,50×** |
| Nieve (153) | 1,18 / 1,19 / 1,16 / 1,22 / 1,21 | 1,19× | 1,17× | 1,15× |
| Polvareda (4 889) | 1,15 / 1,14 / 1,09 / 1,13 / 1,09 | 1,13× | 1,21× | 1,10× |
| Ceniza (191) | 1,09 / 1,06 / 1,09 / 1,12 / 1,12 | 1,09× | 1,11× | 1,07× |
| Burbujas (127) | 1,13 / 1,03 / 1,18 / 1,09 / 1,21 | 1,13× | 1,11× | 1,10× |
| Confeti (64) | 1,11 / 1,16 / 1,14 / 1,07 / 1,10 | 1,11× | 1,11× | 1,11× |
| 200 000 motas (el tope, no un preset) | 2,00 / 1,94 / 2,08 / 1,91 / 1,91 | 1,94× | 2,17× | 1,94× |

Todos los presets quedan por debajo de 1,3× menos la lluvia. La escena sin
efecto pasa de 874,2 M a 879,5 M instrucciones por muestra (+0,61 %: las
comprobaciones nuevas del integrador; se saltan sin partículas y las
entradas del BSDF van en línea), con los mismos píxeles. La nieve, la ceniza
y el confeti son discos opacos: ni la rejilla ni nada de S4b les cambia gran
cosa.

**Por qué la lluvia sigue por encima** (contado con contadores en una copia
del motor, 512 × 288, 8 spp): sin efecto, la mayoría de los rayos de cámara
salen al fondo (1 179 648 rayos de cámara y 124 644 vértices sombreados);
con la lluvia, las estelas cubren el 26 % del cuadro y cada rayo de cámara
que toca una gota da dos vértices de vidrio (entrar y salir) y los rayos
que siguen: los vértices de las gotas solas son 699 326, 5,6 veces todos los
de la escena sin efecto. Es el transporte
de luz de un cuarto del cuadro de vidrio, no el recorrido de la BVH (la
rejilla lo dejó en 1,8 candidatas por rayo de cámara y 1,7 hojas por
recorrido de los rayos que siguen, a 10 spp). Lo que quedaba de trabajo inútil se
quitó: en una partícula clara y lisa (`is_mirror`: rugosidad al mínimo, sin
metal ni difuso) la estimación de siguiente evento solo busca luces delta
y las demás las encuentra su rayo BSDF, que cuenta lo que encuentra entero
(una densidad infinita en el MIS: la heurística de potencia da 1); la NEE
de un lóbulo de α = 10⁻³ no encontraba casi nada y trazaba un rayo de
sombra por vértice. Se probó acotar el rayo que entra en una gota por su
propia salida (exacto, con vuelta a la búsqueda entera): 0,7 % de las
instrucciones, se quitó.

**2. Lóbulo hacia delante** (`bsdf::forward`, con la cita de Henyey y
Greenstein, *Diffuse radiation in the galaxy*, ApJ 93, 1941). Un lóbulo
más del BSDF de la partícula: `(1 − s)·superficie + s·albedo·p(μ)/|cos θi|`
con `p(μ) = (1 − g²)/(4π (1 + g² − 2gμ)^{3/2})`, `μ = −wi·wo` (el coseno
entre la dirección de la luz antes y después), por unidad de radiancia y
ángulo sólido, sea cual sea la normal del punto tocado (la partícula
dispersa como una pequeña nube, no como una superficie; de ahí el
`1/|cos θi|`, que el integrador vuelve a multiplicar). Se elige con
probabilidad `s` y dentro `μ` por la inversa de su distribución acumulada
(isótropo si `|g| < 10⁻³`, el acimut uniforme, `sin`/`cos` de `fmath`);
`Bsdf::pdf` es la densidad de la mezcla, que es lo que el MIS de la NEE de
E12 pondera; la NEE lo evalúa con todas las luces (también las que no son
`glossy`, como el difuso). Sus rayos que atraviesan la partícula, y sus
rayos de sombra, salen de su cara del fondo (de la partícula ensanchada si
la tocó un rayo de cámara). `FXAM` crece a 200 B: `forward` (la cuota `s`,
0..1) y `forward_g` (−1 < g < 1); una carga de 192 B (S4a) no tiene
lóbulo. En la interfaz es parte del material propio del efecto
(`EffectMaterial.forward`, `forwardG`): g 0,7 en el polvo, el polen y la
polvareda, **cuota 0,5 (propuesta, regla 11)**, 0 en los demás; con un
material del catálogo, o uno transparente, ninguno (el motor no distinguiría
sus rayos de la refracción); un efecto guardado antes de S4b toma el de su
preset al abrirse. La escena de paridad (`example::ambient_scene`) lo da a
su polvo. `DUST_MOTES-back` se ve (hoja, arriba): las motas del haz
brillan donde antes casi no; con la clave lateral, la media de la imagen
pasa de 24,64 a 24,57 (de 255).

**3. Gotas sin cáusticas.** Una partícula de material claro
(`is_clear_material`: `(1 − metálico)·transmisión ≥ ½`, sin emisión:
lluvia, burbujas) la cruzan **rectas, enteras y sin refracción** los rayos
de sombra (si el efecto proyecta sombra, ahora la atraviesa: `passable`) y
los rayos de un camino que ya rebotó en un lóbulo ancho
(`RayClass::Rough`, `Tracer::trace_rough`: densidad de la muestra BSDF <
`SHARP_PDF` = 100 sr⁻¹, más ancho que un GGX de rugosidad ≈ 0,15), con la
transmitancia recta de una pared fina de su material (la de Fresnel de las
dos caras y su tinte, una vez) y desde más allá de su cara del fondo
(`Prepared::straight_through`); un rayo de esa clase solo ve el efecto si
proyecta sombra, y su cruce es un suceso recto (conserva la densidad y la
selección de luces del último vértice para el MIS). La cámara y los
caminos de lóbulos estrechos desde ella (un espejo, el vidrio liso de la
botella) siguen viendo las gotas refractar. Los fotones de las cáusticas
ya paraban en las partículas (no están entre las piezas que las enfocan,
S4a). En
`RAIN-side` desaparecen los puntitos del cuerpo y la etiqueta de la
botella y del suelo (hoja, recorte); `RAIN-back` no cambia a ojo.

**Tests** (cada uno con su mutación, en una copia del motor: las quince
lo hacen fallar, y pasan sin ella):
- `geometry::particles::grid_tests::camera_rays_find_through_the_screen_grid_what_brute_force_finds`
  (estenopeica, f/2 a 900 mm y f/1,4 a 300 mm; esferas, discos y cápsulas
  de 600 partículas, motas ensanchadas, algunas en el plano de la cámara o
  detrás; 6 000 rayos, también fuera del cuadro, por la rejilla, el mismo
  impacto que la fuerza bruta; un rayo que no sale de la lente, por la BVH;
  y una multitud de 40 000 cuyas celdas llenas mandan sus rayos a la BVH,
  con el mismo impacto). Mutaciones: sin el círculo de confusión; sin las
  partículas del plano de la cámara.
- `bsdf::forward::tests`: la fase integra 1 con `g` de coseno medio (g 0;
  0,3; 0,7; −0,5; 0,95); el muestreo da su densidad (histograma de `μ` a
  5σ); el horno blanco del BSDF (Lambert blanco y lóbulo blanco de cuota
  0,25, 0,5 y 1: 1 ± 1 % desde 0°, 45° y 80°) y la mezcla del polvo
  (`(1 − s)·superficie + s·color`, ± 1,5 %); pesos `f |cos| / pdf` y la
  densidad de la mezcla integra 1 en la esfera; sin lóbulo, los números de
  la superficie bit a bit. Mutaciones: la densidad sin el lóbulo; la
  evaluación sin `1/|cos θi|`.
- `integrator::particle_tests` (nuevo): `the_forward_lobe_is_unbiased_with_either_technique_and_with_both`
  (una mota blanca de 120 mm con una esfera de luz detrás y a un lado: MIS
  2,38148, solo NEE 2,38179, solo BSDF 2,38721; 4096 spp, 8 × 8; la mota
  proyecta sombra, así que prueba también que sus rayos salen de su cara
  del fondo); `a_white_mote_with_a_forward_lobe_vanishes_in_the_white_furnace`
  (cuota 0,5: 0,99997; 1: 1,00014); `a_light_behind_a_mote_lights_it_through_its_forward_lobe`
  (0,050 sin lóbulo, 2,38 con él); `rough_paths_do_not_see_a_drop_that_casts_no_shadow`
  (el suelo bajo una gota sin sombra es el suelo sin ella, bit a bit);
  `shadow_rays_cross_a_drop_straight_with_its_transmittance` (bajo la gota,
  0,9585 de la luz sin ella; la cuenta, `(1 − R)/(1 + R)` = 0,9607);
  `rough_paths_cross_a_drop_that_casts_shadows_as_shadow_rays_do` (una gota
  grande bajo un panel: MIS 2,18132, solo NEE 2,18133, solo BSDF 2,18051, y
  menos luz que sin ella); `camera_rays_still_see_a_drop_refract` (una bola
  de agua delante de una pared con la mitad izquierda encendida: la cámara
  la ve al revés, 0 a la izquierda y 0,956 a la derecha);
  `smooth_drops_leave_their_lights_to_their_bsdf_rays_without_bias`
  (10,85212 con la regla, 10,85208 con la NEE en la gota). Mutaciones: el
  rayo áspero ve la gota sin sombra; el rayo áspero refracta; el rayo de
  sombra la toma por sólida; cruza cada cara; no es `passable`; los rayos
  de sombra y los del lóbulo desde dentro de la mota; sin lóbulo; todo
  camino sigue nítido; la cámara la cruza recta; la regla de las gotas
  lisas con densidad 0.
- `rt-sim::params`: la carga de 200 B con sus desplazamientos, la de 192 B
  sin lóbulo, cuota fuera de 0..1 y `g` fuera de (−1, 1) rechazadas.
- TypeScript: `tests/effects.test.ts` (qué presets mandan el lóbulo, ninguno
  con un material del catálogo o transparente, los límites, un efecto de
  antes de S4b toma el de su preset) y `tests/effects-rsb.test.ts` (la carga
  byte a byte frente a la de `rt --write-ambient-example`, con el lóbulo
  del polvo).

***Hashes***: `PINNED_AMBIENT_4SPP` `0xeb60bea2` → `0x8f9efac8` (el lóbulo de
su polvo y su lluvia de vidrio, que proyecta sombra, cruzada recta por los
rayos de sombra y los ásperos), el mismo en escalar, SSE2, AVX2, en WASI
escalar y `simd128` y en el `rt.wasm` real (`wasm-parity.mjs`); las
partículas, `PINNED_AMBIENT_PARTICLES` `0xe38b8480`, no se mueven; ningún
otro *hash* se mueve (sin partículas, las escenas no cambian un bit). En
`engine.yml` el bloque de paridad de *Ambiente* lee los dos *pins* del
fuente; solo cambia su comentario.

**Hoja** `out/ambient-sheet.html` (512 × 288, 128 spp, 2 hilos): arriba,
antes y después (el binario de `09d8196` frente a este, `--rt-before`) de
`DUST_MOTES-back`, `POLLEN-back`, `DUST_CLOUD-back`, `DUST_MOTES-side`,
`RAIN-side` y `RAIN-back`, cada par con un recorte ×2; los ocho presets con
las dos luces; las motas con cuotas 0,25, 0,75 y 1 (las de arriba tienen
0,5); `RAIN-side` a 1 024 spp; las estelas y las suavidades de S4a; la
tabla de coste.

**Qué no encajó con el plan.**
- **La rejilla de una cámara estenopeica no habría servido**: la cámara de
  todo proyecto nuevo (y la de la hoja) tiene f/5,6. Se hizo para la lente
  fina también, exacta (arriba); sin ella el criterio no se habría movido.
- **La lluvia sigue por encima de 1,3×** (1,63× en tiempo, 1,50× en
  instrucciones, arriba): su coste es
  sombrear el vidrio que cubre un cuarto del cuadro, no recorrer la BVH. Lo
  que la bajaría ya no es exacto ni barato (estelas más cortas o menos
  densas, o gotas de cámara más sencillas): para el veredicto.
- **Los puntitos de `RAIN-side` tenían dos fuentes.** La que pedía el
  veredicto (las cáusticas: rayos del cuerpo y la etiqueta de la botella y
  del suelo que refractaban por las gotas hasta la clave) desaparece. La
  otra se queda, porque es la refracción que el veredicto conserva: la
  clave vista **a través de cada gota** por la cámara es un detalle
  diminuto y brillante dentro de cada estela, y a 128 spp sale granulado;
  converge (`RAIN-side` a 1 024 spp, en la hoja: las estelas salen
  lisas). Para el veredicto.
- **«Pasa con su cobertura»**: leído como la transmitancia recta de una
  pared fina de su material (Fresnel de las dos caras, una vez). Y no solo
  los rayos de sombra: la lluvia del preset no proyecta sombra, así que
  cambiar solo esos no tocaba los puntitos; los rayos BSDF del suelo y de
  la botella que la cruzan tienen que hacer lo mismo para que la NEE y el
  BSDF estimen lo mismo (test de las tres técnicas).
- **«La refracción se queda para los rayos de cámara»**: extendido a los
  caminos de lóbulos estrechos desde la cámara (`SHARP_PDF`), para que la
  lluvia se siga viendo a través del vidrio de la botella y en los
  espejos; con la regla estricta desaparecería ahí. Para el veredicto.
- **La regla de las gotas lisas** (NEE solo de luces delta) no estaba en
  el *brief*: sale del recuento de la lluvia; no cambia la media (test).
- **El lóbulo viaja en `FXAM`, no en `MATL`**: es del efecto (su material
  propio), `MATL` es el de las piezas (y lo está cambiando M2b); solo con
  material opaco. *Rápido* no lo enseña (los puntos de la vista previa).
- La cápsula descarta el rayo que no toca su cilindro infinito antes de
  calcular raíces (−2 % de las instrucciones de la lluvia); la cota del
  rayo que entra en una gota se probó y se quitó (0,7 %).
- **TRIAGE 1.2** (forma de gota y geometrías variadas, decisión pendiente,
  regla 11; no se hizo): lo que deja hecho S4b: la rejilla y la BVH son
  por conjunto y ya parten una cápsula en trozos (`camera_boxes`), así que
  una forma nueva solo necesita su prueba de impacto, su normal, su salida
  (`exit`) y sus cajas; la mezcla de formas por partícula sería un código
  de forma por partícula en `rt-sim` y en `ParticleSet` (todas las rutas
  ya despachan por forma en `hit`, `exit` y `normal`); y una gota en
  lágrima de agua sería clara (`is_clear_material`) y lisa (`is_mirror`),
  así que heredaría las reglas de cáusticas y de NEE sin tocarlas.

**Para el veredicto** (regla 11):
1. La **cuota del lóbulo**: 0,5 propuesta; la hoja tiene 0,25, 0,75 y 1
   con las dos luces. Con más cuota, las motas del haz brillan más y las de
   la clave lateral pierden algo de su difuso.
2. El **coste de la lluvia** (1,63× en tiempo, 1,50× en instrucciones):
   aceptarlo, o estelas más cortas o menos densas en el preset, o una gota
   de cámara más sencilla.
3. El **grano dentro de las estelas** con la clave lateral (la refracción
   que se queda): aceptarlo como ruido que converge o regularizarlo.
4. La **regla de los caminos nítidos** (`SHARP_PDF`) frente a «solo los
   rayos de cámara» estrictos.

## Físicas: cuerpos rígidos, telas y líquidos — decisión **Fable**

Petición del usuario (14-10): físicas realistas con *Iniciar / Parar*
propio (por defecto parado); «**Dejar caer**» en el menú contextual de un
modelo o sólido, con la simulación parándose sola cuando los sólidos se
quedan quietos; **telas** sobre una cara o un sólido de un modelo, con el
comportamiento según el **gramaje** y el tipo de tejido (un algodón fino
no se pliega como un cuero grueso) y la **rigidez** a elegir;
**líquidos** por viscosidad, pudiendo convertir un sólido en líquido; y
que todo sirva también para animaciones. Son S2, S9 y S7 de
`STUDIO-TOOLS.md` §5 y `docs/research/particles.md` §6. Decisiones:

1. **Dónde vive.** Un *crate* nuevo `engine/crates/rt-phys` (solo `std`,
   sin `unsafe`, determinista: `f32`, `fmath`, paso fijo de 1/240 s con
   4 subpasos, contactos ordenados por (id, id, rasgo), *hash* de las
   transformaciones igual con 1 y N hilos y nativo = wasm; v1 en un
   hilo). Un único marco de **dinámica por posiciones extendida (XPBD)**:
   rígidos (Müller, Macklin, Chentanez, Jeschke, Kim, "Detailed Rigid
   Body Simulation with Extended Position Based Dynamics", SCA 2020),
   telas (Macklin, Müller, Chentanez, "XPBD", MIG 2016), líquidos (PBF,
   Macklin y Müller 2013). Separado de `rt-sim` (S4a, sin estado).
2. **Dónde corre.** En la interfaz, en un *worker* por `rt-wasm`
   (`phys_*`): el visor Rápido enseña la simulación en vivo sin tocar el
   *store*; **Parar** confirma la pose actual como **una** acción
   deshacible; **Reiniciar** vuelve a la pose previa. Nativo no hace
   falta en v1 (el escritorio usa la misma interfaz).
3. **La barra de físicas** (abajo, junto a la de animación): ▶ Iniciar ·
   ⏸ Pausar / ▶ Reanudar · ■ Parar · ↺ Reiniciar, tiempo simulado,
   cuerpos despiertos, estado (*parado* por defecto). Pausar congela la
   simulación donde está (las telas, los líquidos y la lluvia son caros:
   el usuario decide cuándo seguir); Parar la confirma; Reiniciar la
   deshace. El medidor dice lo que el simulador dice
   (regla 10). Una sección **Físicas** en el inspector de pieza: papel
   (estático / dinámico / tela / líquido), masa por densidad (tabla por
   familia de material; se puede fijar), rozamiento, rebote, *como
   piezas* (un grupo cae como un cuerpo o cada pieza por su cuenta).
4. **Dormir.** Un cuerpo con velocidad bajo umbral durante 0,5 s duerme;
   con todos dormidos la simulación se para sola y confirma la pose.
5. **Animación.** **Toda simulación entra sola en la animación** (petición
   del usuario, 14-10): al iniciar, nace un clip de movimiento `PHYSICS`
   en la línea de tiempo (pista horneada: posiciones y cuaterniones por
   fotograma a los fps del proyecto, `f32`, guardada con el proyecto) que
   crece mientras la simulación corre, se queda donde se para y la línea
   de tiempo de N1 reproduce como cualquier otro clip; *Reiniciar* lo
   quita (deshacible). No hay un paso aparte de «grabar»: la foto fija
   usa el fotograma del cabezal, y la animación ya tiene la simulación. Las telas y los líquidos guardan su malla por
   fotograma en una caché junto al proyecto (clave = *hash* de
   parámetros + geometría + semilla + versión).
6. **Orden.** S2 ahora (base de todo); S9 y S7 después de S2, cuando la
   máquina lo permita (ocho agentes en paralelo ya la saturan).

### S2 · Cuerpos rígidos: «Dejar caer», la barra de físicas y grabar — **Opus** — hecha

**Qué.** `rt-phys` v1: cuerpos rígidos XPBD con **envolvente convexa**
automática por pieza (*quickhull* propio) para los dinámicos, y las
piezas estáticas y el suelo como mallas de triángulos (la BVH de
`rt-core`); contactos envolvente–envolvente (ejes separadores / GJK–EPA
propios) y envolvente–triángulos; rozamiento de Coulomb, restitución,
dormir (§4). Gravedad −Z (el modelo es Z-arriba), 9,81 m/s², mm en la
escena. `rt-wasm` exporta `phys_new(escena)`, `phys_step(n)`,
`phys_poses()`, `phys_awake()`. Interfaz: **Dejar caer** en el menú
contextual y en el menú *Pieza* (las piezas seleccionadas pasan a
dinámicas, el resto y el suelo a estáticos, arranca y se para sola al
dormir; con un grupo, *como piezas* decide), la barra de físicas (§3), la
sección *Físicas* del inspector (§3), *Grabar como animación* (§5) con el
clip `PHYSICS` en `src/core/animation.ts` y la barra en la línea de
tiempo. Doctor: avisa si una pieza dinámica atraviesa el suelo al
empezar. Cadenas es/en; cromo acromático; todo por el *store*.

**Depende de.** U3 (mover), U9 (primitivas), N1 (animación).

**Criterio.** Tests de `rt-phys`: una esfera cae sobre el suelo y
descansa a `z = r ± 0,1 mm`; una pila de tres cajas se queda apilada 5 s;
una caja inclinada 30° cae de lado y descansa plana; el cubo sobre una
esfera estática resbala y cae; mil esferas se asientan en < 20 s en
nativo, un hilo (el tiempo va en el párrafo del ROADMAP); dormir para la
simulación; *hash* de poses igual con 1 y N hilos y nativo = wasm;
tests de interfaz (mutación comprobada): *Dejar caer* es una sola acción
deshacible, *Reiniciar* restaura, el clip `PHYSICS` se guarda y se abre.
Comprobación de navegador `tools/physics-check.mjs` con capturas
`docs/ui/physics-bar.png`, `docs/ui/physics-drop.png` (antes/después de
dejar caer tres primitivas sobre el suelo) y un GIF o tira de 6
fotogramas `docs/ui/physics-drop-strip.png`. `SPEC.md` §3.1 y §3.7,
`UI.md`, `ARCHITECTURE.md` (crate `rt-phys`, el *worker*), CHANGELOG.

**Hecho.** En tres pasos:

- **`engine/crates/rt-phys`** (solo `std` y `rt-core`, `#![forbid(unsafe_code)]`):
  XPBD de Müller et al. (SCA 2020) a 1/240 s con 4 subpasos; envolvente
  convexa por *quickhull* propio (Barber et al. 1996, caras coplanarias
  fundidas por normal y por distancia al plano) con tope de 128 vértices y
  caja orientada por componentes principales de reserva; esferas
  reconocidas como tales (≥ 26 puntos al 0,2 % del radio) y tratadas como
  esferas exactas; contactos por ejes separadores con poda por el mapa de
  Gauss (Gregorius), recorte de Sutherland–Hodgman, ≤ 4 puntos, márgenes
  especulativos; rozamiento de Coulomb, restitución con el umbral 2|g|h,
  dormir y despertar; el formato PHY1; `World` (`add_floor`,
  `add_static_mesh`, `add_dynamic`, `step`, `poses`, `awake_count`,
  `settled`, `hash`). Once tests en `tests/rigid.rs`, los del criterio más
  una rampa (sostiene a μ 0,6, resbala a 0,1), la caída fijada por *hash*
  a 60, 90, 120 y 480 pasos (`tests/fixtures/phys-drop.json`) y el *hash*
  igual con 1, 2, 3, 5, 8 y 13 trozos de fase estrecha y con 3 hilos.
  **Mil esferas** (radio 10 mm, diez capas de diez por diez en una bandeja)
  se asientan en **1,70 s simulados**; en *release*, un hilo, **7,05 s**
  de reloj en la máquina virtual de 4 núcleos con otros siete agentes
  compilando (carga ~30; una medida anterior con menos carga dio 2,4 s de
  CPU).
- **`rt-wasm`**: `phys_new`, `phys_free`, `phys_step`, `phys_bodies`,
  `phys_ids`, `phys_poses`, `phys_awake`, `phys_settled`, `phys_steps`,
  `phys_hash`, sobre un registro de mundos por *handle*. Nativo = wasm:
  los tests de `rt-phys` pasan compilados a `wasm32-wasip1` con los mismos
  *hash*, y `tests/physics-engine.test.ts` repite la caída fijada con el
  `rt.wasm` real.
- **Interfaz**: `core/physics.ts` (papeles, densidad por familia de
  material, `physicsSpec`, las poses de vuelta a los nodos dentro de grupos
  girados y escalados, la pista `PHYSICS` y su ancla, las acciones
  `physics/*`), `io/phys.ts` (PHY1), `render/physics-worker.ts` y
  `physics.ts`, `ui/physics.ts` (la simulación en marcha), la barra de
  físicas, la sección *Físicas*, *Dejar caer* en el menú contextual, en el
  inspector y en la paleta, el clip `PHYSICS` en la línea de tiempo y el
  chequeo `physics` del Doctor (16 chequeos con el `aspect` de U13; 16 tipos
  de animación).
  `tests/physics.test.ts` (24 tests, cada uno comprobado reintroduciendo su
  error) y `tools/physics-check.mjs`, con las tres capturas.

**Lo que no encajó con el plan** (regla 12):

- **No hay menú *Pieza* en la cabecera.** *Dejar caer* está en el menú
  contextual (el mismo en el árbol y en el visor), en las secciones *Pieza*
  y *Físicas* del inspector y en la paleta.
- **«La BVH de `rt-core`»**: la de `rt-core` responde a rayos (anchura 4/8,
  SAH), no a «qué triángulos tocan esta caja»; `rt-phys` tiene la suya,
  pequeña (mediana, hojas de 4), y `rt-core` no se toca. **GJK–EPA** no
  hizo falta: ejes separadores para envolvente–envolvente y
  envolvente–triángulo, y esfera analítica. El suelo es un solo triángulo
  enorme: con dos, la diagonal sesgaba el rozamiento.
- **Desviaciones del artículo** que hicieron falta para que una caja quieta
  no derive ni gire y una pila de tres no se caiga: rozamiento por parche
  (en su centroide, con torsión por el radio del parche, y como mínimo un
  brazo de rodadura: una bola que giraba sobre su punto de apoyo no
  paraba) y no por punto;
  **anclas** de rozamiento estático que se guardan de paso a paso; el
  dinámico como impulso de como mucho μλ/h; los parches coplanarios de un
  cuerpo contra lo estático fundidos en uno; resistencia a la rodadura de
  0,02 r (una bola que rueda acaba parándose); dormir por recorrido en una
  ventana de 0,5 s y no por velocidad instantánea (el temblor de contacto
  no dejaba dormir nada); despertar solo por algo que se acerca deprisa
  (las cadenas de despertares no dejaban asentarse a las mil esferas).
- **El cubo sobre la esfera**: sobre una esfera teselada gruesa un cubo
  puede descansar de verdad en una faceta. El test usa una esfera de 32 × 64,
  μ 0,2 y el cubo un poco desplazado de la cumbre; resbala y cae.
- **El tiempo de las mil esferas** se exige (< 20 s) solo en *release*; en
  *debug* el test comprueba que se asientan.
- **Las exportaciones** son más que las cuatro del plan (`phys_new(escena)`,
  `phys_step(n)`, `phys_poses()`, `phys_awake()`): un *handle* por mundo y
  `phys_ids` (dónde quedó cada cuerpo; uno sin masa no se simula).
- **Grabar** (decisiones 3 y 5, cambiadas a mitad de fase): no hay botón
  *Grabar como animación*; toda simulación se graba sola en un clip
  `PHYSICS` por cuerpo que crece mientras corre. Por eso la decisión 2
  («el visor Rápido enseña la simulación en vivo sin tocar el *store*») se
  cumple a medias: los **nodos** no cambian hasta confirmar, pero los
  clips crecen y el cabezal los sigue por el *store* (`physics/grow`,
  `anim/playhead`, en el gesto de la simulación: una entrada de deshacer
  con el comienzo y la confirmación), y el visor la enseña por la
  animación. Mientras corre, el visor se queda en *Rápido*.
- **Pausar en una página cargada.** La comprobación del navegador encontró
  que, con el hilo principal ocupado, el *worker* acababa la simulación
  antes de que la página viera la pausa. Ahora la página acusa recibo de
  cada envío y el *worker* no va más de 1/8 s por delante (va más despacio
  en vez de acabar sin verse), lo que llega en pausa espera a *Reanudar*,
  *Parar* confirma la pose que se ve (no la que el simulador alcanzó
  después), y una pausa pedida antes de que el *worker* tenga la
  simulación le llega justo después. Con sus tests.
- **El ancla del clip** (no estaba en el plan): sin ella, un clip `PHYSICS`
  clavaba el nodo en sus fotogramas y la pieza ya no se podía mover después
  de una caída. El clip guarda la pose a la que se refiere (`anchor`) y se
  reproduce movido por lo que el nodo se haya movido desde entonces.
- **El cabezal en 0** (para el criterio de **Fable**): N1 enseña en 0 la
  escena como se edita, y tras una caída desde 0 la pose editada ya es la
  final, así que en 0 se veía la pieza en reposo y un fotograma después en
  el aire. Lo construido: en 0 los nodos que sostiene una simulación grabada
  enseñan su fotograma (también la foto fija: «usa el fotograma del
  cabezal»), el resto como se edita, y el *gizmo* no sale sobre esos nodos
  en 0 (como no sale con el cabezal pasado 0). La otra opción, cumplir N1 a
  rajatabla, es quitar `playheadPose` y su regla del *gizmo*.
- **Densidad por familia de material**: la tabla va por las siete
  `MATERIAL_CATEGORIES` (metal, plástico, madera, tela, vidrio, emisivo,
  otro), que es la clave estable que tiene cada material; los valores son
  típicos, para que **Fable** los revise.
- `migrateProject` (`io/project.ts`) vuelve a pasar el Doctor al abrir,
  como ya hacía `loadProject`: con un chequeo nuevo, un proyecto abierto
  por él traía los resultados de antes. La rama de la sesión hizo lo mismo
  (U13); al unir queda una sola vez, la suya, con el test de S2 que falla
  sin ella.
- CI no se toca (`.github/` queda fuera de la fase): la paridad nativo =
  wasm la comprueban los tests de `rt-phys` en `wasm32-wasip1` y
  `tests/physics-engine.test.ts` cuando hay `rt.wasm`.
- **Al unir la rama de la sesión** (N6, E12, U13, P6/P6b, O1, U12, L6,
  M2a, P5): el clip `PHYSICS` vive en la línea de tiempo de tres zonas de
  N6 (sus propiedades: inicio, duración, fin, repetir, invertir y la nota;
  sin cantidad ni curva), pasa por el mismo tiempo que cualquier clip
  (`clipPhase`: repetido, invertido) y `playheadPose` respeta
  `poseActive` de N6 (un clip invertido sostiene su final antes de
  empezar). El Doctor: los 14 de origen, `aspect` (U13) y `physics` (S2).

**Veredicto del responsable.**

1. **El cabezal en 0**: confirmado tal como está construido. En 0, los
   nodos que sostiene una simulación grabada enseñan el fotograma de su
   clip (en el visor y en la foto fija) y el *gizmo* no sale sobre ellos.
   Razón: el fotograma 0 de una animación renderizada tiene que ser el
   principio de la caída, y la foto fija sigue al cabezal, que una
   simulación deja al final, así que *Dejar caer* y renderizar da la pose
   en reposo; cumplir N1 a rajatabla metería un salto entre los fotogramas
   0 y 1 de toda animación. Se quedan `playheadPose` y la regla del
   *gizmo*.
2. **Densidades por familia de material**: aceptadas como valores
   típicos; se revisan con las fases de materiales (M4), no ahora.
3. **La decisión 2 a medias** (los clips crecen por el *store*, dentro de
   la única entrada de deshacer de la simulación): aceptado. Es justo lo
   que pide «toda simulación se graba sola», y una entrada de deshacer es
   lo correcto.
4. El resto de lo anotado (del menú *Pieza* a la paridad sin tocar CI):
   aceptado tal cual. El Doctor que se vuelve a pasar en `migrateProject`
   se queda, con su test.

### S9 · Telas con físicas reales — **Opus** (tras S2)

**Qué.** Tela XPBD (distancia, flexión por diedro, área opcional) sobre
**una cara** (la malla de la pieza elegida o de la cara seleccionada por
niveles) o **un sólido** (su cáscara, con presión para cerrados: cojín,
envase blando). Presets por **tipo de tejido y gramaje** (`src/data/
fabrics.ts`, claves estables: seda 60 g/m², algodón fino 120, popelín
150, lino 200, lana 300, vaquero 400, lona 600, fieltro 800, cuero fino
900, cuero grueso 1 200, neopreno 1 500…) con masa por área, rigidez de
estiramiento, de flexión y amortiguación; **Rigidez** y **Gramaje**
editables por encima del preset, y *Grosor* para la colisión. Colisión
con las piezas estáticas y los rígidos de S2, autocolisión por rejilla
de dispersión, anclajes (por selección de vértices en caja o por la
arista superior), viento de S4a. Preset *Caer sobre la pieza* (un plano
de tela sobre el producto). La barra de físicas y *Grabar* de S2; la
malla de la tela por fotograma en la caché (§5). **El sombreado del
tejido es M5**, no esta fase.

**Criterio.** Un paño de 1 m cuelga de dos esquinas y su punto más bajo
queda dentro del 2 % de la catenaria analítica para el gramaje; la seda
y el cuero grueso, con el mismo paño sobre la esfera, dan arrugas de
distinta escala (métrica: curvatura media; la seda ≥ 3× la del cuero);
nada atraviesa la esfera (test de distancia mínima); determinismo;
hoja `out/cloth-sheet.html` con los presets sobre la botella del ejemplo.

### S7 · Líquidos — **Opus** (tras S2 y el dieléctrico anidado)

**Qué.** Fluido de posiciones (PBF) con viscosidad (XSPH), cohesión y
tensión superficial; presets (`src/data/liquids.ts`: agua, aceite,
miel, leche, gel, sirope…) con densidad, viscosidad y color/absorción;
**Convertir en líquido** en el menú contextual: la pieza se rellena de
partículas por paridad de rayos, se oculta y nace una pieza *Líquido*
cuya superficie se reconstruye por cubos marchantes cada fotograma (en
el *worker*); los recipientes son las piezas estáticas. Motor:
**dieléctricos anidados** por prioridad (Schmidt y Budge, "Simple Nested
Dielectrics in Ray Traced Images", JGT 2002) para líquido dentro de
vidrio; material vidrio con absorción. Barra, *Grabar* y caché de S2.

**Criterio.** Un litro vertido en un vaso cerrado conserva el volumen
± 3 %; la miel tarda ≥ 5× más que el agua en nivelarse (test); nada
atraviesa el vaso; determinismo; hoja `out/liquid-sheet.html`.

### S3 · Lluvia y polvo sobre el set y sobre la lente — **Opus** (tras S4a y S2) — hecha la primera parte (la gota, la mezcla de formas y el cristal frontal); la segunda, S3b (el cristal alimentado por la escena); el resto, S3c

Petición del usuario (14-10): la lluvia de S4a cayendo sobre el set y la
pieza y **resbalando** de forma realista; el polvo **asentándose**; y que
gotas y polvo puedan afectar **a la lente** o no, como un cristal por
delante. Es cálculo caro: va en el *worker* de físicas con Pausar /
Reanudar, con caché y entra solo en la animación (§3 y §5 de arriba).

**Qué.**
1. **Gotas sobre superficies.** Una partícula de lluvia de S4a que toca
   una superficie (su recorrido es determinista por semilla: los
   aterrizajes son eventos reproducibles) nace como **gota**: casquete
   esférico pegado a la superficie (esfera con el centro bajo ella, el
   motor ya traza esferas: S4a), con material agua (vidrio IOR 1,33). Las
   gotas **crecen al juntarse**, quedan **ancladas** por la histéresis
   del ángulo de contacto del material (mojabilidad por familia:
   vidrio, plástico, metal, papel, pintura; tabla en `src/data/`) y
   **resbalan** cuando su peso a lo largo de la tangente la vence,
   dejando un **rastro mojado** (película fina: baja la rugosidad y
   oscurece lo poroso: máscara de humedad en el material) y recogiendo
   las gotas que encuentran; en una arista **gotean** (vuelven a ser
   partículas que caen) y al chocar salpican (gotas secundarias). Nieve:
   se acumula como capa (perfil de S4a) y no resbala.
2. **Polvo asentado.** Campo de cobertura por superficie (rejilla de
   téxeles por pieza o por vértice) que acumula lo que el flujo de polvo
   de S4a deposita (exposición hacia arriba × tiempo × densidad), con
   **ángulo de reposo** (de las caras empinadas se desprende) y que la
   lluvia **limpia** por donde pasa el rastro. Se renderiza como capa
   (difuso grisáceo que sube la rugosidad, mezclado por cobertura) con
   motas visibles (discos minúsculos de S4a donde la cobertura es alta).
3. **El cristal de la lente.** En Cámara ▸ Lente ▸ Filtros, **Cristal
   frontal** (sí/no): una lámina pegada a la cámara a la distancia del
   elemento frontal (20–40 mm de la pupila, según la lente) sobre la que
   caen la lluvia y el polvo de los efectos de la escena con los mismos
   modelos (las gotas resbalan según el *arriba* de la cámara; el polvo
   se asienta si mira hacia arriba). Es **geometría real** delante del
   objetivo: los rayos de cámara la atraviesan y cada gota refracta
   como la lente que es (manchas invertidas y muy desenfocadas, como en
   una foto de verdad), el polvo son motas oscuras y suaves. Mandos
   manuales para una foto fija sin simular: cantidad de gotas, tamaño,
   polvo, semilla. Sin el cristal, nada toca la lente.
4. **Simulación.** En `rt-phys` (paso fijo, determinista), con la barra
   de físicas (Pausar / Reanudar), caché junto al proyecto (gotas por
   fotograma, cobertura por fotograma, clave = *hash* de parámetros +
   geometría + semilla + versión) y el clip `PHYSICS` automático (§5).
   El visor Rápido enseña las gotas como esferas y la cobertura como
   tinte; el motor renderiza lo real.

**Depende de.** S4a (partículas y primitivas), S2 (`rt-phys`, barra,
caché, clip), O1 (`LENS`: la distancia del elemento frontal).

**Criterio.** Tests: una gota sobre vidrio inclinado 30° se queda hasta
el radio crítico de la tabla y resbala por encima (test numérico contra
el equilibrio tangente/ángulo de contacto); dos gotas que se tocan
suman volumen (± 1 %); el rastro limpia el polvo; la cobertura de polvo
en una cara a 60° es < 10 % de la horizontal; el cristal frontal con 0
gotas y 0 polvo deja el render bit a bit igual que sin cristal;
determinismo y caché reproducible; el clip existe tras iniciar y
desaparece con Reiniciar (deshacible). Hoja `out/rain-dust-sheet.html`:
la botella bajo lluvia a 0, 2, 5 y 15 s (gotas, rastros, goteo), polvo a
0, 30 y 120 s, y la misma foto con el cristal frontal mojado y con
polvo; a ojo (veredicto **Fable**). Capturas `docs/ui/physics-rain.png`,
`docs/ui/lens-glass.png`. `SPEC.md`, `UI.md`, `ARCHITECTURE.md`,
CHANGELOG.

**Hecho (primera parte; el resto, S3b, abajo).** La fase es grande y no
cabía entera en un PR sin bajar la calidad: entra la decisión **1.2**
(la forma de gota y la mezcla de geometrías en *Ambiente*, pedida por el
usuario) y el punto 3 como foto fija sin simular (el cristal frontal con
sus mandos manuales: cantidad de gotas, tamaño, polvo, semilla). Las gotas
que caen y resbalan sobre las piezas, el polvo que se asienta, el cristal
alimentado por los efectos de la escena y la simulación con caché y clip
son la propuesta **S3b**.

**1. La gota y la mezcla de formas (1.2).**
- **`rt-sim`.** `Shape::Drop` (código 3 de `FXAM.shape`; un motor anterior la
  lee como esfera): el cuerpo redondo de la partícula y una punta de
  `drop_tip` veces su radio cuyo centro queda `drop_tail` radios detrás,
  **contra la velocidad** (la gota que cae apunta hacia arriba, la burbuja que
  sube hacia abajo; quieta, a lo largo de la normal de su vida), con al menos
  0,05 radios de punta fuera del cuerpo. La **mezcla** (`mix`, un peso por
  forma: esfera, disco, cápsula, gota) sortea la forma de cada partícula una
  vez con su propio *hash*, de modo que cada una la conserva en cualquier
  instante; `shape_var` alarga o acorta la gota o la estela de cada una
  (`± shape_var`) con otro. Las sales son nuevas: la forma no cambia ninguna
  posición, tamaño ni tinte, y un efecto sin campos de S3 da sus bits de
  siempre. `Particle` gana su `shape`; `positions_hash` no la incluye (es el
  de S4a) y `shapes_hash` la fija aparte. `FXAM` crece a **228 B** solo cuando
  hay campos de S3 (`has_s3_fields`): un efecto sin gotas, mezcla ni variación
  conserva los 200 B de S4b (y `tests/fixtures/ambient.rsb` no cambia).
- **`rt-core`.** La gota es la envolvente convexa de dos esferas: el cono
  tangente `ρ cos β + s sin β = r` resuelto como cuadrática desde el punto del
  rayo más cercano al cuerpo (sin cancelación para una gota diminuta lejana),
  el cuerpo donde `s < r sin β`, la punta más allá del círculo de contacto;
  toda raíz que se queda está en el borde convexo, así que vale la más cercana
  en el intervalo, como en la cápsula. Normal por partes; `drop_distance`
  (la distancia exacta) para los tests. Ensanchada para la cámara, la gota se
  escala entera alrededor de su cuerpo (cobertura = cuadrado de la escala) y
  el margen de las cajas crece con su largo (`drop_reach`). Un conjunto que
  mezcla guarda la forma de cada hueco y todas las pruebas despachan por ella
  (impacto, salida, normal, cobertura, cajas de la rejilla de pantalla); el
  integrador pregunta por partícula si es un disco (pared fina) y por
  conjunto si todos lo son (sin medio dentro). `rt_particles_shapes` (wasm)
  da a *Rápido* la forma de cada partícula.
- **La página.** `EffectShape` gana `DROP`; `AmbientEffect` gana `shapeMix`
  (`on` y los cuatro pesos), `dropTail`, `dropTip` y `shapeVar`
  (`core/effects.ts`: `mixWeights`, `effectHasShape`, `heaviestShape`,
  `hasS3Fields`); el preset nuevo **`WATER_DROPS`** *Gotas de agua* (código
  12). En *Ambiente ▸ Avanzado* la **Forma** pasa a ser una lista (*Punto ·
  Copo · Estela · Gota · Mezcla*), con los pesos de la mezcla y la parte de
  cada uno, el largo y la punta de la gota y la variación de forma, cada uno
  una entrada de deshacer; el giro y el largo de estela salen también cuando
  la mezcla tiene copos o estelas. *Rápido* dibuja las gotas con el contorno
  del motor (`dropOutline`, en un `LatheGeometry` por instancias, estirado al
  largo de cada una) y cada partícula de una mezcla con su forma. Un motor sin
  el bit 6 recibe una gota como esfera y una mezcla como su forma de más
  peso, sin campos de S3.

**2. El cristal frontal (punto 3, foto fija).** `CameraOptics.frontGlass`
(`on`, `drops`, `dropSizeMm`, `dust`, `seed`, `distanceMm`) en *Cámara ▸
Lente ▸ Filtros ▸ Cristal frontal*, y en el motor la sección nueva **`GLAS`**
(48 B, justo detrás de `LENS`) y `rt_core::optics::glass`. Una lámina ideal
(no tuerce ni oscurece nada: sin gotas ni polvo la imagen es la de sin
cristal, **bit a bit**, test con los pases) a `distance` de la cámara (0,
automática: 25 mm con la lente simple, 5 mm delante del vértice frontal de
una trazada); encima, **gotas** como casquetes esféricos de agua (ángulo de
contacto e índice en `src/data/front-glass.ts`) por las que los rayos de
cámara entran por la base o la cúpula y salen por la cúpula con Snell y la
transmitancia de Fresnel exacta, o rebotan por reflexión total (hasta 8
veces; los que vuelven a salir por la base van hacia la cámara y no traen
nada), y **polvo**, discos que dejan pasar `1 − opacidad`. Las gotas salen de
celdas del propio cristal (cuatro diámetros medios) con *hashes* de (semilla,
celda, índice): la cobertura pedida, la posición, el tamaño; solo las celdas
que los rayos pueden cruzar (al menos 45° de semicampo, para que la imagen de
un visor, más ancha, tenga las del marco). Las que se tocan **se juntan** en
una de su volumen sumado en su centro de masas (`∛(a₁³ + a₂³)` a ángulo
fijo), por pasadas en orden fijo. Lo ven los rayos de cámara de la imagen
(después de la lente y sus filtros), el albedo y el alfa de sus muestras;
la posición en la pantalla de un rayo que una gota dobló se recalcula para la
imagen de fondo. No lo ven los pases exactos, el enfoque con clic ni una
cámara panorámica. En la interfaz: el interruptor y sus cinco mandos, cada
uno una entrada de deshacer, una nota de que solo lo trazan *Completo* y el
render, y otra si la cámara es panorámica; se guarda con la cámara (proyecto
y estudios) y se escribe solo para un motor con el bit 6.

**3. Motor, capacidades y fijados.** Bit 6 de `FEATURES`, `FEATURE_DROPS`
(64): la gota, la mezcla y la variación de `FXAM` y el `GLAS`; la página
(`render/engine.ts` `readsDrops`, `SceneView.drops`) los escribe solo para un
motor que lo dice, y *Exportar escena* para `rt` siempre. Dos escenas de
paridad: `example::s3_drops_scene` (2 500 gotas de agua, claras y lisas, y
3 000 partículas opacas en una mezcla 1 : 1 : 1 : 2 con paleta, sombra y
variación) y `example::s3_glass_scene` (el ejemplo a 28 mm f/8 a través de un
cristal con un 35 % de gotas de 2 mm y un 3 % de polvo), con `rt
--write-s3-drops-example` y `--write-s3-glass-example`. **Fijados nuevos**:
`PINNED_S3_DROPS_4SPP = 0x73ebde26`, `PINNED_S3_DROPS_PARTICLES =
0x401e61d5`, `PINNED_S3_DROPS_SHAPES = 0xec380974`, `PINNED_S3_GLASS_4SPP =
0xf410d5f0`: los mismos en escalar, SSE2 y AVX2, con 1, 4 y 16 hilos, a través
de un RSB, y en el `rt.wasm` real (`tools/wasm-parity.mjs`, que gana
`--expect-shapes`; la escena del cristal también con los pases intercalados);
`.github/workflows/engine.yml` los lee del fuente y pasa
`tests/s3-drops.test.ts` con el `rt.wasm` real. **Ningún fijado anterior se
mueve.**

**Coste** (instrucciones por muestra con *valgrind*, deterministas: 3 spp
menos 1 spp a 160 × 120, un hilo). La escena de gotas con sus dos efectos como
esferas, 337,5 M; como estelas de 10 ms, 407,9 M; como gotas, 398,5 M (una
gota cuesta como una estela corta: su cono es otra cuadrática); la escena
fijada (gotas, mezcla y variación), 385,4 M. El ejemplo, 199,4 M; con un
cristal sin nada, 200,0 M (+0,3 %: la comprobación de cada rayo de cámara); con
el cristal mojado de 35 % y polvo, 219,7 M (+10 %). Frente al motor de antes de S3 (el de `ec6deee`), con los mismos archivos: el
ejemplo, 198,9 M → 199,4 M (+0,24 %), y la escena de *Ambiente* de S4a, 539,9 M →
548,3 M (+1,6 %: la forma de cada hueco que se mira en cada prueba de impacto;
los mismos píxeles).

**Tests** (cada uno comprobado con su mutación: las 21, 14 del motor y 7 de la
página, lo hacen fallar, y pasan sin ella; tres del motor sobrevivieron a la
primera pasada y se cerraron: la mezcla dibujada con la forma del conjunto
engañaba a la comparación con la fuerza bruta, que usa la misma prueba, y hubo
que añadir la de abajo contra los conjuntos de una forma; las otras dos eran
mutaciones mal elegidas para el test que se corrió y las detectan los de al
lado):
- `rt-sim::params`: la carga de 228 B y sus desplazamientos, la de 200 B sin
  campos de S3 (y la de S4b, más corta, con los de por defecto), los rangos;
  `shape_for` y `can_be`. Mutaciones: los campos de S3 nunca escritos; la
  mezcla sin sus pesos.
- `rt-sim::eval::tests`: la gota sigue a su velocidad con su largo, la
  punta mínima y la quieta según su normal; la forma no cambia posiciones,
  tamaños ni tintes; la mezcla 1 : 2 : 0 : 5 da sus partes (± 1,5 % sobre 40
  000) y cada partícula conserva su forma; la variación estira gotas y estelas
  por el mismo factor. Mutaciones: la gota que apunta hacia delante; sin
  variación.
- `geometry::particles::tests`: 400 gotas de formas variadas contra una
  marcha de su distancia exacta (impacto, salida y normal contra el
  gradiente); una gota de 0,02 mm a 2 m, y ensanchada como copia escalada con
  su cobertura, su caja y el margen de la cámara. Mutaciones: sin el cono; la
  gota ensanchada sin escalar; el margen sin el largo de la gota.
- `geometry::particles::grid_tests` y `geometry::tests`: la rejilla de pantalla
  y la BVH contra la fuerza bruta con gotas y con una mezcla de las cuatro
  formas (también los rayos de toda clase), y `a_mix_hits_each_particle_as_its_own_shape`:
  cada rayo toca en la mezcla la misma partícula, a la misma distancia, que en
  cuatro conjuntos de una forma cada uno. Mutación: la mezcla dibujada con la
  forma del conjunto.
- `integrator::particle_tests`: los copos de una mezcla son pared fina y sus
  gotas sólidos. Mutación: el disco del conjunto, no el de la partícula.
- `optics::glass::tests`: la carga y sus rangos; dos gotas que se tocan suman
  su volumen (± 1e-5), una cadena se junta entera y una separada no; ninguna
  gota del cristal toca a otra, la cobertura tras juntarse, las mismas gotas
  con otra focal y en la imagen de un visor; el rayo por el centro de una gota
  sigue recto con su Fresnel y sale por lo alto del casquete; una gota lleva
  los rayos paralelos a su foco `R / (n − 1)` (± 8 %); el borde de una gota de
  90° no trae nada (15 de 20 rayos del último quinto) y el centro sí; el polvo
  opaco para y el de media opacidad deja la mitad. Mutaciones: la salida sin
  Fresnel; la reflexión total tomada como salida; las gotas que suman radios;
  sin juntarlas.
- `render::s3_tests`: los cuatro fijados; las partículas renderizadas son las
  evaluadas; gotas y mezcla igual que la fuerza bruta; **un cristal sin nada
  no cambia un bit** de la imagen del ejemplo ni de sus pases, también a
  través de un RSB, y uno mojado sí; una gota de 6 mm en un estenopeico pone
  la escena del revés (la mitad izquierda de la gota ve la derecha de la
  pared), y fuera de ella nada cambia. Mutación: la lámina que mueve el rayo.
- `rt-cli/tests/example.rs`: las dos escenas, los mismos píxeles con 1, 4 y 16
  hilos y tras un RSB; los dos `--write-s3-*-example`. `rt-wasm`: las formas
  por la API C son las del simulador, y el bit 6. `rt-app`: `/api/info`
  dice 127.
- `tests/s3-drops.test.ts`: los `FXAM` y el `GLAS` byte a byte frente a los de
  `rt` (`tests/fixtures/s3-drops.rsb`, `s3-glass.rsb`); el efecto nuevo con su
  gota por defecto y sus 200 B; *Gotas de agua*; la mezcla, su forma de más
  peso y su estela, y lo que va a un motor sin el bit; los rangos por el
  *store* y el deshacer; un archivo anterior y uno con mezcla; el contorno de
  la gota; el cristal apagado, sin nada, en los límites de un archivo, escrito
  tras la cámara con sus valores fijos, no para un motor sin el bit ni con una
  cámara panorámica, guardado y abierto; con el `rt.wasm` real, las formas de
  la mezcla y las partículas fijadas, las dos imágenes fijadas y un proyecto
  con cristal y gotas. Mutaciones (siete): el bit ignorado, los campos de S3
  siempre, el `GLAS` sin el bit y a través de una panorámica, el cristal sin
  recortar, los pesos sin recortar, la mezcla sin su estela.
- `tools/s3-check.mjs` (Chromium y SwiftShader): la galería con *Gotas de
  agua*, la gota y sus filas, las gotas en *Rápido* (el medidor y los
  píxeles), la mezcla con sus partes y sus pesos (una entrada cada cambio) y
  el deshacer; el cristal en *Completo* (apagado sin mandos; encendido, una
  entrada; gotas de 8 mm a 150 mm a f/16, y la imagen cambia; deshacer); el
  cromo acromático en los dos temas. Capturas `docs/ui/ambient-drops.png`,
  `docs/ui/ambient-mix.png` y `docs/ui/lens-glass.png`.

**No encajó con el plan.**
- **La fase partida.** Esta parte es 1.2 y el cristal frontal como foto fija;
  todo lo que es simulación (gotas sobre las piezas, resbalar, gotear, polvo
  asentado, el cristal alimentado por la lluvia de la escena, la barra de
  físicas, la caché y el clip) es S3b. Por eso no están la hoja
  `out/rain-dust-sheet.html` ni `docs/ui/physics-rain.png`, ni los criterios
  del vidrio a 30°, del polvo a 60° y del rastro que limpia.
- **El cristal no va en `LENS`.** Va en su sección (`GLAS`): vale también con
  una cámara ortográfica, no toca los bytes de `LENS` de O1–O4, y un motor
  anterior la salta. Un solo bit de capacidades (6) para la gota, la mezcla y
  el cristal.
- **La lámina es ideal** (sin Fresnel propio), para que sin nada encima la
  imagen sea la misma bit a bit (el criterio); el vidrio de debajo de una gota
  tampoco cuenta (un 0,4 % entre vidrio y agua). La luz que refleja una gota
  no se sigue: se pierde un poco en las caras (unos pocos por ciento), que es
  lo que se iría hacia la lente.
- **La visibilidad es la física.** Una gota en el cristal es una lente fuerte
  muy desenfocada: con un objetivo largo y abierto (el 85 mm f/5,6 de todo
  proyecto nuevo cruza 15 mm de cristal por píxel) las gotas de 2 mm solo
  velan la imagen; se ven como discos cuando son más anchas que esa huella
  (un angular cerrado, como la escena de paridad a 28 mm f/8, o el cristal
  lejos, una ventana). La captura usa gotas de 8 mm a 150 mm y f/16. Para el
  veredicto (◆ 7).
- **La distancia** se mide desde la posición de la cámara (el centro de la
  lente simple, la pupila de entrada de la trazada); la automática es una
  propuesta (◆ 6). El cristal ocupa al menos 45° de semicampo para que el
  visor y el render vean las mismas gotas.
- **Qué lo ve**: ni los pases exactos (sus rayos van por el centro del píxel y
  de la lente a la escena, y la guarda de la IA los compara con la imagen), ni
  el enfoque con clic, ni las conexiones de los filtros de O3a con las luces
  que el cristal cambiaría (se dejan fuera).
- **La forma pasa a una lista**: cinco botones no cabían en el ancho del
  inspector (la primera captura salía cortada). Sigue en *Avanzado* (◆ 5).
- **`FXAM` de 228 B solo con campos de S3**, como los campos «solo si se
  ponen» de `CAMR` y `RNDR`: la carga de S4b no cambia de tamaño y
  `tests/fixtures/ambient.rsb` es el mismo.
- **`positions_hash` no ve las formas**: es el de S4a, y meterlas movía
  `PINNED_AMBIENT_PARTICLES`; `shapes_hash` (y `--expect-shapes`) las fija
  aparte.
- **El ángulo de contacto del cristal** es un valor fijo de
  `src/data/front-glass.ts` (60°), no de la tabla de mojabilidad por familia,
  que es de S3b.
- **Rápido no dibuja el cristal** (el plan pedía las gotas como esferas y la
  cobertura como tinte para la simulación, que es S3b); la sección lo dice.
- `rt-app/tests/server.rs` comprobaba `features == 63`; ahora 127.
- `tools/ambient-check.mjs` esperaba ocho tarjetas disponibles; ahora nueve.
  `docs/ui/ambient-gallery.png` no se ha regrabado (sigue con las once de S4a).

**Para el veredicto** (regla 11, ◆; decidido en *Decisiones de criterio*):
1. ◆ La gota por defecto: largo 1,6 radios del cuerpo y punta de 0,15
   (`rt_sim::DROP_TAIL`, `DROP_TIP`), y la punta mínima de 0,05 radios fuera
   del cuerpo.
2. ◆ La orientación: la punta **detrás**, contra la velocidad (la lágrima que
   cae con la punta arriba). Una gota de lluvia real cae casi esférica o
   achatada; la lágrima es la forma que se pidió.
3. ◆ La mezcla con que arranca *Mezcla*: 1 : 1 : 1 : 2 (puntos, copos,
   estelas, gotas).
4. ◆ El preset *Gotas de agua*: 8 000 /m³, 3 mm ± 50 %, caída 2,5 m/s ± 30 %,
   variación de forma 30 %, viento 0,3 m/s, caos 5 %, agua ior 1,33, sin
   sombra.
5. ◆ Si la *Forma* sale de *Avanzado* a los mandos visibles (el usuario pidió
   la gota y la mezcla expresamente).
6. ◆ El cristal: ángulo de contacto 60°, dispersión de tamaños ± 60 %, motas
   de 0,3 mm ± 60 % que paran el 90 %; al encenderlo, 30 % de gotas de 2 mm y
   2 % de polvo; los rangos (gotas hasta 90 %, 0,2 a 10 mm, polvo hasta 50 %,
   distancia hasta 200 mm); la distancia automática, 25 mm con la lente simple
   y 5 mm delante del vértice frontal de la trazada.
7. ◆ Lo fuerte que se ve el efecto: con la física de ahora, unas gotas del
   tamaño de la apertura velan la imagen y no se leen como gotas (arriba).
   Aceptarlo, o gotas por defecto más grandes, o un mando no físico que las
   enfoque más (marcado como tal, como los de O2).
8. ◆ El polvo como motas que absorben: una mota a contraluz no brilla (en una
   lente real, el polvo del elemento frontal a contraluz sí se enciende un
   poco).
9. ◆ El cristal en *Rápido*: nada ahora; con S3b, una aproximación (manchas
   blandas) o seguir sin dibujarlo.

### S3b · Lluvia y polvo que se posan, resbalan y caen sobre la lente (simulación) — **Opus** (tras S3) — hecha en parte (el cristal frontal alimentado por la escena, ◆5 y ◆9); el resto, S3c

Lo que queda de S3, tal como lo pide su apartado de arriba y sobre lo que deja
hecho la primera parte:

1. **Gotas sobre las superficies** (punto 1 de S3): los aterrizajes de la
   lluvia de un efecto (su recorrido es de forma cerrada en `rt-sim`: el
   instante en que cruza una pieza se busca sobre él) en un `rt-phys::wet`
   de paso fijo; la tabla de **mojabilidad** por familia de material
   (`src/data/wettability.ts`: ángulos de avance y de retroceso de vidrio,
   plástico, metal, papel y pintura) y la condición de Furmidge para anclar o
   resbalar (`m g sin α = γ w (cos θ_R − cos θ_A)`; el test del vidrio a 30°
   con el radio crítico de la tabla); juntarse por volumen (la regla de
   `optics::glass::merge_drops`); el **rastro mojado** como máscara de
   humedad del material (menos rugosidad, más oscuro lo poroso: una sección
   nueva o un canal del programa de M3b); gotear en las aristas (vuelven a
   ser partículas que caen) y salpicar; la nieve como capa que no resbala.
   Las gotas, como casquetes de esfera sobre la pieza (la intersección del
   cristal frontal, en el plano tangente).
2. **Polvo asentado** (punto 2): la cobertura por pieza (téxeles o
   vértices) que acumula lo que deposita un efecto de polvo, con el ángulo de
   reposo (el test de la cara a 60° frente a la horizontal) y la lluvia que la
   limpia por donde pasa el rastro; la capa en el sombreado y las motas donde
   la cobertura es alta.
3. **El cristal alimentado por la escena** (punto 3, lo que falta): la lluvia
   y el polvo de los efectos caen sobre el cristal frontal de esta parte con
   los mismos modelos, las gotas resbalan según el *arriba* de la cámara; los
   mandos manuales de S3 siguen para la foto fija.
4. **Simulación** (punto 4): en el *worker* de físicas de S2 con *Pausar /
   Reanudar*, la caché junto al proyecto (clave = *hash* de parámetros +
   geometría + semilla + versión) y el clip `PHYSICS` automático; *Rápido*
   enseña las gotas como esferas y la cobertura como tinte (y el cristal, si
   el veredicto ◆ 9 lo pide).
5. **Criterios** de S3 que quedan: el vidrio a 30°, la cobertura a 60° < 10 %
   de la horizontal, el rastro que limpia el polvo, determinismo y caché
   reproducible, el clip que nace y se va con *Reiniciar*; la hoja
   `out/rain-dust-sheet.html` (la botella bajo lluvia a 0, 2, 5 y 15 s, polvo
   a 0, 30 y 120 s, y la foto con el cristal mojado y con polvo) y
   `docs/ui/physics-rain.png`.

**Hecho (S3b: el cristal frontal alimentado por la escena; lo de las piezas,
S3c, abajo).** La propuesta entera no cabía en un PR sin bajar la calidad.
Entran las dos decisiones (S3 ◆5 y ◆9) y, de la simulación, todo lo que pasa
**en el cristal frontal**: es un plano, así que el modelo entero (aterrizajes
por flujo, mojabilidad, anclaje de Furmidge, resbalar con rastro, juntarse,
polvo con ángulo de reposo, el rastro que limpia) se construye y se prueba
sobre él, con el *worker*, la barra, la caché y el clip; los criterios
numéricos de S3 (el vidrio a 30°, la cara a 60°, el rastro que limpia, juntar
± 1 %) se cumplen sobre ese modelo. Llevarlo a las mallas de las piezas
(gotas sobre superficies curvas, la máscara de humedad del material, la
cobertura por téxel, gotear en las aristas, salpicar, la nieve) es S3c.

**1. La *Forma* fuera de *Avanzado* (S3 ◆5).** En *Ambiente*, la *Forma* es un
mando visible justo después del *Tamaño*, con los pesos de la *Mezcla* debajo
cuando la hay; el largo y la punta de la gota y la variación de forma siguen en
*Avanzado*. `tools/s3b-check.mjs --only shape` (la lista dentro de los mandos,
fuera de *Avanzado*, que sigue plegado; *Mezcla*, una entrada de deshacer, y sus
pesos ahí) y la captura `docs/ui/ambient-shape.png`; `ambient-drops.png` y
`ambient-mix.png` se regraban (la forma ya no está en *Avanzado*).

**2. El cristal en *Rápido* (S3 ◆9).** `render/glass-overlay.ts` y el paso
`GLASS` de `render/lens-filter-pass.ts`: con las gotas y motas **del motor**
(`rt_scene_glass_len` / `_copy` sobre una escena de solo la cámara y su cristal,
`io/rsb.ts` `glassPaneRsb`; de la escena, el fotograma grabado), tres mapas sobre
el cristal en sus milímetros (la parte bajo gotas; bajo su borde, donde un rayo a
lo largo del eje vuelve por reflexión total, desde `1 / (n sin θ)` del radio:
0,87 a 60°, sin ◆, de la física; bajo polvo, por su opacidad) desenfocados por
la huella de un píxel en el cristal, `R = (f / N / 2) |1 − d / s|`; cada píxel
toma la imagen desenfocada (por las dos caras del agua) por las gotas y se
oscurece por el borde y el polvo. Las gotas son discos suaves de borde oscuro;
el polvo, un tinte (o motas, si son más nítidas que la huella). No dibuja la
escena del revés dentro de cada gota. El medidor: *Cristal frontal: aproximación
de las N gotas y M motas del motor* (sin `rt.wasm`, que lo dibuja con el motor).
Captura `docs/ui/lens-glass-fast.png` (gotas de 8 mm a 150 mm, f/16).

**3. La simulación (`rt_phys::wet`, §5.2 novendecies de ARCHITECTURE).**
- **Llegadas.** Por paso de 1/240 s y efecto, un sorteo de Poisson de media
  `densidad × máx(0, −v·n) × área × dt`: lo que cruza la cara de fuera del
  cristal. Densidad = lo que pide el efecto entre su volumen (las densidades
  fotográficas de los presets); `v`, su viento más su caída, en los ejes del
  cristal (los de la cámara). Uniforme en el cuadrado del cristal que cruzan los
  rayos del render (el del motor). Qué deja cada efecto: `GLASS_FEED`
  (`src/data/front-glass.ts`: *Lluvia* y *Gotas de agua*, gotas; *Motas de
  polvo*, *Polen*, *Polvareda*, *Ceniza*, polvo; nieve, burbujas y confeti,
  nada).
- **Gotas.** Casquetes de su volumen `π D³ / 6` al ángulo medio de avance y
  retroceso; se juntan con `optics::glass::merge_drops` (la regla de S3, por
  volumen); se quedan ancladas por **Furmidge**
  (`ρ g V sin α ≤ γ 2a (cos θ_R − cos θ_A)`), resbalan por encima según el
  *arriba* de la cámara a `v = exceso / (C μ a)` y dejan un **rastro** (una
  película que les quita agua, así que una gota que corre acaba parando) que se
  lleva el polvo; la que sale del cristal se va (gotea).
- **Polvo.** Una mota se queda con probabilidad 1 por debajo del ángulo de
  reposo menos 5°, 0 por encima más 5°, una rampa suave entre medias; nunca en
  una cara que mira hacia abajo.
- **Mojabilidad.** `src/data/wettability.ts` (claves nuevas: `GLASS`,
  `PLASTIC`, `METAL`, `PAPER`, `PAINT`): ángulos de avance y de retroceso; el
  vidrio, 70° y 50°, de media los 60° del cristal de S3. En S3b solo la usa el
  cristal.
- **WET1**, el formato de la página al motor (`core/wet.ts` `wetBytes`); cada
  fotograma vuelve como su registro (`WetPane::frame`: las gotas, las motas
  que llegaron y las que se fueron).
- **Coste**: los 5 s de la escena de paridad (189 gotas al final), 1 200 pasos
  con un fotograma cada 10, en el `rt.wasm` real, 12–16 ms.

**4. En el *worker*, con caché y clip.** `render/physics-worker.ts` corre el
PHY1 y el WET1 a la vez (los mismos pasos) o solo uno; cada fotograma lleva las
poses y el registro del cristal. *Iniciar* (no *Dejar caer*) lleva el cristal de
la cámara activa cuando está en *Gotas y polvo ▸ De la escena* y algún efecto lo
alimenta, también sin ningún cuerpo *Dinámico*; con cristal la simulación no se
para al dormirse los cuerpos (sigue lloviendo): la para *Parar* o 120 s
(`MAX_GLASS_SECONDS`). *Pausar* y *Reanudar*, los de S2. **La caché** es la pista
del cristal del clip `PHYSICS` de la cámara (`MotionClip.glass`: las gotas de
cada fotograma y cada mota con el fotograma en que llegó y en el que se fue, en
base64, y la **clave**, el FNV-1a del WET1 y la versión del formato): se guarda
con el proyecto, el render y *Rápido* leen el fotograma que el cabezal dice
(`Pose.glass`), y una simulación de la misma clave da la misma pista, bit a bit
(test con el `rt.wasm` real). El inspector dice qué efectos lo alimentan, qué hay
en el cabezal (*Grabado: 97 fotogramas, 215 gotas y 0 motas*) y si la escena ya
no da la clave grabada. El clip nace al iniciar, es la misma entrada de deshacer
que la simulación, y *Reiniciar* lo quita (deshacible). La barra dice *Cristal:
215 gotas · 0 motas*.

**5. Motor, capacidades y fijados.** El final de `GLAS` (desde el byte 48: `u32
1`, gotas, motas, `(x y a)`, `(x y r)`; `optics::glass::GlassLayout`,
`FrontGlass::laid_out`: tal cual, sin esparcir ni juntar), **bit 7**,
`FEATURE_GLASS_LAYOUT` (128); la página lo escribe solo para un motor con él
(`SceneView.glassLayout`) y con la cobertura a 0, así que un motor de S3 dibuja
el cristal limpio. `rt_phys::example::wet_spec` (el cristal de la escena de S3 a
28 mm f/8 bajo la lluvia del preset empujada por 3 m/s de viento hacia la lente,
y polen) y `s3b_wet_scene`; `rt --write-s3b-wet-example` y
`--write-s3b-wet-spec` (`tests/fixtures/s3b-wet.rsb`, `s3b-wet.wet1`); `rt-cli`
depende ahora de `rt-phys`. **Fijados nuevos**: `PINNED_WET_PANE = 0x5e511523` y
`PINNED_S3B_WET_4SPP = 0x6e6e370c`, los mismos en escalar, SSE2 y AVX2 (el
segundo), con 1, 4 y 16 hilos (`rt-cli/tests/example.rs`), en `wasm32-wasip1`
escalar y simd128 (`cargo test -p rt-phys --test wet`, nuevo en CI) y en el
`rt.wasm` real (`tools/wasm-parity.mjs`, con los pases intercalados;
`tests/s3b-wet.test.ts` en el paso de CI que pasa los tests con el `rt.wasm`
real). **Ningún fijado anterior se mueve.** `rt-app`: `/api/info` dice 255.

**Tests** (cada uno comprobado con su mutación: 23, 10 del motor y 13 de la
página, lo hacen fallar y pasan sin ella; dos sobrevivieron a la primera pasada
y se cerraron: el diario de motas sin vaciar entre fotogramas pasaba porque el
test de los fotogramas usaba el cristal de paridad, que no limpia ninguna mota
—ahora usa un cristal a 30° con lluvia y polvo y exige que cada mota se vaya una
sola vez—, y *Reiniciar* mientras corre sin el clip del cristal, que solo se
probaba tras *Parar*):
- `rt-phys/tests/wet.rs`: el vidrio a 30° (el radio crítico ± 0,5 % del cálculo
  de Furmidge en `f64`; a 0,97 y 0,995 se queda, a 1,005 y 1,05 resbala; plano,
  nunca), resbala más deprisa más empinado y pierde en el rastro el agua que
  dice, la que sale se va; juntar suma el volumen (± 1 %) en el centro de masas;
  el rastro limpia el polvo (una banda limpia, el resto con su polvo; y la lluvia
  en un cristal a 30° deja menos de 0,9 del polvo que sin lluvia); el polvo a 60°
  < 10 % del horizontal, a 30° el coseno (± 10 %), mirando abajo nada; la lluvia
  llega a su flujo (± 4σ) y nunca a una cara que mira al otro lado; el mismo
  cristal por pasos sueltos y juntos y reconstruido de sus fotogramas; los dos
  fijados. Mutaciones: media histéresis; sin juntar; el rastro que no limpia;
  sin ángulo de reposo; el flujo sin mirar la cara; el rastro sin perder agua;
  el diario sin vaciar.
- `rt-core`: `optics::glass::tests` (el final de `GLAS` va y vuelve, sus rangos
  y sus cuentas; un cristal colocado toma sus gotas y motas tal cual y su mota
  para el rayo); `render::s3_tests` (un cristal colocado sin nada, también por un
  RSB, no cambia un bit del ejemplo). Mutaciones: la lista ignorada (se
  esparce); juntarla otra vez; el escritor sin la lista. `rt-wasm`: el
  registro de cristales es el nativo; `scene_glass` es lo que el motor coloca.
  `rt-cli`: la escena con 1, 4 y 16 hilos y tras un RSB, los dos `--write-*`.
- `tests/s3b-wet.test.ts` (18): la tabla y que vidrio y reposo son los del
  motor; qué efectos alimentan; los ejes del cristal y una cámara que mira abajo
  seca; las fuentes (densidad, viento y caída en los ejes); el WET1 byte a byte
  con el del motor y su clave; la pista reconstruye cada fotograma y rechaza un
  registro que no sigue; con el `rt.wasm` real, el cristal fijado y dos
  ejecuciones con la misma pista; el clip de la cámara (el fotograma de la pose,
  la cámara quieta, también en 0), guardado y abierto, uno roto se quita; el
  `GLAS` gota a gota solo para el bit 7 y con grabación; la barra corre el
  cristal solo (una entrada; *Reiniciar*, otra, deshacible; también mientras
  corre); *Dejar caer* y *A mano* no lo corren; la huella, los mapas (nítido,
  desenfocado, el borde, el polvo) y la proyección; con el `rt.wasm` real, el
  cristal a mano que coloca el motor y la imagen de paridad. Mutaciones (13): el
  WET1 con una palabra de más; las motas que no se van; el clip que mueve la
  cámara; sin cristal en 0; la lista para cualquier motor; el cristal a mano
  corre; *Reiniciar* (en marcha y tras parar) sin el clip; un proyecto que tira
  el clip; la velocidad en ejes del mundo; sin desenfoque; la huella sin el
  foco; la pista que no crece.
- `tools/s3b-check.mjs` (Chromium y SwiftShader): la *Forma* (arriba); el
  cristal en *Rápido* (los píxeles cambian, 74 980; el medidor; *De la escena*
  sin grabar, seco); la lluvia con viento de 6 m/s hacia una cámara de 35 mm a
  f/11: *Iniciar*, en pausa a los 4 s con *Cristal: 148 gotas*, la grabación en el
  inspector, el visor la dibuja, *Parar* (una entrada), *Reiniciar* la quita y
  *Deshacer* la devuelve; el cromo acromático en los dos temas. Capturas
  `docs/ui/ambient-shape.png`, `lens-glass-fast.png` y `physics-rain.png`.
- La hoja `out/rain-dust-sheet.html` (`tools/rain-dust-sheet.mjs`, con
  `tests/rain-dust-dump.test.ts`): el ejemplo a 28 mm f/8 con la lluvia empujada
  por 6 m/s hacia la lente a 0, 2, 5 y 15 s (unas 175 gotas: se llena en un par
  de segundos y luego corren tantas como llegan), y la lente mirando 60° hacia
  arriba bajo *Motas de polvo* (143 motas a 30 s, 522 a 120 s: no se ve) y bajo
  la densidad de una *Polvareda* sin viento (5 866 y 23 113: un velo moteado),
  cada foto con el dibujo del cristal al lado, y las fotos sin cristal.

**No encajó con el plan.**
- **La fase partida otra vez.** S3b es el cristal; lo de las piezas es S3c
  (abajo). Por eso la hoja no tiene la botella bajo la lluvia (gotas, rastros y
  goteo sobre ella) ni el polvo sobre el set, y `physics-rain.png` enseña la
  lluvia en el cristal.
- **Los aterrizajes no siguen a cada partícula del efecto**: el plan decía
  buscar el instante en que el recorrido de forma cerrada de cada partícula
  cruza el cristal. La región de un efecto es una caja alrededor del producto
  que la cámara casi nunca está dentro, y las partículas se envuelven en ella;
  lo que llega al cristal es el **flujo** del efecto (su densidad por su
  velocidad a través de la cara), por Poisson. El cristal recibe la lluvia de la
  escena esté donde esté la cámara (◆ si la región debe contar).
- **La física deja seca una cámara que mira abajo**: con lluvia vertical nada
  cruza la cara de fuera de su cristal; hace falta viento hacia la lente (o
  mirar hacia arriba). El polvo, igual, solo se queda en un cristal que mira
  hacia arriba por debajo de 35°. Para el veredicto (◆).
- **La caché es la pista del clip**, como en S2 (no un archivo aparte «junto al
  proyecto»): va dentro del proyecto, y la clave (`wetKey`) dice cuándo la
  escena ya no es la grabada. No se vuelve a simular sola: el inspector lo dice
  y *Iniciar* la rehace.
- **El clip es de la cámara** (`target` *Cámara*, todos los planos), con el id
  de la cámara en su pista, y no la mueve; `evaluate` lo deja fuera de los clips
  que mueven la cámara.
- **El rastro no se ve en el render**: en el cristal es una película fina (como
  la lámina, ideal) y lo que hace es quitar agua a la gota y llevarse el polvo.
  La máscara de humedad del material (menos rugosidad, más oscuro lo poroso) es
  de las piezas, S3c.
- **Gotear y salpicar**: en el cristal, una gota que sale del cuadrado se va; no
  vuelve a caer como partícula ni salpica (S3c). Una gota que cuelga de un
  cristal que mira hacia abajo no se desprende (S3c).
- **La nieve no alimenta el cristal** (se fundiría en gotas o se apilaría; S3c),
  ni las burbujas (suben) ni el confeti (no se pega) (◆).
- **El borde oscuro de *Rápido*** sale de la física (la reflexión total de un
  rayo a lo largo del eje), sin ◆; la escena del revés dentro de la gota no se
  dibuja (lo hacen *Completo* y el render).
- **Un motor sin el bit 7** (un lanzador de escritorio de antes) no recibe el
  cristal de la escena: el render lo enseña limpio. El inspector no lo avisa (la
  página no sabe aquí las capacidades del motor del render); el medidor de
  *Completo* tampoco.
- **`rt-cli` depende de `rt-phys`** para escribir la escena de paridad desde la
  simulación (el ejemplo de `rt-core` no puede: `rt-phys` depende de él).
- **El fijado de la imagen vive en `rt-phys/tests/wet.rs`**, no en
  `rt-core/src/render`, por lo mismo; recorre `Isa::available()` con la API
  pública de `rt-core`.
- `rt-app/tests/server.rs` comprobaba `features == 127`; ahora 255.

**Para el veredicto** (regla 11, ◆; decidido en *Decisiones de criterio*):
1. ◆ La mojabilidad por familia (`src/data/wettability.ts`): vidrio 70°/50°
   (media 60°, la del cristal de S3), plástico 90°/65°, metal 80°/50°, papel
   100°/20°, pintura 85°/60°; con ellos el radio crítico en vidrio vertical es
   2,1 mm de huella (una gota de unos 4 mm resbala) y 3,0 mm a 30°.
2. ◆ El resbalar: el arrastre `C = 300` (una gota un 50 % por encima de su
   tamaño crítico en vidrio vertical va a unos 40 mm/s), el tope de 250 mm/s y la
   película del rastro de 2 µm (cuánto corre una gota antes de pararse).
3. ◆ El polvo: el ángulo de reposo de 35° con su rampa de ±5°, y que una cara
   vertical no guarde nada (en un cristal real algo se pega).
4. ◆ Qué efecto alimenta el cristal y como qué (`GLASS_FEED`): la nieve, las
   burbujas y el confeti, nada.
5. ◆ Si la región del efecto debe contar (ahora la lluvia llega al cristal
   esté donde esté la cámara) y si una cámara que mira hacia abajo debería
   mojarse algo sin viento (salpicaduras, la mano del fotógrafo).
6. ◆ Lo fuerte que se ve: con las densidades fotográficas de los presets, la
   *Lluvia* llena el cristal en un par de segundos y las *Motas de polvo* no se
   ven en 120 s (la *Polvareda*, sí). Aceptarlo, o un mando de intensidad (no
   físico, marcado) para el polvo del cristal.
7. ◆ Lo fuerte de la aproximación de *Rápido*: los discos suaves desenfocados
   por la huella real; con el 85 mm f/5,6 de un proyecto nuevo, un velo (como el
   render, ◆7 de S3).
8. ◆ `MAX_GLASS_SECONDS = 120`.

### S3c · Gotas y polvo sobre las piezas (simulación) — **Opus** (tras S3b) — hecha en parte (el aviso del bit 7; la lluvia, el polvo y la nieve sobre las piezas, en el motor y en *Rápido*); el resto, S3d

Lo que queda de S3 tras S3b, sobre el modelo de `rt_phys::wet` (que ya hace el
cristal):

1. **Gotas sobre las superficies**: los aterrizajes de la lluvia sobre las
   mallas (el flujo del efecto sobre cada triángulo que mira a la lluvia, o el
   cruce de cada partícula con la BVH de `rt-phys`), la gota en el plano
   tangente de su punto (el mismo casquete, con la normal de la malla), el
   anclaje y el resbalar con la gravedad tangente (el mismo Furmidge, con la
   **mojabilidad** de la familia del material: `src/data/wettability.ts` y una
   tabla de la categoría del material a la familia, ◆), siguiendo la superficie
   de triángulo en triángulo; **gotear** en las aristas (cuando la curvatura
   gira la normal más allá de lo que el ángulo de contacto aguanta, la gota
   vuelve a ser una partícula que cae, con el `rt-sim` de S4a) y **salpicar**
   (gotas secundarias); la **nieve** como capa que no resbala.
2. **El rastro mojado como máscara del material**: un canal de humedad por
   pieza (téxeles o vértices) que baja la rugosidad y oscurece lo poroso, en el
   motor (una sección o un canal del programa de M3b) y en *Rápido*.
3. **Polvo asentado**: la cobertura por pieza (téxeles o vértices) con el
   ángulo de reposo de S3b y la lluvia que la limpia por donde pasa el rastro; la
   capa en el sombreado y las motas donde la cobertura es alta.
4. **Caché y clip**: las gotas y la cobertura por fotograma en el clip
   `PHYSICS` (o un clip por pieza mojada), con la clave de S3b.
5. **Criterios** que quedan de S3: la hoja con la botella bajo la lluvia a 0, 2,
   5 y 15 s (gotas, rastros, goteo) y el polvo sobre el set a 0, 30 y 120 s;
   `docs/ui/physics-rain-set.png`.

**Hecho (S3c: el aviso y lo de las piezas; lo que queda, S3d, abajo).** Entra
todo lo que pasa **sobre las piezas** que están quietas: las gotas una a una
sobre las mallas, el rastro como máscara del material, el polvo y la nieve por
muestra, la caché y el clip, en el motor (*Completo* y el render) y en
*Rápido*, y la hoja y la captura. Lo que no entra (las gotas que caen por el
aire al gotear y al salpicar, las motas del polvo, las piezas que se mueven, el
suelo del estudio) es la propuesta **S3d**.

**0. El aviso (primero, con su test).** `core/wet.ts` `glassRendersClean`: con
el cristal frontal encendido, en *De la escena*, algún efecto que lo alimenta,
una cámara que no es panorámica y un motor que dice que no tiene el bit 7
(`EngineInfo.glassLayout`, que `main.ts` saca de las capacidades del motor del
render: el nativo o el *pool*), *Cámara ▸ Lente ▸ Filtros ▸ Cristal frontal*
dice *el render enseñará este cristal limpio* (`camera.glassOldEngine`, es y
en). Un motor aún desconocido o uno con el bit, nada; *A mano*, nada (ese lo
dibuja un motor de S3). Lo mismo para lo nuevo de esta fase con el bit 8
(`core/wet-parts.ts` `partsRenderDry`, la nota bajo *Sobre las piezas*:
*el render las enseñará secas y limpias*). `tools/s3c-check.mjs --only
warning,parts` lo comprueba en la aplicación compilada con un `rt.wasm` cuyas
capacidades se parchean sin el bit (`tools/wasm-features.mjs`, la constante de
`rt_features` en su sitio), en inglés y en español.

**1. La simulación (`rt_phys::wet_parts`, §5.2 vicies de ARCHITECTURE).**
- **Las piezas** son las mallas de las piezas visibles que no mueve la
  simulación, en mm del mundo donde están al empezar, cada una con la
  mojabilidad de la familia de su material (◆1) y las del set como
  **película** (sin gotas una a una: cada muestra se moja en el instante
  sorteado de la exponencial de su flujo; ◆6). Cada triángulo lleva una
  **rejilla de muestras** baricéntrica (celda de 1 mm como poco, que crece
  hasta caber en 150 000 muestras, ◆7; las películas en un tercio como mucho;
  una astilla, por su área; `R` ≤ 255).
- **Llegadas.** El flujo de cada efecto (`densidad × |v| × máx(0, −v̂·n)`) a
  través de cada triángulo, **si nada está en medio** aguas arriba (un rayo
  contra `v̂` por una BVH de los triángulos del mundo): las gotas, por Poisson
  sobre todo el flujo y el triángulo por su parte; el polvo y la nieve, como
  campos por muestra. Qué deja cada efecto: `src/data/wet-parts.ts`
  `PARTS_FEED` (◆2).
- **Gotas.** El casquete de S3b en el plano tangente; **salpican** por encima
  de `K = We^½ Re^¼ = 57,7` (Mundo, Sommerfeld y Tropea 1995) tirando hasta un
  30 % de su agua como 2 gotas por la superficie (◆3); **se juntan** (por
  volumen, incremental: solo las nuevas o movidas, 30 veces más rápido que
  todas con todas); **ancladas** por Furmidge con la gravedad tangente y si no
  **resbalan** de triángulo en triángulo por las aristas compartidas (las
  posiciones soldadas; por un pliegue, a lo largo de él), con el rastro de S3b
  que moja las muestras, se lleva su polvo y les quita agua; **cuelgan** de una
  cara que mira hacia abajo hasta `ρ g V (ĝ·n) > 2π a γ sin θ̄` y **gotean**
  (también por una arista abierta): el goteo cae recto hasta la primera pieza de
  debajo y se posa ahí (a `√(2 g h)`, y puede salpicar) o se va (◆4); lo poroso
  se las **bebe**.
- **Polvo** `1 − e^(−k t)` desde la última limpieza y **nieve** como una capa
  que crece por su flujo (◆5), donde la cara está por debajo del ángulo de
  reposo (polvo 35°, nieve 50°, ±5°) y a cielo abierto.
- **WPT1** (`core/wet-parts.ts` `wptBytes`) y, por fotograma, el registro
  (`WetParts::frame`: las gotas nuevas o cambiadas **por número**, las que se
  fueron, las muestras mojadas y limpiadas, los goteos). La página lo junta en
  la **pista de las piezas** de un clip `PHYSICS` de la **escena** (la caché,
  con la clave `wetPartsKey`), que `partsFrame` rehace en cualquier fotograma.
  `rt.wasm` exporta `wpt_*`. En el *worker* corre con los cuerpos y el cristal
  (los mismos pasos) o sola, y no se para sola (*Parar* o 120 s,
  `MAX_PARTS_SECONDS`).

**2. En el motor (`WETP`, bit 8).** `rt_core::weather`: una sección `WETP` por
instancia mojada con los tres bytes de cada muestra (mojado, polvo, nieve) y
sus gotas (§5.2 vicies). Un impacto los lee lineales sobre su triangulito de la
rejilla; encima del material (con patrones, programa y texturas) van el
**polvo** (un gris pardo mate, más oscuro mojado), la **película de agua** (una
capa transparente de rugosidad 0,03 sobre todo y lo poroso más oscuro: el
albedo a la potencia `1 + mojado × porosidad`, Lekner y Dorf 1988) y la
**nieve** (blanca y mate, `1 − e^(−h / 0,5 mm)`) (◆8); las **gotas** son
casquetes de agua (índice 1,333; 16 × 4) en una malla, instancia y material
más, tras los del archivo, que las sombras cruzan como una pared fina de agua
(una gota no echa un disco negro). Donde no hay nada, el material no se toca:
la imagen no cambia un bit (test). Bit 8, `FEATURE_WET_PARTS` (256;
`/api/info` dice 511); la página manda `WETP` solo a un motor con él
(`SceneView.wetParts`), del fotograma del *pose* (`Pose.parts`).

**3. En *Rápido*** (`render/weather-preview.ts`). Las piezas mojadas se
dibujan con una copia de su geometría sin índices y de sus materiales con un
parche que lee las muestras del fotograma (dos texturas de datos,
`texelFetch`) como el motor y pone las mismas capas con los mismos números; las
gotas, un casquete instanciado por gota. El medidor: *Lluvia en las piezas:
1.443 gotas en 7 piezas*.

**4. La interfaz.** *Ambiente*: el interruptor **Sobre las piezas** (una
entrada de deshacer, guardado con el efecto, `AmbientEffect.wetParts`) en los
efectos que dejan algo, con su ayuda por clase; la barra de físicas: *Piezas:
N gotas · M goteos*; el clip de la escena en la línea de tiempo (*Las piezas
reciben la lluvia, el polvo y la nieve de los efectos de la escena, según la
simulación*), que *Reiniciar* quita. Cadenas en es y en.

**5. Fijados** (§5.2 vicies). Nuevos: `PINNED_WET_PARTS = 0x62450071` (las
piezas de paridad de `rt_phys::example::parts_spec` tras 5 s: una botella de
vidrio, una placa de plástico a 45°, un estante de metal a 20° y una tarjeta de
papel como película, bajo lluvia con viento, polvo y nieve) y
`PINNED_S3C_WET_4SPP = 0x66fa33ab` (`s3c_wet_scene`, con su `WETP`): los mismos
en escalar, SSE2 y AVX2, con 1, 4 y 16 hilos, en `wasm32-wasip1` escalar y
simd128 (`cargo test -p rt-phys --test wet_parts`, nuevo en CI) y en el
`rt.wasm` real (`tools/wasm-parity.mjs`, también con los pases;
`tests/s3c-parts.test.ts` en el paso de CI del `rt.wasm` real). `rt
--write-s3c-wet-example` y `--write-s3c-parts-spec`
(`tests/fixtures/s3c-wet.rsb`, `s3c-parts.wpt1`). **Ningún fijado anterior se
mueve.** `rt-app`: `/api/info` dice 511.

**Tests** (cada uno comprobado con su mutación: la cambia, el test falla, y
pasa sin ella; las que sobrevivieron a la primera pasada se cerraron con un
test más estricto):
- `rt-phys/tests/wet_parts.rs` (17): el WPT1 va y vuelve y uno roto se rechaza;
  las muestras cubren cada triángulo, caben en el presupuesto, una astilla
  gasta por su área y una película cabe en su tercio; el vidrio a 30° se queda
  hasta el radio crítico de Furmidge (± 0,5 % del cálculo en `f64`) y resbala
  por encima perdiendo en el rastro la película de 2 µm que dice; una gota
  cruza de cara en cara y gotea por una arista abierta; juntar suma el volumen
  (± 1 %); el rastro limpia el polvo y la lluvia deja menos; el polvo a 60° <
  10 % del horizontal, a 30° el coseno, mirando abajo nada, bajo un tejado
  nada; la lluvia llega a su flujo (± 4σ), nunca a una cara que mira al otro
  lado ni bajo un tejado; una gota que cuelga gotea al pesar lo que dice y cae
  sobre lo de debajo (salpica desde 44 mm, no desde 12 mm); una gota rápida
  salpica sin perder agua; una película se moja a su ritmo; la nieve se apila
  donde reposa; las mismas piezas por pasos y rehechas de sus fotogramas por
  número; los dos fijados; un `WETP` sin nada no cambia un píxel, solo los
  valores o solo las gotas cambian la imagen, y una actualización sin `MESH`
  tres veces seguidas deja 5 mallas. Mutaciones: media histéresis; sin juntar;
  el rastro que no limpia; sin ángulo de reposo; sin mirar lo que está en
  medio; colgar con el doble de agarre; el goteo que no se posa; el agua
  perdida sin contar; el área de la película sin π; la nieve sin su ángulo; no
  cruzar aristas; el diario de mojadas sin vaciar; sin gotear por la arista; el
  rastro sin película (sobrevivió: se añadió la película perdida); el goteo a
  velocidad 0 o 10 veces (sobrevivieron: se añadió el caso de 12 mm sin
  salpicar); las ids de las gotas idas sin anotar; sin límite por área; la
  película con todo el presupuesto. El flujo con `|cos|` en vez de la cara
  solo lo mata el fijado: casi equivalente, porque la cara de atrás está tapada
  por la propia pieza.
- `rt-core` (`weather::tests`, 5): el `WETP` va y vuelve y uno roto se
  rechaza; un impacto mezcla las muestras de su triangulito; nada encima no
  toca el material y cada capa lo cambia; un casquete es la parte de su esfera
  por encima de la superficie; una gota se malla sobre su pieza y deja pasar la
  luz. Mutaciones: el
  escritor sin `WETP`; las capas ignoradas; los casquetes que no dejan pasar
  la sombra; la actualización que no quita los casquetes viejos (sobrevivió:
  se añadió la actualización sin `MESH`); el triangulito de arriba sin usar.
  `rt-wasm`: el registro de piezas es el nativo. `rt-cli`: la escena con 1, 4
  y 16 hilos, los dos `--write-*` y la comparación con los *fixtures*.
- `tests/s3c-warning.test.ts` (4): el bit 7 (cuándo avisa y cuándo no: polvo
  sí, nieve no, apagado, *A mano*, el efecto apagado, panorámica, cámara
  desconocida) y el bit 8; las cadenas, el inspector y `main.ts`. Mutaciones
  (8): del bit 7, un motor desconocido avisado; sin mirar los efectos que lo
  alimentan; sin mirar *De la escena*; sin mirar la panorámica; `main.ts` sin
  el bit; el inspector que no lo mira al cambiar el motor; del bit 8, un motor
  desconocido avisado; sin mirar los efectos.
- `tests/s3c-parts.test.ts` (17): la tabla (madera y tela añadidas; plástico,
  metal, papel y nieve, los del motor); la familia de un material por su
  categoría o su receta; qué deja cada efecto; solo un efecto con el
  interruptor cae, y se guarda; las piezas visibles quietas, donde están, con
  su familia, y las fuentes; el set, película; el WPT1 byte a byte con el del
  motor; la pista rehace cada fotograma (las gotas por número, mojado, el polvo
  desde la última limpieza); un grupo de caras toma sus muestras en su orden;
  el *pose* dice el fotograma también en 0 y el clip no mueve nada; `WETP` por
  instancia solo para el bit 8; guardado y abierto, una pista rota se quita;
  la barra corre las piezas solas (una entrada; *Reiniciar*, otra,
  deshacible), *Dejar caer* y el efecto sin el interruptor no; una pieza
  *Dinámica* no se moja donde estaba; con el `rt.wasm` real, el fijado de las
  piezas, dos ejecuciones con la misma pista, su último fotograma es el tiempo
  del motor nativo (± 1 del byte del polvo) y la imagen fijada. Mutaciones (8):
  las limpiezas ignoradas; el fotograma mojado corrido en uno; `WETP` sin el
  bit 8; un `WETP` vacío escrito; las piezas que se mueven mojadas
  (sobrevivió: se añadió el test de la *Dinámica*); la receta metálica como
  pintura; una pista rota guardada; el *pose* sin piezas.
- `tools/s3c-check.mjs` (Chromium y SwiftShader): los dos avisos (arriba); la
  lluvia del ejemplo con viento de 3 m/s y *Sobre las piezas* (una entrada de
  deshacer): *Iniciar*, en pausa a los 3 s con *Piezas: 1.443 gotas · 0
  goteos*, el medidor de *Rápido* con las gotas, 334 891 píxeles cambian,
  *Parar* (una entrada), *Reiniciar* la quita y *Deshacer* la devuelve; el
  cromo acromático (también el interruptor) en los dos temas. Captura
  `docs/ui/physics-rain-set.png`.
- La hoja `out/rain-dust-sheet.html` (`tools/rain-dust-sheet.mjs`, con
  `tests/rain-dust-dump.test.ts`) añade tres filas: la botella de ejemplo sobre
  el set del tipo *Perfume*, a 28 mm f/8, con las partículas ocultas a la
  cámara, bajo *Lluvia* sin viento a 0, 2, 5 y 15 s (691, 618 y 690 gotas; 9
  goteos a los 15 s; mojado el 18, el 28 y el 52 % de las muestras), bajo la
  densidad de una *Polvareda* sin viento a 0, 30 y 120 s, y bajo *Nieve* a 0,
  10 y 30 s, cada foto el render de `rt` de la escena con los `WETP` del
  fotograma grabado.

**No encajó con el plan.**
- **La fase partida otra vez.** Las gotas que gotean y salpican no vuelven a
  ser partículas de `rt-sim` que caen por el aire: el goteo cae recto y se posa
  en el mismo paso, y la salpicadura tira sus gotas por la superficie. Las motas
  del polvo donde la cobertura es alta no están (solo la capa). S3d.
- **Las piezas que se mueven no se mojan**: una *Dinámica* se mojaría donde
  estaba al empezar, así que se queda fuera. S3d.
- **El suelo del estudio** (el plano `z = 0`, que no es una malla) no se moja;
  el suelo del set, sí (es una pieza). S3d.
- **Muestras por triángulo, no téxeles ni vértices**: una rejilla baricéntrica
  por triángulo, independiente de las UV (muchas piezas no tienen) y de lo fino
  de la malla. Un triángulo grande de un set (2 triángulos de 700 mm en una
  tarjeta) se queda en una celda de unos 10 mm con el presupuesto de la página,
  y el borde de una sombra de nieve o de polvo en el set se ve en escalones en
  la hoja; la botella, a 1 mm. Una rejilla que siga a la sombra, o partir los
  triángulos grandes, en S3d (◆7).
- **Los aterrizajes son el flujo, no cada partícula del efecto**, como en el
  cristal (S3b): la región del efecto no limita dónde llueve (◆, como S3b ◆5).
  Las partículas de *Ambiente* siguen atravesando las piezas en la imagen.
- **El clip es de la escena** (`target` *Escena*), uno por simulación, no uno
  por pieza; no mueve nada.
- **Las gotas son una instancia aparte** en los pases de pieza y de material
  (la de después de las del archivo), no la de su pieza.
- **La nieve no alimenta el cristal** (S3b ◆4, decidido: no deja nada); en las
  piezas, sí, como capa.
- **El medidor dice *Lluvia en las piezas*** también cuando solo hay polvo o
  nieve (con 0 gotas).
- `rt-app/tests/server.rs` comprobaba `features == 255`; ahora 511.

**Para el veredicto** (regla 11, ◆; decidido en *Decisiones de criterio*):
1. ◆ La familia de cada material (`wettabilityFamilyOf`): las categorías
   *Metal*, *Plástico*, *Vidrio* (y un emisor, como vidrio), *Madera* y *Tela*
   la suya; las demás por su receta (metálica ≥ 0,5 como metal, el resto como
   pintura). Las familias nuevas: madera 85°/40°, bebe 0,01 mm/s, porosidad
   0,6; tela 110°/40°, 0,5 mm/s, 1; el papel bebe 0,05 mm/s con porosidad 1;
   los demás no beben ni oscurecen.
2. ◆ Qué deja cada efecto en las piezas (`PARTS_FEED`): la lluvia y las gotas
   de agua, gotas; motas, polen, polvareda y ceniza, polvo; la nieve, nieve;
   burbujas y confeti, nada.
3. ◆ La salpicadura: hasta un 30 % del agua (de nada en el umbral a todo eso
   al doble), 2 gotas, tiradas hasta 4 diámetros; el impacto moja 2 diámetros.
4. ◆ El goteo: el agarre de una gota que cuelga (`PENDANT_HOLD = 1`), y que el
   goteo caiga recto y se pose en el acto.
5. ◆ La nieve: su ángulo de reposo (50°), el empaquetado (la mitad de la capa
   son copos) y su aspecto (albedo 0,9, rugosidad 0,85, cubre el 63 % a 0,5 mm;
   el byte llega a 5,1 mm).
6. ◆ Las piezas del set como película (`SET_PIECES_AS_FILM`).
7. ◆ El presupuesto: la celda de 1 mm, 150 000 muestras (las películas un
   tercio), `MAX_PARTS_SECONDS = 120` y 4 096 gotas como mucho.
8. ◆ Lo oscuro y lo brillante de lo mojado: la película con rugosidad 0,03, el
   exponente del albedo poroso `1 + mojado × porosidad`; el polvo (albedo 0,42,
   0,39, 0,35; rugosidad 0,9) y su oscurecerse mojado.
9. ◆ Que lo que está a cubierto (bajo un tejado, detrás de la botella respecto
   al viento) quede seco del todo: es la física, sin salpicaduras del suelo ni
   rebotes.

### S3d · Lo que queda de las gotas y el polvo sobre las piezas (simulación) — **Opus** (tras S3c) — propuesta

Lo que queda de S3c, sobre `rt_phys::wet_parts`:

1. **Gotas por el aire**: un goteo y las gotas de una salpicadura vuelven a ser
   partículas que caen (con `rt-sim` de S4a, o un recorrido propio de forma
   cerrada), se dibujan en *Completo*, en el render y en *Rápido* mientras
   caen, y se posan donde llegan (o se van); el goteo deja de posarse en el
   mismo paso.
2. **Las motas del polvo** donde la cobertura es alta (granos sobre la capa,
   en el motor y en *Rápido*).
3. **Piezas que se mueven**: las *Dinámicas* se mojan donde están en cada
   fotograma (las muestras en el espacio de la pieza, su pose del paso) y sus
   gotas se mueven con ellas.
4. **El suelo del estudio**: el plano `z = 0` se moja y empolva (charcos,
   un rastro de goteo), como pieza o como sección propia.
5. **Muestras finas donde hace falta**: partir los triángulos grandes del set
   o una rejilla que se adapte a los bordes de sombra, para que el borde de la
   nieve y del polvo en un set no se vea en escalones (◆7 de S3c).
6. **Los pases**: las gotas con el id de su pieza en los pases de pieza y de
   material.
7. **El medidor**: lo que hay de verdad (gotas, polvo o nieve) en vez de
   *Lluvia en las piezas* siempre.
8. **Criterios**: la hoja con el goteo en el aire y el polvo con sus motas;
   una captura de una pieza *Dinámica* que se moja al caer.

## M5 · Tejido hilo a hilo y pelusa real — **Opus**, veredicto **Fable** (tras E6 y E9; la pelusa tras S8)

Petición del usuario: tipo de tejido (*plain weave*, sarga…) simulado
hilo a hilo y una pelusa editable y real. Dos partes:

**M5a · Tejido.** Material `WOVEN` con tipos de ligamento (`src/data/
weaves.ts`, claves estables): tafetán, sarga 2/1 y 3/1, raso de 5,
panamá, espiga, punto (jersey), gabardina; parámetros: hilos por cm
(urdimbre y trama), anchura de hilo, torsión, color de urdimbre y de
trama, rugosidad de fibra, anchura del brillo, *sheen*, desgaste. Modelo
de sombreado por hilo de Irawan y Marschner, "Specular Reflection from
Woven Cloth", ACM TOG 2012 (público), implementado desde el artículo: el
patrón del ligamento da el segmento de hilo visible en cada punto y el
BRDF del hilo (fibras con torsión) la reflexión; el bump del tejido sale
del mismo patrón (sin texturas). El visor Rápido aproxima con un
*sheen* y el patrón como normal procedural. Reemplaza a la tela
procedural de E6 como «tela realista»; la de E6 queda como «tela
sencilla» (claves estables, no se renombra nada).

**M5b · Pelusa.** Después de **S8** (primitiva de curva, BVH de curvas y
sombreado de fibra en el motor): pelusa **geométrica** generada en el
motor desde parámetros (como `FXAM`: densidad por cm², longitud ±
variación, radio, rizo, gravedad, semilla, solo en caras visibles) en el
material *Pelusa* del inspector, con vista previa de puntos en el visor.
Sombreado de fibra: difuso + dos lóbulos (R y TT) primero; Marschner
después.

**Criterio.** M5a: tafetán, sarga y raso se distinguen a 1 cm de distancia
en la hoja (esferas con `rt`); el brillo del raso es anisótropo y gira
con la trama (test numérico); energía ≤ 1 (horno blanco). M5b: 100 k
fibras ≤ 1,5× el tiempo por muestra; determinismo; hoja con cuatro
densidades.

## U12 · Salida en TIFF y RAW (DNG) — **Sonnet** — hecha

Petición del usuario: que las imágenes puedan salir en TIFF y en RAW.
**Decisión Fable.** RAW = **DNG lineal en coma flotante** (DNG 1.4, TIFF
con `PhotometricInterpretation = LinearRaw`, 32 bits `f32`,
`ColorMatrix1` = XYZ → primarios sRGB lineales (la inversa de la matriz
sRGB → XYZ D65), `AsShotNeutral = 1 1 1`, `BaselineExposure 0`,
`UniqueCameraModel = "Repackshot"`): un revelador fotográfico lo abre
como un *raw* con toda la latitud del render, sin recorte. TIFF: sin
compresión (baseline, *little-endian*), 8 y 16 bits RGB/RGBA y 32 bits
flotante RGB/RGBA (`SampleFormat 3`, lineal), con resolución y sin
perfil ICC (el de 8/16 bits lleva sRGB implícito; el flotante es
lineal, como el EXR). Las especificaciones TIFF 6.0 y DNG son públicas;
nada copiado de ningún lector.

**Qué.** Codificadores en los dos lados, como el EXR: `rt-core::tiff` y
`rt-core::dng` (solo `std`) para el escritorio y el CLI (`rt --format
tiff|dng`), y `src/io/image.ts` (`encodeTiff`, `encodeDng`) para el
navegador, con test de **paridad de bytes** entre ambos. Ventana de
render: formato *TIFF* (bits: 8, 16, 32 flotante; alfa) y *RAW (DNG)*
(sin alfa); el visor de resultados los guarda y los abre (vista previa
desde los datos lineales); `formatExtension`, `supportsAlpha`,
`WRITABLE_FORMATS`; cadenas es/en con una ayuda breve de cada formato.

**Criterio.** Tests: una imagen de 4×4 con valores conocidos escrita en
cada variante se relee bit a bit con un lector mínimo del test (las
etiquetas, los *offsets* y los valores); TS = Rust en bytes; el DNG
contiene las etiquetas obligatorias de DNG 1.4 y la matriz es la
inversa de sRGB→XYZ (producto = identidad ± 1e-6); el visor de
resultados muestra la vista previa de un TIFF de 32 bits; capturas
`docs/ui/render-format-tiff.png`. `UI.md`, `ARCHITECTURE.md` §5,
CHANGELOG.

**Hecho.** `rt_core::tiff` y `rt_core::dng` (solo `std`, de TIFF 6.0 y
DNG 1.4; el constructor de directorios es común: un DNG es un TIFF con
más etiquetas) y, en `src/io/image.ts`, `encodeTiff` y `encodeDng`, que
escriben **los mismos bytes**: `tests/fixtures/tiff/` guarda ocho archivos
(RGB y RGBA a 8, 16 y 32 bits, uno de dos *strips* y el DNG) que
`rt-cli/tests/tiff_golden.rs` y `tests/tiff-dng.test.ts` comparan con cada
codificador, y cada lado se relee con un lector mínimo propio de su test
(etiquetas ordenadas, desplazamientos pares, valores empaquetados,
*strips* sin huecos, cada muestra); los archivos también los abren
ImageMagick/libtiff y PIL, lectores ajenos usados solo para comprobar.
`ColorMatrix1` es la inversa de sRGB → XYZ de los primarios y el blanco
D65, calculada en aritmética exacta y guardada con denominador 10⁷
(producto con sRGB → XYZ = identidad con error < 3·10⁻⁷, el test pide
1·10⁻⁶). La interfaz: `OutputFormat` con `TIFF` y `DNG`, `BitDepth` con 32
(solo TIFF), `bitDepthsOf`, `needsDisplayCopy` y `needsLinearSums` en
`core/render.ts`; el normalizador quita el alfa al DNG y los 32 bits a todo
lo que no sea TIFF; la ventana ofrece *TIFF* (8, 16, 32 bits flotante,
alfa) y *RAW (DNG)* (sin alfa, «32 bits flotante» fijo) con una línea de
ayuda cada uno; el render guarda junto al archivo una copia PNG de 8 bits
para el visor y las miniaturas (como el EXR) y el historial de escritorio
la pide también para TIFF y DNG; el lanzador guarda `image/tiff` e
`image/x-adobe-dng` y escribe `.tif`, `.tiff` y `.dng`; `rt` escribe
`--format tiff|dng` y `--bits 8|16|32` (o por la extensión de `-o`). La IA
(`encodeLinear`) escribe también los dos formatos. Pruebas: 39 de
TypeScript (`tests/tiff-dng.test.ts`, y una más en `ai-results` y en
`render-queue`) y 22 de Rust (`rt-core`, `rt-cli`, `rt-app`), cada una
comprobada reintroduciendo el fallo que vigila; y en el navegador,
`tools/render-format-check.mjs` y `docs/ui/render-format-tiff.png`.

**Qué no encajó con el plan** (regla 12; lo marcado ◆ es del criterio de
**Fable**, que decide si se cambia):
- ◆ `WhiteLevel`: el encargo decía «el máximo del flotante». Un `WhiteLevel`
  igual al mayor `f32` haría que un revelador, al normalizar por él, dejara
  la imagen negra; se escribe **1** (`LONG`, el blanco del render; el negro
  queda en 0 y los datos no se recortan a él, así que la latitud sigue
  entera). Si Fable quería otra cosa, es una constante en cada codificador.
- Los DPI: el encargo fijaba 72; `encodeTiff` escribe los de la ventana (72
  si no se le dan, y 72 fijos en `rt`, que no tiene `--dpi`).
- La copia PNG para el visor se hace también para el TIFF de 8 y 16 bits
  (Chromium no decodifica TIFF de ninguna profundidad), no solo para el de
  32.
- En el DNG, `bitDepth` queda en 8 como en el EXR y el JPEG («la profundidad
  que no se elige»); lo que se ve es una etiqueta fija «32 bits flotante».
- «Un test de DOM como los del visor»: no hay ninguno (vitest corre sin DOM
  y el visor solo se ha probado en el navegador). Hay `previewOf` (lo que
  decodifica el visor, con test), el historial de memoria y el de escritorio
  con TIFF y DNG, y `tools/render-format-check.mjs`, que renderiza en
  Chromium un TIFF de 32 bits y un DNG y comprueba que los píxeles del
  canvas del visor son los del PNG del mismo render.
- La imagen de la IA de un trabajo TIFF o DNG se guarda en su formato pero
  el visor no la compara con el render (no la puede decodificar), igual que
  con EXR (`UI.md`, X3c); la copia para la vista de la imagen de la IA
  sigue pendiente.
- `rt` escribe color solo (sin alfa), como con PNG.

## U13 · Proporción de la imagen en la cámara — **Sonnet** — hecha

Petición del usuario (14-10): editar la **proporción** (16:9, 4:3… o una
propia) **en la propia cámara**, además de en la ventana de render.

**Decisión Fable.** La proporción es **de la cámara**: cada cámara lleva
la suya (`CameraState.aspect: { preset, w, h }`; presets con claves
estables en `src/data/aspects.ts`: `3:2`, `4:3`, `16:9`, `1:1`, `5:4`,
`4:5`, `9:16`, `21:9`, `2:1`, `65:24` panorámica y `CUSTOM` con `w:h`
libres), el **marco del visor** sigue a la cámara activa, y la ventana
de render **lee y escribe la misma** proporción (una sola fuente): el
tamaño en píxeles conserva el ancho y deriva el alto de la proporción de
la cámara activa; teclear los dos lados con el candado abierto deja una
proporción propia **en la cámara**; elegir un preset de tamaño con otra
proporción cambia la de la cámara (y lo dice en una línea). *Nueva desde
la vista* copia la proporción de la activa; el *chip* de cámara del visor
muestra la proporción junto al tamaño (`16:9 · 1920 × 1080`). Animación:
el tamaño de salida sigue siendo el de la ventana de render (un vídeo
tiene un solo tamaño); el Doctor avisa si un plano usa una cámara con
otra proporción. Proyectos antiguos: cámaras sin `aspect` toman la del
tamaño de render guardado.

**Qué.** Sección de cámara del inspector: fila **Proporción** (lista +
campos `w : h` con *Propia*), con la misma fila en el inspector de la
cámara activa de la pestaña *Cámaras*; `camera/set` deshacible; el
marco del visor (`src/render/preview.ts` / `viewport-overlays.ts`) y el
*chip*; la ventana de render (`core/render.ts` `aspect`/`aspectLock`
pasan a derivarse de la cámara: `aspect` deja de ser estado propio
salvo para la animación); guardar/abrir; cadenas es/en; `UI.md`,
`SPEC.md` §3.5, CHANGELOG.

**Depende de.** U5, la sección de cámara (lista con lápiz).

**Criterio.** Tests (mutación comprobada): cambiar la proporción en la
cámara cambia el alto del render y el marco del visor; teclear ambos
lados en la ventana de render deja `CUSTOM` en la cámara con esa `w:h`;
un preset de tamaño con otra proporción cambia la de la cámara; cada
cámara conserva la suya al cambiar de activa; proyecto antiguo sin
`aspect` → la del tamaño guardado; animación: tamaño propio y aviso del
Doctor cuando un plano discrepa. Comprobación de navegador
`tools/aspect-check.mjs` con capturas `docs/ui/camera-aspect.png` (la
sección con 4:3 y el marco del visor cambiado) y
`docs/ui/render-size-from-camera.png`.


**Hecho.** `src/data/aspects.ts` (los diez presets con clave estable y
`CUSTOM`, con su etiqueta es/en) y `src/core/aspect.ts` (`CameraAspect`,
`normaliseAspect`, `aspectNearPixels`, `aspectText`); `CameraState.aspect`
con `aspectRatio(cam)` en `core/camera.ts`, 16:9 por omisión (1920 × 1080
como antes), `camera/set` la lee y la deshace, y `camera/add` (*Nueva desde
la vista*, duplicar) la copia. **Una sola fuente**: la cámara. El tamaño de
una imagen se deriva de ella en `syncOutputSize`, que corre en cada acción
del *store* (cambiar la proporción, cambiar de cámara activa, borrar la
activa, deshacer, abrir un proyecto, volver de *Animación*): conserva el
ancho y calcula el alto; `render/set` en modo imagen es `setSettings`, que
con el candado cerrado deja que un lado siga a la proporción y, con él
abierto o con los dos lados a la vez (un preset de tamaño), **escribe la
proporción en la cámara en la misma acción** (una entrada de deshacer):
el preset de la lista si el tamaño es exactamente uno (`aspectForSize`),
si no `CUSTOM` con esos píxeles como `w : h`, y un tamaño casi de un preset
se respeta tal cual (nada de 1081 que se vuelve 1080 a escondidas). Los
trabajos de la cola para otra cámara con otra proporción salen con el ancho
de la ventana y el alto de esa cámara (`sizedFor`). Visor: el marco (la
máscara, el fondo de imagen y el degradado, el *rsb* de Completo) y el
`placeCamera` de Rápido usan la proporción de la cámara que se ve (activa, o
la que se mira a través: `viewedCamera`), cada pirámide del visor la suya, y
el *chip* dice `16:9 · 1920 × 1080`. Inspector: la fila **Proporción**
(`insp-aspect.ts`: lista y campos `w : h`, apagados con un preset) vive en
`cameraFields`, de modo que sale en la sección de cámara y en la ficha de
cada cámara con una sola línea añadida; la ventana de render dice en una
línea discreta quién manda y qué ha pasado (*La proporción de Cámara 1 pasa
a 4:3*); la lista de cámaras pone la proporción tras la óptica. Proyectos:
una cámara sin `aspect` toma la del tamaño guardado (preset a ≤ 0,5 %, si
no *Propia* con esos píxeles) y el tamaño guardado **no se toca**. El Doctor
gana la comprobación `aspect` (**Proporción de la animación**, la 15.ª,
añadida tras las 14 de origen, con arreglo). Pruebas: `tests/aspect.test.ts`
(33) más las que ya existían y se ajustaron, cada una comprobada
reintroduciendo el fallo que vigila; y en el navegador
`tools/aspect-check.mjs`, con `docs/ui/camera-aspect.png` y
`docs/ui/render-size-from-camera.png`.

**Qué no encajó con el plan** (regla 12; lo marcado ◆ es de criterio y se
deja anotado para quien decide, la regla 11):
- ◆ **El tamaño de la animación es el mismo par `width`/`height` que el de la
  imagen**: «tamaño propio» se ha leído como «no sigue a la cámara mientras la
  ventana está en *Animación*», y al volver a *Imagen* el ancho se conserva y el
  alto sale de la cámara (se pierde el alto que se hubiera tecleado para el
  vídeo). Guardar un tamaño de animación aparte (`animation.width/height`) es
  un campo más si se quiere.
- ◆ **En *Animación* el marco del visor sigue siendo el de la cámara activa**,
  no el del tamaño del vídeo (la decisión dice que sigue a la cámara activa);
  si el vídeo tiene otra proporción, el marco no lo enseña y quien avisa es el
  Doctor.
- ◆ **El arreglo del Doctor** pone a las cámaras de los planos la proporción
  de la salida, no al revés (la salida cambiaría el tamaño de todo el vídeo).
- ◆ **Los términos de una proporción propia son los píxeles tecleados** (1000
  × 700 es *Propia* 1000 : 700, no 10 : 7) y, en el visor y la lista, se
  escriben `1.43:1` cuando no son números pequeños; la razón de una cámara se
  limita a 1 : 512 – 512 : 1 (la de 16 × 8192 y 8192 × 16, lo más extremo que
  admite la ventana), que es un tope mío.
- ◆ **Cambiar la proporción no recoloca la cámara**: el producto puede quedar
  fuera del marco de un 9:16 hasta pulsar *Encuadrar*.
- Restaurar un **estudio** guardado trae la óptica y la vista pero **no** la
  proporción de la cámara en la que cae (la proporción es del proyecto, no del
  estudio); los estudios de la biblioteca y los guardados antes se abren con
  16:9 si no la traían.
- Editar un **trabajo de la cola** (*Guardar cambios*) deja su tamaño tal cual
  y no escribe en ninguna cámara: el borrador es del trabajo.
- `migrateProject` (`parseProject`, el estado sin geometría) vuelve ahora a
  calcular los resultados del Doctor como ya hacía `loadProject`: con el
  catálogo ampliado, los del archivo habrían dejado a los dos distintos.
- Los tests de `tests/primitive-ops.test.ts`, `tests/rsb.test.ts` y
  `tests/render.test.ts` daban un tamaño de render sin la proporción de la
  cámara (un *mock* más permisivo que el programa: allí tamaño y cámara son una
  sola cosa): ahora usan `render/set`, y el proyecto de U1 va sin `aspect` en
  las cámaras, como era de verdad.
- En los extremos (3 : 700 a 1000 de ancho) el alto se queda en el límite de la
  ventana y el par deja de tener la proporción, **sin perder el ancho**: la
  proporción que venga después devuelve el alto (teclear los términos de una
  proporción propia de uno en uno pasa por extremos).

## U14 · Vista en vivo en la cola — **Opus** — hecha

Petición del usuario (punto 3.1 del reporte del 14/15-10, `TODO.md`: «al irme
a queue quiero poder ver un preview en tiempo real de un render
seleccionado»); triaje en `TRIAGE.md` 3.1.

**Qué.** Elegir en la cola el trabajo que **se renderiza** enseña su imagen en
vivo, que se refresca a medida que acumula; uno **terminado** sigue abriendo el
visor de resultados; uno **en espera** dice en una línea que aún no ha empezado
(es/en). La imagen es la del propio trabajo, ajustada a la vista, con las
muestras que dice el motor (regla 10): en el escritorio, las tramas del trabajo
de `/api/render` del lanzador; en la web, la acumulación del *pool*. Un
`onFrame` (o equivalente) en `FrameRequest` con una cadencia acotada; sin frenar
el render (coste medido con y sin la vista, por debajo del 2 %); con la vista
cerrada o con otro trabajo elegido, no se hacen ni se copian imágenes.

**Criterio.** Tests que fallan sin la función: la cola con un render falso que
entrega imágenes (el trabajo en curso elegido las enseña, el terminado abre el
visor, el que espera dice que no ha empezado, quitar la selección para las
imágenes), la cadencia con un reloj falso y el lado del lanzador. `npm run qa`,
`npm run engine:test`, `cargo fmt` y `clippy`; capturas de la cola con un
trabajo en curso en la vista, en los dos temas.

**Hecho.**

- **Dónde: el visor de resultados en modo «en curso»**, no un panel del cajón.
  El cajón mide 240 px: la imagen se quedaría en unos 360 × 200, una miniatura;
  la capa del visor de resultados tiene el tamaño del visor (950 × 530 en la
  ventana de 1600 × 1000). El mismo clic abre el mismo sitio para un trabajo
  terminado y para uno en curso, y al acabar la vista en curso **pasa a ser el
  resultado** sin que nadie haga nada. El cajón no cambia de forma: la fila
  elegida se marca (fondo de pasar el ratón y una barra de tinta), y su texto
  emergente dice *Ver cómo se renderiza*. `ui/panels/live-viewer.ts`, en la
  misma capa (`rv-host`) que `results-viewer.ts`: la ficha **En vivo**, el
  nombre, los datos del motor (*1280 × 720 · 15 de 96 muestras · 0:14 · Cámara
  1*, con *Terminar por tiempo* «0:14 de 1:00»), el estado de la fila con su
  progreso y su barra, una nota y *Cerrar* (`Esc`); la imagen a la proporción
  del render, todo lo grande que quepa, sobre el damero neutro. Uno en espera
  dice *Este trabajo aún no ha empezado: su imagen aparecerá aquí en cuanto se
  renderice* y enseña la imagen en cuanto la cola llega a él (también tras una
  pausa, que lo devuelve a la espera); uno detenido o fallido lo dice; quitarlo
  de la cola se lleva la vista.
- **Estado de la interfaz**, como `resultView`: `ui.liveView` (`{jobId, box}`,
  la caja que el visor midió en píxeles de pantalla) y `ui.liveFrame` (la última
  imagen); nunca a la vez que `resultView`. Comandos `selectJob` (el clic y `⏎`
  de la fila), `watchJob` y `closeLive` (`ui/commands.ts`); `openResult` y el
  recorrido guiado la cierran.
- **El puerto**: `FrameRequest.frameBox(image?)` y `onFrame(frame)`
  (`ui/ports.ts`; lo mismo en `RenderOptions`, `render/engine.ts`). Tipos y
  cadencia en `core/live-frame.ts`: `LiveFrame`, `FrameCadence` (reloj
  inyectado), `LIVE_FRAME_MS` = 500, `LIVE_MAX_BOX` = 960 × 600, `fitFactor`
  (el menor factor entero que cabe, la misma regla que el lanzador) y
  `liveBox`. La cola (`liveTap`, `ui/render-queue.ts`) dice que sí solo
  mientras la vista enseña **ese** trabajo y la pestaña se ve, como mucho cada
  500 ms (la primera al momento, también al abrirla otra vez o al cambiar de
  tamaño) y nunca dos veces la misma imagen (la pasada del lanzador); una imagen
  que llega cuando la vista ya se fue se tira.
- **La imagen** (`render/live-frame.ts`): las sumas reducidas por un factor
  entero con una caja (cada píxel, la media de su caja; en cajas de más de
  2 × 2, de una rejilla de 2 × 2, así que cuesta unas cuatro lecturas por píxel
  sea cual sea el render), cada píxel dividido por las muestras de su baldosa (a
  media pasada el *pool* tiene baldosas con cuentas distintas) y convertida con
  la curva rápida del visor (`DisplayCurve`) con la exposición y la curva del
  render. **Web**: `pathtracer.ts` la hace tras la baldosa que acaba de llegar
  cuando la cola la pide, y la guarda entre dos (`LivePicture`): solo rehace las
  cajas sobre las baldosas que han cambiado desde la anterior. **Escritorio**:
  `native.ts`, tras cada pasada que el lanzador publica, pide
  `GET /api/render/<id>?fit=<an>x<al>`; el lanzador (`rt-app`: `Frame::fitted`,
  `fit_factor`, `parse_fit`, `FLAG_SCALED` = 512) promedia las sumas en el hilo
  de la petición y solo viaja la imagen (640 × 360 × 16 bytes = 3,7 MB en vez de
  14,7 MB de un 1280 × 720); con `data=0` no cambia nada y una caja mal escrita
  es 400 `bad-query`. Un lanzador sin `fit=` mandaría las sumas enteras y la
  página las reduce. Sin vista en vivo solo viajan cabeceras, como antes.
- **Tests** (todos fallan sin la función: 19 mutaciones comprobadas una a una,
  al final de esta lista): `tests/live-view.test.ts` (17: la cadencia y la caja con reloj falso,
  la imagen —media de cajas, rejilla, baldosas sin muestras, cobertura, la
  imagen guardada igual a una nueva y rehaciendo solo lo cambiado—, la toma de
  la cola, la cola con un render falso que entrega imágenes, el motor del
  escritorio contra el lanzador simulado, un lanzador sin `fit=` y uno que
  falla), `tests/pathtracer.test.ts` (1: el *pool* hace imágenes solo cuando se
  le piden, con las muestras de cada baldosa, y el render es los mismos bits), y
  en `rt-app` `render.rs` (2: `fit_factor` y `parse_fit`, `Frame::fitted` con
  cajas cortadas por el borde) y `tests/server.rs` (1: un final pedido con
  `fit=16x16` llega en 16 × 12 con la bandera y las medias de sus cajas).
  `tests/launcher-mock.ts` responde `fit=` como el lanzador. Las mutaciones, cada
  una con algún test en rojo: el clic en una fila que corre o espera solo abre
  resultados; la petición sin la toma; sin cadencia; la toma para cualquier
  trabajo de la vista; el escritorio sin pedir imagen; el *pool* sin hacerla;
  *Cerrar* que no cierra; el trabajo mirado que no pasa a su resultado; el que
  espera sin su línea; la imagen guardada rehecha entera; un solo peso para
  todas las baldosas; la pestaña oculta que sigue pidiendo; la misma pasada
  pedida dos veces; quitar el trabajo sin cerrar su vista; el lanzador simulado
  sin `fit=`; la rejilla que lee las cajas enteras; y en `rt-app`, `fit=`
  ignorado, la media de las cajas del borde sin contar solo sus píxeles y
  `fit_factor` redondeando hacia abajo.
- **Comprobación de navegador** `tools/queue-live-check.mjs` (web y
  `--desktop`, con el lanzador de *release* en `--serve-only`), las dos en
  verde: (a) la fila en curso abre la vista y llegan imágenes con más muestras;
  (b) la fila en espera dice que no ha empezado, sin imagen; (c) `Esc` la
  cierra y, en el escritorio, no hay más peticiones `fit=` (5 con la vista
  abierta, 0 después); (d) la fila terminada abre el visor de resultados; (e)
  el trabajo mirado hasta el final pasa a ser su resultado. Capturas
  `docs/ui/queue-live.png` y `docs/ui/queue-live-dark.png`.
- **Coste medido** (`node tools/queue-live-check.mjs [--desktop] --measure`):
  el mismo trabajo (la botella de ejemplo, visor en *Rápido*, las mismas
  muestras) en pares, uno con la vista cerrada y otro con la vista abierta
  sobre él (cuál va primero se alterna), tras un render de calentamiento; el
  tiempo es el del motor (`data-seconds` del historial) y la CPU la de este
  navegador y este lanzador. **Web** (*pool* wasm de 3 *workers*, 1280 × 720,
  16 muestras, 10 pares): mediana cerrada 11,33 s, abierta 11,53 s (+1,8 %);
  mediana de los cocientes de cada par 0,983 (−1,7 %), entre 0,946 y 1,092;
  CPU, 0,990; 13 o 14 imágenes por render (unas 1,2 por segundo, de
  640 × 360). **Escritorio** (lanzador nativo en 4 hilos, 1280 × 720, 64
  muestras, 8 pares): mediana cerrada 14,97 s, abierta 15,01 s (+0,3 %);
  mediana de los cocientes 1,007 (+0,7 %), entre 0,948 y 1,061; CPU, 1,000; 7 u
  8 imágenes por render (una por pasada) y otras tantas peticiones `fit=`. En
  las dos, el coste queda **dentro del ruido** de la máquina (±5 % de un par a
  otro: es de 4 núcleos y la comparten otros agentes) y por debajo del 2 % en
  las dos lecturas. Lo que cuesta una imagen, fuera del navegador
  (`liveImage`, Node, la máquina cargada): 18 ms un 1280 × 720 entero a
  640 × 360, 41 ms un 1920 × 1080 a 960 × 540; la imagen guardada del *pool*
  solo rehace las cajas de las baldosas que han llegado desde la anterior.
  La primera versión (cada imagen entera, con todas las lecturas de cada caja
  y un tope de 1280 × 800) medía +11 % de mediana en cuatro pares de 1280 × 720
  a 32 muestras (entre −2 y +31 %, con la máquina muy cargada): de ahí el tope
  de 960 × 600, la rejilla de 2 × 2 y la imagen guardada.

**Qué no encajó con el plan** (regla 12):

- Se eligió **el visor de resultados en modo «en curso»** y no un panel en la
  cola (el encargo dejaba las dos): las razones, arriba.
- **En el escritorio la imagen cambia una vez por pasada**, no cada medio
  segundo: el lanzador publica sus sumas al final de cada pasada (1, 2, 4, 8 y
  luego 16 muestras), así que en un render grande la imagen nueva llega cada
  varios segundos; en la web llega baldosa a baldosa. Una imagen a media pasada
  pediría al lanzador un formato de trama con cuentas por baldosa: queda
  anotado.
- **Las muestras que dice la web** son las que tienen ya todos los píxeles
  (`minSamples`): a media pasada hay baldosas con más; en la primera pasada son
  0 mientras faltan baldosas (que se ven transparentes).
- La vista en curso **no tiene zoom ni 100 %**: la imagen está reducida (como
  mucho 960 × 600) y el zoom no enseñaría más; llegan con el resultado.
- La **miniatura** de la fila en curso sigue siendo el icono: no se pidió.
- Los elementos del historial llevan `data-samples` y `data-seconds` (los del
  motor) para que la medida los lea sin redondear.
- `tests/launcher-mock.ts` mandaba sumas antes de la primera pasada; el
  lanzador no (`Frame::is_empty`): ahora tampoco el simulado (era más
  permisivo que la realidad; ningún test dependía de ello).
- En `engine/crates/rt-app/README.md` la tabla de banderas de la trama no
  tenía las de E5b-1 (64, 128, 256): están, con la 512.

## U15 · Flechas y deslizadores en los valores — **Opus** — hecha

Petición del usuario (17-10): «quiero aparte flechas de up y down en todos
los valores, o sliders cuando convenga más. En enfoque creo que se serviría
de ambas. Un slider y al lado el valor con up and down».

**Qué.** Flechas ▲ ▼ visibles en **todo** campo numérico, puestas en el
propio `numberField` para que las lleven todos sus usos: un clic sube o baja
un paso (`Shift` más fino, `Ctrl` más grueso, como el arrastre), mantenidas
repiten tras una pausa, una pulsación entera es un gesto y una entrada de
deshacer, el valor se queda en sus límites y la flecha del límite se apaga,
respeta *deshabilitado*, no arrastra el campo, llama a `onHold`/`onRelease`
y no son paradas de tabulación (el *spinbutton* sigue con el teclado). Que
quepan en las columnas estrechas del inspector, en los tripletes X, Y, Z, en
la línea de tiempo y en las filas de Ajustes **sin recortar nada ni hacer
crecer las filas**, medido en un navegador. Y una **regla escrita** de
cuándo un valor es mejor como deslizador con su campo y sus flechas al lado
(`UI.md` §4.4), aplicada en el inspector, la línea de tiempo, la ventana de
render y Ajustes. La *Distancia de enfoque* de la cámara no se toca: la
rehace la fase F1 como deslizador con su campo, y recibe las flechas de este
cambio.

**Criterio.** Tests del campo (clic con `Shift` y `Ctrl`, mantener, una
entrada de deshacer por pulsación en el *store*, límites, deshabilitado,
escribir y arrastrar, `onHold`/`onRelease`) y un test de navegador de la
disposición en los estados principales, en es y en, a 1600 × 1000 y
1280 × 800, que se comprueba que falla rompiendo el CSS; `npm run qa` en
verde; capturas.

**Hecho.**

- **Las flechas** (`ui/components/controls.ts`, `numberField`): dos
  `button` apilados al final del campo (`.num-steps`, `.num-up`,
  `.num-down`), con los `chevronUp`/`chevronDown` del juego de iconos a
  12 px (1,5 px de trazo), en `ink-2`, `ink-0` con fondo `soft` al pasar el
  ratón y `line` al pulsar; dentro del marco y de su altura, 26 px, sin
  crecer. El relleno derecho del campo (7 px) pasa a ser su columna (14 px
  y 4 px de margen). La pulsación va en `pointerdown` (y `click` sin puntero,
  `detail` 0, para un lector de pantalla o un script: un paso): para la
  propagación (no hay arrastre), evita que el botón tome el foco y se lo da
  al *spinbutton*, captura el puntero en el par (la pulsación acaba donde se
  suelte, también si la flecha se apaga bajo el dedo al llegar al límite) y
  repite: un paso al pulsar, otro a los `STEP_REPEAT_DELAY_MS` = 400 ms y uno
  cada `STEP_REPEAT_MS` = 50 ms; `Shift` y `Ctrl` pulsados mientras tanto
  cambian los pasos siguientes. Todo con el mismo `newGesture('step')`, así
  que el *store* lo junta en una entrada; `onHold` al pulsar y `onRelease` al
  soltar (la vista previa de la IA y la de los plugins esperan). Un campo que
  desaparece bajo la pulsación (su panel se redibuja) o se deshabilita la
  termina. Doble clic sobre una flecha son dos pasos, no la edición; si se
  estaba escribiendo, la pulsación toma lo escrito y sube desde ahí. Se
  llaman *Increase*/*Aumentar* y *Decrease*/*Disminuir*
  (`common.increase`, `common.decrease`), `tabindex` −1.
- **Deshabilitado**: el campo mira también la clase `is-disabled` (la que
  ponen las filas *próximamente* de Ajustes) para el arrastre, las teclas,
  la edición y las flechas, y gana `setDisabled` (`NumberControl`; también
  en `lengthField` y `slider`), que usan los términos de la proporción
  (`insp-aspect.ts`, antes tocaban las props a mano) y los mandos de la lente
  fina con una lente trazada (`insp-lens.ts`: antes se apagaban sus `input`
  pero el campo se seguía arrastrando).
- **Variante compacta** (◆ Fable): un campo con etiqueta en línea (X, Y, Z;
  U, V; H, V) y el campo de un deslizador (`slider()` la pide) llevan un par
  de 10 px con iconos de 10 px, 5 px de relleno izquierdo y márgenes de 3 y
  2 px junto a la etiqueta y la unidad: el valor conserva el sitio de antes
  (en un triplete de 102 px, 47 px de valor, como antes; en el campo de un
  deslizador de 78 px, 59 px frente a 62). Es la propuesta por defecto; la
  alternativa (las flechas solo al pasar el ratón o con el foco) mueve el
  valor o tapa la unidad al aparecer.
- **El campo de tiempo** de la ventana de render (`timeField`) deja de ser un
  `input` de texto y es un `numberField` de segundos que se ve y se escribe
  como `hh:mm:ss` (nuevo `parse` del campo: con él, la edición empieza por el
  texto que se ve): arrastrable, con sus flechas (un minuto; `Shift` 6 s,
  `Ctrl` 10 min), una entrada de deshacer por gesto; lo que no es una hora o
  no pasa de 0 se rechaza, como antes. Sin máximo en el campo (el *store* lo
  limita a una semana): un campo acotado recorre todo su rango en 240 px.
  `tools/doctor-engine-check.mjs` escribe en él con doble clic.
- **La regla y lo convertido** (`UI.md` §4.4; ◆ Fable confirma la lista):
  un valor con rango natural acotado (factor 0–1, porcentaje, ángulo en un
  rango fijo, opacidad) es deslizador con su campo y sus flechas; una
  magnitud física o sin tope (mm, tamaños, potencias, kelvin, cuentas,
  tiempos, semillas) sigue en campo con flechas. Convertidos: **inspector**
  —*Rozamiento* (0–2) y *Rebote* (0–1) de físicas; *Giro* del bokeh
  (±180°), *Inclinación* (±12°) y *Eje de la inclinación* (±180°) de la
  óptica avanzada; el *Ángulo* de un filtro (±180°); el *Ángulo de
  suavizado* (0–180°); el *Ángulo* de un patrón circular (±360°); el *Giro*
  de una textura y de una etiqueta (±360°); en un foco propio *Acimut*
  (±180°), *Elevación* (±89°), *Giro* (±180°), *Dispersión* (1–180°),
  *Ángulo de cono* (1–179°), *Transición* (0–100 %) y *Disco del sol*
  (0–5°)—; **ventana de render** —*Calidad* del JPEG (1–100), *Ruido* de
  *Terminar por ruido* (0,5–5 %) e *Intensidad* de la reducción de ruido
  (0–100 %)—; **Ajustes** —*Velocidad de órbita*, *Velocidad de zoom*
  (25–300 %), *Tamaño del gizmo* (50–200 %) e *Intervención por defecto*
  (0–100), en `SLIDER_SETTINGS` de `settings-rows.ts`—. Los parámetros de
  material ya eran deslizadores hasta 2,5 (`insp-parts.ts`) y los del editor
  de nodos con un rango de 10 o menos; las sensaciones de *Ambiente*, las
  de la IA y las de los plugins ya lo eran. CSS: `.rw .slider .num`,
  `.rw-stack > .slider` (hasta 300 px), `.rw-inline > .slider` (220 px, la
  calidad junto al formato) y `.sw-slider` (hasta 240 px).
- **Tests**: `tests/number-field-browser.test.ts` (10, con la página
  `tests/browser/number-field.html`: el campo, el deslizador y el de tiempo
  reales escribiendo en un *store* real, con el reloj falso de Playwright para
  la repetición): el par en cada campo, a la derecha, dentro, sin pisar el
  valor y sin ser parada de tabulación; clic, `Shift` y `Ctrl`, una entrada
  por clic; mantener (nada antes de 400 ms, luego uno cada 50 ms, `Shift`
  durante la repetición, nada tras soltar, **una** entrada que un deshacer
  quita entera, soltar fuera del botón); límites y flecha apagada (también
  con una pulsación mantenida hasta el máximo y con el teclado); deshabilitado
  y `setDisabled`, también a mitad de una pulsación; `onHold`/`onRelease`;
  sin arrastre, sin edición con doble clic y con el foco en el campo; escribir,
  arrastrar y las teclas; el deslizador y el de tiempo; un clic sin puntero.
  `tests/number-layout-browser.test.ts` (2, uno por idioma): los estados de
  abajo, cada uno a los dos tamaños.
- **Medidas**: en un Chromium real (sin GPU), antes de las flechas ningún campo de los
  estados del ejemplo recortaba nada; con ellas, el test de disposición mide
  por idioma 1 592 campos y 620 deslizadores en 34 vistas (siete estados a
  los dos tamaños y las diez secciones de Ajustes a los dos tamaños), **0
  problemas** en es y en (524 s los dos). El margen más justo entre el valor
  y su sitio es de 13 px (*Automático* en *Hilos*, campo de 110 px), 14 px
  (*-183* en un triplete de coordenadas de 102 px) y 17 px (*fps*, 84 px).
  **Que el test caza un recorte**: con `.num { height: 16px }` a propósito
  (menos que su contenido), el de inglés falla con 3 184 problemas (*its
  content is taller than it (17 > 14)*, *the step buttons are not a stacked
  pair*…); deshecho, vuelve a verde. Y ocho mutaciones del campo, cada una
  con algún test de `number-field-browser` en rojo: un gesto por repetición
  (una entrada de deshacer por paso), sin repetición, las flechas sin
  apagarse en el límite, sin `onRelease`, el arrastre desde las flechas, el
  foco en la flecha, las flechas en un campo deshabilitado y sin `Shift`.
- **Comprobación de navegador** `tools/number-fields-check.mjs`: (a) las
  flechas en todos los campos de la pantalla inicial; (b) un clic en ▲ de
  *Focal* es un paso y una entrada, y mantener ▼ un segundo son muchos pasos
  y otra entrada que un deshacer quita entera; (c) los ángulos de un foco
  propio son deslizadores y *Distancia* y *Potencia* campos; (d) las
  velocidades de *Preferencias* son deslizadores y *Tamaño de la interfaz*
  un campo. Capturas `docs/ui/u15-light-fields.png`,
  `u15-part-triplets.png` y `u15-settings-sliders.png`.

**Qué no encajó con el plan** (regla 12):

- Los tests «en el entorno DOM de los tests de componentes»: vitest corre en
  Node sin DOM y ningún test usaba `numberField`; los componentes con DOM se
  prueban en Chromium a través de Vite (`tests/browser/*.html`), así que los
  del campo son una página de esas, con reloj falso.
- `SPEC.md` no describe el campo numérico: no cambia.
- No se convirtieron, por la regla de no apretar filas: el acimut, la
  elevación, la parte y el tamaño de las luces de un estudio (rejilla de dos
  con etiqueta en línea, `insp-scene.ts`) y las asas de la curva; tampoco
  *Tamaño de la interfaz* ni *Tamaño del texto* (porcentajes, pero
  reescalan la ventana bajo el pulgar mientras se arrastra) ni la dirección
  del viento de *Ambiente* (da la vuelta, sin rango). La hoja de importación
  (el ángulo de teselado) no estaba en las zonas del encargo.
- Un valor largo en un campo estrecho ya se cortaba antes (`overflow:
  hidden` en el valor; en un triplete, más de unos 6 caracteres); la
  variante compacta deja el mismo sitio, no más. El test de disposición mide
  los valores de los estados que abre.
- Los ◆ (la variante compacta, la lista de lo convertido y el ritmo de la
  repetición) están en *Decisiones de criterio*.

## N6 · Despiece configurable y línea de tiempo clara — **Opus**, decisión **Fable** — hecha

Petición del usuario (14-10): en animación faltaban las **explosiones
(despieces)** de un modelo, configurables en velocidad y suavidad, con
piezas **excepción** que no se mueven, y de varios tipos (vertical,
horizontal, radial, esférica…; «investiga tipos»); y **mejorar la
interfaz de animación**: más cómoda, intuitiva, parecida a sistemas
existentes, y que quede claro **qué** se anima y **cómo**.

**Tipos de despiece (investigación).** Las herramientas CAD con vista
explosionada coinciden en tres geometrías básicas y dos modos de orden
(documentación pública de Onshape —*Linear / Radial / Spherical*—,
Fusion 360 —*auto explode: one level / all levels*—, SolidWorks
Composer e Inventor —niveles y direcciones—; observación de caja negra,
ningún código):
1. **Lineal** (`LINEAR`): a lo largo de un eje (vertical = Z;
   horizontal = X o Y; o dirección propia). Dos sabores: *separar* (cada
   pieza se aleja del plano central por su lado) y *apilar* (todas en el
   mismo sentido, repartidas en su orden a lo largo del eje: el despiece
   clásico de un envase con tapón, rosca y cuerpo).
2. **Radial** (`RADIAL`, cilíndrico): alejándose de un **eje** (las piezas
   se mueven perpendiculares a él). Lo que hoy se llama RADIAL pasa a
   ser esférico; la clave `RADIAL` se conserva con su significado nuevo
   solo si ningún proyecto guardado la usa (comprobar); si no, clave
   nueva `CYLINDRICAL` y `RADIAL` queda como sinónimo de la esférica.
3. **Esférica** (`SPHERICAL`): alejándose de un **punto** (el centro).
4. **Por jerarquía** (`LEVELS`): primero los grupos como bloques y luego
   las piezas dentro de cada grupo (*un nivel* / *todos los niveles*),
   combinable con cualquiera de las tres geometrías.
Parámetros: distancia (× tamaño del modelo o mm; *proporcional al
tamaño de la pieza* sí/no), **centro** (centro del modelo, pieza elegida,
pivote, punto propio), eje o dirección, **orden** (a la vez / escalonado
por distancia al centro / por profundidad de jerarquía, con solape %),
**velocidad** (duración) y **suavidad** (curva: lineal → suave → muy
suave, un solo mando que elige y pesa la curva de `EASING_KINDS`),
**excepciones** (piezas fijas: lista que se llena desde la selección o
con *Fijar en el despiece* del menú contextual), conservar la
orientación, invertir (montaje), y el objetivo puede ser el modelo o un
grupo. Las claves `AXIS_X/Y/Z` existentes siguen valiendo (= lineal
separar en ese eje).

**La interfaz de animación** (decisión): el cajón pasa a ser una línea
de tiempo de tres zonas, como el espacio de animación de KeyShot y las
tiras de Blender/After Effects, sin copiar nada:
- **Izquierda, el árbol de lo animado** (*qué*): una fila por objetivo
  (pista de cámara, modelo, grupos, piezas, focos, entorno, set,
  físicas) con sus animaciones anidadas (icono + frase llana: «orbita
  90° · 4 s · suave»); seleccionar una fila selecciona la animación y
  **resalta su objetivo en el visor**; seleccionar una pieza en la
  escena resalta sus filas; botón **+ Animar…** contextual («Animar
  Tapón…») que abre el asistente con el objetivo puesto; menú contextual:
  duplicar, borrar, invertir, partir en el cabezal, fijar en el despiece.
- **Centro, la línea de tiempo** (*cuándo*): regla en segundos y
  fotogramas, cabezal arrastrable, barras con su frase, arrastrar para
  mover y estirar por los extremos, **imán** a bordes de otras barras,
  al cabezal y a los segundos, selección múltiple, pistas agrupadas por
  objetivo y plegables, la pista de cámara con sus tramos.
- **Derecha, las propiedades** de la animación elegida (*cómo*):
  cabecera «Tapón · Despiece esférico · 1,5 × tamaño · 0–3 s», los mandos
  del tipo, la curva con vista previa, inicio/duración/fin, repetir,
  invertir.
- **Visor**: con una animación elegida se dibuja su pista (arco de la
  órbita, flecha del desplazamiento, vectores del despiece, giro) y el
  objetivo resaltado; el cabezal mueve la previa.
- Teclado: espacio reproduce/pausa, Inicio/Fin, ←/→ un fotograma,
  Mayús+←/→ diez, Supr borra, Ctrl+D duplica. Los presets siguen en su
  lista. Cualquier tipo de clip se dibuja igual (también el `PHYSICS`
  que S2 añade: «simulación física · 0–4 s»): el árbol y las barras no
  conocen los tipos, leen la frase y el objetivo.

**Depende de.** N1, U3. S2 añade `PHYSICS` en paralelo: mantener
`MotionClip` y `evaluate` como API y dibujar genérico.

**Criterio.** Tests (mutación comprobada): cada geometría mueve las
piezas por donde dice (lineal separar/apilar, radial perpendicular al
eje, esférica desde el punto, niveles por etapas); las excepciones no
se mueven; el orden escalonado respeta el solape; suavidad lineal vs muy
suave cambian la curva; invertir monta; proyectos antiguos con
`EXPLODE` y `AXIS_*`/`RADIAL` se leen igual que antes (instantánea);
árbol ↔ selección ↔ visor sincronizados; arrastrar y estirar barras con
imán (tests de la aritmética del imán). Comprobación de navegador
`tools/animation-check.mjs` con capturas `docs/ui/animation-timeline.png`
(árbol + barras + propiedades con un despiece elegido y su pista en el
visor) y `docs/ui/explode-types.png` (tira de 4 fotogramas por tipo con
el envase de ejemplo). Hoja `out/explode-sheet.html` para el veredicto
visual. `SPEC.md` §3.7, `UI.md` §2.5, CHANGELOG; cadenas es/en; cromo
acromático; todo por el *store* y deshacible.

**Hecho.** El despiece vive en `src/core/explode.ts` y se evalúa dentro
de `evaluate` (puro y determinista; `MotionClip` y `evaluate` siguen
siendo la API): `explodeMovers` calcula lo que se mueve como una unidad
(una pieza, o un bloque en los niveles), su desplazamiento final y su
ventana de tiempo dentro de la barra, y `evaluate` aplica en cada ventana
la curva del clip. Geometrías `LINEAR` (*separar* y *apilar* en Z, X, Y o
una dirección propia), `CYLINDRICAL` (la radial) y `SPHERICAL`; jerarquía
`NONE` / `ONE` / `ALL` (por etapas encadenadas con el solape, y dentro de
un grupo las piezas se alejan del centro del grupo en proporción a su
tamaño); distancia en × tamaño o mm, reparto igual o por distancia,
proporcional al tamaño, centro (conjunto, pieza, pivote, punto), orden (a
la vez, por distancia con la más lejana primero, por profundidad) con
solape, excepciones (`pinned`, que guarda piezas; fijar un grupo fija las
suyas), conservar la orientación (apagado, cada pieza se inclina hasta
20° sobre su propio centro), objetivo modelo o grupo. Genéricos de
`MotionClip`, opcionales: `reverse` (antes de empezar guarda su estado
final; `poseActive` hace que el visor y el motor enseñen ese estado desde
el fotograma 0), `repeat` (la barra dura `duration × repeat`, `clipEnd`),
`smoothness` (un mando sobre *lineal → suave → muy suave*, mezclándolas, que
escribe en `easing` la más cercana) y `explode`. Acciones nuevas del
*store*, todas deshacibles: `removeClips`, `duplicateClips`,
`setClipTimes` (valores absolutos: un arrastre con su gesto es una entrada),
`splitClip` (las dos mitades siguen una de otra en los tipos que suman o
multiplican), `reverseClips`, `setExplode`, `pinExplode`. Las claves
`LINEAR` y `SPHERICAL` se **añaden** a `EXPLODE_MODES`.

**Decisión sobre `RADIAL`.** Ningún proyecto ni preset guardado usa
`RADIAL`: `MotionClip` no tenía ningún campo de modo (el catálogo
`EXPLODE_MODES` existía, pero nada lo escribía, y el evaluador hacía
siempre «hacia fuera desde el centro»). Aun así `RADIAL` es una clave de
catálogo con un sentido escrito («cada pieza sale hacia fuera desde el
centro» = esférica), y la regla 7 no deja cambiarle el sentido; además el
catálogo ya tenía `CYLINDRICAL` con el sentido exacto de la radial nueva
(«salen en abanico sin subir ni bajar»). Así que **`RADIAL` queda como
sinónimo de la esférica y la radial es `CYLINDRICAL`** (en la interfaz,
*Radial*). `AXIS_X/Y/Z` = lineal *separar* en ese eje; `CUSTOM` (una
dirección por pieza) no se construye y se lee como la esférica, lo que
hacía antes. Un despiece sin parámetros —todos los de antes— es el de
entonces: esférico, **cada pieza la misma distancia** (`EVEN`), desde el
centro, a la vez; `tests/fixtures/explode-legacy.json` se tomó con el
código anterior (seis casos: los dos presets, curvas distintas, `RADIAL`,
el modelo y el cierre movidos y girados, y con un plato giratorio a la
vez) y se lee igual a 1e-9 mm.

**La línea de tiempo** sustituye el cajón de U1 (`src/ui/panels/animation.ts`
con su nombre; `anim-tree.ts`, `anim-timeline.ts`, `anim-props.ts`, y las
órdenes en `src/ui/anim-commands.ts`): tres zonas en una rejilla, el árbol
fijo a la izquierda y la regla arriba mientras las pistas se desplazan;
la pista de cámara con sus tramos (borde arrastrable, cámara del plano y
quitar en su menú, **+** para añadir); barras con su frase, arrastre de
todas las elegidas, estirado por los dos extremos, imán a bordes, cabezal,
cortes de plano y segundos (a menos de 6 px; si no, a fotogramas; `Mayús`
libre) con una línea que dice dónde pega; selección múltiple con
`Ctrl/⌘` y `Mayús`; objetivos plegables; propiedades con cabecera de una
línea, los mandos del tipo y del despiece, excepciones, tiempo (inicio,
duración, fin, repetir, invertir), curva o suavidad con su vista previa;
el asistente de siempre, ahora con el objetivo puesto; presets en su
lista y en la cabecera; bucle y zoom. La aritmética (filas, regla, tramos,
imán) está en `src/core/timeline.ts`; el árbol y las barras solo leen la
frase y el objetivo (un `PHYSICS` se dibuja con un punto por icono y su
frase o el nombre de su tipo). **Visor**: `src/core/motion-hint.ts` da el
contorno del objetivo (el de la pieza bajo el puntero) y la pista en
espacio del modelo —anillo con el ángulo de una órbita y un punto donde
está la cámara, arco de una elevación, flecha de un desplazamiento, un
vector y un punto por pieza de un despiece, eje y giro de un *giro
propio*—, y la previa (`setMotionHint`) la dibuja en la tinta del tema
encima de todo, también en *Completo* y mientras reproduce. El menú
contextual de una pieza gana *Animar Tapón…* y *Fijar en el despiece* /
*Soltar del despiece*. Cadenas es/en; cromo acromático.

Pruebas: `tests/explode.test.ts` (27: la instantánea, cada geometría por
donde dice, las unidades y lo proporcional, los niveles por etapas, el
grupo como objetivo, las excepciones, el orden con solape, la suavidad,
invertir, repetir, la orientación, partir) y
`tests/animation-timeline.test.ts` (18: el imán, la regla, las filas, la
cabecera, árbol ↔ selección ↔ visor en los *stores*, las órdenes y las
teclas, la pista en el visor), cada una comprobada reintroduciendo el
fallo que vigila; en el navegador, `tools/animation-check.mjs` (las tres
zonas, el asistente, el contorno y la pista, las filas marcadas desde la
escena, arrastrar y estirar con imán y deshacer, las teclas, los menús,
cada tipo moviendo las piezas) con `docs/ui/animation-timeline.png` y
`docs/ui/explode-types.png`, y la hoja `out/explode-sheet.html` para el
veredicto visual (◆ Fable: qué valores por defecto y qué aspecto).

**Qué no encajó con el plan** (regla 12; lo marcado ◆ es del criterio de
**Fable**, que decide si se cambia):
- N1 no estaba construido (su encabezado no dice *hecha*): el cajón que
  se sustituye es el de U1 (planos, tarjetas y bloques). N6 trae de N1
  lo que su interfaz necesitaba (invertir, repetir, cabecera, curva con
  vista previa, pista de cámara con tramos); siguen pendientes de N1 la
  curva *personalizada* con asas, `FADE`, `PAN`, `MATERIAL_COLOR`, los
  cambios de cámara con fundido y las animaciones bajo su objetivo en el
  árbol de la escena.
- ◆ Valores por defecto de un despiece nuevo: esférico, piezas, **reparto
  por distancia**, centro del conjunto, a la vez, suavidad 50 %. *Por
  distancia* (la más lejana recorre la distancia, las demás en
  proporción) separa piezas que están del mismo lado, como el cuello y el
  tapón; *igual* (lo de antes) las mueve juntas. La hoja enseña las dos.
- ◆ En el envase de ejemplo la radial sobre Z solo mueve la etiqueta: las
  demás piezas están en el eje (es lo que pide la geometría); la hoja
  enseña también la radial sobre X.
- ◆ *Conservar la orientación* apagado inclina cada pieza hasta 20° al
  alejarse; el brief no decía cómo. Es la constante `EXPLODE_TILT_DEG`.
- Por niveles, el brief separaba *todos los niveles* y el orden *por
  profundidad*; aquí *todos los niveles* ya va por etapas (los bloques y
  luego su interior, encadenados con el solape) y el orden actúa dentro
  de cada etapa; *por profundidad* sirve sobre todo con *piezas*.
- Dos arreglos de comportamiento que cambian proyectos con set (L6) o con
  un despiece sobre un nodo, nunca el ejemplo de la instantánea: antes el
  despiece movía también el fondo y el suelo del set y tomaba su centro
  de toda la escena; ahora las piezas de un set no se despiezan nunca. Y
  un despiece con objetivo *una pieza o un grupo* movía todo el modelo
  (el objetivo se ignoraba); ahora mueve lo que hay bajo el grupo.
- Partir en el cabezal: solo en tipos que suman (giros, distancias,
  despiece a la vez) o multiplican (escala, acercamiento), reproducidos
  una vez y hacia delante; cada mitad conserva la curva, así que la
  posición sigue pero la velocidad no es la de la barra entera.
- Las pistas del visor se dibujan donde está el objetivo en reposo: si el
  modelo además gira, los vectores del despiece no giran con él.
- Sin selección por caja en las pistas ni doble clic para renombrar (las
  barras no tienen nombre propio todavía: su frase lo es).
- El cajón crece a 300 px de alto para las tres zonas.
- *+ Animar…* con el modelo elegido en una escena con set: el fondo y el
  suelo del set son raíces de la escena, así que el modelo no es «todo el
  modelo» (`SUBJECT`, que actúa sobre todas las raíces) sino un nodo, y el
  asistente lo pone como *Una pieza o grupo* (antes *Una pieza*: la etiqueta
  cambia de texto, no de clave). Fuera de esta fase y sin tocar: un giro
  sobre `SUBJECT` (el plato giratorio de los presets) gira también el fondo y
  el suelo de un set, porque gira todas las raíces; queda anotado para L6.
- En las tiras, la base que baja por debajo del suelo se ve oscurecida por
  el suelo de sombras del estudio (está detrás de él desde la cámara).

**Veredicto Fable (14-10).** Aceptado con las elecciones marcadas ◆:
separación por distancia por omisión, el radial sobre Z mueve solo lo que
está fuera del eje (la hoja enseña el radial sobre X), la inclinación de
20° con la orientación libre, el orden de la etiqueta en la pila Z, y la
decisión de claves `RADIAL` (esférica, como estaba) / `CYLINDRICAL` (la
radial nueva), que aplica bien la regla 7.

## P6 · Plugins, y el plugin de película (aintfilm) — **Opus**, decisión **Fable** — hecha

Petición del usuario (14-10): un apartado **Plugins** en *Ajustes* con la
herramienta de añadir plugins a la vista, y como primer plugin
descargable el **motor de simulación de película de aintfilm** (la app de
edición de fotos y simulación de película del mismo desarrollador, en
desarrollo): su motor wasm, sus configuraciones y sus recetas, en la
ventana de render en un apartado *Plugins* después del de IA, con vista
previa, recetas y simulador de grano; el módulo **cifrado**, con el logo
del plugin, un enlace al proyecto (aviso: app en desarrollo, esto es un
adelanto) y la **licencia cerrada** dicha con claridad.

**Decisiones.**
1. **Paquete `.rpk`** (*Repackshot plugin*): `RPK1` + cabecera JSON en
   claro (`id`, `version`, `abi`, `bytes`, `sha256` del cifrado, `nonce`)
   + **AES-256-GCM** (WebCrypto) de un contenedor plano (entradas
   nombre/bytes: `manifest.json`, `plugin.js`, `module.wasm`, `presets/`,
   `logo.svg`, `LICENCE.txt`, `NOTICES.txt`). La **clave de activación**
   (32 bytes, base64) **no está en el repositorio** (el anfitrión es de
   código disponible: no puede guardar secretos): llega por `keyUrl` del
   registro (una URL del desarrollador, que puede rotarla o condicionarla
   más adelante) o la teclea el usuario al instalar. El paquete se guarda
   **cifrado** (IndexedDB, también en WebView2) y la clave aparte; se
   descifra **solo en memoria** al cargar, nunca se escribe en claro. Lo
   que esto protege: el módulo en reposo y en tránsito, y que el paquete
   no sirva fuera de Repackshot sin la clave; lo que no: a quien depure el
   navegador con la clave en la mano. Dicho así en `ARCHITECTURE.md`.
2. **Anfitrión** (`src/plugins/`): registro (`src/data/plugins.json`: id,
   nombre, editor, versión, resumen es/en, licencia `closed`, `homepage`,
   `url` del paquete, `sha256`, `bytes`, `keyUrl`), almacén (IndexedDB),
   cargador (descifra en memoria → `plugin.js` como módulo ES desde un
   Blob URL en un **Worker** sin DOM, con el `module.wasm` transferido;
   `WebAssembly.Module.imports()` vacío exigido para un módulo que lo
   declare), ABI v1 por mensajes: `info`, `presets`, `render({w, h,
   píxeles lineales f32 por planos o RGBA8, ajustes}) → RGBA8 + info`,
   `cancel`. El manifiesto declara dónde entra (`slots: ['render.plugins']`)
   y **sus mandos** (`controls`: clave, etiqueta es/en, tipo
   deslizador/lista/interruptor, mín/máx/paso/defecto, grupo): la interfaz
   del apartado es **genérica** y la dibuja desde el manifiesto; `plugin.js`
   traduce mandos y receta a los ajustes del motor. Un plugin nunca toca el
   DOM ni el *store*: el anfitrión le da píxeles y recibe píxeles.
3. **Ajustes ▸ Plugins** (grupo *sistema*, antes de *Almacenamiento*):
   la lista del registro con logo, nombre, editor, versión, tamaño,
   resumen, **«Licencia cerrada»** y enlace; *Instalar* (descarga →
   comprueba `sha256` → clave por `keyUrl` o pedida → guarda), *Actualizar*,
   *Quitar*, **Instalar desde archivo…** (`.rpk` + clave): la herramienta
   queda a la vista para plugins futuros. Cada plugin instalado muestra su
   licencia completa desplegable y la frase: «El código de este plugin es
   cerrado; la licencia de Repackshot no lo cubre».
4. **Ventana de render ▸ Plugins**, después de *IA*: un bloque por plugin
   con *slot* `render.plugins`. Para el de película: logo, nombre,
   «Adelanto de una app de edición de fotos y simulación de película del
   mismo desarrollador, en desarrollo» con el enlace, licencia cerrada;
   **vista previa** (el resultado actual a tamaño de previa por el motor,
   en el *worker*, con retardo); **recetas** (la lista del plugin por sus
   categorías y con **sus nombres públicos**: aintfilm no muestra marcas
   de fabricantes ni de películas (su regla D112) y aquí tampoco); los
   **mandos** del manifiesto (exposición y forzado, formato de negativo,
   grano: cantidad y tamaño, halación, difusión, copia/escaneo, semilla,
   lo que el plugin declare); **Aplicar** → un resultado nuevo en el visor
   de resultados, como la IA, con `provenance: { plugin, version, recipe,
   controls }`. Los ajustes del plugin viven en los del render
   (`plugins: Record<id, …>`), deshacibles y guardados con el proyecto.
5. **El paquete de película** se construye con `tools/plugins/build-film.mjs
   --aintfilm <ruta del checkout>`: toma `public/engine/itsnotfilm-engine.wasm`
   (compilado reproducible y sin importaciones), las recetas
   (`src/engine/presets/`), el logo (`assets/exported/marks/LOGO.svg`) y
   la licencia de ese repositorio; el `plugin.js` del plugin (el pegamento
   del ABI en C: `inf_alloc`, `inf_render_linear_rgba`… con la regla de
   no retener vistas entre llamadas) se escribe **nuevo** en
   `tools/plugins/film/` (es nuestro; no se copia código del otro
   repositorio al nuestro: lo cerrado va solo dentro del paquete cifrado).
   `tools/plugin-pack.mjs <carpeta> <salida.rpk> [--key b64 | --new-key]`
   empaqueta y cifra. Comprobación de marcas sobre el paquete y las
   cadenas del anfitrión con la lista de *hashes* de aintfilm
   (`scripts/check-brands.mjs` de ese repositorio, ejecutado desde allí).
6. **Publicación.** El `.rpk` como *asset* de la release de Repackshot
   (v0.1.6) y el registro apuntando a él con su `sha256`; la clave la
   guarda el desarrollador (el agente la deja en el *scratchpad* para el
   responsable, nunca en el repositorio) y `keyUrl` queda vacío hasta
   que la aloje: mientras, se pide al instalar.

Tres más del usuario (14-10, con la fase ya construida):

7. **El logo es el de ahora**, no `assets/exported/marks/LOGO.svg` (ese es
   el antiguo y no se usa en ningún sitio): el cartucho de 35 mm como
   rejilla de 16×16 puntos a dos tintas de `src/data/marks.ts` (`LOGO`, con
   las tres columnas de la lengüeta más cercanas al cartucho en la tinta
   tenue, regla M32-02/D50), el que dibuja `src/components/DotGrid.tsx` y
   rasteriza `scripts/build-icons.mjs` en `design/icon/itsnotfilm-1024.png`
   y en la hoja de pruebas `design/icon/aintfilm-mark.png` (la referencia de
   cómo tiene que verse, con el logotipo). `tools/plugins/build-film.mjs`
   construye el `logo.svg` del paquete desde las filas de `LOGO`: un `rect`
   por punto, las dos tintas como dos grises, celdas cuadradas (es vector:
   sin preocuparse del suavizado), con exactamente la misma regla de la
   tinta tenue que `DotGrid`. Después (14-10) el usuario mandó **su logo
   como imagen** (2000×2000, puntos blancos sobre negro: el cartucho de
   frente —eje arriba y abajo, hombros, cuerpo, la banda de la etiqueta como
   hueco— y la lengüeta saliendo a la derecha, con sus tres columnas más
   cercanas al cartucho en tres grises de oscuro a claro y después blanco):
   el `logo.svg` tiene que reproducir ese patrón de puntos exactamente, y se
   comprueba rasterizándolo a 2000×2000 sobre negro con el Chromium local y
   comparándolo con la imagen punto a punto. Si `marks.ts` y la imagen no
   coinciden, gana la imagen: es lo que el usuario llama el logo. El logo va
   sobre una tesela negra u oscura en la tarjeta del plugin, para que los
   puntos blancos se lean en los dos temas.
8. **Las recetas son un carrusel horizontal**, como la tira de película de
   la app móvil: una tarjeta por receta (la miniatura arriba, el nombre
   público debajo, la categoría como etiqueta pequeña), que se desplaza de
   lado con la rueda o el *trackpad* y con las flechas, con la tarjeta
   elegida contorneada, ajuste a tarjeta y fundidos en los dos extremos
   cuando hay más; el cromo acromático, el color solo dentro de las
   miniaturas. La miniatura de cada tarjeta es la receta aplicada a **una
   sola escena de prueba**: una escena nueva de `rt-cli`, `film-thumb`, en
   `engine/crates/rt-cli/src/scenes.rs` junto a `e5-lamp` y
   `e5-glass-bottle` (el frasco de perfume de `glass_bottle` junto a la
   lámpara de mesa de `lamp`, en el cuarto oscuro, lámpara encendida,
   16:10, 320×200), renderizada una vez con `rt` a 512 muestras con
   *denoise* y metida en el paquete como `thumb-base.png` (16 bits lineal u
   8 bits sRGB, lo que prefiera la entrada del plugin). Al cargar el plugin,
   el anfitrión le pide al *worker* la miniatura de cada receta desde esa
   base (guardada en IndexedDB por versión del plugin e id de receta: se
   hace una vez) y enseña un hueco hasta que llega cada una. Esa misma base
   es lo que enseña la vista previa cuando todavía no hay resultado. Si
   cada miniatura es lenta para ~70 recetas, a media resolución (160×100)
   y ampliada por CSS; se dice el tiempo por miniatura.
9. **Animación**: cuando el plugin se aplica a un trabajo de animación,
   cada fotograma pasa por el motor con su propia semilla, `seed = seed0 +
   índice del fotograma` (el campo `seed` del motor), para que el grano sea
   el de una película de verdad fotograma a fotograma y no una capa fija;
   la imagen fija usa `seed0`; la vista previa enseña el fotograma 0;
   `provenance` guarda `seed0` y la regla. Test por fotograma con el plugin
   de prueba (el fotograma 0 y el 1 difieren donde el de prueba usa la
   semilla; el mismo `seed0` dos veces da los mismos bytes).

**Depende de.** U5 (ventana de render, visor), X2 (resultado derivado),
U6 (ventana de ajustes).

**Criterio.** Tests (mutación comprobada): empaquetar → descifrar devuelve
los mismos ficheros; clave errónea y paquete manipulado fallan limpios
(etiqueta GCM); `sha256` del registro comprobado; un plugin de prueba de
los *fixtures* (sin wasm: invierte los píxeles) pasa por el *worker* de
punta a punta y deja un resultado con `provenance`; el manifiesto dibuja
sus mandos; los ajustes del plugin son deshacibles y se guardan.
Comprobación de navegador `tools/plugins-check.mjs` (instala el plugin de
prueba desde un servidor local con clave tecleada; abre *Plugins* de la
ventana de render; aplica) con capturas `docs/ui/settings-plugins.png` y
`docs/ui/render-plugins-film.png` (esta con el paquete de película real
construido desde el *checkout*). `UI.md`, `ARCHITECTURE.md` (§1: los
plugins no son dependencias: los instala el usuario, con su licencia;
§ nuevo: el formato `.rpk`, el ABI y lo que el cifrado protege), `SPEC.md`
§3.8, CHANGELOG, `release-notes` (cómo publicar el `.rpk`).

**Hecho** (2026-10-14). **El paquete** (`src/plugins/rpk.ts`, el mismo código en
la página y en las herramientas por la eliminación de tipos de Node): `RPK1`, la
cabecera en claro de la decisión 1 y AES-256-GCM de un contenedor plano; el
cifrado autentica además la cabecera (menos su `sha256`), así que una cabecera
editada no abre; el `sha256` y la longitud se comprueban antes de descifrar.
`tools/plugin-pack.mjs` (`--new-key`, que solo la imprime, `--key`, `--key-file`)
y `tools/plugin-unpack.mjs`. **El anfitrión** (`src/plugins/`, una capa nueva de
`tests/boundaries.test.ts`: `plugins → core, data`): el registro
`src/data/plugins.json` con su cargador; el almacén en IndexedDB (paquete cifrado
y clave aparte en una transacción; en memoria sin él); la instalación del
registro (tamaño y `sha256` del registro, cabecera con su `id` y su `version`,
la clave que ya tiene una actualización, la de `keyUrl` o la tecleada) y desde
archivo; el arranque (descifrado en memoria, `WebAssembly.compile` y la regla
de `noImports`, `plugin.js` en un Blob URL como Worker de módulo, `init` con el
módulo y los archivos transferidos) y el ABI v1 (`info`, `presets`, `render`,
`cancel`, más `ready`, `cancelled` y `error`); el servicio que pasa un resultado
por un plugin (un EXR como planos lineales de su luz, si no RGBA8; la vista
previa a 480 px; el alfa del origen de vuelta). **Ajustes ▸ Plugins** (grupo
*Sistema*, antes de *Almacenamiento*) y **Ventana de render ▸ Plugins**
(después de *IA*), los dos dibujados desde los datos: el registro y el
manifiesto; los ajustes en `RenderSettings.plugins` (deshacibles, un arrastre
una entrada, con el proyecto; un proyecto anterior tiene `{}`); *Aplicar* deja
un resultado nuevo con `provenance: { plugin, version, recipe, controls, from,
label }`, guardado donde su origen y abierto en el visor comparado con él, que
dice de dónde sale. **El plugin de película**: `tools/plugins/film/manifest.json`
(los mandos de §9 del manual de aintfilm: formato del negativo, exposición y
forzado, color y su modelo, contraste, saturación, calidez, exposición de la
copia, copia o escaneo, grano —cantidad, tamaño, color, sesgo tonal, suavidad,
enfoque del escáner, respuesta a la luz, escaneo—, halación, difusión, objetivo,
motor de grano, semilla), `tools/plugins/film/plugin.js` (nuevo: el ABI en C con
`inf_render_rgba` e `inf_render_linear_rgba` y un registro lateral vacío, sin
retener vistas entre llamadas) y `tools/plugins/build-film.mjs --aintfilm`, que
lo monta y lo empaqueta. **El paquete construido** (con las decisiones 7–9):
`film-0.1.0.rpk`, versión **0.1.0** (la de aintfilm; motor 0.1.0), **1 948 807
bytes**, `sha256`
**`e6b1e2c70beae17375d3eba222a2095fb653cce39264af12a0faa9229216b264`**, 137
archivos y 127 recetas (51 películas, su color solo, 8 granos, 13 filtros, 4
objetivos), fijado en el registro con la `url` de la release v0.1.6 y `keyUrl`
vacío; la clave la tiene el responsable (fuera del repositorio). Tests: 62
nuevos en siete archivos (`plugins-rpk`, `plugins-host`, `plugins-settings`,
`plugins-brands`, `plugins-film`, `plugins-thumbs` y `plugins-frames`; una parte
de `plugins-film` solo donde hay un *checkout* de aintfilm; y que `?testPlugins=`
no esté en una versión de producción), con 44 mutaciones comprobadas (cada una
rompe lo que un test guarda y ese test falla; una más sobrevive a propósito:
quitar la comprobación de la longitud del cifrado, que su `sha256` ya cubre); `tools/plugins-check.mjs` en verde
con el paquete de verdad (instalar del servidor local con la clave tecleada,
una clave errónea, quitar e instalar desde archivo, la vista previa con los
números del plugin, deshacer, *Aplicar*, acromático, recargar) y las capturas
`docs/ui/settings-plugins.png` y `docs/ui/render-plugins-film.png`.
`docs/release-notes/plugins.md`: cómo se publica el `.rpk` y qué se hace con la
clave.

**Hecho, decisiones 7–9** (2026-10-14). **El logo** (7):
`tools/plugins/dot-grid.mjs` escribe el `logo.svg` del paquete, un `rect` por
punto en celdas cuadradas, desde la **imagen del logo del dueño** (`build-film
--logo`: leída punto a punto, sus columnas y filas de puntos por dónde hay tinta
y la tinta de cada uno agrupada en los niveles de la imagen) o, sin ella, desde
las filas de `LOGO` del `marks.ts` del *checkout* con la regla de dos tintas de
`DotGrid`; el SVG antiguo ya no se usa. El del paquete sale de la imagen: 15×15,
121 puntos, la lengüeta en `#808080`, `#BFBFBF` y `#E0E0E0` y el resto `#FFFFFF`,
el punto 0,862 de la celda. **Comprobado** rasterizando el SVG a 2000×2000 sobre
negro con el Chromium local, colocado donde la imagen tiene su rejilla:
**225 de 225 celdas iguales** (la misma clase de tinta y la media de cada punto
igual: diferencia máxima 0), los centros a 1 px como mucho, los cuatro niveles
128 · 191 · 224 · 255 en los dos, el 98,9 % de los píxeles a menos de 24 niveles
y un 96,2 % de solape de la tinta (los puntos de la imagen están dibujados a
mano, no son círculos perfectos). Va sobre la tesela negra de *Ajustes* y de la
ventana de render, en los dos temas. **El carrusel** (8): la escena `film-thumb`
de `rt-cli` (`rt --write-film-thumb`; el frasco y la lámpara salen de
`bottle_meshes`/`lamp_meshes`, y las escenas E5 de los dos siguen dando los
mismos bytes) renderizada a 512 muestras con *denoise* (147 s con 4 hilos) en
`tools/plugins/film/thumb-base.png`; el manifiesto la nombra (`base`); la vista
previa sin resultado es esa imagen por el plugin (Aplicar sigue esperando un
resultado); las tarjetas (`ui/panels/plugin-recipes.ts`) llevan la imagen base
reducida a 160 × 100 por cada receta con los mandos por defecto, hechas una a
una, guardadas en IndexedDB (versión 2, almacén `thumbs`) y entregadas al
momento la vez siguiente. **Tiempo por miniatura**: con el motor de película,
~1 s a 320 × 200 y ~0,2 s a 160 × 100 en Node con la máquina cargada (mediana
de 20 recetas: 963 ms y 199 ms), así que van a media resolución; en el
navegador, las 128 tarjetas en 27 s (0,21 s cada una, de la primera apertura a
la última imagen) y 1,7 s al abrir otra vez. **La semilla por fotograma** (9):
`role: 'seed'` en el deslizador de la semilla (el de película y el de prueba,
que gana un ruido sacado de ella), `frameControls`/`frameSeed`/`SEED_RULE`, el
interruptor **Aplicar a los trabajos de render** (`RenderSettings.plugins[id].
jobs`) y el paso de la cola que manda cada imagen por el plugin; la primera, al
historial con `provenance.seed`. Comprobación de navegador en verde con los
puntos nuevos (`d2_base_preview_and_cards`, `d2_film_cards`,
`d2_film_cards_kept`, `e_jobs_switch_undoable`, `f_carousel_keys_wheel`) y las
dos capturas rehechas.

**No encajó con el plan.** (1) **Los nombres públicos**: el árbol de aintfilm
todavía enseña marcas (su M38-07, el renombrado, está pendiente; su
`check:brands` está en rojo a propósito). Se usó lo decidido allí: una película
es su id neutro en mayúsculas (*CN-01*, D113, desde `stocks-map.json`, hasta
que el dueño elija nombres en M38-10, y entonces hay que reconstruir el paquete),
con su ISO de caja; filtros y formatos, las palabras de D112 (*BLACK DIFFUSION*,
*WARM DIFFUSION*, *SPARKLE*, *PEARL*, *INSTANT 54×86*, *15-PERF 70 MM*); granos
y objetivos, palabras genéricas, con las del diccionario de aintfilm donde las
hay. (2) **La comprobación de marcas**: `scripts/check-brands.mjs` de aintfilm
solo recorre su propia lista de rutas y el *checkout* no tiene `node_modules`
(importa `typescript`), así que no se puede ejecutar desde allí sobre otra
carpeta. Se reescribió su mecanismo, tal como lo describe, en
`tools/plugins/brand-scan.mjs` (lee la lista de *hashes* del *checkout*, que no
se copia) y se comprobó además con las funciones exportadas del propio script
(con un *hook* de resolución hacia un TypeScript del sistema, sin tocar el
*checkout*): los dos dan lo mismo. Limpios: el manifiesto, `recipes.json`,
`plugin.js`, el logo, la licencia y las cadenas de Repackshot. Quedan, dentro
del paquete cifrado y sin enseñarse nunca, las etiquetas internas del motor: el
módulo (15 coincidencias en el último *build*, su `--dist` está en rojo por lo mismo), los ajustes de
los *presets* (490: el tipo de los filtros de difusión y la clave del papel del
modelo espectral, que tiene cada *preset* completo), `engine.json` (3: dos ids de
formato) y `NOTICES.txt` (9, lo que una licencia exige nombrar); son de su M38-07
y M38-08 (renombrar etiquetas de *serde* por parche). (3) **Los *presets* van
completos**, no dispersos: el *build* los lee con `settingsFromValue` del propio
*checkout* (ejecutado con la eliminación de tipos de Node) para que el pegamento
escale valores sin adivinar los valores por defecto de *serde*; son 1,1 MB del
paquete. Una receta de *color solo* trae el grano por defecto del motor (así
rellena *serde* un *preset* que no lo dice): el interruptor *Grano* lo quita.
(4) Se añadieron al manifiesto, sin estar en la lista: `groups` (los títulos de
los grupos), `minLabel` en un deslizador (la regla de aintfilm de que el tope
izquierdo dice *PRESET* y no manda nada), `aux` y `notices`; y al ABI, `init`,
`ready`, `cancelled` y `error`. (5) El logo del registro no puede ir en línea (es
del paquete cerrado): antes de instalar se ve un icono neutro. `homepage` es
`https://aintfilm.app`, el dominio que configura `src/lib/appConfig.ts` de
aintfilm; `publisher`, *Grohle*. La semilla por defecto es la del motor (1).
(6) *Aplicar* guarda la imagen donde se guardó su origen, como la de la IA: en
el navegador es una descarga. Cancelarlo para el *worker* (el render del módulo
es una sola llamada síncrona) y el siguiente uso lo arranca de nuevo. (7) La
vista previa a 480 px enseña el grano de un negativo pequeño (*75 µm por
píxel*): es lo que dice el motor; *Aplicar* lo hace al tamaño del resultado. (8)
Las herramientas necesitan Node 22.18 o posterior. (9) `modelCatalogue()` de
`src/main.ts` lee `?testModels=` con `atob` sin decodificar UTF-8 (un nombre con
acentos saldría mal); el de plugins lo hace bien; el de modelos no se tocó. (10)
El lanzador no cambia (el almacén es IndexedDB también en WebView2) y la prueba
en un Windows real queda en la lista de `docs/release-notes/plugins.md`.

**No encajó con el plan, decisiones 7–9.** (11) **El logo de `marks.ts` no es el
de la imagen**, y no solo en los grises: la rejilla `LOGO` del *checkout* es de
16×16 con 137 puntos (eje de 4, hombros de 10, cuerpo de 12 que pasa por encima
de la lengüeta) y una sola tinta tenue `#4A4A4A`; la imagen del usuario (igual
que el dibujo del dueño de su `design/screens/owner-0912b-film-cartridge.jpg`) es
de 15×15 con 121 puntos (eje de 3, hombros de 7, cuerpo de 9) y tres grises.
Ganó la imagen, como se pidió, pero entonces el logo no puede salir de las filas
de `LOGO`: sale de la imagen, leída por `build-film --logo` al construir (la
imagen es del dueño y va solo dentro del paquete, como su logo: no se guarda en
este repositorio, ni sus filas); sin `--logo` sale el de `LOGO`, que no se
publica (las notas de publicación lo dicen). La regla de `DotGrid` es la del
camino de `marks.ts`. Habría que llevar a aintfilm que su `LOGO` no es el logo
de su dueño. (12) **«Un `rect` por punto» y los puntos redondos**: la imagen y
`DotGrid` dibujan círculos; cada punto es un `rect` con `rx = ry` la mitad de
su lado (un círculo), en su celda cuadrada, para cumplir las dos cosas. (13) La
imagen base es **PNG sRGB de 8 bits**, lo que escribe `rt` (no escribe 16 bits
lineales), y entra por `inf_render_rgba`, como cualquier resultado PNG; la
escena lleva `clamp_indirect` 2: el filamento visto a través de dos vidrios da
cáusticas que el trazador encuentra como *fireflies* incluso a 512 muestras con
*denoise*. (14) Las tarjetas se hacen cuando el bloque del plugin aparece por
primera vez (ahí arranca su *worker*), no al arrancar la aplicación, y la de
*Sin receta* también lleva su imagen; una versión nueva las rehace (la clave es
la versión, no el `sha256`: un paquete distinto con la misma versión se quedaría
las de antes, y por eso el paquete reconstruido aquí, que nunca se publicó,
sigue siendo 0.1.0). (15) **Aplicar a un trabajo de animación no existía**: el
plugin solo trabajaba sobre un resultado del historial, y el historial guarda
solo el primer fotograma de una animación. Se añadió el interruptor *Aplicar a
los trabajos de render* (`jobs`, apagado por defecto), que pasa por el plugin
cada imagen de los trabajos (fijas y fotogramas), después de guardar la del
motor y sin entrar en la barra de progreso. (16) «El índice del fotograma» es su
número en la animación menos uno, no su posición en el trabajo: un tramo
renderizado aparte (3–4) tiene el grano que tiene en la animación entera; la
semilla da la vuelta al rango del deslizador (la del de película llega a 999
999 999). (17) La vista previa no enseña otros fotogramas: es siempre la
semilla puesta, la del fotograma 0. (18) El almacén de miniaturas de IndexedDB
no tiene test en Node (no hay IndexedDB en los tests): la comprobación de
navegador ve que guarda y devuelve (`d2_film_cards_kept`); que *Quitar* las
borre solo lo comprueban los tests sobre el almacén en memoria.

**P6b** (2026-10-14, petición del usuario: el carrusel como la búsqueda de
películas de la app de aintfilm). **Hecho**: un deslizador fino bajo el
carrusel, de su ancho, atado a su desplazamiento en los dos sentidos (sus pasos
son las posiciones de ajuste del carrusel, una por tarjeta y la última su final:
`ui/strip-math.ts`), con la tarjeta elegida marcada en su pista y manejable con
el teclado; y los filtros, que el plugin declara en su respuesta `presets`
(`filters` y los `tags` de cada receta) y el anfitrión dibuja como filas de
*chips* sobre el carrusel, combinados (Y), con la cuenta (*23 de 127 recetas*),
la receta elegida primera y marcada *Fuera de los filtros* cuando la dejan
fuera, y guardados con los ajustes del plugin (`filters`, deshacibles). El de
película trae los de la app (`docs/MANUAL.md` §7 y `src/lib/filmFilter.ts` de
aintfilm): **Tipo** (sus palabras: *COLOR* para el negativo en color, *B&W*,
*DIAPOSITIVA*, *CINE*, por la clase de cada película) e **ISO** (sus tres
bandas, *≤ 100 · 200–400 · ≥ 800*, cortadas en 100 y 400 por la ISO de caja),
más **Grupo** (películas, el color de una película, grano, difusión, objetivo:
los grupos del paquete). Paquete reconstruido con la misma clave: 1 956 072
bytes, `sha256`
`a60dd9edea828f4ed29acd3d29b9ab1ffde384284da8c6a6a6619cc1d6ba3d8a`, versión
0.1.0 (no publicado aún). Tests: 9 nuevos (`plugins-filters`, y uno en
`plugins-film`), 15 mutaciones comprobadas; la comprobación de navegador
arrastra el deslizador, lo mueve con la rueda y con el teclado, y aplica dos
filtros (`f_scrub_slider`, `f_two_filters`). **No encajó.** (1) La app tiene un
tercer filtro, **MARCA**, y no está: son nombres de fabricantes (su D112); el
cuarto, **ORIGEN** (de la app, mías, de otros), aquí solo tendría uno. No hay
más facetas en la app (formato, proceso, época): no se inventaron. (2) *Color /
B&W* es el **Tipo** de la app, con sus cuatro valores: la diapositiva y el cine
también son de color, y la app los separa así. (3) La app dibuja sus filtros
como desplegables en una fila (M31-03); aquí son *chips*, como se pidió. (4) Una
receta sin película (grano, filtro, objetivo) no tiene Tipo ni ISO: solo está en
sus *Todos*, la regla de la app.

## Reporte de errores del usuario (14/15-10) — triaje, B1 y decisiones

El usuario mandó un reporte de errores graves (guardado tal cual en
`TODO.md`, segundo documento). Su triaje, punto por punto contra el código
de `main` (`72e4f79`) y la rama de O2, está en **`TRIAGE.md`**: qué hay
hoy, si se reproduce, si es *bug*, *falta* o *decisión*, causa, arreglo y
dependencias. De ahí salen:

### B1 · Arreglos del reporte — **Sonnet** — hecha

**Qué.** Los fallos confirmados y lo que el usuario pidió sin dejar nada
abierto:

1. **Enfocar con clic (1.8).** El pico ya es el del píxel; lo deshace el
   mismo clic: OrbitControls dispara `end` en cada `pointerup` y
   `src/main.ts` parchea la cámara con `focusDistance: v.distance`. Una
   función pura en `core/camera.ts` (`orbitPatch(cam, view)`): sin parche
   si la vista no cambió; el foco sigue a la distancia de órbita solo si ya
   la seguía (la regla de `view-objects.ts` del *gizmo*). Se usa en
   `onViewChange`, en el gesto y en *Mirar a través*. De paso: `clickAt`
   mide desde la cámara **vista** (`viewedCamera`), no la activa.
2. **Tela a *Nodos* (1.6, de paso).** `outputSetup` de la tela usa
   `fabricMeanColor`, no `(a + b) / 2`: el vaquero no vuelve al gris
   azulado que E6 corrigió.
3. **Extensión `.repack` (4.1).** Lo pide el usuario, así que el cambio
   de contrato de U2 es suyo (regla 12): se guarda `.repack`, el contenido
   sigue siendo el mismo JSON, se abren `.repack` y `.repack.json` (también
   soltándolos en la ventana); el lanzador admite `repack` en
   `WRITABLE_EXTENSIONS` y en sus diálogos; la prueba de Wine y los
   documentos (SPEC, ARCHITECTURE, UI) lo dicen. La asociación del archivo
   en el instalador queda fuera (no se pidió).
4. **Intentos de la IA (2.2).** No hay bucle sin fin en el código (tope de
   4 por variante), pero la cola no lo cuenta: la fila dice «intento *a* de
   4», la variante y el motivo del último fallo, y la barra se reparte por
   intentos. Y la vista previa de la ventana de render deja de reiniciarse
   con cada instantánea del gestor de modelos que no cambia lo instalado ni
   lo listo (hipótesis del triaje: durante una descarga llegan cada 200 ms).

**Criterio.** Cada arreglo con su test, que falla sin el arreglo (regla
3): `tests/camera-focus.test.ts` (vista igual sin parche, órbita con el foco
siguiendo, órbita tras un enfoque con clic); el color de la tela para todos
los `MATERIAL_PRESETS` (falla hoy en `DENIM`, `SATIN`, `MICROFIB`); los
nombres y filtros de `.repack` en la página y en `rt-app` (`files.rs`,
`dialogs.rs`); la fila de la cola y el controlador de la vista previa con
un reloj falso. Una comprobación de navegador en `tools/` que hace el clic
real sobre el frasco del ejemplo y lee *Distancia de enfoque* (en el triaje
pasaba 688 → 660 → 688). `npm run qa`, `npm run engine:test`, fmt y clippy.

**Hecho.** (1) *Enfocar con clic*: `orbitPatch(cam, view)` y
`focusFollowsOrbit` en `core/camera.ts` (sin parche si azimut, elevación,
distancia, objetivo y ancho ortográfico no cambian; el foco sigue a la
distancia solo si ya la seguía), usados por `onViewChange` y por el gesto de
`src/main.ts`, por `lookThroughAction` y por el *gizmo* de la cámara; el clic
mide desde la cámara vista (`focusPickAction` en `core/view-objects.ts`, que
`clickAt` llama: la cámara de *Mirar a través*, o la activa si se mira por una
luz). `tests/camera-focus.test.ts` (11 tests nuevos) y
`tools/focus-click-check.mjs`: el clic real sobre el frasco da 688 → 660 y se
queda (con el `main.ts` de antes, 688 → 660 → 688 y *Mover la cámara* en el
deshacer: 4 de las 8 comprobaciones en rojo). (2) *Tela a Nodos*:
`fabricMeanColor` y `WEAVE_WARP_SHARE` pasan a `core/fabric.ts` (reexportados
por `core/materials.ts`, para que el grafo los use sin ciclo de importación) y
`outputSetup` de la tela los usa; test en `tests/material-graph.test.ts` con
todos los `MATERIAL_PRESETS` (falla en el vaquero, el raso y la microfibra sin
el arreglo). (3) `.repack`: `core/project-names.ts` (`PROJECT_EXTENSION`,
`PROJECT_EXTENSIONS`, `PROJECT_FILTER_EXTENSIONS`, `isProjectName`), el selector
del navegador (`accept` y `types`), el diálogo del escritorio (un filtro con
`repack` y `repack.json`), soltar y *Importar*; `WRITABLE_EXTENSIONS`,
`is_project_name` y las pruebas de `files.rs`, `dialogs.rs` y `tests/files.rs`
en `rt-app`; `packaging/wine-dialogs.mjs` (ejecutada aquí contra una compilación
de Windows del lanzador bajo Wine: pasa, con `RPX_EXT=repack` y el filtro
`*.repack;*.repack.json`); SPEC §3.9, ARCHITECTURE §8, UI.md y la nota de U2.
(4) *Intentos de la IA*: `AiPostProgress` lleva `maxAttempts` y `reason`
(1-based, repartido por intentos); el lanzador saca `lastFailure` en el estado
del *post* y reparte la barra en cuartos (`attempt_range` en `post.rs`), el
servicio sintético y el conductor de wasm igual; la fila dice *IA · mosaico 2 de
4 · intento 2 de 4* (también con la variante) y, debajo, *El intento 1 no pasó:
<motivo>* (`aiStatusText`, `aiWhyText`, es y en); la vista previa de la ventana
de render solo se rehace si cambian los modelos instalados o `ready`
(`previewTriggers` en `ui/ai-preview.ts`; con el reloj falso, 40 instantáneas de
descarga seguidas dan 1 petición y no 40). Cada arreglo con su test, y cada test
falla al reintroducir el fallo (mutaciones comprobadas una a una).

**Qué no encajó.** (1) **El tope es 4 en todas partes** (`MAX_ATTEMPTS` de
`rt-post/job.rs` y `core/ai.ts`, `maxAttempts` del lanzador, el bucle del
sintético): no hay bucle sin fin, y con N variantes son hasta 4 × N intentos. Pero
el conductor de wasm (`runGuarded`) contaba los intentos desde 0 en el progreso
y el resto desde 1: ahora todos desde 1. Lo que ve el usuario sigue sin
reproducirse sin el registro del lanzador (que ahora dice *attempt k of 4
failed*). (2) **La barra por cuartos tiene un coste**: con un solo intento
aceptado la barra de la IA llega a un 23 % antes de que el trabajo acabe y salta
al final (la fila dice *intento 1 de 4*); es lo pedido, pero si queda raro, el
reparto desigual (el primer intento con más barra) es una decisión de criterio
visual (regla 11). (3)
El motivo va en una segunda línea de la fila y en su texto emergente; **no se
tocó el aviso final** (el triaje lo mencionaba): el informe del visor ya lo
dice. La fila de una tarea en curso con reintento crece (el estado y el motivo
envuelven en vez de cortarse) y se reparten las columnas de la cola (el nombre
cede ancho al estado). (4) **Foco con clic**: no se tocan el plano de foco con
*tilt* (b del triaje) ni el pico a través de la distorsión de una lente trazada
(O2); con un plano de la animación con el cabezal fuera de 0 el clic mide desde
la cámara vista sin la pose (ese foco lo anima el plano de todos modos). (5)
**`.repack`**: sin asociación del archivo en los instaladores (no se pidió);
guardar sobre un archivo abierto lo escribe donde está, con el nombre que
tenga (un `.repack.json` sigue siéndolo); `tools/desktop-window-check.mjs` y
`desktop-platform-check.mjs` ahora guardan `.repack`, pero no se pudieron
ejecutar aquí (piden el lanzador de *release* y su ventana). (6) **Hallazgo
fuera del encargo**: al pasar a *Nodos* un plástico translúcido con dispersión
interna (`HDPE_WHITE`, `PP_NATURAL`, `PMMA_FROST`) el grafo pierde el medio
(`kind`, `scatterMm`, `scatterColor`, `scatterG`: el grafo no tiene entradas para
ello); el color base sí coincide ya en todos los materiales. (7) Un *mock* más
permisivo que la realidad: el estado del *post* de `tests/ai-desktop-service.test.ts`
no llevaba `lastFailure`; ahora sí.

**Pendiente del usuario** para cerrar lo que no se pudo reproducir:
el registro del lanzador (`<datos>/logs/repackshot.log`) de una pasada de
IA que se quede en intentos (2.2), y una escena guardada donde el
*denoise* lave luces y colores, con y sin él (4.2: medido en el ejemplo,
cambia la luminancia y la saturación media en menos del 0,1 %).

### Con O2

- O2 dibuja en *Rápido* la distorsión de una lente trazada, pero el pico
  usa el rayo sin distorsión: con un gran angular o el ojo de pez el clic no
  cae bajo el cursor. Arreglado en O2 (`593d480`: un solo mapa en
  `render/lens-profile.ts` para el pase de pantalla y el pico).
- **1.3** (elegir lente, distorsión y bokeh de verdad) es O2.
- **1.4** (ventana con los elementos al pasar por una lente de la lista)
  va tras O2: el corte en SVG ya existe; falta el aviso flotante y pedir al
  motor la información de la lente señalada (S–M, Sonnet). Hecha en **O2b**.

### Faltas que ya tienen fase

- **1.1 y 5.1** (tipo de mapeado, tamaño, desplazamiento, tamaño relativo
  al sólido): los mandos de M2a existen, pero solo salen con una imagen en
  la ranura; *Completo* y *Render* los dibujan desde **M2b** (hecha). Lo
  demás de 1.1 y la decisión de 5.1 siguen pendientes.
- **1.6** (los nodos no pilotan el material en *Completo*, el modo por
  defecto): **M3b** (hecha).
- **3.1** (vista en vivo del render seleccionado en la cola): fase nueva
  **U14** (Opus, M), tras B1 porque los dos tocan la fila de la cola: el
  trabajo en curso enseña sus fotogramas al seleccionarlo (escritorio: los
  del trabajo de `/api/render`; web: la acumulación del *pool*), sin frenar
  el render (coste medido); los terminados siguen abriendo el visor.
  **Hecha**: ver U14.

### Decisiones de criterio (antes «Decisiones para Fable»)

**Desde el 17-10 las toma el responsable**, por indicación del usuario («toma tú las decisiones de fable»). Los agentes las siguen preparando y anotando con ◆, y no las toman por su cuenta (regla 11). Esta lista recoge lo decidido. Cada entrada dice si basta lo que hay o qué fase lo construye. Los datos de partida siguen en `TRIAGE.md` y en el párrafo de cada fase.

**Fases que salen de aquí:**
- **C1** · Decisiones de criterio aplicadas: los cambios pequeños de esta lista, en un solo PR. **Hecha**: ver C1, abajo.
- **C2** · Interruptor de la focal (1.7). **Hecha**: ver C2, abajo.
- **M3c** · Nodos *Madera* y *Tela* (1.6). **Hecha**: ver M3c, tras M3b.
- **M3d** · La madera de la familia en *Rápido* por el camino del nodo *Madera* (M3c ◆3). **Hecha**: ver M3d, tras M3c.
- **M3e** · Los nudos de *Rápido* donde los pone *Completo* y la tela horneada cuando sus hilos se leen (M3d ◆1 y ◆2). **Hecha**: ver M3e, tras M3d.
- **N2b** · El estudio viaja con el proyecto. **Hecha**: ver N2b, tras N2.
- **O2c** · Editor de elementos de la lente (1.5). **Hecha**: ver O2c, tras O2b.
- El 1.2 entra en **S3**. (hecho en S3)
- **S3b** · El resto de S3 (la lluvia que se posa y resbala, el polvo que se asienta, el cristal alimentado por la escena, la simulación en el *worker* con caché), con la *Forma* fuera de *Avanzado* y el cristal aproximado en *Rápido* (S3 ◆5 y ◆9). **Hecha en parte**: la *Forma*, el cristal en *Rápido* y todo lo que pasa en el cristal frontal; lo de las piezas, **S3c** (ver S3b y S3c, tras S3). **Hecha en parte**: ver S3b (el cristal frontal); el resto, S3c.
- **S3c** · Gotas y polvo sobre las piezas: la lluvia que se posa, resbala y gotea por las mallas, la nieve, la marca mojada en el material y el polvo por pieza (S3b, «S3c»); y un aviso cuando el motor no tiene el bit 7 y el cristal de la escena saldría limpio. **Hecha en parte**: el aviso (y el del bit 8) y todo lo que pasa sobre las piezas quietas, en el motor y en *Rápido*; las gotas por el aire, las motas del polvo, las piezas que se mueven y el suelo del estudio, **S3d** (ver S3c y S3d, tras S3b). **Hecha en parte**: ver S3c; el resto, S3d.
- **S3d** · Lo que queda de las gotas y el polvo sobre las piezas: goteo y salpicaduras que caen por el aire, motas de polvo, piezas dinámicas mojándose, el suelo del estudio, muestras más finas en el set, el id de pieza de las gotas y el texto del medidor (S3c, «S3d»).

- **O2** (la hoja de la lente trazada). Se acepta tal como está:
  - qué lentes dan ojo de gato, burbuja, cremoso y remolino;
  - las prescripciones y los diafragmas supuestos;
  - las constantes del adaptador anamórfico;
  - las focales de los gráficos;
  - el muestreo por máscara.

  Solo se revisa si un render real lo desmiente.
- **2.1** (la guarda de la IA). El usuario dice que la fase de IA «no hace casi nada» (`TODO.md` §2.1), y la guarda es casi invisible por diseño. Por eso:
  - se **doblan las tolerancias** de la guarda por defecto;
  - la **intervención por defecto pasa de 30 a 50**.

  Las dos siguen en *Ajustes*. **C1.** (hecho en C1)
- **1.7** (el interruptor de la focal). Es un interruptor junto a la focal, *Mantener el tamaño de lo enfocado*:
  - **apagado** (por defecto, como en una cámara): la cámara se queda y cambia el encuadre;
  - **encendido**: la cámara se acerca o se aleja por su eje para que el plano enfocado conserve su tamaño en la imagen, es decir, cambia la perspectiva y no el tamaño.

  El inspector dice cuál está activo. Es deshacible de una vez. **C2.** (hecho en C2)
- **6.1–6.3** (los sets dentro de *Estudios*, sus luces desactivables). **Cerrado por L7.** Los sets son su propio grupo, y cada foco se enciende y apaga en la lista *Luces* sin tocar el resto.
- **5.1** (el tamaño de texturas y procedurales). **En milímetros**, absoluto, como ya hace E6. *Ajustar a la pieza* queda como opción. El tamaño manual escribe esos milímetros. SPEC l. 456 se corrige para decir lo mismo que l. 101 y E6. **C1**: comprobar que el código ya lo hace así y corregir la SPEC. (hecho en C1)
- **E13** (MNEE). **No se fusiona.** Cuesta 1,8–2× con vidrio curvo y no mejora lo que se ve. Las cáusticas siguen en el mapa de fotones. La rama `wip/ccr-8df3f848/e13` se queda como referencia.
- **E10** (el muestreo adaptativo). **Se acepta**, con 0,83× a igual tiempo: está solo detrás de *Terminar por ruido* y no empeora nada. La regla de reparto se revisa si un render real lo pide.
- **1.2** (la gota y la mezcla de geometrías en *Ambiente*). **Sí.** Entra en **S3**, la fase de lluvia y polvo, que es la que ya toca esas geometrías. (hecho en S3)
- **S4b** (las partículas de ambiente). Se acepta todo lo propuesto:
  - el lóbulo hacia delante, a 0,5;
  - el coste de la lluvia (1,63×), que solo se paga con lluvia;
  - el grano en los rastros bajo luz lateral;
  - la regla de los caminos estrechos, en los que las gotas también refractan.
- **1.5** (el editor de elementos de una lente). **Sí**: editar, mover, añadir y girar 180°, sobre la lente propia que ya guarda O2. **O2c.** (hecho en O2c)
- **1.6** (nodos *Madera* y *Tela*). **Sí**, con las recetas de E6. El ejemplo de madera de los grafos tiene que parecerse a la familia *Madera* (`m3b-wood.png`). **M3c.** (hecho en M3c)
- **M3b** (`NORMAL_MAP` con el azul por debajo de 0,5). El nodo **no deja que una normal apunte hacia dentro**: la lleva al hemisferio de fuera. El ejemplo de los copos se rehace con normales hacia fuera. **C1**, con su test y, si cambia el motor, con los pines que se muevan explicados. (hecho en C1)
- **4.2** (el recorte de *fireflies* y el borde del *denoise* solo por luminancia). **Se quedan como están** hasta tener la escena del usuario. Sin ella no hay con qué medir.
- **Q1** (la sección):
  - el control sigue en el inspector de *Escena*, y en la paleta;
  - la tapa de un vidrio cortado **refracta**, como ahora, que es lo físico;
  - el estudio **no se corta nunca**.
- **K1** (las recetas de interior y el Doctor de interiores):
  - se aceptan las cifras de las siete recetas;
  - la **de partida del tipo *Interior* es *Ventana de mediodía***;
  - se aceptan los umbrales del Doctor tal como se propusieron: escala de 100 mm a 30 m, óptica por debajo de 18 mm (aviso desde 24 mm), altura de ojo de 0,3 a 2,2 m (a 1,5 m), recorte cercano a la mitad de la distancia a la pared.

  **C1** pone la receta de partida. (hecho en C1)
- **D1** (el Doctor de motor):
  - recortar con *Estándar* es un **aviso**, no un fallo, porque los fondos blancos planos lo buscan;
  - el arreglo propone **AgX**;
  - se aceptan los umbrales de los *fireflies* y del presupuesto;
  - el aviso del vídeo se despierta, porque N1 ya está hecho;
  - el del *denoise* sigue como está.

  **C1.** (hecho en C1)
- **N1** (la animación). Se acepta todo lo propuesto:
  - el orden del asistente, primero el objetivo;
  - qué es un *Fundido*;
  - el polo del arco solar;
  - la forma del fundido a color;
  - la calidad automática del vídeo.
- **L7** (*Sets* y *Luces*). Se acepta la clasificación, el filtro *Tipo de producto* solo en *Sets*, el filtro *Sujeto*, que un set nuevo sustituya la decoración y los tres tamaños de miniatura. Un cambio: **no se pregunta si los focos que hay son los del tipo de producto sin tocar**; se sustituyen sin más. **C1.** (hecho en C1)
- **H1** (los grises auxiliares):
  - se acepta **4,5:1** (WCAG AA) para el texto secundario;
  - el texto principal sigue en 7:1;
  - la jerarquía de grises no se aplana.

  Si algún par del informe de H1 queda por debajo de 4,5:1, se sube ese par. **C1.** (hecho en C1)
- **U15** (las flechas):
  - la variante compacta, siempre visible (el usuario pidió flechas en todos los valores);
  - la lista de lo convertido a deslizador, tal cual;
  - la repetición, 400 ms y luego cada 50 ms.
- **N2** (pases, lotes y ZIP). Se aceptan:
  - el alfa como máscara de objetos, sin el suelo;
  - los cuatro pases;
  - las codificaciones;
  - el ZIP apagado por defecto;
  - el orden cámara por cámara.

  Un recorte con textura dará cobertura parcial cuando el motor la tenga. Un cambio: **el estudio de un trabajo viaja con el proyecto**, guardado dentro, para que un proyecto abierto en otro equipo no falle sus trabajos. **N2b.** (hecho en N2b)
- **K3** (la cámara de interiores). Se acepta todo lo propuesto:
  - las alturas de ojo, 1,5 y 1,1 m;
  - las ópticas de interior, 24, 28 y 35 mm;
  - la medida automática;
  - los presets de EV 7 y 5, con su calibración;
  - el exterior, de 0,05 a 1, con 1 por defecto;
  - que *Interior* encienda las verticales rectas;
  - el campo del ojo de pez, medido en la diagonal.

- **F1** (enfoque por punto y por objeto): el *Objeto* sigue el centro de su caja; el rango y la escala logarítmica del deslizador, como están; en *Punto* y *Objeto* **mover el deslizador pasa a *Distancia***; el mejor foco de la lente trazada por el contraste de detalle fino, como está (la esquina con distorsión +1 queda abierta); un clip de foco gana; el clic en un vidrio enfoca su cara delantera. **Hecho en F1.**
- **N2b** (el estudio viaja con el proyecto). Se aceptan las cuatro tal como están: la copia gana sobre un estudio de la biblioteca con el mismo id y otro contenido; editar un trabajo sin cambiarle el estudio conserva su copia; *Añadir a mi biblioteca* guarda con su id, no se deshace y vive en el cajón *Cola*; el esquema sigue en 2. **Hecho en N2b.**
- **C2** (interruptor de la focal). Se aceptan las seis tal como están: el interruptor va en cada cámara (viaja con ella al proyecto y a los estudios); una cámara bloqueada cambia la focal sin moverse; el objetivo de la órbita avanza por el eje cuando la cámara quedaría a menos de 0,1 × distancia × f′/f; las ópticas de interior pasan por el interruptor, los presets de lente siguen encuadrando el producto y los clips *ZOOM* no se mueven; la fila va debajo de *Focal*; con ortográfica o panorámica el interruptor sigue usable, no hace nada y lo dice. **Hecho en C2.**
- **O2c** (editor de elementos de la lente). Se acepta tal como está: el elemento nuevo por defecto (radios ±4 f, 4 % de f de grosor, el vidrio de la lente simple del catálogo, tan ancho como el vecino más estrecho, centrado en el hueco), los márgenes (1 % de f de aire, 5 % delante y detrás, 1e-3 mm en los bordes), el paso del 10 % de *Más pequeño · Más grande* y el umbral del círculo de imagen (luz relativa 0,001). Un círculo que no cubre el encuadre **no impide aplicar** (el viñeteo fuerte es un aspecto que se puede querer, y el render lo enseña). La lente editada **conserva el recorrido del diafragma** de la del catálogo. **Hecho en O2c.**
- **M3c** (nodos *Madera* y *Tela*). ◆1, la pelusa: se queda como está, una salida numérica de la *Tela* que se puede usar en el grafo; la entrada de pelusa de la salida de material (la 16 del programa) llega con **M5**, cuando el motor pinte la pelusa, no antes. ◆2, la tela bajo un bisel: se acepta como está (fuera del radio de bisel, los mismos bits que la familia; su propio fijado). ◆3, la madera de la familia en *Rápido*: **sí**, que se hornee por el mismo camino que el nodo, para que la madera en escena se vea como en las esferas también en *Rápido*: **M3d**. Lo demás (vista desde dentro, el bit de la normal, los nudos contra la caja en *Rápido*, el color medio, la semilla copiada al convertir), como está. **Hecho en M3c**, salvo M3d y lo que va a M5.
- **M3d** (la madera de la familia en *Rápido*). Se acepta como está: la familia se hornea por el camino del nodo y da sus mismos píxeles. ◆1, los nudos: **(b)**, la capa de nudos de E6 (la de cada pieza, la que coincide con *Completo*) encima de un horneado sin nudos, para la familia y para el nodo; que los nudos de *Rápido* caigan donde los pone el render pesa más que el horneado los traiga. ◆2, la tela: **(b)**, se hornea solo cuando un hilo ocupa al menos 2,5 texels, con la pelusa (*sheen*) encima; por debajo se queda como hoy, sin moiré. Los dos, en **M3e**. **Hecho en M3d**, salvo M3e.
- **M3e** (los nudos y la tela en *Rápido*). Se acepta como está. ◆1, el umbral: **se queda en 2,5 texels por hilo**; a 2 se roza el límite donde sale el moiré, y el lino y el fieltro sin hornear se leen bien en *Rápido*. ◆2, el nudo encima: **se queda el disco oscurecido**; *Rápido* es una vista previa, y la testa, la grieta y la veta alrededor salen en *Completo*. **Hecho en M3e.**
- **S3** (la gota, la mezcla de formas y el cristal frontal; primera parte). Se aceptan ◆1–4, 6 y 8 tal como están: la gota de 1,6 radios con punta de 0,15; la punta detrás de la velocidad (la lágrima que pidió el usuario, aunque una gota real caiga casi redonda); la mezcla 1 : 1 : 1 : 2; el preset *Gotas de agua*; las cifras y los rangos del cristal; las motas que solo absorben. ◆5: **sí, la *Forma* sale de *Avanzado*** a los mandos visibles, porque el usuario la pidió y escondida no se encuentra; va en **S3b**. ◆7: **se queda la física**, sin un mando no físico que afile las gotas: con la lente y el diafragma que lo piden (angulares, diafragma cerrado, cristal lejos) se leen; se revisa con un render real del usuario. ◆9: *Rápido* no dibuja el cristal en esta parte; una aproximación (las gotas como discos) va en **S3b**. **Hecha la primera parte en S3**; el resto, S3b.
- **S3b** (el cristal frontal alimentado por la escena; la *Forma* visible; el cristal en *Rápido*). Se acepta tal como está: ◆1, las mojabilidades por familia (vidrio 70/50, plástico 90/65, metal 80/50, papel 100/20, pintura 85/60); ◆2, el deslizamiento (C = 300, tope de 250 mm/s, película de 2 µm); ◆3, el ángulo de reposo del polvo de 35° ± 5°, y un cristal vertical sin polvo; ◆4, la nieve, las burbujas y el confeti no dejan nada en el cristal (la nieve, con su capa, en S3c); ◆5, la región del efecto no limita el cristal, y una lente que mira hacia abajo se queda seca sin viento, como dice la física; ◆6, **no hay un mando de intensidad no físico** (como S3 ◆7): con las densidades de los presets el polvo apenas se ve a los 120 s, y quien lo quiera sube la densidad; ◆7, la aproximación de *Rápido* tal como sale de la óptica; ◆8, `MAX_GLASS_SECONDS` = 120. El aviso de un motor sin el bit 7 va en **S3c**. **Hecho en parte en S3b**; el resto, S3c.
- **S3c** (la lluvia, el polvo y la nieve sobre las piezas; el aviso del bit 7). Se acepta todo tal como está: ◆1, la familia de mojabilidad de cada categoría (`wettabilityFamilyOf`) y los valores de madera (85/40, absorbe 0,01, porosidad 0,6), tela (110/40, 0,5, 1) y papel (absorbe 0,05); ◆2, lo que deja cada efecto (`PARTS_FEED`); ◆3, la salpicadura (hasta el 30 % del agua, 2 gotas, a 4 diámetros; un impacto moja 2); ◆4, el colgado = 1 y el goteo que cae en el mismo paso (la caída por el aire, en S3d); ◆5, la nieve (reposo 50°, empaquetado 0,5, albedo 0,9, rugosidad 0,85, cubre a 0,5 mm); ◆6, el set se moja como película; ◆7, los presupuestos (celda de 1 mm, 150 000 muestras con un tercio para películas, 120 s, 4096 gotas); ◆8, lo oscuro y brillante que se pone lo mojado (película a rugosidad 0,03, exponente del albedo 1 + mojado × porosidad) y el color y la rugosidad del polvo; ◆9, lo resguardado se queda seco del todo. **Hecho en parte en S3c**; el resto, S3d.

**1.9** (doble barra en el carrusel de LUTs de aintfilm) es de otro
repositorio; el triaje anota que Repackshot también dibuja el carrusel de
recetas del plugin, sin barra vertical.


## C1 · Decisiones de criterio aplicadas — **Opus** — hecha

**Qué.** Los cambios pequeños de *Decisiones de criterio* marcados **C1**, en un solo PR: 2.1, 5.1, M3b, K1, D1, L7 y H1.

**Hecho:**

- **2.1 · La guarda de la IA.** Valores de fábrica: *Intervención* 50 (era 30) en `DEFAULT_AI_PIPELINE`, en `Settings::DEFAULT` de `rt-post` y en *Ajustes* (`ai.intervention`); las tolerancias, el doble: ΔE₀₀ medio 4 y percentil 95 6 por material, y bordes 4 px en *Ajustes* (`ai.guard*`, eran 2, 3 y 2) y en el servicio sintético (`SYNTHETIC_LIMITS`); en la guarda del motor (`Tolerances::PROVISIONAL`) 4, 6 y **3 px** (era 1,5). `AI-POST.md` §3.2 y §4 lo dicen. *Migración*: el documento de *Ajustes* guarda todas las claves y `validateSettings` conserva lo guardado (no hay ningún paso de esquema), así que un valor igual al de fábrica de antes no se distingue de una elección: una instalación existente sigue con lo que tenía; solo una nueva (o *Restablecer*) toma los valores nuevos. Tests: `tests/ai-settings.test.ts` (los valores nuevos, el sintético con los mismos, un documento guardado que conserva 30 y 2/3/2 y uno sin la clave que toma 4) y `the_constants_are_the_contracts` en `rt-post` (50, 4/6/3 y los ΔE iguales a los de `settings.ts`). `tests/fixtures/ai-guard.json` regenerado: el escenario *forbidden* (que usa los valores por defecto) cambia de imagen, y *strong* y *limited* ya no necesitan recortar el color de la tapa ni de la etiqueta.
- **5.1 · Tamaño en milímetros.** El código ya lo hace: `sizeMm` en mm (`core/textures.ts`), el campo de tamaño es un `lengthField` que muestra en la unidad de *Ajustes* y escribe mm, *Ajustar a la pieza* es un botón (`insp-textures.ts`), la madera y la tela son físicas (anillos por 100 mm, `pattern/wood.rs`) y el desgaste guarda su `refSize` en metros al crearse el material. Solo se corrigió la SPEC (§3.3, los dos párrafos que decían «sigue en tamaños de pieza» y «decisión pendiente»).
- **M3b · `NORMAL_MAP`.** En espacio tangente el `2b − 1` del azul se toma en valor absoluto: una normal con el azul por debajo de 0,5 se refleja al hemisferio de fuera, igual en `program/interp.rs` y en `core/material-interp.ts` (los mismos bits). El ejemplo *Pintura metalizada con copos* pasa el ruido por *Separar RGB* → *Combinar RGB* con el azul en 1. Tests (cada uno falla sin el arreglo): `a_tangent_space_normal_map_never_points_into_the_surface` (Rust), el mapa de normales de `tests/material-program.test.ts` y «the metallic flakes face out of the surface at every point» (falla si se quitan a la vez el arreglo y el ejemplo nuevo). **Fijados que se mueven, todos por un mapa de normales con el azul por debajo de 0,5:** el ejemplo de grafo `METALLIC_FLAKES` (`eb24ca6b` → `3795f601`, ejemplo nuevo y nodo nuevo), dos casos de la prueba cruzada (`NMAP 0` y `NMAP 4`, la instrucción sola en espacio tangente sobre colores con el azul por debajo de 0,5; `NMAP 1`, en el de la pieza, no se mueve), el quinto de `PINNED_M3B_PROGRAM_VALUES` (`0x587e_907c` → `0x6d55_bcef`: la tarjeta con copos de `NOISEC` en `NMAP`) y `PINNED_M3B_PROGRAMS_4SPP` (`0x0d6e_20ba` → `0x90b4_2b6b`, la misma tarjeta en la imagen; también en `rt-app` y `rt-cli`). Los seis pases de M3b y todo fijado de una escena sin `NMAP` siguen igual. `engine.yml` lee los fijados del código (`sed`), así que sus bloques no cambian. En la comparación por regiones (`tests/programs-full-browser.test.ts`) los copos pasan de correlación −0,91 y una distancia de tono de 106 a **+0,87** y **28**, dentro del margen de los demás: el test ahora les exige tono y correlación positiva.
- **K1 · Receta de partida de *Interior*.** `SceneTypeDefaults.lightSetup` (`INT_WINDOW_NOON` en *Interior*) y una casilla más del mecanismo de K1, `studio.lighting`: guarda el montaje, sus focos, `modified`, la intensidad de la cúpula y la exposición, y escribe lo mismo que elegir la receta en el catálogo (`applySet` con la decoración conservada). Solo actúa sobre los focos del tipo de producto sin tocar (la definición de L7, abajo); un montaje elegido o unos focos editados se quedan. Volver al tipo anterior devuelve los focos tal cual (el mismo arreglo), y si la persona tocó un foco de la receta, se quedan los suyos. Tests en `tests/scene-type.test.ts` (seis nuevos; los de ida y vuelta de K1 pasan sin cambios, «removes nothing» ya no pide los mismos focos en *Interior*).
- **D1 · Doctor de motor.** El recorte con *Estándar* era ya un aviso (`WARN`: el Doctor no tiene otro estado de fallo); ahora lo dice el catálogo y la frase («es lo que busca un fondo blanco liso») y el arreglo pone **AgX**. El chequeo de vídeo ya despertó en N1 (dormido quería decir que hasta N1 los ajustes forzaban la secuencia de fotogramas): avisa solo de un contenedor que el sistema no codifica; la SPEC aún decía lo de antes y se corrigió. El del *denoise* no cambia. Tests: tres nuevos en `tests/doctor-engine.test.ts` (aviso y AgX en el arreglo y en la frase en los dos idiomas; el vídeo despierto; el *denoise* igual) y los dos que fijaban *Fílmica*.
- **L7 · La pregunta por los focos.** «Los focos del tipo de producto sin tocar» es `typeLightsUntouched` (`core/lighting.ts`): el montaje en vigor es el del tipo (`PRESET`), `studio.modified` está apagado (lo enciende cualquier foco añadido, duplicado, editado, colocado, apuntado o borrado, y solo lo apaga poner un montaje) y los focos, sin la decoración de un set, son valor a valor los de `lightsFromRig` del tipo (así no hay focos propios ni conservados, y un tipo elegido sin rehacer el estudio no cuenta). Con ellos, `requestSetup` sustituye sin preguntar, también si *Ajustes* recuerda *Ocultar* o *Añadir*. Tests: dos nuevos en `tests/light-catalogue.test.ts`; `tests/library.test.ts` y `tests/light-panel-browser.test.ts` ya no esperan la pregunta sobre el proyecto recién abierto (el segundo elige primero un montaje sin pregunta y después otro, que sí pregunta).
- **H1 · Contraste.** `tests/ui-contrast.test.ts` exige 7:1 al texto principal (`ink-0`, `ink-1`, el invertido) y 4,5:1 al secundario (`ink-2`) sobre todas las superficies de los cuatro temas, y que cada gris quede al menos un 10 % por debajo del de encima en cada superficie (la jerarquía no se aplana). El único par por debajo de 4,5:1 era `ink-2` del tema claro: **`#6b6b6b`** (3,78:1 sobre `bg-3`, 4,39 sobre `bg-2`, 4,43 sobre *overlay*) pasa a **`#5f5f5f`** (4,52:1 sobre `bg-3`, 6,4 sobre `bg-0`); el oscuro (`#9a9a9a`, 5,10 a 6,86) y los de alto contraste ya llegaban.

**Qué no encajó con el plan** (regla 12; ◆ para quien decide):

1. **Los mandos de la guarda de *Ajustes* no llegaban a la guarda** (decidido y hecho en la segunda ronda, abajo): `ai.guardDeltaE`, `ai.guardDeltaE95` y `ai.guardEdgePx` se guardaban y se mostraban, pero la guarda usaba siempre `Tolerances::PROVISIONAL`, y el borde de fábrica difería (1,5 px en el motor, 2 en *Ajustes*).
2. **Las instalaciones existentes conservaban 30 y 2/3/2** por la convención de *Ajustes* (lo guardado manda): decidido migrarlas (segunda ronda).
3. **`NORMAL_MAP` en el espacio de la pieza** podía aún doblar la normal hacia dentro con una intensidad por encima de 0,5: decidido plegarlo también (segunda ronda).
4. **K1**: la decoración de un tipo de producto que es un set (el foco del charco, el fondo) se queda bajo la receta, como al añadir una receta conservando los focos; quitarla obligaría a la casilla a guardar piezas de la escena para devolverlas. Con la exposición automática de *Interior*, la exposición que pone la receta (la del tipo más 0,2) es la compensación, igual que al elegirla en el catálogo.
5. **D1**: el recorte ya era aviso y el vídeo ya estaba despierto desde N1; lo nuevo es el arreglo (AgX), las frases, la SPEC y los tests.
6. **H1: `ink-3` no se sube.** Es el gris de lo apagado (controles deshabilitados, separadores, asas, miniaturas vacías), que WCAG 1.4.3 no mide; subirlo a 4,5:1 lo pondría encima de `ink-2` y aplanaría la jerarquía. El texto que se lee y lo usaba pasa a `ink-2` (segunda ronda).
7. **Capturas**: las que este cambio dejó viejas se regrabaron en la segunda ronda.

**Puertas.** `npm run engine:build`, `npm run qa` (tipos y *build* en verde; de 3071 tests, en una pasada falló solo `tests/ai-desktop.test.ts` «cancelling mid-way», una carrera de tiempos con la máquina cargada que fija la intervención a 100 y no depende de los valores de fábrica: pasa solo tres veces seguidas, y la suite entera con `npx vitest run --maxWorkers=2` da 3065 pasan y 6 se saltan). En `engine/`: `cargo fmt --check`, `clippy --workspace --all-targets -D warnings`, `cargo test --workspace --release` (1130 pasan, 5 ignorados), la compilación wasm32 de `rt-wasm` y `rt-post-wasm` sin importaciones WASI, los bloques de paridad de `engine.yml` contra el `rt_wasm.wasm` real (40 imágenes; M3b da `0x90b42b6b` con sus seis pases iguales), la paridad de la guarda con el `post.wasm` real (`tests/ai-post-wasm.test.ts`) y los tests del código de la página con el `rt.wasm` real (107 pasan). `tests/programs-full-browser.test.ts` y `tests/light-panel-browser.test.ts`, en Chromium.

**Segunda ronda** (lo marcado ◆, decidido por el responsable):

- **Fusión de `main`** (v0.1.17, el arranque en *Rápido* y O4): el CHANGELOG junta las dos partes por áreas; en el ROADMAP se queda el nombre *Decisiones de criterio* (O4 anotó sus decisiones en su propia fase y no tocó la lista).
- **Migración de los valores de fábrica de antes.** `SETTINGS_SCHEMA` pasa a **2** y su paso 1 → 2 (`STEPS[1]`, con `OLD_AI_FACTORY`) cambia un `ai.intervention` guardado igual a 30 por 50, y unas tolerancias iguales a 2, 3 y 2 px por 4, 6 y 4 px, cada una por su cuenta; cualquier otro valor se queda, y un documento de esquema 2 se lee tal cual (allí un 30 es una elección). Test en `tests/ai-settings.test.ts`: un documento viejo toma los nuevos, uno con 35 conserva 35 (y un ΔE de 5 o un borde de 1 los suyos), uno de esquema 2 conserva 30.
- **Los mandos de la guarda llegan a la guarda.** `AiPostRequest.tolerances` (`deltaEMean`, `deltaEP95`, `edgesPx`, las claves de `Tolerances::KEYS`) y `withGuardTolerances` (`core/ai-post.ts`), que envuelve el servicio de la aplicación (`main.ts`) y pone en cada petición, la de la cola y la de la vista previa, lo que dice *Ajustes* en ese momento (`guardTolerances`). En escritorio, `DesktopAiService` las manda en el JSON y el lanzador ya las aceptaba (`PostRequest.tolerances`); en la web, el servicio sintético mide contra ellas y `jobTolerances` las pone en el trabajo del `post.wasm`. El borde de fábrica es **4 px en todas partes** (`Tolerances::PROVISIONAL.edges_px`, era 3). Con eso apareció un fallo: el perfil que mide el borde llegaba a 4 px de cada lado y no podía medir más de unos 3, así que con un límite de 4 la comprobación no podía fallar nunca; ahora llega dos píxeles más allá del límite (`edge_reach`, de 4 a 16). Tests: con el `post.wasm` real, el plan y el informe usan 7,5, 9 y 6 si *Ajustes* lo dice, y los de fábrica si no (`tests/ai-post-wasm.test.ts`); el servicio sintético a través de `withGuardTolerances`, leído en cada llamada (`tests/ai-synthetic.test.ts`); el JSON que recibe el lanzador (`tests/ai-desktop-service.test.ts`) y, con el lanzador real y el *runtime* falso, el informe de su guarda con 7,5 y 6 (`tests/ai-desktop.test.ts`); en `rt-post`, `the_edge_profile_reaches_past_the_limit` y los dos tests de un borde movido, que movían 3 px (dentro del límite nuevo) y ahora mueven 6. `tests/fixtures/ai-guard.json` solo cambia el límite de bordes que dice el informe (3 → 4): ninguna imagen se movió.
- **`NORMAL_MAP` en el espacio de la pieza**: un resultado al otro lado de la superficie se refleja en su plano (`r − 2(r·n)n`, normalizado), igual en `program/interp.rs` y en `core/material-interp.ts`. Con intensidad 0,5 o menos nunca pasa (la normal es al menos `1 − 2s` hacia fuera). Tests que fallan sin el arreglo: `a_part_space_normal_map_never_points_into_the_surface` (Rust) y el de `tests/material-program.test.ts`. **Fijado que se mueve:** solo el caso `NMAP 1` de la prueba cruzada (`9b01860a` → `6c271a5b`: la instrucción sola en el espacio de la pieza con intensidad 1 y la que da una coordenada de UV, sobre colores que apuntan contra la normal); los diez ejemplos y las escenas del motor no usan mapas en el espacio de la pieza, y ninguna imagen fijada se movió.
- **Texto en `ink-3`**: la etiqueta *próximamente* de las tarjetas de efectos (`.fx-card-soon`), el rango de *Suavizado* (`.sw-aa-rank`) y los nombres de las filas ocultas y de los focos apagados (`.tree-row.is-hidden`, `.list-row.is-off`) pasan a `ink-2` (4,5:1). `tests/ui-contrast.test.ts` lee las hojas de estilo y exige que toda regla con texto en `ink-3` sea un control deshabilitado o rechazado o decoración (separador, asa, icono, miniatura vacía), y que esos cuatro papeles sean `ink-2`; falla si uno vuelve a `ink-3`.
- **Un fallo de la sección *Luz* que destapó la receta de partida**: los campos de cada foco se rehacían solo cuando cambiaban los ids de los focos, y los de la receta son los del tipo (`l1`…`l3` y el del charco), así que con *Interior* seguían los nombres del tipo (*Relleno*, *Contra 1*) sobre los focos de la receta, y al volver los de la receta. Ahora los rehace también el papel, si es propio y su nombre (`tuneLightsKey`); test en `tests/scene-type.test.ts`, que falla con la clave de antes. La comprobación en el navegador (`tools/scene-type-check.mjs`) lo encontró; de paso se le quitó lo que K3 había dejado viejo (leía la transformada en el control de la exposición, y el nombre *Brillo (EV)* de la exposición automática contaba como un control nuevo) y no compara las filas de los focos, que con *Interior* son las de su receta. `tools/ai-post-check.mjs` elegía *PNG* por un texto que ahora es también el de *PNG 16 bits*: se le da exacto.
- **Capturas regrabadas** (en *Sin publicar* de `GALERIA.md`): `scene-type-interior.png` (*Interior* con su receta de partida; `tools/scene-type-check.mjs` sigue a C1: elige después otra receta, que sí pregunta), `m3b-graphs.png` (los copos hacia fuera; ahora la hace `tests/m3b-graphs-sheet.test.ts`, con `REPACK_WRITE_CAPTURES=1`) y, del tema claro, `ai-section-light.png` y `ai-results-light.png` (`tools/ai-post-check.mjs`, que esperaba la intervención de fábrica en 30).

**Puertas de la segunda ronda**, tras la fusión: `npm run engine:build` y `npm run qa` en verde (3108 tests: 3101 pasan, 7 se saltan); en `engine/`, `cargo fmt --check`, `clippy --workspace --all-targets -D warnings`, `cargo test --workspace --release` (1142 pasan, 5 ignorados), la compilación wasm32 sin importaciones WASI, los bloques de paridad de `engine.yml` contra el `rt_wasm.wasm` real (42 imágenes, con la de O4; ninguna se movió), la paridad de la guarda con el `post.wasm` real (11 pasan) y los tests del código de la página con el `rt.wasm` real (129 pasan); el lanzador real con el *runtime* falso (`tests/ai-desktop.test.ts`); `tools/scene-type-check.mjs` y `tools/ai-post-check.mjs` (36 comprobaciones) en Chromium.

## C2 · Interruptor de la focal — **Opus** — hecha

**Petición del usuario** (`TODO.md` §1.7), tal cual: «Al cambiar la focal
length cambia el zoom respecto al objeto enfocado, y esto quiero que sea un
toggle. O la cámara se acerca o el objeto / punto enfocado.» Decidido en
*Decisiones de criterio* (1.7): un interruptor junto a la focal, *Mantener
el tamaño de lo enfocado*; apagado por defecto (la cámara se queda y cambia
el encuadre, como en una cámara); encendido, la cámara se acerca o se aleja
por su eje para que el plano enfocado conserve su tamaño (cambia la
perspectiva, no el tamaño); el inspector dice cuál está activo y cada cambio
es una entrada de deshacer.

**Hecho:**

- **El estado, por cámara**: `CameraState.keepFocusSize` (opcional; ◆ por
  cámara y no como preferencia del inspector: cada cámara tiene su óptica y
  su sitio, y así viaja sola con el proyecto, con *Nueva desde la vista
  actual* y al duplicar, y con los estudios de la biblioteca, que guardan la
  cámara entera). Al abrir, solo `true` es encendido (`io/project.ts`
  `withInteriorCamera`, `io/library.ts` `camera`); un proyecto o un estudio de
  antes de C2 se lee apagado.
- **La cuenta, en el núcleo** (`core/focal.ts`, ARCHITECTURE §2, SPEC §3.5
  *Focal y tamaño de lo enfocado*). Un punto a la profundidad *z* sale *f/z*
  veces su tamaño: el plano a *D* lo conserva si pasa a *D·f′/f*, así que la
  cámara avanza *D − D·f′/f* por la recta que la une a su objetivo, y la
  distancia de órbita y la de enfoque bajan lo mismo. *D* sale de la
  resolución de F1 (`focusedPlaneDistance`): la tecleada en *Distancia*; en
  *Punto* y *Objeto*, `focusDistanceFor` del punto que se sigue en reposo
  (la profundidad; con inclinación, donde el plano de la bisagra corta el
  eje; con verticales rectas, medida por el eje propio de la cámara, que es
  por el que se mueve: la cámara nivelada que se renderiza conserva el
  tamaño y el sitio del plano, comprobado en los tests). El **objetivo de
  órbita** se queda mientras la cámara quede delante de él a más de
  `MIN_ORBIT_FRACTION` (0,1) de la distancia de órbita escalada por la misma
  razón; si no, avanza por el eje delante de ella (◆ la regla y el 0,1). El
  plano lejano de recorte se queda donde estaba en el mundo al alejarse.
  **Cámara bloqueada**: la focal cambia y la cámara no se mueve (◆, como con
  el interruptor apagado; antes de C2 la focal de una cámara bloqueada ya se
  podía cambiar). **Ortográfica y panorámicas**: no hacen nada (su encuadre
  es el ancho o el campo de visión, no la focal), y lo dice la línea del
  inspector (`focalBehaviour`). La acción es `camera/focal` (`store.ts` la
  manda a `reduceFocal`), y las **ópticas de interior** de K3
  (`camera/interiorLens`) pasan por el mismo sitio (◆).
- **La interfaz** (UI.md §5.1 *Cámara*, §3): el interruptor en su fila justo
  debajo de *Focal* (en la sección *Cámara* de la escena y en la ficha de
  una cámara guardada, que dibujan los dos `cameraFields`), con su línea
  auxiliar, que dice cuál está activo y cómo es el otro, o por qué no hace
  nada (bloqueada, ortográfica, panorámica); el campo de la focal despacha
  `camera/focal` con el gesto del campo, así que cada pulsación de las
  flechas (mantenida, un solo gesto), cada arrastre y cada valor tecleado es
  una entrada (*Cámara: Focal*); el interruptor, otra (*Cámara: Mantener el
  tamaño de lo enfocado*). En la paleta, *Focal: mantener el tamaño de lo
  enfocado (activar o desactivar)* para la cámara que se ve, con un aviso.
  Cadenas en `es` y `en`; el cromo es el del interruptor de siempre
  (acromático, comprobado en los dos temas).

**Tests** (cada uno se comprobó deshaciendo su cambio: falla).

- `tests/focal-switch.test.ts` (19): apagado, la cámara se queda y el plano
  crece por la razón de focales; encendido, en *Distancia* con el foco en el
  objetivo y fuera de él, en *Punto* y en *Objeto*, y con verticales rectas,
  los puntos del plano enfocado **proyectados** con la cámara que se
  renderiza (su nivelada y su *shift*) caen donde caían (< 10⁻⁹ mm) y su
  tamaño no cambia (< 10⁻⁹ relativo), mientras lo de delante encoge y lo de
  detrás crece; en *Punto* manda el punto aunque la distancia guardada
  esté vieja; el objetivo empujado; el recorte lejano; nada de NaN; las
  ópticas de interior; la cámara bloqueada, la ortográfica y las dos
  panorámicas, quietas; deshacer (el interruptor y la focal, una entrada
  cada uno, y deshacer devuelve la cámara exacta), un arrastre una entrada
  (y acaba donde un cambio directo), cada pulsación de las flechas la suya;
  ida y vuelta en el proyecto (también una cámara nueva copiada), uno de
  antes y uno con `"yes"` se abren apagados; un estudio de la biblioteca lo
  guarda y uno de antes se lee apagado; la orden de la paleta.
  Mutaciones: quitar el movimiento hace fallar 11 (y 3 del navegador);
  quitar el paso por el *store*, 16 (y 4); medir *D* hasta el objetivo en
  vez del plano enfocado, 5 (y 1); leer *D* de la distancia guardada en
  *Punto*, 1; quitar la comprobación de bloqueada, de ortográfica y
  panorámicas, del empuje del objetivo, del recorte, de las ópticas de
  interior, de la lectura del proyecto, de la de la biblioteca o de la
  orden de la paleta, 1 cada una.
- `tests/focal-browser.test.ts` (5, Chromium con SwiftShader; se salta sin
  él): la página `tests/browser/focal-page.ts` dibuja con el motor de la
  vista previa dos tarjetas que brillan, cambia la focal por el *store* como
  el campo (un arrastre de 50 a 85 mm, una pulsación a 35 mm, verticales
  rectas con 18° de 35 a 70 mm) y lee el lienzo: encendido, la tarjeta del
  plano enfocado sale con **los mismos píxeles** (5145 de 5145, 83 px de
  ancho; en *Punto* sobre la tarjeta de detrás, 2595 de 2595; con verticales,
  2806 de 2806), dentro del 1 % que se pide, y en su sitio a menos de un
  píxel, mientras la otra cambia; apagado, la tarjeta crece 1,70× (83 → 141
  px). Una entrada de deshacer cada vez.
- `tools/focal-check.mjs` (20 comprobaciones sobre la interfaz construida,
  `npm run build` antes): el interruptor bajo la focal, apagado y su línea;
  apagado, la flecha cambia la focal y deja la distancia de enfoque; encender
  es una entrada; la flecha mueve la distancia de enfoque por la razón de
  focales (688,4 → 696,5 mm de 85 a 86 mm) en una entrada que un Ctrl+Z
  deshace entera; un arrastre, una entrada; la línea de la ortográfica y de
  la bloqueada (y la bloqueada no se mueve); la paleta lo apaga con su aviso;
  la línea en español; acromático en el tema oscuro y en el claro. Con el
  campo de antes (`camera/set`) fallan `on_the_camera_dollies` y
  `drag_dollies`. `--shots docs/ui` deja la captura.

**Captura**: `docs/ui/c2-focal-switch.png` (el bloque *Cámara* con el
interruptor encendido y su línea; en `GALERIA.md`, *Sin publicar*).

**No encajó con el plan** (regla 12; lo marcado ◆ está decidido en *Decisiones de criterio*: se acepta tal como está):

1. **La focal no tiene deslizador**: es un campo con flechas que se arrastra
   (U15). El «gesto de deslizador» es ese arrastre (una entrada); no se
   añadió un deslizador a la focal.
2. **No hay preferencias del inspector** donde guardar el interruptor; por
   cámara encaja con el resto (ver arriba).
3. **Con inclinación (O1)** se conserva el tamaño donde el plano corta el
   eje: la regla de la bisagra depende de la focal, así que el plano
   inclinado gira un poco al cambiarla y sus puntos fuera del eje no
   conservan el tamaño exacto.
4. **Con una lente trazada**, *D* es la distancia paraxial que guarda el
   *store* (no pregunta al motor); abierta, el mejor foco cae a milímetros
   de ella, y el tamaño en la imagen depende de la geometría, no de eso.
5. **Los presets de *Óptica*** (`camera/lens`) siguen encuadrando la pieza
   como antes, con el interruptor encendido o apagado; y los clips `ZOOM` de
   la animación cambian la focal sin mover la cámara (un *dolly zoom*
   animado sería otro clip).
6. **El interruptor sigue activo** con la ortográfica y las panorámicas (se
   puede dejar encendido para cuando la cámara vuelva a perspectiva); la
   línea dice que ahí no hay nada que mantener.

**Puertas.** `npm run engine:build` (el `rt.wasm`, el `rt-simd.wasm` y el `post.wasm` de siempre: el motor no se tocó, así que no hacen falta `cargo fmt`, `clippy` ni la compilación wasm aparte) y `npm run qa` en verde: tipos, *build* y 193 archivos de prueba, 186 pasan y 7 se saltan, con 3191 tests (3160 pasan, 31 se saltan; antes de la fase 191 archivos), sin repetir nada con `--maxWorkers=2`. `tests/focal-browser.test.ts` corrió dentro, en Chromium; `tools/focal-check.mjs` (20 de 20) sobre el `dist/` construido.

## F1 · Enfoque por punto y por objeto — **Opus** — hecha

**Petición del usuario** (17-10, tras B1), tal cual: «CRUCIAL! sigue sin
resolverse el clickar sobre un punto y que se enfoque exactamente en esa
cara, en ese pixel. Además, quiero que se pueda seleccionar en otro modo de
enfoque, enfocar un objeto. Tener estos dos modos a la vez.» Y, sobre los
valores: «quiero aparte flechas de up y down en todos los valores, o sliders
cuando convenga más. En enfoque creo que se serviría de ambas. Un slider y al
lado el valor con up and down». Es el punto 1.8 de `TODO.md`: el píxel exacto
de la vista exacta.

**Qué.** (1) Que el clic deje nítido, en el render final, exactamente lo que
hay bajo el píxel, en cualquier vista: *Rápido* y *Completo*, lente fina,
inclinación y descentramiento (O1), lente trazada (O2), proporciones de U13,
mirar a través de una cámara guardada, la línea de tiempo con la cámara
animada, y después de orbitar o acercarse. (2) Tres modos de enfoque por
cámara: *Distancia* (el de siempre), *Punto* (el punto picado, que el enfoque
sigue) y *Objeto* (una pieza, un grupo o el modelo).

**Medido primero.** Una escena hecha para eso (`tests/browser/focus-scene.ts`):
un damero de 1,3 mm inclinado 45° en profundidad que llena el cuadro, luz
plana, 135 mm a f/1,4 a 600 mm (la profundidad de campo es de un par de
milímetros: un milímetro de error mueve la banda nítida varios píxeles). Un
navegador sin cabeza dibuja la vista previa y hace el clic como el visor
(`tests/browser/focus-page.ts`); Node aplica la acción, pide al motor los
pases exactos de profundidad y de círculo de confusión de la vista *Completo*
(640 × 400) y del render final (480 × 270) en el píxel del clic, su propio
enfoque para lo que ve ese píxel (`rt_scene_pick`), y renderiza el final con
`rt` para ver dónde cae la banda nítida (un contraste paso banda a lo largo
del gradiente de profundidad, el centro de la banda, medido igual antes y
después; la banda mide ±15 px con la lente fina y ±25 px con las trazadas
abiertas, y unos ±2 px son el ruido de la medida; `tests/focus-measure.test.ts`,
`REPACK_FOCUS_MEASURE=1`). Siete clics por caso (centro, bordes, esquinas;
la banda, en el centro y dos esquinas). Antes de F1 (en `319614b`) y después,
banda nítida en píxeles del render desde el clic, y error de enfoque en mm:

| caso | antes | después |
| --- | --- | --- |
| lente fina | 0,00 mm; banda −0,5 a −2 px | igual (el pico de B1 ya era el del píxel) |
| inclinación 6° | profundidad exacta, pero banda a +34,5 y −36,5 px en las esquinas | −1 y −2 px |
| descentramiento | 0,00 mm | 0,00 mm |
| doble Gauss f/1,4 (O2) | banda a −31 px en el centro, −42 y −50,5 px en las esquinas, el clic fuera de ella | +5, −14,5 y −13 px, el clic dentro de la banda en los tres (su contraste, el 88 % del máximo) |
| Petzval (O2) | −31,5 px en el centro, −32,5 y −44,5 en las esquinas | −2, +14 y +11 px, el clic dentro de la banda |
| distorsión +1 (O2) | *Completo* −2,28 mm y el final −0,97 mm en la esquina (el visor no era el render); banda −31, −16,5 y −52,5 px | los dos a 0,00 mm del enfoque del motor; banda +5,5 y −15,5 px, el clic dentro; abajo a la derecha, −38,5 px (ver «no encajó») |
| 1:1 y 9:16 activas | 0,00 mm | 0,00 mm |
| mirar a través, 9:16 | *Completo* hasta 34,8 mm y 15 px de círculo de confusión en la esquina; el final, bien | 0,00 mm y 0,1 px en los dos |
| línea de tiempo, t = 1 con órbita | ±6,5 mm, 3–4 px de círculo; banda −24,5 y +19,5 px | 0,00 mm; banda 0 y −1,5 px |
| orbitar 8° tras el clic | hasta 16,9 mm, 8 px de círculo; banda ±42–44 px (en el píxel del clic) | 0,00 mm donde ha ido el punto (dejar la distancia, como antes, lo dejaría hasta 10,3 mm fuera); banda −1 a −1,5 px |
| acercarse un 15 % tras el clic | 80–101 mm, 45–70 px de círculo | 0,00 mm donde ha ido el punto (dejada, 90 mm fuera) |
| mover la pieza 15 mm tras el clic | — | 0,00 mm (dejada, 15 mm fuera) |

**Causas medidas** (las hipótesis del encargo, h1–h6):

1. **h1, la inclinación.** El clic ponía la profundidad del punto, pero la
   lente inclinada enfoca el plano de la regla de la bisagra, que pasa por el
   punto a otra distancia: `u (f − sin α (p · b)) = f z`. El motor y la
   interfaz usan ahora la misma regla (`Camera::focus_distance_to`,
   `core/focus.ts focusDistanceFor`, con un test de paridad contra `rt.wasm`).
2. **h3, la lente trazada.** Se enfocaba paraxialmente, y abierta su
   aberración esférica y la curvatura de campo ponen su imagen nítida varios
   milímetros más allá. El motor resuelve la distancia con sus propios rayos.
   El primer criterio, el círculo de menor confusión, tampoco servía (el
   render seguía blando a −27,5 px): el halo arrastra los mínimos cuadrados.
   El que queda es el contraste del detalle fino (10 y 5 pares de líneas por
   mm del cuadro de 36 mm, el máximo más cercano a la menor confusión): para la
   doble Gauss del caso, 601,5 mm por la menor confusión y 609,7 mm por el
   contraste, que es donde las muestras del propio render dan más contraste
   (607–610 mm). Con una sola frecuencia y el máximo de todo el tramo, un punto
   cerca del borde superior salía a 538 mm en vez de 585 (un lóbulo lateral, la
   resolución espuria, por encima de un principal débil).
3. **h1, el visor no era el render.** El visor *Completo* ensancha el sensor
   para cubrir el visor, y la lente trazada sacaba del sensor del visor las
   semiaperturas, la altura de su distorsión y su viñeteo: con distorsión, el
   píxel del visor no veía lo mismo que el del render. `LENS` lleva ahora
   `frame_sensor_mm`.
4. **h1, mirar a través.** El visor *Completo* de una cámara mirada a través
   usaba el cuadro de la cámara activa: con otra proporción, otro sensor.
5. **h2 y h4, la pose y el seguimiento.** En la línea de tiempo el clic
   medía desde la cámara guardada, no desde la del instante; y tras el clic
   la distancia se quedaba quieta al orbitar o acercarse. Lo arregla el modo
   *Punto*: la distancia sale, en cada instante, de la cámara como está y del
   punto donde está.
6. **h6, la cara.** La vista previa dibuja solo la cara delantera de cada
   triángulo y su pico no veía la trasera de una superficie de una sola cara,
   que el motor sí renderiza. El rayo se lanza ahora por las dos caras.
7. **h5, redondeo:** no es causa (solo de lo que se enseña).
8. **Al medir apareció otra:** una lente trazada **respira** (su campo cambia
   con el enfoque), así que lo que muestra el píxel se mueve cuando el
   enfoque llega a él (0,9 mm de profundidad en la esquina con el damero
   inclinado). El clic se asienta: se repite con la cámara ya enfocada hasta
   que el punto no se mueve (`settledFocusPick`).

**Qué se hizo.**

- **El motor** (`rt_core::focus`, ARCHITECTURE §5.2 septendecies):
  `rt_scene_pick` (el rayo principal de un punto de la imagen, el de
  `generate_ray` con la pupila en su centro, y lo que toca por las dos caras)
  y `rt_scene_focus_at` (la distancia que enfoca un punto); `LENS
  frame_sensor_mm`; el mejor foco de una lente trazada por contraste.
  `tools/wasm-parity.mjs --pick` y CI fijan los picos de las escenas de O1 y
  O2 (`PINNED_FOCUS_PICK_O1`, `PINNED_FOCUS_PICK_O2`). Ningún *hash* de render
  cambió.
- **El clic** (`main.ts focusPickAt`): la escena de solo la cámara de la vista
  como la escribe `projectScene` para *Completo* (`io/rsb.ts focusPickRsb`:
  pose, cámara mirada a través con su cuadro, imagen del visor alrededor del
  cuadro), el rayo del motor, lanzado contra la geometría de la vista previa
  por las dos caras (`PreviewEngine.pickAlong`), asentado con una lente
  trazada. Sin `rt.wasm` o con uno anterior (detectado por el nombre de las
  exportaciones, sin bit nuevo de `rt_features`), el pico de la vista previa
  y la distancia paraxial.
- **Los modos** (`CameraState.focusMode`, `focusPoint`, `focusObject`;
  SPEC §3.5): el punto se guarda en coordenadas de la pieza; la distancia se
  resuelve donde se usa (`resolvedFocusDistance`, y `focusDistanceAt(estado,
  cámara, t)` para la cola, los lotes y la ventana de render); el *store* deja
  la de reposo en `focusDistance` (`syncFocus`). Si se borra la pieza o el
  objeto, la cámara vuelve a su última distancia en la misma acción, con un
  aviso. Los proyectos, cámaras guardadas y estudios de la biblioteca de antes
  se leen como *Distancia*; ida y vuelta al guardar y abrir; todo deshacible.
- **La interfaz** (UI.md): *Enfoque* segmentado *Distancia · Punto · Objeto*;
  la distancia como deslizador logarítmico con su campo al lado (el `slider`
  admite ahora una escala propia, `scale`, y hay `lengthSlider`); en *Punto*,
  *Enfocar con clic* (la misma entrada de deshacer); en *Objeto*, elegir en el
  visor o en el árbol, con el nombre; *Mantener enfocado* en el menú de una
  pieza; cuatro órdenes en la paleta; la marca del punto en el visor con la
  cámara seleccionada.

**Tests.** `tests/focus-modes.test.ts` (27: la regla de cada lente, la
paridad con `rt.wasm`, el seguimiento al orbitar, acercarse, mover la pieza,
animarla y animar la cámara, el clip de foco, *Objeto*, la vuelta a
*Distancia* al borrar, sin NaN, deshacer, proyectos viejos y dañados, la
marca, el deslizador, el rayo de una cámara mirada a través y el de una lente
trazada en el visor, el asentamiento); `tests/focus-browser.test.ts` (9, con
Chromium: el clic en el navegador cae en el enfoque del motor para ese píxel
en seis casos, la profundidad exacta con la lente fina, la banda nítida de la
inclinación por el clic, y el visor sin motor); `rt-core focus::tests` (10,
entre ellos que las muestras del propio render, a través del foco, dan más
contraste donde el pico enfoca); `tools/focus-click-check.mjs` (15
comprobaciones en la interfaz construida). Cada arreglo se comprobó
deshaciéndolo: el test correspondiente falla (el informe del PR los lista).

**No encajó con el plan:**

1. **La lente trazada necesita al motor para enfocar.** Sin `rt.wasm` la
   distancia es la paraxial (milímetros fuera, abierta). Con él, resolver
   cuesta de 0,4 a 0,6 s en la página con la máquina cargada (y el clic asentado, hasta tres); los fotogramas de
   un gesto usan la última diferencia con la paraxial para esa lente.
2. **El escritorio no tiene una llamada propia**: la página lleva su
   `rt.wasm`, el mismo `rt-core` que renderiza el lanzador; no hay
   `/api/pick`.
3. **El *swirl* artístico** entra en el mejor foco como en la imagen.
4. **El paseo de cámara (N3) no está cableado**: el enganche
   (`focusDistanceAt`) está; la cola y los lotes los toca N2.
5. **El lector de cámaras de la biblioteca** (`io/library.ts`) sigue sin leer
   la óptica de una cámara (ya era así); lee los modos de enfoque.
6. **`slider()`** cambió por dentro lo justo: una escala opcional
   (`toUnit`/`fromUnit`, 1000 posiciones), junto a las flechas, la variante
   compacta y `setDisabled` de U15 (fusionadas).
7. **El clic en vidrio** enfoca su cara delantera, como el resto (decidido).
8. **La esquina de una lente trazada con distorsión artística +1** (abajo a
   la derecha, a f/1,4) sigue con la banda a −38,5 px del clic, fuera de ella:
   el enfoque escrito es el del motor para ese píxel (0,00 mm), así que lo que
   no casa es el criterio del mejor foco con lo que el render ve allí (un
   punto del sensor muy fuera, con mucha aberración); el resto de esquinas
   trazadas cae dentro de la banda. El criterio se aceptó; esta esquina queda
   abierta.
9. **`cargo test --workspace`** con la máquina cargada: cuatro tests de
   `rt-app` (descargas y actualizaciones con servidores locales, el
   adaptativo con varios hilos) y cuatro de `rt-cli` (TIFF) fallan a veces y
   pasan solos; no tocan F1.

**Con K3 y N2** (fusionadas tras la fase): el rayo del pico es el de
`Camera::generate_ray` con la pupila en su centro, así que la ortográfica, las
dos panorámicas y las verticales rectas pican solas. `Camera::focus_distance_to`
y `core/focus.ts focusDistanceFor` se extendieron: una panorámica es
estenopeica y su distancia de enfoque (y la profundidad del pico, como su
pase) es la distancia al punto, también detrás de la cámara; con verticales
rectas la cámara que se renderiza es la nivelada (`renderedCamera`), y la
distancia es la de esa cámara entre cos(inclinación corregida), una lente
trazada resuelta sobre ella. Tests: el pico y el rayo principal en
`rt-core focus::tests` con cámaras ortográfica, equirectangular y ojo de pez;
la paridad TS–`rt.wasm` y el camino del clic, una por proyección, en
`focus-modes.test.ts`. N2: la cola y los lotes ya escriben la distancia que
sigue cada cámara (la resuelve la frontera del motor, `viewCamera`, con la
cámara y la pose del trabajo); `batch.test.ts` lo comprueba en un lote de
cámaras × estudios y en los fotogramas de una animación, y falla sin esa
resolución.

**Con O4** (fusionada tras la fase): *Por dos puntos* deja la cámara en
*Distancia* (podía seguir un punto o un objeto) en la misma entrada de
deshacer, y con una lente trazada enfoca a la media de las distancias que
el motor resuelve para los dos puntos con la inclinación elegida (la
decisión 3 de O4). El mejor foco de una lente trazada inclinada usa las
muestras de la lente inclinada (su rejilla de límites del sensor); la regla
paraxial de la interfaz para ella es la bisagra de la lente simple, como el
plano de O4. Las funciones de enfoque anteriores sin uso
(`camera.ts focusDistanceTo`, `interior-camera.ts focusDistanceFor`) se
quitaron; sus tests apuntan a `core/focus.ts focusDistanceFor`.

**Decisiones** (17-10, del responsable de la sesión; eran ◆): el *Objeto*
sigue el centro de su caja (las otras dos candidatas siguen escritas y sin
usar); el rango y la escala logarítmica del deslizador, como están; en
*Punto* y *Objeto* el deslizador enseña la distancia que sale y **moverlo pasa
la cámara a *Distancia*** desde ahí, en una sola entrada de deshacer (el
deslizador no se vuelve a dibujar al cambiar de modo, así que el arrastre
sigue; `tools/focus-click-check.mjs` lo comprueba); el mejor foco de una lente
trazada por el contraste de 10 y 5 pares de líneas por milímetro, el máximo
más cercano a la menor confusión (la esquina con distorsión +1 queda abierta);
un clip de foco sobre una cámara en *Punto* gana, como ahora; el clic en un
vidrio enfoca su cara delantera.

## Orden sugerido

1. **U1** (Opus) y **E1** (Sonnet), en paralelo: la interfaz y el
   esqueleto del motor. Sin la primera no hay dónde ver nada; sin el
   segundo no hay dónde construir el trazador.
2. **E2** → **E3** (Opus): aceleración e integrador. Mientras tanto,
   **U2**, **I1** e **I3** (Sonnet): proyecto en archivo, OBJ y STL, y el
   resto de importadores con la hoja de importación. La importación es
   el tronco: va delante de todo lo que no sea el motor.
3. **E4** (Opus): el motor en el navegador. Cierra v0.1 con un render de
   verdad en el visor y en la línea de comandos.
4. **U5** (ventana de render), **I2** (STEP e IGES), **L4** (focos
   propios): lo que hace que se comporte como KeyShot en el día a día
   (U3 y U4 ya están).
4 bis. **Primera release `v0.1.0`**, petición del usuario: **U2**
   (proyecto en archivo), **X1 parte A** (ficheros y `sha256` de los
   modelos), **U6** (Ajustes y gestor de modelos), **P2** (lanzador,
   portables e instalador; el lanzador y el motor nativo pueden empezar
   en paralelo con U5) y **P1** (la release). L4 sigue después.
5. **E5** → **E6** → **L1** → **L2** → **L3**: la luz y los materiales
   hasta que las 72 recetas estén revisadas sobre el motor propio.
6. **M1**, **N2**, **D1**, **P1**: cierran v0.2.
7. **E7**, **M2**, **N1** → **N3**, **L5**, **E8**, **Q1**, **P2**,
   **X1** → **X5** (post-procesado IA, `AI-POST.md`), y **K1** →
   **K2** → **K3** (tipo de escena, habitación y cámara de interiores):
   v0.3.
8. **K4** → **K5**, **K6**, **K7**, **K8**: interiores y mobiliario, v0.4.
9. **H1** al cierre de cada versión.
