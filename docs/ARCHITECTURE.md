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
| Post-procesado IA (opcional) | **Decidido** en `AI-POST.md` §7. Escritorio, todo nativo: **stable-diffusion.cpp** (MIT, sobre ggml, MIT) como **proceso aparte** que gobierna el lanzador, nunca enlazado ni dentro de `engine/`, en compilaciones oficiales fijadas con tamaño y `sha256` en `src/data/ai-runtimes.json` (*release* `master-959-d637cfb`: Vulkan y CPU para Windows y Linux x86_64, X3b), que el lanzador descarga bajo demanda desde *Ajustes* con el `curl` del sistema, descomprime con su propio lector de zip y arranca como `sd-server` en una dirección de bucle local aleatoria; no van en el instalador ni en los portables, y no se redistribuyen; la guarda y el trabajo con píxeles en `engine/crates/rt-post`, Rust sin dependencias (X3a). Web: **ONNX Runtime Web** (MIT) con WebGPU en workers y `rt-post` como `post.wasm` aparte (X3d). Modelo por defecto **Z-Image-Turbo** (Apache-2.0), descargado con `sha256`, nunca en el repositorio | Mejora opcional y local de la imagen con una guarda determinista que impide cambiar geometría, materiales, resolución o enfoque; separada del motor (`rt-core` no sabe que existe) |
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
Los HDRI (`.hdr` y `.exr`) se leen con lectores propios, en la interfaz
(`src/io/hdri.ts`) y en el motor (`rt-core`: RGBE, OpenEXR e *inflate*);
`HDRLoader` y `EXRLoader` de three solo aparecen en los tests, como lector
independiente con el que comparar (E5). E5 no añade dependencias.

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
    camera-moves.ts         expande un movimiento de cámara de data/camera-moves.json en las barras de la línea de tiempo para una cámara (A6)
    doctor.ts               chequeos y arreglos sobre el modelo
    images.ts               registro de imágenes del entorno (HDRI, imagen de fondo), como el de mallas (E5)
    sky.ts                  el cielo de Preetham del motor, portado para la vista previa (E5)
    faces.ts                caras enteras: cara CAD o superficie que continúa; piezas de «Separar por caras CAD» (M1)
    material-drop.ts        a qué llega una suelta de material y qué asigna (U7)
    box-select.ts           selección por caja: geometría en pantalla, ventana y cruce, qué gesto la arma (U7)
    primitives.ts           primitivas paramétricas: generadores puros y deterministas (caras lógicas, UV, normales), medidas válidas, id de malla `prim:<dueño>:<FORMA>:<medidas>` (U9)
    primitive-ops.ts        las primitivas en la escena: dónde nacen (base bajo el producto, junto a él, bajo él), añadir, editar en vivo, convertir en malla; `fitSweep` ajusta el fondo infinito a la cámara y a los focos traseros (U9)
    light-math.ts           kelvin → rgb, irradiancia, polar, ease   (portado)
    rig.ts                  studioRig / setupRig normalizados           (portado)
    wear.ts                 valores por defecto del desgaste            (portado)
    version.ts
  data/                     CATÁLOGOS. Solo datos y tipos (§3); primitives.json + primitives.ts: las doce formas de Añadir ▸ Primitiva (U9)
  render/                   MOTORES DEL LADO WEB. Dependen de core, nunca de ui
    engine.ts               la interfaz RenderEngine (§5)
    preview.ts              three.js: vista previa rasterizada mientras se mueve la cámara; `aiFrame` (X4): el fotograma del modo Rápido y sus pases
    preview-passes.ts       los pases de AI-POST.md §7.4 dibujados con three.js (albedo, normal, profundidad, ids exactos, coc) para la vista previa de la IA (X4)
    pathtracer.ts           RenderEngine sobre un pool de workers que ejecutan rt.wasm (E4)
    worker.ts               el worker: instancia rt.wasm, recibe la escena RSB, renderiza baldosas
    pass-planes.ts          los pases exactos del motor en la página (X2): junta los de rt.wasm por baldosa y lee el RPP1 del lanzador
  ai/                       POST-PROCESADO IA OPCIONAL (X3). Depende de core (y data), nunca al revés; la guarda NO es TypeScript: es rt-post
    post-wasm.ts            envoltura tipada de public/engine/post.wasm (plan, condicionamiento, aceptar) y el conductor runGuarded; worker y Node
    prompt.ts               el prompt de la escena (materiales, luces, estilo) y el negativo fijo; la tabla de materiales de la guarda
    synthetic.ts            el servicio sintético de X4 (sin modelo, determinista, informe medido); not-built.ts, el de una versión sin tubería
  io/                       IMPORTADORES Y EXPORTADORES. Dependen de core
    import.ts               punto de entrada: detecta el formato, aplica la hoja de opciones, produce nodos
    gltf.ts  obj.ts  stl.ts  fbx.ts  rhino.ts  threemf.ts  ply.ts  collada.ts  usd.ts  three-scene.ts  step.ts step-worker.ts occt-protocol.ts occt-convert.ts (I2, OCCT)
    project.ts (.repack.json)  library.ts (biblioteca propia, JSON)  image.ts (PNG/JPEG/EXR)
    rsb.ts                  escritor del formato de escena binario del motor (§5.2)
    hdri.ts                 lectores propios de RGBE y OpenEXR, imagen de fondo, copia para la vista previa (E5)
  ui/                       INTERFAZ. Habla con core a través del store (§6)
    strings.ts              todas las cadenas, en es y en
    ports.ts                los servicios que main.ts le entrega (visor, importadores…), sin importar render ni io (§6)
    theme.css  layout.css  components.css  …
    components/             NumberField, Section, Grid, Palette, …
      material-drag.ts      arrastrar un material con eventos de puntero: fantasma, zonas de suelta, Esc (U7)
    panels/                 header, scene, viewport, inspector, renderbar, status
      viewport-box.ts       el gesto de la caja de selección sobre el visor (U7)
      add-menu.ts           Añadir ▸ Primitiva: las mismas entradas en la cabecera, el + de Escena y el menú del visor en vacío (U9)
      scale-panel.ts        clic derecho ▸ Escalar…: el panel en línea (uniforme, por eje, a medida, restablecer) (U9)
public/
  thumbs/setups/            72 miniaturas de montaje de luz (PNG)
  assets/aperture/          45 máscaras de diafragma y texturas de pupila (PNG 512², gris de 8 bits) + index.json (A6)
  assets/gobo/              12 patrones de gobo (PNG 1024², gris de 8 bits) + index.json (A6)
  assets/README.md          procedencia: generador, receta, semilla y hash de cada fichero
  example/                  nada: la pieza de ejemplo es procedural
tests/                      vitest; *.test.ts por módulo
tools/                      scripts de desarrollo: capturas, generadores, hojas de contacto
  assets/                   generadores deterministas de public/assets/ (A6): common.mjs, aperture-masks.mjs, gobos.mjs; solo node:zlib y node:crypto
docs/                       este documento, SPEC, UI, ROADMAP
engine/                     EL MOTOR. Workspace de Cargo, Rust, sin dependencias externas (§5.1)
  Cargo.toml  rust-toolchain.toml  README.md
  crates/rt-core/           el trazador: matemáticas, SIMD, BVH, BSDF, luces, integrador, RSB, PNG;
                            imágenes (RGBE, OpenEXR, inflate, muestreo 2-D) y cielo (E5)
  crates/rt-cli/            binario nativo `rt`: renderiza un .rsb a PNG con hilos; hojas de contacto
                            (las escenas de E5 en scenes.rs)
  crates/rt-wasm/           exportaciones extern "C" para el navegador (sin wasm-bindgen)
  crates/rt-app/            lanzador de escritorio `repackshot`: servidor local, ventana, motor nativo (§5.5)
  crates/rt-post/           la guarda del post-procesado IA y todo su trabajo con píxeles (AI-POST.md §7.2); rt-core no la conoce
  crates/rt-post-wasm/      exportaciones extern "C" de rt-post → public/engine/post.wasm
packaging/                  guiones de empaquetado: portables de Windows y Linux, instalador NSIS (P2)
public/engine/rt.wasm       el motor compilado para el navegador (generado por npm run engine:build; no se sube)
public/engine/post.wasm     la guarda IA compilada (rt-post-wasm), generada por el mismo guion; tampoco se sube
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
- **Herramientas de estudio (A6)**, datos propios y no portados
  (`docs/STUDIO-TOOLS.md`): `lenses.json` (las 16 prescripciones de lente,
  con su cargador tipado en `lenses.ts`), `bokeh.json` (los 20 tipos) y
  `camera-moves.json` (14 movimientos de cámara relativos al producto y
  3 presets de cámara en mano). Sus JSON se leen con una llamada marcada
  `/* @__PURE__ */` para que la página no los lleve en el primer *chunk*
  hasta que algo los use. Las máscaras y los gobos que referencian
  están en `public/assets/` y se generan con `tools/assets/`.

**Assets generados** (`public/assets/`, `tools/assets/`): cada fichero sale de
una receta y una semilla por código puro (solo `+ − × ÷` y `sqrt`, sin
`Math.sin` ni `Math.random`), y su `index.json` guarda receta, semilla y dos
*hashes*: el de los píxeles (canónico) y el del PNG. `tests/assets.test.ts`
los regenera y compara. El servidor de escritorio (`static_files.rs`) solo
trata como inmutables los ficheros de `/assets/` que llevan el *hash* de
contenido de Vite (`nombre-XXXXXXXX.ext`, 8 caracteres, directamente en
`assets/`); los demás (estos assets y sus `index.json`) se revalidan en cada
petición con un ETag del SHA-256 de sus bytes.

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

Vive en `engine/`, un workspace de Cargo con seis *crates*:

| Crate | Qué es | Reglas |
| --- | --- | --- |
| `rt-core` | **El trazador.** Biblioteca: matemáticas, SIMD, BVH, intersección, BSDF, luces, entorno, muestreo, integrador, lector y escritor RSB, codificador PNG, película y tonemapping | Solo `core`/`alloc`/`std` sin APIs del sistema (nada de `fs`, `net`, `time`, `thread`); `#![deny(unsafe_code)]` salvo el módulo `simd`; `#![deny(missing_docs)]`; `f32` en todo; sin `unwrap` en rutas que dependan de la entrada; compila para `wasm32-unknown-unknown` |
| `rt-cli` | Binario nativo `rt`: lee un `.rsb`, renderiza con hilos (`std::thread::scope`, cola de baldosas atómica), escribe PNG, mide rayos/s; hojas de contacto y miniaturas en CI | Puede usar `std` entero |
| `rt-wasm` | `cdylib` con exportaciones `extern "C"` escritas a mano (`rt_alloc`, `rt_free`, `rt_scene_load`, `rt_render_tile`, `rt_render_tile_passes`, `rt_render_tile_albedo`, `rt_version`…). Sin `wasm-bindgen` | El único `unsafe` fuera de `simd`: la reserva de memoria lineal, comentada bloque a bloque |
| `rt-app` | Binario `repackshot`, el lanzador de escritorio (§5.5): servidor local, ventana, motor nativo, datos, equipo | `std` entero, **sin `unsafe`**; lo que necesita del sistema lo pide a procesos del sistema (`reg`, `nvidia-smi`) |
| `rt-post` | **La guarda del post-procesado IA** (X3a, `AI-POST.md` §3.2 y §7.2): condicionamiento (bordes de los cambios de id y de normal, profundidad normalizada), mosaicos de ~1024² con solape de ≥ 128 px y fusión de coseno alzado, relleno a múltiplo de 16 y recorte, la guarda (transferencia de sombreado, separación de frecuencias, regiones por id con ΔE₀₀), las comprobaciones y la máquina de pasos `plan` → `conditioning`/`tile_input` → `accept` con reintentos; informe con la forma de `GuardReport` en JSON escrito a mano | Las reglas de `rt-core`: sin APIs del sistema, `#![forbid(unsafe_code)]`, `f32`, determinista (solo las funciones de `rt_core::fmath` y las curvas de tono de `rt_core::color`, nada de `f32::ln`/`exp`/`powf` de `std`). Depende de `rt-core`; `rt-core` no sabe que existe. En escritorio la enlazará `rt-app` (X3c) |
| `rt-post-wasm` | `cdylib` con exportaciones `extern "C"` escritas a mano (`post_open`, `post_tile_input`, `post_tile_control`, `post_set_output`, `post_accept`, `post_result`…) → `public/engine/post.wasm`, un módulo aparte para que `rt.wasm` no crezca | Su `unsafe` vive solo en `src/ffi.rs`, comentado bloque a bloque; todo cruza como bytes *little-endian*, sin exigir alineación |

**Sin dependencias externas** quiere decir exactamente eso: ningún
*crate* de crates.io en ningún *crate* del workspace. `Cargo.lock` solo
lista `rt-core`, `rt-cli`, `rt-wasm`, `rt-app`, `rt-post` y `rt-post-wasm`,
y CI falla si aparece un `source =`. Todo lo que el motor necesita (vectores, RNG, secuencias de
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
hilos. La guarda IA tiene la misma garantía: `cargo test -p rt-post`
fija en `tests/fixtures/ai-guard.json` el *hash* de la imagen entregada,
el de lo que recibe el modelo y el JSON del informe de cinco escenarios,
y `tests/ai-post-wasm.test.ts` los repite con el `post.wasm` real (en CI,
el trabajo del motor) y exige lo mismo bit a bit.

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

- **`MATL`** (72 B desde E5; los de 56 y 60 B se leen con los valores por
  defecto de lo que les falta): `kind` 0 principal (Lambert + GGX con
  barniz; la parte `transmission` es vidrio claro: reflexión y refracción
  GGX con el Fresnel dieléctrico exacto), 1 vidrio (el principal sin
  metal), 2 emisivo (radiancia `emission × emission_power`); desconocido =
  0. `flags` bit 0: el emisor se muestrea también como luz (por su flujo);
  bit 1: pared fina (sin interior: la luz y los rayos de sombra pasan
  rectos). E5 añade `opacity` (1; por debajo, recorte estocástico),
  `anisotropy` (0) y `absorption_mm` (0; por encima, Beer–Lambert dentro
  del sólido: `base_color` es lo que conserva la luz blanca tras esos
  milímetros).
- **`LGHT`** `kind`: 0 rectángulo, 1 disco, 2 sol, 3 punto y 4 foco
  (L4; se leen y se ignoran); ≥ 5 es error. Rectángulo y disco:
  unilaterales, `power` = flujo en W (mm → m), `spread_deg` = caída cosⁿ
  con la mitad de intensidad a `spread/2` (180 = sin caída). Sol: `power`
  = irradiancia en W/m², disco de `angle_deg`. `flags` bit 0 *glossy*
  (ilumina todos los lóbulos y se ve en reflejos; sin él solo difuso por
  NEE), bit 1 visible a cámara.
- **`ENVR`** (80 B desde E5) `kind`: 0 cúpula (lineal en z: suelo −1,
  horizonte 0, cénit +1, × `strength`), 1 plano, 2 cielo (Preetham, con
  `sky_turbidity` y el sol en `sun_azimuth_deg` / `sun_elevation_deg`,
  escalado a la irradiancia horizontal de la cúpula de los mismos valores;
  suelo neutro bajo el horizonte), 3 HDRI (el mapa `hdri_map`,
  equirectangular en la convención de three.js, girado `rotation_deg` en
  torno a Z; sin mapa, la cúpula); `background_mode`: 0 entorno, 1 color,
  2 transparente (alfa 0), 3 imagen de fondo (`backplate_map`, solo para
  los rayos de cámara, colocada en el marco `backplate_rect` según
  `backplate_fit`: 0 llenar, 1 encajar, 2 estirar; sin mapa, como 1).
- **`BMAP`** (E5, nueva, repetible): `u32 format width height byte_len`,
  los datos y relleno a 4 bytes. `format` 0 RGB de 8 bits sRGB, 1 RGBA de
  8 bits, 2 RGB `f32` lineal, 16 un `.hdr` entero, 17 un `.exr` entero
  (de líneas: sin compresión, RLE, ZIPS o ZIP). El entorno nombra un mapa
  por su posición entre las `BMAP` (`0xffffffff`: ninguno). Un RSB sin
  `BMAP` conserva los mapas cargados, como uno sin `MESH` conserva las
  mallas.
- **`FLOR`** (20 B, una como máximo): `mode` 0 ninguno, 1 plano
  lambertiano infinito, 2 atrapasombras; `z`; `color[3]`.
- **`RNDR`** (40 B desde X2; los de 28 y 36 B se leen con los valores
  por defecto de lo que les falta): además `max_depth` (0 = 8, tope 1024),
  `clamp_indirect` (0 = desactivado) y, desde X2, `passes`: la **máscara
  de pases** exactos que se escriben junto a la imagen, bit *i* =
  `PASS_KEYS[i]` de `src/core/passes.ts` (1 albedo, 2 normal, 4
  profundidad, 8 id de pieza, 16 id de material, 32 círculo de
  confusión). 0, o un RSB anterior a X2, no pide ninguno; los bits que el
  motor no conoce se conservan y se ignoran. `tonemap`: 0 lineal, 1 ACES,
  2 fílmica, 3 AgX, 4 estándar; desconocido = ACES. Exposición 2^ev antes
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
que se ajustaron las recetas; `src/core/photometry.ts`); el ángulo del sol, en grados. Los mapas de bits viajan en secciones `BMAP`
(E5: el HDRI y la imagen de fondo; las texturas de M2 irán igual); la
clave de mallas del escritor TypeScript incluye los ids de las imágenes,
de modo que un cambio de imagen manda la escena entera.

**Pases exactos** (X2, `rt_core::passes`; contrato en `AI-POST.md` §7.4 y
`src/core/passes.ts`). Un plano por pase, `ancho × alto`, por filas desde
arriba a la izquierda como la imagen, en el orden de `PASS_KEYS`. La
normal, la profundidad, los dos ids y el círculo de confusión salen de
**un rayo por el centro del píxel, sin *jitter* y por el centro de la
lente** (`render::centre_ray`), una vez por baldosa
(`render_tile_exact`): son exactos y nunca mezclan los dos lados de una
arista. El albedo sigue el rayo de cámara de cada muestra de la imagen
(la misma posición en el píxel y el mismo punto de la lente) y se suma en
orden de muestra en `f32` y se divide como `Film::resolve`
(`render_tile_albedo`), así que con profundidad de campo se emborrona
como la imagen. El primer impacto (`integrator::first_hit`) es el de la
geometría o el suelo, el más cercano, como en el integrador; toda
superficie lo para (recortes y vidrio incluidos: lo que encuentra
`pick`). El **suelo del estudio** (`FLOR`, visible o atrapasombras) es
`FLOOR_ID` (`0xFFFFFFFF`) en los dos ids, normal `(0, 0, ±1)` hacia la
cámara y albedo `FLOR.color`; el **fondo** (0, profundidad +∞) es el
entorno, la imagen de fondo, la transparencia y un panel de luz visible
a cámara cruzado antes que nada. Los pases tienen sus propios rayos: no
tocan la película ni sus números aleatorios, y la imagen conserva su
*hash* (`render/passes_tests.rs` lo comprueba con los tres ejemplos
fijados). Los *hash* de los seis planos del ejemplo y del ejemplo de E5
están fijados (`PINNED_PASS_*`, `PINNED_E5_PASS_*`) y se repiten en cada
ruta SIMD, en WASI (escalar y `simd128`), en el `rt_wasm.wasm` real
(`tools/wasm-parity.mjs --expect-passes`, en CI) y por la API del
lanzador con 1 y 4 hilos. El círculo de confusión es el de
`src/core/lens-coc.ts` (los dos lados leen `tests/fixtures/lens-coc.json`)
y coincide, dentro de 1 %, con el desenfoque medido de la propia lente
de `Camera::generate_ray`.

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
de salida y con el presupuesto de la barra de render. Con `passes`
(`RenderOptions`, X2) cada trabajo lleva la máscara; el worker devuelve,
con cada baldosa, el albedo de cada muestra (`rt_render_tile_albedo`) y,
en el trabajo que empieza en la muestra 0, sus planos exactos
(`rt_render_tile_passes`), y el hilo principal los junta con
`PassAccumulator` (`src/render/pass-planes.ts`) igual que la imagen: el
resultado es el del motor nativo bit a bit y vuelve como `RenderPasses`.

**Mientras corre un *Render*, el visor sigue vivo** (P3a): se queda con la
cuarta parte de los workers (al menos uno; en un pool de uno, espera) y el
render usa los demás en cada pasada, o todos si el visor está en
*Rápido*; con *Ajustes ▸ Motor de render ▸ Mientras se renderiza ▸ Pausar
el visor*, el visor espera y el render los usa todos. Qué worker renderiza
una baldosa no cambia un píxel, así que el render da los mismos bits con o
sin visor. Cada worker tiene una sola escena: el pool recuerda la última
que mandó a cada uno, y un worker que cambia de manos recibe la otra como
actualización (las mallas se quedan). Como el render y el visor van a la
vez, una cancelación es de una generación exacta, y un worker que pasa a
otra generación para la que tenía. Al terminar el render, el visor vuelve
a empezar en todos los workers.

**Nunca parado en silencio** (P3a, `src/render/watchdog.ts`, el mismo en
los dos motores): en cada fotograma se comprueba que la vista en curso
recibe baldosas (en nativo, que el lanzador contesta y que llegan
pasadas, con el plazo según lo que tardó la anterior) y que lo que llega
se pinta; si no, la vista vuelve a arrancar, la consola lo dice y el
medidor también (una nota bajo la barra). Los plazos se doblan cada vez
que salta sin progreso entre medias, para no reiniciar una escena que solo
es lenta, y una ventana oculta no cuenta. Un temporizador pinta si el
bucle de animación de la página dejara de llamar, y ese bucle (`main.ts`)
ya no se para por una excepción en un fotograma.

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
`#![deny(unsafe_code)]` y nada de `platform/` entra en `rt-core`. Hace estas cosas:

1. **Servir la interfaz**: un servidor HTTP/1.1 mínimo en `127.0.0.1`,
   con la carpeta `app/` (el `dist/` de Vite) junto al ejecutable.
   Comprueba la cabecera `Host` (contra el *DNS rebinding*) y exige en la
   API un *token* aleatorio por arranque que solo conoce la página que
   abrió. **Puerto estable por carpeta de datos** (P3e, `src/port.rs`):
   se apunta en `<datos>/launcher.json` y se vuelve a usar en el siguiente
   arranque si está libre; solo si está ocupado se toma otro libre, que
   pasa a ser el apuntado (`--port N` usa N y no apunta nada). Así el
   origen de la ventana (`http://127.0.0.1:<puerto>`) no cambia de un
   arranque a otro.
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

   Con lo aprendido en P3a: la página manda **una vista de visor cada
   vez**, numerada (`seq`; una que llega tarde recibe 409 `stale` y no
   sustituye a una más nueva), y **lee o cancela siempre el cuerpo de cada
   respuesta**: una sin leer retiene una de las seis conexiones HTTP/1.1
   que el navegador abre al lanzador, y con las seis retenidas todo
   esperaba para siempre (el visor, el render y *Pausar* de la v0.1.0).
   Con `share=<hilos>` el trabajo de visor **sigue vivo mientras corre un
   final**, en esos hilos (la página pide la cuarta parte, al menos uno),
   y el final se queda con el resto, o con todos cuando no queda un visor
   vivo; sin `share` (*Pausar el visor*), el visor se para entre baldosas.
   Bandera 32 de la trama: comparte, y la cabecera dice con cuántos hilos.
   El lanzador corta a los 10 s la escritura de una trama que nadie lee;
   un trabajo por el que nadie pregunta se para solo (visor a los 10 s,
   final a los 20 s: su página se fue); con las 8 ventanas ocupadas, una
   que lleva 3 s sin preguntar (una página recargada) cede su sitio, así
   que las recargas solas nunca llegan a 503 `busy`; un render que entra
   en pánico termina como fallido y suelta la puerta, y un trabajo que no
   se para en 5 s se deja atrás sin su escena. `GET /api/render/state` da
   el diagnóstico (la puerta, los trabajos, las ventanas, las conexiones)
   y con `log=1` lo apunta en el registro: lo pide el *watchdog* de la
   página cuando salta. Las peticiones de *Render* llevan la señal de
   cancelación, así que *Pausar* y *Detener* responden al momento aunque
   el lanzador no conteste. El contrato completo, en
   `engine/crates/rt-app/README.md`.

   **Pases** (X2): un trabajo final con `passes=albedo,normal,…` (y los
   de `RNDR.passes`) los renderiza junto a la imagen con los hilos que
   tenga (también con los que le deja un visor que comparte), y al
   terminar con todas sus muestras (no si se cancela, queda huérfano o
   falla) el lanzador **guarda la imagen lineal y sus pases por id del trabajo**
   (`src/kept.rs`) antes de decir que ha terminado, para la tubería de la
   IA (`AI-POST.md` §7.3); borrar el trabajo (`DELETE`) no los borra.
   Guarda los cuatro últimos; uno de más de 64 MiB entre imagen y pases
   va a `<datos>/cache/ai/<id>.rpx` (la trama `RPX1`) y `<id>.rpp`
   (los pases) en lugar de quedarse en memoria, y lo que dejó un arranque
   anterior se borra al arrancar (los ids empiezan de nuevo).
   `GET /api/render/<id>/passes` los devuelve en binario: cabecera
   `RPP1` de 32 bytes (*magic*, longitud de la cabecera, ancho, alto,
   máscara, muestras del albedo, id, 0) y los planos de la máscara en el
   orden de `PASS_KEYS`, palabras *little-endian* (`f32`; `u32` los
   ids); 404 si el id no existe, fue desalojado o no pidió pases, 409
   `not-ready` mientras se renderiza. `native.ts` los lee con
   `parsePasses` (`src/render/pass-planes.ts`) y los devuelve con el id
   del render. Contrato en `engine/crates/rt-app/README.md`.
4. **Datos y modelos**: carpeta de datos en `%LOCALAPPDATA%\Repackshot`
   (Windows) o `$XDG_DATA_HOME/repackshot` (Linux); en las versiones
   **portables** (un fichero `portable.txt` junto al ejecutable), en
   `data/` al lado, con todo dentro. Los modelos de IA se guardan ahí: la
   página los descarga con `fetch` y los entrega al lanzador por trozos,
   que los escribe, reanuda y comprueba con un SHA-256 propio.
5. **El estado de la página** (P3e, `src/appdata.rs`): en escritorio la
   página es **solo la interfaz** y todo lo que guarda lo escribe el
   lanzador en la carpeta de datos, nunca el almacenamiento del navegador
   de la ventana. `/api/store/*` y `/api/storage/usage`, con el mismo
   *token*, `Host` y `Origin`, nombres en minúscula confinados a la
   carpeta de datos (ni enlaces ni nombres de dispositivo de Windows) y
   escrituras atómicas (temporal, `sync_all`, `rename`). La carpeta:

   ```text
   settings.json        el documento de ajustes (src/core/settings.ts)
   state/<nombre>.json  cosas pequeñas de la página: descargas por reanudar, carpetas elegidas,
                        la marca de la migración desde el navegador
   library/             la biblioteca propia (U4)
   results/             el historial: un archivo por resultado (png, jpg, exr) e index.json
   cache/thumbs/        las esferas de materiales (caché)
   cache/ai/            la imagen y los pases de los renders finales grandes que guarda el lanzador (X2)
   models/              los modelos de IA, por sha256
   logs/                el registro del lanzador
   browser-profile/     el perfil de la ventana de Edge o Chromium
   webview2/            el perfil de la ventana propia (P3c); window.json, su sitio
   launcher.json        el puerto; instance.json, la instancia en marcha
   pending-models.json  lo que eligió el instalador
   ```

   En la página, **la costura de plataforma** (`src/io/platform.ts`): una
   interfaz `Platform` con todo servicio que guarda algo o pregunta al
   equipo (ajustes, cosas pequeñas recordadas, biblioteca, historial de
   resultados, almacén de modelos, equipo, espacio usado, miniaturas,
   archivos de salida, proyectos, diálogos de importar y exportar),
   elegida una vez al arrancar (`choosePlatform()`, antes de pintar nada)
   con dos implementaciones: la web (`platform-web.ts`: localStorage,
   IndexedDB, OPFS, WebGPU, los selectores y descargas del navegador) y
   la del lanzador (`platform-desktop.ts`: lo anterior, más `/api/hardware`
   y los diálogos y la API de archivos de P3b). `main.ts` construye con
   ella los servicios de la interfaz, que no sabe cuál es. En escritorio
   la página no toca el almacenamiento del navegador salvo una vez por
   carpeta de datos, para copiar al lanzador lo que una versión anterior
   dejó en el origen actual (marca `state/migration.json`).
6. **Diálogos y archivos** (P3b): `POST /api/dialog/{folder,open,save}`
   abre los diálogos del sistema y devuelve un permiso por ruta; la API de
   archivos (`/api/files…`) solo lee o escribe rutas concedidas así en el
   arranque actual, con escritura atómica y sin sobrescribir en las
   carpetas de salida. La página nunca nombra una ruta que no le diera un
   diálogo.
7. **Equipo**: `repackshot --hardware <fichero>` escribe la GPU con su
   VRAM, la RAM y la recomendación de `src/data/ai-models.json`
   (registro de Windows y `/proc`, `/sys` o `nvidia-smi` en Linux, por
   procesos del sistema y sin `unsafe`); lo usan el instalador y
   *Ajustes ▸ Post-procesado IA ▸ Equipo*.
7. **Post-procesado IA, el motor de ejecución** (X3b, `src/ai/`): la compilación de
   stable-diffusion.cpp que elige la regla de `src/data/ai-runtimes.json` (Vulkan si el equipo
   tiene GPU que usar, CPU si no, o la que se fuerce) se descarga con el `curl` del sistema
   (solo `https`, reanudable, a `<datos>/ai/runtimes/<sha256>.zip.part`), se comprueba con el
   SHA-256 propio (si no coincide, no se instala nada), se descomprime con un lector de zip e
   *inflate* propios (RFC 1951) en `<datos>/ai/runtimes/<sha256>/` y se le pregunta
   `--version` y `--list-devices`. Para inferir, el lanzador arranca `sd-server` con los
   argumentos de la familia del modelo (rutas del almacén de modelos), sin ventana de consola,
   en `127.a.b.c` aleatoria y puerto libre, lo mantiene cargado entre llamadas, sigue su
   progreso en la salida estándar, lo para si calla o tarda más de la cuenta, si se cancela, a
   los 5 min sin uso y al cerrar, y limpia el que dejara un arranque anterior. API:
   `GET /api/ai/runtime` (un `AiRuntimeStatus` de `src/core/ai.ts` y más),
   `/api/ai/runtimes/<clave>[/download|/pause|/import|/probe]`, y **`POST /api/ai/run`**: una
   inferencia *img2img* en crudo, sin guarda (imagen y control en PNG), con progreso por
   `GET /api/ai/run/<id>?after=n`, imagen en `/image` y cancelación con `DELETE`, como los
   trabajos de render. La guarda, los mosaicos y la tubería son X3a y X3c. Contrato completo en
   `engine/crates/rt-app/README.md`.

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

### 6.1 · El puerto del visor (`src/ui/ports.ts`)

La interfaz no importa `render`: `main.ts` construye un `ViewportPort`
sobre el motor que está en pantalla y se lo entrega. Es lo único que la
interfaz sabe del visor:

- **Imagen y tamaño**: `kind` (`'preview'` o `'pathtracer'`), `canvas`,
  `backdrop` (la imagen del modo Completo, bajo el lienzo) y `resize`.
- **Geometría, que es siempre la de la vista previa en los dos modos**:
  `pick(x, y)` (la pieza, el triángulo, el punto y la normal bajo un
  punto del lienzo), `projection()` y `visibleTriangles(part, rect)`.
  - `projection(): Projection | null` da cómo se proyectan las piezas
    **tal como se dibujan ahora** (ancho y alto en píxeles CSS y
    `mvp(part)`, la matriz modelo-vista-proyección de una pieza). La
    selección por caja (`core/box-select.ts`) prueba con ella la
    geometría en pantalla, sin tocar three.
  - `visibleTriangles(part, rect): Set<number> | null` devuelve los
    triángulos de una pieza que se **ven** dentro de un rectángulo (px
    CSS del lienzo): la vista previa dibuja la escena con un id de color
    por triángulo en un destino fuera de pantalla, lee el rectángulo y
    solo cuenta un píxel cuyos cuatro vecinos llevan el mismo id (una
    erosión que quita los de silueta que se escapan de lo oculto). Lo que
    otras piezas o la propia pieza tapan no cuenta; `null` si el visor no
    puede decirlo. *Rayos X* no lo usa: coge por geometría.
- **Resaltados**: `setHover(ids)` (contorno de piezas: bajo el cursor o
  bajo un material arrastrado) y `setHoverFaces({ part, indices } | null)`
  (las caras que alcanzaría un material arrastrado a nivel *Caras*: un
  tinte sobre la pieza, en una capa aparte de la de las caras
  seleccionadas).
- **Herramientas y *gizmo***: `setTool`, `setGizmo`, `gizmoHover`,
  `gizmoBegin`, `gizmoDrag`, `gizmoEnd`. `setGizmo` lleva `handles`
  opcional (U9): `ALL` (Mover) o `SCALE` (Escalar: solo los cubos al final
  de cada eje y el punto central, que es lo único que se dibuja y se coge).
- **Estado y miniaturas**: `status`, `onFrame`, `materialThumbnail`,
  `thumbnailsPending`; **ajustes**: `setNavigation`, `setDisplay`.

Los tres métodos nuevos de U7 y M1 (`projection`, `visibleTriangles`,
`setHoverFaces`) son, en `main.ts`, una línea cada uno hacia la vista
previa. Un doble de pruebas del visor basta para probar la selección por
caja sin navegador (`tests/box-select.test.ts`); el gesto y lo que se
ve se comprueban con `tools/box-select-check.mjs` y
`tools/material-drag-check.mjs`.

---

## 7 · Pruebas

| Qué | Dónde | Cómo |
| --- | --- | --- |
| Catálogos y matemáticas de luz | `tests/data.test.ts`, `light-math`, `rig` | Recuentos fijados, fórmulas con números, normalización 16 × 71 |
| Modelo | `tests/store.test.ts`, `scene`, `materials`, `doctor`… | Acciones puras: dado un estado, la acción produce el esperado; deshacer lo devuelve |
| Interfaz | `tests/strings.test.ts`, `ui-achromatic.test.ts` | Invariantes estáticas sobre fuentes |
| Selección y arrastre | `tests/faces.test.ts`, `material-drop`, `box-select` | Caras con placa, cilindro, redondeo y rangos CAD; reglas de suelta con números; ventana y cruce sobre geometría proyectada con un visor simulado; qué teclas arman la caja en cada esquema del ratón |
| Primitivas y escala | `tests/primitives.test.ts`, `primitive-ops` | Cada forma: estanca donde debe, normales hacia fuera, UV en [0, 1], caras lógicas que cubren la malla, mismos bytes, medidas exactas en mm y volúmenes analíticos; dónde nace (base 1,4 × la huella, producto encima, una entrada de deshacer; el fondo infinito llena el encuadre y deja delante de su pared los focos del montaje), edición viva y deshacer, guardar y abrir byte a byte, escala por eje, uniforme y a medida alrededor del pivote a cada nivel, las asas de *Escalar* |
| Gestos en el navegador | `tools/material-drag-check.mjs`, `box-select-check.mjs`, `primitives-check.mjs` (U9) | Playwright con el Chromium local sobre `dist/`, en Rápido y en Completo, con ratón, lápiz y dedo; capturas en `docs/ui/` (las de Completo, en `out/`) |
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
porque la vista previa y los workers cachean por id. **Imágenes del
entorno** (E5): un bloque opcional `"images": [{ "id", "name", "file" }]`
con el HDRI y la imagen de fondo como los archivos que eran (`file` en
base64); se escribe solo cuando el entorno tiene alguna. Al abrir se
decodifican otra vez (`placeImages`): una imagen cuyo id ya nombra otra en
la sesión recibe un id nuevo, y una que falta o no se lee se quita del
entorno (ilumina la cúpula, se ve el color) con el aviso `MISSING_IMAGES`,
sin impedir abrir. El esquema sigue en 2: los campos nuevos del entorno
tienen valor por defecto. **Primitivas** (U9): una pieza hecha con
*Añadir ▸ Primitiva* guarda su forma y sus medidas en el campo opcional
`primitive` (`{ "kind": "BOX", "params": { "width": 88.5, … } }`) de su nodo,
y su malla **no** va en `meshes`: al abrir se genera otra vez de las medidas
(normalizadas), bajo el id que tenía (`prim:<dueño>:<FORMA>:<medidas>`, que
nombra el contenido), con su `MeshRef` y sus `faceRanges`; un proyecto con
primitivas se guarda, se abre y se vuelve a guardar en los mismos bytes.
Un archivo sin el campo abre como siempre; una forma que esta versión no
conoce (un archivo más nuevo) se queda sin el campo y su pieza sin
geometría, con el aviso `MISSING_MESHES`; un `primitive` que no es un
objeto es daño. El esquema sigue en 2. Una versión anterior a U9 que abra
un proyecto con primitivas no las verá (sin malla en el archivo): solo
compatibilidad hacia atrás, como se decidió. El motor recibe la malla como
una más: el RSB no cambia.
