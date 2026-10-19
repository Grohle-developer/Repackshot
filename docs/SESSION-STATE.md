# Session state (2026-10-16) — how to resume without losing anything

This file is written by the lead (Fable) so that any new session can pick up
where this one stopped. What counts is what is in `origin`: the session
branch `ccr-8df3f848-6ukiky` (PRs #7 to #11 are merged into `main` by the
owner; #11, with E9, E6 and the 88 thumbnails, at `72e4f79`; v0.1.6 came out
of `c413669`; the PR open now is **#12**, session branch → `main`, with the
bug report triage, B1 and O2 when they land) and the branches
`wip/ccr-8df3f848/<phase>` with each agent's work in progress (they are
pushed after each *commit* of their agent; a "WIP" *commit* may have failing
tests). The local worktrees (`/home/user/Repackshot-<phase>`) and the
*scratchpad* are ephemeral.

## Merged into the session branch

M2a textures · P5 update from the app · L6 studio sets · U12 TIFF/DNG · O1
thin lens and bokeh · U13 aspect ratio in the camera · P6 plugins + film
plugin · E12 light choice by point · P6b carousel with slider and filters ·
N6 breakdowns and timeline · M3a node-based material editor (model, compiler,
editor, Fast view) · S2 rigid bodies (Drop, physics bar, `PHYSICS` clips) ·
S4a ambient particles (eight effects, Ambient section, `FXAM`) · U11 live
denoise · U11b denoise strength · E11 edge smoothing (Fine by default). Each
phase is marked “done” in `ROADMAP.md` with its *Done / What did not fit the
plan* paragraph.

## In progress (branch `wip/ccr-8df3f848/<phase>`; brief in `ROADMAP.md`)

| Phase | Branch | Status and next step |
| --- | --- | --- |
| U11 + U11b + E11 | `u11` | **Merged into the session branch** (`1ed4157`; the agent merged the head step by step up to `71521bc`, re-pinned the hashes that E12 moved —viewport preset `0x17514303`/`0x6db6039b`, E11 edges `0x3d8f85de`—, rewrote `o1.rsb`/`ambient.rsb` for the 64 B `RNDR` and the 88 scene hashes of L6's manifest, and passed all gates). `Repackshot-u11` worktree deleted. Pending separately: re-render L6's 88 thumbnails after E12 (point 2 below), now with E9 inside. |
| E9 (a, a2, b, c) | `e9` | **Merged into the session branch** (`d0f6373`, 2026-10-16; the agent merged the head up to the merge of PR #10 at `55b7fab` with all gates green and re-pinned the pins: example `0x75ba4cb4`, O1 `0x087d1276`, E11 `0xd01702ce`, O3a `0x21e43bb1`, E9 `0x5b5ea281`, ambient `0xeb60bea2`). The only red it left, the contrast of `GRADIENT_POOL` (1.96 < 2 with E9a's energy), was fixed by the lead raising the pool from 0.70 to 0.85 and re-rendering the 88 thumbnails (`PRESET` and `GRADIENT_POOL` change). `Repackshot-e9` worktree can be deleted. |
| E6 (bevel, wood, fabric) | `e6` | **Merged into the session branch** (`563086d`, 2026-10-16; the new agent merged the head `cdd4486` at `11e3442` resolving `MATL` with E6's bevel at byte 72 and E9's fields behind it, the integrator, `rt-cli`, `engine.yml` and the docs, and re-pinned the three E6 pins that E9a moved: bevel `0x2f228634` → `0xeacaae75`, wood `0x6fbc91f7` → `0x5ed1bf32`, fabric `0x5604ec69` → `0x53e6a855`; gates green at `e143e59` except the thumbnail manifest). **Verdict**: the 88 thumbnails are redone with the Doctor's bevel (the scene the code builds) and the `STRIP_EDGE` PNG is re-pinned. `Repackshot-e6` worktree can be deleted. |
| O3a → O2 | `o1` | **Merged into the session branch**: O3a (`1ea775c`) and **O2** (`57b2c90`, 2026-10-16; its final commit `593d480`: traced lens, camera rays in batches —13.7 % of the example render, before 29.1 %—, *Camera ▸ Lens*, the pick through *Fast*'s distortion; `PINNED_O2_TRACED_4SPP = 0x8f7d0ef8`). **Pending Fable** (rule 11): the verdict on the sheet (`out/lens-sheet.html`, regenerable with `tools/lens-sheet.mjs`; delivered to the owner as images), mask sampling, the adapter constants and the focal lengths of the charts (`ROADMAP.md` §O2, point 11). `Repackshot-o1` worktree can be deleted. |
| S4a air particles | `s4a` | **Merged into the session branch** (`af63f6f` + CI lines at `abca87b`; the agent first merged M3a, S2 and the head at `6e5799d` and passed all gates; ambient scene hash re-pinned after E12 to `0x415d7d74`, particles `0xe38b8480`). `Repackshot-s4a` worktree deleted. **S4b** queued (brief in `ROADMAP.md` after S4a). |
| S2 rigid bodies | `s2` | **Merged into the session branch** (`e0ce931`; the agent first merged the head with M3a at `cb4de73` and passed all gates). `Repackshot-s2` worktree deleted; the branch `s2` and `wip/ccr-8df3f848/s2` remain. |
| M3a node editor | `m3a` | **Merged into the session branch** (5e898cb, trailers rewritten on merging; verdict in `ROADMAP.md` §M3a). If a new session sees this row, the merge is already in `origin`; the `Repackshot-m3a` worktree can be deleted. |

## Usage-limit cut-off (2026-10-14, ~12:40 UTC) and checkpoints

The usage limit cut off the six running agents at once. Before resuming them
(the limit reset at 13:50 UTC) the lead left each worktree in a *commit* and
pushed all the `wip/` branches:

| Agent | Where it was | Checkpoint |
| --- | --- | --- |
| S2 | merge of the head done (`a5e8f1f`) and `physics-check` on N6's timeline (`9f7bcad`); still has to merge M3a and the verdict paragraph | clean worktree |
| S4a | merge of the head resolved, gates not run | `70573e3` (WIP merge commit) |
| U11 | E11 documentation | clean worktree at `89c82f7` |
| E9 | E9b integrator edits (walls, *exact* flag, MIS) | `146edb0` (1 file) |
| E6 | wood reasoning in the ROADMAP and gaps; fabric not started | `fb247b7` (3 files + 1 new) on top of `0c4095f` |
| O3a/O2 | O3a's final paragraph in the ROADMAP; O2 started (exporting the traced lens in rt-wasm) | `304696f` (2 files + 1 new) |

The six were resumed with `SendMessage` (same agent ids; no new agents are
created). If a new session does not have those agents, each `wip/` branch
contains everything: create the worktree (recipe at the end) and launch a new
agent with the phase brief from the ROADMAP and the order to continue from the
last *commit* (each WIP's message says where it was).

## Bug report: triage and B1 (2026-10-16)

The triage of the owner's report is in `docs/TRIAGE.md` (17 points: two
confirmed *bugs* —the focus with a click that undoes the same click and the
fabric colour when switching to nodes—, gaps that already have a phase and
judgement calls). `ROADMAP.md`, section “Owner's bug report”, defines
**B1** (Sonnet: focus with a click, fabric to nodes, `.repack` extension, AI
attempts counted and the preview that does not restart), **U14** (Opus, after
B1: live view in the queue), 1.4 after O2, and the *Judgement calls*
list. B1 is **merged** (`01edd43`, final commit `75f3a88`; the four fixes
with their tests and the browser check `tools/focus-click-check.mjs`).
Pending from the owner: the launcher log of an AI pass with attempts (2.2) and
a scene where the *denoise* washes out colours (4.2).

## Weekly-limit cut-off (2026-10-15) and resumption (2026-10-16, 10:00 UTC)

The **weekly** limit cut the session off on 2026-10-15 with two live agents
(E6 and O2) and the lead halfway through the `GRADIENT_POOL` touch-up. On
returning (2026-10-16, the limit reset at 10:00 UTC) the agents no longer
existed (they are not resumed with `SendMessage`): the lead left `o1` at
`5a576de` with O2's worktree as it was, pushed `wip/ccr-8df3f848/o1` and
`wip/ccr-8df3f848/e6` (`1dc375e`, clean), finished the touch-up (pool 0.85,
44 set tests green), saved the owner's bug report in `docs/TODO.md` and opened
PR #11. E6 and O2 continue with new agents (launched on 2026-10-16 at 10:30
UTC) from those *commits*, with their phase brief and the verdicts below. The
push loop of the `wip/` branches is not running: each agent pushes its branch
after each *commit* (or the lead does).

## Verdicts given to S2 and S4a (2026-10-14, in case the session is cut before they reach `ROADMAP.md`)

- **S2.** The playhead at 0: confirmed as it is done (the nodes held by a recorded simulation show their frame at 0 too, viewport and still, and the *gizmo* is hidden over them): frame 0 of a rendered animation has to be the start of the fall, and the still follows the playhead, which the simulation leaves at the end. Densities per family: accepted as typical values (review in M4). Decision 2 half done (clips grow through the *store* within the single undo step): accepted. The rest of “What did not fit the plan”: accepted and noted.
- **S4a.** Criterion 5 (cost ≤ 1.3×) applies to the presets' densities, not to the cap of 200 000: S4b measures it first (cost scene at the preset's number in `tools/ambient-sheet.mjs`); the particle BVH stays; the screen grid for camera rays only if a measured preset scene exceeds 1.3×. Photographic densities: accepted. Backlit dust: S4b gives dust, pollen and dust cloud a forward lobe (Henyey–Greenstein, g ≈ 0.7). Mottling of the rain under the side key: S4b, the drops make no caustics (the shadow ray passes with its coverage, without refraction). Placement (Ambient after Environment, cap in the engine block), widening by probability, 192-byte `FXAM`, sets behind the instance BVH: accepted. **S4b** stays queued with those four points (brief written by S4a's agent on its merge, after S4a).

## Pending for the lead (in order)

0. Done: with the wasm rebuilt after E12 (`npm run engine:build`),
   `REPACK_REQUIRE_POST_WASM=1 npx vitest run tests/optics.test.ts` passes
   entirely (14 tests): the bokeh thumbnail (`PINNED_BOKEH_THUMB`) did not
   move and the O1 scene gives the re-pinned hash in the wasm too. Nothing
   pending here.
1. Merge what each agent delivers into the session branch: resolve conflicts
   (CHANGELOG/ROADMAP/ARCHITECTURE by added sections; `MATL`: E6 bevel, E9
   fields, M2a texture block), `npm run check`,
   `npx vitest run --maxWorkers=2`, `npm run build`; if it touches the engine,
   `cargo fmt/clippy/test` and `npm run engine:build` (the wasm in
   `public/engine/` is not committed: recompile it before the parity tests).
   Push only to `ccr-8df3f848-6ukiky`. Update the description of PR #7.
2. Done (2026-10-16): L6's 88 thumbnails rendered with E9's engine by E9's
   agent and, after its merge, the `GRADIENT_POOL` touch-up (pool 0.85) with
   the whole `node tools/setup-thumbs.mjs`; `tests/sets.test.ts` green (44).
   The `tools/sets-sheet.mjs` sheet was not redone (it changes no verdict).
3. Phases in the queue (briefs already written in `ROADMAP.md`): M2b engine
   textures (after E6 and E9), M3b engine evaluates graphs (after M2b and
   M3a), M4 realism layer, E10 adaptive, E13 MNEE, S3 rain/dust and front
   glass (after S4a and S2), S9 cloths, S7 liquids, M5 weave and fuzz (after
   S8), O2.
4. **Release v0.1.7** (2026-10-16, with E9, E6, O3a, the thumbnails, **B1**
   —merged at `01edd43`— and **O2** —merged at `57b2c90`, with Fable's verdict
   on the sheet pending—; owner's request: “make the release on every
   change”): version commit on the session branch, PR to `main`, and
   `release.yml` launched on `main` with `tag` = `v0.1.7` and `commit` = the
   merge. Notes in `docs/release-notes/v0.1.7.md` (Windows checklist, points
   65 to 73). The agents' CHANGELOG lines go to a new `## Unreleased` on top of
   the latest version.
   **Published** (2026-10-16, run 38910767587 on `c3b71b0`, PR #13 merged by the lead): four *assets*.
4b. **Release v0.1.8** published (2026-10-16, run 38918178457 on `5a038f5`, PR #14): **O2b** (lens window on hovering the pointer; merged at `c511478`, final commit `500178a`).
4c. **Release v0.1.9** published (2026-10-16, run 38923974533 on `876944b`, PR #15): **U14** (live view of the running job in the results viewer; merged at `f5e97ec`, final commit `4a608c9`; the launcher gains `GET /api/render/<id>?fit=WxH`, flag 512). With it, of the report only the phases already queued (M2b, M3b) and the judgement calls remain.
4d. **Release v0.1.10** published (2026-10-16, run 38945938281 on `f2a5c9c`, PR #16): **M2b** (textures, mapping and labels in the engine; merged at `8410259`, final commit `6c5209e`; new pins `PINNED_M2B_TEXTURES_4SPP = 0x5d94b21c` and its passes, no earlier one moved; checkerboards 100 % and label IoU 0.989 against *Fast*; cost +16–19 % in the scene with textures, 0 in the others). **S4b** (particles) is still in `/home/user/Repackshot-s4b` (branch `s4b`, WIP to `wip/ccr-8df3f848/s4b`); the resolution of its clash with M2b in the integrator is in M2b's ROADMAP and was passed to the agent. Next in the queue: **M3b** (the engine evaluates the node graphs, point 1.6 of the report), after M2b.
4e. **Release v0.1.11** published (2026-10-16, run 38952733090 on `50dd9f3`, PR #17): **S4b** (merged at `accf3ae`, final commit `9ae938e`: forward lobe, drops without caustics, screen grid; `PINNED_AMBIENT_4SPP` `0xeb60bea2` → `0x8f9efac8`, the rest the same). The cost criterion is not met in the rain (1.63×) and stays, with the lobe part and the grain, in *Judgement calls* in the ROADMAP. **M3b** is still in `/home/user/Repackshot-m3b` (branch `m3b`, WIP to `wip/ccr-8df3f848/m3b`).
4f. **Release v0.1.12** published (2026-10-16, run 38966364632 on `b8f1426`, PR #18): **M3b** (merged at `1cfd2da`, final commit `bfff79c`: the engine runs M3a's programs, `PROG` section, bit-for-bit TS/Rust cross-test; new pins `PINNED_M3B_PROGRAMS_4SPP = 0x0d6e20ba`, its passes and `PINNED_M3B_PROGRAM_VALUES`; no earlier pin moved; seven of the ten example graphs match *Fast* in place and tone; cost +41–47 % in the scene with ten graphs, 0 in the others). Its open points are in *Judgement calls* in the ROADMAP. **Of the 2026-10-14 report nothing buildable remains without a decision from Fable**; the queue continues with M4 (realism layer, Fable verdict), E10, E13, S3, S9, S7, M5/S8.
4g. **Release v0.1.13** published (2026-10-17, run 38984924746 on `206f24e`, PR #19): **E10** (merged at `2992726`, final commit `b4718c4`: adaptive sampling in 8×8 blocks behind *Finish by noise*, *denoise* with each pixel's samples; new pins `PINNED_E10_ADAPTIVE = 0x264b4106` and `PINNED_E10_DECISIONS = 0xb492454a`, no earlier one moved). The error criterion (≤ 0.6×) is not met (0.83–0.84×) and stays in *Judgement calls*. **E13** (MNEE) delivered at `385a4c9` (`wip/ccr-8df3f848/e13`) but **not merged**: it does not improve the grain of milk or the caustics through curved glass and costs 1.8–2× with it; it stays in *Judgement calls* in the ROADMAP.
4h. **Release v0.1.14 published** (2026-10-17, the first that groups; run 39003597001 on `7bc7c50`, version PR #24; four *assets*): **Q1** (section view; PR #21, merged at `23e7ecc`, final commit `754cad0`; 20 B `SECT`, `INSTANCE_NO_SECTION = 2` in `INST.flags`, `FEATURE_SECTION = 4`; new pin `PINNED_Q1_SECTION_4SPP = 0x7a4182ea`) and **L5** (IES lights; PR #22, merged at `9ea1976`, final commit `68ef759`; `LGHT` type 5 of 80 B and the `IESP` section; `FEATURE_IES = 8`, because 4 was already Q1's; ARCHITECTURE §5.2 quaterdecies; new pin `PINNED_L5_IES_4SPP = 0x920f0be1`; the WASI *runner* sets `--no-turbo-fast-api-calls` because Node 22.22 crashed in the GC). No earlier pin moved. Notes in `docs/release-notes/v0.1.14.md`, Windows checklist 102 to 106. Q1's ◆ are in *Judgement calls* in the ROADMAP. Loose fix **PR #23** (`wip/ccr-8df3f848/lights-check`): `tools/lights-check.mjs` looked for the camera menu row by its whole text, and since U13 that row also carries the optics and the aspect ratio. It was merged (`dad8e83`) before #24, so its line is in the v0.1.14 section of the CHANGELOG.
4i. **Release v0.1.15 published** (2026-10-17, run 39014272395 on `27a6e64`, version PR #29; four *assets*):
   - **K1** (scene type, Interior style and interiors Doctor): PR #26, merged at `e1d06ba`.
   - **D1** (engine Doctor): PR #28, merged at `9e646e1`; it already carries K1 inside (the two Doctors run together and *Fix all* cleans both).
   - **`tools/tour-check.mjs`** (the *Nodes* step): PR #27.
   - K1's normals test has its own 60 s limit: it exceeded 5 s on CI.
   - No change in `engine/` and no pin moved.
   - Notes in `docs/release-notes/v0.1.15.md` (Windows checklist 107 to 111). K1's and D1's ◆ are in *Judgement calls* in the ROADMAP.
   - The rest of the queue waits for a decision from Fable or is deferred: M4, E7, E8 (in part), N3, K2–K8, S3/S9/S7/M5/S8. H1 repeats at the close of each version.
4j. **Release v0.1.16 published** (2026-10-17, run 39026134172 on `df9e1c9`, version PR #35; four *assets*; the images in the notes resolve):
   - **N1** (animation and video): PR #33, merged at `70c579f`. It brings WebM and MP4 video with own *muxers* through WebCodecs, four new types, the pivot, the custom curve, the fades between shots and the three-step wizard. D1's `output` check is now awake.
   - **H1** (v0.1.16 accessibility pass): PR #31, merged at `195d0c3`. Measured contrast, with 36 pairs pending from Fable.
   - **Gallery** `docs/GALERIA.md` (PR #32, `c5470a1`), at the owner's request: a record of the screenshots by version and by feature, to bring features to the README. Rule 2 of `CLAUDE.md` asks each phase for its entry under *Unreleased*, and the version PR moves it.
   - It is the first release with screenshots in its notes, with absolute URLs to the tag.
   - Windows checklist 112 to 117. N1's and H1's ◆ are in *Judgement calls* in the ROADMAP.
   - Loose fixes: PR #34, `tools/screenshot.mjs` with reduced motion. Then, PR #36 (`tools/render-window-check.mjs`, step g, and the four U5 screenshots re-recorded), merged by the owner at `319614b`.
4k. **Release v0.1.17 published** (2026-10-17, run 39053517710 on `597dad2`, version PR #43; four *assets*; the images in the notes resolve). Included, each through its PR:
   - **Fix for the *Settings* buttons** (*Downloads* and *Choose folder…* cut off; reported by the owner with a screenshot): PR #37, `bdc905c`, with `tests/seg-clip-browser.test.ts`.
   - **Provenance clean-up** (owner's request, 2026-10-17): PR #38, merged by the owner at `4cea2c3`. Out go the provenance notes in the catalogue data (name, link, *upstream*, headers); the data does not change. Git history and the published releases are not rewritten. **Rule for the agents: that earlier project is not mentioned and its checkout is not read.**
   - **L7** (Sets and Lights, filters, Replace / Hide / Add, thumbnails of one size): PR #39, `c1e33f1`.
   - **U15** (arrows on all values and sliders where there is a range): PR #40, `66abfe1`.
   - **N2** (alpha pass, passes to file, batches per studio, ZIP, the `ensureLoop` fix): PR #41, `3392432`.
   - **K3** (straight verticals, panorama, fisheye, plan and elevation, camera visible, auto exposure): PR #42, `ab6b868`.
   - Notes in `docs/release-notes/v0.1.17.md` with screenshots (Windows checklist 118 to 124). L7's, U15's, N2's and K3's ◆ are in *Judgement calls* in the ROADMAP.
   - **In progress for the next one** (owner's requests of 2026-10-17): **F1** (exact-to-the-pixel focus and Point / Object modes, with slider; “CRUCIAL”) in `/home/user/Repackshot-f1`; **O4** (simple and traced lens, each with its options; tilt and shift in the traced one) in `/home/user/Repackshot-o4`, delivered and merging K3. O4 renumbers the planned flare phase of STUDIO-TOOLS's table, which was also called O4.
4l. **Release v0.1.18 published** (2026-10-17, run 39068258799 on `7b72054`, version PR #49; four *assets*; the images in the notes resolve). Included, each through its PR:
   - **Start in *Fast*** (reported by the owner: the viewport rendered with no model on opening): PR #44, `c917be7`; *Viewport mode at start* disappears.
   - **O4** (simple and traced lens; tilt and shift of the traced one in the engine; easier tilt): PR #45, `9b84ff6`. The flare phase planned in STUDIO-TOOLS was renumbered O6.
   - **F1** (focus at the exact pixel with the engine's ray; *Distance · Point · Object* modes; focus slider): PR #46, `9aadc64`. The corner of a traced lens with distortion +1 at f/1.4 stays open.
   - **Session notes without the earlier project's name**: PR #47.
   - **C1** and the *Judgement calls* register (the owner asked the lead to take Fable's decisions; rule 11 changed): PR #48, `654342e`. AI at 50 with migration and a guard that really reads *Settings*; *Interior* with *Midday window*; AgX in the Doctor's fix; no question about untouched lights; 4.5:1 contrast of the secondary; normal maps never pointing inward.
   - Notes in `docs/release-notes/v0.1.18.md` with screenshots (Windows checklist 125 to 131).
   - **Approved phases, to be built:** C2 (focal length switch), M3c (*Wood* and *Fabric* nodes), N2b (the studio travels with the project), O2c (lens element editor), and the drop and the mix of geometries in S3.
4m. **Release v0.1.19 published** (2026-10-17, version PR #54, `ec6deee`; four *assets*; the images in the notes resolve). Included, each through its PR, with their ◆ decided in *Judgement calls*:
   - **N2b** (a job's studio travels with the project; *Add to my library*): PR #50, `699f2d5`.
   - **C2** (focal length switch *Keep the size of what is in focus*, per camera): PR #51, `3d57ef5`.
   - **O2c** (traced lens element editor; `designEflMm` in the engine): PR #52, `af071ec`.
   - **M3c** (*Wood* and *Fabric* nodes; opcodes `WOOD*`/`CLOTH*`, bit 5 `FEATURE_PATTERN_NODES`; the wood example is the oak with the node): PR #53, `076c64a`. **Bit 5 is taken: the next engine capability uses 6.**
   - Notes in `docs/release-notes/v0.1.19.md` with screenshots (Windows checklist 132 to 138; **the next one starts at 139**).
   - **Next phases:** M3d (the family's wood in *Fast* through the node path), S3 (the drop and the mix of geometries). The fuzz input on the material output goes with M5.
4n. **Release v0.1.20 published** (2026-10-18, version PR #58, `1197c90`; four *assets*; the images in the notes resolve). Included, each through its PR, with their ◆ decided in *Judgement calls*:
   - **M3d** (the family's wood in *Fast* through the *Wood* node path): PR #55, `a1a6d42`.
   - **M3e** (the knots of *Fast* where *Full* puts them; the fabric baked when a thread covers 2.5 texels, with its fuzz): PR #56, `ba373d2`.
   - **S3**, first part (the drop, the mix of shapes, *Water drops*; the front glass `GLAS`; bit 6 `FEATURE_DROPS`): PR #57, `cdce786`. **Bit 6 is taken: the next capability uses 7.**
   - Notes in `docs/release-notes/v0.1.20.md` with screenshots (Windows checklist 139 to 145; **the next one starts at 146**).
   - **Next phase:** S3b (the rain that settles and slides, the dust that settles, the glass fed by the scene, the simulation; *Shape* out of *Advanced*; the approximate glass in *Fast*).
4o. **Release v0.1.21 published** (2026-10-18, version PR #61, `6a1fda5`; published from `49b98a7`, the merge of PR #63; four *assets*; the images in the notes resolve). Included, each through its PR, with their ◆ decided in *Judgement calls*:
   - **S3b** (the front glass fed by the scene, `rt_phys::wet`; the visible *Shape*; the glass in *Fast*; bit 7 `FEATURE_GLASS_LAYOUT`): PR #59, `26f1f51`.
   - **S3c** (rain, dust and snow on the parts, `rt_phys::wet_parts` and the `WETP` section; the warnings of bits 7 and 8; bit 8 `FEATURE_WET_PARTS`): PR #60, `fdadccb`. **Bit 8 is taken: the next capability uses 9.**
   - Notes in `docs/release-notes/v0.1.21.md` with screenshots (Windows checklist 146 to 151; **the next one starts at 152**).
   - The first `release.yml` run (39110320054) failed in the *smoke test*: the `spawnSync` of `cargo run -p rt-cli` blocked Node's event loop for more than 30 s (since S3b `rt-cli` depends on `rt-phys`), and `fetch` reused a connection the server had already closed. Fix (PR #63): `packaging/smoke.mjs` builds the scene before starting the launcher.
   - **Next phase:** S3d (dripping and splashes through the air, dust motes, dynamic parts, the studio floor, finer samples in the set). From v0.1.22 on, the manual checklist goes in `docs/testing/windows-checklist.md` (from point 152), not in the notes.

4p. **Release v0.1.22 published** (2026-10-18, version PR #69, `f29d3a6`; four *assets*; the images in the notes resolve). Included, each through its PR, with their ◆ decided in *Judgement calls*:
   - **S3d** (drips and splashes through the air, `WETF`; the meter; bit 9 `FEATURE_WET_FLIGHT`): PR #62, `8c8c9d2`.
   - **The smoke-test fix** (PR #63, `49b98a7`), the **English documentation** (PR #64, `3b3185a`) and **`release-notes.yml`** (PR #65, `2731d72`), which rewrote the notes of every published release in English.
   - **X6** (the AI controls with a measurable effect, the style as a grade, `MAX_STRENGTH` 0.6, the stored Full-engine example): PR #66, `a24b884`.
   - **S3f** (organic drops: growth, gathering, smooth merges, rivulets, shapes, hanging and pinch-off; bit 10 `FEATURE_WET_SHAPES`): PR #67, `c2b4d02`. **Bit 10 is taken: the next capability uses 11** (S3e's floor already counts on it).
   - **X7** (the AI model through an API: `AiModelBackend`/`ModelBackend`, the generic endpoint and two unverified presets, the key on this computer, consent per host): PR #68, `2302497`.
   - Public notes in `docs/release-notes/v0.1.22.md`; the Windows checklist is points 152 to 161 in `docs/testing/windows-checklist.md` (**the next one starts at 162**).
   - **Next phase:** S3e (moving parts getting wet, the studio floor, the set's fine samples, dust motes, wind on the drops in the air, drops running along a side edge).

4q. **Release v0.1.23 published** (2026-10-19; four *assets*; the images in the notes resolve). Included, each through its PR, with their ◆ decided in *Judgement calls*:
   - **F1** (focus on what the engine shows; *Focus ▸ Object* on the surface the camera sees): PR #70, `50ab2a6`, and PR #71, `90d2a98`.
   - **S3e** (moving parts getting wet, the studio floor, the set's fine samples, dust motes, wind on the drops in the air, drops running along a side edge): PR #73, `a07de84`.
   - **U16** (the physics of each part in one place): PR #74, `41d4b95`.
   - **S9** (cloth with real physics, XPBD): PR #72, `daf91c1`.
   - Public notes in `docs/release-notes/v0.1.23.md`; the Windows checklist is points 162 to 194 in `docs/testing/windows-checklist.md` (**the next one starts at 195**).

4r. **Release v0.1.24 published** (2026-10-19; four *assets*). Included, each through its PR, with their ◆ decided in *Judgement calls*:
   - **AI API presets, the connection test, the partial save and the shortcut fix** (Google Gemini and xAI Grok Imagine presets; the `{{image_base64}}` placeholder fix; *Test connection*; the partial image on stop; the render shortcuts no longer global): PR #76, `e9c5439`.
   - Public notes in `docs/release-notes/v0.1.24.md`; the Windows checklist is points 195 to 209 in `docs/testing/windows-checklist.md` (**the next one starts at 210**).

**PR and release rule (owner's request, 2026-10-17):** **one PR per change** (each phase, or each loose fix, in its PR to `main`: from its branch `wip/ccr-8df3f848/<phase>` after merging `main` into it and passing the gates; the lead's documents, from the session branch), and **releases that group several changes** (one every two or three merged phases, or sooner if a fix the owner is waiting for goes in), with their own version PR from the session branch (version, CHANGELOG, notes) and `release.yml` on `main`. Up to 2026-10-17 one release per change was made (v0.1.7 to v0.1.13).
5. **Release v0.1.6 published** (2026-10-14, run 38600597560 on `c413669`, tag `v0.1.6`, release 412955577): the four *assets* uploaded by the workflow (Windows 11 portable 329 872 B, Linux portable 11 158 342 B, installer 9 426 684 B, `SHA256SUMS.txt`). The first attempt (run 38599628176) failed in the *smoke test* because it read the launcher's frame with a 48 B header (U11 raised it to 52): fix in `packaging/smoke.mjs` (PR #8). **`film-0.1.0.rpk` is missing as an asset**: the session's GitHub proxy rejects binary bodies (only JSON), so the owner uploads it by hand (the file was delivered in the chat; sha `a60dd9ed…3d8a`, 1 956 072 B); until then *Settings ▸ Plugins ▸ Install* from the registry fails the download (installing from a file does work).
   (procedure in `ROADMAP.md` P1 and `release-notes/`): also upload
   `film-0.1.0.rpk` rebuilt by P6b (sha256
   `a60dd9edea828f4ed29acd3d29b9ab1ffde384284da8c6a6a6619cc1d6ba3d8a`,
   1 956 072 B; delivered to the owner in the chat) as an *asset* of the
   release; the activation key is held by the owner (it is not in any
   repository). The first update from the app is from this version to the
   next.
6. `docs/TODO.md` keeps two of the owner's documents as they were: the deferred specification (Room Builder, walkthroughs, canvas panels, ambient physics and wind, MCP server, liquid emitter/drain, video with consistent AI and Open Gate; wood knots) and, since 2026-10-16, the **serious bug report** (mapping, size and offset of textures in the material editor; drop and varied geometries in Ambient; lens choice with visible distortion and bokeh, element window on hovering the lens and lens editor; woods and nodes that do not drive the material; focal length as a camera/object *toggle*; focus on the exact pixel of the click; AI Render that hardly does anything and gets stuck in a loop of attempts; live preview in the queue; `.repack` extension; denoise that washes out lights and colours; materials that do not adjust to the size of the solid; studio presets inside Studios with their lights as switchable-off additions; and, aside, a double bar in the LUT carousel of aintfilm). **The report goes before the specification**: they are regressions and gaps in what was published; it becomes phases of `ROADMAP.md` (brief and lead's verdicts) as soon as E6 and O2 finish.

## To resume a phase

```bash
git fetch origin
git worktree add /home/user/Repackshot-<phase> -b <phase> origin/wip/ccr-8df3f848/<phase>
ln -s /home/user/Repackshot/node_modules /home/user/Repackshot-<phase>/node_modules
```

With that link in the worktree, **never** `git add -A` without looking at
`git status` first: `.gitignore` already covers `node_modules` with and
without a slash (since `1cdefb0`), but an earlier *checkpoint* (`70573e3`)
ended up following the link and each *checkout* of the branch replaced the
real `node_modules` with a link to itself; if that happens,
`git rm --cached node_modules`, delete the link and `npm ci`.

Launch an agent (Opus for large engine/UI work, Sonnet for the mechanical)
with: the phase brief in `ROADMAP.md`, the verdicts above, the rules of
`CLAUDE.md`, this session's two commit *trailers*, and the order not to push.
The decisions marked **Fable** are taken by the lead with contact sheets
(rule 11).
