Importers and exporters. Depends on core. In: glTF/GLB, OBJ, STL, FBX, 3DM, STEP/STP, IGES/IGS, 3MF, PLY, DAE,
USD/USDA/USDC/USDZ; out: PNG/JPEG/EXR and the project file.

- `import.ts` detects the format (extension, then header) and loads the right reader on demand with `import()`;
  nothing here is in the first chunk (`tests/chunks.test.ts` reads `dist/` to prove it).
- A reader returns the model as the file has it: units and axes of the file, one MODEL with GROUP and PART
  nodes, the file's materials as SIMPLE instances, and `detected` (declared units and up axis, size, layers,
  hidden parts). It never scales or turns the axes: `core/import-options.ts` does that, the same for every
  format, with the values of the import sheet.
- `obj.ts`, `stl.ts` (own, with `mesh-common.ts`: welding, smoothing-angle normals, hard edges).
- `three-scene.ts`: what the three.js readers share (Object3D tree to nodes, world transforms baked, materials,
  texture blobs kept for M2).
- `gltf.ts`, `fbx.ts` (GlobalSettings scan for units and up axis), `rhino.ts` (rhino3dm in a worker, files in
  `public/vendor/rhino3dm/` copied by `tools/vendor.mjs`), `threemf.ts`, `ply.ts`, `collada.ts`, `usd.ts`.
- STEP and IGES (phase I2): occt-import-js 0.0.23 (OpenCascade in wasm, **LGPL-2.1**, the one LGPL exception,
  isolated: ARCHITECTURE §1). `step.ts` reads the unit the file declares from its text, maps the sheet's
  tessellation to the library's deflections and drives the worker (timeouts, cancel, idle); `step-worker.ts` is
  the thin worker that fetches the unmodified `occt-import-js.js` and `.wasm` from `public/vendor/occt-import-js/`
  (copied with their LGPL texts and a README by `tools/vendor.mjs`) and runs `ReadFile`; `occt-protocol.ts` holds
  the messages and the packing of the result; `occt-convert.ts` is the pure conversion to nodes: the assembly as
  named groups, every CAD face as a run of triangles (`SceneNode.faceRanges`) with its own vertices and normals,
  sharp edges where two faces meet, colours as SIMPLE instances. The library is never bundled
  (`tests/chunks.test.ts`).
- `library.ts`: la biblioteca propia (U4) como archivo y en el navegador. `{ format: 'repackshot-library', schema: 1, items }`
  es a la vez el JSON exportado y lo que `localStorage` guarda bajo una sola clave (`repackshot.library`). Todo lo que
  entra se valida elemento a elemento y se reconstruye con los campos conocidos; el inválido se omite con su motivo.
- `rsb.ts`: the engine's scene file (RSB v1, `engine/crates/rt-core/src/scene/rsb.rs`). `writeRsb` writes exactly
  the bytes of rt-core's writer (`tests/rsb.test.ts` compares with `rt --write-example`); `projectScene` maps a
  project onto it: active camera (36 mm on the longer side; in the viewport, the output frame inset as the preview
  draws it), one MESH per distinct geometry and one INST per visible part, the materials with the E3 semantics,
  the resolved rig in the engine's units (`core/photometry.ts`), the studio dome, the floor and the render settings.
  `writeRsb(scene, { meshes: false })` is the update that keeps the meshes the workers already have.
- `image.ts`: PNG written here from the path tracer's 8-bit pixels (RGB, or RGBA when transparent; deflate by the
  browser's `CompressionStream`, stored blocks without it), JPEG through a canvas.
