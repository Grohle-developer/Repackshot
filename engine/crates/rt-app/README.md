# rt-app — the `repackshot` desktop launcher

A Rust binary with **`std` only**, in the same *workspace* and with the same gates as the engine
(`cargo fmt`, `clippy -D warnings`, no external *crate*). **No `unsafe` except in
`src/platform/`** (`#![deny(unsafe_code)]` in the *crate*, `#[allow(unsafe_code)]` only in that
module; each block says why it is correct): the own Windows window calls Win32 and the
COM interface of WebView2 through FFI. It is the desktop application (`docs/ARCHITECTURE.md` §5.5):

1. serves the interface (Vite's `dist/`, distributed as `app/` next to the executable) on
   `127.0.0.1`;
2. opens it in **its own window** on Windows (Win32 with the system title bar and
   WebView2 inside, `src/platform/`), or, if that cannot be done, in an application window of Edge
   (Windows) or of a Chromium-family browser (Linux), with its own profile in the data
   folder;
3. renders with `rt-core` **natively**, on all threads, the same pixels as `rt` and as
   the wasm pool;
4. stores the AI models in the data folder, by content, checked with its own SHA-256,
   and **all of the page's state** (settings, library, results history, thumbnail
   cache, what is left to download): on the desktop the page is only the interface (P3e);
5. detects the machine and applies the recommendation rule of `src/data/ai-models.json`
   (`repackshot --hardware`, which the installer reads);
6. shows the **system dialogs** (folder, open, save) and reads and writes **only** what the
   person chose in them (P3b): the window never uses the browser's file pickers, downloads
   or permissions;
7. downloads, checks, installs and **runs the AI execution engine** (X3b,
   `src/ai/`): stable-diffusion.cpp as a separate process, never linked (below, *AI: the execution
   engine*);
8. **updates itself** (P5, `src/update/`): downloads the new release version,
   checks its SHA-256, installs it and starts the new one once it has stopped (below,
   *Updating from the application*).

What it needs from the system it asks of system programs (`reg`, `powershell`, `wmic`,
`nvidia-smi`, `explorer`, `rundll32`, `xdg-open`, `zenity`, `kdialog`, `curl`, `tar`, `tasklist`,
`taskkill`, `kill`, the browser), on Windows by their absolute path in `System32`; through FFI, only
the own window and DXGI for the graphics cards (`src/platform/`).

## Command line

```text
repackshot [--port N] [--data-dir DIR] [--app-dir DIR] [--threads N] [--window webview2|browser|auto] [--after-update]
repackshot --serve-only [...]           no window: writes the URL with the token and serves until stopped
repackshot --hardware <f.ini> [--device gpu|cpu]   writes the installer's INI and exits
repackshot --shortcut-id <f.lnk>        Windows: writes the AppUserModelID into a shortcut to repackshot.exe and exits
repackshot --version | --help
```

`--after-update` is set by the launcher itself when it starts the new version after an update (P5):
it only records it in the log and `/api/info` reports it (`afterUpdate`), so that the page can say that
it updated. The arguments the old one started with (`--port`, `--data-dir`, `--serve-only`…) are
received by the new one unchanged.

On Windows the *release* build has no console (`windows_subsystem = "windows"`): messages
go to `<data>/logs/repackshot.log` (rotated to `.log.1` past 1 MiB), and the output
of `--version` or `--serve-only` can only be seen redirected to a file.

## Folders

| What | Where |
| --- | --- |
| Interface | `<executable folder>/app/` (`--app-dir` changes it) |
| Data, installed | `%LOCALAPPDATA%\Repackshot` (Windows); `$XDG_DATA_HOME/repackshot` or `~/.local/share/repackshot` (Linux) |
| Data, **portable** | `data/` next to the executable when `portable.txt` exists beside it; everything goes inside (settings, library, results, models, window profiles), so it travels with the folder |
| Inside the data | `settings.json`, `state/`, `library/`, `results/`, `cache/thumbs/` (page state), `cache/ai/` (image and passes of large final renders, X2), `cache/update/` (an update's download while it is being checked, P5), `models/`, `ai/` (AI execution engines and `sidecar.json`), `logs/`, `browser-profile/` (Edge/Chromium), `webview2/` (own window's profile), `window.json` (where the own window was), `launcher.json` (the port), `instance.json`, `pending-models.json` |

`--data-dir` overrides all of the above.

## Lifecycle

- **Stable port per data folder** (P3e, `src/port.rs`): the launcher records its port in
  `<data>/launcher.json` (`{"port": N}`) and reuses it on the next start-up if it is
  free; only if it is taken does it take another free one, and record it. That way the window's
  origin (`http://127.0.0.1:<port>`) does not change from one start-up to the next. `--port N` uses N and records nothing.

- **Single instance**: `<data>/instance.json` (`{port, token, pid}`, readable only by its owner
  on Unix). A second start-up that finds a live instance (it answers `/api/info` with its
  token) opens another window against it and exits.
- **Own window** (Windows, `src/platform/`): if `WebView2Loader.dll` is next to the executable
  (Microsoft's, from the NuGet package `Microsoft.Web.WebView2` pinned with its SHA-256 in
  `packaging/lib/webview2.mjs`) and `GetAvailableCoreWebView2BrowserVersionString` finds the
  WebView2 *runtime*, a Win32 `WS_OVERLAPPEDWINDOW` window with the system title bar,
  our icon (`WM_SETICON` at the monitor's DPIs), title `Repackshot — <project>`, dark bar
  with the dark theme (`DWMWA_USE_IMMERSIVE_DARK_MODE`, 20 and failing that 19), AppUserModelID
  `Repackshot.App`, per-monitor v2 DPI, minimum size of 500 × 400 at 100 % and its place in
  `window.json` (not used if its title bar no longer falls on any screen). The installer gives
  its shortcuts the same AppUserModelID with `repackshot --shortcut-id <lnk>`
  (`IShellLinkW`, `IPropertyStore` with `PKEY_AppUserModel_ID`, `IPersistFile::Save`; only
  shortcuts to `repackshot.exe`), so that the pin and the window are a single taskbar
  button. The file dialogs (`src/dialogs.rs`) open with this window as
  owner. Inside, WebView2 with its profile in `webview2/` (with the `PROFILE_PREFERENCES` below) and,
  as arguments, the same `DISABLED_FEATURES` and `NO_THROTTLING_SWITCHES` of `src/browser.rs`
  as the application window (`src/platform/flags.rs`); everything that is not our
  interface, turned off through the API (`src/platform/policy.rs`): context menus, script dialogs,
  browser shortcuts, status bar, zoom, pinch, swipe-to-go-back, autofill,
  passwords, SmartScreen, own error page and, in *release*, the developer tools.
  Navigation only to our origin (a clicked `https` link opens in the default browser
  with `ShellExecuteW`; nothing opens another window), downloads cancelled without their panel, permissions
  denied except writing a file or folder that the person chose and persistent
  storage, `alert`/`confirm`/`prompt` dialogs dismissed. **Closing** (button, `Alt F4`, taskbar,
  system menu: everything ends in `WM_CLOSE`) does not close: it sends `close-requested` to the
  page, which asks with its own interface (the same question as Ctrl/⌘ W:
  `requestCloseWindow`) and answers `close-ok`; if the page is absent, has not
  loaded or has not beaten for 20 s, it closes without asking. If any step fails earlier (or the
  browser process dies), it is recorded in the log and the application window
  below is opened; `--window=browser` forces it and `--window=webview2` forbids the fallback (it fails). The
  protocol with the page is in `src/platform/protocol.rs` and `tests/fixtures/host-protocol.json`.
- **App window** (fallback, and always on Linux): `REPACKSHOT_BROWSER`, if set; otherwise, on Windows Edge (`App Paths` of `msedge.exe`
  in HKCU and HKLM, then the usual install paths) and then Chrome; on Linux the first
  of `chromium`, `chromium-browser`, `google-chrome`, `google-chrome-stable`, `microsoft-edge`,
  `microsoft-edge-stable`, `brave-browser` on the `PATH`. Arguments: `--app=<url>
  --user-data-dir=<data>/browser-profile`, those of *Window without browser chrome* (below),
  `--window-size=1600,1000` (and `--class=Repackshot`, `--password-store=basic`, `--noerrdialogs`
  on Linux), plus the three `--disable-*-throttling/backgrounding` so that the heartbeat is not slowed
  when the window is minimised. With none, the default browser (`cmd /C start "" "<url>"`,
  `xdg-open`).
- **End**: with the own window, when it is destroyed. With the application window: when the browser process ends (if it lived more than 5 s: one that exits earlier has
  handed the window to a browser already open with the same profile), or when the page's heartbeat
  (`POST /api/alive` every 5 s, from a *worker* so that a hidden tab does not slow it)
  falls silent for 20 s (60 s of grace at start-up). If the machine suspends, the deadline starts over.

## Window without browser chrome

Decision after trying v0.1.0: on the desktop nothing appears that is not the
own interface. Three layers, all in `src/browser.rs` as constants that a WebView2 host (P3c)
can reuse as they are (`AdditionalBrowserArguments`):

1. **`HARDENING_SWITCHES`**, switches documented in Chromium's lists
   (`chrome/common/chrome_switches.cc`, `content/public/common/content_switches.cc`; index at
   <https://peter.sh/experiments/chromium-command-line-switches/>) and present in the strings of
   Chromium 141.0.7390.37: `--no-first-run`, `--no-default-browser-check`,
   `--hide-crash-restore-bubble` (no *Restore pages?*), `--disable-sync`,
   `--disable-extensions`, `--disable-default-apps`, `--disable-component-update`,
   `--disable-background-networking`, `--disable-domain-reliability`, `--no-pings`,
   `--deny-permission-prompts` (permissions are denied without asking), `--disable-notifications`,
   `--disable-search-engine-choice-screen`, `--disable-infobars`, `--disable-pinch` (no zoom with
   the fingers) and `--overscroll-history-navigation=0` (no swiping to go back).
2. **`DISABLED_FEATURES`**, in a single `--disable-features=` (a second would replace the first):
   `Translate` (the translate bubble; the `--disable-translate` switch no longer exists and Chromium
   points to the `TranslateEnabled` policy, <https://codereview.chromium.org/2819813002>),
   `TFLiteLanguageDetectionEnabled`, `AutofillServerCommunication`, `HardwareMediaKeyHandling`,
   `PrivacySandboxSettings4`, `LensOverlay`, `OptimizationHints` (names checked in the strings
   of Chromium 141) and, from Edge, `msWebOOUI` and `msPdfOOUI` (the mini menu on selecting text,
   described for kiosk mode at
   <https://learn.microsoft.com/en-us/answers/questions/1194213/how-to-hide-all-context-menu-running-edge-in-kiosk>).
   An unknown name is ignored, so Edge's do nothing in Chromium and vice versa.
3. **`PROFILE_PREFERENCES`**, written to `<profile>/Default/Preferences` before each start-up
   (merged with whatever is there; a file that is not a JSON object is left alone):
   `translate.enabled`, `browser.enable_spellchecking`, `autofill.profile_enabled`,
   `autofill.credit_card_enabled`, `credentials_enable_service`, `credentials_enable_autosignin`,
   `signin.allowed`, `alternate_error_pages.enabled` to `false`, `profile.exit_type = "Normal"`,
   `browser.has_seen_welcome_page = true`, and from Edge `edge_quick_search.show_mini_menu`,
   `PDF_show_mini_menu` and `show_smart_actions` to `false` (the *Show mini menu when
   selecting text* setting; the key is at
   <https://learn.microsoft.com/en-us/answers/questions/449c6c04-a6be-420c-a31d-ded8658decc6/prevent-context-menu-in-edge-when-text-is-selected>;
   the equivalent policy is `QuickSearchShowMiniMenu`,
   <https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/quicksearchshowminimenu>,
   which is not used because policies are machine-wide and are not written without administrator rights).

In addition, on Linux, **`QUIET_ENV`**: `GOOGLE_API_KEY`, `GOOGLE_DEFAULT_CLIENT_ID` and
`GOOGLE_DEFAULT_CLIENT_SECRET` to `no` if not set, because a Chromium without keys (Arch's, Playwright's)
puts the *Google API keys are missing* bar on every window; checked under Xvfb with
Chromium 141. Policies (`TranslateEnabled`, `QuickSearchShowMiniMenu`...) are not used: on
Windows they live in `HKLM`/`HKCU\Software\Policies`, protected, and would affect the person's own Edge.

The page does the rest (`src/ui/guards.ts`, on web and desktop): `translate="no"` and `<meta
name="google" content="notranslate">`, own favicon and manifest, no browser
context menu outside text fields, no chrome selection, no browser shortcuts
(print, reload, zoom, find, view source, downloads, history, bookmarks, windows,
tabs, navigation with Alt + arrows and the mouse's side buttons, F7, F11, F12 and Ctrl ⇧ I in
production) and, on the desktop, Ctrl/⌘ W with the own question and links in the system
browser (`/api/open-url`).

What only an own window removes (P3c, WebView2): the *⋯* menu of the title bar of an
Edge or Chromium `--app` window, and the *Leave site?* `beforeunload` dialog when closing with the X.

## Security

- It listens only on `127.0.0.1`.
- **`Host`**: every request must carry `Host: 127.0.0.1:<port>` or `localhost:<port>`; otherwise,
  421. That way a page from another domain that has been made to resolve to 127.0.0.1 (*DNS rebinding*) cannot
  read anything.
- **Token**: 128 random bits per start-up (from `/dev/urandom` on Unix; on Windows, from `std`'s
  `RandomState`s, whose SipHash keys come from the system generator, mixed with the
  time and the pid). Every `/api/*` requires the `X-Repackshot-Token` header with it (401 if missing or not
  matching; constant-time comparison). A custom header cannot be sent from another
  origin without a CORS *preflight*, and this server **sends no CORS header**.
- **`Origin`**: an `/api/*` with an `Origin` that is not `http://127.0.0.1:<port>` or
  `http://localhost:<port>` is rejected (403).
- The token travels to the page in the URL **fragment** of the window
  (`http://127.0.0.1:<port>/#token=<hex>`), which the browser never sends to the server or puts in
  `Referer`; the page stores it in `sessionStorage` and removes it from the address bar
  (`src/io/native.ts`). It appears in no log.
- **Chosen files** (`src/files.rs`): the page never names a path that the launcher reads or
  writes. Each path the file API touches was chosen by the person in a system dialog
  **in this start-up**, and remains a *grant*: an id (`d…` folder, `f…` file: 24
  hexadecimal digits of the path's SHA-256, so the same folder chosen again has the same id) and
  what it allows. A folder from `dialog/folder`: create **new** files inside (it never
  overwrites: `name (2).png`) and, if `read` was requested (an import), list and read what
  hangs from it (without following symbolic links). A file from `dialog/open`: read it; write it
  only if `writable` was requested (a project that is saved again). A file from `dialog/save`:
  write it whole (to a temporary beside it and renamed over it: a failed save leaves no half
  file). Only extensions that the application produces are written (`png`, `jpg`, `jpeg`, `exr`,
  `tif`, `tiff`, `dng`, `json`, `repack`, `rsb`, `mp4`, `webm`): nothing executable lands anywhere; names are made valid
  on every system (`\ / : * ? " < > |` and control characters to `_`, no trailing dots or spaces, Windows
  device names with a leading `_`, 200 bytes at most). Two entries belong to the
  launcher itself, not the page: `downloads` (the system's Downloads folder, new files only:
  the render window's *Downloads*) and the last project, which the launcher remembers
  in `<data>/last-project.json` when the page asks it for a granted `.repack` (or `.repack.json`)
  (*General ▸ On start ▸ Last project*). What the page sends to a dialog (title, name,
  filters, initial folder) is only text for the dialog: it grants nothing. `/api/open-url` opens
  only `https://` addresses without quotes, spaces or metacharacters, with `rundll32
  url.dll,FileProtocolHandler` (without `cmd`) or `xdg-open`.
- Static files: the path must be absolute, without NUL, `\`, `:`, empty segments, `.` or
  `..`, and the file's canonical path must remain inside the canonical folder (this also
  stops symbolic links that point out). In `/api/*` any empty segment, `.` or `..` is 400.
- Headers always: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  `X-Frame-Options: DENY`, `Cross-Origin-Resource-Policy: same-origin`; `Cache-Control: no-store`
  on the API and `no-cache` on the HTML (Vite's `assets/`, with a *hash*, are immutable).
- HTTP/1.1 with *keep-alive*, one thread per connection (64 at most), bodies with `Content-Length`
  (request `chunked` gets 501), headers up to 32 KiB, `Expect: 100-continue` handled.

## Dialogs

One open at a time (another gets 409 `dialog-open`); they close with the application. What the page
sends (title, proposed name, filters, initial folder) reaches the dialog program as
data, never as code.

- **Windows**: Windows PowerShell (`%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`)
  with `-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -STA -EncodedCommand <script>` and without a
  console window (`CREATE_NO_WINDOW`). The script (`POWERSHELL_SCRIPT` in `src/dialogs.rs`) reads
  the inputs from `RPX_*` variables and uses `System.Windows.Forms`: `OpenFileDialog` and
  `SaveFileDialog` (which .NET shows with Vista's modern dialog), and for folders Vista's
  `IFileOpenDialog` in `FOS_PICKFOLDERS` mode, compiled once by `Add-Type` and stored
  in `<data>/cache/folder-picker-<v>.dll`; if that cannot be done (a machine in restricted
  language mode), the `OpenFileDialog` folder trick. The dialog's owner is the application's window
  when the launcher knows its `HWND` (`Dialogs::set_owner_window`, for the
  own host of P3c) or a hidden *always on top* form, so it comes out in front of the
  window. Paths come back as `PATH <base64 of UTF-8>`, whatever the console's code
  page.
- **Linux**: `zenity` (`--file-selection`, `--directory`, `--save --confirm-overwrite`,
  `--multiple`, `--file-filter`), otherwise `kdialog` (`--getexistingdirectory`, `--getopenfilename`,
  `--getsavefilename`), otherwise 501 `no-dialog` and the interface asks to install one of the two.

## API

All `/api/*` routes carry `X-Repackshot-Token`. Errors in JSON:
`{"error": "<code>", "message": "<text>"}`.

### Application

| Request | Response |
| --- | --- |
| `GET /api/info` | `{app:"repackshot", version, engineVersion, features, threads, isa, simd[], os, arch, dataDir, modelsDir, logsDir, resultsDir, portable, browser, window, pid, filesApi, aiApi, aiPost, updateApi, afterUpdate}` (`updateApi: 1` when the launcher knows how to update itself, P5; `afterUpdate`, that an update started it). `window`: `{kind: "webview2"\|"browser"\|"default"\|"none", detail, reason}` (`detail`: the WebView2 version or the browser; `reason`, why it is not the own window: `forced`, `not-windows`, `loader-missing`, `runtime-missing`, `failed`), `null` with `--serve-only`; `features`, what the engine reads besides the usual RSB (`rt_core::FEATURES`; bit 0, M2b: textures: `IMGS`, the texture block of `MATL` and the UVs of `MESH`; bit 1, M3b: material programs, `PROG`; bit 2, Q1: the section view, `SECT`; bit 3, L5: IES lights, `LGHT` of type 5 and `IESP`) |
| `POST /api/alive` | 204. The heartbeat. |
| `GET /api/hardware[?device=gpu\|cpu][&refresh=1]` | `{cpu, cores, threads, ramBytes, ramGiB, ramUsableBytes, gpus[{name, vendor, vramBytes, vramGiB}], gpuDetection, gpuSources[{source, ok, found, detail}], device, gpuFound, detected, input, recommendation{rowId, recommended, offered[], skipped[]} \| null}`. `gpuDetection`: `ok` if any graphics-card source answered, `failed` if none did (then an empty `gpus` does not mean “no card”); `gpuSources`: what each said (`dxgi`, `registry`, `cim`, `wmic`; `nvidia-smi`, `drm`; `test`), with `detail` the error or notes |
| `POST /api/open-folder` | Body `{"folder":"data\|models\|logs\|results"}` or `{"path":"<inside the data folder>"}`; 204, 403 outside the data |
| `GET /api/pending-models` | What the installer chose, normalised: `{"device":"gpu\|cpu","keys":[...],"runtime":"SDCPP_WIN_VULKAN"}`, or `null`. `runtime` (U10) is only present if the installer left it marked alongside the models (a valid name; if it is not, it is omitted). The launcher starts downloading it itself at start-up (`Ai::start_pending_runtime`: an unknown key, one for another system or one already installed does nothing); the models are started by the page, which then deletes the file |
| `DELETE /api/pending-models` | 204: consumed |

### Dialogs and chosen files

Each grant is `{id, name, path, folder, read, write, size}`. A dialog response is
`{"cancelled": true}` or `{"cancelled": false, "file": <the first>, "files": [...]}`.

| Request | Response |
| --- | --- |
| `POST /api/dialog/folder` | Body `{title, start?, read?, write?, folderItem?}`: a folder; `write` (the default) allows creating new files, `read` listing and reading it. `start` is an id or a folder that exists (only a hint) |
| `POST /api/dialog/open` | Body `{title, multiple?, filters?, start?, writable?}`; `filters` is `[{name, extensions:["png","repack","repack.json","*"]}]` (extensions validated, 400 if not) |
| `POST /api/dialog/save` | Body `{title, defaultName, filters?, start?}`; the dialog asks before replacing. 422 `extension` if the person types an extension that the application does not write |
| `PUT /api/files?dir=<id>&name=<name>` | Body: the bytes. A **new** file in folder `<id>` (or `downloads`): `name`, or `name (2)`...; 201 with its grant (which can be shown, not read or written). 404 `not-granted`, 403 without permission or unsupported extension, 400 `bad-name`, 507 no space |
| `PUT /api/files/<id>` | Writes the whole file (temporary and renamed); 403 if it is not writable |
| `GET` / `HEAD /api/files/<id>` | The file, with `Range` (for imports of many GB) |
| `GET /api/files/<id>/info` | The grant, plus `hashing{done,total}` while its SHA-256 is being computed |
| `POST /api/files/<id>/sha256` | `{sha256, bytes}`, computed by *streaming* with the own SHA-256 (imported AI models) |
| `GET /api/files/<id>/list` | `{files:[{id, name, rel, size}]}`: what hangs from a readable folder (8 levels, 4096 files, no links) |
| `POST /api/files/<id>/reveal` | 204: the folder, or the selected file (`explorer /select,`), in the file manager; 410 if it is no longer there |
| `GET /api/projects/last` | The last project's grant (read and write) or `null` |
| `PUT /api/projects/last` | Body `{id}` of a granted `.repack` or `.repack.json`; 204 |
| `POST /api/open-url` | Body `{url}`, `https://` only; 204 |

`GET /api/info` carries `filesApi: 1` when the launcher has this API.

### Native engine

| Request | Response |
| --- | --- |
| `POST /api/render?kind=viewport\|final[&finish=samples\|time\|first][&passes=<passes>][&mesh=<key>][&client=<id>][&seq=<n>][&share=<threads>]` | Body: the RSB. `{id, width, height, maxSamples, threads, isa, passes}` (`passes`: the names of the passes it renders, X2). 400 `bad-scene` if the RSB is not valid; 400 `bad-query` if `passes` names a pass that does not exist or is requested in a viewer job; 409 `need-meshes` if it is an update without `MESH` and those meshes are not loaded (the page then sends the whole scene, with the same `seq`); 409 `stale` if a viewer job of that `client` with a `seq` greater or equal has already arrived (two requests that overtake each other: the old one does not replace the new one); 503 `busy` with 8 windows in use (that have asked within the last 3 s) |
| `GET /api/render/<id>[?after=<n>][&data=0][&fit=<w>x<h>]` | A **frame**: binary header and, if there is a new pass, the sums. With `after=n` it waits up to 1 s for a pass later than `n` (or for the end, or for a change in how it shares with the renders: it starts or stops sharing, or waits). `data=0`: the header only (progress). `fit` (U14, the queue's live view): the sums reduced by the smallest integer factor `k` that fits in that box (each pixel, the mean of the sums of its `k × k` box within the image), the header with the reduced size and flag 512, without the non-*denoise* sums; with no sums to send nothing changes; 400 `bad-query` if it is not `<w>x<h>` from 1 to 16384. 404 if the job does not exist or was replaced or cancelled |
| `DELETE /api/render/<id>` | 204: cancelled (or, if it already finished, forgotten; the stored passes remain) |
| `GET /api/render/<id>/passes` | The stored **passes** of final render `<id>` (X2), in binary (`RPP1`, below). 404 `not-found` if the id does not exist, was already evicted or the job did not request passes (or was cancelled, orphaned or failed); 409 `not-ready` while rendering |
| `GET /api/render/state[?log=1&reason=<text>]` | Diagnostics: `{connections, heartbeatSilenceMs, engine: {threads, isa, gate: {finalsRunning, finalsWaiting[], liveViewportThreads}, jobs: [{id, kind, width, height, maxSamples, share, passes, threads, pass, samples, seconds, flags[], cancelRequested, unaskedMs, error?}], viewports: [{client, lastSeq, sceneKept, running: {id, threadDone} \| null}]}}` (`passes`: the job's pass mask). With `log=1` it also goes to the log, with the reason the page gives (the viewer's *watchdog* asks for it when it fires) |

Jobs: maximum samples and time from the RSB's `RNDR` (0 samples = 16, as in `rt`). `finish` says
when to stop, like the render window's *Finish by* (`src/render/schedule.ts`): `samples` (the
samples; time does not count), `time` (the time, no sample limit) or `first` (whichever comes
first); without it, `first` if there is a time and `samples` if not. The stop rule is that of `runPasses`:
only between passes, so all pixels have the same samples, and with a time it does not start
a pass of which half would not fit (it ends within half a pass of the limit). A
job's clock starts when it starts rendering: a final waiting in the queue does not spend its time. A `final`
job has priority and finals run one at a time in order of arrival. A viewer job
with `share=n` (the page asks for a quarter of the threads, at least one, unless *Settings ▸ Render
engine ▸ While a render runs* says *Pause the viewport*) keeps rendering on `n` threads while a
final runs, and the final keeps the rest (and all of them again when no viewer is alive: one that has
converged does not count); without `share`, it stops between tiles (the *paused* flag). Which thread renders
each tile changes no pixel: the final gives the same bits with or without a live viewer
(`tests/parity.rs`). A new viewer job from a `client` replaces that `client`'s previous one
(unless it arrives late: `seq`); if the RSB brings no `MESH` and `mesh` matches that of the
previous job, its meshes and BVHs are kept (`Scene::update_from_rsb`); a previous job
that does not stop in 5 s (an eternal tile) is left behind without its scene, and the next
update asks for the whole scene. A `final` always carries its meshes. The last two finished
finals are stored for collection; the page deletes them when it reads them. A job that nobody
asks about (the page asks every second) stops by itself: the viewer one after 10 s and the final one after
20 s (its page is gone). With all 8 windows busy, the one that has gone more than 3 s without asking (a
reloaded page, whose earlier self does not come back) gives its place to the new one: reloads alone never
reach the limit, and the page, besides, cancels its jobs on leaving (`pagehide`). A render that panics ends as failed and releases its turn. The
writing of an `after=` frame that the page no longer reads is cut off after 10 s and the connection is
closed (before, it held its thread for 120 s). The page always reads or cancels the body of each response:
an unread response holds one of the six connections that the browser opens to the launcher, and with
all six held every request waits forever (which stopped the viewer, the render and
*Pause* in v0.1.0).

**Passes** (X2, `src/kept.rs`; contract in `docs/AI-POST.md` §7.4). `passes` is a comma-separated
list of `albedo`, `normal`, `depth`, `partId`, `materialId` and `coc` (the names of
`PASS_KEYS`, case-sensitive); the final job renders those and those of its RSB's `RNDR.passes`,
alongside the image and without changing a pixel of it, with the threads it has (also those left to it by a
sharing viewer, `share`: which thread does a tile changes neither a pixel nor a pass). A viewer
job never renders passes (those of its RSB are ignored). When a final finishes with all its
samples (not if it is cancelled, orphaned because its page stopped asking, or fails), the linear
image (its last frame) and the passes are **stored by id**, before the job says it has
finished, for the AI post-processing (X3c takes them from there with the render's id; in Rust,
`Engine::kept`); forgetting the job does not delete them. The **last four** are stored: a new one
evicts the oldest. One of more than **64 MiB** between image and passes (about 1.5 megapixels with
all the passes) is not kept in memory: it goes to `<data>/cache/ai/<id>.rpx` (the image, an `RPX1`
frame with data) and `<id>.rpp` (the passes, `RPP1`), written through a temporary and renamed, and is
served from there; evicting it deletes both files. Ids start over at each start-up, so
the `.rpx`, `.rpp` and `.tmp` files of numeric name left by an earlier start-up are deleted at
start-up.

**Frame** (little-endian, 48-byte header):

| Byte | Field |
| --- | --- |
| 0 | `"RPX1"` |
| 4 | `u32` header length (48) |
| 8 | `u32` passes completed (0: none yet) |
| 12 | `u32` samples per pixel in the sums |
| 16, 20 | `u32` width, height |
| 24 | `f32` seconds since it started (until it ended) |
| 28 | `u32` flags: 1 finished, 2 cancelled, 4 failed, 8 paused by a final, 16 carries data, 32 shares the threads (a viewer in its part while a final runs, or a final that leaves that part to a live viewer), 64 sums with *denoise*, 128 the non-*denoise* sums follow, 256 with caustics, 512 reduced sums (`fit=`: the width and height are those of the reduced image) |
| 32 | `u32` samples requested (0: as many as fit in the time) |
| 36 | `u32` threads rendering it now (all, its part while sharing, 0 while waiting) |
| 40 | `u64` rays cast |
| 48 | with flag 16: `width × height × 4` `f32`, per pixel the **sum** of premultiplied radiance (RGB) and coverage (A) of all the samples |

They are the same sums that `src/render/tiles.ts`'s `Accumulator` accumulates, so the page
reuses its display path and its exact conversion to 8 bits as is.

**Passes** (`GET /api/render/<id>/passes` and `<data>/cache/ai/<id>.rpp`; little-endian, 32-byte
header):

| Byte | Field |
| --- | --- |
| 0 | `"RPP1"` |
| 4 | `u32` header length (32; the planes start there) |
| 8, 12 | `u32` width, height |
| 16 | `u32` the passes present: bit *i* = `PASS_KEYS[i]` of `src/core/passes.ts` (1 albedo, 2 normal, 4 depth, 8 partId, 16 materialId, 32 coc) |
| 20 | `u32` samples of which the albedo is the mean |
| 24 | `u32` job id |
| 28 | `u32` 0 (reserved) |
| 32 | for each bit, in that order: `width × height × channels` words in rows from the top (3 channels for the albedo and the normal, 1 for the others); `f32`, except `partId` and `materialId`, `u32` |

Background: albedo, normal, ids and `coc` 0, depth +∞; the studio floor, `0xFFFFFFFF` in both
ids. `src/render/pass-planes.ts` (`parsePasses`) reads it on the page; `tests/fixtures/passes-3x2.rpp`
is written by this *crate* and read by the page, so that the two sides do not drift apart.

**Parity.** The rendering is that of `rt` (`rt_cli::render_progressive`): 32-pixel tiles
from `tile_grid`, one film per tile, passes of 1, 2, 4, 8 and then 16 sample indices,
tiles distributed by an atomic counter and each tile's samples summed in index
order in `f32`. Since `rt-core` draws its random numbers only from (seed, pixel, sample
index), the film is the same, bit for bit, as `rt`'s and the wasm pool's, with
any number of threads. `tests/parity.rs` checks it: the example at 4 samples through the API
(with 1 and 4 threads) gives the film of `rt_cli::render` and `rt-core`'s pinned *hash* `PINNED_EXAMPLE_4SPP`,
the same that the wasm reproduces (E4); a viewer update without meshes gives the
film of the complete scene. With all the passes (X2) the film does not change and the planes that
`/passes` serves are `rt-core`'s `PINNED_PASS_*`, also with 1 and 4 threads; and the store keeps
the last ones, sends them to disk, evicts them and rejects ids it does not know.

### Updating from the application (P5)

The page asks, the launcher does (`src/update/`). Only `https://github.com/<owner>/<repo>/releases/download/<version>/<file>` of the repository in
`src/data/update-feed.ts` (the *crate* reads that file at compile time), the package that suits this copy and the `SHA256SUMS.txt` of the
same version; nothing else is downloaded, wherever the request comes from.

| Request | Response |
| --- | --- |
| `GET /api/update` | `{state, tag, received, total, ready, error, message, mode}`. `state`: `IDLE` · `DOWNLOADING` · `VERIFYING` · `INSTALLING` · `FAILED`. `received` and `total` in bytes (`total` is the `size` the page gave, 0 if it gave none). `ready: true` with `INSTALLING`: the files are already in place and the launcher waits for the window to close (before that, `INSTALLING` is the unpacking and the swapping of files: nothing is closed yet). `error` (with `FAILED`): `download` · `disk-full` · `sums` (the release does not list the package's sum) · `checksum` (does not match: nothing was installed) · `extract` · `install`; `message`, the same in English and with detail, for the log. `mode`: `installer` · `portable` · `null` (a copy that cannot be updated) |
| `POST /api/update/install` | Body `{tag, assetUrl, sumsUrl, size?}` (`tag`: `0.2.0` or `v0.2.0`). `202` with the state. `400` `bad-tag`, `bad-url` (outside the allowlist: another server, another repository, `http`, a query or a fragment, `%`, `..`, another version), `bad-asset` (the package is not that of this kind of copy, or the sums are not called `SHA256SUMS.txt`), `bad-body`; `409` `not-updatable` (neither installed —`uninstall.exe` next to the program— nor portable —`portable.txt`—, or not x86-64) and `busy` (one is already running) |
| `POST /api/update/cancel` | Stops a download or a check (the launcher keeps nothing of them) and clears a failure: the state, `200`. `409` `not-cancellable` when the files are already being swapped |

What it does, on a thread and with the system `curl` (the same limits and retries with resume as the other downloads):

1. **DOWNLOADING**: the sums and the package (1 GiB at most) to `<data>/cache/update/`.
2. **VERIFYING**: the package's own SHA-256 against the sum that the release lists for its name (two different sums for the same
   name are not accepted). If it does not match it is deleted and `FAILED` `checksum`.
3. **INSTALLING**, according to the copy:
   - **Installed (Windows)**: the verified installer stays in `cache/update/` for the end.
   - **Portable (Windows `.zip`, Linux `.tar.gz`)**: **everything** is extracted to `<executable folder>/update-<tag>/` (names of
     `[A-Za-z0-9._+-]`, nothing that climbs with `..`, no links; the zip with the own reader, the tar with the system `tar` after looking at
     its list) and it is checked that it brings the executable and `app/index.html`. Then, it **replaces in place**: each file and folder of the
     package —the executable last— takes the place of the one with its name, which is renamed `<name>.old` (`repackshot.old.exe`,
     `app.old`; an executable in use can be renamed, not overwritten). `data/` and `portable.txt` are not touched. If any step
     fails those done are undone, the old stays where it was and the state is `FAILED` (`disk-full` if space ran out, `extract`,
     `install`). The names to delete are recorded beforehand in `update.json`.
4. **The launcher waits for the window to close** (the page closes it on seeing `ready`, after its question about unsaved changes;
   with `--serve-only`, without a window, it exits by itself). **Only when it has stopped** —the server, the window and `instance.json` already released— it starts,
   detached from the process (no console, no input, own process group), `setup.exe /S /LAUNCH` or the new executable with the same
   arguments plus `--after-update`. There is never a new version alongside an old one that holds the port.
5. **On start-up**, the new version deletes the `.old` files of `update.json` (and only those), the `update-<version>` folders and
   `cache/update/`; on Windows it retries for a few seconds because the old executable may still be closing.

The installer (`packaging/windows/installer.nsi`), when silent: waits up to 30 s to be able to open `repackshot.exe` for writing, neither shows nor
writes the AI models page, renews the desktop shortcut only if it exists and, with `/LAUNCH`, starts the application when done
(`.onInstSuccess`). `tests/installer.rs` reads the script as text and checks the loop, `/LAUNCH` and those safeguards.

### Page state

On the desktop the page is only the interface (phase P3e): **everything it stores is written by the
launcher** in the data folder, never the window's browser storage (which would not
last anyway: each start-up listens on another port, and another port is another origin, with
empty storage). The client is `src/io/native-store.ts`; the seam, `src/io/platform.ts`.

```text
<data>/settings.json              the settings document ({schema, settings, layout} of src/core/settings.ts)
<data>/state/<name>.json          small documents (downloads to resume, the migration mark...)
<data>/library/library.json       the own library (U4)
<data>/results/index.json         the history: {"version": 1, "results": [{id, file, type, display, ai, aiType, aiVariants, meta}]}
<data>/results/<id>.<ext>         a result's file as is (png, jpg, exr, webp, tif, dng)
<data>/results/<id>.display.png   its image for the viewer, when the page cannot display the file (EXR, TIFF, DNG)
<data>/results/<id>.ai.<n>.<ext>  variant n (1 to 8) made by the AI post-processing, when the result went through it (X4b), in its type
<data>/results/<id>.ai.<ext>      the single AI image of a result from before X4b (phase X4): read as its variant 1
<data>/cache/thumbs/<key>.txt     the material spheres (data URL): cache, freed whenever wanted
```

- **Atomic writes**: to a temporary beside the destination, `sync_all`, and `rename` over it; a cut
  or a shutdown leaves the old file or the new one, never half. A body shorter than announced
  is 400 `short-body` and touches nothing.
- **Names**: `[a-z0-9._-]`, lowercase (two names never collide on a case-insensitive disk), from 1 to 96 characters, not starting or ending with a dot, without `..` and never a Windows
  device name (`con`, `nul`, `com1`...): otherwise, 400 `bad-name`.
- **Confinement**: each path is the data folder plus fixed folders and such a name; each
  folder along the way must be a real folder, not a link, and the file may not
  be a link either (403 `outside`).
- A document that is not JSON (hand-edited, a disk fault) is set aside as
  `<name>.corrupt` and read as none: the page starts with the factory values.

| Request | Response |
| --- | --- |
| `GET /api/store/settings` | The document as it was stored, or `null` |
| `PUT /api/store/settings` | Body: a JSON object (1 MiB at most). 204 |
| `DELETE /api/store/settings` | 204 |
| `GET /api/store/docs` | `{"<name>": <value>, ...}`: all the small documents |
| `GET` / `PUT` / `DELETE /api/store/docs/<name>` | One (`null` if absent); `PUT` accepts any JSON value of 1 MiB at most |
| `GET` / `PUT` / `DELETE /api/store/library` | The library: a JSON object of 64 MiB at most |
| `GET /api/store/results` | `{"results": [meta...]}`, in the order they arrived; a result whose file was deleted by hand does not appear |
| `PUT /api/store/results/<id>?type=<type>` | Body: the file (4 GiB at most, written to disk in chunks). `image/png`, `image/jpeg`, `image/x-exr`, `image/webp`, `image/tiff` (`.tif`) or `image/x-adobe-dng` (`.dng`); any other type, 415 |
| `PUT /api/store/results/<id>/display` | Body: the PNG image for the viewer (512 MiB at most) |
| `PUT /api/store/results/<id>/ai/<n>?type=<type>` | Body: variant `n` (1 to 8, written without leading zeros; otherwise 400 `bad-variant`) made by the AI post-processing (X4b), with the same types and limit as the file; again in another type leaves a single file. It enters the record (`aiVariants: [{n, file, type}]`) with `PUT .../meta` if it is already there. A variant that the guard rejected has no file: it is not sent |
| `PUT /api/store/results/<id>/ai?type=<type>` | The single AI image from before X4b (X4), `<id>.ai.<ext>`; it keeps working and is read as variant 1 |
| `PUT /api/store/results/<id>/meta` | Body: the record (`ResultMeta`, an object with `id` equal to the path's, otherwise 400 `id-mismatch`). It enters the index only if its file is already there (409 `no-file`) |
| `GET` / `HEAD /api/store/results/<id>[/display\|/ai\|/ai/<n>]` | The file, its image or the AI variant `n` (`/ai` is the 1st; the 1st of a result from before X4b is its `<id>.ai.<ext>`), with its type and `Range`; 404 if absent |
| `DELETE /api/store/results/<id>` | 204: the record and its files, all variants included |
| `DELETE /api/store/results` | `{"deleted": n}`: the index and what the store wrote in `results/` (a file the person put there stays) |
| `GET /api/store/cache/<key>` | The thumbnail (`text/plain`), or 204 if absent (normal, not an error) |
| `PUT /api/store/cache/<key>` | Body: UTF-8 text of 1 MiB at most. 204 |
| `DELETE /api/store/cache` | `{"freed": bytes}`: deletes the thumbnails (not other caches under `cache/`) |
| `GET /api/storage/usage` | `{dataDir, total, files, folders: [{id, path, bytes, files}]}` with `id` `models`, `results`, `library`, `thumbs`, `logs`, `window` (the window profile: `browser-profile/` and `webview2/`) and `other` (the rest: settings, `state/`...). It is measured by walking the folders without following links |

**Migration, once.** If the data folder has no `state/migration.json`, the page copies
what an earlier version left in its origin's browser storage (settings, also
the loose preferences from before; library; each `repackshot.*` except the thumbnails; the
IndexedDB history, result by result), only what the launcher does not already have, and writes the
mark with what was copied and what failed. After that it does not look at the browser storage again. The
browser's copy is left as it was.

**For tests only**: `REPACKSHOT_TEST_GPUS="name|vendor|bytes;..."` replaces the detected graphics
cards (P3e's interface check on a machine without a card).

### AI models

**Content-based** store: a file shared by several models (the Qwen3-4B encoder of
four keys, Z-Image's VAE of three) is stored and downloaded once.

```text
<data>/models/blobs/<sha256>             complete file, checked against its name
<data>/models/blobs/<sha256>.part        half-downloaded file
<data>/models/blobs/<sha256>.part.json   {"total", "ranges": [[start, end), ...], "damaged", "actual"}
<data>/models/installed.json             {"installed": [keys]}
<data>/models/imported/<key>.json        manifest of an imported model
```

The web version replicates the same layout in OPFS.

| Request | Response |
| --- | --- |
| `GET /api/models` | `{dir, installed[], models[{key, source:"catalogue"\|"imported", installed, state:"missing"\|"partial"\|"complete", totalBytes, presentBytes, files[{name, role, sha256, bytes, state, written?, contiguous?, damaged?, checking?}], manifest?}]}` for each catalogue key and each imported one |
| `PUT /api/models/blobs/<sha256>?offset=<n>[&total=<n>]` | Body: a chunk. It is written at its place in the `.part` without loading it whole into memory (sizes of tens of GB); chunks may arrive out of order and over several connections. Responds with the *blob*'s state. 409 `damaged` or `checking`; 409 `conflict` if `total` changes; 416 if the chunk falls outside; 507 no space. A cut chunk leaves what arrived written |
| `GET /api/models/blobs/<sha256>/status` | `{sha256, state, contiguous, written, total?, ready?, damaged?, actual?, checking?{done, total}}`; `contiguous` is the bytes written with no gap from 0: **resuming starts from there** |
| `POST /api/models/blobs/<sha256>/finish[?bytes=<n>]` | Computes the SHA-256 (own, streaming) and, if it matches the name, renames the `.part` to its final name: 200 `{sha256, state:"complete", bytes}`. If it does not match: 422 `sha256-mismatch` with `actual`, and the `.part` stays **damaged** until deleted. 409 `incomplete` with `contiguous` if bytes are missing |
| `GET` / `HEAD /api/models/blobs/<sha256>` | The complete file, with `Range` (one range: 206; outside: 416). 404 if not complete |
| `DELETE /api/models/blobs/<sha256>` | Deletes the *blob* or its part; 409 if an installed model uses it |
| `PUT /api/models/imported/<key>` | Body: the manifest (an object with `files[{name, role, bytes, sha256}]` and whatever the interface wants: licence, architecture...). 409 if the key belongs to the catalogue |
| `GET /api/models/imported/<key>` | The stored manifest |
| `POST /api/models/installed` | Body `{"key": ...}`: records it in `installed.json` if all its *blobs* are complete (409 `missing` with the files that are lacking) |
| `DELETE /api/models/<key>[?keep=A,B]` | Removes it from `installed.json` (and its manifest if it was imported) and deletes **only** the *blobs* that no other installed model uses nor those in `keep` (downloads in progress). `{deleted:[sha256...]}` |

Validation: `<sha256>` exactly 64 lowercase hexadecimal digits; keys and file names
`[A-Za-z0-9._-]`, from 1 to 128 characters, not starting with a dot and without `..`.

## Hardware and recommendation

`repackshot --hardware <f.ini> [--device gpu|cpu]` and `GET /api/hardware`:

- **Windows, graphics cards**: up to four sources, in this order, and each leaves in the
  launcher's log (`logs/repackshot.log`, `hardware:` lines) what it found or why it failed,
  plus a final line with what was kept:
  1. **DXGI** (`src/platform/dxgi.rs`, in-process: `CreateDXGIFactory1`,
     `EnumAdapters1`, `GetDesc1`): each adapter present with its exact dedicated VRAM (64 bits).
     Software adapters (`DXGI_ADAPTER_FLAG_SOFTWARE`, the *Microsoft Basic
     Render Driver*) and Microsoft's (vendor `0x1414`) are skipped. `dxgi.dll` is loaded only from
     `System32` (`LOAD_LIBRARY_SEARCH_SYSTEM32`). It needs no child processes or registry
     permissions.
  2. **The registry**: the display class
     `HKLM\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}`, with
     one `reg query` to list its subkeys and another for each adapter (`\0000`, `\0001`…):
     `DriverDesc`, `ProviderName`, VRAM from `HardwareInformation.qwMemorySize` (64 bits, exact), failing that
     `HardwareInformation.MemorySize` (32 bits). **Never `/s` on the class**: its subkey
     `Properties` gives “Access is denied” and `reg` exits with 1; with `/s` one cannot
     count on what it lists after an error either. The output is read even if `reg` ends
     with a non-zero code (`process::output_any`): v0.1.2 threw it all away and found
     no card on any Windows.
  3. **CIM**: `Get-CimInstance Win32_VideoController` (`Name`, `AdapterCompatibility`,
     `AdapterRAM`, which is 32-bit and tops out at 4 GiB), in the same PowerShell run as
     the RAM and the cores.
  4. **wmic** (`path Win32_VideoController`), only if PowerShell did not answer.

  **Merging** (`merge_gpus`): the adapters are those of the first source that answered among those that
  list exactly what is there now (DXGI, failing that CIM, failing that wmic), because the registry keeps the
  driver keys of a card that has been removed; the other sources complete those same
  adapters, matched by name (lowercase, without `(R)` or `(TM)`; two identical cards are still
  two). If none of those answered, the registry's is used. VRAM: the largest of the exact ones
  (DXGI, `qwMemorySize`), failing that the largest of the 32-bit ones. If no source answered,
  `gpuDetection` is `failed` and the interface says that the cards could not be read, not that there
  are none.
- **Windows, the rest**: installed and usable RAM and cores with PowerShell `Get-CimInstance`
  (30 s at most), failing that `wmic`; CPU name from the registry. All without a console window
  (`CREATE_NO_WINDOW`), the programs by their absolute path (`%SystemRoot%\System32\reg.exe`,
  `…\WindowsPowerShell\v1.0\powershell.exe`, `…\wbem\WMIC.exe`) and their outputs read whatever
  their exit code.
- **Linux**: `/proc/cpuinfo`, `/proc/meminfo`, blocks of `/sys/devices/system/memory` (the installed
  RAM: a "16 GB" machine shows about 15.6 GiB usable), `nvidia-smi` if present,
  `mem_info_vram_total` of the DRM cards (AMD).
- **Effective memory**: memory is reported below its commercial size (a "16 GB" machine
  shows 15.6 to 15.9 GiB usable; a "12 GB" card may read 11.99 GiB), and the
  table speaks in commercial sizes. That is why the rule compares with the table the **effective GiB =
  measured GiB / 0.94**, in RAM and in VRAM (not in the browser's buffers): constant
  `MEMORY_REPORTING_FACTOR`, with the same name in `recommend.rs` and in
  `src/core/ai-recommend.ts`. Installed RAM is still preferred when it can be read. The INI and
  `/api/hardware` give the measured values; the rule applies the factor.
- **Device**: GPU if there is one with ≥ 4 effective GiB of dedicated VRAM; otherwise, CPU; `--device`
  overrides.
- **Rule**: that of `docs/AI-POST.md` §2.4 over the table of `src/data/ai-models.json`, included in
  the binary at compile time: first row that fits, minimum included and maximum excluded, unavailable
  models skipped (the recommendation moves to the first available offered one), failed detection →
  no recommendation. The same as `src/core/ai-recommend.ts`; both pass
  `tests/fixtures/ai-recommend-cases.json`.

The INI is in **UTF-16LE with BOM** (what Windows' INI functions and NSIS's `ReadINIStr` read as Unicode),
with CRLF lines:

```ini
[hardware]
cpu=…  cores=…  threads=…  ram_gib=16.0  gpu=…  vram_gib=12.0  gpu_found=1  detected=1
[recommendation]
device=gpu  row=gpu-12  key=ZIMAGE_Q8  offered=KLEIN4B_Q4
[runtime]
available=1  key=SDCPP_WIN_VULKAN  backend=VULKAN  file=sd-master-…-win-vulkan-x64.zip  size_mib=29  row=gpu
[models]
count=7
[model0]
key=ZIMAGE_Q8  label_en=…  label_es=…  summary_en=…  summary_es=…  size_gib=8.8
licence=Apache-2.0  commercial=1  restrictions=0  available=1  desktop=1  recommended=1  offered=0
```

(one key per line; grouped here to read them). `size_gib` is GiB with one decimal (what
Windows shows as "GB").

`[runtime]` (phase U10) is **the execution engine that the installer offers alongside the models**: the
build that the rule of `src/data/ai-runtimes.json` chooses for this system (`std::env::consts`)
with the same input that `GET /api/ai/runtime` uses: a GPU to use if the launcher itself, forcing
nothing, would choose the GPU (≥ 4 effective GiB), unless `--device cpu` asks for the processor. `--device
gpu` changes nothing, because the application can only override the rule towards the processor (the query's `device=cpu`).
`available=0` with everything empty when there is no pinned build for the system.
`size_mib` is rounded MiB (what Windows shows as "MB"). `tests/installer.rs` reads
`packaging/windows/models-page.nsh` as text and checks that each `ReadINIStr` has its key in
this INI and that the line it writes to `pending-models.json` is the one `read_pending` reads.

## AI: the execution engine (X3b)

`docs/AI-POST.md` §7.1. **stable-diffusion.cpp** (MIT, on top of ggml, MIT) in its official
builds, pinned in `src/data/ai-runtimes.json` (included in the binary at compile time, like
`ai-models.json`): *release* `master-959-d637cfb`, one **Vulkan** and one **CPU** for Windows and
for Linux x86_64 (the CPU one brings all of ggml's x86-64 variants and loads the best, AVX2 or
higher if available). A separate process that the launcher downloads, starts, feeds and stops; nothing
of it is linked or copied into `engine/`.

```text
<data>/ai/runtimes/<sha256>.zip.part     the archive downloading (resumed from its length)
<data>/ai/runtimes/<sha256>.tmp/         being unpacked (a start-up that finds it deletes it)
<data>/ai/runtimes/<sha256>/             installed: the zip's contents, repackshot-runtime.json, repackshot-probe.json
<data>/ai/sidecar.json                   {pid, server} of the running sd-server
```

- **Selection rule** (the same as `src/core/ai-runtimes.ts`; both pass
  `tests/fixtures/ai-runtime-cases.json`): `choice` rows from top to bottom, the first wins whose
  `force` is the forced one (`null`: nothing forced) and, if it has `gpu`, whose value is whether the machine
  report has a GPU to use (the `device` of `/api/hardware`: a GPU with ≥ 4 effective GiB;
  a failed detection is “no GPU”; `device=cpu` in the request, the CPU chosen in *Settings*,
  too). With the row and the system (`os`, `arch`) the build comes out; with no build for the
  system, the row and no key.
- **Download**: the page cannot do it: GitHub *release* downloads (and
  `release-assets.githubusercontent.com`, where they redirect) send no
  `Access-Control-Allow-Origin`, so a `fetch` from `http://127.0.0.1:<port>` cannot
  read them. The launcher does it with the system `curl` (`%SystemRoot%\System32\curl.exe`
  since Windows 10 1803, never one from the `PATH` on Windows; the first on the `PATH` on Linux):
  `--fail --location --max-redirs 5 --proto =https --proto-redir =https --connect-timeout 30
  --speed-limit 1024 --speed-time 60 [--continue-at <bytes>] --url <url>`, with the output through its
  standard output, which the launcher appends to the `.part` (no path is passed to `curl`). Pausing is stopping
  `curl`; resuming, `--continue-at` with what is there (a server that does not resume, code 33, makes it
  start from 0 once). Cuts, failed connections and slowness (codes 7, 18, 28, 52, 55, 56,
  92) are retried twice, at 2 and 5 s, from where it left off. Without `curl`, the row says so and
  **Install from a file…** installs one downloaded with a browser. The URL always comes from the
  catalogue included in the binary, never from the page.
- **Installation**: own SHA-256 of the whole file; if it is not the pinned one, it is deleted and **nothing is
  installed** (the error states both values). It is unpacked with `src/ai/zip.rs` and
  `src/ai/inflate.rs` (APPNOTE 6.3 and RFC 1951 from the specifications; CRC-32 of each entry,
  limits on entries and sizes, names only `[A-Za-z0-9._+-]` per component, without `..`,
  absolute paths, backslashes, drive letters or symbolic links, files that did not exist),
  executables with `0755` on Unix, in `<sha256>.tmp/`, which is renamed whole; `sd-server` and `sd-cli`
  are required to be present, and they are asked `--version` and `--list-devices` (60 s at
  most; a Windows without the Visual C++ environment exits with `0xC0000135` and the row names it).
- **The server**: `sd-server <family arguments> --listen-ip 127.a.b.c --listen-port
  <free>` with the engine directory as working directory, input closed, both
  outputs read and `CREATE_NO_WINDOW`. `sd-server` reflects any `Origin` in
  `Access-Control-Allow-Origin` and numbers its jobs in order, so it listens on a **random**
  loopback address (all of `127/8` is loopback on Linux and on Windows; never
  `127.0.0.1`) and a free port: about 2^40 combinations that a foreign page would have to
  try, besides the browsers' local network access permission. Ready when
  `GET /sdcpp/v1/capabilities` answers (it listens only after loading the model). It is kept
  loaded between calls with the same arguments; another model, another build or another
  ControlNet restarts it. It is stopped: if it ends by itself (the error says how and its last lines), if
  it says nothing or changes state for `silence` (10 min), if loading exceeds `load` (30 min)
  or one image exceeds `run` (60 min), if cancelled and it does not obey in 15 s, after `idle` (5 min) of no
  use, with `DELETE /api/ai/sidecar` and when the application closes; a start-up that finds in
  `sidecar.json` a live process that is our `sd-server` stops it (`kill -9`, `taskkill /F`).
  On Linux, “ours” means the same file: device and inode of `/proc/<pid>/exe`,
  or the path with links resolved if the file no longer exists. This holds also with the data folder
  behind a symbolic link. On Windows, the image name (`tasklist`). Starting limits: measured by X1 part B.
- **Protocol** (the *release*'s `examples/server/api.md`): `POST /sdcpp/v1/img_gen` with
  `{prompt, negative_prompt, width, height, strength, seed, batch_count: 1, init_image,
  ref_images, control_image, control_strength, sample_params: {sample_steps, guidance:
  {txt_cfg}, sample_method?, flow_shift?}, embed_image_metadata: false, output_format: "png",
  preview: "none"}` (images in base64) → `202 {id}`; `GET /sdcpp/v1/jobs/<id>` every 150 ms
  until `completed` (the image in `result.images[0].b64_json`), `failed` or `cancelled`;
  `POST /sdcpp/v1/jobs/<id>/cancel`. **Progress**: what the two programs write to
  standard output, `|=====>   | 3/8 - 1.23s/it` per sampling step and the same `#` bar when
  reading weights (stable-diffusion.cpp loads them on first use, so the first job
  also shows *Loading*). The returned image is decoded (`src/ai/png.rs`) and **is rejected
  if its size is not the requested one**.

**Arguments per family** (`profiles` of the JSON; `@role` is the path of the model file with that
role in the store, `@role~text` the one that also carries it in its name):

| Key | Family | Load (`sd-server …`) | Per job |
| --- | --- | --- | --- |
| `ZIMAGE_Q8`, `ZIMAGE_Q4`, `ZIMAGE_Q2` | `z-image` | `--diffusion-model @transformer --llm @text-encoder --vae @vae --diffusion-fa` | 8 steps, cfg 1, `init_image` + `strength` |
| `KLEIN4B_Q4` | `flux2-klein` | `--diffusion-model @transformer --llm @text-encoder --vae @vae --diffusion-fa` | 4 steps, cfg 1, `euler`, `init_image` + `strength` and the same image in `ref_images` |
| `QWENEDIT_Q4` | `qwen-image-edit` | `--diffusion-model @transformer --llm @text-encoder --llm_vision @mmproj --vae @vae --diffusion-fa --model-args qwen_image_zero_cond_t=true` | 20 steps, cfg 2.5, `euler`, `flow_shift` 3, `init_image` + `strength` + `ref_images` |
| `SD15_LIGHT` | `sd15` | `-m @transformer` [`--control-net @controlnet~tile` or `@controlnet~depth`] | 20 steps, cfg 7, `init_image` + `strength` [+ `control_image`, `control_strength` 0.9] |

Taken from `docs/z_image.md`, `docs/flux2.md`, `docs/qwen_image_edit.md`, `docs/sd.md` and the
*tag*'s `README`; `init+ref` in the edit ones is ours (generic *img2img* plus its
reference). `supports` says which keys each build loads according to that; `verified: []` until
X1 part B tests it on a real machine. An imported model runs with the profile of the
`family` in its manifest.

| Request | Response |
| --- | --- |
| `GET /api/ai/runtime[?force=VULKAN\|CPU][&device=cpu][&model=<key>]` | An `AiRuntimeStatus` (`src/core/ai.ts`): `{available, reason?, backend, device, supports[], activeModel}` (`backend` and `device`: what `--list-devices` said, the first Vulkan if there is one; `reason`: `NO_RUNTIME`, `NO_MODEL`, `MODEL_UNSUPPORTED`), and also `detail`, `choice{rowId, backend, key}`, `release{tag, commit}`, `platform{os, arch}`, `gpu`, `force`, `runtime` (the chosen one), `runtimes[]`, `sidecar{state, label, pid, idleSeconds}`, `downloader` |
| `GET /api/ai/runtimes/<key>` | `{key, os, arch, backend, here, name, url, sha256, bytes, state: missing\|paused\|downloading\|verifying\|installing\|installed, done, total, error, version, devices[{name, description}], probeError, supports[], verified[]}` |
| `POST /api/ai/runtimes/<key>/download` | 202: starts or resumes. 409 `other-system` for another platform, 404 unknown key |
| `POST /api/ai/runtimes/<key>/pause` | Stops the download; the `.part` stays |
| `POST /api/ai/runtimes/<key>/import` | Body `{"file": <grant id>}` from a `dialog/open`: installs that file if its size and SHA-256 are the pinned ones |
| `POST /api/ai/runtimes/<key>/probe` | Asks `--version` and `--list-devices` again |
| `DELETE /api/ai/runtimes/<key>` | 204: stops whatever it is doing (and the server if it is its own) and deletes everything |
| `POST /api/ai/run` | Body (≤ 96 MiB) `{model, image, control?{kind: tile\|depth, image}, prompt, negative, strength (0, 1], seed, steps?, width?, height?, force?, device?}`, images as base64 PNG (or `data:`), sides from 64 to 4096 in multiples of 16, equal to `width`/`height` if given. 202 with the state; 400 `bad-body` or `size`, 409 `unavailable` with `reason`, 409 `control-unsupported`, 503 `busy` with 4 waiting |
| `GET /api/ai/run/<id>[?after=<version>]` | `{id, state: QUEUED\|STARTING\|LOADING\|INFERENCE\|FINISHING\|DONE\|FAILED\|CANCELLED, step, steps, fraction, seconds, version, model, runtime, width, height, error, message}`; with `after` it waits up to 1 s for a later version. `error`: `crashed`, `hung`, `timeout`, `failed`, `wrong-size`, `bad-image`, `start`, `protocol` |
| `GET /api/ai/run/<id>/image` | `image/png` when `DONE`; 409 otherwise |
| `DELETE /api/ai/run/<id>` | Cancels one running or forgets a finished one (the last 8 are kept, 10 min) |
| `DELETE /api/ai/sidecar` | Stops the server if nobody is using it (204; 409 if someone is) |

`GET /api/info` carries `aiApi: 1`. The catalogue of builds is always the one included:
nothing in the data folder or the environment replaces it, in any build. The tests
supply their own (the fake build, `http://` addresses of a local server) with
`server::Options { ai_runtimes }` when building the server (`Server::start_with`); the
application always starts with `Server::start`, which uses the default options.

## AI: the pipeline (X3c)

`docs/AI-POST.md` §7.3, `src/ai/post.rs`. The page does not send pixels of a final render: the
launcher stored its linear image and its passes (`src/kept.rs`, with its exposure and tone
curve, `Look`) and the page asks for the post-processing **by the render's id** (`RENDER`). The Fast mode's
preview, which is not a launcher render, sends its image and its passes in the same
body (`INLINE`, ≤ 512 px per side). In the launcher, `rt-post`'s step machine:
`plan` → per tile `tile_input` (8-bit sRGB with the render's curve) and the control image
from `control_planes` → `sd-server` (the same X3b server, which stays loaded: several calls in a
row do not restart it) with the attempt's strength, the seed and the exact size of the padded
tile → `accept` → retry at `RETRY_FACTOR` of the strength until `MAX_ATTEMPTS` or rejection.
**With Intervention 0 (or all aspects at 0) the plan has no tiles: the execution engine is
not started, neither it nor the model needs to be installed, and the image is the engine's
bit for bit.** A tile that comes back at another size is the failed `size` check: rejection at
the first attempt and the engine's image. A render's linear image is the page's conversion
(`exactBytes`): the sums over the samples, the colour divided by the coverage where it is not opaque and
alpha 1 where it is (the threshold, `1 − 1e-6` in `f64`, like JavaScript's number).

- **Control**: the first of `depth`, `tile` that the family's profile has (today only SD 1.5:
  `depth`, the passes' depth plane in grey; `tile` would be the tile's own image). Only one, the same
  in preview and in final, so as not to restart the server.
- **The studio floor** (`FLOOR_ID` in both ids) is one more region of the guard: it is relit
  and has its colour check, named *Floor* if the materials table does not name it.
- **Orphans**: a running post that nobody asks about for `ORPHAN_AFTER` (2 min) is stopped (its
  page is gone); the page asks at least every second.
- `GET /api/info` carries `aiPost: 1`.

| Request | Response |
| --- | --- |
| `POST /api/ai/post` (JSON, ≤ 1 MiB) | `{source: {kind: "RENDER", renderId}, settings: {intervention, light, bounce, wear, style, styleStrength, seed}, prompt, negative, modelKey, materials?: [{materialId, name, allowsWear, locked}], tolerances?: {key: number}, steps?, force?, device?}` (the controls, integers 0..100; `tolerances` with the keys of `rt_post::Tolerances::KEYS`, to calibrate in X1 part B). 202 with the state; 400 `bad-body` or `size` (a tile under 64 px), 404 `not-kept` (the render was not stored or was evicted), 409 `no-passes`, 409 `unavailable` with `reason` (`NO_RUNTIME`, `NO_MODEL`, `MODEL_UNSUPPORTED`; only if the plan calls the model), 503 `busy` with 4 running |
| `POST /api/ai/post` (`application/octet-stream`, ≤ 64 MiB) | `INLINE`: `"RPI1"`, `u32` JSON length, the JSON (`source: {kind: "INLINE", tonemap?, exposureEv?}`: linear and 0 EV by default, the image is already what is seen), the `RPL1` image and the `RPP1` passes, of the same size, ≤ 512 px per side |
| `GET /api/ai/post/<id>[?after=<version>]` | `{id, state: QUEUED\|LOADING\|CONDITIONING\|INFERENCE\|GUARD\|RETRY\|DONE\|FAILED\|CANCELLED, stage (the AiPostStage or null), tile, tiles, attempt, maxAttempts, strength, step, steps, fraction, seconds, version, calls, renderId, model, runtime, width, height, tonemap, exposureEv, verdict, report (the GuardReport when finished), error, message}`; with `after` it waits up to 1 s for a later version. `tile` and `attempt` start at 1; `fraction` never goes backwards |
| `GET /api/ai/post/<id>/image` | The delivered image when `DONE` (the engine's unchanged if `REJECTED`): `"RPL1"`, `u32` 16, width, height, and linear RGBA `f32` with straight alpha, rows from the top; 409 if not finished |
| `DELETE /api/ai/post/<id>` | Cancels one running (204; the model stays loaded) or forgets a finished one (the last 8 are kept, 10 min) |

`GET /api/ai/runtimes/<key>` additionally carries `vcRuntime: "missing"` when a Windows build
does not start because a DLL is missing (`0xC0000135` or `0xC0000139`, `Probe.dllMissing`) and
one of the Microsoft Visual C++ 2015–2022 environment's (`MSVCP140.dll`, `VCRUNTIME140.dll`,
`VCRUNTIME140_1.dll`, `VCOMP140.DLL`, `MSVCP140_CODECVT_IDS.dll`) is missing in its folder and in
`System32`, and `vcRuntimeUrl` (Microsoft's official page) on the Windows ones: we do not
redistribute those DLLs.

## AI: the model through an API (X7)

`/api/info` says `aiRemote: 1`. A post may carry `remote` (`docs/AI-POST.md` §8): the pipeline is the
same (plan, tiles, the guard of `rt-post`, the retries, the report), and only the model call changes
backend (`src/ai/backend.rs`: `ModelBackend`, with `LocalRuntime` as before and `RemoteApi` in
`src/ai/remote.rs`). The launcher calls the API with the system's `curl`, its configuration (the key's
header included) through standard input after `-q`, the body through a temporary file in
`<data>/ai/api-calls/` removed after the call; never a redirect; only `https`, or `http` to this computer.

| Endpoint | Contract |
| --- | --- |
| `POST /api/ai/post` with `remote` | `remote: {endpoint: {url, method, authHeader, authPrefix, headers, body: JSON\|MULTIPART, template (JSON text), response: JSON\|IMAGE, responsePath, maxSide, multipleOf, sizes}, options: {sendPasses, timeoutSeconds 10..600, attempts 1..5}, consentedHost, provider}` (`remoteJson` of `src/io/ai-post.ts`; no key). 400 `api-config` (an endpoint it cannot use) or `api-consent` (`consentedHost` is not the URL's host); 409 `api-no-key` (`reason: NO_API_KEY`) when the endpoint names a key header and no key is stored for its host. A failed call ends the post `FAILED` with `error` one of `api-auth`, `api-rate-limit`, `api-timeout`, `api-network`, `api-server`, `api-refused`, `api-too-large`, `api-format`, `api-oversize`, `api-redirect`, and `apiAttempts`, `apiStatus`, `apiDetail` (the service's words, masked). The report's `runtime` is `api:<host>` |
| `GET /api/ai/apikeys` | `{keys: [{host, masked}]}`: the hosts with a key and its mask (`••••` and the last four characters); never a key |
| `PUT /api/ai/apikeys` | `{host, key}`: stores it in `<data>/ai/api-keys.json` (0600 on Unix). 204; 400 `bad-key` |
| `POST /api/ai/apikeys/forget` | `{host}`: forgets it. 204 |

## `.exe` icon and version

`build.rs`, only when building for Windows with mingw-w64: writes a `.rc` with `VERSIONINFO`
(version from `package.json`) and the icon from `REPACKSHOT_ICON`, compiles it with
`x86_64-w64-mingw32-windres` (or `WINDRES`) and links it. Without the tool or without an icon, a warning
and never a failure. `packaging/release.mjs` generates the icon from `docs/media/logo.svg`.

## Tests

`cargo test -p rt-app`: SHA-256 with NIST's vectors (`""`, `"abc"`, the 448-bit message,
the 896-bit one, a million `a`) and in chunks of odd sizes; the JSON reader (valid,
invalid, Unicode escapes and surrogates, numbers, depth); the HTTP reader (request
line, headers, bad requests); `Range`; file paths; the model store
(out-of-order and resumed chunks, wrong *hash* → damaged, shared *blob* kept when
deleting one of two models, imported manifests); the rule with the cases file; the
`reg` parsers (with “Access denied” lines in English and in Spanish among the keys),
of `Win32_VideoController` through PowerShell and through `wmic`, `/proc` and `nvidia-smi`; the
registry source with a fake `reg` that exits with 1 and with real programs that print and exit with 1
(never `/s`, never `Properties`); the merging of sources (the one that rules, exact VRAM against
32-bit, the removed card that the registry remembers, two identical cards, “no card” against
“could not ask”); the launcher's log lines; reading the output of a program that
exits with 1 (`process.rs`); the INI; the jobs (P3a): a live viewer shares
the threads with a final and keeps producing passes, the final gives the same bits with or without it, a view
that arrives late does not replace a new one, a job that nobody asks about stops, a render
that panics ends as failed and releases the turn, a job that does not stop is left behind, the
gate opens again after a cancelled or finished final with 4, 16 and 32 threads, windows that
left do not shut out a new one and a page reloaded 24 times keeps rendering; the page state (names, types,
atomic writing that leaves the old file if the body is cut off, damaged document set aside,
links inside the data folder, measurements) and the remembered port. `src/dialogs.rs`: the arguments of `zenity` and `kdialog`, reading their outputs and that of the
PowerShell script, that the page's words go as data, base64, one dialog at a time and
closing with the application (with a fake `zenity`). `src/files.rs`: safe and numbered names,
stable ids, what each grant allows, Downloads, the last project across start-ups.
`src/browser.rs`: the switches and the merging of profile preferences. `tests/files.rs`: the
file API over HTTP with a fake `zenity`. Outside the engine: `packaging/wine-dialogs.mjs`
(the `.exe` under Wine with a fake `powershell.exe`), `tools/desktop-window-check.mjs` (the real
launcher under Xvfb) and the PowerShell script parsed and its C# compiled with `pwsh` 7.
`src/ai/`: *inflate* with stored, fixed and dynamic blocks (made by hand according to the RFC and by
zlib), errors and limits; zip from Info-ZIP and from a stream with data descriptors (pinned in
`tests/fixtures/`), Zip64, hostile names and links; ImageMagick PNGs of each colour type,
depth, filter and Adam7 against PIL's pixels, CRC, truncations; base64 (RFC 4648); the rule
with the cases file; the progress lines as the *release* prints them; the job body;
capturing with a time limit (also with a grandchild that holds the outputs).
`tests/ai.rs`, with **`rt-fake-sd`** (a binary of this *crate*, never distributed, that speaks the
same command line and protocol as `sd-cli`/`sd-server`, records its arguments and its
jobs and, by tags in the *prompt* or `fake-sd.json`, hangs, crashes, runs slow, fails,
goes silent or returns another size): exact arguments and job per key and per ControlNet, reused
server, returned image checked, progress and cancellation with the model still loaded,
hung, time limit, crash on loading and on generating, failure, different size rejected,
rejections with their reason, the state, freeing on request, on inactivity and on closing, the one
left by an earlier start-up; and with the real `curl` against a local server: download, pause,
resume from the byte, installation, deletion, a different `sha256` that installs nothing and a
chosen file. `tests/ai_post.rs` (X3c), with the same fake (which in `gain` mode brightens
smoothly, like a model that does what it is asked): Intervention 0 bit for bit without starting the
engine (also with no engine installed), a render of two tiles with per-tile progress and the
fraction that does not go backwards, retries with the plan's exact strength and the engine's image at the
end, a tile of another size rejected at the first attempt, cancelling midway with the model still
loaded, `MODEL_UNSUPPORTED` and `NO_MODEL` with their reason, bad requests, the inline
preview, the relit floor with its colour check and the orphaned post that stops.
Ignored unless requested: the real zip of each build unpacked
(`RPX_SDCPP_ZIP`), the real Linux CPU build installed and answering `--version`,
`--list-devices` and `--help` (`RPX_SDCPP_LINUX_CPU_ZIP`), the real download from GitHub with pause
(`RPX_REAL_DOWNLOAD=1`), a real *img2img* with SD 1.5 on CPU (`RPX_SD15_WEIGHTS`) and the whole pipeline
with SD 1.5 and its depth ControlNet (`RPX_SD15_WEIGHTS` and `RPX_SD15_DEPTH`; 53 s on
four cores for 256 × 192 and 10 steps, accepted at the first attempt).
In `tests/`: the server over real sockets
(foreign `Host`, token, `Origin`, no CORS, *keep-alive*, files, models over HTTP, *pending
models*, `seq` and `share`, the diagnostics, an unread frame that releases its connection), the page state over HTTP (`tests/appdata.rs`: security, names that do not leave
their folder, links not followed, limits, a cut request, results with index, cache and
space used, and that everything is still there for another start-up), the stable port (`tests/port.rs`: the
same if free, another remembered one if taken, `--port` without remembering) and parity with `rt`,
also with a live viewer on 16 threads.

Updating (P5): `src/update/` (the URL allowlist with the usual hostile ones, the package names, the sums, the
names of what is replaced and of what is deleted on start-up, the swapping of files with a failure injected at each of its eight
steps, the cleanup that deletes nothing that does not belong to an update) and `tests/update.rs`, with the real `curl` and `tar` against a
local server standing in for GitHub: end to end the Linux portable (`.tar.gz`) and the Windows one (`.zip`) over a test
folder with a fake executable, which leave the new files, the `.old`, `data/` and `portable.txt` intact and start the new one with
`--after-update` and the earlier arguments, only when asked; a sum that does not match, one that is absent, a release without files, a
package that is not the application, that leaves its folder or carries a link: they change nothing; the installer started with `/S /LAUNCH`;
the allowlist over HTTP; a copy that is neither installed nor portable; progress, cancelling, a cut download that resumes.
`tests/installer.rs` reads `installer.nsi` as text. Outside the engine, `tools/update-install-check.mjs` (the real launcher with Chromium).

The own window (`src/platform/`): on all platforms, the GUIDs, our COM objects
(reference counting, `QueryInterface`, `Invoke`), the size of each WebView2 vtable against
the IDL's number of methods and the position of each method that is called, the protocol with the page
against `tests/fixtures/host-protocol.json` (the same one that `src/core/host-protocol.ts` passes), the
title, the window's place, the policy (settings, navigation, new windows, permissions,
dialogs) and the arguments. Windows only, and on Linux under Wine with a virtual display
(`CARGO_TARGET_X86_64_PC_WINDOWS_GNU_RUNNER=wine xvfb-run -a cargo test -p rt-app --target
x86_64-pc-windows-gnu --lib platform`): real DXGI (under Wine it lists its adapter, with
name and VRAM), our WebView2 environment options as the loader reads them, the loader that is
missing or is not a DLL, and the real Win32 window (system title bar, title, minimum size, closing asked and then
allowed, `window.json` saved and restored, a place outside the screens forgotten). WebView2 does not run here: what is left is
tested on Windows.
