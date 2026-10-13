# rt-app — el lanzador de escritorio `repackshot`

Binario de Rust **solo con `std`** y **sin `unsafe`** (`#![forbid(unsafe_code)]`), en el
mismo *workspace* y con las mismas puertas que el motor (`cargo fmt`, `clippy -D warnings`,
ningún *crate* externo). Es la aplicación de escritorio (`docs/ARCHITECTURE.md` §5.5):

1. sirve la interfaz (el `dist/` de Vite, que se distribuye como `app/` junto al ejecutable) en
   `127.0.0.1`;
2. la abre en una ventana de aplicación de Edge (Windows) o de un navegador de la familia
   Chromium (Linux), con perfil propio en la carpeta de datos;
3. renderiza con `rt-core` **en nativo**, con todos los hilos, los mismos píxeles que `rt` y que
   el pool de wasm;
4. guarda los modelos de IA en la carpeta de datos, por contenido, comprobados con un SHA-256
   propio;
5. detecta el equipo y aplica la regla de recomendación de `src/data/ai-models.json`
   (`repackshot --hardware`, que lee el instalador).

Lo que necesita del sistema lo pide a programas del sistema (`reg`, `powershell`, `wmic`,
`nvidia-smi`, `explorer`, `xdg-open`, el navegador), nunca por FFI.

## Línea de órdenes

```text
repackshot [--port N] [--data-dir DIR] [--app-dir DIR] [--threads N]
repackshot --serve-only [...]           sin ventana: escribe la URL con el token y sirve hasta que se pare
repackshot --hardware <f.ini> [--device gpu|cpu]   escribe el INI del instalador y sale
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
| Datos, **portable** | `data/` junto al ejecutable cuando existe `portable.txt` a su lado; el perfil del navegador va dentro, así que los ajustes en `localStorage` viajan con la carpeta |
| Dentro de los datos | `browser-profile/`, `models/`, `logs/`, `results/`, `instance.json`, `pending-models.json` |

`--data-dir` manda sobre todo lo anterior.

## Ciclo de vida

- **Instancia única**: `<datos>/instance.json` (`{port, token, pid}`, legible solo por su dueño
  en Unix). Un segundo arranque que encuentra una instancia viva (responde `/api/info` con su
  token) abre otra ventana contra ella y termina.
- **Ventana**: `REPACKSHOT_BROWSER`, si está; si no, en Windows Edge (`App Paths` de `msedge.exe`
  en HKCU y HKLM, después las rutas de instalación habituales) y luego Chrome; en Linux el primero
  de `chromium`, `chromium-browser`, `google-chrome`, `google-chrome-stable`, `microsoft-edge`,
  `microsoft-edge-stable`, `brave-browser` en el `PATH`. Argumentos: `--app=<url>
  --user-data-dir=<datos>/browser-profile --no-first-run --no-default-browser-check
  --window-size=1600,1000` (y `--class=Repackshot` en Linux), más los tres
  `--disable-*-throttling/backgrounding` para que el latido no se frene con la ventana
  minimizada. Sin ninguno, el navegador por defecto (`cmd /C start "" "<url>"`, `xdg-open`).
- **Fin**: cuando termina el proceso del navegador (si vivió más de 5 s: uno que sale antes ha
  pasado la ventana a un navegador ya abierto con el mismo perfil), o cuando el latido de la
  página (`POST /api/alive` cada 5 s, desde un *worker* para que no lo frene una pestaña oculta)
  calla 20 s (60 s de gracia al arrancar). Si el equipo se suspende, el plazo vuelve a empezar.

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
- Ficheros estáticos: la ruta tiene que ser absoluta, sin NUL, `\`, `:`, segmentos vacíos, `.` ni
  `..`, y la ruta canónica del fichero tiene que seguir dentro de la carpeta canónica (también
  frena enlaces simbólicos que salgan). En `/api/*` cualquier segmento vacío, `.` o `..` es 400.
- Cabeceras siempre: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  `X-Frame-Options: DENY`, `Cross-Origin-Resource-Policy: same-origin`; `Cache-Control: no-store`
  en la API y `no-cache` en el HTML (los `assets/` de Vite, con *hash*, son inmutables).
- HTTP/1.1 con *keep-alive*, un hilo por conexión (máximo 64), cuerpos con `Content-Length`
  (los `chunked` de petición dan 501), cabeceras hasta 32 KiB, `Expect: 100-continue` atendido.

## API

Todas las rutas `/api/*` llevan `X-Repackshot-Token`. Errores en JSON:
`{"error": "<código>", "message": "<texto>"}`.

### Aplicación

| Petición | Respuesta |
| --- | --- |
| `GET /api/info` | `{app:"repackshot", version, engineVersion, threads, isa, simd[], os, arch, dataDir, modelsDir, logsDir, resultsDir, portable, browser, pid}` |
| `POST /api/alive` | 204. El latido. |
| `GET /api/hardware[?device=gpu\|cpu][&refresh=1]` | `{cpu, cores, threads, ramBytes, ramGiB, ramUsableBytes, gpus[{name, vendor, vramBytes, vramGiB}], device, gpuFound, detected, input, recommendation{rowId, recommended, offered[], skipped[]} \| null}` |
| `POST /api/open-folder` | Cuerpo `{"folder":"data\|models\|logs\|results"}` o `{"path":"<dentro de la carpeta de datos>"}`; 204, 403 fuera de los datos |
| `GET /api/pending-models` | Lo que eligió el instalador, normalizado: `{"device":"gpu\|cpu","keys":[...]}`, o `null` |
| `DELETE /api/pending-models` | 204: consumido |

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
analizadores de `reg`, `/proc`, `nvidia-smi`; el INI. En `tests/`: el servidor por sockets reales
(`Host` ajeno, token, `Origin`, sin CORS, *keep-alive*, ficheros, modelos por HTTP, *pending
models*) y la paridad con `rt`.
