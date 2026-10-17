# Repackshot engine

The render engine of Repackshot: a CPU path tracer written in Rust, 100 % from scratch, PolyForm Noncommercial 1.0.0
licensed. It is built to run on any OS and any CPU architecture:

* compiled to **WebAssembly**, it runs in the browser inside Web Workers;
* compiled **natively**, it is a command line renderer today and the core of a desktop app later.

## The zero-dependency rule

The whole workspace depends on nothing but `std` / `core` / `alloc`. Vector maths, the random
number generator, the PNG writer and the scene parser are all written here. `Cargo.lock` must
list the workspace crates and nothing else; CI fails if any `[[package]]` has a `source =` line.
Do not add a dependency. If something is missing, write it.

## Layout

| Crate | Kind | Role |
|-------|------|------|
| `crates/rt-core` | library | The engine: `math`, `fmath` (deterministic `sin`, `exp2`, `log2`, `pow`...), `rng` (PCG32), `sampler` (Owen-scrambled Sobol), `warp`, `color` (tone curves), `image` (film with alpha), `png` (writer), `simd`, `geometry` (meshes, instances, BVHs, ray queries), `bsdf`, `light`, `ies` (L5: IES LM-63 photometric profiles, their lookup and flux), `environment`, `sky` (daylight), `bitmap` (images, 2-D sampling), `hdr` (Radiance RGBE reader and writer), `exr` (OpenEXR reader), `inflate` (zlib/DEFLATE decoder), `integrator` (the path tracer), `texture` (M2b: image textures, their mipmaps, the five projections and labels in the shading), `program` (M3b: the material programs of node materials, their interpreter, M3a's noise and what a program makes of a hit), `scene` (+ `scene::rsb`, the scene format), `render` (tiles), `example`. No OS APIs (`fs`, `net`, `time`, `thread` are forbidden). `unsafe` only in `simd`, every block with a `// SAFETY:` comment. |
| `crates/rt-cli` | binaries `rt`, `rt-bench` + library | Native front end: reads an `.rsb` file, renders progressively on all cores within the time budget, writes a PNG; `rt --sheet` renders the contact sheet; `rt-bench` measures ray throughput. Files, threads and timing live here. |
| `crates/rt-wasm` | `cdylib` + `rlib` | WebAssembly build with a hand-written C ABI (no `wasm-bindgen`): the renderer (`rt_*`) and the rigid body simulator (`phys_*`, `src/phys.rs`). Its `unsafe` is confined to `src/ffi.rs`. |
| `crates/rt-app` | binary `repackshot` + library | The desktop launcher (P2): serves the interface on 127.0.0.1 with a per-launch token, opens it in an Edge or Chromium app window, renders natively on every thread through `/api/render` (the same film as `rt`), stores AI models by SHA-256 and detects the hardware for the model recommendation. `std` only, `#![forbid(unsafe_code)]`. Its API contract (in Spanish) is [`crates/rt-app/README.md`](crates/rt-app/README.md). |
| `crates/rt-phys` | library | The rigid body simulator (S2): extended position based dynamics after Müller, Macklin, Chentanez, Jeschke and Kim (SCA 2020), fixed step 1/240 s with 4 substeps, gravity −Z, millimetres. Dynamic bodies are the convex hull of their points (own quickhull, coplanar faces merged; the oriented box when flat or over 128 vertices) or a ball when the points are on a sphere; static parts and the floor are triangles in a box tree. Contacts by the separating axis test with Gauss-map pruning and face clipping (spheres exact), friction per contact patch with anchors kept between steps, restitution, rolling resistance, sleeping. The `PHY1` scene format the interface writes (`src/io/phys.ts`). Same rules as `rt-core` (no OS APIs, `#![forbid(unsafe_code)]`, `f32`); contacts are sorted by (body, body, feature), so the pose hash does not depend on how the narrow phase is split. |
| `crates/rt-post` | library | The AI post-processing guard (AI-POST.md §3.2, §7.2) and all its pixel work: conditioning (edges from id and normal discontinuities, normalised depth), tiles of about 1024² with ≥ 128 px overlap and raised-cosine blending, padding to multiples of 16 and cropping back, the guard (shading transfer, frequency separation, regions by id with CIEDE2000), its checks and the step machine `plan` → `tile_input` / `conditioning` → `accept` (accepted, retry at a lower strength, rejected), with a `GuardReport`-shaped JSON report. Same rules as `rt-core` (no OS APIs, `#![forbid(unsafe_code)]`, `f32`, `fmath` only); `rt-core` does not know it exists. |
| `crates/rt-post-wasm` | `cdylib` + `rlib` | `rt-post` for the browser with a hand-written C ABI (`public/engine/post.wasm`, a module of its own so `rt.wasm` does not grow). Its `unsafe` is confined to `src/ffi.rs`; data crosses as little-endian bytes, so no pointer needs alignment. |
| `crates/rt-sky` | binary `rt-sky` + library | Offline, not shipped (E5c): the spectral simulator of the atmosphere (spherical shells of the U.S. Standard Atmosphere 1976, Rayleigh with the King factor, aerosols by Linke turbidity and Ångström, Cornette–Shanks phase, ozone, a Lambertian ground; single scattering by quadrature, multiple scattering by deterministic Monte Carlo; 34 bands → CIE XYZ → Rec. 709), the Levenberg–Marquardt fit of the physical sky and the table it writes (`rt-sky table`), the validation (`rt-sky validate`), the preview's fixture (`rt-sky fixture`). `std` and `f64`, reproducible: its own elementary functions (`dmath`), one random stream per work item, the same result with any number of threads. `#![forbid(unsafe_code)]`. |
| `tools/wasi-run.mjs` | script | Cargo runner that executes `wasm32-wasip1` test binaries under Node's WASI (see below). |
| `tools/wasm-parity.mjs` | script | Renders an RSB scene with the real `rt_wasm.wasm` in Node and checks its film hash against the native one. |

Scene units are millimetres, angles in files are degrees, the world is Z-up.

## Build and test

Everything is run from this directory (`engine/`). The toolchain is stable Rust, pinned by
`rust-toolchain.toml`.

```sh
cargo fmt --all -- --check                      # formatting
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace                          # unit and integration tests
cargo build --release -p rt-cli                 # target/release/rt
```

From the repository root, `npm run engine:test` runs the tests and `npm run engine:build` builds
the WebAssembly module twice (`tools/engine-build.mjs`): `public/engine/rt.wasm`, scalar, and
`public/engine/rt-simd.wasm`, built with `-C target-feature=+simd128` into its own target directory
(`target/simd128`); the browser takes the second when it validates simd128. The same script builds
the AI guard, `public/engine/post.wasm` (`rt-post-wasm`, scalar). All are git-ignored.

The guard's native/wasm parity: `cargo test -p rt-post` pins five scenarios (image hash, the hash
of what the model is given, the report JSON) in `../tests/fixtures/ai-guard.json`
(`REPACK_WRITE_FIXTURES=1 cargo test -p rt-post` rewrites it), and
`npx vitest run tests/ai-post-wasm.test.ts` from the repository root runs them through the real
`post.wasm` and must give the same bits (`REPACK_REQUIRE_POST_WASM=1` makes a missing module an
error instead of a skip).

The physical sky (E5c) is data made offline by `rt-sky`, so CI never runs the simulation:

```sh
cargo run --release -p rt-sky -- table      # simulate (about 10 min on 3 threads) and fit (about 12 min);
                                            # writes crates/rt-core/src/sky_table.rs,
                                            # ../src/core/sky-table.ts and crates/rt-sky/table.json
cargo run --release -p rt-sky -- validate   # low-noise skies between the knots, CIE, classic sky:
                                            # crates/rt-sky/validation.json (about 5 min)
cargo run --release -p rt-sky -- fixture    # ../tests/fixtures/sky-physical.json for the preview
```

The simulated skies are cached in `target/rt-sky/` (`--cache` names another file). Tests of
`rt-sky` check that the committed table matches its SHA-256 and that both generated sources and the
fixture are exactly what the generators write now; the same recipe gives the same table on any
machine and with any number of threads.

The `test` profile uses `opt-level = 1`: the BVH tests compare against a brute-force loop over
every triangle (tens of millions of triangle tests), which is ten times faster that way. Debug
assertions and overflow checks stay on.

The rt-core tests also run as WebAssembly, scalar and with `simd128`, under Node (CI does this):

```sh
rustup target add wasm32-wasip1
export CARGO_TARGET_WASM32_WASIP1_RUNNER="node $PWD/tools/wasi-run.mjs"
cargo test -p rt-core --release --target wasm32-wasip1
RUSTFLAGS="-C target-feature=+simd128" cargo test -p rt-core --release --target wasm32-wasip1
```

(Use `--release`: Node 22 itself crashes running the whole debug-build test binary, although
every test passes on its own. The same crash, a SIGSEGV in V8's garbage collector while it walks the
stack of a WASI `fd_write`, can take the release binary too, wherever the heap happens to reach its
limit at a write; the runner switches V8's fast API calls off (`--no-turbo-fast-api-calls`) for that
reason. The module has no preopened directories: a test that reads a file at run time fails here, so
fixtures are compiled in with `include_str!`.)

The simulator's native/wasm parity (S2): `cargo test -p rt-phys` pins the pose hash of the drop
scene at four steps (`PINNED_DROP` in `crates/rt-phys/tests/rigid.rs`) and writes the scene's
`PHY1` bytes and those hashes to `../tests/fixtures/phys-drop.json`
(`REPACK_WRITE_FIXTURES=1 cargo test -p rt-phys` rewrites it). The same tests run as WebAssembly
(`cargo test -p rt-phys --release --target wasm32-wasip1`, with the runner above) must pass with
the same pins, and `npx vitest run tests/physics-engine.test.ts` from the repository root runs the
fixture through the real `rt.wasm`'s `phys_*` exports and must give the same hashes
(`REPACK_REQUIRE_RT_WASM=1` makes a missing module an error instead of a skip).

## The desktop application

```sh
cargo run --release -p rt-app -- --app-dir ../dist          # serve ../dist and open the app window
cargo run --release -p rt-app -- --serve-only --app-dir ../dist   # no window: prints the URL with its token
cargo run --release -p rt-app -- --hardware hw.ini            # what the installer reads (UTF-16 INI)
```

From the repository root, `npm run release` builds `repackshot` for `x86_64-pc-windows-gnu`
(mingw-w64; `build.rs` embeds the icon and the version) and `x86_64-unknown-linux-musl` (static),
and packages the two portables and the NSIS installer (`packaging/release.mjs`);
`node packaging/smoke.mjs <repackshot[.exe]>` checks a build (under Wine for the `.exe`): the
interface, the token, and the example rendered through `/api/render` to the pinned hash.

## Render something

```sh
cargo run --release -p rt-cli -- --example -o out.png        # built-in scene, no input file
cargo run --release -p rt-cli -- --write-example scene.rsb   # the same scene as an RSB file
cargo run --release -p rt-cli -- --write-e5-example e5.rsb   # the E5 parity scene (glass, HDRI, background image)
cargo run --release -p rt-cli -- --write-e5b-example e5b.rsb # the E5b-1 parity scene (the E5 scene with caustic photons)
cargo run --release -p rt-cli -- --write-m2b-example m2b.rsb # the M2b texture scene (every projection, normal maps, a cut-out, labels)
cargo run --release -p rt-cli -- --write-m3b-example m3b.rsb # the M3b scene of material programs (noise, a bump, curvature, a cut-out, emission)
cargo run --release -p rt-cli -- --write-film-thumb t.rsb    # the film plugin's recipe-card scene (bottle beside the lit lamp, 320x200)
cargo run --release -p rt-cli -- scene.rsb -o out.png --samples 16 --denoise --keep-noisy   # out.png denoised, out-noisy.png
cargo run --release -p rt-cli -- scene.rsb -o out.png --caustics 16384 --caustic-radius 3   # photon-map caustics
cargo run --release -p rt-cli -- --write-studio-hdri studio.hdr   # the procedural studio HDRI (tests/fixtures/studio.hdr)
cargo run --release -p rt-cli -- --tone-table > tones.json   # the tone curves' reference values
cargo run --release -p rt-cli -- scene.rsb -o out.png --samples 64 --threads 4 --size 1280x720
cargo run --release -p rt-cli -- scene.rsb -o out.png --samples 4096 --max-seconds 30
cargo run --release -p rt-cli -- scene.rsb -o out.tif --bits 16   # TIFF: 8 (default), 16 (sRGB) or 32 (float, linear light)
cargo run --release -p rt-cli -- scene.rsb -o out.dng              # a linear raw DNG: opens in a photo developer like a camera raw
cargo run --release -p rt-cli -- --sheet ../out/sheet          # the contact sheet (below)
cargo run --release -p rt-cli -- scene.rsb -o out.png --samples 1024 --noise 1   # adaptive, until every block is below 1 % noise
cargo run --release -p rt-cli -- --write-e10-example e10.rsb # the E10 parity scene (the E5b-1 scene sampled adaptively)
cargo run --release -p rt-cli -- --write-l5-example l5.rsb   # the L5 parity scene (the example lit by two IES lights)
cargo run --release -p rt-cli -- --adaptive-noise ../out/noise --size 480x360 --max-seconds 20 --samples 4096 --rounds 3
```

`--format png|tiff|dng` chooses the file; without it the extension of `-o` does (`.tif`, `.tiff`, `.dng`; anything else is a PNG).
A PNG is 8-bit; a TIFF is uncompressed RGB (`--bits 8`, the default, `16`, or `32`: floats in linear light with the exposure
applied and no tone curve, like an EXR); a DNG is always 32-bit float. They are written by `rt_core::tiff` and `rt_core::dng`
(std only, from the TIFF 6.0 and DNG 1.4 specifications); the interface writes the same bytes, and `tests/fixtures/tiff/` holds
the files both sides are compared with (`REPACK_WRITE_GOLDEN=1 cargo test -p rt-cli --test tiff_golden` rewrites them).

The CLI prints the scene and image size, the SIMD path and BVH width in use, the samples
rendered, the number of rays (camera, bounce and shadow rays) and rays per second.

Rendering is **progressive**: every tile has its own film, and passes of 1, 2, 4 ... 16 sample
indices go over all tiles. The time budget (`--max-seconds`, else the scene's
`RNDR.max_seconds`; 0 is no limit) is checked between passes, so every pixel always has the same
number of samples and at least one pass is rendered. A tile's samples are always added in index
order, so the film does not depend on the thread count or the pass sizes. With adaptive
sampling (E10, below) the budget is checked between passes too, but the samples of a pixel
depend on its block's noise.

**Contact sheet.** `rt --sheet <dir>` renders the example part under six built-in light recipes
(key only, three point, split, backlit panel visible to the camera, overhead, sun; defined in
`crates/rt-cli/src/sheet.rs`, normalised to 2.5 W/m² on the part) at 480x360 and 64 spp, and
writes one PNG per recipe, `index.html` (a grid with the mean luma, the clipped-white and the
crushed-black fractions of every image) and `stats.json`. These recipes are engine fixtures; the
16 x 12 sheet over the catalogue comes in E4 with the TypeScript RSB writer. `out/` is
git-ignored.

After the recipes the sheet renders the E5 scenes of `crates/rt-cli/src/scenes.rs` (`e5-*.png`, at
a multiple of the samples): a glass bottle with absorption and a brushed gold cap in front of a
camera-visible panel (the bright field of BACKLIT), a board of car paint, brushed aluminium,
chrome, frosted and blue glass under the studio HDRI, an emissive filament in a thin glass bulb,
the catalogue's three SKY setups (SUN, GOLDEN_HOUR, DAWN: their sun light over the daylight sky)
and chrome and plastic lit by the studio HDRI alone. The studio HDRI is procedural (soft boxes and
a strip on a cyclorama, written by `scenes::studio_hdri`); `--write-studio-hdri` writes it as the
`.hdr` fixture the readers are tested with.

## The path tracer (E3)

Unidirectional path tracing with next-event estimation and multiple importance sampling
(`integrator`). At every surface: add what it emits, sample **one** light and trace a shadow
ray, sample the BSDF for the next direction. Emitters found by BSDF-sampled rays are weighted
against light sampling with the power heuristic (and light samples against the BSDF), so nothing
is counted twice. Russian roulette from the third vertex on (survival `max(throughput)`,
clamped to `[0.05, 1]`); `RNDR.max_depth` surface interactions at most (default 8; 1 is direct
lighting only); `RNDR.clamp_indirect` caps every contribution of light that bounced at least
twice (0: off).

* **Sampler** (`sampler`): the Sobol sequence with the Joe and Kuo `new-joe-kuo-6.21201`
  direction numbers (first 64 dimensions, table in the module, licence below), each dimension of
  each pixel Owen-scrambled with Burley's (2020) hash, seeded by (scene seed, pixel x, y); the
  sample index is the position in the sequence. Logical dimensions: camera 2, lens 2, then per
  vertex light selection 1, light point 2, BSDF 2, roulette 1. The 2-D slots are mapped to the
  pairs of Sobol dimensions with the best 2-D projections (t <= 2 at 64 to 4096 points, chosen by
  a greedy search and re-checked in a test); vertices beyond the tenth use hashed random numbers.
* **Camera**: thin lens (focal length, sensor width on the longer side, f-number, focus
  distance; the lens point from the concentric disk map) or orthographic. Box pixel filter (a
  Gaussian or Blackman-Harris filter can replace it by weighting splats).
* **Materials** (`bsdf`), `MATL.kind`: **0 principled**: Lambert diffuse weighted by
  `(1 - E_s(μo))(1 - E_s(μi)) / (1 - E_s,avg)` (E9a, Kulla and Conty 2017: `E_s` the albedo of
  the specular layer above it; jointly normalised with the coat's under a coat), GGX specular with height-correlated Smith masking (Heitz 2014),
  sampled by its visible normals (Heitz 2018), `α = roughness²`, Schlick Fresnel with
  `F0 = ((ior - 1)/(ior + 1))²` for the dielectric and `base_color` for the metal, blended by
  `metallic`, `F90 = min(1, 50 F0)` (Lagarde and de Rousiers 2014: an `ior` of 1 has no
  specular lobe); a clear coat as a second GGX lobe (ior 1.5) weighted by `coat`, the layers
  below attenuated by what it reflects. Since E5 the `transmission` share of the dielectric is
  **clear**: rough or smooth GGX reflection and refraction (Walter et al. 2007) with the exact
  dielectric Fresnel, total internal reflection and the `1/η²` of radiance transport; tinted by
  `√base_color` per crossing, or by Beer–Lambert absorption inside a solid when `absorption_mm`
  is set (`σ = -ln(base_color) / absorption_mm`: white light keeps `base_color` after that many
  millimetres). A **thin wall** (`MATL.flags` bit 1) reflects `2R / (1 + R)` and lets the rest
  straight through, unrefracted. `anisotropy` stretches the GGX lobes (`αx = α / s`, `αy = α s`,
  `s = √(1 - 0.9 a)`, Burley 2012) along tangents around the instance's local Z axis. `opacity`
  below one is a stochastic cut-out. **1 glass**: the principled surface without metal (what the
  interface's GLASS family writes). **2 emissive**: radiance `emission * emission_power`,
  reflects nothing; with `MATL.flags` bit 0 it is also sampled as an area light, chosen among
  the lights per shading point (below) and inside the instance by triangle area. The interface writes `emission_power = emitPower · EMIT_RADIANCE_PER_WATT` (0.06,
  `src/core/photometry.ts`, the factor the preview has used since U1: the catalogue's watts are
  a level, not a flux) and `emission` the black body's colour at its temperature (normalised to
  its largest channel) or the colour given (`emitKind`). **Energy compensation** (E9a,
  `bsdf::energy`): single-scattering GGX loses the light that bounces between microfacets (a white
  metal at roughness 1 reflected 0.356 in a furnace); the specular lobe and the coat get Kulla and
  Conty's extra lobe `F_ms (1 - E(μo))(1 - E(μi)) / (π (1 - E_avg))`, cosine-sampled, and the
  clear part is divided by its own power albedo (Turquin 2019), from our own Monte Carlo tables
  (`bsdf/energy_table.rs`, 32 × 32 nodes, regenerated bit for bit by a test). White metal, glass
  and plastic, bare or coated, come out white within 1 % in a furnace at any roughness;
  roughness 0 keeps every bit except the plastic's diffuse, which no longer loses `F_avg`.
* **Scattering media** (E9b, `integrator::medium`): a clear solid with `MATL.scatter_mm` is
  filled with a homogeneous medium (mean free path `scatter_mm`, single-scattering albedo
  `scatter_color`, Henyey–Greenstein `scatter_g`, plus the absorption of `absorption_mm`). The
  path takes a random walk inside (Chiang, Kutz and Burley 2016): hero-channel distance sampling
  with spectral MIS over the three channels, Russian roulette after 32 events on the walk's own
  weight (what it lost since it entered), no light sampled inside. At the boundary the Fresnel of
  leaving reflects the walk back in (total internal reflection included) or lets it out through
  an exit vertex: a Lambertian transmission lobe of albedo `η²` where the integrator samples a
  light with MIS and continues by the cosine. At most 1024 steps per path, after which the walk
  goes straight out keeping all but absorption. Its random numbers are hashed dimensions beyond
  the Sobol table, so scenes without media keep every bit. A medium is a receiver for the photon
  map; its exit vertices gather the photons on the outside of its surface. **Thin walls** (an
  approximation): a shadow ray from an exit vertex, and only from one, crosses smooth clear glass
  where light refracting through it would leave within 5 mm by a face within 15° of the first,
  as if the refractions cancelled (the Fresnel transmittances in and out and the absorption over
  that path; 2.0 % darker than the exact path under a 3 mm plate), and the exit
  vertex's BSDF samples through such a wall count as straight events for MIS: a liquid in a glass
  bottle sees the lights through the bottle's side.
* **Dispersion** (E9c, `integrator::dispersion`): a clear solid without a medium and with
  `MATL.abbe > 0` refracts each wavelength with its own index, Cauchy's `A + B / λ²` through `ior`
  at the helium d line (587.6 nm) and the Abbe number `(n_d - 1) / (n_F - n_C)`. Each channel is
  a band of wavelengths (red 580–700, green 490–580, blue 400–490 nm); at its first dispersive
  surface a path picks a channel (probability ⅓) and a wavelength uniformly in its band from one
  hashed dimension of its own (`sampler::DIM_DISPERSION`), carries that channel alone times 3
  from then on and refracts at that wavelength at every dispersive surface; photons do the same
  with their own generator. Paths that meet no dispersive glass stay white, so scenes without
  one keep every bit. `PINNED_E9_MEDIA_4SPP` (`0x5b5ea281` since E9 and E12 met, `rt --write-e9-example`: the E5
  scene with a medium in its big sphere and a crystal sphere of Abbe number 40) holds on every
  SIMD path, in WASI, through the real module and with 1, 4 and 16 threads.
* **Dielectrics in the integrator** (E5): a path keeps track of the solid it is in (the hit side
  of a closed mesh) and attenuates by Beer–Lambert along each segment inside. Thin walls and
  cut-outs are *passable*: their straight-through events keep the last vertex's BSDF density and
  add their distance, so an emitter or the environment found through them is still weighted
  against light sampling with the right MIS weight, and shadow rays go through them (at most 32
  crossings, tinted by what they let through). A solid clear part still blocks shadow rays: the
  light through it comes by the caustics (E5b-1, below), or by BSDF sampling alone without them.
* **Lights** (`light`), `LGHT.kind`: **0 rect**, **1 disk**: one-sided, transparent, uniform
  area sampling; `power` is the flux in watts (radiance `color * power / (π area_m²)`, a scene
  millimetre being 1e-3 m); `spread_deg` adds a `cos^n` falloff whose intensity halves at
  `spread_deg / 2` (180: none; the on-axis radiance does not change). **2 sun**: a disc of
  `angle_deg` sampled in its cone, `power` the irradiance in W/m² on a surface facing it (0
  degrees: a delta direction). **3 point** (L4): a sphere of diameter `size_x` and uniform
  radiance `I / (π r²)` with `I = power / 4π` W/sr (`power` the isotropic flux), sampled
  uniformly in the cone of directions it fills; of no size, or too small to tell from a point
  at that distance, a delta position (`I / d²`). **4 spot** (L4): the point light it would be,
  masked by the direction from its centre: 1 inside the inner cone, a smoothstep to 0 at the
  edge of its cone of `spread_deg` (the soft edge `angle_deg` wide). `flags` bit 0 **glossy**:
  seen by BSDF-sampled rays and lighting every lobe (with MIS); without it the light lights only
  the diffuse lobe, by light sampling alone, and is invisible in reflections (Blender's "glossy"
  visibility, which the recipes come from). Bit 1 **camera**: visible to camera rays (a point's
  sphere too). Bit 2 **no shadow** (L4): its shadow rays are not traced (the shadow catcher is
  not darkened by it either). **One light per vertex, chosen per point** (E12): in proportion to a
  bound of the irradiance each light can give the shading point unoccluded, the flat case of the
  light tree of Conty Estevez and Kulla (HPG 2018) with its orientation bound (§4.3): `lum(I) ·
  mask / max(d², r²)` for points and spots, `lum(L) · A · cos θ' / max(d², A)` for panels and
  (from the centroid, with the cone of their normals) emissive meshes, `lum(E)` for the sun, `π L̄`
  for the environment. A `Selection` holds the vertex, the sum of the weights and the first eight
  of them, and the pick rebuilds the cumulative distribution entry by entry; MIS takes the same
  probability at the vertex the BSDF ray left (`Scattered`). From two to 64 entries (one is
  certain either way and by flux costs nothing); beyond 64, and
  always for the shadow catcher and the caustic photons, the static choice by the flux each light
  sends into the scene's bounding sphere (a spot weighing as its point light when its cone takes
  in the scene's centre).
* **Environment** (`environment`), `ENVR.kind`: **0 studio dome**: radiance linear in the `z`
  of the direction, `floor` at -1, `horizon` at 0, `zenith` at +1, importance sampled by the
  closed-form inverse of that piecewise-linear density in `z` times a uniform azimuth (exact
  pdf). **1 flat**: `horizon` everywhere. **2 sky** (`sky`), for `sky_turbidity` and the sun at
  `sun_azimuth_deg` / `sun_elevation_deg`, in the model `sky_model` (E5c): **0 physical** (the
  default): the functional form of L. Hošek and A. Wilkie (ACM TOG 31(4), 2012), nine
  coefficients and a radiance per Rec. 709 channel as quintic Béziers over `(elevation / 90°)^(1/3)`,
  blended linearly between integer turbidities 1–10 and ground albedos 0 and 1 (albedo 0.2), with
  our own coefficients (`sky_table.rs`, fitted by `rt-sky` to our own atmosphere simulation; sun
  0–90 degrees); **1 classic**: A. J. Preetham, P. Shirley and B. Smits, "A Practical Analytic
  Model for Daylight" (SIGGRAPH 1999), the Perez distribution with the paper's coefficients (sun
  clamped to 1–90 degrees, turbidity to 1.7–10), the sky of E5. Either is scaled so that a
  horizontal surface gets the irradiance of the dome of the same values (`2π (horizon / 6 +
  zenith / 3)`), with a neutral ground of `floor` below the horizon; tabulated into a 256 x 128
  panorama. The sun disc
  is the scene's sun light. **3 HDRI** (E5): an equirectangular bitmap (`hdri_map`), `u = ½ +
  atan2(-y, x) / 2π`, `v = acos(z) / π` from the top (three.js's layout, so the preview shows the
  same), bilinear, turned by `rotation_deg` counter-clockwise about Z; sampled through a 2-D
  piecewise-constant distribution (marginal and conditional CDFs) over luminance times `sin θ`
  on at most 512 x 256 cells, with the exact density per steradian for MIS; the dome when the
  bitmap is missing. All scaled by `strength`. `background_mode`: **0** the environment is
  visible to camera rays, **1** they see `background_color`, **2** transparent (black, alpha 0 in
  the film's `alpha` channel), **3** background image (E5): `backplate_map`, seen by camera rays
  only (also through thin walls and cut-outs; rays refracted by a solid or reflected see the
  environment), placed in the output frame `backplate_rect` by
  `backplate_fit` (0 fill, 1 fit with `background_color` around it, 2 stretch). The environment
  lights the scene in every mode. The background image goes through the exposure and the tone
  curve like the rest of the film.
* **Images** (`bitmap`, `hdr`, `exr`, `inflate`; `BMAP` sections): raw 8-bit sRGB RGB / RGBA,
  linear `f32` RGB, or whole files: Radiance `.hdr` (RGBE `m · 2^(e - 136)`, flat, old and new
  run-length scanlines, rows top down or bottom up; G. Ward, "Real Pixels", Graphics Gems II,
  1991) and OpenEXR (scanline files, `NONE`, `RLE`, `ZIPS` and `ZIP` compression with the
  predictor and the byte interleave, half, float and uint channels; `R`, `G`, `B` or `Y`; the
  layout of the published OpenEXR file format documentation). DEFLATE and zlib (RFC 1950, 1951)
  are decoded here; PIZ, PXR24, B44, DWA and tiled or deep files are refused with a message.
  A linear image wider than 4096 pixels is halved (2 x 2 boxes) until it fits when it is loaded.
* **Floor** (new `FLOR` section): `mode` **0** none, **1** an infinite Lambertian plane at `z`
  of albedo `color`, **2** shadow catcher: only camera rays see it, as the background darkened by
  the fraction of the light reaching it that the scene blocks (next-event estimation and one BSDF
  ray, with and without occlusion); with a transparent background that fraction becomes alpha
  over black, so a composite keeps the contact shadow.
* **Coarse smooth meshes**: rays leave from the hit point lifted onto the surface the vertex
  normals describe (Hanika, "Hacking the Shadow Terminator", 2021), which keeps shadow
  terminators smooth; the shading normal is kept on the geometric side and falls back to the
  geometric normal where it would face away from the viewer.
* **Ambient particles** (S4a, S4b; `FXAM` sections, `rt-sim`, `geometry::particles`): spheres,
  discs and capsules evaluated from the effect's parameters when the scene loads, with a flat BVH
  per effect walked after the instance BVH and, for the camera rays of a pinhole or thin-lens
  camera, a screen grid of 4-pixel cells (each ray tests the particles whose box, widened and grown
  by the circle of confusion, projects onto its cell: the BVH's nearest hit, bit for bit). Small
  clear particles (rain, bubbles) are crossed straight, with a thin wall's transmittance, by
  shadow rays and by the rays of a path that already scattered off a broad lobe (no caustics of
  drops); the camera, and paths of narrow lobes from it, still see them refract. Dust, pollen and
  a dust cloud get a Henyey–Greenstein forward lobe (`bsdf::forward`, a share of the particle's
  BSDF, in the MIS of next-event estimation), so a light behind them lights them up.
* **Tone curves** (`color`, `Film::to_srgb8_tonemapped`), `RNDR.tonemap`: **0** linear, **1** ACES
  (Narkowicz fit), **2** filmic (Blender-like: the 16.5-stop log2 shaper of Sobotka's Filmic and
  the published polynomial fit of the AgX base contrast, per channel), **3** AgX (Sobotka's
  inset, the same shaper and curve, the inverse inset, default look), **4** standard (sRGB,
  clipped). Exposure multiplies by `2^ev` before the curve.

All of it uses `fmath` instead of `std`'s `sin`, `powf`, `exp2`...: those call the platform's
maths library, which differs between glibc, musl and the WebAssembly `libm`. `fmath` is built from
IEEE `+ - * /` and `sqrt` only, so a scene renders to the same bits everywhere.

## Variance, denoise and caustics (E5b-1)

**Film.** Besides the premultiplied radiance, the sample count and the coverage, `Film` sums the
square of each sample's luminance (`Film::lum2`, `f32`, in sample order); it never changes the
other three, so no image hash moved. With the mean it gives each pixel's sample variance,
`(E[l²] - E[l]²) / (n - 1)` for the mean of `n` samples. The page's pool sums it with the same rule
(`src/render/tiles.ts`, `Accumulator.lum2`).

**Denoise** (`rt_post::denoise`). The edge-avoiding à-trous wavelet transform of H. Dammertz, D.
Sewtz, J. Hanika and H. P. A. Lensch (HPG 2010): the B3-spline kernel `(1, 4, 6, 4, 1) / 16`, five
passes with taps 1, 2, 4, 8 and 16 pixels apart, each tap weighted by edge-stopping functions; the
variance-guided luminance stopping function of C. Schied et al., "Spatiotemporal Variance-Guided
Filtering" (HPG 2017): `exp(-|l_p - l_q| / (σ_l √g(Var_p)))` with the variance blurred by a 3 x 3
Gaussian and carried as `Σ w² Var / (Σ w)²`, normal weight `max(0, n_p·n_q)^128`, depth weight
`exp(-|z_p - z_q| / (σ_z |∇z · Δ|))`, σ_l = 4, σ_z = 1, the albedo divided out and multiplied
back, and the 7 x 7 spatial variance estimate below four samples. Ours: the variance from the film,
the exact passes of X2 as guides (`GUIDE_PASSES`: albedo, normal, depth, part and material ids),
a weight of zero between two parts or two materials (it never blends parts) and the background
(id 0) left as it is, a firefly clamp before filtering (a pixel more than four times brighter
than every neighbour on its surface is brought down to that), and `(1 - x/16)^16` for the
exponentials. `f32` only, a fixed order: the same bits natively and in WebAssembly. RGBA sums in,
RGBA sums out (coverage as it was). `denoise_rows` computes a band of rows from the rows and
`HALO` = 72 rows around them, exactly those rows of the whole image: `rt`, the launcher and the
page cut the work in bands (of at least 192 rows) on their threads or workers.
`PINNED_DENOISED_EXAMPLE_4SPP` (`crates/rt-post/src/denoise/tests.rs`, `0x2a430f92` since E9 and E12 met) is the
example at 4 spp denoised; `tools/wasm-parity.mjs --expect-denoised` checks the real module
against it. On the sheet's scenes the relative MSE against a long render falls to 4–20 % of the
noisy image's at 4 spp and to 10–40 % at 16 spp (`rt-cli/tests/example.rs` checks the bound).

**Caustics** (`rt_core::caustics`). Stochastic progressive photon mapping (T. Hachisuka and H. W.
Jensen, SIGGRAPH Asia 2009) in the probabilistic form of C. Knaus and M. Zwicker (ACM TOG 30(3),
2011): every sample index is a pass with its own photons (`RNDR.caustic_photons` of them) and its
own visible points, estimated with the radius `r_i² = r_1² Π_{k=1..i} (k + α) / (k + 1)`,
`α = 2/3`, `r_1` = `RNDR.caustic_radius` pixels at the camera's target distance (default 3).
Averaging the passes, which the film does with its samples, converges like SPPM with no state per
pixel. **The split**: a *caster* is glass or metal whose sharper lobe is at most 0.25 rough
(`is_caster`; brushed metal counts along its brush), every other scattering surface is a
receiver, and a straight event (a cut-out passed, a thin wall's straight transmission) is no
event. The photon map carries exactly the light of the segments `L C+ R` (photons from glossy
area lights and suns and from emissive meshes, never the environment nor the point lights and
spots of L4, whose caustics stay with the path tracer; they cross casters only
and are stored on the first receiver they reach), gathered at every receiver of the camera path
(the first one, and any later one as indirect light); the path tracer leaves out exactly that
light (after any receiver, light of a photon light that arrives through casters only:
BSDF-sampled hits and next-event estimation at a caster). Left to the path tracer, a caustic
seen through a diffuse bounce came in rare, very bright samples (sparkles that 1024 samples did
not smooth); a test with a light inside a glass ball checks that with an empty map every
receiver is black.
`caustics/tests.rs` checks the floor flux of a glass sphere against an exact f64 sphere (0.2 %),
flux through a glass block (no 1/η² for particles), the kernel, the radius schedule, the split
against the path tracer alone in a glass sphere's shadow (within 8 %), under a polished metal
sphere, on a floor lit by a wall's caustic and with a point light beside the map, and the shadow
catcher against a real white floor. Photons are aimed at the casters' bounding spheres with the density of
the whole mixture, refract with flux and Veach's shading-normal correction, and draw a PCG
stream per (seed, sample, photon): a map is the same bits however its photons are split
(`PhotonMap::trace_range`), so `rt` and the launcher trace each sample's map in photon ranges on
all their threads and every web worker traces the maps of the samples it renders (keeping 16).
The shadow catcher (the interface's floor) gets the caustics too: photons land on its plane, and a
camera ray that sees it adds their light relative to the open floor's to the background it shows
(not with a transparent background). `PINNED_E5B_CAUSTICS_4SPP` (`0x7135df4b` since E9 and E12 met, the E5 scene with
2048 photons per sample, `rt --write-e5b-example`) holds on every SIMD path, in WASI, through
the real module and through the launcher with 1, 4 and 16 threads.

The sheet adds the E5b-1 pairs: a glass sphere and the perfume bottle under a small light without
and with caustics, the bottle's caustics at the Final preset's samples without and with denoise,
and two scenes at 4 spp without and with denoise.

## Adaptive sampling (E10)

`rt_core::adaptive`, with `RNDR.adaptive` bit 0 (the section grows to 72 bytes only when it is
set or `noise_threshold` is; without them it is E11's byte for byte, and no pinned hash moved).
The host renders in **rounds**. The first gives `WARMUP` = 16 samples to every pixel with the tile
renderer of always (sample index = photon-map iteration; the exact passes and the albedo are
made there only). At the end of every round, whatever the threads and tiles that rendered it,
the whole image decides the next (`decide`): each pixel's relative error of the mean,
`sqrt((E[l²] - E[l]²) / (n - 1)) / (max(mean, 0) + ε)` from the film's sums and `Film::lum2`,
with `ε` 1 % of the screen's white at the scene's exposure; smoothed by a 3 x 3 box inside the
image; the largest of every 8 x 8 block; the blocks above the noise target
(`RNDR.noise_threshold`; without it, any) and below the sample cap are the candidates, and the
round goes to those at or above the median of their errors (the threshold of the moment, falling
as the image converges). No candidate left: converged. A round is 16 samples times
`clamp(blocks / (4 active), 1, 16)`, never more than the least sampled active block has. A block
left out keeps its samples and its mean: every pixel is the mean of its own samples `0..n`, in
order (a test compares it bit for bit with the uniform image of those samples). The decision is
`f32` in a fixed order and only happens at the ends of rounds, so the image is the same with any
thread count, any tile size and any cut of a round into passes. In a pass every active block is
at the same point of its round, so the `j`-th sample of the pass uses the photon map
`iteration + done + j` (`Adaptive::iteration`): a pass traces as many maps as without adaptive
sampling and two samples of a pixel never share one.

`rt` (`render_adaptive`, `--adaptive`, `--noise P` in per cent, which implies it) gathers the
tiles' films at the end of every round and, after the first, shares the active blocks of all
tiles among its threads one by one (`Film::cut`, `render::render_block`, `copy_region`: the same
bits as rendering in the tile). It prints the fewest and the most samples of a pixel and the
rounds. The denoiser takes each pixel's count (`DenoiseInput::with_counts`: sums and `lum2`
rescaled to the most samples, the variance divided by the pixel's own `n − 1`). The launcher does
the same, publishes the sums rescaled to the most samples (`adaptive::rescale`) and puts the
counts, the noise of the noisiest block and the seconds it expects to the target in its frame
(68-byte header, `FLAG_ADAPTIVE`). The module exports `rt_render_block_rgba` (a block of a tile
at a sample index and a photon-map iteration) and `rt_adaptive_decide` (the engine's decision, for
`tools/wasm-parity.mjs --adaptive`); `rt_denoise` accepts the plane of counts as a fifteenth
word. `PINNED_E10_ADAPTIVE` (`crates/rt-core/src/adaptive/tests.rs`, `0x264b4106`, 16 to 48 spp)
is the E10 scene (`rt --write-e10-example`: the E5b scene with a 3 % target, 48 samples and edges
x2) by `rt` with 1, 4 and 16 threads, tiles of 32, 24 and 13 and passes of 16, 5 and 3, by the
launcher, in WASI, through the real module (scalar and SIMD) and through the page's own code;
`PINNED_E10_DECISIONS` (`0xb492454a`) pins six decisions on a synthetic image, which the page's
port (`src/render/adaptive.ts`) reproduces.

`rt --adaptive-noise <dir>` measures the criterion on the E5b-1 sheet's key-only recipe and the
glass bottle: two uniform references of other seeds (kept in `<dir>` and reused; half their
relative error against each other is each one's own, taken off the table), then per round a
uniform render for `--max-seconds`, an adaptive one for the same time and an adaptive one until
it has cast as many rays as the uniform one; `noise.json` and a table of relMSE (E5b-1's: values
clamped at 8, `(x − r)² / (r² + 0.01)`). The numbers measured are in `docs/ROADMAP.md`, E10.

## Section view (Q1)

A plane that removes one side of the model and caps the cut (`crates/rt-core/src/geometry/section.rs`
and `solid.rs`; the format in `rsb.rs`, the page's side in `src/core/section.ts`). The scene's
`SECT` is `normal · p = distance` (mm, Z up) with the normal pointing to what is **removed**; the
kept side is `normal · p <= distance`. It lives **inside `Geometry`**
(`Geometry::set_section`, called by the RSB reader and by `Scene::build_particles`), so every
query sees the same model (camera, reflection, refraction and shadow rays, photons, picking, the
passes, the batches) without a change in the SIMD kernels or the integrator:

* A ray is clipped to the interval on the kept side (a half-space meets a ray in one interval; `t`
  is the same in the world and in a mesh's space), so geometry on the removed side is never hit
  and never blocks a shadow ray. A scene without a section takes exactly the code it took before:
  the pinned hashes did not move, and a plane that cuts nothing changes no pixel.
* The cut is **capped** where it goes through the inside of a **closed solid**. A ray that crosses
  the plane has been outside every surface it did not hit, so the crossing is inside a solid when
  the next surface the ray meets is met from behind (`Solid::inside_before`, by the winding of the
  triangle under the instance's transform). A ray that enters the kept side needs no extra work;
  one that leaves it without a hit looks past the plane. The hit is flat, on the plane, with the
  plane's normal facing the ray and `triangle = CAP_TRIANGLE` (`u32::MAX`): the material's plain
  colour (no texture, pattern, program or bevel), and light interacts with it like with any
  surface: a cut glass solid refracts through its cap like a glass solid that ended there.
* A mesh is a **solid** (`geometry::solid`, once per mesh) when, after welding the vertices that
  share a position (exactly, then within `1e-5` of the extent), every edge of the triangles that
  have an area is shared by exactly two of them running in opposite directions; the signed volume
  tells `Outward` from `Inward`. Open meshes show their inside; a material that is a thin wall and
  a part with a material per face are not capped (the caller says so).
* An instance with `INSTANCE_NO_SECTION` is the **studio** (the page flags a set's backdrop, floor
  and cards while a plane cuts): never removed, never capped. A ray finds it on the removed side
  too by walking that part of its range surface by surface, past the cut model, inside the box of
  each exempt instance (at most 48 surfaces).
* Limits: a ray with a finite `t_max` that enters the kept side inside a solid and ends before
  leaving it finds no cap, and an emissive mesh sampled as a light still lights from its removed
  part.

`rt --write-q1-example <scene.rsb>` writes the E5 scene (glass sphere, lacquered floor, metal sphere,
thin glass card, cut-out card) cut by `x = 0` with the cap on and the floor as studio.
`PINNED_Q1_SECTION_4SPP` (`crates/rt-core/src/render/section_tests.rs`, `0x7a4182ea`) is its image
at 4 spp on scalar, SSE2 and AVX2, through an RSB round trip; `rt-cli/tests/example.rs` checks it
with 1, 4 and 16 threads, and CI checks it through the real module (scalar, `--passes` and
`simd128`) and in WASI like the others. The scene without its plane is the E5 scene bit for bit
(`PINNED_E5_HDRI_4SPP` has not moved). Measured at 640 x 480, 32 samples, 4 threads: the cut scene
5.0 Mrays/s against 4.7 for the E5 scene without a plane.

## IES lights (L5)

`rt_core::ies` reads the IES LM-63 text format (the editions of 1995 and 2002, and 1991's without
a version line): the `[KEYWORD]` header (`[MORE]` continues the line before), `TILT=NONE`, the
thirteen numbers, the angles and the candela, separated by spaces, tabs, commas or line breaks of
any style. **Type C photometry only**, with vertical angles 0–90, 0–180 or 90–180 and horizontal
angles one, 0–90, 0–180, 90–270 or 0–360 (the symmetries: round, four quadrants, bilateral about
C0–C180 or C90–C270, full); **type B and type A are refused** with their own message (converting
them is a resampling of the sphere that nothing needs: every luminaire can be published in type
C), and so are `TILT=INCLUDE` and `TILT=<file>`. The reader is strict, and its refusals say what
is wrong with the numbers of the file: counts that do not match the values present (fewer: cut
short; more: wrong counts), angles that do not increase, negative or non-finite candela, a table
of zeros, more than 2 MiB. Lumens, lamp counts, ballast factors, input watts and the size of the
luminous opening are read and not used: the file is a *shape*. No profile of any manufacturer is
shipped; the two of the tests (`tests/fixtures/ies/`) were typed by hand and everybody brings
their own.

`IesProfile::intensity(γ, φ)` interpolates the candela **bilinearly** in the vertical angle γ
(0° along the light's axis) and the horizontal angle φ, on the file's own, possibly uneven, angles,
after reducing φ to the stored range by the symmetry; outside the vertical range it is 0. In the
light's frame (`intensity_dir`) `+z` is the axis, φ = 0 lies along `+y` (the light's `up`) and φ
grows from `+y` towards `+x`, counter-clockwise looking along the axis from behind. γ and φ come
from `atan2` of `fmath` (not `acos`, which loses its precision near the axis). `flux()` is the
integral of that very function over the sphere in closed form per cell (the trapezoid is exact
in φ, where the function is linear; the integral of `sin γ` times a linear function of γ has
a primitive): 4π c for an isotropic profile, a sixth of 4π · 1000 for the hand-written
1000 cos² (to 0.5 % with its 10° steps, to 5e-5 with 1° steps), and the integral of the
interpolant to 1.5e-3 against a midpoint quadrature of `intensity`. `efficiency()` is
`flux / (4π · peak)`.

`LightKind::Ies` (`LGHT` kind 5, `Light::ies`) is the point light or small sphere of `power`
watts masked by the profile: `mask(x) = intensity(direction from the centre to x, in the light's
frame) / peak`, in `[0, 1]`, through the same code as a spot's mask (sampling over the cone the
sphere fills, a delta position for a point, MIS with BSDF rays when glossy, the mask also for
camera rays and reflections). The profile gives the shape and `power` the level: the light is as
bright in the profile's brightest direction as the point light of `power` watts (`power / 4π`
W/sr), so profiles written for 500 and for 5000 lumens give the same image, and a spot can be
swapped for an IES light without moving the exposure. Light selection (E12, `rt_core::light`):
per point the weight `lum(I) · mask(x) / max(d², r²)` is exact, the intensity of the profile
towards the point; the static selection (more than 64 entries, the shadow catcher) weighs an IES
light **inside the sphere that bounds the scene** by its flux (the peak point's, times the
profile's efficiency: its light goes wherever the scene is) and one outside it, as a spot, by the
intensity towards the centre of the scene (a narrow beam with little flux is the light that counts
there; the flux of the file is not the right measure). It sends no caustic photons.

The page writes IES lights as such when `rt_features` bit 3 is set; for an engine without it, the
spot light that stands for it (the axis intensity, a cone that is half the peak at the profile's
half-intensity angle) goes instead, which any engine reads, and that is what the Fast preview
draws. `PINNED_L5_IES_4SPP` (`0x920f0be1`, `rt --write-l5-example`: the example with its panel at a
fifth of its power, a sphere of 24 mm with the downlight profile and a warm point with the wall
washer turned about its axis, 160 x 120) holds on every SIMD path, by `rt` with 1, 4 and 16 threads
(`rt-cli/tests/example.rs`), in WASI and through the real module (`tools/wasm-parity.mjs`, CI);
`ies/tests.rs` writes `tests/fixtures/ies/conformance.json` (68 files and what this reader makes of
each), which the page's port (`src/core/ies.ts`) reproduces, refusals and messages included. Nine
mutations of the engine (a fold of φ, the handedness of φ, the mask, the radius of the scene in the
static weight, the slope term of the flux, the deduplication of profiles, the interpolation in φ,
the range of γ and the normalisation by the peak) were each caught by tests.

## Exact passes (X2)

`rt_core::passes` writes, next to the image, the per-pixel planes the AI post-processing guard
leans on (`docs/AI-POST.md` §7.4; the contract is `src/core/passes.ts`). `RNDR.passes` asks for
them, bit `i` for `PASS_KEYS[i]`:

| Bit | Pass | Words | Content (background) |
| --- | --- | --- | --- |
| 1 | `albedo` | 3 `f32` | base colour of the material at the first hit, no specular bounce followed (glass: its tint); averaged over the pixel's samples like the image (0) |
| 2 | `normal` | 3 `f32` | unit shading normal at the first hit, world space, turned towards the camera, both sides of a triangle (0) |
| 4 | `depth` | `f32` | distance along the camera's view axis (+inf) |
| 8 | `partId` | `u32` | RSB instance index + 1, what `Scene::pick` finds; the studio floor `0xffffffff` (0) |
| 16 | `materialId` | `u32` | RSB material index + 1 of that instance; the floor `0xffffffff` (0) |
| 32 | `coc` | `f32` | circle-of-confusion diameter in output pixels of the thin lens (0, also without depth of field) |
| 64 | `alpha` | `f32` | N2: coverage of the scene's objects, 0 to 1: the share of the pixel's samples whose camera ray meets a surface of an instance; the studio floor, the environment, the background and camera-visible light panels are not coverage (0) |

`normal`, `depth`, the ids and `coc` come from **one ray through the centre of the pixel, through
the centre of the lens, without jitter** (`render::centre_ray`, `render_tile_exact`, once per tile):
exact, never blended across an edge. `albedo` and `alpha` follow the camera ray of every sample of the image
(`render_tile_albedo`: one `first_hit` serves both), summed in sample order in `f32` and divided like
`Film::resolve` (each by its own count of samples); an edge pixel (E11) adds the mean of its sub-samples,
as the image does. The first
hit (`integrator::first_hit`) is the nearer of the geometry and the floor; every surface stops it
(cut-outs and glass too), and a camera-visible area light crossed first makes the pixel
background, like the environment, the backdrop and transparency. `coc` is `coc_diameter`, the
formula of `src/core/lens-coc.ts` (`tests/fixtures/lens-coc.json` is read by both), which matches
the measured blur of `Camera::generate_ray`'s own lens within 1 %. The passes have rays of their
own: they never change a pixel of the image, whose pinned hashes stay. The six planes of the
example and of the E5 example are pinned too (`crates/rt-core/src/render/passes_tests.rs`), on
every SIMD path, in the WASI runs, through the real `rt_wasm.wasm` and through the launcher.

N2 appended the seventh pass, `alpha` (bit 6; "phases add passes at the end"), as an **object matte**:
cut-outs and glass count as surfaces, as for every pass ray, and so the alpha is not the film's alpha of
a transparent-background render where the path goes through glass or the floor shows a shadow; where
only opaque objects and the background are, the two are equal bit for bit (a test renders both). The
six planes of X2 keep their pinned hashes (`PASS_X2` is `PASS_ALL` without the alpha, and the tests
and CI that pin them are over it); the alpha has pins of its own, `PINNED_PASS_ALPHA` (the example) and
`PINNED_E5_PASS_ALPHA`. With adaptive sampling (E10) the alpha, like the albedo, has the samples of the
first round.

## Geometry, BVH and SIMD

* **Meshes** (`geometry::Mesh`) are indexed triangle meshes in their own space, positions and
  normals structure-of-arrays. Building one validates it and builds its BVH, so a mesh is
  immutable.
* **Instances** place a mesh in the world with a 3x4 transform and their own material. The
  geometry (`geometry::Geometry`, `Scene::geometry`) is two-level: a BVH over the instances'
  world boxes, then each mesh's BVH; rays move into a mesh's space with the precomputed inverse
  (same `t`), normals come back with the inverse transpose.
* **BVH**: binned SAH (16 bins; leaf at 4 triangles or fewer, or up to 8 when the SAH says so),
  collapsed into BVH4 or BVH8 nodes with the child boxes stored structure-of-arrays, traversed
  with an explicit stack, nearest child first; shadow rays (`occluded`) stop at the first hit.
  The build is deterministic. BVH8 is used where AVX2 is detected, BVH4 elsewhere.
* **Triangles**: the watertight test of Woop, Benthin and Wald (JCGT 2013), four triangles per
  SIMD packet, two-sided unless an instance is flagged one-sided.
* **Queries**: `Scene::pick` / `Geometry::intersect` (instance, triangle, `t`, point, normals,
  barycentrics), `Geometry::trace` (indices and `t` only), `Geometry::occluded`, and batch forms.
  The nearest hit is the smallest `(t, instance, triangle)`, so the answer does not depend on the
  tree or the traversal order: it equals a brute-force loop over every triangle, which the tests
  check on 10 000 rays per scene, on every SIMD path and both widths.
* **SIMD** (`simd`): `F32x4`, `F32x8` and masks over the stable `core::arch` intrinsics, with a
  scalar reference implementation that every path is tested against bit for bit:

  | Path | Where | Status |
  |------|-------|--------|
  | scalar | everywhere | reference; used on RISC-V and wasm without `simd128` |
  | SSE2 | x86_64 | baseline, always on |
  | AVX2 | x86_64 | detected at run time (`is_x86_feature_detected!`), entered once per query or batch through a `#[target_feature(enable = "avx2")]` function |
  | NEON | aarch64 | compile-checked in CI (no aarch64 runner) |
  | simd128 | wasm32 built with `-C target-feature=+simd128` | tested under Node in CI |

  Fused multiply-add is never used (it would change bits between paths); `min`/`max` have the
  x86 `minps`/`maxps` semantics on every path.

## Measure ray throughput

```sh
cargo run --release -p rt-cli --bin rt-bench                  # 10 M rays per measurement
cargo run --release -p rt-cli --bin rt-bench -- --threads 1 --isa sse2 --width 4
```

It builds the example part and a displaced sphere of about a million triangles, prints the BVH
build time, and the closest-hit throughput of coherent rays (camera rays, tile by tile) and of
incoherent rays (random origins around the object aimed at random points of its bounds), plus the
any-hit throughput of the incoherent set. Ray generation is not timed.

Measured for E2 on a 4-core x86_64 VM (Xeon @ 2.8 GHz, AVX2 detected, BVH8), per thread / 4
threads, in Mrays/s:

| Scene | coherent closest | incoherent closest | incoherent any hit | build |
|-------|------------------|--------------------|--------------------|-------|
| example part (322 triangles, 3 instances) | 12.3 / 53.8 | 13.8 / 56.2 | 18.9 / 80.1 | 0.3 ms |
| displaced sphere (1 000 000 triangles) | 3.9 / 15.9 | 1.0 / 4.5 | 1.1 / 5.4 | 1.1 s |

The whole `rt --example` render path (camera rays, BVH, placeholder shading, film) went from
1.4 to 15.2 Mrays/s on 4 threads (4.4 on one) in E2. With the path tracer of E3 (about 2.7 rays
per path: camera, shadow and bounce rays, shading, sampling) it renders 7.9 Mrays/s on 4 threads
(2.0 on one) on the same VM, shared with other work at the time: the 512x384 example at 64 spp
in about 4.3 s.

## Cross-check: any OS, any architecture

```sh
rustup target add wasm32-unknown-unknown aarch64-unknown-linux-gnu riscv64gc-unknown-linux-gnu
cargo check --workspace --target aarch64-unknown-linux-gnu
cargo check --workspace --target riscv64gc-unknown-linux-gnu
```

CI runs these on every push. Rendering is deterministic: the random numbers depend only on the
scene seed, the pixel and the sample index (never on tiling, thread count or platform), the
render path uses only IEEE add / mul / div / sqrt and the `fmath` functions built from them, and
every SIMD path computes the same bits, so pinned tests (`render.rs`: two tiles, and the whole
example at 4 spp; `render/passes_tests.rs`: the six passes of the example and of the E5 example)
see the same bits on native (scalar, SSE2, AVX2) and WebAssembly (scalar, `simd128`) builds,
whatever the BVH width. E5 pins two more hashes (`PINNED_E5_HDRI_4SPP`,
`PINNED_E5_SKY_4SPP`) of a scene that goes through glass, thin walls, cut-outs, anisotropy, an
HDRI read from its RGBE bytes, a background image and the sky; the opaque path of E3 computes
exactly what it computed before, so the original pinned hashes did not change. The real module
is checked too:

```sh
cargo build -p rt-wasm --target wasm32-unknown-unknown --release
cargo run --release -p rt-cli -- --write-example /tmp/example.rsb
node tools/wasm-parity.mjs target/wasm32-unknown-unknown/release/rt_wasm.wasm /tmp/example.rsb \
     --expect "$(sed -n 's/.*PINNED_EXAMPLE_4SPP: u32 = 0x\([0-9a-f_]*\);.*/\1/p' crates/rt-core/src/render.rs | tr -d _)"
cargo run --release -p rt-cli -- --write-e5-example /tmp/e5.rsb
node tools/wasm-parity.mjs target/wasm32-unknown-unknown/release/rt_wasm.wasm /tmp/e5.rsb \
     --expect "$(sed -n 's/.*PINNED_E5_HDRI_4SPP: u32 = 0x\([0-9a-f_]*\);.*/\1/p' crates/rt-core/src/render.rs | tr -d _)"
cargo run --release -p rt-cli -- --write-q1-example /tmp/q1.rsb
node tools/wasm-parity.mjs target/wasm32-unknown-unknown/release/rt_wasm.wasm /tmp/q1.rsb \
     --expect "$(sed -n 's/.*PINNED_Q1_SECTION_4SPP: u32 = 0x\([0-9a-f_]*\);.*/\1/p' crates/rt-core/src/render/section_tests.rs | tr -d _)"
```

With `--passes` the tool also renders every exact pass interleaved with the image (per tile
`rt_render_tile_passes` once, `rt_render_tile_albedo` after every sample) and prints each plane's
hash; `--expect-passes h1,…,h6` (the `PINNED_PASS_*` or `PINNED_E5_PASS_*` values, in `PASS_KEYS`
order) checks them, as CI does, and the image must keep its hash. `--alpha` (N2) also renders the alpha
pass, `rt_render_tile_alpha` after every sample, summed and divided like the image;
`--expect-alpha h` (`PINNED_PASS_ALPHA` or `PINNED_E5_PASS_ALPHA`) checks its plane. It is a flag of
its own so the six hashes of `--expect-passes` stay what X2 pinned.

## Produce the WebAssembly module

```sh
cargo build -p rt-wasm --target wasm32-unknown-unknown --release
# -> target/wasm32-unknown-unknown/release/rt_wasm.wasm  (about 290 KB, no imports)
```

The module imports nothing (no WASI, no JavaScript glue). Exports:

| Export | Meaning |
|--------|---------|
| `rt_version() -> u32` | `major << 16 \| minor << 8 \| patch` |
| `rt_alloc(len) -> ptr` / `rt_free(ptr, len)` | Buffers in linear memory for the host to fill or read |
| `rt_scene_load(ptr, len) -> handle` | Parses RSB bytes; 0 on error |
| `rt_scene_error_len() -> u32` / `rt_scene_error_copy(ptr)` | The last load error as UTF-8 |
| `rt_scene_update(handle, ptr, len) -> status` | Replaces a loaded scene with RSB bytes; a file **without `MESH` sections keeps the scene's meshes and their BVHs** (camera, size, instances, materials, lights change without sending or rebuilding the geometry), and one **without `BMAP` sections keeps its bitmaps** (E5) |
| `rt_scene_free(handle) -> status` | Forgets a scene |
| `rt_render_tile(handle, x, y, w, h, sample_index, out_ptr) -> status` | Writes `w * h * 3` linear RGB floats for one sample of a tile |
| `rt_render_tile_rgba(handle, x, y, w, h, sample_index, out_ptr) -> status` | The same with coverage: `w * h * 4` floats, RGB premultiplied by alpha (0 where a transparent background shows) |
| `rt_render_tile_passes(handle, x, y, w, h, mask, out_ptr) -> status` | X2: the exact passes of `mask` (normal 2, depth 4, partId 8, materialId 16, coc 32; the albedo bit, the alpha bit and unknown bits are ignored) of a tile, one plane after another in that order, `w * h * channels` little-endian words each (`f32`, `u32` for the ids). The same for every sample: once per tile |
| `rt_render_tile_albedo(handle, x, y, w, h, sample_index, out_ptr) -> status` | X2: the albedo of one sample of a tile, `w * h * 3` floats; the host sums the samples in index order in `f32` and divides like the image |
| `rt_render_tile_alpha(handle, x, y, w, h, sample_index, out_ptr) -> status` | N2: the coverage of one sample of a tile, `w * h` floats (1 where that sample's camera ray met an instance, 0 otherwise; the mean of the sub-samples for an edge pixel); summed and divided like the albedo |

Status: 0 ok, 1 bad handle, 2 empty or oversized tile, 3 null pointer, 4 invalid scene update (the
message is the last load error; the scene is unchanged). The scene's lights are prepared once, when
it is loaded or updated. `rt_version` is 0.3.0 since E4 (`rt_scene_update`).
A wasm instance is single threaded; the host runs one instance per Web Worker.

## The RSB scene format

RSB (Repackshot Scene Binary, version 1) is little-endian: the magic `RSB1`, a `u32` header
length, then sections `[tag: 4 ASCII bytes][u32 byte length][payload]`. Tags: `CAMR`, `LENS`,
`MESH`, `MATL`, `LGHT`, `ENVR`, `FLOR`, `RNDR`, `INST`, `BMAP`, `PATN`, `FXAM`, `SECT`, `IMGS`, `IESP`. Unknown tags are skipped, so old readers keep
working with newer writers. `INST` (E2) places a mesh with a 3x4 transform, a material and flags;
a file without `INST` sections draws every mesh once, untransformed, with its own material,
exactly as before. E3 appended optional fields (`MATL.flags`; `RNDR.max_depth`,
`RNDR.clamp_indirect`: shorter, older sections read their defaults), added `FLOR` and fixed the
meaning of every value (see "The path tracer" above). E5 appended `MATL.opacity`, `anisotropy`
and `absorption_mm` (72 bytes), the environment's `hdri_map`, `backplate_map`, `backplate_fit`,
`sky_turbidity`, `sun_azimuth_deg`, `sun_elevation_deg` and `backplate_rect` (80 bytes), and added
`BMAP` (a 16-byte header `format width height byte_len`, the data, zero padding to 4 bytes; the
environment names a bitmap by its position among the `BMAP` sections, `0xffffffff` for none).
X2 appended `RNDR.passes` (40 bytes), the mask of the exact passes above (0, and every older file:
none). O1 added `LENS` (optional, right after `CAMR`): the optics of the camera beyond the thin lens
(`rt_core::optics`: iris blades, roundness and rotation, an aperture mask or a pupil texture
sampled through its 2-D CDF, the pupil's radial profile, a central obstruction, cat's eye, an
anamorphic squeeze, lens shift and a Scheimpflug tilt, artistic chromatic bands and swirl); a file
without it renders exactly as before. O3a appended the lens's three effect-filter slots (28 bytes
each, written only when there are filters). O2 appended the traced lens's prescription after
those slots (written then, empty, even without filters): a surface count, the stop, the focus mode,
the fastest f-number, the floating magnifications, four artistic overrides, the moving gaps and
48 bytes per surface. E6 appended `MATL.bevel_mm` (76 bytes: the radius of
the edge bevel of the shading, `rt_core::bevel`) and added `PATN` (108 bytes, one per patterned
material: the procedural wood or cloth of `rt_core::pattern`). E9 appended to `MATL` (100 bytes)
`scatter_mm`, `scatter_color` (three floats), `scatter_g` and `abbe` (the Abbe number of solid
glass, E9c). M2b reads what M2a's writer sends when the engine says it can (`rt_features` bit 0,
`rt_core::FEATURE_TEXTURES`): `IMGS` (the texture images as 8-bit rows, sRGB or linear; the
engine computes their mipmaps), the texture block of `MATL` from byte 100 (six slots with their
mapping, the emission tint, the labels) and the UV sets of `MESH` after its material; see
`rt_core::texture`. M3b added `PROG` (after every other section, one per node material: its
`MATL` index and the bytes of M3a's `encodeProgram`), which the page writes when the engine says
it runs them (`rt_features` bit 1, `rt_core::FEATURE_PROGRAMS`); see `rt_core::program`. Q1 added `SECT` (20 bytes, at
most one: flags with bit 0 = cap, the plane's normal and distance) and the `INST.flags` bit 1 (value 2,
`INSTANCE_NO_SECTION`), and `rt_features` bit 2 (`rt_core::FEATURE_SECTION`) says the engine cuts;
see "Section view" above. L5 added `LGHT` kind 5 (an IES light: its record is 80 bytes, the extra word
naming its profile) and `IESP` (the text of an IES file, once per distinct profile, after the lights),
which the page writes when the engine says it renders them (`rt_features` bit 3, `rt_core::FEATURE_IES`);
a scene without IES lights is byte for byte what it was; see "IES lights (L5)". The exact field layout and the semantics
are documented at the top of
[`crates/rt-core/src/scene/rsb.rs`](crates/rt-core/src/scene/rsb.rs), which contains both the
reader (`Scene::from_rsb`, and `Scene::update_from_rsb` for updates that keep the meshes) and the
reference writer (`Scene::to_rsb`) that the TypeScript side (`src/io/rsb.ts`) is tested against
byte for byte.

## Roadmap of the engine

* **E1**: workspace, maths, RNG, film, PNG, RSB, a brute-force ray caster, CLI, wasm shell.
* **E2**: SIMD, SoA meshes, instances, binned-SAH BVH4/BVH8, watertight triangles, `pick`,
  shadow-ray queries, `rt-bench`; `render.rs` traces through the BVH.
* **E3**: the path tracer: Owen-scrambled Sobol, principled BSDF, area lights, sun, studio dome,
  MIS, floor and shadow catcher, alpha, tone curves, progressive CLI with a time budget, the
  contact sheet, wasm parity of the whole example.
* **E4**: the engine in the browser: `rt_scene_update` (updates without geometry), the simd128
  build, `rt --tone-table` for the TypeScript port of the tone curves.
* **E5**: clear dielectrics (rough and smooth GGX transmission, absorption, thin walls), cut-outs,
  anisotropy, emitters as lights by flux, the Preetham sky, HDRIs (own RGBE, OpenEXR and inflate
  readers, 2-D importance sampling), background images, `BMAP`; the E5 scenes of the contact
  sheet. Next: subsurface, wood, fabric and bevel (E6).
* **E5b-1**: the film's squared luminance, our own denoiser (`rt_post::denoise`, edge-avoiding
  à-trous with variance-guided stopping, guided by the exact passes), photon-map caustics
  (`rt_core::caustics`, SPPM in the form of Knaus and Zwicker), `RNDR.denoise`,
  `caustic_photons`, `caustic_radius`, `rt --denoise --keep-noisy --caustics`, `rt_denoise` and
  `rt_scene_caustics` in the module, the E5b parity scene and the sheet's pairs.
* **E5c**: the physical sky, ours in a clean room: `rt-sky` simulates the atmosphere and fits the
  Hošek–Wilkie form to it (table with recipe, seed and SHA-256), `ENVR.sky_model` (0 physical, the
  default; 1 classic), the E5c parity scene (`rt --write-e5c-example`) and the physical-against-
  classic pairs of the contact sheet.
* **O1**: the enhanced thin lens (`rt_core::optics`, the `LENS` section): pupils sampled with
  their exact density (concentric disc, fans of straight or curved blades, 2-D CDFs of masks and
  textures), radial profiles, obstruction, cat's eye, anamorphic squeeze, shift and Scheimpflug
  tilt, chromatic bands stratified per pixel (`PixelSampler::stratum`, `DIM_LENS_BAND`) and
  swirl; the O1 parity scene (`rt --write-o1-example`).
* **O3a**: effect filters on the lens (`rt_core::optics::filters`): diffusion (white, black,
  gold), glimmer, soft, net, star and streak as scattering of the camera ray at the pupil, with
  tabulated inverse CDFs of their angular PSFs, and a connection of each camera sample to a light
  the camera sees through the filter's PSF, weighted against the scattering with the balance
  heuristic lobe by lobe; a stack of three per camera; the O3a parity scene
  (`rt --write-o3a-example`), the filter sheet (`rt --filter-sheet`) and the measurement of the
  noise the filters add with and without the connections (`rt --filter-noise`).
* **O2**: the traced lens (`rt_core::optics::traced`, `optics::paraxial`): a prescription at the
  end of `LENS` (spheres, planes, even aspheres, cylinders, mirrors; one stop) traced from the
  sensor surface by surface after Kolb, Mitchell and Hanrahan (1995) with the stable intersection
  and only `+ − × ÷ sqrt`, scaled to the camera's focal length, focused (unit, internal,
  floating, and an anamorphic adapter's gap), three bands of Cauchy indices, coatings as
  per-surface transmittance (T-stop and tint), exit-pupil bounds per image height, the artistic
  overrides, and the lens information the interface shows (`LensInfo`: focal lengths, image scale,
  back focus, f-number and T-stop, distortion, relative illumination, the cross-section;
  `rt_scene_lens_info`, `POST /api/lens/info`); the O2 parity scene (`rt --write-o2-example`), the
  catalogue as `rt` sends it (`rt --write-lens-catalogue`), the lens sheet (`rt --lens-sheet`) and
  the measured cost of the traced camera (`rt --lens-cost`); the tiles trace the camera rays of a
  row through the lens in batches of eight (`optics::traced::batch`, the same bits as one by
  one).
* **M2b**: image textures and labels (`rt_core::texture`): `IMGS` with mipmaps computed when the
  scene is read (box filter in linear values, fractional weights on odd sides), bilinear and
  trilinear reads with the level of detail of the ray's footprint (Igehy's ray differentials for
  camera rays, the path's cone after; a quarter of a pixel), the UV, box, planar, cylindrical and
  spherical projections of `src/core/textures.ts` in `f32` (the shared fixture
  `tests/fixtures/texture-mapping.json`), the six slots (colour, roughness, metal, normal or height,
  alpha as a cut-out or a coverage, emission), tangent-space normal maps in the frame of the
  coordinates' surface gradients, labels over the surface with their own finish and paper edge,
  per-point opacity for shadow rays, the textured albedo pass; `rt_features`, the M2b parity
  scene (`rt --write-m2b-example`).
* **M3b**: the material programs of M3a's node graphs (`rt_core::program`): `PROG` read with
  every check of the contract, an interpreter with fixed register files on the stack and no
  allocation, the same bits as the TypeScript reference (`tests/fixtures/material-programs.json`:
  every instruction, the ten examples at 1000 points, the special numbers), M3a's noise, image
  reads through M2b on one level of detail per mapping, curvature from the bevel's sharp edges, the
  bevel weight, cut-outs for camera and shadow rays, emission (an emitter whose program varies is
  not sampled as a light); `rt_features` bit 1, the M3b parity scene (`rt --write-m3b-example`).

* **L5**: IES lights: `rt_core::ies` (the LM-63 reader, strict, type C; bilinear lookup with the
  file's symmetries; the flux of the interpolant in closed form), `LightKind::Ies` and `Light::ies`
  (a point or sphere masked by the profile's share of its peak, through the spot's code),
  `LGHT` kind 5 with `IESP` sections, `rt_features` bit 3, the L5 parity scene
  (`rt --write-l5-example`, `PINNED_L5_IES_4SPP`).
* **E10**: adaptive sampling by rounds (`rt_core::adaptive`: the relative error of the mean per
  pixel, smoothed, by 8 x 8 blocks, the median of the candidates' errors as the threshold),
  `RNDR.adaptive` and `noise_threshold`, `render::render_block`, `Film::cut`, the denoiser's
  per-pixel counts, `rt --adaptive --noise --adaptive-noise --write-e10-example`,
  `rt_render_block_rgba` and `rt_adaptive_decide` in the module, the E10 parity scene.

* **S4a**: ambient particles without state (`rt-sim`: `FXAM`, closed-form motion, curl-noise
  drift), the three primitives with their BVH, the minimum size on screen with its energy kept,
  the S4a parity scene (`rt --write-ambient-example`) and `rt_particles_eval` for the preview.
* **S4b**: the screen grid of camera rays, drops without caustics (`RayClass::Rough`, straight
  crossings, next-event estimation of smooth drops for delta lights only), the forward lobe of
  dust (`FXAM` 200 bytes: `forward`, `forward_g`), and the cost of each preset measured in the
  ambient sheet.

## Third-party data

`crates/rt-core/src/sky_table.rs` (and its copy `src/core/sky-table.ts`) is ours: the coefficients
of the physical sky, fitted by `rt-sky` to our own simulation (regenerate with `cargo run
--release -p rt-sky -- table`; the recipe, seed and SHA-256 are in the file's header). The
simulator uses published physical data, cited in `crates/rt-sky/src/atmosphere.rs` and
`spectrum.rs`: the U.S. Standard Atmosphere 1976 (public domain), the refractive index of Peck and
Reeder (1972) and the King factors of Bates (1984) as given by Bodhaine et al. (1999), Leckner's
ozone absorption coefficients (1978) as tabulated by Bird and Riordan (1986, public domain), the
IAU 2015 nominal solar values and the CIE colour-matching fit of Wyman, Sloan and Shirley (2013).
No other sky model's code or coefficient tables were used.

`crates/rt-core/src/sampler.rs` reproduces the first 64 dimensions of the Sobol direction numbers
`new-joe-kuo-6.21201` of S. Joe and F. Y. Kuo (<https://web.maths.unsw.edu.au/~fkuo/sobol/>),
which carry this notice:

```text
Copyright (c) 2008, Frances Y. Kuo and Stephen Joe
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.

    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

    * Neither the names of the copyright holders nor the names of the
      University of New South Wales and the University of Waikato
      and its contributors may be used to endorse or promote products derived
      from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS ``AS IS'' AND ANY
EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDERS BE LIABLE FOR ANY
DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
