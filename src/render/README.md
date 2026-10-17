Render engines behind one interface (`engine.ts`): the fast preview and the progressive path tracer. Depends on core,
never on ui (the RSB writer of `io/` reaches the path tracer through `SceneSource`, wired in `main.ts`).

- `preview.ts`: three.js. *Fast* mode draws everything; *Full* mode only the overlays (outline, faces, gizmo) over
  the path tracer's image. Picking and the camera controls are always its own.
- `pathtracer.ts`: the pool of workers (`navigator.hardwareConcurrency - 1`, 1 to 8), the viewport in *Full* mode
  (reduced resolution during gestures and drags, convergence after) and Render; while Render runs the viewport keeps
  a quarter of the workers (or waits, by choice), and the pool remembers which scene each worker holds.
- `native.ts`: the same engine run natively by the desktop launcher (`/api/render`, all threads, the same film as
  `rt` and the pool): viewport jobs that replace each other and keep the meshes (one posted at a time, numbered,
  every response read or cancelled), final jobs with priority that leave a live viewport a quarter of the threads,
  the launcher's RGBA sums into the same `Accumulator`. `main.ts` uses it instead of the pool in the launcher's
  window.
- `watchdog.ts`: the viewport never stays stuck in silence (P3a): limits, retries, and what the meter says.
- `worker.ts`: one worker, one `rt.wasm` (`rt-simd.wasm` when the browser has simd128), tiles in sample order.
- `physics-worker.ts`, `physics.ts`, `phys-wasm.ts` (S2): the simulator in a worker of its own (the scalar
  `rt.wasm`, its `phys_*` exports wrapped by `PhysWorld`): one run at a time, real time at most and never more than
  1/8 s ahead of the frames the page has acknowledged, the poses recorded at every frame of the project's fps,
  pause, resume and stop; `PhysicsClient` starts it on the first simulation and turns its messages into a run.
- `pass-planes.ts`: the engine's exact passes (X2, `core/passes.ts`): the planes of `rt_render_tile_passes` and
  `rt_render_tile_albedo` put together like the image (`PassAccumulator`), and the reader of the launcher's
  `RPP1` file (`parsePasses`). Render hands them back as `RenderPasses` when `RenderOptions.passes` asks.
- `frame-scan.ts` (D1): what the Doctor reads of the Full viewport's accumulation, without an engine and without a DOM:
  the fireflies (isolated pixels where one sample carries most of the light, told with the squared luminance when the
  denoise keeps it) and the frame's pixels by the stop of their brightest channel. Both engines hand it out as
  `status().scan`, read again when the samples double (`ScanCache`); the pool's workers say in their first message
  whether their `rt.wasm` can denoise.
- `tiles.ts`: the pure parts (tiles, passes, generations, accumulation, resolution choice), and the 16-bit and
  linear conversions of the sums (16-bit PNG and TIFF, EXR with premultiplied alpha, 32-bit TIFF and DNG with straight alpha).
- `schedule.ts`: when a render stops (U5): finish by samples, time, or whichever comes first, at the pass boundary
  nearest the time limit.
- `tonemap.ts`: the engine's exposure, curves and sRGB encoding, ported bit for bit (`rt --tone-table`), and the
  fast path the viewport uses.
- `texture-shader.ts` and `texture-preview.ts` (M2a): image textures and labels in *Fast* mode, the GLSL put into
  three's physical material with `onBeforeCompile` (assembled and tested without a GPU) and a cache of textures by
  image, with mipmaps.
