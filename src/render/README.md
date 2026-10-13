Render engines behind one interface (`engine.ts`): the fast preview and the progressive path tracer. Depends on core,
never on ui (the RSB writer of `io/` reaches the path tracer through `SceneSource`, wired in `main.ts`).

- `preview.ts`: three.js. *Fast* mode draws everything; *Full* mode only the overlays (outline, faces, gizmo) over
  the path tracer's image. Picking and the camera controls are always its own.
- `pathtracer.ts`: the pool of workers (`navigator.hardwareConcurrency - 1`, 1 to 8), the viewport in *Full* mode
  (reduced resolution during gestures and drags, convergence after) and Render.
- `worker.ts`: one worker, one `rt.wasm` (`rt-simd.wasm` when the browser has simd128), tiles in sample order.
- `tiles.ts`: the pure parts (tiles, passes, generations, accumulation, resolution choice), and the 16-bit and
  linear conversions of the sums (16-bit PNG, EXR).
- `schedule.ts`: when a render stops (U5): finish by samples, time, or whichever comes first, at the pass boundary
  nearest the time limit.
- `tonemap.ts`: the engine's exposure, curves and sRGB encoding, ported bit for bit (`rt --tone-table`), and the
  fast path the viewport uses.
