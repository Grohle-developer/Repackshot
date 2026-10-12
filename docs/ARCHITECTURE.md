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
| Vista previa | **three.js** (`WebGLRenderer`) | Rasterizado rápido para orbitar, seleccionar y colocar; materiales físicos y luces de área listos |
| Render final | **Trazador de caminos propio en WebGPU** (fases R·) con *fallback* a WebGL2 | Es lo que hace que el producto sea el producto: la imagen progresiva que converge en el propio visor. Base de partida permitida: `three-gpu-pathtracer` (MIT) como referencia de arquitectura y como motor provisional detrás de la interfaz `RenderEngine` |
| Importación | `GLTFLoader` de three para GLB/glTF; OBJ y STL propios (son triviales); STEP en una fase propia con `occt-import-js` si su licencia (LGPL-2.1 con excepción) se confirma compatible, o nada | glTF es el formato de intercambio moderno; STEP es lo que trae quien viene de CAD y hay que resolverlo, pero sin hipotecar la licencia |
| Tests | **vitest** (unidad e integración del modelo), **playwright-core** con el Chromium local para capturas y humo de interfaz | La suite corre sin GPU en CI; el visor se prueba con captura |
| Empaquetado de escritorio | Fuera de alcance hasta v0.3; cuando llegue, **Tauri** | Pequeño, sin Chromium embebido; la aplicación web no cambia |

Lo que **no** se usa: React/Vue/Svelte, Tailwind, fuentes de iconos,
fuentes de red, Electron, WASM de terceros con licencia no compatible,
ningún binario ni recurso de KeyShot (ver `README.md`, reglas de sala
limpia).

Añadir una dependencia exige una línea en esta tabla con su licencia
(solo MIT, Apache-2.0, BSD, ISC, CC0 o compatibles).

**Versiones instaladas** en el andamiaje inicial: three 0.186, Vite 8,
TypeScript 7, vitest 5, playwright-core 1.64 (el `package-lock.json` es
la verdad; esta lista orienta).

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
  render/                   MOTORES. Dependen de core, nunca de ui
    engine.ts               la interfaz RenderEngine (§5)
    preview.ts              three.js: vista previa rasterizada
    pathtracer/             fases R·: trazador progresivo
  io/                       IMPORTADORES Y EXPORTADORES. Dependen de core
    gltf.ts  obj.ts  stl.ts  project.ts (.repack.json)  image.ts (PNG/JPEG/EXR)
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
```

**Regla de dependencias**: `ui → core`, `render → core`, `io → core`,
`core → data`. Nunca al revés, nunca `ui → render` directamente (el
*store* expone lo que el visor necesita y el visor se suscribe). Un test
de la suite (`tests/boundaries.test.ts`, fase A2) recorre los `import` y
falla si se viola.

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
  irradiancia total; `energy` (estudios) vatios a tamaño 1. `kelvin` o
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

## 5 · Motores (`src/render/engine.ts`)

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
- El cambio de motor es una acción del store; `main.ts` instancia el que
  toque y le pasa el mismo canvas.

---

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
| Motor (fases R·) | `tests/pathtracer/*.test.ts` + hoja de contactos | Escenas analíticas (furnace test, esfera difusa bajo cielo uniforme) con tolerancias numéricas; hoja preset × montaje con estadísticas (media, quemados, tapados) |

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

`{ "format": "repackshot-project", "schema": 1, "state": ProjectState }`.
Las mallas importadas se guardan **dentro** como GLB en base64 por defecto
(un proyecto es un archivo), con opción de referencia externa por ruta.
Las migraciones de esquema viven en `io/project.ts` y se prueban con un
fichero fijo por versión.
