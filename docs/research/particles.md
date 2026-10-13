# Investigación: partículas de todo tipo (2026-10-13)

> Informe de investigación preparado por Sonnet para el líder, en inglés tal como se redactó. Las decisiones están en `docs/STUDIO-TOOLS.md` y en `docs/ROADMAP.md`.

# Particles "of every kind" for Repackshot: catalogue, methods, rendering, UX and phased plan

Research only. I wrote nothing into the repository. Sources are public papers, books and public manuals, used for black-box understanding of features and UX only. No tool source code was read.

Convention used below:
- Bracketed tags like [R83] map to the reference list at the end.
- "(analysis)" means my own reasoning, not a cited fact.
- "(estimate)" means my arithmetic or a guess with stated assumptions. Nothing here was measured.
- "Repo:" marks facts I read in `/home/user/Repackshot`.

---

## 0. Executive summary

1. **Every effect fits six render representations and two time models.**
   - Representations: instanced meshes or spheres; volumes; strands (curves); liquid surfaces; thin shells; procedural surface decals.
   - Time models: stateless (class A) or baked (class B), explained next.
2. **The most useful design decision is stateless versus baked** (analysis).
   - Class A is independent particles: dust, sparks, rain, snow, rising bubbles, scatter, falling confetti without particle–particle contact. Each particle is a pure function of (seed, id, t) plus a re-integration from its birth.
   - Class A fits the repo's rule that animation is "a deterministic function of time" (`docs/SPEC.md` §3.7: `evaluate(state, t)` is a pure function).
   - Class B is interacting particles: rigid piles, granular material, cloth, liquid, gas. Their state depends on all earlier steps, so they must be baked to a cache. `evaluate(t)` then just reads the cache.
   - "Freeze at frame" is `t*` for class A and "bake up to `t*`" for class B.
3. **The engine is a good base for instancing and poor for everything else** (Repo, read in `engine/crates/rt-core/src`).
   - It has a two-level BVH with one instance per leaf, 3×4 transforms, and an index limit of `(1<<28)−2` ≈ 268 M instances.
   - Triangles only: no spheres, curves or volumes.
   - No per-ray time, so no motion blur; there is a thin-lens camera.
   - No participating media.
   - Per-instance appearance is only `material_id` and `flags`.
   - The RSB `INST` record is 60 B, and every worker receives the whole RSB and builds its own copy (`docs/ARCHITECTURE.md` §5.2–5.3, no `SharedArrayBuffer`).
   - So millions of instances in the browser need procedural expansion inside the engine, not a big RSB.
4. **KeyShot's public manual describes much less than "every kind"** (§1.3).
   - Rigid-body Physics Simulation that records keyframes.
   - Geometry nodes Bubbles, Flakes and Fuzz (a static scatter with Size, Variation, Density, Limit in millions, Seed).
   - A Scattering Medium volume material with an OpenVDB density texture.
   - Alembic import for deformation.
   - I found no native particle emitter or "Scatter" tool.
5. **Recommended solver family:** position-based dynamics with XPBD and substeps. One framework covers rigid bodies, cloth/ribbons/hair, grains and PBF liquids [XPBD][SS19][RB20][UPP]. Add Stam-style grid smoke [ST99] for gas. FLIP/APIC is a later quality upgrade [BK][APIC].
6. **Recommended order** (agrees with the author's guess, with one insertion: a cheap baked-cache importer first):
   - Scatter/instance sets, then rigid drop-and-settle (parity with KeyShot Physics).
   - Droplets/condensation, then ambient and emissive emitters (stateless, with motion blur).
   - Volumes, then gas simulation, then liquids (PBF), then strands, then cloth/ribbons.
7. **Determinism is achievable.**
   - Fixed `dt`, counter-based RNG, the existing `fmath` functions, and no FMA or platform libm.
   - Partitioning independent of thread count, Jacobi-style updates, and sorted neighbour lists.
   - Hash tests across thread counts and native-versus-wasm, as Box2D does in CI [BX24].
8. **Two citation corrections to the brief:**
   - The *null-scattering path integral* is Miller, Georgiev & Jarosz 2019 [NS19]. Novák et al. 2018 is the state-of-the-art report on null-collision methods [VOL18].
   - Position Based Dynamics first appeared at VRIPHYS 2006 [PBD]. The JVCIR journal version is dated 2007 (I did not re-verify the journal record).

---

## 1. Ground truth

### 1.1 What the engine can and cannot do today

Repo, `engine/crates/rt-core/src`. File-level facts are read from code, not tested.

| Capability | Today | Consequence for particles |
|---|---|---|
| Instancing | `Instance { mesh, transform 3×4, material_id, flags }`; TLAS with one instance per leaf; `MAX_INSTANCES = (1<<28)−2` (`geometry/mod.rs`, `bvh.rs`). `Geometry` is immutable, but `into_meshes()` lets a host rebuild only the TLAS without rebuilding mesh BVHs. | A per-frame TLAS rebuild for animated instance sets is already supported. |
| Instance memory | `PreparedInstance` stores an inverse transform (48 B) plus flags. RSB `INST` is 60 B per instance plus an 8 B section header. | Roughly 0.15–0.25 KB per instance resident (estimate from struct sizes). |
| RSB distribution | Each worker gets the whole RSB (`ARCHITECTURE.md` §5.3). | 1 M instances ≈ 68 MB per postMessage and about 0.2 GB per worker (estimate). With 8 workers that is about 1.6 GB, so this does not work in-browser. Plan on 100–250 k instances in-browser and millions natively (estimate). |
| Primitives | Triangles only (`triangle.rs`). | Spheres, capsules and curves are new primitives. |
| Time | No time in `Ray`; thin-lens DOF exists (`render.rs`, `scene/mod.rs`). | Motion blur needs a time dimension (§4). |
| Media | None. `LGHT` kinds are rectangle, disc, sun, point and spot (spot is read and ignored). | Volumes are a new integrator feature. |
| Determinism tools | `fmath.rs` (deterministic sin/cos/exp/log/pow/atan2/acos built from IEEE `+ − × ÷ sqrt`, never fused), `rng.rs` (PCG32 and `mix64`), transforms use only add and multiply. | A simulator can reuse these directly. |
| Threads and OS | `rt-core` has no `std::thread`, `fs` or `time`; threading lives in the host crates. | A new zero-dependency simulation crate must follow the same rule. |

Roadmap context:
- Glass is phase E5 and not yet done, which droplets and bubbles depend on.
- The animation system N1 is a pure `evaluate(state, t)` with one track per target (`SPEC.md` §3.7).
- E8 leaves open "how `rt` renders an animation" (port `evaluate` to Rust, or one RSB per frame). Effects with caches strengthen the case for caches as files.

### 1.2 Project rules that constrain the design (CLAUDE.md)

- Engine has no external crates, is deterministic and portable, and uses `f32` throughout (rules 8, 8b).
- UI is achromatic, every string exists in `es` and `en`, and mutations go through the store and are undoable (rules 4, 5, 6).
- Catalogue keys are stable (rule 7).
- No invented numbers in the UI; unfinished features are marked *próximamente* (rule 10).
- Visual and photographic criteria and architecture decisions are Fable's (rule 11). Everything below is a proposal.

### 1.3 What KeyShot's public documentation shows (black-box only)

| Feature | What the manual says | Source |
|---|---|---|
| Physics Simulation | Runs physics and records the result as keyframe animation. Controls: Simulation Time (0 = run until everything settles), Keyframes per Second, Simulation Quality (steps per second), Gravity (0–100), Friction (static and dynamic, global), Bounciness (global), "As Parts" (settle parts individually), Begin/Stop, a simplified timeline. Works only on mesh objects. Ignores other animations. A ground plane's normals must face the falling objects. | [KS-PHYS] (KeyShot 11 and 2024 pages agree) |
| Settle tool | A tutorial describes a Settle button in the Move tool, with "As Parts" for assemblies. | [KS-SETTLE] |
| Geometry nodes | "Transform the shape of your geometry in a non-destructive manner." They need an explicit "Execute Geometry" (Alt+G). Bubbles, Displacement and Flakes are not supported in Render NURBS mode. | [KS-GN] |
| Bubbles | "Spheres of air inside the material." Size, Size Variation, Density (per cm), Bubble Limit (per object, in millions), Seed, density texture as mask. The mesh must be closed. | [KS-BUB] |
| Flakes | Square or sphere shape, Size, Size Variation, Density, Flake Limit (millions), Seed, vertex colours, UV. | [KS-FLK] |
| Fuzz | Hair-like growth from any surface. Length, Length Variation, Randomness, Radius, Density, Segments, Max Curves (millions), Shape (Ribbon or Cylinder), density/length/direction textures, optional Surface material. | [KS-FUZ] |
| Scattering Medium | Volume material: Transmission, Transparency Distance, Density, Multiple Scattering toggle, Albedo, Scattering Directionality (−back, 0 uniform, +forward), Samples, density texture. "Simulate particle scattering to create such effects as fog or smoke or volumetric lighting such as visualizing beams or rays of light." | [KS-SM] |
| Volume Map | Loads an OpenVDB `.vdb` as a density texture (only `.vdb`). | [KS-VM] |
| Animation | "KeyShot does not offer creation of deformation animations, but it does support deformations created in CAD and imported as an Alembic (.ABC) file." The Mirror command is "useful for exploded view animations." | [KS-ANI] [KS-WWA] |

What I could not confirm:
- No KeyShot "Scatter" tool or native particle emitter appears in the KeyShot 11 manual index I could query (WordPress JSON search for "scatter", "particle", "fur"). Summaries of the 2025.1–2025.3 and 2026.1–2026.2 release notes mention none either.
- The 2024–2026 manual site is JavaScript-gated; WebFetch returned only "Secure Login" for most pages. Only the 2024 physics page and the KeyShot 11 manual were readable. Absence of evidence is not proof.
- A KeyShot community thread surfaced in search results (unreadable at fetch time, so unverified). It claims smoke must come from another tool as Alembic geometry and that OpenVDB animation was unsupported at the time.

So "KeyShot-style scattering" in this project means the Bubbles/Flakes/Fuzz pattern (size, variation, density, limit, seed, density mask) plus "Settle". Everything else would be an addition beyond KeyShot's documented feature set.

---

## 2. Catalogue of effects

Legend:
- **Class**: A = stateless, random-access in time. B = baked. P = procedural and static.
- **Cost**: S/M/L/XL, relative engineering effort in this engine.
- **Rep** = render representation (see §4).

### 2.1 Ambient and atmosphere

| Effect | Looks like | Typical uses | Method | Rep | Class / cost |
|---|---|---|---|---|---|
| **Dust motes, pollen, floating seeds** | Tiny bright specks drifting in a sunbeam; backlit glints; blurry discs under DOF | Interiors with window sun, furniture lifestyle, skincare/perfume mood | Independent particles; weak gravity, drag, Brownian jitter [BL-NEWT]; curl-noise drift, divergence-free so particles do not pile into sinks [CN07] | Tiny instanced spheres or discs; DOF gives bokeh (thin lens already exists) [DRT84] | A / S |
| **Haze and light shafts (god rays)** | Visible beams in air | Interiors, automotive, perfume, mood | Homogeneous participating medium with forward-scattering phase function, Henyey–Greenstein g [HG41]; KeyShot's Scattering Medium names "visualizing beams or rays of light" [KS-SM] | Volume (homogeneous first); single-scatter NEE through the medium | P / M |
| **Fog banks, ground mist** | Low, soft, noisy layers | Outdoor/studio atmosphere | Procedural density = envelope × noise advected by curl noise; stateless density function of (x, t) [CN07] | Heterogeneous volume with majorant grid and DDA [PBRTv] | A / M |
| **Steam over coffee/soup, kettle** | Rising wisps, backlit | Hot drinks, food, cookware | Hero: grid smoke with vorticity confinement [ST99][FSJ01], baked. Cheap: procedural advected density | Volume | B or A / L |
| **Perfume/cosmetic mist, spray** | Cone of fine droplets or fog | Spray bottles, atomizers | Burst of particles with drag, rendered by splatting into a volume (Houdini sources volumes from points via a rasterize SOP) [HOU-PYRO] (analysis for the use) | Volume plus a few visible droplets | B / L |

### 2.2 Liquids

| Effect | Looks like | Typical uses | Method | Rep | Class / cost |
|---|---|---|---|---|---|
| **Condensation / dew / water beads** | Many small domed droplets of varied size on a cold surface; some run down | Cold can, bottle, glass, cosmetic bottle | Procedural placement, not simulation. Real "breath figures" go through nucleation, growth, coalescence; the size distribution has an intermediate power-law range, a bump of large droplets and a tail of small ones [BR]. Spherical caps defined by base radius and contact angle (geometry, analysis); Poisson-disk placement [PD07][YK15] | Instanced spherical caps with a dielectric material (IOR ≈ 1.33); LOD to normal-map plus roughness mask at distance (analysis) | P / M |
| **Splash, crown, fruit-in-water** | Edgerton-style coronet: rim, fingers, secondary droplets | Beverage, fruit, dairy, soap | Drop-impact physics [YA06]; sim by PBF/SPH or FLIP with surface tension; secondary spray, foam, bubbles as diffuse particles [FOAM12] | Dielectric mesh (marching cubes of anisotropic implicit surface [YT13]) plus instanced droplets | B / XL |
| **Pours and streams** | Milk/juice/honey into a cup | Food and drink | Inflow emitter into PBF/FLIP. Cheap alternative: a spline-swept tube stream, ripple height-field, splash particles (analysis) | Liquid mesh or swept tube | B / XL (cheap: M) |
| **Ripples and waves** | Rings on a liquid surface | Drinks, pools | 2D height-field wave simulation (a short public tutorial exists) [TMP #20] | Displaced mesh or normal map | B / M |
| **Bubbles, foam, carbonation** | Streams of bubbles rising from sites, foam ring | Soda, beer, champagne | Bubbles nucleate on microscopic particles, rise, grow and burst at the surface [LB08]. Per-site emitters; foam as spray/foam/bubble diffuse particles [FOAM12]. KeyShot's Bubbles node is the static version [KS-BUB] | Instanced air spheres inside the liquid; needs nested dielectrics [ND02] | A / M |
| **Viscous swirls, cream/gel, ink in water** | Thick swatches, ribbons, dye clouds | Cosmetics, food, paints | High-viscosity FLIP/PBF; ink as a gas-like density in liquid | Mesh or volume | B / XL |

### 2.3 Granular, scattering and rigid pieces

| Effect | Looks like | Typical uses | Method | Rep | Class / cost |
|---|---|---|---|---|---|
| **Dropped and settled pieces**: coffee beans, pills, nuts, candy, ice cubes, screws, ingredients | Natural-looking pile or scatter at rest | Food, pharma, hardware, tabletop scenes | Rigid-body drop and settle: sequential impulses [CAT06] or XPBD rigid bodies [RB20]; sleeping thresholds [BL-RB-D]; Houdini's solver uses simplified proxy collision geometry [HOU-RBD] | Instanced meshes with per-instance variation | B / L–XL |
| **Powders, sugar, salt, sand, grains** | Piles, dunes, streams | Cosmetics, food, packaging | Hero-level: PBD particles with friction [UPP], DEM [CUND79], FLIP sand [ZB05] or MPM [KLAR16]. Packshot shortcut: drop-and-snap onto a surface, then a heightfield or displaced pile (analysis) | Instanced spheres/grains, or a pile mesh | B / L |
| **Scatter on surface or in a volume**: sprinkles, seeds, pebbles, rivets, salt crystals, flakes | Evenly or randomly distributed small elements | Donuts, buns, concrete, leather grain | Random or Poisson-disk points on triangles, density maps, alignment to normal, random tilt and scale [BL-DIST][BL-INST][PD07][YK15]; KeyShot Flakes [KS-FLK]; Houdini POP Source scatter with relax iterations [HOU-POP] | Instanced meshes | A or P / M |
| **Levitation, zero-g ingredients, orbiting parts** | Pieces suspended around the product | Ads for food, drinks, electronics | Rigid pieces with gravity 0 plus noise sway and slow spin, or keyed; no solver needed (analysis) | Instanced meshes | A / S |
| **Exploded view** | Parts separated along axes | Technical and electronics ads | Already an animation type `EXPLODE` (`SPEC.md` §3.7); KeyShot uses Mirror to return [KS-WWA] | Existing parts | A / done |

### 2.4 Soft and thin

| Effect | Looks like | Typical uses | Method | Rep | Class / cost |
|---|---|---|---|---|---|
| **Confetti, paper, streamers, petals, leaves, feathers** | Flutter and tumble while falling | Launches, food, fashion, outdoors | Thin falling plates flutter, tumble or descend steadily [AP05]. Independent particles with a flutter model (stateless) plus a settle step. XPBD thin shell for hero pieces | Instanced thin meshes, two-sided with translucency (analysis) | A / M |
| **Cloth drape, tablecloth, flowing ribbon** | Fabric draped over or around a product | Textiles, bedding, packaging | XPBD distance and bending [XPBD]; substeps [SS19]; Houdini Vellum has cloth configurations [HOU-VEL]. Self-collision is notoriously hard [TMP #15] | Mesh with the fabric material | B / L |
| **Hair, fur, fibres, grass, bristles** | Strands from a surface | Plush, brushes, outdoor scenes | Guide strands plus children (Blender uses parent/child hair [BL-REN]); inextensible strand dynamics with one iteration per frame [MKC12]; KeyShot Fuzz [KS-FUZ] | Curves [PBRTc][PHAN][EMB] with fibre shading [CH16][MJC03] | A or B / XL |

### 2.5 Gaseous and energetic

| Effect | Looks like | Typical uses | Method | Rep | Class / cost |
|---|---|---|---|---|---|
| **Smoke, steam, mist** | See §2.1 | | Stable fluids: semi-Lagrangian advection, unconditionally stable [ST99]; vorticity confinement [FSJ01] | Volume | B / L |
| **Fire, flames, candles, stoves** | Emissive flame with soot | Candles, grills, lighters | Combustion with blackbody emission [NFJ02]. Cheap preset: procedural emissive flame profile with flicker noise | Emissive volume with a temperature field and blackbody colour [PBRTv][BL-PV] | B or A / L |
| **Colour/powder burst, explosion** | Expanding coloured cloud | Cosmetics, sport, paint | Gas sim with a particle density source; or ballistic particles with strong drag, splatted into a volume (analysis). Houdini ships "Initialize Smoke / Fire / Explosion" quick setups [HOU-PYRO] | Volume with coloured albedo plus visible grains | B / L |
| **Sparks, embers, welding, grinder** | Short bright streaks | Tools, metal, fire | Reeves-style ballistic systems with drag and bounce [R83]; blackbody colour fading with age (analysis) | Emissive capsules with motion blur | A / M |
| **Fireflies, bokeh lights, fairy lights** | Soft glowing spheres | Mood and background | Stateless drift under curl noise [CN07]; bokeh arises from DOF [DRT84] | Emissive spheres, camera-visible, not light-sampled | A / S |
| **Magic dust, sparkle trails, glitter** | Particles along a path; shimmer | Cosmetics, jewellery, launches | Emitter along a curve with trail ribbons (X-Particles has a Trail Generator historically [XP-2012]); glitter as flakes with random normals [KS-FLK] | Spheres/capsules, ribbons, flake instances | A / M |

### 2.6 Weather

| Effect | Looks like | Typical uses | Method | Rep | Class / cost |
|---|---|---|---|---|---|
| **Rain** | Motion-blurred streaks | Outdoor, waterproofing, cars | Terminal-velocity falling [GK49]; streak appearance has oscillation patterns [GN06] | Motion-blurred capsules or stretched spheres | A / M |
| **Snow (falling and fallen)** | Slow flakes; accumulated layer | Winter, outdoor gear | Falling flakes are stateless. Fallen snow: fire particles upward from surfaces to find sheltered areas, then let unstable snow slide [FE00] | Instanced flakes plus a displaced layer | A / M; layer L |
| **Hail** | Ice balls bouncing | Weather, roofing | Ballistic with high restitution, or rigid bodies | Instanced spheres | A / S |
| **Wind-blown leaves or seeds** | Tumbling in gusts | Outdoor | Flutter model plus gust field from curl noise [CN07][AP05] | Instanced thin meshes | A / M |

### 2.7 Other common product-ad effects not in the brief

- **Frost and ice crystals:** procedural scatter plus displacement.
- **Soap bubbles:** thin-film shading on spheres, no solver.
- **Dust and dirt deposits:** the project already has procedural wear.
- **Motion streaks and speed lines:** trail ribbons.
- **Floating tech dots:** emissive points.

---

## 3. Simulation methods

### 3.1 Comparison

| Method | Core maths | Cost / stability | Determinism notes | From scratch in Rust? |
|---|---|---|---|---|
| **Emitter + forces** (Reeves) [R83] | Per-particle ODE: gravity, drag, wind, turbulence, vortex, attractor. Birth and attributes come from mean ± variance; lifetime in frames; motion blur is easy [R83]. Blender offers Euler, Verlet, Midpoint and RK4 integrators, plus Brownian, drag and damp [BL-NEWT]. Collisions: ray cast per step against the static BVH, reflect `v' = v − (1+e)(v·n)n`, tangential friction, stick or kill (analysis). | O(N); stable with `dt` below the cell or radius per speed (analysis) | Independent particles, so trivially thread-independent | Yes, 1–2 weeks |
| **Curl noise** [CN07] | `v = ∇×ψ` with ψ a vector noise potential; divergence-free; ramp the potential to zero at solid boundaries; evaluable anywhere in space and time with no grid | O(N) × 3 noise evaluations | Pure function of (x, t, seed); build on the Perlin-style noise [Perlin02] with `fmath` | Yes, days |
| **Rigid bodies, sequential impulses** [CAT06] | Impulse per contact, accumulated impulse clamped (normal ≥ 0; friction within μ times normal), warm starting from the previous frame, two tangent directions | O(contacts × iterations); stable stacks with warm starting | Sort contacts by (bodyA, bodyB, feature); Box2D keeps contact order deterministic under threads with per-worker bitsets merged by OR [BX24]; start single-threaded | Yes. Hardest part: robust contact manifolds |
| **Rigid bodies, XPBD** [RB20] | "Quasi explicit," unconditionally stable; uses current constraint directions; handles fast marbles on curved geometry; contacts, joints and soft coupling | Small substeps (see Small Steps below); fewer tuning knobs | Gauss–Seidel with fixed order or Jacobi; deterministic if ordered | Yes; shares code with cloth, grains and PBF |
| **Narrowphase / broadphase** | Spheres, capsules, boxes analytic. Convex hulls by SAT with clipping, or GJK + EPA (van den Bergen 2001, bibliographic listing only [BERGEN01]). Concave parts by approximate convex decomposition [COACD] or by simplified proxy geometry [HOU-RBD]. Blender's shape menu is Box, Sphere, Capsule, Cylinder, Cone, Convex Hull, Mesh (static) and Compound [BL-RB-C]. Broadphase: grid, sweep and prune, or BVH (public tutorials [TMP #23, #24]). | | | Hull + primitives first; decomposition later |
| **Position Based Dynamics** [PBD] | Predict `p = x + dt·v + dt²·a`; project constraints `Δp_i = −s·w_i·∇C`; `v = (p − x)/dt`. Unconditionally stable; Gauss–Seidel type iteration | O(N × constraints × iterations); stiffness depends on iterations and `dt` | Jacobi (order-free) or Gauss–Seidel in fixed order | Yes |
| **XPBD** [XPBD] | Adds compliance `α̃ = α/dt²` so stiffness no longer depends on iteration count or time step | same | same | Yes |
| **Small Steps** [SS19] | One XPBD iteration per substep with n substeps beats one step with n iterations (less constraint error and damping) | | | Yes (a policy, not code) |
| **Position Based Fluids** [PBF] | Density constraint `C_i = ρ_i/ρ0 − 1`; `λ_i = −C_i / (Σ|∇C|² + ε)`; artificial pressure term improves distribution and creates surface-tension-like effects; vorticity confinement and XSPH viscosity. Jacobi-style iterations. Paper's example: 128 k particles, 2 substeps, 3 density iterations, about 10 ms/frame on a 2012 GPU. | Larger steps than SPH. No CPU number in the paper. | Jacobi, so order-independent; neighbour lists must be sorted | Yes, 4–6 weeks including neighbour grid and surface extraction |
| **SPH** (SESPH/PCISPH/DFSPH) [SPH14] | CFL: `Δt ≤ λ·h/|v_max|`, λ ≈ 0.4. PCISPH allows ≥25× larger steps than SESPH. | On a 24-core 2008 Xeon: 130 k particles PCISPH 105 ms/step (SESPH 44 ms with its tiny steps); 1.7 M particles 1,379 ms/step [SPH11] | Index-sorted or compact-hash neighbour search; fixed order | Yes; PBF is simpler, so skip SPH at first |
| **FLIP / PIC / APIC** [BK][ZB05][APIC] | Particles carry the state; velocities transfer to a MAC grid for pressure projection and back. PIC is dissipative; FLIP is less dissipative but noisy and sometimes unstable; APIC keeps stability without FLIP's noise and conserves angular momentum. Houdini: FLIP is "Splashy," APIC "Swirly" [HOU-FLIP]. Per Houdini FLIP needs few steps per frame where SPH needs 7–20 or more [HOU-FLIP]. | Pressure solve (PCG) is the cost. Best quality for splashes | Fixed solver ordering; PCG reductions in fixed order | Possible but a large project (analysis): 8–12 weeks |
| **Stable fluids** [ST99] | Semi-Lagrangian advection (unconditionally stable) + pressure projection; buoyancy; vorticity confinement [FSJ01] | O(voxels) per step; 128³ = 2.1 M voxels | Deterministic if the solver iterates in fixed order | Yes, 3–5 weeks |
| **Fire** [NFJ02] | Incompressible Navier–Stokes with separate fuel and products; blackbody radiation shading and a blue core | | | Possible; a temperature-based simplification is easier |
| **Sparse grids** [VDB13] | Hierarchical, B+tree-like, separates values from topology; typical config: 8³ leaves under two levels of internal nodes. Public file-format description says only the 5-4-3 variant seems used [JFX] | Cheap storage and traversal for sparse gas | | Own simplified design is easy; reading `.vdb` files is not (§7) |
| **Granular** | PBD particles with friction [UPP] (the paper models gases, liquids, solids, rigid bodies and cloth with static and dynamic friction in PBD); DEM [CUND79]; FLIP sand [ZB05]; MPM Drucker–Prager [KLAR16] | PBD grains are cheap; MPM is hard | | PBD grains yes; skip MPM |
| **Cloth / ribbons** | XPBD stretch + bend [XPBD] + substeps [SS19] | Self-collision is the hard part [TMP #15] | | Yes without self-collision first |
| **Hair / strands** | Inextensible strands solved geometrically with a single iteration per frame; thousands of strands in real time [MKC12] | | | Yes |
| **Procedural droplets** | Poisson placement [PD07][YK15], growth, merge overlapping drops conserving volume, size laws from breath-figure scaling [BR] | Cheap | Fixed processing order | Yes |
| **Thin falling bodies** | Flutter, tumble or steady descent regimes [AP05] | | | Yes, a simple model |

### 3.2 Determinism contract for the simulator

All items are analysis unless a source is tagged.

1. **Fixed time step**, with a substep count that is independent of the display frame rate [FIX06]. Simulation time is derived from step count, never from a wall clock.
2. **Arithmetic:** `f32`, IEEE `+ − × ÷ sqrt`, and the engine's own `fmath` for sin/cos/exp/atan2. Box2D found `atan2f` differing across platforms and avoids fast-math and FMA for the same reason [BX24].
3. **RNG:** counter-based. Particle `i` uses `Pcg32::seeded(mix64(seed ^ i), stream)` or an equivalent hash of (seed, id, counter). Birth of particle `i` then never depends on thread order or on how many particles were born before.
4. **Parallelism:**
   - Fixed chunk partitions that do not depend on the thread count.
   - Jacobi-style updates (PBF is Jacobi by construction [PBF]).
   - Reductions in fixed tree order.
   - Neighbour lists sorted by (cell, id).
   - Contact lists merged in a fixed order, as Box2D does [BX24].
5. **Verification:** hash all particle/body transforms at a given step and compare across 1 vs N threads and native vs wasm. Box2D's "Falling Hinges" CI scenario checks the step at which everything sleeps plus a hash of body transforms across MSVC/Clang/GCC and x64/ARM [BX24]. CLAUDE.md rule 3 also demands that a test fail when a bug is reintroduced.
6. **No rollback determinism** is needed.
7. **Cache key** = hash of (effect parameters, referenced geometry and transforms, seed, engine version), so a cache can be deleted and rebuilt identically.

### 3.3 Stateless re-integration is not free (estimate)

- A non-interacting particle can be evaluated at any `t` by re-integrating from its birth.
- At an assumed 0.2–0.3 µs per particle-step (with curl noise) and 240 steps per second, a 5 s-old particle costs about 1,200 steps ≈ 0.3 ms.
- For 100 k particles that is about 30 s per evaluation, which is far too slow for scrubbing.
- So class A needs closed-form motion for simple forces, short lifetimes (under about 1 s), or periodic checkpoints. Otherwise bake it as class B.

---

## 4. Rendering requirements in a path tracer

| Representation | What rt-core needs | Cost / benefit on a CPU path tracer |
|---|---|---|
| **Instanced meshes** | Exists. Needs: compact instance-set section expanded inside the engine; per-instance variation seed/tint (today only `material_id` + `flags`); memory budget per worker; TLAS rebuild per frame is already supported (§1.1). Reference points: Disney's Moana Island scene has over 28 M instances of leaves, debris and rocks, over 15 B primitives when expanded [MOANA]; Embree has dedicated point and instance-array geometry types [EMB]. | Highest value. Covers beans, confetti, grains, droplets (approximately), scatter. Low-poly spheres give polygonal silhouettes and poor refraction. |
| **Spheres, points, capsules** | New primitive: analytic ray–sphere. Use the numerically stable formulation [RTG19]. Embree offers sphere, disc and oriented-disc points as precedent [EMB]. A swept sphere (capsule) approximates linear motion blur of a sphere in one primitive (analysis). | Cheap, memory-light (centre + radius), perfect silhouettes and refraction for droplets and bubbles. Do this early. |
| **Curves / strands** | New primitive, curve BVH and curve shading. Intersection options: pbrt's recursive subdivision of cubic Bézier curves with depth from control-point second differences [PBRTc]; the Phantom ray–hair intersector, an iterative cone approximation at two-thirds of ray–triangle speed on GPU, shown on 400 k–1.6 M curves [PHAN]. Embree supports flat, normal-oriented, round and cone curves in several bases [EMB]. Types: flat faces the ray (hair), cylinder fakes a cylindrical normal, ribbon keeps a fixed orientation (grass blades) [PBRTc]; KeyShot offers Ribbon or Cylinder [KS-FUZ]. Shading: simple diffuse plus specular lobe first; Marschner [MJC03] or Chiang's production fibre model later [CH16]. | Largest engine feature. Thin diagonal curves make poor BVH boxes; subdividing curves gives tighter boxes [PBRTc]. Pragmatic stepping stone: bake strands as thin ribbon triangle strips into the existing mesh path (analysis), costly in memory for 100 k+ strands. |
| **Volumes (heterogeneous media)** | Medium interface/stack on rays; homogeneous medium with analytic free-flight; heterogeneous with a majorant grid + DDA walk [PBRTv][AW87], delta/ratio tracking [VOL18]; Henyey–Greenstein phase [HG41]; emission from temperature as blackbody [PBRTv]. pbrt reports good performance with about 64–256 voxels per side for the majorant grid [PBRTv]. For MIS-compatible null-collision estimators, use the null-scattering path integral [NS19]. Cycles defaults to null scattering and offers a biased ray-march alternative [BL-CY]. Blender's Principled Volume bundles scattering, absorption and blackbody emission [BL-PV]. | Several times the cost of surface paths, and noisier. Memory: 128³ f32 = 8.4 MB, 256³ = 67 MB per field per frame (arithmetic). Start homogeneous (god rays, haze), then procedural density, then grids. |
| **Liquid surfaces** | Dielectric meshes from particles: marching cubes [LC87] of an implicit surface built with anisotropic kernels from PCA over neighbours [YT13]. Alternative: instanced droplets (beady). Needs glass (E5) and nested dielectrics for liquid in a glass or bubbles in liquid [ND02]. Caustics through droplets are noisy with small lights; manifold next-event estimation addresses refractive caustics [MNEE15]. | Reconstruction is expensive: 1.69 s per frame for 23 k particles on a 2010-era laptop, and up to 15–18 minutes per frame at about 10 M particles [YT13]. For 100–500 k particles expect seconds per frame (estimate). |
| **Motion blur** | Add a time sample per ray (an extra sampler dimension); instances carry start and end transforms interpolated by the ray's time; TLAS bounds = union over the shutter. Reeves notes particles are easy to motion-blur [R83]; distributed ray tracing introduced it for ray tracers [DRT84]. MSBVH is a known solution but there are patent filings [MSBVH]; avoid copying it. | Fast particles make loose bounds. Capsules (above) avoid it for streaks. |
| **Emissive particles** | Camera-visible emission flag without light sampling. For illuminating emitters at scale, a light BVH (adaptive tree splitting) [CK18]. | Fireflies, bokeh and sparks rarely need to light the scene; avoid NEE over 100 k emitters. |
| **Thin shells** (petals, paper) | Two-sided diffuse transmission material | Uses existing mesh path. |

---

## 5. Configuration and UX

### 5.1 How other tools present it (public docs)

| Tool | Pattern |
|---|---|
| **Blender** (emitter particles) | Panels: Emission (Number, Seed, Frame Start/End, Lifetime, Lifetime Randomness) [BL-EM]; Source: Emit From Vertices/Faces/Volume, Distribution Jittered/Random/Grid, Even Distribution [BL-EM]; Velocity: Normal, Tangent, Object, Randomize [BL-VEL]; Rotation: orientation axis, Randomize, angular velocity [BL-ROT]; Physics: Brownian, Drag, Damp, integrator, Timestep, Subframes [BL-NEWT]; Render: instance Object or Collection, Pick Random, Scale Randomness [BL-REN]. Rigid body: collision shape, friction, bounciness, margin, damping, deactivation thresholds [BL-RB-C][BL-RB-D]; world: Speed, Substeps Per Frame, Solver Iterations, bake cache [BL-RB-W]. Fluid domain: Resolution Divisions; Time Scale, where higher values are "good for generating fluids to be used in still renders" [BL-FLU]. Geometry nodes: Distribute Points on Faces (Random or Poisson Disk, Distance Min, Density, Seed) [BL-DIST] and Instance on Points [BL-INST]. |
| **Houdini** | POP Source: All Points / Points / Scatter onto Surfaces, emission attribute weights, relax iterations for even spacing [HOU-POP]. POP Grains: PBD sphere interaction; under-enforced constraints show as bounce unless substeps or iterations increase [HOU-GR]. Pyro: "Initialize Smoke / Fire / Explosion" quick setups [HOU-PYRO]. FLIP: substeps, reseeding, droplets, vorticity, surface tension [HOU-FLIP]. RBD: proxy geometry input, sleeping [HOU-RBD]. |
| **Unreal Niagara** (4.27 pages) | Staged emitters: System Spawn, Emitter Spawn, Emitter Update; modules run top to bottom; a Spawn Burst Instantaneous module [NIA-EU][NIA-ES]. |
| **Cinema 4D X-Particles** | xpSystem (hub), xpEmitter (data only), xpGenerator (turns particles into objects; "Geometry on Render Only" speeds the viewport); modifiers xpGravity, xpTurbulence, xpWind, xpAttractor, xpKill [XP-SYS][XP-EM][XP-GEN]. |
| **KeyShot** | Material-attached geometry nodes with Size/Variation/Density/Limit/Seed [KS-BUB][KS-FLK][KS-FUZ]; a simulation dialog that records a result to the timeline [KS-PHYS]; manual refresh of heavy nodes (Alt+G) [KS-GN]. |

Take-aways for this product:
- Preset-first with a few knobs matches KeyShot and Houdini's quick setups.
- The "limit in millions" and manual "execute" patterns are precedent for protecting the user from runaway counts.
- Separate "data" from "geometry" in the viewport (X-Particles) is the preview-versus-render split proposed below.

### 5.2 Proposed model: one scene node type, "Effect"

All proposals (names, structure) are for Fable to ratify (CLAUDE.md rules 11, 12).

- A new scene node, **Effect**, with Type and Preset. The animation wizard in `SPEC.md` §3.7 already uses a grid of grouped cards, so reuse that pattern.
- Three levels of UI:
  1. **Preset gallery** (cards).
  2. **Eight "photographer" sliders:** Amount, Size, Energy (speed), Chaos (spread + turbulence), Wind, Gravity, Variation, Seed.
  3. **Advanced** (collapsed), exposing the raw parameter set below.
- Effects appear as a **bar on the timeline**, one track per target, like animations.
- The data catalogue lives in a new `src/data/effects.ts` with stable uppercase keys like `MOVE_KINDS` (rule 7). The engine side would be a new zero-dependency crate (working name `rt-sim`), reusing `fmath`, `rng` and `Transform`.
- Parameters live in `ProjectState`, edits go through the store and are undoable. Caches are derived data outside undo (rules 6, 10).

### 5.3 Minimal coherent parameter set

| Group | Parameters |
|---|---|
| **Where** | Source: Point / Part surface / Part volume / Edge or curve / Box-Disc-Sphere / Scene bounds. Source parts via the existing level-based selection. Direction: Normal / Up / Down / Outward / Axis. Spread°. |
| **When** | Mode: Continuous / Burst / Fill (pre-populated) / Single drop. Start, Duration. Count or Rate, with a Max cap. Pre-roll. Loop. (Reeves's mean ± variance maps to every "value ± Variation" pair [R83].) |
| **Pieces** | Shape: Dot / Sphere / Disc-Flake / Streak / Parts from the scene (list with weights). Size (mm) + Variation. Lifetime + Variation. Spin + Variation. Stretch with speed. Material: from source / assigned / random from list. Tint variation. |
| **Motion** | Initial speed + Variation. Gravity (multiple of g). Air drag. Wind. Turbulence (strength, scale, speed; curl noise). Extra forces: attractor, vortex. Flutter (thin pieces). |
| **Collide** | Collide with: Ground / Selected parts / Everything. Bounce. Friction. On contact: Bounce / Settle / Stick / Kill. Pieces collide with each other (on/off). Shape quality: Fast / Accurate. |
| **Time and cache** | Seed (with a shuffle button). **Freeze at** (seconds). Quality (steps per second). Settle until rest, with a maximum time. Bake / Clear. Cache status badge. |
| **Preview and render** | Viewport shows Dots / Proxies / Full. Preview % of particles. Motion blur on/off. Visible to camera / reflections / shadows (like lights). Hide emitter. |
| **Type-specific** | *Droplets:* Coverage, Size range, Contact angle, Run-off, Wetness. *Scatter:* Density or Count, Min distance, Align to normal, Random tilt, Mask. *Gas:* Resolution, Dissipation, Buoyancy, Turbulence, Heat, Vorticity. *Liquid:* Particle size (resolution), Viscosity, Surface tension, Foam. *Strands:* Length, Density, Radius, Segments, Randomness, Max strands, Shape Ribbon/Cylinder (mirrors Fuzz [KS-FUZ]). |

### 5.4 Preset list (generic names; Spanish in parentheses)

Starting values are Fable's photographic decision (rule 11). I give none.

| Group | Presets |
|---|---|
| Ambient | Dust Motes (Motas de polvo), Pollen (Polen), Haze (Calima), Light Shafts (Haces de luz), Ground Fog (Niebla baja), Steam (Vapor), Mist (Bruma), Perfume Spray (Pulverizador) |
| Surface | Condensation (Condensación), Dew (Rocío), Water Beads (Gotas), Running Drops (Gotas que resbalan), Frost (Escarcha) |
| Scatter | Scatter on Surface (Dispersar en superficie), Scatter in Volume (Dispersar en volumen), Sprinkles (Grageas), Pebbles (Guijarros), Grass (Hierba), Fur (Pelo), Bristles (Cerdas) |
| Drop and settle | Drop Pile (Caída y reposo), Beans (Granos), Pills (Pastillas), Ice Cubes (Cubitos de hielo), Grains (Granos finos), Ingredients (Ingredientes) |
| Burst | Powder Burst (Explosión de polvo), Colour Burst (Explosión de color), Confetti Pop (Confeti), Petal Shower (Lluvia de pétalos), Glitter Burst (Purpurina), Sparks (Chispas) |
| Liquid | Splash Crown (Corona de salpicadura), Fruit Splash (Salpicadura de fruta), Pour (Vertido), Ripples (Ondas), Fizz (Burbujas), Foam (Espuma), Drips (Goteo) |
| Weather | Rain (Lluvia), Snow (Nieve), Hail (Granizo), Leaves in Wind (Hojas al viento) |
| Light | Fireflies (Luciérnagas), Bokeh Lights (Luces bokeh), Embers (Brasas), Sparkle Trail (Estela brillante), Candle Flame (Llama) |
| Float | Levitation (Levitación), Orbiting Pieces (Piezas en órbita), Zero-G Ingredients (Ingredientes sin gravedad) |
| Soft | Cloth Drape (Tela sobre pieza), Ribbon Flow (Cinta), Paper Fall (Papel) |

### 5.5 Freeze, bake, cache and timeline

- **Freeze at** (photographer's "moment"): the effect time used for a still. For class A it evaluates directly. For class B it bakes up to that time.
- **Find the moment:** a scrub bar over the baked cache with a preview; "Use this frame" sets Freeze.
- **Cache:**
  - Key = parameter hash (§3.2). Cache files live next to the project.
  - The meter shows real engine numbers: particles alive, steps, bake time. Never invented values (rule 10).
  - A badge shows "cache valid / needs re-bake".
  - Bake runs as a job in the render queue, and rendering an animation depends on it.
- **Edit the result:** "Bake to scene" turns instances into regular parts, as KeyShot records a simulation into keyframes [KS-PHYS]. "Pin" keeps hand-placed pieces fixed, keyed by stable particle id (analysis).
- **Variations:** a gallery of 4–6 low-sample previews with different seeds (analysis).
- **Preview versus render:**
  - The fast viewport (three.js `InstancedMesh` or points) draws proxies from the same simulation output. Run the simulator in wasm so preview and render agree.
  - Volumes and strands show bounding proxies with a "render to see" note.
  - The engine path-traces the real representation.

---

## 6. Phased plan (proposed; IDs S1+ are free in the roadmap)

Effort is one experienced engineer in calendar weeks (estimate). Model assignment follows the ROADMAP convention: Fable decides, Opus builds engine, Sonnet ports and does UI, Haiku does maintenance.

| Phase | Scope | Depends on | Effort / risk |
|---|---|---|---|
| **S0** Decision memo (Fable) | Where the simulator lives (new zero-dependency crate compiled to wasm for the UI and native for `rt`); stateless-vs-baked time model; cache file format; RSB sections; preset scope and visual language; whether to read `.vdb` (§7). | none | 2 days |
| **S1b** Baked-cache import (Sonnet) | Import OBJ/PLY sequences and glTF `EXT_mesh_gpu_instancing` (translation/rotation/scale accessors [GLTF]). Gives "every kind" of effect immediately through Blender/Houdini. KeyShot's own route for third-party sims is Alembic [KS-ANI]. | I1 importers | 1–2 weeks. Low risk |
| **S1** Scatter + instance sets (Opus engine, Sonnet UI) | Compact instance-set section expanded inside the engine; per-instance seed/tint; memory limits per worker; Poisson-disk and random placement on triangles with density maps [PD07][YK15]; Scatter effect UI; `InstancedMesh` preview. | none | 3–4 weeks. Risk: per-worker memory in browser; TLAS build time for 1 M |
| **S2** Drop and settle (Opus) | Rigid bodies: sphere/box/capsule/hull/compound/static triangle mesh/plane; XPBD or sequential impulses; sleeping; friction/restitution; substeps. UI = KeyShot parity (Simulation Time with 0 = until settled, Quality, Gravity, Friction, Bounciness, As Parts [KS-PHYS]) plus Seed and Freeze. | S1 | 6–9 weeks. Risk: contact robustness, stacking, tunnelling of small pieces, concave parts; start single-threaded |
| **S3** Droplets and condensation | Sphere primitive; procedural generator (nucleation, growth, coalescence, run-off); spherical-cap instances; dielectric material; LOD to normal map. | S1, E5 glass | 3–4 weeks. Risk: caustic noise; wet-look appearance |
| **S4** Stateless emitters + time-aware rays | Forces, curl noise [CN07], ray-cast collisions, lifetime; capsule primitive; motion blur; emissive no-NEE flag. Presets: Dust Motes, Sparks, Fireflies, Bokeh, Confetti, Rain, Snow. | S1 | 5–7 weeks. Risk: motion-blur bounds; sub-pixel particle noise |
| **S5** Volumes v1 | Medium stack; homogeneous fog and god rays; procedural heterogeneous density; majorant grid + DDA; delta/ratio tracking; HG phase; blackbody emission. | none | 6–9 weeks. Risk: CPU noise and time; wasm speed |
| **S6** Gas simulation | Stable-fluids smoke/steam/fire; particle-to-volume; compressed cache (f16 or sparse); render via S5. | S5 | 6–8 weeks. Risk: cache size and bake time in wasm. Example: 128³ f16 density ≈ 4 MB/frame; 4 s at 30 fps ≈ 0.5 GB (arithmetic) |
| **S7** Liquids | PBF [PBF] + diffuse spray/foam/bubbles [FOAM12] + marching cubes surface; presets Splash Crown, Pour, Fizz. | E5, nested dielectrics | 8–12 weeks. Risk: realism of crowns; reconstruction time |
| **S8** Strands | Curve primitive, BVH and shading (Fuzz parity [KS-FUZ]), then grooming and strand dynamics [MKC12]. | S1 | 8–12 weeks. Risk: BVH quality for thin curves; wasm speed |
| **S9** Soft bodies | XPBD cloth and ribbons [XPBD][SS19]. | S2 | 4–6 weeks. Risk: self-collision |
| **S10** Upgrades (optional) | FLIP/APIC [APIC]; sparse grid; anisotropic reconstruction [YT13]. | S7 | 8–12 weeks |

### Targets (proposals, not measurements)

- **Determinism:** identical hash for 1 vs N threads and native vs wasm on every effect, as part of the existing test suite.
- **S1:** 100–250 k instances per worker in-browser, millions natively.
- **S2:** a 1,000-body settle in under about 20 s single-threaded natively.
- **Sampling cost:** at most about 1.5× baseline time per sample for 1 M instances.

---

## 7. Risks, open questions and source caveats

**Open decisions for Fable:**
- Simulator location, time model, cache format, and the E8 question of how `rt` renders an animation.
- Whether volumes can read `.vdb`. OpenVDB has no formal file-format specification; a public write-up exists [JFX] but it describes the codebase, so check the clean-room rules before relying on it. Safer: own volume format plus an importer for simpler formats.
- Whether to use MIS-capable null-scattering estimators [NS19] from the start.
- A patent check before any MSBVH-like motion-blur structure [MSBVH].

**Verification gaps in this research:**
- KeyShot 2024–2026 manuals were mostly unreadable; the "no native particles or Scatter" finding rests on the KeyShot 11 manual, the 2024 physics page and release-note summaries.
- Secondhand or abstract-level only: Gunn & Kinzer [GK49] citation details; Beysens/Family–Meakin scaling [BR]; Cundall–Strack [CUND79]; Garg–Nayar [GN06]; Fearing [FE00]; Edgerton [ED57]; Liger-Belair [LB08]; Yarin [YA06]; van den Bergen EPA (bibliography entry only); Klár et al. [KLAR16].
- Not re-verified this session: the JVCIR 2007 record for PBD; the Phantom paper's venue (HPG'18 versus PACMCGIT).
- Hardware numbers in the papers are from 2008–2013 machines and GPUs; CPU/wasm projections above are estimates.
- Reading permissive open-source physics or renderer code is allowed by the README's clean-room rule 3, but the engine rule is "no external code at all." I used papers and public docs only.

---

## 8. References

**Papers and books**

- [R83] Reeves 1983, Particle Systems: https://www.cs.princeton.edu/courses/archive/spr15/cos426/papers/Reeves83.pdf
- [CN07] Bridson, Hourihan, Nordenstam, Curl-Noise: https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph2007-curlnoise.pdf
- [PBD] Müller et al., Position Based Dynamics (VRIPHYS 2006): https://matthias-research.github.io/pages/publications/posBasedDyn.pdf
- [PBF] Macklin & Müller, Position Based Fluids: https://mmacklin.com/pbf_sig_preprint.pdf
- [XPBD] Macklin, Müller, Chentanez: https://mmacklin.com/xpbd.pdf
- [SS19] Macklin et al., Small Steps in Physics Simulation: https://mmacklin.com/smallsteps.pdf
- [RB20] Müller et al., Detailed Rigid Body Simulation with XPBD: https://matthias-research.github.io/pages/publications/PBDBodies.pdf
- [UPP] Macklin et al., Unified Particle Physics: https://mmacklin.com/uppfrta_preprint.pdf
- [ST99] Stam, Stable Fluids: https://cgweb.informatik.uni-freiburg.de/intern/seminar/gridFluids_StableFluids.pdf
- [FSJ01] Fedkiw, Stam, Jensen, Visual Simulation of Smoke: https://graphics.stanford.edu/papers/smoke/
- [NFJ02] Nguyen, Fedkiw, Jensen, Fire: https://graphics.stanford.edu/papers/fire-sg02/
- [ZB05] Zhu & Bridson, Animating Sand as a Fluid: https://www.cs.ubc.ca/~rbridson/docs/zhu-siggraph05-sandfluid.pdf
- [APIC] Jiang et al., Affine Particle-In-Cell: https://www.math.ucdavis.edu/~jteran/papers/JSSTS15.pdf
- [KLAR16] Klár et al., Drucker–Prager sand: https://math.ucdavis.edu/~jteran/papers/KGPSJT16.pdf
- [BK] Bridson, Fluid Simulation for Computer Graphics, 2nd ed.: https://www.routledge.com/Fluid-Simulation-for-Computer-Graphics/Bridson/p/book/9781482232837
- [SPH14] Ihmsen et al., SPH Fluids in Computer Graphics (STAR): https://cg.informatik.uni-freiburg.de/publications/2014_EG_SPH_STAR.pdf
- [SPH11] Ihmsen et al., Parallel SPH on multi-core CPUs: https://cg.informatik.uni-freiburg.de/publications/2011_CGF_dataStructuresSPH.pdf
- [FOAM12] Ihmsen, Akinci, Akinci, Teschner, Unified spray, foam and bubbles: https://cg.informatik.uni-freiburg.de/publications/2012_CGI_sprayFoamBubbles.pdf
- [YT13] Yu & Turk, anisotropic kernels: https://faculty.cc.gatech.edu/~turk/my_papers/particle_surfaces_tog.pdf
- [LC87] Lorensen & Cline, Marching cubes: https://courses.cs.duke.edu/cps124/fall01/resources/p163-lorensen.pdf
- [PHAN] Reshetov & Luebke, Phantom Ray-Hair Intersector: https://research.nvidia.com/publication/2018-08_phantom-ray-hair-intersector
- [VOL18] Novák et al., Monte Carlo methods for volumetric light transport: https://cs.dartmouth.edu/wjarosz/publications/novak18monte.html
- [NS19] Miller, Georgiev, Jarosz, null-scattering path integral: https://cs.dartmouth.edu/wjarosz/publications/miller19null.html
- [VDB13] Museth, VDB: https://research.dreamworks.com/wp-content/uploads/2018/08/Museth_TOG13-Edited.pdf
- [PBRTv] pbrt-v4 §11.4 Media: https://www.pbr-book.org/4ed/Volume_Scattering/Media
- [PBRTc] pbrt-v4 Curves: https://www.pbr-book.org/4ed/Shapes/Curves
- [AW87] Amanatides & Woo, voxel traversal: https://www.eecs.yorku.ca/~amana/research/grid.pdf
- [HG41] Henyey & Greenstein: https://articles.adsabs.harvard.edu/pdf/1941ApJ....93...70H
- [RTG19] Haines, Günther, Akenine-Möller, ray/sphere precision: https://research.nvidia.com/publication/2019-03_precision-improvements-raysphere-intersection
- [EMB] Embree geometry types: https://www.mankier.com/3/rtcNewGeometry.3embree4
- [CH16] Chiang et al., hair and fur model: https://diglib.eg.org/handle/10.1111/cgf12830
- [MJC03] Marschner et al., hair fibres: https://graphics.stanford.edu/papers/hair/
- [MKC12] Müller, Kim, Chentanez, inextensible hair: https://diglib.eg.org/items/11db9962-07b8-46a1-ab46-ecc9ee05086d
- [CAT06] Catto, Sequential Impulses: https://box2d.org/files/ErinCatto_SequentialImpulses_GDC2006.pdf
- [BX24] Catto, Box2D determinism: https://box2d.org/posts/2024/08/determinism/
- [FIX06] Fiedler, Fix Your Timestep: https://gafferongames.com/post/fix_your_timestep/
- [BERGEN01] van den Bergen EPA (bibliography entry): https://history.siggraph.org/?p=113230
- [COACD] Wei et al., CoACD: https://arxiv.org/pdf/2205.02961
- [CUND79] Cundall & Strack: https://www.citedrive.com/en/discovery/a-discrete-numerical-model-for-granular-assemblies/
- [PD07] Bridson, Poisson disk sampling: https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph07-poissondisk.pdf
- [YK15] Yuksel, sample elimination: https://cemyuksel.com/research/sampleelimination/
- [GN06] Garg & Nayar, rain streaks: https://history.siggraph.org/?p=113590
- [GK49] Gunn & Kinzer, terminal velocity (secondhand): https://glossary.ametsoc.org/wiki/terminal-fall-velocity/
- [FE00] Fearing, fallen snow: https://www.cs.ubc.ca/labs/imager/th/2000/Fearing2000/
- [AP05] Andersen, Pesavento, Wang, falling plates: https://dragonfly.tam.cornell.edu/publications/2005_JFM_Andersen_Pesavento_Wang_a.pdf
- [YA06] Yarin, drop impact: https://pure.korea.ac.kr/en/publications/drop-impact-dynamics-splashing-spreading-receding-bouncing/
- [ED57] Edgerton, Milk Drop Coronet: https://www.scientificamerican.com/article/how-the-motion-of-a-milk-drop-was-captured-in-1957/
- [LB08] Liger-Belair et al., champagne bubbles: https://pubs.rsc.org/en/Content/ArticleLanding/2008/CS/B717798B
- [BR] Breath-figure size distributions (Family & Meakin scaling): https://arxiv.org/html/2110.00691
- [ND02] Schmidt & Budge, nested dielectrics: https://core.ac.uk/works/152771729
- [MNEE15] Hanika, Droske, Fascione, manifold NEE (citation): https://dblp.uni-trier.de/pid/09/4751.html
- [CK18] Conty Estevez & Kulla, many lights: https://history.siggraph.org/?p=84225
- [DRT84] Cook, Porter, Carpenter, Distributed Ray Tracing: https://graphics.pixar.com/library/DistributedRayTracing
- [MSBVH] Grünschloß et al., MSBVH: https://diglib.eg.org/items/adff081b-c6d0-44fd-be43-21e479b2b1c1 (patent: https://patents.google.com/patent/US9430863)
- [MOANA] Disney Moana Island Scene: https://disneyanimation.com/resources/moana-island-scene/
- [JFX] VDB file-format deep dive: https://jangafx.com/insights/vdb-a-deep-dive
- [TMP] Ten Minute Physics tutorials (no licence stated on the page): https://matthias-research.github.io/pages/tenMinutePhysics/
- [GLTF] glTF `EXT_mesh_gpu_instancing`: https://cesium.com/learn/cesium-native/ref-doc/structCesiumGltf_1_1ExtensionExtMeshGpuInstancing.html
- [Perlin02] Perlin, Improving Noise (cited within [CN07])
- [XP-2012] X-Particles 2012 generators: https://www.cgchannel.com/2012/02/get-xparticles-xpresso-free-particle-sims-for-cinema-4d

**Public tool documentation**

- [KS-PHYS] https://manuals.keyshot.com/keyshot2024/manual/physics-simulation.html
- [KS-SETTLE] https://www.keyshot.com/blog/keyshot-tutorial-collision-detection/
- [KS-GN] https://manual.keyshot.com/keyshot11/manual/materials/material-graph/material-graph-nodes/geometry-node-types/
- [KS-BUB] …/geometry-node-types/bubbles/
- [KS-FLK] …/geometry-node-types/flakes/
- [KS-FUZ] …/geometry-node-types/fuzz/
- [KS-SM] https://manual.keyshot.com/keyshot11/manual/materials/material-types/advanced-material/scattering-medium/
- [KS-VM] https://manual.keyshot.com/keyshot11/manual/textures/texture-types/3d-textures/volume-map/
- [KS-ANI] https://manual.keyshot.com/keyshot11/manual/animation/animation-types/
- [KS-WWA] https://manual.keyshot.com/keyshot11/manual/animation/working-with-animations/
- [BL-EM] https://docs.blender.org/manual/en/latest/physics/particles/emitter/emission.html
- [BL-VEL] …/emitter/velocity.html
- [BL-ROT] …/emitter/rotation.html
- [BL-REN] …/emitter/render.html
- [BL-NEWT] …/emitter/physics/newtonian.html
- [BL-RB-C] https://docs.blender.org/manual/en/latest/physics/rigid_body/properties/collisions.html
- [BL-RB-D] …/rigid_body/properties/dynamics.html
- [BL-RB-W] …/rigid_body/world.html
- [BL-FLU] https://docs.blender.org/manual/en/latest/physics/fluid/type/domain/settings.html
- [BL-DIST] …/modeling/geometry_nodes/point/distribute_points_on_faces.html
- [BL-INST] …/modeling/geometry_nodes/instances/instance_on_points.html
- [BL-PV] https://docs.blender.org/manual/en/latest/render/shader_nodes/shader/volume_principled.html
- [BL-CY] https://docs.blender.org/manual/en/latest/render/cycles/render_settings/volumes.html
- [HOU-POP] https://www.sidefx.com/docs/houdini/nodes/dop/popsource.html
- [HOU-GR] https://www.sidefx.com/docs/houdini/nodes/dop/popgrains.html
- [HOU-FLIP] https://www.sidefx.com/docs/houdini/nodes/dop/flipsolver.html
- [HOU-PYRO] https://www.sidefx.com/docs/houdini/nodes/sop/pyrosolver.html
- [HOU-VEL] https://www.sidefx.com/docs/houdini/nodes/sop/vellumsolver.html
- [HOU-RBD] https://www.sidefx.com/docs/houdini/nodes/sop/rbdbulletsolver.html
- [NIA-EU] https://docs.unrealengine.com/4.27/RenderingAndGraphics/Niagara/EmitterReference/EmitterUpdate
- [NIA-ES] https://docs.unrealengine.com/4.27/RenderingAndGraphics/Niagara/EmitterReference/EmitterSpawn
- [XP-SYS] https://docs.insydium.ltd/x-particles/xpsystem
- [XP-EM] https://docs.insydium.ltd/x-particles/xpemitter/
- [XP-GEN] https://docs.insydium.ltd/x-particles/generators/xpgenerator/

**Repo files read**

`/home/user/Repackshot/CLAUDE.md`, `README.md`, `docs/ARCHITECTURE.md` (§5), `docs/SPEC.md` (§3.7), `docs/ROADMAP.md` (E5, E8, N1), `engine/crates/rt-core/src/{lib,fmath,rng,geometry/mod,geometry/bvh,geometry/transform,scene/rsb,render}.rs`.