# Research: physical lens simulation (2026-10-13)

> Research report prepared for the lead, kept in English as it was written. The decisions are in `docs/STUDIO-TOOLS.md` and in `docs/ROADMAP.md`. The prescriptions come from expired patents and from Kolb et al. 1995; brand names are not used in the product.

# Physically based lens simulation for Repackshot: research report (read-only; nothing written to the repo)

Scratch material (scripts, patent PDFs, micro-benchmarks) is in `/tmp/claude-0/-home-user/9292497e-ab76-5535-bdee-b9953657075e/scratchpad/` (`pat/`, `bench/`, `papers/`, `bokeh/`, `wiki/`). It is not needed to use this report.

## 0. Method, confidence, headline findings

**How the data were checked**
- I read these primary sources in full: Kolb 1995, Zeiss/Nasse 2010, Merklinger 1997, Buhler/Wexler 2002, Hullin 2012, Lee/Eisemann 2013, Schrade 2016, Joo 2016 and Wilkie 2014.
- Ten lens prescriptions were retrieved from patent scans. I re-read each from the page image, not only the OCR.
- Every prescription was checked with my own paraxial trace (EFL and BFL against the patent's stated values) and a real-ray marginal trace (spherical-aberration sign and size).
- Where a check failed I say so, and I did not use that data.

**Not retrievable**
- Google Patents HTML was rate-limited.
- Hullin 2011, Steinert 2011 and Hanika 2014 PDFs returned 403 or an expired link. Statements about them rest on abstracts and on the papers that cite them. They are marked "(abstract only)".

**Headline findings**
1. A sequential real-lens trace gives nearly everything on the wish list as outputs: distortion, optical and mechanical vignetting, cat's-eye bokeh, lateral and longitudinal CA, spherical aberration and its bokeh signatures, and focus breathing. This is the Kolb/Mitchell/Hanrahan 1995 approach [K95]. Only wave effects (starburst, diffraction rings, orbs), surface imperfections (onion rings, dust) and flare ghosts need extra machinery.
2. **Verified prescriptions.** Thirteen of the sixteen prescriptions in §2.3 are transcribed from expired patents or Kolb's printed table and checked as above. P14–P16 are my own textbook-formula designs and are labelled as such.
3. **Spherical-aberration knob.** In the soft-focus patent design, moving one air gap sweeps marginal-ray spherical aberration from +3.3 % of f (over-corrected) through 0 to -8 % (under-corrected), with focus roughly preserved. This is a physical way to build an "SA character" slider (§2.3 P12).
4. **Dispersion model.** A two-term Cauchy model from (nd, vd) matches a catalogue crown to 1e-4 and a flint to 2e-3 at 400 nm (my calculation). Adding a third term and the "normal-line" partial dispersion cuts the flint error to 2e-4. Generic nd/vd values are therefore enough, with no brand glass names.
5. **Numerical stability in f32.** The textbook-stable sphere intersection `t = c·r² / (B + sqrt(B² − c²·r²))`, `B = N − c(Lx+My)`, gives about 1e-9 mm error in f32. The naive quadratic gives 1e-6 to 3e-4 mm. Use the stable form.
6. **Cost.** Scalar f32 tracing costs about 60 ns per surface per ray, so 0.4 µs (6 surfaces) to 1 µs (16 surfaces). An 8-wide batched version is about 5–9× faster. See §6.
7. **Dispersion and spectral sampling.** Hero-wavelength sampling degenerates to single-wavelength behaviour at dispersive Dirac interfaces [W14]. That is exactly what lens surfaces are. I recommend one stratified wavelength per camera ray and a hybrid RGB scene (§3.4).
8. **Determinism.** Rust documents `f32::sin/cos/powf/exp` as having "non-deterministic" precision (varies by platform and Rust version). `sqrt` and `mul_add` are exactly specified [RUST]. Lens math needs only + − × ÷ and sqrt.
9. **Repo state.** The engine currently has a thin-lens `Camera::generate_ray` (lens sample in the unit disk) and 8 `LENS_PRESETS` keys (focal and f-stop only). A grep of `engine/crates` for spectral, wavelength and hero found no spectral code. The existing per-pixel Owen-scrambled Sobol sampler [`sampler.rs`] is the right source for pupil and wavelength dimensions.

---

## 1. Taxonomy of bokeh types

**Unifying model.** An out-of-focus point renders as the lens's pupil seen through defocus. The image is the convolution of the sharp image with a set of "brushes", the circles of confusion (CoC). The brush depends only on distance, focus and the lens [M97]. A kernel has four ingredients:
- **Shape:** the intersection of the iris, any mask, and the element and barrel rims. The rims vary with field angle.
- **Density:** transmission and aberration-driven ray density over the pupil.
- **Displacement:** aberration-driven ray shift (coma and similar).
- **Wavelength:** dispersion changes the above per colour.

Moving through focus flips the orientation of the kernel. A triangular stop gives triangles pointing up in front of focus and down behind it [M97 Fig. 1]. Nasse shows the same for a pentagon [N10 p.34].

**Naming caution.** Sources disagree on "soap-bubble". Merklinger's and common usage is a bright ring with a hollow centre. Wikipedia's sentence ("brighter near the center... the latter 'soap-bubble'") reads the opposite [WP-Bokeh]. I follow Merklinger and Nasse for the physics.

**Which side is which.** Under-corrected spherical aberration (SA) [N10 pp.36–38]:
- Background (beyond focus): the blur disc is bright in the centre and fades outward, so it looks "creamy".
- Foreground (nearer than focus): a bright ring, which looks harsh. It also "generates swirls of small highlights and transforms lines into double lines".
- Over-correction reverses the two sides.

| # | Type | Look | Physical cause | Physical simulation | Cheap approximation | Sources |
|---|---|---|---|---|---|---|
| 1 | Circular disc | uniform disc | circular pupil, well-corrected | sample the exit pupil uniformly (Shirley concentric map) | thin lens with disc kernel | [N10], [M97], [K95 §4.2] |
| 2 | Polygonal, N blades; straight vs curved; rotation | N-gon, visible when stopped down; rounded blades approach a circle; orientation flips across focus | iris edges; curved blades make the opening nearly round | polygon or rounded mask in the stop plane, rotation parameter | polygon mask sampled by triangle fan (exact) or rejection; roundness κ = inradius/blade-arc radius (my parametrisation: κ=1 circle, κ→0 straight blade) | [N10 pp.31–34], [M97], [WP-Bokeh] |
| 3 | Cat's-eye or "lemon" (mechanical/optical vignetting) | towards the frame edge the disc becomes two circular segments; a pentagon becomes a composite shape; vanishes when stopped down | front and rear element rims and barrel clip the oblique beam | trace with real semi-apertures | pupil = stop circle ∩ second circle offset ∝ field radius | [N10 p.31], [WP-Vig] |
| 4 | Swirly (Petzval-type) | highlights stretched tangentially and arranged concentrically | **Cause not rigorously documented.** Practitioners cite strong off-axis vignetting plus astigmatism. The Helios 44 swirls although it is a Gauss-type | trace a Petzval-type prescription with realistic semi-apertures | field-dependent pupil rotation and elongation (artistic, "swirl" knob) | [WP-Petzval], [WP-Bokeh], forum evidence (low confidence): https://www.pentaxforums.com/forums/10-pentax-slr-lens-discussion/334715-what-lenses-swirl-3.html, https://opticallimits.com/vintage/vintage-lens-test-helios-44m-4-58mm-f-2/ |
| 5 | Soap-bubble / bright rim | bright ring, hollow centre | marginal rays focus beyond the paraxial focus (over-corrected SA), or foreground of an under-corrected lens | trace; ring-profile density | pupil density p(ρ) rising to the edge | [N10 pp.37–39], [M97 Fig. 9], [WP-Bokeh] |
| 6 | Bright centre, soft edge ("creamy") | soft disc edge, contours kept longer, but veiled contrast | under-corrected SA, background side | trace | Gaussian or falling p(ρ) | [N10 p.37–38], [M97], [BW02] |
| 7 | Onion rings | concentric rings inside discs | tooling and turning ridges on moulded aspheric surfaces | aspheric surface with a radial normal perturbation (virtual-grinding normal map) | radial ring modulation 1 + a·sin(2π r/p + φ) of the pupil weight | [N10 p.32], [J16 §1,4], https://petapixel.com/2014/05/07/panasonic-cuts-onion-fixes-strange-effect-caused-aspherical-lenses |
| 8 | Donut or ring (mirror/catadioptric lens) | ring discs, double images of fine structure | secondary mirror blocks the pupil centre | annular pupil, obscuration ratio ε (about 0.49 in the P11 example) | annular mask | [WP-Bokeh], [M97], [BW02], P11 |
| 9 | Anamorphic oval, plus horizontal streaks | vertical ovals; one-axis flare streaks | cylindrical afocal front group; flare from cylindrical surfaces | trace cylindrical surfaces (Hullin 2012 has a cylinder reflection/refraction case) | elliptical pupil (aspect ≈ squeeze), plus a 1-D horizontal kernel on highlights | [WP-Bokeh], [WP-Flare], [HHH12], [S16] (supports cylindrical elements); streak mechanism: practitioner sources https://bartwronski.com/2015/03/09/anamorphic-lens-flares-and-visual-effects/ (not read in full) |
| 10 | Apodized / smooth (STF, APD) | edgeless Gaussian-like discs | graded-transmission element; costs light (f/2.8 [T4.5]) | weight rays by pupil transmission T(ρ) | Gaussian kernel or density | [WP-Bokeh], [WP-Apod] |
| 11 | Coma-shaped (comet) | off-axis discs become comets pointing radially | coma | trace | pupil-dependent displacement (Seidel coma term, §3.2) | [WZH10] (abstract), [BW02] |
| 12 | Double-line / "nisen" / nervous | lines in the blur are doubled | ring-profile discs, which let edges of scene detail replicate | trace | ring-profile density | [M97], [N10 p.38] |
| 13 | Chromatic fringes | background: green rim with purple core; foreground reversed | longitudinal CA combined with SA | spectral trace | per-channel CoC size from per-channel focus shift | [N10 p.37, 39–40], [WZHX13] (abstract) |
| 14 | Creamy vs busy | smooth overlap vs hard discs and rings | density profile, SA, aperture, focus distance. Unpleasant backgrounds are sometimes unrelated to the lens | p(ρ) from the traced lens | user density profile | [N10 pp.38–40, Images 8–11], [BW02] |
| 15 | Textured (dust, scratches, filter, soft filter) | speckled discs, "orbs" | dust and lenslet bumps modulate the pupil | pupil phase or transmission texture | multiply the mask by tileable noise | [N10 p.32] (orbs, Softar filter), [J16] |
| 16 | Custom shapes (stars, hearts) | disc has the mask's shape | cardboard mask over the lens | mask image in the stop plane with 2-D inverse-CDF sampling | same | [WP-Bokeh], [M97 Fig. 2–4] |
| 17 | Multi-hole stop (sink-strainer) | spots that become radial streaks | perforated stop combined with SA | mask image | same | [M97 Fig. 7–8] |
| 18 | Diffraction edge ring, Airy | bright fringe at small stops, not from aberrations | wave optics | extra: FFT PSF (beyond a geometric tracer) | none | [N10 p.45 Image 5], [J16] (fractional Fourier transform) |
| 19 | Focus breathing and focus-dependent character | FOV and blur change with focus; SA changes with aperture and magnification | unit or internal focusing | moving groups in the prescription | scale f by (1+m) | [WP-Breathing], [K95 §3.3], [N10 pp.16, 40] |
| 20 | Variable-SA ("defocus control") and soft-focus | user-selected under or over-correction; "doughnut" blur if focus shift is uncompensated | one air gap or element shifted | see P12 | SA knob (aspheric plate) | [WP-Bokeh], US 4,214,814 p.6 |

For the "soft-focus" anchor, the Imagon is the concrete example. Its under-corrected SA gives a bright ring on the lens side of focus and a bright core behind it [M97].

---

## 2. Lens families and prescriptions

### 2.1 Families: typical counts and character

Counts are for the verified example unless a source is cited.

| Family | Elements / groups | Typical character | Prescription |
|---|---|---|---|
| Meniscus ("landscape") | 1 / 1 | Wollaston 1812; concave side outward, stop in front; reasonably sharp over a wide field at about f/11–f/16; uncorrected CA [WP-Hist] | P15 (computed) |
| Achromatic doublet | 2 / 1 | removes primary CA; flatter field in the reversed Chevalier form [WP-Hist] | P14 (computed) |
| Petzval portrait | 4 / 2–3 | first fast portrait lens, f/3.6 in 1840; centrally sharp, severe field curvature and astigmatism, about 30° field, vignetting, swirl [WP-Petzval], [WP-Hist] | P3 |
| Cooke triplet | 3 / 3 | corrects the five Seidel aberrations at one wavelength; no symmetry to help the designer; 6 surfaces so low flare [WP-Cooke] | P1 |
| Four-element split-rear (Tessar family) | 4 / 3 | cemented rear doublet; f/6.3 in 1902, up to f/2.8 by 1930; compact [WP-Tessar] | P2 |
| Five-element (Heliar-type) | 5 / 4 | symmetric modification of the triplet | P4 |
| Double Gauss, normal | 4–6 / 4 | most developed formula of the 20th century; main flaw is small oblique spherical aberration lowering peripheral contrast [WP-Gauss] | P5 |
| Double Gauss, fast | 7 / 6 | f/1.4; 13 surfaces so ghost-prone | P6 |
| Sonnar-type | 7 / 3 | fast, slightly telephoto; fewer air-glass surfaces; Zeiss describes the modern 1.5/50 as under-corrected [N10 p.37], [WP-Sonnar] | P7 |
| Telephoto | 7 / 5 | physical length shorter than f [WP-Tele] | P8 |
| Retrofocus (inverted telephoto) | 6 / 5 | negative front group; back focus longer than f; "retrofocus" was a trademark, generic term is "inverted/reversed telephoto" [WP-Hist] | P9 |
| Fisheye | 8 + plate / 7 | barrel distortion by design; mapping functions equidistant, equisolid, stereographic, orthographic [WP-Fisheye] | P10 |
| Catadioptric (mirror) | 2 mirrors + 2 glass | doughnut bokeh, no CA from mirrors, low contrast | P11 |
| Soft-focus (deliberate SA) | 6 / 5 | variable under or over-correction | P12 |
| Macro | 5 / 4 | flat field; floating element; effective f-number drops at high magnification | P13 |
| Anamorphic adapter | 2 cylinders | squeeze, oval bokeh, streak flare | P16 (computed) |
| Tilt-shift | n/a | a movement, not a design: tilt a lens or sensor plane, shift the lens | §2.4 |

**Macro breathing evidence.** At 1:2, a nominal f/2 macro becomes f/3.2 to f/3.6 effective (Zeiss example). Telephoto-type lenses lose more light close up [N10 pp.16–17].

### 2.2 Why the checks are credible
Taylor wrote that his triplet has a zonal aberration "at about halfway between the edge and center of the aperture" [US568052]. My real-ray trace of the transcribed prescription independently shows under-correction at 0.35–0.7 of the pupil and over-correction at the edge (§2.5). That matches his text. The same transcription also gives EFL 1.0031 f.

### 2.3 Prescriptions (all scaled to f ≈ 100 mm unless noted)

Columns: `R(mm)  d_to_next(mm)  nd  vd  semi-aperture(mm)`. `-` means air or not given; `inf` means plane. Positive R is convex toward the object.

```
# P1 Triplet — Taylor US 568,052 (1896), series I. f=100, F/3.7; stop right behind surf 4 (dia 17.7 at F/4)
# semi-apertures = patent "finished diameters"/2. Verified: EFL 100.31
 26.36   5.9   1.5108  62.1  14.1
 -150.7  10.9  -       -     14.1
 -29.77  0.2   1.6042  38.2  11.65
 24.15   12.5  -       -     11.65
 150.7   5.9   1.5108  62.1  13.65
 -26.36  end   -       -     13.65

# P2 Four-element split-rear anastigmat — Rudolph US 721,240 (1903). f=100, F/5.5, ~60 deg field
# stop in the 6.0 gap (3.0 each side). vd estimated by me from the patent's nD/nF/nG' values. Verified: EFL 99.25
 21.5    3.3   1.61132 58.8
 inf     1.9   -       -
 -74.2   1.1   1.60457 44.2
 20.8    6.0   -       -
 -111.3  1.1   1.52110 52.2
 25.2    3.0   1.61132 57.0
 -36.7   end

# P3 Petzval-type — Schade US 2,500,046 (1950, Kodak). f=100, F/2.0, field about 8-10 deg
# stop position not given (between components). Verified: EFL 99.98, BFL 56.45 (patent 56.5)
 70.97   15.0  1.523   58.6
 -56.79  4.5   1.617   38.5
 inf     49.3  -       -
 119.91  3.8   1.649   33.8
 40.87   0.9   -       -
 46.87   7.5   1.697   56.1
 -282.05 BF=56.5

# P4 Five-element anastigmat, Heliar-type — Tronnier US 2,645,156 via Lee & Eisemann 2013 Table 1
# nd only; vd unspecified in the source (estimated generic: ~58, ~38, ~48, ~41, ~54). Verified: EFL 99.24, BFL 81.3 (listed 81.857)
 30.810  7.700  1.652   ~58   14.5
 -89.350 1.850  1.603   ~38   14.5
 580.380 3.520  -       -     14.5
 -80.630 1.850  1.643   ~48   12.3
 28.340  4.180  -       -     12.0
 stop    3.000  -       -     11.6
 inf     1.850  1.581   ~41   12.3
 32.190  7.270  1.694   ~54   12.3
 -52.990 81.857 -       -     12.3

# P5 Double Gauss, normal — Smith, Modern Lens Design (1992) p.312, as printed in Kolb et al. 1995 Fig. 1
# semi-aperture = printed "ap" (diameter) / 2. Verified: EFL 100.72, BFL 72.21 (table 72.228); axial real rays from the back focus exit
# parallel to 1.7e-4 slope at h=10 mm. Real-ray marginal LSA = -0.03 % of f at h=20 mm
 58.950  7.520  1.670   47.1  25.2
 169.660 0.240  -       -     25.2
 38.550  8.050  1.670   47.1  23.0
 81.540  6.550  1.699   30.1  23.0
 25.500  11.410 -       -     18.0
 stop    9.000  -       -     17.1
 -28.990 2.360  1.603   38.0  17.0
 81.540  12.130 1.658   57.3  20.0
 -40.770 0.380  -       -     20.0
 874.130 6.440  1.717   48.0  20.0
 -79.460 72.228 -       -     20.0

# P6 Double Gauss, fast 7-element — Marquardt US 3,552,829 (1971). f=100, F/1.4 or faster; stop in 22.86 gap
# NOTE: indices are n_e (546 nm) and v_e, not d-line. Convert n_d ≈ n_e − 0.238·(n_F−n_C) (my fit on two glasses). Verified: EFL 100.00, BFL 73.4
 113.31  10.48  1.81500 45.2
 1200.0  1.13   -       -
 51.36   13.12  1.69400 54.6
 103.75  1.60   -       -
 169.20  4.51   1.63003 35.4
 34.59   22.86  -       -
 -38.95  5.71   1.79180 25.9
 492.04  12.37  1.80040 42.7
 -71.93  0.19   -       -
 -251.79 8.10   1.80040 42.7
 -75.25  0.19   -       -
 396.26  8.10   1.71615 53.7
 -126.05 end

# P7 Sonnar-type f/1.5 — Bertele US 1,975,678 (1934; German priority 1932). f=100, ~42 deg; stop in the 13.9 gap
# READING CAUTION: nd of the 3rd element is printed 1.4075 (OCR "1.4615"); with 1.4075 EFL = 100.33, with 1.4675 EFL = 96.96 -> 1.4075 adopted.
# Real-ray marginal LSA = +2.7 % of f (over-corrected edge) — treat as experimental until a second scan confirms.
 65.0    10.5   1.6375  56.1
 416.77  0.5    -       -
 37.26   11.7   1.6727  47.3
 104.34  7.6    1.4075  65.7
 -247    1.9    1.6890  31.0
 22.14   13.9   -       -
 1904.0  3.4    1.5481  45.9
 59.85   22.4   1.6578  51.2
 -22.06  8.4    1.5488  63.0
 -89.06  end

# P8 Telephoto, internal focus — Nakamura US 4,113,357 (1978) Ex.1. f=100, F/5.6
# focus 1/10: d5 17.518 -> 19.0177 and d10 2.777 -> 1.2768 (my trace: EFL 99.96 -> 89.58, i.e. -10.4 % breathing). BFL 44.7; track ≈ 73.6 (<f)
 36.366  2.25   1.50032 81.9
 -90.941 0.05   -       -
 31.549  2.42   1.50032 81.9
 -56.162 0.5    1.7495  35.0
 127.820 17.518 -       -
 -44.096 1.0    1.69895 30.0
 -13.345 0.333  1.6425  58.1
 37.760  0.833  -       -
 357.048 0.333  1.6968  55.6
 24.316  2.777  -       -
 -61.058 0.833  1.50032 81.9
 -16.3995 end

# P9 Retrofocus, Table I — Angénieux US 2,649,022 (1953). f=100, F/2.5, 65 deg, stated back focus 105
# Verified: EFL 101.06, BFL 106.15 (+/-1 %). Table II (f/2.2, 65 deg) also checked: EFL 100.79
 180.48  6.33   1.6145  59.8
 84.06   93.18  -       -
 114.40  9.12   1.6243  46.8
 -415.25 0.51   -       -
 69.18   17.22  1.6226  53
 237.45  9.12   -       -
 -93.48  4.30   1.6141  37
 50.54   10.13  -       -
 404.42  2.28   1.6287  35.3
 38.74   16.20  1.6391  55.8
 -55.20  end

# P10 Fisheye 180 deg — Horimoto, Minolta US 4,256,373 (priority 1977), embodiment 2. f=100, F/2.8
# stated back focus 241.8. Verified: EFL 99.99, BFL 241.86. Plane plate rows are a filter/diaphragm region.
 693.12  12.81  1.713   53.93
 73.42   57.0   -       -
 119.31  9.61   1.618   63.38
 74.88   32.02  -       -
 173.92  41.63  1.60342 38.01
 -82.57  9.61   1.61762 52.65
 -1746.7 9.61   -       -
 inf     8.97   1.5186  60.1
 inf     19.21  -       -
 -230.02 16.65  1.48749 70.15
 -110.58 0.64   -       -
 -4314.6 6.4    1.80518 25.43
 162.06  19.21  1.5168  64.12
 -176.48 0.64   -       -
 297.24  25.62  1.48749 70.15
 -330.07 end

# P11 Catadioptric Cassegrain with Mangin secondary — Steglich US 2,761,354 (1956). f=100, F/6.3; indices are N_e
# patent sign convention (negative = concave to the light travelling in that pass); in a global frame the secondary radii flip sign.
 M1 mirror  R=-117.0   29.7 to secondary
 S1 glass   R=-66.9    Ne 1.6465  V 48.0   t=1.0
 S2 glass   R=-22.0    Ne 1.5148  V 60.0   t=1.0
 M2 mirror (rear face of S2)  R=+397.3 (convex to the incident light)
# Verified in a folded-path trace: EFL 100.14; image falls 16.2 mm behind M1's vertex through a central hole.
# Secondary dia ≈ 49 % of aperture (24 % area obscuration), my paraxial calculation.

# P12 Variable soft-focus (Tessar-type group A + meniscus-pair group B) — Ogino et al., Minolta US 4,214,814 (1980) Emb. 1
# f=100, F/2.8, 2w=28 deg. dB0: normal = 3.53; soft-focus = 8.24 (patent) — slide it to dial SA
# my trace: EFL 99.5 (-0.5 %), BFL 86.87 vs patent 87.38 (small offset in both modes; one digit may differ)
 63.602  8.84   1.7495  49.2
 -236.814 10.0  -       -
 -47.868 3.29   1.6477  33.9
 50.192  7.49   -       -
 -80.85  2.59   1.5407  46.8
 48.841  10.94  1.72    50.3
 -34.352 dB0    -       -
 -32.005 3.29   1.5762  41.4
 -57.007 0.12   -       -
 -262.488 5.88  1.6935  53.4
 -69.722 end
# measured marginal LSA / f vs dB0 (my real-ray trace at f/2.8): 1.0 -> +3.3 % ; 3.53 -> -0.4 % ; 6.0 -> -3.5 % ; 8.24 -> -5.9 % ; 10.59 -> -8.0 %

# P13 Macro with floating element — Nakamura, Olympus US 3,884,557 (1975) Emb. 1. NATIVE f=51.78 (not scaled)
# standard design magnification 0.1. floating (mag 0.2): d5 10.90 -> 10.775 and d7 0.20 -> 0.325.
# Verified: EFL 51.779 (patent 51.78); floated EFL 51.688 (patent 51.688) — exact match
 24.549  4.13   1.72000 43.70
 47.203  0.25   -       -
 14.356  4.26   1.67003 47.25
 70.080  1.30   1.67270 32.10
 9.613   d5=10.90 -      -     (stop in this gap)
 -10.177 1.54   1.76182 26.55
 -13.869 d7=0.20 -      -
 -54.008 3.66   1.67000 57.33
 -15.167 end    (BFL 37.15)
```

**My own textbook-formula designs (not from a patent)**

```
# P14 Achromatic cemented doublet f=100, f/6 (generic glass). Crown nd 1.517 vd 64.2; flint nd 1.620 vd 36.4
# thin-lens split phi1 = phi*V1/(V1−V2), phi2 = −phi*V2/(V1−V2) (Smith, Hecht); shape chosen for zero marginal LSA.
 48.0    4.0   1.517   64.2
 -41.96  2.5   1.620   36.4
 -368.1  end                  (EFL 100.00, marginal LSA 0)
# P15 Single meniscus ("landscape"), n=1.517, t=3.0; stop 25 mm in front; f/11 (D=9.1 mm)
# chosen by a meridional spot-size scan over R1 and stop distance; EFL 99.1; concave side toward the object
 -200.0  3.0   1.517
 -41.0   end
# P16 2x afocal cylindrical front adapter (squeeze axis only; the other meridian is plane)
 -25.85  3.0   1.517    (plano-concave cylinder, concave toward the scene)
 inf     46.045 -       (air gap; afocal)
 inf     3.0   1.517    (plano-convex cylinder)
 -51.70  end
# my paraxial check: angular magnification 0.5000, pupil width magnification 2.000 in the squeeze meridian.
```

**What was not verified.** Canon retrofocus US 4,206,973 failed the paraxial check (EFL negative) and its ninth lens came out negative though the patent calls it positive. I did not use it. For macro and others I extracted only what is listed; no Tessar-type or Planar-type patent data for Tessar-family lenses beyond P2.

### 2.4 Tilt-shift (movement, not a design)
- Scheimpflug rule: film plane, lens plane and plane of sharp focus meet in one line. Hinge rule: plane of focus, the lens's front focal plane and the plane through the lens parallel to the film meet in one line (the hinge line). Required tilt: α = arcsin(f/J), approximately f/(5·J) degrees with f in mm and J in feet [LENSNOTES].
- In a trace-from-sensor renderer: tilt the sensor plane about a hinge axis and offset the lens axis for shift. The plane of focus and the image-circle cut-off (shift reveals the vignetting edge) then come out of the geometry, provided real semi-apertures are in the prescription.
- Rotational-symmetry shortcuts (radial pupil bounds, §3.5) no longer apply with tilt or shift; use a 2-D pupil map over film position.

### 2.5 Real-ray spherical-aberration character of the verified designs (my traces)
Marginal-ray longitudinal SA as a fraction of f, at 0.35, 0.7 and 1.0 of the stated stop radius. Negative means under-corrected, positive over-corrected.

| Design | 0.35 | 0.7 | 1.0 |
|---|---|---|---|
| Triplet f/3.7 | -0.29 % | -0.68 % | +1.14 % |
| Four-element split-rear f/5.5 | -0.19 % | -0.51 % | -0.10 % |
| Petzval-type f/2 | -0.08 % | -0.20 % | +0.10 % |
| Sonnar-type f/1.5 (flagged) | 0.00 % | +0.70 % | +2.71 % |
| Gauss (Smith) | -0.05 % | -0.13 % | -0.03 % |
| Fast Gauss f/1.4 | -0.09 % | -0.18 % | +0.10 % |
| Telephoto f/5.6 | -0.01 % | -0.02 % | -0.02 % |
| Retrofocus f/2.5 | -0.15 % | -0.24 % | +1.82 % |
| Five-element (Heliar-type) | -0.11 % | -0.39 % | -0.60 % |

This is directly usable as a regression test and as input to "which bokeh character does each family have" (§1).

### 2.6 Licensing caveats (not legal advice; the lead to confirm)
- **Facts vs databases.** Raw numbers are facts, which are not copyrightable in the US [Feist v. Rural Telephone, 499 U.S. 340 (1991), cited from memory]. The EU adds a sui generis database right for a substantial-investment compilation (Directive 96/9/EC, cited from memory). Re-keying each prescription from its own patent, with patent number and date as provenance, avoids both. Do not bulk-import a third-party curated lens database.
- **Expiry.** Every patent above was filed 1895–1978. The US term is 20 years from filing for filings after 7 June 1995, and 17 years from grant for earlier grants, so all are long expired. Google's metadata showed "Expired - Lifetime" for US 4,256,373. US patent text is generally not copyright-restricted apart from notices permitted by 37 CFR 1.71(d)–(e) (from memory; verify).
- **Examples are not products.** Patent embodiments differ from shipped lenses. Treat them as representative designs.
- **Names.** Tessar, Sonnar, Planar, Biotar, Heliar, Cooke and Imagon are trademarks. Use neutral names in the UI (Triplet, four-element split-rear, Gauss 6/7, Sonnar-type only as a tooltip if at all). "Petzval" and "Gauss" are surnames and widely used generic design names.
- **Glass.** Catalogue glass names (BK7, F2 and similar) are manufacturer designations. Store (nd, vd, optional ΔP_gF) only. The refractiveindex.info database is CC0 (verified at its GitHub README) if you ever want measured Sellmeier data [RID].

---

## 3. Aberrations and how to render them

### 3.1 The standard approach: sequential ray tracing [K95]
- A lens is a table of surfaces: radius, thickness, glass and semi-aperture. Rays are traced from the film plane through each surface in order. Visibility order is known, so there is no search.
- Per surface: transfer to the vertex plane, intersect the sphere, reject if outside the clear aperture, refract. Kolb counts "two square roots per surface" and reports about 10 % of rendering time at 16 rays/pixel in 1995 [K95 §3.1, §5].
- Radiometry: sample the exit pupil (a disc) and weight by cos θ cos θ'' / ‖x'' − x'‖² (Kolb eq. 5–6). With a flat pupil perpendicular to the axis this becomes cos⁴θ / Z². Kolb's importance-sampled variant gave only about 1 % noise reduction and was judged not worth the complexity [K95 §4.2]. For his double Gauss at full aperture, vignetting reduced edge exposure to about one third of the cos⁴ estimate [K95 §4.1, Fig. 7].
- Exit-pupil geometry: aiming rays at the aperture stop or at the rear element is wrong or wasteful. Use the exit pupil (the image of the stop through the rear groups). A thick-lens approximation of the rear groups gives it, but fails for lenses whose pupil shape or position moves with field angle; fall back to the rear element in that case [K95 §3.4].
- Unit-focus lenses lengthen the extension and narrow the field of view when focusing closer [K95 §3.3]. Breathing therefore comes free with a prescription whose focus group moves.
- Aspheric surfaces have no closed-form intersection. A bracketed root-finder with tight proxy surfaces works even in low-precision floats [J16]. Sag: `z(r) = c r² / (1 + sqrt(1 − (1+κ)c²r²)) + Σ A₂ᵢ r²ⁱ` [J16 eq. 1]. Cylindrical surfaces are supported by both [HHH12] and [S16].
- Textbook note: pbrt's book chapter 6.4 describes the same pipeline and pre-computed exit-pupil bounds along the film radius [PBR]. Read it only as exposition. Do not copy its code or its lens data (project rule 8b).

### 3.2 Seidel aberrations: where each comes from and a cheap override model
In wavefront terms the five monochromatic aberrations are the standard terms `W = W040 ρ⁴ + W131 h ρ³ cosφ + W222 h² ρ² cos²φ + W220 h² ρ² + W311 h³ ρ cosφ` (pupil radius ρ, angle φ, field height h). The transverse ray error is proportional to the gradient of W. This is standard (Welford 1986; Born & Wolf; Smith, *Modern Optical Engineering*) and is the basis of Hullin's polynomial optics [HHH12].

| Aberration | What it does | Emerges from tracing as | Cheap or artistic handle |
|---|---|---|---|
| Spherical (W040) | veil, glow, bokeh density changes | prescription, semi-apertures | aspheric plate at the stop, `z = A r⁴`; ray slope error = 4(n−1)A h³ so transverse error = 4(n−1)A h³ f' (my derivation; A=1e-6 mm⁻³, n=1.5, h=10 mm, f=100 mm gives 0.2 mm) or the P12 air gap |
| Coma (W131) | comet shapes, asymmetric blur | prescription | pupil-dependent image shift ∝ h·ρ²(2+cos2φ), h·ρ² sin2φ |
| Astigmatism (W222) | tangential and sagittal blur differ | prescription | ∝ h²·ρ, one meridian |
| Field curvature (W220) | defocus varies with radius | prescription (Petzval sum) | field-dependent defocus term |
| Distortion (W311) | barrel, pincushion, moustache | prescription | radial map `r' = r·(1 + k1 r² + k2 r⁴ + …)` (Brown–Conrady, cited from memory) or the lensfun polynomial form [S16 refs] |
| Lateral CA | per-colour magnification | dispersion | per-channel scale (λ-dependent) |
| Longitudinal CA | per-colour focus; purple core and green rim in bokeh | dispersion | per-channel defocus offset |
| Natural vignetting | cos⁴θ falloff (about −0.83 EV at 30°, −1.54 EV at 40°, −2.55 EV at 50°; my arithmetic) | radiometric weighting | analytic |
| Optical/mechanical vignetting | cat's-eye shapes, darkening | semi-apertures | second-circle clip ∝ field radius |

Retrofocus designs and telecentric designs are less prone to natural vignetting [WP-Vig]. Distortion types and fisheye mapping functions (equidistant, equisolid, stereographic, orthographic) are listed in [WP-Fisheye]. The tangible mapping for a fisheye in a path tracer is simply the traced prescription; these formulas are for the override.

### 3.3 Dispersion models
- Abbe number: `vd = (nd − 1)/(nF − nC)` at 587.56, 486.13 and 656.27 nm [WP-Abbe].
- Cauchy `n = A + B/λ² (+ C/λ⁴)` and Sellmeier `n² = 1 + Σ Bᵢλ²/(λ² − Cᵢ)` [WP-Cauchy], [WP-Sell]. Sellmeier needs only + × ÷ and sqrt, so it is deterministic.
- **From (nd, vd):** `B = (nd−1)/(vd (1/λF² − 1/λC²))`, `A = nd − B/λd²`. Tested against the published coefficients for a crown (nd 1.51680, vd 64.17) and a flint (nd 1.62004, vd 36.37) [coefficients as on the Sellmeier Wikipedia page for the crown; the flint set I used reproduced the catalogue nd/vd exactly, which validates them]:

| λ (nm) | crown error (2-term) | flint error (2-term) | flint error (3-term + normal-line P_gF) |
|---|---|---|---|
| 400 | +9e-5 | −2.2e-3 | −2.1e-4 |
| 440 | +1e-4 | −7e-4 | −1.2e-4 |
| 550 | 0 | +4e-5 | −7e-5 |
| 700 | +1.3e-4 | −1.9e-4 | +3.5e-4 |

  The 3-term model fits `n(λ) = A + B/λ² + C/λ⁴` through d, F and g (435.8 nm) using `P_gF = 0.6438 − 0.001682·vd` (Schott "normal line", from memory; consistent with the true P_gF I computed: 0.5349 crown, 0.5828 flint). A glass parameter ΔP_gF added to that normal line lets you build apochromat-like (low secondary-spectrum) lenses and reduce purple/green fringing.

### 3.4 Spectral sampling to get CA in an RGB renderer
- Hero-wavelength sampling [W14]: four wavelengths per path at equal spacing, one random hero drives sampling. They state it "degenerates to using only the hero wavelength" for dispersion through Dirac interfaces, which is exactly what refraction at a lens surface is. Its benefit is therefore small for lens CA.
- Lee & Eisemann render CA by treating R, G, B independently at 650, 510 and 475 nm with Sellmeier indices, three-pass or single-pass [LE13]. Schrade et al. add λ as a fifth polynomial variable [S16].
- **My recommendation (engineering judgement, not a source).** Keep the scene RGB. Per camera sample choose one wavelength λ, taking the dimension from the existing Sobol stream so it is stratified across pixels and samples. Trace the lens at λ, then trace the scene along that ray, and accumulate `L_rgb · s_c(λ)/pdf(λ)`, where `s_c(λ)` are smooth non-negative channel weights with ∫s_c = 1. This costs no extra scene traces. It is exact if scene colour is piecewise constant across each channel's band. It fails only for spiky spectra, which a scene already stored as RGB cannot represent anyway.
- If the engine later becomes spectral, the same single-wavelength-per-camera-ray scheme extends directly. Use the Wyman–Sloan–Shirley analytic CIE fits [JCGT 2013, cited from memory] or Jakob–Hanika spectral upsampling [CGF 2019, cited from memory]. The relative colour noise is the same as any single-wavelength spectral path tracer.

### 3.5 Efficient exit-pupil sampling
1. **Concentric disc mapping** (Shirley) for round pupils. Kolb measured 15 % lower RMS error than the polar mapping [K95 §4.2].
2. **Mask apertures** (polygons, stars, hearts): importance-sample the mask by a 2-D inverse CDF driven by two Sobol dimensions. This keeps stratification better than rejection from the bounding disc.
3. **Polygon:** choose a triangle of the fan and sample uniformly in it. For N ≥ 5 the polygon fills at least 76 % of its circumscribed circle (my arithmetic), so rejection is also cheap.
4. **Exit-pupil bounds along the film radius**, pre-computed per focus and aperture, then rotated by film angle [PBR §6.4.5 describes 64 segments × 1024² points; my cost estimate for that is 67 M traces, about 50 s scalar or 7 s batched, so use a coarser grid such as 32 × 256² = 2.1 M traces, about 0.2–1.6 s]. Valid only for rotationally symmetric lenses.
5. **Tabulated pupil sampling** [SDHL11] requires "significant precomputation and storage for every focus distance and aperture stop" [S16 §2].
6. **Polynomial maps to the aperture and outer pupil** [HHH12], [S16]: fit a 5-D light-field polynomial (x, y, dx, dy, λ). Schrade used up to degree 15 with at most 40 coefficients per output and tested a fisheye and an aspheric fisheye [S16].

### 3.6 Polynomial optics
- Hullin: Taylor expansion of the ray map in (x, y, dx, dy), concatenated and truncated to degree n; degree 3 captures the textbook aberrations, degree 5 changes the outcome only marginally for far more cost. Accuracy is best near the axis and degrades in the extreme periphery [HHH12].
- Schrade: sparse orthogonal-matching-pursuit fits replace a Taylor expansion and allow degree 11–15, but "single-precision floating point variables are not precise enough" for the fitting step [S16 §5]. Fit offline in f64 and quantise to f32 for evaluation. Rule 8b says f32 everywhere, so this is a judgement call for the lead (see §7).
- Polynomials excel at cheap evaluation (one 200-term evaluation per ray) and at flare. They lose exactness for aspheric or extreme designs unless the degree rises [HHH12], [S16].

---

## 4. Coatings and flare

### 4.1 Reflectance per air-glass surface
- Fresnel at normal incidence `R = ((n−1)/(n+1))²`. Computed: n=1.5 → 4.0 %; 1.6 → 5.3 %; 1.7 → 6.7 %; 1.8 → 8.2 %; 1.9 → 9.6 %. High-index glass reflects more [WP-AR].
- **Single quarter-wave layer.** Ideal index is √n_glass (about 1.23 for crown, which no durable solid reaches). MgF₂ (n = 1.38) is the practical choice [WP-AR]. Residual reflectance `((n_c² − n_s)/(n_c² + n_s))²`: n_glass 1.5 → 1.41 %; 1.6 → 0.75 %; 1.7 → 0.32 %; 1.8 → 0.08 % (my arithmetic).
- **Multilayer:** reflectivities "as low as 0.1 %" at one wavelength and broadband designs exist but are complex [WP-AR]. Real coatings reach under 0.1 % at best [WP-AR].
- **Thin-film spectra** (my transfer-matrix calculation, s-polarisation, glass n = 1.52, MgF₂ quarter-wave at 550 nm):

| λ (nm) | uncoated | single MgF₂ | 3-layer (1.38 / 2.05 half-wave / 1.65) |
|---|---|---|---|
| 400 | 4.26 % | 2.21 % | 3.54 % |
| 450 | 4.26 % | 1.62 % | 0.25 % |
| 550 | 4.26 % | 1.26 % | 0.09 % |
| 650 | 4.26 % | 1.44 % | 0.07 % |
| 700 | 4.26 % | 1.60 % | 0.21 % |

  The single layer gives a strongly coloured residual (violet and red edges). The multilayer is nearly clear in the middle and strongly coloured at the blue edge. Oblique incidence worsens it: single layer at 50° is about 4.8–6.3 %. Coatings therefore lose effect at large angles and colour effects appear obliquely [WP-AR]. Hecht, *Optics* and Macleod, *Thin-Film Optical Filters* give the characteristic-matrix method.
- **Colour and contrast.** Each coating's R(λ) and T = 1 − R(λ) is a spectral curve, so ghost colour (purple, green, amber) is a product of two surface curves. Colour cast of transmitted light is the product of T(λ) over all surfaces [LE13, HESL11 abstract].

### 4.2 Surface count: ghosts and veiling glare
- Ghosts need an even number of reflections to reach the sensor. Two-bounce ghosts dominate [LE13]. For N air-glass surfaces there are `N(N−1)/2` two-bounce pairs [counted by pairs; blog statement https://fstoppers.com/education/lens-flare-and-incredible-physics-modern-lenses-903821]. N=12 gives 66, 14 gives 91, 20 gives 190.
- Ghost intensity is about R₁R₂ (uncoated 0.04² = 1.6e-3, multi-coated 0.005² = 2.5e-5), spread over a defocused patch whose shape is the aperture [LE13].
- Direct transmission through N surfaces, T = (1−R)^N (my arithmetic):

| Surfaces | uncoated (4 %) | MgF₂ (1.4 %) | multi-coat (0.5 %) | multi-coat (0.2 %) |
|---|---|---|---|---|
| 6 | 78 % | 92 % | 97 % | 99 % |
| 12 | 61 % | 84 % | 94 % | 98 % |
| 20 | 44 % | 75 % | 90 % | 96 % |
| 30 | 29 % | 66 % | 86 % | 94 % |

- T-stop = f-number / √T. Twelve uncoated surfaces cost about 0.7 stop. The same lens multi-coated costs under 0.1 stop. An apodization element also lowers T: the STF lens is f/2.8 but T4.5 [WP-Bokeh].
- Veiling glare is stray light that reaches the focal plane by wrong paths, from lens-surface and mount reflections, scratches, dirt and imperfect transparency. It lowers contrast and saturation [WP-VG], [WP-Flare]. Lenses with many elements (zooms) flare more [WP-Flare].

### 4.3 Physically based flare rendering and approximations
- **Hullin et al. 2011** [HESL11] (abstract only): interactive physically based flare including aberrations, imperfections and AR coatings, via bundle tracing of ghost paths, a precomputed grid and thin-film intensity. Lee & Eisemann describe its reference pass as a 512×512 ray grid with "several hours" of preprocessing for complex lenses.
- **Hullin et al. 2012** [HHH12]: polynomial flare in about 1 s (up to 4 s for complex lens models in Lee & Eisemann's summary).
- **Lee & Eisemann 2013** [LE13]: first-order matrix approximation, 297 fps against 4.1 fps for the reference, 10–70× speedups, ghost position/size/colour captured. Limitations: no nonlinear deformation, one colour per ghost, paraxial errors above about 10°. Pipeline: per ghost a flare quad, aperture texture lookup, entrance-pupil clipping, AR colour per ghost, starburst by Fraunhofer (FFT of the aperture) precomputed per wavelength.
- **Cheaper approximations:** hand-placed sprites along a line through the image centre (long used in games [LE13 §2]); culling low-intensity ghosts gave a further 34 % speedup with low visual impact [LE13 Fig. 9].
- **Suggested for a path tracer:** keep the main estimator ghost-free (ghost path probability is tiny). Add a separate deterministic flare pass for the brightest emitters (small area lights, HDRI hot spots): fixed ray grid, ghost list from the surface pairs, Fresnel or thin-film weights per wavelength, splat additively. This is deterministic by construction if the grid and splat order are fixed.

### 4.4 Starburst (diffraction spikes)
- Each straight aperture edge diffracts light perpendicular to it, giving two spikes 180° apart. Even blade counts therefore give N spikes (opposite pairs coincide); odd counts give 2N [WP-Spike]. Examples from the article's captions: 5 → 10, 6 → 6, 7 → 14, 8 → 8, 9 → 18, 4 → 4.
- Spike length scales with λ, so they carry a rainbow fringe. Physically it is `|FT(aperture mask)|²` per wavelength [LE13]. A geometric tracer does not make spikes; add them as an FFT convolution of bright highlights, or as a texture.
- Zeiss also notes that Airy-type edge brightening at small stops is diffraction, not aberration [N10 p.45].

### 4.5 Bloom and halation
- Veiling glare and bloom are the lens or eye point-spread-function tails. A convolution of HDR highlights with a wide PSF is the physical model (Spencer, Shirley, Zimmerman & Greenberg, "Physically-based glare effects for digital images", SIGGRAPH '95, pp. 325–334; from memory).
- Halation is a film effect, not a lens effect: light passes through the emulsion, reflects off the film base and re-exposes it, producing a halo around bright points. The anti-halation backing exists to absorb that light [WP-AHB]. Model it as a separate post step with a coloured, narrower kernel.

---

## 5. Proposed lens-editor parameter set (no brand names)

**Preset record** (keys stable, additive only, per rule 7):
- `key`, `family`, `name{es,en}`, `source{doc,year}`
- `surfaces[]`: R, d, glass `{nd, vd, dPgF?}` or air, semi-aperture, kind `sphere|plane|asphere{κ,A4…}|cylinder{axis}|mirror`, coating id, role `normal|stop`
- Reference focal length, f-number, image circle
- `focus`: `unit | internal | floating` with the moving surfaces and travel curve
- `iris`: blades, roundness, rotation, f-number range
- `overrides{}` (artistic set below)
- Optional fast-mode profile fitted offline from the traced lens (§6.4)

**Physical outputs of the traced lens** (display them only from engine values, per rule 10; mark them "coming soon" in the preview, which cannot trace):

| Output | How obtained |
|---|---|
| Effective focal length, back focus, f-number, T-stop | paraxial trace and coating transmittance |
| Distortion curve (%) | trace of chief rays over field |
| Relative illumination vs. field | trace with semi-apertures plus cos⁴ weight |
| Lateral and longitudinal CA | spectral trace |
| SA, coma, astigmatism, field curvature | trace |
| Bokeh shapes (cat's-eye, bright ring, creamy) | trace |
| Focus breathing | focus-group motion |
| Ghost positions and colours | flare pass |
| Aperture-dependent behaviour (stopping down changes SA, vignetting, bokeh) | trace |

**User-set physical inputs:**

| Parameter | Meaning |
|---|---|
| Lens family / preset | picks the prescription |
| Focal length | uniform scale of all lengths, f/# preserved |
| Maximum aperture | stop semi-aperture; coupled to semi-apertures |
| f-number | stop radius |
| Blade count (3–18 or circle), roundness κ, rotation | iris shape (§1) |
| Aperture mask image | custom shapes; importance sampling |
| Apodization profile | radial transmission; drives T-stop |
| Annular obscuration ratio ε | mirror lenses |
| Coating type | none, single MgF₂ quarter-wave, multi-layer (per-surface R(λ)) |
| Focus distance | |
| Tilt and shift | sensor tilt about a hinge axis, lens shift |
| Anamorphic squeeze | adds the cylindrical afocal group (P16) |

**Artistic overrides** (labelled non-physical in the UI; each defaults to 0 / off and is applied on top of the traced result):

| Override | Implementation |
|---|---|
| CA amount | scale dispersion: use (n−1)/vd·k, equivalently vd/k |
| Distortion amount / polynomial | radial remap of ray direction |
| Vignetting amount | extra radial falloff or semi-aperture scale |
| Swirl | field-dependent rotation and elongation of the pupil |
| SA character, −1 under to +1 over | aspheric plate at the stop (`A4`), or the P12 air-gap travel |
| Flare/ghost strength | multiplier on coating R, or on flare-pass intensity |
| Focus breathing amount | scale on the focus-group travel effect |
| Onion-ring amplitude | normal-map or ring modulation |
| Dust and scratch | pupil transmission texture |

**Stability and honesty rules:** an override never changes the stored prescription. Overrides are saved with the preset so a saved lens is the physical lens plus a visible list of non-physical adjustments.

---

## 6. Practical notes for a CPU path tracer

### 6.1 Measured cost (my micro-benchmark, scratchpad only, not engine code)
Single thread, 2.8 GHz Xeon VM, f32, stable sphere intersection plus vector refraction plus aperture test. Numbers are indicative; the VM is noisy.

| Case | ns per ray | ns per surface |
|---|---|---|
| Scalar, 6 surfaces (triplet) | 390 | 65 |
| Scalar, 11 surfaces (Gauss) | 690–756 | 63–69 |
| Scalar, 13 surfaces (fast Gauss) | 830 | 64 |
| Scalar, 16 surfaces (fisheye, 43 % rays pass) | 970 | 60 |
| 8-wide batched (auto-vectorised, baseline SSE2), 11 surfaces | 81–156 | 7–14 |

- Scalar speed is latency-bound: two sqrt and three divides per surface. Batching independent rays gave 5–9×.
- The benchmark validated itself: axial rays from the Smith double Gauss's back focus exited parallel to 1.7e-4 slope (spherical aberration only).
- For context, Kolb reported the lens at about 10 % of total render time in 1995 [K95 §5]. Relative to scene traversal at about 1–3 µs per ray, I expect roughly 10–30 % overhead unbatched. That scene figure is an assumption, not measured.

### 6.2 Precomputation worth doing
- At lens load: cardinal points, entrance and exit pupil (Kolb), per-surface T(λ), the ghost-pair list, normalised stop and mask CDFs.
- On focus or aperture change: exit-pupil bounds per film radius (see §3.5 for the cost). Union the bounds across the sampled wavelengths.
- Optional offline: fitted fast-mode profile, or a polynomial (§3.6).

### 6.3 Determinism (rule 8b)
- Take lens, wavelength and mask dimensions from the existing per-pixel Owen-scrambled Sobol stream. Reserve fixed dimension indices. "Nothing depends on threads, tiles or order" (`sampler.rs`).
- Use only + − × ÷ and sqrt in lens tracing. Rust guarantees `sqrt` and `mul_add` exactly; `sin`, `cos`, `powf`, `exp` are "non-deterministic ... varies by platform, Rust version" [RUST]. Sellmeier and Cauchy need only + × ÷ and sqrt. Any trig for iris or mask setup should use project-owned deterministic implementations.
- Do not use fast-math. Autovectorisation of the above ops gives bit-identical results to the scalar path (no fusion by default); keep a scalar-vs-batch bit-equality test.
- Suggested tests: paraxial EFL and BFL vs patent values within 1 %; real-ray SA sign and magnitude vs §2.5; f32 vs f64 intersection residual below 1e-4 mm; wasm vs native identical pixels.

### 6.4 Keeping a thin-lens fast mode
Keep the existing thin-lens path bit-identical. Add a lens variant behind the same call (ray plus weight):
1. **Thin lens** (current): disc kernel, optional cos⁴.
2. **Fitted fast mode** (new): a few numbers from one offline pass over the traced lens: effective focal length and entrance-pupil position (Kolb's thick-lens cardinal points), distortion polynomial, relative-illumination curve, per-channel focus shift and magnification, radial SA density, cat's-eye clip offset. Cheap, WebGL-previewable, and consistent with the physical lens because it is fitted from it.
3. **Traced lens**: full sequential trace.

The fast profile makes the preview and final render agree in broad strokes, and lets the lens editor show a preview when the wasm engine is absent.

### 6.5 Numerical tip (verified)
Use the stable intersection from the surface's tangent plane: `t = c r² / (B + sqrt(B² − c² r²))`, `B = N − c(Lx+My)`. The unit normal needs no sqrt: `n = (c x, c y, c z − 1)`. In f32 against an f64 reference at radius R: stable 7.5e-9 mm (R=59), 4.6e-10 (R=874), 5.8e-11 (R=1e4); naive 1.05e-6, 2.1e-5, 2.8e-4.

### 6.6 Repo hooks and decisions
- The current camera has a thin lens only (`Camera::generate_ray`, lens point in the unit disk) and 8 `LENS_PRESETS` (focal, f-stop). New presets must be additive.
- Rule 10 applies: the lens inspector must show engine-computed EFL, T-stop, distortion and vignetting, not hardcoded numbers.

---

## 7. Open decisions, caveats and unverified items

**Judgement calls that belong to the lead (rule 11), not taken here**
1. Default bokeh character for product renders, and which of the sixteen prescriptions ship first.
2. The "swirl" look: a physical outcome of a traced Petzval, or an artistic knob.
3. Hybrid single-wavelength RGB scheme (§3.4) vs a full spectral move.
4. f32 vs f64 for offline polynomial fitting (rule 8b; Schrade shows f32 is not enough for high-degree fits).
5. Whether to ship flare ghosts at all in the first release, and the default strength.
6. UI names for families (neutral names only).

**Unverified or weaker items**
- Swirly-bokeh cause: forum and practitioner explanations only; no rigorous analysis found. Verify by tracing P3 with realistic semi-apertures (not done).
- Anamorphic streak cause: practitioner sources; my reasoning is that cylindrical surfaces focus in one meridian only, stretching ghosts into lines. Not confirmed from a lens-design text.
- P7 element-3 index (1.4075) was chosen by an EFL consistency check; confirm against the German original DE 530,843.
- P12 BFL is 0.5 mm shorter than the patent value in both modes; a digit may differ. The SA sweep is qualitatively exactly as the patent text describes.
- P2, P4 vd values for some glasses are estimates (P2 fitted from the patent's nD/nF/nG'; P4 generic).
- Hullin 2011, Steinert 2011 and Hanika & Dachsbacher 2014 were not read beyond abstracts.
- Cited from memory, not fetched: Feist; EU Directive 96/9/EC; 37 CFR 1.71; Brown–Conrady distortion; Spencer et al. 1995; Wyman et al. 2013; Jakob & Hanika 2019; Schott normal-line formula; ISO 9358 / ISO 18844 for veiling glare and flare measurement (a possible calibration reference for "flare strength"; I did not read them); UL 2802 is cited via [WP-VG].
- Wikipedia articles are secondary sources and are used only for historical or descriptive facts.

---

## 8. References

**Papers and articles**
- [K95] Kolb, Mitchell, Hanrahan, "A Realistic Camera Model for Computer Graphics", SIGGRAPH '95, pp. 317–324. https://www.cs.utexas.edu/~fussell/courses/cs395t/lens.pdf , https://graphics.stanford.edu/papers/camera/
- [N10] H. H. Nasse, "Depth of Field and Bokeh", Carl Zeiss Camera Lens Division, March 2010. https://lenspire.zeiss.com/photo/app/uploads/2018/02/cln35_en_web_special_bokeh.pdf
- [M97] H. M. Merklinger, "A Technical View of Bokeh", Photo Techniques, May/June 1997. http://www.trenholm.org/hmmerk/ATVB.pdf
- [BW02] J. Buhler, D. Wexler, "A Phenomenological Model for Bokeh Rendering", SIGGRAPH 2002 sketch. https://research.dreamworks.com/wp-content/uploads/2018/07/142-buhler-Edited.pdf (DOI 10.1145/1242073.1242155)
- [HESL11] Hullin, Eisemann, Seidel, Lee, "Physically-Based Real-Time Lens Flare Rendering", ACM TOG 30(4), SIGGRAPH 2011, 108:1–9. https://graphics.tudelft.nl/Publications-new/2011/HESL11a , https://resources.mpi-inf.mpg.de/lensflareRendering (abstract only)
- [HHH12] Hullin, Hanika, Heidrich, "Polynomial Optics: A Construction Kit for Efficient Ray-Tracing of Lens Systems", CGF 31(4), EGSR 2012, 1375–1383. https://www.cs.ubc.ca/labs/imager/tr/2012/PolynomialOptics/files/PolynomialOptics-Hullin2012.pdf
- [LE13] Lee, Eisemann, "Practical Real-Time Lens-Flare Rendering", CGF 32(4), EGSR 2013, DOI 10.1111/cgf.12145. https://graphics.tudelft.nl/Publications-new/2013/LE13
- [SDHL11] Steinert, Dammertz, Hanika, Lensch, "General Spectral Camera Lens Simulation", CGF 30(6), 1643–1654, DOI 10.1111/j.1467-8659.2011.01851.x (abstract only)
- [HD14] Hanika, Dachsbacher, "Efficient Monte Carlo Rendering with Realistic Lenses", Eurographics 2014 (as cited by [S16]; abstract only)
- [W14] Wilkie, Nawaz, Droske, Weidlich, Hanika, "Hero Wavelength Spectral Sampling", CGF 33(4), EGSR 2014, 123–131, DOI 10.1111/cgf.12419. https://cgg.mff.cuni.cz/wp-content/uploads/2021/05/WNDWH14HWSS.pdf
- [S16] Schrade, Hanika, Dachsbacher, "Sparse high-degree polynomials for wide-angle lenses", CGF 35(4), EGSR 2016. https://cg.ivd.kit.edu/publications/2016/lens_sparse_poly/2016_optics.pdf
- [J16] Joo, Kwon, Lee, Eisemann, Lee, "Efficient Ray Tracing Through Aspheric Lenses and Imperfect Bokeh Synthesis", CGF 35(4), 99–105. https://graphics.tudelft.nl/Publications-new/2016/JKLEL16
- [WZH10] Wu, Zheng, Hu, Xu, "Realistic rendering of bokeh effect based on optical aberrations", The Visual Computer 26, 555–563 (2010), DOI 10.1007/s00371-010-0459-5 (abstract)
- [WZHX13] Wu, Zheng, Hu, Xu, "Rendering realistic spectral bokeh due to lens stops and aberrations", The Visual Computer 29(1), 1–12 (online 2012; abstract)
- [LENSNOTES] H. M. Merklinger, "Principles of View Camera Focus" (adapted article). https://lensnotes.com/articles/principles-of-view-camera-focus/
- [PBR] M. Pharr, W. Jakob, G. Humphreys, *Physically Based Rendering*, 3rd ed., §6.4 "Realistic Cameras" (text only; code not to be copied). https://www.pbr-book.org/3ed-2018/Camera_Models/Realistic_Cameras
- [RUST] Rust standard library, `f32` primitive docs. https://doc.rust-lang.org/std/primitive.f32.html
- [RID] refractiveindex.info database (CC0). https://github.com/polyanskiy/refractiveindex.info-database

**Textbooks (not read; named for the standard results used)**
Kingslake, *A History of the Photographic Lens* (1989); Kingslake & Johnson, *Lens Design Fundamentals* (2nd ed.); Smith, *Modern Optical Engineering* and *Modern Lens Design*; Laikin, *Lens Design*; Hecht, *Optics*; Born & Wolf, *Principles of Optics*; Welford, *Aberrations of Optical Systems*; Kidger, *Fundamental Optical Design* (triplet chapter, SPIE).

**Patents** (retrieved from `patentimages.storage.googleapis.com/pdfs/USnnnnnnn.pdf`; Google Patents pages `https://patents.google.com/patent/USnnnnnnnA/en`)
- US 568,052 (Taylor, 1896)
- US 721,240 (Rudolph, 1903)
- US 1,975,678 (Bertele, 1934)
- US 2,500,046 (Schade, 1950)
- US 2,645,156 (Tronnier, 1953; data via [LE13])
- US 2,649,022 (Angénieux, 1953)
- US 2,761,354 (Steglich, 1956)
- US 3,552,829 (Marquardt, 1971)
- US 3,884,557 (Nakamura, 1975)
- US 4,113,357 (Nakamura, 1978)
- US 4,214,814 (Ogino et al., 1980)
- US 4,256,373 (Horimoto, 1981)
- Pointers I did not extract: US 6,072,636, US 10,126,533 (anamorphic attachments), US 4,807,983, US 4,871,243 (floating Gauss macro).

**Wikipedia (secondary; descriptive and historical facts only)**
- [WP-Bokeh] https://en.wikipedia.org/wiki/Bokeh
- [WP-Petzval] https://en.wikipedia.org/wiki/Petzval_lens
- [WP-Cooke] https://en.wikipedia.org/wiki/Cooke_triplet
- [WP-Tessar] https://en.wikipedia.org/wiki/Tessar
- [WP-Gauss] https://en.wikipedia.org/wiki/Double-Gauss_lens
- [WP-Sonnar] https://en.wikipedia.org/wiki/Zeiss_Sonnar
- [WP-Hist] https://en.wikipedia.org/wiki/History_of_photographic_lens_design
- [WP-Tele] https://en.wikipedia.org/wiki/Telephoto_lens
- [WP-Fisheye] https://en.wikipedia.org/wiki/Fisheye_lens
- [WP-Spike] https://en.wikipedia.org/wiki/Diffraction_spike
- [WP-AR] https://en.wikipedia.org/wiki/Anti-reflective_coating
- [WP-Flare] https://en.wikipedia.org/wiki/Lens_flare
- [WP-VG] https://en.wikipedia.org/wiki/Veiling_glare
- [WP-Vig] https://en.wikipedia.org/wiki/Vignetting
- [WP-Abbe] https://en.wikipedia.org/wiki/Abbe_number
- [WP-Sell] https://en.wikipedia.org/wiki/Sellmeier_equation
- [WP-Cauchy] https://en.wikipedia.org/wiki/Cauchy%27s_equation
- [WP-Apod] https://en.wikipedia.org/wiki/Apodization
- [WP-Breathing] https://en.wikipedia.org/wiki/Breathing_(lens)
- [WP-AHB] https://en.wikipedia.org/wiki/Anti-halation_backing
