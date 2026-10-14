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

Las partículas de *Ambiente* (S4a) no añaden dependencias: el simulador
es un *crate* propio del motor (`rt-sim`) y la vista previa usa los
`THREE.Points` e `InstancedMesh` de three.js, que ya estaba.

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

**Los plugins no son dependencias** (P6, §9). Repackshot no lleva ningún
plugin, no enlaza su código ni lo redistribuye: el usuario los instala desde
*Ajustes ▸ Plugins*, con su propia licencia (la del de película, de aintfilm,
es **cerrada**, y la interfaz lo dice: *El código de este plugin es cerrado; la
licencia de Repackshot no lo cubre*). Por eso no llevan línea en esta tabla ni
caen bajo la regla de las licencias permisivas, y su código no entra en el
repositorio: aquí solo están el anfitrión, el registro (`src/data/plugins.json`,
que fija el paquete por su `sha256`), el pegamento propio de cada plugin
(`tools/plugins/film/plugin.js`, código de Repackshot) y la herramienta que monta
el paquete desde el *checkout* del otro programa. Lo cerrado (el módulo
WebAssembly, las recetas, el logo, la licencia) va solo dentro del paquete
cifrado.

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
    optics.ts               la óptica de una cámara más allá de la lente fina (O1): bokeh, inclinación y descentramiento; neutra, límites, tipos de bokeh
    aperture.ts             registro de las imágenes de pupila (máscaras y texturas) a 256², como el de imágenes (O1)
    aspect.ts               la proporción de la imagen de una cámara (U13): preset o propia, su lectura, el tamaño que le toca; el marco del visor y el tamaño de una imagen la siguen (`syncOutputSize`, en `render.ts`)
    animation.ts            planos, movimientos, evaluación en el tiempo (invertir, repetir, suavidad: N6)
    explode.ts              el despiece configurable (N6): geometrías, niveles, orden, excepciones; lo que se mueve y cuándo
    timeline.ts             la aritmética de la línea de tiempo (N6): filas del árbol, regla, tramos de cámara, imán
    motion-hint.ts          lo que el visor dibuja de la animación elegida (N6): su objetivo y su pista
    camera-moves.ts         expande un movimiento de cámara de data/camera-moves.json en las barras de la línea de tiempo para una cámara (A6)
    doctor.ts               chequeos y arreglos sobre el modelo
    physics.ts              físicas (S2): la sección Físicas de un nodo, qué se simula (`physicsSpec`), las poses del simulador de vuelta a los nodos, la pista del clip PHYSICS y su ancla, las acciones `physics/*` (§5.6)
    effects.ts              los efectos de Ambiente (S4a): el efecto como dato, sus acciones `effect/*`, la región, la cuenta y el tope, los campos y los bytes de `FXAM`, los efectos de un archivo
    images.ts               registro de imágenes del entorno (HDRI, imagen de fondo), como el de mallas (E5), y de las texturas (M2a)
    textures.ts             texturas de imagen y etiquetas de un material (M2a): ranuras, mapeado, etiquetas, sus acciones `texture/*`, y la matemática de las proyecciones y de las etiquetas que siguen el shader y el motor
    texture-images.ts       las imágenes de textura en el registro: id por contenido, límites (M2a)
    material-graph.ts       el grafo de un material (M3a): nodos, tomas con tipo y sus conversiones, conexiones, sus acciones `graph/*`, Simple ↔ Nodos (§5.2 quater)
    material-program.ts     el compilador del grafo a un programa lineal de registros f32 y vec3, sus códigos, límites y bytes: el contrato de M3b (§5.2 quater)
    material-interp.ts      el intérprete de referencia del programa, en f32, y los puntos de la prueba cruzada con el motor (M3a)
    material-preview.ts     las esferas de los nodos, los mapas de Rápido (`planBake`, `bakeRows`, `finishBake`) y la media que hace de parámetros (M3a)
    material-examples.ts    los diez grafos de ejemplo como grafos, y la etiqueta de su plástico dibujada sin archivo (M3a)
    noise.ts                el ruido de gradiente (Perlin 2002 y símplex) y su suma en octavas, en f32: el contrato de M3b (M3a)
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
  data/                     CATÁLOGOS. Solo datos y tipos (§3); primitives.json + primitives.ts: las doce formas de Añadir ▸ Primitiva (U9); physics.ts: densidades por familia de material y valores por defecto de las físicas (S2); effects.ts: los presets de Ambiente (S4a)
  render/                   MOTORES DEL LADO WEB. Dependen de core, nunca de ui
    engine.ts               la interfaz RenderEngine (§5)
    preview.ts              three.js: vista previa rasterizada mientras se mueve la cámara; `aiFrame` (X4): el fotograma del modo Rápido y sus pases
    particles.ts            las partículas de Ambiente para Rápido (S4a): `rt_particles_eval` de rt.wasm en el hilo de la página, su tinte
    texture-shader.ts       el shader de texturas de Rápido (M2a): GLSL puesto en el MeshPhysicalMaterial de three con `onBeforeCompile`, montado sin GPU
    texture-preview.ts      las texturas y etiquetas en Rápido: el shader en cada material y la caché de texturas por imagen, con mipmaps (M2a)
    graph-preview.ts        los materiales de nodos en Rápido: sus mapas por las ranuras de M2a, en dos pasadas (M3a)
    graph-client.ts  graph-worker.ts  graph-protocol.ts  los workers de los grafos: las esferas del editor y las bandas de los mapas (M3a)
    preview-passes.ts       los pases de AI-POST.md §7.4 dibujados con three.js (albedo, normal, profundidad, ids exactos, coc) para la vista previa de la IA (X4); el suelo, con los rayos centrales del motor (X3c)
    pathtracer.ts           RenderEngine sobre un pool de workers que ejecutan rt.wasm (E4)
    worker.ts               el worker: instancia rt.wasm, recibe la escena RSB, renderiza baldosas
    pass-planes.ts          los pases exactos del motor en la página (X2): junta los de rt.wasm por baldosa y lee el RPP1 del lanzador
    physics-worker.ts       el worker del simulador (S2): su rt.wasm, una simulación a la vez, al ritmo del reloj y con acuse de recibo (§5.6)
    physics.ts  phys-wasm.ts  el cliente de ese worker (`PhysicsClient`) y la envoltura tipada de las exportaciones `phys_*` (`PhysWorld`)
  ai/                       POST-PROCESADO IA OPCIONAL (X3). Depende de core (y data), nunca al revés; la guarda NO es TypeScript: es rt-post
    post-wasm.ts            envoltura tipada de public/engine/post.wasm (plan, condicionamiento, aceptar) y el conductor runGuarded; worker y Node
    prompt.ts               el prompt de la escena (materiales, luces, estilo) y el negativo fijo; la tabla de materiales de la guarda
    synthetic.ts            el servicio sintético de X4 (sin modelo, determinista, informe medido); not-built.ts, el de una versión sin tubería
  plugins/                  PLUGINS (P6, §9). Dependen de core y data; la interfaz los ve por ui/ports.ts, como io
    rpk.ts                  el formato .rpk: cabecera, AES-256-GCM, contenedor, clave; lo comparten la página y las herramientas
    abi.ts                  los mensajes del ABI v1 entre el anfitrión y un plugin
    store.ts                IndexedDB: el paquete cifrado y su clave aparte (también en WebView2); en memoria sin él
    host.ts                 instalar (registro o archivo), quitar, abrir en memoria, arrancar el Worker, la sesión
    service.ts              lo que pide la interfaz: un resultado por un plugin (vista previa o a tamaño), los píxeles
  io/                       IMPORTADORES Y EXPORTADORES. Dependen de core
    import.ts               punto de entrada: detecta el formato, aplica la hoja de opciones, produce nodos
    gltf.ts  obj.ts  stl.ts  fbx.ts  rhino.ts  threemf.ts  ply.ts  collada.ts  usd.ts  three-scene.ts  step.ts step-worker.ts occt-protocol.ts occt-convert.ts (I2, OCCT)
    project.ts (.repack.json)  library.ts (biblioteca propia, JSON)  image.ts (PNG/JPEG/EXR/TIFF/DNG)
    rsb.ts                  escritor del formato de escena binario del motor (§5.2); `materialOrder`, el orden de materiales que numeran los pases (X3c)
    phys.ts                 escritor de PHY1, la escena del simulador (S2, §5.6)
    ai-runtime.ts           el motor de ejecución de la IA del lanzador (X3b); ai-post.ts, la tubería de escritorio (`DesktopAiService`, X3c)
    hdri.ts                 lectores propios de RGBE y OpenEXR, imagen de fondo, copia para la vista previa (E5)
    gltf-materials.ts       los materiales y las imágenes de un glTF leídos de su JSON (M2a)
    mtl.ts  obj-materials.ts  las bibliotecas .mtl de un OBJ y sus imágenes (M2a)
    texture-notes.ts        lo que la hoja dice de las texturas de un archivo (M2a)
    texture-pixels.ts       los píxeles de las texturas para la sección IMGS del RSB (M2a; la lee M2b)
    aperture.ts             lee las imágenes de pupila de public/assets/aperture (PNG gris propio, sin canvas) y las promedia a 256² (O1)
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
      insp-textures.ts      inspector ▸ Texturas: ranuras, mapeado y etiquetas (M2a)
      insp-ambient.ts       inspector ▸ Escena ▸ Ambiente: lista, galería de tarjetas, ocho mandos y Avanzado (S4a)
      material-editor.ts    la ventana Editor de material: barra, panel del nodo, teclas, sitio y tamaño recordados (M3a, UI.md §2.10)
      graph-canvas.ts       el lienzo del editor: tarjetas, tomas por forma, conexiones, zoom y desplazamiento (M3a)
      viewport-labels.ts    la herramienta de etiqueta del visor: colocar con pulsación y arrastre, Mover etiqueta (M2a)
      animation.ts          el cajón de animación (N6): transporte y las tres zonas; anim-tree.ts (qué se anima), anim-timeline.ts (regla, barras, imán, pista de cámara), anim-props.ts (propiedades, asistente, presets)
    texture-commands.ts     lo que hacen las ranuras y las etiquetas del inspector (M2a)
    physics.ts              la simulación en marcha (S2): Dejar caer, Iniciar, Pausar, Parar, Reiniciar, los clips que crecen
    panels/physics.ts  panels/insp-physics.ts  la barra de físicas (cajón de la barra inferior) y la sección Físicas del inspector (S2)
    anim-commands.ts        lo que hace la línea de tiempo (N6): selección de animaciones en paso con la escena y el visor, Animar…, duplicar, borrar, invertir, partir, fijar en el despiece, transporte y teclas
    graph-commands.ts       lo que hacen el editor de material y el inspector con un grafo: abrir, Simple ↔ Nodos, ejemplos, ediciones (M3a)
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
  plugin-pack.mjs  plugin-unpack.mjs  empaquetar y abrir un .rpk (P6, §9); plugins-check.mjs, la comprobación de navegador
  plugins/                  build-film.mjs (el paquete de película desde un checkout de aintfilm), brand-scan.mjs (D112),
                            film/manifest.json y film/plugin.js (el pegamento del ABI, nuestro)
  animation-check.mjs       comprobación en el navegador de la línea de tiempo y los despieces (N6): docs/ui/animation-timeline.png, explode-types.png y la hoja out/explode-sheet.html
  assets/                   generadores deterministas de public/assets/ (A6): common.mjs, aperture-masks.mjs, gobos.mjs; solo node:zlib y node:crypto
docs/                       este documento, SPEC, UI, ROADMAP
engine/                     EL MOTOR. Workspace de Cargo, Rust, sin dependencias externas (§5.1)
  Cargo.toml  rust-toolchain.toml  README.md
  crates/rt-core/           el trazador: matemáticas, SIMD, BVH, BSDF, luces, integrador, RSB, PNG, TIFF y DNG (U12);
                            imágenes (RGBE, OpenEXR, inflate, muestreo 2-D) y cielo (E5; el físico, E5c);
                            partículas de Ambiente: esferas, discos y cápsulas con su BVH (geometry/particles.rs, S4a)
  crates/rt-sim/            el simulador de partículas sin estado (S4a): `FXAM` ⇄ `AmbientParams`, `evaluate`
  crates/rt-cli/            binario nativo `rt`: renderiza un .rsb a PNG, TIFF o DNG con hilos; hojas de contacto
                            (las escenas de E5 en scenes.rs)
  crates/rt-wasm/           exportaciones extern "C" para el navegador (sin wasm-bindgen)
  crates/rt-app/            lanzador de escritorio `repackshot`: servidor local, ventana, motor nativo (§5.5)
  crates/rt-post/           la guarda del post-procesado IA y todo su trabajo con píxeles (AI-POST.md §7.2); rt-core no la conoce
  crates/rt-post-wasm/      exportaciones extern "C" de rt-post → public/engine/post.wasm
  crates/rt-phys/           el simulador de cuerpos rígidos (S2): XPBD, envolventes convexas, contactos, dormir; PHY1 (§5.6)
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
`plugins → core`, `core → data`. Nunca al revés, nunca `ui → render` directamente (el
*store* expone lo que el visor necesita y el visor se suscribe). Un test
de la suite (`tests/boundaries.test.ts`, U2) recorre los `import` y
falla si se viola; hoy no hay ninguna infracción. El motor (`engine/`) no conoce nada de `src/`: su
única interfaz con el resto es el formato RSB (§5.2), el PHY1 del
simulador (§5.6) y las exportaciones de `rt-wasm` (§5.3). La excepción es de herramienta, no del motor: `rt-sky`
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

Vive en `engine/`, un workspace de Cargo con ocho *crates*:

| Crate | Qué es | Reglas |
| --- | --- | --- |
| `rt-core` | **El trazador.** Biblioteca: matemáticas, SIMD, BVH, intersección, BSDF, luces, entorno, muestreo, integrador, lector y escritor RSB, codificador PNG, película y tonemapping | Solo `core`/`alloc`/`std` sin APIs del sistema (nada de `fs`, `net`, `time`, `thread`); `#![deny(unsafe_code)]` salvo el módulo `simd`; `#![deny(missing_docs)]`; `f32` en todo; sin `unwrap` en rutas que dependan de la entrada; compila para `wasm32-unknown-unknown` |
| `rt-sim` | **El simulador de partículas sin estado** (S0 §1–2, S4a): `AmbientParams` (lee y escribe la carga de `FXAM`), `evaluate(&params, max)` y `Evaluator::particle(id)`: cada partícula es función pura de (semilla, id, instante), en forma cerrada; fase propia (régimen estacionario: la región llena desde el primer instante), velocidad `v(a) = v_d + (v₀ − v_d)·e^{−a/τ}` integrada, deriva de *curl noise* como desplazamiento sin divergencia (Bridson, Houriham y Nordenstam, *Curl-noise for procedural fluid flow*, SIGGRAPH 2007), muerte en el suelo y renacimiento arriba (las que caen o suben nacen en su cara y viven lo que tardan en cruzar la caja; las que flotan viven siempre y la caja se envuelve), envolvente de nube por rechazo. La exponencial y el seno, tabulados con `fmath` una vez por efecto: nada de `exp`/`sin` por partícula | Las reglas de `rt-core`: solo `std` sin APIs del sistema, `#![forbid(unsafe_code)]`, `f32`, hash contador `mix64((seed << 32) ^ id)`. Comparte `fmath.rs` y `rng.rs` de `rt-core` compilándolos por `#[path]` (un test de `rt-core` comprueba que dan lo mismo): `rt-core` depende de `rt-sim`, no al revés |
| `rt-cli` | Binario nativo `rt`: lee un `.rsb`, renderiza con hilos (`std::thread::scope`, cola de baldosas atómica), escribe PNG, mide rayos/s; hojas de contacto y miniaturas en CI | Puede usar `std` entero |
| `rt-wasm` | `cdylib` con exportaciones `extern "C"` escritas a mano (`rt_alloc`, `rt_free`, `rt_scene_load`, `rt_render_tile`, `rt_render_tile_passes`, `rt_render_tile_albedo`, `rt_scene_caustics`, `rt_denoise`, `rt_particles_eval` (S4a: las partículas de un `FXAM`, 8 `f32` cada una, para Rápido), `rt_version`…) y las del simulador (`phys_new`, `phys_step`, `phys_poses`, `phys_awake`, `phys_settled`, `phys_hash`…, S2). Sin `wasm-bindgen`; enlaza `rt-post` solo por su *denoise* (E5b-1), `rt-sim` (S4a) y `rt-phys` (S2) | El único `unsafe` fuera de `simd`: la reserva de memoria lineal, comentada bloque a bloque |
| `rt-app` | Binario `repackshot`, el lanzador de escritorio (§5.5): servidor local, ventana, motor nativo, datos, equipo | `std` entero, **sin `unsafe`**; lo que necesita del sistema lo pide a procesos del sistema (`reg`, `nvidia-smi`) |
| `rt-post` | **El *denoise* propio** (E5b-1, `rt_post::denoise`, §5.2 bis) y **la guarda del post-procesado IA** (X3a, `AI-POST.md` §3.2 y §7.2): condicionamiento (bordes de los cambios de id y de normal, profundidad normalizada), mosaicos de ~1024² con solape de ≥ 128 px y fusión de coseno alzado, relleno a múltiplo de 16 y recorte, la guarda (transferencia de sombreado, separación de frecuencias, regiones por id con ΔE₀₀), las comprobaciones y la máquina de pasos `plan` → `conditioning`/`tile_input` → `accept` con reintentos; informe con la forma de `GuardReport` en JSON escrito a mano | Las reglas de `rt-core`: sin APIs del sistema, `#![forbid(unsafe_code)]`, `f32`, determinista (solo las funciones de `rt_core::fmath` y las curvas de tono de `rt_core::color`, nada de `f32::ln`/`exp`/`powf` de `std`). Depende de `rt-core`; `rt-core` no sabe que existe. En escritorio la enlaza `rt-app` (X3c: `src/ai/post.rs`, el conductor nativo) |
| `rt-sky` | **El cielo físico, fuera de línea** (E5c): simulador espectral de la atmósfera (capas esféricas, Rayleigh, aerosoles por turbidez, ozono, suelo lambertiano; dispersión simple por cuadratura y múltiple por Monte Carlo determinista), ajuste de la forma de Hošek–Wilkie con Levenberg–Marquardt propio y la tabla con su receta y su *hash* (`rt-sky table`); validación frente a cielos de bajo ruido, al cielo despejado de la CIE y a Preetham (`rt-sky validate`) | `std` entero (hilos, ficheros) y `f64`, pero reproducible: funciones elementales propias (`dmath`), un flujo aleatorio por elemento de trabajo, mismo resultado con cualquier número de hilos. Depende de `rt-core` (lee y prueba la tabla); `rt-core` no la conoce |
| `rt-phys` | **El simulador de cuerpos rígidos** (S2, §5.6): dinámica por posiciones extendida (XPBD), envolventes convexas propias, contactos por ejes separadores, rozamiento de Coulomb, restitución, dormir; el formato PHY1 | Las reglas de `rt-core`: sin APIs del sistema, `#![forbid(unsafe_code)]`, `#![deny(missing_docs)]`, `f32` y `rt_core::fmath`, determinista con cualquier número de hilos (`std::thread::scope` solo en nativo; en wasm, uno). Depende de `rt-core`; `rt-core` no la conoce |
| `rt-post-wasm` | `cdylib` con exportaciones `extern "C"` escritas a mano (`post_open`, `post_tile_input`, `post_tile_control`, `post_set_output`, `post_accept`, `post_result`…) → `public/engine/post.wasm`, un módulo aparte para que `rt.wasm` no crezca | Su `unsafe` vive solo en `src/ffi.rs`, comentado bloque a bloque; todo cruza como bytes *little-endian*, sin exigir alineación |

**Sin dependencias externas** quiere decir exactamente eso: ningún
*crate* de crates.io en ningún *crate* del workspace. `Cargo.lock` solo
lista `rt-core`, `rt-sim`, `rt-cli`, `rt-wasm`, `rt-app`, `rt-post`, `rt-post-wasm`, `rt-sky` y `rt-phys`,
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
  ni *denoise* ni cáusticas. Desde U11b (56 B), al final,
  `denoise_strength` (f32 en `0..=1`; fuera de ese rango el RSB no es
  válido): cuánto de la imagen filtrada se entrega; sin él, 1. Desde E11
  (64 B), al final, `pixel_filter` (u32: 0 la caja de un píxel, lo de
  siempre; 1 el centro; 2 tienda; 3 Blackman–Harris; desconocido = caja) y
  `edge_supersample` (u32: muestras por índice de un píxel de borde; 0 y
  1, una; más de 16, RSB no válido); sin ellos, la imagen de antes.
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
  bytes. Un valor fuera de rango hace inválido el fichero. Un RSB sin
  `LENS` es la lente fina de siempre, bit a bit (los *hash* del ejemplo,
  E5, E5c, E5b-1 y los pases no se movieron); una `LENS` neutra también.
  La interfaz la escribe solo para una cámara con óptica no neutra
  (`src/io/rsb.ts` `lensToRsb`): las imágenes de `public/assets/aperture/`
  promediadas 2 × 2 a 256 × 256 (`src/core/aperture.ts`, leídas sin
  *canvas* por `src/io/aperture.ts`), máscara por textura en una sola
  imagen, y `field_mm` = media diagonal del encuadre de salida en el
  sensor de 36 mm, sea cual sea la parte del visor que cubra la imagen.
- **`FXAM`** (S4a, repetible: una por efecto de *Ambiente*; un motor
  anterior la salta como sección desconocida). Los **parámetros** del
  efecto, no sus partículas: 192 B (los primeros 128 son obligatorios; una
  carga más corta es error, una más larga se lee hasta donde se conoce y
  lo que sobra se ignora; presupuesto, 256 B). El motor evalúa las
  partículas al cargar la escena con `rt-sim` y construye su BVH; la
  fuente de verdad es `rt_sim::params`.

  | Desplazamiento | Tipo | Campo | Qué es |
  | --- | --- | --- | --- |
  | 0 | `u32` | `kind` | código del preset (1 `DUST_MOTES` … 8 `CONFETTI`; otro se evalúa igual: deciden los campos) |
  | 4 | `u32` | `seed` | semilla |
  | 8 | `f32` | `time` | instante congelado, s |
  | 12 | `u32` | `count` | partículas que evaluar (el escritor ya aplica el tope; como mucho 2²⁴) |
  | 16 | `f32[3]` | `region_centre` | mm |
  | 28 | `f32[3]` | `region_half` | mitad del tamaño de la caja, mm (≥ 0) |
  | 40 | `f32[2]` | `band` | alturas que se conservan, mm (`min ≥ max`: sin banda; el escritor TypeScript ya la aplica a la caja y escribe 0, 0) |
  | 48 | `f32` | `size_mm` | diámetro medio, mm |
  | 52 | `f32` | `size_var` | variación relativa, 0..1 |
  | 56 | `u32` | `shape` | 0 esfera, 1 disco (copo), 2 cápsula (estela) |
  | 60 | `f32` | `fall_speed` | velocidad terminal a 1 g, mm/s |
  | 64 | `f32` | `fall_var` | variación relativa, 0..1 |
  | 68 | `f32[3]` | `wind` | mm/s |
  | 80 | `f32[3]` | `turbulence` | fuerza (desplazamiento, mm), escala (mm), velocidad (mm/s) |
  | 92 | `f32[3]` | `cloud_centre` | mm |
  | 104 | `f32` | `cloud_radius` | mm; 0: sin nube (se llena la caja) |
  | 108 | `f32` | `cloud_softness` | 0 borde duro .. 1 suave |
  | 112 | `u32` | `material_id` | índice de una `MATL` (si no existe, error) |
  | 116 | `f32` | `tint_var` | variación de tinte por partícula, 0..1 |
  | 120 | `u32` | `flags` | bit 0 visible a cámara, bit 1 en reflejos (y todo rayo secundario), bit 2 proyecta sombra |
  | 124 | `f32` | `streak` | largo de la cápsula entre su velocidad, s |
  | 128 | `f32` | `gravity` | múltiplo de g (1); negativa sube |
  | 132 | `f32` | `energy` | velocidad de nacimiento, mm/s (0) |
  | 136 | `f32` | `spin` | vueltas por segundo de los discos (0) |
  | 140 | `u32` | `palette_count` | tintes entre los que elige cada partícula, 0..4 (0: el color del material) |
  | 144 | `f32[4][3]` | `palette` | RGB lineal, multiplica el color base del material |

  **En el motor** (`rt-core::geometry::particles`): un conjunto por efecto
  con su BVH plana sobre los tamaños reales (hojas de una partícula; el id
  desempata), recorrido **después** de la BVH de instancias (la pieza más
  cercana acota el rayo; un rayo de sombra mira primero las piezas).
  Intersección estable de la esfera (Haines, Günther y Akenine-Möller,
  *Precision Improvements for Ray/Sphere Intersection*, *Ray Tracing Gems*
  2019, cap. 7), disco orientado y cápsula. **Tamaño mínimo en pantalla**:
  para los rayos de cámara, una partícula más fina que 0,35 px a su
  distancia se ensancha a eso (la BVH se rellena con el mismo margen) y el
  impacto se reparte para conservar la energía: con cobertura
  `c = (r / r_ensanchado)²`, el rayo se sombrea con probabilidad
  `q = max(c, ½)` y peso `c / q` o atraviesa con peso `(1 − c)/(1 − q)`
  (escalar la radiancia por `c` sin más oscurecería lo que hay detrás). El
  material de una partícula es el de su `material_id` con el tinte de su
  semilla; un disco es siempre pared fina. Pases: `partId` = el índice del
  efecto detrás de las instancias, `materialId` el de su `MATL`. Una
  actualización sin `MESH` con los mismos parámetros conserva las
  partículas y su BVH. Sin `FXAM` (o con cuenta 0) los píxeles de toda
  escena son los de antes de S4a (test).
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
  `0x1439a1a8` (tras E12: la selección de luz por punto mueve el hash) en cada ruta SIMD, en WASI, en el `rt_wasm.wasm` real
  (`rt --write-o1-example`, `tools/wasm-parity.mjs`, en CI) y con 1, 4 y
  16 hilos (`rt-cli/tests`).

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
`0x9ef7c8a0` (`PINNED_DENOISED_EXAMPLE_4SPP`, desde E12), igual con el `rt.wasm` real
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
escena de E5 con 2048 fotones por muestra, `0x5419866e` (desde E12)
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

***Denoise* en directo del visor** (U11). Dos ajustes del filtro
(`rt_post::denoise::Preset`): `FULL`, el de arriba, para el render (y para
`rt`), y `VIEWPORT`, tres pasadas à-trous (saltos 1, 2 y 4) y la varianza
espacial 3 × 3 por debajo de cuatro muestras, con su propio halo (24 filas;
`Preset::halo` es `2^(pasadas+1) + 8`, 72 para el completo); los dos son
deterministas y una banda de cualquiera son exactamente esas filas de la
imagen entera (`denoise_rows_with`; en wasm, `rt_denoise_with(1, …)` y
`rt_denoise_halo`; *hash* fijado del ejemplo con el del visor,
`PINNED_DENOISED_VIEWPORT_EXAMPLE_4SPP`). El ajuste lo elige el tipo de
trabajo, no el RSB: el `RNDR` no cambia. Un visor a resolución completa
pide siempre *denoise* en su RSB (así el motor renderiza las guías y el
interruptor no cambia la escena; mientras está apagado, el albedo de las
guías solo para las primeras `LIVE_ALBEDO_SAMPLES` = 8 muestras) y lleva el
interruptor aparte: en el lanzador, `denoise=0|1` al publicar la vista y
`POST /api/render/<id>/denoise?on=0|1` después; en la web, el propio
`PathTracerEngine`. **El carril**: cada pasada terminada se le entrega
(sumas, `lum2` y guías); mientras el interruptor está encendido, el
carril reduce el ruido de la pasada más nueva, enseña la imagen limpia en
cuanto está y arranca el siguiente sobre la más nueva entonces, sin parar
el render. En el lanzador es un hilo por trabajo de visor que, mientras
trabaja, toma uno de los hilos de render del visor (el último de los que
renderizan: `Gate::viewport_turn`), así que nunca le quita un hilo a un
render final que comparte la máquina; en la web, los *workers* del visor
toman sus bandas entre baldosa y baldosa. Con el interruptor encendido las
pasadas duran más o menos lo que un *denoise* y al menos 250 ms
(`live_pass_cap`, `livePassCap`; en qué pasada cae una muestra no cambia
un píxel), así que una imagen limpia llega como mucho una pasada y un
*denoise* después de la anterior: cada `max(2 × el denoise, 0,5 s)`. Cada
fotograma del lanzador lleva el número de su imagen (cabecera de 52 bytes,
`Frame::version`) y el *long-poll* lo pide con `version=`: las sumas solo
vienen con una imagen más nueva, y un visor ya terminado espera a la
limpia que el interruptor pidió. Apagado, el siguiente fotograma es la
acumulación ruidosa; encendido, se reduce al momento lo acumulado (también
con el visor convergido). Los fotogramas de gesto (resolución reducida)
siguen sin guías ni *denoise*; el render final reduce ruido una vez, al
final, con el filtro completo, como antes.

**Intensidad del *denoise*** (U11b). `RNDR.denoise_strength` (`s`, la
*Intensidad* de *Avanzado*, 0–100 % en el proyecto y `0..=1` en el motor)
mezcla en el motor la imagen ruidosa y la filtrada, por canal y en luz
lineal: `ruidosa × (1 − s) + filtrada × s` en `f32`
(`rt_post::denoise::blend`; con `s = 0,5` es exactamente la media; el alfa
no se toca). `denoise_rows_at(entrada, y0, y1, ajuste, s)` es la banda ya
mezclada; con `s = 0` no ejecuta el filtro y devuelve las filas ruidosas
tal cual, y con `s = 1` es `denoise_rows_with` (los *hashes* fijados no se
mueven). La usan el lanzador (el render final y el carril del visor: un
mismo mando), `rt --denoise-strength` y el wasm
(`rt_denoise_with(ajuste, s, …)`; `rt_denoise` es `s = 1`). Con `s = 0` un
final no se filtra (no lleva la bandera 64 ni la copia ruidosa) y el
carril del visor no trabaja. Cambiar la intensidad vuelve a empezar el
visor, como el resto de *Avanzado*.

### 5.2 ter · Elección de luz (E12)

**Por punto** (`rt_core::light`). La estimación de siguiente evento elige
**una** luz por vértice con probabilidad proporcional a una cota barata de
la irradiancia que cada una, sin oclusión, puede dar al punto `x` que se
sombrea: el caso plano, de un solo nivel, del árbol de luces de Conty
Estevez y Kulla («Importance Sampling of Many Lights with Adaptive Tree
Splitting», HPG 2018), con su cota de orientación del §4.3. Pesos en
`x`, todos en W/m² con las distancias en metros:

| Luz | Peso en `x` |
| --- | --- |
| Punto o foco | `lum(I) · máscara(x) / max(d², r²)` (la máscara del foco es exacta: el modelo enmascara por la dirección desde su centro) |
| Rectángulo o disco | `lum(L) · A · cos θ' / max(d², A)` |
| Malla emisora | lo mismo desde su centroide, con el cono de normales de sus caras; de dos caras o cerrada, `cos θ' = 1`, y cuenta una vez (una cara mira a `x`) |
| Sol | `lum(E)` |
| Entorno | `π L̄` |

`θ' = max(0, θ − θo − θu)`, cero cuando `θ' ≥ θe = π/2`: `θ` es el ángulo
entre el eje de las normales y la dirección del centro a `x`, `θo` la
apertura del cono de normales (0 en un panel), `θu` el semiángulo de la
esfera que envuelve la luz vista desde `x` (`sin θu = r / d`; dentro de
ella, cualquier dirección). Así ninguna luz que pueda iluminar `x` desde
alguno de sus puntos tiene probabilidad cero (un panel de canto desde su
centro cuenta). Se calcula con productos escalares y raíces
(`cos(a ± b)`), en `f32`, sin `sin`/`exp`/`powf` en el bucle.

**Contrato.** `Lights::select(x)` suma los pesos en `x` y devuelve una
`Selection` (el vértice, esa suma, los ocho primeros pesos y si la
elección es por flujo: 52 bytes, nada del tamaño de la lista de luces);
`sample_selected` elige con ella, reconstruyendo la distribución acumulada
entrada a entrada, con las mismas operaciones que `build_cdf` y `pick`,
hasta la luz que toma (los pesos pasados el octavo se vuelven a calcular,
con las mismas operaciones). El
rayo BSDF que sale del vértice la lleva en `Scattered { pdf, from }`.
`crossed`, `crossed_from`, `crossed_without_photons`, `escaped`,
`escaped_environment` y `emitter_weight` la reciben, y **una sola
función** (`Lights::pmf`) da la probabilidad de una luz en una selección
para la estimación de siguiente evento y para los pesos MIS: evaluada en
el vértice donde se muestreó el rayo, también cuando sigue recto por
paredes finas y recortes (los sucesos rectos no cambian `from`). De dos a
`MAX_LOCAL_LIGHTS` = 64 entradas (el coste por punto crece con su número);
con más, todos los sitios usan la distribución estática de antes de E12,
por flujo hacia la esfera que envuelve la escena
(`Lights::select_by_flux`). Con una sola entrada la elección es cierta y
la imagen la misma, bit a bit, por punto o por flujo (un test lo
comprueba), así que se elige por flujo, sin coste.

**Lo que sigue por flujo.** La emisión de fotones de las cáusticas (no hay
punto) y el **atrapasombras**: su sombra es el cociente de la luz que
llega y la que llegaría de una sola muestra, cuyo valor depende de cómo se
elige la luz; sigue con la elección estática (su muestra de luz y el MIS de
su rayo BSDF) y conserva su aspecto bit a bit. Un atrapasombras que
acumule las dos sumas por píxel y divida al resolver no dependería de la
elección (E13).
### 5.2 quater · Grafos de material: el programa, el intérprete y el ruido (M3a, contrato de M3b)

**El modelo** (`core/material-graph.ts`, catálogo en `data/material-nodes.ts`).
Un material en modo *Nodos* lleva `graph: { version: 1, nodes, links }`:
cada nodo `{ id, type, x, y, params, inputs }` (los parámetros de su tipo y
el valor propio de cada entrada que lo tiene) y cada conexión `{ from,
output, to, input }`, una por entrada, sin ciclos. Las tomas son `float`,
`color`, `vector` o `normal`; las conversiones implícitas: número → color
o vector, las tres componentes iguales (`F2V`); color → número, luminancia
Rec. 709 (`VLUM`); vector → número, la media (`VAVG`); color ↔ vector y
normal → vector, las mismas tres cifras; nada → normal salvo una normal.
Una entrada sin conexión ni valor lee una fuente del punto: `NORMAL` (N),
`UV0`, u `OBJECT` (P · 0,01, las coordenadas de la pieza por cada 100 mm).

**El compilador** (`core/material-program.ts`) recorre el grafo desde la
salida, compila cada (nodo, salida) una vez, convierte entre tipos donde
una conexión lo pide y da a cada valor un registro virtual; después los
empaqueta: cada valor toma el registro libre más bajo de su archivo al
escribirse y lo devuelve tras su última lectura (un destino nunca coincide
con un operando de la misma instrucción). Lo que no llega a la salida no se
compila (salvo las sondas de las vistas previas). Una entrada de la salida
sin conexión es una **constante** del programa, no una instrucción. Un
**relieve** evalúa su altura tres veces: en el punto y a `BUMP_STEP_MM` =
0,01 mm por T y por B; el propio programa mueve P (`P + 0,01·T`) y las UV
(`UV + 0,01·dUV/dT`, el mismo paso para los dos juegos). Un grafo de 30
nodos compila en menos de 1 ms (test). Límites: **2048 instrucciones, 256
registros f32, 256 vec3 (con los 9 del punto), 8192 constantes, 16
imágenes**; un grafo que los pasa no da programa y sí el motivo
(`TOO_MANY_…`).

**Registros.** Dos archivos: `F` (f32) y `V` (vec3, tres f32). El motor
llena antes de cada evaluación los nueve primeros vec3 con el punto, en el
espacio de la pieza:

| `V` | Nombre | Qué es |
| --- | --- | --- |
| 0 | `P` | posición, mm |
| 1 | `N` | normal de sombreado, unitaria, hacia fuera |
| 2 | `UV0` | primer juego de UV (u, v, 0); (0, 0, 0) sin UV |
| 3 | `UV1` | segundo juego; el primero si la malla tiene uno |
| 4 | `I` | dirección unitaria del punto al observador (al origen del rayo) |
| 5 | `T` | tangente unitaria: la dirección en que crece la u de UV0, ortogonalizada contra N; sin UV, `onb(N)` |
| 6 | `B` | N × T |
| 7 | `DUV_T` | (du/dT, dv/dT, 0) de UV0 por mm a lo largo de T; 0 sin UV |
| 8 | `DUV_B` | (du/dB, dv/dB, 0) |

`onb(n)` (Frisvad revisado por Duff et al., *Building an orthonormal basis,
revisited*, JCGT 2017): `s = n.z < 0 ? −1 : 1` (escrito así: −0 da 1),
`a = −1/(s + n.z)`, `b = (n.x·n.y)·a`, `T = (1 + ((s·n.x)·n.x)·a, s·b,
−(s·n.x))`.

**Instrucción**: seis palabras de 32 bits, `op d a b c k`. `d a b c` son
registros (de `F` o de `V` según el código) o `NONE` (−1, `0xFFFFFFFF` en
bytes); `k` es un índice en las constantes (`#`), en la tabla de imágenes
o un inmediato, según el código. Los códigos son **estables**: uno nuevo
toma un número nuevo, ninguno cambia de significado.

**Aritmética.** Todo en f32: **cada operación redondea a f32 en el orden
escrito** (paréntesis explícitos; sin FMA). `sin`, `atan2`, `asin`, `powf`,
`exp2`, `log2` son las de `rt_core::fmath` (las mismas en TS:
`core/f32math.ts`, bit a bit); `floor` es la exacta; `min(a, b)` es `b < a
? b : a`, `max(a, b)` es `b > a ? b : a` y `clamp01(x)` es `x < 0 ? 0 : x >
1 ? 1 : x` (comparaciones, nunca `f32::min`: un NaN pasa igual en los dos
lados). `lerp(a, b, t) = a + t·(b − a)`; `smoothstep(e0, e1, x)`: si `e1`
ni es mayor ni menor que `e0`, `x < e0 ? 0 : 1`; si no, `t = clamp01((x −
e0)/(e1 − e0))`, `(t·t)·(3 − 2·t)`.

| Código | Nombre | d | a | b | c | k | Resultado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | `NOP` | | | | | | nada |
| 1 | `FCONST` | F | | | | # | `consts[k]` |
| 2 | `VCONST` | V | | | | # | `(consts[k], consts[k+1], consts[k+2])` |
| 3 | `FMOV` | F | F | | | | `a` |
| 4 | `VMOV` | V | V | | | | `a` |
| 5 | `F2V` | V | F | | | | `(a, a, a)` |
| 6 | `VLUM` | F | V | | | | `((a.x·0,2126) + (a.y·0,7152)) + (a.z·0,0722)` |
| 7 | `VAVG` | F | V | | | | `((a.x + a.y) + a.z)/3` |
| 8–10 | `VX` `VY` `VZ` | F | V | | | | una componente |
| 11 | `VCOMB` | V | F | F | F | | `(a, b, c)` |
| 20 | `FADD` | F | F | F | | | `a + b` |
| 21 | `FSUB` | F | F | F | | | `a − b` |
| 22 | `FMUL` | F | F | F | | | `a·b` |
| 23 | `FDIV` | F | F | F | | | `b = 0 ? 0 : a/b` |
| 24 | `FPOW` | F | F | F | | | `a > 0`: `powf(a, b)`; `a = 0`: `b = 0 ? 1 : 0`; `a < 0` y `b` entero (`b = floor(b)`, \|b\| ≤ 2²⁴): `±powf(−a, b)`, negativo si `b % 2 ≠ 0`; NaN: NaN; si no 0 |
| 25 | `FMIN` | F | F | F | | | `min(a, b)` |
| 26 | `FMAX` | F | F | F | | | `max(a, b)` |
| 27 | `FSMIN` | F | F | F | F | | `m = min(a, b)`; `c ≤ 0` (o NaN): `m`; si no `h = max(c − \|a − b\|, 0)/c`, `m − ((h·h)·c)·0,25` |
| 28 | `FSMAX` | F | F | F | F | | `−FSMIN(−a, −b, c)` |
| 29 | `FABS` | F | F | | | | `\|a\|` |
| 30 | `FSSTEP` | F | F | F | F | | `smoothstep(b, c, a)` |
| 31 | `FMADD` | F | F | F | F | | `(a·b) + c` |
| 32 | `FLT` | F | F | F | | | `a < b ? 1 : 0` |
| 33 | `FGT` | F | F | F | | | `a > b ? 1 : 0` |
| 34 | `FFLOOR` | F | F | | | | `floor(a)` |
| 35 | `FFRACT` | F | F | | | | `a − floor(a)` |
| 36 | `FSIN` | F | F | | | | `sin(a)` |
| 37 | `FCLAMP` | F | F | | | | `clamp01(a)` |
| 38 | `FLERP` | F | F | F | F | | `lerp(a, b, c)` |
| 39 | `FINV` | F | F | | | | `1 − a` |
| 50–52 | `VADD` `VSUB` `VMUL` | V | V | V | | | por componente |
| 53 | `VSCALE` | V | V | F | | | `a·b` por componente |
| 54 | `VLERP` | V | V | V | F | | `lerp(a, b, c)` por componente |
| 55 | `VCLAMP` | V | V | | | | `clamp01` por componente |
| 56 | `VNORM` | V | V | V | | | `l = √((a.x·a.x + a.y·a.y) + a.z·a.z)`; `l > 0`: `a/l` por componente; si no `b` |
| 57 | `VINV` | V | V | | | | `1 − a` por componente |
| 58 | `VDOT` | F | V | V | | | `((a.x·b.x) + (a.y·b.y)) + (a.z·b.z)` |
| 59 | `VLEN` | F | V | | | | `√` de `VDOT(a, a)` |
| 70 | `BLEND` | V | V | V | F | modo | `t = clamp01(c)`; por componente `x = a`, `y = b`, `r` según el modo, resultado `lerp(x, r, t)`. Modos: 0 mezcla `y`; 1 suma `x + y`; 2 producto `x·y`; 3 resta `x − y`; 4 trama `1 − (1 − x)·(1 − y)`; 5 diferencia `\|x − y\|`; 6 aclarar `max(x, y)` (`y > x ? y : x`); 7 oscurecer `y < x ? y : x`; 8 superponer `x < 0,5 ? (2·x)·y : 1 − (2·(1 − x))·(1 − y)` |
| 80 | `MAP` | V | V (P) | V (N) | V (UV) | # (9) | las coordenadas de una proyección: abajo |
| 90 | `TEX` | V (rgb) | V (uv) | F (alfa, o `NONE`) | | imagen | la imagen `k` en `(a.x, a.y)`: abajo |
| 100 | `NOISE` | F | V | F | | # (5) | `fbm` de `a·b` (por componente): abajo |
| 101 | `NOISEC` | V | V | F | | # (5) | tres `fbm` con las semillas de cada canal |
| 110 | `GRAD` | F | V | | | tipo | `clamp01` de: 0 `x`; 1 `x > 0 ? x·x : 0`; 2 `smoothstep(0, 1, x)` como `(t·t)·(3 − 2·t)` con `t = clamp01(x)`; 3 `(x + y)·0,5`; 4 `1 − √((x·x + y·y) + z·z)`; 5 `(atan2(y, x)/τ) + 0,5` |
| 111 | `CHECK` | F | V | F | | | `s = ((floor(x·b) + floor(y·b)) + floor(z·b))`; `s − 2·floor(s·0,5)` (0 o 1) |
| 112 | `STRIPE` | F | V | F | F | # (2) | `q = a[eje]·b` (eje `consts[k]`: 0 x, 1 y, 2 z); `t = q − floor(q)`; `w = clamp01(c)`; `h = w·0,5`; `d = \|t − h\|`, `d = min(d, 1 − d)`; `e = (clamp01(consts[k+1])·0,5)·min(w, 1 − w)` (como `1 − w < w ? 1 − w : w`); `1 − smoothstep(h − e, h + e, d)` |
| 113 | `RAMP` | V | F | | | # | `x = clamp01(a)`; constantes: `n`, interpolación (0 lineal, 1 suavizada, 2 constante) y `n` paradas (posición, r, g, b) ordenadas por posición (el compilador las ordena, estable). `n ≤ 1` o `x ≤ pos₀`: la primera; `x ≥ posₙ₋₁`: la última; si no `i` la primera con `x < posᵢ₊₁` (`i ≤ n − 2`); constante: la `i`; si no `t = (x − posᵢ)/(posᵢ₊₁ − posᵢ)` (suavizada: `(t·t)·(3 − 2·t)`) y `lerp` por componente |
| 120 | `FRESNEL` | F | F (IOR) | V (n) | V (I) | | Fresnel dieléctrico exacto, sin polarizar: `η = a`; `η ≤ 1` (o NaN): 0; `cos = clamp01(\|VDOT(c, b)\|)`, `g = √(((η·η) − 1) + cos·cos)`, `A = (g − cos)/(g + cos)`, `B = ((cos·(g + cos)) − 1)/((cos·(g − cos)) + 1)`, `clamp01((0,5·(A·A))·(1 + B·B))` |
| 121 | `FACING` | F | F (mezcla) | V (n) | V (I) | | `f = 1 − clamp01(\|VDOT(c, b)\|)`; `m` = `a` llevada a [0,001, 0,999]; `f > 0 ? powf(f, (1 − m)/m) : 0` (mezcla 0,5: `f` tal cual) |
| 122 | `EDGE` | F | | | | # (1) | la convexidad de la pieza en el punto, 0–1, dentro del radio `consts[k]` mm (la mide el motor, M3b; la referencia da 0) |
| 123 | `CAVITY` | F | | | | # (1) | la concavidad, igual |
| 124 | `NMAP` | V | V (color) | F (intensidad) | V (n₀) | espacio | `m = 2·color − 1` por componente. Tangente (0): marco en torno a `n₀`: `T' = T − (T·n₀)·n₀` (`T` de `V5`), si su longitud > 1e−6 `T'/\|T'\|`, si no `onb(n₀)`; `B' = n₀ × T'`; `VNORM(T'·(m.x·s) + B'·(m.y·s) + n₀·m.z, n₀)`, sumado como `((T'ᵢ·(m.x·s)) + (B'ᵢ·(m.y·s))) + (n₀ᵢ·m.z)`. Pieza (1): `t = VNORM(m, n₀)`, `VNORM(n₀ + s·(t − n₀), n₀)` |
| 125 | `BUMP` | V | V (n₀) | F (dT) | F (dB) | | marco `T'`, `B'` en torno a `n₀` como en `NMAP`; `VNORM(n₀ − ((T'·dT) + (B'·dB)), n₀)` por componente |

Un relieve se compila como `h₀`, `h_T` y `h_B` (la altura en el punto y en
los dos pasos), `dT = (h_T − h₀)·k` y `dB = (h_B − h₀)·k` con `k =
intensidad·distancia/0,01` (negativo si se invierte; el *relieve* de la
salida usa `k = 1/0,01`: su altura ya está en mm), y `BUMP(n, dT, dB)`.

**`MAP`.** Constantes: proyección (0 UV, 1 plana, 2 caja, 3 cilíndrica, 4
esférica, 5 objeto), eje (0 X, 1 Y, 2 Z), tamaño (mm), cos y sen del giro
(el compilador los calcula: `fmath::sin_cos(giro_f32 · DEG_TO_RAD)`),
repetición u, v y desplazamiento u, v. Los ejes de sección (S, T, A) del
eje: Z (x, y, z), X (y, z, x), Y (z, x, y). Las coordenadas antes del giro,
`(cu, cv)`, y el centro `ce`:
- UV: `(uv.x, uv.y)`, `ce = 0`.
- Plana: Z `(p.x, p.y)`, Y `(p.x, p.z)`, X `(p.y, p.z)`, divididas por el
  tamaño; `ce = 0,5`.
- Caja: la cara a la que más mira la normal (`|n.x| ≥ |n.y|` y `≥ |n.z|`: X;
  si no, `|n.y| ≥ |n.z|`: Y; si no Z), vista desde fuera sin espejos: X
  `(n.x ≥ 0 ? p.y : −p.y, p.z)`, Y `(n.y ≤ 0 ? p.x : −p.x, p.z)`, Z `(n.z ≥ 0
  ? p.x : −p.x, p.y)`, divididas por el tamaño; `ce = 0,5`. (Una cara, no
  la mezcla por |n|⁴ de M2a: un programa es un punto; *Rápido* sí mezcla y
  lo dice.)
- Cilíndrica: `cu = vueltas(S, T)` con `vueltas = ((atan2(T, S) + π/2)/τ)`,
  `cu − floor(cu + 0,5)` (−0,5…0,5, 0 delante, hacia −T); `cv = A/tamaño`;
  `ce = 0,5`.
- Esférica: `cu = vueltas(S, T)`; `r = √((x·x + y·y) + z·z)`; `cv = r > 0 ?
  asin(A/r)/π : 0`; `ce = 0,5`.
- Objeto: `(cu, cv) = (S, T)/tamaño` y la tercera `w = A/tamaño`; `ce = 0`.
Después: `x = cu·ru`, `y = cv·rv`; resultado `((((cos·x) − (sen·y)) + ou) +
ce, (((sen·x) + (cos·y)) + ov) + ce, w)` (`w = 0` salvo en objeto). Es la
matemática de `core/textures.ts` (M2a) en f32 (test).

**`TEX`.** La tabla de imágenes da, por entrada, la imagen (el índice en
la sección `IMGS` de la escena en el motor; ninguna: falta), si es sRGB y
el borde (0 repetir, 1 estirar, 2 espejo). Sin píxeles: color (1, 1, 1),
alfa 0. Si no: cada coordenada se reduce antes de escalarla (no finita: 0;
repetir: `u − floor(u)`; estirar: `clamp01(u)`; espejo: `u − 2·floor(u/2)`)
y `v` se lee al revés (filas desde arriba): `ru = reducir(u)`, `rv =
reducir(1 − v)`; `x = (ru·ancho) − 0,5`, `y = (rv·alto) − 0,5`; `x₀ =
floor(x)`, `fx = x − x₀` (igual en y); los índices `x₀`, `x₀ + 1` (y los de
y) se llevan dentro con el borde (repetir: módulo; estirar: al borde;
espejo: período 2·n, `m < n ? m : 2n − 1 − m`). Cada téxel se decodifica
antes de interpolar: el rgb de una imagen sRGB por la tabla `SRGB_TO_LINEAR`
(`c = byte/255`; `c ≤ 0,04045 ? c/12,92 : powf((c + 0,055)/1,055, 2,4)`, en
f32 con `fmath::powf`), el de una de datos y el alfa como `byte/255`; luego
`lerp` en x de las dos filas y `lerp` en y. Es el nivel 0, bilineal: el
motor filtrará con mipmaps (M2b), la prueba cruzada usa el nivel 0.

**El ruido** (`core/noise.ts`; de K. Perlin, *Improving noise*, 2002, y de
S. Gustavson, *Simplex noise demystified*, 2005; sin la tabla de
permutaciones del artículo). Las constantes de `NOISE` son: tipo (0 Perlin,
1 símplex), octavas (1–8), lacunaridad, ganancia y semilla (0–65535), todas
f32 exactas.
- *Hash* de una esquina entera `(i, j, k)` y una semilla (todo u32, con
  productos y desplazamientos de 32 bits: `wrapping_mul`, `>>` lógico):
  `h = (i·73856093) ^ (j·19349663) ^ (k·83492791) ^ (semilla·0x9E3779B1)`
  (los primos de Teschner et al., 2003, y la constante de Knuth), y el
  finalizador `lowbias32` de C. Wellons: `h ^= h >> 16; h ·= 0x7FEB352D;
  h ^= h >> 15; h ·= 0x846CA68B; h ^= h >> 16`.
- *Gradiente*: `g = h & 15`, `u = g < 8 ? x : y`, `v = g < 4 ? y : (g = 12 o
  14 ? x : z)`, resultado `(g & 1 = 0 ? u : −u) + (g & 2 = 0 ? v : −v)`.
- `fade(t) = ((t·t)·t)·((t·((t·6) − 15)) + 10)`; `lerp(t, a, b) = a + t·(b −
  a)`.
- **Perlin**: si alguna componente no cumple `|x| ≤ 1e9` (NaN incluido), 0.
  `xf = floor(x)`, `i = xf` como entero; `x₀ = x − xf`, `x₁ = x₀ − 1` (igual
  en y, z); `u, v, w = fade(x₀), fade(y₀), fade(z₀)`; las ocho esquinas
  `gᵢⱼₖ = grad(hash(i + di, j + dj, k + dk), x_di, y_dj, z_dk)`; `a =
  lerp(u, g000, g100)`, `b = lerp(u, g010, g110)`, `c = lerp(u, g001, g101)`,
  `d = lerp(u, g011, g111)`; resultado `lerp(w, lerp(v, a, b), lerp(v, c,
  d))`.
- **Símplex**: el mismo límite. `F3 = f32(1/3)`, `G3 = f32(1/6)`; `s = ((x
  + y) + z)·F3`; `i = floor(x + s)` (igual j, k); `t = ((i + j) + k)·G3`;
  `x₀ = x − (i − t)` (igual y₀, z₀); el símplex por el orden de x₀, y₀, z₀
  (x₀ ≥ y₀: y₀ ≥ z₀ → (1,0,0)(1,1,0); x₀ ≥ z₀ → (1,0,0)(1,0,1); si no
  (0,0,1)(1,0,1); x₀ < y₀: y₀ < z₀ → (0,0,1)(0,1,1); x₀ < z₀ →
  (0,1,0)(0,1,1); si no (0,1,0)(1,1,0)); `x₁ = (x₀ − i₁) + G3`, `x₂ = (x₀ −
  i₂) + f32(2·G3)`, `x₃ = (x₀ − 1) + f32(3·G3)` (igual y, z); cada esquina:
  `τ = ((0,6 − x·x) − y·y) − z·z`, `τ < 0 ? 0 : ((τ·τ)·(τ·τ))·grad(…)`;
  resultado `32·(((n₀ + n₁) + n₂) + n₃)`.
- **Suma en octavas**: `suma = 0, norma = 0, amp = 1, frec = 1`; por cada
  octava `o` (desde 0): `n = base(x·frec, y·frec, z·frec, semilla + o)`,
  `suma = suma + amp·n`, `norma = norma + amp`, `amp = amp·ganancia`, `frec
  = frec·lacunaridad`; resultado `0,5 + 0,5·(suma/norma)` (unos 0…1, media
  0,5). El color: tres sumas con las semillas `semilla + 7919·(canal + 1)`.

**Las salidas.** El programa termina con quince referencias, en el orden
de las entradas de la salida (`OUTPUT_KEYS`): color base, metal, rugosidad,
anisotropía, barniz, rugosidad del barniz, transmisión, IOR, dispersión
interna, emisión, intensidad de emisión, opacidad, normal, relieve (ya
aplicado a la normal; su referencia es la altura) y bisel. Cada una es una
constante f32 (`FC`), un registro f32 (`F`), una constante vec3 (`VC`) o un
registro vec3 (`V`); la normal sin conexión es `V1`. Y dos campos del
material, no del punto: la distancia de absorción y las paredes finas. El
motor usará lo que necesita y llevará cada valor a su rango (M3b).

**Bytes** (`encodeProgram`, `decodeProgram`; little-endian): una cabecera de
diez u32 (`0x4D475052` «RPGM», versión 1, instrucciones, constantes,
imágenes, registros f32, registros vec3 contando los 9 del punto, salidas,
la distancia de absorción como f32, banderas: bit 0 paredes finas), las
instrucciones (seis u32 cada una), las constantes (f32), la tabla de
imágenes (tres u32: índice en `IMGS` o `0xFFFFFFFF`, 1 si sRGB, borde) y
las salidas (dos u32: tipo 0 `FC`, 1 `F`, 2 `VC`, 3 `V`; índice).
**Propuesta para M3b**, sin escribir aún: una sección `PROG` del RSB con
los programas de la escena y, en `MATL`, tras el bloque de texturas, el
índice de su programa (−1: ninguno); hasta entonces el escritor manda la
**media de cada salida** sobre 64 puntos de una esfera
(`core/material-preview.ts` `flattenGraph`) como los parámetros del
material, y los bytes de una escena sin grafos son los de siempre.

**La prueba cruzada** (`tests/material-program.test.ts`). `contractPoints(n,
semilla = 0x2545F491)`: un generador xorshift32 (`x ^= x << 13; x ^= x >>
17; x ^= x << 5`, todo u32; un número es `(x >> 8)/2²⁴`) da, por punto y en
este orden: P (`200·r − 100` mm, tres veces), N (`2·r − 1` tres veces,
normalizado en f32: cada componente entre la longitud f32; +Z si es cero),
UV0 (`2·r − 0,5` dos veces), UV1 igual, I (como N; N si es cero), T =
`onb(N)`, B = N × T, dUV/dT (`0,02·r` dos veces), dUV/dB igual; cada valor
calculado en f64 y redondeado **una vez** a f32. Para cada ejemplo, el
FNV-1a de 32 bits de los bits f32 de todas sus salidas en los 1000 puntos
(salida a salida, componente a componente, punto a punto; el plástico con
etiqueta con la etiqueta de `core/material-examples.ts`) está fijado; el
intérprete de Rust (M3b) tiene que dar los mismos.

**En Rápido** (`core/material-preview.ts`, `render/graph-preview.ts`,
`render/graph-client.ts`, `render/graph-worker.ts`). El programa se evalúa
en mapas de 512² (antes uno de 128², al momento) en *workers* que se reparten
las filas (`bakeRows`, unidas con `finishBake`), sobre la superficie que
elige `planBake`: el cuadrado UV si solo lee UV; la superficie propia de su
proyección si una sola la alimenta (los puntos de un plano, de la cara
frontal de la caja, de un cilindro de circunferencia el tamaño, de una
esfera, cuyos `MAP` dan exactamente la u, v del téxel), dibujada con la
misma proyección y la transformación ajustada al cuadrado que cubre la
pieza (repetición/d, desplazamiento `(o + ½ − u₀)/d − ½`): es el programa,
salvo resolución; si no, un corte por el plano frontal (y = 0) de la pieza
dibujado como caja. Fresnel y *de cara* a 60° de la normal, la curvatura 0.
Los mapas de color, rugosidad, metal, opacidad, normal (en el marco de la
proyección, para el marco de derivadas del *shader* de M2a) y emisión (con
su escala como intensidad) entran por las ranuras de M2a con ids
`graph:<material>:<versión>:<ranura>` que `TexturePreview` sirve como
`DataTexture`; las demás salidas, su media; una ranura de imagen propia del
material gana a la del grafo. El editor pide sus esferas al primer *worker*
(`GraphPreviewPort`); un pedido nuevo de un canal sustituye al que espera y
solo corre uno por canal.

### 5.2 quinquies · Filtro de píxel y muestras de borde (E11)

`rt_core::pixel_filter`. **Filtro por muestreo de importancia**: la
posición uniforme en el píxel que da el muestreador (`DIM_CAMERA`, dos
dimensiones) se desplaza, eje a eje, con la inversa de la CDF del filtro
(los cuatro son separables); la muestra pesa 1 y va a su píxel, así que la
imagen sigue siendo la media de las muestras de cada píxel y una baldosa no
depende de sus vecinas. *Estándar* (0) es la posición tal cual (los mismos
bits que antes: el ejemplo, `0x8206111f` tras E12, intacto); *Ninguno* (1), 0,5 en los dos ejes;
*Suave* (2), tienda `1 − |x|` en `[−1, 1]`, inversa con dos raíces
(`f32::sqrt`, correctamente redondeada en todas partes, wasm incluido);
*Fino* (3), Blackman–Harris de radio 1,5 px (Harris 1978, coeficientes
0,35875 · 0,48829 · 0,14128 · 0,01168) con su CDF inversa en una tabla
`f32` de 256 valores en `u = i/255` (`BLACKMAN_HARRIS_INV_CDF`; la hace y
la comprueba un test, por bisección sobre la integral de la ventana en
`f64`) interpolada linealmente: ni `exp` ni `sin` ni `cos` al renderizar.
La posición en pantalla (para la imagen de fondo) se recorta a `[0, 1]`
cuando el filtro pasa del borde de la imagen.

**Muestras de borde.** `EdgeMask::of(escena, preparado, baldosa, isa)`
lanza los rayos centrales (los de los pases exactos, `centre_ray` y
`Exact`) de la baldosa y de un anillo de un píxel a su alrededor (dentro de
la imagen) y marca como borde el píxel cuyo vecino 3 × 3 ve otra pieza, otro
material o una profundidad a más del 2 %: no depende de cómo se corte la
imagen en baldosas. `render_tile_edges` y `render_tile_albedo_edges` hacen
lo de siempre fuera de los bordes; en un borde, la muestra de índice `s`
son `k` muestras de índices `s·k … s·k + k − 1` de la propia secuencia del
píxel, y se suma **su media una sola vez**. Así cada píxel sigue teniendo
una aportación por índice (el peso de la película, el contador de muestras
de los anfitriones, la varianza de la media que usa el *denoise*: todo
igual), y un píxel de borde acaba con `k` veces las muestras. El mapa de
fotones de las cáusticas de `s` sirve a sus `k` muestras. Los anfitriones
calculan la máscara una vez por baldosa: `rt` y el lanzador en un
`OnceLock` por baldosa (la primera que la renderiza), el wasm en su escena
cargada por rectángulo (`KEPT_EDGE_MASKS`, se vacía al actualizar la
escena). En el ejemplo son el 1,8 % de los píxeles. *Hash* fijado del
ejemplo con *Fino + bordes ×2*: `PINNED_E11_EDGES_4SPP` = `0x3d8f85de` (con la elección de luz de E12),
igual en escalar, SSE2 y AVX2, con baldosas de 32 y de 23, por `rt` y el
lanzador con 1, 4 y 16 hilos, por el `rt.wasm` real (`wasm-parity.mjs`,
`rt --write-e11-example`) y por el código de la página.

**En la interfaz** son ajustes de la aplicación (`engine.fastAa`, de
fábrica 4×, y `engine.pixelFilter`, de fábrica *Fino*: los mismos rayos
que la caja; `core/antialias.ts`): `PathTracerEngine` y
`NativeEngine` (`setPixelFilter`) los ponen en la vista y en cada render
(`TracerView.pixelFilter`, `.edgeSupersample`; los fotogramas de gesto,
sin muestras de borde), y su `status()` dice el filtro de la imagen en
pantalla. *Rápido*: `PreviewEngine.setMsaa(n)`; con el número de muestras
del lienzo (`antialias: true`, normalmente 4) dibuja en el lienzo como
siempre; con otro, en un destino de `n` muestras (como mucho
`capabilities.maxSamples`) que three.js trata como la pantalla
(`isXRRenderTarget`: curva de tono y sRGB en cada material, color de
fondo en sRGB) guardado en `RGBA8` sin codificar ni decodificar, y lo
copia tal cual al lienzo antes de los contornos y el *gizmo*.

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

### 5.6 · Físicas: `rt-phys`, PHY1 y su *worker* (S2)

**El simulador** (`engine/crates/rt-phys`, solo `std` y `rt-core`) es
dinámica por posiciones extendida (XPBD) para cuerpos rígidos, como en
Müller, Macklin, Chentanez, Jeschke y Kim, «Detailed Rigid Body Simulation
with Extended Position Based Dynamics» (SCA 2020): paso fijo de 1/240 s con
4 subpasos y una iteración de posición por subpaso, masas inversas
generalizadas, el cuaternión que avanza con `q += ½ [ω, 0] q` y el término
giroscópico, velocidades derivadas de las posiciones y restitución con el
umbral 2 |g| h. Gravedad −Z, 9 810 mm/s². La API es `World`: `add_floor`,
`add_static_mesh`, `add_dynamic` (de puntos, una esfera o una caja, con
densidad, rozamiento y restitución), `step(n)`, `poses()` (por cuerpo
dinámico, el centro de masas y el cuaternión: 7 `f32`), `awake_count`,
`settled`, `hash` (FNV-1a de las poses).

- **Formas.** Cada pieza dinámica es su **envolvente convexa** (*quickhull*
  propio, Barber, Dobkin y Huhdanpaa 1996, con las caras coplanarias
  fundidas), de 128 vértices como mucho; si no sale, su caja orientada por
  componentes principales. Una nube de ≥ 26 puntos a la misma distancia
  del centro (0,2 %) es una **esfera** exacta. Un cuerpo de varias piezas
  (un grupo que cae como uno) es la envolvente de todas. Lo estático son
  triángulos en una BVH propia (mediana, hojas de 4), y el suelo un único
  triángulo enorme (±10⁵ mm) a su altura.
- **Contactos.** Ejes separadores con la poda por arcos del mapa de Gauss
  (Gregorius, GDC 2013; un triángulo es una envolvente de dos caras), recorte
  de Sutherland–Hodgman y como mucho 4 puntos por par, los ejes de cara
  antes que los de arista, márgenes especulativos; los parches coplanarios
  de un cuerpo contra lo estático se funden en uno. Entre dos superficies,
  la media geométrica de los rozamientos y el mayor de los rebotes.
- **Rozamiento**: de Coulomb, por parche (en su centroide) con torsión
  por el radio del parche; el estático se sostiene contra un **ancla**
  que se guarda de paso a paso mientras el parche no se mueve, el dinámico
  es un impulso de como mucho μλ/h; resistencia a la rodadura de 0,02 veces
  el radio. Son las desviaciones del artículo que hicieron falta para que
  una caja quieta no derive ni gire y una pila no se caiga (ROADMAP, S2).
- **Dormir**: un cuerpo cuyo recorrido en 0,5 s no pasa de lo que haría a la
  velocidad de reposo (3 mm/s o el 5 % del radio por segundo) se duerme;
  se despierta cuando algo se le acerca deprisa. Con todos dormidos,
  `settled`.
- **Determinismo**: `f32` y `rt_core::fmath`; la fase estrecha se reparte en
  trozos (hilos con `std::thread::scope` en nativo, uno en wasm) y los
  contactos se ordenan por (cuerpo, cuerpo, triángulo, rasgo) antes de
  resolver, así que el *hash* no depende del número de hilos. Los tests
  fijan el *hash* de una caída a 60, 90, 120 y 480 pasos y lo comprueban
  también compilados a `wasm32-wasip1`; `tests/physics-engine.test.ts`
  repite la escena de `tests/fixtures/phys-drop.json` con el `rt.wasm` real.

**PHY1** (`rt-phys/src/scene.rs`; lo escribe `src/io/phys.ts`): `"PHY1"`,
versión, las mallas (posiciones y triángulos), los cuerpos (estático o
dinámico, densidad, rozamiento, restitución y sus piezas: malla y matriz
objeto → mundo de 3 × 4 por filas) y el suelo; *little-endian*, palabras de
4 bytes. La interfaz manda primero los dinámicos, en el orden de
`physicsSpec`; `phys_ids` dice dónde quedó cada uno entre las poses (o que
no tiene masa y no se simula).

**En el navegador** (`src/render/physics-worker.ts`, `physics.ts`,
`phys-wasm.ts`): un *worker* propio con el `rt.wasm` escalar, arrancado la
primera vez que se simula; sin `rt.wasm`, la simulación dice que necesita
el motor. Una simulación a la vez; avanza en rebanadas de como mucho 24
pasos, al ritmo del reloj como mucho, guarda las poses en cada fotograma de
los fps del proyecto (el paso `round(k · 240 / fps)`) y las manda en
cuanto las tiene; la página acusa recibo de cada envío y el *worker* no va
más de 1/8 s por delante de lo recibido (en una página cargada la
simulación va más despacio, no acaba sin que se vea). Pausar, reanudar y
parar entran entre rebanadas. Del lado de la interfaz, `ui/physics.ts`
convierte cada fotograma en la muestra local de cada nodo
(`moverSample`: Δ = T(p) R(q) T(−c₀) sobre su matriz de antes, en los ejes
de su padre) y hace crecer los clips `PHYSICS` con `TrackWriter`, que
codifica en base64 solo lo nuevo; el cabezal los sigue, así que el visor
enseña la caída por la animación (`evaluate`, `SPEC.md` §3.7) sin tocar los nodos
hasta confirmar. Mientras corre, el visor se queda en *Rápido*.

**Por el *store***: `physics/set` (la sección *Físicas*), y una
simulación son `physics/begin` (los clips, y los papeles que da *Dejar
caer*), `physics/grow` (las pistas) y `physics/commit` (las poses finales y
el ancla de los clips), todas con el mismo gesto: una entrada de deshacer.
`physics/reset` es otra. `AppServices.physics` (`PhysicsPort`, §6.1) es lo
único que la interfaz sabe del simulador.

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
sobre el motor que está en pantalla y se lo entrega (y, desde M3a, un
`GraphPreviewPort` sobre los *workers* de los grafos, con el que el editor
de material pide las esferas de sus nodos; sin él no las dibuja). Es lo
único que la interfaz sabe del visor:

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

El simulador (S2) es otro puerto, `AppServices.physics` (`PhysicsPort`):
`run(spec, { fps, maxSeconds }, onUpdate)` devuelve una simulación
(`started`, `done`, `pause`, `resume`, `stop`); `main.ts` lo construye con
`writePhysicsScene` (`io/phys.ts`) y `PhysicsClient` (`render/physics.ts`).
Sin él (`null`), la barra de físicas dice que hace falta el motor. Los
tests usan un doble que contesta como el *worker*.

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
| Ambiente (S4a) | `tests/effects.test.ts`, `effects-rsb.test.ts` (con el `rt.wasm` real); `rt-sim` (`eval::tests`, `params`), `render::ambient_tests` y `geometry::tests` de rt-core; `tools/ambient-check.mjs`; la hoja `tools/ambient-sheet.mjs` | El catálogo y sus claves; las cuatro acciones por el *store* (deshacer, gestos, nada para un valor que ya tiene, el preset que conserva sitio, instante, semilla, tope y nombre); región, cuenta y tope; los campos de `FXAM` en unidades del motor, byte a byte frente a los que escribe `rt --write-ambient-example`; el Doctor y su arreglo; guardar y abrir cada campo, un archivo anterior sin efectos; en el motor, el *hash* de posiciones fijado (nativo y wasm, 1 y N hilos), régimen estacionario a 0, 3 y 60 s (< 3 %), nada bajo el suelo, la imagen fijada en todas las ISA, las escenas de referencia sin cambios sin efectos, la fuerza bruta frente a la BVH para cada clase de rayo, y la energía del ensanchado (4 frente a 256 spp, ± 2 %) |
| Óptica de cámara (O1) | `optics::tests` de rt-core, `tests/optics.test.ts`, `tools/optics-check.mjs` | Pupila de 6 láminas dentro del hexágono y fuera del círculo inscrito en su proporción (±1 %), láminas curvas, perfiles con su densidad, obstrucción, máscara por CDF con la media del rechazo (±1 %), Scheimpflug y bisagra con tres puntos, descentramiento, anamórfico, ojo de gato con el área de dos discos, bandas que suman blanco; una lente neutra es la lente fina bit a bit; `LENS` de ida y vuelta con los bytes de `rt`; miniaturas al día; *hash* de O1 en SIMD, WASI, wasm y 1/4/16 hilos |
| Sets (L6) | `tests/sets.test.ts`, `data`, `rig`; `tools/setup-thumbs.mjs`, `tools/sets-sheet.mjs` | Los 72 montajes anteriores sin campos nuevos y con el mismo rig que antes contra los 16 tipos (fixture); los tipos de producto con los focos de su set a su nivel; ninguna tarjeta en el encuadre (16 focales, tres formas, tres proporciones, la cámara del set: recorte del polígono contra la pirámide de la cámara, y un caso que se ve para que la prueba no pase sola); aplicar, sustituir, quitar con otro montaje y con *Restablecer*, *Crear estudio* con un set, una entrada de deshacer; la decoración no es el producto ni la mira el Doctor; el charco (su parte del nivel, dónde cae, su potencia); *Usar la cámara del set*; el degradado como imagen de fondo del RSB; las miniaturas: la escena RSB de cada una tal como la construye el código ahora y el PNG del manifiesto, y el *hash* de una fijado; medidas sobre las miniaturas con los umbrales del veredicto en `LOOK` (`tests/thumb-metrics.ts`; `REPACKSHOT_SET_MEASURES=1` las imprime) |
| Gestos en el navegador | `tools/material-drag-check.mjs`, `box-select-check.mjs`, `primitives-check.mjs` (U9), `lights-check.mjs` (L4), `sets-check.mjs` (L6) | Playwright con el Chromium local sobre `dist/`, en Rápido y en Completo, con ratón, lápiz y dedo; capturas en `docs/ui/` (las de Completo, en `out/`) |
| Físicas (S2) | `cargo test -p rt-phys` (`tests/rigid.rs`); `tests/physics.test.ts`, `physics-engine.test.ts`; `tools/physics-check.mjs` | Una esfera descansa a `r ± 0,1` mm, una pila de tres cajas aguanta 5 s, una caja inclinada cae plana, un cubo resbala de una esfera, una rampa sostiene a μ 0,6 y deja resbalar a 0,1, mil esferas se asientan (< 20 s en *release*), dormir para la simulación, *hash* fijado igual con 1 y N hilos y en wasm; qué se simula, las poses de vuelta a los nodos, una simulación es una entrada de deshacer, *Reiniciar* otra, *Pausar* congela lo que se ve, el clip se guarda, se abre y se reproduce; tres primitivas que caen en el navegador |
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

**Ambiente** (S4a). `state.effects` es la lista de efectos (SPEC §3.1),
sus parámetros y nada más: las partículas no se guardan, se evalúan. Un
archivo sin el campo (anterior a S4a) abre con la lista vacía; al abrir,
`normalizeEffects` quita lo que no es un efecto (o repite un id), completa
con los valores de su preset los campos que faltan y deja con el primer
preset disponible (y sus parámetros) un preset que esta versión no conoce.
El esquema sigue en 2. El Doctor se vuelve a pasar al abrir con los
chequeos de esta versión: un archivo anterior trae los suyos sin
`particles`.

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

**Físicas** (S2). Un nodo puede llevar su sección *Físicas* en el campo
opcional `physics` (`{ "role": "DYNAMIC", "density": 2500, "friction":
0.4, "bounciness": 0.1, "asParts": true }`, cada clave opcional) y la
animación clips `PHYSICS` con su pista (`track`: `{ "fps", "frames",
"data" }`, `data` los 7 `f32` por fotograma en base64 *little endian*) y su
ancla (`anchor`: `{ "position", "rotation" }`). Todo es JSON del estado; no
hay bloque nuevo. Al abrir, la sección se queda con lo que esta versión
conoce (un papel desconocido o un número fuera de rango se quita), un clip
`PHYSICS` cuya pista no se decodifica se quita, y un ancla dañada también
(el clip reproduce entonces sus fotogramas tal cual). Un proyecto de antes
de S2 abre igual (`tests/fixtures/project-v2.json`). El esquema sigue en 2.
Al abrir, el Doctor se vuelve a pasar sobre el estado leído (también en
`migrateProject`), no solo en `loadProject`.

**Grafos de material** (M3a). Un material en modo *Nodos* lleva `graph`
(`{ "version": 1, "nodes": [...], "links": [...] }`, §5.2 quater); uno en
modo *Simple* no tiene la clave (como antes de M3a). Al abrir se lee con
`normalizeGraph`: nodos de tipos que esta versión no conoce y sus
conexiones se quitan, una sola salida (se añade si falta), conexiones que
encajan (tipos que convierten, una por entrada, sin ciclos), valores
dentro de su rango; un grafo de una versión más nueva se quita y el
material abre como *Simple*, con sus parámetros. Las imágenes de sus nodos
de imagen van en el bloque `images` con las de las texturas, y una que
falta deja su nodo sin imagen. Un grafo guardado y abierto es el mismo
grafo y se guarda otra vez en el mismo texto (test). El esquema sigue en
2.
---

## 9 · Plugins (P6)

Un plugin es una herramienta de otro programa que trabaja dentro de
Repackshot: el anfitrión le da píxeles y recibe píxeles. Lo instala el
usuario (*Ajustes ▸ Plugins*), con su licencia, y nunca toca el DOM ni el
*store* (§1: no es una dependencia).

### 9.1 · El paquete `.rpk`

Un solo archivo (`src/plugins/rpk.ts`, compartido por la página y por las
herramientas de `tools/`, que lo leen con la eliminación de tipos de Node 22.18
o posterior y el `webcrypto` de Node):

| Bytes | Qué |
| --- | --- |
| 4 | `RPK1` |
| 4 | longitud de la cabecera, `u32` *little-endian* |
| n | **cabecera en claro**, JSON en UTF-8: `id`, `version`, `abi`, `bytes` (longitud del cifrado, etiqueta incluida), `sha256` (hexadecimal, del cifrado), `nonce` (12 bytes, base64) |
| `bytes` | **AES-256-GCM** (WebCrypto) del contenedor, con su etiqueta de 16 bytes al final |

El contenedor es plano: `RPKC`, `u32` versión 1, `u32` número de entradas y,
por entrada, `u32` longitud del nombre, el nombre (UTF-8, una ruta relativa con
`/`, sin `..` ni puntos iniciales), `u32` longitud y los bytes. En el paquete de
película: `manifest.json`, `plugin.js`, `module.wasm`, `presets/`, `logo.svg`,
`LICENCE.txt`, `NOTICES.txt` (y `recipes.json`, `engine.json`). El cifrado
autentica, como datos adicionales, la marca y todos los campos de la cabecera
menos el `sha256` (que es del propio cifrado): una cabecera editada a mano (otra
versión, otro `id`) no abre. Al abrir, primero la cabecera, la longitud y el
`sha256` del cifrado (*dañado*, sin descifrar nada); después la etiqueta GCM
(*la clave no abre este paquete, o el paquete fue alterado*); después el
contenedor. `tools/plugin-pack.mjs <carpeta> <salida.rpk> (--new-key | --key
<b64> | --key-file <archivo>)` comprueba el manifiesto (`core/plugins.ts`) y que
estén los archivos que nombra, empaqueta y cifra, e imprime el tamaño y el
`sha256` del archivo (lo que fija el registro); con `--new-key` imprime la clave
**solo por la salida estándar**. `tools/plugin-unpack.mjs` lo abre (tests, y
revisar un paquete antes de publicarlo).

**La clave y lo que el cifrado protege** (decisión 1 de P6, tal cual): la
**clave de activación** (32 bytes, base64) **no está en el repositorio** (el
anfitrión es de código disponible: no puede guardar secretos): llega por
`keyUrl` del registro (una URL del desarrollador, que puede rotarla o
condicionarla más adelante) o la teclea el usuario al instalar. El paquete se
guarda **cifrado** (IndexedDB, también en WebView2) y la clave aparte; se
descifra **solo en memoria** al cargar, nunca se escribe en claro. Lo que esto
protege: el módulo en reposo y en tránsito, y que el paquete no sirva fuera de
Repackshot sin la clave; lo que no: a quien depure el navegador con la clave en
la mano.

### 9.2 · Registro, instalación y almacén

`src/data/plugins.json` (con su cargador tipado, `src/data/plugins.ts`) es el
registro, como `ai-models.json`: por plugin `id`, `name` (es/en), `publisher`,
`version`, `summary` (es/en), `licence: { kind: 'closed', label }`, `homepage`,
`url` del paquete, su `sha256` y sus `bytes`, `keyUrl` (vacío: se pide al
instalar) y `logo` (un archivo del paquete, o un SVG en línea `data:`; el del
de película es del paquete: no está en este repositorio). Las claves se añaden,
no se renombran. La versión de prueba (`vite build --mode plugin-test`) acepta
además `?testPlugins=<base64 del JSON>`, para la comprobación de navegador; en
las demás versiones esa rama no existe.

Instalar desde el registro (`src/plugins/host.ts`): descarga → el tamaño y el
`sha256` del registro → la cabecera (su `id` y su `version` tienen que ser los
del registro; el `sha256` del cifrado, el de la cabecera) → la clave: la que ya
tiene una actualización, la de `keyUrl` o la que teclea el usuario
(`NEEDS_KEY`: *ninguna dirección*, *la dirección falló*, *esa clave no abre*,
*eso no es una clave*) → el paquete abierto en memoria y su manifiesto
comprobado → guardado. Instalar desde archivo: lo mismo desde la cabecera, con
la clave tecleada. El almacén (`src/plugins/store.ts`) es una base de IndexedDB,
`repackshot-plugins` (versión 2), con tres almacenes: `packages` (el `.rpk` tal
cual llegó, cifrado) y `keys` (su clave), escritos en una sola transacción, y
`thumbs` (las imágenes de las tarjetas de recetas, PNG, por `plugin@versión:receta`,
con un índice por plugin: lo que el plugin devolvió de su imagen base, nada del
paquete en claro); sin IndexedDB, en memoria durante la sesión, y *Ajustes* lo
dice. Quitar borra los tres.

Al usarse: el paquete se descifra en memoria, el manifiesto se comprueba otra
vez, el módulo WebAssembly se compila (`WebAssembly.compile`, nunca en síncrono
en el hilo principal) y, si el manifiesto declara `wasm.noImports: true`, se
rechaza un módulo cuyo `WebAssembly.Module.imports()` no esté vacío; `plugin.js`
se hace un Blob URL que arranca un **Worker de tipo módulo** sin DOM, y el
mensaje `init` le **transfiere** los bytes del módulo y los archivos que lista
`files`. El Blob URL se revoca en cuanto el plugin contesta `ready`. La sesión
dura hasta que el plugin se quita, se actualiza o se para (un *Aplicar*
cancelado detiene el Worker).

### 9.3 · El manifiesto

`manifest.json` (`parseManifest` en `src/core/plugins.ts`, que nombra cada
problema): `abi: 1`, `id`, `name` (es/en), `version`, `publisher`, `licence: {
kind: 'closed', label (es/en), file }`, `homepage` (https), `summary` y `notice`
(es/en; el aviso de *adelanto de una app en desarrollo*), `logo`, `slots:
['render.plugins']`, `entry: 'plugin.js'`, `wasm: { file, noImports } | null`,
`notices` (el archivo de avisos de terceros), `base?` (decisión 8: un PNG del
paquete, la imagen base de sus recetas: lo que enseña la vista previa sin
resultado y lo que llevan las tarjetas; el anfitrión la lee, no va al
*worker*), `groups: [{ id, label }]`, `controls` y `files`. Un mando: `{ key,
label (es/en), kind: 'slider' | 'select' | 'toggle', group, default, aux? }`,
con `min`, `max`, `step`, `unit?`, `minLabel?` (lo que se lee en su tope
izquierdo: allí el plugin conserva el valor de la receta) y `role?: 'seed'` en
un deslizador (decisión 9: la semilla de lo que el plugin dibuja al azar; un
deslizador de enteros de paso 1, uno por manifiesto) y `options: [{ value,
label }]` en una lista. La interfaz dibuja el bloque **solo** desde el manifiesto
(`controlGroups`); los valores se guardan en `RenderSettings.plugins[id] = {
recipe, controls, jobs? }` (deshacibles, con el proyecto; un proyecto anterior
tiene `{}`; los de un plugin que no está instalado se conservan) y se comprueban
contra el manifiesto donde el plugin corre (`controlsFor`: en su rango y su
paso, de su tipo, o el valor por defecto). `jobs: true` (decisión 9) manda por
el plugin cada imagen de un trabajo de la cola (`ui/render-queue.ts`, después
de guardar la del motor): una imagen fija con la semilla puesta (`seed0`), cada
fotograma de una animación con `frameControls`: `seed0 + fotograma`, el índice
del fotograma en la animación (su número menos uno), dando la vuelta al rango
del deslizador (`frameSeed`, regla `SEED_RULE = 'seed0+frame'`); la imagen se
guarda como `<nombre>_<plugin>.png` (JPEG para un trabajo JPEG) y la primera
queda además en el historial con `provenance.seed = { control, seed0, frame,
rule }`.

**Las tarjetas de recetas** (decisión 8, `PluginsService.thumbnails`): la
imagen base, reducida a la mitad (`THUMB_SIZE`, 160 × 100) en luz lineal, por
cada receta (y por ninguna) con los mandos por defecto; primero se entregan las
guardadas (`thumbKey(plugin, versión, receta)`) y las que faltan se hacen **de
una en una**, cada una solo cuando no hay en curso una vista previa, un
*Aplicar* ni una imagen de un trabajo (el servicio cuenta esas y las tarjetas
esperan a que no quede ninguna), y se guardan al llegar; parar a medias
conserva las hechas. Una vista previa sin resultado es la imagen base por el
plugin (`run` con `result: null`).

### 9.4 · El ABI v1

Solo mensajes (`src/plugins/abi.ts`):

| Dirección | Mensaje | Respuesta |
| --- | --- | --- |
| anfitrión → plugin | `init { abi, manifest, files, wasm }` (una vez, primero; *buffers* transferidos) | `ready { abi }` |
| anfitrión → plugin | `info { id }` | `info { id, info: { name, version, engine? } }` |
| anfitrión → plugin | `presets { id }` | `presets { id, presets: [{ id, name, category, aux?, tags? }], categories: [{ id, label }], filters? }` |
| anfitrión → plugin | `render { id, width, height, pixels, recipe, controls }` | `render { id, width, height, rgba8, info: { items } }` |
| anfitrión → plugin | `cancel { id }` | `cancelled { id }` si no había empezado |
| plugin → anfitrión | `error { id, message }` (`id` nulo: el plugin mismo) | — |

`pixels` es `{ kind: 'linear-f32-planes', data }` (3·w·h `f32`, plano rojo,
verde y azul: luz lineal del espacio de trabajo, Rec. 709, valores por encima
de 1 conservados) o `{ kind: 'rgba8', data }` (w·h·4 bytes de imagen sRGB, alfa
recto); el anfitrión manda los planos cuando el resultado es un EXR (su luz,
sin pasar por 8 bits; el alfa sale de su imagen de pantalla) y RGBA8 en otro
caso, y vuelve a poner el alfa del origen sobre la respuesta. `info.items` son
`{ key, label (es/en), value, unit? }`: el anfitrión los pinta tal cual y no
calcula ninguno (regla 10); el tiempo lo mide él alrededor del render.
`filters` (P6b) son los filtros de recetas que ofrece el plugin, `[{ id, label,
options: [{ value, label }] }]`, y `tags` los valores de cada receta para ellos
(`{ [id del filtro]: valor }`); `cleanPresets` solo deja los de filtros y valores
ofrecidos. El anfitrión los dibuja y los aplica sin saber qué son
(`activeFilters`, `presetMatches`, `filterPresets` de `src/core/plugins.ts`: se
combinan, una receta sin el *tag* de un filtro solo está en su *Todos*, la
elegida se conserva) y guarda los elegidos en `RenderSettings.plugins[id].filters`;
el deslizador del carrusel es aritmética en `ui/strip-math.ts`. Una
vista previa cancelada que llega tarde se descarta.

### 9.5 · El plugin de película (aintfilm)

`tools/plugins/build-film.mjs --aintfilm <checkout> [--out <carpeta>] [--rpk
<archivo> (--key-out <archivo> | --key-file <archivo>)]` monta la carpeta desde
un *checkout* de aintfilm (que solo lee): el módulo
(`public/engine/itsnotfilm-engine.wasm`, comprobado sin importaciones y con las
exportaciones que usa el pegamento), sus *presets* (`src/engine/presets/`)
completados con el propio lector del *checkout* (`settingsFromValue`: cada uno
con todos sus campos, como los lee su *serde*) y renombrados a ids neutros, el
logo (decisión 7, `tools/plugins/dot-grid.mjs`: `logo.svg`, un `rect` por
punto con las esquinas redondeadas al círculo del punto, en celdas cuadradas;
con `--logo <imagen>`, desde **la imagen del logo del dueño** —puntos blancos
sobre negro—, leída punto a punto: las columnas y filas de puntos por dónde hay
tinta, la tinta de cada punto su gris, los grises agrupados en los niveles que
tiene la imagen; sin `--logo`, desde las filas de la rejilla `LOGO` de su
`src/data/marks.ts` con la regla de su `DotGrid` —una rejilla con un espacio es
de dos tintas y sus `.` son puntos en la tenue `#4A4A4A`—; la imagen gana: es lo
que el usuario llama el logo), la licencia (`LICENSE` → `LICENCE.txt`) y los
avisos de terceros (`public/THIRD-PARTY-NOTICES.txt` → `NOTICES.txt`); de aquí,
el manifiesto (`tools/plugins/film/manifest.json`, con su versión y su lista de
archivos), el pegamento (`tools/plugins/film/plugin.js`) y la imagen base de las
tarjetas (`tools/plugins/film/thumb-base.png`: la escena `film-thumb` de
`rt-cli`, el frasco de perfume de `glass_bottle` junto a la lámpara de mesa de
`lamp` en su cuarto oscuro, con la lámpara encendida, 320 × 200, escrita con
`rt --write-film-thumb` y renderizada con `rt <escena> -o thumb-base.png
--samples 512 --denoise`: PNG sRGB de 8 bits, lo que escribe `rt`, que el
pegamento recibe por `inf_render_rgba` como cualquier resultado PNG).
`--key-out` no puede estar dentro de este repositorio.

**El pegamento** (nuestro): sigue la regla del ABI en C del módulo —todo
*buffer* se reserva en su memoria con `inf_alloc` y se devuelve con `inf_free`,
y **nunca se conserva una vista entre llamadas**: cada una se toma de
`memory.buffer` en el momento de usarla— y usa dos entradas:
`inf_render_rgba` (RGBA de 8 bits, sRGB) e `inf_render_linear_rgba` (los planos
lineales con un registro lateral **vacío**: versión 1, sin perfil ni máscara,
cuenta 1, sin exposición base, equilibrio de toma 1, factores 1; 4·(14 + 3·36)
bytes). Una receta es un *preset* completo; los mandos (los del editor de
recetas de aintfilm: formato del negativo, exposición y forzado, color y su
modelo, contraste, saturación, calidez, exposición de la copia, copia o
escaneo, grano —cantidad, tamaño, color, sesgo tonal, suavidad, enfoque del
escáner, respuesta a la luz, escaneo—, halación —cantidad y radio—, filtro de
difusión y grado, carácter del objetivo e intensidad, motor de grano y semilla)
apagan una etapa, eligen un formato, un filtro o un objetivo (su bloque, de su
*preset*) o **escalan un valor que la receta ya trae**; en su tope *Receta* no
mandan nada. Las renderizaciones se encolan una por tarea, así que un `cancel`
que llega antes de su turno la descarta.

**Nombres públicos** (regla D112 de aintfilm: ningún nombre de fabricante ni de
producto donde lo vea el público): una película es su id neutro en mayúsculas
(*CN-01*, la regla del catálogo hasta que el dueño elija los nombres, D113) con
su ISO; los filtros y los formatos, las palabras de D112 (*BLACK DIFFUSION 1/2*,
*INSTANT 54×86*…); los granos y los objetivos, palabras genéricas. El
*build* pasa la comprobación de marcas (`tools/plugins/brand-scan.mjs`, el
mecanismo de `scripts/check-brands.mjs` de aintfilm reescrito aquí, con la lista
de *hashes* del *checkout*, que no se copia) por la carpeta y por las cadenas de
Repackshot: lo que ve el público tiene que salir limpio o el *build* falla; las
etiquetas internas del motor (dentro del módulo y de los ajustes de los
*presets*: el tipo de un filtro, la clave de un papel, dos ids de formato) son
del *checkout* (sus M38-07 y M38-08) y se cuentan por *hash*.
