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
independiente con el que comparar (E5). E5 no añade dependencias. E5c
tampoco: el simulador de atmósfera y el ajuste del cielo físico
(`engine/crates/rt-sky`) son Rust propio solo con `std`, y lo que producen
entra en el repositorio como datos (`rt-core/src/sky_table.rs` y
`src/core/sky-table.ts`, con su receta y su *hash*).

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
    lighting.ts             rig activo, focos (los del montaje y los propios de L4: añadir, duplicar, eliminar, apuntar, colocar sobre superficie), su colocación (`lightFrame`: posición, objetivo, giro), colocación por reflejo, lúmenes
    view-objects.ts         luces y cámaras como objetos del visor (L4): su *gizmo* y lo que hace un arrastre, *Mirar a través* y lo que hace la navegación, los glifos y el clic que coge uno
    camera.ts               óptica, encuadre, cámaras guardadas
    optics.ts               la óptica de una cámara más allá de la lente fina (O1): bokeh, inclinación y descentramiento; neutra, límites, tipos de bokeh; la pila de filtros de efecto (O3a)
    aperture.ts             registro de las imágenes de pupila (máscaras y texturas) a 256², como el de imágenes (O1)
    animation.ts            planos, movimientos, evaluación en el tiempo
    camera-moves.ts         expande un movimiento de cámara de data/camera-moves.json en las barras de la línea de tiempo para una cámara (A6)
    doctor.ts               chequeos y arreglos sobre el modelo
    images.ts               registro de imágenes del entorno (HDRI, imagen de fondo), como el de mallas (E5), y de las texturas (M2a)
    textures.ts             texturas de imagen y etiquetas de un material (M2a): ranuras, mapeado, etiquetas, sus acciones `texture/*`, y la matemática de las proyecciones y de las etiquetas que siguen el shader y el motor
    texture-images.ts       las imágenes de textura en el registro: id por contenido, límites (M2a)
    image-header.ts         tamaño y canales de un PNG o un JPEG por su cabecera, sin decodificar (M2a)
    sky.ts                  el cielo del motor portado para la vista previa: el físico de E5c (por defecto) y el de Preetham (E5)
    sky-table.ts            los coeficientes del cielo físico, generados por `rt-sky table` (los mismos f32 y el mismo hash que rt-core)
    faces.ts                caras enteras: cara CAD o superficie que continúa; piezas de «Separar por caras CAD» (M1)
    material-drop.ts        a qué llega una suelta de material y qué asigna (U7)
    box-select.ts           selección por caja: geometría en pantalla, ventana y cruce, qué gesto la arma (U7)
    primitives.ts           primitivas paramétricas: generadores puros y deterministas (caras lógicas, UV, normales), medidas válidas, id de malla `prim:<dueño>:<FORMA>:<medidas>` (U9)
    primitive-ops.ts        las primitivas en la escena: dónde nacen (base bajo el producto, junto a él, bajo él), añadir, editar en vivo, convertir en malla; `fitSweep` ajusta el fondo infinito a la cámara y a los focos traseros (U9)
    light-math.ts           kelvin → rgb, irradiancia, polar, ease   (portado)
    rig.ts                  studioRig / setupRig normalizados           (portado); el reparto del charco de un set (L6)
    sets.ts                 los sets (L6): aplicar, sustituir y quitar su decoración (tarjetas, barrido, suelo, charco), su aspecto, Usar la cámara del set
    wear.ts                 valores por defecto del desgaste            (portado)
    version.ts
  data/                     CATÁLOGOS. Solo datos y tipos (§3); primitives.json + primitives.ts: las doce formas de Añadir ▸ Primitiva (U9)
  render/                   MOTORES DEL LADO WEB. Dependen de core, nunca de ui
    engine.ts               la interfaz RenderEngine (§5)
    preview.ts              three.js: vista previa rasterizada mientras se mueve la cámara; `aiFrame` (X4): el fotograma del modo Rápido y sus pases
    texture-shader.ts       el shader de texturas de Rápido (M2a): GLSL puesto en el MeshPhysicalMaterial de three con `onBeforeCompile`, montado sin GPU
    texture-preview.ts      las texturas y etiquetas en Rápido: el shader en cada material y la caché de texturas por imagen, con mipmaps (M2a)
    lens-filter-image.ts    los filtros de efecto de la lente en imagen (O3a): los núcleos en píxeles y su convolución en TS, la referencia del pase WebGL
    lens-filter-pass.ts     el pase WebGL de esos núcleos en el modo Rápido (objetivo lineal de medio flotante, gaussianas a tamaño reducido, rayas y puntos a media resolución)
    preview-passes.ts       los pases de AI-POST.md §7.4 dibujados con three.js (albedo, normal, profundidad, ids exactos, coc) para la vista previa de la IA (X4); el suelo, con los rayos centrales del motor (X3c)
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
    project.ts (.repack.json)  library.ts (biblioteca propia, JSON)  image.ts (PNG/JPEG/EXR/TIFF/DNG)
    rsb.ts                  escritor del formato de escena binario del motor (§5.2); `materialOrder`, el orden de materiales que numeran los pases (X3c)
    ai-runtime.ts           el motor de ejecución de la IA del lanzador (X3b); ai-post.ts, la tubería de escritorio (`DesktopAiService`, X3c)
    hdri.ts                 lectores propios de RGBE y OpenEXR, imagen de fondo, copia para la vista previa (E5)
    aperture.ts             lee las imágenes de pupila de public/assets/aperture (PNG gris propio, sin canvas) y las promedia a 256² (O1)
    gltf-materials.ts       los materiales y las imágenes de un glTF leídos de su JSON (M2a)
    mtl.ts  obj-materials.ts  las bibliotecas .mtl de un OBJ y sus imágenes (M2a)
    texture-notes.ts        lo que la hoja dice de las texturas de un archivo (M2a)
    texture-pixels.ts       los píxeles de las texturas para la sección IMGS del RSB (M2a; la lee M2b)
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
      insp-lens.ts          Cámara ▸ Bokeh (miniaturas del motor) y Óptica avanzada (O1)
      insp-filters.ts       Cámara ▸ Filtros: la pila de filtros de efecto de la lente (O3a)
      insp-textures.ts      inspector ▸ Texturas: ranuras, mapeado y etiquetas (M2a)
      viewport-labels.ts    la herramienta de etiqueta del visor: colocar con pulsación y arrastre, Mover etiqueta (M2a)
    texture-commands.ts     lo que hacen las ranuras y las etiquetas del inspector (M2a)
public/
  thumbs/setups/            88 miniaturas de montaje de luz renderizadas por el motor (PNG) y manifest.json (L6, tools/setup-thumbs.mjs)
  thumbs/bokeh/             30 miniaturas de bokeh renderizadas por rt (16 tipos del modo 1 y sus variantes) + index.json (O1, tools/bokeh-thumbs.mjs)
  assets/aperture/          45 máscaras de diafragma y texturas de pupila (PNG 512², gris de 8 bits) + index.json (A6)
  assets/gobo/              12 patrones de gobo (PNG 1024², gris de 8 bits) + index.json (A6)
  assets/README.md          procedencia: generador, receta, semilla y hash de cada fichero
  example/                  nada: la pieza de ejemplo es procedural
tests/                      vitest; *.test.ts por módulo
tools/                      scripts de desarrollo: capturas, generadores, hojas de contacto
  setup-thumbs.mjs          las miniaturas de montaje (L6): escenas con el código de la app (tests/setup-thumbs-dump.test.ts, vitest) y `rt`
  sets-sheet.mjs            la hoja de contactos de los sets (L6): out/sets-sheet.html; rt-batch.mjs, lo que comparten
  sets-check.mjs            comprobación en el navegador de los sets (L6): catálogo, aplicar, En el set, Restablecer; docs/ui/sets-catalogue.png
  assets/                   generadores deterministas de public/assets/ (A6): common.mjs, aperture-masks.mjs, gobos.mjs; solo node:zlib y node:crypto
docs/                       este documento, SPEC, UI, ROADMAP
engine/                     EL MOTOR. Workspace de Cargo, Rust, sin dependencias externas (§5.1)
  Cargo.toml  rust-toolchain.toml  README.md
  crates/rt-core/           el trazador: matemáticas, SIMD, BVH, BSDF, luces, integrador, RSB, PNG, TIFF y DNG (U12);
                            imágenes (RGBE, OpenEXR, inflate, muestreo 2-D) y cielo (E5; el físico, E5c)
  crates/rt-cli/            binario nativo `rt`: renderiza un .rsb a PNG, TIFF o DNG con hilos; hojas de contacto
                            (las escenas de E5 en scenes.rs)
  crates/rt-wasm/           exportaciones extern "C" para el navegador (sin wasm-bindgen)
  crates/rt-app/            lanzador de escritorio `repackshot`: servidor local, ventana, motor nativo (§5.5)
  crates/rt-post/           la guarda del post-procesado IA y todo su trabajo con píxeles (AI-POST.md §7.2); rt-core no la conoce
  crates/rt-post-wasm/      exportaciones extern "C" de rt-post → public/engine/post.wasm
  crates/rt-sky/            herramienta fuera de línea `rt-sky` (E5c): simulador espectral de la atmósfera, ajuste
                            Levenberg–Marquardt del cielo físico y su tabla; escribe rt-core/src/sky_table.rs,
                            src/core/sky-table.ts y tests/fixtures/sky-physical.json
packaging/                  guiones de empaquetado: portables de Windows y Linux, instalador NSIS (P2)
public/engine/rt.wasm       el motor compilado para el navegador (generado por npm run engine:build; no se sube)
public/engine/post.wasm     la guarda IA compilada (rt-post-wasm), generada por el mismo guion; tampoco se sube
```

**Cómo entran las texturas** (M2a). Cada lector deja los materiales del
archivo como instancias con sus ranuras ya puestas (las imágenes por su id
de contenido) y una lista de `ImportTexture` (`core/import-options.ts`):
el archivo de cada imagen, sus materiales, y si se guarda o por qué no. glTF
lee sus materiales e imágenes de su JSON (`io/gltf-materials.ts`) y pasa a
`GLTFLoader` el mismo archivo sin texturas (no decodifica dos veces, y en
Node no podría); OBJ lee sus `.mtl` (`io/mtl.ts`, `io/obj-materials.ts`);
FBX, Collada, 3MF, USD y 3DM toman los mapas que su cargador de three
carga (`collectTextures` de `io/three-scene.ts`: el archivo original cuando
el cargador lo tiene en un *blob* o un *data URL*, si no un PNG dibujado,
solo en el navegador), con un `LoadingManager` que encuentra entre los
**archivos elegidos con el modelo** (`ImportReadOptions.companions`) las
imágenes, los `.bin` y las bibliotecas que nombra. `applyImportOptions` se
queda con las imágenes de los materiales que se quedan; al pulsar
*Importar* (`ui/commands.ts`) se aplica el presupuesto del proyecto
(`fitTextureBudget`, 64 MB), se registran las que caben y se quitan de los
materiales las que no. La vista previa decodifica cada imagen una vez
(`createImageBitmap`) y la sube con mipmaps; el RSB la recibe decodificada
(arriba).

**Regla de dependencias**: `ui → core`, `render → core`, `io → core`,
`core → data`. Nunca al revés, nunca `ui → render` directamente (el
*store* expone lo que el visor necesita y el visor se suscribe). Un test
de la suite (`tests/boundaries.test.ts`, U2) recorre los `import` y
falla si se viola; hoy no hay ninguna infracción. El motor (`engine/`) no conoce nada de `src/`: su
única interfaz con el resto es el formato RSB (§5.2) y las exportaciones
de `rt-wasm` (§5.3). La excepción es de herramienta, no del motor: `rt-sky`
(fuera de línea) escribe la copia TypeScript de la tabla del cielo y un
test suyo comprueba que coincide con la de `rt-core`.

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
  usa el rig del tipo de producto. **Set** (L6, todo opcional: los 72
  montajes portados no tienen nada): `backdrop` (`SetBackdrop`: `FLAT`,
  `GRADIENT` arriba y abajo, `SWEEP`), `pool` (`SetPool`: `az`, `el`,
  `cone`, `share`, `kelvin` o `color`), `floor` (`SetFloor`: `CATCHER`,
  `MATTE`, `GLOSSY`, `MIRROR`, con `material` y `color`), `cards`
  (`SetCard`: `material`, `az`, `el`, `dist`, `size`, `sizeY`, `roll`),
  `exposureEv`, `envStrength`, `camera` (`SetCamera`: `el`, `focalMm`),
  `hero` (`SetHero`), `why` (`Label`) y `caustics`. Los 16 sets son el
  estilo `SETS`, el primero; dos claves del plan ya existían
  (`DARK_FIELD`, `TEAL_ORANGE`) y sus sets son `GLASS_DARK_FIELD` y
  `WARM_COOL_CINEMA`. **`StudioPreset.set`** (L6): el set que es el rig
  propio del tipo de producto (sus focos, al nivel del tipo; con `PRESET`,
  su decoración y su aspecto; su desvío de exposición ya sumado a
  `exposure`); `PRESET_SETS` lo resume. `tests/preset-rigs-sync.test.ts`
  (con `REPACKSHOT_SYNC_PRESETS=1`) reescribe los focos y la exposición de
  esos tipos desde sus sets tras afinar uno.
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
la fija para las 16 × 71 combinaciones. El charco de un set (L6) entra en
la suma como un foco a `POOL_THROW` = 2,5 tamaños de pieza
(`poolWeight`): el set y su charco suman el nivel del tipo; sus focos, el
resto. Los rigs de tipo de producto de L6 conservan el nivel de antes
(`tests/fixtures/old-setup-rigs.json` guarda los niveles y la forma de los
71 montajes anteriores, y `tests/sets.test.ts` los compara).

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
               maxSamples: number; maxSeconds: number; format: 'PNG' | 'JPEG' | 'EXR' | 'TIFF' | 'DNG'; transparent: boolean;
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

Vive en `engine/`, un workspace de Cargo con siete *crates*:

| Crate | Qué es | Reglas |
| --- | --- | --- |
| `rt-core` | **El trazador.** Biblioteca: matemáticas, SIMD, BVH, intersección, BSDF, luces, entorno, muestreo, integrador, lector y escritor RSB, codificador PNG, película y tonemapping | Solo `core`/`alloc`/`std` sin APIs del sistema (nada de `fs`, `net`, `time`, `thread`); `#![deny(unsafe_code)]` salvo el módulo `simd`; `#![deny(missing_docs)]`; `f32` en todo; sin `unwrap` en rutas que dependan de la entrada; compila para `wasm32-unknown-unknown` |
| `rt-cli` | Binario nativo `rt`: lee un `.rsb`, renderiza con hilos (`std::thread::scope`, cola de baldosas atómica), escribe PNG, mide rayos/s; hojas de contacto y miniaturas en CI | Puede usar `std` entero |
| `rt-wasm` | `cdylib` con exportaciones `extern "C"` escritas a mano (`rt_alloc`, `rt_free`, `rt_scene_load`, `rt_render_tile`, `rt_render_tile_passes`, `rt_render_tile_albedo`, `rt_scene_caustics`, `rt_denoise`, `rt_version`…). Sin `wasm-bindgen`; enlaza `rt-post` solo por su *denoise* (E5b-1) | El único `unsafe` fuera de `simd`: la reserva de memoria lineal, comentada bloque a bloque |
| `rt-app` | Binario `repackshot`, el lanzador de escritorio (§5.5): servidor local, ventana, motor nativo, datos, equipo | `std` entero, **sin `unsafe`**; lo que necesita del sistema lo pide a procesos del sistema (`reg`, `nvidia-smi`) |
| `rt-post` | **El *denoise* propio** (E5b-1, `rt_post::denoise`, §5.2 bis) y **la guarda del post-procesado IA** (X3a, `AI-POST.md` §3.2 y §7.2): condicionamiento (bordes de los cambios de id y de normal, profundidad normalizada), mosaicos de ~1024² con solape de ≥ 128 px y fusión de coseno alzado, relleno a múltiplo de 16 y recorte, la guarda (transferencia de sombreado, separación de frecuencias, regiones por id con ΔE₀₀), las comprobaciones y la máquina de pasos `plan` → `conditioning`/`tile_input` → `accept` con reintentos; informe con la forma de `GuardReport` en JSON escrito a mano | Las reglas de `rt-core`: sin APIs del sistema, `#![forbid(unsafe_code)]`, `f32`, determinista (solo las funciones de `rt_core::fmath` y las curvas de tono de `rt_core::color`, nada de `f32::ln`/`exp`/`powf` de `std`). Depende de `rt-core`; `rt-core` no sabe que existe. En escritorio la enlaza `rt-app` (X3c: `src/ai/post.rs`, el conductor nativo) |
| `rt-sky` | **El cielo físico, fuera de línea** (E5c): simulador espectral de la atmósfera (capas esféricas, Rayleigh, aerosoles por turbidez, ozono, suelo lambertiano; dispersión simple por cuadratura y múltiple por Monte Carlo determinista), ajuste de la forma de Hošek–Wilkie con Levenberg–Marquardt propio y la tabla con su receta y su *hash* (`rt-sky table`); validación frente a cielos de bajo ruido, al cielo despejado de la CIE y a Preetham (`rt-sky validate`) | `std` entero (hilos, ficheros) y `f64`, pero reproducible: funciones elementales propias (`dmath`), un flujo aleatorio por elemento de trabajo, mismo resultado con cualquier número de hilos. Depende de `rt-core` (lee y prueba la tabla); `rt-core` no la conoce |
| `rt-post-wasm` | `cdylib` con exportaciones `extern "C"` escritas a mano (`post_open`, `post_tile_input`, `post_tile_control`, `post_set_output`, `post_accept`, `post_result`…) → `public/engine/post.wasm`, un módulo aparte para que `rt.wasm` no crezca | Su `unsafe` vive solo en `src/ffi.rs`, comentado bloque a bloque; todo cruza como bytes *little-endian*, sin exigir alineación |

**Sin dependencias externas** quiere decir exactamente eso: ningún
*crate* de crates.io en ningún *crate* del workspace. `Cargo.lock` solo
lista `rt-core`, `rt-cli`, `rt-wasm`, `rt-app`, `rt-post`, `rt-post-wasm` y `rt-sky`,
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
  (L4); ≥ 5 es error. Rectángulo y disco:
  unilaterales, `power` = flujo en W (mm → m), `spread_deg` = caída cosⁿ
  con la mitad de intensidad a `spread/2` (180 = sin caída). Sol: `power`
  = irradiancia en W/m², disco de `angle_deg`. Punto (L4): una esfera de
  diámetro `size_x` (0, un punto) de radiancia uniforme, `power` = flujo
  isótropo en W (intensidad `power / 4π` W/sr). Foco (L4): el punto que
  sería, dentro de un cono de `spread_deg` alrededor de `direction`, con una
  transición de `angle_deg` grados hacia dentro desde el borde (smoothstep,
  como el `SpotLight` de three.js); su eje tiene el brillo de ese punto sea
  cual sea el cono. `up` orienta el panel alrededor de su eje (el escritor
  sigue poniendo `[0, 0, 1]` sin giro, como antes de L4). `flags` bit 0
  *glossy* (ilumina todos los lóbulos y se ve en reflejos; sin él solo
  difuso por NEE), bit 1 visible a cámara, bit 2 (L4) **sin sombra**: no se
  trazan sus rayos de sombra (un fichero anterior nunca lo pone).
- **`ENVR`** (84 B desde E5c; 80 B en E5) `kind`: 0 cúpula (lineal en z: suelo −1,
  horizonte 0, cénit +1, × `strength`), 1 plano, 2 cielo (con
  `sky_turbidity` y el sol en `sun_azimuth_deg` / `sun_elevation_deg`,
  escalado a la irradiancia horizontal de la cúpula de los mismos valores;
  suelo neutro bajo el horizonte; `sky_model`, el último campo, E5c: **0**
  el cielo físico propio, también lo que significa un fichero sin el campo
  y cualquier valor desconocido, **1** el clásico de Preetham), 3 HDRI (el mapa `hdri_map`,
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
- **Texturas** (contrato de M2a, el motor lo lee desde M2b): ver
  *Texturas en el RSB* al final de este apartado.
- **`FLOR`** (20 B, una como máximo): `mode` 0 ninguno, 1 plano
  lambertiano infinito, 2 atrapasombras; `z`; `color[3]`.
- **`RNDR`** (52 B desde E5b-1; los de 28, 36 y 40 B se leen con los valores
  por defecto de lo que les falta): además `max_depth` (0 = 8, tope 1024),
  `clamp_indirect` (0 = desactivado) y, desde X2, `passes`: la **máscara
  de pases** exactos que se escriben junto a la imagen, bit *i* =
  `PASS_KEYS[i]` de `src/core/passes.ts` (1 albedo, 2 normal, 4
  profundidad, 8 id de pieza, 16 id de material, 32 círculo de
  confusión). 0, o un RSB anterior a X2, no pide ninguno; los bits que el
  motor no conoce se conservan y se ignoran. `tonemap`: 0 lineal, 1 ACES,
  2 fílmica, 3 AgX, 4 estándar; desconocido = ACES. Exposición 2^ev antes
  de la curva. Desde E5b-1, al final: `denoise` (u32; bit 0, el anfitrión
  entrega la imagen con *denoise*; bit 1, también la de antes; `rt-core` no
  lo lee: renderizar es igual con o sin él), `caustic_photons` (u32,
  fotones de cáusticas por muestra; 0 = sin cáusticas; tope 4 194 304) y
  `caustic_radius` (f32, radio de reunión de la primera muestra en píxeles
  a la distancia del objetivo de la cámara; 0 = 3). Un RSB anterior no pide
  ni *denoise* ni cáusticas.
- **`LENS`** (O1, nueva, opcional, una como máximo, justo después de
  `CAMR`; `CAMR` no cambia): la óptica de la cámara más allá de la lente
  fina (`rt_core::optics`). 72 B de números y la imagen:
  `u32 blades` (0 redondo, 3 a 18), `f32 roundness rotation_deg`,
  `u32 profile` (0 uniforme, 1 centro brillante `1 − kρ²`, 2 anillo
  brillante `(1 − k) + kρ²`, 3 apodizada, gaussiana de σ = k;
  desconocido = 0), `f32 profile_param obstruction cats_eye squeeze
  shift_x_mm shift_y_mm tilt_deg tilt_axis_deg ca_amount swirl
  field_mm`, `u32 mask_kind` (0 ninguna, 1 máscara que sustituye al
  diafragma, 2 textura que lo multiplica) `mask_width mask_height`, los
  píxeles de 8 bits (255 abierto; [−1, 1]² de la pupila, filas de arriba
  abajo, círculo unidad inscrito; hasta 1024 por lado) y relleno a 4
  bytes. **O3a** añade al final los tres huecos de la pila de filtros de
  efecto, 28 B cada uno (`u32 kind`: 0 ninguno, 1 difusión blanca, 2
  negra, 3 dorada, 4 brillo, 5 suavizado, 6 red, 7 estrella, 8 rayas;
  `f32 grade` 0 a 2, `tint[3]` (ceros: el del tipo), `angle_deg`; `u32
  points` 4, 6 u 8, 0 es 6), escritos solo cuando hay alguno: una `LENS`
  sin filtros es la de O1 byte a byte, y una sección de O1 se lee sin
  filtros. Un valor fuera de rango hace inválido el fichero. Un RSB sin
  `LENS` es la lente fina de siempre, bit a bit (los *hash* del ejemplo,
  E5, E5c, E5b-1 y los pases no se movieron); una `LENS` neutra también.
  La interfaz la escribe solo para una cámara con óptica no neutra
  (`src/io/rsb.ts` `lensToRsb`): las imágenes de `public/assets/aperture/`
  promediadas 2 × 2 a 256 × 256 (`src/core/aperture.ts`, leídas sin
  *canvas* por `src/io/aperture.ts`), máscara por textura en una sola
  imagen, y `field_mm` = media diagonal del encuadre de salida en el
  sensor de 36 mm, sea cual sea la parte del visor que cubra la imagen.
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
(E5: el HDRI y la imagen de fondo; las texturas, en `IMGS`, abajo); la
clave de mallas del escritor TypeScript incluye los ids de las imágenes,
de modo que un cambio de imagen manda la escena entera.

**Texturas en el RSB** (contrato escrito en M2a; `rt-core` lo lee en M2b).
El escritor TypeScript lo escribe **solo cuando la vista lo pide**
(`SceneView.textures`, que M2b enciende cuando el motor dice que lo lee: una
exportación `rt_features` de `rt.wasm` con el bit 0, y lo mismo en
`/api/info` del lanzador); apagado, que es lo que hay hasta M2b, los bytes
son los de antes de M2a para cualquier escena (test: la misma escena con
sus texturas y sin ellas da los mismos bytes, y las escenas fijadas de
`tests/rsb.test.ts` no cambian). Encendido escribe tres cosas:

1. **`IMGS`** (nueva, una como máximo, viaja con las mallas: un RSB de
   actualización sin `MESH` tampoco la lleva y el motor conserva las
   imágenes cargadas). `u32 count`; por imagen `u32 width height channels
   color_space` y `width × height × channels` bytes, filas desde arriba,
   relleno a 4 bytes. `channels` 1 (gris), 3 (RGB) o 4 (RGBA, alfa recta);
   `color_space` **0 sRGB** (lo que el motor decodifica a lineal: las
   ranuras de color y emisión y las etiquetas) o **1 lineal** (datos:
   rugosidad, metal, normal, alfa; el alfa es lineal siempre). Una imagen
   usada de las dos maneras va dos veces. 8 bits; los **mipmaps los calcula
   el motor**. Los píxeles los decodifica la interfaz
   (`io/texture-pixels.ts`, con el decodificador del navegador): el motor no
   lee PNG ni JPEG.
2. **`MATL`**: los campos de antes (72 B), los de E6 (`f32 bevel_mm`, 76 B) y
   E9 (`f32 scatter_mm scatter_color[3] scatter_g abbe`, 100 B) —ceros
   mientras E6 y E9 no los escriban—, y desde el **byte 100** el bloque de
   texturas:

   ```text
   u32 texture_block_version (1)
   6 × ranura (color, rugosidad, metal, normal, alfa, emisión), 15 palabras:
     i32 image          índice en IMGS, -1: ninguna
     u32 projection     0 UV, 1 caja, 2 plana, 3 cilíndrica, 4 esférica
     u32 axis           0 X, 1 Y, 2 Z
     u32 uv_set         0 el primero, 1 el segundo
     f32 size_mm        lo que ocupa una repetición a lo ancho (alto: por la imagen)
     f32 rotation_deg   antihorario, v arriba
     f32 offset[2]
     f32 repeat[2]
     u32 wrap           0 repetir, 1 estirar el borde, 2 espejo
     u32 channel        0 R, 1 G, 2 B, 3 A, 4 luminancia (Rec. 709 de los valores)
     u32 flags          bit 0 invertir, bit 1 recorte, bit 2 mapa de alturas
     f32 strength       normal: intensidad (o mm de relieve del blanco); emisión: multiplicador
     f32 cutoff         alfa con recorte: el umbral
   f32 emission_tint[3]
   u32 label_count
   label_count × etiqueta, 19 palabras:
     i32 image          índice en IMGS (sRGB), -1: ninguna
     f32 origin[3] u[3] v[3] normal[3]   en el espacio de la pieza, u y v unitarias con el giro ya aplicado
     f32 width_mm height_mm depth_mm      depth: alcance delante y detrás del plano
     f32 roughness coat relief            el acabado donde cubre (relief: el borde del papel)
   ```

   Tamaño: `100 + 4·(1 + 90 + 3 + 1 + 19·n)` bytes. Cada ranura lleva ya
   resuelto el mapeado que usa (el suyo o el común).
3. **`MESH`**: tras `material_id`, `u32 uv_sets` (0, 1 o 2) y cada juego de
   `2n` `f32`. Las posiciones de `MESH` son el espacio propio de la pieza (las
   instancias llevan su transformación), que es el de las proyecciones y las
   etiquetas.

Semántica (la de `SPEC.md` §3.3 y `src/core/textures.ts`, cuyas funciones
son la referencia que los tests fijan y el *shader* de Rápido sigue): las
coordenadas de textura con v arriba, el téxel en la columna `u·ancho` y la
fila `(1 − v)·alto`; caja con pesos |n|⁴ y sin espejos; cilíndrica y
esférica con la imagen centrada delante (−T de la sección del eje); `uv =
R(giro)·(c ⊙ repetición) + desplazamiento` (+½ en las proyecciones); la
imagen multiplica el parámetro, la emisión suma `tinte × imagen ×
intensidad` en radiancia; una etiqueta cubre `|s − ½| ≤ ½`, `|t − ½| ≤ ½`,
a menos de `depth_mm` de su plano y en superficies con `n · normal > 0`, y
se compone en orden sobre el sustrato por su alfa.

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

### 5.2 ter · La óptica de la cámara (O1, `rt_core::optics`)

`Camera.lens: Option<Lens>`; sin ella, `Camera::sample_ray` hace lo de
siempre (el mapa concéntrico de las dos dimensiones de lente y peso
blanco). Con ella, `Lens::sample` devuelve el rayo **y un peso de color**
que la baldosa multiplica antes de acumular (`render::camera_sample_weighted`):

- **Pupila** (`optics::pupil`): disco (mapa concéntrico y radio
  remapeado por la inversa de la CDF del perfil en `s = ρ²`), abanico de
  triángulos desde el centro (diafragma de N láminas rectas; curvas con
  24 cuerdas por lámina: arcos de radio `apotema / redondez` tangentes a
  la arista en su mitad, como `tools/assets/aperture-masks.mjs`) con el
  perfil del *calibre* de la forma, o rejilla con CDF marginal y
  condicional de una imagen (máscara o textura por la forma con borde
  suavizado; perfil y obstrucción dentro). Nada se rechaza y nada se
  pesa: la estratificación de Sobol llega a la pupila y el brillo no
  cambia. Solo `+ − × ÷ sqrt` y `fmath` (`exp`, `ln`, `sin_cos`, `atan2`
  al preparar).
- **Campo**: altura de imagen `h` (0 en el eje, 1 en `field_mm`) y
  dirección radial desde el eje óptico (con el descentramiento). Remolino
  (artístico): comprime radialmente, estira tangencialmente y gira la
  pupila en proporción a `h`. Ojo de gato: una muestra fuera del segundo
  disco (radio 1, desplazado `cats_eye × h` hacia el eje) pesa negro, pero
  traza su rayo (la cobertura de un fondo transparente no cambia).
  Aberración cromática (artística, decisión 3): con `ca_amount > 0` cada
  muestra toma una banda R, G o B por `PixelSampler::strata` de
  `DIM_LENS_BAND` (`3 << 20`, más allá de la tabla de Sobol y de los
  recortes: cada tres muestras seguidas de un píxel son las tres bandas,
  desplazadas por un *hash* del píxel, y las tres comparten un punto de la
  pupila, el índice `(i + desfase) / 3` de la secuencia de Sobol de la
  lente: cada banda recorre sus propios puntos en orden y los colores del
  interior de un disco coinciden en vez de salpicarse), escala la pupila por
  `1 + a·CA_SCALE[banda]` y la mueve `a·CA_SHIFT[banda]·h` en radial, y
  pesa solo su canal por tres. Anamórfico: x de la pupila entre la
  compresión.
- **Rayo** (`Lens::thin_ray`, también lo que usa `Camera::generate_ray`
  con lente, y por tanto `render::centre_ray`): el rayo principal por
  `forward·f + right·(x + shift_x) + up·(y + shift_y)`; sin inclinación,
  el plano de enfoque de siempre; con inclinación `α` sobre el eje `a`
  del plano del sensor, la pupila en el plano de la lente girado y el
  plano de enfoque por el punto de enfoque del eje con normal
  `f·forward + u·sin α·(forward × a)` (regla de la bisagra; con el sensor
  a `f u / (u cos α − f)` se cumple también Scheimpflug, y el test lo
  comprueba con tres puntos). Un rayo principal que no corta ese plano
  por delante enfoca al infinito.
- Lo que no cambia: el pase `coc` (`passes::coc_diameter`) sigue siendo
  el de la lente fina redonda y sin inclinar; la cámara ortográfica
  ignora `LENS`; el muestreo de luces, BSDF y recortes no ve nada nuevo.
- *Hash* fijado de la escena O1 (`example::o1_scene`, todas las
  perillas a la vez y una textura de anillos): `PINNED_O1_LENS_4SPP` =
  `0xcfc57d4a` en cada ruta SIMD, en WASI, en el `rt_wasm.wasm` real
  (`rt --write-o1-example`, `tools/wasm-parity.mjs`, en CI) y con 1, 4 y
  16 hilos (`rt-cli/tests`).
- **Filtros de efecto** (O3a, `optics::filters`): tras la pupila, cada
  filtro de la pila (hasta tres, en orden) decide con un número si dispersa
  la muestra (probabilidad `s` del grado, tabla `GRADES`/`GRADE_S` lineal
  entre grados) y, si lo hace, desvía la dirección del rayo
  `d + right·δx + up·δy` (δ en tangentes, radianes) y la pesa `a·T`. Las
  PSF son radiales (difusión: gaussiana de `SIGMA_CORE_DEG` y cola de
  Cauchy 2D de `SIGMA_TAIL_DEG` hasta 12 anchos; suavizado: la gaussiana),
  de rayas (estrella, rayas y los ejes de la red: densidad 1/r entre
  `LINE_START_DEG` y `LINE_END_DEG`, `STREAK_END_DEG` las rayas, con un
  grosor de `LINE_WIDTH_DEG`) o de puntos (brillo: la gaussiana y un
  segundo lóbulo estrecho cuya dirección sale de un *hash* de la celda de
  6 × 6 de la pupila); todas por CDF inversa tabulada (256 valores,
  construida al cargar con `fmath`), sin `exp` ni `ln` en el bucle. Los
  rayos dispersos rara vez dan con una luz pequeña, así que cada muestra
  de cámara con filtros **se conecta además a una luz** que la cámara ve
  (`Lights::camera_lights`, por su esfera envolvente; una elegida al azar
  por filtro): un lóbulo por su parte de la PSF, una desviación dentro de
  la luz con la densidad de conexión de ese lóbulo (el disco de la luz en
  el plano de desviaciones, `filters::light_disc`; para las rayas, la raya
  elegida por la probabilidad que cae dentro y la distancia por su
  densidad 1/r ahí; para el destello, la parte de su caja dentro), un rayo
  de sombra y su radiancia por `s·a·T` y la probabilidad de que los
  filtros siguientes no dispersen. La dispersión y la conexión se pesan
  una contra otra con la heurística del balance lóbulo a lóbulo
  (`Filter::mis_weight`): las luces que cruza el primer tramo del rayo de
  una muestra dispersa pesan `K / (K + p·q)` (`integrator::radiance_weighted`)
  y la conexión `s·a·T·L` por ese mismo peso donde cayó. Sin luces que la
  cámara vea, no hay conexión. Los números de cada filtro salen de cuatro
  dimensiones propias más allá de la tabla de Sobol (`DIM_LENS_FILTER`,
  `4 << 20`, cuatro por filtro) y los de su conexión de seis más
  (`DIM_LENS_FILTER_LIGHT`, `5 << 20`);
  con bandas cromáticas, los del grupo de tres (una dispersión, tres
  colores). Una lente sin filtros no saca ninguno: los *hashes* de antes
  no se mueven. Escena de paridad `example::o3a_scene` (difusión negra
  1/2, estrella de 6 a 15° y rayas 1/2 sobre un diafragma de 6 láminas):
  `PINNED_O3A_FILTERS_4SPP` = `0x715dc88e` en cada ruta SIMD, en WASI, en
  el `rt_wasm.wasm` real (`rt --write-o3a-example`, `tests/fixtures/o3a.rsb`)
  y con 1, 4 y 16 hilos. El visor Rápido aplica `(1 − s)·I + s·a·T·(I ⊗ K)`
  con los mismos núcleos proyectados por la focal (`render/lens-filter-*`),
  como aproximación que el medidor declara.

### 5.2 bis · Película, *denoise* y cáusticas (E5b-1)

**Película.** `Film` acumula, además de la radiancia premultiplicada, el
peso y la cobertura, la **suma de los cuadrados de la luminancia** de cada
muestra (`Film::lum2`, `f32`, en orden de muestra). No toca `rgb`, `weight`
ni `alpha`: ningún *hash* de imagen se mueve. Con la media da la varianza de
cada píxel, `(E[l²] − E[l]²) / (n − 1)` de la media de `n` muestras. El pool
la suma igual en TypeScript (`Accumulator.lum2`, `render/tiles.ts`:
luminancia Rec. 709 en `f32` en el mismo orden, `l²` redondeado y sumado),
y el lanzador la lee de sus películas por baldosa.

***Denoise* propio** (`rt_post::denoise`, `crates/rt-post/src/denoise.rs`).
Transformada à-trous con paradas en aristas (Dammertz, Sewtz, Hanika y
Lensch, HPG 2010: núcleo B3 `(1, 4, 6, 4, 1)/16`, cinco pasadas con los
saltos 1, 2, 4, 8 y 16) con la parada de luminancia guiada por la varianza
de SVGF (Schied et al., HPG 2017: `exp(−|l_p − l_q| / (σ_l √g(Var_p)))`
con la varianza filtrada por una gaussiana 3 × 3 y arrastrada de pasada en
pasada como `Σ w² Var / (Σ w)²`, normal `max(0, n_p·n_q)^128`, profundidad
`exp(−|z_p − z_q| / (σ_z |∇z·Δ|))`, σ_l = 4, σ_z = 1; el albedo se divide
antes y se multiplica después, y con menos de cuatro muestras la varianza
se estima con los vecinos 7 × 7). Guiado por los pases exactos de X2
(`GUIDE_PASSES`: albedo, normal, profundidad, id de pieza, id de material),
con **peso cero entre piezas o materiales distintos** (nunca mezcla dos
piezas) y el fondo (id 0) intacto. Lo nuestro: la varianza de la película,
los pases exactos como guías, las paradas por id, un recorte de
luciérnagas antes de filtrar (un píxel más de cuatro veces más claro que
todos sus vecinos de la misma superficie baja a ese límite) y las
exponenciales de las paradas como `(1 − x/16)^16`. Todo `f32`, sin
transcendentes de `std`, en orden fijo: los mismos bits en nativo y en
wasm. Lee sumas RGBA de `n` muestras y devuelve sumas RGBA (la cobertura
como estaba). **Por bandas de filas**: `denoise_rows` calcula unas filas
con `HALO` = 72 filas alrededor (el alcance de todo el filtro) y da
exactamente esas filas de la imagen entera, así que los anfitriones lo
reparten entre hilos o *workers* sin cambiar un bit (bandas de 192 filas
como mínimo). *Hash* fijado: el ejemplo a 4 muestras con *denoise*,
`0xab15f290` (`PINNED_DENOISED_EXAMPLE_4SPP`), igual con el `rt.wasm` real
(`tools/wasm-parity.mjs --expect-denoised`) y por el código de la página
(`tests/denoise.test.ts`).

**Cáusticas** (`rt_core::caustics`). Mapa de fotones progresivo estocástico
(Hachisuka y Jensen, SIGGRAPH Asia 2009, tras Hachisuka, Ogaki y Jensen
2008) en la forma probabilística de Knaus y Zwicker (ACM TOG 30(3), 2011):
cada índice de muestra es una pasada con sus fotones y sus puntos visibles,
y su estimación es un mapa de fotones con el radio
`r_i² = r_1² Π_{k=1..i} (k + α)/(k + 1)`, α = 2/3 (r_1 = `caustic_radius`
píxeles en la distancia del objetivo). Promediar las pasadas, que es lo que
hace la película con sus muestras, converge como SPPM sin estado por píxel:
una baldosa sigue pudiéndose renderizar en cualquier hilo y orden con los
mismos bits. **Partición sin contar dos veces**: un *caster* es vidrio o
metal cuya dirección más aguda tiene rugosidad ≤ 0,25 (el cepillado cuenta
a lo largo de su cepillo); lo demás que dispersa es receptor (el suelo
incluido); un suceso recto (recorte, transmisión recta de pared fina) no
cuenta. El mapa lleva exactamente la luz de los tramos `L C+ R`: fotones
de las luces que los mandan (paneles y discos *glossy*, soles *glossy*,
mallas emisoras; nunca el entorno ni los puntos y focos de L4, cuyas
cáusticas siguen en el trazador), solo por *casters*, guardados en el
primer receptor que tocan; la cámara los reúne, con su BSDF, en **cada**
receptor de su camino: el primero (la cáustica vista directamente o a
través del vidrio) y los siguientes (una cáustica que ilumina la escena
por un rebote difuso, con el recorte de la luz indirecta). El trazador
deja fuera exactamente esa luz: después de cualquier receptor, lo que
llega de una luz de fotones solo por *casters* (impacto por muestreo de
BSDF o NEE en un *caster*). Dejada al trazador, la cáustica vista por un
rebote difuso llegaba en muestras raras y muy brillantes: eran los
destellos alrededor de la base del frasco a 1024 muestras. La
profundidad máxima vale para los dos. Emisión dirigida a las esferas
envolventes de los *casters* (hasta 16) con la densidad de la mezcla
entera; refracción con flujo (sin el 1/η² de la radiancia) y corrección
adjunta de normales de sombreado (Veach 1997); PCG por (semilla, muestra,
fotón), así que un mapa da los mismos bits trazado en cualquier reparto
(`PhotonMap::trace_range`). Rejilla *hash* de celda 2r, núcleo
`2(1 − d²/r²)/(π r²)`. **Atrapasombras** (el suelo de la interfaz): los
fotones caen también en su plano y el rayo de cámara que lo ve suma su luz,
relativa a la del suelo abierto, al fondo que muestra; con fondo
transparente no se muestran. Coste: `caustic_photons` fotones por muestra,
trazados por cada anfitrión antes de las baldosas de esa muestra (en wasm,
cada *worker* guarda los 16 mapas de la última pasada). *Hash* fijado: la
escena de E5 con 2048 fotones por muestra, `0x55d60f2f`
(`PINNED_E5B_CAUSTICS_4SPP`, `rt --write-e5b-example`), igual en todas las
rutas SIMD, en el `rt.wasm` real, por el lanzador con 1, 4 y 16 hilos y por
el código de la página.

**Interfaz.** `core/caustics.ts`: *Cáusticas* (*Automático · Encendidas ·
Apagadas*, en la sección de calidad de la ventana de render; *Automático*
las enciende con un *caster* y una luz *glossy* que, vista desde los
*casters*, no pase de 20°, un sol o un emisor encendido; lo decide
`projectScene` desde la escena), *Calidad de cáusticas* (*Baja* 4096 fotones
y 4 px, *Media* 16 384 y 3 px, *Alta* 65 536 y 2 px) y *Denoise* (*Apagado ·
Visor · Render · Los dos*, por defecto *Los dos*) con *Guardar también sin
denoise*; viven en `render.advanced` (deshacibles, guardados en el
proyecto, copiados en cada trabajo) y llegan al motor como los campos de
`RNDR` de arriba (`engineFieldsOf`). El medidor dice lo que el motor dice:
*Ruido reducido* cuando la imagen en pantalla es la filtrada y *Cáusticas ·
N fotones por muestra* cuando el motor las renderiza (`rt_scene_caustics`
en el pool, `FLAG_CAUSTICS` en el lanzador).

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

**Denoise y cáusticas en el pool** (E5b-1). Cada *worker* traza los mapas
de fotones de las muestras que renderiza (los mismos bits que cualquier
otro: no viajan) y dice en su respuesta a `scene` cuántos fotones por
muestra renderiza esa escena. Con *denoise*, los trabajos piden los pases
guía y el hilo principal suma `lum2`; al acabar una pasada el pool reparte
el filtro en bandas de filas entre los *workers* del carril
(`Pool.denoise`, mensaje `denoise`, `rt_denoise`); el visor muestra la
imagen filtrada en cuanto vuelve (tras la primera pasada, tras la última y
tras cualquier otra cuando ha pasado tres veces lo que tardó la anterior;
mientras, la última filtrada) y el medidor cuenta sus muestras. A media y
cuarta resolución (gestos) no se filtra. Un *Render* filtra al final con
todos sus *workers* y, si se pide, devuelve también la imagen de antes.

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
(8 bits), TIFF (`--format tiff`, con `--bits 8|16|32`) o DNG (`--format
dng`); sin `--format`, manda la extensión de `-o` (`.tif`, `.tiff`, `.dng`;
cualquier otra, PNG). Sirve para lotes, para la hoja de contactos de CI y
para generar las miniaturas de los catálogos sin navegador. La
aplicación de escritorio (P2) enlaza `rt-core` directamente en su
lanzador y usa el mismo RSB que la web (§5.5).

### 5.4 bis · Salida TIFF y DNG (U12)

Dos codificadores propios, escritos de la especificación pública (TIFF 6.0
de Adobe, 1992, §2, §6, §8, §19; DNG 1.4.0.0 de Adobe, 2012) y sin
mirar ningún lector ni escritor ajeno, uno en cada lado, que **escriben
los mismos bytes**: `rt_core::tiff` y `rt_core::dng` (solo `std`) para
el CLI, y `encodeTiff` y `encodeDng` en `src/io/image.ts` para la
interfaz (que es la que escribe el archivo de un render, también en
escritorio: el lanzador solo lo guarda, `image/tiff` como `.tif` e
`image/x-adobe-dng` como `.dng`, y deja escribir esas extensiones).

- **TIFF.** Little-endian (`II`, 42), un solo directorio, sin compresión
  (`Compression` 1), en *strips* de unos 8 KiB (§7), RGB (fotométrico 2)
  o RGBA con alfa **no asociado** (`ExtraSamples` 2), a 8 o 16 bits, o a
  32 bits `f32` (`SampleFormat` 3). `XResolution` y `YResolution` son los
  DPI de la ventana (72 en el CLI), `ResolutionUnit` 2 (pulgadas), sin
  perfil ICC: 8 y 16 bits son sRGB por convención y el flotante es luz
  lineal con la exposición del render y sin curva, como el EXR (que sí
  guarda el alfa premultiplicado; el TIFF, recto: el color dividido por la
  cobertura, `straightLinearRgba` en `render/tiles.ts`). Las etiquetas van
  ordenadas, y los valores que no caben en la entrada (>4 bytes) detrás
  del directorio, en el orden de las entradas y cada uno en un
  desplazamiento par; los *strips* siguen sin huecos. Desplazamientos de
  32 bits: más de 4 GiB se rechaza.
- **DNG.** Un TIFF más con las etiquetas de DNG 1.4: `NewSubFileType` 0,
  `PhotometricInterpretation` 34892 (*LinearRaw*), tres muestras `f32`
  (`SampleFormat` 3, sin alfa), `Make`, `Model` y `UniqueCameraModel`
  «Repackshot», `DNGVersion` y `DNGBackwardVersion` 1.4.0.0 (los datos en
  coma flotante piden 1.4), `ColorMatrix1` = CIE XYZ (D65) → sRGB lineal,
  **la inversa de sRGB → XYZ** de los primarios (0,64 0,33; 0,30 0,60;
  0,15 0,06) y el blanco (0,3127; 0,3290), calculada en aritmética exacta
  y redondeada a siete decimales como racionales con signo de
  denominador 10⁷ (`CalibrationIlluminant1` 21: D65), `AsShotNeutral` 1 1
  1, `BaselineExposure` 0 y `WhiteLevel` 1 (el blanco del render es 1,0 y el
  negro 0; los datos no se recortan a él, así que un revelador de raw abre
  el archivo con **toda la latitud del render**; el mayor `f32` no sirve
  de nivel de blanco, porque el revelador normalizaría por él y la imagen
  saldría negra).
- **Paridad.** `tests/fixtures/tiff/` guarda los siete archivos de una
  imagen de 4×4 con valores conocidos (RGB y RGBA a 8, 16 y 32 bits, y el
  DNG). `engine/crates/rt-cli/tests/tiff_golden.rs` comprueba que
  `rt_core` escribe exactamente esos bytes (con `REPACK_WRITE_GOLDEN=1` los
  reescribe) y `tests/tiff-dng.test.ts`, que la interfaz también; cada lado
  se relee además con un lector mínimo de su propio test (cabecera,
  etiquetas, desplazamientos, valores). Cambiar el formato a propósito es
  cambiar los dos codificadores y reescribir esos archivos.
- **En la interfaz.** `OutputFormat` gana `TIFF` y `DNG`; `BitDepth` gana
  32 (solo TIFF; el normalizador de `render/set` lo pone a 8 en cualquier
  otro formato, y el alfa a falso en JPEG y DNG). Chromium y Firefox no
  muestran TIFF ni DNG: el render guarda, junto al archivo, la copia PNG
  de 8 bits que ya guardaba para el EXR (`needsDisplayCopy`).

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

   ***Denoise* y cáusticas** (E5b-1): con `RNDR.denoise` el trabajo
   renderiza también los pases guía y filtra con `rt_post::denoise` en
   bandas de filas en sus hilos (los mismos bits con cualquier número). Un
   visor publica la imagen filtrada (bandera 64 de la trama) tras su primera
   pasada, la última y cualquier otra cuando han pasado tres veces lo que
   tardó el filtro anterior (entre medias, la última filtrada a las muestras
   de ahora); un final publica al terminar una trama más, la última, con la
   imagen filtrada y, con el bit 1, detrás la de antes (bandera 128: el
   cuerpo lleva dos veces las sumas). La imagen que se guarda para la IA es
   la filtrada. Con `RNDR.caustic_photons` cada pasada traza antes de sus
   baldosas los mapas de fotones de sus muestras en todos sus hilos (por
   rangos de fotones, juntados en orden) y la trama lleva la bandera 256.

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
   results/             el historial: un archivo por resultado (png, jpg, exr, tif, dng) e index.json; con IA, las
                        variantes de la IA como <id>.ai.<n>.<ext> (X4b; la única <id>.ai.<ext> de
                        antes se lee como la variante 1)
   cache/thumbs/        las esferas de materiales (caché)
   cache/ai/            la imagen y los pases de los renders finales grandes que guarda el lanzador (X2)
   models/              los modelos de IA, por sha256
   logs/                el registro del lanzador
   browser-profile/     el perfil de la ventana de Edge o Chromium
   webview2/            el perfil de la ventana propia (P3c); window.json, su sitio
   launcher.json        el puerto; instance.json, la instancia en marcha
   pending-models.json  lo que eligió el instalador: dispositivo, modelos y (U10) el
                        motor de ejecución, que el lanzador empieza a descargar al arrancar
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

   **El historial de resultados con variantes de IA** (X4b). `ResultMeta.ai` es la
   primera variante (lo que era la única antes de X4b) y `ResultMeta.aiMore` las
   demás, en orden, cada una con su nombre, su miniatura, sus bytes (0 si la guarda
   la rechazó: no tiene imagen) y su informe; `aiVariantsOf` y `aiImagesOf`
   (`src/core/results.ts`) las leen igual en un resultado nuevo que en uno viejo.
   `ResultsStore.add(meta, file, display, ai, aiMore)` y `get` (`src/io/results.ts`)
   las llevan como `ai` y `aiMore` (null para una variante sin imagen): en la web,
   en el mismo registro de IndexedDB que el render; en escritorio, cada una por
   `PUT /api/store/results/<id>/ai/<n>` y de vuelta con `GET …/ai/<n>`.
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
   *Ajustes ▸ Post-procesado IA ▸ Equipo*. Desde U10 el INI lleva también
   `[runtime]`: la compilación del motor de ejecución que elige la regla de
   `src/data/ai-runtimes.json` para este sistema (con `--device cpu`, la de
   CPU), que el paso *Modelos de IA* del instalador ofrece junto a los
   modelos y anota en `pending-models.json` (`"runtime"`); el lanzador la
   descarga en el primer arranque (`Ai::start_pending_runtime`).
   `engine/crates/rt-app/tests/installer.rs` lee `models-page.nsh` como
   texto y comprueba que cada `ReadINIStr` tiene su clave en el INI y que la
   línea que escribe es la que lee `read_pending`.
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
8. **Post-procesado IA, la tubería** (X3c, `src/ai/post.rs`; `rt-app` enlaza ahora `rt-post`):
   **`POST /api/ai/post`** con `{source: {kind: RENDER, renderId}, settings, prompt, negative,
   modelKey, materials}`. La imagen lineal y los pases salen del almacén de X2 por el id del render
   (con la exposición y la curva de su escena, para que el modelo vea lo que ve la persona); la
   vista previa del modo Rápido manda los suyos en el cuerpo (`INLINE`, binario `RPI1` con la imagen
   `RPL1` y los pases `RPP1`, ≤ 512 px). El conductor es la máquina de pasos de `rt-post`: `plan` →
   por mosaico `tile_input` y el control (`depth` de los pases si la familia lo carga) →
   `sd-server` (el de X3b, cargado entre llamadas) → `accept` → reintentos a `RETRY_FACTOR` hasta
   `MAX_ATTEMPTS`. Con Intervención 0 el plan no tiene mosaicos y no se arranca nada: la imagen es
   la del motor bit a bit. Progreso por mosaico y cancelación como los trabajos de render
   (`GET /api/ai/post/<id>?after=n`, `DELETE`), un post huérfano se para a los 2 min sin
   preguntas, y la imagen vuelve una vez, lineal (`GET /api/ai/post/<id>/image`). `/api/info`
   dice `aiPost: 1`; entonces la página usa `src/io/ai-post.ts` (`DesktopAiService`), y la cola
   escribe la imagen de la IA desde esa luz lineal con la exposición y la curva del render, como el
   fichero del motor.
9. **Actualizar desde la aplicación** (P5, `src/update/`): `POST /api/update/install` con `{tag,
   assetUrl, sumsUrl}` (y `size`, solo para el progreso), `GET /api/update` y `POST /api/update/cancel`;
   `/api/info` dice `updateApi: 1` y `afterUpdate`. El lanzador **decide qué se puede descargar**, no
   la página: solo `https://github.com/<owner>/<repo>/releases/download/<versión>/<archivo>` del
   repositorio de `src/data/update-feed.ts` (que el *crate* lee al compilarse, así que no pueden
   diferir), el paquete que le toca a esta copia (instalada en Windows: `-setup.exe`; portable:
   `.zip` en Windows y `.tar.gz` en Linux) y el `SHA256SUMS.txt` de la misma versión; una copia que
   no es ni instalada (`uninstall.exe` junto al programa) ni portable (`portable.txt`), o un
   procesador que no es x86-64, responde 409 `not-updatable`. El trabajo, en un hilo, con el `curl`
   del sistema como el resto de descargas (`ai/download.rs`, que ahora admite un tamaño solo
   acotado): **DOWNLOADING** (las sumas y el paquete a `<datos>/cache/update/`, con reanudación) →
   **VERIFYING** (el SHA-256 propio contra la suma de la versión; si no cuadra, se borra y no se
   instala nada) → **INSTALLING**: en una copia instalada el instalador verificado espera; en una
   portable se extrae **todo** a `<carpeta del exe>/update-<tag>/` (el lector de zip propio de
   `ai/zip.rs`; en Linux el `tar` del sistema, tras comprobar los nombres y que no haya enlaces) y
   se **sustituye en el sitio** (`update/portable.rs`): cada archivo y carpeta del paquete, el
   ejecutable el último, ocupa el lugar del que tenía su nombre, que pasa a `<nombre>.old`
   (`repackshot.old.exe`, `app.old`; un ejecutable en uso se puede renombrar, no sobrescribir);
   `data/` y `portable.txt` no se tocan; si un paso falla se deshacen los hechos y lo viejo queda
   donde estaba (`FAILED`, con el motivo). Los nombres a borrar se apuntan antes en `update.json`.
   `ready: true` dice que ya está todo en su sitio y el lanzador espera a que se cierre la
   ventana: **la página la cierra** (con su pregunta sobre cambios sin guardar si el proyecto ha
   cambiado desde que se contestó), y `--serve-only`, que no tiene ventana, sale solo. **Solo
   cuando el lanzador ha parado** (`launcher::run`, tras el servidor, la ventana y `instance.json`)
   arranca lo que toca, suelto del proceso (`DETACHED_PROCESS` en Windows, grupo propio en Unix):
   `setup.exe /S /LAUNCH` o el ejecutable nuevo con los mismos argumentos y `--after-update`. Así
   la versión nueva nunca arranca junto a una vieja que aún tiene el puerto, el perfil de la
   ventana o `instance.json`; y como el nuevo toma el mismo puerto (el de `launcher.json`), el
   origen no cambia. Al arrancar, el nuevo borra los `.old`, las carpetas `update-*` y la descarga
   (`update::start_cleanup`; en Windows reintenta unos segundos, porque el ejecutable viejo puede
   seguir cerrándose). El instalador (`packaging/windows/installer.nsi`) espera hasta 30 s a que
   `repackshot.exe` quede libre cuando va en silencio, arranca la aplicación al acabar con
   `/LAUNCH` y no cambia nada de lo que eligió la persona (ni la página de modelos ni un acceso
   directo del escritorio que se borró). La interfaz (`ui/updates.ts`) pregunta, pide, sigue el
   estado cada 400 ms y cierra la ventana; contrato completo en `engine/crates/rt-app/README.md`.

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
- **El recorrido guiado** (U10): `ui/tour.ts` son los pasos como datos
  (cada uno con los `data-guide` que anilla y lo que necesita en pantalla,
  un `TourStage`), las reglas para arrancar, los comandos (`startTour`,
  `tourNext`, `tourBack`, `endTour`) y la geometría de la tarjeta
  (`placeCard`); `ui/panels/tour.ts` es la capa. Lo que se recuerda
  (`tourSeen`) va en el `layout` del documento de ajustes, como
  `chooserShown`, así que en escritorio está en la carpeta de datos.
- **El aviso del motor de ejecución** (U10): `core/ai-runtimes.ts`
  decide qué decir (`runtimeWarning`, puro, sobre el informe del lanzador);
  `ui/ai-runtime-state.ts` tiene el único sondeo de
  `GET /api/ai/runtime` (`RuntimeWatch`, solo mientras alguien escucha), la
  comprobación una vez por sesión al arrancar (la nota de la barra de
  estado) y los botones; `ui/panels/ai-runtime-notice.ts` dibuja el
  recuadro de la ventana de render y de Ajustes.

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
  de cada eje y el punto central, que es lo único que se dibuja y se coge),
  y desde L4 `MOVE` con `object` (una luz o una cámara: el *gizmo* de Mover
  sin cubos, sobre el objeto, con el asa de apuntar en su objetivo; la
  interfaz convierte el arrastre con `objectGizmoAction` de
  `core/view-objects.ts`).
- **Luces y cámaras (L4)**: `setGlyphs({ all, selected, lookThrough })`
  dice qué glifos dibuja la vista previa (todos o el del seleccionado) y
  desde qué mira el visor (`lookThroughCamera`; `main.ts` le da al
  trazador la misma cámara, `setViewCamera`, calculada de cada estado, y
  convierte la navegación con `lookThroughAction` en acciones de la luz o la
  cámara con un *token* de gesto: en vivo y una entrada de deshacer);
  `glyphAt(x, y)` es el objeto cuyo glifo está bajo un punto (`pickGlyph`
  de core, con la proyección de three) y `objectAt(obj)`, dónde está en el
  lienzo (el visor lo copia en `data-object-at` para las comprobaciones).
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
| Focos propios, luces y cámaras en el visor (L4) | `tests/own-lights.test.ts`, `view-objects`; `light::tests` e `integrator::tests` de rt-core; `tools/lights-check.mjs` | Añadir cada tipo delante y arriba, seleccionado, una entrada de deshacer; duplicar, eliminar, apuntar, colocar sobre superficie, giro; un montaje propio de tres focos aplicado a otro tipo de producto conserva su irradiancia total y sus partes; RSB `LGHT` 3 y 4 con su flujo, sombra y giro; proyecto y biblioteca de ida y vuelta; glifos y su clic, *gizmo* de luz y cámara con una entrada de deshacer, *Mirar a través* que mueve el objeto y respeta el bloqueo; en el motor, `I / d²` de puntos, esferas y focos, el cono y su transición, el flujo del cono, MIS de las esferas, la sombra apagada y el peso de un foco estrecho |
| Óptica de cámara (O1) | `optics::tests` de rt-core, `tests/optics.test.ts`, `tools/optics-check.mjs` | Pupila de 6 láminas dentro del hexágono y fuera del círculo inscrito en su proporción (±1 %), láminas curvas, perfiles con su densidad, obstrucción, máscara por CDF con la media del rechazo (±1 %), Scheimpflug y bisagra con tres puntos, descentramiento, anamórfico, ojo de gato con el área de dos discos, bandas que suman blanco; una lente neutra es la lente fina bit a bit; `LENS` de ida y vuelta con los bytes de `rt`; miniaturas al día; *hash* de O1 en SIMD, WASI, wasm y 1/4/16 hilos |
| Filtros de efecto (O3a) | `optics::filter_tests` de rt-core, `tests/lens-filters.test.ts`, `tools/lens-filters-check.mjs` | Grados → `s`; difusión blanca que conserva la media (±0,5 %), negra a 1 entre 0,90 y 0,97, dorada hacia el rojo; estrella de 6 con seis rayas (±2°); tres filtros de grado 0 = sin filtro bit a bit; la conexión con las luces y su MIS contra la dispersión sola (imagen ±3 % y suma exacta por lóbulo, también con media luz); `LENS` con huecos de ida y vuelta y la de O1 byte a byte; *hash* de las celdas del brillo igual en TS; aproximación del visor contra el motor en el horno (< 2 %); *hash* de O3a en SIMD, WASI, wasm y 1/4/16 hilos |
| Sets (L6) | `tests/sets.test.ts`, `data`, `rig`; `tools/setup-thumbs.mjs`, `tools/sets-sheet.mjs` | Los 72 montajes anteriores sin campos nuevos y con el mismo rig que antes contra los 16 tipos (fixture); los tipos de producto con los focos de su set a su nivel; ninguna tarjeta en el encuadre (16 focales, tres formas, tres proporciones, la cámara del set: recorte del polígono contra la pirámide de la cámara, y un caso que se ve para que la prueba no pase sola); aplicar, sustituir, quitar con otro montaje y con *Restablecer*, *Crear estudio* con un set, una entrada de deshacer; la decoración no es el producto ni la mira el Doctor; el charco (su parte del nivel, dónde cae, su potencia); *Usar la cámara del set*; el degradado como imagen de fondo del RSB; las miniaturas: la escena RSB de cada una tal como la construye el código ahora y el PNG del manifiesto, y el *hash* de una fijado; medidas sobre las miniaturas con los umbrales del veredicto en `LOOK` (`tests/thumb-metrics.ts`; `REPACKSHOT_SET_MEASURES=1` las imprime) |
| Gestos en el navegador | `tools/material-drag-check.mjs`, `box-select-check.mjs`, `primitives-check.mjs` (U9), `lights-check.mjs` (L4), `sets-check.mjs` (L6) | Playwright con el Chromium local sobre `dist/`, en Rápido y en Completo, con ratón, lápiz y dedo; capturas en `docs/ui/` (las de Completo, en `out/`) |
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

**Texturas** (M2a). Las imágenes de las ranuras y de las etiquetas de los
materiales van en el mismo bloque `images`, detrás de las del entorno, una
vez cada una, como el archivo PNG o JPEG que eran, bajo el id que nombra su
contenido (`tex:` y 16 cifras hexadecimales de su SHA-256,
`core/texture-images.ts`): un proyecto guardado y abierto en otra sesión
vuelve con los mismos bytes y los mismos ids, y se guarda otra vez en los
mismos bytes (test). Al abrir se registran sin decodificar
(`placeTextureImages`): una que falta o no es PNG ni JPEG quita sus ranuras
y sus etiquetas y cuenta en `MISSING_IMAGES`. Los `textures` de cada
material se leen con `normalizeTextures`, que también entiende la forma
plana anterior a M2a (`projection`, `scale`, `rotationDeg`, `offset`, las
ranuras como texto que nunca se llenaba): la proyección, el giro y el
desplazamiento pasan al mapeado, la escala a la repetición. El esquema
sigue en 2; una versión anterior abre un proyecto con texturas sin verlas.
Las mallas guardan su segundo juego de UV como `TEXCOORD_1` del GLB, solo
cuando lo tienen (una malla sin él escribe los bytes de siempre).
