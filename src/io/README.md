Importers and exporters. Depends on core. In: glTF/GLB, OBJ, STL, FBX, 3DM, STEP/STP, IGES/IGS, 3MF, PLY, DAE,
USD/USDA/USDC/USDZ; out: PNG/JPEG/EXR/TIFF/DNG and the project file.

- `import.ts` detects the format (extension, then header) and loads the right reader on demand with `import()`;
  nothing here is in the first chunk (`tests/chunks.test.ts` reads `dist/` to prove it).
- A reader returns the model as the file has it: units and axes of the file, one MODEL with GROUP and PART
  nodes, the file's materials as SIMPLE instances, and `detected` (declared units and up axis, size, layers,
  hidden parts). It never scales or turns the axes: `core/import-options.ts` does that, the same for every
  format, with the values of the import sheet.
- `obj.ts`, `stl.ts` (own, with `mesh-common.ts`: welding, smoothing-angle normals, hard edges).
- `three-scene.ts`: what the three.js readers share (Object3D tree to nodes, world transforms baked, materials,
  their maps as texture slots and the images as files, M2a; a loading manager that finds the files chosen with the
  model).
- Textures (M2a): `gltf-materials.ts` (a glTF's materials and images from its JSON; the loader gets the file without
  textures), `mtl.ts` and `obj-materials.ts` (an OBJ's libraries and their images), `texture-notes.ts` (what the sheet
  says), `texture-pixels.ts` (decoded pixels for the RSB's IMGS, read from M2b).
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
- `library.ts`: la biblioteca propia (U4) como archivo y guardada. `{ format: 'repackshot-library', schema: 1, items }`
  es a la vez el JSON exportado y lo que se guarda bajo una sola clave (`repackshot.library`: `localStorage` en la web,
  `library/library.json` en escritorio). Todo lo que
  entra se valida elemento a elemento y se reconstruye con los campos conocidos; el inválido se omite con su motivo.
- `phys.ts` (S2): the simulator's scene file (PHY1, `engine/crates/rt-phys/src/scene.rs`) for what `core/physics.ts`
  says to simulate: the meshes of the dynamic pieces and of the static parts, each body's pieces with their world
  matrices and its density, friction and bounciness, then the static parts and the floor.
- `rsb.ts`: the engine's scene file (RSB v1, `engine/crates/rt-core/src/scene/rsb.rs`). `writeRsb` writes exactly
  the bytes of rt-core's writer (`tests/rsb.test.ts` compares with `rt --write-example`); `projectScene` maps a
  project onto it: active camera (36 mm on the longer side; in the viewport, the output frame inset as the preview
  draws it), one MESH per distinct geometry and one INST per visible part, the materials with the E3 semantics,
  the resolved rig in the engine's units (`core/photometry.ts`), the studio dome, the floor and the render settings.
  `writeRsb(scene, { meshes: false })` is the update that keeps the meshes the workers already have. An IES light (L5) is
  `LGHT` kind 5 (80 bytes: the position of its profile) with its file once, as text, in an `IESP` section after the lights,
  when `SceneView.ies` says the engine renders them; for any other engine it is the spot light that stands for it.
- **La costura de plataforma** (P3e): `platform.ts` define `Platform`, todo servicio que guarda algo o pregunta al
  equipo (ajustes, cosas pequeñas recordadas, biblioteca, historial de resultados, almacén de modelos, equipo,
  espacio usado, miniaturas), elegida una vez al arrancar con `choosePlatform()`. `platform-web.ts`: el navegador
  (localStorage, IndexedDB, OPFS, WebGPU). `platform-desktop.ts`: en la ventana del lanzador la página es solo la
  interfaz y todo es del lanzador (`settings.json`, `state/`, `library/`, `results/`, `cache/thumbs/` en la carpeta de
  datos, por `native-store.ts`), con una migración, una sola vez por carpeta de datos, de lo que una versión anterior
  dejó en el almacenamiento del navegador. `prefs.ts`: el documento de ajustes sobre un `KeyValue` cualquiera (migra
  las claves sueltas de antes, `repackshot.lang`, `.theme`, `.ui.*`; uno dañado se aparta en `.corrupt`).
- `native.ts`: the desktop launcher seen from the page (`engine/crates/rt-app`): the token taken from the window
  URL's fragment into `sessionStorage`, `connectNative()` (null in the web version), and `NativeClient` for its API
  (info, hardware and recommendation, the model store by blob, the installer's pending choice, open folder, the
  heartbeat that keeps the launcher running). The contract is `engine/crates/rt-app/README.md`.
- `project.ts`: el archivo de proyecto `.repack` (U2; hasta v0.1.6 `.repack.json`, que se sigue abriendo): `{ format, schema, state, meshes }`. El estado va tal cual
  (con `-0` conservado y `meta.dirty` a falso); cada malla que usa una pieza va una vez en `meshes` como GLB en base64
  (`glb.ts`, bit a bit), con sus aristas vivas (`sharpEdges`) y el mapa de triángulos (`triangleSource`) al lado.
  `loadProject` lee, migra (`STEPS`), comprueba la estructura y registra las mallas con identificadores que nadie más
  usa (`prjN:`); un archivo dañado, de una versión más nueva o que no es un proyecto lanza `ProjectError` sin tocar el
  registro. `readProjectFile` es lo mismo para la interfaz, sin lanzar.
- `glb.ts`, `base64.ts`: el GLB de una malla (escritor y lector del subconjunto que escribimos, no un importador glTF)
  y base64 por trozos para búferes de decenas de megas.
- `project-file.ts`: dónde se escribe y de dónde se lee el proyecto: File System Access (Guardar escribe otra vez en el
  mismo archivo; Guardar como… pregunta) o descarga y `<input type="file">`; si un diálogo falla, se descarga. El
  último archivo abierto o guardado se recuerda (su *handle*, en el almacén `handles` de `results.ts`) para *Al
  arrancar ▸ Último proyecto* (U6): `last()` y `reopen()`, que pide permiso de lectura desde un clic.
- Modelos de IA (U6, AI-POST.md §5): `model-store.ts` es la interfaz del almacén por contenido
  (`models/blobs/<sha256>`, `installed.json`, `imported/<clave>.json`) con tres implementaciones: OPFS a través de
  `model-worker.ts` (que ejecuta `blob-store.ts` sobre `opfs-fs.ts`, con el SHA-256 incremental guardado en
  `.part.json` tras cada trozo), el lanzador de escritorio por su API (`nativeModelStore` sobre `native.ts`) y
  memoria. `downloads.ts` es el gestor: peticiones `Range` en trozos de 4 MiB, reanudación desde los bytes
  guardados, verificación, pausa, reanudar, cancelar, dos ficheros a la vez, ficheros compartidos una sola vez,
  importación (sin *pickle*, con manifiesto) y la elección del instalador. `hardware.ts`: lo que el navegador dice
  del equipo (WebGPU, núcleos, memoria redondeada) o lo que detectó el lanzador.
- `image.ts`: PNG written here from the path tracer's 8-bit pixels (RGB, or RGBA when transparent; deflate by the
  browser's `CompressionStream`, stored blocks without it), JPEG through a canvas, 16-bit PNG from the float sums
  and a minimal uncompressed scan-line EXR (32-bit float, linear). The DPI of the render window goes into the file
  (U5): PNG `pHYs` (pixels per metre, unit 1), the JPEG JFIF density (units 1, dots per inch) and the TIFF
  `XResolution`/`YResolution`. U12: `encodeTiff` (uncompressed TIFF 6.0, RGB or RGBA with unassociated alpha, 8, 16 or
  32-bit float) and `encodeDng` (a linear raw DNG 1.4 of 32-bit floats), the same bytes as `rt_core::tiff` and
  `rt_core::dng` (the golden files in `tests/fixtures/tiff/`).
- N2: `image.ts` also writes `encodePngWords` (a 16-bit grey or RGB PNG with `pHYs` and `tEXt` notes) and
  `encodeExrPlanes` (the same minimal EXR with the single-float channels you name, sorted); `passes.ts` turns the
  engine's pass planes (`core/passes.ts`) into one file per pass with them (`core/pass-files.ts` has the numbers and
  the names); `zip.ts` is our own ZIP writer (store method, CRC-32, UTF-8 names, no dependency), read back in
  `tests/zip.test.ts` by fflate.
- `project.ts`: the `.repack` envelope (once `.repack.json`), schema 2 (U5), and `migrateProject` / `parseProject` with one step per
  schema (1 → 2: the render block through `core/render.ts` `migrateRender`).
- `results.ts`: the results history (U5) in IndexedDB (`meta`, `blobs` and `handles` stores), 50 results or 500 MB,
  oldest evicted first; in memory when the browser keeps nothing (a private window).
- `files.ts`: where outputs go: the downloads, or a folder of the File System Access API (`showDirectoryPicker`;
  the handle kept in IndexedDB, the permission asked again from a click, never overwriting: `name (2).png`).
- `updates.ts`: the update feed: one `GET` of GitHub's `releases/latest` for the repository in
  `data/update-feed.ts`, 10 s limit (abort signal and a race), no cookies or referrer. It never throws: the answer
  is a release (read by `core/updates.ts`) or the honest reason it could not be had.
