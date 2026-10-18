# AI post-processing — decision, protections and interface

An **optional** step after the render: an open-weights image model, run on
the user's own machine, improves the image (more natural light, bounces,
wear and micro-detail, or a style) **without ever changing the geometry,
the materials, the resolution, the depth of field, the framing or anything
that was not asked for**. The user decides how much the model intervenes with
simple controls, sees it first in a preview, and when it finishes has both
images —the engine's and the AI's— to compare with a sliding divider. Phases
**X1–X5** in `ROADMAP.md`. Research on models and execution engines with
sources as of 2026-10-13; the licences are verified again in X1 before
anything is published.

---

## 1 · Principles

1. **The engine's render is the truth.** The AI is an optional finish and
   never replaces the engine: the engine image is always kept, and
   post-processing can be turned off, redone or discarded.
2. **Nothing that is not asked for.** Every aspect the AI may touch has its
   own control, and at 0 that aspect does not change. The rest is
   **protected** and cannot be unprotected from the normal interface:
   geometry, materials (colour and finish), resolution, depth of field,
   framing, text and logos.
3. **The protections do not depend on the model.** There is no trust that a
   generative model will "obey": the image that comes out of the model goes through
   a **deterministic guard** (§3) that lets only the permitted changes through
   and checks the result with numbers. Changing the model does not
   loosen any protection.
4. **Local and private.** Everything runs on the machine; the image does not leave
   it. Nothing is uploaded to any server.
5. **Honesty.** If the machine cannot run the model, the
   switch appears disabled with the reason. If the guard had to
   limit the intervention to respect the protections, it says by how much.

---

## 2 · The model and where it runs

### 2.1 · Default model: Z-Image-Turbo

**Provisional decision, to be confirmed in X1** with an own visual
comparison (there is no public test that measures "improving a render without
changing its structure"):

| | |
| --- | --- |
| Model | **Z-Image-Turbo** (Tongyi-MAI), a 6.15 B-parameter diffusion transformer with a Qwen3-4B encoder, November 2025 |
| Licence | **Apache-2.0** on model, encoder and ControlNet: commercial use and redistribution allowed, so it does not limit how the author distributes the product (not even if it is sold) |
| Why | Among the small models with a permissive licence it is the only one that has both native *img2img* with `strength` (the intervention is controlled with a number) and a **ControlNet under the same licence** (depth, edges, *tile* up to 2048²); the best of the Apache ones in the public text-to-image rankings; a quantized ONNX version published for the browser |
| Quantization | Desktop: GGUF Q8_0 (6.6 GB) with ≥ 12 GB of VRAM, Q4_0 (3.7 GB) with 6–8 GB; encoder Q4_K_M (2.5 GB). Browser: ONNX q4f16 (≈ 6 GB in total) |
| Indicative speed | Seconds per 1024² image on a mid-to-high-end GPU; *img2img* at low intervention runs only a fraction of the steps. Unverified figures: they are measured in X1 |

**Alternatives**, which the user can download from Settings:
**FLUX.2 [klein] 4B** (Apache-2.0; lighter, good at instruction-based
edits, no `strength` or official ControlNet) and, on desktop only,
**Qwen-Image-Edit-2511** (20 B, Apache-2.0; "professional" editing
with a lighting LoRA, ≈ 18 GB quantized).

**They cannot be the default model** because their licence forbids commercial
use or redistribution of the weights: Qwen-Image-2.1 (the best in
the open rankings, research licence), FLUX.1
Kontext/Krea/dev, FLUX.2 dev and klein 9B, SD-Turbo and SDXL-Turbo, IC-Light
V2, SD 3.5 (revenue cap). A user can import them on their own
(§5): they are marked *not for commercial use* and the licence is
theirs.

### 2.2 · The installer chooses the model, with a recommendation per machine

The weights take up several GB, so they **do not go in the repository or on the
web page**: the repository contains no weights. The model **is chosen
at install time**:

- **Desktop installer (P2)**: an *AI models* step shows the
  recommended list from §2.4, **detects the machine** (GPU and its VRAM, or
  RAM if running on CPU is chosen) and **marks one as *Recommended for
  your computer***. The user can choose that one, another, several or **none**
  (install without AI). Each row gives the download size, licence, expected
  quality and indicative speed; the licence is shown before
  downloading. The detection and the recommendation are done by the application's
  own launcher (`repackshot --hardware`), with the same data and the
  same rule as the interface, so the installer and *Settings*
  always recommend the same thing.
- **The runtime ships with the models** (phase U10). With any chosen
  model, the same step also marks the **inference runtime** it needs
  to run it (*Inference runtime for the models:
  Vulkan build, for the graphics card · 29 MB — Recommended for your
  computer*): the build from `src/data/ai-runtimes.json` that the
  rule in §7.1 picks for this system (Vulkan with a GPU to use, CPU without
  one; with *Run on the processor* chosen, the CPU one), with the same
  input and the same data the application uses (`repackshot --hardware`
  writes a `[runtime]` section with its key and size). It is ticked by itself
  when the first model is chosen, **can be unticked**, is disabled
  while there is no model, and is never recorded without models. The checkbox goes
  to `pending-models.json` as `"runtime": "SDCPP_WIN_VULKAN"`
  (`{"device": "gpu", "keys": [...], "runtime": "..."}`), and **the launcher
  itself downloads it on first start** (the models are started by the
  page): with progress, pause and `sha256`, in *Settings ▸ AI post-processing ▸
  Runtime*. The installer's *Run on* becomes the one in
  *Settings* (today only the processor changes anything). An unknown key,
  one for another system or one already installed does nothing.
- **Decided: the installer chooses, the application downloads.** The
  installer leaves the choice in the data folder and finishes in
  seconds; the application starts downloading what was chosen from the first
  start, in *Settings ▸ AI post-processing ▸ Models* (`UI.md` §2.9),
  with progress, pause, resume after closing and a per-file `sha256`
  (pinned in `src/data/ai-models.json`). Several GB inside an
  installer cannot be paused or resumed, they block it, and a cut leaves it
  half done; this way the download is also the same on web and desktop.
- **Portable versions** (desktop without installing): there is no installer,
  so the same selector appears once on first start, as on
  the web, and **also offers the inference runtime** (ticked, and
  can be unticked), which is downloaded with the first model that starts downloading.
- **Web version**: there is no installer, so the same list and the same
  recommendation appear the first time post-processing is turned on and
  in *Settings ▸ AI models*, filtered to what can run in the
  browser (WebGPU); it is kept in the browser's private storage
  (OPFS, with `navigator.storage.persist()` so that it is not deleted).
- Afterwards, in every case, *Settings ▸ AI post-processing ▸ Models*
  allows downloading **the same models the installer offered**,
  importing one's own (§5), setting the active one or deleting.

### 2.3 · Execution engines

- **Browser**: **ONNX Runtime Web** (MIT) with WebGPU, in workers (one
  per stage: text encoder, transformer, VAE, which are terminated when
  done to free the GPU), weights split into fragments of ≤ 1 GiB
  (browsers limit buffers to 1–2 GiB and ONNX Runtime Web to
  4 GB per model). WebGPU is in Chrome and Edge (Windows, macOS,
  ChromeOS, Android; Linux only with certain GPUs), Safari 26 and Firefox on
  Windows and macOS; where there is no WebGPU, there is no post-processing.
- **Desktop (P2)**: **decided (2026-10-13, §7.1)**: all native.
  Inference is done by **stable-diffusion.cpp** (MIT, ggml: Vulkan and
  CPU) as an **auxiliary process** governed by the launcher, which reads the
  GGUFs pinned in `ai-models.json` and those the user imports; the
  guard and all the pixel work, the `rt-post` crate (§7.2).
  Native ONNX Runtime is ruled out on desktop: the pinned files
  are GGUF.
- **Separate from the render engine.** Post-processing lives in
  `engine/crates/rt-post` (the guard, Rust with no dependencies), in the
  launcher (the desktop pipeline and the auxiliary process) and in
  `src/ai/` (the web driver and the prompt). `rt-core` still does not know
  that the AI exists; its only contribution is the **passes** (§3.1).
- **What is not possible, and is said so**: a 12–20 B model in a browser
  tab (it exceeds the memory limits), nor post-processing without
  WebGPU in a reasonable time. Message: *"AI post-processing needs
  a graphics card with WebGPU and several GB of free memory. This
  browser or machine cannot run it. Your image is never uploaded
  anywhere. Use the desktop application, choose a lighter
  model or leave the AI off: your render does not change."*

### 2.4 · Recommended list and recommendation rule

The list comes from the 2026-10-13 research. It lives as data in
`src/data/ai-models.json` (stable keys, files with URL, size and
`sha256`, licence, requirements, and the recommendation rule as a table),
so that X1 can correct thresholds and times with real measurements without touching
code. It is JSON and not TypeScript because two programs read it: the
interface and the desktop launcher used by the installer; both
evaluate the table the same way and one file of cases tests it. Approximate download sizes, adding transformer,
text encoder and VAE.

| Key | Model and quantization | Download | Licence | Used for |
| --- | --- | --- | --- | --- |
| `ZIMAGE_Q8` | Z-Image-Turbo GGUF Q8_0 + Qwen3-4B Q4_K_M | ≈ 9.3 GB | Apache-2.0 | **Maximum quality of the default model** |
| `ZIMAGE_Q4` | Z-Image-Turbo GGUF Q4_0 + Qwen3-4B Q4_K_M | ≈ 6.4 GB | Apache-2.0 | Quality / memory balance |
| `ZIMAGE_Q2` | Z-Image-Turbo GGUF Q2_K + Qwen3-4B Q4_K_M | ≈ 5.3 GB | Apache-2.0 | Small GPUs; somewhat lower quality |
| `ZIMAGE_WEB` | Z-Image-Turbo ONNX q4f16 (browser) | ≈ 6 GB | Apache-2.0 | The web version. **Not available yet** (X1 part A): the only published export does not ship the VAE encoder, so it cannot do image-to-image; X3 has to export it from the Apache-2.0 `ae.safetensors` |
| `KLEIN4B_Q4` | FLUX.2 [klein] 4B GGUF Q4_K_M + Qwen3-4B Q4_K_M | ≈ 5.3 GB | Apache-2.0 | Alternative: instruction-based edits ("warmer light") |
| `QWENEDIT_Q4` | Qwen-Image-Edit-2511 GGUF Q4_K_M + Qwen2.5-VL-7B Q4_K_M + vision projector Q8_0 | ≈ 19 GB | Apache-2.0 | *Pro*, desktop only: strong instruction-based editing (a lighting LoRA, if added, will be another row with its own licence) |
| `SD15_LIGHT` | Stable Diffusion 1.5 + ControlNet 1.1 *tile* and *depth* (fp16) | ≈ 3.6 GB | CreativeML OpenRAIL-M (commercial use with use restrictions that are shown and accepted) | Very modest machines |

**Pinned files (X1 part A, 2026-10-13).** Each key lists in the
JSON its files with a URL pinned to a Hugging Face *commit*, exact size
and `sha256` (checked against the API and against the CDN tag,
without downloading the weights); all repositories are public and have no
restricted access. The licences, quoted verbatim, are in
`docs/ai-licences.md`. Measured sizes: Q8 9.41 GB, Q4 6.52 GB, Q2
5.43 GB, klein 5.44 GB, Qwen-Edit 19.03 GB, SD 1.5 3.58 GB. No
component is non-commercial; SD 1.5 carries the use restrictions of
OpenRAIL-M, which are shown and accepted before downloading. **Files
are stored only once by their `sha256`** (the Qwen3-4B encoder,
2.5 GB, is shared by four keys): deleting a model only
deletes what no other installed model uses. Whether stable-diffusion.cpp loads
each combination is untested: X1 part B tests it before removing
the *provisional* mark.

Memory is evaluated as **measured / 0.94**: machines show less
useful memory than the nominal (a "16 GB" machine gives 15.6 GiB) and without the
factor they would fall one row lower. Installed RAM is preferred when it
can be read.

**Recommendation rule** (starting values, to be calibrated in X1 with the
real memory peak at 1024² and a margin of 20–30 % for activations):

| Detected machine | Recommended | Also offered |
| --- | --- | --- |
| GPU with **≥ 24 GB** of VRAM | `ZIMAGE_Q8` | `QWENEDIT_Q4` (*Pro*), `KLEIN4B_Q4` |
| GPU with **12–24 GB** | `ZIMAGE_Q8` | `KLEIN4B_Q4` |
| GPU with **6–12 GB** | `ZIMAGE_Q4` | `KLEIN4B_Q4` |
| GPU with **4–6 GB** | `ZIMAGE_Q2` (text encoder in RAM) | `SD15_LIGHT` |
| GPU with **< 4 GB** | `SD15_LIGHT` | none |
| **CPU** with **≥ 32 GB** of RAM | `ZIMAGE_Q8` | `ZIMAGE_Q4` |
| **CPU** with **16–32 GB** | `ZIMAGE_Q4` | `SD15_LIGHT` |
| **CPU** with **8–16 GB** | `SD15_LIGHT` | none |
| **CPU** with **< 8 GB** | none (install without AI) | — |
| **Browser** with WebGPU and buffers of ≥ 1 GiB | `ZIMAGE_WEB` (today none: not available yet) | — |
| Browser without WebGPU | none, with the message of §2.3 | — |

On CPU the installer warns that each image takes **minutes** (a figure
measured in X1, not estimated), and the configurator's preview is made at
lower resolution. Detection uses the native API on desktop (dedicated
VRAM of the chosen GPU; on Apple, the unified memory recommended
for the GPU) and the WebGPU adapter limits in the browser. If
detection fails, nothing is recommended and the table is shown.

---

## 3 · How it is guaranteed that what is not asked for does not change

### 3.1 · What the engine gives the AI

The engine emits, along with the image, **exact passes** (phase X2):
depth, normals, albedo of the first non-specular bounce, **part
id** and **material id**, and the **blur map** (circle of
confusion per pixel, from the camera's depth of field). It also emits the
scene text: materials per region (name, family, whether they admit
wear), lights and environment, for the prompt.

### 3.2 · Pipeline

1. **Input**: the engine image with its tone curve, at the size of the
   job.
2. **Conditioning**: exact depth and edges **computed from the
   id and normal changes** (not from the image: they are exact) fed to the model's
   ControlNet, when the runtime supports it; *tile* for large
   outputs; prompt generated from the materials and lights, with a
   fixed negative ("do not change shapes, text or logos"); fixed seed.
3. **Low intervention**: bounded `strength` (≤ 0.6 at the maximum of the
   control since X6; it was 0.4), in tiles of ~1024² with overlap and soft blending for large
   outputs, and padding to a multiple of 16 that is cropped afterwards: **the
   output resolution is exactly the job's**.
4. **Deterministic guard**, always, from strongest to weakest:
   - **Shading transfer**: the output is *original ×
     clamp(blur(model) / blur(original))* in the logarithmic domain, with a radius of 8–32 px per megapixel. Textures, edges,
     text and the depth-of-field blur **are preserved by
     construction**; the model contributes only low-frequency light and colour.
   - **Frequency separation**: the high bands of the original are
     kept; the model's micro-detail (wear) enters only in the mid
     band and only inside the regions of materials that admit
     wear, with a cap.
   - **The style's own grade** (X6): each style is also a colour grade the
     guard applies itself, the same for any model — a tint of the shadows, a
     tint of the highlights and a contrast, as a smooth gain that follows the
     low band of the engine's luminance (`rt-post/src/style.rs`, mirrored in
     `src/core/ai-style.ts`); by Style strength and Intervention, never on the
     background or a locked material, and measured as asked for by the colour
     check. Before X6 a style was only words for the model.
   - **Regions by id**: intervention per region, and a colour-change
     limit per material (mean and 95th-percentile ΔE₀₀; starting point 4 and 6,
     double the ≤ 2–3 of the beginning because of decision 2.1 of C1, to be calibrated
     in X1). The three tolerances are those of *Settings ▸ AI post-processing ▸
     Advanced*: each request carries the ones in force at that moment, and the guard (the
     launcher and `post.wasm`) measures against them.
5. **Check and fallback**: measurements on the result —exact
   size; identical pixels outside the permitted regions; edge match
   at id and normal discontinuities (4 px since C1; they were 1.5 in
   the guard and 2 in *Settings*); SSIM on the
   high band; ΔE₀₀ per region; sharpness per tile against the blur
   map (what is in focus is not blurred and what is out of focus is not sharpened)—.
   If any fails, the intervention drops by itself and is repeated until all
   pass, and the user is told.

What this guarantees: **resolution, framing, text, edges, colour of
the materials and depth of field within the measured tolerances,
for any model**. What it does not guarantee: that the result is
physically correct; that is why the engine image is always kept.

---

## 4 · Interface (in the render window)

The **AI post-processing** section of the render window (`UI.md` §2.7),
collapsed and off by default.

**Switch** *AI post-processing* with an auxiliary line for the active
model (*Z-Image-Turbo Q4 · Apache-2.0 · downloaded*). If no model has
been downloaded, the switch opens the selector of §2.2 with the
recommendation for the machine; if the machine cannot run any,
it appears disabled with the reason.

**Configurator**, below, with controls from 0 to 100 and one sentence each.
At 0, the corresponding aspect does not change:

| Control | What it does | What it acts on (X6) | Default |
| --- | --- | --- | --- |
| **Intervention** | How much the AI may change the image, in total | The img2img strength asked of the model (`MAX_STRENGTH` × Intervention / 100, 0.6 at 100) and every cap of the guard | 50 (30 until C1) |
| **Light** | More natural light: penumbras, soft highlights, highlight roll-off | The guard's band of local luminance: the model's change there × 0 at 0, × 1 at 50, × 2 at 100 | 50 |
| **Bounces** | Bounced light and ambient colour between surfaces | The guard's band of local colour, same law, then each material's ΔE limit | 40 |
| **Wear and micro-detail** | Believable micro-variation and fingerprints, only in materials that admit wear | The model's mid band, inside materials that admit wear, in focus and away from edges, same law | 20 |
| **Style** | Dropdown: *Natural photographic* (default), *Clean catalogue*, *Editorial*, *Warm*, *Cool*, *Cinematic* | A colour grade the guard applies itself (§3.2 step 4, `rt-post/src/style.rs`), plus the words for the model | Natural |
| **Style strength** | How much the style applies (colour and light mood only) | The grade's amount and the model's change common to the image, same law | 30 |

Each band control is a **gain on what the model did in its band**: 50 lets it
through as the model made it, 100 doubles it, 0 shuts it; the change is first
clamped at the attempt's cap (the tolerance × the Intervention's share), so
inside the cap the result is linear in the control. Where a cap held a band
back, the report says over how much of the picture (`GuardReport.capped`),
and how much of each material's colour change was kept (`kept`): the section
and the results viewer say it in plain words. Under each control a line
says what it acts on (*Asks the model for an img2img strength of 0.30…* for
Intervention).

**Own prompt** (X4b), below the controls: a multi-line field,
empty by default, of up to 400 characters, with the note *Describe the light or the
mood; the geometry, the materials and the focus stay protected*. It belongs to the
job (it is saved in the project, undone in one step when leaving the field, and
each job in the queue carries its own). It is only sent to a model that accepts it
(capability `textPrompt`); otherwise the field is shown disabled with the reason.

Below, the **protections**, as fixed chips with a padlock and no
switch: *Geometry · Materials · Resolution · Depth of field
· Framing · Text and logos*. An **Another variation** button changes the
seed, and next to it **Variants** (X4b): from 1 to 8, one by default. A
job with N variants makes a single engine render and N AI passes
with consecutive seeds (seed, seed + 1…), with the model loaded once;
each with its own report and its own file (`_AI`, `_AI_2`…). The estimated
time (N × what was measured) is shown when there is a measurement.

**The words that go to the model** (X4b), in this order: the **system
prompt** from *Settings ▸ AI post-processing* (general for all images,
the lead's by default), the **scene** one (`src/ai/prompt.ts`: materials,
lights, controls and style) and the **job's own**; the fixed negative goes
separately, always the same. None of them protects anything: what is protected is
guaranteed by the guard with numbers (§1.3, §3.2), whatever they say. For a
model that reads a limited number of *tokens* (capability `maxPromptTokens`:
SD 1.5 and SDXL read 77 with CLIP) the **short version** of the default is used
as long as the person has not changed it (if they did, theirs), and what does not fit is
trimmed word by word from the end, **first the job's own,
then the scene's and last the system's**, with a line under the
field saying what was left out. The count is a **prudent estimate**
(`estimatePromptTokens`, `src/core/ai-prompt.ts`) that may count too much and
never too little, so that the model never cuts on its own: the text is
split the way CLIP splits it before its merges (consecutive letters, single digits,
signs) and counts one *token* per 5 ASCII letters or fraction, one
more for each non-ASCII letter, one per digit and one per sign, plus the two
for start and end. The short version of the default counts 65 of the 77 (with
real CLIP it is about 45): a model like that has little room left for the scene and
almost none for the job's own.

**Preview**, to the right of the configurator (or below in narrow
windows), with a **sliding divider** to see before and after. Since X6 it is
first a **stored example** that calls no model: the reference scene (the
example bottle, framed a little closer) rendered by the **Full engine**
(`rt`, 512 × 288, 256 samples) and passed through the real guard
(`post.wasm`) with the **test model** (§7.2) at every step of every control:
0, 25, 50, 75 and 100 of Intervention, Light, Bounces, Wear and Style
strength, every style at every strength, and four seeds at the defaults
(161 images, WebP, 0.74 MB, `public/ai-preview/`, made by
`tools/ai-preview-sheet.mjs`; `src/core/ai-preview-sheet.ts` is the grid and the
lookup). It changes **the moment a slider moves**, with the nearest stored
example (the control moved last at its value), and says what it is —
*Example: reference scene, Full engine, test model; your render will
differ* — at which values it was made and which of the person's differ
(*Made at Intervention 50 · Light 50 · Bounces 50 · Wear 25 · Natural 25 —
yours: Bounces 40, Wear 20, Style strength 30*), and what the guard did
there in plain words. Below, **Preview my scene (Full engine)** runs the
real pipeline once on the job's own scene, drawn by the Full engine at the
job's samples and time, 384–512 px, with the time measured in an auxiliary
line; its result (*Your scene · Full engine · the model*) stays until a
control or the scene changes, and then the example comes back and the
button says *again*. The option *Use the full engine for the preview* is
gone (the button always uses it); `previewFullEngine` stays in the project
and is no longer read.

**When the job finishes**, the results viewer (`UI.md` §2.8) opens
the two images with the sliding divider, and the guard's report in
one line: *Checked: geometry ✓ · materials ✓ (ΔE max 1.8) ·
resolution ✓ · focus ✓*, plus *The AI was limited to 23 % to respect
the protections* when that happens (X6: with the checks that sent the stronger
attempts back, and where a cap held a band back or a material's colour was
kept, in the preview). Both images can be saved; the
queue and the history show both thumbnails. With several variants
(X4b), a strip of thumbnails picks the one the divider compares with the
render (with its report), *Save this variant* or *Save all*, and the
queue and the history say how many there are.

---

## 5 · Settings ▸ AI post-processing

In the **Settings** window (`UI.md` §2.9), *AI post-processing* section,
with its blocks *Active model*, *Models* and *Hardware*:

- **Model list**: the original one (*Z-Image-Turbo*, marked *Default*),
  the alternatives offered, and the imported ones; per row
  name, architecture, licence, size, state (*Not downloaded ·
  Downloading 42 % · Ready · In use*), and actions *Use*, *Download*,
  *Delete*.
- **Import model…**: accepts `.safetensors` (*diffusers* folder with
  `model_index.json` or a single file), `.gguf` and ONNX with fragments and
  manifest; **rejects** *pickle* formats (`.ckpt`, `.pt`, `.bin`).
  It requires a `model.repackshot.json` file next to it (or asks for it by filling in
  an online form): SPDX licence and its URL, whether it allows commercial
  use, base architecture (`z-image`, `flux2-klein`,
  `qwen-image-edit`, `sdxl`, `sd15`), role (*img2img*, edit,
  ControlNet, LoRA, VAE, encoder), quantization, companion
  files, capabilities (`strength`, reference-based editing, control
  types; X4b: `textPrompt`, whether it follows a text prompt, and
  `maxPromptTokens`, how many tokens it reads; without `textPrompt` the job's own
  prompt is not sent to it, and SD 1.5 or SDXL without `maxPromptTokens` read 77),
  `sha256` and origin. A model with an unknown or non-commercial
  licence can be used locally, is marked *not for commercial
  use* and is never the default.
- **Hardware**: detected GPU, estimated available memory, WebGPU yes or no,
  and the warning if the active model does not fit.
- **Storage**: space used by models and results, and *Free up*.
- **System prompt** (X4b): the general words that go before those of the
  scene and the job's own prompt, with *Restore default* and the note that the guard's
  protections do not depend on
  them (§4, *The words that go to the model*).

---

## 6 · Phases (detail in `ROADMAP.md`)

| Phase | Executor | What |
| --- | --- | --- |
| **X1** | **Fable** (Sonnet prepares) | **Part A, done** (U6 needed it): exact files, URL, sizes and `sha256` of each key of §2.4 in `src/data/ai-models.json` and licences re-read verbatim. **Part B**, after X3c: confirm the model and calibrate the table of §2.4 (memory peak and time per entry on GPU and CPU) with an own comparison of Z-Image-Turbo against FLUX.2 klein 4B (8 renders × 3 interventions, guard metrics) that a tool generates and that is run **on the user's own machine** (there is no GPU here); Vulkan against CPU in stable-diffusion.cpp |
| **X2** | Opus | Engine passes (§7.4): albedo, normal, depth, part and material id, blur map, in `rt-core`, the RSB, the wasm, the launcher and the TypeScript side. **After merging E5** (both touch the integrator) |
| **X3a** | Opus | `engine/crates/rt-post` and `post.wasm` (§7.2): conditioning, tiles, padding and cropping, **deterministic guard** with checks and the step machine with fallback; TypeScript wrapper and the scene prompt (`src/ai/`). Tested with the synthetic "model" |
| **X3b** | Opus | stable-diffusion.cpp on desktop (§7.1): pinned `src/data/ai-runtimes.json`, download and installation from *Settings*, auxiliary process in `rt-app`, `/api/ai/runtime` and `/api/ai/run` (an inference without the guard), with a fake auxiliary process in the tests |
| **X3c** | Opus | **Done.** The full desktop pipeline (§7.3), after X2, X3a and X3b: `/api/ai/post` in the launcher (tiles → stable-diffusion.cpp → `rt-post` → fallback), the desktop service in `src/io/`, integration into the queue with both images and the report; `AI_AVAILABLE` no longer exists: `status()` says it |
| **X3d** | Opus | The web, after X3c: ONNX Runtime Web with WebGPU in workers, **export the VAE encoder to ONNX** so that `ZIMAGE_WEB` exists, driver in a worker with `post.wasm`, OPFS cache with `sha256` and fragments of ≤ 1 GiB |
| **X4** | Sonnet | **Done.** The interface of §4 against `AiPostService` (`src/core/ai.ts`), with a synthetic service until X3c: render-window section, configurator, chips, Fast-mode preview with the passes drawn by three.js and divider, guard report and divider in the results viewer, two thumbnails in the queue, settings in the *store* (`ROADMAP.md` X4) |
| **X4b** | Opus | **Done.** The job's own prompt (if the model accepts it: `textPrompt`), variants (1 to 8, one render and N passes with consecutive seeds, thumbnail strip in the viewer) and system prompt in Settings, with the short version and the trimming for 77-*token* models (§4, §7.5b) |
| **X6** | Opus | **Done.** Every control acts on what reaches the model or the guard, step by step (§4 table): the band gains, the style's own grade, `MAX_STRENGTH` 0.6, the caps and the kept colour in the report and in plain words; the deterministic **test model** (§7.2); the preview's **stored example** made by the Full engine and the test model, and *Preview my scene* with the Full engine (§4) |
| ~~X5~~ | — | **Absorbed into U6** (Settings window, `ROADMAP.md`): the model manager of §5 and the selector of §2.2–§2.4 do not need the pipeline, so they arrive earlier. What is left for after X3 (checking live that the active model fits, and a one-image test) goes into X4 |

---

## 7 · Construction: decisions and contracts (lead, 2026-10-13)

What the lead fixes so that X2, X3a, X3b and X4 can advance in parallel without
stepping on each other. The code contracts are in `src/core/ai.ts` and
`src/core/passes.ts`: the phases **add to** what is there, they do not change it; if something
does not fit, it is noted in the PR and work goes on (rule 12).

### 7.1 · On desktop everything is native

The interface is the only HTML. On desktop, inference, the guard and
all the pixel work run outside the page, in native
code governed by the launcher.

- **Inference: stable-diffusion.cpp** (MIT, on top of ggml, MIT) as an
  **auxiliary process**: a separate executable, never linked, never
  copied into `engine/`, which the launcher starts, feeds and stops. It reads
  directly the GGUFs that `ai-models.json` already pins.
- Its builds are pinned like the models, in
  **`src/data/ai-runtimes.json`**: version of the official *release*, URL,
  size, `sha256`, quoted licence and which keys of §2.4 it really loads
  (`supports`, verified in X3b; what is not verified is not marked). Two per
  system (Windows and Linux x86_64): **Vulkan** (NVIDIA, AMD and Intel, with
  the graphics card driver) and **CPU** (AVX2). The rule picks Vulkan
  when there is a GPU and CPU if not; the user can force one in *Settings*.
- **They do not go in the installer or the portables**: they are downloaded from
  *Settings ▸ AI post-processing* the first time the AI is turned on (or
  together with the model chosen in the installer), with progress, resume and
  `sha256`, to `<data>/ai/runtimes/<sha256>/`, like the models.
  The package stays small and the build depends on the machine. **CUDA**
  is noted as an improvement (its libraries weigh hundreds of MB).
- A key that the installed build does not load appears in *Settings*
  as *{name}: not available with this runtime ({reason})*.
- **Done in X3b** (2026-10-13): *release* `master-959-d637cfb`, the server
  mode (`sd-server`, the model stays loaded), the API `/api/ai/runtime`
  and `/api/ai/run` (`engine/crates/rt-app/README.md`). **What did not fit the plan**: the
  download cannot be done by the page like the models' one, because
  GitHub *release* downloads do not send CORS headers; the launcher does it
  with the system `curl` (same progress, pause, resume and
  `sha256`, same folder), with *Install from a file…* as a fallback.
  The Windows builds need the Visual C++ 2015–2022
  runtime, which they do not ship. **X3c**: when they do not start because of that (a missing DLL and
  some Visual C++ runtime DLL absent from their folder and from
  `System32`), *Settings ▸ AI post-processing ▸ Runtime* shows
  *Install Microsoft Visual C++ runtime…*, which opens Microsoft's
  official page in the system browser (`openExternal`), and
  *Check again*: we do not redistribute their DLLs. *About* lists
  stable-diffusion.cpp and ggml with their MIT licences.

### 7.2 · The guard and the pixels: the `rt-post` crate

All the deterministic image work of §3.2 lives in
**`engine/crates/rt-post`**: conditioning (edges computed from the
id and normal changes, normalized depth), tile plan with
overlap and soft blending, padding to a multiple of 16 and cropping, the **guard**
(shading transfer, frequency separation, regions by id
with ΔE₀₀), the checks and the fallback decision. Rust from
scratch, only `std`, `f32`, no `unsafe`, deterministic, with the same
rules and gates as the engine. `rt-core` does not use it or know it exists.
On desktop `rt-app` links it; on the web it is a **separate wasm module**
(`rt-post-wasm` → `public/engine/post.wasm`, generated like `rt.wasm` and
not committed to the repository), so that the engine's wasm does not grow.

It is a **step machine**, not a loop with callbacks:

1. `plan(job) → Plan`: tiles, padded size, strength of the
   attempt (Intervention × `MAX_STRENGTH`, times `RETRY_FACTOR` on each
   retry).
2. `conditioning(plan, passes) → control images` per tile.
3. `accept(plan, original, passes, tile outputs, attempt) →
   Accepted{image, report} | Retry{strength} | Rejected{report}`.

The driver that calls the model between steps is trivial and exists twice:
in Rust in `rt-app` (desktop) and in TypeScript in a worker
(web). Everything that decides is in `rt-post` and is tested once.
At most `MAX_ATTEMPTS` = 4 attempts; if none passes, the
engine image is delivered **unchanged** with the report `REJECTED` and the reason.
The progress that comes out of the pipeline (`AiPostProgress`) counts attempts
from 1 and says out of how many (`maxAttempts`, the cap above) and why the
previous one was returned (`reason`, the guard's words; in the launcher,
`lastFailure` of the *post* state); its bar is divided by attempts, a
quarter each, and only reaches the end when the job finishes (B1). In the
launcher's log, each returned attempt leaves *AI post N: attempt k of 4
failed: <reason>*.
With Intervention 0 the output is the input bit for bit, without calling the
model.

**The test model** (X6, `rt-post/src/test_model.rs`): a deterministic stand-in
for an img2img model, for the tests, the stored example of §4 and the desktop
pipeline's fake runtime (`rt-fake-sd`'s `model` image). It learns nothing and
ignores the words, as a small img2img model largely does; at a given strength it
does what a well-behaved one does to a product render in every band the guard
separates: it pulls the low band of the luminance towards a mid tone (light),
warms the shadows (bounce), warms the whole picture a little (common), adds a
seeded 3–6 px micro-variation (mid band) and a per-pixel grain (high band, which
no control lets through). Every change scales with the strength, 0 returns the
input bit for bit, and the seed moves the grain, the micro-variation and a
slight wobble of the light. `post.wasm` exports it (`post_test_model`,
`PostGuard.testModel`), and `rt --ai-inputs` writes the linear image and the
passes of a render for it.

### 7.3 · The desktop pipeline lives in the launcher

Pixels do not make round trips. The launcher keeps the linear image
and the passes of each job's final render (by render id,
in memory and in `<data>/cache/ai/`), and **`POST /api/ai/post`** receives
only `{renderId, settings, prompt, negative, model}`; for the
Fast-mode preview, the image and the passes go inline (≤
`PREVIEW_MAX_SIDE` = 512 px on a side). Tiles → stable-diffusion.cpp →
`rt-post` → retries happen natively, and the progress and the result are
published like render jobs (`GET /api/ai/post/<id>`,
cancel with `DELETE`). The page builds the prompt with the
materials and lights from the *store* (`src/ai/prompt.ts`), sends it with
the settings and receives the two images and the report. The model is loaded
once and stays loaded while in use (preview after preview);
it is unloaded when *AI post-processing* is closed or after a while without use, to
give the memory back.

- **Done in X3c** (2026-10-13). In the launcher, `rt-app/src/ai/post.rs`:
  `POST /api/ai/post` with `{source: {kind: RENDER, renderId}, settings,
  prompt, negative, modelKey, materials}` (JSON), or the `INLINE` source
  (binary body `RPI1`: the JSON, the `RPL1` image and the `RPP1` passes,
  ≤ 512 px); progress and cancellation like render jobs
  (`GET /api/ai/post/<id>?after=n`, `DELETE`), image at
  `GET /api/ai/post/<id>/image` (`RPL1`: linear `f32` with straight alpha) and
  `aiPost: 1` in `/api/info`. The native driver is the one from §7.2: `plan`,
  per tile `tile_input` and the control image, the X3b `sd-server`
  (one server, the model loaded between calls), `accept`, retries at
  `RETRY_FACTOR` up to `MAX_ATTEMPTS`. **With Intervention 0 the runtime is not
  started** (nor does it need to be installed) and the image
  is the engine's, bit for bit. The render stores with its linear image its
  exposure and its curve (`Look`), so the model sees what the
  person sees. Full contract in `engine/crates/rt-app/README.md`. On the
  page: `src/io/ai-post.ts` (`DesktopAiService`, the desktop
  service when the launcher says `aiPost`; the web continues with
  `notBuiltService` until X3d and `?ai=synthetic` with the synthetic one); the queue
  asks the render to leave the passes in the launcher (`aiPasses`), sends the
  id, shows the progress per tile and per attempt (*AI · tile 2 of 4 · attempt 2 of 4*, and below, after a retry, why the guard returned the previous one: B1) and
  writes the AI image **from the render's linear light** with its
  own exposure and curve (`straightBytes`, `straightWords16`,
  `straightExr` of `src/render/tiles.ts`): a 16-bit PNG or an EXR stay
  that way, and with Intervention 0 the AI file is the engine's byte
  for byte. Stopping or pausing during the AI leaves the engine image in
  the history (only the AI one is lost). The prompt is the one from
  `src/ai/prompt.ts` and the guard's material table, `guardMaterials`
  over the material order that `io/rsb.ts` exports
  (`ProjectScene.materialOrder`). What really runs here and what is
  fake, and what did not fit: `ROADMAP.md` X3c.

### 7.4 · Passes (X2)

A single format for the engine, the wasm, the launcher and the three.js preview
(`src/core/passes.ts`): one plane per pass, `width × height`, in
rows from top left, like the image.

| Pass | Type | Content | Background |
| --- | --- | --- | --- |
| `albedo` | 3 × f32 linear | Base colour of the material at the first hit, without following specular bounces (a diffuse: its colour; a glass: its tint), averaged over the pixel's samples | 0 |
| `normal` | 3 × f32 | Unit shading normal at the first hit, in world space (Z up), turned towards the camera (both faces of the triangle count) | 0 |
| `depth` | f32 | Distance along the camera axis, in scene units | +∞ |
| `partId` | u32 | RSB instance index + 1: `io/rsb.ts` translates it to the part, like `pick`; the studio floor, `FLOOR_ID` | 0 |
| `materialId` | u32 | RSB material index + 1; the floor, `FLOOR_ID` | 0 |
| `coc` | f32 | Diameter of the circle of confusion in output pixels, from the thin lens | 0 (also without DoF) |

**Lead's correction (after X4, 2026-10-13).** The albedo is that of the
first hit, without following specular bounces (as the three.js preview
draws it and simpler to match), and the normal is turned towards
the camera. **The studio floor is not background**: it carries `FLOOR_ID`
(`0xFFFFFFFF`) in both ids, because its contact shadows and its
bounced light are exactly what *Light* and *Bounces* improve; the background (0)
is the environment, the background image, the transparency and the light panels seen
by the camera, and it never changes. The circle of confusion follows the same
formula as `src/core/lens-coc.ts` (X4), which reproduces
`Camera::generate_ray`. X2 emits it like this in the engine; X3c adjusts the guard
(`rt-post`), the synthetic service and the three.js passes to `FLOOR_ID`.

`normal`, `depth`, `partId` and `materialId` come from **one ray through the
pixel centre, without jitter**: they are exact and never mix two sides of
an edge, which is what the guard needs. The passes are requested with a
mask in `RNDR` (bit *i* = `PASS_KEYS[i]`), accumulate like the image,
do not change a single pixel of the image (parity and the determinism
*hash* stay the same) and come out through `rt-wasm` and through the launcher
(`/api/render` with `passes=…` on final jobs, which stores them
for §7.3, and `GET /api/render/<id>/passes` in binary with a header).

- **Done in X2** (2026-10-13): `rt_core::passes`, `rt_render_tile_passes`
  and `rt_render_tile_albedo` in `rt.wasm`, `PassAccumulator` in the pool and
  `parsePasses` for the launcher's `RPP1` file
  (`src/render/pass-planes.ts`), `passes=` and `GET /api/render/<id>/passes`
  with the store of the last four renders (`<data>/cache/ai/` for
  those above 64 MiB). Detail in `ARCHITECTURE.md` §5.2 and §5.5 and in
  `engine/crates/rt-app/README.md`. X2 decisions where the contract
  said nothing: an emitter's albedo is its `base_color` (not its emission);
  the floor's, `FLOR.color`, also in the shadow catcher; with
  depth of field the albedo follows each sample's ray through the
  lens (it blurs like the image); a cutout or a glass stops the
  passes' ray as they stop `pick`; an instance with an out-of-range
  material index carries `materialId` 0. The three.js passes
  match the engine's in ids and depth except on the floor, which
  is still background for them until X3c
  (`tests/ai-passes-browser.test.ts`).
- **Done in X3c**: the floor with `FLOOR_ID` everywhere. In the guard
  (`rt-post`) it is one more region, which is relit and has its colour
  check (*Floor*), and a real bug was found: `FLOOR_ID`
  (`u32::MAX`) was also the initial value of the region cache,
  so a floor seen before any part fell to the background. The
  control's depth is normalized over the parts and the floor is
  drawn at that scale, clipped (its plane reaches the horizon and squashed
  the product into a few levels). In the synthetic service, region
  *Floor*. In the three.js passes, the floor is not drawn: the engine's
  central ray is cast at each pixel against its plane (`floorHits`, the
  camera of `Camera::generate_ray`, orthographic too) and it is `FLOOR_ID`
  where it is in front of the parts, with the normal towards the camera and its
  colour as albedo; it matches the engine's passes at every pixel of the
  floor, horizon included (`tests/ai-passes.test.ts`,
  `tests/ai-passes-browser.test.ts`).

### 7.5 · Settings in the *store* (X4)

`RenderSettings.ai` (`src/core/render.ts`) goes from `{ enabled }` to
`{ enabled, previewFullEngine } & AiPipelineSettings`, with the default values
of `DEFAULT_AI_PIPELINE`; old projects open with
those values. Changing a control is a *store* action and can be undone;
each job copies its settings. `AI_AVAILABLE` stops being a
constant in X3c: `AiPostService.status()` says it. **Done**: the constant
no longer exists.

### 7.5b · Own prompt, variants and system prompt (X4b)

**Done** (2026-10-13). Contract added, changing nothing of what was there:

- `AiPipelineSettings.userPrompt?` (trimmed string of up to `MAX_USER_PROMPT` = 400
  characters) and `variants?` (integer from 1 to `MAX_VARIANTS` = 8), optional in the
  contract (`src/core/ai.ts`) and always present in the *store* (`AiSettings` is
  `Required<…>`); `DEFAULT_AI_PIPELINE` brings them empty and 1. An earlier project
  opens without a prompt and with one variant. The launcher does not read them: each request is one
  image with its seed and the prompt already composed.
- `src/core/ai-prompt.ts`: `DEFAULT_SYSTEM_PROMPT` and `SHORT_SYSTEM_PROMPT` (the lead's
  texts), `composePrompt` (system → scene → own, and the trimming), the
  *token* estimate and `PromptCaps`. `buildPrompt(state, settings, context?)` composes with a
  context and, without it, still gives only the scene's. The `ai.systemPrompt` setting of
  `src/core/settings.ts` (it may stay empty).
- `ai-models.json` gains `capabilities: { textPrompt, maxPromptTokens? }` in each
  model (all with `textPrompt`; `SD15_LIGHT` with 77) and `ModelView` carries them; an
  imported one declares them in its manifest.
- The queue (`src/ui/render-queue.ts`, `aiStep`): one render, N requests from the same
  source (`RENDER` with the same `renderId`, or the same image decoded once) with
  `variantSettings` (seed + n − 1), each image with `aiFileName(name, n)`.
  `RenderProgress.ai` gains `variant` and `variants`.
- Results: `ResultMeta.aiMore` (variants 2 onwards; `ai` is the first),
  `ResultsStore.add(…, ai, aiMore)`, and in the launcher `<id>.ai.<n>.<ext>` with
  `PUT/GET /api/store/results/<id>/ai/<n>` (`engine/crates/rt-app/src/appdata.rs`; the
  earlier `<id>.ai.<ext>` is variant 1).

### 7.6 · Order

**Now**: X3a, X3b and X4 in parallel (each in its own new files; where
they touch shared files —`server.rs`, `ports.ts`, `strings.ts`, the
render window— as little as possible, so that the merge is mechanical). **X2**
as soon as E5 is merged. **X3c** when X2, X3a and X3b are in; **X3d** and
**X1 part B** after it. New dependencies, in `ARCHITECTURE.md` §1:
stable-diffusion.cpp (desktop, separate process, X3b) and ONNX Runtime
Web (web, X3d).

### 7.7 · Checklist on a real machine (after X3c, for X1 part B)

The build environment has no GPU and the large models cannot be downloaded: the pipeline was
tested end to end with a fake runtime and just once with real SD 1.5
on CPU (`ROADMAP.md` X3c). The first real image with Z-Image is
made on a test machine:

1. **Requirements.** Windows 10 or 11 x64 (or Linux x86_64 with glibc ≥ 2.38) and
   an up-to-date graphics card driver (it brings Vulkan). On Windows,
   also the **Microsoft Visual C++ 2015–2022 (x64)** runtime: if it is missing,
   *Settings ▸ AI post-processing ▸ Runtime* says so and the button
   *Install Microsoft Visual C++ runtime…* opens the Microsoft
   page; install the x64 package and press *Check again*.
2. **The Vulkan runtime.** In that same row, *Download* (with a GPU
   the rule picks Vulkan). It has to end up at *Installed ·
   stable-diffusion.cpp version …, commit d637cfb* and *runs on* the
   name of the graphics card. If it says CPU while a GPU is present, note it.
3. **The model.** *Settings ▸ AI post-processing ▸ Models*: **Z-Image-Turbo
   Q4** (`ZIMAGE_Q4`, ≈ 6.5 GB) and *Use*. On a modest machine or one without a GPU,
   **SD 1.5 light** (`SD15_LIGHT`, ≈ 3.6 GB).
4. **A final 1024² render with AI.** Open the example (or a project of
   one's own), render window: 1024 × 1024, 16-bit PNG, the usual
   budget; turn on *AI post-processing* with the default values and
   *Render*. The queue says *AI · loading the model* and then *AI · tile 1
   of 1 · attempt 1 of 4* (and *· attempt 2 of 4*, with the reason below, if the guard
   asked for a retry).
5. **Note the times**: the engine render's, and the AI's the first
   time (it loads the model) and a second one straight after (already loaded). The report carries
   the AI seconds (`seconds`).
6. **Note the guard's report**: in the results viewer, the line
   *Checked: …* and, if it appears, *The AI was limited to N %* or the rejection (hovering over
   the line shows the numbers). Compare with the divider
   *Render | AI*: did anything change that should not have (shapes, text, colour of a
   material, focus)?
7. **Intervention 0**: the same render with Intervention 0 has to give an
   `…_AI.png` identical byte for byte to the engine's, and the runtime must not
   start (the row still has no *loaded:*).
8. **What to record**: the two images (`…_0001.png` and `…_0001_AI.png`), the
   result entry in `<data>/results/index.json` (it carries the full report,
   `ai.report`), the launcher log (`<data>/logs/`), a screenshot of the
   *Runtime* row, the GPU and its VRAM (*Settings ▸ AI post-processing ▸
   Hardware*), the times from step 5 and, if anything fails, the message
   verbatim.
