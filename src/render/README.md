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
- `pass-planes.ts`: the engine's exact passes (X2, `core/passes.ts`): the planes of `rt_render_tile_passes` and
  `rt_render_tile_albedo` put together like the image (`PassAccumulator`), and the reader of the launcher's
  `RPP1` file (`parsePasses`). Render hands them back as `RenderPasses` when `RenderOptions.passes` asks.
- `tiles.ts`: the pure parts (tiles, passes, generations, accumulation, resolution choice), and the 16-bit and
  linear conversions of the sums (16-bit PNG, EXR).
- `schedule.ts`: when a render stops (U5): finish by samples, time, or whichever comes first, at the pass boundary
  nearest the time limit.
- `tonemap.ts`: the engine's exposure, curves and sRGB encoding, ported bit for bit (`rt --tone-table`), and the
  fast path the viewport uses.
