# Interface (`src/ui/`)

The interface of `docs/UI.md`: HTML + CSS + TypeScript with no framework. It talks
to the model only through the store (`src/core/store.ts`); it never
imports from `render/` or `io/` (`src/main.ts` wires that up through
`AppServices`, see `ports.ts`).

| File | What |
| --- | --- |
| `strings.ts` | All the strings, `en` and `es` side by side; `t()`, `L()` (both languages, for undo labels). On the desktop (`setStringsPlatform('desktop')`, P3e) the strings that talk about the browser say their own thing (`DESKTOP_TABLE`); those of rows the desktop does not show are in `WEB_ONLY_STRINGS` |
| `theme.css` | Colour tokens (achromatic, `ui-achromatic` test), typography and measures |
| `layout.css`, `components.css`, `panels.css` | Regions, controls and panels |
| `reactive.ts` | `Scope.watch(selector, fn)`: fine-grained updates by reference, no virtual DOM |
| `settings-effects.ts` | What a setting changes outside the window (U6): interface and text size, contrast, motion, focus, tooltip delay, viewport navigation and grid, engine, history limits, screen-reader announcements |
| `settings.css` | The Settings window |
| `ui-state.ts` | Interface state (tabs, drawers, widths…); the part that is remembered (`Layout`) goes to the settings document with `try/catch`. It includes `library`, the user's own library (U4): user state, outside the project and undo; `main.ts` saves it with `io/library.ts` |
| `commands.ts` | What buttons, palette and keyboard do; it returns an inline confirmation when needed. Project (U2): `saveProject` (with `saveAs`), `openProject`, `openProjectFile`, `requestNewProject`, `dropFiles`; they ask about unsaved changes with `ui.prompt`, which the header draws under the project name |
| `shortcuts.ts` | The single shortcut map: keyboard, palette and tooltips |
| `physics.ts` | The simulation in progress (S2, UI.md §2.5): *Drop*, *Start*, *Pause* / *Resume*, *Stop*, *Reset*; each simulation records its `PHYSICS` clips and the playhead follows them; what arrives while paused waits for *Resume* and *Stop* confirms the pose on screen; one simulation is one gesture (one undo entry) and *Reset* is another |
| `render-queue.ts` | The queue in progress (U5): *Render* only its jobs, *Start queue* all of them in order, *Pause*, stop, the frames of an animation, saving and history; always with the tracer (`renderFrame`). N2: a job's studio on a copy of the project (`jobProject`), the pass files next to the image and the group's ZIP (`saveOutput`, `flushIdleZips`) |
| `components/` | `NumberField`, `Slider`, `Segmented`, `Toggle`, `Select`, `Section`, thumbnails, inline confirmation, menus, tooltip, palette; `library.ts`: inline name field, cards and rows of *Mine* with rename and delete, *Export library* / *Import library* footer; `split-compare.ts`: any two images with a sliding divider (U5; X3 reuses it); `material-drag.ts`: dragging a material with pointer events (U7: ghost, drop zones, `Esc`, `Alt` = copy) |
| `updates.ts` | Updates as the interface runs them: ask `services.updates` for the latest published version, save the answer (`updateCheckedAt`, `updateLatest`, in the settings `layout`), announce a new version only once (a discreet note in the status bar, never a window) and open the download or the notes |
| `panels/settings-*.ts` | The Settings window (U6, UI.md §2.9): `settings-window.ts` (window, search, deep links, keyboard), `settings-rows.ts` (rows from the metadata), `settings-sections.ts` (own rows: measure performance, storage, desktop, About with the licences), `settings-ai.ts` (active model, model manager, licences, import, hardware and recommendation), `settings-updates.ts` (Updates: version, *Check for updates* with its result, *Check at startup*, last check) |
| `tour.ts`, `panels/tour.ts`, `tour.css` | The guided tour (U10, UI.md §4.7): the steps as data with the `data-guide` attributes they ring and what they need on screen (`TourStage`), the rules for starting, `startTour` / `tourNext` / `tourBack` / `endTour` and `placeCard` (where the card goes); the layer that dims, rings and handles the keys |
| `ai-runtime-state.ts`, `panels/ai-runtime-notice.ts` | The notice about the AI runtime (U10): the single poll of `GET /api/ai/runtime` (`RuntimeWatch`), the status-bar note once per session, the buttons (*Install*, *Resume*, Visual C++, *Check again*) and the box in the render window and in Settings |
| `panels/` | Header, scene, viewport, inspector (with `insp-physics.ts`, the *Physics* section, S2), bottom bar (Animation, Physics —`physics.ts`, S2— and Queue drawers, last result, *Render…*), render window (`render-window.ts`), results viewer (`results-viewer.ts`), status, guide; `add-menu.ts` (*Add ▸ Primitive*, U9) and `scale-panel.ts` (*Right click ▸ Scale…*, U9) |

## URL parameters (demos and captures)

All of them go through the same commands a person would use, so the
result is a normal, undoable state.

| Parameter | Effect |
| --- | --- |
| `example=1` | Loads the example part |
| `preset=JEWELLERY` | Picks that product type (`STUDIO_PRESETS`) and creates the studio |
| `setup=REMBRANDT` | Picks that light setup (`LIGHT_SETUPS` or `PRESET`) and shows its style in the catalogue |
| `theme=dark\|light\|system` | Theme (otherwise the saved one or the system's; dark unless the system asks for light) |
| `lang=en\|es` | Language |
| `drawer=animation\|physics\|queue` | Opens that drawer of the render bar |
| `panels=collapsed` | Collapses both side panels (image mode) |
| `select=cap` | Selects a node by its example key (`model`, `closure`, `base`, `body`, `label`, `collar`, `cap`) or by its name |
| `catalog=1` | Opens the material catalogue (in the category of the selected material) |
| `material=GOLD` | Assigns that material to the selection (or to everything) |
| `sequence=HERO` | Applies that animation preset (`SEQUENCE_PRESETS`) |
| `t=2` | Puts the animation playhead at that second |
| `guide=1..6` | Opens the guide at that step |
| `tool=select\|orbit\|pan\|zoom\|move\|scale` | Activates that viewport tool (`move`: the move tool, with the gizmo on the selection; `scale`: the scale tool, U9, with only the scale handles) |
| `mode=fast\|full` | Viewport mode (*Fast* or *Full*); *Full* starts as soon as the engine has loaded |
| `render=image\|animation` | Opens the render window (U5) on *Image* or on *Animation* |
| `settings=general\|ai.models\|…` | Opens Settings at that section, or at that row or part (deep link: `openSettings`) |
| `tour=0\|1\|auto` | The guided tour (U10): `0` never starts on its own (checks and captures with a fresh profile; automation, `navigator.webdriver`, does not launch it without a parameter either), `1` launches it now, `auto` does what the first launch does even under automation |
| `ai=synthetic` | AI post-processing runs with the **synthetic** service (X4: no model, deterministic) instead of saying *coming soon*; for captures, demos and browser checks (`tools/ai-post-check.mjs`). Without it, the switch is disabled until X3c connects the real pipeline |

Examples used for the captures in `docs/ui/`:

```
?example=1&preset=JEWELLERY&setup=REMBRANDT&theme=dark
?example=1&theme=light&select=cap&catalog=1
?example=1&preset=JEWELLERY&setup=REMBRANDT&theme=dark&drawer=animation&sequence=HERO&t=2
?example=1&preset=JEWELLERY&setup=REMBRANDT&theme=dark&select=cap&tool=move
?example=1&preset=JEWELLERY&setup=REMBRANDT&theme=dark&mode=full
```

`#app[data-ready="1"]` appears when the interface has painted, the viewport
has drawn its first frame and the visible material spheres are rendered
(capped at 9 s).
