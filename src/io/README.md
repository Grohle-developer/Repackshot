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
- `library.ts`: the user's own library (U4) as a file and as stored data. `{ format: 'repackshot-library', schema: 1, items }`
  is both the exported JSON and what is stored under a single key (`repackshot.library`: `localStorage` on the web,
  `library/library.json` on the desktop). Everything that
  comes in is validated item by item and rebuilt with the known fields; an invalid one is skipped, with the reason.
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
- **The platform seam** (P3e): `platform.ts` defines `Platform`, every service that stores something or asks the
  machine a question (settings, small remembered things, library, results history, model store, hardware,
  space used, thumbnails), chosen once at startup with `choosePlatform()`. `platform-web.ts`: the browser
  (localStorage, IndexedDB, OPFS, WebGPU). `platform-desktop.ts`: in the launcher's window the page is only the
  interface and everything belongs to the launcher (`settings.json`, `state/`, `library/`, `results/`, `cache/thumbs/` in the
  data folder, through `native-store.ts`), with a one-time migration, once per data folder, of what an earlier version
  left in the browser's storage. `prefs.ts`: the settings document over any `KeyValue` (it migrates the loose keys of
  before, `repackshot.lang`, `.theme`, `.ui.*`; a damaged one is set aside as `.corrupt`).
- `native.ts`: the desktop launcher seen from the page (`engine/crates/rt-app`): the token taken from the window
  URL's fragment into `sessionStorage`, `connectNative()` (null in the web version), and `NativeClient` for its API
  (info, hardware and recommendation, the model store by blob, the installer's pending choice, open folder, the
  heartbeat that keeps the launcher running). The contract is `engine/crates/rt-app/README.md`.
- `project.ts`: the `.repack` project file (U2; up to v0.1.6 `.repack.json`, which still opens): `{ format, schema, state, meshes }`. The state goes as it is
  (with `-0` preserved and `meta.dirty` set to false); each mesh a part uses goes once in `meshes` as a base64 GLB
  (`glb.ts`, bit for bit), with its sharp edges (`sharpEdges`) and the triangle map (`triangleSource`) beside it.
  `loadProject` reads, migrates (`STEPS`), checks the structure and registers the meshes under ids nobody else
  uses (`prjN:`); a damaged file, one from a newer version or one that is not a project throws `ProjectError` without touching the
  registry. `readProjectFile` is the same for the interface, without throwing.
- `glb.ts`, `base64.ts`: a mesh's GLB (writer and reader of the subset written here, not a glTF importer)
  and chunked base64 for buffers of tens of megabytes.
- `project-file.ts`: where the project is written to and read from: File System Access (*Save* writes to the
  same file again; *Save as…* asks) or a download and `<input type="file">`; if a dialog fails, it downloads. The
  last file opened or saved is remembered (its handle, in the `handles` store of `results.ts`) for *On
  start ▸ Last project* (U6): `last()` and `reopen()`, which asks for read permission from a click.
- AI models (U6, AI-POST.md §5): `model-store.ts` is the interface of the content-addressed store
  (`models/blobs/<sha256>`, `installed.json`, `imported/<key>.json`) with three implementations: OPFS through
  `model-worker.ts` (which runs `blob-store.ts` over `opfs-fs.ts`, with the incremental SHA-256 saved in
  `.part.json` after each chunk), the desktop launcher through its API (`nativeModelStore` over `native.ts`) and
  memory. `downloads.ts` is the manager: `Range` requests in 4 MiB chunks, resuming from the bytes
  already saved, verification, pause, resume, cancel, two files at a time, shared files fetched once,
  import (no pickle, with a manifest) and the installer choice. `hardware.ts`: what the browser says
  about the machine (WebGPU, cores, rounded memory) or what the launcher detected.
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
