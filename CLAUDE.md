# Repackshot — entry point for agents and people

Repackshot is a KeyShot-style product renderer, source-available and free
for non-commercial use (PolyForm Noncommercial 1.0.0), written **from
scratch in a clean room**, that runs in the browser: you import a model,
assign materials, light it with a studio and render a good-looking image,
fast. Its pillars: product types, a catalogue of light setups by style,
materials with procedural wear, Doctor, tiered selection, photographer's
language.

## Read this in this order

1. `README.md` — clean-room rules. **Non-negotiable.**
2. `docs/ROADMAP.md` — what has to be done, in which phase, and **which
   model runs each phase** (Fable decides; Opus builds; Sonnet ports and
   mechanises; Haiku does the maintenance tasks). Find your phase and read
   only what it needs.
3. `docs/SPEC.md` — what the product does (behaviour, data model).
4. `docs/ARCHITECTURE.md` — stack, module map, *store*, engines.
5. `docs/UI.md` — the interface, control by control.
6. `docs/INTERIORS.md` — interiors and furniture: integration decision,
   sources and phases K1–K8. Only if your phase is one of those.
7. `docs/AI-POST.md` — optional AI post-processing: model, safeguards,
   interface and phases X1–X5. Only if your phase is one of those.

## Before touching anything

```bash
npm ci
npm run qa            # types + tests + UI build. Must be green.
npm run engine:test   # cargo test of the engine. Also green.
npm run screenshot    # leaves out/screenshot.png using the local Chromium
```

To touch the engine (`engine/`), also run, from `engine/`:
`cargo fmt --all -- --check`,
`cargo clippy --workspace --all-targets -- -D warnings` and
`cargo build -p rt-wasm --target wasm32-unknown-unknown --release`.

## Working rules (non-negotiable)

1. **Clean room.** Nothing derived from KeyShot binaries. Sources: public
   literature, open source under a compatible licence, black-box
   observation. Not even a file name with "keyshot": `.gitignore` would
   silently ignore it.
2. **One roadmap phase per PR**, with `npm run qa` green before opening it
   and the phase marked as done in `docs/ROADMAP.md` with a paragraph on
   what was done and what did not fit the plan; the phase's new
   screenshots, each with its entry in `docs/GALERIA.md` under
   *Unreleased* (the release PR moves that block under the new version).
3. **Every bug fixed comes with its test**, and you check that the test
   fails if the bug is reintroduced. If a bug slipped through because a
   test or a *mock* was more permissive than reality, the test is fixed
   too.
4. **The interface chrome is achromatic.** White, black and greys, in both
   themes. Colour appears only in the content (render, thumbnails).
5. **Every interface string exists in `es` and in `en`** in
   `src/ui/strings.ts`. English by default.
6. **Every mutation goes through the *store*** (`src/core/store.ts`) and is
   undoable. `ui → core`, `render → core`, `io → core`; never the other
   way round.
7. **Stable catalogue keys** (`src/data/`): you add, you do not rename.
8. **Licence and dependencies**: the project is **PolyForm Noncommercial
   1.0.0** (`LICENSE`; summary in the `README`): free for non-commercial
   purposes, no commercial use without a separate licence from the holder.
   For that reason, interface dependencies may only be permissive
   (MIT/Apache/BSD/ISC/CC0), never copyleft (GPL, AGPL) or non-commercial,
   and each carries a line in `docs/ARCHITECTURE.md` §1. The only
   exception: `occt-import-js` (LGPL-2.1) for STEP and IGES, isolated
   under the conditions of that section. **In the engine, none**:
   `engine/` is Rust from scratch, only `std`; no crates.io, nothing
   copied from other renderers. CI checks it.
8b. **The engine is portable and deterministic**: no system APIs in
   `rt-core`, no `unsafe` outside the `simd` module, the wasm shim and
   `rt-app/src/platform/` (the native window: Win32 and WebView2), `f32`
   everywhere, and the same scene with the same seed gives the same pixels
   on any architecture and with any number of threads. `clippy -D warnings`
   and `cargo fmt` clean.
9. Code, identifiers, comments and **all documentation in English** (the
   project is public). The interface is bilingual: every UI string exists
   in `en` and `es` in `src/ui/strings.ts`, English by default.
10. **No numbers are made up in the interface**: the viewport meter shows
    what the engine says. What is not done is marked *coming soon*.
11. Decisions marked **Fable** in the roadmap (photographic, visual
    judgement, architecture) are not taken by an agent on its own: the
    data is prepared, noted with ◆ and decided by the session lead (as
    instructed by the owner, 2026-10-17), who records them in *Judgement
    calls* in `ROADMAP.md`.
12. When something does not fit the documents, note it in the PR and carry
    on with what does fit; the contract is not "fixed" unilaterally.
13. Release notes and public docs are written for the public, never
    addressed to the owner; manual test checklists live in
    `docs/testing/windows-checklist.md`, not in release notes.

## Known pitfalls

- `npm run screenshot` captures `dist/` (run `npm run build` first) and
  uses `--use-gl=swiftshader`: the capture works, but slowly.
- `src/main.ts` must leave `#app[data-ready="1"]` once the interface has
  painted, or the capture is taken too early.
- three.js is Y-up and the model is Z-up: the conversion lives only in
  `src/render/preview.ts` (`toThree`).
- `pkill -f "vite"` kills the very shell that launches it. Use
  `pgrep -f "[v]ite"`.
- In this environment crates.io is blocked (403). It does not matter: the
  engine has no dependencies. `rustup target add wasm32-unknown-unknown`
  does work.
- With several agents working at once the machine is heavily loaded and a
  slow test (`io-rhino`) may exceed the time limit: repeat with
  `npx vitest run --maxWorkers=2` before assuming anything is broken. And
  `pgrep -f` also finds your own shell if the pattern appears in the
  command: use `pgrep -x`.
- `rt.wasm` is not committed to the repository: `npm run engine:build`
  generates it in `public/engine/`; the interface must start without it
  (with the preview only) and say so in the meter.
