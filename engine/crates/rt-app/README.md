# rt-app — el lanzador de escritorio `repackshot`

Binario de Rust **solo con `std`**, en el mismo *workspace* y con las mismas puertas que el motor
(`cargo fmt`, `clippy -D warnings`, ningún *crate* externo). **Sin `unsafe` salvo en
`src/platform/`** (`#![deny(unsafe_code)]` en el *crate*, `#[allow(unsafe_code)]` solo en ese
módulo; cada bloque dice por qué es correcto): la ventana propia de Windows llama a Win32 y a la
interfaz COM de WebView2 por FFI. Es la aplicación de escritorio (`docs/ARCHITECTURE.md` §5.5):

1. sirve la interfaz (el `dist/` de Vite, que se distribuye como `app/` junto al ejecutable) en
   `127.0.0.1`;
2. la abre en **su propia ventana** en Windows (Win32 con la barra de título del sistema y
   WebView2 dentro, `src/platform/`), o, si no puede, en una ventana de aplicación de Edge
   (Windows) o de un navegador de la familia Chromium (Linux), con perfil propio en la carpeta de
   datos;
3. renderiza con `rt-core` **en nativo**, con todos los hilos, los mismos píxeles que `rt` y que
   el pool de wasm;
4. guarda los modelos de IA en la carpeta de datos, por contenido, comprobados con un SHA-256
   propio, y **todo el estado de la página** (ajustes, biblioteca, historial de resultados, caché
   de miniaturas, lo que queda por descargar): en escritorio la página es solo la interfaz (P3e);
5. detecta el equipo y aplica la regla de recomendación de `src/data/ai-models.json`
   (`repackshot --hardware`, que lee el instalador);
6. muestra los **diálogos del sistema** (carpeta, abrir, guardar) y lee y escribe **solo** lo que la
   persona eligió en ellos (P3b): la ventana no usa nunca los selectores de archivos, las descargas
   ni los permisos del navegador;
7. descarga, comprueba, instala y **gobierna el motor de ejecución de la IA** (X3b,
   `src/ai/`): stable-diffusion.cpp como proceso aparte, nunca enlazado (abajo, *IA: el motor de
   ejecución*).

Lo que necesita del sistema lo pide a programas del sistema (`reg`, `powershell`, `wmic`,
`nvidia-smi`, `explorer`, `rundll32`, `xdg-open`, `zenity`, `kdialog`, `curl`, `tasklist`,
`taskkill`, `kill`, el navegador); por FFI, solo la ventana propia (`src/platform/`).

## Línea de órdenes

```text
repackshot [--port N] [--data-dir DIR] [--app-dir DIR] [--threads N] [--window webview2|browser|auto]
repackshot --serve-only [...]           sin ventana: escribe la URL con el token y sirve hasta que se pare
repackshot --hardware <f.ini> [--device gpu|cpu]   escribe el INI del instalador y sale
repackshot --shortcut-id <f.lnk>        Windows: escribe el AppUserModelID en un acceso directo a repackshot.exe y sale
repackshot --version | --help
```

En Windows la compilación *release* no tiene consola (`windows_subsystem = "windows"`): los
mensajes van a `<datos>/logs/repackshot.log` (rotado a `.log.1` al pasar de 1 MiB), y la salida
de `--version` o `--serve-only` solo se ve redirigida a un fichero.

## Carpetas

| Qué | Dónde |
| --- | --- |
| Interfaz | `<carpeta del ejecutable>/app/` (`--app-dir` la cambia) |
| Datos, instalado | `%LOCALAPPDATA%\Repackshot` (Windows); `$XDG_DATA_HOME/repackshot` o `~/.local/share/repackshot` (Linux) |
| Datos, **portable** | `data/` junto al ejecutable cuando existe `portable.txt` a su lado; todo va dentro (ajustes, biblioteca, resultados, modelos, perfiles de la ventana), así que viaja con la carpeta |
| Dentro de los datos | `settings.json`, `state/`, `library/`, `results/`, `cache/thumbs/` (estado de la página), `models/`, `ai/` (motores de ejecución de la IA y `sidecar.json`), `logs/`, `browser-profile/` (Edge/Chromium), `webview2/` (perfil de la ventana propia), `window.json` (dónde estaba la ventana propia), `launcher.json` (el puerto), `instance.json`, `pending-models.json` |

`--data-dir` manda sobre todo lo anterior.

## Ciclo de vida

- **Puerto estable por carpeta de datos** (P3e, `src/port.rs`): el lanzador apunta su puerto en
  `<datos>/launcher.json` (`{"port": N}`) y lo vuelve a usar en el siguiente arranque si está
  libre; solo si está ocupado toma otro libre, y lo apunta. Así el origen de la ventana
  (`http://127.0.0.1:<puerto>`) no cambia de un arranque a otro. `--port N` usa N y no apunta nada.

- **Instancia única**: `<datos>/instance.json` (`{port, token, pid}`, legible solo por su dueño
  en Unix). Un segundo arranque que encuentra una instancia viva (responde `/api/info` con su
  token) abre otra ventana contra ella y termina.
- **Ventana propia** (Windows, `src/platform/`): si junto al ejecutable está `WebView2Loader.dll`
  (de Microsoft, del paquete NuGet `Microsoft.Web.WebView2` fijado con su SHA-256 en
  `packaging/lib/webview2.mjs`) y `GetAvailableCoreWebView2BrowserVersionString` encuentra el
  *runtime* de WebView2, una ventana Win32 `WS_OVERLAPPEDWINDOW` con la barra de título del sistema,
  nuestro icono (`WM_SETICON` a los DPI del monitor), título `Repackshot — <proyecto>`, barra oscura
  con el tema oscuro (`DWMWA_USE_IMMERSIVE_DARK_MODE`, 20 y si no 19), AppUserModelID
  `Repackshot.App`, DPI por monitor v2, tamaño mínimo de 500 × 400 a 100 % y su sitio en
  `window.json` (no se usa si su barra de título ya no cae en ninguna pantalla). El instalador da
  a sus accesos directos el mismo AppUserModelID con `repackshot --shortcut-id <lnk>`
  (`IShellLinkW`, `IPropertyStore` con `PKEY_AppUserModel_ID`, `IPersistFile::Save`; solo
  accesos directos a `repackshot.exe`), para que el anclado y la ventana sean un solo botón de la
  barra de tareas. Los diálogos de archivo (`src/dialogs.rs`) se abren con esta ventana como
  dueña. Dentro, WebView2 con perfil en `webview2/` (con las `PROFILE_PREFERENCES` de abajo) y,
  como argumentos, las mismas `DISABLED_FEATURES` y `NO_THROTTLING_SWITCHES` de `src/browser.rs`
  que la ventana de aplicación (`src/platform/flags.rs`); todo lo que no es nuestra
  interfaz, apagado por la API (`src/platform/policy.rs`): menús contextuales, diálogos de script,
  atajos del navegador, barra de estado, zoom, pellizco, deslizar para volver, autorrelleno,
  contraseñas, SmartScreen, página de error propia y, en *release*, las herramientas de desarrollo.
  Navegación solo a nuestro origen (un enlace `https` pulsado se abre en el navegador por defecto
  con `ShellExecuteW`; nada abre otra ventana), descargas canceladas sin su panel, permisos
  denegados salvo escribir un archivo o carpeta que la persona eligió y el almacenamiento
  persistente, diálogos `alert`/`confirm`/`prompt` descartados. **Cerrar** (botón, `Alt F4`, barra
  de tareas, menú del sistema: todo acaba en `WM_CLOSE`) no cierra: manda `close-requested` a la
  página, que pregunta con su propia interfaz (la misma pregunta que Ctrl/⌘ W:
  `requestCloseWindow`) y contesta `close-ok`; si la página no está, no ha
  cargado o no late desde hace 20 s, se cierra sin preguntar. Si cualquier paso falla antes (o el
  proceso del navegador muere), se apunta en el registro y se abre la ventana de aplicación de
  abajo; `--window=browser` la fuerza y `--window=webview2` prohíbe el respaldo (falla). El
  protocolo con la página está en `src/platform/protocol.rs` y `tests/fixtures/host-protocol.json`.
- **Ventana de aplicación** (respaldo, y siempre en Linux): `REPACKSHOT_BROWSER`, si está; si no, en Windows Edge (`App Paths` de `msedge.exe`
  en HKCU y HKLM, después las rutas de instalación habituales) y luego Chrome; en Linux el primero
  de `chromium`, `chromium-browser`, `google-chrome`, `google-chrome-stable`, `microsoft-edge`,
  `microsoft-edge-stable`, `brave-browser` en el `PATH`. Argumentos: `--app=<url>
  --user-data-dir=<datos>/browser-profile`, los de *Ventana sin navegador* (abajo),
  `--window-size=1600,1000` (y `--class=Repackshot`, `--password-store=basic`, `--noerrdialogs`
  en Linux), más los tres `--disable-*-throttling/backgrounding` para que el latido no se frene
  con la ventana minimizada. Sin ninguno, el navegador por defecto (`cmd /C start "" "<url>"`,
  `xdg-open`).
- **Fin**: con la ventana propia, cuando se destruye. Con la de aplicación: cuando termina el proceso del navegador (si vivió más de 5 s: uno que sale antes ha
  pasado la ventana a un navegador ya abierto con el mismo perfil), o cuando el latido de la
  página (`POST /api/alive` cada 5 s, desde un *worker* para que no lo frene una pestaña oculta)
  calla 20 s (60 s de gracia al arrancar). Si el equipo se suspende, el plazo vuelve a empezar.

## Ventana sin navegador

Decisión del usuario tras probar v0.1.0: en escritorio no aparece nada que no sea la interfaz
propia. Tres capas, todas en `src/browser.rs` como constantes que un anfitrión WebView2 (P3c)
puede reutilizar tal cual (`AdditionalBrowserArguments`):

1. **`HARDENING_SWITCHES`**, interruptores documentados en las listas de Chromium
   (`chrome/common/chrome_switches.cc`, `content/public/common/content_switches.cc`; índice en
   <https://peter.sh/experiments/chromium-command-line-switches/>) y presentes en las cadenas de
   Chromium 141.0.7390.37: `--no-first-run`, `--no-default-browser-check`,
   `--hide-crash-restore-bubble` (sin *¿restaurar páginas?*), `--disable-sync`,
   `--disable-extensions`, `--disable-default-apps`, `--disable-component-update`,
   `--disable-background-networking`, `--disable-domain-reliability`, `--no-pings`,
   `--deny-permission-prompts` (los permisos se deniegan sin preguntar), `--disable-notifications`,
   `--disable-search-engine-choice-screen`, `--disable-infobars`, `--disable-pinch` (sin zoom con
   los dedos) y `--overscroll-history-navigation=0` (sin deslizar para ir atrás).
2. **`DISABLED_FEATURES`**, en un solo `--disable-features=` (un segundo sustituiría al primero):
   `Translate` (la burbuja de traducir; el interruptor `--disable-translate` ya no existe y Chromium
   remite a la directiva `TranslateEnabled`, <https://codereview.chromium.org/2819813002>),
   `TFLiteLanguageDetectionEnabled`, `AutofillServerCommunication`, `HardwareMediaKeyHandling`,
   `PrivacySandboxSettings4`, `LensOverlay`, `OptimizationHints` (nombres comprobados en las cadenas
   de Chromium 141) y, de Edge, `msWebOOUI` y `msPdfOOUI` (el minimenú al seleccionar texto,
   descrito para el modo quiosco en
   <https://learn.microsoft.com/en-us/answers/questions/1194213/how-to-hide-all-context-menu-running-edge-in-kiosk>).
   Un nombre desconocido se ignora, así que los de Edge no hacen nada en Chromium y al revés.
3. **`PROFILE_PREFERENCES`**, escritas en `<perfil>/Default/Preferences` antes de cada arranque
   (mezcladas con lo que haya; un fichero que no sea un objeto JSON no se toca):
   `translate.enabled`, `browser.enable_spellchecking`, `autofill.profile_enabled`,
   `autofill.credit_card_enabled`, `credentials_enable_service`, `credentials_enable_autosignin`,
   `signin.allowed`, `alternate_error_pages.enabled` a `false`, `profile.exit_type = "Normal"`,
   `browser.has_seen_welcome_page = true`, y de Edge `edge_quick_search.show_mini_menu`,
   `PDF_show_mini_menu` y `show_smart_actions` a `false` (el ajuste *Mostrar minimenú al
   seleccionar texto*; la clave, en
   <https://learn.microsoft.com/en-us/answers/questions/449c6c04-a6be-420c-a31d-ded8658decc6/prevent-context-menu-in-edge-when-text-is-selected>;
   la directiva equivalente es `QuickSearchShowMiniMenu`,
   <https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/quicksearchshowminimenu>,
   que no se usa porque las directivas son de todo el equipo y no se escriben sin administrador).

Además, en Linux, **`QUIET_ENV`**: `GOOGLE_API_KEY`, `GOOGLE_DEFAULT_CLIENT_ID` y
`GOOGLE_DEFAULT_CLIENT_SECRET` a `no` si no están, porque un Chromium sin claves (el de Arch, el de
Playwright) pone en cada ventana la barra *Google API keys are missing*; comprobado bajo Xvfb con
Chromium 141. Las directivas (`TranslateEnabled`, `QuickSearchShowMiniMenu`...) no se usan: en
Windows viven en `HKLM`/`HKCU\Software\Policies`, protegidas, y afectarían al Edge de la persona.

La página pone el resto (`src/ui/guards.ts`, en web y escritorio): `translate="no"` y `<meta
name="google" content="notranslate">`, favicon y manifiesto propios, sin menú contextual del
navegador fuera de los campos de texto, sin selección del cromo, sin los atajos del navegador
(imprimir, recargar, zoom, buscar, código fuente, descargas, historial, marcadores, ventanas,
pestañas, navegación con Alt + flechas y los botones laterales del ratón, F7, F11, F12 y Ctrl ⇧ I en
producción) y, en escritorio, Ctrl/⌘ W con la pregunta propia y los enlaces en el navegador del
sistema (`/api/open-url`).

Lo que solo quita una ventana propia (P3c, WebView2): el menú *⋯* de la barra de título de una
ventana `--app` de Edge o Chromium, y el diálogo *¿Salir?* de `beforeunload` al cerrar con la X.

## Seguridad

- Escucha solo en `127.0.0.1`.
- **`Host`**: toda petición debe traer `Host: 127.0.0.1:<puerto>` o `localhost:<puerto>`; si no,
  421. Así una página de otro dominio que se haya hecho resolver a 127.0.0.1 (*DNS rebinding*) no
  lee nada.
- **Token**: 128 bits aleatorios por arranque (de `/dev/urandom` en Unix; en Windows, de los
  `RandomState` de `std`, cuyas claves SipHash salen del generador del sistema, mezcladas con la
  hora y el pid). Todo `/api/*` exige la cabecera `X-Repackshot-Token` con él (401 si falta o no
  coincide; comparación en tiempo constante). Una cabecera propia no se puede mandar desde otro
  origen sin *preflight* CORS, y este servidor **no envía ninguna cabecera CORS**.
- **`Origin`**: un `/api/*` con un `Origin` que no sea `http://127.0.0.1:<puerto>` o
  `http://localhost:<puerto>` se rechaza (403).
- El token viaja a la página en el **fragmento** de la URL de la ventana
  (`http://127.0.0.1:<puerto>/#token=<hex>`), que el navegador nunca manda al servidor ni pone en
  `Referer`; la página lo guarda en `sessionStorage` y lo quita de la barra de direcciones
  (`src/io/native.ts`). No aparece en ningún registro.
- **Ficheros elegidos** (`src/files.rs`): la página nunca nombra una ruta que el lanzador lea o
  escriba. Cada ruta que toca la API de ficheros la eligió la persona en un diálogo del sistema
  **en este arranque**, y queda como una *concesión*: un id (`d…` carpeta, `f…` fichero: 24
  hexadecimales del SHA-256 de la ruta, así la misma carpeta elegida otra vez tiene el mismo id) y
  lo que permite. Una carpeta de `dialog/folder`: crear ficheros **nuevos** dentro (nunca
  sobrescribe: `nombre (2).png`) y, si se pidió `read` (una importación), listar y leer lo que
  cuelga de ella (sin seguir enlaces simbólicos). Un fichero de `dialog/open`: leerlo; escribirlo
  solo si se pidió `writable` (un proyecto que se vuelve a guardar). Un fichero de `dialog/save`:
  escribirlo entero (a un temporal al lado y renombrado encima: un guardado fallido no deja medio
  fichero). Solo se escriben extensiones que produce la aplicación (`png`, `jpg`, `jpeg`, `exr`,
  `json`, `rsb`, `mp4`, `webm`): nada ejecutable cae en ninguna parte; los nombres se hacen válidos
  en todos los sistemas (`\ / : * ? " < > |` y controles a `_`, sin puntos ni espacios finales, los
  nombres de dispositivo de Windows con `_` delante, 200 bytes como mucho). Dos entradas son del
  propio lanzador, no de la página: `downloads` (la carpeta Descargas del sistema, solo ficheros
  nuevos: el *Descargas* de la ventana de render) y el último proyecto, que el lanzador recuerda
  en `<datos>/last-project.json` cuando la página se lo pide para un `.repack.json` concedido
  (*General ▸ Al iniciar ▸ Último proyecto*). Lo que la página manda a un diálogo (título, nombre,
  filtros, carpeta inicial) es solo texto para el diálogo: no concede nada. `/api/open-url` abre
  solo direcciones `https://` sin comillas, espacios ni metacaracteres, con `rundll32
  url.dll,FileProtocolHandler` (sin `cmd`) o `xdg-open`.
- Ficheros estáticos: la ruta tiene que ser absoluta, sin NUL, `\`, `:`, segmentos vacíos, `.` ni
  `..`, y la ruta canónica del fichero tiene que seguir dentro de la carpeta canónica (también
  frena enlaces simbólicos que salgan). En `/api/*` cualquier segmento vacío, `.` o `..` es 400.
- Cabeceras siempre: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  `X-Frame-Options: DENY`, `Cross-Origin-Resource-Policy: same-origin`; `Cache-Control: no-store`
  en la API y `no-cache` en el HTML (los `assets/` de Vite, con *hash*, son inmutables).
- HTTP/1.1 con *keep-alive*, un hilo por conexión (máximo 64), cuerpos con `Content-Length`
  (los `chunked` de petición dan 501), cabeceras hasta 32 KiB, `Expect: 100-continue` atendido.

## Diálogos

Uno abierto a la vez (otro da 409 `dialog-open`); se cierran con la aplicación. Lo que la página
manda (título, nombre propuesto, filtros, carpeta inicial) llega al programa del diálogo como
datos, nunca como código.

- **Windows**: Windows PowerShell (`%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`)
  con `-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -STA -EncodedCommand <guion>` y sin
  ventana de consola (`CREATE_NO_WINDOW`). El guion (`POWERSHELL_SCRIPT` en `src/dialogs.rs`) lee
  las entradas de variables `RPX_*` y usa `System.Windows.Forms`: `OpenFileDialog` y
  `SaveFileDialog` (que .NET muestra con el diálogo moderno de Vista), y para carpetas el
  `IFileOpenDialog` de Vista en modo `FOS_PICKFOLDERS`, compilado una vez por `Add-Type` y guardado
  en `<datos>/cache/folder-picker-<v>.dll`; si eso no se puede (un equipo en modo de lenguaje
  restringido), el truco de la carpeta del `OpenFileDialog`. El dueño del diálogo es la ventana de
  la aplicación cuando el lanzador conoce su `HWND` (`Dialogs::set_owner_window`, para el
  anfitrión propio de P3c) o un formulario oculto *siempre encima*, así sale delante de la
  ventana. Las rutas vuelven como `PATH <base64 de UTF-8>`, sea cual sea la página de códigos de
  la consola.
- **Linux**: `zenity` (`--file-selection`, `--directory`, `--save --confirm-overwrite`,
  `--multiple`, `--file-filter`), si no `kdialog` (`--getexistingdirectory`, `--getopenfilename`,
  `--getsavefilename`), si no 501 `no-dialog` y la interfaz pide instalar uno de los dos.

## API

Todas las rutas `/api/*` llevan `X-Repackshot-Token`. Errores en JSON:
`{"error": "<código>", "message": "<texto>"}`.

### Aplicación

| Petición | Respuesta |
| --- | --- |
| `GET /api/info` | `{app:"repackshot", version, engineVersion, threads, isa, simd[], os, arch, dataDir, modelsDir, logsDir, resultsDir, portable, browser, window, pid}`. `window`: `{kind: "webview2"\|"browser"\|"default"\|"none", detail, reason}` (`detail`: la versión de WebView2 o el navegador; `reason`, por qué no es la ventana propia: `forced`, `not-windows`, `loader-missing`, `runtime-missing`, `failed`), `null` con `--serve-only` |
| `POST /api/alive` | 204. El latido. |
| `GET /api/hardware[?device=gpu\|cpu][&refresh=1]` | `{cpu, cores, threads, ramBytes, ramGiB, ramUsableBytes, gpus[{name, vendor, vramBytes, vramGiB}], device, gpuFound, detected, input, recommendation{rowId, recommended, offered[], skipped[]} \| null}` |
| `POST /api/open-folder` | Cuerpo `{"folder":"data\|models\|logs\|results"}` o `{"path":"<dentro de la carpeta de datos>"}`; 204, 403 fuera de los datos |
| `GET /api/pending-models` | Lo que eligió el instalador, normalizado: `{"device":"gpu\|cpu","keys":[...]}`, o `null` |
| `DELETE /api/pending-models` | 204: consumido |

### Diálogos y ficheros elegidos

Cada concesión es `{id, name, path, folder, read, write, size}`. Una respuesta de diálogo es
`{"cancelled": true}` o `{"cancelled": false, "file": <la primera>, "files": [...]}`.

| Petición | Respuesta |
| --- | --- |
| `POST /api/dialog/folder` | Cuerpo `{title, start?, read?, write?, folderItem?}`: una carpeta; `write` (por defecto) permite crear ficheros nuevos, `read` listarla y leerla. `start` es un id o una carpeta que exista (solo una pista) |
| `POST /api/dialog/open` | Cuerpo `{title, multiple?, filters?, start?, writable?}`; `filters` es `[{name, extensions:["png","repack.json","*"]}]` (extensiones validadas, 400 si no) |
| `POST /api/dialog/save` | Cuerpo `{title, defaultName, filters?, start?}`; el diálogo pregunta antes de sustituir. 422 `extension` si la persona escribe una extensión que la aplicación no escribe |
| `PUT /api/files?dir=<id>&name=<nombre>` | Cuerpo: los bytes. Un fichero **nuevo** en la carpeta `<id>` (o `downloads`): `nombre`, o `nombre (2)`...; 201 con su concesión (que se puede mostrar, no leer ni escribir). 404 `not-granted`, 403 sin permiso o extensión no admitida, 400 `bad-name`, 507 sin espacio |
| `PUT /api/files/<id>` | Escribe el fichero entero (temporal y renombrado); 403 si no es escribible |
| `GET` / `HEAD /api/files/<id>` | El fichero, con `Range` (para importaciones de muchos GB) |
| `GET /api/files/<id>/info` | La concesión, más `hashing{done,total}` mientras se calcula su SHA-256 |
| `POST /api/files/<id>/sha256` | `{sha256, bytes}`, calculado en *streaming* con el SHA-256 propio (modelos de IA importados) |
| `GET /api/files/<id>/list` | `{files:[{id, name, rel, size}]}`: lo que cuelga de una carpeta legible (8 niveles, 4096 ficheros, sin enlaces) |
| `POST /api/files/<id>/reveal` | 204: la carpeta, o el fichero seleccionado (`explorer /select,`), en el gestor de archivos; 410 si ya no está |
| `GET /api/projects/last` | La concesión del último proyecto (lectura y escritura) o `null` |
| `PUT /api/projects/last` | Cuerpo `{id}` de un `.repack.json` concedido; 204 |
| `POST /api/open-url` | Cuerpo `{url}`, solo `https://`; 204 |

`GET /api/info` lleva `filesApi: 1` cuando el lanzador tiene esta API.

### Motor nativo

| Petición | Respuesta |
| --- | --- |
| `POST /api/render?kind=viewport\|final[&finish=samples\|time\|first][&mesh=<clave>][&client=<id>]` | Cuerpo: el RSB. `{id, width, height, maxSamples, threads, isa}`. 400 `bad-scene` si el RSB no vale; 409 `need-meshes` si es una actualización sin `MESH` y esas mallas no están cargadas (la página manda entonces la escena entera); 503 `busy` con más de 8 ventanas |
| `GET /api/render/<id>[?after=<n>][&data=0]` | Una **trama**: cabecera binaria y, si hay una pasada nueva, las sumas. Con `after=n` espera hasta 1 s a una pasada posterior a `n` (o al final). `data=0`: solo la cabecera (progreso). 404 si el trabajo no existe o fue sustituido o cancelado |
| `DELETE /api/render/<id>` | 204: cancelado |

Trabajos: muestras y tiempo máximos del `RNDR` del RSB (0 muestras = 16, como `rt`). `finish` dice
cuándo para, como *Terminar por* de la ventana de render (`src/render/schedule.ts`): `samples` (las
muestras; el tiempo no cuenta), `time` (el tiempo, sin límite de muestras) o `first` (lo que llegue
antes); sin él, `first` si hay tiempo y `samples` si no. La regla de parada es la de `runPasses`:
solo entre pasadas, así que todos los píxeles tienen las mismas muestras, y con tiempo no empieza
una pasada de la que no quepa la mitad (acaba a menos de media pasada del límite). El reloj de un
trabajo empieza cuando empieza a renderizar: un final que espera en la cola no gasta su tiempo. Un trabajo
`final` tiene prioridad: los de visor se paran entre baldosas mientras uno corre (bandera
*en pausa*), y los finales van de uno en uno por orden de llegada. Un trabajo de visor nuevo de
un `client` sustituye al anterior de ese `client`; si el RSB no trae `MESH` y `mesh` coincide con
el del trabajo anterior, se conservan sus mallas y sus BVH (`Scene::update_from_rsb`). Un `final`
siempre lleva sus mallas. Los dos últimos finales terminados se guardan para recogerlos; la
página los borra al leerlos.

**Trama** (little-endian, 48 bytes de cabecera):

| Byte | Campo |
| --- | --- |
| 0 | `"RPX1"` |
| 4 | `u32` longitud de la cabecera (48) |
| 8 | `u32` pasadas completadas (0: todavía ninguna) |
| 12 | `u32` muestras por píxel en las sumas |
| 16, 20 | `u32` ancho, alto |
| 24 | `f32` segundos desde que empezó (hasta que terminó) |
| 28 | `u32` banderas: 1 terminado, 2 cancelado, 4 fallido, 8 en pausa por un final, 16 lleva datos |
| 32 | `u32` muestras pedidas (0: las que quepan en el tiempo) |
| 36 | `u32` hilos |
| 40 | `u64` rayos lanzados |
| 48 | con la bandera 16: `ancho × alto × 4` `f32`, por píxel la **suma** de radiancia premultiplicada (RGB) y de cobertura (A) de todas las muestras |

Son las mismas sumas que acumula el `Accumulator` de `src/render/tiles.ts`, así que la página
reutiliza tal cual su camino de visualización y su conversión exacta a 8 bits.

**Paridad.** El renderizado es el de `rt` (`rt_cli::render_progressive`): baldosas de 32 píxeles
de `tile_grid`, una película por baldosa, pasadas de 1, 2, 4, 8 y luego 16 índices de muestra,
baldosas repartidas por un contador atómico y las muestras de cada baldosa sumadas en orden de
índice en `f32`. Como `rt-core` saca sus números aleatorios solo de (semilla, píxel, índice de
muestra), la película es la misma, bit a bit, que la de `rt` y la del pool de wasm, con
cualquier número de hilos. `tests/parity.rs` lo comprueba: el ejemplo a 4 muestras por la API
(con 1 y 4 hilos) da la película de `rt_cli::render` y el *hash* fijado `PINNED_EXAMPLE_4SPP`
de `rt-core`, el mismo que reproduce el wasm (E4); una actualización de visor sin mallas da la
película de la escena completa.

### Estado de la página

En escritorio la página es solo la interfaz (fase P3e): **todo lo que guarda lo escribe el
lanzador** en la carpeta de datos, nunca el almacenamiento del navegador de la ventana (que además
no duraría: cada arranque escucha en otro puerto, y otro puerto es otro origen, con el
almacenamiento vacío). El cliente es `src/io/native-store.ts`; la costura, `src/io/platform.ts`.

```text
<datos>/settings.json              el documento de ajustes ({schema, settings, layout} de src/core/settings.ts)
<datos>/state/<nombre>.json        documentos pequeños (descargas por reanudar, la marca de la migración...)
<datos>/library/library.json       la biblioteca propia (U4)
<datos>/results/index.json         el historial: {"version": 1, "results": [{id, file, type, display, ai, aiType, meta}]}
<datos>/results/<id>.<ext>         el archivo de un resultado tal cual (png, jpg, exr, webp, tif)
<datos>/results/<id>.display.png   su imagen para el visor, cuando la página no puede mostrar el archivo (EXR)
<datos>/results/<id>.ai.<ext>      la imagen que hizo el post-procesado IA, cuando el resultado pasó por él (fase X4), en su tipo
<datos>/cache/thumbs/<clave>.txt   las esferas de materiales (data URL): caché, se libera cuando se quiera
```

- **Escrituras atómicas**: a un temporal junto al destino, `sync_all`, y `rename` encima; un corte
  o un cierre deja el archivo viejo o el nuevo, nunca medio. Un cuerpo más corto de lo anunciado
  es 400 `short-body` y no toca nada.
- **Nombres**: `[a-z0-9._-]`, en minúscula (dos nombres nunca chocan en un disco que no distingue
  mayúsculas), de 1 a 96 caracteres, sin empezar ni acabar en punto, sin `..` y nunca un nombre de
  dispositivo de Windows (`con`, `nul`, `com1`...): si no, 400 `bad-name`.
- **Confinamiento**: cada ruta es la carpeta de datos más carpetas fijas y un nombre así; cada
  carpeta del camino tiene que ser una carpeta de verdad, no un enlace, y el archivo tampoco puede
  ser un enlace (403 `outside`).
- Un documento que no es JSON (editado a mano, un fallo del disco) se aparta como
  `<nombre>.corrupt` y se lee como ninguno: la página arranca con los valores de fábrica.

| Petición | Respuesta |
| --- | --- |
| `GET /api/store/settings` | El documento tal cual se guardó, o `null` |
| `PUT /api/store/settings` | Cuerpo: un objeto JSON (1 MiB como mucho). 204 |
| `DELETE /api/store/settings` | 204 |
| `GET /api/store/docs` | `{"<nombre>": <valor>, ...}`: todos los documentos pequeños |
| `GET` / `PUT` / `DELETE /api/store/docs/<nombre>` | Uno (`null` si no está); `PUT` admite cualquier valor JSON de 1 MiB como mucho |
| `GET` / `PUT` / `DELETE /api/store/library` | La biblioteca: un objeto JSON de 64 MiB como mucho |
| `GET /api/store/results` | `{"results": [meta...]}`, en el orden en que llegaron; un resultado cuyo archivo se borró a mano no aparece |
| `PUT /api/store/results/<id>?type=<tipo>` | Cuerpo: el archivo (4 GiB como mucho, escrito por trozos al disco). `image/png`, `image/jpeg`, `image/x-exr`, `image/webp` o `image/tiff`; otro tipo, 415 |
| `PUT /api/store/results/<id>/display` | Cuerpo: la imagen PNG para el visor (512 MiB como mucho) |
| `PUT /api/store/results/<id>/ai?type=<tipo>` | Cuerpo: la imagen que hizo el post-procesado IA (X4), con los mismos tipos y límite que el archivo; otra vez en otro tipo deja un solo archivo. Entra en el registro con `PUT .../meta` si ya está |
| `PUT /api/store/results/<id>/meta` | Cuerpo: el registro (`ResultMeta`, objeto con `id` igual al de la ruta, si no 400 `id-mismatch`). Entra en el índice solo si su archivo ya está (409 `no-file`) |
| `GET` / `HEAD /api/store/results/<id>[/display\|/ai]` | El archivo, su imagen o la imagen de la IA, con su tipo y `Range`; 404 si no está |
| `DELETE /api/store/results/<id>` | 204: el registro y sus archivos |
| `DELETE /api/store/results` | `{"deleted": n}`: el índice y lo que escribió el almacén en `results/` (un archivo que puso la persona se queda) |
| `GET /api/store/cache/<clave>` | La miniatura (`text/plain`), o 204 si no está (lo normal, no un error) |
| `PUT /api/store/cache/<clave>` | Cuerpo: texto UTF-8 de 1 MiB como mucho. 204 |
| `DELETE /api/store/cache` | `{"freed": bytes}`: borra las miniaturas (no otras cachés de `cache/`) |
| `GET /api/storage/usage` | `{dataDir, total, files, folders: [{id, path, bytes, files}]}` con `id` `models`, `results`, `library`, `thumbs`, `logs`, `window` (el perfil de la ventana: `browser-profile/` y `webview2/`) y `other` (el resto: ajustes, `state/`...). Se mide recorriendo las carpetas sin seguir enlaces |

**Migración, una vez.** Si la carpeta de datos no tiene `state/migration.json`, la página copia
lo que una versión anterior dejó en el almacenamiento del navegador de su origen (ajustes, también
las preferencias sueltas de antes; biblioteca; cada `repackshot.*` salvo las miniaturas; el
historial de IndexedDB, resultado a resultado), solo lo que el lanzador no tenga ya, y escribe la
marca con lo copiado y lo que falló. Después no vuelve a mirar el almacenamiento del navegador. La
copia del navegador se deja como estaba.

**Solo para pruebas**: `REPACKSHOT_TEST_GPUS="nombre|fabricante|bytes;..."` sustituye las tarjetas
gráficas detectadas (la comprobación de interfaz de P3e en un equipo sin tarjeta).

### Modelos de IA

Almacén **por contenido**: un fichero que comparten varios modelos (el codificador Qwen3-4B de
cuatro claves, el VAE de Z-Image de tres) se guarda y se descarga una vez.

```text
<datos>/models/blobs/<sha256>             fichero completo, comprobado contra su nombre
<datos>/models/blobs/<sha256>.part        fichero a medio descargar
<datos>/models/blobs/<sha256>.part.json   {"total", "ranges": [[ini, fin), ...], "damaged", "actual"}
<datos>/models/installed.json             {"installed": [claves]}
<datos>/models/imported/<clave>.json      manifiesto de un modelo importado
```

La versión web replica la misma disposición en OPFS.

| Petición | Respuesta |
| --- | --- |
| `GET /api/models` | `{dir, installed[], models[{key, source:"catalogue"\|"imported", installed, state:"missing"\|"partial"\|"complete", totalBytes, presentBytes, files[{name, role, sha256, bytes, state, written?, contiguous?, damaged?, checking?}], manifest?}]}` para cada clave del catálogo y cada importada |
| `PUT /api/models/blobs/<sha256>?offset=<n>[&total=<n>]` | Cuerpo: un trozo. Se escribe en su sitio del `.part` sin cargarlo entero en memoria (tamaños de decenas de GB); los trozos pueden llegar desordenados y por varias conexiones. Responde el estado del *blob*. 409 `damaged` o `checking`; 409 `conflict` si `total` cambia; 416 si el trozo se sale; 507 sin espacio. Un trozo cortado deja escrito lo que llegó |
| `GET /api/models/blobs/<sha256>/status` | `{sha256, state, contiguous, written, total?, ready?, damaged?, actual?, checking?{done, total}}`; `contiguous` son los bytes escritos sin hueco desde 0: **desde ahí se reanuda** |
| `POST /api/models/blobs/<sha256>/finish[?bytes=<n>]` | Calcula el SHA-256 (propio, en streaming) y, si coincide con el nombre, renombra el `.part` a su nombre final: 200 `{sha256, state:"complete", bytes}`. Si no coincide: 422 `sha256-mismatch` con `actual`, y el `.part` queda **dañado** hasta que se borre. 409 `incomplete` con `contiguous` si faltan bytes |
| `GET` / `HEAD /api/models/blobs/<sha256>` | El fichero completo, con `Range` (un rango: 206; fuera: 416). 404 si no está completo |
| `DELETE /api/models/blobs/<sha256>` | Borra el *blob* o su parte; 409 si lo usa un modelo instalado |
| `PUT /api/models/imported/<clave>` | Cuerpo: el manifiesto (objeto con `files[{name, role, bytes, sha256}]` y lo que quiera la interfaz: licencia, arquitectura...). 409 si la clave es del catálogo |
| `GET /api/models/imported/<clave>` | El manifiesto guardado |
| `POST /api/models/installed` | Cuerpo `{"key": ...}`: lo apunta en `installed.json` si todos sus *blobs* están completos (409 `missing` con los ficheros que faltan) |
| `DELETE /api/models/<clave>[?keep=A,B]` | Lo quita de `installed.json` (y su manifiesto si era importado) y borra **solo** los *blobs* que no usa ningún otro modelo instalado ni los de `keep` (descargas en curso). `{deleted:[sha256...]}` |

Validación: `<sha256>` exactamente 64 hexadecimales en minúscula; claves y nombres de fichero
`[A-Za-z0-9._-]`, de 1 a 128 caracteres, sin empezar por punto y sin `..`.

## Equipo y recomendación

`repackshot --hardware <f.ini> [--device gpu|cpu]` y `GET /api/hardware`:

- **Windows**: adaptadores de
  `HKLM\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}` con
  `reg query /s` (`DriverDesc`, `ProviderName`, VRAM dedicada de
  `HardwareInformation.qwMemorySize`, si no `HardwareInformation.MemorySize`); RAM instalada y
  utilizable y núcleos con PowerShell `Get-CimInstance` (20 s como mucho), si no `wmic`; nombre de
  la CPU del registro. Todo sin ventana de consola (`CREATE_NO_WINDOW`).
- **Linux**: `/proc/cpuinfo`, `/proc/meminfo`, bloques de `/sys/devices/system/memory` (la RAM
  instalada: un equipo de "16 GB" muestra unos 15,6 GiB utilizables), `nvidia-smi` si está,
  `mem_info_vram_total` de las tarjetas DRM (AMD).
- **Memoria efectiva**: la memoria se informa por debajo de su tamaño comercial (un equipo de
  "16 GB" muestra de 15,6 a 15,9 GiB utilizables; una tarjeta de "12 GB" puede leer 11,99 GiB), y la
  tabla habla en tamaños comerciales. Por eso la regla compara con la tabla los **GiB efectivos =
  GiB medidos / 0,94**, en RAM y en VRAM (no en los búferes del navegador): constante
  `MEMORY_REPORTING_FACTOR`, con el mismo nombre en `recommend.rs` y en
  `src/core/ai-recommend.ts`. Se sigue prefiriendo la RAM instalada cuando se puede leer. El INI y
  `/api/hardware` dan lo medido; la regla aplica el factor.
- **Dispositivo**: GPU si hay una con ≥ 4 GiB efectivos de VRAM dedicada; si no, CPU; `--device`
  manda.
- **Regla**: la de `docs/AI-POST.md` §2.4 sobre la tabla de `src/data/ai-models.json`, incluido en
  el binario al compilar: primera fila que encaja, mínimo incluido y máximo excluido, modelos no
  disponibles saltados (la recomendación pasa al primer ofrecido disponible), detección fallida →
  sin recomendación. La misma que `src/core/ai-recommend.ts`; las dos pasan
  `tests/fixtures/ai-recommend-cases.json`.

El INI va en **UTF-16LE con BOM** (lo que leen como Unicode las funciones de INI de Windows y
`ReadINIStr` de NSIS), con líneas CRLF:

```ini
[hardware]
cpu=…  cores=…  threads=…  ram_gib=16.0  gpu=…  vram_gib=12.0  gpu_found=1  detected=1
[recommendation]
device=gpu  row=gpu-12  key=ZIMAGE_Q8  offered=KLEIN4B_Q4
[models]
count=7
[model0]
key=ZIMAGE_Q8  label_en=…  label_es=…  summary_en=…  summary_es=…  size_gib=8.8
licence=Apache-2.0  commercial=1  restrictions=0  available=1  desktop=1  recommended=1  offered=0
```

(una clave por línea; aquí agrupadas para leerlas). `size_gib` son GiB con un decimal (lo que
Windows muestra como "GB").

## IA: el motor de ejecución (X3b)

`docs/AI-POST.md` §7.1. **stable-diffusion.cpp** (MIT, sobre ggml, MIT) en sus compilaciones
oficiales, fijadas en `src/data/ai-runtimes.json` (incluido en el binario al compilar, como
`ai-models.json`): *release* `master-959-d637cfb`, una **Vulkan** y una **CPU** para Windows y
para Linux x86_64 (la CPU trae todas las variantes de x86-64 de ggml y carga la mejor, AVX2 o
superior si la hay). Un proceso aparte que el lanzador descarga, arranca, alimenta y para; nada
de él se enlaza ni se copia en `engine/`.

```text
<datos>/ai/runtimes/<sha256>.zip.part     el archivo bajando (se reanuda desde su longitud)
<datos>/ai/runtimes/<sha256>.tmp/         descomprimiéndose (un arranque que lo encuentra lo borra)
<datos>/ai/runtimes/<sha256>/             instalado: lo del zip, repackshot-runtime.json, repackshot-probe.json
<datos>/ai/sidecar.json                   {pid, server} del sd-server en marcha
```

- **Regla de elección** (la misma que `src/core/ai-runtimes.ts`; las dos pasan
  `tests/fixtures/ai-runtime-cases.json`): filas `choice` de arriba abajo, gana la primera cuya
  `force` sea la forzada (`null`: nada forzado) y, si tiene `gpu`, cuyo valor sea si el informe
  del equipo tiene GPU que usar (el `device` de `/api/hardware`: una GPU con ≥ 4 GiB efectivos;
  una detección fallida es «sin GPU»; `device=cpu` en la petición, la CPU elegida en *Ajustes*,
  también). Con la fila y el sistema (`os`, `arch`) sale la compilación; sin compilación para el
  sistema, la fila y ninguna clave.
- **Descarga**: la página no puede: las descargas de *releases* de GitHub (y
  `release-assets.githubusercontent.com`, adonde redirigen) no mandan
  `Access-Control-Allow-Origin`, así que un `fetch` desde `http://127.0.0.1:<puerto>` no puede
  leerlas. La hace el lanzador con el `curl` del sistema (`%SystemRoot%\System32\curl.exe`
  desde Windows 10 1803, nunca uno del `PATH` en Windows; el primero del `PATH` en Linux):
  `--fail --location --max-redirs 5 --proto =https --proto-redir =https --connect-timeout 30
  --speed-limit 1024 --speed-time 60 [--continue-at <bytes>] --url <url>`, con la salida por su
  salida estándar, que el lanzador añade al `.part` (ninguna ruta pasa a `curl`). Pausar es parar
  `curl`; reanudar, `--continue-at` con lo que haya (un servidor que no reanuda, código 33, hace
  empezar de 0 una vez). Cortes, conexiones fallidas y lentitud (códigos 7, 18, 28, 52, 55, 56,
  92) se reintentan dos veces, a los 2 y 5 s, desde donde se quedó. Sin `curl`, la fila lo dice e
  **Instalar desde un archivo…** instala uno descargado con un navegador. La URL sale siempre del
  catálogo incluido en el binario, nunca de la página.
- **Instalación**: SHA-256 propio del archivo entero; si no es el fijado, se borra y **no se
  instala nada** (el error lo dice con los dos valores). Se descomprime con `src/ai/zip.rs` e
  `src/ai/inflate.rs` (APPNOTE 6.3 y RFC 1951 desde las especificaciones; CRC-32 de cada entrada,
  límites de entradas y tamaños, nombres solo `[A-Za-z0-9._+-]` por componente, sin `..`,
  absolutas, barras invertidas, letras de unidad ni enlaces simbólicos, ficheros que no existían),
  los ejecutables con `0755` en Unix, en `<sha256>.tmp/`, que se renombra entero; se exige que
  estén `sd-server` y `sd-cli`, y se les pregunta `--version` y `--list-devices` (60 s como
  mucho; un Windows sin el entorno de Visual C++ sale con `0xC0000135` y la fila lo nombra).
- **El servidor**: `sd-server <argumentos de la familia> --listen-ip 127.a.b.c --listen-port
  <libre>` con el directorio del motor como directorio de trabajo, la entrada cerrada, las dos
  salidas leídas y `CREATE_NO_WINDOW`. `sd-server` refleja cualquier `Origin` en
  `Access-Control-Allow-Origin` y numera sus trabajos en orden, así que escucha en una dirección
  de bucle local **aleatoria** (todo `127/8` es bucle local en Linux y en Windows; nunca
  `127.0.0.1`) y un puerto libre: unas 2^40 combinaciones que una página ajena tendría que
  probar, además del permiso de acceso a la red local de los navegadores. Listo cuando
  `GET /sdcpp/v1/capabilities` responde (escucha solo tras cargar el modelo). Se mantiene
  cargado entre llamadas con los mismos argumentos; otro modelo, otra compilación u otro
  ControlNet lo reinician. Se para: si termina solo (el error dice cómo y sus últimas líneas), si
  no dice nada ni cambia de estado durante `silence` (10 min), si cargar pasa de `load` (30 min)
  o una imagen de `run` (60 min), si se cancela y no obedece en 15 s, a los `idle` (5 min) sin
  uso, con `DELETE /api/ai/sidecar` y al cerrar la aplicación; un arranque que encuentra en
  `sidecar.json` un proceso vivo que es nuestro `sd-server` (`/proc/<pid>/exe`, `tasklist`) lo
  para (`kill -9`, `taskkill /F`). Límites de partida: los mide X1 parte B.
- **Protocolo** (`examples/server/api.md` de la *release*): `POST /sdcpp/v1/img_gen` con
  `{prompt, negative_prompt, width, height, strength, seed, batch_count: 1, init_image,
  ref_images, control_image, control_strength, sample_params: {sample_steps, guidance:
  {txt_cfg}, sample_method?, flow_shift?}, embed_image_metadata: false, output_format: "png",
  preview: "none"}` (imágenes en base64) → `202 {id}`; `GET /sdcpp/v1/jobs/<id>` cada 150 ms
  hasta `completed` (la imagen en `result.images[0].b64_json`), `failed` o `cancelled`;
  `POST /sdcpp/v1/jobs/<id>/cancel`. **Progreso**: lo que los dos programas escriben en la
  salida estándar, `|=====>   | 3/8 - 1.23s/it` por paso de muestreo y la misma barra de `#` al
  leer pesos (stable-diffusion.cpp los carga en el primer uso, así que el primer trabajo
  también muestra *Cargando*). La imagen vuelta se decodifica (`src/ai/png.rs`) y **se rechaza
  si su tamaño no es el pedido**.

**Argumentos por familia** (`profiles` del JSON; `@rol` es la ruta del fichero del modelo con ese
papel en el almacén, `@rol~texto` el que además lo lleva en el nombre):

| Clave | Familia | Carga (`sd-server …`) | Por trabajo |
| --- | --- | --- | --- |
| `ZIMAGE_Q8`, `ZIMAGE_Q4`, `ZIMAGE_Q2` | `z-image` | `--diffusion-model @transformer --llm @text-encoder --vae @vae --diffusion-fa` | 8 pasos, cfg 1, `init_image` + `strength` |
| `KLEIN4B_Q4` | `flux2-klein` | `--diffusion-model @transformer --llm @text-encoder --vae @vae --diffusion-fa` | 4 pasos, cfg 1, `euler`, `init_image` + `strength` y la misma imagen en `ref_images` |
| `QWENEDIT_Q4` | `qwen-image-edit` | `--diffusion-model @transformer --llm @text-encoder --llm_vision @mmproj --vae @vae --diffusion-fa --model-args qwen_image_zero_cond_t=true` | 20 pasos, cfg 2,5, `euler`, `flow_shift` 3, `init_image` + `strength` + `ref_images` |
| `SD15_LIGHT` | `sd15` | `-m @transformer` [`--control-net @controlnet~tile` o `@controlnet~depth`] | 20 pasos, cfg 7, `init_image` + `strength` [+ `control_image`, `control_strength` 0,9] |

Sacados de `docs/z_image.md`, `docs/flux2.md`, `docs/qwen_image_edit.md`, `docs/sd.md` y el
`README` del *tag*; `init+ref` en las de edición es nuestro (el *img2img* genérico más su
referencia). `supports` dice qué claves carga cada compilación según eso; `verified: []` hasta que
X1 parte B lo pruebe en un equipo de verdad. Un modelo importado se ejecuta con el perfil de la
`family` de su manifiesto.

| Petición | Respuesta |
| --- | --- |
| `GET /api/ai/runtime[?force=VULKAN\|CPU][&device=cpu][&model=<clave>]` | Un `AiRuntimeStatus` (`src/core/ai.ts`): `{available, reason?, backend, device, supports[], activeModel}` (`backend` y `device`: lo que dijo `--list-devices`, el primer Vulkan si lo hay; `reason`: `NO_RUNTIME`, `NO_MODEL`, `MODEL_UNSUPPORTED`), y además `detail`, `choice{rowId, backend, key}`, `release{tag, commit}`, `platform{os, arch}`, `gpu`, `force`, `runtime` (la elegida), `runtimes[]`, `sidecar{state, label, pid, idleSeconds}`, `downloader` |
| `GET /api/ai/runtimes/<clave>` | `{key, os, arch, backend, here, name, url, sha256, bytes, state: missing\|paused\|downloading\|verifying\|installing\|installed, done, total, error, version, devices[{name, description}], probeError, supports[], verified[]}` |
| `POST /api/ai/runtimes/<clave>/download` | 202: empieza o reanuda. 409 `other-system` para otra plataforma, 404 clave desconocida |
| `POST /api/ai/runtimes/<clave>/pause` | Para la descarga; el `.part` se queda |
| `POST /api/ai/runtimes/<clave>/import` | Cuerpo `{"file": <id de concesión>}` de un `dialog/open`: instala ese archivo si su tamaño y su SHA-256 son los fijados |
| `POST /api/ai/runtimes/<clave>/probe` | Vuelve a preguntar `--version` y `--list-devices` |
| `DELETE /api/ai/runtimes/<clave>` | 204: para lo que haga (y el servidor si es suyo) y lo borra todo |
| `POST /api/ai/run` | Cuerpo (≤ 96 MiB) `{model, image, control?{kind: tile\|depth, image}, prompt, negative, strength (0, 1], seed, steps?, width?, height?, force?, device?}`, imágenes en PNG base64 (o `data:`), lados de 64 a 4096 múltiplos de 16, iguales a `width`/`height` si se dan. 202 con el estado; 400 `bad-body` o `size`, 409 `unavailable` con `reason`, 409 `control-unsupported`, 503 `busy` con 4 esperando |
| `GET /api/ai/run/<id>[?after=<versión>]` | `{id, state: QUEUED\|STARTING\|LOADING\|INFERENCE\|FINISHING\|DONE\|FAILED\|CANCELLED, step, steps, fraction, seconds, version, model, runtime, width, height, error, message}`; con `after` espera hasta 1 s a una versión posterior. `error`: `crashed`, `hung`, `timeout`, `failed`, `wrong-size`, `bad-image`, `start`, `protocol` |
| `GET /api/ai/run/<id>/image` | `image/png` cuando `DONE`; 409 si no |
| `DELETE /api/ai/run/<id>` | Cancela uno en marcha u olvida uno terminado (se guardan los 8 últimos, 10 min) |
| `DELETE /api/ai/sidecar` | Para el servidor si nadie lo usa (204; 409 si sí) |

`GET /api/info` lleva `aiApi: 1`. El catálogo de compilaciones es siempre el incluido:
nada de la carpeta de datos ni del entorno lo sustituye, en ninguna compilación. Las pruebas
ponen el suyo (la compilación falsa, direcciones `http://` de un servidor local) con
`server::Options { ai_runtimes }` al construir el servidor (`Server::start_with`); la
aplicación arranca siempre con `Server::start`, que usa las opciones por defecto.

## Icono y versión del `.exe`

`build.rs`, solo al compilar para Windows con mingw-w64: escribe un `.rc` con `VERSIONINFO`
(versión de `package.json`) y el icono de `REPACKSHOT_ICON`, lo compila con
`x86_64-w64-mingw32-windres` (o `WINDRES`) y lo enlaza. Sin la herramienta o sin icono, un aviso
y nunca un fallo. `packaging/release.mjs` genera el icono desde `docs/media/logo.svg`.

## Pruebas

`cargo test -p rt-app`: SHA-256 con los vectores del NIST (`""`, `"abc"`, el mensaje de 448 bits,
el de 896 bits, un millón de `a`) y en trozos de tamaños impares; el lector JSON (válido,
inválido, escapes Unicode y sustitutos, números, profundidad); el lector HTTP (línea de
petición, cabeceras, peticiones malas); `Range`; rutas de ficheros; el almacén de modelos
(trozos desordenados y reanudados, *hash* erróneo → dañado, *blob* compartido conservado al
borrar uno de dos modelos, manifiestos importados); la regla con el fichero de casos; los
analizadores de `reg`, `/proc`, `nvidia-smi`; el INI; el estado de la página (nombres, tipos,
escritura atómica que deja el archivo viejo si el cuerpo se corta, documento dañado apartado,
enlaces dentro de la carpeta de datos, medidas) y el puerto recordado. `src/dialogs.rs`: los argumentos de `zenity` y `kdialog`, la lectura de sus salidas y de la del
guion de PowerShell, que las palabras de la página van como datos, base64, un diálogo a la vez y
el cierre con la aplicación (con un `zenity` falso). `src/files.rs`: nombres seguros y numerados,
ids estables, lo que cada concesión deja hacer, Descargas, el último proyecto entre arranques.
`src/browser.rs`: los interruptores y la mezcla de preferencias del perfil. `tests/files.rs`: la
API de ficheros por HTTP con un `zenity` falso. Fuera del motor: `packaging/wine-dialogs.mjs`
(el `.exe` bajo Wine con un `powershell.exe` falso), `tools/desktop-window-check.mjs` (el lanzador
real bajo Xvfb) y el guion de PowerShell analizado y su C# compilado con `pwsh` 7.
`src/ai/`: *inflate* con bloques almacenados, fijos y dinámicos (hechos a mano según la RFC y de
zlib), errores y límites; zip de Info-ZIP y de un flujo con descriptores de datos (fijos en
`tests/fixtures/`), Zip64, nombres hostiles y enlaces; PNG de ImageMagick de cada tipo de color,
profundidad, filtro y Adam7 contra los píxeles de PIL, CRC, cortes; base64 (RFC 4648); la regla
con el fichero de casos; las líneas de progreso tal como las imprime la *release*; el cuerpo del
trabajo; capturar con tiempo límite (también con un nieto que retiene las salidas).
`tests/ai.rs`, con **`rt-fake-sd`** (un binario de este *crate*, nunca distribuido, que habla la
misma línea de órdenes y el mismo protocolo que `sd-cli`/`sd-server`, apunta sus argumentos y sus
trabajos y, por etiquetas en el *prompt* o `fake-sd.json`, se cuelga, se cae, va lento, falla,
calla o devuelve otro tamaño): argumentos exactos y trabajo por clave y por ControlNet, servidor
reutilizado, imagen de vuelta comprobada, progreso y cancelación con el modelo aún cargado,
colgado, tiempo límite, caída al cargar y al generar, fallo, tamaño distinto rechazado,
rechazos con su motivo, el estado, liberar por petición, por inactividad y al cerrar, el que
dejó un arranque anterior; y con el `curl` real contra un servidor local: descarga, pausa,
reanudación desde el byte, instalación, borrado, un `sha256` distinto que no instala nada y un
archivo elegido. Ignoradas salvo que se pidan: el zip real de cada compilación descomprimido
(`RPX_SDCPP_ZIP`), la compilación real de Linux CPU instalada y respondiendo `--version`,
`--list-devices` y `--help` (`RPX_SDCPP_LINUX_CPU_ZIP`), la descarga real desde GitHub con pausa
(`RPX_REAL_DOWNLOAD=1`) y un *img2img* real con SD 1.5 en CPU (`RPX_SD15_WEIGHTS`).
En `tests/`: el servidor por sockets reales
(`Host` ajeno, token, `Origin`, sin CORS, *keep-alive*, ficheros, modelos por HTTP, *pending
models*), el estado de la página por HTTP (`tests/appdata.rs`: seguridad, nombres que no salen de
su carpeta, enlaces no seguidos, límites, una petición cortada, resultados con índice, caché y
espacio usado, y que todo sigue ahí para otro arranque), el puerto estable (`tests/port.rs`: el
mismo si está libre, otro recordado si está ocupado, `--port` sin recordar) y la paridad con `rt`.

La ventana propia (`src/platform/`): en todas las plataformas, los GUID, nuestros objetos COM
(recuento de referencias, `QueryInterface`, `Invoke`), el tamaño de cada vtable de WebView2 contra
el número de métodos del IDL y la posición de cada método que se llama, el protocolo con la página
contra `tests/fixtures/host-protocol.json` (el mismo que pasa `src/core/host-protocol.ts`), el
título, el sitio de la ventana, la política (ajustes, navegación, ventanas nuevas, permisos,
diálogos) y los argumentos. Solo para Windows, y en Linux bajo Wine con una pantalla virtual
(`CARGO_TARGET_X86_64_PC_WINDOWS_GNU_RUNNER=wine xvfb-run -a cargo test -p rt-app --target
x86_64-pc-windows-gnu --lib platform`): nuestras opciones del entorno de WebView2 como las lee el
cargador, el cargador que falta o no es una DLL, y la ventana Win32 de verdad (barra de título del
sistema, título, tamaño mínimo, cerrar preguntado y luego permitido, `window.json` guardado y
restaurado, un sitio fuera de las pantallas olvidado). WebView2 no corre aquí: lo que queda se
prueba en Windows.
