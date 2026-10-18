# Research: own HDRI library and editor (2026-10-13)

> Research report prepared for the lead, kept in English as it was written. The decisions are in `docs/STUDIO-TOOLS.md` and in `docs/ROADMAP.md`.

# Clean-room HDRI library and editor for Repackshot: research report (2026-10-13)

Nothing was written into the repository. I read `CLAUDE.md`, `docs/ROADMAP.md` (E5, K4, K7), `docs/INTERIORS.md`, `docs/ARCHITECTURE.md` §5, `src/data/light-setups.ts`, `src/data/studios.ts`, `src/core/photometry.ts` and `engine/crates/rt-core/src/fmath.rs`, all read-only. I put downloads (the Hošek–Wilkie archive, PDFs, API JSON) in the scratchpad only. I opened no HDRI image or thumbnail from any library. From Poly Haven I used only public metadata (categories, tags, attributes).

**Tags used below.** Numbers in brackets such as [12] refer to the source list in §9.
- **[D]** = I derived it and checked it numerically in a throwaway script (`chk.py`, `lib.py`, `lib2.py`, not kept in the repository).
- **[P]** = my design proposal, not a fact. Items touching architecture or photographic taste are for the lead, per CLAUDE.md rule 11.
- **[T]** = common practitioner convention with no citable source; treat as a starting value.

---

## 0. Summary

1. **Ship recipes, not pixels.** A library entry is a small deterministic recipe (JSON, a few KB). HDR files are build artefacts, checked by a pixel hash. A 4k float32 map is 100.7 MB raw, 8k is 402.7 MB [D], and RGBE run-length coding on smooth gradients gives about 2:1 [15]. The editor and the library use the same recipe format: a library entry is a saved pin list.
2. **Physics.** Specify each light by the illuminance it produces at normal incidence (in stops relative to a reference) and let the generator compute the painted radiance. Closed forms for rectangles, discs and rings are in §4.1 and match brute-force integration to better than 1e-5 [D].
3. **Skies.**
   - **Preetham 1999** can be implemented from the paper alone [19]. It is also the least accurate of eight models in Bruneton's evaluation [22].
   - **Hošek–Wilkie licence is now confirmed.** Every file in the v1.4a archive carries a 3-clause BSD header (§4.2). This resolves the "licence to be confirmed" in `docs/INTERIORS.md`.
   - **Sun below the horizon.** Hošek–Wilkie and Preetham both only handle a sun above the horizon [22]. Blue hour and night need an atmosphere integrator of our own.
4. **Determinism.** Rust's `f32::sin`, `exp` and `powf` are documented as non-deterministic across platforms [30]. The generator must use the engine's `fmath` and PCG32/Sobol so pixels are bit-identical on x86_64, ARM64 and wasm.
5. **Provenance.** Commit recipe + generator commit + seed + pixel SHA-256 for each HDRI. CI regenerates and compares. Library-mode recipes can have no image inputs.
6. **Conflict with the roadmap.** K7 plans to offer Poly Haven and ambientCG HDRIs as downloads. That contradicts "no trace of existing HDRIs". It is at least a policy question; §8.
7. **A starter list of 39 HDRIs** (20 studio, 11 outdoor, 8 interior) is in §7. Its geometry is derived from the author's own 72-recipe catalogue in `light-setups.ts`.

---

## 1. Scope notes

- **"HDRI Studio Pro" by that exact name was not found.**
  - Closest products:
    - PolyStudio Pro (Superhive) lists "20+ Free HDRI pack", "30+ Free Soft-boxes", area lights with intensity/size/spread/colour, 1K–8K output and OpenEXR saving. No item list is public [11].
    - Procedural Studio HDRi has up to 8 light slots (softboxes, stripes, rings, dishes) on a dark sky and bakes a 32-bit equirect image. It ships no files [12].
    - Latitude HDRI Studio has softbox/strip/spot/gradient/scrim/image/flag pins and exports a flattened 32-bit EXR up to 4K. No presets; third-party HDRIs are not included [13].
    - HDR Light Studio is a separate commercial tool whose "LightPaint" lets you click a surface to place the reflection [14].
  - No itemised "included set" is public for any of them. The catalogue in §3 is therefore built from photographic practice, Poly Haven's public taxonomy, and the repo's own light-setup catalogue.
- **KeyShot's bundled-environment categories are not publicly documented.** The manual's Environments tab only describes a folder tree, search, thumbnails and import of HDR/HDZ/EXR/DDS [5][6]. KeyShot's blog says "All KeyShot Environments have been rebuilt procedurally", that they default to 4K, and that v7 added interior and outdoor environments [7]. I did not inspect any KeyShot binary or installed content.
- **Not verified:** patents on click-to-place-reflection (one search found none, which is not clearance), trademark status of "HDRI", and the copyrightability of procedurally generated output. All three need counsel.

---

## 2. Conventions used in this report [P]

- **Frame.** Z-up. Azimuth follows the repo: 0° is the direction from subject to the default camera (behind the camera), negative is camera-left, positive is camera-right, ±180° is behind the subject [36 `light-setups.ts` header]. Elevation is above the horizon. The default camera is at az −35°, el 22° [36].
- **Equirect.** u = (i+0.5)/W, v = (j+0.5)/H, θ = π·v from the zenith. Put az 0° at the image centre column. Record the convention in metadata; the OpenEXR `envmap` header anchors the top-left pixel at latitude +π/2 and longitude +π [17], and Radiance `.hdr` has no direction metadata.
- **Reference exposure E_ref = 20,000 lx** at the subject.
  - It is the incident illuminance for ISO 100, f/8, 1/125 s with the usual flat-receptor constant C = 250: E = C·N²/(S·t) [29 Light meter][D].
  - It corresponds to EV100 ≈ 13 [D].
- **Paper white PW = E_ref/π = 6,366 cd/m².** This is the luminance of a perfect diffuse white at E_ref [D]. A mid-grey card (R = 0.18) at E_ref is ≈1,146 cd/m² [D]. The reflected-meter constant K = 12.5 would give 1,000 cd/m², consistent with a 15.7% calibration [29 Light meter].
- **Pixel unit.** 1.0 = PW. OpenEXR's convention is "middle gray 0.18, 1.0 ≈ a 100% reflector", with `whiteLuminance` giving the absolute scale [17]. So write `whiteLuminance = 6366.2` in EXR. For Radiance, (1,1,1) = 1 W·sr⁻¹·m⁻² = 179 lm·W⁻¹ × … [15], so write `EXPOSURE = 179/6366.2 = 0.02812` [D].
- **Colour.** Linear Rec.709 primaries, D65 white (xy 0.31272, 0.32903, 6504 K [29 Standard illuminant]). Write `PRIMARIES` in `.hdr` and `chromaticities` in EXR. A light given in kelvin keeps its true chromaticity relative to D65, so 5600 K reads slightly warm and 3200 K orange.
- **Each studio light is specified by `E` in stops relative to E_ref**, measured at normal incidence on a card facing that light. This is how a photographer meters each light with an incident meter. The generator then solves for radiance L (§4.1).
- **Ambient `AMB(−s)`** is a uniform dome giving E_ref·2^−s on an unoccluded surface, which means L = E/π.
- **Shape notation.** `R(az,el | W×H° | feather | E stops | K)` is a rectangle, with W and H the full angular width and height seen from the subject. `S` is a strip, `D` a disc (radius), `O` a ring (outer/inner radius).
- **Existing repo units.** `photometry.ts` shows the engine's radiometry is Cycles-tuned and not cd/m² (`L = P/(4A)`). The photometric normalisation above is therefore metadata plus a fixed constant mapped through `ENVR.strength`. Relative ratios are the physically meaningful content; absolute reconciliation with `photometry.ts` is a judgement call for the lead.

---

## 3. Catalogue of HDRI kinds

### 3.1 What public libraries cover (taxonomy only)

- **Poly Haven's 12 HDRI categories:** Abandoned & Ruins, Coast & Water, Desert & Arid, Fields & Countryside, Forest & Woodland, Industrial, Interiors, Mountains & Hills, Parks & Gardens, Pure Skies, Streets & Town, Studio [9]. HDRI Haven was merged into Poly Haven [10].
- **Counts from the public API, queried 2026-10-13 (997 HDRIs)** [8]:

| Tag | Count |
|---|---|
| natural light | 822 |
| outdoor | 705 |
| indoor | 301 |
| clear | 240 |
| partly cloudy | 325 |
| overcast | 134 |
| sunrise-sunset | 225 |
| midday | 206 |
| night | 61 |
| studio | 96 |
| pure skies | 59 |

- **Filter attributes per asset** (taxonomy and counts from the same API, computed by me; the API schema defines `evs_cap` as the number of exposure brackets captured) [8]:
  - time of day (sunrise, morning, midday, afternoon, sunset, dusk, night)
  - weather (clear, partly cloudy, overcast, fog, storm, rain, snow)
  - light type (natural 760, artificial 148, mixed 89)
  - contrast (low, medium, high)
  - sky view
  - `evs_cap` (the span in stops between the brightest and darkest bracket)
  - `whitebalance` (K)
- **Capture spans (`evs_cap` medians), computed from the metadata** [8]:

| Group | Median | Range or note |
|---|---|---|
| studio | 12 | 7–27 |
| indoor | 12 | — |
| overcast | 12 | — |
| midday | 15 | — |
| night | 17 | — |
| partly cloudy | 21 | — |
| pure skies | 21 | — |
| clear | 22 | — |
| studio white balance (median) | ≈5,500 K | — |

- **Studio tags** (96 items): photo 77, lamp 71, infinity 46, umbrella 44, white 43, rectangle 36, softbox 29, dark ceiling 19, black floor 19 [8]. Real studio HDRIs are mostly infinity-cove white rooms, umbrellas, rectangular and square softboxes, and black-floor/dark-ceiling stages.
- **Maximum resolutions** shipped are mostly 16384×8192 (476), 24576×12288 (188) and 20480×10240 (94) [8]. Our own tools default lower: KeyShot 4K [7], PolyStudio 1K–8K [11], Latitude ≤4K [13].
- **Not reproducible procedurally:** the landscape categories (forest, coast, mountains, streets and so on). Procedural scope is studio, pure skies, and simple interiors.

### 3.2 Studio kinds

Values: L is the painted radiance at the stated E [D]; DR = peak L / floor L, in stops [D]. Colour temperatures are [T] unless cited.

| Kind | Used for | Layout | Intensity | CCT | DR |
|---|---|---|---|---|---|
| Single softbox | Hero shot with one soft highlight and one shadow direction | az −35…−55, el 25–45; 28°×41° (60×90 cm at 1.2 m) to 44°×62° (120×180 at 1.5 m) [D] | Key 20 klx normal incidence ≈ 3.7e4 cd/m² for 38°×52°; ambient 2–4 stops under [T] | 5000–6500; flash 5500–6000 [29 Colour temp.] | 5–10 stops |
| Two softboxes | Everyday product table | ±45° az, el 40, ~60° wide (repo TWIN_SOFTBOX: 3.5 part-sizes at 3 → 60.5° [D]) | Equal; ≈1.5e4 cd/m² each at −0.5 stop | 5600 | ≈5 |
| Three-point | Textbook key/fill/rim | Key az −45, fill az +50 lower, rim behind to one side [29 Three-point] | Fill "usually softer … up to half the amount" [29]; product practice 1–2 stops under [T] | 5600 / 6500 | ≈8 |
| Strip lights | Metal and bottle edges, glass outlines | Two tall strips at az ±120, ≈7°×80° (repo EDGE: 0.35 at 3 → 6.7° [D]) | 1.4e5 cd/m² at 0 stop [D] | 5600 | 10 |
| Overhead scrim / softbox | Flat lay, even soft light | Disc radius ≈42° at the zenith plus low front fill | ≈1.2e4 cd/m² | 5600 | ≈6 |
| Ring light | Catchlight, shadow hugging the outline | Annulus on the camera axis, outer ≈10°, inner ≈5.5° (repo RING disc: 17.7° [D]) | 3.0e5 cd/m² at 0 stop [D] | 5600 | ≈10 |
| Beauty dish | Cosmetics, butterfly pattern ("above and in line with the camera" [29 Photog. lighting]) | Disc radius ≈13° (55 cm dish at 1.2 m = 12.9° [D]) at el 45 | 1.3e5 cd/m² [D] | 5600 | ≈9 |
| Window-like panels | Soft directional "daylight" with muntin shadows | Rectangle 40°×70° at az −75, el 25, with a pane grid | 2.7e4 cd/m² | 5200–5600 (repo WINDOW 5200 K [36]) | ≈7 |
| Light tent / cube | Shiny items; "soft, even light … minimises reflections" [35] | Four side panels + top disc, all large | ≈6.7e3 cd/m² per panel at −1.5 stop | 5600 | ≈6 |
| Cyclorama / infinity cove | Seamless "infinity" background with no horizon line [35] | White sweep behind and below, dark room in front | wall ≈ 0.95·PW | 5600 | ≈6 |
| Gradient backgrounds | Catalogue gradient reflection (repo GRADIENT_SWEEP) | Huge soft panel above and behind, ≈98°×53° | 1.7e4 cd/m² | 5600 | ≈6 |
| High-key white | Cosmetics, medical, e-commerce | Everything ≈0.85–1.0·PW | Flat; E_scalar large | 5600–6500 | 0–3 |
| Low-key black + rim strips | Drama | Two thin strips at ±125, black elsewhere | 1.6e5 cd/m² strips vs ≈1.3 cd/m² background [D] | 5600 | ≈17 |
| Glass dark-field | White-on-black glass edges | Two strips behind at ±125, ≈5°×55° | 2.6e5 cd/m² [D] | 5600 | ≈18–19 |
| Glass bright-field | Perfume and glass on a lit field | Luminous panel behind, camera-visible, ≈80°×60° | 1.7e4 cd/m² [D] | 5600 | ≈7 |
| Raking | Grain, weave, relief | One strip nearly flat, 67°×15° at el 8 | 7.3e4 cd/m² | 5600 | ≈9–10 |
| Spots | Gallery, museum | Discs r≈3° at el 65–80 | up to 1.6e6 cd/m² [D] | 3000–3500 (repo GALLERY, MUSEUM) | ≈14 |
| Umbrella | Classic soft key | Disc r≈28° at az ±40 | 2.3e4 cd/m² | 5600 | ≈7 |
| Turntable | Consistent 360° capture | 8 panels at 45° steps + top disc + white floor bounce | 2.2e4 cd/m² | 5600 | ≈8 |

**Dynamic range needed.**
- **Typical studio:** 5–10 stops, which half-float holds. With true-black surroundings the figure rises to 17–19 stops. Keep a tiny non-zero floor so importance-sampling tables never contain zero-probability pixels [P].
- **Capture reference:** real studio HDRIs have median `evs_cap` 12 [8].
- **Format limit:** half float tops out at 65,504 [17]. At 1.0 = PW, every studio recipe in §7 stays below 260.

### 3.3 Outdoor kinds

| Kind | Use | Layout and numbers | DR and format |
|---|---|---|---|
| Clear sky, sun 65° / 40° / 20° | Midday, mid-morning, long shadows | Direct sun 32–100 klx; full daylight without sun 10–25 klx [29 Lux]; sun solid angle 6.794e-5 sr [29 Solid angle], radius ≈0.2665° [D]; sun ≈1.6e9 cd/m² at noon, clear sky ≈1e4 cd/m² at noon [29 Luminance orders]. Lambertian ground (ρ 0.25) ≈ 8.4e3 / 5.8e3 / 3.0e3 cd/m² at 65° / 40° / 20° [D, with E_dn 100/90/75 klx and sky 15/15/12 klx as illustrative inputs; the generator computes them] | Sun/sky ≈2e5:1 = 17.6 stops; sun/shadowed ground ≈24 stops [D]. Poly Haven clear-sky median `evs_cap` 22 [8]. Float32 or RGBE; half clips the sun. |
| Golden hour | Warm rim and long shadows | Sun el 3–10°; repo uses 2900 K at 12° (GOLDEN_HOUR) [36]; sun CCT should come from the transmittance model [19 App. A.1] | float32 |
| Blue hour / twilight | Dusk, window-plus-lamp interiors | Horizontal illuminance ≈400 lx at sunset to ≈3.4 lx at the civil-twilight limit [29 Lux], about 7 stops [D] | Needs a model that handles sun below the horizon (§4.2) |
| Overcast | Soft shadowless daylight | CIE overcast: L(θ) = Lz·(1+2cosθ)/3 [19 eq. 2]; E_h = 7π·Lz/9 [D] → Lz = 9·E_h/(7π); for 12 klx, Lz ≈ 4.9e3 and horizon = Lz/3 ≈ 1.6e3 cd/m² [D]. Overcast day ≈1,000 lx to 10–25 klx (bright) [29 Lux]; CCT 6500 K [29] | ≈3 stops, half OK |
| Partly cloudy | Sun plus cloud edges | Sun + cloud layer (§4.4) | 17–24 stops, float32 |
| Hazy | Soft sun, warm sky | Preetham turbidity range, higher T [19] | float32 |
| Night, moon | Night scenes | Moon surface 2.5e3 cd/m², night sky 1e-3 cd/m² [29 Luminance orders]; full moon 0.05–0.3 lx [29 Lux]. Check: Ω ≈ 6.5e-5 sr × 2.5e3 → 0.16 lx [D] | ≈21 stops [D], float32 |

### 3.4 Interior kinds

| Kind | Layout and numbers | Notes |
|---|---|---|
| Window-lit room | A window panel showing sky at 2–10 kcd/m² [29 Luminance] against walls. Daylight factor 2% is "daylit", 5% "strongly daylit" [34]. At 10 klx outside that is 200–500 lx inside; walls at ρ = 0.6 give ≈ 30–150 cd/m² [D, T] | Window/wall ≈ 5–7 stops [D] |
| Office | Office lighting 320–500 lx [29 Lux]. Walls ρ 0.7 at 400 lx ≈ 90 cd/m² [D]. Ceiling panels tuned numerically to the target illuminance [P] | Panels ≈ 1–4 kcd/m² [T] |
| Loft | Tall multi-pane windows plus warm pendant lamps | Mixed 5600 / 2700 K [T] |
| Workshop | Fluorescent tubes; fluorescent lamp ≈1.2e4 cd/m² [29 Luminance] | 4000 K [T] |
| Showroom / gallery | White room with track spots; spots 3000–3500 K [T] | — |

---

## 4. How to generate each kind

### 4.1 Analytic shapes on the sphere

**Frame and coordinates.** For a light layer take its axis n (from az, el) with an orthonormal frame (t, b) and an optional roll. For a direction ω with c = ω·n > 0, the gnomonic coordinates are (x, y) = ((ω·t)/c, (ω·b)/c) [D].
- A rectangle in the gnomonic plane of half-extents (tan(W/2), tan(H/2)) is exactly what a flat physical softbox at distance d looks like, since W = 2·atan(w/2d) [D]. Example: 60×90 cm at 1.2 m gives 28.1°×41.1° [D].
- Discs and rings use angular distance from n. Do all geometry with 3D dot products, never in (u,v), so poles and the u=0/1 seam are correct.

**Soft edges and profile.**
- Coverage `c` = smoothstep of the signed distance in the gnomonic plane, with the feather as a fraction of the shape's half-size [P]. Rounded corners are the same SDF minus a radius.
- A `profile` field (flat, cosine^k, hotspot) covers softbox/scrim falloff and the unnamed "falloff modes" of other editors [2].

**Radiometry.**
- Solid angle of a rectangle: Ω = 4·asin(sin(W/2)·sin(H/2)). Spherical cap: Ω = 2π(1−cos α) [29 Solid angle].
- Illuminance at normal incidence from a Lambertian emitter of radiance L [D]:
  - disc of half-angle α: **E = π·L·sin²α**
  - ring: **E = π·L·(sin²α_out − sin²α_in)**
  - centred rectangle with A = tan(W/2), B = tan(H/2): **E = L·4π·F(A,B)**, where F(A,B) = (1/2π)·[ A/√(1+A²)·atan(B/√(1+A²)) + B/√(1+B²)·atan(A/√(1+B²)) ]
  - These match brute-force integration to better than 1e-5 [D].
- Pixel solid angle for exact checks and PDFs: ΔΩ = (2π/W)(cos θ_top − cos θ_bottom) [29 Solid angle lat-long patch].
- **After painting**, compute E_unit = Σ c(ω)·max(ω·n, 0)·ΔΩ numerically and set L = E_target/E_unit. The baked map then has exactly the intended E regardless of feather and anti-aliasing [P/D].

**Blending.** Light adds linearly, so the default blend is Add. A flag/cutout multiplies by (1−c) to remove light, and a background layer replaces. The KeyShot manual mentions blend modes but does not list them [2][4]. Latitude has a "Flag / Cutout" pin [13].

**Gradients.** Define them as colour and brightness stops over elevation (interpolate in sin(elevation)), as KeyShot's gradient background does by latitude [3]. Include opacity stops for gradient layers [2].

**Colour from kelvin.** Use the Kim et al. cubic-spline Planckian locus (1667–25000 K) or the CIE daylight locus (4000–25000 K) [29 Planckian locus, Standard illuminant], or Krystek's rational form (1000–15000 K) in (u,v). Take that chromaticity to XYZ with Y = 1 and convert to linear Rec.709. Only closed-form constants are needed, so no CIE tables are involved [P].

### 4.2 Analytic skies

| Model | What it gives | Licence / obligations | Verdict |
|---|---|---|---|
| **Preetham 1999** [19] | Perez 5-parameter distribution F(θ,γ) = (1 + A·e^{B/cosθ})(1 + C·e^{Dγ} + E·cos²γ) in Y, x, y. Coefficients are linear in turbidity T. Zenith luminance Yz = (4.0453T − 4.9710)·tanχ − 0.2155T + 2.4192 (kcd/m²), χ = (4/9 − T/120)(π − 2θs). Appendix A also gives sun position, sun transmittance (air mass m = 1/(cosθ + 0.15(93.885−θ)^−1.253); Rayleigh e^(−0.008735 λ^−4.08 m)), ozone, gases, water vapour. The paper says the Appendix lets you "implement our model without sources other than this paper" [19] | A published paper. No code or table licence applies; clear sky and overcast only; not for partly cloudy [19]; counsel should confirm formulas can be reimplemented freely [P] | Good quick start; least accurate in the independent comparison (RMSE 88.1 vs 11.3 for Bruneton; overestimates ≈2×); sun above horizon only [22] |
| **Hošek–Wilkie 2012/13** [20] | Full-spectral sky radiance. Turbidity 1–10, ground albedo, sun elevation ≥ 0; RGB data uses sRGB primaries; spectral output W/(m²·sr·nm), ×683 lm/W gives luminance [20 README]. Solar-disc function added in 2013 [20] | **3-clause BSD, verified** from the v1.4a archive: `Copyright (c) 2012-2013, Lukas Hosek and Alexander Wilkie`. All five files (`ArHosekSkyModel.c/.h`, `…Data_RGB.h`, `…Data_CIEXYZ.h`, `…Data_Spectral.h`) carry the same header. Obligations: keep the copyright, conditions and disclaimer; no endorsement using the contributors' names. The RGB data file is ≈66 KB of source, Spectral ≈514 KB [20] | Better than Preetham (RMSE 41.5 vs 88.1) but underestimates near the sun, no sun below the horizon, no aerial perspective [22]. Fine for the live sky if the notice is kept; porting the tables is a judgement call for the lead |
| **Bruneton** precomputed scattering [21] | Precomputed transmittance and single/multiple scattering tables, ozone layer, density profiles, configurable solar spectrum | **BSD** (the repo LICENSE reads "Copyright (c) 2017 Eric Bruneton … Redistribution and use … 1. 2." — I read only the first lines; confirm 3 clauses before relying on it). Code is GLSL + C++ | Most accurate in the evaluation (RMSE 11.3, with Elek); fewer approximations means higher accuracy [22]. **Implement the algorithm in Rust ourselves** (CPU tables), no code copying needed |
| **Hillaire 2020** [23] | LUT-based real-time atmosphere with a multiple-scattering approximation | **MIT** repo [23] | Alternative to Bruneton |
| **Single-scattering ray march (Nishita-style)** [25] | Constants: Earth 6,360 km, atmosphere 6,420 km, scale heights 8 km (code 7,994 m) and 1.2 km; Rayleigh β (RGB) ≈ (5.8 or 3.8, 13.5, 33.1)·10⁻⁶ m⁻¹ (text and code disagree on red); Mie g = 0.76; phase functions given [25] | Tutorial, no licence needed for physics | Single scattering only, no ozone [25]; check constants against primary sources before using |
| **Prague model 2021** [24] | Radiance model that reaches sun elevations down to −4.2° (CLI range [24]) | Code **Apache-2.0**; dataset not in the repo; ground-level data is 103 MB; **dataset licence unconfirmed** [24] | Too large for wasm; not recommended |
| **CIE standard general sky** [27] | ISO 15469:2004 / CIE S 011/E:2003, 15 sky types with Perez-style coefficients | Standard is a CIE publication; formulas are widely reproduced | Overcast (type with (1+2sinγ)/3 gradient) is covered by [19 eq. 2]; avoid copying the CIE tables |

**Recommended path [P].**
1. Tier 0: Preetham from the paper alone, for fast daytime skies.
2. Tier 1: an atmosphere table builder in Rust, in the style of Bruneton, for all sun elevations including blue hour. A ground-level sky is a 2D function of view zenith and relative azimuth for a given sun elevation, so a baked sky is fast.
3. Tier 2: optionally Hošek–Wilkie with the BSD notice, to match the literature.

**Sun disc and ground.**
- Sun solid angle 6.794e-5 sr, radius 0.2665° [29, D]. Radiance L_sun = E_dn / (π·sin²α); with E_dn = 100 klx that is 1.47e9 cd/m² [D], consistent with the cited 1.6e9 [29].
- Ground: Lambertian, L_g = ρ·E_h/π with E_h = E_dn·sin(h) + E_sky [D].
- Sun position from date/time/place: Preetham's appendix has the formulas [19]. KeyShot's editor offers location, date, time and a custom sun override [3].
- Do not use Jensen's night-sky model's photograph-based Milky Way [26]. Use seeded procedural stars with a magnitude distribution and no star catalogue [P].

### 4.3 Rendering a virtual studio or room into an equirect camera

Place an equirect camera at the probe point (the product's position). Walls and floors are diffuse materials with chosen albedos; panels, windows and lamps are emissive quads or discs at the stated luminance. Windows show a sky from §4.2 through a portal. This is the right tool for interiors, window sun patches, bounce colour and cyclorama inter-reflection.

- **Cost:** a 4096×2048 map at 1,024 spp is ≈8.6e9 paths. Do this offline with the native `rt-cli` in CI, not in the browser [P].
- **No denoise:** never clamp or denoise directly visible emitters.
- **Parallax:** the result is only right at the probe point. Keep walls at least ~3× the product's size from the probe and say so in the metadata.
- **Determinism:** the engine already guarantees identical pixels across thread counts and architectures [36 `engine/README.md`], so the baked HDR can carry a pixel hash.
- **Camera support:** the equirect camera is planned in K3 and is not in `rt-core` yet [36 `docs/INTERIORS.md`]; a small dedicated camera mode is enough for the HDRI bake.

### 4.4 Procedural clouds

- **Layer approach [P].** Map each direction onto a cloud shell at height h (a sphere shell avoids blow-up at the horizon). Sample density from fBm of improved Perlin noise [28] mixed with Worley cellular noise [28], remapped by a coverage threshold. Schneider and Vos's slides describe this "Perlin-Worley" mix [28].
- **Lighting [28].**
  - Transmittance by Beer's law, T = exp(−τ).
  - A Henyey–Greenstein phase function for forward scatter.
  - The "powder" darkening term.
  - Sun transmittance through the layer (sun can be partly occluded).
  - Sky-lit ambient term.
- **Determinism.** Integer hash noise from the engine's PCG32/Sobol, and `fmath` for exp/pow, so the result is bit-exact.
- **Validation.** A full path-traced volume bake with our own tracer as ground truth (§4.3).

### 4.5 How KeyShot's HDRI Editor works (my words, from the public manual)

- **Structure.** It is a layer stack on top of a background, inside the Environment tab of the Project window. Pro only [1].
- **Background modes.** Flat colour, gradient (colour stops by latitude), Sun & Sky, or an image [3].
  - Sun & Sky inputs: city or custom coordinates, date, time, an optional custom sun position, turbidity (haze, warms the sky), sun size, ground colour [3].
  - Colour adjustments: brightness, contrast, saturation, hue, colourize, blur.
  - Transforms: tilt, and a rotation of the background that does not move pins [3].
  - A "resolution" setting controls the generated size; higher improves shadows and reflections of sharp pins [3].
- **Pins** [2][4].
  - **Light pin:** circle or rectangle, optional half-shape, rounded corners, rotation, brightness, colour with a Kelvin scale, a falloff amount and falloff mode, a blend mode, and azimuth/elevation.
  - **Gradient pin:** the same geometry, with a colour ramp, midpoints, opacity stops and a saturation control.
  - **Image pin:** any HDR/EXR/JPG/PNG/BMP placed like a pin with brightness, contrast, saturation, hue and colourize.
  - **Copy pin:** a clone of a patch of the background.
  - The manual does not list the blend modes, the falloff modes or any units [2][4].
- **Pin list.** Order is layering top to bottom; checkboxes enable pins; double-click renames; folders group; pins can be copied between environments [2][4].
- **Set Highlight.** Cmd/Ctrl-click on the model aims a pin so its reflection lands at that surface point; it can also reposition an existing pin [2][4]. Repackshot already has the equivalent (*Place by reflection*, E-phase) [36].
- **Workflow.** A fast low-resolution preview, and on demand a full-resolution generation [2][4]. Settings are stored inside the scene file (not a separate .HDZ per environment), and the result can be exported as .HDR, .EXR or .HDZ [1][2].
- **Context.** KeyShot states its stock environments were rebuilt this way, procedurally [7]. The Blender add-ons above add: up to 8 shape slots with softness [12]; scrim pins with a movable hotspot, flag/cutout pins and a 1,000–12,000 K temperature slider [13]; softbox textures [11].

**Editor requirement set for Repackshot [P].**
- **Layers:** rectangle, strip, disc, ring, spot, scrim, gradient, flag, sky, sun, cloud, image (user data only).
- **Controls:** feather, profile, kelvin, E in lux or stops with an exposure readout, layer order with blend modes (Add, Flag, Replace), a low-res live preview and a full-res bake.
- **Persistence:** the same recipe serialises into the scene (RSB section) and into the library.
- **Validation guard:** in library mode, reject image and copy-from-file layers (§6).

---

## 5. File formats and technical details

**Radiance RGBE `.hdr`** [15]
- Header: `#?RADIANCE`, then lines such as `FORMAT=32-bit_rle_rgbe`, `EXPOSURE=`, `PRIMARIES=`, `SOFTWARE=`, ended by an empty line; then a resolution line such as `-Y N +X M`. EXPOSURE is cumulative, and original radiances are the file values divided by the EXPOSURE settings [15].
- Pixel: 1-byte mantissa per primary plus one shared 1-byte exponent. Accuracy ≈1% (±1 in 200) over 1e-38…1e38 [15].
- Radiance units: a pixel of (1,1,1) is 1 W·sr⁻¹·m⁻²; luminance = 179 lm/W × weighted RGB (for Radiance's default primaries) [15]. Write `PRIMARIES` for Rec.709/D65 if you use Rec.709 [P].
- Scanline records: uncompressed, old RLE, or **new RLE**. New RLE starts each scanline with `2 2 hi lo` (length < 32768), then codes the four channel planes separately; a byte with the high bit set is a run with count excess 128; a byte < 128 starts a literal run. Typical compression is ≈2:1 [15].
- **Loader-detail caveat:** common reference code treats widths < 8 as flat and counts 1–128 as literals; I did not verify this against a primary source in this session. Round-trip against your own reader.
- A round-trip tolerance of 1% is the format's design accuracy, so test with 1%, not 1e-6.

**OpenEXR** [17]
- Pixel types: HALF (16-bit, range ≈6.0e-8 to 6.5e4, 10-bit mantissa), FLOAT (32-bit), UINT.
- Compression: NO, RLE, ZIPS (1 line), ZIP (16 lines), PIZ (32), PXR24 (16, lossy for float), B44 (32, lossy), DWAA (32 lines) / DWAB (256, lossy) [17].
- File layout: magic `0x76 0x2f 0x31 0x01`; version 2; attributes (name, type, size, value, null-terminated); required attributes `channels`, `compression`, `dataWindow`, `displayWindow`, `lineOrder`, `pixelAspectRatio`, `screenWindowCenter`, `screenWindowWidth`; an offset table; scan-line blocks [17].
- The ZIP predictor and byte reordering are not described in the layout doc; the doc points to the library source [17]. OpenEXR is BSD-3 [17]. For writing, `NO_COMPRESSION` or a stored-block deflate is valid and avoids needing your own compressor.
- Standard attributes to write: `whiteLuminance`, `chromaticities`, `envmap` (LATLONG) [17]. Add custom string attributes for the recipe (§5, metadata).
- Prefer float32 for anything containing the sun or moon.

**Projection and storage**
- **Equirect** 2:1 is the interchange format. Pole oversampling: the 30° caps at each pole hold 33% of the texels but only 13.4% of the sphere area [D].
- **Equal-area octahedral** is what pbrt-v4 expects for image infinite lights [18]; consider it as the engine-internal form [P].
- **Cube maps:** the corner texel is 0.19× the centre texel's solid angle (5.2:1) [D].

**Resolution guidance** (angular pixel size = 360°/W [D])

| Width | °/px | Sun disc | Float32 size | Use |
|---|---|---|---|---|
| 512 | 0.70 | <1 px | 6.3 MB | diffuse-only lighting and thumbnails; nine SH coefficients capture irradiance to ≈1% [31] |
| 2048 | 0.176 | ≈3 px | 25 MB | previews |
| 4096 | 0.088 | ≈6 px | 100.7 MB | default final (KeyShot's default is also 4K [7]) |
| 8192 | 0.044 | ≈12 px | 402.7 MB | hero chrome and glass close-ups |

A mirror object filling ≈1,000 px sees ≈0.23° per pixel at its centre and coarser at its rim [D], so 4k already oversamples it.

**Importance sampling** [18]
- Build a 2D piecewise-constant distribution on luminance × sinθ at row centres (pbrt-v3 does exactly this). Conversion: pdf_ω = p(u,v) / (2π²·sinθ) [D]. pbrt-v4 also offers a "compensated" distribution for MIS that subtracts the mean pixel value [18].
- Very bright small features (the sun) make spiky PDFs and rely on MIS with BSDF sampling. The roadmap already plans the sun as an analytic disc with cone sampling, excluded from the environment (K4) [36]. So emit a metadata `sun` record {direction, angular radius, radiance RGB} and an option to bake the map with or without the sun [P].
- Never clamp the generated map; clamp in the renderer.

**Anti-aliasing small shapes**
1. Coverage from the signed distance: c = clamp(0.5 − d/w_pix, 0, 1), with w_pix the pixel's angular footprint. Use at least 1.5 px of feather.
2. Within ±1.5 px of an edge, supersample (e.g., 8×8 stratified with deterministic Sobol) and average in linear radiance.
3. For the sun (≈3–6 px across), integrate overlap per pixel with high supersampling; conserve flux so Σ L·ΔΩ over the map equals L·Ω of the analytic disc.
4. Never filter in display space.
5. Render at 2× or 4× and box-filter down only if needed; compute geometry in 3D so poles and the seam are exact.

**Thumbnails** [P]. Use three renders from the same map: a 256×128 tone-mapped equirect strip, a chrome sphere (n = (x, y, √(1−x²−y²)); r = 2(n·v)n − v; look up the map), and a grey sphere using nine-coefficient SH irradiance [31]. Tone map by setting the log-average luminance (excluding the sun) to key 0.18 and applying a Reinhard-type curve [32], then sRGB. The engine's `png` writer and `color` module can be reused [36].

**Metadata to record** (EXR string attributes or `.hdr` comment lines, plus a sidecar JSON):

```
schema, id, name, kind, tags[]
generator {name, version, git_commit}
seed (u64), resolution, projection {type, up, front_azimuth_u}
radiometry {unit, white_luminance_cd_m2, E_ref_lux, white_point, primaries}
recipe {layers[]...}   // canonical JSON, sorted keys
derived {sun{dir, angular_radius, radiance_rgb}, scalar_irradiance, peak_luminance,
         min_nonzero, dynamic_range_stops, sh9[]}
hashes {recipe_sha256, pixels_sha256}   // pixels = f32 LE bit patterns, row-major RGB
license {spdx, holder, year}
provenance {inputs: [], third_party_data: [{name, licence, sha256}]}
```

---

## 6. Clean-room protocol (to document)

Project rules already require clean-room work and permissive-only dependencies [36 `CLAUDE.md` rules 1, 8]. For HDRIs:

**May look at**
- Papers, standards and specs: Preetham, Hošek–Wilkie (paper and the BSD source only to check or port tables with notice), Perez/CIE definitions, the Radiance and OpenEXR specs.
- Public manuals of other tools, for behaviour only (KeyShot manual, Latitude and PolyStudio docs).
- Third-party library **taxonomy and metadata** (category names, tags): facts.
- Photographic textbooks, the author's own measurements, and the existing catalogue (`light-setups.ts`).
- Layout ideas (key at 45°, strip at 120°) are ideas, not expression.

**May not look at or use**
- Any pixel data, thumbnail or preview from any HDRI library, CC0 or not (Poly Haven, ambientCG, commercial packs, KeyShot's installed content). No tracing, resampling, histogram matching, or fitting parameters to them, and no "make something like X".
- ML-generated HDRIs or sky generators (training provenance is unknowable), or ML enhancement in the bake path.
- KeyShot binaries or file formats (HDZ, BIP), or other add-ons' shipped presets and softbox textures.
- Third-party code or tables outside the allow-list (MIT, Apache-2.0, BSD, ISC, CC0). Each one is recorded with licence and checksum; the Hošek–Wilkie tables would be one such entry.

**Proof of provenance**
1. The recipe is the source of truth. Commit `recipe.json` + generator git commit + seed + `pixels_sha256` per HDRI [P].
2. CI regenerates every HDRI and compares hashes on native x86_64, ARM64 and wasm, and with 1 vs N threads. This requires the generator to use `fmath` (the `sin`/`exp`/`powf` of `std` are documented as non-deterministic across platforms and runs [30]); `sqrt` and basic IEEE operations are exact [30].
3. A library-mode flag makes the validator reject any layer that reads a file or an image. The generator's bake API takes no image input, so provenance holds by construction [P].
4. Each commit carries a DCO sign-off [33], and the PR template includes: "I did not view or derive from third-party HDRI pixel data." If someone accidentally did, they disclose it and another person reviews that recipe.
5. Extend the planned `assets.json` test (K7: fail if an asset lacks a recorded licence [36]) to cover generated HDRIs.

**Naming without trademarks** [P]
- Descriptive snake_case ids from the photographic vocabulary (softbox, strip, scrim, ring, cyclorama, golden hour).
- Avoid: "KeyShot", "Poly Haven" / "Haven", "HDR Light Studio", "Studio Pro", lighting-manufacturer names (Profoto, Elinchrom, Godox, Aputure, Kino Flo), product-line names such as octabox-type brands (say "octagonal softbox"), "Paramount" (say "butterfly"), and place or photographer names.
- Run a trademark search on the final pack name. I could not verify whether "HDRI" is a registered mark.

**Licensing**
- The library inherits PolyForm Noncommercial 1.0.0 [36 `LICENSE`]. That licence speaks of "software" and requires `Required Notice:` lines to be passed on. Add an explicit notice that recipes and generated data files are covered, and ask counsel about copyright in procedural output.
- For Hošek–Wilkie, keep the BSD notice in the source and docs.

---

## 7. Starter library (39 HDRIs)

Notation as in §2. Peak L is the painted radiance at the stated E [D]. DR is peak/floor in stops. Default 4k; EXR half is fine unless noted.

### Studio (20)

| # | id | Purpose | Recipe | Peak L / DR |
|---|---|---|---|---|
| 1 | `studio_softbox_single` | Hero shot, one soft key | R(−45,35 \| 38×52 \| 8% \| 0 \| 5600) + AMB(−3) | 3.7e4 / 5.5 |
| 2 | `studio_softbox_pair_45` | Everyday product table | R(−45,40 \| 60×60 \| 8% \| −0.5 \| 5600) + R(+45,40 \| same) + AMB(−4) | 1.5e4 / 5.3 |
| 3 | `studio_three_point` | Textbook key/fill/rim | Key R(−45,35 \| 38×52 \| 8% \| 0 \| 5600); fill R(+50,15 \| 70×70 \| 15% \| −1.5 \| 6500); rim S(−150,40 \| 7×60 vertical \| 5% \| −1.5 \| 5600); AMB(−5) | 6.1e4 / 8.2 |
| 4 | `studio_edge_strips_pair` | Edges of metal and bottles | S(−120,30 \| 7×80 vertical \| 4% \| 0 \| 5600) + S(+120,30 \| same) + AMB(−6) | 1.4e5 / 10 |
| 5 | `studio_overhead_scrim` | Flat lay, even top light | D(0,85 \| r42° \| 35% \| −0.2 \| 5600) + R(0,10 \| 62×48 \| 15% \| −2.2 \| 6500) + AMB(−5) | 1.2e4 / 6 |
| 6 | `studio_beauty_dish_clamshell` | Cosmetics, butterfly pattern | D(0,45 \| r13° \| 25% \| 0 \| 5600) + R(0,−20 \| 75×30 \| 20% \| −2.5 \| 5600) reflector card + AMB(−4.5) | 1.3e5 / 8.8 |
| 7 | `studio_ring_light` | Circular catchlight, shadow hugging outline | O(0,22 \| 10°/5.5° \| 3% \| 0 \| 5600) + AMB(−4) | 3.0e5 / 9.6 |
| 8 | `studio_strip_overhead_long` | One clean highlight along a part | S(0,75 \| 12×110 horizontal \| 10% \| 0 \| 5600) + R(0,10 \| 62×48 \| 15% \| −2.5 \| 6500) + AMB(−5) | 6.7e4 / 8.4 |
| 9 | `studio_light_tent_cube` | Jewellery, glossy items | R(±45,15 \| 70×60 \| 20% \| −1.5) + R(±135,15 \| same) + D(0,85 \| r40° \| 20% \| −1.5) + FLOOR p=0.35 + AMB(−7) | 6.7e3 / 6 |
| 10 | `studio_cyclorama_white_sweep` | White seamless, e-commerce | Floor p=0.85; back wall (\|az−180\|<80°) p=0.95 at el 8° falling to 0.5 at el 55°; front hemisphere p=0.03; R(±55,30 \| 45×60 \| 10% \| −0.5 \| 5600); AMB(−6) | 2.0e4 / 6 |
| 11 | `studio_high_key_white_dome` | Cosmetics, medical, near shadowless | Gradient dome p: 1.0 at horizon, 0.9 zenith, 0.85 nadir; D(0,80 \| r30° \| 30% \| +0.3) | 3.1e4 / ≈2.5 |
| 12 | `studio_low_key_black_rim` | Dramatic rim on black | Background p=2e-4 (1.3 cd/m²); S(±125,20 \| 6×60 vertical \| 3% \| −0.3 \| 5600); D(0,80 \| r10° \| 10% \| −3) | 1.6e5 / 17 |
| 13 | `studio_dark_field_glass` | Glass edges white on black | S(±125,15 \| 5×55 vertical \| 3% \| 0 \| 5600) + background p=1e-4 | 2.6e5 / 18.6 |
| 14 | `studio_bright_field_glass` | Glass and fragrance on a lit field | R(180,12 \| 80×60 \| 6% \| 0 \| 5600, camera-visible) + S(±85,20 \| 7×80 vertical \| 4% \| −2.5) + AMB(−6) | 1.7e4 / 7.4 |
| 15 | `studio_gradient_backdrop_catalogue` | Catalogue gradient reflection | R(165,65 \| 98×53 \| 35% \| 0 \| 5600) + R(0,15 \| 62×48 \| 15% \| −2.2 \| 6500) + AMB(−5) | 1.7e4 / 6.4 |
| 16 | `studio_window_panels_side` | Window light with muntin shadows | R(−75,25 \| 40×70 \| 3% \| 0 \| 5400) with 2×3 pane grid (muntins 1.5°) + R(80,10 \| 45×60 \| 20% \| −3 \| 6500) + AMB(−5) | 2.7e4 / 7.1 |
| 17 | `studio_turntable_even_ring` | 360° turntable consistency | 8 × R(k·45°,30 \| 28×40 \| 12% \| −1.5 \| 5600) + D(0,85 \| r35° \| 25% \| −1.5) + FLOOR p=0.25 + AMB(−6) | 2.2e4 / 7.8 |
| 18 | `studio_raking_strip` | Grain, weave, relief | S(−85,8 \| 67×15 horizontal \| 5% \| 0 \| 5600) + R(60,30 \| 62×55 \| 15% \| −3.3 \| 6500) + AMB(−6) | 7.3e4 / 9.5 |
| 19 | `studio_spot_pair_warm` | Gallery spots | D(±30,65 \| r3° \| 10% \| −0.5 \| 3500) ×2 + D(0,80 \| r35° \| 30% \| −2.8 \| 3500) + AMB(−6, 3500) | 1.6e6 / 14 |
| 20 | `studio_umbrella_pair` | Classic umbrella key pair | D(±40,30 \| r28° \| 8 spokes \| −0.3 \| 5600) ×2 + AMB(−5) | 2.3e4 / 6.9 |

(A single warm museum spot is `studio_spot_pair_warm` with one disc; no separate entry needed.)

### Outdoor (11)

Sky tier from §4.2. "Float32" means half-float would clip the sun or moon.

| # | id | Purpose | Recipe | Notes |
|---|---|---|---|---|
| 21 | `sky_clear_sun_65` | Midday | Sun el 65, az −55; turbidity 2.5; ground ρ 0.25 | Ground ≈8.4e3 cd/m² [D]; float32 |
| 22 | `sky_clear_sun_40` | Mid-morning or afternoon | Sun el 40, az −55; turbidity 2.5; ρ 0.25 | Ground ≈5.8e3 [D]; float32 |
| 23 | `sky_clear_sun_20` | Long shadows | Sun el 20, az −55; turbidity 2.5; ρ 0.25 | Ground ≈3.0e3 [D]; float32 |
| 24 | `sky_golden_hour_6` | Warm backlight | Sun el 6, az −120; turbidity 3; sun colour from transmittance model | float32 |
| 25 | `sky_sunset_horizon` | Strong gradient, backlit | Sun el 0.8, az 165; turbidity 4 | Sun ≈1e7–1e8 cd/m² order [D]; float32 |
| 26 | `sky_blue_hour` | Dusk, window-plus-lamp interiors | Sun el −4, no direct disc; own table builder; ground ρ 0.2 | Horizontal illuminance falls ≈400 → 3.4 lx [29 Lux]; float32 |
| 27 | `sky_overcast_bright` | Soft daylight | CIE overcast, E_h = 12 klx → Lz ≈ 4.9e3 cd/m²; ground ρ 0.2 ≈ 7.6e2 | [D]; ≈3 stops, half OK |
| 28 | `sky_partly_cloudy_45` | Sun and cumulus | Sun el 50, az −55; turbidity 3; cloud shell 2 km, coverage 0.45, 5-octave fBm, seed fixed | float32 |
| 29 | `sky_hazy_turbid_30` | Hazy, soft sun | Sun el 30, az −55; turbidity 7 | float32 |
| 30 | `sky_open_shade` | Outdoor furniture in shade | Sun removed; sky E_h ≈15 klx; warm bounce R(120,20 \| 60×60 \| 20% \| −3 \| 4500) | Half OK |
| 31 | `sky_night_moon` | Moonlit night | Moon el 45, az −40, radius 0.26°, L 2.5e3 cd/m²; sky 1e-3 cd/m²; seeded point stars (no catalogue) | ≈0.16 lx, ≈21 stops [D]; float32 |

(A heavy-overcast variant and a starry no-moon variant are parameter changes of #27 and #31.)

### Interior (8)

Baked with our path tracer (§4.3) at a probe near table height; 4k float32; baked offline in CI and published as hash-verified artefacts. Albedos (ρ) and luminances are recipe parameters [P].

| # | id | Purpose | Recipe |
|---|---|---|---|
| 32 | `room_living_window_overcast` | Window-lit living room | 5.0×4.0×2.6 m; one 2.0×1.4 m window (sill 0.9 m) on the left; outside = #27; ρ walls 0.65, ceiling 0.8, floor 0.35; probe at centre, 0.8 m. Expect walls ≈30–150 cd/m² and DF in the 2–5% band [34][D] |
| 33 | `room_living_window_sun_patch` | Same room, sun through the window | Outside = #22. Sun patch on the floor: E≈6e4 lx → L≈6.7e3 cd/m² at ρ 0.35 [D]; sun may be visible |
| 34 | `office_ceiling_panels` | Open-plan office | 10×8×2.7 m; 600×600 LED panels on a 1.2 m grid, 4000 K, tuned so mean horizontal E at 0.85 m = 500 lx [29 Lux office 320–500]; walls ρ 0.7 ≈90 cd/m² [D] |
| 35 | `loft_tall_windows_pendants` | Industrial loft | 9×6×4.2 m; two 1.2×3.0 m windows with 4×8 panes; one exposed-brick wall ρ 0.3; 3 pendant globes d=0.3 m, 2700 K, L≈5e3 cd/m² [T]; outside = #21 |
| 36 | `room_dusk_window_lamps` | Mixed colour temperature | #32 geometry; outside = #26; two table lamps (0.3 m emissive shade, 500 cd/m² [T], 2700 K) |
| 37 | `showroom_track_spots` | White showroom | 12×9×3.5 m; walls ρ 0.85, floor ρ 0.5; 6 ceiling spots (discs r≈4°), 3500 K |
| 38 | `workshop_fluorescent_tubes` | Tools and workshop | 12×8×4 m; 6 two-tube fixtures 1.2 m × 0.05 m at 3.6 m, L = 1.2e4 cd/m² [29 Luminance], 4000 K; floor ρ 0.2; walls ρ 0.5 |
| 39 | `gallery_skylight_diffuse` | Daylit gallery | 8×8×4 m; 2×2 m diffuser skylight at L≈3 kcd/m² [T]; walls ρ 0.8; floor ρ 0.4 |

### Acceptance tests for the generator [P]
- Flux conservation: Σ L·ΔΩ within 0.1% of the analytic value.
- Normal-incidence E of each light recovered within 0.5%.
- Furnace test (uniform dome gives expected radiance).
- Hash equality across x86_64, ARM64, wasm and 1 vs N threads.
- RGBE round trip within 1%; EXR round trip bit-exact.
- No NaN, Inf or negative values; the u=0/1 seam is continuous.
- Golden thumbnails.

---

## 8. Risks, conflicts with the repo, and judgement calls for the lead

- **K7 conflict.** `docs/ROADMAP.md` K7 and `docs/INTERIORS.md` §3.8 plan on-demand Poly Haven and ambientCG HDRI downloads. That contradicts "no trace of existing HDRIs". The lead should decide whether those downloads are dropped or kept as an explicit, separate, non-library option.
- **"Licence to be confirmed"** (`docs/INTERIORS.md` §4.2) is now resolved for Hošek–Wilkie: 3-clause BSD in v1.4a, all five files [20]. Whether to port the tables (and attribute them) or use Preetham plus an own table builder is a judgement call for the lead.
- **E5** specifies readers for RGBE and EXR. The library needs **writers** too (and `rt-core` already has a PNG writer). Decide where the generator lives; a new std-only crate used by `rt-cli` and `rt-wasm` is the natural fit under rule 8b [P].
- **Units.** Pixel unit 1.0 = PW and `whiteLuminance` are proposals. Reconcile with `ENVR.strength` and the Cycles-tuned `photometry.ts` before shipping.
- **Determinism details.** `fmath` lists sin, cos, exp2, log2, pow, atan2, acos [36]. The generator also needs tan, asin and atan (or equivalent) built the same way.
- **Interiors** are a finite-room approximation (parallax). Furniture product shots with real room geometry (K phases) are the better path; the interior HDRIs are a quick-lighting convenience.
- **Poly Haven API.** Their terms require a "Powered by Poly Haven" credit for anything built on the live API [8]. I used it only for read-only taxonomy research.
- **Not legal advice:** formula reuse, trademarks, patents, and copyright in procedural output all need a lawyer.

---

## 9. Sources

1. KeyShot HDRI Editor (2024): https://manuals.keyshot.com/keyshot2024/manual/hdri-editor.html
2. KeyShot HDRI Editor Pins (2024): https://manuals.keyshot.com/keyshot2024/manual/hdri-editor-pins.html
3. KeyShot HDRI Editor Background (2024): https://manuals.keyshot.com/keyshot2024/manual/hdri-editor-background.html
4. KeyShot HDRI Editor Pins (2026): https://manuals.keyshot.com/kss2026/en-us/manual/hdri-editor-pins.html
5. KeyShot Environments tab (2026): https://manuals.keyshot.com/kss2026/en-us/manual/environments-tab.html
6. KeyShot Environments (2024): https://manuals.keyshot.com/keyshot2024/manual/environments.html
7. KeyShot blog, Understanding Studios & Environments: https://www.keyshot.com/blog/understanding-keyshot-studios-environments/
8. Poly Haven public API (queried 2026-10-13; counts computed by me): https://api.polyhaven.com/categories/hdris , https://api.polyhaven.com/assets?t=hdris ; schema https://raw.githubusercontent.com/Poly-Haven/Public-API/master/swagger.yml ; attributes https://raw.githubusercontent.com/Poly-Haven/Public-API/master/attributes.json ; README https://github.com/Poly-Haven/Public-API
9. Poly Haven HDRI categories: https://polyhaven.com/hdris
10. Poly Haven licence (CC0), FAQ and merger statement: https://polyhaven.com/license , https://docs.polyhaven.com/en/faq , https://polyhaven.com/
11. PolyStudio Pro (Superhive): https://superhivemarket.com/products/poly-studio-pro---hdri-maker--lighting-builder and its /docs
12. Procedural Studio HDRi: https://superhivemarket.com/products/procedural-studio-hdri
13. Latitude HDRI Studio docs: https://superhivemarket.com/products/latitude/docs
14. HDR Light Studio (Strata page, LightPaint; known from a search result summary, not fetched): https://www.strata.com/?p=10762
15. Radiance file formats (Ward Larson): https://radsite.lbl.gov/radiance/refer/filefmts.pdf ; also https://paulbourke.net/dataformats/pic/ and https://www.graphics.cornell.edu/~bjw/rgbe.html
16. (merged into 15)
17. OpenEXR: https://openexr.com/en/latest/TechnicalIntroduction.html , https://openexr.com/en/latest/OpenEXRFileLayout.html , licence https://github.com/AcademySoftwareFoundation/openexr/blob/main/LICENSE.md , envmap header mirror https://www.sidefx.com/docs/hdk/_imf_envmap_8h_source.html
18. pbrt-v4 and v3 infinite lights: https://pbr-book.org/4ed/Light_Sources/Infinite_Area_Lights , https://pbr-book.org/3ed-2018/Light_Sources/Infinite_Area_Lights
19. Preetham, Shirley, Smits, A Practical Analytic Model for Daylight (SIGGRAPH 1999): https://courses.cs.duke.edu/fall01/cps124/resources/p91-preetham.pdf
20. Hošek and Wilkie sky model: https://cgg.mff.cuni.cz/projects/SkylightModelling/ (archive `HosekWilkie_SkylightModel_C_Source.1.4a.zip` read for licence headers)
21. Bruneton precomputed scattering: https://github.com/ebruneton/precomputed_atmospheric_scattering , https://ebruneton.github.io/precomputed_atmospheric_scattering/
22. Bruneton, evaluation of 8 clear sky models (arXiv 1612.04336): https://ar5iv.labs.arxiv.org/html/1612.04336
23. Hillaire sky and atmosphere (MIT): https://github.com/sebh/UnrealEngineSkyAtmosphere
24. Prague sky model: https://cgg.mff.cuni.cz/publications/skymodel-2021/ , https://github.com/PetrVevoda/pragueskymodel
25. Scratchapixel, simulating the colours of the sky: https://www.scratchapixel.com/lessons/procedural-generation-virtual-worlds/simulating-sky/simulating-colors-of-the-sky.html
26. Jensen et al., A Physically-Based Night Sky Model: https://graphics.ucsd.edu/~henrik/papers/nightsky/
27. CIE standard general sky: https://www.cie.co.at/publications/cie-standard-overcast-sky-and-clear-sky , https://andrewmarsh.com/software/cie-sky-web/
28. Noise and clouds: Perlin, Improving Noise https://mrl.cs.nyu.edu/~perlin/paper445.pdf ; Worley https://cedric.cnam.fr/~cubaud/PROCEDURAL/worley.pdf ; Schneider and Vos 2015 https://www.advances.realtimerendering.com/s2015/The%20Real-time%20Volumetric%20Cloudscapes%20of%20Horizon%20-%20Zero%20Dawn%20-%20ARTR.pdf
29. Wikipedia: Lux https://en.wikipedia.org/wiki/Lux ; Orders of magnitude (luminance) https://en.wikipedia.org/wiki/Orders_of_magnitude_(luminance) ; Color temperature https://en.wikipedia.org/wiki/Color_temperature ; Planckian locus https://en.wikipedia.org/wiki/Planckian_locus ; Standard illuminant https://en.wikipedia.org/wiki/Standard_illuminant ; Solid angle https://en.wikipedia.org/wiki/Solid_angle ; Light meter https://en.wikipedia.org/wiki/Light_meter ; Three-point lighting https://en.wikipedia.org/wiki/Three-point_lighting ; Photographic lighting https://en.wikipedia.org/wiki/Photographic_lighting ; Softbox https://en.wikipedia.org/wiki/Softbox
30. Rust `f32` docs (sin/exp/powf "non-deterministic"; sqrt exact): https://doc.rust-lang.org/std/primitive.f32.html
31. Ramamoorthi and Hanrahan, irradiance environment maps: https://cseweb.ucsd.edu/~ravir/papers/envmap/
32. Reinhard et al. photographic tone reproduction (via man page): https://manpages.debian.org/jessie/pfstmo/pfstmo_reinhard02.1.en.html
33. Developer Certificate of Origin: https://developercertificate.org/
34. Daylight factor: https://www.velux.com/deic/daylight/daylight-calculations-and-measurements
35. Product photography lighting guide: https://candidstudios.net/product-photography-lighting-setup-guide
36. Repo files read: `/home/user/Repackshot/CLAUDE.md`, `docs/ROADMAP.md`, `docs/INTERIORS.md`, `docs/ARCHITECTURE.md`, `src/data/light-setups.ts`, `src/data/studios.ts`, `src/core/photometry.ts`, `engine/crates/rt-core/src/fmath.rs`, `engine/README.md`, `LICENSE`.