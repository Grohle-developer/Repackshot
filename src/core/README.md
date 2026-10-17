Pure domain model: scene, parts, materials, lights, camera, studios, animation, undo. No DOM, no three.js, no I/O.

Render (U5): `render.ts` (the render window's settings, `RenderJob`, the queue reducer, `carryRuntime` for undo,
`migrateRender` for U1 projects, animation ranges and estimates), `print-size.ts` (pixels, print size and DPI),
`name-template.ts` (output names with `{project}`, `{camera}`, `{studio}`, `{date}`, `{n}`), `results.ts` (the
results history's record and eviction).

Doctor of the engine (D1): `doctor-engine.ts` (the Doctor's checks that read the engine: `rt.wasm` and its workers, SIMD,
denoise, view transform, fireflies, video output, time budget. What the engine and the system say is not project state:
the page hands it in as `EngineFacts` (`setEngineFacts`, as `effects.ts` does with the particle cap) and asks for
`doctor/refresh`; with no facts every check here is `UNAVAILABLE`. `FrameScan` is what the Full viewport's accumulation
says (fireflies, brightness by the stop) and belongs to one project's image: `sameImage` says when it is no longer this
one. Fixes change the project and nothing else; what the project cannot change is a warning that says why, naming the
Settings row when one holds it back).

Aspect ratio (U13): `aspect.ts` (a camera's image ratio: a preset of `data/aspects.ts` or its own `w : h`, its reading and its text; the size of an image follows the active camera's: `sizeForWidth`, `aspectForSize` and `syncOutputSize` in `render.ts`).

Settings (U6): `settings.ts` (the application settings: one typed record with a schema version, defaults,
validation, migration from the loose preferences of before and from older versions, and the metadata of every row,
which drives the Settings window and its search), `models.ts` (the AI model manager's model: the store's view by
blob, imported manifests, states, what a delete removes, the fallback of the model in use, measured speed),
`sha256.ts` (streaming SHA-256 whose state can be saved and restored, so a download resumed after a reload goes on
hashing where it stopped).

Updates: `updates.ts` (versions and their order with semver's pre-release rule, reading and checking the answer of
the release feed, which package of a release is for this computer, why a check fails, and what the Updates section
says; the request is `io/updates.ts`, the repository's name `data/update-feed.ts`).

Camera moves (A6): `camera-moves.ts` (expands a product-relative move of `data/camera-moves.json` into the clips of the
timeline for a camera: degrees, percent of the framing distance and part sizes stay as they are, a focal or focus factor
becomes the absolute value `evaluate` expects; a rack focus can ask the camera for a starting focus distance).

Faces and drops (M1, U7): `faces.ts` (the whole face a click takes at the Faces level: the CAD face of a STEP or IGES
part, or the surface that continues from the triangle, grown by position of the vertices across the edges where the
angle is under 30 degrees and under 2.5 times the curvature of the face; the pieces of "Separate by CAD faces"),
`material-drop.ts` (what a material dropped on the viewport or on a row of the tree reaches at each selection level,
and the one `material/assign` it makes; `copy` is Alt).

Primitives (U9): `primitives.ts` (the twelve parametric shapes of `data/primitives.json` as pure, deterministic
generators: millimetres, Z up, centred on their bounds, which are exactly their measures; logical faces as runs of
triangles (`faceRanges`) with hard edges between them; normals of the surface, outward; uvs in [0, 1]; valid measures;
the mesh id `prim:<owner>:<KIND>:<measures>`), `primitive-ops.ts` (where a new one goes, with the product lifted onto a
base in the same action; live edits that keep the part's footing; Convert to mesh).

Selection by box (U7): `box-select.ts` (the box a drag makes: left to right is a window, right to left crossing; which
presses arm it for each mouse scheme; window and crossing tests of the projected parts, groups and models, and of the
faces that show in the rectangle; all in screen pixels, from the matrices the viewport hands over).

Own lights and the viewport's lights and cameras (L4): `lighting.ts` keeps every light of the rig, the setup's and the
own ones (`own`), each with its own placement (`az`, `el`, `dist` around the rig pivot, an `aim` and a `roll`;
`lightFrame`), and the actions that add, duplicate, delete, aim and place them; `photometry.ts` says what a point's and a
spot's watts are (as bright on their axis as a panel's) and where their lumens come from. `view-objects.ts` treats a
light or a camera as an object of the viewport: the gizmo on it and what a drag of it does (`objectGizmoAction`), the
view from it and what navigating that view does to it (`lookThroughCamera`, `lookThroughAction`), and the glyphs and the
click that picks one (`glyphsOf`, `pickGlyph`, `viewProjector`).

IES lights (L5): `ies.ts` reads the IES LM-63 text format the way the engine does (`rt_core::ies`; the engine's tests write
the files and answers that `tests/ies.test.ts` holds this reader to), and gives the profile's intensity and flux, the spot
light that stands for it in Fast (`iesSpot`) and the curves of the polar plot. A light of type `IES` keeps its file in
`LightInstance.ies` (`{ name, text, base }`: the text one character per byte; `power / base` is the multiplier the inspector
shows); `studio/addIesLight` adds one, and `lightLumens` takes its lumens from the file's flux.

Textures (M2a): `textures.ts` (the image slots, the mapping and the labels of a material, their `texture/*` actions,
and the maths of the projections and labels the preview's shader and the engine follow), `texture-images.ts`
(texture images in the registry under ids that name their content, and their limits), `image-header.ts` (the size
and channels of a PNG or JPEG from its header).

Physics (S2): `physics.ts` (the Physics section of a node: role, density by the material's category or its own,
friction, bounciness, as parts; what the simulator is given for a Drop or for the stored roles, `physicsSpec`; the
simulator's poses back to the movers' local transforms, inside turned and scaled groups and keeping each mover's
scale; the PHYSICS clip's baked track, base64 f32 written a frame at a time by `TrackWriter`, played between frames and
carried by the node's moves since its anchor; the `physics/*` actions, where a run is one gesture and Reset another
step; the Doctor's dynamic-part-below-the-floor test). `animation.ts` plays PHYSICS clips first and `playheadPose`
says what the viewport and a still show at the playhead, at 0 too for what a recorded simulation holds.
