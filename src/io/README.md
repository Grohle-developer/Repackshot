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
