Pure domain model: scene, parts, materials, lights, camera, studios, animation, undo. No DOM, no three.js, no I/O.

Render (U5): `render.ts` (the render window's settings, `RenderJob`, the queue reducer, `carryRuntime` for undo,
`migrateRender` for U1 projects, animation ranges and estimates), `print-size.ts` (pixels, print size and DPI),
`name-template.ts` (output names with `{project}`, `{camera}`, `{studio}`, `{date}`, `{n}`), `results.ts` (the
results history's record and eviction).
