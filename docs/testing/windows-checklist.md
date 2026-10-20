# Windows test checklist

A manual test plan for Repackshot on a real Windows machine (Windows 10 or 11, x64), for anyone who wants to try a release and report what they find. It is grouped by version, newest first, and the points are numbered globally (1 to 219) so a report can cite them. The checklist of each version covers what is new in it; earlier checklists still apply in full.

Tick the points as you go. When reporting an issue, state the version and the number of the point that failed, and attach what the point says to record: the exact message, the `<data>\logs\` folder, screenshots, timings or the files involved. The logs are in `<data>\logs\` (in the portable build, `data\logs\` next to the program; installed, `%LOCALAPPDATA%\Repackshot\logs\`), and *Settings ▸ Desktop ▸ Logs* opens the folder.

## Unreleased

Nothing yet: the next points start at 220.

## v0.1.26

**The checklists of v0.1.2 to v0.1.25 still apply in full** (points 1 to 214). In addition:

For the update window at startup (needs a published version newer than the one being tested: test with v0.1.25 once this one is out, with *Settings ▸ Updates ▸ Check at startup* on, its default).

215. [ ] **The window asks at startup.** Start the program: as the application opens, a window must ask about the new version, naming it and when it was published, with *Install and restart*, *Release notes* and *Later*. Before this version only a line of the status bar said so.
216. [ ] **Later leaves the status-bar line.** Answer *Later* (or press `Esc`, or click outside the window): the window closes and the offer stays as the status-bar line, whose own *Later* dismisses it for good. The window does not ask twice about the same version in the same session.
217. [ ] **Release notes from the window.** When the window asks again (a later start, a newer version), click *Release notes*: the release's page must open in the browser and the window closes; the status-bar line stays.
218. [ ] **A manual check opens no window.** In *Settings ▸ Updates*, click *Check for updates*: with a newer version available, only the status-bar line appears — the window belongs to the automatic check at startup.
219. [ ] **What to record when reporting.** A screenshot of the window in 215 and whether 216 to 218 behaved as written. If the window never appeared, the version you started from, that *Check at startup* was on, and the `<data>\logs\` folder.

## v0.1.25

**The checklists of v0.1.2 to v0.1.24 still apply in full** (points 1 to 209). In addition:

For the connection test's result.

210. [ ] **The result stays.** In *Settings ▸ AI ▸ Model by API*, with a key stored for the endpoint's host, click *Test connection*: when the test finishes, its result line must still be there (before this version it was wiped as the test ended, and the test seemed to say nothing). Then change something in the endpoint (for example the URL): the old result must go away, because it no longer describes what is configured.
211. [ ] **A failing test stays readable too.** Paste a wrong key and click *Test connection*: the failure must be reported in words and stay on screen long enough to read and copy it.

For opening a project at startup.

212. [ ] **A project file opens the program with the project.** Save a project as `test.repack`. Associate `.repack` with Repackshot (right-click the file, *Open with*, choose `repackshot.exe`), then double-click `test.repack`: the program must start with that project open — its name in the header, its parts in the panel — and must not close silently (that silent close was the bug this version fixes).
213. [ ] **Open project in the empty state.** Start the program with no project: the empty viewport must offer *Open project* next to *Import model*. Click it, choose `test.repack` in the dialog: the project must open, with its name in the header.
214. [ ] **What to record when reporting.** A screenshot of the result line in 210 after the test has finished, and of the header and parts panel in 212. If 212 fails, whether the program opened at all, and the `<data>\logs\` folder.

## v0.1.24

**The checklists of v0.1.2 to v0.1.23 still apply in full** (points 1 to 194). In addition:

For the API presets and the connection test.

195. [ ] **Google Gemini preset.** In *Settings ▸ AI ▸ Model by API*, choose *Google · Gemini image*: the endpoint must read `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent`, the key header must read `x-goog-api-key` with nothing before it, and the note must say the preset is written from the service's public documentation and not tried against the live service. Paste a key for that host and save it: the row must say `Stored for generativelanguage.googleapis.com: ••••<last 4>`.
196. [ ] **xAI Grok Imagine preset.** Choose *xAI · Grok Imagine*: the endpoint must read `POST https://api.x.ai/v1/images/edits`, `Authorization: Bearer`, the model `grok-imagine-image-2.0`, and the answer path `data.0.b64_json`.
197. [ ] **Test connection, working.** With a valid key stored for the endpoint's host, click *Test connection*: it must report that the service answered with an image. This makes one real call — a 512 × 512 grey tile with the prompt *Return this image unchanged.* — which the service may charge.
198. [ ] **Test connection, failing.** Remove the stored key (or paste a wrong one) and click *Test connection*: it must report the failure in words — the service's own error, e.g. its auth error — and must not hang or crash.
199. [ ] **The AI switch turns on.** With a valid endpoint and key configured, turn AI processing on in the render window: the switch must stay on, and it must not jump to Settings. With no endpoint configured at all, turning it on must open Settings (that is the intended behaviour for a missing endpoint).
200. [ ] **What to record when reporting.** Screenshots of 195 and 196, the exact result lines of 197 and 198, and the state of the switch in 199. If something fails, the message verbatim and the `<data>\logs\` folder.

For the partial image on stop.

201. [ ] **Pause saves the image so far.** Start a render with a long budget (e.g. 256 samples), let a few passes run and Pause the queue: a file `<name>-partial` must appear next to the job's output, and the results history must gain an entry named `<name>-partial`, marked *Partial*, with the samples it reached. The job goes back to *Waiting*.
202. [ ] **Resume restarts, the partial stays.** Resume the paused job: it must start over from 0 samples, and the `-partial` file and its history entry must still be there when it finishes.
203. [ ] **Stop saves the image so far.** Start a render and *Stop* the job being rendered: the job ends *Cancelled* and the `-partial` file and its history entry must be there.
204. [ ] **A partial stopped mid-pass is not too bright.** Start a render and Pause it just after a pass has begun (before it finishes): the `-partial` image must show the scene at the samples reported, with no tile or region visibly brighter than the rest.
205. [ ] **A video's stopped frame.** Start an animation/video job and Pause it mid-way: the stopped frame must be saved as a `<name>-partial.png` image — not fed to the encoder — and the job goes back to *Waiting*.
206. [ ] **What to record when reporting.** The `-partial` files of 201 and 203, screenshots of the history entries with their samples, and the stopped frame of 205. If something fails, the message verbatim and the `<data>\logs\` folder.

For the render shortcuts.

207. [ ] **Ctrl/⌘ ⏎ while typing does not render.** With the render window open, click into a text field (e.g. the AI prompt), type something and press Ctrl/⌘ ⏎: no job must start and the queue must stay as it was.
208. [ ] **Ctrl/⌘ ⏎ outside a field still renders.** With the focus outside any field (e.g. after clicking the window's background), press Ctrl/⌘ ⏎: the render must run — or the render window must open if it was closed.
209. [ ] **What to record when reporting.** The queue state before and after 207, and the render that 208 started. If something fails, the message verbatim and the `<data>\logs\` folder.

## v0.1.23

**The checklists of v0.1.2 to v0.1.22 still apply in full** (points 1 to 161). In addition:

For moving parts, the studio floor, the set's fine samples and the dust's grains (S3e).

162. [ ] **A falling part gets wet.** Raise the example bottle (or any part) a little above the floor, set its role to *Dynamic*, add *Rain* with *On the parts* and click *Start*. Pause just after it lands: in *Fast* it must have drops on the faces that met the rain while it fell, and they must move with it in the clip.
163. [ ] **The studio floor.** With *Studio ▸ Floor* and *Shadow* on, no set floor over it (on the example, switch off *Backdrop* and *Set floor* under *Scene ▸ In the set*) and *Rain* with *On the parts*, run for a few seconds and pause: in *Fast* and in a render in *Full* the floor around the product must look darker and glossy where wet, and a dry patch must stay under the product (and under anything that shelters the floor).
164. [ ] **Dust on the set and its grains.** Put the product on a set with a large floor card (for example *Fragrance*), add *Dust cloud* with *On the parts* and run for a minute: in a render in *Full*, the edge of the dust shadow on the card must be smooth, not in steps, and close up the dust must show small grains over its layer.
165. [ ] **What to record when reporting.** A screenshot of 162 in *Fast*, and the renders of 163 and 164. If something fails, the message verbatim and the `<data>\logs\` folder.

For cloth (S9).

166. [ ] **Drape over the part.** Open the example (or put a box on the floor), right click the product in the tree and choose *Drape over the part*. A sheet named *Cloth* must appear above it, the physics bar must open and say *Cloth: … vertices* while it runs, and the sheet must fall, fold over the product and stop by itself. Note how long it took to settle (the bar's simulated time and the wall clock). *Undo* once must remove the sheet and its recording together.
167. [ ] **Fabrics.** Select the sheet and, in *Physics*, change *Fabric* to *Silk*, then *Denim* and then *Thick leather*, pressing *Start* after each (and *Reset* in between): silk must fold into many small wrinkles, denim must hang in soft rounded folds (not in flat panels with sharp creases, like paper), thick leather into a few broad folds. Change *Weight*, *Stiffness* and *Thickness* and check that each is one undo step.
168. [ ] **Sharp edges stay under the cloth.** With *Silk* over the example, render in *Full* close up on the cap: its rim must not show through the cloth anywhere; do the same with a box under the sheet, looking at its edges and corners.
169. [ ] **In *Fast* and in *Full*.** After a drape, the cloth must look the same in *Fast* and in a render in *Full* (the same folds), and scrubbing the timeline back must show the sheet falling.
170. [ ] **Anchors and wind.** On a vertical plane with the role *Cloth* and *Anchors ▸ Top edge*, add an *Ambient* effect with wind and *Start*: the top edge must stay put and the cloth must flutter downwind.
171. [ ] **What to record when reporting.** The renders of 167 (the three fabrics), 168 and 169, the times of 166, and if something fails, the message verbatim and the `<data>\logs\` folder.

For the physics of each part in one place (U16).

190. [ ] **One place.** Select the example bottle's *Body*: under the material's name a line must say *Physics: Static · gets wet as …*; a click on it must open the *Physics* section and bring it into view. The section must show *Motion* (the role, a line under it that says what the role does) and *Weather* (*Gets wet*, *Gets dust and snow*, *Surface* and a line *Drops start to run at about … mm across on a vertical face*). Switch the role to *Dynamic*: *Density*, the mass note and *Drop* must appear; back to *Static*, they must go and *Friction* and *Bounciness* stay.
191. [ ] **The way to an effect.** With no ambient effect, *Weather* must say that nothing leaves rain, dust or snow on the parts, with *Open Ambient*. Add *Rain* and select the *Body* again: the button must say *Edit Rain* and take you to the rain in *Scene ▸ Ambient*, with *On the parts* right after *Shape*; its tooltip must end with *Each part chooses in Physics ▸ Weather*.
192. [ ] **A part kept dry.** With *Rain* and *On the parts* on, select the *Cap*, switch *Gets wet* off and open the physics bar: it must say *Start simulates: rain on … parts (1 stays dry)*. Click *Start* and pause after a few seconds: in *Fast* and in a render in *Full*, the cap must have no drops and no wet look, and the collar under it must be as sheltered as before.
193. [ ] **Mixed and one undo.** Select the *Cap* and the *Body* together: *Gets wet* must show its knob in the middle (mixed); a click must switch it on for both, and one *Undo* must bring the mix back. Select the whole bottle and set *Surface* to *Water-repellent*: the line must say about 1.9 mm, and after a *Start* in the rain the drops must run off the bottle sooner than with *From the material*. Save the project, open it again: the choices must still be there.
194. [ ] **What to record when reporting.** A screenshot of the *Physics* section of 190, of the physics bar of 192 and a render of 192 in *Full*. If something fails, the message verbatim and the `<data>\logs\` folder.

## v0.1.22

**The checklists of v0.1.2 to v0.1.21 still apply in full** (points 1 to 151). In addition:

152. [ ] **Drops that grow and run.** Put a part with a steep face (or the example bottle) under *Rain* with *On the parts* and click *Start*. Small drops must stay where they land and grow; once one is large enough it must run down, taking the drops in its way and leaving a clean path, and get longer as it speeds up.
153. [ ] **Shapes in *Fast* and in *Full*.** Pause while a drop runs: in *Fast* and in a render in *Full* it must look stretched along its path, with a rounder head and a thinner tail, and the drops on a tilted face must lean downhill. Just after two drops touch, they must show a narrow neck for a moment.
154. [ ] **Hanging and dripping.** Under the lower edge of a part (or under a face that looks down), a drop must hang, grow and then let go of a single drop, leaving a smaller one behind that grows again.
155. [ ] **What to record when reporting.** A screenshot of 153 in *Fast* and the render in *Full*. If something fails, the message verbatim and the `<data>\logs\` folder.

For the AI model through an API (X7). They need an account with an image-to-image service and a key you can revoke; any of them costs that service's price per call.

156. [ ] **Local stays local.** With *Settings ▸ AI post-processing ▸ Model by API ▸ Run the model* at *On this computer*, a render with AI must behave as before (the local model, nothing sent anywhere).
157. [ ] **The key stays here.** Choose *Through an API* and a preset (or the generic endpoint), paste the key and *Save key*: the row must show only `••••` and its last four characters. Open `<data>\ai\api-keys.json`: the key is there, and it must not be in `<data>\settings.json`, in a saved `.repack` or in `<data>\logs\`.
158. [ ] **Asked first.** In the render window, turn *AI post-processing* on: the question *Send renders to <host>?* must appear under the switch before anything is sent. *Not now* must leave it off.
159. [ ] **Through the guard.** *Allow and send*, then a 1024 × 1024 render: the result must open with *Render \| AI* and the guard's line, and the history must keep both images. Note the time and the number of calls (the service's dashboard).
160. [ ] **Failures.** Remove the key on the service's side (or paste a wrong one) and render again: the message must say the service refused the key, after one try, and the engine image must be kept. Unplug the network: it must say the service could not be reached, after the tries of *Tries of a call*.
161. [ ] **What to record when reporting.** The service and preset used, the two images of 159 and the report line, the messages of 160 verbatim, and the `<data>\logs\` folder (it must not contain the key).

## v0.1.21

**The checklists of v0.1.2 to v0.1.20 still apply in full** (points 1 to 145). In addition:

146. [ ] **Update.** From 0.1.20, *Settings ▸ Updates ▸ Install and restart*: it must open 0.1.21.
147. [ ] **Visible shape.** In *Ambient*, with an effect: the *Shape* must be among the usual controls, without opening *Advanced*.
148. [ ] **Rain on the parts.** Set *Rain* with *On the parts* and click *Start* on the physics bar. After a few seconds, settled drops must be visible, some sliding, and what is wet darker. *Undo* must remove the recording in one go.
149. [ ] **Snow or dust.** Try the same with *Snow*: it must pile up on top and not on the steeply inclined faces.
150. [ ] **Glass from the scene.** With *Rain* and wind towards the camera, in *Camera ▸ Lens ▸ Filters ▸ Front glass* choose *Drops and dust ▸ From the scene* and click *Start*. Use a 35 mm at f/11. In *Fast* and in a render in *Full* drops must be visible on the glass.
151. [ ] **What to record when reporting.** A render of 148 and another of 150. If something fails, the message verbatim and the `<data>\logs\` folder.

## v0.1.20

**The checklists of v0.1.2 to v0.1.19 still apply in full** (points 1 to 138). In addition:

139. [ ] **Update.** From 0.1.19, *Settings ▸ Updates ▸ Install and restart*: it must open 0.1.20.
140. [ ] **Wood in *Fast*.** Put a knotty pine from the catalogue on a part: in *Fast* the rings and knots must be visible, and in *Full* the knots must be in the same place.
141. [ ] **Fabric in *Fast*.** Put a canvas or a knit on a part: in *Fast* the weave must be visible. A cotton must look smooth, as before.
142. [ ] **Drops.** In *Ambient*, choose *Water drops* and make a render in *Full*: drops with their tip must be visible, transparent.
143. [ ] **Mix.** In *Ambient ▸ Advanced ▸ Shape*, choose *Mix* and move the weights: in *Fast* points, flakes, streaks and drops must be visible together.
144. [ ] **Front glass.** In *Camera ▸ Lens ▸ Filters*, switch on the glass with drops and dust. With a 35 mm at f/11, the render in *Full* must show drops. Switch it off: the image must be as before.
145. [ ] **What to record when reporting.** A screenshot of point 140, the render from 142 and the one from 144. If something fails, the message verbatim and the `<data>\logs\` folder.

## v0.1.19

**The checklists of v0.1.2 to v0.1.18 still apply in full** (points 1 to 131). In addition:

132. [ ] **Update.** From 0.1.18, *Settings ▸ Updates ▸ Install and restart*: it must open 0.1.19.
133. [ ] **Focal length.** Switch on *Keep the size of what is in focus* and change the focal length from 50 to 85 mm with the arrows: the product in focus must keep the same size and the perspective must change. Switch it off and repeat: it must grow. *Undo* must go back step by step.
134. [ ] **Lens editor.** With a traced lens, *Edit elements…*: add an element, turn another one and click *Apply to the camera*. Make a render in *Full*. The catalogue lens, chosen again in the list, must be as always.
135. [ ] **A lens that is not valid.** In the editor, set a negative air gap: it must say which element fails and not allow applying.
136. [ ] **Wood with nodes.** Put an oak on a part and switch it to *Nodes*: the render in *Full* must look the same as before, and in *Fast* the rings must be visible.
137. [ ] **A batch that travels.** With two saved studios, create a batch over *All studios* and save the project. Open it in another copy of the portable build, with an empty library: the batch must render in its studios and the queue must offer *Add to my library*.
138. [ ] **What to record when reporting.** The render from point 134, a screenshot of 136 and whether 137 rendered. If something fails, the message verbatim and the `<data>\logs\` folder.

## v0.1.18

**The checklists of v0.1.2 to v0.1.17 still apply in full** (points 1 to 124). In addition:

125. [ ] **Update.** From 0.1.17, *Settings ▸ Updates ▸ Install and restart*: it must open 0.1.18. On start-up, the viewport must be in *Fast* and not rendering.
126. [ ] **Pixel-exact focus.** With the bottle, at 135 mm and f/1.4, *Focus with a click* on the label, near an edge of the frame. Make a render in *Full*: the clicked point must come out sharp. Also try with a traced lens.
127. [ ] **Point and Object.** Set the focus to *Point* and orbit the camera: the point must stay sharp. Set *Object* on the cap and move it: the focus must follow it. Move the slider: the camera must switch to *Distance*.
128. [ ] **Lenses.** Switch to *Traced lens*: the bokeh and *Advanced optics* must not appear, and *More options* must contain tilt. Go back to the simple one: the bokeh must be as you left it.
129. [ ] **Through two points.** In the tilt, *Through two points…* on the cap and the base: in the render, both must come out sharp.
130. [ ] **AI.** In *Settings ▸ AI post-processing*, the intervention must show 50, unless it had been changed before. Make a render with AI and compare it with one from 0.1.17.
131. [ ] **What to record when reporting.** The render from point 126, the one from 129 and the one from 130. If something fails, the message verbatim and the `<data>\logs\` folder.

## v0.1.17

**The checklists of v0.1.2 to v0.1.16 still apply in full** (points 1 to 117). In addition:

118. [ ] **Update.** From 0.1.16, *Settings ▸ Updates ▸ Install and restart*: it must open 0.1.17.
119. [ ] **Nothing cut off.** *Settings ▸ Preferences*: the *Downloads* and *Choose folder…* buttons must read in full. In the render window, with a batch, the summary at the foot must read in full.
120. [ ] **Sets and Lights.** In the *Light* section, switch between *Sets* and *Lights* and try a filter of each group. With lights already placed, choose another setup and try *Hide*: the previous lights must stay switched off in the *Lights* list. Undo must return to how it was. Change the thumbnail size with the header button.
121. [ ] **Arrows.** On a numeric field, for example the *Focal length*, press ▲ once and then hold it down: it must repeat. *Undo* must remove each press in one go.
122. [ ] **Batch with passes.** With two cameras and two saved studios: *Render… ▸ Image*, *All cameras*, *All studios*, the *Alpha* and *Depth* passes, and *ZIP*. A single ZIP must download with four images and their passes.
123. [ ] **Interiors.** With the *Interior* type, tilt the camera: the walls must stay straight. Try *Panorama 360°* and *Plan*, and make a render of each in *Full*.
124. [ ] **What to record when reporting.** Screenshots of points 120 and 123 and the ZIP from 122 (or what it contained). If something fails, the message verbatim and the `<data>\logs\` folder.

## v0.1.16

**The checklists of v0.1.2 to v0.1.15 still apply in full** (points 1 to 111). In addition:

112. [ ] **Update.** From 0.1.15, *Settings ▸ Updates ▸ Install and restart*: it must open 0.1.16.
113. [ ] **Video.** With the bottle and a 4 s turn, *Render… ▸ Animation ▸ Video*. See which formats appear enabled (on Windows, MP4 H.264 should be) and make a short render in MP4 and another in WebM. Both must open in the Windows player or in the browser, with the expected duration and turn.
114. [ ] **Fade and cameras.** A *Fade* animation on the lid, and two cameras on the camera track with *Fade to black* between them. On playback and in the video, the lid must disappear and the cut must go through black.
115. [ ] **Own curve.** On an animation, *Curve ▸ Custom*: drag a handle and play. The motion must follow the curve, and undo must return the previous curve.
116. [ ] **Keyboard.** Open the palette (`Ctrl K`) and press Tab several times: focus must not leave it. Escape closes it.
117. [ ] **What to record when reporting.** The two videos from point 113 (or which formats appeared enabled) and, if something fails, the message verbatim and the `<data>\logs\` folder.

## v0.1.15

**The checklists of v0.1.2 to v0.1.14 still apply in full** (points 1 to 106). In addition:

107. [ ] **Update.** From 0.1.14, *Settings ▸ Updates ▸ Install and restart*: it must open 0.1.15.
108. [ ] **Interior type.** In *Product*, change the type to *Interior*: the light changes to sun and sky and the camera to 28 mm. Go back to *Product*: everything must be as it was. Also try undo.
109. [ ] **Interior recipes.** In the *Light* section of the inspector, *Interior* style: apply *Morning window* and *Night lamps* and make a render of each in *Full*.
110. [ ] **Engine Doctor.** Open the Doctor (the dot on the left of the status bar): the *Engine* and *SIMD* rows must say how many threads it uses and whether it runs with SIMD. Set a budget of 5 s with many samples: it must warn, and *Fix* must raise the time.
111. [ ] **What to record when reporting.** Screenshots of the renders from point 109 and of the Doctor from point 110 and, if something fails, the message verbatim and the `<data>\logs\` folder.

## v0.1.14

**The checklists of v0.1.2 to v0.1.13 still apply in full** (points 1 to 101). In addition:

102. [ ] **Update.** From 0.1.13, *Settings ▸ Updates ▸ Install and restart*: it must open 0.1.14.
103. [ ] **Section.** With the bottle, switch on **Section** in the *Scene* inspector. Then *Cut across ▸ X* and *Click on the part*. In *Fast* and in *Full* the bottle must look cut, with the cap in the material’s colour and the floor whole. Try *Flip side* and undo.
104. [ ] **Animated section.** A **Section** move on the Environment in the timeline: when played, the cut must travel along the part.
105. [ ] **IES light.** *+ Add light ▸ IES…* with a manufacturer’s `.ies` file (type C). The inspector must show its polar plot, and the floor, in *Full*, the patch of light with its shape. Save the project, close it and open it: the light must remain the same.
106. [ ] **What to record when reporting.** Screenshots of points 103 to 105 and, if something fails, the message verbatim and the `<data>\logs\` folder. If an `.ies` does not open, record the file.

## v0.1.13

**The checklists of v0.1.2 to v0.1.12 still apply in full** (points 1 to 98). In addition:

99. [ ] **Update.** From 0.1.12, *Settings ▸ Updates ▸ Install and restart*: it must open 0.1.13.
100. [ ] **Finish by noise.** The glass bottle at 1280 × 720, *Finish by ▸ Noise* at 1 % and a cap of 1024 samples: it must finish before reaching the cap, with a clean background. Record: the time, and compare it with the same render by samples, using the average the meter reported.
101. [ ] **What to record when reporting.** The two images from point 100 with their timings and, if something fails, the message verbatim and the `<data>\logs\` folder.

## v0.1.12

**The checklists of v0.1.2 to v0.1.11 still apply in full** (points 1 to 94). In addition:

95. [ ] **Update.** From 0.1.11, *Settings ▸ Updates ▸ Install and restart*: it must open 0.1.12.
96. [ ] **Nodes in Full.** *Nodes…* in the body’s inspector, *Examples ▸ Marble*, and switch to *Full*: the bottle must show the marble in the same place as in *Fast*. Also try *Checks* and *Glazed ceramic*.
97. [ ] **A graph of your own.** A *Noise* connected to *Base colour* and to *Roughness* with a *Colour ramp*: change the noise scale and check that *Full* follows it.
98. [ ] **What to record when reporting.** Screenshots of points 96 and 97 in *Full* and, if something fails, the message verbatim and the `<data>\logs\` folder.

## v0.1.11

**The checklists of v0.1.2 to v0.1.10 still apply in full** (points 1 to 90). In addition:

91. [ ] **Update.** From 0.1.10, *Settings ▸ Updates ▸ Install and restart*: it must open 0.1.11.
92. [ ] **Dust against the light.** *Scene ▸ Ambient ▸ Add ▸ Dust motes* with a light behind the bottle, in *Full*: the motes must shine inside the beam.
93. [ ] **Rain.** *Ambient ▸ Rain* with a side light: the bottle and the floor must not fill with dots. Record: how long a render with rain takes compared with the same one without it.
94. [ ] **What to record when reporting.** Screenshots of points 92 and 93, the timing from 93 and, if something fails, the message verbatim and the `<data>\logs\` folder.

## v0.1.10

**The checklists of v0.1.2 to v0.1.9 still apply in full** (points 1 to 85). In addition:

86. [ ] **Update.** From 0.1.9, *Settings ▸ Updates ▸ Install and restart*: it must open 0.1.10 (it is the first two-digit version: check that it sees it as newer).
87. [ ] **A glTF with textures in Full.** Import a `.glb` with maps and switch to *Full*: the textures must show in the same place as in *Fast*.
88. [ ] **Mapping.** On a box with a checker texture, change *Projection* to *Box*, then *Cylindrical*, and change the size and the offset: in *Full* the texture must move the same as in *Fast*.
89. [ ] **Label.** *Add label…* with a PNG with alpha on the bottle and a final render: the label must come out in its place, with its edge.
90. [ ] **What to record when reporting.** Screenshots of points 87 to 89 in *Full* and, if something fails, the message verbatim and the `<data>\logs\` folder.

## v0.1.9

**The checklists of v0.1.2 to v0.1.8 still apply in full** (points 1 to 82). In addition:

83. [ ] **Update.** From 0.1.8, *Settings ▸ Updates ▸ Install and restart*: it must open 0.1.9.
84. [ ] **The live view.** Put two 1280 × 720 renders with 256 samples in the queue and click the row of the one being made: its image must open and clean up pass by pass, with the samples going up. Click the row of the one waiting: it must say it has not started yet. Leave the first one’s open until it finishes: it must move to its result by itself.
85. [ ] **What to record when reporting.** A screenshot from point 84 with the view open, the time of the same render with the view open and closed and, if something fails, the message verbatim and the `<data>\logs\` folder.

## v0.1.8

**The checklists of v0.1.2 to v0.1.7 still apply in full** (points 1 to 79). In addition:

80. [ ] **Update.** From 0.1.7, *Settings ▸ Updates ▸ Install and restart*: it must open 0.1.8.
81. [ ] **The lens window.** *Camera ▸ Lens ▸ Traced lens*, open the list and rest the pointer on *Double-Gauss normal* and then on *Fisheye 180°*: each must show its cross-section and its numbers; choose one and check that the section says the same. Rest the pointer on the *Swirl* chip.
82. [ ] **What to record when reporting.** A screenshot from point 81 and, if something fails, the message verbatim and the `<data>\logs\` folder.

## v0.1.7

**The checklists of v0.1.2 to v0.1.6 still apply in full** (points 1 to 64). In addition:

**Update from the app** (first: it is the first real update)

65. [ ] **From 0.1.6 to 0.1.7.** With 0.1.6 installed, open *Settings ▸ Updates*: it must see 0.1.7, and *Install and restart* must download it, check its sum, close and reopen with 0.1.7 (the *Updated* notice in the status bar; *Settings ▸ About* must say 0.1.7). Also try from the portable 0.1.6.

**Wood, fabric and bevel** (in *Full*)

66. [ ] **Wood.** Apply *Oak* and then *Pine* to a box of about 20 cm: the rings and pores must be visible at their real size, and on the pine its knots; in *Fast*, the average colour with the knots darkened.
67. [ ] **Fabric.** Apply *Denim* to the box and bring the camera closer at a 100 mm focal length until the face fills the image: the diagonal twill must be visible, in indigo.
68. [ ] **Bevel.** A box with sharp edges with *Edge bevel* at 0 and at 2 mm: at 2 mm, the edges must catch a sliver of light.

**Light, media and dispersion**

69. [ ] **Milk and wax.** *Milk* and then *Wax* on the bottle: they must look translucent, with light entering through the edge. Record: how long a 256-sample render with milk takes compared with the same one with *Glass*.
70. [ ] **Perfume crystal.** The bottle with *Perfume crystal* and *Caustics ▸ On*: colour fringes must be visible on the edges and in the caustic on the floor; with *Abbe number* at 0, they must not.
71. [ ] **Filters.** *Camera ▸ Filters ▸ Add filter ▸ Star* (6 points, strength 1) with a small light inside the frame: in *Full* the star must appear; with *Black diffusion* the image must soften the lights without veiling the shadows.
72. [ ] **Thumbnails.** *Lights ▸ Sets*: the thumbnails of *Long strip and black edge*, *Black on black* and *Warm-cool cinema* must have no stray dots.

**Traced lens**

73. [ ] **Choosing a lens.** *Camera ▸ Lens ▸ Traced lens*, character *Wide* and then *Swirl*, with the bottle and some small lights behind it: in *Full* the wide angle’s distortion must curve the floor lines and *Swirl* must give spiral bokeh at the edges. The section must show the lens cross-section with its elements and its numbers.
74. [ ] **Click with a fisheye.** With the *Fisheye 180°* in *Fast*, click on a part near the edge: the one under the cursor must be selected.

**Fixes from the bug report**

75. [ ] **Focus with a click.** *Focus with a click* and a click on the cap: *Focus distance* must stay at the cap’s value and *Undo* must say *Undo: Focus with a click*. Type another distance and click in the scene: it must not change.
76. [ ] **`.repack`.** *Save as…*: the file must end in `.repack`. Open it, and also open an earlier `.repack.json`.
77. [ ] **Fabric in nodes.** *Denim* on the box and *Nodes…*: the box’s colour must not change.
78. [ ] **The AI’s attempts.** A render with AI in the queue: the row must say *attempt 1 of 4* and, if it repeats, the reason.
79. [ ] **What to record when reporting.** The screenshots from points 65, 66, 67, 70, 71 and 73, the timing from point 69 and, if something fails, the message verbatim and the `<data>\logs\` folder. **If the AI gets stuck in attempts**, record the file `<data>\logs\repackshot.log` from that run; and **if the denoise washes out lights or colours**, record that scene saved (`.repack`) with a render with and without it.

## v0.1.6

**The checklists of v0.1.2 to v0.1.5 still apply in full** (points 1 to 51). In addition:

**Update from the app** (first: it is how the next version arrives)

52. [ ] **Install and restart.** With 0.1.5 installed, open *Settings ▸ Updates*: it must see 0.1.6, and *Install and restart* must download it, check the sum, close and reopen with 0.1.6 (the *Updated* notice in the status bar). Also try from the portable 0.1.5. With an unsaved project, it must ask *Save · Save as… · Don’t save*.

**Textures, labels and nodes**

53. [ ] **A glTF with textures.** Import a `.glb` with maps: they must show in *Fast* with their UVs; the import sheet must say how many images were saved. Save and open the project: the same images.
54. [ ] **A label.** *Add label…* with a PNG with alpha, click on the bottle and drag: the label must lie flat on the surface with that width. Undo removes it.
55. [ ] **The node editor.** *Nodes…* in the body’s inspector, *Examples ▸ Marble*: each node’s sphere and the bottle in *Fast* must show the marble. Go back to *Simple*: it must ask before losing the graph.

**Camera and output**

56. [ ] **Bokeh.** *Camera ▸ Bokeh ▸ Curved polygon* with the aperture open (f/1.4) and an out-of-focus point of light in *Full*: the bokeh shape must be the one in the thumbnail. Check *Aspect ratio ▸ 16:9*: the viewport frame and the render window must follow it.
57. [ ] **TIFF and RAW.** A render in 16-bit TIFF with a transparent background and another in RAW (DNG): open both in a photo editor (the DNG in one that reads linear DNGs). Record: a screenshot of each.

**Plugins**

58. [ ] **Install the film plugin.** *Settings ▸ Plugins ▸ aintfilm · film simulation ▸ Install*: it must download `film-0.1.0.rpk` from this release, ask for the activation key (obtained separately) and end up installed with its logo and its closed licence. Then, in the render window, after the AI, the recipe carousel with the bottle and lamp thumbnails, the *Type / ISO / Group* filters and the slider; apply a recipe to a render. Record: the resulting image. Try a short animation with *Apply to render jobs*: the grain must change from frame to frame.

**Physics and ambient**

59. [ ] **Drop.** Raise the bottle 10 cm, right click ▸ *Drop*: it must fall, bounce little and stop by itself; the physics bar must say *Stopped · all at rest* and in *Animation* the *Simulation* clip must appear. Undo returns it to the top. *Pause* halfway must freeze the image and *Resume* continue.
60. [ ] **Ambient.** *Scene ▸ Ambient ▸ Add ▸ Dust motes* and then *Rain*: in *Fast* the particles must be visible; in *Full* the rain must come out as streaks. Record: how much longer a render takes with rain than without it.

**Noise, edges and exploded views**

61. [ ] **Live denoising.** In *Full*, click *Denoise* next to *Fast · Full*: the image must clean up at once and keep refreshing; lower *Strength* to 50 % in the render window and look at the difference in a final render.
62. [ ] **Edge smoothing.** *Settings ▸ Render engine ▸ Edge smoothing ▸ Fine + edges ×2*: the meter must say *Filter · Fine + edges ×2*; a final render with *None* against *Fine* on an edge of the cap, cropped at 400 %.
63. [ ] **A radial exploded view.** *Animate ▸ Exploded view* of the whole model, *Radial*, with the cap as an exception and smoothness at 70 %: the timeline must show the bar, the tree of what is animated and the track in the viewport; reversed it must assemble.
64. [ ] **What to record when reporting.** The screenshots from points 52, 55, 58, 59 and 62, the timings from points 60 and 61, and, if something fails, the message verbatim and the `<data>\logs\` folder.

## Plugin installation (v0.1.6 plugin publishing)

These points complement point 58 and are numbered P1 to P6 so they do not collide with the global numbering.

P1. [ ] *Settings ▸ Plugins ▸ aintfilm · film simulation ▸ Install*: it downloads, asks for the key, a mistyped key is reported, the right one installs it; its logo appears and its licence and notices open.
P2. [ ] Close and open the application: it is still installed.
P3. [ ] Before rendering, render window ▸ *Plugins*: the preview is the plugin’s test scene; the recipe carousel fills with images (once: when reopened, all are there); the wheel scrolls it sideways and the arrows choose.
P4. [ ] A render, and in the render window the *Plugins* section: the preview with a recipe (*CN-01*), the plugin line and the time; *Apply* leaves a new result with its provenance and its `_aintfilm-film.png` file.
P5. [ ] *Apply to render jobs* and a short animation: each frame has its `_aintfilm-film.png` and its grain changes from one to the next.
P6. [ ] *Remove*: it is deleted, and the project keeps its settings.

## v0.1.5

**The checklists of v0.1.2, v0.1.3 and v0.1.4 still apply in full** (points 1 to 39 of v0.1.2, v0.1.3 and v0.1.4; above all, 25 to 32, **the first AI image**). In addition:

**Installer and first start**

40. [ ] **The *AI models* step of the installer.** Install with the `-setup.exe`. When a model is ticked, *the runtime* must tick by itself (with a graphics card, the Vulkan one), and it can be unticked. Check whether the new row fits well with the six model rows and take a screenshot of it.
41. [ ] **The first start.** It must begin downloading the runtime and the chosen models (*Settings ▸ AI post-processing* shows the progress). Afterwards the **guided tour** must appear: go through all of it with *Next* or with the arrow keys, and check that each step shows what it says. Close the app and open it: it must not appear again. *Help ▸ Guided tour* launches it again, and *Skip tour* and `Esc` close it.
42. [ ] **The runtime notice.** If you can, remove the runtime from *Settings ▸ AI post-processing ▸ Runtime* with a model downloaded. The AI section of the render window and *Settings* must warn with *Install*, and the status bar must say it once.

**Own prompt, variants and system prompt** (with the same model as in point 27)

43. [ ] **The system prompt.** In *Settings ▸ AI post-processing ▸ System prompt* the default text must be there, in English. Change it, close and open the app (it must still be changed) and click *Restore default*.
44. [ ] **A render with own prompt and 3 variants.** 1024 × 1024 with *AI post-processing* on, *Own prompt*: `late afternoon light, warm mood`, and *Variants*: 3. The queue must say *AI · variant 2 of 3 · tile…*. The result must have 3 AI images in the strip, each with its report. Try *Save all* and record the timings: the engine, the first variant and the other two.

**Own lights and the viewport**

45. [ ] **A spot.** *Lights ▸ Add light ▸ Spot*, *Aim at ▸ A part…* and choose the label. Set the *Cone* to 9° and switch off the setup’s lights. In *Fast* the circle of light must be visible on the label; in *Full* it must clean up in a minute or less.
46. [ ] **Moving it in the viewport.** With the *Lights* tab open, the outlines of the lights (dashed) and that of the chosen spot, continuous, must be visible. Move it with the gizmo and with the handle of its target, and check that *Undo* undoes each gesture in one go. In the *Parts* tab no outline must be visible.
47. [ ] **Look through.** `Ctrl ⇧ L` with the spot chosen: orbiting, panning and zooming must move the spot, which keeps aiming at where you look, and `Esc` must return to your camera. Do the same with a saved camera.
48. [ ] **Save setup as….** Save the setup with the spot and apply it to another type of product: the spot must still be there, aiming at the same thing.

**Caustics and denoising**

49. [ ] **Caustics.** Give the body of the bottle a glass material (or open a glass product of your own) and light it with a spot or a small area. With *Caustics* at *Automatic*, in *Full* light must enter the shadow through the glass, with no stray dots. Compare with *Off* and record the time of a final render with and without them.
50. [ ] **Denoising.** A final render of 16 samples with *Denoise* at *Both* and *Also save without denoise*: two images must be saved. The clean one must not blend the edges of different parts or materials. In the *Full* viewport, *Denoise* must turn it on and off.
51. [ ] **What to record when reporting.** The screenshots from points 40, 45, 49 and 50, the timings from points 44 and 49, and, if something fails, the message verbatim and the `<data>\logs\` folder.

## v0.1.4

**The v0.1.2 and v0.1.3 checklists still apply in full** (the 22 points of v0.1.2 and points 23 and 24 of v0.1.3: own window, closing, dialogs, data that survives a restart, Full for 5 minutes, queue, dragging materials, box selection, glass and HDR, and the graphics cards). In addition:

**The first AI image** (make it on the PC with the best graphics card available)

25. [ ] **Requirements.** Windows 10 or 11 x64, an up-to-date graphics card driver (it brings Vulkan) and the **Microsoft Visual C++ 2015–2022 (x64)** environment. If it is missing, *Settings ▸ AI post-processing ▸ Runtime* says so: click *Install Microsoft Visual C++ runtime…* (it opens Microsoft’s page), install the x64 package and click *Check again*.
26. [ ] **The Vulkan runtime.** In that same row, click *Download* (with a card, the rule picks Vulkan). It must end at *Installed · stable-diffusion.cpp version …, commit d637cfb* and say *runs on* followed by the name of your card. If it says CPU although there is a card, note it.
27. [ ] **The model.** In *Settings ▸ AI post-processing ▸ Models*, download **Z-Image-Turbo · Q4** (≈ 6.5 GB) and click *Use*. On a modest machine or one without a card, **Stable Diffusion 1.5 + ControlNet tile/depth · fp16** (≈ 3.6 GB).
28. [ ] **A final 1024² render with AI.** Open the sample project (or one of your own) and the render window: 1024 × 1024, 16-bit PNG. Switch on *AI post-processing* with the default values and click *Render*. The queue must say *AI · loading the model* and then *AI · tile 1 of 1* (and *· attempt 2* if the guard asked to repeat). When it finishes, the result must have two images.
29. [ ] **Record the timings.** The engine render; the AI the first time (it loads the model); and the AI a second time in a row (already loaded). The viewer’s detail line carries the model, Vulkan, the seed and the time.
30. [ ] **Record the guard’s report.** In the results viewer, the *Checked: …* line and, if it appears, *The AI was limited to N %* or the sentence of the rejection (the numbers appear on hover). Compare with the *Render | AI* divider: has anything changed that should not have, such as shapes, text, a material’s colour or the focus?
31. [ ] **Intervention 0.** Repeat the render with *Intervention* at 0: the `…_AI.png` must be identical, byte for byte, to the engine’s (compare the sums with `Get-FileHash`), and the runtime must not start (the *Settings* row does not say *loaded:*).
32. [ ] **What to record when reporting.** The two images (`…_0001.png` and `…_0001_AI.png`); the result’s entry in `<data>\results\index.json` (it carries the full report, `ai.report`); the `<data>\logs\` folder; a screenshot of the *Runtime* row; the graphics card and its memory (*Settings ▸ AI post-processing ▸ This computer*); the timings from point 29; and, if something fails, the message verbatim.

**Physical sky**

33. [ ] **Physical versus Classic.** In *Environment*, choose *Sky* and keep the camera still. With *Sun elevation* at about 60–70° (noon) switch *Model* between *Physical* and *Classic*: both must look like a believable daytime sky; note what difference you see (colour of the zenith, of the horizon, of the haze). Repeat with the sun at about 3–5° (dawn): the physical one must give a believable sky, although with some pattern near the horizon (it is the known limitation). Also try *Haze* from 1 to 10. Open a 0.1.2 project that used *Sky*: it now opens with the physical one.

**Primitives**

34. [ ] **Base under a product.** With a product in the scene, *Add ▸ Primitive ▸ Box*, and then a *Pedestal*: each base must be born under the product, 40 % wider than its footprint, with the product resting on top. A single *Undo* must remove the base and lower the product.
35. [ ] **Infinity sweep.** *Add ▸ Primitive ▸ Infinity sweep*: it must be born facing the camera and fill the whole frame, with the wall behind the product and the back lights. Switch to *Full*: the backlight must still be visible, without the wall blocking it. Orbit the camera and click *Fit to camera* in the inspector’s *Primitive* section: it must fill the frame again.
36. [ ] **Editing the dimensions.** In the *Primitive* section of a box, change width, depth, height and bevel: the part must regenerate live and stay resting on the floor. Dragging a value must leave a single undo entry. *Convert to mesh* must freeze the dimensions.
37. [ ] **Faces.** With the *Faces* level, a click on the box’s lid must pick the whole lid; assign it another material from the catalogue (only it changes). Save the project, close it and open it: the primitives must come back with the same dimensions.

**Scale**

38. [ ] **The Scale tool.** Select a part and press `S` (or choose *Scale* next to *Move*). Drag a cube to scale along its axis and the central point for all three; with `Shift` it goes in 10 % steps. Each drag must leave a single undo entry. Switch between local and global axes and check that each cube’s axis changes with them.
39. [ ] **Right click ▸ Scale….** On a part in the viewport and on a tree row: the inline panel must offer *Uniform* (%), *Per axis* (X, Y, Z in %) and *Custom* (mm of width, depth and height, with *Keep proportions*). *Apply* scales the selection at the current level, around its pivot; *Reset scale* returns it to 100 %.

## v0.1.3

**The v0.1.2 checklist still applies in full** (its 22 points: own window, closing, dialogs, data that survives a restart, Full for 5 minutes, queue, dragging materials, box selection, glass and HDR, runtime). In addition:

23. [ ] **The graphics cards, on every PC.** In *Settings ▸ AI post-processing ▸ This computer*, the *Graphics card* row must carry the name of the machine’s real card and *Dedicated video memory* its figure (for example “8 GB”); it must not say “No graphics card found”. With *Model in use ▸ Device* set to *GPU*, the *GPU* row lists each card with its memory (for example “NVIDIA GeForce … · 8 GB”), and on a laptop with an integrated and a dedicated card both must appear and be selectable. With a card of 4 GB or more, *Runtime ▸ Run on ▸ Automatic* must say “Vulkan, because a graphics card to use was found”. Try it on every PC available, and with *Detect again* if needed.
24. [ ] **If they are not listed, attach the log.** If the row still shows no cards, or says “The graphics cards could not be read: see the logs”, close Repackshot and record `logs\repackshot.log` from the data folder (in the portable build, `data\logs\repackshot.log` next to the program; installed, `%LOCALAPPDATA%\Repackshot\logs\repackshot.log`; *Settings ▸ Desktop ▸ Logs* opens the folder), together with the graphics card model the PC is known to have. The lines starting with `hardware:` are enough.

## v0.1.2

Mark the points as you go. If something fails, note which point and when it happened, and see the last section.

**Start-up and window**

1. [ ] **Install or start.** Install with `…-setup.exe` (or unzip the archive and run `repackshot.exe`). Repackshot must open with the sample studio, in its own window, with no address bar or tabs. *Settings ▸ Desktop ▸ Window drawn by* must say *Repackshot’s own window (WebView2 …)*; if it says *Microsoft Edge app window*, note the reason it gives.
2. [ ] **Own window.** Check three things: the title bar says *Repackshot — project name* and not the title of a web page; the header shows the logo with a downward arrow instead of the three bars; and with the dark theme (*Settings ▸ General ▸ Theme*) the title bar is dark too.
3. [ ] **Taskbar.** The icon is Repackshot’s (black and white), not Edge’s. Pin the app to the taskbar, close it and reopen it from the pinned icon: no second icon should appear; the window must group with the pinned one.
4. [ ] **Closing with unsaved changes, with the X.** Move a part and click the window’s X. Repackshot’s prompt with *Save · Don’t save · Cancel* must appear inside the window, and never Edge’s prompt (“Do you want to leave the application?”). *Cancel* leaves you where you were.
5. [ ] **Closing with `Alt F4` and from the taskbar.** Repeat step 4 with `Alt F4`, and with right click on the taskbar icon ▸ *Close window*. The same Repackshot prompt must appear. With no unsaved changes, the window closes without asking.
6. [ ] **No browser behaviour.** Right click in the viewport and in a panel: no browser menu must appear. Select text in a panel: Edge’s mini menu (copy, search, “More”) must not appear. The page must not offer to translate. `Ctrl F`, `Ctrl P`, `Ctrl R`, `Ctrl +`, `Ctrl −` and `Ctrl` + wheel do nothing browser-like (they do not search, print, reload or change the zoom). Neither do `F5` and `F12`.
7. [ ] **Size and position.** Move the window, resize it and close it. When reopened it must appear where you left it.

**Dialogs, data and storage**

8. [ ] **Native dialogs.** Import a model (for example a STEP), save the project (`Ctrl S`) and choose an output folder in the render window (*Choose folder…*). Each dialog must appear **in front of** the Repackshot window, never hidden behind it, and must be the system one. Choosing a folder that contains system files must no longer give the 0.1.0 error. A finished render must appear as a file in the chosen folder, with no downloads bubble.
9. [ ] **Settings, library and results survive a restart.** Change a setting (language or theme), save a material of your own in the library and make a small render. Close Repackshot completely and reopen it: the setting, the material and the render (in the results history) must still be there.
10. [ ] **Settings ▸ AI post-processing ▸ This computer.** The *Graphics card* row must list the real cards of the machine (name and video memory), not “not detected” or “the browser does not say”.
11. [ ] **Settings ▸ Storage.** *Data folder* must show the actual folder (`data\` next to the program in the portable build; `%LOCALAPPDATA%\Repackshot` if installed) and *Space used* a figure. The open-folder button opens it in Explorer.
12. [ ] **No overlapping texts.** Open *Settings* and go through all the sections with the Windows display scale at 100 %, 125 % and 150 % (*Windows Settings ▸ System ▸ Display ▸ Scale*, reopening Repackshot at each one). There must be no texts on top of each other and no paths spilling out of their row. Also try *Interface size* in *Settings ▸ Accessibility*.

**Viewport and render**

13. [ ] **Full for 5 minutes.** Set the viewport to *Full* and, for 5 minutes, orbit, zoom and move parts without stopping. The viewport must not freeze, the image must never be the old one with the new outline on top, and the meter must not stay at “0 samples”. If the meter says it is restarting the viewport, note the reason.
14. [ ] **From Fast to Full.** Switch several times between *Fast* and *Full* with a click in the header, even quickly. *Full* must start again and accumulate samples, and never leave “0 samples”.
15. [ ] **Render with the viewport alive.** Launch a *Render* of about 30 seconds and orbit the viewport while it runs. It must keep responding, and the meter must say *Full · sharing with Render* with the number of threads. Change *Settings ▸ Render engine ▸ While a render runs* to *Pause the viewport* and check that the viewport then stays paused.
16. [ ] **Pause and resume the queue.** Put two or three renders in the queue. *Pause* while the first one runs: the work stops and the button becomes *Resume*. Click *Resume*: the queue continues. With an empty queue, the *Start queue* button must be disabled.

**Materials and selection**

17. [ ] **Dragging a material.** Drag a catalogue thumbnail onto a part in the viewport: a ghost with the thumbnail appears, the part is outlined as you pass over it and on drop it is assigned (a single *Undo* removes it). Drag it onto a tree row: the row is highlighted with a dashed border and on drop it is assigned to it and to what hangs below it. Drop with `Alt` held: the ghost says *Copy* and the assigned material is a copy of its own. `Esc` in the middle of a drag cancels.
18. [ ] **Box selection.** With *Select*, hold `Ctrl` and drag from left to right: the box has a continuous outline and picks only what is entirely inside (window). From right to left it is dashed and also picks what it touches (crossing). `Shift` adds and `Alt` removes. Repeat it with the *Model*, *Group*, *Part* and *Faces* levels. Without `Ctrl`, the left button still orbits.
19. [ ] **Faces level in a STEP.** Import a STEP and set the level to *Faces*. One click must pick the **whole CAD face** (for example a complete lid or wall), not a single triangle. `Shift` click adds a single triangle, and *Separate by CAD faces* (part menu) splits the part into one per face.
20. [ ] **Glass, sky, HDR and background.** Assign a catalogue glass to a part and render: it must look transparent and show refraction. In *Environment*, try *Sky*. With *Load HDRI…*, load a `.hdr` and an `.exr` (rotation and intensity change the light), and with *Background image* ▸ *Load image…* load a photo. Close and reopen the saved project: the images must still be in it.

**AI post-processing, runtime only**

21. [ ] **Download the Vulkan runtime.** In *Settings ▸ AI post-processing ▸ Runtime*, leave *Run on* at *Automatic* (or choose *Vulkan*) and click to download. It must show progress, change to *Installed · version* and say *runs on* and the name of your card. If instead it says “It does not start on this computer” with a message about *a missing DLL* and *Visual C++ 2015–2022 (x64)*, that is expected without that environment: note it, install Microsoft’s environment and click again. If it says there is no `curl`, use *Install from a file…*. Remember that **no image is generated yet**: the switch in the render window says *coming soon*.

**If something fails**

22. [ ] **The logs.** The logs are in `<data>\logs\` (in the portable build, `data\logs\` next to the program; installed, `%LOCALAPPDATA%\Repackshot\logs\`), and *Settings ▸ Desktop ▸ Logs* opens the folder. Record: attach that folder when reporting a failure, together with the number of the step that failed and a sentence describing what you saw.
