# Arquitectura — stack, límites y contratos

Documento de referencia técnica. Autocontenido: con él y los catálogos de
`src/data/` cualquier fase del roadmap se puede ejecutar sin más contexto.
Las decisiones de aquí están tomadas; cambiarlas es un ítem del roadmap,
no una iniciativa dentro de un PR.

---

## 1 · Stack (decidido)

| Capa | Elección | Por qué |
| --- | --- | --- |
| Lenguaje | **TypeScript** estricto, ES2022, módulos ES | Un solo lenguaje para modelo, motor e interfaz; tipos como contrato entre fases ejecutadas por agentes distintos |
| Empaquetado | **Vite** | Arranque instantáneo, `build` estático, sin configuración que mantener |
| Interfaz | **HTML + CSS + TypeScript sin framework** | La interfaz es un conjunto de paneles con estado centralizado; un framework añadiría una dependencia y un estilo que luego hay que enseñar a cada agente. Componentes como funciones que devuelven elementos DOM y se suscriben al *store* |
| Vista previa | **three.js** (`WebGLRenderer`) | Rasterizado rápido para orbitar, seleccionar y colocar mientras la cámara se mueve. **No es el motor**: es la vista interactiva |
| Motor de render | **Rust, desde cero, sin dependencias externas** (`engine/`): trazador de caminos en CPU que compila a **WebAssembly** para el navegador y a **binario nativo** para la línea de comandos y el escritorio | Corre en cualquier sistema y arquitectura (x86_64, ARM64, RISC-V, wasm32) sin GPU ni drivers; el mismo código renderiza en el navegador, en el runner de CI y en el escritorio; determinista; eficiente por diseño (BVH ancho con SIMD, muestreo de baja discrepancia, colas de baldosas) |
| Importación | En `src/io/`, cargada bajo demanda: `GLTFLoader`, `FBXLoader`, `3MFLoader`, `PLYLoader`, `ColladaLoader`, `USDZLoader` y `3DMLoader` de three (MIT); **rhino3dm** (openNURBS, MIT) para `.3dm`; **occt-import-js** (LGPL-2.1, OpenCascade compilado a wasm) para STEP e IGES, como **única excepción LGPL** y aislada (ver abajo); OBJ y STL propios. **Decidido**: estas bibliotecas se aceptan en la capa `io/`, se cargan solo al importar y nunca entran en el motor | La importación es el tronco del producto: lo que la gente exporta desde Rhino, SolidWorks, Fusion, Maya, ZBrush y KeyShot tiene que entrar con un arrastre. Los formatos nativos propietarios de esos programas no se leen (`SPEC.md` §5) |
| Post-procesado IA (opcional) | **Decidido** en `AI-POST.md` §7. Escritorio, todo nativo: **stable-diffusion.cpp** (MIT, sobre ggml, MIT) como **proceso aparte** que gobierna el lanzador, nunca enlazado ni dentro de `engine/`, en compilaciones oficiales fijadas con `sha256` en `src/data/ai-runtimes.json` y descargadas bajo demanda como los modelos (X3b); la guarda y el trabajo con píxeles en `engine/crates/rt-post`, Rust sin dependencias (X3a). Web: **ONNX Runtime Web** (MIT) con WebGPU en workers y `rt-post` como `post.wasm` aparte (X3d). Modelo por defecto **Z-Image-Turbo** (Apache-2.0), descargado con `sha256`, nunca en el repositorio | Mejora opcional y local de la imagen con una guarda determinista que impide cambiar geometría, materiales, resolución o enfoque; separada del motor (`rt-core` no sabe que existe) |
| Tests | **vitest** (modelo e interfaz), **cargo test** (motor: escenas analíticas, determinismo, paridad wasm/nativo), **playwright-core** con el Chromium local para capturas | La suite de la interfaz corre sin GPU; la del motor corre en cualquier CPU |
| Empaquetado de escritorio | **Lanzador propio en Rust, solo `std`** (`engine/crates/rt-app`, binario `repackshot`), decidido para la primera release (P2). Sirve la interfaz en `127.0.0.1`, la abre en una ventana de aplicación de Edge (Windows) o Chromium/Chrome (Linux) y renderiza con `rt-core` **en nativo** con todos los hilos. Windows x86_64 compilado en cruzado con mingw-w64; Linux x86_64 estático con musl; instalador de Windows con **NSIS** (herramienta de construcción, no dependencia) | **Tauri queda descartado**: arrastra cientos de *crates* de crates.io (bloqueado en este entorno) y necesita compilar en Windows (sin minutos de Actions). El lanzador propio mantiene el proyecto sin dependencias en Rust, la interfaz web no cambia y Edge viene con Windows. Ver §5.5 |

Lo que **no** se usa: React/Vue/Svelte, Tailwind, fuentes de iconos,
fuentes de red, Electron, WebGPU, ningún renderizador existente (ni
Embree, ni OptiX, ni ports de pbrt, ni `three-gpu-pathtracer`), ningún
*crate* externo en el motor, ningún binario ni recurso de KeyShot (ver
`README.md`, reglas de sala limpia).

Añadir una dependencia **a la interfaz** exige una línea en esta tabla
con su licencia (solo MIT, Apache-2.0, BSD, ISC, CC0 o compatibles). El
proyecto se distribuye con la **PolyForm Noncommercial 1.0.0**: una
dependencia copyleft (GPL, AGPL) o no comercial no es compatible con eso
ni con que el titular pueda licenciarlo comercialmente, y no se admite.
**Única excepción, decidida: `occt-import-js` (LGPL-2.1)** para STEP e
IGES. Se admite porque la LGPL se aplica solo a esa biblioteca y no al
programa que la usa, siempre que la biblioteca siga siendo un módulo
aparte que el usuario puede sustituir (LGPL-2.1 §6). Condiciones, todas
obligatorias: se copia **sin modificar** de `node_modules` a
`public/vendor/occt-import-js/` con `tools/vendor.mjs` (como rhino3dm),
**nunca se empaqueta** en los *chunks* de Vite, se carga por URL en un
worker solo al importar un STEP o IGES, lleva al lado su texto de licencia
LGPL-2.1 y el enlace a su código fuente, y *Acerca de* la nombra. Así no
afecta a la licencia del proyecto ni a que el titular lo licencie
comercialmente. Ninguna otra LGPL sin una decisión nueva. El
**motor no admite dependencias**: `engine/Cargo.lock` solo contiene los
*crates* del propio workspace, y CI lo comprueba.

**Versiones instaladas** en el andamiaje inicial: three 0.186, Vite 8,
TypeScript 7, vitest 5, playwright-core 1.64 (el `package-lock.json` es
la verdad; esta lista orienta). **rhino3dm 8.35.0** (openNURBS, MIT,
Robert McNeel & Associates): lee `.3dm` en `io/rhino.ts`, cargado bajo
demanda en un worker; `rhino3dm.js` y `.wasm` se copian de
`node_modules` a `public/vendor/rhino3dm/` al construir
(`tools/vendor.mjs`). **occt-import-js 0.0.23** (OpenCascade en wasm,
LGPL-2.1, Viktor Kovács): lee STEP e IGES en `io/step.ts` con un worker
propio (`io/step-worker.ts`) que descarga `occt-import-js.js` y `.wasm`
sin modificar de `public/vendor/occt-import-js/`, copiados por
`tools/vendor.mjs` con `license.occt-import-js.txt`, `license.occt.txt` y
un `README.txt` con la versión y los enlaces al fuente;
`tests/chunks.test.ts` comprueba que ningún *chunk* lo contiene. Motor: Rust estable, **fijado a 1.97.0 en CI** (`RUST_VERSION` y `RUSTUP_TOOLCHAIN` en `engine.yml` y `release.yml`, la misma versión que las máquinas de desarrollo: cada Rust nuevo trae *lints* nuevos de clippy y con `-D warnings` pondría el CI en rojo sin que nada cambie; subir de versión es un cambio a propósito que arregla sus *lints*),
objetivos `wasm32-unknown-unknown`, `aarch64-unknown-linux-gnu` y
`riscv64gc-unknown-linux-gnu` comprobados en CI además del nativo.

---

## 2 · Mapa del repositorio

```
index.html                  la página; monta src/main.ts
src/
  main.ts                   arranque: crea el store, monta la interfaz, arranca el visor
  core/                     MODELO. TypeScript puro: sin DOM, sin three, sin fetch
    store.ts                estado, acciones, deshacer, suscripción (§4)
    scene.ts                piezas, grupos, jerarquía, selección por niveles
    materials.ts            instancia de material, parámetros, desgaste
    lighting.ts             rig activo, focos, colocación por reflejo
    camera.ts               óptica, encuadre, cámaras guardadas
    animation.ts            planos, movimientos, evaluación en el tiempo
    doctor.ts               chequeos y arreglos sobre el modelo
    light-math.ts           kelvin → rgb, irradiancia, polar, ease   (portado)
    rig.ts                  studioRig / setupRig normalizados           (portado)
    wear.ts                 valores por defecto del desgaste            (portado)
    version.ts
  data/                     CATÁLOGOS. Solo datos y tipos (§3)
  render/                   MOTORES DEL LADO WEB. Dependen de core, nunca de ui
    engine.ts               la interfaz RenderEngine (§5)
    preview.ts              three.js: vista previa rasterizada mientras se mueve la cámara
    pathtracer.ts           RenderEngine sobre un pool de workers que ejecutan rt.wasm (E4)
    worker.ts               el worker: instancia rt.wasm, recibe la escena RSB, renderiza baldosas
  ai/                       POST-PROCESADO IA OPCIONAL (X3). Depende de core; workers con ONNX Runtime Web; la guarda es TypeScript puro
  io/                       IMPORTADORES Y EXPORTADORES. Dependen de core
    import.ts               punto de entrada: detecta el formato, aplica la hoja de opciones, produce nodos
    gltf.ts  obj.ts  stl.ts  fbx.ts  rhino.ts  threemf.ts  ply.ts  collada.ts  usd.ts  three-scene.ts  step.ts step-worker.ts occt-protocol.ts occt-convert.ts (I2, OCCT)
    project.ts (.repack.json)  library.ts (biblioteca propia, JSON)  image.ts (PNG/JPEG/EXR)
    rsb.ts                  escritor del formato de escena binario del motor (§5.2)
  ui/                       INTERFAZ. Habla con core a través del store (§6)
    strings.ts              todas las cadenas, en es y en
    theme.css  layout.css  components.css  …
    components/             NumberField, Section, Grid, Palette, …
    panels/                 header, scene, viewport, inspector, renderbar, status
public/
  thumbs/setups/            72 miniaturas de montaje de luz (PNG)
  example/                  nada: la pieza de ejemplo es procedural
tests/                      vitest; *.test.ts por módulo
tools/                      scripts de desarrollo: capturas, generadores, hojas de contacto
docs/                       este documento, SPEC, UI, ROADMAP
engine/                     EL MOTOR. Workspace de Cargo, Rust, sin dependencias externas (§5.1)
  Cargo.toml  rust-toolchain.toml  README.md
  crates/rt-core/           el trazador: matemáticas, SIMD, BVH, BSDF, luces, integrador, RSB, PNG
  crates/rt-cli/            binario nativo `rt`: renderiza un .rsb a PNG con hilos; hojas de contacto
  crates/rt-wasm/           exportaciones extern "C" para el navegador (sin wasm-bindgen)
  crates/rt-app/            lanzador de escritorio `repackshot`: servidor local, ventana, motor nativo (§5.5)
packaging/                  guiones de empaquetado: portables de Windows y Linux, instalador NSIS (P2)
public/engine/rt.wasm       el motor compilado para el navegador (generado por npm run engine:build; no se sube)
```

**Regla de dependencias**: `ui → core`, `render → core`, `io → core`,
`core → data`. Nunca al revés, nunca `ui → render` directamente (el
*store* expone lo que el visor necesita y el visor se suscribe). Un test
de la suite (`tests/boundaries.test.ts`, U2) recorre los `import` y
falla si se viola; hoy no hay ninguna infracción. El motor (`engine/`) no conoce nada de `src/`: su
única interfaz con el resto es el formato RSB (§5.2) y las exportaciones
de `rt-wasm` (§5.3).

---

## 3 · Catálogos (`src/data/`)

Portados de EZ Packshot por su autor. Las claves (`GOLD`, `REMBRANDT`,
`JEWELLERY`…) son **estables**: la documentación, las miniaturas y los
proyectos guardados las referencian. Añadir entradas es libre; renombrar
o borrar es un ítem de roadmap con migración.

Contratos (ver `src/data/types.ts`, que manda sobre este resumen):

- **`LightSpec`** — un foco de receta. `az` y `el` en grados **relativos
  al eje de cámara**: `az = 0` detrás de la cámara, negativo a la
  izquierda de cámara, `±90` laterales, `180` detrás de la pieza. `size`,
  `sizeY` y `dist` en **tamaños de pieza**: la misma receta vale para un
  anillo y para un sofá. `share` (montajes) es la fracción de la
  irradiancia total; `energy` (estudios) vatios a tamaño 1, en el sentido
de Cycles: un panel de potencia P y área A tiene radiancia P / (4 A). `kelvin` o
  `color`; `color` gana. `camera = true` es un panel luminoso que la
  cámara ve (campo claro).
- **`StudioPreset`** — tipo de producto: tamaño típico, focal, diafragma,
  intensidad de entorno, exposición, fondo, suelo, sombra, cáusticas,
  calidad, y su rig de focos.
- **`LightSetup`** — montaje del catálogo: etiqueta, intención, estilo,
  `world` (`STUDIO` cúpula, `SKY` cielo, `FLAT` plano) y focos; `PRESET`
  usa el rig del tipo de producto.
- **`MaterialPreset`** — categoría, familia (`SIMPLE`, `GLASS`, `WOOD`,
  `FABRIC`, `EMISSIVE`) y parámetros.
- Desgaste, pelusa, ópticas, movimientos, suavizados, secuencias,
  chequeos del Doctor, calidad y resolución: ver sus ficheros.

**Normalización de exposición** (`src/core/rig.ts`): al aplicar un
montaje sobre un tipo de producto, la suma de irradiancias de sus focos
se iguala a la del rig del tipo de producto (`presetIrradiance`), de modo
que cambiar de montaje no cambia la exposición. Es la solución que en EZ
Packshot permite recorrer 72 montajes sin tocar la exposición, y la suite
la fija para las 16 × 71 combinaciones.

**Sistema de coordenadas** del modelo y del visor: Z arriba, Y hacia el
fondo, X a la derecha; cámara de referencia en `polar(CAMERA_AZIMUTH_DEG,
CAMERA_ELEVATION_DEG, d)`. three.js es Y-arriba: la conversión vive en
**un solo sitio** (`src/render/preview.ts`, función `toThree`), nunca
repartida.

---

## 4 · El *store* (`src/core/store.ts`)

Un único árbol de estado inmutable, acciones como objetos planos, y
deshacer / rehacer sobre instantáneas. Es el contrato entre interfaz,
motor e importadores, y por eso está aquí y no en la interfaz.

```ts
export interface ProjectState {
  meta:      { name: string; version: string; dirty: boolean; lang: 'en' | 'es'; theme: 'dark' | 'light' | 'system' };
  scene:     { nodes: Record<NodeId, SceneNode>; roots: NodeId[]; partSizeMm: number };
  selection: { level: 'MODEL' | 'GROUP' | 'PART' | 'FACES'; ids: NodeId[]; faces?: { part: NodeId; indices: number[] } };
  materials: Record<MaterialId, MaterialInstance>;        // instancias; el preset es solo el origen
  studio:    { preset: StudioKey; lightSetup: LightSetupKey | 'PRESET'; built: boolean; floor: boolean; shadow: boolean;
               lights: LightInstance[]; modified: boolean };
  environment: { kind: 'STUDIO' | 'SKY' | 'FLAT' | 'HDRI'; strength: number; rotationDeg: number;
                 background: 'ENVIRONMENT' | 'COLOR' | 'TRANSPARENT' | 'BACKPLATE'; color: RGBA;
                 groundShadow: number; groundReflection: number };
  camera:    { active: CameraId; cameras: Record<CameraId, CameraState> };
  image:     { exposureEv: number; viewTransform: 'STANDARD' | 'FILMIC' | 'AGX'; bloom: number; sharpen: number;
               saturation: number; contrast: number; vignette: number };
  animation: { shots: Shot[]; clips: MotionClip[]; fps: number; playhead: number; playing: boolean };
  render:    { quality: 'DRAFT' | 'PREVIEW' | 'FINAL' | 'CUSTOM'; width: number; height: number;
               maxSamples: number; maxSeconds: number; format: 'PNG' | 'JPEG' | 'EXR'; transparent: boolean;
               queue: RenderJob[]; running: RenderProgress | null };
  doctor:    { results: DoctorResult[]; stamp: number };
}
```

(Los tipos auxiliares —`SceneNode`, `MaterialInstance`, `LightInstance`,
`CameraState`, `Shot`, `MotionClip`, `RenderJob`— los define la fase U1 en
`src/core/*.ts` siguiendo `SPEC.md`; este esqueleto fija los nombres de
primer nivel para que las fases posteriores no tengan que renombrar.)

API mínima:

```ts
export interface Store {
  get(): ProjectState;
  dispatch(action: Action): void;                 // aplica, registra en el historial, notifica
  subscribe(fn: (s: ProjectState, prev: ProjectState, action: Action) => void): () => void;
  undo(): void; redo(): void;
  history(): { undo: string[]; redo: string[] };  // etiquetas legibles ("Asignar Oro a Cuerpo")
  transaction(label: string, fn: () => void): void; // agrupa varios dispatch en una entrada de deshacer
}
```

Reglas:

- **Toda** mutación pasa por `dispatch`. La interfaz no toca el estado;
  el visor tampoco.
- Cada `Action` lleva `type` y, si procede, `label` para el historial. Las
  acciones continuas (arrastrar un campo, orbitar) se agrupan con
  `transaction` por gesto: una entrada de deshacer por arrastre.
- Los reductores son funciones puras en `src/core/*.ts`; los efectos
  (renderizar, descargar) viven fuera, suscritos al store.
- El estado es serializable tal cual a `.repack.json` (sin instancias de
  clase, sin referencias circulares, sin `Map`). `io/project.ts` lo guarda
  y lo carga con una versión de esquema y migraciones.
- Las acciones de deshacer no incluyen `meta.lang`, `meta.theme`, el
  plegado de paneles ni el `playhead`: son estado de interfaz.

---

## 5 · Motores

### 5.0 · La interfaz del lado web (`src/render/engine.ts`)

```ts
export interface RenderEngine {
  readonly kind: 'preview' | 'pathtracer';
  mount(canvas: HTMLCanvasElement): void;
  sync(state: ProjectState, prev: ProjectState | null): void; // aplica solo lo que cambió
  resize(width: number, height: number, dpr: number): void;
  frame(): void;                                              // un paso: un fotograma o una muestra más
  status(): { samples: number; seconds: number; converged: boolean; device: string };
  render(opts: { width: number; height: number; maxSamples: number; maxSeconds: number;
                 transparent: boolean; onProgress?: (p: RenderProgress) => void; signal?: AbortSignal }): Promise<ImageBitmap>;
  pick(x: number, y: number): { node: NodeId; face: number; point: [number, number, number]; normal: [number, number, number] } | null;
  dispose(): void;
}
```

- `status()` dice la verdad: la vista previa reporta `samples: 1` y
  `converged: true`; el trazador, las muestras acumuladas. La interfaz
  pinta lo que el motor dice, nunca un contador propio.
- `pick` sirve para seleccionar, enfocar con clic y colocar por reflejo.
- Dos implementaciones conviven y **el usuario elige cuál ve** con el
  conmutador *Rápido · Completo* de la cabecera (`meta.viewportMode`,
  `'FAST' | 'FULL'`, estado de interfaz persistido, no deshacible):
  **`preview`** (three.js) en *Rápido*, para colocar luces, pintar
  materiales y encuadrar con respuesta inmediata; **`pathtracer`** (el
  motor en Rust vía wasm) en *Completo*, que simula todo en el propio
  visor también mientras se mueve la cámara: durante un gesto renderiza
  a resolución reducida (½ o ¼, elegida por el tiempo del último
  fotograma) y al soltar vuelve a la resolución del visor y converge. No
  hay cambio automático de motor; *Completo* queda deshabilitado con su
  motivo cuando `rt.wasm` no está cargado o el navegador no da workers.
- **`render()` usa siempre `pathtracer`**, esté el visor en el modo que
  esté: el conmutador es solo lo que se ve mientras se trabaja. Sin
  `rt.wasm` no hay render (se dice el motivo); la vista previa solo se
  usa para miniaturas (`quick`).
- `status()` del trazador incluye, además de muestras y tiempo, los
  workers, si hay SIMD, la escala de resolución, los fotogramas por
  segundo, el tiempo por fotograma y si está renderizando.

### 5.1 · El motor: Rust, desde cero, sin dependencias

Vive en `engine/`, un workspace de Cargo con cuatro *crates*:

| Crate | Qué es | Reglas |
| --- | --- | --- |
| `rt-core` | **El trazador.** Biblioteca: matemáticas, SIMD, BVH, intersección, BSDF, luces, entorno, muestreo, integrador, lector y escritor RSB, codificador PNG, película y tonemapping | Solo `core`/`alloc`/`std` sin APIs del sistema (nada de `fs`, `net`, `time`, `thread`); `#![deny(unsafe_code)]` salvo el módulo `simd`; `#![deny(missing_docs)]`; `f32` en todo; sin `unwrap` en rutas que dependan de la entrada; compila para `wasm32-unknown-unknown` |
| `rt-cli` | Binario nativo `rt`: lee un `.rsb`, renderiza con hilos (`std::thread::scope`, cola de baldosas atómica), escribe PNG, mide rayos/s; hojas de contacto y miniaturas en CI | Puede usar `std` entero |
| `rt-wasm` | `cdylib` con exportaciones `extern "C"` escritas a mano (`rt_alloc`, `rt_free`, `rt_scene_load`, `rt_render_tile`, `rt_version`…). Sin `wasm-bindgen` | El único `unsafe` fuera de `simd`: la reserva de memoria lineal, comentada bloque a bloque |
| `rt-app` | Binario `repackshot`, el lanzador de escritorio (§5.5): servidor local, ventana, motor nativo, datos, equipo | `std` entero, **sin `unsafe`**; lo que necesita del sistema lo pide a procesos del sistema (`reg`, `nvidia-smi`) |

**Sin dependencias externas** quiere decir exactamente eso: ningún
*crate* de crates.io en ningún *crate* del workspace. `Cargo.lock` solo
lista `rt-core`, `rt-cli`, `rt-wasm` y `rt-app`, y CI falla si aparece un
`source =`. Todo lo que el motor necesita (vectores, RNG, secuencias de
baja discrepancia, zlib/PNG, lectores HDR, hilos) se escribe aquí.
Fórmulas y tablas de la literatura pública (PCG, Sobol con números de
dirección de Joe y Kuo, el ajuste ACES, el modelo de cielo) se citan en
el comentario de su módulo.

**Portabilidad.** El motor compila y pasa sus tests en x86_64, ARM64,
RISC-V y wasm32; CI compila cruzado los tres primeros y construye el
wasm en cada PR. No hay rutas de código específicas de sistema
operativo. El `simd` es una abstracción propia (`f32x4`, `f32x8`) con
**implementación escalar de referencia** y rutas con intrínsecos
estables bajo `cfg(target_arch)`: SSE2 como base y AVX2 por detección en
tiempo de ejecución en x86_64, NEON en aarch64, `simd128` en wasm32
cuando el navegador lo soporta; cualquier otra arquitectura usa la
escalar. Los tests ejecutan las dos rutas y exigen el mismo resultado
dentro de 1 ulp.

**Determinismo.** La misma escena RSB, la misma semilla y el mismo
índice de muestra producen los mismos píxeles en cualquier plataforma y
con cualquier número de hilos o workers: el muestreador se siembra por
(baldosa, píxel, muestra), nunca por hilo, y la acumulación es por
baldosa en orden fijo. Un test compara el hash de una imagen de
referencia entre el binario nativo y el wasm (paridad), y entre 1 y N
hilos.

**Eficiencia, por diseño** (los números son objetivos medidos, no
puertas de CI): BVH con construcción SAH por *binning* y nodos anchos
(BVH4/BVH8) recorridos con SIMD; intersección triángulo-rayo
*watertight*; estructuras *structure-of-arrays* alineadas; baldosas en
orden Morton; ruleta rusa; muestreo explícito de luces con MIS; Sobol
con *scrambling* de Owen; muestreo adaptativo por varianza; *denoise*
guiado al final. Objetivo para la pieza de ejemplo en x86_64 con AVX2:
≥ 10 millones de rayos por segundo y núcleo; en wasm, alrededor de un
tercio del nativo.

### 5.2 · RSB: el formato de escena

La única interfaz entre la interfaz y el motor es un **blob binario
little-endian**, `RSB1`: cabecera y secciones `[u32 tag][u32 len][payload]`
(`CAMR`, `MESH`, `MATL`, `LGHT`, `ENVR`, `RNDR`, `INST`…), con secciones
desconocidas ignoradas para compatibilidad hacia delante. `INST`
(instancia: índice de malla, transformación 3 × 4 por filas, material,
banderas) es opcional: sin ella, cada malla es una instancia identidad.

Semántica fijada en E3 (la fuente de verdad es el módulo `rsb` de
`rt-core`):

- **`MATL`** (60 B; los de 56 B se leen con `flags = 0`): `kind` 0
  principal (Lambert + GGX con barniz; `transmission` se ignora hasta E5),
  1 vidrio (E5; hasta entonces se pinta como 0), 2 emisivo (radiancia
  `emission × emission_power`); desconocido = 0. `flags` bit 0: el emisor
  se muestrea también como luz.
- **`LGHT`** `kind`: 0 rectángulo, 1 disco, 2 sol, 3 punto y 4 foco
  (L4; se leen y se ignoran); ≥ 5 es error. Rectángulo y disco:
  unilaterales, `power` = flujo en W (mm → m), `spread_deg` = caída cosⁿ
  con la mitad de intensidad a `spread/2` (180 = sin caída). Sol: `power`
  = irradiancia en W/m², disco de `angle_deg`. `flags` bit 0 *glossy*
  (ilumina todos los lóbulos y se ve en reflejos; sin él solo difuso por
  NEE), bit 1 visible a cámara.
- **`ENVR`** `kind`: 0 cúpula (lineal en z: suelo −1, horizonte 0, cénit
  +1, × `strength`), 1 plano, 2 cielo y 3 HDRI (E5; hasta entonces
  cúpula); `background_mode`: 0 entorno, 1 color, 2 transparente (alfa
  0), 3 imagen de fondo (M2; hasta entonces 1).
- **`FLOR`** (20 B, una como máximo): `mode` 0 ninguno, 1 plano
  lambertiano infinito, 2 atrapasombras; `z`; `color[3]`.
- **`RNDR`** (36 B): además `max_depth` (0 = 8, tope 1024) y
  `clamp_indirect` (0 = desactivado). `tonemap`: 0 lineal, 1 ACES, 2
  fílmica, 3 AgX, 4 estándar; desconocido = ACES. Exposición 2^ev antes
  de la curva.
- El escritor de `rt-core` emite siempre `FLOR` y los campos nuevos; el
  escritor TypeScript de E4 hace lo mismo. `rt-core`
tiene lector y escritor; `src/io/rsb.ts` tiene el escritor en
TypeScript, y un test de paridad escribe la misma escena por los dos
lados y compara los bytes. El `.repack.json` sigue siendo el formato de
proyecto; el RSB es lo que viaja al motor (y lo que `rt` lee en la línea
de comandos). **Actualizaciones** (E4): `rt_scene_update` acepta un RSB
sin `MESH` que conserva las mallas cargadas y sus BVH (cámara, luces,
materiales, entorno, render cambian sin reconstruir geometría); por eso
las mallas declaran siempre material 0 y el material real va en `INST`,
que se escribe siempre. Unidades: milímetros, Z arriba, sensor de 36 mm
en el lado largo; flujo de un panel = π/4 × potencia del rig × tamaño²
(convención de las luces de área de Blender Cycles, L = P / (4 A), con la
que se ajustaron las recetas; `src/core/photometry.ts`); el ángulo del sol, en grados. Los mapas de bits (texturas, HDRI) viajan como secciones
propias cuando lleguen (E5, M2).

### 5.3 · En el navegador: workers

`src/render/pathtracer.ts` implementa `RenderEngine` con un **pool de
Web Workers** (`navigator.hardwareConcurrency − 1`, mínimo 1). Cada
worker instancia su propia copia de `rt.wasm` y recibe el RSB entero
(sin `SharedArrayBuffer`, para que funcione en cualquier servidor sin
cabeceras COOP/COEP, GitHub Pages incluido); las baldosas se reparten
intercaladas, cada worker devuelve `Float32Array` lineales por baldosa,
y el hilo principal acumula (en `f32` y en orden de muestra, que es lo
que da paridad exacta con `rt`), aplica exposición y transformada con
un camino rápido por tabla, y pinta en el canvas; la conversión final
exacta a 8 bits de *Render* la hacen los workers por franjas. Durante
gestos de cámara, arrastres del *gizmo* y de controles, el visor renderiza
a ½ o ¼ de resolución; nunca por encima de un píxel de imagen por píxel
del dispositivo. El *preview* de three.js sigue activo mientras la cámara se
mueve; al pararse, el trazador arranca desde la muestra 0 y la imagen
converge en el propio visor. *Render* usa el mismo pool a la resolución
de salida y con el presupuesto de la barra de render.

### 5.4 · En nativo

`rt` renderiza un `.rsb` con todos los hilos de la máquina y escribe PNG
(8 o 16 bits) o EXR; sirve para lotes, para la hoja de contactos de CI y
para generar las miniaturas de los catálogos sin navegador. La
aplicación de escritorio (P2) enlaza `rt-core` directamente en su
lanzador y usa el mismo RSB que la web (§5.5).

### 5.5 · Escritorio: el lanzador `repackshot`

`engine/crates/rt-app` es un binario de Rust **solo con `std`** (mismo
workspace, mismas puertas: `fmt`, `clippy -D warnings`, cero *crates*
externos). **Sin `unsafe` salvo en `src/platform/`** (decidido en P3c):
la ventana propia de Windows necesita llamar a Win32 y a la interfaz COM
de WebView2, y eso solo se hace con FFI; cada bloque `unsafe` lleva su
comentario de por qué es correcto, el resto del *crate* mantiene
`#![deny(unsafe_code)]` y nada de `platform/` entra en `rt-core`. Hace cinco cosas:

1. **Servir la interfaz**: un servidor HTTP/1.1 mínimo en `127.0.0.1` y
   un puerto libre, con la carpeta `app/` (el `dist/` de Vite) junto al
   ejecutable. Comprueba la cabecera `Host` (contra el *DNS rebinding*) y
   exige en la API un *token* aleatorio por arranque que solo conoce la
   página que abrió.
2. **Abrir la ventana**: Edge en Windows (viene con el sistema) o el
   primer Chromium, Chrome, Edge o Brave en Linux, con `--app=<url>` y un
   perfil propio en la carpeta de datos; si no hay ninguno, el
   navegador por defecto. Se cierra cuando se cierra la ventana (proceso
   hijo y latido de la página). Un segundo arranque abre otra ventana del
   mismo servidor.
3. **Motor nativo**: `POST /api/render` con el RSB (y `full=1` cuando el
   cuerpo es la escena entera aunque no traiga `MESH`, como la de un
   proyecto vacío; sin él, un RSB sin mallas es una actualización y, si no
   hay escena cargada, la respuesta es 409 `need-meshes`) renderiza con
   `rt-core` en todos los hilos y la página recoge las pasadas
   acumuladas; mismo RSB, misma semilla, mismos píxeles que el wasm
   (regla de determinismo), así que la interfaz no distingue más que en
   la velocidad. `src/render/native.ts` implementa `RenderEngine` contra
   esa API y se elige cuando `/api/info` responde.
4. **Datos y modelos**: carpeta de datos en `%LOCALAPPDATA%\Repackshot`
   (Windows) o `$XDG_DATA_HOME/repackshot` (Linux); en las versiones
   **portables** (un fichero `portable.txt` junto al ejecutable), en
   `data/` al lado, perfil del navegador incluido. Los modelos de IA se
   guardan ahí: la página los descarga con `fetch` y los entrega al
   lanzador por trozos, que los escribe, reanuda y comprueba con un
   SHA-256 propio.
6. **Diálogos y archivos** (P3b): `POST /api/dialog/{folder,open,save}`
   abre los diálogos del sistema y devuelve un permiso por ruta; la API de
   archivos (`/api/files…`) solo lee o escribe rutas concedidas así en el
   arranque actual, con escritura atómica y sin sobrescribir en las
   carpetas de salida. La página nunca nombra una ruta que no le diera un
   diálogo.
5. **Equipo**: `repackshot --hardware <fichero>` escribe la GPU con su
   VRAM, la RAM y la recomendación de `src/data/ai-models.json`
   (registro de Windows y `/proc`, `/sys` o `nvidia-smi` en Linux, por
   procesos del sistema y sin `unsafe`); lo usan el instalador y
   *Ajustes ▸ Post-procesado IA ▸ Equipo*.

## 6 · Interfaz (`src/ui/`)

- Componentes = funciones `(store, props) => HTMLElement` que se
  suscriben y actualizan **solo** lo que cambió (comparar referencias
  del subárbol de estado que les importa). Sin DOM virtual.
- Todas las cadenas en `src/ui/strings.ts`: `t('inspector.material.change')`
  con tabla `es` / `en`; un test exige las mismas claves en las dos.
- CSS con *tokens* en `theme.css`; ningún color fuera de ahí, y ninguno
  con saturación (test `ui-achromatic`). Ver `UI.md` §1.
- Atajos en un solo mapa (`shortcuts.ts`), que también alimenta la paleta
  y los tooltips.
- Estado de interfaz que no es del proyecto (anchos de panel, secciones
  plegadas) en `localStorage`, siempre dentro de `try/catch` y con valor
  por defecto.

---

## 7 · Pruebas

| Qué | Dónde | Cómo |
| --- | --- | --- |
| Catálogos y matemáticas de luz | `tests/data.test.ts`, `light-math`, `rig` | Recuentos fijados, fórmulas con números, normalización 16 × 71 |
| Modelo | `tests/store.test.ts`, `scene`, `materials`, `doctor`… | Acciones puras: dado un estado, la acción produce el esperado; deshacer lo devuelve |
| Interfaz | `tests/strings.test.ts`, `ui-achromatic.test.ts` | Invariantes estáticas sobre fuentes |
| Visor | `npm run screenshot` | Captura con Chromium local (swiftshader); se adjunta al PR |
| Motor (fases E·) | `engine/crates/*/tests` y `cargo test` | Escenas analíticas (furnace test, factor de forma de un panel, espejo contra la cúpula) con tolerancias numéricas; determinismo (hash igual con 1 y N hilos); paridad wasm/nativo; SIMD contra escalar; cross-compilación a ARM64 y RISC-V; `clippy -D warnings`; `Cargo.lock` sin fuentes externas |
| Hoja de contactos | `tools/contact-sheet.mjs` + `rt` | 16 estudios × montajes elegidos renderizados en CI con el binario nativo, con media, quemados y tapados por imagen; se adjunta al PR |

Reglas, heredadas de EZ Packshot y no negociables:

1. Ningún cambio se entrega sin `npm run qa` en verde.
2. Todo bug corregido lleva su test, y se comprueba que el test **falla**
   si se reintroduce el bug.
3. Si un bug se escapa porque un test era más permisivo que la realidad
   (un *mock* que no se comporta como el navegador, un simulador que
   admite lo que three no admite), se arregla también el test o el
   simulador.

---

## 8 · Formato de proyecto (`.repack.json`)

`{ "format": "repackshot-project", "schema": 2, "state": ProjectState,
"meshes": [{ "id", "glb", "sharpEdges"?, "triangleSource"? }] }` (U2). Las
mallas se guardan **dentro**, un GLB en base64 por malla usada (glTF 2.0
válido, con la transformación Z arriba mm → Y arriba m para otros
visores, que el lector ignora); al lado van las aristas vivas y el mapa
de re-suavizado, que glTF no tiene. La referencia externa por ruta queda
para después. El esquema versiona solo `state`; las migraciones viven en
`io/project.ts` y se prueban con un fichero fijo por versión
(`tests/fixtures/project-v1.json`, `project-v2.json`). Al abrir, los ids
de malla que chocarían con otra geometría pasan a un prefijo `prjN:`,
porque la vista previa y los workers cachean por id.
