# Interiors and furniture — research and integration decision

What Repackshot needs in order to render **furniture in context**
(a sofa in a living room lit by a window, a kitchen with lamps)
and **furniture catalogues** (cut-outs on white, fabric variants,
elevations), and how it fits into the product without breaking its idea: a single
interface, a contextual inspector, one *Render* button, black-and-white
chrome. It is a decision document by the lead, built from two
investigations (product and technical) with public sources; the phases
that come out of this are in `ROADMAP.md` as **K1–K8**.

---

## 1 · Summary and decision

**There will be no "interiors mode".** It is integrated the way the
renderers that do it well do it: a **scene type** (*Product ·
Interior · Catalogue*) that only changes default values, a
**room** as one more node of the scene, **windows that light the scene by themselves**
(automatic portals, no jargon), an **interiors camera** (straight
verticals, eye height, panorama), a **Doctor** that detects the classic
beginner mistakes, and an engine with the four or five techniques that
really matter in enclosed scenes. All with the same controls and in the
same place; what changes is what comes preset.

What is not done: ReSTIR, bidirectional, Metropolis, radiance caches,
neural *denoise* networks. They do not deliver on CPU/wasm what they promise on GPU
and do not repay their cost when built from scratch (see §4).

---

## 2 · What others do (black-box observation)

**KeyShot** treats interiors as a *preset* of the lighting panel
(*Performance, Basic, Product, Interior, Jewelry*): *Interior* is
"optimized for interior lighting", samples HDRIs with small, intense
sources such as sun and sky better, and uses a different sample
distribution from *Product*
([manual](https://manuals.keyshot.com/kss2026/en-us/manual/lighting.html),
[presets](https://manuals.keyshot.com/kss2026/en-us/manual/custom-lighting-presets.html)).
Lights are **materials** applied to geometry (area, point, IES,
spot, emissive) in lumens, watts or lux, with the warning that the model must
be at real-world scale
([blog](https://www.keyshot.com/blog/how-to-create-and-use-physical-lights-in-keyshot/)).
Windows are solved with a plane behind them that carries the view as
a label
([blog](https://www.keyshot.com/blog/how-to-create-perfect-window-views-for-interior-sces-in-keyshot/)).
The camera has a *Shift* lens for two-point perspective with
*Estimate vertical shift*
([manual](https://manuals.keyshot.com/kss2025/en-us/manual/shift.html)),
a *walkthrough* mode and a 2:1 panoramic lens
([cameras](https://manual.keyshot.com/manual/cameras/)). For interiors
with sun and sky it recommends the *Low Contrast* curve
([manual](https://manual.keyshot.com/?p=5600)). It has no room
builder: a room is imported or staged as an always-visible *Model Set*.
An independent benchmark puts an interior at about 500 samples at
2K against 100 for a simple studio
([Visune](https://visune.io/blogs/articles/keyshot-output-settings-what-should-you-use-in-2025)).

**V-Ray and Corona**: what people praise is *LightMix* (changing
the intensity and colour of each light **after** rendering, and pulling the day and night
variants out of a single render), automatic exposure and white balance,
and the adaptive environment samplers that have made manual portals
almost unnecessary
([Chaos](https://blog.chaos.com/architectural-rendering-basics-interiors),
[CG Channel](https://www.cgchannel.com/2020/09/chaos-czech-releases-corona-renderer-6-for-3ds-max),
[Novedge](https://novedge.com/blogs/design-news/v-ray-tip-portal-lights-and-adl-optimize-daylight-interior-sampling)).
The first step of their interiors workflow is the camera clip, so that
you can see inside the room.

**Cycles**: area lights marked as *portal* over the openings
"greatly reduce noise in interiors" (slower per sample, converge
sooner, useless outdoors); light tree; camera *shift*
equivalent to rendering a larger field and cropping off-centre, which keeps
the verticals; *clamping*, *filter glossy* and path guiding for
rooms lit through a door
([lights](https://docs.blender.org/manual/en/4.5/render/cycles/light_settings.html),
[sampling](https://docs.blender.org/manual/en/4.5/render/cycles/render_settings/sampling.html),
[cameras](https://docs.blender.org/manual/en/4.5/render/cameras.html)).
Catch: portals and the light tree are expert controls.

**Enscape, Twinmotion, D5, Lumion** (real time for architecture):
asset libraries, sun by time of day, automatic exposure "when going from
interior to exterior", *exterior / mixed / interior* quality presets,
batch 360 panoramas, orthographic views in one click
([Enscape](https://www.chaos.com/enscape/features),
[Twinmotion](https://dev.epicgames.com/documentation/twinmotion/ambience-settings)).
Catches: no velvet or rugs, less faithful light, GPU dependence.

**Furniture CGI studios**: their deliverables are cut-outs on white
(with alpha), cut-outs with dimensions, *lifestyle hero*, colour change
(*colourways*), inspirational, details, 360, video
([list](https://files.cgifurniture.com/uploads/cgi-content-checklist.pdf),
[types](https://cgifurniture.com/blog/lifestyle-shots-6-types/)). One
manufacturer makes its new-product renders "in a few hours" with KeyShot
([case](https://www.keyshot.com/customers/ki-used-keyshot-to-cut-100k-furniture-rendering-costs/)).

**What always goes wrong**: scale and units (SketchUp 2026 exports
FBX ×1000; glTF is metres and Y-up), lenses that are too wide,
rooms that are too dark for fear of overexposing, windows burnt out by
accident, lamps switched on in daytime, too many physical lights (*fireflies*)
([Poliigon](https://www.blog.poliigon.com/blog/7-mistakes-in-lighting-archviz),
[KeyShot](https://support.keyshot.com/en/knowledge-base/how-to-resolve-firefly-lights-in-keyshot-scenes),
[SketchUp thread](https://forums.sketchup.com/t/sketchup-2026-fbx-export-model-units-problem/347178)).

---

## 3 · Product decisions

### 3.1 · Scene type, not mode

`scene.type ∈ {PRODUCT, INTERIOR, CATALOGUE}`, in the *Product* section
of the inspector, above the product type. Changing it rewrites **default
values** and leaves all the controls where they are:

| | Product (today) | Interior | Catalogue studio |
| --- | --- | --- | --- |
| Environment | studio dome | sun and sky through the window, or an interior HDRI | white dome, cyclorama |
| Bounces | 8–12 | 16–24 | 8 |
| Caustics | AUTO | OFF | OFF |
| Floor shadow | contact | none of its own (the room provides it) | soft contact |
| Transform | Standard / AgX | AgX with a long shoulder, *Low contrast* | Standard |
| Exposure | fixed (preset EV) | **automatic** + EV dial | fixed |
| Target samples | 256 | 512 + adaptive + *denoise* | 256 |
| Camera | 85–100 mm, three-quarter | 28 mm, eye height 1.5 m, straight verticals | 50 mm, elevation or three-quarter |
| Units shown | mm | m and cm | mm |

**Done in K1** (`ROADMAP.md`): `scene.type`, with its default values
applied when the type is changed, the rows that exist today (environment, bounces,
caustics, floor shadow, transform, samples with adaptive and
*denoise*, focal length). Still not applied, because they wait for their phase or are not part of
the project: the cyclorama (K2), automatic exposure and the EV dial, eye
height and straight verticals (K3), the long shoulder and *Low contrast*,
and the units shown (an application preference).

**Done in K3**: *Interior* turns on **automatic exposure** and the
**straight verticals** of the active camera, as two more checkboxes of the
same mechanism (`image.exposureMode` and `camera.verticals:<id>`), and
switching type back leaves them as they were. **Eye height is not** applied
when changing type: moving the camera to 1.5 m changes the framing that the
K1 checks measure and the round trip of those tests no longer
added up; it stays as presets in the inspector (◆ lead, `ROADMAP.md` K3).

### 3.2 · The room is a node

A parametric `ROOM` node (phase K2), with the minimum that real workflows
ask for: width, depth and height; **openings** (window or door) with
position, size and sill; one **material per surface** (floor,
walls, ceiling); optional skirting board; **hiding the wall on the camera
side** in one click (Chaos's "camera clip", done without thinking
about clipping planes); and a **cyclorama** variant for catalogues (a floor
that curves up into a white wall, like the infinite sweep of the
primitives, `src/core/primitives.ts`). It is edited in the inspector like
any part and saved in the project. Importing a room made elsewhere is still valid: it is
what professionals do (§2), and the opening detection and the rest of what
follows work for it.

### 3.3 · Windows light the scene by themselves

Each opening of the room is, at once, the visible hole and an
environment-sampling **portal** (sun, sky or HDRI) in the engine; the
user never sees the word. For imported rooms, a heuristic:
any glass or transparent quadrilateral in the envelope is
treated as a portal, and the Doctor warns if there is sun or sky and no
samplable opening. The **window glass** is a thin material that
does not refract and does not block shadows (like `thindielectric`), because a
refractive pane kills explicit light sampling and fills the image with
dots. The **outside view** is an image on a plane behind the
window with optional parallax (the solution of KeyShot and Lumion), not
a full environment.

### 3.4 · Interiors camera

- **Straight verticals** by default in *Interior*: lens shift
  (*shift*) computed automatically from the tilt, like
  *Estimate vertical shift*; it can be turned off.
- **Eye height**: *standing* 1.5 m and *seated* 1.1 m presets; the
  camera moves at a constant height, not around the part.
- **Optics**: 24, 28 and 35 mm as interior presets; below
  18 mm the Doctor warns that it stretches the edges.
- **Hidden front wall** and automatic near clipping.
- **Views**: hero at three-quarter, corner, elevation (orthographic),
  plan (orthographic from above with the ceiling invisible to the camera but
  present for the light: per-object camera visibility is
  essential).
- **Panorama** equirectangular 2:1 (and *fisheye*), which is the classic
  interiors deliverable for clients; in the browser it is rendered in
  strips.
- **Exposure**: a single *Brightness (EV)* dial with **automatic
  exposure** and presets (*Bright day* 7, *Evening lamps* 5); ISO,
  shutter and aperture in *Advanced*. An exterior multiplier for the
  camera ray only avoids burnt-out windows without darkening the
  room.
- **Walkthrough**: WASD and mouse with fixed height, to
  find the framing; it is added to the view tool.

**Done in K3** (`ROADMAP.md`, with the numbers): straight verticals
(can be turned off, with the *shift* that comes out of the tilt written into the
*shift* of the O1 optics), eye-height and interior-optics presets,
*Visible to camera* per part (preview and RSB, bit
`INSTANCE_NO_CAMERA`), orthographic elevation and plan, equirectangular
panorama and *fisheye* (the preview via the six faces of a
cube, the engine with its own projections in `CAMR`), automatic exposure
with *Brightness (EV)* and presets, and the exterior multiplier on the camera
ray. **Not** done: the WASD walkthrough (covered by N3), the strip
rendering of the panorama (that is K6; the engine renders it whole), ISO and
shutter in *Advanced*, the hidden front wall and automatic near clipping
(K2, with the `ROOM` node).

### 3.5 · Furniture lighting and materials

- Light setup catalogue: a new **Interior** style with *Morning window*,
  *Midday window*, *Afternoon window*, *Overcast*,
  *Night lamps*, *Blue hour* (lamps and sky balanced) and
  *White studio room*; each one fixes sun or sky or HDRI, exposure
  and curve. *(Done in K1: the seven recipes fix their world, sun and sky or
  the studio dome, and their exposure; the curve and the HDRI are not set. Their figures were
  accepted, and C1 made *Midday window* the starting recipe of the
  *Interior* type.)*
- Physical lights: those of L4 plus **IES** (L5) and emissive strips and panels
  sampled by solid angle.
- **Light groups** with intensity and colour editable **after** the
  render (K8, in the style of *LightMix*): day → dusk → night from a single
  render. It requires per-group passes in the engine; it is what V-Ray and Corona
  users value most.
- Materials: **velvet** (sheen and backscattering), **real-scale
  weave** (threads per cm or DPI, which is how manufacturers enter it),
  wood veneer, leather, **fuzz with a cap** on fibres. E6, R·
  and the BSDF *sheen* cover it.

### 3.6 · Interiors Doctor

New checks, each with a one-click fix and tied to a documented failure:
scale (bounding box against plausible furniture and room sizes,
unit warning); closed room with sun or sky and no samplable
opening; thick or refractive window glass; lights that are too dim or in implausible units
(and *emissive is not a light*); exposure (dark average or burnt-out windows, with a suggestion of
auto-exposure and a low-contrast curve); noise risk (caustics
on, many physical lights, few samples); tilted camera without
*shift*, optics below 18 mm, implausible eye height, near
clipping inside a wall; inverted or one-sided wall normals;
texture scale or grain outside real units and fuzz above
the budget. *(Done in K1, those that do not need the engine: scale and
units, missing opening with sun or sky, thick glass, optics below
18 mm, eye height, near clipping and inverted normals; the rest
wait for the engine or K2.)*

### 3.7 · Furniture deliverables

Cut-out on white with alpha (and with dimensions), *lifestyle*, a sheet of
**fabric and finish variants** from a single scene (*colourways*),
2:1 panorama, elevations and plan, EXR with passes and **part id**
(masks), 2K and 4K, turntable, contact sheet. The N2 batches of
cameras × studios × variants cover production.

### 3.8 · Sample assets

Only CC0 or with attribution recorded per file: **Poly Haven** (521
models, 85 of them furniture; [licence](https://polyhaven.com/license)),
**ambientCG** (fabric and wood textures;
[licence](https://docs.ambientcg.com/license/)). **No third-party
HDRIs**: the environments are own recipes generated by our engine
(`STUDIO-TOOLS.md` §2),
**Kenney** (CC0 furniture kit). **Khronos** (SheenChair,
GlamVelvetSofa) is CC-BY 4.0 and requires attribution. **Nothing** from
Quaternius is bundled (own licence that forbids redistribution), nor from the SketchUp 3D
Warehouse. Sweet Home 3D is a black-box inspiration (GPL).
The product's sample room is generated procedurally, like the
bottle.

---

## 4 · Engine technical decisions

Summary of the technical research, with a verdict per technique. The
sources are in the references of each point.

**Minimum set for an interior to come out well** (about 12 weeks of
a strong engineer, in this order):

1. **Robust geometry at room scale**: watertight triangles
   and robust traversal (already in E2), ray-origin offsetting
   by ULP instead of epsilon (Wächter and Binder 2019,
   [NVIDIA](https://research.nvidia.com/publication/2019-03_fast-and-robust-method-avoiding-self-intersection)),
   two-level BVH with instances for repeated furniture. In `f32` at
   16 m one ULP is ~1 µm: the millimetre is safe; the problem is the
   offsets, not the precision.
2. **Light sources**: sun as its own disc (0.53°) with cone sampling
   and excluded from the environment; **Hošek–Wilkie** sky
   ([project](https://cgg.mff.cuni.cz/projects/SkylightModelling/); the
   reference code circulates with a BSD-3 header; E5c does not use it: it takes
   only the functional form and fits the coefficients to an own
   simulator, clean room; Preetham stays as *Classic*) or HDRI
   with 2D CDF; rectangles and discs by solid angle (Ureña 2013); IES;
   thin glass.
3. **Portals** declared from the room and by glass heuristic
   (Bitterli, Novák and Jarosz 2015,
   [paper](https://cs.dartmouth.edu/~wjarosz/publications/bitterli15portal.html);
   one summed-area table per portal, 8 MB at 2048 × 1024), with MIS
   against the BSDF.
4. **Light tree** (Conty and Kulla 2018,
   [SIGGRAPH](https://history.siggraph.org/learning/importance-sampling-of-many-lights-with-adaptive-tree-splitting);
   compact node as in pbrt-v4): choose a lamp by estimated
   contribution, not by power; with ≤ 8 lights all are sampled. Known
   blind spot: it knows nothing about visibility; room labels
   to prune lamps from another room.
5. **Fireflies and adaptive sampling**: *clamping* separate for direct and
   indirect in exposure units, regularization after the first
   non-specular bounce (pbrt-v4, Kaplanyan 2013), Russian roulette after
   depth 1, 8–12 diffuse bounces; adaptive sampling by two-half-buffer
   error (Rousselle 2012) in 8 × 8 blocks with per-pixel counts
   for the *denoise*.
6. **Own denoise**: AOV passes (albedo of the first non-specular bounce,
   normal, depth, variance, count), filtering of the **demodulated**
   irradiance (otherwise textures get smeared) with variance-guided
   *à-trous* (Dammertz 2010; the spatial part of SVGF without
   reprojection, Schied 2017). Expected: good in diffuse rooms
   from 16–64 samples; it smears bright reflections and the edges of the
   sun patch. An OIDN-type CNN is out (training set,
   inference in wasm).
7. **Cameras**: *shift*, equirectangular, *fisheye*, orthographic with
   per-object camera visibility; EV100 and *filmic*/AgX with a long
   shoulder; exterior multiplier on the camera ray.

**Extension, in order**: **path guiding** with an SD tree (Müller,
Gross and Novák 2017, [project](https://jannovak.info/publications/PathGuide/index.html);
no hyperparameters, 15 MB in their test kitchen, fits workers
without shared memory because the structure is frozen per iteration; the
reference implementation is GPL and Open PGL is Apache with TBB: **only
the idea**), which also learns the portals by itself; heuristic or visibility
map for automatic portals; NFOR *denoise*; SPPM or MNEE for
lamp and glass caustics; sky with atmosphere (Bruneton, Hillaire,
BSD/MIT code); cross-origin isolation (`coi-serviceworker`, MIT)
for a single scene copy per tab.

**No**: ReSTIR in all its variants (1-sample regime and thousands of
lights on GPU; no CPU/offline implementation; it requires reservoirs and a
G-buffer per pixel and exchange between workers), BDPT/VCM/UPS (in the
guiding test kitchen "it struggles to build light subpaths
through the window", and it needs light-image *splats* per worker),
Metropolis (uneven convergence that breaks *denoise* and adaptive),
irradiance caches (bias and tuning; the *denoise* makes them
redundant), neural caches (GPU).

**Caustics**: what the user is told: *"Light focused by glass
(sun on a glass table, glass lampshades)
is off by default: the glass is visible, the patches of focused light
come out soft or not at all."* Options by cost: thin glass without refraction,
regularization (soft blotches, biased), SPPM, MNEE.

**Convergence budgets** (estimates at 1080p, ~10 rays per
sample; native 4 cores at 8–16 M rays/s, 4 workers at a third;
recalibrate with E3):

| Case | Samples | Native 4 cores | 4 workers |
| --- | --- | --- | --- |
| First preview 960 × 540 with *denoise* | 8 | 3–5 s | 8–15 s |
| With *denoise*, no guiding | 64 | 1.5–3 min | 4–8 min |
| With *denoise*, no guiding | 256 | 6–11 min | 17–33 min |
| Clean without *denoise*, sunlit room | 1024 | 22–44 min | 1–2 h |
| Guided + *denoise*, 256 quality | 85–170 | 2–9 min | 6–28 min |

An 8192 × 4096 panorama costs 16 times 1080p: in strips and in
`f16` in the browser. Wasm memory: 4 GB ceiling; without shared
memory each worker has its own copy of the scene, so the
budget is ~400–500 MB per worker on desktop and 150–250 MB on
mobile; BVH ≈ 100–150 MB per million triangles; textures at 8 bits and
2K unless exceptional. Public scenes to measure with: Veach Ajar, Country
Kitchen, White Room, Modern Hall
([Bitterli](https://benedikt-bitterli.me/resources/), CC0 / CC-BY).

**Free renderers to learn ideas from (never code)**:
Cycles (Apache-2.0: light tree, portals, guiding via Open PGL,
adaptive), LuxCoreRender (Apache-2.0: bidirectional, light groups,
"portals without portals"), Mitsuba 3 (BSD with a clause: `thindielectric`,
`sunsky`), pbrt-v4 (Apache-2.0: light tree, portals, `regularize`),
appleseed (MIT). The practical guide (`practical-path-guiding`) and Mitsuba
0.6 are GPL: do not even look at them.

---

## 5 · New phases (summary; the detail is in `ROADMAP.md`)

| Phase | Executor | What | Depends on |
| --- | --- | --- | --- |
| **K1** (done) | Sonnet | Scene type with its default values; *Interior* style of the light catalogue; interiors Doctor (scene checks) | U1, L4 |
| **K2** | Opus | Parametric room node with openings, per-surface materials, hidden front wall, cyclorama; automatic portals (declared and heuristic); thin glass; outside view with parallax | U3, I3 |
| **K3** | Opus | Interiors camera: automatic *shift*, eye height, optics, per-object camera visibility, orthographic for elevations and plan, panorama, automatic exposure and EV, walkthrough | U1, E3 |
| **K4** | Opus | Interior engine, minimum set: ULP offset and two-level BVH, disc sun and sky, solid-angle lights, portals, light tree, *fireflies* and adaptive, AOV and demodulated à-trous *denoise* | E5, K2 |
| **K5** | Opus + Fable | Path guiding with an SD tree (the idea, not the code), and automatic portals by visibility | K4 |
| **K6** | Sonnet | Furniture deliverables: cut-out with alpha and dimensions, variant sheet, panorama in strips, elevations, batch by variants | K3, N2 |
| **K7** | Sonnet | Procedural sample room and CC0 assets with licence recorded per file; interiors contact sheet | K2 |
| **K8** | Opus | Light groups with intensity and colour after the render (*LightMix*): per-group passes in the engine and a mixer in the interface | K4 |

**Judgement calls pending for the lead**: ~~exact licence of the
Hošek–Wilkie tables~~ (resolved in E5c: they are not used; the sky is its own, with the
published functional form and coefficients fitted to our atmosphere
simulator); whether cross-origin isolation is enabled
to share the scene between workers; from what
number of lights the tree comes in.
