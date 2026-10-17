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

El vídeo codificado (N1) tampoco: el codificador es el del navegador
(WebCodecs, una API de la plataforma) y los contenedores WebM y MP4 los
escriben dos *muxers* propios de `src/io/` (§5.4 ter). No hay biblioteca
de *muxing* que apuntar en esta tabla.

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
    ies.ts                  perfiles fotométricos IES (L5): el lector del formato LM-63 (puerto del de `rt_core::ies`, con el mismo fichero de conformidad), la intensidad y el flujo del perfil, el foco que lo aproxima en Rápido y las curvas del gráfico polar
    view-objects.ts         luces y cámaras como objetos del visor (L4): su *gizmo* y lo que hace un arrastre, *Mirar a través* y lo que hace la navegación, los glifos y el clic que coge uno
    camera.ts               óptica, encuadre, cámaras guardadas; las proyecciones (`CAMERA_PROJECTIONS`: perspectiva, ortográfica, equirectangular, ojo de pez, K3) y las vistas *Alzado* y *Planta*
    focal.ts                el interruptor de la focal (C2): *Mantener el tamaño de lo enfocado*, por cámara (`keepFocusSize`); `camera/focal` y las ópticas de interior pasan por él: encendido, la cámara se acerca o se aleja por su eje para que el plano enfocado (el de `focus.ts`) conserve su tamaño (`dollyForFocal`), y `focalBehaviour` dice qué hace un cambio de focal (encuadre, *dolly*, bloqueada, ortográfica, panorámica)
    focus.ts                el enfoque de una cámara (F1): por distancia, por punto (anclado a su pieza) y por objeto; la distancia que pone un punto en foco con la regla del motor (`focusDistanceFor`: la profundidad, la bisagra de una inclinación), la que resuelve cada cámara en cada pose (`resolvedFocusDistance`, `focusDistanceAt`), el solucionador exacto del motor para una lente trazada (`setFocusSolver`), el paso del *store* (`syncFocus`) y el rango del deslizador
    interior-camera.ts      la cámara de interiores (K3): verticales rectas (`verticalsOf`, `renderedCamera`: la cámara nivelada con el *shift* que conserva el encuadre), altura de ojo y ópticas de interior (`camera/eyeHeight`, `camera/interiorLens`), el multiplicador de exterior (`exteriorOf`)
    panorama.ts             el mapa de las panorámicas (K3): equirectangular y ojo de pez equidistante, dirección ↔ punto de la imagen en TS y en GLSL (`PANORAMA_GLSL`), los campos del marco de salida (`panoramaFov`); el mismo mapa que `Camera::panorama_dir` del motor
    image-passes.ts         los pases del estado `image` (K3): su orden, cuáles se aplican (exposición y curva), la exposición automática determinista (`meterExposure`, `ExposureMeter`), la compensación y los presets de brillo
    optics.ts               la óptica de una cámara más allá de la lente simple (O1; se llamaba lente fina hasta O4): bokeh, inclinación y descentramiento; neutra, límites, tipos de bokeh; la pila de filtros de efecto (O3a); la lente trazada (O2); los dos modelos de lente (`lensModelOf`, `opticsWithLensModel`: cambiar no borra nada), el bokeh solo de la lente simple (`bokehApplies`) y la inclinación de cada modelo (`tiltOf`, `withTilt`, O4)
    focus-plane.ts          el plano de enfoque de una lente inclinada (O4): la regla de la bisagra del motor, la inclinación que lo pone por dos o tres puntos (`solveTilt`), su lectura como cantidad y dirección hacia la que se aleja (`recedeOf`), y lo que dibuja el visor (`focusPlaneHint`)
    traced-lens.ts          la lente trazada de una cámara (O2): la clave del catálogo y lo que la persona cambió (tratamiento, hueco variable, objetivo detrás de un adaptador, ajustes no físicos), su composición para el motor (`composeLens`) y la lectura de lo que el motor calcula (`parseLensInfo`)
    aperture.ts             registro de las imágenes de pupila (máscaras y texturas) a 256², como el de imágenes (O1)
    aspect.ts               la proporción de la imagen de una cámara (U13): preset o propia, su lectura, el tamaño que le toca; el marco del visor y el tamaño de una imagen la siguen (`syncOutputSize`, en `render.ts`)
    animation.ts            planos, movimientos, evaluación en el tiempo (invertir, repetir, suavidad: N6); N1: los tipos FADE, PAN, MATERIAL_COLOR, SUN_ARC (y PATH reservado), el pivote de un giro, el objetivo material, el cambio de plano con fundido (`shotFadeAt`)
    curve.ts                la curva de tiempo personalizada de dos asas (N1): Bézier cúbica de (0, 0) a (1, 1), Newton con bisección
    fade.ts                 el fundido a color de la pista de cámara sobre los píxeles de un fotograma (N1): en los valores de la imagen o en luz lineal
    pass-files.ts           los archivos de los pases de un render (N2): las cuatro salidas (alfa, profundidad, normales, id de pieza), `PassesOutput` (qué y en qué formato: PNG de 16 bits o EXR), las palabras de 16 bits de cada pase, los nombres de los archivos y la leyenda de los ids; `normalisePasses`
    job-studios.ts          los estudios de los trabajos dentro del proyecto (N2b): la copia de cada estudio que usa un trabajo, una por id y *hash* de su contenido (`studioHash`, `embedStudio`, `pruneEmbedded`), sus imágenes, de dónde sale el estudio de un trabajo (`resolveStudio`: la copia, la biblioteca, los guardados del proyecto) y los que se pueden añadir a la biblioteca (`studiosToAdopt`); §8
    explode.ts              el despiece configurable (N6): geometrías, niveles, orden, excepciones; lo que se mueve y cuándo
    timeline.ts             la aritmética de la línea de tiempo (N6): filas del árbol, regla, tramos de cámara, imán
    motion-hint.ts          lo que el visor dibuja de la animación elegida (N6): su objetivo y su pista
    camera-moves.ts         expande un movimiento de cámara de data/camera-moves.json en las barras de la línea de tiempo para una cámara (A6)
    doctor.ts               chequeos y arreglos sobre el modelo
    doctor-engine.ts        los chequeos del Doctor que leen el motor (D1): `rt.wasm` y workers, SIMD, denoise, transformada de vista, fireflies, salida de vídeo y presupuesto de tiempo; `EngineFacts` (lo que la página le cuenta, `setEngineFacts`, como el tope de partículas de `effects.ts`), `FrameScan` (lo que dice la acumulación) y `sameImage`; los arreglos solo tocan el proyecto
    doctor-interior.ts      el Doctor de interiores (K1): siete chequeos de `INTERIORS.md` §3.6 que no piden motor, solo con el tipo de escena *Interior*, cada uno con su arreglo (escala y unidades, abertura para el sol y el cielo, vidrio de ventana, óptica, altura de ojo, recorte cercano, normales); `runDoctor` y `fixDoctor` los llaman
    scene-type.ts           el tipo de escena (K1): `scene.type`, la acción `scene/setType`, y la memoria `scene.typeBase` de lo que cada tipo reemplazó para que volver deje el proyecto como estaba salvo lo tocado; los valores son `data/scene-types.ts`
    physics.ts              físicas (S2): la sección Físicas de un nodo, qué se simula (`physicsSpec`), las poses del simulador de vuelta a los nodos, la pista del clip PHYSICS y su ancla, las acciones `physics/*` (§5.6)
    effects.ts              los efectos de Ambiente (S4a): el efecto como dato, sus acciones `effect/*`, la región, la cuenta y el tope, los campos y los bytes de `FXAM`, los efectos de un archivo
    section.ts              la vista en sección (Q1): el plano como dato (`state.section`), sus acciones `section/*`, desde un clic y un eje o desde dos puntos, resuelto en un instante de la animación para los motores, qué piezas corta, cuáles tapa y cuáles son estudio (`partIsExempt`)
    solid.ts                qué mallas son sólidos cerrados (Q1): la misma regla que `geometry/solid.rs` del motor, para que Rápido tape las mismas piezas; y hacia qué lado mira una superficie cerrada (`solidOrientation`, K1)
    images.ts               registro de imágenes del entorno (HDRI, imagen de fondo), como el de mallas (E5), y de las texturas (M2a)
    textures.ts             texturas de imagen y etiquetas de un material (M2a): ranuras, mapeado, etiquetas, sus acciones `texture/*`, y la matemática de las proyecciones y de las etiquetas que siguen el shader y el motor
    texture-images.ts       las imágenes de textura en el registro: id por contenido, límites (M2a)
    material-graph.ts       el grafo de un material (M3a): nodos, tomas con tipo y sus conversiones, conexiones, sus acciones `graph/*`, Simple ↔ Nodos (§5.2 quater)
    material-program.ts     el compilador del grafo a un programa lineal de registros f32 y vec3, sus códigos, límites y bytes: el contrato de M3b (§5.2 quater)
    material-interp.ts      el intérprete de referencia del programa, en f32, y los puntos de la prueba cruzada con el motor (M3a; el motor da sus bits, M3b)
    material-preview.ts     las esferas de los nodos, los mapas de Rápido (`planBake`, `bakeRows`, `finishBake`) y la media que hace de parámetros (M3a; el `MATL` de un material de nodos, M3b)
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
    light-math.ts           kelvin → rgb, irradiancia, polar, ease
    rig.ts                  studioRig / setupRig normalizados; el reparto del charco de un set (L6)
    sets.ts                 los sets (L6): aplicar, sustituir y quitar su decoración (tarjetas, barrido, suelo, charco), su aspecto, Usar la cámara del set
    wear.ts                 valores por defecto del desgaste
    version.ts
  data/                     CATÁLOGOS. Solo datos y tipos (§3); primitives.json + primitives.ts: las doce formas de Añadir ▸ Primitiva (U9); physics.ts: densidades por familia de material y valores por defecto de las físicas (S2); effects.ts: los presets de Ambiente (S4a)
  render/                   MOTORES DEL LADO WEB. Dependen de core, nunca de ui
    engine.ts               la interfaz RenderEngine (§5)
    preview.ts              three.js: vista previa rasterizada mientras se mueve la cámara; `aiFrame` (X4): el fotograma del modo Rápido y sus pases
    particles.ts            las partículas de Ambiente para Rápido (S4a): `rt_particles_eval` de rt.wasm en el hilo de la página, su tinte
    camera-projection.ts    la proyección de la cámara de Rápido como función pura (K3): el *shift* en NDC y la matriz con las verticales rectas (`perspectiveProjection`)
    panorama-pass.ts        las panorámicas de Rápido (K3): la escena en las seis caras de un cubo (medio flotante, lineal) y el lienzo dibujado desde él con `PANORAMA_GLSL`
    section-preview.ts      la vista en sección en Rápido (Q1): el plano compartido por los materiales del modelo, las tapas, el estudio sin plano, la selección y el cardán sin lo quitado
    fade-preview.ts         los fundidos y colores de material de la animación en Rápido (N1): el material compartido puesto como lo deja el clip, una copia translúcida por pieza que se funde
    texture-shader.ts       el shader de texturas de Rápido (M2a): GLSL puesto en el MeshPhysicalMaterial de three con `onBeforeCompile`, montado sin GPU
    texture-preview.ts      las texturas y etiquetas en Rápido: el shader en cada material y la caché de texturas por imagen, con mipmaps (M2a)
    lens-filter-image.ts    los filtros de efecto de la lente en imagen (O3a): los núcleos en píxeles y su convolución en TS, la referencia del pase WebGL
    lens-filter-pass.ts     el pase WebGL de esos núcleos en el modo Rápido (objetivo lineal de medio flotante, gaussianas a tamaño reducido, rayas a media resolución; cada parte con su color); con una lente trazada, su distorsión y su viñeteo (O2)
    lens-info.ts            lo que el motor calcula de una lente trazada (O2): `rt_scene_lens_info` de rt.wasm en el hilo de la página
    focus-pick.ts           enfocar con clic con el motor (F1): `rt_scene_pick` (el rayo principal de un píxel de la vista) y `rt_scene_focus_at` (la distancia que pone un punto en foco; la de una lente trazada, de sus rayos) de rt.wasm en el hilo de la página, con detección de las exportaciones; el solucionador de `core/focus.ts`
    lens-profile.ts         la tabla del visor Rápido de una lente trazada (O2): la escala de imagen, la distorsión y la iluminación relativa del motor; y el mapa de la pantalla a la imagen sin distorsionar, una vez en TypeScript y en GLSL con los mismos números: lo dibujan el pase de pantalla, el contorno y los superpuestos, y lo invierten el pico, el gizmo, los glifos y la selección por caja
    graph-preview.ts        los materiales de nodos en Rápido: sus mapas por las ranuras de M2a, en dos pasadas (M3a)
    graph-client.ts  graph-worker.ts  graph-protocol.ts  los workers de los grafos: las esferas del editor y las bandas de los mapas (M3a)
    preview-passes.ts       los pases de AI-POST.md §7.4 dibujados con three.js (albedo, normal, profundidad, ids exactos, coc) para la vista previa de la IA (X4); el suelo, con los rayos centrales del motor (X3c)
    pathtracer.ts           RenderEngine sobre un pool de workers que ejecutan rt.wasm (E4)
    frame-scan.ts           lo que el Doctor lee de la acumulación del visor Completo (D1): fireflies (píxeles brillantes, aislados y de una sola muestra) y el histograma del encuadre por paradas; `status().scan` en los dos motores, con `ScanCache`
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
    project.ts (.repack)  library.ts (biblioteca propia, JSON)  image.ts (PNG/JPEG/EXR/TIFF/DNG)
    zip.ts                  el escritor de ZIP propio (N2): método *store*, CRC-32, nombres UTF-8, sin dependencias; `zipStore` y `uniqueNames` (§5.4 quater)
    passes.ts               los archivos de los pases (N2): de los planos del motor a PNG de 16 bits (`encodePngWords`) o EXR (`encodeExrPlanes`), uno por pase, y la leyenda de los ids (§5.4 quater)
    video.ts                el vídeo codificado (N1): WebCodecs preguntado en tiempo de ejecución, el escritor de un vídeo fotograma a fotograma (§5.4 ter); webm.ts y mp4.ts, los *muxers* propios; video-track.ts, sus tipos
    rsb.ts                  escritor del formato de escena binario del motor (§5.2); `materialOrder`, el orden de materiales que numeran los pases (X3c); los programas de los materiales de nodos (`PROG`, M3b)
    phys.ts                 escritor de PHY1, la escena del simulador (S2, §5.6)
    ai-runtime.ts           el motor de ejecución de la IA del lanzador (X3b); ai-post.ts, la tubería de escritorio (`DesktopAiService`, X3c)
    hdri.ts                 lectores propios de RGBE y OpenEXR, imagen de fondo, copia para la vista previa (E5)
    gltf-materials.ts       los materiales y las imágenes de un glTF leídos de su JSON (M2a)
    mtl.ts  obj-materials.ts  las bibliotecas .mtl de un OBJ y sus imágenes (M2a)
    texture-notes.ts        lo que la hoja dice de las texturas de un archivo (M2a)
    texture-pixels.ts       los píxeles de las texturas para la sección IMGS del RSB (M2a); main.ts los decodifica antes de escribir la escena para un motor que las lee (M2b)
    aperture.ts             lee las imágenes de pupila de public/assets/aperture (PNG gris propio, sin canvas) y las promedia a 256² (O1)
  ui/                       INTERFAZ. Habla con core a través del store (§6)
    strings.ts              todas las cadenas, en es y en
    ports.ts                los servicios que main.ts le entrega (visor, importadores…), sin importar render ni io (§6)
    doctor-facts.ts         lo que sabe el Doctor del motor (D1): `engineFactsFrom` (estado de la interfaz y `status()` del visor a `EngineFacts`) e `installDoctorFacts`, que se lo entrega cuando cambia (`doctor/refresh`, también tras deshacer y rehacer)
    section-commands.ts     los comandos de la vista en sección (Q1): encender, cambiar de lado, armar el siguiente clic del visor y lo que hace
    lens-commands.ts        los comandos del modelo de lente, el bokeh y la inclinación (O4): `setLensModel`, `applyBokeh` (por donde pasa todo bokeh: con una lente trazada avisa y no toca la cámara), el plano por dos puntos (`armTiltPick`, `finishTiltPick`: una entrada de deshacer) y el texto de su aviso
    lens-peek.ts            lo que decide la ventana de una lente (O2b), sin DOM: a qué cámara se pregunta al motor y la caché de respuestas por lente y por lo que los números dependen de (`lensPeekCache`, una por puerto), cuándo se abre y se cierra (`createPeekController`, 300 ms de reposo) y lo que dice cada tarjeta (`peekCard`: nada que el motor no haya dicho, regla 10)
    theme.css  layout.css  components.css  …
    components/             NumberField, Section, Grid, Palette, …
      material-drag.ts      arrastrar un material con eventos de puntero: fantasma, zonas de suelta, Esc (U7)
      lens-section.ts       el corte en SVG de una lente trazada y las curvas de su perfil, desde lo que preparó el motor (O2; solo importa tipos: tools/lens-sheet.mjs lo usa también)
      lens-peek.ts          la ventana de los elementos de una lente al dejar el puntero o el foco sobre ella en Cámara ▸ Lente (O2b): el DOM de la ventana (sin tomar foco ni puntero) y su colocación; la lógica sin DOM, en `ui/lens-peek.ts`
      pick-menu.ts          una lista dibujada por la interfaz (botón como un `select` y el menú de widgets.ts), cuyas entradas la página puede ver bajo el puntero y con el foco: la de lentes de O2b
    panels/                 header, scene, viewport, inspector, renderbar, status
      viewport-box.ts       el gesto de la caja de selección sobre el visor (U7)
      add-menu.ts           Añadir ▸ Primitiva: las mismas entradas en la cabecera, el + de Escena y el menú del visor en vacío (U9)
      scale-panel.ts        clic derecho ▸ Escalar…: el panel en línea (uniforme, por eje, a medida, restablecer) (U9)
      insp-lens.ts          Cámara ▸ Bokeh (miniaturas del motor) y Óptica avanzada (O1), solo con la lente simple (O4)
      insp-tilt.ts          el bloque Inclinación y desplazamiento (O4), el mismo en Óptica avanzada y en Más opciones: cantidad, dial y atajos de la dirección, Por dos puntos…, Ver el plano, desplazamiento
      insp-filters.ts       Cámara ▸ Filtros: la pila de filtros de efecto de la lente (O3a)
      insp-traced.ts        Cámara ▸ Lente (O2): lente simple o trazada, carácter, lente, fuente, objetivo detrás, tratamiento, hueco variable, láminas; los números, las curvas y el corte del motor; Más opciones (O4: la inclinación y el desplazamiento, el resto del diafragma, lo no físico); Guardar lente como…
      insp-textures.ts      inspector ▸ Texturas: ranuras, mapeado y etiquetas (M2a)
      insp-ambient.ts       inspector ▸ Escena ▸ Ambiente: lista, galería de tarjetas, ocho mandos y Avanzado (S4a)
      insp-section.ts       inspector ▸ Escena ▸ Sección: interruptor, eje, dos modos de clic, punto y normal, cambiar de lado, tapar (Q1)
      material-editor.ts    la ventana Editor de material: barra, panel del nodo, teclas, sitio y tamaño recordados (M3a, UI.md §2.10)
      graph-canvas.ts       el lienzo del editor: tarjetas, tomas por forma, conexiones, zoom y desplazamiento (M3a)
      viewport-labels.ts    la herramienta de etiqueta del visor: colocar con pulsación y arrastre, Mover etiqueta (M2a)
      animation.ts          el cajón de animación (N6): transporte y las tres zonas; anim-tree.ts (qué se anima), anim-timeline.ts (regla, barras, imán, pista de cámara con sus fundidos), anim-props.ts (propiedades, el asistente en tres pasos, las de un plano, presets); components/curve-editor.ts, la curva de dos asas (N1)
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
  k3-check.mjs              comprobación en el navegador de la cámara de interiores (K3) sobre la habitación de prueba (tests/fixtures/k3-room.repack.json): verticales rectas, planta con el techo oculto a cámara y la exposición automática medida, panorámica 2:1 y altura de ojo, cromo acromático; docs/ui/k3-verticals.png, k3-plan.png, k3-panorama.png (y sus -fast) y out/k3-check.json
  scene-type-check.mjs      comprobación en el navegador del tipo de escena (K1): el control, que no cambian los controles, las siete recetas de Interior, las siete filas del Doctor, ida y vuelta, en inglés y en español; docs/ui/scene-type-interior.png
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
                            partículas de Ambiente: esferas, discos y cápsulas con su BVH y su rejilla de pantalla (geometry/particles.rs, S4a, S4b); el lóbulo hacia delante (bsdf/forward.rs, S4b);
                            la vista en sección: el plano dentro de `Geometry`, rayos recortados a lo que queda, tapas de los sólidos cerrados y estudio sin cortar (geometry/section.rs y solid.rs, Q1);
                            texturas de imagen y etiquetas del sombreado (texture/: imagen y mipmaps, proyecciones,
                            ranuras y etiquetas en el punto, M2b);
                            los programas de los materiales de nodos (program.rs y program/: lectura y comprobación,
                            intérprete, ruido de M3a, el punto y el material del impacto, M3b)
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

Las claves (`GOLD`, `REMBRANDT`, `JEWELLERY`…) son **estables**: la
documentación, las miniaturas y los proyectos guardados las referencian.
Añadir entradas es libre; renombrar o borrar es un ítem de roadmap con
migración.

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
  montajes del catálogo base no tienen nada): `backdrop` (`SetBackdrop`: `FLAT`,
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
- **Herramientas de estudio (A6)** (`docs/STUDIO-TOOLS.md`): `lenses.json`
  (las 16 prescripciones de lente, con su cargador tipado en `lenses.ts`), `bokeh.json` (los 20 tipos) y
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
que cambiar de montaje no cambia la exposición. Es lo que permite
recorrer 72 montajes sin tocar la exposición, y la suite
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
- El estado es serializable tal cual a `.repack` (sin instancias de
  clase, sin referencias circulares, sin `Map`). `io/project.ts` lo guarda
  y lo carga con una versión de esquema y migraciones.
- Las acciones de deshacer no incluyen `meta.lang`, `meta.theme`, el
  plegado de paneles ni el `playhead`: son estado de interfaz.
- **El Doctor** (`doctor.results`) se vuelve a pasar en cada acción que
  cambia lo que mira: las partes de la escena de sus chequeos de escena y,
  desde D1, lo que leen los chequeos del motor (`engineInputsChanged`,
  `core/doctor-engine.ts`: los ajustes de imagen, los de motor, el
  presupuesto y la salida de animación del `render`, y todo lo que da otra
  imagen al visor Completo). Lo que el motor y el sistema dicen no es
  proyecto: la página lo entrega como `EngineFacts` (`setEngineFacts`,
  `ui/doctor-facts.ts`) y pide `doctor/refresh`, volátil (sin entrada de
  deshacer ni cambio de `meta.dirty`) y sin efecto si los resultados son los
  mismos; tras deshacer y rehacer lo pide el propio *store* a través de
  `installDoctorFacts`, porque el estado vuelve con los hallazgos con que se
  guardó. Una acción que un oyente envía mientras se le avisa de un
  deshacer, rehacer, reinicio o cierre de transacción se aplica en cuanto
  acaba el aviso (antes esperaba al siguiente `dispatch`).

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
  segundo, el tiempo por fotograma y si está renderizando. Desde D1,
  también `scan` (`FrameScan`, `core/doctor-engine.ts`): lo que el Doctor
  lee de la acumulación a resolución completa cuando todos los píxeles
  llevan al menos 16 muestras (`SCAN_MIN_SAMPLES`) y cada vez que esas
  muestras se doblan: cuántos píxeles son *fireflies*, el histograma del
  encuadre por paradas (17 casillas, de 2⁻⁸ a 2⁸, del canal más brillante)
  y el proyecto del que sale (`basis`). Es el mismo objeto hasta la
  siguiente lectura, y no hay `scan` en *Rápido*, durante un gesto ni
  antes de la muestra 16. Los workers dicen en su primer mensaje si su
  `rt.wasm` exporta el denoiser (`denoise` en `ready`; `Pool.hasDenoiser`,
  `PathTracerEngine.canDenoise`), que la interfaz guarda en
  `EngineInfo.denoise`.

### 5.1 · El motor: Rust, desde cero, sin dependencias

Vive en `engine/`, un workspace de Cargo con ocho *crates*:

| Crate | Qué es | Reglas |
| --- | --- | --- |
| `rt-core` | **El trazador.** Biblioteca: matemáticas, SIMD, BVH, intersección, aristas vivas y bisel del sombreado, texturas de imagen y etiquetas (M2b, `texture`), programas de material (M3b, `program`), BSDF, luces, entorno, muestreo, integrador, lector y escritor RSB, codificador PNG, película y tonemapping | Solo `core`/`alloc`/`std` sin APIs del sistema (nada de `fs`, `net`, `time`, `thread`); `#![deny(unsafe_code)]` salvo el módulo `simd`; `#![deny(missing_docs)]`; `f32` en todo; sin `unwrap` en rutas que dependan de la entrada; compila para `wasm32-unknown-unknown` |
| `rt-sim` | **El simulador de partículas sin estado** (S0 §1–2, S4a): `AmbientParams` (lee y escribe la carga de `FXAM`), `evaluate(&params, max)` y `Evaluator::particle(id)`: cada partícula es función pura de (semilla, id, instante), en forma cerrada; fase propia (régimen estacionario: la región llena desde el primer instante), velocidad `v(a) = v_d + (v₀ − v_d)·e^{−a/τ}` integrada, deriva de *curl noise* como desplazamiento sin divergencia (Bridson, Houriham y Nordenstam, *Curl-noise for procedural fluid flow*, SIGGRAPH 2007), muerte en el suelo y renacimiento arriba (las que caen o suben nacen en su cara y viven lo que tardan en cruzar la caja; las que flotan viven siempre y la caja se envuelve), envolvente de nube por rechazo. La exponencial y el seno, tabulados con `fmath` una vez por efecto: nada de `exp`/`sin` por partícula | Las reglas de `rt-core`: solo `std` sin APIs del sistema, `#![forbid(unsafe_code)]`, `f32`, hash contador `mix64((seed << 32) ^ id)`. Comparte `fmath.rs` y `rng.rs` de `rt-core` compilándolos por `#[path]` (un test de `rt-core` comprueba que dan lo mismo): `rt-core` depende de `rt-sim`, no al revés |
| `rt-cli` | Binario nativo `rt`: lee un `.rsb`, renderiza con hilos (`std::thread::scope`, cola de baldosas atómica), escribe PNG, mide rayos/s; hojas de contacto y miniaturas en CI | Puede usar `std` entero |
| `rt-wasm` | `cdylib` con exportaciones `extern "C"` escritas a mano (`rt_alloc`, `rt_free`, `rt_scene_load`, `rt_render_tile`, `rt_render_tile_passes`, `rt_render_tile_albedo`, `rt_render_tile_alpha` (N2), `rt_scene_caustics`, `rt_denoise`, `rt_particles_eval` (S4a: las partículas de un `FXAM`, 8 `f32` cada una, para Rápido), `rt_scene_pick` y `rt_scene_focus_at` (F1: el rayo principal de un punto de la imagen, lo que toca y la distancia que lo enfoca; la página las detecta por su nombre, sin bit de `rt_features`), `rt_version`, `rt_features` (M2b: lo que lee además del RSB de siempre; bit 0, las texturas; bit 1, los programas de material, M3b; bit 2, la vista en sección, Q1; bit 3, las luces IES, L5)…) y las del simulador (`phys_new`, `phys_step`, `phys_poses`, `phys_awake`, `phys_settled`, `phys_hash`…, S2). Sin `wasm-bindgen`; enlaza `rt-post` solo por su *denoise* (E5b-1), `rt-sim` (S4a) y `rt-phys` (S2) | El único `unsafe` fuera de `simd`: la reserva de memoria lineal, comentada bloque a bloque |
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

- **`SECT`** (Q1, a lo sumo una, 20 B; un motor anterior la salta y muestra
  la pieza entera): el plano de la vista en sección, `u32 flags` (bit 0:
  tapar el corte; los demás se ignoran), `f32 normal[3]` (hacia el lado que
  **se quita**; se normaliza salvo que ya sea unitaria dentro del redondeo,
  y cero o no finita es archivo inválido) y `f32 distance` (mm, el plano es
  `normal · p = distance` y lo que queda es `<=`). Va después de las luces y
  de las `FXAM` y antes de `IMGS`, `BMAP` y `ENVR`; sin plano no se escribe
  (los bytes de antes de Q1), una actualización sin `MESH` lo trae o lo
  quita, y dos `SECT` son error. `INST.flags` gana el bit 1
  (`INSTANCE_NO_SECTION`): el plano no corta ni tapa esa instancia (el
  estudio, §5.2 terdecies). `rt_features` y `/api/info` suben el bit 2
  (valor 4, `FEATURE_SECTION`). Reglas en §5.2 terdecies.
- **`CAMR`** (K3; 60 B como siempre, 76 B con lo de K3): detrás de
  `ortho_width`, `u32 projection` (0 la de siempre, la estenopeica, la
  lente simple o la ortográfica según `ortho`; 1 equirectangular; 2 ojo de
  pez equidistante; ≥ 3 es error), `f32 fov_x_deg` (360), `f32 fov_y_deg`
  (180) y `f32 exterior` (1). Solo se escriben si alguno no es el de por
  defecto, así que los archivos de antes conservan sus bytes y sus
  *hashes*. `INST.flags` gana el bit 2 (`INSTANCE_NO_CAMERA`, valor 4,
  junto al 1 de `INSTANCE_NO_SECTION`): la cámara no ve esa instancia y el
  resto de los rayos sí. `rt_features` y `/api/info` suben el bit 4 (valor
  16, `FEATURE_CAMERAS`). Reglas en §5.2 quindecies.
- **`PATN`** (E6, nueva, repetible, 108 B): el dibujo procedural de un
  material (`u32 material kind; f32 color_a[3] color_b[3] scale_mm
  params[16]; u32 variant seed`, §5.2 octies). `kind` 1 madera, 2 tela; un
  tipo desconocido no dibuja nada; un `material` que no existe es error.
- **`MATL`** (100 B desde E9; los de 56, 60, 72 y 76 B se leen con los valores
  por defecto de lo que les falta): `kind` 0 principal (Lambert + GGX con
  barniz; la parte `transmission` es vidrio claro: reflexión y refracción
  GGX con el Fresnel dieléctrico exacto), 1 vidrio (el principal sin
  metal), 2 emisivo (radiancia `emission × emission_power`); desconocido =
  0. `flags` bit 0: el emisor se muestrea también como luz (por su flujo);
  bit 1: pared fina (sin interior: la luz y los rayos de sombra pasan
  rectos). E5 añade `opacity` (1; por debajo, recorte estocástico),
  `anisotropy` (0) y `absorption_mm` (0; por encima, Beer–Lambert dentro
  del sólido: `base_color` es lo que conserva la luz blanca tras esos
  milímetros). E6 añade `bevel_mm` (byte 72; 0; por encima, el radio del
  bisel de aristas del sombreado, §5.2 septies; los emisores lo ignoran).
  E9 añade, detrás, en este orden: `scatter_mm` (0; por encima, el sólido
  claro está lleno de un medio dispersor con esa distancia libre media,
  §5.2 sexies), `scatter_color` (tres `f32`, el albedo de dispersión simple
  por canal; 1, 1, 1), `scatter_g` (0; la anisotropía de
  Henyey–Greenstein, recortada a ±0,9) y `abbe` (0; el número de Abbe del
  vidrio macizo sin medio: por encima de 0, dispersión cromática,
  §5.2 sexies).
- **`LGHT`** `kind`: 0 rectángulo, 1 disco, 2 sol, 3 punto, 4 foco
  (L4) y 5 IES (L5, §5.2 quaterdecies); ≥ 6 es error. Rectángulo y disco:
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
  trazan sus rayos de sombra (un fichero anterior nunca lo pone). IES (L5):
  el punto de `power` W y diámetro `size_x` cuya intensidad sigue el perfil
  de la sección `IESP` que nombra el `u32` que viene tras `flags` (el `LGHT`
  de un IES mide 80 B; los demás, 76 como siempre).
- **`IESP`** (L5, nueva, repetible): `u32 byte_len`, los bytes de un archivo
  IES LM-63 como texto y relleno a 4. Cada perfil distinto va una vez, tras
  los `LGHT`, en el orden del primer uso; el motor lee el texto con
  `rt_core::ies` (un archivo que no lee hace inválido el RSB, con el motivo).
  Una sección `IESP` que ninguna luz nombra se lee sin quejas, y un motor
  anterior a L5 la salta (y rechaza el `kind` 5: por eso existe
  `FEATURE_IES`). Sin luces IES, los bytes son los de antes de L5.
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
  *Texturas en el RSB* al final de este apartado y §5.2 decies.
- **Programas de material** (`PROG`, M3b): ver *Programas de material en el
  RSB* al final de este apartado y §5.2 undecies.
- **`FLOR`** (20 B, una como máximo): `mode` 0 ninguno, 1 plano
  lambertiano infinito, 2 atrapasombras; `z`; `color[3]`.
- **`RNDR`** (52 B desde E5b-1; los de 28, 36 y 40 B se leen con los valores
  por defecto de lo que les falta): además `max_depth` (0 = 8, tope 1024),
  `clamp_indirect` (0 = desactivado) y, desde X2, `passes`: la **máscara
  de pases** exactos que se escriben junto a la imagen, bit *i* =
  `PASS_KEYS[i]` de `src/core/passes.ts` (1 albedo, 2 normal, 4
  profundidad, 8 id de pieza, 16 id de material, 32 círculo de
  confusión y, desde N2, 64 alfa). 0, o un RSB anterior a X2, no pide ninguno; los bits que el
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
  1, una; más de 16, RSB no válido); sin ellos, la imagen de antes. Desde
  E10 (72 B, **solo cuando se pide**: sin ellos la sección es la de E11 byte a
  byte), al final, `adaptive` (u32; bit 0, el anfitrión muestrea
  adaptativamente, §5.2 duodecies; los bits desconocidos se conservan y se
  ignoran) y `noise_threshold` (f32 en `0..=1`, el error relativo de la media
  por debajo del cual un bloque ya no recibe muestras; 0, ninguno; fuera de
  rango, RSB no válido); uno de 68 B se lee sin umbral.
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
  filtros. **F1** puede añadir tras la prescripción de O2 un `f32
  frame_sensor_mm`: el sensor del cuadro de salida cuando el de `CAMR`
  abarca más (la imagen del visor), del que la lente trazada saca lo que es
  de la esquina del cuadro (§5.2 septendecies); sin él, el de `CAMR`. Un valor fuera de rango hace inválido el fichero. Un RSB sin
  `LENS` es la lente simple de siempre, bit a bit (los *hash* del ejemplo,
  E5, E5c, E5b-1 y los pases no se movieron); una `LENS` neutra también.
  La interfaz la escribe solo para una cámara con óptica no neutra
  (`src/io/rsb.ts` `lensToRsb`): las imágenes de `public/assets/aperture/`
  promediadas 2 × 2 a 256 × 256 (`src/core/aperture.ts`, leídas sin
  *canvas* por `src/io/aperture.ts`), máscara por textura en una sola
  imagen, y `field_mm` = media diagonal del encuadre de salida en el
  sensor de 36 mm, sea cual sea la parte del visor que cubra la imagen.
  **O2** añade, tras los huecos de los filtros (que entonces se escriben
  siempre, vacíos si no hay filtros), la **prescripción** de una lente
  trazada: `u32 surface_count` (0: la lente simple de O1; hasta 64), y con
  superficies `u32 stop focus_mode` (0 unidad, 1 interno, 2 flotante,
  3 anamórfico: el adaptador delante de su objetivo, que enfoca como una
  unidad mientras el hueco listado del adaptador lleva el meridiano
  comprimido al mismo foco), `f32 f_number_min magnification_base
  magnification_near distortion vignetting spherical breathing` (los
  ajustes no físicos, 0 apagados; −1 a 1, el viñeteo 0 a 1), `u32
  moving_count` (hasta 8) y `(u32 surface; f32 base near)` por hueco
  móvil, y por superficie, del lado del objeto primero, `u32 kind` (0
  esfera, 1 plano, 2 asférica par, 3 cilindro de eje x, 4 de eje y, 5
  espejo), `f32 radius thickness nd vd semi_aperture` (radio 0: plano;
  espesor negativo tras un espejo; semiapertura 0: la deriva el motor),
  `u32 coating` (0 no aire–vidrio, 1 sin tratar, 2 monocapa, 3 multicapa)
  y `f32 conic a4 a6 a8 a10`. El motor la escala a `CAMR.focal_mm`, la
  enfoca a `CAMR.focus_dist` y la prepara al leer la escena (§5.2 nonies).
  La interfaz la escribe desde el catálogo (`composeLens` y
  `prescriptionToRsb`): los bytes son los de `rt` para las 16 lentes
  (`tests/fixtures/lens-catalogue.json`, `rt --write-lens-catalogue`).
- **`FXAM`** (S4a, repetible: una por efecto de *Ambiente*; un motor
  anterior la salta como sección desconocida). Los **parámetros** del
  efecto, no sus partículas: 200 B (192 en S4a; los primeros 128 son obligatorios; una
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
  | 192 | `f32` | `forward` | S4b: parte de lo que dispersa la partícula que va al lóbulo hacia delante, 0..1 (0: ninguno; una carga de 192 B no lo tiene) |
  | 196 | `f32` | `forward_g` | su asimetría de Henyey–Greenstein, −1 < g < 1 |

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

  **S4b.** (1) *Rejilla de pantalla*: con una cámara en perspectiva cada
  conjunto guarda una rejilla de celdas de 4 px sobre la imagen con, por
  celda, las partículas cuya caja (ensanchada como la ven los rayos de
  cámara, y en trozos a lo largo de su eje si es una cápsula larga)
  proyecta en ella; un rayo de cámara que sale del centro (estenopeica) o
  del disco de la apertura (lente simple: el rectángulo de cada partícula
  crece con el círculo de confusión `R |1/z − 1/z_f|` en su peor
  profundidad y el rayo busca la celda de su punto en el plano de foco)
  prueba las de su celda en lugar de recorrer la BVH: el mismo impacto
  más cercano, bit a bit (test frente a la fuerza bruta). Una celda de
  más de 128 partículas (`GRID_MAX_CANDIDATES`) manda su rayo a la BVH,
  que para en el impacto más cercano. Los demás rayos siguen con la BVH. (2) *Gotas sin cáusticas*: una partícula de material
  claro (`(1 − metálico)·transmisión ≥ ½`: lluvia, burbujas) la cruzan
  recta, entera, desde más allá de su cara del fondo y con la transmitancia
  recta de una pared fina de su material, los rayos de sombra (si proyecta
  sombra) y los de un camino que ya rebotó en un lóbulo ancho
  (`RayClass::Rough`: densidad < 100 sr⁻¹; entonces solo la ven si
  proyecta sombra); la cámara y los caminos de lóbulos estrechos desde ella
  (espejo, vidrio liso) la siguen viendo refractar. En una partícula clara
  y lisa la estimación de siguiente evento solo busca luces delta; las
  demás las encuentra su rayo BSDF, que cuenta lo que encuentra entero
  (densidad infinita en el MIS). (3) *Lóbulo hacia delante*
  (`bsdf::forward`): con `forward > 0` y un material opaco, el BSDF de la
  partícula es `(1 − forward)·superficie + forward·albedo·p_HG(−wi·wo)/|cos θi|`
  (Henyey y Greenstein, ApJ 1941), muestreado con probabilidad `forward` y
  con la densidad de la mezcla en el MIS de E12; sus rayos que atraviesan
  la partícula (y sus rayos de sombra) salen de su cara del fondo.
- El escritor de `rt-core` emite siempre `FLOR` y los campos nuevos; el
  escritor TypeScript de E4 hace lo mismo. `rt-core`
tiene lector y escritor; `src/io/rsb.ts` tiene el escritor en
TypeScript, y un test de paridad escribe la misma escena por los dos
lados y compara los bytes. El `.repack` sigue siendo el formato de
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

**Texturas en el RSB** (contrato escrito en M2a; `rt-core` lo lee desde M2b).
El escritor TypeScript lo escribe **solo cuando la vista lo pide**
(`SceneView.textures`), y la vista lo pide cuando el motor dice que lo lee:
`rt_features()` de `rt.wasm` (bit 0, `rt_core::FEATURE_TEXTURES`; un `rt.wasm`
anterior no la exporta y vale 0) y `features` de `/api/info` del lanzador
(`render/engine.ts` `readsTextures`: el *pool* y `NativeEngine` lo ponen en las
vistas de *Completo* y de *Render*). Antes de escribir la escena, `main.ts`
decodifica las imágenes que usan los materiales (`decodeTexturePixels`, cuando
cambian los materiales y antes de cada render; si llegan píxeles nuevos, el
visor rehace su escena). Apagado, los bytes son los de antes de M2a para
cualquier escena (test: la misma escena con sus texturas y sin ellas da los
mismos bytes, y las escenas fijadas de `tests/rsb.test.ts` no cambian); encendido
sin ninguna imagen, el motor pinta los mismos píxeles que sin bloques
(`an_empty_texture_block_and_the_uv_sets_change_no_pixel`). Encendido escribe tres cosas:

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
   E9 (`f32 scatter_mm scatter_color[3] scatter_g abbe`, 100 B), que el
   escritor manda siempre, y desde el
   **byte 100** el bloque de texturas:

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
   resuelto el mapeado que usa (el suyo o el común). El lector de `rt-core`
   (M2b) lee el bloque cuando la sección sigue en el byte 100 y su versión es
   1 (otra versión es de un fichero más nuevo: se salta); un código de
   proyección, eje, juego de UV, borde o canal fuera de su rango, un
   `size_mm` que no sea positivo, una etiqueta sin tamaño o de alcance
   negativo, un bloque cortado o un índice de imagen que no esté en `IMGS`
   hacen el fichero inválido.
3. **`MESH`**: tras `material_id`, `u32 uv_sets` (0, 1 o 2) y cada juego de
   `2n` `f32`. Las posiciones de `MESH` son el espacio propio de la pieza (las
   instancias llevan su transformación), que es el de las proyecciones y las
   etiquetas. Más de dos juegos, o uno que no tenga un par por vértice, es
   error.

`IMGS` viaja con las mallas en el motor también: una actualización sin `MESH`
ni `IMGS` conserva las imágenes cargadas (y sus *mipmaps*); una con `MESH` y sin
`IMGS` se queda sin ninguna. El escritor de `rt-core` escribe lo mismo que el
TypeScript cuando la escena tiene imágenes o bloques (o `Scene::textured`, un
fichero cuyas mallas traían sus UV sin más): `IMGS` detrás de las `FXAM` y
delante de las `BMAP`, el bloque de cada material que lo tiene y las UV de
todas las mallas; `tests/fixtures/m2b.rsb` (`rt --write-m2b-example`) se lee y
se escribe en TypeScript a los mismos bytes (`tests/textures-engine.test.ts`).

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

**Programas de material en el RSB** (M3b). El escritor TypeScript los escribe
**solo cuando la vista lo pide** (`SceneView.programs`, con `textures`: un
programa lee `IMGS` y las UV), y la vista lo pide cuando el motor dice que los
corre: bit 1 de `rt_features()` y de `features` de `/api/info`
(`rt_core::FEATURE_PROGRAMS`; `render/engine.ts` `readsPrograms`, que pide
también el bit 0; el *pool* y `NativeEngine` lo ponen en las vistas de
*Completo* y de *Render*, y *Exportar escena del motor* lo lleva). Apagado, o
sin materiales de nodos, los bytes son los de antes (test). Encendido, cada
material de nodos cuyo grafo compila escribe:

- su **`MATL`** como hasta ahora: la media de cada salida sobre la esfera de
  muestras (`flattenGraph`), con la familia de su salida (vidrio si tiene
  absorción o paredes finas), y no emisor si la emisión o su intensidad no es
  una constante del programa (`emissionVaries`): lo que el motor toma del
  fichero (el tipo, la absorción, las paredes finas, el radio del bisel) y lo
  que lee un motor de antes;
- una **`PROG`** (nueva, detrás de todas las demás secciones, una por
  material): `u32 material` (el índice de su `MATL`) y los bytes de
  `encodeProgram` (§5.2 quater), con la tabla de imágenes en índices de
  `IMGS` (la imagen en el espacio de color que pide su lectura: sRGB para
  color, lineal para datos);
- las **UV** de todas las mallas y las **imágenes** de los programas en
  `IMGS`, como con las texturas.

El lector de `rt-core`: la primera `PROG` de un material cuenta; una de otra
versión del programa es de un fichero más nuevo y se salta (el material queda
con su `MATL`); un programa inválido (§5.2 undecies), que no tenga las quince
salidas de un material, de un material que no está o con una imagen que no es
de `IMGS` o no es de su espacio de color hacen el fichero inválido. Las
`PROG` viajan con los materiales en una actualización (los programas leen las
imágenes conservadas). El escritor de `rt-core` escribe lo mismo:
`tests/fixtures/m3b.rsb` (`rt --write-m3b-example`) se lee y se escribe en
TypeScript a los mismos bytes (`tests/programs-engine.test.ts`).

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

**El pase alfa** (N2): el séptimo, añadido al final como manda el contrato
(`PASS_KEYS`, bit 6; `PASS_X2` es `PASS_ALL` sin él y los *hash* de X2 son sobre
esos seis). Es la **cobertura de los objetos**: la parte de las muestras del píxel
cuyo rayo de cámara encuentra una superficie de una instancia (`coverage_of` sobre
el mismo `first_hit`: una sola traza sirve al albedo y al alfa, en
`render_tile_albedo`), sumada en orden de muestra y dividida como el albedo, cada
uno por su propia cuenta, de modo que los bordes quedan suavizados como la imagen
(con muestras de borde, E11, la media de sus submuestras). El suelo del estudio, el
entorno, el fondo, la transparencia y los paneles de luz que ve la cámara valen 0,
y los recortes y el vidrio cuentan como superficie, como en todos los pases (X2).
Por eso no es el alfa de un render con fondo transparente cuando el camino atraviesa
vidrio o el suelo es un atrapasombras con su sombra; donde solo hay objetos opacos y
fondo, **son iguales bit a bit** (lo prueba `rt-core`). Salida nueva de `rt-wasm`,
`rt_render_tile_alpha` (`w × h` coberturas por muestra), y el `RPP1` del lanzador lo
lleva el último. *Hash* fijados: `PINNED_PASS_ALPHA` (el ejemplo) y
`PINNED_E5_PASS_ALPHA`, iguales en escalar, SSE2 y AVX2, en WASI, en el
`rt_wasm.wasm` real (`tools/wasm-parity.mjs --expect-alpha`, en CI) y por la API del
lanzador. Con muestreo adaptativo (E10), como el albedo, lleva las muestras de la
primera ronda.

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
  el de la lente simple redonda y sin inclinar; la cámara ortográfica
  ignora `LENS`; el muestreo de luces, BSDF y recortes no ve nada nuevo.
- *Hash* fijado de la escena O1 (`example::o1_scene`, todas las
  perillas a la vez y una textura de anillos): `PINNED_O1_LENS_4SPP` =
  `0x087d1276` (desde la unión de E9 y E12: la compensación de energía y la selección de luz por punto mueven el hash) en cada ruta SIMD, en WASI, en el `rt_wasm.wasm` real
  (`rt --write-o1-example`, `tools/wasm-parity.mjs`, en CI) y con 1, 4 y
  16 hilos (`rt-cli/tests`).
- **Filtros de efecto** (O3a, `optics::filters`): tras la pupila, cada
  filtro de la pila (hasta tres, en orden) decide con un número si dispersa
  la muestra (probabilidad `s` del grado: `kind_s`, tablas por `GRADES`
  lineales entre grados, `GRADE_S` de las difusiones, el brillo y la red,
  `STAR_S` y `STREAK_S` propias) y, si lo hace, desvía la dirección del
  rayo `d + right·δx + up·δy` (δ en tangentes, radianes) y la pesa con
  `Filter::colour_at`: `a` en el núcleo y los destellos, `a·T` en las
  rayas y, en la difusión, por la parte de la cola en la densidad a esa
  distancia (el tinte va al halo, no a la imagen). Las PSF son radiales
  (difusión: gaussiana de `SIGMA_CORE_DEG` y cola de Cauchy 2D de
  `SIGMA_TAIL_DEG` hasta 12 anchos; suavizado: la gaussiana), de rayas
  (estrella, rayas y la cruz de la red: densidad 1/r desde
  `LINE_START_DEG` que se afila hasta 0 en su largo, `line_length_deg`:
  `STAR_LENGTH_DEG` y `NET_LENGTH_DEG` por grado, `STREAK_END_DEG` las
  rayas; grosor de `LINE_WIDTH_DEG`) o de destellos (brillo: la gaussiana, un
  halo suave de `GLIMMER_CLOUD_DEG` y una nube fija de `GLIMMER_SPARKLES`
  destellos, gaussiana 2D de
  `GLIMMER_CLOUD_DEG`, con brillos exponenciales de un *hash*, de la que
  cada muestra toma uno por su peso; en una rejilla de 64 × 64 para las
  conexiones); todas por CDF inversa tabulada (256 valores, construida al
  cargar con `fmath`), sin `exp` ni `ln` en el bucle. Los
  rayos dispersos rara vez dan con una luz pequeña, así que cada muestra
  de cámara con filtros **se conecta además a una luz** que la cámara ve
  (`Lights::camera_lights`, por su esfera envolvente; una elegida al azar
  por filtro): un lóbulo por su parte de la PSF, una desviación dentro de
  la luz con la densidad de conexión de ese lóbulo (el disco de la luz en
  el plano de desviaciones, `filters::light_disc`; para las rayas, la raya
  elegida por la probabilidad que cae dentro y la distancia por su
  densidad ahí; para el brillo, uno de los destellos cuya caja toca la luz,
  por su peso y el área de esa parte, y un punto en ella), un rayo de
  sombra y su radiancia por `s`, el color del lóbulo y la probabilidad de que los
  filtros siguientes no dispersen. La dispersión y la conexión se pesan
  una contra otra con la heurística del balance lóbulo a lóbulo
  (`Filter::mis_weight`): las luces que cruza el primer tramo del rayo de
  una muestra dispersa pesan `K / (K + p·q)` (`integrator::radiance_weighted`)
  y la conexión `s·L` por su color y ese mismo peso donde cayó. Sin luces que la
  cámara vea, no hay conexión. Los números de cada filtro salen de cuatro
  dimensiones propias más allá de la tabla de Sobol (`DIM_LENS_FILTER`,
  `4 << 20`, cuatro por filtro) y los de su conexión de seis más
  (`DIM_LENS_FILTER_LIGHT`, `5 << 20`);
  con bandas cromáticas, los del grupo de tres (una dispersión, tres
  colores). Una lente sin filtros no saca ninguno: los *hashes* de antes
  no se mueven. Escena de paridad `example::o3a_scene` (difusión negra
  1/2, estrella de 6 a 15° y rayas 1/2 sobre un diafragma de 6 láminas):
  `PINNED_O3A_FILTERS_4SPP` = `0x21e43bb1` (desde que le llegó E9a; antes `0x49938f3b`) en cada ruta SIMD, en WASI, en
  el `rt_wasm.wasm` real (`rt --write-o3a-example`, `tests/fixtures/o3a.rsb`)
  y con 1, 4 y 16 hilos. El visor Rápido aplica `(1 − s)·I + s·a·(I ⊗ K_T)`
  con los mismos núcleos proyectados por la focal (`render/lens-filter-*`;
  cada parte con su color, la nube del brillo como la gaussiana de la que
  sale), como aproximación que el medidor declara.

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
`0x2a430f92` (`PINNED_DENOISED_EXAMPLE_4SPP`, desde la unión de E9 y E12), igual con el `rt.wasm` real
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
escena de E5 con 2048 fotones por muestra, `0x7135df4b` (desde la unión de E9 y E12)
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
`Frame::version`; desde E10, de 68 con lo que el muestreo adaptativo dice de
la imagen, §5.2 duodecies) y el *long-poll* lo pide con `version=`: las sumas solo
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
| Punto, foco o IES | `lum(I) · máscara(x) / max(d², r²)` (la máscara del foco es exacta: el modelo enmascara por la dirección desde su centro; la de una luz IES es la intensidad del perfil hacia `x` sobre su pico, también exacta) |
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
motor filtrará con mipmaps (M2b), la prueba cruzada usa el nivel 0. Desde M2b
esa lectura existe en el motor, en cualquier nivel:
`rt_core::texture::image::TextureImage::bilinear` (y `sample`, trilineal, con
los *mipmaps* que calcula al leer `IMGS`; §5.2 decies).

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
motor (M3b) las usa todas menos la dispersión interna y lleva cada valor a su
rango (§5.2 undecies).

**Bytes** (`encodeProgram`, `decodeProgram`; little-endian): una cabecera de
diez u32 (`0x4D475052` «RPGM», versión 1, instrucciones, constantes,
imágenes, registros f32, registros vec3 contando los 9 del punto, salidas,
la distancia de absorción como f32, banderas: bit 0 paredes finas), las
instrucciones (seis u32 cada una), las constantes (f32), la tabla de
imágenes (tres u32: índice en `IMGS` o `0xFFFFFFFF`, 1 si sRGB, borde) y
las salidas (dos u32: tipo 0 `FC`, 1 `F`, 2 `VC`, 3 `V`; índice).
**En el RSB** (M3b): una sección `PROG` por material de nodos, con estos
bytes (*Programas de material en el RSB*, §5.2); su `MATL` lleva la **media
de cada salida** sobre 64 puntos de una esfera (`core/material-preview.ts`
`flattenGraph`), que es lo único que recibe un motor que no corre programas;
los bytes de una escena sin grafos son los de siempre. El motor los ejecuta
como dice §5.2 undecies.

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
intérprete de Rust (M3b) da los mismos, y la prueba cruzada de M3b
(`tests/material-program-cross.test.ts`, `tests/fixtures/material-programs.json`)
lo extiende a cada instrucción y a los casos especiales, bit a bit.

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
ejemplo con *Fino + bordes ×2*: `PINNED_E11_EDGES_4SPP` = `0xd01702ce` (con la elección de luz de E12 y la compensación de energía de E9a),
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

### 5.2 sexies · Materiales: energía, medios dispersores y dispersión (E9)

**Compensación de energía** (`rt_core::bsdf::energy`, tablas en
`bsdf/energy_table.rs`). El GGX de dispersión simple pierde la luz que
rebota más de una vez entre microfacetas (un metal blanco de rugosidad 1
reflejaba 0,356 en el *furnace*). El lóbulo especular (metal y dieléctrico
opaco) y el barniz llevan el lóbulo añadido de Kulla y Conty (2017),
`F_ms (1 − E(μo)) (1 − E(μi)) / (π (1 − E_avg))` con
`F_ms = F_avg² E_avg / (1 − F_avg (1 − E_avg))` y el `F_avg` de Schlick
`f0 + (f90 − f0)/21`, muestreado por el coseno y con su densidad en la
mezcla del MIS. La parte clara (Walter 2007) se divide por su propio albedo
de potencia `E_t(μo, α, η)` (Turquin 2019); con rugosidad, se muestrea
primero la microfaceta y se refleja con su propio Fresnel (Walter 2007,
§5.3). La capa difusa bajo el especular dieléctrico pesa
`(1 − E_s(μo)) (1 − E_s(μi)) / (1 − E_s,avg)` (Kulla y Conty), y bajo el
barniz, el producto de las dos transmisiones normalizado por su media
conjunta (Gauss–Legendre de 8 puntos, `energy::joint_norm`). Las tablas son
nuestras: Monte Carlo con semilla fija (VNDF de Heitz 2018, rejilla
*jittered* 64 × 64 por nodo, PCG), 32 × 32 nodos en `√μ` y `√α` (y 17
índices de refracción entrando y saliendo para la parte clara), en
fracciones de 16 bits; un test las regenera bit a bit y otro mide el error
de interpolación (< 0,5 % frente a 16 veces las muestras). Por debajo de
`α = 0,002` no hay compensación: la rugosidad 0 conserva los bits.

**Medios dispersores** (`rt_core::integrator::medium`). Un sólido claro
(transmisión, no pared fina, no metal, no emisor, `ior ≥ 1,0001`) con
`scatter_mm > 0` está lleno de un medio homogéneo: `σt = 1/scatter_mm`,
`σs = albedo σt`, `σa = (1 − albedo) σt` por canal, más la absorción de
`absorption_mm` y `base_color` si la hay. El camino que refracta dentro
hace un paseo aleatorio (Chiang, Kutz y Burley, SIGGRAPH 2016): distancias
de un canal *héroe* elegido una vez por paseo con MIS espectral sobre los
tres (Wilkie et al. 2014, cocientes renormalizados en cada paso), fase de
Henyey–Greenstein y, tras 32 eventos, ruleta rusa sobre el peso del propio
paseo (lo que ha perdido desde que entró: el camino entra con el `1/η²` de
la refracción, que la salida devuelve).
**Sin estimación del siguiente evento dentro.** Un paseo que no dispersa
cruza como el vidrio claro; uno que dispersa, al llegar a la frontera, se
refleja hacia dentro con el Fresnel de salida (reflexión total incluida) o
sale: el vértice de salida es un vértice de superficie con un lóbulo de
transmisión lambertiano de albedo `η²` (`Bsdf::medium_exit`), donde el
integrador muestrea una luz con su MIS y sigue con una dirección por el
coseno. Como máximo 1024 pasos por camino (eventos y reflexiones en la
frontera); pasado el tope, el paseo va recto a la frontera conservando todo
salvo la absorción y sale por el lóbulo. Los medios no cuentan contra
`RNDR.max_depth`. Todos sus números son dimensiones *hash* más allá de la
tabla Sobol (`sampler::medium_dim`, 8 por paso), así que una escena sin
medios no cambia ni un bit. Para el mapa de fotones un medio es receptor:
guarda fotones en su superficie y ninguno entra (`caustics::is_caster`);
el vértice de salida recoge los del exterior de su superficie.
**Paredes finas alrededor de un medio** (una **aproximación**): un rayo de
sombra desde un vértice de salida, y solo desde uno, atraviesa una pared de
vidrio liso (rugosidad ≤ 0,05, del todo clara, sin barniz ni medio propio)
donde la luz que la cruzara refractando saldría a menos de 5 mm de su
entrada por una cara a menos de 15° de la primera, como si las dos
refracciones se anularan: conserva las transmitancias de Fresnel de entrada
y de salida y la absorción de la pared en ese tramo (su tinte en cada cara
sin distancia de absorción), y sigue en su dirección desde la cara de
salida; una pared más gruesa, rugosa o con barniz lo sigue parando. En una
losa de leche bajo una placa de 3 mm queda un 2,0 % por debajo del camino
exacto. Para el MIS, una muestra de la BSDF del vértice de salida que
entra y sale de una pared así es un suceso recto de ese vértice (conserva
su densidad y su distancia), así que una luz que encuentra detrás pesa
frente a esos rayos de sombra; con cáusticas, la luz de una luz de fotones
a través de una pared es del mapa, como a través de cualquier *caster*.
Es lo que deja ver las luces a un líquido dentro de un frasco por el lado
del frasco; la solución exacta (NEE de variedades) es E13.
*Hash* fijado: la escena de E5 con un medio en su esfera de vidrio rugoso,
`PINNED_E9_MEDIA_4SPP` (`rt --write-e9-example`, `tests/fixtures/e9.rsb`),
igual en todas las rutas SIMD, en WASI, en el `rt.wasm` real y por el
código de la página. En el visor **Rápido** (`src/render/materials.ts`),
un medio es un difuso translúcido: el color con que vuelve la luz
(similitud de van de Hulst, `(1 − s)(1 − 0,139 s)/(1 + 1,17 s)` con
`s = √(1 − albedo)`) y una transmisión que baja con lo denso que es el
medio para el tamaño de la pieza; la ayuda del inspector dice que Rápido lo
aproxima.

**Dispersión cromática** (`rt_core::integrator::dispersion`, E9c). Un
sólido claro sin medio con `abbe > 0` refracta cada longitud de onda con
su índice: la ley de Cauchy de dos términos, `n(λ) = A + B/λ²`, que pasa
por `ior` en la línea d del helio (587,6 nm) y da el número de Abbe
`V = (n_d − 1)/(n_F − n_C)` (líneas F, 486,1 nm, y C, 656,3 nm, del
hidrógeno). El motor no es espectral: cada canal es una banda de
longitudes de onda (rojo 580–700, verde 490–580, azul 400–490 nm). Al
primer vidrio dispersivo que encuentra, un camino elige un canal con
probabilidad ⅓ y una longitud de onda uniforme dentro de su banda, con una
dimensión *hash* propia (`sampler::DIM_DISPERSION`, `1 << 23`), y desde
ahí lleva solo ese canal, por 3, y refracta con esa longitud de onda en
todo vidrio dispersivo; la esperanza de cada canal es la de refractar su
banda entera. Los fotones de las cáusticas hacen lo mismo con su propio
generador. Un camino que no encuentra vidrio dispersivo sigue blanco, así
que una escena sin ninguno no cambia ni un bit. El precio es ruido de color
donde hay dispersión. Los rayos de sombra no atraviesan el vidrio (E5) y la
regla de las paredes de los medios usa `ior`, sin dispersión. *Hash*
fijado: la escena de E9 lleva desde E9c una esfera de cristal de Abbe 40
(`PINNED_E9_MEDIA_4SPP`). En **Rápido**, la `dispersion` de three.js
(`KHR_materials_dispersion`: 20 / número de Abbe, hasta 2), solo en vidrio
macizo sin medio.

### 5.2 septies · Bisel de aristas en el sombreado (E6)

Las aristas de un modelo CAD son matemáticamente vivas y una arista viva no
coge luz. El bisel (`rt_core::bevel`, con las aristas en
`rt_core::geometry::edges`) redondea la **normal de sombreado** cerca de las
aristas vivas de la malla, como lo haría un redondeo de radio
`MATL.bevel_mm`, sin tocar la geometría.

**Aristas vivas** (una vez por malla, la primera vez que una instancia con
bisel las pide, y guardadas con la malla, no por instancia: sobreviven a las
actualizaciones sin `MESH` como su BVH; `Mesh::sharp_edges`). Los vértices se
sueldan por posición exacta y luego por cercanía, a menos de 10⁻⁵ del mayor
lado de la malla en cada eje (la costura de un torno, cuya última fila repite
la primera salvo el redondeo de `sin 2π`), de forma determinista: celdas de
dos tolerancias, unión de conjuntos con la raíz menor, cada grupo en la
menor de sus posiciones. Una arista soldada con **un** triángulo es de
**borde**; con **dos**, es **viva** si sus normales, orientadas de forma
coherente (dos triángulos bien enrollados recorren la arista en sentidos
contrarios; si no, se da la vuelta a una), se separan más de **20°**, salvo
que las normales de vértice de la malla coincidan a los dos lados en los dos
extremos (a 2°): la malla ya la sombrea redonda; con **tres o más** (no
variedad, caras duplicadas) se ignora. Los triángulos sin área no cuentan.

**Aceleración.** Un BVH binario propio sobre los segmentos (corte por la
mediana de los centroides en el eje más ancho, hojas de 4), consultado con
una esfera: las 8 aristas más cercanas a menos de 2 radios, visitando como
mucho 128 nodos. Cada triángulo guarda además su **holgura**, una cota
inferior de su distancia a la arista más cercana (distancia del centroide
menos su esquina más lejana): un punto lejos de toda arista cuesta una
comparación. **Coste medido** (tiempo de CPU de un hilo, mínimo de tres;
máquina compartida): la botella de ejemplo de la interfaz con su bisel por
defecto de 0,303 mm, +3,1 %; el ejemplo del motor con 0,3 mm, +0,7 %; la
escena de E6 (piezas de pocos triángulos, todos tocando aristas, biseles de
2 a 3 mm), +11 %.

**La normal.** Con `n` la normal de sombreado del punto, `n'` la de la cara
de enfrente en el punto más cercano de la arista (sus normales de vértice
interpoladas, o su plano), `θ` el ángulo entre ellas, `v` la dirección de `n'`
en el plano tangente de `n` y `d` la distancia a la arista, un redondeo de
radio `r` tangente a las dos caras empieza a `t = r tan(θ/2)` de la arista y
su normal es `normalize(r n + (t − d) v)` para `d < t`: la de la cara en `t`,
la bisectriz en la arista (la misma desde los dos lados: continua), y la
misma fórmula vale para una arista cóncava (un redondeo interior que llena la
esquina). Si la arista es más aguda que un ángulo recto, la huella se queda
en `r` y el radio baja a `r / tan(θ/2)`: la normal solo cambia a menos de `r`
de una arista, sea cual sea su ángulo. Un **borde** abierto redondea un
ángulo recto hacia fuera. **Varias aristas** (esquinas, y los segmentos de
una arista curva): cada una pide `w · v_i ≥ a_i` al desplazamiento `w` que se
suma a `r n`, y se toma el `w` más corto que cumple todas (un problema
cuadrático en 2D: como mucho dos restricciones activas; se prueban todas las
simples y los pares). Es exactamente la normal de una caja redondeada por una
esfera en una esquina en ángulo recto, y la mayor de las peticiones (no su
suma) a lo largo de una cadena de segmentos casi paralelos, así que una
arista curva no hace cuentas en sus vértices. Si no caben todas (una pared o
un borde más finos que unos dos radios), el radio baja en ese punto, por
bisección (16 pasos), al mayor que cabe: un borde fino se vuelve un medio
redondeo. La cara de un triángulo vecino cuenta como la superficie del punto
si su normal está a menos de 25° y el punto queda de su lado de la arista;
una arista al otro lado de un hueco no tuerce la normal.

**Espacio y escala.** Todo se calcula en el espacio de la malla, con el radio
dividido por la escala de la instancia `∛|det M|`. Con una escala no
uniforme el redondeo es el transformado del circular (elíptico en el mundo,
de radio medio `bevel_mm`) y el ángulo de 20° se mide en el espacio de la
malla; la normal va al mundo por la inversa traspuesta como cualquier normal.

**Sombras y reflejos.** Un redondeo de verdad queda por debajo de las caras
que sustituye, así que la luz que le llega desde un poco por debajo del
plano de una cara (desde el lado de la arista) no la tapa la esquina. Los
rayos que salen de un punto biselado (sombra y siguiente rebote) parten del
punto elevado a lo largo de la normal biselada `d · a_i / |r n + w|` (la
menor elevación desde la que toda dirección por encima del plano tangente
del redondeo libra la cara, deducida para una arista convexa; la mayor de
las aristas activas en una esquina; las demás aristas de una cadena no
cuentan), encima de la elevación del terminador (RTG II,
`Geometry::terminator_point`). La normal geométrica de la superficie pasa a
ser la del redondeo (el bisel aplicado al plano del triángulo): la prueba
del integrador «un reflejo sale por encima de la superficie» se hace contra
el redondeo. Una normal biselada que miraría hacia atrás (vistas rasantes)
se dobla hacia el observador hasta un coseno de 0,01. Las mismas normales y
el mismo punto usan los fotones de las cáusticas y el pase de normal de X2
(el guía del *denoise* sigue las franjas redondeadas); los emisores no
tienen bisel.

**Sesgo.** Una normal biselada es una normal de sombreado como las
interpoladas: la BSDF se evalúa en su marco para el muestreo de luces y para
el de la BSDF, así que el MIS pesa los dos con las mismas densidades, pero
una normal de sombreado no es recíproca ni conserva la energía exactamente
(Veach 1997, §5.3): en un horno blanco con un cubo biselado la media de la
imagen sale 0,99995 y los píxeles entre 0,988 y 1,014.

**Interfaz.** El campo *Bisel de aristas* (mm) del material llega al motor
tal cual (`materialToRsb`, todas las familias salvo el emisor); la vista
*Rápida* (three.js) no lo dibuja y la nota del campo lo dice. *Hash* fijado:
la escena de E6 a 4 muestras, `0xfccda027` (`PINNED_E6_BEVEL_4SPP`, `rt
--write-e6-example`), y sus seis pases (`PINNED_E6_PASS_*`), iguales en todas
las rutas SIMD, en WASI, en el `rt.wasm` real (también por el código de la
página, `tests/passes-engine.test.ts` con `tests/fixtures/e6.rsb`), con 1, 4
y 16 hilos en `rt` y en el lanzador. Las escenas sin bisel no cambian de bits.

### 5.2 octies · Dibujos procedurales: madera y tela (E6)

`rt_core::pattern`: la receta de un material de la familia `WOOD` como una
función del punto, con ruido propio (`pattern::noise`: ruido de gradiente
escrito desde la descripción pública de Perlin, «Improving Noise»,
SIGGRAPH 2002, con los 12 gradientes de las aristas de un cubo y la curva
`6t⁵ − 15t⁴ + 10t³`, y **nuestra** permutación, una mezcla de Fisher–Yates con
el PCG del motor y semilla fija; solo `+ − ×`, `floor` y enteros: los mismos
bits en todas partes; periodo 256, cero en la red, media −0,0012 y varianza
0,0730 fijadas por test). Un material lleva como mucho un dibujo (sección
`PATN` del RSB, 108 B, detrás de los `MATL`): sustituye su color base punto a
punto, escala un poco su rugosidad (y le suma 0,1 en un nudo), la estira a lo largo de la fibra
(anisotropía, con la tangente del marco de sombreado en la dirección de la
médula) e inclina la normal de sombreado con su relieve (un *bump*: las
diferencias finitas de su altura en el plano tangente, encima del bisel y
del terminador). La normal geométrica y el punto de salida de los rayos no
cambian. Lo usan los caminos de cámara y el pase de albedo; los fotones de
las cáusticas ven el color liso del material (la madera es receptora: el
color con que se reúne la cáustica es el del camino de cámara).

**Dónde.** En el espacio de la malla (se pega a la pieza) y en milímetros
(la escala `∛|det M|` de la instancia convierte). La médula va a lo largo
del lado más largo de la caja de la malla, a 0,8 de ese lado (como mucho
250 mm, el radio de un tronco, y al menos 0,75 del lado más corto) por
debajo del centro según el lado más corto y a 0,35 de él (en la misma
proporción) hacia el `−` del tercer eje: nunca atraviesa la pieza. Las
caras de una tabla enseñan los arcos del corte plano y sus cantos las rayas
del corte radial; una bola, arcos anidados en vez de una diana (el centro de
sus anillos queda en su cara de atrás y abajo).

**Madera** (`pattern::wood`; **decisión del líder sobre la hoja**: todo en
milímetros físicos). `ringDensity` son anillos por **100 mm** (roble 3 mm,
arce 2,5, pino 5…; `woodScale` los multiplica). Figuras (`PATN.variant`):
**0 anillos**: cilindros alrededor de la médula; dentro de cada anillo el
color sube despacio de la madera de primavera a la de verano durante el
70 % del anillo y cae en su último 5 % (diente de sierra); los dos colores
se acercan a su media `0,6 clara + 0,4 oscura` hasta que su contraste de
Michelson sobre la luminancia es el de la especie (`ringContrast`: arce,
abedul y fresno 0,15; pino, teca y cerezo 0,25; roble, nogal y caoba 0,35;
ébano 0,2), y la madera de verano ocupa de media el 40 % del anillo, así
que el color medio sigue siendo el de la vista *Rápida*. Los anillos serpean
media separación con los ruidos del catálogo (longitud de onda 25 mm),
cambian de ancho de uno a otro y se desplazan a lo largo del tronco; no
tienen relieve (viven en el color). **1 tiras** (bambú, una gramínea): tiras
paralelas de la separación de ancho, cada una con su mezcla de los dos
colores y una junta más oscura; los haces vasculares como motas oscuras a lo
largo de la tira (0,4 × 3 mm, −10 %, unas 15 por cm² en una cara a lo largo
de las tiras: una por celda de una rejilla de 0,816 × 0,816 × 4 mm, en
cualquier punto de su celda de través para que todo plano corte las mismas)
y un nodo cada 150 ± 30 mm de cada tira (una banda de 2 mm de través, −15 %,
0,02 mm en relieve). **2 moteado** (MDF): sin dibujo, un moteado fino y
homogéneo. **3 vetas** (ébano): anillos tenues bajo vetas oscuras a lo
largo de la fibra. En todas, **fibra**: ±5 % de color a 0,3 mm de través y
30 mm a lo largo, y una variación lenta del brillo (`colorNoise`). **Poros**
de `poreSize` mm de ancho y diez veces de largo, de `0,15 × poreSize ×
poreDepth` de hondo (un vaso abierto a lo largo, medio lleno de barniz: el
roble, 0,0225 mm): repartidos (porosidad difusa: nogal, caoba y teca,
medianos, y el nogal y la caoba con la mitad de hondo; arce, abedul y cerezo,
finísimos) o apretados en la banda de primavera de cada anillo, donde
dibujan líneas (porosidad en anillo: roble y fresno, 0,3 × 3 mm); la banda
entra en el primer 4 % del anillo y sale del 12 al 24 %, para que los poros
no sumen un escalón a lo largo de cada anillo. El pino, el ébano y el MDF no
tienen. Los poros oscurecen el color y hunden la superficie. La rugosidad
baja un 3 % en la madera de verano (más dibuja los anillos como crestas en
los brillos).

**Nudos** (`pattern::knots`, petición del usuario; solo la figura de
anillos). Una rama nace en la médula: en la madera es un cono a lo largo de
una línea desde la médula hacia fuera, inclinada 15–35° tronco arriba, de
radio `r (0,5 + 0,5 s / s₀)` (la mitad al nacer; `s₀` donde se colocó), y se
ve donde cruza la superficie: en las dos caras que atraviesa, algo más ancho
en la más alejada de la médula. No es una calcomanía. **Colocación**: por
`hash01` de la semilla del material (la del desgaste), dentro de la caja de
la pieza en el marco de la madera (a lo largo y a lo ancho a un radio de los
extremos, a cualquier profundidad); un candidato cuyo cono pasaría a menos
de 1 mm de otro dentro de la pieza se prueba en otro sitio (32 intentos en
total), y uno cuyo eje cortaría la superficie a menos de 45° (eje contra el
plano tangente, en cada cruce con la malla, que se busca con el BVH de la
escena; o que no la cortaría) se vuelve a sacar, hasta 8 veces, y si no, se
descarta: nunca se tocan ni rozan (una lágrima larga en una bola), y en una
pieza pequeña caben menos de los pedidos (el inspector lo dice: «6 pedidos ·
3 caben»). Un nudo descartado no se repone; más nudos dejan los primeros
donde estaban. **Alrededor**: la fibra y los anillos fluyen como un flujo
potencial alrededor de un cilindro: la coordenada de través `a` pasa a
`a (1 − R²/ρ²)` (la fibra rodea el nudo y se aprieta a sus lados) y los
anillos se abomban hacia fuera `0,35 R (R/ρ)²`, los dos desvaneciéndose de
1,5 a 3 radios.
**Dentro**: la testa del nudo, anillos alrededor de la rama a tres veces la
densidad del tronco, `knotDarkness × 35 %` más oscura, una bolsa de corteza
en el borde (0,5 mm, −50 %), un cuenco de 0,05 mm, rugosidad +0,1, y en los
de 20 mm o más una grieta radial desde el centro (una línea de 0,3 mm,
−20 %). La interfaz (`src/core/knots.ts`) coloca los mismos nudos con el
mismo *hash*, los mismos intentos y la misma prueba de incidencia (contra
los triángulos de la pieza con ese material, en f64: los mismos sitios a
milésimas de milímetro); la vista *Rápida* (`src/render/knots.ts`, una copia
del material por pieza) los oscurece, con su bolsa de corteza, sobre el
color medio; como no pinta anillos, tampoco su flujo. Con 0 nudos los bits
son los de antes.

**Coste.** Una docena de evaluaciones de ruido por punto de una pieza de
madera (dos más para el relieve de los poros); cada nudo, unos productos
escalares por evaluación.

**Tela** (`pattern::cloth`, `PATN.kind` 2; tercera parte de E6). La receta
de la familia `FABRIC` en milímetros físicos: `threadCount` son **hilos por
cm** (algodón 40, vaquero 24, raso 100, lona 14, punto 4 puntos por cm,
carbono 5 mechas por cm…; `scale_mm = 10 / threadCount`). **Dónde**: una
proyección de caja sobre los ejes de la malla (se pega a la pieza): el
plano de los dos ejes de través de la componente mayor de la normal
interpolada, mezclado con pesos `|nᵢ|⁸` donde dos componentes se parecen
(una banda estrecha, sin costura); la urdimbre va a lo largo del segundo
eje del plano (de pie en los lados, a lo largo de `y` arriba). **Tejidos**
(`PATN.variant`): 0 tafetán (cada cruce alterno), 1 sarga 2/2 (diagonales),
2 raso de cinco lizos (la trama asoma en uno de cada cinco cruces, nunca dos
juntas, ni en diagonal), 3 lona (cesta 2 × 2), 4 punto (*jersey*: cada punto
una uve de dos patas elípticas hacia abajo, inclinadas 15°, que se solapan
con las de la fila de encima y las de las columnas vecinas; cada punto, una
mezcla al azar de los dos colores, un hilo jaspeado), 5 fieltro (sin hilos: fibras apelmazadas, un `fbm` del tamaño de
`scale_mm` y los dos colores mezclados a unos milímetros), 6 sarga 3/1
(la del vaquero: la urdimbre en tres cuartos de la cara). Un hilo es redondo
de través (medio círculo, 0,86 de la separación, con un hueco entre hilos)
y a lo largo sube donde pasa por encima y baja donde pasa por debajo,
suavemente de un cruce al siguiente, con las crestas inclinadas de la
torsión de su hilo (dos por separación, 12 % de hondo por `yarnTwist`, 0 en
las mechas del carbono y los monofilamentos de la malla); la superficie es
el más alto de los dos. La rugosidad se estira **a través** del hilo de
encima (anisotropía 0,5 con la tangente de través, en la proyección que más
pesa: las normales de las fibras se abren de través, como en un metal
cepillado); el fieltro, sin hilos, no. Su altura por `weaveDepth` y media separación es el relieve (*bump*
por diferencias finitas a 0,05 separaciones, en cada proyección con su
peso); la pendiente no depende de la escala. Cada hilo varía su color ±6 %
y su rugosidad ±10 %; las crestas son más claras y los huecos más oscuros,
normalizados para que el color medio sea el de los hilos mezclados por la
parte de la cara que cubre cada uno (medida: 0,5 en casi todos, 0,72 en el
raso y 0,685 en la sarga 3/1, `WEAVE_WARP_SHARE` en la interfaz): el de la
vista *Rápida* y el que ven los fotones de las cáusticas. Hilos más finos
que un píxel (el algodón a 0,25 mm en un plano general) se promedian con
las muestras del píxel, sin filtro propio: el color converge a la media y
el relieve se vuelve rugosidad. La pelusa (`fuzz`, *sheen*) no se dibuja.

### 5.2 nonies · La lente trazada (O2, `rt_core::optics::traced`)

Con una prescripción en `LENS`, la cámara traza cada rayo desde el sensor
por las superficies reales de la lente (Kolb, Mitchell y Hanrahan 1995;
`docs/research/optics.md` §3 y §6):

- **Preparación** (`TracedLens::new`, al leer la escena y cada vez que
  cambian la focal, el diafragma, el foco o el sensor; si solo se mueve la
  cámara, se reutiliza): la prescripción escalada a la focal paraxial
  pedida, con los índices de las tres bandas (Cauchy de dos términos desde
  `nd` y `vd`; `ca_amount` multiplica la dispersión) y la transmisión de
  cada superficie aire–vidrio por su tratamiento (T-stop y tinte, sin
  fantasmas). Enfoque: *unidad* (el sensor donde cae la imagen paraxial),
  *interno* (bisección sobre los huecos móviles), *flotante* (los huecos
  siguen al aumento) y *anamórfico* (`FOCUS_ANAMORPHIC`: el objetivo como
  una unidad y el hueco más ancho del adaptador, por bisección, lleva el
  meridiano horizontal al mismo foco). La posición de la cámara es la
  pupila de entrada paraxial a infinito (la perspectiva de la lente simple);
  el diafragma da el f/ pedido, nunca más abierto que la lente (y el del
  catálogo se abre hasta el f/ más rápido declarado). Las semiaperturas que
  la fuente no da salen de un rayo marginal y uno principal paraxiales y se
  ensanchan con rayos reales del encuadre (en los dos meridianos) cuando
  esos se salen. Para 32 alturas de imagen se traza una rejilla de 24 × 24
  en el plano del vértice trasero en las tres bandas: el rectángulo de lo
  que pasa, con una celda de margen, es donde se muestrea (§3.5), girado al
  acimut de la muestra; la irradiancia sobre una rejilla de 40 × 40 da el
  normalizador del eje y la iluminación relativa.
- **Muestra** (`TracedLens::sample`): una banda por muestra (decisión 3,
  `DIM_LENS_BAND`; las tres de un grupo comparten el punto de la pupila),
  un punto del rectángulo, el rayo trazado hacia delante con rimas e iris
  (el iris con atajos exactos: dentro del círculo inscrito pasa, fuera del
  circunscrito no), peso `A cos⁴θ / Z²` sobre el del eje por el tinte de la
  banda. Intersección estable de §6.5 (`t = c r² / (B ± sqrt(B² − c² r²))`),
  normal sin raíz, Newton en las asféricas, Snell vectorial con los
  cocientes de índice precalculados; solo `+ − × ÷ sqrt`. Una muestra que
  la lente para pesa negro pero conserva su propio rayo sin recortar (para
  la cobertura de un fondo transparente). La baldosa traza las muestras
  de una fila (los píxeles que toman una sola) en **lotes de ocho**
  (`traced::batch`, `render::camera_samples`): superficie a superficie, los
  ocho carriles en *arrays* que el compilador vectoriza, cada uno con las
  operaciones de una muestra sola en su orden, así que los mismos bits (un
  test lo compara carril a carril); los píxeles de borde de E11 y una lente
  con asféricas, una a una. Los ajustes no físicos: el
  remolino gira el rectángulo, la distorsión (`r (1 − k (r / campo)²)`:
  negativa es barril) y la respiración mueven el punto del sensor, el
  viñeteo pesa, la esférica es una lámina asférica en el diafragma; los
  rayos centrales de los pases (`TracedLens::chief`) usan el mismo punto
  del sensor que las muestras. Un anamórfico se desestira por la
  compresión que traza a su foco; una lente sin cilindros, por nada (la
  compresión de la lente simple no le aplica).
- **Lo que el motor dice** (`LensInfo`, `rt_scene_lens_info` de `rt_wasm`
  y `POST /api/lens/info` del lanzador, el mismo JSON): focal a infinito y
  al foco, **escala de imagen** cerca del eje (`h = k tan θ`, con los
  ajustes no físicos: la respiración a foco cercano no es distorsión),
  tiraje, f/ en uso y el más rápido, T-stop, transmisión por banda,
  longitud, pupila de entrada, elementos y grupos, la compresión de un
  anamórfico, la **distorsión** contra esa escala y la **iluminación
  relativa** en 17 alturas del encuadre de salida (un anamórfico, en su
  meridiano vertical), y el **corte** (`section`: cada superficie tal como
  se traza, con su posición enfocada, curvatura en el meridiano horizontal,
  semiapertura e índice; el iris en uso y el sensor). La interfaz lo pinta
  sin calcular nada (regla 10): números, curvas y el SVG del corte
  (`src/ui/components/lens-section.ts`), y el visor Rápido aplica la escala,
  la distorsión y el viñeteo como aproximación (`render/lens-profile.ts`,
  dicho en el medidor).
- **El pico a través del perfil** (el 1.8 del triaje). El mapa de un punto
  de la pantalla al de la imagen sin distorsionar que muestra está una sola
  vez en `render/lens-profile.ts`, en dos lenguajes uno junto al otro
  (`profileSource` y `PROFILE_GLSL`, los mismos pasos con los mismos
  números de `profileUniforms`, la tabla leída entre sus entradas): por él
  dibujan el pase de pantalla (`lens-filter-pass.ts`), el contorno de la
  selección (la máscara se lee por el mapa, así que la línea va alrededor de
  la pieza como se dibuja y mide un píxel en todas partes) y los
  superpuestos (*gizmo*, glifos, trayectorias y, en *Completo*, las caras
  seleccionadas: a un objetivo como el lienzo y de ahí al lienzo por el
  mapa), y lo invierten `pick` (enfocar con clic, seleccionar), el *gizmo*
  (`rayAt`; el arrastre mide en la imagen sin distorsionar, donde se dibuja
  antes del mapa), `glyphAt` y `objectAt` (por `profileShown`, el mapa al
  revés por bisección), la selección por caja (`Projection.shown` en
  `core/box-select.ts`) y el pase de ids de las caras (cada píxel de la
  pantalla lee el de su fuente). Sin perfil (lente simple, o antes de que el
  motor diga sus números) el mapa es la identidad. El perfil es el de la
  cámara por la que se mira: al mirar a través de una luz o de otra cámara
  (L4) no se aplica el de la cámara activa.
- *Hash* fijado de la escena O2 (`example::o2_scene`: el ejemplo a f/2,8
  por la doble Gauss del catálogo con siete láminas curvas y las luces de
  fondo de O1): `PINNED_O2_TRACED_4SPP` = `0x8f7d0ef8` (desde la mezcla con
  E9; antes `0xe2e8e3ab`) en cada ruta SIMD, en WASI, en el `rt_wasm.wasm`
  real (`rt --write-o2-example`, `tests/fixtures/o2.rsb`, en CI) y con 1, 4
  y 16 hilos. Las escenas sin lente trazada no se mueven.
- **Coste** (`rt --lens-cost`, un hilo, la más rápida de tres vueltas): en
  lotes, la muestra de cámara por la doble Gauss cuesta 0,25 µs (0,71 µs
  una a una; 0,19 µs la de la lente simple): en el ejemplo a 1024 muestras es
  el 13,7 % del render (antes de los lotes, el 29,1 %), por debajo del 25 %
  de la regla de coste.

### 5.2 decies · Texturas de imagen y etiquetas en el sombreado (M2b, `rt_core::texture`)

El motor pinta en *Completo* y en *Render* las ranuras y las etiquetas de M2a
donde las pinta *Rápido* (`render/texture-shader.ts`), con la matemática de
`core/textures.ts` en `f32` y `fmath`: los dos lados leen
`tests/fixtures/texture-mapping.json` (proyecciones y etiquetas en puntos de
muestra; TypeScript lo fija y Rust lo cumple a 2·10⁻⁵), y un test de navegador
(`tests/textures-full-browser.test.ts`) pinta una esfera con cuadros por sus UV,
una caja girada con proyección caja y la etiqueta del frasco en *Rápido* y con
el `rt.wasm` real y compara dónde caen las casillas y la etiqueta.

- **Imágenes** (`texture::image`). Se guardan como bytes en su codificación;
  los *mipmaps* se calculan al leer la escena: cada nivel la mitad del anterior
  (por defecto, al menos 1), cada téxel la media de caja de los téxeles que
  cubre del nivel anterior (pesos fraccionarios si un lado es impar), en lineal,
  guardada en bytes otra vez (sRGB por la entrada más cercana de la tabla de
  decodificación); el alfa, recto, como la pirámide de la GPU. La lectura es la
  del `TEX` de M3a (§5.2 quater) en cualquier nivel; la de nivel de detalle `λ`
  mezcla los niveles `⌊λ⌋` y `⌊λ⌋ + 1` (trilineal, L. Williams, *Pyramidal
  Parametrics*, 1983). `λ = log2` del eje más largo de la huella en téxeles del
  nivel 0 (el filtro isótropo de una GPU).
- **Huella** (`texture::shade::Footprint`). Un rayo de cámara lleva sus
  diferenciales (H. Igehy, *Tracing Ray Differentials*, SIGGRAPH 1999,
  escrito desde el artículo): los de la cámara estenopeica de `CAMR` (una lente
  fina, y la óptica de O1 y O2, se tratan como su estenopo: en el plano de foco
  cambian igual), llevados al punto y proyectados sobre su plano. Después del
  primer vértice, el ancho del cono del camino: el del vértice anterior más el
  ángulo de un píxel por la distancia, estirado por `1/|cos|` en la dirección
  en que se inclina el rayo (sin término de curvatura ni de rugosidad: más fino
  de lo ideal, lo que la integración del camino promedia). Todo a **un cuarto
  de píxel** (`FOOTPRINT_SCALE`): el trazador ya promedia las muestras sobre el
  píxel, y la huella entera lo emborronaría dos veces; un cuarto lo deja tan
  nítido como la muestra filtrada de *Rápido*.
- **Ranuras** (`texture::shade`). En el espacio de la pieza (la malla; la
  transformación de la instancia lleva el punto y los vectores): color ×
  color base (en un emisor, × su radiancia), rugosidad y metal × los suyos (el
  canal, invertido si lo dice), alfa × opacidad o recorte por debajo del umbral,
  emisión `tinte × imagen × intensidad` sumada a lo que la superficie refleja.
  La caja mezcla los texeles de sus tres ejes por `|n|⁴` de la normal
  interpolada antes de leer el canal. Un mapa de normales dobla la normal de
  sombreado en el marco de los gradientes de superficie de las coordenadas
  (`T ∝ ∇u`, `B ∝ ∇v`, los dos escalados por el mayor, el marco que construye
  *Rápido* con derivadas de pantalla, M. Schüler 2013; con UV, los de la UV del
  triángulo; con proyección, los suyos exactos), cada eje de la caja en el suyo
  y mezclados; un mapa de alturas, `normalize(n − ∇ₛh)` por diferencias
  centradas de un téxel del nivel leído. Trabaja sobre la normal ya biselada
  (E6) y con el dibujo procedural, girada al exterior de la pieza y vuelta (el
  relieve se lee igual por los dos lados); el punto del terminador y la normal
  geométrica no cambian.
- **Etiquetas**, en orden: cada una sobre lo de debajo por su alfa; su
  rugosidad y su barniz sustituyen a los de la superficie en esa proporción;
  bajo la cobertura `A`, la superficie conserva `1 − A` de su metal, de su
  transmisión (el papel es opaco: una etiqueta sobre vidrio no se ve a través)
  y de su emisión; el borde del papel dobla la normal por el gradiente de
  `Σ aᵢ · reliefᵢ · 0,15 mm`, con el rectángulo de la etiqueta incluido.
- **El integrador** las lee en cada impacto de cámara o de BSDF de una
  instancia con texturas (`Prepared::textures`; las partículas no tienen),
  después del bisel y del dibujo; un recorte o una opacidad por punto los ve el
  rayo de cámara y también el de sombra (una instancia con imagen de alfa es
  atravesable; el material de un recorte o de una pared fina que cruza un rayo
  de sombra se lee en el nivel 0), y el pase de albedo da el color con
  texturas. Un emisor cuya radiancia cambia por la superficie (imagen de color
  o de emisión, o etiquetas) **no se muestrea como luz**: lo encuentran los
  rayos que le dan (sin sesgo, con más ruido). Los fotones de las cáusticas ven
  el material sin texturas, como ven los dibujos de E6.
- **Coste y determinismo.** Una escena sin texturas no hace nada nuevo (sus
  *hash* fijados no se mueven); una con texturas lee como mucho tres
  coordenadas por ranura y dos niveles por lectura. El ejemplo
  `rt_core::example::m2b_scene` tiene su *hash* fijado
  (`PINNED_M2B_TEXTURES_4SPP`) en todas las rutas SIMD, en `rt-cli` y `rt-app`
  con 1, 4 y 16 hilos, en WASI y en el `rt.wasm` real (CI), y sus seis pases
  (`PINNED_M2B_PASS_*`).

### 5.2 undecies · Programas de material en el sombreado (M3b, `rt_core::program`)

El motor ejecuta en *Completo* y en *Render* el programa de un material de
nodos (§5.2 quater) en cada impacto, con los mismos bits que el intérprete de
referencia de TypeScript (`core/material-interp.ts`): la prueba cruzada
(`tests/material-program-cross.test.ts` escribe y fija
`tests/fixtures/material-programs.json`; `program/tests.rs` lo corre) son los
diez ejemplos en 1000 puntos, cada instrucción en cada modo en 200 y cada
función en sus casos especiales, a tolerancia 0 (cada NaN contado como
`0x7FC00000`: su signo y su carga son de la máquina, y el motor no los lee;
`tests/program-hash.ts`), y la página corre al revés
los programas del ejemplo del motor (`PINNED_M3B_PROGRAM_VALUES`). Un test de
navegador (`tests/programs-full-browser.test.ts`) compara dónde caen los
dibujos de los diez ejemplos en *Rápido* y con el `rt.wasm` real.

- **Lectura** (`program.rs`, `Program::decode`): la cabecera, las
  instrucciones, las constantes (finitas), la tabla de imágenes y las salidas
  de `encodeProgram`; otra versión es `ProgramError::Version` (un fichero más
  nuevo), y es `Invalid` un código desconocido, un operando que nada ha escrito
  antes, un destino que es operando de su propia instrucción o fuera de su
  archivo (los 9 registros del punto no se escriben), un índice de constantes o
  de imagen fuera, una rampa de 0 o más de 64 paradas, más de los límites, bytes
  de más o de menos. `is_material` pide las quince salidas con vectores en el
  color base, la emisión y la normal.
- **Intérprete** (`program/interp.rs`, `Runner`). Archivos de registros en la
  pila, 256 `f32` y 256 `vec3`; ninguna asignación al correr (test); cada
  instrucción en `f32` sin FMA, con `fmath` (las funciones de `core/f32math.ts`)
  y el orden de operaciones de la referencia. El ruido (`program/noise.rs`) es el
  de M3a: Perlin y símplex con el *hash* de esquina y la suma en octavas, con el
  `Math.round` y el `ToUint32` de JavaScript donde la referencia los usa.
  `TEX` lee con `TextureImage::sample` de M2b en el nivel de detalle de la huella
  del rayo: las lecturas de una misma imagen por un mismo `MAP` (sus constantes
  y su juego de UV), o por un mismo juego de UV o un paso desde él (`VADD`),
  forman un grupo, y la primera mide el nivel (las diferencias del `MAP` por los
  dos ejes de la huella, con la costura de la cilíndrica y la esférica; o el
  cambio del juego de UV) que las demás repiten: las tres alturas de un relieve
  se leen en un nivel. Unas coordenadas calculadas de otra forma, o un rayo sin
  huella (los de sombra), leen el nivel 0, que es la lectura de la referencia.
  `EDGE` y `CAVITY` preguntan al `Host`.
- **El punto** (`program/shade.rs`, `context`), en el espacio de la pieza (la
  malla; la transformación de la instancia lleva el punto, la dirección y la
  normal): P; N, la normal de sombreado (con el bisel de E6) vuelta al exterior
  de la pieza; UV0 y UV1 (el segundo juego es el primero si la malla tiene uno;
  cero sin UV); I, hacia el origen del rayo; T, el gradiente de superficie de la
  u del primer juego ortogonalizado contra N (`onb(N)` sin UV); B = N × T; y el
  cambio de cada coordenada del primer juego por T y por B, por milímetro.
- **El material** (`resolve`): el `MATL` de la escena con el color base, metal,
  rugosidad, anisotropía, barniz y su rugosidad, transmisión, IOR y opacidad del
  punto, cada uno en su rango (0–1; el IOR ≥ 1); un valor que no es un número
  deja el del fichero. La dispersión interna no se lee (el medio de E9 es del
  volumen). Un emisor (`MATL` de tipo emisor) toma `emisión × intensidad` como su
  radiancia; cualquier otro material suma esa emisión a lo que refleja.
- **La normal** del programa vuelve al mundo y al lado por el que llegó el rayo;
  si mira de espaldas al que mira, se dobla hasta `MIN_FACING` de su lado (como
  los mapas de normales de M2b). El punto de salida de los rayos y la normal
  geométrica no cambian.
- **Bisel**: la salida es un peso del radio del material. Constante, escala el
  radio para toda la pieza (`BevelSetup::shading_point_scaled`; 1 es el bisel
  de siempre bit a bit, 0 ninguno); calculada, el programa corre en el punto sin
  biselar para el peso y, si es mayor que 0, otra vez en el punto biselado por
  él para todo lo demás.
- **Curvatura** (`BevelSetup::curvature`; E7 no está): de las aristas vivas
  del bisel a menos de `r` mm del punto, `smoothstep(1 − d/r) · min(tan(θ/2), 1)`
  (θ, el ángulo entre las caras), la mayor de las convexas (`EDGE`) y la de las
  cóncavas (`CAVITY`); 0 en una malla sin aristas vivas. Se mide una vez por
  impacto y radio.
- **El integrador** (`Prepared::programs`, `ProgramSetup`): en cada impacto de
  cámara o de BSDF de una instancia cuyo material tiene programa, tras el bisel
  y antes de las texturas de M2b, que se aplican sobre el material del programa;
  un material con programa no lleva el dibujo de E6. Una opacidad que no es la
  constante 1 hace la instancia atravesable: la cámara recorta por ella, y los
  rayos de sombra (`walk`, el cruce recto de S4b y las salidas de un medio)
  leen el material del programa en el nivel 0 y sin peso de bisel. El pase de
  albedo es el color base del programa; el de normales, el del bisel. Un emisor
  cuya emisión no es constante en el programa no se muestrea como luz
  (`emission_varies`, `light.rs`): lo encuentran los rayos que le dan. Las
  partículas no tienen programa y los fotones de las cáusticas ven el `MATL`.
- **Coste y determinismo.** Una escena sin programas no hace nada nuevo (sus
  *hash* fijados no se mueven; el mismo PNG que antes). Con programas, cada
  impacto corre el suyo (de 6 a 41 instrucciones en los ejemplos; +41–47 % por
  rayo con todas las piezas de la escena con su grafo, ROADMAP M3b). El ejemplo
  `rt_core::example::m3b_scene` tiene su *hash* fijado
  (`PINNED_M3B_PROGRAMS_4SPP`) en todas las rutas SIMD, en `rt-cli` y `rt-app`
  con 1, 4 y 16 hilos, en WASI y en el `rt.wasm` real (CI, y por el código de la
  página), y sus seis pases (`PINNED_M3B_PASS_*`).

### 5.2 duodecies · Muestreo adaptativo y terminar por ruido (E10, `rt_core::adaptive`)

**Rondas.** Con `RNDR.adaptive` bit 0 el anfitrión renderiza por **rondas**.
La primera da `WARMUP` = 16 muestras a todos los píxeles con el renderizador
de baldosas de siempre (`render_tile_edges`: el índice de muestra es la
iteración del mapa de fotones, como sin adaptativo; los pases exactos y el
albedo se hacen solo en ella). Al acabar cada ronda, con todas sus baldosas
renderizadas por los hilos que sea, la **imagen entera decide la siguiente**
(`decide`): (1) el error relativo de la media de cada píxel,
`sqrt((E[l²] − E[l]²) / (n − 1)) / (max(media, 0) + ε)` con la luminancia de
Rec. 709 de las sumas de la película y `Film::lum2` (la varianza de la media
que usa el *denoise*), `ε = EPSILON / 2^ev` (el 1 % del blanco de pantalla,
`floor_for`), y `UNMEASURED` = 10³⁰ con menos de dos muestras o sumas no
finitas; (2) suavizado por la media 3 × 3 dentro de la imagen; (3) por bloque
de `BLOCK` = 8 × 8 píxeles, el mayor; (4) **candidatos**: los bloques por
encima del objetivo de ruido (`RNDR.noise_threshold`; sin él, cualquiera con
error) que no han llegado al tope de muestras; la ronda va a los candidatos
en o por encima del **cuantil 50 %** de sus errores (el umbral del momento,
que baja al converger la imagen); sin candidatos, **convergido**; (5) la
ronda dura `ROUND` = 16 muestras × `clamp(bloques / (4 × activos), 1, 16)`,
nunca más que las que ya tiene el bloque activo con menos. Un bloque sin
ronda conserva sus muestras y su media: cada píxel es la media de sus propias
muestras de índices `0..n`, en orden (un test lo compara bit a bit con la
imagen uniforme de esas muestras). Todo `f32` en un orden fijo: la decisión
no depende de hilos, baldosas ni arquitectura. Las decisiones solo ocurren al
final de las rondas, así que dónde se corta una ronda en pasadas (por tiempo,
por el carril del *denoise* en directo, por cualquier tamaño) no cambia un
píxel; tras la primera ronda las pasadas son de hasta 16 muestras.

**Cáusticas y bordes.** En una pasada todos los bloques activos están en el
mismo punto de su ronda: la muestra `j` de la pasada de cada bloque (índice
`n_b + hecho + j`) usa el mapa de fotones `iteración + hecho + j`
(`Adaptive::iteration`): una pasada traza tantos mapas como sin adaptativo y
dos muestras de un píxel nunca comparten mapa. `render_block` es
`render_tile_edges` de un rectángulo dentro de la baldosa de su `EdgeMask`, con
el mapa que se le dé (sea cual sea su iteración).

**Anfitriones.** `rt` (`render_adaptive`; `--adaptive`, `--noise P`) y el
lanzador juntan las películas de las baldosas (`gather`) al final de cada
ronda; tras la primera, el trabajo de una pasada son los bloques activos de
todas las baldosas, que los hilos se reparten uno a uno (cada bloque se corta
de la película de su baldosa, `Film::cut`, se renderiza y se devuelve con
`copy_region`: los mismos bits que renderizar en ella). El lanzador publica
las sumas de cada píxel **reescaladas** a las muestras del que más tiene
(`rescale`: la suma tal cual si `n` es esa, si no `(suma × (1/n)) × s` en
`f32`), así que la página y `Frame::fitted` (U14) las leen como siempre, y su
trama (cabecera de 68 bytes, bandera `FLAG_ADAPTIVE` = 1024) lleva en los
bytes 52 a 68 el mínimo y el máximo de muestras, el error del bloque más
ruidoso en la última decisión y los segundos que espera hasta el objetivo
(lo que la decisión dice que queda, en píxeles-muestra, al ritmo de la última
pasada; −1 sin objetivo o sin medir). *Terminar por ruido* llega al lanzador
como `finish=samples`: el tope son las muestras y el objetivo del RSB lo
acaba antes. En la web, `src/render/adaptive.ts` es el **puerto bit a bit**
de la decisión (`Math.fround` tras cada operación; `PINNED_E10_DECISIONS`,
de una imagen sintética, lo comprueba contra el motor), `Accumulator` cuenta
por bloque (`blockSamples`, `addBlock`), los *workers* reciben el mensaje
`blocks` y renderizan cada bloque con `rt_render_block_rgba(… muestra,
iteración …)` (la máscara de bordes, la de su baldosa de 32), y
`runAdaptive` (`render/schedule.ts`) lleva las rondas del *Render*; el visor
*Completo* que sigue las muestras de la salida muestrea así cuando la salida
termina por ruido. `rt_adaptive_decide` expone la decisión del motor para
`tools/wasm-parity.mjs --adaptive`.

**Denoise.** `DenoiseInput::with_counts`: las sumas y `lum2` reescaladas a
`samples` y el conteo propio de cada píxel, por el que se divide su varianza
(`n − 1`; por debajo de cuatro, la estimación espacial); en wasm, el plano de
conteos detrás de los catorce de siempre (`DENOISE_WORDS_COUNTED`). Sin
conteos, los bits de siempre.

**Interfaz.** *Terminar por* gana *Ruido* (`FinishBy` `NOISE`,
`RenderSettings.noiseThreshold` en por ciento, 0,5–5, 1 por defecto;
`adaptiveOf` lo hace `SceneView.adaptive`/`RenderOptions.adaptive`). El
medidor dice *Adaptativo · mín–máx muestras* con los números de
`EngineStatus.adaptive`; la estimación de la ventana sale de la última
pasada del visor que muestrea al mismo umbral (`ui.noiseEstimate`), y el
progreso de la cola, de los segundos que el motor espera.

**Hashes.** `PINNED_E10_ADAPTIVE` = `0x264b4106` (la escena de E10:
`e5b_scene` con un objetivo del 3 %, 48 muestras de tope y bordes ×2, de 16 a
48 muestras por píxel), igual por `rt` con 1, 4 y 16 hilos, con baldosas de
32, 24 y 13 y pasadas de 16, 5 y 3, por el lanzador (final y visor) con 1, 4 y
16 hilos, por el `rt.wasm` real escalar y SIMD (`rt --write-e10-example`) y
por el código de la página; sin el *flag*, ninguno de antes se movió.

### 5.2 terdecies · La vista en sección (Q1, `rt_core::geometry::section`)

El plano de corte es un dato del proyecto (`state.section`, SPEC §3.1) que
cada motor lee a su manera y que da **la misma imagen**: el RSB lo lleva en
`SECT` (§5.2) ya resuelto en el instante de la animación
(`resolveSection(plano, offsetMm)`: `distance = normal · (punto + normal ·
desplazamiento)`; el desplazamiento es la suma de los clips `SECTION` de la
pose, `Pose.sectionOffsetMm`), y *Rápido* lo pone en un `THREE.Plane`. Lo que
queda es `normal · p <= distance`.

**En el motor** el plano vive **dentro de `Geometry`**
(`Geometry::set_section`; el lector del RSB y `Scene::build_particles` lo
llaman, porque una geometría reconstruida no lo tiene), y cada consulta
(rayo de cámara, secundario, de sombra, fotones, selección, pases, lotes) lo
ve sin que cambie ninguno de los núcleos SIMD ni el integrador:

- **Recorte.** Un semiespacio corta un rayo en un intervalo
  (`Span::{Removed, Whole, Enters(t), Leaves(t)}`), y `t` vale lo mismo en
  el mundo que en el espacio de cada malla, así que el rayo recortado es un
  rayo corriente con otro `t_min` y `t_max`. Sin sección el camino es el de
  siempre (los *hash* de antes no se mueven: la escena sin plano es la de
  E5 bit a bit, y un plano que no corta nada tampoco cambia un píxel).
- **Tapa.** Un rayo que cruza el plano ha estado fuera de toda superficie
  que no golpeó, así que si el cruce está dentro de un sólido lo dice la
  **siguiente superficie del propio rayo**: si la encuentra **por detrás**
  (`Solid::inside_before`, por el sentido del triángulo con la
  transformación de la instancia), el cruce estaba dentro y hay tapa. Un
  rayo que entra al lado que queda reutiliza el mismo recorrido (cero
  coste); uno que sale sin haber golpeado nada mira más allá del plano
  (`RayClass::Parts`: las partículas no son sólidos); un rechazo previo por
  la caja de las instancias tapables (`cap_bounds`) deja fuera casi todos
  los rayos. El impacto es `RayHit { instance, triangle: CAP_TRIANGLE
  (u32::MAX), t }`: plano, **sobre** el plano, con la normal del plano de
  cara al rayo, `front_face = outside = (normal · dir < 0)`; como no tiene
  triángulo no hay textura, dibujo, programa ni bisel: el color liso del
  material (y un vidrio cortado es una interfaz que refracta, como un vidrio
  macizo que acabara ahí). Un rayo de `t_max` finito que entra dentro de un
  sólido y acaba antes de salir no ve la tapa (límite documentado).
- **Sólido** (`geometry/solid.rs`, una vez por malla, `SolidCache` en
  `OnceLock`): vértices soldados por posición exacta y luego con tolerancia
  `1e-5 ×` la extensión; los triángulos sin área no cuentan; cada arista
  soldada tiene que estar en exactamente dos triángulos recorridas en sentido
  contrario; el volumen con signo (bloques de 256, respecto al centro de la
  caja) dice `Outward` o `Inward`; si no, `Open`. Una pieza con materiales
  por cara (`faceMaterials`) y un vidrio de pared fina no se tapan
  (`partIsCapped` repite la regla). `core/solid.ts` es el gemelo de
  TypeScript (los dos leen las mismas mallas a mano de los tests).
- **El estudio no se corta.** Una instancia con `INSTANCE_NO_SECTION` (el
  escritor la pone, solo mientras corta un plano, a las piezas de un set:
  fondo, suelo y tarjetas) no la quita ni la tapa el plano. Como el rayo
  recortado no puede verla en el lado quitado, `exempt_in` recorre ese
  tramo dentro de la caja de cada instancia exenta, pasando por encima de
  las superficies del modelo cortado (como mucho 48; `t` sube justo por
  encima de cada una) hasta dar con una exenta; una escena sin instancias
  exentas nunca entra ahí. Las sombras ven el estudio desde los dos lados.
- **Determinismo.** La decisión de tapa depende solo de las mallas y del
  plano: nada de tiempo, de hilos ni de azar; el mismo *hash* con 1, 4 y 16
  hilos, en escalar, SSE2 y AVX2, y en wasm escalar y `simd128`
  (`PINNED_Q1_SECTION_4SPP`, `rt --write-q1-example`, bloque de paridad de
  `engine.yml`).

**En Rápido** (`render/section-preview.ts`): `renderer.localClippingEnabled`;
un solo `THREE.Plane` en `clippingPlanes` de todos los materiales del modelo
(el de los pases de identificadores incluido), con `Plane(−normal_three,
distance)` (three conserva `m·x + c >= 0`; la normal pasa por `toThree`, el
único sitio del eje Y arriba) y **lejos** (`1e9`) cuando no hay sección: los
*shaders* no cambian al encenderla ni al apagarla. Mientras corta, los
materiales del modelo se pintan a doble cara (una malla abierta enseña su
interior, como en el motor) y la **tapa** es una segunda malla hija de cada
pieza que es un sólido cerrado (`isClosedSolid`), con la geometría de la
pieza, solo caras de atrás (`BackSide`), el material liso de la pieza con
`onBeforeCompile` poniendo como normal la del plano y `polygonOffset −1`:
donde el corte se ha llevado la cara de delante se ve la de atrás, que es la
tapa (el equivalente al *stencil*, sin el segundo pase). Un vidrio cortado se
pinta transparente (la tapa que refracta es de *Completo*). El estudio dibuja
con una copia de su material sin plano (`unclipped`, solo mientras corta).
La selección por clic usa `firstKept` (el primer impacto del lado que queda;
el de una tapa es el corte, con el punto en el plano y su normal), la caja
de selección y el cardán excluyen las piezas que el corte se ha llevado
enteras (`removed`, mira los vértices cuando la caja queda cortada y guarda
la respuesta), y el suelo, los efectos y las superposiciones no llevan el
plano.

**Interfaz** (UI.md §2.4, punto *Sección*): `ui/panels/insp-section.ts`,
`ui/section-commands.ts` y el modo de clic `PickMode { kind: 'section' }`
del visor (aviso propio, `Esc` lo baja, el primer clic de dos puntos solo
recuerda el punto). Está en el inspector de Escena y no en la barra del
visor porque es un objeto de la escena (se guarda, se anima, se ve en
Completo y en Render), como el entorno y el ambiente.

### 5.2 quaterdecies · Luces IES (L5, `rt_core::ies`)

**El lector** (`rt_core::ies`, `IesProfile::parse`; `src/core/ies.ts` es su
puerto). El formato es el texto público de IES LM-63 (ediciones de 1995 y
2002, y la de 1991 sin línea de versión): cabecera de líneas `[CLAVE] valor`
(`[MORE]` continúa la anterior), `TILT=NONE`, trece números, los ángulos
verticales, los horizontales y las candelas. Se lee la fotometría **tipo C**;
los ángulos verticales corren 0–90, 0–180 o 90–180 y los horizontales son uno
(redondo), 0–90 (cuatro cuadrantes iguales), 0–180, 90–270 o 0–360. **Tipo B y
tipo A se rechazan** con su propio mensaje (convertirlos es un remuestreo de
la esfera que no hace falta: cualquier luminaria se puede publicar en tipo C),
y también `TILT=INCLUDE` y `TILT=<archivo>`. El lector es estricto: cuentas que
no casan con los números que hay (de menos, el archivo está cortado; de más,
las cuentas están mal), ángulos que no crecen, candelas negativas o no
finitas, rangos que el estándar no admite, más de 2 MiB o una tabla toda a
cero son errores con su mensaje, nunca una suposición. Admite separadores
como los archivos reales (espacios, tabuladores, comas, saltos `\r\n` o `\r`).
Los lúmenes del archivo, el número de lámparas, los factores de balasto y las
dimensiones de la abertura se leen y **no se usan**: el archivo da la *forma*
(§siguiente). **No se entrega ningún perfil de fabricante**: las dos pruebas de
`tests/fixtures/ies/` están escritas a mano y cada persona trae los suyos.

**La distribución.** `IesProfile::intensity(γ, φ)` interpola **bilinealmente**
las candelas en el ángulo vertical γ (desde el eje, 0° donde apunta la luz) y
el horizontal φ, con las tablas no uniformes tal cual, después de reducir φ al
rango guardado por la simetría del archivo (cuadrante, bilateral 0–180,
bilateral 90–270, completo, redondo); fuera del rango vertical es 0 (un
*downlight* no manda luz hacia arriba). Con una dirección en el marco de la
luz, `intensity_dir`: `+z` el eje, φ = 0 a lo largo de `+y` (el `up` de la
luz) y φ crece de `+y` hacia `+x`, contra el reloj mirando a lo largo del eje
desde detrás (como el estándar dibuja el ángulo horizontal visto desde arriba
de un *downlight*); γ y φ salen de `atan2` de `fmath`, sin `acos` (que pierde
la precisión cerca del eje). El **flujo** (`IesProfile::flux`) es la integral
de esa misma función sobre la esfera, en forma cerrada por celda (el trapecio
es exacto en φ, donde es lineal, y la integral de `sin γ` por una función
lineal en γ tiene primitiva): es el flujo de lo que se renderiza, no una
estimación; para un perfil isótropo da `4π c` y para 1000 cos² un sexto de
`4π · 1000` con la precisión de la tabla (0,5 % con pasos de 10°, 5·10⁻⁵ con
pasos de 1°). `efficiency() = flux / (4π · pico)`.

**La luz** (`LightKind::Ies`, `Light::ies`). Es la luz de punto o esfera de
`power` W y diámetro `size_x` con una máscara por dirección, la misma
mecánica del foco: `máscara(x) = intensidad(dirección del centro a x en el
marco de la luz) / pico`, en [0, 1]. **El perfil da la forma y `power` el
nivel**: la luz es tan brillante en la dirección más brillante del perfil como
el punto de `power` W (intensidad `power / 4π` W/sr), igual que un foco es tan
brillante en su eje como su punto: un perfil escrito para 500 lm y otro para
5000 dan la misma imagen, y cambiar un foco por una luz IES o al revés no
mueve la exposición. `direction` es el eje del perfil, `up` el origen de φ
(el escritor de la página manda el `up` con el giro de la luz: girar la luz
gira el patrón). Se muestrea por NEE como cualquier esfera (cono que llena,
posición delta cuando es un punto, MIS con los rayos BSDF si es *glossy*; la
máscara se evalúa también para el rayo de cámara y los reflejos). **Elección
de luz** (§5.2 ter, E12): por punto, el peso `lum(I) · máscara(x) / max(d²,
r²)` es exacto; en la elección estática (más de 64 entradas, el atrapasombras)
una luz IES **dentro de la esfera que envuelve la escena** pesa por su flujo
(el del punto del pico por la eficiencia del perfil: su luz va a todas las
direcciones donde está la escena) y fuera de ella, como un foco, por la
intensidad hacia el centro de la escena (`0,05 + 0,95 · máscara(centro)`; el
flujo del archivo no es la medida correcta ahí: un haz de 10° dirigido a la
escena, con poco flujo, es la luz que más cuenta). No lanza fotones de
cáusticas (como el punto y el foco).

**En el RSB y en la página.** `LGHT` 5 y `IESP` (§5.2). `LightInstance.type`
gana `'IES'` y `LightInstance.ies = { name, text, base }`: el texto del archivo
(un carácter por byte), su nombre y la potencia con que entró; el
multiplicador del inspector es `power / base` (× 1 es el nivel con que
entró la luz, calibrado como el de un punto nuevo: la media de los focos
encendidos, así que la imagen no salta). Viaja en el proyecto (JSON del
estado: el `.repack` se abre en otro equipo sin el archivo; un perfil dañado o
que el lector rechaza se quita al abrir y la luz es un punto), en los estudios,
en un montaje guardado (`LightSpec.ies`) y en la biblioteca (el validador exige
un perfil que el lector acepte). Sus lúmenes son el flujo del punto del pico
por la eficiencia del perfil (`lightLumens`), no los lúmenes que dice el
archivo. **Rápido lo aproxima** (el medidor de la luz lo dice, regla 10) con
un `SpotLight` de three.js con la intensidad del eje y un cono cuya
transición vale exactamente la mitad del pico en el semiángulo de la mitad de
intensidad `β` del archivo (`iesSpot`: borde interior a `0,4 β`, exterior
donde `cos` queda a medias, como mucho 90°; una lámpara que no baja a la
mitad es un hemisferio de borde duro): lo que no se ve es el perfil entero.
El motor lo lee **solo cuando dice que sabe** (`rt_features` bit 3, valor 8,
`rt_core::FEATURE_IES`; `render/engine.ts` `readsIes`; el *pool*, `NativeEngine`
y *Exportar escena del motor* lo ponen en `SceneView.ies`): para un motor
anterior la luz va como el foco que la aproxima en Rápido, que cualquier
motor lee.

**Hashes.** `PINNED_L5_IES_4SPP` = `0x920f0be1` (`rt --write-l5-example`: el
ejemplo con su panel a una quinta parte y dos luces IES, una esfera de 24 mm
con el perfil del *downlight* y un punto cálido con el *wall washer* girado
sobre su eje; 160 × 120), igual en cada ruta SIMD, en `rt` con 1, 4 y 16 hilos,
en WASI y en el `rt.wasm` real (CI y `tests/ies-engine.test.ts`); ningún hash
anterior se movió.

### 5.2 quindecies · Cámaras de interiores (K3)

**Proyecciones** (`rt_core::scene::Projection`, `Camera::panorama_dir`).
`Standard` es la cámara de siempre (estenopeica, lente simple, lente trazada u
ortográfica); las dos panorámicas son estenopeicas (sin lente, sin *shift*:
`Camera::through_lens` es falso) y parten de `position` con la base de la
cámara (`forward`, `right`, `up`). **Equirectangular**: longitud `(u − ½) ·
fov_x` hacia la derecha y latitud `(½ − v) · fov_y` hacia arriba, dirección
`forward cos φ cos λ + right cos φ sin λ + up sin φ`; con 360 × 180 la imagen
2:1 entera es la esfera. **Ojo de pez** equidistante: `x = (u − ½) · fov_x`,
`y = (½ − v) · fov_x / aspecto` (en radianes, píxeles cuadrados), `θ = √(x² +
y²)` es el ángulo con el eje y la dirección es `forward cos θ + (right x + up
y) sin θ / θ`; más allá de `θ > π` no hay nada que ver: el rayo es de
intervalo vacío y su muestra pesa negro (el círculo de imagen). Los pases
dan la distancia (no la profundidad sobre el eje) como profundidad de una
panorámica, y las huellas de píxel de partículas, texturas y cáusticas
toman el cono de un píxel de la esfera. **La página** (`core/panorama.ts`) tiene
el mismo mapa y su inverso, y la vista previa lo dibuja en GLSL desde un
cubo (`render/panorama-pass.ts`); la prueba son seis direcciones de un cuarto
de seis colores en la imagen del `rt.wasm` real y en la de Chromium. El render
por franjas de una panorámica es de K6: hoy el motor la renderiza entera, por
baldosas como cualquier imagen.

**Visible a cámara** (`INSTANCE_NO_CAMERA`, `PreparedInstance::camera_hidden`).
Solo las consultas de clase `RayClass::Camera` (los rayos primarios y sus
continuaciones rectas por recortes y paredes finas, los pases y las tapas de
sección) se la saltan, en la BVH, en la fuerza bruta y en las tapas; las
sombras, los rebotes y los reflejos la ven. Es la planta: el techo da su luz
y su sombra y la cámara mira por encima.

**Multiplicador de exterior** (`CAMR.exterior`, `integrator::exterior`):
multiplica el entorno que un rayo de cámara ve al escapar (también tras
paredes finas y recortes) y el fondo del atrapasombras; lo que el entorno
ilumina no cambia. 1 es exactamente lo de antes (la rama no multiplica).

**Verticales rectas: en la página.** El motor no sabe de ellas: la página
escribe la cámara nivelada en la misma posición y el *shift* vertical
`−f · tan(inclinación)` sumado al de la óptica, en el `LENS` de O1 que ya
existía (`core/interior-camera.ts` `renderedCamera`); la prueba del motor lee
el archivo que escribe la página (`tests/fixtures/k3-verticals.rsb`) y mide
las aristas verticales de un cubo a 0,0001 px de paralelas a 1920 × 1080
(6,4 px sin *shift*).

**Exposición automática: en la página.** `core/image-passes.ts` mide las sumas
de la acumulación (luminancia en `f32`, `log2` de `core/f32math.ts`, orden,
10 % abajo y 5 % arriba fuera, media al gris del 18 %, ±16, centésimas): la
misma imagen da la misma exposición en cualquier máquina. El visor la rehace
cuando las muestras se duplican y el render final mide sus sumas antes del
*denoise*. En `RNDR.exposure_ev` va solo la compensación: el visor, el
render y la cola convierten la imagen con la exposición que les da la
página, pero una escena exportada y renderizada con `rt` fuera de la
aplicación sale sin la medida (limitación de K3).

**Interruptor.** `rt_features` bit 4 (valor 16, `rt_core::FEATURE_CAMERAS`);
`render/engine.ts` `readsCameras`, y el *pool*, `NativeEngine` y *Exportar
escena del motor* ponen `SceneView.cameras`. A un motor anterior la página le
escribe la cámara de perspectiva de siempre, sin el bit 2 de `INST` ni el
exterior.

**Hashes.** `PINNED_K3_PLAN_4SPP` = `0x6efb1e66` (`rt --write-k3-plan-example`:
la habitación de cajas de `example::k3_room` vista en planta ortográfica
desde arriba con el techo oculto a cámara y el exterior a 0,5; 96 × 72),
`PINNED_K3_PANORAMA_4SPP` = `0x96de8d73` (`--write-k3-panorama-example`:
equirectangular 128 × 64 desde dentro, exterior 0,4) y
`PINNED_K3_FISHEYE_4SPP` = `0x9b85a1b6` (`--write-k3-fisheye-example`: ojo de
pez de 300°, 96 × 72), iguales en cada ruta SIMD, en `rt` con 1, 4 y 16 hilos,
en WASI y en el `rt.wasm` real (CI y `tests/interior-camera.test.ts`), y la
panorámica también por la API del lanzador con 1 y 4 hilos
(`rt-app/tests/parity.rs`); ningún hash anterior se movió.

### 5.2 sedecies · La lente trazada inclinada (O4, `rt_core::optics::traced::tilt`)

Desde O4 `tilt_deg` y `tilt_axis_deg` de `LENS` también valen con una
prescripción (el formato no cambia; antes el motor los ignoraba con lente
trazada, y la página escribe la inclinación propia de la trazada,
`tracedTiltDeg`, no la de la lente simple: una cámara trazada antigua no
empieza a inclinarse). **Una `LENS` con `tilt_deg = 0` no entra nunca en
el código nuevo**: no se mueve ningún *hash* fijado.

- **El giro.** La lente gira respecto al sensor alrededor de la posición
  de la cámara (su pupila de entrada a infinito: la perspectiva no se
  mueve), sobre el eje del plano del sensor a `tilt_axis_deg` de la
  derecha y en el mismo sentido que la lente simple (`forward` pasa a
  `forward cos α' + b sin α'`). El sensor sigue de frente a la vista de la
  cámara y se coloca donde la lente forma la imagen del **punto de
  enfoque** (`focus_dist` a lo largo de la vista): ese punto queda en el
  centro del encuadre y nítido, y el encuadre no gira.
- **El ángulo.** `α'` no es el `α` pedido: se resuelve para que el plano
  de enfoque de la lente (el conjugado del plano del sensor por su óptica
  paraxial; una colineación lleva un plano a un plano: Scheimpflug y la
  regla de la bisagra de una lente gruesa, Merklinger 1993 y Kingslake
  1992, cap. 4) se incline **igual que el de la lente simple** de la misma
  inclinación, focal y distancia de enfoque (normal
  `f·forward + u·sin α·b`). Para cada `α'` la lente se enfoca al objeto
  `u cos α'` a lo largo de su eje (el mismo enfoque de O2, unidad, interno,
  flotante, ahora en `focus_state`), y la transferencia paraxial del primer
  vértice al último (`Abcd`) da la imagen del punto de enfoque y el
  conjugado de tres puntos del sensor; 40 pasos de bisección sobre `α'`
  entre 0 y 60°. Así la inclinación significa el mismo plano con las dos
  lentes, y el dibujo del plano y el plano por dos puntos de la interfaz
  valen para ambas (`src/core/focus-plane.ts`). El motor dice el ángulo
  que toma la lente (`LensInfo.tilt_deg`, `"tiltDeg"` en el JSON solo con
  inclinación).
- **El reenfoque con rayos reales.** La imagen paraxial del punto de
  enfoque no ve la curvatura de campo de la lente donde la inclinación pone
  ese punto (a `f tan α'` del eje): el centro del sensor se mueve a lo
  largo de su normal, con cuatro pasos de secante, hasta que los rayos
  reales del centro (dos pares, a un quinto del haz a cada lado del rayo
  principal en los dos meridianos; su encuentro se calcula como recta en la
  profundidad, sin la cancelación de dos rayos casi paralelos en `f32`) se
  cruzan a `focus_dist`. El ángulo se queda: lejos del centro, la
  curvatura de campo y el astigmatismo de la lente doblan el plano como
  doblan el de la lente derecha (es su carácter; los tests lo miden).
- **Las muestras.** Un sensor inclinado ve el plano trasero por otros
  rectángulos que uno derecho, y ya no solo por la altura de imagen: los
  límites se trazan en una rejilla de 9 × 9 posiciones del sensor
  (`TILT_GRID`, 24 × 24 en el plano trasero en las tres bandas, una celda
  de margen, como en O2) y una muestra toma la unión de los cuatro nodos de
  alrededor (sin girar al acimut). El rayo principal de cada nodo sale de
  ocho pasos de Newton sobre el punto del diafragma; los rayos centrales
  de los pases y de la selección lo interpolan. El peso de una muestra es
  `A |cos θ_trasero|³ |cos θ_sensor| / Z²` sobre el normalizador del eje
  de la lente derecha, el coseno del sensor medido contra su normal
  inclinada (con el sensor derecho es el `A cos⁴θ / Z²` de O2). El rayo
  sale en el marco de la lente y se gira al de la cámara alrededor de la
  pupila. Los lotes de O2 (`sample_setup` y `sample_finish`) pasan por lo
  mismo: los mismos bits que una a una. Las semiaperturas derivadas se
  ensanchan también para el desplazamiento del centro del sensor.
- **Lo que no.** Una lente con cilindros (el adaptador anamórfico) rechaza
  la inclinación (*a traced lens with cylinders does not tilt*; la
  interfaz no la escribe y lo dice); una lente cuya luz sale hacia `−z`
  también. Sin `unsafe`, solo `+ − × ÷ sqrt` y `fmath::sin_cos`: la misma
  escena da los mismos píxeles en cualquier plataforma y con cualquier
  número de hilos.
- **El descentramiento** de una lente trazada ya movía el sensor en O2
  (`Lens::shifted` antes de `traced_film`); con inclinación se mide desde
  el centro del sensor inclinado.

*Hash* fijado de la escena O4 (`example::o4_scene`: la escena O2 con la
doble Gauss inclinada 6° sobre el eje horizontal y desplazada 2 mm a la
derecha y 3 mm abajo; `rt --write-o4-example`, `tests/fixtures/o4.rsb`):
`PINNED_O4_TRACED_TILT_4SPP` = `0x0b2fc327` en escalar, SSE2 y AVX2, en el
`rt_wasm.wasm` real por el código de la página (`tests/lens-o4.test.ts`) y
en CI (`tools/wasm-parity.mjs`, con y sin pases), y 1, 4 y 16 hilos
(`rt-cli/tests/example.rs`). La hoja `rt --tilt-sheet <dir>`
(`rt-cli/src/tilt_sheet.rs`) pinta luces sobre un suelo que se aleja, con
la lente simple y con la doble Gauss trazada, derechas y con la
inclinación que tumba el plano sobre el suelo (`sin α = f cos β / h`), y
su composición 2 × 2. No hay bit nuevo en `rt_features`: la página
escribe la inclinación de la trazada igual con un motor anterior, que la
ignora.

### 5.2 septendecies · Enfocar con clic y el enfoque que sigue (F1, `rt_core::focus`)

El clic de *Enfocar con clic* tiene que caer en el píxel exacto de la vista
exacta, y lo que se enfoca tiene que salir nítido en la imagen del motor. Por
eso las dos preguntas las contesta el motor, sin repetir su cámara en
TypeScript:

- **El rayo.** `rt_scene_pick(handle, u, v, out)` escribe 14 `f32` del punto
  `(u, v)` de la imagen (0 a 1, `v` hacia abajo; el centro de un píxel es
  `(x + 0,5) / ancho`): el **rayo principal** (origen y dirección, el de
  `Camera::generate_ray` con el punto `(0, 0)` de la pupila, el de los pases
  exactos, `render::centre_ray`), y si la escena tiene geometría lo que toca
  primero (`Scene::pick`: solo las piezas, cortadas por la sección, las dos
  caras de cada triángulo, vidrio y recortes incluidos) con su `t`, su punto,
  su instancia, su profundidad y la distancia que lo enfoca (NaN donde no hay).
  La página le da una escena **de solo la cámara** (`io/rsb.ts`
  `focusPickRsb`: la cámara de la vista como la escribe `projectScene` para el
  visor Completo, con la pose del cabezal, la cámara mirada a través con su
  propio cuadro y la imagen del visor alrededor del cuadro) y lanza el rayo
  contra la geometría de la vista previa por las dos caras
  (`PreviewEngine.pickAlong`). Cualquier proyección que tenga el motor (la
  lente fina con su descentramiento, la trazada con su distorsión y su
  respiración, la ortográfica, y las que vengan) sirve así sin más. Una
  lente trazada **respira** (su campo cambia con el enfoque), así que lo que
  muestra el píxel se mueve un poco cuando el enfoque llega a él: el pico se
  repite con la cámara ya enfocada en lo que tocó el anterior hasta que el
  punto no se mueve más de una micra (`render/focus-pick.ts`
  `settledFocusPick`; cada vuelta reduce el paso por lo que respira, unas
  centésimas, y a la cuarta está quieto). Sin eso, abierta, el clic en la
  esquina quedaba 0,9 mm de profundidad fuera en una superficie a 45°. Una
  cámara cuyos rayos no dependen del enfoque (lente fina, inclinación) toca
  el mismo punto en el segundo pico y para.
- **El enfoque.** `rt_scene_focus_at(handle, x, y, z)` devuelve la distancia
  de enfoque que pone en foco el punto del mundo (`Camera::focus_distance_to`):
  su profundidad a lo largo del eje (la lente fina, que enfoca un plano
  perpendicular al eje); con inclinación, la distancia cuyo plano de la regla
  de la bisagra pasa por el punto, `u (f − sin α (p · b)) = f z`; con una lente
  trazada, la que pone en el punto su **mejor foco**, donde el detalle fino
  que ve el punto del sensor tiene más contraste
  (`TracedLens::film_position_through`, Newton sobre el rayo principal;
  `TracedLens::best_focus`: una rejilla de 32 × 32 muestras de cámara por
  banda sobre el rectángulo de la pupila que pasa la luz desde *ese* punto del
  sensor, buscado allí mismo y no en las franjas precalculadas del render, para
  que el visor, con su sensor mayor, y el render resuelvan lo mismo; pesadas
  por su peso y por su parte de la luminancia; a lo largo del rayo, entre donde
  los rayos cruzan el principal, la distancia de más modulación de patrones de
  10 y 5 pares de líneas por milímetro del cuadro de 36 mm (`FOCUS_LP_MM`; la
  media de las dos frecuencias y de dos direcciones, medida la frecuencia desde
  la pupila de entrada), el máximo más cercano a los mínimos cuadrados (un
  barrido de 48 pasos, cuesta arriba desde ahí, y secciones áureas: con una sola
  frecuencia, cerca del borde un lóbulo lateral, la resolución espuria, quedaba
  por encima de un lóbulo principal débil y el enfoque salía 43 mm fuera), por
  la secante desde la paraxial con la lente enfocada de nuevo en cada intento
  (como mucho seis, guardando el mejor), hasta 2·10⁻⁵ de la profundidad. El primer criterio fue
  el **círculo de menor confusión** (los mínimos cuadrados de las muestras), y
  no sirve: abierta, la aberración esférica extiende un halo que los mínimos
  cuadrados siguen, y el render quedaba blando en el clic (la doble Gauss
  rápida a f/1,4 con 135 mm a 600 mm tiene su menor confusión a 601,5 mm y su
  contraste a 607–610 mm, donde el render es nítido; un test lo comprueba con
  las muestras de cámara del propio render a través del foco). Medido: abierta,
  una lente trazada pone su mejor foco a milímetros del plano paraxial, varias
  profundidades de campo; resolverlo cuesta de 0,4 a 0,6 s en `rt.wasm` con la
  máquina cargada.
- **Las cámaras de K3** (§5.2 quindecies). El pico pasa por `generate_ray`,
  así que la ortográfica, la equirectangular y el ojo de pez pican sin más; una
  panorámica es estenopeica, y su distancia de enfoque, como la profundidad de
  su pico y de su pase, es la distancia al punto (también detrás de la
  cámara). Con verticales rectas el motor recibe la cámara nivelada
  (`renderedCamera`): la interfaz resuelve sobre ella y guarda esa distancia
  entre cos(inclinación corregida), que es lo que `renderedCamera` vuelve a
  multiplicar.
- **Con O4** (§5.2 sedecies). Una lente trazada inclinada se resuelve con
  sus propias muestras (`sample_setup` de la lente inclinada, su rejilla de
  límites del sensor) en el marco de la cámara, como su rayo principal; la
  regla paraxial de la interfaz para ella es la de la bisagra, el mismo
  plano que O4 le pide. *Por dos puntos* de una lente trazada enfoca a la
  media de `exactFocusDistance` de los dos puntos con la inclinación
  resuelta.
- **`frame_sensor_mm`** (al final de `LENS`, tras la prescripción, opcional):
  el sensor del cuadro de salida a lo largo de su lado largo cuando el de la
  cámara abarca más (la imagen del visor). La lente trazada saca de él lo que
  es de la esquina del cuadro (las semiaperturas que la fuente no da, la altura
  contra la que mide su distorsión y su viñeteo artísticos, dónde mide su
  compresión), y no del sensor del visor: antes, el visor Completo de una lente
  con distorsión no era el render (2,3 mm frente a 1,0 mm en la esquina con
  distorsión +1). La página lo escribe solo para el visor; sin él, los bytes y
  la imagen de antes.
- **La interfaz** detecta las dos exportaciones por su nombre
  (`render/focus-pick.ts` `hasFocusExports`; sin bit nuevo de `rt_features`,
  porque no cambian lo que se lee del RSB): sin `rt.wasm`, o con uno de antes,
  el pico de la vista previa y la distancia paraxial. El solucionador de
  `core/focus.ts` (`setFocusSolver`) es el de `rt.wasm` en el hilo de la
  página para la cámara del cuadro (`lensInfoRsb`), con las últimas 64
  respuestas guardadas; los fotogramas de un gesto (`SceneView.focusFast`)
  usan la última diferencia con la paraxial para esa lente en vez de
  resolver otra vez. En el escritorio la página lleva su `rt.wasm`, el mismo
  `rt-core` que renderiza el lanzador.
- **Lo que no cambia.** Nada de esto toca el render: ningún *hash* fijado se
  movió. `focus::tests` fija los 20 picos de una rejilla de la escena de O1
  (descentramiento e inclinación) y de la de O2 (lente trazada, con su enfoque
  resuelto), `PINNED_FOCUS_PICK_O1` y `PINNED_FOCUS_PICK_O2`, los mismos bits
  en nativo y en el `rt.wasm` real (`tools/wasm-parity.mjs --pick`, en CI).

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
con cada baldosa, el albedo de cada muestra (`rt_render_tile_albedo`), N2: la
cobertura de cada muestra (`rt_render_tile_alpha`, que `PassAccumulator.addAlpha`
suma igual) y,
en el trabajo que empieza en la muestra 0, sus planos exactos
(`rt_render_tile_passes`), y el hilo principal los junta con
`PassAccumulator` (`src/render/pass-planes.ts`) igual que la imagen: el
resultado es el del motor nativo bit a bit y vuelve como `RenderPasses`. Con
muestreo adaptativo (E10, §5.2 duodecies), tras la primera ronda los
*workers* reciben bloques de 8 × 8 (mensaje `blocks`) en vez de baldosas, y
el hilo principal decide cada ronda con el puerto de la decisión.

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

### 5.4 ter · Vídeo codificado (N1)

La salida *Vídeo* de una animación (`RenderSettings.animation.output`
`VIDEO`, contenedor `video`: `MP4` o `WEBM`) se codifica **en la página**,
también en el escritorio (WebView2 es Chromium): cada fotograma lo
renderiza el motor como siempre (un RSB por fotograma, `evaluate` en su
instante) y sale como un PNG de 8 bits opaco; el codificador del navegador
lo comprime y nuestros *muxers* escriben el archivo. Sin dependencias.

- **Qué codifica este sistema** (`src/io/video.ts`): `probeVideo` pregunta
  a `VideoEncoder.isConfigSupported` por cada contenedor, en orden: WebM,
  **VP9** (`vp09.00.10.08`) y si no **VP8**; MP4, **H.264** *Constrained
  Baseline* (`avc1.42E0xx`, el nivel que piden el tamaño y los fps según
  la tabla A-1 de ISO/IEC 14496-10: sin fotogramas B, así que el orden de
  decodificación es el de presentación y el MP4 no lleva `ctts`). Sin
  WebCodecs (fuera de un contexto seguro, un navegador sin ella) no hay
  nada. `main.ts` lo pregunta una vez al arrancar (1080p a 24 fps) y lo deja
  en `ui.video`; la ventana de render solo ofrece lo que hay (lo demás
  deshabilitado con su porqué), el Doctor (`output`) avisa solo de un
  códec que aquí no se codifica, y un trabajo pregunta otra vez con su
  tamaño y sus fps al abrir su escritor.
- **El escritor** (`createVideoWriter`): `configure` con el códec, el
  tamaño **par** (4:2:0: una fila o columna impar se deja fuera), los fps,
  ~0,1 bit por píxel (de 1 a 50 Mbit/s) y `latencyMode: 'quality'`; cada
  fotograma `i` es un `VideoFrame` del `ImageBitmap` del PNG con
  `timestamp = round(i · 10⁶ / fps)` µs y su duración, fotograma clave cada
  2 s (`KEY_EVERY_S`), con espera mientras la cola del codificador pasa de
  dos. Los trozos se guardan en memoria con su tiempo y si son clave; en
  H.264 (`avc: { format: 'avc' }`) el registro de configuración
  (`decoderConfig.description`) es el `avcC`. Al acabar, `flush` y el
  *muxer*. El entorno (`VideoEncoder`, `VideoFrame`, `createImageBitmap`)
  entra como `VideoEnv`: las pruebas usan este mismo código con un
  codificador falso.
- **WebM** (`src/io/webm.ts`), de la especificación pública de EBML (RFC
  8794) y de Matroska (RFC 9559) y las guías de WebM: cabecera EBML
  (`DocType` `webm`, versión 4), `Segment` con `Info` (`TimestampScale`
  1 ms, `Duration` en ms como `f64`, `MuxingApp` y `WritingApp`),
  `Tracks` (una pista de vídeo, `V_VP9` o `V_VP8`, `DefaultDuration` en ns,
  `PixelWidth` y `PixelHeight`), `Cues` **antes** de los *clusters* (un
  `CuePoint` por *cluster*, con su `CueClusterPosition` relativo al inicio
  de los datos del `Segment` escrito en 8 bytes, así que el tamaño de
  `Cues` no depende de las posiciones) y un `Cluster` en cada fotograma
  clave (o cuando un bloque se alejaría más de 30 s de su inicio: el
  desplazamiento de un `SimpleBlock` es un entero de 16 bits con signo),
  con su `Timestamp` y un `SimpleBlock` por fotograma (pista 1,
  desplazamiento en ms, bandera de clave). Todos los tamaños se conocen
  antes de escribir: tamaños EBML de la longitud mínima.
- **MP4** (`src/io/mp4.ts`), de ISO/IEC 14496-12 (cajas) y 14496-15
  (`avc1`/`avcC`): `ftyp` (`isom`, compatible `iso2`, `avc1`, `mp41`),
  `moov` **delante** (*fast start*) con `mvhd` (escala 1000), una `trak`
  (`tkhd`, `mdia`: `mdhd` con escala `fps × 1000`, `hdlr` `vide`, `minf`:
  `vmhd`, `dinf`/`dref`, `stbl`: `stsd` con la entrada `avc1` y su `avcC`,
  `stts` en tramos, `stss` con los fotogramas clave, `stsc` con un solo
  *chunk*, `stsz` y `stco`, o `co64` si el archivo pasara de 4 GiB) y
  `mdat` con los fotogramas seguidos.
- **La cola** (`src/ui/render-queue.ts`): un trabajo de vídeo abre su
  escritor antes de renderizar (si el sistema no codifica el contenedor,
  falla en ese momento, sin renderizar nada, y lo dice), le pasa cada
  fotograma en lugar de guardarlo, y al final guarda **un archivo**
  (`<nombre>.webm` o `.mp4`, numerado como una imagen); el historial guarda
  el primer fotograma como el PNG que es (`ResultMeta.video` dice de qué
  vídeo). Los plugins de trabajos no pasan por los fotogramas de un vídeo
  todavía.
- **El fundido a color de la pista de cámara** (`core/fade.ts`) se aplica a
  los píxeles de cada fotograma después del motor (que no sabe de él): en
  los valores de una imagen de 8 o 16 bits y en luz lineal (con la
  exposición) en EXR, TIFF de 32 bits y DNG, con el alfa hacia opaco.
- **Pruebas.** `tests/video.test.ts` relee los dos contenedores con lectores
  propios de la prueba (`tests/video-readers.ts`: EBML y cajas, escritos
  aparte de los escritores), comprueba que un vídeo de 2 s a 12 fps tiene 24
  fotogramas y 2 s, conduce el escritor con un codificador falso y un
  trabajo de la cola hasta el archivo y, donde la máquina tiene ffmpeg,
  mete fotogramas reales de libx264 y libvpx en nuestros MP4 y WebM y deja
  que ffprobe los lea. `tools/video-check.mjs` hace lo mismo en Chromium con
  el WebCodecs de verdad, y el camino entero de la aplicación (el motor, el
  codificador, la descarga), leído por ffprobe.

### 5.4 quater · Cola, pases y lotes (N2)

La cola (U5, U14) ya tenía orden, progreso, pausa y cancelación; N2 le
añade los pases como archivos, el estudio como eje del lote y el ZIP.

- **El modelo** (`core/render.ts`). `RenderSettings` gana `studio`
  (`StudioChoice`: `CURRENT`, `ONE {id, name}` o `ALL`), `passes`
  (`PassesOutput` de `core/pass-files.ts`: las claves `alpha`, `depth`,
  `normal`, `partId` en ese orden y el formato `EXR` o `PNG16`) y `zip`;
  `RenderJob` gana `zip` (el id del grupo de ZIP, o null). Un proyecto
  anterior no tiene nada de eso y abre con los valores de siempre
  (`migrateRender`, `settingsOf`, `patchSettings`; sin subir
  `PROJECT_SCHEMA`: todo tiene su valor por defecto). `expandJobs` hace un
  trabajo por cámara y por estudio (primero por cámara, así los archivos
  salen en el orden de la plantilla); el trabajo guarda su estudio ya
  resuelto en `settings.studio` (`ONE`, como la cámara), `studiosOf` dice
  qué estudios es una elección y `batchSize` cuántos trabajos son. Una
  animación hace un solo trabajo, sin estudio y sin pases. Los estudios que
  *Todos* significa los lista la interfaz (la biblioteca, luego los del
  proyecto: `studioRefs`) y viajan en la acción `render/enqueue`, que sigue
  siendo una sola entrada de deshacer; los trabajos de una orden comparten
  `zip: 'z<n>'` (n, el número de render del primero) si los ajustes lo piden.
- **El estudio de un trabajo.** `restoreStudio(state, saved, { camera: false })`
  (`core/lighting.ts`, la función pura que ya usaba `studio/restore`) pone
  materiales, focos, suelo, entorno e imagen del estudio guardado sobre una
  **copia** del proyecto, sin quitarle su vista a la cámara del trabajo;
  `FrameRequest.state` se la da al motor (`RenderOptions.state` ya existía) y
  el proyecto abierto ni se entera. El estudio se busca por su id en la
  biblioteca y, si no, en los del proyecto; si no está, el trabajo falla con el
  motivo. Un trabajo con estudio no pasa por la IA.
- **Los pases** (`FrameRequest.passes` + `imageName`). `main.ts` pide al motor
  las claves (`RenderOptions.passes`), codifica los planos que vuelven con
  `io/passes.ts` y los devuelve como `FrameResult.extras`; la cola los guarda
  bajo el nombre de la imagen (`passFileName`: `<imagen>_depth.exr`). Con el
  paso de IA en el escritorio, el lanzador renderiza los dos conjuntos y la
  página los lee de vuelta. Qué es cada número (`core/pass-files.ts`): el alfa
  en PNG, `α × 65535`; la profundidad en PNG, 0 el fondo, 1 lo más lejano y
  65535 lo más cercano, lineal entre el rango de las superficies de la imagen,
  que va en un trozo `tEXt` (*Depth range*); las normales en PNG, `n × ½ + ½`
  (el fondo, el gris medio); el id en PNG, el número de instancia más 1 hasta
  65534 y 65535 el suelo del estudio; en EXR, los valores tal cual (`A`, `Z` con
  `+Infinity` en el fondo, `R G B`, `Y`). La leyenda `<imagen>_partId.json` lista
  cada id con su pieza y su material (el orden de instancias de
  `projectScene(...).ids`). Los escritores son propios y sin dependencias:
  `encodePngWords` (PNG de 16 bits, gris o RGB, filtro 0, `pHYs` y `tEXt`) y
  `encodeExrPlanes` (el EXR mínimo de `encodeExr`, con los canales que se le
  dan, ordenados).
- **El ZIP** (`io/zip.ts`). Método *store* de PKWARE APPNOTE 6.3: por archivo
  una cabecera local y los datos, luego el directorio central y el registro
  final; nombres UTF-8 (bit 11) con `/`, sin raíz ni `..`; el CRC-32 es el de
  `io/image.ts` (el mismo polinomio que el de PNG); la hora es la DOS local;
  los repetidos se distinguen antes de la extensión (`a.png`, `a_2.png`); sin
  ZIP64 (4 GiB o 65 534 archivos: error claro). El resultado es un `Blob` de
  las cabeceras y los `Blob` de los archivos, sin copiarlos. `ui` no importa
  `io`: el puerto `AppServices.archive.zip` se lo da `main.ts`.
- **El grupo de ZIP en la cola** (`ui/render-queue.ts`). Un trabajo con `zip`
  no guarda sus archivos (imagen, ruido, pases, leyenda, imágenes de la IA,
  el vídeo): los pasa a la cesta de su grupo (`saveOutput`); `flushIdleZips`
  escribe el ZIP de todo grupo que ya no tiene un trabajo `QUEUED` ni
  `RUNNING` en la cola (`Proyecto_0001-0004.zip`, `zipFileName`), al acabar cada
  trabajo y en cada cambio de la cola mientras haya archivos esperando (así que
  quitar el último trabajo en espera, o deshacer su *Añadir*, también lo
  escribe). Si el ZIP falla se guardan los archivos uno a uno. Los plugins de
  trabajos guardan aparte, fuera del ZIP.
- **El estudio de un trabajo** (N2b, `ui/render-queue.ts`). *Render*, *+ Añadir a
  la cola* y *Guardar cambios* de una edición llevan al *store* los estudios que
  usan con el estudio mismo (`studiosForJobs`: `StudioRef.snapshot`); el
  *reducer* de la cola guarda la copia en `render.studios` y el trabajo la nombra
  (`studioCopy`), todo en la misma entrada de deshacer. `jobProject` pone en la
  copia del proyecto que se renderiza el estudio que da `resolveStudio`. La
  biblioteca sigue siendo de la persona (sin deshacer, U4): *Añadir a mi
  biblioteca* (`addProjectStudioToLibrary`) no cambia el proyecto.
- **Pruebas.** `tests/batch.test.ts` (los trabajos y nombres de un lote de 2 × 2,
  la cola con el segundo trabajo detenido o quitado, el estudio puesto en una
  copia, los pases, el ZIP en todos sus casos leído por fflate),
  `tests/zip.test.ts` (los bytes de un paquete conocido, fflate, `unzip` y
  `zipfile` de Python una vez a mano), `tests/pass-files.test.ts` (los números, los
  nombres, los PNG releídos con `zlib` de node y los EXR con el `EXRLoader` de
  three.js), `tests/passes-engine.test.ts` (el alfa del `rt.wasm` real contra
  los *hash* fijados) y `tools/batch-check.mjs` en Chromium.

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

   **Vista en vivo** (U14): mientras la vista en vivo de la cola mira un
   *Render* y le toca una imagen (`FrameRequest.frameBox`, con la cadencia de
   `core/live-frame.ts`), la página pide, tras la pasada recién publicada,
   `GET /api/render/<id>?fit=<an>x<al>`: el lanzador promedia las sumas por un
   factor entero (`Frame::fitted`, en el hilo de la petición) y la trama lleva
   el tamaño reducido y la bandera 512, así que solo viajan los píxeles de la
   imagen (un lanzador sin `fit=` las manda enteras y la página las reduce).
   Sin vista en vivo solo viajan cabeceras, como antes. En la web, el *pool*
   hace lo mismo con su acumulación (`render/live-frame.ts`) tras la baldosa
   que acaba de llegar.

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
| Luces IES (L5) | `ies::tests`, `light::tests`, `integrator::tests` y `scene::rsb::tests` de rt-core, `render::tests` (fijado L5), `rt-cli/tests/example.rs` (1, 4 y 16 hilos), `tests/ies.test.ts` (con `tests/fixtures/ies/conformance.json`, que escriben las pruebas del motor), `ies-lights`, `ies-switch`, `ies-engine` (con el `rt.wasm` real); `tools/ies-check.mjs` | Los dos perfiles escritos a mano: la intensidad que muestrea el motor a 0°, 30° y 60° es la del archivo (pruebas de muestreo y de la imagen de un suelo, a 1e-4 del pico, y la interpolación entre nodos y la orientación de φ); el flujo contra el caso cerrado (isótropo `4π c`, 1000 cos² con 1° de paso a 1e-4, contra una cuadratura numérica de la propia función); las simetrías (un mismo reparto escrito como cuadrante, bilateral y completo da lo mismo en cada dirección y en flujo); 68 archivos (sanos y mal formados: cortados, cuentas de más y de menos, negativos, ángulos, TILT, tipos A y B) con lo que hace el motor, que el lector de la página repite con los mismos mensajes; RSB con el perfil una vez por cada distinto y `LGHT` de 80 B, los bytes de antes sin luces IES y `l5.rsb` byte a byte con el escritor de la página; selección por punto y estática; el interruptor `FEATURE_IES` del *pool* y del lanzador; el mismo fijado con 1, 4 y 16 hilos y en el `rt.wasm` real; proyecto, estudio, montaje y biblioteca; Playwright con Chromium en *Rápido* y *Completo* (menú, archivo, gráfico polar, multiplicador, cambiar perfil, archivo rechazado). Nueve mutaciones del motor, todas detectadas |
| Cámara de interiores (K3) | `scene::camera_tests` y `render::k3_tests` de rt-core, `rt-cli/tests/example.rs` (1, 4 y 16 hilos), `rt-app/tests/parity.rs`; `tests/interior-camera.test.ts` (con el `rt.wasm` real y `tests/fixtures/k3-*.rsb`), `image-passes`, `panorama-browser` (Chromium), una del *pool* en `pathtracer`; `tools/k3-check.mjs` | Verticales rectas: las aristas de un cubo con la cámara inclinada 10° a 1080p, paralelas a 0 px en la página y en Rápido y a 0,0001 px con los rayos del motor leyendo el archivo de la página (7,5 y 6,4 px sin ellas); el límite de 30°, la cámara que se renderiza; altura de ojo, ópticas, vistas; los mapas de las panorámicas y su inverso, seis direcciones en el `rt.wasm` y en Chromium (y el círculo del ojo de pez, y una pared oculta a cámara que ni se dibuja ni se pica); `CAMR` e `INST` byte a byte con `rt`, archivos de antes con sus bytes, inválidos; la planta: la media bajo el techo oculto igual a la de debajo del techo (+0,0000 %) y el techo sin ver; exterior exacto a la mitad; el medidor de exposición (gris, recortes, media logarítmica, orden, límites, el medidor progresivo); los tres fijados en cada ruta SIMD, hilos, WASI y wasm. 28 mutaciones (8 del motor, 20 de la página), todas detectadas |
| Ambiente (S4a, S4b) | `tests/effects.test.ts`, `effects-rsb.test.ts` (con el `rt.wasm` real); `rt-sim` (`eval::tests`, `params`), `render::ambient_tests`, `geometry::tests`, `geometry::particles::grid_tests`, `bsdf::forward::tests` e `integrator::particle_tests` de rt-core; `tools/ambient-check.mjs`; la hoja `tools/ambient-sheet.mjs` | El catálogo y sus claves; las cuatro acciones por el *store* (deshacer, gestos, nada para un valor que ya tiene, el preset que conserva sitio, instante, semilla, tope y nombre); región, cuenta y tope; los campos de `FXAM` en unidades del motor, byte a byte frente a los que escribe `rt --write-ambient-example`; el Doctor y su arreglo; guardar y abrir cada campo, un archivo anterior sin efectos; en el motor, el *hash* de posiciones fijado (nativo y wasm, 1 y N hilos), régimen estacionario a 0, 3 y 60 s (< 3 %), nada bajo el suelo, la imagen fijada en todas las ISA, las escenas de referencia sin cambios sin efectos, la fuerza bruta frente a la BVH para cada clase de rayo, y la energía del ensanchado (4 frente a 256 spp, ± 2 %). En S4b, además: la rejilla de pantalla da los impactos de la fuerza bruta (estenopeica y lente simple, las tres formas, partículas en el plano de la cámara); el lóbulo hacia delante integra 1 con g como coseno medio, se muestrea con su densidad, el horno blanco de su BSDF y de una mota da 1, y la NEE sola, el BSDF solo y el MIS coinciden (1 %); los caminos tras un lóbulo ancho no ven una gota sin sombra (bit a bit) y la cruzan con la transmitancia de la sombra, la cámara la sigue viendo refractar, y la regla de las gotas lisas no cambia la media |
| Vista en sección (Q1) | `tests/section.test.ts`, `solid.test.ts`, `section-rsb.test.ts` (con el `rt.wasm` real), `section-full-browser.test.ts` (Chromium y `rt.wasm`); `geometry::section_tests`, `integrator::section_tests`, `scene::section_rsb_tests` y `render::section_tests` de rt-core, `rt-cli/tests/example.rs`; `tools/section-check.mjs` | El plano desde un clic y cada eje, desde dos puntos y desde números; las acciones por el *store* (deshacer, gestos, nada para lo que no cambia), guardar y abrir; `SECTION` interpolado con la curva del clip, sumando, partido y repetido; `SECT` byte a byte frente a `rt --write-q1-example` y dónde la pone el escritor; en el motor, el rayo ignora el lado quitado y no deja que bloquee una sombra, una caja cortada por la mitad se tapa con el área de su sección y su color, las mallas abiertas y las de pared fina no, el vidrio cortado refracta por su tapa como un vidrio macizo que acabara ahí, el estudio (referencia: modelo solo + estudio solo = lo más cercano de los dos, con tapa y sin ella), el *hash* fijado en cada ISA y con 1, 4 y 16 hilos y en wasm; la comparación por regiones del criterio (botella cortada, acuerdo por píxel 1,000 y IoU de las secciones 0,963, controles que se caen, el suelo del set entero en los dos y cortado como pieza corriente) y el cardán y la selección en caja sin lo quitado |
| Óptica de cámara (O1) | `optics::tests` de rt-core, `tests/optics.test.ts`, `tools/optics-check.mjs` | Pupila de 6 láminas dentro del hexágono y fuera del círculo inscrito en su proporción (±1 %), láminas curvas, perfiles con su densidad, obstrucción, máscara por CDF con la media del rechazo (±1 %), Scheimpflug y bisagra con tres puntos, descentramiento, anamórfico, ojo de gato con el área de dos discos, bandas que suman blanco; una lente neutra es la lente simple bit a bit; `LENS` de ida y vuelta con los bytes de `rt`; miniaturas al día; *hash* de O1 en SIMD, WASI, wasm y 1/4/16 hilos |
| Lente trazada (O2) | `optics::traced_tests` de rt-core, `lens_catalogue` y `lens_sheet` de rt-cli, `tests/traced-lens.test.ts`, `tests/lens-pick-browser.test.ts`, `tools/lens-check.mjs` | Focal y tiraje paraxiales de las 15 lentes que forman imagen dentro de la tolerancia del informe; rayos axiales de la doble Gauss paralelos a < 2e-4; f32 contra f64 < 1e-4 mm; los lotes con los bits de las muestras solas (lentes, cilindros, filas de la baldosa con filtros); cada lente se prepara a 50 mm con su corte, sus semiaperturas, su iris dentro del diafragma y su perfil; foco unidad, interno, flotante y anamórfico (los dos meridianos al foco, compresión 2 a infinito); distorsión contra la escala cerca del eje a cualquier foco; ajustes no físicos en el perfil y en los rayos centrales; rimas derivadas que dejan pasar los rayos reales; atajos del iris iguales al borde exacto; la compresión de la lente simple no estira una lente trazada; la prescripción de la página byte a byte con `rt` para las 16 lentes; biblioteca de lentes; *hash* de O2 en SIMD, WASI, wasm y 1/4/16 hilos; el mapa del perfil sin escalones y de ida y vuelta; en Chromium, cada píxel de color seguro picado a través de un barril fuerte y del ojo de pez del catálogo da la pieza dibujada en él (la identidad con la lente simple y sin números), y el contorno, la selección por caja, el pase de ids de las caras y el *gizmo* siguen lo dibujado |
| Lentes simple y trazada, inclinación (O4) | `optics::traced_tests` (los de la inclinación y el desplazamiento), `render` (`PINNED_O4_TRACED_TILT_4SPP`) y `tilt_sheet` de rt-cli, `rt-cli/tests/example.rs`, `rt-app/tests/parity.rs`, `tests/lens-o4.test.ts`, `tests/lens-modes-browser.test.ts`, `tools/o4-check.mjs`, `tools/lens-check.mjs` | Con la lente trazada inclinada, el centro nítido a la distancia de enfoque (1,5 %), la pendiente del plano a 4 mm del centro igual a la de la lente simple más la curvatura de campo de la lente derecha a esas alturas (3,5 % en la doble Gauss y la macro, 20 % en el tele y el triplete), los nueve puntos de la macro sobre el plano (2,5 %); el encuadre sobre el punto de enfoque; el desplazamiento mueve el eje sus milímetros, derecha o inclinada; inclinación 0 bit a bit la lente derecha, con cualquier eje, y sin `tiltDeg` en el JSON; lotes con los bits de las muestras solas y la luz del centro (6 %); una lente con cilindros la rechaza; *hash* de O4 en SIMD, wasm (por la página y en CI) y 1/4/16 hilos; en la página: *Lente simple* en los dos idiomas y ninguna cadena dice *lente fina*, los valores guardados sin cambiar y un proyecto anterior de ida y vuelta, ninguna inclinación de lente simple aplicada a una trazada, ningún tipo de bokeh aplicado a una cámara trazada por ningún camino (falla con el arreglo quitado), volver a la lente simple con su bokeh y su óptica avanzada, el plano por dos y tres puntos exacto, la lectura en dirección, el dibujo sobre el plano, el plano por dos puntos como una entrada de deshacer en los dos modelos; en Chromium, las secciones de cada modelo, el dial como una entrada por arrastre y nada recortado en inglés y en español |
| Ventana de la lente (O2b) | `tests/lens-peek.test.ts` (con el `rt.wasm` real), `tests/lens-peek-browser.test.ts`, `tools/lens-hover-check.mjs` | A qué cámara se pregunta y que la lente puesta es la cámara tal cual; la caché (una pregunta por lente, compartida la que está en vuelo, otra al cambiar focal, foco, f/, encuadre o ajustes, la negativa se guarda y «sin motor» y el fallo no, acotada); el reposo de 300 ms (cruzar la lista no abre nada), cerrar al salir, con Esc y al elegir, y no reabrir hasta que vuelve el puntero; las tarjetas con solo los números del motor (cargando, sin motor y negada, sin números ni dibujo; es y en); la colocación dentro de la ventana; los números de lentes que no están en la cámara contra los del motor real. En Chromium, sobre la sección de verdad: abre junto a la lista y junto al chip con el nombre, la fuente, el dibujo y los números de esa lente, no toma foco ni puntero, el teclado la abre y la mueve de lente en lente, y elegir pone la lente. Con la aplicación y el motor reales: los números de la ventana son los de la sección al poner la lente, y volver a pasar no vuelve a preguntar al módulo |
| Filtros de efecto (O3a) | `optics::filter_tests` de rt-core, `tests/lens-filters.test.ts`, `tools/lens-filters-check.mjs` | Grados → `s`; difusión blanca que conserva la media (±0,5 %), negra a 1 entre 0,90 y 0,97, dorada hacia el rojo; estrella de 6 con seis rayas (±2°); tres filtros de grado 0 = sin filtro bit a bit; la conexión con las luces y su MIS contra la dispersión sola (imagen ±3 % y suma exacta por lóbulo, también con media luz); `LENS` con huecos de ida y vuelta y la de O1 byte a byte; tinte solo en el halo y las rayas (dorada con el núcleo neutro; el suelo lejos de las luces de la hoja mueve su azul/rojo < 3 % a 1 y < 6 % a 2 con dorada y rayas); estrella que se alarga con el grado sin ensancharse, red con la cruz corta y más tenue que la estrella, brillo como nube de destellos y no anillo; aproximación del visor contra el motor en el horno (< 2 %); *hash* de O3a en SIMD, WASI, wasm y 1/4/16 hilos |
| Texturas en el motor (M2b) | `texture::tests` de rt-core (con `tests/fixtures/texture-mapping.json`, que `tests/texture-mapping.test.ts` fija contra `core/textures.ts`), `render::tests` y `passes_tests` (fijados M2B), `rt-cli/tests/example.rs` y `rt-app` (hilos); `tests/textures-engine.test.ts` (con el `rt.wasm` real), `tests/textures-full-browser.test.ts` | Las cinco proyecciones y las etiquetas en 858 puntos del fixture (±2·10⁻⁵ relativo), gradientes contra diferencias finitas, *mipmaps* en lineal, nivel de detalle y huella de la cámara, marco del mapa de normales, recorte y cobertura también en las sombras, etiquetas en orden con su borde; ida y vuelta RSB, ficheros viejos y `m2b.rsb` byte a byte con el escritor de la página; el mismo fijado con 1, 4 y 16 hilos y en cada ruta SIMD; comparación por regiones con *Rápido* en Chromium (≥ 97 % de los píxeles asentados, control movido una casilla < 15 %; etiqueta con intersección sobre unión > 0,9) |
| Programas de material en el motor (M3b) | `program::tests` y `program::scene_tests` de rt-core (con `tests/fixtures/material-programs.json`, que `tests/material-program-cross.test.ts` fija contra `core/material-interp.ts`), `integrator::tests`, `render::tests` y `passes_tests` (fijados M3B), `rt-cli/tests/example.rs` y `rt-app` (hilos, `features`); `tests/programs-engine.test.ts` (con el `rt.wasm` real), `tests/programs-full-browser.test.ts` | 172 casos de la prueba cruzada bit a bit (los diez ejemplos en 1000 puntos, cada instrucción, los casos especiales); los valores punto a punto en el espacio de la pieza, la normal, el recorte también en las sombras, la emisión y el emisor que deja de ser luz, el peso del bisel, la curvatura, el nivel de detalle, los rangos; `PROG` de ida y vuelta, ficheros viejos, versión nueva, inválidos y `m3b.rsb` byte a byte con el escritor de la página; el interruptor del *pool* y del lanzador; el mismo fijado con 1, 4 y 16 hilos y en cada ruta SIMD; comparación por regiones con *Rápido* en Chromium (siete grafos al 100 % de los píxeles asentados con correlación ≥ 0,99, control hundido; tono a menos de 40) |
| Sets (L6) | `tests/sets.test.ts`, `data`, `rig`; `tools/setup-thumbs.mjs`, `tools/sets-sheet.mjs` | Los 72 montajes anteriores sin campos nuevos y con el mismo rig que antes contra los 16 tipos (fixture); los tipos de producto con los focos de su set a su nivel; ninguna tarjeta en el encuadre (16 focales, tres formas, tres proporciones, la cámara del set: recorte del polígono contra la pirámide de la cámara, y un caso que se ve para que la prueba no pase sola); aplicar, sustituir, quitar con otro montaje y con *Restablecer*, *Crear estudio* con un set, una entrada de deshacer; la decoración no es el producto ni la mira el Doctor; el charco (su parte del nivel, dónde cae, su potencia); *Usar la cámara del set*; el degradado como imagen de fondo del RSB; las miniaturas: la escena RSB de cada una tal como la construye el código ahora y el PNG del manifiesto, y el *hash* de una fijado; medidas sobre las miniaturas con los umbrales del veredicto en `LOOK` (`tests/thumb-metrics.ts`; `REPACKSHOT_SET_MEASURES=1` las imprime) |
| Gestos en el navegador | `tools/material-drag-check.mjs`, `box-select-check.mjs`, `primitives-check.mjs` (U9), `lights-check.mjs` (L4), `sets-check.mjs` (L6) | Playwright con el Chromium local sobre `dist/`, en Rápido y en Completo, con ratón, lápiz y dedo; capturas en `docs/ui/` (las de Completo, en `out/`) |
| Físicas (S2) | `cargo test -p rt-phys` (`tests/rigid.rs`); `tests/physics.test.ts`, `physics-engine.test.ts`; `tools/physics-check.mjs` | Una esfera descansa a `r ± 0,1` mm, una pila de tres cajas aguanta 5 s, una caja inclinada cae plana, un cubo resbala de una esfera, una rampa sostiene a μ 0,6 y deja resbalar a 0,1, mil esferas se asientan (< 20 s en *release*), dormir para la simulación, *hash* fijado igual con 1 y N hilos y en wasm; qué se simula, las poses de vuelta a los nodos, una simulación es una entrada de deshacer, *Reiniciar* otra, *Pausar* congela lo que se ve, el clip se guarda, se abre y se reproduce; tres primitivas que caen en el navegador |
| Doctor de motor (D1) | `tests/doctor-engine.test.ts` (un motor falso que simula cada estado y el `installDoctorFacts` de verdad), `tests/frame-scan.test.ts` (la lectura de la acumulación y el `status().scan` del pool con *workers* falsos), `tests/store.test.ts` (las acciones de un oyente durante un deshacer); `tools/doctor-engine-check.mjs` | Cada chequeo se dispara y su arreglo lo limpia (proyecto por el *store*, una entrada de deshacer; lo que no es del proyecto, solo la explicación y, si una fila de Ajustes lo limita, el botón que la abre); *Arreglar todo* en un clic; sin hechos del motor, todo *no disponible* como antes; los umbrales en sus fronteras; `sameImage` coincide con `touchesImage` de los dos motores; las frases en los dos idiomas; en el navegador, el Doctor con dos avisos de motor (`docs/ui/doctor-engine.png`) |
| Visor | `npm run screenshot` | Captura con Chromium local (swiftshader); se adjunta al PR |
| Motor (fases E·) | `engine/crates/*/tests` y `cargo test` | Escenas analíticas (furnace test, factor de forma de un panel, espejo contra la cúpula) con tolerancias numéricas; determinismo (hash igual con 1 y N hilos); paridad wasm/nativo; SIMD contra escalar; cross-compilación a ARM64 y RISC-V; `clippy -D warnings`; `Cargo.lock` sin fuentes externas |
| Hoja de contactos | `tools/contact-sheet.mjs` + `rt` | 16 estudios × montajes elegidos renderizados en CI con el binario nativo, con media, quemados y tapados por imagen; se adjunta al PR |

Reglas no negociables:

1. Ningún cambio se entrega sin `npm run qa` en verde.
2. Todo bug corregido lleva su test, y se comprueba que el test **falla**
   si se reintroduce el bug.
3. Si un bug se escapa porque un test era más permisivo que la realidad
   (un *mock* que no se comporta como el navegador, un simulador que
   admite lo que three no admite), se arregla también el test o el
   simulador.

---

## 8 · Formato de proyecto (`.repack`)

**Extensión.** El archivo se guarda como `.repack` (B1, petición del usuario);
el contenido es el mismo JSON de siempre. Hasta v0.1.6 se llamaba
`.repack.json`: se siguen abriendo los dos (`core/project-names.ts`:
`PROJECT_EXTENSION`, `PROJECT_EXTENSIONS`, `isProjectName`), tanto en el
selector del navegador (`accept` y `types`), como en el diálogo del
escritorio (un solo filtro con `repack` y `repack.json`, el primero es el que
un diálogo de guardar añade a un nombre sin extensión) y al soltarlos en la
ventana. El lanzador escribe `.repack` (`WRITABLE_EXTENSIONS` de
`rt-app/src/files.rs`) y recuerda como último proyecto cualquiera de los dos.
No hay asociación de la extensión con el programa en los instaladores (doble
clic): no se pidió, y queda para una fase de empaquetado.

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

**Sección** (Q1). `state.section` es el plano de la vista en sección
(SPEC §3.1): `{ enabled, point, normal, cap }` o `null`. Un archivo sin el
campo (anterior a Q1) abre sin plano; al abrir, `normalizeSection` toma un
plano roto (sin normal, con números que no lo son) por ninguno, completa
los indicadores que faltan (encendido y tapado) y vuelve unitaria la
normal. El esquema sigue en 2 y no hay migración. Los clips `SECTION` de
la animación son clips de siempre, de objetivo `{ kind: 'SCENE' }`.

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

**Estudios de los trabajos** (N2b). `state.render.studios` es la lista de
copias de los estudios guardados en los que renderizan los trabajos de la
cola: `[{ "hash", "studio" }]`, `studio` el `SavedStudio` tal como lo pone
`restoreStudio` (`core/lighting.ts`; con su `id` y su `name`) y `hash` el
SHA-256 en hexadecimal de su contenido sin id ni nombre, en JSON con las
claves ordenadas (`studioHash`, `core/job-studios.ts`), así que la misma
copia sale igual la escriba quien la escriba. Hay **una copia por id y
*hash***, la usen los trabajos que la usen, y cada trabajo la nombra con el
campo opcional `studioCopy` (el *hash*; su `settings.studio` sigue siendo
`{ kind: 'ONE', id, name }`). Solo se guardan las copias que nombra algún
trabajo (`pruneEmbedded`, en el *reducer*: quitar el último trabajo de un
estudio quita su copia, y deshacer la devuelve). Lo grande no va dos veces:
las luces llevan su perfil IES en el JSON, como las del proyecto (L5), y el
HDRI, la imagen de fondo y las texturas de la copia son `ImageRef` cuyos
archivos van en el bloque `images` con los del proyecto, **una vez cada
imagen** la nombre quien la nombre (un estudio con el HDRI del proyecto
solo añade su JSON). Al abrir, `migrateRender` toma las entradas con forma
de copia (un *hash* de 64 cifras, un estudio con id y nombre, sin repetir)
y `checkState` lee cada una como los bloques del proyecto: su entorno, su
imagen y su cámara se completan con los valores de un proyecto nuevo y se
comprueban los tipos, los perfiles IES de sus luces se leen
(`withReadableProfile`), sus materiales como los del proyecto (`textures`,
`graph`) y cada material que nombran sus piezas tiene que estar en ella;
una copia dañada se quita, no el proyecto (su trabajo busca entonces el
estudio en la biblioteca, como antes). `placeImages` y `placeTextureImages`
colocan sus imágenes con las del proyecto y le cambian los ids igual
(un id que en la sesión nombra otra imagen pasa a uno nuevo en el proyecto
y en sus copias a la vez). El *hash* guardado no se recalcula al abrir: es
el nombre de la copia. Un trabajo renderiza en su copia; sin ella (un
archivo anterior a N2b o una copia quitada), en el estudio de la biblioteca
de ese id; si no, en uno que el proyecto guardaba dentro (`studio.saved`);
si no, falla con el motivo (`resolveStudio`). Un archivo anterior a N2b no
tiene ni la lista ni `studioCopy` y abre igual; una versión anterior que
abra uno nuevo ignora los dos campos y busca los estudios en su biblioteca.
El esquema sigue en 2.
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
