# Triage of the “Serious bug report — AI Render and earlier errors”

Source: `docs/TODO.md` from line 260, verbatim. Code read on `main`
(`72e4f79`, branch `ccr-8df3f848-6ukiky`); O2 read in `/home/user/Repackshot-o1`
(branch `o1`, `c416f2f`, not merged). No code or documents have been touched.
Tests were run in a working copy of its own (scratchpad `triage/`): the
interface build in `triage/dist`, `triage/focus-repro.mjs` (local Chromium),
`triage/dn/` (`rt` renders with and without *denoise*, `dnstats.py`,
`clamp.py`) and `triage/vt/fabric.test.ts` (vitest with its own
configuration). That scratchpad is ephemeral (it is lost with the session):
whatever is needed from it is rewritten by the phase that uses it (B1: the
browser check of the focus and the fabric test).

Classifications: **bug** (the code does not do what the documents say),
**missing** (it was not built, or it is marked *coming soon*), **decision**
(it needs photographic, visual or architectural judgement before building;
rule 11: the lead takes it, only the data is prepared here).

---

## 1.1 · Material editors: mapping type, size and offset

**What exists today.**
- *Inspector ▸ Textures* (M2a, done) already has the material's shared
  mapping: *Projection* (UV, Box, Planar, Cylindrical, Spherical), *Axis*,
  *UV set*, *Size* in mm with *Fit to part*, *Rotation*, *Offset* U/V,
  *Repeat* U/V and *Edges* (`src/ui/panels/insp-textures.ts:131-224`;
  actions `texture/setMapping`, `src/core/textures.ts:633`). **But the block
  only appears when some slot has an image** (`insp-textures.ts:344`,
  `any ? mappingBlock(...) : null`): on a material with no image there is no
  mapping control in sight.
- The node editor (M3a) has the *Mapping* node with the same projections
  plus *Object (3D)*, size, rotation, offset and repeat
  (`src/data/material-nodes.ts:207-224`).
- **In *Full* and in *Render* none of this is visible**: the engine paints
  the textures in M2b, which is queued (ROADMAP §M2b, l. 3234; inspector
  note `texture.engineNote`, `src/ui/strings.ts:3118`, “coming soon”). Since
  the viewport starts in *Full* by default (`src/ui/ui-state.ts:505`),
  whoever changes the mapping in the default mode sees no effect.
- There is no projection called “triplanar”: *Box* is the triplanar blend by
  |n|⁴ in *Fast* (`render/texture-shader.ts`), and in a node program it takes
  only the dominant face (M3a, “did not fit” 2). No blend-width control.
- The inspector edits only the shared mapping; each slot's own mapping can
  only be returned to the shared one (`insp-textures.ts:117-126`), although
  the *store* already supports it (M2a, “did not fit” 3).
- There is no interactive mapping tool in the viewport (move, rotate or scale
  the projection on the part): only the labels move
  (`ui/panels/viewport-labels.ts`).
- The procedural families have no mapping: wood only has *Scale*
  (`woodScale`, `src/core/materials.ts:147`; the pith orients itself along
  the longest side, E6), fabric only *Threads per cm* (`:166`), with no axis,
  rotation or offset.
- O2 does not touch it.

What the owner asks for “like KeyShot”: according to its public documentation
(to be checked by observation, rule 1) KeyShot additionally offers *Triplanar*,
*Camera* and *Node* as mapping types, an interactive mapping tool in the
viewport, fit to geometry, and syncing the mapping of all the textures of a
material.

**Reproduction.** Confirmed by reading the code (the lines above). It cannot
be stated which editor the reporter was looking at: if it was a material with
no image, the block does not exist; if it was in *Full*, it exists but does
nothing visible.

**Classification.** **missing** (with a part that is a **decision**: which set
of “KeyShot-style” controls is added and whether the procedural families get
a mapping of their own, which changes E6's `PATN`).

**Proposed fix.** (a) M2b (L, phase): the engine reads `IMGS` and the mapping
of `MATL`. (b) Interface (M): show the mapping even when there is no image
only if there is something to map (nodes or procedural), edit each slot's own
mapping, the name and control of *Triplanar* (blend), and a mapping tool in
the viewport. (c) Mapping for wood and fabric (M, touches `PATN` and
`rt_core::pattern`).

**Dependencies.** M2b (E6 and E9 are already done: unblocked), M3b for the
nodes, 5.1 (relative size). (b) can go out on its own; (a) and (c) cannot.

**Status after M2b (2026-10-16).** (a) **done**: the engine reads `IMGS`, the
texture block of `MATL` and the UVs of `MESH`, and *Full* and *Render* paint
the slots and the labels with their projection, axis, UV set, size in mm,
rotation, offset, repeat and edges where *Fast* paints them
(`rt_core::texture`, ARCHITECTURE §5.2 decies; the region comparison of
`tests/textures-full-browser.test.ts`). The inspector note no longer says
*coming soon* (`texture.engineNote`). Still pending: (b) (mapping controls
without an image, own mapping per slot, *Triplanar*, tool in the viewport),
(c) (mapping for wood and fabric) and the decision of 5.1: size stays in mm.
Node materials keep using the mean of their outputs until M3b.

---

## 1.2 · Ambient: drop shape and varied geometries

**What exists today.** S4a (done): one shape per effect, *Point/sphere*,
*Flake/disc* or *Streak/capsule* (`src/data/effects.ts:48`; `FXAM.shape`,
`engine/crates/rt-sim/src/params.rs:24` and `:63`, “the geometric shape of
every particle of an effect”). The primitives were fixed by S0, decision 4
(sphere, oriented disc, capsule) (ROADMAP §S0). There is no drop, nor a mix of
shapes within an effect. S4b (queued) touches rain and drops (forward lobe,
no caustics), not the shape. O2 does not touch it.

**Reproduction.** Confirmed by code: no drop shape exists.

**Classification.** **decision**. Open questions: (1) what a “drop” is: the
iconic teardrop (non-physical: a real raindrop is spherical up to ~1 mm and
flattens below that, like a hamburger bun, above ~2 mm) or the physical
shape; (2) “that they vary in geometry”: a random mix of the existing shapes
per particle (cheap: the engine already has the three), or new shapes (drop,
the owner's own mesh as confetti), which widen decision 4 of S0.

**Proposed fix** (after the decision). Mix of shapes per particle: M (`FXAM`
with weights per shape, `rt-sim` chooses by the seed, `rt-core`, Fast viewport
with `InstancedMesh`). New drop primitive: M–L (own intersection in
`rt-core/geometry/particles.rs` with its energy test, `rt-sim`, `FXAM`, wasm
parity and *hashes*).

**Dependencies.** S0 (Fable's decision), S4b (same code: do it afterwards or
inside it). It does not come out as a loose fix.

---

## 1.3 · Lenses: natural lens choice, distortion and bokeh

**What exists today (main).** *Camera ▸ Lens* is a list of 8 `LENS_PRESETS`
that only set focal length and f/ (`src/data/lenses.ts:9-16`;
`src/ui/panels/insp-scene.ts:495-505`). The 16 prescriptions of A6
(`src/data/lenses.json`) are in the data but cannot be chosen. O1 (thin lens)
gives bokeh shapes, approximate cat's eye, anamorphic, *tilt-shift*, chromatic
aberration and swirl, **only in *Full* and in the render** (`camera.dofNote`,
`src/ui/strings.ts:557`: “Fast mode does not draw it”); a thin lens does not
distort. Besides, 11 of the 16 product types go at f/8, 3 at f/11 and 2 at
f/5.6 (`src/data/studios.ts`): with that depth of field the bokeh is barely
visible. That explains “there is some effect but it is not noticeable”.

**O2 covers almost all of it**: *Simple lens · Traced lens*, character, the 16
lenses traced surface by surface, distortion, vignetting, cat's eye, bubble,
creamy and swirl from the lens itself, bokeh types of the traced lens, and in
*Fast* approximate distortion and vignetting (Repackshot-o1, ROADMAP §O2
“Done”; UI.md *Camera ▸ Lens*). What remains: the merge, Fable's verdict on
the sheet (O2, “did not fit” 11), the noise of the traced bokeh (about five
times the variance of the thin lens with the same samples, “did not fit” 2)
and the untraced tilt (“did not fit” 3).

**Reproduction.** Confirmed by code on main.

**Classification.** **missing**, covered by O2 (pending merge and verdict).

**Proposed fix.** Merge O2. Separately (S): have the product types or the
camera note say that at f/8 the bokeh will not be seen (or a Doctor warning);
the f/ criterion is photographic and is not changed here.

**Dependencies.** O2, Fable's verdict. Nothing to take out loose beforehand.

---

## 1.4 · Window with the elements when hovering over the lens

**What exists today.** On main, nothing. In O2 the SVG cross-section is drawn
**inside** the *Lens* section, for the lens in use, with what the engine has
prepared (scaled to the focal length, focus, semi-apertures:
`src/ui/components/lens-section.ts`, “drawn from the lens as the engine
prepared it”; `src/ui/panels/insp-traced.ts:193` in Repackshot-o1). There is
no floating window when hovering over a lens in the list.

**Reproduction.** Confirmed by code (O2).

**Classification.** **missing**, partly covered by O2 (the drawing exists; the
*hover* does not).

**Proposed fix** (S–M, after O2). A floating popover over each *Lens* entry
(and the chips) with the SVG. Minor technical decision: for a lens that is not
in use there is no `LensInfo` from the engine; either the engine is asked
about the lens pointed at (`rt_scene_lens_info`, asynchronous, cached by key),
or it is drawn from the prescription without focusing or scaling (it would not
be “what gets traced”). It touches `insp-traced.ts`, `lens-section.ts`, the
`es`/`en` strings, a check in `tools/lens-check.mjs`.

**Dependencies.** O2. Not before.

**Done in O2b** (`ROADMAP.md`): the window on hovering or focusing a lens in
the list and a character chip, asking the engine about the lens pointed at,
with a cache per lens. A browser `select` list does not tell the page which
entry the pointer is over: the *Lens* list became the interface's own.

---

## 1.5 · Lens editor: edit elements, sizes, distances, add, turn 180°

**What exists today.** O2 built O5's editor (character, cross-section,
*non-physical* settings, *Save lens as…*), but **a custom lens stores the
catalogue key and its settings, not a copy of the surfaces** (O2, “did not
fit” 5). Only the variable gap of the soft lens is edited. The prescription
travels whole in `LENS` (O2: “the page writes the same bytes for the 16
lenses”), so the engine should not need a new format; I have not checked it
with an edited prescription.

**Reproduction.** Confirmed by the O2 documents and code.

**Classification.** **decision**. Questions: (1) whether a custom lens becomes
a complete editable prescription (this changes the `lens` type of the U4/O2
library and its validation on import); (2) what is guaranteed for an edited
lens (that it forms an image, no total reflection, valid semi-apertures; if
it loses the `verified` mark and becomes `own-design`); (3) which controls:
radius, thickness, gap, glass (nd, vd), semi-aperture, add and remove an
element, “turn 180°” (reverse the order of the surfaces and the sign of the
curvatures of the element or the group); (4) whether the engine recomputes the
numbers on the fly (every edit is a new `LensInfo`).

**Proposed fix.** A phase of its own (L): editable prescription model in
`src/core/traced-lens.ts`, paraxial validation in the page or in the engine,
editor in the *Lens* section with the interactive cross-section, library,
round-trip tests and a test that a lens reversed twice is the same.

**Dependencies.** O2 (merge) and the decision.

---

## 1.6 · Woods do not look as they do on the spheres; no material works with the nodes

**What exists today.**
- **Nodes in *Fast***: the graph is baked into 512² maps that enter through
  M2a's slots (colour, roughness, metal, normal, alpha, emission); the other
  outputs go with their mean, Fresnel at 60° and curvature 0; the 3D parts are
  a front cross-section drawn as a box (M3a “Done” and “did not fit” 3;
  `src/render/graph-preview.ts`).
- **Nodes in *Full* and *Render*** (until M3b; see *Status after M3b*): only
  the mean of each output (`src/io/rsb.ts:1057`, `flattenGraph`), and a node
  material carries no `PATN` (`rsb.ts:1216`). The interface says so
  (`src/ui/strings.ts:717`). With the viewport in *Full* by default
  (`ui-state.ts:505`), **a graph has no spatial effect in the default mode**:
  that is exactly “no material is functional with respect to nodes”. M3b (the
  engine evaluates graphs) is queued, after M2b.
- There is no *Wood* or *Fabric* node: turning a catalogue wood or fabric into
  *Nodes* gives the minimal graph with its flat colour
  (`src/core/material-graph.ts:365` and `minimalGraph`, `:425`), so in *Full*
  it loses rings, pores, knots and weave (documented in the comment of
  `outputSetup`).
- **Wood**: in *Fast*, mean colour and darkened knots
  (`src/render/materials.ts:122-129`; note `material.fullOnly`,
  `strings.ts:742`); in *Full*, E6's grain at physical scale (rings of 2 to
  5 mm depending on the species). The catalogue spheres are three.js ones
  (`src/render/thumbs.ts`, `applyMaterial`): flat colour. The spheres with
  grain that the owner saw may be E6's sheet (`rt --pattern-sheet`, spheres
  and boxes of 60 × 40 × 25 mm) or the 64 × 64 spheres of the node editor
  cards (CPU interpreter with the exact 3D noise), which in *Fast* look like a
  front cross-section and in *Full* like the mean. M3a's verdict already said
  that the wood of `MATERIAL_GRAPHS` has to look like the *Wood* family and
  that M3b will look at that.

**Bug found along the way (confirmed with a test).** The fabric's `outputSetup`
uses `(a + b) / 2` (`material-graph.ts:405`) instead of `fabricMeanColor` (the
warp's share of the face per weave, `src/core/materials.ts:187`), which is
what the engine, *Fast* and the thumbnails use. Its own comment says that the
minimal graph receives “the values the engine and the preview read”. Switching
to *Nodes* changes the colour: denim (`DENIM`, 3/1 twill) from
(0.276, 0.318, 0.407) to (0.380, 0.410, 0.470), that is, it returns to the
bluish grey that E6 corrected; satin Δ 0.029; microfibre Δ 0.007; the rest,
the same (`triage/vt/fabric.test.ts`). It slipped through because the tests in
`tests/material-graph.test.ts:238-250` only check the round trip, not that the
minimal graph gives the engine the same material.

**Reproduction.** Nodes: confirmed by code. Wood: it cannot be known which
spheres the owner was looking at or in which mode; without that scene, not
confirmed. Fabric → nodes: confirmed with the test above.

**Status after M3b (done).** The nodes now drive the material in *Full* and in
*Render*: the engine runs the graph's program at every hit, with the same bits
as the *Fast* interpreter (cross-test of 172 cases), and the page sends it
when the engine says it runs it (`rt_features` bit 1, launcher `features`); to
an older engine, the mean of each output, as before. The ten examples land
where *Fast* draws them (seven at 100 % of settled pixels; the other three,
and why, in M3b's paragraph of the ROADMAP), and `docs/ui/m3b-graphs.png`
shows them in *Full* with their mean and with their program. What remains:
the *Wood* and *Fabric* nodes (the decision above; M3b does not add them and
says how the interpreter makes them easier), the resemblance of the wood
example to the *Wood* family (`docs/ui/m3b-wood.png`: they do not look alike),
and the `NORMAL_MAP` of the metallic paint flakes, which turns half of their
normals inward (decisions for Fable). The fabric bug when switching to nodes
is separate (1.6b, already fixed: `fabricMeanColor`).

**Classification.** **missing** (M3b; *Fast* approximates), with a loose
**bug** (the fabric colour when switching to nodes) and a **decision**
(whether M3b adds *Wood* and *Fabric* nodes that expose E6's recipes, so that
“all materials” work with nodes).

**Proposed fix.**
- Bug (S): FABRIC `outputSetup` with `fabricMeanColor(p)`. Test that would
  fail: for each `MATERIAL_PRESETS`, `materialToRsb({ ...m, graph: minimalGraph(m) }).baseColor`
  equal to `materialToRsb(m).baseColor` (fails today on `DENIM`, `SATIN`,
  `MICROFIB`).
- M3b (L, phase): program interpreter in `rt-core`, with M3a's TS/Rust
  cross-test; E6 nodes if decided.
- Meanwhile (S): have the material's card and section say, in *Full*, that the
  graph is seen as a mean (it is already in the editor; check that it shows in
  the inspector).

**Dependencies.** M2b → M3b; E6 (done). The bug comes out on its own.

---

## 1.7 · Focal length: switch between moving the camera closer or the focused object

**What exists today.** The *Focal length* field dispatches `camera/set { focalMm }`
(`insp-scene.ts:506`): the camera does not move and the subject changes size
(pure zoom, `src/core/camera.ts:332-339`). Choosing a lens preset does
something else: `camera/lens` calls `frameActive` (`camera.ts:366-371`), which
reframes everything, moves the distance and **sets the focus at the framing
distance** (`frameBox`, `camera.ts:199`). There is no “keep the subject's
size” mode (*dolly zoom*); it only exists as an animation move
(`contra_zoom`, `src/data/camera-moves.json:74-83`: dolly 40 % plus focal ×
0.6). O2 does not touch it (same `camera/set` in Repackshot-o1).

**Reproduction.** Confirmed by code.

**Classification.** **decision**. Questions: (1) what is kept in the “camera
moves closer” mode: the size of the plane of the target (`target`) or of the
focused point (`focusDistance`) (they are not the same after *Focus with a
click*); (2) the switch's default value and whether it is per camera (saved
in the project) or an interface setting; (3) whether the lens preset should
follow the same switch instead of always reframing; (4) what it does in
orthographic (nothing). Datum: to keep the size on the plane at distance `d`,
`d' = d · f'/f` and `focusDistance' = focusDistance · f'/f` if the focus
follows the subject; L4's locked camera cannot move.

**Proposed fix** (S, after deciding). A field in `CameraState` or a setting,
`camera/set` with the rule, the switch next to *Focal length*, strings, a test
that the projected size of the target does not change.

**Dependencies.** None; it comes out on its own.

---

## 1.8 · Focus with a click does not focus on the clicked pixel

**What exists today.** SPEC §3.5: “*Focus with a click*: the picked point sets
the focus distance”. The pick is indeed the pixel's: `clickAt`
(`src/ui/panels/viewport-overlays.ts:593-603`) takes the point with the Fast
view's *raycaster* (`src/render/preview.ts:1811`) and the distance along the
axis (`focusDistanceTo`, `camera.ts:123`, the v0.1.6 fix). Fast's projection
covers the whole canvas with U13's frame centred (`preview.ts:1155-1171`), and
the *Full* image covers the same canvas (`src/io/rsb.ts:1275-1286`), so the
frame introduces no offset (at most half a CSS pixel, because `resize` uses
the integer `clientWidth` and `local()` the fractional rectangle:
`viewport.ts:68`, `viewport-overlays.ts:424-427`).

**The fault comes afterwards**: the same click undoes the focus. OrbitControls
fires `end` on every `pointerup` even if nothing moved
(`node_modules/three/examples/jsm/controls/OrbitControls.js:1608-1621`,
listener on `document`, `:1562`), after the canvas listener that focuses;
`preview.ts:473-476` passes it to `onViewChange`, and `src/main.ts:1066`
builds the patch with **`focusDistance: v.distance`**. `sameView`
(`camera.ts:291`) also compares the focus, which is no longer the orbit
distance, so it dispatches *Move the camera* with the focus returned to the
target. The same happens with a typed focus: any click in the viewport
(selecting a part) returns it to the orbit distance. The *Look through* path
has the same pattern (`src/core/view-objects.ts:222`), and the camera *gizmo*
path already does the right thing: the focus follows the distance only if it
was following it (`view-objects.ts:139-140`).

**Reproduction.** Reproduced in Chromium with the main build
(`triage/focus-repro.mjs`): with *Focus with a click* active and a click on
the example's jar, the *Focus distance* field goes through
**688 → 660 → 688** and the undo entry ends up as *Undo: Move the camera*; a
typed focus of 638 returns to 688 after a click on the scene. The O2 branch
has the same line (`src/main.ts:1115` in Repackshot-o1).

**Classification.** **bug**.

**Cause.** `src/main.ts:1062-1070`: the view patch always sets
`focusDistance: v.distance` and a click without movement counts as a view
change.

**Proposed fix** (S). A pure function in `src/core/camera.ts` (e.g.
`orbitPatch(cam, view)`) that returns `null` if azimuth, elevation, distance,
target and orthographic width do not change, and that moves the focus only if
it was following the distance (the rule of `view-objects.ts:139-140`); use it
in `main.ts` (`onViewChange` and `gestureView` of `onGesture`, `:1079`) and in
`lookThroughAction`. Tests: in `tests/camera-focus.test.ts`, (1) a view equal
to the camera's with focus ≠ distance gives no patch (fails today), (2) an
orbit with the focus following moves it, (3) an orbit after a click focus
keeps it; and a browser check (`tools/`, like `focus-repro.mjs`) that makes
the real click and reads the field.

Two minor faults on the same path, read in the code and not reproduced:
(a) `clickAt` measures from `activeCamera(s)` (`viewport-overlays.ts:600`)
even when the view is that of another camera (*Look through*) or that of an
animation shot with the playhead away from 0 (`preview.ts:1136-1146`): it
should use the viewed camera (`viewedCamera`) and its id; (b) with *tilt* (O1)
the focus plane turns around the point on the axis, and a point off the axis
does not end up on it. **Risk with O2**: *Fast* draws a traced lens's
distortion as a screen pass (`render/lens-profile.ts`), but `pick` still uses
the undistorted ray (`preview.ts:1842` in Repackshot-o1): with a wide angle or
the fisheye the picked point will not be the one under the cursor. It also
affects `glyphAt`, the *gizmo* and box selection.

**Dependencies.** None for the main fix (it comes out on its own, also on top
of O2). The distortion risk, with O2.

---

## 1.9 · aintfilm: double vertical bar in the LUT carousel

Outside this repository according to the report; only noted. One datum:
Repackshot does draw the film plugin's recipe carousel (*Render window ▸
Plugins*, `src/ui/panels/plugin-recipes.ts`), but it is horizontal and its
strip carries `overflow-y: hidden` (`src/ui/render.css:452-456`). If the
reporter's capture was of Repackshot's render window and not of aintfilm, the
fault would be here. Not checked.

---

## 2.1 · The AI Render hardly does anything

**What exists today.** The guard (X3a, `rt-post`) lets through only a soft
change of light and colour, with caps that scale with the controls and the
*Intervention*. Default values (`src/core/ai.ts:46-51`): Intervention 30,
Light 50, Bounces 40, Wear 20, Style strength 30. With `MAX_STRENGTH = 0.4`
(`engine/crates/rt-post/src/job.rs:12`), the model works at img2img strength
**0.12**. The caps of the first attempt (`prepared.rs:61-71` with
`Tolerances::PROVISIONAL`, `job.rs:145-160`) are: local light
0.5 × 0.3 × 0.3 = 0.045 in natural logarithm (**±4.6 %** of luminance),
bounces 0.4 × 0.3 × 0.15 = 0.018 (**±1.8 %** of colour), style ±1.8 %, wear
0.9 %; and each material stays within mean ΔE₀₀ 2 and p95 3, at 80 % of the
margin (`guard.rs:47`, `MARGIN`). Each retry multiplies everything by 0.6
(`RETRY_FACTOR`, `job.rs:17`); the fourth, at 0.216 of the first. If no
attempt passes, the engine's image is delivered unchanged. All those numbers
are marked *provisional* and Fable sets them in X1 part B with the comparison
sheet that the owner runs on their own machine (ROADMAP §X1, part B, not done;
CHANGELOG v0.1.6: “the guard's tolerances are provisional”).

**Reproduction.** There is no GPU or model here; confirmed by code and by the
arithmetic above: with the default values the permitted change is almost
imperceptible by construction.

**Classification.** **decision** (X1 part B, Fable): the `cap_*` caps, the ΔE
values, `MAX_STRENGTH` and the controls' default values. Options: raise the
caps and the strength; make *Intervention* 100 mean a visible change (today
±35 % of light and ±16 % of colour in the best case); or separate the caps of
critical materials (labels, logos) from the others. A fact that helps: the one
real pass (SD 1.5 on CPU, Intervention 100) passed on the first attempt with
ΔE₉₅ 1.9 and the guard limited the floor to 71 % (ROADMAP §X3c).

**Proposed fix.** After X1b's sheet: change `Tolerances::PROVISIONAL` and the
default values (S), with the `rt-post` tests that pin the constants brought up
to date. Meanwhile (S): have the report say how much was applied (it already
says “The AI was limited to N %”) also when it is accepted on the first
attempt with the caps at their maximum.

**Dependencies.** X1 part B. It does not come out loose.

---

## 2.2 · It gets stuck in a loop of attempts

**What exists today.** The loop has a cap: `rt-app/src/ai/post.rs:883-1001`
repeats while `rt_post::accept` says `Retry`, and `accept` only says it if
`attempt + 1 < MAX_ATTEMPTS` (4) (`rt-post/src/lib.rs:459-468`; and it rejects
`attempt ≥ MAX_ATTEMPTS`, `:318`). Tests pin it (`rt-app/tests/ai_post.rs:338`,
`rt-post/src/tests.rs:672-674`). The page waits for a final state
(`src/io/ai-post.ts:216-224`). The queue repeats the step for each X4b variant
(`src/ui/render-queue.ts:188-223`): with N variants that is up to 4 × N
attempts, each with all its tiles. The row says “AI · tile i of n · attempt a”
without “of 4” or the reason for the failure (`src/ui/panels/queue.ts:36-50`),
and the bar approaches 1 without reaching it on each retry (`post.rs:997`).

**Reproduction.** **Not reproduced** (no model or GPU). No endless loop has
been found in the code. What the owner sees as a loop may be: (1) all the
attempts fail on the same check, which lowering the strength does not fix,
and with variants the cycle starts over; (2) on CPU each attempt takes minutes
per tile (the one real pass: 53 s for 256 × 192); (3) in the render window's
preview, the `u.models` watcher (`src/ui/panels/ai-post.ts:419-430`) calls
`preview.touch()` with every snapshot of the model manager, which during a
download arrives every 200 ms (`src/io/downloads.ts:131`, `:608-620`): the
preview is abandoned and starts over without ever finishing (hypothesis read
in the code, not tested). To reproduce it the launcher's log is needed
(`<data>/logs/repackshot.log`): each failed attempt leaves
“AI post N: attempt k failed: <reason>” (`post.rs:991-995`), with the number
of variants, the execution engine (CPU or GPU) and the job size.

**Classification.** Provisional **bug** (the owner describes something that
does not end, against the contract of AI-POST §7.2), pending reproduction. If
the log shows that it ends at the 4th attempt, it becomes **missing** (what
the queue counts) plus the decision of 2.1.

**Proposed fix.** (a) S: “attempt a of 4”, the variant, and the reason for the
last failure in the row and in the final notice; the bar divided by attempts.
(b) S: the preview does not restart on manager snapshots that do not change
`installed` or `ready` (compare those fields, not the object); test with the
controller and a fake clock (`AiPreviewController` is already tested that
way). (c) Whatever the log says.

**Dependencies.** 2.1 (if all attempts fail, it is the guard), X1b.

---

## 3.1 · Queue: real-time view of the selected render

**What exists today.** The queue row only shows a thumbnail when the job has
finished (`src/ui/panels/queue.ts:86-99`); while it runs, status and bar.
`FrameRequest.onProgress` gives numbers, not an image (`src/ui/ports.ts:262-288`).
The native render is progressive and publishes frames
(`engine/crates/rt-app/src/render.rs:1-36`, the ones used by the *Full*
viewport in `src/render/native.ts`); on the web, the `src/render/tiles.ts`
pool. U5 did not plan it and UI.md §2.5 does not mention it.

**Reproduction.** Confirmed: it does not exist.

**Classification.** **missing**. To be specified (the report itself says so):
only the running job or also the finished ones (these already open the results
viewer), and at what size.

**Proposed fix** (M). An `onFrame` in `FrameRequest` (desktop: the job's frame
from `/api/render`; web: the pool's accumulation every so often), a panel or
the results viewer in “in progress” mode when the row is selected, with its
measured cost (not slowing the render). Queue test with a fake render that
delivers frames.

**Dependencies.** U5 (done), N2 (queued, touches the queue). It comes out on
its own.

**Status.** Done in **U14** (`ROADMAP.md`): only the running job shows its
live image (one waiting says so, a finished one opens its result), in the
results viewer in “in progress” mode, reduced to what fits.

---

## 4.1 · `.repack.json` is saved and not `.repack`

**What exists today.** It is what is documented: `.repack.json` in U2 (ROADMAP
l. 285-322), SPEC §3.9 (l. 1221), ARCHITECTURE §8 and UI.md (l. 121). In the
code: `PROJECT_EXTENSION` (`src/ui/commands.ts:516`, with the comment “it is
JSON, so `.json` alone is not enough”), `isProjectFile` (`:519`), the web
picker (`src/io/project-file.ts:66`, `:90`), the desktop dialog filter
(`src/io/desktop-files.ts:297`), the launcher
(`engine/crates/rt-app/src/files.rs:54`, `dialogs.rs:898`) and its Wine test
(`packaging/wine-dialogs.mjs:77-81`). Besides, the launcher only writes
extensions from a list that has no `repack` (`files.rs:40-41`,
`WRITABLE_EXTENSIONS`): saving `.repack` on desktop would be rejected. No
installer associates the extension with the program.

**Reproduction.** Confirmed by code.

**Classification.** **decision** (it changes U2's contract; rule 12): (1)
whether the content stays JSON and only the extension changes; (2) whether
`.repack.json` files keep opening (the natural answer: yes, and dropping them
on the window); (3) whether the extension is registered in the Windows
installer and the Linux entry (double-click opens Repackshot); (4) MIME type
for the browser.

**Proposed fix** (S–M). The constants above, `WRITABLE_EXTENSIONS`, the
filters and `accept` accepting both, the tests of `files.rs` and `dialogs.rs`,
the Wine test, and the documents. File association: M (NSIS and `.desktop`
with MIME).

**Dependencies.** U2, P2 and P3e (launcher dialogs). It comes out on its own
after deciding.

---

## 4.2 · *Denoise* washes out lights and colours and removes personality

**What exists today.** `rt_post::denoise` (E5b-1): 5-pass à-trous guided by
albedo, normal, depth and ids, with SVGF's luminance stop, on linear light
(also in the page: `src/render/denoise.ts`), never in screen space. Two things
that remove energy or colour on purpose: the **firefly clamp**, which lowers
to 4× its brightest neighbour any pixel that exceeds it on the same surface,
without looking at its variance or the samples, and whose excess “is lost”
(`engine/crates/rt-post/src/denoise.rs:121-126`, `:512-548`); and an edge stop
that is **luminance only** (`SIGMA_LUMINANCE`, `:50`): two lights of equal
brightness and different colour on a surface can be blended. Default values:
*denoise* in viewport and render, strength 100 (`src/core/render.ts:94`), the
viewport with U11's light filter (3 passes, `denoise.rs:86-89`). What changed
recently and can be confused with the *denoise*: U11 (the viewport always
reduces noise, live), the *Fine* pixel filter (3 px Blackman–Harris) by
default since E11 (`src/core/antialias.ts:24`), which softens, and E9a's
energy compensation (+13 to 16 % light in the pinned scenes).

**Measured** (`triage/dn/`, `rt` from main, 480 × 360, 32-bit linear TIFF):
- Example jar against a 4096-sample reference: at 16 and 256 samples the
  *denoise* does not change the mean luminance (0.21368 and 0.21377 against
  0.21374), nor the mean saturation (0.1985 against 0.1984), and the energy of
  the brightest 0.1 % stays at −0.35 % at 256 samples; the mean on-screen
  gradient, −4 % against the reference (it does not over-blur). relMSE: from
  0.00226 to 0.0002 at 16 samples.
- E5b's glass and caustics scene: at 256 samples, mean luminance −0.33 %,
  energy of the brightest 0.1 % −1.8 %, maximum −6.7 %, saturation +0.45 %;
  of 2236 pixels above 1.0, 32 drop by more than 25 % (the bright ones keep
  97.4 % of their energy). At 16 samples, mean luminance −2.1 % and the bright
  ones keep 77.6 % (part of it is noise).

**Reproduction.** **Not reproduced** in the engine's scenes: no desaturation
measured and the loss in the highlights is small at 256 samples, somewhat
larger at few samples (the viewport's). The owner's scene may have what these
lack: one-pixel highlights from small lights (jewellery, polished metal, paint
flakes), exactly what the firefly clamp treats as noise even when converged,
or coloured lights (`POP_COLOR`, `WARM_COOL_CINEMA` sets). To reproduce it:
that scene with *Also save without denoise* (the two files of the same render)
and whether it is seen in the viewport or in the final render.

**Classification.** **decision** of visual judgement, after measuring: the code
does what E5b-1 says (including losing the fireflies' energy). Options: (1)
clamp only pixels with high variance or below N samples; (2) add chrominance
to the edge stop; (3) lower U11b's default strength; (4) *Standard* filter by
default if the complaint is sharpness.

**Proposed fix.** S: reproduce with the owner's scene and measure which
mechanism it is (with `--denoise-strength`, `--pixel-filter` and the clamp
switched off in a copy). Then, S–M in `denoise.rs` with a new *hash* of
`PINNED_DENOISED_EXAMPLE_4SPP` and a test of a converged one-pixel highlight
that keeps its energy (it would fail today).

**Dependencies.** E5b-1, U11, U11b, E11. It comes out on its own.

---

## 5.1 · Materials do not adjust to the size of the solid

**What exists today.** Every material size is absolute, by documented decision:
- Images: `sizeMm` in mm (SPEC §3.3, l. 446-457: “why the size is in mm and not
  in part sizes”). The first image sets the size of the whole scene,
  `scene.partSizeMm` (`src/core/textures.ts:621`), not that of the part
  carrying the material; *Fit to part* uses the longest side of the parts that
  carry it, by hand (`insp-textures.ts:169`,
  `src/ui/texture-commands.ts:94-103`). M2a's plan said “scale (mm or part
  sizes)”; only mm was built.
- Wood and fabric: physical scale by the lead's decision in E6 (“The scale is
  physical, not in part sizes”; SPEC l. 101-105).
- Nodes: object coordinates in mm × 0.01 (`OBJECT_SCALE`,
  `src/core/material-program.ts:201`).
- Only UV adapts by itself (the mesh's UVs).

A passing inconsistency in the documents: SPEC l. 456 says that “the
procedural (wear, grain and E6's weave) stays in part sizes”, against SPEC
l. 101 and E6.

**Reproduction.** Confirmed by code: it is the documented behaviour.

**Classification.** **decision** (it contradicts the lead's decisions in M2a
and E6). Questions: dynamic adjustment always or with a switch per material
(*Size: mm · relative to the part*); with a material shared by parts of
different sizes, relative to each part (the engine needs each instance's box
when shading) or to the scene?; and what wins if the owner sets a size by hand
(the report itself asks). For wood and fabric, whether a physical recipe can
have a relative mode without ceasing to look like wood.

**Proposed fix.** After deciding: a “part sizes” unit in `TextureMapping` and
in the *Mapping* node (M, interface and M2b's RSB), and in `PATN` if it
reaches E6 (M). S, independent of the decision: have the first image take the
size of the parts that carry the material (`materialPartSize`) and not that of
the scene, as the button already does (it contradicts the comment “one repeat
spans the part” only when the part is smaller than the model; the SPEC says
“the part's size”, which it defines as the model's, so that too is to be
decided).

**Dependencies.** M2b (the engine has to read it), E6, M3b, 1.1.

---

## 6.1 · Studio presets: out of *Lights*, into *Studios*

**What exists today.** L6's 16 sets are `SETS`-style light setups
(`src/data/light-setups.ts:31`, `:101-444`) and are chosen in *Scene ▸ Light*,
first and large: two square columns against three at 4:3
(`src/ui/panels/insp-scene.ts:289-299`, `large: st.style === 'SETS'`; UI.md
l. 542-547). The *Studios* tab of the left panel is something else: studios
saved by the owner (camera, setup, environment, materials)
(`src/ui/panels/scene.ts:364-420`; UI.md l. 248-250). And *Product ▸ Create
studio* builds the product type, which since L6 takes its lights from a set
(`src/data/studios.ts:11`, `PRESET_SETS`).

**Reproduction.** Confirmed: it is what L6 designed.

**Classification.** **decision** (L6 was Fable's design). Questions: what
“studios” means to the owner (the saved-studios tab, the *Product* section with
*Create studio*, or a new section); whether a set stops being a light setup
and becomes a studio (decor + its lights + suggested camera) with the light
setups as a separate layer.

**Proposed fix.** After deciding: M (move the sets grid, its filters and *In
the set*; stable keys, rule 7).

**Dependencies.** L6; goes with 6.2 and 6.3.

## 6.2 · Choose a studio with swatches of the current size

**What exists today.** The large thumbnails are the sets' `thumbs cols-2`
(`insp-scene.ts:297`), 256 × 256 rendered by the engine.

**Classification.** **decision** (part of 6.1); once decided, S (the same large
grid wherever it goes).

## 6.3 · The proposed lights are added to the studio, without interfering, and are easy to turn off

**What exists today.** Choosing any setup (set or not) **replaces all the
lights**, own lights included: `studio/setSetup` and `studio/applySetup` set
`lights: lightsFromRig(...)` (`src/core/lighting.ts:602-629`, `lightsFromRig`
at `:160`), with a confirmation if the setup was modified
(`src/ui/commands.ts:1766-1777`); a set also changes its decor
(`src/core/sets.ts:633-645`). Turning lights off one at a time already exists
(`LightInstance.enabled`, `lighting.ts:51`; switch per light in the *Lights*
tab, UI.md l. 229-231).

**Classification.** **decision** (light model): whether the lights are grouped
(those of the studio and those of each added setup, with their group switch),
what happens to *Reset to setup* and *modified*, how the project and the
library store it, and how the Doctor sees it (exposure with more lights).
Datum: “add without interfering” doubles the light; the sets are exposure
calibrated for their own lights (L6, `exposureEv`).

**Proposed fix.** After deciding: M (light groups in the *store*,
`lightsFromRig` that adds, the list with groups, project migration, undo
tests). K8 (light groups after the render) is a neighbour.

**Dependencies.** L6, L4; with 6.1.

---

## Findings outside the items

- **Focus with a click**, besides the bug of 1.8: it measures from the active
  camera when looking through another one or in an animated shot
  (`viewport-overlays.ts:600`), and with O2 the pick does not undo *Fast*'s
  distortion.
- **Fabric to nodes**: the colour changes (1.6), test included.
- **SPEC l. 456** contradicts SPEC l. 101 and E6 on the scale of the
  procedural (5.1).
- **M2a** promised “mm or part sizes” and only did mm, without noting it in
  “did not fit” (5.1).
- **Launcher**: `WRITABLE_EXTENSIONS` does not admit `repack` (4.1).

## Table

| Item | Classification | Size | Depends on | Order |
| --- | --- | --- | --- | --- |
| 1.8 Focus with a click | bug (reproduced) | S | — (risk with O2) | 1 |
| 1.6b Fabric to nodes changes colour | bug (test) | S | — | 2 |
| 2.2 Loop of attempts | provisional bug, not reproduced | S (diagnosis and labels) | owner's log, 2.1, X1b | 3 |
| 4.2 *Denoise* washes out lights and colours | decision, not reproduced (measure first) | S + S–M | E5b-1, U11, U11b, E11 | 4 |
| 1.3 Choose lenses, distortion, bokeh | missing (O2 covers it) | — (merge O2) | O2, Fable's verdict | 5 |
| 1.4 Elements window on hover | missing (done in O2b) | S–M | O2 | 6 |
| 1.1 Mapping in the editors | missing (+ minor decision); (a) done in M2b | L (M2b, done) + M (interface) | M3b, 5.1 | 7 |
| 1.6 Nodes and woods | missing (+ decision: E6 nodes) | L (M3b) | M2b → M3b | 8 |
| 3.1 Live queue | missing | M | U5, N2 | 9 |
| 2.1 The AI hardly does anything | decision | S after the sheet | X1 part B | 10 |
| 6.1–6.3 Studios and added lights | decision | M | L6, L4 | 11 |
| 1.7 Focal length: move camera or subject closer | decision | S | — | 12 |
| 4.1 `.repack` | decision | S–M | U2, P2/P3e | 13 |
| 5.1 Size relative to the solid | decision | M | M2b, E6, M3b | 14 |
| 1.2 Drop and varied shapes | decision | M–L | S0, S4b | 15 |
| 1.5 Lens element editor | decision | L | O2 | 16 |
| 1.9 aintfilm | outside the repository | — | — | — |

Order: first what breaks something already delivered (1.8, the fabric colour,
the diagnosis of 2.2 and the measurement of 4.2), then what is missing and
already has a phase (merge O2; M2b → M3b, which fix 1.1, 1.6 and part of 5.1
at once; the live queue), and last the decisions. Among the decisions 2.1
goes first because the AI Render being any use depends on it, and after it
those that unblock small work (6.x, 1.7, 4.1).
