Importers and exporters. Depends on core. In: glTF/GLB, OBJ, STL, FBX, 3DM, 3MF, PLY, DAE, USD/USDA/USDC/USDZ;
out: PNG/JPEG/EXR and the project file.

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
- `library.ts`: la biblioteca propia (U4) como archivo y en el navegador. `{ format: 'repackshot-library', schema: 1, items }`
  es a la vez el JSON exportado y lo que `localStorage` guarda bajo una sola clave (`repackshot.library`). Todo lo que
  entra se valida elemento a elemento y se reconstruye con los campos conocidos; el inválido se omite con su motivo.
- `rsb.ts`: the engine's scene file (RSB v1, `engine/crates/rt-core/src/scene/rsb.rs`). `writeRsb` writes exactly
  the bytes of rt-core's writer (`tests/rsb.test.ts` compares with `rt --write-example`); `projectScene` maps a
  project onto it: active camera (36 mm on the longer side; in the viewport, the output frame inset as the preview
  draws it), one MESH per distinct geometry and one INST per visible part, the materials with the E3 semantics,
  the resolved rig in the engine's units (`core/photometry.ts`), the studio dome, the floor and the render settings.
  `writeRsb(scene, { meshes: false })` is the update that keeps the meshes the workers already have.
- `native.ts`: the desktop launcher seen from the page (`engine/crates/rt-app`): the token taken from the window
  URL's fragment into `sessionStorage`, `connectNative()` (null in the web version), and `NativeClient` for its API
  (info, hardware and recommendation, the model store by blob, the installer's pending choice, open folder, the
  heartbeat that keeps the launcher running). The contract is `engine/crates/rt-app/README.md`.
- `image.ts`: PNG written here from the path tracer's 8-bit pixels (RGB, or RGBA when transparent; deflate by the
  browser's `CompressionStream`, stored blocks without it), JPEG through a canvas.
