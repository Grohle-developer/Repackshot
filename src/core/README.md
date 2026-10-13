Pure domain model: scene, parts, materials, lights, camera, studios, animation, undo. No DOM, no three.js, no I/O.

Render (U5): `render.ts` (the render window's settings, `RenderJob`, the queue reducer, `carryRuntime` for undo,
`migrateRender` for U1 projects, animation ranges and estimates), `print-size.ts` (pixels, print size and DPI),
`name-template.ts` (output names with `{project}`, `{camera}`, `{studio}`, `{date}`, `{n}`), `results.ts` (the
results history's record and eviction).

Settings (U6): `settings.ts` (the application settings: one typed record with a schema version, defaults,
validation, migration from the loose preferences of before and from older versions, and the metadata of every row,
which drives the Settings window and its search), `models.ts` (the AI model manager's model: the store's view by
blob, imported manifests, states, what a delete removes, the fallback of the model in use, measured speed),
`sha256.ts` (streaming SHA-256 whose state can be saved and restored, so a download resumed after a reload goes on
hashing where it stopped).

Faces and drops (M1, U7): `faces.ts` (the whole face a click takes at the Faces level: the CAD face of a STEP or IGES
part, or the surface that continues from the triangle, grown by position of the vertices across the edges where the
angle is under 30 degrees and under 2.5 times the curvature of the face; the pieces of "Separate by CAD faces"),
`material-drop.ts` (what a material dropped on the viewport or on a row of the tree reaches at each selection level,
and the one `material/assign` it makes; `copy` is Alt).

Selection by box (U7): `box-select.ts` (the box a drag makes: left to right is a window, right to left crossing; which
presses arm it for each mouse scheme; window and crossing tests of the projected parts, groups and models, and of the
faces that show in the rectangle; all in screen pixels, from the matrices the viewport hands over).
