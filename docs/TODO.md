Translated from the owner's original notes.

# Deferred TODO — documents saved as they were (2026-10-14/16)

Work requested for **after** everything in progress is finished (see `ROADMAP.md` and `SESSION-STATE.md`). It is not implemented yet; when its turn comes, each section becomes phases in `ROADMAP.md` with a brief and lead's verdicts. Saved at the owner's request without changes. It contains two documents, one after the other: the Room Builder and walkthroughs specification (2026-10-14) and the serious bug report (AI Render and earlier; added on 2026-10-16). The bug report takes priority over the specification: they are regressions and gaps in the published version, not new work. Its point-by-point triage is in `TRIAGE.md`, and what comes out of it (B1, U14, the judgement calls) is in `ROADMAP.md`, section “Owner's bug report”.

---

# Repackshot — Room Builder + Walkthroughs: future specification

**Status: DEFERRED.** Requested by the owner on 2026-10-14 for **after everything in progress is finished** (v0.1–v0.3 and the rest of the open work). Do not implement yet. This document is the specification saved exactly as it was requested, to pick it up again when the time comes.

## 1. Room Builder in the style of The Sims 4

A room builder with the same way of putting a room together as in The Sims 4: drawing / raising walls directly and intuitively, not through loose parameters.

### Construction / decorative elements (model catalogue)
- Windows (various models).
- Skirting boards.
- Wall paintings / pictures.
- (Extensible catalogue with the same behaviour: each type is a model that can be placed on the room.)

### Presets (same behaviour as the builder, rooms already set up)
- **Square room** — generic base room, an empty starting point.
- **Photography studio room** — includes:
  - White studio-fabric backdrop falling down (cyclorama curve: it drops from above and spreads over the floor, with no wall-floor edge).
  - Spotlights.
  - Fabric support (backdrop structure / stand).
- More presets under this same behaviour (the list to be defined when it is picked up again).

### Design notes (to be confirmed when implemented)
- The builder works on the render scene: the room is scene geometry, not an overlay.
- Presets must be editable after loading them (move / remove / add elements), not closed scenes.

## 2. Wood material: knot correction

Current defect to fix (the owner's observation on the wood render):

1. **Odd straight dark streaks coming out of the knots for no reason.** The knots generate straight dark strokes that do not follow the logic of the grain.
2. **Knot colour not quite right.** Adjust the colour (more faithful to a real knot: darker centre, gradual transition, not a flat stain).
3. **Position: knots are usually in between two grain lines, not just "stuck to one".** The generator must place the knots in the space between two grain lines, not anchored to a single grain line.

Specification of the desired behaviour:
- The knot is born **between two grain lines** (in the gap), not attached to one.
- The neighbouring grain lines **deviate / wrap around** the knot (grain flow deformed around the knot), neither going straight through it nor leaving it in straight streaks.
- Concentric rings of the knot deformed by the grain flow, with a gradual colour falloff centre → edge.
- No spurious straight dark strokes coming out of the knot.

## 3. Walkthroughs on foot

### Access: the Street View-style figure
- **Easily accessible:** a "figure" like the one in Google Street View is dropped onto a point of the render map.
- **When the figure is grabbed, the view changes to an aerial plan view** (top-down plan of the scene) to choose the drop point precisely.
- **The figure leaves a shadow of where it would land** while it is dragged over the plan: a floor marker that shows the exact landing point before releasing.
- **On dropping (releasing), the view changes to the figure's view** = walkthrough mode is entered at that point, in first person from the assigned camera.
- Dragging and dropping the figure at any walkable point of the scene = entering walkthrough mode at that point.
- **The figure is always invisible** (never rendered, never appears in the recording). It is only the entry point / position marker. The drop shadow is a UI indicator in the plan view, not the rendered figure.

### Leaving walkthrough mode
- **You can leave "walkthrough" mode at any moment.**
- **On leaving, you can choose whether to save this new position into the selected camera** (dialog / save / discard option): if saved, the selected camera adopts the position (and orientation) where the walkthrough ended; if not, the camera stays as it was.

### The figure's camera
- The figure carries **an assigned camera on top**.
- **By default: the camera in the current view** at the moment the figure is dropped.
- **Also configurable in the panel:** the camera assigned to the figure can be changed from the panel (not only the current one).
- **Figure height fully configurable** (= eye / camera height above the floor). No fixed value: the owner adjusts it freely.
- **The height slider must be in the UI as a vertical slider on the edges of the canvas area** (attached to the viewport edge, not in a distant floating panel or only in Settings). Direct adjustment while in / preparing the walkthrough.

### Movement and feel
- **WASD** to move + **mouse** to move the camera (first-person, video-game style).
- **Footstep simulation:** with or without it (toggle). With it: camera sway / bobbing while walking. Without it: stable camera, clean gliding.
- **Configurable smoothness** with more or less intensity, separately for:
  - Camera movement.
  - Zoom.
  - Footsteps (frequency / amplitude of the bobbing when the simulation is active).
- The walkthrough must feel adjustable: from a dry, immediate response to smoothed movement / with inertia, according to the smoothness controls.

### Recording
- **A clearly visible REC button in the UI** to record the walkthrough. It has to be seen at first glance, not hidden in a menu.
- The walkthrough **is recorded as a plain camera animation** (not as flat video, not as a locked path).
- Consequence: the recording is **editable frame by frame in the camera position** — each frame is a camera position (and orientation) keyframe that can be corrected / touched up in the animation editor after recording.

### Design notes (to be confirmed when implemented)
- Collision / walkthrough limits: to be defined (walk through walls freely, or collide with the room geometry?).
- The recording must reuse the v0.3 camera animation system (turntable / animation), not a parallel system.
- The REC button must have a visible recording / stopped state, and the recording must be pausable without losing what was recorded.

## 4. Canvas panels: hide, collapse, move and configure (right click)

The small panels overlaid on the canvas must be customisable, not fixed.

### Affected panels
- **Render progress** panel.
- **X, Y and Z axes** panel (axes gizmo / indicator).
- **Top** panels (the canvas's top bar(s)).

### Hide / collapse
- The small canvas panels can be **hidden**: render progress, X/Y/Z axes, etc.
- **The top ones only need to be collapsible with a button, instead of hidden:** the top bar does not disappear entirely; it collapses / expands with its collapse button, always remaining recoverable from the canvas itself.

### Move and configure (right click)
- **All panels must be movable by dragging them** (drag & drop to another position on the canvas).
- **All of this with a right click on these panels:** the right-click menu on a panel allows:
  - Configuring the panel's **buttons** (which ones are shown).
  - Configuring its **position**.
  - Choosing **which to remove or add** (which buttons / elements of the panel are visible).
- That is: right click = the panel's customisation menu (buttons, position, visible elements), not a generic menu.

### Showing again
- Hidden panels **must be able to be shown again from Settings, in the interface panel** (Settings → Interface: list of panels with show / hide, and restoration of the ones that were removed).

### Design notes (to be confirmed when implemented)
- The panel layout must persist between sessions (saved layout).
- Collapsing the top bars must leave a visible handle / button to expand them, never a dead-end state.
- The right click must not conflict with the viewport's orbit right click / context menu: a right click on a panel acts on the panel; on the empty canvas, the usual viewport behaviour.

## 5. Physics + ambient effects + wind + fuzz

### Physics in the ambient effects
- **Physics must be applied to all ambient effects.** No ambient effect is left outside the physics system: all respond to the same forces.
- **Realistic gravity:** the gravity acting on the effects is realistic (Earth value by default, not exaggerated video-game gravity).
- **Air:** the air also acts (aerodynamic resistance / drag on the particles and elements of the effects). The physics is gravity + air, not gravity alone.

### Particles
- **Configurable particle generation time:** how long particles are generated (emission window / duration) is a parameter adjustable by the owner, per effect.
- (To be defined when implementing: whether the control also covers emission rate and the lifetime of each particle, or only the duration of generation.)

### Fuzz
- **Fuzz has a toggle to activate realistic physics too.**
  - OFF: static / decorative fuzz, no physics simulation (current / cheap behaviour).
  - ON: the fuzz fibres respond to realistic physics (gravity + air + wind, see below), like the rest of the ambient effects.

### Combining ambient effects
- **In Ambient, several ambient effects can be combined.**
- **Maximum two at a time by default, to avoid clogging** (saturation / performance jam from the accumulation of simulations).
- The limit of 2 is the default value (to be confirmed when implementing whether it can be raised in Settings, with a performance warning).

### Wind simulator
- **A wind simulator can be added** (as one more effect / emitter of the ambient system).
- Wind parameters:
  - **Direction.**
  - **Volume** (amount / flow of air).
  - **Speed.**
  - **Density** (of the air).
  - (… = open list, those four at a minimum.)
- **This will clearly affect the physics:** wind is a force of the physics system — it pushes / deflects particles of the ambient effects, moves the fuzz when physics is active, and in general modifies any effect subject to physics.

### Preview
- **When the preview of simulated ambient effects is activated, by default they will always be seen in fast** (fast / low-quality preview mode, so as not to clog the viewport). The final render does not stay in fast; fast is only the default mode of the simulated-effects preview.

### Design notes (to be confirmed when implemented)
- The physics must be a single shared system (gravity + air + wind) that all effects draw from, not a physics per effect.
- The limit of 2 simultaneous effects must apply to simulated effects (with physics / particles), not to static ambient effects if there are any — confirm.
- The preview's fast mode must be switchable (if the owner wants a full-quality preview, they must be able to change it; the default is fast).

## 6. Built-in MCP server: operating the whole application

### MCP server in the application
- **Add an MCP server to the application** (Model Context Protocol, built into Repackshot, not a separate external process).
- **Let it operate the whole application:** the MCP server exposes tools to operate the entire application — scene, materials, lights, cameras, Room Builder, renders, walkthroughs / camera animation, ambient / physics effects, panels and interface, Settings — not just a subset (reading or rendering).
- Anything the owner can do in the UI must be doable via MCP, as long as the corresponding permission is activated (see below).

### Permissions with toggles — Settings > MCP
- **Each permission will be switchable on or off with a toggle in the menu.**
- Location: **Settings > MCP** — the full list of permissions lives there, each with its toggle.
- Turning a permission off = the MCP server stops exposing / denies that capability (it does not run it even if the client asks). Turning it on = allows it again. The change applies without restarting the app (to be confirmed when implementing whether any permission requires restarting the server).
- Granularity is **per permission**, not a single global on/off: the owner can leave, for example, reads active and writes / destructive actions disabled, or activate only the family of tools needed.

### Design notes (to be confirmed when implemented)
- The exact list of permissions to be defined when implementing (proposal: group by domain — scene, materials, cameras, render, animation/walkthroughs, ambient/physics, UI/panels, Settings — and within each separate read from write/action).
- The default state of each permission to be defined (pending the owner's decision; the criterion to apply: whatever is destructive / deletes or overwrites must be conservative by default).
- Transport and access to be defined: local only (stdio / localhost) or also remote HTTP? With authentication / token? The server must not be left open to the network without the owner's explicit permission.
- The Settings > MCP panel must show the server's state (running / stopped, port / transport if applicable) and which client is connected, if any.
- Log / audit: keep a record of the actions executed via MCP (which tool, when), to be able to review what an external agent did.

## 7. Liquid materials: liquid emitter and drain

### Existing state (according to the owner, it already exists)
- In Materials **we already have liquids**, and they have a **toggle to activate their realistic physics depending on several parameters**.
- Alternative by right click: **right click on a solid and activate Physics > Liquid** (if the material is created as a liquid) **or Cloth** (if it is cloth).
- That is: liquid / cloth physics can already be activated from the material panel or from the solid's Physics context menu.

### New materials: liquid emitter and drain
- Add a material that is a liquid **"emitter"** (releases / generates liquid in the scene).
- Add another material that is a liquid **"drain"** (removes / collects the liquid that touches it / enters its volume).
- **Both configurable** (own parameters for each; exact list to be defined when implementing: e.g. type of liquid, flow rate, direction / radius of action, active or not, etc.).
- **Purpose:** this way **the water could be prevented from overflowing in some context if it is not wanted** — the drain balances the emitter: the generated liquid does not accumulate indefinitely, but disappears on reaching the drain.

### Assignment to a solid
- **This material can be assigned to a solid with other properties of its own** (the solid can have its own material / physics / appearance properties and also behave as an emitter or drain).
- **Although when assigning it to a solid, ask whether to delete the other properties and make it invisible** (confirmation dialog on assignment):
  - **Yes:** the solid's other properties are deleted and it is made **invisible** — it stays as a pure emitter / drain volume, functional but not rendered (not seen in the scene or in the render).
  - **No:** the solid keeps its other properties and also acts as an emitter / drain (visible and with its previous appearance / physics + the emitter / drain function).
- The invisible behaviour is that of the solid it is assigned to, not a separate object.

### Design notes (to be confirmed when implemented)
- The emitted liquid must enter the shared physics system of section 5 (realistic gravity + air + wind).
- The drain must remove liquid in a controlled way (without flicker or visible abrupt deletions when the liquid touches it).
- If there are several emitters / drains, the total balance (emitted − drained) is what prevents overflow; to be defined whether there is a level / net flow indicator in the UI.
- The question about deleting properties + invisibility must appear on every assignment of an emitter / drain to a solid that already has properties, not only the first time.

## 8. Video: render + AI post-processing with consistency between frames

### Video render: fps and resolution independent
- **In video, when rendering, I want to choose fps separately from resolution:** fps and resolution are two independent controls (changing one does not drag the other).
- **With a 16K upper limit:** the maximum video render resolution is **16K** (upper ceiling; nothing above 16K can be requested).
- (To be confirmed when implementing: whether the 16K limit is on the longer side, and which fps values are offered — presets + free value.)

### Aspect ratio: Open Gate
- **In Aspect Ratio I want to add Open Gate:** one more option in the Aspect Ratio selector, alongside the fixed ratios (16:9, 9:16, 1:1, etc.).
- **Open Gate = use the full frame, uncropped:** it is not cropped to any ratio; the whole gate / complete framing of the virtual camera is rendered, with all the information of the frame.
- Purpose: to be able to **reframe afterwards** to any ratio in post (vertical, square, panoramic…) without having lost image to a crop in the render, just like a real camera's Open Gate (full sensor).
- Open Gate coexists with the above: independent fps, 16K upper limit (the Open Gate frame also respects the 16K ceiling), and the AI + plugins work on the full frame.

### AI post-processing in video: temporal consistency
- **The video post-processing AI will be given the previous AI-enhanced frames and the next one unmodified.**
  - AI input for frame N: the previous frames already enhanced by the AI (N−1, N−2, …) + the next frame unmodified (raw N+1).
  - That is: temporal context backwards (enhanced versions) + one raw lookahead frame forwards.
- **The idea is to create consistency between frames** in terms of:
  - Lights.
  - Textures.
  - Colours.
  - Reflections.
  - (… = any visual attribute that tends to flicker / change between frames if each frame is processed in isolation.)
- **So that each frame respects the previous frame or frames with great precision:** frame N is not enhanced in isolation; it must stay faithful, with great precision, to what the AI already decided in the previous frame(s) (no drift of light / colour / texture / reflection from one frame to the next).
- (To be defined when implementing: exactly how many previous frames are given — minimum 1, ideally a configurable N — and how the first frame, which has no previous ones, is treated.)

### Pipeline order: AI always before plugins
- **AI processing will always come before plugins.**
- Fixed order: raw render → AI post-processing (with temporal consistency) → plugins (filters / post-processing).
- No plugin is applied before the AI; the AI works on the raw render, and the plugins work on the AI's result.

### Saving: all versions or only the final one
- **I want to be able to choose whether all versions are saved or only the final one with all the filters and post-processing.**
  - **All versions:** the intermediate stages are saved (e.g. raw render, after AI, after plugins) in addition to the final one.
  - **Only the final one:** only the final version with all the filters and post-processing applied is saved; the intermediate ones are discarded.
- The option belongs to the owner per render / project, not a fixed behaviour.

### Design notes (to be confirmed when implemented)
- Temporal consistency is the main goal of the video AI, above the isolated enhancement of a frame: better a slightly less "perfect" but consistent frame than a perfect frame that flickers relative to the previous one.
- If the AI receives previous enhanced frames + the next raw one, the latency window has to be defined (it is necessary to wait until N+1 is available raw before emitting N enhanced).
- Saving "all versions" must label each version (raw / AI / final) so they are not confused on disk.

## Work order
1. Finish everything in progress (v0.1–v0.3 and the rest of the open work).
2. Afterwards: Room Builder + presets.
3. Wood / knots: can go with the Room Builder (it is room material) or as a correction to the wood shader when picked up again — decide on picking it up.
4. Walkthroughs: after the Room Builder (they need rooms to walk in).
5. Canvas panels (hide / collapse / move / configure with right click, restore from Settings → Interface): can go with the walkthroughs or before, it is canvas UI — decide on picking it up.
6. Physics + ambient effects + wind + fuzz: shared physics system (realistic gravity + air + wind), limit of 2 simultaneous effects by default, preview of simulated effects in fast by default — decide on picking it up whether it goes with the Room Builder / Ambient.
7. Built-in MCP server (Settings > MCP): operates the whole application, each permission with its toggle in Settings > MCP — decide on picking it up the exact list of permissions, their defaults, transport and authentication.
8. Liquid emitter / drain materials (configurable, to avoid overflows; when assigning to a solid, ask whether to delete other properties and make it invisible).
9. Video: fps independent of resolution with a 16K limit; Aspect Ratio with Open Gate (full frame without cropping, to reframe in post); post-processing AI with previous enhanced frames + next raw one for consistency (lights, textures, colours, reflections), AI always before plugins, option to save all versions or only the final one.

---
*Saved 2026-10-14 from the owner's messages. Updated the same day with: aerial plan view on grabbing the figure + drop shadow, leaving the walkthrough with the option of saving the position into the camera, vertical height slider at the canvas edge, customisable canvas panels, physics + ambient effects (realistic gravity + air, particle generation time, physics toggle on the fuzz, max. 2 effects by default, wind simulator, preview in fast), built-in MCP server with permissions by toggle in Settings > MCP, configurable liquid emitter / drain materials, video (fps + 16K, AI with consistency between frames, AI before plugins, save all versions or only the final one), and Aspect Ratio with Open Gate. Nothing has been implemented: it is a deferred specification.*


---

# Serious bug report — AI Render and earlier errors

**Scope of this document:** it contains **only** the previous message ("very serious error", 2026-10-14), this message (AI Render phase, 2026-10-14) and the later ones. It does not contain the Room Builder / walkthroughs / etc. specification (that lives in `room-builder-y-paseos-especificacion-futura.md`).

**Status:** open report, neither verified nor fixed in this chat. Nothing implemented yet from this document.

---

## 1. Previous message — "very serious error" (2026-10-14)

The owner's text, recorded as it was:

> very serious error. The material editors have no way to change the mapping type (UV, box, triplanar, spherical...), change sizes, move the textures in different directions... It has to look at how KeyShot does it. On another note, in ambient, I want a shape that is a drop, and that they vary in geometries. Right now you cannot choose lenses as we said, there is some effect but they are not noticeable either. They do not imitate as such the lenses you studied, how they distort, or the bokeh they create naturally. I would like that on hovering over the lens it showed a window with the elements. Besides, a lens editor where apart from the current options, I can edit the elements, change size or distances between each element, add a new one, rotate it 180º... The woods are not looking as you showed in the spheres, and no material is functional with respect to the nodes. Besides, when changing the focal length the zoom changes with respect to the focused object, and I want this to be a toggle. Either the camera gets closer or the focused object/point. Focusing on the exact point where you click still does not work, in my exact view at the exact point of the exact pixel where I am clicking. Now there is a double vertical scroll bar in aintfilm's LUT carousel.

### 1.1. Material editors: mapping, size and offset
- The current material editors **have no way** to change the mapping type, change sizes or move the textures in different directions.
- Requirement: be able to change the **mapping type**: UV, box, triplanar, spherical…
- Requirement: be able to **change sizes**.
- Requirement: be able to **move the textures in different directions**.
- **It has to look at how KeyShot does it** (behaviour / UI reference).
- Clean-room limit in force: only observation of behaviour by using KeyShot normally. No decompiled or disassembled code, binaries or extracted resources of KeyShot enter the repo.

### 1.2. Ambient: drop shape + variation of geometries
- In Ambient, I want a **shape that is a drop**.
- And that they **vary in geometry** (not a single fixed geometry).

### 1.3. Lenses: selection, distortion and bokeh
- **Right now you cannot choose lenses as we said**; there is some effect but **it is not noticeable either**.
- Requirement: be able to **choose lenses**.
- **They must imitate as such the lenses that were studied:**
  - How they **distort**.
  - The **bokeh they create naturally**.
- If the effect is not noticeable, it is no good: the difference between lenses has to be visible in distortion and bokeh.

### 1.4. Hover over the lens: window with the elements
- **On hovering over the lens**, it has to show **a window with the elements**.

### 1.5. Lens editor
- **A lens editor** where, apart from the current options, it is possible to:
  - **Edit the elements**.
  - **Change the size** or the **distances between each element**.
  - **Add a new one**.
  - **Rotate it 180º**.

### 1.6. Woods vs spheres + materials with respect to the nodes
- **The woods are not looking as you showed in the spheres.**
  - Requirement: the wood in the scene has to look like in the preview spheres.
- **No material is functional with respect to the nodes.**
  - Requirement: all materials have to be functional with respect to the nodes (the node graph has to really drive the material).

### 1.7. Camera: focal length (toggle)
- **When changing the focal length the zoom changes with respect to the focused object**, and I want this to be **a toggle**.
- **Either the camera gets closer or the focused object / point** (the owner's literal text; to be specified when implementing which moves what and how the framing is kept in each mode).

### 1.8. Focus on the exact point of the click
- **Focusing on the exact point where you click still does not work, in my exact view, at the exact point of the exact pixel where I am clicking.**
- Requirement: focus by click has to use the **exact pixel** where the click is made, **in the exact current view** (ray from that exact pixel, not from the centre or from an approximate point).

### 1.9. Aside (not Repackshot): aintfilm, double bar in the LUT carousel
- **Now there is a double vertical scroll bar in aintfilm's LUT carousel.**
- A bug in **aintfilm**, not in Repackshot. Noted here so it is not lost; it has to be verified / fixed in aintfilm separately. Not yet verified in this chat.

---

## 2. This message — AI Render phase (2026-10-14)

The owner's text, recorded as it was:

> the AI Render phase does hardly anything, and besides it now gets stuck in a loop of attempts.

### 2.1. AI Render hardly does anything
- The **AI Render phase hardly does anything**: its effect is minimal / almost imperceptible (the message does not detail whether nothing visible changes, or the change is so subtle that it goes unnoticed).
- To be specified on reproducing: what was the phase expected to do, what does it actually do, and with what input/output was it compared?

### 2.2. Loop of attempts
- **Besides, it now gets stuck in a loop of attempts** (a loop of attempts / retries).
- The phase does not finish: it keeps repeating attempts without leaving the loop.
- To be specified on reproducing: how many attempts, with what message/error between attempts, whether there is a cap or it is infinite, and whether the process has to be killed / the app closed to get out.

---

## 3. From later — Queue: real-time preview of the selected render (2026-10-14)

The owner's text, recorded as it was:

> besides, when I go to queue I want to be able to see a real-time preview of a selected render.

### 3.1. Queue: real-time preview
- **On going to Queue**, it must be possible to see a **real-time preview of a selected render**.
- That is: in the Queue view (render queue), when selecting a render (a job in the queue), its preview is shown **in real time** (live render progress, not a static thumbnail nor the result only at the end).
- To be specified when implementing: whether the preview is of the render in progress (the one being rendered now) or of any selected render in the queue (waiting / in progress / finished), and at what resolution / quality that live preview goes.

## 4. From later — File extension + denoise (2026-10-14)

The owner's text, recorded as it was:

> files are being saved as .repack.json and not plain .repack. Besides, the denoise makes it lose some personality and washes out some lights and colours now.

### 4.1. File extension: .repack.json instead of .repack
- Files **are being saved as `.repack.json` and not plain `.repack`**.
- Requirement: the save extension has to be **`.repack`** (plain, without `.json`).
- To be specified on fixing it: whether the internal content stays JSON (only the extension changes) or whether the `.repack` format is something else, and whether the already saved `.repack.json` files have to keep opening (backward compatibility).

### 4.2. Denoise: loses personality and washes out lights and colours
- **The denoise makes it lose some personality and washes out some lights and colours now.**
- That is: the current denoise (regression: "now") flattens the result — it removes character / personality from the image and washes out (desaturates / over-softens) some lights and colours.
- Requirement: the denoise has to clean the noise **without** washing out lights and colours or removing personality (preserve the image's character: local contrast, colour, highlight detail).
- To be specified on reproducing: with which scenes / denoise values it is most noticeable, and whether there is a setting (strength) that attenuates it or whether it happens at any setting.

## 5. From later — Materials: dynamic size adjustment to the solid (2026-10-14)

The owner's text, recorded as it was:

> Materials are not dynamically adjusting in size (UV etc) to the size of the solid they are applied to.

### 5.1. Materials do not dynamically adjust to the size of the solid
- Materials **are not dynamically adjusting in size (UV etc.) to the size of the solid they are applied to**.
- Requirement: when applying a material to a solid, its scale / size (UV, etc.) has to adjust dynamically to the size of that solid (the texture cannot keep the same absolute scale on a small solid as on a large one).
- To be specified on reproducing: whether the adjustment must be automatic always, or with a "dynamic adjustment" toggle, and how it coexists with the manual size / mapping control of section 1.1 (if the owner sets a manual size, does the dynamic one respect it or overwrite it?).

## 6. From later — Studio presets: from Lights to Studios + added lights (2026-10-15)

The owner's text, recorded as it was:

> The new studio presets are inside lights and with a size larger than the light presets. I want them to be inside the "studios", And that you choose a studio with swatches of the size shown now. The proposed lights are additions to the studio, which do not interfere with the lights of this one, since the ones considered can be switched off at will easily.

### 6.1. Studio presets out of Lights, into Studios
- Current state (reported): the **new studio presets are inside Lights** and with a **larger size than the light presets**.
- Requirement: the studio presets have to be **inside the "studios"** (Studios section), not inside Lights.

### 6.2. Choose a studio with swatches of the current size
- Requirement: a studio is chosen **with swatches of the size shown now** — that is, the current large swatch size of the studio presets (the one they have now inside Lights) is kept when moving them to Studios, they are not reduced to the small size of the light presets.

### 6.3. Proposed lights: additions to the studio, without interfering, switchable off
- The **proposed lights are additions to the studio**, which **do not interfere with the lights of this one** (the studio's own lights).
- That is: the lights that a studio preset proposes are added to the lights the studio already has, without replacing them or interfering with them.
- And **the ones considered can be switched off at will easily**: each light (proposed or own) can be switched off individually and easily.

## 7. From later (following messages)

*(The following messages of this thread will be added here, as new numbered sections, without mixing them with the Room Builder / walkthroughs specification.)*

---
*Created 2026-10-14 at the owner's request: a new document with only the previous message ("very serious error") and this one (AI Render), plus the later ones.*
