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

Updates: `updates.ts` (versions and their order with semver's pre-release rule, reading and checking the answer of
the release feed, which package of a release is for this computer, why a check fails, and what the Updates section
says; the request is `io/updates.ts`, the repository's name `data/update-feed.ts`).
